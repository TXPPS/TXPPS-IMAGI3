import { canonicalize } from '@imagi3/core';
import type { WorldSnapshot } from './simulation.ts';

/**
 * A hash of simulation state, for the determinism suite.
 *
 * The hash is taken of the **canonical serialisation**, not of the objects.
 * That is the same choice the throttling evidence made and for the same reason:
 * it asserts a property of an artifact rather than of the code that produced
 * it. Walking the objects and folding their fields would let a change to field
 * order, or to which fields exist, alter the hash without altering the
 * simulation — or worse, leave the hash unchanged when the simulation changed.
 *
 * It also inherits the serialiser's guarantees for free: `-0` normalises to
 * `0`, NaN and the infinities are rejected rather than hashed to something,
 * and key order is fixed. A simulation that produces NaN fails here loudly
 * instead of hashing to a stable value and looking deterministic.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HEX = 16;
const LANE_DIGITS = 8;

/**
 * Two independent FNV-1a lanes over the same text, concatenated.
 *
 * 32 bits is too few: a determinism suite comparing ten thousand ticks across
 * two runs would meet a coincidental collision often enough to matter. Two
 * lanes with different seeds give 64 bits at a fraction of the cost of a real
 * 64-bit hash in JavaScript, where 64-bit integer arithmetic means BigInt.
 *
 * Not cryptographic, and nothing here needs it to be. This detects accidental
 * divergence, not a forged state.
 */
function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

function lane(text: string, seed: number): string {
  return fnv1a(text, seed).toString(HEX).padStart(LANE_DIGITS, '0');
}

/** Hash of a world snapshot. Identical inputs give identical hashes, always. */
export function hashSnapshot(state: WorldSnapshot): string {
  const text = canonicalize(
    // Explicit field list rather than the object as-is. A field added to
    // EntityState should be a deliberate decision to include in the hash, made
    // here, rather than something that silently changes every recorded hash.
    state.entities.map((entity) => ({
      id: entity.id,
      x: entity.x,
      y: entity.y,
      vx: entity.vx,
      vy: entity.vy,
    })),
  );
  return `${lane(text, FNV_OFFSET_BASIS)}${lane(text, ~FNV_OFFSET_BASIS)}`;
}
