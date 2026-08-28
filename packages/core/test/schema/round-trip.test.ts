import { describe, expect, it } from 'vitest';
import { canonicalize, parseCanonical } from '../../src/canonical.ts';
import { migrateToCurrent } from '../../src/schema/migrate.ts';
import { validateSceneDocument } from '../../src/schema/validate.ts';
import { generateScene } from '../helpers/scene-generator.ts';

/**
 * The P1 gate's central property: a scene, serialised and read back, must
 * produce byte-identical canonical output.
 *
 * Byte equality on the canonical form is asserted rather than hash equality.
 * It is the stronger claim — two documents with the same hash could still
 * differ — and it costs nothing here, so the weaker check would only be worth
 * having if the stronger one were impractical.
 *
 * Scenes are generated from seeds, so a failure names a seed that reproduces
 * it rather than describing a run nobody can repeat.
 */

const SEEDS = [1, 2, 3, 7, 11, 42, 99, 1234, 65535, 2_147_483_647];

function roundTrip(document: unknown): string {
  const text = canonicalize(document);
  const parsed = parseCanonical(text);
  const revalidated = validateSceneDocument(migrateToCurrent(parsed));
  return canonicalize(revalidated);
}

describe('scene round trip', () => {
  it.each(SEEDS)('is byte-identical for a 40-entity scene from seed %i', (seed) => {
    const document = generateScene({ seed, entityCount: 40 });
    const once = canonicalize(document);

    expect(roundTrip(document), `seed ${String(seed)} did not round-trip`).toBe(once);
  });

  it.each(SEEDS.slice(0, 4))('is byte-identical for a deep chain from seed %i', (seed) => {
    const document = generateScene({ seed, entityCount: 60, nestingChance: 1 });
    expect(roundTrip(document)).toBe(canonicalize(document));
  });

  it.each(SEEDS.slice(0, 4))('is byte-identical for a flat fan from seed %i', (seed) => {
    const document = generateScene({ seed, entityCount: 60, nestingChance: 0 });
    expect(roundTrip(document)).toBe(canonicalize(document));
  });

  it('is byte-identical for an empty scene', () => {
    const document = generateScene({ seed: 5, entityCount: 0 });
    expect(Object.keys(document.entities)).toHaveLength(0);
    expect(roundTrip(document)).toBe(canonicalize(document));
  });

  it('is byte-identical for a single entity with no components', () => {
    const document = generateScene({ seed: 6, entityCount: 1, maxComponentsPerEntity: 0 });
    expect(roundTrip(document)).toBe(canonicalize(document));
  });

  it('is byte-identical for a 10,000-entity scene', () => {
    const document = generateScene({ seed: 8, entityCount: 10_000, maxComponentsPerEntity: 1 });
    expect(Object.keys(document.entities)).toHaveLength(10_000);
    expect(roundTrip(document)).toBe(canonicalize(document));
  });

  it('produces the same document from the same seed', () => {
    expect(canonicalize(generateScene({ seed: 12, entityCount: 30 }))).toBe(
      canonicalize(generateScene({ seed: 12, entityCount: 30 })),
    );
  });

  it('produces different documents from different seeds', () => {
    expect(canonicalize(generateScene({ seed: 12, entityCount: 30 }))).not.toBe(
      canonicalize(generateScene({ seed: 13, entityCount: 30 })),
    );
  });
});

/**
 * Serialising the same scene twice must produce identical bytes, and so must
 * serialising it in a fresh process. The second is what actually matters for
 * content addressing, and it is the one a same-process test cannot see.
 */
describe('serialisation stability', () => {
  it.each(SEEDS.slice(0, 5))('is stable across repeated calls for seed %i', (seed) => {
    const document = generateScene({ seed, entityCount: 25 });
    expect(canonicalize(document)).toBe(canonicalize(document));
  });

  it('does not depend on key insertion order', () => {
    const document = generateScene({ seed: 21, entityCount: 15 });
    const text = canonicalize(document);

    // Reparsing yields objects whose keys arrive in serialised order, which is
    // a different insertion order from the one the builder produced.
    expect(canonicalize(parseCanonical(text))).toBe(text);
  });
});

describe('generated scenes are valid by construction', () => {
  it.each(SEEDS)('seed %i passes the schema boundary', (seed) => {
    const document = generateScene({ seed, entityCount: 40 });
    expect(() => validateSceneDocument(document)).not.toThrow();
  });

  it('reaches the awkward cases it claims to', () => {
    const document = generateScene({ seed: 3, entityCount: 200 });
    const text = canonicalize(document);

    // Escapes, non-ASCII, and nesting all present, so the round-trip assertions
    // above are exercising encoding rather than a corpus of plain identifiers.
    expect(text, 'no escaped quote, so quoting is untested').toContain('\\"');
    expect(text, 'no escaped newline, so control escaping is untested').toContain('\\n');
    expect(text, 'no non-ASCII, so multi-byte encoding is untested').toMatch(/[\u00a0-\uffff]/);
    expect(Object.values(document.entities).some((entity) => entity.parent !== null)).toBe(true);
    expect(
      Object.values(document.entities).some((entity) => Object.keys(entity.components).length > 0),
    ).toBe(true);
  });
});
