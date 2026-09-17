// Stop: warn when this checkout's Claude config drifts from main; remind to log in docs/PROGRESS.md
// when code changed but the log didn't.
import { execFileSync } from 'node:child_process';
import { configDrift } from './config-drift.mjs';

// Agent config and scratch output aren't "code": a lingering .claude/ edit used to trigger the
// reminder on every stop, even right after PROGRESS.md was committed.
const IGNORED = /^(\.claude\/|tmp\/)/;
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const messages = [];

try {
  messages.push(...configDrift(cwd).map((w) => `Config drift: ${w}`));
} catch {
  // advisory: never block a stop on the drift check
}

try {
  // porcelain (not `git diff HEAD`) so it also works before the first commit and sees untracked files
  const changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    encoding: 'utf8',
    cwd,
  })
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''));
  const code = changed.filter((f) => !IGNORED.test(f));
  if (code.length && !changed.includes('docs/PROGRESS.md')) {
    messages.push(
      `Reminder: uncommitted changes (${code.slice(0, 3).join(', ')}) but docs/PROGRESS.md was not updated.`,
    );
  }
} catch {
  // not a git checkout
}

if (messages.length) console.log(JSON.stringify({ systemMessage: messages.join('\n') }));
