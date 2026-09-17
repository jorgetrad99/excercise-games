// Glove collisions: what one glove touched this tick, from the boxers' real points (body.ts). No
// punch detection anywhere: a hit is a glove sphere entering the defender's head or torso sphere,
// swept over the tick using the motion RELATIVE to the target (a head moving into a glove counts, a head
// dodging out of its path doesn't). The sim (sim.ts) turns outcomes into rules: stamina, dizzy, knockdowns.
import { boxingConfig as C } from './boxing.config';
import { dot, fromRing, len, sub, sweep, toRing, v3 } from './body';
import type { BoxerId, BoxingState, HitTaken, V3 } from './types';

const B = C.body;
type RV3 = readonly [number, number, number];

export type Outcome =
  | { kind: 'hit'; part: HitTaken['part']; zone: HitTaken['zone']; speed: number }
  | { kind: 'block'; speed: number }
  | { kind: 'whiff' };

interface Target {
  part: 'head' | 'body' | 'glove';
  from: V3;
  to: V3;
  r: number;
}

/** The torso follows the head's lean halfway (a sway moves the shoulders more than the hips). */
const torsoAt = (head: RV3): V3 => [
  B.torso[0] + (head[0] - B.head[0]) * 0.5,
  B.torso[1] + (head[1] - B.head[1]) * 0.5,
  B.torso[2] + (head[2] - B.head[2]) * 0.5,
];

function targets(s: BoxingState, def: BoxerId): Target[] {
  const { prev, now } = s.boxers[def].body;
  const g = B.gloveRadiusM;
  return [
    { part: 'glove', from: v3(prev.gloves[0]), to: v3(now.gloves[0]), r: 2 * g },
    { part: 'glove', from: v3(prev.gloves[1]), to: v3(now.gloves[1]), r: 2 * g },
    { part: 'head', from: v3(prev.head), to: v3(now.head), r: B.headRadiusM + g },
    { part: 'body', from: torsoAt(prev.head), to: torsoAt(now.head), r: B.torsoRadiusM + g },
  ];
}

/** 0 = the defender's left, 1 = right, 2 = chin; `n` = defender-local unit normal toward the glove. */
function zoneOf(n: RV3, hand: 0 | 1): HitTaken['zone'] {
  if (n[1] < -0.45) return 2;
  if (Math.abs(n[0]) > 0.2) return n[0] > 0 ? 0 : 1;
  return hand === 0 ? 1 : 0; // straight on: a left hand lands on the defender's right side
}

/** Earliest target entered by the glove moving g0 → g1 (defender-local), with its closing speed. */
function firstContact(ts: Target[], g0: V3, g1: V3, dt: number) {
  let best: { target: Target; t: number; speed: number; n: V3 } | null = null;
  for (const target of ts) {
    const a = sub(g0, target.from);
    const b = sub(g1, target.to);
    const t = sweep(a, b, target.r);
    if (t === null || (best && t >= best.t)) continue;
    const at: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const l = len(at) || 1;
    const n: V3 = [at[0] / l, at[1] / l, at[2] / l];
    // Split the closing speed into the glove's own motion and the target's. Only the side that did
    // most of the closing strikes: a guard met by a punch doesn't also "punch" the attacker's glove,
    // and leaning into a resting glove isn't that glove's hit.
    const byGlove = -dot(sub(g1, g0), n) / dt;
    const byTarget = dot(sub(target.to, target.from), n) / dt;
    if (byGlove > byTarget && byGlove > 0) best = { target, t, speed: byGlove + byTarget, n };
  }
  return best;
}

/** Resolve glove `hand` of boxer `att` for this tick: contact latch, hit/block/whiff, bot perception. */
export function collideGlove(
  s: BoxingState,
  att: BoxerId,
  hand: 0 | 1,
  dt: number,
): Outcome | null {
  const def: BoxerId = att === 0 ? 1 : 0;
  const a = s.boxers[att];
  const contact = a.gloves[hand];
  const local0 = a.body.prev.gloves[hand];
  const local1 = a.body.now.gloves[hand];
  const g0 = fromRing(def, toRing(att, local0));
  const g1 = fromRing(def, toRing(att, local1));
  contact.closingT = (local1[2] - local0[2]) / dt > C.bot.seeSpeedMps ? contact.closingT + dt : 0;
  if (local1[2] < B.recoverZ) Object.assign(contact, { struck: false, spent: false });
  const ts = targets(s, def);
  if (contact.touching) {
    // One hit per contact: the glove must leave every target (with margin) before it can hit again.
    contact.touching = ts.some((t) => len(sub(g1, t.to)) <= t.r + B.releaseM);
    return null;
  }
  // One outcome per extension: a glove stopped by a guard doesn't slide on into the face as a second
  // punch. Pulling it back behind recoverZ (above) re-arms it.
  if (contact.struck || contact.spent) return null;
  const hit = firstContact(ts, g0, g1, dt);
  if (hit) {
    Object.assign(contact, { touching: true, struck: true });
    if (hit.target.part === 'glove') return { kind: 'block', speed: hit.speed };
    return { kind: 'hit', part: hit.target.part, zone: zoneOf(hit.n, hand), speed: hit.speed };
  }
  // A miss: the glove went out past the front of the defender's head and turned back without touching
  // anything (judged on the way back, so a hook still sweeping in isn't called early).
  const past = g1[2] <= s.boxers[def].body.now.head[2] + B.headRadiusM;
  if (!contact.spent && past && local1[2] < local0[2]) {
    contact.spent = true;
    return { kind: 'whiff' };
  }
  return null;
}
