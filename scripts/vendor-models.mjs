// Vendors MediaPipe wasm (from the pinned npm package) and the pinned pose model into public/models/.
// No runtime CDN: the app loads everything from /models/. Re-run after bumping @mediapipe/tasks-vision.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'public/models';
const MODEL = {
  file: 'pose_landmarker_full.task',
  // Pinned model version "1" (not "latest"); md5 from the GCS x-goog-hash header.
  url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  md5: 'g4eWidNz0UO+CUyXI1Xkjg==',
};
const md5 = (buf) => createHash('md5').update(buf).digest('base64');

mkdirSync(OUT, { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm', `${OUT}/wasm`, { recursive: true });

const dest = `${OUT}/${MODEL.file}`;
if (!existsSync(dest) || md5(readFileSync(dest)) !== MODEL.md5) {
  const res = await fetch(MODEL.url);
  if (!res.ok) throw new Error(`${MODEL.url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (md5(buf) !== MODEL.md5) throw new Error(`${MODEL.file}: md5 mismatch, refusing to vendor`);
  writeFileSync(dest, buf);
}
console.log(`vendored ${OUT}/wasm and ${dest}`);
