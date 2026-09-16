import { describe, expect, it } from 'vitest';
import { createRecorder } from './recorder';

describe('createRecorder', () => {
  it('keeps only the last 30 s and rebases timestamps to 0', () => {
    const rec = createRecorder();
    for (let t = 1000; t <= 41_000; t += 100) rec.push({ t, poses: [] });

    const fixture = rec.snapshot(
      { model: 'full', video: { width: 1280, height: 720 } },
      new Date('2026-09-16T00:00:00Z'),
    );
    expect(fixture).toMatchObject({
      version: 1,
      model: 'full',
      recordedAt: '2026-09-16T00:00:00.000Z',
    });
    expect(fixture.frames[0]!.t).toBe(0);
    expect(fixture.frames.at(-1)!.t).toBe(30_000);
    expect(fixture.frames).toHaveLength(301);
  });
});
