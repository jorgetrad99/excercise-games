// Pattern library v1 (PLAN §2.3). Hand-authored ASCII grids: 12 rows × 3 lanes, rows 2 m long.
// Rows are written FAR → NEAR (top of the list is the end of the chunk), columns are lanes -1, 0, 1.
//   .  empty      J  jump-over barrier   S  slide-under bar   W  wall (vertical runs merge)
//   c  2 coins    o  2 high coins (mid-jump only)            P  power-up spot (spawn is rolled)
// Authoring rules (checked by patterns.spec.ts): obstacles only in rows 3–10 (run-up and run-out at
// the chunk edges), at most one row that blocks every lane, and solvable from any lane at the speeds
// the pattern can appear at.
import { simConfig } from './sim.config';
import type { BiomeId, Coin, Lane, Obstacle, ObstacleKind } from './types';

export interface Pattern {
  id: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  biomes: readonly BiomeId[];
  rows: readonly string[];
}

export interface ParsedPattern {
  obstacles: Omit<Obstacle, 'id'>[];
  coins: Omit<Coin, 'id'>[];
  pickupSpots: { lane: Lane; z: number }[];
  /** Local z (row centre) of rows that block every lane. */
  forced: number[];
}

export const BIOMES: readonly BiomeId[] = ['street', 'park'];
const ANY = BIOMES;
const p = (
  id: string,
  difficulty: Pattern['difficulty'],
  biomes: readonly BiomeId[],
  rows: string[],
): Pattern => ({ id, difficulty, biomes, rows });

/** Run-up chunks at the start of a run. Not in the random pool. */
export const EMPTY_PATTERN = p('empty', 1, ANY, Array<string>(12).fill('...'));

// prettier-ignore
export const PATTERNS: readonly Pattern[] = [
  p('d1-coin-line', 1, ANY, ['...', '.c.', '.c.', '.c.', '.c.', '.c.', '.c.', '.c.', '.c.', '...', '...', '...']),
  p('d1-hurdle', 1, ANY, ['...', '...', '...', '.c.', '.o.', '.J.', '.c.', '.c.', '...', '...', '...', '...']),
  p('d1-bar-left', 1, ANY, ['...', '...', '...', 'c..', '...', 'S..', '...', 'c..', 'c..', '...', '...', '...']),
  p('d1-wall-right', 1, ANY, ['...', '...', 'c..', 'c..', '..W', '..W', '..W', '..W', 'cP.', '...', '...', '...']),
  p('d1-zigzag', 1, ANY, ['...', '...', 'c..', 'c..', '.c.', '.c.', '..c', '..c', '.c.', '.c.', '...', '...']),
  p('d1-park-benches', 1, ['park'], ['...', '...', '...', '..J', '.c.', '.c.', '.c.', 'J..', '...', '...', '...', '...']),
  p('d1-street-cones', 1, ['street'], ['...', '...', 'c.c', 'c.c', '...', '...', '.S.', '...', 'c.c', '...', '...', '...']),

  p('d2-slalom', 2, ANY, ['...', '..W', '..W', '..W', '.cW', 'W..', 'W..', 'Wc.', 'W..', '...', '...', '...']),
  p('d2-two-hurdles', 2, ANY, ['...', '...', '...', '..c', '..c', '..c', 'JJ.', '...', '...', '...', '...', '...']),
  p('d2-high-coins', 2, ANY, ['...', '...', '...', '.o.', '.o.', '.J.', '.o.', '...', '...', '...', '...', '...']),
  p('d2-street-bars', 2, ['street'], ['...', '...', 'c..', 'c..', 'c..', '.SS', '...', '...', '...', '...', '...', '...']),
  p('d2-park-corridor', 2, ['park'], ['...', '...', 'W.W', 'WcW', 'WcW', 'WcW', 'WcW', 'WcW', 'W.W', '...', '...', '...']),
  p('d2-jump-and-wall', 2, ANY, ['...', '...', '..W', '..W', 'P.W', '..W', '...', '.J.', '...', '...', '...', '...']),

  p('d3-full-hurdle', 3, ANY, ['...', '...', '.c.', '.c.', '.o.', 'JJJ', '.o.', '...', '...', '...', '...', '...']),
  p('d3-full-bar', 3, ANY, ['...', '...', '...', 'ccc', '...', 'SSS', '...', '...', '...', '...', '...', '...']),
  p('d3-corridor-hurdle', 3, ANY, ['...', '...', 'W.W', 'WcW', 'WcW', 'WJW', 'W.W', 'W.W', 'W.W', '...', '...', '...']),
  p('d3-mixed-row', 3, ANY, ['...', '...', 'c..', 'c..', '...', 'JSW', '...', '.c.', '...', '...', '...', '...']),
  p('d3-street-train', 3, ['street'], ['...', 'W..', 'W.J', 'W..', 'WW.', 'WWc', 'WWc', 'WW.', 'W..', '...', '...', '...']),
  p('d3-chicane', 3, ANY, ['...', '...', 'W.W', 'WcW', 'W.W', '.c.', '.W.', 'cW.', '.W.', '...', '...', '...']),
  p('d3-park-logs', 3, ['park'], ['...', '...', '...', 'S.J', '...', '.c.', '..c', 'JS.', '...', '...', '...', '...']),

  p('d4-forced-then-lane', 4, ANY, ['...', '...', 'WW.', 'WW.', 'WWc', 'WWc', '...', '...', 'JJJ', '...', '...', '...']),
  p('d4-park-double', 4, ['park'], ['...', '...', '...', '...', '.SS', 'c..', 'c..', '..c', 'JJ.', '...', '...', '...']),
  p('d4-corridor-slide', 4, ANY, ['...', '...', 'WW.', 'WWc', 'WW.', 'WWS', 'WW.', 'WWc', '...', '...', '...', '...']),
  p('d4-street-weave', 4, ['street'], ['...', '..W', '..W', 'W..', 'WJ.', 'W.c', '..W', '.cW', '..W', '...', '...', '...']),

  p('d5-slide-corridor', 5, ANY, ['...', 'W.W', 'WcW', 'WcW', 'WcW', 'W.W', '...', '...', 'SSS', '...', '...', '...']),
  p('d5-mixed-weave', 5, ANY, ['...', '...', '.W.', 'JW.', '.W.', '.W.', '...', '...', 'WSJ', '...', '...', '...']),
  p('d5-park-maze', 5, ['park'], ['...', '.W.', 'JW.', '.W.', '.W.', '.W.', 'SWJ', '.W.', '.W.', '...', '...', '...']),
  p('d5-street-rush', 5, ['street'], ['...', 'W..', 'W..', 'WS.', 'W.W', 'W.W', 'W..', 'WJ.', 'W..', '...', '...', '...']),
];

const KIND: Record<string, ObstacleKind> = { J: 'jump', S: 'slide', W: 'wall' };
const LANES: readonly Lane[] = [-1, 0, 1];

/** Grid → local-z geometry. Throws on malformed grids (caught by patterns.spec.ts). */
export function parsePattern(pattern: Pattern): ParsedPattern {
  const { rowLength, chunkLength } = simConfig.world;
  const nRows = chunkLength / rowLength;
  if (pattern.rows.length !== nRows) throw new Error(`${pattern.id}: needs ${nRows} rows`);
  const near = [...pattern.rows].reverse();
  const out: ParsedPattern = { obstacles: [], coins: [], pickupSpots: [], forced: [] };
  near.forEach((row, r) => {
    if (!/^[.JSWcoP]{3}$/.test(row)) throw new Error(`${pattern.id}: bad row "${row}"`);
    const zMid = r * rowLength + rowLength / 2;
    if ([...row].every((ch) => ch in KIND)) out.forced.push(zMid);
    LANES.forEach((lane, col) => parseCell(out, near, r, col, lane, zMid));
  });
  return out;
}

function parseCell(
  out: ParsedPattern,
  near: string[],
  r: number,
  col: number,
  lane: Lane,
  zMid: number,
): void {
  const { rowLength } = simConfig.world;
  const ch = near[r]![col]!;
  if (ch === 'W') {
    if (near[r - 1]?.[col] === 'W') return; // merged into the wall that starts in an earlier row
    let len = 0;
    while (near[r + len]?.[col] === 'W') len++;
    out.obstacles.push({ lane, z: r * rowLength, len: len * rowLength, kind: 'wall' });
  } else if (ch === 'J' || ch === 'S') {
    const kind = ch === 'J' ? 'jump' : 'slide';
    const depth = simConfig.obstacles[kind].depth;
    out.obstacles.push({ lane, z: zMid - depth / 2, len: depth, kind });
  } else if (ch === 'c' || ch === 'o') {
    const y = ch === 'c' ? simConfig.coins.groundY : simConfig.coins.highY;
    out.coins.push({ lane, z: zMid - rowLength / 4, y }, { lane, z: zMid + rowLength / 4, y });
  } else if (ch === 'P') {
    out.pickupSpots.push({ lane, z: zMid });
  }
}

const parsed = new Map<string, ParsedPattern>();
export function parsedPattern(pattern: Pattern): ParsedPattern {
  let hit = parsed.get(pattern.id);
  if (!hit) parsed.set(pattern.id, (hit = parsePattern(pattern)));
  return hit;
}
