// Boot: parse URL params, pick a MiniGame (?game=<id>, else the menu), wire InputSources into one run
// per player (?players=2: split screen, PLAN §2.5 local), render loop, HUDs and window.__game.
// Game-specific rules sit behind the MiniGame contract (games/).
import type { InputEvent } from './core/input';
import type { SimState } from './core/types';
import { skateRun } from './games/skate-run';
import type { GameHud, GameSim, GameView, MiniGame } from './games/types';
import { createKeyboardSource } from './input/keyboard';
import { createPosePlayers, type PosePlayers } from './input/pose-players';
import { createReplaySource } from './input/replay';
import { createLatencyTracker } from './platform/latency';
import { mountLatencyOverlay } from './platform/latency-overlay';
import { mountMenu } from './platform/menu';
import { createRate } from './platform/rate';
import type { SignalFrame } from './pose/gestures';
import { mountPosePanel } from './pose/pose-panel';
import type { PoseFixture } from './pose/recorder';
import { mountSignalHud } from './pose/signal-hud';
import type { FrameTiming, ModelVariant } from './pose/types';

/** Registered MiniGames, in menu order. */
const GAMES: readonly MiniGame[] = [skateRun];

const params = new URLSearchParams(location.search);
const input = params.get('input') ?? 'pose';
const debug = params.has('debug');
/** ?players=2: two runs sharing one seed, one camera, split screen. */
const playerCount: 1 | 2 = params.get('players') === '2' ? 2 : 1;
/** ?clock=manual: the sim only advances through window.__game.advance() (screenshot tests). */
const manualClock = params.get('clock') === 'manual';
/** Revive tokens per run until the profile store exists (M5). */
const tokens = Math.max(0, Number(params.get('tokens') ?? 1) || 0);
const model: ModelVariant =
  (['lite', 'full', 'heavy'] as const).find((m) => m === params.get('model')) ?? 'full';

/** One player's run. Runs are independent: own sim (same seed), inputs, results and best. */
interface Player {
  sim: GameSim;
  /** Events waiting for this player's next sim step. */
  queue: InputEvent[];
  signals: SignalFrame | null;
  hud: GameHud<GameSim>;
  /** performance.now() when the current run was first seen as over (null while playing). */
  overSince: number | null;
  best: number;
}

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const renderRate = createRate();
/** The launched game; null while the menu is up (and `players` is empty). */
let game: MiniGame | null = null;
let players: Player[] = [];
let view: GameView<GameSim> | null = null;
/** Pose/replay runs wait for calibration; any keyboard input also opens the gate (fallback). */
let keyboardUsed = false;
/** Results stay up at least this long, so a late dodge-jump doesn't skip them, ms. */
const RESULTS_MIN_MS = 1000;

function newRun(g: MiniGame, seed: number): GameSim {
  // ?autoplay=1 lets the bot drive while another input (e.g. the camera) is live: latency tooling.
  const autoplay = input === 'bot' || params.has('autoplay');
  return g.createSim(seed, { reviveTokens: tokens, autoplay });
}

// Sources feed each player's queue; the frame loop hands it to that sim. The log is for tests and the HUD.
const events: InputEvent[] = [];
let signalHud: ReturnType<typeof mountSignalHud> | null = null;
const latency = createLatencyTracker();
let latencyOverlay: ReturnType<typeof mountLatencyOverlay> | null = null;
/** Set while a pose frame is inside the gesture engine, so its events inherit the frame's timing. */
let pushing: FrameTiming | null = null;
function record(e: InputEvent, player = 0): void {
  const p = players[player];
  if (!p) return; // menu still up, or no such player
  if (player === 0) latency.event(e, pushing, performance.now()); // latency/judder track P1 only
  p.queue.push(e);
  events.push(e);
  if (events.length > 200) events.shift();
  if (player === 0) signalHud?.event(e);
}

// Keyboard is always on once a game launched: the fallback for every mode (PLAN §2.2); drives P1.
const keyboard = createKeyboardSource();
keyboard.onEvent((e) => record(e));
keyboard.onEvent(() => (keyboardUsed = true));

function attach(source: PosePlayers): void {
  source.onEvent((e) => record(e, e.player));
  source.onSignals((s) => {
    const p = players[s.player];
    if (p) p.signals = s;
    if (s.player === 0) signalHud?.signals(s);
  });
  keyboard.onEvent((e) => e.type === 'RECALIBRATE' && source.recalibrate(e.t));
  source.start();
}

let pose: ReturnType<typeof mountPosePanel> | null = null;

function startInput({ gestureProfile: { toInput, config } }: MiniGame): void {
  keyboard.start();
  if (input === 'pose') {
    const source = createPosePlayers({
      players: playerCount,
      video: () => pose?.videoSize() ?? { width: 1280, height: 720 },
      toInput,
      config,
    });
    pose = mountPosePanel(document.body, {
      debug,
      record: params.get('record') === '1',
      model,
      numPoses: playerCount,
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
    const opts = { toInput, config, players: playerCount };
    fetch(name.includes('/') ? name : `/fixtures/pose/${name}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${name}: HTTP ${r.status}`))))
      .then((fx: PoseFixture) => attach(createReplaySource(fx, opts)))
      .catch((err: unknown) => console.error('replay failed', err));
  }
}

function trackingLabel({ signals }: Player): { tracking: string; trackingOk: boolean } {
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
function playAgain(g: MiniGame, p: Player, now: number): void {
  const run = g.summary(p.sim);
  if (!run.over) {
    p.overSince = null;
    return;
  }
  p.best = Math.max(p.best, run.score);
  const since = (p.overSince ??= now);
  if (p.queue.some((e) => e.type === 'JUMP' && e.t >= since + RESULTS_MIN_MS)) {
    p.queue.length = 0;
    p.sim = newRun(g, p.sim.seed);
    p.overSince = null;
  }
}

/** Pose/replay: a fresh run waits until every player calibrated (PLAN §2.1; a fair 2-player start).
 *  Decided per run, so one player's play-again or recalibration never freezes a run in progress. */
function waitingForCalibration(g: MiniGame, p: Player): boolean {
  if (input === 'keyboard' || input === 'bot' || keyboardUsed) return false;
  if (g.summary(p.sim).started) return false;
  return players.some((q) => q.signals?.calibration.state !== 'calibrated');
}

function frame(now: number): void {
  const g = game!; // only scheduled by launch()
  renderRate.tick();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  for (const p of players) playAgain(g, p, now);
  const waiting = players.map((p) => waitingForCalibration(g, p));
  const applied = players.map((p, i) => (waiting[i] || manualClock ? [] : p.queue.splice(0)));
  players.forEach((p, i) => waiting[i] && (p.queue.length = 0));
  latency.frameStart(now, performance.now(), applied.flat());
  players.forEach((p, i) => {
    if (!waiting[i] && !manualClock) p.sim.step(dt, applied[i]!);
    p.sim.drainEvents(); // ponytail: nothing consumes sim events yet (sound/juice come later)
  });
  const drawn =
    view?.render(
      players.map((p) => p.sim),
      !manualClock,
    ) ?? null;
  latency.rendered(performance.now(), drawn);
  if (applied.some((a) => a.length > 0)) latencyOverlay?.onEventRendered(now);
  latencyOverlay?.frame(now);
  players.forEach((p, i) =>
    p.hud.update(p.sim, { ...trackingLabel(p), best: p.best, waiting: waiting[i]! }),
  );
  requestAnimationFrame(frame);
}

const NO_HUD: GameHud<GameSim> = { update: () => {} };

/** 1 player: the HUD covers the page. 2 players: one half-width box per player, split by a line. */
function hudRoot(player: number): HTMLElement {
  if (playerCount === 1) return document.body;
  const box = document.createElement('div');
  box.className = `player-hud p${player + 1}`;
  Object.assign(box.style, {
    position: 'fixed',
    top: '0',
    bottom: '0',
    left: `${player * 50}%`,
    width: '50%',
    pointerEvents: 'none',
    borderLeft: player > 0 ? '3px solid #0009' : '',
  });
  document.body.append(box);
  return box;
}

function launch(g: MiniGame): void {
  game = g;
  const seed = Number(params.get('seed') ?? 42);
  if (debug) signalHud = mountSignalHud(document.body, g.gestureProfile.config);
  if (params.has('latency')) latencyOverlay = mountLatencyOverlay(document.body, latency.summary);
  players = Array.from({ length: playerCount }, () => ({
    sim: newRun(g, seed),
    queue: [],
    signals: null,
    hud: NO_HUD,
    overSince: null,
    best: 0,
  }));
  startInput(g);
  // HUDs after the pose panel: same DOM (stacking) order as before split screen.
  players.forEach((p, i) => (p.hud = g.mountHud(hudRoot(i))));
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

function player(index: number): Player {
  launched();
  const p = players[index];
  if (!p) throw new Error(`no player ${index}: this run has ${players.length}`);
  return p;
}

window.__game = {
  getActiveGame: () => game?.id ?? null,
  getPlayerCount: () => players.length,
  // ponytail: typed as Skate Run's state while it's the only game; widen when game #2 lands.
  getState: (index = 0) => player(index).sim.getState() as SimState,
  getFps: () => renderRate.value(),
  getPoseStats: () => pose?.stats() ?? null,
  getSignals: (index = 0) => players[index]?.signals ?? null,
  getEvents: () => [...events],
  inject: ({ player: index = 0, ...e }) => record({ t: performance.now(), ...e }, index),
  setSeed: (seed: number) => {
    const g = launched();
    for (const p of players) {
      p.queue.length = 0;
      p.sim = newRun(g, seed);
    }
  },
  advance: (seconds: number) => {
    const { fixedDt } = launched();
    const ticks = Math.round(seconds / fixedDt);
    for (const p of players) {
      for (let i = 0; i < ticks; i++) p.sim.step(fixedDt, i === 0 ? p.queue.splice(0) : []);
    }
    return (player(0).sim.getState() as SimState).t; // ponytail: same Skate Run typing as getState
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
