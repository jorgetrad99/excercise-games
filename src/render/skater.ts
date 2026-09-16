// Skater: Quaternius "Casual_Hoodie" (CC0, rigged) on a procedural board. Clip choice and clip time
// are pure functions of SimState + render time, so screenshots at a given sim time are reproducible.
//   ride: Idle_Neutral + knees bent · air: tuck, Wave arm on GRAB · slide: deep crouch · crashed: Death
import {
  AnimationMixer,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type AnimationAction,
  type Bone,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import type { SimState } from '../core/types';
import type { RenderPose } from './interp';
import type { LoadedModel } from './models';

const HEIGHT = 1.75;
const DECK_TOP = 0.16;

export interface SkaterView {
  readonly object: Group;
  update(s: Readonly<SimState>, pose: RenderPose): void;
}

function buildBoard(): Group {
  const board = new Group();
  const deck = new Mesh(
    new BoxGeometry(0.3, 0.05, 1.0),
    new MeshStandardMaterial({ color: '#2a9d8f', roughness: 0.6 }),
  );
  deck.position.y = 0.13;
  const grip = new Mesh(
    new BoxGeometry(0.28, 0.01, 0.96),
    new MeshStandardMaterial({ color: '#222', roughness: 1 }),
  );
  grip.position.y = 0.16;
  board.add(deck, grip);
  const wheel = new MeshStandardMaterial({ color: '#f4f1de' });
  for (const [x, z] of [
    [-0.12, -0.33],
    [0.12, -0.33],
    [-0.12, 0.33],
    [0.12, 0.33],
  ] as const) {
    const w = new Mesh(new CylinderGeometry(0.05, 0.05, 0.05, 10).rotateZ(Math.PI / 2), wheel);
    w.position.set(x, 0.05, z);
    board.add(w);
  }
  board.traverse((o) => (o.castShadow = true));
  return board;
}

type Clip = 'Idle_Neutral' | 'Roll' | 'Death' | 'Wave' | 'Run';

function rig(model: LoadedModel) {
  const body = model.scene;
  body.traverse((o) => {
    o.castShadow = true;
    o.frustumCulled = false; // skinned bounds don't follow the animation
  });
  const mixer = new AnimationMixer(body);
  const actions = new Map<Clip, AnimationAction>();
  for (const clip of model.animations) {
    const action = mixer.clipAction(clip);
    action.play();
    action.setEffectiveWeight(0);
    actions.set(clip.name as Clip, action);
  }
  // GLTFLoader sanitizes node names: 'UpperLeg.L' is loaded as 'UpperLegL'.
  const bone = (name: string): Bone | undefined => body.getObjectByName(name) as Bone | undefined;
  const bones = {
    hips: bone('Hips'),
    torso: bone('Torso'),
    legs: [bone('UpperLegL'), bone('UpperLegR')],
    knees: [bone('LowerLegL'), bone('LowerLegR')],
  };
  const bent = [...bones.legs, ...bones.knees, bones.torso].filter((x): x is Bone => !!x);
  const clean = new Map(bent.map((x) => [x, x.quaternion.clone()]));
  /** Show `clip` at `time` seconds, all other clips off. */
  const show = (clip: Clip, time: number): void => {
    // The mixer only writes a bone when the clip value changes, so undo last frame's bends first or
    // they accumulate frame after frame.
    for (const [x, q] of clean) x.quaternion.copy(q);
    for (const [name, a] of actions) {
      a.setEffectiveWeight(name === clip ? 1 : 0);
      if (name === clip) a.time = time;
    }
    mixer.update(0);
    for (const [x, q] of clean) q.copy(x.quaternion);
  };
  /**
   * Crouch on top of the clip: thighs forward by `hip`, shins back by `knee`, torso forward by `lean`
   * (radians). Rotates about the character's sideways axis in world space, so the rig's own bone
   * axis conventions don't matter.
   */
  const bend = (hip: number, knee: number, lean = 0): void => {
    const turns: [Bone | undefined, number][] = [
      ...bones.legs.map((b) => [b, -hip] as [Bone | undefined, number]),
      ...bones.knees.map((b) => [b, knee] as [Bone | undefined, number]),
      [bones.torso, lean],
    ];
    for (const [b, angle] of turns) if (b && angle !== 0) rotateAboutSide(body, b, angle);
  };
  const duration = (c: Clip): number => actions.get(c)?.getClip().duration ?? 1;
  return { body, show, bend, duration };
}

type Rig = ReturnType<typeof rig>;

const sideAxis = new Vector3();
const qParent = new Quaternion();
const qTurn = new Quaternion();

/** Rotate `bone` by `angle` about the character's local +x axis, expressed in the bone's parent space. */
function rotateAboutSide(root: Object3D, bone: Bone, angle: number): void {
  root.updateWorldMatrix(true, true);
  sideAxis.set(1, 0, 0).transformDirection(root.matrixWorld);
  bone.parent!.getWorldQuaternion(qParent);
  sideAxis.applyQuaternion(qParent.invert());
  bone.quaternion.premultiply(qTurn.setFromAxisAngle(sideAxis, angle));
}

export function createSkater(model: LoadedModel): SkaterView {
  const object = new Group();
  const board = buildBoard();
  const r = rig(model);
  const figure = new Group(); // scales/turns the character without touching the rig's own root
  figure.add(r.body);
  object.add(board, figure);
  return {
    object,
    update(s, { x, y, t }) {
      object.position.set(x, y, 0);
      object.rotation.set(0, 0, -(x - s.targetLane * 2) * 0.1); // lean into lane changes
      figure.scale.setScalar(HEIGHT / 1.83);
      figure.position.set(0, DECK_TOP, 0);
      figure.rotation.set(0, Math.PI - 0.35, 0); // back to the camera, skate stance slightly open
      board.rotation.set(0, 0, 0);
      const hover = s.powerups.hoverboard > 0 || s.grace > 0;
      board.position.y = hover ? 0.25 + Math.sin(t * 8) * 0.05 : 0;
      poseFor(s, t, r, figure, board);
    },
  };
}

function poseFor(
  s: Readonly<SimState>,
  t: number,
  r: Rig,
  figure: Object3D,
  board: Object3D,
): void {
  if (!s.alive) {
    r.show('Death', r.duration('Death') * 0.95);
    figure.position.y = 0;
    return;
  }
  if (s.sliding) {
    // Deep crouch, chest over the knees: reads as ducking under the bar.
    r.show('Idle_Neutral', 0);
    r.bend(1.7, 2.3, 0.7);
    figure.position.y -= 0.55;
    return;
  }
  if (s.airborne) {
    r.show(s.grabbing ? 'Wave' : 'Idle_Neutral', s.grabbing ? 0.6 : 0.2);
    r.bend(1.1, 1.8, 0.3);
    figure.position.y += 0.05;
    board.rotation.x = Math.sin((t - s.jumpT) * 6) * 0.15;
    return;
  }
  r.show('Idle_Neutral', t % r.duration('Idle_Neutral'));
  r.bend(0.4, 0.8, 0.15);
  figure.position.y -= 0.1 + Math.sin(t * 14) * 0.01;
}
