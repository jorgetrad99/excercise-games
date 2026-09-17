// CPU-contention sweep: does machine-wide CPU load move pose-fps on this machine, and from what load?
// Decides tests/e2e/contention.config.ts maxExternalCpuCores from measured effect (Jorge, 2026-09-17).
// Not in verify. Run in a quiet window with nothing else heavy, in the gate reference config (external display
// unplugged):
//   node scripts/cpu-contention-sweep.mjs [--levels 0,2,4,6,8,10,12,14] [--reps 3] [--seconds 20] [--cooldown 10] [--port 5191] [--label cpu-sweep]
// Also samples GPU telemetry per second (sweep-telemetry.mjs) and correlates it with the 2P run-to-run scatter.
// Load = N worker threads spinning at normal priority (external to the probe's browser, like VS Code or
// Defender). Order alternates ascending/descending per repetition so heat and drift spread over levels.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { waitForLock } from './e2e-lock.mjs';
import { correlate, displays, startTelemetry } from './sweep-telemetry.mjs';

const SCENARIOS = ['skate-2p-pose', 'skate-1p-pose'];
const BINDING = 'skate-2p-pose';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs) => (xs.length > 1 ? Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2))) : 0);

/**
 * Pure. points: {level, rep, id, poseMean, poseMin, inferMs, renderMin, busyPct}[].
 * Returns per-(id, level) means and, for the binding scenario, the lowest load level whose mean pose-fps
 * falls below baseline − max(1, 2·sd(baseline reps)), or null when no level degrades.
 */
export function summarize(points) {
  const rows = [];
  for (const id of new Set(points.map((p) => p.id)))
    for (const level of [...new Set(points.map((p) => p.level))].sort((a, b) => a - b)) {
      const ps = points.filter((p) => p.id === id && p.level === level);
      if (!ps.length) continue;
      rows.push({
        id,
        level,
        reps: ps.length,
        poseMean: +mean(ps.map((p) => p.poseMean)).toFixed(2),
        poseMeanSd: +sd(ps.map((p) => p.poseMean)).toFixed(2),
        poseMin: Math.min(...ps.map((p) => p.poseMin)),
        inferMs: +mean(ps.map((p) => p.inferMs)).toFixed(1),
        renderMin: Math.min(...ps.map((p) => p.renderMin)),
        busyPct: +mean(ps.map((p) => p.busyPct)).toFixed(0),
      });
    }
  const bind = rows.filter((r) => r.id === BINDING);
  const base = bind.find((r) => r.level === 0);
  if (!base) return { rows, onset: null, margin: null, lastGood: null };
  const margin = Math.max(1, 2 * base.poseMeanSd);
  const onset = bind.find((r) => r.level > 0 && r.poseMean < base.poseMean - margin)?.level ?? null;
  const good = bind.filter((r) => r.level < (onset ?? Infinity)).map((r) => r.level);
  return {
    rows,
    onset,
    margin: +margin.toFixed(2),
    lastGood: good.length ? Math.max(...good) : null,
  };
}

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};

function burners(n) {
  return Array.from({ length: n }, () => new Worker('for (;;) {}', { eval: true }));
}

/** Whole-machine CPU busy % while fn runs. */
async function busyDuring(fn) {
  const snap = () =>
    cpus().reduce(
      (a, c) => ({
        idle: a.idle + c.times.idle,
        total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0),
      }),
      { idle: 0, total: 0 },
    );
  const a = snap();
  const out = await fn();
  const b = snap();
  return {
    out,
    busyPct: Math.round((1 - (b.idle - a.idle) / Math.max(1, b.total - a.total)) * 100),
  };
}

const run = (cmd, args, env = {}) =>
  new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('exit', (code) =>
      code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(' ')} → ${code}`)),
    );
  });

function nvidia() {
  try {
    return execFileSync(
      'nvidia-smi',
      ['--query-gpu=temperature.gpu,clocks_event_reasons.active', '--format=csv,noheader,nounits'],
      {
        encoding: 'utf8',
      },
    ).trim();
  } catch {
    return null;
  }
}

async function main() {
  const levels = arg('levels', '0,2,4,6,8,10,12,14').split(',').map(Number);
  const reps = Number(arg('reps', 3));
  const seconds = Number(arg('seconds', 20));
  const cooldown = Number(arg('cooldown', 10));
  const port = arg('port', '5191');
  const out = arg('label', 'cpu-sweep'); // e.g. cpu-sweep-unplugged: one output per display config
  const base = `http://localhost:${port}`;
  mkdirSync('tmp/perf', { recursive: true });

  // Idle external CPU on the working machine: the offset a gate sees before any added load.
  await run(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      'vitest.tools.config.ts',
      'machine-state',
    ],
    {
      MACHINE_LABEL: 'cpu-sweep-idle',
    },
  );
  const idle = JSON.parse(readFileSync('tmp/machine-state/cpu-sweep-idle.json', 'utf8'));
  // Which reference config this is: the gate reference is the external display unplugged (Jorge, 2026-09-17).
  const display = displays();
  const telemetry = startTelemetry(`tmp/perf/${out}`);

  const vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--port', port, '--strictPort'],
    { stdio: 'ignore' },
  );
  try {
    for (let t = 0; ; t++) {
      if (t > 60) throw new Error('vite did not start');
      if (
        await fetch(base).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const points = [];
    for (let rep = 0; rep < reps; rep++) {
      for (const level of rep % 2 ? [...levels].reverse() : levels) {
        await waitForLock({ label: 'cpu-sweep' });
        const burn = burners(level);
        await new Promise((r) => setTimeout(r, 3_000));
        const label = `cpu-sweep-${level}-r${rep}`;
        const { busyPct } = await busyDuring(() =>
          run(process.execPath, [
            'scripts/perf-probe.mjs',
            '--base',
            base,
            '--only',
            SCENARIOS.join(','),
            '--seconds',
            String(seconds),
            '--label',
            label,
          ]),
        );
        await Promise.all(burn.map((w) => w.terminate()));
        const gpu = nvidia();
        for (const r of JSON.parse(readFileSync(`tmp/perf/probe-${label}.json`, 'utf8')))
          points.push({
            level,
            rep,
            id: r.id,
            poseMean: r.poseFps?.mean ?? NaN,
            poseMin: r.poseFps?.min ?? NaN,
            inferMs: r.inferMs,
            renderMin: r.renderFps.min,
            busyPct,
            nvidia: gpu,
            series: r.series ?? [],
          });
        console.log(`level ${level} rep ${rep}: busy ${busyPct} % · nvidia ${gpu}`);
        await new Promise((r) => setTimeout(r, cooldown * 1_000));
      }
    }
    const scatter = correlate(points, await telemetry.stop());
    const result = summarize(points);
    const proposal =
      result.onset === null
        ? `No pose-fps effect up to ${Math.max(...levels)} added cores: report CPU only, don't gate on it.`
        : `2P pose-fps degrades from ${result.onset} added cores (baseline − ${result.margin}). ` +
          `Gate threshold = idle external ${idle.externalCpuCores} + last good level ${result.lastGood} = ` +
          `${(idle.externalCpuCores + result.lastGood).toFixed(1)} external cores.`;
    const at = new Date().toISOString();
    writeFileSync(
      `tmp/perf/${out}.json`,
      JSON.stringify({ at, display, idle, points, ...result, proposal, scatter }, null, 1),
    );
    console.table(result.rows);
    console.log(proposal);
    console.log(
      `2P pose-fps vs telemetry, Pearson r (${scatter.runs} runs ≤ 10 added threads, ${scatter.samples} samples; displays ${JSON.stringify(display)}):`,
    );
    console.table(scatter.r);
    console.log(`→ tmp/perf/${out}.json`);
  } finally {
    vite.kill();
    telemetry.kill();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
