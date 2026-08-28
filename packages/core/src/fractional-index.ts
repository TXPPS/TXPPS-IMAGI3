/**
 * Fractional indices: ordering keys you can always insert between.
 *
 * Sibling order in the scene tree is a string, not an integer position, because
 * ADR-0012 forbids positional identity. Integer indices force a renumber on
 * every insert, and a renumber is a write to every sibling — which under
 * concurrent editing means every insert conflicts with every other insert.
 *
 * A fractional index instead names a point in an ordering. Between any two
 * distinct keys a third can always be generated, touching nothing else, so an
 * insert is a single write that merges cleanly.
 *
 * Keys are compared as ordinary strings. The alphabet is therefore chosen so
 * that digit order and UTF-16 code unit order are the same thing: `0`-`9`,
 * then `A`-`Z`, then `a`-`z`, which is already ascending in ASCII. Sorting
 * needs no special comparator anywhere in the system.
 *
 * The algorithm is the well-known midpoint construction. Its one invariant is
 * that a key never ends in the smallest digit, and the reason is sharper than
 * it first appears. `0` is the infimum of the ordering: no string sorts before
 * it, so a list whose first key is `0` can never be prepended to again. The
 * invariant is not tidiness, it is what keeps every position insertable
 * forever. A bug that violated it survived until a property test inserted 200
 * items at random positions and hit the case.
 */

/** Ordered digit alphabet. Ascending in both digit value and code unit. */
export const INDEX_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const SMALLEST_DIGIT = INDEX_ALPHABET[0] ?? '0';
const RADIX = INDEX_ALPHABET.length;

export class FractionalIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FractionalIndexError';
  }
}

function digitValue(character: string): number {
  const value = INDEX_ALPHABET.indexOf(character);
  if (value < 0) {
    throw new FractionalIndexError(`"${character}" is not a valid ordering key digit`);
  }
  return value;
}

/**
 * The digit at a position, treating an exhausted key as the smallest digit.
 *
 * The fallback is load-bearing, not defensive. Comparing an exhausted lower
 * bound as "no digit" makes the shared-prefix scan stop one place early, and
 * the algorithm then returns a bare prefix — which for an upper bound of `01`
 * is the key `0`. That key is the infimum of the whole ordering: nothing can
 * ever be inserted before it, so producing one silently destroys the ability
 * to prepend to that list forever.
 */
function digitAt(key: string, position: number): string {
  return key[position] ?? SMALLEST_DIGIT;
}

/** A key is valid when it is non-empty, all digits, and has no trailing zero. */
export function isValidIndexKey(key: string): boolean {
  if (key.length === 0) return false;
  if (key.endsWith(SMALLEST_DIGIT)) return false;
  // Iterating by code point is correct here even though the alphabet is ASCII:
  // an astral character arrives as one two-unit string, which is not in the
  // alphabet and is rejected, rather than as two units that might each pass.
  for (const character of key) {
    if (!INDEX_ALPHABET.includes(character)) return false;
  }
  return true;
}

function assertValid(key: string, label: string): void {
  if (!isValidIndexKey(key)) {
    throw new FractionalIndexError(`${label} "${key}" is not a valid ordering key`);
  }
}

/** Places the two keys agree on, with an exhausted key reading as zeroes. */
function sharedPrefixLength(lower: string, upper: string): number {
  let shared = 0;
  while (shared < upper.length && digitAt(lower, shared) === digitAt(upper, shared)) shared += 1;
  return shared;
}

/** Leading digit values of the two bounds, with the open ends at the extremes. */
function boundingDigits(lower: string, upper: string | null): { low: number; high: number } {
  return {
    low: lower.length > 0 ? digitValue(digitAt(lower, 0)) : 0,
    high: upper !== null ? digitValue(digitAt(upper, 0)) : RADIX,
  };
}

/**
 * A key strictly between `lower` and `upper`, treating each as unbounded when
 * null. Recurses through any shared prefix, then splits the first differing
 * digit, and descends a place when there is no room between them.
 */
function midpoint(lower: string, upper: string | null): string {
  if (upper !== null && lower >= upper) {
    throw new FractionalIndexError(`"${lower}" is not below "${upper}"`);
  }

  if (upper !== null) {
    const shared = sharedPrefixLength(lower, upper);
    if (shared > 0) {
      return upper.slice(0, shared) + midpoint(lower.slice(shared), upper.slice(shared));
    }
  }

  const { low, high } = boundingDigits(lower, upper);
  if (high - low > 1) {
    return INDEX_ALPHABET[Math.round((low + high) / 2)] ?? SMALLEST_DIGIT;
  }
  // The digits are adjacent. If the upper key has more places, borrow from it;
  // otherwise keep the lower digit and find room one place further down.
  if (upper !== null && upper.length > 1) return upper.slice(0, 1);
  return (INDEX_ALPHABET[low] ?? SMALLEST_DIGIT) + midpoint(lower.slice(1), null);
}

/**
 * Generate an ordering key strictly between two existing keys.
 *
 * @param lower key to sort after, or null for "before everything".
 * @param upper key to sort before, or null for "after everything".
 * @throws {FractionalIndexError} when the bounds are invalid or out of order.
 */
export function keyBetween(lower: string | null, upper: string | null): string {
  if (lower !== null) assertValid(lower, 'lower bound');
  if (upper !== null) assertValid(upper, 'upper bound');
  if (lower !== null && upper !== null && lower >= upper) {
    throw new FractionalIndexError(`lower bound "${lower}" is not below upper bound "${upper}"`);
  }

  const key = midpoint(lower ?? '', upper);
  // Checked rather than assumed: a key that violates the invariant orders
  // correctly today and makes some future insertion impossible, which is the
  // kind of fault that surfaces as data loss months later.
  if (!isValidIndexKey(key)) {
    throw new FractionalIndexError(
      `generated an invalid ordering key "${key}" between ` +
        `${lower === null ? 'start' : `"${lower}"`} and ${upper === null ? 'end' : `"${upper}"`}`,
    );
  }
  return key;
}

/** The key for the only child of an empty parent. */
export function firstKey(): string {
  return keyBetween(null, null);
}

/**
 * Keys for `count` items appended after `lower`, in order.
 *
 * Generating them one at a time against a moving lower bound is what keeps
 * them strictly increasing; generating them all against the same bound would
 * produce duplicates.
 */
export function keysAfter(lower: string | null, count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new FractionalIndexError(`count must be a non-negative integer, got ${String(count)}`);
  }
  const keys: string[] = [];
  let previous = lower;
  for (let i = 0; i < count; i += 1) {
    previous = keyBetween(previous, null);
    keys.push(previous);
  }
  return keys;
}
