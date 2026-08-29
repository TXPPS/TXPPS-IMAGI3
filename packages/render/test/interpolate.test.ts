import { describe, expect, it } from 'vitest';
import type { WorldSnapshot } from '@imagi3/runtime';
import {
  createInterpolationScratch,
  interpolateInto,
  interpolateSnapshots,
} from '../src/interpolate.ts';

function snapshot(...entities: { id: string; x: number; y: number }[]): WorldSnapshot {
  return { entities: entities.map((e) => ({ ...e, vx: 0, vy: 0, controlled: false })) };
}

describe('interpolateSnapshots', () => {
  const previous = snapshot({ id: 'a', x: 0, y: 0 });
  const current = snapshot({ id: 'a', x: 10, y: -20 });

  it('draws the previous state at alpha zero', () => {
    expect(interpolateSnapshots(previous, current, 0)[0]).toEqual({ id: 'a', x: 0, y: 0 });
  });

  it('draws the current state at alpha one', () => {
    expect(interpolateSnapshots(previous, current, 1)[0]).toEqual({ id: 'a', x: 10, y: -20 });
  });

  it('draws between them at alpha one half', () => {
    expect(interpolateSnapshots(previous, current, 0.5)[0]).toEqual({ id: 'a', x: 5, y: -10 });
  });

  /**
   * Matching positionally is the bug this guards. Two snapshots can hold
   * different entity sets, and interpolating one entity's position toward an
   * unrelated entity's draws as a smear across the screen rather than as a
   * missing object.
   */
  it('matches by id, not by index', () => {
    const before = snapshot({ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 100 });
    const after = snapshot({ id: 'b', x: 100, y: 100 }, { id: 'a', x: 0, y: 0 });
    expect(interpolateSnapshots(before, after, 0.5)).toEqual([
      { id: 'b', x: 100, y: 100 },
      { id: 'a', x: 0, y: 0 },
    ]);
  });

  it('draws an entity that spawned during the step at its current position', () => {
    const after = snapshot({ id: 'a', x: 10, y: -20 }, { id: 'new', x: 7, y: 7 });
    expect(interpolateSnapshots(previous, after, 0.5)).toContainEqual({ id: 'new', x: 7, y: 7 });
  });

  it('does not draw an entity that vanished', () => {
    const before = snapshot({ id: 'a', x: 0, y: 0 }, { id: 'gone', x: 5, y: 5 });
    expect(interpolateSnapshots(before, current, 0.5).map((s) => s.id)).toEqual(['a']);
  });

  it.each([
    ['above one', 2, { id: 'a', x: 10, y: -20 }],
    ['below zero', -1, { id: 'a', x: 0, y: 0 }],
    ['not a number', Number.NaN, { id: 'a', x: 0, y: 0 }],
  ])('clamps an alpha %s rather than extrapolating', (_label, alpha, expected) => {
    // Extrapolating past the current state draws objects where the simulation
    // has not put them, which reads as jitter that no simulation bug explains.
    expect(interpolateSnapshots(previous, current, alpha)[0]).toEqual(expected);
  });

  it('handles two empty snapshots', () => {
    expect(interpolateSnapshots(snapshot(), snapshot(), 0.5)).toEqual([]);
  });

  /**
   * Interpolation must never write back. A value derived partly from wall-clock
   * timing reaching simulation state is the end of reproducibility.
   *
   * This assertion exists because Visual QA showed the guarantee was protected
   * only by accident: mutating `interpolateInto` to write into the snapshot
   * failed three tests in a full run, but each of those passed when run alone.
   * The detection came from cross-test contamination of shared fixtures, not
   * from any assertion — so a routine refactor to per-test fixtures would have
   * removed the guard with nothing turning red.
   */
  it('does not write into either snapshot', () => {
    const before = snapshot({ id: 'a', x: 1, y: 2 }, { id: 'b', x: 3, y: 4 });
    const after = snapshot({ id: 'a', x: 9, y: 9 }, { id: 'b', x: 9, y: 9 });
    const beforeCopy = structuredClone(before);
    const afterCopy = structuredClone(after);

    interpolateSnapshots(before, after, 0.5);

    expect(before).toEqual(beforeCopy);
    expect(after).toEqual(afterCopy);
  });

  it('does not write into either snapshot through the callback form either', () => {
    const before = snapshot({ id: 'a', x: 1, y: 2 });
    const after = snapshot({ id: 'a', x: 9, y: 9 });
    const beforeCopy = structuredClone(before);
    const afterCopy = structuredClone(after);

    interpolateInto(before, after, 0.5, createInterpolationScratch(), () => {
      // Intentionally does nothing: the assertion is about the caller's inputs.
    });

    expect(before).toEqual(beforeCopy);
    expect(after).toEqual(afterCopy);
  });
});

/**
 * The scratch buffer is reused across frames, and reuse is a state machine.
 *
 * `scratch.index.clear()` was deletable with the whole suite green, because
 * every test built a fresh scratch and called `interpolateInto` once. Reused
 * across frames — which is the only reason the scratch exists — a missing clear
 * means entities that have left the scene stay in the index forever: the map
 * grows without bound over a session, and an id that is removed and later
 * reused interpolates from wherever it was when it left.
 */
describe('interpolateInto across frames', () => {
  function draw(
    previous: WorldSnapshot,
    current: WorldSnapshot,
    alpha: number,
    scratch: ReturnType<typeof createInterpolationScratch>,
  ): { id: string; x: number }[] {
    const drawn: { id: string; x: number }[] = [];
    interpolateInto(previous, current, alpha, scratch, (_index, id, x) => {
      drawn.push({ id, x });
    });
    return drawn;
  }

  it('forgets entities that have left the scene', () => {
    const scratch = createInterpolationScratch();
    draw(snapshot({ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 0 }), snapshot(
      { id: 'a', x: 10, y: 0 },
      { id: 'b', x: 110, y: 0 },
    ), 0.5, scratch);
    expect(scratch.index.size).toBe(2);

    // Frame two: `b` is gone from both snapshots.
    draw(snapshot({ id: 'a', x: 10, y: 0 }), snapshot({ id: 'a', x: 20, y: 0 }), 0.5, scratch);
    expect(scratch.index.size).toBe(1);
    expect(scratch.index.has('b')).toBe(false);
  });

  it('does not interpolate a returning id from where it was when it left', () => {
    const scratch = createInterpolationScratch();
    draw(snapshot({ id: 'a', x: 0, y: 0 }), snapshot({ id: 'a', x: 0, y: 0 }), 0.5, scratch);

    // `a` leaves and comes back somewhere else. With a stale index it would be
    // drawn half way back to the origin instead of at its new position.
    const reappeared = draw(
      snapshot({ id: 'b', x: 500, y: 0 }),
      snapshot({ id: 'a', x: 500, y: 0 }),
      0.5,
      scratch,
    );
    expect(reappeared).toEqual([{ id: 'a', x: 500 }]);
  });

  it('does not grow without bound over many frames', () => {
    const scratch = createInterpolationScratch();
    for (let frame = 0; frame < 50; frame += 1) {
      const one = snapshot({ id: `en_${String(frame)}`, x: frame, y: 0 });
      draw(one, one, 0.5, scratch);
    }
    expect(scratch.index.size).toBe(1);
  });
});
