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
