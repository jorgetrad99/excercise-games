// Machine-wide perf lock (AGENTS §4). One lockfile in the git common dir, so every worktree and session
// on this repo shares it. The e2e run (perf gates) holds it; heavy work (tsc, eslint, vitest, probes)
// waits for it. Measured 2026-09-16: 2P pose-fps min 15 with another session's tsc/probe running vs
// min 28 on the same code and GPU without it.
//   node scripts/e2e-lock.mjs wait [label]   → blocks until no live holder (exit 1 on timeout)
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function lockPath(cwd = process.cwd()) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' });
  return resolve(cwd, common.trim(), 'move-arcade-e2e.lock');
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

const read = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/** The live holder, or null. A lock whose pid is dead (or unreadable) is stale and removed.
 *  ponytail: pid liveness only; a pid reused after a crash needs the manual delete named in messages. */
export function currentHolder(path = lockPath()) {
  const h = read(path);
  if (h && alive(h.pid)) return h;
  try {
    unlinkSync(path);
  } catch {
    // no lock
  }
  return null;
}

export const describeHolder = (h, path) =>
  `pid ${h.pid}, ${h.cwd} (${h.branch}), since ${h.startedAt}. If that is not a Playwright run, delete ${path}.`;

/** Takes the lock or throws naming the live holder. Returns release(). */
export function acquire(path = lockPath()) {
  let branch = '?';
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    // not fatal
  }
  const me = { pid: process.pid, cwd: process.cwd(), branch, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    const holder = currentHolder(path);
    if (holder)
      throw new Error(
        `Another e2e run holds the perf lock: ${describeHolder(holder, path)}\n` +
          "Two e2e suites on one GPU invalidate each other's perf gates. Wait for it to finish.",
      );
    try {
      const fd = openSync(path, 'wx');
      writeFileSync(fd, JSON.stringify(me));
      closeSync(fd);
      return () => {
        if (read(path)?.pid === me.pid) unlinkSync(path);
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e; // lost a race: re-check the new holder
    }
  }
  throw new Error(`Could not take the perf lock at ${path}.`);
}

/** Resolves once no live process holds the lock; rejects after timeoutMs. Returns the ms waited. */
export async function waitForLock({
  label = 'heavy work',
  timeoutMs = 20 * 60_000,
  pollMs = 2_000,
  path,
} = {}) {
  const file = path ?? lockPath();
  const t0 = Date.now();
  let told = false;
  for (let h = currentHolder(file); h; h = currentHolder(file)) {
    if (Date.now() - t0 >= timeoutMs)
      throw new Error(
        `${label}: perf lock still held after ${Math.round((Date.now() - t0) / 1000)} s: ${describeHolder(h, file)}`,
      );
    if (!told)
      console.error(
        `${label}: waiting for the perf lock (e2e/perf gates running): ${describeHolder(h, file)}`,
      );
    told = true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return Date.now() - t0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.argv[2] === 'wait'
) {
  waitForLock({ label: process.argv[3] ?? 'heavy work' }).then(
    () => process.exit(0),
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
