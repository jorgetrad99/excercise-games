import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPoseBridge, type WorkerIn, type WorkerLike, type WorkerOut } from './bridge';
import type { PoseFrame } from './types';

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  sent: WorkerIn[] = [];
  terminated = false;
  postMessage(msg: WorkerIn): void {
    this.sent.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: WorkerOut): void {
    this.onmessage?.({ data } as MessageEvent<WorkerOut>);
  }
  crash(message = 'boom'): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap;
const frame = (t: number): PoseFrame => ({ t, poses: [] });

function setup(watchdogMs = 3000) {
  const workers: FakeWorker[] = [];
  const frames: PoseFrame[] = [];
  const bridge = createPoseBridge({
    init: { type: 'init', wasmPath: '/w', modelPath: '/m.task', numPoses: 1 },
    onFrame: (f) => frames.push(f),
    spawn: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    watchdogMs,
  });
  const current = () => workers[workers.length - 1]!;
  return { bridge, workers, frames, current };
}

describe('createPoseBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it('sends init, gates submits on ready + one frame in flight, and delivers frames', () => {
    const { bridge, current, frames } = setup();
    expect(current().sent[0]).toMatchObject({ type: 'init', modelPath: '/m.task' });
    expect(bridge.canSubmit()).toBe(false);

    current().emit({ type: 'ready', delegate: 'GPU' });
    expect(bridge.canSubmit()).toBe(true);
    bridge.submit(bitmap(), 1);
    expect(bridge.canSubmit()).toBe(false);

    current().emit({ type: 'pose', frame: frame(1), inferMs: 5 });
    expect(frames).toEqual([frame(1)]);
    expect(bridge.canSubmit()).toBe(true);
  });

  it('reconnects after the worker crashes and keeps delivering frames', () => {
    const { bridge, workers, current, frames } = setup();
    current().emit({ type: 'ready', delegate: 'GPU' });
    bridge.submit(bitmap(), 1);

    workers[0]!.crash();
    expect(workers[0]!.terminated).toBe(true);
    expect(bridge.canSubmit()).toBe(false);
    expect(bridge.restarts()).toBe(1);

    vi.advanceTimersByTime(500); // backoff
    expect(workers).toHaveLength(2);
    workers[0]!.emit({ type: 'ready', delegate: 'GPU' }); // late event from the dead worker
    expect(bridge.canSubmit()).toBe(false);
    expect(current().sent[0]).toMatchObject({ type: 'init' });

    current().emit({ type: 'ready', delegate: 'CPU' });
    bridge.submit(bitmap(), 2);
    current().emit({ type: 'pose', frame: frame(2), inferMs: 5 });
    expect(frames).toEqual([frame(2)]);
  });

  it('restarts a hung worker via the watchdog and on posted fatal errors, with backoff', () => {
    const { bridge, workers, current } = setup(1000);
    current().emit({ type: 'ready', delegate: 'GPU' });
    bridge.submit(bitmap(), 1);
    vi.advanceTimersByTime(1000); // no result → watchdog
    expect(bridge.restarts()).toBe(1);

    vi.advanceTimersByTime(500);
    current().emit({ type: 'fatal', message: 'init: model 404' });
    expect(bridge.restarts()).toBe(2);
    vi.advanceTimersByTime(999); // second consecutive failure waits 1 s
    expect(workers).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(workers).toHaveLength(3);
  });
});
