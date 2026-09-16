// Track, decoration, obstacles, coins and pickups, rebuilt every frame from SimState chunks into
// instanced pools (PLAN §4 M4: chunk views bound to sim chunks, pools, InstancedMesh coins with spin).
// Render z = -(worldZ - distance): the player sits at z = 0 and the world comes toward the camera.
import {
  Box3,
  BoxGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { laneX } from '../core/collision';
import { simConfig } from '../core/sim.config';
import type { ChunkState, PickupKind, SimState } from '../core/types';
import { BIOME_LOOKS, hash01 } from './biomes';
import { fitParts, instanced, type Fit, type InstancedModel, type ModelId } from './models';

const L = simConfig.world.chunkLength;
const ROAD_W = 6.6;
const MAX = { obstacle: 120, wall: 240, prop: 80 };

const white = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: '#fff', roughness: 0.9 });
const primitive = (
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  max: number,
  shadows = true,
) => instanced([{ geometry, material, local: new Matrix4() }], max, shadows);

/** Scale a model uniformly to height `h`, keeping its footprint proportions. */
function uniform(model: Object3D, h: number): Fit {
  const size = new Box3().setFromObject(model).getSize(new Vector3());
  const k = h / (size.y || 1);
  return { w: size.x * k, h, d: size.z * k };
}

const PICKUP_LOOK: Record<PickupKind, { geometry: () => BufferGeometry; color: string }> = {
  magnet: { geometry: () => new TorusGeometry(0.32, 0.1, 10, 20, Math.PI), color: '#e63946' },
  double: { geometry: () => new OctahedronGeometry(0.38), color: '#ffb703' },
  hoverboard: { geometry: () => new BoxGeometry(0.9, 0.12, 0.4), color: '#00b4d8' },
  token: { geometry: () => new IcosahedronGeometry(0.34), color: '#9b5de5' },
};

interface Pools {
  models: Record<ModelId, InstancedModel>;
  road: InstancedModel;
  ground: InstancedModel;
  lines: InstancedModel;
  blocks: InstancedModel;
  coins: InstancedModel;
  pickups: Record<PickupKind, InstancedModel>;
}

function createPools(models: Record<ModelId, Object3D>): Pools {
  const fits: Record<ModelId, Fit> = {
    barrier: { w: 1.6, h: 0.9, d: 0.5, long: 'x' },
    log: { w: 1.7, h: 0.9, d: 0.7, long: 'x' },
    gantry: { w: 1.9, h: 2.6, d: 0.4, long: 'x' },
    delivery: { w: 1.7, h: 3.1, d: 1, long: 'z' },
    cliff: { w: 1.9, h: 3.2, d: 1 },
    lamp: uniform(models.lamp, 4.2),
    beacon: uniform(models.beacon, 1.2),
    tree: uniform(models.tree, 5),
    oak: uniform(models.oak, 6),
    rock: uniform(models.rock, 0.7),
  };
  const max = (id: ModelId): number =>
    id === 'delivery' || id === 'cliff'
      ? MAX.wall
      : ['barrier', 'log', 'gantry'].includes(id)
        ? MAX.obstacle
        : MAX.prop;
  const coinMat = new MeshStandardMaterial({
    color: '#ffc300',
    metalness: 0.7,
    roughness: 0.3,
    emissive: '#6b4a00',
  });
  return {
    models: Object.fromEntries(
      (Object.keys(fits) as ModelId[]).map((id) => [
        id,
        instanced(fitParts(models[id], fits[id]), max(id)),
      ]),
    ) as Record<ModelId, InstancedModel>,
    road: primitive(new BoxGeometry(ROAD_W, 0.1, L), white(), 16, false),
    ground: primitive(new BoxGeometry(160, 0.1, L), white(), 16, false),
    lines: primitive(new BoxGeometry(0.08, 0.02, 1.8), white(), 160, false),
    blocks: primitive(new BoxGeometry(1, 1, 1), white(), 64),
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

const allPools = (p: Pools): InstancedModel[] => [
  ...Object.values(p.models),
  p.road,
  p.ground,
  p.lines,
  p.blocks,
  p.coins,
  ...Object.values(p.pickups),
];

export interface WorldView {
  readonly object: Object3D;
  update(s: Readonly<SimState>, distance: number): void;
}

export function createWorldView(models: Record<ModelId, Object3D>): WorldView {
  const pools = createPools(models);
  const all = allPools(pools);
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

function drawGround(pools: Pools, c: ChunkState, zMid: number): void {
  const look = BIOME_LOOKS[c.biome];
  pools.road.add(0, -0.05, zMid, 1, 1, 1, 0, color.set(look.road));
  pools.ground.add(0, -0.12, zMid, 1, 1, 1, 0, color.set(look.ground));
  for (const side of [-1, 1]) {
    for (let slot = 0; slot < 3; slot++) {
      const h = hash01(c.index * 7 + slot, side);
      const id = look.props[Math.floor(h * look.props.length)]!;
      const x = side * (4.4 + (c.biome === 'park' ? h * 4 : 0));
      // Lamp arms point at the road.
      pools.models[id].add(x, 0, zMid - L / 2 + 4 + slot * 8, 1, 1, 1, side > 0 ? 0 : Math.PI);
    }
    for (let b = 0; b < 2; b++) {
      const h = hash01(c.index * 13 + b, side * 3);
      const [lo, hi] = look.blockHeight;
      const height = lo + h * (hi - lo);
      const w = 6 + h * 6;
      color.set(look.blocks[Math.floor(hash01(c.index, b + side * 5) * look.blocks.length)]!);
      pools.blocks.add(
        side * (11 + w / 2),
        height / 2,
        zMid - L / 4 + b * (L / 2),
        w,
        height,
        L / 2 - 1,
        0,
        color,
      );
    }
  }
}

function drawObstacles(pools: Pools, c: ChunkState, rz: (z: number) => number): void {
  const look = BIOME_LOOKS[c.biome];
  for (const o of c.obstacles) {
    const x = laneX(o.lane);
    if (o.kind === 'wall') {
      // Walls are a row of props (trucks, rocks) filling the blocked length.
      const n = Math.max(1, Math.round(o.len / look.wall.segment));
      const seg = o.len / n;
      for (let k = 0; k < n; k++) {
        pools.models[look.wall.model].add(x, 0, rz(o.z + seg * (k + 0.5)), 1, 1, seg * 0.96);
      }
    } else {
      pools.models[o.kind === 'jump' ? look.jump : look.slide].add(x, 0, rz(o.z + o.len / 2));
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
