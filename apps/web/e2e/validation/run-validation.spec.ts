import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import {
  ALL_SPECS,
  PLANET_INDEX,
  PLANET_INFO,
  type DesignSpec,
  type ValidationSpec,
} from "./designs";

/**
 * Physics validation campaign runner.
 *
 * For each corpus design: seed via addInitScript, release the drop, sample the
 * HUD every ~150 ms, screenshot every ~1 s, read the result card, evaluate the
 * machine-checkable invariants (AGENTS.md sections 3-7), and write a
 * machine-readable result JSON to /tmp/eggdrop-validation/<id>/result.json.
 *
 * Tests only FAIL on harness problems (design failed to load / page broke).
 * Physics verdicts (VALID / SUSPECT / INVALID) live in the JSON so a batch
 * always completes and triage never depends on Playwright output parsing.
 *
 * Filter with VALIDATION_FILTER: comma-separated tokens matched as substrings
 * of the structure id or exact family name, e.g.
 *   VALIDATION_FILTER=f3 npx playwright test e2e/validation/run-validation.spec.ts
 *   VALIDATION_FILTER=f3-tape-two,f6-string-1m npx playwright test ...
 */

const OUT_ROOT = "/tmp/eggdrop-validation";

const FEET_TO_METERS = 0.3048;

// Mirrors DropScene.tsx timing constants (do not import app code into e2e).
const RELEASE_HOLD_S = 0.5;
const OUTCOME_REVEAL_S = 0.8;
const SIM_TIMEOUT_S = 20;

/** Mirror of maxPlausibleSpeedMps in apps/web/src/scene/watchdog.ts. */
const maxPlausibleSpeedMps = (heightFt: number, gravityMps2: number): number => {
  const freeFall = Math.sqrt(2 * Math.max(0, gravityMps2) * FEET_TO_METERS * Math.max(0, heightFt));
  return Math.max(25, 1.5 * freeFall);
};

/** Vertical extent of the whole assembly in feet (adds tether swing headroom to I1/I2). */
const assemblySpanFt = (design: DesignSpec): number => {
  let minY = design.eggTransform.position[1] - design.eggTransform.dimensions[1] / 2;
  let maxY = design.eggTransform.position[1] + design.eggTransform.dimensions[1] / 2;
  for (const part of design.parts) {
    const half = Math.max(...part.transform.dimensions) / 2;
    minY = Math.min(minY, part.transform.position[1] - half);
    maxY = Math.max(maxY, part.transform.position[1] + half);
  }
  return Math.max(0, maxY - minY) / FEET_TO_METERS;
};

interface Sample {
  tMs: number;
  current: number | null;
  top: number | null;
}

interface RunResult {
  id: string;
  family: string;
  name: string;
  parentId?: string;
  settings: ValidationSpec["settings"];
  planetIndex: number;
  gravityMps2: number;
  airDensityKgM3: number;
  spanFt: number;
  speedCeilingMps: number;
  vacuumImpactMps: number;
  freeFallTimeS: number;
  outcome: "survived" | "cracked" | "airborne" | "none";
  resultAtMs: number | null;
  simTimeAtResultS: number | null;
  metrics: {
    heightText: string | null;
    impactSpeedMps: number | null;
    peakG: number | null;
    peakForceN: number | null;
  };
  maxTopSpeedMps: number;
  lastCurrentSpeedMps: number | null;
  samples: Sample[];
  consoleEvents: { type: string; text: string }[];
  screenshots: number;
  invariants: Record<string, { pass: boolean; note: string }>;
  flags: string[];
  verdict: "VALID" | "SUSPECT" | "INVALID";
  startedAtIso: string;
}

const parseSpeed = (text: string | undefined): number | null => {
  if (!text) return null;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
};

const filterTokens = (process.env.VALIDATION_FILTER ?? "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);

const selected = filterTokens.length === 0
  ? ALL_SPECS
  : ALL_SPECS.filter((spec) =>
      filterTokens.some((token) => spec.id.includes(token) || spec.family === token),
    );

for (const structure of selected) {
  test(`${structure.id}`, async ({ page }) => {
    test.setTimeout(90_000);
    const dir = path.join(OUT_ROOT, structure.id);
    fs.mkdirSync(dir, { recursive: true });

    const consoleEvents: { type: string; text: string }[] = [];
    page.on("console", (message) => {
      const type = message.type();
      if (type === "warning" || type === "error") {
        consoleEvents.push({ type, text: message.text().slice(0, 600) });
      }
    });
    page.on("pageerror", (error) => {
      consoleEvents.push({ type: "pageerror", text: String(error).slice(0, 600) });
    });

    await page.addInitScript((design) => {
      localStorage.setItem("eggdrop3d:active-draft:v1", JSON.stringify(design));
    }, structure.design);
    await page.goto("/");
    await page.getByRole("heading", { name: "Choose a material" }).waitFor();

    // Fidelity check: the exact design must have loaded (AGENTS.md section 1).
    if (structure.design.parts.length > 0) {
      const partCount = structure.design.parts.length;
      const jointCount = structure.design.joints.length;
      const partsLabel = `${partCount} part${partCount === 1 ? "" : "s"}`;
      const jointsLabel = `${jointCount} connection${jointCount === 1 ? "" : "s"}`;
      await expect(page.getByText(`${partsLabel} · ${jointsLabel}`)).toBeVisible();
    }

    const playback = structure.settings.playback;
    const planetIndex = PLANET_INDEX[structure.settings.planet];
    await page.getByRole("button", { name: /set up drop/i }).click();
    const setup = page.getByRole("dialog", { name: /how high/i });
    await setup.getByRole("slider", { name: "Drop height in feet" }).fill(String(structure.settings.heightFt));
    await setup.getByRole("slider", { name: "Planet" }).fill(String(planetIndex));
    await setup.getByRole("slider", { name: "Drop playback speed" }).fill(String(playback));
    await setup.getByRole("button", { name: /release contraption/i }).click();
    const released = Date.now();

    // Sampling loop until the result dialog or the wall budget.
    const budgetMs = (RELEASE_HOLD_S + SIM_TIMEOUT_S / playback + OUTCOME_REVEAL_S) * 1000 + 10_000;
    const samples: Sample[] = [];
    const dialog = page.getByRole("dialog", { name: /The egg survived|Crack!|still airborne/i });
    let maxTop = 0;
    let lastShotAt = 0;
    let shotCount = 0;
    let resultAtMs: number | null = null;

    while (Date.now() - released < budgetMs) {
      const texts = await page.locator(".speed-metric strong").allTextContents().catch(() => [] as string[]);
      const current = parseSpeed(texts[0]);
      const top = parseSpeed(texts[texts.length - 1]);
      samples.push({ tMs: Date.now() - released, current, top });
      if (top !== null) maxTop = Math.max(maxTop, top);

      if (Date.now() - lastShotAt >= 1_000) {
        const shotPath = path.join(dir, `t${String(shotCount).padStart(3, "0")}.png`);
        await page.screenshot({ path: shotPath }).catch(() => {});
        lastShotAt = Date.now();
        shotCount += 1;
      }

      if ((await dialog.count()) > 0) {
        resultAtMs = Date.now() - released;
        break;
      }
      await page.waitForTimeout(150);
    }

    // Result card metrics.
    let outcome: RunResult["outcome"] = "none";
    let heightText: string | null = null;
    let impactSpeedMps: number | null = null;
    let peakG: number | null = null;
    let peakForceN: number | null = null;
    if (resultAtMs !== null) {
      const heading = await dialog.getByRole("heading").first().innerText().catch(() => "");
      outcome = /crack/i.test(heading) ? "cracked" : /airborne/i.test(heading) ? "airborne" : "survived";
      const metric = async (label: string): Promise<number | null> => {
        const text = await dialog
          .locator(".metric-grid > div")
          .filter({ hasText: label })
          .locator("strong")
          .innerText()
          .catch(() => null);
        return text === null ? null : parseSpeed(text);
      };
      heightText = await dialog
        .locator(".metric-grid > div")
        .filter({ hasText: "Drop height" })
        .locator("strong")
        .innerText()
        .catch(() => null);
      impactSpeedMps = await metric("Impact speed");
      peakG = await metric("Peak load");
      peakForceN = await metric("Peak force");
      await page.screenshot({ path: path.join(dir, "result.png") }).catch(() => {});
    } else {
      await page.screenshot({ path: path.join(dir, "no-result.png") }).catch(() => {});
    }

    // ---------------- Invariants (machine-checkable subset) ----------------
    const { gravityMps2, airDensityKgM3 } = PLANET_INFO[structure.settings.planet];
    const spanFt = assemblySpanFt(structure.design);
    const ceiling = maxPlausibleSpeedMps(structure.settings.heightFt + spanFt, gravityMps2);
    const vacuumImpact = Math.sqrt(2 * gravityMps2 * FEET_TO_METERS * structure.settings.heightFt);
    const freeFallTimeS = Math.sqrt((2 * FEET_TO_METERS * structure.settings.heightFt) / gravityMps2);
    const simTimeAtResultS = resultAtMs === null
      ? null
      : Math.max(0, resultAtMs / 1000 - RELEASE_HOLD_S - OUTCOME_REVEAL_S) * playback;
    const lastCurrent = [...samples].reverse().find((s) => s.current !== null)?.current ?? null;

    const invariants: RunResult["invariants"] = {};
    const flags: string[] = [];

    // I1 — live TOP speed under the plausibility ceiling.
    invariants.I1_speed_ceiling = {
      pass: maxTop <= ceiling,
      note: `maxTop=${maxTop.toFixed(2)} ceiling=${ceiling.toFixed(2)}`,
    };
    // I2 — reported impact under the ceiling; soft flag when above vacuum free-fall in atmosphere.
    const impactOverCeiling = impactSpeedMps !== null && impactSpeedMps > ceiling;
    invariants.I2_impact_ceiling = {
      pass: !impactOverCeiling,
      note: `impact=${impactSpeedMps ?? "n/a"} ceiling=${ceiling.toFixed(2)}`,
    };
    const impactAboveVacuum =
      impactSpeedMps !== null && airDensityKgM3 > 0 && impactSpeedMps > vacuumImpact + 0.5;
    if (impactAboveVacuum) flags.push("impact-above-vacuum-freefall");
    // I3 — crack markedly before minimum free-fall time means mid-air damage.
    const earlyCrack =
      outcome === "cracked" &&
      simTimeAtResultS !== null &&
      simTimeAtResultS < 0.6 * freeFallTimeS;
    invariants.I3_outcome_timing = {
      pass: !earlyCrack,
      note: `simTime=${simTimeAtResultS?.toFixed(2) ?? "n/a"} 0.6*tFF=${(0.6 * freeFallTimeS).toFixed(2)}`,
    };
    // I4 — extreme G from a short drop is a contact/solver spike.
    const gSpike = peakG !== null && peakG > 150 && structure.settings.heightFt <= 10;
    invariants.I4_load_sanity = {
      pass: !gSpike,
      note: `peakG=${peakG ?? "n/a"} heightFt=${structure.settings.heightFt}`,
    };
    // I5 — run that only ends at the simulation timeout while visually static.
    const endedAtTimeout = simTimeAtResultS !== null && simTimeAtResultS >= SIM_TIMEOUT_S - 0.5;
    const staticAtEnd = lastCurrent !== null && lastCurrent < 0.5;
    invariants.I5_settle_honesty = {
      pass: !(endedAtTimeout && staticAtEnd),
      note: `endedAtTimeout=${endedAtTimeout} lastCurrent=${lastCurrent ?? "n/a"}`,
    };
    if (endedAtTimeout) flags.push("ended-at-sim-timeout");
    // I6 — watchdog clamps, NaN, panics, page errors.
    const solverEvents = consoleEvents.filter((event) =>
      /watchdog|runaway|clamp|nan|panic|unreachable|RuntimeError/i.test(event.text) ||
      event.type === "pageerror",
    );
    invariants.I6_solver_health = {
      pass: solverEvents.length === 0,
      note: solverEvents.length === 0 ? "clean" : solverEvents[0]!.text.slice(0, 200),
    };
    if (outcome === "none") flags.push("no-result-dialog");
    // Benign boot noise seen on every run: a 404 for an optional resource and
    // the Rapier init deprecation warning. Only unexpected console output flags.
    const meaningfulConsole = consoleEvents.filter(
      (event) =>
        !/Failed to load resource.*404|deprecated parameters for the initialization/i.test(
          event.text,
        ),
    );
    if (meaningfulConsole.length > 0) flags.push("console-noise");

    const hardFail =
      !invariants.I1_speed_ceiling!.pass ||
      !invariants.I2_impact_ceiling!.pass ||
      !invariants.I6_solver_health!.pass ||
      outcome === "none";
    const softFail =
      !invariants.I3_outcome_timing!.pass ||
      !invariants.I4_load_sanity!.pass ||
      !invariants.I5_settle_honesty!.pass ||
      impactAboveVacuum;
    const verdict: RunResult["verdict"] = hardFail ? "INVALID" : softFail ? "SUSPECT" : "VALID";

    const result: RunResult = {
      id: structure.id,
      family: structure.family,
      name: structure.name,
      parentId: structure.parentId,
      settings: structure.settings,
      planetIndex,
      gravityMps2,
      airDensityKgM3,
      spanFt: Number(spanFt.toFixed(2)),
      speedCeilingMps: Number(ceiling.toFixed(2)),
      vacuumImpactMps: Number(vacuumImpact.toFixed(2)),
      freeFallTimeS: Number(freeFallTimeS.toFixed(2)),
      outcome,
      resultAtMs,
      simTimeAtResultS: simTimeAtResultS === null ? null : Number(simTimeAtResultS.toFixed(2)),
      metrics: { heightText, impactSpeedMps, peakG, peakForceN },
      maxTopSpeedMps: maxTop,
      lastCurrentSpeedMps: lastCurrent,
      samples,
      consoleEvents: consoleEvents.slice(0, 40),
      screenshots: shotCount,
      invariants,
      flags,
      verdict,
      startedAtIso: new Date(released).toISOString(),
    };
    fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(result, null, 2));
  });
}
