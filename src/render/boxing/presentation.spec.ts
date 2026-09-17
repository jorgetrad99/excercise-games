import { describe, expect, it } from 'vitest';
import { initBoxing, tickBoxing } from '../../core/boxing/sim';
import { createPresentation, impactZone } from './presentation';

describe('boxing presentation', () => {
  it('maps hook sides and uppercuts in defender coordinates', () => {
    const f = initBoxing({ seed: 42 }).boxers[0].fists[0];
    f.aim = { x: 1, y: 0 };
    expect(impactZone(f, 0)).toBe(0);
    f.aim = { x: -1, y: 0 };
    expect(impactZone(f, 0)).toBe(1);
    f.aim = { x: 0, y: 1 };
    expect(impactZone(f, 0)).toBe(2);
  });
  it('accumulates real clean hits once, excludes blocks, preserves damage through regen, resets on restart', () => {
    const s = initBoxing({ seed: 42, skipIntro: true }),
      read = createPresentation();
    read(s, 1);
    tickBoxing(s, [{ type: 'PUNCH_RIGHT', aim: { x: 1, y: 0 } }]);
    for (let i = 0; i < 12; i++) {
      tickBoxing(s, []);
      read(s, 1);
    }
    expect(read(s, 1).damage).toEqual([0.24, 0, 0]);
    for (let i = 0; i < 120; i++) {
      tickBoxing(s, []);
      read(s, 1);
    }
    s.boxers[1].guard = true;
    tickBoxing(s, [{ type: 'PUNCH_LEFT' }]);
    for (let i = 0; i < 15; i++) {
      tickBoxing(s, []);
      read(s, 1);
    }
    expect(read(s, 1).damage).toEqual([0.24, 0, 0]);
    expect(read(initBoxing({ seed: 42 }), 1).damage).toEqual([0, 0, 0]);
  });
  it('falls at zero, stays down for KO, rises before a recoverable count ends', () => {
    const s = initBoxing({ seed: 42, skipIntro: true }),
      read = createPresentation();
    read(s, 1);
    s.boxers[1].dizzy = true;
    s.boxers[1].stamina = 0;
    tickBoxing(s, []);
    read(s, 1);
    for (let i = 0; i < 25; i++) tickBoxing(s, []);
    expect(read(s, 1).stage).toBe('fall');
    s.phase = 'down';
    s.down = { boxer: 1, getUpAt: 5 };
    s.phaseT = 3.5;
    tickBoxing(s, []);
    expect(read(s, 1).stage).toBe('rise');
    s.down.getUpAt = 10;
    tickBoxing(s, []);
    expect(read(s, 1).floor).toBe(1);
    s.phase = 'paused';
    s.pausedFrom = 'down';
    const paused = structuredClone(read(s, 1));
    for (let i = 0; i < 100; i++) tickBoxing(s, []);
    expect(read(s, 1)).toEqual(paused);
  });

  it('places simultaneous left/right hits on separate cheeks', () => {
    const s = initBoxing({ seed: 42, skipIntro: true }),
      read = createPresentation();
    read(s, 1);
    tickBoxing(s, [
      { type: 'PUNCH_LEFT', aim: { x: -1, y: 0 } },
      { type: 'PUNCH_RIGHT', aim: { x: 1, y: 0 } },
    ]);
    for (let i = 0; i < 12; i++) {
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
    for (let i = 0; i < 20; i++) {
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
