// TEMPORARY(synthetic-fixtures): synthetic straights (pose/testdata/synthetic.ts) until Jorge's drills exist.
// B2 (playtest: "hits don't damage the opponent"): a pose player's clean hits on the 1P bot must leave
// damage that lasts, end to end: camera frames → gesture engine → BODY → sim with the bot.
import { describe, expect, it } from 'vitest';
import { boxingConfig as C } from '../../core/boxing/boxing.config';
import { boxingBot } from '../../core/boxing/bot';
import { initBoxing, tickBoxing } from '../../core/boxing/sim';
import { createGestureEngine } from '../../pose/gestures';
import { CALIBRATE, script, type Key } from '../../pose/testdata/synthetic';
import { bodyEvent } from './body-input';

/** Events that may legitimately refill the bot's pie: its own landed gain, getting up, the bell. */
const REFILLS = new Set(['HIT:0', 'COUNTER:0', 'GET_UP:1', 'ROUND_END:-']);

/** 20 alternating straights (out in 150 ms ≈ 4.4 m/s glove, back in 200 ms, 1.65 s in guard) vs the bot. */
function poseMatch(fps: number) {
  const keys: Key[] = [CALIBRATE, { ms: 400, to: {} }];
  for (let k = 0; k < 20; k++) {
    keys.push({ ms: 150, to: k % 2 ? { punchL: 1 } : { punchR: 1 } }, { ms: 200, to: {} });
    keys.push({ ms: 1650, to: {} });
  }
  const frames = script(keys, { fps, base: { fists: 'guard' } });
  const engine = createGestureEngine({ video: () => ({ width: 1280, height: 720 }) });
  const s = initBoxing({ seed: 1, skipIntro: true });
  const bot = boxingBot([1]);
  const out = { events: [] as string[], unexplained: [] as string[], reactions: 0, lowest: 10 };
  let i = 0;
  for (let tick = 0; tick * C.fixedDt * 1000 <= frames.at(-1)!.t; tick++) {
    const now = tick * C.fixedDt * 1000;
    const input = [];
    for (; i < frames.length && frames[i]!.t <= now; i++) {
      const pose = engine.push(frames[i]!).signals.pose;
      if (pose) input.push(bodyEvent(pose, 0, null));
    }
    const auto = now < CALIBRATE.ms + 400 ? [] : bot(s);
    // The bot only guards or dodges in reaction to a glove closing on it (bot.ts react): the player's.
    out.reactions += auto.filter((e) => e.type === 'GUARD_START' || e.type.startsWith('DODGE')).length;
    const before = s.boxers.map((b) => [b.stamina, b.dizzy] as const);
    tickBoxing(s, [...input, ...auto]);
    const tickEvents = s.events.map((e) => `${e.type}:${e.boxer ?? '-'}`);
    out.events.push(...tickEvents);
    const clinch = before.every(([, dizzy]) => dizzy);
    if (s.boxers[1].stamina > before[1]![0] && !clinch && !tickEvents.some((e) => REFILLS.has(e)))
      out.unexplained.push(`${(now / 1000).toFixed(2)}s ${before[1]![0]}→${s.boxers[1].stamina}`);
    out.lowest = Math.min(out.lowest, s.boxers[1].stamina);
  }
  return out;
}

describe('pose player vs the 1P bot (B2)', () => {
  it.each([30, 20, 15])('at %i pose-fps: hits drain the bot, the damage stays, and the bot defends', (fps) => {
    const m = poseMatch(fps);
    const hits = m.events.filter((e) => e === 'HIT:1').length;
    expect(hits).toBeGreaterThanOrEqual(8);
    expect(m.unexplained).toEqual([]); // no mid-round regen (B3): the pie only refills on a rule event
    // The hits add up: 8 straights at ~4.4 m/s do ≥ 8 × 0.62 ≈ 5 seg (PLAN-BOXING §2.5 damage curve), so the
    // pie must get below half at some point. (Not DIZZY: at 0.62 seg a hit, ~16 are needed, §2.5.)
    expect(m.lowest).toBeLessThanOrEqual(C.stamina.segments / 2);
    expect(m.reactions).toBeGreaterThan(0); // BX-CL-9: the bot sees pose punches
  });
});
