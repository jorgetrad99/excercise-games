// Local 2-player (PLAN §2.5): split a multi-pose frame into one frame per player by screen zone, and
// decide when both runs pause. MediaPipe gives no identity across frames, so identity = which half of
// the MIRRORED frame a body is in (left half = P1).
import type { Landmark, PoseFrame } from './types';

/** Shoulders and hips: the torso center is steadier than any single point. */
const TORSO = [11, 12, 23, 24];

/** Mirrored (screen) x of the torso center; null unless all four torso landmarks are visible, the
 *  same presence rule the gesture engine uses (body.ts measure), so "a body" means one thing. */
export function screenX(pose: readonly Landmark[], visibilityMin: number): number | null {
  const xs = TORSO.map((i) => pose[i]);
  if (xs.some((l) => !l || l.visibility < visibilityMin)) return null;
  return 1 - xs.reduce((sum, l) => sum + l!.x, 0) / xs.length;
}

export interface SplitterOptions {
  visibilityMin: number;
  /** A lone body must cross the center line by this much (normalized x) to change player. */
  hysteresis: number;
  /** A player's last position is remembered this long (ms) through detector misses. */
  forgetMs: number;
}

/** Returns frame → [P1 frame, P2 frame]; a player with no body gets `poses: []`. */
export function createPlayerSplitter({ visibilityMin, hysteresis, forgetMs }: SplitterOptions) {
  /** Where and when each player was last seen. */
  const seen: { x: number; t: number }[] = [
    { x: 0, t: -Infinity },
    { x: 0, t: -Infinity },
  ];

  return (frame: PoseFrame): [PoseFrame, PoseFrame] => {
    const bodies = frame.poses
      .map((pose) => ({ pose, x: screenX(pose, visibilityMin) }))
      .filter((b): b is { pose: Landmark[]; x: number } => b.x !== null)
      .sort((a, b) => a.x - b.x);
    const slots: [(typeof bodies)[number] | null, (typeof bodies)[number] | null] = [null, null];
    if (bodies.length >= 2) {
      // ponytail: > 2 bodies keeps the outermost two; numPoses is 2, so it can't happen today
      slots[0] = bodies[0]!;
      slots[1] = bodies.at(-1)!;
    } else if (bodies.length === 1) {
      const last = seen.map((p) => (frame.t - p.t <= forgetMs ? p.x : null));
      const { side, near } = loneSide(bodies[0]!.x, last, hysteresis);
      // It crossed over: that body is no longer at its old slot, so don't match against it again.
      if (near !== null && near !== side) seen[near]!.t = -Infinity;
      slots[side] = bodies[0]!;
    }
    slots.forEach((b, i) => b && Object.assign(seen[i]!, { x: b.x, t: frame.t }));
    return [0, 1].map((i) => ({ ...frame, poses: slots[i] ? [slots[i]!.pose] : [] })) as [
      PoseFrame,
      PoseFrame,
    ];
  };
}

/** A lone body keeps the player it was nearest to recently until it clearly crosses the center.
 *  ponytail: the threshold is the fixed center line; if both players stood in the same half, the
 *  survivor can switch player without crossing it. Use the midpoint of the two last positions if
 *  playtests show that. */
function loneSide(
  x: number,
  last: readonly (number | null)[],
  h: number,
): { side: 0 | 1; near: 0 | 1 | null } {
  const d = last.map((lx) => (lx === null ? Infinity : Math.abs(lx - x)));
  if (d[0] === Infinity && d[1] === Infinity) return { side: x < 0.5 ? 0 : 1, near: null };
  if (d[0]! <= d[1]!) return { side: x > 0.5 + h ? 1 : 0, near: 0 };
  return { side: x < 0.5 - h ? 0 : 1, near: 1 };
}

/**
 * "If only one pose is visible for > holdMs, pause both" (PLAN §2.5). Feed it per frame how many
 * players have a body; it returns PAUSE once when the hold passes and RESUME once both are back.
 */
export function createPauseBoth(holdMs: number) {
  let missingSince: number | null = null;
  let paused = false;
  return (t: number, visible: number): 'PAUSE' | 'RESUME' | null => {
    if (visible >= 2) {
      missingSince = null;
      if (!paused) return null;
      paused = false;
      return 'RESUME';
    }
    missingSince ??= t;
    if (paused || t - missingSince <= holdMs) return null;
    paused = true;
    return 'PAUSE';
  };
}
