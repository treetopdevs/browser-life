import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ORIGIN = `http://localhost:${process.env.BL_E2E_PORT || "5415"}`;
const BASE = `${ORIGIN}/docs/creative-prototypes/`;
const DOCS = resolve("docs/creative-prototypes");
const EMPTY_FOOD = Buffer.alloc(96 * 96, 20).toString("base64");
const GENOME = { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 };

function census(tick: number, population: number, cells: number, familyCounts: number[], deaths = 0) {
  return {
    tick, population, cells, familyCounts, births: 0, growths: 0, deaths,
    effectiveMutations: 0, attemptedMutations: 0, maxGeneration: 0, totalCells: cells,
    totalEnergy: population * 20, meanBodyCells: population ? cells / population : 0,
    meanEnergy: population ? 20 : 0, blockedBirths: 0, blockedSpaceBirths: 0,
    blockedCapBirths: 0, ledgerResidual: 0, genomeVariantCount: population ? 1 : 0,
  };
}

function environment(tick: number) {
  const pulses = Math.floor(tick / 5);
  const offered = pulses * 768;
  return { version: 1, mode: "uniform", pulseBudget: 768, targetCount: 9216, pulses,
    offered, accepted: offered, overflow: 0, initialFoodPerTile: 20 };
}

type EvidenceFixture = {
  schemaVersion: number;
  kind: string;
  run: { seed: number; mode: string; mutation: boolean; maxTick: number; finalTick: number; extinctionTick: number | null };
  runtime?: { node: string; platform: string; arch: string };
  rules?: { width: number; height: number; tileCount: number; maxHistory: number };
  samples: any[];
  tickRows?: any[];
  frames: any[];
  windows: any[];
  provenance?: { prefix: any };
  dataSha256?: string;
};

function replayFixture(options: { finalTick?: number; extinct?: boolean } = {}): EvidenceFixture {
  const finalTick = options.finalTick ?? 9000;
  const extinct = options.extinct ?? false;
  const ticks = Array.from({ length: Math.floor(Math.min(finalTick, 9000) / 20) + 1 }, (_, i) => i * 20);
  if (ticks.at(-1) !== finalTick) ticks.push(finalTick);
  const organisms = [
    { id: 1, family: 0, genome: GENOME },
    { id: 2, family: 1, genome: { ...GENOME, turn: 1 } },
  ];
  const cells: [number, number][] = [[0, 1], [1, 1], [97, 2]];
  const samples = ticks.map((tick) => {
    const isTerminal = tick === finalTick;
    const isExtinct = extinct && isTerminal;
    return { tick, census: census(tick, isExtinct ? 0 : 2, isExtinct ? 0 : 3,
      isExtinct ? [0, 0, 0] : [1, 1, 0], isExtinct ? 2 : 0),
      environment: environment(tick), censusSha256: "fixture", stateSha256: "fixture",
      normalizedStateSha256: tick <= 6000 ? "c".repeat(64) : null, frameSha256: "fixture" };
  });
  const frames = ticks.map((tick) => {
    const isExtinct = extinct && tick === finalTick;
    const env = environment(tick);
    return { tick, censusSha256: "fixture", stateSha256: "fixture",
      normalizedStateSha256: tick <= 6000 ? "c".repeat(64) : null,
      normalizedFrameSha256: tick <= 6000 ? "fixture" : null,
      foodBase64: EMPTY_FOOD, cells: isExtinct ? [] : cells, organisms: isExtinct ? [] : organisms,
      ledger: { initialEnergy: 100, supplied: env.accepted, dissipated: 0, deathLoss: 0,
        expected: 100 + env.accepted, actual: 100 + env.accepted, residual: 0 }, frameSha256: "fixture" };
  });
  const windows = [
    { from: 5501, to: 6000 }, { from: 6501, to: 7000 }, { from: 7501, to: 8000 }, { from: 8501, to: 9000 },
  ].map(({ from, to }) => {
    const executedTicks = Math.max(0, Math.min(to, finalTick) - from + 1);
    const actualTick = Math.min(to, finalTick);
    const endpointExtinct = extinct && actualTick === finalTick;
    return { from, to, denominatorTicks: 500, executedTicks, zeroOccupancyTicks: 500 - executedTicks,
      births: 0, deaths: 0, cap48Ticks: 0, nearCap47Ticks: 0, blockedCapAttempts: 0,
      blockedSpaceAttempts: 0, minPopulation: executedTicks ? (endpointExtinct ? 0 : 2) : null, maxPopulation: executedTicks ? 2 : null,
      endpoint: { requestedTick: to, actualTick, population: endpointExtinct ? 0 : 2, cells: endpointExtinct ? 0 : 3,
        familyCounts: endpointExtinct ? [0, 0, 0] : [1, 1, 0], genomeCounts: endpointExtinct ? [] : [{ genome: GENOME, count: 1 }, { genome: { ...GENOME, turn: 1 }, count: 1 }] },
      start: { requestedTick: from - 1, actualTick: Math.min(from - 1, finalTick), environment: environment(Math.min(from - 1, finalTick)) },
      endEnvironment: environment(actualTick), postExtinctionSlots: 500 - executedTicks, extinctionTick: extinct ? finalTick : null };
  });
  const prefixTicks = [0, 3000, 4000, 5000, 6000];
  const provenance = { sourceSha256: { "apps/lab/src/uniform-endurance/model.ts": "f".repeat(64),
    "tools/uniform-endurance/explore.ts": "e".repeat(64) },
    priorArtifactSha256: "d".repeat(64), priorDataSha256: "a".repeat(64),
    prefix: { status: "verified", seed: 1203,
    normalization: "Normalize copied state.rules.maxHistory from 451 to 301; hash SHA256(JSON.stringify({state,environment})).",
    comparedSamples: 301, comparedFrames: 301, comparedTickRows: 6000, comparedSnapshots: 5,
    checkpoints: prefixTicks.map((tick) => ({ tick, normalizedStateSha256: samples.find((sample) => sample.tick === tick)!.normalizedStateSha256, compared: true })) } };
  const tickRows = Array.from({ length: finalTick }, (_, i) => {
    const tick = i + 1;
    const isTerminalExtinction = extinct && tick === finalTick;
    return { tick, population: isTerminalExtinction ? 0 : 2, cells: isTerminalExtinction ? 0 : 3,
      births: 0, deaths: isTerminalExtinction ? 2 : 0, blockedCap: 0, blockedSpace: 0,
      cap48: false, nearCap47: false };
  });
  return sealArtifact({ schemaVersion: 1, kind: "hungry-shapes-uniform-endurance",
    run: { seed: 1203, mode: "uniform", mutation: true, maxTick: 9000, finalTick, extinctionTick: extinct ? finalTick : null },
    runtime: { node: "24.2.0", platform: "darwin", arch: "arm64" },
    rules: { width: 96, height: 96, tileCount: 9216, maxHistory: 451 },
    provenance, samples, tickRows, frames, windows });
}

function sha256(text: string) { return createHash("sha256").update(text).digest("hex"); }

function sealArtifact(data: EvidenceFixture): EvidenceFixture {
  for (let i = 0; i < data.frames.length; i++) {
    const frame = data.frames[i];
    const sample = data.samples[i];
    sample.censusSha256 = sha256(JSON.stringify(sample.census));
    sample.stateSha256 = "b".repeat(64);
    frame.censusSha256 = sample.censusSha256;
    frame.stateSha256 = sample.stateSha256;
    sample.normalizedStateSha256 = frame.tick <= 6000 ? "c".repeat(64) : null;
    frame.normalizedStateSha256 = sample.normalizedStateSha256;
    if (frame.tick <= 6000) {
      const normalizedFrame = { tick: frame.tick, censusSha256: frame.censusSha256,
        stateSha256: frame.normalizedStateSha256, foodBase64: frame.foodBase64, cells: frame.cells,
        organisms: frame.organisms, ledger: frame.ledger };
      frame.normalizedFrameSha256 = sha256(JSON.stringify(normalizedFrame));
    } else frame.normalizedFrameSha256 = null;
    const frameBase = { tick: frame.tick, censusSha256: frame.censusSha256, stateSha256: frame.stateSha256,
      normalizedStateSha256: frame.normalizedStateSha256, normalizedFrameSha256: frame.normalizedFrameSha256,
      foodBase64: frame.foodBase64, cells: frame.cells, organisms: frame.organisms, ledger: frame.ledger };
    frame.frameSha256 = sha256(JSON.stringify(frameBase));
    sample.frameSha256 = frame.frameSha256;
  }
  delete data.dataSha256;
  data.dataSha256 = sha256(JSON.stringify(data));
  return data;
}

function manifestFor(artifact = replayFixture()) {
  const digest = sha256(JSON.stringify(artifact));
  return {
    runs: [{ seed: 1203, url: "uniform-endurance-seed-1203.json", sha256: digest }],
    decisions: [{ seed: 1203, artifactSha256: digest, status: "pending", title: "Fixture only", summary: "This is not a pilot result." }],
  };
}

async function installViewer(page: Page, manifest: object | null, artifact = replayFixture()) {
  const requests: string[] = [];
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    const name = url.pathname.split("/").at(-1);
    if (url.pathname.endsWith("/uniform-endurance.html")) {
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: await readFile(resolve(DOCS, "uniform-endurance.html"), "utf8") });
    } else if (name === "uniform-endurance-viewer.css") {
      await route.fulfill({ contentType: "text/css; charset=utf-8", body: await readFile(resolve(DOCS, name), "utf8") });
    } else if (name === "uniform-endurance-viewer.js") {
      await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: await readFile(resolve(DOCS, name), "utf8") });
    } else if (name === "uniform-endurance-index.json" && manifest === null) {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    } else if (name === "uniform-endurance-index.json") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(manifest) });
    } else if (name === "uniform-endurance-seed-1203.json") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(artifact) });
    } else {
      await route.fulfill({ status: 404, contentType: "text/plain", body: "fixture has no such file" });
    }
  });
  await page.goto(`${BASE}uniform-endurance.html`);
  return requests;
}

test("empty companion makes no seed or future-seed request before evidence is listed", async ({ page }) => {
  const requests = await installViewer(page, null);
  await expect(page.getByRole("status")).toHaveText("No replay manifest is published yet.");
  await expect(page.getByRole("heading", { name: "No accepted seed 1203 recording is published here." })).toBeVisible();
  expect(requests.some((path) => /uniform-endurance-seed-120[123]\.json$/.test(path))).toBe(false);
});

test("loads only the explicitly listed seed 1203 and labels an off-cadence terminal frame honestly", async ({ page }) => {
  const fixture = replayFixture({ finalTick: 6023, extinct: true });
  const requests = await installViewer(page, manifestFor(fixture), fixture);
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#seed-decision-status")).toHaveText("Seed 1,203 decision · Pending");
  await expect(page.locator("#seed-decision-summary")).toHaveText("Fixture only — This is not a pilot result.");
  await expect(page.locator("#run-state")).toHaveText("Paused · extinct at actual tick 6,023");
  await expect(page.locator("#metric-tick")).toHaveText("0");
  await expect(page.getByRole("button", { name: "Play sampled replay" })).toBeEnabled();
  await expect(page.locator("#scrub")).toHaveValue("0");
  await page.getByRole("button", { name: "Next sample" }).click();
  await expect(page.locator("#metric-tick")).toHaveText("20");
  await page.locator("#scrub").evaluate((element: HTMLInputElement) => {
    element.value = element.max;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#metric-tick")).toHaveText("6,023");
  await expect(page.locator("#sample-label")).toHaveText("Extinct · actual tick 6,023");
  await expect(page.locator("#extinction-note")).toHaveText("The world became extinct at actual tick 6,023. The recording ends there.");
  await expect(page.getByRole("button", { name: "Next sample" })).toBeDisabled();
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual([
    "/docs/creative-prototypes/uniform-endurance-index.json",
    "/docs/creative-prototypes/uniform-endurance-seed-1203.json",
  ]);
  expect(requests.some((path) => /uniform-endurance-seed-120[12]\.json$/.test(path))).toBe(false);
});

test("rejects an unbound overall pass in the manifest", async ({ page }) => {
  const fixture = replayFixture();
  const manifest = manifestFor(fixture);
  (manifest as Record<string, unknown>).overallDecision = { status: "pass", summary: "Unbound fixture decision." };
  await installViewer(page, manifest, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("overall decision is authored in this page");
  await expect(page.locator("#replay")).toBeHidden();
});

test("keyboard controls move one recorded frame and playback pauses when the page is hidden", async ({ page }) => {
  await installViewer(page, manifestFor());
  await page.locator("body").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#metric-tick")).toHaveText("20");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#metric-tick")).toHaveText("0");
  await page.getByRole("button", { name: "Play sampled replay" }).click();
  await expect(page.getByRole("button", { name: "Pause sampled replay" })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#run-state")).toHaveText("Paused while away");
  await expect(page.getByRole("button", { name: "Play sampled replay" })).toBeDisabled();
  await expect(page.locator("#metric-tick")).toHaveText("0");
});

test("viewer has no WCAG A/AA axe violations on desktop or phone", async ({ page }) => {
  await installViewer(page, manifestFor());
  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`),
      `axe violations at ${viewport.width}px`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("malformed evidence is reported without drawing a plausible-looking frame", async ({ page }) => {
  const invalid = replayFixture();
  invalid.frames[0]!.foodBase64 = "%%%";
  sealArtifact(invalid);
  await installViewer(page, manifestFor(invalid), invalid);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#replay")).toBeHidden();
  await expect(page.locator("#error-detail")).toContainText("food is not valid base64");
});

test("rejects a live record that ends before the fixed 9,000-tick horizon", async ({ page }) => {
  const earlyLive = replayFixture({ finalTick: 6000 });
  await installViewer(page, manifestFor(earlyLive), earlyLive);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("full 9,000-tick horizon");
});

test("rejects a live recording that skips required 20-tick samples", async ({ page }) => {
  const sparseLive = replayFixture();
  sparseLive.frames.splice(301, 1);
  sparseLive.samples.splice(301, 1);
  sealArtifact(sparseLive);
  await installViewer(page, manifestFor(sparseLive), sparseLive);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("missing a 20-tick sample");
});

test("rejects an early zero-population frame before the declared extinction tick", async ({ page }) => {
  const prematureZero = replayFixture();
  const initial = prematureZero.samples[0]!.census;
  initial.population = 0;
  initial.cells = 0;
  initial.familyCounts = [0, 0, 0];
  initial.totalCells = 0;
  initial.totalEnergy = 0;
  initial.meanBodyCells = 0;
  initial.meanEnergy = 0;
  initial.genomeVariantCount = 0;
  prematureZero.frames[0]!.cells = [];
  prematureZero.frames[0]!.organisms = [];
  sealArtifact(prematureZero);
  await installViewer(page, manifestFor(prematureZero), prematureZero);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("Population first reached zero before");
});

test("rejects family counts that do not match the bodies drawn in a frame", async ({ page }) => {
  const wrongFamilies = replayFixture();
  wrongFamilies.samples[0]!.census.familyCounts = [2, 0, 0];
  sealArtifact(wrongFamilies);
  await installViewer(page, manifestFor(wrongFamilies), wrongFamilies);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("does not agree with its recorded census");
});

test("rejects a raw-file SHA mismatch before exposing its decision or replay", async ({ page }) => {
  const listed = replayFixture();
  const served = replayFixture();
  served.samples[0]!.census.population = 3;
  sealArtifact(served);
  await installViewer(page, manifestFor(listed), served);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("raw-file SHA-256 does not match");
  await expect(page.locator("#replay")).toBeHidden();
  await expect(page.locator("#seed-decision")).toBeHidden();
});

test("rejects a seed decision bound to a different artifact SHA", async ({ page }) => {
  const valid = replayFixture();
  const manifest = manifestFor(valid);
  manifest.decisions[0]!.artifactSha256 = "0".repeat(64);
  await installViewer(page, manifest, valid);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("decision is not bound to a listed source SHA");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects a changed frame whose frame SHA no longer matches", async ({ page }) => {
  const changedFrame = replayFixture();
  changedFrame.frames[0]!.cells[0]![0] = 2;
  const copy = { ...changedFrame };
  delete copy.dataSha256;
  changedFrame.dataSha256 = sha256(JSON.stringify(copy));
  await installViewer(page, manifestFor(changedFrame), changedFrame);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("Frame 0 SHA-256 does not match");
});
