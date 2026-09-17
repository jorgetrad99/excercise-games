// Game-select menu: a DOM overlay with a player-count choice and one button per registered MiniGame,
// then "Who's playing?" (each slot claims a name), plus the stats pages. Mouse/keyboard click the
// buttons; with the camera on, each player's raised hand is a cursor that selects a button by
// hovering over it for cursor.dwellMs (Kinect dashboard style). A slot's name buttons only answer
// to that slot's cursor: the body on the left claims "Left player", the body on the right "Right".
import { createDwell, type Cursor } from '../pose/hand-cursor';
import { cleanName, type ProfileStore } from './profile-store';
import { mountStats } from './stats-view';

const CSS = `
.menu { position: fixed; inset: 0; display: grid; place-content: center; gap: 16px; overflow: auto;
  font: 600 28px system-ui, sans-serif; color: #fff; text-align: center; }
.menu .page { display: grid; gap: 16px; justify-items: center; }
.menu h1, .menu h2 { margin: 0; }
.menu button { font: inherit; padding: 20px 72px; border-radius: 14px; border: 3px solid #fff3;
  background: #2a3563; color: #fff; }
.menu button:hover:not(:disabled), .menu button.hovered { border-color: #fff; background: #3a4a8a; }
.menu button:disabled { opacity: 0.4; }
.menu .row { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-items: center; }
.menu .row button, .menu .slot button { padding: 12px 32px; }
.menu button[aria-pressed='true'] { background: #e9c46a; color: #1b1f3b; }
.menu .slots { display: flex; gap: 48px; flex-wrap: wrap; justify-content: center; }
.menu .slot { display: grid; gap: 10px; align-content: start; min-width: 280px; padding: 16px;
  border-radius: 16px; border: 3px solid var(--c); font-size: 22px; }
.menu .slot input { font: inherit; font-size: 20px; padding: 8px; border-radius: 8px; border: 0; width: 180px; }
.menu .cursor { position: fixed; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
  pointer-events: none; display: grid; place-content: center; font: 700 14px system-ui;
  background: conic-gradient(var(--c) calc(var(--p) * 360deg), #0006 0); box-shadow: 0 0 0 3px var(--c); }
.menu .cursor[hidden] { display: none; }
`;
const CURSOR_COLORS = ['#3ef', '#fb3'];
/** Names offered per slot besides typing one: recent players first. */
const NAME_CHOICES = 6;

export interface Menu {
  /** Latest hand cursors ([P1, P2], null = no raised hand) at time `t` (ms). */
  hover(cursors: readonly (Cursor | null)[], t: number): void;
}

interface MenuOptions {
  players?: 1 | 2;
  dwellMs: number;
  profiles: ProfileStore;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function mountMenu<G extends { id: string; title: string }>(
  root: HTMLElement,
  games: readonly G[],
  onPick: (game: G, players: 1 | 2, names: string[]) => void,
  { players = 1, dwellMs, profiles }: MenuOptions,
): Menu {
  const el = Object.assign(document.createElement('div'), { className: 'menu' });
  el.innerHTML = `<style>${CSS}</style><div class="page"></div>`;
  const page = el.querySelector<HTMLElement>('.page')!;
  root.append(el);

  const home = (): void => {
    page.innerHTML = `<h1>Move Arcade</h1>
      <div class="row">Players <button data-players="1">1</button><button data-players="2">2</button></div>
      ${games.map((g) => `<button data-game="${esc(g.id)}">${esc(g.title)}</button>`).join('')}
      <button data-nav="stats">Stats</button>`;
    const countButtons = [...page.querySelectorAll<HTMLButtonElement>('[data-players]')];
    const setPlayers = (n: 1 | 2): void => {
      players = n;
      countButtons.forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.players === `${n}`)),
      );
    };
    countButtons.forEach((b) => (b.onclick = () => setPlayers(b.dataset.players === '2' ? 2 : 1)));
    setPlayers(players);
    games.forEach((g) => {
      page.querySelector<HTMLButtonElement>(`[data-game="${g.id}"]`)!.onclick = () =>
        whoIsPlaying(page, g, players, profiles, home, (names) => {
          el.remove();
          profiles.setLastNames(names);
          onPick(g, players, names);
        });
    });
    page.querySelector<HTMLButtonElement>('[data-nav="stats"]')!.onclick = () =>
      mountStats(page, profiles, games, home);
    page.querySelector<HTMLButtonElement>('[data-game]')?.focus();
  };
  home();
  return { hover: hoverCursors(el, dwellMs) };
}

/** One name slot per player; Start once every slot has a distinct name. */
function whoIsPlaying<G extends { title: string }>(
  page: HTMLElement,
  game: G,
  count: 1 | 2,
  profiles: ProfileStore,
  back: () => void,
  start: (names: string[]) => void,
): void {
  // 1P preselects the last P1 (one human, nothing to mix up); 2P claims explicitly, because the
  // same two people may have swapped sides since last time.
  const chosen: (string | null)[] = count === 1 ? [profiles.lastNames()[0] ?? null] : [null, null];
  const extra: string[] = []; // names typed this visit
  const render = (): void => {
    const known = [...extra, ...profiles.names()];
    page.innerHTML = `<h2>Who's playing ${esc(game.title)}?</h2><div class="slots">${chosen
      .map((_, i) => slotHtml(i, count, known, chosen))
      .join('')}</div>
      <div class="row"><button data-nav="back">Back</button>
      <button data-nav="start" ${chosen.every((n) => n) ? '' : 'disabled'}>Start</button></div>`;
    page.querySelectorAll<HTMLButtonElement>('[data-name]').forEach((b) => {
      b.onclick = () => {
        chosen[Number(b.dataset.slot)] = b.dataset.name!;
        render();
      };
    });
    page.querySelectorAll<HTMLFormElement>('form').forEach((form) => {
      form.onsubmit = (e) => {
        e.preventDefault();
        const name = cleanName(new FormData(form).get('name')?.toString() ?? '');
        if (!name || chosen.includes(name)) return;
        if (!known.includes(name)) extra.unshift(name);
        chosen[Number(form.dataset.slot)] = name;
        render();
      };
    });
    page.querySelector<HTMLButtonElement>('[data-nav="back"]')!.onclick = back;
    page.querySelector<HTMLButtonElement>('[data-nav="start"]')!.onclick = () =>
      start(chosen as string[]);
  };
  render();
}

function slotHtml(i: number, count: number, known: string[], chosen: (string | null)[]): string {
  const label = count === 1 ? 'Player' : i === 0 ? 'Left player' : 'Right player';
  const fallback = `Player ${i + 1}`;
  const names = [
    ...new Set([...(chosen[i] ? [chosen[i]] : []), ...known.slice(0, NAME_CHOICES), fallback]),
  ];
  const buttons = names
    .map((n) => {
      const mine = chosen[i] === n;
      const taken = !mine && chosen.includes(n);
      return `<button data-slot="${i}" data-name="${esc(n)}" aria-pressed="${mine}" ${taken ? 'disabled' : ''}>${esc(n)}</button>`;
    })
    .join('');
  return `<div class="slot" style="--c:${CURSOR_COLORS[i]}"><div>${label}${count === 2 ? ` · P${i + 1}` : ''}</div>
    ${buttons}<form data-slot="${i}"><input name="name" maxlength="24" placeholder="New name" aria-label="New name for ${label}">
    <button type="submit">Add</button></form></div>`;
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
      let button = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>('.menu button');
      // Another slot's names, typing and disabled buttons don't answer to this hand.
      if (button && (button.disabled || button.closest('form'))) button = null;
      if (button?.dataset.slot !== undefined && button.dataset.slot !== `${i}`) button = null;
      button?.classList.add('hovered');
      const key = button ? hoverKey(button) : null;
      const { progress, fire } = dwell(t, key);
      dot.style.setProperty('--p', `${progress}`);
      if (fire) button!.click();
    });
  };
}

const hoverKey = (b: HTMLButtonElement): string =>
  Object.entries(b.dataset)
    .map(([k, v]) => `${k}=${v}`)
    .join('&') ||
  (b.textContent ?? '');
