// ?debug=1 signal HUD: last 5 s of leanX / hipRise / headDrop with the config thresholds drawn, plus state + events.
import type { GestureConfig } from './gestures.config';
import type { SignalFrame } from './gestures';

const WINDOW_MS = 5000;
const W = 520;
const PLOT_H = 70;

interface Plot {
  label: string;
  value: (s: SignalFrame) => number;
  range: [number, number];
  lines: { at: number; color: string }[];
}

function plots(cfg: GestureConfig): Plot[] {
  const enter = '#f55';
  const exit = '#fb3';
  return [
    {
      label: 'leanX (shoulders)',
      value: (s) => s.leanX,
      range: [-1, 1],
      lines: [
        { at: -cfg.lean.enter, color: enter },
        { at: cfg.lean.enter, color: enter },
        { at: -cfg.lean.rearm, color: exit },
        { at: cfg.lean.rearm, color: exit },
      ],
    },
    {
      label: `hipRise (torso) · vel gate ${cfg.jump.velocity}/s`,
      value: (s) => s.hipRise,
      range: [-0.5, 0.8],
      lines: [
        { at: cfg.jump.rise, color: enter },
        { at: cfg.jump.landRise, color: exit },
      ],
    },
    {
      label: 'headDrop (torso)',
      value: (s) => s.headDrop,
      range: [-0.5, 0.8],
      lines: [
        { at: cfg.slide.enter, color: enter },
        { at: cfg.slide.exit, color: exit },
      ],
    },
  ];
}

function drawPlot(
  ctx: CanvasRenderingContext2D,
  p: Plot,
  top: number,
  history: SignalFrame[],
  now: number,
): void {
  const [lo, hi] = p.range;
  const y = (v: number) =>
    top + PLOT_H - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * PLOT_H;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, top, W, PLOT_H);
  for (const [at, color] of [
    [0, '#555'] as const,
    ...p.lines.map((l) => [l.at, l.color] as const),
  ]) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, y(at));
    ctx.lineTo(W, y(at));
    ctx.stroke();
  }
  ctx.strokeStyle = '#3ef';
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((s, i) => {
    const x = W - ((now - s.t) / WINDOW_MS) * W;
    if (i === 0) ctx.moveTo(x, y(p.value(s)));
    else ctx.lineTo(x, y(p.value(s)));
  });
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = '#ccc';
  ctx.fillText(p.label, 6, top + 12);
}

function statusText(s: SignalFrame | undefined): string {
  if (!s) return 'no signals yet';
  const c = s.calibration;
  const calib =
    c.state === 'calibrating' ? `calibrating ${Math.round(c.progress * 100)}%` : c.state;
  return `${calib} · tracking ${s.tracking} · armsUp ${s.armsUp} · T-pose ${s.tPose} · zone ${s.zone} · vel ${s.hipRiseVel.toFixed(2)}`;
}

export function mountSignalHud(root: HTMLElement, cfg: GestureConfig) {
  const canvas = Object.assign(document.createElement('canvas'), {
    width: W,
    height: 3 * (PLOT_H + 4) + 150,
  });
  Object.assign(canvas.style, {
    position: 'fixed',
    right: '12px',
    bottom: '12px',
    background: '#111',
    font: '12px monospace',
  });
  canvas.className = 'signal-hud';
  root.append(canvas);
  const ctx = canvas.getContext('2d')!;
  const history: SignalFrame[] = [];
  const events: { t: number; type: string }[] = [];

  const draw = (): void => {
    const latest = history.at(-1);
    const now = latest?.t ?? 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px monospace';
    plots(cfg).forEach((p, i) => drawPlot(ctx, p, i * (PLOT_H + 4), history, now));
    const top = 3 * (PLOT_H + 4) + 16;
    ctx.fillStyle = '#eee';
    ctx.fillText(statusText(latest), 6, top);
    events
      .slice(-7)
      .forEach((e, i) =>
        ctx.fillText(`${(e.t / 1000).toFixed(2)}s ${e.type}`, 6, top + 18 * (i + 1)),
      );
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  return {
    signals(s: SignalFrame): void {
      history.push(s);
      while (history.length > 0 && history[0]!.t < s.t - WINDOW_MS) history.shift();
    },
    event(e: { t: number; type: string }): void {
      events.push(e);
      if (events.length > 50) events.shift();
    },
  };
}
