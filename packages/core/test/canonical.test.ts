import { describe, expect, it } from 'vitest';
import { CanonicalError, canonicalize, parseCanonical } from '../src/canonical.ts';

describe('canonicalize primitives', () => {
  it.each([
    ['null', null, 'null'],
    ['true', true, 'true'],
    ['false', false, 'false'],
    ['zero', 0, '0'],
    ['an integer', 42, '42'],
    ['a negative integer', -42, '-42'],
    ['a fraction', 0.5, '0.5'],
    ['an empty string', '', '""'],
    ['a string', 'hello', '"hello"'],
  ])('encodes %s', (_label, value, expected) => {
    expect(canonicalize(value)).toBe(expected);
  });

  it('normalises negative zero, which nothing else in the system can see', () => {
    expect(canonicalize(-0)).toBe('0');
    expect(canonicalize(0)).toBe(canonicalize(-0));
  });

  it('formats extreme magnitudes the way the spec pins', () => {
    expect(canonicalize(1e21)).toBe(String(1e21));
    expect(canonicalize(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
    expect(canonicalize(Number.MIN_VALUE)).toBe(String(Number.MIN_VALUE));
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s rather than writing null the way JSON.stringify does', (_label, value) => {
    expect(JSON.stringify(value)).toBe('null');
    expect(() => canonicalize(value)).toThrow(CanonicalError);
  });

  it.each([
    ['undefined', undefined],
    ['a function', (): void => undefined],
    ['a symbol', Symbol('x')],
    ['a bigint', 1n],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalize(value)).toThrow(CanonicalError);
  });
});

describe('canonicalize strings', () => {
  it.each([
    ['a quote', '"'],
    ['a backslash', '\\'],
    ['a newline', '\n'],
    ['a tab', '\t'],
    ['a control character', ''],
    ['a lone surrogate', '\ud800'],
    ['an astral character', '\u{1f3ae}'],
    ['non-ASCII that needs no escape', 'éüñ'],
  ])('escapes %s exactly as the spec pins', (_label, value) => {
    expect(canonicalize(value)).toBe(JSON.stringify(value));
  });
});

describe('canonicalize objects', () => {
  it('sorts keys by UTF-16 code unit', () => {
    expect(canonicalize({ b: 1, a: 2, C: 3 })).toBe('{"C":3,"a":2,"b":1}');
  });

  it('produces the same text regardless of insertion order', () => {
    expect(canonicalize({ x: 1, y: 2 })).toBe(canonicalize({ y: 2, x: 1 }));
  });

  /**
   * The trap this serializer exists for. JavaScript orders integer-like keys
   * first and ascending, ahead of every string key, so sorting into a fresh
   * object and calling JSON.stringify silently produces unsorted output.
   */
  it('sorts integer-like keys as strings, which JSON.stringify does not', () => {
    const value = { '10': 'ten', '2': 'two', b: 'bee', '1': 'one' };
    expect(canonicalize(value)).toBe('{"1":"one","10":"ten","2":"two","b":"bee"}');

    const viaSortedObject = JSON.stringify(
      Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))),
    );
    expect(viaSortedObject).not.toBe(canonicalize(value));
  });

  it('encodes an empty object', () => {
    expect(canonicalize({})).toBe('{}');
  });

  it('recurses into nested objects', () => {
    expect(canonicalize({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('rejects an undefined property rather than dropping it', () => {
    expect(JSON.stringify({ a: undefined })).toBe('{}');
    expect(() => canonicalize({ a: undefined })).toThrow(CanonicalError);
  });

  it('names the path of the offending value', () => {
    expect(() => canonicalize({ scene: { entities: [{ x: Number.NaN }] } })).toThrow(
      /\$\.scene\.entities\[0\]\.x/,
    );
  });
});

describe('canonicalize arrays', () => {
  it('preserves order, which is meaningful in an array', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('encodes an empty array', () => {
    expect(canonicalize([])).toBe('[]');
  });

  it('rejects a hole rather than writing null the way JSON.stringify does', () => {
    const sparse = [1, undefined, 3] as unknown[];
    expect(JSON.stringify(sparse)).toBe('[1,null,3]');
    expect(() => canonicalize(sparse)).toThrow(CanonicalError);
  });
});

describe('canonicalize cycles', () => {
  it('rejects a self-referencing object', () => {
    const value: Record<string, unknown> = {};
    value['self'] = value;
    expect(() => canonicalize(value)).toThrow(/circular reference/);
  });

  it('rejects a cycle through an array', () => {
    const items: unknown[] = [];
    items.push(items);
    expect(() => canonicalize(items)).toThrow(/circular reference/);
  });

  it('allows the same object appearing twice without a cycle', () => {
    const shared = { a: 1 };
    expect(canonicalize({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
  });
});

describe('round trip', () => {
  it.each([
    ['a scalar', 42],
    ['a string', 'hello'],
    ['a flat object', { b: 1, a: 'two' }],
    ['a nested structure', { a: [1, { c: 2, b: [true, null] }] }],
    ['numeric-looking keys', { '2': 'b', '1': 'a', z: 'c' }],
    ['unicode keys', { é: 'accent', z: 'plain' }],
  ])('is stable for %s', (_label, value) => {
    const once = canonicalize(value);
    expect(canonicalize(parseCanonical(once))).toBe(once);
  });
});
