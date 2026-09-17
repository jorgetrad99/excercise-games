import { appendFileSync, mkdirSync } from 'node:fs';
import { test } from '@playwright/test';

// Every perf gate writes what it measured before asserting, pass or fail, so a red run and the runs
// that went green after it stay comparable. One JSON line per gate in tmp/verify/gates.jsonl.
export function recordGate(
  gate: string,
  samples: Record<string, readonly number[]>,
  limits: Record<string, string>,
): void {
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
    ...stats,
  };
  mkdirSync('tmp/verify', { recursive: true });
  appendFileSync('tmp/verify/gates.jsonl', JSON.stringify(line) + '\n');
  const brief = Object.entries(stats).map(([k, s]) => `${k} min ${s.min} mean ${s.mean}`);
  console.info(`GATE ${gate}: ${brief.join(' · ')} (limits ${JSON.stringify(limits)})`);
}
