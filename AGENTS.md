# Agent guide — EggDrop3D

This file is for AI agents (and humans) working in this repo. When a user asks whether a drop **behaves as expected**, **looks wrong**, or **physics is broken**, follow the simulation validation guide below before claiming success or diagnosing a design failure.

## Core rule

**Never answer “physics looks healthy” from a single number or a different build than the user’s.**

Separate two questions:

1. **Is the simulation valid?** (solver stable, metrics coherent, visuals match physics)
2. **Did the design succeed?** (egg survived landing at plausible loads)

A cracked egg can mean a bad design **or** a broken solver. Invalid simulation must be reported first; do not blame cushioning, drag, or student skill until validity checks pass.

---

## Simulation validation guide

Use this as a **broad invariant framework**, not a fixed checklist. New bugs should fail one or more principles even if they are not listed as examples.

### 1. Reproduce fidelity (mandatory)

Match the user’s scenario before judging behavior.

- **Design**: Read `localStorage` key `eggdrop3d:active-draft:v1` in the browser, or seed the same JSON via Playwright `addInitScript` (not `evaluate` after load — autosave can overwrite).
- **Settings**: Drop height (ft), planet (`gravityBodyId` → gravity + **air density**), playback rate.
- **Joints**: Kind (`fixed` tape/glue vs `rope` string), material, body pair, anchor span. Tape and string behave very differently.
- **Build**: `npm run build -w @eggdrop/web` before Playwright `preview` e2e — stale `dist` has caused false passes.

If you did not run **their** build at **their** height and planet, say **“not verified”** — not “healthy.”

### 2. Observe behavior, not only HUD numbers

Peak speed alone is insufficient. Prefer at least one of:

- Screen recording or **dense frame extraction** (`ffmpeg -i video.mov -vf fps=2 frame_%03d.png`)
- Playwright run with periodic screenshots
- Browser MCP: release drop, screenshot through the run

Watch for: violent oscillation, bodies separating, jitter at rest, result dialog while still near release height, tether lines zigzagging or segmenting into “brown sticks,” balloons squirting sideways, egg flying off-screen.

**Humans notice patterns across time; agents must mimic that with frames or video, not one snapshot.**

### 3. Kinematic plausibility (motion makes sense)

Ask: *Could this motion occur under gravity + atmosphere on the selected planet, without the solver injecting energy?*

| Signal | Suspicious if |
|--------|----------------|
| Speed vs height | High speed while most of the drop height remains (e.g. &gt; ~5 m/s near top of a 100 ft tower on Earth without a long fall first) |
| Speed magnitude | Any body speed orders of magnitude above expectations |
| Direction | Egg accelerates horizontally with no plausible push; assembly spins up without contact |
| Descent | Contraption hovers or rises without enough balloon lift; falls faster than vacuum free-fall |
| Settle | Perpetual jitter at rest; never reaches sleep when visually still |

**Vacuum free-fall ceiling** from drop height \(h\) m and gravity \(g\) m/s²:

\[
v_{\text{vacuum}} = \sqrt{2 g h}
\]

Example: 100 ft (30.48 m) on Earth (\(g \approx 9.81\)) → ~24.5 m/s. With atmosphere, terminal behavior is usually **at or below** this unless something else is pushing (bad solver, not “more gravity”).

Code reference: `maxPlausibleSpeedMps` in `apps/web/src/scene/watchdog.ts` uses \(1.5 \times v_{\text{vacuum}}\) with a floor — a **generous** divergence threshold, not a target speed.

### 4. Metric coherence (results must agree with motion)

When the run ends, cross-check the result card against physics and what you saw.

| Metric | Plausibility |
|--------|----------------|
| **Impact speed** | Should not exceed `maxPlausibleSpeedMps(heightFt, gravityMps2)` without a documented reason. Impact &gt; \(v_{\text{vacuum}}\) on Earth is a **strong** glitch signal. |
| **Peak G / peak force** | Extreme values (e.g. 99–260 G) from a short tower drop usually indicate contact/solver spikes, not a real landing. |
| **Outcome timing** | “Crack!” / “Survived” while the egg is still visually near release height → outcome driven by mid-air damage, not landing. |
| **Live vs top speed** | TOP climbing while current speed and altitude suggest gentle motion → transient spike or HUD lag; investigate frames. |

Treat **implausible metrics** as simulation failure even if the UI labels the run “Test complete.”

Fixed-regression examples (2026-08 campaign, regression spec `apps/web/e2e/physics-fixes.spec.ts`):

- Reported peak load should be **planet-independent** for the same deceleration — a Moon drop reading higher G than a faster Earth drop indicates local-gravity normalization (BUG-1 class).
- Reported impact speed **above the egg's own observed TOP speed** means the metric recorded a relative speed against a flung part, not the landing (BUG-3 class).
- A run that ends at the 20 s timeout with the egg still well off the ground reports **“still airborne”**, not “survived” — a “survived” verdict while frames show the egg floating is an outcome-semantics bug (OBS-1 class).

### 5. Structural integrity (joints and assemblies)

Inspect the **design graph**, not only runtime speed.

- **Tape / glue (`fixed`)**: Rigid welds. Short welds between a light egg and buoyant balloons are a known ill-conditioned case (pendulum + lift + low egg inertia).
- **String (`rope`)**: Distance constraint. Should appear as one logical tether unless span triggers segmented chains (see below).
- **Segmented chains**: Long tape/string tethers become capsule segments + spherical joints (`isChainedJoint` in `DropScene.tsx`, `MIN_SEGMENTED_ROPE_LENGTH_M` in `ropeChain.ts`). Short egg–balloon links should **not** chain; if you see many brown capsule “sticks” spraying apart, chain segmentation or segment collisions are suspect.
- **Broken joints**: `JointBreakMonitor` can remove connectors when estimated load exceeds `breakForceN` — verify breaks are intentional, not noise from solver explosions.
- **Assembly contact suppression**: Overlapping taped parts and overlapping balloons get contact suppression via noop joints — if jitter persists, suppression may be missing for this pose.

When joints **visually disconnect** or segments **scatter**, that is a simulation defect until proven otherwise.

Fixed-regression example: balloon shell forces between bodies welded into the same fixed-joint assembly (including transitively via the egg) injected energy — ≥3 taped balloons or shell-overlapping welded balloons were the signature (BUG-4 class). `BalloonSuspension` now skips same-weld-assembly pairs (`calculateWeldedAssemblyRoots`), and star-shaped weld hubs get hidden spoke-to-spoke bracing welds (`calculateBracingJoints`) so corrections do not funnel through the egg's tiny inertia.

### 6. Contact and soft-body plausibility

- **Balloons**: Outer shell is pneumatic (`BalloonSuspension`); core is a small rigid sphere. Overlapping balloon **cores** fighting causes jitter; overlapping shells without suppression look wrong.
- **Landing cushions**: Raft-on-balloons should cushion, not trampoline the egg into the air at tens of m/s.
- **Plastic bag**: Canopy model can self-right; payload-aware blockage matters when egg is above vs below bag.

Sudden separation of loosely stacked parts (balloons squirting from under a raft) usually means contact law or reduced-mass tuning, not “student built it wrong.”

### 7. Temporal stability (energy over time)

Valid physics **does not** add sustained energy while altitude barely changes.

Red flags:

- Speed grows geometrically over a few physics steps at fixed height
- Oscillation amplitude increases without a new contact event
- Watchdog clamps speed (`MonitorBridge` / `classifyBodyMotion`) — if clamps fire, report instability even if the run “finishes”
- NaN positions, bodies at absurd distance (`WATCHDOG_MAX_DISTANCE_M`)

### 8. Planet and atmosphere consistency

Planet slider sets **both** `gravityMps2` and `airDensityKgM3` (`GRAVITY_BODIES` in `packages/shared/src/physics.ts`).

Changing planet should change:

- Fall acceleration
- Drag and wind
- Balloon buoyancy and added mass

If behavior is identical across Moon and Venus, atmosphere may not be wired through. If balloons lift on the Moon, buoyancy logic is wrong.

Fixed-regression example: on airless bodies, impact speed must be within ~2% of √(2gh); a deficit that scales with the material's `linearDamping` means body damping is acting as phantom drag (BUG-2 class — damping now scales with air density via `atmosphericDamping` in `DropScene.tsx`).

### 9. Legitimate design failure (only after validity passes)

Only after sections 1–8 pass (or failures are minor and explained) may you attribute outcome to the build:

- Bare egg or minimal cushioning at high drop → crack on landing at **plausible** impact speed and G
- Slow settle on soft cushions → may be OK if metrics are sane

Use language like: *“Simulation looks valid; the egg cracked because…”* — never conflate with solver blow-up.

---

## Investigation playbook

### Quick automated signals

```bash
npm run build -w @eggdrop/web
cd apps/web && npx playwright test e2e/balloon-lift-repro.spec.ts e2e/string-balloon-stability.spec.ts
npm test
```

Existing regression specs encode **known** failure modes; passing them does **not** prove an arbitrary user build is fine.

### Reproduce a user build in Playwright

1. Copy design JSON from browser `localStorage` or user export.
2. `page.addInitScript((d) => localStorage.setItem('eggdrop3d:active-draft:v1', JSON.stringify(d)), design)`
3. `goto`, set up drop, match height / planet index / playback.
4. Poll `.speed-metric strong` for TOP speed; wait for result dialog.
5. Assert impact text and capture screenshots on failure.

Planet slider: `aria-label="Planet"`, Earth is typically index `3` in `GRAVITY_BODY_IDS`.

### Video / browser forensics

```bash
ffmpeg -i /path/to/video.mov -vf fps=2 /tmp/frames/frame_%03d.png
```

For each frame note: tower marker vs egg height, speed HUD, tether appearance, balloon positions.

### Code map (physics realism)

| Area | Location |
|------|----------|
| Watchdog / speed ceiling | `apps/web/src/scene/watchdog.ts` |
| Drop loop, damage, finish | `apps/web/src/scene/DropScene.tsx` (`MonitorBridge`) |
| Segmented tethers | `ropeChain.ts`, `isChainedJoint`, `SegmentedChainConnector` |
| Balloon contacts | `balloonContact.ts`, `BalloonSuspension` |
| Aero / wind | `aero.ts`, `wind.ts` |
| Breakable joints | `JointBreakMonitor` |
| Planet atmosphere | `packages/shared/src/physics.ts` |

---

## Reporting template

When answering “does it behave as expected?”:

```markdown
## Validity
- Reproduced: [exact build / or not]
- Observed: [frames/video summary]
- Metric checks: [impact vs ceiling, G, speed vs height]
- Structural: [joint types, chaining, breaks]

## Verdict
- [ ] Simulation valid
- [ ] Simulation invalid — [symptoms]

## Design outcome (only if valid)
- [survived / cracked] — [why, in plain language]
```

If validity is **not** established, the verdict must be **“cannot confirm healthy physics”** or **“simulation appears broken.”**

---

## Extending this guide

When you discover a **new** failure mode:

1. Describe which **principle** it violates (kinematic, metric, structural, contact, temporal, atmosphere).
2. Add a **detectable signal** (inequality, visual pattern, or test assertion).
3. Prefer a **regression e2e** or unit test if the scenario is stable and fast.
4. Add a one-line example under the relevant section above — keep principles broad, examples illustrative.

Avoid growing a flat checklist of every bug ever seen; grow **invariants** and **examples**.

---

## Project commands (reference)

```bash
npm run dev          # Vite at :5173, API at :8787
npm run typecheck
npm test
cd apps/web && npx playwright test
```

Do not commit unless the user asks. Do not push unless the user asks.
