// Capture wizard logic (PLAN-BOXING §11.1), no DOM: slice live frames and events into one take per step.
import { rebaseFrame, rebaseT, type PoseFixture } from './recorder';
import type { PoseFrame } from './types';

/** Recorded before and after the prompted window, ms. Margins, not a stability detector (§11.1). */
export const LEAD_MS = 1000;
export const TRAIL_MS = 1000;

export interface CaptureStep {
  id: string;
  prompt: string;
  /** Plain-language description shown under the demo; not stored in the take. */
  howTo?: string;
  durationS: number;
}

/** core's InputEvent as far as capture needs it (pose/ doesn't import core/, PLAN §3). Takes keep
 *  every field of the events they are given. */
export interface CapturedEvent {
  t: number;
  type: string;
}

export type CaptureTake<E extends CapturedEvent = CapturedEvent> = PoseFixture & {
  step: string;
  prompt: string;
  /** The prompted window within this take, ms from the take's t = 0. */
  windowMs: [number, number];
  /** Non-BODY events fired during the take (all players), t rebased like the frames. */
  events: E[];
};

export interface CaptureBundle<E extends CapturedEvent = CapturedEvent> {
  kind: 'capture';
  script: string;
  recordedAt: string;
  takes: CaptureTake<E>[];
}

/** A take's span on the live clock: `start` is where the lead-in begins. */
export const takeEnd = (step: CaptureStep, start: number): number =>
  start + LEAD_MS + step.durationS * 1000 + TRAIL_MS;

/** The frames and events inside [start, takeEnd], rebased so the take starts at t = 0. */
export function sliceTake<E extends CapturedEvent>(
  step: CaptureStep,
  start: number,
  live: { frames: readonly PoseFrame[]; events: readonly E[] },
  meta: Pick<PoseFixture, 'model' | 'video'>,
  recordedAt = new Date(),
): CaptureTake<E> {
  const end = takeEnd(step, start);
  const inside = (t: number): boolean => t >= start && t <= end;
  return {
    version: 1,
    recordedAt: recordedAt.toISOString(),
    ...meta,
    frames: live.frames.filter((f) => inside(f.t)).map((f) => rebaseFrame(f, start)),
    step: step.id,
    prompt: step.prompt,
    windowMs: [LEAD_MS, LEAD_MS + step.durationS * 1000],
    events: live.events
      .filter((e) => e.type !== 'BODY' && inside(e.t))
      .map((e) => ({ ...e, t: rebaseT(e.t, start) })),
  };
}

/** Takes with take `index` set (a Redo retake, or the next step's first take); the others untouched. */
export function replaceTake<E extends CapturedEvent>(
  takes: readonly CaptureTake<E>[],
  index: number,
  take: CaptureTake<E>,
): CaptureTake<E>[] {
  const next = [...takes];
  next[index] = take;
  return next;
}

export const captureBundle = <E extends CapturedEvent>(
  script: string,
  takes: CaptureTake<E>[],
  recordedAt = new Date(),
): CaptureBundle<E> => ({ kind: 'capture', script, recordedAt: recordedAt.toISOString(), takes });
