// Keyboard InputSource (PLAN §2.2): the agent's primary way to play-test, and the player's fallback.
import type { InputEvent, InputEventType } from '../core/input';
import { createListeners, type InputSource } from './source';

/** Key (KeyboardEvent.key) → event on press; `up` keys also fire on release (held actions). */
export interface KeyMap {
  down: Record<string, InputEventType>;
  up?: Record<string, InputEventType>;
}

/** Skate Run's keys, the default. */
export const SKATE_KEYS: KeyMap = {
  down: {
    ArrowLeft: 'LANE_LEFT',
    ArrowRight: 'LANE_RIGHT',
    ' ': 'JUMP',
    ArrowDown: 'SLIDE_START',
    ArrowUp: 'GRAB',
    c: 'RECALIBRATE',
    C: 'RECALIBRATE',
    Enter: 'REVIVE',
  },
  up: { ArrowDown: 'SLIDE_END' },
};

export function createKeyboardSource(
  target: EventTarget = window,
  /** Event time; defaults to the OS input timestamp so latency can be measured from the key press. */
  now: (e: Event) => number = (e) => e.timeStamp || performance.now(),
  keys: KeyMap = SKATE_KEYS,
): InputSource {
  const listeners = createListeners<InputEvent>();
  /** Held keys that have a release event, so stop() never leaves an action stuck on. */
  const held = new Set<string>();
  const onDown = (e: Event): void => {
    const key = e as KeyboardEvent;
    const type = keys.down[key.key];
    if (!type) return;
    key.preventDefault(); // arrows/space would scroll the page
    if (key.repeat) return;
    if (keys.up?.[key.key]) held.add(key.key);
    listeners.emit({ t: now(key), type });
  };
  const onUp = (e: Event): void => {
    const { key } = e as KeyboardEvent;
    const type = keys.up?.[key];
    if (!type) return;
    held.delete(key);
    listeners.emit({ t: now(e), type });
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
      for (const key of [...held]) onUp(Object.assign(new Event('keyup'), { key }));
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
    },
    onEvent: listeners.add,
  };
}
