# Physics Validation Report — 100-Structure Campaign

Date: 2026-08-22 · Build: fresh `npm run build -w @eggdrop/web` at campaign time · Harness: `apps/web/e2e/validation/run-validation.spec.ts` · Corpus: `apps/web/e2e/validation/designs.ts` (100 base structures + 25 isolation variants, all `DesignV1Schema`-validated by `apps/web/src/validation/corpus.test.ts` before any run)

No physics fixes were implemented in this campaign; this report is diagnosis only.

> **Resolution (2026-08-22).** All five bugs and OBS-1 are fixed; regression coverage lives in `apps/web/e2e/physics-fixes.spec.ts` plus unit tests in `apps/web/src/scene/drop-playback-timing.test.ts`.
>
> - **BUG-1**: the three G computations in `MonitorBridge` divide by `STANDARD_GRAVITY_MPS2`, and peak force is recomputed as mass × acceleration.
> - **BUG-2**: body damping scales with air density (`atmosphericDamping`, floor 0.01) for parts, the egg, and chain segments.
> - **BUG-3**: the impact-speed metric records the egg's own pre-contact speed; relative speed feeds damage only, clamped to `eggSpeed + maxPlausibleSpeed`.
> - **BUG-4**: `BalloonSuspension` skips pairs in the same welded assembly (`calculateWeldedAssemblyRoots`), and star-shaped weld hubs get hidden spoke-to-spoke bracing welds (`calculateBracingJoints`) — the 3-balloon cluster needed the bracing, not just the shell-force suppression.
> - **BUG-5**: peak load/force report the cushioned `effectiveShellG`, and Rapier contact-force events are median-filtered over a 5-event window (≥3 events) before feeding the peaks.
> - **OBS-1**: a new `airborne` outcome replaces "survived" when the sim timeout fires with the egg >1 m off the ground; it does not score.
>
> Post-fix re-runs of the 3 INVALID structures, all 8 SUSPECTs' parents, and the bracing-sensitive weld structures (21 total) all come back VALID; `f9-balloons-mars` at −10% below vacuum is legitimate projected-area balloon drag, not damping.

## Executive summary

100 structures across 10 families (all 17 materials, all 3 joint kinds, all 8 planets, heights 5–100 ft) were dropped through the automated harness at 1× playback, sampling the HUD every ~150 ms, screenshotting every ~1 s, capturing result-card metrics and console output, and evaluating the machine-checkable invariants I1–I6 from the plan. Every automated SUSPECT/INVALID and a sample of VALID runs were then reviewed frame-by-frame. Each distinct failure signature was isolated with 3–6 single-factor variants (25 total).

**Verdicts: 89 VALID · 8 SUSPECT · 3 INVALID** (final, after manual screenshot/coherence review; the automation alone said 94/6/0 — manual review both cleared two false SUSPECTs and caught three failures the invariant floor of 25 m/s had masked).

**Six distinct defects were found.** Two are solver-level energy injection (BUG-4's two shapes), and four are metric/model coherence failures that misreport otherwise-sane motion (BUG-1, BUG-2, BUG-3, BUG-5). One outcome-semantics observation (OBS-1) and one calibration note (OBS-2) are documented but not classed as simulation defects.

| # | One line | Class | Severity |
|---|---|---|---|
| BUG-1 | Peak G is normalized by the local planet's gravity, so identical physical impacts read 300 G on the Moon and 99 G on Jupiter, and damage thresholds silently shift per planet | Metric + damage (§4, §8) | High |
| BUG-2 | Material `linearDamping` acts as phantom drag in vacuum: Moon landings arrive 6–29% below vacuum free-fall | Kinematic/atmosphere (§3, §8) | Medium |
| BUG-3 | "Impact speed" records the max egg-vs-body relative collision speed, not touchdown speed: it can exceed vacuum free-fall (22.6 vs ceiling 17.3) or under-report a 10 m/s arrival as 3.3 | Metric (§4) | High |
| BUG-4 | Fixed-taped balloon assemblies with interpenetrating pneumatic shells inject energy: 3+ taped balloons hit the watchdog clamp; an egg sandwiched between two taped balloons launches at 15.7 m/s and flies off-screen | Solver/contact (§5, §6, §7) | Critical |
| BUG-5 | Peak load / peak force report per-step solver spikes: gentle cushioned landings (1–7 m/s) display 126–300 G and 100–240 N | Metric (§4), violates invariant I4 | High |
| OBS-1 | The 20 s simulation timeout publishes "survived"/"cracked" verdicts while the egg is still mid-air (floaters, Venus ascents, slow parachutes) | Outcome semantics | Low |
| OBS-2 | Net balloon lift is ~20 g per default balloon (box-volume buoyancy contract): 4 balloons out-lift a 57 g egg and ascend past the tower top | Calibration note | Info |

---

## Method

- **Seeding**: each design JSON is injected via `page.addInitScript` on `eggdrop3d:active-draft:v1` before load (never `evaluate` after load), then verified against the "N parts · M connections" UI readout before release (AGENTS.md §1).
- **Settings**: height, planet, and playback sliders set per spec; all automated runs at 1× playback (physics is fixed-step at 240 Hz; playback only affects watching).
- **Sampling**: current + TOP speed from `.speed-metric strong` every ~150 ms; full-page screenshot every ~1 s into `/tmp/eggdrop-validation/<id>/`; console warnings/errors and page errors captured; result card parsed for outcome, impact speed, peak load, peak force.
- **Automated invariants** (machine-checkable subset of AGENTS.md §3–§7): I1 TOP ≤ `maxPlausibleSpeedMps(heightFt + assembly span, g)`; I2 same bound for reported impact, plus an above-vacuum flag on atmospheric planets; I3 crack before 60% of minimum free-fall time; I4 peak G > 150 from ≤ 10 ft; I5 run ends only at the 20 s sim timeout while visually static; I6 watchdog/NaN/panic console output.
- **Results**: one machine-readable `result.json` per structure under `/tmp/eggdrop-validation/<id>/`, aggregated to `/tmp/eggdrop-validation/summary.json`. Tests only fail on harness errors, never on physics verdicts, so batches always complete.
- **Rerun**: `npm run build -w @eggdrop/web`, then from `apps/web`: `VALIDATION_FILTER=<ids or family> npx playwright test e2e/validation/run-validation.spec.ts --workers=4`. Variants all match filter `v-`.

---

## Bug index

### BUG-4 — Welded balloon assemblies with overlapping pneumatic shells inject energy (CRITICAL, simulation invalid)

**Symptom.** Two shapes of the same root cause:

1. `f3-tape-cluster-4` (4 default balloons taped directly to the egg, adjacent balloon shells overlapping each other): TOP speed pegs at exactly 25.0 m/s — the watchdog ceiling — within ~1 s of release while current speed reads 7.8. The run "completes" with impact 12.3 m/s, but the clamp fired, which per AGENTS.md §7 is instability regardless of the finish.
2. `f10-balloon-sandwich` (egg taped between two balloons whose shells interpenetrate the egg): within ~0.5 s of physics the assembly is moving 15.7 m/s — more than vacuum free-fall from the entire 25 ft drop — and flies off camera, coasting at 15.8 m/s until the timeout publishes a mid-air "survived" with impact 0.

**Violated principles.** Temporal stability (§7: energy injection, watchdog clamp), contact plausibility (§6), structural (§5: known ill-conditioned egg–balloon weld class).

**Variant isolation** (`variants-sig-a`, `variants-sig-b` in `designs.ts`):

- 3 taped balloons still diverge (17.8 m/s > vacuum 12.2); the previously fixed 2-balloon case (`f3-tape-two`) is clean → threshold is at 3.
- Same 4 balloons on **rope** joints: perfectly clean (1.2 m/s float) → the fixed weld is required.
- Same cluster at 5 ft and on the airless Moon: still clamps at 25 → height-independent and buoyancy-independent; this is weld-network conditioning, not lift or fall energy.
- Sandwich with rope joints, or with welds but **no shell overlap**, or with overlap but **no joints**, or with only **one** balloon, or with **foam** instead of balloons: all five clean → failure requires fixed welds **and** interpenetrating balloon shells simultaneously.

**Suspected location.** `apps/web/src/scene/balloonContact.ts` + `BalloonSuspension` in `apps/web/src/scene/DropScene.tsx`, interacting with the assembly contact-suppression pass (noop joints). The pneumatic shell force fires between bodies that are already rigidly coupled through the fixed-joint network (balloon↔balloon coupled via egg welds in shape 1; balloon↔egg welded pairs in shape 2), so every step the shell pushes and the weld constraint pulls back, pumping energy.

**Fix sketch.** Extend contact/shell-force suppression to the *transitive closure* of the fixed-joint assembly: when computing balloon shell forces (and shell-vs-egg forces), skip pairs whose bodies belong to the same welded assembly (union-find over `fixed` joints, egg included), the same way directly-overlapping taped parts already get noop-joint suppression. Alternatively cap the shell force so it can never exceed the weld's restoring impulse budget per step.

**Suggested regression test.** e2e: seed a 3-balloon taped cluster (copy `v-a1-tape-cluster-3`) and the balloon sandwich (`f10-balloon-sandwich`), release at 25 ft / Earth / 1×, poll TOP; assert TOP < 13 m/s (vacuum + margin) for both and that the egg stays within the camera frame (no `WATCHDOG` clamp).

### BUG-1 — Peak G normalized by local planet gravity (HIGH, metrics and damage invalid across planets)

**Symptom.** The same physical impact reports wildly different "G" per planet, inversely proportional to local gravity: a 2.2 m/s bare-egg tap on the Moon saturates the 300 G display cap and cracks the egg, while an 8.6 m/s slam on Jupiter reads 99 G. The formula `G = impactSpeed / (0.0035 s × g_planet)` reproduces **every** bare-egg reading exactly:

| Run | Impact (m/s) | g (m/s²) | Predicted | Reported |
|---|---|---|---|---|
| `f1-bare-moon-5` | 2.2 | 1.62 | 388 → cap 300 | 300 |
| `v-d1-bare-mars-5` | 3.3 | 3.72 | 253 | 255 |
| `v-d2-bare-venus-5` | 3.7 | 8.87 | 119 | 120 |
| `f1-bare-earth-5` | 5.4 | 9.81 | 157 | 156 |
| `v-d3-bare-saturn-5` | 5.6 | 10.44 | 153 | 153 |
| `v-d4-bare-neptune-5` | 5.7 | 11.15 | 146 | 147 |
| `f1-bare-jupiter-5` | 8.6 | 24.79 | 99 | 99 |

**Violated principles.** Metric coherence (§4) and planet consistency (§8). Because the damage model's thresholds (`effectiveShellG >= 80`, `> 20`, `> 32`) are fixed numbers in these local-G units, egg fragility silently scales with 1/g: identical decelerations crack on the Moon and are harmless on Jupiter.

**Suspected location.** `apps/web/src/scene/DropScene.tsx`, `MonitorBridge`: the step sampler (`sampledG = nonGravityDelta.length() / DROP_FIXED_STEP_SECONDS / gravityMps2`, ~line 1751), the collision handler (`eventG = ... / impactDuration / gravityMps2`, ~line 1792), and the contact-force handler (`forceG = force / EGG_MASS_KG / gravityMps2`, ~line 1802) all divide by the **planet's** gravity. The shared library's `calculatePeakG` (`packages/shared/src/physics.ts`) correctly divides by `STANDARD_GRAVITY_MPS2` — DropScene is inconsistent with its own physics package.

**Fix sketch.** Replace `gravityMps2` with `STANDARD_GRAVITY_MPS2` (9.80665) in the three G computations (peak force already multiplies back by the same divisor, so recompute it as `mass × accel` directly to stay correct). Then re-verify the damage thresholds (80/20/32) on Earth baselines, which keep their current meaning by construction.

**Suggested regression test.** Unit-level: extract the G computation and assert `computeEventG(v, duration, planetG)` is independent of `planetG`. Or e2e: drop the bare egg from 5 ft on Moon and Jupiter and assert the reported peak-G ordering matches the impact-speed ordering (Jupiter > Moon).

### BUG-2 — Static `linearDamping` acts as phantom drag in vacuum (MEDIUM, kinematics off on airless/thin planets)

**Symptom.** On the Moon (air density 0) every fall lands measurably below vacuum free-fall, with the deficit scaling with body damping coefficient and fall time — exactly the signature of velocity-proportional damping, not physics: bare egg (damping 0.04) from 100 ft arrives at 9.1 vs 9.94 m/s (−8%); with a cotton ball rider (damping 0.4) −9% from 50 ft; with a plastic bag (damping 0.45) −29% from 50 ft (`f4-bag-moon`: 5.0 vs 7.03 m/s — the bag "works" on the Moon, which §8 explicitly forbids). Mars (0.02 kg/m³ air) shows the same: `f9-balloons-mars` −21% when real drag at that density is negligible.

**Variant isolation** (`variants-sig-e`): deficit 6% (bare egg) → 9% (cotton rider) → 23–29% (bag), monotone in the damping coefficient; Earth control plausible since real drag dominates there.

**Suspected location.** `apps/web/src/scene/DropScene.tsx`: part bodies get `linearDamping={definition.physics.linearDamping}` (~line 590) and the egg `linearDamping={.04}` (~line 1532), rope-chain segments `.25` (~line 787) — all constants regardless of `airDensityKgM3`. The explicit aero model (`aero.ts`) correctly scales with air density, but this Rapier-level damping is a second, hidden aerodynamic force that never turns off.

**Fix sketch.** Scale body damping by atmosphere at scene construction: `effectiveDamping = physics.linearDamping * (airDensityKgM3 / SEA_LEVEL_AIR_DENSITY_KG_M3)` (same for angular damping and the egg/segment constants). If some damping is needed for solver hygiene, keep a tiny floor (≤ 0.01) and document it.

**Suggested regression test.** e2e on the Moon at 100 ft with the bare egg: assert reported impact ≥ 0.97 × √(2·g·h). A faster unit test can step a Rapier world with the constructed egg body in vacuum settings and assert terminal speed matches analytic free-fall within 1%.

### BUG-3 — Impact-speed metric decoupled from touchdown speed (HIGH, result card can show impossible values)

**Symptom.** `f5-straw-outriggers` (cup + 4 taped straw outriggers, 50 ft): the egg's HUD TOP never exceeded 12.2 m/s, yet the result card reports **impact 22.6 m/s** — above vacuum free-fall from that height (17.3). Frames show the landing scattering the straws; the metric recorded the egg-vs-flung-straw *relative* speed. The same metric also under-reports: `f5-corner-bumpers` fell at a steady 9.1 m/s and reports impact 1.1; `f2-cup-column` fell at 10.9 and reports 2.4.

**Violated principles.** Metric coherence (§4): impact above vacuum ceiling on Earth is the guide's canonical "strong glitch signal"; the number also cannot be trusted downward.

**Variant isolation** (`variants-sig-c`): glue instead of tape still over-reports (21.4 vs top 12.1) → joint material irrelevant; 2 outriggers, craft-stick outriggers, and 25 ft all stop the over-report (the specific straw-flinging pose is needed) but flip to under-reporting (3.3–3.6 reported for 10–13 m/s arrivals), confirming the metric is generically decoupled from touchdown speed.

**Suspected location.** `apps/web/src/scene/DropScene.tsx` collision handler (~lines 1772–1798): `impactSpeed.current = Math.max(impactSpeed.current, relativeSpeed)` where `relativeSpeed = max(fallbackRelative, recentRelativeSpeeds[otherBodyId])` — a decayed running max of egg-vs-body relative speeds. A light part kicked hard by the ground contact (or by a weld-correction impulse, itself worth a look — a ~4 g straw reaching >20 m/s from a 12 m/s landing suggests a solver kick) poisons the next egg contact with that part.

**Fix sketch.** Report the egg's own speed: capture `|eggVelocity|` (or its vertical component) in the step *before* the qualifying contact and use that for the impact-speed metric; keep the relative-speed machinery only for damage estimation, clamped to `eggSpeed + plausible other-body speed` (e.g. the same watchdog ceiling). Separately audit why a taped straw exceeds 20 m/s at landing (likely the same weld-correction impulse family as BUG-4).

**Suggested regression test.** e2e: rerun `f5-straw-outriggers` and assert reported impact ≤ max sampled TOP + 2 m/s and ≤ `maxPlausibleSpeedMps`; add a cushion-landing case asserting reported impact within ±30% of the last pre-contact HUD speed.

### BUG-5 — Peak load / peak force report per-step solver spikes on gentle landings (HIGH, violates invariant I4)

**Symptom.** Nearly every landed run saturates at or near the 300 G display cap regardless of touchdown speed. The cleanest cases: `v-f1-foam-10ft` — a 6.5 m/s landing onto a foam block (cushioning 0.9) reports **163 G** where the kinematic estimate through ~5 cm of foam is ~25 G, directly violating I4 (>150 G from ≤10 ft); `v-f3-bumpers-25ft` — a bumpered sled landing with egg impact 1.1 m/s reports **300 G / 240 N** on a 57 g egg; `f9-cushion-neptune` — 2.4 m/s onto foam reports 237 G / 151 N. Survivals still happen because the damage path separately applies cushioning, but the displayed "Peak load"/"Peak force" describe solver impulses, not the landing.

**Violated principles.** Metric coherence (§4: "extreme values from a short tower drop usually indicate contact/solver spikes"), invariant I4.

**Suspected location.** `apps/web/src/scene/DropScene.tsx`: (a) the collision `eventG` uses a fixed 3.5 ms base impact duration (`impactDuration = .0035 + ...`, ~line 1782) — a hard-shell-on-concrete assumption applied to every contact; (b) `peakG` takes the **raw** pre-cushioning value (`peakG.current = Math.max(peakG.current, filteredG)` ~line 1761, `eventG` raw ~line 1795) even though damage uses the cushioned `effectiveShellG`; (c) the contact-force handler (~line 1801) feeds single-step Rapier `maxForceMagnitude` impulse spikes straight into peak force/G.

**Fix sketch.** Display the load the shell actually felt: report cushioned `effectiveShellG` as "Peak load" (or compute G from egg Δv over a rolling ~20 ms window instead of one 240 Hz step / a fixed 3.5 ms divisor), and median- or percentile-filter the Rapier contact-force events before folding them into `peakForce`. Keep the raw spike values in a debug channel if they are useful for the damage model.

**Suggested regression test.** e2e: egg on one foam block from 10 ft on Earth (copy `v-f1-foam-10ft`), assert reported peak load < 60 G and peak force < 40 N. This is the exact I4 inequality and currently fails.

### OBS-1 — 20 s simulation timeout publishes mid-air outcomes (LOW, outcome semantics)

`f3-string-three`, `f3-neutral-four`, `f3-glue-cluster-8`, `f3-mega-balloon` (Earth floaters), `f9-balloons-venus` and `f4-bag-venus` (ascending/hovering on Venus) all end at the 20 s simulation timeout with outcome "The egg survived" and impact 0 while the egg is airborne — `f3-neutral-four` is actually *rising past the 100 ft marker* when the win is declared. Slow parachutes from 100 ft (`f4-bag-double`, `f4-bag-mega`) land at ~19 s and get cut off before the 3 s settle window, occasionally publishing right at the buzzer. The physics in all of these is sane; the label is not. Suggested handling (product decision, not a solver fix): a distinct "still airborne when time ran out" outcome, or extend/scale the timeout when descent speed is low; at minimum suppress "survived" when the egg altitude is above a threshold at timeout. Location: `MonitorBridge` finish path, `DROP_SIMULATION_TIMEOUT_SECONDS` (~line 1876 in `DropScene.tsx`).

### OBS-2 — Balloon lift calibration (INFO)

Net lift per default balloon ≈ 20 g (box-volume buoyancy minus box-volume mass, per the deliberate contract documented at `DropScene.tsx` ~line 348). A comparable real 30 cm helium balloon nets ~15 g, so lift is ~30% generous: 4 balloons (80 g) out-lift the 57 g egg and ascend, 3 balloons hover-descend at <1 m/s. Not a defect — a documented calibration choice — but worth knowing when judging balloon builds, and it slightly amplifies OBS-1 (floaters never land within the timeout).

---

## Variant isolation results (25 runs)

| Variant | Parent | Factor changed | Outcome | Impact | Vacuum | Top | Peak G | Finding |
|---|---|---|---|---|---|---|---|---|
| `v-a1-tape-cluster-3` | `f3-tape-cluster-4` | 3 balloons instead of 4 | cracked | 17.8 | 12.23 | 17.8 | 300 | still diverges: top 17.8 > vacuum 12.2 |
| `v-a2-rope-cluster-4` | `f3-tape-cluster-4` | rope joints instead of tape | survived | 0 | 12.23 | 1.2 | 0 | clean: gentle 1.2 m/s float |
| `v-a3-tape-cluster-4-5ft` | `f3-tape-cluster-4` | 5 ft instead of 25 | cracked | 7 | 5.47 | 25 | 300 | still diverges: top clamped at 25 |
| `v-a4-tape-cluster-4-moon` | `f3-tape-cluster-4` | Moon (no buoyancy/drag) | cracked | 17.2 | 4.97 | 25 | 300 | still diverges: top clamped at 25 |
| `v-b1-sandwich-rope` | `f10-balloon-sandwich` | rope joints instead of tape | survived | 1.6 | 12.23 | 2.1 | 45 | clean |
| `v-b2-sandwich-nooverlap` | `f10-balloon-sandwich` | no shell interpenetration | survived | 0.6 | 12.23 | 1.6 | 7 | clean |
| `v-b3-sandwich-nojoints` | `f10-balloon-sandwich` | overlap kept, joints removed | cracked | 3 | 12.23 | 3 | 88 | clean |
| `v-b4-sandwich-one` | `f10-balloon-sandwich` | one balloon instead of two | cracked | 3.4 | 12.23 | 3.4 | 140 | clean |
| `v-b5-sandwich-foam` | `f10-balloon-sandwich` | foam blocks instead of balloons | survived | 8.1 | 12.23 | 8.1 | 49 | clean |
| `v-c1-outriggers-glue` | `f5-straw-outriggers` | glue instead of tape | cracked | 21.4 | 17.29 | 12.1 | 241 | still over-reports: impact 21.4 > vacuum, top 12.1 |
| `v-c2-outriggers-2` | `f5-straw-outriggers` | 2 outriggers instead of 4 | cracked | 13.4 | 17.29 | 13.4 | 300 | impact = top 13.4, no over-report |
| `v-c3-outriggers-sticks` | `f5-straw-outriggers` | craft sticks instead of straws | cracked | 3.6 | 17.29 | 13.3 | 300 | under-reports: impact 3.6 vs top 13.3 |
| `v-c4-outriggers-25ft` | `f5-straw-outriggers` | 25 ft instead of 50 | cracked | 3.3 | 12.23 | 10 | 293 | under-reports: impact 3.3 vs top 10.0 |
| `v-d1-bare-mars-5` | `f1-bare-moon-5` | Mars g=3.72 | cracked | 3.3 | 3.37 | 3.3 | 255 | G 255; predicted v/(0.0035·g)=253 |
| `v-d2-bare-venus-5` | `f1-bare-moon-5` | Venus g=8.87 | cracked | 3.7 | 5.2 | 3.7 | 120 | G 120; predicted 119 |
| `v-d3-bare-saturn-5` | `f1-bare-moon-5` | Saturn g=10.44 | cracked | 5.6 | 5.64 | 5.6 | 153 | G 153; predicted 153 |
| `v-d4-bare-neptune-5` | `f1-bare-moon-5` | Neptune g=11.15 | cracked | 5.7 | 5.83 | 5.6 | 147 | G 147; predicted 146 |
| `v-e1-bare-moon-50` | `f1-bare-moon-100` | bare egg (damping 0.04) | cracked | 6.6 | 7.03 | 6.6 | 300 | impact 6.6 vs vacuum 7.03: 6% deficit |
| `v-e2-cotton-moon-50` | `f1-bare-moon-100` | cotton rider (damping 0.4) | cracked | 6.4 | 7.03 | 6.4 | 300 | impact 6.4: 9% deficit, grows with damping |
| `v-e3-cotton-earth-50` | `f1-bare-moon-100` | Earth control | cracked | 12.2 | 17.29 | 12.2 | 300 | impact 12.2 vs 17.3: plausible with real drag |
| `v-e4-bag-moon-25` | `f1-bare-moon-100` | bag on Moon, 25 ft | cracked | 3.8 | 4.97 | 3.8 | 300 | impact 3.8 vs 4.97: 23% deficit in vacuum |
| `v-f1-foam-10ft` | `f2-foam-single` | 10 ft onto foam | survived | 6.5 | 7.73 | 6.5 | 163 | G 163 (kinematic ~25): spike, violates I4 |
| `v-f2-foam-5ft` | `f2-foam-single` | 5 ft onto foam | survived | 4.8 | 5.47 | 4.9 | 126 | G 126 (kinematic ~18): spike |
| `v-f3-bumpers-25ft` | `f5-corner-bumpers` | bumper sled from 25 ft | survived | 1.2 | 12.23 | 8.2 | 300 | impact 1.2, G 300, force 240 N: saturated spike |
| `v-f4-foam-neptune-10` | `f9-cushion-neptune` | Neptune, 10 ft onto foam | survived | 7.4 | 8.24 | 7.5 | 172 | G 172: spike present cross-planet |

---

## Summary table — all 100 base structures

Verdict is the final (manual-review) classification. "Vacuum" is √(2·g·h) for the drop height. Empty notes = no anomaly; peak-G values everywhere are affected by BUG-5 (display only) and are not individually flagged.

| Structure | Planet | Ht (ft) | Outcome | Impact (m/s) | Vacuum (m/s) | Top (m/s) | Peak G | Verdict | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `f1-bare-earth-100` | earth | 100 | cracked | 20.7 | 24.45 | 20.7 | 300 | VALID |  |
| `f1-bare-earth-25` | earth | 25 | cracked | 11.6 | 12.23 | 11.6 | 300 | VALID |  |
| `f1-bare-earth-5` | earth | 5 | cracked | 5.4 | 5.47 | 5.3 | 156 | SUSPECT | metric: peak G from fixed 3.5 ms window (BUG-5) |
| `f1-bare-earth-50` | earth | 50 | cracked | 15.8 | 17.29 | 15.7 | 300 | VALID |  |
| `f1-bare-jupiter-5` | jupiter | 5 | cracked | 8.6 | 8.69 | 8.5 | 99 | VALID |  |
| `f1-bare-jupiter-50` | jupiter | 50 | cracked | 26.8 | 27.49 | 26.8 | 300 | VALID |  |
| `f1-bare-mars-25` | mars | 25 | cracked | 7.3 | 7.53 | 7.3 | 300 | VALID |  |
| `f1-bare-moon-100` | moon | 100 | cracked | 9.1 | 9.94 | 9.1 | 300 | SUSPECT | kinematic: impact 9.1 vs vacuum 9.94, phantom damping (BUG-2) |
| `f1-bare-moon-5` | moon | 5 | cracked | 2.2 | 2.22 | 2.1 | 300 | SUSPECT | metric: G saturates 300 at 2.2 m/s via local-g normalization (BUG-1) |
| `f1-bare-venus-25` | venus | 25 | cracked | 4.3 | 11.63 | 4.3 | 138 | VALID | dense-air terminal velocity, correct |
| `f2-bubble-triple` | earth | 50 | cracked | 13.3 | 17.29 | 13.3 | 300 | VALID |  |
| `f2-cotton-nest` | earth | 25 | cracked | 11.6 | 12.23 | 11.6 | 300 | VALID |  |
| `f2-cup-column` | earth | 25 | cracked | 2.4 | 12.23 | 10.9 | 272 | VALID | impact under-report is BUG-3 family; motion sane |
| `f2-cushion-pyramid` | earth | 100 | cracked | 20.3 | 24.45 | 20.2 | 300 | VALID | pyramid scatters plausibly |
| `f2-foam-single` | earth | 25 | cracked | 9.5 | 12.23 | 9.4 | 276 | VALID |  |
| `f2-foam-stack-3` | earth | 50 | cracked | 13.6 | 17.29 | 13.5 | 300 | VALID |  |
| `f2-layered-pad` | earth | 50 | survived | 9.4 | 17.29 | 9.4 | 92 | VALID | welded sandwich fell as one unit |
| `f2-newspaper-wrap` | earth | 25 | survived | 4.1 | 12.23 | 4.1 | 26 | VALID | sheet drag slowed the fall |
| `f2-peanut-bed` | earth | 25 | cracked | 11.6 | 12.23 | 11.6 | 300 | VALID |  |
| `f2-sponge-pad` | earth | 25 | cracked | 11.6 | 12.23 | 11.5 | 300 | VALID |  |
| `f3-balloon-below` | earth | 25 | cracked | 3.3 | 12.23 | 4.1 | 98 | VALID |  |
| `f3-glue-cluster-8` | earth | 25 | survived | 0 | 12.23 | 2 | 0 | VALID | floater; mid-air "survived" at timeout (OBS-1) |
| `f3-mega-balloon` | earth | 50 | survived | 0 | 17.29 | 2.7 | 0 | VALID | floater (OBS-1) |
| `f3-neutral-four` | earth | 50 | survived | 0 | 17.29 | 1.3 | 0 | VALID | *rising* past 100 ft at timeout (OBS-1/OBS-2) |
| `f3-string-above-thresh` | earth | 50 | cracked | 4.8 | 17.29 | 4.8 | 185 | VALID | 1.2 m segmented chain rendered/behaved cleanly |
| `f3-string-below-thresh` | earth | 50 | cracked | 3.4 | 17.29 | 3.5 | 100 | VALID | single tether below 0.85 m threshold, clean |
| `f3-string-single` | earth | 25 | cracked | 3.4 | 12.23 | 3.4 | 100 | VALID | bare shell ground contact at 3.4 m/s cracking is plausible |
| `f3-string-three` | earth | 50 | survived | 0 | 17.29 | 0.8 | 0 | VALID | floater (OBS-1) |
| `f3-tape-cluster-4` | earth | 25 | cracked | 12.3 | 12.23 | **25** | 300 | **INVALID** | watchdog-clamped runaway (BUG-4); rope twin is clean |
| `f3-tape-two` | earth | 25 | survived | 1.5 | 12.23 | 1.6 | 88 | VALID | previously-fixed regression case stays fixed |
| `f4-bag-ballast` | earth | 50 | cracked | 1.6 | 17.29 | 2.4 | 43 | VALID | crack from accumulated pendulum bumps, plausible |
| `f4-bag-below` | earth | 25 | survived | 2.7 | 12.23 | 4.2 | 53 | VALID | canopy legitimately self-rights above the egg (frames verified) |
| `f4-bag-double` | earth | 100 | survived | 1.6 | 24.45 | 2.1 | 46 | VALID | landed ~19.5 s; timeout cut the settle window (OBS-1) |
| `f4-bag-harness-4` | earth | 50 | survived | 1.7 | 17.29 | 2.1 | 50 | VALID |  |
| `f4-bag-mars` | mars | 50 | cracked | 5.7 | 10.65 | 5.6 | 300 | VALID | thin air: bag barely helps, as expected |
| `f4-bag-mega` | earth | 100 | cracked | 1.6 | 24.45 | 2.3 | 130 | VALID | landed ~19 s at 1.6 m/s; bare-shell crack at the margin is plausible; G display via BUG-5 |
| `f4-bag-moon` | moon | 50 | cracked | 5 | 7.03 | 4.8 | 300 | SUSPECT | bag slowed a vacuum fall by 29% (BUG-2) |
| `f4-bag-single` | earth | 50 | survived | 1.7 | 17.29 | 2.1 | 49 | VALID | textbook canopy descent |
| `f4-bag-taped` | earth | 50 | survived | 1.7 | 17.29 | 2.1 | 92 | VALID | rigid bag weld stable |
| `f4-bag-venus` | venus | 50 | survived | 0 | 16.44 | 1.5 | 0 | VALID | hovering in soup at timeout (OBS-1) |
| `f5-band-suspension` | earth | 25 | survived | 8.9 | 12.23 | 8.9 | 33 | VALID | suspension worked as designed |
| `f5-cardboard-box` | earth | 50 | cracked | 12.5 | 17.29 | 12.6 | 300 | VALID |  |
| `f5-corner-bumpers` | earth | 100 | survived | 1.1 | 24.45 | 9.1 | 300 | VALID | impact under-report + G saturation are BUG-3/BUG-5 metrics; motion sane |
| `f5-cup-cradle` | earth | 25 | cracked | 4.5 | 12.23 | 11 | 300 | VALID |  |
| `f5-frame-glued` | earth | 50 | cracked | 15.8 | 17.29 | 15.7 | 300 | VALID | identical to taped twin, as expected pre-break |
| `f5-frame-jupiter` | jupiter | 25 | cracked | 19.1 | 19.44 | 19 | 220 | VALID |  |
| `f5-frame-taped` | earth | 50 | cracked | 15.8 | 17.29 | 15.8 | 300 | VALID |  |
| `f5-stick-lattice` | earth | 25 | cracked | 11.6 | 12.23 | 11.6 | 300 | VALID |  |
| `f5-straw-cage` | earth | 25 | cracked | 7.6 | 12.23 | 7.6 | 222 | VALID |  |
| `f5-straw-outriggers` | earth | 50 | cracked | **22.6** | 17.29 | 12.2 | 234 | **INVALID** | impact metric above vacuum and above observed top (BUG-3) |
| `f6-daisy-chain` | earth | 50 | cracked | 11.9 | 17.29 | 12.8 | 300 | VALID | chain unrolled and landed sequentially |
| `f6-heavy-pendulum` | earth | 25 | cracked | 12.8 | 12.23 | 11.4 | 300 | VALID | 0.5 m/s over vacuum explained by the 1.2 m assembly span's extra PE |
| `f6-pendulum-moon` | moon | 50 | cracked | 7.6 | 7.03 | 6 | 300 | VALID | over-vacuum from span PE, same as Earth twin |
| `f6-short-string` | earth | 25 | cracked | 9.4 | 12.23 | 8.8 | 300 | VALID |  |
| `f6-slack-line` | earth | 25 | cracked | 8.9 | 12.23 | 8.8 | 258 | VALID |  |
| `f6-string-1m` | earth | 50 | cracked | 10.3 | 17.29 | 10.1 | 300 | VALID | 1.0 m segmented chain clean (frames verified) |
| `f6-string-series` | earth | 50 | cracked | 9.9 | 17.29 | 10.1 | 289 | VALID |  |
| `f6-tape-tether-12` | earth | 50 | cracked | 10.1 | 17.29 | 10.1 | 300 | VALID | 1.25 m chained tape tether clean |
| `f6-tether-cross` | earth | 50 | cracked | 9.8 | 17.29 | 9.8 | 285 | VALID | crossed ropes did not snag |
| `f6-whip-150` | earth | 100 | cracked | 21.7 | 24.45 | 21.7 | 300 | VALID | whip arrest handled without spike beyond ceiling |
| `f7-band-ballast` | earth | 25 | cracked | 9.8 | 12.23 | 11.7 | 193 | VALID |  |
| `f7-band-chain` | earth | 50 | cracked | 8.9 | 17.29 | 9.5 | 260 | VALID | serial springs did not gain energy |
| `f7-band-cross` | earth | 25 | cracked | 9 | 12.23 | 9 | 264 | VALID |  |
| `f7-band-jupiter` | jupiter | 25 | cracked | 18.5 | 19.44 | 18.5 | 214 | VALID | no spring resonance at 24.8 m/s² |
| `f7-band-long` | earth | 50 | cracked | 9.9 | 17.29 | 9.9 | 289 | VALID | 0.9 m spring did not chain (correct) |
| `f7-band-moon` | moon | 50 | cracked | 6.3 | 7.03 | 6.3 | 300 | SUSPECT | kinematic: impact 6.3 vs vacuum 7.03 (BUG-2) |
| `f7-band-quad` | earth | 25 | cracked | 10.7 | 12.23 | 10 | 292 | VALID |  |
| `f7-band-restitution-stack` | earth | 50 | cracked | 9.7 | 17.29 | 9.7 | 300 | VALID | no spring–sponge resonance growth |
| `f7-band-single` | earth | 25 | cracked | 8.9 | 12.23 | 8.9 | 300 | VALID |  |
| `f7-trampoline` | earth | 25 | cracked | 1.6 | 12.23 | 10 | 110 | VALID | no trampoline launch |
| `f8-extreme-weld` | earth | 25 | cracked | 10.7 | 12.23 | 10.7 | 300 | VALID | 945:1 density weld stayed coherent |
| `f8-heavy-raft` | earth | 25 | survived | 8.9 | 12.23 | 9 | 216 | VALID | sponges cushioned; no balloon-style squirting |
| `f8-lead-balloon` | earth | 25 | cracked | 5.6 | 12.23 | 5.5 | 298 | VALID | ballast/buoyancy couple stable |
| `f8-lead-egg-weld` | earth | 50 | cracked | 16 | 17.29 | 16 | 300 | VALID |  |
| `f8-lead-parachute` | earth | 100 | cracked | 1.5 | 24.45 | 2.2 | 95 | VALID | heavy payload landed slowly; crack from weight bumps plausible |
| `f8-lead-pendulum` | earth | 50 | cracked | 16.3 | 17.29 | 16.3 | 300 | VALID |  |
| `f8-seesaw` | earth | 25 | survived | 9 | 12.23 | 9 | 67 | VALID | rotated weight-down in flight as expected |
| `f8-weight-cluster` | earth | 25 | cracked | 8.2 | 12.23 | 11.7 | 208 | VALID | spring held the arresting cluster without divergence |
| `f8-weight-stack` | earth | 25 | cracked | 7.5 | 12.23 | 11.6 | 217 | VALID | dense column toppled plausibly, no jitter |
| `f8-weights-jupiter` | jupiter | 25 | cracked | 19 | 19.44 | 18.9 | 300 | VALID |  |
| `f9-balloons-mars` | mars | 50 | cracked | 8.4 | 10.65 | 8.4 | 300 | SUSPECT | 21% below vacuum in near-vacuum air (BUG-2) |
| `f9-balloons-moon` | moon | 50 | cracked | 5.7 | 7.03 | 5.7 | 300 | SUSPECT | balloons gave no lift (correct) but damping slowed the fall (BUG-2) |
| `f9-balloons-uranus` | uranus | 50 | cracked | 4.7 | 16.27 | 4.8 | 155 | VALID | partial lift, between Mars and Earth, as expected |
| `f9-balloons-venus` | venus | 50 | survived | 0 | 16.44 | 3.6 | 0 | VALID | super-buoyancy: assembly ascends (frames verified); mid-air verdict is OBS-1 |
| `f9-bare-neptune-25` | neptune | 25 | cracked | 12.6 | 13.04 | 12.6 | 300 | VALID |  |
| `f9-bare-saturn-25` | saturn | 25 | cracked | 12.3 | 12.61 | 12.1 | 300 | VALID |  |
| `f9-bare-uranus-25` | uranus | 25 | cracked | 11.1 | 11.51 | 11 | 300 | VALID |  |
| `f9-cushion-jupiter` | jupiter | 25 | survived | 17.7 | 19.44 | 17.7 | 181 | VALID | fast plausible fall; foam + cushioned damage path saved it |
| `f9-cushion-moon` | moon | 25 | survived | 4 | 4.97 | 4 | 300 | SUSPECT | 20% below vacuum (BUG-2); G 300 at 4 m/s (BUG-1/BUG-5) |
| `f9-cushion-neptune` | neptune | 25 | survived | 2.4 | 13.04 | 10.8 | 237 | VALID | impact under-report is BUG-3 family; motion sane |
| `f10-balloon-sandwich` | earth | 25 | survived | 0 | 12.23 | **15.8** | 4 | **INVALID** | launched above free-fall at release, egg off-screen for the whole run (BUG-4) |
| `f10-breakforce-whip` | earth | 100 | cracked | 20.2 | 24.45 | 21.5 | 300 | VALID | string break under whip handled cleanly |
| `f10-interpenetrating-foam` | earth | 25 | cracked | 11.1 | 12.23 | 11 | 300 | VALID | gentle depenetration |
| `f10-joint-cycle` | earth | 25 | cracked | 8.2 | 12.23 | 8.2 | 269 | VALID | closed weld cycle did not fight itself |
| `f10-peanut-pile-96` | earth | 25 | cracked | 11.6 | 12.23 | 11.6 | 300 | VALID | 96-body contact pile stable, scattered plausibly (frames verified) |
| `f10-rope-zero-length` | earth | 25 | cracked | 9.1 | 12.23 | 8.6 | 251 | VALID | degenerate rope behaved as contact |
| `f10-spinner` | earth | 50 | cracked | 9.9 | 17.29 | 10.3 | 287 | VALID | spin stayed bounded |
| `f10-tape-through-part` | earth | 25 | cracked | 11.3 | 12.23 | 11.7 | 300 | VALID | joint correctly non-colliding with the crossed sheet |
| `f10-weld-inside` | earth | 25 | survived | 2 | 12.23 | 9.5 | 254 | VALID | fully interpenetrating weld acted as one body |
| `f10-zero-span-joint` | earth | 25 | cracked | 2.5 | 12.23 | 11.4 | 73 | VALID | degenerate zero-span weld did not NaN or spin up |

---

## Per-structure detail — non-VALID runs

Screenshots for every run: `/tmp/eggdrop-validation/<id>/t*.png` (+`result.png`); raw metrics and invariant evaluations in `result.json` alongside.

### `f3-tape-cluster-4` — INVALID (BUG-4, shape 1)

Four default balloons taped to the egg at compass points (design in `designs.ts` family 3); adjacent balloon shells overlap each other (centers 0.25 m apart vs 0.30 m diameter). Earth, 25 ft, 1×. TOP hit exactly 25.0 m/s (the watchdog ceiling `maxPlausibleSpeedMps`) within ~1 s while current speed read 7.8 — a clamped runaway. The run finished with impact 12.3 m/s / 300 G. Invariants: I1 passed only because the ceiling *is* the clamp value; manual review overrides to INVALID per §7. Variants: fails with 3 balloons, at 5 ft, and on the Moon; clean with rope joints. The previously fixed 2-balloon case (`f3-tape-two`, the twin of the original regression spec) remains clean.

### `f10-balloon-sandwich` — INVALID (BUG-4, shape 2)

Egg taped between two balloons whose shells interpenetrate it. At the first 1 s screenshot the assembly is already at 15.7 m/s (vacuum free-fall from the *full* 25 ft is 12.2) and above the 30 ft marker; every subsequent frame is empty sky with the HUD pinned at 15.8 m/s — the egg left the camera and never returned. Timeout published "survived", impact 0, peak G 4. Variants show removing any one factor (welds, overlap, second balloon, balloon material) fully cleans it.

### `f5-straw-outriggers` — INVALID (BUG-3)

Paper cup with four taped straw outriggers, Earth 50 ft. Fall and landing look normal in frames (assembly lands ~2.5 s, straws scatter, egg pops out and rests) and the egg's TOP never exceeded 12.2 m/s, but the result card claims impact 22.6 m/s — above vacuum free-fall (17.3) and above anything the egg ever did. The impact metric recorded a relative speed against a straw that was kicked to >20 m/s during the landing (the kick itself deserves an audit; it is plausibly the same weld-impulse family as BUG-4). Glue variant reproduces; two-straw, stick, and 25 ft variants flip to *under*-reporting.

### `f1-bare-earth-5`, `f1-bare-moon-5` — SUSPECT (BUG-1 / BUG-5, metrics only)

Motion is perfect (impacts 5.4 and 2.2 m/s vs vacuum 5.47 and 2.22). The reported loads are not: 156 G on Earth is the fixed 3.5 ms window (BUG-5), and 300 G on the Moon at 2.2 m/s is the local-gravity normalization (BUG-1) — the Moon egg reads a *higher* load than the Earth egg despite hitting at 40% of the speed. Whether a 5 ft bare-egg crack is legitimate is untestable while the load metric is planet-relative.

### `f1-bare-moon-100`, `f4-bag-moon`, `f7-band-moon`, `f9-balloons-moon`, `f9-balloons-mars`, `f9-cushion-moon` — SUSPECT (BUG-2)

All land 6–29% below vacuum free-fall with zero (or near-zero) atmosphere. Deficit ranks exactly by the attached material's `linearDamping` (bare egg 0.04 → −6…−8%; balloons 0.3 / foam 0.32 → −19…−20%; plastic bag 0.45 → −29%) and grows with fall time. Everything else about these runs (no balloon lift on the Moon, no bag benefit beyond the damping artifact, correct gravity scaling) is right.

---

## Family notes (VALID runs)

- **F1 baselines**: impacts sit 1–9% below vacuum on atmospheric planets (drag) and scale correctly with gravity; Venus terminal velocity (4.3 m/s from 25 ft in 65 kg/m³ air) is a nice atmosphere win. Only metric-level issues (BUG-1/5).
- **F2 cushions**: all stacks and pads fell coherently; the welded layered pad and newspaper wrap survived on merit; loose stacks toppled/scattered without energy injection. Cracks happened at plausible arrival speeds for the drop heights chosen.
- **F3 balloons**: string suspensions all clean, including spans straddling the 0.85 m chaining threshold (frames show single smooth tethers, no "brown stick" spray). Failures are confined to the taped-cluster/overlap class (BUG-4). Floaters ended mid-air (OBS-1).
- **F4 parachutes**: the canopy model is a highlight — correct single/double/harness behavior, correct Mars/Venus extremes, bag-below-egg legitimately self-rights, taped bag stable. Only the Moon run is tainted (BUG-2).
- **F5 frames**: cages, boxes, lattices, and suspensions all structurally sane; tape and glue twins behaved identically pre-break as expected. The outrigger build is fine physically; its verdict is about the metric (BUG-3).
- **F6 tethers/pendulums**: metre-class chained tethers (string and tape) hang, swing, and land smoothly; daisy chains unroll in order; crossed ropes don't snag; the 1.5 m whip and break-force cases resolve cleanly. Over-vacuum impacts here are explained by assembly-span potential energy, not defects.
- **F7 springs**: no resonance growth anywhere, including serial band chains, Jupiter gravity, vacuum (undamped) oscillation, and spring-over-bouncy-sponge stacking. The 0.9 m band correctly does not chain.
- **F8 ballast**: the 945:1 density weld, 10-weight column, weighted raft, and lead-balloon couple are all stable — historically hard cases for iterative solvers, handled well.
- **F9 planet sweeps**: gravity and atmosphere wiring is directionally correct everywhere (Moon no-lift, Venus ascent, Uranus partial lift, cushion severity ordering Moon < Neptune < Jupiter). The quantitative deficits on airless/thin planets are BUG-2.
- **F10 adversarial**: the robustness surprises of the campaign — interpenetrating foam, zero-span welds, joint cycles, welds through parts, welds fully inside parts, zero-length ropes, a 96-body peanut pile, and an engineered whip all behaved. Only the balloon sandwich failed.

## Areas verified healthy

Segmented tether chaining (above/below 0.85 m), rope/spring joint families in every configuration tried, joint break handling under whip loads, 96-body contact piles, extreme mass-ratio welds, degenerate joints (zero-span, zero-length, cycles, through-part, inside-part), parachute canopy aerodynamics including self-righting, balloon behavior on strings, cushion contact (no trampolining in any of the raft/bumper/trampoline builds), planet gravity scaling, and the directional atmosphere effects.

## Suggested AGENTS.md additions (to apply later, with the fixes)

- §4 metric coherence: "Reported peak load should be planet-independent for the same deceleration — a Moon drop reading higher G than a faster Earth drop indicates local-gravity normalization (BUG-1 class)."
- §8 atmosphere: "On airless bodies, impact speed must be within ~2% of √(2gh); a deficit that scales with material `linearDamping` means body damping is acting as phantom drag (BUG-2 class)."
- §4 metric coherence: "Reported impact speed above the egg's own observed TOP speed means the metric recorded a relative speed against a flung part, not the landing (BUG-3 class)."
- §5/§6 structural/contact: "Balloon shell forces between bodies welded into the same fixed-joint assembly (including transitively via the egg) inject energy; ≥3 taped balloons or shell-overlapping welded balloons are the signature (BUG-4 class)."

## Artifacts

- Corpus + variants: `apps/web/e2e/validation/designs.ts` (100 base + 25 variants, `parentId`-keyed)
- Runner: `apps/web/e2e/validation/run-validation.spec.ts` (filter with `VALIDATION_FILTER`)
- Schema gate: `apps/web/src/validation/corpus.test.ts` (128 vitest assertions, all passing)
- Raw results: `/tmp/eggdrop-validation/<id>/result.json` + screenshots; aggregate at `/tmp/eggdrop-validation/summary.json`
