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
/** Enough places to show a sub-millisecond per-step cost as more than zero. */
const SUB_MS_DECIMALS = 3;

const MS_PER_SECOND = 1000;

export interface FrameSamples {
  readonly frameMs: readonly number[];
  /** Simulation time per frame, over `stepsPerFrame[i]` fixed steps. */
  readonly simMs: readonly number[];
  /** Scene-graph write time per frame. Exactly one per frame. */
  readonly updateMs: readonly number[];
  /** `renderer.render` time: matrix composition and draw submission. */
  readonly presentMs: readonly number[];
  /** Fixed steps simulated in each frame. */
  readonly stepsPerFrame: readonly number[];
  readonly entityCount: number;
  /** Meshes the renderer allocated, cross-checked against `entityCount`. */
  readonly meshCount: number;
  readonly steps: number;
}

export interface FrameVerdict {
  readonly fps: number;
  readonly detail: string;
}

export interface CpuFrameVerdict {
  /** Modelled engine cost of one 60Hz frame: median step + median update, in ms. */
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
 * The reference scene models a 1.07ms frame on the throttled tablet profile —
 * 0.27ms per step plus 0.80ms per update — so the engine meets this with about
 * seven times the room, and the ceiling is a line drawn from the frame budget
 * rather than around today's number.
 *
 * **What that headroom means for what this budget catches**, stated so it is
 * not read as more: it is a *shippability* bound, not a regression detector. It
 * fails when the engine can no longer fit in a 60Hz frame at all. A 3x
 * regression stays well inside it. A tighter regression bound needs the noise
 * floor characterised on a quiet CI runner first, and is tracked as RC-0011.
 */
export const MAX_ENGINE_FRAME_SHARE = 0.5;

export class FrameSampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameSampleError';
  }
}

interface UsableFrame {
  readonly simMs: number;
  readonly updateMs: number;
  readonly presentMs: number;
  readonly steps: number;
}

function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/**
 * Frames after warmup whose three series are all present and sane.
 *
 * Dropping a frame wholesale rather than filtering each series separately: the
 * per-step cost pairs `simMs[i]` with `stepsPerFrame[i]`, and independently
 * filtered series would silently pair a duration from one frame with a step
 * count from another.
 */
function usableFrames(samples: FrameSamples): UsableFrame[] {
  const frames: UsableFrame[] = [];
  for (let i = WARMUP_FRAMES; i < samples.simMs.length; i += 1) {
    const simMs = samples.simMs[i];
    const updateMs = samples.updateMs[i];
    const presentMs = samples.presentMs[i];
    const steps = samples.stepsPerFrame[i];
    const parts = [simMs, updateMs, presentMs, steps];
    if (parts.some((part) => part === undefined || !Number.isFinite(part) || part < 0)) continue;
    frames.push({
      simMs: simMs ?? 0,
      updateMs: updateMs ?? 0,
      presentMs: presentMs ?? 0,
      steps: steps ?? 0,
    });
  }
  return frames;
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  const value = sorted[index];
  if (value === undefined) throw new FrameSampleError('cannot take a percentile of no samples');
  return value;
}

/**
 * Longest a frame can take without having missed a vsync at 60Hz.
 *
 * One and a half refresh intervals: a frame that overruns its slot lands on the
 * next one, so anything past 1.5 intervals demonstrably dropped a frame, and
 * anything under it did not — whatever ordinary scheduling jitter did.
 */
const MISSED_VSYNC_INTERVALS = 1.5;
export const DROPPED_FRAME_MS = FRAME_BUDGET_60HZ_MS * MISSED_VSYNC_INTERVALS;

export interface DroppedFrameVerdict {
  /** Fraction of frames that missed a vsync, in [0, 1]. */
  readonly ratio: number;
  readonly detail: string;
}

/**
 * The fraction of frames that missed a vsync.
 *
 * **This replaces a frame-rate budget that no engine could ever have passed.**
 * The rate was derived from the 95th-percentile interval between
 * `requestAnimationFrame` callbacks, and that interval is set by the
 * compositor's 60Hz frame source: Performance measured an empty page — no
 * WebGL, no engine, no scene — at a p95 of 16.90ms, which converts to 59.2fps.
 * A `min: 60` on that statistic is not a demanding budget, it is one the
 * instrument cannot express a pass for, and the manual procedure written to
 * close it on real hardware would have failed on a flawless device.
 *
 * Counting frames that missed a vsync says the same thing about the experience
 * and can be satisfied: the empty page drops none. The target is unchanged —
 * "60fps" means "does not drop frames at 60Hz", and this measures exactly that.
 * See ADR-0015 and RC-0012.
 */
export function droppedFrameRatioFrom(samples: FrameSamples): DroppedFrameVerdict {
  const usable = samples.frameMs.slice(WARMUP_FRAMES).filter((ms) => Number.isFinite(ms) && ms > 0);
  if (usable.length < MIN_FRAMES) {
    throw new FrameSampleError(
      `only ${String(usable.length)} usable frames after discarding ` +
        `${String(WARMUP_FRAMES)} warmup frames; at least ${String(MIN_FRAMES)} are needed`,
    );
  }
  if (samples.steps <= 0) {
    throw new FrameSampleError(
      'the simulation ran no steps, so these frames drew a world that never moved',
    );
  }

  const dropped = usable.filter((ms) => ms > DROPPED_FRAME_MS);
  const ordered = sorted(usable);
  return {
    ratio: dropped.length / usable.length,
    detail:
      `${String(dropped.length)} of ${String(usable.length)} frames exceeded ` +
      `${DROPPED_FRAME_MS.toFixed(2)}ms over ${String(samples.entityCount)} entities; ` +
      `p95 frame ${percentile(ordered, FRAME_PERCENTILE).toFixed(2)}ms, ` +
      `median ${percentile(ordered, MEDIAN).toFixed(2)}ms`,
  };
}

/**
 * The frame rate a set of samples evidences.
 *
 * **Retained for reporting, not for gating.** A `min` on this cannot be
 * satisfied — see {@link droppedFrameRatioFrom} — so nothing enforces it. It
 * stays because the number is still worth recording next to the ratio that does
 * gate, and because a run on real hardware will want it for comparison.
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

  const ordered = sorted(usable);
  const slowMs = percentile(ordered, FRAME_PERCENTILE);
  const medianMs = percentile(ordered, MEDIAN);
  return {
    fps: MS_PER_SECOND / slowMs,
    detail:
      `${String(usable.length)} frames over ${String(samples.entityCount)} entities and ` +
      `${String(samples.steps)} simulation steps; p95 frame ${slowMs.toFixed(2)}ms, ` +
      `median ${medianMs.toFixed(2)}ms`,
  };
}

/**
 * What one 60Hz frame of engine work costs: one fixed simulation step plus one
 * scene-graph update, with rasterisation excluded.
 *
 * This is the measurable half of the frame budget in an environment with no
 * GPU. The whole-frame figure there is dominated by software rasterisation — an
 * empty scene costs 83ms at the 95th percentile on the throttled tablet profile
 * before this engine has done anything — so a frame-rate budget measured in CI
 * would be a measurement of SwiftShader. See GAP-011 and ADR-0015.
 *
 * **Modelled from per-unit costs, not sampled per frame.** The first version of
 * this timed simulation and update together, once per frame, and called the
 * result the engine's cost. It was not. `advance()` runs `frameMs / stepMs`
 * steps, so the amount of simulation inside each sample was set by how long the
 * frame took — which the rasteriser decides. QA Automation proved it at the P1
 * gate: tripling the work inside every system did not move the number, five
 * times the work passed, fifteen times the scene-graph work passed, and halving
 * the device pixel ratio with the engine byte-for-byte identical moved it by
 * 44%. The excluded rasterisation was walking back in through the step count.
 *
 * Dividing each cost by the work that produced it removes that path entirely: a
 * step costs what a step costs however many of them a frame affords, and an
 * update happens exactly once per frame at any cadence. The sum is what a frame
 * would cost if the display ran at the simulation rate, which is the quantity
 * the budget is about.
 *
 * **The median of each, not the 95th percentile** — the opposite choice from
 * {@link frameRateFrom} and from cold load, so the reason is worth stating.
 * Those gate on the tail because there the tail *is* the user's experience.
 * Here the tail is the instrument: CDP throttling advances by periodically
 * sleeping the renderer, and whether a sleep lands inside a two-millisecond
 * timed section is close to a coin flip. Runs of unchanged code have put the
 * p95 between 6.8 and 14.6ms while the median stayed between 2.2 and 4.5. A
 * gate on a statistic whose run-to-run spread exceeds the regression it is
 * meant to catch fails for noise and passes for real regressions, at random.
 *
 * The tail is still recorded in the detail, because a tail worth watching is
 * not the same as a tail worth gating on.
 *
 * @throws {FrameSampleError} when there is not enough signal to report.
 */
export function cpuFrameMsFrom(samples: FrameSamples): CpuFrameVerdict {
  const frames = usableFrames(samples);
  if (frames.length < MIN_FRAMES) {
    throw new FrameSampleError(
      `only ${String(frames.length)} usable frames after discarding ` +
        `${String(WARMUP_FRAMES)} warmup frames; at least ${String(MIN_FRAMES)} are needed`,
    );
  }
  if (samples.steps <= 0) {
    throw new FrameSampleError(
      'the simulation ran no steps, so this measures a scene-graph update over a frozen world',
    );
  }

  const stepped = frames.filter((frame) => frame.steps > 0);
  if (stepped.length < MIN_FRAMES) {
    throw new FrameSampleError(
      `only ${String(stepped.length)} frames ran a simulation step, so a per-step cost ` +
        'cannot be estimated from them',
    );
  }

  const perStep = sorted(stepped.map((frame) => frame.simMs / frame.steps));
  const perUpdate = sorted(frames.map((frame) => frame.updateMs + frame.presentMs));
  const stepMs = percentile(perStep, MEDIAN);
  const updateMs = percentile(perUpdate, MEDIAN);

  return {
    cpuMs: stepMs + updateMs,
    detail:
      `${String(frames.length)} frames over ${String(samples.entityCount)} entities ` +
      `(${String(samples.meshCount)} meshes) and ${String(samples.steps)} simulation steps; ` +
      `median ${stepMs.toFixed(SUB_MS_DECIMALS)}ms per step + ${updateMs.toFixed(SUB_MS_DECIMALS)}ms per frame; ` +
      `p95 step ${percentile(perStep, FRAME_PERCENTILE).toFixed(SUB_MS_DECIMALS)}ms, ` +
      `p95 update ${percentile(perUpdate, FRAME_PERCENTILE).toFixed(SUB_MS_DECIMALS)}ms ` +
      '(rasterisation excluded)',
  };
}
