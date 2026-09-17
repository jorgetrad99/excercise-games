// TEMPORARY(synthetic-fixtures): synthetic boxing arms (3D IK, pose/testdata/synthetic.ts) until
// Jorge's boxing recordings exist. PLAN-BOXING §2.5 (BX-CL-1 end to end), BX-CAL-6 (reach from arms).
import { describe, expect, it } from 'vitest';
import { boxingConfig as C } from '../../core/boxing/boxing.config';
import { fromRing, len, sub, toRing } from '../../core/boxing/body';
import { initBoxing, tickBoxing } from '../../core/boxing/sim';
import type { V3 } from '../../core/boxing/types';
import { createGestureEngine } from '../../pose/gestures';
import { gestureConfig } from '../../pose/gestures.config';
import type { PoseState } from '../../pose/pose-state';
import { CALIBRATE, script, type Key, type Stance } from '../../pose/testdata/synthetic';
import type { PoseFrame } from '../../pose/types';
import { mirrorFrame } from '../../pose/handedness';
import { BRUISE_SPOTS } from '../../render/boxing/face-damage';
import { createPresentation } from '../../render/boxing/presentation';
import { hitOffset } from '../../render/boxing/rig';
import { bodyEvent, bodyFromPose, DEFAULT_ARMS } from './body-input';
import { BOXING_GESTURES } from './gestures';

const B = C.body;
/** Boxer-local z where a glove at face height first touches the neutral opponent head. */
const CONTACT_Z = 2 * C.ring.gapM - B.head[2] - (B.headRadiusM + B.gloveRadiusM);
const video = () => ({ width: 1280, height: 720 });
/** Boxer 0's glove (its local m) is within touching distance of boxer 1's neutral head. */
const touchesHead = (glove: V3) =>
  len(sub(fromRing(1, toRing(0, glove)), [...B.head] as V3)) <= B.headRadiusM + B.gloveRadiusM;

/** `fps` frames from a 240 fps take, starting `phaseMs` in: script() snaps segments to its own grid,
 *  so a sampling phase has to come from resampling. */
function resample(frames: PoseFrame[], fps: number, phaseMs: number): PoseFrame[] {
  const out: PoseFrame[] = [];
  for (let t = phaseMs; t <= frames.at(-1)!.t; t += 1000 / fps) {
    const f = frames.find((x) => x.t >= t - 1e-6)!;
    out.push({ ...f, t: Math.round(t * 10) / 10 });
  }
  return out;
}

/** No smoothing at all: what the camera saw. The reference for "did the glove reach the head". */
const UNFILTERED = {
  ...gestureConfig,
  filter: { minCutoff: 1e9, beta: 0, dCutoff: 1e9 },
  armLagMax: 0,
};

/** The calibrated PoseState for each frame (null before calibration). */
function poses(frames: PoseFrame[], config = gestureConfig): (PoseState | null)[] {
  const engine = createGestureEngine({ video, config });
  return frames.map((f) => engine.push(f).signals.pose);
}
/** The last pose after holding `to` (base: boxing ready stance), noise-free. */
function held(to: Stance): PoseState {
  const frames = script([CALIBRATE, { ms: 300, to: {} }, { ms: 300, to }, { ms: 300, to }], {
    base: { fists: 'ready' },
    jitter: 0,
  });
  return poses(frames).at(-1)!;
}

describe('player body → BODY input (PLAN-BOXING §2.5)', () => {
  it('a guard stays well short of the opponent; half the travel to a straight reaches the head', () => {
    const guard = bodyFromPose(held({ fists: 'guard' }));
    expect(guard.gloves[1][2]).toBeLessThan(CONTACT_Z - 0.2);
    const half = bodyFromPose(held({ fists: 'guard', punchR: 0.5 }));
    expect(half.gloves[1][2]).toBeGreaterThan(CONTACT_Z);
    expect(half.gloves[0][2]).toBeCloseTo(guard.gloves[0][2], 2); // the other hand stayed put
    expect(half.gloves[1][1]).toBeGreaterThan(B.head[1] - 0.15); // at face height
  });

  it('the head follows the body continuously: a lean to the left moves it +x, no cap', () => {
    const still = bodyFromPose(held({}));
    const small = bodyFromPose(held({ lean: -0.02 }));
    const big = bodyFromPose(held({ lean: -0.08 }));
    expect(small.head[0]).toBeGreaterThan(still.head[0] + 0.05);
    expect(big.head[0] - still.head[0]).toBeGreaterThan(3 * (small.head[0] - still.head[0]));
    expect(big.head[0] - still.head[0]).toBeGreaterThan(0.5); // far past the old 6 cm live-lean cap
  });

  it('the same wrist image reaches farther with shorter measured arms (body scan changes reach)', () => {
    const pose = held({ fists: 'guard', punchR: 0.4 });
    const long = bodyFromPose(pose, { upperArm: 0.6, forearm: 0.58 });
    const normal = bodyFromPose(pose, DEFAULT_ARMS);
    expect(long.gloves[1][2]).toBeLessThan(normal.gloves[1][2] - 0.1);
  });

  // BX-CL-7 regression: no smoothing stage may clip a punch's peak. The pipeline's peak glove depth must
  // equal the unfiltered pipeline's on the same frames (the One Euro filter had clipped it 5–9 cm).
  it.each([30, 15])(
    'the pipeline keeps the unfiltered glove peak of a jab at %i pose-fps',
    (fps) => {
      const take = script(
        [
          CALIBRATE,
          { ms: 400, to: {} },
          { ms: 120, to: { punchR: 0.5 } },
          { ms: 150, to: {} },
          { ms: 300, to: {} },
        ],
        { fps: 240, base: { fists: 'guard' }, jitter: 0 },
      );
      const peak = (ps: (PoseState | null)[]) =>
        Math.max(...ps.map((p) => (p ? bodyFromPose(p).gloves[1][2] : -Infinity)));
      // Every sampling phase: wherever the camera's frames saw the glove, the pipeline must too.
      let seen = 0;
      for (let k = 0; k < 6; k++) {
        const frames = resample(take, fps, (k * 1000) / fps / 6);
        const unfiltered = peak(poses(frames, UNFILTERED));
        if (unfiltered > CONTACT_Z) seen++;
        expect(peak(poses(frames)), `phase ${k}`).toBeGreaterThan(unfiltered - 0.002);
      }
      expect(seen).toBeGreaterThan(0); // some phase's frames do show the glove at the head
    },
  );

  // BX-CL-1 end to end: camera frames at a pose rate → gesture engine → BODY → sim. A short punch (half
  // the travel from guard to full extension, out in 120 ms and straight back: a real jab doesn't pause)
  // whose observed glove reaches the head hits.
  it.each([30, 20, 15, 10])('a short punch hits end to end at %i pose-fps', (fps) => {
    let reached = 0;
    const phases = 6;
    for (let phase = 0; phase < phases; phase++) {
      const keys: Key[] = [
        CALIBRATE,
        { ms: 400, to: {} },
        { ms: 120, to: { punchR: 0.5 } },
        { ms: 150, to: {} },
        { ms: 400, to: {} },
      ];
      const take = script(keys, { fps: 240, base: { fists: 'guard' } });
      const frames = resample(take, fps, (phase * 1000) / fps / phases);
      const s = initBoxing({ seed: 1, skipIntro: true });
      const events: string[] = [];
      let i = 0;
      const ps = poses(frames);
      // Judged on the unfiltered camera frames: if the pipeline's smoothing clips the peak, the glove
      // still reached the head and the test must fail (PLAN-BOXING §2.1, smoothing is suspect).
      const touched = poses(frames, UNFILTERED).some(
        (p) => p !== null && touchesHead(bodyEvent(p, 0, null).body!.gloves[1]),
      );
      for (let tick = 0; tick * C.fixedDt * 1000 <= frames.at(-1)!.t + 100; tick++) {
        const now = tick * C.fixedDt * 1000;
        const input = [];
        for (; i < frames.length && frames[i]!.t <= now; i++) {
          const pose = ps[i];
          if (!pose) continue;
          const e = bodyEvent(pose, 0, null);
          input.push(e);
        }
        tickBoxing(s, input);
        events.push(...s.events.map((e) => e.type));
      }
      if (!touched) continue; // no frame saw the glove at the head at this rate and phase
      reached++;
      expect(events, `phase ${phase}`).toEqual(['HIT']);
    }
    expect(reached).toBeGreaterThan(0);
  });

  // B1 (playtest: "threw a right, the debug showed the left"). Both ends of the chain on synthetic poses.
  const rightStraight = (): PoseFrame[] =>
    script(
      [
        CALIBRATE,
        { ms: 400, to: {} },
        { ms: 150, to: { punchR: 1 } },
        { ms: 200, to: {} },
        { ms: 300, to: {} },
      ],
      { base: { fists: 'guard' }, jitter: 0 },
    );
  /** Peak forward travel of each glove over the take, m. */
  const gloveTravel = (frames: PoseFrame[]): [number, number] => {
    const ps = poses(frames).filter((p) => p !== null);
    const z = (h: 0 | 1) => ps.map((p) => bodyFromPose(p).gloves[h][2]);
    return [0, 1].map((h) => Math.max(...z(h as 0 | 1)) - z(h as 0 | 1)[0]!) as [number, number];
  };

  it("B1a: the player's right wrist (landmarks 12/14/16) drives glove 1; only a mirrored stream swaps it", () => {
    const frames = rightStraight();
    const lm = (i: number) => frames.map((f) => f.poses[0]![i]!);
    const z0 = lm(16)[0]!.z;
    expect(Math.min(...lm(16).map((l) => l.z))).toBeLessThan(z0 - 0.05); // the take moves the RIGHT wrist …
    expect(lm(15).every((l) => l.x === lm(15)[0]!.x && l.z === lm(15)[0]!.z)).toBe(true); // … not the left
    const [left, right] = gloveTravel(frames);
    expect(right).toBeGreaterThan(0.4); // glove 1 = GloveR in render/boxing/boxer.ts
    expect(left).toBeLessThan(0.01);
    // The same body seen through a mirrored camera stream: MediaPipe labels it a left, glove 0 moves.
    const [mLeft, mRight] = gloveTravel(frames.map(mirrorFrame));
    expect(mLeft).toBeGreaterThan(0.4);
    expect(mRight).toBeLessThan(0.01);
  });

  it('B1b: a right-glove hit is attributed to the right all the way to what the player sees', () => {
    const frames = rightStraight();
    const engine = createGestureEngine({ video });
    const s = initBoxing({ seed: 1, skipIntro: true });
    const hits: string[] = [];
    const logged: string[] = []; // what ?debug=1's signal HUD lists (main.ts record → signalHud.event)
    let i = 0;
    for (let tick = 0; tick * C.fixedDt * 1000 <= frames.at(-1)!.t + 100; tick++) {
      const input = [];
      for (; i < frames.length && frames[i]!.t <= tick * C.fixedDt * 1000; i++) {
        const { signals, events } = engine.push(frames[i]!);
        for (const e of events) logged.push(BOXING_GESTURES[e.type] ?? '');
        if (signals.pose) input.push(bodyEvent(signals.pose, 0, null));
      }
      tickBoxing(s, input);
      hits.push(...s.events.map((e) => `${e.type}:${e.boxer}`));
    }
    expect(hits).toEqual(['HIT:1']);
    expect(s.boxers[1].hits.map((h) => h.zone)).toEqual([0]); // the defender's LEFT side
    const seen = createPresentation()(s, 1);
    expect(seen.hitSide).toBe(1); // O1 input: +1 = the boxer's left cheek
    expect(seen.damage).toEqual([expect.any(Number), 0, 0]);
    expect(seen.damage[0]).toBeGreaterThan(0);
    expect(BRUISE_SPOTS[0][0]).toBeGreaterThan(0.5); // left-cheek bruise on image-right = the head's +x
    const snap = hitOffset(0.1, seen.hitSide);
    expect(snap.head[1]).toBeLessThan(0); // yaw − : the face turns to the defender's right, away from it
    expect(snap.root[0]).toBeLessThan(0); // and the stagger goes the same way
    expect(logged.filter((t) => /LEFT|RIGHT/.test(t))).toEqual([]); // the debug list names no side
  });
});
