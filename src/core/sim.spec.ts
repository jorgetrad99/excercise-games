import { describe, expect, it } from 'vitest';
import type { InputEventType } from './input';
import { createContext, createGameSim, initState, tick, type SimOptions } from './sim';
import { simConfig as C } from './sim.config';
import { worldOf } from './testing';
import type { SimEventType, SimState } from './types';
import type { ChunkSource } from './worldgen';

/** A running sim on a hand-built world; `run(seconds, events)` ticks with events on the first tick. */
function harness(grids: Record<number, readonly string[]> = {}, opts: Partial<SimOptions> = {}) {
  const o: SimOptions = { seed: 1, skipCountdown: true, chunkSource: worldOf(grids), ...opts };
  const ctx = createContext(o);
  const s = initState(o, ctx);
  const run = (seconds: number, events: InputEventType[] = []): SimState => {
    const n = Math.round(seconds / C.fixedDt);
    for (let i = 0; i < n; i++) {
      tick(s, ctx, i === 0 ? events.map((type) => ({ type })) : []);
      log.push(...s.events.map((e) => e.type));
    }
    return s;
  };
  const log: SimEventType[] = [];
  return { s, run, log };
}

const rows = (near: Record<number, string>): string[] =>
  Array.from({ length: 12 }, (_, i) => near[11 - i] ?? '...');

describe('GameSim basics', () => {
  it('counts down 3 s, then runs with the distance speed ramp', () => {
    const sim = createGameSim({ seed: 1 });
    const frames = (seconds: number) => {
      for (let i = 0; i < seconds * 60; i++) sim.step(1 / 60, []);
    };
    frames(2.9);
    expect(sim.getState().phase).toBe('countdown');
    expect(sim.getState().distance).toBe(0);
    frames(0.2);
    expect(sim.getState().phase).toBe('running');
    frames(1);
    const s = sim.getState();
    expect(s.distance).toBeGreaterThan(11);
    expect(s.speed).toBeCloseTo(C.speed.base + C.speed.perMeter * s.distance, 1);
    expect(s.chunks.length).toBe(C.world.chunksAhead + 1);
  });

  it('caps speed at 26 m/s', () => {
    const { s, run } = harness({}, { startDistance: 5000 });
    run(0.1);
    expect(s.speed).toBe(C.speed.max);
  });

  it('changes lanes smoothly and clamps at the edges', () => {
    const { s, run } = harness();
    run(0.05, ['LANE_LEFT']);
    expect(s.x).toBeLessThan(0);
    expect(s.x).toBeGreaterThan(-2);
    run(0.3, ['LANE_LEFT']);
    expect([s.lane, s.targetLane, s.x]).toEqual([-1, -1, -2]);
    expect(s.stats.laneChanges).toBe(1);
  });

  it('jumps a fixed-height arc and lands after the configured airtime', () => {
    const { s, run } = harness();
    let peak = 0;
    run(C.fixedDt, ['JUMP']);
    let air = C.fixedDt;
    while (s.airborne) {
      run(C.fixedDt, ['JUMP']); // jumping again mid-air does nothing
      air += C.fixedDt;
      peak = Math.max(peak, s.y);
    }
    expect(peak).toBeCloseTo(C.jump.height, 1);
    expect(air).toBeCloseTo(C.jump.airtimeS, 1);
    expect(s.stats.jumps).toBe(1);
  });

  it('a slide tap lasts slide.minS; a held slide lasts until SLIDE_END', () => {
    const { s, run } = harness();
    run(C.slide.minS - 0.05, ['SLIDE_START', 'SLIDE_END']);
    expect(s.sliding).toBe(true);
    run(0.1);
    expect(s.sliding).toBe(false);
    run(1.5, ['SLIDE_START']);
    expect(s.sliding).toBe(true);
    run(0.01, ['SLIDE_END']);
    expect(s.sliding).toBe(false);
  });
});

describe('collisions', () => {
  // Chunk 1 (z 24–48); rows are 2 m; obstacle row 4 = z 32–34.
  const hurdle = { 1: rows({ 4: '.J.' }) };
  const bar = { 1: rows({ 4: '.S.' }) };
  const wall = { 1: rows({ 3: '.W.', 4: '.W.' }) };
  /** Run to z = 40, firing `e` once when the player passes z = 28 (a good takeoff point for row 4). */
  const until = (run: (t: number, e?: InputEventType[]) => SimState, e: InputEventType[]) => {
    const s = run(0);
    while (s.distance < 28) run(C.fixedDt);
    run(C.fixedDt, e);
    while (s.distance < 40 && s.phase === 'running') run(C.fixedDt);
    return s;
  };

  it('running into a hurdle crashes; jumping it clears', () => {
    expect(until(harness(hurdle).run, []).phase).toBe('over');
    const cleared = until(harness(hurdle).run, ['JUMP']);
    expect(cleared.phase).toBe('running');
  });

  it('a slide bar crashes a standing or jumping player; sliding clears it', () => {
    expect(until(harness(bar).run, []).phase).toBe('over');
    expect(until(harness(bar).run, ['JUMP']).phase).toBe('over');
    expect(until(harness(bar).run, ['SLIDE_START', 'SLIDE_END']).phase).toBe('running');
  });

  it('walls can only be avoided by changing lane', () => {
    expect(until(harness(wall).run, ['JUMP']).phase).toBe('over');
    expect(until(harness(wall).run, ['LANE_RIGHT']).phase).toBe('running');
  });

  it('hoverboard makes the player invulnerable', () => {
    const { s, run } = harness(wall);
    s.powerups.hoverboard = 10;
    expect(until(run, []).phase).toBe('running');
  });

  it('close call: a jump started ≤ 0.3 s before the hurdle scores +50', () => {
    const { s, run } = harness(hurdle);
    // near edge of the hurdle is at 33 - depth/2; jump 0.25 s before the player's front reaches it
    const zJump = 33 - C.obstacles.jump.depth / 2 - C.player.halfDepth - 0.25 * s.speed;
    while (s.distance < zJump) run(C.fixedDt);
    run(C.fixedDt, ['JUMP']);
    run(1);
    expect(s.phase).toBe('running');
    expect(s.stats.closeCalls).toBe(1);
  });
});

describe('coins, power-ups, grab, revive, pause', () => {
  it('collects ground coins in the lane; high coins need a jump', () => {
    const { s, run } = harness({ 1: rows({ 2: '.c.', 5: '.o.' }) });
    run(3.5);
    expect(s.coins).toBe(2);
  });

  it('magnet collects coins from every lane; double coins count twice', () => {
    const { s, run } = harness({ 1: rows({ 2: 'c.c' }) });
    s.powerups.magnet = 10;
    s.powerups.double = 10;
    run(3.5);
    expect(s.coins).toBe(8);
  });

  it('power-up pickups activate for 10 s', () => {
    const source: ChunkSource = (seed, index, prev) => {
      const chunk = worldOf({})(seed, index, prev);
      return index === 1
        ? { ...chunk, pickups: [{ id: 1500, lane: 0, z: 30, kind: 'magnet' }] }
        : chunk;
    };
    const { s, run, log } = harness({}, { chunkSource: source });
    run(2.6);
    expect(s.powerups.magnet).toBeGreaterThan(9);
    expect(log).toContain('PICKUP');
  });

  it('grab while airborne adds airtime · 100 on landing', () => {
    const { s, run } = harness();
    run(0.1, ['JUMP']);
    run(0.1, ['GRAB']);
    const before = s.score;
    run(0.6);
    expect(s.stats.grabs).toBe(1);
    expect(s.score - before).toBeGreaterThan(C.jump.airtimeS * 100 - 2);
  });

  it('crash with a token offers a 3 s revive; REVIVE resumes with grace, max 2 per run', () => {
    const wall = { 1: rows({ 3: '.W.', 4: '.W.', 5: '.W.' }) };
    const { s, run } = harness(wall, { reviveTokens: 5 });
    while (s.phase === 'running') run(C.fixedDt);
    expect([s.phase, s.alive]).toEqual(['crashed', false]);
    run(1, ['REVIVE']);
    expect([s.phase, s.reviveTokens, s.grace > 0]).toEqual(['running', 4, true]);
    expect(s.distance).toBeGreaterThan(34);
    for (const expected of ['crashed', 'over'] as const) {
      Object.assign(s, { x: 0, targetLane: 0, distance: 29, grace: 0 });
      while ((s.phase as string) === 'running') run(C.fixedDt);
      expect(s.phase).toBe(expected);
      run(0.1, ['REVIVE']);
    }
    expect([s.revivesUsed, s.reviveTokens, s.stats.crashes]).toEqual([2, 3, 3]);
  });

  it('without a token the crash ends the run; an ignored offer expires after 3 s', () => {
    const wall = { 1: rows({ 3: '.W.', 4: '.W.' }) };
    const none = harness(wall);
    while (none.s.phase === 'running') none.run(C.fixedDt);
    expect(none.s.phase).toBe('over');
    expect(none.log.slice(-2)).toEqual(['CRASH', 'GAME_OVER']);
    const ignored = harness(wall, { reviveTokens: 1 });
    while (ignored.s.phase === 'running') ignored.run(C.fixedDt);
    ignored.run(C.revive.windowS + 0.05);
    expect([ignored.s.phase, ignored.log.at(-1)]).toEqual(['over', 'GAME_OVER']);
  });

  it('PAUSE while crashed freezes the revive window; RESUME returns to the offer', () => {
    const { s, run } = harness({ 1: rows({ 3: '.W.', 4: '.W.' }) }, { reviveTokens: 1 });
    while (s.phase === 'running') run(C.fixedDt);
    run(1);
    run(5, ['PAUSE']);
    expect(s.phase).toBe('paused');
    run(0.5, ['RESUME']);
    expect(s.phase).toBe('crashed');
    expect(s.phaseT).toBeCloseTo(C.revive.windowS - 1.5, 1);
  });

  it('pausing during the 3 s countdown keeps the remaining countdown', () => {
    const { s, run } = harness({}, { skipCountdown: false });
    run(0.5);
    run(1, ['PAUSE']);
    run(C.fixedDt, ['RESUME']);
    expect(s.phaseT).toBeGreaterThan(2.4);
  });

  it('a slide tap mid-air fast-falls and slides on landing', () => {
    const { s, run } = harness();
    run(0.2, ['JUMP']);
    run(C.fixedDt, ['SLIDE_START', 'SLIDE_END']);
    while (s.airborne) run(C.fixedDt);
    expect(s.t).toBeLessThan(C.jump.airtimeS);
    expect(s.sliding).toBe(true);
  });

  it('GameSim.drainEvents returns every event once, even at 60 Hz frames', () => {
    const sim = createGameSim({ seed: 1, skipCountdown: true });
    const seen: string[] = [];
    sim.step(1 / 60, [{ t: 0, type: 'JUMP' }]);
    for (let i = 0; i < 60; i++) {
      sim.step(1 / 60, []);
      seen.push(...sim.drainEvents().map((e) => e.type));
    }
    expect(seen.filter((t) => t === 'LAND')).toHaveLength(1);
    expect(sim.drainEvents()).toEqual([]);
  });

  it('PAUSE freezes the world; RESUME counts down 1 s before running again', () => {
    const { s, run } = harness();
    run(1);
    const d = s.distance;
    run(2, ['PAUSE']);
    expect([s.phase, s.distance]).toEqual(['paused', d]);
    run(0.5, ['RESUME']);
    expect([s.phase, s.distance]).toEqual(['countdown', d]);
    run(0.6);
    expect(s.phase).toBe('running');
    expect(s.distance).toBeGreaterThan(d);
  });

  it('ignores movement during countdown and recalibration events always', () => {
    const sim = createGameSim({ seed: 3 });
    sim.step(0.5, [
      { t: 0, type: 'LANE_LEFT' },
      { t: 0, type: 'JUMP' },
      { t: 0, type: 'RECALIBRATE' },
    ]);
    expect(sim.getState()).toMatchObject({ targetLane: 0, airborne: false, phase: 'countdown' });
  });
});
