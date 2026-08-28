import { describe, expect, it } from 'vitest';
import { PHASE_ORDER, isPhaseAtLeast, isPhaseId, phaseIndex } from '../src/phases.ts';

describe('phase ordering', () => {
  it('places P7.5 between P7 and P8', () => {
    expect(phaseIndex('P7')).toBeLessThan(phaseIndex('P7.5'));
    expect(phaseIndex('P7.5')).toBeLessThan(phaseIndex('P8'));
  });

  it('treats a phase as at least itself', () => {
    for (const phase of PHASE_ORDER) {
      expect(isPhaseAtLeast(phase, phase)).toBe(true);
    }
  });

  it('orders every phase pair consistently with the declared order', () => {
    PHASE_ORDER.forEach((current, i) => {
      PHASE_ORDER.forEach((required, j) => {
        expect(isPhaseAtLeast(current, required)).toBe(i >= j);
      });
    });
  });

  it('rejects unknown phase identifiers', () => {
    expect(isPhaseId('P10')).toBe(false);
    expect(isPhaseId('p0')).toBe(false);
    expect(isPhaseId('P0')).toBe(true);
  });
});
