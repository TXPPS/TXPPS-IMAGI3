import { describe, expect, it } from 'vitest';
import { createManualClock } from '@imagi3/core';
import { DEFAULT_MAX_FRAME_MS, DEFAULT_STEP_MS, createTickLoop } from '../src/tick.ts';

/**
 * The fixed-timestep loop, driven by a clock the test advances by hand.
 *
 * The property that matters is not "steps happen" but "the wall clock decides
 * only how many". Every assertion below is a way that could stop being true.
 */

/** A step that does nothing, for tests measuring the loop rather than a world. */
function noStep(): void {
  // Intentionally empty.
}

function loopWith(stepMs = 10, maxFrameMs = DEFAULT_MAX_FRAME_MS) {
  const clock = createManualClock(1000);
  return { clock, loop: createTickLoop({ clock, stepMs, maxFrameMs }) };
}

describe('createTickLoop', () => {
  it('runs no steps on the first advance, which establishes the origin', () => {
    const { loop } = loopWith();
    expect(loop.advance(noStep).steps).toBe(0);
  });

  it('runs one step per whole step of elapsed time', () => {
    const { clock, loop } = loopWith(10);
    loop.advance(noStep);
    clock.advance(30);
    expect(loop.advance(noStep).steps).toBe(3);
  });

  it('runs no step for less than a whole step of elapsed time', () => {
    const { clock, loop } = loopWith(10);
    loop.advance(noStep);
    clock.advance(9);
    expect(loop.advance(noStep).steps).toBe(0);
  });

  it('carries the remainder rather than discarding it', () => {
    // Two 6ms frames are one 10ms step plus 2ms left over. A loop that dropped
    // the remainder would run slow by a hair on every frame, forever.
    const { clock, loop } = loopWith(10);
    loop.advance(noStep);
    clock.advance(6);
    expect(loop.advance(noStep).steps).toBe(0);
    clock.advance(6);
    expect(loop.advance(noStep).steps).toBe(1);
  });

  it('keeps simulated time in step with elapsed time over many frames', () => {
    const { clock, loop } = loopWith(10);
    loop.advance(noStep);
    // Frame times that never divide evenly into the step, which is the normal
    // case and the one where drift would accumulate.
    for (let i = 0; i < 1000; i += 1) {
      clock.advance(7);
      loop.advance(noStep);
    }
    expect(loop.tick).toBe(Math.floor((1000 * 7) / 10));
  });

  it('reports the fraction of a step elapsed, for the renderer to interpolate', () => {
    const { clock, loop } = loopWith(10);
    loop.advance(noStep);
    clock.advance(15);
    expect(loop.advance(noStep).alpha).toBeCloseTo(0.5, 10);
  });

  it('keeps alpha below one, since a whole step would have been simulated', () => {
    const { clock, loop } = loopWith(10);
    loop.advance(noStep);
    for (const ms of [1, 3, 7, 9, 11, 13, 19, 99]) {
      clock.advance(ms);
      expect(loop.advance(noStep).alpha).toBeLessThan(1);
    }
  });

  it('passes each step its own tick number, in order', () => {
    const { clock, loop } = loopWith(10);
    loop.advance(noStep);
    const seen: number[] = [];
    clock.advance(50);
    loop.advance((tick) => seen.push(tick));
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });

  /**
   * The spiral of death. A backgrounded tab returns with minutes of elapsed
   * time; simulating all of it in one frame means the frame takes minutes,
   * misses the next one, accrues more debt, and never recovers.
   */
  it('clamps a very long gap rather than trying to catch up', () => {
    const { clock, loop } = loopWith(10, 100);
    loop.advance(noStep);
    clock.advance(60_000);
    const frame = loop.advance(noStep);
    expect(frame.steps).toBe(10);
    expect(frame.droppedMs).toBe(60_000 - 100);
  });

  it('reports no dropped time for an ordinary frame', () => {
    const { clock, loop } = loopWith(10, 100);
    loop.advance(noStep);
    clock.advance(30);
    expect(loop.advance(noStep).droppedMs).toBe(0);
  });

  it('does not stall when a clock goes backwards', () => {
    // `Clock` is documented as monotonic. This is what happens when an
    // implementation is not: the loop treats it as no time passing, rather
    // than driving the accumulator negative and freezing until it catches up.
    let now = 1000;
    const loop = createTickLoop({ clock: { now: () => now }, stepMs: 10 });
    loop.advance(noStep);
    now = 500;
    expect(loop.advance(noStep).steps).toBe(0);
    now = 520;
    expect(loop.advance(noStep).steps).toBe(2);
  });

  it.each([
    ['a zero step', { stepMs: 0 }],
    ['a negative step', { stepMs: -1 }],
    ['a non-finite step', { stepMs: Number.NaN }],
    ['a zero frame cap', { maxFrameMs: 0 }],
    ['a frame cap below the step', { stepMs: 20, maxFrameMs: 10 }],
  ])('rejects %s', (_label, options) => {
    const clock = createManualClock();
    expect(() => createTickLoop({ clock, ...options })).toThrow(RangeError);
  });

  it('defaults to a 60Hz step', () => {
    expect(DEFAULT_STEP_MS).toBeCloseTo(1000 / 60, 10);
    expect(createTickLoop({ clock: createManualClock() }).stepMs).toBe(DEFAULT_STEP_MS);
  });
});
