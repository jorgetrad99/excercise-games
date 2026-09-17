// Renderer factory (ADR-001): the only place that picks WebGLRenderer. Swap to WebGPURenderer here.
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, Vector2, WebGLRenderer } from 'three';
import { glRenderer, isSoftwareRenderer, warnSoftwareGl } from '../platform/gpu';

export function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const gpu = glRenderer(renderer.getContext());
  if (isSoftwareRenderer(gpu)) warnSoftwareGl('renderer', gpu);
  return renderer;
}

/** Match the drawing buffer to the canvas' CSS size; returns true when it changed. */
export function fitToCanvas(renderer: WebGLRenderer, canvas: HTMLCanvasElement): boolean {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const size = renderer.getSize(new Vector2());
  if (size.x === w && size.y === h) return false;
  renderer.setSize(w, h, false);
  return true;
}
