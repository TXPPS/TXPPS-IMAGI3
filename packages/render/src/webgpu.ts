/**
 * The WebGPU leg. **Unimplemented, uncalled, and absent from the bundle.**
 *
 * This header previously claimed the leg was "wired". It was not, and the
 * correction matters more than the code below, so it is stated first. Visual QA
 * checked the claim at the P1 gate and found three things false:
 *
 * - **No caller.** `createWebGpuRenderer` and {@link hasWebGpu} are imported by
 *   nothing — not by the app, not by a test.
 * - **Not in the bundle.** The dynamic import is tree-shaken out entirely;
 *   `WebGPURenderer` appears in no emitted chunk. There is no lazily-fetched
 *   chunk because there is no reachable code.
 * - **No draw path.** {@link createWebGpuRenderer} returns an object whose
 *   `render` throws unconditionally. Given a GPU tomorrow, the parity procedure
 *   in GAP-002 still could not capture a WebGPU frame.
 *
 * What is true: `three/webgpu` resolves, and the construction and
 * initialisation below typecheck. That is the whole of it — the path compiles.
 * **Nothing here may be read as evidence that WebGPU rendering works, or that
 * the only thing missing is hardware.** Two things are missing, and the code is
 * the one this repository controls.
 *
 * The module stays separate and its import stays dynamic so that `view.ts` —
 * the primary WebGL2 path — never pulls in the WebGPU build. Every device this
 * engine targets runs WebGL2; most cannot run WebGPU at all, and making them
 * download a renderer they will never construct is a cost paid by exactly the
 * devices with the least headroom.
 *
 * The parity harness reports this leg as `unmeasured`, never `passed`, and it
 * is tracked as DV-001.
 *
 * **A trap for whoever wires this**, found by the same review: this container's
 * Chromium exposes `navigator.gpu` while `requestAdapter()` returns null. So
 * {@link hasWebGpu} returns true here, and the moment it is passed to
 * `probeCapabilities`, `selectBackend(caps, 'webgpu')` would select WebGPU,
 * initialisation would fail on the null adapter, and the error would propagate
 * with no fallback — by design, since the caller chose the backend. Wire the
 * probe and the fallback in the same change, not in separate ones.
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
