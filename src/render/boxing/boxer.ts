// A boxer: the Casual_Hoodie rig (CC0, shared with the skater) with its arms collapsed and two floating
// gloves, like Wii Sports' armless Miis. Everything is a pure function of BoxingState + sim time, so
// screenshots at a given tick are reproducible. Local frame: the boxer faces +z, its left is +x.
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Bone,
  type Object3D,
} from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { boxingConfig as C } from '../../core/boxing/boxing.config';
import type { Boxer, BoxerId, BoxingState, Fist } from '../../core/boxing/types';
import type { LoadedModel } from '../models';
import { rig } from '../skater';

const HEIGHT = 1.75;
type V3 = readonly [number, number, number];
/** Glove rest spots (boxer-local, m): [left, right]. Left = +x. */
const READY: readonly [V3, V3] = [
  [0.24, 1.2, 0.32],
  [-0.24, 1.2, 0.32],
];
const GUARD: readonly [V3, V3] = [
  [0.1, 1.48, 0.3],
  [-0.1, 1.48, 0.3],
];
/** Where a straight lands: the opponent's face. */
const REACH = 1.05;

export interface BoxerView {
  readonly object: Group;
  /** `self`: drawn from this boxer's own eyes (body hidden, gloves kept). */
  update(s: Readonly<BoxingState>, who: BoxerId, self: boolean): void;
  /** Eye position behind this boxer's head, world space (the player's camera). */
  eye(out: Vector3): Vector3;
}

const smooth = (k: number): number => k * k * (3 - 2 * k);

/** Glove position for one fist, boxer-local. */
function glovePos(b: Boxer, fist: Fist, hand: 0 | 1, out: Vector3): Vector3 {
  const guarding = b.guard && !b.dizzy;
  const rest = (guarding ? GUARD : READY)[hand];
  out.set(rest[0], rest[1], rest[2]);
  if (fist.phase === 'ready') return out;
  const k =
    fist.phase === 'out'
      ? smooth(Math.min(1, fist.t / C.punch.travelS))
      : 1 - smooth(Math.min(1, fist.t / C.punch.retractS));
  const side = hand === 0 ? 1 : -1;
  // aim.x > 0 = toward the puncher's right = local −x; hooks swing out on the way, uppercuts dip.
  const arc = Math.sin(Math.PI * k);
  out.x +=
    (side * 0.04 - rest[0]) * k - fist.aim.x * 0.25 * k + side * Math.abs(fist.aim.x) * 0.35 * arc;
  out.y += (1.5 - rest[1]) * k - Math.max(0, fist.aim.y) * 0.35 * arc;
  out.z += (REACH - rest[2]) * k;
  return out;
}

function stars(): Group {
  const g = new Group();
  const mat = new MeshStandardMaterial({
    color: '#ffd166',
    emissive: '#ffb703',
    emissiveIntensity: 0.8,
  });
  for (let i = 0; i < 3; i++) g.add(new Mesh(new SphereGeometry(0.045, 8, 6), mat));
  return g;
}

export function createBoxer(model: LoadedModel, color: string): BoxerView {
  const object = new Group();
  const body = rig({ scene: clone(model.scene), animations: model.animations });
  const figure = new Group(); // scales/turns the character without touching the rig's own root
  figure.add(body.body);
  const arms = ['UpperArmL', 'UpperArmR']
    .map((n) => body.body.getObjectByName(n) as Bone | undefined)
    .filter((b): b is Bone => !!b);
  const gloveMat = new MeshStandardMaterial({ color, roughness: 0.45 });
  const gloves = [0, 1].map(() => {
    const m = new Mesh(new SphereGeometry(0.12, 16, 12), gloveMat);
    m.castShadow = true;
    return m;
  });
  const dizzy = stars();
  object.add(figure, ...gloves, dizzy);

  return {
    object,
    update(s, who, self) {
      const b = s.boxers[who];
      const t = s.t;
      figure.scale.setScalar(HEIGHT / 1.83);
      figure.position.set(0, 0, 0);
      figure.rotation.set(0, 0, 0);
      figure.visible = !self;
      pose(s, who, t, body, figure);
      for (const arm of arms) arm.scale.setScalar(0.001); // armless, like a Mii
      // Sway and duck move the whole boxer (gloves too).
      const dodgeK = dodgeAmount(b);
      const side = b.dodge === 'left' ? 1 : b.dodge === 'right' ? -1 : 0;
      const down = s.phase === 'down' && s.down?.boxer === who;
      const lost = s.phase === 'over' && s.winner !== null && s.winner !== who;
      const floored = down || lost;
      placeGloves(gloves, b, self, floored);
      const recoil = Math.max(0, 1 - (t - b.hitT) / 0.25);
      object.position.set(
        side * 0.35 * dodgeK,
        b.dodge === 'duck' ? -0.35 * dodgeK : 0,
        -0.12 * recoil,
      );
      object.rotation.set(
        -0.15 * recoil,
        0,
        -side * 0.25 * dodgeK + (b.dizzy ? Math.sin(t * 5) * 0.08 : 0),
      );
      if (b.dodge === 'duck') for (const g of gloves) g.position.y -= 0.1 * dodgeK;
      dizzy.visible = b.dizzy && !floored;
      dizzy.children.forEach((star, i) => {
        const a = t * 4 + (i * Math.PI * 2) / 3;
        star.position.set(Math.cos(a) * 0.22, 1.95, Math.sin(a) * 0.22);
      });
    },
    eye(out) {
      return object.localToWorld(out.set(0, 1.62, -0.35));
    },
  };
}

/** Both gloves, boxer-local. `self`: the player's own view, where they sit low and wide. */
function placeGloves(gloves: readonly Mesh[], b: Boxer, self: boolean, floored: boolean): void {
  gloves.forEach((g, hand) => {
    g.visible = !floored;
    glovePos(b, b.fists[hand]!, hand as 0 | 1, g.position);
    // Own gloves sit low and wide (Wii's over-the-gloves view) so they never hide the opponent;
    // the offset fades out as the glove extends, so a punch still reaches the opponent's face.
    if (!self) return;
    const out = Math.min(1, Math.max(0, (g.position.z - 0.32) / (REACH - 0.32)));
    g.position.x *= 1.8 - 0.8 * out;
    g.position.y -= 0.32 * (1 - out);
  });
}

/** 0 → 1 → 0 over a dodge, with quick 0.1 s ramps. */
function dodgeAmount(b: Boxer): number {
  if (b.dodge === 'none') return 0;
  const elapsed = C.dodge.activeS - b.dodgeT;
  return Math.min(1, elapsed / 0.1, b.dodgeT / 0.1);
}

function pose(
  s: Readonly<BoxingState>,
  who: BoxerId,
  t: number,
  r: ReturnType<typeof rig>,
  figure: Object3D,
): void {
  const b = s.boxers[who];
  if (
    (s.phase === 'down' && s.down?.boxer === who) ||
    (s.phase === 'over' && s.winner !== null && s.winner !== who)
  ) {
    r.show('Death', r.duration('Death') * 0.95);
    return;
  }
  if (s.phase === 'over' && s.winner === who) {
    r.show('Wave', t % r.duration('Wave'));
    return;
  }
  r.show('Idle_Neutral', t % r.duration('Idle_Neutral'));
  // Boxer's bounce: knees bent, chest forward; deeper on a duck.
  const duck = b.dodge === 'duck' ? dodgeAmount(b) : 0;
  r.bend(0.35 + duck * 0.9, 0.7 + duck * 1.3, 0.2 + duck * 0.4);
  figure.position.y = -0.06 + Math.sin(t * 7) * 0.012 - duck * 0.15;
}
