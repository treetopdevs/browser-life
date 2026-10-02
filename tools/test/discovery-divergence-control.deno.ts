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
  SIGMA,
  SLOTS,
  slotsOf,
  typeMatchedMutant,
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
const weightMagnitudes = (a: readonly number[], b: readonly number[]) =>
  changed(a, b).filter((i) => i < 160).map((i) => Math.abs(b[i] - a[i])).sort((
    x,
    y,
  ) => x - y);
const parameterChanges = (a: readonly number[], b: readonly number[]) =>
  changed(a, b).filter((i) => i >= 160).map((i) => [i, Math.abs(b[i] - a[i])]);
const synthetic = (weight: number, mu: number, sigma: number, gain: number) => [
  ...Array(160).fill(weight),
  mu,
  sigma,
  gain,
];

Deno.test("founder genomes round-trip through 163 mutable slots", () => {
  for (const f of manifest.founders) {
    const slots = slotsOf(f.hex);
    assert.equal(slots.length, SLOTS);
    assert.equal(hexOf(slots), f.hex);
  }
});

Deno.test("type-matched mutant keeps weight magnitudes on weights and parameters in place", () => {
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
  const a = typeMatchedMutant(founder, descendant, 6480001);
  assert.deepEqual(
    weightMagnitudes(founder, a.slots),
    weightMagnitudes(founder, descendant),
  );
  assert.deepEqual(
    parameterChanges(founder, a.slots),
    parameterChanges(founder, descendant),
  );
  assert.deepEqual(typeMatchedMutant(founder, descendant, 6480001), a);
  assert.notDeepEqual(
    typeMatchedMutant(founder, descendant, 6480002).slots,
    a.slots,
  );
});

Deno.test("a clamped sign takes the other sign, for weights and parameters", () => {
  const founder = synthetic(127, 20, 20, 0);
  const descendant = [...founder];
  for (let s = 0; s < 40; s++) descendant[s] = 117;
  descendant[MU] = 30; // mu 20 - 10 would fall below 16
  descendant[GAIN] = 9; // gain 0 - 9 would fall below 0
  for (let seed = 6480001; seed <= 6480010; seed++) {
    const m = typeMatchedMutant(founder, descendant, seed).slots;
    for (const s of changed(founder, m).filter((s) => s < 160)) {
      assert.equal(m[s], 117);
    }
    assert.deepEqual([m[MU], m[GAIN]], [30, 9]);
  }
});

Deno.test("a weight slot where both signs clamp is redrawn, and impossible magnitudes refuse", () => {
  // Magnitude 254 fits only where the founder weight is +127 or -127.
  const founder = synthetic(0, 2000, 500, 128);
  founder[0] = 127;
  for (let s = 150; s < 160; s++) founder[s] = -127;
  const descendant = [...founder];
  descendant[0] = -127;
  for (let seed = 6480001; seed <= 6480020; seed++) {
    const slots = changed(
      founder,
      typeMatchedMutant(founder, descendant, seed).slots,
    );
    assert.equal(slots.length, 1);
    assert.ok(
      slots[0] === 0 || (slots[0] >= 150 && slots[0] < 160),
      `slot ${slots[0]}`,
    );
  }
  const flat = synthetic(0, 2000, 500, 128);
  const impossible = [...flat];
  impossible[0] = -128; // magnitude 128 fits no weight at 0
  assert.throws(
    () => typeMatchedMutant(flat, impossible, 6480001),
    /no slot fits/,
  );
});

Deno.test("carrier median is the mass-weighted lower median over upward changes only", () => {
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
  assert.equal(carrierMedian(founder, abundance, MU), base + 7);
  assert.equal(carrierMedian(founder, abundance.slice(0, 2), MU), null);
});

Deno.test("roster from the frozen report matches the protocol's units and counts", () => {
  const roster = buildRoster(report, REPORT_SHA256, manifest);
  assert.deepEqual(roster.counts, {
    evolvedDraws: 64,
    mutantGenomes: 128,
    reconstructionGenomes: 14,
    specificityGenomes: 8,
    newConfigurations: 1200,
    replayConfigurations: 8,
    totalConfigurations: 1208,
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
  assert.ok(
    roster.assays.every((a) => a.assignment === 0 || a.assignment === 1),
  );
  assert.ok(
    roster.evolved.every((e) =>
      e.observationIds.every((id) => /-a[01]$/.test(id))
    ),
  );
  const genome = new Map(roster.genomes.map((g) => [g.id, g]));
  for (const e of roster.evolved) {
    const ms = roster.mutants.filter((m) => m.evolvedDrawId === e.drawId);
    assert.equal(ms.length, 2);
    for (const m of ms) {
      const founder = slotsOf(genome.get(m.genomeId)!.founderHex);
      const d = slotsOf(e.descendantHex), x = slotsOf(m.hex);
      assert.deepEqual(
        weightMagnitudes(founder, x),
        weightMagnitudes(founder, d),
      );
      assert.deepEqual(
        parameterChanges(founder, x),
        parameterChanges(founder, d),
      );
    }
  }
  for (const g of roster.genomes.filter((g) => g.arm === "reconstruction")) {
    assert.equal(
      changed(slotsOf(g.founderHex), slotsOf(g.descendantHex)).length,
      1,
    );
  }
  const r33 = roster.reconstructions[0];
  for (const c of roster.specificity) {
    const g = genome.get(c.genomeId)!;
    const diff = changed(slotsOf(g.founderHex), slotsOf(g.descendantHex));
    const own = r33.perSeed.find((p) => p.seed === c.seed)!;
    assert.ok(
      diff.length === 1 && diff[0] === c.slot && c.slot < 160 &&
        c.slot !== r33.slot,
    );
    assert.equal(
      Math.abs(c.value - slotsOf(g.founderHex)[c.slot]),
      Math.abs(own.value - r33.founderValue),
    );
  }
  assert.deepEqual(
    roster.replay.map((r) =>
      r.observationId.match(/^(discovery-cluster-\d+)-/)![1]
    ),
    manifest.founders.flatMap((f) => [f.id, f.id]),
  );
  assert.equal(
    JSON.stringify(buildRoster(report, REPORT_SHA256, manifest)),
    JSON.stringify(roster),
  );
});

Deno.test("roster refuses manifest mismatch, identity drift and assignment-pair drift", () => {
  assert.throws(
    () =>
      buildRoster(
        { ...report, manifestHash: "0".repeat(64) },
        REPORT_SHA256,
        manifest,
      ),
    /disagree/,
  );
  const drift = report.observations.map((o) => ({ ...o }));
  drift.find((o) => o.time === 1_000_000 && o.mode === "normal")!.cacheKey = "0"
    .repeat(64);
  assert.throws(
    () =>
      buildRoster({ ...report, observations: drift }, REPORT_SHA256, manifest),
    /identity drift/,
  );
  const pair = report.observations.map((o) => ({ ...o }));
  const a2 = pair.find((o) =>
    o.time === 1_000_000 && o.mode === "normal" && o.assignment === 2
  )!;
  a2.score = (a2.score ?? 0) + 0.01;
  assert.throws(
    () =>
      buildRoster({ ...report, observations: pair }, REPORT_SHA256, manifest),
    /pair invariance/,
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
