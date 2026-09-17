import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { currentHolder } from '../../scripts/e2e-lock.mjs';

// What else the machine was doing when a perf gate measured. The perf lock only stops cooperating
// sessions; anything that can't check it (another tool, an ad-hoc probe) still shows up here, so a
// gate value is never reported without the context that decides whether it's usable.

/** Other processes doing the kind of work that skewed gates before (tsc, eslint, vitest, builds, probes). */
const HEAVY =
  /\btsc\b|typescript[\\/]bin[\\/]tsc|eslint|vitest|playwright|vite(\.js)?["']?\s+build|perf-probe|probe-|format-and-typecheck/i;
/** Not work in themselves: shells whose command line merely mentions a tool (the heavy child is its own
 *  process and is matched separately; MSYS bash also breaks the parent chain) and idle editor language servers. */
const WRAPPER =
  /^"?[^"]*[\\/](bash|sh|zsh|cmd|powershell|pwsh)(\.exe)?"?\s|[\\/]\.vscode[\\/]extensions[\\/]/i;

export const isHeavyCommand = (cmd: string): boolean => HEAVY.test(cmd) && !WRAPPER.test(cmd);

export interface MachineState {
  /** All-core CPU busy over 1 s right after sampling, % (includes this test's own browser and pose worker). */
  cpuBusyPct: number;
  /** nvidia-smi utilization, % (includes this test); null without an NVIDIA driver. */
  gpuUtilPct: number | null;
  /** Heavy processes outside this run's own process chain: the contention signal. */
  otherHeavy: { pid: number; cmd: string }[];
  /** True when this run holds the perf lock. */
  lockHeld: boolean;
}

interface Proc {
  pid: number;
  ppid: number;
  cmd: string;
}

function processes(): Proc[] {
  try {
    if (process.platform === 'win32') {
      const json = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
        ],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      );
      return (
        JSON.parse(json) as {
          ProcessId: number;
          ParentProcessId: number;
          CommandLine: string | null;
        }[]
      ).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, cmd: p.CommandLine ?? '' }));
    }
    return execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
      .split('\n')
      .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => ({ pid: +m[1]!, ppid: +m[2]!, cmd: m[3]! }));
  } catch {
    return [];
  }
}

const cpuBusy = async (): Promise<number> => {
  const snap = () =>
    cpus().reduce(
      (a, c) => {
        const t = Object.values(c.times).reduce((x, y) => x + y, 0);
        return { idle: a.idle + c.times.idle, total: a.total + t };
      },
      { idle: 0, total: 0 },
    );
  const a = snap();
  await new Promise((r) => setTimeout(r, 1_000));
  const b = snap();
  return Math.round((1 - (b.idle - a.idle) / Math.max(1, b.total - a.total)) * 100);
};

function gpuUtil(): number | null {
  try {
    const out = execFileSync(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'],
      { encoding: 'utf8' },
    );
    return Number.parseInt(out, 10);
  } catch {
    return null;
  }
}

export async function machineState(): Promise<MachineState> {
  const cpuBusyPct = await cpuBusy();
  const procs = processes();
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  // This worker's ancestors (runner, pnpm verify, shell) are our own run, not contention.
  const ours = new Set<number>();
  let runner: number | null = null;
  for (let p = byPid.get(process.pid); p && !ours.has(p.pid); p = byPid.get(p.ppid)) {
    ours.add(p.pid);
    if (runner === null && p.pid !== process.pid && /playwright/i.test(p.cmd)) runner = p.pid;
  }
  // ...and so is everything the Playwright runner spawned (sibling workers, the Vite web server).
  const spawned = new Set<number>(runner === null ? [] : [runner]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of procs)
      if (spawned.has(p.ppid) && !spawned.has(p.pid)) {
        spawned.add(p.pid);
        ours.add(p.pid);
        grew = true;
      }
  }
  const otherHeavy = procs
    .filter((p) => !ours.has(p.pid) && isHeavyCommand(p.cmd))
    .map((p) => ({ pid: p.pid, cmd: p.cmd.slice(0, 140) }));
  const holder = currentHolder();
  return {
    cpuBusyPct,
    gpuUtilPct: gpuUtil(),
    otherHeavy,
    lockHeld: holder !== null && ours.has(holder.pid),
  };
}
