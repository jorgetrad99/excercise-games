// Skate Run GameSim (PLAN §3, §4 M3). Pure and deterministic: (options, event log) → identical state.
// The world moves toward the player; `distance` is the player's world z. One `tick` = simConfig.fixedDt.
// Determinism contract: the log is TICK-stamped. `tick()` is exact; GameSim.step() applies events at
// the next tick, so the wall-clock frame pacing decides which tick a live event lands on. Replays and
// multiplayer must record (tick, type), not InputEvent.t.
import {
  chunksNear,
  laneX,
  obstacleBox,
  overlapXZ,
  overlapY,
  playerBox,
  playerHeight,
} from './collision';
import type { InputEvent, InputEventType } from './input';
import { simConfig as C } from './sim.config';
import type { Lane, PickupKind, SimEventType, SimState } from './types';
import { generateChunk, speedAt, type ChunkSource } from './worldgen';

export interface SimOptions {
  seed: number;
  /** Revive tokens owned at run start (profile, M5). */
  reviveTokens?: number;
  /** Score multiplier level (profile, M5). */
  multiplier?: number;
  /** Tests: start mid-run, skip the countdown, pin the speed, or supply chunks. */
  startDistance?: number;
  startLane?: Lane;
  skipCountdown?: boolean;
  fixedSpeed?: number;
  chunkSource?: ChunkSource;
}

/** Non-state inputs of the step function (functions/overrides that don't belong in SimState). */
export interface SimContext {
  chunkSource: ChunkSource;
  fixedSpeed: number | undefined;
}

export interface GameSim {
  readonly seed: number;
  /** Advance by `dt` seconds using fixed ticks; `events` apply at the next tick. */
  step(dt: number, events: readonly InputEvent[]): void;
  getState(): Readonly<SimState>;
  /** Sim events since the last call, oldest first (HUD, sound, camera shake). */
  drainEvents(): SimState['events'];
  /** Fraction of a tick left in the accumulator, for render interpolation. */
  alpha(): number;
}

const G = (8 * C.jump.height) / C.jump.airtimeS ** 2;
const JUMP_V = (4 * C.jump.height) / C.jump.airtimeS;
const L = C.world.chunkLength;

export function createContext(opts: SimOptions): SimContext {
  return { chunkSource: opts.chunkSource ?? generateChunk, fixedSpeed: opts.fixedSpeed };
}

export function initState(opts: SimOptions, ctx: SimContext): SimState {
  const lane = opts.startLane ?? 0;
  const distance = opts.startDistance ?? 0;
  const s: SimState = {
    seed: opts.seed,
    t: 0,
    tick: 0,
    phase: opts.skipCountdown ? 'running' : 'countdown',
    phaseT: opts.skipCountdown ? 0 : C.phases.countdownS,
    pausedFrom: null,
    distance,
    speed: ctx.fixedSpeed ?? speedAt(distance),
    lane,
    targetLane: lane,
    x: laneX(lane),
    y: 0,
    vy: 0,
    airborne: false,
    jumpT: -1e9,
    closeCallJumpT: -1e9,
    grabbing: false,
    sliding: false,
    slideHeld: false,
    slideQueued: false,
    slideT: 0,
    alive: true,
    score: 0,
    coins: 0,
    multiplier: opts.multiplier ?? 1,
    powerups: { magnet: 0, double: 0, hoverboard: 0 },
    grace: 0,
    reviveTokens: opts.reviveTokens ?? 0,
    revivesUsed: 0,
    chunks: [],
    taken: [],
    stats: { jumps: 0, slides: 0, laneChanges: 0, closeCalls: 0, grabs: 0, crashes: 0 },
    events: [],
  };
  ensureChunks(s, ctx);
  return s;
}

export function cloneState(s: SimState): SimState {
  return {
    ...s,
    powerups: { ...s.powerups },
    chunks: [...s.chunks],
    taken: [...s.taken],
    stats: { ...s.stats },
    events: [...s.events],
  };
}

const emit = (s: SimState, type: SimEventType): void => {
  s.events.push({ t: s.t, type });
};

/** One fixed tick. Events apply first, in order. */
export function tick(
  s: SimState,
  ctx: SimContext,
  events: readonly { type: InputEventType }[],
): void {
  s.events = [];
  for (const e of events) applyEvent(s, e.type);
  const dt = C.fixedDt;
  s.t += dt;
  s.tick++;
  if (s.phase === 'countdown') {
    s.phaseT -= dt;
    if (s.phaseT <= 0) Object.assign(s, { phase: 'running', phaseT: 0 });
  } else if (s.phase === 'crashed') {
    s.phaseT -= dt;
    if (s.phaseT <= 0) {
      Object.assign(s, { phase: 'over', phaseT: 0 });
      emit(s, 'GAME_OVER');
    }
  } else if (s.phase === 'running') {
    run(s, ctx, dt);
  }
}

const canRevive = (s: SimState): boolean =>
  s.reviveTokens > 0 && s.revivesUsed < C.revive.maxPerRun;

function applyEvent(s: SimState, type: InputEventType): void {
  if (type === 'SLIDE_END') s.slideHeld = false;
  else if (
    type === 'PAUSE' &&
    (s.phase === 'running' || s.phase === 'countdown' || s.phase === 'crashed')
  ) {
    s.pausedFrom = s.phase;
    s.phase = 'paused';
  } else if (type === 'RESUME' && s.phase === 'paused') resume(s);
  else if (type === 'REVIVE' && s.phase === 'crashed' && canRevive(s)) revive(s);
  if (s.phase === 'running') applyMove(s, type);
}

function applyMove(s: SimState, type: InputEventType): void {
  switch (type) {
    case 'LANE_LEFT':
    case 'LANE_RIGHT': {
      const next = Math.max(
        -1,
        Math.min(1, s.targetLane + (type === 'LANE_LEFT' ? -1 : 1)),
      ) as Lane;
      if (next !== s.targetLane) {
        s.targetLane = next;
        s.stats.laneChanges++;
      }
      break;
    }
    case 'JUMP':
      if (s.airborne) break;
      Object.assign(s, { airborne: true, vy: JUMP_V, jumpT: s.t, grabbing: false });
      Object.assign(s, { sliding: false, slideHeld: false, slideQueued: false });
      s.stats.jumps++;
      emit(s, 'JUMP');
      break;
    case 'SLIDE_START':
      s.slideHeld = true;
      if (s.airborne) {
        s.vy = Math.min(s.vy, -C.jump.fastFallSpeed);
        s.slideQueued = true;
      } else startSlide(s);
      break;
    case 'GRAB':
      if (s.airborne && !s.grabbing) s.grabbing = true;
      break;
  }
}

/** Crashed → back to the (frozen) revive offer; otherwise a countdown of at least 1 s. */
function resume(s: SimState): void {
  if (s.pausedFrom === 'crashed') s.phase = 'crashed';
  else
    Object.assign(s, { phase: 'countdown', phaseT: Math.max(s.phaseT, C.phases.resumeCountdownS) });
  s.pausedFrom = null;
}

function startSlide(s: SimState): void {
  if (!s.sliding) s.stats.slides++;
  s.sliding = true;
  s.slideT = 0;
}

function revive(s: SimState): void {
  s.reviveTokens--;
  s.revivesUsed++;
  Object.assign(s, { phase: 'running', phaseT: 0, alive: true, grace: C.revive.graceS });
  Object.assign(s, { y: 0, vy: 0, airborne: false, grabbing: false });
  Object.assign(s, { sliding: false, slideHeld: false, slideQueued: false });
  s.lane = s.targetLane;
  s.x = laneX(s.targetLane);
  emit(s, 'REVIVE');
}

function run(s: SimState, ctx: SimContext, dt: number): void {
  const prevDistance = s.distance;
  s.speed = ctx.fixedSpeed ?? speedAt(s.distance);
  s.distance += s.speed * dt;
  s.score += s.speed * dt * s.multiplier;
  moveLateral(s, dt);
  moveVertical(s, dt);
  for (const k of ['magnet', 'double', 'hoverboard'] as const) {
    s.powerups[k] = Math.max(0, s.powerups[k] - dt);
  }
  s.grace = Math.max(0, s.grace - dt);
  ensureChunks(s, ctx);
  collide(s, prevDistance);
  if (s.phase === 'running') collect(s);
}

function moveLateral(s: SimState, dt: number): void {
  const dx = laneX(s.targetLane) - s.x;
  const stepX = C.player.laneSpeed * dt;
  s.x = Math.abs(dx) <= stepX ? laneX(s.targetLane) : s.x + Math.sign(dx) * stepX;
  s.lane = Math.round(s.x / C.world.laneWidth) as Lane;
}

function moveVertical(s: SimState, dt: number): void {
  if (s.airborne) {
    s.vy -= G * dt;
    s.y += s.vy * dt;
    if (s.y <= 0) land(s);
  }
  if (s.sliding) {
    s.slideT += dt;
    if (!s.slideHeld && s.slideT >= C.slide.minS) s.sliding = false;
  }
}

function land(s: SimState): void {
  Object.assign(s, { y: 0, vy: 0, airborne: false });
  if (s.grabbing) {
    s.grabbing = false;
    s.score += Math.round((s.t - s.jumpT) * C.scoring.grabPerAirS);
    s.stats.grabs++;
    emit(s, 'GRAB');
  } else {
    emit(s, 'LAND');
  }
  if (s.slideHeld || s.slideQueued) startSlide(s);
  s.slideQueued = false;
}

function ensureChunks(s: SimState, ctx: SimContext): void {
  const here = Math.floor(s.distance / L);
  const first = Math.max(0, here - C.world.chunksBehind);
  if (s.chunks.length > 0 && s.chunks[0]!.index < first) {
    s.chunks = s.chunks.filter((c) => c.index >= first);
    s.taken = s.taken.filter((id) => id >= first * 1000);
  }
  let next = s.chunks.length > 0 ? s.chunks.at(-1)!.index + 1 : first;
  while (next <= here + C.world.chunksAhead) {
    s.chunks.push(ctx.chunkSource(s.seed, next, s.chunks.at(-1)));
    next++;
  }
}

function collide(s: SimState, prevDistance: number): void {
  const me = playerBox(s);
  const invulnerable = s.grace > 0 || s.powerups.hoverboard > 0;
  for (const chunk of chunksNear(s, L, 1)) {
    for (const o of chunk.obstacles) {
      const box = obstacleBox(o);
      if (!overlapXZ(me, box)) continue;
      if (overlapY(me, box)) {
        if (!invulnerable) return crash(s);
      } else if (isCloseCall(s, o.z, prevDistance)) {
        s.closeCallJumpT = s.jumpT;
        s.score += C.scoring.closeCall;
        s.stats.closeCalls++;
        emit(s, 'CLOSE_CALL');
      }
    }
  }
}

/** First tick of contact with an obstacle cleared by a jump that started ≤ window before. */
const isCloseCall = (s: SimState, z: number, prevDistance: number): boolean =>
  s.airborne &&
  s.closeCallJumpT !== s.jumpT &&
  prevDistance + C.player.halfDepth < z &&
  s.t - s.jumpT <= C.scoring.closeCallWindowS;

function crash(s: SimState): void {
  s.stats.crashes++;
  s.alive = false;
  s.grabbing = false;
  emit(s, 'CRASH');
  if (canRevive(s)) Object.assign(s, { phase: 'crashed', phaseT: C.revive.windowS });
  else {
    s.phase = 'over';
    emit(s, 'GAME_OVER');
  }
}

function collect(s: SimState): void {
  const me = playerBox(s);
  const r = C.coins.radius;
  const magnet = s.powerups.magnet > 0;
  const inBox = (lane: number, z: number, y: number): boolean =>
    Math.abs(z - s.distance) <= r + C.player.halfDepth &&
    Math.abs(laneX(lane) - s.x) <= r + C.player.halfWidth &&
    y >= s.y - r &&
    y <= s.y + playerHeight(s) + r;
  for (const chunk of chunksNear(s, r + me.z1 - me.z0, C.coins.magnetRange)) {
    for (const c of chunk.coins) {
      if (s.taken.includes(c.id)) continue;
      const dz = c.z - s.distance;
      if (
        !(magnet ? dz >= -C.player.halfDepth && dz <= C.coins.magnetRange : inBox(c.lane, c.z, c.y))
      )
        continue;
      s.taken.push(c.id);
      s.coins += s.powerups.double > 0 ? 2 : 1;
      emit(s, 'COIN');
    }
    for (const pk of chunk.pickups) {
      if (s.taken.includes(pk.id) || !inBox(pk.lane, pk.z, C.coins.groundY)) continue;
      s.taken.push(pk.id);
      applyPickup(s, pk.kind);
    }
  }
}

function applyPickup(s: SimState, kind: PickupKind): void {
  if (kind === 'token') s.reviveTokens++;
  else s.powerups[kind] = C.powerups.durationS;
  emit(s, 'PICKUP');
}

export function createGameSim(opts: SimOptions): GameSim {
  const ctx = createContext(opts);
  const state = initState(opts, ctx);
  let acc = 0;
  let pending: InputEvent[] = [];
  let outbox: SimState['events'] = [];
  return {
    seed: opts.seed,
    step(dt, events) {
      pending.push(...events);
      acc = Math.min(acc + dt, 0.25); // don't spiral after a long stall (tab in background)
      while (acc >= C.fixedDt - 1e-9) {
        acc -= C.fixedDt;
        tick(state, ctx, pending);
        pending = [];
        if (state.events.length > 0) outbox.push(...state.events);
      }
    },
    getState: () => state,
    drainEvents() {
      const out = outbox;
      outbox = [];
      return out;
    },
    alpha: () => Math.max(0, acc / C.fixedDt),
  };
}
