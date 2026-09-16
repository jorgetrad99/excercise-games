// Stop: remind to log in docs/PROGRESS.md when code changed but the log didn't.
import { execFileSync } from 'node:child_process';

// Agent config and scratch output aren't "code": a lingering .claude/ edit used to trigger the
// reminder on every stop, even right after PROGRESS.md was committed.
const IGNORED = /^(\.claude\/|tmp\/)/;

let changed = [];
try {
  // porcelain (not `git diff HEAD`) so it also works before the first commit and sees untracked files
  changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    encoding: 'utf8',
    cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  })
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''));
} catch {
  process.exit(0);
}

const code = changed.filter((f) => !IGNORED.test(f));
if (code.length && !changed.includes('docs/PROGRESS.md')) {
  console.log(
    JSON.stringify({
      systemMessage: `Reminder: uncommitted changes (${code.slice(0, 3).join(', ')}) but docs/PROGRESS.md was not updated.`,
    }),
  );
}
