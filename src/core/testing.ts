// Test helpers: hand-built worlds and a bot-driven run loop for core specs.
import { createBot, type BotOptions } from './bot';
import type { InputEventType } from './input';
import { EMPTY_PATTERN, type Pattern } from './patterns';
import { createContext, initState, tick, type SimOptions } from './sim';
import type { SimState } from './types';
import { buildChunk, type ChunkSource } from './worldgen';

const noPickups = (): number => 0.99;

/** Chunk `index` → grid rows (far → near, as in patterns.ts); every other chunk is empty. */
export function worldOf(grids: Record<number, readonly string[]>): ChunkSource {
  return (_seed, index) => {
    const rows = grids[index];
    const pattern: Pattern = rows
      ? { id: `test-${index}-${rows.join('')}`, difficulty: 1, biomes: ['street'], rows }
      : EMPTY_PATTERN;
    return buildChunk(index, pattern, noPickups, 'street');
  };
}

/** A world that repeats one pattern at `index` with empty chunks around it. */
export const isolated =
  (pattern: Pattern, index: number): ChunkSource =>
  (_seed, i) =>
    buildChunk(i, i === index ? pattern : EMPTY_PATTERN, noPickups, 'street');

/** Run with the bot until `until(state)` or the run stops. Returns the final state. */
export function botRun(
  opts: SimOptions,
  until: (s: SimState) => boolean,
  botOpts?: BotOptions,
  onTick?: (s: SimState, events: readonly InputEventType[]) => void,
): SimState {
  const ctx = createContext(opts);
  const s = initState(opts, ctx);
  const bot = createBot(ctx, botOpts);
  while (!until(s) && s.phase !== 'over' && s.phase !== 'crashed') {
    const events = bot.act(s);
    onTick?.(s, events);
    tick(
      s,
      ctx,
      events.map((type) => ({ type })),
    );
  }
  return s;
}
