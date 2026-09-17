// Boxing fists: per-wrist speed signals and the guard posture. There is no punch detector: under player
// authority (PLAN-BOXING §2.5) a punch is the player's glove reaching the opponent, scored by collision
// in the sim. What stays here is a sustained-posture classifier (guard: both wrists near the nose, with
// hysteresis) and the wrist speed that PoseState reports (fistL / fistR).
// Guard is 2D: real wrist z sits a person-dependent ~1 torso behind the nose z (Jorge's recording).
// Speed can be measured against the arm's own shoulder instead of the nose (fists.reference).
import type { Measures, Point } from './body';
import type { GestureConfig } from './gestures.config';

/** Wrist relative to a reference point: torso lengths, x aspect-corrected, z on the same scale. */
interface Rel {
  t: number;
  x: number;
  y: number;
  z: number;
}

interface Hand {
  /** Wrist relative to the speed reference (fists.reference), newest last. */
  hist: Rel[];
  /** Latest 2D distance from the nose (torso), how far the wrist is below the nose (torso, − = above),
   *  and speed relative to the reference (torso/s). */
  dist: number;
  below: number;
  speed: number;
}

const newHand = (): Hand => ({ hist: [], dist: Infinity, below: -Infinity, speed: 0 });

export function newFists() {
  return { hands: [newHand(), newHand()] as [Hand, Hand], guard: false };
}
export type Fists = ReturnType<typeof newFists>;

export type FistEmit = (type: 'GUARD_START' | 'GUARD_END') => void;

function relative(
  t: number,
  wrist: Point | null,
  ref: Point,
  m: Measures,
  torso: number,
  zWeight: number,
): Rel | null {
  if (!wrist) return null;
  return {
    t,
    x: ((wrist.x - ref.x) * m.aspect) / torso,
    y: (wrist.y - ref.y) / torso,
    z: (((wrist.z ?? 0) - (ref.z ?? 0)) * m.aspect * zWeight) / torso,
  };
}

function updateHand(h: Hand, pos: Rel | null, rel: Rel | null, windowMs: number): void {
  if (!pos || !rel) {
    Object.assign(h, newHand());
    return;
  }
  let ref: Rel | undefined;
  for (const s of h.hist) if (s.t <= rel.t - windowMs) ref = s;
  ref ??= h.hist[0];
  h.hist.push(rel);
  while (h.hist.length > 0 && h.hist[0]!.t < rel.t - windowMs * 4) h.hist.shift();
  h.dist = Math.hypot(pos.x, pos.y);
  h.below = pos.y;
  h.speed =
    ref && rel.t > ref.t
      ? Math.hypot(rel.x - ref.x, rel.y - ref.y, rel.z - ref.z) / ((rel.t - ref.t) / 1000)
      : 0;
}

/** Per frame (calibrated only): update both wrists; returns the signal values. */
export function trackFists(f: Fists, t: number, m: Measures, torso: number, cfg: GestureConfig) {
  const { fists } = cfg;
  const nose = m.nose;
  const shoulders = [m.lShoulder, m.rShoulder];
  [m.lWrist, m.rWrist].forEach((w, i) => {
    const pos = nose ? relative(t, w, nose, m, torso, fists.zWeight) : null;
    const ref = fists.reference === 'nose' ? nose : shoulders[i]!;
    const rel = ref && relative(t, w, ref, m, torso, fists.zWeight);
    updateHand(f.hands[i]!, pos, rel, fists.velocityWindowMs);
  });
  const [l, r] = f.hands;
  return { fistL: l.speed, fistR: r.speed, guard: guardPosture(f, cfg, fists.guard.enter) };
}

/** Both wrists within `reach` of the nose and neither raised past the nose: a fist thrown at the face
 *  sits as close to the nose in 2D as a guard (B1 capture: 0.25–0.37 vs 0.24–0.26 torso), but above it. */
const guardPosture = (f: Fists, cfg: GestureConfig, reach: number): boolean =>
  f.hands.every((h) => h.dist < reach && h.below > -cfg.fists.guard.maxAboveNose);

/** Edge-triggered guard events from the state trackFists left this frame (posture, with hysteresis). */
export function detectGuard(f: Fists, cfg: GestureConfig, emit: FistEmit): void {
  if (!f.guard && guardPosture(f, cfg, cfg.fists.guard.enter)) {
    f.guard = true;
    emit('GUARD_START');
  } else if (f.guard && !guardPosture(f, cfg, cfg.fists.guard.exit)) {
    f.guard = false;
    emit('GUARD_END');
  }
}
