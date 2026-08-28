# STATE

<!-- Rewrite this file after every completed task. Prune aggressively. -->

**Phase:** P1
**Phase status:** P0 and P1-PRE closed. P1 code complete and green: core, runtime, renderer and play mode all landed, with `budgets.json` bumped to P1 so `runtime.bundle.gzip` and the play-mode frame budgets are enforced. Awaiting role sign-off.

<!-- The **Phase:** line above is a machine contract: a test requires it to
     match budgets.json currentPhase, so it must be one of the brief's phase
     ids. P1-PRE is a blocking sub-gate on the way to P1, not a phase, so it is
     recorded on the status line instead. -->

**Tree status:** green — 616 unit tests, 51 E2E, `pnpm sweep` passes end to end

## In flight

**P1 is code complete and green.** Landed: the canonical serializer, fractional
ordering keys, opaque ids, scene schema v1, the migration registry, the
round-trip property test at 10,000 entities, deterministic graph repair with its
convergence properties, the fuzz suite over the load boundary, the
fixed-timestep runtime with its determinism gate, the three.js WebGL2 renderer,
input abstraction, and play mode on a generated 400-sprite reference scene.

Also landed, from the standing items: the claims ledger, the shell-edit ban, the
guard audit, and raw-sample throttling provenance.

## Next 3 actions

1. **The P1 gate.** QA Automation, Visual QA and Performance each sign
   independently in `docs/GATES.md`, from a detached worktree at a tagged
   commit. Sign-off is a test artifact plus a table row, never a claim. The
   thing to review hardest is ADR-0015: one budget's enforcement was pushed from
   P1 to P9, and that is the move this project's own rules exist to catch.
2. **Asset resolution**, the one part of the P1 scope not built. Content
   addressing (`assets/<sha256>.<ext>` plus `asset-index.json`) is fixed by the
   brief; the runtime side is resolving a hash to bytes with a cache that does
   not pin everything in memory.
3. **P2**, once the gate closes: OPFS content-addressed storage and IndexedDB
   metadata, with local storage explicitly a cache and cloud the source of
   truth.

RC-0008 (`addEntity` is O(n²), and the editor is its only caller) is a **P3
blocker** with a gate condition already written. It needs a harness, not a
decision.

## Notes for the next session

- **The schema is a one-way door and its design is already fixed.** ADR-0012
  and ADR-0013 decide the shape and the merge semantics; ADR-0014 decides how a
  document that is not a tree is repaired. Implement them; do not re-litigate
  them.
- **`loadSceneDocument` is the only supported way a document enters the
  engine.** `validateSceneDocument` alone does **not** guarantee a tree — it
  admits cycles and dangling parents deliberately, because rejecting them would
  turn an ordinary concurrent merge into data loss. Anything that skips the
  repair can meet a cycle.
- **Where guards live is now a written rule** in docs/ARCHITECTURE.md: a guard
  must not be deletable by the edit that introduces the defect it catches. The
  audit table in docs/GATES.md applies it to every detector in the tree. Two
  failed it. Read that table before adding a check, and record a new guard in
  it.
- **A documented code change must name its commit** as a `file:` claim, and
  `pnpm verify:claims` fails the build when the commit does not touch the path.
  Shell-based source edits (`sed -i`, heredoc redirects) are banned by a lint
  check, because they cannot report that they changed nothing — the mechanism
  behind RC-0005.
- **Prefer generated cases over chosen ones for anything with an invariant.**
  Three defects in landed code were found by property and fuzz tests and by
  nothing else: the fractional index emitting `0`, the quadratic `addEntity`,
  and malformed JSON escaping as an untyped `SyntaxError`. None was visible by
  reading.
- **RC-0008 is a P3 blocker, not a note.** `addEntity` is O(n²) and the editor
  is its only caller. The gate condition is in docs/BUGS.md and needs a harness
  written, not just a decision taken.
- Two budgets are deliberately not what they appear to be:
  `ci-headless.editor.coldLoad` measures a CI runner and says so, and the
  tablet and phone cold-load budgets measure throttled emulation, not hardware.
  Both are recorded in the DEVICE-VERIFIED register, which never closes a phase.
