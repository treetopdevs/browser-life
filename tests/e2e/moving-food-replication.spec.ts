import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ORIGIN = `http://localhost:${process.env.BL_E2E_PORT || "5421"}`;
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
  provenance: { sourceSha256: Record<string, string>; planSha256: string; baselineArtifactSha256: string; baselineDataSha256: string; prefix: Record<string, any> };
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

const baselineIdentities = {
  1202: { artifact: "a67a99bde41317f59c3b0fdf6521cc561c9a2b4db38d12783ea2f9be0d5f5602", data: "1fb5f81e128f7e6ecf60449349257df09ec2ce0fd1155d5d0c2784e3f59a8e2f" },
  1203: { artifact: "94fa6328fb74038793f859d629ef9535e5f610dd22eceeaa74d4677218b2b15d", data: "8c3ac66e4d3699e423a58597411c05b187dc56fdf9dab7b2550296da2fc95b33" },
};
const sourceHashes = {
  "apps/lab/src/development/model.ts": "49416b11ae8d0491cb9b2ae1f102f36779cd9fe0c72917a7ddf86fbbc63db072",
  "apps/lab/src/hungry-shapes/model.ts": "a33a3312caa6c91a46e2508f5b9267e3394089ff7320145a15157770068123bc",
  "apps/lab/src/uniform-endurance/model.ts": "b83de32cf42f58c13977dbbd3c74bf9d3068f90b40ec09600b9125ddb0a72009",
  "apps/lab/src/moving-food/model.ts": "b7aa0a3f1a0183d574e152e16b7f12c24fc0c9a201e7ddfae6d576915f10d8b0",
  "tools/hungry-shapes/explore.ts": "f49d2a63fc7b464bcd2115c683f3e40ec8381eb28aa8b318889552ea9bc23581",
  "tools/uniform-food/explore.ts": "312c2cffd7102e8c58fc1eabb72173d53692c8527f950b74ba33be4917b4a80c",
  "tools/uniform-endurance/explore.ts": "99099663fd619a644c29ff639bca1e6c884bc9d07161f3ba40fe3ec2f0fd7f77",
  "tools/moving-food/explore.ts": "b77c58eca007727beeca81b1a797978a8ddfbacaa4d3192a094164bf868df63a",
  "docs/creative-prototypes/hungry-shapes-seed-1201.json": "2cb6366595e43e2f5f215448bd13a67925e21f2ea11e4747790f6f61470b6520",
  "docs/creative-prototypes/hungry-shapes-seed-1201.md": "0f64a51d0ab22fe346160ed0ef94877a78998700372ce8ff1ffde3ef0f88a0f1",
  "docs/creative-prototypes/hungry-shapes-decision.json": "f935884132cd1f34edb5fec1af57eeaa033d87505448ea07acd05ed772c5d5b0",
  "docs/creative-prototypes/moving-food-replication-plan.md": "72f651acc7f221991b0ce89f7264eed9dd47df54e955d3d164406b4d0a17cc47",
  "docs/creative-prototypes/moving-food-index.json": "5f2ca66cb2d0bd39c0c017c4372381032746a0ba14076ecef71d8df079cccc57",
  "docs/creative-prototypes/moving-food-uniform-seed-1201.json": "1ae6bdc3c9f5bedd2b6f6cfb70aa9dc94e8acb8177f4c2ecda9c2859bf1e4458",
  "docs/creative-prototypes/moving-food-uniform-seed-1201.md": "af43523fa6108f6a136d5eb734db3908c6258c862c29bc69edb71f53123d6efe",
  "docs/creative-prototypes/moving-food-moving-band-seed-1201.json": "46017d1db1eaf1ff85b8cc51d92533d928aeac18b3e7cf261a82bb9d0d0816bf",
  "docs/creative-prototypes/moving-food-moving-band-seed-1201.md": "b2de64b26073439a52ca2ed7fa121d078e559d32205c8737e3252cf1aa7f6471",
  "docs/creative-prototypes/uniform-endurance-seed-1202.json": "a67a99bde41317f59c3b0fdf6521cc561c9a2b4db38d12783ea2f9be0d5f5602",
  "docs/creative-prototypes/uniform-endurance-seed-1202.md": "3de277dc0d3a11acd20501a1c6a55133dd46ed80b0609c643f8111f7806aacda",
  "docs/creative-prototypes/uniform-endurance-seed-1203.json": "94fa6328fb74038793f859d629ef9535e5f610dd22eceeaa74d4677218b2b15d",
  "docs/creative-prototypes/uniform-endurance-seed-1203.md": "0ee0dc77840fa97babf8b1569ce66245b2e978692138cd2dc46cfeed587c1bbd",
  "tools/moving-food-replication/explore.ts": "a8403864210d575baaa0acfae4a1a8ab684909bf0e8df541a1103394d2e11969"
};

function makeArm(mode: "uniform" | "moving-band", finalTick: number, extinct = false, seed = 1202, gatePassing = false): ArmFixture {
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
      births: gatePassing && from <= finalTick ? 1 : 0, deaths: gatePassing && from + 1 <= finalTick ? 1 : extinct && finalTick >= from && finalTick <= to ? 2 : 0, cap48Ticks: 0, nearCap47Ticks: 0,
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
    ? { status: "verified", seed, normalization: "none; maxHistory 451 is unchanged", comparedSamples: 151,
      comparedFrames: 151, comparedTickRows: 3000, comparedSnapshots: 1,
      checkpoints: [{ tick: 0, stateSha256: "f".repeat(64), compared: true }] }
    : { status: "not-applicable", seed: null, normalization: "none; moving-band is not the uniform control",
      comparedSamples: 0, comparedFrames: 0, comparedTickRows: 0, comparedSnapshots: 0, checkpoints: [] };
  const tickRows = Array.from({ length: finalTick }, (_, index) => {
    const tick = index + 1;
    const zero = extinct && tick === finalTick;
    const windowStart = [1501, 2001, 2501].find((from) => tick === from || tick === from + 1);
    const births = gatePassing && windowStart === tick ? 1 : 0;
    const deaths = gatePassing && windowStart === tick - 1 ? 1 : 0;
    return { tick, population: zero ? 0 : 2, births, deaths: zero ? 2 : deaths,
      blockedCap: 0, blockedSpace: 0, cap48: false, nearCap47: false };
  });
  const windowRanges = [[1501, 2000], [2001, 2500], [2501, 3000]] as const;
  const snapshots = [...new Set([0, 500, 1500, 2500, 3000, finalTick].filter((tick) => tick <= finalTick))].map((tick) => {
    const sample = samples.find((entry) => entry.tick === tick)!;
    return { tick, terminal: extinct && tick === finalTick, environment: sample.environment, state: { tick }, stateSha256: "f".repeat(64) };
  });
  const record: ArmFixture = {
    schemaVersion: 1, kind: "hungry-shapes-moving-food-arm",
    run: { seed, mode, mutation: true, maxTick: 3000, finalTick, extinctionTick: extinct ? finalTick : null },
    runtime: { node: "24.2.0", platform: "darwin", arch: "arm64" },
    rules: { width: 96, height: 96, tileCount: 9216, maxHistory: 451 },
    provenance: { sourceSha256: { ...sourceHashes }, planSha256: "72f651acc7f221991b0ce89f7264eed9dd47df54e955d3d164406b4d0a17cc47", baselineArtifactSha256: baselineIdentities[seed as 1202 | 1203].artifact, baselineDataSha256: baselineIdentities[seed as 1202 | 1203].data, prefix: proof },
    samples, frames, tickRows,
    windows: windowRanges.map(([from, to]) => expectedWindow(from, to)), snapshots,
    repeat: { verified: true, comparedThroughTick: finalTick, stateChecks: ticks.length, frameChecks: ticks.length },
    numericalGate: { aliveAt3000: !extinct && finalTick === 3000, eachNewWindowHasBirthsAndDeaths: gatePassing && !extinct, eachNewWindowCap48AtMost99: !extinct && finalTick === 3000,
      allWindowsReached: !extinct && finalTick === 3000, atLeastTwoFamiliesAt3000: !extinct && finalTick === 3000, numericalPass: gatePassing && !extinct && finalTick === 3000, note: "Fixture only." },
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

function indexFor(uniform = makeArm("uniform", 3000), movingBand = makeArm("moving-band", 1703, true), seed = 1202) {
  const uniformText = JSON.stringify(uniform);
  const movingText = JSON.stringify(movingBand);
  const uniformSha = hash(uniformText);
  const movingSha = hash(movingText);
  return { index: { schemaVersion: 1, kind: "hungry-shapes-moving-food-pair", seed, planSha256: "72f651acc7f221991b0ce89f7264eed9dd47df54e955d3d164406b4d0a17cc47",
    arms: { uniform: { mode: "uniform", url: `moving-food-replication-uniform-seed-${seed}.json`, rawSha256: uniformSha },
      movingBand: { mode: "moving-band", url: `moving-food-replication-moving-band-seed-${seed}.json`, rawSha256: movingSha } },
    decision: { status: "pending", uniformArtifactSha256: uniformSha, movingBandArtifactSha256: movingSha,
      summary: "Fixture only; this is not a pilot result." } }, uniformText, movingText, receiptText: undefined as string | undefined };
}

async function actualPair(seed: 1202 | 1203): Promise<ReturnType<typeof indexFor>> {
  const index = JSON.parse(await readFile(resolve(DOCS, `moving-food-replication-index-${seed}.json`), "utf8"));
  const uniformText = await readFile(resolve(DOCS, `moving-food-replication-uniform-seed-${seed}.json`), "utf8");
  const movingText = await readFile(resolve(DOCS, `moving-food-replication-moving-band-seed-${seed}.json`), "utf8");
  const receiptText = await readFile(resolve(DOCS, `moving-food-replication-visual-receipt-${seed}.json`), "utf8");
  return { index, uniformText, movingText, receiptText };
}

function bindReceipt(fixture: ReturnType<typeof indexFor>, seed = 1202, observations?: { passTicks: number[]; latePass: boolean }, status: "promising" | "stop" = "promising") {
  const receipt = {
    seed,
    uniformArtifactSha256: fixture.index.arms.uniform.rawSha256,
    movingBandArtifactSha256: fixture.index.arms.movingBand.rawSha256,
    visualComparisons: [1500, 2500, 3000].map((tick) => ({ tick, pass: observations?.passTicks.includes(tick) ?? false, observation: `Fixture observation at ${tick}.` })),
    lateWithinMoving: { from: 2500, to: 3000, pass: observations?.latePass ?? false, observation: "Fixture late comparison." },
    visualReviewedBeforeOverlapDiagnostics: true,
  };
  fixture.receiptText = JSON.stringify(receipt);
  fixture.index.decision.status = status;
  fixture.index.decision.summary = "Fixture only; no pilot conclusion.";
  const decision = fixture.index.decision as Record<string, unknown>;
  decision.visualReceiptUrl = `moving-food-replication-visual-receipt-${seed}.json`;
  decision.visualReceiptSha256 = hash(fixture.receiptText);
  return fixture;
}

async function installViewer(page: Page, pair: ReturnType<typeof indexFor> | null, seed = 1202, otherPair: ReturnType<typeof indexFor> | null = null) {
  const requests: string[] = [];
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    const name = url.pathname.split("/").at(-1) ?? "";
    if (url.pathname.endsWith("/moving-food-replication.html")) {
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: await readFile(resolve(DOCS, "moving-food-replication.html"), "utf8") });
      return;
    }
    if (name === "moving-food-replication-viewer.css") {
      await route.fulfill({ contentType: "text/css; charset=utf-8", body: await readFile(resolve(DOCS, name), "utf8") });
      return;
    }
    if (name === "moving-food-replication-viewer.js") {
      await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: await readFile(resolve(DOCS, name), "utf8") });
      return;
    }
    const seedMatch = name.match(/(?:index-|seed-|receipt-)(1202|1203)/);
    const requestSeed = seedMatch ? Number(seedMatch[1]) : null;
    const fixture = requestSeed === seed ? pair : requestSeed !== null && requestSeed !== seed ? otherPair : null;
    if (/^moving-food-replication-index-120[23]\.json$/.test(name)) {
      if (!fixture) await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      else await route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture.index) });
      return;
    }
    if (fixture?.receiptText && name === `moving-food-replication-visual-receipt-${requestSeed}.json`) {
      await route.fulfill({ contentType: "application/json", body: fixture.receiptText });
      return;
    }
    if (fixture && name === `moving-food-replication-uniform-seed-${requestSeed}.json`) {
      await route.fulfill({ contentType: "application/json", body: fixture.uniformText });
      return;
    }
    if (fixture && name === `moving-food-replication-moving-band-seed-${requestSeed}.json`) {
      await route.fulfill({ contentType: "application/json", body: fixture.movingText });
      return;
    }
    await route.fulfill({ status: 404, contentType: "text/plain", body: "fixture has no such file" });
  });
  await page.goto(`${BASE}moving-food-replication.html`);
  return requests;
}

test("empty companion requests no arm artifact", async ({ page }) => {
  const requests = await installViewer(page, null);
  await expect(page.getByRole("status")).toHaveText("No paired manifest is published for seed 1202 yet.");
  await expect(page.getByRole("heading", { name: "No pair is published for this seed yet." })).toBeVisible();
  expect(requests.some((path) => /moving-food-replication-(uniform|moving-band)-seed-1202\.json$/.test(path))).toBe(false);
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
    "/docs/creative-prototypes/moving-food-replication-index-1202.json",
    "/docs/creative-prototypes/moving-food-replication-uniform-seed-1202.json",
    "/docs/creative-prototypes/moving-food-replication-moving-band-seed-1202.json",
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
  const fixture = await actualPair(1202);
  await installViewer(page, fixture);
  await expect(page.locator("#decision-status")).toHaveText("Promising");
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`),
      `axe violations at ${viewport.width}px`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("selector requests only its chosen seed and verifies a seed 1203 pair", async ({ page }) => {
  const first = await actualPair(1202);
  const second = await actualPair(1203);
  const requests = await installViewer(page, first, 1202, second);
  await expect(page.locator("#replay")).toBeVisible();
  const seed1202Requests = requests.filter((path) => path.endsWith(".json"));
  expect(seed1202Requests).toEqual([
    "/docs/creative-prototypes/moving-food-replication-index-1202.json",
    "/docs/creative-prototypes/moving-food-replication-uniform-seed-1202.json",
    "/docs/creative-prototypes/moving-food-replication-moving-band-seed-1202.json",
    "/docs/creative-prototypes/moving-food-replication-visual-receipt-1202.json",
  ]);
  await page.locator("#seed-picker").selectOption("1203");
  await expect(page.locator("#replay-title")).toHaveText("Seed 1,203 · paired world states");
  await expect(page.locator("#decision-status")).toHaveText("Promising");
  await expect(page.locator("#run-state")).toHaveText("Paused · paired recorded states");
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual([
    "/docs/creative-prototypes/moving-food-replication-index-1202.json",
    "/docs/creative-prototypes/moving-food-replication-uniform-seed-1202.json",
    "/docs/creative-prototypes/moving-food-replication-moving-band-seed-1202.json",
    "/docs/creative-prototypes/moving-food-replication-visual-receipt-1202.json",
    "/docs/creative-prototypes/moving-food-replication-index-1203.json",
    "/docs/creative-prototypes/moving-food-replication-uniform-seed-1203.json",
    "/docs/creative-prototypes/moving-food-replication-moving-band-seed-1203.json",
    "/docs/creative-prototypes/moving-food-replication-visual-receipt-1203.json",
  ]);
  expect(requests.some((path) => /seed-1201|index-1201/.test(path))).toBe(false);
});

test("promising decision appears only after both raw arm hashes and its visual receipt verify", async ({ page }) => {
  const fixture = await actualPair(1202);
  await installViewer(page, fixture);
  await expect(page.locator("#decision-status")).toHaveText("Promising");
  await expect(page.locator("#decision-title")).toHaveText("Seed 1,202 replication screen");
  await expect(page.locator("#source-status")).toContainText("with SHA-matched visual receipt");
});

test("frozen visual gate accepts two of three comparisons and rejects only one", async ({ page }) => {
  const fixture = await actualPair(1202);
  const receipt = JSON.parse(fixture.receiptText!);
  receipt.visualComparisons[0].pass = false;
  fixture.receiptText = JSON.stringify(receipt);
  (fixture.index.decision as Record<string, unknown>).visualReceiptSha256 = hash(fixture.receiptText);
  await installViewer(page, fixture);
  await expect(page.locator("#decision-status")).toHaveText("Promising");
});

test("promising decision is rejected when fewer than two visual comparisons pass", async ({ page }) => {
  const fixture = await actualPair(1202);
  const receipt = JSON.parse(fixture.receiptText!);
  receipt.visualComparisons[0].pass = false;
  receipt.visualComparisons[1].pass = false;
  fixture.receiptText = JSON.stringify(receipt);
  (fixture.index.decision as Record<string, unknown>).visualReceiptSha256 = hash(fixture.receiptText);
  await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("conflicts with its saved numerical gate or visual receipt");
  await expect(page.locator("#replay")).toBeHidden();
});

test("accepted decision without a SHA-bound receipt fails closed", async ({ page }) => {
  const fixture = indexFor();
  fixture.index.decision.status = "promising";
  const requests = await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("must list a SHA-bound visual receipt");
  expect(requests.some((path) => path.endsWith("-uniform-seed-1202.json") || path.endsWith("-moving-band-seed-1202.json"))).toBe(false);
});

test("rejects a visual receipt whose raw SHA does not match", async ({ page }) => {
  const fixture = await actualPair(1202);
  (fixture.index.decision as Record<string, unknown>).visualReceiptSha256 = "0".repeat(64);
  await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("visual receipt raw-file SHA-256 does not match");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects a SHA-matched receipt that names a different seed or arm pair", async ({ page }) => {
  const wrongSeed = await actualPair(1202);
  const seedReceipt = JSON.parse(wrongSeed.receiptText!);
  seedReceipt.seed = 1203;
  wrongSeed.receiptText = JSON.stringify(seedReceipt);
  (wrongSeed.index.decision as Record<string, unknown>).visualReceiptSha256 = hash(wrongSeed.receiptText);
  await installViewer(page, wrongSeed);
  await expect(page.locator("#error-detail")).toContainText("does not bind complete selected-seed observations");

  const wrongPair = await actualPair(1202);
  const pairReceipt = JSON.parse(wrongPair.receiptText!);
  pairReceipt.uniformArtifactSha256 = "0".repeat(64);
  wrongPair.receiptText = JSON.stringify(pairReceipt);
  (wrongPair.index.decision as Record<string, unknown>).visualReceiptSha256 = hash(wrongPair.receiptText);
  await installViewer(page, wrongPair);
  await expect(page.locator("#error-detail")).toContainText("does not bind complete selected-seed observations");
});

test("rejects a manifest for another seed and a stale replication-plan pin before loading arms", async ({ page }) => {
  const wrongSeed = indexFor();
  wrongSeed.index.seed = 1203;
  const requests = await installViewer(page, wrongSeed);
  await expect(page.locator("#error-detail")).toContainText("frozen seed 1202 replication pair");
  expect(requests.some((path) => path.endsWith("-uniform-seed-1202.json") || path.endsWith("-moving-band-seed-1202.json"))).toBe(false);

  const stalePlan = indexFor();
  stalePlan.index.planSha256 = "0".repeat(64);
  await installViewer(page, stalePlan);
  await expect(page.locator("#error-detail")).toContainText("frozen seed 1202 replication pair");
});

test("rejects an arm with a stale replication-plan provenance pin", async ({ page }) => {
  const uniform = makeArm("uniform", 3000);
  uniform.provenance.planSha256 = "0".repeat(64);
  sealArm(uniform);
  await installViewer(page, indexFor(uniform));
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("not bound to the frozen replication plan SHA-256");
});


test("rejects resealed evidence with a changed frozen dependency source identity", async ({ page }) => {
  const moving = makeArm("moving-band", 1703, true);
  moving.provenance.sourceSha256["apps/lab/src/moving-food/model.ts"] = "9".repeat(64);
  sealArm(moving);
  const fixture = indexFor(undefined, moving);
  await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("source identities do not match the frozen runner dependency set");
});

test("rejects a resealed numericalPass claim that contradicts window evidence", async ({ page }) => {
  const moving = makeArm("moving-band", 3000, false, 1202, false);
  moving.numericalGate.numericalPass = true;
  sealArm(moving);
  await installViewer(page, indexFor(undefined, moving));
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("numerical gate does not match its saved endpoint and window evidence");
});


test("a visual comparison with no exact frame must be false even if its receipt says pass", async ({ page }) => {
  const fixture = bindReceipt(indexFor(makeArm("uniform", 3000), makeArm("moving-band", 1703, true)), 1202, { passTicks: [1500, 2500], latePass: true });
  await installViewer(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("tick 2,500 as a pass without exact saved frames in both arms");
});

test("missing third comparison and late moving frames are explicitly false in a stopped short run", async ({ page }) => {
  const fixture = bindReceipt(indexFor(makeArm("uniform", 3000), makeArm("moving-band", 1703, true)), 1202, { passTicks: [1500], latePass: false }, "stop");
  await installViewer(page, fixture);
  await expect(page.locator("#decision-status")).toHaveText("Stop");
  await expect(page.locator("#source-status")).toContainText("with SHA-matched visual receipt");
});
