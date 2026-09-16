// Track, decoration, obstacles, coins and pickups, rebuilt every frame from SimState chunks into
// instanced pools (PLAN §4 M4: chunk views bound to sim chunks, pools, InstancedMesh coins with spin).
// Render z = -(worldZ - distance): the player sits at z = 0 and the world comes toward the camera.
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three';
import { laneX } from '../core/collision';
import { simConfig } from '../core/sim.config';
import type { ChunkState, PickupKind, SimState } from '../core/types';
import { BIOME_LOOKS, hash01 } from './biomes';
import {
  fitParts,
  instanced,
  uniformFit,
  type Fit,
  type InstancedModel,
  type LoadedModel,
  type ModelId,
} from './models';
import { mergeFlatParts } from './merge';

const L = simConfig.world.chunkLength;
const ROAD_W = 6.6;

const white = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: '#fff', roughness: 0.9 });
const primitive = (
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  max: number,
  shadows = true,
) => instanced([{ geometry, material, local: new Matrix4() }], max, shadows);

const PICKUP_LOOK: Record<PickupKind, { geometry: () => BufferGeometry; color: string }> = {
  magnet: { geometry: () => new TorusGeometry(0.32, 0.1, 10, 20, Math.PI), color: '#e63946' },
  double: { geometry: () => new OctahedronGeometry(0.38), color: '#ffb703' },
  hoverboard: { geometry: () => new BoxGeometry(0.9, 0.12, 0.4), color: '#00b4d8' },
  token: { geometry: () => new IcosahedronGeometry(0.34), color: '#9b5de5' },
};

type Instanced = Exclude<ModelId, 'skater'>;

/** Fit + pool size + shadows per model. Walls are unit-depth and stretched per segment. */
function modelSpecs(
  m: Record<ModelId, LoadedModel>,
): Record<Instanced, { fit: Fit; max: number; shadows?: boolean }> {
  const along = (id: ModelId, h: number): Fit => {
    const f = uniformFit(m[id].scene, h); // cars: keep proportions, long axis down the road
    return { w: Math.min(f.w, f.d), h, d: Math.max(f.w, f.d), long: 'z' };
  };
  const u = (id: ModelId, h: number) => uniformFit(m[id].scene, h);
  const wall = { w: 1.9, h: 3.1, d: 1, long: 'z' } as const;
  return {
    barrier: { fit: { w: 1.6, h: 0.9, d: 0.5, long: 'x' }, max: 120 },
    heightBar: { fit: { w: 2, h: 2.6, d: 0.35, long: 'x' }, max: 120 },
    log: { fit: { w: 1.8, h: 0.9, d: 0.9, long: 'x' }, max: 120 },
    beam: { fit: { w: 2, h: 2.6, d: 0.4, long: 'x' }, max: 120 },
    container: { fit: { w: 1.8, h: 3.1, d: 1 }, max: 120 },
    bus: { fit: wall, max: 120 },
    schoolBus: { fit: wall, max: 120 },
    bush: { fit: { w: 2, h: 3.1, d: 1 }, max: 240 },
    // Roadside props and backdrop don't cast shadows: the shadow pass would double their draw calls,
    // and the sun's shadow camera only covers the lanes anyway.
    bushFlowers: { fit: u('bushFlowers', 1.3), max: 120, shadows: false },
    streetlight: { fit: u('streetlight', 5), max: 80, shadows: false },
    trafficLight: { fit: u('trafficLight', 4.5), max: 80, shadows: false },
    signStop: { fit: u('signStop', 2.4), max: 80, shadows: false },
    signNoParking: { fit: u('signNoParking', 2.4), max: 80, shadows: false },
    car1: { fit: along('car1', 1.5), max: 40, shadows: false },
    car2: { fit: along('car2', 1.5), max: 40, shadows: false },
    suv: { fit: along('suv', 1.8), max: 40, shadows: false },
    taxi: { fit: along('taxi', 1.5), max: 40, shadows: false },
    // Backdrop: fitted at height 1 and scaled per instance.
    building2: { fit: u('building2', 1), max: 40, shadows: false },
    building3: { fit: u('building3', 1), max: 40, shadows: false },
    building4: { fit: u('building4', 1), max: 40, shadows: false },
    house2: { fit: u('house2', 1), max: 40, shadows: false },
    maple1: { fit: u('maple1', 1), max: 120, shadows: false },
    maple3: { fit: u('maple3', 1), max: 60, shadows: false },
    birch: { fit: u('birch', 1), max: 120, shadows: false },
    flowers: { fit: u('flowers', 0.6), max: 80, shadows: false },
  };
}

interface Pools {
  models: Record<Instanced, InstancedModel>;
  fits: Record<Instanced, Fit>;
  road: InstancedModel;
  ground: InstancedModel;
  lines: InstancedModel;
  coins: InstancedModel;
  pickups: Record<PickupKind, InstancedModel>;
}

function createPools(models: Record<ModelId, LoadedModel>): Pools {
  const specs = modelSpecs(models);
  const ids = Object.keys(specs) as Instanced[];
  const coinMat = new MeshStandardMaterial({
    color: '#ffc300',
    metalness: 0.7,
    roughness: 0.3,
    emissive: '#6b4a00',
  });
  return {
    models: Object.fromEntries(
      ids.map((id) => [
        id,
        instanced(
          mergeFlatParts(fitParts(models[id].scene, specs[id].fit)),
          specs[id].max,
          specs[id].shadows ?? true,
        ),
      ]),
    ) as Record<Instanced, InstancedModel>,
    fits: Object.fromEntries(ids.map((id) => [id, specs[id].fit])) as Record<Instanced, Fit>,
    road: primitive(new BoxGeometry(ROAD_W, 0.1, L), white(), 16, false),
    ground: primitive(new BoxGeometry(160, 0.1, L), white(), 16, false),
    lines: primitive(new BoxGeometry(0.08, 0.02, 1.8), white(), 160, false),
    coins: primitive(new CylinderGeometry(0.32, 0.32, 0.08, 18).rotateX(Math.PI / 2), coinMat, 800),
    pickups: Object.fromEntries(
      Object.entries(PICKUP_LOOK).map(([k, v]) => {
        const m = new MeshStandardMaterial({
          color: v.color,
          emissive: v.color,
          emissiveIntensity: 0.35,
        });
        return [k, primitive(v.geometry(), m, 24)];
      }),
    ) as Record<PickupKind, InstancedModel>,
  };
}

export interface WorldView {
  readonly object: Object3D;
  update(s: Readonly<SimState>, distance: number): void;
}

export function createWorldView(models: Record<ModelId, LoadedModel>): WorldView {
  const pools = createPools(models);
  const all = [
    ...Object.values(pools.models),
    pools.road,
    pools.ground,
    pools.lines,
    pools.coins,
    ...Object.values(pools.pickups),
  ];
  const object = new Object3D();
  for (const p of all) object.add(p.object);
  return {
    object,
    update(s, distance) {
      for (const p of all) p.begin();
      const rz = (z: number): number => -(z - distance);
      const taken = new Set(s.taken);
      for (const c of s.chunks) {
        drawGround(pools, c, rz(c.z0 + L / 2));
        drawObstacles(pools, c, rz);
        drawItems(pools, c, rz, taken, s.t);
      }
      const dash = 4;
      for (let z = Math.floor((distance - 12) / dash) * dash; z < distance + 8 * L; z += dash) {
        for (const x of [-1, 1]) pools.lines.add(x, 0.01, rz(z));
      }
      for (const p of all) p.end();
    },
  };
}

const color = new Color();
const CARS = new Set<ModelId>(['car1', 'car2', 'suv', 'taxi']);
const pick = <T>(list: readonly T[], h: number): T =>
  list[Math.floor(h * list.length) % list.length]!;

function drawGround(pools: Pools, c: ChunkState, zMid: number): void {
  const look = BIOME_LOOKS[c.biome];
  pools.road.add(0, -0.05, zMid, 1, 1, 1, 0, color.set(look.road));
  pools.ground.add(0, -0.12, zMid, 1, 1, 1, 0, color.set(look.ground));
  for (const side of [-1, 1]) {
    for (let slot = 0; slot < 3; slot++) {
      const h = hash01(c.index * 7 + slot, side);
      const id = pick(look.props, h) as Instanced;
      const x = side * (4.6 + (c.biome === 'park' ? h * 3 : 0));
      // Street furniture faces the road; parked cars (fitted along z) point along it.
      const rot = CARS.has(id) ? 0 : side > 0 ? -Math.PI / 2 : Math.PI / 2;
      pools.models[id].add(x, 0, zMid - L / 2 + 4 + slot * 8, 1, 1, 1, rot);
    }
    drawBackdrop(pools, c, side, zMid);
  }
}

function drawBackdrop(pools: Pools, c: ChunkState, side: number, zMid: number): void {
  const look = BIOME_LOOKS[c.biome];
  const count = c.biome === 'park' ? 4 : 2;
  for (let b = 0; b < count; b++) {
    const h = hash01(c.index * 13 + b, side * 3);
    const id = pick(look.backdrop, hash01(c.index, b + side * 5)) as Instanced;
    const [lo, hi] = look.backdropHeight;
    const k = lo + h * (hi - lo);
    const fit = pools.fits[id];
    const depth = Math.max(fit.w, fit.d) * k;
    const x = side * (c.biome === 'park' ? 8 + h * 14 : 10 + depth / 2);
    const z = zMid - L / 2 + (L / count) * (b + 0.5);
    pools.models[id].add(x, 0, z, k, k, k, side > 0 ? -Math.PI / 2 : Math.PI / 2);
  }
}

function drawObstacles(pools: Pools, c: ChunkState, rz: (z: number) => number): void {
  const look = BIOME_LOOKS[c.biome];
  for (const o of c.obstacles) {
    const x = laneX(o.lane);
    if (o.kind !== 'wall') {
      pools.models[(o.kind === 'jump' ? look.jump : look.slide) as Instanced].add(
        x,
        0,
        rz(o.z + o.len / 2),
      );
      continue;
    }
    if (o.len < 5) {
      pools.models[look.wall.short as Instanced].add(x, 0, rz(o.z + o.len / 2), 1, 1, o.len * 0.96);
      continue;
    }
    // A row of vehicles/hedges filling the blocked length.
    const n = Math.max(1, Math.round(o.len / look.wall.segment));
    const seg = o.len / n;
    for (let k = 0; k < n; k++) {
      const id = pick(look.wall.long, hash01(o.id, k)) as Instanced;
      pools.models[id].add(x, 0, rz(o.z + seg * (k + 0.5)), 1, 1, seg * 0.94);
    }
  }
}

function drawItems(
  pools: Pools,
  c: ChunkState,
  rz: (z: number) => number,
  taken: Set<number>,
  t: number,
): void {
  for (const coin of c.coins) {
    if (!taken.has(coin.id))
      pools.coins.add(laneX(coin.lane), coin.y, rz(coin.z), 1, 1, 1, t * 3 + coin.z * 0.4);
  }
  for (const p of c.pickups) {
    if (taken.has(p.id)) continue;
    pools.pickups[p.kind].add(
      laneX(p.lane),
      1 + Math.sin(t * 3 + p.z) * 0.15,
      rz(p.z),
      1,
      1,
      1,
      t * 2,
    );
  }
}
