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
