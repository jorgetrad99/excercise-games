import { describe, expect, it } from 'vitest';
import { predictPose, sweep } from './body';
import { boxingConfig as C } from './boxing.config';
import { initBoxing, tickBoxing, type BoxingInput } from './sim';
import type { BoxingState, V3 } from './types';

const B = C.body;
const R_HEAD = B.headRadiusM + B.gloveRadiusM;
/** Boxer 0's local z at which its glove centre, straight ahead at face height, first touches boxer 1's
 *  neutral head: the head centre sits 2·gap − head.z in front of boxer 0's origin. */
const CONTACT_Z = 2 * C.ring.gapM - B.head[2] - R_HEAD;
/** A guard glove (wrist ~0.45 arm forward) and a full extension, boxer-local z. */
const GUARD_Z = B.shoulder[2] + 0.45 * B.armGainM.forward;
const FULL_Z = B.shoulder[2] + B.armGainM.forward;

const body = (glove: V3): NonNullable<BoxingInput['body']> => ({
  head: [...B.head] as V3,
  gloves: [[0.15, 1.3, GUARD_Z], glove],
});

/** Right-glove z over a punch that goes out from the guard to `peakZ` in `outMs` and snaps back in 60 ms. */
function punchZ(tMs: number, peakZ: number, outMs: number): number {
  const s = (k: number) => k * k * (3 - 2 * k);
  if (tMs <= 0) return GUARD_Z;
  if (tMs < outMs) return GUARD_Z + (peakZ - GUARD_Z) * s(tMs / outMs);
  const back = (tMs - outMs) / 60;
  return back >= 1 ? GUARD_Z : peakZ + (GUARD_Z - peakZ) * s(back);
}

/**
 * Drives boxer 0 from pose samples at `hz` (first sample `phaseMs` into the punch), ticking the sim like
 * the live loop: each sample applies at the next tick. Returns sim events and the samples' peak z.
 */
function playPunch(hz: number, phaseMs: number, peakZ: number, outMs = 60, glove = [0, 1.62]) {
  const s: BoxingState = initBoxing({ seed: 1, skipIntro: true });
  const events: string[] = [];
  const startMs = 500;
  let next = phaseMs;
  let sampledPeak = -Infinity;
  for (let tick = 0; tick < Math.round(1.5 / C.fixedDt); tick++) {
    const nowMs = tick * C.fixedDt * 1000;
    const input: BoxingInput[] = [];
    while (next <= nowMs) {
      const z = punchZ(next - startMs, peakZ, outMs);
      sampledPeak = Math.max(sampledPeak, z);
      input.push({ type: 'BODY', player: 0, t: next, body: body([glove[0]!, glove[1]!, z]) });
      next += 1000 / hz;
    }
    tickBoxing(s, input);
    events.push(...s.events.map((e) => `${e.type}:${e.boxer}`));
  }
  return { s, events, sampledPeak };
}

describe('glove collision (player authority)', () => {
  it('sweep finds the first touch along a move, and none when starting inside or passing wide', () => {
    expect(sweep([0, 0, 2], [0, 0, 0], 1)).toBeCloseTo(0.5);
    expect(sweep([0, 0, 0.5], [0, 0, -2], 1)).toBeNull(); // already touching
    expect(sweep([2, 0, 2], [2, 0, -2], 1)).toBeNull(); // passes wide
    // Tunneling: both ends outside, the middle crosses the sphere.
    expect(sweep([0, 0, 3], [0, 0, -3], 0.5)).toBeCloseTo(2.5 / 6);
  });

  it('geometry: a guard stays short of the face, a punch reaches it at ≤ ~70 % of a full extension', () => {
    expect(GUARD_Z).toBeLessThan(CONTACT_Z - 0.2);
    const fraction = (CONTACT_Z - B.shoulder[2]) / (FULL_Z - B.shoulder[2]);
    expect(fraction).toBeLessThan(0.72);
  });

  // Acceptance 1: a short punch (half extension from the guard) whose glove reaches the head volume is
  // a hit at every pose rate, whatever the sampling phase: no threshold decides that a punch happened.
  it.each([30, 25, 20, 15, 10])('a short punch that reaches the head hits at %i pose-fps', (hz) => {
    const halfway = GUARD_Z + (FULL_Z - GUARD_Z) / 2;
    expect(halfway).toBeGreaterThan(CONTACT_Z); // half extension from the guard does reach the head
    let reached = 0;
    for (let phase = 0; phase < 8; phase++) {
      // Out in 120 ms (a short, quick jab), so a sample lands in the glove's reach window at 10 Hz too.
      const { events, sampledPeak } = playPunch(hz, (phase * 1000) / hz / 8, halfway, 120);
      if (sampledPeak < CONTACT_Z) continue; // no pose frame ever saw the glove at the head
      reached++;
      expect(events, `phase ${phase}`).toEqual(['HIT:1']);
    }
    expect(reached).toBeGreaterThan(0);
  });

  it('a glove that stops 2 cm short of the head does nothing, at any rate', () => {
    for (const hz of [30, 10]) {
      const { events, sampledPeak } = playPunch(hz, 0, CONTACT_Z - 0.02);
      expect(sampledPeak).toBeLessThan(CONTACT_Z);
      expect(events).toEqual([]);
    }
  });

  it('swept between pose frames: a hook crossing the face between two samples still hits', () => {
    const s = initBoxing({ seed: 1, skipIntro: true });
    const z = CONTACT_Z + 0.2; // deep enough to be inside the head at x = 0
    tickBoxing(s, [{ type: 'BODY', player: 0, t: 0, body: body([0.8, 1.62, z]) }]);
    tickBoxing(s, []);
    // Next frame 100 ms later: the glove is on the far side. No sample was ever inside the head.
    tickBoxing(s, [{ type: 'BODY', player: 0, t: 100, body: body([-0.8, 1.62, z]) }]);
    expect(s.events.map((e) => e.type)).toEqual(['HIT']);
    expect(s.boxers[1].hits.at(-1)?.zone).not.toBe(2);
  });

  it('one hit per contact: a glove held in the face does not keep scoring; pulled back, it can again', () => {
    const s = initBoxing({ seed: 1, skipIntro: true });
    const all: string[] = [];
    const tick = (input: BoxingInput[] = []) => {
      tickBoxing(s, input);
      all.push(...s.events.map((e) => e.type));
    };
    const at = (t: number, z: number) => {
      tick([{ type: 'BODY', player: 0, t, body: body([0, 1.62, z]) }]);
      for (let i = 0; i < 3; i++) tick();
    };
    let t = 0;
    const held = [CONTACT_Z + 0.05, CONTACT_Z + 0.05, CONTACT_Z + 0.08, CONTACT_Z + 0.05];
    for (const z of [GUARD_Z, ...held]) at((t += 33), z);
    expect(all.filter((e) => e === 'HIT')).toHaveLength(1);
    for (const z of [GUARD_Z, CONTACT_Z + 0.05]) at((t += 33), z);
    expect(all.filter((e) => e === 'HIT')).toHaveLength(2);
  });

  it("a real guard blocks: a straight into the defender's gloves in front of its face is a BLOCK", () => {
    const s = initBoxing({ seed: 1, skipIntro: true });
    // Boxer 1 holds its gloves in front of its face (its own pose), boxer 0 punches straight at it.
    const guard: NonNullable<BoxingInput['body']> = {
      head: [...B.head] as V3,
      gloves: [
        [0.08, 1.62, 0.5],
        [-0.08, 1.62, 0.5],
      ],
    };
    const events: string[] = [];
    for (let i = 0; i < 12; i++) {
      const z = GUARD_Z + ((FULL_Z - GUARD_Z) * i) / 11;
      tickBoxing(s, [
        { type: 'BODY', player: 1, t: i * 33, body: guard },
        { type: 'BODY', player: 0, t: i * 33, body: body([0, 1.62, z]) },
      ]);
      for (let k = 0; k < 3; k++) {
        events.push(...s.events.map((e) => e.type));
        tickBoxing(s, []);
      }
    }
    expect(events).toEqual(['BLOCK']);
  });

  it('draws a moving glove predicted at most body.extrapolateS past its newest sample; collides on the sample', () => {
    const s = initBoxing({ seed: 1, skipIntro: true });
    const at = (t: number, z: number) =>
      tickBoxing(s, [{ type: 'BODY', player: 0, t, body: body([0.4, 0.9, z]) }]);
    at(0, 0.5);
    at(40, 0.6); // 2.5 m/s forward
    const track = s.boxers[0].body;
    expect(predictPose(track, 0.01).gloves[1][2]).toBeCloseTo(0.6 + 2.5 * (C.fixedDt + 0.01), 5);
    for (let i = 0; i < Math.round(0.2 / C.fixedDt); i++) tickBoxing(s, []);
    expect(predictPose(track).gloves[1][2]).toBeCloseTo(0.6 + 2.5 * B.extrapolateS, 5);
    expect(track.now.gloves[1][2]).toBeCloseTo(0.6, 9);
    expect(s.boxers[0].body.source).toBe('pose');
    for (let i = 0; i < Math.round(B.staleS / C.fixedDt); i++) tickBoxing(s, []);
    expect(s.boxers[0].body.source).toBe('puppet'); // tracking gone: keyboard/bot takes over
  });

  /** Boxer 0's right glove at face height moving at a constant `mps` from z 0.4, sampled at `hz` from
   *  `phaseMs`, stopping at FULL_Z. Returns the damage boxer 1 took and glove 1's longest closingT before it. */
  function constantStraight(mps: number, hz: number, phaseMs = 0) {
    const s = initBoxing({ seed: 1, skipIntro: true });
    let next = phaseMs;
    let seen = 0;
    for (let tick = 0; tick < Math.round(1 / C.fixedDt) && s.boxers[1].hits.length === 0; tick++) {
      const nowMs = tick * C.fixedDt * 1000;
      const input: BoxingInput[] = [];
      for (; next <= nowMs; next += 1000 / hz) {
        const z = Math.min(FULL_Z, 0.4 + (mps * next) / 1000);
        input.push({ type: 'BODY', player: 0, t: next, body: body([0, 1.62, z]) });
      }
      tickBoxing(s, input);
      if (s.boxers[1].hits.length === 0) seen = Math.max(seen, s.boxers[0].gloves[1].closingT);
    }
    return { damage: C.stamina.segments - s.boxers[1].stamina, hits: s.boxers[1].hits, seen };
  }

  // BX-CL-8: closing speed is the observed sample velocity, not a whole frame's travel landing in one tick.
  it('damage does not depend on pose rate: a constant-speed straight scores the same at 30, 20, 15 pose-fps', () => {
    for (const mps of [2, 4.4]) {
      const at30 = constantStraight(mps, 30).damage;
      for (const hz of [30, 20, 15])
        for (let phase = 0; phase < 4; phase++) {
          const { damage, hits } = constantStraight(mps, hz, (phase * 1000) / hz / 4);
          const label = `${mps} m/s @${hz} phase ${phase}`;
          expect(hits, label).toHaveLength(1);
          // The speed itself, not only the damage: under the maxMult cap, inflated speeds all score 1.05.
          expect(Math.abs(hits[0]!.speed - mps) / mps, label).toBeLessThan(0.05);
          expect(Math.abs(damage - at30) / at30, label).toBeLessThan(0.05);
        }
    }
    // Under the current constants (clean 0.7, refSpeedMps 5): 0.14 seg per m/s.
    expect(Math.abs(constantStraight(4.4, 30).damage - 0.62)).toBeLessThan(0.03);
  });

  // BX-CL-9: the bot perceives a pose punch through the same velocity.
  it.each([30, 20, 15])('the bot can see a 3 m/s pose straight before it lands at %i pose-fps', (hz) => {
    const { seen, hits } = constantStraight(3, hz);
    expect(hits).toHaveLength(1);
    expect(seen).toBeGreaterThanOrEqual(C.bot.reactS);
  });

  // BX-CL-10: a dizzy boxer's gloves touch without effect in both directions.
  it("a dizzy defender's raised guard does not block: the straight lands behind it", () => {
    const outcome = (dizzy: boolean) => {
      const s = initBoxing({ seed: 1, skipIntro: true });
      if (dizzy) Object.assign(s.boxers[1], { stamina: 0, dizzy: true });
      const guard: NonNullable<BoxingInput['body']> = {
        head: [...B.head] as V3,
        gloves: [
          [0.08, 1.62, 0.5],
          [-0.08, 1.62, 0.5],
        ],
      };
      const events: string[] = [];
      for (let i = 0; i < 12; i++) {
        const z = GUARD_Z + ((FULL_Z - GUARD_Z) * i) / 11;
        tickBoxing(s, [
          { type: 'BODY', player: 1, t: i * 33, body: guard },
          { type: 'BODY', player: 0, t: i * 33, body: body([0, 1.62, z]) },
        ]);
        for (let k = 0; k < 3; k++) {
          events.push(...s.events.map((e) => e.type));
          tickBoxing(s, []);
        }
      }
      return events;
    };
    expect(outcome(false)).toEqual(['BLOCK']);
    expect(outcome(true)).toEqual(['KNOCKDOWN']); // a clean hit on a dizzy boxer, never a BLOCK
  });
});
