# STATE

<!-- Rewrite this file after every completed task. Prune aggressively. -->

**Phase:** P0
**Phase status:** P0 and P1-PRE closed. P1 in progress: core schema, canonical serialisation and the round-trip property test are landed and green.

<!-- The **Phase:** line above is a machine contract: a test requires it to
     match budgets.json currentPhase, so it must be one of the brief's phase
     ids. P1-PRE is a blocking sub-gate on the way to P1, not a phase, so it is
     recorded on the status line instead. -->

**Tree status:** green — `pnpm sweep` passes end to end

## In flight

P1, partway. Landed and green: the canonical serializer, fractional ordering
keys, opaque ids, scene schema v1 with its validation boundary, the migration
registry, and the round-trip property test at up to 10,000 entities.

## Next 3 actions

1. `packages/core/src/graph.ts`: parent/child derivation and **deterministic
   cycle repair at load**. Cycles are a legitimate merge outcome, not
   corruption — for each cycle, reparent its lowest-id member to the root and
   emit a typed diagnostic. Every peer must repair identically or they diverge.
   The schema boundary deliberately leaves this to the loader; see ADR-0012.
2. The fuzz suite the brief names: malformed JSON, missing asset hashes,
   circular parents, NaN transforms, gigantic values, empty and 10k-entity
   scenes. Every case must produce a typed error or a repaired document, never
   a crash.
3. `packages/runtime`: fixed-timestep tick loop with an accumulator, render
   interpolating between steps, wall clock never driving simulation. Then the
   determinism test — same seed and input tape produce an identical entity
   state hash after 10,000 ticks, run twice in the suite.

Still to come in P1 after those: the three.js renderer on the WebGL2 path,
input abstraction, asset resolution, and the reference scene meeting the
throttled tablet frame budget. The WebGPU parity leg must be wired but report
UNMEASURED, not PASS — it is DV-001 in the deferred register.

Bump `budgets.json` currentPhase to `P1` when the runtime bundle exists, and
update the `**Phase:**` line to match; a test enforces that they agree. The bump
turns on `runtime.bundle.gzip` and `playmode.fps.tablet.reference2d`, which then
FAIL until measured. That friction is the mechanism, not an obstacle to it.

## Notes for the next session

- **The schema is a one-way door and its design is already fixed.** ADR-0012 and
  ADR-0013 decide the shape and the merge semantics; docs/ARCHITECTURE.md
  carries the rule a feature author needs. Implement it; do not re-litigate it.
- **Two bugs in the landed code were found by property tests, not by reading.**
  The fractional index emitted the key `0` — the infimum of the ordering, which
  nothing can ever sort before — when a lower bound ran out of digits, and only
  200 random insertions hit it. Bulk-building 10,000 entities through the
  incremental API took over half a minute. Neither was visible by inspection.
  Prefer generated cases over chosen ones for anything with an invariant.
- Cycles in the parent graph are a legitimate merge outcome, not a bug to
  prevent. They are repaired deterministically at load. The fuzz suite requires
  this, so build it into the loader rather than bolting it on.
- **The lesson of P1-PRE, which cost three review passes:** a guard that lives
  inside the path it guards can be deleted by the same edit that introduces the
  defect. Throttling was verified on the page that applied it, and the mutation
  removing the throttling removed the verification too. What worked was checking
  the _artifact_ — the budget gate rejects a measurement that cannot evidence
  its own provenance, from a different module in a different process. Prefer
  that shape in P1: assert properties of the serialized scene, not of the code
  that produced it.
- Two budgets are deliberately not what they appear to be:
  `ci-headless.editor.coldLoad` measures a CI runner and says so, and the
  tablet and phone cold-load budgets measure throttled emulation, not hardware.
  Both are recorded in the DEVICE-VERIFIED register, which never closes a phase.
