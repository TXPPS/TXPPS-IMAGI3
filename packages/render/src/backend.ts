/**
 * Which rendering backend to use, and why.
 *
 * **WebGL2 is the primary path, not the fallback.** Every visual feature must
 * work there, and WebGPU is an optimisation on top. That ordering is a
 * requirement rather than a preference: WebGPU is unavailable on most of the
 * devices this engine targets — iOS Safari most importantly — and a codebase
 * that develops against WebGPU and tests WebGL2 last discovers its WebGL2 gaps
 * from users. Selection therefore defaults to WebGL2 and takes a deliberate
 * request to do anything else.
 *
 * Selection is a pure function over a capability record so it can be tested
 * without a GPU. Probing, which needs a real document, is separate.
 */

export const RENDER_BACKENDS = ['webgl2', 'webgpu'] as const;

export type RenderBackend = (typeof RENDER_BACKENDS)[number];

/** The path every feature must work on. */
export const PRIMARY_BACKEND: RenderBackend = 'webgl2';

export interface BackendCapabilities {
  readonly webgl2: boolean;
  readonly webgpu: boolean;
}

export class NoBackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoBackendError';
  }
}

export interface BackendSelection {
  readonly backend: RenderBackend;
  /** Whether the requested backend was unavailable. Surfaced, never silent. */
  readonly fellBack: boolean;
  readonly detail: string;
}

/**
 * Choose a backend.
 *
 * @throws {NoBackendError} when WebGL2 is unavailable and WebGPU cannot stand
 * in. There is deliberately no canvas-2D path: a second renderer that draws
 * different pixels is not a fallback, it is a second product to maintain and a
 * second set of visual baselines nobody looks at.
 */
export function selectBackend(
  capabilities: BackendCapabilities,
  preferred: RenderBackend = PRIMARY_BACKEND,
): BackendSelection {
  if (preferred === 'webgpu' && capabilities.webgpu) {
    return { backend: 'webgpu', fellBack: false, detail: 'WebGPU requested and available' };
  }
  if (capabilities.webgl2) {
    return {
      backend: 'webgl2',
      fellBack: preferred !== 'webgl2',
      detail:
        preferred === 'webgl2'
          ? 'WebGL2, the primary path'
          : 'WebGPU requested but unavailable; using the primary WebGL2 path',
    };
  }
  if (capabilities.webgpu) {
    return {
      backend: 'webgpu',
      fellBack: true,
      // Worth surfacing loudly rather than treating as a win: WebGL2 failing
      // means something is wrong with the device or the driver, and a run on
      // WebGPU alone has never exercised the path everything else is tested on.
      detail: 'WebGL2 unavailable, which is unexpected; falling forward to WebGPU',
    };
  }
  throw new NoBackendError(
    'no supported rendering backend: this device has neither WebGL2 nor WebGPU',
  );
}

/** The minimal surface a probe needs, so this module needs no DOM library types. */
export interface CanvasProbe {
  createElement(tag: 'canvas'): { getContext(id: string): unknown };
}

/**
 * Detect what this device actually supports.
 *
 * Probing WebGL2 by creating a context, not by reading `'WebGL2RenderingContext'
 * in window`. The constructor exists on devices where context creation then
 * fails — a blocklisted driver, a machine already out of GPU processes, a
 * headless browser without a software rasteriser — and treating the
 * constructor's presence as support is how a renderer ends up throwing during
 * its first frame rather than falling back cleanly.
 */
export function probeCapabilities(probe: CanvasProbe, hasWebGpu = false): BackendCapabilities {
  let webgl2 = false;
  try {
    webgl2 = probe.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    webgl2 = false;
  }
  return { webgl2, webgpu: hasWebGpu };
}
