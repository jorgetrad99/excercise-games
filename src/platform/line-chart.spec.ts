import { expect, it } from 'vitest';
import { niceScale, statLabel } from './line-chart';

it('niceScale: round tops, whole steps for counts', () => {
  expect(niceScale(21)).toEqual({ top: 30, step: 10 }); // 21/4 = 5.25 → step 10
  expect(niceScale(16)).toEqual({ top: 20, step: 5 }); // 4 → 5
  expect(niceScale(2)).toEqual({ top: 2, step: 1 }); // 0.5 → 1, never a half knockdown
  expect(niceScale(0.8, false)).toEqual({ top: 0.8, step: 0.2 });
  expect(niceScale(0)).toEqual({ top: 1, step: 1 });
});

it('statLabel splits camelCase', () => {
  expect(statLabel('knockdownsScored')).toBe('knockdowns scored');
  expect(statLabel('score')).toBe('score');
});
