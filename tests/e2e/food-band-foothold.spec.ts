import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ORIGIN = `http://localhost:${process.env.BL_E2E_PORT || "5174"}`;
const BASE = `${ORIGIN}/docs/creative-prototypes/`;
const DOCS = resolve("docs/creative-prototypes");
const PLAN = "88040ed2b87042ee5907f8db85dfccfbe8794feabe2865df31e3bcac3bfbab27";
const BASELINE_NAME = "alternating-food-replication-seed-1202.json";
const BASELINE_INDEX = "alternating-food-replication-index-1202.json";
const INDEX = "food-band-foothold-index-1202.json";
const ALTERNATING = "food-band-foothold-seed-1202.json";
type Rec = Record<string, any>;
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
// The replays are kept out of git (docs/creative-prototypes/ARTIFACTS.md); restore them to run these checks.
const hasReplays = [BASELINE_NAME, "alternating-food-seed-1203.json"].every((name) => existsSync(resolve(DOCS, name)));
const replaysMissing = "food-band replays are not restored (docs/creative-prototypes/ARTIFACTS.md)";
const baselineBytes = hasReplays ? readFileSync(resolve(DOCS, BASELINE_NAME)) : Buffer.alloc(0);
const baseline = (hasReplays ? JSON.parse(baselineBytes.toString("utf8")) : {}) as Rec;
const baselineIndexBytes = readFileSync(resolve(DOCS, BASELINE_INDEX));
// This prior saved arm is used only as a structural source for browser fixtures; it is never published or treated as seed-1202 evidence.
const syntheticArmSource = (hasReplays ? JSON.parse(readFileSync(resolve(DOCS, "alternating-food-seed-1203.json"), "utf8")) : {}) as Rec;
const hashJSON = (value: unknown) => sha(JSON.stringify(value));

function syntheticSnapshot(data: Rec, tick: number): Rec {
  const frame = data.frames.find((item: Rec) => item.tick === tick) as Rec;
  const sample = data.samples.find((item: Rec) => item.tick === tick) as Rec;
  const food = [...Buffer.from(frame.foodBase64, "base64")];
  const occupancy = new Array(96 * 96).fill(0);
  const byId = new Map<number, Rec>();
  const lineage = data.final.lineage.filter((node: Rec) => node.birthTick <= tick).map((node: Rec) => {
    const dead = node.deathTick !== null && node.deathTick <= tick;
    return { ...node, deathTick: dead ? node.deathTick : null, deathCause: dead ? node.deathCause : null, parentRecordDropped: false };
  }).sort((a: Rec, b: Rec) => a.id - b.id);
  const lineageById = new Map<number, Rec>(lineage.map((node: Rec) => [node.id, node]));
  for (const item of frame.organisms) {
    const node = lineageById.get(item.id);
    if (!node) throw new Error(`Synthetic snapshot ${tick} is missing living lineage ${item.id}.`);
    byId.set(item.id, { id: item.id, parentID: node.parentID, family: item.family, generation: node.generation,
      age: 0, store: 0, genome: item.genome, births: 0, cells: [], growthQueue: [], growthCursor: 0 });
  }
  for (const [tile, id] of frame.cells) {
    occupancy[tile] = id;
    byId.get(id)!.cells.push({ tile, heading: 0, depth: 0 });
  }
  const storeBudget = sample.census.totalEnergy - data.rules.structurePerCell * sample.census.cells;
  let remaining = storeBudget;
  const organisms = [...byId.values()];
  for (const org of organisms) { org.store = Math.min(data.rules.storeCap, remaining); remaining -= org.store; }
  if (remaining !== 0) throw new Error(`Synthetic snapshot ${tick} cannot represent its recorded energy.`);
  const counters = { births: sample.census.births, growths: sample.census.growths, deaths: sample.census.deaths,
    effectiveMutations: sample.census.effectiveMutations, attemptedMutations: sample.census.attemptedMutations,
    blockedSpaceBirths: sample.census.blockedSpaceBirths, blockedCapBirths: sample.census.blockedCapBirths };
  return { schemaVersion: 1, description: "observation only; not a resume checkpoint", runtime: `Node ${data.runtime.node}`,
    rules: data.rules, seed: 1202, mutation: true, tick, extinctionTick: null, food, occupancy, organisms,
    ledger: frame.ledger, counters, history: data.samples.filter((item: Rec) => item.tick <= tick).map((item: Rec) => item.census),
    droppedHistory: 0, lineage, droppedLineage: 0 };
}

function refreshSnapshotDigest(data: Rec, tick: number) {
  const snapshot = data.snapshots.find((item: Rec) => item.tick === tick) as Rec;
  const sample = data.samples.find((item: Rec) => item.tick === tick) as Rec;
  const frame = data.frames.find((item: Rec) => item.tick === tick) as Rec;
  const stateSha256 = hashJSON({ state: snapshot.state, environment: snapshot.environment });
  snapshot.stateSha256 = sample.stateSha256 = frame.stateSha256 = stateSha256;
  const envelope = { ...frame }; delete envelope.frameSha256;
  frame.frameSha256 = sample.frameSha256 = hashJSON(envelope);
  if (tick === data.run.finalTick) data.final.stateSha256 = stateSha256;
}

function alternatingEnvironment(old: Rec, tick: number, before?: Rec): Rec {
  const pulses = Math.floor(tick / 5), scheduled = [0, 0];
  for (let p = 0; p < pulses; p++) scheduled[Math.floor(p / 100) % 2]++;
  const bandOffered = scheduled.map((count) => count * 576 + pulses * 96);
  const acceptedDelta = old.accepted - (before?.accepted ?? 0);
  const firstDelta = Math.min(acceptedDelta, bandOffered[0] - (before?.bandOffered[0] ?? 0));
  const bandAccepted = [(before?.bandAccepted[0] ?? 0) + firstDelta, (before?.bandAccepted[1] ?? 0) + acceptedDelta - firstDelta];
  const bandOverflow = bandOffered.map((n, i) => n - bandAccepted[i]);
  return { version: 1, mode: "foothold-band", pulseBudget: 768, targetCount: 4608, pulses, offered: old.offered,
    accepted: old.accepted, overflow: old.overflow, initialFoodPerTile: 20, bandColumns: [[0, 23], [48, 71]], bandWidth: 24,
    activeBand: pulses === 0 ? 0 : Math.floor((pulses - 1) / 100) % 2, bandOffered, bandAccepted, bandOverflow, floorPerBand: 96, alternatingBudget: 576 };
}

function buildAlternating(mutate?: (data: Rec) => void): { data: Rec; text: string; rawSha: string } {
  const data = structuredClone(syntheticArmSource) as Rec;
  data.kind = "hungry-shapes-food-band-foothold-arm";
  data.run.seed = 1202;
  data.run.mode = "foothold-band";
  const sourcePins = {
    "docs/creative-prototypes/food-band-foothold-plan.md": PLAN,
    "apps/lab/src/food-band-foothold/model.ts": "d3e0b36594b43a40d77befbe846d4365b25655d7d670c50d74f6fadefa988403",
    "apps/lab/src/alternating-food/model.ts": "5dc6ce46ee36d2d008f802e81e0f7aae80d7bfeaa58984512d13cad714729b31",
    "tools/alternating-food-replication/explore.ts": "f616b0b1fa6ab1194e224ad7040f972c7b55ad65b6a5a2425e16b81a2ce7c162",
    "docs/creative-prototypes/alternating-food-replication-seed-1202.json": sha(baselineBytes),
    "docs/creative-prototypes/alternating-food-replication-index-1202.json": sha(baselineIndexBytes),
    "docs/creative-prototypes/alternating-food-replication-validation.md": "dcffcae8fda5c852b9fb3c6db5bb61d758f7b6e9b895d33a634e67ca7ccb06b2",
    "tools/food-band-foothold/launch.sh": "24036351704f71fd3d16a372f294b19701e036e4a174acfa4052c62aa6c87490",
    "tools/food-band-foothold/explore.ts": "66b7dcf4e9844abcd6fc448557a55a950967ef4c6c0c93cb59d90c35c514fa3d",
  };
  const checkpoints = baseline.snapshots.map((snapshot: Rec) => ({ tick: snapshot.tick, stateSha256: snapshot.stateSha256, compared: true }));
  data.provenance = { sourceSha256: sourcePins, planSha256: PLAN, baselineArtifactSha256: sha(baselineBytes), baselineDataSha256: baseline.dataSha256,
    baselineIndexSha256: sha(baselineIndexBytes), baselineRegression: { status: "verified", seed: 1202, comparedSamples: 151, comparedFrames: 151,
      comparedTickRows: 3000, comparedSnapshots: 7, checkpoints } };
  let previousEnvironment: Rec | undefined;
  for (const sample of data.samples) { sample.environment = alternatingEnvironment(sample.environment, sample.tick, previousEnvironment); previousEnvironment = sample.environment; }
  const fixedTicks = [0, 500, 1000, 1500, 2000, 2500, 3000];
  const oldSnapshots = new Map<number, Rec>(data.snapshots.map((item: Rec) => [item.tick, item]));
  const snapshots: Rec[] = [];
  for (const tick of fixedTicks) {
    const frame = data.frames.find((item: Rec) => item.tick === tick) as Rec;
    const sample = data.samples.find((item: Rec) => item.tick === tick) as Rec;
    const old = oldSnapshots.get(tick) as Rec | undefined;
    const state = structuredClone(old?.state ?? syntheticSnapshot(data, tick));
    state.seed = 1202;
    const stateSha256 = hashJSON({ state, environment: sample.environment });
    sample.stateSha256 = stateSha256;
    frame.stateSha256 = stateSha256;
    const envelope = { ...frame }; delete envelope.frameSha256;
    frame.frameSha256 = hashJSON(envelope); sample.frameSha256 = frame.frameSha256;
    snapshots.push({ tick, terminal: false, environment: sample.environment, state, stateSha256 });
  }
  data.snapshots = snapshots;
  data.final.environment = data.samples.at(-1)!.environment;
  data.final.stateSha256 = snapshots.at(-1)!.stateSha256;
  const seasonalBlocks = [{ from: 1500, to: 2000, fedBand: 1 }, { from: 2000, to: 2500, fedBand: 0 }, { from: 2500, to: 3000, fedBand: 1 }].map((spec) => {
    const counts = (tick: number) => {
      const frame = data.frames.find((item: Rec) => item.tick === tick)!;
      const result = [0, 0];
      for (const [tile] of frame.cells) { const column = tile % 96; if (column <= 23) result[0]++; else if (column >= 48 && column <= 71) result[1]++; }
      return result;
    };
    const fromOccupiedTilesByBand = counts(spec.from), toOccupiedTilesByBand = counts(spec.to);
    const deltasByBand = [toOccupiedTilesByBand[0] - fromOccupiedTilesByBand[0], toOccupiedTilesByBand[1] - fromOccupiedTilesByBand[1]];
    return { ...spec, fromOccupiedTilesByBand, toOccupiedTilesByBand, deltasByBand,
      pass: deltasByBand[spec.fedBand] >= 20 && deltasByBand[1 - spec.fedBand] <= -20 };
  });
  const baselineSeasonalReference = [{ from: 1500, to: 2000, fedBand: 1 }, { from: 2000, to: 2500, fedBand: 0 }, { from: 2500, to: 3000, fedBand: 1 }].map((spec) => {
    const counts = (tick: number) => {
      const frame = baseline.frames.find((item: Rec) => item.tick === tick)!;
      const result = [0, 0];
      for (const [tile] of frame.cells) { const column = tile % 96; if (column <= 23) result[0]++; else if (column >= 48 && column <= 71) result[1]++; }
      return result;
    };
    const fromOccupiedTilesByBand = counts(spec.from), toOccupiedTilesByBand = counts(spec.to);
    const deltasByBand = [toOccupiedTilesByBand[0] - fromOccupiedTilesByBand[0], toOccupiedTilesByBand[1] - fromOccupiedTilesByBand[1]];
    return { ...spec, fromOccupiedTilesByBand, toOccupiedTilesByBand, deltasByBand,
      pass: deltasByBand[spec.fedBand] >= 20 && deltasByBand[1 - spec.fedBand] <= -20 };
  });
  const pass = (blocks: Rec[]) => blocks.some((block) => block.pass);
  data.seasonalGate = { blocks: seasonalBlocks, pass: pass(seasonalBlocks) };
  delete data.staticBaselineSeasonalReference;
  data.baselineSeasonalReference = { blocks: baselineSeasonalReference, pass: false };
  if (mutate) mutate(data);
  delete data.dataSha256;
  data.dataSha256 = hashJSON(data);
  const text = `${JSON.stringify(data)}\n`;
  return { data, text, rawSha: sha(text) };
}

function pairFixture(alt = buildAlternating(), receipt?: Rec) {
  const index: Rec = { schemaVersion: 1, kind: "hungry-shapes-food-band-foothold-pair", seed: 1202, planSha256: PLAN,
    arms: {
      baseline: { kind: baseline.kind, mode: "alternating-band", url: BASELINE_NAME, rawSha256: sha(baselineBytes), dataSha256: baseline.dataSha256 },
      alternating: { kind: alt.data.kind, mode: "foothold-band", url: ALTERNATING, rawSha256: alt.rawSha, dataSha256: alt.data.dataSha256 },
    },
    decision: { status: "pending", summary: "Pending parent visual review; no decision has been recorded.", baselineArtifactSha256: sha(baselineBytes),
      alternatingArtifactSha256: alt.rawSha, visualReceiptUrl: null, visualReceiptSha256: null } };
  let receiptText: string | undefined;
  if (receipt) {
    receiptText = `${JSON.stringify(receipt)}\n`;
    const manualSeasonal = receipt.seasonalChanges.some((x: Rec) => x.pass && alt.data.seasonalGate.blocks.find((b: Rec) => b.from === x.from && b.to === x.to)?.pass);
    const status = alt.data.numericalGate.numericalPass && alt.data.spatialGate.pass && alt.data.seasonalGate.pass && receipt.alternatingChange.pass && manualSeasonal ? "promising" : "stop";
    index.decision = { status, summary: "Synthetic browser-test fixture only.", baselineArtifactSha256: sha(baselineBytes), alternatingArtifactSha256: alt.rawSha,
      visualReceiptUrl: "food-band-foothold-visual-receipt-1202.json", visualReceiptSha256: sha(receiptText) };
  }
  return { alt, index, receiptText };
}

async function install(page: Page, fixture?: ReturnType<typeof pairFixture>) {
  const files = new Map<string, Buffer>();
  files.set(BASELINE_NAME, baselineBytes); files.set(BASELINE_INDEX, baselineIndexBytes);
  if (fixture) files.set(ALTERNATING, Buffer.from(fixture.alt.text));
  if (fixture?.receiptText) files.set("food-band-foothold-visual-receipt-1202.json", Buffer.from(fixture.receiptText));
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url()), name = url.pathname.split("/").at(-1) ?? "";
    if (["food-band-foothold.html", "food-band-foothold.js", "food-band-foothold.css"].includes(name)) {
      const type = name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : "text/html";
      await route.fulfill({ contentType: type, body: await readFile(resolve(DOCS, name), "utf8") }); return;
    }
    if (name === INDEX) {
      if (!fixture) { await route.fulfill({ status: 404, body: "{}" }); return; }
      await route.fulfill({ contentType: "application/json", body: `${JSON.stringify(fixture.index)}\n` }); return;
    }
    const bytes = files.get(name);
    if (bytes) { await route.fulfill({ contentType: "application/json", body: bytes }); return; }
    await route.fulfill({ status: 404, contentType: "text/plain", body: `Unexpected request: ${name}` });
  });
  await page.goto(`${BASE}food-band-foothold.html`);
}

async function installActual(page: Page) {
  const files = new Map<string, Buffer>([
    [BASELINE_NAME, readFileSync(resolve(DOCS, BASELINE_NAME))], [BASELINE_INDEX, baselineIndexBytes],
    [INDEX, readFileSync(resolve(DOCS, INDEX))], [ALTERNATING, readFileSync(resolve(DOCS, ALTERNATING))],
    ["food-band-foothold-visual-receipt-1202.json", readFileSync(resolve(DOCS, "food-band-foothold-visual-receipt-1202.json"))],
    ["seed-1202-paired.mp4", readFileSync(resolve(DOCS, "food-band-foothold-media/seed-1202-paired.mp4"))],
  ]);
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    if (["food-band-foothold.html", "food-band-foothold.js", "food-band-foothold.css"].includes(name)) {
      const type = name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : "text/html";
      await route.fulfill({ contentType: type, body: await readFile(resolve(DOCS, name), "utf8") }); return;
    }
    const bytes = files.get(name);
    if (bytes) {
      if (name.endsWith(".mp4")) {
        const range = route.request().headers().range;
        const match = range?.match(/^bytes=(\d+)-(\d*)$/);
        if (match) {
          const start = Number(match[1]), end = Math.min(match[2] ? Number(match[2]) : bytes.length - 1, bytes.length - 1);
          await route.fulfill({ status: 206, headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": String(end - start + 1), "Content-Type": "video/mp4" }, body: bytes.subarray(start, end + 1) }); return;
        }
        await route.fulfill({ headers: { "Accept-Ranges": "bytes", "Content-Type": "video/mp4" }, body: bytes }); return;
      }
      await route.fulfill({ contentType: "application/json", body: bytes }); return;
    }
    await route.fulfill({ status: 404, contentType: "text/plain", body: `Unexpected request: ${name}` });
  });
  await page.goto(`${BASE}food-band-foothold.html`);
}

test("does not invent a new outcome when only the historical reference exists", async ({ page }) => {
  await install(page);
  await expect(page.locator("#empty-state")).toBeVisible();
  await expect(page.locator("#decision-status")).toHaveText("Pending");
  await expect(page.locator("#source-status")).toContainText("no alternating pair is listed");
});

test("verifies the pending pair and keeps same-age saved replay paused", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  await install(page, pairFixture());
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#source-status")).toContainText("verified");
  await expect(page.locator("#decision-status")).toHaveText("Pending parent review");
  await expect(page.locator("#run-state")).toHaveText("Paused · recorded replay");
  await expect(page.locator("#scrub-value")).toContainText("0 · 1 / 151");
  await expect(page.locator("#same-age-comparisons")).toContainText("Pending parent visual receipt");
  await page.getByRole("button", { name: "2,000" }).click();
  await expect(page.locator("#scrub-value")).toContainText("2,000 · 101 / 151");
  await expect(page.locator("#alternating-active-band")).toContainText("Band 1 · majority 672; other band 96 per pulse");
  await expect(page.locator(".scope-note")).toContainText("cannot establish food causation");
  for (const [tick, band] of [[500, 0], [1000, 1], [1500, 0], [2000, 1], [2500, 0], [3000, 1]]) {
    await page.locator("#scrub").evaluate((element: HTMLInputElement, value: number) => {
      element.value = String(value); element.dispatchEvent(new Event("input", { bubbles: true }));
    }, tick / 20);
    await expect(page.locator("#alternating-active-band")).toContainText(`Band ${band}`);
  }
  await page.getByRole("button", { name: "Play saved replay" }).click();
  await expect(page.locator("#run-state")).toHaveText("Playing · recorded frames");
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Pause saved replay" }).click();
  await expect(page.locator("#run-state")).toHaveText("Paused · recorded replay");
});

test("refuses an alternating record with the wrong active-band schedule", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const fixture = pairFixture(buildAlternating((data) => {
    const sample = data.samples.find((item: Rec) => item.tick === 520)!;
    sample.environment.activeBand = 0;
    delete data.dataSha256; data.dataSha256 = hashJSON(data);
  }));
  fixture.index.arms.alternating.rawSha256 = fixture.alt.rawSha;
  fixture.index.arms.alternating.dataSha256 = fixture.alt.data.dataSha256;
  fixture.index.decision.alternatingArtifactSha256 = fixture.alt.rawSha;
  await install(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("per-band food accounting");
  await expect(page.locator("#replay")).toBeHidden();
});

test("rejects a rehashed foothold floor or eligible-area mismatch", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  for (const field of ["floorPerBand", "alternatingBudget", "targetCount"]) {
    const fixture = pairFixture(buildAlternating((data) => { data.samples.find((item: Rec) => item.tick === 520)!.environment[field] += 1; }));
    await install(page, fixture);
    await expect(page.locator("#error-state")).toBeVisible();
    await expect(page.locator("#error-detail")).toContainText("food ledger or geometry");
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("rejects a rehashed missing continuous minority offer", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const fixture = pairFixture(buildAlternating((data) => {
    const env = data.samples.find((item: Rec) => item.tick === 520)!.environment;
    env.bandOffered = [0, env.offered]; env.bandAccepted = [0, env.accepted]; env.bandOverflow = [0, env.overflow];
  }));
  await install(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("per-band food accounting");
});

test("rejects rehashed cumulative food transfers between bands", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const fixture = pairFixture(buildAlternating((data) => {
    const before = data.samples.find((item: Rec) => item.tick === 500)!.environment;
    const after = data.samples.find((item: Rec) => item.tick === 520)!.environment;
    const transfer = after.bandAccepted[0] - before.bandAccepted[0] + 1;
    after.bandAccepted[0] -= transfer; after.bandAccepted[1] += transfer;
    after.bandOverflow[0] += transfer; after.bandOverflow[1] -= transfer;
  }));
  await install(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("per-band cumulative ledger");
});

test("rejects a seasonal gate that disagrees with the saved body tiles", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const fixture = pairFixture(buildAlternating((data) => {
    data.seasonalGate.blocks[0].pass = !data.seasonalGate.blocks[0].pass;
    delete data.dataSha256; data.dataSha256 = hashJSON(data);
  }));
  fixture.index.arms.alternating.rawSha256 = fixture.alt.rawSha;
  fixture.index.arms.alternating.dataSha256 = fixture.alt.data.dataSha256;
  fixture.index.decision.alternatingArtifactSha256 = fixture.alt.rawSha;
  await install(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("seasonal gate disagrees");
});

test("rejects population rows whose cap flags contradict the recorded body count", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const fixture = pairFixture(buildAlternating((data) => {
    const row = data.tickRows.find((item: Rec) => item.tick === 1510)!;
    row.population = 48; row.cap48 = false; row.nearCap47 = false;
  }));
  await install(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("contradict population cap flags");
});

for (const variant of ["invented trough", "invented lineage events", "sample cell mismatch"] as const) {
  test(`rejects rehashed tick history with ${variant}`, async ({ page }) => {
    test.skip(!hasReplays, replaysMissing);
    const fixture = pairFixture(buildAlternating((data) => {
      if (variant === "invented trough") {
        const row = data.tickRows.find((item: Rec) => item.tick % 20 !== 0 && item.population < 47)!;
        row.population = 0; row.cap48 = false; row.nearCap47 = false;
      } else if (variant === "invented lineage events") {
        const row = data.tickRows[0]; row.births++; row.deaths++;
      } else {
        const row = data.tickRows.find((item: Rec) => item.tick === 20)!; row.cells++;
      }
    }));
    await install(page, fixture);
    await expect(page.locator("#error-state")).toBeVisible();
    await expect(page.locator("#error-detail")).toContainText(variant === "invented trough" ? "Population transition" : variant === "invented lineage events" ? "Lineage event delta" : "Sample counters disagree");
    await expect(page.locator("#replay")).toBeHidden();
  });
}

for (const variant of ["genome cap", "living lineage"] as const) {
  test(`rejects a rehashed intermediate frame violating its ${variant}`, async ({ page }) => {
    test.skip(!hasReplays, replaysMissing);
    const fixture = pairFixture(buildAlternating((data) => {
      const frame = data.frames.find((item: Rec) => item.tick === 520)!;
      if (variant === "genome cap") {
        const organism = frame.organisms.find((org: Rec) => frame.cells.filter((cell: number[]) => cell[1] === org.id).length > 16)!;
        if (!organism) throw new Error("Fixture must have an intermediate body larger than16 cells.");
        organism.genome = { ...organism.genome, maxCells: 16 };
      } else {
        const organism = frame.organisms[0];
        organism.genome = { ...organism.genome, turn: organism.genome.turn === 0 ? 1 : 0 };
      }
      const envelope = { ...frame }; delete envelope.frameSha256;
      frame.frameSha256 = hashJSON(envelope);
      data.samples.find((item: Rec) => item.tick === 520)!.frameSha256 = frame.frameSha256;
    }));
    await install(page, fixture);
    await expect(page.locator("#error-state")).toBeVisible();
    await expect(page.locator("#error-detail")).toContainText(variant === "genome cap" ? "over-cap body" : "differ from living lineage");
    await expect(page.locator("#replay")).toBeHidden();
  });
}

test("rejects a rehashed full snapshot whose food differs from its saved frame", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const fixture = pairFixture(buildAlternating((data) => {
    const snapshot = data.snapshots.find((item: Rec) => item.tick === 1000)!;
    snapshot.state.food[0] = (snapshot.state.food[0] + 1) % 41;
    refreshSnapshotDigest(data, 1000);
  }));
  await install(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("snapshot bodies, food, ledger, or census disagree");
});

test("accepts a complete SHA-bound manual receipt only after all new screens pass", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const alt = buildAlternating();
  const receipt = { seed: 1202, planSha256: PLAN, baselineArtifactSha256: sha(baselineBytes), alternatingArtifactSha256: alt.rawSha,
    alternatingChange: { from: 2500, to: 3000, pass: true, observation: "Not blind to the baseline and numerical outcome. Concrete occupied body tiles change between the two saved frames." },
    seasonalChanges: alt.data.seasonalGate.blocks.map((block: Rec) => ({ from: block.from, to: block.to, pass: block.pass,
      observation: "Not blind to the baseline and numerical outcome. The body-only saved frames show the reviewed expansion and clearing pattern." })),
    sameAgeComparisons: [1500, 2000, 2500, 3000].map((tick) => ({ tick, observation: "Not blind to the baseline and numerical outcome. Descriptive same-age body-only review." })),
    visualReviewedBeforeOverlapDiagnostics: true, reviewedAtUTC: "2026-10-27T12:00:00Z" };
  await install(page, pairFixture(alt, receipt));
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#decision-status")).toHaveText("Promising");
  await expect(page.locator("#visual-gate")).toContainText("Pass");
  await expect(page.locator("#same-age-comparisons")).toContainText("Tick 2,000");
});

test("records a manual seasonal failure as stop even when the numerical screen passes", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const alt = buildAlternating();
  const receipt = { seed: 1202, planSha256: PLAN, baselineArtifactSha256: sha(baselineBytes), alternatingArtifactSha256: alt.rawSha,
    alternatingChange: { from: 2500, to: 3000, pass: true, observation: "Not blind to the baseline and numerical outcome. Body tiles changed between saved frames." },
    seasonalChanges: alt.data.seasonalGate.blocks.map((block: Rec) => ({ from: block.from, to: block.to, pass: false,
      observation: "Not blind to the baseline and numerical outcome. No concrete cleared cluster was identifiable." })),
    sameAgeComparisons: [1500, 2000, 2500, 3000].map((tick) => ({ tick, observation: "Not blind to the baseline and numerical outcome. Descriptive same-age body-only review." })),
    visualReviewedBeforeOverlapDiagnostics: true, reviewedAtUTC: "2026-10-27T12:00:00Z" };
  await install(page, pairFixture(alt, receipt));
  await expect(page.locator("#decision-status")).toHaveText("Stop");
  await expect(page.locator("#seasonal-gate")).toHaveText("Pass");
  await expect(page.locator("#visual-gate")).toContainText("Did not pass");
});

test("rejects rehashed biology rule drift mirrored into every snapshot", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const fixture = pairFixture(buildAlternating((data) => {
    data.rules.reproductionEvery += 1;
    for (const snap of data.snapshots) { snap.state.rules = structuredClone(data.rules); refreshSnapshotDigest(data, snap.tick); }
  }));
  await install(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("biology rules differ");
});

test("rejects a rehashed invented maximum-ever generation", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  await install(page, pairFixture(buildAlternating((data) => { data.final.maxEverGeneration += 1; })));
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("Final lineage summary");
});

test("rejects invalid final death semantics even when mirrored into snapshots", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const fixture = pairFixture(buildAlternating((data) => {
    const dead = data.final.lineage.find((n: Rec) => n.deathTick !== null)!;
    dead.deathCause = "invented";
    for (const snap of data.snapshots) {
      const node = snap.state.lineage.find((n: Rec) => n.id === dead.id && n.deathTick !== null);
      if (node) { node.deathCause = "invented"; refreshSnapshotDigest(data, snap.tick); }
    }
  }));
  await install(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("death semantics");
});

test("rejects a rehashed impossible parent generation", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  await install(page, pairFixture(buildAlternating((data) => {
    const child = data.final.lineage.find((n: Rec) => n.parentID !== null)!;
    child.generation += 2;
  })));
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("parent or generation");
});

test("rejects a mismatched raw artifact digest", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  const fixture = pairFixture();
  fixture.index.arms.alternating.rawSha256 = "0".repeat(64);
  await install(page, fixture);
  await expect(page.locator("#error-state")).toBeVisible();
  await expect(page.locator("#error-detail")).toContainText("raw-file digest");
});

test("keeps the paired replay usable at mobile width and passes axe checks", async ({ page }) => {
  test.skip(!hasReplays, replaysMissing);
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page, pairFixture());
  await expect(page.locator("#replay")).toBeVisible();
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(width.page).toBeLessThanOrEqual(width.viewport);
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("published seed-1202 alternating evidence is bound to its actual summary and receipt", async ({ page }) => {
  test.skip(process.env.BL_FOOTHOLD_ACTUAL !== "1", "Set BL_FOOTHOLD_ACTUAL=1 to require and verify published outcome files.");
  const alternatingBytes = readFileSync(resolve(DOCS, "food-band-foothold-seed-1202.json"));
  const indexBytes = readFileSync(resolve(DOCS, INDEX));
  const receiptBytes = readFileSync(resolve(DOCS, "food-band-foothold-visual-receipt-1202.json"));
  const summaryBytes = readFileSync(resolve(DOCS, "food-band-foothold-summary.json"));
  const alternating = JSON.parse(alternatingBytes.toString("utf8")) as Rec;
  const pair = JSON.parse(indexBytes.toString("utf8")) as Rec;
  const receipt = JSON.parse(receiptBytes.toString("utf8")) as Rec;
  const summary = JSON.parse(summaryBytes.toString("utf8")) as Rec;
  const alternatingRawSha = sha(alternatingBytes), receiptSha = sha(receiptBytes);
  expect(pair.planSha256).toBe(PLAN);
  expect(pair.decision.alternatingArtifactSha256).toBe(alternatingRawSha);
  expect(pair.decision.visualReceiptSha256).toBe(receiptSha);
  expect(pair.decision.status).toBe(summary.decision);
  expect(summary).toMatchObject({ schemaVersion: 1, seed: 1202, planSha256: PLAN, decision: pair.decision.status,
    newOutcomeArms: 1, historicalBaselineIsNewEvidence: false, receiptSha256: receiptSha });
  expect(receipt).toMatchObject({ seed: 1202, planSha256: PLAN, baselineArtifactSha256: sha(baselineBytes), alternatingArtifactSha256: alternatingRawSha });
  expect(receipt.sameAgeComparisons.map((item: Rec) => item.tick)).toEqual([1500, 2000, 2500, 3000]);
  expect(summary.numericalGate).toEqual(alternating.numericalGate);
  expect(summary.spatialGate).toEqual(alternating.spatialGate);
  expect(summary.seasonalGate).toEqual(alternating.seasonalGate);
  expect(summary.baselineSeasonalReference).toEqual(alternating.baselineSeasonalReference);
  for (const role of ["baseline", "alternating"] as const) {
    const bytes = role === "baseline" ? baselineBytes : alternatingBytes;
    const data = role === "baseline" ? baseline : alternating;
    const item = pair.arms[role], summaryArm = summary.arms[role];
    expect(item.rawSha256).toBe(sha(bytes));
    expect(item.dataSha256).toBe(data.dataSha256);
    expect(summaryArm.artifactSha256).toBe(sha(bytes));
    expect(summaryArm.dataSha256).toBe(data.dataSha256);
    expect(summaryArm.finalCensus).toEqual(data.final.census);
    expect(summaryArm.finalEnvironment).toEqual(data.final.environment);
  }
  await installActual(page);
  await expect(page.locator("#outcome-title")).toHaveText(`Seed 1202 · ${pair.decision.status === "promising" ? "promising" : "stop"}`);
  await expect(page.locator("#outcome-summary")).toContainText(`At tick ${alternating.run.finalTick.toLocaleString("en-US")}`);
  await expect(page.locator("#outcome-summary")).toContainText(`${summary.seasonalGate.blocks.filter((block: Rec) => block.pass).length} of 3 late seasonal blocks`);
  await expect(page.locator("#static-caveat")).toContainText("No historical block meets this screen.");
  await expect(page.locator("#outcome-title").locator("..").locator("video")).toHaveCount(1);
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#decision-status")).toHaveText(pair.decision.status === "promising" ? "Promising" : "Stop");
  for (const tick of [1500, 2000, 2500, 3000]) {
    await page.getByRole("button", { name: tick.toLocaleString("en-US") }).click();
    await expect(page.locator("#scrub-value")).toContainText(`${tick.toLocaleString("en-US")} ·`);
    const actualAltTick = Math.min(tick, alternating.run.finalTick);
    const current = alternating.samples.filter((item: Rec) => item.tick <= actualAltTick).at(-1)!;
    const frame = alternating.frames.find((item: Rec) => item.tick === current.tick)!;
    const baselineSample = baseline.samples.find((item: Rec) => item.tick === tick)!;
    const baselineFrame = baseline.frames.find((item: Rec) => item.tick === tick)!;
    const counts = [0, 0];
    for (const [tile] of frame.cells) { const col = tile % 96; if (col <= 23) counts[0]++; else if (col >= 48 && col <= 71) counts[1]++; }
    const baselineCounts = [0, 0];
    for (const [tile] of baselineFrame.cells) { const col = tile % 96; if (col <= 23) baselineCounts[0]++; else if (col >= 48 && col <= 71) baselineCounts[1]++; }
    await expect(page.locator("#alternating-population")).toHaveText(String(current.census.population));
    await expect(page.locator("#alternating-cells")).toHaveText(String(current.census.cells));
    await expect(page.locator("#alternating-bands")).toHaveText(counts.map((x) => x.toLocaleString("en-US")).join(" / "));
    await expect(page.locator("#alternating-active-band")).toContainText(`Band ${current.environment.activeBand}`);
    if (alternating.run.extinctionTick !== null && tick > alternating.run.finalTick) {
      await expect(page.locator("#alternating-frame-label")).toContainText(`Extinct · actual tick ${alternating.run.finalTick.toLocaleString("en-US")} · holding terminal frame`);
    }
    await expect(page.locator("#baseline-population")).toHaveText(String(baselineSample.census.population));
    await expect(page.locator("#baseline-cells")).toHaveText(String(baselineSample.census.cells));
    await expect(page.locator("#baseline-bands")).toHaveText(baselineCounts.map((x) => x.toLocaleString("en-US")).join(" / "));
  }
  await expect(page.locator("#seasonal-rows tr")).toHaveCount(3);
});

test("published alternating replay video plays and the final result remains accessible on mobile", async ({ page }) => {
  test.skip(process.env.BL_FOOTHOLD_MEDIA !== "1", "Set BL_FOOTHOLD_MEDIA=1 to require the published replay media files.");
  for (const name of ["seed-1202-paired.mp4", "seed-1202-paired.json", "seed-1202-comparison.png", "seed-1202-comparison.json"]) {
    const bytes = readFileSync(resolve(DOCS, "food-band-foothold-media", name));
    expect(bytes.byteLength, `${name} must not be empty`).toBeGreaterThan(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await installActual(page);
  const video = page.locator("#outcome-title").locator(".." ).locator("video");
  await expect(video).toBeVisible();
  await video.evaluate((element: HTMLVideoElement) => new Promise<void>((resolve, reject) => {
    element.addEventListener("canplay", () => resolve(), { once: true });
    element.addEventListener("error", () => reject(new Error(`Video failed to load: ${element.error?.message}`)), { once: true });
    if (element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) resolve();
  }));
  const duration = await video.evaluate((element: HTMLVideoElement) => element.duration);
  expect(duration).toBeGreaterThanOrEqual(15.0);
  expect(duration).toBeLessThanOrEqual(15.2);
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.2);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await expect(page.locator("#outcome-title")).toContainText("Seed 1202 ·");
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(width.page).toBeLessThanOrEqual(width.viewport);
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});
