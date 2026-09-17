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
 * Same-tick split-screen draws are idempotent; new simulations and rewinds clear every bruise. */
export function createPresentation() {
  let source: Readonly<BoxingState> | null = null;
  let tick = -1,
    clock = 0,
    lastT = 0,
    landed = 0,
    hitT = -Infinity;
  let dizzyAt = -Infinity,
    terminalAt = -Infinity,
    wasDizzy = false;
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
      dizzyAt = -Infinity;
      terminalAt = -Infinity;
      wasDizzy = false;
      out = newPresentation(s.t);
    }
    if (tick === s.tick) return out;
    if (s.phase !== 'paused') clock += Math.max(0, s.t - lastT);
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
    if (b.dizzy && !wasDizzy) dizzyAt = clock;
    wasDizzy = b.dizzy;
    const phase = s.phase === 'paused' ? s.pausedFrom : s.phase;
    const terminal =
      phase === 'over' && s.winner !== who && (s.result === 'KO' || s.result === 'TKO');
    if (terminal && terminalAt === -Infinity) terminalAt = clock;
    out.hitAge = clock - hitT;
    const elapsed = b.dizzy ? clock - dizzyAt : terminal ? clock - terminalAt : 0;
    updateFloor(s, who, out, elapsed, terminal);
    return out;
  };
}

function newPresentation(time: number): Presentation {
  return { damage: [0, 0, 0], hitSide: 1, hitAge: Infinity, floor: 0, stage: 'standing', time };
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

function updateFloor(
  s: Readonly<BoxingState>,
  who: BoxerId,
  out: Presentation,
  elapsed: number,
  terminal: boolean,
): void {
  const phase = s.phase === 'paused' ? s.pausedFrom : s.phase;
  const counted = phase === 'down' && s.down?.boxer === who;
  const fallTime = counted ? Math.max(elapsed, s.phaseT) : elapsed;
  out.floor = s.boxers[who].dizzy || counted || terminal ? smooth(fallTime / V.fallS) : 0;
  out.stage = out.floor > 0 ? (out.floor < 1 ? 'fall' : 'down') : 'standing';
  if (counted && s.down!.getUpAt < 10) {
    const riseEnd = s.down!.getUpAt * C.knockdown.countS;
    const riseS = Math.min(V.riseS, riseEnd - V.fallS);
    const k = smooth((s.phaseT - (riseEnd - riseS)) / riseS);
    if (k > 0) {
      out.floor *= 1 - k;
      out.stage = 'rise';
    }
  }
}
