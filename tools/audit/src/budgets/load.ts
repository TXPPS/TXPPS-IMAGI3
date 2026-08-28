import { isPhaseId, type PhaseId } from '../phases.ts';
import { isDeviceProfileId } from '../profiles.ts';
import type { BudgetScope } from '../profiles.ts';
import { BUDGET_UNITS, type BudgetDocument, type BudgetRule, type BudgetUnit } from './types.ts';

class BudgetConfigError extends Error {
  constructor(message: string) {
    super(`budgets.json: ${message}`);
    this.name = 'BudgetConfigError';
  }
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BudgetConfigError(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BudgetConfigError(`${where}.${key} must be a non-empty string`);
  }
  return value;
}

function optionalFiniteNumber(
  source: Record<string, unknown>,
  key: string,
  where: string,
): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BudgetConfigError(`${where}.${key} must be a finite number`);
  }
  return value;
}

function parseUnit(raw: string, where: string): BudgetUnit {
  if (!(BUDGET_UNITS as readonly string[]).includes(raw)) {
    throw new BudgetConfigError(`${where}.unit "${raw}" is not one of ${BUDGET_UNITS.join(', ')}`);
  }
  return raw as BudgetUnit;
}

function parseScope(raw: string, where: string): BudgetScope {
  if (raw === 'all') return 'all';
  if (!isDeviceProfileId(raw)) {
    throw new BudgetConfigError(`${where}.scope "${raw}" is not a device profile or "all"`);
  }
  return raw;
}

function parsePhase(raw: string, where: string): PhaseId {
  if (!isPhaseId(raw)) throw new BudgetConfigError(`${where}.enforcedFrom "${raw}" is not a phase`);
  return raw;
}

function parseRule(raw: unknown, index: number): BudgetRule {
  const where = `rules[${String(index)}]`;
  const record = asRecord(raw, where);
  const max = optionalFiniteNumber(record, 'max', where);
  const min = optionalFiniteNumber(record, 'min', where);

  if (max === undefined && min === undefined) {
    throw new BudgetConfigError(`${where} must declare "max", "min", or both`);
  }
  if (max !== undefined && min !== undefined && min > max) {
    throw new BudgetConfigError(`${where} has min greater than max`);
  }

  return {
    id: requireString(record, 'id', where),
    description: requireString(record, 'description', where),
    unit: parseUnit(requireString(record, 'unit', where), where),
    scope: parseScope(requireString(record, 'scope', where), where),
    max,
    min,
    enforcedFrom: parsePhase(requireString(record, 'enforcedFrom', where), where),
    source: requireString(record, 'source', where),
  };
}

function assertUniqueIds(rules: readonly BudgetRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new BudgetConfigError(`duplicate rule id "${rule.id}"`);
    seen.add(rule.id);
  }
}

/**
 * Validate an already-parsed budgets document. Throws {@link BudgetConfigError}
 * with a precise location for any malformed field, so a bad budget file fails
 * loudly rather than silently disabling enforcement.
 */
export function parseBudgetDocument(raw: unknown): BudgetDocument {
  const record = asRecord(raw, 'document');
  const currentPhase = parsePhase(requireString(record, 'currentPhase', 'document'), 'document');
  const rawRules = record['rules'];
  if (!Array.isArray(rawRules)) throw new BudgetConfigError('document.rules must be an array');
  if (rawRules.length === 0) throw new BudgetConfigError('document.rules must not be empty');

  const rules = rawRules.map(parseRule);
  assertUniqueIds(rules);
  return { currentPhase, rules };
}

export { BudgetConfigError };
