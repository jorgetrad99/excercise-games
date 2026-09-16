// Boot: parse URL params, pick a MiniGame (?game=<id>, else the menu), wire InputSources into its sim,
// render loop, HUD and window.__game. Game-specific rules sit behind the MiniGame contract (games/).
import type { InputEvent, InputEventType } from './core/input';
import type { SimState } from './core/types';
import { skateRun } from './games/skate-run';
import type { GameHud, GameSim, GameView, MiniGame } from './games/types';
import { createKeyboardSource } from './input/keyboard';
import { createPoseSource, type PoseSource } from './input/pose-source';
import { createReplaySource } from './input/replay';
import { createLatencyTracker } from './platform/latency';
import { mountLatencyOverlay } from './platform/latency-overlay';
import { mountMenu } from './platform/menu';
import { createRate } from './platform/rate';
import type { SignalFrame } from './pose/gestures';
import { mountPosePanel } from './pose/pose-panel';
import type { PoseFixture } from './pose/recorder';
import { mountSignalHud } from './pose/signal-hud';
import type { ModelVariant } from './pose/types';
import type { FrameTiming } from './pose/types';

/** Registered MiniGames, in menu order. */
const GAMES: readonly MiniGame[] = [skateRun];

const params = new URLSearchParams(location.search);
const input = params.get('input') ?? 'pose';
const debug = params.has('debug');
/** ?clock=manual: the sim only advances through window.__game.advance() (screenshot tests). */
const manualClock = params.get('clock') === 'manual';
/** Revive tokens per run until the profile store exists (M5). */
const tokens = Math.max(0, Number(params.get('tokens') ?? 1) || 0);
const model: ModelVariant =
  (['lite', 'full', 'heavy'] as const).find((m) => m === params.get('model')) ?? 'full';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const renderRate = createRate();
/** The launched game; null while the menu is up. The run state below is only read after launch. */
let game: MiniGame | null = null;
let sim: GameSim;
let hud: GameHud<GameSim>;
let view: GameView<GameSim> | null = null;
let best = 0;
/** performance.now() when the current run was first seen as over (null while playing). */
let overSince: number | null = null;
/** Pose/replay runs wait for calibration; any keyboard input also opens the gate (fallback). */
let keyboardUsed = false;
/** Results stay up at least this long, so a late dodge-jump doesn't skip them, ms. */
const RESULTS_MIN_MS = 1000;

function newRun(g: MiniGame, seed: number): GameSim {
  // ?autoplay=1 lets the bot drive while another input (e.g. the camera) is live: latency tooling.
  const autoplay = input === 'bot' || params.has('autoplay');
  return g.createSim(seed, { reviveTokens: tokens, autoplay });
}

// Every source feeds one queue; the frame loop hands it to the sim. The log is for tests and the HUD.
const queue: InputEvent[] = [];
const events: InputEvent[] = [];
let signalHud: ReturnType<typeof mountSignalHud> | null = null;
let signals: SignalFrame | null = null;
const latency = createLatencyTracker();
let latencyOverlay: ReturnType<typeof mountLatencyOverlay> | null = null;
/** Set while a pose frame is inside the gesture engine, so its events inherit the frame's timing. */
let pushing: FrameTiming | null = null;
function record(e: InputEvent): void {
  latency.event(e, pushing, performance.now());
  queue.push(e);
  events.push(e);
  if (events.length > 200) events.shift();
  signalHud?.event(e);
}

// Keyboard is always on once a game launched: it's the fallback for every mode (PLAN §2.2).
const keyboard = createKeyboardSource();
keyboard.onEvent(record);
keyboard.onEvent(() => (keyboardUsed = true));

function attach(source: PoseSource): void {
  source.onEvent(record);
  source.onSignals((s) => {
    signals = s;
    signalHud?.signals(s);
  });
  keyboard.onEvent((e) => e.type === 'RECALIBRATE' && source.recalibrate(e.t));
  source.start();
}

let pose: ReturnType<typeof mountPosePanel> | null = null;

function startInput({ gestureProfile: { toInput, config } }: MiniGame): void {
  keyboard.start();
  if (input === 'pose') {
    const source = createPoseSource({
      video: () => pose?.videoSize() ?? { width: 1280, height: 720 },
      toInput,
      config,
    });
    pose = mountPosePanel(document.body, {
      debug,
      record: params.get('record') === '1',
      model,
      numPoses: params.get('players') === '2' ? 2 : 1,
      cameraId: params.get('camera') ?? undefined,
      renderFps: () => renderRate.value(),
      onFrame: (f) => {
        pushing = f.timing ?? null;
        const t0 = performance.now();
        source.push(f);
        latency.poseFrame(f.timing, performance.now() - t0);
        pushing = null;
      },
    });
    attach(source);
    // Outside debug the camera preview is a small corner thumbnail over the game.
    document.querySelector('.pose-panel')?.classList.toggle('compact', !debug);
  } else if (input.startsWith('replay:')) {
    // replay:jump.json → /fixtures/pose/jump.json; anything with a slash is used as the URL as-is.
    const name = input.slice('replay:'.length);
    fetch(name.includes('/') ? name : `/fixtures/pose/${name}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${name}: HTTP ${r.status}`))))
      .then((fx: PoseFixture) => attach(createReplaySource(fx, { toInput, config })))
      .catch((err: unknown) => console.error('replay failed', err));
  }
}

function trackingLabel(): { tracking: string; trackingOk: boolean } {
  if (input === 'keyboard' || input === 'bot') return { tracking: `⌨ ${input}`, trackingOk: true };
  if (!signals) return { tracking: '📷 waiting for camera', trackingOk: false };
  const c = signals.calibration;
  if (signals.tracking === 'lost')
    return { tracking: '📷 step back into frame', trackingOk: false };
  if (c.state !== 'calibrated') {
    const pct = c.state === 'calibrating' ? ` ${Math.round(c.progress * 100)}%` : '';
    return { tracking: `📷 calibrating${pct}: stand still`, trackingOk: false };
  }
  return { tracking: '📷 tracking', trackingOk: true };
}

let last = performance.now();

/** "Play again" = jump (PLAN §2.1), only for jumps made after the results were up for 1 s. */
function playAgain(g: MiniGame, now: number): void {
  const run = g.summary(sim);
  if (!run.over) {
    overSince = null;
    return;
  }
  best = Math.max(best, run.score);
  overSince ??= now;
  if (queue.some((e) => e.type === 'JUMP' && e.t >= overSince! + RESULTS_MIN_MS)) {
    queue.length = 0;
    sim = newRun(g, sim.seed);
    overSince = null;
  }
}

/** Pose/replay: a fresh run waits for calibration (PLAN §2.1: calibrate, then 3-2-1). */
function waitingForCalibration(g: MiniGame): boolean {
  if (input === 'keyboard' || input === 'bot' || keyboardUsed) return false;
  return !g.summary(sim).started && signals?.calibration.state !== 'calibrated';
}

function frame(now: number): void {
  const g = game!; // only scheduled by launch()
  renderRate.tick();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  playAgain(g, now);
  const waiting = waitingForCalibration(g);
  const applied = waiting || manualClock ? [] : queue.splice(0);
  if (waiting) queue.length = 0;
  latency.frameStart(now, performance.now(), applied);
  if (!waiting && !manualClock) sim.step(dt, applied);
  sim.drainEvents(); // ponytail: nothing consumes sim events yet (sound/juice come later)
  latency.rendered(performance.now(), view?.render(sim, !manualClock) ?? null);
  if (applied.length > 0) latencyOverlay?.onEventRendered(now);
  latencyOverlay?.frame(now);
  hud.update(sim, { ...trackingLabel(), best, waiting });
  requestAnimationFrame(frame);
}

function launch(g: MiniGame): void {
  game = g;
  queue.length = 0; // nothing injected while the menu was up leaks into the first tick
  sim = newRun(g, Number(params.get('seed') ?? 42));
  if (debug) signalHud = mountSignalHud(document.body, g.gestureProfile.config);
  if (params.has('latency')) latencyOverlay = mountLatencyOverlay(document.body, latency.summary);
  startInput(g);
  hud = g.mountHud(document.body);
  g.createView(canvas)
    .then((v) => (view = v))
    .catch((err: unknown) => console.error('renderer failed', err))
    .finally(() => requestAnimationFrame(frame));
}

/** Bridge calls that need a run fail loudly (not with a TypeError) while the menu is up. */
function launched(): MiniGame {
  if (!game) throw new Error('no game launched: open with ?game=<id> or pick one in the menu');
  return game;
}

window.__game = {
  getActiveGame: () => game?.id ?? null,
  // ponytail: typed as Skate Run's state while it's the only game; widen when game #2 lands.
  getState: () => (launched(), sim.getState() as SimState),
  getFps: () => renderRate.value(),
  getPoseStats: () => pose?.stats() ?? null,
  getSignals: () => signals,
  getEvents: () => [...events],
  inject: (e: { type: InputEventType; t?: number }) => record({ t: performance.now(), ...e }),
  setSeed: (seed: number) => {
    queue.length = 0;
    sim = newRun(launched(), seed);
  },
  advance: (seconds: number) => {
    const { fixedDt } = launched();
    const ticks = Math.round(seconds / fixedDt);
    for (let i = 0; i < ticks; i++) sim.step(fixedDt, i === 0 ? queue.splice(0) : []);
    return (sim.getState() as SimState).t; // ponytail: same Skate Run typing as getState
  },
  getRenderStats: () => view?.stats() ?? null,
  getLatency: () => latency.summary(),
};

const requested = params.get('game');
const chosen = GAMES.find((g) => g.id === requested);
if (chosen) launch(chosen);
else {
  if (requested) console.warn(`unknown ?game=${requested}; showing the menu`);
  mountMenu(document.body, GAMES, launch);
}
