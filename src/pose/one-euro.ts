/**
 * One Euro filter (Casiez et al. 2012): low jitter when still, low lag when moving fast.
 * Returns a stateful `(value, tMs) => smoothed` function.
 */
export function createOneEuro(opts: { minCutoff: number; beta: number; dCutoff: number }) {
  let prevT: number | undefined;
  let x = 0;
  let dx = 0;
  const alpha = (cutoffHz: number, dtS: number): number =>
    1 / (1 + 1 / (2 * Math.PI * cutoffHz * dtS));

  return (value: number, tMs: number): number => {
    if (prevT === undefined) {
      prevT = tMs;
      x = value;
      return value;
    }
    const dt = Math.max((tMs - prevT) / 1000, 1e-3);
    prevT = tMs;
    dx += alpha(opts.dCutoff, dt) * ((value - x) / dt - dx);
    x += alpha(opts.minCutoff + opts.beta * Math.abs(dx), dt) * (value - x);
    return x;
  };
}
