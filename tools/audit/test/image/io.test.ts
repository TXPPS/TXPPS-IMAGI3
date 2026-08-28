import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng, readPngFile, renderDiffImage, writePngFile } from '../../src/image/io.ts';
import { diffPixels } from '../../src/image/pixel-diff.ts';
import { RGBA_CHANNELS } from '../../src/image/types.ts';
import { noiseImage, solidImage, withWipedBlock } from '../helpers/images.ts';

function tempPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'imagi3-io-')), name);
}

describe('PNG round-trip', () => {
  it('preserves every byte through write and read', () => {
    const original = noiseImage(37, 23, 314);
    const path = tempPath('image.png');
    writePngFile(path, original);
    const restored = readPngFile(path);

    expect(restored.width).toBe(original.width);
    expect(restored.height).toBe(original.height);
    expect([...restored.data]).toEqual([...original.data]);
  });

  it('creates missing parent directories', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'imagi3-io-')), 'a/b/c/image.png');
    writePngFile(path, solidImage(2, 2, [1, 2, 3, 255]));
    expect(readPngFile(path).width).toBe(2);
  });

  it('decodes an in-memory buffer identically to a file', () => {
    const original = noiseImage(16, 16, 7);
    const path = tempPath('image.png');
    writePngFile(path, original);
    const fromFile = readPngFile(path);
    const fromBuffer = decodePng(new Uint8Array(readFileSync(path)), 'buffer');
    expect([...fromBuffer.data]).toEqual([...fromFile.data]);
  });
});

describe('renderDiffImage', () => {
  const baseline = noiseImage(64, 64, 11);
  const candidate = withWipedBlock(baseline, { x: 8, y: 8 }, 8);
  const mask = diffPixels(baseline, candidate).mask;

  it('produces an image of the same shape as the baseline', () => {
    const diff = renderDiffImage(baseline, mask);
    expect(diff.width).toBe(baseline.width);
    expect(diff.height).toBe(baseline.height);
    expect(diff.data.length).toBe(baseline.data.length);
  });

  it('paints changed pixels in the highlight colour', () => {
    const diff = renderDiffImage(baseline, mask);
    const changed = mask.indexOf(1);
    expect(changed).toBeGreaterThanOrEqual(0);
    const offset = changed * RGBA_CHANNELS;
    expect([diff.data[offset], diff.data[offset + 1], diff.data[offset + 2]]).toEqual([255, 0, 96]);
  });

  it('dims unchanged pixels toward white instead of copying them', () => {
    const diff = renderDiffImage(baseline, mask);
    const unchanged = mask.indexOf(0);
    const offset = unchanged * RGBA_CHANNELS;
    const source = baseline.data[offset] ?? 0;
    const rendered = diff.data[offset] ?? 0;
    expect(rendered).toBeGreaterThanOrEqual(source);
    expect(diff.data[offset + 3]).toBe(255);
  });

  it('leaves an all-zero mask with no highlighted pixels', () => {
    const diff = renderDiffImage(baseline, new Uint8Array(64 * 64));
    for (let i = 0; i < 64 * 64; i += 1) {
      expect(diff.data[i * RGBA_CHANNELS + 2]).not.toBe(96);
    }
  });

  it('rejects a mask that does not match the image', () => {
    expect(() => renderDiffImage(baseline, new Uint8Array(10))).toThrow(RangeError);
  });
});
