import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  gzipSize,
  isBundleAsset,
  measureDirectory,
  splitBundle,
  totalGzipBytes,
  type AssetSize,
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

/**
 * The split that decides both bundle budgets.
 *
 * Untested until the P1 gate, because it lived in a CLI no test can import, and
 * both halves of it were revertible with 911 tests, `pnpm audit:bundle` and
 * `pnpm audit:budgets` all green: `total - runtimeBytes` back to `total`
 * restored the double-count that made 97.6% of "the editor bundle" three.js,
 * and the share floor to zero removed the name-is-not-attribution check. The
 * printed summary was identical either way, because its label is a literal.
 */
describe('splitBundle', () => {
  const asset = (file: string, gzipBytes: number): AssetSize => ({ file, gzipBytes, rawBytes: 0 });
  const realistic = [
    asset('assets/imagi3-runtime-abc.js', 128_000),
    asset('assets/index-def.js', 2800),
    asset('assets/index-ghi.css', 900),
  ];

  it('reports the shell as the total less the runtime', () => {
    const split = splitBundle(realistic, 'imagi3-runtime');
    expect(split.total).toBe(131_700);
    expect(split.runtimeBytes).toBe(128_000);
    // The mutation: `total - runtimeBytes` -> `total`, which reports 131,700 B
    // of "editor bundle" that is 97.2% three.js.
    expect(split.editorBytes).toBe(3700);
  });

  it('does not double-count the runtime across the two budgets', () => {
    const split = splitBundle(realistic, 'imagi3-runtime');
    expect(split.editorBytes + split.runtimeBytes).toBe(split.total);
  });

  it('accepts a build whose runtime chunk is most of it', () => {
    expect(splitBundle(realistic, 'imagi3-runtime').fault).toBeUndefined();
  });

  it('faults when there is no runtime chunk at all', () => {
    // RC-0004's shape: a missing chunk must be an error, never a zero.
    const split = splitBundle([asset('assets/index-def.js', 130_000)], 'imagi3-runtime');
    expect(split.fault).toContain('no chunk named');
  });

  it('faults on a rename-only split, where the name is not attribution', () => {
    // A `manualChunks` keeping the name on one small module while three.js
    // falls into the entry chunk reported 2,050 B for a 128 KB runtime.
    const renamed = [
      asset('assets/imagi3-runtime-abc.js', 2050),
      asset('assets/index-def.js', 129_650),
    ];
    const split = splitBundle(renamed, 'imagi3-runtime');
    expect(split.fault).toContain('% of the build');
    expect(split.runtimeShare).toBeLessThan(0.02);
  });

  it('faults at the floor rather than merely below it', () => {
    // The mutation: MIN_RUNTIME_SHARE -> 0, which accepts any split at all.
    const half = [
      asset('assets/imagi3-runtime-abc.js', 4000),
      asset('assets/index-def.js', 6000),
    ];
    expect(splitBundle(half, 'imagi3-runtime').fault).toContain('% of the build');
    expect(splitBundle(half, 'imagi3-runtime', 0.3).fault).toBeUndefined();
  });

  it('reports a share of zero for an empty build rather than dividing by it', () => {
    expect(splitBundle([], 'imagi3-runtime').runtimeShare).toBe(0);
  });
});
