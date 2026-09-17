// Capture wizard demos (Jorge 2026-09-17): a looping stick figure per step, so a player who has never
// boxed sees the move before recording it. Keyframes of 5 posture numbers → 3D joints → two views.
// Seen from behind (not facing you) so the figure's right is your right: B1 is a handedness question.

/** Degrees for `yaw` (+ = right shoulder forward); the rest are 0..1 blends from arms-relaxed. */
export interface Posture {
  yaw: number;
  guard: number;
  right: number;
  left: number;
  /** Left arm straight up. */
  up: number;
}
type Key = readonly [ms: number, posture: Partial<Posture>];

const REST: Posture = { yaw: 0, guard: 0, right: 0, left: 0, up: 0 };
const GUARD = { guard: 1 };

/** `n` punches from guard, turning the body `yaw` into each. Slower than real punches: it's for learning. */
function punches(n: number, side: 'right' | 'left', yaw: number): Key[] {
  const out = { guard: 1, [side]: 1, yaw };
  const keys: Key[] = [[0, GUARD]];
  for (let i = 0, t = 600; i < n; i++, t += 1400)
    keys.push([t, GUARD], [t + 300, out], [t + 650, out], [t + 1050, GUARD]);
  keys.push([600 + n * 1400 + 500, GUARD]);
  return keys;
}

/** By step id (capture-scripts.ts). The last key equals the first, so the loop has no jump. */
export const DEMOS: Record<string, readonly Key[]> = {
  'left-hand-overhead': [
    [0, {}],
    [400, {}],
    [1200, { up: 1 }],
    [3200, { up: 1 }],
    [3900, {}],
  ],
  still: [
    [0, {}],
    [1000, {}],
  ],
  guard: [
    [0, {}],
    [400, {}],
    [1200, GUARD],
    [3400, GUARD],
    [4000, {}],
  ],
  'square-right-x3': punches(3, 'right', 0),
  'natural-right-x3': punches(3, 'right', 45),
  'left-x1': punches(1, 'left', -15),
};

/** The behind view's orbit per demo, degrees (see View.yaw): the punching fist extends on its own side. */
export const ORBIT: Record<string, number> = {
  'square-right-x3': -40,
  'natural-right-x3': -40,
  'left-x1': 40,
};

const ease = (x: number): number => x * x * (3 - 2 * x);

export function postureAt(keys: readonly Key[], ms: number): Posture {
  const loop = keys[keys.length - 1]![0];
  const t = loop > 0 ? ms % loop : 0;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]![0] <= t) i++;
  const [t0, a] = keys[i]!;
  const [t1, b] = keys[i + 1] ?? keys[i]!;
  const k = t1 > t0 ? ease(Math.min(1, (t - t0) / (t1 - t0))) : 0;
  const from = { ...REST, ...a };
  const to = { ...REST, ...b };
  const mix = (n: keyof Posture): number => from[n] + (to[n] - from[n]) * k;
  return {
    yaw: mix('yaw'),
    guard: mix('guard'),
    right: mix('right'),
    left: mix('left'),
    up: mix('up'),
  };
}

/** Metres: x = the player's right, y = up, z = toward the screen. */
export type V = [number, number, number];
export type Joint =
  | 'head'
  | 'neck'
  | 'pelvis'
  | 'lSh'
  | 'rSh'
  | 'lEl'
  | 'rEl'
  | 'lFist'
  | 'rFist'
  | 'lHip'
  | 'rHip'
  | 'lKnee'
  | 'rKnee'
  | 'lFoot'
  | 'rFoot';

const lerp = (a: V, b: V, k: number): V => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const rotY = ([x, y, z]: V, deg: number): V => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return [x * c - z * s, y, x * s + z * c];
};

/** [elbow, fist] for side +1 (right) or −1 (left): relaxed → guard (turns with the torso) → punch. */
function arm(side: 1 | -1, p: Posture, shoulder: V, extend: number): [V, V] {
  const body = (x: number, y: number, z: number): V => rotY([x * side, y, z], p.yaw);
  const fist = lerp(body(0.24, 0.85, 0.02), body(0.09, 1.52, 0.22), p.guard);
  const elbow = lerp(body(0.24, 1.15, 0), body(0.16, 1.2, 0.12), p.guard);
  // A straight goes to the middle, as far as the shoulder reaches: turning the body adds reach.
  const punched = lerp(fist, [0.04 * side, 1.5, shoulder[2] + 0.62], extend);
  return [lerp(elbow, lerp(shoulder, punched, 0.5), extend), punched];
}

export function joints(p: Posture): Record<Joint, V> {
  const lSh = rotY([-0.2, 1.45, 0], p.yaw);
  const rSh = rotY([0.2, 1.45, 0], p.yaw);
  const [rEl, rFist] = arm(1, p, rSh, p.right);
  const [lEl, lFist] = arm(-1, p, lSh, p.left);
  return {
    head: [0, 1.7, 0],
    neck: [0, 1.45, 0],
    pelvis: [0, 1, 0],
    lSh,
    rSh,
    lEl: lerp(lEl, [-0.2, 1.85, 0], p.up),
    rEl,
    lFist: lerp(lFist, [-0.2, 2.2, 0.02], p.up),
    rFist,
    lHip: rotY([-0.13, 1, 0], p.yaw / 2),
    rHip: rotY([0.13, 1, 0], p.yaw / 2),
    lKnee: [-0.15, 0.53, 0.02],
    rKnee: [0.15, 0.53, 0.02],
    lFoot: [-0.18, 0.05, 0],
    rFoot: [0.18, 0.05, 0],
  };
}

// High contrast on the wizard's black box; right/left also carry an R/L letter (not colour alone).
const WHITE = '#fff';
const RIGHT = '#ff9d2e';
const LEFT = '#35d4ff';
const SHOULDERS = '#ffe14d';
const BONES: readonly [Joint, Joint, string][] = [
  ['lFoot', 'lKnee', WHITE],
  ['lKnee', 'lHip', WHITE],
  ['rFoot', 'rKnee', WHITE],
  ['rKnee', 'rHip', WHITE],
  ['lHip', 'rHip', WHITE],
  ['pelvis', 'neck', WHITE],
  ['lSh', 'rSh', SHOULDERS],
  ['rSh', 'rEl', RIGHT],
  ['rEl', 'rFist', RIGHT],
  ['lSh', 'lEl', LEFT],
  ['lEl', 'lFist', LEFT],
];

/** Camera behind the player, pitched down `pitch`° (90 = from above: up the panel = toward the screen),
 *  orbited `yaw`° around it so a punch toward the screen isn't hidden behind the body: − = from behind
 *  the player's left, forward reads screen-right (right punches); + mirrors it (left punches). */
export interface View {
  title: string;
  pitch: number;
  yaw: number;
  centre: V;
  /** Metres the panel's height shows. */
  span: number;
}
export const VIEWS: readonly View[] = [
  { title: 'FROM BEHIND', pitch: 15, yaw: 0, centre: [0, 1.15, 0.3], span: 2.5 },
  { title: 'FROM ABOVE', pitch: 90, yaw: 0, centre: [0, 1.1, 0.3], span: 1.45 },
];

/** Panel-local [x right, y up] in metres, and depth (bigger = farther from the viewer). */
export function project(p: V, v: View): [number, number, number] {
  const a = (v.pitch * Math.PI) / 180;
  const [x, y, z] = rotY([p[0] - v.centre[0], p[1] - v.centre[1], p[2] - v.centre[2]], v.yaw);
  const depth = z * Math.cos(a) - y * Math.sin(a);
  const s = 4 / (4 + depth); // mild perspective: a fist coming at you grows a little
  return [x * s, (y * Math.cos(a) + z * Math.sin(a)) * s, depth];
}

function drawView(
  ctx: CanvasRenderingContext2D,
  j: Record<Joint, V>,
  v: View,
  w: number,
  h: number,
): void {
  const m = (h * 0.86) / v.span; // px per metre; the top 14 % holds the title
  const at = (p: V): [number, number, number] => {
    const [x, y, d] = project(p, v);
    return [w / 2 + x * m, h * 0.57 - y * m, d];
  };
  ctx.fillStyle = '#ffffff14';
  ctx.fillRect(h * 0.01, h * 0.01, w - h * 0.02, h * 0.98);
  ctx.fillStyle = WHITE;
  ctx.font = `700 ${h * 0.075}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(v.title, w / 2, h * 0.07);
  if (v.pitch === 90) {
    // Where the screen is, and a dashed "shoulders square" line to measure the turn against.
    ctx.fillText('▲ SCREEN ▲', w / 2, h * 0.16);
    const [x0, y0] = at([-0.34, 1.45, 0]);
    const [x1] = at([0.34, 1.45, 0]);
    ctx.setLineDash([h * 0.025, h * 0.02]);
    line(ctx, x0, y0, x1, y0, '#ffffff70', h * 0.008);
    ctx.setLineDash([]);
  }
  const draws: [number, () => void][] = BONES.map(([a, b, colour]) => {
    const [ax, ay, ad] = at(j[a]);
    const [bx, by, bd] = at(j[b]);
    const width = h * (colour === SHOULDERS ? 0.05 : 0.035);
    return [(ad + bd) / 2, () => line(ctx, ax, ay, bx, by, colour, width)];
  });
  const [hx, hy, hd] = at(j.head);
  // A ring, drawn first from above: filled, it would cover the shoulder line that shows the turn.
  draws.push([
    v.pitch === 90 ? Infinity : hd,
    () => disc(ctx, hx, hy, 0.1 * m, '#0000', WHITE, h * 0.025),
  ]);
  for (const [fist, colour, letter] of [
    ['rFist', RIGHT, 'R'],
    ['lFist', LEFT, 'L'],
  ] as const) {
    const [fx, fy] = at(j[fist]);
    draws.push([
      -Infinity, // fists on top: which hand moves is the point
      () => {
        disc(ctx, fx, fy, h * 0.05, colour);
        ctx.fillStyle = '#000';
        ctx.font = `900 ${h * 0.065}px system-ui`;
        ctx.fillText(letter, fx, fy + h * 0.004);
      },
    ]);
  }
  draws.sort((a, b) => b[0] - a[0]).forEach(([, draw]) => draw());
}

function line(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: string,
  width: number,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function disc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
  line?: string,
  width = 0,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (!line) return;
  ctx.strokeStyle = line;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Draws step `id`'s demo at `ms` into the canvas, sized to its CSS box. False when the step has none. */
export function drawDemo(canvas: HTMLCanvasElement, id: string, ms: number): boolean {
  const keys = DEMOS[id];
  if (!keys) return false;
  const w = Math.round(canvas.clientWidth * devicePixelRatio);
  const h = Math.round(canvas.clientHeight * devicePixelRatio);
  if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
  const ctx = canvas.getContext('2d');
  if (!ctx || w === 0) return true;
  ctx.clearRect(0, 0, w, h);
  const j = joints(postureAt(keys, ms));
  VIEWS.forEach((v, i) => {
    ctx.save();
    ctx.translate((i * w) / VIEWS.length, 0);
    drawView(ctx, j, i === 0 ? { ...v, yaw: ORBIT[id] ?? 0 } : v, w / VIEWS.length, h);
    ctx.restore();
  });
  return true;
}
