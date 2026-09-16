// M3 DoD / ADR-002: same seed + same event log ⇒ identical state hash after 60 s.
import { describe, expect, it } from 'vitest';
import { hashJson } from '../../../src/core/hash';
import type { InputEventType } from '../../../src/core/input';
import { createBot } from '../../../src/core/bot';
import { mulberry32 } from '../../../src/core/prng';
import { createGameSim } from '../../../src/core/sim';
import { simConfig as C } from '../../../src/core/sim.config';
import { botRun } from '../../../src/core/testing';

type Log = { tick: number; type: InputEventType }[];
const TICKS = Math.round((C.phases.countdownS + 60) / C.fixedDt);

/** Replay a tick-stamped log through the public GameSim API. */
function replay(seed: number, log: Log): string {
  const sim = createGameSim({ seed, reviveTokens: 2 });
  let i = 0;
  for (let tick = 0; tick < TICKS; tick++) {
    const events = [];
    while (log[i]?.tick === tick) events.push({ t: tick, type: log[i++]!.type });
    sim.step(C.fixedDt, events);
  }
  expect(sim.getState().tick).toBe(TICKS);
  return hashJson(sim.getState());
}

// A realistic 60 s log: what the bot pressed on seed 42 (it survives, so the whole minute is live).
const botLog: Log = [];
botRun(
  { seed: 42, reviveTokens: 2 },
  (s) => s.tick >= TICKS,
  undefined,
  (s, events) => events.forEach((type) => botLog.push({ tick: s.tick, type })),
);

describe('determinism', () => {
  it('bot log: identical hash across replays, sensitive to seed and to the log', () => {
    expect(botLog.length).toBeGreaterThan(30);
    const h = replay(42, botLog);
    expect(replay(42, botLog)).toBe(h);
    expect(replay(43, botLog)).not.toBe(h);
    const nudged = botLog.map((e, i) => (i === 10 ? { ...e, tick: e.tick + 1 } : e));
    expect(replay(42, nudged)).not.toBe(h);
  });

  it('random mashing (crashes, revives, pauses): identical hash across replays', () => {
    const rng = mulberry32(9);
    const types: InputEventType[] = [
      'LANE_LEFT',
      'LANE_RIGHT',
      'JUMP',
      'SLIDE_START',
      'SLIDE_END',
      'GRAB',
      'REVIVE',
      'PAUSE',
      'RESUME',
    ];
    const log: Log = [];
    for (let tick = 0; tick < TICKS; tick += 1 + Math.floor(rng() * 90)) {
      log.push({ tick, type: types[Math.floor(rng() * types.length)]! });
    }
    expect(replay(7, log)).toBe(replay(7, log));
  });

  it('bot autoplay through GameSim.setController matches the headless botRun tick for tick', () => {
    const sim = createGameSim({ seed: 42 });
    sim.setController(createBot(sim.context).act);
    const ticks = Math.round(20 / C.fixedDt);
    for (let i = 0; i < ticks; i++) sim.step(C.fixedDt, []);
    const headless = botRun({ seed: 42 }, (s) => s.tick >= ticks);
    expect(sim.getState().distance).toBeGreaterThan(100);
    expect(hashJson(sim.getState())).toBe(hashJson(headless));
  });

  it('frame pacing does not matter: 1/60 s frames give the same state as 1/120 s ticks', () => {
    const a = createGameSim({ seed: 42 });
    const b = createGameSim({ seed: 42 });
    for (let i = 0; i < 60 * 30; i++) {
      a.step(1 / 60, []);
      b.step(1 / 120, []);
      b.step(1 / 120, []);
    }
    expect(hashJson(a.getState())).toBe(hashJson(b.getState()));
  });
});
