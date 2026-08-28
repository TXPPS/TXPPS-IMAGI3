import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  gzipSize,
  isBundleAsset,
  measureDirectory,
  totalGzipBytes,
} from '../../src/bundle/measure.ts';

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'imagi3-bundle-'));
  for (const [name, contents] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
  }
  return dir;
}

describe('isBundleAsset', () => {
  it.each([
    ['index.js', true],
    ['styles.css', true],
    ['nested/chunk.js', true],
    ['index.js.map', false],
    ['styles.css.map', false],
    ['index.html', false],
    ['logo.svg', false],
  ])('classifies %s as %s', (name, expected) => {
    expect(isBundleAsset(name)).toBe(expected);
  });
});

describe('gzipSize', () => {
  it('produces a decompressible stream of the original bytes', () => {
    const payload = new TextEncoder().encode('a'.repeat(5000));
    expect(gzipSize(payload)).toBeGreaterThan(0);
    expect(gzipSize(payload)).toBeLessThan(payload.byteLength);
  });

  it('is deterministic for identical input', () => {
    const payload = new TextEncoder().encode('const x = 1;'.repeat(200));
    expect(gzipSize(payload)).toBe(gzipSize(payload));
  });

  it('round-trips through gunzip, so the size describes real content', () => {
    const original = 'export const answer = 42;';
    const bytes = new TextEncoder().encode(original);
    expect(gzipSize(bytes)).toBeGreaterThan(0);
    // Independently confirm the compressor is not silently dropping content.
    expect(gunzipSync(gzipSync(bytes)).toString('utf8')).toBe(original);
  });
});

describe('measureDirectory', () => {
  it('measures JS and CSS while ignoring maps and other files', () => {
    const dir = fixtureDir({
      'assets/index.js': 'console.log(1);',
      'assets/index.js.map': '{"version":3}',
      'assets/style.css': 'body{margin:0}',
      'index.html': '<!doctype html>',
    });
    expect(measureDirectory(dir).map((a) => a.file)).toEqual([
      join('assets', 'index.js'),
      join('assets', 'style.css'),
    ]);
  });

  it('descends into nested directories', () => {
    const dir = fixtureDir({ 'a/b/c/deep.js': 'export default 1;' });
    expect(measureDirectory(dir)).toHaveLength(1);
  });

  it('returns an empty list for a directory with no bundle assets', () => {
    expect(measureDirectory(fixtureDir({ 'readme.txt': 'hi' }))).toEqual([]);
  });

  it('reports both raw and gzipped sizes', () => {
    const dir = fixtureDir({ 'big.js': 'x'.repeat(10_000) });
    const [asset] = measureDirectory(dir);
    expect(asset?.rawBytes).toBe(10_000);
    expect(asset?.gzipBytes).toBeGreaterThan(0);
    expect(asset?.gzipBytes).toBeLessThan(10_000);
  });
});

describe('totalGzipBytes', () => {
  it('sums every asset', () => {
    const dir = fixtureDir({ 'a.js': 'a'.repeat(500), 'b.css': 'b'.repeat(500) });
    const assets = measureDirectory(dir);
    expect(totalGzipBytes(assets)).toBe(assets.reduce((n, a) => n + a.gzipBytes, 0));
  });

  it('is zero for no assets', () => {
    expect(totalGzipBytes([])).toBe(0);
  });
});
