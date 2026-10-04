import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { holm, mannWhitney, wilcoxonSignedRank } from "@bl/metrics";
import * as schema from "@bl/schema";
import { CH, PRESETS, applyCurrentCycle, buildWorld, cellCount, defaultConfig, encodeCheckpoint, initWorld, pondMatter, stateHash, worldW, type WorldState } from "@bl/schema";
import { specConfig } from "@bl/runner";
import { pondConfig, randomKey } from "../lib/ponds.ts";
import { assaySuccess } from "../lib/pond-assay.ts";
import { binomialUpperTail, icc1, permutationP, populationCv, reg1ReportQueueCheck, reg1ReportSignTest, tsvRows } from "../lib/scaffold-stats.ts";
import {
  HUNT1_PROTOCOL,
  HUNT_ARMS,
  HUNT_DEATH,
  HUNT_POND_COLUMNS,
  HUNT_SEEDS,
  effectiveDonors,
  huntAncestorSeed,
  huntAssaySeed,
  huntBoundaryProblems,
  huntBundleHashes,
  huntBundleProblems,
  huntD3Seed,
  huntD3WorldSeed,
  huntDeviceCheck,
  huntEvaluate,
  huntExpectedRuns,
  huntExpectedSet,
  huntExpectedSets,
  huntFragmentRow,
  huntG1Decide,
  huntG1Of,
  huntG1Run,
  huntG1Seed,
  huntG1Set,
  huntG2Decide,
  huntG2Seed,
  huntH,
  huntHeredity,
  huntHistorySeed,
  huntHistoryStatuses,
  huntMannWhitney,
  huntOccupancy,
  huntPairingProblems,
  huntPondsExpectOf,
  huntPondsSummary,
  huntProtocolProblems,
  huntQueueInstances,
  huntReadout,
  huntRecolonisation,
  huntRecoloniserSucceeds,
  huntReproSelection,
  huntReproTargets,
  huntReproducibility,
  huntResolveRuns,
  huntRoleOf,
  huntScreenSets,
  huntSelectionStrength,
  huntSignedRank,
  huntSourceProblems,
  huntSourceOriginOf,
  huntV1SourceProblems,
  huntStage0Readout,
  huntStatuses,
  huntWOf,
  midranks,
  spearman,
  type HuntArm,
  type HuntCheckpointCheck,
  type HuntDonorCheck,
  type HuntFragment,
  type HuntPondsExpect,
  type HuntPondsSummary,
  type HuntRun,
  type HuntSet,
  type HuntSetDir,
} from "../lib/hunt-stats.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORT = join(REPO, "tools", "scaffold-report.ts");
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const b3 = (b: number) => `b${String(b).padStart(3, "0")}`;

/** Whether `x` holds a NaN or an infinity anywhere (the readouts print null for what is undefined, never NaN). */
function hasNonFinite(x: unknown): boolean {
  if (typeof x === "number") return !Number.isFinite(x);
  if (Array.isArray(x)) return x.some(hasNonFinite);
  if (x !== null && typeof x === "object") return Object.values(x).some(hasNonFinite);
  return false;
}

// ---------------------------------------------------------------------------------------------
// ponds.tsv fixtures

/** One pond at one boundary: its pre-cycle trait, export mass X, weight (default X), death, donor and retained mass. */
interface Pond {
  trait: number;
  x: number;
  w?: number;
  died: 0 | 1;
  donor: number;
  ret?: number;
  trunc?: number;
  lineages?: number;
}

/** A ponds.tsv as lines (header first) for `boundaries`, `at(b)` giving the 64 ponds; `mutate` edits a row's cells before it is written. */
function pondsLines(boundaries: number[], at: (b: number) => Pond[], o: { cols?: readonly string[]; period?: number; mutate?: (b: number, p: number, cells: Record<string, string | number>) => void } = {}): string[] {
  const cols = o.cols ?? HUNT_POND_COLUMNS;
  const out = [cols.join("\t")];
  for (const b of boundaries) {
    const ponds = at(b);
    ponds.forEach((q, p) => {
      const cells: Record<string, string | number> = {
        cycle: b,
        step: b * (o.period ?? 10_000),
        recipient: p,
        donor: q.donor,
        cx: q.donor >= 0 ? 32 : -1,
        cy: q.donor >= 0 ? 32 : -1,
        landed: 0,
        reqMass: 0,
        retMass: q.donor >= 0 ? (q.ret ?? 0) : 0,
        reqE: 0,
        retE: 0,
        truncated: q.donor >= 0 ? (q.trunc ?? 0) : 0,
        packetLineages: 0,
        domHi: 0,
        domLo: 0,
        domShare: 0,
        donorTrait: q.donor >= 0 ? ponds[q.donor].trait : 0,
        recipientTrait: q.trait,
        recipientIndividuals: 0,
        recipientLineages: q.lineages ?? 0,
        heat: "0",
        light: "0",
        died: q.died,
        exportMass: q.x,
        weight: q.w ?? q.x,
      };
      o.mutate?.(b, p, cells);
      out.push(cols.map((c) => String(cells[c] ?? 0)).join("\t"));
    });
  }
  return out;
}

/**
 * A scripted world: every pond's trait, export mass and death at each boundary (default: all occupied with trait 40,000 and X = 500 + 25 p, a pond
 * dying at (p + b) even, donors drawn among the exporting ponds, no donor at all when none exports). For shuf the weights are the exporters' X shifted
 * one place round, a permutation of the same multiset.
 */
function scenario(arm: "nat" | "shuf", o: { trait?: (b: number, p: number) => number; x?: (b: number, p: number, trait: number) => number; dies?: (b: number, p: number, trait: number) => boolean; ret?: number } = {}): (b: number) => Pond[] {
  return (b) => {
    const traits = range(64).map((p) => (o.trait ? o.trait(b, p) : 40_000));
    const xs = range(64).map((p) => (traits[p] > 0 ? (o.x ? o.x(b, p, traits[p]) : 500 + 25 * p) : 0));
    const exporters = range(64).filter((p) => xs[p] > 0);
    const w = xs.map((x) => (arm === "nat" ? x : 0));
    if (arm === "shuf") exporters.forEach((p, k) => (w[p] = xs[exporters[(k + 1) % exporters.length]]));
    const dies = range(64).map((p) => traits[p] === 0 || (o.dies ? o.dies(b, p, traits[p]) : (p + b) % 2 === 0));
    return range(64).map((p) => ({ trait: traits[p], x: xs[p], w: w[p], died: dies[p] ? (1 as const) : (0 as const), donor: !dies[p] ? -2 : exporters.length ? exporters[(7 * p + b) % exporters.length] : -1, ret: o.ret ?? 5_000, lineages: 4 }));
  };
}

const NAT_PONDS = (first: number, last: number): HuntPondsExpect => ({ ponds: 64, first, last, period: 10_000, arm: "nat" });
const boundariesOf = (first: number, last: number) => range(last - first + 1).map((k) => first + k);

async function summaryOf(lines: string[], expect: HuntPondsExpect) {
  return huntPondsSummary(tsvRows(lines), expect);
}

/** A run of `kind` read from a scripted ponds.tsv at boundaries 1..30. */
async function g1RunOf(id: string, arm: "nat" | "shuf", seed: number, at: (b: number) => Pond[], over: Partial<HuntRun> = {}): Promise<HuntRun> {
  const { summary, problems } = await summaryOf(pondsLines(boundariesOf(1, 30), at), { ...NAT_PONDS(1, 30), arm });
  return { id, kind: "g1", arm, seed, index: 0, dir: `/runs/${id}`, resolved: summary !== null, why: problems, conservationOk: true, hashes: {}, branch: null, fingerprint: null, censusEvery: 1000, host: null, ponds: summary, ...over };
}

// ---------------------------------------------------------------------------------------------
// export-set fixtures

const HASH = (id: string, what: string) => createHash("sha256").update(`${id}:${what}`).digest("hex").slice(0, 16);
/** Ancestor world 0's b001-pre hash: the source of the genome-only sets and the control, and of s1-anc-j0. */
const ANC_HASH = HASH("ancestor-j0", "b001");

/**
 * What a production set records under `provenance` for its source (strict screening reads it): the state hash (a history's set: `HASH(set id, "source")`, which
 * `histBundle` gives the history's b200-pre), protocol v1's main-run record for G2, the registration's bundle for a -s source, ancestor world 0's b001-pre
 * for a genome-only set and the control (with the donor history's b200-pre and dominant genome for a genome-only set).
 */
function provenanceOf(id: string, record?: "noFamilies" | "noGenome"): Record<string, unknown> {
  const stateHash = HASH(id.replace(/-quench$/, ""), "source"); // a quenched control reads its W set's source
  const g2 = /^g2-(scaf|rand)-i([0-5])/.exec(id);
  if (g2) return { source: `runs/scaffold/main/${g2[1]}/i${g2[2]}/ckpt/b100-pre.blck.gz`, stateHash, seed: 4_810_001 + (g2[1] === "scaf" ? 0 : 100) + Number(g2[2]), step: 1_000_000 };
  const src = /^s1-src-i(\d\d)$/.exec(id);
  if (src) return { source: `runs/scaffold/reg1/hist/ponds/treatment/seed-${4_850_001 + Number(src[1])}`, stateHash };
  if (id === "s1-anc-j0" || id === "s1-genome-control") return { stateHash: ANC_HASH };
  const genome = /^s1-((?:nat|shuf)-[as]-i\d\d)-genome$/.exec(id);
  if (genome) return { stateHash: ANC_HASH, donor: { stateHash: HASH(`s1-${genome[1]}`, "source"), dominant: record === "noGenome" ? null : { hi: 1, lo: 2 } } };
  return { stateHash };
}

/**
 * An export set's assay.json and rows for `id`: 64 x replicates fragments, fragment g = 64 s + f from family families[g mod m] (default: every pond a
 * family), X_f = `x(g, family)` (default 1,000), trait X_f + 2,000, a retained mass of 5,000 and v1's success flag. `json` merges over the assay.json.
 */
function setDir(id: string, o: { families?: number[]; x?: (g: number, family: number) => number; trait?: (g: number, x: number) => number; json?: Record<string, unknown>; rows?: (rows: HuntFragment[]) => HuntFragment[]; record?: "noFamilies" | "noGenome"; dir?: string } = {}): HuntSetDir {
  const want = huntExpectedSet(id)!;
  const families = o.families ?? range(64);
  let rows: HuntFragment[] = [];
  if (!o.record) {
    for (let s = 0; s < want.replicates; s++) {
      for (let f = 0; f < 64; f++) {
        const g = 64 * s + f;
        const family = families[g % families.length];
        const x = o.x ? o.x(g, family) : 1_000;
        const endTrait = o.trait ? o.trait(g, x) : x + 2_000;
        rows.push({ assay: "export", inoculum: "fragment", replicate: s, pond: f, family, retMass: 5_000, retE: 3_000, endTrait, success: assaySuccess(endTrait, 5_000, 103_058), exportMass: x });
      }
    }
  }
  if (o.rows) rows = o.rows(rows);
  const w = huntWOf(rows);
  const json = {
    tool: "scaffold-assays",
    assay: "export",
    source: `/runs/${id}`,
    k: 8,
    period: 10_000,
    ref: 103_058,
    side: 8,
    replicates: want.replicates,
    mutRate: 0,
    censusEvery: 100,
    inoculum: "fragment",
    seeds: want.seeds,
    labels: { hunt1: true, stage: want.stage, set: id, h: want.labelH, variant: want.kind },
    protocolSha256Hunt1: HUNT1_PROTOCOL.sha256,
    provenance: provenanceOf(id, o.record),
    ...(o.record === "noFamilies" ? { noFamilies: true } : o.record === "noGenome" ? { noGenome: true } : {}),
    summary: { W: w.W, Wexport: w.W, families: w.families, fragments: w.fragments, edgeShare: w.edgeShare },
    conservationOk: true,
    ...o.json,
  };
  return { dir: o.dir ?? `/sets/${id}`, json, rows };
}

/**
 * A fault of the rows that rejects a set but leaves its protocol membership alone (its seeds, regime and source are the hunt's): two fragments of a quenched control
 * come from the wrong families. A rejected control with this fault still counts at the gates; one with a foreign seed, regime, source or a smoke waiver never does.
 */
const swapFamilies = (rows: HuntFragment[]): HuntFragment[] => rows.map((x, k) => (k < 2 ? { ...x, family: 1 - k } : x));
const SWAPPED = "2 fragments are not from family g mod m (g = 64 replicate + pond, m = 64, the families in ascending pond index)";

const SHA = HUNT1_PROTOCOL.sha256;
const screen = (dirs: HuntSetDir[], stage: "g2" | "d3" | "s1", more: Partial<Parameters<typeof huntScreenSets>[1]> = {}) => huntScreenSets(dirs, { stage, sha: SHA, ...more });

/** Every pre-cycle checkpoint file exists and is not empty, for the tests of bundles that do not read files. */
const filesPresent = async (): Promise<number | null> => 1;

type ScreenBundle = Pick<HuntRun, "resolved" | "hashes" | "branch" | "ponds">;
/** The source hash the -s histories of index i branched from: the one their registration source's set records. */
const srcHash = (i: number) => HASH(`s1-src-i${String(i).padStart(2, "0")}`, "source");
/**
 * The bundles Stage 1's strict screen reads, as `provenanceOf` records them: ancestor world 0 (its b001-pre) and every history (its b200-pre, and for a -s
 * history the source hash of its index). `bad` lists histories whose bundle is unresolved, `omit` bundles that are not given.
 */
function s1Bundles(o: { bad?: string[]; omit?: string[] } = {}): Map<string, ScreenBundle> {
  const m = new Map<string, ScreenBundle>([["ancestor-j0", { resolved: true, hashes: { 1: ANC_HASH }, branch: null, ponds: null }]]);
  for (const arm of HUNT_ARMS) {
    for (let i = 0; i < 24; i++) {
      const id = `${arm}-i${String(i).padStart(2, "0")}`;
      m.set(id, { resolved: !(o.bad ?? []).includes(id), hashes: { 200: HASH(`s1-${id}`, "source") }, branch: arm.endsWith("-s") ? { sourceHash: srcHash(i), boundary: 100 } : null, ponds: null });
    }
  }
  for (const id of o.omit ?? []) m.delete(id);
  return m;
}

// ---------------------------------------------------------------------------------------------
// bundle fixtures

const HOSTS = {
  mac: { host: "deno 2.9.7 darwin-aarch64", adapter: "apple m2" },
  1: { host: "deno 2.9.7 linux-x86_64", adapter: "nvidia a10g (1)" },
  2: { host: "deno 2.9.7 linux-x86_64", adapter: "nvidia a10g (2)" },
  3: { host: "deno 2.9.7 linux-x86_64", adapter: "nvidia a10g (3)" },
};

type ManifestKind = "g1" | "g1f" | "d3" | "history" | "repro" | "ancestor" | "device" | "scaffold";

/** A run bundle's manifest.json as tools/run.ts writes it for the hunt (`over` merged over it). */
function manifest(kind: ManifestKind, o: { arm?: "nat" | "shuf"; histArm?: HuntArm; i?: number; pondDeath?: number; over?: Record<string, unknown> } = {}): Record<string, any> {
  const histArm = o.histArm ?? "nat-a";
  const arm: "nat" | "shuf" = o.arm ?? (histArm.startsWith("nat") ? "nat" : "shuf");
  const i = o.i ?? 0;
  const death = o.pondDeath ?? HUNT_DEATH.base;
  const dash = histArm.endsWith("-s");
  const seed = { g1: () => huntG1Seed(arm, i), g1f: () => huntG1Seed(arm, i, true), d3: () => huntD3WorldSeed(arm, i), history: () => huntHistorySeed(histArm, i), repro: () => huntHistorySeed(histArm, i), ancestor: () => huntAncestorSeed(i), device: () => HUNT_SEEDS.device, scaffold: () => HUNT_SEEDS.ownScaffold + i }[kind]();
  const shape = {
    g1: { steps: 300_000, pre: [] as number[], overrides: undefined as any, mut: 429_497, death: HUNT_DEATH.base },
    g1f: { steps: 300_000, pre: [], overrides: { pondDeath: HUNT_DEATH.fallback }, mut: 429_497, death: HUNT_DEATH.fallback },
    d3: { steps: 300_000, pre: [30], overrides: { mutRate: 0, ...(death === HUNT_DEATH.fallback ? { pondDeath: death } : {}) }, mut: 0, death },
    // A -s history's steps count from its source's step (10^6): spec.steps 10^6 and 340,000, ending at the absolute steps 2 x 10^6 and 1,340,000.
    history: { steps: dash ? 1_000_000 : 2_000_000, end: 2_000_000, pre: [dash ? 134 : 34, 200], overrides: death === HUNT_DEATH.fallback ? { pondDeath: death } : undefined, mut: 429_497, death },
    repro: { steps: 340_000, end: dash ? 1_340_000 : 340_000, pre: [dash ? 134 : 34], overrides: death === HUNT_DEATH.fallback ? { pondDeath: death } : undefined, mut: 429_497, death },
    ancestor: { steps: 10_000, pre: [1], overrides: undefined, mut: 429_497, death: 0 },
    device: { steps: 20_000, pre: [], overrides: death === HUNT_DEATH.fallback ? { pondDeath: death } : undefined, mut: 429_497, death },
    // The hunt's own scaffold phase (the sources rule's fallback): the registration's treatment run to boundary 100, from the preset's own scaf arm.
    scaffold: { steps: 1_000_000, pre: [100], overrides: undefined, mut: 429_497, death: 0 },
  }[kind];
  const condition = kind === "ancestor" ? "pond-cont" : kind === "scaffold" ? "treatment" : `pond-${arm}`;
  const experiment = kind;
  const branched = (kind === "history" || kind === "repro") && dash;
  const id = `${kind}-${arm}-${i}`;
  return {
    runId: `${experiment}/ponds/${condition}/seed-${seed}`,
    spec: { experiment, presetId: "ponds", condition, seed, steps: shape.steps, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0, ...(shape.pre.length ? { preCycleCheckpoints: shape.pre } : {}), ...(shape.overrides ? { overrides: shape.overrides } : {}) },
    cfg: { mutRate: shape.mut, pondPeriod: 10_000, tilesX: 8, tilesY: 8, pondArm: kind === "ancestor" ? "cont" : kind === "scaffold" ? "scaf" : arm, ...(kind === "ancestor" || kind === "scaffold" ? {} : { pondDeath: shape.death, pondExport: 28 }) },
    presetIdentity: "56526b894cfccf3f",
    ...(branched ? { branch: { source: `/runs/reg1/scaf-i${String(i).padStart(2, "0")}/b100.blck`, sourceHash: HASH(`src${i}`, "b100"), boundary: 100, postHash: HASH(id, "post") } } : { initHash: HASH(id, "init") }),
    host: kind === "repro" ? HOSTS.mac : kind === "device" ? HOSTS[1] : HOSTS[((i % 3) + 1) as 1 | 2 | 3],
    startStep: branched ? 1_000_000 : 0,
    checkpoints: [],
    ...(shape.pre.length ? { preCycleCheckpoints: shape.pre.map((b) => ({ boundary: b, step: b * 10_000, file: `checkpoints/${b3(b)}-pre.blck`, hash: HASH(`${kind}-${histArm}-${arm}-${i}`, b3(b)) })) } : {}),
    summary: { steps: (shape as { end?: number }).end ?? shape.steps, finalHash: "final", conservationOk: true },
    finishedAt: "2026-10-03T00:00:00.000Z",
    ...o.over,
  };
}

const hashOf = (kind: ManifestKind, o: { histArm?: HuntArm; arm?: "nat" | "shuf"; i?: number }, b: number): string => {
  const histArm = o.histArm ?? "nat-a";
  const arm = o.arm ?? (histArm.startsWith("nat") ? "nat" : "shuf");
  return HASH(`${kind}-${histArm}-${arm}-${o.i ?? 0}`, b3(b));
};

// =============================================================================================

describe("the frozen hunt, its seeds and its sets", () => {
  it("is pinned by SHA-256 and length as the freeze record says, and an amendment at the end keeps the pin", async () => {
    const doc = new Uint8Array(readFileSync(join(REPO, HUNT1_PROTOCOL.doc)));
    expect(HUNT1_PROTOCOL.bytes).toBe(38_736);
    expect(HUNT1_PROTOCOL.sha256).toBe("13246200a5277ecbbbefb8d5b220f61a10ba1d33dc39a748fefbc224904a1f97");
    expect(createHash("sha256").update(doc.subarray(0, HUNT1_PROTOCOL.bytes)).digest("hex")).toBe(HUNT1_PROTOCOL.sha256);
    expect(readFileSync(join(REPO, "experiments/scaffold/HUNT-v1"), "utf8").trim().split(/\s+/)[0]).toBe(HUNT1_PROTOCOL.sha256);
    expect(await huntProtocolProblems(doc)).toEqual([]);
    const amended = new Uint8Array([...doc, ...new TextEncoder().encode("\n## Amendment 1 (2026-10-03)\n\nA dated amendment at the end.\n")]);
    expect(await huntProtocolProblems(amended)).toEqual([]);
    for (const at of [0, 5000, HUNT1_PROTOCOL.bytes - 1]) {
      const edited = amended.slice();
      edited[at] ^= 1;
      expect((await huntProtocolProblems(edited)).join(" ")).toMatch(/^docs\/scaffold-transition-hunt-v1\.md no longer begins with its frozen text \(SHA-256 13246200.*; its first 38736 bytes hash to [0-9a-f]{64}\)/);
    }
    expect(await huntProtocolProblems(doc.subarray(0, 100))).toEqual(["docs/scaffold-transition-hunt-v1.md has 100 bytes, fewer than the 38736 it had when frozen"]);
  });

  it("keeps its ponds.tsv columns as the schema's, when the schema exports them", () => {
    const fromSchema = (schema as unknown as { HUNT_POND_COLUMNS?: readonly string[] }).HUNT_POND_COLUMNS;
    expect([...HUNT_POND_COLUMNS].slice(-3)).toEqual(["died", "exportMass", "weight"]);
    expect(HUNT_POND_COLUMNS).toHaveLength(schema.POND_COLUMNS.length + 3);
    if (fromSchema !== undefined) expect([...fromSchema]).toEqual([...HUNT_POND_COLUMNS]);
  });

  it("follows the hunt's seed formulas at their corners, with their maxima and range checks", () => {
    expect([huntG1Seed("nat", 0), huntG1Seed("nat", 1), huntG1Seed("shuf", 0), huntG1Seed("shuf", 1)]).toEqual([4_900_001, 4_900_002, 4_900_011, 4_900_012]);
    expect([huntG1Seed("nat", 0, true), huntG1Seed("shuf", 1, true)]).toEqual([4_900_101, 4_900_112]);
    expect([huntG2Seed(0, 0), huntG2Seed(11, 3)]).toEqual([4_900_201, 4_900_314]);
    expect([huntD3WorldSeed("nat", 0), huntD3WorldSeed("shuf", 3)]).toEqual([4_900_401, 4_900_414]);
    expect([huntD3Seed("nat", 0, 0), huntD3Seed("shuf", 3, 3)]).toEqual([4_900_501, 4_900_574]);
    expect([huntHistorySeed("nat-a", 0), huntHistorySeed("shuf-a", 0), huntHistorySeed("nat-s", 23), huntHistorySeed("shuf-s", 23)]).toEqual([4_901_001, 4_901_101, 4_901_224, 4_901_324]);
    expect([huntH("nat-a", 0), huntH("shuf-a", 0), huntH("nat-s", 0), huntH("shuf-s", 23)]).toEqual([0, 24, 48, 95]);
    expect([huntAncestorSeed(0), huntAncestorSeed(3)]).toEqual([4_901_401, 4_901_404]);
    expect([huntAssaySeed(0, 0), huntAssaySeed(95, 3), huntAssaySeed(96, 0), huntAssaySeed(123, 3), huntAssaySeed(123, 8)]).toEqual([4_902_001, 4_902_954, 4_902_961, 4_903_234, 4_903_239]);
    for (const bad of [() => huntG1Seed("nat", 2), () => huntG2Seed(12, 0), () => huntG2Seed(0, 4), () => huntD3Seed("nat", 4, 0), () => huntD3WorldSeed("nat", 4), () => huntH("nat-a", 24), () => huntAssaySeed(124, 0), () => huntAssaySeed(0, 10), () => huntAncestorSeed(4)]) expect(bad).toThrow();
  });

  it("keeps every seed range inside the block and disjoint from every other", () => {
    const ranges: [string, number, number][] = [
      ["g1", 4_900_001, 4_900_012],
      ["g1 fallback", 4_900_101, 4_900_112],
      ["g2", 4_900_201, 4_900_314],
      ["d3 worlds", 4_900_401, 4_900_414],
      ["d3 assays", 4_900_501, 4_900_574],
      ["histories", 4_901_001, 4_901_324],
      ["ancestor worlds", 4_901_401, 4_901_404],
      ["own scaffold", 4_901_501, 4_901_523],
      ["stage 1 assays", 4_902_001, 4_903_239],
      ["device", 4_905_001, 4_905_001],
      ["reproducibility", 4_905_101, 4_905_101],
    ];
    for (const [, lo, hi] of ranges) {
      expect(lo).toBeGreaterThanOrEqual(4_900_001);
      expect(hi).toBeLessThanOrEqual(4_949_999);
    }
    for (const [i, a] of ranges.entries()) for (const b of ranges.slice(i + 1)) expect(a[2] < b[1] || b[2] < a[1], `${a[0]} overlaps ${b[0]}`).toBe(true);
    const seeds = new Set<number>();
    for (const s of huntExpectedSets("g2").concat(huntExpectedSets("d3"), huntExpectedSets("s1"))) {
      for (const sd of s.seeds) {
        const ok = ranges.some(([, lo, hi]) => sd.physics >= lo && sd.physics <= hi);
        expect(ok, `${s.id} ${sd.physics}`).toBe(true);
        expect(sd.fragment).toBe(sd.physics);
        seeds.add(sd.physics);
      }
    }
    // The permutation stream σ(h, 8) is inside the assay range and never one of a replicate's seeds.
    for (const h of [0, 48, 123]) expect(seeds.has(huntAssaySeed(h, 8))).toBe(false);
  });

  it("lists the sets of each stage with their σ formulas: 18 for G2, 8 for D3, 269 for Stage 1", () => {
    const g2 = huntExpectedSets("g2");
    const d3 = huntExpectedSets("d3");
    const s1 = huntExpectedSets("s1");
    expect([g2.length, d3.length, s1.length]).toEqual([18, 8, 269]);
    const count = (stage: readonly { kind: string }[], kind: string) => stage.filter((s) => s.kind === kind).length;
    expect([count(g2, "w"), count(g2, "quench")]).toEqual([12, 6]);
    expect([count(s1, "w"), count(s1, "quench"), count(s1, "genome"), count(s1, "genome-control")]).toEqual([96 + 4 + 24, 48, 96, 1]);
    expect(new Set([...g2, ...d3, ...s1].map((s) => s.id)).size).toBe(18 + 8 + 269);
    const seeds = (id: string) => huntExpectedSet(id)!.seeds.map((s) => s.physics);
    expect(seeds("g2-scaf-i0")).toEqual([4_900_201, 4_900_202, 4_900_203, 4_900_204]);
    expect(seeds("g2-rand-i5")).toEqual([4_900_311, 4_900_312, 4_900_313, 4_900_314]);
    expect(seeds("g2-scaf-i3-quench")).toEqual([4_900_231]);
    expect(seeds("d3-shuf-j3")).toEqual([4_900_571, 4_900_572, 4_900_573, 4_900_574]);
    expect(seeds("s1-nat-a-i00")).toEqual([4_902_001, 4_902_002, 4_902_003, 4_902_004]);
    expect(seeds("s1-shuf-s-i23")).toEqual([4_902_951, 4_902_952, 4_902_953, 4_902_954]);
    // Quench uses the source's σ(h, 0); the genome-only sets and their control use ancestor world 0's σ(96, s).
    expect(seeds("s1-nat-s-i05-quench")).toEqual([huntAssaySeed(53, 0)]);
    expect(seeds("s1-shuf-a-i07-genome")).toEqual(range(4).map((s) => huntAssaySeed(96, s)));
    expect(seeds("s1-genome-control")).toEqual(range(4).map((s) => huntAssaySeed(96, s)));
    expect(seeds("s1-anc-j3")).toEqual(range(4).map((s) => huntAssaySeed(99, s)));
    expect(seeds("s1-src-i23")).toEqual(range(4).map((s) => huntAssaySeed(123, s)));
    // Only a nat history has a quenched control.
    expect(huntExpectedSet("s1-shuf-a-i00-quench")).toBeUndefined();
    expect(huntExpectedSet("s1-nat-s-i00-quench")).toBeDefined();
    expect(huntExpectedSet("g2-rand-i0-quench")).toBeUndefined();
  });

  it("names each bundle by its seed: the hunt's roles, and why anything else is none", () => {
    const role = (seed: number, steps?: number) => huntRoleOf({ spec: { seed, steps } });
    expect(role(4_900_001)).toEqual({ role: { kind: "g1", id: "g1-nat-s0", seed: 4_900_001, arm: "nat", index: 0 } });
    expect(role(4_900_112)).toEqual({ role: { kind: "g1f", id: "g1f-shuf-s1", seed: 4_900_112, arm: "shuf", index: 1 } });
    expect(role(4_900_414)).toEqual({ role: { kind: "d3", id: "d3-shuf-j3", seed: 4_900_414, arm: "shuf", index: 3 } });
    expect(role(4_901_001)).toEqual({ role: { kind: "history", id: "nat-a-i00", seed: 4_901_001, arm: "nat", histArm: "nat-a", index: 0 } });
    expect(role(4_901_324)).toEqual({ role: { kind: "history", id: "shuf-s-i23", seed: 4_901_324, arm: "shuf", histArm: "shuf-s", index: 23 } });
    // A rerun is 340,000 steps from its start, for -a and -s alike (a -s history's steps count from its source: 10^6).
    expect(role(4_901_001, 340_000)).toMatchObject({ role: { kind: "repro", id: "nat-a-i00" } });
    expect(role(4_901_201, 340_000)).toMatchObject({ role: { kind: "repro", id: "nat-s-i00" } });
    expect(role(4_901_201, 1_000_000)).toMatchObject({ role: { kind: "history", id: "nat-s-i00" } });
    expect(role(4_901_001, 2_000_000)).toMatchObject({ role: { kind: "history", id: "nat-a-i00" } });
    expect(role(4_901_402)).toEqual({ role: { kind: "ancestor", id: "ancestor-j1", seed: 4_901_402, arm: "cont", index: 1 } });
    expect(role(4_905_001)).toEqual({ role: { kind: "device", id: "device", seed: 4_905_001, arm: "nat" } });
    expect(role(4_901_500)).toMatchObject({ why: expect.stringMatching(/not a hunt run seed/) });
    expect(role(4_850_001)).toMatchObject({ why: expect.stringMatching(/not a hunt run seed/) });
    expect(huntRoleOf({})).toEqual({ why: "manifest.json has no spec" });
    expect(huntExpectedRuns("g1").map((r) => r.seed)).toEqual([4_900_001, 4_900_002, 4_900_011, 4_900_012]);
    expect(huntExpectedRuns("g1f").map((r) => r.id)).toEqual(["g1f-nat-s0", "g1f-nat-s1", "g1f-shuf-s0", "g1f-shuf-s1"]);
    expect(huntExpectedRuns("d3")).toHaveLength(8);
    expect(huntExpectedRuns("history")).toHaveLength(96);
    expect(huntExpectedRuns("history")[24].id).toBe("shuf-a-i00");
    expect(huntExpectedRuns("ancestor").map((r) => r.seed)).toEqual([4_901_401, 4_901_402, 4_901_403, 4_901_404]);
  });
});

// =============================================================================================

describe("the exact tests and the small statistics", () => {
  /** P(sum of the first `a` values' ranks >= observed) by enumerating every split, the definition the exact Mann-Whitney p implements. */
  function bruteMannWhitney(xs: number[], ys: number[]): number {
    const all = [...xs, ...ys];
    const n = xs.length;
    const rank = midranks(all);
    const obs = xs.reduce((_, __, k) => _ + rank[k], 0);
    let ge = 0;
    let total = 0;
    const walk = (start: number, picked: number, sum: number) => {
      if (picked === n) {
        total++;
        if (sum >= obs - 1e-9) ge++;
        return;
      }
      for (let k = start; k < all.length; k++) walk(k + 1, picked + 1, sum + rank[k]);
    };
    walk(0, 0, 0);
    return ge / total;
  }

  /** P(W+ >= observed) over the 2^n sign assignments of the nonzero differences' midranks of |d|. */
  function bruteSignedRank(d: number[]): number {
    const nz = d.filter((v) => v !== 0);
    const rank = midranks(nz.map(Math.abs));
    const obs = nz.reduce((a, v, k) => a + (v > 0 ? rank[k] : 0), 0);
    let ge = 0;
    for (let mask = 0; mask < 1 << nz.length; mask++) {
      let w = 0;
      for (let k = 0; k < nz.length; k++) if (mask & (1 << k)) w += rank[k];
      if (w >= obs - 1e-9) ge++;
    }
    return nz.length ? ge / (1 << nz.length) : 1;
  }

  it("takes the exact one-sided Mann-Whitney p, checked by enumerating every split of small samples", () => {
    const cases: [number[], number[]][] = [
      [[5, 6, 7], [1, 2, 3]],
      [[1, 2, 3], [5, 6, 7]],
      [[3, 5, 8, 9], [2, 4, 6, 7, 10]],
      [[1, 1, 2, 5], [1, 2, 2, 3]],
      [[0, 0, 0], [0, 0, 0, 0]],
      [[2, 9], [1, 3, 4, 8, 9]],
    ];
    for (const [x, y] of cases) {
      const r = huntMannWhitney(x, y);
      expect(r.p).toBeCloseTo(bruteMannWhitney(x, y), 12);
      expect(r.p).toBe(mannWhitney(x, y, "exact").pGreater);
    }
    // Complete separation of 24 against 24: 1 / C(48, 24).
    expect(huntMannWhitney(range(24).map((i) => 100 + i), range(24)).p).toBeCloseTo(1 / 32_247_603_683_100, 22);
    expect(huntMannWhitney([5, 6, 7], [1, 2, 3]).effect).toBe(1);
  });

  it("takes the exact one-sided signed-rank p, checked by enumerating the sign assignments, and drops the zero differences", () => {
    const cases = [[1, 2, 3, 4], [-1, 2, 3, -4, 5], [1, -1, 2, -2, 3], [0, 3, -1, 4], [0.5, 0.5, -0.5, 2]];
    for (const d of cases) {
      const r = huntSignedRank(d);
      expect(r.p).toBeCloseTo(bruteSignedRank(d), 12);
      expect(r.p).toBe(wilcoxonSignedRank(d, "exact").pGreater);
    }
    const withZeros = [0, 0, 5, 0, -2, 7];
    const r = huntSignedRank(withZeros);
    expect([r.n, r.zeros, r.positive, r.negative]).toEqual([3, 3, 2, 1]);
    expect(r.p).toBe(huntSignedRank([5, -2, 7]).p);
    // Every difference zero: nothing to rank, p = 1.
    expect(huntSignedRank([0, 0, 0])).toMatchObject({ p: 1, n: 0, zeros: 3 });
    // 24 positive differences: 2^-24.
    expect(huntSignedRank(range(24).map((i) => 1 + i)).p).toBeCloseTo(2 ** -24, 15);
  });

  it("checks every input value for finiteness before a test", () => {
    expect(() => huntMannWhitney([1, 2, NaN], [1, 2, 3])).toThrow(/not finite/);
    expect(() => huntMannWhitney([1, 2, 3], [Infinity, 2, 3])).toThrow(/not finite/);
    expect(() => huntSignedRank([1, -Infinity])).toThrow(/not finite/);
  });

  it("applies Holm over the two contrasts and over the seven secondary tests", () => {
    // Over 2: the smaller p is doubled, the larger kept (and raised to the smaller adjusted).
    expect(holm([0.03, 0.04])).toEqual([0.06, 0.06]);
    expect(holm([0.04, 0.01])).toEqual([0.04, 0.02]);
    expect(holm([1, 0.0001])).toEqual([1, 0.0002]);
    // Over 7: p(k) x (7 - k), then the running maximum.
    const ps = [0.5, 0.001, 0.2, 0.03, 0.01, 0.04, 0.02];
    const adjusted = holm(ps);
    expect(adjusted[1]).toBeCloseTo(0.007, 12);
    expect(adjusted[4]).toBeCloseTo(0.06, 12);
    expect(adjusted[6]).toBeCloseTo(0.1, 12);
    expect(adjusted[3]).toBeCloseTo(0.12, 12);
    expect(adjusted[5]).toBeCloseTo(0.12, 12);
    expect(adjusted[2]).toBeCloseTo(0.4, 12);
    expect(adjusted[0]).toBeCloseTo(0.5, 12);
  });

  it("takes midranks, Spearman, the population CV and the effective number of donors on crafted values", () => {
    expect(midranks([10, 20, 20, 40])).toEqual([1, 2.5, 2.5, 4]);
    expect(midranks([3, 3, 3])).toEqual([2, 2, 2]);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 12);
    // Ties get midranks: ranks (1, 2, 3, 4) against (1, 2.5, 2.5, 4): 4.5 / sqrt(5 x 4.5).
    expect(spearman([1, 2, 3, 4], [1, 2, 2, 4])).toBeCloseTo(4.5 / Math.sqrt(22.5), 12);
    // Undefined: fewer than two pairs, or either side constant.
    expect(spearman([1], [2])).toBeNull();
    expect(spearman([], [])).toBeNull();
    expect(spearman([1, 2, 3], [5, 5, 5])).toBeNull();
    expect(spearman([7, 7, 7], [1, 2, 3])).toBeNull();
    expect(() => spearman([1, 2], [1])).toThrow();
    // Population CV: [10, 20, 30] has sd sqrt(200 / 3) over mean 20.
    expect(populationCv([10, 20, 30])).toBeCloseTo(Math.sqrt(200 / 3) / 20, 12);
    expect(effectiveDonors([1, 1, 1, 1])).toBeCloseTo(4, 12);
    expect(effectiveDonors([3, 1])).toBeCloseTo(1.6, 12);
    expect(effectiveDonors([0, 5, 0])).toBeCloseTo(1, 12);
    expect(effectiveDonors([0, 0, 0])).toBeNull();
  });

  it("takes v1's success rule exactly at its thresholds", () => {
    // trait >= 25,764.5 (4 trait >= 103,058) and >= 4 x the retained landed B+P.
    expect(huntRecoloniserSucceeds(25_765, 100)).toBe(true);
    expect(huntRecoloniserSucceeds(25_764, 100)).toBe(false);
    expect(huntRecoloniserSucceeds(28_000, 7_000)).toBe(true);
    expect(huntRecoloniserSucceeds(27_999, 7_000)).toBe(false);
    expect(huntRecoloniserSucceeds(0, 0)).toBe(false);
  });
});

// =============================================================================================

describe("ponds.tsv of a nat or shuf run", () => {
  /** Boundary 1: ponds 0-3 export X = 100..400 and survive; ponds 4-63 are unoccupied and die, taking donors 3 (30), 2 (16), 1 (8), 0 (6 times). */
  const crafted = (b: number): Pond[] => {
    const exporters: Pond[] = [100, 200, 300, 400].map((x) => ({ trait: 1_000, x, died: 0, donor: -2, lineages: 3 }));
    const donorOf = (p: number) => (p < 34 ? 3 : p < 50 ? 2 : p < 58 ? 1 : 0);
    if (b === 1) {
      const rest: Pond[] = range(60).map((k) => ({ trait: 0, x: 0, died: 1, donor: donorOf(k + 4), ret: k + 4 < 14 ? 100 : k + 4 < 24 ? 100 : k + 4 < 34 ? 7_000 : 100, trunc: k < 3 ? 1 : 0 }));
      rest.forEach((q, k) => { if (k + 4 >= 24 && k + 4 < 34) q.ret = 7_000; });
      return [...exporters, ...rest];
    }
    // Boundary 2: ponds 4-33 are occupied survivors with the traits that decide boundary 1's recolonisation; 34-63 unoccupied die.
    const trait = (p: number) => (p < 9 ? 25_765 : p < 14 ? 30_000 : p < 24 ? 25_764 : p < 29 ? 28_000 : 27_999);
    const rest: Pond[] = range(60).map((k) => (k + 4 < 34 ? { trait: trait(k + 4), x: 0, died: 0 as const, donor: -2 } : { trait: 0, x: 0, died: 1 as const, donor: k % 4 }));
    return [...exporters, ...rest];
  };

  it("summarises a crafted boundary: exporters, CV, effective donors, Spearman, share, lineages and recolonisation", async () => {
    const { summary, problems } = await summaryOf(pondsLines([1, 2], crafted), NAT_PONDS(1, 2));
    expect(problems).toEqual([]);
    const s = summary!;
    const b1 = s.boundaries[0];
    expect(b1).toMatchObject({ boundary: 1, occupied: 4, exporters: 4, died: 60, recipients: 60, truncated: 3, noPacket: 0, weightSum: 1_000 });
    expect(b1.cv).toBeCloseTo(populationCv([100, 200, 300, 400]), 12);
    expect(b1.cv).toBeCloseTo(Math.sqrt(12_500) / 250, 12);
    expect(b1.effectiveDonors).toBeCloseTo(1_000_000 / 300_000, 12);
    // Offspring 6, 8, 16, 30 against X 100..400: perfectly monotone.
    expect(b1.spearman).toBeCloseTo(1, 12);
    expect(b1.offspring).toEqual([0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(b1.exportShare).toBeCloseTo(0.25, 12);
    expect(b1.lineages).toBe(3);
    // Boundary 1's 60 recipients, judged on boundary 2's traits and their retained mass: 10 pass at 25,765+, 5 more at 28,000 with 4 x 7,000 retained.
    expect(b1.recolonisation).toEqual({ recipients: 60, successes: 15 });
    expect(huntRecolonisation(s, 1, 1)).toEqual({ recipients: 60, successes: 15, rate: 0.25 });
    // The last boundary's recipients have no next row: counted as failures in a pooled interval that reaches them.
    const b2 = s.boundaries[1];
    expect(b2.recolonisation).toEqual({ recipients: 30, successes: null });
    expect(huntRecolonisation(s, 1, 2)).toEqual({ recipients: 90, successes: 15, rate: 15 / 90 });
    expect(huntRecolonisation(s, 2, 2)).toEqual({ recipients: 30, successes: 0, rate: 0 });
    expect(s.endedAt).toBeNull();
    expect(s.truncation).toEqual({ recipients: 90, truncated: 3, fraction: 3 / 90, flagged: true });
    expect(s.offspring.reduce((a, n) => a + n, 0)).toBe(8);
  });

  it("reads the selection strength with fewer than two exporters counting 0, and the occupancy over a range", async () => {
    const one = scenario("nat", { x: (b, p) => (p === 3 ? 900 : 0) });
    const { summary } = await summaryOf(pondsLines([1, 2], one), NAT_PONDS(1, 2));
    expect(summary).not.toBeNull();
    // One exporter at both boundaries: the CV is not estimable there, the strength counts 0, and a single exporter's Spearman is undefined.
    expect(summary!.boundaries.map((b) => b.cv)).toEqual([null, null]);
    expect(summary!.boundaries.map((b) => b.spearman)).toEqual([null, null]);
    expect(huntSelectionStrength(summary!, 2, 2)).toBe(0);
    const { summary: two } = await summaryOf(pondsLines([1, 2], crafted), NAT_PONDS(1, 2));
    expect(huntSelectionStrength(two!, 1, 2)).toBeCloseTo((2 * Math.sqrt(12_500) / 250) / 2, 12);
    expect(huntSelectionStrength(two!, 5, 9)).toBeNull();
    expect(huntOccupancy(two!, 1, 1)).toEqual({ boundaries: 1, occupied: 4, of: 64, mean: 4 / 64 });
    expect(huntOccupancy(two!, 2, 2)).toEqual({ boundaries: 1, occupied: 34, of: 64, mean: 34 / 64 });
    expect(huntOccupancy(two!, 7, 9)).toEqual({ boundaries: 0, occupied: 0, of: 0, mean: null });
  });

  it("reports an undefined diagnostic as null, never 0 or NaN", async () => {
    // Nobody exports and nobody can donate: Σw = 0, every dying pond takes donor -1.
    const none = scenario("nat", { x: () => 0 });
    const { summary, problems } = await summaryOf(pondsLines([1, 2, 3], none), NAT_PONDS(1, 3));
    expect(problems).toEqual([]);
    for (const b of summary!.boundaries) {
      expect([b.exporters, b.weightSum, b.effectiveDonors, b.cv, b.spearman]).toEqual([0, 0, null, null, null]);
      expect(b.recipients).toBe(0);
      expect(b.noPacket).toBe(b.died);
      expect(b.recolonisation).toMatchObject({ recipients: 0 });
    }
    expect(summary!.truncation).toEqual({ recipients: 0, truncated: 0, fraction: null, flagged: false });
    expect(huntRecolonisation(summary!, 1, 2)).toEqual({ recipients: 0, successes: 0, rate: null });
    expect(hasNonFinite(summary)).toBe(false);
    // Nobody dies, so nobody has offspring: the offspring counts are constant and Spearman is undefined, though CV and effective donors are not.
    const calm = scenario("nat", { dies: () => false });
    const { summary: s2 } = await summaryOf(pondsLines([1, 2], calm), NAT_PONDS(1, 2));
    expect(s2!.boundaries[0]).toMatchObject({ recipients: 0, died: 0, spearman: null, offspring: [64] });
    expect(s2!.boundaries[0].cv).toBeGreaterThan(0);
    expect(s2!.boundaries[0].effectiveDonors).toBeGreaterThan(1);
    // No pond occupied: no export share and no lineage count.
    const empty = scenario("nat", { trait: () => 0 });
    const { summary: s3 } = await summaryOf(pondsLines([1], empty), NAT_PONDS(1, 1));
    expect([s3!.boundaries[0].exportShare, s3!.boundaries[0].lineages]).toEqual([null, null]);
  });

  it("detects an ended history: every pond died and none received a packet", async () => {
    const ending = scenario("nat", { trait: (b) => (b < 4 ? 40_000 : 0), x: (b) => (b === 3 ? 0 : 1_000), dies: (b) => b >= 3 });
    const { summary, problems } = await summaryOf(pondsLines(boundariesOf(1, 6), ending), NAT_PONDS(1, 6));
    expect(problems).toEqual([]);
    expect(summary!.endedAt).toBe(3);
    expect(summary!.boundaries[2]).toMatchObject({ occupied: 64, exporters: 0, died: 64, recipients: 0, noPacket: 64 });
    const healthy = await summaryOf(pondsLines(boundariesOf(1, 6), scenario("nat")), NAT_PONDS(1, 6));
    expect(healthy.summary!.endedAt).toBeNull();
  });

  it("accepts a shuf table whose weights are a permutation of the exporters' X, and refuses one that is not", async () => {
    const lines = pondsLines(boundariesOf(1, 3), scenario("shuf"));
    expect((await summaryOf(lines, { ...NAT_PONDS(1, 3), arm: "shuf" })).problems).toEqual([]);
    const broken = pondsLines(boundariesOf(1, 3), scenario("shuf"), { mutate: (b, p, c) => { if (b === 2 && p === 5) c.weight = 12_345; } });
    expect((await summaryOf(broken, { ...NAT_PONDS(1, 3), arm: "shuf" })).problems.join("\n")).toMatch(/boundary 2: shuf weights are not a permutation/);
    // nat weights are X exactly.
    const natBroken = pondsLines(boundariesOf(1, 3), scenario("nat"), { mutate: (b, p, c) => { if (b === 1 && p === 9) c.weight = Number(c.exportMass) + 1; } });
    expect((await summaryOf(natBroken, NAT_PONDS(1, 3))).problems.join("\n")).toMatch(/boundary 1, pond 9: nat weight/);
    // A shuf weight on a pond that does not export.
    const noX = scenario("shuf", { x: (b, p) => (p < 10 ? 800 : 0) });
    const bad = pondsLines(boundariesOf(1, 1), noX, { mutate: (b, p, c) => { if (p === 20) c.weight = 800; } });
    expect((await summaryOf(bad, { ...NAT_PONDS(1, 1), arm: "shuf" })).problems.join("\n")).toMatch(/shuf weight 800 on a pond that does not export/);
  });

  /** A table with a single violation of the sentinel rules, refused with its reason. */
  const refused = async (mutate: (b: number, p: number, c: Record<string, string | number>) => void, at = scenario("nat"), expect_ = NAT_PONDS(1, 3)) => {
    const { summary, problems } = await summaryOf(pondsLines(boundariesOf(expect_.first, expect_.last), at, { mutate }), expect_);
    expect(summary).toBeNull();
    return problems.join("\n");
  };

  it("refuses a table per died/donor sentinel violation, naming the pond", async () => {
    // In the default scenario pond p dies at boundary b when p + b is even: at boundary 1 ponds 0, 2, ... survive and 1, 3, ... die; at boundary 2 the reverse.
    const none = scenario("nat", { x: () => 0 });
    const sparse = scenario("nat", { x: (b, p) => (p === 9 ? 0 : 700) });
    const cases: [string, (b: number, p: number, c: Record<string, string | number>) => void, ReturnType<typeof scenario> | undefined, RegExp][] = [
      ["a survivor with a donor", (b, p, c) => { if (b === 1 && p === 0) c.donor = 5; }, undefined, /boundary 1, pond 0: survivor \(died 0\) with donor 5, want -2/],
      ["a dying pond with the survivors' sentinel", (b, p, c) => { if (b === 1 && p === 1) c.donor = -2; }, undefined, /boundary 1, pond 1: died with donor -2/],
      ["donor -1 though some pond has weight", (b, p, c) => { if (b === 1 && p === 1) c.donor = -1; }, undefined, /boundary 1, pond 1: donor -1, but the weights sum to/],
      ["died not 0 or 1", (b, p, c) => { if (b === 1 && p === 0) c.died = 2; }, undefined, /died 2, want 0 or 1/],
      ["a donor that is not a pond", (b, p, c) => { if (b === 1 && p === 1) c.donor = 64; }, undefined, /donor 64 is not a pond/],
      ["a donor though no pond has weight", (b, p, c) => { if (b === 2 && p === 0) c.donor = 3; }, none, /boundary 2, pond 0: donor 3, but no pond has weight/],
      ["a donor without weight", (b, p, c) => { if (b === 1 && p === 1) c.donor = 9; }, sparse, /boundary 1, pond 1: donor 9 has no weight/],
      ["a donorTrait that is not the donor's trait", (b, p, c) => { if (b === 1 && p === 1) c.donorTrait = 7; }, undefined, /boundary 1, pond 1: donorTrait 7 is not donor/],
      ["a survivor with a packet field", (b, p, c) => { if (b === 1 && p === 0) c.truncated = 1; }, undefined, /survivor with a packet field/],
      ["a no-packet row with truncation", (b, p, c) => { if (b === 2 && p === 0) c.truncated = 1; }, none, /no packet but truncated 1/],
      ["an unoccupied pond that survived", (b, p, c) => { if (b === 1 && p === 0) { c.recipientTrait = 0; c.exportMass = 0; c.weight = 0; } }, undefined, /boundary 1, pond 0: unoccupied but did not die/],
      ["X above the trait", (b, p, c) => { if (b === 1 && p === 0) c.exportMass = 40_001; }, undefined, /exportMass 40001 exceeds its trait 40000/],
      ["truncated not 0 or 1", (b, p, c) => { if (b === 1 && p === 1) c.truncated = 2; }, undefined, /truncated 2, want 0 or 1/],
    ];
    for (const [label, mutate, at, why] of cases) expect(await refused(mutate, at), label).toMatch(why);
    // The healthy scenario with none of them is accepted.
    expect((await summaryOf(pondsLines(boundariesOf(1, 3), scenario("nat")), NAT_PONDS(1, 3))).problems).toEqual([]);
  });

  it("refuses a table that is not one row per pond per boundary, ascending", async () => {
    const full = pondsLines(boundariesOf(1, 3), scenario("nat"));
    // A pond missing at boundary 2 (63 rows), a pond twice, rows out of order, a short boundary at the end.
    const missing = full.filter((_, k) => k !== 1 + 64 + 10);
    expect((await summaryOf(missing, NAT_PONDS(1, 3))).problems.join("\n")).toMatch(/boundary 2 has 63 rows, want 64 \(one per pond\)/);
    const twice = [...full.slice(0, 1 + 64 + 63), full[1 + 64 + 62], ...full.slice(1 + 64 + 64)];
    expect((await summaryOf(twice, NAT_PONDS(1, 3))).problems.join("\n")).toMatch(/boundary 2 row 63 names recipient 62, want 63/);
    const swapped = [...full];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    expect((await summaryOf(swapped, NAT_PONDS(1, 3))).problems.join("\n")).toMatch(/boundary 1 row 0 names recipient 1, want 0/);
    expect((await summaryOf(full.slice(0, 1 + 64 + 64 + 30), NAT_PONDS(1, 3))).problems.join("\n")).toMatch(/boundary 3 has 30 rows/);
    // A boundary missing, repeated, or out of order; a table that stops early, starts late or runs on.
    const skipped = [...full.slice(0, 1 + 64), ...pondsLines([3], scenario("nat")).slice(1)];
    expect((await summaryOf(skipped, NAT_PONDS(1, 3))).problems.join("\n")).toMatch(/boundary 3 where boundary 2 should come/);
    expect((await summaryOf(full, NAT_PONDS(1, 4))).problems.join("\n")).toMatch(/ends at boundary 3, want 4/);
    expect((await summaryOf(full, NAT_PONDS(2, 3))).problems.join("\n")).toMatch(/boundary 1 where boundary 2 should come/);
    expect((await summaryOf(full, NAT_PONDS(1, 2))).problems.join("\n")).toMatch(/boundary 3 where boundary 3 should come|ends at boundary 3, want 2/);
    expect((await summaryOf(full.slice(0, 1), NAT_PONDS(1, 3))).problems).toEqual(["ponds.tsv has no rows"]);
    expect((await summaryOf([], NAT_PONDS(1, 3))).problems).toEqual(["ponds.tsv has no rows"]);
    // The step must be b x period.
    expect(await refused((b, p, c) => { if (b === 2 && p === 3) c.step = 7; })).toMatch(/boundary 2, pond 3: step 7, want 20000/);
  });

  it("refuses a table with the wrong columns or a cell that is not an integer", async () => {
    const v1 = pondsLines([1], scenario("nat"), { cols: [...HUNT_POND_COLUMNS].slice(0, 22) });
    expect((await summaryOf(v1, NAT_PONDS(1, 1))).problems[0]).toMatch(/^ponds\.tsv has columns cycle,step,.*,light, want .*,died,exportMass,weight$/);
    const reordered = pondsLines([1], scenario("nat"), { cols: [...HUNT_POND_COLUMNS].reverse() });
    expect((await summaryOf(reordered, NAT_PONDS(1, 1))).summary).toBeNull();
    expect((await summaryOf(pondsLines([1], scenario("nat"), { mutate: (b, p, c) => { if (p === 2) c.died = ""; } }), NAT_PONDS(1, 1))).problems[0]).toMatch(/column "died" is not an integer >= 0/);
    expect((await summaryOf(pondsLines([1], scenario("nat"), { mutate: (b, p, c) => { if (p === 2) c.exportMass = 1.5; } }), NAT_PONDS(1, 1))).problems[0]).toMatch(/column "exportMass" is not an integer/);
    expect((await summaryOf(pondsLines([1], scenario("nat"), { mutate: (b, p, c) => { if (p === 2) c.weight = -1; } }), NAT_PONDS(1, 1))).problems[0]).toMatch(/column "weight" is not an integer >= 0/);
    // A short line (a truncated file) is a problem, not a throw.
    const cut = pondsLines([1], scenario("nat"));
    cut[5] = cut[5].split("\t").slice(0, 10).join("\t");
    expect((await summaryOf(cut, NAT_PONDS(1, 1))).problems[0]).toMatch(/fields, header has 25/);
    // At most 12 problems are listed; the rest are counted.
    const many = pondsLines([1], scenario("nat"), { mutate: (b, p, c) => { c.step = 1; } });
    const r = await summaryOf(many, NAT_PONDS(1, 1));
    expect(r.problems).toHaveLength(13);
    expect(r.problems[12]).toMatch(/^\.\.\. and \d+ more$/);
  });

  it("leaves the transform after time C (boundary 200) out of every pooled summary, and keeps its pre-cycle measurements", async () => {
    // A history's boundary 200 is the transform the runner applies after the last step: its rows are read for completeness. Here that transform kills every pond with no
    // packet (X = 0 everywhere, donor -1) and flags truncations: all of it must stay out; the traits and export masses are time C's and stay in.
    const at = (b: number) => (b < 200 ? scenario("nat")(b) : scenario("nat", { x: () => 0, dies: () => true })(b));
    const lines = pondsLines(boundariesOf(1, 200), at);
    const kept = await summaryOf(lines, { ...NAT_PONDS(1, 200), untransformed: 200, keepExporters: new Set([200]) });
    const all = await summaryOf(lines, { ...NAT_PONDS(1, 200) });
    expect(kept.problems).toEqual([]);
    expect(all.summary!.endedAt).toBe(200);
    expect(kept.summary!.endedAt).toBeNull();
    const last = kept.summary!.boundaries[199];
    expect(last).toMatchObject({ boundary: 200, transform: false, died: 0, recipients: 0, truncated: 0, noPacket: 0, weightSum: 0, effectiveDonors: null, spearman: null, offspring: [], recolonisation: { recipients: 0, successes: null } });
    // Time C's own measurements: 64 occupied ponds of trait 40,000, X = 0 at 200 (no exporter), kept as measured.
    expect(last).toMatchObject({ occupied: 64, exporters: 0, cv: null, exportShare: 0, lineages: 4, exporterPonds: [] });
    expect(all.summary!.boundaries[199]).toMatchObject({ transform: true, died: 64, noPacket: 64 });
    // Every other boundary, and the pooled truncation and offspring histogram, are those of boundaries 1-199 alone.
    expect(kept.summary!.boundaries.slice(0, 199).every((b) => b.transform)).toBe(true);
    expect(kept.summary!.truncation).toEqual({ recipients: 199 * 32, truncated: 0, fraction: 0, flagged: false });
    const upTo199 = await summaryOf(pondsLines(boundariesOf(1, 199), scenario("nat")), NAT_PONDS(1, 199));
    expect(kept.summary!.offspring).toEqual(upTo199.summary!.offspring);
    expect(kept.summary!.truncation.recipients).toBe(upTo199.summary!.truncation.recipients);
    // With donors at 200 (the ordinary transform) that are truncated: counted when the boundary is a transform of the run (G1's 30), not after time C.
    const donors = pondsLines(boundariesOf(1, 200), scenario("nat"), { mutate: (b, p, c) => { if (b === 200 && Number(c.donor) >= 0) c.truncated = 1; } });
    const g1like = await summaryOf(donors, NAT_PONDS(1, 200));
    const hist = await summaryOf(donors, { ...NAT_PONDS(1, 200), untransformed: 200 });
    expect(g1like.summary!.truncation).toMatchObject({ recipients: 200 * 32, truncated: 32, fraction: 32 / 6400 });
    expect(hist.summary!.truncation).toMatchObject({ recipients: 199 * 32, truncated: 0, fraction: 0, flagged: false });
    expect(hist.summary!.offspring.reduce((a, n) => a + n, 0)).toBe(upTo199.summary!.offspring.reduce((a, n) => a + n, 0));
    // The recolonisation of boundary 199's recipients reads boundary 200's pre-cycle trait (time C), as before; boundary 200's own recipients are never counted.
    expect(huntRecolonisation(hist.summary!, 1, 199)).toEqual(huntRecolonisation(g1like.summary!, 1, 199));
    expect(hist.summary!.boundaries[198].recolonisation).toMatchObject({ recipients: 32, successes: 32 });
    // A -s history from boundary 100: the branch's immediate transform at 100 is the first cycle under the arm and stays in; 200's still does not.
    const dash = await summaryOf(pondsLines(boundariesOf(100, 200), scenario("nat")), { ...NAT_PONDS(100, 200), untransformed: 200 });
    expect(dash.summary!.boundaries[0]).toMatchObject({ boundary: 100, transform: true, recipients: 32 });
    expect(dash.summary!.boundaries[100]).toMatchObject({ boundary: 200, transform: false, recipients: 0 });
    // The rows are still checked: a bad sentinel at boundary 200 refuses the table.
    const broken = await summaryOf(pondsLines(boundariesOf(1, 200), scenario("nat"), { mutate: (b, p, c) => { if (b === 200 && p === 0) c.died = 2; } }), { ...NAT_PONDS(1, 200), untransformed: 200 });
    expect(broken.summary).toBeNull();
    // Which roles: a history's rows, not G1's or D3's (their last boundary 30 is a transform of the run), and no one else's.
    const hunt = (kind: "history" | "g1" | "g1f" | "d3", arm: "nat" | "shuf" = "nat") => huntPondsExpectOf({ kind, id: "x", seed: 1, arm, histArm: "nat-a", index: 0 }, 32_768);
    expect(hunt("history")).toMatchObject({ first: 1, last: 200, untransformed: 200 });
    expect(hunt("g1")).toMatchObject({ first: 1, last: 30 });
    expect(hunt("g1")!.untransformed).toBeUndefined();
    expect(hunt("d3")!.untransformed).toBeUndefined();
    expect(huntPondsExpectOf({ kind: "history", id: "x", seed: 1, arm: "shuf", histArm: "shuf-s", index: 0 }, 32_768)).toMatchObject({ first: 100, last: 200, untransformed: 200 });
  });

  it("streams a -s history's boundaries 100..200 and keeps the exporting ponds at the assay boundary only", async () => {
    const lines = pondsLines(boundariesOf(100, 103), scenario("nat", { x: (b, p) => (p % 8 === 0 ? 900 : 0) }));
    const { summary, problems } = await summaryOf(lines, { ...NAT_PONDS(100, 103), keepExporters: new Set([102]) });
    expect(problems).toEqual([]);
    expect(summary!.boundaries.map((b) => b.boundary)).toEqual([100, 101, 102, 103]);
    expect(summary!.boundaries.map((b) => b.exporterPonds)).toEqual([undefined, undefined, range(8).map((k) => 8 * k), undefined]);
    expect(await summaryOf(lines, NAT_PONDS(1, 4)).then((r) => r.problems.join("\n"))).toMatch(/boundary 100 where boundary 1 should come/);
  });

  it("refuses at the row level what the boundary rules name, boundary by boundary", () => {
    const row = { cycle: 1, step: 10_000, recipient: 0, donor: -2, truncated: 0, retMass: 0, recipientTrait: 10, donorTrait: 0, recipientLineages: 1, died: 0, exportMass: 0, weight: 0 };
    const rows = range(64).map((p) => ({ ...row, recipient: p }));
    expect(huntBoundaryProblems(1, rows, { ponds: 64, period: 10_000, arm: "nat" })).toEqual([]);
    expect(huntBoundaryProblems(1, rows.slice(1), { ponds: 64, period: 10_000, arm: "nat" })).toEqual(["boundary 1 has 63 rows, want 64 (one per pond)"]);
  });
});

describe("ponds.tsv as the real transform writes it", () => {
  /** A 2 x 2 world with mutation off whose ponds hold B in and out of the export zone (0 and 1 export, 2 does not, 3 is empty); `seed` varies the boundary's keys. */
  function world(seed: number, step: number): WorldState {
    const cfg = defaultConfig({ tileW: 64, tileH: 64, tilesX: 2, tilesY: 2, seed, mutRate: 0 });
    const s = buildWorld(cfg, { nutrient: 32, founders: [] });
    const n = cellCount(cfg);
    const put = (pond: number, x: number, y: number, B: number) => {
      const tx = pond % 2;
      const ty = Math.floor(pond / 2);
      s.cells[CH.B * n + (ty * 64 + y) * worldW(cfg) + tx * 64 + x] = B;
    };
    put(0, 2, 10, 60 + (seed % 7));
    put(0, 62, 40, 100);
    put(0, 30, 30, 500);
    put(1, 0, 0, 48 + (seed % 5));
    put(1, 20, 20, 300);
    put(2, 32, 32, 200);
    return { ...s, step };
  }

  /** Boundaries 1..`last` of the transform on crafted worlds, as a ponds.tsv (HUNT_POND_COLUMNS), with the rows. */
  function table(arm: "nat" | "shuf", death: number, last: number, empty = false) {
    const lines = [HUNT_POND_COLUMNS.join("\t")];
    const rows: Record<string, any>[] = [];
    for (let b = 1; b <= last; b++) {
      const pre = empty ? { ...world(b, b * 1_000), cells: world(b, 0).cells.map(() => 0) } : world(1_000 + 7 * b, b * 1_000);
      const res = applyCurrentCycle(pre, b, arm, 8, death, 28, pondMatter(pre));
      for (const r of res.rows) {
        rows.push(r);
        lines.push(HUNT_POND_COLUMNS.map((c) => String((r as unknown as Record<string, unknown>)[c])).join("\t"));
      }
    }
    return { lines, rows };
  }
  const expect4 = (arm: "nat" | "shuf", last: number): HuntPondsExpect => ({ ponds: 4, first: 1, last, period: 1_000, arm });

  it("accepts every row the transform writes for nat and shuf, at e = 1/2 and e = 1, and reads its columns", async () => {
    for (const arm of ["nat", "shuf"] as const) {
      for (const death of [32_768, 65_536, 20_000]) {
        const { lines, rows } = table(arm, death, 12);
        const { summary, problems } = await summaryOf(lines, expect4(arm, 12));
        expect(problems, `${arm} ${death}`).toEqual([]);
        expect(summary!.boundaries).toHaveLength(12);
        // The reader's counts are the rows' own.
        const b3 = summary!.boundaries[2];
        const at = rows.filter((r) => r.cycle === 3);
        expect(b3.exporters).toBe(at.filter((r) => r.exportMass > 0).length);
        expect(b3.recipients).toBe(at.filter((r) => r.died === 1 && r.donor >= 0).length);
        expect(b3.weightSum).toBe(at.reduce((a, r) => a + r.weight, 0));
      }
    }
  });

  it("takes the donor -1 path when nothing exports: every row dying with no packet, the history ended", async () => {
    for (const arm of ["nat", "shuf"] as const) {
      const { lines, rows } = table(arm, 32_768, 3, true);
      expect(rows.every((r) => r.donor === -1 && r.died === 1 && r.exportMass === 0 && r.weight === 0)).toBe(true);
      const { summary, problems } = await summaryOf(lines, expect4(arm, 3));
      expect(problems).toEqual([]);
      expect(summary!.endedAt).toBe(1);
      expect(summary!.boundaries[0]).toMatchObject({ exporters: 0, recipients: 0, noPacket: 4, effectiveDonors: null, cv: null, spearman: null });
    }
  });

  it("agrees that death = 65,536 kills every pond, each taking a donor among the exporters", async () => {
    const { lines } = table("nat", 65_536, 6);
    const { summary } = await summaryOf(lines, expect4("nat", 6));
    expect(summary!.boundaries.every((b) => b.died === 4 && b.recipients === 4)).toBe(true);
    expect(summary!.boundaries.every((b) => b.exporters === 2)).toBe(true);
    expect(summary!.offspring.reduce((a, n, k) => a + n * k, 0)).toBe(4 * 6);
  });

  it("refuses the transform's rows once one cell is changed against the sentinel rules", async () => {
    const { lines } = table("nat", 20_000, 6);
    const cols = [...HUNT_POND_COLUMNS];
    const edit = (row: number, col: string, value: string) => lines.map((l, k) => (k === row ? l.split("\t").map((c, i) => (cols[i] === col ? value : c)).join("\t") : l));
    // Row 1 is boundary 1, pond 0. Changing its died flag or donor breaks the rules the real rows keep.
    const flip = lines[1].split("\t")[cols.indexOf("died")] === "1" ? "0" : "1";
    expect((await summaryOf(edit(1, "died", flip), expect4("nat", 6))).summary).toBeNull();
    expect((await summaryOf(edit(1, "weight", "999999"), expect4("nat", 6))).summary).toBeNull();
    expect((await summaryOf(edit(1, "exportMass", "999999"), expect4("nat", 6))).summary).toBeNull();
  });
});

// =============================================================================================

describe("G1: viability and selection strength", () => {
  const seedsOf = (fallback: boolean) => ({ "nat-0": huntG1Seed("nat", 0, fallback), "nat-1": huntG1Seed("nat", 1, fallback), "shuf-0": huntG1Seed("shuf", 0, fallback), "shuf-1": huntG1Seed("shuf", 1, fallback) });

  /** Four runs (nat s0, s1, shuf s0, s1) of scripted worlds. */
  async function runs(o: { nat0?: Parameters<typeof scenario>[1]; nat1?: Parameters<typeof scenario>[1]; shuf?: Parameters<typeof scenario>[1]; fallback?: boolean; conservation?: Partial<Record<"nat-0" | "nat-1" | "shuf-0" | "shuf-1", boolean | null>>; resolved?: Partial<Record<"nat-0" | "nat-1" | "shuf-0" | "shuf-1", boolean>> } = {}): Promise<HuntRun[]> {
    const k = o.fallback ? "g1f" : "g1";
    const seeds = seedsOf(!!o.fallback);
    const one = async (key: keyof typeof seeds, arm: "nat" | "shuf", s: number, sc: Parameters<typeof scenario>[1]) =>
      g1RunOf(`${k}-${arm}-s${s}`, arm, seeds[key], scenario(arm, sc), { kind: k, index: s, conservationOk: o.conservation?.[key] === undefined ? true : o.conservation[key]!, ...(o.resolved?.[key] === false ? { resolved: false, why: ["no run bundle"], ponds: null } : {}) });
    return [await one("nat-0", "nat", 0, o.nat0 ?? {}), await one("nat-1", "nat", 1, o.nat1 ?? {}), await one("shuf-0", "shuf", 0, o.shuf ?? {}), await one("shuf-1", "shuf", 1, o.shuf ?? {})];
  }
  const decideOf = async (base: Parameters<typeof runs>[0], fallback?: Parameters<typeof runs>[0]) => huntG1Of(await runs(base), fallback === undefined ? null : await runs({ ...fallback, fallback: true }));

  it("reads a healthy nat run as viable with selection strength, and a healthy shuf run as exact", async () => {
    const [nat, , shuf] = (await runs()).map(huntG1Run);
    expect(nat).toMatchObject({ arm: "nat", resolved: true, ended: false, endedAt: null, viable: true, strength: true, reasons: [] });
    expect(nat.occupancy).toEqual({ boundaries: 29, occupied: 29 * 64, of: 29 * 64, mean: 1 });
    expect(nat.recolonisation).toEqual({ recipients: 29 * 32, successes: 29 * 32, rate: 1 });
    expect(nat.selectionStrength).toBeCloseTo(populationCv(range(64).map((p) => 500 + 25 * p)), 12);
    expect(nat.boundaries).toHaveLength(30);
    expect(nat.boundaries[0]).toMatchObject({ boundary: 1, exporters: 64, recipients: 32 });
    expect(shuf).toMatchObject({ arm: "shuf", viable: null, conservationOk: true });
    expect(hasNonFinite(nat)).toBe(false);
  });

  it("makes a nat run not viable on each criterion alone: ended, occupancy, recolonisation, estimability and exactness", async () => {
    const check = async (sc: Parameters<typeof scenario>[1], reason: RegExp, conservation: boolean | null = true) => {
      const [nat] = (await runs({ nat0: sc, conservation: { "nat-0": conservation } })).map(huntG1Run);
      expect(nat.viable).toBe(false);
      expect(nat.reasons.join("\n")).toMatch(reason);
      return nat;
    };
    // Ended at boundary 10: every pond cleared, no packet, then nothing occupied.
    const ended = await check({ trait: (b) => (b < 11 ? 40_000 : 0), x: (b) => (b === 10 ? 0 : 1_000), dies: (b) => b >= 10 }, /it ended at boundary 10/);
    expect(ended).toMatchObject({ ended: true, endedAt: 10 });
    // Occupancy 24/64 = 0.375 < 0.5, with every occupied pond dying (so 24 of 64 recipients recolonise, 0.375 >= 0.3).
    const low = await check({ trait: (b, p) => (p < 24 ? 40_000 : 0), dies: (b, p) => p < 24 }, /mean occupancy over boundaries 2-30 is 0\.375, below 0\.5/);
    expect(low.recolonisation!.rate).toBeCloseTo(0.375, 12);
    expect(low.reasons).toHaveLength(1);
    // Recolonisation alone: full occupancy, but traits of 20,000 never reach 25,764.5.
    const slow = await check({ trait: () => 20_000 }, /pooled recolonisation success 0\/\d+ is below 0\.3/);
    expect(slow.occupancy!.mean).toBe(1);
    // No recipient in 1-29: not estimable, not viable.
    const calm = await check({ dies: () => false }, /not estimable, and the run is not viable/);
    expect(calm.recolonisation).toEqual({ recipients: 0, successes: 0, rate: null });
    // Exact conservation is part of viability (a manifest that says it was not exact, or says nothing).
    await check({}, /was not exact \(summary\.conservationOk false\)/, false);
    await check({}, /was not exact \(summary\.conservationOk null\)/, null);
  });

  it("compares occupancy and recolonisation to their thresholds exactly", async () => {
    // Exactly half occupied: 32 of 64 at every boundary, each occupied pond dying so that recolonisation is 0.5.
    const half = (await runs({ nat0: { trait: (b, p) => (p % 2 === 0 ? 40_000 : 0), dies: (b, p) => p % 2 === 0 } })).map(huntG1Run)[0];
    expect(half.occupancy!.mean).toBe(0.5);
    expect(half.viable).toBe(true);
    // 3 of 10 recolonise: 19 of 64 recipients succeed out of 64? Use 20 / 64 = 0.3125 and 19 / 64 = 0.297: the threshold is 3/10.
    const edge = async (k: number) => (await runs({ nat0: { trait: (b, p) => (p < k ? 40_000 : 1_000), x: (b, p, trait) => Math.min(500 + 25 * p, trait), dies: () => true } })).map(huntG1Run)[0];
    expect((await edge(20)).recolonisation).toMatchObject({ successes: 29 * 20, recipients: 29 * 64 });
    expect((await edge(20)).viable).toBe(true);
    expect((await edge(19)).viable).toBe(false);
  });

  it("gives a nat run selection strength at a mean CV of 0.1 or more, over boundaries 2-30", async () => {
    const flat = (await runs({ nat0: { x: () => 1_000 } })).map(huntG1Run)[0];
    expect(flat).toMatchObject({ viable: true, strength: false, selectionStrength: 0 });
    // X = 1,000 (1 + c (p - 31.5) / 63): the CV is c times a constant; pick c to land just either side of 0.1.
    const cv = (c: number) => populationCv(range(64).map((p) => 1_000 * (1 + (c * (p - 31.5)) / 63)));
    const c1 = 0.1 / cv(1);
    const x = (c: number) => (b: number, p: number) => Math.round(1_000 * (1 + (c * (p - 31.5)) / 63));
    const hi = (await runs({ nat0: { x: x(c1 * 1.02) } })).map(huntG1Run)[0];
    const lo = (await runs({ nat0: { x: x(c1 * 0.98) } })).map(huntG1Run)[0];
    expect(hi.selectionStrength!).toBeGreaterThan(0.1);
    expect(hi.strength).toBe(true);
    expect(lo.selectionStrength!).toBeLessThan(0.1);
    expect(lo.strength).toBe(false);
    // A boundary with fewer than two exporters counts 0: one exporter at every boundary, so the mean CV is 0.
    const one = (await runs({ nat0: { x: (b, p) => (p === 3 ? 900 : 0) } })).map(huntG1Run)[0];
    expect(one.selectionStrength).toBe(0);
    expect(one.boundaries.every((b) => b.cv === null)).toBe(true);
  });

  it("G1 passes when both nat runs are viable with selection strength and the shuf runs are exact", async () => {
    const g = await decideOf({});
    expect(g.decision).toMatchObject({ decision: "pass", pondDeath: 32_768, fallbackUsed: false });
    expect(g.base).toMatchObject({ resolved: true, natViable: true, strength: true, shufExact: true, passes: true });
    // A collapsed shuf run is a biological outcome: it needs only exact conservation.
    const collapsed = await decideOf({ shuf: { trait: (b) => (b < 4 ? 40_000 : 0), x: (b) => (b === 3 ? 0 : 1_000), dies: (b) => b >= 3 } });
    expect(collapsed.decision.decision).toBe("pass");
    expect(huntG1Run((await runs({ shuf: { trait: (b) => (b < 4 ? 40_000 : 0), x: (b) => (b === 3 ? 0 : 1_000), dies: (b) => b >= 3 } }))[2]).ended).toBe(true);
  });

  it("G1 reruns once at e = 1 when a nat run is not viable, and passes at the fallback", async () => {
    const g = await decideOf({ nat1: { trait: () => 20_000 } }, {});
    expect(g.decision).toMatchObject({ decision: "pass-fallback", pondDeath: 65_536, fallbackUsed: true });
    expect(g.decision.reasons.join("\n")).toMatch(/base g1-nat-s1 is not viable: pooled recolonisation/);
    expect(g.fallback).toMatchObject({ passes: true });
    // Until the fallback is given, the decision waits.
    const waiting = await decideOf({ nat1: { trait: () => 20_000 } });
    expect(waiting.decision).toMatchObject({ decision: "pending", pondDeath: null });
    expect(waiting.decision.reasons.join("\n")).toMatch(/G1 reruns once with e = 1 \(--g1-fallback\), which is not given/);
  });

  it("G1 stops when the fallback fails too", async () => {
    const g = await decideOf({ nat0: { trait: () => 20_000 } }, { nat1: { dies: () => false } });
    expect(g.decision).toMatchObject({ decision: "stop", pondDeath: null, fallbackUsed: true });
    expect(g.decision.reasons.join("\n")).toMatch(/fallback g1f-nat-s1 is not viable: .*not estimable/);
  });

  it("G1 stops when a viable nat run lacks selection strength, without a rerun", async () => {
    const g = await decideOf({ nat1: { x: () => 1_000 } }, {});
    expect(g.decision).toMatchObject({ decision: "stop", pondDeath: null, fallbackUsed: false });
    expect(g.decision.reasons).toHaveLength(1);
    expect(g.decision.reasons[0]).toMatch(/^base g1-nat-s1 lacks selection strength \(mean CV 0, below 0\.1\)$/);
    // The same at the fallback.
    const f = await decideOf({ nat0: { trait: () => 20_000 } }, { nat0: { x: () => 1_000 } });
    expect(f.decision).toMatchObject({ decision: "stop", fallbackUsed: true });
    expect(f.decision.reasons.join("\n")).toMatch(/fallback g1f-nat-s0 lacks selection strength/);
  });

  it("G1 stops at once when one viable nat run lacks selection strength and the other is not viable: no fallback is consulted", async () => {
    // nat s0 is viable with a flat X (CV 0); nat s1 never recolonises (traits of 20,000). A fallback that would pass is given, and not read.
    const mixed = { nat0: { x: () => 1_000 }, nat1: { trait: () => 20_000 } };
    const g = await decideOf(mixed, {});
    expect(g.decision).toMatchObject({ decision: "stop", pondDeath: null, fallbackUsed: false });
    expect(g.base).toMatchObject({ resolved: true, natViable: false, strength: false, weak: ["g1-nat-s0"] });
    expect(g.fallback).toMatchObject({ passes: true });
    expect(g.decision.reasons[0]).toBe("base g1-nat-s0 lacks selection strength (mean CV 0, below 0.1)");
    expect(g.decision.reasons.join("\n")).toMatch(/base g1-nat-s1 is not viable: pooled recolonisation success 0\/\d+ is below 0\.3/);
    // Without a fallback it is a stop, not a wait: the rerun would not change it.
    expect((await decideOf(mixed)).decision).toMatchObject({ decision: "stop", fallbackUsed: false });
    // The weak run is the other one: the same.
    const swapped = await decideOf({ nat0: { trait: () => 20_000 }, nat1: { x: () => 1_000 } }, {});
    expect(swapped.decision).toMatchObject({ decision: "stop", fallbackUsed: false });
    expect(swapped.base!.weak).toEqual(["g1-nat-s1"]);
    // A run that is neither viable nor strong is just not viable: the fallback decides.
    const both = await decideOf({ nat0: { trait: () => 20_000, x: () => 1_000 }, nat1: { trait: () => 20_000 } }, {});
    expect(both.base!.weak).toEqual([]);
    expect(both.decision).toMatchObject({ decision: "pass-fallback", fallbackUsed: true });
  });

  it("G1 decides every branch of the literal rule: base pair first, then the fallback pair, whose shuf runs must conserve exactly", async () => {
    type Opts = Parameters<typeof runs>[0];
    const notViable = { trait: () => 20_000 };
    const weak = { x: () => 1_000 };
    const table: { name: string; base: Opts; fallback?: Opts; want: string; used: boolean }[] = [
      { name: "both viable and strong, shuf exact", base: {}, want: "pass", used: false },
      { name: "both viable and strong, a shuf run inexact", base: { conservation: { "shuf-0": false } }, want: "stop", used: false },
      { name: "both viable, one weak", base: { nat0: weak }, want: "stop", used: false },
      { name: "both viable, both weak", base: { nat0: weak, nat1: weak }, want: "stop", used: false },
      { name: "one viable and weak, one not viable", base: { nat0: weak, nat1: notViable }, fallback: {}, want: "stop", used: false },
      { name: "one viable and strong, one not viable: the fallback passes", base: { nat1: notViable }, fallback: {}, want: "pass-fallback", used: true },
      { name: "both not viable: the fallback passes", base: { nat0: notViable, nat1: notViable }, fallback: {}, want: "pass-fallback", used: true },
      { name: "one not viable; the base shuf runs are not read when the fallback decides", base: { nat1: notViable, conservation: { "shuf-0": false, "shuf-1": false } }, fallback: {}, want: "pass-fallback", used: true },
      { name: "one not viable; a fallback nat run not viable", base: { nat1: notViable }, fallback: { nat0: notViable }, want: "stop", used: true },
      { name: "one not viable; a fallback nat run viable and weak", base: { nat1: notViable }, fallback: { nat1: weak }, want: "stop", used: true },
      { name: "one not viable; a fallback nat run weak and the other not viable", base: { nat1: notViable }, fallback: { nat0: weak, nat1: notViable }, want: "stop", used: true },
      { name: "one not viable; a fallback shuf run inexact", base: { nat1: notViable }, fallback: { conservation: { "shuf-1": false } }, want: "stop", used: true },
      { name: "a nat run not exact is not viable: the fallback decides", base: { conservation: { "nat-0": false } }, fallback: {}, want: "pass-fallback", used: true },
    ];
    for (const row of table) {
      const g = await decideOf(row.base, row.fallback);
      expect(g.decision.decision, row.name).toBe(row.want);
      expect(g.decision.fallbackUsed, row.name).toBe(row.used);
      expect(g.decision.pondDeath, row.name).toBe(row.want === "pass" ? 32_768 : row.want === "pass-fallback" ? 65_536 : null);
      if (row.want === "stop") expect(g.decision.reasons.length, row.name).toBeGreaterThan(0);
    }
    // The fallback is only read when the base pair sends it there: not given, the decision waits only then.
    expect((await decideOf({ nat1: notViable })).decision.decision).toBe("pending");
    expect((await decideOf({ nat0: weak, nat1: notViable })).decision.decision).toBe("stop");
    expect((await decideOf({})).decision.decision).toBe("pass");
    // The stopping reasons name the runs and the criterion.
    const fb = await decideOf({ nat1: notViable }, { conservation: { "shuf-1": false } });
    expect(fb.decision.reasons).toEqual([expect.stringMatching(/^base g1-nat-s1 is not viable: /), "fallback g1f-shuf-s1 did not conserve matter and the ledger exactly"]);
  });

  it("G1 stops when a shuf run did not conserve exactly, whatever the nat runs did", async () => {
    const g = await decideOf({ conservation: { "shuf-1": false } });
    expect(g.decision).toMatchObject({ decision: "stop" });
    expect(g.decision.reasons).toEqual(["base g1-shuf-s1 did not conserve matter and the ledger exactly"]);
    // A nat run that is not exact is not viable, so G1 reruns instead.
    const n = await decideOf({ conservation: { "nat-0": false } });
    expect(n.decision.decision).toBe("pending");
    expect(n.base!.natViable).toBe(false);
  });

  it("leaves G1 pending while a run is unresolved, and never decides on four runs that are not there", async () => {
    const missing = await decideOf({ resolved: { "shuf-1": false } });
    expect(missing.decision.decision).toBe("pending");
    expect(missing.decision.reasons[0]).toMatch(/^the base G1 runs are not all resolved: g1-shuf-s1 \(no run bundle\)$/);
    const unresolvedFallback = await decideOf({ nat0: { trait: () => 20_000 } }, { resolved: { "nat-0": false } });
    expect(unresolvedFallback.decision).toMatchObject({ decision: "pending", fallbackUsed: true });
    expect(huntG1Decide(null, null)).toMatchObject({ decision: "pending", reasons: ["the base G1 runs (--g1) are not given"] });
    expect(huntG1Set([]).resolved).toBe(false);
  });

  it("builds the Stage 0 readout: pass, stopped (G1 or G2) or pending, with D3 never deciding", async () => {
    const good = await runs();
    const g2ok = { sets: [] as HuntSet[], rejected: [] };
    // G2 not given: pending, though G1 passed.
    const r0 = huntStage0Readout({ g1: { base: good, fallback: null }, g2: null, d3: null, d3PondDeath: 32_768 });
    expect(r0).toMatchObject({ outcome: "pending", pondDeath: 32_768, d3: { given: false }, g2: { given: false, decision: "pending" } });
    expect(r0.reasons.join("\n")).toMatch(/G2 is not given/);
    // G1 stops the hunt.
    const stop = huntStage0Readout({ g1: { base: await runs({ nat1: { x: () => 1_000 } }), fallback: null }, g2: g2ok, d3: null, d3PondDeath: 32_768 });
    expect(stop).toMatchObject({ outcome: "Stopped at Stage 0", row: { outcome: "Stopped at Stage 0" } });
    expect(stop.reasons[0]).toMatch(/^G1 stops the hunt: base g1-nat-s1 lacks selection strength/);
    expect(hasNonFinite(r0)).toBe(false);
  });
});

// =============================================================================================

describe("export sets: W, screening and the Stage 0 decisions", () => {
  it("takes W as the mean over families of each family's mean X_f, with equal weight per family, and the edge share over all fragments", () => {
    // Three families (ponds 5, 20, 41) over 256 fragments g mod 3: sizes 86, 85, 85, with X 3,000, 6,000 and 9,000 each.
    const families = [5, 20, 41];
    const d = setDir("s1-nat-a-i00", { families, x: (g, f) => ({ 5: 3_000, 20: 6_000, 41: 9_000 })[f as 5]!, trait: (g, x) => 2 * x });
    const w = huntWOf(d.rows);
    expect(w.families).toBe(3);
    expect(w.fragments).toBe(256);
    expect(w.W).toBe(6_000);
    expect(w.familyMeans).toEqual([{ family: 5, n: 86, mean: 3_000 }, { family: 20, n: 85, mean: 6_000 }, { family: 41, n: 85, mean: 9_000 }]);
    // The unweighted mean over fragments differs: that is not W.
    expect(d.rows.reduce((a, r) => a + r.exportMass, 0) / 256).toBeCloseTo((86 * 3_000 + 85 * 15_000) / 256, 9);
    expect(w.edgeShare).toBeCloseTo(0.5, 12);
    // m = 64: each pond a family with four fragments.
    const full = huntWOf(setDir("s1-nat-a-i00", { x: (g, f) => 100 + f }).rows);
    expect(full.familyMeans.every((f) => f.n === 4)).toBe(true);
    expect(full.W).toBeCloseTo(100 + 31.5, 12);
    // Edge share is 0, not NaN, when no fragment holds any trait; W is 0 with no family.
    const dead = huntWOf(setDir("s1-nat-a-i00", { x: () => 0, trait: () => 0 }).rows);
    expect([dead.W, dead.edgeShare]).toEqual([0, 0]);
    expect(huntWOf([])).toMatchObject({ W: 0, families: 0, fragments: 0, edgeShare: 0 });
  });

  it("screens a well-formed set of every kind and reads it back", () => {
    const ids = ["g2-scaf-i0", "g2-scaf-i4-quench", "g2-rand-i5", "d3-nat-j2", "d3-shuf-j3"];
    for (const id of ids) {
      const stage = id.startsWith("g2") ? "g2" : "d3";
      const { accepted, rejected } = screen([setDir(id, { x: (g, f) => 500 + f })], stage);
      expect(rejected).toEqual([]);
      expect(accepted).toHaveLength(1);
      expect(accepted[0].w.W).toBeCloseTo(531.5, 12);
    }
    const s1 = screen([setDir("s1-nat-s-i09"), setDir("s1-nat-s-i09-quench"), setDir("s1-nat-s-i09-genome", { x: () => 700 }), setDir("s1-genome-control"), setDir("s1-anc-j1"), setDir("s1-src-i09")], "s1", { bundles: s1Bundles() });
    expect(s1.rejected).toEqual([]);
    expect(s1.accepted.map((s) => s.id)).toEqual(["s1-nat-s-i09", "s1-nat-s-i09-quench", "s1-nat-s-i09-genome", "s1-genome-control", "s1-anc-j1", "s1-src-i09"]);
    expect(s1.accepted[1].rows).toHaveLength(64);
    expect(s1.accepted[0].rows).toHaveLength(256);
  });

  it("accepts a quenched set that records one replicate or four, and refuses any other", () => {
    expect(screen([setDir("g2-scaf-i1-quench", { json: { replicates: 4 } })], "g2").rejected).toEqual([]);
    expect(screen([setDir("g2-scaf-i1-quench", { json: { replicates: 2 } })], "g2").rejected[0].reasons.join("\n")).toMatch(/replicates 2, want 1 or 4/);
    expect(screen([setDir("g2-scaf-i1", { json: { replicates: 1 } })], "g2").rejected[0].reasons.join("\n")).toMatch(/replicates 1, want 4/);
  });

  it("rejects a set with each problem it can have, naming it and collecting all of them", () => {
    const why = (d: HuntSetDir, stage: "g2" | "d3" | "s1" = "g2", more = {}) => {
      const r = screen([d], stage, more);
      expect(r.accepted).toEqual([]);
      return r.rejected[0].reasons.join("\n");
    };
    expect(why(setDir("g2-scaf-i0", { json: { labels: { hunt1: true, stage: "d3", set: "g2-scaf-i0", h: 0, variant: "w" } } }))).toMatch(/labels\.stage "d3", want g2/);
    expect(why(setDir("g2-scaf-i0", { json: { labels: { hunt1: true, stage: "g2", set: "g2-scaf-i0", h: 7, variant: "w" } } }))).toMatch(/labels\.h 7, want 0/);
    expect(why(setDir("s1-nat-a-i03-genome", { json: { labels: { hunt1: true, stage: "s1", set: "s1-nat-a-i03-genome", h: 3, variant: "genome" } } }), "s1")).toMatch(/labels\.h 3, want 96/);
    expect(why(setDir("g2-scaf-i0", { json: { labels: { hunt1: true, stage: "g2", set: "g2-scaf-i0", h: 0, variant: "quench" } } }))).toMatch(/labels\.variant "quench", want w/);
    expect(why(setDir("g2-scaf-i0"), "d3")).toMatch(/is a g2 set, but this stage reads d3 sets/);
    expect(why(setDir("g2-scaf-i0", { json: { assay: "competence" } }))).toMatch(/assay "competence", want export/);
    expect(why(setDir("g2-scaf-i0", { json: { conservationOk: false } }))).toMatch(/conservationOk false/);
    expect(why(setDir("g2-scaf-i0", { rows: (r) => r.slice(1) }))).toMatch(/255 rows, want 256/);
    expect(why(setDir("g2-scaf-i0", { rows: (r) => r.map((x, k) => (k === 5 ? { ...x, replicate: 0, pond: 4 } : x)) }))).toMatch(/repeats a \(replicate, pond\) in 1 rows/);
    expect(why(setDir("g2-scaf-i0", { rows: (r) => r.map((x, k) => (k === 5 ? { ...x, pond: 64 } : x)) }))).toMatch(/1 rows outside the 4 x 64/);
    // The family of fragment g is the family at index g mod m: swapping two families' fragments breaks it, and so does a family that is not a pond.
    expect(why(setDir("g2-scaf-i0", { rows: (r) => r.map((x, k) => (k < 2 ? { ...x, family: 1 - k } : x)) }))).toMatch(/2 fragments are not from family g mod m \(g = 64 replicate \+ pond, m = 64/);
    expect(why(setDir("g2-scaf-i0", { rows: (r) => r.map((x, k) => (k === 0 ? { ...x, family: 99 } : x)) }))).toMatch(/family values outside the 64 ponds/);
    // X_f above the fragment's trait, a negative value, a success flag that v1's rule does not give.
    expect(why(setDir("g2-scaf-i0", { rows: (r) => r.map((x, k) => (k === 0 ? { ...x, exportMass: x.endTrait + 1 } : x)) }))).toMatch(/exportMass above endTrait/);
    expect(why(setDir("g2-scaf-i0", { rows: (r) => r.map((x, k) => (k === 0 ? { ...x, exportMass: -1 } : x)) }))).toMatch(/negative mass or trait/);
    expect(why(setDir("g2-scaf-i0", { rows: (r) => r.map((x, k) => (k === 0 ? { ...x, endTrait: 30_000, exportMass: 1_000, success: 0 } : x)) }))).toMatch(/1 assay\.tsv rows have a success flag that v1's rule/);
    expect(why(setDir("g2-scaf-i0", { rows: (r) => r.map((x, k) => (k === 0 ? { ...x, inoculum: "disc" } : x)) }))).toMatch(/not all "fragment" rows/);
    // The summary must be the rows': W, families, fragments and edge share.
    expect(why(setDir("g2-scaf-i0", { json: { summary: { W: 1_001, Wexport: 1_000, families: 64, fragments: 256, edgeShare: 1 / 3 } } }))).toMatch(/summary\.W 1001 is not the W its rows give \(1000\)/);
    expect(why(setDir("g2-scaf-i0", { json: { summary: { W: 1_000, families: 63, fragments: 256, edgeShare: 1 / 3 } } }))).toMatch(/summary\.families 63, its rows have 64 families/);
    expect(why(setDir("g2-scaf-i0", { json: { summary: { W: 1_000, families: 64, fragments: 255, edgeShare: 1 / 3 } } }))).toMatch(/summary\.fragments 255, its rows have 256/);
    expect(why(setDir("g2-scaf-i0", { json: { summary: { W: 1_000, families: 64, fragments: 256, edgeShare: 0.5 } } }))).toMatch(/summary\.edgeShare 0\.5 is not the share its rows give/);
    // Strict: regime, seeds, hash, provenance.
    expect(why(setDir("g2-scaf-i0", { json: { k: 5 } }))).toMatch(/k 5, want 8/);
    expect(why(setDir("g2-scaf-i0", { json: { period: 3_000, side: 4, censusEvery: 10, mutRate: 1, ref: 7 } }))).toMatch(/period 3000, want 10000[\s\S]*side 4, want 8[\s\S]*censusEvery 10, want 100[\s\S]*mutRate 1, want 0[\s\S]*ref 7, want 103058/);
    expect(why(setDir("g2-scaf-i0", { json: { seeds: huntExpectedSet("g2-scaf-i1")!.seeds } }))).toMatch(/seeds\[0\] \{"physics":4900211,"fragment":4900211\} do not match g2-scaf-i0: want \{"physics":4900201,"fragment":4900201\}/);
    expect(why(setDir("g2-scaf-i0", { json: { seeds: huntExpectedSet("g2-scaf-i0")!.seeds.slice(0, 3) } }))).toMatch(/3 seeds, want 4/);
    expect(why(setDir("g2-scaf-i0", { json: { protocolSha256Hunt1: "0".repeat(64) } }))).toMatch(/protocolSha256Hunt1 "0{64}" is not the pinned SHA-256/);
    expect(why(setDir("g2-scaf-i0", { json: { provenance: {} } }))).toMatch(/records no provenance\.stateHash/);
    expect(why(setDir("g2-scaf-i0", { json: { export: 24 } }))).toMatch(/export 24, want 28/);
    // A set that names no set of the hunt, or has no labels.hunt1.
    expect(screen([setDir("g2-scaf-i0", { json: { labels: { hunt1: true, set: "nonsense" } } })], "g2").rejected[0]).toMatchObject({ id: null });
    expect(screen([setDir("g2-scaf-i0", { json: { labels: { set: "g2-scaf-i0" } } })], "g2").rejected[0].reasons[0]).toMatch(/no labels\.hunt1/);
  });

  it("waives the regime, seeds, hash and provenance under allowAnySeed, never the rows", () => {
    const smoke = setDir("g2-scaf-i0", { json: { k: 3, seeds: [], protocolSha256Hunt1: "x", provenance: undefined, ref: 5 } });
    expect(screen([smoke], "g2").accepted).toEqual([]);
    expect(screen([smoke], "g2", { allowAnySeed: true }).accepted).toHaveLength(1);
    const short = setDir("g2-scaf-i0", { rows: (r) => r.slice(1) });
    expect(screen([short], "g2", { allowAnySeed: true }).accepted).toEqual([]);
  });

  it("rejects a smoke test's set in strict mode, in both stages, whatever else it holds", () => {
    const smoke = (id: string, over: Record<string, unknown> = {}) => setDir(id, { json: { allowAnySeed: true, ...over } });
    // Everything else about it is production-valid: the only reason is the waiver it records.
    const g2 = screen([smoke("g2-scaf-i0")], "g2");
    expect(g2.accepted).toEqual([]);
    expect(g2.rejected[0].reasons).toEqual(['assay.json records allowAnySeed true: a set made under --allow-any-seed is a smoke test\'s, never a production one']);
    const s1 = screen([smoke("s1-nat-a-i00")], "s1", { bundles: s1Bundles() });
    expect(s1.accepted).toEqual([]);
    expect(s1.rejected[0].reasons).toHaveLength(1);
    expect(s1.rejected[0].reasons[0]).toMatch(/allowAnySeed true/);
    // A set that also records no waiver is accepted, and `allowAnySeed: false` is no waiver; under the option itself (the CLI's --allow-any-seed) the smoke set is read.
    expect(screen([setDir("g2-scaf-i0", { json: { allowAnySeed: false } })], "g2").rejected).toEqual([]);
    expect(screen([smoke("g2-scaf-i0")], "g2", { allowAnySeed: true }).accepted.map((x) => x.id)).toEqual(["g2-scaf-i0"]);
    // a3's scenario: a smoke set from v1's cont i0 labelled g2-scaf-i0, four replicates, the waiver recorded: the source is wrong as well.
    const cont = smoke("g2-scaf-i0", { provenance: { source: "runs/scaffold/main/cont/i0/ckpt/b100-pre.blck.gz", stateHash: "anything", seed: 4_810_201 } });
    const r = screen([cont], "g2");
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0].reasons.join("\n")).toMatch(/allowAnySeed true[\s\S]*provenance\.source .* does not end in scaffold\/main\/scaf\/i0\/ckpt\/b100-pre\.blck\.gz[\s\S]*provenance\.seed 4810201, want 4810001[\s\S]*provenance\.step undefined, want 1000000/);
    // Quenched sets and the D3 sets are sets too.
    expect(screen([smoke("g2-scaf-i1-quench")], "g2").rejected[0].reasons[0]).toMatch(/allowAnySeed true/);
    expect(screen([smoke("d3-nat-j0")], "d3").rejected[0].reasons[0]).toMatch(/allowAnySeed true/);
  });

  it("holds a G2 set to protocol v1's main run of the history it names: path, seed and step", () => {
    const why = (id: string, over: Record<string, unknown>) => {
      const r = screen([setDir(id, { json: { provenance: { ...provenanceOf(id), ...over } } })], "g2");
      expect(r.accepted, JSON.stringify(over)).toEqual([]);
      return r.rejected[0].reasons.join("\n");
    };
    for (const arm of ["scaf", "rand"] as const) {
      for (let i = 0; i < 6; i++) {
        const id = `g2-${arm}-i${i}`;
        expect(screen([setDir(id)], "g2").rejected, id).toEqual([]);
        // the checkpoint of another boundary, another index, the other arm, the replication's tree, a bare name, the protocol's post-cycle state
        const tail = `scaffold/main/${arm}/i${i}/ckpt/b100-pre.blck.gz`;
        const other = arm === "scaf" ? "rand" : "scaf";
        for (const source of [`runs/scaffold/main/${arm}/i${i}/ckpt/b34-pre.blck.gz`, `runs/scaffold/main/${arm}/i${(i + 1) % 6}/ckpt/b100-pre.blck.gz`, `runs/scaffold/main/${other}/i${i}/ckpt/b100-pre.blck.gz`, "runs/scaffold/main/cont/i0/ckpt/b100-pre.blck.gz", `runs/scaffold/r3rep/main/${arm}/i${i}/ckpt/b100-pre.blck.gz`, "b100-pre.blck.gz", `runs/scaffold/main/${arm}/i${i}/ckpt/b100-post.blck.gz`]) {
          expect(why(id, { source }), source).toMatch(new RegExp(`provenance\\.source .* does not end in ${tail.replace(/\./g, "\\.")}`));
        }
        expect(why(id, { source: undefined })).toMatch(/provenance\.source undefined does not end in/);
        // an absolute path is the production form
        expect(screen([setDir(id, { json: { provenance: { ...provenanceOf(id), source: `/home/x/browser-life/runs/${tail}` } } })], "g2").rejected, id).toEqual([]);
      }
    }
    // The seed is v1's world seed of that history, 4,810,001 + 100 arm + i; the step 1,000,000.
    expect(why("g2-scaf-i3", { seed: 4_810_104 })).toMatch(/provenance\.seed 4810104, want 4810004 \(protocol v1's world seed of scaf i3\)/);
    expect(why("g2-rand-i3", { seed: 4_810_004 })).toMatch(/provenance\.seed 4810004, want 4810104/);
    expect(why("g2-scaf-i3", { seed: undefined })).toMatch(/provenance\.seed undefined, want 4810004/);
    expect(why("g2-scaf-i3", { step: 340_000 })).toMatch(/provenance\.step 340000, want 1000000/);
    expect(why("g2-scaf-i3", { step: undefined })).toMatch(/provenance\.step undefined, want 1000000/);
    // The quenched control reads the same source as its W set, and is held to it.
    expect(why("g2-scaf-i2-quench", { seed: 4_810_005 })).toMatch(/provenance\.seed 4810005, want 4810003/);
    expect(why("g2-scaf-i2-quench", { source: "runs/scaffold/main/rand/i2/ckpt/b100-pre.blck.gz" })).toMatch(/does not end in scaffold\/main\/scaf\/i2\/ckpt\/b100-pre\.blck\.gz/);
    // The helper the screen uses, and the seed constants it shares with the assay (hunt-assay.test.ts checks the two modules agree).
    expect(huntV1SourceProblems("scaf", 0, { source: "x/scaffold/main/scaf/i0/ckpt/b100-pre.blck.gz", seed: 4_810_001, step: 1_000_000 })).toEqual([]);
    expect(HUNT_SEEDS.v1).toBe(4_810_001);
    // The waiver skips none of it under allowAnySeed, but then nothing of the source is asked: rows only.
    expect(screen([setDir("g2-scaf-i3", { json: { provenance: { source: "elsewhere", stateHash: "H" } } })], "g2", { allowAnySeed: true }).rejected).toEqual([]);
  });

  it("holds a genome-only set and the control to ancestor world 0's b001-pre, and a genome-only set to its donor's b200-pre", () => {
    const ids = ["s1-nat-a-i03-genome", "s1-shuf-s-i20-genome", "s1-genome-control"];
    const sets = () => ids.map((id) => setDir(id, { x: () => 700 }));
    expect(screen(sets(), "s1", { bundles: s1Bundles() }).rejected).toEqual([]);
    // a3's scenario: ancestor world 0's bundle must be given and resolved, with its b001-pre hash, and the set's hash must be it.
    const anc = (b: ScreenBundle | null) => new Map([...s1Bundles()].filter(([k]) => k !== "ancestor-j0").concat(b === null ? [] : [["ancestor-j0", b]]));
    const reasons = (bundles: Map<string, ScreenBundle>) => screen(sets(), "s1", { bundles }).rejected;
    for (const [what, bundles, text] of [
      ["not given", anc(null), /but its bundle ancestor-j0 was not given: its source cannot be checked, so the set is unresolved/],
      ["unresolved", anc({ resolved: false, hashes: { 1: ANC_HASH }, branch: null, ponds: null }), /but its bundle ancestor-j0 is not resolved/],
      ["without its hash", anc({ resolved: true, hashes: {}, branch: null, ponds: null }), /ancestor-j0 lists no b001-pre hash/],
      ["another hash", anc({ resolved: true, hashes: { 1: "0000000000000000" }, branch: null, ponds: null }), new RegExp(`provenance\\.stateHash ${ANC_HASH} is not ancestor-j0's b001-pre hash 0000000000000000 in its manifest`)],
    ] as const) {
      const rejected = reasons(bundles);
      expect(rejected.map((r) => r.id), what).toEqual(ids);
      for (const r of rejected) expect(r.reasons.join("\n"), `${what}: ${r.id}`).toMatch(text);
    }
    // Strict screening without any bundle: the same.
    expect(screen(sets(), "s1").rejected.map((r) => r.id)).toEqual(ids);
    // The rejected sets are unresolved, never dropped: their W_G is not measured.
    const rejected = reasons(anc(null));
    const st = huntStatuses("s1", [], rejected, new Map());
    expect(st.find((x) => x.id === "s1-genome-control")).toMatchObject({ status: "unresolved" });
    expect(st.find((x) => x.id === "s1-genome-control")!.why).toMatch(/set rejected: .*ancestor-j0 was not given/);
    // A genome-only set records the history it took its genome from, at b200-pre, and that hash is the history's manifest's.
    const noDonor = setDir("s1-nat-a-i03-genome", { json: { provenance: { stateHash: ANC_HASH } } });
    expect(screen([noDonor], "s1", { bundles: s1Bundles() }).rejected[0].reasons.join("\n")).toMatch(/records no provenance\.donor\.stateHash of nat-a-i03's b200-pre/);
    const wrongDonor = setDir("s1-nat-a-i03-genome", { json: { provenance: { stateHash: ANC_HASH, donor: { stateHash: HASH("s1-nat-a-i04", "source"), dominant: null } } } });
    expect(screen([wrongDonor], "s1", { bundles: s1Bundles() }).rejected[0].reasons.join("\n")).toMatch(new RegExp(`provenance\\.donor\\.stateHash ${HASH("s1-nat-a-i04", "source")} is not nat-a-i03's b200-pre hash ${HASH("s1-nat-a-i03", "source")} in its manifest`));
    // The control has no donor; the ancestor world's own W set is compared with the same b001-pre hash.
    expect(screen([setDir("s1-genome-control", { json: { provenance: { stateHash: ANC_HASH, donor: { stateHash: "ignored" } } } })], "s1", { bundles: s1Bundles() }).rejected).toEqual([]);
    expect(screen([setDir("s1-anc-j0")], "s1", { bundles: s1Bundles() }).rejected).toEqual([]);
    expect(screen([setDir("s1-anc-j0", { json: { provenance: { stateHash: "OTHER" } } })], "s1", { bundles: s1Bundles() }).rejected[0].reasons.join("\n")).toMatch(/provenance\.stateHash OTHER is not ancestor-j0's b001-pre hash/);
  });

  it("believes a noGenome record only once the report reloads its history's b200-pre and sees no dominant genome", () => {
    const id = "s1-nat-a-i03-genome";
    const record = () => setDir(id, { record: "noGenome" });
    const good: HuntDonorCheck = { stateHash: HASH("s1-nat-a-i03", "source"), dominant: false };
    const why = (donors: Map<string, HuntDonorCheck> | undefined, bundles = s1Bundles(), d = record()) => {
      const r = screen([d], "s1", { bundles, ...(donors === undefined ? {} : { donors }) });
      expect(r.accepted).toEqual([]);
      return r.rejected[0].reasons.join("\n");
    };
    const ok = screen([record()], "s1", { bundles: s1Bundles(), donors: new Map([["nat-a-i03", good]]) });
    expect(ok.rejected).toEqual([]);
    expect(ok.accepted[0]).toMatchObject({ id, noGenome: true, rows: [], w: { W: 0 } });
    // As reg1 does for Ge-on-Fa: unreachable, unreadable, another state, or a dominant genome after all, each refuses it.
    expect(why(undefined)).toMatch(/needs its donor nat-a-i03's b200-pre reloaded, to see that it has no dominant genome, but the report could not reach it/);
    expect(why(new Map())).toMatch(/could not reach it/);
    expect(why(new Map([["nat-a-i03", { error: "boom" }]]))).toMatch(/donor nat-a-i03's b200-pre could not be read: boom/);
    expect(why(new Map([["nat-a-i03", { ...good, stateHash: "elsewhere" }]]))).toMatch(new RegExp(`donor nat-a-i03's b200-pre hashes to elsewhere, but its manifest records ${HASH("s1-nat-a-i03", "source")}`));
    expect(why(new Map([["nat-a-i03", { ...good, dominant: true }]]))).toMatch(/donor nat-a-i03 has a dominant genome, so its genome-only set is not a noGenome record/);
    // The record's own claims: no dominant genome recorded, and the donor hash it names is the one reloaded.
    expect(why(new Map([["nat-a-i03", good]]), s1Bundles(), setDir(id, { record: "noGenome", json: { provenance: { ...provenanceOf(id, "noGenome"), donor: { stateHash: good.stateHash, dominant: { hi: 1, lo: 2 } } } } }))).toMatch(/provenance\.donor\.dominant \{"hi":1,"lo":2\}, want null/);
    expect(why(new Map([["nat-a-i03", { ...good, stateHash: HASH("s1-nat-a-i03", "source") }]]), s1Bundles(), setDir(id, { record: "noGenome", json: { provenance: { ...provenanceOf(id, "noGenome"), donor: { stateHash: "named-by-record", dominant: null } } } }))).toMatch(/provenance\.donor\.stateHash named-by-record is not nat-a-i03's b200-pre hash[\s\S]*but the record names named-by-record/);
    // A history whose bundle is not resolved (or not given) cannot confirm the manifest's hash: refused too.
    expect(why(new Map([["nat-a-i03", good]]), s1Bundles({ bad: ["nat-a-i03"] }))).toMatch(/but its manifest records no hash \(the bundle is not resolved\)/);
    expect(why(new Map([["nat-a-i03", good]]), s1Bundles({ omit: ["nat-a-i03"] }))).toMatch(/but its manifest records no hash/);
    // Smoke runs (allowAnySeed) read the record as it stands.
    expect(screen([record()], "s1", { allowAnySeed: true }).accepted).toHaveLength(1);
  });

  it("requires every integer column of the fragments to hold an integer", () => {
    const frac = (key: keyof HuntFragment, by = 0.5) => (rows: HuntFragment[]) => rows.map((x, k) => (k === 0 ? { ...x, [key]: (x[key] as number) + by } : x));
    const why = (key: keyof HuntFragment, o: { id?: string; by?: number } = {}) => {
      const r = screen([setDir(o.id ?? "g2-scaf-i0", { rows: frac(key, o.by) })], "g2");
      expect(r.accepted, key).toEqual([]);
      return r.rejected[0].reasons.join("\n");
    };
    for (const key of ["exportMass", "endTrait", "retMass", "family", "success", "replicate", "pond"] as const) expect(why(key), key).toMatch(new RegExp(`1 assay\\.tsv rows have a non-integer ${key} \\(every mass, energy, count and flag is an integer\\)`));
    expect(why("retE")).toMatch(/1 assay\.tsv rows have a non-integer retE/);
    // The columns the report does not read (reqMass, reqE, truncated) are held to integers too, by the raw cells: the row still reads, and the set is refused.
    const cells = { assay: "export", source: "s", replicate: "1", pond: "2", family: "3", inoculum: "fragment", reqMass: "1", retMass: "5", endTrait: "9", success: "0", reqE: "1", retE: "", truncated: "0", exportMass: "4" };
    expect(huntFragmentRow(cells).fractional).toBeUndefined();
    for (const key of ["reqMass", "reqE", "truncated", "retMass", "exportMass", "replicate"]) {
      const row = huntFragmentRow({ ...cells, [key]: "1.5" });
      expect(row.fractional, key).toEqual([key]);
      const r = screen([setDir("g2-scaf-i0", { rows: (rows) => rows.map((x, k) => (k === 3 ? { ...x, fractional: row.fractional } : x)) })], "g2");
      expect(r.accepted, key).toEqual([]);
      expect(r.rejected[0].reasons.join("\n"), key).toMatch(new RegExp(`1 assay\\.tsv rows have a non-integer ${key} \\(every mass, energy, count and flag is an integer\\)`));
    }
    expect(huntFragmentRow({ ...cells, truncated: "x", reqE: "1e3" }).fractional).toEqual(["truncated"]);
    // Integers pass, 0 included; the report's own numbers (W, edge share) are floats, and only the table's columns are held to integers.
    expect(screen([setDir("g2-scaf-i0", { x: () => 0, trait: () => 100 })], "g2").rejected).toEqual([]);
    const w = screen([setDir("g2-scaf-i0", { x: (g) => 1_000 + (g % 3) })], "g2").accepted[0].w.W;
    expect(Number.isInteger(w)).toBe(false);
  });

  it("rejects both of two sets with one id", () => {
    const r = screen([setDir("g2-scaf-i0", { dir: "/a" }), setDir("g2-scaf-i0", { dir: "/b" }), setDir("g2-scaf-i1")], "g2");
    expect(r.accepted.map((s) => s.id)).toEqual(["g2-scaf-i1"]);
    expect(r.rejected.map((x) => x.dir).sort()).toEqual(["/a", "/b"]);
    expect(r.rejected[0].reasons[0]).toMatch(/the same hunt set \(g2-scaf-i0\) as /);
  });

  it("records a source with no exporting pond as a measured outcome: no rows, W = 0", () => {
    const rec = (id: string, over = {}) => setDir(id, { record: "noFamilies", ...over });
    const ok = screen([rec("g2-scaf-i0")], "g2");
    expect(ok.rejected).toEqual([]);
    expect(ok.accepted[0]).toMatchObject({ noFamilies: true, noGenome: false, rows: [], w: { W: 0, families: 0, edgeShare: 0 } });
    const why = (d: HuntSetDir) => screen([d], "g2").rejected[0].reasons.join("\n");
    expect(why(rec("g2-scaf-i0", { rows: () => setDir("g2-scaf-i0").rows.slice(0, 3) }))).toMatch(/3 rows, want 0 \(a noFamilies record has none\)/);
    expect(why(rec("g2-scaf-i0", { json: { summary: { W: 5 } } }))).toMatch(/summary\.W 5, want 0 for a noFamilies record/);
    expect(why(rec("g2-scaf-i0", { json: { summary: { W: 0, families: 3 } } }))).toMatch(/summary\.families 3, want 0/);
    expect(why(rec("g2-scaf-i0", { json: { noGenome: true } }))).toMatch(/only a genome-only set can record noGenome|both noFamilies and noGenome/);
    // A quenched set of a source with no family is a record too, with no fragment above 5% (0 of 0).
    const q = screen([rec("g2-scaf-i2-quench")], "g2");
    expect(q.rejected).toEqual([]);
  });

  it("records a genome-only set whose donor has no dominant genome: W_G = 0 by definition, once its donor is reloaded and has none", () => {
    const g = setDir("s1-nat-a-i03-genome", { record: "noGenome" });
    const donors = new Map<string, HuntDonorCheck>([["nat-a-i03", { stateHash: HASH("s1-nat-a-i03", "source"), dominant: false }]]);
    const r = screen([g], "s1", { bundles: s1Bundles(), donors });
    expect(r.rejected).toEqual([]);
    expect(r.accepted[0]).toMatchObject({ noGenome: true, rows: [], w: { W: 0 } });
    expect(screen([setDir("s1-nat-a-i03", { record: "noGenome" })], "s1", { bundles: s1Bundles(), donors }).rejected[0].reasons.join("\n")).toMatch(/only a genome-only set can record noGenome, not s1-nat-a-i03/);
  });

  it("checks a history's set against its bundle: the checkpoint hash, and the exporting ponds at its boundary", async () => {
    const lines = pondsLines(boundariesOf(1, 3), scenario("nat", { x: (b, p) => (p % 8 === 0 ? 900 : 0) }));
    const { summary } = await summaryOf(lines, { ...NAT_PONDS(1, 3), keepExporters: new Set([3]) });
    const bundle = (hash: string) => new Map([["nat-a-i00", { resolved: true, hashes: { 200: hash }, branch: null, ponds: { ...summary!, boundaries: summary!.boundaries.map((b) => ({ ...b, boundary: b.boundary === 3 ? 200 : b.boundary })) } as HuntPondsSummary }]]);
    const families = range(8).map((k) => 8 * k);
    const good = (o = {}) => setDir("s1-nat-a-i00", { families, json: { provenance: { stateHash: "H" } }, ...o });
    expect(screen([good()], "s1", { bundles: bundle("H") }).rejected).toEqual([]);
    expect(screen([good()], "s1", { bundles: bundle("OTHER") }).rejected[0].reasons.join("\n")).toMatch(/provenance\.stateHash H is not nat-a-i00's b200-pre hash OTHER in its manifest/);
    // Families that are not the bundle's exporting ponds at boundary 200.
    expect(screen([setDir("s1-nat-a-i00", { families: range(7).map((k) => 8 * k), json: { provenance: { stateHash: "H" } } })], "s1", { bundles: bundle("H") }).rejected[0].reasons.join("\n")).toMatch(/its families \(7\) are not the source's exporting ponds at its boundary \(8: 0,8,16/);
    // A source with no exporting pond must record noFamilies.
    const none = bundle("H");
    none.get("nat-a-i00")!.ponds.boundaries.forEach((b) => (b.exporterPonds = b.boundary === 200 ? [] : undefined));
    expect(screen([setDir("s1-nat-a-i00", { record: "noFamilies", json: { provenance: { stateHash: "H" } } })], "s1", { bundles: none }).rejected).toEqual([]);
    expect(screen([good()], "s1", { bundles: none }).rejected[0].reasons.join("\n")).toMatch(/its families \(8\) are not the source's exporting ponds/);
    const withExporters = bundle("H");
    expect(screen([setDir("s1-nat-a-i00", { record: "noFamilies", json: { provenance: { stateHash: "H" } } })], "s1", { bundles: withExporters }).rejected[0].reasons.join("\n")).toMatch(/noFamilies, but nat-a-i00's ponds\.tsv has 8 exporting ponds at boundary 200/);
    // An unresolved bundle is not compared against; a genome set's donor hash is.
    expect(screen([good()], "s1", { bundles: new Map([["nat-a-i00", { resolved: false, hashes: {}, branch: null, ponds: null }]]) }).rejected).toEqual([]);
    const donorBad = setDir("s1-nat-a-i00-genome", { json: { provenance: { stateHash: "anc", donor: { stateHash: "WRONG" } } } });
    expect(screen([donorBad], "s1", { bundles: bundle("H") }).rejected[0].reasons.join("\n")).toMatch(/provenance\.donor\.stateHash WRONG is not nat-a-i00's b200-pre hash H/);
  });

  it("checks a -s source's set against the source hash its -s histories branched from", () => {
    const run = (id: string, sourceHash: string | null, resolved = true) => [id, { resolved, hashes: {}, branch: sourceHash === null ? null : { sourceHash, boundary: 100 }, ponds: null }] as const;
    const src = (hash: string) => setDir("s1-src-i05", { json: { provenance: { ...provenanceOf("s1-src-i05"), stateHash: hash } } });
    const bundles = (a: string | null, b: string | null, ra = true) => new Map([run("nat-s-i05", a, ra), run("shuf-s-i05", b)]);
    expect(screen([src("SRC")], "s1", { bundles: bundles("SRC", "SRC") }).rejected).toEqual([]);
    expect(screen([src("SRC")], "s1", { bundles: bundles("OTHER", "SRC") }).rejected[0].reasons.join("\n")).toMatch(/provenance\.stateHash SRC is not the source hash OTHER that the -s histories of index 05 branched from/);
    // An unresolved bundle, or none, is not compared against.
    expect(screen([src("SRC")], "s1", { bundles: bundles("OTHER", "SRC", false) }).rejected).toEqual([]);
    expect(screen([src("SRC")], "s1", { bundles: new Map() }).rejected).toEqual([]);
  });

  it("reads fragments from raw cells, requiring exportMass", () => {
    const row = { assay: "export", source: "s", replicate: "1", pond: "2", family: "3", inoculum: "fragment", reqMass: "1", retMass: "5", endTrait: "9", success: "0", reqE: "1", retE: "", truncated: "0", exportMass: "4" };
    expect(huntFragmentRow(row)).toEqual({ assay: "export", inoculum: "fragment", replicate: 1, pond: 2, family: 3, retMass: 5, retE: null, endTrait: 9, success: 0, exportMass: 4 });
    expect(() => huntFragmentRow({ ...row, exportMass: undefined as unknown as string })).toThrow(/no column "exportMass"/);
    expect(() => huntFragmentRow({ ...row, endTrait: "x" })).toThrow(/not a number/);
  });

  // ---- G2

  /** G2's 18 sets: W(scaf i) and W(rand i) as given, the scaf quenched controls with `dead` fragments above 0. */
  const g2Dirs = (o: { scaf: number[]; rand: number[]; dead?: number[]; omit?: string[] }) => {
    const dirs: HuntSetDir[] = [];
    for (let i = 0; i < 6; i++) {
      dirs.push(setDir(`g2-scaf-i${i}`, { x: () => o.scaf[i] }), setDir(`g2-rand-i${i}`, { x: () => o.rand[i] }));
      const dead = o.dead?.[i] ?? 0;
      dirs.push(setDir(`g2-scaf-i${i}-quench`, { x: (g) => (g < dead ? 500 : 0), trait: (g, x) => x + 100 }));
    }
    return dirs.filter((d) => !(o.omit ?? []).includes((d.json.labels as any).set));
  };
  const g2Of = (o: Parameters<typeof g2Dirs>[0]) => {
    const { accepted, rejected } = screen(g2Dirs(o), "g2");
    expect(rejected).toEqual([]);
    return huntG2Decide(accepted, huntStatuses("g2", accepted, rejected, new Map()));
  };

  it("G2 passes when W(scaf i) > W(rand i) for at least 5 of 6 and every quenched control is at most 5%", () => {
    const six = g2Of({ scaf: [900, 800, 700, 600, 500, 400], rand: [100, 100, 100, 100, 100, 100] });
    expect(six).toMatchObject({ decision: "pass", wins: 6, unresolved: [] });
    expect(six.reasons).toEqual(["W(scaf i) > W(rand i) for 6 of 6 indices; every scaf quenched control at most 5%"]);
    // 5 of 6, and a tie is not greater; exactly 3 of 64 quenched fragments (4.7%) is allowed.
    const five = g2Of({ scaf: [900, 800, 700, 600, 500, 100], rand: [100, 100, 100, 100, 100, 100], dead: [3, 0, 0, 0, 0, 3] });
    expect(five).toMatchObject({ decision: "pass", wins: 5 });
    expect(five.pairs[5]).toMatchObject({ scaf: 100, rand: 100, greater: false });
    expect(five.quenched[0]).toMatchObject({ successes: 3, n: 64, above: false });
  });

  it("G2 fails below 5 of 6, and when any scaf quenched control exceeds 5% of its fragments", () => {
    const four = g2Of({ scaf: [900, 800, 700, 600, 50, 40], rand: [100, 100, 100, 100, 100, 100] });
    expect(four).toMatchObject({ decision: "fail", wins: 4 });
    expect(four.reasons).toEqual(["W(scaf i) > W(rand i) fails for 2 of 6 indices (5 are needed)"]);
    // 4 of 64 = 6.25% > 5%: the quenched control is not dead, so G2 fails even with all six comparisons won.
    const quench = g2Of({ scaf: [900, 800, 700, 600, 500, 400], rand: [100, 100, 100, 100, 100, 100], dead: [0, 0, 0, 4, 0, 0] });
    expect(quench).toMatchObject({ decision: "fail", wins: 6 });
    expect(quench.quenched[3]).toMatchObject({ successes: 4, n: 64, fraction: 4 / 64, above: true });
    expect(quench.reasons).toEqual(["the quenched control g2-scaf-i3-quench has X_f > 0 in 4 of 64 fragments, above 5%"]);
  });

  it("G2 counts a quenched set rejected at screening whose rows could be read and whose protocol membership is established: above 5% it fails G2, never rescues it, and is listed with why", () => {
    const wins = { scaf: [900, 800, 700, 600, 500, 400], rand: [100, 100, 100, 100, 100, 100] };
    // g2-scaf-i3's quenched control, with `live` of its 64 fragments exporting, rejected for `fault` ({ rows } or { json }): by default the rows' families are wrong, the set
    // being the hunt's own in every other respect (its seeds, regime and source are its id's).
    const control = (live: number, fault: { rows?: (rows: HuntFragment[]) => HuntFragment[]; json?: Record<string, unknown> } = { rows: swapFamilies }) => setDir("g2-scaf-i3-quench", { x: (g) => (g < live ? 500 : 0), trait: (g, x) => x + 100, ...fault });
    const decide = (dirs: HuntSetDir[]) => {
      const { accepted, rejected } = screen(dirs, "g2");
      return { accepted, rejected, g2: huntG2Decide(accepted, huntStatuses("g2", accepted, rejected, new Map()), rejected) };
    };
    const withControl = (c: HuntSetDir) => decide([...g2Dirs(wins).filter((d) => (d.json.labels as any).set !== "g2-scaf-i3-quench"), c]);
    // 4 of 64 (6.25%): G2 fails, though all six comparisons are won; the rejected set is listed (with its dir and why), the screened entry for i3 stays unmeasured.
    const four = withControl(control(4));
    expect(four.rejected).toHaveLength(1);
    expect(four.rejected[0]).toMatchObject({ id: "g2-scaf-i3-quench", reasons: [SWAPPED], quench: { successes: 4, n: 64, above: true } });
    expect(four.g2).toMatchObject({ decision: "fail", wins: 6 });
    expect(four.g2.reasons).toEqual([`the quenched control g2-scaf-i3-quench has X_f > 0 in 4 of 64 fragments, above 5% (the set was rejected at screening: ${SWAPPED})`]);
    expect(four.g2.quenched).toHaveLength(7);
    expect(four.g2.quenched[3]).toMatchObject({ id: "g2-scaf-i3-quench", successes: null, above: null });
    expect(four.g2.quenched[6]).toMatchObject({ id: "g2-scaf-i3-quench", successes: 4, n: 64, fraction: 4 / 64, above: true, rejected: [SWAPPED], dir: "/sets/g2-scaf-i3-quench" });
    // Without the rejected list (counting only screened sets) the same inputs are merely pending: the stricter reading is what fails it.
    expect(huntG2Decide(four.accepted, huntStatuses("g2", four.accepted, four.rejected, new Map())).decision).toBe("pending");
    // 3 of 64 (4.7%) is not above 5%: it does not fail G2, it is listed, and being unresolved it cannot rescue it (G2 waits, never passes on it).
    const three = withControl(control(3));
    expect(three.g2).toMatchObject({ decision: "pending", wins: 6 });
    expect(three.g2.quenched[6]).toMatchObject({ successes: 3, n: 64, above: false, rejected: [SWAPPED] });
    expect(three.g2.unresolved).toEqual([`g2-scaf-i3-quench: set rejected: ${SWAPPED}`]);
    // Other faults of a hunt set count the same: a summary that is not its rows', a cell that is no integer, a negative mass, an unflagged success.
    for (const fault of [{ json: { summary: { W: 1, Wexport: 0, families: 64, fragments: 64, edgeShare: 0 } } }, { rows: (rows: HuntFragment[]) => rows.map((r, k) => (k === 7 ? { ...r, retMass: 5_000.5 } : r)) }, { json: { conservationOk: false } }]) {
      const r = withControl(control(5, fault));
      expect(r.rejected[0].quench, JSON.stringify(Object.keys(fault))).toMatchObject({ successes: 5, above: true });
      expect(r.g2.decision, JSON.stringify(Object.keys(fault))).toBe("fail");
    }
    // A control whose protocol membership is not established never touches G2, however many fragments export: a smoke test's waiver, another id's seeds, another regime,
    // a source that is not v1's main run of scaf i3, no recorded source. a smoke control with 4 of 64 does not stop G2.
    const provenance = (over: Record<string, unknown>) => ({ json: { provenance: { ...provenanceOf("g2-scaf-i3-quench"), ...over } } });
    for (const [what, fault] of [
      ["a smoke test's waiver", { json: { allowAnySeed: true } }],
      ["another set's seeds", { json: { seeds: huntExpectedSet("g2-scaf-i4-quench")!.seeds } }],
      ["a wrong seed", { json: { seeds: [{ physics: 1, fragment: 1 }] } }],
      ["another regime", { json: { k: 5 } }],
      ["another period", { json: { period: 3_000 } }],
      ["a source seed that is another history's", provenance({ seed: 4_810_005 })],
      ["a source path that is the rand run", provenance({ source: "runs/scaffold/main/rand/i3/ckpt/b100-pre.blck.gz" })],
      ["a source step that is not boundary 100", provenance({ step: 340_000 })],
      ["no recorded source hash", provenance({ stateHash: undefined })],
    ] as const) {
      const r = withControl(control(4, fault));
      expect(r.rejected, what).toHaveLength(1);
      expect(r.rejected[0].quench, what).toBeUndefined();
      expect(r.g2, what).toMatchObject({ decision: "pending", wins: 6 });
      expect(r.g2.quenched, what).toHaveLength(6);
      expect(r.g2.reasons.join("\n"), what).not.toMatch(/quenched control/);
    }
    // Both together: a foreign reason alongside a row fault is still foreign.
    expect(withControl(control(6, { json: { allowAnySeed: true }, rows: swapFamilies })).rejected[0].quench).toBeUndefined();
    // Two copies of the set (a duplicate id): both pass every check and are rejected as duplicates, both listed, and either can fail it.
    const twin = setDir("g2-scaf-i3-quench", { dir: "/sets/copy", x: (g) => (g < 5 ? 500 : 0), trait: (g, x) => x + 100 });
    const dup = decide([...g2Dirs(wins).filter((d) => (d.json.labels as any).set !== "g2-scaf-i3-quench"), setDir("g2-scaf-i3-quench", { x: () => 0, trait: () => 100 }), twin]);
    expect(dup.rejected.map((r) => r.quench?.successes)).toEqual([0, 5]);
    expect(dup.g2).toMatchObject({ decision: "fail" });
    // Another stage's quenched set (an s1 id) and a set that is no scaf control are not G2's.
    expect(huntG2Decide([], [], [{ dir: "/x", id: "s1-nat-a-i00-quench", reasons: ["r"], quench: { successes: 60, n: 64, fraction: 60 / 64, above: true } }]).quenched.filter((q) => q.rejected !== undefined)).toEqual([]);
    // It never rescues: a G2 that already fails on the comparisons still fails, with a 0-of-64 rejected control listed.
    const lost = (() => {
      const dirs = g2Dirs({ scaf: [10, 10, 700, 600, 500, 400], rand: wins.rand }).map((d) => ((d.json.labels as any).set === "g2-scaf-i3-quench" ? control(0) : d));
      return decide(dirs).g2;
    })();
    expect(lost.decision).toBe("fail");
    expect(lost.quenched[6]).toMatchObject({ successes: 0, above: false });
    // Through the Stage 0 readout: the hunt stops at G2 with the quenched control and why it was rejected in the reasons; a smoke control does not stop it.
    const out = huntStage0Readout({ g1: { base: null, fallback: null }, g2: { sets: four.accepted, rejected: four.rejected }, d3: null, d3PondDeath: 32_768 });
    expect(out).toMatchObject({ outcome: "Stopped at Stage 0", row: { outcome: "Stopped at Stage 0" }, g2: { decision: "fail" } });
    expect(out.reasons[0]).toBe(`G2 failed: the quenched control g2-scaf-i3-quench has X_f > 0 in 4 of 64 fragments, above 5% (the set was rejected at screening: ${SWAPPED})`);
    expect((out.g2 as any).quenched[6]).toMatchObject({ rejected: [SWAPPED] });
    expect(hasNonFinite(out)).toBe(false);
    const smoke = withControl(control(4, { json: { allowAnySeed: true } }));
    const okSmoke = huntStage0Readout({ g1: { base: null, fallback: null }, g2: { sets: smoke.accepted, rejected: smoke.rejected }, d3: null, d3PondDeath: 32_768 });
    expect(okSmoke.outcome).toBe("pending");
    expect(okSmoke.g2).toMatchObject({ decision: "pending" });
    expect(okSmoke.reasons.join("\n")).toMatch(/G2 pending: 1 sets are missing or rejected/);
    const ok3 = huntStage0Readout({ g1: { base: null, fallback: null }, g2: { sets: three.accepted, rejected: three.rejected }, d3: null, d3PondDeath: 32_768 });
    expect(ok3.outcome).toBe("pending");
  });

  it("G2 waits when a set is missing, unless the criteria are already failed", () => {
    const pending = g2Of({ scaf: [900, 800, 700, 600, 500, 400], rand: [100, 100, 100, 100, 100, 100], omit: ["g2-rand-i2", "g2-scaf-i4-quench"] });
    expect(pending.decision).toBe("pending");
    expect(pending.unresolved).toHaveLength(2);
    expect(pending.unresolved[0]).toBe("g2-rand-i2: no assay set");
    expect(pending.pairs[2]).toMatchObject({ scaf: null, rand: null, greater: null });
    expect(pending.quenched[4]).toMatchObject({ successes: null, above: null });
    // Two lost comparisons already fail it, whatever is missing; so does a dead-above quenched control.
    expect(g2Of({ scaf: [10, 10, 700, 600, 500, 400], rand: [100, 100, 100, 100, 100, 100], omit: ["g2-rand-i5"] }).decision).toBe("fail");
    expect(g2Of({ scaf: [900, 800, 700, 600, 500, 400], rand: [100, 100, 100, 100, 100, 100], dead: [9, 0, 0, 0, 0, 0], omit: ["g2-rand-i5"] }).decision).toBe("fail");
    // With one comparison lost and one missing, 5 are still possible: pending.
    expect(g2Of({ scaf: [10, 800, 700, 600, 500, 400], rand: [100, 100, 100, 100, 100, 100], omit: ["g2-rand-i5"] }).decision).toBe("pending");
  });

  it("describes D3: four differences in W beside the spread among the nat histories, and never decides", () => {
    const wOf: Record<string, number> = { "d3-nat-j0": 900, "d3-shuf-j0": 600, "d3-nat-j1": 500, "d3-shuf-j1": 700, "d3-nat-j2": 800, "d3-shuf-j2": 800, "d3-nat-j3": 700 };
    const dirs = Object.entries(wOf).map(([id, w]) => setDir(id, { x: () => w }));
    const { accepted, rejected } = screen(dirs, "d3");
    const runs = huntExpectedRuns("d3").map((r): HuntRun => ({ ...r, dir: `/runs/${r.id}`, resolved: true, why: [], conservationOk: true, hashes: {}, branch: null, fingerprint: null, censusEvery: 1000, host: null, ponds: null }));
    const out = huntStage0Readout({ g1: { base: null, fallback: null }, g2: null, d3: { runs, sets: accepted, rejected }, d3PondDeath: 32_768 });
    const d3 = out.d3 as any;
    expect(d3.worlds.map((w: any) => w.difference)).toEqual([300, -200, 0, null]);
    expect(d3.differences).toEqual([300, -200, 0]);
    expect(d3.positive).toBe(1);
    expect(d3.natSpread).toMatchObject({ n: 4, min: 500, max: 900, range: 400, mean: 725 });
    expect(d3.natSpread.sd).toBeCloseTo(Math.sqrt(((175) ** 2 + (225) ** 2 + (75) ** 2 + (25) ** 2) / 4), 9);
    expect(out.outcome).toBe("pending");
    expect(hasNonFinite(out)).toBe(false);
    // Nothing measured: every value null.
    const none = huntStage0Readout({ g1: { base: null, fallback: null }, g2: null, d3: { runs: null, sets: [], rejected: [] }, d3PondDeath: 32_768 }).d3 as any;
    expect(none.natSpread).toEqual({ n: 0, min: null, max: null, range: null, mean: null, sd: null });
    expect(none.worlds.every((w: any) => w.nat === null && w.difference === null)).toBe(true);
  });
});

// =============================================================================================

describe("heredity: ICC(1) of X_f by family with a Monte Carlo permutation p", () => {
  /** 256 fragments from 64 families; X_f = `x(g, family)`. */
  const fragments = (x: (g: number, f: number) => number): HuntFragment[] => setDir("s1-nat-a-i00", { x }).rows;

  it("tests a history whose families differ: ICC > 0 and p = 1 / 1001 when no permutation reaches it", () => {
    const rows = fragments((g, f) => 10_000 * f + (g % 5) * 7);
    const h = huntHeredity(rows, 0);
    expect(h).toMatchObject({ n: 256, families: 64, tested: true, why: null, demonstrated: true });
    expect(h.icc!).toBeGreaterThan(0.99);
    expect(h.p).toBe(1 / 1001);
    // The ICC is the unequal-size one-way ICC(1) of scaffold-stats, on X_f with the family labels in (replicate, pond) order.
    expect(h.icc).toBe(icc1(rows.map((r) => r.exportMass), rows.map((r) => r.family)));
  });

  it("takes p = (1 + #{permuted ICC >= observed}) / 1001 on the stream σ(h, 8), reproducibly", () => {
    // Noise with no family structure: p well above 0.05, a multiple of 1/1001.
    const noise = fragments((g) => 1_000 + ((g * 2_654_435_761) >>> 7) % 997);
    const a = huntHeredity(noise, 7);
    expect(a.tested).toBe(true);
    expect(a.p! * 1001).toBeCloseTo(Math.round(a.p! * 1001), 9);
    expect(a.demonstrated).toBe(a.icc! > 0 && a.p! < 0.05);
    expect(huntHeredity(noise, 7)).toEqual(a);
    // The same call with the stream σ(7, 8) spelled out, and a different history's stream differs only through its permutations.
    const x = noise.map((r) => r.exportMass);
    const labels = noise.map((r) => r.family);
    expect(permutationP(x, labels, huntAssaySeed(7, 8), 1000)).toEqual({ icc: a.icc, p: a.p });
    expect(huntAssaySeed(7, 8)).toBe(4_902_001 + 70 + 8);
    const other = huntHeredity(noise, 8);
    expect(other.icc).toBe(a.icc);
    // The fixed ordering of the fragments does not matter: rows shuffled give the same statistic.
    expect(huntHeredity([...noise].reverse(), 7)).toEqual(a);
    // Fewer permutations are accepted for a cheap check.
    expect(huntHeredity(noise, 7, 99).p! * 100).toBeCloseTo(Math.round(huntHeredity(noise, 7, 99).p! * 100), 9);
  });

  it("is not significant, without a test, with fewer than two families, a family of one fragment, or a constant X_f", () => {
    // Constant X_f with 64 families of four: the frozen ICC is 0 ("0 when every value is equal"), no p, no test, not significant.
    expect(huntHeredity(fragments(() => 4_000), 0)).toMatchObject({ tested: false, why: "X_f is constant across all fragments", icc: 0, p: null, demonstrated: false });
    expect(huntHeredity(fragments(() => 0), 0)).toMatchObject({ icc: 0, p: null, tested: false, demonstrated: false });
    expect(huntHeredity(setDir("s1-nat-a-i00", { families: [12], x: (g) => g }).rows, 0)).toMatchObject({ families: 1, tested: false, why: "fewer than two families", demonstrated: false, icc: null });
    // Constant data comes first: one family of 256 identical values is a constant X_f (ICC 0), not an undefined statistic; so is a constant table with a family of one fragment.
    expect(huntHeredity(setDir("s1-nat-a-i00", { families: [12], x: () => 700 }).rows, 0)).toMatchObject({ n: 256, families: 1, icc: 0, p: null, tested: false, demonstrated: false, why: "X_f is constant across all fragments" });
    expect(huntHeredity(setDir("s1-nat-a-i00", { families: [12], x: () => 0 }).rows, 0)).toMatchObject({ families: 1, icc: 0, p: null, tested: false, demonstrated: false });
    const oneEachConstant = fragments(() => 9).filter((r) => r.family !== 5 || r.replicate === 0);
    expect(huntHeredity(oneEachConstant, 0)).toMatchObject({ icc: 0, tested: false, why: "X_f is constant across all fragments" });
    expect(huntHeredity(oneEachConstant.slice(0, 1), 0)).toMatchObject({ n: 1, families: 1, icc: 0, why: "X_f is constant across all fragments" });
    // An empty table has no value to be constant: not defined.
    expect(huntHeredity([], 0)).toMatchObject({ n: 0, icc: null, why: "fewer than two families" });
    expect(huntHeredity([], 0)).toMatchObject({ n: 0, families: 0, tested: false, why: "fewer than two families" });
    const oneEach = fragments((g, f) => 100 * f + g).filter((r, k) => k < 129 || r.family === 0 || r.pond < 64 && k % 4 !== 3);
    // Keep exactly one fragment of one family: a family with a single fragment.
    const single = fragments((g, f) => 100 * f + g).filter((r) => r.family !== 5 || r.replicate === 0);
    expect(huntHeredity(single, 0)).toMatchObject({ tested: false, why: "a family has only one fragment", demonstrated: false });
    expect(oneEach.length).toBeGreaterThan(0);
  });
});

// =============================================================================================

describe("Stage 1: the contrasts, the secondary tests and the outcome", () => {
  const ARMS = [...HUNT_ARMS];
  const idx = range(24);
  const sid = (arm: HuntArm, i: number, suffix = "") => `s1-${arm}-i${String(i).padStart(2, "0")}${suffix}`;
  const ok = { device: { passed: true, reasons: [] as string[] }, reproducibility: { passed: true, reasons: [] as string[] } };

  /** What the 269 sets of Stage 1 hold: W(history), the quenched fragments above 0, the genome W, the sources' and ancestors' W, and what is missing. */
  interface Plan {
    w: (arm: HuntArm, i: number) => number;
    x?: (arm: HuntArm, i: number) => ((g: number, family: number) => number) | undefined;
    trait?: (arm: HuntArm, i: number) => ((g: number, x: number) => number) | undefined;
    dead?: (arm: HuntArm, i: number) => number;
    wg?: (arm: HuntArm, i: number) => number;
    noGenome?: (arm: HuntArm, i: number) => boolean;
    src?: (i: number) => number;
    omit?: string[];
  }
  const defaultSep = (arm: HuntArm, i: number) => ((arm === "nat-a" || arm === "nat-s" ? 1_000 : 100) + i);

  const s1Dirs = (p: Plan): HuntSetDir[] => {
    const dirs: HuntSetDir[] = [];
    for (const arm of ARMS) {
      for (const i of idx) {
        const xf = p.x?.(arm, i);
        dirs.push(setDir(sid(arm, i), { x: xf ?? (() => p.w(arm, i)), trait: p.trait?.(arm, i) }));
        if (arm.startsWith("nat")) dirs.push(setDir(sid(arm, i, "-quench"), { x: (g) => (g < (p.dead?.(arm, i) ?? 0) ? 500 : 0), trait: (g, x) => x + 100 }));
        const wg = p.wg?.(arm, i) ?? 300;
        dirs.push(p.noGenome?.(arm, i) ? setDir(sid(arm, i, "-genome"), { record: "noGenome" }) : setDir(sid(arm, i, "-genome"), { x: () => wg }));
      }
    }
    for (let j = 0; j < 4; j++) dirs.push(setDir(`s1-anc-j${j}`, { x: () => 50 + j }));
    for (const i of idx) dirs.push(setDir(`s1-src-i${String(i).padStart(2, "0")}`, { x: () => p.src?.(i) ?? 500 }));
    dirs.push(setDir("s1-genome-control", { x: () => 250 }));
    return dirs.filter((d) => !(p.omit ?? []).includes((d.json.labels as any).set));
  };

  /** The screened sets, statuses and histories of a plan, with every history bundle resolved except `badRuns`. */
  const modelFromDirs = (dirs: HuntSetDir[], badRuns: string[] = []) => {
    // Strict screening reads ancestor-j0 and every history's bundle; a history whose genome set is a noGenome record has its b200-pre reloaded without a dominant genome.
    const donors = new Map<string, HuntDonorCheck>(HUNT_ARMS.flatMap((arm) => idx.map((i) => [`${arm}-i${String(i).padStart(2, "0")}`, { stateHash: HASH(sid(arm, i), "source"), dominant: false }] as const)));
    const { accepted, rejected } = screen(dirs, "s1", { bundles: s1Bundles({ bad: badRuns }), donors });
    const runs = new Map(HUNT_ARMS.flatMap((arm) => idx.map((i) => [`${arm}-i${String(i).padStart(2, "0")}`, { resolved: !badRuns.includes(`${arm}-i${String(i).padStart(2, "0")}`) }] as const)));
    const statuses = huntStatuses("s1", accepted, rejected, runs);
    const histories = huntHistoryStatuses(statuses, runs);
    return { sets: accepted, rejected, statuses, histories };
  };
  const modelOf = (p: Plan, badRuns: string[] = []) => {
    const { rejected, ...m } = modelFromDirs(s1Dirs(p), badRuns);
    expect(rejected).toEqual([]);
    return m;
  };
  const evaluate = (p: Plan, o: { badRuns?: string[]; gates?: Parameters<typeof huntEvaluate>[3] } = {}) => {
    const m = modelOf(p, o.badRuns);
    return { ...m, ev: huntEvaluate(m.sets, m.statuses, m.histories, o.gates ?? ok) };
  };

  it("makes contrast A and S hits when nat is far above shuf in both origins, with Holm over the two", () => {
    const { ev } = evaluate({ w: defaultSep });
    expect(ev.outcome).toBe("analysed");
    expect(ev.applied).toBe(true);
    const t = ev.tests!;
    // 24 against 24, complete separation: 1 / C(48, 24); 24 positive pairs: 2^-24.
    expect(t.primary.A).toMatchObject({ test: "mann-whitney", assessed: true, status: "Hit", unresolved: [], n: { nat: 24, shuf: 24 } });
    expect(t.primary.A.p).toBeCloseTo(1 / 32_247_603_683_100, 22);
    expect(t.primary.S).toMatchObject({ test: "signed-rank", assessed: true, status: "Hit", pairs: 24, zeros: 0, positive: 24 });
    expect(t.primary.S.p).toBeCloseTo(2 ** -24, 15);
    expect([t.primary.A.holm, t.primary.S.holm]).toEqual(holm([t.primary.A.p!, t.primary.S.p!]));
    expect(t.primary.A.holm).toBeCloseTo(2 * t.primary.A.p!, 20);
    expect(t.reasons[0]).toMatch(/^contrast A \(nat-a against shuf-a\): Hit: p 3\.10e-14/);
  });

  it("reports No hit where the arms are exchangeable, and the Holm-adjusted p decides the hit", () => {
    // nat's values are shuf's values shifted by two places: ties-free, no systematic difference. S: alternating signs.
    const w = (arm: HuntArm, i: number) => (arm === "nat-a" ? 100 + ((i + 2) % 24) : arm === "nat-s" ? 100 + i + (i % 2 ? 3 : -3) : 100 + i);
    const { ev } = evaluate({ w });
    expect(ev.outcome).toBe("analysed");
    expect(ev.tests!.primary.A).toMatchObject({ status: "No hit", assessed: true });
    expect(ev.tests!.primary.S).toMatchObject({ status: "No hit", assessed: true });
    expect(ev.tests!.primary.A.p!).toBeGreaterThan(0.2);
    expect(ev.tests!.primary.S.p!).toBeGreaterThan(0.2);
  });

  it("makes a hit of a p at most 0.05 after Holm: the borderline is the adjusted p, not the raw one", () => {
    // 24 v 24 with a modest shift: raw A p between 0.025 and 0.05 is a hit only if S is much smaller... check the rule through `holm` directly.
    const rule = (pA: number, pS: number) => holm([pA, pS]).map((x) => x <= 0.05);
    expect(rule(0.03, 0.04)).toEqual([false, false]);
    expect(rule(0.024, 0.04)).toEqual([true, true]);
    expect(rule(0.04, 0.001)).toEqual([true, true]);
    expect(rule(0.06, 0.001)).toEqual([false, true]);
    expect(rule(1, 0.001)).toEqual([false, true]);
    // And the pipeline applies it: contrast A with the exact p of a one-sided shift, S with a smaller one.
    const w = (arm: HuntArm, i: number) => (arm === "nat-a" ? 100 + 2 * i + (i < 12 ? 1 : 0) : arm === "shuf-a" ? 100 + 2 * i + (i < 12 ? 0 : 1) : arm === "nat-s" ? 500 + i : 400 + i);
    const t = evaluate({ w }).ev.tests!.primary;
    expect(t.A.status).toBe(t.A.holm <= 0.05 ? "Hit" : "No hit");
    expect(t.S.status).toBe("Hit");
  });

  it("drops zero-difference pairs in contrast S, counting them, and ranks the rest", () => {
    // Pairs 0-7 have both branches at W = 0 (an extinct export): zero differences, dropped; the other 16 are all positive.
    const w = (arm: HuntArm, i: number) => (arm === "nat-s" ? (i < 8 ? 0 : 1_000 + i) : arm === "shuf-s" ? (i < 8 ? 0 : 100 + i) : defaultSep(arm, i));
    const s = evaluate({ w }).ev.tests!.primary.S;
    expect(s).toMatchObject({ assessed: true, pairs: 16, zeros: 8, positive: 16, negative: 0, status: "Hit" });
    expect(s.p).toBeCloseTo(2 ** -16, 15);
    expect(s.p).toBe(wilcoxonSignedRank(s.differences, "exact").pGreater);
    // Every pair zero: nothing to rank, p = 1, no hit (a measured outcome, not an unresolved one).
    const none = evaluate({ w: (arm, i) => (arm.endsWith("-s") ? 0 : defaultSep(arm, i)) }).ev.tests!.primary.S;
    expect(none).toMatchObject({ assessed: true, pairs: 0, zeros: 24, p: 1, status: "No hit" });
  });

  it("marks a contrast Not assessed, with Holm slot p = 1, when an unresolved value would enter it", () => {
    // A set of nat-a i03 is missing: A cannot be assessed, S is, and A's slot of 1 enters the Holm family.
    const { ev } = evaluate({ w: defaultSep, omit: [sid("nat-a", 3)] });
    const t = ev.tests!.primary;
    expect(t.A).toMatchObject({ status: "Not assessed", assessed: false, p: null, slot: 1, holm: 1 });
    expect(t.A.unresolved).toEqual(["nat-a-i03"]);
    expect(t.S).toMatchObject({ status: "Hit", assessed: true });
    expect(t.S.holm).toBeCloseTo(2 * t.S.p!, 15);
    expect(ev.tests!.reasons[0]).toMatch(/contrast A \(nat-a against shuf-a\): Not assessed \(an unresolved value enters it: nat-a-i03\): Holm slot p = 1/);
    // A bundle that is unresolved makes the value unresolved, whatever its sets say; so does a nat history's quenched control.
    const bundle = evaluate({ w: defaultSep }, { badRuns: ["shuf-s-i10"] }).ev.tests!.primary;
    expect(bundle.S).toMatchObject({ status: "Not assessed" });
    expect(bundle.S.unresolved).toEqual(["shuf-s-i10"]);
    const quench = evaluate({ w: defaultSep, omit: [sid("nat-s", 6, "-quench")] }).ev.tests!.primary;
    expect(quench.S).toMatchObject({ status: "Not assessed", unresolved: ["nat-s-i06"] });
    // Both contrasts unresolved: both slots 1.
    const both = evaluate({ w: defaultSep, omit: [sid("shuf-a", 0), sid("nat-s", 1)] }).ev.tests!.primary;
    expect([both.A.status, both.S.status, both.A.holm, both.S.holm]).toEqual(["Not assessed", "Not assessed", 1, 1]);
    // A genome set unresolved leaves W-type values alone.
    expect(evaluate({ w: defaultSep, omit: [sid("nat-a", 2, "-genome")] }).ev.tests!.primary.A.status).toBe("Hit");
  });

  it("checks the quenched gate: more than 5% of a quenched set's fragments exporting is Invalid, 3 of 64 is not", () => {
    const three = evaluate({ w: defaultSep, dead: (arm, i) => (arm === "nat-s" && i === 4 ? 3 : 0) });
    expect(three.ev.validity.quenched.failed).toBe(false);
    expect(three.ev.validity.quenched.max).toBe(3 / 64);
    expect(three.ev.outcome).toBe("analysed");
    const four = evaluate({ w: defaultSep, dead: (arm, i) => (arm === "nat-a" && i === 9 ? 4 : 0) });
    expect(four.ev.outcome).toBe("Invalid");
    expect(four.ev.validity.quenched.failed).toBe(true);
    expect(four.ev.validity.quenched.sets.filter((q) => q.above).map((q) => q.id)).toEqual(["s1-nat-a-i09-quench"]);
    expect(four.ev.reasons).toEqual([`quenched control s1-nat-a-i09-quench has X_f > 0 in 4 of 64 fragments, above 0.05`]);
    expect(four.ev.applied).toBe(false);
    expect(four.ev.tests).toBeNull();
    // Quenched sets of a source with no family (a record) have no fragment above 5%.
    expect(evaluate({ w: defaultSep }).ev.validity.quenched.max).toBe(0);
  });

  it("counts a quenched set rejected at screening, whose rows could be read and whose protocol membership is established, at the quenched gate, listed with why it was rejected", () => {
    // s1-nat-a-i09's quenched control has `n` of 64 fragments exporting but fails screening on its rows (two fragments from the wrong families): its seeds, regime and source are
    // the hunt's own, so it cannot be a measured set, yet its rows say the control is not dead.
    const qid = sid("nat-a", 9, "-quench");
    const live = (n: number, fault: { rows?: (rows: HuntFragment[]) => HuntFragment[]; json?: Record<string, unknown> } = { rows: swapFamilies }) => (d: HuntSetDir) => ((d.json.labels as any).set === qid ? setDir(qid, { x: (g) => (g < n ? 500 : 0), trait: (g, x) => x + 100, ...fault }) : d);
    const withLive = (n: number, fault?: Parameters<typeof live>[1]) => modelFromDirs(s1Dirs({ w: defaultSep }).map(live(n, fault)));
    const m = withLive(4);
    expect(m.rejected).toHaveLength(1);
    expect(m.rejected[0]).toMatchObject({ id: qid, quench: { successes: 4, n: 64, fraction: 4 / 64, above: true } });
    expect(m.rejected[0].reasons).toEqual([SWAPPED]);
    expect(m.statuses.find((x) => x.id === qid)).toMatchObject({ status: "unresolved" });
    // Counting only accepted sets would see no quenched set above 5%: the stricter reading is Invalid, and lists the set with its reasons.
    const ev = huntEvaluate(m.sets, m.statuses, m.histories, ok, m.rejected);
    expect(huntEvaluate(m.sets, m.statuses, m.histories, ok).validity.quenched.failed).toBe(false);
    expect(ev.outcome).toBe("Invalid");
    expect(ev.applied).toBe(false);
    expect(ev.validity.quenched).toMatchObject({ failed: true, max: 4 / 64 });
    const entry = ev.validity.quenched.sets.find((q) => q.above)!;
    expect(entry).toMatchObject({ id: qid, successes: 4, n: 64, rejected: [SWAPPED] });
    expect(ev.validity.quenched.sets.filter((q) => q.rejected === null)).toHaveLength(47);
    expect(ev.reasons).toEqual([`quenched control ${qid} has X_f > 0 in 4 of 64 fragments, above 0.05 (the set was rejected at screening: ${SWAPPED})`]);
    // 3 of 64 (4.7%) is not above 5%, rejected or not: the set is unresolved (its history, Uninformative only past 6), not Invalid.
    const three = withLive(3);
    const ok3 = huntEvaluate(three.sets, three.statuses, three.histories, ok, three.rejected);
    expect(ok3.outcome).toBe("analysed");
    expect(ok3.validity.quenched).toMatchObject({ failed: false, max: 3 / 64 });
    expect(ok3.tests!.primary.A.status).toBe("Not assessed");
    // Other faults of a hunt set, whatever they are: a summary that is not its rows', a cell that is no integer, a protocol pin that is not the document's, a failed conservation.
    for (const fault of [{ json: { summary: { W: 1, Wexport: 0, families: 64, fragments: 64, edgeShare: 0 } } }, { rows: (rows: HuntFragment[]) => rows.map((r, k) => (k === 3 ? { ...r, exportMass: r.exportMass + 0.5, endTrait: r.endTrait + 1 } : r)) }, { json: { protocolSha256Hunt1: "0".repeat(64) } }, { json: { conservationOk: false } }]) {
      const r = withLive(5, fault);
      expect(r.rejected).toHaveLength(1);
      expect(r.rejected[0].quench, JSON.stringify(fault).slice(0, 40)).toMatchObject({ successes: expect.any(Number), above: true });
      expect(huntEvaluate(r.sets, r.statuses, r.histories, ok, r.rejected).outcome, JSON.stringify(fault).slice(0, 40)).toBe("Invalid");
    }
    // A control that is not the hunt's own never touches the gate, with 4 of 64 or 20: a smoke test's waiver (the only fault of an otherwise valid set), another set's seeds,
    // another regime, a source that is not its history's b200-pre, no recorded source.
    for (const [what, fault] of [
      ["a smoke test's waiver", { json: { allowAnySeed: true } }],
      ["another set's seeds", { json: { seeds: huntExpectedSet(sid("nat-a", 8, "-quench"))!.seeds } }],
      ["another regime", { json: { k: 5 } }],
      ["a source hash that is not the history's b200-pre", { json: { provenance: { stateHash: "wrong" } } }],
      ["no source hash", { json: { provenance: {} } }],
    ] as const) {
      const r = withLive(4, fault);
      expect(r.rejected, what).toHaveLength(1);
      expect(r.rejected[0].quench, what).toBeUndefined();
      const e = huntEvaluate(r.sets, r.statuses, r.histories, ok, r.rejected);
      expect(e.validity.quenched.failed, what).toBe(false);
      expect(e.outcome, what).toBe("analysed");
      expect(e.validity.quenched.sets.every((q) => q.rejected === null), what).toBe(true);
    }
    // A smoke control with 4 of 64 exporting does not invalidate Stage 1: through the readout as well.
    const runs = [...HUNT_ARMS].flatMap((arm) => idx.map((i): HuntRun => ({ id: `${arm}-i${String(i).padStart(2, "0")}`, kind: "history", arm: arm.startsWith("nat") ? "nat" : "shuf", seed: huntHistorySeed(arm, i), histArm: arm, index: i, dir: `/runs/${arm}-i${i}`, resolved: true, why: [], conservationOk: true, hashes: {}, branch: arm.endsWith("-s") ? { sourceHash: srcHash(i), boundary: 100 } : null, fingerprint: null, censusEvery: 1000, host: null, ponds: null })));
    const device = { passed: true, reasons: [], finalHash: "h", mac: "/m", bundles: [], uncovered: [] };
    const repro = { passed: true, reasons: [], draws: [], histories: [], skipped: [] };
    const smoke = withLive(4, { json: { allowAnySeed: true } });
    expect(huntReadout({ sets: smoke.sets, rejected: smoke.rejected, runs, device, reproducibility: repro, pondDeath: 32_768 })).toMatchObject({ outcome: "analysed", withheld: false });
    // The same control with a row fault only: Invalid, with the quenched gate and its reasons, the tests withheld.
    const out = huntReadout({ sets: m.sets, rejected: m.rejected, runs, device, reproducibility: repro, pondDeath: 32_768 });
    expect(out).toMatchObject({ outcome: "Invalid", withheld: true, primary: null, secondary: null });
    expect((out.validity as any).quenched).toMatchObject({ failed: true });
    expect(out.reasons[0]).toBe(`quenched control ${qid} has X_f > 0 in 4 of 64 fragments, above 0.05 (the set was rejected at screening: ${SWAPPED})`);
    expect(hasNonFinite(out)).toBe(false);
    // Duplicates: both copies pass every check and are rejected as duplicates; both count, adversely.
    const dup = modelFromDirs([...s1Dirs({ w: defaultSep }), setDir(sid("nat-a", 2, "-quench"), { dir: "/other/copy", x: () => 0, trait: (g, x) => x + 100 })]);
    expect(dup.rejected.filter((r) => r.id === sid("nat-a", 2, "-quench"))).toHaveLength(2);
    expect(huntEvaluate(dup.sets, dup.statuses, dup.histories, ok, dup.rejected).outcome).toBe("analysed");
    const dup2 = modelFromDirs([...s1Dirs({ w: defaultSep, dead: (arm, i) => (arm === "nat-a" && i === 2 ? 8 : 0) }), setDir(sid("nat-a", 2, "-quench"), { dir: "/other/copy", x: (g) => (g < 8 ? 500 : 0), trait: (g, x) => x + 100 })]);
    expect(dup2.rejected.map((r) => r.quench?.successes)).toEqual([8, 8]);
    expect(huntEvaluate(dup2.sets, dup2.statuses, dup2.histories, ok, dup2.rejected).outcome).toBe("Invalid");
    // A quenched set of another stage, or one that is not strict (the CLI's --allow-any-seed), is not this gate's: no `quench` is kept for it.
    const g2q = screen([setDir("g2-scaf-i0-quench", { x: () => 500, trait: (g, x) => x + 100, rows: swapFamilies })], "s1");
    expect(g2q.rejected[0]).toMatchObject({ id: "g2-scaf-i0-quench" });
    expect(g2q.rejected[0].quench).toBeUndefined();
    expect(screen([setDir(qid, { x: () => 500, trait: (g, x) => x + 100, rows: swapFamilies })], "s1", { bundles: s1Bundles(), allowAnySeed: true }).rejected[0]?.quench).toBeUndefined();
    expect(screen([setDir("s1-nat-a-i00", { x: () => 900, json: { k: 5 } })], "s1", { bundles: s1Bundles() }).rejected[0].quench).toBeUndefined();
  });

  it("lets a quenched control touch a gate only when its source is affirmatively authenticated: a bundle that was read and is the protocol's, whose manifest hash is the set's", () => {
    const qid = sid("nat-a", 9, "-quench");
    const control = (n: number, o: { rows?: (r: HuntFragment[]) => HuntFragment[]; json?: Record<string, unknown> } = {}) => setDir(qid, { x: (g) => (g < n ? 500 : 0), trait: (g, x) => x + 100, ...o });
    const dirs = (n: number, o?: Parameters<typeof control>[1]) => s1Dirs({ w: defaultSep }).map((d) => ((d.json.labels as any).set === qid ? control(n, o) : d));
    const model = (n: number, o: Parameters<typeof control>[1], bundles: Map<string, ScreenBundle>) => {
      const { accepted, rejected } = screen(dirs(n, o), "s1", { bundles, donors: new Map(HUNT_ARMS.flatMap((arm) => idx.map((i) => [`${arm}-i${String(i).padStart(2, "0")}`, { stateHash: HASH(sid(arm, i), "source"), dominant: false }] as const))) });
      const runs = new Map([...bundles].filter(([k]) => k !== "ancestor-j0").map(([k, b]) => [k, { resolved: b.resolved }] as const));
      const statuses = huntStatuses("s1", accepted, rejected, runs);
      return { accepted, rejected, ev: huntEvaluate(accepted, statuses, huntHistoryStatuses(statuses, runs), ok, rejected) };
    };
    // Authenticated (the history's bundle resolved, its b200-pre hash the control's): an accepted control with 20 of 64 exporting, and a rejected one with 4, both Invalid.
    const good = model(20, undefined, s1Bundles());
    expect(good.accepted.find((x) => x.id === qid)).toMatchObject({ authenticated: true });
    expect(good.ev.outcome).toBe("Invalid");
    expect(model(4, { rows: swapFamilies }, s1Bundles()).ev.outcome).toBe("Invalid");
    // Not authenticated: the bundle is unresolved, not given, or lists no b200 hash. An ACCEPTED control (the screen cannot compare what is not there) with 20 of 64 exporting
    // touches nothing, and a REJECTED wrong-source-or-not control with 4 of 64 touches nothing: the history stays unresolved, the stage is analysed (the contrasts Not assessed).
    const none: [string, Map<string, ScreenBundle>][] = [
      ["an unresolved bundle", s1Bundles({ bad: ["nat-a-i09"] })],
      ["no bundle given", s1Bundles({ omit: ["nat-a-i09"] })],
      ["a bundle without a b200 hash", new Map([...s1Bundles()].map(([k, b]) => [k, k === "nat-a-i09" ? { ...b, hashes: {} } : b]))],
    ];
    for (const [what, bundles] of none) {
      const acc = model(20, undefined, bundles);
      expect(acc.rejected, what).toEqual([]);
      expect(acc.accepted.find((x) => x.id === qid), what).toMatchObject({ authenticated: false });
      expect(acc.ev.validity.quenched, what).toMatchObject({ failed: false, max: 0 });
      expect(acc.ev.validity.quenched.sets.map((q) => q.id), what).not.toContain(qid);
      expect(acc.ev.outcome, what).toBe("analysed");
      // The history is unresolved (its bundle is not), so its W is not assessed; a bundle that lists no hash is no real resolved run, only the control stays out.
      if (what !== "a bundle without a b200 hash") expect(acc.ev.tests!.primary.A.status, what).toBe("Not assessed");
      const rej = model(4, { rows: swapFamilies, json: { provenance: { stateHash: "wrong-source" } } }, bundles);
      expect(rej.rejected.find((r) => r.id === qid)!.quench, what).toBeUndefined();
      expect(rej.ev.outcome, what).toBe("analysed");
      // A rejected control that is the hunt's own in every other respect, with no bundle to authenticate it, is equally outside the gate.
      const mem = model(4, { rows: swapFamilies }, bundles);
      expect(mem.rejected.find((r) => r.id === qid)!.quench, what).toBeUndefined();
      expect(mem.ev.validity.quenched.failed, what).toBe(false);
      expect(mem.ev.outcome, what).toBe("analysed");
    }
    // A wrong source hash with the bundle resolved is a foreign control (already outside).
    expect(model(4, { rows: swapFamilies, json: { provenance: { stateHash: "wrong-source" } } }, s1Bundles()).rejected.find((r) => r.id === qid)!.quench).toBeUndefined();
    // A smoke run (the stage screened with allowAnySeed) waives authentication: its accepted controls are read as they stand (authenticated null), and count.
    const smoke = screen(dirs(20), "s1", { allowAnySeed: true });
    expect(smoke.accepted.find((x) => x.id === qid)).toMatchObject({ authenticated: null });
    expect(huntEvaluate(smoke.accepted, [], [], ok).validity.quenched).toMatchObject({ failed: true, max: 20 / 64 });
    // G2: its controls are authenticated as protocol v1's main run (path, seed, step; there is no bundle of it): an accepted one is, and one that is not never reaches the gate.
    expect(screen([setDir("g2-scaf-i1-quench", { x: () => 0, trait: () => 100 })], "g2").accepted[0]).toMatchObject({ authenticated: true });
    const unauth = { ...screen([setDir("g2-scaf-i1-quench", { x: () => 500, trait: (g: number, x: number) => x + 100 })], "g2").accepted[0], authenticated: false };
    const g2 = huntG2Decide([unauth], [{ id: unauth.id, kind: "quench", owner: null, status: "measured", why: null, dir: unauth.dir }], []);
    expect(g2.quenched[1]).toMatchObject({ id: "g2-scaf-i1-quench", successes: null, above: null });
    expect(g2.unresolved).toContain("g2-scaf-i1-quench: its source is not authenticated");
    expect(g2.decision).not.toBe("pass");
  });

  it("checks the device and reproducibility gates, Invalid whichever fails and before Uninformative", () => {
    const device = evaluate({ w: defaultSep }, { gates: { device: { passed: false, reasons: ["finalHash differs"] }, reproducibility: ok.reproducibility } }).ev;
    expect(device.outcome).toBe("Invalid");
    expect(device.reasons).toEqual(["device check failed: finalHash differs"]);
    const repro = evaluate({ w: defaultSep }, { gates: { device: ok.device, reproducibility: { passed: false, reasons: ["no rerun of shuf-a-i04"] } } }).ev;
    expect(repro.outcome).toBe("Invalid");
    expect(repro.reasons).toEqual(["reproducibility check failed: no rerun of shuf-a-i04"]);
    // The reasons come in the document's order (1 device, 4 unresolved, 5 quenched, 7 reproducibility), the outcome in the table's (Invalid first).
    const all = evaluate({ w: defaultSep, omit: idx.slice(0, 7).map((i) => sid("nat-a", i)), dead: (arm, i) => (arm === "nat-s" && i === 2 ? 5 : 0) }, { gates: { device: { passed: false, reasons: ["d"] }, reproducibility: { passed: false, reasons: ["r"] } } }).ev;
    expect(all.outcome).toBe("Invalid");
    expect(all.reasons.map((r) => r.split(" ").slice(0, 2).join(" "))).toEqual(["device check", "nat-a has", "quenched control", "reproducibility check"]);
    // Invalid precedes Uninformative: seven unresolved histories in nat-a and a failed device check.
    const omit = idx.slice(0, 7).map((i) => sid("nat-a", i));
    const both = evaluate({ w: defaultSep, omit }, { gates: { device: { passed: false, reasons: ["x"] }, reproducibility: ok.reproducibility } }).ev;
    expect(both.outcome).toBe("Invalid");
    expect(both.validity.unresolved.uninformative).toBe(true);
  });

  it("counts unresolved histories per arm: 6 is allowed, 7 is Uninformative, and the tests are withheld", () => {
    const omit = (arm: HuntArm, n: number) => idx.slice(0, n).map((i) => sid(arm, i));
    const six = evaluate({ w: defaultSep, omit: omit("shuf-s", 6) });
    expect(six.ev.outcome).toBe("analysed");
    expect(six.ev.validity.unresolved.arms["shuf-s"]).toMatchObject({ histories: 24, unresolved: 6 });
    expect(six.ev.tests!.primary.S.status).toBe("Not assessed");
    const seven = evaluate({ w: defaultSep, omit: omit("shuf-s", 7) });
    expect(seven.ev.outcome).toBe("Uninformative");
    expect(seven.ev.reasons).toEqual([`shuf-s has 7 unresolved histories, more than 6 (${idx.slice(0, 7).map((i) => `shuf-s-i0${i}`).join(", ")})`]);
    expect(seven.ev.tests).toBeNull();
    // The count is per arm: 6 in each of two arms is not uninformative; any of its sets or its bundle counts (the quenched control, the genome set, the run).
    const spread = evaluate({ w: defaultSep, omit: [...omit("nat-a", 3), ...idx.slice(3, 6).map((i) => sid("nat-a", i, "-quench")), ...omit("shuf-a", 6)] });
    expect(spread.ev.validity.unresolved.arms["nat-a"].unresolved).toBe(6);
    expect(spread.ev.outcome).toBe("analysed");
    const viaRun = evaluate({ w: defaultSep }, { badRuns: idx.slice(0, 7).map((i) => `nat-s-i0${i}`) });
    expect(viaRun.ev.outcome).toBe("Uninformative");
    const viaGenome = evaluate({ w: defaultSep, omit: idx.slice(0, 7).map((i) => sid("shuf-a", i, "-genome")) });
    expect(viaGenome.ev.validity.unresolved.arms["shuf-a"].unresolved).toBe(7);
    expect(viaGenome.ev.outcome).toBe("Uninformative");
  });

  it("reports the secondary family as seven tests with their own Holm at 0.05", () => {
    const t = evaluate({ w: defaultSep }).ev.tests!.secondary;
    expect(t.family).toBe(7);
    expect(t.tests.map((x) => x.id)).toEqual(["genome-A", "genome-S", "heredity-nat-a", "heredity-nat-s", "edge-A", "edge-S", "improvement"]);
    expect(t.tests.map((x) => x.holm)).toEqual(holm(t.tests.map((x) => x.slot)));
    for (const x of t.tests) expect(x.significant).toBe(x.assessed && x.holm <= 0.05);
    expect(t.alpha).toBe(0.05);
    expect(t.note).toMatch(/never change a hit/);
  });

  it("tests the genome composite, with availability counts per arm and the reading rule", () => {
    // W_G higher under nat in both origins; every history has a genome: read as genome performance.
    const all = evaluate({ w: defaultSep, wg: (arm, i) => (arm.startsWith("nat") ? 600 : 300) + i }).ev.tests!.secondary.genome as any;
    expect(all.availability["nat-a"]).toEqual({ histories: 24, withGenome: 24, withoutGenome: 0, unresolved: 0 });
    expect(all.A).toMatchObject({ assessed: true, reading: "genome performance" });
    expect(all.S).toMatchObject({ assessed: true, reading: "genome performance", pairs: 24 });
    expect(all.A.p).toBeLessThan(1e-9);
    // Three nat-a histories carry no dominant genome: W_G = 0 for them, the test is a composite, with counts and an untested conditional comparison.
    const some = evaluate({ w: defaultSep, wg: (arm, i) => (arm.startsWith("nat") ? 600 : 300) + i, noGenome: (arm, i) => arm === "nat-a" && i < 3 }).ev.tests!.secondary.genome as any;
    expect(some.availability["nat-a"]).toEqual({ histories: 24, withGenome: 21, withoutGenome: 3, unresolved: 0 });
    expect(some.availability["shuf-a"].withGenome).toBe(24);
    expect(some.A.reading).toBe("composite of genome availability and genome performance");
    expect(some.S.reading).toBe("genome performance");
    // The tested sample is all 24 values, the three genome-less histories at 0: its median is that of 0, 0, 0, 603, ..., 623.
    expect(some.A.medians.nat).toBe(611.5);
    expect(some.amongThoseWithAGenome["nat-a"]).toMatchObject({ n: 21, min: 603, max: 623 });
    expect(some.amongThoseWithAGenome["shuf-a"]).toMatchObject({ n: 24, min: 300, max: 323 });
    // The no-genome histories enter the test as 0 ("W_G = 0 by definition"), not as missing: the nat-a sample is 24 values.
    expect(some.A.n).toEqual({ nat: 24, shuf: 24 });
    // A genome set that is unresolved makes the genome test Not assessed, and the other tests are unaffected.
    const gone = evaluate({ w: defaultSep, omit: [sid("shuf-s", 5, "-genome")] }).ev.tests!;
    expect((gone.secondary.genome as any).S).toMatchObject({ assessed: false, p: null, unresolved: ["shuf-s-i05"] });
    expect(gone.secondary.tests[1]).toMatchObject({ id: "genome-S", assessed: false, slot: 1, significant: false });
    expect(gone.primary.S.status).toBe("Hit");
  });

  it("tests edge share as ΣX_f / Σ trait_f per history, 0 when the trait is 0, nat against shuf in both origins", () => {
    // Fragments of nat histories carry X = 600 + i of a trait of 1,000, shuf's 200 + i; nat-a i0 has no trait at all.
    const dead = (arm: HuntArm, i: number) => arm === "nat-a" && i === 0;
    const plan: Plan = { w: (arm, i) => (arm.startsWith("nat") ? 600 : 200) + i, x: (arm, i) => (dead(arm, i) ? () => 0 : undefined), trait: (arm, i) => (dead(arm, i) ? () => 0 : () => 1_000) };
    const m = evaluate(plan);
    const e = (arm: HuntArm, i: number) => m.sets.find((x) => x.id === sid(arm, i))!.w.edgeShare;
    expect([e("nat-a", 0), e("nat-a", 3), e("shuf-a", 3), e("nat-s", 23)]).toEqual([0, 0.603, 0.203, 0.623]);
    const t = m.ev.tests!.secondary.edgeShare as any;
    expect(t.zoneAreaShare).toBeCloseTo(0.2615, 4);
    expect(t.A).toMatchObject({ test: "mann-whitney", assessed: true, n: { nat: 24, shuf: 24 } });
    expect(t.A.medians.nat).toBeGreaterThan(t.A.medians.shuf);
    expect(t.A.p).toBeLessThan(1e-9);
    expect(t.S).toMatchObject({ test: "signed-rank", assessed: true, pairs: 24, positive: 24 });
    expect(t.S.p).toBeCloseTo(2 ** -24, 15);
    // The same sets give the contrast A on W too, and edge share is a separate test with its own slot.
    expect(m.ev.tests!.secondary.tests[4]).toMatchObject({ id: "edge-A", assessed: true, p: t.A.p });
    expect(m.ev.tests!.secondary.tests[5]).toMatchObject({ id: "edge-S", assessed: true, p: t.S.p });
    // A missing W set makes both edge-share tests of that arm pair Not assessed, with slot 1.
    const gone = evaluate({ ...plan, omit: [sid("nat-s", 2)] }).ev.tests!.secondary;
    expect(gone.tests[5]).toMatchObject({ id: "edge-S", assessed: false, p: null, slot: 1, significant: false });
    expect(gone.tests[4]).toMatchObject({ id: "edge-A", assessed: true });
  });

  it("counts heredity per nat arm among a fixed 24, an unresolved history as not significant, with the binomial tail at 0.05", () => {
    // nat-a histories 0-4 have strong between-family variance; nat-s histories 0-1 do too; everything else is constant.
    const structured = (arm: HuntArm, i: number) => ((arm === "nat-a" && i < 5) || (arm === "nat-s" && i < 2) ? (g: number, f: number) => 5_000 * f + (g % 3) : undefined);
    const { ev } = evaluate({ w: defaultSep, x: structured });
    const h = (ev.tests!.secondary.heredity as any).arms;
    expect(h["nat-a"]).toMatchObject({ n: 24, demonstrated: 5, p: binomialUpperTail(5, 24, 1, 20) });
    expect(h["nat-s"]).toMatchObject({ n: 24, demonstrated: 2, p: binomialUpperTail(2, 24, 1, 20) });
    expect(h["nat-a"].histories[0]).toMatchObject({ outcome: "analysed", tested: true, demonstrated: true, p: 1 / 1001 });
    expect(h["nat-a"].histories[5]).toMatchObject({ outcome: "analysed", tested: false, demonstrated: false, icc: 0, p: null });
    expect(h["nat-a"].histories[5].why).toBe("X_f is constant across all fragments");
    expect(h["nat-a"].p).toBeLessThan(0.01);
    // The shuf arms get the same statistic, descriptively.
    expect(Object.keys(h)).toEqual(["nat-a", "shuf-a", "nat-s", "shuf-s"]);
    expect(h["shuf-a"].demonstrated).toBe(0);
    // An unresolved history counts as not significant with the denominator 24: nat-a i0 lost, the other four still count out of 24.
    const lost = evaluate({ w: defaultSep, x: structured, omit: [sid("nat-a", 0)] }).ev.tests!.secondary.heredity as any;
    expect(lost.arms["nat-a"]).toMatchObject({ n: 24, demonstrated: 4, p: binomialUpperTail(4, 24, 1, 20) });
    expect(lost.arms["nat-a"].histories[0]).toMatchObject({ outcome: "unresolved", demonstrated: false });
    expect(lost.arms["nat-a"].histories[0].why).toMatch(/no assay set/);
    // The test's p is the tail, and its Holm slot is that p: heredity is never "not assessed".
    const tests = ev.tests!.secondary.tests;
    expect(tests[2]).toMatchObject({ id: "heredity-nat-a", assessed: true, p: h["nat-a"].p });
    expect(tests[3]).toMatchObject({ id: "heredity-nat-s", assessed: true, p: h["nat-s"].p });
  });

  it("tests improvement by the exact sign test on sources whose W the -s history exceeds, an unresolved one counting as not improved", () => {
    // 18 of 24 improve (strictly); source 18 ties exactly (not improved); the rest are below.
    const w = (arm: HuntArm, i: number) => (arm === "nat-s" ? (i < 18 ? 700 : i === 18 ? 500 : 400) : defaultSep(arm, i));
    const m = evaluate({ w, src: () => 500 });
    const imp = (m.ev.tests!.secondary.improvement as any)["nat-s"];
    expect(imp).toMatchObject({ improved: 18, n: 24, p: reg1ReportSignTest(18, 24) });
    expect(imp.p).toBeCloseTo(binomialUpperTail(18, 24, 1, 2), 15);
    expect(imp.terms[18]).toMatchObject({ improved: false, W: 500, source: 500 });
    expect(imp.terms[0]).toMatchObject({ improved: true, status: "measured" });
    // The same count for shuf-s is descriptive (no p).
    const sh = (m.ev.tests!.secondary.improvement as any)["shuf-s"];
    expect(sh.improved).toBe(0);
    expect(sh.p).toBeUndefined();
    // A source's set lost, a -s history's set lost: both count as not improved; the denominator stays 24.
    const lost = evaluate({ w, src: () => 500, omit: [`s1-src-i00`, sid("nat-s", 1)] }).ev.tests!.secondary.improvement as any;
    expect(lost["nat-s"]).toMatchObject({ improved: 16, n: 24, p: reg1ReportSignTest(16, 24) });
    expect(lost["nat-s"].terms[0]).toMatchObject({ status: "unresolved", improved: false });
    expect(lost["nat-s"].terms[0].why).toMatch(/s1-src-i00: no assay set/);
    expect(lost["nat-s"].terms[1].why).toMatch(/s1-nat-s-i01: no assay set/);
    expect(m.ev.tests!.secondary.tests[6]).toMatchObject({ id: "improvement", assessed: true });
  });

  it("counts a history as not significant / not improved when ANY part of it is unresolved: only its genome set, only its quenched control, only its bundle", () => {
    // Heredity: nat-a histories 0-4 and nat-s histories 0-1 are structured. Losing one part of one of them drops it from the count (denominator 24), whichever part.
    const structured = (arm: HuntArm, i: number) => ((arm === "nat-a" && i < 5) || (arm === "nat-s" && i < 2) ? (g: number, f: number) => 5_000 * f + (g % 3) : undefined);
    const base = evaluate({ w: defaultSep, x: structured }).ev.tests!.secondary.heredity as any;
    expect([base.arms["nat-a"].demonstrated, base.arms["nat-s"].demonstrated]).toEqual([5, 2]);
    const parts: [string, Plan["omit"], string[], RegExp][] = [
      ["its genome set only", [sid("nat-a", 0, "-genome")], [], /s1-nat-a-i00-genome: no assay set/],
      ["its quenched control only", [sid("nat-a", 0, "-quench")], [], /s1-nat-a-i00-quench: no assay set/],
      ["its bundle only", [], ["nat-a-i00"], /nat-a-i00 run is unresolved/],
    ];
    for (const [what, omit, badRuns, why] of parts) {
      const { ev, histories } = evaluate({ w: defaultSep, x: structured, omit }, { badRuns });
      // The history is unresolved (it counts toward the more-than-6 rule) ...
      expect(histories.find((h) => h.id === "nat-a-i00")!.unresolved.length, what).toBeGreaterThan(0);
      // ... and so it is not significant in Heredity, though its W set and its fragments are intact (genome only) or the quench / bundle alone is lost.
      const h = (ev.tests!.secondary.heredity as any).arms["nat-a"];
      expect(h, what).toMatchObject({ n: 24, demonstrated: 4, p: binomialUpperTail(4, 24, 1, 20) });
      expect(h.histories[0], what).toMatchObject({ outcome: "unresolved", demonstrated: false, icc: null, p: null });
      expect(h.histories[0].why, what).toMatch(why);
      expect(h.histories[1], what).toMatchObject({ outcome: "analysed", demonstrated: true });
    }
    // The genome set of an -s history, and of a shuf history (descriptive arm), the same.
    const sGenome = (evaluate({ w: defaultSep, x: structured, omit: [sid("nat-s", 1, "-genome")] }).ev.tests!.secondary.heredity as any).arms["nat-s"];
    expect(sGenome).toMatchObject({ demonstrated: 1 });
    expect(sGenome.histories[1].outcome).toBe("unresolved");
    const shufG = (evaluate({ w: defaultSep, omit: [sid("shuf-a", 3, "-genome")] }).ev.tests!.secondary.heredity as any).arms["shuf-a"];
    expect(shufG.histories[3]).toMatchObject({ outcome: "unresolved", demonstrated: false });
    // Improvement: 18 of 24 nat-s sources improve; losing any one part of nat-s i1 (improving) makes it not improved, the denominator staying 24; the W values themselves are measured.
    const w = (arm: HuntArm, i: number) => (arm === "nat-s" ? (i < 18 ? 700 : 400) : defaultSep(arm, i));
    const imp = (o: { omit?: readonly string[]; badRuns?: readonly string[] }) => (evaluate({ w, src: () => 500, omit: o.omit && [...o.omit] }, { badRuns: o.badRuns && [...o.badRuns] }).ev.tests!.secondary.improvement as any)["nat-s"];
    expect(imp({})).toMatchObject({ improved: 18, n: 24 });
    for (const [what, o, why] of [
      ["its genome set only", { omit: [sid("nat-s", 1, "-genome")] }, /s1-nat-s-i01-genome: no assay set/],
      ["its quenched control only", { omit: [sid("nat-s", 1, "-quench")] }, /s1-nat-s-i01-quench: no assay set/],
      ["its bundle only", { badRuns: ["nat-s-i01"] }, /nat-s-i01 run is unresolved/],
    ] as const) {
      const r = imp(o);
      expect(r, what).toMatchObject({ improved: 17, n: 24, p: reg1ReportSignTest(17, 24) });
      expect(r.terms[1], what).toMatchObject({ status: "unresolved", improved: false, W: null, source: null });
      expect(r.terms[1].why, what).toMatch(why);
      expect(r.terms[2], what).toMatchObject({ status: "measured", improved: true });
    }
    // The descriptive shuf-s count follows the same rule.
    const sh = (evaluate({ w: (arm, i) => (arm === "shuf-s" ? 700 : defaultSep(arm, i)), src: () => 500, omit: [sid("shuf-s", 4, "-genome")] }).ev.tests!.secondary.improvement as any)["shuf-s"];
    expect(sh).toMatchObject({ improved: 23, n: 24 });
    expect(sh.terms[4]).toMatchObject({ status: "unresolved", improved: false });
  });

  it("builds the readout: one document, the outcome row, the contrasts, never NaN, with the tests withheld under Invalid", () => {
    const m = modelOf({ w: defaultSep });
    const runs = [...HUNT_ARMS].flatMap((arm) => idx.map((i): HuntRun => ({ id: `${arm}-i${String(i).padStart(2, "0")}`, kind: "history", arm: arm.startsWith("nat") ? "nat" : "shuf", seed: huntHistorySeed(arm, i), histArm: arm, index: i, dir: `/runs/${arm}-i${i}`, resolved: true, why: [], conservationOk: true, hashes: {}, branch: arm.endsWith("-s") ? { sourceHash: srcHash(i), boundary: 100 } : null, fingerprint: null, censusEvery: 1000, host: null, ponds: null })));
    const device = { passed: true, reasons: [], finalHash: "h", mac: "/m", bundles: [], uncovered: [] };
    const repro = { passed: true, reasons: [], draws: [], histories: [], skipped: [] };
    const out = huntReadout({ sets: m.sets, rejected: [], runs, device, reproducibility: repro, pondDeath: 32_768, queue: { complete: true, commands: 3, done: 3, failed: 0, pending: [], reasons: [] } });
    expect(out).toMatchObject({ outcome: "analysed", row: null, pondDeath: 32_768, withheld: false, withheldReason: null, budgetStopped: false, contrasts: { A: "Hit", S: "Hit" } });
    expect(Object.keys(out)).toEqual(["outcome", "row", "pondDeath", "reasons", "budgetStopped", "withheld", "withheldReason", "contrasts", "definitions", "queue", "validity", "primary", "secondary", "availability", "descriptive"]);
    expect(out.availability).toMatchObject({ expected: 269, measured: 269, unresolved: 0 });
    expect((out.descriptive as any).ancestorW.worlds.map((w: any) => w.W)).toEqual([50, 51, 52, 53]);
    expect((out.descriptive as any).ancestorW.mean).toBe(51.5);
    expect((out.descriptive as any).genomeControl).toMatchObject({ id: "s1-genome-control", W: 250 });
    expect((out.descriptive as any).against.find((a: any) => a.arm === "nat-s" && a.id === "nat-s-i04")).toMatchObject({ W: 1_004, reference: 500, difference: 504 });
    expect((out.descriptive as any).against.find((a: any) => a.arm === "nat-a" && a.id === "nat-a-i04")).toMatchObject({ W: 1_004, reference: 51.5 });
    expect((out.descriptive as any).w.find((w: any) => w.id === "s1-nat-a-i00")).toMatchObject({ W: 1_000, successFraction: 0, noFamilies: false });
    expect(hasNonFinite(out)).toBe(false);
    // Under Invalid: the row, no statistic.
    const bad = huntReadout({ sets: m.sets, rejected: [], runs, device: { ...device, passed: false, reasons: ["bad"] }, reproducibility: repro, pondDeath: 32_768 });
    expect(bad).toMatchObject({ outcome: "Invalid", row: { outcome: "Invalid", next: "Report; no claim." }, withheld: true, primary: null, secondary: null, contrasts: null });
    expect(bad.withheldReason).toMatch(/Invalid/);
    // Not assessed under a missing set; the descriptives hold null, not 0.
    const gap = modelOf({ w: defaultSep, omit: [sid("nat-a", 1)] });
    const r2 = huntReadout({ sets: gap.sets, rejected: [], runs, device, reproducibility: repro, pondDeath: 32_768 });
    expect(r2.contrasts).toMatchObject({ A: "Not assessed", S: "Hit" });
    expect((r2.descriptive as any).against.find((a: any) => a.id === "nat-a-i01")).toMatchObject({ W: null, difference: null });
    expect(hasNonFinite(r2)).toBe(false);
  });

  it("marks the -s pair unresolved in the readout when its source is missing, mismatched, repeated or of mixed origin: contrast S is not assessed, not only Improvement", () => {
    const device = { passed: true, reasons: [], finalHash: "h", mac: "/m", bundles: [], uncovered: [] };
    const repro = { passed: true, reasons: [], draws: [], histories: [], skipped: [] };
    const history = (arm: HuntArm, i: number, over: Partial<HuntRun> = {}): HuntRun => ({ id: `${arm}-i${String(i).padStart(2, "0")}`, kind: "history", arm: arm.startsWith("nat") ? "nat" : "shuf", seed: huntHistorySeed(arm, i), histArm: arm, index: i, dir: `/runs/${arm}-i${i}`, resolved: true, why: [], conservationOk: true, hashes: {}, branch: arm.endsWith("-s") ? { sourceHash: srcHash(i), boundary: 100 } : null, fingerprint: null, censusEvery: 1000, host: null, ponds: null, ...over });
    const runsOf = (over: (arm: HuntArm, i: number) => Partial<HuntRun> = () => ({})) => HUNT_ARMS.flatMap((arm) => idx.map((i) => history(arm, i, over(arm, i))));
    const readout = (sets: HuntSet[], runs: HuntRun[], rejected: Parameters<typeof huntReadout>[0]["rejected"] = []) => huntReadout({ sets, rejected, runs, device, reproducibility: repro, pondDeath: 32_768 });
    const m = modelOf({ w: defaultSep });
    // Complete and consistent: the registration's origin, nobody unresolved, both contrasts hits.
    const good = readout(m.sets, runsOf());
    expect(good).toMatchObject({ outcome: "analysed", contrasts: { A: "Hit", S: "Hit" } });
    expect((good.availability as any).sources).toEqual({ origin: "registration", problems: [] });
    // A source set that is missing (here, rejected: its hash is not the bundles'): both -s histories of its index are unresolved, so S cannot be assessed.
    const bad = modelFromDirs(s1Dirs({ w: defaultSep }).map((d) => ((d.json.labels as any).set === "s1-src-i05" ? setDir("s1-src-i05", { json: { provenance: { ...provenanceOf("s1-src-i05"), stateHash: "OTHER" } } }) : d)));
    expect(bad.rejected.map((r) => r.id)).toEqual(["s1-src-i05"]);
    const miss = readout(bad.sets, runsOf(), bad.rejected);
    expect(miss).toMatchObject({ outcome: "analysed", contrasts: { A: "Hit", S: "Not assessed" } });
    // Their sets are unresolved with them (a set whose source bundle is unresolved is unresolved too).
    expect((miss.availability as any).histories.filter((h: any) => h.unresolved.length).map((h: any) => [h.id, h.unresolved[0]])).toEqual([["nat-s-i05", "nat-s-i05 run"], ["shuf-s-i05", "shuf-s-i05 run"]]);
    expect((miss.availability as any).runs.find((r: any) => r.id === "nat-s-i05").why[0]).toMatch(/^-s index 05: its source set s1-src-i05 is missing or unresolved$/);
    expect((miss.availability as any).sources.problems).toHaveLength(1);
    // The pair branched from another source than its source set records.
    const other = readout(m.sets, runsOf((arm, i) => (arm.endsWith("-s") && i === 7 ? { branch: { sourceHash: "X", boundary: 100 } } : {})));
    expect(other.contrasts).toMatchObject({ A: "Hit", S: "Not assessed" });
    expect((other.availability as any).sources.problems[0]).toMatch(/^-s index 07: nat-s-i07 branched from X, but its source set s1-src-i07 records /);
    // The sources are not distinct: both pairs of the repeat, nobody else.
    const twin = readout(m.sets, runsOf((arm, i) => (arm.endsWith("-s") && (i === 2 || i === 3) ? { branch: { sourceHash: "same", boundary: 100 } } : {})));
    expect((twin.availability as any).histories.filter((h: any) => h.unresolved.length && h.arm.endsWith("-s")).map((h: any) => h.id).sort()).toEqual(["nat-s-i02", "nat-s-i03", "shuf-s-i02", "shuf-s-i03"]);
    // Mixed origin: every -s history, so more than 6 in each -s arm: Uninformative.
    const mixed = modelFromDirs(s1Dirs({ w: defaultSep }).map((d) => ((d.json.labels as any).set === "s1-src-i11" ? setDir("s1-src-i11", { json: { provenance: { ...provenanceOf("s1-src-i11"), source: "/x/ponds/treatment/seed-4901512" } } }) : d)));
    expect(mixed.rejected).toEqual([]);
    const mix = readout(mixed.sets, runsOf());
    expect(mix.outcome).toBe("Uninformative");
    expect(mix).toMatchObject({ withheld: true, primary: null, contrasts: null });
    expect((mix.validity as any).unresolved.arms).toMatchObject({ "nat-s": { unresolved: 24 }, "shuf-s": { unresolved: 24 }, "nat-a": { unresolved: 0 } });
    expect((mix.availability as any).sources.origin).toBe("mixed");
    // The caller's runs are not mutated: the readout checks copies.
    const runs = runsOf();
    readout(bad.sets, runs, bad.rejected);
    expect(runs.every((r) => r.resolved && r.why.length === 0)).toBe(true);
  });

  it("keeps Invalid's precedence when nothing is analysed: an incomplete queue or a budget stop with a failed device (or reproducibility) check is Invalid, otherwise incomplete / Uninformative", () => {
    const failed = { passed: false, reasons: ["finalHash differs"], finalHash: null, mac: null, bundles: [], uncovered: [] };
    const passed = { passed: true, reasons: [], finalHash: "h", mac: "/m", bundles: [], uncovered: [] };
    const reproFailed = { passed: false, reasons: ["no rerun of shuf-a-i04"], draws: [], histories: [], skipped: [] };
    const base = { sets: [], rejected: [], runs: [], pondDeath: 32_768 };
    const queue = reg1ReportQueueCheck({ commands: [{ id: "a", instance: 1 }, { id: "b", instance: 2 }] }, [{ instance: 1, commands: { a: "done" } }]);
    expect(queue.complete).toBe(false);
    // An incomplete queue: Invalid with a failed device check (the row of the table, the analysis still withheld), the reasons in order, incomplete otherwise.
    const inv = huntReadout({ ...base, device: failed, reproducibility: null, queue });
    expect(inv).toMatchObject({ outcome: "Invalid", row: { outcome: "Invalid", next: "Report; no claim." }, budgetStopped: false, withheld: true, contrasts: null, primary: null, secondary: null, availability: null, descriptive: null });
    expect(inv.withheldReason).toBe("the queue has not completed: nothing is analysed");
    expect(inv.reasons[0]).toBe("device check failed: finalHash differs");
    expect(inv.reasons[1]).toMatch(/the queue has not completed: 1 of 2 commands have no terminal state \(b\)/);
    expect(inv.reasons.at(-1)).toMatch(/nothing is analysed/);
    expect(inv.queue).toMatchObject({ complete: false, pending: ["b"] });
    for (const device of [passed, null]) expect(huntReadout({ ...base, device, reproducibility: null, queue })).toMatchObject({ outcome: "incomplete", row: null, withheld: true });
    // A failed reproducibility check, where it is given, is Invalid too; a passed one is not.
    expect(huntReadout({ ...base, device: passed, reproducibility: reproFailed, queue })).toMatchObject({ outcome: "Invalid", row: { outcome: "Invalid" } });
    expect(huntReadout({ ...base, device: passed, reproducibility: { ...reproFailed, passed: true, reasons: [] }, queue }).outcome).toBe("incomplete");
    // A budget stop: Uninformative absent an Invalid condition, Invalid with one (device or reproducibility), whether or not the queue is complete.
    for (const q of [undefined, queue]) {
      expect(huntReadout({ ...base, device: passed, reproducibility: null, budgetStopped: true, queue: q })).toMatchObject({ outcome: "Uninformative", row: { outcome: "Uninformative" }, budgetStopped: true, withheld: true });
      expect(huntReadout({ ...base, device: null, reproducibility: null, budgetStopped: true, queue: q }).outcome).toBe("Uninformative");
      const b = huntReadout({ ...base, device: failed, reproducibility: null, budgetStopped: true, queue: q });
      expect(b).toMatchObject({ outcome: "Invalid", row: { outcome: "Invalid" }, budgetStopped: true, withheld: true });
      expect(b.reasons).toEqual(["device check failed: finalHash differs", "the budget stopped the queue: nothing is analysed (no partial ensemble is ever analysed)"]);
      expect(huntReadout({ ...base, device: passed, reproducibility: reproFailed, budgetStopped: true, queue: q }).outcome).toBe("Invalid");
    }
    // The budget stop outranks the incomplete queue (both nothing-analysed), and a complete queue with nothing wrong analyses (here: it needs its checks).
    expect(huntReadout({ ...base, device: passed, reproducibility: null, budgetStopped: true, queue }).withheldReason).toBe("the budget stopped the queue: nothing is analysed");
    expect(() => huntReadout({ ...base, device: failed, reproducibility: null, queue: { ...queue, complete: true } })).toThrow(/device and reproducibility checks are needed/);
    expect(hasNonFinite(inv)).toBe(false);
  });

  it("analyses nothing under a budget stop or an incomplete queue", () => {
    const base = { sets: [], rejected: [], runs: [], device: null, reproducibility: null, pondDeath: 32_768 };
    const stop = huntReadout({ ...base, budgetStopped: true });
    expect(stop).toMatchObject({ outcome: "Uninformative", row: { outcome: "Uninformative" }, budgetStopped: true, withheld: true, primary: null, secondary: null, availability: null });
    expect(stop.reasons).toEqual(["the budget stopped the queue: nothing is analysed (no partial ensemble is ever analysed)"]);
    // A device check given and failed is technical status: Invalid still comes first.
    const inv = huntReadout({ ...base, budgetStopped: true, device: { passed: false, reasons: ["hash"], finalHash: null, mac: null, bundles: [], uncovered: [] } });
    expect(inv.outcome).toBe("Invalid");
    const queue = reg1ReportQueueCheck({ commands: [{ id: "a", instance: 1 }, { id: "b", instance: 2 }] }, [{ instance: 1, commands: { a: "done" } }]);
    const inc = huntReadout({ ...base, queue });
    expect(inc).toMatchObject({ outcome: "incomplete", row: null, withheld: true });
    expect(inc.reasons[0]).toMatch(/the queue has not completed: 1 of 2 commands have no terminal state \(b\)/);
    expect(huntQueueInstances({ commands: [{ id: "a", instance: 1 }, { id: "b", instance: 2 }, { id: "c", instance: 2 }] })).toBe(2);
    expect(huntQueueInstances({})).toBeNull();
    expect(() => huntReadout({ ...base })).toThrow(/device and reproducibility checks are needed/);
  });
});

// =============================================================================================

describe("bundles: the runs, the device check and the reproducibility draw", () => {
  const read = (m: unknown, kind: ManifestKind, o: { pondDeath?: number; dir?: string; histArm?: HuntArm; arm?: "nat" | "shuf"; i?: number } = {}) => {
    const r = huntRoleOf(m);
    expect("role" in r).toBe(true);
    return huntBundleProblems(m, (r as any).role, { pondDeath: o.pondDeath ?? HUNT_DEATH.base, dir: o.dir });
  };

  it("accepts the hunt's run of each role and refuses each deviation", () => {
    const kinds: [ManifestKind, Parameters<typeof manifest>[1]][] = [["g1", { arm: "nat", i: 1 }], ["g1f", { arm: "shuf" }], ["d3", { arm: "nat", i: 2 }], ["history", { histArm: "nat-a", i: 3 }], ["history", { histArm: "shuf-s", i: 9 }], ["repro", { histArm: "nat-a", i: 3 }], ["repro", { histArm: "shuf-s", i: 9 }], ["ancestor", { i: 2 }], ["device", {}]];
    for (const [kind, o] of kinds) expect(read(manifest(kind, o), kind), `${kind} ${JSON.stringify(o)}`).toEqual([]);
    const problem = (m: Record<string, any>, kind: ManifestKind = "history") => read(m, kind).join("\n");
    const base = (over: Record<string, unknown> = {}, o = {}) => manifest("history", { histArm: "nat-a", i: 3, over, ...o });
    expect(problem(base({ finishedAt: undefined }))).toMatch(/the run did not finish/);
    expect(problem(base({ summary: null }))).toMatch(/the run did not finish/);
    expect(problem(base({ spec: { ...base().spec, steps: 1_000_000 } }))).toMatch(/spec\.steps 1000000, want 2000000/);
    expect(problem(base({ spec: { ...base().spec, condition: "pond-shuf" } }))).toMatch(/spec\.condition "pond-shuf", want "pond-nat"/);
    expect(problem(base({ spec: { ...base().spec, presetId: "m3" } }))).toMatch(/spec\.presetId "m3", want "ponds"/);
    expect(problem(base({ spec: { ...base().spec, overrides: { mutRate: 0 } } }))).toMatch(/spec\.overrides \{"mutRate":0\}, want null/);
    expect(problem(base({ spec: { ...base().spec, soloFounder: 2 } }))).toMatch(/spec\.soloFounder is set/);
    expect(problem(base({ spec: { ...base().spec, preCycleCheckpoints: [34] } }))).toMatch(/spec\.preCycleCheckpoints \[34\] does not list boundary 200/);
    expect(problem(base({ preCycleCheckpoints: [{ boundary: 34, step: 340_000, file: "checkpoints/b034-pre.blck", hash: "x" }] }))).toMatch(/no preCycleCheckpoints entry for boundary 200 at step 2000000 in checkpoints\/b200-pre\.blck/);
    expect(problem(base({ presetIdentity: "other" }))).toMatch(/presetIdentity "other", want "56526b894cfccf3f"/);
    expect(problem(base({ cfg: { ...base().cfg, mutRate: 0 } }))).toMatch(/cfg\.mutRate 0, want 429497/);
    expect(problem(base({ cfg: { ...base().cfg, pondArm: "shuf" } }))).toMatch(/cfg\.pondArm "shuf", want "nat"/);
    expect(problem(base({ cfg: { ...base().cfg, pondDeath: 65_536 } }))).toMatch(/cfg\.pondDeath 65536, want 32768/);
    expect(problem(base({ cfg: { ...base().cfg, pondExport: 24 } }))).toMatch(/cfg\.pondExport 24, want 28/);
    expect(problem(base({ cfg: { ...base().cfg, tilesX: 4 } }))).toMatch(/cfg\.tilesX 4, want 8/);
    expect(problem(base({ initHash: undefined }))).toMatch(/no initHash/);
    expect(problem(base({ startStep: 10 }))).toMatch(/startStep 10, want 0/);
    expect(problem(base({ branch: { source: "s", sourceHash: "h", postHash: "p", boundary: 100 } }))).toMatch(/has a branch, but this run starts from the preset/);
    expect(problem(base({ runId: "x/ponds/pond-nat/seed-1" }))).toMatch(/runId "x\/ponds\/pond-nat\/seed-1", want "history\/ponds\/pond-nat\/seed-4901004"/);
    expect(problem(base({ spec: { ...base().spec, experiment: undefined } }))).toMatch(/spec\.experiment undefined is not named/);
    expect(huntBundleProblems(base(), huntRoleOf(base()).hasOwnProperty("role") ? (huntRoleOf(base()) as any).role : null, { pondDeath: 32_768, dir: "/runs/hunt1/other/ponds/pond-nat/seed-4901004" }).join("\n")).toMatch(/does not end in history\/ponds\/pond-nat\/seed-4901004/);
    expect(huntBundleProblems(base(), (huntRoleOf(base()) as any).role, { pondDeath: 32_768, dir: "/runs/hunt1/history/ponds/pond-nat/seed-4901004/" })).toEqual([]);
    // A -s history is a branch: its source recorded, no initHash, boundary 100.
    const s = (over: Record<string, unknown> = {}) => manifest("history", { histArm: "nat-s", i: 4, over });
    expect(problem(s({ branch: undefined }), "history")).toMatch(/has no branch \(a -s history is a branch of its source\)/);
    expect(problem(s({ branch: { source: "s", sourceHash: "h", postHash: "p", boundary: 99 } }))).toMatch(/branch\.boundary 99, want 100/);
    expect(problem(s({ branch: { source: "", sourceHash: "", boundary: 100 } }))).toMatch(/branch\.source is not recorded[\s\S]*branch\.sourceHash is not recorded[\s\S]*branch\.postHash is not recorded/);
    expect(problem(s({ initHash: "x" }))).toMatch(/has an initHash, but a branch starts from its source/);
    // Its steps count from the source's step (10^6): spec.steps 10^6, the run ending at 2 x 10^6, and the world starting at the source's step.
    expect(problem(s({ spec: { ...s().spec, steps: 2_000_000 } }))).toMatch(/spec\.steps 2000000, want 1000000/);
    expect(problem(s({ summary: { steps: 1_000_000, finalHash: "f", conservationOk: true } }))).toMatch(/summary\.steps 1000000, want 2000000/);
    expect(problem(s({ startStep: 0 }))).toMatch(/startStep 0, want 1000000/);
    expect(problem(s({ preCycleCheckpoints: manifest("history", { histArm: "nat-a" }).preCycleCheckpoints }))).toMatch(/no preCycleCheckpoints entry for boundary 134/);
  });

  it("takes G1, D3 and the device check at the stage's pondDeath: e = 1/2, or 65,536 after G1's fallback", () => {
    const by = (kind: ManifestKind, pondDeath: number, o: Parameters<typeof manifest>[1] = {}) => read(manifest(kind, { ...o, pondDeath }), kind, { pondDeath });
    // D3 and a history: overrides carry pondDeath 65,536 exactly when the stage runs at the fallback.
    expect(by("d3", 65_536, { arm: "nat" })).toEqual([]);
    expect(read(manifest("d3", { arm: "nat" }), "d3", { pondDeath: 65_536 }).join("\n")).toMatch(/spec\.overrides \{"mutRate":0\}, want \{"mutRate":0,"pondDeath":65536\}[\s\S]*cfg\.pondDeath 32768, want 65536/);
    expect(read(manifest("history", { histArm: "shuf-a", pondDeath: 65_536 }), "history", { pondDeath: 32_768 }).join("\n")).toMatch(/spec\.overrides \{"pondDeath":65536\}, want null/);
    expect(by("device", 65_536)).toEqual([]);
    expect(read(manifest("device"), "device", { pondDeath: 65_536 }).join("\n")).toMatch(/spec\.overrides null, want \{"pondDeath":65536\}/);
    // D3 has mutation off, G1 mutation on, the fallback its own override.
    expect(read(manifest("d3", { arm: "shuf", over: { cfg: { ...manifest("d3", { arm: "shuf" }).cfg, mutRate: 429_497 } } }), "d3").join("\n")).toMatch(/cfg\.mutRate 429497, want 0/);
    expect(read(manifest("g1f", { arm: "nat", over: { spec: { ...manifest("g1f", { arm: "nat" }).spec, overrides: undefined } } }), "g1f").join("\n")).toMatch(/spec\.overrides null, want \{"pondDeath":65536\}/);
  });

  it("resolves a role's bundles: one finished bundle each, its ponds.tsv read, anything else listed", async () => {
    const wanted = huntExpectedRuns("g1");
    const mk = (kind: ManifestKind, o: Parameters<typeof manifest>[1] & { dir?: string }) => ({ dir: o.dir ?? `/runs/g1/ponds/pond-${o.arm}/seed-${huntG1Seed(o.arm!, o.i!, kind === "g1f")}`, manifest: manifest(kind, o) });
    const readPonds = async (dir: string, expect_: HuntPondsExpect) => summaryOf(pondsLines(boundariesOf(expect_.first, expect_.last), scenario(expect_.arm)), expect_);
    const good = [mk("g1", { arm: "nat", i: 0 }), mk("g1", { arm: "nat", i: 1 }), mk("g1", { arm: "shuf", i: 0 }), mk("g1", { arm: "shuf", i: 1 })];
    const all = await huntResolveRuns([...good, mk("g1f", { arm: "nat", i: 0 }), { dir: "/runs/x", manifest: { spec: { seed: 7 } } }, mk("repro" as any, { histArm: "nat-a", i: 0, dir: "/runs/repro" })], wanted, { pondDeath: HUNT_DEATH.base, checkpointSize: filesPresent, readPonds });
    expect(all.runs.map((r) => [r.id, r.resolved])).toEqual([["g1-nat-s0", true], ["g1-nat-s1", true], ["g1-shuf-s0", true], ["g1-shuf-s1", true]]);
    expect(all.runs[0]).toMatchObject({ kind: "g1", conservationOk: true, dir: good[0].dir, hashes: {}, branch: null, ponds: { first: 1, last: 30 } });
    expect(all.others.map((o) => o.why)).toEqual([
      "g1f-nat-s0 (g1f) is not one of the runs this stage reads",
      expect.stringMatching(/not a hunt run seed/),
      "a reproducibility rerun of nat-a-i00: give it with --repro",
    ]);
    // A missing bundle, an unfinished one, two finished ones, a manifest that is not the run, a ponds.tsv that is not complete.
    const unfinished = mk("g1", { arm: "shuf", i: 1 });
    unfinished.manifest.finishedAt = undefined;
    unfinished.manifest.summary = null;
    const twin = { ...good[0], dir: "/runs/g1b/ponds/pond-nat/seed-4900001" };
    const wrongSteps = mk("g1", { arm: "nat", i: 1, over: { spec: { ...manifest("g1", { arm: "nat", i: 1 }).spec, steps: 100 } } });
    const r = await huntResolveRuns([good[0], twin, wrongSteps, good[2], unfinished], wanted, { pondDeath: HUNT_DEATH.base, checkpointSize: filesPresent, readPonds });
    expect(r.runs[0]).toMatchObject({ resolved: false, why: [expect.stringMatching(/^2 finished run bundles/)] });
    expect(r.runs[1].why.join("\n")).toMatch(/spec\.steps 100, want 300000/);
    expect(r.runs[2].resolved).toBe(true);
    expect(r.runs[3]).toMatchObject({ resolved: false });
    expect(r.runs[3].why.join("\n")).toMatch(/the run did not finish/);
    const none = await huntResolveRuns([], wanted, { pondDeath: HUNT_DEATH.base, checkpointSize: filesPresent, readPonds });
    expect(none.runs.every((x) => !x.resolved && x.why[0] === "no run bundle" && x.dir === null)).toBe(true);
    const shortPonds = await huntResolveRuns(good, wanted, { pondDeath: HUNT_DEATH.base, checkpointSize: filesPresent, readPonds: async (d, e) => summaryOf(pondsLines(boundariesOf(1, 29), scenario(e.arm)), e) });
    expect(shortPonds.runs[0].why.join("\n")).toMatch(/ponds\.tsv: ponds\.tsv ends at boundary 29, want 30/);
    // G1 reads conservation as a result; the other stages as a failure.
    const notExact = mk("g1", { arm: "nat", i: 0, over: { summary: { steps: 300_000, finalHash: "x", conservationOk: false } } });
    const asResult = await huntResolveRuns([notExact], wanted.slice(0, 1), { pondDeath: HUNT_DEATH.base, checkpointSize: filesPresent, readPonds, conservationIsResult: true });
    expect(asResult.runs[0]).toMatchObject({ resolved: true, conservationOk: false });
    const asFailure = await huntResolveRuns([notExact], wanted.slice(0, 1), { pondDeath: HUNT_DEATH.base, checkpointSize: filesPresent, readPonds });
    expect(asFailure.runs[0]).toMatchObject({ resolved: false, conservationOk: false });
    expect(asFailure.runs[0].why).toEqual(["summary.conservationOk false: matter or the energy ledger was not conserved"]);
  });

  it("refuses a -s pair that branches from two different sources", async () => {
    const mk = (histArm: HuntArm, i: number, source: string): HuntRun => ({ id: `${histArm}-i0${i}`, kind: "history", arm: histArm.startsWith("nat") ? "nat" : "shuf", seed: huntHistorySeed(histArm, i), histArm, index: i, dir: "/d", resolved: true, why: [], conservationOk: true, hashes: {}, branch: { sourceHash: source, boundary: 100 }, fingerprint: null, censusEvery: 1000, host: null, ponds: null });
    const runs = [mk("nat-s", 1, "A"), mk("shuf-s", 1, "A"), mk("nat-s", 2, "B"), mk("shuf-s", 2, "C"), mk("nat-s", 3, "D")];
    const msgs = huntPairingProblems(runs);
    expect(msgs).toEqual(["nat-s-i02 and shuf-s-i02 branch from different sources (B, C), but a -s pair shares its source"]);
    expect(runs.map((r) => r.resolved)).toEqual([true, true, false, false, true]);
    expect(runs[2].why).toEqual(msgs);
  });

  it("fixes the reproducibility draw: the first two distinct values of randomKey(4,905,101, 0, k, 0) mod 96, in seed order", () => {
    const sel = huntReproSelection();
    // Pinned: k = 0 gives 85 (the 14th -s shuf history), k = 1 gives 28 (shuf-a, index 4).
    expect(sel.draws).toEqual([{ k: 0, value: 85 }, { k: 1, value: 28 }]);
    expect(sel.selected).toEqual([{ value: 85, histArm: "shuf-s", index: 13, id: "shuf-s-i13" }, { value: 28, histArm: "shuf-a", index: 4, id: "shuf-a-i04" }]);
    expect(huntReproSelection()).toEqual(sel);
    // Recomputed from the key directly, and indexing the histories in seed order (nat-a 0-23, shuf-a 24-47, nat-s 48-71, shuf-s 72-95).
    expect([0, 1].map((k) => randomKey(4_905_101, 0, k, 0) % 96)).toEqual([85, 28]);
    expect(sel.selected.map((s) => HUNT_ARMS[Math.floor(s.value / 24)])).toEqual(["shuf-s", "shuf-a"]);
    expect(sel.selected.map((s) => huntH(s.histArm, s.index))).toEqual([85, 28]);
    expect(sel.selected.map((s) => huntHistorySeed(s.histArm, s.index))).toEqual([4_901_314, 4_901_105]);
  });

  /** The two selected histories' instance runs and Mac reruns. */
  const instance = (id: string, histArm: HuntArm, i: number, over: Partial<HuntRun> = {}): HuntRun => {
    const m = manifest("history", { histArm, i });
    return { id, kind: "history", arm: histArm.startsWith("nat") ? "nat" : "shuf", seed: huntHistorySeed(histArm, i), histArm, index: i, dir: `/runs/${id}`, resolved: true, why: [], conservationOk: true, hashes: Object.fromEntries(m.preCycleCheckpoints.map((e: any) => [e.boundary, e.hash])), branch: m.branch ? { sourceHash: m.branch.sourceHash, boundary: 100 } : null, fingerprint: huntFingerprintOf(m), censusEvery: 1000, host: null, ponds: null, ...over };
  };
  const huntFingerprintOf = (m: any) => JSON.stringify({ cfg: m.cfg, spec: m.spec.overrides ?? null, branch: m.branch ? [m.branch.sourceHash, m.branch.boundary] : null });
  void huntFingerprintOf;

  it("passes the reproducibility check when both reruns hash as their instances' b034/b134 checkpoints, and fails each other way", async () => {
    const { huntFingerprint } = await import("../lib/hunt-stats.ts");
    const run = (histArm: HuntArm, i: number) => {
      const m = manifest("history", { histArm, i });
      return instance(`${histArm}-i${String(i).padStart(2, "0")}`, histArm, i, { hashes: Object.fromEntries(m.preCycleCheckpoints.map((e: any) => [e.boundary, e.hash])), fingerprint: huntFingerprint(m) });
    };
    const runs = new Map([run("shuf-s", 13), run("shuf-a", 4)].map((r) => [r.id, r]));
    const rerun = (histArm: HuntArm, i: number, over: Record<string, unknown> = {}, root = "/mac") => {
      const m = manifest("repro", { histArm, i, over });
      return { dir: `${root}/${m.runId}`, manifest: m };
    };
    // The checkpoints as the report decodes them: by default each decodes to the hash its manifest records; `disk` overrides what a directory's file holds.
    const decodedAs = (r: typeof runs, reruns: ReturnType<typeof rerun>[], disk: Record<string, HuntCheckpointCheck | string>) => {
      const known = new Map<string, Record<number, string>>([...[...r.values()].map((x) => [x.dir!, x.hashes] as const), ...reruns.map((x) => [x.dir, huntBundleHashes(x.manifest)] as const)]);
      return (dir: string, boundary: number): HuntCheckpointCheck => {
        const held = disk[dir];
        if (held !== undefined) return typeof held === "string" ? { stateHash: held } : held;
        const hash = known.get(dir)?.[boundary];
        return hash === undefined ? { error: "the file is missing" } : { stateHash: hash };
      };
    };
    const check = (reruns: ReturnType<typeof rerun>[], r = runs, disk: Record<string, HuntCheckpointCheck | string> = {}) => huntReproducibility(r, reruns, { pondDeath: HUNT_DEATH.base, checkpoint: decodedAs(r, reruns, disk) });
    const good = [rerun("shuf-s", 13), rerun("shuf-a", 4)];
    // The reruns' own hashes are b134 (-s) and b034 (-a): those of `manifest(repro)`, equal to the instances' by construction.
    const sameHash = (histArm: HuntArm, i: number, boundary: number) => hashOf("history", { histArm, i }, boundary);
    for (const [histArm, i, b] of [["shuf-s", 13, 134], ["shuf-a", 4, 34]] as const) good.find((g) => g.manifest.spec.seed === huntHistorySeed(histArm, i))!.manifest.preCycleCheckpoints[0].hash = sameHash(histArm, i, b);
    const ok = check(good);
    expect(ok).toMatchObject({ passed: true, reasons: [] });
    expect(ok.histories.map((h) => [h.id, h.boundary, h.passed])).toEqual([["shuf-s-i13", 134, true], ["shuf-a-i04", 34, true]]);
    // A mismatching hash fails it and names both.
    const mismatch = [rerun("shuf-s", 13, { preCycleCheckpoints: [{ boundary: 134, step: 1_340_000, file: "checkpoints/b134-pre.blck", hash: "other" }] }), good[1]];
    expect(check(mismatch)).toMatchObject({ passed: false });
    expect(check(mismatch).reasons[0]).toMatch(/the rerun's b134-pre hash other is not the instance's/);
    // Missing, doubled, off the Mac, wrong steps or configuration, an unresolved instance.
    expect(check([good[0]]).reasons).toEqual(["no rerun of shuf-a-i04"]);
    expect(check([good[0], good[1], { ...good[1], dir: `/mac2/${good[1].manifest.runId}` }]).reasons[0]).toBe(`the reruns of shuf-a-i04: 2 finished run bundles (${good[1].dir}, /mac2/${good[1].manifest.runId}); neither is used`);
    const off = [good[0], { dir: good[1].dir, manifest: { ...good[1].manifest, host: HOSTS[1] } }];
    expect(check(off).reasons[0]).toMatch(/not valid: it ran on host "deno 2\.9\.7 linux-x86_64", not the Mac's \(darwin\)/);
    const cfgOff = [good[0], { dir: good[1].dir, manifest: { ...good[1].manifest, cfg: { ...good[1].manifest.cfg, mutRate: 1 } } }];
    expect(check(cfgOff).reasons[0]).toMatch(/cfg\.mutRate 1, want 429497; its configuration, overrides, condition, seed or branch source differ/);
    const unresolved = new Map(runs);
    unresolved.set("shuf-a-i04", { ...runs.get("shuf-a-i04")!, resolved: false });
    expect(check(good, unresolved).reasons).toEqual(["shuf-a-i04 is unresolved, so the check cannot be made"]);
    // A rerun of a history that was not selected, or of no hunt seed, is skipped, not counted.
    const extra = check([...good, rerun("nat-a", 0)]);
    expect(extra.passed).toBe(true);
    expect(extra.skipped).toEqual([{ dir: rerun("nat-a", 0).dir, why: "nat-a-i00 is not a selected history (shuf-s-i13, shuf-a-i04)" }]);
    // A -s rerun must branch from the instance's own source.
    const otherSource = rerun("shuf-s", 13, { branch: { source: "/s", sourceHash: "elsewhere", boundary: 100, postHash: "p" } });
    otherSource.manifest.preCycleCheckpoints[0].hash = sameHash("shuf-s", 13, 134);
    expect(check([otherSource, good[1]]).reasons[0]).toMatch(/differ from the instance's run of the same history/);
  });

  it("decodes the selected histories' checkpoints, instance and Mac rerun, verifies each hash against its manifest, and fails on a missing or corrupt file or a hash that is not its manifest's", async () => {
    const { huntFingerprint } = await import("../lib/hunt-stats.ts");
    const run = (histArm: HuntArm, i: number) => {
      const m = manifest("history", { histArm, i });
      return instance(`${histArm}-i${String(i).padStart(2, "0")}`, histArm, i, { hashes: Object.fromEntries(m.preCycleCheckpoints.map((e: any) => [e.boundary, e.hash])), fingerprint: huntFingerprint(m) });
    };
    const runs = new Map([run("shuf-s", 13), run("shuf-a", 4)].map((r) => [r.id, r]));
    const rerun = (histArm: HuntArm, i: number, hash?: string, root = "/mac") => {
      const m = manifest("repro", { histArm, i });
      m.preCycleCheckpoints[0].hash = hash ?? hashOf("history", { histArm, i }, histArm.endsWith("-s") ? 134 : 34);
      return { dir: `${root}/${m.runId}`, manifest: m };
    };
    const reruns = [rerun("shuf-s", 13), rerun("shuf-a", 4)];
    const [instS, instA] = ["/runs/shuf-s-i13", "/runs/shuf-a-i04"];
    const H = { s: hashOf("history", { histArm: "shuf-s", i: 13 }, 134), a: hashOf("history", { histArm: "shuf-a", i: 4 }, 34) };
    const loaded: [string, number][] = [];
    const run2 = (rr: typeof reruns, disk: Record<string, HuntCheckpointCheck> = {}, r = runs) => huntReproducibility(r, rr, { pondDeath: HUNT_DEATH.base, checkpoint: (dir, b) => (loaded.push([dir, b]), disk[dir] ?? { stateHash: dir === instS || dir === reruns[0].dir ? H.s : H.a }) });
    // Which checkpoints are loaded: the instance's and the rerun's of both selected histories, b134 for the -s history and b034 for the -a one; none for what is not selected.
    expect(huntReproTargets(runs, [...reruns, rerun("nat-a", 0)])).toEqual([{ dir: instS, boundary: 134 }, { dir: reruns[0].dir, boundary: 134 }, { dir: instA, boundary: 34 }, { dir: reruns[1].dir, boundary: 34 }]);
    expect(huntReproTargets(new Map([["shuf-s-i13", { resolved: false, dir: instS }]]), [reruns[1]])).toEqual([{ dir: reruns[1].dir, boundary: 34 }]);
    const good = run2(reruns);
    expect(good).toMatchObject({ passed: true, reasons: [] });
    expect(good.histories).toEqual([expect.objectContaining({ id: "shuf-s-i13", boundary: 134, instanceHash: H.s, rerunHash: H.s, passed: true }), expect.objectContaining({ id: "shuf-a-i04", boundary: 34, instanceHash: H.a, rerunHash: H.a, passed: true })]);
    expect(loaded).toEqual([[instS, 134], [reruns[0].dir, 134], [instA, 34], [reruns[1].dir, 34]]);
    // A missing or corrupt file (the loader's error) fails it, instance or rerun, naming the file and where.
    const miss = run2(reruns, { [instS]: { error: "the file is missing" } });
    expect(miss.passed).toBe(false);
    expect(miss.reasons).toEqual([`the instance's checkpoints/b134-pre.blck could not be loaded from ${instS}: the file is missing`]);
    const corrupt = run2(reruns, { [reruns[1].dir]: { error: "bad magic" } });
    expect(corrupt.reasons).toEqual([`the rerun's checkpoints/b034-pre.blck could not be loaded from ${reruns[1].dir}: bad magic`]);
    expect(corrupt.histories[1]).toMatchObject({ passed: false, instanceHash: H.a, rerunHash: null });
    // Manifest strings that agree prove nothing: the decoded state must hash to its manifest's entry. Both manifests say H.s, the rerun's file decodes to something else.
    const forged = run2(reruns, { [reruns[0].dir]: { stateHash: "ffffffffffffffff" } });
    expect(forged.passed).toBe(false);
    expect(forged.reasons).toEqual([`the rerun's checkpoints/b134-pre.blck in ${reruns[0].dir} hashes to ffffffffffffffff, but its manifest records ${H.s}`]);
    expect(run2(reruns, { [instA]: { stateHash: "eeeeeeeeeeeeeeee" } }).reasons).toEqual([`the instance's checkpoints/b034-pre.blck in ${instA} hashes to eeeeeeeeeeeeeeee, but its manifest records ${H.a}`]);
    // Each file verifies against its own manifest but the two states differ (the manifests differ): the verified hashes are compared.
    const apart = [rerun("shuf-s", 13, "1111111111111111"), reruns[1]];
    const differ = run2(apart, { [apart[0].dir]: { stateHash: "1111111111111111" } });
    expect(differ.reasons).toEqual([`the rerun's b134-pre hash 1111111111111111 is not the instance's ${H.s}`]);
    expect(differ.histories[0]).toMatchObject({ instanceHash: H.s, rerunHash: "1111111111111111", passed: false });
    // The checks before the files are unchanged, and no file is read for what cannot pass: an unresolved instance, a missing or doubled rerun.
    loaded.length = 0;
    expect(run2([reruns[0]]).reasons).toEqual(["no rerun of shuf-a-i04"]);
    expect(loaded).toEqual([[instS, 134], [reruns[0].dir, 134]]);
    const unresolved = new Map(runs);
    unresolved.set("shuf-a-i04", { ...runs.get("shuf-a-i04")!, resolved: false });
    loaded.length = 0;
    expect(run2(reruns, {}, unresolved).reasons).toEqual(["shuf-a-i04 is unresolved, so the check cannot be made"]);
    expect(loaded.every(([dir]) => dir !== instA && dir !== reruns[1].dir)).toBe(true);
    // An instance bundle with no directory cannot be loaded from.
    const noDir = new Map(runs);
    noDir.set("shuf-a-i04", { ...runs.get("shuf-a-i04")!, dir: null });
    expect(run2(reruns, {}, noDir).reasons).toEqual(["the instance bundle of shuf-a-i04 has no directory to load b034-pre from"]);
  });

  it("picks a selected history's rerun as every bundle is picked: one finished bundle among <experiment> and <experiment>-c100, an unfinished original superseded, two finished refused", async () => {
    const { huntFingerprint } = await import("../lib/hunt-stats.ts");
    const run = (histArm: HuntArm, i: number) => {
      const m = manifest("history", { histArm, i });
      return instance(`${histArm}-i${String(i).padStart(2, "0")}`, histArm, i, { hashes: Object.fromEntries(m.preCycleCheckpoints.map((e: any) => [e.boundary, e.hash])), fingerprint: huntFingerprint(m) });
    };
    const runs = new Map([run("shuf-s", 13), run("shuf-a", 4)].map((r) => [r.id, r]));
    // A rerun of the experiment `experiment` (the census-100 one is `repro-c100`), finished or not; the hash is the instance's.
    const rerun = (histArm: HuntArm, i: number, o: { experiment?: string; finished?: boolean; root?: string } = {}) => {
      const experiment = o.experiment ?? "repro";
      const base = manifest("repro", { histArm, i });
      const b = histArm.endsWith("-s") ? 134 : 34;
      const m: Record<string, any> = { ...base, runId: base.runId.replace(/^repro\//, `${experiment}/`), spec: { ...base.spec, experiment }, preCycleCheckpoints: base.preCycleCheckpoints.map((e: any) => ({ ...e, hash: hashOf("history", { histArm, i }, b) })) };
      if (o.finished === false) { delete m.summary; delete m.finishedAt; }
      return { dir: `${o.root ?? "/mac"}/${m.runId}`, manifest: m };
    };
    const check = (reruns: ReturnType<typeof rerun>[]) => huntReproducibility(runs, reruns, { pondDeath: HUNT_DEATH.base, checkpoint: (dir, b) => ({ stateHash: dir.includes("shuf-s") || dir.includes("seed-4901314") ? hashOf("history", { histArm: "shuf-s", i: 13 }, b) : hashOf("history", { histArm: "shuf-a", i: 4 }, b) }) });
    const a = rerun("shuf-a", 4);
    // The census-1000 rerun overflowed (unfinished) and its census-100 rerun finished: the finished one is the rerun, the check passes, and the unfinished one is skipped.
    const unfinished = rerun("shuf-s", 13, { finished: false });
    const c100 = rerun("shuf-s", 13, { experiment: "repro-c100" });
    const ok = check([unfinished, c100, a]);
    expect(ok).toMatchObject({ passed: true, reasons: [] });
    expect(ok.histories[0]).toMatchObject({ id: "shuf-s-i13", rerun: c100.dir, passed: true });
    expect(ok.skipped).toEqual([{ dir: unfinished.dir, why: `an unfinished rerun of shuf-s-i13, superseded by the finished ${c100.dir}` }]);
    expect(check([c100, unfinished, a]).passed).toBe(true);
    // The checkpoints loaded are the picked rerun's and the instance's, not the superseded one's.
    expect(huntReproTargets(runs, [unfinished, c100, a])).toEqual([{ dir: "/runs/shuf-s-i13", boundary: 134 }, { dir: c100.dir, boundary: 134 }, { dir: "/runs/shuf-a-i04", boundary: 34 }, { dir: a.dir, boundary: 34 }]);
    // Two finished (the original and its rerun): neither is used, as everywhere else.
    const both = check([rerun("shuf-s", 13), c100, a]);
    expect(both.passed).toBe(false);
    expect(both.reasons).toEqual([`the reruns of shuf-s-i13: 2 finished run bundles (/mac/${rerun("shuf-s", 13).manifest.runId}, ${c100.dir}); neither is used`]);
    expect(both.histories[0].rerun).toBeNull();
    expect(huntReproTargets(runs, [rerun("shuf-s", 13), c100, a]).map((t) => t.dir)).toEqual(["/runs/shuf-s-i13", "/runs/shuf-a-i04", a.dir]);
    // Two unfinished and none finished: refused; a lone unfinished one is picked and then invalid on its own manifest.
    expect(check([unfinished, rerun("shuf-s", 13, { experiment: "repro-c100", finished: false }), a]).reasons[0]).toMatch(/^the reruns of shuf-s-i13: 2 unfinished run bundles \(.*\) and none finished$/);
    const lone = check([unfinished, a]);
    expect(lone.reasons[0]).toMatch(/^the rerun of shuf-s-i13 is not valid: the run did not finish/);
    expect(lone.histories[0].rerun).toBe(unfinished.dir);
    // Nothing for a history: no rerun, as before.
    expect(check([a]).reasons).toEqual(["no rerun of shuf-s-i13"]);
  });

  it("resolves a history bundle only when every pre-cycle checkpoint file it needs exists and is not empty: b034 or b134, and b200", async () => {
    const readPonds = async (dir: string, e: HuntPondsExpect) => summaryOf(pondsLines(boundariesOf(e.first, e.last), scenario(e.arm)), e);
    const mk = (histArm: HuntArm, i: number) => ({ dir: `/runs/hunt1/hist/${manifest("history", { histArm, i }).runId}`, manifest: manifest("history", { histArm, i }) });
    const files = (held: Record<string, number | null>) => async (path: string) => (path in held ? held[path] : 100);
    const resolve = async (bundle: ReturnType<typeof mk>, held: Record<string, number | null>, id: string) => (await huntResolveRuns([bundle], huntExpectedRuns("history").filter((r) => r.id === id), { pondDeath: HUNT_DEATH.base, readPonds, checkpointSize: files(held) })).runs[0];
    const a = mk("nat-a", 3);
    const s = mk("shuf-s", 5);
    expect(await resolve(a, {}, "nat-a-i03")).toMatchObject({ resolved: true, why: [] });
    expect(await resolve(s, {}, "shuf-s-i05")).toMatchObject({ resolved: true, why: [] });
    // -a needs b034 and b200, -s needs b134 and b200; a missing or empty file leaves the bundle unresolved, with why.
    const f = (d: ReturnType<typeof mk>, file: string) => `${d.dir}/${file}`;
    for (const [bundle, id, file] of [[a, "nat-a-i03", "checkpoints/b034-pre.blck"], [a, "nat-a-i03", "checkpoints/b200-pre.blck"], [s, "shuf-s-i05", "checkpoints/b134-pre.blck"], [s, "shuf-s-i05", "checkpoints/b200-pre.blck"]] as const) {
      const gone = await resolve(bundle, { [f(bundle, file)]: null }, id);
      expect(gone, `${id} ${file}`).toMatchObject({ resolved: false });
      expect(gone.why, `${id} ${file}`).toEqual([`${file} is missing (a history needs every pre-cycle checkpoint it was queued to write)`]);
      const empty = await resolve(bundle, { [f(bundle, file)]: 0 }, id);
      expect(empty.why, `${id} ${file}`).toEqual([`${file} is empty`]);
    }
    // Both missing: both listed. A trailing slash on the directory finds the same files. Other roles' bundles are not asked for files (G1 lists none; the reruns are decoded instead).
    const both = await resolve(a, { [f(a, "checkpoints/b034-pre.blck")]: null, [f(a, "checkpoints/b200-pre.blck")]: 0 }, "nat-a-i03");
    expect(both.why).toHaveLength(2);
    const asked: string[] = [];
    await huntResolveRuns([{ dir: `${a.dir}/`, manifest: a.manifest }], huntExpectedRuns("history").filter((r) => r.id === "nat-a-i03"), { pondDeath: HUNT_DEATH.base, readPonds, checkpointSize: async (p) => (asked.push(p), 1) });
    expect(asked).toEqual([`${a.dir}/checkpoints/b034-pre.blck`, `${a.dir}/checkpoints/b200-pre.blck`]);
    const g1 = { dir: `/runs/g1/${manifest("g1", { arm: "nat", i: 0 }).runId}`, manifest: manifest("g1", { arm: "nat", i: 0 }) };
    asked.length = 0;
    const g = await huntResolveRuns([g1], huntExpectedRuns("g1").slice(0, 1), { pondDeath: HUNT_DEATH.base, readPonds, checkpointSize: async (p) => (asked.push(p), null) });
    expect(g.runs[0]).toMatchObject({ resolved: true });
    expect(asked).toEqual([]);
    // A bundle already unresolved on its manifest is not asked for files.
    const bad = { ...a, manifest: { ...a.manifest, finishedAt: undefined, summary: null } };
    asked.length = 0;
    await huntResolveRuns([bad], huntExpectedRuns("history").filter((r) => r.id === "nat-a-i03"), { pondDeath: HUNT_DEATH.base, readPonds, checkpointSize: async (p) => (asked.push(p), 1) });
    expect(asked).toEqual([]);
  });

  const deviceM = (dir: string, host: { host: string; adapter: string }, over: Record<string, unknown> = {}): { dir: string; manifest: Record<string, any> } => ({ dir, manifest: { ...manifest("device"), host, ...over } });
  const deviceOk = () => [deviceM("/dev/mac/device/ponds/pond-nat/seed-4905001", HOSTS.mac), deviceM("/dev/i1/device/ponds/pond-nat/seed-4905001", HOSTS[1]), deviceM("/dev/i2/device/ponds/pond-nat/seed-4905001", HOSTS[2]), deviceM("/dev/i3/device/ponds/pond-nat/seed-4905001", HOSTS[3])];

  it("passes the device check when the Mac and every instance report one finalHash, and fails each other way", () => {
    expect(huntDeviceCheck(deviceOk(), { pondDeath: 32_768 })).toMatchObject({ passed: true, finalHash: "final", mac: "/dev/mac/device/ponds/pond-nat/seed-4905001", reasons: [] });
    const fail = (b: ReturnType<typeof deviceOk>, o: Parameters<typeof huntDeviceCheck>[1] = { pondDeath: 32_768 }) => huntDeviceCheck(b, o).reasons.join("\n");
    const hashed = deviceOk();
    hashed[2].manifest.summary = { ...hashed[2].manifest.summary, finalHash: "other" };
    expect(fail(hashed)).toMatch(/finalHash differs between the device check bundles/);
    expect(fail(deviceOk().slice(1))).toMatch(/3 device check bundles, want 4[\s\S]*0 device check bundles ran on a host naming darwin, want exactly 1/);
    expect(fail([...deviceOk(), deviceM("/dev/mac2", HOSTS.mac)])).toMatch(/5 device check bundles, want 4[\s\S]*2 device check bundles ran on a host naming darwin/);
    const wrongSeed = deviceOk();
    wrongSeed[1] = deviceM("/dev/i1", HOSTS[1], { spec: { ...manifest("device").spec, seed: 4_905_002 } });
    expect(fail(wrongSeed)).toMatch(/is not the device check's|not a hunt run seed/);
    const steps = deviceOk();
    steps[1].manifest.spec = { ...steps[1].manifest.spec, steps: 40_000 };
    expect(fail(steps)).toMatch(/spec\.steps 40000, want 20000/);
    const bad = deviceOk();
    bad[3].manifest.summary = { ...bad[3].manifest.summary, conservationOk: false };
    expect(fail(bad)).toMatch(/summary\.conservationOk false/);
    expect(fail([deviceOk()[0], deviceOk()[0], deviceOk()[2], deviceOk()[3]])).toMatch(/share a directory/);
    // One instance fewer, as the queue says: 1 + instances bundles. A host no device check reports is uncovered.
    expect(huntDeviceCheck(deviceOk().slice(0, 3), { pondDeath: 32_768, instances: 2 }).passed).toBe(true);
    expect(huntDeviceCheck(deviceOk(), { pondDeath: 32_768, instances: 2 }).reasons[0]).toMatch(/4 device check bundles, want 3/);
    const covered = huntDeviceCheck(deviceOk(), { pondDeath: 32_768, runs: [{ id: "nat-a-i00", host: HOSTS[2] }, { id: "nat-a-i01", host: { host: "other", adapter: "gpu" } }] });
    expect(covered.uncovered).toEqual(["nat-a-i01"]);
    expect(covered.reasons[0]).toMatch(/1 run bundles ran on a host and adapter no device check reports \(nat-a-i01; nat-a-i01 on "other" with "gpu"\)/);
    // The device check follows the stage's e: at the fallback it needs the override.
    expect(huntDeviceCheck(deviceOk(), { pondDeath: 65_536 }).reasons.join("\n")).toMatch(/spec\.overrides null, want \{"pondDeath":65536\}/);
  });
});

// =============================================================================================

describe("the -s sources: one source per index, distinct, from one origin; and the scaffold-phase runs of the hunt's own", () => {
  const NN = (i: number) => String(i).padStart(2, "0");
  const reg = (i: number) => `/data/runs/scaffold/reg1/hist/ponds/treatment/seed-${4_850_001 + i}`;
  const own = (i: number) => `/data/runs/scaffold/hunt1/scaf/ponds/treatment/seed-${4_901_501 + i}`;
  const sRun = (histArm: "nat-s" | "shuf-s", i: number, over: Partial<HuntRun> = {}): HuntRun => ({ id: `${histArm}-i${NN(i)}`, kind: "history", arm: histArm === "nat-s" ? "nat" : "shuf", seed: huntHistorySeed(histArm, i), histArm, index: i, dir: `/runs/${histArm}-i${NN(i)}`, resolved: true, why: [], conservationOk: true, hashes: {}, branch: { sourceHash: srcHash(i), boundary: 100 }, fingerprint: null, censusEvery: 1000, host: null, ponds: null, ...over });
  const pairs = (over: (id: string) => Partial<HuntRun> = () => ({})): HuntRun[] => range(24).flatMap((i) => (["nat-s", "shuf-s"] as const).map((a) => sRun(a, i, over(`${a}-i${NN(i)}`))));
  const scaffold = (i: number, over: Partial<HuntRun> = {}): HuntRun => ({ id: `scaffold-i${NN(i)}`, kind: "scaffold", arm: "scaf", seed: 4_901_501 + i, index: i, dir: `/runs/scaffold/hunt1/scaf/ponds/treatment/seed-${4_901_501 + i}`, resolved: true, why: [], conservationOk: true, hashes: { 100: srcHash(i) }, branch: null, fingerprint: null, censusEvery: 1000, host: null, ponds: null, ...over });
  /** The 24 source sets as screened (the -s histories' branch hashes given to the screen), with `path` the recorded source of index i and `omit` the indices not given. */
  const srcSets = (path: (i: number) => string, o: { hash?: (i: number) => string; omit?: number[]; bundles?: Map<string, ScreenBundle> } = {}) => {
    const dirs = range(24).filter((i) => !(o.omit ?? []).includes(i)).map((i) => setDir(`s1-src-i${NN(i)}`, { json: { provenance: { source: path(i), stateHash: o.hash?.(i) ?? srcHash(i) } } }));
    return screen(dirs, "s1", { bundles: o.bundles ?? s1Bundles() });
  };
  const unresolved = (runs: HuntRun[]) => runs.filter((r) => !r.resolved).map((r) => r.id);

  it("classifies a source's directory: the registration's scaf history (or its census-100 rerun), the hunt's own scaffold phase, or neither", () => {
    expect(huntSourceOriginOf(reg(3), 3)).toBe("registration");
    expect(huntSourceOriginOf(`${reg(3)}/`, 3)).toBe("registration");
    expect(huntSourceOriginOf(reg(3).replace("/hist/", "/hist-c100/"), 3)).toBe("registration");
    expect(huntSourceOriginOf(`scaffold/reg1/hist/ponds/treatment/seed-4850004`, 3)).toBe("registration");
    expect(huntSourceOriginOf(own(3), 3)).toBe("own");
    expect(huntSourceOriginOf("ponds/treatment/seed-4901504", 3)).toBe("own");
    // Another index, another arm or condition, another experiment, a main run, a checkpoint file, a path that merely ends in the digits, a non-path.
    for (const bad of [reg(4), own(4), `/data/runs/scaffold/reg1/hist/ponds/pond-rand/seed-${4_850_101 + 3}`, `/data/runs/scaffold/reg1/hist/ponds/pond-cont/seed-${4_850_201 + 3}`, reg(3).replace("/hist/", "/anc/"), reg(3).replace("/hist/", "/hist-c200/"), "runs/scaffold/main/scaf/i3/ckpt/b100-pre.blck.gz", `${reg(3)}/checkpoints/b100-pre.blck`, `/x/ponds/treatment/seed-48500043`, "", 5, null, undefined]) {
      expect(huntSourceOriginOf(bad, 3), String(bad)).toBeNull();
    }
    // The registration's seed is the one its own code derives (reg1WorldSeedOf), the hunt's the document's.
    expect(HUNT_SEEDS.registrationScaf).toBe(4_850_001);
    expect(HUNT_SEEDS.ownScaffold).toBe(4_901_501);
  });

  it("screens a source set's recorded path: it must be one of the two origins for its own index", () => {
    const set = (i: number, source: unknown) => setDir(`s1-src-i${NN(i)}`, { json: { provenance: { source, stateHash: srcHash(i) } } });
    expect(screen([set(5, reg(5)), set(6, own(6)), set(7, reg(7).replace("/hist/", "/hist-c100/"))], "s1", { bundles: s1Bundles() }).rejected).toEqual([]);
    for (const bad of [reg(6), own(4), "runs/scaffold/main/scaf/i5/ckpt/b100-pre.blck.gz", undefined]) {
      const r = screen([set(5, bad)], "s1", { bundles: s1Bundles() });
      expect(r.accepted, String(bad)).toEqual([]);
      expect(r.rejected[0].reasons.join("\n")).toMatch(/provenance\.source .* is neither the registration's scaf history 5 \(…\/scaffold\/reg1\/hist\[-c100\]\/ponds\/treatment\/seed-4850006\) nor the hunt's own scaffold-phase run \(…\/ponds\/treatment\/seed-4901506\)/);
    }
    expect(screen([set(5, "elsewhere")], "s1", { allowAnySeed: true }).accepted).toHaveLength(1);
    // The accepted set keeps what it recorded.
    expect(screen([set(5, reg(5))], "s1", { bundles: s1Bundles() }).accepted[0].provenance).toEqual({ source: reg(5), stateHash: srcHash(5) });
  });

  it("leaves every -s history alone when all 24 source sets match their pairs, are distinct and come from one origin", () => {
    for (const path of [reg, own]) {
      const runs = [...pairs(), ...range(24).map((i) => scaffold(i))];
      const { origin, problems } = huntSourceProblems(runs, srcSets(path).accepted);
      expect(origin).toBe(path === reg ? "registration" : "own");
      expect(problems).toEqual([]);
      expect(unresolved(runs)).toEqual([]);
    }
    // The registration's census-100 reruns are the registration's origin too; without any source set there is no origin to name.
    expect(huntSourceProblems(pairs(), srcSets((i) => reg(i).replace("/hist/", "/hist-c100/")).accepted).origin).toBe("registration");
    expect(huntSourceProblems([], []).origin).toBeNull();
  });

  it("makes a pair unresolved when its source set records another hash than the pair branched from (nat-s and shuf-s both)", () => {
    // a3's scenario: nat-s-i03 and shuf-s-i03 both branched from X, the source set of index 03 was assayed from another source Y; the bundles given to the screen are unaffected.
    const X = "aaaaaaaaaaaaaaaa";
    const runs = pairs((id) => (id.endsWith("-i03") ? { branch: { sourceHash: X, boundary: 100 } } : {}));
    const { problems } = huntSourceProblems(runs, srcSets(reg).accepted);
    expect(unresolved(runs)).toEqual(["nat-s-i03", "shuf-s-i03"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^-s index 03: nat-s-i03 branched from ${X}, but its source set s1-src-i03 records ${srcHash(3)}; shuf-s-i03 branched from ${X}, but its source set s1-src-i03 records ${srcHash(3)}$`));
    expect(runs.find((r) => r.id === "nat-s-i03")!.why).toEqual([problems[0]]);
    // Only the member that disagrees is named when the pair itself is split (the pairing check marks such a pair as well).
    const split = pairs((id) => (id === "shuf-s-i09" ? { branch: { sourceHash: X, boundary: 100 } } : {}));
    huntSourceProblems(split, srcSets(reg).accepted);
    expect(unresolved(split)).toEqual(["nat-s-i09", "shuf-s-i09"]);
    // A resolved -s history that records no branch has no source to compare: unresolved.
    const bare = pairs((id) => (id === "nat-s-i11" ? { branch: null } : {}));
    huntSourceProblems(bare, srcSets(reg).accepted);
    expect(unresolved(bare)).toEqual(["nat-s-i11", "shuf-s-i11"]);
    // An already unresolved history stays so, with its reasons as they were.
    const gone = pairs((id) => (id === "nat-s-i12" ? { resolved: false, why: ["no run bundle"], branch: null } : {}));
    huntSourceProblems(gone, srcSets(reg).accepted);
    expect(gone.find((r) => r.id === "nat-s-i12")!.why).toEqual(["no run bundle"]);
    expect(unresolved(gone)).toEqual(["nat-s-i12"]);
  });

  it("makes a pair unresolved when its source set is missing, rejected, or has the wrong hash at screening", () => {
    // Missing, and rejected for its provenance hash against the bundle the screen read: neither enters the sets.
    const runs = pairs();
    const sets = srcSets(reg, { omit: [2], hash: (i) => (i === 8 ? "wrong" : srcHash(i)) });
    expect(sets.rejected.map((r) => r.id)).toEqual(["s1-src-i08"]);
    const { problems } = huntSourceProblems(runs, sets.accepted);
    expect(unresolved(runs)).toEqual(["nat-s-i02", "shuf-s-i02", "nat-s-i08", "shuf-s-i08"]);
    expect(problems).toEqual(["-s index 02: its source set s1-src-i02 is missing or unresolved", "-s index 08: its source set s1-src-i08 is missing or unresolved"]);
    // Not only Improvement: a set missing for nobody else's index leaves every other pair resolved.
    expect(runs.filter((r) => r.resolved)).toHaveLength(44);
  });

  it("makes a pair unresolved when its source hash is another index's: the 24 sources are distinct", () => {
    const runs = pairs((id) => (/-i0[45]$/.test(id) ? { branch: { sourceHash: srcHash(4), boundary: 100 } } : {}));
    // The sets of indices 04 and 05 both record that one hash (a source assayed twice under two names), so each matches its pair: only the repeat is wrong.
    const sets = srcSets(reg, { hash: (i) => (i === 5 ? srcHash(4) : srcHash(i)), bundles: new Map([...s1Bundles()].map(([k, v]) => [k, /-s-i05$/.test(k) ? { ...v, branch: { sourceHash: srcHash(4), boundary: 100 } } : v])) });
    expect(sets.rejected).toEqual([]);
    const { problems } = huntSourceProblems(runs, sets.accepted);
    expect(unresolved(runs)).toEqual(["nat-s-i04", "shuf-s-i04", "nat-s-i05", "shuf-s-i05"]);
    expect(problems).toEqual([expect.stringMatching(new RegExp(`^-s index 04: branch\\.sourceHash ${srcHash(4)} is also the source of -s index 05: the 24 sources are distinct$`)), expect.stringMatching(/^-s index 05: .* is also the source of -s index 04/)]);
    // Three indices sharing one hash name both others; distinct hashes repeat nothing.
    const triple = pairs((id) => (/-i1[0-2]$/.test(id) ? { branch: { sourceHash: "same", boundary: 100 } } : {}));
    huntSourceProblems(triple, srcSets(reg, { hash: (i) => (i >= 10 && i <= 12 ? "same" : srcHash(i)), bundles: new Map() }).accepted);
    expect(unresolved(triple)).toEqual(range(3).flatMap((k) => [`nat-s-i${10 + k}`, `shuf-s-i${10 + k}`]));
  });

  it("makes every -s history unresolved when the 24 sources mix the registration's origin with the hunt's own", () => {
    const runs = [...pairs(), ...range(24).map((i) => scaffold(i))];
    const mixed = srcSets((i) => (i === 17 ? own(i) : reg(i)));
    expect(mixed.rejected).toEqual([]);
    const { origin, problems } = huntSourceProblems(runs, mixed.accepted);
    expect(origin).toBe("mixed");
    expect(unresolved(runs)).toHaveLength(48);
    expect(problems[0]).toMatch(/^the -s sources come from both origins \(i00 registration, .*, i17 own, .*\), but all 24 are chosen by one rule, with no mixing: every -s history is unresolved$/);
    expect(runs.find((r) => r.id === "nat-s-i00")!.why[0]).toMatch(/^-s index 00: the -s sources come from both origins/);
    // A source set rejected for another reason still shows where its source came from: 23 registration sets and one rejected set of the hunt's own origin is mixed.
    const lone = [...pairs(), ...range(24).map((i) => scaffold(i))];
    const rest = srcSets(reg, { omit: [9] });
    const stray = screen([setDir("s1-src-i09", { rows: swapFamilies, json: { provenance: { source: own(9), stateHash: srcHash(9) } } })], "s1", { bundles: s1Bundles() });
    expect(stray.rejected).toHaveLength(1);
    expect(stray.rejected[0]).toMatchObject({ reasons: [expect.stringMatching(/^2 fragments are not from family g mod m/)], source: own(9) });
    expect(huntSourceProblems(lone.map((r) => ({ ...r, why: [...r.why] })), rest.accepted).origin).toBe("registration");
    const lone2 = lone.map((r) => ({ ...r, why: [...r.why] }));
    expect(huntSourceProblems(lone2, rest.accepted, stray.rejected).origin).toBe("mixed");
    expect(unresolved(lone2)).toHaveLength(48);
    // Scaffold-phase runs are never histories: they stay as they were.
    expect(runs.filter((r) => r.kind === "scaffold").every((r) => r.resolved)).toBe(true);
  });

  it("lets only authenticated protocol members establish an origin: a smoke, foreign-seeded or unauthenticated source set, accepted or rejected, never mixes the sources", () => {
    const withStray = (stray: HuntSetDir, bundles = s1Bundles()) => {
      const rest = srcSets(reg, { omit: [9], bundles });
      const lone = screen([stray], "s1", { bundles });
      const runs = pairs();
      const found = huntSourceProblems(runs, [...rest.accepted, ...lone.accepted], lone.rejected);
      return { lone, runs, found };
    };
    const own9 = (json: Record<string, unknown> = {}, rows?: (r: HuntFragment[]) => HuntFragment[]) => setDir("s1-src-i09", { rows, json: { provenance: { source: own(9), stateHash: srcHash(9) }, ...json } });
    // The control case: a member of the protocol (strict, its seeds and regime, its hash backed by the -s histories' manifests), rejected for its rows alone, does establish the
    // other origin: mixed.
    const member = withStray(own9({}, swapFamilies));
    expect(member.lone.rejected[0].source).toBe(own(9));
    expect(member.found.origin).toBe("mixed");
    expect(unresolved(member.runs)).toHaveLength(48);
    // A smoke test's waiver (a rejected set from the other origin), foreign seeds, another regime, a hash that is not the pair's: none establishes an origin, so the 23 sources of the
    // registration stay uniform. Only index 09's own pair is unresolved (its source set is not a member).
    for (const [what, stray] of [["a smoke test's waiver", own9({ allowAnySeed: true })], ["another set's seeds", own9({ seeds: huntExpectedSet("s1-src-i10")!.seeds })], ["another regime", own9({ k: 5 })], ["another hash", own9({ provenance: { source: own(9), stateHash: "not-the-pair's" } })]] as const) {
      const r = withStray(stray);
      expect(r.lone.accepted, what).toEqual([]);
      expect(r.lone.rejected[0].source, what).toBeUndefined();
      expect(r.found.origin, what).toBe("registration");
      expect(unresolved(r.runs), what).toEqual(["nat-s-i09", "shuf-s-i09"]);
    }
    // No bundle backs the set's hash (the -s histories' bundles are unresolved or not given): it is not authenticated, rejected or accepted, and establishes nothing.
    const none = (bundles: Map<string, ScreenBundle>) => withStray(own9({}, swapFamilies), bundles);
    const unresolvedPair = s1Bundles({ bad: ["nat-s-i09", "shuf-s-i09"] });
    expect(none(unresolvedPair).lone.rejected[0].source).toBeUndefined();
    expect(none(unresolvedPair).found.origin).toBe("registration");
    expect(none(s1Bundles({ omit: ["nat-s-i09", "shuf-s-i09"] })).found.origin).toBe("registration");
    const accepted = screen([own9()], "s1", { bundles: unresolvedPair });
    expect(accepted.rejected).toEqual([]);
    expect(accepted.accepted[0]).toMatchObject({ authenticated: false });
    expect(huntSourceProblems(pairs(), [...srcSets(reg, { omit: [9] }).accepted, ...accepted.accepted]).origin).toBe("registration");
    // Authenticated by the hunt's own scaffold-phase bundle (resolved, its b100-pre the set's hash) instead of the -s histories': a member as well.
    const bundles = s1Bundles({ bad: ["nat-s-i09", "shuf-s-i09"] });
    bundles.set("scaffold-i09", { resolved: true, hashes: { 100: srcHash(9) }, branch: null, ponds: null });
    const viaScaffold = screen([own9()], "s1", { bundles });
    expect(viaScaffold.accepted[0]).toMatchObject({ authenticated: true });
    expect(huntSourceProblems(pairs(), [...srcSets(reg, { omit: [9] }).accepted, ...viaScaffold.accepted]).origin).toBe("mixed");
    // A smoke run (--allow-any-seed) does not authenticate: its accepted sets are read as they stand (authenticated null), and a rejected one keeps no path.
    const smoke = screen([own9({}), setDir("s1-src-i10", { rows: swapFamilies, json: { provenance: { source: own(10), stateHash: srcHash(10) } } })], "s1", { allowAnySeed: true });
    expect(smoke.accepted[0].authenticated).toBeNull();
    expect(smoke.rejected[0].source).toBeUndefined();
    // Two copies of an authenticated own-origin set (duplicates) keep their path, and so do count.
    const dup = screen([own9(), { ...own9(), dir: "/sets/copy" }], "s1", { bundles: s1Bundles() });
    expect(dup.rejected.map((r) => r.source)).toEqual([own(9), own(9)]);
  });

  it("uses the hunt's own scaffold sources only when their bundles are found and resolved", () => {
    const sets = srcSets(own).accepted;
    // Not given at all: every -s pair is unresolved, and the report says where to find them.
    const none = pairs();
    huntSourceProblems(none, sets);
    expect(unresolved(none)).toHaveLength(48);
    expect(none[0].why[0]).toBe("-s index 00: the hunt's own scaffold source scaffold-i00 is not found (give the scaffold-phase bundles with --runs)");
    // One unresolved, one missing: only those pairs.
    const some = [...pairs(), ...range(24).filter((i) => i !== 4).map((i) => scaffold(i, i === 6 ? { resolved: false, why: ["the run did not finish"] } : {}))];
    const { problems } = huntSourceProblems(some, sets);
    expect(unresolved(some.filter((r) => r.kind === "history"))).toEqual(["nat-s-i04", "shuf-s-i04", "nat-s-i06", "shuf-s-i06"]);
    expect(problems).toEqual(["-s index 04: the hunt's own scaffold source scaffold-i04 is not found (give the scaffold-phase bundles with --runs)", "-s index 06: the hunt's own scaffold source scaffold-i06 is unresolved (the run did not finish)"]);
    // Under the registration's origin the scaffold-phase bundles are not read at all.
    const reg1 = pairs();
    huntSourceProblems(reg1, srcSets(reg).accepted);
    expect(unresolved(reg1)).toEqual([]);
    // The screen compares a source set with the scaffold bundle it came from, once that bundle is resolved: its b100-pre hash.
    const bundles = s1Bundles();
    bundles.set("scaffold-i02", { resolved: true, hashes: { 100: "not-the-set's" }, branch: null, ponds: null });
    const r = screen([setDir("s1-src-i02", { json: { provenance: { source: own(2), stateHash: srcHash(2) } } })], "s1", { bundles });
    expect(r.rejected[0].reasons.join("\n")).toMatch(new RegExp(`provenance\\.stateHash ${srcHash(2)} is not scaffold-i02's b100-pre hash not-the-set's in its manifest`));
  });

  it("reads the hunt's own scaffold phase as a run: treatment from the preset's scaf arm, seed 4,901,501 + i", async () => {
    const read = (m: unknown, dir?: string) => {
      const r = huntRoleOf(m);
      expect("role" in r).toBe(true);
      return huntBundleProblems(m, (r as any).role, { pondDeath: HUNT_DEATH.base, dir });
    };
    for (const i of [0, 7, 23]) {
      const m = manifest("scaffold", { i });
      expect(huntRoleOf(m)).toEqual({ role: { kind: "scaffold", id: `scaffold-i${NN(i)}`, seed: 4_901_501 + i, arm: "scaf", index: i } });
      expect(read(m)).toEqual([]);
      expect(read(m, `/runs/scaffold/hunt1/scaf/${m.runId}`)).toEqual([]);
    }
    // The pond arm is the preset's scaf (a cont arm is no treatment run), no pondDeath or pondExport is set, and it is a run from the preset like any other.
    const m = (over: Record<string, unknown>) => manifest("scaffold", { i: 7, over });
    expect(read(m({ cfg: { ...manifest("scaffold").cfg, pondArm: "cont" } })).join("\n")).toMatch(/cfg\.pondArm "cont", want "scaf"/);
    expect(read(m({ cfg: { ...manifest("scaffold").cfg, pondArm: "nat", pondDeath: 32_768, pondExport: 28 } })).join("\n")).toMatch(/cfg\.pondArm "nat", want "scaf"/);
    expect(read(m({ spec: { ...manifest("scaffold").spec, condition: "pond-cont" } })).join("\n")).toMatch(/spec\.condition "pond-cont", want "treatment"/);
    expect(read(m({ spec: { ...manifest("scaffold").spec, steps: 340_000 } })).join("\n")).toMatch(/spec\.steps 340000, want 1000000/);
    expect(read(m({ initHash: undefined }))).toEqual([expect.stringMatching(/no initHash/)]);
    expect(read(m({ startStep: 10_000 })).join("\n")).toMatch(/startStep 10000, want 0/);
    expect(read(m({ branch: { source: "s", sourceHash: "h", postHash: "p", boundary: 100 } })).join("\n")).toMatch(/has a branch, but this run starts from the preset/);
    expect(read(m({ preCycleCheckpoints: [] })).join("\n")).toMatch(/no preCycleCheckpoints entry for boundary 100 at step 1000000 in checkpoints\/b100-pre\.blck/);
    // It is among the runs the report expects, found by its seed and resolved like a history.
    const expected = huntExpectedRuns("scaffold");
    expect(expected).toHaveLength(24);
    expect(expected[7]).toEqual({ id: "scaffold-i07", kind: "scaffold", arm: "scaf", seed: 4_901_508, index: 7 });
    const found = await huntResolveRuns([{ dir: "/r/scaf/scaffold/ponds/treatment/seed-4901508", manifest: manifest("scaffold", { i: 7 }) }, { dir: "/r/x", manifest: manifest("scaffold", { i: 9, over: { cfg: { ...manifest("scaffold").cfg, pondArm: "cont" } } }) }], expected, { pondDeath: HUNT_DEATH.base, checkpointSize: filesPresent, readPonds: async () => ({ problems: [], summary: null }) });
    expect(found.runs[7]).toMatchObject({ id: "scaffold-i07", resolved: true, why: [], hashes: { 100: hashOf("scaffold", { i: 7 }, 100) } });
    expect(found.runs[9]).toMatchObject({ resolved: false });
    expect(found.runs[9].why.join("\n")).toMatch(/cfg\.pondArm "cont", want "scaf"/);
    expect(found.runs[0]).toMatchObject({ resolved: false, why: ["no run bundle"] });
    expect(found.others).toEqual([]);
  });

  it("takes D3's worlds as the experiment d3 or its census-100 rerun d3-c100, one finished bundle of the two", async () => {
    const world = (experiment: string, over: Record<string, unknown> = {}) => {
      const base = manifest("d3", { arm: "nat", i: 1 });
      const m = { ...base, runId: `${experiment}/ponds/pond-nat/seed-4900402`, spec: { ...base.spec, experiment }, ...over };
      return { dir: `/runs/hunt1/${m.runId}`, manifest: m };
    };
    const unfinished = (b: ReturnType<typeof world>) => ({ ...b, manifest: { ...b.manifest, summary: undefined, finishedAt: undefined } });
    const expected = huntExpectedRuns("d3").filter((r) => r.id === "d3-nat-j1");
    const readPonds = async (dir: string, e: HuntPondsExpect) => summaryOf(pondsLines(boundariesOf(e.first, e.last), scenario(e.arm)), e);
    const resolve = (bundles: ReturnType<typeof world>[]) => huntResolveRuns(bundles, expected, { pondDeath: HUNT_DEATH.base, checkpointSize: filesPresent, readPonds });
    // Either name is accepted, alone: the rerun's directory carries its own runId.
    expect((await resolve([world("d3")])).runs[0]).toMatchObject({ resolved: true });
    expect((await resolve([world("d3-c100")])).runs[0]).toMatchObject({ resolved: true });
    // The census-1000 run overflowed (unfinished), its rerun finished: the rerun is the world, the other is listed as superseded.
    const picked = await resolve([unfinished(world("d3")), world("d3-c100")]);
    expect(picked.runs[0]).toMatchObject({ resolved: true, dir: "/runs/hunt1/d3-c100/ponds/pond-nat/seed-4900402" });
    expect(picked.others).toEqual([{ dir: "/runs/hunt1/d3/ponds/pond-nat/seed-4900402", why: "an unfinished run of d3-nat-j1, superseded by the finished /runs/hunt1/d3-c100/ponds/pond-nat/seed-4900402" }]);
    // Both finished: neither is used, as the assay refuses the pair (hunt1BundleProblems: ambiguous).
    const both = await resolve([world("d3"), world("d3-c100")]);
    expect(both.runs[0]).toMatchObject({ resolved: false });
    expect(both.runs[0].why[0]).toMatch(/^2 finished run bundles \(.*d3\/ponds.*d3-c100\/ponds.*\); neither is used$/);
    // Any other experiment is not D3's: the assay refuses it, and so does the report.
    for (const experiment of ["hist", "d3-c200", "d3x"]) {
      const r = await resolve([world(experiment)]);
      expect(r.runs[0].resolved, experiment).toBe(false);
      expect(r.runs[0].why.join("\n"), experiment).toMatch(/spec\.experiment "[\w-]+", want "d3" or "d3-c100"/);
    }
  });
});

// =============================================================================================

describe("the CLI end to end (a real deno run over fixture directories)", () => {
  const report = (...args: string[]): Record<string, any> => JSON.parse(execFileSync("deno", ["run", "-A", REPORT, ...args], { stdio: "pipe", encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
  const write = (dir: string, files: Record<string, string>) => {
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  };
  const tsvOf = (rows: HuntFragment[]) => {
    const cols = ["assay", "source", "replicate", "pond", "family", "inoculum", "reqMass", "retMass", "endTrait", "success", "reqE", "retE", "truncated", "exportMass"];
    return [cols.join("\t"), ...rows.map((r) => [r.assay, "src", r.replicate, r.pond, r.family, r.inoculum, 0, r.retMass, r.endTrait, r.success, 0, r.retE ?? "", 0, r.exportMass].join("\t"))].join("\n") + "\n";
  };

  /** A scratch tree: G1 (four bundles), D3 (eight bundles and sets) and G2 (18 sets), as the CLI reads them. */
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "hunt0-"));
    const bundle = (base: string, kind: ManifestKind, o: Parameters<typeof manifest>[1], lines: string[]) => {
      const m = manifest(kind, o);
      write(join(root, base, m.runId), { "manifest.json": JSON.stringify(m), "ponds.tsv": lines.join("\n") + "\n" });
      return m;
    };
    for (const arm of ["nat", "shuf"] as const) {
      for (const s of [0, 1]) bundle("g1", "g1", { arm, i: s }, pondsLines(boundariesOf(1, 30), scenario(arm)));
      for (let j = 0; j < 4; j++) bundle("d3", "d3", { arm, i: j }, pondsLines(boundariesOf(1, 30), scenario(arm)));
    }
    const sets = (dir: string, dirs: HuntSetDir[]) => {
      for (const d of dirs) write(join(root, dir, (d.json.labels as any).set), { "assay.json": JSON.stringify(d.json), "assay.tsv": tsvOf(d.rows) });
    };
    const g2: HuntSetDir[] = [];
    for (let i = 0; i < 6; i++) g2.push(setDir(`g2-scaf-i${i}`, { x: () => 900 }), setDir(`g2-rand-i${i}`, { x: () => 100 }), setDir(`g2-scaf-i${i}-quench`, { x: () => 0, trait: () => 100 }));
    sets("g2", g2);
    const d3: HuntSetDir[] = [];
    for (const arm of ["nat", "shuf"] as const) {
      for (let j = 0; j < 4; j++) {
        const id = `d3-${arm}-j${j}`;
        d3.push(setDir(id, { x: () => (arm === "nat" ? 800 : 600) + 10 * j, json: { provenance: { stateHash: hashOf("d3", { arm, i: j }, 30) } } }));
      }
    }
    sets("d3", d3);
    return root;
  }

  it("hunt0: G1 and G2 pass, D3 is described, and the JSON has the documented keys with no NaN", () => {
    const root = fixture();
    try {
      const out = report("hunt0", "--g1", join(root, "g1"), join(root, "d3"), "--g2", join(root, "g2"), "--d3-runs", join(root, "d3"), "--d3", join(root, "d3"), "--pond-death", "32768");
      expect(Object.keys(out)).toEqual(["stage", "protocolSha256Hunt1", "protocolNow", "validated", "outcome", "row", "reasons", "pondDeath", "g1", "g2", "d3", "rejected", "skipped"]);
      expect(out).toMatchObject({ stage: "hunt0", protocolSha256Hunt1: HUNT1_PROTOCOL.sha256, validated: true, outcome: "Stage 0 passed", pondDeath: 32_768, row: null });
      expect(out.protocolNow).toMatchObject({ doc: "docs/scaffold-transition-hunt-v1.md", pinnedTextIntact: true });
      expect(out.g1).toMatchObject({ given: true, decision: "pass", pondDeath: 32_768, fallbackUsed: false, fallback: null });
      expect(out.g1.base.runs).toHaveLength(4);
      expect(out.g1.base.runs[0]).toMatchObject({ id: "g1-nat-s0", resolved: true, viable: true, strength: true });
      expect(out.g2).toMatchObject({ given: true, decision: "pass", wins: 6 });
      expect(out.d3).toMatchObject({ given: true, pondDeath: 32_768, differences: [200, 200, 200, 200], positive: 4 });
      expect(out.d3.natSpread).toMatchObject({ n: 4, min: 800, max: 830 });
      expect(out.rejected).toEqual([]);
      // The d3 bundles are not G1's, and the sets of one stage are not another's: listed under skipped, not an error.
      expect(out.skipped.filter((s: any) => /^d3-(nat|shuf)-j\d \(d3\) is not one of the runs this stage reads$/.test(s.why))).toHaveLength(8);
      expect(out.skipped.filter((s: any) => /^a "d3" set: this stage reads d3 sets$/.test(s.why))).toHaveLength(0);
      expect(JSON.stringify(out)).not.toMatch(/NaN|Infinity/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("hunt0: a G1 that needs its fallback waits until it is given, then continues at e = 1; G2 failing stops the hunt", () => {
    const root = fixture();
    try {
      // Make nat s1 not viable (traits too small to recolonise) by rewriting its bundle.
      const m = manifest("g1", { arm: "nat", i: 1 });
      write(join(root, "g1", m.runId), { "ponds.tsv": pondsLines(boundariesOf(1, 30), scenario("nat", { trait: () => 20_000 })).join("\n") + "\n" });
      const waiting = report("hunt0", "--g1", join(root, "g1"));
      expect(waiting).toMatchObject({ outcome: "pending", pondDeath: null, g1: { decision: "pending" } });
      // The fallback runs (seeds 4,900,101 + ...) at e = 1.
      for (const arm of ["nat", "shuf"] as const) for (const s of [0, 1]) {
        const f = manifest("g1f", { arm, i: s });
        write(join(root, "g1f", f.runId), { "manifest.json": JSON.stringify(f), "ponds.tsv": pondsLines(boundariesOf(1, 30), scenario(arm)).join("\n") + "\n" });
      }
      const passed = report("hunt0", "--g1", join(root, "g1"), "--g1-fallback", join(root, "g1f"), "--g2", join(root, "g2"));
      expect(passed).toMatchObject({ outcome: "Stage 0 passed", pondDeath: 65_536, g1: { decision: "pass-fallback", fallbackUsed: true } });
      // D3 then needs the override (pondDeath 65,536): the bundles written at e = 1/2 are refused with it.
      const refused = report("hunt0", "--g1", join(root, "g1"), "--g1-fallback", join(root, "g1f"), "--d3-runs", join(root, "d3"), "--pond-death", "65536");
      expect(refused.d3.runs.every((r: any) => !r.resolved)).toBe(true);
      expect(refused.d3.runs[0].why.join("\n")).toMatch(/spec\.overrides \{"mutRate":0\}, want \{"mutRate":0,"pondDeath":65536\}/);
      // G2 lost one comparison too many: the hunt stops (with D3 left alone).
      const g2dir = join(root, "g2", "g2-scaf-i0");
      const bad = setDir("g2-scaf-i0", { x: () => 50 });
      write(g2dir, { "assay.json": JSON.stringify(bad.json), "assay.tsv": tsvOf(bad.rows) });
      const g2bad = setDir("g2-scaf-i1", { x: () => 50 });
      write(join(root, "g2", "g2-scaf-i1"), { "assay.json": JSON.stringify(g2bad.json), "assay.tsv": tsvOf(g2bad.rows) });
      const stopped = report("hunt0", "--g1", join(root, "g1"), "--g1-fallback", join(root, "g1f"), "--g2", join(root, "g2"));
      expect(stopped).toMatchObject({ outcome: "Stopped at Stage 0", row: { outcome: "Stopped at Stage 0" }, g2: { decision: "fail", wins: 4 } });
      expect(stopped.reasons[0]).toMatch(/^G2 failed: W\(scaf i\) > W\(rand i\) fails for 2 of 6 indices/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("hunt0: a G2 quenched control rejected at screening whose rows show it is not dead stops the hunt, listed with why", () => {
    const root = fixture();
    try {
      // g2-scaf-i3's quenched control has 4 of 64 fragments exporting but two fragments from the wrong families: rejected, yet it is the hunt's own set, so it counts.
      const bad = setDir("g2-scaf-i3-quench", { x: (g) => (g < 4 ? 500 : 0), trait: (g, x) => x + 100, rows: swapFamilies });
      write(join(root, "g2", "g2-scaf-i3-quench"), { "assay.json": JSON.stringify(bad.json), "assay.tsv": tsvOf(bad.rows) });
      const out = report("hunt0", "--g1", join(root, "g1"), "--g2", join(root, "g2"));
      expect(out).toMatchObject({ outcome: "Stopped at Stage 0", g2: { decision: "fail", wins: 6 } });
      expect(out.reasons[0]).toBe(`G2 failed: the quenched control g2-scaf-i3-quench has X_f > 0 in 4 of 64 fragments, above 5% (the set was rejected at screening: ${SWAPPED})`);
      expect(out.g2.quenched[6]).toMatchObject({ id: "g2-scaf-i3-quench", successes: 4, above: true, rejected: [SWAPPED] });
      expect(out.rejected.find((r: any) => r.id === "g2-scaf-i3-quench")).toMatchObject({ quench: { successes: 4, n: 64, above: true } });
      // 3 of 64 does not fail it: G2 waits (the set is unresolved), and nothing passes on it.
      const three = setDir("g2-scaf-i3-quench", { x: (g) => (g < 3 ? 500 : 0), trait: (g, x) => x + 100, rows: swapFamilies });
      write(join(root, "g2", "g2-scaf-i3-quench"), { "assay.json": JSON.stringify(three.json), "assay.tsv": tsvOf(three.rows) });
      expect(report("hunt0", "--g1", join(root, "g1"), "--g2", join(root, "g2"))).toMatchObject({ outcome: "pending", g2: { decision: "pending" } });
      // A smoke control (it records the waiver) with 4 of 64 exporting is not the hunt's: it does not stop G2, which waits for the real one.
      const smoke = setDir("g2-scaf-i3-quench", { x: (g) => (g < 4 ? 500 : 0), trait: (g, x) => x + 100, json: { allowAnySeed: true } });
      write(join(root, "g2", "g2-scaf-i3-quench"), { "assay.json": JSON.stringify(smoke.json), "assay.tsv": tsvOf(smoke.rows) });
      const waived = report("hunt0", "--g1", join(root, "g1"), "--g2", join(root, "g2"));
      expect(waived).toMatchObject({ outcome: "pending", g2: { decision: "pending" } });
      expect(waived.rejected.find((r: any) => r.id === "g2-scaf-i3-quench").quench).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("hunt0: refuses a ponds.tsv that breaks a sentinel, listing why, and rejects a set it cannot read", () => {
    const root = fixture();
    try {
      const m = manifest("g1", { arm: "nat", i: 0 });
      write(join(root, "g1", m.runId), { "ponds.tsv": pondsLines(boundariesOf(1, 30), scenario("nat"), { mutate: (b, p, c) => { if (b === 5 && p === 0) c.donor = 3; } }).join("\n") + "\n" });
      write(join(root, "g2", "g2-scaf-i3"), { "assay.json": JSON.stringify(setDir("g2-scaf-i3").json), "assay.tsv": "assay\treplicate\nexport\t0\n" });
      const out = report("hunt0", "--g1", join(root, "g1"), "--g2", join(root, "g2"));
      expect(out.g1.decision).toBe("pending");
      const run = out.g1.base.runs.find((r: any) => r.id === "g1-nat-s0");
      expect(run).toMatchObject({ resolved: false });
      expect(run.why.join("\n")).toMatch(/ponds\.tsv: boundary 5, pond 0: survivor \(died 0\) with donor 3, want -2/);
      expect(out.g2.decision).toBe("pending");
      expect(out.rejected.some((r: any) => r.id === "g2-scaf-i3" && /could not read the set/.test(r.reasons[0]))).toBe(true);
      // No flag at all is a usage error.
      expect(() => report("hunt0")).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("names e explicitly: hunt1 needs --pond-death (no default), hunt0 needs it with --d3 or --d3-runs, and G1's own pairs are 32,768 and 65,536 whatever it says", () => {
    const root = fixture();
    try {
      // hunt1 strict: no flag is a usage error, with or without the rest of what the stage needs; --allow-any-seed (smoke) keeps the default.
      expect(() => report("hunt1", "--budget-stopped")).toThrow(/hunt1 needs --pond-death 32768\|65536, the e the histories ran at \(65536 only if G1's e = 1 fallback passed\): it has no default/);
      expect(() => report("hunt1", "--assays", root, "--runs", root, "--device", root, "--repro", root, "--queue", join(root, "none.json"))).toThrow(/hunt1 needs --pond-death/);
      expect(() => report("hunt1", "--budget-stopped", "--pond-death", "40000")).toThrow(/--pond-death must be 32768 or 65536/);
      expect(report("hunt1", "--budget-stopped", "--pond-death", "65536")).toMatchObject({ pondDeath: 65_536 });
      expect(report("hunt1", "--budget-stopped", "--allow-any-seed")).toMatchObject({ pondDeath: 32_768, validated: false });
      // hunt0: the e of D3 is named whenever D3's bundles or sets are given, and only then.
      for (const d3 of [["--d3-runs"], ["--d3"], ["--d3-runs", "--d3"]]) {
        const args = ["hunt0", "--g1", join(root, "g1"), ...d3.flatMap((f) => [f, join(root, "d3")])];
        expect(() => report(...args), d3.join(" ")).toThrow(/hunt0 --d3-runs \/ --d3 need --pond-death 32768\|65536, the e D3 ran at \(65536 only if G1's e = 1 fallback passed\)/);
      }
      expect(report("hunt0", "--g1", join(root, "g1"), "--g2", join(root, "g2"))).toMatchObject({ outcome: "Stage 0 passed", pondDeath: 32_768 });
      // G1's pairs are the base (32,768) and the fallback (65,536) pair whatever --pond-death says: it names D3's e only.
      for (const arm of ["nat", "shuf"] as const) for (const s of [0, 1]) {
        const f = manifest("g1f", { arm, i: s });
        write(join(root, "g1f", f.runId), { "manifest.json": JSON.stringify(f), "ponds.tsv": pondsLines(boundariesOf(1, 30), scenario(arm)).join("\n") + "\n" });
      }
      const out = report("hunt0", "--g1", join(root, "g1"), "--g1-fallback", join(root, "g1f"), "--d3-runs", join(root, "d3"), "--pond-death", "65536");
      expect(out.g1.base.runs.every((r: any) => r.resolved)).toBe(true);
      expect(out.g1.fallback.runs.every((r: any) => r.resolved)).toBe(true);
      expect(out.g1).toMatchObject({ decision: "pass", pondDeath: 32_768, fallbackUsed: false });
      // D3's bundles were written at e = 1/2: read at 65,536 they are refused, as the flag says; at 32,768 they pass.
      expect(out.d3).toMatchObject({ given: true, pondDeath: 65_536 });
      expect(out.d3.runs.every((r: any) => !r.resolved)).toBe(true);
      expect(out.d3.runs[0].why.join("\n")).toMatch(/spec\.overrides \{"mutRate":0\}, want \{"mutRate":0,"pondDeath":65536\}/);
      const base = report("hunt0", "--g1", join(root, "g1"), "--d3-runs", join(root, "d3"), "--pond-death", "32768");
      expect(base.d3).toMatchObject({ pondDeath: 32_768 });
      expect(base.d3.runs.every((r: any) => r.resolved)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("hunt1: analyses nothing under --budget-stopped or an incomplete queue; needs a queue unless smoke-testing", () => {
    const root = mkdtempSync(join(tmpdir(), "hunt1-"));
    try {
      write(root, { "queue.json": JSON.stringify({ commands: [{ id: "a", instance: 1 }, { id: "b", instance: 2 }] }), "status1.json": JSON.stringify({ instance: 1, commands: { a: "done" } }) });
      const stop = report("hunt1", "--budget-stopped", "--pond-death", "32768");
      expect(stop).toMatchObject({ stage: "hunt1", protocolSha256Hunt1: HUNT1_PROTOCOL.sha256, validated: true, outcome: "Uninformative", budgetStopped: true, withheld: true, pondDeath: 32_768 });
      expect(Object.keys(stop)).toEqual(["stage", "protocolSha256Hunt1", "protocolNow", "validated", "outcome", "row", "pondDeath", "reasons", "budgetStopped", "withheld", "withheldReason", "contrasts", "definitions", "queue", "validity", "primary", "secondary", "availability", "descriptive", "rejected", "skipped"]);
      const inc = report("hunt1", "--queue", join(root, "queue.json"), "--status", join(root, "status1.json"), "--pond-death", "65536");
      expect(inc).toMatchObject({ outcome: "incomplete", row: null, withheld: true, pondDeath: 65_536, queue: { complete: false, commands: 2, done: 1, pending: ["b"] } });
      // With a device check given and failed (no bundles: the Mac's and the instances' are needed), the incomplete queue and the budget stop are Invalid, the analysis withheld.
      mkdirSync(join(root, "empty"));
      const invInc = report("hunt1", "--queue", join(root, "queue.json"), "--status", join(root, "status1.json"), "--pond-death", "32768", "--device", join(root, "empty"));
      expect(invInc).toMatchObject({ outcome: "Invalid", row: { outcome: "Invalid" }, withheld: true, primary: null, queue: { complete: false } });
      expect(invInc.reasons[0]).toMatch(/^device check failed: /);
      expect(report("hunt1", "--budget-stopped", "--pond-death", "32768", "--device", join(root, "empty"))).toMatchObject({ outcome: "Invalid", budgetStopped: true, withheld: true });
      expect(() => report("hunt1", "--assays", root)).toThrow();
      expect(() => report("hunt1", "--budget-stopped", "--pond-death", "5")).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("hunt1: with a complete queue and nothing else, the histories are unresolved and the outcome is Invalid or Uninformative, never a test", () => {
    const root = mkdtempSync(join(tmpdir(), "hunt1-"));
    try {
      write(root, { "queue.json": JSON.stringify({ commands: [{ id: "a", instance: 1 }] }), "status1.json": JSON.stringify({ instance: 1, commands: { a: "done" } }) });
      mkdirSync(join(root, "empty"));
      const out = report("hunt1", "--assays", join(root, "empty"), "--runs", join(root, "empty"), "--device", join(root, "empty"), "--repro", join(root, "empty"), "--queue", join(root, "queue.json"), "--status", join(root, "status1.json"), "--pond-death", "32768");
      expect(out).toMatchObject({ outcome: "Invalid", withheld: true, primary: null, secondary: null, contrasts: null });
      expect(out.validity.device.passed).toBe(false);
      expect(out.validity.reproducibility.passed).toBe(false);
      expect(out.validity.unresolved.uninformative).toBe(true);
      expect(out.availability).toMatchObject({ expected: 269, measured: 0, unresolved: 269 });
      expect(out.skipped.some((s: any) => /no run bundle \(manifest\.json\) under it/.test(s.why))).toBe(true);
      expect(JSON.stringify(out)).not.toMatch(/NaN/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  /**
   * A scratch tree for `hunt1`: three histories with their sets (nat-a i0, and shuf-a i4 and shuf-s i13, the two the reproducibility draw selects), ancestor world 0, the
   * Mac's reruns of the two selected, and the device checks. Every pre-cycle checkpoint file a history was queued to write exists (b200 and the nat history's b034 as
   * non-empty stand-ins, as only their existence is read); the two selected histories' b034 / b134 are real checkpoints of one state, decoded by the report, as are the
   * reruns'. `o` damages one of them: the file of a rerun (missing, corrupt, or a different state than its manifest hashes), or a history's b200 (missing, empty).
   */
  function hunt1Full(o: { rerun?: "missing" | "corrupt" | "other" | "absent"; b200?: "missing" | "empty"; instance?: "missing" | "corrupt" } = {}) {
    const root = mkdtempSync(join(tmpdir(), "hunt1-full-"));
    const state = buildWorld(pondConfig(2, 7, 0), { nutrient: 32, founders: [] });
    const other = buildWorld(pondConfig(2, 8, 0), { nutrient: 32, founders: [] });
    const H = stateHash(state);
    const bundle = (base: string, m: Record<string, any>, lines: string[]) => write(join(root, base, m.runId), { "manifest.json": JSON.stringify(m), "ponds.tsv": lines.join("\n") + "\n" });
    /** The checkpoint files of a bundle: the real state at `real` (its manifest records H), a stand-in at every other boundary listed. */
    const checkpoints = (dir: string, m: Record<string, any>, real: number | null, held: { file?: Uint8Array | null; skip?: number; empty?: number } = {}) => {
      m.preCycleCheckpoints = m.preCycleCheckpoints.map((e: any) => (e.boundary === real ? { ...e, hash: H } : e));
      mkdirSync(join(dir, "checkpoints"), { recursive: true });
      for (const e of m.preCycleCheckpoints) {
        const path = join(dir, e.file);
        if (e.boundary === held.skip) continue;
        if (e.boundary === held.empty) writeFileSync(path, new Uint8Array(0));
        else if (e.boundary === real) {
          if (held.file !== null) writeFileSync(path, held.file ?? encodeCheckpoint(state, { ponds: { lastCycle: e.boundary - 1 } }));
        } else writeFileSync(path, "stand-in");
      }
    };
    const histories: [HuntArm, number, number, number | null][] = [["nat-a", 0, 1, null], ["shuf-a", 4, 1, 34], ["shuf-s", 13, 100, 134]];
    for (const [histArm, i, first, real] of histories) {
      const arm = histArm.startsWith("nat") ? "nat" : "shuf";
      const m = manifest("history", { histArm, i });
      const damaged = histArm === "shuf-s";
      checkpoints(join(root, "hist", m.runId), m, real, { skip: damaged && o.b200 === "missing" ? 200 : undefined, empty: damaged && o.b200 === "empty" ? 200 : undefined, file: damaged && o.instance === "missing" ? null : damaged && o.instance === "corrupt" ? new TextEncoder().encode("not a checkpoint") : undefined });
      bundle("hist", m, pondsLines(boundariesOf(first, 200), scenario(arm)));
    }
    // Ancestor world 0, whose b001-pre the genome-only sets plant (a genome-only set is unresolved without it).
    bundle("hist", manifest("ancestor", { i: 0 }), []);
    // The Mac's reruns, with the instances' own b034 / b134 state (its hash in their manifests, the file decoded).
    for (const [histArm, i, b] of [["shuf-s", 13, 134], ["shuf-a", 4, 34]] as const) {
      if (o.rerun === "absent") break;
      const m = manifest("repro", { histArm, i });
      const damaged = histArm === "shuf-s" ? o.rerun : undefined;
      checkpoints(join(root, "repro", m.runId), m, b, { file: damaged === "missing" ? null : damaged === "corrupt" ? new TextEncoder().encode("not a checkpoint") : damaged === "other" ? encodeCheckpoint(other, { ponds: { lastCycle: b - 1 } }) : undefined });
      write(join(root, "repro", m.runId), { "manifest.json": JSON.stringify(m) });
    }
    for (const [k, host] of [["mac", HOSTS.mac], ["i1", HOSTS[1]], ["i2", HOSTS[2]], ["i3", HOSTS[3]]] as const) {
      const m: Record<string, any> = { ...manifest("device"), host };
      write(join(root, "device", k, m.runId), { "manifest.json": JSON.stringify(m) });
    }
    const sets = (dirs: HuntSetDir[]) => {
      for (const d of dirs) write(join(root, "sets", (d.json.labels as any).set), { "assay.json": JSON.stringify(d.json), "assay.tsv": tsvOf(d.rows) });
    };
    sets([
      setDir("s1-nat-a-i00", { x: () => 900, json: { provenance: { stateHash: hashOf("history", { histArm: "nat-a", i: 0 }, 200) } } }),
      setDir("s1-nat-a-i00-quench", { x: () => 0, trait: () => 100, json: { provenance: { stateHash: hashOf("history", { histArm: "nat-a", i: 0 }, 200) } } }),
      setDir("s1-nat-a-i00-genome", { x: () => 300, json: { provenance: { stateHash: hashOf("ancestor", { i: 0 }, 1), donor: { stateHash: hashOf("history", { histArm: "nat-a", i: 0 }, 200), dominant: { hi: 1, lo: 2 } } } } }),
      setDir("s1-shuf-a-i04", { x: () => 100, json: { provenance: { stateHash: hashOf("history", { histArm: "shuf-a", i: 4 }, 200) } } }),
      setDir("s1-shuf-s-i13", { x: () => 100, json: { provenance: { stateHash: "wrong" } } }),
      // The source set of the -s pair of index 13: the hash its histories' manifests record (`manifest` branches from HASH("src13", "b100")).
      setDir("s1-src-i13", { x: () => 100, json: { provenance: { ...provenanceOf("s1-src-i13"), stateHash: HASH("src13", "b100") } } }),
      setDir("g2-scaf-i0", { x: () => 100 }),
    ]);
    write(root, { "queue.json": JSON.stringify({ commands: [{ id: "a", instance: 1 }, { id: "b", instance: 2 }, { id: "c", instance: 3 }] }), "s1.json": JSON.stringify({ instance: 1, commands: { a: "done" } }), "s2.json": JSON.stringify({ instance: 2, commands: { b: "fail" } }), "s3.json": JSON.stringify({ instance: 3, commands: { c: "done" } }) });
    const out = report("hunt1", "--assays", join(root, "sets"), "--runs", join(root, "hist"), "--device", ...["mac", "i1", "i2", "i3"].map((k) => join(root, "device", k)), "--repro", join(root, "repro"), "--queue", join(root, "queue.json"), "--status", join(root, "s1.json"), join(root, "s2.json"), join(root, "s3.json"), "--pond-death", "32768");
    return { root, out, H };
  }

  it("hunt1: reads histories, sets, the device check and the reproducibility reruns (decoding their checkpoints) from disk, and is Uninformative with most histories missing", () => {
    const { root, out } = hunt1Full();
    try {
      expect(out).toMatchObject({ outcome: "Uninformative", withheld: true, pondDeath: 32_768, validated: true, primary: null, secondary: null, contrasts: null });
      expect(out.queue).toMatchObject({ complete: true, commands: 3, done: 2, failed: 1 });
      expect(out.validity.device).toMatchObject({ passed: true, reasons: [], finalHash: "final" });
      expect(out.validity.reproducibility).toMatchObject({ passed: true, reasons: [] });
      expect(out.validity.reproducibility.histories.map((h: any) => [h.id, h.boundary, h.passed])).toEqual([["shuf-s-i13", 134, true], ["shuf-a-i04", 34, true]]);
      expect(out.validity.quenched).toMatchObject({ failed: false, max: 0 });
      expect(out.validity.unresolved.arms["nat-a"]).toMatchObject({ histories: 24, unresolved: 23 });
      expect(out.availability.runs.filter((r: any) => r.resolved).map((r: any) => r.id)).toEqual(["nat-a-i00", "shuf-a-i04", "shuf-s-i13", "ancestor-j0"]);
      const status = (id: string) => out.availability.sets.find((x: any) => x.id === id);
      expect([status("s1-nat-a-i00").status, status("s1-nat-a-i00-quench").status, status("s1-nat-a-i00-genome").status, status("s1-shuf-a-i04").status]).toEqual(["measured", "measured", "measured", "measured"]);
      // The set whose recorded source hash is not the bundle's is rejected, with why; the G2 set is not this stage's.
      expect(out.rejected).toHaveLength(1);
      expect(out.rejected[0]).toMatchObject({ id: "s1-shuf-s-i13" });
      expect(out.rejected[0].reasons.join("\n")).toMatch(/provenance\.stateHash wrong is not shuf-s-i13's b200-pre hash/);
      expect(status("s1-shuf-s-i13").status).toBe("unresolved");
      expect(out.skipped.some((s: any) => /a "g2" set: this stage reads s1 sets/.test(s.why))).toBe(true);
      // The descriptives are still printed under a row that withholds the tests (they are never a decision input).
      const d = out.descriptive;
      expect(d.runs).toHaveLength(96);
      expect(d.runs.find((r: any) => r.id === "nat-a-i00")).toMatchObject({ resolved: true, boundaries: { first: 1, last: 200 }, endedAt: null, meanOccupancy: 1, meanExporters: 64, recolonisation: { recipients: 199 * 32, successes: 199 * 32, rate: 1 } });
      // The transform after time C (boundary 200) is in no pooled lifecycle value: 199 boundaries of 32 recipients, and the arm trajectory has no recipients at 200.
      expect(d.runs.find((r: any) => r.id === "nat-a-i00").truncation).toMatchObject({ recipients: 199 * 32 });
      expect(d.arms["nat-a"][199]).toMatchObject({ boundary: 200, occupied: 64, exporters: 64, effectiveDonors: null, truncation: null, recolonisation: null });
      expect(d.runs.find((r: any) => r.id === "shuf-s-i13")).toMatchObject({ boundaries: { first: 100, last: 200 } });
      expect(d.runs.find((r: any) => r.id === "nat-a-i01")).toMatchObject({ resolved: false, boundaries: null, meanOccupancy: null, recolonisation: null, truncation: null });
      expect(d.arms["nat-a"]).toHaveLength(200);
      expect(d.arms["shuf-s"].map((b: any) => b.boundary)).toEqual(range(101).map((k) => 100 + k));
      expect(d.arms["nat-s"]).toEqual([]);
      expect(d.arms["nat-a"][0]).toMatchObject({ boundary: 1, histories: 1, occupied: 64, exporters: 64 });
      expect(JSON.stringify(out)).not.toMatch(/NaN/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("hunt1: decodes the reproducibility checkpoints (a missing, corrupt or forged rerun file is Invalid) and resolves a history only if its pre-cycle checkpoint files exist and are not empty", () => {
    const run = (o: Parameters<typeof hunt1Full>[0]) => {
      const f = hunt1Full(o);
      rmSync(f.root, { recursive: true, force: true });
      return f.out;
    };
    const good = run({});
    expect(good.validity.reproducibility).toMatchObject({ passed: true });
    expect(good.validity.reproducibility.histories.map((h: any) => h.rerunHash === h.instanceHash && h.instanceHash !== null)).toEqual([true, true]);
    // The rerun's file is missing, is not a checkpoint, or is a checkpoint of another state than its manifest hashes (the manifests alone still agree): the check fails, Invalid.
    for (const [rerun, why] of [["missing", /the rerun's checkpoints\/b134-pre\.blck could not be loaded from .*: the file is missing/], ["corrupt", /the rerun's checkpoints\/b134-pre\.blck could not be loaded from /], ["other", /the rerun's checkpoints\/b134-pre\.blck in .* hashes to [0-9a-f]{16}, but its manifest records [0-9a-f]{16}/]] as const) {
      const out = run({ rerun });
      expect(out.validity.reproducibility.passed, rerun).toBe(false);
      expect(out.validity.reproducibility.reasons.join("\n"), rerun).toMatch(why);
      expect(out.validity.reproducibility.histories.find((h: any) => h.id === "shuf-a-i04").passed, rerun).toBe(true);
      expect(out.outcome, rerun).toBe("Invalid");
    }
    // No rerun at all: no rerun of either history.
    expect(run({ rerun: "absent" }).validity.reproducibility.reasons).toEqual(["no rerun of shuf-s-i13", "no rerun of shuf-a-i04"]);
    // The instance's own checkpoint file: not a checkpoint (the bundle is resolved, as only existence is read for it, and the decode fails the check) ...
    const corrupt = run({ instance: "corrupt" });
    expect(corrupt.availability.runs.find((r: any) => r.id === "shuf-s-i13")).toMatchObject({ resolved: true });
    expect(corrupt.validity.reproducibility.reasons.join("\n")).toMatch(/the instance's checkpoints\/b134-pre\.blck could not be loaded from /);
    expect(corrupt.outcome).toBe("Invalid");
    // ... or missing, and a history's b200 missing or empty: the bundle is unresolved before anything else reads it.
    for (const [o, file, text] of [[{ instance: "missing" }, "b134", "is missing"], [{ b200: "missing" }, "b200", "is missing"], [{ b200: "empty" }, "b200", "is empty"]] as const) {
      const out = run(o);
      const r = out.availability.runs.find((x: any) => x.id === "shuf-s-i13");
      expect(r.resolved, JSON.stringify(o)).toBe(false);
      expect(r.why[0], JSON.stringify(o)).toMatch(new RegExp(`^checkpoints/${file}-pre\\.blck ${text}`));
      expect(out.validity.reproducibility.reasons.join("\n"), JSON.stringify(o)).toMatch(/shuf-s-i13 is unresolved, so the check cannot be made/);
      expect(out.availability.runs.find((x: any) => x.id === "shuf-a-i04").resolved, JSON.stringify(o)).toBe(true);
    }
  }, 300_000);

  it("hunt1: believes a noGenome record only after reloading its history's b200-pre from the bundle, and refuses it when the checkpoint has a dominant genome, differs from the manifest or cannot be read", () => {
    const root = mkdtempSync(join(tmpdir(), "hunt1-nogenome-"));
    try {
      const small = PRESETS.find((p) => p.id === "ponds-small")!;
      const empty = buildWorld(pondConfig(2, 7, 0), { nutrient: 32, founders: [] }); // no eligible cell: no dominant genome
      const founded = initWorld(specConfig({ experiment: "x", presetId: "ponds-small", condition: "treatment", seed: 7, steps: 1, censusEvery: 1, deepEvery: 1, checkpointEvery: 0 }), small.init);
      /** nat-a-i00 (resolved, its manifest recording the hash of `listed`) with `file` as its b200-pre checkpoint (null: no file), and the ancestor world 0 the genome-only set plants. */
      const outcome = (name: string, file: WorldState | null, listed: WorldState, extra: HuntSetDir[] = []) => {
        const dir = join(root, name);
        const history = manifest("history", { histArm: "nat-a", i: 0 });
        history.preCycleCheckpoints = history.preCycleCheckpoints.map((e: any) => (e.boundary === 200 ? { ...e, hash: stateHash(listed) } : e));
        write(join(dir, "hist", history.runId), { "manifest.json": JSON.stringify(history), "ponds.tsv": pondsLines(boundariesOf(1, 200), scenario("nat")).join("\n") + "\n" });
        // The history's pre-cycle checkpoint files: b034 as a stand-in (existence only), b200 decoded for the genome-only set's donor.
        mkdirSync(join(dir, "hist", history.runId, "checkpoints"), { recursive: true });
        writeFileSync(join(dir, "hist", history.runId, "checkpoints", "b034-pre.blck"), "stand-in");
        if (file !== null) writeFileSync(join(dir, "hist", history.runId, "checkpoints", "b200-pre.blck"), encodeCheckpoint(file, { ponds: { lastCycle: 199 } }));
        const anc = manifest("ancestor", { i: 0 });
        write(join(dir, "hist", anc.runId), { "manifest.json": JSON.stringify(anc), "ponds.tsv": "\n" });
        const genome = setDir("s1-nat-a-i00-genome", { record: "noGenome", json: { provenance: { stateHash: hashOf("ancestor", { i: 0 }, 1), donor: { stateHash: stateHash(listed), dominant: null } } } });
        for (const d of [genome, ...extra]) write(join(dir, "sets", (d.json.labels as any).set), { "assay.json": JSON.stringify(d.json), "assay.tsv": tsvOf(d.rows) });
        write(dir, { "queue.json": JSON.stringify({ commands: [{ id: "a", instance: 1 }] }), "status.json": JSON.stringify({ instance: 1, commands: { a: "done" } }) });
        mkdirSync(join(dir, "empty"), { recursive: true });
        const out = report("hunt1", "--assays", join(dir, "sets"), "--runs", join(dir, "hist"), "--device", join(dir, "empty"), "--repro", join(dir, "empty"), "--queue", join(dir, "queue.json"), "--status", join(dir, "status.json"), "--pond-death", "32768");
        return { run: out.availability.runs.find((r: any) => r.id === "nat-a-i00") as { resolved: boolean; why: string[] }, status: out.availability.sets.find((x: any) => x.id === "s1-nat-a-i00-genome").status as string, why: (out.rejected.find((r: any) => r.id === "s1-nat-a-i00-genome")?.reasons.join("\n") ?? null) as string | null, out };
      };
      // Reloaded, with no dominant genome and the hash its manifest records: the record stands, W_G = 0 by definition.
      const good = outcome("good", empty, empty);
      expect(good).toMatchObject({ status: "measured", why: null });
      expect(good.out.descriptive.w.find((w: any) => w.id === "s1-nat-a-i00-genome")).toMatchObject({ noGenome: true, W: 0 });
      // The checkpoint has a dominant genome after all, the file is not the state the manifest hashed, or there is no file: the record is refused and the set unresolved.
      const dominant = outcome("dominant", founded, founded);
      expect(dominant.status).toBe("unresolved");
      expect(dominant.why).toBe("donor nat-a-i00 has a dominant genome, so its genome-only set is not a noGenome record");
      const differs = outcome("differs", founded, empty);
      expect(differs.why).toMatch(/donor nat-a-i00's b200-pre could not be read: it hashes to [0-9a-f]{16}, not the [0-9a-f]{16} its manifest records/);
      // No b200 file: the history's bundle is not resolved at all (it needs the checkpoint it was queued to write), so its set is too.
      const missing = outcome("missing", null, empty);
      expect(missing.status).toBe("unresolved");
      expect(missing.run).toMatchObject({ resolved: false, why: ["checkpoints/b200-pre.blck is missing (a history needs every pre-cycle checkpoint it was queued to write)"] });
      expect(good.run).toMatchObject({ resolved: true, why: [] });
      // A quenched control rejected at screening (its regime is wrong) whose rows show it is not dead still fails the quenched gate: the CLI passes the rejected sets on.
      const control = (json: Record<string, unknown>, rows?: (r: HuntFragment[]) => HuntFragment[]) => setDir("s1-nat-a-i00-quench", { x: (g) => (g < 4 ? 500 : 0), trait: (g, x) => x + 100, rows, json: { provenance: { stateHash: stateHash(empty) }, ...json } });
      const live = outcome("quench", empty, empty, [control({}, swapFamilies)]);
      expect(live.out.rejected.find((r: any) => r.id === "s1-nat-a-i00-quench")).toMatchObject({ reasons: [SWAPPED], quench: { successes: 4, n: 64, above: true } });
      expect(live.out.validity.quenched).toMatchObject({ failed: true });
      expect(live.out.validity.quenched.sets).toEqual([expect.objectContaining({ id: "s1-nat-a-i00-quench", successes: 4, rejected: [SWAPPED] })]);
      expect(live.out.reasons.join("\n")).toContain(`quenched control s1-nat-a-i00-quench has X_f > 0 in 4 of 64 fragments, above 0.05 (the set was rejected at screening: ${SWAPPED})`);
      // The same control made under --allow-any-seed (a smoke test's) never touches the gate.
      const smoke = outcome("quench-smoke", empty, empty, [control({ allowAnySeed: true })]);
      expect(smoke.out.rejected.find((r: any) => r.id === "s1-nat-a-i00-quench").quench).toBeUndefined();
      expect(smoke.out.validity.quenched).toMatchObject({ failed: false, sets: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);

  it("leaves the registration's stages alone: they skip the hunt's sets", () => {
    const root = mkdtempSync(join(tmpdir(), "hunt-skip-"));
    try {
      const d = setDir("s1-nat-a-i00");
      write(join(root, "set"), { "assay.json": JSON.stringify(d.json), "assay.tsv": tsvOf(d.rows) });
      const out = report("r3", "--assays", root, "--regime", "8", "10000");
      expect(out.skipped).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
