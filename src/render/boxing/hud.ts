// Boxing DOM HUD, one per player: both stamina pies (you / opponent, 10 segments like Wii Sports),
// knockdowns, round + clock, dizzy, the referee count, round/intro cards and the result.
import { boxingConfig as C } from '../../core/boxing/boxing.config';
import { refereeCount } from '../../core/boxing/sim';
import type { Boxer, BoxerId, BoxingState } from '../../core/boxing/types';
import type { HudExtras } from '../hud';

const CSS = `
.bhud { position: absolute; inset: 0; pointer-events: none; font: 600 18px/1.3 system-ui, sans-serif;
  color: #fff; text-shadow: 0 2px 4px #0008; }
.bhud .side { position: absolute; top: 16px; display: grid; justify-items: center; gap: 4px; }
.bhud .me { left: 20px; } .bhud .them { right: 20px; }
.bhud .pie { width: 72px; height: 72px; border-radius: 50%; border: 3px solid #fff; }
.bhud .clock { position: absolute; top: 16px; left: 0; right: 0; text-align: center; font-size: 26px; }
.bhud .tracking { position: absolute; bottom: 16px; left: 20px; font-size: 14px; padding: 4px 10px;
  border-radius: 12px; background: #0006; }
.bhud .tracking.bad { background: #c1121fcc; }
.bhud .center { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; }
.bhud .big { font-size: 96px; }
.bhud .card { background: #1d3557e6; padding: 24px 40px; border-radius: 16px; font-size: 22px; }
.bhud .card h2 { margin: 0 0 12px; font-size: 32px; }
`;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Conic-gradient pie: filled segments in `color`, lost ones dark, knockdown losses grey. */
function pie(b: Boxer, color: string): string {
  const seg = 360 / C.stamina.segments;
  const full = b.stamina * seg;
  const max = b.max * seg;
  const gradient = `conic-gradient(${color} 0 ${full}deg, #0009 ${full}deg ${max}deg, #555 ${max}deg)`;
  return `<div class="pie" style="background:${gradient}"></div>`;
}

function side(b: Boxer, label: string, color: string, fighting: boolean): string {
  const dizzy = b.dizzy && fighting;
  const kd = b.knockdowns > 0 ? ` · ⬇${b.knockdowns}` : '';
  return `${pie(b, color)}<div>${label}${kd}</div>${dizzy ? '<div>💫 dizzy</div>' : ''}`;
}

export function mountBoxingHud(root: HTMLElement, me: BoxerId) {
  const el = document.createElement('div');
  el.className = 'hud bhud';
  el.innerHTML = `<style>${CSS}</style><div class="side me"></div><div class="side them"></div>
    <div class="clock"></div><div class="tracking"></div><div class="center"></div>`;
  root.append(el);
  const part = (c: string) => el.querySelector<HTMLElement>(c)!;
  const parts = {
    me: part('.me'),
    them: part('.them'),
    clock: part('.clock'),
    tracking: part('.tracking'),
    center: part('.center'),
  };
  const last = new Map<HTMLElement, string>();
  const write = (node: HTMLElement, html: string): void => {
    if (last.get(node) === html) return;
    last.set(node, html);
    node.innerHTML = html;
  };
  const them: BoxerId = me === 0 ? 1 : 0;

  return {
    update(s: Readonly<BoxingState>, extras: HudExtras): void {
      write(
        parts.me,
        side(
          s.boxers[me],
          esc(extras.names[me] ?? 'You'),
          me === 0 ? '#e63946' : '#2a6fdb',
          s.phase === 'fight',
        ),
      );
      write(
        parts.them,
        side(
          s.boxers[them],
          esc(extras.names[them] ?? 'CPU'),
          them === 0 ? '#e63946' : '#2a6fdb',
          s.phase === 'fight',
        ),
      );
      const secs = Math.ceil(Math.max(0, s.roundT));
      write(
        parts.clock,
        `Round ${s.round}/${C.phases.rounds} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
      );
      parts.tracking.classList.toggle('bad', !extras.trackingOk);
      write(parts.tracking, extras.tracking);
      write(parts.center, centerHtml(s, me, extras));
    },
  };
}

function centerHtml(s: Readonly<BoxingState>, me: BoxerId, extras: HudExtras): string {
  switch (s.phase) {
    case 'intro':
      if (extras.waiting)
        return `<div class="card"><h2>Get ready</h2>Stand still to calibrate · or press any game key<br>
          Punch: throw a fist · Guard: fists to your chin · Dodge: lean or duck</div>`;
      return `<div class="big">${s.phaseT > 0.6 ? `Round ${s.round}` : 'FIGHT!'}</div>`;
    case 'break':
      return `<div class="card"><h2>End of round ${s.round - 1}</h2>Round ${s.round} in ${Math.ceil(s.phaseT)}</div>`;
    case 'down':
      return `<div class="big">${refereeCount(s) || ''}</div>`;
    case 'paused':
      return `<div class="card"><h2>Paused</h2>Step back into frame</div>`;
    case 'over': {
      const title = s.winner === null ? 'Draw' : s.winner === me ? 'You win!' : 'You lose';
      const how =
        s.result === 'decision' ? 'on points' : s.result === 'draw' ? '' : `by ${s.result}`;
      const [a, b] = [s.boxers[me], s.boxers[me === 0 ? 1 : 0]];
      return `<div class="card results"><h2>${title} ${how}</h2>
        (you – opponent)<br>Knockdowns scored ${b.knockdowns} – ${a.knockdowns}<br>
        Clean hits ${a.landed} – ${b.landed}<br>
        Best ${Math.max(extras.best, a.landed)} hits<br><br>Jump (or Space) to play again</div>`;
    }
    default:
      return '';
  }
}
