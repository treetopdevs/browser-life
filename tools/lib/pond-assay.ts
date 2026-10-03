// Assay worlds of the ecological-scaffolding sandbox (docs/scaffold-protocol-v1.md, "Assay world",
// "Standard fragment" and R1-R4). A source world (a pond-cycle history's state) is sampled into
// standard fragments, each fragment is planted alone at the centre of a fresh pond holding a fixed
// matter budget M_assay, and the assay world runs one period with mutation off. Everything here is
// host-side, integer and pure (no Deno API: the registration's runner-bundle loader takes its file
// reader as an argument), so vitest exercises it directly; the GPU loop and the CLI are
// tools/scaffold-assays.ts.
import {
  CH,
  G,
  GENOME_CHANNELS,
  M3_FOUNDERS,
  NN_WORDS,
  PRESETS,
  allocState,
  buildWorld,
  canonicalConfig,
  decodeCheckpoint,
  emptyGenome,
  encodeGenome,
  founderGenome,
  cellCount,
  initWorld,
  stateHash,
  validateState,
  worldW,
  type Founder,
  type Genome,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { runId, specConfig, type RunSpec } from "@bl/runner";
import { MOT_ZERO } from "@bl/sim-ref";
import { assaySeed, drawPacketCentre, packetWindow, pondConfig, pondTraits, randomKey, weightedPick } from "./ponds.ts";

/** Fixed matter budget of every assay pond: 4096 x 37, close to an ancestor pond's initial matter. */
export const M_ASSAY = 151552;

/**
 * Column order of assay.tsv: the contract's header, then the requested and retained E (R1 residualises on
 * log(1 + retained E); R3 reports its distribution) and the truncation flag (the report's 1% rule).
 */
export const ASSAY_COLUMNS = ["assay", "source", "replicate", "pond", "family", "inoculum", "reqMass", "retMass", "endTrait", "success", "reqE", "retE", "truncated"] as const;

/** Column order of traits.tsv (`--traits`): a pond's trait at one census step of the assay period. */
export const TRAIT_COLUMNS = ["replicate", "pond", "step", "trait"] as const;

/** Pond side and the landing centre, fixed by the protocol (tiles are 64x64, the fragment lands at (32, 32)). */
const TILE = 64;
const CENTRE = 32;

/** One landed cell: pond-local landing coordinates and the state the fragment carries. */
export interface FragmentCell {
  x: number;
  y: number;
  B: number;
  P: number;
  E: number;
  MOT: number;
  /** All GENOME_CHANNELS words, lineage id included. */
  genome: Uint32Array;
}

/**
 * A standard fragment after truncation against M_ASSAY. `cells` are the landed cells in raster order of the
 * landing (window order, minus the dropped tail); `req*` describe the whole window, `ret*` the landed cells.
 * `pond` is the source pond and `cx`, `cy` the packet centre in its tile.
 */
export interface Fragment {
  pond: number;
  cx: number;
  cy: number;
  k: number;
  cells: FragmentCell[];
  reqMass: number;
  retMass: number;
  reqE: number;
  retE: number;
  truncated: boolean;
}

const traitCache = new WeakMap<WorldState, number[]>();

/** `pondTraits` of a source, computed once per source object (the sources here are never mutated). */
function eligibleTraits(source: WorldState): number[] {
  let t = traitCache.get(source);
  if (!t) traitCache.set(source, (t = pondTraits(source)));
  return t;
}

/**
 * Fragment `f` of `source` with assay seed `sigma`. The source pond is drawn uniformly, with replacement, from
 * the eligible ponds (index order) with `weightedPick(randomKey(sigma, 0, f, 5), randomKey(sigma, 0, f, 6), n)`,
 * unless `pond` names it (R1's donors). The window centre is the packet rule's `drawPacketCentre(sigma, 0, f)`;
 * the k x k window lands at the pond centre and is truncated against M_ASSAY in reverse raster order.
 * `null` if the source has no eligible pond (every fragment is then absent) or `pond` has no eligible cell.
 */
export function standardFragment(source: WorldState, k: number, sigma: number, f: number, pond?: number): Fragment | null {
  const cfg = source.cfg;
  if (cfg.tileW !== TILE || cfg.tileH !== TILE) throw new Error(`ponds are ${TILE}x${TILE} tiles, got ${cfg.tileW}x${cfg.tileH}`);
  if (pond === undefined) {
    const traits = eligibleTraits(source);
    const eligible: number[] = [];
    for (let p = 0; p < traits.length; p++) if (traits[p] > 0) eligible.push(p);
    if (eligible.length === 0) return null;
    pond = eligible[weightedPick(randomKey(sigma, 0, f, 5), randomKey(sigma, 0, f, 6), eligible.length)];
  }
  const centre = drawPacketCentre(source, pond, sigma, 0, f);
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

/**
 * R1's donor ponds of a source, chosen once per history and time with keys from the donor seed (`sigma` =
 * `assaySeed(1, h, t, 0, 9)`): with at least 16 eligible ponds, the 16 with the smallest purpose-1 key (ordered
 * by key, then pond index); with 2-15, every eligible pond in index order; with fewer than 2, `insufficient`
 * (R1 is not demonstrated for that history) and no donors.
 */
export function r1Donors(source: WorldState, sigma: number): { donors: number[]; eligible: number; insufficient: boolean } {
  const traits = eligibleTraits(source);
  const eligible: number[] = [];
  for (let p = 0; p < traits.length; p++) if (traits[p] > 0) eligible.push(p);
  if (eligible.length < 2) return { donors: [], eligible: eligible.length, insufficient: true };
  if (eligible.length < 16) return { donors: eligible, eligible: eligible.length, insufficient: false };
  const keyed = eligible.map((pond) => ({ pond, key: randomKey(sigma, 0, pond, 1) }));
  keyed.sort((x, y) => x.key - y.key || x.pond - y.pond);
  return { donors: keyed.slice(0, 16).map((e) => e.pond), eligible: eligible.length, insufficient: false };
}

/** A lineage-carrying or bound-mass cell: the cells a genome edit applies to (empty cells stay empty). */
const carries = (cell: FragmentCell): boolean => cell.B + cell.P > 0 || (cell.genome[G.LIN_HI] | cell.genome[G.LIN_LO]) !== 0;

/**
 * The quenched control: the 40 controller weight words and E of every landed cell set to 0 (B, P, MOT, the
 * growth parameters and the lineage ids are kept). `reqE` and `retE` become 0. Does not mutate `fragment`.
 */
export function quench(fragment: Fragment): Fragment {
  const cells = fragment.cells.map((cell) => {
    const genome = cell.genome.slice();
    genome.fill(0, G.W0, G.W0 + NN_WORDS);
    return { ...cell, E: 0, genome };
  });
  return { ...fragment, cells, reqE: 0, retE: 0 };
}

/**
 * The swap arms: every landed cell that carries a genome (bound mass or a lineage id) gets all GENOME_CHANNELS
 * words of `words` verbatim, so the fragment holds one lineage. `words` must carry a nonzero lineage id; the
 * assay world relabels it. Same cells, B, P, E and MOT as `fragment`, which is not mutated.
 */
export function swapGenome(fragment: Fragment, words: Uint32Array): Fragment {
  if (words.length !== GENOME_CHANNELS) throw new Error(`swap genome must have ${GENOME_CHANNELS} words, got ${words.length}`);
  if ((words[G.LIN_HI] | words[G.LIN_LO]) === 0) throw new Error("swap genome needs a nonzero lineage id");
  return { ...fragment, cells: fragment.cells.map((cell) => (carries(cell) ? { ...cell, genome: words.slice() } : cell)) };
}

/**
 * The lineage with the largest B+P over the fragment's landed cells, ties to the smallest (hi, lo), with its
 * genome words (R2's standardised inoculum). `null` if no landed cell carries a lineage with bound mass.
 */
export function fragmentDominant(fragment: Fragment): { hi: number; lo: number; words: Uint32Array } | null {
  const mass = new Map<string, { hi: number; lo: number; mass: number; genome: Uint32Array }>();
  for (const cell of fragment.cells) {
    const m = cell.B + cell.P;
    const hi = cell.genome[G.LIN_HI], lo = cell.genome[G.LIN_LO];
    if (m === 0 || (hi | lo) === 0) continue;
    const key = `${hi}:${lo}`;
    const e = mass.get(key);
    if (e) e.mass += m;
    else mass.set(key, { hi, lo, mass: m, genome: cell.genome });
  }
  let best: { hi: number; lo: number; mass: number; genome: Uint32Array } | null = null;
  for (const e of mass.values())
    if (!best || e.mass > best.mass || (e.mass === best.mass && (e.hi < best.hi || (e.hi === best.hi && e.lo < best.lo)))) best = e;
  return best && { hi: best.hi, lo: best.lo, words: best.genome.slice() };
}

/** What one pond of an assay world is planted with: a fragment, or the standard disc of a genome. */
export type AssayItem = { kind: "fragment"; fragment: Fragment } | { kind: "disc"; genome: Genome } | null;

/** What actually landed in a pond of an assay world (a disc's noise makes its B+P and E its own). */
export interface Planted {
  reqMass: number;
  retMass: number;
  reqE: number;
  retE: number;
  landed: number;
  truncated: boolean;
}

/** A pond's A refilled uniformly to `amount`, remainder one quantum per cell in raster order. */
function refillA(cells: Uint32Array, cfg: WorldConfig, pond: number, amount: number): void {
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const area = cfg.tileW * cfg.tileH;
  const each = Math.floor(amount / area);
  let rem = amount - each * area;
  const tx = pond % cfg.tilesX;
  const ty = (pond - tx) / cfg.tilesX;
  for (let y = 0; y < cfg.tileH; y++)
    for (let x = 0; x < cfg.tileW; x++) cells[CH.A * n + (ty * cfg.tileH + y) * W + tx * cfg.tileW + x] = each + (rem-- > 0 ? 1 : 0);
}

/**
 * The standard disc of `genome` planted in `pond` by buildWorld's own rule (radius 10, biomass 64, energy 128,
 * noise keyed on the planting index = pond index, as in cloneWorld), as a fragment of every cell it touched.
 * `discs` is the built world holding every disc of the assay.
 */
function discFragment(discs: WorldState, pond: number): Fragment {
  const cfg = discs.cfg;
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const tx = pond % cfg.tilesX;
  const ty = (pond - tx) / cfg.tilesX;
  const cells: FragmentCell[] = [];
  let reqMass = 0, reqE = 0;
  for (let y = 0; y < cfg.tileH; y++) {
    for (let x = 0; x < cfg.tileW; x++) {
      const i = (ty * cfg.tileH + y) * W + tx * cfg.tileW + x;
      const B = discs.cells[CH.B * n + i], P = discs.cells[CH.P * n + i], E = discs.cells[CH.E * n + i];
      if ((B | P | E | discs.genome[G.LIN_HI * n + i] | discs.genome[G.LIN_LO * n + i]) === 0) continue;
      const genome = new Uint32Array(GENOME_CHANNELS);
      for (let w = 0; w < GENOME_CHANNELS; w++) genome[w] = discs.genome[w * n + i];
      cells.push({ x, y, B, P, E, MOT: discs.cells[CH.MOT * n + i], genome });
      reqMass += B + P;
      reqE += E;
    }
  }
  const all = cells.length;
  let retMass = reqMass;
  while (retMass > M_ASSAY) {
    const dropped = cells.pop()!;
    retMass -= dropped.B + dropped.P;
  }
  return { pond, cx: CENTRE, cy: CENTRE, k: 0, cells, reqMass, retMass, reqE, retE: cells.reduce((a, c) => a + c.E, 0), truncated: cells.length < all };
}

/**
 * The assay world of `cfg` (tiles are 64x64 ponds) with `items[p]` planted in pond p, step 0, mutation off if
 * `cfg` says so, heatOut = lightIn = 0 and zero flux. Each pond's total matter is exactly M_ASSAY: the planted
 * B+P is taken out of A, which is spread uniformly with the remainder one quantum per cell in raster order.
 * Every distinct lineage id is relabelled to (0, k+1), k the order of first appearance in world raster order,
 * so every id is valid at step 0. Fragments must already fit M_ASSAY (`standardFragment` truncates them).
 * Returns the state (it passes `validateState`) and what landed in each pond.
 */
export function buildAssayWorld(cfg: WorldConfig, items: AssayItem[]): { state: WorldState; planted: Planted[] } {
  if (cfg.tileW !== TILE || cfg.tileH !== TILE) throw new Error(`ponds are ${TILE}x${TILE} tiles, got ${cfg.tileW}x${cfg.tileH}`);
  const R = cfg.tilesX * cfg.tilesY;
  if (items.length !== R) throw new Error(`${items.length} items for ${R} ponds`);
  const n = cellCount(cfg);
  const W = worldW(cfg);

  // Discs come from buildWorld itself (planting index = pond index); a zero-biomass one-cell placeholder holds the index of a pond without a disc.
  let discs: WorldState | null = null;
  if (items.some((it) => it?.kind === "disc")) {
    const founders: Founder[] = items.map((it, t) => {
      const tx = t % cfg.tilesX;
      const ty = (t - tx) / cfg.tilesX;
      const genome = it?.kind === "disc" ? it.genome : emptyGenome(0, 0);
      return { x: tx * cfg.tileW + CENTRE, y: ty * cfg.tileH + CENTRE, radius: it?.kind === "disc" ? 10 : 0, genome, biomass: it?.kind === "disc" ? 64 : 0, energy: it?.kind === "disc" ? 128 : 0 };
    });
    discs = buildWorld(cfg, { nutrient: 0, founders });
  }

  const state = allocState(cfg);
  state.cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
  const planted: Planted[] = [];
  items.forEach((it, p) => {
    const tx = p % cfg.tilesX;
    const ty = (p - tx) / cfg.tilesX;
    const fr = it === null ? null : it.kind === "fragment" ? it.fragment : discFragment(discs!, p);
    if (fr === null) {
      refillA(state.cells, cfg, p, M_ASSAY);
      planted.push({ reqMass: 0, retMass: 0, reqE: 0, retE: 0, landed: 0, truncated: false });
      return;
    }
    if (fr.retMass > M_ASSAY) throw new Error(`pond ${p}: fragment holds B+P ${fr.retMass}, above the budget ${M_ASSAY}`);
    let mass = 0;
    for (const cell of fr.cells) {
      const i = (ty * cfg.tileH + cell.y) * W + tx * cfg.tileW + cell.x;
      state.cells[CH.B * n + i] = cell.B;
      state.cells[CH.P * n + i] = cell.P;
      state.cells[CH.E * n + i] = cell.E;
      state.cells[CH.MOT * n + i] = cell.MOT;
      // Words of a cell without a lineage are don't-care; the canonical form zeroes them.
      if ((cell.genome[G.LIN_HI] | cell.genome[G.LIN_LO]) !== 0) for (let w = 0; w < GENOME_CHANNELS; w++) state.genome[w * n + i] = cell.genome[w];
      mass += cell.B + cell.P;
    }
    if (mass !== fr.retMass) throw new Error(`pond ${p}: landed B+P ${mass} differs from the fragment's retained ${fr.retMass}`);
    refillA(state.cells, cfg, p, M_ASSAY - mass);
    planted.push({ reqMass: fr.reqMass, retMass: fr.retMass, reqE: fr.reqE, retE: fr.retE, landed: fr.cells.length, truncated: fr.truncated });
  });

  // Relabel every distinct genome (lineage id) to (0, k+1) by first appearance in world raster order.
  const ids = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const hi = state.genome[G.LIN_HI * n + i], lo = state.genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    const key = `${hi}:${lo}`;
    let k = ids.get(key);
    if (k === undefined) ids.set(key, (k = ids.size + 1));
    state.genome[G.LIN_HI * n + i] = 0;
    state.genome[G.LIN_LO * n + i] = k;
  }

  const errs = validateState(state);
  if (errs.length) throw new Error(`invalid assay world: ${errs.join("; ")}`);
  return { state, planted };
}

/**
 * The P1 success rule: the end trait is at least 0.25 x `ref` and at least 4 x the retained landed B+P
 * (regrowth rather than persistence). 1 or 0; -1 when no reference is given.
 */
export function assaySuccess(endTrait: number, retMass: number, ref: number | undefined): number {
  if (ref === undefined) return -1;
  return 4 * endTrait >= ref && endTrait >= 4 * retMass ? 1 : 0;
}

/**
 * One assay.tsv line for a planted pond, in ASSAY_COLUMNS order. An absent fragment (`absent`) fails when a
 * reference is given and stays -1 otherwise, like `assaySuccess`.
 */
export function assayLine(p: {
  assay: string;
  source: string;
  replicate: number;
  pond: number;
  family: number;
  inoculum: string;
  planted: Planted;
  endTrait: number;
  success: number;
}): string {
  const pl = p.planted;
  return [p.assay, p.source, p.replicate, p.pond, p.family, p.inoculum, pl.reqMass, pl.retMass, p.endTrait, p.success, pl.reqE, pl.retE, pl.truncated ? 1 : 0].join("\t");
}

/**
 * The census steps of one period: every `every` steps, and the last chunk when `period` is not a multiple (the
 * steps `runPeriod` calls its census at). 100, 200, ..., 10,000 for the frozen regime.
 */
export function censusSteps(period: number, every: number): number[] {
  if (!Number.isInteger(period) || period < 1 || !Number.isInteger(every) || every < 1) throw new Error(`censusSteps: period and every must be positive integers, got ${period} and ${every}`);
  const steps: number[] = [];
  for (let s = 0; s < period; ) steps.push((s += Math.min(every, period - s)));
  return steps;
}

/**
 * The traits.tsv text of an assay: the header, then for each replicate (in the order given) every pond's trait at
 * every census step, ordered replicate, pond, step. `traits[c][pond]` is the trait of `pond` at `steps[c]`
 * (`pondTraits` of the census snapshot, so B+P over cells with B+P >= 48).
 */
export function traitsTable(replicates: { replicate: number; steps: readonly number[]; traits: readonly (readonly number[])[] }[]): string {
  const lines: string[] = [TRAIT_COLUMNS.join("\t")];
  for (const r of replicates) {
    if (r.traits.length !== r.steps.length) throw new Error(`traitsTable: ${r.traits.length} censuses for ${r.steps.length} steps (replicate ${r.replicate})`);
    const ponds = r.traits[0]?.length ?? 0;
    for (let pond = 0; pond < ponds; pond++) r.steps.forEach((step, c) => lines.push([r.replicate, pond, step, r.traits[c][pond]].join("\t")));
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------
// Labels: which history an assay directory belongs to (read back by scaffold-report)

export type AssayName = "competence" | "transmission" | "garden";

/** The `r` field of assaySeed for each assay (R3 competence, R1, R2). */
const ASSAY_R: Record<AssayName, number> = { competence: 3, transmission: 1, garden: 2 };

/** The history labels of an assay directory, as written under `labels` in assay.json. */
export interface AssayLabelSet {
  arm: "scaf" | "rand" | "cont" | "ancestor";
  /** History index i within its arm (0-5); omitted for the ancestor. */
  history?: number;
  /** 0 = time 0 (R3 timing (a)), 1 = time C (timing (b)). */
  time: 0 | 1;
  timing: "a" | "b";
  /** P1's R3 calibration: 1 = ancestor competence, 2 = its quenched control (a label; both use the same seeds). */
  calibration?: 1 | 2;
  /** Amendment 2's tau calibration: the ancestor competence set whose traits.tsv fixes tau (seeds `TAU_SEED_BASE` + s). */
  tauCalibration?: true;
}

/** The boundaries R1' (protocol, Amendment 2) replays and assays: t' = 0, 1, 2. */
export const R1_PRIME_BOUNDARIES = [34, 67, 100] as const;

/**
 * The `labels` of an R1' transmission set: the scaf or rand history and t' (0 = boundary 34, 1 = boundary 67, 2 =
 * boundary 100). R1's `time` and `timing` do not apply, so they are absent.
 */
export interface R1PrimeLabelSet {
  arm: "scaf" | "rand";
  history: number;
  r1prime: true;
  timePrime: 0 | 1 | 2;
}

/** R1' seeds are 4,845,001 + 250 h + 100 t' + s (Amendment 2); h = 6 arm + i runs 0-11, so the block ends at 4,847,960. */
export const R1_PRIME_SEED_BASE = 4_845_001;
export const R1_PRIME_SEED_MAX = 4_847_960;
/** The tau calibration's seeds are 4,849,001 + s (s = 0-1). */
export const TAU_SEED_BASE = 4_849_001;

/**
 * Seed of an R1' assay: 4,845,001 + 250 h + 100 t' + s, with h = 6 arm + i (arm 0 scaf, 1 rand; 0-11), t' 0-2 and s the
 * replicate (0-1), 8 the permutation stream or 9 the donor selection. Mixed radix (100 t' + s < 250), above
 * assaySeed's maximum 4,844,690 and below the tau calibration, so it cannot collide with either; every field is range-checked.
 */
export function r1PrimeSeed(h: number, tPrime: number, s: number): number {
  const field = (name: string, x: number, max: number) => {
    if (!Number.isInteger(x) || x < 0 || x > max) throw new Error(`r1PrimeSeed: ${name} must be an integer in 0..${max}, got ${x}`);
  };
  field("h", h, 11);
  field("t'", tPrime, 2);
  field("s", s, 9);
  const seed = R1_PRIME_SEED_BASE + 250 * h + 100 * tPrime + s;
  if (seed > R1_PRIME_SEED_MAX) throw new Error(`r1PrimeSeed: ${seed} is above ${R1_PRIME_SEED_MAX}`);
  return seed;
}

/** The labels of an R1' set from the CLI's --arm, --history and --time (t', 0-2); R1's --timing and --calibration do not apply. */
export function parseR1PrimeLabels(v: { arm?: string; history?: string; time?: string; timing?: string; calibration?: string }): R1PrimeLabelSet {
  if (v.arm !== "scaf" && v.arm !== "rand") throw new Error(`--arm must be scaf|rand for --r1prime, got ${v.arm}`);
  const i = Number(v.history);
  if (v.history === undefined || !Number.isInteger(i) || i < 0 || i > 5) throw new Error(`--history must be 0-5 for --r1prime, got ${v.history}`);
  if (v.time !== "0" && v.time !== "1" && v.time !== "2") throw new Error(`--time must be 0, 1 or 2 (t': boundary 34, 67, 100) for --r1prime, got ${v.time}`);
  if (v.timing !== undefined || v.calibration !== undefined) throw new Error("--r1prime takes --time (t'), not --timing or --calibration");
  return { arm: v.arm, history: i, r1prime: true, timePrime: Number(v.time) as 0 | 1 | 2 };
}

/** The labels of the tau calibration: the ancestor competence set at timing (a), marked `tauCalibration`. */
export const TAU_LABELS: AssayLabelSet = { arm: "ancestor", time: 0, timing: "a", tauCalibration: true };

/** h = 6 arm + i of an R1' history (0-11). */
export const r1PrimeH = (labels: Pick<R1PrimeLabelSet, "arm" | "history">): number => 6 * (labels.arm === "scaf" ? 0 : 1) + labels.history;

/** Throws unless the seeds of replicate `replicate` are `r1PrimeSeed(h, t', replicate)` for the labelled history and boundary (fragment and physics alike). */
export function checkR1PrimeSeeds(labels: R1PrimeLabelSet, seeds: { physics: number; fragment: number }, replicate = 0): void {
  const want = r1PrimeSeed(r1PrimeH(labels), labels.timePrime, replicate);
  for (const [name, seed] of [["seed", seeds.physics], ["fragment seed", seeds.fragment]] as const) {
    if (seed !== want) throw new Error(`${name} ${seed} does not match the R1' labels (${JSON.stringify(labels)}): want r1PrimeSeed(h, t', ${replicate}) = ${want}`);
  }
}

/** R1' draws its donors with s = 9 (`r1PrimeSeed(h, t', 9)`), and permutes with s = 8. */
export const r1PrimeDonorSeedOf = (labels: R1PrimeLabelSet): number => r1PrimeSeed(r1PrimeH(labels), labels.timePrime, 9);

/** Throws unless `donorSeed` is `r1PrimeDonorSeedOf(labels)`. */
export function checkR1PrimeDonorSeed(labels: R1PrimeLabelSet, donorSeed: number): void {
  const want = r1PrimeDonorSeedOf(labels);
  if (donorSeed !== want) throw new Error(`donor seed ${donorSeed} does not match the R1' labels (${JSON.stringify(labels)}): want r1PrimeSeed(h, t', 9) = ${want}`);
}

/** Throws unless both seeds of replicate `replicate` are 4,849,001 + replicate (the tau calibration's streams). */
export function checkTauSeeds(seeds: { physics: number; fragment: number }, replicate = 0): void {
  const want = TAU_SEED_BASE + replicate;
  if (seeds.physics !== want || seeds.fragment !== want) throw new Error(`the tau calibration needs seed ${want} for replicate ${replicate}, got ${seeds.physics} (fragment ${seeds.fragment})`);
}

// ---------------------------------------------------------------------------------------------
// R1'' (docs/scaffold-heredity-replication-v1.md): the crossing-time replication on fresh histories

/**
 * The 18 sets R1'' assays, by h: 0-11 the fresh histories (h = 6 arm + i, arm 0 scaf, 1 rand), 12-13 the positive-control
 * worlds (the P2 ranking worlds s0, s1 at b1-pre), 14-17 the negative-control worlds (mutation-off clone worlds j = 0-3 at b1-pre).
 */
export const R1DP_SETS = 18;
const R1DP_HISTORIES = 12;
const R1DP_POSITIVE = 12;
const R1DP_NEGATIVE = 14;

/** R1'' assay seeds are 4,812,001 + 250 h + s (s = 0-1 the replicates, 8 the permutation stream, 9 the donor selection); h runs 0-17, so the block ends at 4,816,260. */
export const R1DP_SEED_BASE = 4_812_001;
export const R1DP_SEED_MAX = 4_816_260;
/** World seeds of what is assayed: the fresh histories' 4,811,001 + 100 arm + i, the P2 ranking worlds' 4,805,001 + s and the negative controls' 4,811,201 + j. */
export const R1DP_HISTORY_SEED_BASE = 4_811_001;
export const R1DP_POSITIVE_SEED_BASE = 4_805_001;
export const R1DP_NEGATIVE_SEED_BASE = 4_811_201;
/** A fresh history is assayed at boundary 34's pre-cycle state (34 periods in); a control at its b1-pre (one period in). */
export const R1DP_FRESH_STEP = 340_000;
export const R1DP_CONTROL_STEP = 10_000;
/** The regime every R1'' assay runs at: protocol v1's frozen k and period, the standard side and replicates, a census every 100 steps. */
export const R1DP_REGIME = { k: 8, period: 10_000, side: 8, replicates: 2, censusEvery: 100 } as const;

/**
 * Seed of an R1'' assay: 4,812,001 + 250 h + s, with h 0-17 (see `R1DP_SETS`) and s the replicate (0-1), 8 the permutation
 * stream or 9 the donor selection. Mixed radix (s < 250), below assaySeed's minimum 4,820,001 and clear of the world seeds
 * 4,805,001-4,811,204, so it cannot collide with them or with R1' and the tau calibration above; every field is range-checked.
 */
export function r1dPrimeSeed(h: number, s: number): number {
  const field = (name: string, x: number, max: number) => {
    if (!Number.isInteger(x) || x < 0 || x > max) throw new Error(`r1dPrimeSeed: ${name} must be an integer in 0..${max}, got ${x}`);
  };
  field("h", h, R1DP_SETS - 1);
  field("s", s, 9);
  const seed = R1DP_SEED_BASE + 250 * h + s;
  if (seed > R1DP_SEED_MAX) throw new Error(`r1dPrimeSeed: ${seed} is above ${R1DP_SEED_MAX}`);
  return seed;
}

/**
 * The `labels` of an R1'' transmission set: `arm` scaf or rand with its history index i (0-5) for a fresh history, `arm`
 * control for a control with `control` positive or negative and `history` the world (positive s = 0-1, negative j = 0-3).
 * `h` is the one index that keys the seeds.
 */
export interface R1dPrimeLabelSet {
  arm: "scaf" | "rand" | "control";
  history: number;
  r1dprime: true;
  h: number;
  control?: "positive" | "negative";
}

/** The labels h names. */
export function r1dPrimeLabelsOf(h: number): R1dPrimeLabelSet {
  if (!Number.isInteger(h) || h < 0 || h >= R1DP_SETS) throw new Error(`R1'' h must be an integer in 0..${R1DP_SETS - 1}, got ${h}`);
  if (h < R1DP_HISTORIES) return { arm: h < 6 ? "scaf" : "rand", history: h % 6, r1dprime: true, h };
  if (h < R1DP_NEGATIVE) return { arm: "control", history: h - R1DP_POSITIVE, r1dprime: true, h, control: "positive" };
  return { arm: "control", history: h - R1DP_NEGATIVE, r1dprime: true, h, control: "negative" };
}

/** The set's name in a report: scaf-i0..rand-i5, pos-s0..pos-s1, neg-j0..neg-j3. */
export function r1dPrimeIdOf(l: Pick<R1dPrimeLabelSet, "arm" | "history" | "control">): string {
  return l.arm === "control" ? (l.control === "positive" ? `pos-s${l.history}` : `neg-j${l.history}`) : `${l.arm}-i${l.history}`;
}

/**
 * The labels of an R1'' set from the CLI's --h, --arm, --history and --control. --h (0-17) names the set; --arm must be
 * the one it implies (scaf for 0-5, rand for 6-11, control for 12-17), a fresh history needs --history i = h mod 6, and a control
 * needs --control positive (12-13) or negative (14-17) and takes --history (the world, 0-1 or 0-3) only if it agrees. R1's
 * --time, --timing and --calibration do not apply.
 */
export function parseR1dPrimeLabels(v: { h?: string; arm?: string; history?: string; control?: string; time?: string; timing?: string; calibration?: string }): R1dPrimeLabelSet {
  const int = (s: string | undefined): number => (s === undefined || s.trim() === "" ? NaN : Number(s));
  const h = int(v.h);
  if (!Number.isInteger(h) || h < 0 || h >= R1DP_SETS) throw new Error(`--h must be 0-${R1DP_SETS - 1} for --r1dprime, got ${v.h}`);
  if (v.time !== undefined || v.timing !== undefined || v.calibration !== undefined) throw new Error("--r1dprime takes --h, not --time, --timing or --calibration");
  const want = r1dPrimeLabelsOf(h);
  if (v.arm !== want.arm) throw new Error(`--arm must be ${want.arm} for --h ${h}, got ${v.arm}`);
  if (want.arm === "control") {
    if (v.control !== want.control) throw new Error(`--control must be ${want.control} for --h ${h}, got ${v.control}`);
    if (v.history !== undefined && int(v.history) !== want.history) throw new Error(`--history must be ${want.history} for --h ${h} (the ${want.control} control world), got ${v.history}`);
  } else {
    if (v.control !== undefined) throw new Error(`--control applies to --arm control, not --arm ${want.arm}`);
    if (int(v.history) !== want.history) throw new Error(`--history must be ${want.history} for --h ${h} (${want.arm}), got ${v.history}`);
  }
  return want;
}

/** Throws unless the seeds of replicate `replicate` are `r1dPrimeSeed(h, replicate)` for the labelled set (fragment and physics alike). */
export function checkR1dPrimeSeeds(labels: Pick<R1dPrimeLabelSet, "h">, seeds: { physics: number; fragment: number }, replicate = 0): void {
  const want = r1dPrimeSeed(labels.h, replicate);
  for (const [name, seed] of [["seed", seeds.physics], ["fragment seed", seeds.fragment]] as const) {
    if (seed !== want) throw new Error(`${name} ${seed} does not match the R1'' labels (h ${labels.h}): want r1dPrimeSeed(h, ${replicate}) = ${want}`);
  }
}

/** R1'' draws its donors with s = 9 (`r1dPrimeSeed(h, 9)`), and permutes with s = 8. */
export const r1dPrimeDonorSeedOf = (labels: Pick<R1dPrimeLabelSet, "h">): number => r1dPrimeSeed(labels.h, 9);

/** Throws unless `donorSeed` is `r1dPrimeDonorSeedOf(labels)`. */
export function checkR1dPrimeDonorSeed(labels: Pick<R1dPrimeLabelSet, "h">, donorSeed: number): void {
  const want = r1dPrimeDonorSeedOf(labels);
  if (donorSeed !== want) throw new Error(`donor seed ${donorSeed} does not match the R1'' labels (h ${labels.h}): want r1dPrimeSeed(h, 9) = ${want}`);
}

/**
 * The checkpoint phase of an R1'' source, measured on its state. The pond cycle (a host-side transform at each boundary) builds a
 * post-cycle state from scratch: C and S are 0 in every cell, and bound mass and genome words sit only in the k x k landing windows
 * at the pond centres. A pre-cycle state has grown for a whole period, so it holds C or S and carries mass outside the windows.
 * `carrying` counts the cells with bound mass (B+P > 0) or a lineage id, `outsideWindow` those of them outside their pond's landing
 * window (k = 8), `postCycle` is `postCycleOf` of the measures.
 */
export interface R1dPrimePhase {
  totalC: number;
  totalS: number;
  carrying: number;
  outsideWindow: number;
  postCycle: boolean;
}

/**
 * Whether a state looks post-cycle (or is a fresh one: step 0 has C = S = 0 as well): C and S are 0 in every cell, or its bound mass
 * and lineages are confined to the landing windows (and there are some). Neither holds for a grown pre-cycle state.
 */
export const postCycleOf = (m: Pick<R1dPrimePhase, "totalC" | "totalS" | "carrying" | "outsideWindow">): boolean => (m.totalC === 0 && m.totalS === 0) || (m.carrying > 0 && m.outsideWindow === 0);

/** The phase of `state`: its C and S totals and how much of its bound mass lies outside the k x k landing window of each pond. */
export function r1dPrimePhase(state: WorldState, k = R1DP_REGIME.k): R1dPrimePhase {
  const cfg = state.cfg;
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const lo = CENTRE - (k >> 1);
  const hi = lo + k - 1;
  let totalC = 0, totalS = 0, carrying = 0, outsideWindow = 0;
  for (let i = 0; i < n; i++) {
    totalC += state.cells[CH.C * n + i];
    totalS += state.cells[CH.S * n + i];
    if (state.cells[CH.B * n + i] + state.cells[CH.P * n + i] === 0 && (state.genome[G.LIN_HI * n + i] | state.genome[G.LIN_LO * n + i]) === 0) continue;
    carrying++;
    const x = (i % W) % cfg.tileW;
    const y = Math.floor(i / W) % cfg.tileH;
    if (x < lo || x > hi || y < lo || y > hi) outsideWindow++;
  }
  return { totalC, totalS, carrying, outsideWindow, postCycle: postCycleOf({ totalC, totalS, carrying, outsideWindow }) };
}

/**
 * What an R1'' assay records about its source checkpoint (assay.json `provenance`): the path, the state hash, the world seed and
 * mutation rate its config carries, the step it was saved at, its pond grid, how many distinct genomes (lineage ids aside) its cells
 * hold (12 in a founders world, 1 in a clone world with mutation off), and the phase check (`R1dPrimePhase`).
 */
export interface R1dPrimeProvenance {
  source: string;
  stateHash: string;
  seed: number;
  mutRate: number;
  step: number;
  tilesX: number;
  tilesY: number;
  distinctGenomes: number;
  phase: R1dPrimePhase;
}

/** The distinct genomes carried by the cells that have a lineage id, compared on every word but the id's two. */
export function distinctGenomes(state: WorldState): number {
  const n = cellCount(state.cfg);
  const kinds = new Set<string>();
  for (let i = 0; i < n; i++) {
    if ((state.genome[G.LIN_HI * n + i] | state.genome[G.LIN_LO * n + i]) === 0) continue;
    let key = "";
    for (let w = 0; w < GENOME_CHANNELS; w++) if (w !== G.LIN_HI && w !== G.LIN_LO) key += `${state.genome[w * n + i]},`;
    kinds.add(key);
  }
  return kinds.size;
}

/** The provenance of `source`, read from its checkpoint (`path` is where it was loaded from). */
export function r1dPrimeProvenance(path: string, source: WorldState): R1dPrimeProvenance {
  const { seed, mutRate, tilesX, tilesY } = source.cfg;
  return { source: path, stateHash: stateHash(source), seed, mutRate, step: source.step, tilesX, tilesY, distinctGenomes: distinctGenomes(source), phase: r1dPrimePhase(source) };
}

/** The checkpoint an R1'' set is assayed at: boundary 34's pre-cycle state of a fresh history, b1-pre of a control. */
export const r1dPrimeCheckpointOf = (h: number): "b34-pre" | "b1-pre" => (r1dPrimeLabelsOf(h).arm === "control" ? "b1-pre" : "b34-pre");

/**
 * What is wrong with an R1'' source against the set it is labelled as (none: it is the protocol's). A fresh history's source is
 * boundary 34's pre-cycle state: config seed 4,811,001 + 100 arm + i, step 340,000, the default mutation rate. A positive
 * control's is a founders world (more than one genome), mutation off, seed 4,805,001 + (h - 12), at b1-pre (step 10,000); a negative
 * control's is a clone world (one genome), mutation off, seed 4,811,201 + (h - 14), at b1-pre. All are 8 x 8 ponds. The path must end
 * in ckpt/b34-pre.blck.gz (fresh) or ckpt/b1-pre.blck.gz (control), and the state must not look post-cycle (`postCycleOf`): a
 * b34-post checkpoint has the same seed, mutation rate and step as b34-pre, so the name and the content both say which it is. The
 * recorded `phase.postCycle` must be the one its own measures give.
 */
export function r1dPrimeSourceProblems(labels: Pick<R1dPrimeLabelSet, "h">, p: Pick<R1dPrimeProvenance, "source" | "seed" | "mutRate" | "step" | "tilesX" | "tilesY" | "distinctGenomes" | "phase">): string[] {
  const l = r1dPrimeLabelsOf(labels.h);
  const why: string[] = [];
  const file = r1dPrimeCheckpointOf(labels.h);
  if (!new RegExp(`(^|/)ckpt/${file}\\.blck\\.gz$`).test(p.source)) why.push(`source path ${JSON.stringify(p.source)} does not end in ckpt/${file}.blck.gz`);
  const want = (name: string, got: number, expected: number) => {
    if (got !== expected) why.push(`source ${name} ${got}, want ${expected}`);
  };
  if (l.arm === "control") {
    const positive = l.control === "positive";
    want("seed", p.seed, (positive ? R1DP_POSITIVE_SEED_BASE : R1DP_NEGATIVE_SEED_BASE) + l.history);
    want("mutRate", p.mutRate, 0);
    want("step", p.step, R1DP_CONTROL_STEP);
    if (positive ? !(p.distinctGenomes > 1) : p.distinctGenomes !== 1) why.push(`source holds ${p.distinctGenomes} distinct genomes, want ${positive ? "more than 1 (a founders world)" : "1 (a clone world)"}`);
  } else {
    want("seed", p.seed, R1DP_HISTORY_SEED_BASE + 100 * (l.arm === "scaf" ? 0 : 1) + l.history);
    want("mutRate", p.mutRate, pondConfig(R1DP_REGIME.side, 0).mutRate);
    want("step", p.step, R1DP_FRESH_STEP);
  }
  if (p.tilesX !== R1DP_REGIME.side || p.tilesY !== R1DP_REGIME.side) why.push(`source has ${p.tilesX} x ${p.tilesY} ponds, want ${R1DP_REGIME.side} x ${R1DP_REGIME.side}`);
  const post = postCycleOf(p.phase);
  if (p.phase.postCycle !== post) why.push(`source phase flag postCycle ${p.phase.postCycle} disagrees with its measures (${post})`);
  if (post) why.push(`source looks post-cycle (C ${p.phase.totalC}, S ${p.phase.totalS}; ${p.phase.outsideWindow} of ${p.phase.carrying} cells with bound mass or a lineage outside the landing window), want the pre-cycle state`);
  return why;
}

// ---------------------------------------------------------------------------------------------
// R3 replication (docs/scaffold-r3-replication-v1.md): protocol v1's R3 on fresh histories

/** The regime every R3-replication competence assay runs at: protocol v1's frozen k and period, ref 103,058 (Amendment 1), the standard side and replicates, a census every 100 steps. */
export const R3REP_REGIME = { k: 8, period: 10_000, ref: 103_058, side: 8, replicates: 2, censusEvery: 100 } as const;

/** The source worlds by h: 0-17 the histories (h = 6 arm + i; arm 0 scaf, 1 rand, 2 cont), 18 the ancestor. */
export const R3REP_ANCESTOR_H = 18;
const R3REP_ARMS = ["scaf", "rand", "cont"] as const;

/** Competence seeds are 4,816,301 + 100 h + 10 t + s (h 0-18, t 0-1, s 0-1), so the block ends at 4,818,112. */
export const R3REP_SEED_BASE = 4_816_301;
export const R3REP_SEED_MAX = 4_818_112;
/** A continuation (timing b) runs 2 x 10^5 steps with seed 4,818,301 + h. */
export const R3REP_CONTINUE_SEED_BASE = 4_818_301;
export const R3REP_CONTINUE_STEPS = 200_000;
/** World seeds: scaf and rand 4,811,001 + 100 arm + i (the R1'' fresh histories), cont 4,811,301 + i, the ancestor world 4,818,401. */
export const R3REP_HISTORY_SEED_BASE = R1DP_HISTORY_SEED_BASE;
export const R3REP_CONT_SEED_BASE = 4_811_301;
export const R3REP_ANCESTOR_SEED = 4_818_401;
/** A history runs C = 100 cycles; the ancestor world is grown one period (cycles 1). */
export const R3REP_CYCLES = 100;

/**
 * The protocol documents the replication runs under, pinned by SHA-256 and length: docs/scaffold-r3-replication-v1.md as committed
 * before any run, and docs/scaffold-protocol-v1.md as the histories' meta.json records it (the R1'' histories ran under it, and
 * tools/scaffold.ts --resume requires it of their extension). After the first run any change goes in a dated amendment at the end, so each
 * document keeps beginning with its pinned bytes. Sets, sidecars and runs are checked against these hashes, never against a document as
 * it is now, so recording the results (or any amendment) neither stops the runs nor rejects their sets.
 */
export const R3REP_PROTOCOLS = {
  protocol: { doc: "docs/scaffold-protocol-v1.md", sha256: "39fe21f05b1768e9b8ec45059aa37f5e84c0d7b504a6ee7805e76de0daf5cd4a", bytes: 38_254 },
  r3rep: { doc: "docs/scaffold-r3-replication-v1.md", sha256: "a77bd55e6e1e2e90c03447c5ae5bf988a5d36ab6e49cdca7b9feb582ffae1f1b", bytes: 12_507 },
} as const;
/** The pinned hashes in the shape the checks take: protocol v1's (run meta.json `protocolSha256`) and the replication's (`protocolSha256R3rep`). */
export const R3REP_SHA256 = { protocol: R3REP_PROTOCOLS.protocol.sha256, r3rep: R3REP_PROTOCOLS.r3rep.sha256 } as const;

/** Genome words as hex, 8 digits a word (as assay.json records them), and bytes as hex. */
const hexWords = (w: ArrayLike<number>): string => Array.from(w, (x) => x.toString(16).padStart(8, "0")).join("");
const hexBytes = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * What is wrong with `doc` (a pinned document's bytes as they are now) as its pinned text followed by amendments only: its first
 * `bytes` bytes must hash to the pinned SHA-256 (`R3REP_PROTOCOLS`).
 */
export async function r3RepProtocolProblems(which: keyof typeof R3REP_PROTOCOLS, doc: Uint8Array): Promise<string[]> {
  return await pinnedTextProblems(R3REP_PROTOCOLS[which], doc);
}

/** What is wrong with `doc` as the pinned document `pin` (its first `bytes` bytes hashing to `sha256`) followed by amendments only. */
export async function pinnedTextProblems(pin: { doc: string; sha256: string; bytes: number }, doc: Uint8Array): Promise<string[]> {
  if (doc.length < pin.bytes) return [`${pin.doc} has ${doc.length} bytes, fewer than the ${pin.bytes} it had when pinned`];
  const sha = hexBytes(new Uint8Array(await crypto.subtle.digest("SHA-256", doc.slice(0, pin.bytes))));
  if (sha === pin.sha256) return [];
  return [`${pin.doc} no longer begins with its pinned text (SHA-256 ${pin.sha256}; its first ${pin.bytes} bytes hash to ${sha}): a change after the first run goes in a dated amendment at the end`];
}

/**
 * Seed of an R3-replication competence assay: 4,816,301 + 100 h + 10 t + s, with h 0-18 (`R3REP_ANCESTOR_H`), t 0 for timing (a)
 * and 1 for (b), s the replicate (0-1). Mixed radix (10 t + s < 100), above the R1'' block (which ends at 4,816,260) and below the
 * continuation seeds and assaySeed's minimum 4,820,001; every field is range-checked.
 */
export function r3RepSeed(h: number, t: number, s: number): number {
  const field = (name: string, x: number, max: number) => {
    if (!Number.isInteger(x) || x < 0 || x > max) throw new Error(`r3RepSeed: ${name} must be an integer in 0..${max}, got ${x}`);
  };
  field("h", h, R3REP_ANCESTOR_H);
  field("t", t, 1);
  field("s", s, R3REP_REGIME.replicates - 1);
  const seed = R3REP_SEED_BASE + 100 * h + 10 * t + s;
  if (seed > R3REP_SEED_MAX) throw new Error(`r3RepSeed: ${seed} is above ${R3REP_SEED_MAX}`);
  return seed;
}

/** Seed of the continuation of source h (0-18) to timing (b): 4,818,301 + h. */
export function r3RepContinueSeed(h: number): number {
  if (!Number.isInteger(h) || h < 0 || h > R3REP_ANCESTOR_H) throw new Error(`r3RepContinueSeed: h must be an integer in 0..${R3REP_ANCESTOR_H}, got ${h}`);
  return R3REP_CONTINUE_SEED_BASE + h;
}

export type R3RepArm = "scaf" | "rand" | "cont" | "ancestor";

/** A source world of the replication: `arm` with its history index i (0-5; -1 for the ancestor) and h = 6 arm + i (18 for the ancestor). */
export interface R3RepHistory {
  arm: R3RepArm;
  history: number;
  h: number;
}

/**
 * The `labels` of an R3-replication competence set: the source world (`arm`, `history`, `h`) at `timing`. `arm`, `history` and `timing`
 * are what scaffold-report's `assayLabels` reads into an AssaySet for v1's `r3Evaluate`; `h` keys the seeds. The variant is the set's inoculum.
 */
export interface R3RepLabelSet {
  arm: R3RepArm;
  history: number;
  timing: "a" | "b";
  r3rep: true;
  h: number;
}

/** The competence variants: the source's own fragments, the quenched control, Ge-on-Fa (`swap-ea`) and Ga-on-Fe (`swap-ae`). */
export const R3REP_INOCULA = ["fragment", "quenched", "swap-ea", "swap-ae"] as const;
export type R3RepInoculum = (typeof R3REP_INOCULA)[number];

/** The source world h names. */
export function r3RepHistoryOf(h: number): R3RepHistory {
  if (!Number.isInteger(h) || h < 0 || h > R3REP_ANCESTOR_H) throw new Error(`R3-replication h must be an integer in 0..${R3REP_ANCESTOR_H}, got ${h}`);
  if (h === R3REP_ANCESTOR_H) return { arm: "ancestor", history: -1, h };
  return { arm: R3REP_ARMS[Math.floor(h / 6)], history: h % 6, h };
}

/** The labels of source h at `timing`. */
export function r3RepLabelsOf(h: number, timing: "a" | "b"): R3RepLabelSet {
  if (timing !== "a" && timing !== "b") throw new Error(`R3-replication timing must be a or b, got ${JSON.stringify(timing)}`);
  const { arm, history } = r3RepHistoryOf(h);
  return { arm, history, timing, r3rep: true, h };
}

/** A source world's name in a report and on disk: scaf-i0..cont-i5, or ancestor. */
export const r3RepIdOf = (l: Pick<R3RepHistory, "arm" | "history">): string => (l.arm === "ancestor" ? "ancestor" : `${l.arm}-i${l.history}`);

/** A set's name: the source, the timing and the variant (scaf-i0-a, scaf-i0-b-quenched, scaf-i0-a-swap-ea, ancestor-b, ...). */
export const r3RepSetIdOf = (l: Pick<R3RepLabelSet, "arm" | "history" | "timing">, inoculum: string): string => `${r3RepIdOf(l)}-${l.timing}${inoculum === "fragment" ? "" : `-${inoculum}`}`;

/**
 * The 62 sets the replication runs, in the protocol's order: per history i, scaf, rand and cont at (a) and (b), then scaf_i's Ge-on-Fa and
 * Ga-on-Fe at (a) and its quenched controls at (a) and (b); then the ancestor at (a) and (b).
 */
export function r3RepExpectedSets(): { labels: R3RepLabelSet; inoculum: R3RepInoculum }[] {
  const sets: { labels: R3RepLabelSet; inoculum: R3RepInoculum }[] = [];
  for (let i = 0; i < 6; i++) {
    for (let arm = 0; arm < 3; arm++) for (const timing of ["a", "b"] as const) sets.push({ labels: r3RepLabelsOf(6 * arm + i, timing), inoculum: "fragment" });
    sets.push({ labels: r3RepLabelsOf(i, "a"), inoculum: "swap-ea" }, { labels: r3RepLabelsOf(i, "a"), inoculum: "swap-ae" });
    sets.push({ labels: r3RepLabelsOf(i, "a"), inoculum: "quenched" }, { labels: r3RepLabelsOf(i, "b"), inoculum: "quenched" });
  }
  for (const timing of ["a", "b"] as const) sets.push({ labels: r3RepLabelsOf(R3REP_ANCESTOR_H, timing), inoculum: "fragment" });
  return sets;
}

/** The source world of the CLI's --arm and --history; --h is derived (6 arm + i, 18 for the ancestor) and, if given, must agree. */
function parseR3RepHistory(v: { arm?: string; history?: string; h?: string }): R3RepHistory {
  const int = (s: string | undefined): number => (s === undefined || s.trim() === "" ? NaN : Number(s));
  if (v.arm !== "scaf" && v.arm !== "rand" && v.arm !== "cont" && v.arm !== "ancestor") throw new Error(`--arm must be scaf|rand|cont|ancestor for --r3rep, got ${v.arm}`);
  let h: number = R3REP_ANCESTOR_H;
  if (v.arm === "ancestor") {
    if (v.history !== undefined) throw new Error("--history does not apply to the ancestor");
  } else {
    const i = int(v.history);
    if (!Number.isInteger(i) || i < 0 || i > 5) throw new Error(`--history must be 0-5 for arm ${v.arm}, got ${v.history}`);
    h = 6 * R3REP_ARMS.indexOf(v.arm) + i;
  }
  if (v.h !== undefined && int(v.h) !== h) throw new Error(`--h ${v.h} disagrees with --arm ${v.arm}${v.arm === "ancestor" ? "" : ` --history ${v.history}`}: h is derived (6 arm + i, 18 for the ancestor), here ${h}`);
  return r3RepHistoryOf(h);
}

/** The labels of an R3-replication competence set from the CLI's --arm, --history, --timing (a|b) and optional --h; R1's --time and --calibration and the R1'' --control do not apply. */
export function parseR3RepLabels(v: { arm?: string; history?: string; timing?: string; h?: string; time?: string; calibration?: string; control?: string }): R3RepLabelSet {
  if (v.time !== undefined || v.calibration !== undefined || v.control !== undefined) throw new Error("--r3rep takes --arm, --history and --timing a|b, not --time, --calibration or --control");
  if (v.timing !== "a" && v.timing !== "b") throw new Error(`--timing must be a or b for --r3rep, got ${v.timing}`);
  return r3RepLabelsOf(parseR3RepHistory(v).h, v.timing);
}

/** The source world of `continue --r3rep` from --arm, --history and optional --h; the continuation makes the timing (b) source, so --timing and --time do not apply. */
export function parseR3RepContinueLabels(v: { arm?: string; history?: string; h?: string; timing?: string; time?: string; calibration?: string; control?: string }): R3RepHistory {
  if (v.timing !== undefined || v.time !== undefined || v.calibration !== undefined || v.control !== undefined) throw new Error("continue --r3rep takes --arm and --history (it makes the timing (b) source), not --timing, --time, --calibration or --control");
  return parseR3RepHistory(v);
}

/** The `labels` of an assay.json as an R3-replication set (consistent with its h), or why they are not one. */
export function r3RepLabelsFromJson(labels: unknown): { labels: R3RepLabelSet } | { error: string } {
  const l = (typeof labels === "object" && labels !== null ? labels : {}) as Record<string, unknown>;
  if (l.r3rep !== true) return { error: "labels.r3rep is not true" };
  const h = l.h;
  if (!Number.isInteger(h) || (h as number) < 0 || (h as number) > R3REP_ANCESTOR_H) return { error: `labels.h ${JSON.stringify(h)}, want 0-${R3REP_ANCESTOR_H}` };
  if (l.timing !== "a" && l.timing !== "b") return { error: `labels.timing ${JSON.stringify(l.timing)}, want a or b` };
  const want = r3RepLabelsOf(h as number, l.timing);
  for (const key of ["arm", "history"] as const) if (l[key] !== want[key]) return { error: `labels.${key} ${JSON.stringify(l[key])}, want ${JSON.stringify(want[key])} for h ${h}` };
  return { labels: want };
}

/** The world seed of source h: 4,811,001 + 100 arm + i (scaf, rand), 4,811,301 + i (cont), 4,818,401 (the ancestor). */
export function r3RepWorldSeedOf(h: number): number {
  const l = r3RepHistoryOf(h);
  if (l.arm === "ancestor") return R3REP_ANCESTOR_SEED;
  return l.arm === "cont" ? R3REP_CONT_SEED_BASE + l.history : R3REP_HISTORY_SEED_BASE + 100 * R3REP_ARMS.indexOf(l.arm) + l.history;
}

/** The h a set's seeds carry: the labelled one, except Ge-on-Fa (`swap-ea`), whose fragments come from the ancestor's (a), so 18. */
export const r3RepSeedHOf = (labels: Pick<R3RepLabelSet, "h">, inoculum: string): number => (inoculum === "swap-ea" ? R3REP_ANCESTOR_H : labels.h);

/** The seed of replicate s of a set (fragment sampling and physics alike): r3RepSeed(h', t, s), h' from `r3RepSeedHOf`. */
export const r3RepSeedOf = (labels: Pick<R3RepLabelSet, "h" | "timing">, inoculum: string, s: number): number => r3RepSeed(r3RepSeedHOf(labels, inoculum), labels.timing === "a" ? 0 : 1, s);

/** Throws unless the seeds of replicate `replicate` are `r3RepSeedOf(labels, inoculum, replicate)` (fragment and physics alike). */
export function checkR3RepSeeds(labels: Pick<R3RepLabelSet, "h" | "timing">, inoculum: string, seeds: { physics: number; fragment: number }, replicate = 0): void {
  const hs = r3RepSeedHOf(labels, inoculum);
  const t = labels.timing === "a" ? 0 : 1;
  const want = r3RepSeed(hs, t, replicate);
  for (const [name, seed] of [["seed", seeds.physics], ["fragment seed", seeds.fragment]] as const) {
    if (seed !== want) throw new Error(`${name} ${seed} does not match the R3-replication labels (h ${labels.h}, timing ${labels.timing}, ${inoculum}): want r3RepSeed(${hs}, ${t}, ${replicate}) = ${want}`);
  }
}

/** What is wrong with a variant for its labels: Ge-on-Fa and Ga-on-Fe test a scaf history at timing (a), the quenched control a scaf history at either timing. */
export function r3RepVariantProblems(labels: Pick<R3RepLabelSet, "arm" | "timing">, inoculum: string): string[] {
  if (!(R3REP_INOCULA as readonly string[]).includes(inoculum)) return [`inoculum ${JSON.stringify(inoculum)}, want one of ${R3REP_INOCULA.join(", ")}`];
  const why: string[] = [];
  if (inoculum !== "fragment" && labels.arm !== "scaf") why.push(`${inoculum} labels a scaf history, not ${labels.arm}`);
  if ((inoculum === "swap-ea" || inoculum === "swap-ae") && labels.timing !== "a") why.push(`${inoculum} runs at timing a only, not ${labels.timing}`);
  return why;
}

/** What is wrong with an assay's regime (assay.json's k, period, ref, side, replicates and censusEvery) against `R3REP_REGIME`. */
export function r3RepRegimeProblems(x: { k: unknown; period: unknown; ref: unknown; side: unknown; replicates: unknown; censusEvery: unknown }): string[] {
  const why: string[] = [];
  for (const key of ["k", "period", "ref", "side", "replicates", "censusEvery"] as const) if (x[key] !== R3REP_REGIME[key]) why.push(`${key} ${JSON.stringify(x[key])}, want ${R3REP_REGIME[key]}`);
  return why;
}

/** The run directory of source h under runs/scaffold/: r3rep/main/<arm>/i<i>, or r3rep/anc for the ancestor world. */
export const r3RepRunDirOf = (h: number): string => {
  const l = r3RepHistoryOf(h);
  return l.arm === "ancestor" ? "r3rep/anc" : `r3rep/main/${l.arm}/i${l.history}`;
};

/** Where `continue --r3rep` writes source h's timing (b) state, under runs/scaffold/: r3rep/cont200k/<arm>-i<i>.blck.gz, or ancestor.blck.gz. */
export const r3RepContinuationPathOf = (h: number): string => `r3rep/cont200k/${r3RepIdOf(r3RepHistoryOf(h))}.blck.gz`;

/** `path` ends in `tail` at a path-component boundary. */
export const endsInPath = (path: string, tail: string): boolean => path === tail || path.endsWith(`/${tail}`);

/**
 * The boundary N of a timing (a) source path of h, which must end in `<run dir>/ckpt/b<N>-pre.blck.gz` (`r3RepRunDirOf`) with N 1-100
 * for a history and N = 1 for the ancestor world; null when it does not.
 */
export function r3RepBoundaryOf(h: number, path: string): number | null {
  const m = new RegExp(`(^|/)${r3RepRunDirOf(h)}/ckpt/b([1-9]\\d*)-pre\\.blck\\.gz$`).exec(path);
  if (!m) return null;
  const N = Number(m[2]);
  return N <= (h === R3REP_ANCESTOR_H ? 1 : R3REP_CYCLES) ? N : null;
}

/** The sidecar of a continuation checkpoint: `<path minus .blck.gz>.json`. */
export function r3RepSidecarPathOf(ckpt: string): string {
  if (!ckpt.endsWith(".blck.gz")) throw new Error(`a continuation checkpoint's path ends in .blck.gz, got ${ckpt}`);
  return `${ckpt.slice(0, -".blck.gz".length)}.json`;
}

/** A checkpoint as the replication records it: the path, the state hash, the world seed and mutation rate its config carries, its step and pond grid. */
export interface R3RepCheckpoint {
  source: string;
  stateHash: string;
  seed: number;
  mutRate: number;
  step: number;
  tilesX: number;
  tilesY: number;
}

/** The record of `state`, loaded from `path`. */
export function r3RepCheckpointOf(path: string, state: WorldState): R3RepCheckpoint {
  const { seed, mutRate, tilesX, tilesY } = state.cfg;
  return { source: path, stateHash: stateHash(state), seed, mutRate, step: state.step, tilesX, tilesY };
}

/** The fields of a run directory's meta.json and done.json (tools/scaffold.ts) that a source's validation reads; null for a file that is missing or unreadable. */
export interface R3RepRunRecord {
  meta: Record<string, unknown> | null;
  done: Record<string, unknown> | null;
}

const RUN_META_KEYS = ["arm", "k", "period", "cycles", "side", "seed", "mutRate", "init", "censusEvery", "protocolSha256"] as const;
const RUN_DONE_KEYS = ["ok", "conservationOk", "cycles", "ended", "endedAt"] as const;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** The run record of a parsed meta.json and done.json (anything that is not an object reads as missing). */
export function r3RepRunRecordOf(meta: unknown, done: unknown): R3RepRunRecord {
  const pick = (x: unknown, keys: readonly string[]) => (isRecord(x) ? Object.fromEntries(keys.filter((k) => x[k] !== undefined).map((k) => [k, x[k]])) : null);
  return { meta: pick(meta, RUN_META_KEYS), done: pick(done, RUN_DONE_KEYS) };
}

/** A timing (a) source: its checkpoint and its run directory. */
export interface R3RepOrigin extends R3RepCheckpoint {
  run: R3RepRunRecord;
}

/** A genome donor's dominant genome as recorded: its lineage id (hi:lo, and each half) and its GENOME_CHANNELS words as hex. */
export interface R3RepDominant {
  id: string;
  hi: number;
  lo: number;
  words: string;
}

/** The record of `dominantGenome`'s result (null when the donor has no eligible cell). */
export function r3RepDominantRecord(dom: { hi: number; lo: number; words: Uint32Array } | null): R3RepDominant | null {
  return dom && { id: `${dom.hi}:${dom.lo}`, hi: dom.hi, lo: dom.lo, words: hexWords(dom.words) };
}

/** What `continue --r3rep` writes beside its checkpoint (`r3RepSidecarPathOf`), last: where the timing (b) state came from and what it is. */
export interface R3RepContinuation {
  r3rep: true;
  arm: R3RepArm;
  history: number;
  h: number;
  source: string;
  sourceStateHash: string;
  sourceSeed: number;
  sourceStep: number;
  seed: number;
  steps: number;
  mutRate: number;
  endStateHash: string;
  endStep: number;
  protocolSha256R3rep: string;
}

/** The sidecar of the continuation of source h from `origin` (its timing (a) checkpoint) to `end` after `steps` steps. */
export function r3RepContinuationOf(p: { h: number; origin: R3RepCheckpoint; end: R3RepCheckpoint; steps: number; protocolSha256R3rep: string }): R3RepContinuation {
  const l = r3RepHistoryOf(p.h);
  return {
    r3rep: true,
    arm: l.arm,
    history: l.history,
    h: l.h,
    source: p.origin.source,
    sourceStateHash: p.origin.stateHash,
    sourceSeed: p.origin.seed,
    sourceStep: p.origin.step,
    seed: p.end.seed,
    steps: p.steps,
    mutRate: p.end.mutRate,
    endStateHash: p.end.stateHash,
    endStep: p.end.step,
    protocolSha256R3rep: p.protocolSha256R3rep,
  };
}

/**
 * What an assay's provenance records (assay.json `provenance`): the assayed checkpoint (the fragment source); for timing (a) its run
 * record, for timing (b) the continuation sidecar and its timing (a) source as read when the assay ran; for Ge-on-Fa also the genome
 * donor (the scaf history's timing (a) source) with its dominant genome, null when it has none.
 */
export interface R3RepProvenance extends R3RepCheckpoint {
  run?: R3RepRunRecord;
  continuation?: unknown;
  origin?: R3RepOrigin | null;
  donor?: R3RepOrigin & { dominant: R3RepDominant | null };
}

/** What is wrong with the shape of a recorded checkpoint: a path, a state hash, and integer seed, mutRate, step and pond grid. */
export function checkpointShapeProblems(x: unknown, role: string): string[] {
  if (!isRecord(x)) return [`no ${role} record`];
  const why: string[] = [];
  if (typeof x.source !== "string") why.push(`${role} has no path`);
  if (typeof x.stateHash !== "string" || x.stateHash === "") why.push(`${role} has no state hash`);
  for (const k of ["seed", "mutRate", "step", "tilesX", "tilesY"]) if (!Number.isInteger(x[k])) why.push(`${role} ${k} ${JSON.stringify(x[k])} is not an integer`);
  return why;
}

/**
 * What is wrong with `o` as the timing (a) source of h (none: it is the protocol's), every problem listed and prefixed with `role`.
 * A history's source is `<r3RepRunDirOf(h)>/ckpt/b<N>-pre.blck.gz` in a run directory whose meta.json has the history's world seed, arm, k
 * (8; 0 for cont), period 10,000, side 8, clone init, the default mutation rate, census every 100 and `protocolSha256` (protocol v1's
 * SHA-256), and whose done.json is ok with 100 cycles and N = 100 or, scaf and rand only, ended with endedAt = N (the terminal
 * pre-cycle state of a history that ended at N). The ancestor's is r3rep/anc/ckpt/b1-pre.blck.gz of an arm cont world seeded 4,818,401
 * and run 1 cycle. The checkpoint's own seed and mutation rate must be the world's, its step N x 10,000 and its grid 8 x 8.
 */
export function r3RepOriginProblems(h: number, o: unknown, protocolSha256: string, role = "source"): string[] {
  const shape = checkpointShapeProblems(o, role);
  if (shape.length > 0) return shape;
  const p = o as R3RepOrigin;
  const l = r3RepHistoryOf(h);
  const ancestor = l.arm === "ancestor";
  const seed = r3RepWorldSeedOf(h);
  const mutRate = pondConfig(R3REP_REGIME.side, 0).mutRate;
  const why: string[] = [];
  const want = (name: string, got: unknown, expected: unknown) => {
    if (got !== expected) why.push(`${role} ${name} ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
  };
  const N = r3RepBoundaryOf(h, p.source);
  if (N === null) why.push(`${role} path ${JSON.stringify(p.source)} does not end in ${r3RepRunDirOf(h)}/ckpt/${ancestor ? "b1" : "b<N>"}-pre.blck.gz`);
  // The checkpoint's own state.
  want("seed", p.seed, seed);
  want("mutRate", p.mutRate, mutRate);
  if (N !== null) want("step", p.step, N * R3REP_REGIME.period);
  if (p.tilesX !== R3REP_REGIME.side || p.tilesY !== R3REP_REGIME.side) why.push(`${role} has ${p.tilesX} x ${p.tilesY} ponds, want ${R3REP_REGIME.side} x ${R3REP_REGIME.side}`);
  // Its run directory, as tools/scaffold.ts wrote it.
  const run: Record<string, unknown> = isRecord(p.run) ? p.run : {};
  const meta = isRecord(run.meta) ? run.meta : null;
  const done = isRecord(run.done) ? run.done : null;
  if (meta === null) why.push(`${role} is not inside a run directory with a readable meta.json`);
  else {
    const m = (key: string, expected: unknown) => want(`run meta.json ${key}`, meta[key], expected);
    m("arm", ancestor ? "cont" : l.arm);
    m("seed", seed);
    m("k", l.arm === "scaf" || l.arm === "rand" ? R3REP_REGIME.k : 0);
    m("period", R3REP_REGIME.period);
    m("side", R3REP_REGIME.side);
    m("init", "clone");
    m("mutRate", mutRate);
    m("censusEvery", R3REP_REGIME.censusEvery);
    m("protocolSha256", protocolSha256);
    if (ancestor) m("cycles", 1);
  }
  if (done === null) why.push(`${role} run has no readable done.json (unfinished)`);
  else if (done.ok !== true) why.push(`${role} run done.json ok ${JSON.stringify(done.ok)}, want true`);
  else if (ancestor) {
    if (done.cycles !== 1 || done.ended === true) why.push(`${role} run done.json cycles ${JSON.stringify(done.cycles)}${done.ended === true ? " (ended)" : ""}, want 1 cycle run through`);
  } else if (done.ended === true) {
    if (l.arm === "cont") why.push(`${role} run done.json says the history ended, but cont has no cycle and runs to boundary ${R3REP_CYCLES}`);
    else if (N !== null && done.endedAt !== N) why.push(`${role} run ended at boundary ${JSON.stringify(done.endedAt)}, but the source is b${N}-pre (an ended history's source is its terminal b<e>-pre)`);
  } else {
    if (done.cycles !== R3REP_CYCLES) why.push(`${role} run done.json cycles ${JSON.stringify(done.cycles)}, want ${R3REP_CYCLES} (or an ended history)`);
    if (N !== null && N !== R3REP_CYCLES) why.push(`${role} is b${N}-pre, but the history did not end: its source is b${R3REP_CYCLES}-pre`);
  }
  return why;
}

/**
 * What is wrong with `c` as the sidecar of source h's continuation, read against `origin` (its timing (a) source as it is now) and `end`
 * (the checkpoint beside it, as loaded): the labels must be h's, the source, its state hash, seed and step `origin`'s, the seed
 * 4,818,301 + h, the steps 2 x 10^5, the mutation rate the default one, endStep = sourceStep + steps, the protocol hash
 * `protocolSha256R3rep`, and the end state hash, seed, mutation rate and step `end`'s.
 */
export function r3RepContinuationProblems(h: number, c: unknown, origin: unknown, end: unknown, protocolSha256R3rep: string): string[] {
  if (!isRecord(c)) return ["no continuation sidecar (the <checkpoint>.json that continue --r3rep writes last)"];
  const l = r3RepHistoryOf(h);
  const why: string[] = [];
  const want = (name: string, got: unknown, expected: unknown) => {
    if (got !== expected) why.push(`continuation ${name} ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
  };
  want("r3rep", c.r3rep, true);
  want("arm", c.arm, l.arm);
  want("history", c.history, l.history);
  want("h", c.h, h);
  want("seed", c.seed, r3RepContinueSeed(h));
  want("steps", c.steps, R3REP_CONTINUE_STEPS);
  want("mutRate", c.mutRate, pondConfig(R3REP_REGIME.side, 0).mutRate);
  want("protocolSha256R3rep", c.protocolSha256R3rep, protocolSha256R3rep);
  if (!Number.isInteger(c.sourceStep) || !Number.isInteger(c.steps) || c.endStep !== (c.sourceStep as number) + (c.steps as number)) why.push(`continuation endStep ${JSON.stringify(c.endStep)} is not sourceStep ${JSON.stringify(c.sourceStep)} + steps ${JSON.stringify(c.steps)}`);
  // The timing (a) checkpoint it names, as it is now.
  if (!isRecord(origin)) why.push("the continuation's source checkpoint was not read");
  else {
    want("source", c.source, origin.source);
    want("sourceStateHash", c.sourceStateHash, origin.stateHash);
    want("sourceSeed", c.sourceSeed, origin.seed);
    want("sourceStep", c.sourceStep, origin.step);
  }
  // The checkpoint it wrote: the state being assayed.
  if (!isRecord(end)) why.push("the continued checkpoint was not read");
  else {
    for (const [key, field] of [["stateHash", "endStateHash"], ["seed", "seed"], ["mutRate", "mutRate"], ["step", "endStep"]] as const) {
      if (end[key] !== c[field]) why.push(`the continued checkpoint's ${key} ${JSON.stringify(end[key])} is not the continuation's ${field} ${JSON.stringify(c[field])}`);
    }
  }
  return why;
}

/** What is wrong with a `continue --r3rep` of source h: its seed (4,818,301 + h), steps (2 x 10^5), census (every 100) and output path (`r3RepContinuationPathOf`). */
export function r3RepContinueProblems(h: number, x: { seed: number; steps: number; censusEvery: number; out: string }): string[] {
  const why: string[] = [];
  if (x.seed !== r3RepContinueSeed(h)) why.push(`seed ${x.seed}, want r3RepContinueSeed(${h}) = ${r3RepContinueSeed(h)}`);
  if (x.steps !== R3REP_CONTINUE_STEPS) why.push(`steps ${x.steps}, want ${R3REP_CONTINUE_STEPS}`);
  if (x.censusEvery !== R3REP_REGIME.censusEvery) why.push(`census every ${x.censusEvery}, want ${R3REP_REGIME.censusEvery}`);
  if (!endsInPath(x.out, r3RepContinuationPathOf(h))) why.push(`output ${JSON.stringify(x.out)} does not end in ${r3RepContinuationPathOf(h)}`);
  return why;
}

/**
 * What is wrong with an assay's recorded `provenance` for its labels and variant (none: it is the protocol's). At timing (a) it is the
 * fragment source's origin record (`r3RepOriginProblems` for h' = `r3RepSeedHOf`: the ancestor's for Ge-on-Fa); at timing (b) the
 * continued checkpoint (path `r3RepContinuationPathOf(h)`, 8 x 8 ponds) with its sidecar (`continuation`, `r3RepContinuationProblems`)
 * and the timing (a) source it names (`origin`). Ge-on-Fa also records its genome `donor`, the labelled scaf history's timing (a)
 * source, with its dominant genome (`R3RepDominant`, or null when the donor has no eligible cell); no other variant has a donor.
 * `sha` holds protocol v1's SHA-256 (run meta.json) and this protocol's (the sidecar): `R3REP_SHA256`, the pinned ones.
 */
export function r3RepProvenanceProblems(labels: R3RepLabelSet, inoculum: string, p: unknown, sha: { protocol: string; r3rep: string }): string[] {
  if (!isRecord(p)) return ["assay.json has no provenance of its source (run the assay with --r3rep)"];
  const why: string[] = [];
  if (labels.timing === "a") why.push(...r3RepOriginProblems(r3RepSeedHOf(labels, inoculum), p, sha.protocol));
  else {
    const shape = checkpointShapeProblems(p, "source");
    why.push(...shape);
    if (shape.length === 0) {
      if (!endsInPath(p.source as string, r3RepContinuationPathOf(labels.h))) why.push(`source path ${JSON.stringify(p.source)} does not end in ${r3RepContinuationPathOf(labels.h)}`);
      if (p.tilesX !== R3REP_REGIME.side || p.tilesY !== R3REP_REGIME.side) why.push(`source has ${p.tilesX} x ${p.tilesY} ponds, want ${R3REP_REGIME.side} x ${R3REP_REGIME.side}`);
    }
    why.push(...r3RepOriginProblems(labels.h, p.origin, sha.protocol, "continuation source"));
    why.push(...r3RepContinuationProblems(labels.h, p.continuation, p.origin, p, sha.r3rep));
  }
  if (inoculum === "swap-ea") {
    why.push(...r3RepOriginProblems(labels.h, p.donor, sha.protocol, "donor"));
    const d = isRecord(p.donor) ? p.donor.dominant : undefined;
    const ok = d === null || (isRecord(d) && Number.isInteger(d.hi) && Number.isInteger(d.lo) && d.id === `${d.hi}:${d.lo}` && typeof d.words === "string" && new RegExp(`^[0-9a-f]{${8 * GENOME_CHANNELS}}$`).test(d.words));
    if (!ok) why.push(`donor dominant ${JSON.stringify(d)} is not a dominant genome record (id hi:lo, hi, lo and ${GENOME_CHANNELS} hex words) or null`);
  } else if (p.donor !== undefined) why.push(`provenance names a genome donor, but ${inoculum} has none`);
  return why;
}

/** The `biologicallyUnavailable` record of a Ge-on-Fa set whose donor has no dominant genome (no eligible cell). */
export const r3RepUnavailableOf = (donor: Pick<R3RepCheckpoint, "source" | "stateHash">) => ({ reason: "no dominant genome" as const, donor: donor.source, donorStateHash: donor.stateHash });

/**
 * What is wrong with an assay.json as a biologically unavailable Ge-on-Fa record: a swap-ea set of a scaf history at timing (a) whose
 * `biologicallyUnavailable` is `r3RepUnavailableOf` its provenance's donor, whose donor records no dominant genome, and with no rows.
 * Whether the donor checkpoint really has none is for a reader that can load it (`dominantGenome`).
 */
export function r3RepUnavailableProblems(json: Record<string, unknown>): string[] {
  const why: string[] = [];
  const lab = r3RepLabelsFromJson(json.labels);
  if ("error" in lab) why.push(lab.error);
  else why.push(...r3RepVariantProblems(lab.labels, "swap-ea"));
  if (json.inoculum !== "swap-ea") why.push(`inoculum ${JSON.stringify(json.inoculum)}: only Ge-on-Fa (swap-ea) can be biologically unavailable`);
  const donor = isRecord(json.provenance) && isRecord(json.provenance.donor) ? json.provenance.donor : null;
  if (donor === null) why.push("provenance has no donor");
  else {
    if (donor.dominant !== null) why.push(`provenance.donor.dominant ${JSON.stringify(donor.dominant)}, want null (no eligible cell)`);
    const want = typeof donor.source === "string" && typeof donor.stateHash === "string" ? r3RepUnavailableOf({ source: donor.source, stateHash: donor.stateHash }) : null;
    if (JSON.stringify(json.biologicallyUnavailable) !== JSON.stringify(want)) why.push(`biologicallyUnavailable ${JSON.stringify(json.biologicallyUnavailable)}, want ${JSON.stringify(want)}`);
  }
  const summary = isRecord(json.summary) ? json.summary : {};
  if (summary.rows !== 0) why.push(`summary.rows ${JSON.stringify(summary.rows)}, want 0`);
  return why;
}

/** Ga-on-Fe's planted words as assay.json records them: M3_FOUNDERS[2] (the ancestor) with lineage id 0:1, as --swap-founder 2 plants it. */
export const R3REP_SWAP_AE_WORDS = hexWords(encodeGenome(founderGenome(M3_FOUNDERS[2]), 0, 1));

/**
 * What is wrong with the treatment an assay.json records (`quench`, `swap`) for its variant, as competence --r3rep writes it: the
 * source's fragments and the quenched control plant no swapped genome (`swap` null; `quench` false and true); Ga-on-Fe plants
 * `R3REP_SWAP_AE_WORDS`; Ge-on-Fa plants its donor's dominant genome, so the donor must have one (provenance.donor.dominant) and the
 * words must be its words. The biologically unavailable record (`biologicallyUnavailable`, no dominant genome) plants nothing (words null).
 */
export function r3RepTreatmentProblems(json: Record<string, unknown>): string[] {
  const inoculum = json.inoculum;
  if (!(R3REP_INOCULA as readonly unknown[]).includes(inoculum)) return []; // r3RepVariantProblems says why
  const why: string[] = [];
  if (json.quench !== (inoculum === "quenched")) why.push(`quench ${JSON.stringify(json.quench)}, want ${inoculum === "quenched"} for ${inoculum}`);
  if (inoculum === "fragment" || inoculum === "quenched") {
    if (json.swap !== null) why.push(`swap ${JSON.stringify(json.swap)}, want null: ${inoculum} plants no swapped genome`);
    return why;
  }
  const swap = isRecord(json.swap) ? json.swap : null;
  if (swap === null || swap.label !== inoculum) {
    why.push(`swap ${JSON.stringify(json.swap)}, want the ${inoculum} genome it planted (label ${inoculum}, words)`);
    return why;
  }
  if (inoculum === "swap-ae") {
    if (swap.words !== R3REP_SWAP_AE_WORDS) why.push("swap words are not M3_FOUNDERS[2]'s: Ga-on-Fe plants the ancestor's genome and nothing else");
    return why;
  }
  const dominant = isRecord(json.provenance) && isRecord(json.provenance.donor) ? json.provenance.donor.dominant : undefined;
  if (json.biologicallyUnavailable !== undefined) {
    if (swap.words !== null) why.push("swap words are recorded, but a biologically unavailable record plants no genome (words null)");
  } else if (!isRecord(dominant)) why.push(`provenance.donor.dominant ${JSON.stringify(dominant)}: a Ge-on-Fa set with rows plants its donor's dominant genome (a donor with none is the biologically unavailable record)`);
  else if (swap.words !== dominant.words) why.push(`swap words are not the donor's dominant genome ${dominant.id} (provenance.donor.dominant.words)`);
  return why;
}

// ---------------------------------------------------------------------------------------------
// The scaffolding registration (docs/scaffold-registration-v1.md, reg1): protocol v1's assays on runner bundles

/**
 * The regime every reg1 assay runs at (the document's "Assays"): protocol v1's k and period, ref 103,058, 64 ponds at 512² and a census
 * every 100 steps. The replicates are the set's (`reg1ReplicatesOf`); S3 runs, as R1'' did, without a ref.
 */
export const REG1_REGIME = { k: 8, period: 10_000, ref: 103_058, side: 8, censusEvery: 100 } as const;

/** Histories per arm (i = 0-23). The source worlds by h: 24 arm + i for the histories (arm 0 scaf, 1 rand, 2 cont), 72 + i for ancestor world i. */
export const REG1_HISTORIES = 24;
export const REG1_ANCESTOR_H = 72;
export const REG1_SOURCES = 96;
const REG1_ARMS = ["scaf", "rand", "cont"] as const;
/** S3's sets by h: 0-47 the scaf and rand histories (24 arm + i), 48-49 the positive controls (P2 ranking worlds s0, s1), 50-53 the negative controls j = 0-3. */
export const REG1_HEREDITY_SETS = 54;
const REG1_POSITIVE_H = 48;
const REG1_NEGATIVE_H = 50;

/**
 * The document's seeds (block 4,850,001-4,899,999): histories 4,850,001 + 100 arm + i, ancestor worlds 4,850,401 + i, continuations
 * 4,850,501 + h (at most 4,850,596), competence σ(h, t, s) (at most 4,860,514), S2 (at most 4,865,732), S3 (at most 4,879,260), the
 * negative-control worlds 4,880,001 + j, and the reproducibility draw, the S1 bootstrap and the device check.
 */
export const REG1_SEED_BLOCK = { min: 4_850_001, max: 4_899_999 } as const;
export const REG1_HISTORY_SEED_BASE = 4_850_001;
export const REG1_ANCESTOR_SEED_BASE = 4_850_401;
export const REG1_CONTINUE_SEED_BASE = 4_850_501;
export const REG1_CONTINUE_SEED_MAX = 4_850_596;
export const REG1_SEED_BASE = 4_851_001;
export const REG1_SEED_MAX = 4_860_514;
export const REG1_GARDEN_SEED_BASE = 4_861_001;
export const REG1_GARDEN_SEED_MAX = 4_865_732;
export const REG1_HEREDITY_SEED_BASE = 4_866_001;
export const REG1_HEREDITY_SEED_MAX = 4_879_260;
export const REG1_NEGATIVE_SEED_BASE = 4_880_001;
export const REG1_REPRO_SEED = 4_880_101;
export const REG1_S1_BOOTSTRAP_SEED = 4_880_201;
export const REG1_DEVICE_SEED = 4_880_301;
/**
 * A history runs 10^6 steps (100 cycles), an ancestor world one period, both with a census every 1,000; a continuation 2 x 10^5 steps. A
 * run that stops on an event-buffer overflow is rerun at census 100 (the document's "Validity", step 3) as experiment hist-c100 or anc-c100,
 * the spec otherwise the same: neither the physics nor a pre-cycle state depends on the census cadence.
 */
export const REG1_HISTORY_STEPS = 1_000_000;
export const REG1_ANCESTOR_STEPS = 10_000;
export const REG1_RUN_CENSUS = 1_000;
export const REG1_RERUN_CENSUS = 100;
/** Every run takes deep metrics every 10 censuses and writes no periodic checkpoint; preset ponds has the identity the document names. */
export const REG1_RUN_DEEP = 10;
export const REG1_PONDS_IDENTITY = "56526b894cfccf3f";
export const REG1_CONTINUE_STEPS = 200_000;
/** Source (a) is boundary 100's pre-cycle checkpoint (b1 for an ancestor world); S3's is boundary 34's; S2's time C is source (a). */
export const REG1_HEREDITY_BOUNDARY = 34;

/**
 * The registration as frozen on 2026-10-02, pinned by SHA-256 and length (experiments/scaffold/REGISTRATION-v1 records the same hash). Any
 * change after the freeze goes in a dated amendment at the end, so the document keeps beginning with its pinned bytes; sets and sidecars
 * record and are checked against this pin, never against the document as it is now.
 */
export const REG1_PROTOCOL = { doc: "docs/scaffold-registration-v1.md", sha256: "8a1b00ec5bd1440e8c4ab4ea61f3816dee0dbe110cb2052f0ae0ca785a817f69", bytes: 31_675 } as const;
export const REG1_SHA256 = REG1_PROTOCOL.sha256;

/** What is wrong with `doc` (the registration's bytes as they are now) as its pinned text followed by amendments only. */
export async function reg1ProtocolProblems(doc: Uint8Array): Promise<string[]> {
  return await pinnedTextProblems(REG1_PROTOCOL, doc);
}

/** Throws unless `x` is an integer in 0..max (the reg1 seed functions' range assertions). */
function reg1Field(fn: string, name: string, x: number, max: number): void {
  if (!Number.isInteger(x) || x < 0 || x > max) throw new Error(`${fn}: ${name} must be an integer in 0..${max}, got ${x}`);
}

export type Reg1Arm = "scaf" | "rand" | "cont" | "ancestor";

/** A source world: `arm` with its index i (0-23; ancestor world i for the ancestor) and h = 24 arm + i, or 72 + i. */
export interface Reg1History {
  arm: Reg1Arm;
  history: number;
  h: number;
}

/** h of history i of `arm` (24 arm + i), or of ancestor world i (72 + i). */
export function reg1H(arm: Reg1Arm, i: number): number {
  reg1Field("reg1H", "i", i, REG1_HISTORIES - 1);
  if (arm === "ancestor") return REG1_ANCESTOR_H + i;
  const k = REG1_ARMS.indexOf(arm);
  if (k < 0) throw new Error(`reg1H: arm must be scaf, rand, cont or ancestor, got ${JSON.stringify(arm)}`);
  return REG1_HISTORIES * k + i;
}

/** The source world h names (`reg1H`'s inverse). */
export function reg1HistoryOf(h: number): Reg1History {
  reg1Field("reg1HistoryOf", "h", h, REG1_SOURCES - 1);
  if (h >= REG1_ANCESTOR_H) return { arm: "ancestor", history: h - REG1_ANCESTOR_H, h };
  return { arm: REG1_ARMS[Math.floor(h / REG1_HISTORIES)], history: h % REG1_HISTORIES, h };
}

/** The world seed of source h: 4,850,001 + 100 arm + i for a history, 4,850,401 + i for an ancestor world. */
export function reg1WorldSeedOf(h: number): number {
  const l = reg1HistoryOf(h);
  return l.arm === "ancestor" ? REG1_ANCESTOR_SEED_BASE + l.history : REG1_HISTORY_SEED_BASE + 100 * REG1_ARMS.indexOf(l.arm) + l.history;
}

/** Seed of the continuation of source h (0-95) to timing (b): 4,850,501 + h. */
export function reg1ContinueSeed(h: number): number {
  reg1Field("reg1ContinueSeed", "h", h, REG1_SOURCES - 1);
  return REG1_CONTINUE_SEED_BASE + h;
}

/**
 * Competence seed σ(h, t, s) = 4,851,001 + 100 h + 10 t + s: h 0-95, t 0 for timing (a) and 1 for (b), s the replicate 0-3, or 0-7 for
 * the swap pair, whose seeds are an ancestor world's at (a) (h 72-95, t 0). Mixed radix (10 t + s < 100), so it cannot collide; every
 * field is range-checked.
 */
export function reg1Seed(h: number, t: number, s: number): number {
  reg1Field("reg1Seed", "h", h, REG1_SOURCES - 1);
  reg1Field("reg1Seed", "t", t, 1);
  reg1Field("reg1Seed", "s", s, h >= REG1_ANCESTOR_H && t === 0 ? 7 : 3);
  const seed = REG1_SEED_BASE + 100 * h + 10 * t + s;
  if (seed > REG1_SEED_MAX) throw new Error(`reg1Seed: ${seed} is above ${REG1_SEED_MAX}`);
  return seed;
}

/**
 * S2's seed(h, t, v, s) = 4,861,001 + 100 h + 20 t + 10 v + s: h 0-47 (scaf and rand), t 0 = time 0 and 1 = time C, v 0 raw and 1 disc,
 * s 0-1. Both inocula sample their fragments with v = 0; the assay world's physics uses v.
 */
export function reg1GardenSeed(h: number, t: number, v: number, s: number): number {
  reg1Field("reg1GardenSeed", "h", h, 2 * REG1_HISTORIES - 1);
  reg1Field("reg1GardenSeed", "t", t, 1);
  reg1Field("reg1GardenSeed", "v", v, 1);
  reg1Field("reg1GardenSeed", "s", s, 1);
  const seed = REG1_GARDEN_SEED_BASE + 100 * h + 20 * t + 10 * v + s;
  if (seed > REG1_GARDEN_SEED_MAX) throw new Error(`reg1GardenSeed: ${seed} is above ${REG1_GARDEN_SEED_MAX}`);
  return seed;
}

/** S3's seed 4,866,001 + 250 h + s: h 0-53 (`REG1_HEREDITY_SETS`), s 0-1 the replicates, 8 the permutation stream, 9 the donor selection; no other s. */
export function reg1HereditySeed(h: number, s: number): number {
  reg1Field("reg1HereditySeed", "h", h, REG1_HEREDITY_SETS - 1);
  if (s !== 0 && s !== 1 && s !== 8 && s !== 9) throw new Error(`reg1HereditySeed: s must be 0-1 (replicates), 8 (permutations) or 9 (donors), got ${s}`);
  const seed = REG1_HEREDITY_SEED_BASE + 250 * h + s;
  if (seed > REG1_HEREDITY_SEED_MAX) throw new Error(`reg1HereditySeed: ${seed} is above ${REG1_HEREDITY_SEED_MAX}`);
  return seed;
}

/** The world seed of S3's negative control j (0-3): 4,880,001 + j. */
export function reg1NegativeSeed(j: number): number {
  reg1Field("reg1NegativeSeed", "j", j, 3);
  return REG1_NEGATIVE_SEED_BASE + j;
}

/** The negative-control world j a seed names (`reg1NegativeSeed`'s inverse), or null. */
export const reg1NegativeWorldOf = (seed: number): number | null => (Number.isInteger(seed) && seed >= REG1_NEGATIVE_SEED_BASE && seed <= REG1_NEGATIVE_SEED_BASE + 3 ? seed - REG1_NEGATIVE_SEED_BASE : null);

/**
 * What is wrong with a tools/scaffold.ts evolve run at a negative-control seed: it must make the heredity replication's control world,
 * a clone world of arm cont with mutation off grown one period of 10,000 steps at 8 x 8 ponds.
 */
export function reg1NegativeRunProblems(x: { arm: string; init: string; mutOff: boolean; period: number; cycles: number; side: number }): string[] {
  const why: string[] = [];
  for (const [key, want] of [["arm", "cont"], ["init", "clone"], ["mutOff", true], ["period", REG1_REGIME.period], ["cycles", 1], ["side", REG1_REGIME.side]] as const) {
    if (x[key] !== want) why.push(`${key} ${JSON.stringify(x[key])}, want ${JSON.stringify(want)}`);
  }
  return why;
}

/** The conditions of the arms (an ancestor world is a pond-cont world of one period). */
export const REG1_CONDITIONS = { scaf: "treatment", rand: "pond-rand", cont: "pond-cont", ancestor: "pond-cont" } as const;

const pad2 = (i: number): string => String(i).padStart(2, "0");

/** A source world's name on disk and in a set id: scaf-i00..cont-i23, ancestor-i00..ancestor-i23. */
export const reg1IdOf = (l: Pick<Reg1History, "arm" | "history">): string => `${l.arm}-i${pad2(l.history)}`;

/**
 * The run experiment of source h: `hist` for a history, `anc` for an ancestor world. Run ids cannot contain "/", so the runs are made with
 * tools/run.ts --out runs/scaffold/reg1 --experiment hist|anc, and the manifest's runId is <experiment>/ponds/<condition>/seed-<n>.
 */
export const reg1ExperimentOf = (h: number): "hist" | "anc" => (reg1HistoryOf(h).arm === "ancestor" ? "anc" : "hist");

/** The run bundle of source h under runs/ (tools/run.ts's <out>/<experiment>/<preset>/<condition>/seed-<n>): scaffold/reg1/hist/... or scaffold/reg1/anc/... */
export function reg1BundleDirOf(h: number): string {
  return `scaffold/reg1/${reg1ExperimentOf(h)}/ponds/${REG1_CONDITIONS[reg1HistoryOf(h).arm]}/seed-${reg1WorldSeedOf(h)}`;
}

/** The boundary of source h's timing (a): 100 for a history, 1 for an ancestor world. */
export const reg1BoundaryAOf = (h: number): number => (reg1HistoryOf(h).arm === "ancestor" ? 1 : 100);

/** A pre-cycle checkpoint's file in its bundle, as the runner names it: checkpoints/b<NNN>-pre.blck. */
export const reg1PreCycleFileOf = (b: number): string => `checkpoints/b${String(b).padStart(3, "0")}-pre.blck`;

/** Where `continue --reg1` writes source h's timing (b) state, under runs/: scaffold/reg1/cont200k/<arm>-i<NN>.blck.gz. */
export const reg1ContinuationPathOf = (h: number): string => `scaffold/reg1/cont200k/${reg1IdOf(reg1HistoryOf(h))}.blck.gz`;

/**
 * What a source's run bundle must be: its directory (`reg1BundleDirOf`), spec (experiment, preset, condition, seed, steps, census, deep
 * metrics and periodic checkpoints), the preset's identity and the state (period, ponds, mutation rate).
 */
export interface Reg1BundleWant {
  dir: string;
  experiment: string;
  presetId: string;
  presetIdentity: string;
  condition: string;
  seed: number;
  steps: number;
  censusEvery: number;
  deepEvery: number;
  checkpointEvery: number;
  period: number;
  side: number;
  mutRate: number;
}

/** The production bundle of source h: experiment hist (anc), preset ponds, its arm's condition and seed, 10^6 steps (10^4 for an ancestor world), census every 1,000, the default mutation rate. */
export function reg1BundleWantOf(h: number): Reg1BundleWant {
  return reg1BundleWantsOf(h)[0];
}

/**
 * The bundles source h may come from: its run at census 1,000 (`reg1BundleDirOf`) and that run's overflow rerun at census 100 (experiment
 * hist-c100 or anc-c100, the same seed and spec otherwise). Exactly one of them must be complete (`reg1SourceProblems`).
 */
export function reg1BundleWantsOf(h: number): [Reg1BundleWant, Reg1BundleWant] {
  const l = reg1HistoryOf(h);
  const want: Reg1BundleWant = {
    dir: reg1BundleDirOf(h),
    experiment: reg1ExperimentOf(h),
    presetId: "ponds",
    presetIdentity: REG1_PONDS_IDENTITY,
    condition: REG1_CONDITIONS[l.arm],
    seed: reg1WorldSeedOf(h),
    steps: l.arm === "ancestor" ? REG1_ANCESTOR_STEPS : REG1_HISTORY_STEPS,
    censusEvery: REG1_RUN_CENSUS,
    deepEvery: REG1_RUN_DEEP,
    checkpointEvery: 0,
    period: REG1_REGIME.period,
    side: REG1_REGIME.side,
    mutRate: pondConfig(REG1_REGIME.side, 0).mutRate,
  };
  const experiment = `${want.experiment}-c100`;
  return [want, { ...want, dir: want.dir.replace(`/${want.experiment}/`, `/${experiment}/`), experiment, censusEvery: REG1_RERUN_CENSUS }];
}

/** The competence sets (labels.set) and the inoculum each plants: the source's fragments, Ge-on-Fa, Ga-on-Fa, Ga-on-Fe and the quenched control. */
export const REG1_COMPETENCE_SETS = ["source", "ge-on-fa", "ga-on-fa", "ga-on-fe", "quench"] as const;
export type Reg1CompetenceSet = (typeof REG1_COMPETENCE_SETS)[number];
export type Reg1Set = Reg1CompetenceSet | "garden-raw" | "garden-disc" | "heredity" | "capability";
export const REG1_INOCULA = { source: "fragment", "ge-on-fa": "swap-ea", "ga-on-fa": "swap-aa", "ga-on-fe": "swap-ae", quench: "quenched", "garden-raw": "fragment", "garden-disc": "disc", heredity: "fragment" } as const;

/**
 * The `labels` of a reg1 set, every key present: `set`, the source world (`arm`, `history`), `timing` (competence) or `time` (S2), `h`
 * the seed index of the set's seeds (and of its fragment source: Ge-on-Fa and Ga-on-Fa carry 72 + i, ancestor world i, while `history`
 * is i and `arm` scaf), and `control` for S3's controls, whose `history` is null. Fields that do not apply are null.
 */
export interface Reg1LabelSet {
  reg1: true;
  set: Reg1Set;
  arm: Reg1Arm | "control" | null;
  history: number | null;
  timing: "a" | "b" | null;
  time: 0 | 1 | null;
  h: number | null;
  control: "positive" | "negative" | null;
}

/**
 * The labels of competence set `set` of history i at `timing`: the source's own fragments of any source world (h = 24 arm + i, or 72 + i);
 * Ge-on-Fa and Ga-on-Fa of scaf_i at (a), on ancestor world i's fragments (h = 72 + i); Ga-on-Fe of scaf_i at (a) and the quenched control
 * of scaf_i at either timing, on scaf_i's fragments (h = i).
 */
export function reg1CompetenceLabelsOf(set: Reg1CompetenceSet, arm: Reg1Arm, history: number, timing: "a" | "b"): Reg1LabelSet {
  if (!(REG1_COMPETENCE_SETS as readonly string[]).includes(set)) throw new Error(`reg1 competence set must be one of ${REG1_COMPETENCE_SETS.join(", ")}, got ${JSON.stringify(set)}`);
  if (timing !== "a" && timing !== "b") throw new Error(`reg1 timing must be a or b, got ${JSON.stringify(timing)}`);
  if (set !== "source" && arm !== "scaf") throw new Error(`${set} labels a scaf history, not ${arm}`);
  if ((set === "ge-on-fa" || set === "ga-on-fa" || set === "ga-on-fe") && timing !== "a") throw new Error(`${set} runs at timing a only, not ${timing}`);
  const own = reg1H(arm, history);
  const h = set === "ge-on-fa" || set === "ga-on-fa" ? REG1_ANCESTOR_H + history : own;
  return { reg1: true, set, arm, history, timing, time: null, h, control: null };
}

/** The labels of S2's set of scaf or rand history i at time 0 or C (1) with the raw (fragment) or standardised (disc) inoculum; h = 24 arm + i. */
export function reg1GardenLabelsOf(arm: "scaf" | "rand", history: number, time: 0 | 1, inoculum: "fragment" | "disc"): Reg1LabelSet {
  if (arm !== "scaf" && arm !== "rand") throw new Error(`S2 labels a scaf or rand history, not ${JSON.stringify(arm)}`);
  if (time !== 0 && time !== 1) throw new Error(`S2 time must be 0 or 1 (time C), got ${JSON.stringify(time)}`);
  if (inoculum !== "fragment" && inoculum !== "disc") throw new Error(`S2 inoculum must be fragment (raw) or disc, got ${JSON.stringify(inoculum)}`);
  return { reg1: true, set: inoculum === "disc" ? "garden-disc" : "garden-raw", arm, history, timing: null, time, h: reg1H(arm, history), control: null };
}

/** The labels of S3's set h (0-53): a scaf or rand history (h = 24 arm + i), a positive control (48-49) or a negative control (50-53). */
export function reg1HeredityLabelsOf(h: number): Reg1LabelSet {
  reg1Field("reg1HeredityLabelsOf", "h", h, REG1_HEREDITY_SETS - 1);
  if (h < REG1_POSITIVE_H) return { reg1: true, set: "heredity", arm: REG1_ARMS[Math.floor(h / REG1_HISTORIES)], history: h % REG1_HISTORIES, timing: null, time: null, h, control: null };
  return { reg1: true, set: "heredity", arm: "control", history: null, timing: null, time: null, h, control: h < REG1_NEGATIVE_H ? "positive" : "negative" };
}

/** The labels of R4 (`capability --reg1`): one set over every history's dominant genome at (a) and every ancestor world's; the rows carry arm, history and h. */
export const REG1_CAPABILITY_LABELS: Reg1LabelSet = { reg1: true, set: "capability", arm: null, history: null, timing: "a", time: null, h: null, control: null };

/** The world an S3 control h is: the P2 ranking world s = h - 48 (positive) or the negative-control world j = h - 50. */
export const reg1ControlWorldOf = (h: number): number => (h < REG1_NEGATIVE_H ? h - REG1_POSITIVE_H : h - REG1_NEGATIVE_H);

/**
 * A set's name, and its directory under runs/scaffold/reg1/assays/: <arm>-i<NN>-a|b, scaf-i<NN>-ge-on-fa|ga-on-fa|ga-on-fe,
 * scaf-i<NN>-quench-a|b, garden-<arm>-i<NN>-t0|t1-raw|disc, heredity-<arm>-i<NN>, heredity-pos-s<s>, heredity-neg-j<j>, capability.
 */
export function reg1SetIdOf(l: Reg1LabelSet): string {
  const id = l.arm !== null && l.arm !== "control" && l.history !== null ? reg1IdOf({ arm: l.arm, history: l.history }) : "";
  switch (l.set) {
    case "source":
      return `${id}-${l.timing}`;
    case "ge-on-fa":
    case "ga-on-fa":
    case "ga-on-fe":
      return `${id}-${l.set}`;
    case "quench":
      return `${id}-quench-${l.timing}`;
    case "garden-raw":
    case "garden-disc":
      return `garden-${id}-t${l.time}-${l.set === "garden-disc" ? "disc" : "raw"}`;
    case "heredity":
      return l.control === null ? `heredity-${id}` : `heredity-${l.control === "positive" ? "pos-s" : "neg-j"}${reg1ControlWorldOf(l.h!)}`;
    case "capability":
      return "capability";
  }
}

/** A set's directory under runs/: scaffold/reg1/assays/<reg1SetIdOf>. */
export const reg1AssayDirOf = (l: Reg1LabelSet): string => `scaffold/reg1/assays/${reg1SetIdOf(l)}`;

/**
 * What is wrong with an output under --allow-any-seed: it must not lie inside `production`, the repository's own runs/scaffold/reg1 tree, so
 * smoke output never lands among the registration's files. Both paths are absolute and normalised (symlinks resolved) by the caller.
 */
export function reg1WaiverOutProblems(out: string, production: string): string[] {
  const o = out.replace(/\/+$/, ""), p = production.replace(/\/+$/, "");
  return o === p || o.startsWith(`${p}/`) ? [`--allow-any-seed writes ${JSON.stringify(out)} inside the registration's production tree ${p}: a smoke test writes elsewhere`] : [];
}

/** What is wrong with a set's output directory: it must end in `reg1AssayDirOf(labels)`, so a directory's name is its set. */
export function reg1AssayOutProblems(l: Reg1LabelSet, out: string): string[] {
  return endsInPath(out.replace(/\/+$/, ""), reg1AssayDirOf(l)) ? [] : [`output ${JSON.stringify(out)} does not end in ${reg1AssayDirOf(l)}`];
}

/** The replicates of a set: 8 for the swap pair (Ge-on-Fa, Ga-on-Fa), 4 for every other competence set, 2 for S2 and S3. */
export function reg1ReplicatesOf(l: Pick<Reg1LabelSet, "set">): number {
  if (l.set === "ge-on-fa" || l.set === "ga-on-fa") return 8;
  if ((REG1_COMPETENCE_SETS as readonly string[]).includes(l.set)) return 4;
  if (l.set === "capability") throw new Error("capability evaluates genomes with DEFAULT_EVAL's own replicates; it plants no fragments");
  return 2;
}

/**
 * The seeds of replicate s of a set, fragment sampling and physics: σ(h, t, s) for every competence set (common random numbers: the swap
 * pair takes ancestor world i's, Ga-on-Fe and the quenched control scaf_i's); S2's seed(h, t, v, s) for the physics and seed(h, t, 0, s) for
 * the fragments; S3's 4,866,001 + 250 h + s for both.
 */
export function reg1SeedsOf(l: Reg1LabelSet, s: number): { physics: number; fragment: number } {
  if (l.h === null) throw new Error(`reg1 set ${l.set} has no seed index h`);
  if (l.set === "heredity") return { physics: reg1HereditySeed(l.h, s), fragment: reg1HereditySeed(l.h, s) };
  if (l.set === "garden-raw" || l.set === "garden-disc") {
    if (l.time === null) throw new Error("an S2 set needs its time");
    return { physics: reg1GardenSeed(l.h, l.time, l.set === "garden-disc" ? 1 : 0, s), fragment: reg1GardenSeed(l.h, l.time, 0, s) };
  }
  if (l.set === "capability") throw new Error("capability has no fragment seeds");
  const seed = reg1Seed(l.h, l.timing === "b" ? 1 : 0, s);
  return { physics: seed, fragment: seed };
}

/** Throws unless the seeds of replicate `replicate` are `reg1SeedsOf(labels, replicate)` (fragment and physics). */
export function checkReg1Seeds(l: Reg1LabelSet, seeds: { physics: number; fragment: number }, replicate = 0): void {
  const want = reg1SeedsOf(l, replicate);
  for (const [name, key] of [["seed", "physics"], ["fragment seed", "fragment"]] as const) {
    if (seeds[key] !== want[key]) throw new Error(`${name} ${seeds[key]} does not match the reg1 labels (${reg1SetIdOf(l)}, h ${l.h}): want ${want[key]} for replicate ${replicate}`);
  }
}

/** S3 draws its donors with s = 9 (`reg1HereditySeed(h, 9)`), and permutes with s = 8. */
export function reg1DonorSeedOf(l: Pick<Reg1LabelSet, "set" | "h">): number {
  if (l.set !== "heredity" || l.h === null) throw new Error("donors belong to an S3 (heredity) set");
  return reg1HereditySeed(l.h, 9);
}

/** Throws unless `donorSeed` is `reg1DonorSeedOf(labels)`. */
export function checkReg1DonorSeed(l: Pick<Reg1LabelSet, "set" | "h">, donorSeed: number): void {
  const want = reg1DonorSeedOf(l);
  if (donorSeed !== want) throw new Error(`donor seed ${donorSeed} does not match the reg1 labels (h ${l.h}): want reg1HereditySeed(h, 9) = ${want}`);
}

/** What is wrong with an assay's regime for its set: k 8, period 10,000, side 8, census every 100, the set's replicates, and ref 103,058 (none for S3, as R1''). */
export function reg1RegimeProblems(l: Pick<Reg1LabelSet, "set">, x: { k: unknown; period: unknown; ref: unknown; side: unknown; replicates: unknown; censusEvery: unknown }): string[] {
  const want = { ...REG1_REGIME, ref: l.set === "heredity" ? null : REG1_REGIME.ref, replicates: reg1ReplicatesOf(l) };
  const why: string[] = [];
  for (const key of ["k", "period", "ref", "side", "replicates", "censusEvery"] as const) if (x[key] !== want[key]) why.push(`${key} ${JSON.stringify(x[key])}, want ${JSON.stringify(want[key])}`);
  return why;
}

/** An integer flag, NaN when missing or blank. */
const flagInt = (s: string | undefined): number => (s === undefined || s.trim() === "" ? NaN : Number(s));

/** The source world of the CLI's --arm and --history (0-23, ancestor world i for --arm ancestor); --h is derived and, if given, must agree. */
function parseReg1History(v: { arm?: string; history?: string; h?: string }, arms: readonly string[]): Reg1History {
  if (v.arm === undefined || !arms.includes(v.arm)) throw new Error(`--arm must be ${arms.join("|")} for --reg1, got ${v.arm}`);
  const i = flagInt(v.history);
  if (!Number.isInteger(i) || i < 0 || i >= REG1_HISTORIES) throw new Error(`--history must be 0-${REG1_HISTORIES - 1} for --reg1 (ancestor world i for --arm ancestor), got ${v.history}`);
  return reg1HistoryOf(reg1H(v.arm as Reg1Arm, i));
}

/** Refuses an --h that disagrees with the derived one. */
function agreeH(given: string | undefined, h: number, what: string): void {
  if (given !== undefined && flagInt(given) !== h) throw new Error(`--h ${given} disagrees with ${what}: h is derived, here ${h}`);
}

/** The labels of a reg1 competence set from the CLI's --set, --arm, --history, --timing a|b and optional --h; --time, --calibration and --control do not apply. */
export function parseReg1CompetenceLabels(v: { set?: string; arm?: string; history?: string; timing?: string; h?: string; time?: string; calibration?: string; control?: string }): Reg1LabelSet {
  if (v.time !== undefined || v.calibration !== undefined || v.control !== undefined) throw new Error("competence --reg1 takes --set, --arm, --history and --timing a|b, not --time, --calibration or --control");
  if (v.set === undefined || !(REG1_COMPETENCE_SETS as readonly string[]).includes(v.set)) throw new Error(`--set must be ${REG1_COMPETENCE_SETS.join("|")} for competence --reg1, got ${v.set}`);
  if (v.timing !== "a" && v.timing !== "b") throw new Error(`--timing must be a or b for competence --reg1, got ${v.timing}`);
  const set = v.set as Reg1CompetenceSet;
  const l = parseReg1History(v, set === "source" ? ["scaf", "rand", "cont", "ancestor"] : ["scaf"]);
  const labels = reg1CompetenceLabelsOf(set, l.arm, l.history, v.timing);
  agreeH(v.h, labels.h!, `--set ${set} --arm ${l.arm} --history ${l.history}`);
  return labels;
}

/** The source world of `continue --reg1` from --arm, --history (ancestor world i too) and optional --h; it makes the timing (b) source, so --timing, --time and --set do not apply. */
export function parseReg1ContinueLabels(v: { arm?: string; history?: string; h?: string; timing?: string; time?: string; set?: string; calibration?: string; control?: string }): Reg1History {
  if (v.timing !== undefined || v.time !== undefined || v.set !== undefined || v.calibration !== undefined || v.control !== undefined) throw new Error("continue --reg1 takes --arm and --history (it makes the timing (b) source), not --timing, --time, --set, --calibration or --control");
  const l = parseReg1History(v, ["scaf", "rand", "cont", "ancestor"]);
  agreeH(v.h, l.h, `--arm ${l.arm} --history ${l.history}`);
  return l;
}

/** The labels of an S2 set from --arm scaf|rand, --history, --time 0|1 (1 = time C) and --inoculum fragment (raw) | disc; --timing, --set and the rest do not apply. */
export function parseReg1GardenLabels(v: { arm?: string; history?: string; time?: string; inoculum?: string; h?: string; timing?: string; set?: string; calibration?: string; control?: string }): Reg1LabelSet {
  if (v.timing !== undefined || v.set !== undefined || v.calibration !== undefined || v.control !== undefined) throw new Error("garden --reg1 takes --arm, --history, --time 0|1 and --inoculum, not --timing, --set, --calibration or --control");
  if (v.time !== "0" && v.time !== "1") throw new Error(`--time must be 0 or 1 (time C) for garden --reg1, got ${v.time}`);
  if (v.inoculum !== "fragment" && v.inoculum !== "disc") throw new Error(`--inoculum must be fragment (raw) or disc, got ${v.inoculum}`);
  const l = parseReg1History(v, ["scaf", "rand"]);
  const labels = reg1GardenLabelsOf(l.arm as "scaf" | "rand", l.history, v.time === "0" ? 0 : 1, v.inoculum);
  agreeH(v.h, labels.h!, `--arm ${l.arm} --history ${l.history}`);
  return labels;
}

/**
 * The labels of an S3 set from --h (0-53), as R1'' takes them: --arm must be the one h implies (scaf 0-23, rand 24-47, control 48-53),
 * a history needs --history i = h mod 24, and a control needs --control positive (48-49) or negative (50-53) and takes --history (its
 * world, s or j) only if it agrees. --time, --timing and --set do not apply.
 */
export function parseReg1HeredityLabels(v: { h?: string; arm?: string; history?: string; control?: string; time?: string; timing?: string; set?: string; calibration?: string }): Reg1LabelSet {
  const h = flagInt(v.h);
  if (!Number.isInteger(h) || h < 0 || h >= REG1_HEREDITY_SETS) throw new Error(`--h must be 0-${REG1_HEREDITY_SETS - 1} for transmission --reg1, got ${v.h}`);
  if (v.time !== undefined || v.timing !== undefined || v.set !== undefined || v.calibration !== undefined) throw new Error("transmission --reg1 takes --h, not --time, --timing, --set or --calibration");
  const want = reg1HeredityLabelsOf(h);
  if (v.arm !== want.arm) throw new Error(`--arm must be ${want.arm} for --h ${h}, got ${v.arm}`);
  if (want.control !== null) {
    if (v.control !== want.control) throw new Error(`--control must be ${want.control} for --h ${h}, got ${v.control}`);
    if (v.history !== undefined && flagInt(v.history) !== reg1ControlWorldOf(h)) throw new Error(`--history must be ${reg1ControlWorldOf(h)} for --h ${h} (the ${want.control} control world), got ${v.history}`);
  } else {
    if (v.control !== undefined) throw new Error(`--control applies to --arm control, not --arm ${want.arm}`);
    if (flagInt(v.history) !== want.history) throw new Error(`--history must be ${want.history} for --h ${h} (${want.arm}), got ${v.history}`);
  }
  return want;
}

/** The `labels` of an assay.json as a reg1 set (consistent with its h, set and source world), or why they are not one. */
export function reg1LabelsFromJson(labels: unknown): { labels: Reg1LabelSet } | { error: string } {
  if (!isRecord(labels) || labels.reg1 !== true) return { error: "labels.reg1 is not true" };
  const l = labels;
  let want: Reg1LabelSet;
  try {
    if ((REG1_COMPETENCE_SETS as readonly unknown[]).includes(l.set)) want = reg1CompetenceLabelsOf(l.set as Reg1CompetenceSet, l.arm as Reg1Arm, l.history as number, l.timing as "a" | "b");
    else if (l.set === "garden-raw" || l.set === "garden-disc") want = reg1GardenLabelsOf(l.arm as "scaf" | "rand", l.history as number, l.time as 0 | 1, l.set === "garden-disc" ? "disc" : "fragment");
    else if (l.set === "heredity") want = reg1HeredityLabelsOf(l.h as number);
    else if (l.set === "capability") want = REG1_CAPABILITY_LABELS;
    else return { error: `labels.set ${JSON.stringify(l.set)} is not a reg1 set` };
  } catch (e) {
    return { error: `labels ${JSON.stringify(labels)}: ${(e as Error).message}` };
  }
  for (const key of ["arm", "history", "timing", "time", "h", "control"] as const) if (l[key] !== want[key]) return { error: `labels.${key} ${JSON.stringify(l[key])}, want ${JSON.stringify(want[key])} for ${reg1SetIdOf(want)}` };
  return { labels: want };
}

/**
 * Every set the registration runs, in its queue's order per index i: the 13 competence sets (the 8 sources, Ge-on-Fa, Ga-on-Fa, Ga-on-Fe
 * and both quenched controls), S2's 8 sets and S3's 2; then S3's 6 controls and R4.
 */
export function reg1ExpectedSets(): Reg1LabelSet[] {
  const sets: Reg1LabelSet[] = [];
  for (let i = 0; i < REG1_HISTORIES; i++) {
    for (const arm of ["scaf", "rand", "cont", "ancestor"] as const) for (const timing of ["a", "b"] as const) sets.push(reg1CompetenceLabelsOf("source", arm, i, timing));
    sets.push(reg1CompetenceLabelsOf("ge-on-fa", "scaf", i, "a"), reg1CompetenceLabelsOf("ga-on-fa", "scaf", i, "a"), reg1CompetenceLabelsOf("ga-on-fe", "scaf", i, "a"));
    sets.push(reg1CompetenceLabelsOf("quench", "scaf", i, "a"), reg1CompetenceLabelsOf("quench", "scaf", i, "b"));
    for (const arm of ["scaf", "rand"] as const) for (const time of [0, 1] as const) for (const inoculum of ["fragment", "disc"] as const) sets.push(reg1GardenLabelsOf(arm, i, time, inoculum));
    for (const arm of [0, 1]) sets.push(reg1HeredityLabelsOf(REG1_HISTORIES * arm + i));
  }
  for (let h = REG1_POSITIVE_H; h < REG1_HEREDITY_SETS; h++) sets.push(reg1HeredityLabelsOf(h));
  sets.push(REG1_CAPABILITY_LABELS);
  return sets;
}

/** What a runner bundle's manifest says that a source's validation reads; null for what is missing (an unreadable manifest gives a record of nulls). */
export interface Reg1RunRecord {
  manifest: string;
  runId: unknown;
  spec: Record<string, unknown> | null;
  presetIdentity: unknown;
  ruleVersion: unknown;
  startStep: unknown;
  initHash: unknown;
  /** The manifest has `summary` and `finishedAt`: the run completed. */
  complete: boolean;
  conservationOk: unknown;
  /** The manifest's `preCycleCheckpoints` entry for the source's boundary, null when it lists none. */
  preCycle: Record<string, unknown> | null;
}

/**
 * A runner-bundle source as loaded (assay.json `provenance`): the state's record with `source` the bundle directory it came from, the
 * boundary (null for the initial world, rebuilt), the checkpoint file read (null when rebuilt), whether the state's config is the spec's
 * (`specConfig`), the run record of its manifest, and the candidate bundles the loader chose it from (`Reg1Candidate`).
 */
export interface Reg1Source extends R3RepCheckpoint {
  boundary: number | null;
  checkpoint: string | null;
  sameConfig: boolean | null;
  run: Reg1RunRecord;
  candidates: Reg1Candidate[];
}

/**
 * A bundle a source could have come from, as its manifest stood when the source was loaded: whether there is a readable manifest, whether it
 * has a summary (only a run that finished has one), when the run started and finished, and so whether it is complete. A run that stopped
 * on an overflow shows a manifest with startedAt and no summary, which is why its census-100 rerun is the source.
 */
export interface Reg1Candidate {
  dir: string;
  complete: boolean;
  manifest: boolean;
  summary: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * The initial world of a runner spec, built the way runExperiment builds a run from its preset: `specConfig`, then the preset's `initWorld`.
 * A spec that founds its world otherwise (soloFounder, soloGenome, founderSet) is refused: no registered run does.
 */
export function reg1InitialWorld(spec: RunSpec): WorldState {
  if (spec.soloFounder !== undefined || spec.soloGenome !== undefined || spec.founderSet !== undefined) throw new Error("reg1InitialWorld: the spec founds its world from soloFounder, soloGenome or founderSet, which no registered run does");
  const preset = PRESETS.find((p) => p.id === spec.presetId);
  if (!preset) throw new Error(`reg1InitialWorld: unknown preset ${JSON.stringify(spec.presetId)}`);
  return initWorld(specConfig(spec), preset.init);
}

/** A bundle's manifest.json, parsed (null when it is missing, unreadable or not an object). */
async function readManifest(dir: string, read: (path: string) => Promise<Uint8Array>): Promise<Record<string, unknown> | null> {
  try {
    const x: unknown = JSON.parse(new TextDecoder().decode(await read(`${dir}/manifest.json`)));
    return isRecord(x) ? x : null;
  } catch {
    return null;
  }
}

/** A manifest the runner wrote at the end of a run: it has `summary` and `finishedAt` (a run that stopped, on an overflow or otherwise, has neither). */
const completeManifest = (m: Record<string, unknown> | null): boolean => m !== null && isRecord(m.summary) && typeof m.finishedAt === "string";

/**
 * Loads a source from a run bundle: the pre-cycle checkpoint of `boundary` (the file the manifest lists for it, raw encodeCheckpoint;
 * checkpoints/b<NNN>-pre.blck when it lists none), or with `boundary` null the initial world, rebuilt from the manifest's spec
 * (`reg1InitialWorld`). The bundle is `dir`, or, when `wants` names the bundles the source may come from (`reg1BundleWantsOf`) and `dir` is
 * one of them, the one of them that is complete: the run at census 1,000 or its overflow rerun at census 100 beside it. With none or more
 * than one complete it is `dir`, and the record's `candidates` say why (`reg1SourceProblems`). Returns the state and its record; whether the
 * source is the registration's is `reg1SourceProblems`'s to say. `read` reads a file's bytes (Deno.readFile, or node's readFile in tests).
 * Throws when there is no state to load.
 */
export async function loadReg1Source(dir: string, boundary: number | null, read: (path: string) => Promise<Uint8Array>, wants?: readonly Reg1BundleWant[]): Promise<{ state: WorldState; record: Reg1Source }> {
  const given = dir.replace(/\/+$/, "") || "/";
  const at = wants?.find((w) => endsInPath(given, w.dir));
  const dirs = at === undefined ? [given] : wants!.map((w) => `${given.slice(0, given.length - at.dir.length)}${w.dir}`);
  const manifests = await Promise.all(dirs.map((d) => readManifest(d, read)));
  const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
  const candidates: Reg1Candidate[] = dirs.map((d, k) => {
    const mk = manifests[k];
    return { dir: d, complete: completeManifest(mk), manifest: mk !== null, summary: mk !== null && isRecord(mk.summary), startedAt: str(mk?.startedAt), finishedAt: str(mk?.finishedAt) };
  });
  const complete = candidates.filter((c) => c.complete);
  const root = complete.length === 1 ? complete[0].dir : given;
  const manifestPath = `${root}/manifest.json`;
  const m = manifests[dirs.indexOf(root)]; // `given` is always one of `dirs`
  const spec = m !== null && isRecord(m.spec) ? m.spec : null;
  const summary = m !== null && isRecord(m.summary) ? m.summary : null;
  const listed = m !== null && Array.isArray(m.preCycleCheckpoints) ? (m.preCycleCheckpoints as unknown[]) : [];
  const entry = boundary === null ? null : ((listed.find((e) => isRecord(e) && e.boundary === boundary) as Record<string, unknown> | undefined) ?? null);
  const run: Reg1RunRecord = {
    manifest: manifestPath,
    runId: m?.runId ?? null,
    spec,
    presetIdentity: m?.presetIdentity ?? null,
    ruleVersion: m?.ruleVersion ?? null,
    startStep: m?.startStep ?? null,
    initHash: m?.initHash ?? null,
    complete: completeManifest(m),
    conservationOk: summary?.conservationOk ?? null,
    preCycle: entry,
  };
  let state: WorldState;
  let checkpoint: string | null = null;
  if (boundary === null) {
    if (spec === null) throw new Error(`${manifestPath} has no spec, so the initial world cannot be rebuilt`);
    state = reg1InitialWorld(spec as unknown as RunSpec);
  } else {
    checkpoint = `${root}/${entry !== null && typeof entry.file === "string" ? entry.file : reg1PreCycleFileOf(boundary)}`;
    state = decodeCheckpoint(await read(checkpoint)).state;
  }
  let same: boolean | null = null;
  try {
    same = spec === null ? null : canonicalConfig(state.cfg) === canonicalConfig(specConfig(spec as unknown as RunSpec));
  } catch {
    same = null;
  }
  return { state, record: { ...r3RepCheckpointOf(root, state), boundary, checkpoint, sameConfig: same, run, candidates } };
}

/**
 * What is wrong with `p` as a source of the registration (none: it is), every problem listed and prefixed with `role`. `wants` are the
 * bundles it may come from (`reg1BundleWantsOf(h)` in production: the run at census 1,000 and its census-100 rerun), `want` below the one
 * whose directory it is, and `boundary` the pre-cycle checkpoint it must be (null: the initial world).
 * - The directory ends in `want.dir` and in the manifest's runId (the manifest is the directory's own).
 * - The loader looked at every one of `wants` beside it, and at most one of them is complete: two complete runs of one history leave the
 *   source ambiguous.
 * - The manifest is complete (summary and finishedAt), with `summary.conservationOk` true and the frozen protocol's rule version 1.
 * - Its spec has `want`'s experiment, preset, condition, seed, steps, census, deep metrics and periodic checkpoints (none), and no override
 *   or alternative founding; it lists `boundary` in `preCycleCheckpoints`. The manifest records the preset's identity (`want.presetIdentity`).
 * - It is one uninterrupted run: from step 0 (startStep 0), its world built from the preset (an initHash).
 * - The checkpoint is the manifest's file for `boundary` (checkpoints/b<NNN>-pre.blck) and its state hashes to the hash recorded there; its
 *   step is boundary x period. The initial world (no checkpoint) is that of a run from step 0 and hashes to the manifest's initHash.
 * - The state's config is the spec's (`specConfig`), so its seed is `spec.seed` and its mutation rate the default, on `want.side`² ponds.
 */
export function reg1SourceProblems(wants: Reg1BundleWant | readonly Reg1BundleWant[], boundary: number | null, p: unknown, role = "source"): string[] {
  const shape = checkpointShapeProblems(p, role);
  if (shape.length > 0) return shape;
  const s = p as Reg1Source;
  const why: string[] = [];
  const is = (name: string, got: unknown, expected: unknown) => {
    if (got !== expected) why.push(`${role} ${name} ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
  };
  const all: readonly Reg1BundleWant[] = Array.isArray(wants) ? wants : [wants as Reg1BundleWant];
  const dir = s.source.replace(/\/+$/, "");
  const want = all.find((w) => endsInPath(dir, w.dir)) ?? all[0];
  if (!endsInPath(dir, want.dir)) why.push(`${role} directory ${JSON.stringify(s.source)} is not ${all.map((w) => w.dir).join(" or ")}`);
  // The bundles it was chosen from: every one it may come from, at most one of them complete.
  const candidates = Array.isArray(s.candidates) ? s.candidates.filter(isRecord) : null;
  if (candidates === null) why.push(`${role} records no candidate bundles`);
  else {
    for (const w of all) if (!candidates.some((c) => typeof c.dir === "string" && endsInPath(c.dir.replace(/\/+$/, ""), w.dir))) why.push(`${role} was not chosen with ${w.dir} in view`);
    const complete = candidates.filter((c) => c.complete === true).map((c) => c.dir);
    if (complete.length > 1) why.push(`${role} is ambiguous: ${complete.length} complete runs of it (${complete.join(", ")}), want one`);
  }
  is("boundary", s.boundary, boundary);
  // The state itself.
  is("seed", s.seed, want.seed);
  is("mutRate", s.mutRate, want.mutRate);
  if (s.tilesX !== want.side || s.tilesY !== want.side) why.push(`${role} has ${s.tilesX} x ${s.tilesY} ponds, want ${want.side} x ${want.side}`);
  if (s.sameConfig !== true) why.push(`${role} state's config ${s.sameConfig === false ? "is not" : "was not compared with"} its spec's (specConfig)`);
  // Its run, as the manifest records it.
  const run: Record<string, unknown> = isRecord(s.run) ? s.run : {};
  const spec = isRecord(run.spec) ? run.spec : null;
  if (spec === null) why.push(`${role} has no readable manifest.json with a spec${typeof run.manifest === "string" ? ` (${run.manifest})` : ""}`);
  else {
    for (const key of ["experiment", "presetId", "condition", "seed", "steps", "censusEvery", "deepEvery", "checkpointEvery"] as const) is(`spec.${key}`, spec[key], want[key]);
    for (const key of ["overrides", "soloFounder", "soloGenome", "founderSet", "metapopulation"]) if (spec[key] !== undefined) why.push(`${role} spec sets ${key}, which no registered run does`);
    const id = runId(spec as unknown as RunSpec);
    if (run.runId !== id) why.push(`${role} manifest runId ${JSON.stringify(run.runId)} is not its spec's ${JSON.stringify(id)}`);
    else if (!endsInPath(dir, id)) why.push(`${role} directory ${JSON.stringify(s.source)} does not end in its manifest's runId ${id}`);
    if (boundary !== null && !(Array.isArray(spec.preCycleCheckpoints) && spec.preCycleCheckpoints.includes(boundary))) why.push(`${role} spec.preCycleCheckpoints ${JSON.stringify(spec.preCycleCheckpoints)} does not list boundary ${boundary}`);
  }
  if (run.complete !== true) why.push(`${role} run is incomplete: its manifest.json has no summary and finishedAt`);
  else is("run summary.conservationOk", run.conservationOk, true);
  is("run ruleVersion", run.ruleVersion, 1);
  is("run presetIdentity", run.presetIdentity, want.presetIdentity);
  // One uninterrupted run: from step 0, its world built from the preset (the manifest records that world's hash).
  is("run startStep", run.startStep, 0);
  if (typeof run.initHash !== "string") why.push(`${role} manifest has no initHash (a run continued from a checkpoint, not one run from the preset)`);
  if (boundary === null) {
    // The initial world, rebuilt: it hashes to the manifest's initHash.
    is("step", s.step, 0);
    if (s.checkpoint !== null) why.push(`${role} is the initial world, rebuilt, but names the checkpoint ${JSON.stringify(s.checkpoint)}`);
    if (typeof run.initHash === "string" && s.stateHash !== run.initHash) why.push(`${role} initial world rebuilt from the spec hashes to ${s.stateHash}, but the manifest's initHash is ${run.initHash}`);
  } else {
    is("step", s.step, boundary * want.period);
    const e = isRecord(run.preCycle) ? run.preCycle : null;
    if (e === null) why.push(`${role} manifest lists no pre-cycle checkpoint at boundary ${boundary}`);
    else {
      is("manifest pre-cycle file", e.file, reg1PreCycleFileOf(boundary));
      is("manifest pre-cycle step", e.step, boundary * want.period);
      if (s.checkpoint !== `${dir}/${e.file}`) why.push(`${role} checkpoint ${JSON.stringify(s.checkpoint)} is not the manifest's file for boundary ${boundary} (${JSON.stringify(e.file)})`);
      if (s.stateHash !== e.hash) why.push(`${role} state hash ${s.stateHash}, but the manifest records ${JSON.stringify(e.hash)} for boundary ${boundary}`);
    }
  }
  return why;
}

/** What `continue --reg1` writes beside its checkpoint (`r3RepSidecarPathOf`), last: the source it continued (with its whole record) and the end state. */
export interface Reg1Continuation {
  reg1: true;
  arm: Reg1Arm;
  history: number;
  h: number;
  source: string;
  boundary: number;
  sourceStateHash: string;
  sourceSeed: number;
  sourceStep: number;
  seed: number;
  steps: number;
  mutRate: number;
  censusEvery: number;
  endStateHash: string;
  endStep: number;
  origin: Reg1Source;
  protocolSha256Reg1: string;
  /** Present (true) only when the continuation ran under --allow-any-seed: a smoke test's, never a production source. */
  allowAnySeed?: true;
}

/** The sidecar of the continuation of source h from `origin` (its timing (a) source) to `end` after `steps` steps; `allowAnySeed` marks a smoke test's. */
export function reg1ContinuationOf(p: { h: number; origin: Reg1Source; end: R3RepCheckpoint; steps: number; censusEvery: number; protocolSha256Reg1: string; allowAnySeed?: boolean }): Reg1Continuation {
  const l = reg1HistoryOf(p.h);
  return {
    reg1: true,
    arm: l.arm,
    history: l.history,
    h: l.h,
    source: p.origin.source,
    boundary: p.origin.boundary!,
    sourceStateHash: p.origin.stateHash,
    sourceSeed: p.origin.seed,
    sourceStep: p.origin.step,
    seed: p.end.seed,
    steps: p.steps,
    mutRate: p.end.mutRate,
    censusEvery: p.censusEvery,
    endStateHash: p.end.stateHash,
    endStep: p.end.step,
    origin: p.origin,
    protocolSha256Reg1: p.protocolSha256Reg1,
    ...(p.allowAnySeed ? { allowAnySeed: true as const } : {}),
  };
}

/**
 * What is wrong with `c` as the sidecar of source h's continuation, read against `origin` (its timing (a) source, loaded as it is now) and
 * `end` (the checkpoint beside it, as loaded): the labels must be h's, the source, boundary, state hash, seed and step `origin`'s, the seed
 * 4,850,501 + h, 2 x 10^5 steps, the default mutation rate, a census every 100, endStep = sourceStep + steps, the protocol hash
 * `protocolSha256Reg1`, and the end state hash, seed, mutation rate and step `end`'s; one written under --allow-any-seed is refused.
 */
export function reg1ContinuationProblems(h: number, c: unknown, origin: unknown, end: unknown, protocolSha256Reg1: string): string[] {
  if (!isRecord(c)) return ["no continuation sidecar (the <checkpoint>.json that continue --reg1 writes last)"];
  const l = reg1HistoryOf(h);
  const why: string[] = [];
  const is = (name: string, got: unknown, expected: unknown) => {
    if (got !== expected) why.push(`continuation ${name} ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
  };
  is("reg1", c.reg1, true);
  is("arm", c.arm, l.arm);
  is("history", c.history, l.history);
  is("h", c.h, h);
  is("boundary", c.boundary, reg1BoundaryAOf(h));
  is("seed", c.seed, reg1ContinueSeed(h));
  is("steps", c.steps, REG1_CONTINUE_STEPS);
  is("mutRate", c.mutRate, pondConfig(REG1_REGIME.side, 0).mutRate);
  is("censusEvery", c.censusEvery, REG1_REGIME.censusEvery);
  is("protocolSha256Reg1", c.protocolSha256Reg1, protocolSha256Reg1);
  if (c.allowAnySeed !== undefined) why.push(`continuation was written under --allow-any-seed (allowAnySeed ${JSON.stringify(c.allowAnySeed)}): a smoke test's, not a source`);
  if (!Number.isInteger(c.sourceStep) || !Number.isInteger(c.steps) || c.endStep !== (c.sourceStep as number) + (c.steps as number)) why.push(`continuation endStep ${JSON.stringify(c.endStep)} is not sourceStep ${JSON.stringify(c.sourceStep)} + steps ${JSON.stringify(c.steps)}`);
  // The timing (a) source it names, as it is now.
  if (!isRecord(origin)) why.push("the continuation's source was not read");
  else {
    is("source", c.source, origin.source);
    is("boundary", c.boundary, origin.boundary);
    is("sourceStateHash", c.sourceStateHash, origin.stateHash);
    is("sourceSeed", c.sourceSeed, origin.seed);
    is("sourceStep", c.sourceStep, origin.step);
  }
  // The checkpoint it wrote: the state being assayed.
  if (!isRecord(end)) why.push("the continued checkpoint was not read");
  else {
    for (const [key, field] of [["stateHash", "endStateHash"], ["seed", "seed"], ["mutRate", "mutRate"], ["step", "endStep"]] as const) {
      if (end[key] !== c[field]) why.push(`the continued checkpoint's ${key} ${JSON.stringify(end[key])} is not the continuation's ${field} ${JSON.stringify(c[field])}`);
    }
  }
  return why;
}

/** What is wrong with a `continue --reg1` of source h: its seed (4,850,501 + h), steps (2 x 10^5), census (every 100) and output path (`reg1ContinuationPathOf`). */
export function reg1ContinueProblems(h: number, x: { seed: number; steps: number; censusEvery: number; out: string }): string[] {
  const why: string[] = [];
  if (x.seed !== reg1ContinueSeed(h)) why.push(`seed ${x.seed}, want reg1ContinueSeed(${h}) = ${reg1ContinueSeed(h)}`);
  if (x.steps !== REG1_CONTINUE_STEPS) why.push(`steps ${x.steps}, want ${REG1_CONTINUE_STEPS}`);
  if (x.censusEvery !== REG1_REGIME.censusEvery) why.push(`census every ${x.censusEvery}, want ${REG1_REGIME.censusEvery}`);
  if (!endsInPath(x.out, reg1ContinuationPathOf(h))) why.push(`output ${JSON.stringify(x.out)} does not end in ${reg1ContinuationPathOf(h)}`);
  return why;
}

/** S3's control checkpoints (scaffold.ts runs, gzipped) under runs/: the P2 ranking world s at b1-pre, or the negative-control world j at b1-pre. */
export const reg1ControlPathOf = (h: number): string =>
  reg1HeredityLabelsOf(h).control === "positive" ? `scaffold/p2/rank/s${reg1ControlWorldOf(h)}/ckpt/b1-pre.blck.gz` : `scaffold/reg1/neg/j${reg1ControlWorldOf(h)}/ckpt/b1-pre.blck.gz`;

/**
 * What is wrong with an S3 control's source (h 48-53) against its labels, as R1'' checks its controls (`r1dPrimeSourceProblems`) with this
 * block's paths and seeds: the checkpoint is `reg1ControlPathOf(h)`, mutation off, step 10,000, 8 x 8 ponds, a founders world (more than
 * one genome) seeded 4,805,001 + s for a positive control, a clone world (one genome) seeded 4,880,001 + j for a negative one, and not a
 * post-cycle state (`postCycleOf`, with a recorded flag its own measures give).
 */
export function reg1ControlProblems(h: number, p: Pick<R1dPrimeProvenance, "source" | "seed" | "mutRate" | "step" | "tilesX" | "tilesY" | "distinctGenomes" | "phase">): string[] {
  const l = reg1HeredityLabelsOf(h);
  if (l.control === null) return [`h ${h} is a history, not an S3 control`];
  const why: string[] = [];
  const positive = l.control === "positive";
  if (!endsInPath(p.source, reg1ControlPathOf(h))) why.push(`source path ${JSON.stringify(p.source)} does not end in ${reg1ControlPathOf(h)}`);
  const want = (name: string, got: number, expected: number) => {
    if (got !== expected) why.push(`source ${name} ${got}, want ${expected}`);
  };
  want("seed", p.seed, positive ? R1DP_POSITIVE_SEED_BASE + reg1ControlWorldOf(h) : reg1NegativeSeed(reg1ControlWorldOf(h)));
  want("mutRate", p.mutRate, 0);
  want("step", p.step, R1DP_CONTROL_STEP);
  if (positive ? !(p.distinctGenomes > 1) : p.distinctGenomes !== 1) why.push(`source holds ${p.distinctGenomes} distinct genomes, want ${positive ? "more than 1 (a founders world)" : "1 (a clone world)"}`);
  if (p.tilesX !== REG1_REGIME.side || p.tilesY !== REG1_REGIME.side) why.push(`source has ${p.tilesX} x ${p.tilesY} ponds, want ${REG1_REGIME.side} x ${REG1_REGIME.side}`);
  const post = postCycleOf(p.phase);
  if (p.phase.postCycle !== post) why.push(`source phase flag postCycle ${p.phase.postCycle} disagrees with its measures (${post})`);
  if (post) why.push(`source looks post-cycle (C ${p.phase.totalC}, S ${p.phase.totalS}; ${p.phase.outsideWindow} of ${p.phase.carrying} cells with bound mass or a lineage outside the landing window), want the pre-cycle state`);
  return why;
}

/**
 * What an assay's recorded `provenance` is for (assay.json): a competence set at timing (a), an S2 set and an S3 history's are the runner
 * source (`Reg1Source`); at timing (b) the continued checkpoint with its sidecar (`continuation`) and the timing (a) source it names
 * (`origin`); an S3 control's the R1'' record of its checkpoint. Ge-on-Fa also records its genome `donor`, scaf_i's timing (a) source, with
 * its dominant genome (null when it has none).
 */
export interface Reg1Provenance extends R3RepCheckpoint {
  continuation?: unknown;
  origin?: Reg1Source | null;
  donor?: Reg1Source & { dominant: R3RepDominant | null };
}

/**
 * What is wrong with a set's recorded provenance for its labels (none: it is the registration's). A competence set's fragment source is
 * source h (`labels.h`: ancestor world i for the swap pair) at timing (a) (`reg1SourceProblems` at boundary 100, or 1) or its
 * continuation at (b) (path `reg1ContinuationPathOf(h)`, its sidecar and the timing (a) source the sidecar names); Ge-on-Fa's donor is
 * scaf_i's timing (a) source with a dominant genome record (or null), and no other set has a donor. S2's source is the history's initial
 * world (time 0) or its boundary-100 source (time C); S3's a history's boundary-34 pre-cycle checkpoint, or a control's (`reg1ControlProblems`).
 */
export function reg1ProvenanceProblems(labels: Reg1LabelSet, p: unknown, protocolSha256Reg1: string): string[] {
  if (!isRecord(p)) return ["assay.json has no provenance of its source (run the assay with --reg1)"];
  if (labels.h === null) return [`set ${labels.set} has no source of its own`];
  const h = labels.h;
  const why: string[] = [];
  if (labels.set === "heredity") {
    if (labels.control === null) why.push(...reg1SourceProblems(reg1BundleWantsOf(h), REG1_HEREDITY_BOUNDARY, p));
    else if (typeof p.source !== "string" || !isRecord(p.phase) || !Number.isInteger(p.distinctGenomes)) why.push("source is not an S3 control's record (path, phase and distinct genomes)");
    else why.push(...reg1ControlProblems(h, p as unknown as R1dPrimeProvenance));
  } else if (labels.set === "garden-raw" || labels.set === "garden-disc") why.push(...reg1SourceProblems(reg1BundleWantsOf(h), labels.time === 0 ? null : reg1BoundaryAOf(h), p));
  else if (labels.timing === "a") why.push(...reg1SourceProblems(reg1BundleWantsOf(h), reg1BoundaryAOf(h), p));
  else {
    const shape = checkpointShapeProblems(p, "source");
    why.push(...shape);
    if (shape.length === 0) {
      if (!endsInPath(p.source as string, reg1ContinuationPathOf(h))) why.push(`source path ${JSON.stringify(p.source)} does not end in ${reg1ContinuationPathOf(h)}`);
      if (p.tilesX !== REG1_REGIME.side || p.tilesY !== REG1_REGIME.side) why.push(`source has ${p.tilesX} x ${p.tilesY} ponds, want ${REG1_REGIME.side} x ${REG1_REGIME.side}`);
    }
    why.push(...reg1SourceProblems(reg1BundleWantsOf(h), reg1BoundaryAOf(h), p.origin, "continuation source"));
    why.push(...reg1ContinuationProblems(h, p.continuation, p.origin, p, protocolSha256Reg1));
  }
  if (labels.set === "ge-on-fa") {
    why.push(...reg1SourceProblems(reg1BundleWantsOf(labels.history!), reg1BoundaryAOf(labels.history!), p.donor, "donor"));
    const d = isRecord(p.donor) ? p.donor.dominant : undefined;
    const ok = d === null || (isRecord(d) && Number.isInteger(d.hi) && Number.isInteger(d.lo) && d.id === `${d.hi}:${d.lo}` && typeof d.words === "string" && new RegExp(`^[0-9a-f]{${8 * GENOME_CHANNELS}}$`).test(d.words));
    if (!ok) why.push(`donor dominant ${JSON.stringify(d)} is not a dominant genome record (id hi:lo, hi, lo and ${GENOME_CHANNELS} hex words) or null`);
  } else if (p.donor !== undefined) why.push(`provenance names a genome donor, but ${labels.set} has none`);
  return why;
}

/** R4's sources in their fixed order (the genomes' order in evaluateBatch): every history's timing (a) source, scaf, rand, cont by i, then every ancestor world's. */
export function reg1CapabilitySources(): (Reg1History & { dir: string; boundary: number })[] {
  return Array.from({ length: REG1_SOURCES }, (_, h) => ({ ...reg1HistoryOf(h), dir: reg1BundleDirOf(h), boundary: reg1BoundaryAOf(h) }));
}

/** Calibration seeds are 4,802,001 + 10 v + s (protocol, P1). */
export const CALIBRATION_SEED_BASE = 4_802_001;
/**
 * The seed (+ s) of both calibration sets: the ancestor competence's v = 1 streams. The quenched control is a variant
 * of the unmodified arm, so it takes the same fragments and physics stream (common random numbers; protocol,
 * "Readouts (assay seeds)"); which set it is stays in `labels.calibration`.
 */
export const CALIBRATION_SEED = CALIBRATION_SEED_BASE + 10;

/** The seed of assaySeed(r, h, t, v, s) broken back into its fields. Throws if it lies outside that range. */
export function decodeAssaySeed(seed: number): { r: number; h: number; t: number; v: number; s: number } {
  const x = seed - 4_820_001;
  if (!Number.isInteger(x) || x < 0) throw new Error(`${seed} is not an assay seed`);
  const r = Math.floor(x / 5000);
  const h = Math.floor((x % 5000) / 250);
  const low = x % 250; // 100 t + 20 v + s
  const t = Math.floor(low / 100);
  const v = Math.floor((low % 100) / 20);
  const s = low % 20;
  assaySeed(r, h, t, v, s); // range check of every field
  return { r, h, t, v, s };
}

/**
 * The labels of one assay from the CLI's --arm/--history/--time/--timing/--calibration values. `time` and
 * `timing` name the same thing (0 = a, 1 = b): give either, or both when they agree. Transmission and
 * garden assays label scaf or rand histories only; a calibration set is an ancestor set.
 */
export function parseAssayLabels(
  assay: AssayName,
  v: { arm?: string; history?: string; time?: string; timing?: string; calibration?: string },
): AssayLabelSet {
  const arm = v.arm;
  const arms = assay === "competence" ? ["scaf", "rand", "cont", "ancestor"] : ["scaf", "rand"];
  if (arm === undefined || !arms.includes(arm)) throw new Error(`--arm must be ${arms.join("|")} for ${assay}, got ${arm}`);
  let time: 0 | 1 | undefined;
  if (v.time !== undefined) {
    if (v.time !== "0" && v.time !== "1") throw new Error(`--time must be 0 or 1, got ${v.time}`);
    time = v.time === "0" ? 0 : 1;
  }
  let timing: "a" | "b" | undefined;
  if (v.timing !== undefined) {
    if (v.timing !== "a" && v.timing !== "b") throw new Error(`--timing must be a or b, got ${v.timing}`);
    timing = v.timing;
  }
  if (time === undefined && timing === undefined) throw new Error("--time (0|1) or --timing (a|b) is required");
  if (time !== undefined && timing !== undefined && time !== (timing === "a" ? 0 : 1)) throw new Error(`--time ${v.time} and --timing ${v.timing} disagree`);
  const t = time ?? (timing === "a" ? 0 : 1);
  const labels: AssayLabelSet = { arm: arm as AssayLabelSet["arm"], time: t, timing: t === 0 ? "a" : "b" };
  if (arm !== "ancestor") {
    const i = Number(v.history);
    if (v.history === undefined || !Number.isInteger(i) || i < 0 || i > 5) throw new Error(`--history must be 0-5 for arm ${arm}, got ${v.history}`);
    labels.history = i;
  } else if (v.history !== undefined) throw new Error("--history does not apply to the ancestor");
  if (v.calibration !== undefined) {
    if (v.calibration !== "1" && v.calibration !== "2") throw new Error(`--calibration must be 1 or 2, got ${v.calibration}`);
    if (assay !== "competence" || arm !== "ancestor" || t !== 0) throw new Error("--calibration labels an ancestor competence set at timing a");
    labels.calibration = v.calibration === "1" ? 1 : 2;
  }
  return labels;
}

/**
 * Checks a labelled assay against the seeds of replicate `replicate` (0-based; its seeds are the replicate-0 seeds
 * + replicate): each decoded with `decodeAssaySeed` must carry this assay's r, the labelled h (6 arm + i; 18 for
 * the ancestor) and t, and s = replicate. The fragment seed is a v = 0 seed and the physics seed is v = 0 as well,
 * except R2's disc inoculum, whose physics seed is v = 1. The exception is `swap-ea` (Ge-on-Fa), whose fragments
 * come from the ancestor source: its seeds carry h = 18 while the labels name the scaf history it tests.
 * Calibration sets (`labels.calibration`, 1 or 2) both use `CALIBRATION_SEED` + replicate, so the quenched control
 * shares the ancestor's fragments and physics; a legacy quenched set seeded 4,802,021 + s is refused as unmatched.
 * The tau calibration (`labels.tauCalibration`) needs `TAU_SEED_BASE` + replicate. Throws on any mismatch.
 */
export function checkAssaySeeds(assay: AssayName, labels: AssayLabelSet, inoculum: string, seeds: { physics: number; fragment: number }, replicate = 0): void {
  if (labels.tauCalibration) return checkTauSeeds(seeds, replicate);
  if (labels.calibration !== undefined) {
    const want = CALIBRATION_SEED + replicate;
    if (seeds.physics === want && seeds.fragment === want) return;
    const legacy = CALIBRATION_SEED_BASE + 20 + replicate;
    if (labels.calibration === 2 && seeds.physics === legacy && seeds.fragment === legacy) {
      throw new Error(`calibration 2 seed ${legacy} is a legacy separately seeded quenched control: its fragments differ from the ancestor's, so it is not a matched control and not a decision input (re-run with seed ${want})`);
    }
    throw new Error(`calibration ${labels.calibration} needs seed ${want}, got ${seeds.physics} (fragment ${seeds.fragment})`);
  }
  if (inoculum === "swap-ea" && labels.arm !== "scaf") throw new Error("swap-ea labels the scaf history it tests");
  const h = inoculum === "swap-ea" ? 18 : labels.arm === "ancestor" ? 18 : 6 * ["scaf", "rand", "cont"].indexOf(labels.arm) + labels.history!;
  for (const [name, seed, wantV] of [["seed", seeds.physics, assay === "garden" && inoculum === "disc" ? 1 : 0], ["fragment seed", seeds.fragment, 0]] as const) {
    const d = decodeAssaySeed(seed);
    const bad = d.r !== ASSAY_R[assay] ? `r ${d.r}, want ${ASSAY_R[assay]}` : d.h !== h ? `h ${d.h}, want ${h}` : d.t !== labels.time ? `t ${d.t}, want ${labels.time}` : d.v !== wantV ? `v ${d.v}, want ${wantV}` : d.s !== replicate ? `s ${d.s}, want ${replicate}` : null;
    if (bad) throw new Error(`${name} ${seed} does not match the labels (${JSON.stringify(labels)}): ${bad}`);
  }
}

/** R1's donor-selection seed of a labelled scaf or rand history at a time: assaySeed(1, h, t, 0, 9) (s = 9 is reserved for it). */
export function donorSeedOf(labels: AssayLabelSet): number {
  if ((labels.arm !== "scaf" && labels.arm !== "rand") || labels.history === undefined) throw new Error("R1 donors belong to a scaf or rand history");
  return assaySeed(1, 6 * (labels.arm === "scaf" ? 0 : 1) + labels.history, labels.time, 0, 9);
}

/** Throws unless `donorSeed` is `donorSeedOf(labels)`, the seed the protocol draws R1's donors with. */
export function checkDonorSeed(labels: AssayLabelSet, donorSeed: number): void {
  const want = donorSeedOf(labels);
  if (donorSeed !== want) throw new Error(`donor seed ${donorSeed} does not match the labels (${JSON.stringify(labels)}): want assaySeed(1, h, t, 0, 9) = ${want}`);
}

/** The assay.json of one assay directory: identity, parameters, the `labels` scaffold-report reads, and the summary. */
export function assayJson(p: {
  protocolSha256: string;
  assay: string;
  source: string;
  tag: string;
  k: number;
  period: number;
  ref: number | null;
  side: number;
  replicates: number;
  censusEvery: number;
  inoculum: string;
  seeds: { physics: number; fragment: number }[];
  labels: AssayLabelSet | R1PrimeLabelSet | R1dPrimeLabelSet | R3RepLabelSet | Reg1LabelSet;
  extra: Record<string, unknown>;
  summary: Record<string, unknown>;
  wallSeconds: number;
}): Record<string, unknown> {
  return {
    tool: "scaffold-assays",
    protocolSha256: p.protocolSha256,
    assay: p.assay,
    source: p.source,
    tag: p.tag,
    k: p.k,
    period: p.period,
    ref: p.ref,
    side: p.side,
    replicates: p.replicates,
    mutRate: 0,
    censusEvery: p.censusEvery,
    inoculum: p.inoculum,
    seeds: p.seeds,
    labels: p.labels,
    ...p.extra,
    summary: p.summary,
    conservationOk: true,
    wallSeconds: p.wallSeconds,
  };
}
