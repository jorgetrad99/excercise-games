// Jorge's B1 capture (?record=1&capture=b1, 2026-09-17), compacted: the 13 landmarks body.ts reads, 4
// decimals, no world landmarks. Six takes: left arm up, still, guard, right punches without and with a
// body twist, left punches. The punch takes hold 6 extensions each, not the prompted 3 / 3 / 1.
import { createGestureEngine, type GestureEvent, type SignalFrame } from '../gestures';
import type { GestureConfig } from '../gestures.config';
import type { Landmark, PoseFrame } from '../types';
import raw from './real-b1-capture.json' with { type: 'json' };

export type B1Step =
  'left-hand-overhead' | 'still' | 'guard' | 'square-right-x3' | 'natural-right-x3' | 'left-x1';

export interface B1Take {
  step: B1Step;
  windowMs: [number, number];
  /** Events the live build logged during the take. */
  events: { t: number; type: string }[];
  frames: PoseFrame[];
}

export const B1_VIDEO = raw.video;

function unpack([t, ...v]: number[]): PoseFrame {
  if (v.length === 0) return { t: t!, poses: [] };
  const pose: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  raw.landmarks.forEach((index, k) => {
    const [x, y, z, visibility] = v.slice(k * 4, k * 4 + 4) as [number, number, number, number];
    pose[index] = { x, y, z, visibility };
  });
  return { t: t!, poses: [pose] };
}

export const b1Take = (step: B1Step): B1Take => {
  const take = raw.takes.find((k) => k.step === step)!;
  return {
    step,
    windowMs: take.windowMs as [number, number],
    events: take.events,
    frames: take.frames.map(unpack),
  };
};

/** Wrist (15 left, 16 right) above the nose and back: a punch at the face, counted in the image alone
 *  so the count doesn't depend on the depth model it checks. [start, end] ms. */
export function extensions(frames: readonly PoseFrame[], wrist: 15 | 16): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  for (const f of frames) {
    const p = f.poses[0];
    if (!p) continue;
    const dy = p[wrist]!.y - p[0]!.y;
    if (start === null && dy < -0.01) start = f.t;
    else if (start !== null && dy > 0.03) {
      out.push([start, f.t]);
      start = null;
    }
  }
  if (start !== null) out.push([start, frames.at(-1)!.t]);
  return out;
}

export interface Replayed {
  t: number;
  signals: SignalFrame;
  events: GestureEvent[];
}

/** A take through a fresh gesture engine calibrated on the "still" take first, with times rebased to
 *  the take's own t (the live calibration isn't in the file; still is the take recorded for it). */
export function replayB1(take: B1Take, config?: GestureConfig): Replayed[] {
  const engine = createGestureEngine({ video: () => B1_VIDEO, ...(config && { config }) });
  const still = b1Take('still').frames;
  for (const f of still) engine.push(f);
  const off = still.at(-1)!.t + 50;
  return take.frames.map((f) => {
    const { signals, events } = engine.push({ ...f, t: f.t + off });
    return {
      t: f.t,
      signals: { ...signals, t: f.t, pose: signals.pose && { ...signals.pose, t: f.t } },
      events: events.map((e) => ({ ...e, t: e.t - off })),
    };
  });
}
