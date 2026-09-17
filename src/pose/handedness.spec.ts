// Jorge's B1 capture: the "left arm up" take is the mirror marker (src/pose/testdata/real-b1-capture.json).
import { describe, expect, it } from 'vitest';
import { handedness, mirrorFrame } from './handedness';
import { b1Take } from './testdata/real-b1';

const overhead = () => b1Take('left-hand-overhead').frames;

describe('handedness check (mirrored camera stream), real recording', () => {
  it("Jorge's camera is not mirrored: his raised left hand reads ok; the same take mirrored reads SWAPPED", () => {
    // The take includes 1 s of lead-in before the arm goes up; look at all of it.
    expect(handedness(overhead(), 5000)).toBe('ok');
    expect(handedness(overhead().map(mirrorFrame), 5000)).toBe('SWAPPED');
    expect(handedness(overhead().slice(0, 5), 5000)).toBe('unclear');
  });

  it('the raised wrist is landmark 15 at larger raw x than the nose: the convention pose-state.ts assumes', () => {
    const top = overhead().reduce((a, f) => (f.poses[0]![15]!.y < a.poses[0]![15]!.y ? f : a));
    const p = top.poses[0]!;
    expect(p[15]!.y).toBeLessThan(p[0]!.y - 0.15); // well above the nose
    expect(p[16]!.y).toBeGreaterThan(p[0]!.y + 0.3); // the right arm stays down
    expect(p[15]!.x).toBeGreaterThan(p[0]!.x); // the player's left is image-right (unmirrored)
  });

  it('shoulder order alone cannot see a mirror: landmark 11 stays at larger x', () => {
    const [plain, mirrored] = [overhead()[0]!, mirrorFrame(overhead()[0]!)];
    for (const f of [plain, mirrored])
      expect(f.poses[0]![11]!.x).toBeGreaterThan(f.poses[0]![12]!.x);
    expect(handedness(overhead().map(mirrorFrame).map(mirrorFrame), 5000)).toBe('ok'); // undoes itself
  });
});
