/**
 * Frame timing, collected in the page and read by the E2E harness.
 *
 * Every raw sample is kept, not a running average. That is the same choice the
 * throttling probe made, for the same reason: a harness that reports a
 * conclusion is a harness whose conclusion cannot be checked, and the
 * interesting failure here — a scene that averages 62fps while dropping a frame
 * every second — is invisible in a mean and obvious in the samples.
 *
 * **Simulation and scene-graph update are timed separately, and the step count
 * travels with them.** That is not tidiness; it is the fix for a budget that
 * did not measure what it claimed. The first version timed
 * `advance() + update()` as one per-frame number, and `advance()` runs
 * `frameMs / stepMs` steps — so the amount of simulation inside every
 * measurement was set by how long the frame took, which in CI is set by the
 * software rasteriser. QA Automation demonstrated it: tripling the work in
 * every system did not move the number, while changing the device pixel ratio,
 * with the engine byte-for-byte identical, moved it 44%. The rasterisation this
 * budget claimed to exclude was walking back in through the step count.
 *
 * Kept apart, the two costs divide by the work that produced them, and neither
 * depends on frame cadence.
 */

export interface FrameSamples {
  /** Whole-frame wall time in milliseconds, in order. */
  readonly frameMs: readonly number[];
  /** Time in the simulation this frame, across `stepsPerFrame[i]` steps. */
  readonly simMs: readonly number[];
  /** Time writing entity positions into the scene graph. One per frame. */
  readonly updateMs: readonly number[];
  /**
   * Time in `renderer.render`: world-matrix composition and draw submission.
   *
   * Inside the budget, because this is where three.js walks the scene graph —
   * excluding it left the renderer's own design choices unmeasured.
   * Rasterisation is not here: on a host without a GPU it happens on other
   * threads, and this costs ~4ms of a ~100ms frame.
   */
  readonly presentMs: readonly number[];
  /** Fixed steps simulated in frame `i`. Zero is normal and not an error. */
  readonly stepsPerFrame: readonly number[];
  /**
   * Entities the scene actually holds, read from the document rather than from
   * what the caller asked for.
   *
   * The distinction is not pedantic. When this reported the requested count, a
   * scene truncated to a single entity still recorded "400 entities" while the
   * budget read a 39x margin, and every test passed — a producer attesting its
   * own work. Found by QA Automation at the P1 gate.
   */
  readonly entityCount: number;
  /** Meshes the renderer allocated, so the drawn count can be cross-checked. */
  readonly meshCount: number;
  /** Total simulation steps, so a stalled simulation is visible in the artifact. */
  readonly steps: number;
}

export interface FrameMeter {
  record(sample: FrameSample): void;
  samples(meshCount: number): FrameSamples;
}

export interface FrameSample {
  readonly frameMs: number;
  readonly simMs: number;
  readonly updateMs: number;
  readonly presentMs: number;
  readonly steps: number;
}

/** Frames kept. Enough for several seconds at any plausible rate. */
export const MAX_FRAME_SAMPLES = 2000;

export function createFrameMeter(entityCount: number): FrameMeter {
  const frameMs: number[] = [];
  const simMs: number[] = [];
  const updateMs: number[] = [];
  const presentMs: number[] = [];
  const stepsPerFrame: number[] = [];
  let steps = 0;

  return {
    record: (sample) => {
      steps += sample.steps;
      // Bounded, because an unbounded array in a long-running page is a leak
      // the heap-growth budget would eventually catch and blame on the
      // renderer. Every series is trimmed together so index `i` of each always
      // describes the same frame.
      if (frameMs.length >= MAX_FRAME_SAMPLES) {
        frameMs.shift();
        simMs.shift();
        updateMs.shift();
        presentMs.shift();
        stepsPerFrame.shift();
      }
      frameMs.push(sample.frameMs);
      simMs.push(sample.simMs);
      updateMs.push(sample.updateMs);
      presentMs.push(sample.presentMs);
      stepsPerFrame.push(sample.steps);
    },
    samples: (meshCount) => ({
      frameMs: [...frameMs],
      simMs: [...simMs],
      updateMs: [...updateMs],
      presentMs: [...presentMs],
      stepsPerFrame: [...stepsPerFrame],
      entityCount,
      meshCount,
      steps,
    }),
  };
}
