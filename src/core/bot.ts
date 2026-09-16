// "Perfect reactions" bot (PLAN §4 M3 DoD): plans over cloned sim states, so it can only survive
// if the generated world is actually survivable with the real physics. Also the solvability
// validator's search and the renderer's autoplay (?input=bot).
import type { InputEventType } from './input';
import { cloneState, tick, type SimContext } from './sim';
import { simConfig } from './sim.config';
import type { SimState } from './types';

type Choice = readonly InputEventType[];

const CHOICES: readonly Choice[] = [
  [],
  ['JUMP'],
  ['LANE_LEFT'],
  ['LANE_RIGHT'],
  ['SLIDE_START', 'SLIDE_END'], // a tap: slides for slide.minS
];

export interface BotOptions {
  /** Ticks between decisions (6 = 20 Hz at 120 Hz sim). */
  decisionTicks?: number;
  /** How far ahead a plan must survive, s. */
  horizonS?: number;
  /** Search node budget per replan. */
  maxNodes?: number;
}

export interface Bot {
  /** Call before every tick with the live state; returns the events for that tick. */
  act(s: Readonly<SimState>): Choice;
}

/** Advance a clone by one decision: `choice` on the first tick. False if the run stopped. */
function advance(s: SimState, ctx: SimContext, choice: Choice, ticks: number): boolean {
  for (let i = 0; i < ticks; i++) {
    tick(s, ctx, i === 0 ? choice.map((type) => ({ type })) : []);
    if (s.phase !== 'running') return false;
  }
  return true;
}

const useful = (s: SimState, c: Choice): boolean =>
  c.length === 0 ||
  (c[0] === 'JUMP' && !s.airborne) ||
  (c[0] === 'LANE_LEFT' && s.targetLane > -1) ||
  (c[0] === 'LANE_RIGHT' && s.targetLane < 1) ||
  (c[0] === 'SLIDE_START' && (!s.sliding || s.slideT > 0.3));

const stateKey = (s: SimState, depth: number): string =>
  [
    depth,
    s.targetLane,
    Math.round(s.x * 4),
    Math.round(s.y * 8),
    s.airborne ? Math.sign(s.vy) : 2,
    s.sliding ? Math.round(s.slideT * 10) : -1,
  ].join('|');

/** Depth-first search for a sequence of choices that survives `horizon` decisions. */
export function searchPlan(
  start: SimState,
  ctx: SimContext,
  { decisionTicks = 6, horizonS = 1.5, maxNodes = 20_000 }: BotOptions = {},
): Choice[] | null {
  const horizon = Math.ceil(horizonS / (decisionTicks * simConfig.fixedDt));
  const seen = new Set<string>();
  const path: Choice[] = [];
  let nodes = 0;
  const dfs = (s: SimState, depth: number): boolean => {
    if (depth === horizon) return true;
    const key = stateKey(s, depth);
    if (seen.has(key) || ++nodes > maxNodes) return false;
    seen.add(key);
    for (const choice of CHOICES) {
      if (!useful(s, choice)) continue;
      const next = cloneState(s);
      if (!advance(next, ctx, choice, decisionTicks)) continue;
      path.push(choice);
      if (dfs(next, depth + 1)) return true;
      path.pop();
    }
    return false;
  };
  return dfs(cloneState(start), 0) ? path : null;
}

export function createBot(ctx: SimContext, opts: BotOptions = {}): Bot {
  const decisionTicks = opts.decisionTicks ?? 6;
  const horizon = Math.ceil((opts.horizonS ?? 1.5) / (decisionTicks * simConfig.fixedDt));
  let plan: Choice[] = [];
  const survives = (s: Readonly<SimState>, p: readonly Choice[]): boolean => {
    const clone = cloneState(s);
    for (let i = 0; i < horizon; i++) {
      if (!advance(clone, ctx, p[i] ?? [], decisionTicks)) return false;
    }
    return true;
  };
  return {
    act(s) {
      if (s.phase !== 'running') {
        plan = [];
        return [];
      }
      if (s.tick % decisionTicks !== 0) return [];
      plan = plan.slice(1);
      if (!survives(s, plan)) plan = searchPlan(s, ctx, opts) ?? plan;
      return plan[0] ?? [];
    },
  };
}
