/**
 * Time as a value.
 *
 * `Date.now` and `performance.now` are forbidden in core for the same reason
 * `Math.random` is: the simulation must be reproducible from its inputs. The
 * tick loop advances a fixed timestep from an accumulator, and the wall clock
 * only ever decides *how many* steps to run — never what happens inside one.
 */
export interface Clock {
  /** Milliseconds since an arbitrary but fixed origin. Monotonic. */
  now(): number;
}

/** A clock the caller advances by hand. The only clock core's tests use. */
export function createManualClock(startMs = 0): Clock & { advance(ms: number): void } {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError(
          `clock can only advance by a non-negative finite amount, got ${String(ms)}`,
        );
      }
      current += ms;
    },
  };
}
