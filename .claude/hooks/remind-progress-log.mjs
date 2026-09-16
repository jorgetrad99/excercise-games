// Stop: remind to log in docs/PROGRESS.md when code changed but the log didn't.
import { execFileSync } from 'node:child_process';

let changed = [];
try {
  // porcelain (not `git diff HEAD`) so it also works before the first commit and sees untracked files
  changed = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3));
} catch {
  process.exit(0);
}

if (changed.length && !changed.some((f) => f.includes('docs/PROGRESS.md'))) {
  console.log(JSON.stringify({ systemMessage: 'Reminder: code changed but docs/PROGRESS.md was not updated this session.' }));
}
