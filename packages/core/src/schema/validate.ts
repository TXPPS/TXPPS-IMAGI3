import { isId, type ComponentId, type EntityId } from '../ids.ts';
import { isSortableIndexKey } from '../fractional-index.ts';
import {
  COMPONENT_FIELDS,
  DOCUMENT_FIELDS,
  ENTITY_FIELDS,
  SCHEMA_VERSION,
  type Component,
  type Entity,
  type JsonValue,
  type SceneDocument,
} from './types.ts';

/**
 * The schema boundary.
 *
 * Everything entering the engine from disk, network or a user script passes
 * through here, and this is the only place allowed to assume a document is
 * well-formed afterwards. The fuzz suite requires that a malformed document
 * produces a typed error naming the fault, never a crash and never a
 * half-loaded scene, so every failure carries a path.
 *
 * Two rules are load-bearing beyond ordinary shape checking:
 *
 * - **NaN and the infinities are rejected here**, not further in. They have no
 *   JSON representation, and a document containing one cannot round-trip; the
 *   canonical serializer rejects them too, but by then a scene is already in
 *   memory. This is the boundary the brief names.
 * - **Unknown fields are rejected** at the document, entity and component
 *   level. A typo in a field name is otherwise indistinguishable from a field
 *   the writer meant to omit, and silently ignoring it loses user data. Only
 *   component `data` is open, because its contents belong to whichever system
 *   owns the component type.
 */

export class SchemaError extends Error {
  /** Where the fault is, so a rejected document names its own problem. */
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${message} at ${path}`);
    this.name = 'SchemaError';
    this.path = path;
  }
}

function fail(message: string, path: string): never {
  throw new SchemaError(message, path);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('expected an object', path);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string') fail(`expected ${key} to be a string`, path);
  return value;
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(`unknown field${unknown.length > 1 ? 's' : ''} ${unknown.sort().join(', ')}`, path);
  }
}

/** Validate a JSON value, rejecting anything that cannot survive a round trip. */
function validateJsonValue(value: unknown, path: string): JsonValue {
  if (value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail(`${String(value)} cannot be represented in JSON`, path);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => validateJsonValue(item, `${path}[${String(index)}]`));
  }
  if (typeof value !== 'object') fail(`${typeof value} cannot be represented in JSON`, path);

  const record = value as Record<string, unknown>;
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(record)) {
    result[key] = validateJsonValue(record[key], `${path}.${key}`);
  }
  return result;
}

function validateComponent(raw: unknown, id: ComponentId, path: string): Component {
  const record = asRecord(raw, path);
  rejectUnknownFields(record, COMPONENT_FIELDS, path);

  const declaredId = requireString(record, 'id', path);
  if (declaredId !== id) {
    fail(`component id "${declaredId}" does not match its key "${id}"`, path);
  }
  if (!isId(declaredId, 'component')) fail(`"${declaredId}" is not a component id`, path);

  const type = requireString(record, 'type', path);
  if (type.length === 0) fail('component type must not be empty', path);

  const data = validateJsonValue(record['data'], `${path}.data`);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    fail('component data must be an object', `${path}.data`);
  }

  return { id: declaredId, type, data };
}

function validateEntity(raw: unknown, id: EntityId, path: string): Entity {
  const record = asRecord(raw, path);
  rejectUnknownFields(record, ENTITY_FIELDS, path);

  const declaredId = requireString(record, 'id', path);
  if (declaredId !== id) {
    fail(`entity id "${declaredId}" does not match its key "${id}"`, path);
  }
  if (!isId(declaredId, 'entity')) fail(`"${declaredId}" is not an entity id`, path);

  const parent = record['parent'];
  if (parent !== null && typeof parent !== 'string') {
    fail('expected parent to be an entity id or null', path);
  }
  if (typeof parent === 'string' && !isId(parent, 'entity')) {
    fail(`parent "${parent}" is not an entity id`, path);
  }

  const order = requireString(record, 'order', path);
  // Sortable, not canonical. A key ending in the smallest digit orders fine and
  // is repaired at load; rejecting it here would refuse a document over a fault
  // that costs nothing to correct. See `graph.ts` and ADR-0014.
  if (!isSortableIndexKey(order)) fail(`"${order}" is not a valid ordering key`, `${path}.order`);

  const componentsRaw = asRecord(record['components'], `${path}.components`);
  const components: Record<ComponentId, Component> = {};
  for (const componentId of Object.keys(componentsRaw)) {
    components[componentId] = validateComponent(
      componentsRaw[componentId],
      componentId,
      `${path}.components.${componentId}`,
    );
  }

  return {
    id: declaredId,
    name: requireString(record, 'name', path),
    parent: parent ?? null,
    order,
    components,
  };
}

/**
 * Validate a parsed document.
 *
 * **Reference integrity is deliberately not checked here.** A parent pointing
 * at a deleted entity, a parent cycle, and an entity parented to itself are all
 * legitimate outcomes of a concurrent merge: two peers each making a valid edit
 * produce them, and neither peer did anything wrong. Rejecting the document
 * would turn a routine concurrent edit into data loss, so they are repaired
 * deterministically at load instead.
 *
 * This boundary therefore checks *shape*: types, unknown fields, ids agreeing
 * with their keys, values that can survive a round trip. What it guarantees is
 * that a document can be read, not that it describes a tree. Use
 * `loadSceneDocument` for that guarantee — validation alone does not give it.
 * See `graph.ts` and ADR-0014.
 *
 * @throws {SchemaError} naming the path of the first fault found.
 */
export function validateSceneDocument(raw: unknown): SceneDocument {
  const record = asRecord(raw, '$');
  rejectUnknownFields(record, DOCUMENT_FIELDS, '$');

  const schemaVersion = record['schemaVersion'];
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    fail('expected schemaVersion to be an integer', '$');
  }
  if (schemaVersion !== SCHEMA_VERSION) {
    fail(
      `schemaVersion ${String(schemaVersion)} is not ${String(SCHEMA_VERSION)}; ` +
        'migrate the document before validating it',
      '$',
    );
  }

  const id = requireString(record, 'id', '$');
  if (!isId(id, 'scene')) fail(`"${id}" is not a scene id`, '$.id');

  const entitiesRaw = asRecord(record['entities'], '$.entities');
  const entities: Record<EntityId, Entity> = {};
  for (const entityId of Object.keys(entitiesRaw)) {
    entities[entityId] = validateEntity(entitiesRaw[entityId], entityId, `$.entities.${entityId}`);
  }

  return { schemaVersion, id, name: requireString(record, 'name', '$'), entities };
}
