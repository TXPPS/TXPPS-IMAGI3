# STATE

<!-- Rewrite this file after every completed task. Prune aggressively. -->

**Phase:** P0 — Foundation
**Phase status:** implementation complete; Visual QA and Performance signed off, QA Automation re-verification outstanding (docs/GATES.md)
**Tree status:** green — `pnpm sweep` passes end to end

## In flight

Nothing. P0 closed; P1 not started.

## Next 3 actions

1. Create `packages/core` with the ECS entity/component storage and the scene
   schema v1 types (P1).
2. Implement the canonical serializer (sorted keys, fixed float formatting,
   `-0` normalised, NaN/Infinity rejected at the schema boundary) plus the
   round-trip hash property test over randomly generated scene graphs.
3. Add `packages/runtime` with the fixed-step tick loop, and wire the first
   three.js renderer path (WebGL2 primary) behind a capability probe.

## Blockers

None.

## What the P0 reviews changed

Three independent role reviews raised 18 blocking findings against the first
implementation, including a self-test that proved neither screenshot threshold
was load-bearing and a mean-SSIM gate that caught 3 of 21 planted regressions.
All 18 were fixed in code. docs/GATES.md has the table; RC-0003 in docs/BUGS.md
has the most instructive one.

The habit worth carrying into P1: for any gate, do not ask whether the
threshold is right. Construct the regression the gate exists to catch and watch
it fire — then delete the gate and watch the suite go red.

## Notes for the next session

- `budgets.json` holds `currentPhase`. Bumping it to `P1` turns on the
  `runtime.bundle.gzip` and `playmode.fps.tablet.reference2d` budgets, which
  will then FAIL until a harness reports those measurements. Bump it as part of
  starting P1, not as an afterthought — that is the mechanism that stops a
  phase from being declared done on unmeasured claims.
- Visual baselines are deliberately NOT committed yet. See docs/GAPS.md
  entry GAP-003; the P3 gate is where they get locked.
