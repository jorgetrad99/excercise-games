// Pose InputSource: PoseFrames → gesture engine → a game's InputEvents. The only place pose and core events meet.
import type { InputEvent, InputEventType } from '../core/input';
import type { VideoSize } from '../pose/body';
import {
  createGestureEngine,
  type GestureEvent,
  type GestureEventType,
  type SignalFrame,
} from '../pose/gestures';
import type { GestureConfig } from '../pose/gestures.config';
import type { PoseFrame } from '../pose/types';
import { createListeners, type InputSource } from './source';

/** Gesture engine events → a game's InputEvents (the game's GestureProfile owns the table). */
export type GestureMap = Partial<Record<GestureEventType, InputEventType>>;

export interface PoseSource extends InputSource {
  push(frame: PoseFrame): void;
  onSignals(cb: (s: SignalFrame) => void): () => void;
  /** Keyboard `C` → forget calibration. */
  recalibrate(t: number): void;
}

export interface PoseSourceOptions {
  video: () => VideoSize;
  toInput: GestureMap;
  config?: GestureConfig;
  now?: () => number;
  /** How often to check for tracking loss when no frames arrive; 0 = never (replay). */
  tickMs?: number;
}

export function createPoseSource({
  video,
  toInput,
  config,
  now = () => performance.now(),
  tickMs = 100,
}: PoseSourceOptions): PoseSource {
  const engine = createGestureEngine(config ? { video, config } : { video });
  const events = createListeners<InputEvent>();
  const signals = createListeners<SignalFrame>();
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const emit = (gestures: GestureEvent[]): void => {
    if (!running) return;
    for (const g of gestures) {
      const type = toInput[g.type];
      if (type) events.emit({ t: g.t, type });
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      if (tickMs > 0) timer = setInterval(() => emit(engine.tick(now())), tickMs);
    },
    stop() {
      running = false;
      clearInterval(timer);
    },
    onEvent: events.add,
    onSignals: signals.add,
    push(frame) {
      const r = engine.push(frame);
      signals.emit(r.signals);
      emit(r.events);
    },
    recalibrate: (t) => emit(engine.recalibrate(t)),
  };
}
