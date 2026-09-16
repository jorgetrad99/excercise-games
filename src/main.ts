// Boot: parse URL params, wire InputSources into the sim, render loop, HUD and window.__game.
import { createBot } from './core/bot';
import type { InputEvent, InputEventType } from './core/input';
import { createGameSim, type GameSim } from './core/sim';
import { simConfig } from './core/sim.config';
import { createKeyboardSource } from './input/keyboard';
import { createPoseSource, type PoseSource } from './input/pose-source';
import { createReplaySource } from './input/replay';
import { createRate } from './platform/rate';
import type { SignalFrame } from './pose/gestures';
import { gestureConfig } from './pose/gestures.config';
import { mountPosePanel } from './pose/pose-panel';
import type { PoseFixture } from './pose/recorder';
import { mountSignalHud } from './pose/signal-hud';
import type { ModelVariant } from './pose/types';
import { mountHud } from './render/hud';
import { loadModels } from './render/models';
import { createGameView, type GameView } from './render/view';

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
let sim: GameSim = newRun(Number(params.get('seed') ?? 42));
let best = 0;
/** performance.now() when the current run was first seen as over (null while playing). */
let overSince: number | null = null;
/** Pose/replay runs wait for calibration; any keyboard input also opens the gate (fallback). */
let keyboardUsed = false;
/** Results stay up at least this long, so a late dodge-jump doesn't skip them, ms. */
const RESULTS_MIN_MS = 1000;

function newRun(seed: number): GameSim {
  const next = createGameSim({ seed, reviveTokens: tokens });
  if (input === 'bot') next.setController(createBot(next.context).act);
  return next;
}

// Every source feeds one queue; the frame loop hands it to the sim. The log is for tests and the HUD.
const queue: InputEvent[] = [];
const events: InputEvent[] = [];
const signalHud = debug ? mountSignalHud(document.body, gestureConfig) : null;
let signals: SignalFrame | null = null;
function record(e: InputEvent): void {
  queue.push(e);
  events.push(e);
  if (events.length > 200) events.shift();
  signalHud?.event(e);
}

// Keyboard is always on: it's the fallback for every mode (PLAN §2.2).
const keyboard = createKeyboardSource();
keyboard.onEvent(record);
keyboard.onEvent(() => (keyboardUsed = true));
keyboard.start();

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
if (input === 'pose') {
  const source = createPoseSource({
    video: () => pose?.videoSize() ?? { width: 1280, height: 720 },
  });
  pose = mountPosePanel(document.body, {
    debug,
    record: params.get('record') === '1',
    model,
    numPoses: params.get('players') === '2' ? 2 : 1,
    cameraId: params.get('camera') ?? undefined,
    renderFps: () => renderRate.value(),
    onFrame: (f) => source.push(f),
  });
  attach(source);
  // Outside debug the camera preview is a small corner thumbnail over the game.
  document.querySelector('.pose-panel')?.classList.toggle('compact', !debug);
} else if (input.startsWith('replay:')) {
  // replay:jump.json → /fixtures/pose/jump.json; anything with a slash is used as the URL as-is.
  const name = input.slice('replay:'.length);
  fetch(name.includes('/') ? name : `/fixtures/pose/${name}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${name}: HTTP ${r.status}`))))
    .then((fx: PoseFixture) => attach(createReplaySource(fx)))
    .catch((err: unknown) => console.error('replay failed', err));
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

const hud = mountHud(document.body);
let view: GameView | null = null;
let last = performance.now();

/** "Play again" = jump (PLAN §2.1), only for jumps made after the results were up for 1 s. */
function playAgain(now: number): void {
  const state = sim.getState();
  if (state.phase !== 'over') {
    overSince = null;
    return;
  }
  best = Math.max(best, state.score);
  overSince ??= now;
  if (queue.some((e) => e.type === 'JUMP' && e.t >= overSince! + RESULTS_MIN_MS)) {
    queue.length = 0;
    sim = newRun(sim.seed);
    overSince = null;
  }
}

/** Pose/replay: a fresh run waits for calibration (PLAN §2.1: calibrate, then 3-2-1). */
function waitingForCalibration(): boolean {
  if (input === 'keyboard' || input === 'bot' || keyboardUsed) return false;
  return sim.getState().tick === 0 && signals?.calibration.state !== 'calibrated';
}

function frame(now: number): void {
  renderRate.tick();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  playAgain(now);
  const waiting = waitingForCalibration();
  if (waiting) queue.length = 0;
  else if (!manualClock) sim.step(dt, queue.splice(0));
  sim.drainEvents(); // ponytail: nothing consumes sim events yet (sound/juice come later)
  view?.render(sim.getState(), manualClock ? 0 : sim.alpha());
  hud.update(sim.getState(), { ...trackingLabel(), best, waiting });
  requestAnimationFrame(frame);
}

loadModels()
  .then((models) => {
    view = createGameView(canvas, models);
  })
  .catch((err: unknown) => console.error('renderer failed', err))
  .finally(() => requestAnimationFrame(frame));

window.__game = {
  getState: () => sim.getState(),
  getFps: () => renderRate.value(),
  getPoseStats: () => pose?.stats() ?? null,
  getSignals: () => signals,
  getEvents: () => [...events],
  inject: (e: { type: InputEventType; t?: number }) => record({ t: performance.now(), ...e }),
  setSeed: (seed: number) => {
    queue.length = 0;
    sim = newRun(seed);
  },
  advance: (seconds: number) => {
    const ticks = Math.round(seconds / simConfig.fixedDt);
    for (let i = 0; i < ticks; i++) sim.step(simConfig.fixedDt, i === 0 ? queue.splice(0) : []);
    return sim.getState().t;
  },
  getRenderStats: () => view?.stats() ?? null,
};
