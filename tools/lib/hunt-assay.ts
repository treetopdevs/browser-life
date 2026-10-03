// The export assay W of the transition hunt (docs/scaffold-transition-hunt-v1.md, "Assay: export performance W", "Stage 0" (G2, D3) and
// "Seeds"), the host side of `tools/scaffold-assays.ts export --hunt1`: the hunt's seed functions and set ids (labels), the fragments a family
// of a source world draws from its export zone, the summary W / Wexport / edgeShare, the pinned hunt document and the provenance checks of every
// source (protocol v1's main-run checkpoints for G2, runner bundles for D3 and Stage 1). Pure and integer-or-float host code with no Deno API (the
// bundle loader takes its file reader as an argument), so vitest exercises it directly; the GPU loop and the CLI are tools/scaffold-assays.ts.
import { CH, GENOME_CHANNELS, RULE_VERSION, cellCount, drawExportCentre, packetWindow, pondExportMasses, worldW, type WorldState } from "@bl/schema";
import { runId, type RunSpec } from "@bl/runner";
import {
  ASSAY_COLUMNS,
  M_ASSAY,
  REG1_PONDS_IDENTITY,
  assayLine,
  checkpointShapeProblems,
  endsInPath,
  loadReg1Source,
  pinnedTextProblems,
  reg1H,
  reg1PreCycleFileOf,
  reg1WorldSeedOf,
  type Fragment,
  type FragmentCell,
  type Planted,
  type R3RepOrigin,
  type Reg1BundleWant,
  type Reg1RunRecord,
  type Reg1Source,
} from "./pond-assay.ts";
import { pondConfig } from "./ponds.ts";

const TILE = 64;
const CENTRE = 32;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

// ---------------------------------------------------------------------------------------------
// The frozen hunt, the regime and the seeds

/**
 * The hunt as frozen on 2026-10-02, pinned by SHA-256 and length (experiments/scaffold/HUNT-v1 records the same hash). A change after the freeze
 * goes in a dated amendment at the end, so the document keeps beginning with its pinned bytes; sets record and are checked against this pin, never
 * against the document as it is now.
 */
export const HUNT1_PROTOCOL = { doc: "docs/scaffold-transition-hunt-v1.md", sha256: "13246200a5277ecbbbefb8d5b220f61a10ba1d33dc39a748fefbc224904a1f97", bytes: 38_736 } as const;
export const HUNT1_SHA256 = HUNT1_PROTOCOL.sha256;

/** What is wrong with `doc` (the hunt's bytes as they are now) as its pinned text followed by amendments only. */
export async function hunt1ProtocolProblems(doc: Uint8Array): Promise<string[]> {
  return await pinnedTextProblems(HUNT1_PROTOCOL, doc);
}

/**
 * The regime of every export set: k = 8, period 10,000, ref 103,058 (v1's success reference), 8 x 8 ponds, a census every 100 steps (the overflow
 * guard only), the export zone at Chebyshev distance 28, four replicates of 64 fragments (a quenched set runs replicate 0 only).
 */
export const HUNT1_REGIME = { k: 8, period: 10_000, ref: 103_058, side: 8, censusEvery: 100, export: 28, replicates: 4 } as const;
export const HUNT1_FRAGMENTS = 64;
/** assay.tsv's columns: v1's, then the fragment's pond's export mass X_f at the end of the period. */
export const HUNT1_COLUMNS = [...ASSAY_COLUMNS, "exportMass"] as const;
/** `pondDeath` (65,536 · e): the hunt's e = 1/2, and G1's fallback e = 1, under which D3 and Stage 1 then run. */
export const HUNT1_DEATH = { base: 32_768, fallback: 65_536 } as const;

/** The hunt's seed block, reserved ("Seeds"). */
export const HUNT1_SEED_BLOCK = { min: 4_900_001, max: 4_949_999 } as const;
/** G2: σ(h, s) = 4,900,201 + 10 h + s, h 0-11, s 0-3 (at most 4,900,314). */
export const HUNT1_G2_SEED_BASE = 4_900_201;
/** D3: worlds 4,900,401 + 10 arm + j; assays σ = 4,900,501 + 10 (4 arm + j) + s (at most 4,900,574). */
export const HUNT1_D3_WORLD_SEED_BASE = 4_900_401;
export const HUNT1_D3_SEED_BASE = 4_900_501;
/** Histories 4,901,001 + 100 a + i (a 0 nat-a, 1 shuf-a, 2 nat-s, 3 shuf-s; i 0-23), ancestor worlds 4,901,401 + j, the hunt's own scaffold phase 4,901,501 + i. */
export const HUNT1_HISTORY_SEED_BASE = 4_901_001;
export const HUNT1_ANCESTOR_SEED_BASE = 4_901_401;
export const HUNT1_OWN_SCAFFOLD_SEED_BASE = 4_901_501;
/** Stage 1's assays: σ(h, s) = 4,902,001 + 10 h + s, h 0-123, s 0-3 (the replicates) or 8 (the permutation stream): at most 4,903,239. */
export const HUNT1_S1_SEED_BASE = 4_902_001;
export const HUNT1_S1_SEED_MAX = 4_903_239;
/** Protocol v1's main runs (runs/scaffold/main): world seed 4,810,001 + 100 arm + i (scaf 0, rand 1, cont 2), run for 100 cycles under the protocol as hashed in their meta.json. */
export const HUNT1_V1_SEED_BASE = 4_810_001;
export const HUNT1_V1_PROTOCOL_SHA256 = "fa5b85bc3b62ca32504fb3c2c5a72ed5b5e3a2683da89491ed9665e6d3361010";
export const HUNT1_V1_BOUNDARY = 100;

const field = (fn: string, name: string, x: number, lo: number, hi: number): void => {
  if (!Number.isInteger(x) || x < lo || x > hi) throw new Error(`${fn}: ${name} must be an integer in ${lo}..${hi}, got ${x}`);
};

/** G2's σ(h, s): h = 6 arm + i (scaf i0-i5 are 0-5, rand i0-i5 are 6-11), s the replicate (0-3). */
export function hunt1G2Seed(h: number, s: number): number {
  field("hunt1G2Seed", "h", h, 0, 11);
  field("hunt1G2Seed", "s", s, 0, 3);
  return HUNT1_G2_SEED_BASE + 10 * h + s;
}

/** D3's assay σ = 4,900,501 + 10 (4 arm + j) + s, arm 0 nat and 1 shuf, j 0-3, s 0-3. */
export function hunt1D3Seed(arm: number, j: number, s: number): number {
  field("hunt1D3Seed", "arm", arm, 0, 1);
  field("hunt1D3Seed", "j", j, 0, 3);
  field("hunt1D3Seed", "s", s, 0, 3);
  return HUNT1_D3_SEED_BASE + 10 * (4 * arm + j) + s;
}

/** D3's world seed 4,900,401 + 10 arm + j. */
export function hunt1D3WorldSeed(arm: number, j: number): number {
  field("hunt1D3WorldSeed", "arm", arm, 0, 1);
  field("hunt1D3WorldSeed", "j", j, 0, 3);
  return HUNT1_D3_WORLD_SEED_BASE + 10 * arm + j;
}

/** History i of arm a (0 nat-a, 1 shuf-a, 2 nat-s, 3 shuf-s): 4,901,001 + 100 a + i, at most 4,901,324. */
export function hunt1HistorySeed(a: number, i: number): number {
  field("hunt1HistorySeed", "a", a, 0, 3);
  field("hunt1HistorySeed", "i", i, 0, 23);
  return HUNT1_HISTORY_SEED_BASE + 100 * a + i;
}

/** Ancestor world j (0-3): 4,901,401 + j. */
export function hunt1AncestorSeed(j: number): number {
  field("hunt1AncestorSeed", "j", j, 0, 3);
  return HUNT1_ANCESTOR_SEED_BASE + j;
}

/** The hunt's own scaffold phase (only under the sources rule), source i: 4,901,501 + i. */
export function hunt1OwnScaffoldSeed(i: number): number {
  field("hunt1OwnScaffoldSeed", "i", i, 0, 23);
  return HUNT1_OWN_SCAFFOLD_SEED_BASE + i;
}

/** Stage 1's σ(h, s) = 4,902,001 + 10 h + s: h = 24 a + i (0-95), 96 + j, 100 + i (96-123); s 0-3 are the replicates and 8 the permutation stream. */
export function hunt1S1Seed(h: number, s: number): number {
  field("hunt1S1Seed", "h", h, 0, 123);
  if (!(Number.isInteger(s) && ((s >= 0 && s <= 3) || s === 8))) throw new Error(`hunt1S1Seed: s must be 0-3 (a replicate) or 8 (the permutation stream), got ${s}`);
  return HUNT1_S1_SEED_BASE + 10 * h + s;
}

/** Protocol v1's main-run world seed of scaf or rand history i (0-5): 4,810,001 + 100 arm + i. */
export function hunt1V1WorldSeed(arm: "scaf" | "rand", i: number): number {
  field("hunt1V1WorldSeed", "i", i, 0, 5);
  return HUNT1_V1_SEED_BASE + 100 * (arm === "scaf" ? 0 : 1) + i;
}

// ---------------------------------------------------------------------------------------------
// Sets: ids, labels, and what each reads

export const HUNT1_STAGES = ["g2", "d3", "s1"] as const;
export type Hunt1Stage = (typeof HUNT1_STAGES)[number];
export const HUNT1_HISTORY_ARMS = ["nat-a", "shuf-a", "nat-s", "shuf-s"] as const;
export type Hunt1HistoryArm = (typeof HUNT1_HISTORY_ARMS)[number];
/** The variants of a set: W itself, its quenched control, a genome-only set, and the genome-only control (M3_FOUNDERS[2]). */
export type Hunt1Variant = "w" | "quench" | "genome" | "genome-control";
export const HUNT1_INOCULA = { w: "fragment", quench: "quenched", genome: "swap-ea", "genome-control": "swap-aa" } as const;
/** The history count of every Stage 1 arm, and the pairs of D3. */
export const HUNT1_HISTORIES = 24;

/**
 * The `labels` of an export set (assay.json): the stage, the set id and what it belongs to. `arm` is scaf|rand (g2), nat|shuf (d3), a history arm
 * (nat-a, shuf-a, nat-s, shuf-s), anc (an ancestor world) or src (a `-s` source) for s1, and null for the genome control; `history` the index i (j for
 * D3's worlds and the ancestor worlds) or null for the control; `h` the σ index of its seeds (g2: 6 arm + i; d3: 4 arm + j; s1: 24 a + i, 96 + j, 100 + i, and
 * 96 for a genome-only set and its control, which share ancestor world 0's fragments and physics stream); `control` names the one control.
 */
export interface Hunt1LabelSet {
  hunt1: true;
  stage: Hunt1Stage;
  set: string;
  arm: string | null;
  history: number | null;
  h: number;
  variant: Hunt1Variant;
  control: "ancestor-genome" | null;
}

/** A source world and where it is read: protocol v1's b100-pre (g2), D3's b030-pre, a history's b200-pre, an ancestor world's b001-pre, a `-s` source's b100-pre. */
export type Hunt1Source =
  | { kind: "v1"; arm: "scaf" | "rand"; i: number }
  | { kind: "d3"; arm: "nat" | "shuf"; j: number }
  | { kind: "hist"; arm: Hunt1HistoryArm; i: number }
  | { kind: "anc"; j: number }
  | { kind: "src"; i: number };

/** One set as the tool runs it: its labels, the replicates it runs, its inoculum, the world it fragments (`source`), the history whose dominant genome a genome-only set plants (`donor`). */
export interface Hunt1Set {
  labels: Hunt1LabelSet;
  /** The replicates actually run: 4, or 1 for a quenched set (replicate 0 only, 64 fragments). */
  replicates: number;
  inoculum: (typeof HUNT1_INOCULA)[Hunt1Variant];
  source: Hunt1Source;
  donor: Hunt1Source | null;
}

const pad2 = (i: number): string => String(i).padStart(2, "0");

/** A set's id: g2-scaf-i3[-quench], d3-nat-j0, s1-nat-a-i07[-quench|-genome], s1-anc-j0, s1-src-i07, s1-genome-control. */
export function hunt1SetIdOf(l: Pick<Hunt1LabelSet, "stage" | "arm" | "history" | "variant">): string {
  if (l.variant === "genome-control") return "s1-genome-control";
  const suffix = l.variant === "w" ? "" : `-${l.variant}`;
  if (l.stage === "d3") return `d3-${l.arm}-j${l.history}`;
  if (l.stage === "g2") return `g2-${l.arm}-i${l.history}${suffix}`;
  if (l.arm === "anc") return `s1-anc-j${l.history}`;
  if (l.arm === "src") return `s1-src-i${pad2(l.history!)}`;
  return `s1-${l.arm}-i${pad2(l.history!)}${suffix}`;
}

/** The σ index h of a set of `stage` for `arm`, `history` and `variant` (see `Hunt1LabelSet`). */
function hunt1HOf(stage: Hunt1Stage, arm: string | null, history: number | null, variant: Hunt1Variant): number {
  if (variant === "genome" || variant === "genome-control") return 96;
  if (stage === "g2") return 6 * (arm === "scaf" ? 0 : 1) + history!;
  if (stage === "d3") return 4 * (arm === "nat" ? 0 : 1) + history!;
  if (arm === "anc") return 96 + history!;
  if (arm === "src") return 100 + history!;
  return HUNT1_HISTORIES * HUNT1_HISTORY_ARMS.indexOf(arm as Hunt1HistoryArm) + history!;
}

function hunt1SetOf(stage: Hunt1Stage, arm: string | null, history: number | null, variant: Hunt1Variant, source: Hunt1Source, donor: Hunt1Source | null): Hunt1Set {
  const set = hunt1SetIdOf({ stage, arm, history, variant });
  const labels: Hunt1LabelSet = { hunt1: true, stage, set, arm, history, h: hunt1HOf(stage, arm, history, variant), variant, control: variant === "genome-control" ? "ancestor-genome" : null };
  return { labels, replicates: variant === "quench" ? 1 : HUNT1_REGIME.replicates, inoculum: HUNT1_INOCULA[variant], source, donor };
}

/** The set `id` of `stage` as the tool runs it; throws for an id that is no set of the stage (so a typo never names another set's seeds). */
export function parseHunt1Set(stage: string | undefined, id: string | undefined): Hunt1Set {
  if (stage !== "g2" && stage !== "d3" && stage !== "s1") throw new Error(`--stage must be g2|d3|s1, got ${stage}`);
  if (id === undefined || id === "") throw new Error("--set is required");
  const no = (why: string): Error => new Error(`--set ${id} is not a ${stage} set: ${why}`);
  const num = (x: string): number => Number(x);
  if (stage === "g2") {
    const m = /^g2-(scaf|rand)-i([0-5])(-quench)?$/.exec(id);
    if (!m) throw no("g2 sets are g2-<scaf|rand>-i<0-5>[-quench]");
    if (m[3] !== undefined && m[1] !== "scaf") throw no("only scaf sources have a quenched control");
    return hunt1SetOf("g2", m[1], num(m[2]), m[3] === undefined ? "w" : "quench", { kind: "v1", arm: m[1] as "scaf" | "rand", i: num(m[2]) }, null);
  }
  if (stage === "d3") {
    const m = /^d3-(nat|shuf)-j([0-3])$/.exec(id);
    if (!m) throw no("d3 sets are d3-<nat|shuf>-j<0-3>");
    return hunt1SetOf("d3", m[1], num(m[2]), "w", { kind: "d3", arm: m[1] as "nat" | "shuf", j: num(m[2]) }, null);
  }
  if (id === "s1-genome-control") return hunt1SetOf("s1", null, null, "genome-control", { kind: "anc", j: 0 }, null);
  let m = /^s1-(nat-a|shuf-a|nat-s|shuf-s)-i(\d\d)(-quench|-genome)?$/.exec(id);
  if (m) {
    const arm = m[1] as Hunt1HistoryArm;
    const i = num(m[2]);
    if (i >= HUNT1_HISTORIES) throw no(`the history index is 00-${HUNT1_HISTORIES - 1}`);
    if (m[3] === "-quench" && !arm.startsWith("nat")) throw no("only nat histories have a quenched control");
    const hist: Hunt1Source = { kind: "hist", arm, i };
    return m[3] === "-genome" ? hunt1SetOf("s1", arm, i, "genome", { kind: "anc", j: 0 }, hist) : hunt1SetOf("s1", arm, i, m[3] === "-quench" ? "quench" : "w", hist, null);
  }
  m = /^s1-anc-j([0-3])$/.exec(id);
  if (m) return hunt1SetOf("s1", "anc", num(m[1]), "w", { kind: "anc", j: num(m[1]) }, null);
  m = /^s1-src-i(\d\d)$/.exec(id);
  if (m && num(m[1]) < HUNT1_HISTORIES) return hunt1SetOf("s1", "src", num(m[1]), "w", { kind: "src", i: num(m[1]) }, null);
  throw no("s1 sets are s1-<nat-a|shuf-a|nat-s|shuf-s>-i<00-23>[-quench|-genome], s1-anc-j<0-3>, s1-src-i<00-23> and s1-genome-control");
}

/** Every set of `stage` (all three without one), in the document's order: G2's 18, D3's 8 and Stage 1's 269. */
export function hunt1ExpectedSets(stage?: Hunt1Stage): Hunt1Set[] {
  const ids: string[] = [];
  if (stage === undefined || stage === "g2") for (const arm of ["scaf", "rand"]) for (let i = 0; i < 6; i++) ids.push(`g2-${arm}-i${i}`, ...(arm === "scaf" ? [`g2-${arm}-i${i}-quench`] : []));
  if (stage === undefined || stage === "d3") for (const arm of ["nat", "shuf"]) for (let j = 0; j < 4; j++) ids.push(`d3-${arm}-j${j}`);
  if (stage === undefined || stage === "s1") {
    for (const arm of HUNT1_HISTORY_ARMS) for (let i = 0; i < HUNT1_HISTORIES; i++) ids.push(`s1-${arm}-i${pad2(i)}`, ...(arm.startsWith("nat") ? [`s1-${arm}-i${pad2(i)}-quench`] : []), `s1-${arm}-i${pad2(i)}-genome`);
    for (let j = 0; j < 4; j++) ids.push(`s1-anc-j${j}`);
    for (let i = 0; i < HUNT1_HISTORIES; i++) ids.push(`s1-src-i${pad2(i)}`);
    ids.push("s1-genome-control");
  }
  return ids.map((id) => parseHunt1Set(id.slice(0, 2), id));
}

/** σ(h, s) of a set: its fragments' sampling seed and its assay world's physics seed alike. */
export function hunt1SeedOf(l: Pick<Hunt1LabelSet, "stage" | "arm" | "h">, s: number): number {
  if (l.stage === "g2") return hunt1G2Seed(l.h, s);
  if (l.stage === "d3") return hunt1D3Seed(Math.floor(l.h / 4), l.h % 4, s);
  return hunt1S1Seed(l.h, s);
}

/** Throws unless the seeds of replicate `replicate` are `hunt1SeedOf(labels, replicate)` (fragment sampling and physics alike). */
export function checkHunt1Seeds(labels: Pick<Hunt1LabelSet, "stage" | "arm" | "h" | "set">, seeds: { physics: number; fragment: number }, replicate = 0): void {
  const want = hunt1SeedOf(labels, replicate);
  for (const [name, seed] of [["seed", seeds.physics], ["fragment seed", seeds.fragment]] as const) {
    if (seed !== want) throw new Error(`${name} ${seed} does not match the hunt's labels (${labels.set}, h ${labels.h}): want σ(${labels.h}, ${replicate}) = ${want}`);
  }
}

/** What is wrong with the regime asked for (the CLI's --k, --period, --ref, --side, --census, --export and --replicates) against `HUNT1_REGIME`. */
export function hunt1RegimeProblems(x: { k: unknown; period: unknown; ref: unknown; side: unknown; censusEvery: unknown; export: unknown; replicates: unknown }): string[] {
  const why: string[] = [];
  for (const key of ["k", "period", "ref", "side", "censusEvery", "export", "replicates"] as const) if (x[key] !== HUNT1_REGIME[key]) why.push(`${key} ${JSON.stringify(x[key])}, want ${HUNT1_REGIME[key]}`);
  return why;
}

/** A set's directory under runs/: scaffold/hunt1/assays/<set id> (the production root is runs/scaffold/hunt1). */
export const hunt1AssayDirOf = (l: Pick<Hunt1LabelSet, "set">): string => `scaffold/hunt1/assays/${l.set}`;

/** What is wrong with a set's output directory: it must end in `hunt1AssayDirOf(labels)`, so a directory's name is its set. */
export function hunt1AssayOutProblems(l: Pick<Hunt1LabelSet, "set">, out: string): string[] {
  return endsInPath(out.replace(/\/+$/, ""), hunt1AssayDirOf(l)) ? [] : [`output ${JSON.stringify(out)} does not end in ${hunt1AssayDirOf(l)}`];
}

/**
 * What is wrong with an output under --allow-any-seed: it must not lie inside `production`, the repository's own runs/scaffold/hunt1 tree, so smoke
 * output never lands among the hunt's files. Both paths are absolute and normalised (symlinks resolved) by the caller.
 */
export function hunt1WaiverOutProblems(out: string, production: string): string[] {
  const o = out.replace(/\/+$/, ""), p = production.replace(/\/+$/, "");
  return o === p || o.startsWith(`${p}/`) ? [`--allow-any-seed writes ${JSON.stringify(out)} inside the hunt's production tree ${p}: a smoke test writes elsewhere`] : [];
}

// ---------------------------------------------------------------------------------------------
// Families and fragments

/** A source world's export masses X_p (B+P over the zone's cells with B+P >= 48) and its families: the exporting ponds (X_p > 0), ascending. */
export function exportFamilies(source: WorldState, threshold: number): { families: number[]; exportMass: number[] } {
  const exportMass = pondExportMasses(source, threshold);
  const families: number[] = [];
  for (let p = 0; p < exportMass.length; p++) if (exportMass[p] > 0) families.push(p);
  return { families, exportMass };
}

/** The family of fragment f of replicate s: with g = 64 s + f, family g mod m (so m = 64 gives each pond four fragments over four replicates). */
export function familyOf(families: readonly number[], replicate: number, f: number): number {
  if (families.length === 0) throw new Error("familyOf: no families");
  return families[(HUNT1_FRAGMENTS * replicate + f) % families.length];
}

/**
 * The fragment of assay pond `f` from family `pond` of `source`: the packet rule's window about a centre drawn from the pond's export zone
 * (`drawExportCentre(source, pond, threshold, sigma, 0, f)`, keys (σ, 0, f), purposes 3 and 4), k x k wrapping inside the pond's tile, landing at the
 * assay pond's centre and truncated against M_ASSAY in reverse raster order, carried into a `Fragment` exactly as `standardFragment` does. `null` if the
 * zone holds no eligible cell (a family always does: it exports).
 */
export function exportFragment(source: WorldState, k: number, threshold: number, sigma: number, f: number, pond: number): Fragment | null {
  const cfg = source.cfg;
  if (cfg.tileW !== TILE || cfg.tileH !== TILE) throw new Error(`ponds are ${TILE}x${TILE} tiles, got ${cfg.tileW}x${cfg.tileH}`);
  const centre = drawExportCentre(source, pond, threshold, sigma, 0, f);
  if (centre === null) return null;
  const window = packetWindow(source, pond, k, centre);
  const n = cellCount(cfg);
  const c = source.cells;
  const mass = window.map((i) => c[CH.B * n + i] + c[CH.P * n + i]);
  const reqMass = mass.reduce((a, m) => a + m, 0);
  const reqE = window.reduce((a, i) => a + c[CH.E * n + i], 0);
  // Truncation: drop landing cells from the end of raster order (window order) until the fragment fits.
  let kept = window.length;
  let retMass = reqMass;
  while (retMass > M_ASSAY) retMass -= mass[--kept];
  const half = k >> 1;
  const cells: FragmentCell[] = [];
  let retE = 0;
  for (let q = 0; q < kept; q++) {
    const src = window[q];
    const genome = new Uint32Array(GENOME_CHANNELS);
    for (let w = 0; w < GENOME_CHANNELS; w++) genome[w] = source.genome[w * n + src];
    const E = c[CH.E * n + src];
    retE += E;
    cells.push({ x: CENTRE - half + (q % k), y: CENTRE - half + Math.floor(q / k), B: c[CH.B * n + src], P: c[CH.P * n + src], E, MOT: c[CH.MOT * n + src], genome });
  }
  const W = worldW(cfg);
  return { pond, cx: (centre % W) % cfg.tileW, cy: Math.floor(centre / W) % cfg.tileH, k, cells, reqMass, retMass, reqE, retE, truncated: kept < window.length };
}

// ---------------------------------------------------------------------------------------------
// Rows, summary and records

/** What a summary reads of a fragment: its place, family, end trait and export mass X_f. */
export interface Hunt1Row {
  replicate: number;
  pond: number;
  family: number;
  endTrait: number;
  exportMass: number;
}

/** A set's summary (assay.json): W, the export-weighted W, the family and fragment counts and the edge share. */
export interface Hunt1Summary {
  W: number;
  Wexport: number;
  families: number;
  fragments: number;
  edgeShare: number;
}

/**
 * W of `rows`: the mean over families of each family's mean X_f (equal weight per family), and Wexport = Σ_p X_p · (family mean of p) / Σ_p X_p over the
 * source's families (`families[q]` with export mass `x[q]`; 0 when there is none), the number of families, of fragments, and edgeShare = Σ X_f / Σ endTrait
 * (0 when Σ endTrait = 0). Rows are summed in (replicate, pond) order and families in index order, so equal inputs give identical floats.
 */
export function hunt1Summary(rows: readonly Hunt1Row[], families: readonly number[], x: readonly number[]): Hunt1Summary {
  if (x.length !== families.length) throw new Error(`hunt1Summary: ${x.length} export masses for ${families.length} families`);
  const sorted = [...rows].sort((p, q) => p.replicate - q.replicate || p.pond - q.pond);
  const by = new Map<number, { n: number; sum: number }>();
  let exported = 0, trait = 0;
  for (const r of sorted) {
    const e = by.get(r.family) ?? { n: 0, sum: 0 };
    e.n++;
    e.sum += r.exportMass;
    by.set(r.family, e);
    exported += r.exportMass;
    trait += r.endTrait;
  }
  const means = [...by].sort(([p], [q]) => p - q).map(([family, e]) => ({ family, mean: e.sum / e.n }));
  const W = means.length ? means.reduce((a, m) => a + m.mean, 0) / means.length : 0;
  let weighted = 0, total = 0;
  families.forEach((p, q) => {
    const m = means.find((e) => e.family === p);
    if (m === undefined) return;
    weighted += x[q] * m.mean;
    total += x[q];
  });
  return { W, Wexport: total > 0 ? weighted / total : 0, families: families.length, fragments: sorted.length, edgeShare: trait > 0 ? exported / trait : 0 };
}

/**
 * A set with no fragments to measure, a measured outcome and not a failure: `noFamilies` (the source releases no propagule, m = 0: no assay world is
 * run) or `noGenome` (a genome-only set whose history has no eligible cell, so no dominant genome: its W is 0 by definition). W, Wexport, edgeShare and the
 * fragment count are 0; `families` is the source's m. The flag goes into assay.json, `tsv` is assay.tsv (the header only).
 */
export function hunt1NoRows(reason: "noFamilies" | "noGenome", families: number): { flags: { noFamilies: true } | { noGenome: true }; summary: Hunt1Summary; tsv: string } {
  return { flags: reason === "noFamilies" ? { noFamilies: true } : { noGenome: true }, summary: { W: 0, Wexport: 0, families: reason === "noFamilies" ? 0 : families, fragments: 0, edgeShare: 0 }, tsv: `${HUNT1_COLUMNS.join("\t")}\n` };
}

/** One assay.tsv line of an export set: v1's columns for the planted pond, then X_f. */
export function hunt1Line(p: { set: string; replicate: number; pond: number; family: number; inoculum: string; planted: Planted; endTrait: number; success: number; exportMass: number }): string {
  return `${assayLine({ assay: "export", source: p.set, replicate: p.replicate, pond: p.pond, family: p.family, inoculum: p.inoculum, planted: p.planted, endTrait: p.endTrait, success: p.success })}\t${p.exportMass}`;
}

/** The assay.json of an export set: the existing fields (as `assayJson` writes them), `export` (the zone's threshold), then `extra` (labels, provenance, protocol pin, records). */
export function hunt1AssayJson(p: {
  protocolSha256: string;
  set: string;
  source: string;
  labels: Hunt1LabelSet;
  inoculum: string;
  k: number;
  period: number;
  ref: number;
  side: number;
  replicates: number;
  censusEvery: number;
  threshold: number;
  seeds: { physics: number; fragment: number }[];
  extra: Record<string, unknown>;
  summary: Hunt1Summary;
  wallSeconds: number;
}): Record<string, unknown> {
  return {
    tool: "scaffold-assays",
    protocolSha256: p.protocolSha256,
    assay: "export",
    source: p.source,
    tag: p.set,
    k: p.k,
    period: p.period,
    ref: p.ref,
    side: p.side,
    replicates: p.replicates,
    mutRate: 0,
    censusEvery: p.censusEvery,
    export: p.threshold,
    inoculum: p.inoculum,
    seeds: p.seeds,
    labels: p.labels,
    ...p.extra,
    summary: p.summary,
    conservationOk: true,
    wallSeconds: p.wallSeconds,
  };
}

// ---------------------------------------------------------------------------------------------
// Sources: protocol v1's main runs (G2)

/**
 * What is wrong with `o` as protocol v1's main-run source of scaf or rand history i at boundary 100 (none: it is), as `r3RepOriginOf` records a
 * checkpoint and its run directory: the path ends in scaffold/main/<arm>/i<i>/ckpt/b100-pre.blck.gz, the state's seed is 4,810,001 + 100 arm + i, its
 * step 1,000,000, its mutation rate the default one, on 8 x 8 ponds; the run's meta.json has the arm, seed, k 8, period 10,000, 100 cycles, side 8, a clone
 * init, the default mutation rate, census every 100 and the protocol hash the main runs recorded (`HUNT1_V1_PROTOCOL_SHA256`); its done.json is ok with
 * conservationOk true, 100 cycles and not ended (the history ran through boundary 100).
 */
export function hunt1V1SourceProblems(arm: "scaf" | "rand", i: number, o: unknown, role = "source"): string[] {
  const shape = checkpointShapeProblems(o, role);
  if (shape.length > 0) return shape;
  const p = o as R3RepOrigin;
  const seed = hunt1V1WorldSeed(arm, i);
  const mutRate = pondConfig(HUNT1_REGIME.side, 0).mutRate;
  const why: string[] = [];
  const want = (name: string, got: unknown, expected: unknown) => {
    if (got !== expected) why.push(`${role} ${name} ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
  };
  if (!new RegExp(`(^|/)scaffold/main/${arm}/i${i}/ckpt/b${HUNT1_V1_BOUNDARY}-pre\\.blck\\.gz$`).test(p.source)) why.push(`${role} path ${JSON.stringify(p.source)} does not end in scaffold/main/${arm}/i${i}/ckpt/b${HUNT1_V1_BOUNDARY}-pre.blck.gz`);
  want("seed", p.seed, seed);
  want("mutRate", p.mutRate, mutRate);
  want("step", p.step, HUNT1_V1_BOUNDARY * HUNT1_REGIME.period);
  if (p.tilesX !== HUNT1_REGIME.side || p.tilesY !== HUNT1_REGIME.side) why.push(`${role} has ${p.tilesX} x ${p.tilesY} ponds, want ${HUNT1_REGIME.side} x ${HUNT1_REGIME.side}`);
  const run: Record<string, unknown> = isRecord(p.run) ? p.run : {};
  const meta = isRecord(run.meta) ? run.meta : null;
  const done = isRecord(run.done) ? run.done : null;
  if (meta === null) why.push(`${role} is not inside a run directory with a readable meta.json`);
  else {
    const m = (key: string, expected: unknown) => want(`run meta.json ${key}`, meta[key], expected);
    m("arm", arm);
    m("seed", seed);
    m("k", 8);
    m("period", HUNT1_REGIME.period);
    m("cycles", HUNT1_V1_BOUNDARY);
    m("side", HUNT1_REGIME.side);
    m("init", "clone");
    m("mutRate", mutRate);
    m("censusEvery", HUNT1_REGIME.censusEvery);
    m("protocolSha256", HUNT1_V1_PROTOCOL_SHA256);
  }
  if (done === null) why.push(`${role} run has no readable done.json (unfinished)`);
  else {
    want("run done.json ok", done.ok, true);
    want("run done.json conservationOk", done.conservationOk, true);
    want("run done.json cycles", done.cycles, HUNT1_V1_BOUNDARY);
    if (done.ended === true) why.push(`${role} run done.json says the history ended, but its source is the boundary-${HUNT1_V1_BOUNDARY} pre-cycle state`);
  }
  return why;
}

// ---------------------------------------------------------------------------------------------
// Sources: runner bundles (D3 and Stage 1)

/** The boundary of a source's pre-cycle checkpoint: D3's world at 30, a history's time C at 200, an ancestor world at 1, a `-s` source at 100. */
export function hunt1BoundaryOf(source: Exclude<Hunt1Source, { kind: "v1" }>): number {
  return source.kind === "d3" ? 30 : source.kind === "hist" ? 200 : source.kind === "anc" ? 1 : 100;
}

/**
 * What a runner bundle must be to serve as a source (tools/run.ts's `<out>/<experiment>/<preset>/<condition>/seed-<n>`): its experiment (null: any,
 * the directory is then checked against the manifest's runId only), preset and identity, condition, world seed, `overrides` (null: none), the
 * pre-cycle boundary it is read at, the period, the pond grid and mutation rate of its state, and whether it is a branch run (and from which boundary).
 */
export interface Hunt1BundleWant {
  experiment: string | null;
  presetId: string;
  presetIdentity: string;
  condition: string;
  seed: number;
  overrides: Record<string, number> | null;
  boundary: number;
  period: number;
  side: number;
  mutRate: number;
  /** A branch run: the boundary it branched at and, when given, the directories (as path tails) its `branch.source` may end in: its source i's bundle in either origin. */
  branch: { boundary: number; sources?: readonly string[] } | null;
}

/**
 * The run bundle directories a -s source i may be, as path tails: the registration's scaf history i (`scaffold/reg1/hist/ponds/treatment/seed-<4,850,001 + i>`,
 * or its overflow rerun at census 100 in hist-c100) or the hunt's own scaffold phase (`ponds/treatment/seed-<4,901,501 + i>`, condition treatment), all under
 * the sources rule's one origin. The report reads the same two (`huntSourceOriginOf`).
 */
export function hunt1SourceDirsOf(i: number): string[] {
  const reg = `ponds/treatment/seed-${reg1WorldSeedOf(reg1H("scaf", i))}`;
  return [`scaffold/reg1/hist/${reg}`, `scaffold/reg1/hist-c100/${reg}`, `ponds/treatment/seed-${hunt1OwnScaffoldSeed(i)}`];
}

/** `dir` split at its experiment: `<prefix><experiment>/<preset>/<condition>/seed-<seed>`, the directory tools/run.ts writes; null when it has no such shape. */
function bundleSplit(dir: string, want: Pick<Hunt1BundleWant, "presetId" | "condition" | "seed">): { prefix: string; experiment: string } | null {
  const tail = `/${want.presetId}/${want.condition}/seed-${want.seed}`;
  const d = dir.replace(/\/+$/, "");
  if (!d.endsWith(tail)) return null;
  const head = d.slice(0, d.length - tail.length);
  const k = head.lastIndexOf("/");
  const experiment = head.slice(k + 1);
  return experiment === "" ? null : { prefix: head.slice(0, k + 1), experiment };
}

/**
 * The tails `<experiment>/<preset>/<condition>/seed-<seed>` of the bundle `dir` names and of its twin: the run, and its overflow rerun at census 100
 * (`<experiment>-c100`, "Validity" 3), whichever of the two `dir` is (as `reg1BundleWantsOf` pairs hist with hist-c100). A source named by its normal
 * directory is the single complete bundle of the two. null when `dir` has not the shape, or (an experiment named by `want`) is not that experiment or its rerun.
 */
export function hunt1BundleTailsOf(want: Pick<Hunt1BundleWant, "experiment" | "presetId" | "condition" | "seed">, dir: string): [string, string] | null {
  const split = bundleSplit(dir, want);
  if (split === null) return null;
  const base = split.experiment.endsWith("-c100") ? split.experiment.slice(0, -"-c100".length) : split.experiment;
  if (base === "" || (want.experiment !== null && base !== want.experiment)) return null;
  const rest = `${want.presetId}/${want.condition}/seed-${want.seed}`;
  return [`${base}/${rest}`, `${base}-c100/${rest}`];
}

/**
 * The bundle `source` must come from, with `death` (`HUNT1_DEATH.base`, or `.fallback` once G1's e = 1 fallback passes, which D3 and the histories then
 * run under as the override { pondDeath: 65536 }):
 * - D3: runs/scaffold/hunt1/d3/ponds/pond-<nat|shuf>/seed-<4,900,401 + 10 arm + j>, overrides { mutRate: 0 }, boundary 30;
 * - a history: condition pond-nat or pond-shuf, seed 4,901,001 + 100 a + i, boundary 200, a branch from boundary 100 for the `-s` arms (whose `branch.source` ends in
 *   source i's directory, `hunt1SourceDirsOf`) and none for the `-a` arms;
 * - an ancestor world: pond-cont, seed 4,901,401 + j, boundary 1;
 * - a `-s` source of the hunt's own scaffold phase: treatment, seed 4,901,501 + i, boundary 100 (the registration's own bundles go through reg1's checks).
 */
export function hunt1BundleWant(source: Exclude<Hunt1Source, { kind: "v1" }>, death: number = HUNT1_DEATH.base): Hunt1BundleWant {
  if (death !== HUNT1_DEATH.base && death !== HUNT1_DEATH.fallback) throw new Error(`pondDeath must be ${HUNT1_DEATH.base} or ${HUNT1_DEATH.fallback}, got ${death}`);
  const fallback: Record<string, number> = death === HUNT1_DEATH.fallback ? { pondDeath: death } : {};
  const base = { presetId: "ponds", presetIdentity: REG1_PONDS_IDENTITY, period: HUNT1_REGIME.period, side: HUNT1_REGIME.side, mutRate: pondConfig(HUNT1_REGIME.side, 0).mutRate, boundary: hunt1BoundaryOf(source), branch: null };
  switch (source.kind) {
    case "d3": {
      const arm = source.arm === "nat" ? 0 : 1;
      return { ...base, experiment: "d3", condition: `pond-${source.arm}`, seed: hunt1D3WorldSeed(arm, source.j), overrides: { mutRate: 0, ...fallback }, mutRate: 0 };
    }
    case "hist": {
      const a = HUNT1_HISTORY_ARMS.indexOf(source.arm);
      return { ...base, experiment: null, condition: `pond-${source.arm.startsWith("nat") ? "nat" : "shuf"}`, seed: hunt1HistorySeed(a, source.i), overrides: death === HUNT1_DEATH.fallback ? fallback : null, branch: source.arm.endsWith("-s") ? { boundary: HUNT1_V1_BOUNDARY, sources: hunt1SourceDirsOf(source.i) } : null };
    }
    case "anc":
      return { ...base, experiment: null, condition: "pond-cont", seed: hunt1AncestorSeed(source.j), overrides: null };
    case "src":
      return { ...base, experiment: null, condition: "treatment", seed: hunt1OwnScaffoldSeed(source.i), overrides: null };
  }
}

/** A bundle source as loaded: `loadReg1Source`'s record, with the manifest's `branch` (null when it records none) beside its run record. */
export interface Hunt1BundleSource extends Reg1Source {
  run: Reg1RunRecord & { branch: unknown };
}

/**
 * Loads a source from a runner bundle: the pre-cycle checkpoint of `boundary` (the file its manifest lists for it), as `loadReg1Source` reads a
 * run bundle, and the manifest's `branch`. With `want`, a source named by its normal directory is the single complete bundle among `<experiment>` and its
 * overflow rerun `<experiment>-c100` (`hunt1BundleTailsOf`; the record's `candidates` say which were complete, `hunt1BundleProblems` refuses two). Whether the
 * bundle is the hunt's is `hunt1BundleProblems`'s to say. Throws when there is no state to load.
 */
export async function loadHunt1Source(dir: string, boundary: number, read: (path: string) => Promise<Uint8Array>, want?: Hunt1BundleWant): Promise<{ state: WorldState; record: Hunt1BundleSource }> {
  // `loadReg1Source` reads only the `dir` of what it is given: the two bundles the source may come from.
  const tails = want === undefined ? null : hunt1BundleTailsOf(want, dir);
  const { state, record } = await loadReg1Source(dir, boundary, read, tails === null ? undefined : tails.map((t) => ({ dir: t }) as Reg1BundleWant));
  let branch: unknown = null;
  try {
    const m: unknown = JSON.parse(new TextDecoder().decode(await read(record.run.manifest)));
    if (isRecord(m) && m.branch !== undefined) branch = m.branch;
  } catch {
    // no readable manifest: the run record says so
  }
  return { state, record: { ...record, run: { ...record.run, branch } } };
}

/** `got` (a spec's `overrides`, absent for none) holds exactly the keys and values of `want` (null: none). */
function overridesProblem(got: unknown, want: Record<string, number> | null): string | null {
  const fmt = (x: unknown) => JSON.stringify(x === undefined ? null : x);
  if (want === null) return got === undefined || got === null ? null : `spec.overrides ${fmt(got)}, want none`;
  const ok = isRecord(got) && Object.keys(got).length === Object.keys(want).length && Object.entries(want).every(([k, v]) => got[k] === v);
  return ok ? null : `spec.overrides ${fmt(got)}, want ${fmt(want)}`;
}

/**
 * What is wrong with `p` as the source a runner bundle gives for `want` (none: it is), every problem listed and prefixed with `role`.
 * - The directory ends in `<experiment>/<preset>/<condition>/seed-<seed>` (when the experiment is named; its overflow rerun `<experiment>-c100` is the same
 *   bundle) and in the manifest's runId, which is its spec's.
 * - The loader looked at both the run and its rerun (`candidates`, as `reg1SourceProblems` requires) and at most one of them is complete: two complete runs of
 *   one source leave it ambiguous.
 * - The manifest is complete (summary and finishedAt) with `summary.conservationOk` true and RULE_VERSION's rule version, and records the preset's identity.
 * - Its spec has the preset, condition, seed and `overrides` of `want` (none: no overrides) and no alternative founding or metapopulation, and lists
 *   the boundary in `preCycleCheckpoints`.
 * - The checkpoint is the manifest's file for the boundary (checkpoints/b<NNN>-pre.blck) and its state hashes to the hash recorded there; the state's
 *   step is boundary x period, and its config is the spec's (`specConfig`), so its seed is `spec.seed`, on `want.side`² ponds at the wanted mutation rate.
 * - A branch run (`want.branch`) records `branch` with the boundary it branched at, its source hash and its post-transform hash, and a source directory
 *   among `want.branch.sources`; any other run records none.
 */
export function hunt1BundleProblems(want: Hunt1BundleWant, p: unknown, role = "source"): string[] {
  const shape = checkpointShapeProblems(p, role);
  if (shape.length > 0) return shape;
  const s = p as Hunt1BundleSource;
  const why: string[] = [];
  const is = (name: string, got: unknown, expected: unknown) => {
    if (got !== expected) why.push(`${role} ${name} ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
  };
  const dir = s.source.replace(/\/+$/, "");
  const tails = hunt1BundleTailsOf(want, dir);
  if (want.experiment !== null) {
    const tail = `${want.experiment}/${want.presetId}/${want.condition}/seed-${want.seed}`;
    if (tails === null) why.push(`${role} directory ${JSON.stringify(s.source)} is not ${tail} or its -c100 rerun`);
  }
  // The bundles it was chosen from: the run and its overflow rerun at census 100, at most one of them complete.
  const candidates = Array.isArray(s.candidates) ? s.candidates.filter(isRecord) : null;
  if (candidates === null) why.push(`${role} records no candidate bundles`);
  else {
    for (const t of tails ?? []) if (!candidates.some((c) => typeof c.dir === "string" && endsInPath(c.dir.replace(/\/+$/, ""), t))) why.push(`${role} was not chosen with ${t} in view`);
    const complete = candidates.filter((c) => c.complete === true).map((c) => c.dir);
    if (complete.length > 1) why.push(`${role} is ambiguous: ${complete.length} complete runs of it (${complete.join(", ")}), want one`);
  }
  is("boundary", s.boundary, want.boundary);
  is("seed", s.seed, want.seed);
  is("mutRate", s.mutRate, want.mutRate);
  if (s.tilesX !== want.side || s.tilesY !== want.side) why.push(`${role} has ${s.tilesX} x ${s.tilesY} ponds, want ${want.side} x ${want.side}`);
  if (s.sameConfig !== true) why.push(`${role} state's config ${s.sameConfig === false ? "is not" : "was not compared with"} its spec's (specConfig)`);
  const run: Record<string, unknown> = isRecord(s.run) ? s.run : {};
  const spec = isRecord(run.spec) ? run.spec : null;
  if (spec === null) why.push(`${role} has no readable manifest.json with a spec${typeof run.manifest === "string" ? ` (${run.manifest})` : ""}`);
  else {
    if (want.experiment !== null && spec.experiment !== want.experiment && spec.experiment !== `${want.experiment}-c100`) why.push(`${role} spec.experiment ${JSON.stringify(spec.experiment)}, want ${JSON.stringify(want.experiment)} or ${JSON.stringify(`${want.experiment}-c100`)}`);
    for (const key of ["presetId", "condition", "seed"] as const) is(`spec.${key}`, spec[key], want[key]);
    const over = overridesProblem(spec.overrides, want.overrides);
    if (over !== null) why.push(`${role} ${over}`);
    for (const key of ["soloFounder", "soloGenome", "founderSet", "metapopulation"]) if (spec[key] !== undefined) why.push(`${role} spec sets ${key}, which no hunt run does`);
    const id = runId(spec as unknown as RunSpec);
    if (run.runId !== id) why.push(`${role} manifest runId ${JSON.stringify(run.runId)} is not its spec's ${JSON.stringify(id)}`);
    else if (!endsInPath(dir, id)) why.push(`${role} directory ${JSON.stringify(s.source)} does not end in its manifest's runId ${id}`);
    if (!(Array.isArray(spec.preCycleCheckpoints) && spec.preCycleCheckpoints.includes(want.boundary))) why.push(`${role} spec.preCycleCheckpoints ${JSON.stringify(spec.preCycleCheckpoints)} does not list boundary ${want.boundary}`);
  }
  if (run.complete !== true) why.push(`${role} run is incomplete: its manifest.json has no summary and finishedAt`);
  else is("run summary.conservationOk", run.conservationOk, true);
  is("run ruleVersion", run.ruleVersion, RULE_VERSION);
  is("run presetIdentity", run.presetIdentity, want.presetIdentity);
  is("step", s.step, want.boundary * want.period);
  const e = isRecord(run.preCycle) ? run.preCycle : null;
  if (e === null) why.push(`${role} manifest lists no pre-cycle checkpoint at boundary ${want.boundary}`);
  else {
    is("manifest pre-cycle file", e.file, reg1PreCycleFileOf(want.boundary));
    is("manifest pre-cycle step", e.step, want.boundary * want.period);
    if (s.checkpoint !== `${dir}/${e.file}`) why.push(`${role} checkpoint ${JSON.stringify(s.checkpoint)} is not the manifest's file for boundary ${want.boundary} (${JSON.stringify(e.file)})`);
    if (s.stateHash !== e.hash) why.push(`${role} state hash ${s.stateHash}, but the manifest records ${JSON.stringify(e.hash)} for boundary ${want.boundary}`);
  }
  const branch = run.branch;
  if (want.branch === null) {
    if (branch !== null && branch !== undefined) why.push(`${role} manifest records a branch, but it is not a branch run`);
  } else if (!isRecord(branch)) why.push(`${role} manifest records no branch, but it is a branch run from boundary ${want.branch.boundary}`);
  else {
    is("branch.boundary", branch.boundary, want.branch.boundary);
    for (const key of ["sourceHash", "postHash"]) if (typeof branch[key] !== "string" || branch[key] === "") why.push(`${role} branch.${key} ${JSON.stringify(branch[key])} is not a state hash`);
    const sources = want.branch.sources;
    if (sources !== undefined && !(typeof branch.source === "string" && sources.some((t) => endsInPath((branch.source as string).replace(/\/+$/, ""), t)))) why.push(`${role} branch.source ${JSON.stringify(branch.source)} does not end in its source's directory (${sources.join(" or ")})`);
  }
  return why;
}
