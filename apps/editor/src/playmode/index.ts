import { createInputTape } from '@imagi3/runtime';
import { createSession } from '@imagi3/runtime';
import { createSceneView, probeCapabilities, selectBackend } from '@imagi3/render';
import { createFrameMeter, type FrameSamples } from './frame-meter.ts';
import { FRAME_SAMPLES_KEY, PLAYING_ATTRIBUTE } from './params.ts';
import { createReferenceScene, REFERENCE_2D_ENTITY_COUNT } from './reference-scene.ts';

/**
 * Play mode.
 *
 * **This constructs the same runtime session an exported build constructs.**
 * There is no editor-only simulation path; the only things that differ between
 * this and an export are which clock, which input source and which document get
 * passed in. Any divergence between the two is a P0 bug by the brief, and the
 * cheapest way to not have one is to have only one construction site.
 *
 * The page exposes its frame samples on `window` for the E2E harness to read.
 * That is a measurement seam, not a debugging affordance: the samples are raw,
 * and the budget gate derives the frame rate from them rather than trusting a
 * number this page computed about itself.
 */

/** Device pixel ratio is capped: a phone reporting 3 is nine times the fragments. */
export const MAX_PIXEL_RATIO = 2;

export interface PlayModeHandle {
  stop(): void;
  samples(): FrameSamples;
}

/**
 * Start play mode against the reference scene.
 *
 * @throws when no rendering backend is available, which is a device fact worth
 * surfacing rather than a blank canvas worth explaining later.
 */
export function startPlayMode(
  root: HTMLElement,
  entityCount = REFERENCE_2D_ENTITY_COUNT,
): PlayModeHandle {
  const selection = selectBackend(probeCapabilities(document));
  const canvas = document.createElement('canvas');
  canvas.dataset['backend'] = selection.backend;
  root.replaceChildren(canvas);

  const width = root.clientWidth || window.innerWidth;
  const height = root.clientHeight || window.innerHeight;
  const view = createSceneView({
    canvas,
    width,
    height,
    pixelRatio: Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO),
  });

  const session = createSession({
    document: createReferenceScene(entityCount),
    // `performance.now` is used here and nowhere in core or runtime. The clock
    // is a runtime *input*, and this is the composition root that supplies it;
    // pushing it any deeper is what makes a simulation unreproducible.
    clock: { now: () => performance.now() },
    input: createInputTape([]),
    seed: REFERENCE_2D_ENTITY_COUNT,
  });

  const meter = createFrameMeter(entityCount);
  let running = true;
  let frameHandle = 0;
  let lastFrameStart = performance.now();

  const frame = (): void => {
    if (!running) return;
    const started = performance.now();
    const advanced = session.advance();
    view.update(session.previous(), session.current(), advanced.alpha);
    // The boundary between work this engine does and work the rasteriser does.
    // In CI the second is software and dominates; only the first is a signal
    // about this repository. See docs/GAPS.md GAP-011.
    const cpuMs = performance.now() - started;
    view.present();
    meter.record(started - lastFrameStart, cpuMs, advanced.steps);
    lastFrameStart = started;
    document.documentElement.setAttribute(PLAYING_ATTRIBUTE, 'true');
    frameHandle = requestAnimationFrame(frame);
  };
  frameHandle = requestAnimationFrame(frame);

  const handle: PlayModeHandle = {
    stop: () => {
      running = false;
      cancelAnimationFrame(frameHandle);
      view.dispose();
    },
    samples: () => meter.samples(),
  };

  Object.defineProperty(window, FRAME_SAMPLES_KEY, {
    configurable: true,
    value: () => handle.samples(),
  });
  return handle;
}

export { createReferenceScene, REFERENCE_2D_ENTITY_COUNT } from './reference-scene.ts';
export { createFrameMeter, MAX_FRAME_SAMPLES, type FrameSamples } from './frame-meter.ts';
export * from './params.ts';
