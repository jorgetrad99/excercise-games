import { describe, expect, it } from 'vitest';
import { BIOMES, PATTERNS, parsePattern, type Pattern } from './patterns';
import { simConfig as C } from './sim.config';
import { botRun, isolated } from './testing';
import type { Lane } from './types';
import { speedAt } from './worldgen';

const OBSTACLE = /[JSW]/;

describe('pattern library v1', () => {
  it('has ≥ 24 patterns covering difficulty 1–5 and every biome, with unique ids', () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(PATTERNS.map((p) => p.difficulty))).toEqual(new Set([1, 2, 3, 4, 5]));
    for (const biome of BIOMES) {
      for (let d = 1; d <= 5; d++) {
        expect(PATTERNS.some((p) => p.difficulty === d && p.biomes.includes(biome))).toBe(true);
      }
    }
    expect(new Set(PATTERNS.map((p) => p.id)).size).toBe(PATTERNS.length);
  });

  it.each(PATTERNS.map((p) => [p.id, p] as const))('%s follows the authoring rules', (_, p) => {
    const parsed = parsePattern(p);
    const near = [...p.rows].reverse();
    near.forEach((row, r) => {
      if (r < 3 || r > 10) expect(row, `row ${r}`).not.toMatch(OBSTACLE);
    });
    expect(parsed.forced.length).toBeLessThanOrEqual(1);
    // Difficulty 1 never forces a jump/slide: it's the generator's safe fallback.
    if (p.difficulty === 1) expect(parsed.forced).toEqual([]);
  });

  it('rejects malformed grids', () => {
    const bad = (rows: string[]): Pattern => ({
      id: `bad-${rows.join()}`,
      difficulty: 1,
      biomes: ['street'],
      rows,
    });
    expect(() => parsePattern(bad(['...']))).toThrow(/12 rows/);
    expect(() => parsePattern(bad([...Array<string>(11).fill('...'), '.X.']))).toThrow(/bad row/);
  });

  it('merges vertical wall runs into one obstacle and counts forced rows', () => {
    const parsed = parsePattern(PATTERNS.find((p) => p.id === 'd3-corridor-hurdle')!);
    const walls = parsed.obstacles.filter((o) => o.kind === 'wall');
    expect(walls.map((w) => [w.lane, w.z, w.len])).toEqual([
      [-1, 6, 14],
      [1, 6, 14],
    ]);
    expect(parsed.forced).toEqual([13]);
  });
});

/** Speeds a pattern can meet: from when its difficulty unlocks up to the cap. */
const speedsFor = (p: Pattern): number[] => [
  speedAt((p.difficulty - 1) * C.world.difficultyStepM),
  C.speed.max,
];

// The validator plays the real sim: a pattern is solvable if the planning bot gets through it from
// every start lane at both ends of its speed range, starting right at the chunk edge.
describe('solvability validator (every pattern × lane × speed, real physics)', () => {
  const cases = PATTERNS.flatMap((p) =>
    speedsFor(p).flatMap((speed) =>
      ([-1, 0, 1] as Lane[]).map((lane) => [p.id, speed, lane, p] as const),
    ),
  );
  const play = (pattern: Pattern, speed: number, lane: Lane) => {
    const index = 3;
    const z0 = index * C.world.chunkLength;
    return botRun(
      {
        seed: 1,
        chunkSource: isolated(pattern, index),
        startDistance: z0,
        startLane: lane,
        fixedSpeed: speed,
        skipCountdown: true,
      },
      (s) => s.distance > z0 + C.world.chunkLength + 4,
    );
  };

  it('fails impossible patterns (the validator can say no)', () => {
    const grid = (id: string, near: Record<number, string>): Pattern => ({
      id,
      difficulty: 1,
      biomes: ['street'],
      rows: Array.from({ length: 12 }, (_, i) => near[11 - i] ?? '...'),
    });
    expect(play(grid('x-full-wall', { 5: 'WWW' }), 12, 0).phase).toBe('over');
    expect(play(grid('x-diagonal', { 3: 'WW.', 4: '.WW' }), 26, 1).phase).toBe('over');
    expect(play(grid('x-jump-then-bar', { 4: 'JJJ', 5: 'SSS' }), 26, 0).phase).toBe('over');
  });

  it.each(cases)('%s at %d m/s from lane %d', (_, speed, lane, pattern) => {
    const end = play(pattern, speed, lane);
    expect(end.phase).toBe('running');
    expect(end.stats.crashes).toBe(0);
  });
});
