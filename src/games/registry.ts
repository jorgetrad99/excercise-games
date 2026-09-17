// Registered MiniGames, in menu order. Each game folder default-exports its defineGame() registration
// (AGENTS §6: the one allowed default export); this is the only file that imports game folders.
import boxing from './boxing';
import type { RegisteredGame } from './types';
import skateRun from './skate-run';

export const GAMES: readonly RegisteredGame[] = [skateRun, boxing];
