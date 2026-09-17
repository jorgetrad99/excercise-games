// Skate Run view: scene, follow camera, lights, biome fog; renders a SimState (PLAN §3 View.render).
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { SimState } from '../core/types';
import { biomeAt } from '../core/worldgen';
import { BIOME_LOOKS } from './biomes';
import type { RenderPose } from './interp';
import type { LoadedModel, ModelId } from './models';
import { createRenderer, fitToCanvas } from './renderer';
import { createSkater } from './skater';
import { createWorldView } from './world-view';

export interface RenderStats {
  frames: number;
  calls: number;
  triangles: number;
  /** Games with bodies (Boxing): each character's head and gloves as last drawn (1P: the only slot), world m. */
  rig?: RigProbe[];
}

type P3 = [number, number, number];
export interface RigProbe {
  head: P3;
  gloves: [P3, P3];
}

/** Which horizontal slice of the canvas to draw into (split screen): slot `index` of `count`. */
export interface Viewport {
  index: number;
  count: number;
}

export interface GameView {
  /** Split screen: call once per player per frame, in index order (stats reset at index 0). */
  render(s: Readonly<SimState>, pose: RenderPose, viewport?: Viewport): void;
  stats(): RenderStats;
}

function addLights(scene: Scene): { hemi: HemisphereLight; sun: DirectionalLight } {
  const hemi = new HemisphereLight('#fff', '#888', 1.4);
  const sun = new DirectionalLight('#fff4e0', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {
    left: -10,
    right: 10,
    top: 14,
    bottom: -14,
    near: 1,
    far: 60,
  });
  sun.shadow.bias = -0.0005;
  scene.add(hemi, sun, sun.target);
  return { hemi, sun };
}

/** Point the renderer and camera at a player's vertical slice of the canvas (the whole canvas for 1). */
export function useSlot(
  renderer: WebGLRenderer,
  camera: PerspectiveCamera,
  canvas: HTMLCanvasElement,
  { index, count }: Viewport,
): void {
  fitToCanvas(renderer, canvas);
  // Whole CSS pixels so halves neither overlap nor leave a seam; the last slot takes the remainder.
  const slot = Math.floor(canvas.clientWidth / count);
  const x = index * slot;
  const w = index === count - 1 ? canvas.clientWidth - x : slot;
  const h = Math.max(1, canvas.clientHeight);
  if (camera.aspect !== w / h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  renderer.setViewport(x, 0, w, h);
  renderer.setScissor(x, 0, w, h);
  renderer.setScissorTest(count > 1);
}

export function createGameView(
  canvas: HTMLCanvasElement,
  models: Record<ModelId, LoadedModel>,
): GameView {
  const renderer = createRenderer(canvas);
  renderer.info.autoReset = false; // one frame can be several render() calls (split screen)
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  // ponytail: RoomEnvironment instead of a Poly Haven HDRI (PLAN M4 lighting); swap when art is locked.
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  scene.environmentIntensity = 0.35;
  const fog = new Fog('#fff', 40, 190);
  scene.fog = fog;
  const sky = new Color();
  scene.background = sky;

  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 400);
  const { hemi, sun } = addLights(scene);

  const world = createWorldView(models);
  const skater = createSkater(models.skater);
  scene.add(world.object, skater.object);
  let frames = 0;

  return {
    render(s, pose, { index, count } = { index: 0, count: 1 }) {
      if (index === 0) {
        frames++;
        renderer.info.reset();
      }
      useSlot(renderer, camera, canvas, { index, count });
      const { distance, x, y } = pose;
      const look = BIOME_LOOKS[biomeAt(distance)];
      sky.set(look.sky);
      fog.color.set(look.sky);
      Object.assign(fog, { near: look.fogNear, far: look.fogFar });
      hemi.color.set(look.hemiSky);
      hemi.groundColor.set(look.hemiGround);

      world.update(s, distance);
      skater.update(s, pose);
      // Camera is a pure function of state (no smoothing memory) so screenshots are reproducible.
      camera.position.set(x * 0.7, 2.8 + y * 0.35, 4.2);
      camera.lookAt(x * 0.85, 0.8 + y * 0.25, -9);
      sun.position.set(x - 6, 14, 6);
      sun.target.position.set(x, 0, -4);
      renderer.render(scene, camera);
    },
    stats: () => ({
      frames,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    }),
  };
}
