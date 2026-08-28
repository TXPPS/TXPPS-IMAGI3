# STATE

<!-- Rewrite this file after every completed task. Prune aggressively. -->

**Phase:** P0
**Phase status:** P0 closed. P1-PRE (gate verifiability, blocking) implemented; role sign-off in progress. P1 not started.

<!-- The **Phase:** line above is a machine contract: a test requires it to
     match budgets.json currentPhase, so it must be one of the brief's phase
     ids. P1-PRE is a blocking sub-gate on the way to P1, not a phase, so it is
     recorded on the status line instead. -->

**Tree status:** green — `pnpm sweep` passes end to end

## In flight

P1-PRE role reviews, running in detached worktrees at SHA `26add95`
(tag `review/p1-pre-1`): Performance and QA Automation. The gate is not closed
until both sign.

## Next 3 actions

1. Land any blocking findings from the P1-PRE reviews, then mark P1-PRE closed
   in the CI-VERIFIED register.
2. Create `packages/core`: ECS entity/component storage and the scene schema v1
   types, following ADR-0012 exactly — opaque generated ids, parent pointer plus
   fractional-index ordering, components keyed by component id, no derived data
   in the document, `schemaVersion` plus a migration registry with an identity
   v1 migration.
3. Implement the canonical serializer and its round-trip hash property test:
   sorted keys, fixed float formatting, `-0` normalised, NaN and Infinity
   rejected at the schema boundary, byte-stable across processes.

Bump `budgets.json` currentPhase to `P1` as part of step 2, and update the
`**Phase:**` line above to match — a test enforces that they agree. The bump
turns on `runtime.bundle.gzip` and `playmode.fps.tablet.reference2d`, which will
then FAIL until a harness reports them. That friction is the mechanism.

## Blockers

None.

## Notes for the next session

- **The schema is a one-way door and its design is already fixed.** ADR-0012 and
  ADR-0013 decide the shape and the merge semantics; docs/ARCHITECTURE.md
  carries the rule a feature author needs. Do not re-litigate it while writing
  the types — implement it.
- Cycles in the parent graph are a legitimate merge outcome, not a bug to
  prevent. They are repaired deterministically at load. The fuzz suite requires
  this, so build it into the loader rather than bolting it on.
- Two budgets are deliberately not what they appear to be:
  `ci-headless.editor.coldLoad` measures a CI runner and says so, and the
  tablet/phone cold-load budgets measure throttled emulation, not hardware.
  Both are recorded in the DEVICE-VERIFIED register.
