// Quaternius CC0 models (public/assets/quaternius, scripts/vendor-quaternius.mjs, CREDITS.md) plus a few
// procedural pieces in the same flat style, normalised into target boxes and drawn as InstancedMeshes:
// one draw call per sub-mesh per model, however many copies are on screen.
import {
  Box3,
  BoxGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type AnimationClip,
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
  skater: 'character/Casual_Hoodie.glb',
  streetlight: 'streets/Streetlight_Single.glb',
  trafficLight: 'streets/TrafficLight.glb',
  signStop: 'streets/Sign_Stop.glb',
  signNoParking: 'streets/Sign_NoParking.glb',
  bus: 'transport/Bus.glb',
  schoolBus: 'transport/SchoolBus.glb',
  car1: 'cars/NormalCar1.glb',
  car2: 'cars/NormalCar2.glb',
  suv: 'cars/SUV.glb',
  taxi: 'cars/Taxi.glb',
  building2: 'buildings/Building2_Large.glb',
  building3: 'buildings/Building3_Big.glb',
  building4: 'buildings/Building4.glb',
  house2: 'buildings/House2.glb',
  maple1: 'nature/MapleTree_1.glb',
  maple3: 'nature/MapleTree_3.glb',
  birch: 'nature/BirchTree_2.glb',
  bush: 'nature/Bush_Large.glb',
  bushFlowers: 'nature/Bush_Large_Flowers.glb',
  flowers: 'nature/Flower_3_Clump.glb',
} as const;

/** Built in code (no suitable CC0 model in the family): hurdles, bars and the construction box. */
export const PROCEDURAL = ['barrier', 'heightBar', 'log', 'beam', 'container'] as const;

export type FileModelId = keyof typeof MODEL_FILES;
export type ModelId = FileModelId | (typeof PROCEDURAL)[number];

export interface LoadedModel {
  scene: Object3D;
  animations: AnimationClip[];
}

const flat = (color: string, roughness = 0.8) => new MeshStandardMaterial({ color, roughness });

function box(
  o: Object3D,
  material: Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z = 0,
): void {
  const m = new Mesh(new BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  o.add(m);
}

/** Alternating stripes along x (hazard boards). Two materials → two draw calls, however long. */
function stripes(
  o: Object3D,
  a: Material,
  b: Material,
  w: number,
  h: number,
  d: number,
  y: number,
  n: number,
): void {
  for (let i = 0; i < n; i++) box(o, i % 2 ? b : a, w / n, h, d, -w / 2 + (w / n) * (i + 0.5), y);
}

function procedural(id: (typeof PROCEDURAL)[number]): Object3D {
  const o = new Object3D();
  const red = flat('#e63946');
  const white = flat('#f1faee');
  const yellow = flat('#ffb703');
  const dark = flat('#264653');
  const wood = flat('#8d5a3b');
  const woodLight = flat('#c68b59');
  if (id === 'barrier') {
    stripes(o, red, white, 1.6, 0.28, 0.08, 0.72, 6);
    stripes(o, white, red, 1.6, 0.2, 0.08, 0.36, 6);
    for (const x of [-0.7, 0.7]) box(o, dark, 0.08, 0.9, 0.5, x, 0.45);
  } else if (id === 'heightBar') {
    stripes(o, yellow, dark, 2, 0.35, 0.2, 2.3, 8);
    for (const x of [-0.95, 0.95]) box(o, dark, 0.14, 2.6, 0.14, x, 1.3);
  } else if (id === 'log') {
    const log = new Mesh(new CylinderGeometry(0.42, 0.45, 1.8, 12).rotateZ(Math.PI / 2), wood);
    log.position.y = 0.45;
    o.add(log);
    for (const x of [-0.9, 0.9]) box(o, woodLight, 0.02, 0.7, 0.7, x, 0.45);
  } else if (id === 'beam') {
    box(o, woodLight, 2, 0.4, 0.4, 0, 2.4);
    for (const x of [-0.95, 0.95]) box(o, wood, 0.2, 2.6, 0.2, x, 1.3);
  } else {
    box(o, flat('#f4a261'), 1, 1, 1, 0, 0.5);
    for (const y of [0.2, 0.5, 0.8]) box(o, flat('#e76f51'), 1.02, 0.06, 1.02, 0, y);
  }
  return o;
}

/** Flat-coloured box, used when a model fails to load (the game must still be playable). */
function fallback(): LoadedModel {
  const o = new Object3D();
  o.add(new Mesh(new BoxGeometry(1, 1, 1), flat('#c96')));
  return { scene: o, animations: [] };
}

export async function loadModels(
  base = '/assets/quaternius/',
): Promise<Record<ModelId, LoadedModel>> {
  const loader = new GLTFLoader();
  const files = await Promise.all(
    (Object.keys(MODEL_FILES) as FileModelId[]).map(async (id) => {
      try {
        const gltf = await loader.loadAsync(base + MODEL_FILES[id]);
        return [id, { scene: gltf.scene, animations: gltf.animations }] as const;
      } catch (err) {
        console.warn(`model ${id} failed to load, using a box`, err);
        return [id, fallback()] as const;
      }
    }),
  );
  const built = PROCEDURAL.map((id) => [id, { scene: procedural(id), animations: [] }] as const);
  return Object.fromEntries([...files, ...built]) as Record<ModelId, LoadedModel>;
}

/** Flatten a model into parts whose `local` matrices fit it into `fit`. */
export function fitParts(model: Object3D, fit: Fit): Part[] {
  model.updateMatrixWorld(true);
  const box3 = new Box3().setFromObject(model);
  const size = box3.getSize(new Vector3());
  const turn = fit.long !== undefined && (fit.long === 'x') !== size.x >= size.z;
  const [sx, sz] = turn ? [size.z, size.x] : [size.x, size.z];
  const rot = new Matrix4().makeRotationY(turn ? Math.PI / 2 : 0);
  const centre = box3.getCenter(new Vector3());
  const toOrigin = new Matrix4().makeTranslation(-centre.x, -box3.min.y, -centre.z);
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

/** Scale uniformly to height `h`, keeping footprint proportions. */
export function uniformFit(model: Object3D, h: number): Fit {
  const size = new Box3().setFromObject(model).getSize(new Vector3());
  const k = h / (size.y || 1);
  return { w: size.x * k, h, d: size.z * k };
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
