// Skate Run sim tuning (PLAN §2.3–§2.4). Units: meters, seconds, m/s unless noted.
// World axis: `z` = distance along the track (grows forward). Lanes are -1 | 0 | 1 at x = lane · laneWidth.
export const simConfig = {
  /** Fixed sim tick, s (PLAN §3: 120 Hz accumulator). */
  fixedDt: 1 / 120,

  world: {
    chunkLength: 24,
    /** Pattern grid row length; 12 rows per chunk. */
    rowLength: 2,
    laneWidth: 2,
    /** Chunks kept ahead of / behind the player. */
    chunksAhead: 8,
    chunksBehind: 1,
    /** Empty chunks at the start of a run (run-up after the countdown). */
    safeChunks: 2,
    /** Pattern difficulty ceiling rises by 1 every N m (max 5). */
    difficultyStepM: 300,
    /** Biome changes every N m. */
    biomeLengthM: 1000,
    /** Minimum travel time between two rows that block every lane ("must jump/slide"), s. */
    forcedGapS: 1.5,
  },

  /** speed = base + perMeter · distance, capped at max. */
  speed: { base: 12, perMeter: 0.02, max: 26 },

  phases: {
    /** 3-2-1 before a run, s. */
    countdownS: 3,
    /** Countdown after tracking comes back (RESUME), s. */
    resumeCountdownS: 1,
  },

  player: {
    halfWidth: 0.35,
    halfDepth: 0.3,
    height: 1.8,
    slideHeight: 0.9,
    /** Lateral speed while changing lanes; 2 m lane → ~0.17 s. */
    laneSpeed: 12,
  },

  /** Fixed-height parabola: same height and airtime at every speed. */
  jump: {
    height: 1.4,
    airtimeS: 0.75,
    /** SLIDE_START in the air slams down at this speed. */ fastFallSpeed: 12,
  },

  /** A tap (start+end together) still slides this long, s. Held crouch slides until SLIDE_END. */
  slide: { minS: 0.6 },

  obstacles: {
    halfWidth: 0.8,
    /** Low barrier: jump over it. */
    jump: { y0: 0, y1: 0.9, depth: 0.5 },
    /** High bar: slide under it. */
    slide: { y0: 1.0, y1: 2.6, depth: 0.5 },
    /** Full block (train/building): change lane. Depth = merged grid rows. */
    wall: { y0: 0, y1: 3.2 },
  },

  coins: {
    groundY: 1.0,
    /** 'o' cells: only reachable mid-jump. */
    highY: 2.6,
    /** Half-extent of the pickup box around a coin, m. */
    radius: 0.6,
    /** Magnet collects coins in any lane up to this far ahead, m. */
    magnetRange: 8,
  },

  powerups: {
    durationS: 10,
    /** Chance a 'P' pattern cell actually spawns a pickup. */
    spawnChance: 0.35,
    /** Relative weights of the pickup kinds. `token` = rare revive token (PLAN §2.4). */
    weights: { magnet: 3, double: 3, hoverboard: 2, token: 1 },
  },

  revive: { windowS: 3, maxPerRun: 2, /** Invulnerable after a revive, s. */ graceS: 2 },

  scoring: {
    closeCall: 50,
    /** Jump started at most this long before reaching the obstacle = close call, s. */
    closeCallWindowS: 0.3,
    /** Grab bonus = airtime (s) · this. */
    grabPerAirS: 100,
  },
} as const;

export type SimConfig = typeof simConfig;
