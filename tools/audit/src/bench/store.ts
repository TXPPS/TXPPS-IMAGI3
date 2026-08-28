import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeviceProfileId } from '../profiles.ts';
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BenchmarkError(`${where} must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const profile = record['profile'];
  const medianMs = record['medianMs'];
  const requestedRate = record['requestedRate'];

  if (typeof profile !== 'string' || !isDeviceProfileId(profile)) {
    throw new BenchmarkError(`${where}.profile must be a device profile id`);
  }
  if (typeof medianMs !== 'number' || !Number.isFinite(medianMs)) {
    throw new BenchmarkError(`${where}.medianMs must be a finite number`);
  }
  if (typeof requestedRate !== 'number' || !Number.isFinite(requestedRate)) {
    throw new BenchmarkError(`${where}.requestedRate must be a finite number`);
  }
  return { profile, medianMs, requestedRate };
}

export function writeProfileBenchmark(
  benchmark: ProfileBenchmark,
  directory: string = BENCHMARK_DIR,
): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${benchmark.profile}${FILE_SUFFIX}`);
  writeFileSync(path, `${JSON.stringify(benchmark, null, 2)}\n`);
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
