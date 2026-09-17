// Boxer bodies (player authority): where each boxer's head and gloves are, in metres. A pose-driven
// boxer's points are the player's (BODY input), extrapolated between pose frames; a keyboard/bot boxer
// is a puppet whose fists/guard/dodge states move the same points. Collision (collide.ts) only reads
// the result. Boxer-local frame: +x = its left, +y up, +z toward the opponent (boxing.config body).
import type { Aim } from '../input';
import { boxingConfig as C } from './boxing.config';
import type { Boxer, BodyPose, BodyTrack, BoxerId, Fist, V3 } from './types';

const B = C.body;
type RV3 = readonly [number, number, number];

export const v3 = (p: RV3): V3 => [p[0], p[1], p[2]];
export const sub = (a: RV3, b: RV3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: RV3, b: RV3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: RV3): number => Math.hypot(a[0], a[1], a[2]);

export const copyPose = (p: BodyPose): BodyPose => ({
  head: v3(p.head),
  gloves: [v3(p.gloves[0]), v3(p.gloves[1])],
});
const mapPose = (p: BodyPose, f: (v: V3, i: number) => V3): BodyPose => ({
  head: f(p.head, 0),
  gloves: [f(p.gloves[0], 1), f(p.gloves[1], 2)],
});

/** Boxer-local → ring. Boxer 0 stands at +z facing −z, boxer 1 at −z facing +z (render/boxing/view). */
export function toRing(who: BoxerId, p: RV3): V3 {
  const g = C.ring.gapM;
  return who === 0 ? [-p[0], p[1], g - p[2]] : [p[0], p[1], p[2] - g];
}
/** Ring → boxer-local. */
export function fromRing(who: BoxerId, p: RV3): V3 {
  const g = C.ring.gapM;
  return who === 0 ? [-p[0], p[1], g - p[2]] : [p[0], p[1], p[2] + g];
}

/**
 * First fraction in [0, 1] of the straight move a → b at which a point comes within `r` of the origin,
 * or null. Starting inside returns null (that contact began earlier). Swept, so a fast glove can't pass
 * through a head between ticks or pose frames.
 */
export function sweep(a: RV3, b: RV3, r: number): number | null {
  const d = sub(b, a);
  const c = dot(a, a) - r * r;
  const qa = dot(d, d);
  if (c <= 0 || qa === 0) return null;
  const qb = 2 * dot(a, d);
  const disc = qb * qb - 4 * qa * c;
  if (disc < 0) return null;
  const t = (-qb - Math.sqrt(disc)) / (2 * qa);
  return t >= 0 && t <= 1 ? t : null;
}

// ---- Puppet (keyboard / bot) ----

const READY: RV3 = [0.24, 1.2, 0.32];
const GUARD: RV3 = [0.1, 1.52, 0.45];
/** Where a key straight ends, left hand (right mirrors x): past the opponent's face centre. */
const STRAIGHT: RV3 = [0.04, 1.62, 1.5];
const smooth = (k: number): number => k * k * (3 - 2 * k);

/** 0 → 1 → 0 over a puppet dodge, with 0.1 s ramps. */
export function dodgeAmount(b: Boxer): number {
  if (b.dodge === 'none') return 0;
  return Math.min(1, (C.dodge.activeS - b.dodgeT) / 0.1, b.dodgeT / 0.1);
}

/** Puppet glove for one fist. `aim` keeps the input convention: +x = toward the puncher's right (−x here). */
function puppetGlove(b: Boxer, fist: Fist, hand: 0 | 1): V3 {
  const side = hand === 0 ? 1 : -1;
  const rest = b.guard && !b.dizzy ? GUARD : READY;
  const out: V3 = [side * rest[0], rest[1], rest[2]];
  if (fist.phase === 'ready') return out;
  const k =
    fist.phase === 'out'
      ? smooth(Math.min(1, fist.t / C.punch.travelS))
      : 1 - smooth(Math.min(1, fist.t / C.punch.retractS));
  const aim: Aim = fist.aim;
  const up = Math.max(0, aim.y);
  const end: V3 = [side * STRAIGHT[0] - aim.x * 0.3, STRAIGHT[1] - up * 0.2, STRAIGHT[2]];
  const arc = Math.sin(Math.PI * k);
  // A straight reaches face height in the first half of its depth, so from low hands it travels level
  // into the face instead of rising into the chin. Hooks swing wide on the way; uppercuts keep the slow
  // rise, dipping under a guard into the chin.
  const ky = up * k + (1 - up) * smooth(Math.min(1, 2 * k));
  out[0] += (end[0] - out[0]) * k + side * Math.abs(aim.x) * 0.35 * arc;
  out[1] += (end[1] - out[1]) * ky - up * 0.22 * arc;
  out[2] += (end[2] - out[2]) * k;
  return out;
}

export function puppetPose(b: Boxer): BodyPose {
  const d = dodgeAmount(b);
  const shift: V3 = [
    (b.dodge === 'left' ? 1 : b.dodge === 'right' ? -1 : 0) * C.dodge.swayM * d,
    b.dodge === 'duck' ? -C.dodge.duckM * d : 0,
    0,
  ];
  const at = (p: V3): V3 => [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]];
  return {
    head: at(v3(B.head)),
    gloves: [at(puppetGlove(b, b.fists[0], 0)), at(puppetGlove(b, b.fists[1], 1))],
  };
}

// ---- Tracking ----

export function newBodyTrack(): BodyTrack {
  const rest: BodyPose = {
    head: v3(B.head),
    gloves: [
      [READY[0], READY[1], READY[2]],
      [-READY[0], READY[1], READY[2]],
    ],
  };
  const zero: BodyPose = {
    head: [0, 0, 0],
    gloves: [
      [0, 0, 0],
      [0, 0, 0],
    ],
  };
  return {
    source: 'puppet',
    now: rest,
    prev: copyPose(rest),
    sample: null,
    vel: zero,
    sampleT: 0,
    age: 0,
  };
}

/** A new pose sample (BODY input at input time `t` ms). Velocity comes from the previous sample when
 *  they are close enough in time to be one motion. */
export function applySample(track: BodyTrack, body: BodyPose, t: number): void {
  const dtS = (t - track.sampleT) / 1000;
  const prev = track.sample;
  track.vel =
    prev && dtS > 0 && dtS <= 0.15
      ? mapPose(body, (p, i) => {
          const q = i === 0 ? prev.head : prev.gloves[i - 1]!;
          return [(p[0] - q[0]) / dtS, (p[1] - q[1]) / dtS, (p[2] - q[2]) / dtS];
        })
      : mapPose(body, () => [0, 0, 0]);
  track.sample = copyPose(body);
  track.sampleT = t;
  track.age = 0;
  track.source = 'pose';
}

/**
 * Advance one tick: prev ← now, now ← the newest observed sample, or the puppet. Collisions use only
 * observed positions: extrapolating a fast glove past its last frame would score hits the player never
 * made (a jab stopped 2 cm short read as a hit in collide.spec). Prediction is for drawing: predictPose.
 */
export function stepBody(b: Boxer, dt: number, paused = false): void {
  const track = b.body;
  track.prev = track.now;
  // Paused (tracking lost): hold the player's last pose (PLAN-BOXING S11), never hand it to the puppet.
  if (paused) return;
  track.age += dt;
  if (track.source === 'pose' && track.age > B.staleS) track.source = 'puppet';
  track.now = track.source === 'puppet' || !track.sample ? puppetPose(b) : copyPose(track.sample);
}

/** Where to DRAW the body now: the newest sample moved along its velocity by the time since it arrived
 *  (`extraS` = render time past the last tick), at most body.extrapolateS, then held. */
export function predictPose(track: BodyTrack, extraS = 0): BodyPose {
  if (track.source === 'puppet' || !track.sample) return track.now;
  const lead = Math.min(track.age + extraS, B.extrapolateS);
  const vel = track.vel;
  return mapPose(track.sample, (p, i) => {
    const v = i === 0 ? vel.head : vel.gloves[i - 1]!;
    return [p[0] + v[0] * lead, p[1] + v[1] * lead, p[2] + v[2] * lead];
  });
}
