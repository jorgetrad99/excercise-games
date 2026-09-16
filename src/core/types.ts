// Skate Run sim state (PLAN §3 SimState). Plain JSON-able data: cloneable for the bot, hashable for determinism.
export type Lane = -1 | 0 | 1;
export type ObstacleKind = 'jump' | 'slide' | 'wall';
export type PickupKind = 'magnet' | 'double' | 'hoverboard' | 'token';
export type BiomeId = 'street' | 'park';

/** `z` = world distance of the near edge; occupies [z, z + len). */
export interface Obstacle {
  id: number;
  lane: Lane;
  z: number;
  len: number;
  kind: ObstacleKind;
}

export interface Coin {
  id: number;
  lane: Lane;
  z: number;
  y: number;
}

export interface Pickup {
  id: number;
  lane: Lane;
  z: number;
  kind: PickupKind;
}

/** Immutable once generated; collected items are tracked in `SimState.taken`. */
export interface ChunkState {
  index: number;
  z0: number;
  biome: BiomeId;
  patternId: string;
  difficulty: number;
  obstacles: readonly Obstacle[];
  coins: readonly Coin[];
  pickups: readonly Pickup[];
  /** World z of rows that block every lane (must jump/slide). */
  forced: readonly number[];
  /** Last forced row in this chunk or any earlier one (null if none yet): worldgen's gap rule. */
  lastForced: number | null;
}

export type Phase = 'countdown' | 'running' | 'paused' | 'crashed' | 'over';

export type SimEventType =
  'COIN' | 'PICKUP' | 'JUMP' | 'LAND' | 'CRASH' | 'REVIVE' | 'CLOSE_CALL' | 'GRAB' | 'GAME_OVER';

export interface SimStats {
  jumps: number;
  slides: number;
  laneChanges: number;
  closeCalls: number;
  grabs: number;
  crashes: number;
}

export interface SimState {
  seed: number;
  /** Sim time, s. */
  t: number;
  tick: number;
  phase: Phase;
  /** Countdown remaining (countdown) or revive window remaining (crashed), s. */
  phaseT: number;
  /** Phase to return to after RESUME (null unless paused). */
  pausedFrom: 'countdown' | 'running' | 'crashed' | null;
  distance: number;
  speed: number;
  /** Lane the player is closest to. */
  lane: Lane;
  targetLane: Lane;
  x: number;
  y: number;
  vy: number;
  airborne: boolean;
  jumpT: number;
  /** jumpT of the jump that already scored a close call (one per jump). */
  closeCallJumpT: number;
  grabbing: boolean;
  sliding: boolean;
  slideHeld: boolean;
  /** SLIDE_START came mid-air: slide on landing even if the key was already released. */
  slideQueued: boolean;
  slideT: number;
  alive: boolean;
  score: number;
  coins: number;
  multiplier: number;
  /** Seconds left per power-up; 0 = inactive. */
  powerups: { magnet: number; double: number; hoverboard: number };
  /** Post-revive invulnerability left, s. */
  grace: number;
  reviveTokens: number;
  revivesUsed: number;
  chunks: ChunkState[];
  /** Ids of collected coins/pickups in live chunks. */
  taken: number[];
  stats: SimStats;
  /** Events emitted during the latest tick (GameSim collects them for drainEvents()). */
  events: { t: number; type: SimEventType }[];
}
