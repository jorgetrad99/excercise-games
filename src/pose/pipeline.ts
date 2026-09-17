// Camera frames → downscaled ImageBitmap → worker → PoseFrame, with fps counters.
import { isSoftwareRenderer, warnSoftwareGl } from '../platform/gpu';
import { createRate } from '../platform/rate';
import { createPoseBridge, type PoseBridge } from './bridge';
import type { FrameTiming, ModelVariant, PoseFrame } from './types';

/** Inference width in px. The model crops to 256² internally; 720p input only costs copy time (PLAN §1.1). */
const INFER_WIDTH = 640;

export interface PoseStats {
  state: 'loading' | 'ready' | 'restarting';
  delegate: 'GPU' | 'CPU' | null;
  /** The pose worker's WebGL renderer ("… WARP …" / "SwiftShader" = software, very slow). */
  gpu: string | null;
  cameraFps: number;
  poseFps: number;
  inferMs: number;
  framesProcessed: number;
  framesWithPose: number;
  lastPoseCount: number;
  restarts: number;
  video: { width: number; height: number };
}

export interface PipelineOptions {
  video: HTMLVideoElement;
  model: ModelVariant;
  numPoses: number;
  onFrame(frame: PoseFrame): void;
  /** When it returns a canvas, each submitted camera frame is also drawn into it at full size, so
   *  results can be matched with the exact image they came from (face crops). */
  snapshot?: () => HTMLCanvasElement | null;
}

/** Per camera frame: count it, and if the worker is idle, downscale and submit it. Returns stop(). */
function startCapture(
  video: HTMLVideoElement,
  bridge: PoseBridge,
  cameraRate: ReturnType<typeof createRate>,
  pending: Map<number, Omit<FrameTiming, 'resultT' | 'inferMs'>>,
  snapshot: PipelineOptions['snapshot'],
): () => void {
  let capturing = false; // createImageBitmap is async; don't start a second one meanwhile
  let stopped = false;
  const onVideoFrame: VideoFrameRequestCallback = (_now, meta): void => {
    if (stopped) return;
    video.requestVideoFrameCallback(onVideoFrame);
    cameraRate.tick();
    if (capturing || !bridge.canSubmit() || video.videoWidth === 0) return;
    capturing = true;
    const t = performance.now();
    const height = Math.round((INFER_WIDTH * video.videoHeight) / video.videoWidth); // keep aspect
    const snap = snapshot?.();
    if (snap) {
      // Same video frame as the bitmap below (both read synchronously in this callback). Only one
      // frame is in flight, so the snapshot matches the next result until that result arrives.
      if (snap.width !== video.videoWidth) snap.width = video.videoWidth;
      if (snap.height !== video.videoHeight) snap.height = video.videoHeight;
      snap.getContext('2d')!.drawImage(video, 0, 0);
    }
    createImageBitmap(video, {
      resizeWidth: INFER_WIDTH,
      resizeHeight: height,
      resizeQuality: 'low',
    })
      .then((bitmap) => {
        if (!bridge.canSubmit()) return bitmap.close();
        pending.clear(); // one frame in flight: anything older was dropped by a worker restart
        pending.set(t, { captureT: meta.captureTime, callbackT: t, bitmapT: performance.now() });
        bridge.submit(bitmap, t);
      })
      .catch((err: unknown) => console.warn('frame capture failed', err))
      .finally(() => (capturing = false));
  };
  video.requestVideoFrameCallback(onVideoFrame);
  return () => {
    stopped = true;
  };
}

export function startPosePipeline({ video, model, numPoses, onFrame, snapshot }: PipelineOptions) {
  const cameraRate = createRate();
  const poseRate = createRate();
  const pending = new Map<number, Omit<FrameTiming, 'resultT' | 'inferMs'>>();
  const s: Omit<PoseStats, 'cameraFps' | 'poseFps' | 'restarts' | 'video'> = {
    state: 'loading',
    delegate: null,
    gpu: null,
    inferMs: 0,
    framesProcessed: 0,
    framesWithPose: 0,
    lastPoseCount: 0,
  };
  const bridge = createPoseBridge({
    init: {
      type: 'init',
      wasmPath: '/models/wasm',
      modelPath: `/models/pose_landmarker_${model}.task`,
      numPoses,
    },
    onFrame(frame, inferMs) {
      poseRate.tick();
      s.framesProcessed++;
      s.lastPoseCount = frame.poses.length;
      if (frame.poses.length > 0) s.framesWithPose++;
      s.inferMs = inferMs;
      const timing = pending.get(frame.t);
      pending.delete(frame.t);
      onFrame(
        timing ? { ...frame, timing: { ...timing, resultT: performance.now(), inferMs } } : frame,
      );
    },
    onStatus(status) {
      s.state = status.state;
      if (status.state !== 'ready') return;
      s.delegate = status.delegate;
      s.gpu = status.gpu ?? null;
      if (s.gpu && isSoftwareRenderer(s.gpu)) warnSoftwareGl('pose worker', s.gpu);
    },
  });

  const stopCapture = startCapture(video, bridge, cameraRate, pending, snapshot);

  return {
    stats: (): PoseStats => ({
      ...s,
      cameraFps: cameraRate.value(),
      poseFps: poseRate.value(),
      restarts: bridge.restarts(),
      video: { width: video.videoWidth, height: video.videoHeight },
    }),
    dispose(): void {
      stopCapture();
      bridge.dispose();
    },
  };
}
