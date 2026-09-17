// Boxing sim state: one shared state for both boxers (the opponent is boxer 1: a bot in 1P).
import type { Aim } from '../input';

export type BoxerId = 0 | 1;

export interface Fist {
  /** Keyboard/bot puppet only: ready → out (travelS) → back (retractS) → ready. Collision decides hits. */
  phase: 'ready' | 'out' | 'back';
  /** Time in the current phase, s. */
  t: number;
  aim: Aim;
}

export type Dodge = 'none' | 'left' | 'right' | 'duck';

export type V3 = [number, number, number];

/** Collision points, boxer-local m (+x = the boxer's left, +y up, +z toward the opponent). */
export interface BodyPose {
  head: V3;
  gloves: [V3, V3];
}

/**
 * Where a boxer's body is. `source` 'pose': the player's own body (BODY input), extrapolated at most
 * body.extrapolateS past the newest sample; 'puppet': keyboard/bot moves (fists, guard, dodge).
 */
export interface BodyTrack {
  source: 'pose' | 'puppet';
  /** This tick's and the previous tick's points: collisions sweep between them. */
  now: BodyPose;
  prev: BodyPose;
  /** Newest pose sample, its velocity (m/s per point) and its input time (ms). */
  sample: BodyPose | null;
  vel: BodyPose;
  sampleT: number;
  /** Seconds since the newest sample was applied. */
  age: number;
}

/** Per glove, what it is touching and how its current punch went. */
export interface GloveContact {
  /** Inside some target's touching distance (a new hit needs it to leave first). */
  touching: boolean;
  /** Reached past the opponent's head this extension without touching anything: already a whiff. */
  spent: boolean;
  /** Touched something since it was last pulled back. */
  struck: boolean;
  /** How long it has been closing on the opponent faster than bot.seeSpeedMps, s (0 = not). */
  closingT: number;
}

/** A clean hit a boxer took. */
export interface HitTaken {
  t: number;
  /** 0 = the boxer's left side, 1 = right, 2 = chin (from below). */
  zone: 0 | 1 | 2;
  part: 'head' | 'body';
  /** Closing speed at contact, m/s. */
  speed: number;
}

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
  /** [left, right]. */
  fists: [Fist, Fist];
  /** Knockdowns suffered. */
  knockdowns: number;
  /** Clean hits landed (knockdown blows included). */
  landed: number;
  /** Sim time of the last clean hit / block taken (render recoil), s. */
  hitT: number;
  blockT: number;
  body: BodyTrack;
  gloves: [GloveContact, GloveContact];
  /** The latest clean hits taken, oldest first, at most 4 (render: bruises, head snap). */
  hits: HitTaken[];
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
