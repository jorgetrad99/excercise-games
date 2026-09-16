import { describe, expect, it } from 'vitest';
import { createOneEuro } from './one-euro';

const cfg = { minCutoff: 1, beta: 0.007, dCutoff: 1 };

describe('createOneEuro', () => {
  it('passes the first value through and holds a constant signal exactly', () => {
    const f = createOneEuro(cfg);
    expect(f(100, 0)).toBe(100);
    for (let t = 33; t < 1000; t += 33) expect(f(100, t)).toBeCloseTo(100, 10);
  });

  it('suppresses jitter when still but follows a fast move with little lag (beta > 0)', () => {
    const still = createOneEuro(cfg);
    let maxDev = 0;
    for (let i = 0; i < 60; i++) {
      const y = still(500 + (i % 2 ? 4 : -4), i * 33);
      if (i >= 10) maxDev = Math.max(maxDev, Math.abs(y - 500)); // first samples pass through by design
    }
    expect(maxDev).toBeLessThan(2); // ±4 px input jitter

    // 300 px step, 4 frames later: with beta > 85 % there, beta = 0 only about half.
    const fast = createOneEuro(cfg);
    const noBeta = createOneEuro({ ...cfg, beta: 0 });
    for (const f of [fast, noBeta]) for (let t = 0; t <= 330; t += 33) f(0, t);
    let a = 0;
    let b = 0;
    for (let t = 363; t <= 462; t += 33) {
      a = fast(300, t);
      b = noBeta(300, t);
    }
    expect(a).toBeGreaterThan(250);
    expect(b).toBeLessThan(200); // 1 Hz low-pass: 1 - 0.83^4 ≈ 53 % after 4 frames
  });
});
