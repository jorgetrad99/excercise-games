// GPU telemetry for the CPU-contention sweep: sample it per second, then ask which reading moves with
// 2P pose-fps. The run-to-run 2P scatter (24–28 fps with no load added) is larger than every effect the
// contention check detects; this is where it gets correlated instead of guessed at (Jorge, 2026-09-17).
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Pure. Pearson r of paired finite values; null with fewer than 3 pairs or no variance. */
export function pearson(xs, ys) {
  const pairs = xs
    .map((x, i) => [x, ys[i]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 3) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx && syy ? +(sxy / Math.sqrt(sxx * syy)).toFixed(2) : null;
}

/** Local "YYYY/MM/DD hh:mm:ss.mmm" (nvidia-smi) or "MM/DD/YYYY hh:mm:ss.mmm" (typeperf) → epoch ms. */
function localTime(t) {
  const n = t.match(/\d+/g).map(Number);
  const [y, mo, d] = n[0] > 31 ? n : [n[2], n[0], n[1]];
  return new Date(y, mo - 1, d, n[3], n[4], n[5], n[6] ?? 0).getTime();
}

/** Pure. nvidia-smi -l 1 CSV (timestamp, util %, temp °C, clock MHz, power W, pstate, reasons) → rows. */
export function parseNvidia(text) {
  return text
    .split('\n')
    .map((l) => l.split(',').map((x) => x.trim()))
    .filter((c) => c.length === 7 && /^\d{4}\//.test(c[0]))
    .map((c) => ({
      at: localTime(c[0]),
      gpuUtil: +c[1],
      tempC: +c[2],
      clockMhz: +c[3],
      powerW: +c[4],
      // Bit 0 is "GPU idle", not a slowdown; any other active reason counts as throttled.
      throttled: BigInt(c[6]) & ~1n ? 1 : 0,
    }));
}

/** Pure. typeperf CSV of dwm's 3D engines → rows with dwm % summed per adapter, keyed dwm_<luid low>. */
export function parseTypeperf(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.startsWith('"'));
  if (lines.length < 2) return [];
  const luids = lines[0]
    .split('","')
    .slice(1)
    .map((h) => h.match(/luid_0x[0-9a-f]+_(0x[0-9a-f]+)/i)?.[1]);
  return lines.slice(1).map((l) => {
    const c = l.replace(/"/g, '').split(',');
    const row = { at: localTime(c[0]) };
    luids.forEach((id, i) => {
      const v = Number(c[i + 1]);
      if (id && c[i + 1] !== '' && Number.isFinite(v))
        row[`dwm_${id}`] = (row[`dwm_${id}`] ?? 0) + v;
    });
    return row;
  });
}

/**
 * Pure. Which telemetry moves with 2P pose-fps?
 * - perSecond: every 2P sample joined to the nearest row of each telemetry source (≤ 1.5 s).
 * - perRun: each 2P run's mean pose-fps vs that reading's mean over the run's window (the run-to-run
 *   scatter).
 * Runs above maxLevel added threads are left out so the measured CPU effect doesn't mask the question.
 */
export function correlate(points, telemetry, { id = 'skate-2p-pose', maxLevel = 10 } = {}) {
  const runs = points.filter((p) => p.id === id && p.level <= maxLevel && p.series?.length);
  const keys = [...new Set(telemetry.flatMap((r) => Object.keys(r)))].filter((k) => k !== 'at');
  const near = (at, k) => {
    let best;
    for (const r of telemetry)
      if (
        k in r &&
        Math.abs(r.at - at) <= 1500 &&
        (!best || Math.abs(r.at - at) < Math.abs(best.at - at))
      )
        best = r;
    return best?.[k];
  };
  const samples = runs.flatMap((p) => p.series.filter((s) => s.poseFps !== null));
  const windowMean = (p, k) =>
    mean(
      telemetry
        .filter((r) => k in r && r.at >= p.series[0].at - 1000 && r.at <= p.series.at(-1).at)
        .map((r) => r[k]),
    );
  const r = {};
  for (const k of keys)
    r[k] = {
      perSecond: pearson(
        samples.map((s) => s.poseFps),
        samples.map((s) => near(s.at, k)),
      ),
      perRun: pearson(
        runs.map((p) => p.poseMean),
        runs.map((p) => windowMean(p, k)),
      ),
      runMean: +mean(runs.map((p) => windowMean(p, k))).toFixed(1),
    };
  return { runs: runs.length, samples: samples.length, r };
}

/** Active displays by kind (WmiMonitorConnectionParams: internal 0x80000000, LVDS 6, eDP 11, UDI 13). */
export function displays() {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance -Namespace root\\wmi WmiMonitorConnectionParams | Where-Object Active | Select-Object VideoOutputTechnology | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8' },
    );
    const list = [JSON.parse(out)].flat();
    const internal = list.filter((d) =>
      [0x80000000, 6, 11, 13].includes(d.VideoOutputTechnology),
    ).length;
    return { internal, external: list.length - internal };
  } catch {
    return null;
  }
}

/** Starts nvidia-smi and typeperf (dwm's 3D engines) at 1 Hz; stop() ends both and returns parsed rows. */
export function startTelemetry(prefix) {
  const nvCsv = `${prefix}-nvidia.csv`;
  const dwmCsv = `${prefix}-dwm.csv`;
  const q =
    'timestamp,utilization.gpu,temperature.gpu,clocks.current.graphics,power.draw,pstate,clocks_event_reasons.active';
  const nv = spawn('nvidia-smi', [`--query-gpu=${q}`, '--format=csv,noheader,nounits', '-l', '1']);
  nv.stdout.pipe(createWriteStream(nvCsv));
  nv.on('error', () => {});
  const dwmPid = execFileSync('powershell', ['-NoProfile', '-Command', '(Get-Process dwm).Id'], {
    encoding: 'utf8',
  }).trim();
  const counter = `\\GPU Engine(pid_${dwmPid}_*engtype_3D)\\Utilization Percentage`;
  const dwm = spawn('typeperf', [counter, '-si', '1', '-f', 'CSV', '-o', dwmCsv, '-y']);
  dwm.on('error', () => {});
  return {
    kill: () => (nv.kill(), dwm.kill()),
    async stop() {
      nv.kill();
      dwm.kill();
      await new Promise((r) => setTimeout(r, 2_000)); // let both flush their files
      const read = (f) => {
        try {
          return readFileSync(f, 'utf8');
        } catch {
          return '';
        }
      };
      return [...parseNvidia(read(nvCsv)), ...parseTypeperf(read(dwmCsv))];
    },
  };
}
