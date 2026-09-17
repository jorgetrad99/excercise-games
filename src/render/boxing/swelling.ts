// Swelling: the head's surface bulges outward where bruises build up, so a beaten face changes shape
// and catches light differently, not just colour. Geometry-only, recomputed when damage changes.
import { MathUtils, Vector3, type BufferGeometry } from 'three';
import { BRUISE_SPOTS } from './face-damage';
import type { FaceDamage } from './presentation';
import { boxingVisual as V } from './visual.config';

const v = new Vector3();
const n = new Vector3();

/** `face`: the textured cap (its UVs locate each painted bruise). `others`: surfaces that must bulge
 * the same way (the head shell under the cap). All share one centre, so they stay concentric. */
export function createSwelling(face: BufferGeometry, others: readonly BufferGeometry[] = []) {
  const uv = face.getAttribute('uv');
  const pos = face.getAttribute('position');
  // Bump centre = direction of the cap vertex nearest to where the bruise is painted.
  const centres = BRUISE_SPOTS.map(([x, y]) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < uv.count; i++) {
      const d = (uv.getX(i) - x) ** 2 + (uv.getY(i) - (1 - y)) ** 2; // canvas y down, uv v up
      if (d < bestD) [best, bestD] = [i, d];
    }
    return new Vector3().fromBufferAttribute(pos, best).normalize();
  });
  const surfaces = [face, ...others].map((g) => ({
    g,
    rest: Float32Array.from(g.getAttribute('position').array),
    restNormals: Float32Array.from(g.getAttribute('normal').array),
  }));
  const cutoff = 3 * V.swellRad;

  return (damage: FaceDamage): void => {
    for (const { g, rest, restNormals } of surfaces) {
      const p = g.getAttribute('position');
      const touched: number[] = [];
      for (let i = 0; i < p.count; i++) {
        v.fromArray(rest, i * 3);
        const r = v.length();
        n.copy(v).divideScalar(r || 1);
        let bump = 0;
        centres.forEach((c, zone) => {
          const angle = Math.acos(MathUtils.clamp(n.dot(c), -1, 1));
          if (angle < cutoff && damage[zone])
            bump += damage[zone] * V.swellM * Math.exp(-(angle * angle) / (2 * V.swellRad ** 2));
        });
        if (bump > 0) touched.push(i);
        p.setXYZ(i, n.x * (r + bump), n.y * (r + bump), n.z * (r + bump));
      }
      p.needsUpdate = true;
      // Recomputed normals show the bulge in the lighting; untouched vertices keep the exact sphere
      // normals (a recompute would crease the sphere's UV seam and poles).
      g.computeVertexNormals();
      const normal = g.getAttribute('normal');
      const keep = new Set(touched);
      for (let i = 0; i < normal.count; i++)
        if (!keep.has(i))
          normal.setXYZ(i, restNormals[i * 3]!, restNormals[i * 3 + 1]!, restNormals[i * 3 + 2]!);
      g.computeBoundingSphere();
      g.computeBoundingBox();
    }
  };
}
