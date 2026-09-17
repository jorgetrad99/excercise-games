import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// .claude/hooks/run-main.mjs runs hooks from main's committed tree whatever branch is checked out,
// failing closed for the guard and open for advisory hooks.
const LAUNCHER = resolve('.claude/hooks/run-main.mjs');
const GUARD = readFileSync(resolve('.claude/hooks/guard-paths.mjs'), 'utf8');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    stdio: 'pipe',
  });

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

/** A repo whose `branch` has permissive/other hooks checked out, while `trunk`'s commit has the real ones. */
function repo(trunk: string): string {
  const root = mkdtempSync(join(tmpdir(), 'run-main-'));
  git(root, 'init', '-q', '-b', trunk);
  write(root, '.claude/hooks/guard-paths.mjs', GUARD);
  write(root, '.claude/hooks/format-and-typecheck.mjs', "throw new Error('advisory crash');\n");
  write(root, '.claude/hooks/remind-progress-log.mjs', "console.log('main-version');\n");
  write(root, 'scripts/e2e-lock.mjs', 'export {};\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'hooks');
  git(root, 'checkout', '-q', '-b', 'feature');
  write(root, '.claude/hooks/guard-paths.mjs', 'process.exit(0);\n'); // a branch that lost the guard
  write(root, '.claude/hooks/remind-progress-log.mjs', "console.log('branch-version');\n");
  git(root, 'commit', '-q', '-am', 'weaker hooks');
  return root;
}

function run(root: string, hook: string, file = '') {
  const r = spawnSync(process.execPath, [LAUNCHER, hook], {
    input: JSON.stringify({ tool_input: { file_path: file } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    cwd: root,
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

describe('run-main launcher', () => {
  const root = repo('main');

  it("runs main's guard, not the checked-out branch's", () => {
    expect(run(root, 'guard-paths', join(root, 'docs', 'PLAN.md')).status).toBe(2);
    expect(run(root, 'guard-paths', join(root, 'src', 'core', 'sim.ts')).status).toBe(0);
    expect(run(root, 'remind-progress-log').out).toContain('main-version');
  });

  it('an advisory hook that crashes fails open', () => {
    expect(run(root, 'format-and-typecheck', join(root, 'a.ts')).status).toBe(0);
  });

  it('an unknown hook name is blocked', () => {
    expect(run(root, 'nope').status).toBe(2);
  });

  it('without a main branch: guard fails closed, advisory hooks fail open', () => {
    const noMain = repo('trunk');
    const guard = run(noMain, 'guard-paths', join(noMain, 'src', 'x.ts'));
    expect(guard.status).toBe(2);
    expect(guard.err).toMatch(/could not run from main/);
    expect(run(noMain, 'remind-progress-log').status).toBe(0);
  });
});
