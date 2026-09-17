// Landmarks → smoothed body points → per-frame measures (PLAN §2.2 "derived signals" inputs).
import type { GestureConfig } from './gestures.config';
import { createOneEuro } from './one-euro';
import type { PoseFrame } from './types';

export interface Point {
  x: number;
  y: number;
  /** MediaPipe relative depth (smaller = nearer the camera, roughly x's scale); tracked points only. */
  z?: number;
}

/** MediaPipe pose landmark indices we use. l/r = the PERSON's left/right. */
const PARTS = {
  nose: 0,
  lEar: 7,
  rEar: 8,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
} as const;
type Part = keyof typeof PARTS;
export type Body = Record<Part, Point | null>;
const PART_NAMES = Object.keys(PARTS) as Part[];

export interface VideoSize {
  width: number;
  height: number;
}

/**
 * Smooths each landmark with a One Euro filter in normalized image units (x scaled by the aspect
 * ratio so both axes are image heights: the same beta means the same speed sensitivity on x and y)
 * and applies the visibility rule:
 * visibility < visibilityMin is ignored, the last value is held ≤ holdLandmarkMs, then the point is lost (null).
 */
export function createBodyTracker(cfg: GestureConfig, video: () => VideoSize) {
  const tracks = new Map(
    PART_NAMES.map((p) => [
      p,
      {
        fx: createOneEuro(cfg.filter),
        fy: createOneEuro(cfg.filter),
        fz: createOneEuro(cfg.filter),
        value: null as Point | null,
        seenT: -Infinity,
      },
    ]),
  );
  return (frame: PoseFrame): Body => {
    // ponytail: first pose only; M6 assigns players by screen zone
    const pose = frame.poses[0];
    const { width, height } = video();
    const aspect = width / height;
    const body = {} as Body;
    for (const part of PART_NAMES) {
      const tr = tracks.get(part)!;
      const lm = pose?.[PARTS[part]];
      if (lm && lm.visibility >= cfg.visibilityMin) {
        if (frame.t - tr.seenT > cfg.holdLandmarkMs) {
          // re-acquired after being lost: don't glide in from a stale value
          tr.fx = createOneEuro(cfg.filter);
          tr.fy = createOneEuro(cfg.filter);
          tr.fz = createOneEuro(cfg.filter);
        }
        tr.value = {
          x: tr.fx(lm.x * aspect, frame.t) / aspect,
          y: tr.fy(lm.y, frame.t),
          z: tr.fz(lm.z * aspect, frame.t) / aspect, // z shares x's scale
        };
        tr.seenT = frame.t;
      } else if (frame.t - tr.seenT > cfg.holdLandmarkMs) {
        tr.value = null;
      }
      body[part] = tr.value;
    }
    return body;
  };
}

export interface Measures {
  shoulderCenter: Point;
  hipCenter: Point;
  nose: Point | null;
  lShoulder: Point;
  rShoulder: Point;
  /** The person's left / right wrist (boxing fists). */
  lWrist: Point | null;
  rWrist: Point | null;
  /** Lengths are in image-height units with x corrected by `aspect`, so they are true proportions. */
  torsoLen: number;
  shoulderWidth: number;
  aspect: number;
  armsUp: boolean;
  tPose: boolean;
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Null when shoulders or hips are missing: without them there is no scale reference. */
export function measure(body: Body, aspect: number, cfg: GestureConfig): Measures | null {
  const { lShoulder, rShoulder, lHip, rHip, nose, lWrist, rWrist } = body;
  if (!lShoulder || !rShoulder || !lHip || !rHip) return null;
  const dist = (a: Point, b: Point) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const shoulderCenter = mid(lShoulder, rShoulder);
  const hipCenter = mid(lHip, rHip);
  const torsoLen = dist(shoulderCenter, hipCenter);
  const shoulderWidth = dist(lShoulder, rShoulder);
  const extended = (wrist: Point | null, shoulder: Point): boolean =>
    !!wrist &&
    Math.abs(wrist.y - shoulder.y) < cfg.tPose.wristYTol * torsoLen &&
    Math.abs(wrist.x - shoulderCenter.x) * aspect >
      Math.abs(shoulder.x - shoulderCenter.x) * aspect + cfg.tPose.wristOut * shoulderWidth;
  return {
    shoulderCenter,
    hipCenter,
    nose,
    lShoulder,
    rShoulder,
    lWrist,
    rWrist,
    torsoLen,
    shoulderWidth,
    aspect,
    armsUp: !!(nose && lWrist && rWrist && lWrist.y < nose.y && rWrist.y < nose.y),
    tPose: extended(lWrist, lShoulder) && extended(rWrist, rShoulder),
  };
}
