// Boxing detection tuning against REAL recordings (not part of `pnpm verify`; run `pnpm tune:boxing`).
//
// Inputs: Jorge's drill recordings in fixtures/pose/boxing/ (protocol in docs/PROGRESS.md
// 2026-09-16 "Boxing fixture protocol"), each with the exact counts in DRILLS below. Every drill starts
// with the LEFT hand overhead for 2 s: that checks MediaPipe's left label matches the player's
// anatomical left in the real camera setup (a driver-mirrored camera swaps every punch).
// Also replays POSE_RECORDING (default: the Skate Run recording in Downloads) as a no-boxing
// false-positive check, unscored.
//
// Output: per-drill event counts vs expected (current gestureConfig), the handedness check, pose-state
// channels at punch time (bone-model reach vs world-landmark reach), and with GRID=1 the best fist
// parameter sets by total count error. Writes tmp/tune/boxing-<LABEL>.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { it } from 'vitest';
import { createGestureEngine, type GestureEventType } from '../../src/pose/gestures';
import { gestureConfig, type GestureConfig } from '../../src/pose/gestures.config';
import type { PoseFixture } from '../../src/pose/recorder';
import type { PoseFrame } from '../../src/pose/types';

const DIR = process.env.BOXING_FIXTURES ?? 'fixtures/pose/boxing';
const NOISE =
  process.env.POSE_RECORDING ?? `${homedir()}/Downloads/pose-2026-09-16T18-42-19-146Z.json`;
const LABEL = process.env.LABEL ?? 'current';

type Counts = Partial<Record<GestureEventType, number>>;
/** Exact counts per drill file. Unlisted PUNCH_* = 0; other unlisted types are reported, not scored. */
const DRILLS: Record<string, Counts> = {
  'idle-stance.json': {},
  'straight-left.json': { PUNCH_LEFT: 8 },
  'straight-right.json': { PUNCH_RIGHT: 8 },
  'hook-left.json': { PUNCH_LEFT: 6 },
  'hook-right.json': { PUNCH_RIGHT: 6 },
  'uppercut-left.json': { PUNCH_LEFT: 6 },
  'uppercut-right.json': { PUNCH_RIGHT: 6 },
  'alternating.json': { PUNCH_LEFT: 5, PUNCH_RIGHT: 5 },
  'both-hands.json': { PUNCH_LEFT: 5, PUNCH_RIGHT: 5 },
  'guard.json': { GUARD_START: 4, GUARD_END: 4 },
  'sway.json': { LANE_LEFT: 4, LANE_RIGHT: 4 },
  'duck.json': { SLIDE_START: 5 },
  'forward-back.json': {},
  'close-alternating.json': { PUNCH_LEFT: 5, PUNCH_RIGHT: 5 },
};
const SCORED: GestureEventType[] = ['PUNCH_LEFT', 'PUNCH_RIGHT'];
const REPORTED: GestureEventType[] = [
  'PUNCH_LEFT',
  'PUNCH_RIGHT',
  'GUARD_START',
  'GUARD_END',
  'LANE_LEFT',
  'LANE_RIGHT',
  'SLIDE_START',
  'CALIBRATED',
];

/** process.stdout, not console: vitest swallows console output when stdout isn't a TTY. */
const say = (...parts: unknown[]) =>
  process.stdout.write(`${parts.join(' ')}
`);

const load = (path: string): PoseFixture => JSON.parse(readFileSync(path, 'utf8')) as PoseFixture;

/** Aim and pose-state channels sampled on each punch, for the report. */
interface PunchSample {
  type: GestureEventType;
  t: number;
  aim: { x: number; y: number } | undefined;
  reach: number | null;
  extension: number | null;
  worldReach: number | null;
}

/** World-landmark reach: wrist forward of its shoulder / (upper + forearm), meters, MediaPipe world
 *  z smaller = nearer the camera. Null without world landmarks. */
function worldReach(frame: PoseFrame, left: boolean): number | null {
  const w = frame.world?.[0];
  if (!w) return null;
  const [s, e, h] = left ? [11, 13, 15] : [12, 14, 16];
  const d = (a: number, b: number) =>
    Math.hypot(w[a]!.x - w[b]!.x, w[a]!.y - w[b]!.y, w[a]!.z - w[b]!.z);
  return (w[s]!.z - w[h]!.z) / (d(s, e) + d(e, h));
}

function run(fx: PoseFixture, cfg: GestureConfig) {
  const engine = createGestureEngine({ video: () => fx.video, config: cfg });
  const counts: Counts = {};
  const punches: PunchSample[] = [];
  for (const frame of fx.frames) {
    const { signals, events } = engine.push(frame);
    for (const e of events) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      if (e.type !== 'PUNCH_LEFT' && e.type !== 'PUNCH_RIGHT') continue;
      const arm = signals.pose?.arms[e.type === 'PUNCH_LEFT' ? 0 : 1] ?? null;
      punches.push({
        type: e.type,
        t: e.t,
        aim: e.aim,
        reach: arm && Math.round(arm.reach * 100) / 100,
        extension: arm && Math.round(arm.extension * 100) / 100,
        worldReach: worldReach(frame, e.type === 'PUNCH_LEFT'),
      });
    }
  }
  return { counts, punches };
}

function error(counts: Counts, expected: Counts): number {
  const keys = new Set<GestureEventType>([
    ...SCORED,
    ...(Object.keys(expected) as GestureEventType[]),
  ]);
  let sum = 0;
  for (const k of keys) sum += Math.abs((counts[k] ?? 0) - (expected[k] ?? 0));
  return sum;
}

/** In the first 3 s the player holds the LEFT hand overhead: label 15 must be the raised wrist. */
function handedness(fx: PoseFixture): 'ok' | 'SWAPPED' | 'unclear' {
  let votes = 0;
  for (const f of fx.frames) {
    if (f.t > 3000) break;
    const p = f.poses[0];
    if (!p) continue;
    const [l, r, nose] = [p[15]!, p[16]!, p[0]!];
    if (l.y < nose.y && r.y > nose.y) votes++;
    if (r.y < nose.y && l.y > nose.y) votes--;
  }
  return votes > 10 ? 'ok' : votes < -10 ? 'SWAPPED' : 'unclear';
}

function* grid(): Generator<GestureConfig> {
  const base = gestureConfig;
  for (const reference of ['nose', 'shoulder'] as const)
    for (const speed of [1.5, 2, 2.5, 3, 4])
      for (const rearm of [0.4, 0.5, 0.6, 0.8])
        for (const zWeight of [0, 0.5, 1])
          for (const velocityWindowMs of [50, 70, 100])
            for (const rearmMs of [50, 100, 200])
              yield {
                ...base,
                fists: {
                  ...base.fists,
                  reference,
                  speed,
                  rearm,
                  zWeight,
                  velocityWindowMs,
                  rearmMs,
                },
              };
}

it('boxing detection vs real recordings', () => {
  const drills = existsSync(DIR)
    ? readdirSync(DIR)
        .filter((f) => f in DRILLS)
        .map((name) => ({ name, fx: load(`${DIR}/${name}`) }))
    : [];
  const missing = Object.keys(DRILLS).filter((n) => !drills.some((d) => d.name === n));
  if (missing.length) say(`missing drills in ${DIR}: ${missing.join(', ')}`);
  const report: Record<string, unknown> = { label: LABEL, config: gestureConfig.fists };

  const table = drills.map(({ name, fx }) => {
    const { counts, punches } = run(fx, gestureConfig);
    const got = Object.fromEntries(REPORTED.map((k) => [k, counts[k] ?? 0]));
    return {
      name,
      handedness: handedness(fx),
      world: fx.frames.some((f) => f.world),
      error: error(counts, DRILLS[name]!),
      expected: DRILLS[name],
      got,
      punches,
    };
  });
  for (const r of table)
    say(
      `${r.name.padEnd(24)} err ${r.error}  hand ${r.handedness}  got ${JSON.stringify(r.got)}  expected ${JSON.stringify(r.expected)}`,
    );
  report.drills = table;

  if (existsSync(NOISE)) {
    const fx = load(NOISE);
    const byRef = (['nose', 'shoulder'] as const).map((reference) => {
      const cfg = { ...gestureConfig, fists: { ...gestureConfig.fists, reference } };
      const { counts, punches } = run(fx, cfg);
      return {
        reference,
        punches: (counts.PUNCH_LEFT ?? 0) + (counts.PUNCH_RIGHT ?? 0),
        at: punches,
      };
    });
    for (const r of byRef)
      say(
        `no-boxing recording, reference ${r.reference}: ${r.punches} punches ${JSON.stringify(r.at.map((p) => `${p.type}@${Math.round(p.t)}`))}`,
      );
    report.noBoxing = byRef;
  }

  if (process.env.GRID === '1' && drills.length > 0) {
    const scored = [...grid()].map((cfg) => ({
      fists: cfg.fists,
      error: drills.reduce((sum, d) => sum + error(run(d.fx, cfg).counts, DRILLS[d.name]!), 0),
    }));
    scored.sort((a, b) => a.error - b.error);
    say('best fist parameter sets (total count error):');
    for (const s of scored.slice(0, 10)) say(s.error, JSON.stringify(s.fists));
    report.grid = scored.slice(0, 50);
  }

  mkdirSync('tmp/tune', { recursive: true });
  writeFileSync(`tmp/tune/boxing-${LABEL}.json`, JSON.stringify(report, null, 2));
});
