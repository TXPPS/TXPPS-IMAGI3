import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BenchmarkError,
  parseProfileBenchmark,
  readProfileBenchmarks,
  writeProfileBenchmark,
} from '../../src/bench/store.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'imagi3-bench-'));
}

const VALID = { profile: 'tablet', medianMs: 430, requestedRate: 4 };

describe('parseProfileBenchmark', () => {
  it('accepts a well-formed benchmark', () => {
    expect(parseProfileBenchmark(VALID, 'w')).toEqual({
      profile: 'tablet',
      medianMs: 430,
      requestedRate: 4,
      recordedAt: undefined,
      origin: undefined,
    });
  });

  it('carries provenance through when present', () => {
    const parsed = parseProfileBenchmark(
      { ...VALID, recordedAt: '2026-01-01T00:00:00.000Z', origin: 'spec.ts' },
      'w',
    );
    expect(parsed.recordedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.origin).toBe('spec.ts');
  });

  it.each([
    ['a non-object', 42],
    ['an array', []],
    ['an unknown profile', { ...VALID, profile: 'watch' }],
    ['a missing profile', { medianMs: 1, requestedRate: 1 }],
    ['a non-numeric medianMs', { ...VALID, medianMs: '430' }],
    ['a non-finite medianMs', { ...VALID, medianMs: Number.POSITIVE_INFINITY }],
    ['a non-numeric requestedRate', { ...VALID, requestedRate: 'four' }],
    ['a non-string recordedAt', { ...VALID, recordedAt: 7 }],
    ['a non-string origin', { ...VALID, origin: 7 }],
  ])('rejects %s', (_label, input) => {
    expect(() => parseProfileBenchmark(input, 'w')).toThrow(BenchmarkError);
  });
});

describe('benchmark files', () => {
  it('round-trips through the directory', () => {
    const dir = tempDir();
    writeProfileBenchmark({ profile: 'desktop', medianMs: 100, requestedRate: 1 }, dir);
    writeProfileBenchmark({ profile: 'tablet', medianMs: 430, requestedRate: 4 }, dir);
    const read = readProfileBenchmarks(dir);

    expect(read.map((b) => b.profile)).toEqual(['desktop', 'tablet']);
    expect(read.map((b) => b.medianMs)).toEqual([100, 430]);
  });

  it('stamps a recording time, so a stale file is visible', () => {
    const dir = tempDir();
    writeProfileBenchmark({ profile: 'phone', medianMs: 650, requestedRate: 6 }, dir);
    const [benchmark] = readProfileBenchmarks(dir);

    expect(benchmark?.recordedAt).toBeDefined();
    expect(Number.isNaN(Date.parse(benchmark?.recordedAt ?? ''))).toBe(false);
  });

  it('preserves a recording time the caller supplied', () => {
    const dir = tempDir();
    writeProfileBenchmark(
      { profile: 'phone', medianMs: 650, requestedRate: 6, recordedAt: '2020-01-01T00:00:00.000Z' },
      dir,
    );
    expect(readProfileBenchmarks(dir)[0]?.recordedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('returns nothing when the directory does not exist', () => {
    expect(readProfileBenchmarks(join(tempDir(), 'absent'))).toEqual([]);
  });

  it('surfaces a malformed file instead of ignoring it', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'tablet.benchmark.json'), '{"profile":"tablet"}');
    expect(() => readProfileBenchmarks(dir)).toThrow(BenchmarkError);
  });

  it('ignores files that are not benchmarks', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
    expect(readProfileBenchmarks(dir)).toEqual([]);
  });
});
