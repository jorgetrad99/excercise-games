// MiniGame contract (PLAN §2.6): everything main.ts needs from a game. Shared layers (camera, pose
// worker, gesture engine, input sources, latency, debug bridge) stay game-agnostic.
// Differences from the PLAN sketch: createView takes the canvas (the view outlives runs, so it gets
// the sim per frame), and the shell also needs a HUD and a run summary (calibration gate, results).
import type { InputEvent } from '../core/input';
import type { KeyMap } from '../input/keyboard';
import type { GestureMap } from '../input/pose-source';
import type { Drawn } from '../platform/latency';
import type { SignalFrame } from '../pose/gestures';
import type { GestureConfig } from '../pose/gestures.config';
import type { PoseState } from '../pose/pose-state';
import type { FaceFeed } from '../render/big-head';
import type { HudExtras } from '../render/hud';
import type { RenderStats } from '../render/view';

/** Per-frame mirroring pose (pose/pose-state.ts, docs/ARCHITECTURE.md "Pose mirroring"). */
export type { ArmState, PoseState, Quat, Vec3 } from '../pose/pose-state';

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
  /** Events carry `player` when the sim is shared by several players (MiniGame.sharedSim). */
  step(dt: number, events: readonly InputEvent[]): void;
  /** Every game's state has at least its seed and sim time (s): the bridge's advance() returns t. */
  getState(): Readonly<{ seed: number; t: number }>;
  /** Sim events since the last call; the shell drains every frame so they never pile up. */
  drainEvents(): readonly unknown[];
}

export interface RunSummary {
  /** At least one tick ran (pose/replay runs are held before this until calibration). */
  started: boolean;
  /** Results are up: the shell restarts the run on a JUMP made ≥ 1 s later. */
  over: boolean;
  /** This player's score (the shell keeps each player's best). */
  score: number;
}

// Function-valued properties (not methods) on purpose: under strictFunctionTypes their parameters
// are checked contravariantly, so a MiniGame<SkateSim> does NOT silently fit a MiniGame<GameSim>.
// The registry holds games through defineGame() instead.
export interface GameView<S extends GameSim> {
  /** Draw one slot per player side by side (1 = full screen); a shared sim appears once per player,
   *  so slot i can be drawn from player i's point of view. `interpolate` false = exact tick (manual
   *  clock). `poses[i]`: player i's live body for mirroring onto their character (pose/replay input,
   *  calibrated); null = no body (keyboard, bot, not calibrated, tracking lost): animate from the sim.
   *  Returns what P1's slot drew, for judder tracking, or null when nothing moves. */
  render: (
    sims: readonly S[],
    interpolate: boolean,
    poses: readonly (PoseState | null)[],
  ) => Drawn | null;
  stats: () => RenderStats;
}

export interface GameHud<S extends GameSim> {
  update: (sim: S, extras: HudExtras) => void;
}

export interface SimOptions {
  reviveTokens: number;
  /** A bot drives P1 (?input=bot, ?autoplay=1). */
  autoplay: boolean;
  /** Players in this session (1, or 2 with ?players=2). */
  players: number;
}

export interface MiniGame<S extends GameSim = GameSim> {
  id: string;
  title: string;
  requiredSignals: readonly SignalId[];
  /** Draws players' live camera faces: the shell then crops them and passes them to createView. */
  faces?: boolean;
  gestureProfile: GestureProfile;
  /** Keyboard fallback keys; absent = Skate Run's. */
  keys?: KeyMap;
  /** Fixed tick length, s: window.__game.advance() steps whole ticks. */
  fixedDt: number;
  /** true: one sim holds every player (versus); false: one independent sim per player, same seed. */
  sharedSim: boolean;
  /** Pure and deterministic. */
  createSim: (seed: number, opts: SimOptions) => S;
  /** `faces`: players' live camera face crops (pose input only); games may ignore them. */
  createView: (canvas: HTMLCanvasElement, faces?: FaceFeed) => Promise<GameView<S>>;
  /** `player`: whose HUD this is (0-based). */
  mountHud: (root: HTMLElement, player: number) => GameHud<S>;
  summary: (sim: S, player: number) => RunSummary;
}

declare const opaque: unique symbol;
/** A sim the shell can only get from a game's createSim and hand back to that same game. */
export type OpaqueSim = GameSim & { readonly [opaque]: true };

/** A registered game with its sim type hidden. The shell can't build an OpaqueSim itself, so every
 *  sim it passes to render/hud/summary came from that game's createSim: what makes the cast sound. */
export type RegisteredGame = MiniGame<OpaqueSim>;

export function defineGame<S extends GameSim>(game: MiniGame<S>): RegisteredGame {
  return game as unknown as RegisteredGame;
}
