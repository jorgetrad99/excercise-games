// PLAN-BOXING §4: exact handover ticks (BX-H-*) and the global invariants (BX-A-1, BX-A-3).
import { describe, expect, it } from 'vitest';
import { boxingConfig as C } from '../../core/boxing/boxing.config';
import { initBoxing, tickBoxing, type BoxingInput } from '../../core/boxing/sim';
import type { BoxingEventType, BoxingState, V3 } from '../../core/boxing/types';
import { boxingAuthority, canRecalibrate, type Authority, type AuthorityState } from './authority';

const B = C.body;
const CHANNELS = ['root', 'rootY', 'legs', 'hips', 'torso', 'head', 'arms', 'camera'] as const;

/** Boxer 0 has a live body (hands down, one BODY per tick: a guard would block every key punch);
 *  boxer 1 is a keyboard puppet. */
const live = (s: BoxingState): BoxingInput => ({
  type: 'BODY',
  player: 0,
  t: s.t * 1000,
  body: {
    head: [...B.head] as V3,
    gloves: [
      [0.3, 1.0, 0.3],
      [-0.3, 1.0, 0.3],
    ],
  },
});

interface Step {
  tick: number;
  events: BoxingEventType[];
  a0: Authority;
  a1: Authority;
}

/** Ticks once; returns what happened on that tick and the authority right after it. */
function step(s: BoxingState, extra: BoxingInput[] = []): Step {
  tickBoxing(s, [live(s), ...extra]);
  return {
    tick: s.tick,
    events: s.events.map((e) => e.type),
    a0: boxingAuthority(s, 0),
    a1: boxingAuthority(s, 1),
  };
}

/** Ticks until `until` holds (max 20 s); returns every step. */
function runUntil(
  s: BoxingState,
  until: (st: Step) => boolean,
  extra?: () => BoxingInput[],
): Step[] {
  const out: Step[] = [];
  for (let i = 0; i < 20 / C.fixedDt; i++) {
    const st = step(s, extra?.() ?? []);
    out.push(st);
    if (until(st)) return out;
  }
  throw new Error('condition never held');
}

/** The first tick whose authority for boxer 0 is `state`, and the state on the tick before it. */
function entered(steps: Step[], state: AuthorityState) {
  const i = steps.findIndex((st) => st.a0.state === state);
  return { tick: steps[i]?.tick, before: steps[i - 1]?.a0.state, step: steps[i] };
}

/** A full knockdown of boxer 0 and its get-up, from a fresh fight. */
function knockdownScript(seed = 3): { s: BoxingState; steps: Step[] } {
  const s = initBoxing({ seed, skipIntro: true });
  Object.assign(s.boxers[0], { stamina: 0.05 });
  const steps: Step[] = [];
  let punches = 0;
  const punch = () => (punches++ % 60 === 0 ? [{ type: 'PUNCH_RIGHT', player: 1 } as const] : []);
  steps.push(...runUntil(s, (st) => st.events.includes('GET_UP'), punch));
  return { s, steps };
}

describe('boxingAuthority handovers (PLAN-BOXING §4)', () => {
  it('BX-H-01: intro is S1; S2 on exactly the tick the fight begins', () => {
    const s = initBoxing({ seed: 1 });
    const steps = runUntil(s, (st) => st.a0.state === 'S2');
    expect(steps.slice(0, -1).every((st) => st.a0.state === 'S1')).toBe(true);
    const last = steps.at(-1)!;
    expect(s.phase).toBe('fight');
    expect(last.tick).toBe(Math.round(C.phases.introS / C.fixedDt));
    expect(CHANNELS.every((c) => last.a0[c] === 'player')).toBe(true);
  });

  it('BX-H-02/03: S3 on the DIZZY tick, back to S2 on the tick dizzy clears (clinch break)', () => {
    const s = initBoxing({ seed: 1, skipIntro: true });
    Object.assign(s.boxers[0], { stamina: 0.05 });
    const steps = runUntil(
      s,
      (st) => st.events.includes('DIZZY'),
      () => (s.tick === 0 ? [{ type: 'PUNCH_RIGHT', player: 1 }] : []),
    );
    const dizzy = steps.at(-1)!;
    expect(dizzy.a0.state).toBe('S3');
    expect(steps.at(-2)!.a0.state).toBe('S2');
    expect(dizzy.a0.overlays).toEqual({ hit: true, stun: true });
    expect(CHANNELS.every((c) => dizzy.a0[c] === 'player')).toBe(true); // degraded, still the player's
    Object.assign(s.boxers[1], { stamina: 0, dizzy: true }); // both dizzy: the sim breaks the clinch
    const out = step(s);
    expect(s.boxers[0].dizzy).toBe(false);
    expect(out.a0.state).toBe('S2');
  });

  it('BX-H-04..07: S4 on the KNOCKDOWN tick, S5 on the first tick past fallS, S6 when the rise starts, S2 on GET_UP', () => {
    const { steps } = knockdownScript();
    const kd = steps.findIndex((st) => st.events.includes('KNOCKDOWN'));
    expect(steps[kd]!.a0.state).toBe('S4');
    expect(steps[kd - 1]!.a0.state).toBe('S3');
    const s5 = entered(steps, 'S5');
    expect(s5.before).toBe('S4');
    expect(s5.tick! - steps[kd]!.tick).toBe(Math.ceil(C.knockdown.fallS / C.fixedDt - 1e-9));
    const s6 = entered(steps, 'S6');
    expect(s6.before).toBe('S5');
    expect(s6.step!.a0.root).toEqual({ blend: expect.closeTo(0, 1) });
    const up = steps.at(-1)!;
    expect(up.events).toContain('GET_UP');
    expect(up.a0.state).toBe('S2');
    expect(steps.at(-2)!.a0.state).toBe('S6');
  });

  it('BX-H-11: S11 on the PAUSE tick (held, not sim); resume returns the rig to the player', () => {
    const s = initBoxing({ seed: 1, skipIntro: true });
    step(s);
    const paused = step(s, [{ type: 'PAUSE', player: 1 }]);
    expect(paused.a0.state).toBe('S11');
    expect(CHANNELS.every((c) => paused.a0[c] === 'player')).toBe(true);
    for (let i = 0; i < 2 / C.fixedDt; i++) step(s);
    expect(s.boxers[0].body.source).toBe('pose'); // a long pause never hands the body to the puppet
    const resumed = step(s, [{ type: 'RESUME', player: 1 }]);
    expect(resumed.a0.state).toBe('S1');
  });

  it('BX-H-12: on the MATCH_OVER tick the KO loser is S13 and the winner S12; a decision is S12 for both', () => {
    const s = initBoxing({ seed: 1, skipIntro: true });
    Object.assign(s, { phase: 'down', phaseT: 0, down: { boxer: 0, getUpAt: 10 } });
    const steps = runUntil(s, (st) => st.events.includes('MATCH_OVER'));
    expect(steps.at(-1)!.a0.state).toBe('S13');
    expect(steps.at(-1)!.a0.head).toBe('player');
    expect(steps.at(-2)!.a0.state).toBe('S5');
    const d = initBoxing({ seed: 1, skipIntro: true });
    Object.assign(d, { round: C.phases.rounds, roundT: C.fixedDt });
    const end = step(d);
    expect(end.events).toContain('MATCH_OVER');
    expect([end.a0.state, end.a1.state]).toEqual(['S12', 'PUPPET']);
  });

  it('a boxer with no body is a puppet (§2.4); a live body stops being one on its first BODY tick', () => {
    const s = initBoxing({ seed: 1, skipIntro: true });
    expect(boxingAuthority(s, 0).state).toBe('PUPPET');
    expect(step(s).a0.state).toBe('S2');
  });
});

describe('recalibration gate (PLAN-BOXING BX-CAL-4)', () => {
  it('accepted in intro, fight, break and over; ignored for the boxer who is down, also while paused there', () => {
    const s = initBoxing({ seed: 1 });
    expect([canRecalibrate(s, 0), canRecalibrate(s, 1)]).toEqual([true, true]); // intro
    Object.assign(s, { phase: 'fight' });
    expect(canRecalibrate(s, 0)).toBe(true);
    Object.assign(s, { phase: 'down', phaseT: 1, down: { boxer: 0, getUpAt: 5 } });
    expect([canRecalibrate(s, 0), canRecalibrate(s, 1)]).toEqual([false, true]);
    Object.assign(s, { phase: 'paused', pausedFrom: 'down' });
    expect(canRecalibrate(s, 0)).toBe(false);
    for (const phase of ['break', 'over'] as const) {
      Object.assign(s, { phase, pausedFrom: null, down: null });
      expect(canRecalibrate(s, 0)).toBe(true);
    }
  });
});

describe('boxingAuthority invariants (PLAN-BOXING §4)', () => {
  it('BX-A-1: over a scripted match (intro, fight, dizzy, knockdown, rise, pause, KO), sim owns channels only in S4, and all of them there', () => {
    const s = initBoxing({ seed: 3 });
    const all: Step[] = [...runUntil(s, (st) => st.a0.state === 'S2')];
    Object.assign(s.boxers[0], { stamina: 0.05 });
    let n = 0;
    all.push(
      ...runUntil(
        s,
        (st) => st.events.includes('GET_UP'),
        () => (n++ % 60 === 0 ? [{ type: 'PUNCH_RIGHT', player: 1 }] : []),
      ),
    );
    all.push(
      step(s, [{ type: 'PAUSE', player: 0 }]),
      step(s),
      step(s, [{ type: 'RESUME', player: 0 }]),
    );
    Object.assign(s, { phase: 'down', phaseT: 0, down: { boxer: 0, getUpAt: 10 } });
    all.push(...runUntil(s, (st) => st.events.includes('MATCH_OVER')), step(s));
    const seen = new Set(all.map((st) => st.a0.state));
    for (const state of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S11', 'S13'] as const)
      expect(seen, state).toContain(state);
    for (const st of all) {
      const sim = CHANNELS.filter((c) => st.a0[c] === 'sim');
      expect(sim.length, `${st.a0.state} @${st.tick}`).toBe(
        st.a0.state === 'S4' ? CHANNELS.length : 0,
      );
    }
  });

  it('BX-A-3: same seed and event log → identical authority on every tick', () => {
    const a = knockdownScript(7).steps.map((st) => JSON.stringify([st.tick, st.a0, st.a1]));
    const b = knockdownScript(7).steps.map((st) => JSON.stringify([st.tick, st.a0, st.a1]));
    expect(b).toEqual(a);
  });
});
