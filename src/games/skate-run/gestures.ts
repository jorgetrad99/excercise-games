// Skate Run's gesture → input mapping (was hard-coded in input/pose-source.ts).
import type { GestureMap } from '../../input/pose-source';

export const SKATE_GESTURES: GestureMap = {
  LANE_LEFT: 'LANE_LEFT',
  LANE_RIGHT: 'LANE_RIGHT',
  JUMP: 'JUMP',
  SLIDE_START: 'SLIDE_START',
  SLIDE_END: 'SLIDE_END',
  GRAB: 'GRAB',
  REVIVE_ACCEPT: 'REVIVE',
  RECALIBRATE: 'RECALIBRATE',
  TRACKING_LOST: 'PAUSE',
  TRACKING_RESTORED: 'RESUME',
  // CALIBRATED is UI-only: visible through SignalFrame.calibration.
};
