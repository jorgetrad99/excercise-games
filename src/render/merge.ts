// Draw-call reduction: OBJ-converted Quaternius models carry one flat-colour material per part (a car
// is ~8 draw calls). Bake each untextured part's colour into vertex colours and merge them into one
// mesh; textured parts (tree leaves/bark) stay separate because their maps differ.
import {
  BufferAttribute,
  Color,
  Matrix4,
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Part } from './models';

const isFlat = (m: Material | Material[]): m is MeshStandardMaterial =>
  !Array.isArray(m) && m instanceof MeshStandardMaterial && !m.map && !m.alphaMap && !m.transparent;

function bake(part: Part & { material: MeshStandardMaterial }): BufferGeometry {
  const g = (
    part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone()
  ).applyMatrix4(part.local);
  for (const name of Object.keys(g.attributes))
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const c = new Color().copy(part.material.color); // linear working colour space, as vertex colours expect
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

export function mergeFlatParts(parts: Part[]): Part[] {
  const flat = parts.filter((p): p is Part & { material: MeshStandardMaterial } =>
    isFlat(p.material),
  );
  if (flat.length < 2) return parts;
  const merged = mergeGeometries(flat.map(bake));
  if (!merged) return parts;
  const roughness = flat.reduce((a, p) => a + p.material.roughness, 0) / flat.length;
  const material = new MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
  return [
    { geometry: merged, material, local: new Matrix4() },
    ...parts.filter((p) => !isFlat(p.material)),
  ];
}
