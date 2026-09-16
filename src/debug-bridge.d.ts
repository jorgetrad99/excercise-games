// Debug bridge contract (PLAN §3).
interface Window {
  __game: {
    /** MiniGame id launched via ?game=<id> or the menu; null while the menu is up. */
    getActiveGame(): string | null;
    /** Full sim snapshot (live object: copy it if you keep it). */
    getState(): import('./core/types').SimState;
    getFps(): number;
    /** null when not in ?input=pose or before the camera opened. */
    getPoseStats(): import('./pose/pipeline').PoseStats | null;
    /** Latest gesture signals (pose/replay input), null before the first frame. */
    getSignals(): import('./pose/gestures').SignalFrame | null;
    /** Last 200 InputEvents from every source, oldest first. */
    getEvents(): import('./core/input').InputEvent[];
    /** Fire an event as if an InputSource produced it. */
    inject(e: { type: import('./core/input').InputEventType; t?: number }): void;
    /** Restart the run with a new seed. */
    setSeed(seed: number): void;
    /** Step the sim synchronously by `seconds` (use with ?clock=manual); returns sim time. */
    advance(seconds: number): number;
    /** Renderer counters from the last frame; null until the models loaded. */
    getRenderStats(): import('./render/view').RenderStats | null;
    /** Per-stage input-to-screen latency, frame pacing and judder (see platform/latency.ts). */
    getLatency(): import('./platform/latency').LatencySummary;
  };
}
