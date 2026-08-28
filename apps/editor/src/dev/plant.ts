/**
 * Deliberate fault injection, development builds only.
 *
 * The P0 gate requires proving that the audit harness actually catches
 * failures rather than merely reporting green. These faults give the harness
 * something real to catch. The module is loaded behind `import.meta.env.DEV`
 * so it is statically eliminated from production bundles; `test/no-dev-faults`
 * asserts that elimination on the built output.
 */
export const FAULT_KINDS = [
  'console-error',
  'throw',
  'unhandled-rejection',
  'slow-boot',
  'cpu-regression',
] as const;

export type FaultKind = (typeof FAULT_KINDS)[number];

/** Text emitted by the console-error fault; the self-test greps for it. */
export const PLANTED_CONSOLE_TEXT = 'IMAGI3 planted fault: console-error';
export const PLANTED_THROW_TEXT = 'IMAGI3 planted fault: throw';
export const PLANTED_REJECTION_TEXT = 'IMAGI3 planted fault: unhandled-rejection';

/** Delay used by the slow-boot fault, chosen to blow past every cold-load budget. */
export const SLOW_BOOT_DELAY_MS = 9000;

/**
 * Default work for the cpu-regression fault, in LCG iterations.
 *
 * A fallback only. The caller normally passes an iteration count computed from
 * the host's measured speed, because a fixed count is not host-portable: sized
 * for one machine it leaves roughly 1.3x headroom under the 3s unthrottled
 * ceiling, so a runner a third slower flips the leg that is supposed to pass.
 */
export const CPU_REGRESSION_ITERATIONS = 1_600_000_000;

/** Query parameter carrying a host-computed iteration count. */
export const FAULT_ITERATIONS_PARAM = 'iterations';

/**
 * Numerical Recipes LCG constants, used here purely as a cheap chain of
 * dependent integer operations. Duplicated from the audit harness rather than
 * imported: this module is browser code that must stay self-contained so Vite
 * can eliminate it from production builds.
 */
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;

/**
 * Perform a fixed amount of arithmetic. Models a genuine computational
 * regression: the work is constant, so the wall time it costs scales with how
 * slow the CPU is. This is the fault a throttled profile can catch and an
 * unthrottled one cannot, and it is why this does fixed work rather than
 * watching the clock.
 */
function burnCpu(iterations: number): void {
  let accumulator = 0;
  for (let i = 0; i < iterations; i += 1) {
    accumulator = (Math.imul(accumulator, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
  }
  if (accumulator === 1) throw new Error('unreachable; stops the loop being elided');
}

export function isFaultKind(value: string): value is FaultKind {
  return (FAULT_KINDS as readonly string[]).includes(value);
}

/**
 * Block the main thread for a wall-clock duration. Models a hang or a blocking
 * wait, and CPU throttling does not change how long it takes: the clock runs at
 * the same speed however slow the CPU is.
 */
function busyWait(durationMs: number): void {
  const deadline = performance.now() + durationMs;
  while (performance.now() < deadline) {
    /* Block the main thread so the delay is visible to load-time budgets. */
  }
}

export interface PlantedFaultOptions {
  /** Work for the cpu-regression fault; defaults to {@link CPU_REGRESSION_ITERATIONS}. */
  readonly iterations?: number | undefined;
}

/** Apply a planted fault. Unknown or absent values are a no-op. */
export function applyPlantedFault(kind: string | null, options: PlantedFaultOptions = {}): void {
  if (kind === null || !isFaultKind(kind)) return;
  switch (kind) {
    case 'console-error':
      console.error(PLANTED_CONSOLE_TEXT);
      return;
    case 'throw':
      // Thrown from a task so it surfaces as a genuine uncaught exception
      // rather than a rejected boot promise, and the shell still renders.
      setTimeout(() => {
        throw new Error(PLANTED_THROW_TEXT);
      });
      return;
    case 'unhandled-rejection':
      void Promise.reject(new Error(PLANTED_REJECTION_TEXT));
      return;
    case 'slow-boot':
      busyWait(SLOW_BOOT_DELAY_MS);
      return;
    case 'cpu-regression':
      burnCpu(options.iterations ?? CPU_REGRESSION_ITERATIONS);
      return;
  }
}
