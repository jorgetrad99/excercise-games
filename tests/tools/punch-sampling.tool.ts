// Does pose-fps alone explain missed punches? Synthetic straights of different speeds, sampled at
// different pose rates and sampling phases, through the real gesture engine: detection rate per cell.
// Synthetic motion is linear (constant speed), so it is an upper bound: it ignores motion blur and
// MediaPipe losing a fast wrist, both of which get worse, not better, at low fps.
//   pnpm vitest run --config vitest.tools.config.ts punch-sampling
import { mkdir, writeFile } from 'node:fs/promises';
import { it } from 'vitest';
import { createGestureEngine } from '../../src/pose/gestures';
import { CALIBRATE, script, syntheticPose } from '../../src/pose/testdata/synthetic';
import type { PoseFrame } from '../../src/pose/types';

const FPS = [30, 25, 20, 15, 12, 10];
const OUT_MS = [60, 90, 120, 160, 220];
const PHASES = 8;

/** hold: ms at full extension; amp: how far the fist travels (1 = the synthetic full straight). */
const STYLES = [
  { name: 'hold 80 amp 1', hold: 80, amp: 1 },
  { name: 'snap amp 1', hold: 0, amp: 1 },
  { name: 'snap amp 0.7', hold: 0, amp: 0.7 },
  { name: 'snap amp 0.5', hold: 0, amp: 0.5 },
  { name: 'snap amp 0.3', hold: 0, amp: 0.3 },
  { name: 'snap amp 0.2', hold: 0, amp: 0.2 },
];

/** Continuous punch profile: rest, out in outMs (smoothstep), hold, back in outMs. */
function extension(t: number, outMs: number, hold: number, amp: number): number {
  const ease = (k: number) => k * k * (3 - 2 * k);
  if (t < 0) return 0;
  if (t < outMs) return amp * ease(t / outMs);
  if (t < outMs + hold) return amp;
  if (t < 2 * outMs + hold) return amp * (1 - ease((t - outMs - hold) / outMs));
  return 0;
}

function detected(
  fps: number,
  outMs: number,
  phaseMs: number,
  { hold, amp }: (typeof STYLES)[number],
): boolean {
  const engine = createGestureEngine({ video: () => ({ width: 1280, height: 720 }) });
  // Calibrate with the keyframe script, then sample the punch at arbitrary instants: the keyframe
  // sampler always lands a frame on each keyframe, which would hand every punch its peak for free.
  const calib = script([CALIBRATE, { ms: 300, to: {} }], { fps, base: { fists: 'ready' } });
  const onset = calib.at(-1)!.t + 1000 / fps + phaseMs;
  const frames: PoseFrame[] = [...calib];
  for (let t = calib.at(-1)!.t + 1000 / fps; t < onset + 2 * outMs + hold + 800; t += 1000 / fps) {
    const pose = syntheticPose(
      { fists: 'ready', punchR: extension(t - onset, outMs, hold, amp) },
      frames.length,
    );
    frames.push({ t: Math.round(t * 10) / 10, poses: pose ? [pose] : [] });
  }
  const events = frames.flatMap((f) => engine.push(f).events.map((e) => e.type));
  return events.includes('PUNCH_RIGHT');
}

it('punch detection rate vs pose fps', async () => {
  const table: Record<string, Record<string, number>> = {};
  for (const style of STYLES)
    for (const outMs of OUT_MS) {
      const row: Record<string, number> = {};
      for (const fps of FPS) {
        let hits = 0;
        for (let p = 0; p < PHASES; p++)
          if (detected(fps, outMs, ((p / PHASES) * 1000) / fps, style)) hits++;
        row[`${fps}fps`] = hits / PHASES;
      }
      table[`${style.name}, out ${outMs} ms`] = row;
    }
  console.table(table);
  await mkdir('tmp/perf', { recursive: true });
  await writeFile('tmp/perf/punch-sampling.json', JSON.stringify(table, null, 2));
});
