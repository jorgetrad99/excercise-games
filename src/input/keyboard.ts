// Keyboard InputSource (PLAN §2.2): the agent's primary way to play-test, and the player's fallback.
import type { InputEvent, InputEventType } from '../core/input';
import { createListeners, type InputSource } from './source';

const KEYDOWN: Record<string, InputEventType> = {
  ArrowLeft: 'LANE_LEFT',
  ArrowRight: 'LANE_RIGHT',
  ' ': 'JUMP',
  ArrowDown: 'SLIDE_START',
  ArrowUp: 'GRAB',
  c: 'RECALIBRATE',
  C: 'RECALIBRATE',
  Enter: 'REVIVE',
};

export function createKeyboardSource(
  target: EventTarget = window,
  now: () => number = () => performance.now(),
): InputSource {
  const listeners = createListeners<InputEvent>();
  let sliding = false;
  const onDown = (e: Event): void => {
    const key = e as KeyboardEvent;
    const type = KEYDOWN[key.key];
    if (!type) return;
    key.preventDefault(); // arrows/space would scroll the page
    if (key.repeat) return;
    if (type === 'SLIDE_START') sliding = true;
    listeners.emit({ t: now(), type });
  };
  const onUp = (e: Event): void => {
    if ((e as KeyboardEvent).key !== 'ArrowDown') return;
    sliding = false;
    listeners.emit({ t: now(), type: 'SLIDE_END' });
  };
  let running = false;
  return {
    start() {
      if (running) return;
      running = true;
      target.addEventListener('keydown', onDown);
      target.addEventListener('keyup', onUp);
    },
    stop() {
      running = false;
      if (sliding) onUp(Object.assign(new Event('keyup'), { key: 'ArrowDown' }));
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
    },
    onEvent: listeners.add,
  };
}
