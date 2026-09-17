// Replay InputSource (?input=replay:<fixture>): a recorded PoseFixture through the same pose path
// as the live camera, including the 2-player split (?players=2).
import { gestureConfig, type GestureConfig } from '../pose/gestures.config';
import type { PoseFixture } from '../pose/recorder';
import { createPosePlayers, type PosePlayers } from './pose-players';
import type { GestureMap } from './pose-source';

export interface ReplayOptions {
  /** 'instant' pushes every frame synchronously on start(); event t = fixture time. */
  mode?: 'instant' | 'realtime';
  toInput: GestureMap;
  config?: GestureConfig;
  players?: 1 | 2;
  now?: () => number;
  canRecalibrate?: (player: number) => boolean;
}

export interface ReplaySource extends PosePlayers {
  /** Resolves after the last frame was pushed. */
  done: Promise<void>;
}

export function createReplaySource(
  fixture: PoseFixture,
  {
    mode = 'realtime',
    toInput,
    config = gestureConfig,
    players = 1,
    now = () => performance.now(),
    canRecalibrate,
  }: ReplayOptions,
): ReplaySource {
  const pose = createPosePlayers({
    players,
    video: () => fixture.video,
    toInput,
    config,
    now,
    tickMs: 0,
    ...(canRecalibrate ? { canRecalibrate } : {}),
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
