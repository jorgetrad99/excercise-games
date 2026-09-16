// Boot: parse URL params, wire the chosen InputSource(s) to the event log, debug HUD and window.__game.
import type { InputEvent, InputEventType } from './core/input';
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

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 42);
const input = params.get('input') ?? 'pose';
const debug = params.has('debug');
const model: ModelVariant =
  (['lite', 'full', 'heavy'] as const).find((m) => m === params.get('model')) ?? 'full';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
const renderRate = createRate();
let frame = 0;

function loop(): void {
  renderRate.tick();
  frame++;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  ctx.fillStyle = '#555';
  ctx.font = '20px system-ui';
  ctx.fillText(`Move Arcade — seed ${seed} — input ${input}`, 16, canvas.height - 16);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Until the sim exists (M3), input events land in a log that the HUD and Playwright read.
const events: InputEvent[] = [];
const hud = debug ? mountSignalHud(document.body, gestureConfig) : null;
let signals: SignalFrame | null = null;
function record(e: InputEvent): void {
  events.push(e);
  if (events.length > 200) events.shift();
  hud?.event(e);
}

// Keyboard is always on: it's the fallback for every mode (PLAN §2.2).
const keyboard = createKeyboardSource();
keyboard.onEvent(record);
keyboard.start();

function attach(source: PoseSource): void {
  source.onEvent(record);
  source.onSignals((s) => {
    signals = s;
    hud?.signals(s);
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
} else if (input.startsWith('replay:')) {
  // replay:jump.json → /fixtures/pose/jump.json; anything with a slash is used as the URL as-is.
  const name = input.slice('replay:'.length);
  fetch(name.includes('/') ? name : `/fixtures/pose/${name}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${name}: HTTP ${r.status}`))))
    .then((fx: PoseFixture) => attach(createReplaySource(fx)))
    .catch((err: unknown) => console.error('replay failed', err));
}

window.__game = {
  getState: () => ({ seed, frame }),
  getFps: () => renderRate.value(),
  getPoseStats: () => pose?.stats() ?? null,
  getSignals: () => signals,
  getEvents: () => [...events],
  inject: (e: { type: InputEventType; t?: number }) => record({ t: performance.now(), ...e }),
};
