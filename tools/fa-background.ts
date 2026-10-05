// Read-only analysis of the A/background-medium search (docs/plan.md, "Ecology-first founder
// discovery"): genetic structure of the 1,476 confirmed genomes and of the 209 obligate ones,
// their evaluations, and a cheap controller probe. CPU only; no GPU, no simulation.
//
//   deno run -A tools/fa-background.ts [--dir runs/bootstrap-medium-background] [--out experiments/foundations/fa-background.json]
//
// Merges a `deepDive` block into the existing fa-background.json and leaves every other key as is.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import {
  CLUSTER_DISTANCE,
  IN,
  ringsOf,
  M3_FOUNDERS,
  NN_H,
  NN_I,
  NN_O,
  OUT,
  B1_OFF,
  B2_OFF,
  W1_OFF,
  W2_OFF,
  clampi,
  divi,
  founderGenome,
  generalistGenome,
  genomeDistance,
  genomeFromHex,
  geneticClusters,
  type Genome,
} from "@bl/schema";

const a = parseArgs(Deno.args, {
  string: ["dir", "out"],
  default: { dir: "runs/bootstrap-medium-background", out: "experiments/foundations/fa-background.json" },
});

type Enc = { mu: number; sigma: number; motGain: number; weights: number[]; rings?: number[] };
type Ev = { survived: number; recovered: number; lightDependent: number; reps: number; individuals: number; meanMass: number; speed: number; mass: number; recovery: number; reproduction: number; regenerated: number };
const toG = (g: Enc): Genome => ({ mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Int8Array.from(g.weights), ...(ringsOf(g) ? { rings: ringsOf(g) } : {}) });
const key = (g: Enc) => JSON.stringify([g.mu, g.sigma, g.motGain, g.weights, ...(ringsOf(g) ? [ringsOf(g)] : [])]);

const confirm = JSON.parse(await Deno.readTextFile(`${a.dir}/confirm.json`));
// confirm.rows holds every screening passer (1,633); `pass` marks the 1,476 confirmed ones.
const rows: { genome: Enc; cluster: number; eval: Ev; regenLowerBound: number; pass: boolean }[] = confirm.rows.filter((r: { pass: boolean }) => r.pass);
const dep: { genome: Enc; survived: number; obligate: boolean; eval: Ev }[] = confirm.dependence.rows;
const bgGenome: Genome = toG({ ...confirm.eval.medium.background, weights: Array.from({ length: 160 }, (_, i) => confirm.eval.medium.background.weights[String(i)] ?? 0) });

// ---------- helpers
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((p, r) => p - r);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const summary = (xs: number[]) => ({ n: xs.length, mean: round(mean(xs)), min: Math.min(...xs), p25: quantile(xs, 0.25), median: quantile(xs, 0.5), p75: quantile(xs, 0.75), max: Math.max(...xs) });
function round(x: number, d = 4) {
  return Number.isFinite(x) ? Number(x.toFixed(d)) : x;
}
const countBy = <T>(xs: T[], f: (x: T) => string | number) => {
  const m: Record<string, number> = {};
  for (const x of xs) m[String(f(x))] = (m[String(f(x))] ?? 0) + 1;
  return m;
};

// ---------- confirmed set: recompute clusters and check against the stored labels
const genomes = rows.map((r) => toG(r.genome));
const recomputed = geneticClusters(genomes, CLUSTER_DISTANCE);
const sameAsStored = recomputed.every((c, i) => c === rows[i].cluster);
const nClusters = new Set(recomputed).size;

const depByKey = new Map(dep.map((d) => [key(d.genome), d]));
const isObligate = rows.map((r) => depByKey.get(key(r.genome))?.obligate ?? false);
const matched = rows.every((r) => depByKey.has(key(r.genome)));
const obIdx = rows.map((_, i) => i).filter((i) => isObligate[i]);
const faIdx = rows.map((_, i) => i).filter((i) => !isObligate[i]);

const distinctGenomes = (idx: number[]) => new Set(idx.map((i) => key(rows[i].genome))).size;

// ---------- clustering among the obligates alone, at several distances
const obGenomes = obIdx.map((i) => genomes[i]);
const obAt = (d: number) => {
  const ids = geneticClusters(obGenomes, d);
  const sizes = Object.values(countBy(ids, (x) => x)).sort((p, r) => r - p);
  return { distance: d, clusters: sizes.length, sizesDesc: sizes.slice(0, 15), singletons: sizes.filter((s) => s === 1).length };
};
const obClusterScan = [0, 1, 2, 5, CLUSTER_DISTANCE, 20, 40, 80].map(obAt);

// ---------- cluster-3 structure (the one that holds most obligates)
const medoid = (idx: number[]) => {
  let best = -1;
  let bestSum = Infinity;
  for (const i of idx) {
    let s = 0;
    for (const j of idx) s += genomeDistance(genomes[i], genomes[j]);
    if (s < bestSum) {
      bestSum = s;
      best = i;
    }
  }
  return best;
};
function structure(idx: number[]) {
  if (idx.length === 0) return null;
  const m = medoid(idx);
  const dm = idx.map((i) => genomeDistance(genomes[i], genomes[m]));
  const nn = idx.map((i) => Math.min(...idx.filter((j) => j !== i).map((j) => genomeDistance(genomes[i], genomes[j]))).valueOf());
  const pair: number[] = [];
  for (let p = 0; p < idx.length; p++) for (let q = p + 1; q < idx.length; q++) pair.push(genomeDistance(genomes[idx[p]], genomes[idx[q]]));
  return {
    n: idx.length,
    distinctGenomes: distinctGenomes(idx),
    medoidRowIndex: m,
    distanceToMedoid: summary(dm),
    withinDistance: { "<=2": dm.filter((d) => d <= 2).length, "<=5": dm.filter((d) => d <= 5).length, "<=10": dm.filter((d) => d <= 10).length, "<=20": dm.filter((d) => d <= 20).length },
    nearestNeighbour: idx.length > 1 ? summary(nn) : null,
    pairwise: pair.length ? summary(pair) : null,
  };
}

// ---------- reference genomes
const generalist = generalistGenome(60, 20);
const founder0 = founderGenome(M3_FOUNDERS[0]);
const refDist = (idx: number[]) => ({
  toBackgroundGenome: summary(idx.map((i) => genomeDistance(genomes[i], bgGenome))),
  toGeneralist: summary(idx.map((i) => genomeDistance(genomes[i], generalist))),
});
const backgroundIsFounder0 = genomeDistance(bgGenome, founder0) === 0;

// ---------- per-cluster table
const clusterIds = [...new Set(recomputed)].sort((p, r) => p - r);
const perCluster = clusterIds.map((c) => {
  const idx = rows.map((_, i) => i).filter((i) => recomputed[i] === c);
  const ob = idx.filter((i) => isObligate[i]);
  const mg = idx.map((i) => genomes[i].motGain);
  return {
    cluster: c,
    n: idx.length,
    obligate: ob.length,
    meanSurvivedDefault: round(mean(idx.map((i) => depByKey.get(key(rows[i].genome))!.survived))),
    distinctGenomes: distinctGenomes(idx),
    motGainPositive: mg.filter((g) => g > 0).length,
    motGainMax: Math.max(...mg),
    nearestToBackground: Math.min(...idx.map((i) => genomeDistance(genomes[i], bgGenome))),
    nearestToGeneralist: Math.min(...idx.map((i) => genomeDistance(genomes[i], generalist))),
    meanRegen: round(mean(idx.map((i) => rows[i].eval.regenerated))),
    meanLightDependent: round(mean(idx.map((i) => rows[i].eval.lightDependent))),
  };
});

// ---------- motGain and Lenia parameters
const binMot = (g: number) => (g === 0 ? "0" : g <= 25 ? "1-25" : g <= 50 ? "26-50" : g <= 100 ? "51-100" : g <= 150 ? "101-150" : "151-255");
const motFor = (idx: number[]) => ({
  n: idx.length,
  zero: idx.filter((i) => genomes[i].motGain === 0).length,
  positive: idx.filter((i) => genomes[i].motGain > 0).length,
  bins: countBy(idx, (i) => binMot(genomes[i].motGain)),
  summary: summary(idx.map((i) => genomes[i].motGain)),
});
const lenia = (idx: number[]) => ({ mu: summary(idx.map((i) => genomes[i].mu)), sigma: summary(idx.map((i) => genomes[i].sigma)) });

// ---------- evaluations (background medium, 16 replicates) for obligate vs facultative
const evalMeans = (idx: number[]) => {
  const f = (k: keyof Ev) => round(mean(idx.map((i) => rows[i].eval[k])), 3);
  return {
    n: idx.length,
    survived: f("survived"),
    recovered: f("recovered"),
    regenerated: f("regenerated"),
    lightDependent: f("lightDependent"),
    recovery: f("recovery"),
    individuals: f("individuals"),
    meanMass: f("meanMass"),
    mass: f("mass"),
    speed: f("speed"),
    reproduction: f("reproduction"),
    regenLowerBoundMean: round(mean(idx.map((i) => rows[i].regenLowerBound)), 3),
    regenLowerBoundAbove08: idx.filter((i) => rows[i].regenLowerBound > 0.8).length,
  };
};
const evalHist = (idx: number[], k: keyof Ev) => countBy(idx, (i) => rows[i].eval[k]);
const c3 = rows.map((_, i) => i).filter((i) => recomputed[i] === Number(Object.entries(countBy(obIdx, (i) => recomputed[i])).sort((p, r) => r[1] - p[1])[0][0]));
const dominantObCluster = Number(Object.entries(countBy(obIdx, (i) => recomputed[i])).sort((p, r) => r[1] - p[1])[0][0]);
const obNotDominant = obIdx.filter((i) => recomputed[i] !== dominantObCluster);
const faNotDominant = faIdx.filter((i) => recomputed[i] !== dominantObCluster);

// ---------- cheap controller probe (no GPU): forward pass of the integer controller on synthetic inputs
function forward(g: Genome, x: number[]): number[] {
  const w = g.weights;
  const h = new Array(NN_H).fill(0);
  for (let j = 0; j < NN_H; j++) {
    let acc = w[B1_OFF + j] * 128;
    for (let k = 0; k < NN_I; k++) acc += w[W1_OFF + k * NN_H + j] * x[k];
    h[j] = clampi(divi(acc, 128), 0, 127);
  }
  const o = new Array(NN_O).fill(0);
  for (let k = 0; k < NN_O; k++) {
    let acc = w[B2_OFF + k] * 128;
    for (let j = 0; j < NN_H; j++) acc += w[W2_OFF + j * NN_O + k] * h[j];
    o[k] = clampi(divi(acc, 128), -127, 127);
  }
  return o;
}
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Synthetic input vectors, fixed seed: uniform over the input ranges, half lit (light 20-110) and half dark. */
const PROBE_N = 2000;
const probes: { x: number[]; lit: boolean }[] = (() => {
  const r = mulberry32(20260930);
  const u = (lo: number, hi: number) => Math.floor(lo + r() * (hi - lo + 1));
  return Array.from({ length: PROBE_N }, (_, n) => {
    const lit = n % 2 === 0;
    const x = new Array(NN_I).fill(0);
    x[IN.A] = u(0, 127);
    x[IN.B] = u(0, 127);
    x[IN.C] = u(0, 127);
    x[IN.P] = u(0, 60);
    x[IN.EPB] = u(0, 127);
    x[IN.LIGHT] = lit ? u(20, 110) : 0;
    x[IN.S] = u(0, 40);
    x[IN.SGX] = u(-30, 30);
    x[IN.SGY] = u(-30, 30);
    x[IN.U] = u(-127, 127);
    return { x, lit };
  });
})();
function probe(g: Genome) {
  let photoLit = 0;
  let nLit = 0;
  let decomp = 0;
  let decompWaste = 0;
  let nWaste = 0;
  let grow = 0;
  let maxPhoto = -127;
  for (const { x, lit } of probes) {
    const o = forward(g, x);
    if (lit) {
      nLit++;
      if (o[OUT.PHOTO] > 0) photoLit++;
      if (o[OUT.PHOTO] > maxPhoto) maxPhoto = o[OUT.PHOTO];
    }
    if (o[OUT.DECOMP] > 0) decomp++;
    if (x[IN.C] >= 64) {
      nWaste++;
      if (o[OUT.DECOMP] > 0) decompWaste++;
    }
    if (o[OUT.GROW] > 0) grow++;
  }
  return { photoLit: photoLit / nLit, maxPhotoLit: maxPhoto, decompShare: decomp / PROBE_N, decompWithWaste: decompWaste / nWaste, growShare: grow / PROBE_N };
}
/** Coarse class from the probe alone: a proxy, not the evaluator's flux-based role. */
const probeClass = (p: ReturnType<typeof probe>) => (p.maxPhotoLit <= 0 ? "no-photo" : p.photoLit >= 0.25 ? "photo-capable" : "photo-rare");

// Validate the probe against the 24 founder-diagnostic subjects whose evaluator roles are recorded.
const subjects: { subject: number; role: string; hex: string }[] = JSON.parse(await Deno.readTextFile("runs/foundations/results/fd-subjects.json")).subjects;
const validation = subjects.map((s) => {
  const p = probe(genomeFromHex(s.hex));
  return { subject: s.subject, evaluatorRole: s.role, probeClass: probeClass(p), photoLit: round(p.photoLit, 3), maxPhotoLit: p.maxPhotoLit, growShare: round(p.growShare, 3), decompWithWaste: round(p.decompWithWaste, 3) };
});
const validationTable = countBy(validation, (v) => `${v.evaluatorRole} / ${v.probeClass}`);
const validationByRole = Object.fromEntries([...new Set(validation.map((v) => v.evaluatorRole))].map((role) => [role, { n: validation.filter((v) => v.evaluatorRole === role).length, growShare: summary(validation.filter((v) => v.evaluatorRole === role).map((v) => v.growShare)), decompWithWaste: summary(validation.filter((v) => v.evaluatorRole === role).map((v) => v.decompWithWaste)), maxPhotoLit: summary(validation.filter((v) => v.evaluatorRole === role).map((v) => v.maxPhotoLit)) }]));
const probes_ = rows.map((r) => probe(toG(r.genome)));
const classes = probes_.map(probeClass);
const probeSummary = (idx: number[]) => ({
  n: idx.length,
  classes: countBy(idx, (i) => classes[i]),
  photoLit: summary(idx.map((i) => round(probes_[i].photoLit, 3))),
  decompWithWaste: summary(idx.map((i) => round(probes_[i].decompWithWaste, 3))),
  growShare: summary(idx.map((i) => round(probes_[i].growShare, 3))),
});

const invSimpson = (sizes: number[]) => {
  const t = sizes.reduce((p, q) => p + q, 0);
  return round(1 / sizes.reduce((acc, z) => acc + (z / t) ** 2, 0), 2);
};
const obSizes = Object.values(countBy(obIdx, (i) => recomputed[i]));
const allSizes = Object.values(countBy(recomputed, (x) => x));

// ---------- assemble
const deepDive = {
  note: "exploratory; read-only CPU analysis of confirm.json (no GPU, no simulation). Evaluator roles were not recorded for this search; probe* fields are a weights-only proxy, not roles.",
  script: "tools/fa-background.ts",
  clusterDistance: CLUSTER_DISTANCE,
  confirmed: {
    n: rows.length,
    distinctGenomes: distinctGenomes(rows.map((_, i) => i)),
    clusters: nClusters,
    clustersMatchStored: sameAsStored,
    dependenceRowsAllMatched: matched,
    clusterSizesDesc: Object.values(countBy(recomputed, (x) => x)).sort((p, r) => r - p),
    singletonClusters: Object.values(countBy(recomputed, (x) => x)).filter((s) => s === 1).length,
    referenceDistances: refDist(rows.map((_, i) => i)),
    backgroundGenomeIsFounder0: backgroundIsFounder0,
    motGain: motFor(rows.map((_, i) => i)),
  },
  obligate: {
    n: obIdx.length,
    distinctGenomes: distinctGenomes(obIdx),
    clustersInConfirmedPartition: new Set(obIdx.map((i) => recomputed[i])).size,
    byConfirmedCluster: countBy(obIdx, (i) => recomputed[i]),
    clusteringAmongObligatesAlone: obClusterScan,
    effectiveClusters: { obligateInverseSimpson: invSimpson(obSizes), confirmedInverseSimpson: invSimpson(allSizes) },
    dominantCluster: dominantObCluster,
    dominantClusterShare: round(obIdx.filter((i) => recomputed[i] === dominantObCluster).length / obIdx.length),
    obligatesOutsideDominantCluster: obNotDominant.length,
    structureAll: structure(obIdx),
    structureDominantCluster: structure(obIdx.filter((i) => recomputed[i] === dominantObCluster)),
    structureOutsideDominant: structure(obNotDominant),
    referenceDistances: refDist(obIdx),
    referenceDistancesOutsideDominant: obNotDominant.length ? refDist(obNotDominant) : null,
    motGain: motFor(obIdx),
    motGainOutsideDominant: motFor(obNotDominant),
    lenia: lenia(obIdx),
    leniaFacultative: lenia(faIdx),
  },
  facultative: { n: faIdx.length, motGain: motFor(faIdx) },
  motGainAllClusters: {
    clustersWithAnyMotGainPositive: perCluster.filter((c) => c.motGainPositive > 0).length,
  },
  evaluationsInBackgroundMedium: {
    obligate: evalMeans(obIdx),
    facultative: evalMeans(faIdx),
    obligateOutsideDominantCluster: evalMeans(obNotDominant),
    facultativeOutsideDominantCluster: evalMeans(faNotDominant),
    dominantClusterOnly: evalMeans(c3),
    regeneratedHistogram: { obligate: evalHist(obIdx, "regenerated"), facultative: evalHist(faIdx, "regenerated") },
    lightDependentHistogram: { obligate: evalHist(obIdx, "lightDependent"), facultative: evalHist(faIdx, "lightDependent") },
    survivedHistogram: { obligate: evalHist(obIdx, "survived"), facultative: evalHist(faIdx, "survived") },
    underDefaultEval: { obligateSurvivedAll0: obIdx.every((i) => depByKey.get(key(rows[i].genome))!.survived === 0), facultativeSurvivedHistogram: countBy(faIdx, (i) => depByKey.get(key(rows[i].genome))!.survived) },
  },
  perCluster,
  controllerProbe: {
    note: `${PROBE_N} synthetic input vectors (seed 20260930), uniform over input ranges, half lit; forward pass of the integer controller, no simulation. Classes: no-photo = PHOTO output never positive in any lit probe; photo-capable = positive in >=25% of lit probes; photo-rare otherwise. A weights-only proxy: real inputs are correlated and it ignores dynamics.`,
    validationOnFounderDiagnosticSubjects: { table: validationTable, byRole: validationByRole, rows: validation },
    obligate: probeSummary(obIdx),
    facultative: probeSummary(faIdx),
    obligateOutsideDominantCluster: probeSummary(obNotDominant),
    dominantCluster: probeSummary(c3),
    perClusterObligate: Object.fromEntries(clusterIds.filter((c) => obIdx.some((i) => recomputed[i] === c)).map((c) => [c, probeSummary(obIdx.filter((i) => recomputed[i] === c))])),
  },
};

const existing = JSON.parse(await Deno.readTextFile(a.out));
await Deno.writeTextFile(a.out, JSON.stringify({ ...existing, deepDive }, null, 1) + "\n");
console.log(JSON.stringify({ clusters: nClusters, sameAsStored, obligate: obIdx.length, distinctOb: deepDive.obligate.distinctGenomes, matched }, null, 1));
