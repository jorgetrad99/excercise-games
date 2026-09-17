// PreToolUse(Edit|Write|MultiEdit): block writes to human-owned paths (AGENTS.md §3).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? '';
if (!target) process.exit(0);

// Relative to the checkout that CONTAINS the file, not the session's project root: a git worktree
// under tmp/ would otherwise turn docs/PLAN.md into tmp/<wt>/docs/PLAN.md and slip past every rule.
const abs = resolve(target);
let dir = dirname(abs);
while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
let root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
try {
  root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
} catch {
  // not in a git checkout: fall back to the project root
}
const rel = relative(root, abs).split(sep).join('/');
const blocked = [
  /^fixtures\//,
  /^public\/models\//,
  /^docs\/PLAN\.md$/,
  /^\.claude\/settings\.json$/,
  // What decides how the guard runs, or can add hooks/permissions/servers. An agent that could edit
  // the launcher could set the guard's policy to open (PROGRESS 2026-09-17, config read per checkout).
  /^\.claude\/hooks\//,
  /^\.claude\/settings\.local\.json$/,
  /^\.mcp\.json$/,
  /^CLAUDE\.local\.md$/,
  /^AGENTS\.md$/,
];

if (blocked.some((re) => re.test(rel))) {
  console.error(
    `Blocked: ${rel} is human-owned (AGENTS.md §3). Say so in docs/PROGRESS.md instead.`,
  );
  process.exit(2);
}
