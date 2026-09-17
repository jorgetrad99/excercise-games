// Boot: parse URL params, pick a MiniGame (?game=<id>, else the menu), wire InputSources into one run
// per player (?players=2: split screen, PLAN §2.5 local), render loop, HUDs and window.__game.
// Game-specific rules sit behind the MiniGame contract (games/). A game either gives each player an
// independent sim (Skate Run) or one sim they all share (Boxing: MiniGame.sharedSim).
import type { InputEvent } from './core/input';
import { GAMES } from './games/registry';
import type { GameHud, GameView, OpaqueSim, RegisteredGame } from './games/types';
import { createKeyboardSource } from './input/keyboard';
import { createPosePlayers, type PosePlayers } from './input/pose-players';
import { createReplaySource } from './input/replay';
import { createLatencyTracker } from './platform/latency';
import { mountLatencyOverlay } from './platform/latency-overlay';
import { mountMenu } from './platform/menu';
import { cleanName, createProfileStore } from './platform/profile-store';
import { createFaceCrops } from './pose/face-crop';
import { createHandCursors } from './pose/hand-cursor';
import { gestureConfig } from './pose/gestures.config';
import { createRate } from './platform/rate';
import type { SignalFrame } from './pose/gestures';
import type { PoseState } from './pose/pose-state';
import { mountPosePanel } from './pose/pose-panel';
import type { PoseFixture } from './pose/recorder';
import { mountSignalHud } from './pose/signal-hud';
import type { FrameTiming, ModelVariant, PoseFrame } from './pose/types';

const params = new URLSearchParams(location.search);
const input = params.get('input') ?? 'pose';
const debug = params.has('debug');
/** ?players=2: two runs sharing one seed, one camera, split screen. The menu can change it at launch. */
let playerCount: 1 | 2 = params.get('players') === '2' ? 2 : 1;
/** ?clock=manual: the sim only advances through window.__game.advance() (screenshot tests). */
const manualClock = params.get('clock') === 'manual';
/** Revive tokens per run until the profile store exists (M5). */
const tokens = Math.max(0, Number(params.get('tokens') ?? 1) || 0);
const model: ModelVariant =
  (['lite', 'full', 'heavy'] as const).find((m) => m === params.get('model')) ?? 'full';

const profiles = createProfileStore();
/** Session player names, by slot (P1 = left body). ?names=Ana,Beto for direct links and tests. */
let names: string[] = [];

/** One player's run: own inputs, results and best. The sim is theirs alone, or the same object for
 *  every player when the game shares it. */
interface Player {
  sim: OpaqueSim;
  /** Events waiting for this player's next sim step. */
  queue: InputEvent[];
  signals: SignalFrame | null;
  hud: GameHud<OpaqueSim>;
  /** performance.now() when the current run was first seen as over (null while playing). */
  overSince: number | null;
  best: number;
}

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const renderRate = createRate();
/** The launched game; null while the menu is up (and `players` is empty). */
let game: RegisteredGame | null = null;
let players: Player[] = [];
let view: GameView<OpaqueSim> | null = null;
/** The launched game's recalibration gate for `player` (PLAN-BOXING BX-CAL-4). */
const canRecalibrate = (player: number): boolean => {
  const p = players[player];
  return !p || !game?.canRecalibrate || game.canRecalibrate(p.sim, player);
};

/** Pose/replay runs wait for calibration; any keyboard input also opens the gate (fallback). */
let keyboardUsed = false;
/** Results stay up at least this long, so a late dodge-jump doesn't skip them, ms. */
const RESULTS_MIN_MS = 1000;

function newRun(g: RegisteredGame, seed: number): OpaqueSim {
  // ?autoplay=1 lets the bot drive while another input (e.g. the camera) is live: latency tooling.
  const autoplay = input === 'bot' || params.has('autoplay');
  return g.createSim(seed, { reviveTokens: tokens, autoplay, players: playerCount });
}

/** Fresh runs for `who` (a shared sim always restarts for everyone: it is one match). */
function restart(g: RegisteredGame, seed: number, who: readonly Player[]): void {
  const shared = g.sharedSim ? newRun(g, seed) : null;
  for (const p of g.sharedSim ? players : who) {
    p.queue.length = 0;
    p.sim = shared ?? newRun(g, seed);
    p.overSince = null;
  }
}

/** Calls `fn` once per distinct sim with every event for it: a shared sim gets all players' events. */
function eachSim(
  applied: InputEvent[][],
  fn: (sim: OpaqueSim, events: InputEvent[], first: number) => void,
): void {
  players.forEach((p, i) => {
    if (players.findIndex((q) => q.sim === p.sim) !== i) return;
    fn(
      p.sim,
      players.flatMap((q, j) => (q.sim === p.sim ? applied[j]! : [])),
      i,
    );
  });
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
  p.queue.push({ ...e, player }); // a shared sim needs to know whose event it is
  if (e.type === 'BODY') return; // one per pose frame: continuous input, not a gesture to log
  if (player === 0) latency.event(e, pushing, performance.now()); // latency/judder track P1 only
  events.push(e);
  if (events.length > 200) events.shift();
  if (player === 0) signalHud?.event(e);
}

// Keyboard is always on once a game launched: the fallback for every mode (PLAN §2.2); drives P1.
// Created at launch, with the game's keys.
let keyboard: ReturnType<typeof createKeyboardSource> | null = null;

function attach(source: PosePlayers): void {
  source.onEvent((e) => record(e, e.player));
  names.forEach((name, i) => source.setArms(i, profiles.body(name)));
  source.onSignals((s) => {
    const p = players[s.player];
    const pose = s.pose;
    // A new calibrated pose frame (signals also refresh without one): the game's continuous body input.
    if (p && pose && pose.t !== p.signals?.pose?.t && game?.poseInput)
      record(game.poseInput(pose, s.player, profiles.body(names[s.player] ?? '')), s.player);
    if (p) p.signals = s;
    if (s.player === 0) signalHud?.signals(s);
  });
  keyboard?.onEvent((e) => e.type === 'RECALIBRATE' && source.recalibrate(e.t));
  source.start();
}

let pose: ReturnType<typeof mountPosePanel> | null = null;
/** Where camera frames (and window.__game.injectPose) go: the menu's cursors, then the game's pose input. */
let frameSink: ((f: PoseFrame) => void) | null = null;
/** Players' live face crops for games that draw them (pose input only). */
let faces: ReturnType<typeof createFaceCrops> | undefined;
const videoSize = () => pose?.videoSize() ?? { width: 1280, height: 720 };

/** ?input=pose: the camera opens at boot, so the menu can already be driven by hand. */
function mountCamera(numPoses: number): void {
  pose = mountPosePanel(document.body, {
    debug,
    record: params.get('record') === '1',
    model,
    numPoses,
    cameraId: params.get('camera') ?? undefined,
    renderFps: () => renderRate.value(),
    onFrame: (f) => frameSink?.(f),
  });
  // Outside debug the camera preview is a small corner thumbnail over the game.
  document.querySelector('.pose-panel')?.classList.toggle('compact', !debug);
}

function startInput({
  gestureProfile: { toInput, config },
  keys,
  faces: usesFaces,
}: RegisteredGame): void {
  keyboard = createKeyboardSource(window, undefined, keys);
  keyboard.onEvent((e) => record(e));
  keyboard.onEvent(() => (keyboardUsed = true));
  keyboard.start();
  if (input === 'pose') {
    const source = createPosePlayers({
      players: playerCount,
      video: videoSize,
      toInput,
      config,
      canRecalibrate,
    });
    pose?.setNumPoses(playerCount);
    if (usesFaces) {
      const crops = (faces = createFaceCrops(playerCount));
      source.onFrames((frames) => pose && crops.update(pose.frameImage(), frames));
    }
    frameSink = (f) => {
      pushing = f.timing ?? null;
      const t0 = performance.now();
      source.push(f);
      latency.poseFrame(f.timing, performance.now() - t0);
      pushing = null;
    };
    attach(source);
  } else if (input.startsWith('replay:')) {
    // replay:jump.json → /fixtures/pose/jump.json; anything with a slash is used as the URL as-is.
    const name = input.slice('replay:'.length);
    const opts = { toInput, config, players: playerCount, canRecalibrate };
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
    // BX-CAL-2: calibration still completes without knees; the player just can't march then.
    const knees = game?.needsKnees && !signals.knees ? ' · step back so your knees are visible' : '';
    return { tracking: `📷 calibrating${pct}: stand still${knees}`, trackingOk: false };
  }
  return { tracking: '📷 tracking', trackingOk: true };
}

/** A player's mirroring pose, or null once it is stale: with no frames arriving the signals freeze
 *  (worker restarting, replay over), and a frozen body must hand the character back to the sim. */
function livePose({ signals: s }: Player, now: number, staleMs: number): PoseState | null {
  return s?.pose && s.tracking === 'ok' && now - s.pose.t <= staleMs ? s.pose : null;
}

let last = performance.now();

/** "Play again" = jump (PLAN §2.1), only for jumps made after the results were up for 1 s. */
function playAgain(g: RegisteredGame, p: Player, index: number, now: number): void {
  const run = g.summary(p.sim, index);
  if (!run.over) {
    p.overSince = null;
    return;
  }
  p.best = Math.max(p.best, run.score);
  if (p.overSince === null) recordMatch(g, p, index);
  const since = (p.overSince ??= now);
  if (p.queue.some((e) => e.type === 'JUMP' && e.t >= since + RESULTS_MIN_MS))
    restart(g, p.sim.seed, [p]);
}

/** Once per finished match: this player's stats into their history (not for ?input=bot demo runs). */
function recordMatch(g: RegisteredGame, p: Player, index: number): void {
  if (input === 'bot') return;
  const opponent = players.length > 1 ? names[1 - index]! : g.sharedSim ? 'CPU' : null;
  profiles.addMatch(names[index]!, {
    game: g.id,
    at: new Date().toISOString(),
    players: players.length,
    opponent,
    ...g.matchStats(p.sim, index),
  });
}

/** Pose/replay: a fresh run waits until every player calibrated (PLAN §2.1; a fair 2-player start).
 *  Decided per run, so one player's play-again or recalibration never freezes a run in progress. */
function waitingForCalibration(g: RegisteredGame, p: Player, index: number): boolean {
  if (input === 'keyboard' || input === 'bot' || keyboardUsed) return false;
  if (g.summary(p.sim, index).started) return false;
  return players.some((q) => q.signals?.calibration.state !== 'calibrated');
}

function frame(now: number): void {
  const g = game!; // only scheduled by launch()
  renderRate.tick();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  players.forEach((p, i) => playAgain(g, p, i, now));
  const waiting = players.map((p, i) => waitingForCalibration(g, p, i));
  const applied = players.map((p, i) => (waiting[i] || manualClock ? [] : p.queue.splice(0)));
  players.forEach((p, i) => waiting[i] && (p.queue.length = 0));
  latency.frameStart(now, performance.now(), applied.flat());
  eachSim(applied, (sim, events, first) => {
    if (!waiting[first] && !manualClock) sim.step(dt, events);
    sim.drainEvents(); // ponytail: nothing consumes sim events yet (sound/juice come later)
  });
  const drawn =
    view?.render(
      players.map((p) => p.sim),
      !manualClock,
      players.map((p) => livePose(p, now, g.gestureProfile.config.trackingLostMs)),
    ) ?? null;
  latency.rendered(performance.now(), drawn);
  if (applied.some((a) => a.length > 0)) latencyOverlay?.onEventRendered(now);
  latencyOverlay?.frame(now);
  players.forEach((p, i) =>
    p.hud.update(p.sim, { ...trackingLabel(p), best: p.best, waiting: waiting[i]!, names }),
  );
  requestAnimationFrame(frame);
}

const NO_HUD: GameHud<OpaqueSim> = { update: () => {} };

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

function launch(g: RegisteredGame, count = playerCount, chosen?: string[]): void {
  game = g;
  playerCount = count;
  const fromUrl = (params.get('names') ?? '').split(',').map(cleanName);
  const last = profiles.lastNames();
  names = Array.from(
    { length: count },
    (_, i) => chosen?.[i] ?? fromUrl[i] ?? last[i] ?? `Player ${i + 1}`,
  );
  frameSink = null;
  const seed = Number(params.get('seed') ?? 42);
  if (debug) signalHud = mountSignalHud(document.body, g.gestureProfile.config);
  if (params.has('latency')) latencyOverlay = mountLatencyOverlay(document.body, latency.summary);
  const shared = g.sharedSim ? newRun(g, seed) : null;
  players = Array.from({ length: playerCount }, () => ({
    sim: shared ?? newRun(g, seed),
    queue: [],
    signals: null,
    hud: NO_HUD,
    overSince: null,
    best: 0,
  }));
  startInput(g);
  // HUDs after the pose panel: same DOM (stacking) order as before split screen.
  players.forEach((p, i) => (p.hud = g.mountHud(hudRoot(i), i)));
  g.createView(canvas, faces)
    .then((v) => (view = v))
    .catch((err: unknown) => console.error('renderer failed', err))
    .finally(() => requestAnimationFrame(frame));
}

/** Bridge calls that need a run fail loudly (not with a TypeError) while the menu is up. */
function launched(): RegisteredGame {
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
  // Typed by the caller (see debug-bridge.d.ts): the shape is the active game's.
  getState: <S>(index = 0) => player(index).sim.getState() as S,
  getFps: () => renderRate.value(),
  getPoseStats: () => pose?.stats() ?? null,
  getSignals: (index = 0) => players[index]?.signals ?? null,
  getEvents: () => [...events],
  inject: ({ player: index = 0, ...e }) => record({ t: performance.now(), ...e }, index),
  setSeed: (seed: number) => restart(launched(), seed, players),
  advance: (seconds: number) => {
    const { fixedDt } = launched();
    const ticks = Math.round(seconds / fixedDt);
    eachSim(
      players.map((p) => p.queue.splice(0)),
      (sim, events) => {
        for (let i = 0; i < ticks; i++) sim.step(fixedDt, i === 0 ? events : []);
      },
    );
    return player(0).sim.getState().t;
  },
  getRenderStats: () => view?.stats() ?? null,
  getFaceVersion: (index = 0) => faces?.version(index) ?? 0,
  getLatency: () => latency.summary(),
  injectPose: (frame) => frameSink?.(frame),
};

const requested = params.get('game');
const chosen = GAMES.find((g) => g.id === requested);
if (input === 'pose') mountCamera(chosen ? playerCount : 2); // the menu tracks up to two hands
if (chosen) launch(chosen);
else {
  if (requested) console.warn(`unknown ?game=${requested}; showing the menu`);
  const menu = mountMenu(document.body, GAMES, launch, {
    players: playerCount,
    dwellMs: gestureConfig.cursor.dwellMs,
    profiles,
    video: videoSize,
  });
  const cursors = createHandCursors(gestureConfig);
  frameSink = (f) => {
    const { width, height } = videoSize();
    menu.hover(cursors(f, width / height), f.t);
    menu.frame(f);
  };
}
