import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/canonical.ts';
import { loadSceneDocument } from '../../src/schema/load.ts';
import {
  COMPONENT_FIELDS,
  DOCUMENT_FIELDS,
  ENTITY_FIELDS,
  type SceneDocument,
} from '../../src/schema/types.ts';
import { generateScene } from '../helpers/scene-generator.ts';

/**
 * The serialiser audit, and the reason it exists is not the serialiser.
 *
 * `canonicalize` takes every key it is given, so nothing can go missing there.
 * The projection that can lose a field is one layer up: `validateSceneDocument`
 * rebuilds each entity and component as an **explicit object literal**. A field
 * added to `ENTITY_FIELDS` but not to that literal is accepted by the boundary
 * and then silently dropped, and the round-trip property test cannot see it —
 * because the round trip compares the document *after* validation to itself.
 *
 * That is the same mechanism that hid the missing velocity from the determinism
 * suite (RC-0015): a property test is only as strong as the projection it
 * compares, and the projection is a guard like any other.
 *
 * The brief calls this a P4 blocker if it holds. It does not hold today, and
 * these tests are what will say so when it starts to.
 */

const scene = generateScene({ seed: 41, entityCount: 12 });

function loaded(document: SceneDocument): SceneDocument {
  return loadSceneDocument(document).document;
}

describe('the load boundary preserves every declared field', () => {
  it('keeps exactly the declared document fields', () => {
    expect(Object.keys(loaded(scene)).sort()).toEqual([...DOCUMENT_FIELDS].sort());
  });

  it('keeps exactly the declared entity fields', () => {
    const entity = Object.values(loaded(scene).entities)[0];
    expect(entity, 'the generated scene has no entities to audit').toBeDefined();
    expect(Object.keys(entity ?? {}).sort()).toEqual([...ENTITY_FIELDS].sort());
  });

  it('keeps exactly the declared component fields', () => {
    const component = Object.values(loaded(scene).entities)
      .flatMap((entity) => Object.values(entity.components))
      .at(0);
    expect(component, 'the generated scene has no components to audit').toBeDefined();
    expect(Object.keys(component ?? {}).sort()).toEqual([...COMPONENT_FIELDS].sort());
  });

  /**
   * The stronger form, and the one that would have caught a dropped field
   * before anyone thought to name it: load a document and compare its canonical
   * bytes to the original's. A field the validator drops changes the bytes.
   *
   * This is not the same as the round-trip test, which serialises, parses, and
   * compares the *result of validation* to itself — a projection compared to
   * itself agrees no matter what it discards.
   */
  it('produces bytes identical to the document it was given', () => {
    expect(canonicalize(loaded(scene))).toBe(canonicalize(scene));
  });

  it('is byte-identical for a scene with awkward content', () => {
    const awkward = generateScene({ seed: 3, entityCount: 200 });
    expect(canonicalize(loaded(awkward))).toBe(canonicalize(awkward));
  });

  it('is byte-identical for an empty scene', () => {
    const empty = generateScene({ seed: 5, entityCount: 0 });
    expect(canonicalize(loaded(empty))).toBe(canonicalize(empty));
  });
});

/**
 * The declared field lists are what `rejectUnknownFields` enforces at the
 * boundary, so a field missing from a list is rejected on load — loudly, and
 * not this class of problem. A field *present* in a list and absent from the
 * rebuilt literal is the silent one, which is what the tests above cover.
 *
 * These assert the lists themselves still describe the schema, so that adding a
 * field to a type without adding it to its list fails here rather than at a
 * user's first save.
 */
describe('the declared field lists match the schema', () => {
  it('names every document field', () => {
    expect([...DOCUMENT_FIELDS].sort()).toEqual(['entities', 'id', 'name', 'schemaVersion']);
  });

  it('names every entity field', () => {
    expect([...ENTITY_FIELDS].sort()).toEqual(['components', 'id', 'name', 'order', 'parent']);
  });

  it('names every component field', () => {
    expect([...COMPONENT_FIELDS].sort()).toEqual(['data', 'id', 'type']);
  });

  it('declares no field twice', () => {
    for (const list of [DOCUMENT_FIELDS, ENTITY_FIELDS, COMPONENT_FIELDS]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
