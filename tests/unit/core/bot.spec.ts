// M3 DoD: a headless bot with perfect reactions plays 2 minutes on seed 42 and never crashes.
// Because the bot only survives what the real physics allows, this is also the end-to-end
// solvability check for generated sequences (pattern-to-pattern transitions, speed ramp, biomes).
import { describe, expect, it } from 'vitest';
import { simConfig as C } from '../../../src/core/sim.config';
import { botRun } from '../../../src/core/testing';

const RUN_S = 120;

describe('headless bot', () => {
  it('plays 2 minutes on seed 42 without crashing', () => {
    let invulnerableTicks = 0;
    const end = botRun(
      { seed: 42 },
      (s) => s.t >= C.phases.countdownS + RUN_S,
      undefined,
      (s) => {
        if (s.powerups.hoverboard > 0 || s.grace > 0) invulnerableTicks++;
      },
    );
    // No hoverboard/grace on this seed: the bot survived every obstacle on merit.
    expect(invulnerableTicks).toBe(0);
    expect(end.phase).toBe('running');
    expect(end.stats.crashes).toBe(0);
    expect(end.speed).toBe(C.speed.max);
    expect(end.distance).toBeGreaterThan(2000); // well into difficulty 5 and the second biome
    expect(end.stats.jumps + end.stats.slides + end.stats.laneChanges).toBeGreaterThan(50);
  });

  it.each([1, 7, 1234, 99999])('also survives 60 s on seed %d', (seed) => {
    const end = botRun({ seed }, (s) => s.t >= C.phases.countdownS + 60);
    expect([end.phase, end.stats.crashes]).toEqual(['running', 0]);
  });
});
