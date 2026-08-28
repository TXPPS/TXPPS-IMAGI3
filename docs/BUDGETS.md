# BUDGETS

`budgets.json` at the repository root is the single source of truth. This
document explains the model and the provenance of each number; it does not
restate the values, because a second copy of a number is a second chance to
disagree with it. `tools/audit/test/budgets/real-config.test.ts` asserts that
the committed values still match the brief.

## The model

Every rule declares:

| Field          | Meaning                                                |
| -------------- | ------------------------------------------------------ |
| `id`           | Stable identifier a measuring harness reports against. |
| `unit`         | `ms`, `bytes`, `fps`, `ratio` or `count`.              |
| `scope`        | `desktop`, `tablet`, `phone`, or `all`.                |
| `max` / `min`  | Bound. At least one is required; both may be given.    |
| `enforcedFrom` | Phase from which a missing measurement is a failure.   |
| `source`       | Where the number came from.                            |

The checker classifies each rule as **passed**, **violated**, **unmeasured** or
**deferred**.

**Unmeasured is a failure.** A rule enforced in the current phase with no
reported measurement fails the gate. So does a measurement whose value is not
finite, and so does a reported id that matches no rule. This is deliberate: the
failure mode a budget system must not have is reporting green for something
nobody measured. See ADR-0006.

## Running the gate

```
pnpm audit:clean     # discard measurements from earlier runs
pnpm build           # produce the artifacts the bundle harness measures
pnpm audit:bundle    # records editor.bundle.gzip
pnpm test:e2e        # records the cold-load measurements
pnpm audit:budgets   # merges everything and checks against budgets.json
```

`pnpm sweep` runs exactly that chain in that order, and it begins with
`audit:clean` deliberately. Measurement files persist on disk, so without the
clean step a value produced by an earlier run — possibly at a different commit —
can satisfy the gate for a run that never measured it. Each report row prints
the measurement's origin and the time it was recorded, so a stale value is
visible rather than merely possible.

Harnesses record measurements with `recordMeasurements()` from
`tests/e2e/budget.ts`, or with `writeMeasurements()` directly. Each harness
writes its own file, so parallel Playwright workers never race. Later files win
for the same id, letting a targeted re-run supersede an earlier value.

## How cold load is measured

Cold load is the later of the app's own readiness mark and the browser's first
contentful paint, taken as the median of three navigations on fresh pages after
one warm-up navigation.

Each of those choices exists to close a specific hole:

- **The later of two signals**, because the app's readiness mark is
  self-reported and fires before paint. Anchoring partly on a browser-attested
  metric means the number cannot be improved simply by moving the mark earlier.
- **Fresh pages, not `location.reload()`**, because a reload keeps the renderer
  process, its code cache and its connection alive, which is not the condition
  the budget is stated against.
- **A median of three**, because a single sample is noise once a budget stops
  having two orders of magnitude of headroom.

What this still does not measure is in GAP-006, and it is substantial: no CPU or
network throttling, a loopback server, and no accounting for work deferred past
first paint. A green phone cold-load row does not mean the editor loads in time
on a phone.

## Provenance

Most numbers come straight from the project brief, section 4, and are marked
`source: brief-4-performance`. Two are ours and are marked `source: adr-0006`:
the phone cold-load ceiling and the editor bundle ceiling. ADR-0006 explains
both.

## Turning budgets on

Bumping `currentPhase` in `budgets.json` activates every rule whose
`enforcedFrom` has been reached. Those rules will then fail until a harness
reports them. That is the intended friction: the phase bump and the measurement
work belong to the same piece of work.

## Not covered by any budget

GPU and texture memory are tracked by instrumenting the asset loader
(`gpu.texture.phone`), because JavaScript cannot observe GPU allocations. Until
that instrumentation exists in P6, the rule is deferred rather than assumed.
