import type { InputEvent } from '../core/input';

export interface InputSource {
  start(): void;
  stop(): void;
  /** Returns an unsubscribe function. */
  onEvent(cb: (e: InputEvent) => void): () => void;
}

export function createListeners<T>() {
  const set = new Set<(value: T) => void>();
  return {
    add(cb: (value: T) => void): () => void {
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },
    emit(value: T): void {
      for (const cb of set) cb(value);
    },
  };
}
