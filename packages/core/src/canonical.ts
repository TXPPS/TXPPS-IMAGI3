/**
 * Canonical JSON: one byte sequence per value, on every machine, forever.
 *
 * Scene documents are hashed, diffed, synced and compared byte-for-byte, so two
 * runs that mean the same thing must serialise the same way. `JSON.stringify`
 * alone cannot promise that, for a reason worth stating because it is easy to
 * miss:
 *
 * **Building a new object with sorted keys does not produce sorted output.**
 * JavaScript objects order integer-like keys first, ascending, ahead of every
 * string key, regardless of insertion order. `{"2":a,"b":c,"1":d}` serialises
 * as `{"1":...,"2":...,"b":...}`. Any "canonical" serializer that sorts keys
 * into a fresh object and hands it to `JSON.stringify` is silently wrong for
 * documents containing numeric-looking keys — which component data can.
 *
 * So the text is emitted directly. What each rule buys:
 *
 * - **Keys sorted by UTF-16 code unit.** A total order, and the same one every
 *   engine computes for `<` on strings. Not locale-aware, deliberately.
 * - **No insignificant whitespace.** Nothing to disagree about.
 * - **`-0` normalised to `0`.** They are the same value to every comparison a
 *   user can make, and `Object.is` is the only thing that separates them.
 *   Leaving both representable means two identical scenes can hash differently.
 * - **NaN and infinities rejected.** They have no JSON representation;
 *   `JSON.stringify` silently emits `null`, turning a broken value into a
 *   plausible one. Rejected here as well as at the schema boundary, because
 *   this is the last place to catch it.
 * - **Numbers via `String`.** ECMA-262 fully specifies Number-to-String, so it
 *   is identical across engines and versions. No custom float formatting: any
 *   scheme with a fixed precision either loses values or invents digits.
 * - **`undefined` rejected, not dropped.** `JSON.stringify` omits undefined
 *   object values and turns undefined array elements into `null`. Both are
 *   silent data loss.
 */

export class CanonicalError extends Error {
  /** Path to the offending value, so a rejected document names its own fault. */
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${message} at ${path}`);
    this.name = 'CanonicalError';
    this.path = path;
  }
}

function canonicalNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalError(
      `${String(value)} has no JSON representation; JSON.stringify would silently write null`,
      path,
    );
  }
  // Object.is is the only way to tell -0 from 0, which is exactly why it has
  // to be handled: nothing else in the system can see the difference.
  return Object.is(value, -0) ? '0' : String(value);
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'symbol') return 'a symbol';
  if (typeof value === 'bigint') return 'a bigint';
  return typeof value;
}

function canonicalizeArray(value: readonly unknown[], path: string, seen: Set<object>): string {
  const items = value.map((item, index) =>
    canonicalizeValue(item, `${path}[${String(index)}]`, seen),
  );
  return `[${items.join(',')}]`;
}

function canonicalizeObject(value: object, path: string, seen: Set<object>): string {
  // Sorted here, and the sorted order is used to emit text directly. Handing a
  // rebuilt object to JSON.stringify would reorder integer-like keys.
  const keys = Object.keys(value).sort();
  const record = value as Record<string, unknown>;
  const entries = keys.map((key) => {
    const encoded = canonicalizeValue(record[key], `${path}.${key}`, seen);
    return `${JSON.stringify(key)}:${encoded}`;
  });
  return `{${entries.join(',')}}`;
}

function canonicalizeValue(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return canonicalNumber(value, path);
  if (typeof value === 'string') return JSON.stringify(value);

  if (typeof value !== 'object') {
    throw new CanonicalError(`${describe(value)} cannot be serialised`, path);
  }
  if (seen.has(value)) {
    throw new CanonicalError('circular reference', path);
  }

  seen.add(value);
  try {
    return Array.isArray(value)
      ? canonicalizeArray(value, path, seen)
      : canonicalizeObject(value, path, seen);
  } finally {
    seen.delete(value);
  }
}

/**
 * Serialise a value to its canonical JSON text.
 *
 * @throws {CanonicalError} for a value JSON cannot represent faithfully, naming
 * the path so a rejected document says which field is at fault.
 */
export function canonicalize(value: unknown): string {
  return canonicalizeValue(value, '$', new Set<object>());
}

/**
 * Parse canonical JSON back to a value.
 *
 * Deliberately just `JSON.parse` for the parsing itself: canonical text is
 * ordinary JSON, and the round-trip property being asserted is
 * `canonicalize(parse(text)) === text`, which a bespoke parser would only make
 * harder to trust.
 *
 * The one thing added is the error type. A raw `SyntaxError` escaping from here
 * is indistinguishable, to a caller, from a bug in the engine — and the editor
 * has to tell a user which of the two just happened before it can decide
 * whether to offer them a retry or a bug report. Found by the fuzz suite, which
 * asserts that every rejection is typed.
 *
 * @throws {CanonicalError} when the text is not JSON.
 */
export function parseCanonical(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CanonicalError(`document is not valid JSON: ${reason}`, '$');
  }
}
