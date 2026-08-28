import { INDEX_ALPHABET, isValidIndexKey } from './fractional-index.ts';
import type { EntityId } from './ids.ts';
import type { Entity, SceneDocument } from './schema/types.ts';

/**
 * Tree derivation, and the repair that guarantees there is a tree to derive.
 *
 * The scene is stored as a flat map of entities with parent pointers, because
 * that is the shape that merges (ADR-0012). The consequence is that the
 * document can describe something that is not a tree: A parented under B while
 * B is parented under A is two valid edits by two peers, and the merge of two
 * valid edits is a cycle. So is a parent pointer at an entity another peer
 * deleted.
 *
 * **These are not corruption.** Rejecting such a document would turn a routine
 * concurrent edit into data loss, so the schema boundary deliberately passes
 * them through and they are repaired here, at load.
 *
 * The repair has one hard requirement, and it is not "sensible": it must be a
 * **pure function of document state**. Every peer must arrive at the same
 * repaired document from the same merged input, or the peers diverge — and a
 * divergence produced by a repair is the worst kind, because both sides think
 * they are correct and nothing reports an error. Insertion order, iteration
 * order, traversal start point, wall clock, a counter, which peer noticed
 * first: none of these may influence the outcome, and the tests hold the repair
 * to that by permuting the document and comparing serialised bytes.
 *
 * The rule, stated once so it can be checked: **each cycle is broken at its
 * lowest entity id, which is re-parented to the root with an ordering key
 * derived from that id.** Lowest id, because it is the only choice available
 * that depends on nothing but the cycle's own membership.
 */

/** An entity re-parented to the root to break a parent cycle. */
export interface CycleBroken {
  readonly kind: 'cycle-broken';
  readonly entity: EntityId;
  /** Every member of the cycle, sorted, so the diagnostic is stable. */
  readonly cycle: readonly EntityId[];
  readonly previousParent: EntityId;
  readonly order: string;
  readonly message: string;
}

/** An entity whose parent is not in the document, usually deleted by a peer. */
export interface MissingParent {
  readonly kind: 'missing-parent';
  readonly entity: EntityId;
  readonly previousParent: EntityId;
  readonly order: string;
  readonly message: string;
}

/**
 * An ordering key that sorts but is not canonical.
 *
 * A key ending in the smallest digit is the infimum of everything below it:
 * nothing can ever be inserted before it. It orders correctly today and makes
 * some future insertion impossible, so it is rewritten rather than kept.
 */
export interface OrderKeyRepaired {
  readonly kind: 'order-key-repaired';
  readonly entity: EntityId;
  readonly previousOrder: string;
  readonly order: string;
  readonly message: string;
}

export type SceneDiagnostic = CycleBroken | MissingParent | OrderKeyRepaired;

export interface SceneRepair {
  readonly document: SceneDocument;
  /** One entry per repair, in a deterministic order. Empty for a sound document. */
  readonly diagnostics: readonly SceneDiagnostic[];
}

/** Digits in a derived ordering key. Enough to spread repairs across the range. */
const REPAIR_KEY_DIGITS = 6;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const RADIX = INDEX_ALPHABET.length;
const SMALLEST_DIGIT = INDEX_ALPHABET[0] ?? '0';
/** Used when a hash yields nothing but the smallest digit, which is not a key. */
const FALLBACK_DIGIT = INDEX_ALPHABET[1] ?? '1';

/**
 * An ordering key derived from an entity id.
 *
 * Pure, and pure specifically of the things that would make peers diverge: no
 * counter, no timestamp, no dependence on what else is in the document. Two
 * peers repairing the same entity produce the same key because they hash the
 * same id.
 *
 * Collisions are harmless and are not defended against. Siblings sort by
 * `(order, id)`, so two entities landing on the same key still have a total
 * order, and it is the same total order on every peer.
 */
export function repairedOrderKey(id: EntityId): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < id.length; i += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(i), FNV_PRIME) >>> 0;
  }

  let key = '';
  for (let i = 0; i < REPAIR_KEY_DIGITS; i += 1) {
    key += INDEX_ALPHABET[hash % RADIX] ?? SMALLEST_DIGIT;
    hash = Math.floor(hash / RADIX);
  }

  // A key may not end in the smallest digit; see OrderKeyRepaired.
  const trimmed = key.replace(/0+$/u, '');
  return trimmed === '' ? FALLBACK_DIGIT : trimmed;
}

/**
 * Entity ids in canonical order.
 *
 * This is what makes the repair independent of how the document was assembled.
 * `Object.keys` returns insertion order, so two peers holding the same document
 * built from differently-ordered updates would otherwise traverse it
 * differently — and a traversal-dependent repair is exactly the divergence this
 * module exists to prevent.
 */
function sortedIds(document: SceneDocument): EntityId[] {
  return Object.keys(document.entities).sort();
}

interface Mutation {
  readonly parent?: EntityId | null;
  readonly order?: string;
}

interface Draft {
  /** The entity as it stands, including repairs applied so far. */
  get(id: EntityId): Entity;
  set(id: EntityId, mutation: Mutation): void;
  build(): SceneDocument;
}

/**
 * Accumulates per-entity changes so the document is rebuilt exactly once.
 *
 * Each repair stage reads through the draft rather than the original, so a
 * later stage sees the earlier stage's work — cycle detection must walk the
 * parent pointers as they will be, not as they were.
 */
function createDraft(document: SceneDocument): Draft {
  const pending = new Map<EntityId, Mutation>();

  const get = (id: EntityId): Entity => {
    const entity = document.entities[id];
    if (entity === undefined) throw new Error(`no entity "${id}" in this document`);
    const mutation = pending.get(id);
    return mutation === undefined ? entity : { ...entity, ...mutation };
  };

  return {
    get,
    set: (id, mutation) => {
      pending.set(id, { ...pending.get(id), ...mutation });
    },
    build: () => {
      if (pending.size === 0) return document;
      const entities: Record<EntityId, Entity> = {};
      // Rebuilt in the document's own key order, not sorted order: the
      // canonical serialiser sorts keys itself, and preserving insertion order
      // here keeps a document byte-identical through a no-op repair.
      for (const id of Object.keys(document.entities)) entities[id] = get(id);
      return { ...document, entities };
    },
  };
}

function repairOrderKeys(document: SceneDocument, draft: Draft): SceneDiagnostic[] {
  const diagnostics: SceneDiagnostic[] = [];
  for (const id of sortedIds(document)) {
    const entity = draft.get(id);
    if (isValidIndexKey(entity.order)) continue;
    const order = repairedOrderKey(id);
    draft.set(id, { order });
    diagnostics.push({
      kind: 'order-key-repaired',
      entity: id,
      previousOrder: entity.order,
      order,
      message:
        `ordering key "${entity.order}" is not canonical and would make some future ` +
        `insertion impossible; rewritten as "${order}"`,
    });
  }
  return diagnostics;
}

function repairMissingParents(document: SceneDocument, draft: Draft): SceneDiagnostic[] {
  const diagnostics: SceneDiagnostic[] = [];
  for (const id of sortedIds(document)) {
    const entity = draft.get(id);
    const parent = entity.parent;
    if (parent === null || Object.hasOwn(document.entities, parent)) continue;
    const order = repairedOrderKey(id);
    draft.set(id, { parent: null, order });
    diagnostics.push({
      kind: 'missing-parent',
      entity: id,
      previousParent: parent,
      order,
      message: `parent "${parent}" is not in this document; re-parented to the root`,
    });
  }
  return diagnostics;
}

/**
 * Every parent cycle in the document.
 *
 * Each entity has at most one parent, so the parent map is a functional graph
 * and its cycles are vertex-disjoint — which is why "nested cycles" cannot
 * exist and why the set of cycles is uniquely determined by the document rather
 * than by how it is walked. Subtrees hanging off a cycle are not themselves
 * cyclic and become rooted the moment the cycle they hang from is broken.
 *
 * Each entity is walked at most once, so this is linear even though it looks
 * like it could revisit.
 */
function findCycles(document: SceneDocument, draft: Draft): EntityId[][] {
  const settled = new Set<EntityId>();
  const cycles: EntityId[][] = [];

  for (const start of sortedIds(document)) {
    if (settled.has(start)) continue;
    const path: EntityId[] = [];
    const positions = new Map<EntityId, number>();
    let node: EntityId | null = start;

    while (node !== null && !settled.has(node) && !positions.has(node)) {
      positions.set(node, path.length);
      path.push(node);
      node = draft.get(node).parent;
    }

    const revisited = node === null ? undefined : positions.get(node);
    if (revisited !== undefined) cycles.push(path.slice(revisited));
    for (const visited of path) settled.add(visited);
  }
  return cycles;
}

function lowestId(cycle: readonly EntityId[]): EntityId {
  const sorted = [...cycle].sort();
  const first = sorted[0];
  if (first === undefined) throw new Error('a cycle cannot be empty');
  return first;
}

function repairCycles(document: SceneDocument, draft: Draft): SceneDiagnostic[] {
  // Sorted by the entity each repair touches, so the diagnostic list does not
  // depend on which cycle the walk happened to reach first.
  const cycles = findCycles(document, draft)
    .map((cycle) => ({ members: [...cycle].sort(), broken: lowestId(cycle) }))
    .sort((a, b) => (a.broken < b.broken ? -1 : 1));

  return cycles.map(({ members, broken }) => {
    const previousParent = draft.get(broken).parent;
    if (previousParent === null) throw new Error('a cycle member cannot be a root');
    const order = repairedOrderKey(broken);
    draft.set(broken, { parent: null, order });
    return {
      kind: 'cycle-broken',
      entity: broken,
      cycle: members,
      previousParent,
      order,
      message:
        `parent cycle ${members.join(' -> ')} broken at its lowest id; ` +
        `"${broken}" re-parented from "${previousParent}" to the root`,
    };
  });
}

/**
 * Make a validated document into a tree, deterministically.
 *
 * Never throws and never drops an entity: a repair that loses data is worse
 * than the condition it repairs. Runs in one pass in a fixed order — ordering
 * keys, then missing parents, then cycles — because breaking a cycle can only
 * remove edges and re-parenting a dangling child can only remove edges, so
 * neither later stage can reintroduce work for an earlier one. That is what
 * makes the function idempotent.
 */
export function repairSceneGraph(document: SceneDocument): SceneRepair {
  const draft = createDraft(document);
  const diagnostics = [
    ...repairOrderKeys(document, draft),
    ...repairMissingParents(document, draft),
    ...repairCycles(document, draft),
  ];
  return { document: draft.build(), diagnostics };
}

/**
 * Sibling ordering: by key, then by id.
 *
 * The id tiebreak is not decoration. Two peers can concurrently generate the
 * same ordering key, and without a total order the two would sort differently
 * on each peer — a divergence no merge can repair because both are "correct".
 */
export function compareSiblings(a: Entity, b: Entity): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Children of an entity, in sibling order. */
export function childrenOf(document: SceneDocument, parent: EntityId | null): Entity[] {
  return Object.values(document.entities)
    .filter((entity) => entity.parent === parent)
    .sort(compareSiblings);
}

/** Top-level entities, in sibling order. */
export function rootsOf(document: SceneDocument): Entity[] {
  return childrenOf(document, null);
}

/**
 * Children of every parent, computed in one pass.
 *
 * {@link childrenOf} scans the whole document per call, which is right for one
 * lookup and quadratic for walking a tree. Anything traversing more than a
 * couple of parents should build this once.
 */
export function childIndex(document: SceneDocument): Map<EntityId | null, Entity[]> {
  const index = new Map<EntityId | null, Entity[]>();
  for (const entity of Object.values(document.entities)) {
    const siblings = index.get(entity.parent);
    if (siblings === undefined) index.set(entity.parent, [entity]);
    else siblings.push(entity);
  }
  for (const siblings of index.values()) siblings.sort(compareSiblings);
  return index;
}

/**
 * Ancestors from the entity's parent up to the root.
 *
 * @throws when the chain does not terminate, which a repaired document
 * guarantees it does. Silently truncating would hide exactly the fault
 * {@link repairSceneGraph} exists to remove.
 */
export function ancestorsOf(document: SceneDocument, id: EntityId): Entity[] {
  const ancestors: Entity[] = [];
  const seen = new Set<EntityId>([id]);
  let current = document.entities[id]?.parent ?? null;

  while (current !== null) {
    if (seen.has(current)) {
      throw new Error(`entity "${id}" has a cyclic parent chain; repair the document at load`);
    }
    seen.add(current);
    const parent = document.entities[current];
    if (parent === undefined) {
      throw new Error(`entity "${current}" is missing; repair the document at load`);
    }
    ancestors.push(parent);
    current = parent.parent;
  }
  return ancestors;
}

/** Whether every parent chain terminates at the root and every key is canonical. */
export function isWellFormedTree(document: SceneDocument): boolean {
  return repairSceneGraph(document).diagnostics.length === 0;
}
