import { createRandom, type Clock, type SceneDocument } from '@imagi3/core';
import { hashSnapshot } from './hash.ts';
import type { InputSource } from './input.ts';
import { createWorld, snapshot, stepWorld, type Bounds, type WorldSnapshot } from './simulation.ts';
import { createTickLoop, type Frame, type TickLoop } from './tick.ts';

/**
 * A running simulation: the loop, the world, and the input feeding it.
 *
 * **One runtime, two consumers.** Editor play mode and an exported build both
 * construct a session through this function and drive it the same way. There is
 * no editor-only path and no export-only path, because any divergence between
 * them is a class of bug where the game behaves differently from what the
 * author tested — which the brief marks P0 and which is far cheaper to make
 * structurally impossible than to test for.
 *
 * What differs between the two consumers is only what is passed in: which
 * clock, which input source, which document. That is the whole surface.
 */

export interface SessionOptions {
  readonly document: SceneDocument;
  readonly clock: Clock;
  readonly input: InputSource;
  /** Seeds the simulation's RNG. The same seed replays the same run. */
  readonly seed: number;
  readonly stepMs?: number;
  readonly bounds?: Bounds;
}

export interface Session {
  /**
   * Run the steps the elapsed wall time affords.
   *
   * Returns the frame so a renderer can interpolate by `alpha` between
   * {@link previous} and {@link current}.
   */
  advance(): Frame;
  /** State after the last completed step. */
  current(): WorldSnapshot;
  /** State after the step before that, for interpolation. */
  previous(): WorldSnapshot;
  /** Hash of the current state. Identical inputs give identical hashes. */
  hash(): string;
  readonly loop: TickLoop;
}

export function createSession(options: SessionOptions): Session {
  const world = createWorld(options.document, createRandom(options.seed), options.bounds);
  const loop = createTickLoop({ clock: options.clock, ...pickStep(options) });

  // Both start equal, so a renderer interpolating on the very first frame
  // draws the initial state rather than between it and undefined.
  let previous = snapshot(world);
  let current = previous;

  return {
    loop,
    advance: () =>
      loop.advance((tick) => {
        previous = current;
        stepWorld(world, options.input.at(tick), loop.stepMs);
        current = snapshot(world);
      }),
    current: () => current,
    previous: () => previous,
    hash: () => hashSnapshot(current),
  };
}

/** Spread-safe optional, because `exactOptionalPropertyTypes` rejects `undefined`. */
function pickStep(options: SessionOptions): { stepMs?: number } {
  return options.stepMs === undefined ? {} : { stepMs: options.stepMs };
}

/**
 * Run a fixed number of steps with no clock involved at all.
 *
 * The determinism suite uses this rather than driving a manual clock, because
 * the property under test is "the same inputs produce the same state" and a
 * clock is not one of the inputs — it only ever decides how many steps run.
 * Threading one through would add a variable that has nothing to do with the
 * claim.
 */
export function runHeadless(options: Omit<SessionOptions, 'clock'> & { readonly ticks: number }): {
  readonly hash: string;
  readonly state: WorldSnapshot;
} {
  if (!Number.isInteger(options.ticks) || options.ticks < 0) {
    throw new RangeError(`ticks must be a non-negative integer, got ${String(options.ticks)}`);
  }
  const world = createWorld(options.document, createRandom(options.seed), options.bounds);
  const stepMs = options.stepMs ?? createTickLoop({ clock: { now: () => 0 } }).stepMs;

  for (let tick = 0; tick < options.ticks; tick += 1) {
    stepWorld(world, options.input.at(tick), stepMs);
  }
  const state = snapshot(world);
  return { hash: hashSnapshot(state), state };
}
