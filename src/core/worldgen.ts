// Seeded chunk generation (PLAN §2.3). Chunk i depends only on (seed, i, previous chunk), so a run is
// reproducible as long as chunks are generated in order (the sim always does).
import { BIOMES, EMPTY_PATTERN, PATTERNS, parsedPattern, type Pattern } from './patterns';
import { mulberry32 } from './prng';
import { simConfig } from './sim.config';
import type { BiomeId, ChunkState, PickupKind } from './types';

const W = simConfig.world;

export const speedAt = (distance: number): number =>
  Math.min(simConfig.speed.max, simConfig.speed.base + simConfig.speed.perMeter * distance);

export const difficultyAt = (distance: number): number =>
  Math.min(5, 1 + Math.floor(distance / W.difficultyStepM));

export const biomeAt = (distance: number): BiomeId =>
  BIOMES[Math.floor(distance / W.biomeLengthM) % BIOMES.length]!;

/** Per-chunk RNG. PLAN says mulberry32(seed + index); mixing the seed first keeps seed 43 from being
 *  seed 42 shifted by one chunk. */
export const chunkRng = (seed: number, index: number): (() => number) =>
  mulberry32((Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0);

/** Patterns that may appear at this distance/biome, with pick weights favouring the ceiling. */
export function candidates(distance: number, biome: BiomeId): { pattern: Pattern; w: number }[] {
  const ceiling = difficultyAt(distance);
  return PATTERNS.filter((pt) => pt.difficulty <= ceiling && pt.biomes.includes(biome)).map(
    (pattern) => ({ pattern, w: 2 ** (pattern.difficulty - ceiling) }),
  );
}

function pickWeighted<T extends { w: number }>(items: readonly T[], rng: () => number): T {
  let r = rng() * items.reduce((sum, it) => sum + it.w, 0);
  for (const it of items) if ((r -= it.w) < 0) return it;
  return items[items.length - 1]!;
}

/** True if the first forced row of `pattern` at z0 comes too soon after `prev`'s last one. */
function forcedTooClose(pattern: Pattern, z0: number, prev: ChunkState | undefined): boolean {
  const first = parsedPattern(pattern).forced[0];
  const last = prev?.lastForced;
  if (first === undefined || last === undefined || last === null) return false;
  return z0 + first - last < speedAt(z0) * W.forcedGapS;
}

const MAX_TRIES = 8;

export function choosePattern(
  seed: number,
  index: number,
  prev: ChunkState | undefined,
): { pattern: Pattern; rng: () => number } {
  const rng = chunkRng(seed, index);
  const z0 = index * W.chunkLength;
  if (index < W.safeChunks) return { pattern: EMPTY_PATTERN, rng };
  const pool = candidates(z0, biomeAt(z0));
  for (let i = 0; i < MAX_TRIES; i++) {
    const { pattern } = pickWeighted(pool, rng);
    if (!forcedTooClose(pattern, z0, prev)) return { pattern, rng };
  }
  // Fall back to a pattern with no forced row; difficulty-1 always has some.
  const safe = pool.filter((c) => parsedPattern(c.pattern).forced.length === 0);
  return { pattern: pickWeighted(safe, rng).pattern, rng };
}

const PICKUP_KINDS = Object.entries(simConfig.powerups.weights).map(([kind, w]) => ({
  kind: kind as PickupKind,
  w,
}));

/** Build a chunk from a pattern. Ids are index·1000 + k (unique per run). */
export function buildChunk(
  index: number,
  pattern: Pattern,
  rng: () => number,
  biome: BiomeId = biomeAt(index * W.chunkLength),
  prev?: ChunkState,
): ChunkState {
  const z0 = index * W.chunkLength;
  const parsed = parsedPattern(pattern);
  let k = 0;
  const id = (): number => index * 1000 + k++;
  const pickups = parsed.pickupSpots
    .filter(() => rng() < simConfig.powerups.spawnChance)
    .map((spot) => ({
      id: id(),
      lane: spot.lane,
      z: z0 + spot.z,
      kind: pickWeighted(PICKUP_KINDS, rng).kind,
    }));
  return {
    index,
    z0,
    biome,
    patternId: pattern.id,
    difficulty: pattern.difficulty,
    obstacles: parsed.obstacles.map((o) => ({ ...o, id: id(), z: z0 + o.z })),
    coins: parsed.coins.map((c) => ({ ...c, id: id(), z: z0 + c.z })),
    pickups,
    forced: parsed.forced.map((z) => z0 + z),
    lastForced: parsed.forced.length > 0 ? z0 + parsed.forced.at(-1)! : (prev?.lastForced ?? null),
  };
}

export type ChunkSource = (seed: number, index: number, prev: ChunkState | undefined) => ChunkState;

export const generateChunk: ChunkSource = (seed, index, prev) => {
  const { pattern, rng } = choosePattern(seed, index, prev);
  return buildChunk(index, pattern, rng, undefined, prev);
};
