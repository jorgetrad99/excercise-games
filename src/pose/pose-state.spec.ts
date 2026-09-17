import { Euler, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { measure, type Body, type Point } from './body';
import { createGestureEngine, type SignalFrame } from './gestures';
import { gestureConfig } from './gestures.config';
import { derivePoseState, quatFromEuler, quatFromUnitVectors } from './pose-state';
import real from './testdata/real-skate-2-10s.json';
import type { Landmark, PoseFrame } from './types';

const video = () => ({ width: 1280, height: 720 });

/** The committed excerpt of Jorge's real recording back to PoseFrames (only the used landmarks). */
function realFrames(): PoseFrame[] {
  return real.frames.map(([t, ...v]) => {
    if (v.length === 0) return { t: t!, poses: [] };
    const pose: Landmark[] = Array.from({ length: 33 }, () => ({
      x: 0,
      y: 0,
      z: 0,
      visibility: 0,
    }));
    real.landmarks.forEach((index, k) => {
      const [x, y, z, visibility] = v.slice(k * 4, k * 4 + 4) as [number, number, number, number];
      pose[index] = { x, y, z, visibility };
    });
    return { t: t!, poses: [pose] };
  });
}

function replay(frames: PoseFrame[]): { signals: SignalFrame; types: string[] }[] {
  const engine = createGestureEngine({ video });
  return frames.map((f) => {
    const r = engine.push(f);
    return { signals: r.signals, types: r.events.map((e) => e.type) };
  });
}

const near = (a: readonly number[], b: readonly number[]) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

describe('pose state — quaternion conventions match three.js', () => {
  it('Euler YXZ and unit-vector swings', () => {
    const q = new Quaternion().setFromEuler(new Euler(0.3, -0.7, 0.2, 'YXZ'));
    near(quatFromEuler(0.3, -0.7, 0.2), q.toArray());
    const down = { x: 0, y: -1, z: 0 };
    for (const to of [
      { x: 0, y: 0, z: 1 },
      { x: 0.6, y: 0.8, z: 0 },
      { x: 0, y: 1, z: 0 }, // opposite: still a valid rotation onto the target
    ]) {
      const got = new Quaternion().fromArray(quatFromUnitVectors(down, to));
      const v = new Vector3(0, -1, 0).applyQuaternion(got);
      near(v.toArray(), [to.x, to.y, to.z]);
    }
  });
});

describe('pose state — real recording (Jorge, Skate Run session)', () => {
  const out = replay(realFrames());
  const at = (t: number) => out.find((o) => o.signals.t >= t)!.signals.pose!;

  it('calibrates, then a pose state every frame with a body', () => {
    const cal = out.findIndex((o) => o.types.includes('CALIBRATED'));
    expect(cal).toBeGreaterThan(0);
    expect(out.slice(cal).every((o) => o.signals.pose !== null)).toBe(true);
    expect(out.slice(0, cal).every((o) => o.signals.pose === null)).toBe(true);
  });

  it('hanging arms point down, straight, no reach; the anatomical left arm hangs on +x', () => {
    // Was 8750. The arm landmarks are unfiltered now (PLAN-BOXING §2.1): the same hanging, no-reach pose
    // reads one frame earlier (t 8716.6), because the old One Euro lag had shifted it by a frame (33 ms). By 8750
    // the GRAB raise has started (right forearm y −0.68, −0.44 at 8800). Same thresholds.
    const p = at(8710);
    const [l, r] = p.arms;
    for (const a of [l!, r!]) {
      expect(a.upper.y).toBeLessThan(-0.8);
      expect(a.fore.y).toBeLessThan(-0.7);
      expect(a.extension).toBeGreaterThan(0.9);
      expect(a.reach).toBeLessThan(0.1);
    }
    expect(l!.upper.x).toBeGreaterThan(0.2); // the player's left = +x
    expect(r!.upper.x).toBeLessThan(-0.2);
  });

  it('GRAB (both arms up): forearms point up', () => {
    const grab = out.find((o) => o.types.includes('GRAB'))!.signals.t;
    const p = at(grab + 150);
    for (const a of p.arms) expect(a!.fore.y).toBeGreaterThan(0.5);
  });

  it('LANE_LEFT = sway toward the player left (+); facing the camera keeps torso yaw small', () => {
    const lane = out.find((o) => o.types.includes('LANE_LEFT'))!.signals;
    expect(lane.pose!.body.sway).toBeGreaterThan(0.3);
    const yaws = out.flatMap((o) => (o.signals.pose ? [Math.abs(o.signals.pose.torso.yaw)] : []));
    yaws.sort((a, b) => a - b);
    expect(yaws[Math.floor(yaws.length / 2)]).toBeLessThan(0.2);
  });
});

describe('pose state — hand-built arm geometry (bone-length depth)', () => {
  // Unit image (aspect 1), torso 0.3 tall, shoulders 0.2 wide, calibrated at this size: 1 torso = 0.3.
  const T = 0.3;
  const calib = {
    shoulderX: 0.5,
    hipX: 0.5,
    hipY: 0.6,
    noseY: 0.2,
    torsoLen: T,
    shoulderWidth: 0.2,
    kneeY: null,
  };
  const cfg = gestureConfig;
  const [lSh, rSh] = [
    { x: 0.6, y: 0.3 },
    { x: 0.4, y: 0.3 },
  ];
  const body = (lElbow: Point, lWrist: Point): Body => ({
    nose: { x: 0.5, y: 0.2 },
    lEar: null,
    rEar: null,
    lShoulder: lSh,
    rShoulder: rSh,
    lElbow,
    rElbow: { x: 0.4, y: 0.3 + cfg.pose.upperArm * T },
    lWrist,
    rWrist: { x: 0.4, y: 0.3 + (cfg.pose.upperArm + cfg.pose.forearm) * T },
    lHip: { x: 0.56, y: 0.6 },
    rHip: { x: 0.44, y: 0.6 },
    lKnee: null,
    rKnee: null,
  });
  const state = (b: Body) =>
    derivePoseState({
      t: 0,
      body: b,
      m: measure(b, 1, cfg)!,
      calib,
      signals: { leanX: 0, headDrop: 0, hipRise: 0, fistL: 0, fistR: 0 },
      cfg,
    });

  it('guard (upper arm down, forearm up, both in the image plane): folded, no reach', () => {
    const elbow = { x: 0.6, y: 0.3 + cfg.pose.upperArm * T };
    const p = state(body(elbow, { x: 0.6, y: elbow.y - cfg.pose.forearm * T }));
    const l = p.arms[0]!;
    expect(l.reach).toBeLessThan(0.05);
    expect(l.extension).toBeLessThan(0.1);
    expect(l.fore.y).toBeCloseTo(1, 3);
    // Right arm hangs straight: rest pose, identity swing.
    near(p.arms[1]!.upperRot, [0, 0, 0, 1]);
  });

  it('straight punch at the camera (elbow and fist on the shoulder in 2D): full reach, forward', () => {
    const p = state(body({ x: 0.6, y: 0.301 }, { x: 0.6, y: 0.302 }));
    const l = p.arms[0]!;
    expect(l.reach).toBeGreaterThan(0.99);
    expect(l.extension).toBeGreaterThan(0.99);
    expect(l.fore.z).toBeGreaterThan(0.99);
  });

  it('halfway out: reach in between (the live channel between guard and full extension)', () => {
    const elbow = { x: 0.6, y: 0.3 + cfg.pose.upperArm * T * 0.5 };
    const l = state(body(elbow, { x: 0.6, y: elbow.y })).arms[0]!;
    expect(l.reach).toBeGreaterThan(0.3);
    expect(l.reach).toBeLessThan(0.99);
  });
});
