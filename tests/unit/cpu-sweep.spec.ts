import { describe, expect, it } from 'vitest';
import { summarize, type SweepPoint } from '../../scripts/cpu-contention-sweep.mjs';

const pt = (level: number, rep: number, poseMean: number): SweepPoint => ({
  level,
  rep,
  id: 'skate-2p-pose',
  poseMean,
  poseMin: poseMean - 2,
  inferMs: 26,
  renderMin: 60,
  busyPct: 20 + level * 6,
});

describe('cpu sweep: onset of pose-fps degradation from measured points', () => {
  it('flags the lowest level that falls below baseline − max(1, 2·sd)', () => {
    const points = [
      ...[29.6, 29.8, 29.7].map((m, r) => pt(0, r, m)),
      ...[29.5, 29.7, 29.6].map((m, r) => pt(4, r, m)),
      ...[29.4, 29.2, 29.6].map((m, r) => pt(8, r, m)), // within noise
      ...[27.9, 28.1, 28.0].map((m, r) => pt(12, r, m)), // −1.7: degraded
    ];
    const s = summarize(points);
    expect(s.onset).toBe(12);
    expect(s.lastGood).toBe(8);
    expect(s.margin).toBe(1);
  });

  it('no degradation at any level → onset null (CPU should be reported, not gated)', () => {
    const points = [0, 6, 14].flatMap((l) => [29.7, 29.8].map((m, r) => pt(l, r, m)));
    expect(summarize(points)).toMatchObject({ onset: null, lastGood: 14 });
  });

  it('a noisy baseline widens the margin instead of calling noise an effect', () => {
    const points = [
      ...[26, 30, 28].map((m, r) => pt(0, r, m)), // sd 1.63 → margin 3.27
      ...[26.5, 26.2, 26.4].map((m, r) => pt(4, r, m)), // −1.6: inside the margin
    ];
    expect(summarize(points).onset).toBeNull();
  });
});
