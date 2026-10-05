// Statistics of the transition hunt (docs/scaffold-transition-hunt-v1.md, frozen 2026-10-02): Stage 0's gates G1 and G2 and its diagnostic D3
// (`hunt0`), and Stage 1's validity checks, tests and outcome (`hunt1`). They read the run bundles tools/run.ts writes (manifest.json, and
// ponds.tsv with `HUNT_POND_COLUMNS`) and the export-assay sets tools/scaffold-assays.ts writes (`export --hunt1`: assay.json, assay.tsv, labels.hunt1).
// Everything except what tools/scaffold-report.ts reads from disk is pure (no Deno API), so vitest exercises it with synthetic data; the CLI is
// scaffold-report.ts. The registration's machinery (the queue check, the sign tail, the ICC permutation, the bundle pick) is imported from
// scaffold-stats.ts, not copied. ponds.tsv is streamed row by row, one boundary held at a time.
import { holm, mannWhitney, wilcoxonSignedRank } from "@bl/metrics";
import { assaySuccess } from "./pond-assay.ts";
import { POND_COLUMNS, randomKey } from "./ponds.ts";
import { binomialUpperTail, dist, mean, median, permutationP, populationCv, reg1ReportHostOf, reg1ReportPickBundle, reg1ReportSignTest, type TsvRow } from "./scaffold-stats.ts";

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const pad2 = (i: number): string => String(i).padStart(2, "0");
const pad3 = (b: number): string => String(b).padStart(3, "0");

/** JSON with sorted keys, to compare two manifests' configurations whatever order their writers used. */
function stableJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stableJson).join(",")}]`;
  if (isRecord(x)) return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stableJson(x[k])}`).join(",")}}`;
  return JSON.stringify(x) ?? "null";
}

const huntInt = (fn: string, name: string, x: number, lo: number, hi: number): void => {
  if (!Number.isInteger(x) || x < lo || x > hi) throw new Error(`${fn}: ${name} must be an integer in ${lo}..${hi}, got ${x}`);
};

// ---------------------------------------------------------------------------------------------
// The frozen hunt and its settings

/**
 * The frozen hunt, pinned by SHA-256 and length (experiments/scaffold/HUNT-v1). A change after the freeze goes in a dated amendment at the end, so the
 * document keeps beginning with these bytes: sets are checked against the pin, never against the document as it is now, which the report only describes.
 */
export const HUNT1_PROTOCOL = { doc: "docs/scaffold-transition-hunt-v1.md", sha256: "13246200a5277ecbbbefb8d5b220f61a10ba1d33dc39a748fefbc224904a1f97", bytes: 38_736 } as const;

/** What is wrong with `doc` (the hunt's bytes as they are now) as its frozen text followed by amendments only. */
export async function huntProtocolProblems(doc: Uint8Array): Promise<string[]> {
  const pin = HUNT1_PROTOCOL;
  if (doc.length < pin.bytes) return [`${pin.doc} has ${doc.length} bytes, fewer than the ${pin.bytes} it had when frozen`];
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", doc.slice(0, pin.bytes))), (b) => b.toString(16).padStart(2, "0")).join("");
  if (sha === pin.sha256) return [];
  return [`${pin.doc} no longer begins with its frozen text (SHA-256 ${pin.sha256}; its first ${pin.bytes} bytes hash to ${sha}): a change after the freeze goes in a dated amendment at the end`];
}

/** α of Stage 1's two Holm families ("Stage 1 tests"), the histories per arm, and the unresolved histories an arm may have ("Validity ..." 4). */
export const HUNT_ALPHA = 0.05;
export const HUNT_HISTORIES = 24;
export const HUNT_UNRESOLVED_LIMIT = 6;
/** The world ("World"): 8 x 8 ponds of 64 x 64 cells, period 10,000, k = 8, the preset ponds (identity as the registration's, whose configuration it is). */
export const HUNT_PONDS = 64;
export const HUNT_PERIOD = 10_000;
export const HUNT_PRESET = { id: "ponds", identity: "56526b894cfccf3f", mutRate: 429_497, side: 8, pondExport: 28 } as const;
/** `pondDeath` (65,536 · e): the hunt's e = 1/2, and G1's fallback e = 1, under which Stage 1, D3 and the device check then run. */
export const HUNT_DEATH = { base: 32_768, fallback: 65_536 } as const;
/** v1's success reference ("Assay": trait >= 0.25 · 103,058 and >= 4 x retained landed B+P). */
export const HUNT_REF = 103_058;
/** The export zone's area share of a pond, 1,071 of 4,096 cells ("The current": 26.1%). */
export const HUNT_ZONE_SHARE = 1_071 / 4_096;
/** Heredity's Monte Carlo permutations ("Heredity": R1's scheme, 1,000, p = (1 + #{>=}) / 1001). */
export const HUNT_PERMUTATIONS = 1000;
/** Quenched sets are dead when at most 5% of their fragments export ("Stage 0" G2, "Validity" 5): 20 x successes <= n. */
export const HUNT_QUENCH_LIMIT = 0.05;
/** The assay's regime ("Assay"): k 8, period 10,000, ref 103,058, side 8, census every 100, mutation off, four replicates of 64 fragments. */
export const HUNT_REGIME = { k: 8, period: HUNT_PERIOD, ref: HUNT_REF, side: 8, censusEvery: 100, mutRate: 0 } as const;
export const HUNT_FRAGMENTS = 64;
export const HUNT_REPLICATES = 4;

/** The hunt's seed block 4,900,001-4,949,999 ("Seeds"): every base the report checks or draws from. */
export const HUNT_SEEDS = {
  /** G1: + 10 arm + s (arm 0 nat, 1 shuf; s 0-1); the e = 1 fallback's. */
  g1: 4_900_001,
  g1Fallback: 4_900_101,
  /** G2: σ(h, s) = + 10 h + s, h 0-5 scaf i0-i5 and 6-11 rand i0-i5, s 0-3. */
  g2: 4_900_201,
  /** D3's worlds: + 10 arm + j; its assays σ = + 10 (4 arm + j) + s. */
  d3World: 4_900_401,
  d3Assay: 4_900_501,
  /** History i of arm a (0 nat-a, 1 shuf-a, 2 nat-s, 3 shuf-s): + 100 a + i. */
  history: 4_901_001,
  /** Ancestor world j: + j. */
  ancestor: 4_901_401,
  /** The hunt's own scaffold phase (only under the sources rule): + i. */
  ownScaffold: 4_901_501,
  /** The registration's scaf history i (docs/scaffold-registration-v1.md; tools/lib/pond-assay.ts `reg1WorldSeedOf`): + i, the other source of the -s arms. */
  registrationScaf: 4_850_001,
  /** Protocol v1's main runs (runs/scaffold/main): + 100 arm + i (scaf 0, rand 1), the sources of G2. */
  v1: 4_810_001,
  /** Stage 1's assays σ(h, s): + 10 h + s, h 0-123 (24 a + i, 96 + j, 100 + i), s 0-3 the replicates and 8 the permutation stream. */
  assay: 4_902_001,
  device: 4_905_001,
  reproducibility: 4_905_101,
} as const;

export const HUNT_ARMS = ["nat-a", "shuf-a", "nat-s", "shuf-s"] as const;
export type HuntArm = (typeof HUNT_ARMS)[number];
/** The pond arm (the runner condition is pond-<regime>) of each history arm. */
export const huntRegimeOf = (arm: HuntArm): "nat" | "shuf" => (arm.startsWith("nat") ? "nat" : "shuf");
const armIndex = (arm: HuntArm): number => HUNT_ARMS.indexOf(arm);

/** A history's name: nat-a-i00 .. shuf-s-i23. */
export const huntHistoryId = (arm: HuntArm, i: number): string => `${arm}-i${pad2(i)}`;

/** The seed index h = 24 a + i of history i of `arm` (0-95). */
export function huntH(arm: HuntArm, i: number): number {
  huntInt("huntH", "i", i, 0, HUNT_HISTORIES - 1);
  const a = armIndex(arm);
  if (a < 0) throw new Error(`huntH: arm must be one of ${HUNT_ARMS.join(", ")}, got ${JSON.stringify(arm)}`);
  return HUNT_HISTORIES * a + i;
}

/** The world seed of history i of `arm`: 4,901,001 + 100 a + i (at most 4,901,324). */
export const huntHistorySeed = (arm: HuntArm, i: number): number => HUNT_SEEDS.history + 100 * Math.floor(huntH(arm, i) / HUNT_HISTORIES) + i;

/** The seed of ancestor world j (0-3): 4,901,401 + j. */
export function huntAncestorSeed(j: number): number {
  huntInt("huntAncestorSeed", "j", j, 0, 3);
  return HUNT_SEEDS.ancestor + j;
}

/** G1's seed: 4,900,001 + 10 arm + s (arm 0 nat, 1 shuf; s 0-1), or the fallback's 4,900,101 + .... */
export function huntG1Seed(arm: "nat" | "shuf", s: number, fallback = false): number {
  huntInt("huntG1Seed", "s", s, 0, 1);
  return (fallback ? HUNT_SEEDS.g1Fallback : HUNT_SEEDS.g1) + 10 * (arm === "nat" ? 0 : 1) + s;
}

/** G2's σ(h, s) = 4,900,201 + 10 h + s, h 0-11 (scaf i0-i5, then rand i0-i5), s 0-3; at most 4,900,314. */
export function huntG2Seed(h: number, s: number): number {
  huntInt("huntG2Seed", "h", h, 0, 11);
  huntInt("huntG2Seed", "s", s, 0, 3);
  return HUNT_SEEDS.g2 + 10 * h + s;
}

/** D3's world seed 4,900,401 + 10 arm + j (arm 0 nat, 1 shuf; j 0-3). */
export function huntD3WorldSeed(arm: "nat" | "shuf", j: number): number {
  huntInt("huntD3WorldSeed", "j", j, 0, 3);
  return HUNT_SEEDS.d3World + 10 * (arm === "nat" ? 0 : 1) + j;
}

/** D3's assay σ = 4,900,501 + 10 (4 arm + j) + s, s 0-3; at most 4,900,574. */
export function huntD3Seed(arm: "nat" | "shuf", j: number, s: number): number {
  huntInt("huntD3Seed", "j", j, 0, 3);
  huntInt("huntD3Seed", "s", s, 0, 3);
  return HUNT_SEEDS.d3Assay + 10 * (4 * (arm === "nat" ? 0 : 1) + j) + s;
}

/** Stage 1's σ(h, s) = 4,902,001 + 10 h + s, h 0-123, s 0-9 (0-3 the replicates, 8 the permutation stream); at most 4,903,239. */
export function huntAssaySeed(h: number, s: number): number {
  huntInt("huntAssaySeed", "h", h, 0, 123);
  huntInt("huntAssaySeed", "s", s, 0, 9);
  return HUNT_SEEDS.assay + 10 * h + s;
}

// ---------------------------------------------------------------------------------------------
// ponds.tsv of a nat or shuf run

/** The columns of a nat or shuf run's ponds.tsv: `POND_COLUMNS` and the died, exportMass and weight of the pond (`HUNT_POND_COLUMNS` in @bl/schema; kept here so the report does not depend on it). */
export const HUNT_POND_COLUMNS = [...POND_COLUMNS, "died", "exportMass", "weight"] as const;

/** The columns of a row the report reads. */
export interface HuntPondRow {
  cycle: number;
  step: number;
  recipient: number;
  /** The donor (>= 0), -1 (died, no export anywhere: no packet) or -2 (survivor). */
  donor: number;
  truncated: number;
  retMass: number;
  recipientTrait: number;
  donorTrait: number;
  recipientLineages: number;
  died: number;
  exportMass: number;
  weight: number;
}

/** A row by its raw cells; a blank or non-integer cell, a negative value (or a donor below -2) throws. */
export function huntPondRow(r: TsvRow): HuntPondRow {
  const int = (key: string, min: number): number => {
    const v = r[key];
    if (v === undefined) throw new Error(`ponds.tsv row has no column "${key}"`);
    const x = Number(v);
    if (v === "" || !Number.isInteger(x) || x < min) throw new Error(`ponds.tsv column "${key}" is not an integer >= ${min}: ${JSON.stringify(v)}`);
    return x;
  };
  return {
    cycle: int("cycle", 0),
    step: int("step", 0),
    recipient: int("recipient", 0),
    donor: int("donor", -2),
    truncated: int("truncated", 0),
    retMass: int("retMass", 0),
    recipientTrait: int("recipientTrait", 0),
    donorTrait: int("donorTrait", 0),
    recipientLineages: int("recipientLineages", 0),
    died: int("died", 0),
    exportMass: int("exportMass", 0),
    weight: int("weight", 0),
  };
}

/** What a ponds.tsv must hold: one row per pond at every boundary first..last, in order, of the arm. */
export interface HuntPondsExpect {
  ponds: number;
  first: number;
  last: number;
  period: number;
  arm: "nat" | "shuf";
  /** Boundaries whose exporting ponds (X > 0) the summary keeps (the assay sources' boundaries). */
  keepExporters?: ReadonlySet<number>;
  /**
   * The boundary whose transform is the runner's after the last step (a history's 200: "read only for completeness", Amendment 1): its rows are checked like any
   * other, and its pre-cycle measurements (occupancy, export mass, traits) are kept as time C's, but its transform's fields (died, recipients, truncation, offspring,
   * donors, weights, packet fields, heat, light) enter no summary, pooled or per boundary (`HuntBoundary.transform` is false). A -s branch's immediate transform at its
   * first boundary is the first cycle under the arm and stays in.
   */
  untransformed?: number;
}

/** One boundary of a nat or shuf run, from its rows: the pre-cycle counts and the diagnostics of "Stage 0" G1. */
export interface HuntBoundary {
  boundary: number;
  /**
   * Whether this boundary's transform is in the summary. False only for `HuntPondsExpect.untransformed` (the transform after time C): then `died`, `recipients`,
   * `truncated`, `noPacket`, `weightSum` are 0, `effectiveDonors` and `spearman` null, `offspring` empty and `recolonisation` empty, and only the pre-cycle
   * measurements (`occupied`, `exporters`, `cv`, `exportShare`, `lineages`, `exporterPonds`) describe the state.
   */
  transform: boolean;
  /** Ponds with recipientTrait > 0. */
  occupied: number;
  /** Ponds with exportMass > 0. */
  exporters: number;
  died: number;
  /** Recipients: died 1 with a donor (>= 0). */
  recipients: number;
  /** Recipients whose packet was truncated against M_r. */
  truncated: number;
  /** Dying ponds with no packet (donor -1: no export anywhere). */
  noPacket: number;
  /** Σw. */
  weightSum: number;
  /** (Σw)^2 / Σw^2; null when Σw = 0. */
  effectiveDonors: number | null;
  /** The population CV of X among exporting ponds; null with fewer than two exporters. */
  cv: number | null;
  /** Spearman (midranks) between X_p and the realised offspring count among exporting ponds; null when undefined (fewer than two exporters, or either constant). */
  spearman: number | null;
  /** Among exporting ponds, histogram[k] = how many have k offspring (recipients naming them as donor). */
  offspring: number[];
  /** The mean over occupied ponds of X_p / trait_p; null with no occupied pond. */
  exportShare: number | null;
  /** The mean recipientLineages over occupied ponds; null with none. */
  lineages: number | null;
  /** The recipients at this boundary and how many meet v1's success rule at the next one (null at the last boundary: no row to read). */
  recolonisation: { recipients: number; successes: number | null };
  /** The exporting ponds, ascending, kept only where `HuntPondsExpect.keepExporters` names the boundary. */
  exporterPonds?: number[];
}

export interface HuntPondsSummary {
  ponds: number;
  first: number;
  last: number;
  boundaries: HuntBoundary[];
  /** The first boundary at which every pond died and none received a packet (every pond cleared to nutrient: the history ended and stepped on); null if none. */
  endedAt: number | null;
  /** Truncated rows over recipient rows; the fraction is null with no recipient (never 0). */
  truncation: { recipients: number; truncated: number; fraction: number | null; flagged: boolean };
  /** Over every boundary, among exporting ponds: histogram[k] = (pond, boundary) pairs with k offspring. */
  offspring: number[];
}

/** Midranks (ties share the mean of their ranks, 1-based). */
export function midranks(xs: readonly number[]): number[] {
  const order = xs.map((_, i) => i).sort((p, q) => xs[p] - xs[q] || p - q);
  const rank = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) j++;
    for (let k = i; k <= j; k++) rank[order[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return rank;
}

/** Spearman's correlation, the Pearson correlation of the midranks; null when undefined (fewer than two pairs, or one side constant). */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length) throw new Error("spearman: xs and ys differ in length");
  const n = xs.length;
  if (n < 2) return null;
  const rx = midranks(xs);
  const ry = midranks(ys);
  const m = (n + 1) / 2;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - m) * (ry[i] - m);
    sxx += (rx[i] - m) * (rx[i] - m);
    syy += (ry[i] - m) * (ry[i] - m);
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** The effective number of donors (Σw)^2 / Σw^2 (the rows' integer weights); null when Σw = 0. */
export const effectiveDonors = (w: readonly number[]): number | null => {
  const s = w.reduce((a, x) => a + x, 0);
  if (s === 0) return null;
  return (s * s) / w.reduce((a, x) => a + x * x, 0);
};

/** v1's success rule on a recipient's next pre-cycle trait: trait >= 0.25 · 103,058 and >= 4 x the retained landed B+P (exact: 4 trait >= ref). */
export const huntRecoloniserSucceeds = (nextTrait: number, retMass: number): boolean => 4 * nextTrait >= HUNT_REF && nextTrait >= 4 * retMass;

/**
 * What is wrong with one boundary's rows (every pond once, ascending) for the arm: row identity and step; died 0 or 1; the donor sentinels (died 0
 * iff donor -2; died 1 with a donor in 0..ponds-1 or -1, and -1 only when no pond at the boundary has weight, and a donor only when the weights sum
 * to something; a donor must have weight and its donorTrait the donor row's recipientTrait, else donorTrait 0); an unoccupied pond always dies; X <= trait;
 * nat's w = X, shuf's weights a permutation of the exporters' X (weight > 0 iff exporting); no packet, no truncation.
 */
export function huntBoundaryProblems(b: number, rows: readonly HuntPondRow[], e: Pick<HuntPondsExpect, "ponds" | "period" | "arm">): string[] {
  const why: string[] = [];
  const at = `boundary ${b}`;
  if (rows.length !== e.ponds) return [`${at} has ${rows.length} rows, want ${e.ponds} (one per pond)`];
  const total = rows.reduce((a, r) => a + r.weight, 0);
  rows.forEach((r, p) => {
    const row = `${at}, pond ${p}`;
    if (r.recipient !== p) why.push(`${at} row ${p} names recipient ${r.recipient}, want ${p} (ascending, one per pond)`);
    if (r.step !== b * e.period) why.push(`${row}: step ${r.step}, want ${b * e.period}`);
    if (r.died !== 0 && r.died !== 1) why.push(`${row}: died ${r.died}, want 0 or 1`);
    if (r.recipientTrait === 0 && r.died !== 1) why.push(`${row}: unoccupied but did not die (an unoccupied pond always dies)`);
    if (r.exportMass > r.recipientTrait) why.push(`${row}: exportMass ${r.exportMass} exceeds its trait ${r.recipientTrait}`);
    if (r.died === 0) {
      if (r.donor !== -2) why.push(`${row}: survivor (died 0) with donor ${r.donor}, want -2`);
      if (r.truncated !== 0 || r.donorTrait !== 0) why.push(`${row}: survivor with a packet field (truncated ${r.truncated}, donorTrait ${r.donorTrait})`);
    } else if (r.died === 1) {
      if (r.donor === -2) why.push(`${row}: died with donor -2 (the survivors' sentinel)`);
      else if (r.donor >= e.ponds) why.push(`${row}: donor ${r.donor} is not a pond`);
      else if (r.donor === -1) {
        if (total > 0) why.push(`${row}: donor -1, but the weights sum to ${total} (-1 only when no pond has weight)`);
        if (r.truncated !== 0 || r.donorTrait !== 0) why.push(`${row}: no packet but truncated ${r.truncated}, donorTrait ${r.donorTrait}`);
      } else if (r.donor >= 0) {
        if (total === 0) why.push(`${row}: donor ${r.donor}, but no pond has weight`);
        else if (rows[r.donor].weight === 0) why.push(`${row}: donor ${r.donor} has no weight`);
        if (r.donorTrait !== rows[r.donor].recipientTrait) why.push(`${row}: donorTrait ${r.donorTrait} is not donor ${r.donor}'s trait ${rows[r.donor].recipientTrait}`);
        if (r.truncated !== 0 && r.truncated !== 1) why.push(`${row}: truncated ${r.truncated}, want 0 or 1`);
      }
    }
    if (e.arm === "nat" && r.weight !== r.exportMass) why.push(`${row}: nat weight ${r.weight} is not its exportMass ${r.exportMass}`);
    if (e.arm === "shuf" && r.weight > 0 && r.exportMass === 0) why.push(`${row}: shuf weight ${r.weight} on a pond that does not export`);
  });
  if (e.arm === "shuf") {
    // The same multiset of weights, assigned to the same exporting ponds in another order.
    const x = rows.filter((r) => r.exportMass > 0).map((r) => r.exportMass).sort((p, q) => p - q);
    const w = rows.filter((r) => r.weight > 0).map((r) => r.weight).sort((p, q) => p - q);
    if (rows.some((r) => r.exportMass > 0 && r.weight === 0) || x.length !== w.length || x.some((v, k) => v !== w[k])) why.push(`${at}: shuf weights are not a permutation of the exporting ponds' export masses`);
  }
  return why;
}

/** One boundary's statistics (rows already valid); `prev` is null here, `recolonisation.successes` is filled by the next boundary. */
function huntBoundaryOf(b: number, rows: readonly HuntPondRow[], keep: boolean, transform = true): HuntBoundary {
  const exporters = rows.filter((r) => r.exportMass > 0);
  const offspring = rows.map(() => 0);
  // The transform after time C is read for completeness only: nobody died, received a packet or was weighed as far as the summary goes.
  const recipients = transform ? rows.filter((r) => r.died === 1 && r.donor >= 0) : [];
  for (const r of recipients) offspring[r.donor]++;
  const x = exporters.map((r) => r.exportMass);
  const kids = exporters.map((r) => offspring[r.recipient]);
  const histogram: number[] = [];
  for (const k of kids) histogram[k] = (histogram[k] ?? 0) + 1;
  for (let k = 0; k < histogram.length; k++) histogram[k] ??= 0;
  const occupied = rows.filter((r) => r.recipientTrait > 0);
  const out: HuntBoundary = {
    boundary: b,
    transform,
    occupied: occupied.length,
    exporters: exporters.length,
    died: transform ? rows.filter((r) => r.died === 1).length : 0,
    recipients: recipients.length,
    truncated: recipients.filter((r) => r.truncated > 0).length,
    noPacket: transform ? rows.filter((r) => r.died === 1 && r.donor === -1).length : 0,
    weightSum: transform ? rows.reduce((a, r) => a + r.weight, 0) : 0,
    effectiveDonors: transform ? effectiveDonors(rows.map((r) => r.weight)) : null,
    cv: exporters.length >= 2 ? populationCv(x) : null,
    spearman: transform ? spearman(x, kids) : null,
    offspring: transform ? histogram : [],
    exportShare: occupied.length ? mean(occupied.map((r) => r.exportMass / r.recipientTrait)) : null,
    lineages: occupied.length ? mean(occupied.map((r) => r.recipientLineages)) : null,
    recolonisation: { recipients: recipients.length, successes: null },
  };
  if (keep) out.exporterPonds = exporters.map((r) => r.recipient);
  return out;
}

/** The most problems listed for one table; the rest are counted. */
const PROBLEM_LIMIT = 12;

class HuntPondsReader {
  readonly problems: string[] = [];
  private more = 0;
  private header = false;
  private cur: HuntPondRow[] = [];
  private curB: number | null = null;
  private doneB: number | null = null;
  private prev: { boundary: HuntBoundary; recipients: Map<number, number> } | null = null;
  private readonly boundaries: HuntBoundary[] = [];
  private truncated = 0;
  private recipients = 0;
  private endedAt: number | null = null;
  private readonly offspring: number[] = [];

  constructor(private readonly e: HuntPondsExpect) {}

  private problem(msg: string): void {
    if (this.problems.length < PROBLEM_LIMIT) this.problems.push(msg);
    else this.more++;
  }

  /** Records `msg` and reports it to stop the read (a table that cannot be read further). */
  fail(msg: string): void {
    this.problem(msg);
  }

  add(r: TsvRow): void {
    if (!this.header) {
      this.header = true;
      const cols = Object.keys(r);
      if (cols.length !== HUNT_POND_COLUMNS.length || cols.some((c, k) => c !== HUNT_POND_COLUMNS[k])) {
        this.problem(`ponds.tsv has columns ${cols.join(",")}, want ${HUNT_POND_COLUMNS.join(",")}`);
        throw new Error("ponds.tsv header");
      }
    }
    const row = huntPondRow(r);
    if (this.curB !== null && row.cycle !== this.curB) this.finishBoundary();
    this.curB = row.cycle;
    this.cur.push(row);
  }

  private finishBoundary(): void {
    const b = this.curB!;
    const rows = this.cur;
    this.cur = [];
    const e = this.e;
    const before = this.problems.length + this.more;
    const want = this.doneB === null ? e.first : this.doneB + 1;
    if (b !== want) this.problem(`ponds.tsv has boundary ${b} where boundary ${want} should come (boundaries ${e.first}..${e.last}, each once and in order)`);
    this.doneB = b;
    for (const p of huntBoundaryProblems(b, rows, e)) this.problem(p);
    if (this.problems.length + this.more > before) {
      this.prev = null;
      return;
    }
    const stat = huntBoundaryOf(b, rows, e.keepExporters?.has(b) === true, b !== e.untransformed);
    if (this.prev !== null && this.prev.boundary.boundary === b - 1) {
      let successes = 0;
      for (const [pond, ret] of this.prev.recipients) if (huntRecoloniserSucceeds(rows[pond].recipientTrait, ret)) successes++;
      this.prev.boundary.recolonisation.successes = successes;
    }
    this.prev = { boundary: stat, recipients: new Map(stat.transform ? rows.filter((r) => r.died === 1 && r.donor >= 0).map((r) => [r.recipient, r.retMass]) : []) };
    this.boundaries.push(stat);
    this.truncated += stat.truncated;
    this.recipients += stat.recipients;
    if (this.endedAt === null && stat.transform && stat.recipients === 0 && stat.died === e.ponds) this.endedAt = b;
    stat.offspring.forEach((n, k) => (this.offspring[k] = (this.offspring[k] ?? 0) + n));
  }

  finish(): { problems: string[]; summary: HuntPondsSummary | null } {
    if (this.cur.length > 0) this.finishBoundary();
    if (this.doneB === null) this.problem("ponds.tsv has no rows");
    else if (this.doneB !== this.e.last) this.problem(`ponds.tsv ends at boundary ${this.doneB}, want ${this.e.last}`);
    if (this.more > 0) this.problems.push(`... and ${this.more} more`);
    if (this.problems.length > 0) return { problems: this.problems, summary: null };
    for (let k = 0; k < this.offspring.length; k++) this.offspring[k] ??= 0;
    const t = this.recipients;
    // v1's 1% flag, exactly: truncated * 100 > recipients.
    return {
      problems: [],
      summary: {
        ponds: this.e.ponds,
        first: this.e.first,
        last: this.e.last,
        boundaries: this.boundaries,
        endedAt: this.endedAt,
        truncation: { recipients: t, truncated: this.truncated, fraction: t > 0 ? this.truncated / t : null, flagged: this.truncated * 100 > t },
        offspring: this.offspring,
      },
    };
  }
}

/**
 * One streaming pass over a nat or shuf run's ponds.tsv, which must hold the columns of `HUNT_POND_COLUMNS` and exactly one row per pond at every
 * boundary `first..last`, ascending in pond index, with the died/donor sentinels of "The current" (`huntBoundaryProblems`). Otherwise the problems are
 * returned (at most 12 listed) and the summary is null: the bundle is refused. Only one boundary's rows (and the previous recipients) are held.
 */
export async function huntPondsSummary(rows: AsyncIterable<TsvRow>, expect: HuntPondsExpect): Promise<{ problems: string[]; summary: HuntPondsSummary | null }> {
  const reader = new HuntPondsReader(expect);
  try {
    for await (const r of rows) reader.add(r);
  } catch (e) {
    if (!(e instanceof Error && e.message === "ponds.tsv header")) reader.fail(`ponds.tsv: ${message(e)}`);
    return { problems: reader.problems, summary: null };
  }
  return reader.finish();
}

/** Occupancy over boundaries from..to (those present): ponds occupied before the cycle, and the mean fraction; null with no boundary. */
export function huntOccupancy(s: HuntPondsSummary, from: number, to: number): { boundaries: number; occupied: number; of: number; mean: number | null } {
  const bs = s.boundaries.filter((b) => b.boundary >= from && b.boundary <= to);
  const occupied = bs.reduce((a, b) => a + b.occupied, 0);
  return { boundaries: bs.length, occupied, of: bs.length * s.ponds, mean: bs.length ? occupied / (bs.length * s.ponds) : null };
}

/** The mean over boundaries from..to of the CV of X among exporting ponds, a boundary with fewer than two exporters counting 0 ("Selection strength"); null with no boundary. */
export function huntSelectionStrength(s: HuntPondsSummary, from: number, to: number): number | null {
  const bs = s.boundaries.filter((b) => b.boundary >= from && b.boundary <= to);
  return bs.length ? bs.reduce((a, b) => a + (b.cv ?? 0), 0) / bs.length : null;
}

/**
 * Recolonisation success pooled over the recipients of boundaries from..to: those that meet v1's success rule at the next boundary over all of them.
 * A recipient whose next row is missing (the history is too short) is a failure; boundaries with no recipient add nothing; the rate is null (not
 * estimable, never 0) when the pooled denominator is 0.
 */
export function huntRecolonisation(s: HuntPondsSummary, from: number, to: number): { recipients: number; successes: number; rate: number | null } {
  let recipients = 0;
  let successes = 0;
  for (const b of s.boundaries) {
    if (b.boundary < from || b.boundary > to) continue;
    recipients += b.recolonisation.recipients;
    successes += b.recolonisation.successes ?? 0;
  }
  return { recipients, successes, rate: recipients > 0 ? successes / recipients : null };
}

// ---------------------------------------------------------------------------------------------
// Bundles: roles, the run each must be, the device check and the reproducibility draw

export type HuntRunKind = "g1" | "g1f" | "d3" | "history" | "repro" | "ancestor" | "device" | "scaffold";
/** The pond arm of a bundle: nat or shuf (the hunt's), cont (an ancestor world), or scaf (the hunt's own scaffold phase: condition treatment, the preset's arm). */
export type HuntBundleArm = "nat" | "shuf" | "cont" | "scaf";

/** What a bundle is, from its manifest's spec.seed (and, for a history seed, its steps). */
export interface HuntRole {
  kind: HuntRunKind;
  id: string;
  seed: number;
  /** The pond arm its condition names: pond-nat, pond-shuf, pond-cont for an ancestor world, or scaf for a scaffold-phase run (condition treatment). */
  arm: HuntBundleArm;
  /** history and repro: the history's arm and i; g1, g1f: s; d3: j; ancestor: j. */
  histArm?: HuntArm;
  index?: number;
}

/**
 * `RunSpec.steps` of each run, and where it ends. A history ends at step 2 x 10^6 (200 cycles): a -a history runs that many steps from 0, a -s history's
 * `steps` count from its source's step (10^6), so it is 10^6. The reproducibility rerun runs 34 boundaries from its start (340,000 steps: to boundary 34 for
 * -a, to 134 for -s). A manifest's `summary.steps` is the absolute step where the run ended.
 */
export const HUNT_STEPS = { history: 2_000_000, branchHistory: 1_000_000, repro: 340_000, g1: 300_000, d3: 300_000, ancestor: 10_000, device: 20_000 } as const;
/** The boundary the -s histories branch from, and the boundary of time C. */
export const HUNT_BRANCH = 100;
export const HUNT_TIME_C = 200;
/** The boundaries of the reproducibility checkpoints: 34 for -a, 134 for -s. */
export const HUNT_REPRO_BOUNDARY = { a: 34, s: 134 } as const;
const HUNT_DEVICES = { mac: "darwin", instances: 3 } as const;

/** The role of a bundle from its manifest, or why it is none of the hunt's (its seed is outside the block's run seeds). */
export function huntRoleOf(manifest: unknown): { role: HuntRole } | { why: string } {
  const spec = isRecord(manifest) && isRecord(manifest.spec) ? manifest.spec : null;
  if (spec === null) return { why: "manifest.json has no spec" };
  const seed = spec.seed;
  if (typeof seed === "number") {
    if (seed === HUNT_SEEDS.device) return { role: { kind: "device", id: "device", seed, arm: "nat" } };
    for (const [kind, base] of [["g1", HUNT_SEEDS.g1], ["g1f", HUNT_SEEDS.g1Fallback]] as const) {
      for (const [a, arm] of (["nat", "shuf"] as const).entries()) {
        const s = seed - base - 10 * a;
        if (Number.isInteger(s) && s >= 0 && s <= 1) return { role: { kind, id: `${kind}-${arm}-s${s}`, seed, arm, index: s } };
      }
    }
    for (const [a, arm] of (["nat", "shuf"] as const).entries()) {
      const j = seed - HUNT_SEEDS.d3World - 10 * a;
      if (Number.isInteger(j) && j >= 0 && j <= 3) return { role: { kind: "d3", id: `d3-${arm}-j${j}`, seed, arm, index: j } };
    }
    for (const [a, histArm] of HUNT_ARMS.entries()) {
      const i = seed - HUNT_SEEDS.history - 100 * a;
      if (Number.isInteger(i) && i >= 0 && i < HUNT_HISTORIES) {
        const repro = spec.steps === HUNT_STEPS.repro;
        return { role: { kind: repro ? "repro" : "history", id: huntHistoryId(histArm, i), seed, arm: huntRegimeOf(histArm), histArm, index: i } };
      }
    }
    const j = seed - HUNT_SEEDS.ancestor;
    if (Number.isInteger(j) && j >= 0 && j <= 3) return { role: { kind: "ancestor", id: `ancestor-j${j}`, seed, arm: "cont", index: j } };
    const i = seed - HUNT_SEEDS.ownScaffold;
    if (Number.isInteger(i) && i >= 0 && i < HUNT_HISTORIES) return { role: { kind: "scaffold", id: `scaffold-i${pad2(i)}`, seed, arm: "scaf", index: i } };
  }
  return { why: `spec.seed ${JSON.stringify(seed)} is not a hunt run seed (G1 4,900,001 + 10 arm + s and 4,900,101 + ..., D3 4,900,401 + 10 arm + j, history 4,901,001 + 100 a + i, ancestor 4,901,401 + j, device 4,905,001)` };
}

/** One expected bundle: its id, role and seed. */
export interface HuntExpectedRun {
  id: string;
  kind: "g1" | "g1f" | "d3" | "history" | "ancestor" | "scaffold";
  arm: HuntBundleArm;
  seed: number;
  histArm?: HuntArm;
  index: number;
}

/** The bundles of one kind, in order: G1's four (nat s0, s1, shuf s0, s1), D3's eight, the 96 histories (nat-a, shuf-a, nat-s, shuf-s), the four ancestor worlds, or the 24 scaffold-phase sources of the hunt's own (4,901,501 + i). */
export function huntExpectedRuns(kind: HuntExpectedRun["kind"]): HuntExpectedRun[] {
  const two = [0, 1] as const;
  if (kind === "g1" || kind === "g1f") return (["nat", "shuf"] as const).flatMap((arm) => two.map((s): HuntExpectedRun => ({ id: `${kind}-${arm}-s${s}`, kind, arm, seed: huntG1Seed(arm, s, kind === "g1f"), index: s })));
  if (kind === "d3") return (["nat", "shuf"] as const).flatMap((arm) => [0, 1, 2, 3].map((j): HuntExpectedRun => ({ id: `d3-${arm}-j${j}`, kind, arm, seed: huntD3WorldSeed(arm, j), index: j })));
  if (kind === "ancestor") return [0, 1, 2, 3].map((j): HuntExpectedRun => ({ id: `ancestor-j${j}`, kind, arm: "cont", seed: huntAncestorSeed(j), index: j }));
  if (kind === "scaffold") return Array.from({ length: HUNT_HISTORIES }, (_, i): HuntExpectedRun => ({ id: `scaffold-i${pad2(i)}`, kind, arm: "scaf", seed: HUNT_SEEDS.ownScaffold + i, index: i }));
  return HUNT_ARMS.flatMap((histArm) => Array.from({ length: HUNT_HISTORIES }, (_, i): HuntExpectedRun => ({ id: huntHistoryId(histArm, i), kind, arm: huntRegimeOf(histArm), seed: huntHistorySeed(histArm, i), histArm, index: i })));
}

interface HuntRunShape {
  condition: string;
  /** `spec.steps`, and `summary.steps` (the absolute step the run ends at). */
  steps: number;
  endStep: number;
  overrides: Record<string, number> | null;
  mutRate: number;
  pondDeath: number | null;
  /** The pre-cycle checkpoints the manifest must list (others may follow). */
  preCycle: number[];
  /** The boundaries of ponds.tsv; null when it is not read (device, rerun). */
  rows: { first: number; last: number } | null;
  branch: boolean;
}

/** What the hunt says a bundle of this role must be; `pondDeath` is the stage's (32,768, or 65,536 after G1's fallback). */
function huntRunShape(role: HuntRole, pondDeath: number): HuntRunShape {
  const overrides = (o: Record<string, number>): Record<string, number> | null => (Object.keys(o).length ? o : null);
  const death: Record<string, number> = pondDeath === HUNT_DEATH.fallback ? { pondDeath } : {};
  const condition = `pond-${role.arm}`;
  const mutOn = HUNT_PRESET.mutRate;
  switch (role.kind) {
    case "g1":
      return { condition, steps: HUNT_STEPS.g1, endStep: HUNT_STEPS.g1, overrides: null, mutRate: mutOn, pondDeath: HUNT_DEATH.base, preCycle: [], rows: { first: 1, last: 30 }, branch: false };
    case "g1f":
      return { condition, steps: HUNT_STEPS.g1, endStep: HUNT_STEPS.g1, overrides: { pondDeath: HUNT_DEATH.fallback }, mutRate: mutOn, pondDeath: HUNT_DEATH.fallback, preCycle: [], rows: { first: 1, last: 30 }, branch: false };
    case "d3":
      return { condition, steps: HUNT_STEPS.d3, endStep: HUNT_STEPS.d3, overrides: overrides({ mutRate: 0, ...death }), mutRate: 0, pondDeath, preCycle: [30], rows: { first: 1, last: 30 }, branch: false };
    case "ancestor":
      return { condition: "pond-cont", steps: HUNT_STEPS.ancestor, endStep: HUNT_STEPS.ancestor, overrides: null, mutRate: mutOn, pondDeath: null, preCycle: [1], rows: null, branch: false };
    case "device":
      return { condition, steps: HUNT_STEPS.device, endStep: HUNT_STEPS.device, overrides: overrides(death), mutRate: mutOn, pondDeath, preCycle: [], rows: null, branch: false };
    case "scaffold":
      return { condition: "treatment", steps: HUNT_BRANCH * HUNT_PERIOD, endStep: HUNT_BRANCH * HUNT_PERIOD, overrides: null, mutRate: mutOn, pondDeath: null, preCycle: [HUNT_BRANCH], rows: null, branch: false };
    case "history":
    case "repro": {
      const s = role.histArm!.endsWith("-s");
      const repro = role.kind === "repro";
      const steps = repro ? HUNT_STEPS.repro : s ? HUNT_STEPS.branchHistory : HUNT_STEPS.history;
      return {
        condition,
        steps,
        endStep: s ? HUNT_BRANCH * HUNT_PERIOD + steps : steps,
        overrides: overrides(death),
        mutRate: mutOn,
        pondDeath,
        preCycle: repro ? [s ? HUNT_REPRO_BOUNDARY.s : HUNT_REPRO_BOUNDARY.a] : [s ? HUNT_REPRO_BOUNDARY.s : HUNT_REPRO_BOUNDARY.a, HUNT_TIME_C],
        rows: repro ? null : { first: s ? HUNT_BRANCH : 1, last: HUNT_TIME_C },
        branch: s,
      };
    }
  }
}

/** The ponds.tsv a bundle of this role must hold (null when its rows are not read). */
export function huntPondsExpectOf(role: HuntRole, pondDeath: number): HuntPondsExpect | null {
  const shape = huntRunShape(role, pondDeath);
  if (shape.rows === null || (role.arm !== "nat" && role.arm !== "shuf")) return null;
  const keep = role.kind === "history" ? HUNT_TIME_C : role.kind === "d3" ? 30 : null;
  return { ponds: HUNT_PONDS, period: HUNT_PERIOD, arm: role.arm, ...shape.rows, ...(keep === null ? {} : { keepExporters: new Set([keep]) }), ...(role.kind === "history" ? { untransformed: HUNT_TIME_C } : {}) };
}

/** A pre-cycle checkpoint's file in its bundle, as the runner names it: checkpoints/b<NNN>-pre.blck. */
export const huntPreCycleFile = (b: number): string => `checkpoints/b${pad3(b)}-pre.blck`;

/** The recorded state hashes of a manifest's pre-cycle checkpoints by boundary. */
export function huntBundleHashes(manifest: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  for (const e of isRecord(manifest) && Array.isArray(manifest.preCycleCheckpoints) ? manifest.preCycleCheckpoints : []) {
    if (isRecord(e) && Number.isInteger(e.boundary) && typeof e.hash === "string") out[e.boundary as number] = e.hash;
  }
  return out;
}

/** A branch run's recorded source (manifest.branch), or null for a run from the preset. */
export function huntBranchOf(manifest: unknown): { sourceHash: string; boundary: number } | null {
  const b = isRecord(manifest) ? manifest.branch : undefined;
  return isRecord(b) && typeof b.sourceHash === "string" && Number.isInteger(b.boundary) ? { sourceHash: b.sourceHash, boundary: b.boundary as number } : null;
}

/** Whether a manifest records exact conservation (summary.conservationOk); null when it has no summary. */
export const huntConservationOf = (manifest: unknown): boolean | null => (isRecord(manifest) && isRecord(manifest.summary) && typeof manifest.summary.conservationOk === "boolean" ? manifest.summary.conservationOk : null);

/** A bundle's identity for the reproducibility check: its configuration, overrides, condition, seed and branch source, key order aside. */
export function huntFingerprint(manifest: unknown): string {
  const m = isRecord(manifest) ? manifest : {};
  const spec = isRecord(m.spec) ? m.spec : {};
  return stableJson({ cfg: m.cfg ?? null, overrides: spec.overrides ?? null, condition: spec.condition ?? null, seed: spec.seed ?? null, branch: huntBranchOf(manifest) });
}

/**
 * What is wrong with a bundle's manifest.json for its role (none: it is the hunt's run), apart from conservation (`huntConservationOf`: G1 reads
 * it as a result, the other stages as a failure). It must have finished (summary and finishedAt) and be the run of its seed (a hunt's own scaffold-phase run:
 * condition treatment, the preset's pond arm scaf, 10^6 steps, a pre-cycle checkpoint at boundary 100; D3's world: experiment d3 or its census-100 rerun d3-c100): preset ponds with the
 * registration's identity, the role's condition and steps (G1 and D3: 30 cycles; a history ending at step 2 x 10^6, so spec.steps 2 x 10^6 for -a and 10^6 from
 * its source's step for -s; an ancestor world: one period; the device check: 20,000; a reproducibility rerun: 340,000), spec.overrides exactly the role's (G1's fallback and D3 as the hunt gives them; `pondDeath` 65,536 under the stage's fallback), a
 * configuration with the default mutation rate (D3: off), 8 x 8 ponds, period 10,000, the arm, `pondDeath` and `pondExport` 28, started from the preset
 * (initHash) except a -s history, which carries manifest.branch (boundary 100, its source and post-transform hash) and no initHash; every pre-cycle
 * checkpoint the role needs listed with its step, file checkpoints/b<NNN>-pre.blck and hash (a history: 34 or 134, and 200); the runId the runner derives,
 * which `dir`, when given, must end in.
 */
export function huntBundleProblems(manifest: unknown, role: HuntRole, o: { pondDeath: number; dir?: string }): string[] {
  if (!isRecord(manifest) || !isRecord(manifest.spec)) return ["manifest.json has no spec"];
  const m = manifest;
  const spec = manifest.spec;
  const why: string[] = [];
  const want = (name: string, got: unknown, expected: unknown) => {
    if (got !== expected) why.push(`${name} ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
  };
  if (!isRecord(m.summary) || typeof m.finishedAt !== "string") why.push("the run did not finish (manifest.json has no summary and finishedAt)");
  const shape = huntRunShape(role, o.pondDeath);
  const runId = `${typeof spec.experiment === "string" ? spec.experiment : "<experiment>"}/${HUNT_PRESET.id}/${shape.condition}/seed-${role.seed}`;
  if (typeof spec.experiment !== "string" || spec.experiment === "") why.push(`spec.experiment ${JSON.stringify(spec.experiment)} is not named`);
  else want("runId", m.runId, runId);
  // D3's worlds are the experiment d3, or its overflow rerun at census 100, d3-c100 (the assay reads the same two: hunt1BundleProblems).
  if (role.kind === "d3" && spec.experiment !== "d3" && spec.experiment !== "d3-c100") why.push(`spec.experiment ${JSON.stringify(spec.experiment)}, want "d3" or "d3-c100"`);
  if (o.dir !== undefined && !(o.dir.replace(/\/+$/, "") === runId || o.dir.replace(/\/+$/, "").endsWith(`/${runId}`))) why.push(`the bundle directory ${JSON.stringify(o.dir)} does not end in ${runId}`);
  want("spec.presetId", spec.presetId, HUNT_PRESET.id);
  want("spec.condition", spec.condition, shape.condition);
  want("spec.seed", spec.seed, role.seed);
  want("spec.steps", spec.steps, shape.steps);
  if (stableJson(spec.overrides ?? null) !== stableJson(shape.overrides)) why.push(`spec.overrides ${JSON.stringify(spec.overrides ?? null)}, want ${JSON.stringify(shape.overrides)}`);
  for (const key of ["metapopulation", "soloFounder", "soloGenome", "founderSet"]) if (spec[key] !== undefined) why.push(`spec.${key} is set, but the hunt's runs are the preset's own world`);
  if (role.kind !== "device") want("presetIdentity", m.presetIdentity, HUNT_PRESET.identity);
  const cfg = isRecord(m.cfg) ? m.cfg : {};
  want("cfg.mutRate", cfg.mutRate, shape.mutRate);
  want("cfg.pondPeriod", cfg.pondPeriod, HUNT_PERIOD);
  want("cfg.tilesX", cfg.tilesX, HUNT_PRESET.side);
  want("cfg.tilesY", cfg.tilesY, HUNT_PRESET.side);
  want("cfg.pondArm", cfg.pondArm, role.arm);
  if (role.arm === "nat" || role.arm === "shuf") {
    want("cfg.pondDeath", cfg.pondDeath, shape.pondDeath);
    want("cfg.pondExport", cfg.pondExport, HUNT_PRESET.pondExport);
  }
  const branch = isRecord(m.branch) ? m.branch : null;
  if (shape.branch) {
    if (branch === null) why.push("manifest.json has no branch (a -s history is a branch of its source)");
    else {
      if (typeof branch.source !== "string" || branch.source === "") why.push("branch.source is not recorded");
      if (typeof branch.sourceHash !== "string" || branch.sourceHash === "") why.push("branch.sourceHash is not recorded");
      if (typeof branch.postHash !== "string" || branch.postHash === "") why.push("branch.postHash is not recorded");
      want("branch.boundary", branch.boundary, HUNT_BRANCH);
    }
    if (m.initHash !== undefined) why.push("manifest.json has an initHash, but a branch starts from its source");
  } else {
    if (branch !== null) why.push("manifest.json has a branch, but this run starts from the preset");
    if (typeof m.initHash !== "string") why.push("manifest.json has no initHash (not a run built from the preset)");
    want("startStep", m.startStep, 0);
  }
  if (shape.branch) want("startStep", m.startStep, HUNT_BRANCH * HUNT_PERIOD);
  if (role.kind === "device") {
    if (!isRecord(m.summary) || typeof m.summary.finalHash !== "string") why.push("summary.finalHash is missing");
    return why;
  }
  if (isRecord(m.summary)) want("summary.steps", m.summary.steps, shape.endStep);
  const listed = Array.isArray(m.preCycleCheckpoints) ? m.preCycleCheckpoints : [];
  const specList = Array.isArray(spec.preCycleCheckpoints) ? spec.preCycleCheckpoints : [];
  for (const b of shape.preCycle) {
    const e = listed.find((x) => isRecord(x) && x.boundary === b);
    const file = huntPreCycleFile(b);
    if (!specList.includes(b)) why.push(`spec.preCycleCheckpoints ${JSON.stringify(spec.preCycleCheckpoints)} does not list boundary ${b}`);
    if (!isRecord(e) || e.step !== b * HUNT_PERIOD || e.file !== file || typeof e.hash !== "string" || e.hash === "") why.push(`manifest.json lists no preCycleCheckpoints entry for boundary ${b} at step ${b * HUNT_PERIOD} in ${file} with its hash`);
  }
  return why;
}

/** One bundle of the hunt as the report found it. */
export interface HuntRun {
  id: string;
  kind: HuntExpectedRun["kind"];
  arm: HuntBundleArm;
  seed: number;
  histArm?: HuntArm;
  index: number;
  /** The bundle directory; null when none was found. */
  dir: string | null;
  /** Found exactly once, finished, with a valid manifest and a complete ponds.tsv (and, unless `conservationIsResult`, exact conservation); otherwise unresolved, and why. */
  resolved: boolean;
  why: string[];
  /** summary.conservationOk; null when the manifest has no summary. */
  conservationOk: boolean | null;
  hashes: Record<number, string>;
  branch: { sourceHash: string; boundary: number } | null;
  fingerprint: string | null;
  censusEvery: number | null;
  host: { host: string | null; adapter: string | null } | null;
  ponds: HuntPondsSummary | null;
}

/**
 * The bundles of `expected` from the --runs/--g1/... bundles, in order: each found exactly once (`reg1ReportPickBundle`: reruns write the same
 * directory, and exactly one may be finished), its manifest the hunt's run for its role (`huntBundleProblems`) and its ponds.tsv read by `readPonds`
 * (the CLI streams the file; it returns the problems and the summary of `huntPondsSummary`). Otherwise unresolved, with why. With
 * `conservationIsResult` a manifest that records conservationOk false is resolved (G1 reads it as the viability result), otherwise it is a failure.
 * A bundle found that is none of `expected` is returned under `others` with its role (or why it has none).
 */
export async function huntResolveRuns(
  bundles: readonly { dir: string; manifest: unknown }[],
  expected: readonly HuntExpectedRun[],
  o: {
    pondDeath: number;
    conservationIsResult?: boolean;
    readPonds: (dir: string, expect: HuntPondsExpect) => Promise<{ problems: string[]; summary: HuntPondsSummary | null }>;
    /** The size in bytes of a file (null when it does not exist): a history bundle is resolved only if every pre-cycle checkpoint file its manifest lists for the role exists and is not empty. */
    checkpointSize: (path: string) => Promise<number | null>;
  },
): Promise<{ runs: HuntRun[]; others: { dir: string; why: string }[] }> {
  const byId = new Map<string, { dir: string; manifest: unknown; role: HuntRole }[]>();
  const others: { dir: string; why: string }[] = [];
  const ids = new Set(expected.map((x) => x.id));
  for (const b of bundles) {
    const r = huntRoleOf(b.manifest);
    if ("why" in r) others.push({ dir: b.dir, why: r.why });
    else if (r.role.kind === "repro") others.push({ dir: b.dir, why: `a reproducibility rerun of ${r.role.id}: give it with --repro` });
    else if (!ids.has(r.role.id)) others.push({ dir: b.dir, why: `${r.role.id} (${r.role.kind}) is not one of the runs this stage reads` });
    else byId.set(r.role.id, [...(byId.get(r.role.id) ?? []), { ...b, role: r.role }]);
  }
  const runs: HuntRun[] = [];
  for (const x of expected) {
    const found = byId.get(x.id) ?? [];
    const base = { id: x.id, kind: x.kind, arm: x.arm, seed: x.seed, histArm: x.histArm, index: x.index, hashes: {}, branch: null, fingerprint: null, censusEvery: null, host: null, conservationOk: null, ponds: null };
    const { pick, superseded, why: refused } = reg1ReportPickBundle(found);
    for (const s of superseded) others.push({ dir: s.dir, why: `an unfinished run of ${x.id}, superseded by the finished ${pick!.dir}` });
    if (pick === null) {
      runs.push({ ...base, dir: found.length ? found.map((f) => f.dir).join(", ") : null, resolved: false, why: [refused!] });
      continue;
    }
    const { dir, manifest, role } = pick;
    const why = huntBundleProblems(manifest, role, { pondDeath: o.pondDeath, dir });
    const conservationOk = huntConservationOf(manifest);
    if (conservationOk === false && !o.conservationIsResult) why.push("summary.conservationOk false: matter or the energy ledger was not conserved");
    // Existence only (the files are decoded for the two reproducibility histories alone): a history without a pre-cycle checkpoint it needs (b034 or b134, and b200) is unresolved.
    if (why.length === 0 && role.kind === "history") {
      for (const b of huntRunShape(role, o.pondDeath).preCycle) {
        const file = huntPreCycleFile(b);
        const size = await o.checkpointSize(`${dir.replace(/\/+$/, "")}/${file}`);
        if (size === null) why.push(`${file} is missing (a history needs every pre-cycle checkpoint it was queued to write)`);
        else if (size === 0) why.push(`${file} is empty`);
      }
    }
    const expect = huntPondsExpectOf(role, o.pondDeath);
    let ponds: HuntPondsSummary | null = null;
    if (why.length === 0 && expect !== null) {
      const r = await o.readPonds(dir, expect);
      if (r.summary === null) why.push(...r.problems.map((p) => `ponds.tsv: ${p}`));
      else ponds = r.summary;
    }
    const spec = (manifest as { spec?: { censusEvery?: unknown } }).spec;
    runs.push({ ...base, dir, resolved: why.length === 0, why, conservationOk, hashes: huntBundleHashes(manifest), branch: huntBranchOf(manifest), fingerprint: huntFingerprint(manifest), censusEvery: typeof spec?.censusEvery === "number" ? spec.censusEvery : null, host: reg1ReportHostOf(manifest), ponds });
  }
  return { runs, others };
}

/**
 * Pairing ("Arms and histories"): within each -s index i, nat-s and shuf-s share their source. A pair whose two bundles name different source hashes
 * is refused: both are unresolved. Mutates `runs` and returns what it refused.
 */
export function huntPairingProblems(runs: HuntRun[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < HUNT_HISTORIES; i++) {
    const nat = runs.find((r) => r.id === huntHistoryId("nat-s", i));
    const shuf = runs.find((r) => r.id === huntHistoryId("shuf-s", i));
    if (!nat?.resolved || !shuf?.resolved || nat.branch === null || shuf.branch === null || nat.branch.sourceHash === shuf.branch.sourceHash) continue;
    const msg = `${nat.id} and ${shuf.id} branch from different sources (${nat.branch.sourceHash}, ${shuf.branch.sourceHash}), but a -s pair shares its source`;
    for (const r of [nat, shuf]) {
      r.resolved = false;
      r.why.push(msg);
    }
    out.push(msg);
  }
  return out;
}

/** What `huntSourceProblems` found: the origin of the 24 -s sources ("mixed" when both, null when none is classified) and every reason a -s pair or the whole of them is unresolved. */
export interface HuntSources {
  origin: HuntSourceOrigin | "mixed" | null;
  problems: string[];
}

/**
 * The -s sources ("Arms and histories": "chosen by one rule ... with no mixing"; "Within each -s index i, nat-s and shuf-s share their source"). Marks the
 * -s histories unresolved, mutating `runs` as `huntPairingProblems` does, and returns what it found. A pair (nat-s and shuf-s of index i) is unresolved when:
 * - its source set s1-src-iNN is missing, rejected or records a state hash other than the `branch.sourceHash` of the pair's bundles (the pair's bundles must
 *   record one: a resolved -s history always does);
 * - its `branch.sourceHash` is also another index's (the 24 sources are distinct);
 * - the hunt's own scaffold-phase sources are used (every source set's path names `…/ponds/treatment/seed-<4,901,501 + i>`) and its bundle scaffold-iNN is
 *   missing or unresolved (the own sources are validated when used).
 * And every -s history is unresolved when the source sets' paths mix the registration's origin with the hunt's own: the paths of rejected source sets
 * (`HuntRejected.source`) count here too.
 */
export function huntSourceProblems(runs: HuntRun[], sets: readonly HuntSet[], rejected: readonly HuntRejected[] = []): HuntSources {
  const byId = new Map(sets.map((x) => [x.id, x]));
  const run = (id: string): HuntRun | undefined => runs.find((r) => r.id === id);
  const pairOf = (i: number): HuntRun[] => (["nat-s", "shuf-s"] as const).map((a) => run(huntHistoryId(a, i))).filter((r): r is HuntRun => r !== undefined);
  const why = new Map<number, string[]>();
  const add = (i: number, msg: string): void => void why.set(i, [...(why.get(i) ?? []), msg]);
  // Only authenticated protocol members tell where a source came from (`HuntSet.authenticated`, and `HuntRejected.source`, which is kept for those alone): a smoke
  // test's set, a set of foreign seeds or regime, or one whose source hash no bundle backs never establishes an origin, accepted or rejected.
  const mixing = new Map<number, Set<HuntSourceOrigin>>();
  const note = (i: number, path: unknown): void => {
    const origin = huntSourceOriginOf(path, i);
    if (origin !== null) mixing.set(i, (mixing.get(i) ?? new Set<HuntSourceOrigin>()).add(origin));
  };
  for (const r of rejected) {
    const m = r.id === null ? null : /^s1-src-i(\d\d)$/.exec(r.id);
    if (m !== null) note(Number(m[1]), r.source);
  }
  for (let i = 0; i < HUNT_HISTORIES; i++) {
    const id = `s1-src-i${pad2(i)}`;
    const src = byId.get(id);
    if (src !== undefined && src.authenticated !== false) note(i, src.provenance.source);
    if (src === undefined) add(i, `its source set ${id} is missing or unresolved`);
    for (const r of pairOf(i)) {
      if (r.branch === null) {
        if (r.resolved) add(i, `${r.id} records no branch source`);
      } else if (src !== undefined && src.provenance.stateHash !== r.branch.sourceHash) add(i, `${r.id} branched from ${r.branch.sourceHash}, but its source set ${id} records ${src.provenance.stateHash}`);
    }
  }
  // The 24 sources are distinct: a source hash that two indices share makes both pairs unresolved.
  const owners = new Map<string, Set<number>>();
  for (let i = 0; i < HUNT_HISTORIES; i++) for (const r of pairOf(i)) if (r.branch !== null) owners.set(r.branch.sourceHash, (owners.get(r.branch.sourceHash) ?? new Set<number>()).add(i));
  for (const [hash, is] of owners) if (is.size > 1) for (const i of is) add(i, `branch.sourceHash ${hash} is also the source of -s index ${[...is].filter((j) => j !== i).map(pad2).join(", ")}: the 24 sources are distinct`);
  // One origin for all 24, or none of the -s histories can be read.
  const seen = new Set([...mixing.values()].flatMap((o) => [...o]));
  const origin = seen.size > 1 ? "mixed" : seen.size === 1 ? [...seen][0] : null;
  const problems: string[] = [];
  if (origin === "mixed") problems.push(`the -s sources come from both origins (${[...mixing].sort(([p], [q]) => p - q).map(([i, o]) => `i${pad2(i)} ${[...o].join("+")}`).join(", ")}), but all 24 are chosen by one rule, with no mixing: every -s history is unresolved`);
  if (origin === "own") {
    for (let i = 0; i < HUNT_HISTORIES; i++) {
      const sc = run(`scaffold-i${pad2(i)}`);
      if (!sc?.resolved) add(i, `the hunt's own scaffold source scaffold-i${pad2(i)} is ${sc === undefined ? "not found (give the scaffold-phase bundles with --runs)" : `unresolved (${sc.why.join("; ")})`}`);
    }
  }
  const mixed = origin === "mixed" ? problems[0] : null;
  for (let i = 0; i < HUNT_HISTORIES; i++) {
    const own = why.get(i) ?? [];
    if (own.length > 0) problems.push(`-s index ${pad2(i)}: ${own.join("; ")}`);
    const msgs = mixed === null ? own : [...own, mixed];
    if (msgs.length === 0) continue;
    for (const r of pairOf(i)) {
      if (!r.resolved) continue;
      r.resolved = false;
      r.why.push(`-s index ${pad2(i)}: ${msgs.join("; ")}`);
    }
  }
  return { origin, problems };
}

/** The device check ("Validity" 1): exactly one bundle on the Mac (the reference; its host names darwin) and one per instance, each the device spec, with one finalHash. */
export interface HuntDevice {
  passed: boolean;
  reasons: string[];
  finalHash: string | null;
  mac: string | null;
  bundles: { dir: string; host: string | null; adapter: string | null; finalHash: string | null; problems: string[] }[];
  /** Run bundles whose host and adapter no device check covers. */
  uncovered: string[];
}

/**
 * The device check: the --device bundles (the Mac's and one per instance: `instances` of them, default three) in distinct directories, exactly one the
 * Mac's (its host names darwin: the reference), each arm nat from preset ponds, seed 4,905,001, 20,000 steps (with `pondDeath` as the stage's), finished with
 * exact conservation, all reporting one `summary.finalHash`; and every run bundle taken (`runs`, when given) ran on a host and adapter one of them reports.
 * A check that cannot be made fails as a mismatch does.
 */
export function huntDeviceCheck(bundles: readonly { dir: string; manifest: unknown }[], o: { pondDeath: number; instances?: number; runs?: readonly Pick<HuntRun, "id" | "host">[] | null }): HuntDevice {
  const rows = bundles.map(({ dir, manifest }) => {
    const m = isRecord(manifest) ? manifest : {};
    const role = huntRoleOf(manifest);
    const problems = "why" in role ? [role.why] : role.role.kind !== "device" ? [`spec.seed ${JSON.stringify(isRecord(m.spec) ? m.spec.seed : undefined)} is not the device check's (4,905,001)`] : huntBundleProblems(manifest, role.role, { pondDeath: o.pondDeath, dir });
    if (huntConservationOf(manifest) === false) problems.push("summary.conservationOk false: matter or the energy ledger was not conserved");
    const summary = isRecord(m.summary) ? m.summary : {};
    return { dir, ...reg1ReportHostOf(manifest), finalHash: typeof summary.finalHash === "string" ? summary.finalHash : null, problems };
  });
  const reasons: string[] = [];
  const want = 1 + (o.instances ?? HUNT_DEVICES.instances);
  if (rows.length !== want) reasons.push(`${rows.length} device check bundle${rows.length === 1 ? "" : "s"}, want ${want}: the Mac's and one per instance`);
  const dirs = rows.map((r) => r.dir.replace(/\/+$/, ""));
  if (new Set(dirs).size !== dirs.length) reasons.push(`device check bundles share a directory: ${dirs.filter((d, k) => dirs.indexOf(d) !== k).join(", ")}`);
  const macs = rows.filter((r) => r.host?.includes(HUNT_DEVICES.mac) === true);
  if (macs.length !== 1) reasons.push(`${macs.length} device check bundles ran on a host naming ${HUNT_DEVICES.mac}, want exactly 1 (the Mac's, the reference)`);
  for (const r of rows) if (r.problems.length > 0) reasons.push(`${r.dir}: ${r.problems.join("; ")}`);
  const hashes = [...new Set(rows.map((r) => r.finalHash))];
  if (rows.length > 0 && hashes.length > 1) reasons.push(`finalHash differs between the device check bundles: ${rows.map((r) => `${r.dir} ${r.finalHash}`).join(", ")}`);
  const covered = new Set(rows.map((r) => JSON.stringify([r.host, r.adapter])));
  const uncovered = (o.runs ?? []).filter((r) => r.host !== null && !covered.has(JSON.stringify([r.host.host, r.host.adapter]))).map((r) => r.id);
  if (uncovered.length > 0) {
    const first = o.runs!.find((r) => r.id === uncovered[0])!.host!;
    reasons.push(`${uncovered.length} run bundles ran on a host and adapter no device check reports (${uncovered.slice(0, 5).join(", ")}${uncovered.length > 5 ? ", ..." : ""}; ${uncovered[0]} on ${JSON.stringify(first.host)} with ${JSON.stringify(first.adapter)})`);
  }
  const passed = reasons.length === 0;
  return { passed, reasons, finalHash: passed ? rows[0].finalHash : null, mac: macs.length === 1 ? macs[0].dir : null, bundles: rows, uncovered };
}

/** The instances of a queue manifest ({ commands: [{ id, instance }] }): how many distinct ones, for the device check. */
export function huntQueueInstances(queue: unknown): number | null {
  const commands = isRecord(queue) && Array.isArray(queue.commands) ? queue.commands : null;
  if (commands === null) return null;
  return new Set(commands.filter(isRecord).map((c) => c.instance)).size;
}

/**
 * The reproducibility draw ("Validity" 7): the first two distinct values of randomKey(4,905,101, 0, k, 0) mod 96 for k = 0, 1, ..., each naming a
 * history in seed order (nat-a 0-23, shuf-a 24-47, nat-s 48-71, shuf-s 72-95), with every draw up to the second distinct value.
 */
export function huntReproSelection(): { draws: { k: number; value: number }[]; selected: { value: number; histArm: HuntArm; index: number; id: string }[] } {
  const draws: { k: number; value: number }[] = [];
  const values: number[] = [];
  for (let k = 0; values.length < 2; k++) {
    if (k > 100_000) throw new Error("huntReproSelection: no second distinct value");
    const value = randomKey(HUNT_SEEDS.reproducibility, 0, k, 0) % (HUNT_ARMS.length * HUNT_HISTORIES);
    draws.push({ k, value });
    if (!values.includes(value)) values.push(value);
  }
  const selected = values.map((value) => {
    const histArm = HUNT_ARMS[Math.floor(value / HUNT_HISTORIES)];
    const index = value % HUNT_HISTORIES;
    return { value, histArm, index, id: huntHistoryId(histArm, index) };
  });
  return { draws, selected };
}

/**
 * A pre-cycle checkpoint as the report decoded it: the state hash of the decoded state, or why it could not be loaded (a missing, empty or corrupt file). The caller
 * (scaffold-report.ts) reads and decodes the file; `huntReproducibility` verifies the hash against the manifest's entry.
 */
export type HuntCheckpointCheck = { stateHash: string } | { error: string };

/** The reproducibility check over the selected histories' Mac reruns. */
export interface HuntReproducibility {
  /**
   * Both selected histories resolved, each with exactly one valid rerun on the Mac, and for each the pre-cycle checkpoint (b034 for -a, b134 for -s) of the instance and of the
   * rerun decoded, each state hash verified against its manifest entry, and the two verified hashes equal.
   */
  passed: boolean;
  reasons: string[];
  draws: { k: number; value: number }[];
  /** `instanceHash` and `rerunHash` are the hashes of the decoded checkpoints, set once the file was loaded (null before: nothing was compared). */
  histories: { id: string; value: number; boundary: number; instanceHash: string | null; rerun: string | null; rerunHash: string | null; passed: boolean; why: string | null }[];
  /** --repro bundles that are not a rerun of a selected history. */
  skipped: { dir: string; why: string }[];
}

/**
 * The reruns among `reruns` of the selected histories, by history id, and each history's pick by the rule that picks everywhere else (`reg1ReportPickBundle`, as
 * `huntResolveRuns`): exactly one finished bundle among the rerun and its census-100 rerun (`<experiment>-c100`) is the rerun, the unfinished ones are skipped as
 * superseded, and two finished (or none finished among several) are refused.
 */
function huntReproGroups(reruns: readonly { dir: string; manifest: unknown }[]) {
  const { selected } = huntReproSelection();
  const skipped: { dir: string; why: string }[] = [];
  const byId = new Map<string, { dir: string; manifest: unknown; role: HuntRole }[]>();
  for (const r of reruns) {
    const role = huntRoleOf(r.manifest);
    if ("why" in role) skipped.push({ dir: r.dir, why: role.why });
    else if (role.role.kind !== "repro") skipped.push({ dir: r.dir, why: `not a reproducibility rerun (${role.role.id}, ${JSON.stringify(isRecord(r.manifest) && isRecord(r.manifest.spec) ? r.manifest.spec.steps : undefined)} steps)` });
    else if (!selected.some((x) => x.id === role.role.id)) skipped.push({ dir: r.dir, why: `${role.role.id} is not a selected history (${selected.map((x) => x.id).join(", ")})` });
    else byId.set(role.role.id, [...(byId.get(role.role.id) ?? []), { ...r, role: role.role }]);
  }
  const picks = new Map(selected.map(({ id }) => [id, reg1ReportPickBundle(byId.get(id) ?? [])] as const));
  for (const [id, r] of picks) for (const x of r.superseded) skipped.push({ dir: x.dir, why: `an unfinished rerun of ${id}, superseded by the finished ${r.pick!.dir}` });
  return { selected, skipped, picks };
}

const huntReproBoundaryOf = (histArm: HuntArm): number => (histArm.endsWith("-s") ? HUNT_REPRO_BOUNDARY.s : HUNT_REPRO_BOUNDARY.a);

/**
 * The checkpoints `huntReproducibility` needs decoded: for each selected history its instance bundle's (when resolved with a directory) and its picked rerun's
 * (`huntReproGroups`: one finished bundle among the rerun and its -c100 rerun), each as { dir, boundary } (b034 for -a, b134 for -s). The caller loads them
 * (`HuntCheckpointCheck`) before the check.
 */
export function huntReproTargets(runs: ReadonlyMap<string, Pick<HuntRun, "resolved" | "dir">>, reruns: readonly { dir: string; manifest: unknown }[]): { dir: string; boundary: number }[] {
  const { selected, picks } = huntReproGroups(reruns);
  return selected.flatMap(({ id, histArm }) => {
    const boundary = huntReproBoundaryOf(histArm);
    const run = runs.get(id);
    const rerun = picks.get(id)!.pick;
    const dirs = [...(run?.resolved && run.dir !== null ? [run.dir] : []), ...(rerun === null ? [] : [rerun.dir])];
    return dirs.map((dir) => ({ dir, boundary }));
  });
}

/**
 * The reproducibility check: each selected history (`huntReproSelection`, never replaced) needs its instance bundle resolved and exactly one rerun among
 * `reruns` (the history's seed, 340,000 steps from its start: to boundary 34 for -a, to 134 for -s, branching from the instance's own source; the same configuration, overrides and
 * condition as the instance's, `huntFingerprint`) made on the Mac (its host names darwin). The pre-cycle checkpoint (34 or 134) of the instance and of the rerun
 * is loaded (`o.checkpoint`, the decoded state's hash), each hash is verified against the manifest's entry for that checkpoint, and the two verified hashes must
 * be equal. A missing or corrupt file, a hash that is not its manifest's, a mismatch, a missing or invalid rerun, or an unresolved history fails it.
 */
export function huntReproducibility(
  runs: ReadonlyMap<string, Pick<HuntRun, "resolved" | "hashes" | "fingerprint" | "dir">>,
  reruns: readonly { dir: string; manifest: unknown }[],
  o: { pondDeath: number; checkpoint: (dir: string, boundary: number) => HuntCheckpointCheck },
): HuntReproducibility {
  const { draws } = huntReproSelection();
  const { selected, skipped, picks } = huntReproGroups(reruns);
  const histories = selected.map(({ id, value, histArm }) => {
    const boundary = huntReproBoundaryOf(histArm);
    const run = runs.get(id);
    const { pick, why: refused } = picks.get(id)!;
    const base = { id, value, boundary, instanceHash: null as string | null, rerun: pick === null ? null : pick.dir };
    const fail = (why: string, rerunHash: string | null = null, instanceHash: string | null = null) => ({ ...base, instanceHash, rerunHash, passed: false, why });
    if (!run?.resolved) return fail(`${id} is unresolved, so the check cannot be made`);
    if (pick === null) return fail(refused === "no run bundle" ? `no rerun of ${id}` : `the reruns of ${id}: ${refused}`);
    const found = [pick];
    const problems = huntBundleProblems(found[0].manifest, found[0].role, { pondDeath: o.pondDeath, dir: found[0].dir });
    if (huntConservationOf(found[0].manifest) === false) problems.push("summary.conservationOk false: matter or the energy ledger was not conserved");
    const host = reg1ReportHostOf(found[0].manifest).host;
    if (host?.includes(HUNT_DEVICES.mac) !== true) problems.push(`it ran on host ${JSON.stringify(host)}, not the Mac's (${HUNT_DEVICES.mac})`);
    if (huntFingerprint(found[0].manifest) !== run.fingerprint) problems.push("its configuration, overrides, condition, seed or branch source differ from the instance's run of the same history");
    const manifestRerun = huntBundleHashes(found[0].manifest)[boundary] ?? null;
    if (problems.length > 0) return fail(`the rerun of ${id} is not valid: ${problems.join("; ")}`, manifestRerun);
    const manifestInstance = run.hashes[boundary] ?? null;
    if (manifestInstance === null) return fail(`the instance's manifest records no b${pad3(boundary)}-pre hash`, manifestRerun);
    if (manifestRerun === null) return fail(`the rerun's manifest records no b${pad3(boundary)}-pre hash`);
    // The checkpoints themselves, decoded: each state hash is verified against its manifest's entry, and only then are the two compared.
    if (run.dir === null) return fail(`the instance bundle of ${id} has no directory to load b${pad3(boundary)}-pre from`);
    const verified = (who: string, dir: string, manifestHash: string): { stateHash: string } | { why: string } => {
      const c = o.checkpoint(dir, boundary);
      if ("error" in c) return { why: `${who} ${huntPreCycleFile(boundary)} could not be loaded from ${dir}: ${c.error}` };
      if (c.stateHash !== manifestHash) return { why: `${who} ${huntPreCycleFile(boundary)} in ${dir} hashes to ${c.stateHash}, but its manifest records ${manifestHash}` };
      return c;
    };
    const instance = verified("the instance's", run.dir, manifestInstance);
    if ("why" in instance) return fail(instance.why);
    const rerun = verified("the rerun's", found[0].dir, manifestRerun);
    if ("why" in rerun) return fail(rerun.why, null, instance.stateHash);
    if (rerun.stateHash !== instance.stateHash) return fail(`the rerun's b${pad3(boundary)}-pre hash ${rerun.stateHash} is not the instance's ${instance.stateHash}`, rerun.stateHash, instance.stateHash);
    return { ...base, instanceHash: instance.stateHash, rerunHash: rerun.stateHash, passed: true, why: null };
  });
  const reasons = histories.filter((h) => !h.passed).map((h) => h.why!);
  return { passed: reasons.length === 0, reasons, draws, histories, skipped };
}

// ---------------------------------------------------------------------------------------------
// Stage 0: G1 (viability and selection strength)

/** G1's thresholds ("Stage 0"): boundaries 1-30; occupancy over 2-30 at least 0.5; recolonisation over the recipients of 1-29 at least 0.3; the mean CV over 2-30 at least 0.1. */
export const HUNT_G1 = { boundaries: 30, occupancyFrom: 2, minOccupancy: [1, 2], recolonisationTo: 29, minRecolonisation: [3, 10], strengthFrom: 2, minStrength: 0.1 } as const;

/** One G1 run. */
export interface HuntG1Run {
  id: string;
  arm: "nat" | "shuf";
  seed: number;
  dir: string | null;
  resolved: boolean;
  why: string[];
  conservationOk: boolean | null;
  /** Whether it ended (no pond occupied after a boundary's cycle) and at which boundary; null while unresolved. */
  ended: boolean | null;
  endedAt: number | null;
  occupancy: { boundaries: number; occupied: number; of: number; mean: number | null } | null;
  recolonisation: { recipients: number; successes: number; rate: number | null } | null;
  /** The mean CV of X among exporters over boundaries 2-30 (fewer than two exporters counting 0). */
  selectionStrength: number | null;
  /** nat: viable (not ended, occupancy >= 0.5, recolonisation >= 0.3 and estimable, exact conservation); shuf: not read. Null while unresolved. */
  viable: boolean | null;
  /** nat: selection strength >= 0.1. */
  strength: boolean | null;
  reasons: string[];
  truncation: HuntPondsSummary["truncation"] | null;
  /** Per boundary, for the four runs (descriptive): exporters, the CV, effective donors, Spearman, and the occupancy and recolonisation they ran with. */
  boundaries: { boundary: number; occupied: number; exporters: number; cv: number | null; effectiveDonors: number | null; spearman: number | null; offspring: number[]; recipients: number; truncated: number; recolonisation: HuntBoundary["recolonisation"] }[];
}

/** One run of G1 from its bundle (`HuntRun`): the viability criteria for nat (exact integer comparisons where the threshold is a fraction), exact conservation for shuf. */
export function huntG1Run(run: HuntRun): HuntG1Run {
  const arm: "nat" | "shuf" = run.arm === "shuf" ? "shuf" : "nat";
  const base = { id: run.id, arm, seed: run.seed, dir: run.dir, resolved: run.resolved, why: run.why, conservationOk: run.conservationOk };
  const s = run.ponds;
  if (!run.resolved || s === null) return { ...base, ended: null, endedAt: null, occupancy: null, recolonisation: null, selectionStrength: null, viable: null, strength: null, reasons: [], truncation: null, boundaries: [] };
  const g = HUNT_G1;
  const occupancy = huntOccupancy(s, g.occupancyFrom, g.boundaries);
  const recolonisation = huntRecolonisation(s, 1, g.recolonisationTo);
  const selectionStrength = huntSelectionStrength(s, g.strengthFrom, g.boundaries);
  const reasons: string[] = [];
  if (run.conservationOk !== true) reasons.push(`matter or the ledger was not exact (summary.conservationOk ${JSON.stringify(run.conservationOk)})`);
  let viable: boolean | null = null;
  let strength: boolean | null = null;
  if (arm === "nat") {
    if (s.endedAt !== null) reasons.push(`it ended at boundary ${s.endedAt}`);
    // Mean occupancy >= 1/2 and recolonisation >= 3/10, exactly: 2 occupied >= of, 10 successes >= 3 recipients.
    if (!(g.minOccupancy[1] * occupancy.occupied >= g.minOccupancy[0] * occupancy.of)) reasons.push(`mean occupancy over boundaries ${g.occupancyFrom}-${g.boundaries} is ${occupancy.mean}, below ${g.minOccupancy[0] / g.minOccupancy[1]}`);
    if (recolonisation.rate === null) reasons.push(`no recipient in boundaries 1-${g.recolonisationTo}: recolonisation success is not estimable, and the run is not viable`);
    else if (!(g.minRecolonisation[1] * recolonisation.successes >= g.minRecolonisation[0] * recolonisation.recipients)) reasons.push(`pooled recolonisation success ${recolonisation.successes}/${recolonisation.recipients} is below ${g.minRecolonisation[0] / g.minRecolonisation[1]}`);
    viable = reasons.length === 0;
    strength = selectionStrength !== null && selectionStrength >= g.minStrength;
  } else if (run.conservationOk !== true) viable = false;
  return {
    ...base,
    ended: s.endedAt !== null,
    endedAt: s.endedAt,
    occupancy,
    recolonisation,
    selectionStrength,
    viable,
    strength,
    reasons,
    truncation: s.truncation,
    boundaries: s.boundaries.map((b) => ({ boundary: b.boundary, occupied: b.occupied, exporters: b.exporters, cv: b.cv, effectiveDonors: b.effectiveDonors, spearman: b.spearman, offspring: b.offspring, recipients: b.recipients, truncated: b.truncated, recolonisation: b.recolonisation })),
  };
}

/** A set of four G1 runs (nat s0, s1, shuf s0, s1) as the decision reads it. */
export interface HuntG1Set {
  runs: HuntG1Run[];
  resolved: boolean;
  /** Both nat runs viable; null while a run is unresolved. */
  natViable: boolean | null;
  /** Both nat runs have selection strength (CV >= 0.1). */
  strength: boolean | null;
  /** The nat runs that are viable and lack selection strength: any of them stops the hunt, whatever the other nat run did. Null while a run is unresolved. */
  weak: string[] | null;
  /** Both shuf runs exactly conserved (matter and the ledger), all that shuf needs. */
  shufExact: boolean | null;
  passes: boolean | null;
}

export function huntG1Set(runs: readonly HuntG1Run[]): HuntG1Set {
  const nat = runs.filter((r) => r.arm === "nat");
  const shuf = runs.filter((r) => r.arm === "shuf");
  const resolved = runs.length === 4 && nat.length === 2 && shuf.length === 2 && runs.every((r) => r.resolved);
  if (!resolved) return { runs: [...runs], resolved, natViable: null, strength: null, weak: null, shufExact: null, passes: null };
  const natViable = nat.every((r) => r.viable === true);
  const strength = nat.every((r) => r.strength === true);
  const shufExact = shuf.every((r) => r.conservationOk === true);
  return { runs: [...runs], resolved, natViable, strength, weak: nat.filter((r) => r.viable === true && r.strength !== true).map((r) => r.id), shufExact, passes: natViable && strength && shufExact };
}

export interface HuntG1Decision {
  /** "pass" (at e = 1/2), "pass-fallback" (the hunt continues at e = 1), "stop" (the hunt stops and is reported), "pending" (not decidable yet). */
  decision: "pass" | "pass-fallback" | "stop" | "pending";
  /** The pondDeath Stage 1, D3 and the device check then use (32,768 or 65,536); null unless it passed. */
  pondDeath: number | null;
  reasons: string[];
  /** The fallback's runs were read for the decision. */
  fallbackUsed: boolean;
}

/**
 * G1's decision ("Stage 0"), read literally. At the base pair: if either nat run is viable and lacks selection strength the hunt stops, with no rerun, even
 * when the other nat run is not viable; otherwise, if either nat run is not viable, G1 reruns once with e = 1 and the fallback pair decides (it passes, and the
 * hunt continues at e = 1, only if both its nat runs are viable with selection strength and both its shuf runs conserved exactly, else the hunt stops); otherwise
 * (both nat runs viable and strong) it passes when both shuf runs conserved exactly, else the hunt stops. A set that is missing or unresolved leaves the
 * decision pending.
 */
export function huntG1Decide(base: HuntG1Set | null, fallback: HuntG1Set | null): HuntG1Decision {
  const pending = (reasons: string[], fallbackUsed = false): HuntG1Decision => ({ decision: "pending", pondDeath: null, reasons, fallbackUsed });
  const unresolved = (set: HuntG1Set, label: string): string => `the ${label} G1 runs are not all resolved: ${set.runs.filter((r) => !r.resolved).map((r) => `${r.id} (${r.why.join("; ") || "missing"})`).join(", ") || "four runs (nat s0, s1, shuf s0, s1) are needed"}`;
  const notViable = (set: HuntG1Set, label: string): string[] => set.runs.filter((r) => r.arm === "nat" && r.viable !== true).map((r) => `${label} ${r.id} is not viable: ${r.reasons.join("; ")}`);
  const lacking = (set: HuntG1Set, label: string): string[] => set.runs.filter((r) => set.weak!.includes(r.id)).map((r) => `${label} ${r.id} lacks selection strength (mean CV ${r.selectionStrength}, below ${HUNT_G1.minStrength})`);
  const inexact = (set: HuntG1Set, label: string): string[] => set.runs.filter((r) => r.arm === "shuf" && r.conservationOk !== true).map((r) => `${label} ${r.id} did not conserve matter and the ledger exactly`);
  if (base === null) return pending(["the base G1 runs (--g1) are not given"]);
  if (!base.resolved) return pending([unresolved(base, "base")]);
  // A viable nat run without selection strength stops the hunt outright, whatever the other nat run did.
  if (base.weak!.length > 0) return { decision: "stop", pondDeath: null, reasons: [...lacking(base, "base"), ...notViable(base, "base")], fallbackUsed: false };
  if (base.natViable) {
    if (base.shufExact) return { decision: "pass", pondDeath: HUNT_DEATH.base, reasons: ["both nat runs viable with selection strength; the shuf runs exact"], fallbackUsed: false };
    return { decision: "stop", pondDeath: null, reasons: inexact(base, "base"), fallbackUsed: false };
  }
  const trigger = notViable(base, "base");
  if (fallback === null) return pending([...trigger, "G1 reruns once with e = 1 (--g1-fallback), which is not given"]);
  if (!fallback.resolved) return pending([...trigger, unresolved(fallback, "fallback")], true);
  if (fallback.passes) return { decision: "pass-fallback", pondDeath: HUNT_DEATH.fallback, reasons: [...trigger, "the e = 1 fallback passes: both nat runs viable with selection strength; the shuf runs exact"], fallbackUsed: true };
  return { decision: "stop", pondDeath: null, reasons: [...trigger, ...notViable(fallback, "fallback"), ...lacking(fallback, "fallback"), ...(fallback.natViable ? inexact(fallback, "fallback") : [])], fallbackUsed: true };
}

// ---------------------------------------------------------------------------------------------
// Export-assay sets: expected sets, screening and W

export type HuntStage = "g2" | "d3" | "s1";
export type HuntSetKind = "w" | "quench" | "genome" | "genome-control";

/** One expected set ("Seeds": every set id with its σ formula; "Assay": its source). */
export interface HuntExpectedSet {
  id: string;
  stage: HuntStage;
  /** The set's variant (labels.variant): the export performance W, its quenched control, a genome-only set, or the genome-only control. */
  kind: HuntSetKind;
  /** The history (s1) or D3 run it belongs to; null for G2's sources, the ancestor worlds, the -s sources and the control. */
  owner: string | null;
  /** The run bundle that holds its source checkpoint (the history, D3's world, an ancestor world, or a -s source's own scaffold-phase run, which exists only under the sources rule's fallback) and the checkpoint's boundary; null where the source is no bundle read here. */
  bundle: string | null;
  checkpoint: number | null;
  /** The σ index h of its fragments' seeds: σ(h, s); genome-only sets and their control use ancestor world 0's, h = 96. */
  h: number;
  /** labels.h as the set records it: its σ index (96 for a genome-only set and its control, which share ancestor world 0's fragments and stream). */
  labelH: number | null;
  /** The replicates a set holds: 4 (W, genome), or 1 (quenched: replicate 0 only; an assay.json that records 4 is accepted too). */
  replicates: number;
  fragments: number;
  seeds: { physics: number; fragment: number }[];
  formula: string;
}

const same = (seed: number) => ({ physics: seed, fragment: seed });

/** G2's 18 sets (W of scaf and rand i0-i5, and the six scaf quenched controls) and D3's eight, then Stage 1's 269 (96 + 48 + 96 histories' W, quenched and genome sets, 4 ancestor worlds, 24 sources, the control). */
function buildExpectedSets(): HuntExpectedSet[] {
  const out: HuntExpectedSet[] = [];
  const w = (e: Omit<HuntExpectedSet, "replicates" | "fragments" | "seeds"> & { sigma: (s: number) => number; quench?: boolean }) => {
    const { sigma, quench, ...rest } = e;
    const replicates = quench ? 1 : HUNT_REPLICATES;
    out.push({ ...rest, replicates, fragments: replicates * HUNT_FRAGMENTS, seeds: Array.from({ length: replicates }, (_, s) => same(sigma(s))) });
  };
  for (const [a, arm] of (["scaf", "rand"] as const).entries()) {
    for (let i = 0; i < 6; i++) {
      const h = 6 * a + i;
      const common = { stage: "g2" as const, owner: null, bundle: null, checkpoint: null, h, labelH: h, sigma: (s: number) => huntG2Seed(h, s), formula: "4,900,201 + 10 h + s, h = 6 arm + i (scaf 0, rand 1)" };
      w({ ...common, id: `g2-${arm}-i${i}`, kind: "w" });
      if (arm === "scaf") w({ ...common, id: `g2-${arm}-i${i}-quench`, kind: "quench", quench: true });
    }
  }
  for (const [a, arm] of (["nat", "shuf"] as const).entries()) {
    for (let j = 0; j < 4; j++) w({ id: `d3-${arm}-j${j}`, stage: "d3", kind: "w", owner: `d3-${arm}-j${j}`, bundle: `d3-${arm}-j${j}`, checkpoint: 30, h: 4 * a + j, labelH: 4 * a + j, sigma: (s) => huntD3Seed(arm, j, s), formula: "4,900,501 + 10 (4 arm + j) + s (arm 0 nat, 1 shuf)" });
  }
  for (const histArm of HUNT_ARMS) {
    for (let i = 0; i < HUNT_HISTORIES; i++) {
      const id = huntHistoryId(histArm, i);
      const h = huntH(histArm, i);
      const common = { stage: "s1" as const, owner: id, bundle: id, checkpoint: HUNT_TIME_C, formula: "4,902,001 + 10 h + s" };
      w({ ...common, id: `s1-${id}`, kind: "w", h, labelH: h, sigma: (s) => huntAssaySeed(h, s) });
      if (histArm.startsWith("nat")) w({ ...common, id: `s1-${id}-quench`, kind: "quench", h, labelH: h, quench: true, sigma: (s) => huntAssaySeed(h, s) });
      w({ ...common, id: `s1-${id}-genome`, kind: "genome", h: 96, labelH: 96, sigma: (s) => huntAssaySeed(96, s), formula: "4,902,001 + 10 · 96 + s (ancestor world 0's fragments, in the same physics stream)" });
    }
  }
  for (let j = 0; j < 4; j++) w({ id: `s1-anc-j${j}`, stage: "s1", kind: "w", owner: null, bundle: `ancestor-j${j}`, checkpoint: 1, h: 96 + j, labelH: 96 + j, sigma: (s) => huntAssaySeed(96 + j, s), formula: "4,902,001 + 10 (96 + j) + s" });
  // A -s source is the registration's bundle (read by no one here) or, under the sources rule's fallback, the hunt's own scaffold-phase run scaffold-iNN, whose b100-pre it is.
  for (let i = 0; i < HUNT_HISTORIES; i++) w({ id: `s1-src-i${pad2(i)}`, stage: "s1", kind: "w", owner: null, bundle: `scaffold-i${pad2(i)}`, checkpoint: HUNT_BRANCH, h: 100 + i, labelH: 100 + i, sigma: (s) => huntAssaySeed(100 + i, s), formula: "4,902,001 + 10 (100 + i) + s" });
  w({ id: "s1-genome-control", stage: "s1", kind: "genome-control", owner: null, bundle: null, checkpoint: null, h: 96, labelH: 96, sigma: (s) => huntAssaySeed(96, s), formula: "4,902,001 + 10 · 96 + s (ancestor world 0's fragments)" });
  return out;
}

let expectedSets: HuntExpectedSet[] | null = null;

/** Every set of one stage ("g2": 18, "d3": 8, "s1": 269), in order. */
export function huntExpectedSets(stage: HuntStage): readonly HuntExpectedSet[] {
  return (expectedSets ??= buildExpectedSets()).filter((s) => s.stage === stage);
}

export const huntExpectedSet = (id: string): HuntExpectedSet | undefined => (expectedSets ??= buildExpectedSets()).find((s) => s.id === id);

/** A row of assay.tsv of an export set: the existing assay columns it needs and `exportMass` (X_f). */
export interface HuntFragment {
  assay: string;
  inoculum: string;
  replicate: number;
  pond: number;
  /** The family: the source's exporting pond the fragment came from. */
  family: number;
  retMass: number;
  retE: number | null;
  endTrait: number;
  success: number;
  exportMass: number;
  /** The integer columns of the raw row (`HUNT_INTEGER_CELLS`, read or not) whose cell is no integer; absent when all are. The screen refuses such a set, which still reads as rows. */
  fractional?: string[];
}

/** The integer columns of assay.tsv (v1's and `exportMass`): every mass, energy, count, index and flag is an integer. */
const HUNT_INTEGER_CELLS = ["replicate", "pond", "family", "reqMass", "retMass", "endTrait", "success", "reqE", "retE", "truncated", "exportMass"] as const;

/** A fragment by its raw cells; a missing or non-numeric required column throws (with `exportMass`, which an export set must have). */
export function huntFragmentRow(r: TsvRow): HuntFragment {
  const num = (key: string): number => {
    const v = r[key];
    if (v === undefined) throw new Error(`assay.tsv row has no column "${key}"`);
    const x = Number(v);
    if (v === "" || !Number.isFinite(x)) throw new Error(`assay.tsv column "${key}" is not a number: ${JSON.stringify(v)}`);
    return x;
  };
  const retE = r.retE === undefined || r.retE === "" ? null : num("retE");
  const fractional = HUNT_INTEGER_CELLS.filter((key) => r[key] !== undefined && r[key] !== "" && !Number.isInteger(Number(r[key])));
  return { assay: r.assay, inoculum: r.inoculum, replicate: num("replicate"), pond: num("pond"), family: num("family"), retMass: num("retMass"), retE, endTrait: num("endTrait"), success: num("success"), exportMass: num("exportMass"), ...(fractional.length ? { fractional } : {}) };
}

/** The export performance of a set's fragments ("Assay: export performance W"). */
export interface HuntW {
  /** W: the mean over families of each family's mean X_f, equal weight per family; 0 with no family. */
  W: number;
  families: number;
  fragments: number;
  /** Σ X_f / Σ trait_f over the fragments; 0 when Σ trait = 0. */
  edgeShare: number;
  familyMeans: { family: number; n: number; mean: number }[];
}

/** W of fragments (any order; summed in (replicate, pond) order so equal inputs give identical results). */
export function huntWOf(rows: readonly HuntFragment[]): HuntW {
  const sorted = [...rows].sort((a, b) => a.replicate - b.replicate || a.pond - b.pond);
  const by = new Map<number, { n: number; sum: number }>();
  let x = 0;
  let trait = 0;
  for (const r of sorted) {
    const e = by.get(r.family) ?? { n: 0, sum: 0 };
    e.n++;
    e.sum += r.exportMass;
    by.set(r.family, e);
    x += r.exportMass;
    trait += r.endTrait;
  }
  const familyMeans = [...by].sort(([p], [q]) => p - q).map(([family, e]) => ({ family, n: e.n, mean: e.sum / e.n }));
  return { W: familyMeans.length ? familyMeans.reduce((a, f) => a + f.mean, 0) / familyMeans.length : 0, families: familyMeans.length, fragments: sorted.length, edgeShare: trait > 0 ? x / trait : 0, familyMeans };
}

/** An assay directory as read: its path, assay.json and every assay.tsv row. */
export interface HuntSetDir {
  dir: string;
  json: Record<string, unknown>;
  rows: HuntFragment[];
}

/** A screened set. */
export interface HuntSet {
  id: string;
  dir: string;
  expected: HuntExpectedSet;
  /** The source has no exporting pond (m = 0): a measured outcome with no fragments and W = 0. */
  noFamilies: boolean;
  /** A genome-only set whose donor history has no dominant genome: no fragments, W_G = 0 by definition. */
  noGenome: boolean;
  rows: HuntFragment[];
  /** Recomputed from the rows. */
  w: HuntW;
  /** The export-weighted W the set records (descriptive; it needs the source's X_p, which the rows do not carry); null when not recorded. */
  Wexport: number | null;
  /** The source the set records: its path and state hash (a -s source's are checked across the 24 by `huntSourceProblems`). */
  provenance: { source: string | null; stateHash: string | null };
  /**
   * Whether the set's source was affirmatively authenticated (strict screening only; null when it was not screened strictly, under --allow-any-seed): its recorded state
   * hash equals the hash recorded in the manifest of a bundle that was read and is the protocol's (a history's b200-pre, a -s source's pair or scaffold-phase run), or, for G2,
   * the source is protocol v1's main run of its history (path, seed and step; the report has no bundle of it). A quenched control enters a gate only if this is not false.
   */
  authenticated: boolean | null;
}

/** What a quenched set's fragments show: the fragments with X_f > 0 over all of them ("Validity" 5: more than 5% is Invalid). */
export interface HuntQuench {
  successes: number;
  n: number;
  fraction: number | null;
  above: boolean;
}

/**
 * A set `huntScreenSets` rejected: where it was, its id (null when its labels name no set) and why. A rejected quenched set of the stage whose assay.tsv
 * could be read still carries what its fragments show (`quench`), and so enters the quenched gate (Stage 1) or G2's quench criterion, but only when its protocol
 * membership is established: strict mode, not recording `allowAnySeed`, the regime and the seeds of its id, and a source that is affirmatively authenticated as the run
 * its id names (`HuntSet.authenticated`: its hash equals the manifest's of a bundle that was read; a bundle that is unresolved or not given authenticates nothing). A set
 * rejected for any of those never touches a gate; one rejected for any other reason (a duplicate, a family or row mismatch, a summary mismatch, a protocol pin ...) counts,
 * adversely only (it can fail a gate, never rescue one).
 */
export interface HuntRejected {
  dir: string;
  id: string | null;
  reasons: string[];
  quench?: HuntQuench;
  /** A -s source set's recorded source path, kept only when the set is an authenticated protocol member: its origin still counts when the sources are checked for mixing (`huntSourceProblems`). */
  source?: string;
}

/** A genome-only set's donor history as the report reloaded it, for a noGenome record: its b200-pre state hash and whether it has a dominant genome, or why it could not be read. */
export type HuntDonorCheck = { stateHash: string; dominant: boolean } | { error: string };

const closeTo = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** The boundary of protocol v1's main-run sources of G2 (runs/scaffold/main/<arm>/i<i>/ckpt/b100-pre.blck.gz). */
const HUNT_V1_BOUNDARY = 100;

/**
 * What is wrong with a G2 set's recorded source as protocol v1's main-run checkpoint of the scaf or rand history its id names (strict): `provenance.source`
 * ends in scaffold/main/<arm>/i<i>/ckpt/b100-pre.blck.gz, `provenance.seed` is v1's world seed of that history (4,810,001 + 100 arm + i) and `provenance.step`
 * 1,000,000. The assay checks the whole run record (`hunt1V1SourceProblems`); the report holds the set to what it names.
 */
export function huntV1SourceProblems(arm: "scaf" | "rand", i: number, p: Record<string, unknown>): string[] {
  const why: string[] = [];
  const tail = `scaffold/main/${arm}/i${i}/ckpt/b${HUNT_V1_BOUNDARY}-pre.blck.gz`;
  const seed = HUNT_SEEDS.v1 + 100 * (arm === "scaf" ? 0 : 1) + i;
  if (typeof p.source !== "string" || !(p.source === tail || p.source.endsWith(`/${tail}`))) why.push(`provenance.source ${JSON.stringify(p.source)} does not end in ${tail} (protocol v1's main run of ${arm} i${i})`);
  if (p.seed !== seed) why.push(`provenance.seed ${JSON.stringify(p.seed)}, want ${seed} (protocol v1's world seed of ${arm} i${i})`);
  if (p.step !== HUNT_V1_BOUNDARY * HUNT_PERIOD) why.push(`provenance.step ${JSON.stringify(p.step)}, want ${HUNT_V1_BOUNDARY * HUNT_PERIOD}`);
  return why;
}

/** Where a -s source comes from ("Arms and histories", the sources rule): the registration's scaf history, or the hunt's own scaffold phase. */
export type HuntSourceOrigin = "registration" | "own";

/**
 * The origin of -s source i by the directory of its run bundle: `…/scaffold/reg1/hist[-c100]/ponds/treatment/seed-<4,850,001 + i>` (the registration's scaf
 * history, or its overflow rerun at census 100) or `…/ponds/treatment/seed-<4,901,501 + i>` (the hunt's own scaffold phase, condition treatment); null for any
 * other path.
 */
export function huntSourceOriginOf(path: unknown, i: number): HuntSourceOrigin | null {
  if (typeof path !== "string") return null;
  const dir = path.replace(/\/+$/, "");
  const ends = (tail: string): boolean => dir === tail || dir.endsWith(`/${tail}`);
  const reg = `ponds/treatment/seed-${HUNT_SEEDS.registrationScaf + i}`;
  if (ends(`scaffold/reg1/hist/${reg}`) || ends(`scaffold/reg1/hist-c100/${reg}`)) return "registration";
  return ends(`ponds/treatment/seed-${HUNT_SEEDS.ownScaffold + i}`) ? "own" : null;
}

/** What is wrong with a set's recorded regime (strict): k, period, side, census and mutation off; ref 103,058; the replicates the set holds. */
function huntRegimeProblems(json: Record<string, unknown>, want: HuntExpectedSet): string[] {
  const why: string[] = [];
  const r = HUNT_REGIME;
  for (const [key, value] of [["k", r.k], ["period", r.period], ["side", r.side], ["censusEvery", r.censusEvery], ["mutRate", r.mutRate], ["ref", r.ref]] as const) {
    if (json[key] !== value) why.push(`${key} ${JSON.stringify(json[key])}, want ${value}`);
  }
  // A quenched set holds replicate 0 only; the document's "--replicates 4" may be recorded all the same.
  const reps = want.kind === "quench" ? [1, HUNT_REPLICATES] : [want.replicates];
  if (!reps.includes(json.replicates as number)) why.push(`replicates ${JSON.stringify(json.replicates)}, want ${reps.join(" or ")}`);
  if (json.export !== undefined && json.export !== HUNT_PRESET.pondExport) why.push(`export ${JSON.stringify(json.export)}, want ${HUNT_PRESET.pondExport}`);
  return why;
}

/** What is wrong with a set's recorded seeds against its formula (physics and fragment both σ(h, s), s the replicate). */
function huntSeedProblems(json: Record<string, unknown>, want: HuntExpectedSet, record: boolean): string[] {
  const seeds = json.seeds;
  if (record && (seeds === undefined || (Array.isArray(seeds) && seeds.length === 0))) return [];
  if (!Array.isArray(seeds) || (seeds.length !== want.replicates && !(want.kind === "quench" && seeds.length === HUNT_REPLICATES))) return [`assay.json has ${Array.isArray(seeds) ? seeds.length : "no"} seeds, want ${want.replicates} {physics, fragment}`];
  const why: string[] = [];
  seeds.forEach((sd, s) => {
    const w = same(s < want.seeds.length ? want.seeds[s].physics : want.seeds[0].physics + s);
    if (!isRecord(sd) || sd.physics !== w.physics || sd.fragment !== w.fragment) why.push(`seeds[${s}] ${JSON.stringify(sd)} do not match ${want.id}: want ${JSON.stringify(w)} (${want.formula})`);
  });
  return why;
}

/** The set's recorded fragment grid problems: rows outside replicates x 64, repeated cells, a wrong count. */
function huntGridProblems(rows: readonly HuntFragment[], want: HuntExpectedSet): string[] {
  const why: string[] = [];
  if (rows.length !== want.fragments) why.push(`${rows.length} rows, want ${want.fragments}`);
  const seen = new Set<number>();
  let repeated = 0;
  let outside = 0;
  for (const r of rows) {
    if (!Number.isInteger(r.replicate) || !Number.isInteger(r.pond) || r.replicate < 0 || r.replicate >= want.replicates || r.pond < 0 || r.pond >= HUNT_FRAGMENTS) {
      outside++;
      continue;
    }
    const id = r.replicate * HUNT_FRAGMENTS + r.pond;
    if (seen.has(id)) repeated++;
    else seen.add(id);
  }
  if (repeated > 0) why.push(`assay.tsv repeats a (replicate, pond) in ${repeated} rows`);
  if (outside > 0) why.push(`assay.tsv has ${outside} rows outside the ${want.replicates} x ${HUNT_FRAGMENTS} (replicate, pond) grid`);
  return why;
}

/** What is wrong with the integer columns of a set's rows: every cell of `HUNT_INTEGER_CELLS`, those the report reads and those it does not, must be an integer. */
function huntIntegerProblems(rows: readonly HuntFragment[]): string[] {
  const why: string[] = [];
  for (const key of HUNT_INTEGER_CELLS) {
    const bad = rows.filter((r) => r.fractional?.includes(key) === true || (key === "retE" ? r.retE !== null && !Number.isInteger(r.retE) : key in r && !Number.isInteger((r as unknown as Record<string, number>)[key]))).length;
    if (bad > 0) why.push(`${bad} assay.tsv rows have a non-integer ${key} (every mass, energy, count and flag is an integer)`);
  }
  return why;
}

/**
 * What is wrong with the families of a set's fragments: every family is a pond, and fragment g = 64 replicate + pond came from the family at index
 * g mod m of the families in ascending pond index ("Assay": with m = 64 each pond is a family with four fragments); with `exporters` (the source's
 * exporting ponds at its boundary, from the history's ponds.tsv) they must be exactly those.
 */
function huntFamilyProblems(rows: readonly HuntFragment[], exporters: readonly number[] | null): string[] {
  const why: string[] = [];
  const families = [...new Set(rows.map((r) => r.family))].sort((a, b) => a - b);
  if (families.some((f) => !Number.isInteger(f) || f < 0 || f >= HUNT_PONDS)) why.push(`family values outside the ${HUNT_PONDS} ponds`);
  else {
    const m = families.length;
    const off = m === 0 ? 0 : rows.filter((r) => r.family !== families[(HUNT_FRAGMENTS * r.replicate + r.pond) % m]).length;
    if (off > 0) why.push(`${off} fragments are not from family g mod m (g = 64 replicate + pond, m = ${m}, the families in ascending pond index)`);
  }
  if (exporters !== null && (families.length !== exporters.length || families.some((f, k) => f !== exporters[k]))) why.push(`its families (${families.length}) are not the source's exporting ponds at its boundary (${exporters.length}: ${exporters.slice(0, 8).join(",")}${exporters.length > 8 ? ",..." : ""}) in its ponds.tsv`);
  return why;
}

/**
 * Screens the export sets (labels.hunt1) before a stage reads them. Every problem of a set is collected and the set rejected with its directory, id (null
 * when its labels name no set) and reasons; nothing throws for one bad set. A set needs labels naming one of the expected sets of its stage (`stage`, `set`,
 * `variant`, and `h` for the W and quenched sets), assay "export", rows that fill its (replicate, pond) grid exactly once (256 fragments, a quenched set's 64), the
 * family of every fragment at g mod m, integer finite non-negative masses with X_f at most the fragment's trait, success flags as v1's rule gives them, exact
 * conservation, and a summary that matches the rows (W, families, fragments, edge share, within 1e-9). A source with no exporting pond records `noFamilies` and a
 * genome-only set whose donor has no dominant genome `noGenome`: no rows, W = 0. A rejected quenched set of the stage whose rows were read keeps what they show
 * (`HuntRejected.quench`), for the quenched gate. In strict mode a set that records `allowAnySeed` (a smoke test's) is rejected, and so are:
 * - the regime (k 8, period 10,000, ref 103,058, side 8, census 100, mutation off), every seed against the formula and protocolSha256Hunt1 against `sha`
 *   (the pinned SHA-256);
 * - the recorded source: `provenance.stateHash` against the source bundle's manifest hash when it is resolved, and a W or quenched set's families against that
 *   bundle's exporting ponds; a G2 set's source as protocol v1's main run of its scaf or rand history (`huntV1SourceProblems`); a -s source's path as one of the
 *   two origins (`huntSourceOriginOf`) and its hash as the one the -s histories of its index branched from;
 * - a genome-only set and the genome control, whose fragments are ancestor world 0's: `provenance.stateHash` must be that world's b001-pre hash in its resolved
 *   bundle `ancestor-j0`, else the set is rejected as unresolved; a genome-only set also records its donor, whose `stateHash` must be the history's b200-pre hash in
 *   its manifest, and a noGenome record is believed only once `donors` (the history's b200-pre as the report reloaded it) has that hash and no dominant genome.
 * Two sets that pass with one id are both rejected. `allowAnySeed` (smoke runs) waives the regime, seeds, hash and provenance, never the rows.
 */
export function huntScreenSets(
  dirs: readonly HuntSetDir[],
  o: { stage: HuntStage; sha: string; bundles?: ReadonlyMap<string, Pick<HuntRun, "resolved" | "hashes" | "branch" | "ponds">>; donors?: ReadonlyMap<string, HuntDonorCheck>; allowAnySeed?: boolean },
): { accepted: HuntSet[]; rejected: HuntRejected[] } {
  const strict = !o.allowAnySeed;
  const candidates: HuntSet[] = [];
  const rejected: HuntRejected[] = [];
  for (const d of dirs) {
    const { json, rows } = d;
    const labels = isRecord(json.labels) ? json.labels : null;
    const named = labels !== null && typeof labels.set === "string" ? huntExpectedSet(labels.set) : undefined;
    if (labels === null || labels.hunt1 !== true || named === undefined) {
      rejected.push({ dir: d.dir, id: null, reasons: [labels === null || labels.hunt1 !== true ? "assay.json has no labels.hunt1" : `labels.set ${JSON.stringify(labels.set)} is not one of the hunt's sets`] });
      continue;
    }
    const want = named;
    const why: string[] = [];
    if (labels.stage !== want.stage) why.push(`labels.stage ${JSON.stringify(labels.stage)}, want ${want.stage} for ${want.id}`);
    if (want.stage !== o.stage) why.push(`${want.id} is a ${want.stage} set, but this stage reads ${o.stage} sets`);
    if (labels.variant !== want.kind) why.push(`labels.variant ${JSON.stringify(labels.variant)}, want ${want.kind}`);
    if (want.labelH !== null && labels.h !== want.labelH) why.push(`labels.h ${JSON.stringify(labels.h)}, want ${want.labelH}`);
    if (json.assay !== "export") why.push(`assay ${JSON.stringify(json.assay)}, want export`);
    if (json.conservationOk === false) why.push("conservationOk false: matter or the energy ledger was not conserved");
    const noFamilies = json.noFamilies === true;
    const noGenome = json.noGenome === true;
    const summary = isRecord(json.summary) ? json.summary : {};
    if (noGenome && want.kind !== "genome") why.push(`only a genome-only set can record noGenome, not ${want.id}`);
    if (noFamilies && noGenome) why.push("a set records both noFamilies and noGenome");
    const bundle = want.bundle === null ? undefined : o.bundles?.get(want.bundle);
    const record = noFamilies || noGenome;
    if (record) {
      if (rows.length !== 0) why.push(`${rows.length} rows, want 0 (a ${noFamilies ? "noFamilies" : "noGenome"} record has none)`);
      const exporting = strict && noFamilies && want.kind !== "genome" && want.kind !== "genome-control" && bundle?.resolved && want.checkpoint !== null ? bundle.ponds?.boundaries.find((b) => b.boundary === want.checkpoint)?.exporterPonds : undefined;
      if (exporting !== undefined && exporting.length > 0) why.push(`noFamilies, but ${want.bundle}'s ponds.tsv has ${exporting.length} exporting ponds at boundary ${want.checkpoint}`);
      if (summary.W !== 0) why.push(`summary.W ${JSON.stringify(summary.W)}, want 0 for a ${noFamilies ? "noFamilies" : "noGenome"} record`);
      if (noFamilies && summary.families !== undefined && summary.families !== 0) why.push(`summary.families ${JSON.stringify(summary.families)}, want 0`);
    } else {
      why.push(...huntGridProblems(rows, want));
      for (const r of rows) {
        if (r.assay !== "export") {
          why.push(`assay.tsv rows are not all export rows (${JSON.stringify(r.assay)})`);
          break;
        }
      }
      if (rows.some((r) => r.inoculum !== json.inoculum)) why.push(`assay.tsv rows are not all ${JSON.stringify(json.inoculum)} rows`);
      why.push(...huntIntegerProblems(rows));
      const negative = rows.filter((r) => r.exportMass < 0 || r.endTrait < 0 || r.retMass < 0).length;
      if (negative > 0) why.push(`${negative} assay.tsv rows have a negative mass or trait`);
      const over = rows.filter((r) => r.exportMass > r.endTrait).length;
      if (over > 0) why.push(`${over} assay.tsv rows have exportMass above endTrait`);
      const flagged = rows.filter((r) => r.success !== assaySuccess(r.endTrait, r.retMass, HUNT_REF)).length;
      if (flagged > 0) why.push(`${flagged} assay.tsv rows have a success flag that v1's rule (endTrait >= ref / 4 and >= 4 retMass) does not give`);
      const exporters = strict && want.kind !== "genome" && want.kind !== "genome-control" && bundle?.resolved && want.checkpoint !== null ? (bundle.ponds?.boundaries.find((b) => b.boundary === want.checkpoint)?.exporterPonds ?? null) : null;
      why.push(...huntFamilyProblems(rows, exporters));
    }
    const w = huntWOf(rows);
    if (!record) {
      if (typeof summary.W !== "number" || !closeTo(summary.W, w.W)) why.push(`summary.W ${JSON.stringify(summary.W)} is not the W its rows give (${w.W})`);
      if (summary.families !== w.families) why.push(`summary.families ${JSON.stringify(summary.families)}, its rows have ${w.families} families`);
      if (summary.fragments !== w.fragments) why.push(`summary.fragments ${JSON.stringify(summary.fragments)}, its rows have ${w.fragments}`);
      if (typeof summary.edgeShare !== "number" || !closeTo(summary.edgeShare, w.edgeShare)) why.push(`summary.edgeShare ${JSON.stringify(summary.edgeShare)} is not the share its rows give (${w.edgeShare})`);
    }
    const p = isRecord(json.provenance) ? json.provenance : null;
    // The reasons that say a set is not the hunt's own (a smoke test's, other seeds or regime, another source than the run its id names): a rejected quenched set
    // enters a gate only when none of these holds (`HuntRejected.quench`).
    const foreign: string[] = [];
    let authenticated = false;
    if (strict) {
      // A smoke test's set is never a production set, whatever it holds.
      if (json.allowAnySeed !== undefined && json.allowAnySeed !== false) foreign.push(`assay.json records allowAnySeed ${JSON.stringify(json.allowAnySeed)}: a set made under --allow-any-seed is a smoke test's, never a production one`);
      foreign.push(...huntRegimeProblems(json, want));
      foreign.push(...huntSeedProblems(json, want, record));
      if (json.protocolSha256Hunt1 !== o.sha) why.push(`protocolSha256Hunt1 ${JSON.stringify(json.protocolSha256Hunt1)} is not the pinned SHA-256 of ${HUNT1_PROTOCOL.doc} (${o.sha})`);
      if (p === null || typeof p.stateHash !== "string" || p.stateHash === "") foreign.push("assay.json records no provenance.stateHash of its source");
      else if (want.kind !== "genome" && want.kind !== "genome-control" && bundle?.resolved && want.checkpoint !== null && bundle.hashes[want.checkpoint] !== undefined && p.stateHash !== bundle.hashes[want.checkpoint]) {
        foreign.push(`provenance.stateHash ${p.stateHash} is not ${want.bundle}'s b${pad3(want.checkpoint)}-pre hash ${bundle.hashes[want.checkpoint]} in its manifest`);
      }
      // G2 reads protocol v1's main runs, the scaf or rand history the id names.
      const g2 = /^g2-(scaf|rand)-i([0-5])/.exec(want.id);
      if (g2 !== null && p !== null) foreign.push(...huntV1SourceProblems(g2[1] as "scaf" | "rand", Number(g2[2]), p));
      // A -s source's W set reads the source the pair of -s histories branched from (their manifests record its hash), from one of the two origins.
      const src = /^s1-src-i(\d\d)$/.exec(want.id);
      const pairHashes: string[] = [];
      if (src !== null && p !== null) {
        if (typeof p.stateHash === "string") {
          pairHashes.push(...[`nat-s-i${src[1]}`, `shuf-s-i${src[1]}`].map((id) => o.bundles?.get(id)).filter((b) => b?.resolved && b.branch !== null).map((b) => b!.branch!.sourceHash));
          if (pairHashes.some((h) => h !== p.stateHash)) foreign.push(`provenance.stateHash ${p.stateHash} is not the source hash ${pairHashes.find((h) => h !== p.stateHash)} that the -s histories of index ${src[1]} branched from`);
        }
        if (huntSourceOriginOf(p.source, Number(src[1])) === null) foreign.push(`provenance.source ${JSON.stringify(p.source)} is neither the registration's scaf history ${Number(src[1])} (…/scaffold/reg1/hist[-c100]/ponds/treatment/seed-${HUNT_SEEDS.registrationScaf + Number(src[1])}) nor the hunt's own scaffold-phase run (…/ponds/treatment/seed-${HUNT_SEEDS.ownScaffold + Number(src[1])})`);
      }
      why.push(...foreign);
      // Affirmative authentication of the source (`HuntSet.authenticated`): its recorded hash is the manifest's hash of a bundle that was read and is the protocol's.
      const recorded = p !== null && typeof p.stateHash === "string" && p.stateHash !== "" ? p.stateHash : null;
      if (recorded !== null && foreign.length === 0) {
        if (g2 !== null) authenticated = true; // protocol v1's main run by its path, seed and step (`huntV1SourceProblems` held): the report has no manifest of it
        else if (src !== null) authenticated = pairHashes.includes(recorded) || (bundle?.resolved === true && want.checkpoint !== null && bundle.hashes[want.checkpoint] === recorded);
        else if (want.kind !== "genome" && want.kind !== "genome-control") authenticated = bundle?.resolved === true && want.checkpoint !== null && bundle.hashes[want.checkpoint] === recorded;
      }
      // A genome-only set and the control plant ancestor world 0's fragments: their source is its b001-pre, in a resolved bundle, else the set is unresolved.
      if (want.kind === "genome" || want.kind === "genome-control") {
        const anc = o.bundles?.get("ancestor-j0");
        const ancHash = anc?.resolved ? anc.hashes[1] : undefined;
        if (ancHash === undefined) why.push(`${want.id} plants fragments of ancestor world 0, but its bundle ancestor-j0 ${anc === undefined ? "was not given" : anc.resolved ? "lists no b001-pre hash" : "is not resolved"}: its source cannot be checked, so the set is unresolved`);
        else if (p !== null && typeof p.stateHash === "string" && p.stateHash !== ancHash) why.push(`provenance.stateHash ${p.stateHash} is not ancestor-j0's b001-pre hash ${ancHash} in its manifest`);
      }
      // A genome-only set records the history it took the genome from, at its b200-pre.
      if (want.kind === "genome") {
        const donor = p !== null && isRecord(p.donor) ? p.donor : null;
        const manifestHash = bundle?.resolved ? bundle.hashes[HUNT_TIME_C] : undefined;
        if (donor === null || typeof donor.stateHash !== "string" || donor.stateHash === "") why.push(`assay.json records no provenance.donor.stateHash of ${want.bundle}'s b${pad3(HUNT_TIME_C)}-pre`);
        else if (manifestHash !== undefined && donor.stateHash !== manifestHash) why.push(`provenance.donor.stateHash ${donor.stateHash} is not ${want.bundle}'s b${pad3(HUNT_TIME_C)}-pre hash ${manifestHash} in its manifest`);
        if (noGenome) {
          // "No dominant genome" is seen on the checkpoint, never taken from the record alone.
          if (donor !== null && donor.dominant !== null) why.push(`provenance.donor.dominant ${JSON.stringify(donor.dominant)}, want null (no eligible cell) for a noGenome record`);
          const check = want.bundle === null ? undefined : o.donors?.get(want.bundle);
          if (check === undefined) why.push(`a noGenome record needs its donor ${want.bundle}'s b${pad3(HUNT_TIME_C)}-pre reloaded, to see that it has no dominant genome, but the report could not reach it`);
          else if ("error" in check) why.push(`donor ${want.bundle}'s b${pad3(HUNT_TIME_C)}-pre could not be read: ${check.error}`);
          else {
            if (manifestHash === undefined || check.stateHash !== manifestHash) why.push(`donor ${want.bundle}'s b${pad3(HUNT_TIME_C)}-pre hashes to ${check.stateHash}, but its manifest records ${manifestHash ?? "no hash (the bundle is not resolved)"}`);
            if (donor !== null && typeof donor.stateHash === "string" && check.stateHash !== donor.stateHash) why.push(`donor ${want.bundle}'s b${pad3(HUNT_TIME_C)}-pre hashes to ${check.stateHash}, but the record names ${donor.stateHash}`);
            if (check.dominant) why.push(`donor ${want.bundle} has a dominant genome, so its genome-only set is not a noGenome record`);
          }
        }
      }
    }
    // Protocol membership is established (strict mode, none of `foreign`) for a quenched set of this stage: whatever else is wrong with it, its rows count at the gates.
    const member = strict && foreign.length === 0 && authenticated;
    if (why.length > 0) rejected.push({ dir: d.dir, id: want.id, reasons: why, ...(want.kind === "quench" && want.stage === o.stage && member ? { quench: huntQuenchStat({ rows }) } : {}), ...(/^s1-src-i\d\d$/.test(want.id) && member && typeof p?.source === "string" ? { source: p.source } : {}) });
    else candidates.push({ id: want.id, dir: d.dir, expected: want, noFamilies, noGenome, rows, w, Wexport: typeof summary.Wexport === "number" ? summary.Wexport : null, provenance: { source: typeof p?.source === "string" ? p.source : null, stateHash: typeof p?.stateHash === "string" ? p.stateHash : null }, authenticated: strict ? authenticated : null });
  }
  // Two sets for one id are ambiguous: neither is used, and the set is unresolved.
  const accepted: HuntSet[] = [];
  for (const c of candidates) {
    const dup = candidates.filter((x) => x.id === c.id);
    if (dup.length > 1) rejected.push({ dir: c.dir, id: c.id, reasons: [`the same hunt set (${c.id}) as ${dup.filter((x) => x !== c).map((x) => x.dir).join(", ")}; a stage would count both`], ...(c.expected.kind === "quench" && c.authenticated === true ? { quench: huntQuenchStat(c) } : {}), ...(c.provenance.source !== null && c.authenticated === true && /^s1-src-i\d\d$/.test(c.id) ? { source: c.provenance.source } : {}) });
    else accepted.push(c);
  }
  return { accepted, rejected };
}

/** One expected set as the rule reads it. */
export interface HuntSetStatus {
  id: string;
  kind: HuntSetKind;
  owner: string | null;
  /** "measured" (screened, its source bundle resolved where one is read) or "unresolved" (missing, rejected, or its source bundle unresolved). */
  status: "measured" | "unresolved";
  why: string | null;
  dir: string | null;
}

/**
 * Every expected set's status ("Validity" 4): a set that is missing or rejected (`rejected` names its id, with the reasons carried) is unresolved, never
 * dropped; so is a history's or D3 world's set whose source bundle (`runs`, by id) is missing or unresolved, since its source cannot be the manifest-recorded one.
 * An ancestor world's bundle is read when given and a -s source has none here (a source set is judged by `huntSourceProblems`); the genome-only sets and the
 * control need ancestor-j0's bundle, or `huntScreenSets` rejects them (unresolved).
 */
export function huntStatuses(stage: HuntStage, sets: readonly HuntSet[], rejected: readonly { id: string | null; reasons: string[] }[], runs: ReadonlyMap<string, Pick<HuntRun, "resolved">>): HuntSetStatus[] {
  const byId = new Map(sets.map((s) => [s.id, s]));
  return huntExpectedSets(stage).map((want): HuntSetStatus => {
    const base = { id: want.id, kind: want.kind, owner: want.owner };
    const set = byId.get(want.id);
    if (!set) {
      const rej = rejected.filter((r) => r.id === want.id);
      return { ...base, status: "unresolved", why: rej.length ? `set rejected: ${rej.flatMap((r) => r.reasons).join("; ")}` : "no assay set", dir: null };
    }
    if (want.owner !== null && want.bundle !== null && !runs.get(want.bundle)?.resolved) return { ...base, status: "unresolved", why: `its source bundle ${want.bundle} (${runs.has(want.bundle) ? "unresolved" : "not found"}) is not resolved`, dir: set.dir };
    return { ...base, status: "measured", why: null, dir: set.dir };
  });
}

// ---------------------------------------------------------------------------------------------
// Stage 0: G2 and D3

/** One set's quenched fragments (the share of fragments with X_f > 0). */
export function huntQuenchStat(set: Pick<HuntSet, "rows">): HuntQuench {
  const successes = set.rows.filter((r) => r.exportMass > 0).length;
  const n = set.rows.length;
  // At most 5%, exactly: 20 successes <= n.
  return { successes, n, fraction: n > 0 ? successes / n : null, above: 20 * successes > n };
}

export interface HuntG2Result {
  /** "pass" (W(scaf i) > W(rand i) for at least 5 of the 6 indices and every scaf quenched set at most 5%), "fail", or "pending" (a set is missing or rejected and the criteria are not already failed). */
  decision: "pass" | "fail" | "pending";
  reasons: string[];
  pairs: { i: number; scaf: number | null; rand: number | null; greater: boolean | null; unresolved: string[] }[];
  wins: number;
  /**
   * The six scaf quenched controls (screened, else null), then one entry per quenched set rejected at screening whose rows were read (`rejected`: why, with its
   * `dir`): it still counts for the criterion, where it can fail G2 and never rescue it.
   */
  quenched: { id: string; successes: number | null; n: number | null; fraction: number | null; above: boolean | null; rejected?: string[]; dir?: string }[];
  unresolved: string[];
}

/**
 * G2 ("Stage 0"): W(scaf i) > W(rand i) for at least 5 of 6 indices (a tie is not greater), and X_f > 0 in at most 5% of each scaf source's quenched fragments.
 * A quenched set rejected at screening whose assay.tsv could be read (`rejected`, `HuntRejected.quench`) still enters the quench criterion, listed with why it was
 * rejected: above 5% it fails G2, and it never rescues it (the set stays unresolved, so G2 cannot pass on it).
 */
export function huntG2Decide(sets: readonly HuntSet[], statuses: readonly HuntSetStatus[], rejected: readonly HuntRejected[] = []): HuntG2Result {
  const byId = new Map(sets.map((s) => [s.id, s]));
  const status = new Map(statuses.map((s) => [s.id, s]));
  const gone = (id: string): string | null => (status.get(id)?.status === "unresolved" || !byId.has(id) ? `${id}: ${status.get(id)?.why ?? "no assay set"}` : byId.get(id)!.authenticated === false ? `${id}: its source is not authenticated` : null);
  const pairs = Array.from({ length: 6 }, (_, i) => {
    const sid = `g2-scaf-i${i}`;
    const rid = `g2-rand-i${i}`;
    const unresolved = [gone(sid), gone(rid)].filter((x): x is string => x !== null);
    const scaf = unresolved.length ? null : byId.get(sid)!.w.W;
    const rand = unresolved.length ? null : byId.get(rid)!.w.W;
    return { i, scaf, rand, greater: scaf === null || rand === null ? null : scaf > rand, unresolved };
  });
  const wins = pairs.filter((p) => p.greater === true).length;
  const losses = pairs.filter((p) => p.greater === false).length;
  const quenched: HuntG2Result["quenched"] = Array.from({ length: 6 }, (_, i) => {
    const id = `g2-scaf-i${i}-quench`;
    const q = gone(id) === null ? huntQuenchStat(byId.get(id)!) : null;
    return { id, successes: q?.successes ?? null, n: q?.n ?? null, fraction: q?.fraction ?? null, above: q?.above ?? null };
  });
  for (const r of rejected) if (r.quench !== undefined && r.id !== null && /^g2-scaf-i[0-5]-quench$/.test(r.id)) quenched.push({ id: r.id, ...r.quench, rejected: r.reasons, dir: r.dir });
  const unresolved = [...pairs.flatMap((p) => p.unresolved), ...Array.from({ length: 6 }, (_, i) => gone(`g2-scaf-i${i}-quench`)).filter((x): x is string => x !== null)];
  const reasons: string[] = [];
  const quenchFailed = quenched.filter((q) => q.above === true);
  for (const q of quenchFailed) reasons.push(`the quenched control ${q.id} has X_f > 0 in ${q.successes} of ${q.n} fragments, above 5%${q.rejected === undefined ? "" : ` (the set was rejected at screening: ${q.rejected.join("; ")})`}`);
  if (losses >= 2) reasons.push(`W(scaf i) > W(rand i) fails for ${losses} of 6 indices (5 are needed)`);
  const decision = quenchFailed.length > 0 || losses >= 2 ? "fail" : unresolved.length > 0 ? "pending" : wins >= 5 ? "pass" : "fail";
  if (decision === "pass") reasons.push(`W(scaf i) > W(rand i) for ${wins} of 6 indices; every scaf quenched control at most 5%`);
  if (decision === "pending") reasons.push(`${unresolved.length} sets are missing or rejected: ${unresolved.slice(0, 5).join("; ")}${unresolved.length > 5 ? "; ..." : ""}`);
  if (decision === "fail" && reasons.length === 0) reasons.push(`W(scaf i) > W(rand i) for only ${wins} of 6 indices (5 are needed)`);
  return { decision, reasons, pairs, wins, quenched, unresolved };
}

/** D3 ("Stage 0", no gate): the four history-level differences in W (nat j - shuf j) and the spread of W among the four nat histories. */
export function huntD3Describe(sets: readonly HuntSet[], statuses: readonly HuntSetStatus[]) {
  const byId = new Map(sets.map((s) => [s.id, s]));
  const measured = (id: string): HuntSet | null => (statuses.find((s) => s.id === id)?.status === "measured" ? (byId.get(id) ?? null) : null);
  const worlds = [0, 1, 2, 3].map((j) => {
    const nat = measured(`d3-nat-j${j}`);
    const shuf = measured(`d3-shuf-j${j}`);
    return { j, nat: nat?.w.W ?? null, shuf: shuf?.w.W ?? null, Wexport: { nat: nat?.Wexport ?? null, shuf: shuf?.Wexport ?? null }, difference: nat && shuf ? nat.w.W - shuf.w.W : null, families: { nat: nat?.w.families ?? null, shuf: shuf?.w.families ?? null } };
  });
  const nat = worlds.map((w) => w.nat).filter((x): x is number => x !== null);
  const m = nat.length ? mean(nat) : null;
  const diffs = worlds.map((w) => w.difference).filter((x): x is number => x !== null);
  return {
    note: "descriptive; D3 informs interpretation and never decides",
    worlds,
    differences: diffs,
    positive: diffs.filter((d) => d > 0).length,
    natSpread: { n: nat.length, min: nat.length ? Math.min(...nat) : null, max: nat.length ? Math.max(...nat) : null, range: nat.length ? Math.max(...nat) - Math.min(...nat) : null, mean: m, sd: m === null ? null : Math.sqrt(mean(nat.map((x) => (x - m) * (x - m)))) },
  };
}

// ---------------------------------------------------------------------------------------------
// Stage 1: heredity, the tests and the outcome

/** Heredity per history ("Heredity": ICC(1) of X_f with families as groups, a Monte Carlo permutation p). */
export interface HuntHeredity {
  n: number;
  families: number;
  icc: number | null;
  p: number | null;
  /** The permutation test was run (at least two families, no family with one fragment, X_f not constant). */
  tested: boolean;
  why: string | null;
  /** ICC > 0 and p < 0.05. */
  demonstrated: boolean;
}

/**
 * The heredity statistic of one history's fragments (R1's order: replicate 0's f = 0..63, then replicate 1's, ...): the unequal-size ICC(1) of X_f with
 * families as groups and its p over 1,000 Fisher-Yates permutations of the family labels, R1's scheme (`permutationP`) on the stream σ(h, 8):
 * p = (1 + #{permuted ICC >= observed}) / 1001. Not significant, without a test, with a constant X_f over a non-empty table (ICC 0 by the frozen definition, p null,
 * whatever the families), fewer than two families (ICC not defined) or a family with only one fragment (ICC not defined).
 */
export function huntHeredity(rows: readonly HuntFragment[], h: number, permutations = HUNT_PERMUTATIONS): HuntHeredity {
  const frag = [...rows].sort((a, b) => a.replicate - b.replicate || a.pond - b.pond);
  const counts = new Map<number, number>();
  for (const r of frag) counts.set(r.family, (counts.get(r.family) ?? 0) + 1);
  const base = { n: frag.length, families: counts.size, icc: null, p: null, tested: false, demonstrated: false };
  const x = frag.map((r) => r.exportMass);
  // The frozen ICC is 0 when every value is equal: reported as 0, with no test and not significant, before the family-count exits (one family of 256 equal values too).
  if (x.length > 0 && x.every((v) => v === x[0])) return { ...base, icc: 0, why: "X_f is constant across all fragments" };
  if (counts.size < 2) return { ...base, why: "fewer than two families" };
  if ([...counts.values()].some((c) => c < 2)) return { ...base, why: "a family has only one fragment" };
  const res = permutationP(x, frag.map((r) => r.family), huntAssaySeed(h, 8), permutations);
  if (res === null) return { ...base, why: "the ICC is undefined" };
  return { ...base, icc: res.icc, p: res.p, tested: true, why: null, demonstrated: res.icc > 0 && res.p < HUNT_ALPHA };
}

/** Every input value must be finite before any test ("Stage 1 tests": Inputs). */
function huntFinite(name: string, xs: readonly number[]): void {
  for (const x of xs) if (!Number.isFinite(x)) throw new Error(`${name}: input ${x} is not finite`);
}

/** The exact one-sided Mann-Whitney p that `xs` tend to exceed `ys` (`mannWhitney(…, "exact").pGreater`), with the effect P(X > Y) (ties half). */
export function huntMannWhitney(xs: readonly number[], ys: readonly number[]): { p: number; effect: number } {
  huntFinite("huntMannWhitney", xs);
  huntFinite("huntMannWhitney", ys);
  const r = mannWhitney([...xs], [...ys], "exact");
  return { p: r.pGreater, effect: r.effect };
}

/** The exact one-sided Wilcoxon signed-rank p that the differences are above 0 (`wilcoxonSignedRank(d, "exact").pGreater`); zero differences are dropped (n counts the rest). */
export function huntSignedRank(d: readonly number[]): { p: number; n: number; zeros: number; positive: number; negative: number } {
  huntFinite("huntSignedRank", d);
  const r = wilcoxonSignedRank([...d], "exact");
  return { p: r.pGreater, n: r.n, zeros: d.length - r.n, positive: d.filter((x) => x > 0).length, negative: d.filter((x) => x < 0).length };
}

/** The outcome table ("Outcomes and disposition"), in order: the first three rows apply to the whole stage, first match. */
export const HUNT_OUTCOMES = [
  { outcome: "Stopped at Stage 0", statement: "G1 (with its fallback) or G2 failed.", next: "Report; any redesign only by dated amendment." },
  { outcome: "Invalid", statement: "The device, quenched or reproducibility check failed.", next: "Report; no claim." },
  { outcome: "Uninformative", statement: "More than 6 unresolved histories in an arm, or the budget stopped the queue.", next: "Report; decide whether to complete." },
] as const;
export type HuntOutcome = "Invalid" | "Uninformative" | "incomplete" | "analysed";

/** The contrast statuses ("Outcomes and disposition"): each contrast, A and S, is one of these. */
export const HUNT_CONTRAST_STATUSES = [
  { status: "Hit", statement: "Higher export performance under export-proportional selection than under shuffled weights, from that origin: a candidate seed.", next: "Stage 2: a registration draft replicating it on fresh histories (24 per arm, α = 0.01), then discrimination (genome, structure, cell-level spread) and the M7 question; each a separate dated decision." },
  { status: "No hit", statement: "Not found from that origin in this regime within its histories.", next: "Candidates: e = 1, longer histories, a multi-founder start, a different export zone; each a separate dated decision." },
  { status: "Not assessed", statement: "An unresolved value entered the comparison.", next: "Report; decide whether to rerun." },
] as const;
export type HuntContrastStatus = (typeof HUNT_CONTRAST_STATUSES)[number]["status"];

/** The one definition of "unresolved" the readout states ("Validity, missing data and availability" 4). */
export const HUNT_UNRESOLVED =
  "A history is unresolved when its run bundle or any of its sets is (every history: its W set and genome set; a nat history: also its quenched control), and a set when it is missing, rejected or reads an unresolved bundle. A -s history is also unresolved when its pair's source set (s1-src-iNN) is missing, rejected or records another state hash than the pair branched from, when its source hash is another index's, when the hunt's own scaffold-phase source it names is unresolved, and every -s history is when the 24 sources mix the registration's origin with the hunt's own. That count decides the more-than-6 rule per arm (nat-a, shuf-a, nat-s, shuf-s). A Mann-Whitney or signed-rank value (W, W_G, edge share) is unresolved when its own bundle or set is (W and edge share: also, for a nat history, its quenched control), and a comparison that would include one is not assessed, with Holm slot p = 1; in Heredity an unresolved history counts as not significant and in Improvement as not improved, the denominator fixed at 24 (Improvement also reads the -s source's own W set).";

/** One entry of a rank test: a history's value, or why it is unresolved. */
interface HuntEntry {
  id: string;
  gone: string | null;
  value: number | null;
}

/** A two-sample Mann-Whitney contrast over entries: not assessed (p null) when an unresolved value would enter it. */
function huntTwoSample(a: readonly HuntEntry[], b: readonly HuntEntry[]) {
  const unresolved = [...a, ...b].filter((e) => e.gone !== null).map((e) => e.id);
  const medians = { nat: median(a.filter((e) => e.value !== null).map((e) => e.value!)) , shuf: median(b.filter((e) => e.value !== null).map((e) => e.value!)) };
  const nan = (x: number) => (Number.isNaN(x) ? null : x);
  const out = { test: "mann-whitney" as const, assessed: false, p: null as number | null, effect: null as number | null, n: { nat: a.length, shuf: b.length }, unresolved, medians: { nat: nan(medians.nat), shuf: nan(medians.shuf) } };
  if (unresolved.length > 0) return out;
  const r = huntMannWhitney(a.map((e) => e.value!), b.map((e) => e.value!));
  return { ...out, assessed: true, p: r.p, effect: r.effect };
}

/** A paired signed-rank contrast: d_i = a_i - b_i, zeros dropped; not assessed when an unresolved value would enter it. */
function huntPaired(a: readonly HuntEntry[], b: readonly HuntEntry[]) {
  const unresolved = [...a, ...b].filter((e) => e.gone !== null).map((e) => e.id);
  const out = { test: "signed-rank" as const, assessed: false, p: null as number | null, n: a.length, pairs: 0, zeros: 0, positive: 0, negative: 0, unresolved, differences: [] as number[] };
  if (unresolved.length > 0) return out;
  const d = a.map((e, k) => e.value! - b[k].value!);
  const r = huntSignedRank(d);
  return { ...out, assessed: true, p: r.p, pairs: r.n, zeros: r.zeros, positive: r.positive, negative: r.negative, differences: d };
}

/** The tests on the screened sets, and the statuses they decide (`huntTests`). */
export interface HuntTests {
  reasons: string[];
  primary: {
    alpha: number;
    A: ReturnType<typeof huntTwoSample> & { status: HuntContrastStatus; slot: number; holm: number };
    S: ReturnType<typeof huntPaired> & { status: HuntContrastStatus; slot: number; holm: number };
  };
  secondary: {
    alpha: number;
    note: string;
    family: number;
    tests: { id: string; kind: string; assessed: boolean; p: number | null; slot: number; holm: number; significant: boolean }[];
    genome: unknown;
    heredity: unknown;
    edgeShare: unknown;
    improvement: unknown;
  };
}

/**
 * Stage 1's tests over the screened sets ("Stage 1 tests"), with one definition of unresolved (`HUNT_UNRESOLVED`). Contrast A is the exact one-sided
 * Mann-Whitney test of W(nat-a) against W(shuf-a), 24 against 24; contrast S the exact one-sided signed-rank test of d_i = W(nat-s i) - W(shuf-s i) over
 * the 24 pairs, zero differences dropped; Holm over the two at 0.05, a hit at adjusted p <= 0.05, "not assessed" (slot p = 1) when an unresolved value
 * enters the comparison. The seven secondary tests have their own Holm family at 0.05 and never change a hit: the genome composite (Mann-Whitney on
 * W_G of the -a arms and signed-rank on the -s pairs, read as genome performance only when every history of both arms has a genome), heredity (per nat arm
 * the count of histories with ICC > 0 and permutation p < 0.05 among 24, an unresolved history not significant, the binomial upper tail at 0.05), edge share
 * (Mann-Whitney and signed-rank on E_h) and improvement (the sign test on the 24 sources i with W(nat-s i) > W(source i)).
 */
export function huntTests(sets: readonly HuntSet[], statuses: readonly HuntSetStatus[], histories: readonly HuntHistoryStatus[]): HuntTests {
  const setById = new Map(sets.map((s) => [s.id, s]));
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const historyById = new Map(histories.map((h) => [h.id, h]));
  const reasons: string[] = [];
  const status = (id: string) => statusById.get(id) ?? { id, status: "unresolved" as const, why: "not an expected set", dir: null };
  const sid = (histArm: HuntArm, i: number, suffix = "") => `s1-${huntHistoryId(histArm, i)}${suffix}`;
  /** Why the history's bundle is unresolved (it is listed as "<id> run"), or null. */
  const bundleGone = (id: string): string | null => (historyById.get(id)?.unresolved.includes(`${id} run`) !== false ? `${id} run is unresolved` : null);
  /** Why a W-type value (W, edge share, heredity) of a history is unresolved: its bundle, its W set, or (nat) its quenched control. */
  const wGone = (histArm: HuntArm, i: number): string | null => {
    const id = huntHistoryId(histArm, i);
    const ids = [sid(histArm, i), ...(huntRegimeOf(histArm) === "nat" ? [sid(histArm, i, "-quench")] : [])];
    const bad = ids.filter((x) => status(x).status === "unresolved").map((x) => `${x}: ${status(x).why}`);
    const b = bundleGone(id);
    return b !== null || bad.length ? [b, ...bad].filter((x): x is string => x !== null).join("; ") : null;
  };
  /** Why a W_G value is unresolved: its bundle or its genome set. */
  const gGone = (histArm: HuntArm, i: number): string | null => {
    const id = huntHistoryId(histArm, i);
    const g = sid(histArm, i, "-genome");
    const b = bundleGone(id);
    const bad = status(g).status === "unresolved" ? `${g}: ${status(g).why}` : null;
    return b !== null || bad !== null ? [b, bad].filter((x): x is string => x !== null).join("; ") : null;
  };
  /**
   * Why a history is unresolved at all (the count tests, Heredity and Improvement, need its whole unresolved list empty: bundle, W set, quenched control and
   * genome set alike, as `huntHistoryStatuses` lists it), or null.
   */
  const anyGone = (histArm: HuntArm, i: number): string | null => {
    const id = huntHistoryId(histArm, i);
    const h = historyById.get(id);
    if (h === undefined) return `${id} run is unresolved`;
    if (h.unresolved.length === 0) return null;
    return h.unresolved.map((u) => (u === `${id} run` ? `${u} is unresolved` : `${u}: ${status(u).why}`)).join("; ");
  };
  const wEntry = (histArm: HuntArm, i: number, pick: (s: HuntSet) => number): HuntEntry => {
    const gone = wGone(histArm, i);
    return { id: huntHistoryId(histArm, i), gone, value: gone === null ? pick(setById.get(sid(histArm, i))!) : null };
  };
  const gEntry = (histArm: HuntArm, i: number): HuntEntry => {
    const gone = gGone(histArm, i);
    return { id: huntHistoryId(histArm, i), gone, value: gone === null ? setById.get(sid(histArm, i, "-genome"))!.w.W : null };
  };
  const idx = Array.from({ length: HUNT_HISTORIES }, (_, i) => i);
  const entries = (histArm: HuntArm, f: (histArm: HuntArm, i: number) => HuntEntry) => idx.map((i) => f(histArm, i));
  const W = (s: HuntSet) => s.w.W;
  const E = (s: HuntSet) => s.w.edgeShare;

  const wA = huntTwoSample(entries("nat-a", (a, i) => wEntry(a, i, W)), entries("shuf-a", (a, i) => wEntry(a, i, W)));
  const wS = huntPaired(entries("nat-s", (a, i) => wEntry(a, i, W)), entries("shuf-s", (a, i) => wEntry(a, i, W)));
  const [hA, hS] = holm([wA.p ?? 1, wS.p ?? 1]);
  const contrast = (assessed: boolean, adjusted: number): HuntContrastStatus => (!assessed ? "Not assessed" : adjusted <= HUNT_ALPHA ? "Hit" : "No hit");
  const primary = {
    alpha: HUNT_ALPHA,
    A: { ...wA, status: contrast(wA.assessed, hA), slot: wA.p ?? 1, holm: hA },
    S: { ...wS, status: contrast(wS.assessed, hS), slot: wS.p ?? 1, holm: hS },
  };
  const fmt = (p: number) => p.toPrecision(3);
  for (const [name, c] of [["A (nat-a against shuf-a)", primary.A], ["S (nat-s against shuf-s)", primary.S]] as const) {
    reasons.push(c.assessed ? `contrast ${name}: ${c.status}: p ${fmt(c.p!)}, Holm ${fmt(c.holm)}` : `contrast ${name}: Not assessed (an unresolved value enters it: ${c.unresolved.slice(0, 4).join(", ")}${c.unresolved.length > 4 ? ", ..." : ""}): Holm slot p = 1`);
  }

  // Genome composite: availability per arm, and the reading rule.
  const gEntries = Object.fromEntries(HUNT_ARMS.map((a) => [a, entries(a, gEntry)])) as Record<HuntArm, HuntEntry[]>;
  const hasGenome = (a: HuntArm, i: number) => gEntries[a][i].gone === null && !setById.get(sid(a, i, "-genome"))!.noGenome;
  const availability = Object.fromEntries(HUNT_ARMS.map((a) => [a, { histories: HUNT_HISTORIES, withGenome: idx.filter((i) => hasGenome(a, i)).length, withoutGenome: idx.filter((i) => gEntries[a][i].gone === null && !hasGenome(a, i)).length, unresolved: idx.filter((i) => gEntries[a][i].gone !== null).length }]));
  const reading = (a: HuntArm, b: HuntArm) => (availability[a].withGenome === HUNT_HISTORIES && availability[b].withGenome === HUNT_HISTORIES ? "genome performance" : "composite of genome availability and genome performance");
  const gA = huntTwoSample(gEntries["nat-a"], gEntries["shuf-a"]);
  const gS = huntPaired(gEntries["nat-s"], gEntries["shuf-s"]);
  const among = (a: HuntArm) => {
    const xs = idx.filter((i) => hasGenome(a, i)).map((i) => gEntries[a][i].value!);
    return { n: xs.length, median: xs.length ? median(xs) : null, mean: xs.length ? mean(xs) : null, min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null };
  };
  const genome = {
    note: "a composite endpoint (genome availability and genome performance together); a test is read as genome performance only if every history in both compared arms has a genome, otherwise as the composite, with the counts here and a descriptive, untested comparison of W_G among the histories that have a genome (conditional on survival); only the dominant genome is tested, on one fixed ancestral background",
    availability,
    A: { ...gA, reading: reading("nat-a", "shuf-a") },
    S: { ...gS, reading: reading("nat-s", "shuf-s") },
    amongThoseWithAGenome: Object.fromEntries(HUNT_ARMS.map((a) => [a, among(a)])),
  };

  // Edge share: E_h = ΣX_f / Σ trait_f over the history's fragments (0 when Σ trait = 0).
  const eA = huntTwoSample(entries("nat-a", (a, i) => wEntry(a, i, E)), entries("shuf-a", (a, i) => wEntry(a, i, E)));
  const eS = huntPaired(entries("nat-s", (a, i) => wEntry(a, i, E)), entries("shuf-s", (a, i) => wEntry(a, i, E)));
  const edgeShare = { note: "a spatial share; a faster-spreading carpet raises it too, so it does not establish reproductive allocation or a germ line", zoneAreaShare: HUNT_ZONE_SHARE, A: eA, S: eS };

  // Heredity: per history ICC(1) and its permutation p; the arm's count among a fixed 24 and the binomial upper tail at 0.05 (1/20).
  const hereditySets = HUNT_ARMS.map((a) => {
    const per = idx.map((i) => {
      const id = huntHistoryId(a, i);
      const gone = anyGone(a, i);
      if (gone !== null) return { id, outcome: "unresolved" as const, why: gone, n: 0, families: 0, icc: null, p: null, tested: false, demonstrated: false };
      return { id, outcome: "analysed" as const, ...huntHeredity(setById.get(sid(a, i))!.rows, huntH(a, i)) };
    });
    const demonstrated = per.filter((x) => x.demonstrated).length;
    return [a, { n: HUNT_HISTORIES, demonstrated, p: binomialUpperTail(demonstrated, HUNT_HISTORIES, 1, 20), histories: per }] as const;
  });
  const heredity = { note: "transmitted differences between families, including copied mass, energy and structure, not only genes; the shuf arms get the same statistic descriptively (expected under both, as R1'' found in rand)", arms: Object.fromEntries(hereditySets) as Record<HuntArm, { n: number; demonstrated: number; p: number; histories: unknown[] }>, tests: { "nat-a": hereditySets[0][1].p, "nat-s": hereditySets[2][1].p } };

  // Improvement: sources i with W(nat-s i) > W(source i), among 24; unresolved (either) counts as not improved.
  const improvementOf = (a: "nat-s" | "shuf-s") => {
    const terms = idx.map((i) => {
      const id = huntHistoryId(a, i);
      const src = `s1-src-i${pad2(i)}`;
      const gone = [anyGone(a, i), status(src).status === "unresolved" ? `${src}: ${status(src).why}` : null].filter((x): x is string => x !== null);
      if (gone.length > 0) return { id, status: "unresolved" as const, W: null, source: null, improved: false, why: gone.join("; ") };
      const w = setById.get(sid(a, i))!.w.W;
      const s = setById.get(src)!.w.W;
      return { id, status: "measured" as const, W: w, source: s, improved: w > s, why: null };
    });
    const improved = terms.filter((t) => t.improved).length;
    return { improved, n: HUNT_HISTORIES, p: reg1ReportSignTest(improved, HUNT_HISTORIES), terms };
  };
  const improvementNat = improvementOf("nat-s");
  const improvementShuf = improvementOf("shuf-s");
  const improvement = { note: "tests improvement, not maintenance: a source whose W is unchanged counts as not improved; the same count for shuf-s is descriptive", "nat-s": improvementNat, "shuf-s": { improved: improvementShuf.improved, n: improvementShuf.n, terms: improvementShuf.terms } };

  // The seven secondary tests, Holm at 0.05 (slot p = 1 where not assessed).
  const secondary = [
    { id: "genome-A", kind: "genome composite, nat-a against shuf-a (Mann-Whitney)", assessed: gA.assessed, p: gA.p },
    { id: "genome-S", kind: "genome composite, nat-s against shuf-s (signed-rank)", assessed: gS.assessed, p: gS.p },
    { id: "heredity-nat-a", kind: "heredity, nat-a (binomial tail of histories with ICC > 0 and p < 0.05)", assessed: true, p: heredity.tests["nat-a"] },
    { id: "heredity-nat-s", kind: "heredity, nat-s (binomial tail of histories with ICC > 0 and p < 0.05)", assessed: true, p: heredity.tests["nat-s"] },
    { id: "edge-A", kind: "edge share, nat-a against shuf-a (Mann-Whitney)", assessed: eA.assessed, p: eA.p },
    { id: "edge-S", kind: "edge share, nat-s against shuf-s (signed-rank)", assessed: eS.assessed, p: eS.p },
    { id: "improvement", kind: "improvement after withdrawal (sign test on the 24 sources)", assessed: true, p: improvementNat.p },
  ];
  const adjusted = holm(secondary.map((t) => t.p ?? 1));
  const tests = secondary.map((t, k) => ({ ...t, slot: t.p ?? 1, holm: adjusted[k], significant: t.assessed && adjusted[k] <= HUNT_ALPHA }));
  return { reasons, primary, secondary: { alpha: HUNT_ALPHA, note: "Holm over the seven tests at 0.05; they are reported beside the contrasts and never change a hit; this family's guarantee is separate from the primary family's", family: tests.length, tests, genome, heredity, edgeShare, improvement } };
}

/** A history's (bundle plus sets) unresolved parts, for the unresolved rule and the per-arm limit. */
export interface HuntHistoryStatus {
  id: string;
  arm: HuntArm;
  history: number;
  /** The bundle ("<id> run") and the set ids that are unresolved; the history is unresolved when any is (`HUNT_UNRESOLVED`). */
  unresolved: string[];
}

/** Every history's unresolved parts, in order (nat-a, shuf-a, nat-s, shuf-s). */
export function huntHistoryStatuses(statuses: readonly HuntSetStatus[], runs: ReadonlyMap<string, Pick<HuntRun, "resolved">>): HuntHistoryStatus[] {
  return HUNT_ARMS.flatMap((arm) =>
    Array.from({ length: HUNT_HISTORIES }, (_, i) => {
      const id = huntHistoryId(arm, i);
      const own = statuses.filter((s) => s.owner === id && s.status === "unresolved");
      return { id, arm, history: i, unresolved: [...(runs.get(id)?.resolved ? [] : [`${id} run`]), ...own.map((s) => s.id)] };
    }),
  );
}

/** The validity checks ("Validity, missing data and availability"), evaluated once over every history. */
export interface HuntValidity {
  device: { passed: boolean; reasons: string[] };
  /** Every quenched set whose fragments were read, the accepted ones and those rejected at screening (`rejected`: why, else null) alike. */
  quenched: { limit: number; sets: (HuntQuench & { id: string; rejected: string[] | null })[]; max: number | null; failed: boolean };
  reproducibility: { passed: boolean; reasons: string[] };
  unresolved: { limit: number; arms: Record<HuntArm, { histories: number; unresolved: number; ids: string[] }>; uninformative: boolean };
}

/**
 * The validity checks, in the document's order, over every history: the device check, the unresolved histories (more than 6 in an arm is uninformative;
 * infrastructure failures and event overflows are rerun before the report), the quenched gate (any quenched set with X_f > 0 in more than 5% of
 * its fragments is invalid, whatever else holds: a set rejected at screening whose rows were read counts too, and is listed with why it was rejected) and the
 * reproducibility check (`huntDeviceCheck`, `huntReproducibility` are inputs). Invalid (device, quenched or reproducibility) comes before Uninformative in the
 * outcome table.
 */
export function huntValidity(
  sets: readonly HuntSet[],
  histories: readonly HuntHistoryStatus[],
  gates: { device: Pick<HuntDevice, "passed" | "reasons">; reproducibility: Pick<HuntReproducibility, "passed" | "reasons"> },
  rejected: readonly HuntRejected[] = [],
): { validity: HuntValidity; invalid: boolean; uninformative: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const arms = Object.fromEntries(
    HUNT_ARMS.map((arm) => {
      const hs = histories.filter((h) => h.arm === arm);
      const bad = hs.filter((h) => h.unresolved.length > 0);
      return [arm, { histories: hs.length, unresolved: bad.length, ids: bad.map((h) => h.id) }];
    }),
  ) as HuntValidity["unresolved"]["arms"];
  const tooMany = HUNT_ARMS.filter((arm) => arms[arm].unresolved > HUNT_UNRESOLVED_LIMIT);
  // A quenched control enters the gate only if its source is authenticated (null: not screened strictly, a smoke run): a control no bundle backs touches nothing.
  const quenchedSets = [
    ...sets.filter((s) => s.expected.kind === "quench" && s.authenticated !== false).map((s) => ({ id: s.id, ...huntQuenchStat(s), rejected: null as string[] | null })),
    ...rejected.filter((r) => r.quench !== undefined).map((r) => ({ id: r.id ?? r.dir, ...r.quench!, rejected: r.reasons as string[] | null })),
  ];
  const quenched = { limit: HUNT_QUENCH_LIMIT, sets: quenchedSets, max: quenchedSets.length ? Math.max(...quenchedSets.map((q) => q.fraction ?? 0)) : null, failed: quenchedSets.some((q) => q.above) };
  // The document's order: 1 the device check, 4 the unresolved histories, 5 the quenched gate, 7 reproducibility.
  if (!gates.device.passed) reasons.push(`device check failed: ${gates.device.reasons.join("; ")}`);
  for (const arm of tooMany) reasons.push(`${arm} has ${arms[arm].unresolved} unresolved histories, more than ${HUNT_UNRESOLVED_LIMIT} (${arms[arm].ids.join(", ")})`);
  for (const q of quenchedSets.filter((x) => x.above)) reasons.push(`quenched control ${q.id} has X_f > 0 in ${q.successes} of ${q.n} fragments, above ${HUNT_QUENCH_LIMIT}${q.rejected === null ? "" : ` (the set was rejected at screening: ${q.rejected.join("; ")})`}`);
  if (!gates.reproducibility.passed) reasons.push(`reproducibility check failed: ${gates.reproducibility.reasons.join("; ")}`);
  return {
    validity: { device: { passed: gates.device.passed, reasons: gates.device.reasons }, quenched, reproducibility: { passed: gates.reproducibility.passed, reasons: gates.reproducibility.reasons }, unresolved: { limit: HUNT_UNRESOLVED_LIMIT, arms, uninformative: tooMany.length > 0 } },
    invalid: !gates.device.passed || quenched.failed || !gates.reproducibility.passed,
    uninformative: tooMany.length > 0,
    reasons,
  };
}

export interface HuntEvaluation {
  outcome: Exclude<HuntOutcome, "incomplete">;
  reasons: string[];
  validity: HuntValidity;
  /** The tests were evaluated and are reported (the validity checks did not settle it as Invalid or Uninformative); the readout withholds them otherwise. */
  applied: boolean;
  tests: HuntTests | null;
}

/** Stage 1's rule: the validity checks once (`huntValidity`), then, only if neither fails, the tests (`huntTests`). Invalid, then Uninformative, then "analysed". */
export function huntEvaluate(
  sets: readonly HuntSet[],
  statuses: readonly HuntSetStatus[],
  histories: readonly HuntHistoryStatus[],
  gates: { device: Pick<HuntDevice, "passed" | "reasons">; reproducibility: Pick<HuntReproducibility, "passed" | "reasons"> },
  rejected: readonly HuntRejected[] = [],
): HuntEvaluation {
  const v = huntValidity(sets, histories, gates, rejected);
  const applied = !v.invalid && !v.uninformative;
  const tests = applied ? huntTests(sets, statuses, histories) : null;
  const outcome = v.invalid ? "Invalid" : v.uninformative ? "Uninformative" : "analysed";
  return { outcome, reasons: [...v.reasons, ...(tests?.reasons ?? [])], validity: v.validity, applied, tests };
}

/** The queue's completeness (`reg1ReportQueueCheck`'s output). */
export interface HuntQueue {
  complete: boolean;
  commands: number;
  done: number;
  failed: number;
  pending: string[];
  reasons: string[];
}

/** Per-boundary medians across the histories of one arm (descriptive): the occupancy and exporters, recolonisation, effective donors, truncation, export share, lineages. */
function huntArmTrajectory(runs: readonly HuntRun[]) {
  const boundaries = new Set<number>();
  for (const r of runs) for (const b of r.ponds?.boundaries ?? []) boundaries.add(b.boundary);
  const med = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? median(v) : null;
  };
  return [...boundaries].sort((a, b) => a - b).map((boundary) => {
    const at = runs.flatMap((r) => r.ponds?.boundaries.filter((b) => b.boundary === boundary) ?? []);
    return {
      boundary,
      histories: at.length,
      occupied: med(at.map((b) => b.occupied)),
      exporters: med(at.map((b) => b.exporters)),
      recolonisation: med(at.map((b) => (b.recolonisation.successes !== null && b.recolonisation.recipients > 0 ? b.recolonisation.successes / b.recolonisation.recipients : null))),
      effectiveDonors: med(at.map((b) => b.effectiveDonors)),
      truncation: med(at.map((b) => (b.recipients > 0 ? b.truncated / b.recipients : null))),
      exportShare: med(at.map((b) => b.exportShare)),
      lineages: med(at.map((b) => b.lineages)),
    };
  });
}

/**
 * The hunt's Stage 1 readout (pure; the CLI reads the files): the screened sets and their rejections, every expected history bundle, the device and
 * reproducibility checks, the queue's completeness. With `budgetStopped` nothing is analysed: Uninformative, unless an Invalid condition is already known (the device
 * check, technical status, if given, or the reproducibility check) failed: then Invalid. With a queue that has not completed nothing is analysed either, and the outcome is
 * "incomplete" (no row of the table), again Invalid if such a condition failed. Otherwise the -s sources are checked on copies of the runs (`huntSourceProblems`: a -s pair
 * whose source fails is unresolved), then the validity checks once over every history (the quenched gate over every authenticated quenched set whose rows were read,
 * `rejected` included) and, only if they leave it to them, the tests (contrasts A and S: Hit, No hit or Not assessed;
 * the seven secondary tests); under Invalid or Uninformative no test statistic is printed (`withheld`, `primary` and `secondary` null). The descriptive
 * outputs never feed the outcome.
 */
export function huntReadout(x: {
  sets: readonly HuntSet[];
  rejected: readonly HuntRejected[];
  runs: readonly HuntRun[];
  device: HuntDevice | null;
  reproducibility: HuntReproducibility | null;
  budgetStopped?: boolean;
  queue?: HuntQueue | null;
  pondDeath: number;
}) {
  const rowOf = (outcome: string) => HUNT_OUTCOMES.find((r) => r.outcome === outcome) ?? null;
  const definitions = { unresolved: HUNT_UNRESOLVED };
  const nothing = { primary: null, secondary: null, availability: null, descriptive: null };
  // Nothing is analysed under a budget stop or an incomplete queue, but an Invalid condition already known (the device check, or the reproducibility check when given) keeps
  // its precedence in the outcome table ("first match"): the outcome is Invalid, and the analysis is still withheld. Otherwise the budget stop is Uninformative, the incomplete
  // queue is "incomplete" (no row).
  const invalid = [...(x.device?.passed === false ? [`device check failed: ${x.device.reasons.join("; ")}`] : []), ...(x.reproducibility?.passed === false ? [`reproducibility check failed: ${x.reproducibility.reasons.join("; ")}`] : [])];
  if (x.budgetStopped) {
    const outcome: HuntOutcome = invalid.length > 0 ? "Invalid" : "Uninformative";
    const reasons = [...invalid, "the budget stopped the queue: nothing is analysed (no partial ensemble is ever analysed)"];
    return { outcome, row: rowOf(outcome), pondDeath: x.pondDeath, reasons, budgetStopped: true, withheld: true, withheldReason: "the budget stopped the queue: nothing is analysed", contrasts: null, definitions, queue: x.queue ?? null, validity: { device: x.device ?? { passed: null, reasons: ["not given"] } }, ...nothing };
  }
  if (x.queue && !x.queue.complete) {
    const outcome: HuntOutcome = invalid.length > 0 ? "Invalid" : "incomplete";
    return { outcome, row: rowOf(outcome), pondDeath: x.pondDeath, reasons: [...invalid, ...x.queue.reasons, "nothing is analysed (no partial ensemble is ever analysed)"], budgetStopped: false, withheld: true, withheldReason: "the queue has not completed: nothing is analysed", contrasts: null, definitions, queue: x.queue, validity: { device: x.device ?? { passed: null, reasons: ["not given"] } }, ...nothing };
  }
  if (x.device === null || x.reproducibility === null) throw new Error("huntReadout: the device and reproducibility checks are needed unless nothing is analysed");
  // The -s sources (their sets, their distinct hashes, one origin) are checked on copies of the runs: a -s history that fails is unresolved here.
  const checked = x.runs.map((r) => ({ ...r, why: [...r.why] }));
  const sources = huntSourceProblems(checked, x.sets, x.rejected);
  const histories = checked.filter((r) => r.kind === "history");
  const runs = new Map(checked.map((r) => [r.id, r]));
  const statuses = huntStatuses("s1", x.sets, x.rejected, runs);
  const status = huntHistoryStatuses(statuses, runs);
  const all = huntEvaluate(x.sets, statuses, status, { device: x.device, reproducibility: x.reproducibility }, x.rejected);
  const withheld = !all.applied;
  const setById = new Map(x.sets.map((s) => [s.id, s]));
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const measured = (id: string): HuntSet | null => (statusById.get(id)?.status === "measured" ? (setById.get(id) ?? null) : null);
  const setSummary = (s: HuntSet) => ({ id: s.id, W: s.w.W, Wexport: s.Wexport, families: s.w.families, fragments: s.w.fragments, edgeShare: s.w.edgeShare, noFamilies: s.noFamilies, noGenome: s.noGenome, successFraction: s.rows.length ? s.rows.filter((r) => r.success === 1).length / s.rows.length : null, retMass: dist(s.rows.map((r) => r.retMass)), retE: dist(s.rows.filter((r) => r.retE !== null).map((r) => r.retE!)) });
  const ancestorW = [0, 1, 2, 3].map((j) => measured(`s1-anc-j${j}`)).filter((s): s is HuntSet => s !== null).map((s) => s.w.W);
  const ancestorMean = ancestorW.length ? mean(ancestorW) : null;
  const wOf = (histArm: HuntArm, i: number) => measured(`s1-${huntHistoryId(histArm, i)}`);
  const against = (histArm: HuntArm, i: number) => {
    const s = wOf(histArm, i);
    const ref = histArm.endsWith("-a") ? ancestorMean : (measured(`s1-src-i${pad2(i)}`)?.w.W ?? null);
    return { id: huntHistoryId(histArm, i), W: s?.w.W ?? null, reference: ref, difference: s !== null && ref !== null ? s.w.W - ref : null };
  };
  const meanOf = (xs: (number | null)[]): number | null => {
    const v = xs.filter((e): e is number => e !== null);
    return v.length ? mean(v) : null;
  };
  const runSummary = histories.map((r) => {
    const p = r.ponds;
    return {
      id: r.id,
      dir: r.dir,
      resolved: r.resolved,
      censusEvery: r.censusEvery,
      endedAt: p?.endedAt ?? null,
      boundaries: p === null ? null : { first: p.first, last: p.last },
      meanOccupancy: p === null ? null : huntOccupancy(p, p.first, p.last).mean,
      meanExporters: p === null ? null : meanOf(p.boundaries.map((b) => b.exporters)),
      meanEffectiveDonors: p === null ? null : meanOf(p.boundaries.map((b) => b.effectiveDonors)),
      meanExportShare: p === null ? null : meanOf(p.boundaries.map((b) => b.exportShare)),
      meanLineages: p === null ? null : meanOf(p.boundaries.map((b) => b.lineages)),
      recolonisation: p === null ? null : huntRecolonisation(p, p.first, p.last - 1),
      truncation: p?.truncation ?? null,
      offspringHistogram: p?.offspring ?? null,
    };
  });
  const flagged = runSummary.filter((r) => r.truncation?.flagged).map((r) => ({ id: r.id, ...r.truncation! }));
  return {
    outcome: all.outcome as HuntOutcome,
    row: rowOf(all.outcome),
    pondDeath: x.pondDeath,
    reasons: all.reasons,
    budgetStopped: false,
    withheld,
    withheldReason: !withheld ? null : all.outcome === "Invalid" ? "the row is Invalid (Report; no claim): no test statistic is reported" : "the row is Uninformative (Report; decide whether to complete): no test statistic is reported",
    contrasts: withheld ? null : { A: all.tests!.primary.A.status, S: all.tests!.primary.S.status, statuses: HUNT_CONTRAST_STATUSES },
    definitions,
    queue: x.queue ?? null,
    validity: { ...all.validity, device: x.device, reproducibility: x.reproducibility },
    primary: withheld ? null : all.tests!.primary,
    secondary: withheld ? null : all.tests!.secondary,
    availability: {
      expected: statuses.length,
      measured: statuses.filter((s) => s.status === "measured").length,
      unresolved: statuses.filter((s) => s.status === "unresolved").length,
      sets: statuses,
      histories: status,
      sources,
      runs: checked.map(({ id, dir, resolved, why, censusEvery }) => ({ id, dir, resolved, why, censusEvery })),
    },
    descriptive: {
      note: "never a decision input. runs: per history its occupancy, exporting ponds, effective donors, export share, distinct lineages, recolonisation success (pooled over its recipients, null without any), truncation (flagged above 1% of recipient rows; no consequence is defined) and the pooled histogram of offspring numbers among exporting ponds (the transform after time C, boundary 200, is in none of the lifecycle values: its pre-cycle occupancy, export mass and traits are time C's and stay); arms: per arm and boundary the medians over its histories; w: every set's W, export-weighted W (as the set records it), edge share, success fraction and the retained B+P (retMass) and E (retE) of its fragments; against: each history's W against the ancestor worlds' mean (-a) or its own source's W (-s); ancestorW and the genome control's W_G",
      runs: runSummary,
      truncationFlagged: flagged,
      arms: Object.fromEntries(HUNT_ARMS.map((arm) => [arm, huntArmTrajectory(histories.filter((r) => r.histArm === arm))])),
      w: x.sets.filter((s) => statusById.get(s.id)?.status === "measured").map(setSummary),
      against: HUNT_ARMS.flatMap((arm) => Array.from({ length: HUNT_HISTORIES }, (_, i) => ({ arm, ...against(arm, i) }))),
      ancestorW: { worlds: [0, 1, 2, 3].map((j) => ({ id: `s1-anc-j${j}`, W: measured(`s1-anc-j${j}`)?.w.W ?? null })), mean: ancestorMean },
      genomeControl: measured("s1-genome-control") ? setSummary(measured("s1-genome-control")!) : null,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Stage 0 readout

/** G1 from its bundles: each set's runs as `huntG1Run` reads them, the sets, and the decision (a missing set is null and leaves it pending). */
export function huntG1Of(base: readonly HuntRun[] | null, fallback: readonly HuntRun[] | null): { base: HuntG1Set | null; fallback: HuntG1Set | null; decision: HuntG1Decision } {
  const set = (runs: readonly HuntRun[] | null) => (runs === null ? null : huntG1Set(runs.map(huntG1Run)));
  const b = set(base);
  const f = set(fallback);
  return { base: b, fallback: f, decision: huntG1Decide(b, f) };
}

/**
 * The Stage 0 readout (pure): G1 from its base and fallback runs, G2 and D3 from their sets (and D3's bundles). Any part may be missing: it stays
 * "pending" (null decision) so the stage can be run as results come in. The overall outcome is "Stopped at Stage 0" if G1 stops the hunt or G2 fails,
 * "Stage 0 passed" once G1 (with its fallback) and G2 pass, and "pending" otherwise; D3 never decides.
 */
export function huntStage0Readout(x: {
  g1: { base: readonly HuntRun[] | null; fallback: readonly HuntRun[] | null };
  g2: { sets: readonly HuntSet[]; rejected: readonly HuntRejected[] } | null;
  d3: { runs: readonly HuntRun[] | null; sets: readonly HuntSet[]; rejected: readonly { dir: string; id: string | null; reasons: string[] }[] } | null;
  /** The pondDeath D3 was expected to run with (G1's decision, or --pond-death). */
  d3PondDeath: number;
}) {
  const { base: baseSet, fallback: fallbackSet, decision: g1 } = huntG1Of(x.g1.base, x.g1.fallback);
  const g2 = x.g2 === null ? null : huntG2Decide(x.g2.sets, huntStatuses("g2", x.g2.sets, x.g2.rejected, new Map()), x.g2.rejected);
  const d3Runs = new Map((x.d3?.runs ?? []).map((r) => [r.id, r]));
  const d3Statuses = x.d3 === null ? [] : huntStatuses("d3", x.d3.sets, x.d3.rejected, d3Runs);
  const reasons: string[] = [];
  let outcome: "Stopped at Stage 0" | "Stage 0 passed" | "pending";
  if (g1.decision === "stop") {
    outcome = "Stopped at Stage 0";
    reasons.push(`G1 stops the hunt: ${g1.reasons.join("; ")}`);
  } else if (g2?.decision === "fail") {
    outcome = "Stopped at Stage 0";
    reasons.push(`G2 failed: ${g2.reasons.join("; ")}`);
  } else if ((g1.decision === "pass" || g1.decision === "pass-fallback") && g2?.decision === "pass") {
    outcome = "Stage 0 passed";
    reasons.push(`G1 ${g1.decision === "pass" ? "passed at e = 1/2" : "passed at the fallback e = 1 (Stage 1, D3 and the device check use pondDeath 65,536)"} and G2 passed`);
  } else {
    outcome = "pending";
    reasons.push(...(g1.decision === "pending" ? [`G1 pending: ${g1.reasons.join("; ")}`] : []), ...(g2 === null ? ["G2 is not given"] : g2.decision === "pending" ? [`G2 pending: ${g2.reasons.join("; ")}`] : []));
  }
  return {
    outcome,
    row: outcome === "Stopped at Stage 0" ? HUNT_OUTCOMES[0] : null,
    reasons,
    pondDeath: g1.pondDeath,
    g1: { given: baseSet !== null, ...g1, base: baseSet, fallback: fallbackSet },
    g2: g2 === null ? { given: false, decision: "pending" as const } : { given: true, ...g2 },
    d3: x.d3 === null ? { given: false } : { given: true, pondDeath: x.d3PondDeath, runs: (x.d3.runs ?? []).map(huntG1Run), ...huntD3Describe(x.d3.sets, d3Statuses), rejected: x.d3.rejected, statuses: d3Statuses },
  };
}
