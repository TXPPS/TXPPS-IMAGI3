import { describe, expect, it } from 'vitest';
import {
  NoBackendError,
  PRIMARY_BACKEND,
  probeCapabilities,
  selectBackend,
  type CanvasProbe,
} from '../src/backend.ts';

/**
 * WebGL2 is the primary path, and these tests are what stops that from becoming
 * a comment. The engine targets devices — iOS Safari above all — where WebGPU
 * does not exist, so a selection that quietly preferred WebGPU would mean the
 * path most users take is the one least exercised.
 */

const BOTH = { webgl2: true, webgpu: true };
const ONLY_GL = { webgl2: true, webgpu: false };
const ONLY_GPU = { webgl2: false, webgpu: true };
const NEITHER = { webgl2: false, webgpu: false };

describe('selectBackend', () => {
  it('defaults to WebGL2 even when WebGPU is available', () => {
    expect(selectBackend(BOTH).backend).toBe('webgl2');
  });

  it('names WebGL2 as the primary backend', () => {
    expect(PRIMARY_BACKEND).toBe('webgl2');
  });

  it('uses WebGPU only when it is asked for', () => {
    expect(selectBackend(BOTH, 'webgpu').backend).toBe('webgpu');
  });

  it('falls back to WebGL2 when WebGPU was asked for and is absent', () => {
    const selection = selectBackend(ONLY_GL, 'webgpu');
    expect(selection.backend).toBe('webgl2');
    expect(selection.fellBack).toBe(true);
  });

  it('does not report a fallback when the primary path was the intent', () => {
    expect(selectBackend(ONLY_GL).fellBack).toBe(false);
  });

  it('surfaces a missing WebGL2 as a fallback, not as a win', () => {
    // WebGL2 unavailable means something is wrong with the device or driver,
    // and the resulting run has never exercised the path everything else is
    // tested on. It must not read as a normal outcome.
    const selection = selectBackend(ONLY_GPU);
    expect(selection.backend).toBe('webgpu');
    expect(selection.fellBack).toBe(true);
    expect(selection.detail).toContain('unexpected');
  });

  it('throws when neither backend exists rather than inventing a canvas-2D path', () => {
    expect(() => selectBackend(NEITHER)).toThrow(NoBackendError);
  });

  it('always explains itself', () => {
    for (const capabilities of [BOTH, ONLY_GL, ONLY_GPU]) {
      for (const preferred of ['webgl2', 'webgpu'] as const) {
        expect(selectBackend(capabilities, preferred).detail.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('probeCapabilities', () => {
  function probeReturning(context: unknown): CanvasProbe {
    return { createElement: () => ({ getContext: () => context }) };
  }

  it('reports WebGL2 when a context can be created', () => {
    expect(probeCapabilities(probeReturning({})).webgl2).toBe(true);
  });

  it('reports no WebGL2 when context creation returns null', () => {
    // The case a `'WebGL2RenderingContext' in window` check gets wrong: the
    // constructor exists, the context does not.
    expect(probeCapabilities(probeReturning(null)).webgl2).toBe(false);
  });

  it('reports no WebGL2 when context creation throws', () => {
    const probe: CanvasProbe = {
      createElement: () => ({
        getContext: () => {
          throw new Error('too many active WebGL contexts');
        },
      }),
    };
    expect(probeCapabilities(probe).webgl2).toBe(false);
  });

  it('takes WebGPU availability from the caller rather than guessing', () => {
    expect(probeCapabilities(probeReturning({}), true).webgpu).toBe(true);
    expect(probeCapabilities(probeReturning({})).webgpu).toBe(false);
  });
});
