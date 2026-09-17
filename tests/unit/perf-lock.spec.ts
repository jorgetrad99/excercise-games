import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquire, currentHolder, waitForLock } from '../../scripts/e2e-lock.mjs';
import { contention, ourPids, summarizeLoad } from '../e2e/machine-state';

describe('provisional gate results: measured external load, not process names', () => {
  const quiet = { externalGpuPct: 3, externalCpuCores: 0.8, lockHeld: true };
  const cfg = { maxExternalGpuPct: 10, maxExternalCpuCores: 2, samples: 3 };

  it('a quiet run with the lock on a hardware GPU is a real measurement', () => {
    expect(contention(quiet, false, cfg)).toEqual([]);
  });

  it.each([
    [
      'the compositor on the dGPU (2026-09-16: 42 %)',
      { ...quiet, externalGpuPct: 42 },
      false,
      /external GPU 42 % > 10 %/,
    ],
    [
      'an extension host plus a browser',
      { ...quiet, externalCpuCores: 2.4 },
      false,
      /external CPU 2.4 cores > 2/,
    ],
    ['lock not held', { ...quiet, lockHeld: false }, false, /lock not held/],
    ['software renderer', quiet, true, /software renderer/],
    [
      'counters unavailable',
      { ...quiet, externalGpuPct: null, externalCpuCores: null },
      false,
      /not measurable/,
    ],
  ])('%s → provisional', (_name, m, sw, why) => {
    expect(contention(m, sw, cfg).join('; ')).toMatch(why);
  });
});

describe('summarizeLoad: counter rows → this run vs everything else', () => {
  const NV = 'luid_0x00000000_0x0001878a_phys_0';
  const AMD = 'luid_0x00000000_0x00013d0e_phys_0';
  const rows = [1, 2].flatMap((i) => [
    { i, path: '\\\\h\\processor(_total)\\% processor time', v: 30 },
    { i, path: '\\\\h\\process(idle)\\% processor time', v: 900 },
    { i, path: '\\\\h\\process(idle)\\id process', v: 0 },
    { i, path: '\\\\h\\process(code#2)\\% processor time', v: 120 }, // extension host: 1.2 cores
    { i, path: '\\\\h\\process(code#2)\\id process', v: 33000 },
    { i, path: '\\\\h\\process(chrome#4)\\% processor time', v: 250 }, // our headless browser
    { i, path: '\\\\h\\process(chrome#4)\\id process', v: 500 },
    {
      i,
      path: `\\\\h\\gpu engine(pid_2412_${NV}_eng_0_engtype_3d)\\utilization percentage`,
      v: 42,
    }, // dwm
    {
      i,
      path: `\\\\h\\gpu engine(pid_500_${NV}_eng_0_engtype_3d)\\utilization percentage`,
      v: 20,
    }, // ours
    {
      i,
      path: `\\\\h\\gpu engine(pid_500_${NV}_eng_1_engtype_compute)\\utilization percentage`,
      v: 5,
    },
    {
      i,
      path: `\\\\h\\gpu engine(pid_9_${AMD}_eng_0_engtype_3d)\\utilization percentage`,
      v: 60,
    }, // other adapter
  ]);
  const names = new Map([
    [2412, 'dwm.exe'],
    [33000, 'Code.exe'],
    [500, 'chrome.exe'],
  ]);
  const load = summarizeLoad(rows, new Set([500]), names);

  it('external GPU is measured on the adapter this run renders on, whatever the process name', () => {
    expect(load.externalGpuPct).toBe(42);
    expect(load.ownGpuPct).toBe(25);
    expect(load.topExternalGpu[0]).toEqual({
      pid: 2412,
      name: 'dwm.exe',
      pct: 42,
    });
  });

  it('external CPU counts every non-run process in cores; Idle and our own browser are excluded', () => {
    expect(load.externalCpuCores).toBe(1.2);
    expect(load.topExternalCpu).toEqual([{ pid: 33000, name: 'Code.exe', cores: 1.2 }]);
    expect(load.cpuBusyPct).toBe(30);
  });
});

describe('ourPids: what counts as this run', () => {
  const procs = [
    { pid: 1, ppid: 0, name: 'bash', cmd: 'bash -c "pnpm verify"' },
    { pid: 2, ppid: 1, name: 'node', cmd: 'node playwright test' },
    { pid: 3, ppid: 2, name: 'node', cmd: 'node playwright worker' },
    { pid: 4, ppid: 3, name: 'chrome', cmd: 'chrome --headless' },
    { pid: 5, ppid: 2, name: 'node', cmd: 'node vite --port 5190' },
    // Chrome's GPU process is the browser's child; Windows keeps the creator pid, it doesn't reparent.
    { pid: 6, ppid: 4, name: 'chrome', cmd: 'chrome --type=gpu-process' },
    { pid: 9, ppid: 0, name: 'Code', cmd: 'Code.exe extensionHost' },
  ];
  it('ancestors of the worker and everything the runner spawned, nothing else', () => {
    expect([...ourPids(procs, 3)].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('without a recognisable Playwright runner, everything this process spawned still counts as ours', () => {
    const plain = procs.map((p) => (p.pid === 2 ? { ...p, cmd: 'node runner.js' } : p));
    expect([...ourPids(plain, 3)].sort()).toEqual([1, 2, 3, 4, 6]);
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
