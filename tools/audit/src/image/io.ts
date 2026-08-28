import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import {
  ALPHA_OFFSET,
  RGBA_CHANNELS,
  RGB_CHANNEL_COUNT,
  assertValidImage,
  type RgbaImage,
} from './types.ts';

/** Decode an 8-bit RGBA PNG held in memory, such as a screenshot buffer. */
export function decodePng(buffer: Uint8Array, label = 'png buffer'): RgbaImage {
  const png = PNG.sync.read(Buffer.from(buffer));
  const image: RgbaImage = {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
  };
  assertValidImage(image, label);
  return image;
}

/** Read an 8-bit RGBA PNG from disk. */
export function readPngFile(path: string): RgbaImage {
  return decodePng(readFileSync(path), path);
}

/** Write an RGBA raster to disk as a PNG, creating parent directories. */
export function writePngFile(path: string, image: RgbaImage): void {
  assertValidImage(image, path);
  const png = new PNG({ width: image.width, height: image.height });
  png.data.set(image.data);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}

/** High-contrast colour painted over pixels that changed. */
const DIFF_HIGHLIGHT = { r: 255, g: 0, b: 96 } as const;
const UNCHANGED_DIM = 0.15;
const OPAQUE = 255;

/**
 * Render a review image: unchanged pixels dimmed toward white, differing pixels
 * painted in a high-contrast highlight so a human can see what moved.
 */
export function renderDiffImage(baseline: RgbaImage, mask: Uint8Array): RgbaImage {
  assertValidImage(baseline, 'baseline');
  const pixels = baseline.width * baseline.height;
  if (mask.length !== pixels) {
    throw new RangeError(
      `mask length ${String(mask.length)} does not match ${String(pixels)} pixels`,
    );
  }

  const out = new Uint8Array(pixels * RGBA_CHANNELS);
  for (let i = 0; i < pixels; i += 1) {
    writeDiffPixel(out, baseline.data, i, mask[i] === 1);
  }
  return { width: baseline.width, height: baseline.height, data: out };
}

function writeDiffPixel(
  out: Uint8Array,
  source: Uint8Array,
  index: number,
  differs: boolean,
): void {
  const offset = index * RGBA_CHANNELS;
  if (differs) {
    out[offset] = DIFF_HIGHLIGHT.r;
    out[offset + 1] = DIFF_HIGHLIGHT.g;
    out[offset + 2] = DIFF_HIGHLIGHT.b;
    out[offset + ALPHA_OFFSET] = OPAQUE;
    return;
  }
  for (let channel = 0; channel < RGB_CHANNEL_COUNT; channel += 1) {
    const value = source[offset + channel] ?? 0;
    out[offset + channel] = Math.round(OPAQUE - (OPAQUE - value) * UNCHANGED_DIM);
  }
  out[offset + ALPHA_OFFSET] = OPAQUE;
}
