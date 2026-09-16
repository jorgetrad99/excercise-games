// Vendors MediaPipe wasm (from the pinned npm package) and the pinned pose models into public/models/.
// No runtime CDN: the app loads everything from /models/. Re-run after bumping @mediapipe/tasks-vision.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'public/models';
const BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
// Pinned model version "1" (not "latest"); md5 from the GCS x-goog-hash header.
const MODELS = {
  lite: 'BKdd33yBGsehpFIyZt19iA==',
  full: 'g4eWidNz0UO+CUyXI1Xkjg==',
  heavy: 'RT3sTQLMxNPOgStt6E+lFg==',
};
const md5 = (buf) => createHash('md5').update(buf).digest('base64');

mkdirSync(OUT, { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm', `${OUT}/wasm`, { recursive: true });

for (const [variant, hash] of Object.entries(MODELS)) {
  const file = `pose_landmarker_${variant}.task`;
  const dest = `${OUT}/${file}`;
  if (existsSync(dest) && md5(readFileSync(dest)) === hash) continue;
  const url = `${BASE}/pose_landmarker_${variant}/float16/1/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (md5(buf) !== hash) throw new Error(`${file}: md5 mismatch, refusing to vendor`);
  writeFileSync(dest, buf);
}
console.log(`vendored ${OUT}/wasm and ${Object.keys(MODELS).length} pose models`);
