import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from 'three';
import { paintFace } from './boxing/face-damage';
import { createSwelling } from './boxing/swelling';
import type { FaceDamage } from './boxing/presentation';
import { boxingVisual as V } from './boxing/visual.config';

/** Existing exact-frame live-crop pipeline; render never captures video or runs inference. */
export interface FaceFeed {
  canvas(player: number): HTMLCanvasElement | null;
  version(player: number): number;
}
export const HEAD_SCALE = V.headScale;

function headMeshes() {
  const radius = V.headRadius * HEAD_SCALE;
  const object = new Group();
  object.name = 'ReplacementHead';
  const shell = new Mesh(
    new SphereGeometry(radius, 32, 24),
    new MeshStandardMaterial({ color: '#edb98d', roughness: 0.85 }),
  );
  shell.scale.set(1, 1.12, 0.85);
  shell.castShadow = true;
  const canvas = Object.assign(document.createElement('canvas'), { width: 192, height: 192 });
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const face = new Mesh(
    new SphereGeometry(radius * 1.015, 32, 24, Math.PI / 2 - 1.05, 2.1, Math.PI / 2 - 1.1, 2.2),
    new MeshBasicMaterial({ map: texture, alphaTest: 0.05 }),
  );
  face.name = 'LiveFace';
  face.scale.copy(shell.scale);
  object.add(shell, face);
  const swell = createSwelling(face.geometry, [shell.geometry]);
  return { object, ctx, texture, swell };
}

export function createBigHead(body: Object3D, parent: Object3D) {
  const head = body.getObjectByName('Head');
  // The asset has separate skin/hair/eye primitives beneath this group. Hide ALL of them.
  const original = body.getObjectByName('Casual_Head');
  if (original) original.visible = false;
  const { object, ctx, texture, swell } = headMeshes();
  parent.add(object);
  body.updateWorldMatrix(true, true);
  const bind = head?.getWorldQuaternion(new Quaternion()).invert() ?? new Quaternion();
  const parentQ = new Quaternion(),
    headQ = new Quaternion(),
    at = new Vector3();
  let seen = -1,
    lastCanvas: HTMLCanvasElement | null = null,
    lastDamage = '';
  return {
    object,
    update(
      faces: FaceFeed | null,
      player: number,
      visible: boolean,
      damage: FaceDamage = [0, 0, 0],
    ): void {
      object.visible = visible && !!head;
      if (!head) return;
      const source = (faces?.version(player) ?? 0) > 0 ? faces!.canvas(player) : null;
      const version = faces?.version(player) ?? 0,
        key = damage.join(',');
      if (key !== lastDamage) swell(damage);
      if (version !== seen || source !== lastCanvas || key !== lastDamage) {
        paintFace(ctx, source, damage);
        texture.needsUpdate = true;
        seen = version;
        lastCanvas = source;
        lastDamage = key;
      }
      parent.updateWorldMatrix(true, true);
      parent.worldToLocal(head.getWorldPosition(at));
      parent.getWorldQuaternion(parentQ).invert();
      object.quaternion.copy(parentQ.multiply(head.getWorldQuaternion(headQ)).multiply(bind));
      object.position
        .copy(at)
        .add(new Vector3(0, V.headLift, 0).applyQuaternion(object.quaternion));
    },
  };
}
