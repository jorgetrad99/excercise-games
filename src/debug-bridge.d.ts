// Debug bridge contract (PLAN §3). getSignals/inject/setSeed arrive with M2/M3.
interface Window {
  __game: {
    getState(): { seed: number; frame: number };
    getFps(): number;
    /** null when not in ?input=pose or before the camera opened. */
    getPoseStats(): import('./pose/pipeline').PoseStats | null;
  };
}
