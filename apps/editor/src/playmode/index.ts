import { createInputTape } from '@imagi3/runtime';
import { createSession } from '@imagi3/runtime';
import { createSceneView, observeResize, probeCapabilities, selectBackend } from '@imagi3/render';
import { createFrameMeter, type FrameSamples } from './frame-meter.ts';
import { FRAME_SAMPLES_KEY, PLAYING_ATTRIBUTE, STOP_PLAY_MODE_KEY } from './params.ts';
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
  canvas.style.display = 'block';
  // The shell's root is `min-height: 100%`, so it grows with its content. While
  // play mode owns it the root is pinned to the viewport instead: a container
  // whose size depends on the canvas, and a canvas whose size is observed from
  // the container, is a loop, and rotating the phone profile walked it until
  // the scene was off screen entirely.
  root.style.height = '100dvh';
  root.style.overflow = 'hidden';
  root.replaceChildren(canvas);

  const width = root.clientWidth || window.innerWidth;
  const height = root.clientHeight || window.innerHeight;
  const view = createSceneView({
    canvas,
    width,
    height,
    pixelRatio: Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO),
  });

  // Built once and measured, never assumed. Reporting the *requested* count let
  // a scene truncated to one entity certify 400 with a 39x budget margin.
  const scene = createReferenceScene(entityCount);
  const session = createSession({
    document: scene,
    // `performance.now` is used here and nowhere in core or runtime. The clock
    // is a runtime *input*, and this is the composition root that supplies it;
    // pushing it any deeper is what makes a simulation unreproducible.
    clock: { now: () => performance.now() },
    input: createInputTape([]),
    seed: REFERENCE_2D_ENTITY_COUNT,
  });

  // Rotation, and any layout change that resizes the canvas. Without this the
  // camera is framed once at startup and a rotated tablet draws the scene into
  // whatever fraction of the screen the old size occupied.
  const stopObserving = observeResize(view, root);

  const meter = createFrameMeter(Object.keys(scene.entities).length);
  let running = true;
  let frameHandle = 0;
  let lastFrameStart = performance.now();

  const frame = (): void => {
    if (!running) return;
    const started = performance.now();
    const advanced = session.advance();

    // Three boundaries. Simulation is timed across the steps it ran; the
    // scene-graph write across the one frame it is; and submission — where
    // three.js walks the graph and composes 400 world matrices, and where draw
    // calls are issued — separately again.
    //
    // `present` is inside the budget, not outside it. Excluding it looked
    // right and was not: `WebGLRenderer.render` is where `updateMatrixWorld`
    // runs, so the "scene-graph update" the budget names was on the excluded
    // side, and the renderer's load-bearing design choice — one shared geometry
    // and material rather than 400 — was invisible to the measurement.
    // Performance demonstrated both at the P1 gate. Rasterisation still is not
    // measured: on this host it happens off the main thread, and `present`
    // costs ~4ms of a ~100ms frame.
    const simulated = performance.now();
    view.update(session.previous(), session.current(), advanced.alpha);
    const updated = performance.now();
    view.present();
    const presented = performance.now();

    meter.record({
      frameMs: started - lastFrameStart,
      simMs: simulated - started,
      updateMs: updated - simulated,
      presentMs: presented - updated,
      steps: advanced.steps,
    });
    lastFrameStart = started;
    document.documentElement.setAttribute(PLAYING_ATTRIBUTE, 'true');
    frameHandle = requestAnimationFrame(frame);
  };
  frameHandle = requestAnimationFrame(frame);

  let stopped = false;
  const handle: PlayModeHandle = {
    stop: () => {
      if (stopped) return;
      stopped = true;
      running = false;
      cancelAnimationFrame(frameHandle);
      stopObserving();
      view.dispose();
    },
    // The mesh count comes from the renderer, so the artifact carries what was
    // drawn as well as what the document holds. Two independent counts that
    // must agree are harder to be wrong about than one.
    samples: () => meter.samples(view.meshCount),
  };

  /**
   * Release the WebGL context when the page goes away.
   *
   * Without this the context, its geometry and its material live until the
   * browser gets round to reclaiming them, which it does asynchronously and not
   * necessarily soon. Chromium caps live contexts per process, so a sequence of
   * pages that each open play mode and navigate away exhausts the cap and later
   * pages fail to acquire a context at all — which is how a suite of five
   * rendering tests passed one at a time and failed run together.
   *
   * `pagehide` rather than `unload`, which is not fired for a page entering the
   * back/forward cache and is deprecated for that reason.
   */
  window.addEventListener(
    'pagehide',
    () => {
      handle.stop();
    },
    { once: true },
  );

  Object.defineProperty(window, FRAME_SAMPLES_KEY, {
    configurable: true,
    value: () => handle.samples(),
  });
  // Exposed so the parity harness can freeze the scene and compare two captures
  // that differ only by rendering rather than by the passage of time.
  Object.defineProperty(window, STOP_PLAY_MODE_KEY, {
    configurable: true,
    value: () => {
      handle.stop();
    },
  });
  return handle;
}

export { createReferenceScene, REFERENCE_2D_ENTITY_COUNT } from './reference-scene.ts';
export { createFrameMeter, MAX_FRAME_SAMPLES, type FrameSamples } from './frame-meter.ts';
export * from './params.ts';
