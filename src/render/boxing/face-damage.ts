import type { FaceDamage } from './presentation';

/** Bruise centres on the face canvas (0..1, y down) per FaceDamage zone. Camera crops are unmirrored:
 * the anatomical left cheek is on image-right. swelling.ts bulges the head at the same spots. */
export const BRUISE_SPOTS = [
  [0.68, 0.56],
  [0.32, 0.56],
  [0.5, 0.79],
] as const;

/** Head skin, sRGB: the shell's colour and the face texture's background, so the two meet seamlessly. */
export const SKIN = '#edb98d';
const SKIN_RGB = '237,185,141';

/** Blend cartoon bruises onto a private copy, never onto the shared camera crop. */
export function paintFace(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement | null,
  damage: FaceDamage,
): void {
  const size = ctx.canvas.width;
  // Opaque everywhere: transparent texels outside the oval filtered into a dark fringe on the head.
  ctx.fillStyle = SKIN;
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(size / 2, size / 2, size * 0.4, size * 0.48, 0, 0, Math.PI * 2);
  ctx.clip();
  if (source) ctx.drawImage(source, 0, 0, size, size);
  else drawFallback(ctx, size);
  featherEdge(ctx, size);
  BRUISE_SPOTS.forEach(([x, y], i) => {
    const strength = damage[i]!;
    if (!strength) return;
    ctx.save();
    ctx.translate(x * size, y * size);
    ctx.scale(1, 0.78);
    const radius = size * (0.1 + strength * 0.08);
    const bruise = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    bruise.addColorStop(0, `rgba(91,38,103,${strength * 0.75})`);
    bruise.addColorStop(0.48, `rgba(167,44,67,${strength * 0.65})`);
    bruise.addColorStop(1, 'rgba(221,67,70,0)');
    ctx.fillStyle = bruise;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.strokeStyle = `rgba(255,194,161,${strength * 0.65})`;
    ctx.lineWidth = size * 0.018;
    ctx.beginPath();
    ctx.arc(0, size * 0.012, radius * 0.6, 0.2, 2.8);
    ctx.stroke();
    ctx.restore();
  });
  ctx.restore();
}

/** Skin fades in over the oval's outer rim, so the camera crop blends into the head instead of ending
 * on a hard line. */
function featherEdge(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(1, 1.2); // the oval is 0.4 × 0.48 of the canvas
  const r = size * 0.4;
  const rim = ctx.createRadialGradient(0, 0, r * 0.8, 0, 0, r);
  rim.addColorStop(0, `rgba(${SKIN_RGB},0)`);
  rim.addColorStop(1, `rgba(${SKIN_RGB},1)`);
  ctx.fillStyle = rim;
  ctx.fillRect(-r, -r, 2 * r, 2 * r);
  ctx.restore();
}

function drawFallback(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#253047';
  for (const x of [0.35, 0.65]) {
    ctx.beginPath();
    ctx.ellipse(x * size, size * 0.44, size * 0.035, size * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#703d42';
  ctx.lineWidth = size * 0.02;
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.61, size * 0.12, 0.15, Math.PI - 0.15);
  ctx.stroke();
}
