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
per the brief, and it is the one CI gates.

**Two things block this, not one.** The entry previously said the comparator was
implemented and only hardware was missing. Visual QA showed that understated it,
and the correction is the useful part of this entry:

1. **No hardware.** As above.
2. **No WebGPU draw path.** `packages/render/src/webgpu.ts` constructs and
   initialises the three.js WebGPU renderer, and its `render()` throws
   unconditionally. It has no caller, no test, and is tree-shaken out of every
   emitted chunk. Given a GPU tomorrow, step 2 below is still impossible. The
   code, not the hardware, is the part this repository controls.

**And the comparator has a measured blind spot on renderer content.** The three
gates were calibrated against the editor shell — text and antialiased chrome.
The renderer draws flat-shaded quads on a flat field, and on that content Visual
QA measured, with zero rasterisation noise:

| Change to sprite colour | Verdict | diff  | mean SSIM | damaged windows |
| ----------------------- | ------- | ----- | --------- | --------------- |
| green +37/255           | PASS    | 0.00% | 0.99788   | 0.00%           |
| all channels +24        | PASS    | 0.00% | 0.99823   | 0.00%           |
| chroma rotated ±30      | PASS    | 0.00% | 0.99994   | 0.00%           |
| every sprite → white    | fail    | 11.9% | 0.98931   | 0.00%           |

Sprite colour may drift by up to **14.5% on a channel** and pass all three
gates. Repainting every sprite pure white — the loudest colour regression short
of erasing them — leaves both SSIM gates untripped, because SSIM measures
structure and a uniform level shift over sparse flat regions barely moves it.
Only the per-pixel gate fires, and on this content it is a step function whose
trip point is the uncalibrated `DEFAULT_PIXEL_THRESHOLD` (GAP-003).

That matters precisely here: **different sRGB or output-colour-space handling
between WebGL2 and WebGPU is the most likely real divergence between the two
backends**, and it is the class of difference these thresholds cannot see. The
control holds — erasing 1 sprite in 400 is caught by two gates — so the failure
is confined to colour.

**Manual procedure:**

1. Implement the WebGPU draw path, and wire `hasWebGpu(navigator)` into
   `probeCapabilities` together with a fallback. Note the trap recorded in
   `webgpu.ts`: this container exposes `navigator.gpu` while `requestAdapter()`
   returns null, so the two changes must land together or play mode hard-fails.
2. Calibrate `pixelThreshold` against renderer content, and add a signal that
   colour drift can move — a per-channel mean or histogram delta over the drawn
   region is cheap and is exactly what SSIM discards.
3. On a desktop with a GPU and a WebGPU-capable browser, run
   `pnpm test:e2e tests/e2e/render.spec.ts` with the WebGPU path forced. (The
   previous version of this step named `--grep parity`, which matched no test
   because the harness had no caller; the spec now exists.)
4. Capture the reference scene on both backends at each device profile.
5. Run the parity comparison and record diff ratio and SSIM per profile.
6. If parity fails, the renderer diverges — that is a P1 bug, not a threshold
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

---

## GAP-010 — Fractional key length under sustained CRDT interleaving

**Status:** open by design until P4. **Blocks:** honest sign-off of the P4 gate.

Ordering keys grow when insertions repeatedly split the same gap. The suite
bounds the single-editor worst case — a hundred successive splits of one gap
stays under 30 characters — but that is not the case that matters. The case
that matters is two peers inserting into the same gap concurrently, over and
over, across a long offline period, which is a pattern only Yjs makes possible
and which nothing here can produce yet.

Why it is not merely cosmetic. Key length enters the document three times: as
bytes in every entity, as the comparison cost of every sibling sort, and as the
per-key overhead in a Yjs map. Unbounded growth is a slow leak that shows up as
a scene that opens more slowly every week, and which no single measurement
catches because no single measurement is slow.

**Measurement plan for P4**, to be run once `packages/sync` exists:

1. Drive N peers (N = 2, 4, 8) through a scripted interleaving that concentrates
   insertions on the same sibling gap: each peer inserts at the front of the
   same list, offline, then merges.
2. Record the distribution of key lengths after each merge round — maximum,
   p99, mean — for 10, 100 and 1000 rounds.
3. Assert a bound on **growth rate**, not on absolute length. Length must grow
   no worse than logarithmically in the number of rounds; linear growth per
   round is the failure this exists to catch.
4. Record the numbers in `docs/BUDGETS.md` and promote the bound to an enforced
   budget with `enforcedFrom: P4`.

**Fallback if growth is worse than logarithmic:** rebalancing is a destructive
operation under a CRDT — rewriting every sibling's key is a write to every
sibling, which is the exact conflict pattern fractional indices exist to avoid.
The remedy is therefore a _jitter_ on key generation rather than a rebalance,
and that choice needs its own ADR before it is implemented.

---

## GAP-011 — No GPU: every frame-rate claim is software-rasterised

**Status:** open. **Blocks:** honest sign-off of the P1 gate, tracked as DV-007.

CI has no GPU. Chromium renders through SwiftShader, so frame cost scales with
pixels rather than with the engine's work, and nothing here can support a
frame-rate claim about any device.

The measurements are in ADR-0015. The two that settle it: the throttled tablet
profile misses 60fps with **one** entity on screen, and identical scene logic at
DPR 1 versus DPR 2 costs 26ms versus 60ms per frame.

What is measured instead, and enforced from P1, is the engine's own CPU work per
60Hz frame with rasterisation excluded — 4.66ms on the throttled tablet profile
against an 8ms ceiling. That is a real budget on code in this repository. It is
not a frame-rate claim and must never be reported as one.

**Its sensitivity is bounded and stated**: it catches roughly a doubling of the
engine's per-frame cost, and of draw submission, which is 88% of it. It cannot
see a regression confined to either small term — simulation and scene-graph
writes are 6% each, so a 12x simulation regression passes and a 3x scene-graph
regression moves the total 22%, inside the measurement's own 36% run-to-run
spread. Nothing tighter is achievable on this host. See RC-0011.

**Manual procedure (required before claiming DV-007):**

1. Serve a production build to a real tablet — the reference device is an
   iPad running Safari, since it is the constrained target and the one with no
   WebGPU.
2. Open `/?play=reference2d`, let it run for 30 seconds, and read
   `window.__imagi3FrameSamples()`.
3. Confirm that **no more than 5% of frames exceeded 25ms** across the sample
   window, with 400 entities and a non-zero step count in the same artifact.

   The previous version of this step said "confirm the p95 whole-frame duration
   is at or under 16.67ms". That could not have been discharged: the interval
   between animation-frame callbacks is set by the compositor's 60Hz frame
   source, and an empty page with no engine at all measures a p95 of 16.90ms. A
   procedure that a flawless device fails is a permanent hold recorded as a
   temporary one. See RC-0012.

4. Repeat on a mid-range Android tablet in Chrome, and on an iPhone for the
   phone profile.
5. Record the numbers, the devices and the OS versions in docs/BUDGETS.md, and
   move `playmode.droppedFrames.tablet.reference2d` to `enforcedFrom: P1`. (It
   is the rule that replaced `playmode.fps.tablet.reference2d`, which this step
   still named after RC-0012 removed it — a procedure referring to a budget that
   does not exist would have failed at the moment someone tried to follow it.)

**What would invalidate the deferral rather than close it**, in either
direction:

- If the engine's own CPU budget ever needs **raising** to pass, the deferral
  stops being about the GPU.
- If it turns out the budget cannot **fail** for a regression anyone cares
  about, the substitution that justified the deferral is void. That is what
  happened at the P1 gate review, and it took a planted regression to find —
  the audit self-test had never been extended past P0's eight detectors. It has
  been now.

The 8ms ceiling is derived from the frame budget, not fitted to the measurement,
and changing it in either direction is a decision that needs its own ADR.
