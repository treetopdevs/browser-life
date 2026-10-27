import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOADED_SOURCE_SHA256 } from "../../tools/food-band-longevity-replication/explore.ts";

const ORIGIN = `http://localhost:${process.env.BL_E2E_PORT || "5174"}`;
const BASE = `${ORIGIN}/docs/creative-prototypes/`;
const DOCS = resolve("docs/creative-prototypes");
const PLAN = "6ae73fea19692f95e50538fecdc4203d89cf7ec5687ee38b6f580a57d94a005a";
const BASELINES = {
  1202: {
    "moving-band": { artifact: "1ba5caec32d22feef2482e13eab9550552bec974a6f9f7791c21714d375e598a", data: "1a554a54e2eeb5d4d83d06f52d21380cdc81eaad1d942d3048015577c15d0700", path: "stationary-food-moving-band-seed-1202.json" },
    "stationary-band": { artifact: "1c85fd8477644da9fb2bd54df0f5c1a463103db6ac49022e2caa2b0611badd39", data: "3c3ee5857d3f1f3f4eb2cad6eed6a1863db324e6bc5ed19635532a69b3f25bcf", path: "stationary-food-stationary-band-seed-1202.json" },
  },
  1203: {
    "moving-band": { artifact: "000e1ce6a3a60ab216707136ba97edf97bdcde826a63af2d3c27bf54e7810e3d", data: "e0e69c332b044f47515f6e4df1d3daa455dd704c26f93c60d8bc271449ece30a", path: "stationary-food-replication-moving-band-seed-1203.json" },
    "stationary-band": { artifact: "234c3c0eb54b5d6875f400e155b95f9afaa20638b511c0a4285305c9aac2ba7c", data: "236e98377fd6795236f2b6ecf3907bb637324866791e12c478e63ac7e9664ba7", path: "stationary-food-replication-stationary-band-seed-1203.json" },
  },
} as const;
const VIEWER_SOURCE = readFileSync(resolve(DOCS, "food-band-longevity-replication-viewer.js"), "utf8");
const PINNED_SOURCES: Record<string, string> = Object.fromEntries(
  [...VIEWER_SOURCE.matchAll(/^\s*"([^\"]+)":\s*"([a-f0-9]{64})",?$/gm)].map((match) => [match[1], match[2]]),
);
const FOOD = Buffer.alloc(96 * 96, 20).toString("base64");
const GENOME_A = { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 };
const GENOME_B = { ...GENOME_A, turn: 1 };
type Seed = 1202 | 1203;
type Mode = "moving-band" | "stationary-band";
type Evidence = Record<string, any>;
type Fixture = { index: Evidence; movingText: string; stationaryText: string; receiptText?: string; delayMs?: number };
type FixtureBank = Partial<Record<Seed, Fixture>>;
type DelayedBodyWindow = Window & { __seed1202IndexBodyPending?: boolean; __releaseSeed1202IndexBody?: () => void };
function sha(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function env(tick: number, mode: Mode) {
  const pulses = Math.floor(tick / 5), offered = pulses * 768;
  return { version: 1, mode, pulseBudget: 768, targetCount: 4608, pulses, offered, accepted: offered, overflow: 0,
    initialFoodPerTile: 20, bandLeft: mode === "moving-band" ? Math.floor(tick / 50) % 96 : 0, bandWidth: 48 };
}
function census(tick: number, dead = false) {
  return { tick, population: dead ? 0 : 2, cells: dead ? 0 : 3, familyCounts: dead ? [0, 0, 0] : [1, 1, 0],
    births: 0, deaths: dead ? 2 : 0, maxGeneration: 0, totalCells: dead ? 0 : 3 };
}
function makeArm(seed: Seed, mode: Mode, finalTick = 6000, extinct = false): Evidence {
  const ticks = Array.from({ length: Math.floor(finalTick / 20) + 1 }, (_, index) => index * 20);
  if (ticks.at(-1) !== finalTick) ticks.push(finalTick);
  const cells: [number, number][] = [[0, 1], [1, 1], [97, 2]];
  const samples = ticks.map((tick) => ({ tick, census: census(tick, extinct && tick === finalTick), environment: env(tick, mode),
    censusSha256: "0".repeat(64), stateSha256: "f".repeat(64), frameSha256: "0".repeat(64) }));
  const frames = ticks.map((tick) => ({ tick, censusSha256: "0".repeat(64), stateSha256: "f".repeat(64), foodBase64: FOOD,
    cells: extinct && tick === finalTick ? [] : cells,
    organisms: extinct && tick === finalTick ? [] : [{ id: 1, family: 0, genome: GENOME_A }, { id: 2, family: 1, genome: GENOME_B }],
    ledger: { initialEnergy: 0, supplied: 0, dissipated: 0, deathLoss: 0, expected: 0, actual: 0, residual: 0 }, frameSha256: "0".repeat(64) }));
  const ranges: [number, number][] = [[4501, 5000], [5001, 5500], [5501, 6000]];
  const tickRows = Array.from({ length: finalTick }, (_, index) => {
    const tick = index + 1, population = extinct && tick === finalTick ? 0 : 2;
    return { tick, population, cells: population ? 3 : 0, births: ranges.some(([from]) => tick === from) ? 1 : 0,
      deaths: ranges.some(([from]) => tick === from + 1) ? 1 : 0, blockedCap: 0, blockedSpace: 0,
      cap48: false, nearCap47: false };
  });
  const snapshotTicks = [...new Set([0, 500, 1500, 2500, 3000, 4500, 5500, 6000, finalTick])].filter((tick) => tick <= finalTick).sort((a, b) => a - b);
  const snapshots = snapshotTicks.map((tick) => ({ tick, terminal: extinct && tick === finalTick, environment: env(tick, mode), state: { tick }, stateSha256: "f".repeat(64) }));
  const prefix = { status: "verified", seed, normalization: "none; exact historical 3,000-tick prefix payload; no normalization",
    comparedSamples: 151, comparedFrames: 151, comparedTickRows: 3000, comparedSnapshots: 5,
    checkpoints: [0, 500, 1500, 2500, 3000].map((tick) => ({ tick, stateSha256: "f".repeat(64), compared: true })) };
  const sourceSha256 = { ...PINNED_SOURCES };
  const artifact: Evidence = { schemaVersion: 1, kind: "hungry-shapes-food-band-longevity-replication-arm",
    run: { seed, mode, mutation: true, maxTick: 6000, finalTick, extinctionTick: extinct ? finalTick : null },
    runtime: { node: "24.2.0", platform: "darwin", arch: "arm64" },
    rules: { width: 96, height: 96, tileCount: 9216, maxHistory: 451 },
    provenance: { sourceSha256, planSha256: PLAN, baselineArtifactSha256: BASELINES[seed][mode].artifact,
      baselineDataSha256: BASELINES[seed][mode].data, prefix },
    samples, tickRows, frames, snapshots, windows: [],
    final: { census: samples.at(-1)!.census, environment: samples.at(-1)!.environment, lineage: [], stateSha256: "f".repeat(64) },
    repeat: { verified: true, comparedThroughTick: finalTick, stateChecks: ticks.length, frameChecks: ticks.length },
    numericalGate: { aliveAt6000: false, atLeastTwoFamiliesAt6000: false, allWindowsReached: false,
      eachNewWindowHasBirthsAndDeaths: false, eachNewWindowCap48AtMost99: false, numericalPass: false, note: "Fixture only." } };
  for (const snapshot of snapshots) {
    const sample = samples.find((entry) => entry.tick === snapshot.tick)!;
    sample.stateSha256 = sha(JSON.stringify({ state: snapshot.state, environment: snapshot.environment }));
    snapshot.stateSha256 = sample.stateSha256;
  }
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i], sample = samples[i];
    sample.censusSha256 = sha(JSON.stringify(sample.census));
    frame.censusSha256 = sample.censusSha256;
    frame.stateSha256 = sample.stateSha256;
    const { frameSha256: _frameSha256, ...envelope } = frame;
    frame.frameSha256 = sha(JSON.stringify(envelope));
    sample.frameSha256 = frame.frameSha256;
  }
  for (const checkpoint of prefix.checkpoints) checkpoint.stateSha256 = samples.find((entry) => entry.tick === checkpoint.tick)!.stateSha256;
  artifact.final.census = samples.at(-1)!.census;
  artifact.final.environment = samples.at(-1)!.environment;
  artifact.final.stateSha256 = samples.at(-1)!.stateSha256;
  artifact.windows = ranges.map(([from, to]) => {
    const executedTicks = Math.max(0, Math.min(to, finalTick) - from + 1);
    const status = executedTicks === 500 ? "complete" : executedTicks === 0 ? "not-reached" : "partial";
    if (!executedTicks) return { from, to, denominatorTicks: 500, status, executedTicks, births: null, deaths: null,
      cap48Ticks: null, nearCap47Ticks: null, blockedCapAttempts: null, blockedSpaceAttempts: null, minPopulation: null, maxPopulation: null,
      food: { offered: null, accepted: null, overflow: null }, endpoint: { requestedTick: to, actualTick: null, population: null, cells: null,
        familyCounts: null, genomeCounts: null, maxGeneration: null, maxEverGeneration: null, foodRemaining: null, bandLeft: null,
        occupiedBandCells: null, occupiedBandShare: null } };
    const actualTick = Math.min(to, finalTick), endpointSample = samples.find((entry) => entry.tick === actualTick)!;
    const endpointFrame = frames.find((entry) => entry.tick === actualTick)!;
    const startEnvironment = env(from - 1, mode), endEnvironment = env(actualTick, mode);
    const observed = tickRows.filter((row) => row.tick >= from && row.tick <= actualTick);
    const bandLeft = endEnvironment.bandLeft;
    const occupiedBandCells = endpointFrame.cells.filter(([tile]) => ((tile % 96 - bandLeft + 96) % 96) < 48).length;
    const genomeCounts = endpointFrame.organisms.map((organism) => ({ genome: organism.genome, count: 1 }));
    return { from, to, denominatorTicks: 500, status, executedTicks,
      births: observed.reduce((sum, row) => sum + row.births, 0), deaths: observed.reduce((sum, row) => sum + row.deaths, 0),
      cap48Ticks: 0, nearCap47Ticks: 0, blockedCapAttempts: 0, blockedSpaceAttempts: 0,
      minPopulation: Math.min(...observed.map((row) => row.population)), maxPopulation: Math.max(...observed.map((row) => row.population)),
      food: { offered: endEnvironment.offered - startEnvironment.offered, accepted: endEnvironment.accepted - startEnvironment.accepted,
        overflow: endEnvironment.overflow - startEnvironment.overflow },
      endpoint: { requestedTick: to, actualTick, population: endpointSample.census.population, cells: endpointSample.census.cells,
        familyCounts: endpointSample.census.familyCounts, genomeCounts, maxGeneration: 0, maxEverGeneration: 0,
        foodRemaining: 96 * 96 * 20, bandLeft, occupiedBandCells,
        occupiedBandShare: endpointSample.census.cells ? occupiedBandCells / endpointSample.census.cells : null } };
  });
  const allReached = artifact.windows.every((window: Evidence) => window.status === "complete");
  const aliveAt6000 = finalTick === 6000 && !extinct;
  const atLeastTwoFamiliesAt6000 = aliveAt6000 && samples.at(-1)!.census.familyCounts.filter((count) => count > 0).length >= 2;
  const turnover = allReached && artifact.windows.every((window: Evidence) => window.births > 0 && window.deaths > 0);
  const capOkay = allReached && artifact.windows.every((window: Evidence) => window.cap48Ticks <= 99);
  artifact.numericalGate = { aliveAt6000, atLeastTwoFamiliesAt6000, allWindowsReached: allReached,
    eachNewWindowHasBirthsAndDeaths: turnover, eachNewWindowCap48AtMost99: capOkay,
    numericalPass: aliveAt6000 && atLeastTwoFamiliesAt6000 && allReached && turnover && capOkay, note: "Fixture only." };
  artifact.dataSha256 = sha(JSON.stringify(artifact));
  return artifact;
}
function makePair(seed: Seed, status: string = "pending", visual = { moving: false, stationary: false }, stationary = makeArm(seed, "stationary-band")): Fixture {
  const moving = makeArm(seed, "moving-band");
  const movingText = `${JSON.stringify(moving)}\n`, stationaryText = `${JSON.stringify(stationary)}\n`;
  const movingSha = sha(movingText), stationarySha = sha(stationaryText);
  const index: Evidence = { schemaVersion: 1, kind: "hungry-shapes-food-band-longevity-replication-pair", seed, planSha256: PLAN,
    arms: { movingBand: { mode: "moving-band", url: `food-band-longevity-replication-moving-band-seed-${seed}.json`, rawSha256: movingSha },
      stationaryBand: { mode: "stationary-band", url: `food-band-longevity-replication-stationary-band-seed-${seed}.json`, rawSha256: stationarySha } },
    decision: { status, summary: "Fixture only; not a pilot result.", movingBandArtifactSha256: movingSha, stationaryBandArtifactSha256: stationarySha } };
  const fixture: Fixture = { index, movingText, stationaryText };
  if (status !== "pending") {
    const disclosure = "Not blind; historical moving media exist. The parent knows both seeds’ numerical outcomes and historical media are available.";
    const receipt = { seed, planSha256: PLAN, movingBandArtifactSha256: movingSha, stationaryBandArtifactSha256: stationarySha,
      withinArmChanges: { movingBand: { from: 5500, to: 6000, pass: visual.moving, observation: `${disclosure} Moving clusters shift.` },
        stationaryBand: { from: 5500, to: 6000, pass: visual.stationary, observation: `${disclosure} Stationary clusters shift.` } },
      sameAgeComparisons: [3000, 5500, 6000].map((tick) => ({ tick, observation: `${disclosure} Descriptive comparison at ${tick}.` })),
      visualReviewedBeforeOverlapDiagnostics: true, reviewedAtUTC: "2026-10-26T18:00:00Z" };
    fixture.receiptText = `${JSON.stringify(receipt)}\n`;
    index.decision.visualReceiptUrl = `food-band-longevity-replication-visual-receipt-${seed}.json`;
    index.decision.visualReceiptSha256 = sha(fixture.receiptText);
  }
  return fixture;
}
async function installViewer(page: Page, fixtures: FixtureBank, options: { delaySeed1202Ms?: number; delaySeed1202Body?: boolean } = {}) {
  const requests: string[] = [];
  if (options.delaySeed1202Body) {
    await page.addInitScript(() => {
      const delayedWindow = window as DelayedBodyWindow;
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await nativeFetch(input, init);
        const requestUrl = input instanceof Request ? input.url : String(input);
        if (!new URL(requestUrl, window.location.href).pathname.endsWith("food-band-longevity-replication-index-1202.json")) return response;
        const bytes = new TextEncoder().encode(await response.text());
        let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controllerRef = controller;
            delayedWindow.__seed1202IndexBodyPending = true;
            controller.enqueue(bytes.slice(0, 1));
          },
        });
        delayedWindow.__releaseSeed1202IndexBody = () => {
          controllerRef?.enqueue(bytes.slice(1));
          controllerRef?.close();
        };
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      };
    });
  }
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url()), name = url.pathname.split("/").at(-1) ?? "";
    requests.push(url.pathname);
    if (["food-band-longevity-replication.html", "food-band-longevity-replication-viewer.css", "food-band-longevity-replication-viewer.js"].includes(name)) {
      const contentType = name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : "text/javascript";
      await route.fulfill({ contentType: `${contentType}; charset=utf-8`, body: await readFile(resolve(DOCS, name), "utf8") }); return;
    }
    const indexMatch = /^food-band-longevity-replication-index-(1202|1203)\.json$/.exec(name);
    if (indexMatch) {
      const seed = Number(indexMatch[1]) as Seed, fixture = fixtures[seed];
      if (seed === 1202 && options.delaySeed1202Ms) await new Promise((resolveDelay) => setTimeout(resolveDelay, options.delaySeed1202Ms));
      if (fixture) await route.fulfill({ contentType: "application/json", body: `${JSON.stringify(fixture.index)}\n` });
      else await route.fulfill({ status: 404, body: "{}" });
      return;
    }
    for (const seed of [1202, 1203] as const) {
      const fixture = fixtures[seed];
      if (!fixture) continue;
      if (name === `food-band-longevity-replication-moving-band-seed-${seed}.json`) { await route.fulfill({ contentType: "application/json", body: fixture.movingText }); return; }
      if (name === `food-band-longevity-replication-stationary-band-seed-${seed}.json`) { await route.fulfill({ contentType: "application/json", body: fixture.stationaryText }); return; }
      if (fixture.receiptText && name === `food-band-longevity-replication-visual-receipt-${seed}.json`) { await route.fulfill({ contentType: "application/json", body: fixture.receiptText }); return; }
    }
    await route.fulfill({ status: 404, contentType: "text/plain", body: "No such fixture file" });
  });
  await page.goto(`${BASE}food-band-longevity-replication.html`);
  return requests;
}

test("default seed 1202 requests only its index and leaves the selector usable", async ({ page }) => {
  const requests = await installViewer(page, {});
  await expect(page.getByRole("status")).toHaveText("No seed-1202 pair manifest is published yet.");
  await expect(page.getByRole("combobox", { name: "Choose recorded seed" })).toHaveValue("1202");
  await expect(page.getByRole("combobox", { name: "Choose recorded seed" })).toBeVisible();
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual(["/docs/creative-prototypes/food-band-longevity-replication-index-1202.json"]);
});

test("a selected seed-1203 pair loads only its listed arms and starts paused", async ({ page }) => {
  const requests = await installViewer(page, { 1203: makePair(1203) });
  await page.getByRole("combobox", { name: "Choose recorded seed" }).selectOption("1203");
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#decision-status")).toHaveText("Pending");
  await expect(page.locator("#run-state")).toHaveText("Paused · paired recorded states");
  await expect(page.locator("#moving-frame-label")).toHaveText("Tick 0 · saved sample");
  expect(requests).toContain("/docs/creative-prototypes/food-band-longevity-replication-index-1203.json");
  expect(requests).not.toContain("/docs/creative-prototypes/food-band-longevity-replication-moving-band-seed-1202.json");
});

test("seed picker reads its current value and discards a late seed-1202 response", async ({ page }) => {
  const requests = await installViewer(page, { 1202: makePair(1202), 1203: makePair(1203) }, { delaySeed1202Ms: 350 });
  await expect(page.getByRole("status")).toContainText("selected seed-1202");
  await page.getByRole("combobox", { name: "Choose recorded seed" }).selectOption("1203");
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#replay-title")).toHaveText("Seed 1203 · paired world states");
  await page.waitForTimeout(450);
  await expect(page.locator("#replay-title")).toHaveText("Seed 1203 · paired world states");
  await expect(page.locator("#decision-title")).toHaveText("Seed 1203 food-band longevity replication");
  expect(requests).toContain("/docs/creative-prototypes/food-band-longevity-replication-index-1202.json");
  expect(requests).toContain("/docs/creative-prototypes/food-band-longevity-replication-index-1203.json");
  expect(requests.filter((path) => path.includes("-seed-1202.json") && !path.includes("index-1202"))).toEqual([]);
});

test("seed picker ignores seed-1202 after its headers arrive but before its body parses", async ({ page }) => {
  const requests = await installViewer(page, { 1202: makePair(1202), 1203: makePair(1203) }, { delaySeed1202Body: true });
  await page.waitForFunction(() => (window as DelayedBodyWindow).__seed1202IndexBodyPending === true);
  await page.getByRole("combobox", { name: "Choose recorded seed" }).selectOption("1203");
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#replay-title")).toHaveText("Seed 1203 · paired world states");
  await page.evaluate(() => (window as DelayedBodyWindow).__releaseSeed1202IndexBody?.());
  await page.waitForTimeout(100);
  await expect(page.locator("#replay-title")).toHaveText("Seed 1203 · paired world states");
  await expect(page.locator("#source-status")).toContainText("Both seed-1203 arms verified");
  expect(requests).not.toContain("/docs/creative-prototypes/food-band-longevity-replication-moving-band-seed-1202.json");
  expect(requests).not.toContain("/docs/creative-prototypes/food-band-longevity-replication-stationary-band-seed-1202.json");
});

test("a fully gated fixture shows truthful paired sampled playback", async ({ page }) => {
  const requests = await installViewer(page, { 1202: makePair(1202, "both", { moving: true, stationary: true }) });
  await expect(page.locator("#decision-status")).toHaveText("Both varied");
  for (const tick of [3000, 5500, 6000]) {
    await page.locator(`[data-jump-tick="${tick}"]`).click();
    await expect(page.locator("#moving-tick")).toHaveText(tick.toLocaleString("en-US"));
    await expect(page.locator("#stationary-tick")).toHaveText(tick.toLocaleString("en-US"));
  }
  expect(requests).toContain("/docs/creative-prototypes/food-band-longevity-replication-visual-receipt-1202.json");
});

test("rejects a passing visual receipt without the exact late endpoint frame", async ({ page }) => {
  const fixture = makePair(1202, "moving-only", { moving: true, stationary: true }, makeArm(1202, "stationary-band", 5501, true));
  await installViewer(page, { 1202: fixture });
  await expect(page.locator("#error-detail")).toContainText("without exact saved frames at ticks 5,500 and 6,000");
  await expect(page.locator("#replay")).toBeHidden();
});

test("requires receipt disclosure of historical media and both seeds’ numerical outcomes", async ({ page }) => {
  const fixture = makePair(1202, "both", { moving: true, stationary: true });
  const receipt = JSON.parse(fixture.receiptText!);
  for (const change of Object.values(receipt.withinArmChanges) as Evidence[]) change.observation = "Not blind; historical moving media are known.";
  for (const comparison of receipt.sameAgeComparisons) comparison.observation = "Not blind; historical moving media are known.";
  fixture.receiptText = `${JSON.stringify(receipt)}\n`;
  fixture.index.decision.visualReceiptSha256 = sha(fixture.receiptText);
  await installViewer(page, { 1202: fixture });
  await expect(page.locator("#error-detail")).toContainText("not blind and historical media exist");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects raw artifact hash mismatch before drawing either world", async ({ page }) => {
  const fixture = makePair(1203);
  fixture.stationaryText = fixture.stationaryText.replace('"births":0', '"births":1');
  await installViewer(page, { 1203: fixture });
  await page.getByRole("combobox", { name: "Choose recorded seed" }).selectOption("1203");
  await expect(page.locator("#error-detail")).toContainText("stationary-band raw-file SHA-256 does not match");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects an arm wrapped for the wrong selected seed", async ({ page }) => {
  const fixture = makePair(1202);
  const wrongSeed = makeArm(1203, "moving-band");
  fixture.movingText = `${JSON.stringify(wrongSeed)}\n`;
  fixture.index.arms.movingBand.rawSha256 = sha(fixture.movingText);
  fixture.index.decision.movingBandArtifactSha256 = fixture.index.arms.movingBand.rawSha256;
  await installViewer(page, { 1202: fixture });
  await expect(page.locator("#error-detail")).toContainText("does not match seed 1202");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects empty decision summaries and unbound title fields", async ({ page }) => {
  const fixture = makePair(1202);
  fixture.index.decision.summary = " ";
  fixture.index.decision.title = "Unbound title";
  await installViewer(page, { 1202: fixture });
  await expect(page.locator("#error-detail")).toContainText("not bound to the listed raw SHA-256 values");
  await expect(page.locator("#replay")).toBeHidden();
});

test("keyboard playback pauses in hidden tabs and passes phone accessibility checks", async ({ page }) => {
  await installViewer(page, { 1203: makePair(1203) });
  await page.getByRole("combobox", { name: "Choose recorded seed" }).selectOption("1203");
  await expect(page.locator("#replay")).toBeVisible();
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

test("published seed 1202 replays its accepted saved frames and metrics on phone", async ({ page }) => {
  await assertPublishedPair(page, 1202);
});

test("published seed 1203 replays its accepted saved frames and metrics on phone", async ({ page }) => {
  await assertPublishedPair(page, 1203);
});

async function assertPublishedPair(page: Page, seed: Seed) {
  const indexText = await readFile(resolve(DOCS, `food-band-longevity-replication-index-${seed}.json`), "utf8");
  const index = JSON.parse(indexText) as Evidence;
  expect(index.kind).toBe("hungry-shapes-food-band-longevity-replication-pair");
  expect(index.seed).toBe(seed);
  expect(index.decision.status).toBe("both");
  expect(sha(await readFile(resolve(DOCS, index.decision.visualReceiptUrl)))).toBe(index.decision.visualReceiptSha256);
  const summary = JSON.parse(await readFile(resolve(DOCS, "food-band-longevity-replication-summary.json"), "utf8")) as Evidence;
  const summarySeed = summary.seeds.find((entry: Evidence) => entry.seed === seed);
  expect(summarySeed).toBeTruthy();
  expect(summarySeed.decision).toBe("both");
  expect(summarySeed.pairManifestSha256).toBe(sha(indexText));
  expect(summarySeed.visualReceiptSha256).toBe(index.decision.visualReceiptSha256);
  expect(summary.aggregate.tally).toEqual({ both: 2, "moving-only": 0, "stationary-only": 0, neither: 0 });
  expect(summary.aggregate.movingPasses).toBe(2);
  expect(summary.aggregate.stationaryPasses).toBe(2);
  const seed1202Summary = summary.seeds.find((entry: Evidence) => entry.seed === 1202);
  const priorStationary = JSON.parse(await readFile(resolve(DOCS, "stationary-food-stationary-band-seed-1202.json"), "utf8")) as Evidence;
  const prior1202Sample = priorStationary.samples.find((entry: Evidence) => entry.tick === 3000);
  expect(prior1202Sample).toBeTruthy();
  const final1202Stationary = seed1202Summary.arms.find((entry: Evidence) => entry.mode === "stationary-band");
  const reboundDescription = `The striking rebound is stationary seed 1202: its lilac family grew from ${fmtMetric(prior1202Sample.census.familyCounts[2])} bodies at 3,000 to ${fmtMetric(final1202Stationary.census.familyCounts[2])} at 6,000.`;

  const receipt = JSON.parse(await readFile(resolve(DOCS, index.decision.visualReceiptUrl), "utf8")) as Evidence;
  expect(receipt.withinArmChanges.movingBand.pass).toBe(true);
  expect(receipt.withinArmChanges.stationaryBand.pass).toBe(true);

  const arms = {} as Record<Mode, Evidence>;
  for (const mode of ["moving-band", "stationary-band"] as const) {
    const path = `food-band-longevity-replication-${mode}-seed-${seed}.json`;
    const raw = await readFile(resolve(DOCS, path));
    const arm = JSON.parse(raw.toString("utf8")) as Evidence;
    const manifestArm = mode === "moving-band" ? index.arms.movingBand : index.arms.stationaryBand;
    expect(manifestArm.url).toBe(path);
    expect(sha(raw)).toBe(manifestArm.rawSha256);
    expect(arm.run.seed).toBe(seed);
    expect(arm.run.finalTick).toBe(6000);
    expect(arm.numericalGate.numericalPass).toBe(true);
    const summaryArm = summarySeed.arms.find((entry: Evidence) => entry.mode === mode);
    expect(summaryArm.rawSha256).toBe(manifestArm.rawSha256);
    expect(summaryArm.run.finalTick).toBe(arm.run.finalTick);
    arms[mode] = arm;
  }

  await installPublishedFiles(page);
  await page.goto(`${BASE}food-band-longevity-replication.html`);
  if (seed !== 1202) await page.getByRole("combobox", { name: "Choose recorded seed" }).selectOption(String(seed));
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#source-status")).toContainText(`Both seed-${seed} arms verified`);
  await expect(page.locator("#decision-status")).toHaveText("Both varied");
  await expect(page.locator("#replay-title")).toHaveText(`Seed ${seed} · paired world states`);
  await expect(page.locator("#run-state")).toHaveText("Paused · paired recorded states");

  const resultRows = page.getByRole("region", { name: "Final populations, scroll on small screens" }).locator("tbody tr");
  const rowOffset = seed === 1202 ? 0 : 2;
  for (const [modeIndex, mode] of (["moving-band", "stationary-band"] as const).entries()) {
    const row = resultRows.nth(rowOffset + modeIndex);
    const summaryArm = summarySeed.arms.find((entry: Evidence) => entry.mode === mode);
    await expect(row.locator("th")).toHaveText(`${seed} ${mode === "moving-band" ? "moving" : "stationary"}`);
    await expect(row.locator("td").nth(0)).toHaveText(fmtMetric(summaryArm.census.population));
    await expect(row.locator("td").nth(1)).toHaveText(summaryArm.census.familyCounts.map(fmtMetric).join(" / "));
    await expect(row.locator("td").nth(2)).toHaveText(fmtMetric(summaryArm.census.genomeVariantCount));
  }
  const bothPairs = new Map([[0, "zero"], [1, "one"], [2, "two"]]).get(summary.aggregate.tally.both);
  expect(bothPairs).toBeTruthy();
  await expect(page.locator("#results")).toContainText(`${bothPairs} both-pass pairs`);
  await expect(page.locator("#results")).toContainText(reboundDescription);

  for (const tick of [3000, 5500, 6000]) {
    await page.locator(`[data-jump-tick="${tick}"]`).click();
    for (const mode of ["moving-band", "stationary-band"] as const) {
      const key = mode === "moving-band" ? "moving" : "stationary";
      const frame = arms[mode].frames.find((entry: Evidence) => entry.tick === tick);
      const sample = arms[mode].samples.find((entry: Evidence) => entry.tick === tick);
      expect(frame, `${seed} ${mode} has saved frame at ${tick}`).toBeTruthy();
      expect(sample, `${seed} ${mode} has saved sample at ${tick}`).toBeTruthy();
      await expect(page.locator(`#${key}-tick`)).toHaveText(fmtMetric(tick));
      await expect(page.locator(`#${key}-frame-label`)).toHaveText(`Tick ${tick.toLocaleString("en-US")} · saved sample`);
      await expect(page.locator(`#${key}-population`)).toHaveText(fmtMetric(sample.census.population));
      await expect(page.locator(`#${key}-cells`)).toHaveText(fmtMetric(sample.census.cells));
      await expect(page.locator(`#${key}-families`)).toHaveText(sample.census.familyCounts.map(fmtMetric).join(" · "));
      await expect(page.locator(`#${key}-offered`)).toHaveText(fmtMetric(sample.environment.offered));
      await expect(page.locator(`#${key}-band-left`)).toHaveText(fmtMetric(sample.environment.bandLeft));
      const remainingFood = Buffer.from(frame.foodBase64, "base64").reduce((sum, amount) => sum + amount, 0);
      await expect(page.locator(`#${key}-food`)).toHaveText(fmtMetric(remainingFood));
    }
  }

  await page.getByRole("button", { name: "Play paired sampled replay" }).click();
  await expect(page.locator("#run-state")).toHaveText("Playing · saved states only");
  await expect(page.getByRole("button", { name: "Pause paired sampled replay" })).toBeVisible();
  await page.getByRole("button", { name: "Pause paired sampled replay" }).click();
  await expect(page.locator("#run-state")).toHaveText("Paused · recorded replay");

  const clip = page.locator(`video[aria-label="Seed ${seed} paired recorded animation"]`);
  await clip.evaluate((element: HTMLVideoElement) => new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Saved animation did not reach canplay in time.")), 10000);
    element.addEventListener("canplay", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
    if (element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) { window.clearTimeout(timeout); resolve(); }
  }));
  expect(await clip.evaluate((element: HTMLVideoElement) => element.duration)).toBeGreaterThan(0);
  const playedSeconds = await clip.evaluate(async (element: HTMLVideoElement) => {
    await element.play();
    const deadline = Date.now() + 4000;
    while (element.currentTime <= 0 && Date.now() < deadline) await new Promise((resolve) => window.setTimeout(resolve, 50));
    const currentTime = element.currentTime;
    element.pause();
    return currentTime;
  });
  expect(playedSeconds).toBeGreaterThan(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

function fmtMetric(value: number) { return new Intl.NumberFormat("en-US").format(value); }

async function installPublishedFiles(page: Page) {
  const names = new Set([
    "food-band-longevity-replication.html",
    "food-band-longevity-replication-viewer.css",
    "food-band-longevity-replication-viewer.js",
    "food-band-longevity-replication-summary.json",
    ...[1202, 1203].flatMap((seed) => [
      `food-band-longevity-replication-index-${seed}.json`,
      `food-band-longevity-replication-visual-receipt-${seed}.json`,
      `food-band-longevity-replication-moving-band-seed-${seed}.json`,
      `food-band-longevity-replication-stationary-band-seed-${seed}.json`,
      `food-band-longevity-replication-media/seed-${seed}-paired.mp4`,
      `food-band-longevity-replication-media/seed-${seed}-comparison.png`,
    ]),
  ]);
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const prefix = "/docs/creative-prototypes/";
    const relative = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
    if (!names.has(relative)) {
      await route.fulfill({ status: 404, contentType: "text/plain", body: `No published test asset: ${relative}` });
      return;
    }
    const body = await readFile(resolve(DOCS, relative));
    const contentType = relative.endsWith(".html") ? "text/html" : relative.endsWith(".css") ? "text/css" : relative.endsWith(".js") ? "text/javascript" : relative.endsWith(".json") ? "application/json" : relative.endsWith(".mp4") ? "video/mp4" : "image/png";
    await route.fulfill({ status: 200, contentType, body });
  });
}

test("viewer source pins exactly match the runner's loaded source map", () => {
  expect(PINNED_SOURCES).toEqual(LOADED_SOURCE_SHA256);
});
