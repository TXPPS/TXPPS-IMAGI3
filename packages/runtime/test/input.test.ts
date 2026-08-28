import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEY_BINDINGS,
  EMPTY_INPUT,
  createInputTape,
  createLiveInput,
  normaliseInput,
  recordInput,
  type KeyEventTarget,
} from '../src/input.ts';

/** A minimal event target, so this test needs no DOM. */
function fakeTarget(): KeyEventTarget & { fire(type: string, code: string): void } {
  const listeners = new Map<string, ((event: { code: string }) => void)[]>();
  return {
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener: (type, listener) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((each) => each !== listener),
      );
    },
    fire: (type, code) => {
      for (const listener of listeners.get(type) ?? []) listener({ code });
    },
  };
}

describe('normaliseInput', () => {
  it('clamps axes into range', () => {
    expect(normaliseInput({ axisX: 5, axisY: -5, pressed: [] })).toMatchObject({
      axisX: 1,
      axisY: -1,
    });
  });

  it('treats a non-finite axis as neutral rather than propagating NaN', () => {
    // A NaN axis would spread into every position and velocity, and the state
    // hash would then throw on serialisation — a long way from the cause.
    expect(normaliseInput({ axisX: Number.NaN, axisY: 0, pressed: [] }).axisX).toBe(0);
  });

  it('sorts and de-duplicates actions, so device order cannot change the run', () => {
    expect(normaliseInput({ axisX: 0, axisY: 0, pressed: ['B', 'A', 'B'] }).pressed).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('createInputTape', () => {
  const tape = createInputTape([
    { axisX: 1, axisY: 0, pressed: ['Space'] },
    { axisX: -1, axisY: 1, pressed: [] },
  ]);

  it('replays a frame by tick index', () => {
    expect(tape.at(0)).toEqual({ axisX: 1, axisY: 0, pressed: ['Space'] });
    expect(tape.at(1)).toMatchObject({ axisX: -1, axisY: 1 });
  });

  it('is pure: asking twice gives the same answer', () => {
    expect(tape.at(0)).toEqual(tape.at(0));
  });

  it('yields empty input past the end, since a replay may outrun the recording', () => {
    expect(tape.at(99)).toEqual(EMPTY_INPUT);
  });

  it('normalises what it was given', () => {
    expect(createInputTape([{ axisX: 9, axisY: 0, pressed: [] }]).at(0).axisX).toBe(1);
  });

  it.each([-1, 1.5, Number.NaN])('rejects tick %s', (tick) => {
    expect(() => tape.at(tick)).toThrow(RangeError);
  });
});

describe('createLiveInput', () => {
  it('reports held keys as axes', () => {
    const target = fakeTarget();
    const input = createLiveInput(target);
    target.fire('keydown', 'ArrowRight');
    expect(input.at(0).axisX).toBe(1);
    target.fire('keyup', 'ArrowRight');
    expect(input.at(0).axisX).toBe(0);
  });

  it('cancels opposite directions rather than letting one win', () => {
    const target = fakeTarget();
    const input = createLiveInput(target);
    target.fire('keydown', 'ArrowLeft');
    target.fire('keydown', 'ArrowRight');
    expect(input.at(0).axisX).toBe(0);
  });

  /**
   * Input is sampled, not consumed. A frame that runs three simulation steps
   * must see the same held state for all three; a fixed timestep is exactly
   * the claim that the number of steps does not change what each step sees.
   */
  it('reports the same held state for every step within a frame', () => {
    const target = fakeTarget();
    const input = createLiveInput(target);
    target.fire('keydown', 'KeyD');
    expect([input.at(0), input.at(1), input.at(2)].map((f) => f.axisX)).toEqual([1, 1, 1]);
  });

  it('clears edge-triggered actions once per step, and only in endTick', () => {
    const target = fakeTarget();
    const input = createLiveInput(target);
    target.fire('keydown', 'Space');
    expect(input.at(0).pressed).toEqual(['Space']);
    // Still there: `at` must be pure, so it cannot be what clears the edge.
    expect(input.at(0).pressed).toEqual(['Space']);
    input.endTick();
    expect(input.at(1).pressed).toEqual([]);
  });

  it('stops responding after dispose', () => {
    const target = fakeTarget();
    const input = createLiveInput(target);
    input.dispose();
    target.fire('keydown', 'ArrowRight');
    expect(input.at(0).axisX).toBe(0);
  });

  it('binds both arrows and WASD to the same axes', () => {
    expect(DEFAULT_KEY_BINDINGS['ArrowLeft']).toBe(DEFAULT_KEY_BINDINGS['KeyA']);
    expect(DEFAULT_KEY_BINDINGS['ArrowUp']).toBe(DEFAULT_KEY_BINDINGS['KeyW']);
  });

  it('ignores an unbound key for the axes but still reports the press', () => {
    const target = fakeTarget();
    const input = createLiveInput(target);
    target.fire('keydown', 'KeyQ');
    expect(input.at(0)).toMatchObject({ axisX: 0, axisY: 0, pressed: ['KeyQ'] });
  });
});

describe('recordInput', () => {
  it('captures a source into a replayable tape', () => {
    const source = createInputTape([
      { axisX: 1, axisY: 0, pressed: [] },
      { axisX: 0, axisY: 1, pressed: [] },
    ]);
    const replayed = createInputTape(recordInput(source, 3));
    expect([0, 1, 2].map((t) => replayed.at(t))).toEqual([0, 1, 2].map((t) => source.at(t)));
  });
});
