// Kenney CC0 models (public/assets/kenney, see CREDITS.md) normalised into target boxes and drawn as
// InstancedMeshes: one draw call per sub-mesh per model, however many copies are on screen.
import {
  Box3,
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface Part {
  geometry: BufferGeometry;
  material: Material | Material[];
  /** Model-local transform including the fit-to-box normalisation. */
  local: Matrix4;
}

/** Target box: width (x), height (y), depth (z); the model's base sits on y = 0, centred in x/z. */
export interface Fit {
  w: number;
  h: number;
  d: number;
  /** Rotate so the model's longest horizontal axis runs along x ('x') or z ('z'). */
  long?: 'x' | 'z';
}

export const MODEL_FILES = {
  barrier: 'city/construction-barrier.glb',
  gantry: 'city/sign-highway.glb',
  lamp: 'city/light-square.glb',
  beacon: 'city/construction-light.glb',
  delivery: 'car/delivery.glb',
  log: 'nature/log_large.glb',
  tree: 'nature/tree_default.glb',
  oak: 'nature/tree_oak.glb',
  rock: 'nature/rock_largeA.glb',
  cliff: 'nature/cliff_block_rock.glb',
} as const;
export type ModelId = keyof typeof MODEL_FILES;

/** Flat-coloured box, used when a model fails to load (the game must still be playable). */
function fallback(): Object3D {
  const o = new Object3D();
  o.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: '#c96' })));
  return o;
}

export async function loadModels(base = '/assets/kenney/'): Promise<Record<ModelId, Object3D>> {
  const loader = new GLTFLoader();
  const entries = await Promise.all(
    (Object.keys(MODEL_FILES) as ModelId[]).map(async (id) => {
      try {
        return [id, (await loader.loadAsync(base + MODEL_FILES[id])).scene] as const;
      } catch (err) {
        console.warn(`model ${id} failed to load, using a box`, err);
        return [id, fallback()] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<ModelId, Object3D>;
}

/** Flatten a model into parts whose `local` matrices fit it into `fit`. */
export function fitParts(model: Object3D, fit: Fit): Part[] {
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const turn = fit.long !== undefined && (fit.long === 'x') !== size.x >= size.z;
  const [sx, sz] = turn ? [size.z, size.x] : [size.x, size.z];
  const rot = new Matrix4().makeRotationY(turn ? Math.PI / 2 : 0);
  const centre = box.getCenter(new Vector3());
  const toOrigin = new Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z);
  const scale = new Matrix4().makeScale(
    fit.w / (sx || 1),
    fit.h / (size.y || 1),
    fit.d / (sz || 1),
  );
  const norm = scale.multiply(rot).multiply(toOrigin);
  const parts: Part[] = [];
  model.traverse((o) => {
    if (o instanceof Mesh) {
      parts.push({
        geometry: o.geometry,
        material: o.material,
        local: norm.clone().multiply(o.matrixWorld),
      });
    }
  });
  return parts;
}

const tmp = new Matrix4();
const q = new Quaternion();
const yAxis = new Vector3(0, 1, 0);

/** A pool of instances of one model. Call begin(), add() per visible copy, end() once per frame. */
export interface InstancedModel {
  readonly object: Object3D;
  begin(): void;
  add(
    x: number,
    y: number,
    z: number,
    sx?: number,
    sy?: number,
    sz?: number,
    rotY?: number,
    color?: Color,
  ): void;
  end(): void;
}

export function instanced(parts: Part[], max: number, shadows = true): InstancedModel {
  const object = new Object3D();
  const meshes = parts.map((p) => {
    const m = new InstancedMesh(p.geometry, p.material, max);
    m.castShadow = shadows;
    m.receiveShadow = true;
    m.frustumCulled = false; // instances span the whole track; the bounding sphere is the template's
    m.count = 0;
    object.add(m);
    return m;
  });
  let n = 0;
  const world = new Matrix4();
  const pos = new Vector3();
  const scl = new Vector3();
  return {
    object,
    begin() {
      n = 0;
    },
    add(x, y, z, sx = 1, sy = 1, sz = 1, rotY = 0, color) {
      if (n >= max) return;
      world.compose(pos.set(x, y, z), q.setFromAxisAngle(yAxis, rotY), scl.set(sx, sy, sz));
      meshes.forEach((m, i) => {
        m.setMatrixAt(n, tmp.multiplyMatrices(world, parts[i]!.local));
        if (color) m.setColorAt(n, color);
      });
      n++;
    },
    end() {
      for (const m of meshes) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    },
  };
}
