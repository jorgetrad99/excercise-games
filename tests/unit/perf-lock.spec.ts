import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquire, currentHolder, waitForLock } from '../../scripts/e2e-lock.mjs';
import { isHeavyCommand } from '../e2e/machine-state';

describe('machine state: which other processes count as contention', () => {
  it.each([
    ['"C:\\Program Files\\nodejs\\node.exe" node_modules/typescript/bin/tsc --noEmit -p .', true],
    ['node /repo/node_modules/vitest/vitest.mjs run', true],
    ['node node_modules/eslint/bin/eslint.js .', true],
    ['node scripts/perf-probe.mjs --label head', true],
    ['node .claude/hooks/format-and-typecheck.mjs', true],
    ['"C:\\Program Files\\Git\\bin\\bash.exe" -c -l "PLAYWRIGHT_PORT=5190 pnpm verify"', false],
    [
      '"C:\\Users\\j\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" c:\\Users\\j\\.vscode\\extensions\\dbaeumer.vscode-eslint-3.0.24\\server\\out\\eslintServer.js',
      false,
    ],
    ['node node_modules/vite/bin/vite.js --port 5190 --strictPort', false],
  ])('%s → %s', (cmd, heavy) => {
    expect(isHeavyCommand(cmd)).toBe(heavy);
  });
});

const fresh = () => join(mkdtempSync(join(tmpdir(), 'perf-lock-')), 'e2e.lock');
const DEAD_PID = 2 ** 22 + 12_345; // above any real pid on Windows/Linux defaults

describe('perf lock (scripts/e2e-lock.mjs)', () => {
  it('a second acquire fails fast naming the holder; release frees it', () => {
    const path = fresh();
    const release = acquire(path);
    expect(() => acquire(path)).toThrow(new RegExp(`holds the perf lock: pid ${process.pid}`));
    release();
    expect(existsSync(path)).toBe(false);
    acquire(path)();
  });

  it('a lock left by a dead process is stale and taken over', () => {
    const path = fresh();
    writeFileSync(path, JSON.stringify({ pid: DEAD_PID, cwd: 'x', branch: 'y', startedAt: 'z' }));
    expect(currentHolder(path)).toBeNull();
    acquire(path)();
  });

  it('heavy work waits while a live process holds it, then proceeds once released', async () => {
    const path = fresh();
    // A separate live process holds the lock for ~600 ms (like a Playwright run).
    const child = spawn(process.execPath, [
      '-e',
      `require('fs').writeFileSync(${JSON.stringify(path)}, JSON.stringify({pid: process.pid, cwd: 'c', branch: 'b', startedAt: 's'}));` +
        `setTimeout(() => { require('fs').unlinkSync(${JSON.stringify(path)}); }, 600);`,
    ]);
    for (let i = 0; i < 100 && !existsSync(path); i++) await new Promise((r) => setTimeout(r, 20));
    const waited = await waitForLock({ path, pollMs: 50, timeoutMs: 10_000, label: 'test' });
    expect(waited).toBeGreaterThanOrEqual(300);
    child.kill();
  });

  it('gives up with the holder named after timeoutMs', async () => {
    const path = fresh();
    const release = acquire(path);
    await expect(waitForLock({ path, pollMs: 20, timeoutMs: 100, label: 'tsc' })).rejects.toThrow(
      /tsc: perf lock still held .* pid \d+/,
    );
    release();
  });
});
