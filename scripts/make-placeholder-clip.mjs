// Builds the INTERIM fake-camera clip for the M1 e2e (not a real fixture; Jorge's clips replace it).
// Source: MediaPipe testdata image (Apache-2.0, see CREDITS.md), swayed/bobbed on a 1280x720 canvas.
// Needs ffmpeg on PATH. Output is committed, so verify itself doesn't need ffmpeg.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const SRC = 'https://storage.googleapis.com/mediapipe-assets/tasks/testdata/vision/male_full_height_hands.jpg';
const SHA256 = '8a7fe5be8b90d6078b09913ca28f7e5d342f8d3cde856ab4e3327d2970b887f8';
const OUT = 'tests/e2e/assets/placeholder-person.mjpeg';

const res = await fetch(SRC);
const img = Buffer.from(await res.arrayBuffer());
if (createHash('sha256').update(img).digest('hex') !== SHA256) throw new Error('source image hash mismatch');
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/placeholder-src.jpg', img);

// Person scaled to 620 px tall; x sways ±200 px (lean), y bobs 40 px (jump-ish). 4 s @ 30 fps; Chrome loops it.
const overlay = "overlay=x='(W-w)/2+200*sin(2*PI*t/4)':y='(H-h)/2-40*abs(sin(2*PI*t))'";
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=0xd8d8d8:s=1280x720:r=30:d=4',
  '-loop', '1', '-i', 'tmp/placeholder-src.jpg',
  '-filter_complex', `[1:v]scale=-2:620[p];[0:v][p]${overlay}:shortest=1,format=yuvj420p`,
  '-t', '4', '-r', '30', '-q:v', '5', '-f', 'mjpeg', OUT,
], { stdio: 'inherit' });
console.log(`wrote ${OUT}`);
