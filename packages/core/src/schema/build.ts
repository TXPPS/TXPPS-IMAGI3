import { keyBetween } from '../fractional-index.ts';
import type { IdFactory } from '../ids.ts';
import type { ComponentId, EntityId, SceneId } from '../ids.ts';
import {
  SCHEMA_VERSION,
  type Component,
  type Entity,
  type JsonValue,
  type SceneDocument,
} from './types.ts';

/**
 * Construction helpers for scene documents.
 *
 * Documents are immutable values, so every operation returns a new document
 * rather than mutating one. That is not ceremony: the undo stack, the play-mode
 * snapshot and the sync layer all need a document that cannot change under
 * them, and the cheapest way to guarantee that is to never hand out a mutable
 * one.
 *
 * These build well-formed documents by construction. They are not a substitute
 * for validation — anything arriving from disk or the network still goes
 * through the schema boundary — but they mean the editor and the tests cannot
 * accidentally author something invalid.
 */

export function createScene(ids: IdFactory, name: string): SceneDocument {
  return { schemaVersion: SCHEMA_VERSION, id: ids.scene(), name, entities: {} };
}

/**
 * Assemble a document from entities in one pass.
 *
 * {@link addEntity} copies the entity map and rescans siblings on every call,
 * which is the right cost for an editor applying one user action but quadratic
 * for bulk work: importing a tilemap, pasting a subtree, generating a test
 * scene. Ten thousand entities added one at a time took over half a minute;
 * assembled here it is immediate.
 *
 * The caller is responsible for the ordering keys, which is the point — bulk
 * construction knows the whole sequence up front and can generate them without
 * re-deriving sibling lists.
 *
 * @throws when two entities share an id, which would silently drop one.
 */
export function sceneFrom(id: SceneId, name: string, entities: readonly Entity[]): SceneDocument {
  const byId: Record<EntityId, Entity> = {};
  for (const entity of entities) {
    if (Object.hasOwn(byId, entity.id)) {
      throw new Error(`duplicate entity id "${entity.id}"`);
    }
    byId[entity.id] = entity;
  }
  return { schemaVersion: SCHEMA_VERSION, id, name, entities: byId };
}

/** Children of an entity, in sibling order. */
export function childrenOf(document: SceneDocument, parent: EntityId | null): Entity[] {
  return Object.values(document.entities)
    .filter((entity) => entity.parent === parent)
    .sort(compareSiblings);
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

export interface AddEntityOptions {
  readonly name: string;
  readonly parent?: EntityId | null;
  /** Insert before this sibling; appended last when omitted. */
  readonly before?: EntityId | undefined;
}

export interface AddEntityResult {
  readonly document: SceneDocument;
  readonly id: EntityId;
}

function orderForInsertion(
  document: SceneDocument,
  parent: EntityId | null,
  before: EntityId | undefined,
): string {
  const siblings = childrenOf(document, parent);
  if (before === undefined) {
    const last = siblings[siblings.length - 1];
    return keyBetween(last?.order ?? null, null);
  }
  const index = siblings.findIndex((sibling) => sibling.id === before);
  if (index < 0) throw new Error(`cannot insert before "${before}": it is not a sibling`);
  return keyBetween(siblings[index - 1]?.order ?? null, siblings[index]?.order ?? null);
}

/**
 * Add one entity, returning a new document.
 *
 * Copies the entity map and scans siblings to place the new ordering key, so
 * each call is linear in document size. That is the correct trade for a single
 * user action; use {@link sceneFrom} for bulk construction.
 */
export function addEntity(
  document: SceneDocument,
  ids: IdFactory,
  options: AddEntityOptions,
): AddEntityResult {
  const parent = options.parent ?? null;
  if (parent !== null && !Object.hasOwn(document.entities, parent)) {
    throw new Error(`cannot parent to "${parent}": it is not in this document`);
  }

  const id = ids.entity();
  const entity: Entity = {
    id,
    name: options.name,
    parent,
    order: orderForInsertion(document, parent, options.before),
    components: {},
  };
  return {
    document: { ...document, entities: { ...document.entities, [id]: entity } },
    id,
  };
}

export interface AddComponentResult {
  readonly document: SceneDocument;
  readonly id: ComponentId;
}

export function addComponent(
  document: SceneDocument,
  ids: IdFactory,
  entityId: EntityId,
  type: string,
  data: Readonly<Record<string, JsonValue>> = {},
): AddComponentResult {
  const entity = document.entities[entityId];
  if (entity === undefined) throw new Error(`no entity "${entityId}" in this document`);

  const id = ids.component();
  const component: Component = { id, type, data };
  const updated: Entity = {
    ...entity,
    components: { ...entity.components, [id]: component },
  };
  return {
    document: { ...document, entities: { ...document.entities, [entityId]: updated } },
    id,
  };
}
