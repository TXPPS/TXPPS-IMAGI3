/** Number of bytes per pixel in the RGBA images the audit system compares. */
export const RGBA_CHANNELS = 4;

/** Colour channels per pixel, excluding alpha. */
export const RGB_CHANNEL_COUNT = 3;

/** Byte offset of the alpha channel within a pixel. */
export const ALPHA_OFFSET = 3;

/** An 8-bit RGBA raster in row-major order. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Length must equal width * height * {@link RGBA_CHANNELS}. */
  readonly data: Uint8Array;
}

export class ImageShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageShapeError';
  }
}

export function assertValidImage(image: RgbaImage, label: string): void {
  const expected = image.width * image.height * RGBA_CHANNELS;
  if (image.width <= 0 || image.height <= 0) {
    throw new ImageShapeError(`${label} has non-positive dimensions`);
  }
  if (image.data.length !== expected) {
    throw new ImageShapeError(
      `${label} data length ${String(image.data.length)} does not match ` +
        `${String(image.width)}x${String(image.height)} RGBA (${String(expected)})`,
    );
  }
}

export function assertSameShape(a: RgbaImage, b: RgbaImage): void {
  assertValidImage(a, 'baseline');
  assertValidImage(b, 'candidate');
  if (a.width !== b.width || a.height !== b.height) {
    throw new ImageShapeError(
      `size mismatch: baseline ${String(a.width)}x${String(a.height)} vs ` +
        `candidate ${String(b.width)}x${String(b.height)}`,
    );
  }
}
