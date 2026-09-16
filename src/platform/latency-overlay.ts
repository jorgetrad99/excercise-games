// ?latency=1: live per-stage latency table + a flash square for measuring motion-to-photon on camera.
// Film yourself AND the screen with a phone at 240 fps; count frames from the start of the movement
// to the square turning white. Software can't see sensor/USB time or display scan-out; this can.
import type { LatencySummary, Stat } from './latency';

const fmt = (s: Stat): string =>
  s.n === 0 ? '   —' : `${s.p50.toFixed(1).padStart(6)} ${s.p95.toFixed(1).padStart(6)}  n=${s.n}`;

export function mountLatencyOverlay(root: HTMLElement, summary: () => LatencySummary) {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;left:12px;bottom:48px;font:12px/1.35 ui-monospace,monospace;color:#fff;background:#000b;padding:8px 10px;border-radius:6px;pointer-events:none;white-space:pre';
  const flash = document.createElement('div');
  flash.style.cssText =
    'position:fixed;right:16px;bottom:16px;width:96px;height:96px;background:#000;border:2px solid #fff';
  root.append(box, flash);
  let flashUntil = 0;
  setInterval(() => {
    const s = summary();
    const rows = (group: Record<string, Stat>) =>
      Object.entries(group).map(([k, v]) => `  ${k.padEnd(20)}${fmt(v)}`);
    box.textContent = [
      'latency ms            p50    p95',
      'pose pipeline (per frame)',
      ...rows(s.pipeline),
      'pose events',
      ...rows(s.poseEvents),
      'keyboard events',
      ...rows(s.keyEvents),
      `display ${s.display.refreshHz.toFixed(0)} Hz, frame ${fmt(s.display.frameMs)}`,
      `judder fwd mm/frame ${fmt(s.display.judderForwardMm)}`,
      `judder lat mm/frame ${fmt(s.display.judderLateralMm)}`,
    ].join('\n');
  }, 250);
  return {
    /** A gesture/key event was rendered this frame: flash for 100 ms. */
    onEventRendered(now: number): void {
      flashUntil = now + 100;
    },
    frame(now: number): void {
      flash.style.background = now < flashUntil ? '#fff' : '#000';
    },
  };
}
