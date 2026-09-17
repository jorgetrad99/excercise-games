import { describe, expect, it } from 'vitest';
import { hashJson } from '../hash';
import type { Aim, InputEventType } from '../input';
import { boxingConfig as C } from './boxing.config';
import { boxingBot } from './bot';
import { createBoxingSim, initBoxing, refereeCount, tickBoxing, type BoxingInput } from './sim';
import type { BoxerId, BoxingState } from './types';

const fight = () => initBoxing({ seed: 1, skipIntro: true });
const ev = (type: InputEventType, player: BoxerId = 0, aim?: Aim): BoxingInput =>
  aim ? { type, player, aim } : { type, player };
/** Tick `s` for `seconds`, `events` on the first tick; returns every sim event type. */
function run(s: BoxingState, seconds: number, events: BoxingInput[] = []): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.round(seconds / C.fixedDt); i++) {
    tickBoxing(s, i === 0 ? events : []);
    out.push(...s.events.map((e) => e.type));
  }
  return out;
}
const PUNCH_S = C.punch.travelS + C.punch.retractS + 0.02;
/** The stamina a clean hit on `who` just took: base drain scaled by that hit's impact speed. */
const clean = (s: BoxingState, who: BoxerId): number => {
  const hit = s.boxers[who].hits.at(-1)!;
  const part = hit.part === 'body' ? C.impact.bodyMult : 1;
  return C.stamina.clean * part * Math.min(C.impact.maxMult, hit.speed / C.impact.refSpeedMps);
};
const HOOK_RIGHT: Aim = { x: 0.9, y: 0 }; // left fist sweeping toward the puncher's right
const UPPER: Aim = { x: 0, y: 0.9 };

describe('boxing sim rules', () => {
  it('a key straight lands when its glove reaches the face; damage scales with impact speed', () => {
    const s = fight();
    expect(run(s, 0.05, [ev('PUNCH_RIGHT')])).toEqual(['PUNCH']); // glove still on its way
    expect(s.boxers[1].stamina).toBe(10);
    expect(run(s, C.punch.travelS)).toEqual(['HIT']);
    expect(s.boxers[1].hits.at(-1)).toMatchObject({ part: 'head' });
    expect(s.boxers[1].hits.at(-1)!.speed).toBeGreaterThan(1);
    expect(s.boxers[1].stamina).toBeCloseTo(10 - clean(s, 1));
    expect(s.boxers[0].landed).toBe(1);
  });

  it('recovery: the same fist cannot punch again until its glove has stopped; the other fist can', () => {
    const s = fight();
    run(s, 0.25, [ev('PUNCH_RIGHT')]);
    expect(run(s, 0.3, [ev('PUNCH_RIGHT')])).toEqual([]); // still retracting: ignored
    expect(run(s, 0.3, [ev('PUNCH_LEFT')])).toEqual(['PUNCH', 'HIT']);
    run(s, 0.5);
    expect(run(s, PUNCH_S, [ev('PUNCH_RIGHT')])).toEqual(['PUNCH', 'HIT']);
  });

  it('guard turns a hit into a small block drain, but an uppercut splits it', () => {
    const s = fight();
    expect(run(s, PUNCH_S, [ev('GUARD_START', 1), ev('PUNCH_LEFT')])).toEqual(['PUNCH', 'BLOCK']);
    expect(s.boxers[1].stamina).toBeCloseTo(10 - C.stamina.blocked);
    expect(run(s, PUNCH_S, [ev('PUNCH_LEFT', 0, UPPER)])).toEqual(['PUNCH', 'HIT']);
    expect(s.boxers[1].stamina).toBeCloseTo(10 - C.stamina.blocked - clean(s, 1));
  });

  it('a sway beats a straight (whiff costs the attacker) and opens a counter window', () => {
    const s = fight();
    expect(run(s, PUNCH_S, [ev('DODGE_LEFT', 1), ev('PUNCH_RIGHT')])).toEqual(['PUNCH', 'WHIFF']);
    const afterWhiff = 10 - C.stamina.whiff;
    expect(s.boxers[0].stamina).toBeCloseTo(afterWhiff);
    expect(run(s, PUNCH_S, [ev('PUNCH_LEFT', 1)])).toEqual(['PUNCH', 'COUNTER']);
    expect(s.boxers[0].stamina).toBeCloseTo(afterWhiff - clean(s, 0) * C.stamina.counterMult);
  });

  it('a guard raised onto a glove already on its way in blocks it (the glove does not pass through)', () => {
    for (const late of [10, 11, 12]) {
      const s = fight();
      const out: string[] = [];
      for (let i = 0; i < PUNCH_S / C.fixedDt; i++) {
        tickBoxing(s, [
          ...(i === 0 ? [ev('PUNCH_RIGHT')] : []),
          ...(i === late ? [ev('GUARD_START', 1)] : []),
        ]);
        out.push(...s.events.map((e) => `${e.type}:${e.boxer}`));
      }
      expect(out, `guard on tick ${late}`).toContain('BLOCK:1');
      expect(out, `guard on tick ${late}`).not.toContain('HIT:1');
    }
  });

  it('key straights travel level: on an idle boxer a right lands on the left cheek, a left on the right (not the chin)', () => {
    const landed = (e: BoxingInput) => {
      const s = fight();
      const events = run(s, PUNCH_S, [e]);
      return { events, zone: s.boxers[1].hits.at(-1)?.zone };
    };
    expect(landed(ev('PUNCH_RIGHT'))).toEqual({ events: ['PUNCH', 'HIT'], zone: 0 });
    expect(landed(ev('PUNCH_LEFT'))).toEqual({ events: ['PUNCH', 'HIT'], zone: 1 });
  });

  it('dodge vs aim falls out of the vector: hooks catch a sway into them, uppercuts catch a duck', () => {
    // Boxer 1 sways to their right = the attacker's left; a hook sweeping to the attacker's right misses…
    let s = fight();
    expect(run(s, PUNCH_S, [ev('DODGE_RIGHT', 1), ev('PUNCH_LEFT', 0, HOOK_RIGHT)])).toContain(
      'WHIFF',
    );
    // …and one sweeping to the attacker's left (toward the sway) catches it.
    s = fight();
    expect(
      run(s, PUNCH_S, [ev('DODGE_RIGHT', 1), ev('PUNCH_RIGHT', 0, { x: -0.9, y: 0 })]),
    ).toContain('HIT');
    s = fight();
    expect(run(s, PUNCH_S, [ev('DUCK', 1), ev('PUNCH_LEFT', 0, HOOK_RIGHT)])).toContain('WHIFF');
    s = fight();
    expect(run(s, PUNCH_S, [ev('DUCK', 1), ev('PUNCH_LEFT', 0, UPPER)])).toContain('HIT');
  });

  it('stamina 0 → dizzy: no punching, dodging still works, next clean hit is a knockdown', () => {
    const s = fight();
    s.boxers[1].stamina = C.stamina.clean;
    expect(run(s, PUNCH_S, [ev('PUNCH_RIGHT')])).toEqual(['PUNCH', 'HIT', 'DIZZY']);
    expect(run(s, 2, [ev('PUNCH_LEFT', 1)])).toEqual([]); // can't punch, and no regen while dizzy
    expect(s.boxers[1].stamina).toBe(0);
    expect(run(s, PUNCH_S, [ev('DODGE_LEFT', 1), ev('PUNCH_RIGHT')])).toEqual(['PUNCH', 'WHIFF']);
    run(s, 1);
    expect(run(s, PUNCH_S, [ev('GUARD_START', 1), ev('PUNCH_RIGHT')])).toEqual([
      'PUNCH',
      'KNOCKDOWN',
    ]);
    expect(s.phase).toBe('down');
    // First knockdown: up at count 2–7, with max stamina −2.
    const at = s.down!.getUpAt;
    expect(at).toBeGreaterThanOrEqual(2);
    expect(at).toBeLessThanOrEqual(7);
    expect(run(s, at * C.knockdown.countS + 0.05)).toEqual(['GET_UP']);
    expect(s.boxers[1]).toMatchObject({ max: 8, stamina: 8, dizzy: false, knockdowns: 1 });
    expect(s.phase).toBe('fight');
  });

  it('a get-up count of 10 is a KO; three knockdowns is a TKO', () => {
    let s = fight();
    Object.assign(s, { phase: 'down', phaseT: 0, down: { boxer: 1, getUpAt: 10 } });
    run(s, 9 * C.knockdown.countS);
    expect(refereeCount(s)).toBe(9);
    expect(run(s, C.knockdown.countS)).toEqual(['MATCH_OVER']);
    expect(s).toMatchObject({ phase: 'over', winner: 0, result: 'KO' });

    s = fight();
    Object.assign(s.boxers[1], { knockdowns: 2, dizzy: true, stamina: 0 });
    expect(run(s, PUNCH_S, [ev('PUNCH_LEFT')])).toEqual(['PUNCH', 'KNOCKDOWN', 'MATCH_OVER']);
    expect(s).toMatchObject({ phase: 'over', winner: 0, result: 'TKO' });
  });

  it('rounds: break refills stamina; after round 3 knockdowns decide, then clean hits, else a draw', () => {
    const s = fight();
    s.boxers[0].stamina = 3;
    expect(run(s, C.phases.roundS)).toContain('ROUND_END');
    expect(s).toMatchObject({ phase: 'break', round: 2 });
    expect(s.boxers[0].stamina).toBe(10);
    run(s, C.phases.breakS + C.phases.roundS + C.phases.breakS + C.phases.roundS);
    expect(s).toMatchObject({ phase: 'over', result: 'draw', winner: null });

    const byKd = fight();
    byKd.round = 3;
    Object.assign(byKd.boxers[0], { knockdowns: 1, landed: 30 });
    run(byKd, C.phases.roundS);
    expect(byKd).toMatchObject({ result: 'decision', winner: 1 });
    const byHits = fight();
    byHits.round = 3;
    byHits.boxers[0].landed = 3;
    run(byHits, C.phases.roundS);
    expect(byHits).toMatchObject({ result: 'decision', winner: 0 });
  });

  it('2P pause: the match resumes only when every player who paused is back', () => {
    const s = fight();
    run(s, 0.1, [ev('PAUSE', 0), ev('PAUSE', 1)]);
    run(s, 0.1, [ev('RESUME', 0)]);
    expect(s.phase).toBe('paused');
    run(s, 0.1, [ev('RESUME', 1)]);
    expect(s.phase).toBe('intro');
  });

  it('both boxers dizzy: the clinch breaks at once, both on one segment', () => {
    const s = fight();
    for (const b of s.boxers) Object.assign(b, { stamina: 0, dizzy: true });
    run(s, C.fixedDt);
    expect(s.boxers.map((b) => [b.dizzy, b.stamina])).toEqual([
      [false, 1],
      [false, 1],
    ]);
  });

  it('pause freezes the round; resume gives a short intro', () => {
    const s = fight();
    run(s, 1, [ev('PAUSE')]);
    expect(s.roundT).toBe(C.phases.roundS);
    run(s, C.fixedDt, [ev('RESUME')]);
    expect(s.phase).toBe('intro');
    run(s, C.phases.resumeIntroS + 0.05);
    expect(s.phase).toBe('fight');
  });
});

describe('boxing bot and determinism', () => {
  const MATCH_S = C.phases.introS + 3 * (C.phases.roundS + C.phases.breakS) + 60;
  function botMatch(seed: number, frame = C.fixedDt) {
    const sim = createBoxingSim({ seed }, boxingBot([0, 1]));
    const events: string[] = [];
    for (let t = 0; t < MATCH_S && sim.getState().phase !== 'over'; t += frame) {
      sim.step(frame, []);
      events.push(...sim.drainEvents().map((e) => e.type));
    }
    return { state: sim.getState(), events };
  }

  it('bot vs bot plays a real match to a result, using every mechanic', () => {
    const { state, events } = botMatch(42);
    expect(state.phase).toBe('over');
    expect(state.result).not.toBeNull();
    for (const type of ['PUNCH', 'HIT', 'BLOCK', 'WHIFF', 'DIZZY', 'KNOCKDOWN'])
      expect(events, type).toContain(type);
  });

  it('same seed → identical hash; another seed differs; frame pacing does not matter', () => {
    const h = hashJson(botMatch(42).state);
    expect(hashJson(botMatch(42).state)).toBe(h);
    expect(hashJson(botMatch(43).state)).not.toBe(h);
    expect(hashJson(botMatch(42, C.fixedDt / 2).state)).toBe(h);
  });

  it('the 1P bot reacts: guards or sways against telegraphed punches far more than chance', () => {
    const sim = createBoxingSim({ seed: 5, skipIntro: true }, boxingBot([1]));
    const counts = { thrown: 0, defended: 0 };
    const every = Math.round(0.65 / C.fixedDt) + 1; // 0.65 s, off the bot's punch grid, like a human
    for (let tick = 0; tick < 40 * every; tick++) {
      const punch =
        tick % every === 0
          ? [{ t: 0, type: tick % (2 * every) ? 'PUNCH_LEFT' : 'PUNCH_RIGHT' } as const]
          : [];
      sim.step(C.fixedDt, punch);
      for (const e of sim.drainEvents()) {
        if (e.type === 'PUNCH' && e.boxer === 0) counts.thrown++;
        if ((e.type === 'BLOCK' && e.boxer === 1) || (e.type === 'WHIFF' && e.boxer === 0))
          counts.defended++;
      }
    }
    expect(counts.thrown).toBeGreaterThan(10); // the rest fell on a dizzy spell or a count
    expect(counts.defended / counts.thrown).toBeGreaterThan(0.3);
  });
});
