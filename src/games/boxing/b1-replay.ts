// Test helper: a take of Jorge's B1 capture end to end, camera frames → gesture engine → BODY → sim.
import { boxingConfig as C } from '../../core/boxing/boxing.config';
import { initBoxing, tickBoxing, type BoxingController } from '../../core/boxing/sim';
import type { BoxingState } from '../../core/boxing/types';
import { replayB1, type B1Take } from '../../pose/testdata/real-b1';
import { bodyEvent } from './body-input';

export interface Contact {
  /** Sim time, ms from the take's start. */
  t: number;
  type: 'HIT' | 'BLOCK' | 'WHIFF';
  /** The player's glove that made it: 0 left, 1 right (the glove whose contact state changed), null if
   *  neither changed (a test should fail on that). */
  glove: 0 | 1 | null;
}

/** Plays `take` as boxer 0 against boxer 1 (idle unless `opponent` drives it). Every tick's events are
 *  passed to `onTick`, so callers can watch state around them. */
export function playB1(
  take: B1Take,
  opponent: BoxingController = () => [],
  onTick?: (s: BoxingState, before: BoxingState['boxers']) => void,
): { contacts: Contact[]; state: BoxingState } {
  const frames = replayB1(take);
  const s = initBoxing({ seed: 1, skipIntro: true });
  const contacts: Contact[] = [];
  let i = 0;
  for (let tick = 0; tick * C.fixedDt * 1000 <= take.frames.at(-1)!.t; tick++) {
    const now = tick * C.fixedDt * 1000;
    const input = [];
    for (; i < frames.length && frames[i]!.t <= now; i++) {
      const pose = frames[i]!.signals.pose;
      if (pose) input.push(bodyEvent(pose, 0, null));
    }
    const before = structuredClone(s.boxers);
    tickBoxing(s, [...input, ...opponent(s)]);
    onTick?.(s, before);
    const was = before[0].gloves;
    const glove = s.boxers[0].gloves.findIndex(
      (g, k) => (g.struck && !was[k]!.struck) || (g.spent && !was[k]!.spent),
    );
    for (const e of s.events)
      if (((e.type === 'HIT' || e.type === 'BLOCK') && e.boxer === 1) || (e.type === 'WHIFF' && e.boxer === 0))
        contacts.push({ t: Math.round(now), type: e.type, glove: glove === -1 ? null : (glove as 0 | 1) });
  }
  return { contacts, state: s };
}
