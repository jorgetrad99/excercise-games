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

/** `faces`: live camera faces (pose input). 2P: each boxer wears its player's face; 1P: both wear
 *  P1's, so you fight yourself (your own boxer is only visible as gloves anyway). */
export async function createBoxingView(canvas: HTMLCanvasElement, faces?: FaceFeed) {
  const renderer = createRenderer(canvas);
  renderer.info.autoReset = false; // one frame can be several render() calls (split screen)
  const scene = new Scene();
  scene.background = new Color('#1b1f3b');
  const hemi = new HemisphereLight('#ffffff', '#445', 1.6);
  const key = new DirectionalLight('#fff4e0', 2.2);
  key.position.set(2, 8, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  scene.add(hemi, key, buildRing());

  const model = await loadModel('skater');
  const boxers = [createBoxer(model, '#e63946'), createBoxer(model, '#2a6fdb')] as const;
  // Boxer 0 stands at +z facing −z (toward boxer 1); boxer 1 at −z facing +z.
  const bases = [new Vector3(0, 0, GAP), new Vector3(0, 0, -GAP)];
  const holders = boxers.map((b, i) => {
    const holder = new Group(); // the boxer's spot and facing
    holder.position.copy(bases[i]!);
    holder.rotation.y = i === 0 ? Math.PI : 0;
    holder.add(b.object);
    scene.add(holder);
    return holder;
  });
  const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 60);
  const eye = new Vector3();
  const face = new Vector3();
  let frames = 0;

  return {
    render(sims: readonly BoxingSim[]): null {
      frames++;
      renderer.info.reset();
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
