// Perf-gate contention thresholds (tests/e2e/machine-state.ts). A gate measured while processes that
// aren't this run use more of the machine than this is PROVISIONAL: recorded, never pass or fail.
// Untuned start values (2026-09-16): set them from Jorge's display-routing before/after measurement.
export const contentionConfig = {
  /** GPU engine use (3D + Compute) summed over processes outside this run, on the adapter this run
   *  renders on, %. The desktop compositor alone read ~42 % while it drove the external display. */
  maxExternalGpuPct: 10,
  /** CPU used by processes outside this run, in logical cores (1 = one core fully busy). VS Code's
   *  extension host alone ran ~1.2 steadily. */
  maxExternalCpuCores: 2,
  /** Counter samples, 1 s apart, taken right after the gate's measurement window. */
  samples: 3,
};
