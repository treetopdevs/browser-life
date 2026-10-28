import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ORIGIN = `http://localhost:${process.env.BL_E2E_PORT || "5419"}`;
const BASE = `${ORIGIN}/docs/creative-prototypes/`;
const DOCS = resolve("docs/creative-prototypes");
const EMPTY_FOOD = Buffer.alloc(96 * 96, 20).toString("base64");
const GENOME = { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 };

function hash(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }

function environment(tick: number, mode: "uniform" | "moving-band") {
  const pulses = Math.floor(tick / 5);
  const offered = pulses * 768;
  return {
    version: 1, mode, pulseBudget: 768, targetCount: mode === "moving-band" ? 4608 : 9216,
    pulses, offered, accepted: offered, overflow: 0, initialFoodPerTile: 20,
    ...(mode === "moving-band" ? { bandLeft: Math.floor(tick / 50) % 96, bandWidth: 48 } : {}),
  };
}

function census(tick: number, extinct: boolean) {
  return { tick, population: extinct ? 0 : 2, cells: extinct ? 0 : 3,
    familyCounts: extinct ? [0, 0, 0] : [1, 1, 0], births: 0, deaths: extinct ? 2 : 0,
    maxGeneration: 0, totalCells: extinct ? 0 : 3 };
}

type ArmFixture = {
  schemaVersion: number;
  kind: string;
  run: { seed: number; mode: "uniform" | "moving-band"; mutation: boolean; maxTick: number; finalTick: number; extinctionTick: number | null };
  runtime: { node: string; platform: string; arch: string };
  rules: { width: number; height: number; tileCount: number; maxHistory: number };
  provenance: { sourceSha256: Record<string, string>; baselineArtifactSha256: string; baselineDataSha256: string; prefix: Record<string, any> };
  samples: any[];
  frames: any[];
  tickRows: any[];
  windows: any[];
  snapshots: any[];
  repeat: { verified: boolean; comparedThroughTick: number; stateChecks: number; frameChecks: number };
  numericalGate: Record<string, unknown>;
  final: Record<string, unknown>;
  dataSha256?: string;
};

const sourceHashes = {
  "apps/lab/src/moving-food/model.ts": "a".repeat(64),
  "tools/moving-food/explore.ts": "b".repeat(64),
  "apps/lab/src/uniform-endurance/model.ts": "c".repeat(64),
  "tools/uniform-endurance/explore.ts": "d".repeat(64),
  "docs/creative-prototypes/uniform-food-seed-1201.json": "e".repeat(64),
};

function makeArm(mode: "uniform" | "moving-band", finalTick: number, extinct = false): ArmFixture {
  const ticks = Array.from({ length: Math.floor(finalTick / 20) + 1 }, (_, i) => i * 20);
  if (ticks.at(-1) !== finalTick) ticks.push(finalTick);
  const organisms = [
    { id: 1, family: 0, genome: GENOME },
    { id: 2, family: 1, genome: { ...GENOME, turn: 1 } },
  ];
  const liveCells: [number, number][] = [[0, 1], [1, 1], [97, 2]];
  const samples = ticks.map((tick) => {
    const isExtinct = extinct && tick === finalTick;
    return { tick, census: census(tick, isExtinct), environment: environment(tick, mode),
      censusSha256: "0".repeat(64), stateSha256: "0".repeat(64), frameSha256: "0".repeat(64) };
  });
  const frames = ticks.map((tick) => {
    const isExtinct = extinct && tick === finalTick;
    return { tick, censusSha256: "0".repeat(64), stateSha256: "0".repeat(64), foodBase64: EMPTY_FOOD,
      cells: isExtinct ? [] : liveCells, organisms: isExtinct ? [] : organisms,
      ledger: { initialEnergy: 100, supplied: 0, dissipated: 0, deathLoss: 0, expected: 100, actual: 100, residual: 0 },
      frameSha256: "0".repeat(64) };
  });
  const expectedWindow = (from: number, to: number) => {
    const executedTicks = Math.max(0, Math.min(to, finalTick) - from + 1);
    const status = executedTicks === 0 ? "not-reached" : executedTicks === 500 ? "complete" : "partial";
    if (status === "not-reached") return { from, to, denominatorTicks: 500, status, executedTicks,
        births: null, deaths: null, cap48Ticks: null, nearCap47Ticks: null, blockedCapAttempts: null,
      blockedSpaceAttempts: null, minPopulation: null, maxPopulation: null,
      food: { offered: null, accepted: null, overflow: null }, endpoint: { requestedTick: to, actualTick: null,
        population: null, cells: null, familyCounts: null, genomeCounts: [], maxGeneration: null,
        maxEverGeneration: null, foodRemaining: null, bandLeft: null, occupiedBandCells: null, occupiedBandShare: null } };
    const endpointTick = Math.min(to, finalTick);
    const endExtinct = extinct && endpointTick === finalTick;
    const endEnvironment = environment(endpointTick, mode);
    const startEnvironment = environment(from - 1, mode);
    const bandLeft = Math.floor(endpointTick / 50) % 96;
    const occupiedBandCells = endExtinct ? 0 : liveCells.filter(([tile]) => (tile % 96 - bandLeft + 96) % 96 < 48).length;
    return { from, to, denominatorTicks: 500, status, executedTicks,
      births: 0, deaths: endExtinct ? 2 : 0, cap48Ticks: 0, nearCap47Ticks: 0,
      blockedCapAttempts: 0, blockedSpaceAttempts: 0, minPopulation: endExtinct ? 0 : 2,
      maxPopulation: 2, food: { offered: endEnvironment.offered - startEnvironment.offered,
        accepted: endEnvironment.accepted - startEnvironment.accepted, overflow: endEnvironment.overflow - startEnvironment.overflow },
      endpoint: { requestedTick: to, actualTick: endpointTick, population: endExtinct ? 0 : 2,
        cells: endExtinct ? 0 : 3, familyCounts: endExtinct ? [0, 0, 0] : [1, 1, 0],
        genomeCounts: endExtinct ? [] : [{ genome: GENOME, count: 1 }, { genome: { ...GENOME, turn: 1 }, count: 1 }], maxGeneration: 0, maxEverGeneration: 0,
        foodRemaining: 96 * 96 * 20, bandLeft,
        occupiedBandCells, occupiedBandShare: endExtinct ? null : occupiedBandCells / 3 } };
  };
  const proof = mode === "uniform"
    ? { status: "verified", seed: 1201, normalization: "none; maxHistory 451 is unchanged", comparedSamples: 151,
      comparedFrames: 151, comparedTickRows: 3000, comparedSnapshots: 1,
      checkpoints: [{ tick: 0, stateSha256: "f".repeat(64), compared: true }] }
    : { status: "not-applicable", seed: null, normalization: "none; moving-band is not the uniform control",
      comparedSamples: 0, comparedFrames: 0, comparedTickRows: 0, comparedSnapshots: 0, checkpoints: [] };
  const tickRows = Array.from({ length: finalTick }, (_, index) => {
    const tick = index + 1;
    const zero = extinct && tick === finalTick;
    return { tick, population: zero ? 0 : 2, births: 0, deaths: zero ? 2 : 0,
      blockedCap: 0, blockedSpace: 0, cap48: false, nearCap47: false };
  });
  const windowRanges = [[1501, 2000], [2001, 2500], [2501, 3000]] as const;
  const snapshots = [...new Set([0, 500, 1500, 2500, 3000, finalTick].filter((tick) => tick <= finalTick))].map((tick) => {
    const sample = samples.find((entry) => entry.tick === tick)!;
    return { tick, terminal: extinct && tick === finalTick, environment: sample.environment, state: { tick }, stateSha256: "f".repeat(64) };
  });
  const record: ArmFixture = {
    schemaVersion: 1, kind: "hungry-shapes-moving-food-arm",
    run: { seed: 1201, mode, mutation: true, maxTick: 3000, finalTick, extinctionTick: extinct ? finalTick : null },
    runtime: { node: "24.2.0", platform: "darwin", arch: "arm64" },
    rules: { width: 96, height: 96, tileCount: 9216, maxHistory: 451 },
    provenance: { sourceSha256: sourceHashes, baselineArtifactSha256: "d".repeat(64), baselineDataSha256: "e".repeat(64), prefix: proof },
    samples, frames, tickRows,
    windows: windowRanges.map(([from, to]) => expectedWindow(from, to)), snapshots,
    repeat: { verified: true, comparedThroughTick: finalTick, stateChecks: ticks.length, frameChecks: ticks.length },
    numericalGate: { aliveAt3000: !extinct, eachWindowHasBirthsAndDeaths: false, eachWindowCap48AtMost99: true,
      allWindowsReached: !extinct, atLeastTwoFamiliesAt3000: !extinct, numericalPass: false, note: "Fixture only." },
    final: { census: samples.at(-1)?.census, environment: samples.at(-1)?.environment, lineage: [] },
  };
  return sealArm(record);
}

function sealArm(arm: ArmFixture): ArmFixture {
  for (const snapshot of arm.snapshots) {
    const sample = arm.samples.find((entry) => entry.tick === snapshot.tick);
    if (sample) sample.stateSha256 = hash(JSON.stringify({ state: snapshot.state, environment: snapshot.environment }));
    if (sample) snapshot.stateSha256 = sample.stateSha256;
  }
  for (let index = 0; index < arm.frames.length; index++) {
    const frame = arm.frames[index];
    const sample = arm.samples[index];
    sample.censusSha256 = hash(JSON.stringify(sample.census));
    if (!/^[a-f0-9]{64}$/.test(sample.stateSha256)) sample.stateSha256 = "f".repeat(64);
    frame.censusSha256 = sample.censusSha256;
    frame.stateSha256 = sample.stateSha256;
    const frameBase = { tick: frame.tick, censusSha256: frame.censusSha256, stateSha256: frame.stateSha256,
      foodBase64: frame.foodBase64, cells: frame.cells, organisms: frame.organisms, ledger: frame.ledger };
    frame.frameSha256 = hash(JSON.stringify(frameBase));
    sample.frameSha256 = frame.frameSha256;
  }
  if (arm.run.mode === "uniform") arm.provenance.prefix.checkpoints[0]!.stateSha256 = arm.samples[0]!.stateSha256;
  arm.final.census = arm.samples.at(-1)?.census;
  arm.final.environment = arm.samples.at(-1)?.environment;
  arm.final.stateSha256 = arm.samples.at(-1)?.stateSha256;
  delete arm.dataSha256;
  arm.dataSha256 = hash(JSON.stringify(arm));
  return arm;
}

function indexFor(uniform = makeArm("uniform", 3000), movingBand = makeArm("moving-band", 1703, true)) {
  const uniformText = JSON.stringify(uniform);
  const movingText = JSON.stringify(movingBand);
  const uniformSha = hash(uniformText);
  const movingSha = hash(movingText);
  return { index: { schemaVersion: 1, kind: "hungry-shapes-moving-food-pair", seed: 1201,
    arms: { uniform: { mode: "uniform", url: "moving-food-seed-1201-uniform.json", rawSha256: uniformSha },
      movingBand: { mode: "moving-band", url: "moving-food-seed-1201-moving-band.json", rawSha256: movingSha } },
    decision: { status: "pending", uniformArtifactSha256: uniformSha, movingBandArtifactSha256: movingSha,
      summary: "Fixture only; this is not a pilot result." } }, uniformText, movingText };
}

async function installViewer(page: Page, pair: ReturnType<typeof indexFor> | null) {
  const requests: string[] = [];
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    const name = url.pathname.split("/").at(-1);
    if (url.pathname.endsWith("/moving-food.html")) {
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: await readFile(resolve(DOCS, "moving-food.html"), "utf8") });
    } else if (name === "moving-food-viewer.css") {
      await route.fulfill({ contentType: "text/css; charset=utf-8", body: await readFile(resolve(DOCS, name), "utf8") });
    } else if (name === "moving-food-viewer.js") {
      await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: await readFile(resolve(DOCS, name), "utf8") });
    } else if (name === "moving-food-index.json" && pair === null) {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    } else if (name === "moving-food-index.json") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(pair!.index) });
    } else if (name === "moving-food-seed-1201-uniform.json" && pair) {
      await route.fulfill({ contentType: "application/json", body: pair.uniformText });
    } else if (name === "moving-food-seed-1201-moving-band.json" && pair) {
      await route.fulfill({ contentType: "application/json", body: pair.movingText });
    } else {
      await route.fulfill({ status: 404, contentType: "text/plain", body: "fixture has no such file" });
    }
  });
  await page.goto(`${BASE}moving-food.html`);
  return requests;
}

test("empty companion requests no arm artifact", async ({ page }) => {
  const requests = await installViewer(page, null);
  await expect(page.getByRole("status")).toHaveText("No paired manifest is published yet.");
  await expect(page.getByRole("heading", { name: "No accepted seed 1201 pair is published here." })).toBeVisible();
  expect(requests.some((path) => /moving-food-seed-1201-(uniform|moving-band)\.json$/.test(path))).toBe(false);
});

test("loads and verifies both arms before showing the pending paired decision", async ({ page }) => {
  const fixture = indexFor();
  const requests = await installViewer(page, fixture);
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#decision-status")).toHaveText("Pending");
  await expect(page.locator("#pair-decision-summary")).toHaveText("Fixture only; this is not a pilot result.");
  await expect(page.locator("#run-state")).toHaveText("Paused · paired recorded states");
  await expect(page.locator("#scrub")).toHaveValue("0");
  await expect(page.locator("#uniform-tick")).toHaveText("0");
  await expect(page.locator("#moving-tick")).toHaveText("0");
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual([
    "/docs/creative-prototypes/moving-food-index.json",
    "/docs/creative-prototypes/moving-food-seed-1201-uniform.json",
    "/docs/creative-prototypes/moving-food-seed-1201-moving-band.json",
  ]);
});

test("shared timeline visits an exact off-cadence terminal and holds that frame honestly", async ({ page }) => {
  const fixture = indexFor();
  await installViewer(page, fixture);
  await page.locator('[data-jump-tick="1500"]').click();
  await expect(page.locator("#scrub-value")).toContainText("1,500");
  await page.locator("#scrub").evaluate((element: HTMLInputElement) => {
    element.value = "86";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#moving-frame-label")).toHaveText("Extinct · actual tick 1,703");
  await expect(page.locator("#uniform-frame-label")).toHaveText("Tick 1,700 · saved sample · timeline 1,703");
  await expect(page.locator("#moving-band-left")).toHaveText("34");
  await page.locator("#scrub").evaluate((element: HTMLInputElement) => {
    element.value = element.max;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#moving-frame-label")).toHaveText("Extinct · actual tick 1,703 · holding terminal frame");
  await expect(page.locator("#uniform-frame-label")).toHaveText("Tick 3,000 · saved sample");
  await expect(page.locator("#extinction-note")).toContainText("actual tick 1,703");
});

test("rejects pair decision when either artifact hash is not repeated exactly", async ({ page }) => {
  const fixture = indexFor();
  fixture.index.decision.uniformArtifactSha256 = "0".repeat(64);
  const requests = await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("not bound to the listed raw SHA-256 values for both arms");
  await expect(page.locator("#replay")).toBeHidden();
  expect(requests.some((path) => path.endsWith("-uniform.json"))).toBe(false);
  expect(requests.some((path) => path.endsWith("-moving-band.json"))).toBe(false);
});

test("rejects an unbound overall decision instead of using it as a pair result", async ({ page }) => {
  const fixture = indexFor();
  (fixture.index as Record<string, unknown>).overallDecision = { status: "promising", summary: "Unbound fixture claim." };
  const requests = await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("unbound decision");
  await expect(page.locator("#pair-decision")).toBeHidden();
  expect(requests.some((path) => path.endsWith("-uniform.json") || path.endsWith("-moving-band.json"))).toBe(false);
});

test("rejects a raw SHA mismatch in either arm before exposing comparison or replay", async ({ page }) => {
  const fixture = indexFor();
  fixture.movingText = fixture.movingText.replace('"births":0', '"births":1');
  await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("moving-band raw-file SHA-256 does not match");
  await expect(page.locator("#pair-decision")).toBeHidden();
  await expect(page.locator("#replay")).toBeHidden();
});

test("checks each recorded frame digest after the outer artifact digest succeeds", async ({ page }) => {
  const moving = makeArm("moving-band", 1703, true);
  moving.frames[0]!.cells[0]![0] = 98;
  const canonical = { ...moving };
  delete canonical.dataSha256;
  moving.dataSha256 = hash(JSON.stringify(canonical));
  const fixture = indexFor(undefined, moving);
  await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("moving-band frame 0 SHA-256 does not match its saved contents");
});

test("rejects a missing 20-tick frame in a live arm", async ({ page }) => {
  const uniform = makeArm("uniform", 3000);
  uniform.frames.splice(42, 1);
  uniform.samples.splice(42, 1);
  uniform.repeat.stateChecks -= 1;
  uniform.repeat.frameChecks -= 1;
  sealArm(uniform);
  const fixture = indexFor(uniform);
  await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("missing a 20-tick sample");
});

test("rejects a moving band whose saved geometry does not match actual tick", async ({ page }) => {
  const moving = makeArm("moving-band", 1703, true);
  moving.samples[3]!.environment.bandLeft = 22;
  sealArm(moving);
  const fixture = indexFor(undefined, moving);
  await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("band geometry at tick 60");
});

test("rejects zero population before the declared terminal tick", async ({ page }) => {
  const moving = makeArm("moving-band", 1703, true);
  moving.samples[0]!.census = census(0, true);
  moving.frames[0]!.cells = [];
  moving.frames[0]!.organisms = [];
  sealArm(moving);
  const fixture = indexFor(undefined, moving);
  await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("population reached zero before its declared actual terminal tick");
});

test("rejects an incomplete independent repeat proof", async ({ page }) => {
  const moving = makeArm("moving-band", 1703, true);
  moving.repeat.frameChecks -= 1;
  sealArm(moving);
  const fixture = indexFor(undefined, moving);
  await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("independent repeat proof is incomplete");
});

test("keyboard controls step the pair and hidden pages pause without resuming", async ({ page }) => {
  await installViewer(page, indexFor());
  await page.locator("body").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#uniform-tick")).toHaveText("20");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#uniform-tick")).toHaveText("0");
  await page.getByRole("button", { name: "Play paired sampled replay" }).click();
  await expect(page.getByRole("button", { name: "Pause paired sampled replay" })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#run-state")).toHaveText("Paused while away");
  await expect(page.getByRole("button", { name: "Play paired sampled replay" })).toBeDisabled();
  await expect(page.locator("#uniform-tick")).toHaveText("0");
});

test("paired viewer has no WCAG A/AA violations or horizontal overflow on desktop and phone", async ({ page }) => {
  await installViewer(page, indexFor());
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`),
      `axe violations at ${viewport.width}px`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
