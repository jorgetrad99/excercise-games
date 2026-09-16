import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGestureEngine, type GestureEventType } from './gestures';
import { gestureConfig, type GestureConfig } from './gestures.config';
import type { PoseFixture } from './recorder';
import { CALIBRATE, JUMP, script, type Key } from './testdata/synthetic';
import type { PoseFrame } from './types';

const VIDEO = () => ({ width: 1280, height: 720 });

function run(frames: PoseFrame[], config: GestureConfig = gestureConfig): GestureEventType[] {
  const engine = createGestureEngine({ video: VIDEO, config });
  return frames.flatMap((f) => engine.push(f).events.map((e) => e.type));
}
/** Events after calibration, from a script that starts with CALIBRATE. */
const after = (keys: Key[], config?: GestureConfig): GestureEventType[] => {
  const events = run(script([CALIBRATE, ...keys]), config);
  expect(events[0]).toBe('CALIBRATED');
  return events.slice(1);
};

// Leans in normalized x. Calibrated shoulder width ≈ 0.12 → enter 0.35 ≈ 0.042, rearm 0.2 ≈ 0.024.
const LEAN_LEFT: Key[] = [
  { ms: 250, to: { lean: -0.06 } },
  { ms: 300, to: { lean: -0.06 } },
  { ms: 250, to: {} },
  { ms: 300, to: {} },
];
const LEAN_RIGHT: Key[] = LEAN_LEFT.map((k) => ({ ...k, to: k.to.lean ? { lean: 0.06 } : {} }));

// TEMPORARY(synthetic-fixtures): these sequences are synthetic stand-ins for Jorge's per-gesture
// recordings (lean-left-right.json, jump.json, crouch.json, idle.json). Swap each describe to load the
// recorded fixture and assert the same exact sequence once they exist.
describe('gesture engine — TEMPORARY synthetic event-sequence tests', () => {
  it('calibrates once after standing still 2 s, and idle with jitter emits nothing else', () => {
    expect(run(script([{ ms: 1900, to: {} }]))).toEqual([]);
    expect(run(script([{ ms: 12_000, to: {} }], { jitter: 0.004 }))).toEqual(['CALIBRATED']);
  });

  it('does not calibrate while the player keeps moving', () => {
    const pacing: Key[] = Array.from({ length: 8 }, (_, i) => ({
      ms: 500,
      to: { walk: i % 2 ? 0.05 : -0.05 },
    }));
    expect(run(script(pacing))).toEqual([]);
  });

  it('lean: one LANE event per lean, hysteresis requires returning to center', () => {
    expect(after(LEAN_LEFT)).toEqual(['LANE_LEFT']);
    expect(after([...LEAN_LEFT, ...LEAN_RIGHT, ...LEAN_LEFT])).toEqual([
      'LANE_LEFT',
      'LANE_RIGHT',
      'LANE_LEFT',
    ]);
    // Hold the lean 3 s → still one event.
    expect(
      after([
        { ms: 250, to: { lean: -0.06 } },
        { ms: 3000, to: { lean: -0.06 } },
      ]),
    ).toEqual(['LANE_LEFT']);
    // Wobble between 0.30 and 0.55 shoulder widths without re-entering ±0.20 → one event.
    const wobble: Key[] = Array.from({ length: 6 }, (_, i) => ({
      ms: 200,
      to: { lean: i % 2 ? -0.036 : -0.066 },
    }));
    expect(after(wobble)).toEqual(['LANE_LEFT']);
    // A small lean (≈0.25 shoulder widths) never fires.
    expect(
      after([
        { ms: 300, to: { lean: -0.03 } },
        { ms: 1000, to: { lean: -0.03 } },
        { ms: 300, to: {} },
      ]),
    ).toEqual([]);
  });

  it('lean is distance-invariant (same lean in shoulder widths, player further away)', () => {
    // scale shrinks every offset too, so the same stance keys describe the same lean in shoulder widths
    const far = (keys: Key[]) => keys.map((k) => ({ ms: k.ms, to: { ...k.to, scale: 0.6 } }));
    const events = run(
      script([{ ms: 2500, to: { scale: 0.6 } }, ...far([...LEAN_LEFT, ...LEAN_RIGHT])], {
        base: { scale: 0.6 },
      }),
    );
    expect(events).toEqual(['CALIBRATED', 'LANE_LEFT', 'LANE_RIGHT']);
  });

  it('jump: a quick jump fires exactly one JUMP and nothing else; two jumps 1 s apart fire two', () => {
    expect(after(JUMP)).toEqual(['JUMP']);
    expect(after([...JUMP, { ms: 600, to: {} }, ...JUMP])).toEqual(['JUMP', 'JUMP']);
  });

  it('jump: a slow rise to the same height (stretching on tiptoes) is gated by velocity', () => {
    expect(
      after([
        { ms: 1500, to: { rise: 0.08 } },
        { ms: 500, to: { rise: 0.08 } },
        { ms: 1500, to: {} },
      ]),
    ).toEqual([]);
  });

  it('slide: crouch held fires SLIDE_START then SLIDE_END; a 60 ms dip does not', () => {
    const crouch: Key[] = [
      { ms: 200, to: { crouch: 0.11 } },
      { ms: 600, to: { crouch: 0.11 } },
      { ms: 200, to: {} },
      { ms: 300, to: {} },
    ];
    expect(after(crouch)).toEqual(['SLIDE_START', 'SLIDE_END']);
    const dip: Key[] = [
      { ms: 30, to: { crouch: 0.11 } },
      { ms: 30, to: {} },
      { ms: 500, to: {} },
    ];
    expect(after(dip)).toEqual([]);
  });

  it('grab: arms up mid-air fires GRAB after JUMP; arms up standing fires no GRAB', () => {
    const grabJump: Key[] = [
      { ms: 150, to: { rise: 0.08 } },
      { ms: 60, to: { rise: 0.08, armsUp: true } },
      { ms: 200, to: { rise: 0 } },
      { ms: 400, to: {} },
    ];
    expect(after(grabJump)).toEqual(['JUMP', 'GRAB']);
    expect(
      after([
        { ms: 100, to: { armsUp: true } },
        { ms: 400, to: {} },
      ]),
    ).toEqual([]);
  });

  it('revive: arms up held 1 s fires REVIVE_ACCEPT once per hold', () => {
    const hold: Key[] = [
      { ms: 100, to: { armsUp: true } },
      { ms: 2500, to: { armsUp: true } },
      { ms: 300, to: {} },
    ];
    expect(after([...hold, ...hold])).toEqual(['REVIVE_ACCEPT', 'REVIVE_ACCEPT']);
  });

  it('T-pose held 1 s fires RECALIBRATE, then calibrates again after standing still', () => {
    const tpose: Key[] = [
      { ms: 100, to: { tPose: true } },
      { ms: 1200, to: { tPose: true } },
      { ms: 100, to: {} },
      CALIBRATE,
    ];
    expect(after(tpose)).toEqual(['RECALIBRATE', 'CALIBRATED']);
  });

  it('recalibrating mid-slide ends the slide first (T-pose and keyboard C)', () => {
    const engine = createGestureEngine({ video: VIDEO });
    const frames = script([
      CALIBRATE,
      { ms: 200, to: { crouch: 0.11 } },
      { ms: 400, to: { crouch: 0.11 } },
    ]);
    const types = frames.flatMap((f) => engine.push(f).events.map((e) => e.type));
    expect(types).toEqual(['CALIBRATED', 'SLIDE_START']);
    expect(engine.recalibrate(4000).map((e) => e.type)).toEqual(['SLIDE_END']);
    expect(engine.recalibrate(4100)).toEqual([]);
  });

  it('tracking: pose gone > 700 ms → TRACKING_LOST, back → TRACKING_RESTORED; a 400 ms gap is ignored', () => {
    const gone = (ms: number): Key[] => [
      { ms, to: { visible: false } },
      { ms: 500, to: {} },
    ];
    expect(after(gone(1200))).toEqual(['TRACKING_LOST', 'TRACKING_RESTORED']);
    expect(after(gone(400))).toEqual([]);
  });

  it('tracking: tick() detects loss even when no frames arrive', () => {
    const engine = createGestureEngine({ video: VIDEO });
    for (const f of script([CALIBRATE])) engine.push(f);
    expect(engine.tick(2600).map((e) => e.type)).toEqual([]);
    expect(engine.tick(3300).map((e) => e.type)).toEqual(['TRACKING_LOST']);
  });

  it('zones mode: walking across the frame steps one lane per boundary crossed', () => {
    const zones: GestureConfig = { ...gestureConfig, laneMode: 'zones' };
    const walk: Key[] = [
      { ms: 600, to: { walk: -0.25 } }, // center → screen-left third
      { ms: 400, to: { walk: -0.25 } },
      { ms: 1200, to: { walk: 0.25 } }, // → right third, crossing two boundaries
      { ms: 400, to: { walk: 0.25 } },
    ];
    expect(after(walk, zones)).toEqual(['LANE_LEFT', 'LANE_RIGHT', 'LANE_RIGHT']);
    // Calibrating in the left third: the sim starts in the center lane, so one catch-up LANE_LEFT.
    const offCenter = run(
      script([{ ms: 2600, to: { walk: -0.25 } }], { base: { walk: -0.25 } }),
      zones,
    );
    expect(offCenter).toEqual(['CALIBRATED', 'LANE_LEFT']);
  });
});

// Rough sanity reference only (Jorge's mixed recording, not per-gesture). Skipped when absent.
const COMBINED = 'fixtures/pose/combined-raw.json';
describe.skipIf(!existsSync(COMBINED))('gesture engine — combined-raw.json sanity', () => {
  it('runs the whole recording with finite signals and a plausible event count', () => {
    const fx = JSON.parse(readFileSync(COMBINED, 'utf8')) as PoseFixture;
    const engine = createGestureEngine({ video: () => fx.video });
    const events: GestureEventType[] = [];
    for (const f of fx.frames) {
      const r = engine.push(f);
      expect(Number.isFinite(r.signals.leanX + r.signals.hipRise + r.signals.headDrop)).toBe(true);
      events.push(...r.events.map((e) => e.type));
    }
    expect(events).toContain('CALIBRATED');
    expect(events.length).toBeLessThan(fx.frames.length / 10);
  });
});
