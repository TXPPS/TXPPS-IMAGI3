import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MeasurementError,
  mergeMeasurements,
  parseMeasurements,
  readAllMeasurements,
  writeMeasurements,
} from '../src/measurements.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'imagi3-measure-'));
}

describe('parseMeasurements', () => {
  it('accepts a well-formed array', () => {
    expect(parseMeasurements([{ id: 'a', value: 1, origin: 'x' }], 'w')).toEqual([
      { id: 'a', value: 1, origin: 'x' },
    ]);
  });

  it.each([
    ['a non-array', {}],
    ['a non-object entry', [1]],
    ['a missing id', [{ value: 1 }]],
    ['a non-numeric value', [{ id: 'a', value: '1' }]],
    ['a non-string origin', [{ id: 'a', value: 1, origin: 7 }]],
  ])('rejects %s', (_label, input) => {
    expect(() => parseMeasurements(input, 'w')).toThrow(MeasurementError);
  });
});

describe('mergeMeasurements', () => {
  it('lets later batches supersede earlier values for the same id', () => {
    const merged = mergeMeasurements([
      [{ id: 'a', value: 1 }],
      [
        { id: 'a', value: 2 },
        { id: 'b', value: 3 },
      ],
    ]);
    expect(merged).toEqual([
      { id: 'a', value: 2 },
      { id: 'b', value: 3 },
    ]);
  });
});

describe('measurement files', () => {
  it('round-trips through the collection directory', () => {
    const dir = tempDir();
    writeMeasurements('harness-a', [{ id: 'a', value: 1 }], dir);
    writeMeasurements('harness-b', [{ id: 'b', value: 2 }], dir);
    expect(readAllMeasurements(dir)).toEqual([
      { id: 'a', value: 1, origin: undefined },
      { id: 'b', value: 2, origin: undefined },
    ]);
  });

  it('returns nothing when the directory does not exist', () => {
    expect(readAllMeasurements(join(tempDir(), 'absent'))).toEqual([]);
  });

  it('surfaces a malformed measurement file instead of ignoring it', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'bad.measurements.json'), '{"nope":true}');
    expect(() => readAllMeasurements(dir)).toThrow(MeasurementError);
  });
});
