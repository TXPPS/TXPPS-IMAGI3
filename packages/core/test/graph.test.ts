import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/canonical.ts';
import { isValidIndexKey, keyBetween } from '../src/fractional-index.ts';
import {
  ancestorsOf,
  childIndex,
  childrenOf,
  isWellFormedTree,
  repairSceneGraph,
  repairedOrderKey,
  rootsOf,
} from '../src/graph.ts';
import { createIdFactory } from '../src/ids.ts';
import { createRandom } from '../src/random.ts';
import { sceneFrom } from '../src/schema/build.ts';
import { SCHEMA_VERSION, type Entity, type SceneDocument } from '../src/schema/types.ts';
import { generateScene } from './helpers/scene-generator.ts';

/**
 * Cycle repair.
 *
 * The properties here are not stylistic preferences; each names a way peers
 * could silently diverge. A repair that depends on traversal order, or on the
 * order updates arrived in, produces two different documents from the same
 * merged state on two different machines, and nothing reports an error. The
 * convergence test is the one that actually matters — the rest are the
 * conditions that make it hold.
 */

const ids = createIdFactory(createRandom(1));

function entity(id: string, parent: string | null, order = 'V'): Entity {
  return { id, name: id, parent, order, components: {} };
}

function scene(entities: readonly Entity[]): SceneDocument {
  return sceneFrom('sc_test00000000', 'test', entities);
}

/** The same document with its entity map built in a different insertion order. */
function permuted(document: SceneDocument, seed: number): SceneDocument {
  const random = createRandom(seed);
  const entities = Object.values(document.entities);
  for (let i = entities.length - 1; i > 0; i -= 1) {
    const j = random.nextUint32() % (i + 1);
    const a = entities[i];
    const b = entities[j];
    if (a === undefined || b === undefined) continue;
    entities[i] = b;
    entities[j] = a;
  }
  return sceneFrom(document.id, document.name, entities);
}

describe('repairSceneGraph', () => {
  it('leaves a sound document untouched, byte for byte', () => {
    const sound = generateScene({ seed: 3, entityCount: 60 });
    const repair = repairSceneGraph(sound);
    expect(repair.diagnostics).toEqual([]);
    expect(canonicalize(repair.document)).toBe(canonicalize(sound));
  });

  it('returns the same object when there was nothing to repair', () => {
    // Not merely equal. A repair that rebuilt every document would defeat the
    // identity checks the undo stack and the sync layer rely on.
    const sound = generateScene({ seed: 4, entityCount: 20 });
    expect(repairSceneGraph(sound).document).toBe(sound);
  });

  it('breaks a two-entity cycle at its lowest id', () => {
    const document = scene([entity('en_b', 'en_a'), entity('en_a', 'en_b')]);
    const { document: repaired, diagnostics } = repairSceneGraph(document);

    expect(repaired.entities['en_a']?.parent).toBeNull();
    expect(repaired.entities['en_b']?.parent).toBe('en_a');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.kind).toBe('cycle-broken');
    expect(diagnostics[0]?.entity).toBe('en_a');
  });

  it('repairs a self-parent, which is a cycle of one', () => {
    const { document: repaired, diagnostics } = repairSceneGraph(scene([entity('en_a', 'en_a')]));
    expect(repaired.entities['en_a']?.parent).toBeNull();
    expect(diagnostics[0]?.kind).toBe('cycle-broken');
    expect(diagnostics[0]).toMatchObject({ cycle: ['en_a'] });
  });

  it('re-parents an entity whose parent was deleted by a peer', () => {
    const { document: repaired, diagnostics } = repairSceneGraph(
      scene([entity('en_a', 'en_gone')]),
    );
    expect(repaired.entities['en_a']?.parent).toBeNull();
    expect(diagnostics[0]?.kind).toBe('missing-parent');
  });

  it('repairs several disjoint cycles in one pass', () => {
    const document = scene([
      entity('en_a', 'en_b'),
      entity('en_b', 'en_a'),
      entity('en_c', 'en_d'),
      entity('en_d', 'en_c'),
    ]);
    const { document: repaired, diagnostics } = repairSceneGraph(document);

    expect(diagnostics).toHaveLength(2);
    expect(repaired.entities['en_a']?.parent).toBeNull();
    expect(repaired.entities['en_c']?.parent).toBeNull();
    expect(isWellFormedTree(repaired)).toBe(true);
  });

  it('repairs a long cycle at its lowest id, not at where the walk started', () => {
    const document = scene([
      entity('en_d', 'en_c'),
      entity('en_c', 'en_b'),
      entity('en_b', 'en_a'),
      entity('en_a', 'en_d'),
    ]);
    const { diagnostics } = repairSceneGraph(document);
    expect(diagnostics[0]?.entity).toBe('en_a');
    expect(diagnostics[0]).toMatchObject({ cycle: ['en_a', 'en_b', 'en_c', 'en_d'] });
  });

  /**
   * The cycle is broken at its lowest id, not at whichever member the walk
   * happened to enter through — and the two are usually the same, which is why
   * every earlier test here passed with the sort removed. The mutation sweep
   * found it: `lowestId` returning `cycle[0]` unsorted survived the whole
   * suite.
   *
   * They diverge only when the walk enters the cycle from *outside* it. Here
   * `en_a` is a leaf hanging off `en_d`, so the walk starts at `en_a` (the
   * lowest id overall), reaches the cycle at `en_d`, and the cycle array begins
   * `en_d`. The lowest member is `en_b`. Two peers that disagreed about this
   * would produce different trees from the same merge.
   */
  it('breaks the cycle at its lowest id, not where the walk entered it', () => {
    const document = scene([
      entity('en_a', 'en_d'),
      entity('en_b', 'en_c'),
      entity('en_c', 'en_d'),
      entity('en_d', 'en_b'),
    ]);
    const { document: repaired, diagnostics } = repairSceneGraph(document);

    expect(diagnostics[0]?.entity).toBe('en_b');
    expect(repaired.entities['en_b']?.parent).toBeNull();
    expect(repaired.entities['en_d']?.parent).toBe('en_b');
    // The leaf is not a cycle member and must keep its parent.
    expect(repaired.entities['en_a']?.parent).toBe('en_d');
  });

  it('keeps a subtree hanging off a cycle, rooting it through the repair', () => {
    const document = scene([
      entity('en_a', 'en_b'),
      entity('en_b', 'en_a'),
      entity('en_leaf', 'en_b'),
    ]);
    const { document: repaired, diagnostics } = repairSceneGraph(document);

    // The leaf is not itself cyclic and must not be re-parented.
    expect(diagnostics).toHaveLength(1);
    expect(repaired.entities['en_leaf']?.parent).toBe('en_b');
    expect(ancestorsOf(repaired, 'en_leaf').map((e) => e.id)).toEqual(['en_b', 'en_a']);
  });

  it('repairs a cycle that swallowed a root-level entity', () => {
    // en_a was a root; a merge parented it under its own descendant.
    const document = scene([
      entity('en_a', 'en_c'),
      entity('en_b', 'en_a'),
      entity('en_c', 'en_b'),
      entity('en_other', null),
    ]);
    const { document: repaired } = repairSceneGraph(document);
    expect(isWellFormedTree(repaired)).toBe(true);
    expect(
      rootsOf(repaired)
        .map((e) => e.id)
        .sort(),
    ).toEqual(['en_a', 'en_other']);
  });

  it('never drops an entity', () => {
    const document = scene([
      entity('en_a', 'en_b'),
      entity('en_b', 'en_a'),
      entity('en_c', 'en_gone'),
      entity('en_d', 'en_d'),
    ]);
    const { document: repaired } = repairSceneGraph(document);
    expect(Object.keys(repaired.entities).sort()).toEqual(['en_a', 'en_b', 'en_c', 'en_d']);
  });

  it('gives a repaired entity a canonical ordering key', () => {
    const { document: repaired } = repairSceneGraph(scene([entity('en_a', 'en_a')]));
    expect(isValidIndexKey(repaired.entities['en_a']?.order ?? '')).toBe(true);
  });

  it('rewrites an ordering key that sorts but can never be prepended to', () => {
    const { document: repaired, diagnostics } = repairSceneGraph(
      scene([entity('en_a', null, 'V0')]),
    );
    expect(diagnostics[0]?.kind).toBe('order-key-repaired');
    expect(repaired.entities['en_a']?.order).not.toBe('V0');
    expect(isValidIndexKey(repaired.entities['en_a']?.order ?? '')).toBe(true);
  });
});

/**
 * Idempotence, order-independence and convergence, stated as properties over
 * generated input rather than over one hand-built pair. The fractional index
 * bug that shipped took two hundred random insertions to surface and was
 * invisible to inspection; chosen examples are not evidence for this class of
 * property.
 */
describe('repair is a pure function of document state', () => {
  const damaged = damagedScenes();

  it.each(damaged)('is idempotent for %s', (_label, document) => {
    const once = repairSceneGraph(document).document;
    const twice = repairSceneGraph(once).document;
    expect(canonicalize(twice)).toBe(canonicalize(once));
  });

  it.each(damaged)('leaves no diagnostics on a second pass for %s', (_label, document) => {
    expect(repairSceneGraph(repairSceneGraph(document).document).diagnostics).toEqual([]);
  });

  it.each(damaged)('produces a well-formed tree for %s', (_label, document) => {
    expect(isWellFormedTree(repairSceneGraph(document).document)).toBe(true);
  });

  it.each(damaged)('is independent of entity insertion order for %s', (_label, document) => {
    const expected = canonicalize(repairSceneGraph(document).document);
    // Twenty permutations, not two. The property is over all orderings, and a
    // single alternate ordering can agree by luck.
    for (let seed = 1; seed <= 20; seed += 1) {
      const shuffled = repairSceneGraph(permuted(document, seed)).document;
      expect(canonicalize(shuffled), `permutation ${String(seed)} repaired differently`).toBe(
        expected,
      );
    }
  });

  /**
   * The test that actually matters. Two peers receive the same merged document
   * through different update orderings — which is what a CRDT delivers — and
   * must land on the same bytes. Anything else is a silent divergence.
   */
  it.each(damaged)('converges for peers that received %s differently ordered', (_l, document) => {
    const peerA = repairSceneGraph(permuted(document, 101)).document;
    const peerB = repairSceneGraph(permuted(document, 202)).document;
    expect(canonicalize(peerA)).toBe(canonicalize(peerB));
  });

  it('reports diagnostics in an order that does not depend on the walk', () => {
    const document = damagedScene(7, 40);
    const straight = repairSceneGraph(document).diagnostics.map((d) => d.entity);
    const shuffled = repairSceneGraph(permuted(document, 55)).diagnostics.map((d) => d.entity);
    expect(shuffled).toEqual(straight);
  });

  it('actually damages the generated scenes, so the properties are not vacuous', () => {
    for (const [label, document] of damaged) {
      expect(
        repairSceneGraph(document).diagnostics.length,
        `${label} needed no repair`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('repairedOrderKey', () => {
  it('is a pure function of the id', () => {
    expect(repairedOrderKey('en_abc')).toBe(repairedOrderKey('en_abc'));
  });

  it('differs for different ids', () => {
    expect(repairedOrderKey('en_abc')).not.toBe(repairedOrderKey('en_abd'));
  });

  it('always produces a canonical key', () => {
    const random = createRandom(9);
    for (let i = 0; i < 2000; i += 1) {
      const id = `en_${String(random.nextUint32())}`;
      expect(isValidIndexKey(repairedOrderKey(id)), `"${id}" produced an invalid key`).toBe(true);
    }
  });

  it('produces a key that can still be inserted before', () => {
    // The whole point of canonicality: a repaired entity must not become the
    // permanent first child of the root.
    const key = repairedOrderKey('en_abc');
    expect(() => keyBetween(null, key)).not.toThrow();
  });

  it('handles an id whose hash would otherwise yield only the smallest digit', () => {
    // Exercised by construction rather than by hoping a random id lands there.
    expect(isValidIndexKey(repairedOrderKey(''))).toBe(true);
  });
});

describe('tree derivation', () => {
  const document = generateScene({ seed: 11, entityCount: 80 });

  it('agrees with the per-parent index', () => {
    const index = childIndex(document);
    for (const id of [null, ...Object.keys(document.entities)]) {
      expect(childrenOf(document, id).map((e) => e.id)).toEqual(
        (index.get(id) ?? []).map((e) => e.id),
      );
    }
  });

  it('sorts siblings by key then id, so equal keys still have a total order', () => {
    const tied = scene([entity('en_b', null, 'V'), entity('en_a', null, 'V')]);
    expect(childrenOf(tied, null).map((e) => e.id)).toEqual(['en_a', 'en_b']);
  });

  it('walks ancestors from parent to root', () => {
    const chain = scene([entity('en_a', null), entity('en_b', 'en_a'), entity('en_c', 'en_b')]);
    expect(ancestorsOf(chain, 'en_c').map((e) => e.id)).toEqual(['en_b', 'en_a']);
  });

  it('throws on an unrepaired cycle rather than truncating the walk', () => {
    const cyclic = scene([entity('en_a', 'en_b'), entity('en_b', 'en_a')]);
    expect(() => ancestorsOf(cyclic, 'en_a')).toThrow(/cyclic/u);
  });

  it('throws on an unrepaired dangling parent rather than stopping quietly', () => {
    expect(() => ancestorsOf(scene([entity('en_a', 'en_gone')]), 'en_a')).toThrow(/missing/u);
  });
});

/** A generated scene with cycles, dangling parents and bad keys planted in it. */
function damagedScene(seed: number, entityCount: number): SceneDocument {
  const random = createRandom(seed);
  const sound = generateScene({ seed, entityCount });
  const entities = Object.values(sound.entities).map((each) => ({ ...each }));

  for (const each of entities) {
    switch (random.nextUint32() % 8) {
      case 0:
        each.parent = each.id;
        break;
      case 1:
        each.parent = ids.entity();
        break;
      case 2:
        each.order = `${each.order}0`;
        break;
      case 3: {
        // A back-edge to a random entity, which closes a cycle when the target
        // happens to be a descendant.
        const target = entities[random.nextUint32() % entities.length];
        if (target !== undefined) each.parent = target.id;
        break;
      }
      default:
        break;
    }
  }
  return sceneFrom(sound.id, sound.name, entities);
}

function damagedScenes(): [string, SceneDocument][] {
  return [
    ['a small damaged scene', damagedScene(1, 12)],
    ['a mid-sized damaged scene', damagedScene(2, 60)],
    ['a deep damaged chain', damagedScene(3, 120)],
    ['a large damaged scene', damagedScene(4, 400)],
  ];
}

describe('document invariants after repair', () => {
  it('keeps the schema version and identity', () => {
    const damaged = damagedScene(5, 30);
    const { document } = repairSceneGraph(damaged);
    expect(document.schemaVersion).toBe(SCHEMA_VERSION);
    expect(document.id).toBe(damaged.id);
    expect(document.name).toBe(damaged.name);
  });
});
