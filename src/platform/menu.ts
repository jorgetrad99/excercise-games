// Game-select menu: a plain DOM overlay listing registered MiniGames (no art pass yet).
export function mountMenu<G extends { id: string; title: string }>(
  root: HTMLElement,
  games: readonly G[],
  onPick: (game: G) => void,
): void {
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = `<style>.menu { position: fixed; inset: 0; display: grid; place-content: center;
    gap: 12px; font: 600 20px system-ui, sans-serif; color: #fff; text-align: center; }
    .menu button { font: inherit; padding: 12px 40px; }</style><h1>Move Arcade</h1>`;
  for (const game of games) {
    const button = document.createElement('button');
    button.textContent = game.title;
    button.dataset.game = game.id;
    button.onclick = () => {
      el.remove();
      onPick(game);
    };
    el.append(button);
  }
  root.append(el);
  el.querySelector('button')?.focus();
}
