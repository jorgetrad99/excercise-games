// Boot: hello-world canvas render loop, pose panel for ?input=pose (default), debug bridge.
import { createRate } from './platform/rate';
import { mountPosePanel } from './pose/pose-panel';
import type { ModelVariant } from './pose/types';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 42);
const input = params.get('input') ?? 'pose';
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

const pose =
  input === 'pose'
    ? mountPosePanel(document.body, {
        debug: params.has('debug'),
        record: params.get('record') === '1',
        model,
        numPoses: params.get('players') === '2' ? 2 : 1,
        cameraId: params.get('camera') ?? undefined,
        renderFps: () => renderRate.value(),
      })
    : null;

window.__game = {
  getState: () => ({ seed, frame }),
  getFps: () => renderRate.value(),
  getPoseStats: () => pose?.stats() ?? null,
};
