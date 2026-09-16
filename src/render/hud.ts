// DOM HUD over the canvas (PLAN §4 M4): score, coins, multiplier, distance, power-up timers,
// tracking indicator, countdown/pause overlay, revive prompt, results card. Writes only on change.
import { simConfig } from '../core/sim.config';
import type { SimState } from '../core/types';

export interface HudExtras {
  /** e.g. "⌨ keyboard", "📷 tracking", "📷 step back into frame". */
  tracking: string;
  trackingOk: boolean;
  best: number;
  /** The run is held until calibration: show that instead of a frozen countdown. */
  waiting: boolean;
}

const CSS = `
.hud { position: fixed; inset: 0; pointer-events: none; font: 600 18px/1.3 system-ui, sans-serif;
  color: #fff; text-shadow: 0 2px 4px #0008; }
.hud .stats { position: absolute; top: 16px; right: 20px; text-align: right; }
.hud .stats b { font-size: 34px; display: block; }
.hud .powerups { position: absolute; top: 110px; right: 20px; text-align: right; font-size: 16px; }
.hud .tracking { position: absolute; bottom: 16px; left: 20px; font-size: 14px; padding: 4px 10px;
  border-radius: 12px; background: #0006; }
.hud .tracking.bad { background: #c1121fcc; }
.hud .center { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; }
.hud .big { font-size: 96px; }
.hud .card { background: #1d3557e6; padding: 24px 40px; border-radius: 16px; font-size: 22px; }
.hud .card h2 { margin: 0 0 12px; font-size: 32px; }
.hud .bar { height: 8px; background: #ffd166; border-radius: 4px; margin-top: 10px; }
`;

export interface Hud {
  update(s: Readonly<SimState>, extras: HudExtras): void;
}

export function mountHud(root: HTMLElement): Hud {
  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML = `<style>${CSS}</style><div class="stats"></div><div class="powerups"></div>
    <div class="tracking"></div><div class="center"></div>`;
  root.append(el);
  const parts = {
    stats: el.querySelector<HTMLElement>('.stats')!,
    powerups: el.querySelector<HTMLElement>('.powerups')!,
    tracking: el.querySelector<HTMLElement>('.tracking')!,
    center: el.querySelector<HTMLElement>('.center')!,
  };
  const last = new Map<HTMLElement, string>();
  const write = (node: HTMLElement, html: string): void => {
    if (last.get(node) === html) return;
    last.set(node, html);
    node.innerHTML = html;
  };

  return {
    update(s, extras) {
      write(
        parts.stats,
        `<b>${Math.floor(s.score)}</b>🪙 ${s.coins} · ×${s.multiplier}<br>${Math.floor(s.distance)} m`,
      );
      const timers = (['magnet', 'double', 'hoverboard'] as const)
        .filter((k) => s.powerups[k] > 0)
        .map((k) => `${LABEL[k]} ${Math.ceil(s.powerups[k])}s`);
      if (s.reviveTokens > 0) timers.push(`❤ ×${s.reviveTokens}`);
      write(parts.powerups, timers.join('<br>'));
      parts.tracking.classList.toggle('bad', !extras.trackingOk);
      write(parts.tracking, extras.tracking);
      write(parts.center, centerHtml(s, extras));
    },
  };
}

const LABEL = { magnet: '🧲 magnet', double: '✖2 coins', hoverboard: '🛹 hoverboard' } as const;

function centerHtml(s: Readonly<SimState>, extras: HudExtras): string {
  switch (s.phase) {
    case 'countdown':
      if (extras.waiting)
        return `<div class="card"><h2>Get ready</h2>Stand still to calibrate · or press any game key</div>`;
      return `<div class="big">${Math.ceil(s.phaseT)}</div>`;
    case 'paused':
      return `<div class="card"><h2>Paused</h2>Step back into frame</div>`;
    case 'crashed': {
      const pct = (100 * s.phaseT) / simConfig.revive.windowS;
      return `<div class="card"><h2>Revive?</h2>Raise both arms (or press Enter) · ❤ ×${s.reviveTokens}
        <div class="bar" style="width:${pct.toFixed(0)}%"></div></div>`;
    }
    case 'over':
      return `<div class="card results"><h2>Run over</h2>
        Distance ${Math.floor(s.distance)} m<br>Coins ${s.coins}<br>Score ${Math.floor(s.score)}<br>
        Best ${Math.floor(Math.max(extras.best, s.score))}<br><br>Jump (or Space) to play again</div>`;
    default:
      return '';
  }
}
