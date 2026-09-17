import { Quaternion, Vector3, type Bone, type Object3D } from 'three';
import type { BoxingState, BoxerId } from '../../core/boxing/types';
import type { Rig } from '../skater';
import type { LiveExpression } from './live-pose';
import type { Presentation } from './presentation';
import { boxingVisual as V } from './visual.config';

export interface HeadReaction {
  duration: number;
  times: number[];
  values: number[];
}
const JOINTS = { torso: 'Torso', head: 'Head', hips: 'Hips' } as const;

/** Apply character-space rotations after the base pose. Reactions compose with live pose input. */
function rotate(root: Object3D, bone: Object3D, delta: Quaternion): void {
  root.updateWorldMatrix(true, true);
  const frame = root.getWorldQuaternion(new Quaternion());
  const parent = bone.parent!.getWorldQuaternion(new Quaternion());
  const turn = parent
    .clone()
    .invert()
    .multiply(frame)
    .multiply(delta)
    .multiply(frame.invert())
    .multiply(parent);
  bone.quaternion.premultiply(turn);
}

const Y = new Vector3(0, 1, 0);
const snap = new Quaternion();
const mirrored = new Quaternion();
const kickQ = new Quaternion();

/** UAL `Hit_Head` turns the head toward the character's left (+x), as from a blow to the right cheek
 * (measured on the rig). A blow to the left cheek (`hitSide` +1) mirrors it across the sagittal plane;
 * a chin shot keeps only its pitch (halfway between both sides). */
function reactionAt(clip: HeadReaction, age: number, hitSide: number, out: Quaternion): Quaternion {
  if (age < 0 || age >= clip.duration) return out.identity();
  const k = (age / clip.duration) * (clip.times.length - 1),
    i = Math.floor(k);
  out.fromArray(clip.values, i * 4).slerp(snap.fromArray(clip.values, (i + 1) * 4), k - i);
  mirrored.set(out.x, -out.y, -out.z, out.w);
  return hitSide > 0 ? out.copy(mirrored) : hitSide === 0 ? out.slerp(mirrored, 0.5) : out;
}

export function createBoxerAnimation(r: Rig, reaction: HeadReaction) {
  const bones: Bone[] = [];
  r.body.traverse((o) => {
    if ('isBone' in o) bones.push(o as Bone);
  });
  const clean = bones.map((b) => ({
    q: b.quaternion.clone(),
    p: b.position.clone(),
    s: b.scale.clone(),
  }));
  const head = r.body.getObjectByName('Head');
  return (
    s: Readonly<BoxingState>,
    who: BoxerId,
    v: Presentation,
    figure: Object3D,
    live?: LiveExpression | null,
  ): void => {
    bones.forEach((b, i) => {
      const c = clean[i]!;
      b.quaternion.copy(c.q);
      b.position.copy(c.p);
      b.scale.copy(c.s);
    });
    if (v.stage === 'rise') recovery(r, bones, v.floor, figure);
    else if (v.floor > 0) r.show('Death', r.duration('Death') * 0.95 * v.floor);
    else {
      const winner = s.phase === 'over' && s.winner === who;
      r.show(
        winner ? 'Wave' : 'Idle_Neutral',
        v.time % r.duration(winner ? 'Wave' : 'Idle_Neutral'),
      );
      const duck = s.boxers[who].dodge === 'duck' ? 1 : 0;
      r.bend(0.35 + duck * 0.9, 0.7 + duck * 1.3, 0.2 + duck * 0.4);
      figure.position.y = -0.06 + Math.sin(v.time * 7) * 0.012 - duck * 0.15;
    }
    bones.forEach((b, i) => {
      const c = clean[i]!;
      c.q.copy(b.quaternion);
      c.p.copy(b.position);
      c.s.copy(b.scale);
    });
    if (live && live.weight > 1e-3 && v.floor === 0) applyLive(r.body, live);
    if (head && v.floor === 0) {
      rotate(r.body, head, reactionAt(reaction, v.hitAge, v.hitSide, kickQ));
      const kick = Math.sin(Math.min(1, v.hitAge / V.hitS) * Math.PI) * Math.exp(-v.hitAge * 3);
      // Turn away from the blow: a hit on the left cheek (+1) yaws the face toward -x.
      if (Number.isFinite(kick))
        rotate(r.body, head, kickQ.setFromAxisAngle(Y, -v.hitSide * kick * 0.4));
    }
    for (const name of ['UpperArmL', 'UpperArmR'])
      r.body.getObjectByName(name)?.scale.setScalar(0.001);
  };
}

/** Live torso/hips/head turns in character axes, each absolute from the animated pose: `base` is read
 * before any joint moves, so the head doesn't inherit the torso turn (PoseState head is camera-relative).
 * Arms stay collapsed (armless gloves), so arm swings drive glove offsets in boxer.ts instead of bones. */
const TURNED = ['hips', 'torso', 'head'] as const;
const frame = new Quaternion();
const parentQ = new Quaternion();
const bases = TURNED.map(() => new Quaternion());
function applyLive(body: Object3D, live: LiveExpression): void {
  body.updateWorldMatrix(true, true);
  body.getWorldQuaternion(frame);
  const bones = TURNED.map((joint) => body.getObjectByName(JOINTS[joint]));
  bones.forEach((bone, i) => bone?.getWorldQuaternion(bases[i]!));
  bones.forEach((bone, i) => {
    if (!bone?.parent) return;
    const turn = live[TURNED[i]!];
    // world = frame · turn · frame⁻¹ · base; local = parentWorld⁻¹ · world
    const world = bases[i]!.premultiply(parentQ.copy(frame).invert())
      .premultiply(turn)
      .premultiply(frame);
    bone.parent.updateWorldMatrix(true, false);
    bone.quaternion.copy(bone.parent.getWorldQuaternion(parentQ).invert().multiply(world));
  });
}

/** Authored recovery: fallen pose → planted crouch → standing. UAL Standard has no get-up clip. */
function recovery(r: Rig, bones: Bone[], floor: number, figure: Object3D): void {
  r.show('Death', r.duration('Death') * 0.95);
  const fallen = bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));
  r.show('Idle_Neutral', 0);
  const progress = 1 - floor,
    stand = Math.max(0, (progress - 0.65) / 0.35);
  r.bend(0.35 + (1 - stand) * 0.9, 0.7 + (1 - stand) * 1.3, 0.2 + (1 - stand) * 0.4);
  const blend = Math.min(1, progress / 0.65);
  bones.forEach((b, i) => {
    b.position.lerpVectors(fallen[i]!.p, b.position.clone(), blend);
    b.quaternion.slerpQuaternions(fallen[i]!.q, b.quaternion.clone(), blend);
  });
  figure.position.y = (-0.06 - (1 - stand) * 0.15) * blend;
}
