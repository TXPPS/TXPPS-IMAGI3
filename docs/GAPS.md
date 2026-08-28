# GAPS — claims this environment cannot verify

Every entry here is something the automated suite does **not** prove, with the
exact manual check required. Nothing in this file may be reported as a passing
gate. Entries are removed only when the check has actually been performed and
its result recorded.

---

## GAP-001 — Real iOS Safari behaviour

**Status:** open. **Blocks:** honest sign-off of the P6 gate.

The E2E phone profile is Chromium at 390x844 with touch emulation. It is not
iOS Safari. Nothing in the suite proves any of the following:

- Tab termination under memory pressure (iOS kills tabs in the 1–1.5 GB range,
  and GPU/texture memory counts against that budget while being invisible to
  `performance.memory`).
- OPFS eviction on idle, non-installed sites.
- WebAudio unlock semantics on first user gesture.
- PWA install and standalone launch from Safari's share sheet.
- Safe-area inset behaviour with the real home indicator and dynamic island.

**Manual procedure (required before claiming the P6 gate):**

1. On a physical iPhone (target: iOS 17 or newer), open the deployed editor in
   Safari and add it to the Home Screen.
2. Launch from the Home Screen icon. Confirm standalone display, no browser
   chrome, and that safe-area insets keep no control under the home indicator.
3. Open the reference project, enter play mode, and leave it running for 30
   minutes. Record peak memory from Safari Web Inspector's Timelines against
   the `playmode.heap.peak.phone` budget, and confirm the tab is not killed.
4. Background the app for 24 hours, then relaunch offline. Confirm the project
   still opens and that any evicted OPFS content is re-fetched from cloud
   rather than being reported as data loss.
5. Record results in this file and in docs/GATES.md with the device, iOS
   version and date.

---

## GAP-002 — WebGPU rendering path

**Status:** open. **Blocks:** honest sign-off of the P1 renderer parity gate.

CI runners have no GPU, and the development container has no working Docker
daemon, so the WebGPU path cannot be exercised here. WebGL2 is the primary path
per the brief, and it is the one CI will gate. WebGPU-versus-WebGL2 perceptual
parity (0.5% differing pixels, SSIM >= 0.98) is implemented and unit-tested in
`tools/audit/src/image/`, but has never been run against two real backends.

**Manual procedure:**

1. On a desktop with a GPU and a WebGPU-capable browser, run
   `pnpm test:e2e --grep parity` with the WebGPU path forced.
2. Capture the reference scene on both backends at each device profile.
3. Run the parity comparison and record diff ratio and SSIM per profile.
4. If parity fails, the renderer diverges — that is a P1 bug, not a threshold
   to relax.

---

## GAP-003 — Screenshot baselines are not locked

**Status:** open by design at P0. **Blocks:** the P3 gate.

Reference screenshots are not committed. Font rasterisation differs between the
development container and CI, so baselines captured here would fail there. See
ADR-0010.

What P0 _does_ prove: capture, PNG decode, perceptual comparison, diff-image
rendering, and that two captures of the same page in the same environment agree
under the baseline threshold.

**Measured evidence that the deferral is necessary, not convenient:**
antialiasing-susceptible edge pixels on the P0 shell are 0.55% (desktop), 0.48%
(tablet) and 0.91% (phone) of the frame — between 5x and 9x the entire 0.1%
same-backend pixel budget. A rasteriser difference between environments would
fail the gate with no real regression present.

**Two thresholds are provisional and must be calibrated when baselines land:**

- `maxLowWindowRatio` (0.0005 baseline, 0.002 parity) was chosen from synthetic
  fixtures, not from observed cross-environment noise.
- `DEFAULT_PIXEL_THRESHOLD` (0.1) is inherited from the pixelmatch algorithm
  and has never been calibrated for this content. It sets what "a differing
  pixel" even means, so the brief's "0.5% differing pixels" is only as
  well-defined as this number.

**What the damaged-window threshold buys today**, measured by fully erasing
squares of increasing size until the baseline gate fires:

| Profile               | SSIM windows | Damaged windows tolerated | Smallest wipe detected        |
| --------------------- | ------------ | ------------------------- | ----------------------------- |
| desktop 1440x900 DPR1 | 80,416       | 40                        | 24 x 24 device px = 24 CSS px |
| tablet 1200x800 DPR2  | 239,001      | 119                       | 40 x 40 device px = 20 CSS px |
| phone 390x844 DPR3    | 184,544      | 92                        | 40 x 40 device px = 13 CSS px |

All three are below the 44 CSS px minimum interactive target, so the gate
detects the disappearance of any element at or above that size on every
profile. Whoever recalibrates at P3 should know what regression size a looser
threshold trades away.

**Procedure to close (do this when starting P3):**

1. Run the E2E suite inside `mcr.microsoft.com/playwright:v1.56.1-noble`, the
   same image `.github/workflows/ci.yml` already uses, with
   `UPDATE_BASELINES=1`.
2. Commit the generated `tests/e2e/baselines/**` from that run only.
3. Re-run without `UPDATE_BASELINES` on a _different_ machine and record the
   observed diff ratio, mean SSIM and damaged-window ratio for an unchanged
   page. Those are the real noise floors; set the thresholds above them with
   margin, and record the numbers here.
4. Add antialiasing detection to the pixel diff if step 3 shows edge noise
   dominating, rather than widening the threshold to absorb it.

---

## GAP-004 — Android tablet hardware

**Status:** open. **Blocks:** honest sign-off of the P5 gate.

The tablet profile is an emulated viewport with touch enabled. It does not
prove touch latency, pointer-event coalescing under a real digitiser, on-screen
keyboard behaviour, or GPU limits on mobile hardware.

**Manual procedure:** on a physical Android tablet, run the P5 touch audit
checklist — gizmo hit areas at >= 44 px, no panel occluded by the on-screen
keyboard, pinch/rotate gestures on the viewport, and a 30-minute play-mode soak
with `chrome://tracing` frame timings recorded against the tablet budgets.

---

## GAP-005 — Sync against real Cloudflare infrastructure

**Status:** open, not yet reached. **Blocks:** the P4 gate.

Durable Object, R2 and D1 behaviour will be exercised against local emulation
first. Real-network partition behaviour, DO eviction mid-write, and R2
consistency under concurrent multi-device writes need a deployed environment.

**Manual procedure:** to be written when P4 starts. It must cover at minimum:
disconnect mid-write, two devices editing offline then reconnecting, and an
asset upload interrupted partway.

---

## GAP-006 — Performance measurements are device-labelled but not device-representative

**Status:** NARROWED in P1-PRE, still open. **Blocks:** honest sign-off of any
device-specific performance claim, including the P5 and P6 gates.

**What P1-PRE fixed**, at the second attempt. The first attempt did not: CPU
throttling was applied to Playwright's fixture page while the cold-load spec
measured pages it opened itself, so every device-named budget was still taken at
full desktop speed. The independent Performance review caught it. See RC-0006.

As it now stands: the tablet and phone profiles run under CPU throttling
requested at 4x and 6x; every page the harness measures is opened through a
fixture that throttles it and then verifies the throttling on that page; each
measurement records the ratio observed, and the budget gate rejects a
device-scoped measurement whose ratio is missing, or below the slowdown that
budget needs in order to fail for the reason it names — the ratio between its
ceiling and the unthrottled ceiling, which for the cold-load budgets is 2.0x.
The achieved slowdown varies with host and contention: the calibration bench
reports 4.3x and 6.5x, while per-run evidence on a contended four-core host
records 3.7x-4.6x for the tablet and 4.6x-6.0x for the phone. That evidence is
the median of the per-page observations — the minimum reads as low as 1.96x on a
genuinely throttled page when a baseline draw is unlucky, and the maximum
flatters.
`pnpm audit:profile-ordering` separately asserts the profiles come out in the
right order, and removing throttling collapses every ratio to 1.00x and fails
it. The unthrottled desktop budget was renamed `ci-headless.editor.coldLoad`,
and the real desktop claim moved to the DEVICE-VERIFIED register as DV-004. A
planted fixed-work CPU regression, sized per host, passes the unthrottled budget
and breaches the throttled ones. See ADR-0011.

**What remains open**, and it is still substantial:

`editor.coldLoad.tablet` and `editor.coldLoad.phone` are named for devices but
are still measured on desktop-class hardware wearing a CPU handicap. Throttling
makes the profiles genuinely different from each other; it does not make either
of them a device.

Four specific limits:

1. **No network throttling.** CPU throttling is now applied;
   `Network.emulateNetworkConditions` is not. A phone on a real network pays
   latency this harness never sees.
2. **Loopback server.** `vite preview` over 127.0.0.1 pays no DNS, TLS, or
   real-network latency, and its cache headers are not a deployed editor's.
3. **The measurement anchors on first contentful paint, not interactivity.**
   Cold load is `max(readiness mark, first contentful paint)`. Work deferred
   past first paint — into a microtask, an idle callback, or a later frame — is
   not counted. There is no long-task observation yet.
4. **Worst of three samples per profile**, with no percentile and no run-to-run
   variance tracking. Adequate while measurements sit far inside their ceiling;
   not adequate once a budget becomes load-bearing.

**Consequence:** a green `editor.coldLoad.phone` row means "the shell loads
quickly on a developer machine at phone viewport". It does not mean the editor
loads within 6 s on a phone.

**Manual procedure (required before claiming any device performance gate):**

1. Serve a production build over a real network, not loopback.
2. On the physical device, load the editor with the browser's performance
   profiler recording. Record time to first contentful paint and to
   interactivity, plus any long tasks after paint.
3. Compare against the same budget id the emulated harness reports, and record
   both numbers side by side so the emulation error is visible rather than
   assumed.

**Remaining cheap mitigation, worth doing before P5:** apply a network profile
alongside the CPU throttling that now exists. That still is not the device, but
latency is the largest remaining emulation error for a cold load.

---

## GAP-007 — The planted-fault proofs run against the dev server

**Status:** open, structural. **Severity:** low, but worth stating.

Fault injection exists only in development builds by design (ADR-0009), so both
`tests/e2e/planted-fault.spec.ts` (slow boot) and
`tests/e2e/planted-perf.spec.ts` (the P1-PRE throttling proof) provoke their
faults against the dev server on port 5173, while the gated cold-load
measurement runs against the production preview on 4173.

Those tests prove the budget _checker_ rejects an over-budget value in a real
browser, and — for the perf proof — that the verdict differs by throttling.
Neither proves the production measurement pipeline would carry such a value
through to the gate. The dev server is also the slower environment, which cuts
the safe way for the throttled legs and the unsafe way for the unthrottled one.

**To close:** once the editor has a real feature surface (P3), add a deliberate
regression to a production build behind a build-time flag and confirm the gate
fails on the preview path.

---

## GAP-008 — Safe-area insets are declared but never exercised

**Status:** open. **Blocks:** the P5 and P6 layout gates.

`apps/editor/src/styles.css` uses `env(safe-area-inset-*)` for the shell
padding. On all three emulated profiles those resolve to `0px`, so a misspelt
property name, a wrong fallback, or padding applied to the wrong element would
be indistinguishable from correct behaviour. This is not iOS-specific — the
declaration is untested on every platform the suite runs.

**Manual procedure:** load the editor on a device with real insets (an iPhone
with a home indicator, or Chrome DevTools device emulation with insets forced)
and confirm no control sits under the indicator or the status bar in both
orientations.

**Cheaper partial check, worth adding at P5:** override the inset custom
properties with non-zero values in a test-only stylesheet and assert the shell
padding responds. That proves the wiring without proving the platform.

---

## GAP-009 — The touch target audit does not exist yet

**Status:** open by design until P5.

The brief requires interactive targets of at least 44 CSS pixels on touch
profiles. No such audit is implemented, and the P0 shell has no interactive
controls to audit — its only non-text element is a non-interactive status
badge. A constant asserting the 44px rule was removed rather than left standing
as an unenforced claim.

**To close:** implement the audit as part of the P5 tablet shell, running over
every focusable and pointer-interactive element at both touch profiles.
