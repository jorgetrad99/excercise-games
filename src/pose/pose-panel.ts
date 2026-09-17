// Camera preview + device picker + skeleton overlay; with debug: fps, visibility heatmap; with record: fixture download.
import { PoseLandmarker } from '@mediapipe/tasks-vision';
import { listCameras, openCamera, rememberedCameraId } from './camera';
import { startPosePipeline, type PoseStats } from './pipeline';
import { createRecorder, downloadJson } from './recorder';
import type { Landmark, ModelVariant, PoseFrame } from './types';

export interface PosePanelOptions {
  debug: boolean;
  record: boolean;
  model: ModelVariant;
  numPoses: number;
  /** ?camera=<deviceId>; wins over the remembered device. */
  cameraId: string | undefined;
  renderFps(): number;
  /** Every PoseFrame, e.g. into the pose InputSource. */
  onFrame(frame: PoseFrame): void;
}

const CSS = `
.pose-panel { position: fixed; top: 12px; left: 12px; width: min(960px, calc(100vw - 560px), calc(100vw - 24px)); font: 13px/1.4 system-ui; color: #eee; }
.pose-panel.compact { width: min(320px, 30vw); opacity: 0.9; }
.pose-panel .stage { position: relative; background: #000; aspect-ratio: 16 / 9; }
.pose-panel video, .pose-panel .overlay { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; transform: scaleX(-1); }
.pose-panel .heatmap:not([hidden]) { display: block; margin-top: 6px; }
.pose-panel .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; }
.pose-panel pre { margin: 6px 0 0; font: 12px/1.4 ui-monospace, monospace; }
`;
const POSE_COLORS = ['#3ef', '#fb3', '#f5a', '#7f7'];
const visColor = (v: number): string =>
  `hsl(${Math.round(Math.max(0, Math.min(1, v)) * 120)} 90% 50%)`;

function buildDom(root: HTMLElement) {
  const style = Object.assign(document.createElement('style'), { textContent: CSS });
  const panel = Object.assign(document.createElement('div'), { className: 'pose-panel' });
  panel.innerHTML = `
    <div class="stage"><video muted playsinline></video><canvas class="overlay"></canvas></div>
    <div class="bar">
      <label>Camera <select></select></label>
      <button class="retry" hidden>Retry camera</button>
      <button class="download" hidden>Download last 30 s (R)</button>
      <span class="status"></span>
    </div>
    <canvas class="heatmap" width="330" height="14" hidden title="landmark visibility 0..32"></canvas>
    <pre class="stats" hidden></pre>`;
  root.append(style, panel);
  const q = <T extends Element>(sel: string) => panel.querySelector<T>(sel)!;
  return {
    video: q<HTMLVideoElement>('video'),
    overlay: q<HTMLCanvasElement>('.overlay'),
    select: q<HTMLSelectElement>('select'),
    retry: q<HTMLButtonElement>('.retry'),
    download: q<HTMLButtonElement>('.download'),
    status: q<HTMLSpanElement>('.status'),
    heatmap: q<HTMLCanvasElement>('.heatmap'),
    stats: q<HTMLPreElement>('.stats'),
  };
}

/** Draws in raw image coordinates; CSS mirrors the canvas together with the video. */
function drawSkeleton(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  frame: PoseFrame | null,
): void {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!frame) return;
  const px = (l: Landmark): [number, number] => [l.x * canvas.width, l.y * canvas.height];
  frame.poses.forEach((pose, i) => {
    ctx.strokeStyle = POSE_COLORS[i % POSE_COLORS.length]!;
    ctx.lineWidth = 4;
    for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
      const a = pose[start];
      const b = pose[end];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(...px(a));
      ctx.lineTo(...px(b));
      ctx.stroke();
    }
    for (const l of pose) {
      ctx.fillStyle = visColor(l.visibility);
      ctx.beginPath();
      ctx.arc(...px(l), 7, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawHeatmap(canvas: HTMLCanvasElement, pose: Landmark[] | undefined): void {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#333';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  pose?.forEach((l, i) => {
    ctx.fillStyle = visColor(l.visibility);
    ctx.fillRect(i * 10, 0, 9, canvas.height);
  });
}

function formatStats(s: PoseStats, renderFps: number): string {
  return [
    `camera ${s.cameraFps} fps  pose ${s.poseFps} fps  render ${renderFps.toFixed(0)} fps`,
    `infer ${s.inferMs.toFixed(1)} ms  delegate ${s.delegate ?? '-'}  worker ${s.state}  restarts ${s.restarts}`,
    `video ${s.video.width}x${s.video.height}  poses ${s.lastPoseCount}  frames ${s.framesWithPose}/${s.framesProcessed} with pose`,
  ].join('\n');
}

type Ui = ReturnType<typeof buildDom>;

/** The skeleton is always drawn (the compact thumbnail too: it shows whether you're being tracked). */
function startDrawLoop(
  ui: Ui,
  debug: boolean,
  latest: () => PoseFrame | null,
  stats: () => PoseStats | null,
  renderFps: () => number,
): void {
  ui.heatmap.hidden = ui.stats.hidden = !debug;
  const draw = (): void => {
    const frame = latest();
    drawSkeleton(ui.overlay, ui.video, frame);
    const s = debug ? stats() : null;
    if (debug) drawHeatmap(ui.heatmap, frame?.poses[0]);
    if (s) ui.stats.textContent = formatStats(s, renderFps());
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function wireRecorder(
  ui: Ui,
  recorder: ReturnType<typeof createRecorder>,
  model: ModelVariant,
): void {
  const save = (): void => {
    const video = { width: ui.video.videoWidth, height: ui.video.videoHeight };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJson(`pose-${stamp}.json`, recorder.snapshot({ model, video }));
  };
  ui.download.hidden = false;
  ui.download.addEventListener('click', save);
  window.addEventListener('keydown', (e) => e.key.toLowerCase() === 'r' && save());
}

/** Stops `previous`, opens the camera into the video element. Null if it failed or was superseded. */
async function showCamera(
  ui: Ui,
  previous: MediaStream | null,
  deviceId: string | undefined,
  isCurrent: () => boolean,
): Promise<MediaStream | null> {
  ui.status.textContent = 'Requesting camera…';
  previous?.getTracks().forEach((t) => t.stop());
  let stream: MediaStream;
  try {
    stream = await openCamera(deviceId);
  } catch (err) {
    if (!isCurrent()) return null;
    const name = (err as { name?: string }).name ?? String(err);
    ui.status.textContent = `Camera unavailable (${name}). Allow camera access, then retry.`;
    ui.retry.hidden = false;
    return null;
  }
  if (!isCurrent()) {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }
  ui.video.srcObject = stream;
  // Replacing srcObject mid-play rejects the old play() with AbortError; that's expected.
  await ui.video.play().catch((err: unknown) => {
    if ((err as { name?: string }).name !== 'AbortError') throw err;
  });
  ui.status.textContent = '';
  return isCurrent() ? stream : null;
}

async function fillCameraSelect(
  select: HTMLSelectElement,
  current: string | undefined,
): Promise<void> {
  const cameras = await listCameras();
  select.replaceChildren(
    ...cameras.map(
      (c, i) => new Option(c.label || `Camera ${i + 1}`, c.deviceId, false, c.deviceId === current),
    ),
  );
}

export function mountPosePanel(
  root: HTMLElement,
  opts: PosePanelOptions,
): { stats(): PoseStats | null; videoSize(): { width: number; height: number } } {
  const ui = buildDom(root);
  const recorder = opts.record ? createRecorder() : null;
  let latest: PoseFrame | null = null;
  let pipeline: ReturnType<typeof startPosePipeline> | null = null;
  let stream: MediaStream | null = null;
  let deviceId = opts.cameraId ?? rememberedCameraId();

  let generation = 0; // a newer start() (fast camera switching) supersedes an in-progress one
  async function start(): Promise<void> {
    const gen = ++generation;
    ui.retry.hidden = true;
    const next = await showCamera(ui, stream, deviceId, () => gen === generation);
    if (!next) return;
    stream = next;
    deviceId = next.getVideoTracks()[0]?.getSettings().deviceId;
    await fillCameraSelect(ui.select, deviceId);
    pipeline ??= startPosePipeline({
      video: ui.video,
      model: opts.model,
      numPoses: opts.numPoses,
      onFrame: (frame) => {
        latest = frame;
        recorder?.push(frame);
        opts.onFrame(frame);
      },
    });
  }
  const restart = (): void => {
    start().catch((err: unknown) => {
      ui.status.textContent = `Camera error: ${String(err)}`;
      ui.retry.hidden = false;
    });
  };

  ui.select.addEventListener('change', () => {
    deviceId = ui.select.value;
    restart();
  });
  ui.retry.addEventListener('click', restart);
  if (recorder) wireRecorder(ui, recorder, opts.model);
  startDrawLoop(
    ui,
    opts.debug,
    () => latest,
    () => pipeline?.stats() ?? null,
    opts.renderFps,
  );

  restart();
  return {
    stats: () => pipeline?.stats() ?? null,
    videoSize: () => ({ width: ui.video.videoWidth || 1280, height: ui.video.videoHeight || 720 }),
  };
}
