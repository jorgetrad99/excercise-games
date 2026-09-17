// Worker-hosted PoseLandmarker (VIDEO mode). GPU delegate via OffscreenCanvas, CPU if GPU init fails.
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { glRenderer, isSoftwareRenderer } from '../platform/gpu';
import type { WorkerIn, WorkerInit, WorkerOut } from './bridge';

// MediaPipe's module loader calls `self.import(url)` when present, else `import(url)`. Vite dev rewrites
// the latter to `url?import`, which it refuses (500) for JS under public/. A Function-built import is
// invisible to Vite's import analysis, so the vendored loader is fetched as a plain static file.
Object.assign(self, { import: new Function('url', 'return import(url)') });

let landmarker: PoseLandmarker | undefined;
const post = (msg: WorkerOut): void => postMessage(msg);

async function init({ wasmPath, modelPath, numPoses }: WorkerInit): Promise<void> {
  // `true` = ES-module wasm loader; module workers have no importScripts.
  const fileset = await FilesetResolver.forVisionTasks(wasmPath, true);
  const create = async (delegate: 'GPU' | 'CPU') => {
    const lm = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath, delegate },
      runningMode: 'VIDEO',
      numPoses,
      ...(delegate === 'GPU' ? { canvas: new OffscreenCanvas(1, 1) } : {}),
    });
    // The first detect compiles shaders/builds the graph (seconds). Do it before "ready" so real frames
    // stay under the bridge watchdog, and so a GPU that creates fine but can't run falls back to CPU.
    // t=0 precedes every real capture timestamp.
    lm.detectForVideo(new OffscreenCanvas(256, 256), 0);
    return lm;
  };
  // On a software GL (WARP, SwiftShader) the "GPU" delegate runs shaders on the CPU: measured 188 ms
  // per frame vs ≈ 50 ms for the CPU (WASM) delegate, so go straight to CPU there.
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
  const gpu = gl ? glRenderer(gl) : 'no WebGL2';
  let delegate: 'GPU' | 'CPU' = gl && !isSoftwareRenderer(gpu) ? 'GPU' : 'CPU';
  try {
    landmarker = await create(delegate);
  } catch (err) {
    if (delegate === 'CPU') throw err;
    console.warn('pose worker: GPU delegate unavailable, using CPU', err);
    landmarker = await create((delegate = 'CPU'));
  }
  post({ type: 'ready', delegate, gpu });
}

addEventListener('message', (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    init(msg).catch((err: unknown) => post({ type: 'fatal', message: `init: ${String(err)}` }));
    return;
  }
  try {
    if (!landmarker) throw new Error('frame before ready');
    const start = performance.now();
    const result = landmarker.detectForVideo(msg.bitmap, msg.t);
    // Copy to plain objects: only x/y/z/visibility cross the thread boundary.
    const plain = (lms: typeof result.landmarks) =>
      lms.map((pose) => pose.map(({ x, y, z, visibility }) => ({ x, y, z, visibility })));
    const frame = { t: msg.t, poses: plain(result.landmarks), world: plain(result.worldLandmarks) };
    post({ type: 'pose', frame, inferMs: performance.now() - start });
  } catch (err) {
    post({ type: 'fatal', message: `detect: ${String(err)}` });
  } finally {
    msg.bitmap.close();
  }
});
