import { describe, expect, it } from 'vitest';
import { PATTERNS } from './patterns';
import { simConfig as C } from './sim.config';
import type { ChunkState } from './types';
import { biomeAt, difficultyAt, generateChunk, speedAt } from './worldgen';

const run = (seed: number, n: number): ChunkState[] => {
  const out: ChunkState[] = [];
  for (let i = 0; i < n; i++) out.push(generateChunk(seed, i, out.at(-1)));
  return out;
};

describe('worldgen', () => {
  it('ramps speed, difficulty and biome with distance (PLAN §2.3)', () => {
    expect([speedAt(0), speedAt(100), speedAt(700), speedAt(5000)]).toEqual([12, 14, 26, 26]);
    expect([difficultyAt(0), difficultyAt(299), difficultyAt(300), difficultyAt(9000)]).toEqual([
      1, 1, 2, 5,
    ]);
    expect([biomeAt(0), biomeAt(999), biomeAt(1000), biomeAt(2000)]).toEqual([
      'street',
      'street',
      'park',
      'street',
    ]);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const ids = (seed: number) => run(seed, 200).map((c) => c.patternId);
    expect(ids(42)).toEqual(ids(42));
    expect(ids(42)).not.toEqual(ids(43));
    expect(ids(43).slice(1)).not.toEqual(ids(42).slice(0, -1)); // not just shifted by one chunk
  });

  it('starts with empty run-up chunks and gives unique ids', () => {
    const chunks = run(7, 100);
    for (const c of chunks.slice(0, C.world.safeChunks)) expect(c.patternId).toBe('empty');
    const ids = chunks.flatMap((c) => [...c.obstacles, ...c.coins, ...c.pickups].map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('respects difficulty ceiling and biome tags, reaching every difficulty over a long run', () => {
    const seen = new Set<number>();
    for (const seed of [1, 2, 3, 42]) {
      for (const c of run(seed, 250)) {
        const pattern = PATTERNS.find((p) => p.id === c.patternId);
        if (!pattern) continue; // run-up chunk
        expect(pattern.difficulty).toBeLessThanOrEqual(difficultyAt(c.z0));
        expect(pattern.biomes).toContain(c.biome);
        seen.add(pattern.difficulty);
      }
    }
    expect(seen).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('never puts two forced rows within 1.5 s of travel', () => {
    for (let seed = 0; seed < 50; seed++) {
      const forced = run(seed, 150).flatMap((c) => c.forced);
      for (let i = 1; i < forced.length; i++) {
        const gap = forced[i]! - forced[i - 1]!;
        expect(gap, `seed ${seed} at z=${forced[i]}`).toBeGreaterThanOrEqual(
          speedAt(forced[i - 1]!) * C.world.forcedGapS,
        );
      }
    }
  });

  it('spawns power-ups rarely from P spots', () => {
    const pickups = [1, 2, 3, 4, 5].flatMap((seed) => run(seed, 300).flatMap((c) => c.pickups));
    expect(pickups.length).toBeGreaterThan(5);
    expect(new Set(pickups.map((p) => p.kind))).toEqual(
      new Set(['magnet', 'double', 'hoverboard', 'token']),
    );
  });
});
