import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

// The replays are kept out of git (docs/creative-prototypes/ARTIFACTS.md); restore them to run these checks.
const hasReplays = ["hungry-shapes-seed-1201.json", "moving-food-moving-band-seed-1201.json", "moving-food-replication-moving-band-seed-1203.json", "moving-food-uniform-seed-1201.json", "stationary-food-replication-moving-band-seed-1203.json", BASELINE_FILE, SPLIT_FILE, "uniform-endurance-seed-1201.json", "uniform-endurance-seed-1202.json", "uniform-endurance-seed-1203.json", "split-food-replication-media/seed-1203-paired.mp4"].every((name) => existsSync(resolve(DOCS, name)));
const replaysMissing = "food-band replays are not restored (docs/creative-prototypes/ARTIFACTS.md)";
const { LOADED_SOURCE_SHA256 } = (hasReplays ? await import("../../tools/split-food-replication/explore.ts") : {}) as typeof import("../../tools/split-food-replication/explore.ts");
const baselineBytes = hasReplays ? readFileSync(resolve(DOCS, BASELINE_FILE)) : Buffer.alloc(0);
const baseline = (hasReplays ? JSON.parse(baselineBytes.toString("utf8")) : {}) as AnyRecord;
const baselineSha = sha(baselineBytes);
const baselineIndexSha256 = sha(readFileSync(resolve(DOCS, "stationary-food-replication-index-1203.json")));
const baselineRaw = `${baselineBytes.toString("utf8")}`;
const publishedSplitBytes = hasReplays ? readFileSync(resolve(DOCS, SPLIT_FILE)) : Buffer.alloc(0);
const publishedSplit = (hasReplays ? JSON.parse(publishedSplitBytes.toString("utf8")) : {}) as AnyRecord;
const publishedIndexBytes = readFileSync(resolve(DOCS, INDEX_FILE));
const publishedIndex = JSON.parse(publishedIndexBytes.toString("utf8")) as AnyRecord;
const publishedReceiptBytes = readFileSync(resolve(DOCS, RECEIPT_FILE));
const publishedReceipt = JSON.parse(publishedReceiptBytes.toString("utf8")) as AnyRecord;
const publishedSummary = JSON.parse(readFileSync(resolve(DOCS, "split-food-replication-summary.json"), "utf8")) as AnyRecord;
const publishedClipBytes = hasReplays ? readFileSync(resolve(DOCS, "split-food-replication-media/seed-1203-paired.mp4")) : Buffer.alloc(0);
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

async function installPublishedEvidence(page: Page) {
  const requests: string[] = [];
  const files = new Map<string, Buffer>([
    [BASELINE_FILE, baselineBytes], [SPLIT_FILE, publishedSplitBytes], [INDEX_FILE, publishedIndexBytes], [RECEIPT_FILE, publishedReceiptBytes],
    ["seed-1203-paired.mp4", publishedClipBytes],
  ]);
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url()), name = url.pathname.split("/").at(-1) ?? "";
    requests.push(url.pathname);
    if (name === "split-food-replication.html" || name === "split-food-replication-viewer.css" || name === "split-food-replication-viewer.js") {
      const type = name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : "text/html";
      await route.fulfill({ contentType: type, body: await readFile(resolve(DOCS, name)) }); return;
    }
    const bytes = files.get(name);
    if (bytes) {
      if (name.endsWith(".mp4")) {
        const range = route.request().headers().range;
        const match = range?.match(/^bytes=(\d+)-(\d*)$/);
        if (match) {
          const start = Number(match[1]), requestedEnd = match[2] ? Number(match[2]) : bytes.length - 1;
          const end = Math.min(requestedEnd, bytes.length - 1), chunk = bytes.subarray(start, end + 1);
          await route.fulfill({ status: 206, headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": String(chunk.length) }, body: chunk }); return;
        }
        await route.fulfill({ headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": String(bytes.length) }, body: bytes }); return;
      }
      await route.fulfill({ contentType: "application/json", body: bytes }); return;
    }
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
  test.skip(!hasReplays, replaysMissing);
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
  test.skip(!hasReplays, replaysMissing);
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
  test.skip(!hasReplays, replaysMissing);
  await installFixture(page, buildPair({ wrongSplitHash: true }));
  await expect(page.locator("#error-detail")).toContainText("split-band raw-file SHA-256 does not match");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects split-only fields that move either replenishment band", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const variant = buildSplitArm();
  variant.samples[20].environment.bandColumns[0] = [1, 24];
  variant.dataSha256 = sha(JSON.stringify(Object.fromEntries(Object.entries(variant).filter(([key]) => key !== "dataSha256"))));
  await installFixture(page, buildPair({ variant }));
  await expect(page.locator("#error-detail")).toContainText("Split-band geometry at tick 400 is not the frozen columns 0–23 and 48–71");
  await expect(page.locator("#replay")).toBeHidden();
});

test("decision status cannot claim promising when receipt visual check fails", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  await installFixture(page, buildPair({ status: "promising", splitPass: false }));
  await expect(page.locator("#error-detail")).toContainText("decision conflicts with saved gates and review (expected stop)");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects a visual receipt that is not bound to both listed arm hashes", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
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
  test.skip(!hasReplays, replaysMissing);
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
  test.skip(!hasReplays, replaysMissing);
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
  test.skip(!hasReplays, replaysMissing);
  const viewer = readFileSync(resolve(DOCS, "split-food-replication-viewer.js"), "utf8");
  const pins = Object.fromEntries([...viewer.matchAll(/^\s*"([^\"]+)":\s*"([a-f0-9]{64})",?$/gm)].map((match) => [match[1], match[2]]));
  expect(pins).toEqual(LOADED_SOURCE_SHA256);
});

test("published seed-1203 evidence is SHA-bound and displays the actual three-tick comparison", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const baselineRawSha = sha(baselineBytes), splitRawSha = sha(publishedSplitBytes);
  const indexRawSha = sha(publishedIndexBytes), receiptRawSha = sha(publishedReceiptBytes);
  expect(publishedIndex.planSha256).toBe(PLAN);
  expect(publishedIndex.arms.baseline.rawSha256).toBe(baselineRawSha);
  expect(publishedIndex.arms.split.rawSha256).toBe(splitRawSha);
  expect(publishedIndex.decision.status).toBe("promising");
  expect(publishedIndex.decision.baselineArtifactSha256).toBe(baselineRawSha);
  expect(publishedIndex.decision.splitArtifactSha256).toBe(splitRawSha);
  expect(publishedIndex.decision.visualReceiptSha256).toBe(receiptRawSha);
  expect(publishedReceipt.seed).toBe(1203);
  expect(publishedReceipt.planSha256).toBe(PLAN);
  expect(publishedReceipt.baselineArtifactSha256).toBe(baselineRawSha);
  expect(publishedReceipt.splitArtifactSha256).toBe(splitRawSha);
  expect(publishedReceipt.sameAgeComparisons.map((item: AnyRecord) => item.tick)).toEqual([1500, 2500, 3000]);
  expect(publishedSummary.pairManifestSha256).toBe(indexRawSha);
  expect(publishedSummary.visualReceiptSha256).toBe(receiptRawSha);
  expect(publishedSummary.decision).toBe("promising");
  expect(publishedSummary.threeFamilyEndpointRecurred).toBe(false);
  expect(publishedSummary.arms[0].rawSha256).toBe(baselineRawSha);
  expect(publishedSummary.arms[0].dataSha256).toBe(baseline.dataSha256);
  expect(publishedSummary.arms[0].census).toEqual(baseline.final.census);
  expect(publishedSummary.arms[1].rawSha256).toBe(splitRawSha);
  expect(publishedSummary.arms[1].dataSha256).toBe(publishedSplit.dataSha256);
  expect(publishedSummary.arms[1].census).toEqual(publishedSplit.final.census);

  const requests = await installPublishedEvidence(page);
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#source-status")).toContainText("Historical baseline and split-band record verified");
  await expect(page.locator("#decision-status")).toHaveText("Promising");
  await expect(page.locator("#pair-decision-summary")).toHaveText(publishedIndex.decision.summary);
  await expect(page.locator("#run-state")).toHaveText("Paused · recorded replay");
  const results = page.locator("#results");
  await expect(results.locator("h2")).toHaveText("Still lively, but no three-family balance this time");
  await expect(results.locator("p").first()).toContainText(
    `${publishedSplit.final.census.population} bodies: ${publishedSplit.final.census.familyCounts[0]} mint, ${publishedSplit.final.census.familyCounts[1]} gold and ${publishedSplit.final.census.familyCounts[2]} lilac`,
  );
  await expect(results.locator("p").first()).toContainText("The previous seed's 10 / 8 / 9 balance did not recur");
  const resultRows = results.locator("table tbody tr");
  await expect(resultRows).toHaveCount(2);
  for (const [rowIndex, arm] of [[0, baseline], [1, publishedSplit]] as const) {
    const census = arm.final.census;
    await expect(resultRows.nth(rowIndex)).toContainText(String(census.population));
    await expect(resultRows.nth(rowIndex)).toContainText(census.familyCounts.join(" / "));
    await expect(resultRows.nth(rowIndex)).toContainText(String(census.genomeVariantCount));
  }
  await expect(results).toContainText("The frozen gate required two families, not three.");
  await expect(results).toContainText("not the first seed's three-family result.");
  await expect(results).toContainText("tick-1,720 sample");
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual([
    `/docs/creative-prototypes/${INDEX_FILE}`,
    `/docs/creative-prototypes/${BASELINE_FILE}`,
    `/docs/creative-prototypes/${SPLIT_FILE}`,
    `/docs/creative-prototypes/${RECEIPT_FILE}`,
  ]);

  for (const tick of [1500, 2500, 3000]) {
    await page.locator(`[data-jump-tick="${tick}"]`).click();
    const baselineSample = baseline.samples.find((sample: AnyRecord) => sample.tick === tick);
    const splitSample = publishedSplit.samples.find((sample: AnyRecord) => sample.tick === tick);
    const splitFrame = publishedSplit.frames.find((frame: AnyRecord) => frame.tick === tick);
    await expect(page.locator("#baseline-tick")).toHaveText(tick.toLocaleString("en-US"));
    await expect(page.locator("#split-tick")).toHaveText(tick.toLocaleString("en-US"));
    for (const [prefix, sample] of [["baseline", baselineSample], ["split", splitSample]] as const) {
      await expect(page.locator(`#${prefix}-population`)).toHaveText(sample.census.population.toLocaleString("en-US"));
      await expect(page.locator(`#${prefix}-cells`)).toHaveText(sample.census.cells.toLocaleString("en-US"));
      await expect(page.locator(`#${prefix}-families`)).toHaveText(sample.census.familyCounts.map((count: number) => count.toLocaleString("en-US")).join(" · "));
      await expect(page.locator(`#${prefix}-offered`)).toHaveText(sample.environment.offered.toLocaleString("en-US"));
      await expect(page.locator(`#${prefix}-accepted`)).toHaveText(sample.environment.accepted.toLocaleString("en-US"));
    }
    const bands = countBands(splitFrame.cells);
    await expect(page.locator("#split-band-one")).toHaveText(bands[0].toLocaleString("en-US"));
    await expect(page.locator("#split-band-two")).toHaveText(bands[1].toLocaleString("en-US"));
  }
  await expect(page.locator("#numerical-gate")).toHaveText("Pass");
  await expect(page.locator("#spatial-2500")).toHaveText("290 · 165 occupied tiles · pass");
  await expect(page.locator("#spatial-3000")).toHaveText("126 · 448 occupied tiles · pass");
  await expect(page.locator("#visual-gate")).toContainText("Pass · Not blind:");
  const comparisons = page.locator("#same-age-comparisons li");
  await expect(comparisons).toHaveCount(3);
  for (const [index, tick] of [1500, 2500, 3000].entries()) {
    await expect(comparisons.nth(index)).toContainText(`Tick ${tick.toLocaleString("en-US")} · Not blind: the historical baseline and numerical outcome are known.`);
  }
  await expect(page.locator("#window-rows tr")).toHaveCount(baseline.windows.length + publishedSplit.windows.length);
  for (const window of publishedSplit.windows) {
    const row = page.locator("#window-rows tr").filter({ hasText: `Split bands${window.from.toLocaleString("en-US")}–${window.to.toLocaleString("en-US")}` });
    await expect(row).toContainText(`${window.births.toLocaleString("en-US")} · ${window.deaths.toLocaleString("en-US")}`);
    await expect(row).toContainText(window.endpoint.familyCounts.map((count: number) => count.toLocaleString("en-US")).join(" / "));
    await expect(row).toContainText(window.endpoint.genomeCounts.length.toLocaleString("en-US"));
  }
  const video = page.locator('[aria-labelledby="clip-title"] video');
  await expect(video).toHaveAttribute("src", "split-food-replication-media/seed-1203-paired.mp4");
  await video.evaluate((node: HTMLVideoElement) => new Promise<void>((resolve, reject) => {
    if (node.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) { resolve(); return; }
    node.addEventListener("canplay", () => resolve(), { once: true });
    node.addEventListener("error", () => reject(new Error(`Video could not play: ${node.error?.message ?? "unknown media error"}`)), { once: true });
  }));
  expect(await video.evaluate((node: HTMLVideoElement) => node.duration)).toBeCloseTo(15.1, 1);
  await video.evaluate((node: HTMLVideoElement) => node.play());
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime), { timeout: 5000 }).toBeGreaterThan(0.2);
  await video.evaluate((node: HTMLVideoElement) => node.pause());
  await page.locator('[data-jump-tick="1500"]').click();
  await page.getByRole("button", { name: "Play paired sampled replay" }).click();
  await expect(page.locator("#run-state")).toHaveText("Playing · saved states only");
  await page.getByRole("button", { name: "Pause paired sampled replay" }).click();
  await expect(page.locator("#run-state")).toHaveText("Paused · recorded replay");
  await page.setViewportSize({ width: 390, height: 844 });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
