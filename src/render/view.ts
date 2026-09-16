// Skate Run view: scene, follow camera, lights, biome fog; renders a SimState (PLAN §3 View.render).
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  type Object3D,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { simConfig } from '../core/sim.config';
import type { SimState } from '../core/types';
import { biomeAt } from '../core/worldgen';
import { BIOME_LOOKS } from './biomes';
import type { ModelId } from './models';
import { createRenderer, fitToCanvas } from './renderer';
import { createSkater } from './skater';
import { createWorldView } from './world-view';

export interface RenderStats {
  frames: number;
  calls: number;
  triangles: number;
}

export interface GameView {
  /** `alpha` = fraction of a sim tick since the state, for smooth motion at any refresh rate. */
  render(s: Readonly<SimState>, alpha: number): void;
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

export function createGameView(
  canvas: HTMLCanvasElement,
  models: Record<ModelId, Object3D>,
): GameView {
  const renderer = createRenderer(canvas);
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
  const skater = createSkater();
  scene.add(world.object, skater.object);
  let frames = 0;

  return {
    render(s, alpha) {
      frames++;
      if (fitToCanvas(renderer, canvas)) {
        camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
        camera.updateProjectionMatrix();
      }
      const moving = s.phase === 'running';
      const distance = s.distance + (moving ? s.speed * alpha * simConfig.fixedDt : 0);
      const look = BIOME_LOOKS[biomeAt(distance)];
      sky.set(look.sky);
      fog.color.set(look.sky);
      Object.assign(fog, { near: look.fogNear, far: look.fogFar });
      hemi.color.set(look.hemiSky);
      hemi.groundColor.set(look.hemiGround);

      world.update(s, distance);
      skater.update(s, s.x);
      // Camera is a pure function of state (no smoothing memory) so screenshots are reproducible.
      camera.position.set(s.x * 0.65, 3.6 + s.y * 0.35, 6.4);
      camera.lookAt(s.x * 0.8, 1.3 + s.y * 0.25, -9);
      sun.position.set(s.x - 6, 14, 6);
      sun.target.position.set(s.x, 0, -4);
      renderer.render(scene, camera);
    },
    stats: () => ({
      frames,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    }),
  };
}
