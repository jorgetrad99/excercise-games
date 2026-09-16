import { describe, expect, it } from 'vitest';
import { mulberry32 } from './prng';

const take = (next: () => number, n: number) => Array.from({ length: n }, next);

describe('mulberry32', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = take(mulberry32(42), 1000);
    expect(take(mulberry32(42), 1000)).toEqual(a);
    expect(take(mulberry32(43), 1000)).not.toEqual(a);
    expect(a.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});
