# BUGS

Open defects and root-cause records. Severity: P0 blocks the phase gate, P1
blocks the next phase, P2 is scheduled, P3 is opportunistic.

## Open

None.

## Root-cause records

Entries land here when a fix took three attempts or when the cause is worth
remembering. Format: what broke, why, what changed, how it is now prevented.

### RC-0001 — Perceptual diff read mid-grey inversion as "unchanged"

**Found:** P0, while writing the image comparator's own tests.
**Severity:** P2 (test-helper defect, never shipped).

A test helper perturbed pixels by inverting each channel. For a mid-grey source
(128) that produces 127 — a perceptual delta far below the threshold — so a test
that believed it had changed 100 pixels had actually changed none, and the
assertion it made was vacuous.

**Cause:** the helper encoded "different" as "arithmetically different" rather
than "perceptually different", which is the property the comparator is defined
against.

**Fix:** the helper now repaints pixels in a guaranteed high-contrast colour
chosen from the source luma, so a perturbation is always above threshold.

**Prevention:** the harness self-test (`tools/audit/test/selftest/`) asserts
both halves of every detector — that it catches the planted defect _and_ that it
stays green on the clean counterpart. A helper that silently perturbs nothing
now fails the "catches" half.

### RC-0002 — A "production bundle" assertion that built a development bundle

**Found:** P0, on the first run of the test that enforces ADR-0009.
**Severity:** P1 (would have made a shipped-artifact guarantee unverifiable).

`apps/editor/src/dev/plant.ts` injects deliberate faults and must never reach a
production build. ADR-0009 claims the elimination is asserted rather than
assumed, so a test builds the app and greps the output. The first version of
that test used Vite's programmatic `build()` and failed, emitting the fault
module as a lazy chunk — even though the real `vite build` strips it correctly.

**Cause:** Vite derives `import.meta.env.DEV` from `NODE_ENV` before falling
back to the build mode, and Vitest sets `NODE_ENV=test`. The programmatic build
therefore produced a _development_ bundle. Had the guard been written slightly
differently, this test would have built a development bundle, found nothing,
and reported the production bundle clean — a false green on the exact property
it exists to protect.

**Fix:** the test forces `NODE_ENV=production` around the build and restores it
afterwards, and inspects every emitted chunk rather than only the entry chunk,
because the injector is dynamically imported.

**Prevention:** a paired assertion requires the shell's own markers
(`i3-shell`, `imagi3:ready`) to be present in the same output. An empty or
wrong-target build now fails loudly instead of vacuously passing the
"contains nothing bad" half.

**Wider lesson:** "assert the absence of X" is only meaningful alongside
"assert the presence of Y" from the same artifact. This is the same shape as
the audit harness self-test, which checks both that a detector catches a
planted defect and that it stays green on the clean counterpart.

### RC-0003 — Mean SSIM diluted a deleted control into a passing score

**Found:** P0, by the Visual QA review of the screenshot comparator.
**Severity:** P1 (a gate that could not catch the regressions it existed for).

The comparator gated on mean SSIM against the brief's 0.98 threshold. Measured
against this project's own shell, deleting the status badge entirely scored a
mean SSIM of **0.9977** — comfortably passing — while the worst 8x8 window
scored **0.013**. Of 21 planted single-property regressions across three
profiles, the mandated threshold pair caught **3**. It missed element deletion,
font-weight change, colour drift and background gamma shift on every profile.

**Cause:** a 1440x900 frame yields roughly 80,000 SSIM windows. Averaging
divides any localised structural collapse by 80,000. The signal was present in
the SSIM map and the reduction to a mean discarded it. The threshold was not
wrong; the statistic was.

**Fix:** the comparator now also gates on the fraction of windows scoring below
a severe-damage floor. That floor (0.90) is deliberately well below the
whole-frame threshold (0.98) — with both at 0.98 the mean gate becomes
unreachable, since a mean under 0.98 implies many windows under 0.98, and one
gate silently subsumes the other.

**Prevention:** the harness self-test now pins one regression per gate in which
the other two stay inside their bounds. Deleting any single gate makes exactly
one scenario start passing. This was verified by mutation: each of the three
branches was replaced with `if (false)` in turn, and each produced a distinct
self-test failure.

**Wider lesson:** a threshold is only as good as the statistic it is applied
to, and "we implemented the mandated threshold" is not evidence the mandate is
being enforced. The question to ask of any gate is not "is the number right"
but "construct the regression this gate exists to catch, and watch it fire".

### RC-0004 — CI enforced a budget that CI never measured

**Found:** P0, by CI, on the first run after `editor.bundle.gzip` moved to P0.
**Severity:** P2 (a red build, correctly red).

`pnpm sweep` runs `build`, then `audit:bundle`, then the E2E suite, then the
budget gate. The CI workflow ran only the E2E suite and then the gate, because
it had been written when every enforced budget came from a browser measurement.
Moving the bundle budget from P3 to P0 added a measurement that no CI step
produced, and the gate failed the run with `editor.bundle.gzip — enforced from
P0 but no harness reported a value`.

**Cause:** two pipelines, `sweep` and the CI workflow, encoded the same ordering
independently, and only one was updated.

**Fix:** the CI job now mirrors `sweep`'s ordering explicitly, with a comment
saying why the build and bundle steps must precede the gate.

**Worth noting:** nothing here was a defect in the harness. The gate refused to
report green for a budget nobody measured, which is precisely the behaviour
ADR-0006 specifies, exercised for the first time in production rather than in a
fixture. The failure was the system working.

**Prevention (open):** `sweep` and the CI workflow still encode the ordering
twice. The durable fix is for CI to invoke `pnpm sweep` directly once the suite
is slow enough to justify the job split differently; recorded here rather than
done now, because the current split gives faster feedback on static analysis.

### RC-0005 — Edits reported as applied that silently did nothing

**Found:** P0, by the QA Automation re-verification.
**Severity:** P1 (a defect stayed in the tree while the record said it was fixed).

Two source edits and two documentation edits were written as exact-string
replacements. In each case the formatter had reflowed the surrounding lines
between the moment the anchor text was read and the moment the replacement ran,
so the anchor no longer matched and the replacement did nothing. Nothing failed,
because a string replacement that matches nothing is not an error.

The consequences were worse than the missing edits:

- A vacuous assertion in `tests/e2e/planted-fault.spec.ts` — one that passes
  regardless of the fault it claims to detect — stayed in the tree while both
  `docs/GATES.md` and a commit message recorded it as fixed.
- The sign-off rows in `docs/GATES.md` continued to read PASS after being
  "changed" to PENDING, and that stale PASS was then quoted to the reviewer as
  evidence that the row was pending.

**Cause:** a write that cannot fail, used for an edit that can. The formatter
runs between edits, so any anchor captured before a format pass is unreliable.

**Fix:** every scripted replacement now asserts its anchor matched before
writing, so a stale anchor is a loud failure instead of a silent no-op. Where a
target is a formatted table row, the edit matches the row by its leading cell
rather than by exact whitespace.

**Prevention:** re-read the region after an edit that matters, and never report
an edit as applied on the strength of the command having exited zero. The
review caught this; the tooling should have.

### RC-0006 — Throttling applied to a page the gate never measured

**Found:** P1-PRE, by the independent Performance review.
**Severity:** P0 (the gate's entire subject matter was unfixed while reported fixed).

P1-PRE existed to fix one defect: budgets named for a tablet and a phone were
measured on unthrottled hardware, proven at P0 by the phone profile measuring
_faster_ than the desktop profile. CPU throttling was added, calibrated, given a
self-test, given a planted-regression proof, and recorded as closed.

**The throttling never reached the budgets.** CDP throttling is per-page. The
fixture applied it to Playwright's `page`, but `sampleColdLoad` opened its own
pages with `context.newPage()`, which inherit nothing. Every cold-load
measurement — all three device-named budgets, the whole point of the gate — was
taken at full desktop speed. The reviewer measured it directly: a throttled page
at 4.75x, a page from `context.newPage()` on the same context at 1.02x.

The fixture's own docstring stated the contract the spec broke: _"Fresh pages
opened inside a test must call `applyCpuThrottling` themselves."_ Nothing did.

**Why every guard stayed green.** The profile-ordering self-test and the
planted-regression proof both ran on the fixture page, which _was_ throttled.
Each was individually load-bearing — the reviewer confirmed both fail when the
rates are forced to 1 — and both were verifying a code path the gate did not
use. A mutation test can only tell you about the path it exercises.

**Fix, in three layers, because one was what failed:**

1. Pages are opened through an `openPage` fixture that throttles them. Removing
   the opportunity to forget, rather than documenting the requirement.
2. Throttling verifies itself on the page it is applied to: the same workload
   runs before and after, and a slowdown that never arrives throws.
3. The budget gate refuses a device-scoped measurement that cannot show the page
   it came from was throttled. `throttleRatio` is recorded with each
   measurement, and a missing or near-1.0x ratio is a new failing status,
   `unthrottled`, alongside `unmeasured`.

Layer 3 is the one that matters. Layers 1 and 2 live inside the code path being
checked — the first mutation test proved it, because deleting the throttling
from `openPage` deleted its verification too and the suite stayed green. The
gate checks the _artifact_: a number that cannot evidence its own provenance is
rejected regardless of what produced it, or failed to.

**Wider lesson, and it is the same one as RC-0003 and RC-0002 in a new
costume:** a guard that lives in the path it guards can be removed by the same
edit that introduces the defect. Ask not "does this check fire when I break the
thing" but "does this check survive an edit that removes both the thing and the
check". Assertions about an artifact survive that; assertions inside a helper do
not.

**Which guard covers which failure**, because "three layers" is not a plan
unless each layer's scope is stated:

| Failure                                                        | Caught by                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A page is measured that nobody throttled                       | The spec demands a throttling record of the page it measured; absence fails there.                                                                                                                                       |
| Throttling is requested but does not take effect               | The page-level verification measures the same workload before and after and throws when the slowdown does not arrive.                                                                                                    |
| A measurement reaches the gate with no evidence, or too little | The budget gate's `unthrottled` status, in a different module and a different process from anything that produced it.                                                                                                    |
| The declared rate is meaningless (a profile set to 1x)         | _Not_ the evidence check, which exempts unthrottled profiles by design. Covered by the naming-honesty test and the ordering gate.                                                                                        |
| The evidence itself is fabricated                              | Nothing. A number in a JSON file cannot attest itself. This is the floor of artifact checking, and the honest statement is that forging it now takes deliberate edits in three files rather than one plausible omission. |

The stronger bound available, recorded for when the app is substantial enough
to support it: assert the cross-profile relation on the budget artifacts
themselves — the tablet's cold load over the unthrottled profile's must exceed
the same 2.0x — because those are independently produced timings rather than a
self-reported field. It is not a gate today because cold load on a near-empty
shell is dominated by fixed overhead that throttling does not touch, so the
ratio would measure the harness rather than the app.

---

## RC-0007 — The console guard was opt-in, and absent from nine of thirteen specs

**Found by:** the guard audit mandated in this session, not by a failure.
**Severity:** high. **Status:** fixed.

Playwright instantiates a fixture only for tests that destructure it. The
`incidents` fixture — which captures console errors, uncaught exceptions and
unhandled rejections, and asserts at teardown that none escaped the allowlist —
was an ordinary fixture. Four specs asked for it. Nine did not, and for those
nine the guard did not exist.

Nothing reported this. The four that asked for it passed, the suite was green,
and the fixture's own documentation said it ran everywhere. The layout tests,
the manifest test, every visual test and the cold-load measurement could all
have been throwing exceptions into the console for the whole of P0 and P1-PRE
without a single red run.

**Why the audit found it and testing did not.** Every test of this guard tested
it on a page that had requested it. The question the audit asks is different:
not "does the check fire when the thing breaks" but "is the check present at
all in the paths that matter". A guard cannot be shown to work by exercising
only the places it runs.

**Fix:** the fixture is `auto`, so it runs for every test in the suite and
opting out is explicit and rare — only the planted-fault proof does it, and
only to assert the guard's verdict directly instead.

**The mutation is permanent, not a one-off run.** An expected-to-fail test in
`planted-fault.spec.ts` plants a console error _without_ destructuring the
fixture. Today it fails, which is the guard firing on a spec that never asked.
Remove `auto` and it asserts nothing, passes, and Playwright fails the run for a
test that was expected to fail and did not. Verified in both directions.

**Wider lesson, and it is a corollary of RC-0006 rather than a new one:** an
opt-in guard is absent wherever nobody opted in, and its absence is invisible
precisely where it matters. Anything that must hold for every test belongs in
the harness's automatic path, with opting out visible in the test that does it.

---

## RC-0008 — `addEntity` is quadratic, and the editor is its only caller

**Found by:** a 10,000-entity round-trip test taking over half a minute.
**Severity:** medium now, **blocking at P3**. **Status:** open, mitigated.

Each `addEntity` call copies the entity map and rescans the sibling list to
place a new ordering key, so building n entities one at a time is O(n²). Ten
thousand took over 36 seconds.

`sceneFrom` was added for bulk assembly and the test suite now uses it, which is
what made this stop being an immediate problem. **That mitigation does not
reach the editor.** The editor applies one user action at a time and therefore
uses the incremental path by construction — paste a subtree, import a tilemap,
duplicate a selection, and it is `addEntity` in a loop on a document that may
already hold ten thousand entities. Documenting an O(n²) API does not make it
shippable; it makes it a known defect with a comment attached.

**Why it is not fixed now.** The right fix depends on a decision P3 has not
taken: whether the editor holds a mutable working document with an index and
serialises on save, or stays fully immutable and gains a persistent map. The
first is simpler and faster; the second composes with the undo stack and the
sync layer without a second representation. Choosing now, before either the undo
stack or Yjs exists, would be choosing on a guess.

**P3 gate condition, which this entry blocks:** a bulk editor operation on a
10,000-entity scene — paste of a 500-entity subtree is the reference case —
stays within `editor.frameSpike.max` under the throttled tablet profile. The
budget already exists and is enforced from P3; what is missing is a harness that
drives the operation. That harness is part of closing this entry, not a separate
task, because a performance claim with no measurement behind it is what this
project has repeatedly had to unlearn.

---

## RC-0009 — Deleting every draw call in the engine left the whole suite green

**Found by:** Visual QA at the P1 gate, by mutation. **Severity:** high.
**Status:** fixed.

The mutation was one line — replacing the body of `SceneView.present` with
nothing, which removes every draw call the engine makes:

```ts
present: () => {
  /* MUTATION: draw nothing at all */
},
```

Under it: **732 unit tests passed, 62 end-to-end tests passed across three
device profiles**, and the page rendered 3,840,000 pixels of exactly one colour.
The suite could not tell a working renderer from a blank canvas.

**Why nothing caught it.** Every guard on play mode lived _upstream of
rasterisation_: a `data-backend` attribute, a simulation step count, an entity
count, and a CPU timing that deliberately excludes `present()`. All four are
satisfied by a renderer that draws nothing. `visual.spec.ts` has an assertion
named "renders content rather than a blank frame" — pointed at the static editor
shell, not at the renderer. And `data-app-playing` is set unconditionally inside
the animation callback after `present()` returns, so it attests that a frame
callback ran, not that anything was drawn.

**This is RC-0002, RC-0006 and RC-0007 at subsystem scale.** RC-0002: assert the
absence of something only alongside the presence of something from the same
artifact. RC-0006: a guard upstream of the thing it guards survives the thing's
deletion. RC-0007: a guard is absent wherever nobody wrote one, and the absence
is invisible exactly where it matters. P1's headline claim was that a real
renderer exists, and the evidence offered was a green suite that a no-op
renderer also turns green.

**Fix:** `tests/e2e/render.spec.ts` asserts properties of the rendered frame on
every device profile — sprite pixel coverage above a floor derived from the
scene, more than one distinct colour, two captures separated in time that
differ, a square world quad drawn square, and content reaching the far half of a
rotated viewport. Deliberately not baseline comparisons: ADR-0010's deferral of
committed baselines is about font rasterisation differing between environments,
and none of these invariants need environments to agree about antialiasing.

**Wider lesson.** "We do not have baselines yet" was allowed to stand in for "we
have no visual assertion of any kind". Those are different, and the cheap one
was available the whole time. When a subsystem's coverage is deferred, write
down what is still being asserted about it — if the answer is nothing, that is
the finding.

---

## RC-0010 — Two doc comments asserted things that were not true of the code

**Found by:** Visual QA at the P1 gate, by checking claims against the tree.
**Severity:** medium. **Status:** fixed.

Two headers in `packages/render` made checkable claims that were false.

`parity.ts` said:

> The comparison itself is real and runs today: two WebGL2 renders of the same
> scene are compared with the same comparator and thresholds the WebGPU leg
> will use... it is wired, exercised and known to work.

Nothing called `judgeParity` outside its own unit test. The module and the
comparator had never met. `docs/GAPS.md` GAP-002 then instructed a future
engineer to run `pnpm test:e2e --grep parity`, which matched zero tests.

`webgpu.ts` said the leg was _"wired"_ and that _"the import happens, the
renderer is constructed, and its asynchronous initialisation is awaited"_, and
that the bundler _"splits it into a chunk fetched only when a device actually
has an adapter"_. It had no caller, no test, and appeared in **no emitted
chunk** — it was tree-shaken out entirely. Its `render()` throws
unconditionally. The commit message that introduced it repeated the claim:
"genuinely wired behind a dynamic import rather than stubbed".

**Why this is RC-0005 in a new place.** RC-0005 was a fix recorded as landed
before it landed, and the remedy was the claims ledger — but the ledger checks
that a _commit touches a path_, which both of these did. A claim about what code
_does_ is not covered by it, and this is the failure mode that remains.

**Fix:** both headers now state what is true, including that the WebGPU draw
path is unimplemented, and the parity harness has a real caller
(`tests/e2e/render.spec.ts`) that makes its claim true rather than aspirational.
GAP-002 and DV-001 now record that two things block WebGPU parity — missing
hardware _and_ missing code — rather than only the first.

**The check that would have caught both, now mechanical rather than a habit.**
`pnpm verify:assertions` fails the build for a comment that claims a runtime
property without naming a spec path, a test, or a CI job, and for a reference
naming something that does not exist. It found a live one on its first run: the
corrected `parity.ts` header cited `tests/e2e/parity.spec.ts`, a file that has
never existed — RC-0010 recurring inside the fix for RC-0010, which is the whole
argument for checking references with a program instead of with care.

It does not check that the named test proves the claim. That is still review's
job; what changed is that review now looks at six sentences rather than at every
comment in the tree.

---

## RC-0011 — The engine frame budget measured the rasteriser it claimed to exclude

**Found by:** QA Automation at the P1 gate, by mutation. **Severity:** high.
**Status:** fixed, with a stated residual limit.

`playmode.cpuFrame.*` was offered in ADR-0015 as the CI-measurable substitute
for a frame-rate budget that cannot be measured without a GPU. Its whole claim
was that it is _"entirely about code in this repository, and fails when that
code regresses"_. It did not.

| Mutation                                             | Measured       | Verdict                              |
| ---------------------------------------------------- | -------------- | ------------------------------------ |
| baseline                                             | 2.50 – 3.90 ms | —                                    |
| every system **3x** per fixed step                   | 3.80 ms        | **passed**, inside the baseline band |
| every system **5x** per step                         | 5.30 ms        | **passed**                           |
| scene-graph update **15x** per frame                 | 5.70 ms        | **passed**                           |
| `MAX_PIXEL_RATIO` 2 → 1, **no engine change at all** | 2.50 → 1.40 ms | **−44%**                             |

**The mechanism.** `cpuMs` was timed once per frame around
`session.advance() + view.update()`. `advance()` runs `frameMs / stepMs` steps —
so the amount of simulation inside every sample was set by how long the frame
took, which in CI is set by SwiftShader. The rasterisation the budget was
defined to exclude walked back in through the step count. The same device-pixel-
ratio lever GAP-011 cites as proof that the _frame_ budget measures SwiftShader
moved the supposedly-excluded budget by nearly half.

Worse, and worth recording separately: the phone profile is throttled 6x against
the tablet's 4x and measured **faster**. A more-constrained profile reading
faster is the exact signal that exposed the P0 defect and caused P1-PRE to
exist. It was present again, in a new budget, and nobody looked.

**Fix.** Simulation and scene-graph update are timed separately, and the step
count travels with them. The gate divides each cost by the work that produced it
— a step costs what a step costs however many a frame affords, and an update
happens exactly once per frame at any cadence — and reports the sum, which is
what a frame would cost if the display ran at the simulation rate.

**The residual limit, measured rather than assumed.** Repeating the DPR control
against the new statistic moved it 25% rather than 44%. It is not zero and
cannot be: `performance.now` is wall clock, and timing a main-thread section on
a host whose rasteriser threads are saturated measures contention as well as
work. No restructuring of the statistic removes that; only a per-thread CPU
clock would, and browsers do not expose one.

So the budget is sound as a **shippability bound** — 1.07 ms measured against an
8 ms ceiling — and its resolution is stated rather than implied: **it cannot
distinguish a regression smaller than about 30%.** A tighter regression detector
needs the noise floor characterised on a quiet CI runner first, and is open work
for P3, alongside RC-0008's harness.

**Wider lesson.** ADR-0015 argued a deferral was legitimate _because_ a
substitute budget covered what could still be covered. That argument is only as
good as the substitute, and nothing had tested the substitute against a planted
regression — the audit self-test was never extended past P0's eight detectors.
A budget introduced to justify deferring another budget needs a planted
regression on the day it lands, not on the day someone gets round to it.

---

## RC-0012 — The deferred budget could never have passed, on any hardware

**Found by:** Performance at the P1 gate, with a positive control.
**Severity:** high. **Status:** fixed.

`playmode.fps.tablet.reference2d` was declared `min: 60`, deferred to P9 as
DV-007, and defended in `real-config.test.ts` with a test named _"keeps the full
60fps target rather than a relaxed one"_ — offered as evidence that deferring
the measurement had not lowered the bar.

The bar was not merely high. It was unreachable.

The rate was derived from the 95th-percentile interval between
`requestAnimationFrame` callbacks, and that interval is set by the compositor's
60Hz frame source, not by the engine. Performance measured a `data:` page
containing nothing but an empty rAF loop — no WebGL, no engine, no scene, no
throttling, on a quiet host:

```
min 16.30   p05 16.50   median 16.70   p95 16.90   max 17.10 ms
-> 1000 / 16.90 = 59.2 fps
```

**A budget no empty page can satisfy is not a demanding budget; it is a
statistic the instrument cannot express a pass for.** Two consequences, and the
second is worse than the first:

1. The budget could only ever have failed, on a flawless device.
2. GAP-011's manual procedure for closing DV-007 said _"confirm the p95
   whole-frame duration is at or under 16.67ms"_. Run on a perfect iPad with a
   60Hz display, that reads ~16.9ms and fails. **A deferral to a procedure that
   cannot be discharged is a permanent hold recorded as a temporary one.**

It also means ADR-0015's first evidence row — "desktop 1x, 1 entity, DPR1 →
16.9ms p95 → 59.5 fps", presented as a measurement of the renderer under
SwiftShader — is, to two decimal places, the empty-page vsync figure. The rows
that carry the argument are all far above 16.67ms and are unaffected.

**Fix.** The budget is now the **fraction of frames that missed a vsync**,
capped at 5%, with a frame counted as missed past 1.5 refresh intervals. The
target is unchanged: "60fps" means "does not drop frames at 60Hz", and this
measures exactly that. What changed is that it can now be satisfied — the empty
page drops none, and that run is committed as the statistic's positive control.

**Wider lesson, and it generalises past this budget.** Every guard in this
project is tested by planting a defect and checking it fires. Nothing was tested
by checking it could _pass_. A gate needs both controls: a run that fails it and
a run that does not. The negative control alone cannot distinguish "correctly
strict" from "impossible", and impossible is the more expensive of the two,
because it is discovered by whoever finally gets the hardware.

---

## RC-0013 — The canvas sized the container that sized the canvas

**Found by:** the rotation test written to close RC-0009, on its first full run.
**Severity:** medium. **Status:** fixed.

`renderer.setSize(w, h, false)` — `updateStyle` off — leaves the canvas with no
CSS size, so its **attribute** size becomes its intrinsic layout size. The
editor shell's root is `min-height: 100%`, so it grows with its content, and the
content was a canvas whose size was being set from the root's observed box.

Rotating the phone profile walked the loop: root 390x844, rotate to 844x390,
observer fires, backing store grows, canvas's intrinsic CSS size grows, root
grows to fit it, observer fires again. It settled at a root **1827px tall inside
a 390px viewport**, with the scene centred in the canvas and therefore entirely
below the fold. The screenshot contained not one sprite pixel.

**Fix.** `updateStyle` left on, so the canvas's CSS size is pinned in pixels to
the box it was measured from; and play mode pins the root to `100dvh` with
`overflow: hidden` while it owns it, so the container follows the viewport
rather than its content. Either alone would break the cycle; both are correct
independently.

**Worth recording for one reason.** The `false` was deliberate and had a comment
justifying it — avoiding a style write per resize. It was right about the cost
and wrong about the consequence, and no amount of reading would have found it:
the bug only exists when something _observes_ the container, which was true for
about twenty minutes before the rotation test existed. The test written to close
one finding found a second one on its first run, which is the argument for
writing the test rather than reasoning about the code.

---

## RC-0014 — Two source files edited through shell heredocs, against S2

**Found by:** self-report, then confirmed against the transcript.
**Severity:** medium. **Status:** rule extended, violations logged.

S2 bans shell-mediated source edits because `sed` and a heredoc cannot report
that they changed nothing — the mechanism behind RC-0005. The ban was
implemented as a lint check over committed shell and CI files
(`tools/repo/src/no-shell-edits.ts`), and that check cannot see how the work is
actually done. Two edits went through `python3` heredocs anyway:

| Edit                                                       | File                                     | Consequence                                                                              |
| ---------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Replacing `throttleRatio` with `throttle` in a test        | `tools/audit/test/budgets/check.test.ts` | None observed                                                                            |
| Reverting a device-pixel-ratio mutation via `git checkout` | `apps/editor/src/playmode/index.ts`      | **An unrelated in-flight change was destroyed** and had to be reconstructed from scratch |

The second is the instructive one. It was not the heredoc that lost the work —
it was reaching for a whole-file shell operation on a file with uncommitted
changes in it, which is the same class of move and the same absence of a
read-back.

**Why the rule did not stop it.** The lint check inspects artifacts, and a
transcript is not an artifact. There is no mechanical guard here and there
cannot be one from inside the repository; the rule now says so plainly rather
than implying the check covers more than it does.

**Rule, extended and stated in `docs/ARCHITECTURE.md`:** no source file is
edited through any shell-mediated mechanism — heredoc, `sed`, `awk`,
`python3 -c`, `node -e`, or a whole-file `git checkout` over uncommitted work.
Edits go through a tool that reads back what it wrote, or through a committed
script that can be reviewed. **This governs how the work is done, not only what
is committed.** Shell use for reading, searching and running is unaffected.

**Related:** SEC-0001. A session mode was simultaneously directing that edits be
made exactly this way, which is context worth having, and is not an excuse — the
operator instruction was explicit and the precedence rule is now written down.

---

## RC-0015 — Two coverage holes the guard audit could not have found

**Found by:** the first run of `pnpm mutation:sweep`. **Severity:** medium.
**Status:** both closed, with the missing assertions named and written.

The guard audit reasons outward from detectors that exist. The mutation sweep
reasons inward from production code, and on its first run found two exports that
could be neutered with no test noticing.

**`lowestId` losing its sort** (`packages/core/src/graph.ts`). Cycle repair
breaks each cycle at its lowest entity id, which is the property that makes two
peers converge. Removing the sort left the whole suite green — because in every
existing test the walk entered the cycle _at_ a cycle member, and the entry
point was therefore already the lowest id. The two diverge only when the walk
enters from outside: a leaf hanging off the cycle is reached first, and the cycle
array then begins at whichever member the leaf pointed into.

Missing assertion, now written: a four-entity document where `en_a` is a leaf
parented to `en_d` and the cycle is `en_b → en_c → en_d → en_b`. The walk enters
at `en_d`; the lowest member is `en_b`. Unsorted, the repair detaches the wrong
entity.

**Velocity absent from the state hash** (`packages/runtime/src/hash.ts`).
Dropping `vx` and `vy` from the hashed fields left the determinism suite green.
Ten thousand ticks compared by a hash blind to velocity would report agreement
between two runs that had diverged in exactly the quantity that produces the
next tick's positions.

Missing assertion, now written: `packages/runtime/test/hash.test.ts`, one case
per field. One test varying everything at once would pass with three of the four
fields hashed, which is the shape of the hole it exists to close.

**Wider lesson.** Both were in code the guard audit had already looked at and
signed off, and both were in `packages/core` and `packages/runtime` — the two
packages three reviewers independently called well-guarded, where QA Automation
killed 22 of 22 mutations it tried. The mutations it tried were not these. That
is not a criticism of the review; it is the argument for the sweep being
exhaustive over exports rather than selective over suspicions.
