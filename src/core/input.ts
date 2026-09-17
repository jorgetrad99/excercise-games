/**
 * Game input contract (PLAN §3). Every InputSource (keyboard, pose, replay, network) produces these.
 * `t` = ms on the performance.now clock (replay "instant" mode: ms from fixture start).
 * RESUME is an addition to PLAN's list: tracking came back after a PAUSE (auto-resume, PLAN §2.2).
 * Each game reads the types it knows and ignores the rest (Skate Run: lanes…; Boxing: punches…).
 */
export type InputEventType =
  | 'LANE_LEFT'
  | 'LANE_RIGHT'
  | 'JUMP'
  | 'SLIDE_START'
  | 'SLIDE_END'
  | 'GRAB'
  | 'REVIVE'
  | 'RECALIBRATE'
  | 'PAUSE'
  | 'RESUME'
  | 'PUNCH_LEFT'
  | 'PUNCH_RIGHT'
  | 'GUARD_START'
  | 'GUARD_END'
  | 'DODGE_LEFT'
  | 'DODGE_RIGHT'
  | 'DUCK'
  | 'BODY';

type P3 = [number, number, number];

/** Unit direction of a punch's motion in the puncher's frame: +x = puncher's right, +y = up.
 *  (0, 0) = straight at the opponent. */
export interface Aim {
  x: number;
  y: number;
}

export interface InputEvent {
  t: number;
  type: InputEventType;
  /** Punches only; absent = straight. */
  aim?: Aim;
  /** BODY only: the player's body this pose frame, in the game's character frame (Boxing: boxer-local m). */
  body?: { head: P3; gloves: [P3, P3] };
  /** Which player produced it (shared-sim games); absent = P1. */
  player?: number;
}
