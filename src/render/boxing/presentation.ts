import { boxingConfig as C } from '../../core/boxing/boxing.config';
import type { BoxerId, BoxingState } from '../../core/boxing/types';
import { boxingVisual as V } from './visual.config';

/** Anatomical left/right, plus chin. Each boxer owns a separate set, even with a shared face feed. */
export type FaceDamage = [number, number, number];
export interface Presentation {
  damage: FaceDamage;
  hitSide: number;
  hitAge: number;
  floor: number;
  stage: 'standing' | 'fall' | 'down' | 'rise';
  /** Dizzy wobble weight, eased 0 ... 1 so it never pops. */
  dizzy: number;
  time: number;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const k = clamp(n);
  return k * k * (3 - 2 * k);
};

/** Render history observes the sim's hit list (where each glove really touched) rather than drainEvents(),
 * which belongs to the HUD.
 * Same-tick split-screen draws are idempotent; new simulations and rewinds clear every bruise.
 * Floor state follows the sim exactly: a dizzy boxer is still standing (and can dodge or be hit), so
 * dizzy only wobbles. The fall starts with the referee count, or with a TKO. */
export function createPresentation() {
  let source: Readonly<BoxingState> | null = null;
  let tick = -1,
    clock = 0,
    lastT = 0,
    seenHitT = -Infinity,
    hitT = -Infinity,
    fallAt = -Infinity;
  let out = newPresentation(0);
  return (s: Readonly<BoxingState>, who: BoxerId): Presentation => {
    if (source !== s || s.tick < tick) {
      source = s;
      tick = -1;
      clock = s.t;
      lastT = s.t;
      seenHitT = -Infinity;
      hitT = -Infinity;
      fallAt = -Infinity;
      out = newPresentation(s.t);
    }
    if (tick === s.tick) return out;
    const dt = s.phase === 'paused' ? 0 : Math.max(0, s.t - lastT);
    clock += dt;
    lastT = s.t;
    tick = s.tick;
    out.time = clock;
    const b = s.boxers[who];
    // Hits since the last read, even when frames skip ticks (the sim runs at 120 Hz, frames at 60).
    const fresh = b.hits.filter((hit) => hit.t > seenHitT); // same-tick hits share a t: all count
    for (const hit of fresh) {
      out.damage[hit.zone] = clamp(out.damage[hit.zone] + V.bruisePerHit);
      out.hitSide = hit.zone === 0 ? 1 : hit.zone === 1 ? -1 : 0;
      hitT = clock - Math.max(0, s.t - hit.t);
    }
    seenHitT = fresh.at(-1)?.t ?? seenHitT;
    out.hitAge = clock - hitT;
    const floored = flooredBy(s, who);
    // A count already running when first observed began phaseT ago. A KO keeps the count's start,
    // so the boxer stays on the floor instead of falling a second time.
    if (!floored) fallAt = -Infinity;
    else if (fallAt === -Infinity) fallAt = floored === 'count' ? clock - s.phaseT : clock;
    updateFloor(s, who, out, floored ? clock - fallAt : -1);
    const dizzy = b.dizzy && !floored ? 1 : 0;
    out.dizzy += (dizzy - out.dizzy) * (1 - Math.exp(-dt / V.dizzyEaseS));
    return out;
  };
}

/** 'count' = down for the referee; 'out' = lost by KO/TKO; null = standing (dizzy included). */
function flooredBy(s: Readonly<BoxingState>, who: BoxerId): 'count' | 'out' | null {
  const phase = s.phase === 'paused' ? s.pausedFrom : s.phase;
  if (phase === 'down' && s.down?.boxer === who) return 'count';
  if (phase === 'over' && s.winner !== null && s.winner !== who)
    return s.result === 'KO' || s.result === 'TKO' ? 'out' : null;
  return null;
}

function newPresentation(time: number): Presentation {
  return {
    damage: [0, 0, 0],
    hitSide: 1,
    hitAge: Infinity,
    floor: 0,
    stage: 'standing',
    dizzy: 0,
    time,
  };
}

/** `fallen`: seconds since the fall began, or < 0 when standing. */
function updateFloor(s: Readonly<BoxingState>, who: BoxerId, out: Presentation, fallen: number) {
  out.floor = fallen < 0 ? 0 : smooth(fallen / V.fallS);
  out.stage = out.floor > 0 ? (out.floor < 1 ? 'fall' : 'down') : 'standing';
  const phase = s.phase === 'paused' ? s.pausedFrom : s.phase;
  if (phase !== 'down' || s.down?.boxer !== who || s.down.getUpAt >= 10) return;
  // Back on the feet exactly when the sim resumes the fight (count = getUpAt).
  const riseEnd = s.down.getUpAt * C.knockdown.countS;
  const riseS = Math.max(0.1, Math.min(V.riseS, riseEnd - V.fallS));
  const k = smooth((s.phaseT - (riseEnd - riseS)) / riseS);
  if (k > 0) {
    out.floor *= 1 - k;
    out.stage = 'rise';
  }
}
