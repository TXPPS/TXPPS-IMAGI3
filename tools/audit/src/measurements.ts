import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ThrottleProbe } from './budgets/throttle.ts';
import type { Measurement } from './budgets/types.ts';
import {
  asRecord,
  optionalString,
  requireFiniteNumber,
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

const fail = (message: string): Error => new MeasurementError(message);

function requireDurations(
  record: Record<string, unknown>,
  key: string,
  where: string,
): readonly number[] {
  const value = record[key];
  if (!Array.isArray(value)) throw fail(`${where}.${key} must be an array of durations`);
  return value.map((entry, index) => {
    if (typeof entry !== 'number') throw fail(`${where}.${key}[${String(index)}] must be a number`);
    return entry;
  });
}

/**
 * Parse a probe without judging it.
 *
 * Shape only: whether the samples add up to usable evidence is the budget
 * gate's decision, not the parser's. A probe rejected here would abort the
 * whole run, where a probe rejected there fails exactly the budget that relied
 * on it and lets the rest of the report through.
 */
function parseThrottleProbe(raw: unknown, where: string): ThrottleProbe {
  const record = asRecord(raw, where, fail);
  return {
    benchmarkId: requireNonEmptyString(record, 'benchmarkId', where, fail),
    iterations: requireFiniteNumber(record, 'iterations', where, fail),
    checksum: requireFiniteNumber(record, 'checksum', where, fail),
    requestedRate: requireFiniteNumber(record, 'requestedRate', where, fail),
    controlMs: requireDurations(record, 'controlMs', where),
    throttledMs: requireDurations(record, 'throttledMs', where),
  };
}

function parseThrottle(
  record: Record<string, unknown>,
  where: string,
): readonly ThrottleProbe[] | undefined {
  const value = record['throttle'];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw fail(`${where}.throttle must be an array of probes`);
  return value.map((entry, index) =>
    parseThrottleProbe(entry, `${where}.throttle[${String(index)}]`),
  );
}

function parseMeasurement(raw: unknown, where: string): Measurement {
  const record = asRecord(raw, where, fail);
  return {
    id: requireNonEmptyString(record, 'id', where, fail),
    value: requireNumber(record, 'value', where, fail),
    origin: optionalString(record, 'origin', where, fail),
    recordedAt: optionalString(record, 'recordedAt', where, fail),
    throttle: parseThrottle(record, where),
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
