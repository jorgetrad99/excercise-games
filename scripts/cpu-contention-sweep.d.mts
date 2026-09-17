export interface SweepPoint {
  level: number;
  rep: number;
  id: string;
  poseMean: number;
  poseMin: number;
  inferMs: number;
  renderMin: number;
  busyPct: number;
}
export function summarize(points: SweepPoint[]): {
  rows: (Omit<SweepPoint, 'rep'> & { reps: number; poseMeanSd: number })[];
  onset: number | null;
  margin: number | null;
  lastGood: number | null;
};
