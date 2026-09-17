import { appendFileSync, mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { contention, machineState } from './machine-state';

// Every perf gate writes what it measured before asserting, pass or fail, so a red run and the runs
// that went green after it stay comparable. One JSON line per gate in tmp/verify/gates.jsonl.
// It also records the GPU at measurement time: a red gate on a software rasterizer (or a different
// adapter) is a machine problem, not a regression, and must be diagnosable from the log alone.
// A value measured on a contended machine (external GPU/CPU load above contention.config.ts, lock not
// held, software renderer) is PROVISIONAL: recorded and printed, then the test is skipped, so it counts
// as neither pass nor fail.

const SOFTWARE = /swiftshader|warp|basic render|llvmpipe|softpipe|software/i;

interface GpuInfo {
  /** Page WebGL renderer: the same GPU process the game's canvas uses. */
  renderer: string;
  /** Pose worker's WebGL renderer and MediaPipe delegate, when the pose pipeline is running. */
  poseGpu: string | null;
  poseDelegate: string | null;
  software: boolean;
}

async function gpuInfo(page: Page): Promise<GpuInfo> {
  const g = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl
      ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
      : 'no webgl2';
    const pose = window.__game?.getPoseStats?.() ?? null;
    return { renderer, poseGpu: pose?.gpu ?? null, poseDelegate: pose?.delegate ?? null };
  });
  return { ...g, software: SOFTWARE.test(g.renderer) || SOFTWARE.test(g.poseGpu ?? '') };
}

export async function recordGate(
  page: Page,
  gate: string,
  samples: Record<string, readonly number[]>,
  limits: Record<string, string>,
): Promise<void> {
  const gpu = await gpuInfo(page);
  const machine = await machineState();
  const provisional = contention(machine, gpu.software);
  const round = (n: number) => Math.round(n * 10) / 10;
  const stats = Object.fromEntries(
    Object.entries(samples).map(([k, v]) => [
      k,
      {
        min: round(Math.min(...v)),
        mean: round(v.reduce((a, b) => a + b, 0) / v.length),
        samples: v.map(round),
      },
    ]),
  );
  const line = {
    at: new Date().toISOString(),
    gate,
    retry: test.info().retry,
    limits,
    status: provisional.length ? 'provisional' : 'measured',
    provisional,
    gpu,
    machine,
    ...stats,
  };
  mkdirSync('tmp/verify', { recursive: true });
  appendFileSync('tmp/verify/gates.jsonl', JSON.stringify(line) + '\n');
  const brief = Object.entries(stats).map(([k, s]) => `${k} min ${s.min} mean ${s.mean}`);
  console.info(`GATE ${gate}: ${brief.join(' · ')} (limits ${JSON.stringify(limits)})`);
  console.info(
    `GATE ${gate} gpu: ${gpu.renderer} · pose ${gpu.poseDelegate ?? '-'} ${gpu.poseGpu ?? ''}` +
      (gpu.software ? ' · SOFTWARE RENDERER: perf numbers are not comparable' : ''),
  );
  const nv = machine.nvidia;
  const gpuTop = machine.topExternalGpu.map((p) => `${p.name} ${p.pct}%`).join(', ') || '-';
  const cpuTop = machine.topExternalCpu.map((p) => `${p.name} ${p.cores}`).join(', ') || '-';
  console.info(
    `GATE ${gate} machine: external GPU ${machine.externalGpuPct ?? '?'}% (own ${machine.ownGpuPct ?? '?'}%) [${gpuTop}]` +
      ` · external CPU ${machine.externalCpuCores ?? '?'} cores [${cpuTop}] · cpu total ${machine.cpuBusyPct ?? '?'}%` +
      (nv
        ? ` · nvidia ${nv.utilPct}% ${nv.tempC}°C ${nv.pstate} throttle ${nv.clockEventReasons}`
        : '') +
      ` · lock ${machine.lockHeld ? 'held' : 'NOT HELD'}`,
  );
  if (provisional.length) {
    const why = `PROVISIONAL (${provisional.join('; ')}): not a pass or fail. Re-measure on a quiet machine.`;
    console.info(`GATE ${gate} ${why}`);
    test.info().annotations.push({ type: 'provisional', description: why });
    test.skip(true, why);
  }
}
