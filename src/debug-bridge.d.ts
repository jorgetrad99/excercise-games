// Debug bridge contract (PLAN §3). setSeed arrives with the sim (M3).
interface Window {
  __game: {
    getState(): { seed: number; frame: number };
    getFps(): number;
    /** null when not in ?input=pose or before the camera opened. */
    getPoseStats(): import('./pose/pipeline').PoseStats | null;
    /** Latest gesture signals (pose/replay input), null before the first frame. */
    getSignals(): import('./pose/gestures').SignalFrame | null;
    /** Last 200 InputEvents from every source, oldest first. */
    getEvents(): import('./core/input').InputEvent[];
    /** Fire an event as if an InputSource produced it. */
    inject(e: { type: import('./core/input').InputEventType; t?: number }): void;
  };
}
