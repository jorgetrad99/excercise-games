// A boxer: the Casual_Hoodie rig (CC0, shared with the skater) with its arms collapsed and two floating
// gloves. Player authority (PLAN-BOXING §2, §4): head and gloves sit where the sim's body says (the
// player's own, or the keyboard/bot puppet's), rotations are the player's, and the sim adds only the
// bounded O1/O2 offsets (rig.ts). The one exception is authority S4 (the fall), which plays the sim clip.
// Local frame: the boxer faces +z, its left is +x.
import { Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3, type Object3D } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { boxingConfig as C } from '../../core/boxing/boxing.config';
import type { BodyPose, BoxerId, BoxingState } from '../../core/boxing/types';
import { createBigHead, type FaceFeed } from '../big-head';
import type { LoadedModel } from '../models';
import { rig } from '../skater';
import type { RigProbe } from '../view';
import { createBoxerAnimation, reactionAt, type HeadReaction } from './animation';
import { createPresentation, type Presentation } from './presentation';
import {
  addOffsets,
  boxingRig,
  createStunOffset,
  hitOffset,
  NO_OFFSETS,
  type Quat,
  type RigPose,
} from './rig';

const HEIGHT = 1.75;
const ID: Quat = [0, 0, 0, 1];

/** A player's live rotations (PoseState torso/hips/head `rot`, character axes). */
export interface LiveTurns {
  hips: Quat;
  torso: Quat;
  head: Quat;
}

/** What the view hands each boxer per frame. `authority` is games/boxing/authority's result (structural). */
export interface BoxerFrame {
  authority: { state: string; overlays: { hit: boolean; stun: boolean } };
  /** The sim body, predicted to now (core/boxing/body predictPose). */
  body: BodyPose;
  turns: LiveTurns | null;
  dtS: number;
}

export interface BoxerView {
  readonly object: Group;
  /** `self`: drawn from this boxer's own eyes (body hidden, gloves kept). `face`: whose camera face. */
  update(
    s: Readonly<BoxingState>,
    who: BoxerId,
    self: boolean,
    face: { feed: FaceFeed; player: number } | undefined,
    frame: BoxerFrame,
  ): void;
  /** Eye position behind this boxer's head, world space (the player's camera). */
  eye(out: Vector3): Vector3;
  /** Head and glove centres as last updated, world space (tests and latency measurement). */
  probe(): RigProbe;
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
    const m = new Mesh(new SphereGeometry(C.body.gloveRadiusM, 16, 12), gloveMat);
    m.name = ['GloveL', 'GloveR'][hand]!;
    m.castShadow = true;
    return m;
  });
}

/** live + O1 (only where authority allows it, or a puppet) + O2 (weight = the eased dizzy, so it fades). */
function rigFor(
  frame: BoxerFrame,
  visual: Presentation,
  reaction: HeadReaction,
  stun: ReturnType<typeof createStunOffset>,
): RigPose {
  const live = livePose(frame);
  const { hitAge, hitSide } = visual;
  const allowed = frame.authority.overlays.hit || frame.authority.state === 'PUPPET';
  const o1 = allowed
    ? hitOffset(hitAge, hitSide, reactionAt(reaction, hitAge, hitSide))
    : NO_OFFSETS();
  return boxingRig(live, addOffsets(o1, stun(live, frame.dtS, visual.dizzy, visual.time)));
}

/** The player's rig before offsets: body offset from the neutral head, rotations, gloves. */
function livePose(frame: BoxerFrame): RigPose {
  const h = C.body.head;
  const b = frame.body;
  return {
    root: [b.head[0] - h[0], b.head[1] - h[1], b.head[2] - h[2]],
    hips: frame.turns?.hips ?? ID,
    torso: frame.turns?.torso ?? ID,
    head: frame.turns?.head ?? ID,
    gloves: [b.gloves[0], b.gloves[1]],
  };
}

export function createBoxer(model: LoadedModel, color: string, reaction: HeadReaction): BoxerView {
  const object = new Group();
  const body = rig({ scene: clone(model.scene), animations: model.animations });
  const figure = new Group();
  figure.add(body.body);
  const animate = createBoxerAnimation(body);
  const presentation = createPresentation();
  const stun = createStunOffset();
  const gloves = createGloves(color);
  const dizzy = stars();
  object.add(figure, ...gloves, dizzy);
  const bigHead = createBigHead(body.body, object);
  let floor = 0;

  return {
    object,
    update(s, who, self, face, frame) {
      const visual = presentation(s, who);
      floor = visual.floor;
      figure.scale.setScalar(HEIGHT / 1.83);
      figure.position.set(0, 0, 0);
      figure.visible = !self;
      const rigPose = rigFor(frame, visual, reaction, stun);
      const standing = floor === 0;
      const simOwned = frame.authority.state === 'S4';
      const root = standing ? rigPose.root : [0, 0, 0];
      object.position.set(root[0]!, root[1]!, root[2]!);
      // Puppets have no torso turns of their own: lean into a sway so a key dodge still reads.
      object.rotation.set(0, 0, frame.authority.state === 'PUPPET' ? -rigPose.root[0] * 0.45 : 0);
      const duck = Math.max(0, Math.min(1, -rigPose.root[1] / C.dodge.duckM));
      animate(
        s,
        who,
        visual,
        figure,
        simOwned ? null : rigPose,
        duck,
        frame.authority.state === 'PUPPET',
      );
      gloves.forEach((g, hand) => {
        g.visible = standing;
        const p = rigPose.gloves[hand as 0 | 1];
        g.position.set(
          p[0] - object.position.x,
          p[1] - object.position.y,
          p[2] - object.position.z,
        );
      });
      bigHead.update(face?.feed ?? null, face?.player ?? 0, !self, visual.damage);
      dizzy.visible = visual.dizzy > 0.01;
      dizzy.scale.setScalar(visual.dizzy);
      dizzy.children.forEach((star, i) => {
        const a = s.t * 4 + (i * Math.PI * 2) / 3;
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
  const at = (o: Object3D) => o.getWorldPosition(new Vector3()).toArray();
  return { head: at(head), gloves: [at(gloves[0]!), at(gloves[1]!)] };
}
