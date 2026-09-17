// Bake the CC0 UAL head reaction into character-space quaternion deltas. No runtime retarget cost.
// Usage: node scripts/vendor-boxing-reaction.mjs <AnimationLibrary_Godot_Standard.glb>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  AnimationClip,
  AnimationMixer,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';

const bytes = readFileSync(process.argv[2]);
const length = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + length));
const binary = bytes.subarray(28 + length);
function data(id) {
  const a = gltf.accessors[id],
    v = gltf.bufferViews[a.bufferView];
  const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return Array.from({ length: a.count * size }, (_, i) => binary.readFloatLE(start + i * 4));
}
const nodes = gltf.nodes.map((n) => {
  const o = new Object3D();
  o.name = n.name.replaceAll('.', '');
  if (n.translation) o.position.fromArray(n.translation);
  if (n.rotation) o.quaternion.fromArray(n.rotation);
  if (n.scale) o.scale.fromArray(n.scale);
  return o;
});
gltf.nodes.forEach((n, i) => n.children?.forEach((child) => nodes[i].add(nodes[child])));
const root = new Object3D();
gltf.scenes[0].nodes.forEach((i) => root.add(nodes[i]));
const source = gltf.animations.find((a) => a.name === 'Hit_Head');
const tracks = source.channels.map((c) => {
  const sample = source.samplers[c.sampler];
  const rotation = c.target.path === 'rotation';
  const Track = rotation ? QuaternionKeyframeTrack : VectorKeyframeTrack;
  const prop = rotation ? 'quaternion' : c.target.path === 'translation' ? 'position' : 'scale';
  return new Track(`${nodes[c.target.node].name}.${prop}`, data(sample.input), data(sample.output));
});
const clip = new AnimationClip('Hit_Head', -1, tracks);
const mixer = new AnimationMixer(root),
  action = mixer.clipAction(clip).play();
const head = nodes.find((o) => o.name === 'DEF-head');
action.time = 0;
mixer.update(0);
root.updateMatrixWorld(true);
const neutral = head.getWorldQuaternion(new Quaternion()).invert();
const values = [],
  times = [];
for (let i = 0; i <= 26; i++) {
  const t = (clip.duration * i) / 26;
  action.time = Math.min(t, clip.duration - 0.00001);
  mixer.update(0);
  root.updateMatrixWorld(true);
  times.push(t);
  values.push(...head.getWorldQuaternion(new Quaternion()).multiply(neutral).normalize().toArray());
}
const out = 'public/assets/quaternius/boxing';
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/hit-head.json`, JSON.stringify({ duration: clip.duration, times, values }));
console.log(`Baked Hit_Head: ${times.length} samples, ${clip.duration}s`);
