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
