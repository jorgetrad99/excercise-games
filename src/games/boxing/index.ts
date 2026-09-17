// Boxing (Piece 4): Wii Sports Boxing rules on full-body pose. One shared sim for both boxers;
// in 1P the opponent (boxer 1) is the reactive bot. Wraps core/boxing and render/boxing.
import { boxingConfig } from '../../core/boxing/boxing.config';
import { boxingBot } from '../../core/boxing/bot';
import { createBoxingSim, type BoxingSim } from '../../core/boxing/sim';
import type { BoxerId } from '../../core/boxing/types';
import { gestureConfig } from '../../pose/gestures.config';
import { mountBoxingHud } from '../../render/boxing/hud';
import { createBoxingView } from '../../render/boxing/view';
import { defineGame } from '../types';
import { BOXING_GESTURES, BOXING_KEYS } from './gestures';

export default defineGame<BoxingSim>({
  id: 'boxing',
  title: 'Boxing',
  requiredSignals: ['fistL', 'fistR', 'leanX', 'headDrop'],
  faces: true, // "cabezota": big heads wearing the players' faces
  gestureProfile: { toInput: BOXING_GESTURES, config: gestureConfig },
  keys: BOXING_KEYS,
  fixedDt: boxingConfig.fixedDt,
  sharedSim: true, // players face off in one state

  createSim: (seed, { autoplay, players }) => {
    const bots: BoxerId[] = [];
    if (autoplay) bots.push(0);
    if (players < 2) bots.push(1);
    return createBoxingSim({ seed }, bots.length > 0 ? boxingBot(bots) : null);
  },

  createView: (canvas, faces) => createBoxingView(canvas, faces),

  mountHud: (root, player) => {
    const hud = mountBoxingHud(root, player === 1 ? 1 : 0);
    return { update: (sim, extras) => hud.update(sim.getState(), extras) };
  },

  summary: (sim, player) => {
    const s = sim.getState();
    return { started: s.tick > 0, over: s.phase === 'over', score: s.boxers[player]?.landed ?? 0 };
  },

  matchStats: (sim, player) => {
    const s = sim.getState();
    const me = player === 1 ? 1 : 0;
    const [mine, theirs] = [s.boxers[me], s.boxers[me === 0 ? 1 : 0]];
    return {
      result: s.winner === null ? 'draw' : s.winner === me ? 'win' : 'loss',
      stats: {
        cleanHits: mine.landed,
        hitsTaken: theirs.landed,
        knockdownsScored: theirs.knockdowns,
        knockdownsTaken: mine.knockdowns,
        rounds: s.round,
      },
    };
  },
});
