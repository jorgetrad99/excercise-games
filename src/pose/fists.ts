// Boxing fists (Piece 4): each wrist on its own. A punch is the wrist's 3D speed relative to the
// face (torso lengths/s) above a threshold once the fist has left the face zone; the event carries the
// motion's direction as `aim` instead of a punch-type classifier. Radial speed alone was rejected:
// hooks sweep around the head and uppercuts start toward the chin. A fired fist re-arms only when
// it is back near the face AND nearly still (the Wii "wait until the glove stops"), so the retraction
// can't fire. Guard = both wrists close to the nose, with hysteresis.
import type { Measures, Point } from './body';
import type { GestureConfig } from './gestures.config';

export interface Aim {
  x: number;
  y: number;
}

/** Wrist relative to the nose: torso lengths, x aspect-corrected, z on the same scale. */
interface Rel {
  t: number;
  x: number;
  y: number;
  z: number;
}

interface Hand {
  armed: boolean;
  hist: Rel[];
  /** Latest frame: distance from the nose (torso), speed relative to it (torso/s), motion direction. */
  dist: number;
  speed: number;
  aim: Aim;
}

const newHand = (): Hand => ({
  armed: false,
  hist: [],
  dist: Infinity,
  speed: 0,
  aim: { x: 0, y: 0 },
});

export function newFists() {
  return { hands: [newHand(), newHand()] as [Hand, Hand], guard: false };
}
export type Fists = ReturnType<typeof newFists>;

export type FistEmit = (
  type: 'PUNCH_LEFT' | 'PUNCH_RIGHT' | 'GUARD_START' | 'GUARD_END',
  aim?: Aim,
) => void;

function relative(
  t: number,
  wrist: Point | null,
  nose: Point,
  m: Measures,
  torso: number,
  zWeight: number,
): Rel | null {
  if (!wrist) return null;
  return {
    t,
    x: ((wrist.x - nose.x) * m.aspect) / torso,
    y: (wrist.y - nose.y) / torso,
    z: (((wrist.z ?? 0) - (nose.z ?? 0)) * m.aspect * zWeight) / torso,
  };
}

function updateHand(h: Hand, rel: Rel | null, windowMs: number): void {
  if (!rel) {
    Object.assign(h, { hist: [], dist: Infinity, speed: 0 });
    return;
  }
  let ref: Rel | undefined;
  for (const s of h.hist) if (s.t <= rel.t - windowMs) ref = s;
  ref ??= h.hist[0];
  h.hist.push(rel);
  while (h.hist.length > 0 && h.hist[0]!.t < rel.t - windowMs * 4) h.hist.shift();
  h.dist = Math.hypot(rel.x, rel.y, rel.z);
  if (!ref || rel.t <= ref.t) {
    h.speed = 0;
    return;
  }
  const [dx, dy, dz] = [rel.x - ref.x, rel.y - ref.y, rel.z - ref.z];
  const len = Math.hypot(dx, dy, dz);
  h.speed = len / ((rel.t - ref.t) / 1000);
  if (len === 0) return;
  // Image x grows toward the person's LEFT (unmirrored camera) and y grows down: flip both, so
  // +x = the puncher's right and +y = up.
  h.aim = { x: -dx / len, y: -dy / len };
}

/** Per frame (calibrated only): update both wrists; returns the signal values. */
export function trackFists(f: Fists, t: number, m: Measures, torso: number, cfg: GestureConfig) {
  const { fists } = cfg;
  const nose = m.nose;
  [m.lWrist, m.rWrist].forEach((w, i) =>
    updateHand(
      f.hands[i]!,
      nose ? relative(t, w, nose, m, torso, fists.zWeight) : null,
      fists.velocityWindowMs,
    ),
  );
  const [l, r] = f.hands;
  return { fistL: l.speed, fistR: r.speed, guard: Math.max(l.dist, r.dist) < fists.guard.enter };
}

/** Edge-triggered punch and guard events from the state trackFists left this frame. */
export function detectFists(f: Fists, cfg: GestureConfig, emit: FistEmit): void {
  const { fists } = cfg;
  f.hands.forEach((h, i) => {
    if (h.dist < fists.rearm && h.speed < fists.rearmSpeed) h.armed = true;
    // Dropping the hands fast is not a punch: mostly-downward motion never fires.
    if (h.armed && h.dist > fists.rearm && h.speed > fists.speed && h.aim.y > -fists.maxDown) {
      h.armed = false;
      emit(i === 0 ? 'PUNCH_LEFT' : 'PUNCH_RIGHT', {
        x: Math.round(h.aim.x * 100) / 100,
        y: Math.round(h.aim.y * 100) / 100,
      });
    }
  });
  const far = Math.max(f.hands[0].dist, f.hands[1].dist);
  if (!f.guard && far < fists.guard.enter) {
    f.guard = true;
    emit('GUARD_START');
  } else if (f.guard && far > fists.guard.exit) {
    f.guard = false;
    emit('GUARD_END');
  }
}
