// What the renderer draws for a sim state between fixed ticks.
import { laneX } from '../core/collision';
import type { TickPose } from '../core/sim';
import { simConfig } from '../core/sim.config';
import type { SimState } from '../core/types';

export interface RenderPose {
  /** Sim time to animate with, s. */
  t: number;
  distance: number;
  x: number;
  y: number;
}

/**
 * Extrapolate `alpha` of a tick along the last tick's velocity, so a 120 Hz sim draws evenly at
 * 60/144/165 Hz without adding the one-tick (8 ms) delay interpolation would. Lateral motion is
 * clamped at the target lane and height at the ground, so a stop never overshoots on screen.
 */
export function renderPose(
  s: Readonly<SimState>,
  prev: Readonly<TickPose>,
  alpha: number,
): RenderPose {
  const a = s.phase === 'running' ? alpha : 0;
  const target = laneX(s.targetLane);
  const x = s.x + (s.x - prev.x) * a;
  return {
    t: s.t + a * simConfig.fixedDt,
    distance: s.distance + (s.distance - prev.distance) * a,
    x: s.x <= target ? Math.min(x, target) : Math.max(x, target),
    y: Math.max(0, s.y + (s.y - prev.y) * a),
  };
}
