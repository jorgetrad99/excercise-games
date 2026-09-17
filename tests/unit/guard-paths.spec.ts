import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The guard must resolve human-owned paths against the checkout that contains the file. A worktree
// under tmp/ used to turn docs/PLAN.md into tmp/<wt>/docs/PLAN.md and pass (PROGRESS 2026-09-16).
const HOOK = resolve('.claude/hooks/guard-paths.mjs');

function guard(filePath: string, projectDir: string): number {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: 'utf8',
  });
  return r.status ?? -1;
}

function repo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('guard-paths hook', () => {
  const main = repo(mkdtempSync(join(tmpdir(), 'guard-main-')));
  // A nested checkout under tmp/ stands in for a git worktree: its own top level inside the project.
  const wt = repo(join(main, 'tmp', 'x-worktree'));

  it.each([
    ['main root', join(main, 'docs', 'PLAN.md'), 2],
    ['main root fixtures', join(main, 'fixtures', 'pose', 'a.json'), 2],
    ['worktree PLAN.md', join(wt, 'docs', 'PLAN.md'), 2],
    ['worktree models (new file)', join(wt, 'public', 'models', 'new', 'x.task'), 2],
    ['worktree settings.json', join(wt, '.claude', 'settings.json'), 2],
    ['worktree source file', join(wt, 'src', 'core', 'sim.ts'), 0],
    ['worktree PLAN-BOXING.md', join(wt, 'docs', 'PLAN-BOXING.md'), 0],
  ])('%s (%s) → exit %i', (_name, file, code) => {
    expect(guard(file, main)).toBe(code);
  });
});
