import { execFileSync } from 'node:child_process';
import { currentHolder } from '../../scripts/e2e-lock.mjs';
import { contentionConfig as C } from './contention.config';

// How much of the machine was NOT this run when a perf gate measured. The rule is measured external
// load, not process names: the load that skewed 2P pose-fps on 2026-09-16 was the desktop compositor
// (~42 % of the dGPU) and a browser, neither of which any dev-tool name list would catch.
// ponytail: counters are read for C.samples s right AFTER the gate's window, not during it; a load that
// ends exactly with the window is missed. Upgrade: a streaming sampler started with the test.

interface ProcLoad {
  pid: number;
  name: string;
}

export interface MachineState {
  /** Whole-machine CPU busy, % of all cores (includes this run). */
  cpuBusyPct: number | null;
  /** CPU used by processes outside this run, logical cores; null when counters are unavailable. */
  externalCpuCores: number | null;
  /** GPU engine use by processes outside this run on this run's adapter, %; null when unavailable. */
  externalGpuPct: number | null;
  /** GPU engine use by this run's own processes (browser, pose worker) on that adapter, %. */
  ownGpuPct: number | null;
  topExternalCpu: (ProcLoad & { cores: number })[];
  topExternalGpu: (ProcLoad & { pct: number })[];
  /** nvidia-smi: whole-GPU utilization %, temperature °C, P-state, active clock-event (throttle) bitmask. */
  nvidia: { utilPct: number; tempC: number; pstate: string; clockEventReasons: string } | null;
  /** True when this run holds the perf lock. */
  lockHeld: boolean;
}

interface Proc {
  pid: number;
  ppid: number;
  name: string;
  cmd: string;
}

/** A raw counter reading: sample-set index, lower-cased counter path, cooked value. */
export interface CounterRow {
  i: number;
  path: string;
  v: number;
}

/** PowerShell stdout. Processes exit mid-enumeration during a test run; the cmdlet then exits 1 but still
 *  prints every valid row (seen for Get-Counter and Get-CimInstance under vitest, 2026-09-16), so the
 *  output is kept. Callers treat unparseable output as "no data". */
function ps(command: string): string {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? '');
  }
}

function processes(): Proc[] {
  try {
    if (process.platform === 'win32') {
      const rows = JSON.parse(
        ps(
          'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress',
        ),
      ) as {
        ProcessId: number;
        ParentProcessId: number;
        Name: string;
        CommandLine: string | null;
      }[];
      return rows.map((p) => ({
        pid: p.ProcessId,
        ppid: p.ParentProcessId,
        name: p.Name,
        cmd: p.CommandLine ?? '',
      }));
    }
    return execFileSync('ps', ['-eo', 'pid=,ppid=,comm=,args='], { encoding: 'utf8' })
      .split('\n')
      .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => ({ pid: +m[1]!, ppid: +m[2]!, name: m[3]!, cmd: m[4]! }));
  } catch {
    return [];
  }
}

/** This worker's ancestors (runner, pnpm verify, shell) plus everything the Playwright runner spawned
 *  (workers, browsers, Vite, this sampler): all of that is "this run". */
export function ourPids(procs: Proc[], self = process.pid): Set<number> {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const ours = new Set<number>();
  let runner: number | null = null;
  for (let p = byPid.get(self); p && !ours.has(p.pid); p = byPid.get(p.ppid)) {
    ours.add(p.pid);
    if (runner === null && p.pid !== self && /playwright/i.test(p.cmd)) runner = p.pid;
  }
  const spawned = new Set<number>([runner ?? self]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of procs)
      if (spawned.has(p.ppid) && !spawned.has(p.pid)) {
        spawned.add(p.pid);
        ours.add(p.pid);
        grew = true;
      }
  }
  return ours;
}

function readCounters(): CounterRow[] | null {
  if (process.platform !== 'win32') return null;
  const counters = [
    '\\Processor(_Total)\\% Processor Time',
    '\\Process(*)\\% Processor Time',
    '\\Process(*)\\ID Process',
    '\\GPU Engine(*engtype_3D)\\Utilization Percentage',
    '\\GPU Engine(*engtype_Compute)\\Utilization Percentage',
  ]
    .map((c) => `'${c}'`)
    .join(',');
  const command =
    `$i = 0; Get-Counter -Counter ${counters} -SampleInterval 1 -MaxSamples ${C.samples} -ErrorAction SilentlyContinue | ` +
    'ForEach-Object { $i++; foreach ($s in $_.CounterSamples) { [pscustomobject]@{ i = $i; path = $s.Path.ToLower(); v = $s.CookedValue } } } | ' +
    'ConvertTo-Json -Compress';
  const out = ps(command);
  try {
    return out.trim() ? (JSON.parse(out) as CounterRow[]) : null;
  } catch {
    return null;
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Pure: per-process CPU and GPU load split into this run vs everything else. */
export function summarizeLoad(rows: CounterRow[], ours: Set<number>, names: Map<number, string>) {
  const sets = Math.max(1, new Set(rows.map((r) => r.i)).size);
  const inst = (path: string) => path.match(/\(([^)]*)\)/)?.[1] ?? '';
  // Process instance names ("chrome#3") map to pids per sample set.
  const pidOf = new Map<string, number>();
  for (const r of rows)
    if (r.path.endsWith('\\id process')) pidOf.set(`${r.i}|${inst(r.path)}`, r.v);
  const cpu = new Map<number, number>();
  const total: number[] = [];
  for (const r of rows) {
    if (!r.path.endsWith('\\% processor time')) continue;
    const name = inst(r.path);
    if (r.path.includes('\\processor(')) {
      if (name === '_total') total.push(r.v);
      continue;
    }
    const pid = pidOf.get(`${r.i}|${name}`);
    if (pid === undefined || pid === 0 || name === '_total' || name === 'idle') continue;
    cpu.set(pid, (cpu.get(pid) ?? 0) + r.v / 100 / sets);
  }
  // GPU engines: pid_<pid>_luid_<hi>_<lo>_..., summed per (pid, adapter), averaged over sample sets.
  const gpu = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const m = r.path.match(/pid_(\d+)_luid_(0x[0-9a-f]+_0x[0-9a-f]+)_/);
    if (!m) continue;
    const byPid = gpu.get(m[2]!) ?? new Map<number, number>();
    byPid.set(+m[1]!, (byPid.get(+m[1]!) ?? 0) + r.v / sets);
    gpu.set(m[2]!, byPid);
  }
  const sum = (m: Map<number, number>, keep: (pid: number) => boolean) =>
    [...m].filter(([pid]) => keep(pid)).reduce((a, [, v]) => a + v, 0);
  // This run's adapter: where our own processes are busiest; otherwise the busiest adapter overall.
  const adapters = [...gpu.values()];
  const mine = adapters.sort((a, b) => sum(b, (p) => ours.has(p)) - sum(a, (p) => ours.has(p)))[0];
  const adapter =
    mine && sum(mine, (p) => ours.has(p)) > 0
      ? mine
      : adapters.sort((a, b) => sum(b, () => true) - sum(a, () => true))[0];
  const top = <K extends string>(m: Map<number, number>, key: K, d: number) =>
    [...m]
      .filter(([pid]) => !ours.has(pid))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(
        ([pid, v]) =>
          ({ pid, name: names.get(pid) ?? '?', [key]: round(v, d) }) as ProcLoad &
            Record<K, number>,
      );
  return {
    cpuBusyPct: total.length ? round(mean(total)) : null,
    externalCpuCores: round(
      sum(cpu, (p) => !ours.has(p)),
      2,
    ),
    externalGpuPct: adapter ? round(sum(adapter, (p) => !ours.has(p))) : 0,
    ownGpuPct: adapter ? round(sum(adapter, (p) => ours.has(p))) : 0,
    topExternalCpu: top(cpu, 'cores', 2),
    topExternalGpu: adapter ? top(adapter, 'pct', 1) : [],
  };
}

function nvidia(): MachineState['nvidia'] {
  try {
    const q = 'utilization.gpu,temperature.gpu,pstate,clocks_event_reasons.active';
    const out = execFileSync('nvidia-smi', [`--query-gpu=${q}`, '--format=csv,noheader,nounits'], {
      encoding: 'utf8',
    });
    const [util, temp, pstate, reasons] = out
      .split('\n')[0]!
      .split(',')
      .map((x) => x.trim());
    return { utilPct: +util!, tempC: +temp!, pstate: pstate!, clockEventReasons: reasons! };
  } catch {
    return null;
  }
}

/** Why a gate value measured under this machine state is provisional; empty = a real measurement. */
export function contention(
  m: Pick<MachineState, 'externalCpuCores' | 'externalGpuPct' | 'lockHeld'>,
  softwareGpu: boolean,
  cfg = C,
): string[] {
  const reasons: string[] = [];
  if (m.externalGpuPct === null || m.externalCpuCores === null)
    reasons.push('external load not measurable here');
  if (m.externalGpuPct !== null && m.externalGpuPct > cfg.maxExternalGpuPct)
    reasons.push(`external GPU ${m.externalGpuPct} % > ${cfg.maxExternalGpuPct} %`);
  if (m.externalCpuCores !== null && m.externalCpuCores > cfg.maxExternalCpuCores)
    reasons.push(`external CPU ${m.externalCpuCores} cores > ${cfg.maxExternalCpuCores}`);
  if (!m.lockHeld) reasons.push('perf lock not held by this run');
  if (softwareGpu) reasons.push('software renderer');
  return reasons;
}

export async function machineState(): Promise<MachineState> {
  const procs = processes();
  const ours = ourPids(procs);
  // Without the process list nothing can be attributed to this run: its own browser would count as
  // external. Treat that as "not measurable" (provisional), never as a reading.
  const rows = procs.length ? readCounters() : null;
  const names = new Map(procs.map((p) => [p.pid, p.name]));
  const load = rows
    ? summarizeLoad(rows, ours, names)
    : {
        cpuBusyPct: null,
        externalCpuCores: null,
        externalGpuPct: null,
        ownGpuPct: null,
        topExternalCpu: [],
        topExternalGpu: [],
      };
  const holder = currentHolder();
  return { ...load, nvidia: nvidia(), lockHeld: holder !== null && ours.has(holder.pid) };
}
