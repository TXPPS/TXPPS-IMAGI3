/** Kinds of runtime incident the browser harnesses can observe. */
export const INCIDENT_KINDS = ['console-error', 'page-error', 'unhandled-rejection'] as const;

export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export interface PageIncident {
  readonly kind: IncidentKind;
  readonly text: string;
  /** Page URL or test step the incident was observed in. */
  readonly origin?: string | undefined;
}

/**
 * A single allowlist entry. A justification is mandatory: the brief requires an
 * "explicit, justified allowlist", so an entry without a reason is a config
 * error rather than a silent pass.
 */
export interface ConsoleAllowEntry {
  /** JavaScript regular expression source, matched against the incident text. */
  readonly pattern: string;
  readonly justification: string;
  /** Issue or ADR reference that tracks removing this entry. */
  readonly trackedBy: string;
}

export interface IncidentVerdict {
  readonly incident: PageIncident;
  readonly allowed: boolean;
  /** Which allowlist pattern matched, when allowed. */
  readonly matchedPattern?: string | undefined;
  readonly reason: string;
}

export interface IncidentReport {
  readonly ok: boolean;
  readonly verdicts: readonly IncidentVerdict[];
  readonly violations: readonly IncidentVerdict[];
}
