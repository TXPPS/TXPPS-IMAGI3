/**
 * A function nobody guards, kept deliberately, in a file of its own.
 *
 * This is the mutation sweep's positive control. A sweep reporting no coverage
 * holes proves nothing unless it can be shown to report one — every other
 * detector in this project is held to that, and a sweep is not exempt.
 *
 * The rules that keep it a control:
 *
 * - It is exported and never called by production code.
 * - **No test asserts what it returns.** A test that did would guard it, the
 *   control mutation would start being killed, and the sweep would lose its
 *   only evidence that it can report a survivor at all.
 * - It lives here rather than in `mutations.ts`. It was there first, and the
 *   anchor test that checks every mutation's `find` text still matches its file
 *   then failed while the control was applied — because the control mutates the
 *   file that declares it. A self-referential control is not a control; it is a
 *   second thing that can break.
 *
 * If the sweep ever reports this as killed, someone has written an assertion
 * against it. Replace the control rather than deleting the assertion.
 */
export function unguardedForControl(value: number): number {
  return value * 2;
}
