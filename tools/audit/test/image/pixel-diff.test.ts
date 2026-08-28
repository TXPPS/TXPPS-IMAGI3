import { describe, expect, it } from 'vitest';
import { diffPixels } from '../../src/image/pixel-diff.ts';
import { ImageShapeError } from '../../src/image/types.ts';
import { noiseImage, solidImage, withDifferingPixels } from '../helpers/images.ts';

const BLACK = [0, 0, 0, 255] as const;
const WHITE = [255, 255, 255, 255] as const;

describe('diffPixels', () => {
  it('reports zero difference for identical images', () => {
    const image = noiseImage(16, 16, 7);
    const result = diffPixels(image, image);
    expect(result.differingPixels).toBe(0);
    expect(result.ratio).toBe(0);
  });

  it('reports every pixel differing for black versus white', () => {
    const result = diffPixels(solidImage(8, 8, BLACK), solidImage(8, 8, WHITE));
    expect(result.differingPixels).toBe(64);
    expect(result.ratio).toBe(1);
  });

  it('counts exactly the perturbed pixels', () => {
    const baseline = noiseImage(10, 10, 3);
    const result = diffPixels(baseline, withDifferingPixels(baseline, 5));
    expect(result.differingPixels).toBe(5);
    expect(result.ratio).toBeCloseTo(0.05, 10);
  });

  it('marks the mask at the differing indices only', () => {
    const baseline = solidImage(4, 4, BLACK);
    const result = diffPixels(baseline, withDifferingPixels(baseline, 2));
    expect([...result.mask]).toEqual([1, 1, ...Array<number>(14).fill(0)]);
  });

  it('ignores sub-threshold noise but catches it at a tighter threshold', () => {
    const baseline = solidImage(4, 4, [100, 100, 100, 255]);
    const nudged = solidImage(4, 4, [104, 104, 104, 255]);
    expect(diffPixels(baseline, nudged, 0.1).differingPixels).toBe(0);
    expect(diffPixels(baseline, nudged, 0.001).differingPixels).toBe(16);
  });

  it('composites alpha so transparency is not read as colour', () => {
    const transparent = solidImage(4, 4, [0, 0, 0, 0]);
    const white = solidImage(4, 4, WHITE);
    expect(diffPixels(transparent, white).differingPixels).toBe(0);
  });

  it('rejects mismatched sizes rather than comparing garbage', () => {
    expect(() => diffPixels(solidImage(4, 4, BLACK), solidImage(5, 4, BLACK))).toThrow(
      ImageShapeError,
    );
  });

  it('rejects an out-of-range threshold', () => {
    expect(() => diffPixels(solidImage(2, 2, BLACK), solidImage(2, 2, BLACK), 2)).toThrow(
      RangeError,
    );
  });
});
