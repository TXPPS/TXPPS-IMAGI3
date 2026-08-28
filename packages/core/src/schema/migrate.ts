import { SCHEMA_VERSION } from './types.ts';

/**
 * The migration path, built before it is needed.
 *
 * A migration path added when the first breaking change arrives is one written
 * under pressure against documents that already exist in the wild. This one
 * ships with v1, and the identity migration below is not a placeholder — it
 * runs on every load of a current document, so the machinery is exercised
 * continuously rather than the first time it matters.
 *
 * A migration takes an untyped document at version N and returns an untyped
 * document at version N+1. Untyped on both sides deliberately: a migration
 * operates on a shape that no longer matches the current types, and typing it
 * against them would mean rewriting old migrations whenever the schema moves,
 * which is exactly how migration chains rot.
 */
export type Migration = (document: Record<string, unknown>) => Record<string, unknown>;

export class MigrationError extends Error {
  readonly fromVersion: number;

  constructor(message: string, fromVersion: number) {
    super(message);
    this.name = 'MigrationError';
    this.fromVersion = fromVersion;
  }
}

/**
 * Applied to a document that is already current.
 *
 * Returns a shallow copy rather than the same object, so a caller cannot
 * accidentally depend on migration being an aliasing no-op and then be
 * surprised when a real migration copies.
 */
export const IDENTITY_MIGRATION: Migration = (document) => ({ ...document });

/**
 * Migrations by source version. `MIGRATIONS.get(n)` upgrades version n to n+1.
 *
 * Empty at v1, and it stays empty until the schema actually breaks. An entry
 * here is a promise that every document ever written at that version can still
 * be opened.
 */
export const MIGRATIONS: ReadonlyMap<number, Migration> = new Map<number, Migration>();

function readVersion(document: Record<string, unknown>): number {
  const version = document['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new MigrationError(
      `document has no usable schemaVersion (got ${JSON.stringify(version)})`,
      Number.NaN,
    );
  }
  return version;
}

/**
 * Bring a document up to the current schema version.
 *
 * @throws {MigrationError} when the document is from the future, or when a step
 * in the chain is missing — both of which are better than opening a document
 * the engine does not understand and writing it back subtly changed.
 */
export function migrateToCurrent(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MigrationError('expected a document object', Number.NaN);
  }

  let document = raw as Record<string, unknown>;
  let version = readVersion(document);

  if (version > SCHEMA_VERSION) {
    throw new MigrationError(
      `document is version ${String(version)}, newer than this engine understands ` +
        `(${String(SCHEMA_VERSION)}); opening it would risk writing it back damaged`,
      version,
    );
  }

  while (version < SCHEMA_VERSION) {
    const migration = MIGRATIONS.get(version);
    if (migration === undefined) {
      throw new MigrationError(
        `no migration from version ${String(version)}; the upgrade path is incomplete`,
        version,
      );
    }
    document = migration(document);
    const next = readVersion(document);
    if (next <= version) {
      throw new MigrationError(
        `migration from version ${String(version)} did not advance the version`,
        version,
      );
    }
    version = next;
  }

  return IDENTITY_MIGRATION(document);
}
