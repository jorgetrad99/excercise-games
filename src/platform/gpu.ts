// Is WebGL running on the GPU? Chrome silently falls back to a CPU rasterizer (WARP, SwiftShader) when
// it won't use the graphics card (blocklisted driver, "Use graphics acceleration" off, repeated GPU
// crashes). Everything still works, ~20× slower: measured render 60 → 22–32 fps and pose 30 → 2–5 fps.

const SOFTWARE = /swiftshader|warp|basic render|llvmpipe|softpipe|software/i;

/** The unmasked GL renderer string ("ANGLE (NVIDIA …)"), or the masked one where that is hidden. */
export function glRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
}

export const isSoftwareRenderer = (renderer: string): boolean => SOFTWARE.test(renderer);

/** Shown once per page when any context (page or pose worker) turns out to be software. */
export function warnSoftwareGl(where: string, renderer: string): void {
  console.warn(`${where}: WebGL is software-rendered (${renderer})`);
  if (typeof document === 'undefined' || document.querySelector('.gpu-warning')) return;
  const el = Object.assign(document.createElement('div'), {
    className: 'gpu-warning',
    textContent:
      'Your browser is not using the graphics card (WebGL runs in software), so the game and body ' +
      'tracking will be very slow. Turn on "Use graphics acceleration when available" in the ' +
      'browser settings, restart it, and check chrome://gpu.',
  });
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: '16px',
    transform: 'translateX(-50%)',
    maxWidth: 'min(720px, calc(100vw - 32px))',
    padding: '10px 16px',
    borderRadius: '10px',
    background: '#c1121fee',
    color: '#fff',
    font: '600 15px/1.4 system-ui, sans-serif',
    zIndex: '1000',
  });
  document.body.append(el);
}
