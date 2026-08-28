import { describe, expect, it } from 'vitest';
import {
  FractionalIndexError,
  INDEX_ALPHABET,
  firstKey,
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

  it.each([1, 2, 3, 4, 5])('holds for seed %i over 200 insertions', (seed) => {
    const keys = buildByRandomInsertion(seed, 200);

    expect(keys).toHaveLength(200);
    expect(new Set(keys).size, 'keys must be unique').toBe(keys.length);
    expect([...keys].sort(), 'sorted order must match insertion order').toEqual(keys);
    for (const key of keys) expect(isValidIndexKey(key)).toBe(true);
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
