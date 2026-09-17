// B2 (playtest: "hits don't damage the opponent") on Jorge's B1 capture: his real punch takes against
// the 1P bot must leave damage that lasts, end to end: camera frames → gesture engine → BODY → sim.
// 30 pose-fps as recorded, and 15 by dropping every other frame (BX-CL-9 was rate-dependent).
import { describe, expect, it } from 'vitest';
import { boxingBot } from '../../core/boxing/bot';
import { b1Take, type B1Step } from '../../pose/testdata/real-b1';
import { playB1 } from './b1-replay';

/** Events that may legitimately refill the bot's pie: its own landed gain, getting up, the bell. */
const REFILLS = new Set(['HIT:0', 'COUNTER:0', 'GET_UP:1', 'ROUND_END:-']);

function vsBot(step: B1Step, everyNth: 1 | 2) {
  const take = b1Take(step);
  const frames = take.frames.filter((_, i) => i % everyNth === 0);
  const bot = boxingBot([1]);
  const out = { hits: 0, drained: 0, reactions: 0, unexplained: [] as string[] };
  playB1(
    { ...take, frames },
    (s) => {
      const auto = bot(s);
      // The bot only guards or dodges in reaction to a glove closing on it (bot.ts react): the player's.
      out.reactions += auto.filter(
        (e) => e.type === 'GUARD_START' || e.type.startsWith('DODGE'),
      ).length;
      return auto;
    },
    (s, before) => {
      const tags = s.events.map((e) => `${e.type}:${e.boxer ?? '-'}`);
      out.hits += tags.filter((t) => t === 'HIT:1').length;
      const [was, now] = [before[1].stamina, s.boxers[1].stamina];
      if (now < was) out.drained += was - now;
      const clinch = before.every((b) => b.dizzy);
      if (now > was && !clinch && !tags.some((t) => REFILLS.has(t)))
        out.unexplained.push(`${s.t.toFixed(2)}s ${was}→${now}`);
    },
  );
  return out;
}

describe('real punches vs the 1P bot (B2)', () => {
  it.each([
    // step, every nth frame, player HITs on the bot
    ['square-right-x3', 1, 6],
    ['natural-right-x3', 1, 6],
    ['left-x1', 1, 6],
    ['square-right-x3', 2, 6],
    ['natural-right-x3', 2, 5],
    ['left-x1', 2, 5],
  ] as const)(
    '%s, every %i frame(s): %i hits drain the bot, the damage stays, and it reacts',
    (step, nth, hits) => {
      const m = vsBot(step, nth);
      expect(m.hits).toBe(hits);
      expect(m.drained).toBeGreaterThan(0.15 * hits); // every hit costs (PLAN-BOXING §2.5 damage curve)
      expect(m.unexplained).toEqual([]); // no mid-round regen (B3): the pie only refills on a rule event
      expect(m.reactions).toBeGreaterThan(0); // BX-CL-9: the bot sees real pose punches
    },
  );
});
