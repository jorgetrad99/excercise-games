// TEMPORARY(synthetic-fixtures): hand-built pose sequences standing in for per-gesture recordings.
// Replace with Jorge's fixtures/pose/{lean-left-right,jump,crouch,idle,two-players}.json when they exist;
// grep "TEMPORARY(synthetic-fixtures)" to find every test that uses this.
import type { PoseFixture } from '../recorder';
import type { Landmark, PoseFrame } from '../types';

/** Offsets from a neutral stance. Units: normalized image coords (1 = full frame), at scale 1. */
export interface Stance {
  /** Upper-body shift in SCREEN (mirrored) terms: negative = toward screen-left = player's left. */
  lean?: number;
  /** Whole-body rise (jump): positive = up. */
  rise?: number;
  /** Crouch: head drops this much; shoulders 90 %, hips 50 %. */
  crouch?: number;
  armsUp?: boolean;
  tPose?: boolean;
  /** false = no pose detected in the frame. */
  visible?: boolean;
  /** Distance from camera: 0.6 = further away (smaller). */
  scale?: number;
  /** Whole-body shift in screen terms (zones mode walks). */
  walk?: number;
}

// Neutral stance, raw (unmirrored) coordinates: the person's left side is at larger x.
// Torso ≈ 0.30 tall, shoulders 0.12 wide ≈ a full-body player ~2.5 m from a 16:9 camera.
const NEUTRAL = {
  nose: [0.5, 0.25],
  lShoulder: [0.56, 0.35],
  rShoulder: [0.44, 0.35],
  lElbow: [0.58, 0.47],
  rElbow: [0.42, 0.47],
  lWrist: [0.59, 0.58],
  rWrist: [0.41, 0.58],
  lHip: [0.54, 0.65],
  rHip: [0.46, 0.65],
} as const;
const INDEX = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
};

function noise(seed: number): number {
  // deterministic ±1 jitter; Math.random would make tests flaky
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export function syntheticPose(s: Stance, seed = 0, jitter = 0.002): Landmark[] | null {
  if (s.visible === false) return null;
  const pts: Record<string, [number, number]> = Object.fromEntries(
    Object.entries(NEUTRAL).map(([k, v]) => [k, [v[0], v[1]]]),
  );
  if (s.armsUp)
    Object.assign(pts, {
      lWrist: [0.55, 0.12],
      rWrist: [0.45, 0.12],
      lElbow: [0.6, 0.22],
      rElbow: [0.4, 0.22],
    });
  if (s.tPose)
    Object.assign(pts, {
      lWrist: [0.8, 0.35],
      rWrist: [0.2, 0.35],
      lElbow: [0.68, 0.35],
      rElbow: [0.32, 0.35],
    });
  const upper = new Set(['nose', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lWrist', 'rWrist']);
  const scale = s.scale ?? 1;
  const out: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.8,
    z: 0,
    visibility: 0.9,
  }));
  for (const [name, [x0, y0]] of Object.entries(pts)) {
    const crouchK = name === 'nose' ? 1 : name.includes('Hip') ? 0.5 : 0.9;
    // screen-left lean = raw x increases
    let x = x0 - (s.lean ?? 0) * (upper.has(name) ? 1 : 0.3) - (s.walk ?? 0);
    let y = y0 - (s.rise ?? 0) + (s.crouch ?? 0) * crouchK;
    x = 0.5 + (x - 0.5) * scale;
    y = 0.6 + (y - 0.6) * scale;
    const i = INDEX[name as keyof typeof INDEX];
    out[i] = {
      x: x + noise(seed + i) * jitter,
      y: y + noise(seed * 7 + i) * jitter,
      z: 0,
      visibility: 0.95,
    };
  }
  return out;
}

export interface Key {
  /** Duration (ms) to move from the previous stance to this one (linear), then it holds. */
  ms: number;
  to: Stance;
}

const lerp = (a = 0, b = 0, k: number) => a + (b - a) * k;

/** Keyframed stances sampled at `fps` → PoseFrames. Numbers interpolate; booleans hold for the whole segment. */
export function script(
  keys: Key[],
  opts: { fps?: number; jitter?: number; base?: Stance } = {},
): PoseFrame[] {
  const dt = 1000 / (opts.fps ?? 30);
  const frames: PoseFrame[] = [];
  let from: Stance = { ...opts.base };
  let t = 0;
  for (const { ms, to } of keys) {
    const target = { ...opts.base, ...to };
    const start = t;
    for (; t < start + ms; t += dt) {
      const k = (t - start) / ms;
      const s: Stance = {
        ...target,
        lean: lerp(from.lean, target.lean, k),
        rise: lerp(from.rise, target.rise, k),
        crouch: lerp(from.crouch, target.crouch, k),
        walk: lerp(from.walk, target.walk, k),
        scale: lerp(from.scale ?? 1, target.scale ?? 1, k),
      };
      const pose = syntheticPose(s, frames.length, opts.jitter);
      frames.push({ t: Math.round(t * 10) / 10, poses: pose ? [pose] : [] });
    }
    from = target;
  }
  return frames;
}

export const fixture = (frames: PoseFrame[]): PoseFixture => ({
  version: 1,
  recordedAt: '2026-09-16T00:00:00.000Z',
  model: 'full',
  video: { width: 1280, height: 720 },
  frames,
});

/** Stand still long enough to calibrate (2 s + margin). */
export const CALIBRATE: Key = { ms: 2500, to: {} };
/** A quick jump: up 0.08 (≈0.27 torso) in 150 ms, down in 200 ms. */
export const JUMP: Key[] = [
  { ms: 150, to: { rise: 0.08 } },
  { ms: 200, to: { rise: 0 } },
  { ms: 400, to: {} },
];
