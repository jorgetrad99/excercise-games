// MiniGame contract (PLAN §2.6): everything main.ts needs from a game. Shared layers (camera, pose
// worker, gesture engine, input sources, latency, debug bridge) stay game-agnostic.
// Differences from the PLAN sketch: createView takes the canvas (the view outlives runs, so it gets
// the sim per frame), and the shell also needs a HUD and a run summary (calibration gate, results).
import type { InputEvent } from '../core/input';
import type { GestureMap } from '../input/pose-source';
import type { Drawn } from '../platform/latency';
import type { SignalFrame } from '../pose/gestures';
import type { GestureConfig } from '../pose/gestures.config';
import type { HudExtras } from '../render/hud';
import type { RenderStats } from '../render/view';

/** The numeric SignalFrame channels a game can depend on. */
export type SignalId = {
  [K in keyof SignalFrame]-?: SignalFrame[K] extends number ? (K extends 't' ? never : K) : never;
}[keyof SignalFrame];

export interface GestureProfile {
  /** Gesture engine events → this game's InputEvents; unmapped gestures are dropped. */
  toInput: GestureMap;
  config: GestureConfig;
}

/** What the shell calls on any sim. Games return their own richer sim type. */
export interface GameSim {
  readonly seed: number;
  step(dt: number, events: readonly InputEvent[]): void;
  getState(): Readonly<object>;
  /** Sim events since the last call; the shell drains every frame so they never pile up. */
  drainEvents(): readonly unknown[];
}

export interface RunSummary {
  /** At least one tick ran (pose/replay runs are held before this until calibration). */
  started: boolean;
  /** Results are up: the shell restarts the run on a JUMP made ≥ 1 s later. */
  over: boolean;
  score: number;
}

// Methods (not function-valued properties) on purpose: their parameters are bivariant, so a
// MiniGame<SkateSim> fits a MiniGame[] registry without casts.
export interface GameView<S extends GameSim> {
  /** Draw every player's run side by side (1 = full screen); `interpolate` false = exact tick
   *  (manual clock). Returns what P1's slot drew, for judder tracking, or null when nothing moves. */
  render(sims: readonly S[], interpolate: boolean): Drawn | null;
  stats(): RenderStats;
}

export interface GameHud<S extends GameSim> {
  update(sim: S, extras: HudExtras): void;
}

export interface MiniGame<S extends GameSim = GameSim> {
  id: string;
  title: string;
  requiredSignals: readonly SignalId[];
  gestureProfile: GestureProfile;
  /** Fixed tick length, s: window.__game.advance() steps whole ticks. */
  fixedDt: number;
  /** Pure and deterministic. `autoplay`: a bot drives the run (?input=bot, ?autoplay=1). */
  createSim(seed: number, opts: { reviveTokens: number; autoplay: boolean }): S;
  createView(canvas: HTMLCanvasElement): Promise<GameView<S>>;
  mountHud(root: HTMLElement): GameHud<S>;
  summary(sim: S): RunSummary;
}
