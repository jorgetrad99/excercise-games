import { describe, expect, it } from 'vitest';
import { correlate, parseNvidia, parseTypeperf } from '../../scripts/sweep-telemetry.mjs';

describe('sweep telemetry: which GPU reading moves with 2P pose-fps', () => {
  it('parses nvidia-smi and typeperf lines into timed rows', () => {
    const nv = parseNvidia(
      '2026/09/17 00:36:35.358, 40, 50, 1665, 19.57, P0, 0x0000000000000001\n' +
        '2026/09/17 00:36:36.360, 41, 51, 800, 12.00, P3, 0x0000000000000004\n',
    );
    expect(nv).toHaveLength(2);
    expect(nv[0]).toMatchObject({ gpuUtil: 40, tempC: 50, clockMhz: 1665, throttled: 0 });
    expect(nv[1]!.throttled).toBe(1);
    expect(nv[1]!.at - nv[0]!.at).toBe(1002);

    const tp = parseTypeperf(
      '"(PDH-CSV 4.0)","\\\\H\\GPU Engine(pid_1_luid_0x00000000_0x00013D0E_phys_0_eng_0_engtype_3D)\\U","\\\\H\\GPU Engine(pid_1_luid_0x00000000_0x00018714_phys_0_eng_0_engtype_3D)\\U","\\\\H\\GPU Engine(pid_1_luid_0x00000000_0x00018714_phys_0_eng_1_engtype_3D)\\U"\r\n' +
        '"09/17/2026 00:36:42.619","13.5","2.0","3.0"\r\n',
    );
    expect(tp[0]).toMatchObject({ dwm_0x00013D0E: 13.5, dwm_0x00018714: 5 });
    expect(tp[0]!.at).toBe(new Date(2026, 8, 17, 0, 36, 42, 619).getTime());
  });

  it('finds the reading that tracks the scatter and ignores runs under heavy CPU load', () => {
    const t0 = 1_000_000;
    // Four runs; pose-fps follows the GPU clock, temperature is flat noise.
    const clocks = [1600, 900, 1500, 1000];
    const points = clocks.map((clock, run) => {
      const pose = clock / 60; // 26.7, 15, 25, 16.7
      return {
        id: 'skate-2p-pose',
        level: 0,
        poseMean: pose,
        series: [0, 1, 2].map((s) => ({
          at: t0 + run * 10_000 + s * 1000,
          fps: 60,
          poseFps: pose + (s - 1) * 0.1,
          inferMs: 26,
        })),
      };
    });
    points.push({ ...points[0]!, level: 14, poseMean: 5 }); // CPU-saturated: excluded
    const telemetry = clocks.flatMap((clock, run) =>
      [0, 1, 2].map((s) => ({
        at: t0 + run * 10_000 + s * 1000 + 200,
        clockMhz: clock,
        tempC: 50 + ((run + s) % 2),
      })),
    );
    const c = correlate(points, telemetry);
    expect(c.runs).toBe(4);
    expect(c.r.clockMhz!.perRun).toBeGreaterThan(0.99);
    expect(c.r.clockMhz!.perSecond).toBeGreaterThan(0.99);
    expect(Math.abs(c.r.tempC!.perRun ?? 0)).toBeLessThan(0.5);
  });
});
