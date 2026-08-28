/**
 * Frame timing, collected in the page and read by the E2E harness.
 *
 * Every raw frame duration is kept, not a running average. That is the same
 * choice the throttling probe made, for the same reason: a harness that reports
 * a conclusion is a harness whose conclusion cannot be checked, and the
 * interesting failure here — a scene that averages 62fps while dropping a frame
 * every second — is invisible in a mean and obvious in the samples.
 *
 * The measurement the budget uses is derived by the gate from these samples,
 * never computed here.
 */

export interface FrameSamples {
  /** Every frame duration in milliseconds, in order. */
  readonly frameMs: readonly number[];
  /**
   * Engine CPU work per frame: simulation plus scene-graph update, excluding
   * the rasterisation inside `renderer.render`.
   *
   * Recorded separately because the two answer different questions and only one
   * of them is measurable here. CI has no GPU, so `frameMs` is dominated by
   * software rasterisation — an empty scene costs 70ms on the throttled tablet
   * profile before the engine does anything at all. `cpuMs` is the part this
   * repository is responsible for and can hold to a budget.
   */
  readonly cpuMs: readonly number[];
  /** Entities the scene drew, so a budget cannot be met by drawing less. */
  readonly entityCount: number;
  /** Simulation steps run, so a stalled simulation is visible in the artifact. */
  readonly steps: number;
}

export interface FrameMeter {
  record(frameMs: number, cpuMs: number, steps: number): void;
  samples(): FrameSamples;
}

/** Frames kept. Enough for several seconds at any plausible rate. */
export const MAX_FRAME_SAMPLES = 2000;

export function createFrameMeter(entityCount: number): FrameMeter {
  const frameMs: number[] = [];
  const cpuMs: number[] = [];
  let steps = 0;

  return {
    record: (duration, cpuDuration, stepsThisFrame) => {
      steps += stepsThisFrame;
      // Bounded, because an unbounded array in a long-running page is a leak
      // that the heap-growth budget would eventually catch and blame on the
      // renderer. Dropping the oldest keeps the most recent window, which is
      // the one a measurement is taken over. Both series are trimmed together
      // so index `i` of each always describes the same frame.
      if (frameMs.length >= MAX_FRAME_SAMPLES) {
        frameMs.shift();
        cpuMs.shift();
      }
      frameMs.push(duration);
      cpuMs.push(cpuDuration);
    },
    samples: () => ({ frameMs: [...frameMs], cpuMs: [...cpuMs], entityCount, steps }),
  };
}
