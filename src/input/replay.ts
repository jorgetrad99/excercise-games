// Replay InputSource (?input=replay:<fixture>): a recorded PoseFixture through the same pose path.
import type { GestureConfig } from '../pose/gestures.config';
import type { PoseFixture } from '../pose/recorder';
import { createPoseSource, type PoseSource } from './pose-source';

export interface ReplayOptions {
  /** 'instant' pushes every frame synchronously on start(); event t = fixture time. */
  mode?: 'instant' | 'realtime';
  config?: GestureConfig;
  now?: () => number;
}

export interface ReplaySource extends PoseSource {
  /** Resolves after the last frame was pushed. */
  done: Promise<void>;
}

export function createReplaySource(
  fixture: PoseFixture,
  { mode = 'realtime', config, now = () => performance.now() }: ReplayOptions = {},
): ReplaySource {
  const pose = createPoseSource({
    video: () => fixture.video,
    now,
    tickMs: 0,
    ...(config ? { config } : {}),
  });
  let finish = (): void => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  let timer: ReturnType<typeof setTimeout> | undefined;

  function playRealtime(): void {
    const t0 = now();
    let i = 0;
    const step = (): void => {
      const elapsed = now() - t0;
      for (let f = fixture.frames[i]; f && f.t <= elapsed; f = fixture.frames[++i]) {
        pose.push({ t: t0 + f.t, poses: f.poses }); // rebase onto the live clock, like keyboard events
      }
      if (i < fixture.frames.length) timer = setTimeout(step, 8);
      else finish();
    };
    step();
  }

  return {
    ...pose,
    done,
    start() {
      pose.start();
      if (mode === 'realtime') return playRealtime();
      for (const f of fixture.frames) pose.push(f);
      finish();
    },
    stop() {
      clearTimeout(timer);
      pose.stop();
    },
  };
}
