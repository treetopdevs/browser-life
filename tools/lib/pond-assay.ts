// Assay worlds of the ecological-scaffolding sandbox (docs/scaffold-protocol-v1.md, "Assay world",
// "Standard fragment" and R1-R4). A source world (a pond-cycle history's state) is sampled into
// standard fragments, each fragment is planted alone at the centre of a fresh pond holding a fixed
// matter budget M_assay, and the assay world runs one period with mutation off. Everything here is
// host-side, integer and pure (no Deno API), so vitest exercises it directly; the GPU loop and the
// CLI are tools/scaffold-assays.ts.
import {
  CH,
  G,
  GENOME_CHANNELS,
  M3_FOUNDERS,
  NN_WORDS,
  allocState,
  buildWorld,
  emptyGenome,
  encodeGenome,
  founderGenome,
  cellCount,
  stateHash,
  validateState,
  worldW,
  type Founder,
  type Genome,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
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
  const pin = R3REP_PROTOCOLS[which];
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
const endsInPath = (path: string, tail: string): boolean => path === tail || path.endsWith(`/${tail}`);

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
function checkpointShapeProblems(x: unknown, role: string): string[] {
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
  labels: AssayLabelSet | R1PrimeLabelSet | R1dPrimeLabelSet | R3RepLabelSet;
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
