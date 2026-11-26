import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ORIGIN = `http://localhost:${process.env.BL_E2E_PORT || "5414"}`;
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
  samples: any[];
  frames: any[];
  windows: any[];
  dataSha256?: string;
};

function replayFixture(extinct = true): EvidenceFixture {
  const endPopulation = extinct ? 0 : 2;
  const endCells: [number, number][] = extinct ? [] : [[97, 1], [98, 2]];
  const endOrganisms = extinct ? [] : [
    { id: 1, family: 0, genome: GENOME },
    { id: 2, family: 1, genome: { ...GENOME, turn: 1 } },
  ];
  const samples = [
    { tick: 0, census: census(0, 2, 3, [1, 1, 0]), environment: environment(0), censusSha256: "fixture", stateSha256: "fixture", frameSha256: "fixture" },
    { tick: 20, census: census(20, endPopulation, endCells.length, extinct ? [0, 0, 0] : [1, 1, 0], extinct ? 2 : 0), environment: environment(20), censusSha256: "fixture", stateSha256: "fixture", frameSha256: "fixture" },
  ];
  const frames = [
    { tick: 0, censusSha256: "fixture", stateSha256: "fixture", foodBase64: EMPTY_FOOD,
      cells: [[0, 1], [1, 1], [97, 2]], organisms: [
        { id: 1, family: 0, genome: GENOME },
        { id: 2, family: 1, genome: { ...GENOME, turn: 1 } },
      ], ledger: {}, frameSha256: "fixture" },
    { tick: 20, censusSha256: "fixture", stateSha256: "fixture", foodBase64: EMPTY_FOOD,
      cells: endCells, organisms: endOrganisms, ledger: {}, frameSha256: "fixture" },
  ];
  const windows = [
    { from: 2501, to: 3000 }, { from: 3501, to: 4000 }, { from: 4501, to: 5000 }, { from: 5501, to: 6000 },
  ].map(({ from, to }) => ({ from, to, denominatorTicks: 500, executedTicks: 0, zeroOccupancyTicks: 500,
    births: 0, deaths: 0, cap48Ticks: 0, nearCap47Ticks: 0, blockedCapAttempts: 0,
    blockedSpaceAttempts: 0, minPopulation: null, maxPopulation: null,
    endpoint: { requestedTick: to, actualTick: 20, population: endPopulation, cells: endCells.length,
      familyCounts: extinct ? [0, 0, 0] : [1, 1, 0], genomeCounts: [] },
    start: { requestedTick: from - 1, actualTick: 20, environment: environment(20) },
    endEnvironment: environment(20), postExtinctionSlots: 500, extinctionTick: extinct ? 20 : null }));
  return sealArtifact({ schemaVersion: 1, kind: "hungry-shapes-uniform-long-run",
    run: { seed: 1201, mode: "uniform", mutation: true, maxTick: 6000, finalTick: 20, extinctionTick: extinct ? 20 : null },
    samples, frames, windows });
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
    const frameBase = { tick: frame.tick, censusSha256: frame.censusSha256, stateSha256: frame.stateSha256,
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
    runs: [{ seed: 1201, url: "uniform-food-seed-1201.json", sha256: digest }],
    decisions: [{ seed: 1201, artifactSha256: digest, status: "pending", summary: "Fixture only; this is not a pilot result." }],
  };
}

async function installViewer(page: Page, manifest: object | null, artifact = replayFixture()) {
  const requests: string[] = [];
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    const name = url.pathname.split("/").at(-1);
    if (url.pathname.endsWith("/uniform-food.html")) {
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: await readFile(resolve(DOCS, "uniform-food.html"), "utf8") });
    } else if (name === "uniform-food-viewer.css") {
      await route.fulfill({ contentType: "text/css; charset=utf-8", body: await readFile(resolve(DOCS, name), "utf8") });
    } else if (name === "uniform-food-viewer.js") {
      await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: await readFile(resolve(DOCS, name), "utf8") });
    } else if (name === "uniform-food-index.json" && manifest === null) {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    } else if (name === "uniform-food-index.json") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(manifest) });
    } else if (name === "uniform-food-seed-1201.json") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(artifact) });
    } else {
      await route.fulfill({ status: 404, contentType: "text/plain", body: "fixture has no such file" });
    }
  });
  await page.goto(`${BASE}uniform-food.html`);
  return requests;
}

test("empty companion makes no seed or future-seed request before evidence is listed", async ({ page }) => {
  const requests = await installViewer(page, null);
  await expect(page.getByRole("status")).toHaveText("No replay manifest is published yet.");
  await expect(page.getByRole("heading", { name: "No accepted seed 1201 recording is published here." })).toBeVisible();
  expect(requests.some((path) => /uniform-food-seed-120[123]\.json$/.test(path))).toBe(false);
});

test("loads only the explicitly listed seed 1201 and begins paused at its first exact frame", async ({ page }) => {
  const fixture = replayFixture();
  const requests = await installViewer(page, manifestFor(fixture), fixture);
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#seed-decision-status")).toHaveText("Seed 1,201 decision · Pending");
  await expect(page.locator("#run-state")).toHaveText("Paused · extinct at actual tick 20");
  await expect(page.locator("#metric-tick")).toHaveText("0");
  await expect(page.getByRole("button", { name: "Play sampled replay" })).toBeEnabled();
  await expect(page.locator("#scrub")).toHaveValue("0");
  await page.getByRole("button", { name: "Next sample" }).click();
  await expect(page.locator("#metric-tick")).toHaveText("20");
  await expect(page.locator("#sample-label")).toHaveText("Extinct · actual tick 20");
  await expect(page.locator("#extinction-note")).toHaveText("The world became extinct at actual tick 20. The recording ends there.");
  await expect(page.getByRole("button", { name: "Next sample" })).toBeDisabled();
  expect(requests.filter((path) => path.endsWith(".json"))).toEqual([
    "/docs/creative-prototypes/uniform-food-index.json",
    "/docs/creative-prototypes/uniform-food-seed-1201.json",
  ]);
  expect(requests.some((path) => /uniform-food-seed-120[23]\.json$/.test(path))).toBe(false);
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

test("rejects a live record that ends before the fixed 6,000-tick horizon", async ({ page }) => {
  const earlyLive = replayFixture(false);
  await installViewer(page, manifestFor(earlyLive), earlyLive);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("full 6,000-tick horizon");
});

test("rejects a live recording that skips required 20-tick samples", async ({ page }) => {
  const sparseLive = replayFixture(false);
  sparseLive.run.finalTick = 6000;
  sparseLive.frames[1]!.tick = 6000;
  sparseLive.samples[1]!.tick = 6000;
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
  await expect(page.locator("#error-detail")).toContainText("decision is bound to a different evidence file");
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
