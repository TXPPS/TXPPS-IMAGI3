# Architecture Decision Records

Each record states the decision, why it was taken, and what was rejected.
Append new records; do not rewrite settled ones. Supersede instead.

---

## ADR-0001 — pnpm workspaces, Vite, TypeScript strict

**Status:** accepted (P0)

Single-codebase monorepo using pnpm workspaces. Vite for the app build and dev
server. TypeScript with `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`,
`noImplicitReturns` and `verbatimModuleSyntax`.

**Rejected:** npm/yarn workspaces (slower, weaker isolation of phantom
dependencies); Nx or Turborepo (build orchestration we do not yet need — the
brief warns against speculative abstraction); webpack/rspack (Vite's dev server
and library mode cover both the editor and the P8 export).

---

## ADR-0002 — TypeScript 5.9.3, not 7.x

**Status:** accepted (P0)

**Decision:** pin TypeScript 5.9.3.

TypeScript 7.0.2 is published, but `typescript-eslint@8.68.0` declares a peer
range of `typescript >=4.8.4 <6.1.0`. Type-aware linting is load-bearing here —
it is what enforces the section 7 coding standards — so ecosystem support wins
over being current.

**Rejected:** TypeScript 7 (would silently disable type-aware lint rules);
floating the version (a toolchain that changes under us breaks reproducibility).

**Revisit when:** typescript-eslint ships a release declaring TypeScript 7
support.

---

## ADR-0003 — `tsc` is a typechecker, not a compiler

**Status:** accepted (P0)

**Decision:** every project sets `emitDeclarationOnly`, `allowImportingTsExtensions`
and `erasableSyntaxOnly`. All internal imports carry explicit `.ts` extensions.
Vite and Vitest execute TypeScript source directly; `tsc -b` only typechecks and
emits declarations.

Three things follow, all of them wanted:

1. Any source file runs directly under `node --experimental-strip-types`, which
   is how the audit CLI runs with no build step.
2. There is no `dist` JavaScript to drift from source, and no build-order
   dependency between workspace packages during development.
3. `erasableSyntaxOnly` forbids enums, parameter properties and namespaces,
   which keeps the codebase to constructs every toolchain agrees on.

**Rejected:** emitting JavaScript with `tsc` (a second, subtly different build
path alongside Vite — exactly the "one runtime, two consumers" divergence the
brief calls a P0 bug, applied to tooling); extensionless imports (Node's type
stripping does not resolve them).

---

## ADR-0004 — Playwright pinned to the provisioned browser revision

**Status:** accepted (P0)

**Decision:** `@playwright/test@1.56.1`.

The environment provisions Chromium revision 1194 at `/opt/pw-browsers` with
browser downloads disabled. Playwright 1.56.x is the release line that expects
revision 1194; 1.62 expects 1234 and would fail to launch. Pinning to the
matching version is cleaner than overriding `executablePath`, because the
headless shell and ffmpeg builds also line up.

**Rejected:** latest Playwright with a hard-coded `executablePath` (leaves the
headless shell and trace viewer mismatched, and hides the coupling).

**Constraint this creates:** upgrading Playwright requires checking
`playwright-core/browsers.json` against the provisioned revision, and updating
the container tag in `.github/workflows/ci.yml` to match.

---

## ADR-0005 — Own perceptual comparator, gated three ways

**Status:** accepted (P0), revised after the P0 visual review

**Decision:** screenshots are compared by `@imagi3/audit`, not by
`expect(page).toHaveScreenshot()`, and the comparison applies three independent
gates rather than the two the brief names.

The brief mandates a _pair_ of thresholds for WebGPU-versus-WebGL2 parity: fail
above 0.5% differing pixels **or** below 0.98 SSIM. Playwright's built-in
comparator offers a pixel-ratio bound but no structural metric, so half the
mandate would be unenforceable. Owning the comparator also means the same code
is unit-tested and exercised by the harness self-test.

**Why a third gate.** Mean SSIM is close to useless at UI resolution. A
1440x900 frame yields roughly 80,000 windows, so a control that disappears
entirely has its structural collapse divided by 80,000. Measured on this
project's own shell: deleting the status badge scores mean SSIM 0.9977 — inside
any sane threshold — while the worst window scores 0.013. The signal exists in
the SSIM map and the mean throws it away.

So the comparator reports and gates on the **fraction of windows below a
severe-damage floor** as well. The floor (0.90) sits well below the whole-frame
threshold (0.98) deliberately: were they equal, the mean gate would be
unreachable, because a mean below 0.98 implies a large fraction of windows
below 0.98 — one gate would silently subsume the other.

Each gate is independently reachable, and the self-test pins one regression per
gate where the other two stay inside their bounds:

| Gate                  | Catches                      | Measured case where it fires alone                                           |
| --------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| Differing-pixel ratio | Diffuse colour drift         | 0.93% of pixels shifted; mean SSIM 0.998, no damaged windows                 |
| Mean SSIM             | Whole-frame structural drift | Three-level background shift; **zero** pixels cross the perceptual threshold |
| Damaged-window ratio  | One erased region            | 0.25% of pixels, mean SSIM 0.997, 0.40% of windows collapsed                 |

Differing pixels use YIQ-weighted perceptual distance. SSIM uses uniform 8x8
windows at stride 4 on the Rec. 709 luma plane.

**On uniform rather than Gaussian windows:** the honest reason is simplicity —
one fewer parameter to justify, and the SSIM map is reduced to summary
statistics rather than being inspected directly, which is what the Gaussian
kernel exists to smooth. An earlier version of this ADR claimed uniform weights
made the result "bit-reproducible across machines". That was wrong: IEEE-754
arithmetic is deterministic regardless of the weight values, and the real
cross-machine risks are FMA contraction and reassociation, which uniform
weights do not avoid.

**Rejected:** `toHaveScreenshot` (no structural metric); exact pixel equality
across renderer backends (not achievable, and the brief forbids asserting it);
mean SSIM alone (demonstrably blind to localised regressions, as above).

## ADR-0006 — Budget model: phase-gated, and unmeasured means failed

**Status:** accepted (P0)

**Decision:** `budgets.json` is the single source of truth. Every rule declares
`enforcedFrom` (a phase) and provenance (`source`). The document declares
`currentPhase`. The checker then classifies each rule as passed, violated,
**unmeasured**, or deferred.

The load-bearing part: a rule that is enforced in the current phase but that no
harness measured is a **failure**. A budget system that reports green for
metrics nobody collected is worse than no budget system, because it manufactures
false confidence. Measurement ids with no matching rule also fail the gate, so
renaming a budget cannot silently switch off its enforcement.

Two numbers are ours rather than the brief's, and are marked `source: adr-0006`:

- `editor.coldLoad.phone` = 6000 ms. The brief fixes desktop (3 s) and tablet
  (6 s) only. The phone inherits the tablet ceiling: a slower budget would
  concede a worse experience on the device the brief calls the capability floor.
- `editor.bundle.gzip` = 5,000,000 bytes, enforced from **P0**. The brief
  budgets the engine runtime but not the editor; an unbudgeted editor bundle is
  how load time regresses without anything turning red. It is enforced from P0
  rather than later because it is measurable from a build artifact today, needs
  no device and no browser, and deferring a budget that can be measured now
  recreates the very hole the rule exists to close.

**Byte units are decimal, not binary.** The brief writes "1.5MB", "500MB" and
"256MB". Reading those as MiB would set every ceiling about 4.9% higher — a
uniform relaxation of the brief arrived at by unit convention rather than by
decision. The stricter reading is taken, and
`tools/audit/test/budgets/real-config.test.ts` asserts each byte budget is below
its binary equivalent so the interpretation cannot drift back.

**Duration and size budgets carry a plausibility floor.** A `max` alone accepts
zero and negative values, so a harness bug — reading a mark's `duration`, which
is always zero, instead of its `startTime` — would report a perfect score rather
than a failure. Every cold-load and bundle rule therefore also declares a `min`.

**Rejected:** enforcing every budget from P0 (would make the tree permanently
red for metrics that cannot exist yet); silently skipping unmeasured budgets
(the false-confidence failure mode above); binary byte units (a silent 4.9%
relaxation of numbers the brief states explicitly).

---

## ADR-0007 — Only console errors are allowlistable

**Status:** accepted (P0)

**Decision:** the console guard classifies three incident kinds:
`console-error`, `page-error` (uncaught exception) and `unhandled-rejection`.
Only `console-error` can be suppressed by an allowlist entry. Uncaught
exceptions and unhandled rejections always fail, with no override.

The brief's wording ("any uncaught exception, unhandled rejection, or
console.error not in an explicit, justified allowlist") admits a looser reading
where the allowlist covers all three. The stricter reading was taken: an
uncaught exception means the editor entered an undefined state, and no
justification makes that acceptable.

Every allowlist entry requires a non-empty `justification` and `trackedBy`;
entries missing either are a configuration error, not a silent pass.
`audit.allowlist.json` currently has zero entries and that is the goal state.

---

## ADR-0008 — Chromium-only E2E, three emulated device profiles

**Status:** accepted (P0)

**Decision:** the E2E matrix is desktop (1440x900), tablet (1200x800, touch,
DPR 2) and phone (390x844, touch, DPR 3), all on Chromium. Profiles live in
`tools/audit/src/profiles.ts` so the E2E matrix, budget scopes and screenshot
baseline layout share one definition.

Chromium is the only browser provisioned in this environment. These profiles
validate **layout and logic only**. They are not iOS Safari and prove nothing
about memory pressure, OPFS eviction or GPU limits — see GAP-001 and GAP-002.

**Rejected:** claiming iOS coverage from an emulated viewport (the single most
tempting false claim available in this project).

---

## ADR-0009 — Fault injection lives in the app, behind a dev-only guard

**Status:** accepted (P0)

**Decision:** `apps/editor/src/dev/plant.ts` injects console errors, uncaught
exceptions, unhandled rejections and a slow boot when a `?plant=` query
parameter is present. It is dynamically imported behind `import.meta.env.DEV`,
so Vite eliminates it from production bundles.

Proving the harness catches synthetic fixtures is necessary but not sufficient;
the P0 gate asks for a planted failure in a real running page. That requires the
app to be able to misbehave on demand. The dev-only guard is what keeps that
capability out of shipped builds, and the elimination is asserted, not assumed.

**Rejected:** a separate "broken app" fixture (would diverge from the real app
and stop testing the real boot path); patching the page from the test via
`addInitScript` (tests the injection, not the app's own failure modes).

---

## ADR-0010 — Screenshot baselines are not committed at P0

**Status:** accepted (P0)

**Decision:** P0 ships the screenshot _infrastructure_ and exercises it against
a real regression. It does **not** commit reference baselines.

What P0 proves, and how:

- Capture, PNG encode/decode and comparison round-trip without corruption —
  the same page captured twice yields a zero-difference comparison.
- The comparator **rejects a regression planted in the running page**: the E2E
  suite hides a visible control with an injected stylesheet and requires the
  comparison to fail, on all three device profiles. Without this, no screenshot
  the browser produces would ever be compared against anything but itself, and
  a comparator that always returned "ok" would pass the suite.
- A missing baseline is a **failure**, not a silently created file. Writing a
  baseline requires an explicit opt-in, so a renamed profile or a deleted file
  cannot self-heal to green — the same rule ADR-0006 applies to budgets.
- Diff-image rendering is unit-tested against a known mask.

**Why baselines wait.** Font rasterisation differs between environments, so a
baseline captured in the development container would not match CI and the tree
would start red. The brief places "visual baselines locked" in the P3 gate, not
P0. Baselines will be generated inside the pinned
`mcr.microsoft.com/playwright:v1.56.1-noble` container that CI already uses.

Measurement supporting the deferral rather than merely asserting it: on this
shell, antialiasing-susceptible edge pixels are 0.48%–0.91% of the frame
depending on profile — between 5x and 9x the entire same-backend pixel budget.
A rasteriser difference between environments would blow the gate without any
real regression.

**Rejected:** committing sandbox-generated baselines (guaranteed CI failure);
loosening the threshold until cross-environment noise passes (would make the
gate incapable of catching real regressions).

**Tracked as:** GAP-003, which also carries the threshold calibration work that
must happen when baselines land.

---

## ADR-0011 — A budget named for a device must be measured under something like that device

**Status:** accepted (P1-PRE)

**Decision:** the tablet and phone profiles run under calibrated CPU
throttling. The desktop profile does not, and its budget is therefore named
`ci-headless.editor.coldLoad` rather than `editor.coldLoad.desktop`.

At the end of P0 all three profiles differed only in viewport, device pixel
ratio and touch emulation. The consequence was not subtle: the phone profile
routinely measured **faster** than the desktop profile, because it was the same
machine. Three green rows named for three devices were reporting one number
about one workstation.

A gate that cannot fail for the reason it names is not a gate.

**What changed:**

1. **Throttling, calibrated rather than guessed.** `Emulation.setCPUThrottlingRate`
   takes a requested multiplier, not a guaranteed one. `pnpm calibrate:cpu`
   sweeps requested rates against a fixed arithmetic workload in a real browser
   and reports the achieved slowdown. Tablet 4 (measured 4.1x-4.8x), phone 6
   (measured 6.5x-6.8x).
2. **Ordering asserted on every run.** Absolute slowdowns vary by host; the
   ordering does not. `pnpm audit:profile-ordering` requires tablet >= 2.0x
   desktop and phone >= 1.15x tablet. Remove throttling and every ratio
   collapses to 1.00x and the check fails — verified by doing it.
3. **Honest naming for what stays unthrottled.** A budget id that names a device
   asserts a device claim. The unthrottled profile's does not any more, a test
   enforces that no budget is named after an unthrottled profile, and the real
   desktop claim moved to the DEVICE-VERIFIED register as DV-004.

**The regression must be fixed work, not a wall-clock stall.** This is the part
that is easy to get wrong. A `while (now < deadline)` spin takes the same wall
time however slow the CPU is, so it breaches every profile equally and proves
nothing about throttling. The planted regression therefore performs a fixed
number of arithmetic operations: constant work, whose wall cost scales with CPU
speed. Sized from measured timings, it lands at roughly 2.0s unthrottled
(inside the 3s ceiling) and 8.5s at the tablet's 4x (well past the 6s ceiling).

**What this does not fix.** Throttled emulation on a workstation is still not a
phone: the server is loopback, the measurement anchors on first contentful
paint, and no real memory pressure or GPU limit is in play. GAP-006 is narrowed,
not closed.

**Rejected:** leaving the profiles unthrottled and relying on GAP-006 to warn
readers (a warning in a document does not stop a green row from being read as a
device claim); keeping the `editor.coldLoad.desktop` id because the brief names
a desktop ceiling (the brief names a ceiling for real desktops, which is
precisely what is not being measured); throttling by wall-clock delay injection
(measures nothing about CPU speed).

---

## ADR-0012 — Scene schema v1, shaped for CRDT merge from the start

**Status:** accepted (P1, design fixed before implementation)

Schema v1 is a one-way door. Projects authored against it must keep opening,
and P4 introduces Yjs to a document that will already be full of user data. A
shape that merges badly cannot be fixed later without a migration that loses
edits, so the CRDT constraints are applied now, while the cost is zero.

### The document

```jsonc
{
  "schemaVersion": 1,
  "id": "sc_<opaque>",
  "name": "Main",
  "entities": {
    "en_<opaque>": {
      "id": "en_<opaque>",
      "name": "Player",
      "parent": null, // or an entity id
      "order": "a0", // fractional index among siblings
      "components": {
        "cm_<opaque>": { "id": "cm_<opaque>", "type": "transform", "data": {} },
      },
    },
  },
}
```

### Four rules, and what each one prevents

**1. Identity is an opaque generated id, never a position.** Entities and
components are addressed by id, and ids appear both as the map key and inside
the value. Array index identity does not survive a merge: two peers inserting
at index 3 do not mean the same thing, and after merge neither index 3 is what
either peer meant. Ids are also opaque — no meaning is encoded in them — so
nothing can come to depend on their content.

**2. Hierarchy is a parent pointer plus an explicit ordering key.** No nested
`children` array anywhere. A children array makes every reparent a
read-modify-write of two arrays, which is exactly the operation CRDTs merge
worst. A parent pointer makes reparenting a single-register write.

Sibling order is a **fractional index**: a string chosen so that a new key can
always be generated strictly between any two existing keys, without renumbering
anything. Ordering is by `(order, id)`, not `order` alone — two peers can
concurrently generate the same key, and the id breaks the tie deterministically
so every peer sorts identically.

**3. Components are a map keyed by component id, not an array or a type map.**
Keyed by id, two peers concurrently adding a transform produce two transforms —
a resolvable condition — rather than a lost write. The consequence is that
duplicate component types are _representable_, so the runtime must define what
they mean rather than assuming they cannot happen: component types declare
whether they are unique per entity, and a violation resolves deterministically
to the lowest component id, surfacing a typed diagnostic. It degrades; it does
not crash. That is a requirement of the fuzz suite, not a nicety.

**4. No derived or cached data inside the document. Ever.** No world
transforms, no bounding boxes, no child lists, no dirty flags. Derived data is
a second source of truth, and a merge that updates one and not the other
produces a document that is internally inconsistent in a way no peer can
detect. Everything derived is computed at load and lives outside the document.

### Cycles are a merge outcome, not a bug to prevent

Two peers can concurrently reparent A under B and B under A. Both edits are
individually valid; the merge is not. Cycles therefore cannot be prevented at
write time — they must be **repaired deterministically at load**, identically on
every peer, or peers diverge.

The rule: detect cycles, and for each one reparent the member with the lowest id
to the root, emitting a typed diagnostic. Lowest id is arbitrary but total and
stable, which is what matters. The alternative — rejecting the document — turns
a routine concurrent edit into data loss.

### Migration exists before it is needed

`schemaVersion` is a required top-level field, and a migration registry ships in
v1 containing an identity migration from v1 to v1, exercised by a test. A
migration path added when the first breaking change arrives is a migration path
written under pressure against documents that already exist.

**Rejected:** nested `children` arrays (the standard scene-graph shape, and the
worst possible one to merge); components keyed by type (loses a concurrent add
instead of surfacing it); integer sibling indices (every insert renumbers, so
every insert conflicts); positional identity (does not survive merge); storing
world transforms (a second source of truth that merge desynchronises).

---

## ADR-0013 — What merges, and what is last-write-wins

**Status:** accepted (P1, design fixed before implementation)

The brief requires no last-write-wins dialogs. That is a promise about the user
experience, and it can only be kept if every field's merge behaviour is decided
in advance rather than discovered when two devices disagree.

Nothing here is implemented in P1 — Yjs arrives in P4 — but the schema is built
so that these mappings are the natural ones, and P1's serializer must not
foreclose any of them.

| Location                       | Behaviour                  | Why                                                                                                                                                                       |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entities` map                 | CRDT map: add/remove merge | Two peers adding entities must both keep them.                                                                                                                            |
| `entity.parent`                | LWW register               | One value. Concurrent reparent is a genuine either/or; the loser is a moved node, not lost work. Cycles repaired per ADR-0012.                                            |
| `entity.order`                 | LWW register               | Fractional index; ties broken by id, so concurrent writes still totally order.                                                                                            |
| `entity.name`                  | LWW register               | Short, rarely concurrent. A text CRDT here buys nothing.                                                                                                                  |
| `components` map               | CRDT map: add/remove merge | Concurrent component adds must both survive.                                                                                                                              |
| `component.type`               | Immutable after creation   | Changing a component's type is deleting one and adding another. Enforced at the schema boundary.                                                                          |
| `component.data` scalar fields | Per-field LWW register     | Two peers editing different fields of the same component must not clobber each other. Per-field, not per-component.                                                       |
| `component.data` arrays        | **Opaque LWW value**       | v1 replaces arrays wholesale. Point lists and similar merge poorly as sequences, and getting that right is not P1 work. Recorded as a known limitation, not an oversight. |
| Script source text             | Text CRDT (P7)             | The one place character-level merge genuinely matters.                                                                                                                    |
| `asset-index.json`             | CRDT map, LWW per key      | Name to hash. Both peers' new assets survive; a name pointing at two hashes resolves LWW.                                                                                 |
| Binary assets                  | Never merged               | Content-addressed and immutable. Two hashes are two files.                                                                                                                |

### The consequence to be honest about

Array fields are LWW in v1. Two people editing different vertices of the same
polygon concurrently will lose one set of edits, silently. That is a real
limitation with a real user cost, and it is chosen deliberately over shipping a
sequence CRDT for geometry in P1. It must be revisited before any feature makes
concurrent array editing routine — a tilemap layer, a spline tool, a particle
curve — and it is recorded in docs/ARCHITECTURE.md where a feature author will
meet it.

**Rejected:** whole-document LWW (the "no last-write-wins dialogs" requirement
is unachievable on top of it); per-component rather than per-field LWW (two
people adjusting different properties of the same object is the single most
common concurrent edit in a scene editor); a sequence CRDT for all arrays in v1
(unbounded scope for a case P1 has no feature to exercise).

---

## ADR-0014 — Graph faults are repaired at load, not rejected at the boundary

**Status:** accepted, P1. **Supersedes** the parent-reference checks that
`validateSceneDocument` performed at v1.

### Decision

The schema boundary validates **shape**. Reference integrity — dangling parents,
parent cycles, self-parenting, ordering keys that sort but are not canonical —
is **repaired deterministically at load** by `repairSceneGraph`, which never
throws and never drops an entity. `loadSceneDocument` is the composition of the
two, and is the only supported way a document enters the engine.

The repair rule, stated once so it can be checked rather than inferred:

- Each **cycle** is broken at its **lowest entity id**, which is re-parented to
  the root with an ordering key derived by hashing that id.
- A **dangling parent** is re-parented to the root the same way.
- A **non-canonical ordering key** — one ending in the smallest digit — is
  rewritten by the same derivation.
- Every repair emits a typed, non-fatal diagnostic naming what changed.

### Why repair rather than reject

Each of these is what two peers making valid concurrent edits produce between
them. Peer A parents X under Y; peer B parents Y under X; neither did anything
wrong and the merge is a cycle. Peer A deletes Y while peer B parents X under
it; the merge has a dangling pointer. **Rejecting the document turns an ordinary
concurrent edit into data loss**, which is a far worse outcome than a repaired
tree plus a diagnostic. A rejected scene is a scene the user cannot open.

Self-parenting is the same class, one member short, and was previously rejected
while a two-element cycle was not — a boundary inconsistent with itself.

### Why "lowest id", and why it is the load-bearing part

The repair must be a **pure function of document state**. Every peer must reach
the same document from the same merged input; anything else is a divergence in
which both sides believe they are correct and nothing reports an error. That
rules out insertion order, iteration order, traversal start point, wall clock,
a counter, and which peer noticed first.

The lowest id is the only tie-break available that depends on nothing but the
cycle's own membership. It has no other virtue — it is not more likely to be the
"right" entity to detach — and none is needed.

The derived ordering key follows from the same requirement. A key from
`keyBetween` would depend on what else is in the document at the moment of
repair, which differs between peers mid-merge. Hashing the id depends on the id
alone. Collisions are harmless: siblings sort by `(order, id)`, so two entities
on the same key still have a total order, and it is the same order everywhere.

### Why the stages run in that order

Ordering keys, then dangling parents, then cycles. Breaking a cycle removes an
edge; re-parenting a dangling child removes an edge. Neither can create work for
an earlier stage, which is what makes one pass sufficient and the whole function
idempotent.

### How it is held to this

Properties over generated damaged documents, not chosen examples — the
fractional index bug that shipped was invisible to inspection and took two
hundred random insertions to surface:

- **Idempotent** — `repair(repair(d))` is byte-identical to `repair(d)`.
- **Order-independent** — twenty shuffled rebuilds of the same document produce
  identical canonical bytes.
- **Convergent** — two peers given the document through different update
  orderings land on identical bytes. This is the one that matters; the others
  are the conditions that make it hold.
- **Total** — multiple disjoint cycles, a cycle with subtrees hanging off it,
  self-parents and a cycle that swallowed a root-level entity, all in one pass.

### Consequences to be honest about

`validateSceneDocument` alone no longer guarantees a tree. Anything holding a
validated-but-unrepaired document can still meet a cycle, which is why
`ancestorsOf` throws rather than truncating its walk — a silent truncation would
hide exactly the fault the repair exists to remove. Callers use
`loadSceneDocument`; the two-stage form exists for tests that need to observe
the boundary and the repair separately.

**Rejected:** rejecting cyclic documents (data loss on an ordinary merge);
repairing by detaching the entity that closed the cycle (depends on update
order, so peers diverge); repairing to the _deepest_ or _most recently touched_
member (both need information the document does not carry, and the second would
put a timestamp in the schema, which ADR-0012 forbids); leaving the document
cyclic and making every traversal defensive (moves the cost to every reader and
guarantees one of them forgets).

---

## ADR-0015 — The play-mode frame budget splits into a measured half and a deferred half

**Status:** accepted, P1.

### Decision

The reference scene's 60fps target **cannot be measured in this environment**
and is deferred to P9 as **DV-007** in the DEVICE-VERIFIED register, at its full
value. In its place, `playmode.cpuFrame.tablet.reference2d` is enforced from P1:
the engine's own CPU work per 60Hz frame — one simulation step plus one
scene-graph update and draw submission, with rasterisation excluded — capped at
8ms.

**This ADR was revised after the P1 gate review, and the revisions matter more
than the original.** Three reviewers returned FAIL; two of the findings were
against this decision directly. They are folded in below and recorded as
RC-0011 and RC-0012 rather than quietly corrected, because the original version
of this section made a claim about a substitute budget that measurement
contradicted, and the shape of that mistake is the useful part.

This is the only budget in the repository whose enforcement has been pushed
past the phase the brief assigns it, and the conditions that make the deferral
legitimate are asserted in `real-config.test.ts` rather than argued in prose.

### The evidence, because "we cannot measure it" is a claim like any other

CI has no GPU; Chromium renders through SwiftShader. Frame cost therefore scales
with pixels rather than with the engine's work, and the measurements say so
plainly:

| Profile     | Entities | DPR | p95 frame | p95 fps |
| ----------- | -------- | --- | --------- | ------- |
| desktop, 1x | 1        | 1   | 16.9ms    | 59.5    |
| desktop, 1x | 400      | 1   | 26.2ms    | 38.2    |
| desktop, 1x | 400      | 2   | 59.9ms    | 16.7    |
| tablet, 4x  | 1        | 2   | 83.0ms    | 12.0    |
| tablet, 4x  | 400      | 2   | 110.6ms   | 9.0     |

Two rows settle it. **The throttled tablet profile misses 60fps with a single
entity on screen**, before the engine has done anything at all. And identical
scene logic at DPR 1 versus DPR 2 — the same 400 entities, four times the
fragments — costs 26ms versus 60ms. The budget as stated measures the software
rasteriser.

The engine's own contribution, measured separately, is 2.5ms at the median on
the same throttled tablet profile: **15% of a 60fps frame**. There is no reason
to believe the engine misses the target on real hardware, and no way to
demonstrate that here.

### Two corrections from the P1 gate review

**The deferred budget was unsatisfiable, not merely demanding.** It was stated
as `min: 60` against a frame rate derived from the 95th-percentile interval
between animation-frame callbacks. That interval is set by the compositor's
60Hz frame source, and Performance measured an empty page — no engine, no
WebGL, no scene — at a p95 of 16.90ms, which converts to **59.2fps**. No engine
could ever have passed it, on any hardware, and GAP-011's manual procedure for
closing DV-007 would have failed on a flawless iPad. It is now stated as the
fraction of frames that missed a vsync, with a ceiling of 5%. The target is
unchanged — "60fps" means "does not drop frames at 60Hz" — but it is now
expressible, and the empty page is its positive control. See RC-0012.

This also means the first row of the evidence table above is misattributed:
"desktop 1x, 1 entity, DPR1 → 16.9ms" is the vsync figure, not a measurement of
the renderer. The rows that carry the argument — the DPR2 and tablet rows, all
far above 16.67ms — are unaffected, and Performance reproduced them
independently.

**The substitute budget did not measure engine cost.** It timed
`advance() + update()` once per frame; `advance()` runs `frameMs / stepMs`
steps, so the amount of simulation inside every sample was set by how long the
frame took, which the rasteriser decides. Tripling the work in every system did
not move it; halving the device pixel ratio, with the engine byte-for-byte
identical, moved it 44%. It also excluded `renderer.render`, which is where
three.js composes 400 world matrices — so the "scene-graph update" the budget
named was on the excluded side, and the renderer's load-bearing design choice
(one shared geometry and material rather than 400) was invisible to it.

Both are fixed: costs are divided by the work that produced them, and
submission is inside the boundary. Measured 4.66ms on the throttled tablet
(0.26ms per step plus 4.40ms per frame). See RC-0011.

### What this budget catches, and what it does not

Stated as a range rather than a claim, because the original claim — "fails when
that code regresses" — was contradicted by a planted regression:

- **Caught:** anything that roughly doubles the engine's per-frame cost.
- **Not caught:** a 3x regression confined to simulation, which is 5% of this
  scene's engine frame cost. A budget on the total cannot see it.
- **Not achievable here:** anything tighter. Run-to-run variance on the
  sub-millisecond components is roughly 2x on this host, so a regression
  detector below that is noise. It needs a quiet runner and is open work at P3.

The `playmode.cpuFrame.phone.reference2d` budget was **removed**. It was not in
the brief, and at 7.35ms against an 8ms ceiling its 9% margin would have flaked.
A gate that fails at random teaches people to re-run it, which is worse than not
having it.

### Why an engine-CPU budget rather than a relaxed frame rate

Lowering the frame target to what SwiftShader can manage would produce a number
that passes and means nothing — it would track the rasteriser's performance and
would not move if the engine got ten times slower at anything that is not
fragment-bound. Excluding rasterisation instead gives a budget that is entirely
about code in this repository, and that fails when that code regresses.

The ceiling is **derived**: half of a 16.67ms frame, rounded down to 8ms. The
other half must cover rasterisation, compositing, browser overhead, and the
gameplay logic a real project adds on top of everything measured here. An engine
past half the frame on its own has left no room for the game it exists to run.

### Why the median, when every other budget here gates on the tail

Cold load takes the worst of three; the frame-rate reduction takes the 95th
percentile. Both gate on the tail because there the tail is the user's
experience. This budget takes the **median**, because here the tail is the
instrument.

Five runs of unchanged code measured a p95 between 6.8ms and 8.7ms while the
median stayed between 2.5ms and 3.9ms. CDP throttling advances by periodically
sleeping the renderer, so whether a sleep lands inside a two-millisecond timed
section is close to a coin flip. A gate whose run-to-run spread exceeds the
regression it exists to catch fails for noise and passes for real regressions,
at random. The p95 is still recorded in the measurement's detail, because a tail
worth watching is not the same as a tail worth gating on.

### Consequences to be honest about

**The P1 gate does not establish that the engine renders the reference scene at
60fps on a tablet.** It establishes that the engine's own per-frame cost leaves
room to, and that the claim is tracked. DV-007 blocks the Definition of Done and
closes no phase, which is the whole reason the two registers exist.

**Rejected:** relaxing the frame target to what CI can reach (a number that
tracks SwiftShader and would not move if the engine regressed); measuring on the
unthrottled desktop profile only (loses the CPU-throttling signal, which is
real, in order to escape the GPU problem, which is not the same problem);
gating on the p95 anyway and accepting flakes (a gate that fails at random
teaches people to re-run it, which is worse than not having it).
