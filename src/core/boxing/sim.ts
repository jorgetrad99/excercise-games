// Boxing sim (Piece 4): Wii Sports Boxing rules for two boxers in one shared, deterministic state.
// Events carry `player` (0/1 = boxer) and punches an `aim`; the sim reads the aim vector directly
// (no punch-type classifier). Same determinism contract as Skate Run: events apply at the next tick.
import type { Aim, InputEvent } from '../input';
import { mulberry32 } from '../prng';
import { boxingConfig as C } from './boxing.config';
import type { Boxer, BoxerId, BoxingEventType, BoxingState, Fist } from './types';

export type BoxingInput = Pick<InputEvent, 'type' | 'aim' | 'player'>;

/** Per-tick input source for bot-driven boxers; returns events with `player` set. */
export type BoxingController = (s: Readonly<BoxingState>) => readonly BoxingInput[];

export interface BoxingSimOptions {
  seed: number;
  /** Tests: start in the fight. */
  skipIntro?: boolean;
}

export interface BoxingSim {
  readonly seed: number;
  step(dt: number, events: readonly InputEvent[]): void;
  getState(): Readonly<BoxingState>;
  drainEvents(): BoxingState['events'];
}

/** A deterministic uniform [0,1) from (seed, tick, salt): stateless, so clones stay in sync. */
export function rngAt(seed: number, tick: number, salt: number): number {
  return mulberry32(seed ^ Math.imul(tick + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b))();
}

const readyFist = (): Fist => ({ phase: 'ready', t: 0, aim: { x: 0, y: 0 } });

function newBoxer(): Boxer {
  const max = C.stamina.segments;
  return {
    stamina: max,
    max,
    dizzy: false,
    guard: false,
    dodge: 'none',
    dodgeT: 0,
    dodgeCd: 0,
    counterT: 0,
    idleT: 0,
    fists: [readyFist(), readyFist()],
    knockdowns: 0,
    landed: 0,
    hitT: -1e9,
    blockT: -1e9,
  };
}

export function initBoxing(opts: BoxingSimOptions): BoxingState {
  return {
    seed: opts.seed,
    t: 0,
    tick: 0,
    round: 1,
    phase: opts.skipIntro ? 'fight' : 'intro',
    phaseT: opts.skipIntro ? 0 : C.phases.introS,
    pausedFrom: null,
    pausedBy: [false, false],
    roundT: C.phases.roundS,
    boxers: [newBoxer(), newBoxer()],
    down: null,
    winner: null,
    result: null,
    events: [],
  };
}

const emit = (s: BoxingState, type: BoxingEventType, boxer?: BoxerId): void => {
  s.events.push(boxer === undefined ? { t: s.t, type } : { t: s.t, type, boxer });
};

/** Float slack for timers counted down in fixed ticks (60 × 1/60 ≠ 1 exactly). */
const EPS = 1e-9;

const other = (b: BoxerId): BoxerId => (b === 0 ? 1 : 0);
const fistOut = (b: Boxer): boolean => b.fists.some((f) => f.phase === 'out');

/** Moves reset after a knockdown and between rounds. `guard` is left alone: it mirrors what the
 *  player is physically holding (GUARD_START/END), and only counts while not dizzy. */
function settle(b: Boxer): void {
  Object.assign(b, { dodge: 'none', dodgeT: 0, dodgeCd: 0, counterT: 0, idleT: 0 });
  b.fists = [readyFist(), readyFist()];
}

/** One fixed tick. Events apply first, in order. */
export function tickBoxing(s: BoxingState, events: readonly BoxingInput[]): void {
  s.events = [];
  for (const e of events) applyEvent(s, e);
  const dt = C.fixedDt;
  s.t += dt;
  s.tick++;
  switch (s.phase) {
    case 'intro':
    case 'break':
      s.phaseT -= dt;
      if (s.phaseT <= EPS) Object.assign(s, { phase: 'fight', phaseT: 0 });
      break;
    case 'down':
      s.phaseT += dt;
      countDown(s);
      break;
    case 'fight':
      fight(s, dt);
      break;
  }
}

function applyEvent(s: BoxingState, e: BoxingInput): void {
  const who: BoxerId = e.player === 1 ? 1 : 0;
  if (e.type === 'PAUSE' || e.type === 'RESUME') return pauseOrResume(s, who, e.type === 'PAUSE');
  const b = s.boxers[who];
  // Guard is a held state: track it in every phase so a release during a count isn't lost.
  if (e.type === 'GUARD_START') b.guard = true;
  if (e.type === 'GUARD_END') b.guard = false;
  if (s.phase !== 'fight') return;
  if (e.type === 'PUNCH_LEFT' || e.type === 'PUNCH_RIGHT') punch(s, who, e.type, e.aim);
  else if (e.type === 'DODGE_LEFT') startDodge(b, 'left');
  else if (e.type === 'DODGE_RIGHT') startDodge(b, 'right');
  else if (e.type === 'DUCK') startDodge(b, 'duck');
}

/** One shared match: any player's PAUSE holds it; it resumes only once every PAUSE was answered. */
function pauseOrResume(s: BoxingState, who: BoxerId, pause: boolean): void {
  if (s.phase === 'over') return;
  s.pausedBy[who] = pause;
  if (pause && s.phase !== 'paused') {
    Object.assign(s, { pausedFrom: s.phase, phase: 'paused' });
  } else if (!pause && s.phase === 'paused' && !s.pausedBy.some(Boolean)) {
    const from = s.pausedFrom ?? 'fight';
    s.pausedFrom = null;
    if (from === 'fight') Object.assign(s, { phase: 'intro', phaseT: C.phases.resumeIntroS });
    else s.phase = from;
  }
}

function punch(s: BoxingState, who: BoxerId, type: string, aim: Aim = { x: 0, y: 0 }): void {
  const b = s.boxers[who];
  const fist = b.fists[type === 'PUNCH_LEFT' ? 0 : 1];
  // Recovery: a fist punches again only once its glove has stopped (back to ready).
  if (b.dizzy || b.dodge !== 'none' || fist.phase !== 'ready') return;
  Object.assign(fist, { phase: 'out', t: 0, aim: { x: aim.x, y: aim.y } });
  b.idleT = 0;
  emit(s, 'PUNCH', who);
}

function startDodge(b: Boxer, dodge: Boxer['dodge']): void {
  // Can't sway mid-punch: also what makes a hook's shoulder turn (a false lean) harmless.
  if (b.dodge !== 'none' || b.dodgeCd > 0 || fistOut(b)) return;
  Object.assign(b, { dodge, dodgeT: C.dodge.activeS });
}

function fight(s: BoxingState, dt: number): void {
  // Seeded coin flip for who resolves first, so same-tick punches favour neither boxer (2P
  // fairness). Tick parity isn't enough: punches thrown on the same grid land on the same parity.
  const order = rngAt(s.seed, s.tick, 99) < 0.5 ? ([0, 1] as const) : ([1, 0] as const);
  for (const who of order) {
    moveBoxer(s, who, dt);
    if (s.phase !== 'fight') return;
  }
  // Both dizzy (whiffs and blocks can empty both pies): neither can punch or recover, so the round
  // would stall until the bell. Break the clinch: both come round with one segment.
  if (s.boxers.every((b) => b.dizzy))
    for (const b of s.boxers) Object.assign(b, { dizzy: false, stamina: Math.min(1, b.max) });
  s.roundT -= dt;
  if (s.roundT <= EPS) endRound(s);
}

function moveBoxer(s: BoxingState, who: BoxerId, dt: number): void {
  const b = s.boxers[who];
  b.idleT += dt;
  b.counterT = Math.max(0, b.counterT - dt);
  if (b.dodge !== 'none') {
    b.dodgeT -= dt;
    if (b.dodgeT <= 0) Object.assign(b, { dodge: 'none', dodgeT: 0, dodgeCd: C.dodge.cooldownS });
  } else b.dodgeCd = Math.max(0, b.dodgeCd - dt);
  for (const fist of b.fists) {
    if (fist.phase === 'ready') continue;
    fist.t += dt;
    if (fist.phase === 'out' && fist.t >= C.punch.travelS - EPS) {
      Object.assign(fist, { phase: 'back', t: 0 });
      land(s, who, fist.aim);
      if (s.phase !== 'fight') return;
    } else if (fist.phase === 'back' && fist.t >= C.punch.retractS - EPS) {
      Object.assign(fist, { phase: 'ready', t: 0 });
    }
  }
  const resting = !b.dizzy && b.fists.every((f) => f.phase === 'ready');
  if (resting && b.idleT >= C.stamina.regenIdleS)
    b.stamina = Math.min(b.max, b.stamina + C.stamina.regenPerS * dt);
}

/** Does a punch moving along `aim` reach a boxer who is dodging? Only one sweeping into the dodge. */
export function catchesDodge(dodge: Boxer['dodge'], aim: Aim): boolean {
  if (dodge === 'none') return true;
  if (dodge === 'duck') return aim.y > C.aim.upperMin;
  // Facing each other, the defender's right is the attacker's left (−x in the attacker's frame).
  const side = dodge === 'right' ? 1 : -1;
  return -aim.x * side > C.aim.hookMin;
}

function drain(s: BoxingState, who: BoxerId, amount: number): void {
  const b = s.boxers[who];
  b.stamina = Math.max(0, b.stamina - amount);
  if (b.stamina === 0 && !b.dizzy) {
    b.dizzy = true;
    emit(s, 'DIZZY', who);
  }
}

/** A punch from `who` reaches the other boxer. */
function land(s: BoxingState, who: BoxerId, aim: Aim): void {
  const a = s.boxers[who];
  const d = s.boxers[other(who)];
  if (!catchesDodge(d.dodge, aim)) {
    d.counterT = C.stamina.counterWindowS;
    emit(s, 'WHIFF', who);
    return drain(s, who, C.stamina.whiff);
  }
  d.idleT = 0;
  if (d.guard && !d.dizzy && !fistOut(d) && aim.y <= C.aim.upperMin) {
    d.blockT = s.t;
    emit(s, 'BLOCK', other(who));
    return drain(s, other(who), C.stamina.blocked);
  }
  a.landed++;
  d.hitT = s.t;
  if (d.dizzy) return knockdown(s, other(who));
  const counter = a.counterT > 0;
  a.counterT = 0;
  a.stamina = Math.min(a.max, a.stamina + C.stamina.landedGain);
  emit(s, counter ? 'COUNTER' : 'HIT', other(who));
  drain(s, other(who), C.stamina.clean * (counter ? C.stamina.counterMult : 1));
}

function knockdown(s: BoxingState, who: BoxerId): void {
  const b = s.boxers[who];
  b.knockdowns++;
  emit(s, 'KNOCKDOWN', who);
  for (const x of s.boxers) settle(x);
  if (b.knockdowns >= C.knockdown.tko) return finish(s, other(who), 'TKO');
  const k = C.knockdown;
  const getUpAt =
    k.base + k.perKnockdown * (b.knockdowns - 1) + Math.floor(k.span * rngAt(s.seed, s.tick, 7));
  Object.assign(s, { phase: 'down', phaseT: 0, down: { boxer: who, getUpAt } });
}

/** Referee count: 1 per countS; up at getUpAt, out at 10. */
export const refereeCount = (s: Readonly<BoxingState>): number =>
  Math.min(10, Math.floor(s.phaseT / C.knockdown.countS + EPS));

function countDown(s: BoxingState): void {
  const down = s.down!;
  const count = refereeCount(s);
  if (down.getUpAt >= 10) {
    if (count >= 10) finish(s, other(down.boxer), 'KO');
    return;
  }
  if (count < down.getUpAt) return;
  const b = s.boxers[down.boxer];
  b.max = Math.max(C.knockdown.minMax, b.max - C.knockdown.maxLoss);
  Object.assign(b, { stamina: b.max, dizzy: false });
  Object.assign(s, { phase: 'fight', phaseT: 0, down: null });
  emit(s, 'GET_UP', down.boxer);
}

function endRound(s: BoxingState): void {
  emit(s, 'ROUND_END');
  for (const b of s.boxers) {
    settle(b);
    Object.assign(b, { stamina: b.max, dizzy: false });
  }
  if (s.round < C.phases.rounds) {
    s.round++;
    Object.assign(s, { phase: 'break', phaseT: C.phases.breakS, roundT: C.phases.roundS });
    return;
  }
  s.roundT = 0;
  const [p0, p1] = s.boxers;
  const byKd = p1.knockdowns - p0.knockdowns;
  const margin = byKd !== 0 ? byKd : p0.landed - p1.landed;
  if (margin === 0) finish(s, null, 'draw');
  else finish(s, margin > 0 ? 0 : 1, 'decision');
}

function finish(s: BoxingState, winner: BoxerId | null, result: BoxingState['result']): void {
  Object.assign(s, { phase: 'over', phaseT: 0, down: null, winner, result });
  emit(s, 'MATCH_OVER', winner ?? undefined);
}

export function createBoxingSim(
  opts: BoxingSimOptions,
  controller: BoxingController | null = null,
): BoxingSim {
  const state = initBoxing(opts);
  let acc = 0;
  let pending: BoxingInput[] = [];
  let outbox: BoxingState['events'] = [];
  return {
    seed: opts.seed,
    step(dt, events) {
      pending.push(...events);
      acc = Math.min(acc + dt, 0.25); // don't spiral after a long stall (tab in background)
      while (acc >= C.fixedDt - 1e-9) {
        acc -= C.fixedDt;
        const auto = controller ? controller(state) : [];
        tickBoxing(state, auto.length > 0 ? [...pending, ...auto] : pending);
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
  };
}
