// Is the camera stream mirrored? MediaPipe names left/right from how a body LOOKS (a frontal person's
// left is at larger image x), so a mirrored stream still puts landmark 11 at larger x: shoulder order
// can't tell. Only a side the player chose can. Protocol: hold the LEFT hand overhead for the first
// `windowMs` of the take. Restored from the removed boxing tuning tool (3157d58^).
import type { PoseFrame } from './types';

export type Handedness = 'ok' | 'SWAPPED' | 'unclear';

/** MediaPipe's index for the other side's landmark (eyes 1-3 ↔ 4-6, then left/right pairs). */
const other = (i: number): number =>
  i === 0 ? 0 : i <= 6 ? (i <= 3 ? i + 3 : i - 3) : i % 2 ? i + 1 : i - 1;

/** What MediaPipe reports for the horizontally flipped image: x → 1 − x, left/right labels swapped.
 *  Its own inverse, so it both simulates a mirrored stream and undoes one. */
export const mirrorFrame = (f: PoseFrame): PoseFrame => ({
  ...f,
  poses: f.poses.map((p) => p.map((_, i) => ({ ...p[other(i)]!, x: 1 - p[other(i)]!.x }))),
});

export function handedness(frames: readonly PoseFrame[], windowMs = 3000): Handedness {
  const t0 = frames[0]?.t ?? 0;
  let votes = 0;
  for (const f of frames) {
    if (f.t - t0 > windowMs) break;
    const p = f.poses[0];
    if (!p) continue;
    const [l, r, nose] = [p[15]!, p[16]!, p[0]!]; // image y grows down
    if (l.y < nose.y && r.y > nose.y) votes++;
    if (r.y < nose.y && l.y > nose.y) votes--;
  }
  return votes > 10 ? 'ok' : votes < -10 ? 'SWAPPED' : 'unclear';
}
