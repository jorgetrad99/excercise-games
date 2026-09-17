import { appendFileSync, mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { machineState } from './machine-state';

// Every perf gate writes what it measured before asserting, pass or fail, so a red run and the runs
// that went green after it stay comparable. One JSON line per gate in tmp/verify/gates.jsonl.
// It also records the GPU at measurement time: a red gate on a software rasterizer (or a different
// adapter) is a machine problem, not a regression, and must be diagnosable from the log alone.

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
  const others = machine.otherHeavy.map((p) => `${p.pid} ${p.cmd.slice(0, 60)}`);
  console.info(
    `GATE ${gate} machine: cpu ${machine.cpuBusyPct}% · gpu ${machine.gpuUtilPct ?? '-'}% · lock ${machine.lockHeld ? 'held' : 'NOT HELD'}` +
      ` · other heavy: ${others.length ? `${others.length} CONTENDED [${others.join(' | ')}]` : 'none'}`,
  );
}
