// Offline render-judder analysis (pnpm latency:judder, LABEL=...): does the 120 Hz fixed sim step
// show up as uneven motion at a given display refresh rate?
//
// For each refresh rate, frames arrive at k/hz ± 0.3 ms (rAF jitter) and drive GameSim exactly like
// main.ts. Each frame's drawn position (render/interp.ts) is compared with the ideal continuous
// position at that frame's time (linear between tick states). The error's spread is judder; its
// mean is a constant visual lag. Lateral error is measured only mid lane-change, vertical mid-jump.
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { createBot } from '../../src/core/bot';
import { mulberry32 } from '../../src/core/prng';
import { createGameSim } from '../../src/core/sim';
import { simConfig as C } from '../../src/core/sim.config';
import { renderPose } from '../../src/render/interp';

const LABEL = process.env.LABEL ?? 'current';
const SECONDS = 120;

interface Tick {
  t: number;
  x: number;
  y: number;
  distance: number;
}

function ideal(ticks: Tick[], t: number): Tick {
  // ticks[i].t = i · fixedDt
  const i = Math.min(ticks.length - 2, Math.max(0, Math.floor(t / C.fixedDt)));
  const a = ticks[i]!;
  const b = ticks[i + 1]!;
  const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
  return {
    t,
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    distance: a.distance + (b.distance - a.distance) * u,
  };
}

const stats = (v: number[]) => {
  const m = v.reduce((a, b) => a + b, 0) / (v.length || 1);
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length || 1));
  const sorted = v.map((e) => Math.abs(e - m)).sort((a, b) => a - b);
  return {
    meanMm: m * 1000,
    sdMm: sd * 1000,
    p95Mm: (sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 1000,
    n: v.length,
  };
};

function measure(hz: number) {
  const sim = createGameSim({ seed: 42, skipCountdown: true });
  const bot = createBot(sim.context);
  const ticks: Tick[] = [];
  // The controller runs before every tick: the state it sees is the result of `s.tick` ticks.
  sim.setController((s) => {
    ticks[s.tick] = { t: s.tick * C.fixedDt, x: s.x, y: s.y, distance: s.distance };
    return bot.act(s);
  });
  const rng = mulberry32(hz);
  const frames: { wall: number; x: number; y: number; distance: number }[] = [];
  let wall = 0;
  for (let k = 1; wall < SECONDS && sim.getState().phase === 'running'; k++) {
    const next = k / hz + (rng() - 0.5) * 0.0006;
    sim.step(next - wall, []);
    wall = next;
    const drawn = renderPose(sim.getState(), sim.previous(), sim.alpha());
    frames.push({ wall, x: drawn.x, y: drawn.y, distance: drawn.distance });
  }
  const err = { x: [] as number[], y: [] as number[], distance: [] as number[] };
  for (const f of frames) {
    if (f.wall > ticks.length * C.fixedDt - 2 * C.fixedDt) break;
    const truth = ideal(ticks, f.wall);
    const before = ideal(ticks, f.wall - 1 / hz);
    err.distance.push(f.distance - truth.distance);
    // Signed along the direction of motion, so left/right (up/down) errors don't cancel or inflate.
    const vx = truth.x - before.x;
    const vy = truth.y - before.y;
    if (Math.abs(vx) > 1e-6) err.x.push(Math.sign(vx) * (f.x - truth.x));
    if (truth.y > 0 && Math.abs(vy) > 1e-6) err.y.push(Math.sign(vy) * (f.y - truth.y));
  }
  return { hz, forward: stats(err.distance), lateral: stats(err.x), vertical: stats(err.y) };
}

it(`frame judder report (${LABEL})`, () => {
  const rows = [60, 120, 144, 165, 240].map(measure);
  mkdirSync('tmp/latency', { recursive: true });
  writeFileSync(`tmp/latency/judder-${LABEL}.json`, JSON.stringify(rows, null, 2));
});
