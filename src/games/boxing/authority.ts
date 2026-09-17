// Who drives each part of a boxer's rig, as a pure function of sim state (PLAN-BOXING §4). The render
// never decides a handover: it reads this. No three.js. Handover instants are sim ticks.
import { boxingConfig as C } from '../../core/boxing/boxing.config';
import { riseProgress } from '../../core/boxing/sim';
import type { BoxerId, BoxingState } from '../../core/boxing/types';

/** 'player': the live body (+ §2.2 offsets); 'sim': a sim clip; 'script': an authored posture/path;
 *  { blend }: script → player, `player` = the player's weight 0…1. */
export type Owner = 'player' | 'sim' | 'script' | { blend: number };

/** Table rows implemented so far. BREAK = S8–S10 until the trainer (M7.19): the player keeps the rig.
 *  PUPPET = no body (§2.4): keyboard, bot, stale pose; the sim animates it, which isn't an override. */
export type AuthorityState =
  'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S11' | 'S12' | 'S13' | 'BREAK' | 'PUPPET';

export interface Authority {
  state: AuthorityState;
  root: Owner;
  rootY: Owner;
  legs: Owner;
  hips: Owner;
  torso: Owner;
  head: Owner;
  arms: Owner;
  camera: Owner;
  /** Overlays allowed on player-owned channels this tick (§2.2): O1 hit reaction, O2 stunned. */
  overlays: { hit: boolean; stun: boolean };
}

const K = C.knockdown;
const EPS = 1e-9;

function rows(
  state: AuthorityState,
  base: Owner,
  upper: Owner,
  camera: Owner = 'player',
): Authority {
  return {
    state,
    root: base,
    rootY: base,
    legs: base,
    hips: upper,
    torso: upper,
    head: upper,
    arms: upper,
    camera,
    overlays: { hit: state === 'S2' || state === 'S3', stun: state === 'S3' },
  };
}

function downRow(s: Readonly<BoxingState>): Authority {
  if (s.phaseT < K.fallS - EPS) return rows('S4', 'sim', 'sim', 'sim');
  const rise = riseProgress(s);
  if (rise === null) return rows('S5', 'script', 'player');
  return rows('S6', { blend: rise }, 'player', { blend: rise });
}

/** BX-CAL-4: recalibration is accepted in every state except while this player's boxer is down
 *  (holding still on the canvas would fight getting up). */
export function canRecalibrate(s: Readonly<BoxingState>, player: number): boolean {
  const down = s.phase === 'down' || (s.phase === 'paused' && s.pausedFrom === 'down');
  return !(down && s.down?.boxer === player);
}

export function boxingAuthority(s: Readonly<BoxingState>, who: BoxerId): Authority {
  if (s.boxers[who].body.source === 'puppet') return rows('PUPPET', 'sim', 'sim', 'player');
  const phase = s.phase === 'paused' ? 'paused' : s.phase;
  switch (phase) {
    case 'intro':
      return rows('S1', 'player', 'player');
    case 'fight':
      return rows(s.boxers[who].dizzy ? 'S3' : 'S2', 'player', 'player');
    case 'down':
      return s.down?.boxer === who ? downRow(s) : rows('S2', 'player', 'player');
    case 'break':
      return rows('BREAK', 'player', 'player');
    case 'paused':
      return rows('S11', 'player', 'player');
    case 'over': {
      const ko = s.winner !== null && s.winner !== who && (s.result === 'KO' || s.result === 'TKO');
      return ko ? rows('S13', 'script', 'player') : rows('S12', 'player', 'player');
    }
  }
}
