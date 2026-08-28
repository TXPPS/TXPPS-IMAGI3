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
