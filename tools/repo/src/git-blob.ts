import { execFileSync } from 'node:child_process';

/**
 * A file's committed bytes, read from a commit rather than from the disk.
 *
 * This exists because of the single most damaging defect the P1 gate found. The
 * mutation sweep's kill signal is the suite's exit code, and the sweep's own
 * anchor test read every mutation's file from the **working tree** — where the
 * sweep had just written a mutation. The anchor was gone, that test failed, the
 * exit code was non-zero, and every unit mutation reported `killed` whether or
 * not any production test had noticed. The sweep could not report a survivor,
 * and had been reporting success on that basis.
 *
 * Reading from a commit fixes it at the mechanism rather than by exempting the
 * sweep's own project from the run. A mutation is never committed, so the bytes
 * this returns are pristine **by construction** — not because some list
 * remembers to exclude something, which is the shape that failed.
 *
 * Kept in its own module, away from the sweep, so the property can be tested
 * against a scratch repository instead of against whatever the real tree
 * happens to contain. A guard that has only ever seen a clean tree has never
 * been shown to guard anything.
 */

/** Largest blob this will read. Generous; the sweep's targets are source files. */
const MAX_BLOB_BYTES = 33_554_432;

export class UncommittedFileError extends Error {
  constructor(path: string, revision: string) {
    super(
      `${path} is not committed at ${revision}, so its committed bytes cannot be read. ` +
        'Anything checked against a commit must target committed code: a sweep measures ' +
        'the project, not a draft.',
    );
    this.name = 'UncommittedFileError';
  }
}

/**
 * Read `path` as of `revision`, ignoring any working-tree modification.
 *
 * @throws {UncommittedFileError} when the path does not exist at that revision.
 */
export function readCommitted(cwd: string, path: string, revision = 'HEAD'): string {
  try {
    return execFileSync('git', ['show', `${revision}:${path}`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_BLOB_BYTES,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new UncommittedFileError(path, revision);
  }
}
