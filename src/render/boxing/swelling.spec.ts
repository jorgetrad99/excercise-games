import { SphereGeometry, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { createSwelling } from './swelling';
import { boxingVisual as V } from './visual.config';

const R = 0.3;
// Same shapes as big-head.ts: a front cap (the face) over a full sphere (the shell).
const shapes = () => {
  const face = new SphereGeometry(R, 32, 24, Math.PI / 2 - 1.05, 2.1, Math.PI / 2 - 1.1, 2.2);
  const shell = new SphereGeometry(R * 0.985, 32, 24);
  return { face, shell, swell: createSwelling(face, [shell]) };
};
const radii = (g: BufferGeometry) => {
  const p = g.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) =>
    new Vector3().fromBufferAttribute(p, i).length(),
  );
};
/** Largest radius on the +x (anatomical left) and −x cheek sides, clear of the midline. */
const sides = (g: BufferGeometry) => {
  const p = g.getAttribute('position');
  const out = { left: 0, right: 0 };
  for (let i = 0; i < p.count; i++) {
    const v = new Vector3().fromBufferAttribute(p, i);
    if (v.x > 0.1) out.left = Math.max(out.left, v.length());
    if (v.x < -0.1) out.right = Math.max(out.right, v.length());
  }
  return out;
};

describe('head swelling', () => {
  it('no damage leaves both surfaces exactly spherical', () => {
    const { face, shell, swell } = shapes();
    swell([0, 0, 0]);
    radii(face).forEach((r) => expect(r).toBeCloseTo(R, 6));
    radii(shell).forEach((r) => expect(r).toBeCloseTo(R * 0.985, 6));
  });

  it('bulges the hit side by up to swellM, on the cap and the shell alike', () => {
    const { face, shell, swell } = shapes();
    swell([1, 0, 0]); // anatomical left cheek
    for (const [g, r] of [
      [face, R],
      [shell, R * 0.985],
    ] as const) {
      const s = sides(g);
      expect(s.left - r).toBeGreaterThan(V.swellM * 0.8);
      expect(s.left - r).toBeLessThanOrEqual(V.swellM + 1e-6); // Float32 positions
      expect(s.right - r).toBeLessThan(V.swellM * 0.1);
    }
  });

  it('grows with damage and goes back when damage resets', () => {
    const { face, swell } = shapes();
    swell([0.25, 0, 0]);
    const small = sides(face).left;
    swell([1, 0, 0]);
    expect(sides(face).left).toBeGreaterThan(small);
    swell([0, 0, 0]);
    radii(face).forEach((r) => expect(r).toBeCloseTo(R, 6));
  });

  it('a chin hit bulges low on the face, not a cheek', () => {
    const { face, swell } = shapes();
    swell([0, 0, 1]);
    const p = face.getAttribute('position');
    let top = { r: 0, y: 0 };
    for (let i = 0; i < p.count; i++) {
      const v = new Vector3().fromBufferAttribute(p, i);
      if (v.length() > top.r) top = { r: v.length(), y: v.y };
    }
    expect(top.y).toBeLessThan(0);
  });
});
