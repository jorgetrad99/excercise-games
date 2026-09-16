// Offline gesture-latency analysis (not part of `pnpm verify`; run `pnpm latency:gestures`).
//
// What it measures: the ALGORITHMIC delay from the start of a body movement to the gesture event,
// split into "geometry" (thresholds, velocity window, hold times; no filter, no noise) and
// "filter" (One Euro lag), plus false events while standing still. Inputs:
//   - the real noise and body proportions of Jorge's recording (read-only; path in POSE_RECORDING),
//   - human-like movement profiles (jump / lean / crouch) layered on that still pose.
// Writes tmp/latency/gestures-<LABEL>.json and prints a table. GRID=1 also sweeps One Euro params.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { it } from 'vitest';
import { createGestureEngine, type GestureEventType } from '../../src/pose/gestures';
import { gestureConfig, type GestureConfig } from '../../src/pose/gestures.config';
import type { PoseFixture } from '../../src/pose/recorder';
import type { Landmark, PoseFrame } from '../../src/pose/types';

const REC =
  process.env.POSE_RECORDING ?? `${homedir()}/Downloads/pose-2026-09-16T18-42-19-146Z.json`;
const LABEL = process.env.LABEL ?? 'current';
const STILL = { from: 11_500, to: 15_000 }; // stillest stretch of the recording (measured)
const FPS = Number(process.env.FPS ?? 30);

type Pose = Landmark[];
const UPPER = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
]);
const smooth = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

interface Source {
  base: Pose;
  noise: Pose[]; // deviations from the still mean, in order (real temporal structure)
  torso: number;
  shoulderW: number;
  fx: PoseFixture;
}

function loadSource(): Source {
  const fx = JSON.parse(readFileSync(REC, 'utf8')) as PoseFixture;
  const still = fx.frames
    .filter((f) => f.t >= STILL.from && f.t < STILL.to && f.poses[0])
    .map((f) => f.poses[0]!);
  const base = still[0]!.map((_, i) => {
    const avg = (k: 'x' | 'y' | 'z' | 'visibility') =>
      still.reduce((a, p) => a + p[i]![k], 0) / still.length;
    return { x: avg('x'), y: avg('y'), z: avg('z'), visibility: 1 };
  });
  const noise = still.map((p) =>
    p.map((lm, i) => ({ ...lm, x: lm.x - base[i]!.x, y: lm.y - base[i]!.y })),
  );
  // Arms relaxed at the sides: in the recorded still stretch they're held slightly out, and noise
  // there flips the T-pose detector (blocks calibration), which isn't what this tool measures.
  for (const [wrist, elbow, hip] of [
    [15, 13, 23],
    [16, 14, 24],
  ] as const) {
    base[wrist] = { ...base[wrist]!, x: base[hip]!.x, y: base[hip]!.y + 0.02 };
    base[elbow] = { ...base[elbow]!, x: base[hip]!.x, y: (base[hip]!.y + base[11]!.y) / 2 };
  }
  const mid = (a: number, b: number, k: 'x' | 'y') => (base[a]![k] + base[b]![k]) / 2;
  const torso = Math.abs(mid(23, 24, 'y') - mid(11, 12, 'y'));
  const shoulderW = Math.abs(base[11]!.x - base[12]!.x) * (fx.video.width / fx.video.height);
  return { base, noise, torso, shoulderW, fx };
}

/** Offsets per landmark at time u (ms since movement onset). Screen-left lean = +x raw (mirrored). */
type Motion = (u: number, i: number, src: Source) => { dx: number; dy: number };
const MOTIONS: Record<'jump' | 'lean' | 'crouch', { motion: Motion; expect: GestureEventType }> = {
  // Push-off 220 ms to take-off, apex 0.6 torso ~300 ms later, land at ~750 ms. A 120 ms dip precedes onset.
  jump: {
    expect: 'JUMP',
    motion: (u, _i, s) => {
      if (u < -120) return { dx: 0, dy: 0 };
      if (u < 0) return { dx: 0, dy: 0.08 * s.torso * smooth((u + 120) / 120) };
      const up =
        u < 520
          ? Math.sin((Math.PI / 2) * Math.min(1, u / 520))
          : Math.max(0, 1 - ((u - 520) / 330) ** 2);
      return { dx: 0, dy: s.torso * (0.08 - 0.68 * up) };
    },
  },
  // Upper body shifts 0.7 shoulder widths in 300 ms, hips 0.25; held.
  lean: {
    expect: 'LANE_LEFT',
    motion: (u, i, s) => {
      const k = smooth(u / 300) * (s.shoulderW / (s.fx.video.width / s.fx.video.height));
      return { dx: (UPPER.has(i) ? 0.7 : 0.25) * k, dy: 0 };
    },
  },
  // Head/shoulders drop 0.5 torso in 350 ms, hips 0.3; held.
  crouch: {
    expect: 'SLIDE_START',
    motion: (u, i, s) => ({ dx: 0, dy: s.torso * smooth(u / 350) * (UPPER.has(i) ? 0.5 : 0.3) }),
  },
};

function frames(
  src: Source,
  motion: Motion | null,
  opts: { noise: number; phaseMs: number; ms: number },
): PoseFrame[] {
  const out: PoseFrame[] = [];
  const onset = ONSET;
  for (let n = 0, t = opts.phaseMs; t < opts.ms; n++, t = opts.phaseMs + (n * 1000) / FPS) {
    const len = src.noise.length;
    const k = Math.floor(n % (2 * len));
    const nz = src.noise[k < len ? k : 2 * len - 1 - k]!; // ping-pong: no loop discontinuity
    const pose = src.base.map((lm, i) => {
      const m = motion ? motion(t - onset, i, src) : { dx: 0, dy: 0 };
      return {
        ...lm,
        x: lm.x + m.dx + opts.noise * nz[i]!.x,
        y: lm.y + m.dy + opts.noise * nz[i]!.y,
      };
    });
    out.push({ t, poses: [pose] });
  }
  return out;
}

function run(src: Source, cfg: GestureConfig, fs: PoseFrame[]) {
  const engine = createGestureEngine({ video: () => src.fx.video, config: cfg });
  const events: { t: number; type: GestureEventType }[] = [];
  const lean: number[] = [];
  const rise: number[] = [];
  for (const f of fs) {
    const r = engine.push(f);
    events.push(...r.events);
    if (r.signals.calibration.state === 'calibrated') {
      lean.push(r.signals.leanX);
      rise.push(r.signals.hipRise);
    }
  }
  return { events, lean, rise };
}

const sd = (v: number[]): number => {
  const m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length));
};
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const PHASES = [0, 5, 10, 15, 20, 25, 30];
/** Movement onset; calibration (2 s still) must finish before it even with real noise. */
const ONSET = 6000;

/** Mean delay (ms) from onset to the expected event over sampling phases; NaN if it never fires. */
function delay(src: Source, cfg: GestureConfig, name: keyof typeof MOTIONS, noise: number): number {
  const { motion, expect } = MOTIONS[name];
  const ds = PHASES.map((phaseMs) => {
    const e = run(src, cfg, frames(src, motion, { noise, phaseMs, ms: ONSET + 1500 })).events.find(
      (x) => x.type === expect && x.t >= ONSET - 100,
    );
    return e ? e.t - ONSET : NaN;
  });
  return mean(ds);
}

function evaluate(src: Source, cfg: GestureConfig) {
  const noFilter: GestureConfig = { ...cfg, filter: { minCutoff: 1e6, beta: 0, dCutoff: 1 } };
  const gestures = Object.fromEntries(
    (Object.keys(MOTIONS) as (keyof typeof MOTIONS)[]).map((name) => {
      const geometry = delay(src, noFilter, name, 0);
      const clean = delay(src, cfg, name, 0);
      const noisy = delay(src, cfg, name, 1);
      return [name, { geometry, filterLag: clean - geometry, total: noisy }];
    }),
  );
  const idle = (k: number) =>
    run(src, cfg, frames(src, null, { noise: k, phaseMs: 0, ms: 60_000 }));
  const idle1 = idle(1);
  const idle2 = idle(2);
  const idle4 = idle(4);
  const recording = run(src, cfg, src.fx.frames).events.map(
    (e) => `${(e.t / 1000).toFixed(2)} ${e.type}`,
  );
  return {
    filter: cfg.filter,
    gestures,
    idle: {
      falseEvents1x: idle1.events.filter((e) => e.type !== 'CALIBRATED').length,
      falseEvents2x: idle2.events.filter((e) => e.type !== 'CALIBRATED').length,
      falseEvents4x: idle4.events.filter((e) => e.type !== 'CALIBRATED').length,
      leanXsd: sd(idle1.lean),
      hipRiseSd: sd(idle1.rise),
    },
    recording,
  };
}

it(`gesture latency report (${LABEL})`, () => {
  const src = loadSource();
  const report = {
    label: LABEL,
    fps: FPS,
    source: { torso: src.torso, shoulderW: src.shoulderW, stillFrames: src.noise.length },
    ...evaluate(src, gestureConfig),
  };
  mkdirSync('tmp/latency', { recursive: true });
  writeFileSync(`tmp/latency/gestures-${LABEL}.json`, JSON.stringify(report, null, 2));
  const rows = Object.entries(report.gestures).map(
    ([g, d]) =>
      `${g.padEnd(7)} geometry ${d.geometry.toFixed(0).padStart(4)} ms  filter +${d.filterLag.toFixed(0).padStart(3)} ms  total(noisy) ${d.total.toFixed(0).padStart(4)} ms`,
  );
  console.log(
    [
      `[${LABEL}] filter ${JSON.stringify(report.filter)} @${FPS} fps`,
      ...rows,
      `idle 60 s: false events 1x=${report.idle.falseEvents1x} 2x=${report.idle.falseEvents2x}, leanX sd ${report.idle.leanXsd.toFixed(3)}, hipRise sd ${report.idle.hipRiseSd.toFixed(3)}`,
    ].join('\n'),
  );

  if (process.env.GRID) {
    const grid: string[] = [];
    for (const minCutoff of [0.3, 0.6, 1, 1.5, 2.5]) {
      for (const beta of [0, 1, 3, 10, 30, 100]) {
        const r = evaluate(src, {
          ...gestureConfig,
          filter: { ...gestureConfig.filter, minCutoff, beta },
        });
        const g = r.gestures;
        grid.push(
          [
            minCutoff,
            beta,
            g.jump!.total.toFixed(0),
            g.lean!.total.toFixed(0),
            g.crouch!.total.toFixed(0),
            g.jump!.filterLag.toFixed(0),
            g.lean!.filterLag.toFixed(0),
            g.crouch!.filterLag.toFixed(0),
            r.idle.falseEvents1x,
            r.idle.falseEvents2x,
            r.idle.leanXsd.toFixed(3),
            r.idle.hipRiseSd.toFixed(3),
          ].join('\t'),
        );
      }
    }
    const header =
      'minCut\tbeta\tjump\tlean\tcrouch\tjLag\tlLag\tcLag\tfalse1x\tfalse2x\tleanSd\triseSd';
    writeFileSync(`tmp/latency/grid-${LABEL}.tsv`, [header, ...grid].join('\n'));
    console.log([header, ...grid].join('\n'));
  }
}, 600_000);
