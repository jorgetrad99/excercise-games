import { execSync } from 'node:child_process';
import { openSync, readFileSync, unlinkSync, writeFileSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';

// One e2e run per machine checkout. Worktrees share the git common dir, so every session on this repo
// sees the same lockfile. Two suites on one GPU poison each other's perf gates (PROGRESS 2026-09-16:
// 2P pose-fps 19 and 1080p fps 46 on unchanged code while another worktree ran e2e).

interface Holder {
  pid: number;
  cwd: string;
  branch: string;
  startedAt: string;
}

export const lockPath = (): string =>
  resolve(
    execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim(),
    'move-arcade-e2e.lock',
  );

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const git = (args: string): string => {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
  } catch {
    return '?';
  }
};

/** Takes the lock or throws with who holds it. A lock whose process is gone is stale and taken over.
 *  ponytail: pid liveness only; a reused pid after a crash needs the manual delete in the message. */
export function acquireE2eLock(path = lockPath()): () => void {
  const me: Holder = {
    pid: process.pid,
    cwd: process.cwd(),
    branch: git('rev-parse --abbrev-ref HEAD'),
    startedAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeFileSync(fd, JSON.stringify(me));
      closeSync(fd);
      return () => release(path, me.pid);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const holder = readHolder(path);
      if (holder && alive(holder.pid))
        throw new Error(
          `Another e2e run holds the lock: pid ${holder.pid}, ${holder.cwd} (${holder.branch}), since ${holder.startedAt}.\n` +
            "Two e2e suites on one GPU invalidate each other's perf gates. Wait for it to finish.\n" +
            `If that process is not a Playwright run, delete ${path}.`,
          { cause: e },
        );
      unlinkSync(path); // stale: holder crashed or unreadable
    }
  }
  throw new Error(`Could not take the e2e lock at ${path}.`);
}

function readHolder(path: string): Holder | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Holder;
  } catch {
    return null;
  }
}

function release(path: string, pid: number): void {
  if (readHolder(path)?.pid === pid) unlinkSync(path);
}
