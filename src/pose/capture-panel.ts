// ?record=1&capture=<script>: the capture wizard UI (PLAN-BOXING §11.1). Logic lives in capture.ts.
import {
  captureBundle,
  LEAD_MS,
  replaceTake,
  sliceTake,
  takeEnd,
  type CaptureStep,
  type CaptureTake,
} from './capture';
import { drawDemo } from './capture-demo';
import { CAPTURE_SCRIPTS } from './capture-scripts';
import { downloadJson, type PoseFixture } from './recorder';
import type { PoseFrame } from './types';

/** What the debug bridge logs (core's InputEvent), named without importing core/ (PLAN §3). */
type LoggedEvent = ReturnType<Window['__game']['getEvents']>[number];

const COUNTDOWN_MS = 3000;
/** Wait after a take ends before showing Keep/Redo, so events of its last frames have arrived, ms. */
const SETTLE_MS = 500;
/** Keys free in every game (Z/X/C/R/Space/Enter/arrows are taken): K = Keep (and Start), D = reDo;
 *  L = Learn the moves (practice, nothing recorded), N / B = next / back in practice. */
const KEEP_KEY = 'k';
const REDO_KEY = 'd';
const LEARN_KEY = 'l';
const NEXT_KEY = 'n';
const BACK_KEY = 'b';

const CSS = `
.capture { position: fixed; left: 50%; bottom: 3vh; transform: translateX(-50%); width: min(90vw, 1100px);
  padding: 2vh 3vw; background: #000; color: #fff; font: 600 4.5vh/1.25 system-ui; text-align: center;
  border-radius: 12px; z-index: 10; }
/* Demo steps: figure left, text right, sized to read from ~2.5 m (prompt 6vh, description 4.5vh). */
.capture canvas { display: none; height: 60vh; aspect-ratio: 1.5; }
.capture.demo { display: grid; grid-template-columns: auto 1fr; gap: 2vw; align-items: center;
  width: 96vw; box-sizing: border-box; padding: 2vh 2vw; }
.capture.demo canvas { display: block; }
.capture .prompt { font-size: 6vh; font-weight: 800; }
.capture .how { font-size: 4.5vh; font-weight: 500; margin-top: 1.5vh; text-align: left; }
.capture .big { font-size: 14vh; line-height: 1; }
.capture .rec { color: #f44; }
.capture .go { color: #4f6; }
.capture .detail { font-size: 3vh; font-weight: 400; opacity: 0.85; }
.capture button { font: 600 4vh system-ui; padding: 1vh 3vw; margin: 1.5vh 1vw 0; border-radius: 8px; }
`;

type Phase = 'ready' | 'preview' | 'countdown' | 'recording' | 'review' | 'done';

interface Wizard {
  name: string;
  steps: readonly CaptureStep[];
  phase: Phase;
  index: number;
  /** The current take's lead-in start on the live clock; the countdown ends here. */
  start: number;
  takes: CaptureTake<LoggedEvent>[];
  /** Live frames and events since the current step's countdown began. */
  frames: PoseFrame[];
  events: LoggedEvent[];
  /** Shown with Keep/Redo: what the take holds. */
  summary: string;
  /** Final message once the bundle downloaded. */
  done: string;
}

export interface CaptureWizard {
  push(frame: PoseFrame): void;
}

const button = (key: string, label: string): string =>
  `<button data-key="${key}">${label} (${key.toUpperCase()})</button>`;

function view(w: Wizard, now: number): string {
  if (w.phase === 'done') return `<div class="go">Done</div><div class="detail">${w.done}</div>`;
  const s = w.steps[w.index]!;
  const n = `${w.index + 1}/${w.steps.length}`;
  const prompt = `<div class="prompt">${s.prompt}</div>${s.howTo ? `<div class="how">${s.howTo}</div>` : ''}`;
  if (w.phase === 'preview')
    return `<div class="detail">Practice ${n} · nothing is recorded</div>${prompt}${button(BACK_KEY, 'Back')}${button(NEXT_KEY, 'Next')}${button(KEEP_KEY, 'Done')}`;
  const head = `<div class="detail">Step ${n} · ${w.name}</div>`;
  if (w.phase === 'ready')
    return `${head}${prompt}${button(KEEP_KEY, 'Start')}${button(LEARN_KEY, 'Learn the moves')}`;
  if (w.phase === 'countdown')
    return `${head}${prompt}<div class="big">${Math.ceil((w.start - now) / 1000)}</div>`;
  if (w.phase === 'review')
    return `${head}${prompt}<div class="detail">${w.summary}</div>${button(KEEP_KEY, 'Keep')}${button(REDO_KEY, 'Redo')}`;
  const windowEnd = w.start + LEAD_MS + s.durationS * 1000;
  if (now < w.start + LEAD_MS) return `${head}${prompt}<div class="big rec">● get ready</div>`;
  if (now >= windowEnd) return `${head}${prompt}<div class="big rec">● hold</div>`;
  const left = Math.ceil((windowEnd - now) / 1000);
  return `${head}<div class="big go">GO</div>${prompt}<div class="detail">${left} s</div>`;
}

const take = (
  w: Wizard,
  video: PoseFixture['video'],
  model: PoseFixture['model'],
): CaptureTake<LoggedEvent> => sliceTake(w.steps[w.index]!, w.start, w, { model, video });

function begin(w: Wizard): void {
  w.frames.length = w.events.length = 0;
  w.start = performance.now() + COUNTDOWN_MS;
  w.phase = 'countdown';
}

/** Keep the take; the next step's countdown starts, or after the last step the bundle downloads. */
function keep(w: Wizard, video: PoseFixture['video'], model: PoseFixture['model']): void {
  w.takes = replaceTake(w.takes, w.index, take(w, video, model));
  if (++w.index < w.steps.length) return begin(w);
  const file = `capture-${w.name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  downloadJson(file, captureBundle(w.name, w.takes));
  w.phase = 'done';
  w.done = `Downloaded ${file}`;
}

/** Advances phases on the clock; collects events from the debug bridge's log (main.ts record()). */
function tick(
  w: Wizard,
  seen: WeakSet<LoggedEvent>,
  video: () => PoseFixture['video'],
  model: PoseFixture['model'],
): void {
  for (const e of window.__game.getEvents()) {
    if (seen.has(e)) continue;
    seen.add(e);
    if (w.phase !== 'ready' && w.phase !== 'done') w.events.push(e);
  }
  const now = performance.now();
  if (w.phase === 'countdown' && now >= w.start) w.phase = 'recording';
  if (w.phase === 'recording' && now >= takeEnd(w.steps[w.index]!, w.start) + SETTLE_MS) {
    const t = take(w, video(), model);
    const fired = t.events.map((e) => `${e.type}${e.player ? ` P${e.player + 1}` : ''}`);
    w.summary = `${t.frames.length} frames · events: ${fired.join(', ') || 'none'}`;
    w.phase = 'review';
  }
}

/** K/D/L/N/B, or the clicked button's key. */
function press(
  w: Wizard,
  key: string | undefined,
  video: () => PoseFixture['video'],
  model: PoseFixture['model'],
): void {
  const last = w.steps.length - 1;
  if (key === LEARN_KEY && w.phase === 'ready') w.phase = 'preview';
  else if (key === NEXT_KEY && w.phase === 'preview') w.index = Math.min(last, w.index + 1);
  else if (key === BACK_KEY && w.phase === 'preview') w.index = Math.max(0, w.index - 1);
  else if (key === KEEP_KEY && w.phase === 'preview')
    Object.assign(w, { phase: 'ready', index: 0 });
  else if (key === KEEP_KEY && w.phase === 'ready') begin(w);
  else if (key === KEEP_KEY && w.phase === 'review') keep(w, video(), model);
  else if (key === REDO_KEY && w.phase === 'review') begin(w); // retakes this step only
}

/** Mounts the wizard for `?capture=<name>`; null when the URL has none (or names no script). */
export function mountCaptureWizard(
  root: HTMLElement,
  model: PoseFixture['model'],
  video: () => PoseFixture['video'],
): CaptureWizard | null {
  const name = new URLSearchParams(location.search).get('capture');
  if (name === null) return null;
  const box = Object.assign(document.createElement('div'), { className: 'capture' });
  const canvas = document.createElement('canvas');
  const text = document.createElement('div');
  box.append(canvas, text);
  root.append(Object.assign(document.createElement('style'), { textContent: CSS }), box);
  const steps = CAPTURE_SCRIPTS[name];
  if (!steps) {
    box.textContent = `Unknown capture script "${name}". Known: ${Object.keys(CAPTURE_SCRIPTS).join(', ')}`;
    return null;
  }
  const w: Wizard = {
    name,
    steps,
    phase: 'ready',
    index: 0,
    start: 0,
    takes: [],
    frames: [],
    events: [],
    summary: '',
    done: '',
  };
  const act = (key: string | undefined): void => press(w, key, video, model);
  box.addEventListener('click', (e) =>
    act((e.target as HTMLElement).closest('button')?.dataset['key']),
  );
  window.addEventListener('keydown', (e) => !e.repeat && act(e.key.toLowerCase()));

  const seen = new WeakSet<LoggedEvent>();
  let shown = '';
  let demo = { id: '', since: 0 }; // restarts each step's demo loop when it first shows
  const loop = (): void => {
    tick(w, seen, video, model);
    const now = performance.now();
    const html = view(w, now);
    // Only on change: rebuilding the buttons every frame would swallow clicks.
    if (html !== shown) text.innerHTML = shown = html;
    const id = w.phase === 'review' || w.phase === 'done' ? '' : w.steps[w.index]!.id;
    if (id !== demo.id) demo = { id, since: now };
    box.classList.toggle('demo', id !== '' && drawDemo(canvas, id, now - demo.since));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return {
    push(frame) {
      if (w.phase === 'countdown' || w.phase === 'recording') w.frames.push(frame);
    },
  };
}
