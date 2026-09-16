// Camera frames → downscaled ImageBitmap → worker → PoseFrame, with fps counters.
import { createRate } from '../platform/rate';
import { createPoseBridge, type PoseBridge } from './bridge';
import type { ModelVariant, PoseFrame } from './types';

/** Inference width in px. The model crops to 256² internally; 720p input only costs copy time (PLAN §1.1). */
const INFER_WIDTH = 640;

export interface PoseStats {
  state: 'loading' | 'ready' | 'restarting';
  delegate: 'GPU' | 'CPU' | null;
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
}

/** Per camera frame: count it, and if the worker is idle, downscale and submit it. Returns stop(). */
function startCapture(
  video: HTMLVideoElement,
  bridge: PoseBridge,
  cameraRate: ReturnType<typeof createRate>,
): () => void {
  let capturing = false; // createImageBitmap is async; don't start a second one meanwhile
  let stopped = false;
  const onVideoFrame = (): void => {
    if (stopped) return;
    video.requestVideoFrameCallback(onVideoFrame);
    cameraRate.tick();
    if (capturing || !bridge.canSubmit() || video.videoWidth === 0) return;
    capturing = true;
    const t = performance.now();
    const height = Math.round((INFER_WIDTH * video.videoHeight) / video.videoWidth); // keep aspect
    createImageBitmap(video, {
      resizeWidth: INFER_WIDTH,
      resizeHeight: height,
      resizeQuality: 'low',
    })
      .then((bitmap) => (bridge.canSubmit() ? bridge.submit(bitmap, t) : bitmap.close()))
      .catch((err: unknown) => console.warn('frame capture failed', err))
      .finally(() => (capturing = false));
  };
  video.requestVideoFrameCallback(onVideoFrame);
  return () => {
    stopped = true;
  };
}

export function startPosePipeline({ video, model, numPoses, onFrame }: PipelineOptions) {
  const cameraRate = createRate();
  const poseRate = createRate();
  const s: Omit<PoseStats, 'cameraFps' | 'poseFps' | 'restarts' | 'video'> = {
    state: 'loading',
    delegate: null,
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
      onFrame(frame);
    },
    onStatus(status) {
      s.state = status.state;
      if (status.state === 'ready') s.delegate = status.delegate;
    },
  });

  const stopCapture = startCapture(video, bridge, cameraRate);

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
