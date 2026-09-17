// Stats pages in the menu: pick a player and a game → record (W/L/D), a strip of recent results, one
// small chart per recorded stat across matches, and the latest matches as a table (the accessible
// view of the same numbers).
import { mountLineChart, statLabel } from './line-chart';
import type { MatchRecord, ProfileStore } from './profile-store';

const CSS = `
.stats-page { display: grid; gap: 14px; justify-items: center; max-height: calc(100vh - 32px);
  overflow: auto; padding: 8px 16px; font-size: 18px; }
.stats-page .charts { display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; max-width: 1200px; }
.stats-page .chart { margin: 0; padding: 10px; border-radius: 12px; background: #1b1f3b; }
.stats-page figcaption { text-align: left; font-size: 16px; margin-bottom: 4px; }
.stats-page .readout { max-width: 360px; min-height: 2.8em; text-align: left; font: 500 13px/1.4 system-ui; color: #ffffffb3; }
.stats-page .results { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; }
.stats-page .res { width: 26px; height: 26px; border-radius: 6px; display: grid; place-content: center;
  font: 700 14px system-ui; color: #fff; }
.stats-page .res.win { background: #0ca30c; } .stats-page .res.loss { background: #d03b3b; }
.stats-page .res.draw { background: #555; }
.stats-page table { border-collapse: collapse; font: 500 14px system-ui; }
.stats-page th, .stats-page td { padding: 4px 10px; border-bottom: 1px solid #fff2; text-align: right; }
.stats-page th:first-child, .stats-page td:first-child { text-align: left; }
`;
const RECENT = 20;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function mountStats<G extends { id: string; title: string }>(
  page: HTMLElement,
  profiles: ProfileStore,
  games: readonly G[],
  back: () => void,
): void {
  const names = profiles.names();
  let player = names[0] ?? null;
  let game = games.find((g) => player && profiles.matches(player, g.id).length) ?? games[0]!;
  const render = (): void => {
    const matches = player ? profiles.matches(player, game.id) : [];
    page.innerHTML = `<style>${CSS}</style><div class="stats-page"><h2>Stats</h2>
      <div class="row">${names
        .map(
          (n) =>
            `<button data-stats-player="${esc(n)}" aria-pressed="${n === player}">${esc(n)}</button>`,
        )
        .join('')}</div>
      <div class="row">${games
        .map(
          (g) =>
            `<button data-stats-game="${esc(g.id)}" aria-pressed="${g.id === game.id}">${esc(g.title)}</button>`,
        )
        .join('')}</div>
      ${player ? summaryHtml(player, game.title, matches) : '<p>No players yet: play a match first.</p>'}
      <div class="charts"></div>${tableHtml(matches)}
      <div class="row"><button data-nav="back">Back</button></div></div>`;
    const charts = page.querySelector<HTMLElement>('.charts')!;
    for (const key of statKeys(matches))
      mountLineChart(
        charts,
        statLabel(key),
        matches.map((m, i) => point(m, i, key)),
      );
    page
      .querySelectorAll<HTMLButtonElement>('[data-stats-player]')
      .forEach((b) => (b.onclick = () => ((player = b.dataset.statsPlayer!), render())));
    page
      .querySelectorAll<HTMLButtonElement>('[data-stats-game]')
      .forEach(
        (b) =>
          (b.onclick = () => ((game = games.find((g) => g.id === b.dataset.statsGame)!), render())),
      );
    page.querySelector<HTMLButtonElement>('[data-nav="back"]')!.onclick = back;
  };
  render();
}

/** Stat keys in first-seen order (a game can add a stat later; old matches just lack it). */
const statKeys = (matches: readonly MatchRecord[]): string[] => [
  ...new Set(matches.flatMap((m) => Object.keys(m.stats))),
];

function point(m: MatchRecord, i: number, key: string) {
  const value = m.stats[key] ?? 0;
  const vs = m.opponent ? ` vs ${m.opponent}` : '';
  const result = m.result ? ` (${m.result})` : '';
  return {
    value,
    label: `${value} ${statLabel(key)} · match ${i + 1}${vs}${result} · ${when(m.at)}`,
  };
}

function summaryHtml(player: string, title: string, matches: readonly MatchRecord[]): string {
  if (matches.length === 0) return `<p>${esc(player)} hasn't played ${esc(title)} yet.</p>`;
  const count = (r: MatchRecord['result']) => matches.filter((m) => m.result === r).length;
  const [w, l, d] = [count('win'), count('loss'), count('draw')];
  const decided = w + l + d;
  const record = decided
    ? ` · ${w} W – ${l} L – ${d} D · win rate ${Math.round((100 * w) / decided)} %`
    : '';
  const strip = matches
    .slice(-RECENT)
    .filter((m) => m.result)
    .map(
      (m) =>
        `<span class="res ${m.result}" title="${m.result}">${m.result![0]!.toUpperCase()}</span>`,
    )
    .join('');
  return `<p>${esc(player)} · ${esc(title)}: ${matches.length} ${matches.length === 1 ? 'match' : 'matches'}${record}</p>
    ${strip ? `<div class="results" aria-label="Last results, oldest first">${strip}</div>` : ''}`;
}

function tableHtml(matches: readonly MatchRecord[]): string {
  if (matches.length === 0) return '';
  const keys = statKeys(matches);
  const rows = matches
    .map((m, i) => ({ m, n: i + 1 }))
    .slice(-10)
    .reverse()
    .map(
      ({ m, n }) =>
        `<tr><td>${n}. ${esc(when(m.at))}${m.opponent ? ` vs ${esc(m.opponent)}` : ''}</td><td>${m.result ?? '–'}</td>${keys
          .map((k) => `<td>${m.stats[k] ?? '–'}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<table><caption>Latest matches</caption><thead><tr><th>Match</th><th>Result</th>${keys
    .map((k) => `<th>${esc(statLabel(k))}</th>`)
    .join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}
