// Pure planning and reading logic for tools/obligates-x.ts (obligate characterisation, docs/plan.md
// "Obligate characterisation (fixed 2026-09-30, before any result)"). No GPU, no I/O: subject choice
// from the background-medium confirmation, and the pre-stated readings applied to evaluation cells.
import { genomeDistance, type Genome } from "@bl/schema";

export type Group = "obligate" | "obligate-extra" | "nonobligate-cluster" | "facultative-sibling" | "producer0" | "producer2" | "null";
export type MediumId = "standard" | "waste" | "bg0" | "bg2" | "x4";
export const MEDIA: readonly MediumId[] = ["standard", "waste", "bg0", "bg2", "x4"];

/** Seeds reserved per medium: batch b of medium k runs at seed + SEED_STRIDE k + b. */
export const SEED_STRIDE = 20;
/** Throws when a medium needs more batches than its seed block holds (batch SEED_STRIDE would reuse the next medium's first seed). */
export function checkSeedCapacity(batches: number, reps: number): void {
  if (batches > SEED_STRIDE) throw new Error(`--reps ${reps} needs ${batches} batches per medium, but only ${SEED_STRIDE} seeds are reserved per medium; batches would reuse another medium's seeds`);
}

export interface Subject {
  id: string;
  group: Group;
  /** Cluster label in the background pool (null for the reference genomes). */
  cluster: number | null;
  genome: Genome;
}

export interface Role4 {
  photo: number;
  grow: number;
  decomp: number;
  resp: number;
}

/** One genome in one medium: Evaluation fields plus the role read-out. */
export interface Cell {
  survived: number;
  reps: number;
  recovered: number;
  lightDependent: number;
  regenerated: number;
  recovery: number;
  individuals: number;
  meanMass: number;
  speed: number;
  mass: number;
  reproduction: number;
  role?: string;
  roleSums?: Role4;
  roleSumsOther?: Role4;
  otherMass?: number;
}

/** Fixed thresholds (fractions of reps): 12/16 = 6/8 viable, 2/16 = 1/8 dead, 8/16 rescued. */
export const VIABLE = 0.75;
export const DEAD = 0.125;
export const RESCUE = 0.5;
/** Decomposer-type: decomposition share of (photo + grow + decomp) at least this. */
export const DECOMP_SHARE = 0.25;
/** Producer mass beside a candidate relative to beside the null candidate. */
export const PRODUCER_DOWN = 0.7;
export const PRODUCER_UP = 1.3;

export type Status = "viable" | "dead" | "marginal";
export const status = (c: Cell): Status => {
  const f = c.survived / c.reps;
  return f >= VIABLE ? "viable" : f <= DEAD ? "dead" : "marginal";
};

/** Index (into `idx`) of the member with the smallest summed distance to the others; ties go to the lowest index. */
export function medoid(genomes: Genome[], idx: number[]): number {
  const sums = idx.map((i) => idx.reduce((s, j) => s + genomeDistance(genomes[i], genomes[j]), 0));
  return idx[sums.indexOf(Math.min(...sums))];
}

export interface PoolRow {
  genome: Genome;
  cluster: number;
  obligate: boolean;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const uniq = <T>(xs: T[]) => [...new Set(xs)];

/**
 * One subject per cluster as the medoid of the right members:
 *  - obligate: medoid of the obligate members of each cluster that has any (12)
 *  - obligate-extra: in the cluster holding most obligates, the obligate member farthest from the medoid and the one at the median distance (its mutant cloud, not independent)
 *  - nonobligate-cluster: medoid of every cluster with no obligate member (21)
 *  - facultative-sibling: medoid of the non-obligate members of each mixed cluster (10; clusters of only obligates have none)
 */
export function pickSubjects(pool: PoolRow[]): Subject[] {
  const genomes = pool.map((r) => r.genome);
  const clusters = uniq(pool.map((r) => r.cluster)).sort((a, b) => a - b);
  const members = (c: number, f: (r: PoolRow) => boolean) => range(pool.length).filter((i) => pool[i].cluster === c && f(pool[i]));
  const ob = (c: number) => members(c, (r) => r.obligate);
  const non = (c: number) => members(c, (r) => !r.obligate);
  const mk = (group: Group, c: number, i: number): Subject => ({ id: `${group}:c${c}`, group, cluster: c, genome: genomes[i] });
  const obClusters = clusters.filter((c) => ob(c).length > 0);
  const obligate = obClusters.map((c) => mk("obligate", c, medoid(genomes, ob(c))));
  const dominant = obClusters.reduce((best, c) => (ob(c).length > ob(best).length ? c : best), obClusters[0]);
  const m = medoid(genomes, ob(dominant));
  const byDist = ob(dominant)
    .filter((i) => i !== m)
    .map((i) => ({ i, d: genomeDistance(genomes[i], genomes[m]) }))
    .sort((a, b) => a.d - b.d || a.i - b.i);
  const extras = byDist.length >= 2 ? uniq([byDist[byDist.length - 1], byDist[Math.floor((byDist.length - 1) / 2)]].map((x) => x.i)) : byDist.map((x) => x.i);
  const obligateExtra = extras.map((i, k) => ({ id: `obligate-extra:c${dominant}:${k === 0 ? "farthest" : "median"}`, group: "obligate-extra" as const, cluster: dominant, genome: genomes[i] }));
  const nonobligate = clusters.filter((c) => ob(c).length === 0).map((c) => mk("nonobligate-cluster", c, medoid(genomes, non(c))));
  const sibling = obClusters.filter((c) => non(c).length > 0).map((c) => mk("facultative-sibling", c, medoid(genomes, non(c))));
  return [...obligate, ...obligateExtra, ...nonobligate, ...sibling];
}

/** Index of the genome farthest (in slots) from `from`; ties to the lowest index. */
export const farthest = (from: Genome, genomes: Genome[]): number => {
  const d = genomes.map((g) => genomeDistance(from, g));
  return d.indexOf(Math.max(...d));
};

/** Deterministic interleave of the subject list across groups, so no batch is all one group. */
export function interleave<T extends { group: string }>(xs: T[]): T[] {
  const groups = uniq(xs.map((x) => x.group));
  const lists = groups.map((g) => xs.filter((x) => x.group === g));
  return range(Math.max(...lists.map((l) => l.length))).flatMap((k) => lists.flatMap((l) => (k < l.length ? [l[k]] : [])));
}

/** Two-sided Fisher exact p for [[a, b], [c, d]] (sum of tables no more likely than the observed). */
export function fisherTwoSided(a: number, b: number, c: number, d: number): number {
  const lf = (n: number) => range(n).reduce((s, i) => s + Math.log(i + 1), 0);
  const [r1, r2, c1, n] = [a + b, c + d, a + c, a + b + c + d];
  const lc = (nn: number, k: number) => lf(nn) - lf(k) - lf(nn - k);
  const pr = (x: number) => Math.exp(lc(r1, x) + lc(r2, c1 - x) - lc(n, c1));
  const lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1);
  const p0 = pr(a);
  return Math.min(1, range(hi - lo + 1).map((k) => pr(lo + k)).filter((q) => q <= p0 * (1 + 1e-9)).reduce((s, q) => s + q, 0));
}

export const shares = (r: Role4 | undefined) => {
  const t = r ? r.photo + r.grow + r.decomp : 0;
  return t > 0 ? { photo: r!.photo / t, grow: r!.grow / t, decomp: r!.decomp / t } : { photo: 0, grow: 0, decomp: 0 };
};

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const count = <T>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [f(x)]: (m[f(x)] ?? 0) + 1 }), {});

export type Cells = Record<string, Partial<Record<MediumId, Cell>>>;

/** Applies the pre-stated readings (docs/plan.md, "Obligate characterisation") to the evaluated cells. */
export function readOut(subjects: Subject[], cells: Cells) {
  const st = (s: Subject, m: MediumId) => (cells[s.id]?.[m] ? status(cells[s.id][m]!) : undefined);
  const of = (g: Group) => subjects.filter((s) => s.group === g);
  const confirmed = (s: Subject) => st(s, "standard") === "dead" && st(s, "bg0") === "viable";

  // 1. Does obligation reproduce on fresh seeds?
  const obl = of("obligate");
  const nConfirmed = obl.filter(confirmed).length;
  const replication = {
    confirmed: nConfirmed,
    of: obl.length,
    verdict: nConfirmed >= 10 ? "reproduces" : nConfirmed >= 6 ? "partial" : "does-not-reproduce",
    perCluster: obl.map((s) => ({ cluster: s.cluster, standard: cells[s.id]?.standard?.survived, bg0: cells[s.id]?.bg0?.survived, confirmed: confirmed(s) })),
  };

  // 2. The dominant cluster's representatives against the stage-1 success and kill rules.
  const c3 = [...of("obligate").filter((s) => s.cluster === of("obligate-extra")[0]?.cluster), ...of("obligate-extra")];
  const x4 = (s: Subject) => cells[s.id]?.x4;
  const medoidC3 = c3[0];
  const rescued = (s: Subject) => !!x4(s) && x4(s)!.survived / x4(s)!.reps >= RESCUE;
  const otherProducer = (s: Subject) => st(s, "bg2") === "viable" || st(s, "waste") === "viable";
  const dominantCluster = {
    cluster: medoidC3?.cluster ?? null,
    members: c3.map((s) => ({ id: s.id, confirmed: confirmed(s), bg2: cells[s.id]?.bg2?.survived, waste: cells[s.id]?.waste?.survived, x4: x4(s)?.survived, standard: cells[s.id]?.standard?.survived })),
    verdict: !medoidC3 ? "none" : rescued(medoidC3) ? "density-rescues (kill)" : c3.every((s) => confirmed(s) && otherProducer(s) && !rescued(s)) ? "stage-1-success" : "mixed",
  };

  // 3. Per obligate representative: what its dependence is on.
  const dependence = obl.map((s) => ({
    cluster: s.cluster,
    confirmed: confirmed(s),
    bg0: st(s, "bg0"),
    bg2: st(s, "bg2"),
    waste: st(s, "waste"),
    standard: st(s, "standard"),
    x4Survived: x4(s)?.survived,
    cls: !confirmed(s) ? "not-reproduced" : st(s, "bg0") === "viable" && st(s, "bg2") === "viable" ? "producer-general" : st(s, "bg2") === "viable" ? "producer-2-only" : "producer-0-only",
    densityRescued: rescued(s),
  }));
  const dependenceCounts = count(dependence, (d) => d.cls);
  // Obligate representatives the confirmed-obligate rule cannot see: dead alone, not viable beside producer 0, viable beside producer 2.
  const bg2OnlyUnconfirmed = obl.filter((s) => st(s, "standard") === "dead" && st(s, "bg0") !== "viable" && st(s, "bg2") === "viable").map((s) => s.cluster);

  // 4. Trophic distinctness in the producer background (read-out only; never a score).
  const roleIn = (s: Subject, m: MediumId) => cells[s.id]?.[m]?.role;
  const confObl = obl.filter(confirmed);
  const non = of("nonobligate-cluster").filter((s) => st(s, "bg0") === "viable");
  const roleTable = (xs: Subject[]) => count(xs, (s) => roleIn(s, "bg0") ?? "none");
  const isPhoto = (s: Subject) => roleIn(s, "bg0") === "phototroph";
  const a = confObl.filter((s) => !isPhoto(s)).length, b = confObl.length - a;
  const c = non.filter((s) => !isPhoto(s)).length, d = non.length - c;
  const medShare = (xs: Subject[], k: "photo" | "grow" | "decomp") => median(xs.map((s) => shares(cells[s.id]?.bg0?.roleSums)[k]));
  const p = confObl.length && non.length ? fisherTwoSided(a, b, c, d) : NaN;
  const trophic = {
    obligateConfirmed: { n: confObl.length, roles: roleTable(confObl), nonPhototroph: a, medianShares: { photo: medShare(confObl, "photo"), grow: medShare(confObl, "grow"), decomp: medShare(confObl, "decomp") } },
    nonObligateClusters: { n: non.length, roles: roleTable(non), nonPhototroph: c, medianShares: { photo: medShare(non, "photo"), grow: medShare(non, "grow"), decomp: medShare(non, "decomp") } },
    fisherTwoSidedNonPhototroph: p,
    verdict: Number.isNaN(p) ? "unavailable" : p < 0.05 ? "distinct" : "not-distinguishable-at-this-n",
  };

  // 5. Consumption of the producer's products and the producer's own response.
  const nullCell = (m: "bg0" | "bg2") => cells["null"]?.[m];
  const nullValid = (["bg0", "bg2"] as const).every((m) => !nullCell(m) || status(nullCell(m)!) !== "viable");
  const ratio = (s: Subject, m: "bg0" | "bg2") => {
    const num = cells[s.id]?.[m]?.otherMass, den = nullCell(m)?.otherMass;
    return num !== undefined && den ? num / den : NaN;
  };
  const effect = (r: number) => (!nullValid ? "invalid (null control viable)" : Number.isNaN(r) ? "n/a" : r <= PRODUCER_DOWN ? "draws-down" : r >= PRODUCER_UP ? "benefits" : "neutral");
  const consumption = confObl.map((s) => {
    const sh = shares(cells[s.id]?.bg0?.roleSums);
    return {
      cluster: s.cluster,
      role: roleIn(s, "bg0"),
      decompShare: sh.decomp,
      decomposerType: roleIn(s, "bg0") === "decomposer" || sh.decomp >= DECOMP_SHARE,
      roleInWaste: roleIn(s, "waste"),
      producerMassRatio: { bg0: ratio(s, "bg0"), bg2: ratio(s, "bg2") },
      producerEffect: effect(ratio(s, "bg0")),
      consumes: nullValid && (roleIn(s, "bg0") === "decomposer" || sh.decomp >= DECOMP_SHARE) && ["draws-down", "benefits"].includes(effect(ratio(s, "bg0"))) ? "yes" : "unknown",
    };
  });
  const consumptionSummary = {
    nullControlValid: nullValid,
    decomposerType: consumption.filter((x) => x.decomposerType).length,
    of: consumption.length,
    producerEffect: count(consumption, (x) => x.producerEffect),
    consumes: count(consumption, (x) => x.consumes),
  };

  return { thresholds: { VIABLE, DEAD, RESCUE, DECOMP_SHARE, PRODUCER_DOWN, PRODUCER_UP }, replication, dominantCluster, dependence, dependenceCounts, bg2OnlyUnconfirmed, trophic, consumption, consumptionSummary };
}
