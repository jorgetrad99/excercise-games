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
  /** MediaPipe world landmarks, same order as `poses`: meters, origin at the hip midpoint, y down,
   *  x toward image right. Live frames and fixtures recorded after 2026-09-16 carry them; nothing
   *  consumes them yet (the boxing tuning tool compares their depth against the 2D bone model). */
  world?: Landmark[][];
  /** Live pipeline timestamps (performance.now ms) for latency measurement; absent in fixtures. */
  timing?: FrameTiming;
}

export interface FrameTiming {
  /** Driver capture time from requestVideoFrameCallback metadata, when the browser provides it. */
  captureT?: number | undefined;
  /** requestVideoFrameCallback fired on the main thread (= PoseFrame.t). */
  callbackT: number;
  /** Downscaled ImageBitmap ready, just before transfer to the worker. */
  bitmapT: number;
  /** Landmarks back on the main thread. */
  resultT: number;
  /** detectForVideo time inside the worker. */
  inferMs: number;
}

export type ModelVariant = 'lite' | 'full' | 'heavy';
