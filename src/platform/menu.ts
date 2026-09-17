// Game-select menu: a DOM overlay with a player-count choice and one button per registered MiniGame.
// Mouse/keyboard click the buttons; with the camera on, each player's raised hand is a cursor that
// selects a button by hovering over it for cursor.dwellMs (Kinect dashboard style).
import { createDwell, type Cursor } from '../pose/hand-cursor';

const CSS = `
.menu { position: fixed; inset: 0; display: grid; place-content: center; gap: 16px;
  font: 600 28px system-ui, sans-serif; color: #fff; text-align: center; }
.menu button { font: inherit; padding: 20px 72px; border-radius: 14px; border: 3px solid #fff3;
  background: #2a3563; color: #fff; }
.menu button:hover, .menu button.hovered { border-color: #fff; background: #3a4a8a; }
.menu .players { display: flex; gap: 12px; justify-content: center; align-items: center; }
.menu .players button { padding: 12px 32px; }
.menu .players button[aria-pressed='true'] { background: #e9c46a; color: #1b1f3b; }
.menu .cursor { position: fixed; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
  pointer-events: none; display: grid; place-content: center; font: 700 14px system-ui;
  background: conic-gradient(var(--c) calc(var(--p) * 360deg), #0006 0); box-shadow: 0 0 0 3px var(--c); }
.menu .cursor[hidden] { display: none; }
`;
const CURSOR_COLORS = ['#3ef', '#fb3'];

export interface Menu {
  /** Latest hand cursors ([P1, P2], null = no raised hand) at time `t` (ms). */
  hover(cursors: readonly (Cursor | null)[], t: number): void;
}

export function mountMenu<G extends { id: string; title: string }>(
  root: HTMLElement,
  games: readonly G[],
  onPick: (game: G, players: 1 | 2) => void,
  { players = 1, dwellMs }: { players?: 1 | 2; dwellMs: number },
): Menu {
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = `<style>${CSS}</style><h1>Move Arcade</h1>
    <div class="players">Players <button data-players="1">1</button><button data-players="2">2</button></div>`;
  const countButtons = [...el.querySelectorAll<HTMLButtonElement>('[data-players]')];
  const setPlayers = (n: 1 | 2): void => {
    players = n;
    countButtons.forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.players === `${n}`)),
    );
  };
  countButtons.forEach((b) => (b.onclick = () => setPlayers(b.dataset.players === '2' ? 2 : 1)));
  setPlayers(players);
  for (const game of games) {
    const button = document.createElement('button');
    button.textContent = game.title;
    button.dataset.game = game.id;
    button.onclick = () => {
      el.remove();
      onPick(game, players);
    };
    el.append(button);
  }
  root.append(el);
  el.querySelector<HTMLButtonElement>('[data-game]')?.focus();

  return { hover: hoverCursors(el, dwellMs) };
}

/** Per-player cursor dots; hovering a button for dwellMs clicks it. */
function hoverCursors(el: HTMLElement, dwellMs: number): Menu['hover'] {
  const cursors = CURSOR_COLORS.map((c, i) => {
    const dot = Object.assign(document.createElement('div'), {
      className: 'cursor',
      textContent: `P${i + 1}`,
      hidden: true,
    });
    dot.style.setProperty('--c', c);
    el.append(dot);
    return { dot, dwell: createDwell(dwellMs) };
  });
  return (points, t) => {
    if (!el.isConnected) return;
    el.querySelectorAll('.hovered').forEach((b) => b.classList.remove('hovered'));
    cursors.forEach(({ dot, dwell }, i) => {
      const p = points[i];
      dot.hidden = !p;
      if (!p) return void dwell(t, null);
      const [x, y] = [p.x * innerWidth, p.y * innerHeight];
      Object.assign(dot.style, { left: `${x}px`, top: `${y}px` });
      const button = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>('.menu button');
      button?.classList.add('hovered');
      const key = button ? (button.dataset.game ?? `players-${button.dataset.players}`) : null;
      const { progress, fire } = dwell(t, key);
      dot.style.setProperty('--p', `${progress}`);
      if (fire) button!.click();
    });
  };
}
