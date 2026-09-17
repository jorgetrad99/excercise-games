// ?record=1&capture=<name>: capture wizard scripts (PLAN-BOXING §11.1). A new drill is a new step list.
import type { CaptureStep } from './capture';

export const CAPTURE_SCRIPTS: Record<string, readonly CaptureStep[]> = {
  // B1: does DODGE_LEFT fire on natural right straights (step 5) and not on square ones (step 4)?
  b1: [
    { id: 'left-hand-overhead', prompt: 'Left hand overhead', durationS: 3 },
    { id: 'still', prompt: 'Stand still', durationS: 3 },
    { id: 'guard', prompt: 'Guard up', durationS: 2 },
    { id: 'square-right-x3', prompt: '3 square right straights', durationS: 8 },
    { id: 'natural-right-x3', prompt: '3 natural right straights', durationS: 8 },
    { id: 'left-x1', prompt: '1 left straight', durationS: 8 },
  ],
  // Automated checks only (tests/e2e/capture.smoke.spec.ts).
  smoke: [
    { id: 'a', prompt: 'Smoke step A', durationS: 1 },
    { id: 'b', prompt: 'Smoke step B', durationS: 1 },
  ],
};
