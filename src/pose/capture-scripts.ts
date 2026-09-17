// ?record=1&capture=<name>: capture wizard scripts (PLAN-BOXING §11.1). A new drill is a new step list.
// Prompts and howTo are for someone who has never boxed; ids keep the PLAN's names. Demos: capture-demo.ts.
import type { CaptureStep } from './capture';

export const CAPTURE_SCRIPTS: Record<string, readonly CaptureStep[]> = {
  // B1: does DODGE_LEFT fire on natural right straights (step 5) and not on square ones (step 4)?
  b1: [
    {
      id: 'left-hand-overhead',
      prompt: 'Left arm up',
      howTo: 'Raise your LEFT arm straight up over your head. Hold it there.',
      durationS: 3,
    },
    {
      id: 'still',
      prompt: 'Stand still',
      howTo: 'Arms relaxed at your sides. Face the screen. Don’t move.',
      durationS: 3,
    },
    {
      id: 'guard',
      prompt: 'Fists up',
      howTo: 'Both fists up next to your chin, elbows in against your ribs. Hold.',
      durationS: 2,
    },
    {
      id: 'square-right-x3',
      prompt: '3 right punches — NO twist',
      howTo:
        'From fists up: punch your RIGHT fist straight at the screen, then back to your chin. Chest and shoulders stay facing the screen.',
      durationS: 8,
    },
    {
      id: 'natural-right-x3',
      prompt: '3 right punches — WITH twist',
      howTo:
        'Same RIGHT punch, but turn your body into it: right shoulder swings forward, like throwing a ball. Then face the screen again.',
      durationS: 8,
    },
    {
      id: 'left-x1',
      prompt: '1 left punch',
      howTo:
        'From fists up: punch your LEFT fist straight at the screen once, then back to your chin.',
      durationS: 8,
    },
  ],
  // Automated checks only (tests/e2e/capture.smoke.spec.ts).
  smoke: [
    { id: 'a', prompt: 'Smoke step A', durationS: 1 },
    { id: 'b', prompt: 'Smoke step B', durationS: 1 },
  ],
};
