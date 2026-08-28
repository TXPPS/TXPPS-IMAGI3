/** Phase identifiers in the order defined by the project brief, section 5. */
export const PHASE_ORDER = [
  'P0',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'P7',
  'P7.5',
  'P8',
  'P9',
] as const;

export type PhaseId = (typeof PHASE_ORDER)[number];

export function isPhaseId(value: string): value is PhaseId {
  return (PHASE_ORDER as readonly string[]).includes(value);
}

/** Position of a phase in the fixed phase order. Throws for unknown phases. */
export function phaseIndex(phase: PhaseId): number {
  const index = PHASE_ORDER.indexOf(phase);
  if (index < 0) throw new Error(`Unknown phase: ${phase}`);
  return index;
}

/** True when `current` is at or beyond `required` in the phase order. */
export function isPhaseAtLeast(current: PhaseId, required: PhaseId): boolean {
  return phaseIndex(current) >= phaseIndex(required);
}
