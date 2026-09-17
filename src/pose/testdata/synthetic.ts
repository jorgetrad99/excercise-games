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
  /** true = knees out of frame (visibility 0). */
  kneesHidden?: boolean;
  /** Distance from camera: 0.6 = further away (smaller). */
  scale?: number;
  /** Whole-body shift in screen terms (zones mode walks). */
  walk?: number;
  /** Boxing arms: fists in front of the chest ('ready') or at the chin ('guard'). Held per segment. */
  fists?: 'ready' | 'guard';
  /** 0…1 extension from `fists`: straight at the camera, right hook across, left uppercut. */
  punchL?: number;
  punchR?: number;
  hookR?: number;
  upperL?: number;
}

/**
 * Boxing arms as a real 3D arm (so the bone-length depth model in pose-state.ts reads true reach):
 * wrist targets relative to the shoulder in character axes (+x = the person's left, +y up, +z toward
 * the camera), torso lengths, for the LEFT arm (the right mirrors x). An elbow is solved by two-bone IK
 * with the elbow hanging down, then everything is projected orthographically into the image.
 */
const ARM = { upper: 0.5, fore: 0.48 }; // = gestureConfig.pose defaults
const FISTS = {
  ready: [-0.12, -0.35, 0.55],
  guard: [-0.2, 0.28, 0.42],
  straight: [-0.12, 0.3, 0.92],
  hookR: [0.35, 0.3, 0.8], // RIGHT-arm vector, not mirrored: sweeping across toward the person's left
  upperL: [-0.15, 0.55, 0.72], // left fist rising toward the opponent's chin
} as const;
/** Image scale of one torso length (NEUTRAL shoulder y 0.35 → hip y 0.65) and the frame aspect. */
const TORSO_IMG = 0.3;
const ASPECT = 16 / 9;

type P3 = readonly [number, number, number];
const mix = (a: P3, b: P3, k: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

/** Elbow for a shoulder→wrist vector `w` (torso lengths): two-bone IK, pole straight down. */
function elbowFor(w: P3): P3 {
  const d = Math.min(Math.hypot(...w), ARM.upper + ARM.fore - 1e-6);
  const u = w.map((c) => c / (Math.hypot(...w) || 1)) as unknown as P3;
  const a = (ARM.upper ** 2 - ARM.fore ** 2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ARM.upper ** 2 - a * a));
  const down = -u[1]; // (0,-1,0)·u
  const pole: P3 = [0 - down * u[0], -1 - down * u[1], 0 - down * u[2]];
  const pl = Math.hypot(...pole) || 1;
  return [a * u[0] + (h * pole[0]) / pl, a * u[1] + (h * pole[1]) / pl, a * u[2] + (h * pole[2]) / pl];
}

/** Boxing elbows + wrists for a stance as image points [x, y, z], or null to keep hanging arms. */
function boxingArms(s: Stance, shoulders: { l: readonly number[]; r: readonly number[] }) {
  if (!s.fists) return null;
  const base = FISTS[s.fists];
  let l = mix(base, FISTS.straight, s.punchL ?? 0);
  l = mix(l, FISTS.upperL, s.upperL ?? 0);
  const mirror = (v: P3): P3 => [-v[0], v[1], v[2]]; // a left-arm vector onto the right arm
  let r = mix(mirror(base), mirror(FISTS.straight), s.punchR ?? 0);
  r = mix(r, FISTS.hookR, s.hookR ?? 0);
  const right: P3 = r;
  // Character +x (person's left) = raw image +x; +y up = image −y; +z toward the camera = MediaPipe −z.
  const img = (sh: readonly number[], v: P3): [number, number, number] => [
    sh[0]! + (v[0] * TORSO_IMG) / ASPECT,
    sh[1]! - v[1] * TORSO_IMG,
    -v[2] * (TORSO_IMG / ASPECT),
  ];
  return {
    lElbow: img(shoulders.l, elbowFor(l)),
    lWrist: img(shoulders.l, l),
    rElbow: img(shoulders.r, elbowFor(right)),
    rWrist: img(shoulders.r, right),
  };
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
  const arms = boxingArms(s, { l: NEUTRAL.lShoulder, r: NEUTRAL.rShoulder });
  // Real MediaPipe z is relative to the hip midpoint: the nose sits well in front of the wrists
  // (Jorge's recording: |wrist − nose| z ≈ 0.9 torso median).
  const depth: Record<string, number> = { nose: -0.3 };
  if (arms) {
    for (const k of ['lElbow', 'lWrist', 'rElbow', 'rWrist'] as const) {
      pts[k] = [arms[k][0], arms[k][1]];
      depth[k] = arms[k][2];
    }
  }
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
      z: (depth[name] ?? 0) * scale,
      visibility: 0.95,
    };
  }
  if (s.kneesHidden) for (const i of [25, 26]) out[i] = { ...out[i]!, visibility: 0 };
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
        punchL: lerp(from.punchL, target.punchL, k),
        punchR: lerp(from.punchR, target.punchR, k),
        hookR: lerp(from.hookR, target.hookR, k),
        upperL: lerp(from.upperL, target.upperL, k),
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

/** TEMPORARY(synthetic-fixtures): two-person frames standing in for two-players.json. screen-left body plays `left`,
 *  screen-right body plays `right`; both at `scale`, torso centers at screen x 0.27 / 0.73. Pose
 *  order alternates per frame, because MediaPipe's array order is no identity. */
export function scriptTwo(
  left: Key[],
  right: Key[],
  opts: { fps?: number; jitter?: number; scale?: number } = {},
): PoseFrame[] {
  const scale = opts.scale ?? 0.7;
  // synthetic walk is scaled along with the body: walk w puts the torso at 0.5 + w * scale
  const at = (x: number): Stance => ({ walk: (x - 0.5) / scale, scale });
  const a = script(left, { ...opts, base: at(0.27) });
  const b = script(right, { ...opts, base: at(0.73) });
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => {
    const poses = [...(a[i]?.poses ?? []), ...(b[i]?.poses ?? [])];
    return { t: (a[i] ?? b[i])!.t, poses: i % 2 ? poses.reverse() : poses };
  });
}
