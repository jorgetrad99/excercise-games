// 1 or 2 pose players on one camera (PLAN §2.5 local): PoseFrame → per-player frames (zone split) →
// one gesture engine each → per-player InputEvents, plus "one body missing > 2 s pauses both".
import type { InputEvent } from '../core/input';
import type { VideoSize } from '../pose/body';
import type { SignalFrame } from '../pose/gestures';
import type { GestureConfig } from '../pose/gestures.config';
import { createPauseBoth, createPlayerSplitter } from '../pose/players';
import type { PoseFrame } from '../pose/types';
import { createPoseSource, type GestureMap } from './pose-source';
import { createListeners } from './source';

/** Center-line hysteresis for a lone body, normalized x. ≈ half a shoulder width at 2.5–3 m. */
const SPLIT_HYSTERESIS = 0.06;
/** PLAN §2.5: only one pose visible for longer than this (ms) pauses both runs. */
const PAUSE_BOTH_MS = 2000;

export interface PosePlayersOptions {
  players: 1 | 2;
  video: () => VideoSize;
  toInput: GestureMap;
  config: GestureConfig;
  now?: () => number;
  tickMs?: number;
}

export interface PosePlayers {
  push(frame: PoseFrame): void;
  onEvent(cb: (e: InputEvent & { player: number }) => void): () => void;
  onSignals(cb: (s: SignalFrame & { player: number }) => void): () => void;
  recalibrate(t: number): void;
  start(): void;
  stop(): void;
}

export function createPosePlayers({ players, config, ...rest }: PosePlayersOptions): PosePlayers {
  if (players === 2 && config.laneMode === 'zones') {
    // Zones are thirds of the whole frame; each player only has half of it.
    console.warn('laneMode "zones" is 1-player only; using "lean" for 2 players');
    config = { ...config, laneMode: 'lean' };
  }
  const sources = Array.from({ length: players }, () => createPoseSource({ ...rest, config }));
  const events = createListeners<InputEvent & { player: number }>();
  const signals = createListeners<SignalFrame & { player: number }>();
  const split = createPlayerSplitter({
    visibilityMin: config.visibilityMin,
    hysteresis: SPLIT_HYSTERESIS,
    forgetMs: config.trackingLostMs,
  });
  const pauseBoth = createPauseBoth(PAUSE_BOTH_MS);
  /** Both runs are held by the pause-both rule: only its own RESUME may release them. */
  let bothPaused = false;
  let running = false;
  sources.forEach((s, player) => {
    s.onEvent((e) => {
      if (!(bothPaused && e.type === 'RESUME')) events.emit({ ...e, player });
    });
    s.onSignals((sig) => signals.emit({ ...sig, player }));
  });

  return {
    push(frame) {
      if (players === 1) return sources[0]!.push(frame);
      const frames = split(frame);
      frames.forEach((f, i) => sources[i]!.push(f));
      if (!running) return;
      const both = pauseBoth(frame.t, frames.filter((f) => f.poses.length > 0).length);
      if (!both) return;
      bothPaused = both === 'PAUSE';
      for (const player of [0, 1]) events.emit({ t: frame.t, type: both, player });
    },
    onEvent: events.add,
    onSignals: signals.add,
    recalibrate: (t) => sources.forEach((s) => s.recalibrate(t)),
    start() {
      running = true;
      sources.forEach((s) => s.start());
    },
    stop() {
      running = false;
      sources.forEach((s) => s.stop());
    },
  };
}
