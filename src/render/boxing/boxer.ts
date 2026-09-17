// A boxer: the Casual_Hoodie rig (CC0, shared with the skater) with its arms collapsed and two floating
// gloves. Clip times follow the sim; presentation history keeps per-boxer bruises and fall timing.
// Repeated draws at one tick are stable. Local frame: the boxer faces +z, its left is +x.
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3 as Vec,
  type Object3D,
  type Vector3,
} from 'three';
import type { RigProbe } from '../view';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { boxingConfig as C } from '../../core/boxing/boxing.config';
import type { Boxer, BoxerId, BoxingState, Fist } from '../../core/boxing/types';
import { createBigHead, type FaceFeed } from '../big-head';
import type { LoadedModel } from '../models';
import { rig } from '../skater';
import { createBoxerAnimation, type HeadReaction } from './animation';
import { createPresentation } from './presentation';
import { boxingVisual as V } from './visual.config';
import type { LiveExpression } from './live-pose';

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
  /** `self`: drawn from this boxer's own eyes (body hidden, gloves kept). `face`: whose camera
   *  face this boxer wears, if any. */
  update(
    s: Readonly<BoxingState>,
    who: BoxerId,
    self: boolean,
    face?: { feed: FaceFeed; player: number },
    live?: LiveExpression | null,
  ): void;
  /** Eye position behind this boxer's head, world space (the player's camera). */
  eye(out: Vector3): Vector3;
  /** Head and glove centres as last updated, world space (tests and latency measurement). */
  probe(): RigProbe;
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

function createGloves(color: string): Mesh[] {
  const gloveMat = new MeshStandardMaterial({ color, roughness: 0.45 });
  return [0, 1].map((hand) => {
    const m = new Mesh(new SphereGeometry(0.12, 16, 12), gloveMat);
    m.name = ['GloveL', 'GloveR'][hand]!;
    m.castShadow = true;
    return m;
  });
}

export function createBoxer(model: LoadedModel, color: string, reaction: HeadReaction): BoxerView {
  const object = new Group();
  const body = rig({ scene: clone(model.scene), animations: model.animations });
  const figure = new Group();
  figure.add(body.body);
  const animate = createBoxerAnimation(body, reaction);
  const presentation = createPresentation();
  const gloves = createGloves(color);
  const dizzy = stars();
  object.add(figure, ...gloves, dizzy);
  const bigHead = createBigHead(body.body, object);
  let floor = 0;

  return {
    object,
    update(s, who, self, face, live) {
      const b = s.boxers[who];
      const t = s.t;
      const visual = presentation(s, who);
      floor = visual.floor;
      figure.scale.setScalar(HEIGHT / 1.83);
      figure.position.set(0, 0, 0);
      figure.rotation.set(0, 0, 0);
      figure.visible = !self;
      animate(s, who, visual, figure, live);
      // Sway and duck move the whole boxer (gloves too).
      // The sim decides dodges; live lean only fills in while the sim shows none.
      const dodgeK = floor > 0 ? 0 : dodgeAmount(b);
      const side = b.dodge === 'left' ? 1 : b.dodge === 'right' ? -1 : 0;
      const floored = visual.floor > 0;
      const liveK = floored || !live ? 0 : 1 - dodgeK;
      placeGloves(gloves, b, self, floored, liveK > 0 ? live!.gloves : null);
      const recoil = floored ? 0 : Math.max(0, 1 - visual.hitAge / V.hitS);
      object.position.set(
        side * 0.35 * dodgeK - visual.hitSide * 0.12 * recoil,
        b.dodge === 'duck' ? -0.35 * dodgeK : 0,
        -0.12 * recoil,
      );
      object.rotation.set(
        -0.15 * recoil,
        0,
        -side * 0.25 * dodgeK +
          visual.hitSide * 0.12 * recoil +
          Math.sin(t * 5) * 0.08 * visual.dizzy, // dizzy wobble: the boxer is still standing
      );
      if (liveK > 0) object.position.addScaledVector(live!.lean, liveK);
      if (b.dodge === 'duck') for (const g of gloves) g.position.y -= 0.1 * dodgeK;
      bigHead.update(face?.feed ?? null, face?.player ?? 0, !self, visual.damage);
      dizzy.visible = visual.dizzy > 0.01;
      dizzy.scale.setScalar(visual.dizzy);
      dizzy.children.forEach((star, i) => {
        const a = t * 4 + (i * Math.PI * 2) / 3;
        star.position.set(Math.cos(a) * 0.22, 1.95, Math.sin(a) * 0.22);
      });
    },
    eye(out) {
      return object.localToWorld(out.set(0, 1.62 - floor * 1.2, -0.35));
    },
    probe: () => probe(object, bigHead.object, gloves),
  };
}

function probe(root: Object3D, head: Object3D, gloves: readonly Object3D[]): RigProbe {
  root.updateWorldMatrix(true, true);
  const at = (o: Object3D) => o.getWorldPosition(new Vec()).toArray();
  return { head: at(head), gloves: [at(gloves[0]!), at(gloves[1]!)] };
}

/** Both gloves, boxer-local. `self`: the player's own view, where they sit low and wide. */
function placeGloves(
  gloves: readonly Mesh[],
  b: Boxer,
  self: boolean,
  floored: boolean,
  live: readonly [Vector3, Vector3] | null,
): void {
  gloves.forEach((g, hand) => {
    g.visible = !floored;
    glovePos(b, b.fists[hand]!, hand as 0 | 1, g.position);
    // Live arms move a glove at rest only: a thrown or retracting punch is the sim's.
    if (live && b.fists[hand]!.phase === 'ready') g.position.add(live[hand]!);
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
