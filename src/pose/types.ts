/** MediaPipe normalized landmark: x/y in [0,1] of the raw (unmirrored) camera image, z = relative depth. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/**
 * One inference result. `t` = capture time in ms (performance.now clock).
 * `poses` order is not a stable identity across frames (PLAN §1.1): assign players by screen zone.
 */
export interface PoseFrame {
  t: number;
  poses: Landmark[][];
}

export type ModelVariant = 'lite' | 'full' | 'heavy';
