import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Measurement } from './budgets/types.ts';
import {
  asRecord,
  optionalNumber,
  optionalString,
  requireNonEmptyString,
  requireNumber,
} from './validate.ts';

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
  const fail = (message: string): Error => new MeasurementError(message);
  const record = asRecord(raw, where, fail);
  return {
    id: requireNonEmptyString(record, 'id', where, fail),
    value: requireNumber(record, 'value', where, fail),
    origin: optionalString(record, 'origin', where, fail),
    recordedAt: optionalString(record, 'recordedAt', where, fail),
    throttleRatio: optionalNumber(record, 'throttleRatio', where, fail),
  };
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
