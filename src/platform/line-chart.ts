// A small single-series line chart on a 2D canvas: a stat across a player's matches. Hand-drawn
// instead of a chart library (no dependency, no ADR): one series, a zero-based y axis, a crosshair
// tooltip. Colors come from the dataviz reference palette (dark steps), checked against the menu's
// #1b1f3b surface with its validator.

const INK = { series: '#3987e5', grid: '#ffffff22', axis: '#ffffff99', text: '#ffffffde' };
const PAD = { left: 40, right: 16, top: 12, bottom: 24 };

export interface ChartPoint {
  value: number;
  /** Tooltip text for this point (value first). */
  label: string;
}

/** A round axis top ≥ max and its gridline step (1-2-5 steps; 3–5 lines; whole steps for counts). */
export function niceScale(max: number, integer = true): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const nice = ([1, 2, 5, 10].find((k) => k * mag >= raw) ?? 10) * mag;
  const step = integer ? Math.max(1, nice) : nice;
  return { top: +(Math.ceil(max / step - 1e-9) * step).toFixed(9), step };
}

/** "cleanHits" → "clean hits". */
export const statLabel = (key: string): string =>
  key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

export function mountLineChart(
  root: HTMLElement,
  title: string,
  points: readonly ChartPoint[],
): void {
  const figure = document.createElement('figure');
  figure.className = 'chart';
  const last = points.at(-1);
  const best = Math.max(...points.map((p) => p.value));
  figure.innerHTML = `<figcaption>${title}</figcaption><canvas></canvas><div class="readout"></div>`;
  const canvas = figure.querySelector('canvas')!;
  // Hover readout under the plot (never covers a neighbour); shows the latest match otherwise.
  const readout = figure.querySelector<HTMLElement>('.readout')!;
  readout.textContent = last ? `Latest: ${last.label}` : '';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    `${title} over ${points.length} matches: latest ${last?.value ?? 0}, best ${best}`,
  );
  root.append(figure);
  const { width, height } = { width: 360, height: 150 };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  Object.assign(canvas, { width: width * dpr, height: height * dpr });
  Object.assign(canvas.style, { width: `${width}px`, height: `${height}px` });
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const { top, step } = niceScale(best, points.every((p) => Number.isInteger(p.value)));
  const x = (i: number) =>
    PAD.left + (points.length < 2 ? 0.5 : i / (points.length - 1)) * (width - PAD.left - PAD.right);
  const y = (v: number) => height - PAD.bottom - (v / top) * (height - PAD.top - PAD.bottom);
  const draw = (hover: number | null): void => {
    ctx.clearRect(0, 0, width, height);
    drawAxes(ctx, { width, height, top, step, count: points.length, y });
    drawSeries(ctx, points, x, y, hover);
  };
  draw(null);
  const nearest = (clientX: number): number => {
    const px = clientX - canvas.getBoundingClientRect().left;
    let best = 0;
    points.forEach((_, i) => Math.abs(x(i) - px) < Math.abs(x(best) - px) && (best = i));
    return best;
  };
  canvas.onpointermove = (e) => {
    const i = nearest(e.clientX);
    draw(i);
    readout.textContent = points[i]!.label;
  };
  canvas.onpointerleave = () => {
    draw(null);
    readout.textContent = last ? `Latest: ${last.label}` : '';
  };
}

interface AxisGeometry {
  width: number;
  height: number;
  top: number;
  step: number;
  count: number;
  y: (v: number) => number;
}

function drawAxes(ctx: CanvasRenderingContext2D, g: AxisGeometry): void {
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= g.top + 1e-9; v += g.step) {
    ctx.strokeStyle = v === 0 ? INK.axis : INK.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, Math.round(g.y(v)) + 0.5);
    ctx.lineTo(g.width - PAD.right, Math.round(g.y(v)) + 0.5);
    ctx.stroke();
    ctx.fillStyle = INK.text;
    ctx.fillText(String(+v.toFixed(2)), PAD.left - 6, g.y(v));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(g.count === 1 ? 'match 1' : `matches 1–${g.count}`, g.width / 2, g.height - 6);
}

function drawSeries(
  ctx: CanvasRenderingContext2D,
  points: readonly ChartPoint[],
  x: (i: number) => number,
  y: (v: number) => number,
  hover: number | null,
): void {
  ctx.strokeStyle = INK.series;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p.value)) : ctx.lineTo(x(i), y(p.value))));
  ctx.stroke();
  // Markers only where they stay readable; the hovered and latest points always get one.
  points.forEach((p, i) => {
    if (points.length > 30 && i !== hover && i !== points.length - 1) return;
    ctx.fillStyle = INK.series;
    ctx.strokeStyle = '#1b1f3b'; // 2px surface ring
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x(i), y(p.value), i === hover ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  if (hover !== null) {
    ctx.strokeStyle = INK.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x(hover)) + 0.5, PAD.top);
    ctx.lineTo(Math.round(x(hover)) + 0.5, y(0));
    ctx.stroke();
  }
}
