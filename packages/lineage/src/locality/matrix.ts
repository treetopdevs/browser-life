// Assembles the I05 mutation-effect matrix: rows, stratified readouts, the pre-stated decision rule and the canonical
// payload. Browser-safe and pure (no node:crypto, no filesystem); the digest and the integrity seal live in the CLI,
// as with the predictability atlas. Counts, denominators and permille only: no floats, no intervals.
import { M3_FOUNDERS, NN_BYTES, NN_H, NN_I, NN_O, W1_OFF, W2_OFF, defaultConfig, draw, encodeGenome, founderGenome, lowbias32, type M3Founder } from "@bl/schema";
import { probeGenome, wordsHex, type Probe } from "../genotype.ts";
import { GRID_POINTS, OUTPUT_VALUES, BREADTH_FLOOR_PERMILLE, PARTICIPATION_DELTA, describeEdit, describeProbes, popcount, withinStructural, type Descriptor } from "./descriptors.ts";
import { GENERALIST_ROLES, bytesChanged, deadHidden, generalistWords, permuteHidden, permuteSensors, weightL1, weightsOf, widestPermutation, withWeights, zeroSlot } from "./fixtures.ts";
import { NB_V1, NEIGHBOURHOOD, applyOperator, buildNeighbourhood, drawAssaySubset, genomeHash, strHash, strataKey, type Allocation, type Edit, type Neighbourhood } from "./neighbourhood.ts";
import { allocFor, excludeSet, type Panel, type SlotSpec } from "./panel.ts";
import { ASSAY, AssayCache, SCENARIO_IDS, responses, sum, tau, type Scenario } from "./scenarios.ts";

export const STUDY_VERSION = 1;
export const ENDPOINTS = ["light-growth", "dark-persistence", "dim-transfer"] as const satisfies readonly Scenario[];
const EP = { lg: 0, dp: 1, dt: 2 } as const;

/** Frozen before any outcome: assayed edits per start genome, by stratum (`family/kind`). */
export const ALLOC_M3: Allocation = {
  "single6/w1": 3, "single6/b1": 1, "single6/w2": 3, "single6/b2": 1, "single6/physics": 1,
  "single24/w1": 3, "single24/b1": 1, "single24/w2": 3, "single24/b2": 1, "single24/physics": 1,
  "multi2/multi": 3, "multi4/multi": 3,
};
export const ALLOC_CONTROL: Allocation = { "single24/w1": 2, "single24/w2": 2, "single24/b1": 1, "single24/b2": 1, "single24/physics": 1, "multi2/multi": 1 };

/** Candidate order per slot (sparse, dense), fixed before data. */
export const SLOTS: SlotSpec[] = [{ slot: "sparse", clusters: [4, 10] }, { slot: "dense", clusters: [16, 9] }];

/** The PR136 panel: today's constants. Every panel-taking function defaults to it and must then reproduce PR136 byte for byte. */
export const PANEL_V1: Panel = { id: "v1", nb: NB_V1, seeds: ASSAY.seeds, allocM3: ALLOC_M3, allocControl: ALLOC_CONTROL, slots: SLOTS, nullPrefix: "", exclude: {} };

/** Decision thresholds, stated before data and not tuned afterwards. */
export const RULE = {
  minImproving: 5,
  broadlyUseful: { cleanOfImprovingPermille: 500, cleanOfAssayedGenuinePermille: 100, multiAllowedDeficitPermille: 50 },
  entanglement: { collateralOfImprovingPermille: 500, minMedianBreadthActuators: 3, minExcessOverNullActuators: 1 },
  nullReplicates: 4,
  sensitivity: "zeroing w2 h1->photo on the generalist must lower light-growth by more than tau",
} as const;

export type Role = "control" | "m3-sparse" | "m3-dense";
export interface StartGenome { id: string; label: string; role: Role; cluster?: number; words: Uint32Array }

export const m3Start = (cluster: number, role: Role): StartGenome => {
  const f = M3_FOUNDERS.find((x: M3Founder) => x.cluster === cluster);
  if (!f) throw new Error(`no M3 founder for cluster ${cluster}`);
  const g = founderGenome(f);
  return { id: `m3-c${cluster}`, label: `M3 cluster ${cluster}`, role, cluster, words: encodeGenome(g, 0, 0) };
};
export const GENERALIST_ID = "generalist";
export const generalistStart = (): StartGenome => {
  const c = defaultConfig();
  return { id: GENERALIST_ID, label: "Hand-built generalist", role: "control", words: generalistWords(c.defaultMu, c.defaultSigma) };
};

// ---- Degree-matched null ----------------------------------------------------------------------------------

/** Same genome with its W1 values and W2 values each shuffled among that layer's positions: same nonzero count per layer. */
export function degreeMatchedNull(words: Uint32Array, seed: number): Uint32Array {
  const wb = weightsOf(words), out = wb.slice();
  const shuffleLayer = (lo: number, n: number, tag: number) => {
    const vals = Array.from({ length: n }, (_, i) => wb[lo + i]);
    const base = lowbias32((seed ^ tag) >>> 0);
    for (let i = n - 1; i > 0; i--) { const j = draw(base, i) % (i + 1); [vals[i], vals[j]] = [vals[j], vals[i]]; }
    vals.forEach((v, i) => (out[lo + i] = v));
  };
  shuffleLayer(W1_OFF, NN_I * NN_H, 0x51);
  shuffleLayer(W2_OFF, NN_H * NN_O, 0x52);
  return withWeights(words, out);
}
export const nonzeroCounts = (words: Uint32Array) => {
  const wb = weightsOf(words);
  const c = (lo: number, n: number) => { let k = 0; for (let i = lo; i < lo + n; i++) if (wb[i] !== 0) k++; return k; };
  return { w1: c(W1_OFF, NN_I * NN_H), b1: c(NN_I * NN_H, NN_H), w2: c(W2_OFF, NN_H * NN_O), b2: c(NN_BYTES - NN_O, NN_O) };
};

/** Twice the median (sum of the two middle values), so the median stays an integer. */
export function median2(a: readonly number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)];
}

// ---- Shapes -----------------------------------------------------------------------------------------------

export interface Baseline { lg: number[]; dp: number[]; dt: number[] }
export interface GenomeRecord {
  id: string; label: string; role: Role; cluster: number | null; hex: string; hash: string;
  nonzero: { w1: number; b1: number; w2: number; b2: number };
  baseline: Baseline;
  /** Summed-over-seeds tolerance per endpoint, from baselines only. */
  tau: [number, number, number];
  qualification: { pass: boolean; minLightGrowth: number; minLightOverDark: number; reasons: string[] };
  /** Vote in the verdict: only the qualifying M3 genomes. */
  votes: boolean;
}
export interface AssayRecord {
  /** Mutant summed-over-seeds response per endpoint [light-growth, dark-persistence, dim-transfer]. */
  sums: [number, number, number];
  /** Paired deviation from the baseline, summed over seeds. */
  dev: [number, number, number];
  /** Initial and final bound mass of the light-growth run on the first seed, with the P and E stocks. */
  stocks: { B0: number; B1: number; P0: number; P1: number; E0: number; E1: number };
}
export interface Row {
  genome: string; id: string; family: string; kind: string; k: number; cls: string;
  slots: { slot: number; locus: string; kind: string; op: number; exp: number; before: number; after: number; applied: number; cls: string }[];
  requestedL1: number; realisedL1: number; undoExact: boolean; dupOf: string | null; hash: string;
  expression: string; changed: number[]; maxDelta: number[]; breadth: number; participation: number;
  sensorReach: number; sensorMask: number; structActuators: number; structSensors: number; withinStructural: boolean;
  assayed: boolean; assay: AssayRecord | null;
}

export interface Outcome { viable: boolean; improves: boolean[]; harms: boolean[]; improvesAny: boolean; collateral: boolean; clean: boolean; lgTransfer: boolean }
export function outcomeOf(a: AssayRecord, g: Pick<GenomeRecord, "tau">): Outcome {
  const improves = a.dev.map((d, i) => d > g.tau[i]), harms = a.dev.map((d, i) => d < -g.tau[i]);
  const improvesAny = improves.some(Boolean), harmAny = harms.some(Boolean);
  return {
    viable: a.sums.every((s) => s >= ASSAY.viableFloor * ASSAY.seeds.length),
    improves, harms, improvesAny, collateral: improvesAny && harmAny, clean: improvesAny && !harmAny,
    lgTransfer: improves[EP.lg] && improves[EP.dt],
  };
}

// ---- Study ------------------------------------------------------------------------------------------------

interface Prepared { rec: GenomeRecord; start: StartGenome; nb: Neighbourhood; base: Probe; rows: Row[]; strata: Record<string, { population: number; chosen: number }>; generated: Record<string, number>; descs: Descriptor[] }
/** Frozen assay set: per start genome the [edit id, genome hash] pairs, in draw order. */
export type FrozenChoice = Record<string, [string, string][]>;
const canonical2 = (x: unknown): string => JSON.stringify(x);

export const baselineOf = (c: AssayCache, w: Uint32Array, seeds: readonly number[] = ASSAY.seeds): Baseline => ({ lg: responses(c, w, "light-growth", seeds), dp: responses(c, w, "dark-persistence", seeds), dt: responses(c, w, "dim-transfer", seeds) });
const tauOf = (b: Baseline, gen: Baseline): [number, number, number] => [tau(b.lg, gen.lg), tau(b.dp, gen.dp), tau(b.dt, gen.dt)];

export function qualify(b: Baseline): GenomeRecord["qualification"] {
  const minLg = Math.min(...b.lg), minGap = Math.min(...b.lg.map((v, i) => v - b.dp[i]));
  const reasons: string[] = [];
  if (minLg < ASSAY.gate.lightGrowthFloor) reasons.push(`light-growth ${minLg} permille is below the floor ${ASSAY.gate.lightGrowthFloor}`);
  if (minGap < ASSAY.gate.lightOverDarkMargin) reasons.push(`light-growth exceeds dark-persistence by ${minGap} permille, below the margin ${ASSAY.gate.lightOverDarkMargin}`);
  return { pass: reasons.length === 0, minLightGrowth: minLg, minLightOverDark: minGap, reasons };
}

export function record(s: StartGenome, b: Baseline, gen: Baseline, votes: boolean): GenomeRecord {
  return {
    id: s.id, label: s.label, role: s.role, cluster: s.cluster ?? null, hex: wordsHex(s.words), hash: genomeHash(s.words),
    nonzero: nonzeroCounts(s.words), baseline: b, tau: tauOf(b, gen), qualification: qualify(b), votes,
  };
}

/** Edit probes are not cached (each is 420 kB and edits rarely repeat); the base probe is. */
const probeOf = (probes: Map<string, Probe>, hash: string, w: Uint32Array, keep: boolean): Probe => { const p = probes.get(hash); if (p) return p; const q = probeGenome(w); if (keep) probes.set(hash, q); return q; };

function prepare(s: StartGenome, rec: GenomeRecord, alloc: Allocation, cache: AssayCache, probes: Map<string, Probe>, panel: Panel, frozen?: FrozenChoice): Prepared {
  const nb = buildNeighbourhood(s.words, s.id, undefined, panel.nb);
  const base = probeOf(probes, genomeHash(s.words), s.words, true);
  const { chosen, strata, generated } = drawAssaySubset(nb, alloc, panel.nb.salt, excludeSet(panel, s.id));
  const want = frozen?.[s.id];
  if (want && canonical2(want) !== canonical2(chosen.map((i) => [nb.edits[i].id, nb.edits[i].hash]))) throw new Error(`${s.id}: the drawn assay set differs from the frozen one (stopping before any mutant assay)`);
  const chosenSet = new Set(chosen);
  const baseSums: [number, number, number] = [sum(rec.baseline.lg), sum(rec.baseline.dp), sum(rec.baseline.dt)];
  const descs: Descriptor[] = [];
  const rows = nb.edits.map((e, i): Row => {
    const d = describeEdit(e, s.words, nb.words[i], base, probeOf(probes, e.hash, nb.words[i], false));
    descs.push(d);
    let assay: AssayRecord | null = null;
    if (chosenSet.has(i)) {
      const w = nb.words[i];
      const sums = SCENARIO_IDS.map((sc) => sum(responses(cache, w, sc, panel.seeds))) as [number, number, number];
      const r0 = cache.get(w, "light-growth", panel.seeds[0]);
      assay = { sums, dev: sums.map((v, k) => v - baseSums[k]) as [number, number, number], stocks: { B0: r0.B0, B1: r0.B1, P0: r0.P0, P1: r0.P1, E0: r0.E0, E1: r0.E1 } };
    }
    return {
      genome: s.id, id: e.id, family: e.family, kind: e.kind, k: e.k, cls: e.cls,
      slots: e.slots.map((x) => ({ slot: x.slot, locus: x.locus, kind: x.kind, op: x.opDelta, exp: x.expected, before: x.before, after: x.after, applied: x.applied, cls: x.cls })),
      requestedL1: e.requestedL1, realisedL1: e.realisedL1, undoExact: e.undoExact, dupOf: e.dupOf, hash: e.hash,
      expression: d.expression, changed: d.changed, maxDelta: d.maxDelta, breadth: d.breadth, participation: d.participation,
      sensorReach: d.sensorReach, sensorMask: d.sensorMask, structActuators: d.structActuators, structSensors: d.structSensors, withinStructural: withinStructural(d),
      assayed: assay !== null, assay,
    };
  });
  return { rec, start: s, nb, base, rows, strata, generated, descs };
}

/** Breadth of the single-locus w1/b1 edits of a degree-matched null genome, same loci and signs (the neighbourhood is keyed on the real genome id). */
function nullBreadths(s: StartGenome, probes: Map<string, Probe>, panel: Panel): number[] {
  const out: number[] = [];
  for (let r = 0; r < RULE.nullReplicates; r++) {
    const nw = degreeMatchedNull(s.words, strHash(`${panel.nullPrefix}${s.id}:null:${r}`));
    const nb = buildNeighbourhood(nw, s.id, undefined, panel.nb);
    const base = probeGenome(nw);
    nb.edits.forEach((e, i) => {
      if (e.cls !== "genuine" || e.k !== 1 || (e.kind !== "w1" && e.kind !== "b1")) return;
      const p = probeOf(probes, e.hash, nb.words[i], false);
      out.push(describeEdit(e, nw, nb.words[i], base, p).breadth);
    });
  }
  return out;
}

export interface FixtureRow {
  id: string; label: string; builtOn: string; expect: string;
  naive: { bytesChanged: number; weightL1: number };
  functional: { changedOutputs: number; breadth: number; sensorReach: number; maxDelta: number[] };
  /** Paired deviation per endpoint (summed over seeds) and whether every run is byte-identical in B, P, E, A and C. */
  physical: { dev: [number, number, number]; identical: boolean };
  /** True when the fixture is constructed to leave the function unchanged. */
  neutral: boolean;
  passes: boolean;
}

function fixtureRow(id: string, label: string, builtOn: string, expect: string, neutral: boolean, base: Uint32Array, variant: Uint32Array, cache: AssayCache, probes: Map<string, Probe>, seeds: readonly number[] = ASSAY.seeds): FixtureRow {
  const pb = probes.get(genomeHash(base)) ?? (probes.set(genomeHash(base), probeGenome(base)), probes.get(genomeHash(base))!);
  const pv = probes.get(genomeHash(variant)) ?? (probes.set(genomeHash(variant), probeGenome(variant)), probes.get(genomeHash(variant))!);
  const diff = describeProbes(pb, pv);
  let identical = true;
  const dev = SCENARIO_IDS.map((sc) => {
    for (const seed of seeds) {
      const a = cache.get(base, sc, seed), b = cache.get(variant, sc, seed);
      if (a.B1 !== b.B1 || a.P1 !== b.P1 || a.E1 !== b.E1 || a.A1 !== b.A1 || a.C1 !== b.C1) identical = false;
    }
    return sum(responses(cache, variant, sc, seeds)) - sum(responses(cache, base, sc, seeds));
  }) as [number, number, number];
  const passes = neutral ? identical && diff.totalChanged === 0 && dev.every((d) => d === 0) : diff.totalChanged > 0;
  return {
    id, label, builtOn, expect, neutral,
    naive: { bytesChanged: bytesChanged(base, variant), weightL1: weightL1(base, variant) },
    functional: { changedOutputs: diff.totalChanged, breadth: diff.breadth, sensorReach: diff.sensorReach, maxDelta: diff.maxDelta },
    physical: { dev, identical }, passes,
  };
}

export interface SensitivityRecord { edit: string; dev: number; tau: number; passes: boolean }
export interface CandidateRecord { slot: string; cluster: number; id: string; baseline: Baseline; qualification: GenomeRecord["qualification"]; chosen: boolean }

export interface Study {
  /** Absent for the PR136 panel, so its payload is unchanged. */
  panel?: Panel;
  /** Genuine non-duplicate edits per stratum before the eligibility exclusion (only recorded for panels that exclude). */
  generated?: Record<string, Record<string, number>>;
  genomes: GenomeRecord[];
  candidates: CandidateRecord[];
  rows: Row[];
  strata: Record<string, Record<string, { population: number; chosen: number }>>;
  fixtures: FixtureRow[];
  sensitivity: SensitivityRecord;
  nullBreadth: Record<string, { values: number[]; median2: number }>;
  assayRuns: number;
}

export interface StudyOptions { onProgress?: (msg: string) => void; clusters?: typeof SLOTS; panel?: Panel; frozen?: FrozenChoice }

/** Qualification only (baselines, gate, candidate choice): no neighbourhood, probe or mutant assay. */
export function qualifyStarts(panel: Panel, cache: AssayCache, say: (m: string) => void = () => {}, clustersOverride?: typeof SLOTS) {
  const gen = generalistStart();
  const genBase = baselineOf(cache, gen.words, panel.seeds);
  say(`generalist baseline ${JSON.stringify(genBase)}`);
  const genRec = record(gen, genBase, genBase, false);
  const genomes: GenomeRecord[] = [genRec];
  const candidates: CandidateRecord[] = [];
  const chosenStarts: StartGenome[] = [];
  for (const { slot, clusters } of clustersOverride ?? panel.slots) {
    let picked = false;
    for (const cluster of clusters) {
      const s = m3Start(cluster, slot === "sparse" ? "m3-sparse" : "m3-dense");
      const b = baselineOf(cache, s.words, panel.seeds);
      const q = qualify(b);
      const take = q.pass && !picked;
      candidates.push({ slot, cluster, id: s.id, baseline: b, qualification: q, chosen: take });
      say(`candidate ${s.id} (${slot}) ${q.pass ? "passes" : "fails: " + q.reasons.join("; ")}${take ? " -> used" : ""}`);
      if (take) { picked = true; chosenStarts.push(s); genomes.push(record(s, b, genBase, true)); break; }
    }
  }
  return { gen, genBase, genRec, genomes, candidates, chosenStarts };
}

/** The whole deterministic study: qualification, neighbourhoods, probes, assays, fixtures, sensitivity check. */
export function runStudy(opts: StudyOptions = {}): Study {
  const say = opts.onProgress ?? (() => {});
  const panel = opts.panel ?? PANEL_V1;
  const cache = new AssayCache();
  const probes = new Map<string, Probe>();
  const { gen, genBase, genRec, genomes, candidates, chosenStarts } = qualifyStarts(panel, cache, say, opts.clusters);
  const rows: Row[] = [];
  const strata: Study["strata"] = {};
  const nullBreadth: Study["nullBreadth"] = {};
  const generated: NonNullable<Study["generated"]> = {};
  const prepared: Prepared[] = [];
  for (const [s, rec] of [[gen, genRec] as const, ...chosenStarts.map((s) => [s, genomes.find((g) => g.id === s.id)!] as const)]) {
    say(`neighbourhood and assays: ${s.id}`);
    const p = prepare(s, rec, allocFor(panel, s.id, s.role === "control"), cache, probes, panel, opts.frozen);
    prepared.push(p);
    rows.push(...p.rows);
    strata[s.id] = p.strata;
    generated[s.id] = p.generated;
    const v = nullBreadths(s, probes, panel);
    nullBreadth[s.id] = { values: v, median2: median2(v) };
  }
  // Fixtures: engineered controllers with known history, never in any rate.
  say("fixtures");
  const fixtures: FixtureRow[] = [];
  const gw = gen.words;
  fixtures.push(fixtureRow("generalist-hidden-permutation", "Swap hidden units 0 and 1 of the generalist", GENERALIST_ID, "same function, many bytes differ", true, gw, permuteHidden(gw, 0, 1), cache, probes, panel.seeds));
  const dead = deadHidden(gw)[0];
  const deadEdit = (() => { const wb = weightsOf(gw); wb[0 * NN_H + dead] = 24; return withWeights(gw, wb); })();
  fixtures.push(fixtureRow("generalist-dead-hidden-edit", `Set an input weight of dead hidden unit ${dead} (its W2 row is all zero)`, GENERALIST_ID, "a nonzero byte edit with zero function change", true, gw, deadEdit, cache, probes, panel.seeds));
  const clamp = buildClampEdit(gw);
  fixtures.push(fixtureRow("generalist-clamp-edit", "Push the energy-per-biomass weight (+127) a further +24 with the real operator", GENERALIST_ID, "an edit is minted, the genome is unchanged", true, gw, clamp, cache, probes, panel.seeds));
  fixtures.push(fixtureRow("generalist-shuffled-sensor-labels", "Swap the W1 rows of the polymer (P) and light sensors", GENERALIST_ID, "a different controller (negative fixture, not an ecological intervention)", false, gw, permuteSensors(gw, 3, 5), cache, probes, panel.seeds));
  fixtures.push(fixtureRow("generalist-localised-edit", "w2 h1->photo lowered by 24 (the documented photosynthesis weight)", GENERALIST_ID, "moves photosynthesis only, within the light sensor's reach", false, gw, localised(gw), cache, probes, panel.seeds));
  for (const p of prepared) {
    if (p.rec.role === "control") continue;
    const pair = widestPermutation(p.start.words);
    if (pair) fixtures.push(fixtureRow(`${p.rec.id}-hidden-permutation`, `Swap hidden units ${pair[0]} and ${pair[1]} of ${p.rec.label}`, p.rec.id, "same function, many bytes differ", true, p.start.words, permuteHidden(p.start.words, pair[0], pair[1]), cache, probes, panel.seeds));
  }
  // Sensitivity: zeroing w2 h1->photo on the generalist must remove light growth by more than tau.
  const zeroed = zeroSlot(gw, GENERALIST_ROLES.photoFromH1);
  const dev = sum(responses(cache, zeroed, "light-growth", panel.seeds)) - sum(genBase.lg);
  const sensitivity: SensitivityRecord = { edit: "generalist: zero w2 h1->photo", dev, tau: genRec.tau[EP.lg], passes: dev < -genRec.tau[EP.lg] };
  return { ...(panel.id === PANEL_V1.id ? {} : { panel, generated }), genomes, candidates, rows, strata, fixtures, sensitivity, nullBreadth, assayRuns: cache.runs };
}

function buildClampEdit(w: Uint32Array): Uint32Array { const x = w.slice(); applyOperator(x, GENERALIST_ROLES.epbToH0, 24); return x; }
function localised(w: Uint32Array): Uint32Array { const x = w.slice(); applyOperator(x, GENERALIST_ROLES.photoFromH1, -24); return x; }

// ---- Readouts ---------------------------------------------------------------------------------------------

export interface Tally {
  edits: number; genuine: number; unchanged: number; boundaryClamped: number;
  probeSilent: number; controller: number; physics: number;
  undoExactOfGenuine: number;
  assayedGenuine: number; viable: number; improving: number; collateral: number; clean: number; lgImproving: number; lgTransfer: number;
  /** Mean-free integer summaries over genuine controller edits. */
  breadthSum: number; sensorReachSum: number; controllerGenuine: number;
}
const zero = (): Tally => ({ edits: 0, genuine: 0, unchanged: 0, boundaryClamped: 0, probeSilent: 0, controller: 0, physics: 0, undoExactOfGenuine: 0, assayedGenuine: 0, viable: 0, improving: 0, collateral: 0, clean: 0, lgImproving: 0, lgTransfer: 0, breadthSum: 0, sensorReachSum: 0, controllerGenuine: 0 });

export function tally(rows: readonly Row[], g: Pick<GenomeRecord, "tau">): Tally {
  const t = zero();
  for (const r of rows) {
    t.edits++;
    if (r.cls === "unchanged") t.unchanged++;
    else if (r.cls === "boundary-clamped") t.boundaryClamped++;
    else {
      t.genuine++;
      if (r.undoExact) t.undoExactOfGenuine++;
      if (r.expression === "probe-silent") t.probeSilent++;
      else if (r.expression === "controller") { t.controller++; t.controllerGenuine++; t.breadthSum += r.breadth; t.sensorReachSum += r.sensorReach; }
      else t.physics++;
    }
    if (r.assay && r.cls === "genuine") {
      const o = outcomeOf(r.assay, g);
      t.assayedGenuine++;
      if (o.viable) t.viable++;
      if (o.improvesAny) t.improving++;
      if (o.collateral) t.collateral++;
      if (o.clean) t.clean++;
      if (o.improves[EP.lg]) t.lgImproving++;
      if (o.lgTransfer) t.lgTransfer++;
    }
  }
  return t;
}

/** Inverse-probability-weighted estimate, in permille of the genuine neighbourhood, of the edits with `pred`, from the stratified draw. */
export function ipwPermille(rows: readonly Row[], strata: Record<string, { population: number; chosen: number }>, pred: (r: Row) => boolean): number | null {
  let num = 0n, den = 0n, lcm = 1n;
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  const keys = Object.keys(strata).filter((k) => strata[k].chosen > 0);
  for (const k of keys) { const n = BigInt(strata[k].chosen); lcm = (lcm * n) / gcd(lcm, n); }
  for (const k of keys) {
    const st = strata[k];
    let a = 0;
    for (const r of rows) if (r.assay && r.cls === "genuine" && strataKey(r as unknown as Edit) === k && pred(r)) a++;
    num += (BigInt(st.population) * BigInt(a) * lcm) / BigInt(st.chosen);
    den += BigInt(st.population);
  }
  return den === 0n ? null : Number((1000n * num) / (den * lcm));
}

export interface GenomeReadout {
  genome: string;
  overall: Tally;
  byKind: Record<string, Tally>;
  byFamily: Record<string, Tally>;
  ipw: { viablePermille: number | null; improvingPermille: number | null };
  medianBreadth2: number;
  nullMedian2: number;
  /** Clean share (permille of assayed genuine) for multi-locus matched-magnitude edits and for single-locus controller edits of magnitude 24. */
  multiClean: { clean: number; n: number };
  singleClean: { clean: number; n: number };
}

export function readoutFor(g: GenomeRecord, rows: readonly Row[], strata: Record<string, { population: number; chosen: number }>, nullM2: number): GenomeReadout {
  const mine = rows.filter((r) => r.genome === g.id);
  const group = (key: (r: Row) => string) => {
    const out: Record<string, Tally> = {};
    for (const k of [...new Set(mine.map(key))].sort()) out[k] = tally(mine.filter((r) => key(r) === k), g);
    return out;
  };
  const wb = mine.filter((r) => r.cls === "genuine" && r.k === 1 && (r.kind === "w1" || r.kind === "b1") && r.expression !== "physics");
  const cleanOf = (rs: Row[]) => rs.filter((r) => r.assay && outcomeOf(r.assay, g).clean).length;
  const multi = mine.filter((r) => r.assay && r.cls === "genuine" && (r.family === "multi2" || r.family === "multi4"));
  const single = mine.filter((r) => r.assay && r.cls === "genuine" && r.family === "single24" && ["w1", "b1", "w2", "b2"].includes(r.kind));
  return {
    genome: g.id,
    overall: tally(mine, g),
    byKind: group((r) => r.kind),
    byFamily: group((r) => r.family),
    ipw: { viablePermille: ipwPermille(mine, strata, (r) => outcomeOf(r.assay!, g).viable), improvingPermille: ipwPermille(mine, strata, (r) => outcomeOf(r.assay!, g).improvesAny) },
    medianBreadth2: median2(wb.map((r) => r.breadth)),
    nullMedian2: nullM2,
    multiClean: { clean: cleanOf(multi), n: multi.length },
    singleClean: { clean: cleanOf(single), n: single.length },
  };
}

// ---- Decision rule ----------------------------------------------------------------------------------------

export type VerdictKind = "measurement-limited" | "inconclusive" | "broadly-useful" | "entanglement-signal";
export interface GenomeVerdictInputs { genome: string; assayedGenuine: number; A: number; C: number; K: number; underpowered: boolean; medianBreadth2: number; nullMedian2: number; multiClean: { clean: number; n: number }; singleClean: { clean: number; n: number } }
export interface Verdict { kind: VerdictKind; singleGenome: boolean; reasons: string[]; inputs: GenomeVerdictInputs[]; rule: typeof RULE }

export function decide(args: { voters: GenomeVerdictInputs[]; sensitivityOk: boolean; neutralOk: boolean; slotsFilled: number }): Verdict {
  const { voters, sensitivityOk, neutralOk } = args;
  const base = { inputs: voters, rule: RULE, singleGenome: voters.length === 1 };
  if (!neutralOk) return { ...base, kind: "measurement-limited", reasons: ["a neutral control gave a nonzero paired deviation (a bug, not noise)"] };
  if (!sensitivityOk) return { ...base, kind: "measurement-limited", reasons: ["the known-perturbation sensitivity check failed"] };
  if (voters.length === 0) return { ...base, kind: "measurement-limited", reasons: ["no M3 genome passed the viability gate"] };
  const reasons: string[] = [];
  if (voters.length === 1) reasons.push("only one M3 genome qualified: a single-genome result cannot be better than inconclusive");
  const under = voters.filter((v) => v.underpowered);
  if (under.length) return { ...base, kind: "inconclusive", reasons: [...reasons, ...under.map((v) => `${v.genome}: ${v.A} improving edits is below ${RULE.minImproving}, so no collateral or useful-neighbourhood statement is made`)] };
  const R = RULE;
  const broadly = voters.every((v) => {
    const mc = v.multiClean, sc = v.singleClean;
    const multiOk = mc.n > 0 && sc.n > 0 && Math.floor((1000 * mc.clean) / mc.n) >= Math.floor((1000 * sc.clean) / sc.n) - R.broadlyUseful.multiAllowedDeficitPermille;
    return 1000 * v.K >= R.broadlyUseful.cleanOfImprovingPermille * v.A && 1000 * v.K >= R.broadlyUseful.cleanOfAssayedGenuinePermille * v.assayedGenuine && multiOk;
  });
  const entangled = voters.every((v) => 1000 * v.C >= R.entanglement.collateralOfImprovingPermille * v.A && v.medianBreadth2 >= 2 * R.entanglement.minMedianBreadthActuators && v.medianBreadth2 >= v.nullMedian2 + 2 * R.entanglement.minExcessOverNullActuators);
  if (voters.length === 1) return { ...base, kind: "inconclusive", reasons: [...reasons, `single-genome: broadly-useful would be ${broadly}, entanglement-signal would be ${entangled}; neither is claimed`] };
  if (broadly && !entangled) return { ...base, kind: "broadly-useful", reasons: ["both qualifying M3 genomes meet the broadly-useful rule"] };
  if (entangled && !broadly) return { ...base, kind: "entanglement-signal", reasons: ["both qualifying M3 genomes meet the entanglement rule"] };
  return { ...base, kind: "inconclusive", reasons: [broadly && entangled ? "both rules are met at once (a 50/50 split), which the rule does not call" : "the two genomes disagree or neither rule is met on both"] };
}

// ---- Payload ----------------------------------------------------------------------------------------------

export interface Payload {
  kind: "controller-locality-evidence";
  version: number;
  statements: string[];
  protocol: Record<string, unknown>;
  grid: { points: number; actuators: number; outputValues: number; sensors: number };
  genomes: GenomeRecord[];
  candidates: CandidateRecord[];
  strata: Study["strata"];
  rows: Row[];
  fixtures: FixtureRow[];
  sensitivity: SensitivityRecord;
  nullBreadth: Study["nullBreadth"];
  neutralControlsOk: boolean;
  readouts: GenomeReadout[];
  verdict: Verdict;
  /** Present for panels other than PR136's: the panel record, eligibility lists included. */
  panel?: Panel;
  /** Present with `panel`: genuine non-duplicate edits per stratum before exclusion (population in `strata` is the eligible count). */
  generated?: Record<string, Record<string, number>>;
  freezeSha256?: string;
  integritySha256?: string;
}

export const STATEMENTS = [
  "CPU only: deterministic integer reference simulator and controller probe. No GPU evidence.",
  "Exploratory. Nothing here is a confirmation, and no score selected anything that is reported as independent evidence.",
  "Bounded to these start genomes, this one-step operator, this probe grid and these three short tiny-world biomass-response scenarios.",
  "The unit is the edit within a genome. Counts and denominators describe the sampled neighbourhood, not a population of genomes.",
  "The three scenarios score environmental biomass responses, not independent capabilities, and not survival, regeneration or ecological fitness.",
] as const;

export function assertIntegers(x: unknown, path = "$"): void {
  if (typeof x === "number" && !Number.isInteger(x)) throw new Error(`non-integer number at ${path}: ${x}`);
  if (Array.isArray(x)) x.forEach((v, i) => assertIntegers(v, `${path}[${i}]`));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) assertIntegers(v, `${path}.${k}`);
}

const TAU_TEXT = "max(ceil(5% of the genome's own baseline sum), 3 x seeds x the larger cross-seed spread of the genome's or the generalist's baseline); baselines only";
export const protocolRecord = (panel: Panel = PANEL_V1): Record<string, unknown> => {
  const descriptors = { breadthFloorPermille: BREADTH_FLOOR_PERMILLE, participationDelta: PARTICIPATION_DELTA };
  if (panel.id === PANEL_V1.id) return { neighbourhood: NEIGHBOURHOOD, assay: ASSAY, allocationM3: ALLOC_M3, allocationControl: ALLOC_CONTROL, slots: SLOTS, rule: RULE, descriptors, tau: TAU_TEXT };
  return {
    panel: panel.id,
    neighbourhood: { ...NEIGHBOURHOOD, salt: panel.nb.salt, singleSlots: panel.nb.singleSlots, drawsPerMulti: panel.nb.drawsPerMulti, multiEqualCount: panel.nb.secondary ? NEIGHBOURHOOD.multiEqualCount : [] },
    assay: { ...ASSAY, seeds: panel.seeds }, allocationByGenome: panel.allocByGenome ?? {}, allocationControl: panel.allocControl, slots: panel.slots, nullPrefix: panel.nullPrefix, rule: RULE, descriptors, tau: TAU_TEXT,
  };
};

export function buildPayload(study: Study): Payload {
  const nullM2 = (id: string) => study.nullBreadth[id]?.median2 ?? 0;
  const readouts = study.genomes.map((g) => readoutFor(g, study.rows, study.strata[g.id] ?? {}, nullM2(g.id)));
  const neutralControlsOk = study.fixtures.filter((f) => f.neutral).every((f) => f.passes);
  const inputs = readouts.filter((r) => study.genomes.find((g) => g.id === r.genome)!.votes).map((r): GenomeVerdictInputs => ({
    genome: r.genome, assayedGenuine: r.overall.assayedGenuine, A: r.overall.improving, C: r.overall.collateral, K: r.overall.clean,
    underpowered: r.overall.improving < RULE.minImproving, medianBreadth2: r.medianBreadth2, nullMedian2: r.nullMedian2, multiClean: r.multiClean, singleClean: r.singleClean,
  }));
  const verdict = decide({ voters: inputs, sensitivityOk: study.sensitivity.passes, neutralOk: neutralControlsOk, slotsFilled: inputs.length });
  const payload: Payload = {
    kind: "controller-locality-evidence",
    version: STUDY_VERSION,
    statements: [...STATEMENTS],
    protocol: protocolRecord(study.panel ?? PANEL_V1),
    grid: { points: GRID_POINTS, actuators: NN_O, outputValues: OUTPUT_VALUES, sensors: NN_I },
    genomes: study.genomes, candidates: study.candidates, strata: study.strata, rows: study.rows, fixtures: study.fixtures,
    sensitivity: study.sensitivity, nullBreadth: study.nullBreadth, neutralControlsOk, readouts, verdict,
    ...(study.panel ? { panel: study.panel, generated: study.generated } : {}),
  };
  assertIntegers(payload);
  return payload;
}

/** Recompute the verdict from the saved rows alone (used by --check and the tests). */
export function verdictFromPayload(p: Payload): Verdict {
  const readouts = p.genomes.map((g) => readoutFor(g, p.rows, p.strata[g.id] ?? {}, p.nullBreadth[g.id]?.median2 ?? 0));
  const inputs = readouts.filter((r) => p.genomes.find((g) => g.id === r.genome)!.votes).map((r): GenomeVerdictInputs => ({
    genome: r.genome, assayedGenuine: r.overall.assayedGenuine, A: r.overall.improving, C: r.overall.collateral, K: r.overall.clean,
    underpowered: r.overall.improving < RULE.minImproving, medianBreadth2: r.medianBreadth2, nullMedian2: r.nullMedian2, multiClean: r.multiClean, singleClean: r.singleClean,
  }));
  return decide({ voters: inputs, sensitivityOk: p.sensitivity.passes, neutralOk: p.fixtures.filter((f) => f.neutral).every((f) => f.passes), slotsFilled: inputs.length });
}

export { popcount };
