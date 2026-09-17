import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

// A provisional gate is skipped (tests/e2e/gates.ts), so a run where every gate was provisional would
// exit 0 having measured nothing. This reporter fails that run: zero-coverage green is not green.

export interface GateOutcome {
  status: TestResult['status'];
  provisional: boolean;
}

export interface GateCoverage {
  measured: number;
  provisional: number;
  /** Selected gates exist and none produced a measurement. */
  noneMeasured: boolean;
}

export function gateCoverage(gates: readonly GateOutcome[]): GateCoverage {
  const provisional = gates.filter((g) => g.provisional).length;
  const measured = gates.filter((g) => !g.provisional && g.status !== 'skipped').length;
  return { measured, provisional, noneMeasured: gates.length > 0 && measured === 0 };
}

const isProvisional = (test: TestCase, result: TestResult): boolean =>
  [...result.annotations, ...test.annotations].some((a) => a.type === 'provisional');

// Playwright loads reporters by default export.
export default class GateCoverageReporter implements Reporter {
  /** Last attempt per gate test (retries replace earlier attempts). */
  private readonly gates = new Map<string, GateOutcome>();

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!test.tags.includes('@perf')) return;
    this.gates.set(test.id, { status: result.status, provisional: isProvisional(test, result) });
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    if (this.gates.size === 0) return undefined;
    const c = gateCoverage([...this.gates.values()]);
    console.info(
      `GATES: ${c.measured} measured, ${c.provisional} provisional, of ${this.gates.size}`,
    );
    if (!c.noneMeasured) return undefined;
    console.error(
      `GATES: no gates measured (${c.provisional} provisional). This run is not a pass; re-measure on a quiet machine.`,
    );
    return { status: result.status === 'passed' ? 'failed' : result.status };
  }
}
