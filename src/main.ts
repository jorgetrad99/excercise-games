// M0 hello-world: a canvas render loop plus the debug bridge Playwright asserts on.
const seed = Number(new URLSearchParams(location.search).get('seed') ?? 42);
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
let frame = 0;
let fps = 0;
let last = performance.now();

function loop(now: number): void {
  fps = 0.9 * fps + 0.1 * (1000 / Math.max(now - last, 1));
  last = now;
  frame++;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  ctx.fillStyle = '#eee';
  ctx.font = '32px system-ui';
  ctx.fillText(`Move Arcade — seed ${seed} — ${fps.toFixed(0)} fps`, 32, 64);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

window.__game = { getState: () => ({ seed, frame }), getFps: () => fps };
