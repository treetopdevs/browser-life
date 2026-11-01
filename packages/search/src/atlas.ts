// Behaviour atlas (idea I01, docs/behaviour-atlas-2026-11-01/PLAN.md): an opt-in archive beside the
// mass/speed map. Its descriptors read per-tile bound mass at census steps, never tracked
// individuals or lineage ids, so they stay defined when component identity is ambiguous. Its
// insertion score is viability alone, and every offer goes into an append-only proposal ledger, so
// displaced and ancestral entries (stepping stones) are kept, not just the current elites.
//
// Selection and capability testing are kept apart: each search arm declares what it reads, a
// capability test declares what it reads, and `assertSeparated` refuses a panel that overlaps any
// selector. A filled bin is a description of behaviour, not a capability or a novelty claim.

import { CH, cellCount, lowbias32, randomGenome, worldW, type Genome, type WorldConfig } from "@bl/schema";
import type { CensusInput } from "@bl/metrics";
import type { EvalConfig, EvalObserver, Evaluation } from "./evaluate.ts";
import { Archive, DEFAULT_ARCHIVE, genomeKey, mutateGenome, passesGate, pick } from "./mapelites.ts";
import { quality } from "./evaluate.ts";

/** Identity of the physical descriptor definitions below; any change to them changes this. */
export const ATLAS_DESCRIPTORS = "atlas-physical-v1";
/** Bound mass (B+P) at which a cell counts as occupied for `persistence` (the tracker's threshold). */
export const OCCUPIED_MASS = 48;

export interface PhysicalDescriptors {
  /** Census interval (steps) the descriptors were sampled at; part of their definition. */
  interval: number;
  /** Mean step of the tile's centre of bound mass between censuses, in cells per 100 steps. */
  displacement: number;
  /** Mean Jaccard overlap of occupied cells between consecutive censuses, in [0, 1]. */
  persistence: number;
}

/**
 * Streaming descriptors for one tile: keeps only the previous frame. Frames are the tile's bound
 * mass (B+P) per cell, row-major `w × h`, taken every `interval` steps. A frame with no bound mass
 * breaks both chains (a dead tile has no centre and no occupancy to compare).
 */
export class TileDescriptors {
  private prevStep = -1;
  private prevCentre: [number, number] | null = null;
  private prevOcc: Uint8Array | null = null;
  private dispSum = 0;
  private dispN = 0;
  private jacSum = 0;
  private jacN = 0;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly interval: number,
  ) {
    if (!(Number.isInteger(interval) && interval > 0)) throw new Error(`census interval must be a positive integer, not ${interval}`);
  }

  push(step: number, mass: ArrayLike<number>): void {
    if (mass.length !== this.w * this.h) throw new Error(`frame holds ${mass.length} cells, tile has ${this.w * this.h}`);
    if (this.prevStep >= 0 && step - this.prevStep !== this.interval)
      throw new Error(`census at step ${step} is ${step - this.prevStep} after the last; descriptors are defined for an interval of ${this.interval}`);
    this.prevStep = step;
    const occ = new Uint8Array(mass.length);
    let total = 0, cx = 0, sx = 0, cy = 0, sy = 0;
    for (let i = 0; i < mass.length; i++) {
      const m = mass[i];
      if (m <= 0) continue;
      total += m;
      if (m >= OCCUPIED_MASS) occ[i] = 1;
      const x = i % this.w, y = (i - x) / this.w;
      cx += m * Math.cos((2 * Math.PI * x) / this.w);
      sx += m * Math.sin((2 * Math.PI * x) / this.w);
      cy += m * Math.cos((2 * Math.PI * y) / this.h);
      sy += m * Math.sin((2 * Math.PI * y) / this.h);
    }
    // A circular mean is undefined when the mass is spread evenly round an axis; such a frame has no centre.
    const eps = 1e-9 * total;
    const centre: [number, number] | null =
      total > 0 && Math.hypot(cx, sx) > eps && Math.hypot(cy, sy) > eps
        ? [wrapCoord((Math.atan2(sx, cx) * this.w) / (2 * Math.PI), this.w), wrapCoord((Math.atan2(sy, cy) * this.h) / (2 * Math.PI), this.h)]
        : null;
    if (centre && this.prevCentre) {
      this.dispSum += Math.hypot(torusDelta(centre[0], this.prevCentre[0], this.w), torusDelta(centre[1], this.prevCentre[1], this.h));
      this.dispN++;
    }
    if (total > 0 && this.prevOcc) {
      let inter = 0, union = 0;
      for (let i = 0; i < occ.length; i++) {
        inter += occ[i] & this.prevOcc[i];
        union += occ[i] | this.prevOcc[i];
      }
      if (union > 0) {
        this.jacSum += inter / union;
        this.jacN++;
      }
    }
    this.prevCentre = centre;
    this.prevOcc = total > 0 ? occ : null;
  }

  /** The tile's descriptors, or undefined when fewer than two consecutive live frames were seen. */
  result(): PhysicalDescriptors | undefined {
    if (this.dispN === 0 || this.jacN === 0) return undefined;
    return { interval: this.interval, displacement: ((this.dispSum / this.dispN) * 100) / this.interval, persistence: this.jacSum / this.jacN };
  }
}

function wrapCoord(v: number, n: number): number {
  return ((v % n) + n) % n;
}

function torusDelta(a: number, b: number, n: number): number {
  const d = Math.abs(a - b) % n;
  return Math.min(d, n - d);
}

/** Bound mass (B+P) of tile `t`, row-major, from full channel-major world cells. */
export function tileBoundMass(cfg: WorldConfig, cells: Uint32Array, t: number): Float64Array {
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const x0 = (t % cfg.tilesX) * cfg.tileW, y0 = Math.floor(t / cfg.tilesX) * cfg.tileH;
  const out = new Float64Array(cfg.tileW * cfg.tileH);
  for (let y = 0; y < cfg.tileH; y++)
    for (let x = 0; x < cfg.tileW; x++) {
      const i = (y0 + y) * W + x0 + x;
      out[y * cfg.tileW + x] = cells[CH.B * n + i] + cells[CH.P * n + i];
    }
  return out;
}

/** Per-genome physical descriptors: the mean over replicate tiles that had them, and each tile's own. */
export interface GenomeDescriptors {
  descriptors?: PhysicalDescriptors;
  perRep: (PhysicalDescriptors | undefined)[];
}

/**
 * An `EvalObserver` for `evaluateBatch` that computes physical descriptors from its growth censuses
 * (`grow-census` events). Tiles are assigned to genomes as `evaluateBatch` lays them out
 * (genome k owns tiles k·reps … k·reps+reps−1). A background medium is refused: the producer's
 * mass would enter every descriptor.
 */
export function atlasObserver(ec: EvalConfig, genomes: number): { observer: EvalObserver; results(): GenomeDescriptors[] } {
  if (ec.medium?.background) throw new Error("atlas descriptors are undefined over a background medium (they read all bound mass in a tile)");
  const tiles = genomes * ec.reps;
  if (tiles > ec.side * ec.side) throw new Error(`batch holds ${Math.floor((ec.side * ec.side) / ec.reps)} genomes`);
  const acc = Array.from({ length: tiles }, () => new TileDescriptors(ec.tile, ec.tile, ec.censusEvery));
  return {
    async observer(ev) {
      // runChunked ends growth with a short chunk when censusEvery does not divide growSteps; that
      // off-cadence census is outside the descriptors' definition and is skipped.
      if (ev.kind !== "grow-census" || ev.input.step % ec.censusEvery !== 0) return;
      for (let t = 0; t < tiles; t++) acc[t].push(ev.input.step, tileBoundMass(ev.input.cfg, ev.input.cells, t));
    },
    results() {
      return Array.from({ length: genomes }, (_, k) => {
        const perRep = acc.slice(k * ec.reps, (k + 1) * ec.reps).map((a) => a.result());
        const ok = perRep.filter((d): d is PhysicalDescriptors => !!d);
        const descriptors = ok.length
          ? { interval: ec.censusEvery, displacement: ok.reduce((s, d) => s + d.displacement, 0) / ok.length, persistence: ok.reduce((s, d) => s + d.persistence, 0) / ok.length }
          : undefined;
        return { descriptors, perRep };
      });
    },
  };
}

/** Physical descriptors from a sequence of census inputs for one tile (CPU fixtures, replays). */
export function descriptorsOf(frames: CensusInput[], t: number, interval: number): PhysicalDescriptors | undefined {
  if (!frames.length) return undefined;
  const { cfg } = frames[0];
  const d = new TileDescriptors(cfg.tileW, cfg.tileH, interval);
  for (const f of frames) d.push(f.step, tileBoundMass(f.cfg, f.cells, t));
  return d.result();
}

// ---------------------------------------------------------------------------------------------
// The atlas archive and its proposal ledger.

export interface AtlasSpec {
  descriptors: typeof ATLAS_DESCRIPTORS;
  /** Census interval every offered descriptor must have been sampled at. */
  interval: number;
  bins: number;
  displacementRange: [number, number];
  persistenceRange: [number, number];
}

/** Provisional ranges: to be calibrated on GPU evaluations before any pilot (PLAN.md, open decisions). */
export const DEFAULT_ATLAS: AtlasSpec = { descriptors: ATLAS_DESCRIPTORS, interval: 100, bins: 8, displacementRange: [0, 4], persistenceRange: [0, 1] };

export type ProposalOperator = "seed" | "random" | "mutate";

/** How a candidate was proposed; the ledger's ancestry is the ancestry of search proposals, not of organisms. */
export interface Proposal {
  genome: Genome;
  operator: ProposalOperator;
  /** Ledger ids of the parents (empty for seeds and random genomes). */
  parents: number[];
  /** The seed that produced it (mutation or random-genome seed; the pool index for seeds). */
  seed: number;
  batch: number;
}

/**
 * Complete genotype identity for the atlas: `genomeKey` (parameters, weights, kernel rings) plus the
 * capability gene byte, which `genomeKey` omits, so gene-distinct genomes are never merged.
 */
export function atlasGenomeKey(g: Genome): string {
  return genomeKey(g) + (g.genes ? `:g${g.genes}` : "");
}

export interface LedgerEntry extends Proposal {
  id: number;
  key: string;
  /** Screening replicates alive after growth, of `reps`. */
  survived: number;
  reps: number;
  /** Screening viability: survived / reps. The atlas's only insertion score. */
  score: number;
  descriptors?: PhysicalDescriptors;
  cell?: [number, number];
  /** Whether it took a cell when offered. */
  inserted: boolean;
  /** Ledger id of the entry that later took its cell, if it was inserted and then displaced. */
  displacedBy?: number;
  /** Ledger id of the first entry with the same genome, if this genome was offered before. */
  duplicateOf?: number;
}

/** What the atlas's insertion reads: viability and the two descriptors, nothing else. */
export interface Screened {
  survived: number;
  reps: number;
  descriptors?: PhysicalDescriptors;
}

export class BehaviourAtlas {
  /** Cell key → ledger id of its elite. */
  readonly cells = new Map<string, number>();
  readonly ledger: LedgerEntry[] = [];
  private readonly byKey = new Map<string, number>();

  constructor(readonly spec: AtlasSpec = DEFAULT_ATLAS) {
    if (spec.descriptors !== ATLAS_DESCRIPTORS) throw new Error(`atlas spec is for ${spec.descriptors}, this code computes ${ATLAS_DESCRIPTORS}`);
  }

  cellOf(d: PhysicalDescriptors): [number, number] {
    const bin = (v: number, [lo, hi]: [number, number]) => Math.max(0, Math.min(this.spec.bins - 1, Math.floor(((v - lo) / (hi - lo)) * this.spec.bins)));
    return [bin(d.displacement, this.spec.displacementRange), bin(d.persistence, this.spec.persistenceRange)];
  }

  /**
   * Appends the proposal to the ledger and inserts it if it is viable, has descriptors, and its cell
   * is empty or held by a strictly less viable elite (ties keep the incumbent). Returns the entry.
   */
  offer(p: Proposal, s: Screened): LedgerEntry {
    for (const id of p.parents) if (!(id >= 0 && id < this.ledger.length)) throw new Error(`proposal names parent ${id}, which is not in the ledger`);
    if (s.descriptors && s.descriptors.interval !== this.spec.interval)
      throw new Error(`descriptors sampled every ${s.descriptors.interval} steps offered to an atlas defined at ${this.spec.interval}`);
    const key = atlasGenomeKey(p.genome);
    const score = s.reps > 0 ? s.survived / s.reps : 0;
    const e: LedgerEntry = { ...p, parents: [...p.parents], id: this.ledger.length, key, survived: s.survived, reps: s.reps, score, inserted: false };
    const first = this.byKey.get(key);
    if (first !== undefined) e.duplicateOf = first;
    else this.byKey.set(key, e.id);
    if (s.descriptors) {
      e.descriptors = { ...s.descriptors };
      e.cell = this.cellOf(s.descriptors);
    }
    this.ledger.push(e);
    if (score <= 0 || !e.cell) return e;
    const ck = e.cell.join(",");
    const cur = this.cells.get(ck);
    if (cur !== undefined && this.ledger[cur].score >= score) return e;
    if (cur !== undefined) this.ledger[cur].displacedBy = e.id;
    this.cells.set(ck, e.id);
    e.inserted = true;
    return e;
  }

  elites(): LedgerEntry[] {
    return [...this.cells.values()].map((id) => this.ledger[id]);
  }

  coverage(): number {
    return this.cells.size / (this.spec.bins * this.spec.bins);
  }

  /** Ledger ids of an entry's proposal ancestors (parents, their parents, …), excluding itself. */
  ancestorsOf(id: number): number[] {
    const seen = new Set<number>();
    const stack = [...this.ledger[id].parents];
    while (stack.length) {
      const a = stack.pop()!;
      if (seen.has(a)) continue;
      seen.add(a);
      stack.push(...this.ledger[a].parents);
    }
    return [...seen].sort((a, b) => a - b);
  }

  /** Entries that are proposal ancestors of a current elite without holding a cell themselves. */
  steppingStones(): LedgerEntry[] {
    const elite = new Set(this.cells.values());
    const out = new Set<number>();
    for (const id of elite) for (const a of this.ancestorsOf(id)) if (!elite.has(a)) out.add(a);
    return [...out].sort((a, b) => a - b).map((id) => this.ledger[id]);
  }

  /** Fraction of offers whose genome had been offered before. */
  duplicateRate(): number {
    return this.ledger.length ? this.ledger.filter((e) => e.duplicateOf !== undefined).length / this.ledger.length : 0;
  }

  /** A parent: a uniformly chosen elite (classic MAP-Elites selection over cells). */
  pickParent(seed: number): LedgerEntry | undefined {
    const ids = [...this.cells.values()].sort((a, b) => a - b);
    return ids.length ? this.ledger[pick(ids, seed)] : undefined;
  }

  /** Rebuilds an atlas from its ledger: offering the same proposals in order reproduces every field. */
  static replay(ledger: readonly LedgerEntry[], spec: AtlasSpec = DEFAULT_ATLAS): BehaviourAtlas {
    const a = new BehaviourAtlas(spec);
    for (const e of ledger) a.offer({ genome: e.genome, operator: e.operator, parents: e.parents, seed: e.seed, batch: e.batch }, { survived: e.survived, reps: e.reps, descriptors: e.descriptors });
    return a;
  }
}

// ---------------------------------------------------------------------------------------------
// Separation of selectors and capability tests.

/** The assay whose evaluations every arm searches on (DEFAULT_EVAL on screening seeds). */
export const SCREEN_ASSAY = "screen";

/** A quantity some selector or test reads: `<assay>:<Evaluation field>` or `<assay>:descriptor.<name>`. */
export type Read = string;

export type ArmName = "random-viable" | "mass-speed" | "physical" | "embedding";

/**
 * What each arm's selection reads. mass-speed: `quality` and the m3 gate (pickParent's pass bias)
 * plus its mass and speed descriptors. physical: viability and the atlas descriptors.
 * random-viable: viability. embedding: unimplemented, reads nothing yet.
 */
export const SELECTOR_READS: Record<ArmName, readonly Read[]> = {
  "random-viable": ["survived", "reps"].map((f) => `${SCREEN_ASSAY}:${f}`),
  "mass-speed": ["survived", "reps", "recovery", "recovered", "regenerated", "lightDependent", "meanMass", "speed"].map((f) => `${SCREEN_ASSAY}:${f}`),
  physical: [`${SCREEN_ASSAY}:survived`, `${SCREEN_ASSAY}:reps`, `${SCREEN_ASSAY}:descriptor.displacement`, `${SCREEN_ASSAY}:descriptor.persistence`],
  embedding: [],
};

/** A held-out capability test: a versioned pass/fail over evaluations from named assays. */
export interface CapabilityTest {
  id: string;
  version: string;
  /** Everything `passes` reads, as `<assay>:<field>`. */
  reads: readonly Read[];
  passes(evals: Readonly<Record<string, Evaluation>>): boolean;
}

/**
 * A read in canonical form: per-replicate values are the same measurement as their aggregate
 * (`perRep.regenerated` reconstructs `regenerated / reps`), so `<assay>:perRep.<field>` reads
 * `<assay>:<field>`, and a bare `<assay>:perRep` reads every field of that assay (`<assay>:*`).
 */
export function canonicalRead(r: Read): Read {
  const i = r.indexOf(":");
  if (i <= 0) throw new Error(`read ${JSON.stringify(r)} is not <assay>:<field>`);
  const assay = r.slice(0, i), field = r.slice(i + 1);
  if (field === "perRep") return `${assay}:*`;
  if (field.startsWith("perRep.")) {
    const f = field.slice("perRep.".length);
    return `${assay}:${PER_REP_AGGREGATE[f] ?? f}`;
  }
  return r;
}

/** Per-replicate fields whose aggregate has another name (`survived` counts replicates `alive`). */
const PER_REP_AGGREGATE: Readonly<Record<string, string>> = { alive: "survived" };

function overlaps(a: Read, b: Read): boolean {
  if (a === b) return true;
  const [aa, af] = [a.slice(0, a.indexOf(":")), a.slice(a.indexOf(":") + 1)];
  const [ba, bf] = [b.slice(0, b.indexOf(":")), b.slice(b.indexOf(":") + 1)];
  return aa === ba && (af === "*" || bf === "*");
}

/**
 * Throws if any capability test reads something a compared arm selects on, directly or through an
 * equivalent per-replicate form: a score used to choose candidates cannot also be presented as
 * independent confirmation. Declarations are trusted: a test's `passes` must read only what its
 * `reads` lists, which review, not this check, enforces.
 */
export function assertSeparated(panel: readonly CapabilityTest[], arms: readonly ArmName[]): void {
  const ids = new Set<string>();
  for (const t of panel) {
    if (ids.has(t.id)) throw new Error(`capability test ${t.id} appears twice in the panel`);
    ids.add(t.id);
    for (const r of t.reads)
      for (const arm of arms)
        for (const sel of SELECTOR_READS[arm])
          if (overlaps(canonicalRead(r), canonicalRead(sel))) throw new Error(`capability test ${t.id} reads ${r}, which arm ${arm} selects on (${sel})`);
  }
}

/**
 * Per-test and overall capability coverage of a frozen selection, from its held-out evaluations.
 * Members and `heldOut` keys are `atlasGenomeKey`s, as in `ArmHistory.selection`.
 */
export function capabilityCoverage(
  members: readonly string[],
  heldOut: ReadonlyMap<string, Readonly<Record<string, Evaluation>>>,
  panel: readonly CapabilityTest[],
): { perTest: Record<string, number>; covered: number; untested: string[] } {
  const perTest: Record<string, number> = Object.fromEntries(panel.map((t) => [t.id, 0]));
  const untested: string[] = [];
  for (const key of members) {
    const evals = heldOut.get(key);
    if (!evals) {
      untested.push(key);
      continue;
    }
    for (const t of panel) {
      const missing = t.reads.map((r) => r.split(":")[0]).find((assay) => !evals[assay]);
      if (missing) throw new Error(`member ${key} lacks the ${missing} evaluation that ${t.id} reads`);
      if (t.passes(evals)) perTest[t.id]++;
    }
  }
  return { perTest, covered: panel.filter((t) => perTest[t.id] > 0).length, untested };
}

// ---------------------------------------------------------------------------------------------
// Equal-budget comparison of search arms (evaluator injected: GPU in tools, fakes in tests).

export interface ScreenResult {
  eval: Evaluation;
  descriptors?: PhysicalDescriptors;
}

export type ScreenEvaluator = (genomes: Genome[], ctx: { history: number; arm: ArmName | "pool"; batch: number }) => Promise<ScreenResult[]>;

export interface ComparisonSpec {
  arms: ArmName[];
  /** Independent search histories (their seeds): the unit of replication. */
  histories: number[];
  /** Shared starting pool, evaluated once per history and offered to every arm. */
  pool: Genome[];
  /** Screening evaluations per arm per history, the pool's included. */
  budget: number;
  batchSize: number;
  /** Fraction of proposals that are fresh random genomes in the archive arms. */
  randomFraction: number;
}

export interface ArmHistory {
  arm: ArmName;
  history: number;
  status: "ran" | "unimplemented";
  evaluations: number;
  /** Genome keys of the arm's frozen selection: archive elites, or every viable genome for random-viable. */
  selection: string[];
  /** Genomes of the selection by key, for the held-out evaluations that follow. */
  genomes: Record<string, Genome>;
  /** The physical arm's proposal ledger (stepping stones included). */
  ledger?: LedgerEntry[];
}

const RANDOM_MU = 60, RANDOM_SIGMA = 20;

/**
 * Runs every arm on every history with the same pool and budget. Selection only sees screening
 * results; capability testing is a separate, later step on the returned selections.
 */
export async function compareArms(spec: ComparisonSpec, evaluate: ScreenEvaluator): Promise<ArmHistory[]> {
  if (!(spec.budget >= spec.pool.length)) throw new Error(`budget ${spec.budget} is smaller than the pool (${spec.pool.length})`);
  if (!(spec.batchSize > 0)) throw new Error("batchSize must be positive");
  const out: ArmHistory[] = [];
  for (const history of spec.histories) {
    const pool = await evaluate(spec.pool, { history, arm: "pool", batch: 0 });
    if (pool.length !== spec.pool.length) throw new Error(`evaluator returned ${pool.length} results for ${spec.pool.length} genomes`);
    for (const arm of spec.arms) out.push(await runArm(arm, history, spec, pool, evaluate));
  }
  return out;
}

async function runArm(arm: ArmName, history: number, spec: ComparisonSpec, pool: ScreenResult[], evaluate: ScreenEvaluator): Promise<ArmHistory> {
  const base = { arm, history, evaluations: 0, selection: [] as string[], genomes: {} as Record<string, Genome> };
  if (arm === "embedding") return { ...base, status: "unimplemented" };
  const atlas = new BehaviourAtlas();
  const archive = new Archive(DEFAULT_ARCHIVE, quality, passesGate);
  const viable = new Map<string, Genome>();
  const offer = (p: Proposal, r: ScreenResult) => {
    if (arm === "physical") atlas.offer(p, { survived: r.eval.survived, reps: r.eval.reps, descriptors: r.descriptors });
    else if (arm === "mass-speed") archive.offer(p.genome, r.eval, p.batch);
    else if (r.eval.survived > 0 && !viable.has(atlasGenomeKey(p.genome))) viable.set(atlasGenomeKey(p.genome), p.genome);
  };
  spec.pool.forEach((g, i) => offer({ genome: g, operator: "seed", parents: [], seed: i, batch: 0 }, pool[i]));
  let evaluations = spec.pool.length;
  for (let batch = 1; evaluations < spec.budget; batch++) {
    const n = Math.min(spec.batchSize, spec.budget - evaluations);
    const proposals: Proposal[] = [];
    for (let j = 0; j < n; j++) {
      const seed = lowbias32((history * 0x9e3779b1) ^ (batch << 12) ^ j) >>> 0;
      const fresh = arm === "random-viable" || lowbias32(seed ^ 0x51ed270b) / 2 ** 32 < spec.randomFraction;
      const parent = fresh ? undefined : arm === "physical" ? atlas.pickParent(seed) : archive.pickParent(seed);
      if (!parent) proposals.push({ genome: randomGenome(seed, RANDOM_MU, RANDOM_SIGMA), operator: "random", parents: [], seed, batch });
      else proposals.push({ genome: mutateGenome(parent.genome, seed), operator: "mutate", parents: "id" in parent ? [parent.id] : [], seed, batch });
    }
    const rs = await evaluate(proposals.map((p) => p.genome), { history, arm, batch });
    if (rs.length !== proposals.length) throw new Error(`evaluator returned ${rs.length} results for ${proposals.length} genomes`);
    proposals.forEach((p, j) => offer(p, rs[j]));
    evaluations += n;
  }
  const chosen: Genome[] = arm === "physical" ? atlas.elites().map((e) => e.genome) : arm === "mass-speed" ? archive.elites().map((e) => e.genome) : [...viable.values()];
  const genomes: Record<string, Genome> = {};
  for (const g of chosen) genomes[atlasGenomeKey(g)] = g;
  return { ...base, status: "ran", evaluations, selection: Object.keys(genomes).sort(), genomes, ...(arm === "physical" ? { ledger: atlas.ledger } : {}) };
}
