// Live face crops for "big head" characters: each player's face cut out of the camera video around
// the pose landmarks we already track (nose, eyes, ears; no face model), into a small square canvas.
// The crop comes from the exact camera image the pose was computed on (pipeline snapshot), and its
// box goes through the landmarks' One Euro filter: steady when still, no lag on a fast sway.
import { gestureConfig } from './gestures.config';
import { createOneEuro } from './one-euro';
import type { Landmark, PoseFrame } from './types';

const SIZE = 192; // crop canvas px: the face is ~60–100 px in a 720p frame at 2.5 m, so no detail lost
const MIN_INTERVAL_MS = 66; // ≈15 crops/s is enough for a face; saves texture uploads
const VIS = 0.5;
const NOSE = 0;
const EYES = [2, 5];
const EARS = [7, 8];
/** Box side = ear-to-ear distance × this (whole head with some hair and chin). */
const EAR_SPAN = 2;
/** …or eye-to-eye × this, when an ear is hidden (head turned). */
const EYE_SPAN = 3.4;
/** Box center sits this fraction of the side above the nose (forehead is taller than the chin). */
const LIFT = 0.15;

interface Box {
  x: number;
  y: number;
  side: number;
}

/** Square crop box in video px for one pose, or null when the face isn't visible enough. */
export function faceBox(pose: readonly Landmark[], width: number, height: number): Box | null {
  const at = (i: number): { x: number; y: number } | null => {
    const l = pose[i];
    return l && l.visibility >= VIS ? { x: l.x * width, y: l.y * height } : null;
  };
  const nose = at(NOSE);
  if (!nose) return null;
  const span = (ids: number[], k: number): number | null => {
    const [a, b] = ids.map(at);
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) * k : null;
  };
  const side = span(EARS, EAR_SPAN) ?? span(EYES, EYE_SPAN);
  if (!side || side < 8) return null;
  return { x: nose.x, y: nose.y - side * LIFT, side };
}

/** Structurally the render layer's FaceFeed (render/face.ts). */
export function createFaceCrops(players: number) {
  const slots = Array.from({ length: players }, () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
    const filter = () => createOneEuro(gestureConfig.filter);
    return { canvas, fx: filter(), fy: filter(), fs: filter(), version: 0, lastT: -Infinity };
  });
  return {
    canvas: (player: number) => slots[player]?.canvas ?? null,
    /** 0 until the first crop; bumps on every new crop. */
    version: (player: number) => slots[player]?.version ?? 0,
    /** One PoseFrame per player (already split), and the camera image they were computed from. */
    update(image: HTMLCanvasElement, frames: readonly PoseFrame[]): void {
      const { width: w, height: h } = image;
      if (!w || !h) return;
      frames.forEach((frame, i) => {
        const slot = slots[i];
        const pose = frame.poses[0];
        if (!slot || !pose || frame.t - slot.lastT < MIN_INTERVAL_MS) return;
        const raw = faceBox(pose, w, h);
        if (!raw) return;
        // Filters run in image heights, the unit gestureConfig.filter is tuned in.
        const b = {
          x: slot.fx(raw.x / h, frame.t) * h,
          y: slot.fy(raw.y / h, frame.t) * h,
          side: slot.fs(raw.side / h, frame.t) * h,
        };
        const ctx = slot.canvas.getContext('2d')!;
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.save();
        ctx.beginPath(); // face oval; the corners stay transparent (the head mesh shows there)
        ctx.ellipse(SIZE / 2, SIZE / 2, SIZE * 0.4, SIZE * 0.48, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(image, b.x - b.side / 2, b.y - b.side / 2, b.side, b.side, 0, 0, SIZE, SIZE);
        ctx.restore();
        slot.lastT = frame.t;
        slot.version++;
        if (slot.version % 30 === 1) console.log('FACEDBG', slot.canvas.toDataURL());
      });
    },
  };
}
