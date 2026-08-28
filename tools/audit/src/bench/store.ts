import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeviceProfileId } from '../profiles.ts';
import {
  asRecord,
  optionalString,
  requireFiniteNumber,
  requireNonEmptyString,
} from '../validate.ts';
import type { ProfileBenchmark } from './ordering.ts';

/**
 * Where profile benchmarks land. Deliberately separate from the budget
 * measurement directory: these are diagnostics that verify the harness itself,
 * not budgets, and the budget gate rejects measurement ids it has no rule for.
 */
export const BENCHMARK_DIR = '.audit-out/profile-benchmarks';

const FILE_SUFFIX = '.benchmark.json';

export class BenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchmarkError';
  }
}

export function parseProfileBenchmark(raw: unknown, where: string): ProfileBenchmark {
  const fail = (message: string): Error => new BenchmarkError(message);
  const record = asRecord(raw, where, fail);
  const profile = requireNonEmptyString(record, 'profile', where, fail);
  if (!isDeviceProfileId(profile)) {
    throw new BenchmarkError(`${where}.profile must be a device profile id`);
  }
  return {
    profile,
    medianMs: requireFiniteNumber(record, 'medianMs', where, fail),
    requestedRate: requireFiniteNumber(record, 'requestedRate', where, fail),
    recordedAt: optionalString(record, 'recordedAt', where, fail),
    origin: optionalString(record, 'origin', where, fail),
  };
}

export function writeProfileBenchmark(
  benchmark: ProfileBenchmark,
  directory: string = BENCHMARK_DIR,
): string {
  mkdirSync(directory, { recursive: true });
  const stamped: ProfileBenchmark = {
    ...benchmark,
    recordedAt: benchmark.recordedAt ?? new Date().toISOString(),
  };
  const path = join(directory, `${benchmark.profile}${FILE_SUFFIX}`);
  writeFileSync(path, `${JSON.stringify(stamped, null, 2)}\n`);
  return path;
}

export function readProfileBenchmarks(directory: string = BENCHMARK_DIR): ProfileBenchmark[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(FILE_SUFFIX))
    .sort()
    .map((name) => {
      const path = join(directory, name);
      return parseProfileBenchmark(JSON.parse(readFileSync(path, 'utf8')), path);
    });
}
