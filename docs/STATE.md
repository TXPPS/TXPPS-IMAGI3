# STATE

<!-- Rewrite this file after every completed task. Prune aggressively. -->

**Phase:** P0
**Phase status:** P0 and P1-PRE closed. P1 in progress: core is complete through the load boundary — schema, canonical serialisation, deterministic graph repair and the fuzz suite are landed and green. `packages/runtime` has not been started.

<!-- The **Phase:** line above is a machine contract: a test requires it to
     match budgets.json currentPhase, so it must be one of the brief's phase
     ids. P1-PRE is a blocking sub-gate on the way to P1, not a phase, so it is
     recorded on the status line instead. -->

**Tree status:** green — 616 unit tests, 51 E2E, `pnpm sweep` passes end to end

## In flight

P1, past the halfway point. Landed and green: the canonical serializer,
fractional ordering keys, opaque ids, scene schema v1, the migration registry,
the round-trip property test at up to 10,000 entities, **deterministic graph
repair** (`repairSceneGraph`) with its convergence properties, and the **fuzz
suite** over the load boundary.

Also landed, from the standing items: the claims ledger, the shell-edit ban, the
guard audit, and raw-sample throttling provenance.

## Next 3 actions

1. `packages/runtime`: fixed-timestep tick loop with an accumulator, render
   interpolating between steps, wall clock never driving simulation. Inject the
   clock and the RNG; `Date.now` and `Math.random` are forbidden in core and
   runtime alike.
2. The determinism test — same seed and input tape produce an identical entity
   state hash after 10,000 ticks, run twice in the suite. Hash the serialized
   entity state, not the objects: assert a property of the artifact, not of the
   code that produced it.
3. The three.js renderer on the **WebGL2 path**, which is primary. Wire the
   parity harness with the WebGPU leg reporting UNMEASURED, never PASS — it is
   DV-001 in the deferred register.

Then: input abstraction, asset resolution, and the reference scene meeting the
throttled tablet frame budget.

Bump `budgets.json` currentPhase to `P1` when the runtime bundle exists, and
update the `**Phase:**` line to match; a test enforces that they agree. The bump
turns on `runtime.bundle.gzip` and `playmode.fps.tablet.reference2d`, which then
FAIL until measured. That friction is the mechanism, not an obstacle to it.

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
