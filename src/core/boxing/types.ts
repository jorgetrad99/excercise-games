// Boxing sim state: one shared state for both boxers (the opponent is boxer 1: a bot in 1P).
import type { Aim } from '../input';

export type BoxerId = 0 | 1;

export interface Fist {
  /** ready → out (travelling, lands at punch.travelS) → back (retracting) → ready. */
  phase: 'ready' | 'out' | 'back';
  /** Time in the current phase, s. */
  t: number;
  aim: Aim;
}

export type Dodge = 'none' | 'left' | 'right' | 'duck';

export interface Boxer {
  /** Pie segments left, 0…max. */
  stamina: number;
  /** Max stamina: segments minus knockdown losses. */
  max: number;
  /** Stamina hit 0: guard down, can't punch, can dodge; the next clean hit is a knockdown. */
  dizzy: boolean;
  /** Guard held (only protects while not dizzy and no fist is out). */
  guard: boolean;
  /** Left/right = the boxer's own left/right. */
  dodge: Dodge;
  /** Time left in the dodge, then the cooldown, s. */
  dodgeT: number;
  dodgeCd: number;
  /** Counter window left after dodging a punch, s. */
  counterT: number;
  /** Time since this boxer last punched or was hit, s (regen gate). */
  idleT: number;
  /** [left, right]. */
  fists: [Fist, Fist];
  /** Knockdowns suffered. */
  knockdowns: number;
  /** Clean hits landed (knockdown blows included). */
  landed: number;
  /** Sim time of the last clean hit / block taken (render recoil), s. */
  hitT: number;
  blockT: number;
}

export type BoxingPhase = 'intro' | 'fight' | 'down' | 'break' | 'paused' | 'over';

export type BoxingEventType =
  | 'PUNCH'
  | 'HIT'
  | 'COUNTER'
  | 'BLOCK'
  | 'WHIFF'
  | 'DIZZY'
  | 'KNOCKDOWN'
  | 'GET_UP'
  | 'ROUND_END'
  | 'MATCH_OVER';

export interface BoxingEvent {
  t: number;
  type: BoxingEventType;
  /** The boxer it happened to (PUNCH: the puncher; HIT/BLOCK/KNOCKDOWN: the one hit). */
  boxer?: BoxerId;
}

export interface BoxingState {
  seed: number;
  t: number;
  tick: number;
  /** 1-based. */
  round: number;
  phase: BoxingPhase;
  /** intro/break: time left; down: time since the knockdown, s. */
  phaseT: number;
  pausedFrom: Exclude<BoxingPhase, 'paused' | 'over'> | null;
  /** Whose PAUSE (tracking loss) holds the match: it resumes only when both are clear (2P). */
  pausedBy: [boolean, boolean];
  /** Time left in the round, s. */
  roundT: number;
  boxers: [Boxer, Boxer];
  /** Set while phase is 'down'. `getUpAt` ≥ 10 = this knockdown is a KO. */
  down: { boxer: BoxerId; getUpAt: number } | null;
  winner: BoxerId | null;
  result: 'KO' | 'TKO' | 'decision' | 'draw' | null;
  /** Sim events from the latest tick. */
  events: BoxingEvent[];
}
