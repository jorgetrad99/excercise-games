// Debug bridge contract (PLAN §3). Grows in M1+: getSignals, inject, setSeed.
interface Window {
  __game: { getState(): { seed: number; frame: number }; getFps(): number };
}
