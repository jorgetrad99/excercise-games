// PLAN-BOXING §2.5 (BX-CL-1 end to end), BX-CAL-6 (reach from arms). Guard reach and handedness run on
// Jorge's B1 capture (pose/testdata/real-b1-capture.json).
// TEMPORARY(synthetic-fixtures): the rest stays synthetic (pose/testdata/synthetic.ts): it needs what a
// 30 fps take can't give: controlled pose rates and sampling phases (BX-CL-1, BX-CL-7), a known lean, a
// body scan, and a glove whose true path is known for the render chain (B1b).
import { describe, expect, it } from 'vitest';
import { boxingConfig as C } from '../../core/boxing/boxing.config';
import { fromRing, len, sub, toRing } from '../../core/boxing/body';
import { initBoxing, tickBoxing } from '../../core/boxing/sim';
import type { V3 } from '../../core/boxing/types';
import { createGestureEngine } from '../../pose/gestures';
import { gestureConfig } from '../../pose/gestures.config';
import type { PoseState } from '../../pose/pose-state';
import { b1Take, replayB1, type B1Step } from '../../pose/testdata/real-b1';
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
/** A B1 take's BODY placements (calibrated frames only), with the take's own t. */
const realBodies = (step: B1Step) =>
  replayB1(b1Take(step)).flatMap((r) =>
    r.signals.pose ? [{ t: r.t, body: bodyFromPose(r.signals.pose) }] : [],
  );

/** The last pose after holding `to` (base: boxing ready stance), noise-free. */
function held(to: Stance): PoseState {
  const frames = script([CALIBRATE, { ms: 300, to: {} }, { ms: 300, to }, { ms: 300, to }], {
    base: { fists: 'ready' },
    jitter: 0,
  });
  return poses(frames).at(-1)!;
}

describe('player body → BODY input (PLAN-BOXING §2.5)', () => {
  it("Jorge's held guard stays short of the opponent; his straights reach past the face, at face height", () => {
    // Guard take from GUARD_START (2602 ms, fists arrived) to the end: z 0.57–0.80 with default arms.
    const guard = realBodies('guard').filter((r) => r.t >= 2602);
    expect(Math.max(...guard.flatMap((r) => r.body.gloves.map((g) => g[2])))).toBeLessThan(
      CONTACT_Z - 0.15,
    );
    // No-twist straights: the right glove's peak is well past contact, at face height.
    const square = realBodies('square-right-x3').map((r) => r.body);
    const peak = square.reduce((a, b) => (b.gloves[1][2] > a.gloves[1][2] ? b : a));
    expect(peak.gloves[1][2]).toBeGreaterThan(CONTACT_Z + 0.5);
    expect(peak.gloves[1][1]).toBeGreaterThan(B.head[1] - 0.2);
    expect(peak.gloves[0][2]).toBeLessThan(CONTACT_Z); // the guarding hand stayed back
  });

  // Synthetic on purpose: the gain rule is stated for half the travel, which no real take isolates.
  it('half the travel from guard to a straight reaches the head', () => {
    const guard = bodyFromPose(held({ fists: 'guard' }));
    const half = bodyFromPose(held({ fists: 'guard', punchR: 0.5 }));
    expect(half.gloves[1][2]).toBeGreaterThan(CONTACT_Z);
    expect(half.gloves[0][2]).toBeCloseTo(guard.gloves[0][2], 2); // the other hand stayed put
    expect(half.gloves[1][1]).toBeGreaterThan(B.head[1] - 0.15); // at face height
  });

  // Jorge (B1): a duck or forward bend lowers the head only. Lowering the gloves with it sent twisted
  // straights under the face into the opponent's ready glove (2 of 6 hit; 5 of 6 now, b1-capture.spec).
  it('a duck lowers the head, not the gloves; sinking the hips (rise) still lowers both', () => {
    const guard = bodyFromPose(held({ fists: 'guard' }));
    const pose = held({ fists: 'guard', crouch: 0.06 }); // head drops, hips drop half as much
    const ducked = bodyFromPose(pose);
    const { duck, rise } = pose.body;
    expect(duck).toBeGreaterThan(0.1);
    for (const h of [0, 1] as const)
      expect(ducked.gloves[h][1] - guard.gloves[h][1]).toBeCloseTo(rise * B.leanGainM, 2);
    expect(ducked.head[1] - guard.head[1]).toBeCloseTo((rise - duck) * B.leanGainM, 2);
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

  // B1 (playtest: "threw a right, the debug showed the left"). B1a on the real capture; B1b's render chain
  // on a synthetic straight, whose one clean hit makes each link checkable.
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

  it("B1a (real): Jorge's right punches drive glove 1, his left punches glove 0; a mirrored stream swaps them", () => {
    // Peak forward reach of each glove inside the prompted window, m.
    const peaks = (step: B1Step, mirror: boolean): [number, number] => {
      const take = b1Take(step);
      const frames = mirror ? take.frames.map(mirrorFrame) : take.frames;
      const zs = replayB1({ ...take, frames })
        .filter((r) => r.signals.pose && r.t >= take.windowMs[0] && r.t <= take.windowMs[1])
        .map((r) => bodyFromPose(r.signals.pose!).gloves);
      return [0, 1].map((h) => Math.max(...zs.map((g) => g[h]![2]))) as [number, number];
    };
    // The idle hand also comes forward when the arms rise to guard (z 1.13 at 1.7 s): compare peaks.
    const right = peaks('square-right-x3', false); // glove 1 = GloveR in render/boxing/boxer.ts
    expect(right[1]).toBeGreaterThan(CONTACT_Z + 0.5);
    expect(right[1]).toBeGreaterThan(right[0] + 0.4);
    const left = peaks('left-x1', false);
    expect(left[0]).toBeGreaterThan(left[1] + 0.4);
    // The same take through a mirrored camera stream: MediaPipe labels each arm the other side.
    const mirrored = peaks('square-right-x3', true);
    expect(mirrored[0]).toBeGreaterThan(mirrored[1] + 0.4);
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
