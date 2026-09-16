/**
 * Game input contract (PLAN §3). Every InputSource (keyboard, pose, replay, network) produces these.
 * `t` = ms on the performance.now clock (replay "instant" mode: ms from fixture start).
 * RESUME is an addition to PLAN's list: tracking came back after a PAUSE (auto-resume, PLAN §2.2).
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
  | 'RESUME';

export interface InputEvent {
  t: number;
  type: InputEventType;
}
