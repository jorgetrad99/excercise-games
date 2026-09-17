// `pnpm machine:state`: the same external-load read every perf gate records (tests/e2e/machine-state.ts),
// on demand. Use it for before/after comparisons of machine changes (e.g. which GPU drives a display).
// Writes tmp/machine-state/<label>.json (MACHINE_LABEL, default "now") and prints the summary.
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { contention, machineState } from '../e2e/machine-state';

it('machine state now', async () => {
  const label = process.env.MACHINE_LABEL ?? 'now';
  const s = await machineState();
  const provisional = contention(s, false);
  mkdirSync('tmp/machine-state', { recursive: true });
  const file = `tmp/machine-state/${label}.json`;
  writeFileSync(
    file,
    JSON.stringify({ at: new Date().toISOString(), label, provisional, ...s }, null, 1),
  );
  console.log(
    `external GPU ${s.externalGpuPct}% [${s.topExternalGpu.map((p) => `${p.name} ${p.pct}`).join(', ')}]\n` +
      `external CPU ${s.externalCpuCores} cores [${s.topExternalCpu.map((p) => `${p.name} ${p.cores}`).join(', ')}]\n` +
      `nvidia ${JSON.stringify(s.nvidia)}\n` +
      `would be provisional (ignoring the lock): ${provisional.filter((r) => !r.includes('lock')).join('; ') || 'no'}\n` +
      `→ ${file}`,
  );
}, 60_000);
