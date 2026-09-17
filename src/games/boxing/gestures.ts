// Boxing's gesture → input mapping and keyboard fallback. Pose punches aren't gestures: the player's
// gloves reach the sim as BODY input (body-input.ts). Guard/duck are posture classifiers.
// No lean → DODGE_* for pose players (Jorge, B1): their head already moves with the body in BODY, so a
// lean dodges geometrically. On the B1 capture a twisted punch moved leanX 0.11–0.19 and fired
// DODGE_RIGHT on a left punch once the stance sat off-calibration.
import type { KeyMap } from '../../input/keyboard';
import type { GestureMap } from '../../input/pose-source';

export const BOXING_GESTURES: GestureMap = {
  GUARD_START: 'GUARD_START',
  GUARD_END: 'GUARD_END',
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
