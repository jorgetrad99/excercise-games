import { describe, expect, it } from 'vitest';
import { gateCoverage, type GateOutcome } from '../e2e/gate-coverage-reporter';

const measured = (status: GateOutcome['status']): GateOutcome => ({ status, provisional: false });
const provisional: GateOutcome = { status: 'skipped', provisional: true };

describe('gate coverage: a run that measured no gates is not green', () => {
  it('every gate provisional → none measured', () => {
    expect(gateCoverage([provisional, provisional, provisional])).toEqual({
      measured: 0,
      provisional: 3,
      noneMeasured: true,
    });
  });

  it('one real measurement is enough, pass or fail', () => {
    expect(gateCoverage([provisional, measured('passed')]).noneMeasured).toBe(false);
    expect(gateCoverage([provisional, measured('failed')]).noneMeasured).toBe(false);
  });

  it('a gate skipped for another reason did not measure either', () => {
    expect(gateCoverage([measured('skipped')]).noneMeasured).toBe(true);
  });

  it('no gates selected (smoke-only run) is not a coverage failure', () => {
    expect(gateCoverage([]).noneMeasured).toBe(false);
  });
});
