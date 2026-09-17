// Main-thread side of the pose worker: one frame in flight (backpressure), auto-restart on crash/hang.
import type { PoseFrame } from './types';

export interface WorkerInit {
  type: 'init';
  wasmPath: string;
  modelPath: string;
  numPoses: number;
}
export type WorkerIn = WorkerInit | { type: 'frame'; bitmap: ImageBitmap; t: number };
export type WorkerOut =
  /** gpu: the worker's WebGL renderer string (software rasterizers show up here). */
  | { type: 'ready'; delegate: 'GPU' | 'CPU'; gpu?: string }
  | { type: 'pose'; frame: PoseFrame; inferMs: number }
  | { type: 'fatal'; message: string };

/** The subset of `Worker` the bridge uses, so tests can pass a fake. */
export interface WorkerLike {
  postMessage(msg: WorkerIn, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerOut>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export type BridgeStatus =
  | { state: 'loading' }
  | { state: 'ready'; delegate: 'GPU' | 'CPU'; gpu?: string | undefined }
  | { state: 'restarting'; reason: string; restarts: number };

export interface PoseBridgeOptions {
  init: WorkerInit;
  onFrame(frame: PoseFrame, inferMs: number): void;
  onStatus?(status: BridgeStatus): void;
  spawn?: () => WorkerLike;
  /** A frame with no result after this long means the worker hung (e.g. GPU context lost). */
  watchdogMs?: number;
}

export interface PoseBridge {
  canSubmit(): boolean;
  /** Transfers `bitmap` to the worker. Only call when `canSubmit()`. */
  submit(bitmap: ImageBitmap, t: number): void;
  restarts(): number;
  dispose(): void;
}

const spawnPoseWorker = (): WorkerLike =>
  new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' });

export function createPoseBridge(opts: PoseBridgeOptions): PoseBridge {
  const spawn = opts.spawn ?? spawnPoseWorker;
  const watchdogMs = opts.watchdogMs ?? 3000;
  let worker: WorkerLike;
  let ready = false;
  let inFlight = false;
  let disposed = false;
  let restarts = 0;
  let failuresInARow = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function start(): void {
    if (disposed) return;
    ready = inFlight = false;
    const w = (worker = spawn());
    // Events already queued from a terminated worker must not touch its replacement.
    w.onmessage = ({ data }) => {
      if (w !== worker) return;
      if (data.type === 'ready') {
        clearTimeout(timer);
        ready = true;
        opts.onStatus?.({ state: 'ready', delegate: data.delegate, gpu: data.gpu });
      } else if (data.type === 'pose') {
        clearTimeout(timer);
        inFlight = false;
        failuresInARow = 0;
        opts.onFrame(data.frame, data.inferMs);
      } else restart(data.message);
    };
    w.onerror = (e) => w === worker && restart(e.message || 'worker error');
    w.postMessage(opts.init, []);
    // Init includes a model fetch + warm-up (seconds), so it gets a longer leash than a frame.
    timer = setTimeout(() => restart('init did not finish within 30 s'), 30_000);
    opts.onStatus?.({ state: 'loading' });
  }

  function restart(reason: string): void {
    if (disposed) return;
    clearTimeout(timer);
    worker.terminate();
    ready = inFlight = false;
    restarts++;
    // Backoff so a permanent failure (e.g. model 404) doesn't spin: 0.5 s, 1 s, 2 s … capped at 10 s.
    const delay = Math.min(500 * 2 ** failuresInARow++, 10_000);
    console.warn(`pose worker restart #${restarts} in ${delay} ms: ${reason}`);
    opts.onStatus?.({ state: 'restarting', reason, restarts });
    timer = setTimeout(start, delay);
  }

  start();
  return {
    canSubmit: () => ready && !inFlight,
    submit(bitmap, t) {
      inFlight = true;
      worker.postMessage({ type: 'frame', bitmap, t }, [bitmap]);
      timer = setTimeout(() => restart(`no result within ${watchdogMs} ms`), watchdogMs);
    },
    restarts: () => restarts,
    dispose() {
      disposed = true;
      ready = false;
      clearTimeout(timer);
      worker.terminate();
    },
  };
}
