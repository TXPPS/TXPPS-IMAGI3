/**
 * Resolving a `test:` or `ci:` reference to something that exists.
 *
 * Split out of the CLI so it can be tested. The rule it replaces was one line —
 * "does this name appear as a substring of any tracked file?" — and QA
 * Automation showed at the P1 gate what that admits: `test: e` resolved, and so
 * did `ci: a`. Every assertion in the repository could be backed by a single
 * letter, which made the reference half of `verify:assertions` decorative while
 * reporting `OK`.
 *
 * Two things fix it, and the second is the one that matters:
 *
 * 1. A floor on the name's length. Not a calibration — a bound below which a
 *    name cannot identify anything.
 * 2. **Position.** A test name is looked for inside a test *title*, in a test
 *    *file*; a CI job name inside a job id or a job's `name:`, in a workflow
 *    file. A name matched anywhere in any file cannot be distinguished from a
 *    word that happens to occur.
 *
 * What this still cannot do, stated because the mechanism it replaces was
 * oversold: confirm that the named test exercises what the sentence claims.
 * That is review's job. This narrows what review must look at.
 */

/** Shortest name that can identify anything. */
export const MIN_REFERENCE_NAME = 6;

/**
 * A test title, as declared. The title text is group 2.
 *
 * The optional `\([^)]*\)` before the title is for `it.each([…])('title', …)`,
 * where the cases are passed first and the title comes from a second call.
 */
const TEST_TITLE =
  /\b(?:it|test|describe)(?:\.\w+)?\s*(?:\([^)]*\)\s*)?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gu;

/** A workflow job id (group 1) or a `name:` value (group 2). */
const WORKFLOW_JOB = /^ {2}([\w-]+):\s*$|^\s+name:\s*(.+)$/gmu;

export const TEST_FILE = /\.(?:test|spec)\.[cm]?tsx?$/u;
export const WORKFLOW_FILE = /^\.github\/workflows\/.+\.ya?ml$/u;

/** Every test title declared in a source text. */
export function testTitlesIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(TEST_TITLE)) {
    const title = match[2];
    if (title !== undefined && title.trim().length > 0) found.push(title.trim());
  }
  return found;
}

/** Every job id and job name declared in a workflow text. */
export function jobNamesIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(WORKFLOW_JOB)) {
    const value = match[1] ?? match[2];
    if (value !== undefined && value.trim().length > 0) found.push(value.trim());
  }
  return found;
}

/** What kind of thing a reference names, or undefined for a plain path. */
export function referenceKind(reference: string): 'test' | 'ci' | undefined {
  if (reference.startsWith('test:')) return 'test';
  if (reference.startsWith('ci:')) return 'ci';
  return undefined;
}

/** The name part of a `test:`/`ci:` reference. */
export function referenceName(reference: string): string {
  return reference.slice(reference.indexOf(':') + 1).trim();
}

/**
 * Whether a named reference is satisfied by one of the candidates.
 *
 * Candidates are titles or job names — never whole file contents, which is the
 * distinction the previous rule lacked.
 */
export function resolvesAgainst(reference: string, candidates: readonly string[]): boolean {
  const name = referenceName(reference);
  if (name.length < MIN_REFERENCE_NAME) return false;
  return candidates.some((candidate) => candidate.includes(name));
}
