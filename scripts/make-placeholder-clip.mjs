// Builds the INTERIM fake-camera clips for the e2e (not real fixtures; Jorge's clips replace them):
// one person (M1) and two people side by side (local 2-player perf, Phase 2 Piece 3).
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

// Two copies, 520 px tall, centered at 27 % and 73 % of the width, swaying ±50 px in opposite phase:
// they never reach the center line, so each stays in its player's half.
const TWO_OUT = 'tests/e2e/assets/placeholder-two-people.mjpeg';
const at = (cx, sign) => `x='W*${cx}-w/2+${sign}50*sin(2*PI*t/4)':y='(H-h)/2-30*abs(sin(2*PI*t))'`;
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=0xd8d8d8:s=1280x720:r=30:d=4',
  '-loop', '1', '-i', 'tmp/placeholder-src.jpg',
  '-filter_complex',
  `[1:v]scale=-2:520,split[a][b];[0:v][a]overlay=${at(0.27, '+')}:shortest=1[l];` +
    `[l][b]overlay=${at(0.73, '-')}:shortest=1,format=yuvj420p`,
  '-t', '4', '-r', '30', '-q:v', '5', '-f', 'mjpeg', TWO_OUT,
], { stdio: 'inherit' });
console.log(`wrote ${TWO_OUT}`);
