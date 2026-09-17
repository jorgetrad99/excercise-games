import { boxingConfig as C } from '../../core/boxing/boxing.config';
import type { BoxerId, BoxingState, Fist } from '../../core/boxing/types';
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

/** Aim is the puncher's frame: +x hits the defender's anatomical left. */
export function impactZone(fist: Fist, hand: number): 0 | 1 | 2 {
  if (fist.aim.y > C.aim.upperMin) return 2;
  return Math.abs(fist.aim.x) > 0.15 ? (fist.aim.x > 0 ? 0 : 1) : hand === 0 ? 1 : 0;
}

/** Render history observes cumulative hits rather than drainEvents(), which belongs to the HUD.
 * Same-tick split-screen draws are idempotent; new simulations and rewinds clear every bruise.
 * Floor state follows the sim exactly: a dizzy boxer is still standing (and can dodge or be hit), so
 * dizzy only wobbles. The fall starts with the referee count, or with a TKO. */
export function createPresentation() {
  let source: Readonly<BoxingState> | null = null;
  let tick = -1,
    clock = 0,
    lastT = 0,
    landed = 0,
    hitT = -Infinity,
    fallAt = -Infinity;
  let zone: 0 | 1 | 2 = 0;
  let out = newPresentation(0);
  return (s: Readonly<BoxingState>, who: BoxerId): Presentation => {
    if (source !== s || s.tick < tick) {
      source = s;
      tick = -1;
      clock = s.t;
      lastT = s.t;
      landed = 0;
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
    const b = s.boxers[who],
      attacker = s.boxers[who === 0 ? 1 : 0];
    const fists = attacker.fists;
    const hand = activeHand(fists);
    if (fists.some((f) => f.phase !== 'ready')) zone = impactZone(fists[hand], hand);
    const hits = Math.max(0, attacker.landed - landed);
    if (hits) {
      addDamage(out.damage, fists, hits, zone);
      out.hitSide = zone === 0 ? 1 : zone === 1 ? -1 : 0;
      hitT = clock - Math.max(0, s.t - b.hitT);
    }
    landed = attacker.landed;
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

function addDamage(
  damage: FaceDamage,
  fists: readonly [Fist, Fist],
  hits: number,
  zone: 0 | 1 | 2,
): void {
  if (
    hits === 2 &&
    fists.every((f) => f.phase === 'back') &&
    Math.abs(fists[0].t - fists[1].t) < C.fixedDt
  ) {
    fists.forEach((f, hand) => {
      const side = impactZone(f, hand);
      damage[side] = clamp(damage[side] + V.bruisePerHit);
    });
  } else damage[zone] = clamp(damage[zone] + hits * V.bruisePerHit);
}

function activeHand(fists: readonly [Fist, Fist]): 0 | 1 {
  if (fists[1].phase === 'back' && (fists[0].phase !== 'back' || fists[1].t < fists[0].t)) return 1;
  return fists[0].phase === 'ready' && fists[1].phase !== 'ready' ? 1 : 0;
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
