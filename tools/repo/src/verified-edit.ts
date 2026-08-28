import { readFileSync, writeFileSync } from 'node:fs';

/**
 * A scripted edit that cannot silently do nothing.
 *
 * RC-0005: four edits during phase 0 were written as exact-string replacements
 * whose anchors no longer matched, because the formatter had reflowed the
 * surrounding lines between reading the anchor and running the replacement. A
 * replacement that matches nothing is not an error, so each one silently did
 * nothing and was then reported — in a commit message and in the gate register
 * — as complete.
 *
 * Every function here fails loudly on a stale anchor, and re-reads the file
 * from disk afterwards to confirm the intended content is what actually
 * landed. Exiting zero is not evidence that an edit applied.
 */

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}

export interface Replacement {
  /** Exact text expected in the file. Must appear at least once. */
  readonly find: string;
  readonly replace: string;
  /** Expected occurrence count. Defaults to exactly one. */
  readonly count?: number | undefined;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) throw new EditError('an empty anchor matches everything');
  let total = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    total += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return total;
}

function excerpt(text: string): string {
  const EXCERPT_LIMIT = 120;
  const firstLine = text.split('\n')[0] ?? '';
  return firstLine.length > EXCERPT_LIMIT ? `${firstLine.slice(0, EXCERPT_LIMIT)}...` : firstLine;
}

function applyOne(source: string, replacement: Replacement, where: string): string {
  const expected = replacement.count ?? 1;
  const found = countOccurrences(source, replacement.find);
  if (found !== expected) {
    throw new EditError(
      `${where}: anchor matched ${String(found)} times, expected ${String(expected)}. ` +
        `The file has moved on from the text this edit was written against.\n  anchor: ${excerpt(replacement.find)}`,
    );
  }
  return source.split(replacement.find).join(replacement.replace);
}

export interface EditOutcome {
  readonly path: string;
  readonly applied: number;
  /** Bytes before and after, so a caller can see the edit had an effect. */
  readonly sizeBefore: number;
  readonly sizeAfter: number;
}

/**
 * Apply replacements to a file, then verify from disk that the result is
 * byte-identical to what was intended.
 *
 * The read-back is the point. A write can succeed while a formatter, a watcher,
 * or a concurrent process changes the file underneath it.
 */
export function editFile(path: string, replacements: readonly Replacement[]): EditOutcome {
  if (replacements.length === 0) throw new EditError(`${path}: no replacements given`);
  const before = readFileSync(path, 'utf8');

  let intended = before;
  replacements.forEach((replacement, index) => {
    intended = applyOne(intended, replacement, `${path} replacement[${String(index)}]`);
  });

  if (intended === before) {
    throw new EditError(`${path}: replacements produced no change; the edit is a no-op`);
  }

  writeFileSync(path, intended);
  verifyOnDisk(path, intended);

  return {
    path,
    applied: replacements.length,
    sizeBefore: before.length,
    sizeAfter: intended.length,
  };
}

/** First line index at which two texts diverge, or -1 when identical. */
export function firstDivergentLine(expected: string, actual: string): number {
  const a = expected.split('\n');
  const b = actual.split('\n');
  const limit = Math.max(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

/** Re-read a file and require it to match the intended content exactly. */
export function verifyOnDisk(path: string, intended: string): void {
  const actual = readFileSync(path, 'utf8');
  if (actual === intended) return;
  const line = firstDivergentLine(intended, actual);
  throw new EditError(
    `${path}: what landed on disk differs from what was intended, first at line ${String(line + 1)}\n` +
      `  intended: ${excerpt(intended.split('\n')[line] ?? '<missing>')}\n` +
      `  actual:   ${excerpt(actual.split('\n')[line] ?? '<missing>')}`,
  );
}

/** Require text to be present in a file as it currently exists on disk. */
export function requirePresent(path: string, needles: readonly string[]): void {
  const actual = readFileSync(path, 'utf8');
  const missing = needles.filter((needle) => !actual.includes(needle));
  if (missing.length > 0) {
    throw new EditError(
      `${path}: expected text is absent:\n  ${missing.map(excerpt).join('\n  ')}`,
    );
  }
}

/** Require text to be absent from a file as it currently exists on disk. */
export function requireAbsent(path: string, needles: readonly string[]): void {
  const actual = readFileSync(path, 'utf8');
  const present = needles.filter((needle) => actual.includes(needle));
  if (present.length > 0) {
    throw new EditError(
      `${path}: text that should be gone is still present:\n  ${present.map(excerpt).join('\n  ')}`,
    );
  }
}
