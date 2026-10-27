import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOADED_SOURCE_SHA256 } from "../../tools/split-food-replication/explore.ts";

const ORIGIN = `http://localhost:${process.env.BL_E2E_PORT || "5174"}`;
const BASE = `${ORIGIN}/docs/creative-prototypes/`;
const DOCS = resolve("docs/creative-prototypes");
const PLAN = "0858e5292d1a9949d1dfd53479519a518fbbe5b849363e577a7e630a0ece384d";
const BASELINE_FILE = "stationary-food-replication-stationary-band-seed-1203.json";
const SPLIT_FILE = "split-food-replication-seed-1203.json";
const INDEX_FILE = "split-food-replication-index-1203.json";
const RECEIPT_FILE = "split-food-replication-visual-receipt-1203.json";
type AnyRecord = Record<string, any>;
type ReceiptFixture = { baselineText: string; splitText: string; index: AnyRecord; receiptText?: string };

const baselineBytes = readFileSync(resolve(DOCS, BASELINE_FILE));
const baseline = JSON.parse(baselineBytes.toString("utf8")) as AnyRecord;
const baselineSha = sha(baselineBytes);
const baselineIndexSha256 = sha(readFileSync(resolve(DOCS, "stationary-food-replication-index-1203.json")));
const baselineRaw = `${baselineBytes.toString("utf8")}`;
const FOOD = Buffer.alloc(96 * 96, 20).toString("base64");
const GENOMES = [
  { turnEvery: 4, turn: 0, branchEvery: 3, maxCells: 22 },
  { turnEvery: 4, turn: 1, branchEvery: 3, maxCells: 23 },
  { turnEvery: 5, turn: 0, branchEvery: 4, maxCells: 24 },
];
function sha(value: string | Buffer | Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function environment(tick: number, mode: "split-band" | "stationary-band") {
  const pulses = Math.floor(tick / 5), offered = pulses * 768;
  return mode === "split-band"
    ? { version: 1, mode, pulseBudget: 768, targetCount: 4608, pulses, offered, accepted: offered, overflow: 0, initialFoodPerTile: 20, bandColumns: [[0, 23], [48, 71]], bandWidth: 24 }
    : { version: 1, mode, pulseBudget: 768, targetCount: 4608, pulses, offered, accepted: offered, overflow: 0, initialFoodPerTile: 20, bandLeft: 0, bandWidth: 48 };
}
function census(tick: number, births: number, deaths: number, population = 12, cells = 20) {
  const familyCounts = population ? [4, 4, 4] : [0, 0, 0], totalEnergy = population ? 1000 : 0;
  return { tick, population, cells, familyCounts, births, growths: 0, deaths, effectiveMutations: 0, attemptedMutations: 0,
    maxGeneration: 0, totalCells: cells, totalEnergy, meanBodyCells: population ? cells / population : 0, meanEnergy: population ? totalEnergy / population : 0,
    blockedBirths: 0, blockedSpaceBirths: 0, blockedCapBirths: 0, ledgerResidual: 0, genomeVariantCount: population ? 3 : 0 };
}
function buildSplitArm(options: { finalTick?: number; extinct?: boolean } = {}): AnyRecord {
  const finalTick = options.finalTick ?? 3000, extinctionTick = options.extinct ? finalTick : null;
  const sampleTicks = [0];
  for (let tick = 20; tick <= finalTick; tick += 20) sampleTicks.push(tick);
  if (sampleTicks.at(-1) !== finalTick) sampleTicks.push(finalTick);
  const events = new Set([1600, 2100, 2600]);
  const deathTicks = new Set([1601, 2101, 2601]);
  const cells: [number, number][] = [
    ...Array.from({ length: 10 }, (_, i) => [i, i + 1] as [number, number]),
    ...Array.from({ length: 10 }, (_, i) => [48 + i * 96, i + 3] as [number, number]),
  ].sort((a, b) => a[0] - b[0]);
  const organisms = Array.from({ length: 12 }, (_, id) => ({ id: id + 1, family: Math.floor(id / 4), genome: GENOMES[Math.floor(id / 4)] }));
  const initialEnergy = 96 * 96 * 20 + 1000;
  const samples: AnyRecord[] = [], frames: AnyRecord[] = [];
  for (const tick of sampleTicks) {
    const births = [...events].filter((at) => at <= tick).length;
    const deaths = [...deathTicks].filter((at) => at <= tick).length + (options.extinct && tick === finalTick ? 12 : 0);
    const env = environment(tick, "split-band");
    const isTerminalExtinction = Boolean(options.extinct && tick === finalTick);
    const c = census(tick, births, deaths, isTerminalExtinction ? 0 : 12, isTerminalExtinction ? 0 : 20);
    const censusSha256 = sha(JSON.stringify(c));
    const state = { tick };
    const stateSha256 = sha(JSON.stringify({ state, environment: env }));
    const deathLoss = isTerminalExtinction ? 1000 : 0;
    const terminalEnergy = initialEnergy - deathLoss;
    const ledger = { initialEnergy, supplied: env.accepted, dissipated: env.accepted, deathLoss, expected: terminalEnergy, actual: terminalEnergy, residual: 0 };
    const frameBase = { tick, censusSha256, stateSha256, foodBase64: FOOD, cells: extinctionTick === tick ? [] : cells,
      organisms: extinctionTick === tick ? [] : organisms, ledger };
    const frame = { ...frameBase, frameSha256: sha(JSON.stringify(frameBase)) };
    const sample = { tick, census: c, environment: env, censusSha256, stateSha256, frameSha256: frame.frameSha256 };
    samples.push(sample); frames.push(frame);
  }
  const tickRows: AnyRecord[] = [];
  for (let tick = 1; tick <= finalTick; tick++) {
    const births = events.has(tick) ? 1 : 0, deaths = deathTicks.has(tick) ? 1 : 0;
    const terminalExtinction = Boolean(options.extinct && tick === finalTick);
    tickRows.push({ tick, population: terminalExtinction ? 0 : 12, cells: terminalExtinction ? 0 : 20,
      births, deaths: terminalExtinction ? 12 : deaths, blockedCap: 0, blockedSpace: 0, cap48: false, nearCap47: false });
  }
  const snapshots = [0, 500, 1500, 2500, 3000, finalTick].filter((tick, index, all) => tick <= finalTick && all.indexOf(tick) === index).map((tick) => {
    const env = environment(tick, "split-band"), state = { tick };
    return { tick, terminal: extinctionTick === tick, environment: env, state, stateSha256: sha(JSON.stringify({ state, environment: env })) };
  });
  const windows = [1501, 2001, 2501].map((from) => {
    const to = from + 499, active = tickRows.filter((row) => row.tick >= from && row.tick <= to), executedTicks = active.length;
    const actualTick = active.at(-1)?.tick ?? null;
    const entry = frames.find((frame) => frame.tick === actualTick);
    const endSample = samples.find((sample) => sample.tick === actualTick);
    const start = samples.find((sample) => sample.tick === from - 1);
    const occupancy = entry ? countBands(entry.cells) : null;
    const windowGenomes = entry ? GENOMES.map((genome) => ({ genome, count: entry.organisms.filter((organism: AnyRecord) => JSON.stringify(organism.genome) === JSON.stringify(genome)).length })).filter((item) => item.count > 0) : [];
    return { from, to, denominatorTicks: 500, status: executedTicks === 500 ? "complete" : executedTicks ? "partial" : "not-reached", executedTicks,
      births: executedTicks ? active.reduce((sum, row) => sum + row.births, 0) : null,
      deaths: executedTicks ? active.reduce((sum, row) => sum + row.deaths, 0) : null,
      cap48Ticks: executedTicks ? active.filter((row) => row.cap48).length : null,
      nearCap47Ticks: executedTicks ? active.filter((row) => row.nearCap47).length : null,
      blockedCapAttempts: executedTicks ? 0 : null, blockedSpaceAttempts: executedTicks ? 0 : null,
      minPopulation: executedTicks ? Math.min(...active.map((row) => row.population)) : null,
      maxPopulation: executedTicks ? Math.max(...active.map((row) => row.population)) : null,
      food: executedTicks ? { offered: endSample!.environment.offered - start!.environment.offered, accepted: endSample!.environment.accepted - start!.environment.accepted, overflow: 0 } : { offered: null, accepted: null, overflow: null },
      endpoint: { requestedTick: to, actualTick, population: endSample?.census.population ?? null, cells: endSample?.census.cells ?? null,
        familyCounts: endSample?.census.familyCounts ?? null,
        genomeCounts: windowGenomes, maxGeneration: endSample?.census.maxGeneration ?? null,
        maxEverGeneration: actualTick === null ? null : 0, foodRemaining: entry ? 96 * 96 * 20 : null, occupiedTilesByBand: occupancy },
    };
  });
  const checkpoints = [2500, 3000].map((tick) => ({ tick, occupiedTilesByBand: tick <= finalTick ? [10, 10] : null,
    pass: tick <= finalTick }));
  const live = extinctionTick === null && finalTick === 3000;
  const windowsReached = windows.every((window) => window.status === "complete");
  const numericalGate = { aliveAt3000: live, atLeastTwoFamiliesAt3000: live, allWindowsReached: windowsReached,
    eachNewWindowHasBirthsAndDeaths: windowsReached && windows.every((window) => Number(window.births) > 0 && Number(window.deaths) > 0),
    eachNewWindowCap48AtMost99: windowsReached && windows.every((window) => Number(window.cap48Ticks) <= 99),
    numericalPass: live && windowsReached, note: "Synthetic test fixture only." };
  const output: AnyRecord = { schemaVersion: 1, kind: "hungry-shapes-split-food-replication-arm",
    run: { seed: 1203, mode: "split-band", mutation: true, maxTick: 3000, finalTick, extinctionTick },
    runtime: { node: "24.2.0", platform: "darwin", arch: "arm64" }, rules: baseline.rules,
    provenance: { sourceSha256: LOADED_SOURCE_SHA256, planSha256: PLAN, baselineArtifactSha256: baselineSha,
    baselineDataSha256: baseline.dataSha256, baselineIndexSha256,
      baselineRegression: { status: "verified", seed: 1203, comparedSamples: 151, comparedFrames: 151, comparedTickRows: 3000, comparedSnapshots: 5,
        checkpoints: baseline.snapshots.map((snapshot: AnyRecord) => ({ tick: snapshot.tick, stateSha256: snapshot.stateSha256, compared: true })) } },
    samples, tickRows, frames, snapshots, windows,
    final: { census: samples.at(-1)!.census, environment: samples.at(-1)!.environment,
      ledger: frames.at(-1)!.ledger, lineage: [], deathsByCause: { age: 0, starvation: 0 }, maxEverGeneration: 0, stateSha256: samples.at(-1)!.stateSha256 },
    repeat: { verified: true, comparedThroughTick: finalTick, stateChecks: samples.length, frameChecks: frames.length },
    numericalGate, spatialGate: { requiredTilesPerBand: 10, checkpoints, pass: checkpoints.every((item) => item.pass) } };
  output.dataSha256 = sha(JSON.stringify(output));
  return output;
}
function countBands(cells: [number, number][]) {
  const counts = [0, 0];
  for (const [tile] of cells) { const column = tile % 96; if (column <= 23) counts[0]++; else if (column >= 48 && column <= 71) counts[1]++; }
  return counts;
}
function makeReceiptFixture(artifactSha: string, splitPass: boolean) {
  const disclosure = "Not blind: the historical baseline and split numerical outcome are known.";
  return { seed: 1203, planSha256: PLAN, baselineArtifactSha256: baselineSha, splitArtifactSha256: artifactSha,
    splitChange: { from: 2500, to: 3000, pass: splitPass, observation: `${disclosure} The occupied groups shift and a gap clears.` },
    sameAgeComparisons: [1500, 2500, 3000].map((tick) => ({ tick, observation: `${disclosure} Descriptive same-age comparison at ${tick}.` })),
    visualReviewedBeforeOverlapDiagnostics: true, reviewedAtUTC: "2026-10-27T12:00:00Z" };
}
function buildPair(options: { status?: "pending" | "promising" | "stop"; splitPass?: boolean; variant?: AnyRecord; wrongSplitHash?: boolean; } = {}): ReceiptFixture {
  const variant = options.variant ?? buildSplitArm();
  const splitText = `${JSON.stringify(variant)}\n`, splitRawSha = sha(splitText);
  const receiptText = options.status && options.status !== "pending"
    ? `${JSON.stringify(makeReceiptFixture(splitRawSha, options.splitPass ?? true))}\n` : undefined;
  const index: AnyRecord = { schemaVersion: 1, kind: "hungry-shapes-split-food-replication-pair", seed: 1203, planSha256: PLAN,
    arms: { baseline: { mode: "stationary-band", url: BASELINE_FILE, rawSha256: baselineSha },
      split: { mode: "split-band", url: SPLIT_FILE, rawSha256: options.wrongSplitHash ? "0".repeat(64) : splitRawSha } },
    decision: { status: options.status ?? "pending", summary: "Synthetic fixture only; no outcome is represented.",
      baselineArtifactSha256: baselineSha, splitArtifactSha256: options.wrongSplitHash ? "0".repeat(64) : splitRawSha } };
  if (receiptText) {
    index.decision.visualReceiptUrl = RECEIPT_FILE;
    index.decision.visualReceiptSha256 = sha(receiptText);
  }
  return { baselineText: baselineRaw, splitText, index, receiptText };
}
async function installFixture(page: Page, fixture?: ReceiptFixture) {
  const requests: string[] = [];
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url()), name = url.pathname.split("/").at(-1) ?? "";
    requests.push(url.pathname);
    if (name === "split-food-replication.html") { await route.fulfill({ contentType: "text/html", body: await readFile(resolve(DOCS, name), "utf8") }); return; }
    if (name === "split-food-replication-viewer.css" || name === "split-food-replication-viewer.js") {
      await route.fulfill({ contentType: name.endsWith(".css") ? "text/css" : "text/javascript", body: await readFile(resolve(DOCS, name), "utf8") }); return;
    }
    if (name === INDEX_FILE) {
      if (!fixture) { await route.fulfill({ status: 404, body: "{}" }); return; }
      await route.fulfill({ contentType: "application/json", body: `${JSON.stringify(fixture.index)}\n` }); return;
    }
    if (name === BASELINE_FILE) { await route.fulfill({ contentType: "application/json", body: fixture?.baselineText ?? baselineRaw }); return; }
    if (name === SPLIT_FILE && fixture) { await route.fulfill({ contentType: "application/json", body: fixture.splitText }); return; }
    if (name === RECEIPT_FILE && fixture?.receiptText) { await route.fulfill({ contentType: "application/json", body: fixture.receiptText }); return; }
    await route.fulfill({ status: 404, contentType: "text/plain", body: `Unexpected request: ${name}` });
  });
  await page.goto(`${BASE}split-food-replication.html`);
  return requests;
}


test("only checks seed 1203 index when no pair is published", async ({ page }) => {
  const requests = await installFixture(page);
  await expect(page.getByRole("status")).toHaveText("No seed 1203 split-food replication pair index is published yet.");
  await expect(page.locator("#replay")).toBeHidden();
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual([`/docs/creative-prototypes/${INDEX_FILE}`]);
});

test("synthetic pending fixture verifies the historical baseline and split-band saved frames", async ({ page }) => {
  const fixture = buildPair();
  const requests = await installFixture(page, fixture);
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#source-status")).toContainText("Historical baseline and split-band record verified");
  await expect(page.locator("#decision-status")).toHaveText("Pending");
  await expect(page.locator("#run-state")).toHaveText("Paused · recorded replay");
  await expect(page.locator("#baseline-frame-label")).toHaveText("Tick 0 · saved sample");
  await expect(page.locator("#split-frame-label")).toHaveText("Tick 0 · saved sample");
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual([
    `/docs/creative-prototypes/${INDEX_FILE}`,
    `/docs/creative-prototypes/${BASELINE_FILE}`,
    `/docs/creative-prototypes/${SPLIT_FILE}`,
  ]);
  await page.locator('[data-jump-tick="2500"]').click();
  await expect(page.locator("#baseline-tick")).toHaveText("2,500");
  await expect(page.locator("#split-tick")).toHaveText("2,500");
  await expect(page.locator("#split-band-one")).toHaveText("10");
  await expect(page.locator("#split-band-two")).toHaveText("10");
  await expect(page.locator("#spatial-2500")).toContainText("10 · 10 occupied tiles · pass");
  expect(await page.locator("#split-world").getAttribute("aria-label")).toContain("split-band");
});

test("truthfully holds an off-cadence extinction frame without inventing a later split state", async ({ page }) => {
  const fixture = buildPair({ variant: buildSplitArm({ finalTick: 2507, extinct: true }) });
  await installFixture(page, fixture);
  await page.locator('[data-jump-tick="3000"]').click();
  await expect(page.locator("#baseline-tick")).toHaveText("3,000");
  await expect(page.locator("#split-tick")).toHaveText("2,507");
  await expect(page.locator("#split-frame-label")).toHaveText("Extinct · actual tick 2,507 · holding terminal frame");
  await expect(page.locator("#extinction-note")).toContainText("actual tick 2,507");
  await expect(page.locator("#numerical-gate")).toHaveText("Did not pass");
});

test("rejects a split arm whose raw bytes differ from the pair index", async ({ page }) => {
  await installFixture(page, buildPair({ wrongSplitHash: true }));
  await expect(page.locator("#error-detail")).toContainText("split-band raw-file SHA-256 does not match");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects split-only fields that move either replenishment band", async ({ page }) => {
  const variant = buildSplitArm();
  variant.samples[20].environment.bandColumns[0] = [1, 24];
  variant.dataSha256 = sha(JSON.stringify(Object.fromEntries(Object.entries(variant).filter(([key]) => key !== "dataSha256"))));
  await installFixture(page, buildPair({ variant }));
  await expect(page.locator("#error-detail")).toContainText("Split-band geometry at tick 400 is not the frozen columns 0–23 and 48–71");
  await expect(page.locator("#replay")).toBeHidden();
});

test("decision status cannot claim promising when receipt visual check fails", async ({ page }) => {
  await installFixture(page, buildPair({ status: "promising", splitPass: false }));
  await expect(page.locator("#error-detail")).toContainText("decision conflicts with saved gates and review (expected stop)");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects a visual receipt that is not bound to both listed arm hashes", async ({ page }) => {
  const fixture = buildPair({ status: "promising", splitPass: true });
  const receipt = JSON.parse(fixture.receiptText!);
  receipt.splitArtifactSha256 = "f".repeat(64);
  fixture.receiptText = `${JSON.stringify(receipt)}\n`;
  fixture.index.decision.visualReceiptSha256 = sha(fixture.receiptText);
  await installFixture(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("does not bind complete seed, plan, arm, and frame observations");
  await expect(page.locator("#replay")).toBeHidden();
});

test("every SHA-bound visual observation must disclose the known baseline and numerical outcome", async ({ page }) => {
  const fixture = buildPair({ status: "promising", splitPass: true });
  const receipt = JSON.parse(fixture.receiptText!);
  receipt.sameAgeComparisons[1].observation = "A descriptive comparison at the same requested tick.";
  fixture.receiptText = `${JSON.stringify(receipt)}\n`;
  fixture.index.decision.visualReceiptSha256 = sha(fixture.receiptText);
  await installFixture(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("Visual notes must disclose that review was not blind to the historical baseline and numerical outcome");
  await expect(page.locator("#replay")).toBeHidden();
});

test("keyboard controls, hidden-tab pause, and phone layout remain accessible", async ({ page }) => {
  await installFixture(page, buildPair());
  await page.locator("body").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#baseline-tick")).toHaveText("20");
  await page.getByRole("button", { name: "Play paired sampled replay" }).click();
  await expect(page.locator("#run-state")).toHaveText("Playing · saved states only");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.locator("#run-state")).toHaveText("Paused while away");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.setViewportSize({ width: 390, height: 844 });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("viewer source pins match the import-safe split runner source map", () => {
  const viewer = readFileSync(resolve(DOCS, "split-food-replication-viewer.js"), "utf8");
  const pins = Object.fromEntries([...viewer.matchAll(/^\s*"([^\"]+)":\s*"([a-f0-9]{64})",?$/gm)].map((match) => [match[1], match[2]]));
  expect(pins).toEqual(LOADED_SOURCE_SHA256);
});
