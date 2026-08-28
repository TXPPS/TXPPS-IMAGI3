import { ALPHA_OFFSET, RGBA_CHANNELS, type RgbaImage } from './types.ts';

/** Rec. 709 luma coefficients, used for the grayscale projection SSIM runs on. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

const RGB_MAX = 255;

/**
 * Composite an RGBA pixel over white, then project to Rec. 709 luma.
 *
 * Compositing matters because screenshots of a transparent canvas differ from
 * screenshots of the same content on an opaque page; flattening both against a
 * fixed background makes the comparison well-defined.
 */
export function lumaAt(image: RgbaImage, index: number): number {
  const offset = index * RGBA_CHANNELS;
  const { data } = image;
  const alpha = (data[offset + ALPHA_OFFSET] ?? RGB_MAX) / RGB_MAX;
  const r = blendOverWhite(data[offset] ?? 0, alpha);
  const g = blendOverWhite(data[offset + 1] ?? 0, alpha);
  const b = blendOverWhite(data[offset + 2] ?? 0, alpha);
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

function blendOverWhite(channel: number, alpha: number): number {
  return channel * alpha + RGB_MAX * (1 - alpha);
}

/** Grayscale plane of an image, one Rec. 709 luma sample per pixel. */
export function toLumaPlane(image: RgbaImage): Float64Array {
  const plane = new Float64Array(image.width * image.height);
  for (let i = 0; i < plane.length; i += 1) plane[i] = lumaAt(image, i);
  return plane;
}

/**
 * RGB to YIQ conversion matrix. Kept as a named structure rather than inline
 * literals so the coefficients are identifiable and reviewable as a unit.
 */
export const RGB_TO_YIQ = {
  y: { r: 0.29889531, g: 0.58662247, b: 0.11448223 },
  i: { r: 0.59597799, g: -0.2741761, b: -0.32180189 },
  q: { r: 0.21147017, g: -0.52261711, b: 0.31114694 },
} as const;

export { RGB_MAX };
