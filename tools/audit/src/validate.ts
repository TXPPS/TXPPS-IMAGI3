/**
 * Field validators shared by the JSON artifacts the harness reads back.
 *
 * Extracted on the second occurrence: measurement files and profile benchmark
 * files validate the same optional string and number fields, and a second copy
 * is a second place for the two to drift apart.
 *
 * Each takes the error constructor from its caller so the message names the
 * artifact rather than a generic validation error.
 */
export type ValidationErrorFactory = (message: string) => Error;

export function asRecord(
  value: unknown,
  where: string,
  fail: ValidationErrorFactory,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw fail(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  where: string,
  fail: ValidationErrorFactory,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw fail(`${where}.${key} must be a non-empty string`);
  }
  return value;
}

export function requireNumber(
  record: Record<string, unknown>,
  key: string,
  where: string,
  fail: ValidationErrorFactory,
): number {
  const value = record[key];
  if (typeof value !== 'number') throw fail(`${where}.${key} must be a number`);
  return value;
}

export function requireFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  where: string,
  fail: ValidationErrorFactory,
): number {
  const value = requireNumber(record, key, where, fail);
  if (!Number.isFinite(value)) throw fail(`${where}.${key} must be a finite number`);
  return value;
}

export function optionalString(
  record: Record<string, unknown>,
  key: string,
  where: string,
  fail: ValidationErrorFactory,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw fail(`${where}.${key} must be a string when present`);
  return value;
}

export function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  where: string,
  fail: ValidationErrorFactory,
): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number') throw fail(`${where}.${key} must be a number when present`);
  return value;
}
