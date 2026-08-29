import { describe, expect, it } from 'vitest';
import {
  addComponent,
  addEntity,
  createIdFactory,
  createManualClock,
  createRandom,
  createScene,
  type SceneDocument,
} from '@imagi3/core';
import { createInputTape } from '../src/input.ts';
import { createSession, runHeadless } from '../src/session.ts';
import { DEFAULT_BOUNDS } from '../src/simulation.ts';

/**
 * The session is the seam the brief calls P0-critical: editor play mode and an
 * exported build construct one through the same function and drive it the same
 * way. These tests hold the seam to the properties that make that worth having.
 */

function sceneWith(x: number, y: number, vx: number, vy: number, controlled = false) {
  const ids = createIdFactory(createRandom(7));
  let document: SceneDocument = createScene(ids, 'session test');
  const added = addEntity(document, ids, { name: 'subject' });
  document = addComponent(added.document, ids, added.id, 'transform', { x, y }).document;
  document = addComponent(document, ids, added.id, 'motion', { vx, vy, controlled }).document;
  return document;
}

const emptyTape = createInputTape([]);

function sessionFor(document: SceneDocument, stepMs = 10) {
  const clock = createManualClock(0);
  return {
    clock,
    session: createSession({ document, clock, input: emptyTape, seed: 1, stepMs }),
  };
}

describe('createSession', () => {
  it('starts with previous and current equal, so the first frame draws the initial state', () => {
    const { session } = sessionFor(sceneWith(1, 2, 0, 0));
    expect(session.previous()).toEqual(session.current());
  });

  it('advances previous to the state before the last step, every step', () => {
    // `previous = current` is what makes interpolation a *pair*. Deleting it
    // pins `previous` to the initial snapshot forever, so every frame after the
    // first interpolates from the origin — a smear on frame two and a growing
    // lie after that. It survived the whole suite at the P1 gate, because the
    // only assertion about `previous` was the one above, on frame zero.
    const { clock, session } = sessionFor(sceneWith(0, 0, 10, 0), 10);
    const positions: number[] = [];
    for (let step = 0; step < 3; step += 1) {
      clock.advance(10);
      session.advance();
      positions.push(session.previous().entities[0]?.x ?? Number.NaN);
    }
    // Frame 1's previous is the origin; frames 2 and 3 must have moved on.
    expect(positions[0]).toBe(0);
    expect(positions[1]).toBeGreaterThan(0);
    expect(positions[2]).toBeGreaterThan(positions[1] ?? Number.NaN);
  });

  it('is one step behind current, not equal to it', () => {
    const { clock, session } = sessionFor(sceneWith(0, 0, 10, 0), 10);
    clock.advance(10);
    session.advance();
    clock.advance(10);
    session.advance();
    expect(session.previous()).not.toEqual(session.current());
  });

  it('builds the world inside the bounds it was given', () => {
    // `createSession` took `options.bounds` and could drop it silently: the
    // world fell back to DEFAULT_BOUNDS and nothing noticed, because no test
    // passed the option at all.
    const clock = createManualClock(0);
    const session = createSession({
      document: sceneWith(0, 0, 1000, 0),
      clock,
      input: emptyTape,
      seed: 1,
      stepMs: 10,
      bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    });
    clock.advance(10);
    session.advance();
    // At 1000 units/s for 10ms the entity would reach x=10 unbounded; the wall
    // it was given is at 5.
    expect(session.current().entities[0]?.x).toBeLessThanOrEqual(5);
  });

  it('advances the world when the clock does', () => {
    const { clock, session } = sessionFor(sceneWith(0, 0, 10, 0));
    session.advance();
    const before = session.current().entities[0]?.x ?? 0;
    clock.advance(100);
    session.advance();
    expect(session.current().entities[0]?.x ?? 0).toBeGreaterThan(before);
  });

  it('does not advance the world when the clock does not', () => {
    // The wall clock decides how many steps run and nothing else. A session
    // that moved without time passing would not be replayable.
    const { session } = sessionFor(sceneWith(0, 0, 10, 0));
    session.advance();
    const hash = session.hash();
    session.advance();
    expect(session.hash()).toBe(hash);
  });

  it('keeps previous one step behind current, for interpolation', () => {
    const { clock, session } = sessionFor(sceneWith(0, 0, 10, 0));
    session.advance();
    clock.advance(30);
    session.advance();
    expect(session.previous()).not.toEqual(session.current());
  });

  it('never lets a snapshot be written back into the simulation', () => {
    const { clock, session } = sessionFor(sceneWith(0, 0, 10, 0));
    session.advance();
    clock.advance(20);
    session.advance();
    const stolen = session.current();
    const before = session.hash();
    // Mutating a snapshot is a mistake a renderer can make; it must not reach
    // the world, or interpolation would silently become simulation.
    const first = stolen.entities[0];
    if (first !== undefined) first.x = 99999;
    clock.advance(20);
    session.advance();
    expect(session.hash()).not.toBe(before);
    expect(session.current().entities[0]?.x ?? 0).toBeLessThan(1000);
  });

  it('feeds each step the input for its own tick', () => {
    const document = sceneWith(0, 0, 0, 0, true);
    const clock = createManualClock(0);
    const session = createSession({
      document,
      clock,
      input: createInputTape([
        { axisX: 1, axisY: 0, pressed: [] },
        { axisX: 1, axisY: 0, pressed: [] },
      ]),
      seed: 1,
      stepMs: 10,
    });
    session.advance();
    clock.advance(20);
    session.advance();
    expect(session.current().entities[0]?.vx ?? 0).toBeGreaterThan(0);
  });
});

describe('runHeadless', () => {
  it('agrees with a clock-driven session over the same number of steps', () => {
    // The whole point of the seam: the same simulation, driven two ways,
    // reaches the same state. If these diverge, one of the two consumers is
    // running a different engine.
    const document = sceneWith(3, -4, 12, 7, true);
    const input = createInputTape([{ axisX: 1, axisY: -1, pressed: [] }]);
    const clock = createManualClock(0);
    const session = createSession({ document, clock, input, seed: 5, stepMs: 10 });
    session.advance();
    for (let frame = 0; frame < 50; frame += 1) {
      clock.advance(10);
      session.advance();
    }

    const headless = runHeadless({ document, input, seed: 5, stepMs: 10, ticks: 50 });
    expect(session.hash()).toBe(headless.hash);
  });

  /**
   * The one case where the two consumers legitimately diverge, asserted so it
   * is a documented property rather than a surprise. A frame longer than the
   * cap discards the excess wall time — that is the spiral-of-death defence —
   * so a session that stalled has genuinely simulated less than a headless run
   * of the same nominal duration. It is the clock that differs, not the engine.
   */
  it('simulates less than a headless run when a frame exceeded the cap', () => {
    const document = sceneWith(3, -4, 12, 7, true);
    const input = createInputTape([{ axisX: 1, axisY: -1, pressed: [] }]);
    const clock = createManualClock(0);
    const session = createSession({ document, clock, input, seed: 5, stepMs: 10 });
    session.advance();
    clock.advance(500);
    const frame = session.advance();

    expect(frame.droppedMs).toBeGreaterThan(0);
    expect(frame.steps).toBe(25);
    expect(session.hash()).toBe(
      runHeadless({ document, input, seed: 5, stepMs: 10, ticks: 25 }).hash,
    );
  });

  it('runs zero ticks without error', () => {
    expect(
      runHeadless({ document: sceneWith(0, 0, 0, 0), input: emptyTape, seed: 1, ticks: 0 }),
    ).toHaveProperty('hash');
  });

  it.each([-1, 1.5, Number.NaN])('rejects a tick count of %s', (ticks) => {
    expect(() =>
      runHeadless({ document: sceneWith(0, 0, 0, 0), input: emptyTape, seed: 1, ticks }),
    ).toThrow(RangeError);
  });

  it('keeps entities inside the bounds', () => {
    const { state } = runHeadless({
      document: sceneWith(0, 0, 500, -500, false),
      input: emptyTape,
      seed: 1,
      ticks: 2000,
    });
    for (const entity of state.entities) {
      expect(entity.x).toBeGreaterThanOrEqual(DEFAULT_BOUNDS.minX);
      expect(entity.x).toBeLessThanOrEqual(DEFAULT_BOUNDS.maxX);
      expect(entity.y).toBeGreaterThanOrEqual(DEFAULT_BOUNDS.minY);
      expect(entity.y).toBeLessThanOrEqual(DEFAULT_BOUNDS.maxY);
    }
  });

  it('reads scene data once, as an initial condition', () => {
    // A mid-run edit to the document must not change history. The document is
    // immutable, so this asserts the runtime does not re-read it either.
    const document = sceneWith(0, 0, 10, 0);
    const first = runHeadless({ document, input: emptyTape, seed: 1, ticks: 100 });
    const second = runHeadless({ document, input: emptyTape, seed: 1, ticks: 100 });
    expect(first.hash).toBe(second.hash);
  });
});
