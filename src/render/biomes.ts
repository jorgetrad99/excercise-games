// Biome look (PLAN §2.3): palette, fog and which models dress the track. Quaternius stylized low-poly
// (PLAN §8 Q4: Jorge asked for Quaternius/KayKit over Kenney flat). Colours are sRGB hex.
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
  /** Obstacle models per sim class. */
  jump: ModelId;
  slide: ModelId;
  /** Walls ≥ 5 m: `long` models repeated every ~segment m; shorter walls: `short`. */
  wall: { long: readonly ModelId[]; segment: number; short: ModelId };
  /** Roadside props, picked per slot by a hash of (chunk, slot). */
  props: readonly ModelId[];
  /** Backdrop beyond the sidewalk (buildings / trees), scaled to backdropHeight. */
  backdrop: readonly ModelId[];
  backdropHeight: [number, number];
}

export const BIOME_LOOKS: Record<BiomeId, BiomeLook> = {
  street: {
    sky: '#a8d8f0',
    fogNear: 45,
    fogFar: 190,
    road: '#3d4451',
    roadLine: '#f4f1e8',
    ground: '#c9c2b4',
    hemiSky: '#e6f4ff',
    hemiGround: '#8a7f6f',
    jump: 'barrier',
    slide: 'heightBar',
    wall: { long: ['bus', 'schoolBus'], segment: 9, short: 'container' },
    props: [
      'streetlight',
      'streetlight',
      'trafficLight',
      'signStop',
      'signNoParking',
      'car1',
      'taxi',
      'suv',
      'car2',
    ],
    backdrop: ['building2', 'building3', 'building4', 'house2'],
    backdropHeight: [9, 20],
  },
  park: {
    sky: '#c4ead0',
    fogNear: 35,
    fogFar: 170,
    road: '#9c7a5b',
    roadLine: '#efe3c8',
    ground: '#78b35f',
    hemiSky: '#f3ffe8',
    hemiGround: '#4f7d3a',
    jump: 'log',
    slide: 'beam',
    wall: { long: ['bush', 'bushFlowers'], segment: 2.5, short: 'bush' },
    props: ['maple1', 'birch', 'flowers', 'bushFlowers', 'flowers'],
    backdrop: ['maple1', 'maple3', 'birch'],
    backdropHeight: [6, 10],
  },
};

/** Deterministic 0..1 hash for decoration choices (not gameplay). */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
