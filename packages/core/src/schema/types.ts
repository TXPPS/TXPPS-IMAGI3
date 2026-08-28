import type { ComponentId, EntityId, SceneId } from '../ids.ts';

/**
 * Scene schema v1.
 *
 * The shape is fixed by ADR-0012 and is a one-way door: documents authored
 * against it must keep opening, and P4 brings Yjs to a document already full of
 * user data. Every structural choice here exists to merge cleanly, and the
 * reasoning is in the ADR rather than repeated at each field.
 *
 * Four rules govern any change to this file:
 *
 * 1. Identity is an opaque generated id, never a position.
 * 2. Hierarchy is a parent pointer plus an ordering key. No `children` arrays.
 * 3. Collections of things with identity are maps keyed by id, not arrays.
 * 4. No derived or cached data. Ever. Not world transforms, not bounding
 *    boxes, not child lists, not dirty flags. Derived data is a second source
 *    of truth, and a merge that updates one and not the other produces a
 *    document no peer can detect is wrong.
 */

/** The only schema version that exists. Bumping it requires a migration. */
export const SCHEMA_VERSION = 1;

/**
 * A value that can appear inside component data.
 *
 * Deliberately just JSON. Component data is opaque to the engine core: it is
 * validated for representability, not for meaning, because meaning belongs to
 * whichever system owns the component type.
 */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Component {
  readonly id: ComponentId;
  /**
   * Immutable after creation. Changing a component's type is deleting one
   * component and adding another; allowing it in place would make a concurrent
   * type change and a concurrent field edit unmergeable.
   */
  readonly type: string;
  readonly data: Readonly<Record<string, JsonValue>>;
}

export interface Entity {
  readonly id: EntityId;
  readonly name: string;
  /** Parent entity, or null for a root. Never a children array; see ADR-0012. */
  readonly parent: EntityId | null;
  /**
   * Fractional ordering key among siblings.
   *
   * Siblings sort by `(order, id)`, not by `order` alone: two peers can
   * concurrently generate the same key, and the id breaks the tie so every peer
   * arrives at the same sequence.
   */
  readonly order: string;
  /**
   * Keyed by component id rather than by type, so two peers concurrently
   * adding the same kind of component produce two components — a resolvable
   * condition — instead of one silently overwriting the other.
   */
  readonly components: Readonly<Record<ComponentId, Component>>;
}

export interface SceneDocument {
  readonly schemaVersion: number;
  readonly id: SceneId;
  readonly name: string;
  readonly entities: Readonly<Record<EntityId, Entity>>;
}

/** Fields a document may carry. Anything else is a typo or a version skew. */
export const DOCUMENT_FIELDS = ['schemaVersion', 'id', 'name', 'entities'] as const;
export const ENTITY_FIELDS = ['id', 'name', 'parent', 'order', 'components'] as const;
export const COMPONENT_FIELDS = ['id', 'type', 'data'] as const;
