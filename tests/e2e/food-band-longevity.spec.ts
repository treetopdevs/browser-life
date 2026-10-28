import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const ORIGIN = `http://localhost:${process.env.BL_E2E_PORT || "5174"}`;
const BASE = `${ORIGIN}/docs/creative-prototypes/`;
const DOCS = resolve("docs/creative-prototypes");
// The replays are kept out of git (docs/creative-prototypes/ARTIFACTS.md); restore them to run these checks.
const hasReplays = ["hungry-shapes-seed-1201.json", "moving-food-moving-band-seed-1201.json", "moving-food-replication-moving-band-seed-1203.json", "moving-food-uniform-seed-1201.json", "stationary-food-replication-moving-band-seed-1201.json", "stationary-food-replication-stationary-band-seed-1201.json", "uniform-endurance-seed-1201.json", "uniform-endurance-seed-1202.json", "uniform-endurance-seed-1203.json",
  "food-band-longevity-moving-band-seed-1201.json", "food-band-longevity-stationary-band-seed-1201.json"].every((name) => existsSync(resolve(DOCS, name)));
const replaysMissing = "food-band replays are not restored (docs/creative-prototypes/ARTIFACTS.md)";
const { LOADED_SOURCE_SHA256 } = (hasReplays ? await import("../../tools/food-band-longevity/explore.ts") : {}) as typeof import("../../tools/food-band-longevity/explore.ts");
const PLAN = "ed1e1a0bf7c997868409b72a0481c5c2cbd60a58ab58a21780350803ab0597f3";
const BASELINES = {
  "moving-band": { artifact: "570aba2c02c52b7f949c60990b8bf33aa929a5352728c75d01d547666299c294", data: "458b26047456f6e67fda40e321a11ba88987bdca769190bd08fc0cbd226d5995" },
  "stationary-band": { artifact: "65e160a97cd829b6e740db757eaee7364228c4890116a8cb2422f56795675d2b", data: "9b171b58172aff8149da51521e7311aadbd7351c7526e80c852e754326aa194e" },
} as const;
const VIEWER_SOURCE = readFileSync(resolve(DOCS, "food-band-longevity-viewer.js"), "utf8");
const PINNED_SOURCES: Record<string, string> = {
  ...Object.fromEntries([...VIEWER_SOURCE.matchAll(/^\s*"([^"]+)":\s*"([a-f0-9]{64})",?$/gm)].map((match) => [match[1], match[2]])),
  "docs/creative-prototypes/food-band-longevity-plan.md": PLAN,
};
const FOOD = Buffer.alloc(96 * 96, 20).toString("base64");
const G0 = { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 };
const G1 = { ...G0, turn: 1 };
type Mode = "moving-band" | "stationary-band";
type Evidence = Record<string, any>;
type Fixture = { index: Record<string, any>; movingText: string; stationaryText: string; receiptText?: string };
const REAL_INDEX = resolve(DOCS, "food-band-longevity-index-1201.json");
const REAL_RECEIPT = resolve(DOCS, "food-band-longevity-visual-receipt-1201.json");
const REAL_SUMMARY = resolve(DOCS, "food-band-longevity-summary.json");
function sha(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
async function readRealFixture(): Promise<Fixture> {
  const indexText = await readFile(REAL_INDEX, "utf8"), index = JSON.parse(indexText);
  const movingText = await readFile(resolve(DOCS, basename(index.arms.movingBand.url)), "utf8");
  const stationaryText = await readFile(resolve(DOCS, basename(index.arms.stationaryBand.url)), "utf8");
  return { index, movingText, stationaryText, receiptText: await readFile(REAL_RECEIPT, "utf8") };
}
function env(tick: number, mode: Mode) {
  const pulses = Math.floor(tick / 5), offered = pulses * 768;
  return { version: 1, mode, pulseBudget: 768, targetCount: 4608, pulses, offered, accepted: offered, overflow: 0,
    initialFoodPerTile: 20, bandLeft: mode === "moving-band" ? Math.floor(tick / 50) % 96 : 0, bandWidth: 48 };
}
function census(tick: number, population = 2) {
  return { tick, population, cells: population ? 3 : 0, familyCounts: population ? [1, 1, 0] : [0, 0, 0],
    births: 0, deaths: population ? 0 : 2, maxGeneration: 0, totalCells: population ? 3 : 0 };
}
function makeArm(mode: Mode, finalTick = 6000, extinct = false, gate = true): Evidence {
  const ticks = Array.from({ length: Math.floor(finalTick / 20) + 1 }, (_, index) => index * 20);
  if (ticks.at(-1) !== finalTick) ticks.push(finalTick);
  const bodies = [[0, 1], [1, 1], [97, 2]];
  const samples = ticks.map((tick) => ({ tick, census: census(tick, extinct && tick === finalTick ? 0 : 2), environment: env(tick, mode),
    censusSha256: "0".repeat(64), stateSha256: "f".repeat(64), frameSha256: "0".repeat(64) }));
  const frames = ticks.map((tick) => ({ tick, censusSha256: "0".repeat(64), stateSha256: "f".repeat(64), foodBase64: FOOD,
    cells: extinct && tick === finalTick ? [] : bodies, organisms: extinct && tick === finalTick ? [] : [
      { id: 1, family: 0, genome: G0 }, { id: 2, family: 1, genome: G1 }],
    ledger: { initialEnergy: 0, supplied: 0, dissipated: 0, deathLoss: 0, expected: 0, actual: 0, residual: 0 }, frameSha256: "0".repeat(64) }));
  const ranges = [[4501, 5000], [5001, 5500], [5501, 6000]];
  const rows = Array.from({ length: finalTick }, (_, index) => {
    const tick = index + 1, inNewWindow = ranges.some(([from]) => tick === from), afterWindowStart = ranges.some(([from]) => tick === from + 1);
    const zero = extinct && tick === finalTick;
    return { tick, population: zero ? 0 : 2, cells: zero ? 0 : 3, births: gate && inNewWindow ? 1 : 0, deaths: gate && afterWindowStart ? 1 : 0,
      blockedCap: 0, blockedSpace: 0, cap48: false, nearCap47: false };
  });
  const snapshots = [0, 500, 1500, 2500, 3000, 4500, 5500, 6000, finalTick]
    .filter((tick, index, all) => tick <= finalTick && all.indexOf(tick) === index)
    .map((tick) => ({ tick, terminal: extinct && tick === finalTick, environment: env(tick, mode), state: { tick }, stateSha256: "f".repeat(64) }));
  const prefix = { status: "verified", seed: 1201, normalization: "none; exact historical 3,000-tick prefix payload; no normalization",
    comparedSamples: 151, comparedFrames: 151, comparedTickRows: 3000, comparedSnapshots: 5,
    checkpoints: [0, 500, 1500, 2500, 3000].map((tick) => ({ tick, stateSha256: "f".repeat(64), compared: true })) };
  const arm: Evidence = { schemaVersion: 1, kind: "hungry-shapes-food-band-longevity-arm",
    run: { seed: 1201, mode, mutation: true, maxTick: 6000, finalTick, extinctionTick: extinct ? finalTick : null },
    runtime: { node: "24.2.0", platform: "darwin", arch: "arm64" },
    rules: { width: 96, height: 96, tileCount: 9216, maxHistory: 451 },
    provenance: { sourceSha256: { ...PINNED_SOURCES }, planSha256: PLAN, baselineArtifactSha256: BASELINES[mode].artifact, baselineDataSha256: BASELINES[mode].data, prefix },
    samples, tickRows: rows, frames, snapshots, windows: [],
    final: { census: samples.at(-1)!.census, environment: samples.at(-1)!.environment, lineage: [], stateSha256: "f".repeat(64) },
    repeat: { verified: true, comparedThroughTick: finalTick, stateChecks: ticks.length, frameChecks: ticks.length },
    numericalGate: { aliveAt6000: false, atLeastTwoFamiliesAt6000: false, allWindowsReached: false,
      eachNewWindowHasBirthsAndDeaths: false, eachNewWindowCap48AtMost99: false, numericalPass: false, note: "Fixture only." } };

  for (const snapshot of snapshots) {
    const sample = samples.find((row) => row.tick === snapshot.tick)!;
    sample.stateSha256 = sha(JSON.stringify({ state: snapshot.state, environment: snapshot.environment }));
    snapshot.stateSha256 = sample.stateSha256;
  }
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index], sample = samples[index];
    sample.censusSha256 = sha(JSON.stringify(sample.census));
    frame.censusSha256 = sample.censusSha256;
    frame.stateSha256 = sample.stateSha256;
    const { frameSha256: _frameSha256, ...envelope } = frame;
    frame.frameSha256 = sha(JSON.stringify(envelope));
    sample.frameSha256 = frame.frameSha256;
  }
  for (const checkpoint of prefix.checkpoints) checkpoint.stateSha256 = samples.find((sample) => sample.tick === checkpoint.tick)!.stateSha256;
  arm.final.census = samples.at(-1)!.census;
  arm.final.environment = samples.at(-1)!.environment;
  arm.final.stateSha256 = samples.at(-1)!.stateSha256;
  arm.windows = ranges.map(([from, to]) => {
    const executedTicks = Math.max(0, Math.min(to, finalTick) - from + 1);
    const status = executedTicks === 500 ? "complete" : executedTicks === 0 ? "not-reached" : "partial";
    if (!executedTicks) return { from, to, denominatorTicks: 500, status, executedTicks, births: null, deaths: null, cap48Ticks: null,
      nearCap47Ticks: null, blockedCapAttempts: null, blockedSpaceAttempts: null, minPopulation: null, maxPopulation: null,
      food: { offered: null, accepted: null, overflow: null }, endpoint: { requestedTick: to, actualTick: null, population: null, cells: null,
        familyCounts: null, genomeCounts: null, maxGeneration: null, maxEverGeneration: null, foodRemaining: null, bandLeft: null,
        occupiedBandCells: null, occupiedBandShare: null } };
    const actualTick = Math.min(to, finalTick), endpointSample = samples.find((sample) => sample.tick === actualTick)!;
    const endpointFrame = frames.find((frame) => frame.tick === actualTick)!;
    const startEnvironment = env(from - 1, mode), endpointEnvironment = env(actualTick, mode);
    const observed = rows.filter((row) => row.tick >= from && row.tick <= actualTick);
    const bandLeft = endpointEnvironment.bandLeft;
    const occupiedBandCells = endpointFrame.cells.filter(([tile]) => ((tile % 96 - bandLeft + 96) % 96) < 48).length;
    const genomes = endpointFrame.organisms.map((organism) => ({ genome: organism.genome, count: 1 }));
    return { from, to, denominatorTicks: 500, status, executedTicks, births: observed.reduce((total, row) => total + row.births, 0),
      deaths: observed.reduce((total, row) => total + row.deaths, 0), cap48Ticks: 0, nearCap47Ticks: 0, blockedCapAttempts: 0, blockedSpaceAttempts: 0,
      minPopulation: Math.min(...observed.map((row) => row.population)), maxPopulation: Math.max(...observed.map((row) => row.population)),
      food: { offered: endpointEnvironment.offered - startEnvironment.offered, accepted: endpointEnvironment.accepted - startEnvironment.accepted,
        overflow: endpointEnvironment.overflow - startEnvironment.overflow },
      endpoint: { requestedTick: to, actualTick, population: endpointSample.census.population, cells: endpointSample.census.cells,
        familyCounts: endpointSample.census.familyCounts, genomeCounts: genomes, maxGeneration: 0, maxEverGeneration: 0,
        foodRemaining: endpointFrame.foodBase64.length ? 96 * 96 * 20 : 0, bandLeft, occupiedBandCells,
        occupiedBandShare: endpointSample.census.cells ? occupiedBandCells / endpointSample.census.cells : null } };
  });
  const newWindows = arm.windows;
  const allWindowsReached = newWindows.every((window: Evidence) => window.status === "complete");
  const aliveAt6000 = finalTick === 6000 && !extinct;
  const atLeastTwoFamiliesAt6000 = aliveAt6000 && samples.at(-1)!.census.familyCounts.filter((count) => count > 0).length >= 2;
  const eachNewWindowHasBirthsAndDeaths = allWindowsReached && newWindows.every((window: Evidence) => window.births > 0 && window.deaths > 0);
  const eachNewWindowCap48AtMost99 = allWindowsReached && newWindows.every((window: Evidence) => window.cap48Ticks <= 99);
  arm.numericalGate = { aliveAt6000, atLeastTwoFamiliesAt6000, allWindowsReached, eachNewWindowHasBirthsAndDeaths, eachNewWindowCap48AtMost99,
    numericalPass: aliveAt6000 && atLeastTwoFamiliesAt6000 && allWindowsReached && eachNewWindowHasBirthsAndDeaths && eachNewWindowCap48AtMost99, note: "Fixture only." };
  delete arm.dataSha256;
  arm.dataSha256 = sha(JSON.stringify(arm));
  return arm;
}
function makePair(status = "pending", visual = { moving: false, stationary: false }, stationary = makeArm("stationary-band")): Fixture {
  const moving = makeArm("moving-band");
  const movingText = JSON.stringify(moving), stationaryText = JSON.stringify(stationary);
  const movingSha = sha(movingText), stationarySha = sha(stationaryText);
  const index: Record<string, any> = { schemaVersion: 1, kind: "hungry-shapes-food-band-longevity-pair", seed: 1201, planSha256: PLAN,
    arms: { movingBand: { mode: "moving-band", url: "food-band-longevity-moving-band-seed-1201.json", rawSha256: movingSha },
      stationaryBand: { mode: "stationary-band", url: "food-band-longevity-stationary-band-seed-1201.json", rawSha256: stationarySha } },
    decision: { status, summary: "Fixture only; not a pilot result.", movingBandArtifactSha256: movingSha, stationaryBandArtifactSha256: stationarySha } };
  const fixture: Fixture = { index, movingText, stationaryText };
  if (status !== "pending") {
    const receipt = { seed: 1201, planSha256: PLAN, movingBandArtifactSha256: movingSha, stationaryBandArtifactSha256: stationarySha,
      withinArmChanges: { movingBand: { from: 5500, to: 6000, pass: visual.moving, observation: "Not blind because historical moving media exist; fixture body clusters changed." },
        stationaryBand: { from: 5500, to: 6000, pass: visual.stationary, observation: "Non-blind because historical moving media exist; fixture body clusters shifted." } },
      sameAgeComparisons: [3000, 5500, 6000].map((tick) => ({ tick, observation: `Not blind; historical moving media exist. Descriptive comparison at ${tick}.` })),
      visualReviewedBeforeOverlapDiagnostics: true, reviewedAtUTC: "2026-10-26T15:00:00Z" };
    fixture.receiptText = JSON.stringify(receipt);
    index.decision.visualReceiptUrl = "food-band-longevity-visual-receipt-1201.json";
    index.decision.visualReceiptSha256 = sha(fixture.receiptText);
  }
  return fixture;
}
async function installViewer(page: Page, fixture: Fixture | null) {
  const requests: string[] = [];
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url()), name = url.pathname.split("/").at(-1) ?? "";
    requests.push(url.pathname);
    if (["food-band-longevity.html", "food-band-longevity-viewer.css", "food-band-longevity-viewer.js"].includes(name)) {
      const type = name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : "text/javascript";
      await route.fulfill({ contentType: `${type}; charset=utf-8`, body: await readFile(resolve(DOCS, name), "utf8") }); return;
    }
    if (name === "food-band-longevity-index-1201.json") {
      if (fixture) await route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture.index) });
      else await route.fulfill({ status: 404, body: "{}" });
      return;
    }
    if (fixture && name === "food-band-longevity-moving-band-seed-1201.json") { await route.fulfill({ contentType: "application/json", body: fixture.movingText }); return; }
    if (fixture && name === "food-band-longevity-stationary-band-seed-1201.json") { await route.fulfill({ contentType: "application/json", body: fixture.stationaryText }); return; }
    if (fixture?.receiptText && name === "food-band-longevity-visual-receipt-1201.json") { await route.fulfill({ contentType: "application/json", body: fixture.receiptText }); return; }
    await route.fulfill({ status: 404, contentType: "text/plain", body: "No such fixture file" });
  });
  await page.goto(`${BASE}food-band-longevity.html`);
  return requests;
}

test("empty page requests only the seed-1201 index", async ({ page }) => {
  const requests = await installViewer(page, null);
  await expect(page.getByRole("status")).toHaveText("No seed-1201 pair manifest is published yet.");
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual(["/docs/creative-prototypes/food-band-longevity-index-1201.json"]);
});

test("full-horizon fixture validates paused saved frames and the three gated windows", async ({ page }) => {
  const requests = await installViewer(page, makePair());
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#decision-status")).toHaveText("Pending");
  await expect(page.locator("#run-state")).toHaveText("Paused · paired recorded states");
  await expect(page.locator("#moving-frame-label")).toHaveText("Tick 0 · saved sample");
  await page.locator('[data-jump-tick="3000"]').click();
  await expect(page.locator("#moving-tick")).toHaveText("3,000");
  await page.locator('[data-jump-tick="5500"]').click();
  await expect(page.locator("#stationary-tick")).toHaveText("5,500");
  await page.locator('[data-jump-tick="6000"]').click();
  await expect(page.locator("#moving-frame-label")).toHaveText("Tick 6,000 · saved sample");
  await expect(page.locator("#window-rows tr")).toHaveCount(6);
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual([
    "/docs/creative-prototypes/food-band-longevity-index-1201.json",
    "/docs/creative-prototypes/food-band-longevity-moving-band-seed-1201.json",
    "/docs/creative-prototypes/food-band-longevity-stationary-band-seed-1201.json",
  ]);
});

test("actual seed-1201 records replay their saved 3,000/5,500/6,000 frames", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const fixture = await readRealFixture();
  const summary = JSON.parse(await readFile(REAL_SUMMARY, "utf8"));
  expect(fixture.index.decision.status).toBe("both");
  expect(fixture.index.decision.visualReceiptUrl).toBe("food-band-longevity-visual-receipt-1201.json");
  expect(fixture.index.arms.movingBand.rawSha256).toBe(sha(fixture.movingText));
  expect(fixture.index.arms.stationaryBand.rawSha256).toBe(sha(fixture.stationaryText));
  expect(summary.decision).toBe("both");
  const moving = JSON.parse(fixture.movingText), stationary = JSON.parse(fixture.stationaryText);
  const movingSummary = summary.arms.find((arm: Evidence) => arm.mode === "moving-band");
  const stationarySummary = summary.arms.find((arm: Evidence) => arm.mode === "stationary-band");
  expect(movingSummary.rawSha256).toBe(fixture.index.arms.movingBand.rawSha256);
  expect(stationarySummary.rawSha256).toBe(fixture.index.arms.stationaryBand.rawSha256);
  expect(movingSummary.census).toEqual(moving.final.census);
  expect(stationarySummary.census).toEqual(stationary.final.census);
  const historicalFamilyCounts: number[] = moving.samples.find((sample: Evidence) => sample.tick === 3000).census.familyCounts;
  const smallestHistoricalFamily = historicalFamilyCounts.reduce((minimum, count) => count > 0 ? Math.min(minimum, count) : minimum, Infinity);
  const reboundFamily = historicalFamilyCounts.indexOf(smallestHistoricalFamily);
  const familyWord = (count: number) => ({ 1: "one", 2: "two", 3: "three" }[count] ?? String(count));
  const requests = await installViewer(page, fixture);
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#decision-status")).toHaveText("Both varied");
  const staticSummary = page.locator(".intro h1 + p");
  await expect(staticSummary).toContainText(`Moving ends with ${movingSummary.census.population} bodies in ${familyWord(movingSummary.census.familyCounts.filter((count: number) => count > 0).length)} families`);
  await expect(staticSummary).toContainText(`stationary with ${stationarySummary.census.population} in ${familyWord(stationarySummary.census.familyCounts.filter((count: number) => count > 0).length)}`);
  await expect(staticSummary).toContainText(`smallest family at tick 3,000 rebounds from ${smallestHistoricalFamily} bodies to ${moving.final.census.familyCounts[reboundFamily]}`);
  for (const tick of [3000, 5500, 6000]) {
    await page.locator(`[data-jump-tick="${tick}"]`).click();
    await expect(page.locator("#moving-tick")).toHaveText(tick.toLocaleString("en-US"));
    await expect(page.locator("#stationary-tick")).toHaveText(tick.toLocaleString("en-US"));
    await expect(page.locator("#moving-frame-label")).toHaveText(`Tick ${tick.toLocaleString("en-US")} · saved sample`);
    await expect(page.locator("#stationary-frame-label")).toHaveText(`Tick ${tick.toLocaleString("en-US")} · saved sample`);
  }
  await page.locator("#scrub").fill("0");
  await page.getByRole("button", { name: "Play paired sampled replay" }).click();
  await expect(page.locator("#run-state")).toHaveText("Playing · saved states only");
  await expect(page.locator("#moving-tick")).not.toHaveText("0");
  await page.getByRole("button", { name: "Pause paired sampled replay" }).click();
  await expect(page.locator("#run-state")).toHaveText("Paused · recorded replay");
  await page.setViewportSize({ width: 390, height: 844 });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests).toContain("/docs/creative-prototypes/food-band-longevity-visual-receipt-1201.json");
});

test("accepted paired receipt is SHA-bound to both numerical and visual screens", async ({ page }) => {
  const fixture = makePair("both", { moving: true, stationary: true });
  fixture.receiptText = fixture.receiptText!.replaceAll("historical moving media", "historical media");
  fixture.index.decision.visualReceiptSha256 = sha(fixture.receiptText);
  await installViewer(page, fixture);
  await expect(page.locator("#decision-status")).toHaveText("Both varied");
  await expect(page.locator("#pair-decision-summary")).toContainText("Fixture only");
});

test("an extinction at an exact visual endpoint is held at its actual terminal tick", async ({ page }) => {
  const extinct = makeArm("stationary-band", 5601, true);
  const fixture = makePair("moving-only", { moving: true, stationary: false }, extinct);
  await installViewer(page, fixture);
  await page.locator('[data-jump-tick="6000"]').click();
  await expect(page.locator("#stationary-frame-label")).toHaveText("Extinct · actual tick 5,601 · holding terminal frame");
  await expect(page.locator("#extinction-note")).toContainText("actual tick 5,601");
});

test("rejects a passing visual judgment when a required 6,000 endpoint is absent", async ({ page }) => {
  const extinct = makeArm("stationary-band", 5501, true);
  const fixture = makePair("moving-only", { moving: true, stationary: true }, extinct);
  await installViewer(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("without exact saved frames at ticks 5,500 and 6,000");
  await expect(page.locator("#replay")).toBeHidden();
});

test("requires receipt disclosure that this historical-media rejudgment is not blind", async ({ page }) => {
  const fixture = makePair("both", { moving: true, stationary: true });
  const receipt = JSON.parse(fixture.receiptText!);
  for (const change of Object.values(receipt.withinArmChanges) as Record<string, any>[]) change.observation = "The clusters shifted.";
  for (const comparison of receipt.sameAgeComparisons) comparison.observation = "Saved-frame comparison.";
  fixture.receiptText = JSON.stringify(receipt);
  fixture.index.decision.visualReceiptSha256 = sha(fixture.receiptText);
  await installViewer(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("not blind and historical media exist");
});

test("rejects a receipt that only says the media are historical", async ({ page }) => {
  const fixture = makePair("both", { moving: true, stationary: true });
  const receipt = JSON.parse(fixture.receiptText!);
  for (const change of Object.values(receipt.withinArmChanges) as Record<string, any>[]) change.observation = "Not blind: media are historical.";
  for (const comparison of receipt.sameAgeComparisons) comparison.observation = "Not blind: media are historical.";
  fixture.receiptText = JSON.stringify(receipt);
  fixture.index.decision.visualReceiptSha256 = sha(fixture.receiptText);
  await installViewer(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("not blind and historical media exist");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects raw-file hash mismatch before rendering", async ({ page }) => {
  const fixture = makePair(); fixture.stationaryText = fixture.stationaryText.replace('"births":0', '"births":1');
  await installViewer(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("stationary-band raw-file SHA-256 does not match");
  await expect(page.locator("#replay")).toBeHidden();
});

test("keyboard transport pauses on hidden pages and the phone view is accessible", async ({ page }) => {
  await installViewer(page, makePair());
  await page.locator("body").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#moving-tick")).toHaveText("20");
  await page.getByRole("button", { name: "Play paired sampled replay" }).click();
  await expect(page.getByRole("button", { name: "Pause paired sampled replay" })).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.locator("#run-state")).toHaveText("Paused while away");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.setViewportSize({ width: 390, height: 844 });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("fixtures use the runner's frozen per-mode baseline identities", async () => {
  const runner = await readFile(resolve("tools/food-band-longevity/explore.ts"), "utf8");
  for (const mode of ["moving-band", "stationary-band"] as const) {
    const line = runner.split(/\r?\n/).find((candidate) => candidate.includes(`'${mode}':Object.freeze({artifactPath:`));
    const reference = line && /artifactPath:'([^']+)',artifactSha256:'([a-f0-9]{64})',dataSha256:'([a-f0-9]{64})'/.exec(line);
    expect(reference, `producer reference for ${mode}`).not.toBeNull();
    expect(BASELINES[mode].artifact).toBe(reference![2]);
    expect(BASELINES[mode].data).toBe(reference![3]);
    expect(PINNED_SOURCES[reference![1]]).toBe(reference![2]);
  }
});

test("viewer source pins exactly match the runner's frozen loaded-source map", async () => {
  test.skip(!hasReplays, replaysMissing);
  expect(PINNED_SOURCES).toEqual(LOADED_SOURCE_SHA256);
});

test("rejects an empty decision summary", async ({ page }) => {
  const fixture = makePair();
  fixture.index.decision.summary = " ";
  await installViewer(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("not bound to the listed raw SHA-256 values");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects an optional unbound decision title", async ({ page }) => {
  const fixture = makePair();
  fixture.index.decision.title = "Unbound display text";
  await installViewer(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("pending pair decision contains unbound extra fields");
  await expect(page.locator("#replay")).toBeHidden();
});
