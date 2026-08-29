import { createRandom } from '@imagi3/core';
import { describe, expect, it } from 'vitest';
import { EMPTY_INPUT, type InputFrame } from '../src/input.ts';
import {
  CONTROL_SPEED,
  DEFAULT_BOUNDS,
  DRAG_PER_SECOND,
  JITTER,
  RESTITUTION,
  SYSTEMS,
  SYSTEM_ORDER,
  type Bounds,
  type EntityState,
  type World,
} from '../src/simulation.ts';

/**
 * Each system, exercised through the dispatch table by the name it is reached by.
 *
 * This exists because of two defects that are really one defect. The first: the
 * step loop was reversed while `SYSTEM_ORDER` was left alone, and 732 tests
 * passed on a different world. The fix asserted the order via an observer. The
 * second, found at the P1 gate: the observer reports the loop variable, so
 * swapping two *values* in `SYSTEMS` — `drag: integrate, integrate: applyDrag`
 * — produces the identical observed sequence over a materially different world
 * (state hash `89f827c3…` → `405759c4…`), and all 911 tests passed.
 *
 * Both are guards that read a label where the behaviour was what mattered. So
 * these tests reach each system the way the step loop reaches it — `SYSTEMS[name]`
 * — and assert what it *did*. A rewiring fails on the effect, wherever the
 * labels end up.
 *
 * **Expectations are literals, never recomputed from the constant under test.**
 * Asserting `vx * DRAG_PER_SECOND ** dt` would move with a mutation of
 * `DRAG_PER_SECOND` and pass for any value — the projection trap, in the tests
 * written to close it. The numbers below are worked out by hand from the
 * constants pinned in the first block, so a change to either side is a failure.
 */

const SECOND = 1;
const HALF_SECOND = 0.5;

function entity(overrides: Partial<EntityState> = {}): EntityState {
  return { id: 'en_a', x: 0, y: 0, vx: 0, vy: 0, controlled: false, ...overrides };
}

function world(entities: EntityState[], bounds: Bounds = DEFAULT_BOUNDS): World {
  return { entities, bounds, random: createRandom(1) };
}

function run(name: keyof typeof SYSTEMS, w: World, input: InputFrame, stepSeconds: number): void {
  SYSTEMS[name](w, input, stepSeconds);
}

describe('the reference simulation constants', () => {
  /**
   * Pinned as literals in one place, because every expectation below is worked
   * out from them by hand. A mutation of any of these fails here first and says
   * exactly which number moved.
   */
  it('are the values the expectations below are derived from', () => {
    expect(CONTROL_SPEED).toBe(40);
    expect(DRAG_PER_SECOND).toBe(0.5);
    expect(RESTITUTION).toBe(0.8);
    expect(JITTER).toBe(0.25);
  });

  it('bound the world to a finite box', () => {
    // ±1e9 is not "a large box", it is no box: an entity never reaches a wall
    // and `collide` becomes unreachable in every scenario anyone writes.
    expect(DEFAULT_BOUNDS).toEqual({ minX: -100, minY: -100, maxX: 100, maxY: 100 });
  });

  it('start from a neutral input frame', () => {
    // A non-zero neutral frame accelerates every controlled entity in a run
    // nobody touched the controls in, which reads as physics rather than as a
    // defect.
    expect(EMPTY_INPUT).toEqual({ axisX: 0, axisY: 0, pressed: [] });
  });
});

describe('the dispatch table', () => {
  it('maps exactly the names the step loop iterates', () => {
    // A missing key would be a runtime crash; an extra one is a system that
    // never runs and a reader who believes it does.
    expect(Object.keys(SYSTEMS).sort()).toEqual([...SYSTEM_ORDER].sort());
  });
});

describe('input', () => {
  it('accelerates a controlled entity by the control speed', () => {
    const controlled = entity({ controlled: true });
    const w = world([controlled]);
    run('input', w, { axisX: 1, axisY: -1, pressed: [] }, HALF_SECOND);
    // 40 units/s for half a second.
    expect(controlled.vx).toBe(20);
    expect(controlled.vy).toBe(-20);
  });

  it('leaves an uncontrolled entity alone', () => {
    // Dropping the `controlled` guard makes every entity in the scene fly off
    // on the player's input, which no test noticed before this one.
    const passive = entity({ controlled: false });
    const w = world([passive]);
    run('input', w, { axisX: 1, axisY: 1, pressed: [] }, SECOND);
    expect(passive.vx).toBe(0);
    expect(passive.vy).toBe(0);
  });

  it('does not move anything by itself', () => {
    const controlled = entity({ controlled: true, vx: 5 });
    const w = world([controlled]);
    run('input', w, { axisX: 1, axisY: 0, pressed: [] }, SECOND);
    expect(controlled.x).toBe(0);
  });

  it('is inert under the neutral frame', () => {
    const controlled = entity({ controlled: true, vx: 7, vy: -3 });
    const w = world([controlled]);
    run('input', w, EMPTY_INPUT, SECOND);
    expect(controlled.vx).toBe(7);
    expect(controlled.vy).toBe(-3);
  });
});

describe('drag', () => {
  it('retains half the velocity per second', () => {
    const moving = entity({ vx: 100, vy: -40 });
    const w = world([moving]);
    run('drag', w, EMPTY_INPUT, SECOND);
    // 0.5 ** 1.
    expect(moving.vx).toBe(50);
    expect(moving.vy).toBe(-20);
  });

  it('slows an uncontrolled entity rather than letting it coast', () => {
    // The mutation that survived every test: `retained = 1`. Stated as a
    // property as well as an equality, so it stays meaningful if the constant
    // is ever retuned.
    const moving = entity({ vx: 100 });
    const w = world([moving]);
    run('drag', w, EMPTY_INPUT, HALF_SECOND);
    expect(Math.abs(moving.vx)).toBeLessThan(100);
    expect(Math.abs(moving.vx)).toBeGreaterThan(0);
  });

  it('applies to controlled entities too', () => {
    const driven = entity({ vx: 100, controlled: true });
    const w = world([driven]);
    run('drag', w, EMPTY_INPUT, SECOND);
    expect(driven.vx).toBe(50);
  });

  it('does not move anything', () => {
    const moving = entity({ x: 3, vx: 100 });
    const w = world([moving]);
    run('drag', w, EMPTY_INPUT, SECOND);
    expect(moving.x).toBe(3);
  });
});

describe('integrate', () => {
  it('advances position by velocity times the step', () => {
    const moving = entity({ x: 1, y: 2, vx: 10, vy: -4 });
    const w = world([moving]);
    run('integrate', w, EMPTY_INPUT, HALF_SECOND);
    expect(moving.x).toBe(6);
    expect(moving.y).toBe(0);
  });

  it('leaves velocity untouched', () => {
    const moving = entity({ vx: 10, vy: -4 });
    const w = world([moving]);
    run('integrate', w, EMPTY_INPUT, SECOND);
    expect(moving.vx).toBe(10);
    expect(moving.vy).toBe(-4);
  });
});

describe('collide', () => {
  it('clamps an entity past the wall and reverses it, losing energy', () => {
    const escaping = entity({ x: 150, y: -150, vx: 10, vy: -5 });
    const w = world([escaping]);
    run('collide', w, EMPTY_INPUT, SECOND);
    expect(escaping.x).toBe(100);
    expect(escaping.y).toBe(-100);
    // Reversed and scaled by the restitution: a bounce, not a stop and not a
    // perfect mirror.
    expect(escaping.vx).toBe(-8);
    expect(escaping.vy).toBe(4);
  });

  it('leaves an entity inside the bounds alone', () => {
    const inside = entity({ x: 10, y: 10, vx: 3, vy: 3 });
    const w = world([inside]);
    run('collide', w, EMPTY_INPUT, SECOND);
    expect(inside).toEqual({ id: 'en_a', x: 10, y: 10, vx: 3, vy: 3, controlled: false });
  });

  it('honours the bounds it was given rather than the default', () => {
    const escaping = entity({ x: 40, vx: 10 });
    const w = world([escaping], { minX: -10, minY: -10, maxX: 20, maxY: 20 });
    run('collide', w, EMPTY_INPUT, SECOND);
    expect(escaping.x).toBe(20);
  });
});

describe('jitter', () => {
  it('perturbs velocity within the declared magnitude', () => {
    const still = entity();
    const w = world([still]);
    run('jitter', w, EMPTY_INPUT, SECOND);
    expect(still.vx).not.toBe(0);
    expect(still.vy).not.toBe(0);
    // (next() - 0.5) * 0.25 * 1 lies in (-0.125, 0.125).
    expect(Math.abs(still.vx)).toBeLessThan(0.125);
    expect(Math.abs(still.vy)).toBeLessThan(0.125);
  });

  it('draws two numbers per entity, in entity order', () => {
    // Which entity gets which draw is part of the result, not an accident of
    // iteration: this is the property that makes an ordering mistake show up
    // as a hash mismatch.
    const first = entity({ id: 'en_a' });
    const second = entity({ id: 'en_b' });
    const w = world([first, second]);
    const expected = createRandom(1);
    const HALF = 0.5;
    const draw = (): number => (expected.next() - HALF) * JITTER;
    const firstX = draw();
    const firstY = draw();
    const secondX = draw();
    run('jitter', w, EMPTY_INPUT, SECOND);
    expect(first.vx).toBeCloseTo(firstX, 12);
    expect(first.vy).toBeCloseTo(firstY, 12);
    expect(second.vx).toBeCloseTo(secondX, 12);
  });

  it('does not move anything', () => {
    const still = entity({ x: 5 });
    const w = world([still]);
    run('jitter', w, EMPTY_INPUT, SECOND);
    expect(still.x).toBe(5);
  });
});
