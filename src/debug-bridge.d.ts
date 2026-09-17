// Debug bridge contract (PLAN §3).
interface Window {
  __game: {
    /** MiniGame id launched via ?game=<id> or the menu; null while the menu is up. */
    getActiveGame(): string | null;
    /** Runs in this session: 1, or 2 with ?players=2; 0 while the menu is up. */
    getPlayerCount(): number;
    /**
     * Full sim snapshot of player `player` (default 0 = P1; live object: copy it if you keep it).
     * The shape is the active game's, so name it: `getState<SimState>()` (Skate Run) or
     * `getState<BoxingState>()` (Boxing; one state shared by both players). Unchecked at runtime.
     */
    getState<S extends { seed: number; t: number } = { seed: number; t: number }>(
      player?: number,
    ): S;
    getFps(): number;
    /** null when not in ?input=pose or before the camera opened. */
    getPoseStats(): import('./pose/pipeline').PoseStats | null;
    /** Latest gesture signals of `player` (default P1; pose/replay input), null before the first frame. */
    getSignals(player?: number): import('./pose/gestures').SignalFrame | null;
    /** Last 200 InputEvents from every source and player, oldest first (pose events carry `player`). */
    getEvents(): import('./core/input').InputEvent[];
    /** Fire an event as if an InputSource produced it, for `player` (default P1). */
    inject(e: {
      type: import('./core/input').InputEventType;
      t?: number;
      player?: number;
      aim?: import('./core/input').Aim;
    }): void;
    /** Restart every player's run with a new seed. */
    setSeed(seed: number): void;
    /** Step every sim synchronously by `seconds` (use with ?clock=manual); returns P1's sim time. */
    advance(seconds: number): number;
    /** Renderer counters from the last frame; null until the models loaded. */
    getRenderStats(): import('./render/view').RenderStats | null;
    /** Per-stage input-to-screen latency, frame pacing and judder (see platform/latency.ts). */
    getLatency(): import('./platform/latency').LatencySummary;
    /** Feed a PoseFrame as if the camera produced it: menu hand cursors, or the game's pose input. */
    injectPose(frame: import('./pose/types').PoseFrame): void;
  };
}
