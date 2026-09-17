// Browser-only inspection harness; exercises the shipping renderer with the real GLB and sim.
import {
  Box3,
  Color,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { createBoxer } from '../../src/render/boxing/boxer';
import type { HeadReaction } from '../../src/render/boxing/animation';
import { loadModel } from '../../src/render/models';
import { createRenderer } from '../../src/render/renderer';
import { initBoxing, tickBoxing, type BoxingInput } from '../../src/core/boxing/sim';
import {
  createLiveSmoother,
  type LiveExpression,
  type LivePose,
} from '../../src/render/boxing/live-pose';

export async function createVisualHarness() {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 720;
  canvas.style.cssText = 'position:fixed;inset:0;width:960px;height:720px;z-index:9999';
  document.body.append(canvas);
  const renderer = createRenderer(canvas),
    scene = new Scene();
  scene.background = new Color('#1b1f3b');
  const hemi = new HemisphereLight('#fff', '#667', 3);
  scene.add(hemi);
  const camera = new PerspectiveCamera(48, 960 / 720, 0.05, 30);
  camera.position.set(1.9, 1.6, 3.2);
  camera.lookAt(0, 0.9, 0);
  const model = await loadModel('skater');
  const reaction = (await (
    await fetch('/assets/quaternius/boxing/hit-head.json')
  ).json()) as HeadReaction;
  const boxer = createBoxer(model, '#e63946', reaction);
  scene.add(boxer.object);
  const crop = Object.assign(document.createElement('canvas'), { width: 192, height: 192 });
  const ctx = crop.getContext('2d')!;
  ctx.fillStyle = '#f7cb8c';
  ctx.fillRect(0, 0, 192, 192);
  ctx.fillStyle = '#243153';
  ctx.fillRect(55, 65, 16, 18);
  ctx.fillRect(120, 65, 16, 18);
  ctx.fillStyle = '#c05b66';
  ctx.fillRect(80, 132, 35, 8);
  const feed = { canvas: () => crop, version: () => 1 };
  let state = initBoxing({ seed: 42, skipIntro: true });
  const smoother = createLiveSmoother();
  let live: LiveExpression = smoother(null, 0);
  const render = () => {
    boxer.update(state, 1, false, { feed, player: 0 }, live);
    renderer.render(scene, camera);
  };
  const step = (seconds: number, events: BoxingInput[] = []) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      tickBoxing(state, i === 0 ? events : []);
      render();
    }
  };
  render();
  /** Rendered RGB where head-local direction `yaw` (rad from the face centre toward +x) meets the
   * head's surface at the equator. Read straight after drawing, in the same task. */
  const surface = (yaw: number): number[] => {
    render();
    const head = boxer.object.getObjectByName('ReplacementHead')!;
    const shell = head.children[0] as Mesh;
    const r = (shell.geometry as SphereGeometry).parameters.radius * 1.02;
    const at = new Vector3(Math.sin(yaw) * r, 0, Math.cos(yaw) * r).multiply(shell.scale);
    const ndc = head.localToWorld(at).project(camera);
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    const [x, y] = [Math.round(((ndc.x + 1) / 2) * 960), Math.round(((ndc.y + 1) / 2) * 720)];
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return Array.from(px.subarray(0, 3));
  };
  return {
    state: () => state,
    /** A sweep across the painted face's edge (≈ 0.84 rad) onto the bare shell (the cap ends at 1.05). */
    seam: () => Array.from({ length: 36 }, (_, i) => surface(0.6 + i * 0.02)),
    /** The face centre under full and dimmed sky light. */
    lighting() {
      const bright = surface(0.3);
      hemi.intensity = 1;
      const dim = surface(0.3);
      hemi.intensity = 3;
      render();
      return { bright, dim };
    },
    step,
    render,
    /** Settle the smoother on `pose` (10 s of easing), then draw. */
    live(pose: LivePose | null) {
      live = smoother(pose, 10);
      render();
    },
    restart() {
      state = initBoxing({ seed: 42, skipIntro: true });
      render();
    },
    inspect() {
      const head = boxer.object.getObjectByName('ReplacementHead')!;
      const face = boxer.object.getObjectByName('LiveFace') as Mesh;
      const image = (face.material as MeshStandardMaterial).map!.image as HTMLCanvasElement;
      return {
        originalVisible: boxer.object.getObjectByName('Casual_Head')!.visible,
        center: head.getWorldPosition(new Vector3()).toArray(),
        rotation: head.quaternion.toArray(),
        /** Where the face points, boxer-local (+x = the boxer's left, +y up, +z forward). */
        faceDir: new Vector3(0, 0, 1).applyQuaternion(head.quaternion).toArray(),
        gloves: ['GloveL', 'GloveR'].map((n) =>
          boxer.object.getObjectByName(n)!.position.toArray(),
        ),
        size: new Box3().setFromObject(head).getSize(new Vector3()).toArray(),
        /** Largest face-cap radius, m: grows as swelling bulges the surface. */
        faceRadius: (() => {
          const p = face.geometry.getAttribute('position');
          let r = 0;
          for (let i = 0; i < p.count; i++)
            r = Math.max(r, new Vector3().fromBufferAttribute(p, i).length());
          return r;
        })(),
        facePixels: Array.from(image.getContext('2d')!.getImageData(124, 103, 8, 8).data),
        sourcePixels: Array.from(ctx.getImageData(124, 103, 8, 8).data),
      };
    },
  };
}
declare global {
  interface Window {
    __boxingVisual: Awaited<ReturnType<typeof createVisualHarness>>;
  }
}
