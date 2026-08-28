import {
  INCIDENT_KINDS,
  type ConsoleAllowEntry,
  type IncidentReport,
  type IncidentVerdict,
  type PageIncident,
} from './types.ts';

/**
 * Incident kinds that can never be allowlisted. An uncaught exception or an
 * unhandled rejection means the editor entered an undefined state; no
 * justification makes that acceptable, so only `console-error` is suppressible.
 */
const NON_SUPPRESSIBLE: readonly string[] = INCIDENT_KINDS.filter((k) => k !== 'console-error');

export class AllowlistConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`console allowlist: ${message}`, options);
    this.name = 'AllowlistConfigError';
  }
}

function compileEntry(entry: ConsoleAllowEntry, index: number): RegExp {
  const where = `entry[${String(index)}]`;
  if (entry.justification.trim().length === 0) {
    throw new AllowlistConfigError(`${where} ("${entry.pattern}") has an empty justification`);
  }
  if (entry.trackedBy.trim().length === 0) {
    throw new AllowlistConfigError(`${where} ("${entry.pattern}") has an empty trackedBy`);
  }
  try {
    return new RegExp(entry.pattern);
  } catch (cause) {
    throw new AllowlistConfigError(`${where} pattern "${entry.pattern}" is not a valid regex`, {
      cause,
    });
  }
}

interface CompiledEntry {
  readonly entry: ConsoleAllowEntry;
  readonly regex: RegExp;
}

/** Validate and compile allowlist entries. Throws on any malformed entry. */
export function compileAllowlist(entries: readonly ConsoleAllowEntry[]): CompiledEntry[] {
  return entries.map((entry, index) => ({ entry, regex: compileEntry(entry, index) }));
}

function judge(incident: PageIncident, compiled: readonly CompiledEntry[]): IncidentVerdict {
  if (NON_SUPPRESSIBLE.includes(incident.kind)) {
    return {
      incident,
      allowed: false,
      matchedPattern: undefined,
      reason: `${incident.kind} can never be allowlisted`,
    };
  }
  const match = compiled.find((c) => c.regex.test(incident.text));
  if (match === undefined) {
    return {
      incident,
      allowed: false,
      matchedPattern: undefined,
      reason: 'console error is not covered by any allowlist entry',
    };
  }
  return {
    incident,
    allowed: true,
    matchedPattern: match.entry.pattern,
    reason: match.entry.justification,
  };
}

/**
 * Judge observed incidents against the allowlist. The report is only `ok` when
 * every incident is explicitly permitted.
 */
export function evaluateIncidents(
  incidents: readonly PageIncident[],
  entries: readonly ConsoleAllowEntry[],
): IncidentReport {
  const compiled = compileAllowlist(entries);
  const verdicts = incidents.map((incident) => judge(incident, compiled));
  const violations = verdicts.filter((v) => !v.allowed);
  return { ok: violations.length === 0, verdicts, violations };
}
