import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Stop hook warns when this checkout's Claude config differs from main, naming the file and the
// fix, because Claude Code reads that config per checkout (PROGRESS 2026-09-17).
const HOOK = resolve('.claude/hooks/remind-progress-log.mjs');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

function commit(root: string, msg: string): void {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', msg);
}

/** A repo with main and a `feature` branch cut from it; PROGRESS.md is dirty so only drift lines differ. */
function repo(trunk = 'main'): string {
  const root = mkdtempSync(join(tmpdir(), 'drift-'));
  git(root, 'init', '-q', '-b', trunk);
  write(root, '.claude/settings.json', '{"v":1}\n');
  write(root, 'AGENTS.md', 'rules\n');
  write(root, '.claude/commands/verify.md', 'verify\n');
  commit(root, 'config');
  git(root, 'checkout', '-q', '-b', 'feature');
  return root;
}

function stop(root: string): string {
  const r = spawnSync(process.execPath, [HOOK], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    cwd: root,
    encoding: 'utf8',
  });
  expect(r.status).toBe(0);
  return r.stdout ? (JSON.parse(r.stdout) as { systemMessage: string }).systemMessage : '';
}

describe('config drift warning (Stop hook)', () => {
  it('says nothing when the checkout matches main', () => {
    expect(stop(repo())).not.toContain('Config drift');
  });

  it('a branch behind main is told which commit to merge', () => {
    const root = repo();
    git(root, 'checkout', '-q', 'main');
    write(root, '.claude/settings.json', '{"v":2}\n');
    commit(root, 'new settings');
    const sha = git(root, 'rev-parse', '--short', 'main');
    git(root, 'checkout', '-q', 'feature');
    expect(stop(root)).toContain(
      `Config drift: .claude/settings.json differ from main — merge ${sha} (main) and restart the session.`,
    );
  });

  it('a human-owned file changed on the branch says to restore it', () => {
    const root = repo();
    write(root, 'AGENTS.md', 'weaker rules\n');
    expect(stop(root)).toContain(
      'AGENTS.md differs from main but is human-owned — restore it with `git checkout main -- AGENTS.md`',
    );
  });

  it('a watched, not guarded, file changed on the branch is named with its fix', () => {
    const root = repo();
    write(root, '.claude/commands/verify.md', 'old verify\n');
    commit(root, 'branch verify');
    expect(stop(root)).toContain(
      ".claude/commands/verify.md differs from main — sessions in this checkout use this branch's version",
    );
  });

  it('settings.local.json existing always warns, even when nothing else differs', () => {
    const root = repo();
    write(root, '.claude/settings.local.json', '{}\n');
    expect(stop(root)).toContain(
      '.claude/settings.local.json exists — it can add hooks and permissions',
    );
  });

  it('with no main branch the hook still exits 0 without drift lines', () => {
    expect(stop(repo('trunk'))).not.toContain('Config drift');
  });
});
