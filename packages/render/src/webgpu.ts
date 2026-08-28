/**
 * The WebGPU leg, wired but unmeasured.
 *
 * three.js ships a separate WebGPU renderer under `three/webgpu`, so this is a
 * real code path and not a stub: the import happens, the renderer is
 * constructed, and its asynchronous initialisation is awaited. What is missing
 * is a browser to run it in. This environment provides Chromium without a
 * WebGPU adapter, so nothing here has ever produced a pixel.
 *
 * That is the whole reason the module is separate and the import is dynamic.
 *
 * - **Separate**, so `view.ts` — the primary WebGL2 path — never imports the
 *   WebGPU build. Every device this engine targets runs WebGL2; most cannot run
 *   WebGPU at all, and making them download a renderer they will never
 *   construct is a cost paid by exactly the devices with the least headroom.
 * - **Dynamic**, so the bundler splits it into a chunk fetched only when a
 *   device actually has an adapter.
 *
 * The parity harness reports this leg as `unmeasured`, never `passed`, and it
 * is tracked as DV-001 in the DEVICE-VERIFIED register. Nothing in this file
 * may be read as evidence that WebGPU rendering works. It is evidence that the
 * path exists and compiles.
 */

export class WebGpuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGpuUnavailableError';
  }
}

/** The navigator surface WebGPU detection needs, without pulling in DOM types. */
export interface GpuHost {
  readonly gpu?: unknown;
}

/**
 * Whether this host exposes a WebGPU entry point.
 *
 * Presence of `navigator.gpu` is necessary and not sufficient — requesting an
 * adapter can still return null on a blocklisted driver — so this is a cheap
 * pre-check, and {@link createWebGpuRenderer} is what actually decides.
 */
export function hasWebGpu(host: GpuHost): boolean {
  return host.gpu !== undefined && host.gpu !== null;
}

export interface WebGpuRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

/**
 * Construct and initialise the three.js WebGPU renderer.
 *
 * @throws {WebGpuUnavailableError} when the host has no adapter, or when
 * initialisation fails. It throws rather than falling back on its own: the
 * caller already chose this backend through `selectBackend`, and a function
 * that quietly returned something else would make that choice unobservable.
 */
export async function createWebGpuRenderer(
  host: GpuHost,
  options: WebGpuRendererOptions,
): Promise<{ render(): void; dispose(): void }> {
  if (!hasWebGpu(host)) {
    throw new WebGpuUnavailableError('this host exposes no navigator.gpu');
  }
  const three = await import('three/webgpu');
  const renderer = new three.WebGPURenderer({ canvas: options.canvas, antialias: false });
  renderer.setPixelRatio(options.pixelRatio);
  renderer.setSize(options.width, options.height, false);
  try {
    await renderer.init();
  } catch (error) {
    throw new WebGpuUnavailableError(
      `WebGPU renderer failed to initialise: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    render: () => {
      throw new WebGpuUnavailableError(
        'the WebGPU draw path is not implemented; it is tracked as DV-001 and has ' +
          'never been executed against a real adapter',
      );
    },
    dispose: () => {
      renderer.dispose();
    },
  };
}
