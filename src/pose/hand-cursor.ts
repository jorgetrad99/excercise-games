// Kinect-style hand cursors for the menu: each body's raised hand → a 0..1 screen point, mapped from a
// box around that body's shoulders (a "physical interaction zone"), so nobody has to reach for the
// camera frame's edges. Plus the dwell timer that turns hovering into a selection. Pure: no DOM.
import type { GestureConfig } from './gestures.config';
import { createOneEuro } from './one-euro';
import { createPlayerSplitter } from './players';
import type { Landmark, PoseFrame } from './types';

/** Screen point, 0..1, mirrored like the camera preview; y grows down. */
export interface Cursor {
  x: number;
  y: number;
}

const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_WRIST = 15;
const R_WRIST = 16;
const clamp = (v: number): number => Math.min(1, Math.max(0, v));

/** Where one body's raised hand points, unsmoothed; null when no hand is raised or shoulders are missing. */
export function handPoint(
  pose: readonly Landmark[],
  aspect: number,
  cfg: GestureConfig,
): Cursor | null {
  const seen = (i: number): Landmark | null => {
    const l = pose[i];
    return l && l.visibility >= cfg.visibilityMin ? l : null;
  };
  const ls = seen(L_SHOULDER);
  const rs = seen(R_SHOULDER);
  if (!ls || !rs) return null;
  const width = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y);
  if (width === 0) return null;
  const cx = 1 - (ls.x + rs.x) / 2;
  const cy = (ls.y + rs.y) / 2;
  const { offset, drop, halfW, halfH, lowered } = cfg.cursor;
  let best: Cursor | null = null;
  let bestY = Infinity;
  // The person's left hand shows on screen-left in the mirrored view: its zone sits left of center.
  for (const [wrist, side] of [
    [seen(L_WRIST), -1],
    [seen(R_WRIST), 1],
  ] as const) {
    if (!wrist) continue;
    const dx = ((1 - wrist.x - cx) * aspect) / width;
    const dy = (wrist.y - cy) / width;
    if (dy > lowered || dy >= bestY) continue; // resting, or the other hand is higher
    bestY = dy;
    best = {
      x: clamp(0.5 + (dx - side * offset) / (2 * halfW)),
      y: clamp(0.5 + (dy - drop) / (2 * halfH)),
    };
  }
  return best;
}

/** frame → [P1 cursor, P2 cursor] (null = no raised hand). Bodies split by screen half, like 2P games. */
export function createHandCursors(cfg: GestureConfig) {
  const split = createPlayerSplitter({
    visibilityMin: cfg.visibilityMin,
    hysteresis: 0.06,
    forgetMs: cfg.trackingLostMs,
  });
  const filters = [0, 1].map(() => ({
    x: createOneEuro(cfg.cursor.filter),
    y: createOneEuro(cfg.cursor.filter),
    live: false,
  }));
  return (frame: PoseFrame, aspect: number): [Cursor | null, Cursor | null] =>
    split(frame).map((f, i) => {
      const flt = filters[i]!;
      const p = f.poses[0] ? handPoint(f.poses[0], aspect, cfg) : null;
      if (!p) {
        flt.live = false;
        return null;
      }
      if (!flt.live)
        Object.assign(flt, {
          x: createOneEuro(cfg.cursor.filter),
          y: createOneEuro(cfg.cursor.filter),
          live: true,
        });
      return { x: flt.x(p.x, frame.t), y: flt.y(p.y, frame.t) };
    }) as [Cursor | null, Cursor | null];
}

/** Hover-to-select for one cursor: `fire` is true once after `ms` on the same target; leaving re-arms. */
export function createDwell(ms: number) {
  let target: string | null = null;
  let since = 0;
  let fired = false;
  return (t: number, next: string | null): { progress: number; fire: boolean } => {
    if (next !== target) {
      target = next;
      since = t;
      fired = false;
    }
    const progress = target === null || fired ? 0 : Math.min(1, (t - since) / ms);
    const fire = progress >= 1;
    if (fire) fired = true;
    return { progress, fire };
  };
}
