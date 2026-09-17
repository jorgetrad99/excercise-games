// Boxing's gesture → input mapping and keyboard fallback. Pose punches aren't gestures: the player's
// gloves reach the sim as BODY input (body-input.ts). Guard/dodge/duck are posture classifiers.
import type { KeyMap } from '../../input/keyboard';
import type { GestureMap } from '../../input/pose-source';

export const BOXING_GESTURES: GestureMap = {
  GUARD_START: 'GUARD_START',
  GUARD_END: 'GUARD_END',
  LANE_LEFT: 'DODGE_LEFT', // lean (leanX) = sway
  LANE_RIGHT: 'DODGE_RIGHT',
  SLIDE_START: 'DUCK', // headDrop = duck
  JUMP: 'JUMP', // play again from the results card (shell rule)
  RECALIBRATE: 'RECALIBRATE',
  TRACKING_LOST: 'PAUSE',
  TRACKING_RESTORED: 'RESUME',
};

// ponytail: keyboard punches are straights only; add hook/uppercut keys (an aim per key) if
// keyboard play needs to beat sways and ducks.
export const BOXING_KEYS: KeyMap = {
  down: {
    z: 'PUNCH_LEFT',
    Z: 'PUNCH_LEFT',
    x: 'PUNCH_RIGHT',
    X: 'PUNCH_RIGHT',
    ArrowUp: 'GUARD_START',
    ArrowLeft: 'DODGE_LEFT',
    ArrowRight: 'DODGE_RIGHT',
    ArrowDown: 'DUCK',
    ' ': 'JUMP',
    c: 'RECALIBRATE',
    C: 'RECALIBRATE',
  },
  up: { ArrowUp: 'GUARD_END' },
};
