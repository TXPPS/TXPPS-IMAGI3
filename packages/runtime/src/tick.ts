import type { Clock } from '@imagi3/core';

/**
 * The fixed-timestep loop.
 *
 * The simulation advances in steps of exactly {@link TickOptions.stepMs}, and
 * nothing inside a step can observe how long that step took to compute or when
 * it happened. The wall clock decides only **how many** steps to run; it never
 * decides what happens inside one. That single rule is what makes a replay from
 * a seed and an input tape reproduce a session exactly, and it is why the loop
 * is a value here rather than a `requestAnimationFrame` callback with `delta`
 * threaded through it.
 *
 * Rendering interpolates. A fixed simulation rate and a variable display rate
 * disagree by definition — at 60Hz simulation on a 144Hz display, most frames
 * fall between two steps — and drawing the last completed step makes motion
 * stutter at exactly the beat frequency between the two rates. The loop
 * therefore reports {@link Frame.alpha}, the fraction of a step elapsed since
 * the last one, and the renderer draws between the previous state and the
 * current one. Interpolation is a rendering concern only: it never writes back
 * into simulation state.
 */

const MS_PER_SECOND = 1000;
/** Simulation frequency. 60Hz is the rate every renderer can divide into. */
export const DEFAULT_STEP_HZ = 60;
/** Simulation rate, expressed as the step rather than the frequency. */
export const DEFAULT_STEP_MS = MS_PER_SECOND / DEFAULT_STEP_HZ;

/**
 * Longest wall-clock gap a single `advance` will simulate.
 *
 * Beyond this the accumulator is clamped and the excess time is discarded. A
 * backgrounded tab returns with minutes of elapsed time, and simulating all of
 * it in one frame produces a loop that runs for minutes, misses its next frame,
 * accumulates more debt, and never recovers — the spiral of death. Discarding
 * time is visible to the user as the world having moved on; not discarding it
 * is visible as the tab hanging.
 */
export const DEFAULT_MAX_FRAME_MS = 250;

export interface TickOptions {
  readonly stepMs?: number;
  readonly maxFrameMs?: number;
  /** Wall clock. Only ever used to decide how many steps to run. */
  readonly clock: Clock;
}

/** What a single `advance` produced, for the renderer to draw. */
export interface Frame {
  /** Steps simulated during this advance. Zero is normal and not an error. */
  readonly steps: number;
  /**
   * Fraction of a step elapsed beyond the last completed one, in [0, 1).
   *
   * The renderer interpolates by this much between the previous simulation
   * state and the current one.
   */
  readonly alpha: number;
  /** Total steps since the loop started. The simulation's own notion of time. */
  readonly tick: number;
  /** Wall-clock milliseconds discarded to avoid a death spiral, if any. */
  readonly droppedMs: number;
}

export interface TickLoop {
  /**
   * Run whatever whole steps the elapsed wall time affords, calling `step` for
   * each, then report the frame.
   */
  advance(step: (tick: number) => void): Frame;
  /** Steps completed since the loop started. */
  readonly tick: number;
  /** The fixed step, in milliseconds. */
  readonly stepMs: number;
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${String(value)}`);
  }
}

/**
 * Create a fixed-timestep loop over an injected clock.
 *
 * The first `advance` runs zero steps: it establishes the origin against which
 * elapsed time is measured. A first frame that simulated a step would be
 * simulating time that had not passed, and the amount would depend on when the
 * clock happened to start.
 */
export function createTickLoop(options: TickOptions): TickLoop {
  const stepMs = options.stepMs ?? DEFAULT_STEP_MS;
  const maxFrameMs = options.maxFrameMs ?? DEFAULT_MAX_FRAME_MS;
  assertPositive(stepMs, 'stepMs');
  assertPositive(maxFrameMs, 'maxFrameMs');
  if (maxFrameMs < stepMs) {
    throw new RangeError(
      `maxFrameMs (${String(maxFrameMs)}) is below stepMs (${String(stepMs)}), ` +
        'so the loop could never complete a step',
    );
  }

  const { clock } = options;
  let previousMs = clock.now();
  let accumulator = 0;
  let tick = 0;

  const advance = (step: (tick: number) => void): Frame => {
    const nowMs = clock.now();
    // A clock that goes backwards would otherwise drive the accumulator
    // negative and stall the loop until it caught up. `Clock` is documented as
    // monotonic; this is what happens when an implementation is not.
    const elapsedMs = Math.max(0, nowMs - previousMs);
    previousMs = nowMs;

    const droppedMs = Math.max(0, elapsedMs - maxFrameMs);
    accumulator += elapsedMs - droppedMs;

    let steps = 0;
    while (accumulator >= stepMs) {
      accumulator -= stepMs;
      step(tick);
      tick += 1;
      steps += 1;
    }

    return { steps, alpha: accumulator / stepMs, tick, droppedMs };
  };

  return {
    advance,
    get tick() {
      return tick;
    },
    stepMs,
  };
}
