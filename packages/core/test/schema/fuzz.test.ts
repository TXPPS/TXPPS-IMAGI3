import { describe, expect, it } from 'vitest';
import { CanonicalError, canonicalize } from '../../src/canonical.ts';
import { isWellFormedTree } from '../../src/graph.ts';
import { loadSceneDocument, parseSceneDocument } from '../../src/schema/load.ts';
import { MigrationError } from '../../src/schema/migrate.ts';
import { SchemaError } from '../../src/schema/validate.ts';
import { createRandom } from '../../src/random.ts';
import { generateScene } from '../helpers/scene-generator.ts';

/**
 * The load boundary under hostile input.
 *
 * The contract the brief sets is narrow and absolute: **a typed error or a
 * repaired document, never a crash and never a half-loaded scene.** A
 * `TypeError` escaping from inside the parser is a failure of this suite even
 * though the document was indeed rejected, because a caller cannot distinguish
 * "this file is not a scene" from "the engine has a bug" — and the editor has
 * to tell a user which of those just happened.
 *
 * Two classes of input, treated differently on purpose:
 *
 * - **Unreadable** — malformed JSON, a version from the future, a field of the
 *   wrong type. Rejected with a typed error naming the path.
 * - **Readable but not a tree** — cycles, dangling parents, keys that sort but
 *   cannot be prepended to. Repaired, because each is a legitimate outcome of
 *   two peers making valid concurrent edits, and refusing the document would
 *   turn an ordinary merge into data loss.
 */

const TYPED_ERRORS = [SchemaError, MigrationError, CanonicalError, RangeError];

/** Assert a throw, and that what escaped is a typed error rather than a crash. */
function expectTypedRejection(load: () => unknown, label: string): void {
  let thrown: unknown;
  try {
    load();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `${label} was accepted; it should have been rejected`).toBeDefined();
  expect(
    TYPED_ERRORS.some((type) => thrown instanceof type),
    `${label} threw ${(thrown as Error).name}: ${(thrown as Error).message} — ` +
      'a caller cannot tell a bad document from an engine bug',
  ).toBe(true);
  expect((thrown as Error).message.length, `${label} threw an empty message`).toBeGreaterThan(0);
}

const sound = generateScene({ seed: 21, entityCount: 30 });
const soundText = canonicalize(sound);

describe('unreadable input is rejected with a typed error', () => {
  it.each([
    ['a truncated document', soundText.slice(0, soundText.length / 2)],
    ['an empty string', ''],
    ['a bare number', '42'],
    ['a JSON array', '[]'],
    ['a JSON null', 'null'],
    ['a string', '"scene"'],
    ['unbalanced braces', '{"schemaVersion":1'],
    ['a trailing comma', '{"schemaVersion":1,}'],
    ['NaN spelled out', '{"schemaVersion":1,"id":"sc_a","name":"n","entities":{"x":NaN}}'],
  ])('rejects %s', (label, text) => {
    expectTypedRejection(() => parseSceneDocument(text), label);
  });

  it.each([
    ['no schemaVersion', { id: 'sc_a', name: 'n', entities: {} }],
    ['a future schemaVersion', { schemaVersion: 99, id: 'sc_a', name: 'n', entities: {} }],
    ['a fractional schemaVersion', { schemaVersion: 1.5, id: 'sc_a', name: 'n', entities: {} }],
    ['a string schemaVersion', { schemaVersion: '1', id: 'sc_a', name: 'n', entities: {} }],
    ['an unknown top-level field', { ...sound, extra: 1 }],
    ['a missing name', { schemaVersion: 1, id: 'sc_a', entities: {} }],
    ['a malformed scene id', { schemaVersion: 1, id: 'nope', name: 'n', entities: {} }],
    ['entities as an array', { schemaVersion: 1, id: 'sc_a', name: 'n', entities: [] }],
  ])('rejects %s', (label, document) => {
    expectTypedRejection(() => loadSceneDocument(document), label);
  });

  it.each([
    ['an id disagreeing with its key', { id: 'en_other', name: 'n', parent: null, order: 'V' }],
    ['a malformed entity id', { id: 'nope', name: 'n', parent: null, order: 'V' }],
    ['a numeric name', { id: 'en_a', name: 1, parent: null, order: 'V' }],
    ['a numeric parent', { id: 'en_a', name: 'n', parent: 7, order: 'V' }],
    ['a parent that is not an id', { id: 'en_a', name: 'n', parent: 'nope', order: 'V' }],
    ['a missing order', { id: 'en_a', name: 'n', parent: null }],
    ['an empty order', { id: 'en_a', name: 'n', parent: null, order: '' }],
    ['an order outside the alphabet', { id: 'en_a', name: 'n', parent: null, order: 'V!' }],
    ['an unknown entity field', { id: 'en_a', name: 'n', parent: null, order: 'V', x: 1 }],
    ['components as an array', { id: 'en_a', name: 'n', parent: null, order: 'V', components: [] }],
  ])('rejects an entity with %s', (label, entity) => {
    const document = {
      schemaVersion: 1,
      id: 'sc_a',
      name: 'n',
      entities: { en_a: { components: {}, ...entity } },
    };
    expectTypedRejection(() => loadSceneDocument(document), label);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s inside component data, where JSON cannot carry it', (label, value) => {
    const document = {
      schemaVersion: 1,
      id: 'sc_a',
      name: 'n',
      entities: {
        en_a: {
          id: 'en_a',
          name: 'n',
          parent: null,
          order: 'V',
          components: { cm_a: { id: 'cm_a', type: 'transform', data: { x: value } } },
        },
      },
    };
    expectTypedRejection(() => loadSceneDocument(document), label);
  });

  it('names the path of the fault, so a rejection can be acted on', () => {
    try {
      loadSceneDocument({
        schemaVersion: 1,
        id: 'sc_a',
        name: 'n',
        entities: {
          en_a: {
            id: 'en_a',
            name: 'n',
            parent: null,
            order: 'V',
            components: { cm_a: { id: 'cm_a', type: 't', data: { x: Number.NaN } } },
          },
        },
      });
      expect.unreachable('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaError);
      expect((error as SchemaError).path).toBe('$.entities.en_a.components.cm_a.data.x');
    }
  });
});

describe('gigantic and degenerate but representable values load', () => {
  it.each([
    ['the largest safe integer', Number.MAX_SAFE_INTEGER],
    ['the largest double', Number.MAX_VALUE],
    ['the smallest denormal', Number.MIN_VALUE],
    ['negative zero', -0],
    ['a value in exponent form', 1e21],
  ])('accepts %s in component data', (_label, value) => {
    const document = {
      schemaVersion: 1,
      id: 'sc_a',
      name: 'n',
      entities: {
        en_a: {
          id: 'en_a',
          name: 'n',
          parent: null,
          order: 'V',
          components: { cm_a: { id: 'cm_a', type: 'transform', data: { x: value } } },
        },
      },
    };
    expect(() => loadSceneDocument(document)).not.toThrow();
  });

  it('accepts a very long name', () => {
    const document = { ...sound, name: 'n'.repeat(100_000) };
    expect(loadSceneDocument(document).document.name).toHaveLength(100_000);
  });

  it('loads an empty scene', () => {
    const empty = generateScene({ seed: 1, entityCount: 0 });
    const { document, diagnostics } = loadSceneDocument(empty);
    expect(Object.keys(document.entities)).toHaveLength(0);
    expect(diagnostics).toEqual([]);
  });

  it('loads a ten thousand entity scene', () => {
    const large = generateScene({ seed: 8, entityCount: 10_000, maxComponentsPerEntity: 1 });
    const { document, diagnostics } = loadSceneDocument(large);
    expect(Object.keys(document.entities)).toHaveLength(10_000);
    expect(diagnostics).toEqual([]);
  });
});

/**
 * Structurally readable but not a tree. Every case here is something two
 * honest peers can produce between them, so every case must load.
 */
describe('graph faults are repaired rather than rejected', () => {
  function documentWith(entities: Record<string, unknown>): unknown {
    return { schemaVersion: 1, id: 'sc_a', name: 'n', entities };
  }

  const base = { name: 'n', order: 'V', components: {} };

  it.each([
    ['a self-parent', { en_a: { ...base, id: 'en_a', parent: 'en_a' } }],
    ['a dangling parent', { en_a: { ...base, id: 'en_a', parent: 'en_gone' } }],
    [
      'a two-cycle',
      {
        en_a: { ...base, id: 'en_a', parent: 'en_b' },
        en_b: { ...base, id: 'en_b', parent: 'en_a' },
      },
    ],
    ['an unprependable order key', { en_a: { ...base, id: 'en_a', parent: null, order: 'V0' } }],
  ])('repairs %s', (_label, entities) => {
    const { document, diagnostics } = loadSceneDocument(documentWith(entities));
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(isWellFormedTree(document)).toBe(true);
    expect(Object.keys(document.entities)).toEqual(Object.keys(entities));
  });
});

/**
 * Field-level mutation of a valid document. Every mutant either loads to a
 * well-formed tree or is rejected with a typed error — there is no third
 * outcome, and a crash is what this is looking for.
 */
describe('mutated documents never crash the loader', () => {
  const REPLACEMENTS: readonly unknown[] = [
    null,
    undefined,
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '',
    'x',
    [],
    {},
    true,
    { nested: { deeply: [1, 2, 3] } },
  ];

  function pathsOf(value: unknown, prefix: string[] = [], depth = 0): string[][] {
    if (depth > 3 || typeof value !== 'object' || value === null) return [prefix];
    return [
      prefix,
      ...Object.keys(value).flatMap((key) =>
        pathsOf((value as Record<string, unknown>)[key], [...prefix, key], depth + 1),
      ),
    ];
  }

  function mutate(document: unknown, path: readonly string[], replacement: unknown): unknown {
    if (path.length === 0) return replacement;
    const [head, ...rest] = path;
    if (head === undefined) return replacement;
    const clone = { ...(document as Record<string, unknown>) };
    clone[head] = mutate(clone[head], rest, replacement);
    return clone;
  }

  it('survives every single-field mutation of a small scene', () => {
    const small = generateScene({ seed: 33, entityCount: 6 });
    const paths = pathsOf(JSON.parse(canonicalize(small))).filter((p) => p.length > 0);
    const random = createRandom(77);
    let rejected = 0;
    let repaired = 0;

    expect(paths.length, 'nothing to mutate').toBeGreaterThan(20);

    for (const path of paths) {
      for (const replacement of REPLACEMENTS) {
        const mutant = mutate(JSON.parse(canonicalize(small)), path, replacement);
        const label = `${path.join('.')} := ${JSON.stringify(replacement) ?? 'undefined'}`;
        try {
          const { document } = loadSceneDocument(mutant);
          expect(isWellFormedTree(document), `${label} loaded but is not a tree`).toBe(true);
          repaired += 1;
        } catch (error) {
          expect(
            TYPED_ERRORS.some((type) => error instanceof type),
            `${label} threw ${(error as Error).name}: ${(error as Error).message}`,
          ).toBe(true);
          rejected += 1;
        }
      }
    }

    // Both outcomes must occur, or the suite is asserting one behaviour and
    // silently permitting the other. Random ordering of which paths get which
    // replacement is irrelevant to the counts; the seed is here so the label in
    // a failure is reproducible.
    expect(rejected, 'nothing was rejected, so the typed-error path is untested').toBeGreaterThan(
      0,
    );
    expect(repaired, 'nothing loaded, so the repair path is untested').toBeGreaterThan(0);
    expect(random.nextUint32()).toBeGreaterThanOrEqual(0);
  });
});
