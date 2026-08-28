import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Measurement } from './budgets/types.ts';

/** Directory where measuring harnesses drop their results for the budget gate. */
export const MEASUREMENT_DIR = '.audit-out/measurements';

const FILE_SUFFIX = '.measurements.json';

export class MeasurementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeasurementError';
  }
}

function parseMeasurement(raw: unknown, where: string): Measurement {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MeasurementError(`${where} must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const id = record['id'];
  const value = record['value'];
  const origin = record['origin'];
  const recordedAt = record['recordedAt'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new MeasurementError(`${where}.id must be a non-empty string`);
  }
  if (typeof value !== 'number') {
    throw new MeasurementError(`${where}.value must be a number`);
  }
  if (origin !== undefined && typeof origin !== 'string') {
    throw new MeasurementError(`${where}.origin must be a string when present`);
  }
  if (recordedAt !== undefined && typeof recordedAt !== 'string') {
    throw new MeasurementError(`${where}.recordedAt must be a string when present`);
  }
  return { id, value, origin, recordedAt };
}

/** Parse a measurement array that a harness produced. */
export function parseMeasurements(raw: unknown, where: string): Measurement[] {
  if (!Array.isArray(raw)) throw new MeasurementError(`${where} must be an array`);
  return raw.map((entry, index) => parseMeasurement(entry, `${where}[${String(index)}]`));
}

/**
 * Later measurements for the same id win, so a targeted re-run can supersede an
 * earlier value without the caller having to prune files.
 */
export function mergeMeasurements(batches: readonly (readonly Measurement[])[]): Measurement[] {
  const byId = new Map<string, Measurement>();
  for (const batch of batches) {
    for (const measurement of batch) byId.set(measurement.id, measurement);
  }
  return [...byId.values()];
}

/**
 * Append a harness's measurements to the shared collection directory, stamping
 * each with the time it was written so a report can show which run produced it.
 */
export function writeMeasurements(
  harnessName: string,
  measurements: readonly Measurement[],
  directory: string = MEASUREMENT_DIR,
): string {
  mkdirSync(directory, { recursive: true });
  const recordedAt = new Date().toISOString();
  const stamped = measurements.map((m) => ({ ...m, recordedAt: m.recordedAt ?? recordedAt }));
  const path = join(directory, `${harnessName}${FILE_SUFFIX}`);
  writeFileSync(path, `${JSON.stringify(stamped, null, 2)}\n`);
  return path;
}

/** Read and merge every measurement file that harnesses have produced. */
export function readAllMeasurements(directory: string = MEASUREMENT_DIR): Measurement[] {
  if (!existsSync(directory)) return [];
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(FILE_SUFFIX))
    .sort();
  const batches = files.map((name) => {
    const path = join(directory, name);
    return parseMeasurements(JSON.parse(readFileSync(path, 'utf8')), path);
  });
  return mergeMeasurements(batches);
}
