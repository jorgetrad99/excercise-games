// Procedural skater + board placeholder (PLAN §1.3: don't block gameplay on art). Poses are pure
// functions of SimState, so screenshots at a given sim time are reproducible.
import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import type { SimState } from '../core/types';
import type { RenderPose } from './interp';

const mat = (color: string) => new MeshStandardMaterial({ color, roughness: 0.7 });
const SKIN = mat('#f1c27d');
const SHIRT = mat('#ff6b35');
const PANTS = mat('#1d3557');
const HELMET = mat('#ffd166');
const DECK = mat('#2a9d8f');
const WHEEL = mat('#f4f1de');

function part(geometry: BufferGeometry, material: MeshStandardMaterial, y = 0): Mesh {
  const m = new Mesh(geometry, material);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

/** A pivot group with the mesh hanging below (limbs) or sitting above (torso) the joint. */
function limb(length: number, radius: number, material: MeshStandardMaterial, down = true): Group {
  const g = new Group();
  g.add(
    part(
      new CapsuleGeometry(radius, length - 2 * radius, 4, 8),
      material,
      down ? -length / 2 : length / 2,
    ),
  );
  return g;
}

export interface SkaterView {
  readonly object: Group;
  update(s: Readonly<SimState>, pose: RenderPose): void;
}

interface Rig {
  object: Group;
  board: Group;
  body: Group;
  torso: Group;
  legL: Group;
  legR: Group;
  armL: Group;
  armR: Group;
}

function buildRig(): Rig {
  const object = new Group();
  const board = new Group();
  board.add(part(new BoxGeometry(0.34, 0.05, 1.0), DECK, 0.12));
  for (const [wx, wz] of [
    [-0.14, -0.33],
    [0.14, -0.33],
    [-0.14, 0.33],
    [0.14, 0.33],
  ] as const) {
    const wheel = part(
      new CylinderGeometry(0.05, 0.05, 0.05, 10).rotateZ(Math.PI / 2),
      WHEEL,
      0.05,
    );
    wheel.position.set(wx, 0.05, wz);
    board.add(wheel);
  }
  const body = new Group(); // hips pivot
  const legL = limb(0.8, 0.09, PANTS);
  const legR = limb(0.8, 0.09, PANTS);
  legL.position.set(-0.12, 0, -0.18);
  legR.position.set(0.12, 0, 0.18);
  const torso = limb(0.62, 0.17, SHIRT, false);
  const head = part(new SphereGeometry(0.15, 12, 10), SKIN, 0.78);
  head.add(part(new SphereGeometry(0.165, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), HELMET, 0.03));
  torso.add(head);
  const armL = limb(0.62, 0.06, SKIN);
  const armR = limb(0.62, 0.06, SKIN);
  armL.position.set(-0.24, 0.55, 0);
  armR.position.set(0.24, 0.55, 0);
  torso.add(armL, armR);
  body.add(legL, legR, torso);
  object.add(board, body);
  return { object, board, body, torso, legL, legR, armL, armR };
}

/** Riding pose: slight crouch, arm swing, bob. */
function ride(r: Rig, t: number): void {
  r.board.rotation.set(0, 0, 0);
  r.body.position.set(0, 0.95 + Math.sin(t * 14) * 0.02, 0);
  r.body.rotation.set(0, Math.PI / 8, 0);
  r.torso.rotation.set(-0.12, 0, 0);
  r.legL.rotation.set(0.25, 0, 0);
  r.legR.rotation.set(-0.2, 0, 0);
  const swing = Math.sin(t * 7) * 0.35;
  r.armL.rotation.set(swing, 0, 0.35);
  r.armR.rotation.set(-swing, 0, -0.35);
}

function slide(r: Rig): void {
  r.body.position.y = 0.5;
  r.torso.rotation.x = -0.9;
  r.legL.rotation.x = 1.3;
  r.legR.rotation.x = 1.1;
  r.armL.rotation.set(-1.2, 0, 0.5);
  r.armR.rotation.set(-1.2, 0, -0.5);
}

function air(r: Rig, s: Readonly<SimState>): void {
  r.body.position.y = 0.8;
  r.legL.rotation.x = 0.9;
  r.legR.rotation.x = 0.7;
  r.board.rotation.x = Math.sin((s.t - s.jumpT) * 6) * 0.2;
  r.armL.rotation.set(0, 0, 1.4);
  r.armR.rotation.set(0, 0, -1.4);
  if (s.grabbing) {
    r.torso.rotation.x = -0.7;
    r.armR.rotation.set(-2.2, 0, -0.2); // hand to the board
    r.armL.rotation.set(0, 0, 2.6); // other arm up
  }
}

export function createSkater(): SkaterView {
  const rig = buildRig();
  return {
    object: rig.object,
    update(s, { x, y, t }) {
      rig.object.position.set(x, y, 0);
      rig.object.rotation.set(0, 0, -(x - s.targetLane * 2) * 0.12); // lean into lane changes
      ride(rig, t);
      if (s.sliding) slide(rig);
      else if (s.airborne) air(rig, s);
      if (!s.alive) {
        rig.object.rotation.set(-1.2, 0, 0.6);
        rig.object.position.y = 0.2;
      }
      const hover = s.powerups.hoverboard > 0 || s.grace > 0;
      rig.board.position.y = hover ? 0.25 + Math.sin(t * 8) * 0.05 : 0;
    },
  };
}
