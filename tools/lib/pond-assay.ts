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
  NN_WORDS,
  allocState,
  buildWorld,
  emptyGenome,
  cellCount,
  validateState,
  worldW,
  type Founder,
  type Genome,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { MOT_ZERO } from "@bl/sim-ref";
import { assaySeed, drawPacketCentre, packetWindow, pondTraits, randomKey, weightedPick } from "./ponds.ts";

/** Fixed matter budget of every assay pond: 4096 x 37, close to an ancestor pond's initial matter. */
export const M_ASSAY = 151552;

/**
 * Column order of assay.tsv: the contract's header, then the requested and retained E (R1 residualises on
 * log(1 + retained E); R3 reports its distribution) and the truncation flag (the report's 1% rule).
 */
export const ASSAY_COLUMNS = ["assay", "source", "replicate", "pond", "family", "inoculum", "reqMass", "retMass", "endTrait", "success", "reqE", "retE", "truncated"] as const;

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
 * Throws on any mismatch.
 */
export function checkAssaySeeds(assay: AssayName, labels: AssayLabelSet, inoculum: string, seeds: { physics: number; fragment: number }, replicate = 0): void {
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
  labels: AssayLabelSet;
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
