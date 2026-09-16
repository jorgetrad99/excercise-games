// Skate Run behind the MiniGame contract. Wraps core/ (sim, bot) and render/ (view, HUD) where they
// live; moving them into this folder is deferred until a second game needs the space (Phase 2, option A).
import { createBot } from '../../core/bot';
import { createGameSim, type GameSim } from '../../core/sim';
import { simConfig } from '../../core/sim.config';
import { gestureConfig } from '../../pose/gestures.config';
import { mountHud } from '../../render/hud';
import { renderPose } from '../../render/interp';
import { loadModels } from '../../render/models';
import { createGameView } from '../../render/view';
import type { MiniGame } from '../types';
import { SKATE_GESTURES } from './gestures';

export const skateRun: MiniGame<GameSim> = {
  id: 'skate-run',
  title: 'Skate Run',
  requiredSignals: ['leanX', 'zone', 'hipRise', 'hipRiseVel', 'headDrop'],
  gestureProfile: { toInput: SKATE_GESTURES, config: gestureConfig },
  fixedDt: simConfig.fixedDt,

  createSim(seed, { reviveTokens, autoplay }) {
    const sim = createGameSim({ seed, reviveTokens });
    if (autoplay) sim.setController(createBot(sim.context).act);
    return sim;
  },

  async createView(canvas) {
    const view = createGameView(canvas, await loadModels());
    return {
      render(sims, interpolate) {
        // One scene for everyone: world and skater are rebuilt from each player's state before their slot.
        const poses = sims.map((sim, index) => {
          const state = sim.getState();
          const pose = renderPose(state, sim.previous(), interpolate ? sim.alpha() : 0);
          view.render(state, pose, { index, count: sims.length });
          return pose;
        });
        const state = sims[0]!.getState();
        const drawn = poses[0]!;
        if (state.phase !== 'running') return null;
        const changingLane = Math.abs(state.targetLane * simConfig.world.laneWidth - drawn.x) > 0.3;
        return {
          ...drawn,
          speed: state.speed,
          lateralSpeed: changingLane ? simConfig.player.laneSpeed : 0,
        };
      },
      stats: () => view.stats(),
    };
  },

  mountHud(root) {
    const hud = mountHud(root);
    return { update: (sim, extras) => hud.update(sim.getState(), extras) };
  },

  summary(sim) {
    const s = sim.getState();
    return { started: s.tick > 0, over: s.phase === 'over', score: s.score };
  },
};
