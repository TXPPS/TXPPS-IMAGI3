/**
 * Frame rate, derived by the gate from raw frame durations.
 *
 * The same shape as the throttling probe and for the same reason: a page that
 * reports its own frame rate is a producer attesting its own work, and the
 * interesting failure — a scene that averages 62fps while dropping a frame
 * every second — is invisible in a mean and obvious in the samples.
 *
 * So the page records every frame duration and this module decides what they
 * mean. The decision is deliberately not the average.
 */

/** Samples discarded from the front of a run. */
export const WARMUP_FRAMES = 30;

/**
 * Fewest usable samples a measurement can be taken from.
 *
 * Half a second at 60Hz. Below that a percentile is not an estimate of
 * anything, and reporting one anyway is how a budget comes to be met by a run
 * that barely happened.
 */
export const MIN_FRAMES = 30;

/** The percentile the budget is stated against. */
export const FRAME_PERCENTILE = 0.95;
const MEDIAN = 0.5;

const MS_PER_SECOND = 1000;

export interface FrameSamples {
  readonly frameMs: readonly number[];
  /** Engine CPU work per frame, excluding rasterisation. See {@link cpuFrameMsFrom}. */
  readonly cpuMs: readonly number[];
  readonly entityCount: number;
  readonly steps: number;
}

export interface FrameVerdict {
  readonly fps: number;
  readonly detail: string;
}

export interface CpuFrameVerdict {
  /** 95th-percentile engine CPU milliseconds per frame. */
  readonly cpuMs: number;
  readonly detail: string;
}

/**
 * Frame budget for a 60Hz target, in milliseconds.
 *
 * Not a threshold in itself — the derivation below is what makes the budget
 * defensible rather than fitted to whatever the code currently does.
 */
export const TARGET_HZ = 60;
export const FRAME_BUDGET_60HZ_MS = MS_PER_SECOND / TARGET_HZ;

/**
 * The engine's share of a frame.
 *
 * **Derived, not chosen.** At 60Hz a frame is 16.67ms and the engine's own CPU
 * work is only one of the things that must fit in it: rasterisation,
 * compositing and browser overhead take the rest, and a real project adds
 * gameplay logic on top of everything measured here. Half the frame is the
 * point past which the engine has left no room for the game it exists to run,
 * so half is the line.
 *
 * The reference scene measures 5.4ms at the 95th percentile on the throttled
 * tablet profile, so this is a budget the engine currently meets with room,
 * rather than a line drawn around today's number.
 */
export const MAX_ENGINE_FRAME_SHARE = 0.5;

export class FrameSampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameSampleError';
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  const value = sorted[index];
  if (value === undefined) throw new FrameSampleError('cannot take a percentile of no samples');
  return value;
}

/**
 * The frame rate a set of samples evidences.
 *
 * **The 95th-percentile frame, not the mean.** A budget expressed as a minimum
 * frame rate is a promise about the experience, and the experience is decided
 * by the slow frames: 59 frames at 8ms and one at 200ms averages to a
 * comfortable 43fps while visibly hitching. Taking a high percentile of the
 * frame *duration* — the slowest frames — and converting that to a rate keeps
 * the budget pointed at what a player notices. It is the same reasoning that
 * made cold load the worst of three rather than the median.
 *
 * The first {@link WARMUP_FRAMES} are dropped. Shader compilation, the first
 * texture upload and JIT tiering all land there, and none of them is what a
 * sustained frame-rate budget is about; they belong to the cold-load budget,
 * which already measures them.
 *
 * @throws {FrameSampleError} when there is not enough signal to report. Refusing
 * to produce a number is correct here: the alternative is a measurement the
 * gate would treat as evidence.
 */
export function frameRateFrom(samples: FrameSamples): FrameVerdict {
  const usable = samples.frameMs.slice(WARMUP_FRAMES).filter((ms) => Number.isFinite(ms) && ms > 0);
  if (usable.length < MIN_FRAMES) {
    throw new FrameSampleError(
      `only ${String(usable.length)} usable frames after discarding ` +
        `${String(WARMUP_FRAMES)} warmup frames; at least ${String(MIN_FRAMES)} are needed ` +
        'before a percentile means anything',
    );
  }
  if (samples.steps <= 0) {
    throw new FrameSampleError(
      'the simulation ran no steps, so these frames drew a world that never moved',
    );
  }

  const sorted = [...usable].sort((a, b) => a - b);
  const slowMs = percentile(sorted, FRAME_PERCENTILE);
  const medianMs = percentile(sorted, MEDIAN);
  return {
    fps: MS_PER_SECOND / slowMs,
    detail:
      `${String(usable.length)} frames over ${String(samples.entityCount)} entities and ` +
      `${String(samples.steps)} simulation steps; p95 frame ${slowMs.toFixed(2)}ms, ` +
      `median ${medianMs.toFixed(2)}ms`,
  };
}

/**
 * The engine's own CPU cost per frame: simulation plus scene-graph update,
 * with rasterisation excluded.
 *
 * This is the measurable half of the frame budget in an environment with no
 * GPU. The whole-frame figure there is dominated by software rasterisation — an
 * empty scene costs 83ms at the 95th percentile on the throttled tablet profile
 * before this engine has done anything — so a frame-rate budget measured in CI
 * would be a measurement of SwiftShader. See GAP-011 and ADR-0015.
 *
 * **The median, not the 95th percentile** — the opposite choice from
 * {@link frameRateFrom} and from cold load, so the reason is worth stating.
 * Those gate on the tail because there the tail *is* the user's experience.
 * Here the tail is the instrument. Five runs of unchanged code measured a p95
 * of 6.8, 8.1, 8.7, 7.6 and 7.6ms while the median stayed between 2.5 and
 * 3.9ms: CDP throttling advances by periodically sleeping the renderer, and
 * whether a sleep lands inside a two-millisecond timed section is a coin flip.
 * A gate on a statistic whose run-to-run spread exceeds the regression it is
 * meant to catch fails for noise and passes for real regressions, at random.
 *
 * The p95 is still recorded in the detail, because the tail is worth watching
 * even when it cannot be gated on.
 *
 * @throws {FrameSampleError} when there is not enough signal to report.
 */
export function cpuFrameMsFrom(samples: FrameSamples): CpuFrameVerdict {
  const usable = samples.cpuMs.slice(WARMUP_FRAMES).filter((ms) => Number.isFinite(ms) && ms >= 0);
  if (usable.length < MIN_FRAMES) {
    throw new FrameSampleError(
      `only ${String(usable.length)} usable CPU samples after discarding ` +
        `${String(WARMUP_FRAMES)} warmup frames; at least ${String(MIN_FRAMES)} are needed`,
    );
  }
  if (samples.steps <= 0) {
    throw new FrameSampleError(
      'the simulation ran no steps, so this measures a scene-graph update over a frozen world',
    );
  }

  const sorted = [...usable].sort((a, b) => a - b);
  const medianMs = percentile(sorted, MEDIAN);
  return {
    cpuMs: medianMs,
    detail:
      `${String(usable.length)} frames over ${String(samples.entityCount)} entities and ` +
      `${String(samples.steps)} simulation steps; median engine CPU ${medianMs.toFixed(2)}ms, ` +
      `p95 ${percentile(sorted, FRAME_PERCENTILE).toFixed(2)}ms (rasterisation excluded)`,
  };
}
