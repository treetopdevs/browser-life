// Run: deno test --no-lock -A tools/test/discovery-divergence-control.deno.ts
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "../lib/discovery-improvement-runtime.ts";
import {
  buildRoster,
  carrierMedian,
  GAIN,
  hexOf,
  type ImprovementReport,
  MU,
  shuffledMutant,
  SIGMA,
  SLOTS,
  slotsOf,
} from "../lib/discovery-divergence-control.ts";
import { plan, REPORT_SHA256 } from "../discovery_divergence_control.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const STUDY = join(ROOT, "experiments/founder-discovery/v1/improvement-study");
const REPORT = join(STUDY, "distribution-v1/analysis-v1/report.json");
const MANIFEST = join(STUDY, "manifest.json");
const manifest = validateManifest(
  JSON.parse(await Deno.readTextFile(MANIFEST)),
);
const report = JSON.parse(await Deno.readTextFile(REPORT)) as ImprovementReport;

const changed = (a: readonly number[], b: readonly number[]) =>
  a.flatMap((v, i) => (b[i] === v ? [] : [i]));
const magnitudes = (a: readonly number[], b: readonly number[]) =>
  changed(a, b).map((i) => Math.abs(b[i] - a[i])).sort((x, y) => x - y);
const synthetic = (
  weight: number,
  mu: number,
  sigma: number,
  gain: number,
) => [...Array(160).fill(weight), mu, sigma, gain];

Deno.test("founder genomes round-trip through 163 mutable slots", () => {
  for (const f of manifest.founders) {
    const slots = slotsOf(f.hex);
    assert.deepEqual(slots.length, SLOTS);
    assert.deepEqual(hexOf(slots), f.hex);
  }
});

Deno.test("shuffled mutant keeps slot count and magnitude multiset, deterministically", () => {
  const founder = slotsOf(manifest.founders[0].hex);
  const descendant = [...founder];
  for (
    const [slot, delta] of [
      [3, 40],
      [17, -5],
      [90, 12],
      [MU, 30],
      [SIGMA, -3],
      [GAIN, 7],
    ]
  ) {
    descendant[slot] += delta;
  }
  const a = shuffledMutant(founder, descendant, 6480001);
  assert.deepEqual(a.slots.length, SLOTS);
  assert.deepEqual(changed(founder, a.slots).length, 6);
  assert.deepEqual(
    magnitudes(founder, a.slots),
    magnitudes(founder, descendant),
  );
  assert.deepEqual(shuffledMutant(founder, descendant, 6480001), a);
  assert.ok(
    JSON.stringify(shuffledMutant(founder, descendant, 6480002).slots) !==
      JSON.stringify(a.slots),
  );
});

Deno.test("a clamped sign takes the other sign", () => {
  const founder = synthetic(127, 100, 20, 10);
  const descendant = [...founder];
  for (let s = 0; s < 40; s++) descendant[s] = 117;
  const m = shuffledMutant(founder, descendant, 6480003).slots;
  for (const s of changed(founder, m)) {
    if (s < 160) assert.deepEqual(m[s], 117);
  }
});

Deno.test("a slot where both signs clamp is redrawn", () => {
  const founder = synthetic(0, 2000, 500, 128);
  const descendant = [...founder];
  descendant[MU] = 2200; // magnitude 200 fits only mu or sigma
  for (let seed = 6480001; seed <= 6480020; seed++) {
    const slots = changed(
      founder,
      shuffledMutant(founder, descendant, seed).slots,
    );
    assert.deepEqual(slots.length, 1);
    assert.ok(slots[0] === MU || slots[0] === SIGMA, `slot ${slots[0]}`);
  }
  const impossible = [...founder];
  impossible[MU] = 2000 + 3000; // fits no slot
  assert.throws(
    () => shuffledMutant(founder, impossible, 6480001),
    /no slot fits/,
  );
});

Deno.test("carrier median is mass weighted over upward changes only", () => {
  const founder = slotsOf(manifest.founders[0].hex);
  const withMu = (mu: number) => {
    const s = [...founder];
    s[MU] = mu;
    return hexOf(s);
  };
  const base = founder[MU];
  const abundance = [
    { hex: withMu(base), mass: 1000 },
    { hex: withMu(base - 5), mass: 1000 },
    { hex: withMu(base + 2), mass: 10 },
    { hex: withMu(base + 7), mass: 30 },
    { hex: withMu(base + 9), mass: 5 },
  ];
  assert.deepEqual(carrierMedian(founder, abundance, MU), base + 7);
  assert.deepEqual(carrierMedian(founder, abundance.slice(0, 2), MU), null);
});

Deno.test("roster from the frozen report matches the protocol's units and counts", () => {
  const roster = buildRoster(report, REPORT_SHA256, manifest);
  assert.deepEqual(roster.counts, {
    evolvedDraws: 64,
    mutantGenomes: 64,
    reconstructionGenomes: 14,
    newConfigurations: 1248,
    replayConfigurations: 8,
    totalConfigurations: 1256,
  });
  assert.deepEqual(
    roster.reconstructions.map((
      r,
    ) => [r.founderId, r.founderValue, r.perSeed.map((p) => p.value)]),
    [
      ["discovery-cluster-33", 62, [97, 73, 76, 72, 86, 99, 82, 100]],
      ["discovery-cluster-139", 33, [49, 55, 46, 57, 49, 47, 47, 54]],
    ],
  );
  const genome = new Map(roster.genomes.map((g) => [g.id, g]));
  for (const m of roster.mutants) {
    const e = roster.evolved.find((x) => x.drawId === m.evolvedDrawId)!;
    const founder = slotsOf(genome.get(m.genomeId)!.founderHex);
    assert.deepEqual(
      magnitudes(founder, slotsOf(m.hex)),
      magnitudes(founder, slotsOf(e.descendantHex)),
    );
  }
  for (const g of roster.genomes.filter((g) => g.arm === "reconstruction")) {
    assert.deepEqual(
      changed(slotsOf(g.founderHex), slotsOf(g.descendantHex)).length,
      1,
    );
  }
  const replayFounders = roster.replay.map((r) =>
    r.observationId.match(/^(discovery-cluster-\d+)-/)![1]
  );
  assert.deepEqual(
    replayFounders,
    manifest.founders.flatMap((f) => [f.id, f.id]),
  );
  assert.deepEqual(
    JSON.stringify(buildRoster(report, REPORT_SHA256, manifest)),
    JSON.stringify(roster),
  );
});

Deno.test("roster refuses manifest mismatch and evolved identity drift", () => {
  assert.throws(
    () =>
      buildRoster(
        { ...report, manifestHash: "0".repeat(64) },
        REPORT_SHA256,
        manifest,
      ),
    /disagree/,
  );
  const observations = report.observations.map((o) => ({ ...o }));
  const target = observations.find((o) =>
    o.time === 1_000_000 && o.mode === "normal"
  )!;
  target.cacheKey = "0".repeat(64);
  assert.throws(
    () => buildRoster({ ...report, observations }, REPORT_SHA256, manifest),
    /identity drift/,
  );
});

Deno.test("plan refuses a drifted report and an existing roster", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const drifted = join(dir, "report.json");
    await Deno.writeTextFile(drifted, JSON.stringify(report));
    await assert.rejects(
      () => plan(drifted, MANIFEST, join(dir, "a.json")),
      /report hash drift/,
    );
    const existing = join(dir, "exists.json");
    await Deno.writeTextFile(existing, "{}");
    await assert.rejects(
      () => plan(REPORT, MANIFEST, existing),
      Deno.errors.AlreadyExists,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
