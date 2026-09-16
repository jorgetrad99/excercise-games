/** Events per second over a sliding 1 s window. */
export function createRate(now: () => number = () => performance.now()) {
  const stamps: number[] = [];
  return {
    tick(): void {
      stamps.push(now());
    },
    value(): number {
      const cutoff = now() - 1000;
      while (stamps.length > 0 && stamps[0]! < cutoff) stamps.shift();
      return stamps.length;
    },
  };
}
