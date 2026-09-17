// Boxing view: a ring, two boxers facing each other, and one camera per player from behind their own
// boxer's eyes (Wii Sports Boxing's over-the-gloves view). The shell passes the shared sim once per
// player, so slot i is drawn from boxer i's side; 1P = boxer 0's view only.
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  type Object3D,
} from 'three';
import type { BoxingSim } from '../../core/boxing/sim';
import type { BoxerId } from '../../core/boxing/types';
import type { FaceFeed } from '../big-head';
import { loadModel } from '../models';
import { createRenderer } from '../renderer';
import { useSlot, type RenderStats } from '../view';
import { createBoxer } from './boxer';
import type { HeadReaction } from './animation';
import { createLiveFeed, type LivePose } from './live-pose';

/** Half the distance between the boxers, m. */
const GAP = 0.78;
const RING = 5.5;

function buildRing(): Object3D {
  const ring = new Mesh(
    new BoxGeometry(RING, 0.3, RING),
    new MeshStandardMaterial({ color: '#2b59c3', roughness: 0.9 }),
  );
  ring.position.y = -0.15;
  ring.receiveShadow = true;
  const post = new MeshStandardMaterial({ color: '#e63946', roughness: 0.6 });
  const rope = new MeshStandardMaterial({ color: '#f1faee', roughness: 0.5 });
  const h = RING / 2 - 0.1;
  for (const [x, z] of [
    [-h, -h],
    [h, -h],
    [-h, h],
    [h, h],
  ] as const) {
    const p = new Mesh(new CylinderGeometry(0.08, 0.08, 1.4, 10), post);
    p.position.set(x, 0.7, z);
    ring.add(p);
  }
  for (const y of [0.5, 0.85, 1.2]) {
    for (const [x, z, long] of [
      [0, -h, 'x'],
      [0, h, 'x'],
      [-h, 0, 'z'],
      [h, 0, 'z'],
    ] as const) {
      const r = new Mesh(
        new BoxGeometry(long === 'x' ? RING : 0.04, 0.04, long === 'z' ? RING : 0.04),
        rope,
      );
      r.position.set(x, y + 0.15, z);
      ring.add(r);
    }
  }
  return ring;
}

function boxingScene(): Scene {
  const scene = new Scene();
  scene.background = new Color('#1b1f3b');
  const hemi = new HemisphereLight('#ffffff', '#445', 1.6);
  const key = new DirectionalLight('#fff4e0', 2.2);
  key.position.set(2, 8, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  scene.add(hemi, key, buildRing());
  return scene;
}

async function loadBoxers() {
  const model = await loadModel('skater');
  const response = await fetch('/assets/quaternius/boxing/hit-head.json');
  if (!response.ok) throw new Error(`Boxing reaction: HTTP ${response.status}`);
  const reaction = (await response.json()) as HeadReaction;
  return [
    createBoxer(model, '#e63946', reaction),
    createBoxer(model, '#2a6fdb', reaction),
  ] as const;
}

/** Boxer 0 stands at +z facing −z (toward boxer 1); boxer 1 at −z facing +z. */
function place(scene: Scene, boxer: Object3D, i: number): Group {
  const holder = new Group(); // the boxer's spot and facing
  holder.position.set(0, 0, i === 0 ? GAP : -GAP);
  holder.rotation.y = i === 0 ? Math.PI : 0;
  holder.add(boxer);
  scene.add(holder);
  return holder;
}

/** 2P: each boxer wears its player's face; 1P: both wear P1's face. */
export async function createBoxingView(canvas: HTMLCanvasElement, faces?: FaceFeed) {
  const renderer = createRenderer(canvas);
  renderer.info.autoReset = false;
  const scene = boxingScene();
  const boxers = await loadBoxers();
  const holders = boxers.map((b, i) => place(scene, b.object, i));
  const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 60);
  const eye = new Vector3();
  const face = new Vector3();
  let frames = 0;
  const liveFeed = createLiveFeed();

  return {
    /** `poses[i]`: player i's live body. 2P: player i is boxer i; 1P: player 0 is boxer 0, 1 is the bot. */
    render(
      sims: readonly BoxingSim[],
      _interpolate: boolean,
      poses: readonly (LivePose | null)[],
    ): null {
      frames++;
      renderer.info.reset();
      const live = liveFeed(poses);
      sims.forEach((sim, index) => {
        const s = sim.getState();
        const me = (index === 1 ? 1 : 0) as BoxerId;
        useSlot(renderer, camera, canvas, { index, count: sims.length });
        boxers.forEach((b, who) =>
          b.update(
            s,
            who as BoxerId,
            who === me,
            faces && { feed: faces, player: sims.length === 2 ? who : 0 },
            live[who],
          ),
        );
        holders.forEach((h) => h.updateMatrixWorld(true));
        boxers[me].eye(eye);
        const them = boxers[me === 0 ? 1 : 0];
        them.object.localToWorld(face.set(0, 1.35, 0));
        camera.position.copy(eye);
        camera.lookAt(face);
        renderer.render(scene, camera);
      });
      return null; // judder tracking follows Skate Run's forward motion; nothing comparable here
    },
    stats: (): RenderStats => ({
      frames,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    }),
  };
}
