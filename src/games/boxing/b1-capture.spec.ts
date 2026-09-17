// Jorge's B1 capture (src/pose/testdata/real-b1-capture.json), end to end against an idle defender:
// camera frames → gesture engine → BODY → sim. The first real measurement of punch detection; the counts
// are pinned so any change to the pipeline, gains or collision shows up here and gets re-measured.
import { describe, expect, it } from 'vitest';
import { b1Take, extensions, replayB1, type B1Step } from '../../pose/testdata/real-b1';
import { playB1, type Contact } from './b1-replay';
import { BOXING_GESTURES } from './gestures';

/** Per hand, the contacts its own glove made during each of its extensions (200 ms lead: contact can
 *  precede the wrist crossing the nose); `stray` = every contact no extension of its glove explains. */
function byExtension(step: B1Step) {
  const take = b1Take(step);
  const { contacts } = playB1(take);
  const used = new Set<Contact>();
  const hand = (glove: 0 | 1) =>
    extensions(take.frames, glove ? 16 : 15).map(([a, z]) => {
      const mine = contacts.filter((c) => c.glove === glove && c.t >= a - 200 && c.t <= z + 100);
      mine.forEach((c) => used.add(c));
      return mine.map((c) => c.type).join('+');
    });
  const [left, right] = [hand(0), hand(1)];
  const stray = contacts.filter((c) => !used.has(c)).map((c) => `${c.type}:${c.glove}`);
  return { contacts, left, right, stray };
}

describe('B1 capture: punches through the whole pipeline (real recording)', () => {
  it('every contact is attributed to a glove', () => {
    const steps: B1Step[] = [
      'left-hand-overhead',
      'guard',
      'square-right-x3',
      'natural-right-x3',
      'left-x1',
    ];
    for (const step of steps)
      expect(byExtension(step).contacts.map((c) => c.glove)).not.toContain(null);
  });

  it('right punches, no twist: 6 extensions, 6 HITs by the right glove', () => {
    const r = byExtension('square-right-x3');
    expect(r.left).toEqual([]);
    expect(r.right).toEqual(['HIT', 'HIT', 'HIT', 'HIT', 'HIT', 'HIT']);
  });

  // A bend lowers only the head (Jorge, B1): before, the twist's forward bend read as a 0.14–0.25 torso
  // duck and carried the glove 0.17–0.30 m low into the ready glove, and only 2 of 6 reached the head.
  it('right punches, with twist: all 6 touch with the right glove, 5 reach the head', () => {
    const r = byExtension('natural-right-x3');
    expect(r.left).toEqual([]);
    expect(r.right).toEqual(['HIT', 'BLOCK', 'HIT', 'HIT', 'HIT', 'HIT']);
  });

  it('left punches: 6 extensions, 6 HITs by the left glove', () => {
    const r = byExtension('left-x1');
    expect(r.right).toEqual([]);
    expect(r.left).toEqual(['HIT', 'HIT', 'HIT', 'HIT', 'HIT', 'HIT']);
  });

  // Known false contacts, pinned. 3 are HITs on the idle defender (were BLOCKs before the head-only duck):
  // - arms rising from the sides read mid-raise as reaching forward (glove z 1.04–1.30, face at 0.99)
  // - the guarding LEFT glove during a twisted right punch reads forward (z up to 1.38): 2 HITs, one of
  //   them the capped 1.05 seg, from a 2-frame left-wrist landmark jump (7.7 m/s)
  // - a resting right glove's depth jitters past the face: 1 HIT, 0.19 seg
  // - the square take's lead-in (walking back into place) whiffs
  it('false contacts: 10, from raising arms, the twist, a resting glove and a lead-in', () => {
    expect(byExtension('left-hand-overhead').stray).toEqual(['BLOCK:0']);
    expect(byExtension('still').stray).toEqual([]);
    expect(byExtension('guard').stray).toEqual(['BLOCK:0']);
    expect(byExtension('square-right-x3').stray).toEqual([
      'WHIFF:0',
      'WHIFF:1',
      'BLOCK:0',
      'HIT:1',
    ]);
    expect(byExtension('natural-right-x3').stray).toEqual(['HIT:0', 'HIT:0', 'BLOCK:0']);
    expect(byExtension('left-x1').stray).toEqual(['BLOCK:0']);
  });

  it('no dodge from leaning: no take maps a gesture to DODGE_* (Jorge, B1)', () => {
    const steps: B1Step[] = ['square-right-x3', 'natural-right-x3', 'left-x1'];
    for (const step of steps) {
      const mapped = replayB1(b1Take(step)).flatMap((r) =>
        r.events.map((e) => BOXING_GESTURES[e.type] ?? ''),
      );
      expect(
        mapped.filter((t) => t.startsWith('DODGE')),
        step,
      ).toEqual([]);
    }
    // The lean that used to fire it is still there: a left punch crosses the lean threshold.
    const lanes = replayB1(b1Take('left-x1')).flatMap((r) => r.events.map((e) => e.type));
    expect(lanes.filter((t) => t.startsWith('LANE'))).toEqual(['LANE_RIGHT', 'LANE_RIGHT']);
  });

  it('the live build logged no dodge in any take either', () => {
    const steps: B1Step[] = [
      'left-hand-overhead',
      'still',
      'guard',
      'square-right-x3',
      'natural-right-x3',
      'left-x1',
    ];
    for (const step of steps)
      expect(b1Take(step).events.filter((e) => e.type.startsWith('DODGE'))).toEqual([]);
  });
});
