import { describe, expect, it } from 'vitest';
import { boxingConfig as C } from '../../core/boxing/boxing.config';
import { initBoxing, tickBoxing, type BoxingInput } from '../../core/boxing/sim';
import type { BoxingState } from '../../core/boxing/types';
import { createPresentation } from './presentation';

/** Sim ticks in `seconds`. */
const ticks = (seconds: number) => Math.round(seconds / C.fixedDt);

/** `n` sim ticks, reading the presentation after each like the renderer does. */
function run(
  s: BoxingState,
  read: ReturnType<typeof createPresentation>,
  n: number,
  events: BoxingInput[] = [],
): void {
  for (let i = 0; i < n; i++) {
    tickBoxing(s, i === 0 ? events : []);
    read(s, 1);
  }
}

describe('boxing presentation', () => {
  it('hit zones come from where the glove touched, in defender coordinates', () => {
    const zone = (type: BoxingInput['type'], aim: { x: number; y: number }) => {
      const s = initBoxing({ seed: 42, skipIntro: true });
      // Guard up: straights and hooks go around it, an uppercut rises under it (the low ready gloves
      // would block an uppercut, as real gloves do).
      tickBoxing(s, [{ type: 'GUARD_START', player: 1 }, { type, aim }]);
      for (let i = 0; i < ticks(0.3); i++) tickBoxing(s, []);
      return s.boxers[1].hits.at(-1)?.zone;
    };
    expect(zone('PUNCH_RIGHT', { x: 1, y: 0 })).toBe(0); // hook to the puncher's right: defender's left cheek
    expect(zone('PUNCH_LEFT', { x: -1, y: 0 })).toBe(1);
    expect(zone('PUNCH_LEFT', { x: 0, y: 1 })).toBe(2); // uppercut: the chin
  });
  it('accumulates real clean hits once, excludes blocks, keeps damage over idle time, resets on restart', () => {
    const s = initBoxing({ seed: 42, skipIntro: true }),
      read = createPresentation();
    read(s, 1);
    tickBoxing(s, [{ type: 'PUNCH_RIGHT', aim: { x: 1, y: 0 } }]);
    for (let i = 0; i < ticks(0.2); i++) {
      tickBoxing(s, []);
      read(s, 1);
    }
    expect(read(s, 1).damage).toEqual([0.24, 0, 0]);
    for (let i = 0; i < ticks(2); i++) {
      tickBoxing(s, []);
      read(s, 1);
    }
    s.boxers[1].guard = true;
    tickBoxing(s, [{ type: 'PUNCH_LEFT' }]);
    for (let i = 0; i < ticks(0.5); i++) {
      tickBoxing(s, []);
      read(s, 1);
    }
    expect(read(s, 1).damage).toEqual([0.24, 0, 0]);
    expect(read(initBoxing({ seed: 42 }), 1).damage).toEqual([0, 0, 0]);
  });
  it('dizzy stays standing and wobbles; a cleared dizzy fades instead of popping', () => {
    const s = initBoxing({ seed: 42, skipIntro: true }),
      read = createPresentation();
    read(s, 1);
    Object.assign(s.boxers[1], { stamina: 0, dizzy: true });
    run(s, read, ticks(0.5));
    expect(read(s, 1)).toMatchObject({ stage: 'standing', floor: 0 });
    expect(read(s, 1).dizzy).toBeGreaterThan(0.9);
    s.boxers[1].dizzy = false; // e.g. the sim's clinch break
    run(s, read, 1);
    expect(read(s, 1).dizzy).toBeGreaterThan(0.5);
    expect(read(s, 1).floor).toBe(0);
    run(s, read, ticks(1));
    expect(read(s, 1).dizzy).toBeLessThan(0.01);
  });

  it('a real knockdown falls with the count and is back up when the sim resumes the fight', () => {
    const s = initBoxing({ seed: 42, skipIntro: true }),
      read = createPresentation();
    read(s, 1);
    Object.assign(s.boxers[1], { stamina: 0, dizzy: true });
    run(s, read, 1, [{ type: 'PUNCH_LEFT' }]);
    for (let i = 0; i < ticks(1) && s.phase === 'fight'; i++) run(s, read, 1);
    expect(s.phase).toBe('down');
    expect(read(s, 1).floor).toBeLessThan(0.2);
    const floors: number[] = [];
    while (s.phase === 'down') {
      run(s, read, 1);
      floors.push(read(s, 1).floor);
    }
    expect(Math.max(...floors)).toBeGreaterThan(0.95);
    const peak = floors.indexOf(Math.max(...floors));
    floors
      .slice(peak)
      .forEach((f, i, a) => i > 0 && expect(f).toBeLessThanOrEqual(a[i - 1]! + 1e-9));
    expect(floors.at(-2)!).toBeLessThan(0.05); // the last counted frame is already nearly up
    expect(read(s, 1)).toMatchObject({ stage: 'standing', floor: 0 });
  });

  it('a KO stays down without falling twice; a TKO falls from standing; pause freezes it', () => {
    const s = initBoxing({ seed: 42, skipIntro: true }),
      read = createPresentation();
    read(s, 1);
    Object.assign(s, { phase: 'down', phaseT: 0, down: { boxer: 1, getUpAt: 10 } });
    run(s, read, ticks(1));
    expect(read(s, 1).floor).toBe(1);
    for (let i = 0; i < ticks(10) && s.phase === 'down'; i++) {
      run(s, read, 1);
      expect(read(s, 1).floor).toBe(1);
    }
    expect([s.phase, s.result]).toEqual(['over', 'KO']);
    run(s, read, ticks(0.5));
    expect(read(s, 1)).toMatchObject({ stage: 'down', floor: 1 });

    const t = initBoxing({ seed: 42, skipIntro: true }),
      tko = createPresentation();
    tko(t, 1);
    Object.assign(t.boxers[1], { stamina: 0, dizzy: true, knockdowns: 2 });
    run(t, tko, 1, [{ type: 'PUNCH_LEFT' }]);
    for (let i = 0; i < ticks(1) && t.phase === 'fight'; i++) run(t, tko, 1);
    expect([t.phase, t.result]).toEqual(['over', 'TKO']);
    expect(tko(t, 1).floor).toBeLessThan(0.2);
    run(t, tko, ticks(1));
    expect(tko(t, 1).floor).toBe(1);

    const u = initBoxing({ seed: 42, skipIntro: true }),
      paused = createPresentation();
    paused(u, 1);
    Object.assign(u, { phase: 'down', phaseT: 0, down: { boxer: 1, getUpAt: 5 } });
    run(u, paused, 20);
    Object.assign(u, { phase: 'paused', pausedFrom: 'down' });
    const frozen = structuredClone(paused(u, 1));
    run(u, paused, 100);
    expect(paused(u, 1)).toEqual(frozen);
  });

  it('places simultaneous left/right hits on separate cheeks', () => {
    const s = initBoxing({ seed: 42, skipIntro: true }),
      read = createPresentation();
    read(s, 1);
    tickBoxing(s, [
      { type: 'PUNCH_LEFT', aim: { x: -1, y: 0 } },
      { type: 'PUNCH_RIGHT', aim: { x: 1, y: 0 } },
    ]);
    for (let i = 0; i < ticks(0.2); i++) {
      tickBoxing(s, []);
      read(s, 1);
    }
    expect(read(s, 1).damage).toEqual([0.24, 0.24, 0]);
  });

  it('does not knock out a decision loser and isolates each boxer damage history', () => {
    const s = initBoxing({ seed: 42, skipIntro: true });
    const a = createPresentation(),
      b = createPresentation();
    a(s, 0);
    b(s, 1);
    tickBoxing(s, [{ type: 'PUNCH_LEFT', aim: { x: -1, y: 0 } }]);
    for (let i = 0; i < ticks(0.35); i++) {
      tickBoxing(s, []);
      a(s, 0);
      b(s, 1);
    }
    expect(a(s, 0).damage).toEqual([0, 0, 0]);
    expect(b(s, 1).damage).toEqual([0, 0.24, 0]);
    s.phase = 'over';
    s.winner = 0;
    s.result = 'decision';
    tickBoxing(s, []);
    expect(b(s, 1).stage).toBe('standing');
  });
});
