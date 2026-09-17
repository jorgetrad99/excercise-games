export type TelemetryRow = { at: number } & Record<string, number>;
export interface SeriesSample {
  at: number;
  fps: number;
  poseFps: number | null;
  inferMs: number | null;
}
export function pearson(xs: number[], ys: (number | undefined)[]): number | null;
export function parseNvidia(text: string): TelemetryRow[];
export function parseTypeperf(text: string): TelemetryRow[];
export function correlate(
  points: { id: string; level: number; poseMean: number; series?: SeriesSample[] }[],
  telemetry: TelemetryRow[],
  opts?: { id?: string; maxLevel?: number },
): {
  runs: number;
  samples: number;
  r: Record<string, { perSecond: number | null; perRun: number | null; runMean: number }>;
};
export function displays(): { internal: number; external: number } | null;
export function startTelemetry(prefix: string): {
  kill(): void;
  stop(): Promise<TelemetryRow[]>;
};
