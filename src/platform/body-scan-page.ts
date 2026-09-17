// Menu → Body scan (PLAN-BOXING BX-CAL-6): pick who is scanning, stand still, hold a T-pose, save the
// measured arm proportions under that name. Games read them at launch (profiles.body(name)); a player
// who never scans plays with the default proportions.
import { createBodyScan, type ScanStatus } from '../pose/body-scan';
import { gestureConfig } from '../pose/gestures.config';
import type { PoseFrame } from '../pose/types';
import { cleanName, type ProfileStore } from './profile-store';

export interface ScanPageDeps {
  profiles: ProfileStore;
  video: () => { width: number; height: number };
  back: () => void;
  /** true while scanning: the menu stops hand-hover (a T-pose would dwell on buttons). */
  setBusy: (busy: boolean) => void;
  /** Where the menu sends camera frames while this page scans (null = nowhere). */
  setSink: (sink: ((f: PoseFrame) => void) | null) => void;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (k: number): string => `${Math.round(Math.min(1, k) * 100)} %`;

export function bodyScanPage(page: HTMLElement, deps: ScanPageDeps): void {
  const { profiles } = deps;
  const names = [...new Set([...profiles.names().slice(0, 6), 'Player 1'])];
  page.innerHTML = `<h2>Body scan: who is it?</h2>
    <div class="row">${names.map((n) => `<button data-scan-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <form class="row"><input name="name" maxlength="24" placeholder="New name" aria-label="New name"><button type="submit">Add</button></form>
    <button data-nav="back">Back</button>`;
  page.querySelectorAll<HTMLButtonElement>('[data-scan-name]').forEach((b) => {
    b.onclick = () => scan(page, b.dataset.scanName!, deps);
  });
  page.querySelector('form')!.onsubmit = (e) => {
    e.preventDefault();
    const name = cleanName(new FormData(e.target as HTMLFormElement).get('name')?.toString() ?? '');
    if (name) scan(page, name, deps);
  };
  page.querySelector<HTMLButtonElement>('[data-nav="back"]')!.onclick = deps.back;
}

function scan(page: HTMLElement, name: string, deps: ScanPageDeps): void {
  const push = createBodyScan(gestureConfig, deps.video);
  page.innerHTML = `<h2>Body scan: ${esc(name)}</h2><div class="scan-step" aria-live="polite"></div>
    <button data-nav="cancel">Cancel</button>`;
  const step = page.querySelector<HTMLElement>('.scan-step')!;
  const stop = (): void => {
    deps.setSink(null);
    deps.setBusy(false);
  };
  const show = (s: ScanStatus): void => {
    if (s.step === 'done') return done(page, name, s.scan, deps, stop);
    step.textContent =
      s.step === 'stand'
        ? `Stand still, arms down, whole body in view · ${pct(s.progress)}`
        : `Now a T-pose: arms straight out to the sides · ${pct(s.progress)}`;
    step.dataset.step = s.step;
  };
  show({ step: 'stand', progress: 0 });
  deps.setBusy(true);
  deps.setSink((f) => show(push(f)));
  page.querySelector<HTMLButtonElement>('[data-nav="cancel"]')!.onclick = () => {
    stop();
    deps.back();
  };
}

function done(
  page: HTMLElement,
  name: string,
  arms: { upperArm: number; forearm: number; shoulderWidth: number },
  deps: ScanPageDeps,
  stop: () => void,
): void {
  stop();
  const reach = arms.upperArm + arms.forearm;
  page.innerHTML = `<h2>Body scan: ${esc(name)}</h2>
    <div class="scan-step" data-step="done">Arm length ${reach.toFixed(2)} torso lengths
      (upper ${arms.upperArm.toFixed(2)}, forearm ${arms.forearm.toFixed(2)})</div>
    <div class="row"><button data-nav="save">Save</button><button data-nav="redo">Redo</button>
    <button data-nav="back">Back</button></div>`;
  page.querySelector<HTMLButtonElement>('[data-nav="save"]')!.onclick = () => {
    deps.profiles.setBody(name, { ...arms, at: new Date().toISOString() });
    deps.back();
  };
  page.querySelector<HTMLButtonElement>('[data-nav="redo"]')!.onclick = () =>
    scan(page, name, deps);
  page.querySelector<HTMLButtonElement>('[data-nav="back"]')!.onclick = deps.back;
}
