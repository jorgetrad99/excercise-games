// ?record=1 fixture recorder: keeps the last 30 s of PoseFrames and downloads them as JSON.
import type { ModelVariant, PoseFrame } from './types';

export const RECORD_WINDOW_MS = 30_000;

/** On-disk fixture format for fixtures/pose/*.json. Landmarks are raw (unmirrored); t starts at 0. */
export interface PoseFixture {
  version: 1;
  recordedAt: string;
  model: ModelVariant;
  video: { width: number; height: number };
  frames: PoseFrame[];
}

/** Fixture time: ms since `t0`, 0.1 ms resolution. */
export const rebaseT = (t: number, t0: number): number => Math.round((t - t0) * 10) / 10;

/** A live frame as a fixture stores it: rebased t, no live timing. */
export const rebaseFrame = (f: PoseFrame, t0: number): PoseFrame => ({
  t: rebaseT(f.t, t0),
  poses: f.poses,
  ...(f.world ? { world: f.world } : {}),
});

export function createRecorder(windowMs = RECORD_WINDOW_MS) {
  const frames: PoseFrame[] = [];
  return {
    push(frame: PoseFrame): void {
      frames.push(frame);
      const cutoff = frame.t - windowMs;
      let drop = 0;
      while (frames[drop] && frames[drop]!.t < cutoff) drop++;
      if (drop > 0) frames.splice(0, drop);
    },
    snapshot(meta: Pick<PoseFixture, 'model' | 'video'>, recordedAt = new Date()): PoseFixture {
      const t0 = frames[0]?.t ?? 0;
      return {
        version: 1,
        recordedAt: recordedAt.toISOString(),
        ...meta,
        frames: frames.map((f) => rebaseFrame(f, t0)),
      };
    },
  };
}

export function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
