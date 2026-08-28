/**
 * Deterministic randomness.
 *
 * `Math.random` is forbidden in core. A scene that generates ids, or a
 * simulation that consumes randomness, must produce identical results from
 * identical inputs — that is what makes the determinism suite, the round-trip
 * property test and reproducible play-mode possible at all. Randomness is
 * therefore a value that gets passed in, never an ambient capability.
 */
export interface Random {
  /** Next value in [0, 1). */
  next(): number;
  /** Next unsigned 32-bit integer. */
  nextUint32(): number;
}

const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const UINT32_RANGE = 0x1_0000_0000;

/**
 * A linear congruential generator, chosen for being small, fast, and
 * bit-identical across every engine — not for statistical quality. It seeds
 * ids and test fixtures; nothing here needs cryptographic or simulation-grade
 * randomness, and if something ever does it should say so and use its own.
 */
export function createRandom(seed: number): Random {
  if (!Number.isInteger(seed)) {
    throw new RangeError(`seed must be an integer, got ${String(seed)}`);
  }
  let state = seed >>> 0;
  const nextUint32 = (): number => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state;
  };
  return {
    nextUint32,
    next: () => nextUint32() / UINT32_RANGE,
  };
}
