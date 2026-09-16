// AABB geometry for the player, obstacles and pickups (PLAN §4 M3: "AABB vs obstacle boxes").
import { simConfig } from './sim.config';
import type { ChunkState, Obstacle, SimState } from './types';

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

const P = simConfig.player;
const O = simConfig.obstacles;

export const laneX = (lane: number): number => lane * simConfig.world.laneWidth;

export const playerHeight = (s: SimState): number => (s.sliding ? P.slideHeight : P.height);

export function playerBox(s: SimState): Box {
  return {
    x0: s.x - P.halfWidth,
    x1: s.x + P.halfWidth,
    y0: s.y,
    y1: s.y + playerHeight(s),
    z0: s.distance - P.halfDepth,
    z1: s.distance + P.halfDepth,
  };
}

export function obstacleBox(o: Obstacle): Box {
  const { y0, y1 } = O[o.kind];
  const x = laneX(o.lane);
  return { x0: x - O.halfWidth, x1: x + O.halfWidth, y0, y1, z0: o.z, z1: o.z + o.len };
}

const span = (a0: number, a1: number, b0: number, b1: number): boolean => a0 < b1 && b0 < a1;
export const overlapXZ = (a: Box, b: Box): boolean =>
  span(a.x0, a.x1, b.x0, b.x1) && span(a.z0, a.z1, b.z0, b.z1);
export const overlapY = (a: Box, b: Box): boolean => span(a.y0, a.y1, b.y0, b.y1);

/** Chunks overlapping [distance - behind, distance + ahead]. */
export function* chunksNear(s: SimState, behind: number, ahead: number): Generator<ChunkState> {
  const L = simConfig.world.chunkLength;
  for (const c of s.chunks) {
    if (c.z0 + L >= s.distance - behind && c.z0 <= s.distance + ahead) yield c;
  }
}
