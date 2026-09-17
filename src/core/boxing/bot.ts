// Reactive boxing bot: 1P opponent and ?input=bot autoplay. Reacts to each incoming glove once,
// C.bot.reactS after it leaves (a human-ish reaction time), and punches on a coarser decision grid.
// Stateless: every decision is a pure function of (state, boxer, seed, tick), so bot-driven runs
// replay exactly and need no cloning.
import type { Aim } from '../input';
import { boxingConfig as C } from './boxing.config';
import { rngAt, type BoxingController, type BoxingInput } from './sim';
import type { BoxerId, BoxingState } from './types';

const DECIDE_TICKS = Math.max(1, Math.round(C.bot.decideS / C.fixedDt));

/** Reaction for boxer `who` on the tick an opponent punch is `reactS` old; null = no punch to react to. */
function react(s: Readonly<BoxingState>, who: BoxerId, event: MakeInput): BoxingInput[] | null {
  const me = s.boxers[who];
  const them = s.boxers[who === 0 ? 1 : 0];
  const react = C.bot.reactS;
  // Perception is the glove itself (collide.ts closingT), so the bot reads a player's real punch the
  // same way as a key punch.
  const seen = them.gloves.some(
    (g) => g.closingT >= react - 1e-9 && g.closingT < react + C.fixedDt - 1e-9,
  );
  if (!seen) return null;
  const roll = rngAt(s.seed, s.tick, who * 16 + 1);
  const dodge = () =>
    event(rngAt(s.seed, s.tick, who * 16 + 2) < 0.5 ? 'DODGE_LEFT' : 'DODGE_RIGHT');
  if (me.dizzy) return roll < C.bot.dizzyDodgeP ? [dodge()] : [];
  if (roll < C.bot.guardP) return me.guard ? [] : [event('GUARD_START')];
  if (roll < C.bot.guardP + C.bot.dodgeP) return [dodge()];
  return [];
}

type MakeInput = (type: BoxingInput['type'], aim?: Aim) => BoxingInput;

/** Boxer `who`'s input this tick: reactions any tick, punches and guard release on decision ticks. */
export function decide(s: Readonly<BoxingState>, who: BoxerId): BoxingInput[] {
  const me = s.boxers[who];
  const them = s.boxers[who === 0 ? 1 : 0];
  const r = (salt: number) => rngAt(s.seed, s.tick, who * 16 + salt);
  const event: MakeInput = (type, aim) =>
    aim ? { type, aim, player: who } : { type, player: who };
  const reaction = react(s, who, event);
  if (reaction) return reaction;
  if (s.tick % DECIDE_TICKS !== 0 || me.dizzy) return [];
  if (them.gloves.some((g) => g.closingT > 0)) return [];
  const out: BoxingInput[] = me.guard ? [event('GUARD_END')] : [];
  const free = me.fists.map((f) => f.phase === 'ready');
  if ((free[0] || free[1]) && r(3) < C.bot.punchP) {
    const hand = free[0] && (!free[1] || r(4) < 0.5) ? 0 : 1;
    const kind = r(5);
    // A hook sweeps across the body: the left fist toward the puncher's right (+x), and vice versa.
    const hook = { x: hand === 0 ? 0.8 : -0.8, y: 0 };
    const aim: Aim = kind < 0.6 ? { x: 0, y: 0 } : kind < 0.85 ? hook : { x: 0, y: 0.9 };
    out.push(event(hand === 0 ? 'PUNCH_LEFT' : 'PUNCH_RIGHT', aim));
  }
  return out;
}

/** Controller for the sim: drives each boxer in `boxers` while the fight is on. */
export function boxingBot(boxers: readonly BoxerId[]): BoxingController {
  return (s) => (s.phase === 'fight' ? boxers.flatMap((b) => decide(s, b)) : []);
}
