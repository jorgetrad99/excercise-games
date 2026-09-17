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

/** Events that may legitimately refill the bot's pie: its own landed gain, getting up, the bell, a clinch break. */
const REFILLS = new Set(['HIT:0', 'COUNTER:0', 'GET_UP:1', 'ROUND_END:-']);

describe('pose player vs the 1P bot (B2)', () => {
  it('clean hits drain the bot and the damage stays: its pie only refills on a rule event', () => {
    const keys: Key[] = [CALIBRATE, { ms: 400, to: {} }];
    for (let k = 0; k < 20; k++) {
      // A straight out in 150 ms, back in 200 ms, then 1.65 s in guard; alternating hands.
      keys.push({ ms: 150, to: k % 2 ? { punchL: 1 } : { punchR: 1 } }, { ms: 200, to: {} });
      keys.push({ ms: 1650, to: {} });
    }
    const frames = script(keys, { base: { fists: 'guard' } });
    const engine = createGestureEngine({ video: () => ({ width: 1280, height: 720 }) });
    const s = initBoxing({ seed: 1, skipIntro: true });
    const bot = boxingBot([1]);
    const events: string[] = [];
    const unexplained: string[] = [];
    let i = 0;
    for (let tick = 0; tick * C.fixedDt * 1000 <= frames.at(-1)!.t; tick++) {
      const now = tick * C.fixedDt * 1000;
      const input = [];
      for (; i < frames.length && frames[i]!.t <= now; i++) {
        const pose = engine.push(frames[i]!).signals.pose;
        if (pose) input.push(bodyEvent(pose, 0, null));
      }
      const before = s.boxers.map((b) => [b.stamina, b.dizzy] as const);
      tickBoxing(s, now < CALIBRATE.ms + 400 ? input : [...input, ...bot(s)]);
      const tickEvents = s.events.map((e) => `${e.type}:${e.boxer ?? '-'}`);
      events.push(...tickEvents);
      const clinch = before.every(([, dizzy]) => dizzy);
      if (s.boxers[1].stamina > before[1]![0] && !clinch && !tickEvents.some((e) => REFILLS.has(e)))
        unexplained.push(`${(now / 1000).toFixed(2)}s ${before[1]![0].toFixed(2)}→${s.boxers[1].stamina.toFixed(2)}`);
    }
    expect(events.filter((e) => e === 'HIT:1').length).toBeGreaterThanOrEqual(8);
    expect(unexplained).toEqual([]); // no mid-round regen (B3)
    expect(events).toContain('DIZZY:1'); // the hits add up: the bot's pie empties
  });
});
