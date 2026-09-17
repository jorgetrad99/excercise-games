// Claude Code reads its project config from the checkout a session starts in, not from main, so a
// branch that hasn't merged main (or an edit made outside Claude) silently changes what the hooks
// enforce (PROGRESS 2026-09-17, config read per checkout). Called by the Stop hook.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const GUARDED = ['.claude/settings.json', '.claude/hooks', 'AGENTS.md'];
const WATCHED = [...GUARDED, 'CLAUDE.md', '.claude/agents', '.claude/commands'];

export function configDrift(cwd) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const lines = (s) => s.split('\n').filter(Boolean);
  const warnings = [];
  if (existsSync(join(cwd, '.claude', 'settings.local.json'))) {
    warnings.push(
      '.claude/settings.local.json exists — it can add hooks and permissions and no merge removes it. Review it, delete it by hand, then restart.',
    );
  }
  let main;
  try {
    main = git('rev-parse', '--short', 'main');
  } catch {
    return warnings; // no main to compare against
  }
  const differs = [
    ...lines(git('diff', '--name-only', 'main', '--', ...WATCHED)),
    ...lines(git('ls-files', '--others', '--exclude-standard', '--', ...WATCHED)),
  ];
  const behind = [];
  for (const f of differs) {
    const last = git('log', '-1', '--format=%H', 'main', '--', f);
    let hasMainVersion = !last;
    try {
      if (last) hasMainVersion = git('merge-base', '--is-ancestor', last, 'HEAD') === '';
    } catch {
      hasMainVersion = false; // not an ancestor
    }
    if (!hasMainVersion) behind.push(f);
    else if (GUARDED.some((g) => f === g || f.startsWith(`${g}/`))) {
      warnings.push(
        `${f} differs from main but is human-owned — restore it with \`git checkout main -- ${f}\` and restart, or have Jorge land the change on main.`,
      );
    } else {
      warnings.push(
        `${f} differs from main — sessions in this checkout use this branch's version; land it on main or restore it with \`git checkout main -- ${f}\`.`,
      );
    }
  }
  if (behind.length) {
    warnings.unshift(`${behind.join(', ')} differ from main — merge ${main} (main) and restart the session.`);
  }
  return warnings;
}
