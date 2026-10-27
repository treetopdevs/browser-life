import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ORIGIN = `http://localhost:${process.env.BL_E2E_PORT || "5429"}`;
const BASE = `${ORIGIN}/docs/creative-prototypes/`;
const DOCS = resolve("docs/creative-prototypes");
const PLAN = "74dc68201c7fb51ed9a87ba75d13e0ad79b171ff0d73d7929af4ba4f03fa114a";
const BASELINES: Record<number, { artifact: string; data: string; historical: string }> = {
  1201: { artifact: "46017d1db1eaf1ff85b8cc51d92533d928aeac18b3e7cf261a82bb9d0d0816bf", data: "d72aca82bdce496b59fcc8f6e10d1576a3b91b6e3931a209c1af0640c93f61c8", historical: "46017d1db1eaf1ff85b8cc51d92533d928aeac18b3e7cf261a82bb9d0d0816bf" },
  1203: { artifact: "8ce7be228812002e2d03a2f68a15b9d1107e6fff022006ae9059003bb66e0c9b", data: "eb8a0985950d5de4450b1a911bd602761644a3adb96a9bd8265c5fd1e5af572e", historical: "8ce7be228812002e2d03a2f68a15b9d1107e6fff022006ae9059003bb66e0c9b" },
};
const PINNED_SOURCES: Record<string, string> = {
  "apps/lab/src/development/model.ts": "49416b11ae8d0491cb9b2ae1f102f36779cd9fe0c72917a7ddf86fbbc63db072",
  "apps/lab/src/hungry-shapes/model.ts": "a33a3312caa6c91a46e2508f5b9267e3394089ff7320145a15157770068123bc",
  "apps/lab/src/moving-food/model.ts": "b7aa0a3f1a0183d574e152e16b7f12c24fc0c9a201e7ddfae6d576915f10d8b0",
  "apps/lab/src/stationary-food/model.ts": "7bd5af02243cb0629547a20d889a05cd904246a16227f58df4e420edc84a859f",
  "tools/stationary-food/explore.ts": "ab692de5ede5ece9cfdc1af8d0e44c651a0bc30ff8aa6493b35e6a02672250f6",
  "tools/moving-food/explore.ts": "b77c58eca007727beeca81b1a797978a8ddfbacaa4d3192a094164bf868df63a",
  "tools/moving-food-replication/explore.ts": "a8403864210d575baaa0acfae4a1a8ab684909bf0e8df541a1103394d2e11969",
  "docs/creative-prototypes/stationary-food-plan.md": "ba835f94fddbd48a823fb6264d3e4f9d8a815014c5bc5e4997fec56e6f7aaa51",
  "docs/creative-prototypes/stationary-food-replication-plan.md": PLAN,
  "docs/creative-prototypes/moving-food-moving-band-seed-1201.json": "46017d1db1eaf1ff85b8cc51d92533d928aeac18b3e7cf261a82bb9d0d0816bf",
  "docs/creative-prototypes/moving-food-replication-moving-band-seed-1203.json": "8ce7be228812002e2d03a2f68a15b9d1107e6fff022006ae9059003bb66e0c9b",
  "docs/creative-prototypes/moving-food-index.json": "5f2ca66cb2d0bd39c0c017c4372381032746a0ba14076ecef71d8df079cccc57",
  "docs/creative-prototypes/moving-food-replication-index-1203.json": "44e02b3416e40cdde5318c1fecea2dd54bda8f9543df97c006aabc29dc24ce16",
  "docs/creative-prototypes/hungry-shapes-seed-1201.json": "2cb6366595e43e2f5f215448bd13a67925e21f2ea11e4747790f6f61470b6520",
  "docs/creative-prototypes/hungry-shapes-seed-1201.md": "0f64a51d0ab22fe346160ed0ef94877a78998700372ce8ff1ffde3ef0f88a0f1",
  "docs/creative-prototypes/hungry-shapes-decision.json": "f935884132cd1f34edb5fec1af57eeaa033d87505448ea07acd05ed772c5d5b0",
  "apps/lab/src/uniform-endurance/model.ts": "b83de32cf42f58c13977dbbd3c74bf9d3068f90b40ec09600b9125ddb0a72009",
  "tools/hungry-shapes/explore.ts": "f49d2a63fc7b464bcd2115c683f3e40ec8381eb28aa8b318889552ea9bc23581",
  "tools/uniform-food/explore.ts": "312c2cffd7102e8c58fc1eabb72173d53692c8527f950b74ba33be4917b4a80c",
  "tools/uniform-endurance/explore.ts": "99099663fd619a644c29ff639bca1e6c884bc9d07161f3ba40fe3ec2f0fd7f77",
  "docs/creative-prototypes/uniform-endurance-seed-1201.json": "6b480bced89b1c7bf9ab759c84fb28c9bfdcd1f9c2a6ecc7e922ddba1a590221",
  "docs/creative-prototypes/uniform-endurance-seed-1201.md": "b7a831f8c6565479f9644d4ad06be86fbe230a41908773158af77116b7b699f2",
  "docs/creative-prototypes/uniform-endurance-seed-1202.json": "a67a99bde41317f59c3b0fdf6521cc561c9a2b4db38d12783ea2f9be0d5f5602",
  "docs/creative-prototypes/uniform-endurance-seed-1202.md": "3de277dc0d3a11acd20501a1c6a55133dd46ed80b0609c643f8111f7806aacda",
  "docs/creative-prototypes/uniform-endurance-seed-1203.json": "94fa6328fb74038793f859d629ef9535e5f610dd22eceeaa74d4677218b2b15d",
  "docs/creative-prototypes/uniform-endurance-seed-1203.md": "0ee0dc77840fa97babf8b1569ce66245b2e978692138cd2dc46cfeed587c1bbd",
  "docs/creative-prototypes/moving-food-replication-plan.md": "72f651acc7f221991b0ce89f7264eed9dd47df54e955d3d164406b4d0a17cc47",
  "docs/creative-prototypes/moving-food-uniform-seed-1201.json": "1ae6bdc3c9f5bedd2b6f6cfb70aa9dc94e8acb8177f4c2ecda9c2859bf1e4458",
  "docs/creative-prototypes/moving-food-uniform-seed-1201.md": "af43523fa6108f6a136d5eb734db3908c6258c862c29bc69edb71f53123d6efe",
  "docs/creative-prototypes/moving-food-moving-band-seed-1201.md": "b2de64b26073439a52ca2ed7fa121d078e559d32205c8737e3252cf1aa7f6471",
  "tools/stationary-food-replication/explore.ts": "18d9c74da2cd2d803923a544c2b717b06976909738699756e16abaa832b316f4",
};
const FOOD = Buffer.alloc(96 * 96, 20).toString("base64");
const G0 = { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 };
const G1 = { ...G0, turn: 1 };
type Mode = "moving-band" | "stationary-band";
type Evidence = Record<string, any>;
type Fixture = { index: Record<string, any>; movingText: string; stationaryText: string; receiptText?: string };
type FixtureSource = Fixture | null | Partial<Record<1201 | 1203, Fixture | null>>;
function sha(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function env(tick: number, mode: Mode) {
  const pulses = Math.floor(tick / 5), offered = pulses * 768;
  return { version: 1, mode, pulseBudget: 768, targetCount: 4608, pulses, offered, accepted: offered, overflow: 0,
    initialFoodPerTile: 20, bandLeft: mode === "moving-band" ? Math.floor(tick / 50) % 96 : 0, bandWidth: 48 };
}
function census(tick: number, population = 2) {
  return { tick, population, cells: population ? 3 : 0, familyCounts: population ? [1, 1, 0] : [0, 0, 0],
    births: 0, deaths: population ? 0 : 2, maxGeneration: 0, totalCells: population ? 3 : 0 };
}
function makeArm(mode: Mode, gate = true, finalTick = 3000, extinct = false, seed = 1201): Evidence {
  const ticks = Array.from({ length: Math.floor(finalTick / 20) + 1 }, (_, i) => i * 20);
  if (ticks.at(-1) !== finalTick) ticks.push(finalTick);
  const cells = [[0, 1], [1, 1], [97, 2]];
  const samples = ticks.map((tick) => ({ tick, census: census(tick, extinct && tick === finalTick ? 0 : 2), environment: env(tick, mode),
    censusSha256: "0".repeat(64), stateSha256: "f".repeat(64), frameSha256: "0".repeat(64) }));
  const frames = ticks.map((tick) => ({ tick, censusSha256: "0".repeat(64), stateSha256: "f".repeat(64), foodBase64: FOOD,
    cells: extinct && tick === finalTick ? [] : cells, organisms: extinct && tick === finalTick ? [] : [
      { id: 1, family: 0, genome: G0 }, { id: 2, family: 1, genome: G1 }],
    ledger: { initialEnergy: 0, supplied: 0, dissipated: 0, deathLoss: 0, expected: 0, actual: 0, residual: 0 }, frameSha256: "0".repeat(64) }));
  const ranges = [[1501, 2000], [2001, 2500], [2501, 3000]];
  const rows = Array.from({ length: finalTick }, (_, i) => {
    const tick = i + 1, windowStart = ranges.some(([from]) => tick === from), windowSecond = ranges.some(([from]) => tick === from + 1);
    const zero = extinct && tick === finalTick;
    return { tick, population: zero ? 0 : 2, births: gate && windowStart ? 1 : 0, deaths: gate && windowSecond ? 1 : 0,
      blockedCap: 0, blockedSpace: 0, cap48: false, nearCap47: false };
  });
  const windows = ranges.map(([from, to]) => {
    const executedTicks = Math.max(0, Math.min(to, finalTick) - from + 1), status = executedTicks === 500 ? "complete" : executedTicks ? "partial" : "not-reached";
    if (!executedTicks) return { from, to, denominatorTicks: 500, status, executedTicks, births: null, deaths: null, cap48Ticks: null,
      nearCap47Ticks: null, blockedCapAttempts: null, blockedSpaceAttempts: null, minPopulation: null, maxPopulation: null,
      food: { offered: null, accepted: null, overflow: null }, endpoint: { requestedTick: to, actualTick: null, population: null,
        cells: null, familyCounts: null, genomeCounts: [], maxGeneration: null, maxEverGeneration: null, foodRemaining: null,
        bandLeft: null, occupiedBandCells: null, occupiedBandShare: null } };
    const actualTick = Math.min(to, finalTick), endedExtinct = extinct && actualTick === finalTick, e = env(actualTick, mode), start = env(from - 1, mode);
    const bandLeft = mode === "moving-band" ? Math.floor(actualTick / 50) % 96 : 0;
    const occupiedBandCells = endedExtinct ? 0 : cells.filter(([tile]) => (tile % 96 - bandLeft + 96) % 96 < 48).length;
    const active = rows.filter((row) => row.tick >= from && row.tick <= actualTick);
    return { from, to, denominatorTicks: 500, status, executedTicks, births: active.reduce((n, r) => n + r.births, 0),
      deaths: active.reduce((n, r) => n + r.deaths, 0), cap48Ticks: 0, nearCap47Ticks: 0, blockedCapAttempts: 0, blockedSpaceAttempts: 0,
      minPopulation: endedExtinct ? 0 : 2, maxPopulation: 2,
      food: { offered: e.offered - start.offered, accepted: e.accepted - start.accepted, overflow: e.overflow - start.overflow },
      endpoint: { requestedTick: to, actualTick, population: endedExtinct ? 0 : 2, cells: endedExtinct ? 0 : 3,
        familyCounts: endedExtinct ? [0, 0, 0] : [1, 1, 0], genomeCounts: endedExtinct ? [] : [{ genome: G0, count: 1 }, { genome: G1, count: 1 }],
        maxGeneration: 0, maxEverGeneration: 0, foodRemaining: 96 * 96 * 20, bandLeft, occupiedBandCells,
        occupiedBandShare: endedExtinct ? null : occupiedBandCells / 3 } };
  });
  const fixed = [0, 500, 1500, 2500, 3000, finalTick].filter((t, i, all) => t <= finalTick && all.indexOf(t) === i);
  const snapshots = fixed.map((tick) => ({ tick, terminal: extinct && tick === finalTick, environment: env(tick, mode), state: { tick }, stateSha256: "f".repeat(64) }));
  const prefix = mode === "moving-band" ? { status: "verified", seed, normalization: "none; exact historical moving-band payload; no normalization",
    comparedSamples: 151, comparedFrames: 151, comparedTickRows: 3000, comparedSnapshots: 5,
    checkpoints: [0, 500, 1500, 2500, 3000].map((tick) => ({ tick, stateSha256: "f".repeat(64), compared: true })) } : {
    status: "not-applicable", seed: null, normalization: "none; stationary-band has no moving-reference prefix", comparedSamples: 0,
    comparedFrames: 0, comparedTickRows: 0, comparedSnapshots: 0, checkpoints: [] };
  const arm = { schemaVersion: 1, kind: "hungry-shapes-stationary-food-replication-arm", run: { seed, mode, mutation: true, maxTick: 3000,
      finalTick, extinctionTick: extinct ? finalTick : null }, runtime: { node: "24.2.0", platform: "darwin", arch: "arm64" },
    rules: { width: 96, height: 96, tileCount: 9216, maxHistory: 451 },
    provenance: { sourceSha256: { ...PINNED_SOURCES }, planSha256: PLAN, baselineArtifactSha256: BASELINES[seed].artifact, baselineDataSha256: BASELINES[seed].data, prefix },
    samples, tickRows: rows, frames, snapshots, windows, final: { census: samples.at(-1)!.census, environment: samples.at(-1)!.environment,
      lineage: [], stateSha256: "f".repeat(64) }, repeat: { verified: true, comparedThroughTick: finalTick, stateChecks: ticks.length, frameChecks: ticks.length },
    numericalGate: { aliveAt3000: finalTick === 3000 && !extinct, atLeastTwoFamiliesAt3000: finalTick === 3000 && !extinct,
      allWindowsReached: finalTick === 3000 && !extinct, eachNewWindowHasBirthsAndDeaths: gate && finalTick === 3000 && !extinct,
      eachNewWindowCap48AtMost99: finalTick === 3000 && !extinct, numericalPass: gate && finalTick === 3000 && !extinct, note: "Fixture only." } };
  return sealArm(arm);
}
function sealArm(arm: Evidence) {
  for (const snap of arm.snapshots) {
    const sample = arm.samples.find((row: Evidence) => row.tick === snap.tick)!;
    sample.stateSha256 = sha(JSON.stringify({ state: snap.state, environment: snap.environment })); snap.stateSha256 = sample.stateSha256;
  }
  for (let i = 0; i < arm.frames.length; i++) {
    const frame = arm.frames[i], sample = arm.samples[i]; sample.censusSha256 = sha(JSON.stringify(sample.census));
    frame.censusSha256 = sample.censusSha256; frame.stateSha256 = sample.stateSha256;
    const base = { ...frame }; delete base.frameSha256; frame.frameSha256 = sha(JSON.stringify(base)); sample.frameSha256 = frame.frameSha256;
  }
  if (arm.run.mode === "moving-band") for (const cp of arm.provenance.prefix.checkpoints) cp.stateSha256 = arm.samples.find((s: Evidence) => s.tick === cp.tick)!.stateSha256;
  arm.final.census = arm.samples.at(-1).census; arm.final.environment = arm.samples.at(-1).environment; arm.final.stateSha256 = arm.samples.at(-1).stateSha256;
  delete arm.dataSha256; arm.dataSha256 = sha(JSON.stringify(arm)); return arm;
}
function makePair(moving = makeArm("moving-band"), stationary = makeArm("stationary-band"), status = "pending", visual = { moving: false, stationary: false }): Fixture {
  const seed = moving.run.seed;
  const movingText = JSON.stringify(moving), stationaryText = JSON.stringify(stationary), movingSha = sha(movingText), stationarySha = sha(stationaryText);
  const index: Record<string, any> = { schemaVersion: 1, kind: "hungry-shapes-stationary-food-replication-pair", seed, planSha256: PLAN,
    arms: { movingBand: { mode: "moving-band", url: `stationary-food-replication-moving-band-seed-${seed}.json`, rawSha256: movingSha },
      stationaryBand: { mode: "stationary-band", url: `stationary-food-replication-stationary-band-seed-${seed}.json`, rawSha256: stationarySha } },
    decision: { status, summary: "Fixture only; no pilot result.", movingBandArtifactSha256: movingSha, stationaryBandArtifactSha256: stationarySha } };
  const fixture: Fixture = { index, movingText, stationaryText };
  if (status !== "pending") bindReceipt(fixture, visual);
  return fixture;
}
function bindReceipt(fixture: Fixture, visual: { moving: boolean; stationary: boolean }) {
  const seed = fixture.index.seed;
  const receipt = { seed, planSha256: PLAN, movingBandArtifactSha256: fixture.index.arms.movingBand.rawSha256,
    stationaryBandArtifactSha256: fixture.index.arms.stationaryBand.rawSha256,
    withinArmChanges: { movingBand: { from: 2500, to: 3000, pass: visual.moving, observation: "This rejudgment is not blind because historical moving media exist; fixture body arrangement note." },
      stationaryBand: { from: 2500, to: 3000, pass: visual.stationary, observation: "This rejudgment is not blind because historical moving media exist; fixture body arrangement note." } },
    sameAgeComparisons: [1500, 2500, 3000].map((tick) => ({ tick, observation: `Not blind; historical moving media exist. Descriptive fixture comparison at ${tick}.` })),
    visualReviewedBeforeOverlapDiagnostics: true, reviewedAtUTC: "2026-10-26T15:00:00Z" };
  fixture.receiptText = JSON.stringify(receipt);
  fixture.index.decision.visualReceiptUrl = `stationary-food-replication-visual-receipt-${seed}.json`;
  fixture.index.decision.visualReceiptSha256 = sha(fixture.receiptText);
}
async function actualPair(seed: 1201 | 1203): Promise<Fixture> {
  const prefix = `stationary-food-replication-`;
  const index = JSON.parse(await readFile(resolve(DOCS, `${prefix}index-${seed}.json`), "utf8"));
  const movingText = await readFile(resolve(DOCS, `${prefix}moving-band-seed-${seed}.json`), "utf8");
  const stationaryText = await readFile(resolve(DOCS, `${prefix}stationary-band-seed-${seed}.json`), "utf8");
  const receiptText = await readFile(resolve(DOCS, `${prefix}visual-receipt-${seed}.json`), "utf8");
  return { index, movingText, stationaryText, receiptText };
}
async function installViewer(page: Page, source: FixtureSource, initialSeed = 1201) {
  const requests: string[] = [];
  const singleFixture = source && "index" in source ? source : null;
  const fixtureFor = (seed: number): Fixture | null => {
    if (singleFixture || !source) return seed === 1201 ? singleFixture : null;
    return (source as Partial<Record<1201 | 1203, Fixture | null>>)[seed as 1201 | 1203] ?? null;
  };
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url()), name = url.pathname.split("/").at(-1) ?? ""; requests.push(url.pathname);
    if (name === "stationary-food-replication.html" || name === "stationary-food-replication-viewer.css" || name === "stationary-food-replication-viewer.js") {
      const type = name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : "text/javascript";
      let body = await readFile(resolve(DOCS, name), "utf8");
      if (name.endsWith(".html") && initialSeed === 1203) {
        body = body.replace('<option value="1201" selected>', '<option value="1201">')
          .replace('<option value="1203">', '<option value="1203" selected>');
      }
      await route.fulfill({ contentType: `${type}; charset=utf-8`, body }); return;
    }
    const indexMatch = /^stationary-food-replication-index-(1201|1203)\.json$/.exec(name);
    if (indexMatch) {
      const fixture = fixtureFor(Number(indexMatch[1]));
      if (!fixture) await route.fulfill({ status: 404, body: "{}" });
      else await route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture.index) }); return;
    }
    const armMatch = /^stationary-food-replication-(moving-band|stationary-band)-seed-(1201|1203)\.json$/.exec(name);
    if (armMatch) {
      const fixture = fixtureFor(Number(armMatch[2]));
      if (fixture) await route.fulfill({ contentType: "application/json", body: armMatch[1] === "moving-band" ? fixture.movingText : fixture.stationaryText });
      else await route.fulfill({ status: 404, body: "{}" });
      return;
    }
    const receiptMatch = /^stationary-food-replication-visual-receipt-(1201|1203)\.json$/.exec(name);
    if (receiptMatch) {
      const fixture = fixtureFor(Number(receiptMatch[1]));
      if (fixture?.receiptText) await route.fulfill({ contentType: "application/json", body: fixture.receiptText });
      else await route.fulfill({ status: 404, body: "{}" });
      return;
    }
    await route.fulfill({ status: 404, contentType: "text/plain", body: "No such fixture file" });
  });
  await page.goto(`${BASE}stationary-food-replication.html`); return requests;
}

test("empty page asks only for the one seed-1201 index", async ({ page }) => {
  const requests = await installViewer(page, null);
  await expect(page.getByRole("status")).toHaveText("No paired manifest is published for seed 1201 yet.");
  await expect(page.getByRole("heading", { name: "No pair is published for this seed yet." })).toBeVisible();
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual(["/docs/creative-prototypes/stationary-food-replication-index-1201.json"]);
});

test("fixture baseline identities match the stationary runner's reference table", async () => {
  const runner = await readFile(resolve("tools/stationary-food-replication/explore.ts"), "utf8");
  for (const seed of [1201, 1203]) {
    const line = runner.split(/\r?\n/).find((candidate) => candidate.includes(`${seed}:Object.freeze({artifactPath:`));
    const reference = line && /artifactPath:'([^']+)',artifactSha256:'([a-f0-9]{64})',dataSha256:'([a-f0-9]{64})'/.exec(line);
    expect(reference, `runner reference for seed ${seed}`).not.toBeNull();
    expect(BASELINES[seed].artifact).toBe(reference![2]);
    expect(BASELINES[seed].data).toBe(reference![3]);
    expect(PINNED_SOURCES[reference![1]]).toBe(reference![2]);
  }
});

test("restored seed selection drives the initial request", async ({ page }) => {
  const fixture = makePair(makeArm("moving-band", true, 3000, false, 1203), makeArm("stationary-band", true, 3000, false, 1203));
  const requests = await installViewer(page, { 1203: fixture }, 1203);
  await expect(page.locator("#replay-title")).toHaveText("Seed 1,203 · paired world states");
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual([
    "/docs/creative-prototypes/stationary-food-replication-index-1203.json",
    "/docs/creative-prototypes/stationary-food-replication-moving-band-seed-1203.json",
    "/docs/creative-prototypes/stationary-food-replication-stationary-band-seed-1203.json",
  ]);
});

test("seed picker loads only the selected seed and replaces the paired replay", async ({ page }) => {
  const first = makePair();
  const second = makePair(makeArm("moving-band", true, 3000, false, 1203), makeArm("stationary-band", true, 3000, false, 1203));
  const requests = await installViewer(page, { 1201: first, 1203: second });
  await expect(page.locator("#replay-title")).toHaveText("Seed 1,201 · paired world states");
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual([
    "/docs/creative-prototypes/stationary-food-replication-index-1201.json",
    "/docs/creative-prototypes/stationary-food-replication-moving-band-seed-1201.json",
    "/docs/creative-prototypes/stationary-food-replication-stationary-band-seed-1201.json",
  ]);
  await page.locator("#seed-picker").selectOption("1203");
  await expect(page.locator("#replay-title")).toHaveText("Seed 1,203 · paired world states");
  expect(requests.filter((path) => path.endsWith(".json")).slice(3)).toEqual([
    "/docs/creative-prototypes/stationary-food-replication-index-1203.json",
    "/docs/creative-prototypes/stationary-food-replication-moving-band-seed-1203.json",
    "/docs/creative-prototypes/stationary-food-replication-stationary-band-seed-1203.json",
  ]);
});

test("real seed 1201 and 1203 recordings replay from saved frames on desktop and phone", async ({ page }) => {
  const seed1201 = await actualPair(1201);
  const seed1203 = await actualPair(1203);
  const requests = await installViewer(page, { 1201: seed1201, 1203: seed1203 });
  await expect(page.locator("#decision-status")).toHaveText("Both varied");
  await expect(page.locator("#run-state")).toHaveText("Paused · paired recorded states");
  await expect(page.locator("#moving-frame-label")).toHaveText("Tick 0 · saved sample");
  await expect(page.locator("#stationary-frame-label")).toHaveText("Tick 0 · saved sample");

  for (const tick of [1500, 2500, 3000]) {
    await page.locator(`[data-jump-tick="${tick}"]`).click();
    await expect(page.locator("#moving-tick")).toHaveText(tick.toLocaleString("en-US"));
    await expect(page.locator("#stationary-tick")).toHaveText(tick.toLocaleString("en-US"));
    await expect(page.locator("#moving-frame-label")).toContainText("saved sample");
    await expect(page.locator("#stationary-frame-label")).toContainText("saved sample");
  }
  await page.locator('[data-jump-tick="2500"]').click();
  await page.getByRole("button", { name: "Play paired sampled replay" }).click();
  await expect(page.getByRole("button", { name: "Pause paired sampled replay" })).toBeVisible();
  await page.getByRole("button", { name: "Pause paired sampled replay" }).click();
  await expect(page.locator("#run-state")).toHaveText("Paused · recorded replay");

  await page.locator("#seed-picker").selectOption("1203");
  await expect(page.locator("#decision-status")).toHaveText("Both varied");
  await expect(page.locator("#replay-title")).toHaveText("Seed 1,203 · paired world states");
  await page.locator('[data-jump-tick="3000"]').click();
  await expect(page.locator("#moving-tick")).toHaveText("3,000");
  await expect(page.locator("#stationary-tick")).toHaveText("3,000");

  await page.setViewportSize({ width: 390, height: 844 });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual([
    "/docs/creative-prototypes/stationary-food-replication-index-1201.json",
    "/docs/creative-prototypes/stationary-food-replication-moving-band-seed-1201.json",
    "/docs/creative-prototypes/stationary-food-replication-stationary-band-seed-1201.json",
    "/docs/creative-prototypes/stationary-food-replication-visual-receipt-1201.json",
    "/docs/creative-prototypes/stationary-food-replication-index-1203.json",
    "/docs/creative-prototypes/stationary-food-replication-moving-band-seed-1203.json",
    "/docs/creative-prototypes/stationary-food-replication-stationary-band-seed-1203.json",
    "/docs/creative-prototypes/stationary-food-replication-visual-receipt-1203.json",
  ]);
});

test("decision status mismatch with recomputed gates fails closed", async ({ page }) => {
  const fixture = makePair(makeArm("moving-band", true), makeArm("stationary-band", false), "both", { moving: true, stationary: true });
  await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("expected moving-only");
  await expect(page.locator("#replay")).toBeHidden();
});

test("accepted fixture receipt passes with the historical-media disclosure", async ({ page }) => {
  const fixture = makePair(makeArm("moving-band"), makeArm("stationary-band"), "both", { moving: true, stationary: true });
  await installViewer(page, fixture);
  await expect(page.locator("#decision-status")).toHaveText("Both varied");
  await expect(page.locator("#replay")).toBeVisible();
});

test("rejects a SHA-matched receipt without the nonblind historical-media disclosure", async ({ page }) => {
  const fixture = makePair(makeArm("moving-band"), makeArm("stationary-band"), "both", { moving: true, stationary: true });
  const receipt = JSON.parse(fixture.receiptText!);
  for (const change of Object.values(receipt.withinArmChanges) as Record<string, any>[]) change.observation = "The body arrangement changed.";
  for (const comparison of receipt.sameAgeComparisons) comparison.observation = "Descriptive saved-frame comparison.";
  fixture.receiptText = JSON.stringify(receipt);
  fixture.index.decision.visualReceiptSha256 = sha(fixture.receiptText);
  await installViewer(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("not blind because historical moving media exist");
  await expect(page.locator("#replay")).toBeHidden();
});

test("a passing within-arm receipt requires exact saved frames at both endpoints", async ({ page }) => {
  const stationary = makeArm("stationary-band", false, 2701, true);
  const fixture = makePair(makeArm("moving-band"), stationary, "moving-only", { moving: true, stationary: true });
  await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("stationaryBand");
});

test("terminal extinction frame holds honestly and a false visual finding does not invalidate another passing arm", async ({ page }) => {
  const fixture = makePair(makeArm("moving-band"), makeArm("stationary-band", false, 1703, true), "moving-only", { moving: true, stationary: false });
  await installViewer(page, fixture);
  await page.locator("#scrub").evaluate((input: HTMLInputElement) => { input.value = input.max; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(page.locator("#stationary-frame-label")).toHaveText("Extinct · actual tick 1,703 · holding terminal frame");
  await expect(page.locator("#moving-frame-label")).toHaveText("Tick 3,000 · saved sample");
  await expect(page.locator("#extinction-note")).toContainText("actual tick 1,703");
});

test("rejects a raw artifact SHA mismatch before rendering either world", async ({ page }) => {
  const fixture = makePair(); fixture.stationaryText = fixture.stationaryText.replace('"births":0', '"births":1');
  await installViewer(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("stationary-band raw-file SHA-256 does not match");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects a changed band geometry even after artifact is resealed", async ({ page }) => {
  const stationary = makeArm("stationary-band"); stationary.samples[1].environment.bandLeft = 1;
  const fixture = makePair(makeArm("moving-band"), sealArm(stationary));
  await installViewer(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("stationary-band replenishment band geometry at tick 20");
});

test("rejects a changed frozen source identity after both digests are resealed", async ({ page }) => {
  const moving = makeArm("moving-band"); moving.provenance.sourceSha256["apps/lab/src/moving-food/model.ts"] = "9".repeat(64);
  const fixture = makePair(sealArm(moving));
  await installViewer(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("source identities do not match the frozen runner dependency set");
});

test("rejects zero-population evidence before its stated terminal tick", async ({ page }) => {
  const stationary = makeArm("stationary-band", false, 1703, true);
  stationary.samples[0].census = census(0, 0); stationary.frames[0].cells = []; stationary.frames[0].organisms = [];
  const fixture = makePair(makeArm("moving-band"), sealArm(stationary));
  await installViewer(page, fixture);
  await expect(page.locator("#error-detail")).toContainText("population reached zero before its declared actual terminal tick");
});

test("accepted decision without receipt, or receipt with the wrong arm SHA, is rejected", async ({ page }) => {
  const noReceipt = makePair(); noReceipt.index.decision.status = "both";
  await installViewer(page, noReceipt);
  await expect(page.locator("#error-detail")).toContainText("must list a SHA-bound visual receipt");

  const badReceipt = makePair(makeArm("moving-band"), makeArm("stationary-band"), "both", { moving: true, stationary: true });
  const receipt = JSON.parse(badReceipt.receiptText!); receipt.stationaryBandArtifactSha256 = "0".repeat(64);
  badReceipt.receiptText = JSON.stringify(receipt); badReceipt.index.decision.visualReceiptSha256 = sha(badReceipt.receiptText);
  await installViewer(page, badReceipt);
  await expect(page.locator("#error-detail")).toContainText("does not bind complete seed, plan, and arm observations");
});

test("fixture view has no axe violations or phone-width overflow", async ({ page }) => {
  await installViewer(page, makePair());
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `axe at ${viewport.width}px`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("keyboard steps saved frames and hidden-page playback pauses", async ({ page }) => {
  await installViewer(page, makePair()); await page.locator("body").focus();
  await page.keyboard.press("ArrowRight"); await expect(page.locator("#moving-tick")).toHaveText("20");
  await page.getByRole("button", { name: "Play paired sampled replay" }).click();
  await expect(page.getByRole("button", { name: "Pause paired sampled replay" })).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.locator("#run-state")).toHaveText("Paused while away");
  await expect(page.getByRole("button", { name: "Play paired sampled replay" })).toBeDisabled();
});

test("wrong seed and unbound overall fields are rejected before arm requests", async ({ page }) => {
  const wrong = makePair(); wrong.index.seed = 1203;
  const paths = await installViewer(page, wrong);
  await expect(page.locator("#error-detail")).toContainText("frozen seed 1201 stationary-food replication pair");
  expect(paths.some((path) => path.includes("stationary-food-replication-moving-band-seed"))).toBe(false);
  const unbound = makePair(); unbound.index.overall = { status: "both" };
  await installViewer(page, unbound);
  await expect(page.locator("#error-detail")).toContainText("unbound decision");
});
