// "Cabezota": a character's head blown up past realistic proportions, with the player's live face
// (a camera crop, see pose/face-crop.ts) wrapped on its front as a sphere cap. Works on any
// Quaternius rig with a 'Head' bone; the cap is placed at the bone each frame but keeps the
// character's facing, so the face stays readable through the idle bob.
import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Bone,
  type Object3D,
} from 'three';

/** Live face crops per player: a square canvas each (transparent outside the face oval). */
export interface FaceFeed {
  canvas(player: number): HTMLCanvasElement | null;
  /** 0 = no face yet; changes whenever the canvas was redrawn. */
  version(player: number): number;
}

/** Head bone scale: realistic is 1. */
export const HEAD_SCALE = 1.8;
/** Face cap sphere radius, m (the scaled head is ≈ 0.2 m wide). */
const CAP_R = 0.2;
/** Cap center relative to the Head bone, character-local m: up into the head, out in front. */
const CAP_UP = 0.17;
const CAP_FORWARD = 0.12;

export function createBigHead(body: Object3D, parent: Object3D) {
  const head = body.getObjectByName('Head') as Bone | undefined;
  const material = new MeshBasicMaterial({ alphaTest: 0.5 });
  // A front patch of a sphere: ±0.8 rad around +z sideways, ±0.85 rad around the equator vertically.
  const cap = new Mesh(
    new SphereGeometry(CAP_R, 24, 16, Math.PI / 2 - 0.8, 1.6, Math.PI / 2 - 0.85, 1.7),
    material,
  );
  cap.visible = false;
  parent.add(cap);
  let texture: CanvasTexture | null = null;
  let seen = 0;
  const at = new Vector3();

  return {
    /** Call after the rig is posed. `visible` false = the owner's own first-person view. */
    update(faces: FaceFeed | null, player: number, visible: boolean): void {
      head?.scale.setScalar(HEAD_SCALE);
      const canvas = faces?.canvas(player) ?? null;
      const version = faces?.version(player) ?? 0;
      cap.visible = visible && !!head && !!canvas && version > 0;
      if (!cap.visible) return;
      if (texture?.image !== canvas) {
        texture?.dispose();
        texture = new CanvasTexture(canvas!);
        texture.colorSpace = SRGBColorSpace;
        material.map = texture;
        material.needsUpdate = true;
      }
      if (version !== seen) texture.needsUpdate = true;
      seen = version;
      parent.updateMatrixWorld(true);
      parent.worldToLocal(head!.getWorldPosition(at));
      cap.position.set(at.x, at.y + CAP_UP, at.z + CAP_FORWARD);
    },
  };
}
