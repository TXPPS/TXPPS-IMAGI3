import { describe, expect, it } from 'vitest';
import {
  FractionalIndexError,
  INDEX_ALPHABET,
  firstKey,
  isSortableIndexKey,
  isValidIndexKey,
  keyBetween,
  keysAfter,
} from '../src/fractional-index.ts';
import { createRandom } from '../src/random.ts';

describe('the alphabet', () => {
  it('is ascending in code unit order, so plain string sort matches digit order', () => {
    for (let i = 1; i < INDEX_ALPHABET.length; i += 1) {
      expect(
        INDEX_ALPHABET.charCodeAt(i - 1) < INDEX_ALPHABET.charCodeAt(i),
        `digit ${String(i)} is not above its predecessor`,
      ).toBe(true);
    }
  });

  it('has no duplicate digits', () => {
    expect(new Set(INDEX_ALPHABET).size).toBe(INDEX_ALPHABET.length);
  });
});

describe('isValidIndexKey', () => {
  it.each([
    ['a single digit', 'V', true],
    ['several digits', 'a0V', true],
    ['the smallest usable key', '1', true],
    ['an empty key', '', false],
    ['a trailing smallest digit', 'a0', false],
    ['only the smallest digit', '0', false],
    ['a character outside the alphabet', 'a-b', false],
    ['a space', 'a b', false],
  ])('classifies %s', (_label, key, expected) => {
    expect(isValidIndexKey(key)).toBe(expected);
  });
});

/**
 * The weaker predicate the schema boundary uses. The distinction is the whole
 * reason a trailing-zero key is repaired rather than rejected: it sorts, so the
 * document can be read, so refusing it would discard a peer's work over
 * something that costs nothing to correct.
 */
describe('isSortableIndexKey', () => {
  it.each([
    ['a single digit', 'V', true],
    ['a trailing smallest digit, which sorts but is not canonical', 'a0', true],
    ['only the smallest digit', '0', true],
    ['an empty key', '', false],
    ['a character outside the alphabet', 'a-b', false],
    ['a space', 'a b', false],
    ['an astral character', 'a\u{1f3ae}', false],
  ])('classifies %s', (_label, key, expected) => {
    expect(isSortableIndexKey(key)).toBe(expected);
  });

  it('is implied by validity, never the other way round', () => {
    // A key the strict predicate accepts must always be sortable; the reverse
    // must not hold, or the two predicates are the same one under two names.
    for (const key of ['V', 'a0V', '1', 'zzz']) {
      expect(isValidIndexKey(key) && isSortableIndexKey(key)).toBe(true);
    }
    expect(isSortableIndexKey('a0') && !isValidIndexKey('a0')).toBe(true);
  });
});

describe('keyBetween', () => {
  it('produces a key that sorts between its bounds', () => {
    const lower = firstKey();
    const upper = keyBetween(lower, null);
    const middle = keyBetween(lower, upper);

    expect(lower < middle).toBe(true);
    expect(middle < upper).toBe(true);
  });

  it('produces a key after a lower bound when the upper is open', () => {
    const first = firstKey();
    expect(first < keyBetween(first, null)).toBe(true);
  });

  it('produces a key before an upper bound when the lower is open', () => {
    const first = firstKey();
    expect(keyBetween(null, first) < first).toBe(true);
  });

  it('always returns a valid key', () => {
    const a = firstKey();
    const b = keyBetween(a, null);
    for (const key of [a, b, keyBetween(a, b), keyBetween(null, a), keyBetween(b, null)]) {
      expect(isValidIndexKey(key), `${key} is not a valid key`).toBe(true);
    }
  });

  it('rejects bounds that are out of order', () => {
    const a = firstKey();
    const b = keyBetween(a, null);
    expect(() => keyBetween(b, a)).toThrow(FractionalIndexError);
  });

  it('rejects equal bounds, since nothing fits between them', () => {
    const a = firstKey();
    expect(() => keyBetween(a, a)).toThrow(FractionalIndexError);
  });

  it.each([
    ['an empty bound', '', 'V'],
    ['a trailing smallest digit', 'a0', 'b'],
    ['a character outside the alphabet', 'a-b', 'b'],
  ])('rejects %s', (_label, lower, upper) => {
    expect(() => keyBetween(lower, upper)).toThrow(FractionalIndexError);
  });
});

describe('keysAfter', () => {
  it('returns strictly increasing keys', () => {
    const keys = keysAfter(null, 10);
    for (let i = 1; i < keys.length; i += 1) {
      expect(keys[i - 1]! < keys[i]!, `${keys[i - 1]!} is not below ${keys[i]!}`).toBe(true);
    }
  });

  it('returns keys after the given lower bound', () => {
    const lower = firstKey();
    for (const key of keysAfter(lower, 5)) expect(lower < key).toBe(true);
  });

  it('returns nothing for a count of zero', () => {
    expect(keysAfter(null, 0)).toEqual([]);
  });

  it('rejects a negative or fractional count', () => {
    expect(() => keysAfter(null, -1)).toThrow(FractionalIndexError);
    expect(() => keysAfter(null, 1.5)).toThrow(FractionalIndexError);
  });
});

/**
 * The property that matters: after any sequence of insertions at arbitrary
 * positions, sorting by key must reproduce the intended order. Ordering keys
 * exist to survive exactly this, so it is asserted against random insertions
 * rather than a handful of chosen ones.
 */
describe('ordering survives arbitrary insertion sequences', () => {
  function buildByRandomInsertion(seed: number, count: number): string[] {
    const random = createRandom(seed);
    const keys: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const position = Math.floor(random.next() * (keys.length + 1));
      const lower = position === 0 ? null : (keys[position - 1] ?? null);
      const upper = position === keys.length ? null : (keys[position] ?? null);
      keys.splice(position, 0, keyBetween(lower, upper));
    }
    return keys;
  }

  /**
   * Twenty seeds of a thousand insertions, not five of two hundred.
   *
   * The count is deliberate. The bug that shipped here — `keyBetween` emitting
   * `0`, the infimum of the whole ordering, when a lower bound ran out of
   * digits — was invisible to inspection and took roughly two hundred random
   * insertions to reach. A property test sized just past the fault it already
   * found is sized to find nothing new, so this runs an order of magnitude
   * deeper. Seeds are fixed, so a failure names a run that can be repeated.
   */
  const SEEDS = Array.from({ length: 20 }, (_, index) => index + 1);
  const INSERTIONS = 1000;

  it.each(SEEDS)(`holds for seed %i over ${String(INSERTIONS)} insertions`, (seed) => {
    const keys = buildByRandomInsertion(seed, INSERTIONS);

    expect(keys).toHaveLength(INSERTIONS);
    expect(new Set(keys).size, 'keys must be unique').toBe(keys.length);
    expect([...keys].sort(), 'sorted order must match insertion order').toEqual(keys);
    for (const key of keys) expect(isValidIndexKey(key)).toBe(true);
  });

  /**
   * The invariant restated as its consequence, because "valid" is a predicate
   * a future edit could weaken. Every generated key must be strictly between
   * the bounds it was asked for, and must never be the infimum of the ordering
   * — a key nothing can precede is a position that can never be prepended to
   * again, which is data loss deferred by months.
   */
  it.each(SEEDS.slice(0, 10))('never generates an unprependable key for seed %i', (seed) => {
    const random = createRandom(seed);
    const keys: string[] = [];
    for (let i = 0; i < 400; i += 1) {
      const position = Math.floor(random.next() * (keys.length + 1));
      const lower = position === 0 ? null : (keys[position - 1] ?? null);
      const upper = position === keys.length ? null : (keys[position] ?? null);
      const key = keyBetween(lower, upper);

      if (lower !== null) expect(lower < key, `"${key}" is not above "${lower}"`).toBe(true);
      if (upper !== null) expect(key < upper, `"${key}" is not below "${upper}"`).toBe(true);
      // The supremum has no representation to compare against; the infimum
      // does, and it is the one that has actually been produced by mistake.
      expect(key.endsWith('0'), `"${key}" is an infimum nothing can sort before`).toBe(false);
      expect(() => keyBetween(null, key), `nothing fits before "${key}"`).not.toThrow();

      keys.splice(position, 0, key);
    }
  });

  it('keeps keys short enough to be practical', () => {
    // Repeatedly splitting the same gap is the worst case for key length.
    let lower = firstKey();
    const upper = keyBetween(lower, null);
    for (let i = 0; i < 100; i += 1) lower = keyBetween(lower, upper);

    expect(lower < upper).toBe(true);
    expect(lower.length).toBeLessThan(30);
  });

  it('survives repeated insertion at the front', () => {
    let first = firstKey();
    const keys = [first];
    for (let i = 0; i < 50; i += 1) {
      first = keyBetween(null, first);
      keys.unshift(first);
    }
    expect([...keys].sort()).toEqual(keys);
  });
});
