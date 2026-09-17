// Perf breakdown probe (not in verify): opens scenarios in Chromium with the fake camera at 1920×1080,
// instruments main-thread costs from outside the app (rAF callbacks by name, 2D drawImage by target
// size, WebGL texture uploads, createImageBitmap, long tasks) and samples the debug bridge.
// Works against any commit that has window.__game, so older builds can be measured for attribution.
//   node scripts/perf-probe.mjs --base http://localhost:5173 --label head [--only boxing-1p-pose,...]
/* global window, performance, PerformanceObserver, CanvasRenderingContext2D, HTMLCanvasElement, WebGLRenderingContext, WebGL2RenderingContext -- page-side code */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { acquire, waitForLock } from './e2e-lock.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = arg('base', 'http://localhost:5173');
const LABEL = arg('label', 'head');
const ONLY = arg('only', '')?.split(',').filter(Boolean);
const SECONDS = Number(arg('seconds', 10));
// --angle d3d11-warp: software WebGL, what Chrome falls back to when it won't use the GPU.
const ANGLE = arg('angle', '');
const NO_DRAW = process.argv.includes('--no-draw');
const [VW, VH] = arg('viewport', '1920x1080').split('x').map(Number);
const clip = (name) => path.resolve(`tests/e2e/assets/${name}.mjpeg`);
const ONE = clip('placeholder-person');
const TWO = clip('placeholder-two-people');

/** url: query string; clip: fake camera; key: a mapped key to open the calibration gate. */
const SCENARIOS = [
  { id: 'menu-pose', url: '?input=pose', clip: TWO },
  {
    id: 'skate-1p-pose',
    url: '?game=skate-run&input=pose&seed=42&autoplay=1',
    clip: ONE,
    key: 'Space',
  },
  { id: 'boxing-1p-keyboard', url: '?game=boxing&input=keyboard&seed=42', clip: ONE },
  { id: 'boxing-2p-keyboard', url: '?game=boxing&input=keyboard&seed=42&players=2', clip: TWO },
  { id: 'boxing-1p-pose', url: '?game=boxing&input=pose&seed=42', clip: ONE, key: 'z' },
  { id: 'boxing-2p-pose', url: '?game=boxing&input=pose&seed=42&players=2', clip: TWO, key: 'z' },
  {
    id: 'boxing-1p-pose-lite',
    url: '?game=boxing&input=pose&seed=42&model=lite',
    clip: ONE,
    key: 'z',
  },
  {
    id: 'boxing-2p-pose-lite',
    url: '?game=boxing&input=pose&seed=42&players=2&model=lite',
    clip: TWO,
    key: 'z',
  },
  {
    id: 'skate-2p-pose',
    url: '?game=skate-run&input=pose&seed=42&players=2&autoplay=1',
    clip: TWO,
    key: 'Space',
  },
  // The real flow: camera opens on the menu (2 poses), picking a game restarts the worker for 1.
  {
    id: 'menu-then-boxing-1p',
    url: '?input=pose&seed=42',
    clip: ONE,
    click: 'button[data-game=boxing]',
    key: 'z',
  },
  // The URL the boxing recording protocol asks for.
  {
    id: 'boxing-1p-pose-debug-record',
    url: '?game=boxing&input=pose&seed=42&debug=1&record=1',
    clip: ONE,
    key: 'z',
  },
  // A busy laptop (Codex, VS Code, a browser): main thread throttled 4×.
  {
    id: 'boxing-1p-pose-cpu4x',
    url: '?game=boxing&input=pose&seed=42',
    clip: ONE,
    key: 'z',
    throttle: 4,
  },
  {
    id: 'boxing-2p-pose-cpu4x',
    url: '?game=boxing&input=pose&seed=42&players=2',
    clip: TWO,
    key: 'z',
    throttle: 4,
  },
];

// Runs in the page before any app code.
function instrument() {
  const buckets = new Map();
  const add = (key, ms) => {
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { n: 0, total: 0, max: 0, all: [] }));
    b.n++;
    b.total += ms;
    b.max = Math.max(b.max, ms);
    if (b.all.length < 5000) b.all.push(ms);
  };
  const timed = (key, fn, self, args) => {
    const t = performance.now();
    try {
      return fn.apply(self, args);
    } finally {
      add(typeof key === 'function' ? key(self, args) : key, performance.now() - t);
    }
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((now) => timed(`raf:${cb.name || 'anon'}`, cb, window, [now]));
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (...a) {
    return timed((s) => `drawImage→${s.canvas.width}x${s.canvas.height}`, draw, this, a);
  };
  const toUrl = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...a) {
    return timed('toDataURL', toUrl, this, a);
  };
  for (const Ctx of [WebGL2RenderingContext, WebGLRenderingContext]) {
    for (const m of ['texImage2D', 'texSubImage2D']) {
      const orig = Ctx.prototype[m];
      Ctx.prototype[m] = function (...a) {
        const src = a[a.length - 1];
        const kind = src?.constructor?.name ?? 'null';
        const big =
          kind === 'HTMLCanvasElement' || kind === 'HTMLVideoElement' || kind === 'ImageBitmap';
        return big
          ? timed(`${m}(${kind} ${src.width}x${src.height})`, orig, this, a)
          : orig.apply(this, a);
      };
    }
  }
  const cib = window.createImageBitmap.bind(window);
  window.createImageBitmap = (...a) => {
    const t = performance.now();
    return cib(...a).finally(() => add('createImageBitmap (async)', performance.now() - t));
  };
  try {
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => add('longtask', e.duration)),
    ).observe({
      type: 'longtask',
      buffered: false,
    });
  } catch {
    // older engines
  }
  window.__perf = {
    reset: () => buckets.clear(),
    dump: (seconds) =>
      Object.fromEntries(
        [...buckets].map(([k, b]) => {
          const s = b.all.sort((x, y) => x - y);
          return [
            k,
            {
              perSec: +(b.n / seconds).toFixed(1),
              p50: +(s[Math.floor(s.length / 2)] ?? 0).toFixed(2),
              p95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(2),
              max: +b.max.toFixed(1),
              msPerSec: +(b.total / seconds).toFixed(1),
            },
          ];
        }),
      ),
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function run(sc) {
  const browser = await chromium.launch({
    channel: 'chromium',
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${sc.clip}`,
      ...(ANGLE ? ['--use-gl=angle', `--use-angle=${ANGLE}`] : []),
    ],
  });
  try {
    const page = await browser.newPage({ viewport: { width: VW, height: VH } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(instrument);
    // --no-draw: the page's WebGL draws become no-ops (the pose worker's GL is untouched), to
    // measure how much the renderer's GPU work slows inference.
    if (NO_DRAW)
      await page.addInitScript(() => {
        for (const m of [
          'drawElements',
          'drawArrays',
          'drawElementsInstanced',
          'drawArraysInstanced',
        ])
          WebGL2RenderingContext.prototype[m] = () => {};
      });
    await page.goto(`${BASE}/${sc.url}`);
    const pose = sc.url.includes('input=pose');
    const waitReady = () =>
      page
        .waitForFunction(
          (p) => {
            const g = window.__game;
            if (!g) return false;
            const menu = g.getActiveGame?.() === null;
            const renderOk = menu || g.getRenderStats() !== null;
            const s = g.getPoseStats();
            return renderOk && (!p || (s?.state === 'ready' && s.framesWithPose > 0));
          },
          pose,
          { timeout: 60_000, polling: 250 },
        )
        .then(() => true)
        .catch(() => false);
    if (!(await waitReady())) return { id: sc.id, error: 'not ready in 60 s', errors };
    if (sc.click) {
      await page.waitForTimeout(2000);
      await page.click(sc.click);
      await page.waitForTimeout(1000); // the worker restart begins
      if (!(await waitReady())) return { id: sc.id, error: 'not ready after click', errors };
    }
    if (sc.throttle) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: sc.throttle });
    }
    if (sc.key) await page.keyboard.press(sc.key);
    await page.waitForTimeout(3000); // warm-up: shader compile, first texture uploads
    const snap = () =>
      page.evaluate(() => {
        const g = window.__game;
        return {
          now: performance.now(),
          fps: g.getFps(),
          pose: g.getPoseStats(),
          render: g.getActiveGame?.() === null ? null : g.getRenderStats(),
        };
      });
    const a = await snap();
    await page.evaluate(() => window.__perf.reset());
    const samples = [];
    for (let i = 0; i < SECONDS; i++) {
      await page.waitForTimeout(1000);
      samples.push({ ...(await snap()), at: Date.now() });
    }
    const b = samples.at(-1);
    const secs = (b.now - a.now) / 1000;
    const perf = await page.evaluate((s) => window.__perf.dump(s), secs);
    const ps = samples.map((s) => s.pose).filter(Boolean);
    return {
      id: sc.id,
      renderFps: {
        median: median(samples.map((s) => s.fps)),
        min: Math.min(...samples.map((s) => s.fps)),
      },
      poseFps: pose
        ? {
            mean: +((b.pose.framesProcessed - a.pose.framesProcessed) / secs).toFixed(1),
            min: Math.min(...ps.map((p) => p.poseFps)),
          }
        : null,
      cameraFps: pose ? median(ps.map((p) => p.cameraFps)) : null,
      inferMs: pose ? median(ps.map((p) => p.inferMs)) : null,
      delegate: b.pose?.delegate ?? null,
      restarts: b.pose?.restarts ?? null,
      withPose: pose
        ? +(
            (b.pose.framesWithPose - a.pose.framesWithPose) /
            Math.max(1, b.pose.framesProcessed - a.pose.framesProcessed)
          ).toFixed(2)
        : null,
      calls: b.render?.calls ?? null,
      triangles: b.render?.triangles ?? null,
      perf,
      // Per-second readings with wall-clock time, so a sweep can join them to GPU telemetry.
      series: samples.map((s) => ({
        at: s.at,
        fps: s.fps,
        poseFps: s.pose?.poseFps ?? null,
        inferMs: s.pose?.inferMs ?? null,
      })),
      errors,
    };
  } finally {
    await browser.close();
  }
}

// A probe is a perf measurement: wait for any e2e run, then hold the lock so heavy work waits for us.
await waitForLock({ label: 'perf-probe' });
const release = acquire();
const out = [];
try {
  for (const sc of SCENARIOS.filter((s) => !ONLY?.length || ONLY.includes(s.id))) {
    const r = await run(sc);
    console.log(JSON.stringify(r));
    out.push(r);
  }
} finally {
  release();
}
await mkdir('tmp/perf', { recursive: true });
await writeFile(`tmp/perf/probe-${LABEL}.json`, JSON.stringify(out, null, 2));
console.log(`wrote tmp/perf/probe-${LABEL}.json`);
