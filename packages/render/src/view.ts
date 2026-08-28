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

/** Half-extent of the world the orthographic camera frames. */
export const VIEW_EXTENT = 110;
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
  renderer.setSize(options.width, options.height, false);
  renderer.setClearColor(new Color(BACKGROUND), 1);

  const scene = new Scene();
  const camera = new OrthographicCamera(
    -VIEW_EXTENT,
    VIEW_EXTENT,
    VIEW_EXTENT,
    -VIEW_EXTENT,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
  camera.position.z = 1;

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
      renderer.setSize(width, height, false);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
  return view;
}
