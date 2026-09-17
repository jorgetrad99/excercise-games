// Input-to-screen latency by stage, plus frame pacing / render judder (?latency=1, __game.getLatency()).
// All timestamps are performance.now() ms. What software can't see: sensor exposure + USB/driver time
// before the browser's captureTime, and display scan-out after the frame is handed to the compositor.
import type { InputEvent } from '../core/input';
import type { FrameTiming } from '../pose/types';

export interface Stat {
  p50: number;
  p95: number;
  mean: number;
  n: number;
}

interface EventSample {
  type: string;
  timing: FrameTiming | null;
  /** When the InputSource emitted it (gesture engine done / key handler ran). */
  eventT: number;
  /** For keyboard: the OS input timestamp (KeyboardEvent.timeStamp) carried as InputEvent.t. */
  inputT: number;
  appliedT?: number;
  renderedT?: number;
  nextFrameT?: number;
}

const MAX = 300;

function stat(values: number[]): Stat {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p: number): number => v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? NaN;
  return {
    p50: q(0.5),
    p95: q(0.95),
    mean: v.reduce((a, b) => a + b, 0) / (v.length || 1),
    n: v.length,
  };
}

const push = <T>(arr: T[], x: T): void => {
  arr.push(x);
  if (arr.length > MAX) arr.shift();
};

export function createLatencyTracker() {
  const frames: FrameTiming[] = [];
  const events: EventSample[] = [];
  const byEvent = new WeakMap<InputEvent, EventSample>();
  let awaitingRender: EventSample[] = [];
  let awaitingNextFrame: EventSample[] = [];
  const frameDt: number[] = [];
  const judder = { distance: [] as number[], lateral: [] as number[] };
  const engine: number[] = [];
  let lastFrameT: number | null = null;
  let last: Drawn | null = null;

  return {
    /** A pose frame reached the gesture engine. */
    poseFrame(timing: FrameTiming | undefined, engineMs: number): void {
      if (timing) push(frames, timing);
      push(engine, engineMs);
    },
    /** An InputEvent was emitted; `timing` = the pose frame it came from (null for keyboard/inject). */
    event(e: InputEvent, timing: FrameTiming | null, now: number): void {
      const s: EventSample = { type: e.type, timing, eventT: now, inputT: e.t };
      byEvent.set(e, s);
      push(events, s);
    },
    /** Start of an animation frame (rAF timestamp + now), before the sim steps with `applied`. */
    frameStart(rafT: number, now: number, applied: readonly InputEvent[]): void {
      for (const s of awaitingNextFrame) s.nextFrameT = now;
      awaitingNextFrame = [];
      for (const e of applied) {
        const s = byEvent.get(e);
        if (!s) continue;
        s.appliedT = now;
        awaitingRender.push(s);
      }
      if (lastFrameT !== null) push(frameDt, rafT - lastFrameT);
      lastFrameT = rafT;
    },
    /** renderer.render() returned. `drawn` = what was drawn (null when not running), for judder. */
    rendered(now: number, drawn: Drawn | null): void {
      for (const s of awaitingRender) {
        s.renderedT = now;
        awaitingNextFrame.push(s);
      }
      awaitingRender = [];
      const dt = (frameDt.at(-1) ?? 0) / 1000;
      if (drawn && last && dt > 0) {
        // mm the drawn step differs from constant-velocity motion over this frame's dt
        push(judder.distance, Math.abs(drawn.distance - last.distance - drawn.speed * dt) * 1000);
        if (drawn.lateralSpeed > 0 && last.lateralSpeed > 0) {
          push(
            judder.lateral,
            Math.abs(Math.abs(drawn.x - last.x) - drawn.lateralSpeed * dt) * 1000,
          );
        }
      }
      last = drawn;
    },
    summary: () => summarize({ frames, events, frameDt, judder, engine }),
  };
}

/** What a frame drew. lateralSpeed = lane-change speed while mid-change (both frames), else 0. */
export interface Drawn {
  distance: number;
  x: number;
  speed: number;
  lateralSpeed: number;
}

function summarize({
  frames,
  events,
  frameDt,
  judder,
  engine,
}: {
  frames: FrameTiming[];
  events: EventSample[];
  frameDt: number[];
  judder: { distance: number[]; lateral: number[] };
  engine: number[];
}) {
  const f = (fn: (t: FrameTiming) => number | undefined) => stat(frames.map((t) => fn(t) ?? NaN));
  const pose = events.filter((s) => s.timing);
  const keys = events.filter((s) => !s.timing);
  const e = (list: EventSample[], fn: (s: EventSample) => number | undefined) =>
    stat(list.map((s) => fn(s) ?? NaN));
  const fdt = stat(frameDt);
  return {
    pipeline: {
      cameraToCallback: f((t) => (t.captureT === undefined ? undefined : t.callbackT - t.captureT)),
      downscale: f((t) => t.bitmapT - t.callbackT),
      workerRoundTrip: f((t) => t.resultT - t.bitmapT),
      infer: f((t) => t.inferMs),
      gestureEngine: stat(engine),
      /** Camera frame to landmarks on the main thread: the pipeline's share of camera → rendered body. */
      captureToResult: f((t) => t.resultT - (t.captureT ?? t.callbackT)),
    },
    poseEvents: {
      engine: e(pose, (s) => s.eventT - s.timing!.resultT),
      waitForFrame: e(pose, (s) => s.appliedT! - s.eventT),
      simAndRender: e(pose, (s) => s.renderedT! - s.appliedT!),
      toNextFrame: e(pose, (s) => s.nextFrameT! - s.renderedT!),
      captureToNextFrame: e(
        pose,
        (s) => s.nextFrameT! - (s.timing!.captureT ?? s.timing!.callbackT),
      ),
    },
    keyEvents: {
      inputToHandler: e(keys, (s) => s.eventT - s.inputT),
      waitForFrame: e(keys, (s) => s.appliedT! - s.eventT),
      simAndRender: e(keys, (s) => s.renderedT! - s.appliedT!),
      toNextFrame: e(keys, (s) => s.nextFrameT! - s.renderedT!),
      inputToNextFrame: e(keys, (s) => s.nextFrameT! - s.inputT),
    },
    display: {
      frameMs: fdt,
      refreshHz: 1000 / fdt.p50,
      judderForwardMm: stat(judder.distance),
      judderLateralMm: stat(judder.lateral),
    },
  };
}

export type LatencySummary = ReturnType<typeof summarize>;
