/**
 * Deliberate fault injection, development builds only.
 *
 * The P0 gate requires proving that the audit harness actually catches
 * failures rather than merely reporting green. These faults give the harness
 * something real to catch. The module is loaded behind `import.meta.env.DEV`
 * so it is statically eliminated from production bundles; `test/no-dev-faults`
 * asserts that elimination on the built output.
 */
export const FAULT_KINDS = ['console-error', 'throw', 'unhandled-rejection', 'slow-boot'] as const;

export type FaultKind = (typeof FAULT_KINDS)[number];

/** Text emitted by the console-error fault; the self-test greps for it. */
export const PLANTED_CONSOLE_TEXT = 'IMAGI3 planted fault: console-error';
export const PLANTED_THROW_TEXT = 'IMAGI3 planted fault: throw';
export const PLANTED_REJECTION_TEXT = 'IMAGI3 planted fault: unhandled-rejection';

/** Delay used by the slow-boot fault, chosen to blow past every cold-load budget. */
export const SLOW_BOOT_DELAY_MS = 9000;

export function isFaultKind(value: string): value is FaultKind {
  return (FAULT_KINDS as readonly string[]).includes(value);
}

function busyWait(durationMs: number): void {
  const deadline = performance.now() + durationMs;
  while (performance.now() < deadline) {
    /* Block the main thread so the delay is visible to load-time budgets. */
  }
}

/** Apply a planted fault. Unknown or absent values are a no-op. */
export function applyPlantedFault(kind: string | null): void {
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
  }
}
