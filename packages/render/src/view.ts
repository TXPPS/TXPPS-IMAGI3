import {
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import type { WorldSnapshot } from '@imagi3/runtime';
import { PRIMARY_BACKEND, type RenderBackend } from './backend.ts';
import { createInterpolationScratch, interpolateInto } from './interpolate.ts';

/**
 * The three.js view: entity snapshots in, pixels out.
 *
 * Deliberately small, and deliberately 2D-first. P1 needs a renderer that draws
 * the reference scene inside the frame budget on a throttled tablet, and the
 * feature that matters at this phase is that **one geometry and one material
 * are shared by every entity**. A mesh per entity with its own geometry is the
 * default shape of a naive three.js scene and it is also the thing that makes a
 * thousand sprites unaffordable on a phone: each unique geometry is a separate
 * buffer upload and each unique material a separate shader program.
 *
 * Everything here runs on WebGL2, which is the primary path. Nothing in the
 * draw loop is conditional on the backend.
 */

/**
 * Half-extent of the world the orthographic camera frames, on its short axis.
 *
 * The long axis is widened by the viewport's aspect ratio, so a square in world
 * space is a square on screen. Without that correction the frustum is square
 * while the viewport is not, and every sprite is stretched by exactly the
 * viewport's aspect: a 4x4 quad measured 21x46 pixels on the phone profile,
 * 2.2 times taller than wide, and a circle would have been an ellipse. Found by
 * Visual QA at the P1 gate, by measuring a single quad's bounding box rather
 * than by reading the code.
 *
 * Short-axis fit, so the same world extent is always visible whichever way the
 * device is held; the long axis shows more. The alternative — fitting the long
 * axis — hides world content on the short one, which is worse in a game.
 */
export const VIEW_EXTENT = 110;

/** Frustum bounds for a viewport, with the short axis pinned to VIEW_EXTENT. */
export function frustumFor(width: number, height: number): { x: number; y: number } {
  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    // A zero-sized canvas is a real state during layout. Falling back to square
    // keeps the camera valid rather than producing NaN bounds that silently
    // blank the scene.
    return { x: VIEW_EXTENT, y: VIEW_EXTENT };
  }
  const aspect = width / height;
  return aspect >= 1
    ? { x: VIEW_EXTENT * aspect, y: VIEW_EXTENT }
    : { x: VIEW_EXTENT, y: VIEW_EXTENT / aspect };
}
const QUAD_SIZE = 4;
const BACKGROUND = 0x0b0d10;
const ENTITY_COLOR = 0x6fd3c7;
const CAMERA_NEAR = 0;
const CAMERA_FAR = 10;

export interface ViewOptions {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  /**
   * Device pixel ratio, capped by the caller.
   *
   * Not read from `window` here. A phone reporting 3 means nine times the
   * fragments of a ratio of 1, which is the single easiest way to miss a frame
   * budget on the device that has the least headroom; the cap belongs to
   * whoever knows the budget, not to the view.
   */
  readonly pixelRatio: number;
}

export interface SceneView {
  /**
   * Position every mesh for this frame. CPU only — nothing is rasterised.
   *
   * Split from {@link present} so the two can be timed apart. They are not the
   * same kind of cost and, in CI, not the same kind of measurable: without a
   * GPU, `present` is software rasterisation whose cost says nothing about this
   * engine, while `update` is entirely work this repository is responsible for.
   */
  update(previous: WorldSnapshot, current: WorldSnapshot, alpha: number): void;
  /** Submit the frame. Where rasterisation happens. */
  present(): void;
  /** {@link update} then {@link present}, for callers that need no timing. */
  draw(previous: WorldSnapshot, current: WorldSnapshot, alpha: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
  readonly backend: RenderBackend;
  /** Meshes currently allocated, so a test can assert pooling actually pools. */
  readonly meshCount: number;
}

/**
 * Create a view on the primary WebGL2 path.
 *
 * @throws when a WebGL2 context cannot be created. Failing here is correct:
 * `selectBackend` has already established that WebGL2 is available, so a
 * failure at this point is a real fault rather than a device limitation, and
 * silently producing a blank canvas would hide it.
 */
export function createSceneView(options: ViewOptions): SceneView {
  const renderer = new WebGLRenderer({ canvas: options.canvas, antialias: false });
  renderer.setPixelRatio(options.pixelRatio);
  // `updateStyle` left on, deliberately. With it off the canvas has no CSS size
  // and its *attribute* size becomes its intrinsic layout size — so growing the
  // backing store grows the element, which grows the container being observed,
  // which resizes the backing store. On the phone profile a rotation walked
  // that loop until the container was 1827px tall inside a 390px viewport and
  // the scene had been pushed entirely off screen.
  renderer.setSize(options.width, options.height);
  renderer.setClearColor(new Color(BACKGROUND), 1);

  const scene = new Scene();
  const camera = new OrthographicCamera(0, 0, 0, 0, CAMERA_NEAR, CAMERA_FAR);
  camera.position.z = 1;

  const frameCamera = (width: number, height: number): void => {
    const bounds = frustumFor(width, height);
    camera.left = -bounds.x;
    camera.right = bounds.x;
    camera.top = bounds.y;
    camera.bottom = -bounds.y;
    camera.updateProjectionMatrix();
  };
  frameCamera(options.width, options.height);

  // One geometry, one material, shared by every entity. See the note above.
  const geometry = new PlaneGeometry(QUAD_SIZE, QUAD_SIZE);
  const material = new MeshBasicMaterial({ color: ENTITY_COLOR });
  const pool: Mesh[] = [];
  const scratch = createInterpolationScratch();

  /**
   * Meshes are pooled rather than rebuilt per frame.
   *
   * Allocating in the draw loop is what turns a steady frame time into a
   * sawtooth: the allocations are cheap individually and the garbage collection
   * they cause is not, and it lands on whichever frame is unlucky. A budget
   * measured as an average would never see it; a frame-spike budget sees
   * nothing else.
   */
  const meshFor = (index: number): Mesh => {
    const existing = pool[index];
    if (existing !== undefined) return existing;
    const mesh = new Mesh(geometry, material);
    pool.push(mesh);
    scene.add(mesh);
    return mesh;
  };

  const view: SceneView = {
    backend: PRIMARY_BACKEND,
    get meshCount() {
      return pool.length;
    },
    update: (previous, current, alpha) => {
      // Allocation-free: nothing is created per frame, so nothing is collected
      // per frame either. Note this did not measurably improve the frame
      // statistics — see the note in `interpolate.ts` before citing it as a
      // performance fix.
      let drawn = 0;
      interpolateInto(previous, current, alpha, scratch, (index, _id, x, y) => {
        const mesh = meshFor(index);
        mesh.position.set(x, y, 0);
        mesh.visible = true;
        drawn = index + 1;
      });
      // Surplus meshes are hidden, not removed. Removing and re-adding is a
      // scene-graph mutation per frame for something a boolean expresses.
      for (let index = drawn; index < pool.length; index += 1) {
        const mesh = pool[index];
        if (mesh !== undefined) mesh.visible = false;
      }
    },
    present: () => {
      renderer.render(scene, camera);
    },
    draw: (previous, current, alpha) => {
      view.update(previous, current, alpha);
      view.present();
    },
    resize: (width, height) => {
      renderer.setSize(width, height);
      // The camera must move with the canvas or the aspect correction is right
      // once and wrong after every rotation. This was dead code at the P1 gate:
      // nothing called `resize`, so rotating a tablet left the scene in the top
      // 45% of the screen. Wiring it is `observeResize` below.
      frameCamera(width, height);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
  return view;
}

/**
 * Keep a view sized to an element, and return the teardown.
 *
 * A `ResizeObserver` on the element rather than a `window.resize` listener,
 * because the canvas is sized from the element's own box: a flex or grid change
 * that resizes it without resizing the window is exactly as much a resize, and
 * the window event would miss it.
 *
 * This exists because `SceneView.resize` was dead code when P1 was first
 * submitted — defined, correct, and called by nothing, so rotating a tablet
 * left the scene drawn in the top 45% of the screen. A method with no caller is
 * not a feature.
 */
export function observeResize(view: SceneView, element: Element): () => void {
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const box = entry.contentRect;
      if (box.width > 0 && box.height > 0) view.resize(box.width, box.height);
    }
  });
  observer.observe(element);
  return () => {
    observer.disconnect();
  };
}
