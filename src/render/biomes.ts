// Biome look (PLAN §2.3): palette, fog and which Kenney models dress the track. Flat Kenney style
// (PLAN §8 Q4 default; Jorge can override). Colours are sRGB hex.
import type { BiomeId } from '../core/types';
import type { ModelId } from './models';

export interface BiomeLook {
  sky: string;
  fogNear: number;
  fogFar: number;
  road: string;
  roadLine: string;
  ground: string;
  hemiSky: string;
  hemiGround: string;
  /** Obstacle models per sim class. `wall` is repeated along the wall's length. */
  jump: ModelId;
  slide: ModelId;
  wall: { model: ModelId; segment: number };
  /** Roadside props, picked per slot by a hash of (chunk, slot). */
  props: readonly ModelId[];
  /** Big backdrop blocks either side (buildings / hedges), one colour picked per block. */
  blocks: readonly string[];
  blockHeight: [number, number];
}

export const BIOME_LOOKS: Record<BiomeId, BiomeLook> = {
  street: {
    sky: '#9fd3f2',
    fogNear: 40,
    fogFar: 190,
    road: '#4a4f5c',
    roadLine: '#f4f1e8',
    ground: '#b9b4a8',
    hemiSky: '#dff1ff',
    hemiGround: '#8a7f6f',
    jump: 'barrier',
    slide: 'gantry',
    wall: { model: 'delivery', segment: 5.5 },
    props: ['lamp', 'lamp', 'beacon'],
    blocks: ['#e07a5f', '#f2cc8f', '#81b29a', '#3d405b', '#f4f1de', '#98c1d9'],
    blockHeight: [6, 22],
  },
  park: {
    sky: '#bfe6c8',
    fogNear: 35,
    fogFar: 170,
    road: '#8d6e53',
    roadLine: '#e9dcc0',
    ground: '#6fae5b',
    hemiSky: '#f3ffe8',
    hemiGround: '#4f7d3a',
    jump: 'log',
    slide: 'gantry',
    wall: { model: 'cliff', segment: 2 },
    props: ['tree', 'oak', 'tree', 'rock'],
    blocks: ['#4e8f3a', '#5fa044', '#3f7a2f'],
    blockHeight: [2, 5],
  },
};

/** Deterministic 0..1 hash for decoration choices (not gameplay). */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
