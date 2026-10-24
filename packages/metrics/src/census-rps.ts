// Per-label census for the cyclic-competition (RPS) line. Rules: runs/rps/rule-draft.md section 0 and Appendix B (frozen as
// experiments/3d-rps/RULES.md); plan: docs/3d-cyclic-rps-plan-2026-10-23.md section 7.2.
//
// Everything here is computed on the host from the raw arrays of `GpuSim3.readSnapshot()` (`cells`: 7 channels, `genomeHead`: 4
// channels, both channel major) or from `final.bin`, which stores the same two arrays. Nothing is read from the schema's RPS
// constants: Part A changes no schema file, so the PARAM1 and MOT byte positions are local copies, pinned by a test, and M0 will
// turn them into imports of the layout3d.ts constants.
//
//   PARAM1 (genome word 3):  byte 0 motGain | byte 1 TYPE (the census label) | byte 2 beats-mask | byte 3 reserved (0)
//   MOT (cell channel 6):    bytes 0-2 flow word | bits 24-31 the cell's beats-mask (the "mirror")
//
// The module also owns the `census.tsv` contract of rule draft B.2 (header, row writer, parser), so that the driver that writes
// the file and the readout that parses it share one definition, and the `final.bin` layout of B.3.

import { CH, G } from "@bl/schema";

/** PARAM1 bits 8..15: the type `t`, which is the census label. */
export const RPS_TYPE_SHIFT = 8;
/** PARAM1 bits 16..23: the beats-mask `m` (bit `j` set: this lineage kills neighbouring type `j`). */
export const RPS_MASK_SHIFT = 16;
/** MOT bits 24..31 hold the living cell's beats-mask (0 for a cell that is not living). */
export const RPS_MIRROR_SHIFT = 24;
/** The type space is at most 8 labels (8 mask bits). */
export const RPS_MAX_LABELS = 8;
/** Entry of a per-cell label array for a cell that is not living. */
export const RPS_NO_LABEL = 255;
/** `s0`: a label is present iff its share of the living cells is at least this (rule draft 0). */
export const RPS_PRESENT_SHARE = 0.02;
/** `1 / RPS_PRESENT_SHARE`, so that the share test is exact integer arithmetic. */
const PRESENT_DEN = 50;
/** Chirality is 0 when fewer than this many counted changes fall in the set (rule draft 0). */
export const RPS_CHI_MIN_CHANGES = 200;
/** Mutant supply counts lineages holding at least this many living cells (rule draft 7.3, D13). */
export const RPS_SUPPLY_MIN_CELLS = 64;
/** The correlation length looks at lags 1..32 and reports 33 when `g` never drops below 1/e. */
export const RPS_XI_MAX_LAG = 32;

const CELL_CHANNELS = 7;
const HEAD_CHANNELS = 4;

/** The type byte of a PARAM1 word. */
export const rpsTypeOf = (param1: number): number => (param1 >>> RPS_TYPE_SHIFT) & 0xff;
/** The beats-mask byte of a PARAM1 word. */
export const rpsMaskOf = (param1: number): number => (param1 >>> RPS_MASK_SHIFT) & 0xff;
/** The mirrored beats-mask of a MOT word. */
export const rpsMirrorOf = (mot: number): number => mot >>> RPS_MIRROR_SHIFT;

export interface RpsDims {
  W: number;
  H: number;
  D: number;
}

/** The two arrays of `GpuSim3.readSnapshot()` that the census reads (extra fields of the snapshot are ignored). */
export interface RpsSnapshot {
  cells: Uint32Array;
  genomeHead: Uint32Array;
}

export interface RpsCensusOptions {
  /** Also compute the mutant supply (jobs with mutation). Default false: the field is then 0 and the TSV column empty. */
  supply?: boolean;
  /** Supply threshold in living cells; default 64. */
  supplyMinCells?: number;
}

export interface RpsCensus {
  /** Cells in the world. */
  total: number;
  /** Cells whose two lineage words are not both 0. */
  living: number;
  /** `living / total`. */
  liv: number;
  /** Living cells per label (length 8). */
  byLabel: number[];
  /** `B + P` summed over the living cells of each label (length 8). */
  massByLabel: number[];
  /** `byLabel / living` (all 0 when nothing lives). */
  shares: number[];
  /** `share >= 0.02`, per label. */
  present: boolean[];
  /** The present labels, ascending: `S_c`. */
  S: number[];
  /** `|S_c|`. */
  n: number;
  /** Modal beats-mask per label (ties to the smaller value); null for a label with no living cell. */
  modal: (number | null)[];
  /** `Y_c`: `n_c` if the dominance graph on `S_c` holds a clean cycle, else 0. */
  Y: number;
  /** Share of columns with a living cell whose living cells all carry one label; null if no column has one. */
  zcoh: number | null;
  /** Living cells per layer and label: `[z][label]`. */
  layerLabelCells: number[][];
  /** Distinct lineages born after the start (lineage hi word nonzero) holding at least `supplyMinCells` living cells; 0 unless asked for. */
  supply: number;
  /** Per-cell label (`RPS_NO_LABEL` for a cell that is not living): the next census's `rpsChanges` input. */
  labels: Uint8Array;
}

function checkShape(snap: RpsSnapshot, dims: RpsDims): number {
  const n = dims.W * dims.H * dims.D;
  if (!(Number.isInteger(dims.W) && Number.isInteger(dims.H) && Number.isInteger(dims.D) && dims.W > 0 && dims.H > 0 && dims.D > 0)) {
    throw new RangeError(`rpsCensus: bad dimensions ${dims.W} x ${dims.H} x ${dims.D}`);
  }
  if (snap.cells.length !== CELL_CHANNELS * n) throw new RangeError(`rpsCensus: cells has ${snap.cells.length} words, expected ${CELL_CHANNELS * n}`);
  if (snap.genomeHead.length !== HEAD_CHANNELS * n) throw new RangeError(`rpsCensus: genomeHead has ${snap.genomeHead.length} words, expected ${HEAD_CHANNELS * n}`);
  return n;
}

/** `share(x) >= 0.02` by exact integer arithmetic (`cells * 50 >= living`); false when nothing lives. */
export function rpsIsPresent(cellsOfLabel: number, living: number): boolean {
  return living > 0 && cellsOfLabel * PRESENT_DEN >= living;
}

/** `coexist`: every founding label `0 .. K0 - 1` is present. `present` is indexed by label. */
export function rpsCoexist(present: readonly boolean[], K0: number): boolean {
  for (let f = 0; f < K0; f++) if (!present[f]) return false;
  return true;
}

/** Per-cell labels of a snapshot (`RPS_NO_LABEL` for a cell that is not living). Throws on a living cell whose type byte is 8 or more. */
export function rpsLabels(snap: RpsSnapshot, dims: RpsDims): Uint8Array {
  const n = checkShape(snap, dims);
  const { genomeHead } = snap;
  const labels = new Uint8Array(n).fill(RPS_NO_LABEL);
  for (let i = 0; i < n; i++) {
    if ((genomeHead[G.LIN_HI * n + i] | genomeHead[G.LIN_LO * n + i]) === 0) continue;
    const t = rpsTypeOf(genomeHead[G.PARAM1 * n + i]);
    if (t >= RPS_MAX_LABELS) throw new RangeError(`rpsCensus: cell ${i} is living with type ${t} (at most ${RPS_MAX_LABELS - 1} is allowed)`);
    labels[i] = t;
  }
  return labels;
}

/** The directed dominance graph on the present labels: `adj[x][y]` iff `x != y`, both present, and bit `y` of `x`'s modal mask is set. */
export function dominanceEdges(S: readonly number[], modal: readonly (number | null)[]): boolean[][] {
  const adj: boolean[][] = Array.from({ length: RPS_MAX_LABELS }, () => new Array<boolean>(RPS_MAX_LABELS).fill(false));
  for (const x of S) {
    const m = modal[x];
    if (m === null || m === undefined) continue;
    for (const y of S) if (x !== y && ((m >>> y) & 1) === 1) adj[x][y] = true;
  }
  return adj;
}

/**
 * `Y_c` of rule draft 0: `|S|` if the dominance graph on `S` has `|S| >= 3`, a directed cycle through every label of `S` (a
 * Hamiltonian cycle, chords allowed) and no pair with both `x -> y` and `y -> x`; else 0.
 */
export function cleanCycleLength(S: readonly number[], modal: readonly (number | null)[]): number {
  const k = S.length;
  if (k < 3) return 0;
  const adj = dominanceEdges(S, modal);
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) if (adj[S[a]][S[b]] && adj[S[b]][S[a]]) return 0;
  const full = (1 << k) - 1;
  const dfs = (cur: number, seen: number): boolean => {
    if (seen === full) return adj[S[cur]][S[0]];
    for (let nxt = 1; nxt < k; nxt++) {
      if ((seen >>> nxt) & 1) continue;
      if (adj[S[cur]][S[nxt]] && dfs(nxt, seen | (1 << nxt))) return true;
    }
    return false;
  };
  return dfs(0, 1) ? k : 0;
}

/** Fraction of columns with at least one living cell whose living cells all carry one label; null if no column has a living cell. */
export function zCoherence(labels: Uint8Array, dims: RpsDims): number | null {
  const { W, H, D } = dims;
  const WH = W * H;
  let columns = 0;
  let coherent = 0;
  for (let c = 0; c < WH; c++) {
    let label = RPS_NO_LABEL;
    let any = false;
    let mixed = false;
    for (let z = 0; z < D; z++) {
      const l = labels[z * WH + c];
      if (l === RPS_NO_LABEL) continue;
      if (!any) {
        any = true;
        label = l;
      } else if (l !== label) {
        mixed = true;
        break;
      }
    }
    if (any) {
      columns++;
      if (!mixed) coherent++;
    }
  }
  return columns === 0 ? null : coherent / columns;
}

export interface RpsCorrelation {
  /** Mean over the (layer, axis) pairs that have a living cell of the smallest lag with `g < 1/e` (33 if none); null if no layer has a living cell. */
  xi: number | null;
  /** How many (layer, axis) pairs went into the mean (2 per layer with a living cell). */
  used: number;
  /** Per layer: `[x-axis xi, y-axis xi]`, null for a layer without living cells. */
  perLayer: ([number, number] | null)[];
}

/**
 * Correlation length of a label field (rule draft 0, B.1). For each layer and each axis (x, then y; periodic like the dynamics),
 * `P(r)` is the fraction of pairs of living cells `r` apart that carry the same label, `P0` the sum of the squared label shares of
 * the layer's living cells, `g(r) = (P(r) - P0) / (1 - P0)` (0 when `P0` is 1, and 0 at a lag with no pair of living cells);
 * `xi` is the smallest `r` in 1..32 with `g(r) < 1/e`, 33 if there is none. The result is the mean over the layers and axes; a
 * layer without any living cell has no value and is left out.
 */
export function correlationLength(labels: Uint8Array, dims: RpsDims): RpsCorrelation {
  const { W, H, D } = dims;
  const WH = W * H;
  const inverseE = 1 / Math.E;
  const perLayer: ([number, number] | null)[] = [];
  let sum = 0;
  let used = 0;
  for (let z = 0; z < D; z++) {
    const base = z * WH;
    const counts = new Array<number>(RPS_MAX_LABELS).fill(0);
    let living = 0;
    for (let i = 0; i < WH; i++) {
      const l = labels[base + i];
      if (l === RPS_NO_LABEL) continue;
      counts[l]++;
      living++;
    }
    if (living === 0) {
      perLayer.push(null);
      continue;
    }
    let p0 = 0;
    for (const c of counts) p0 += (c / living) * (c / living);
    const xis: [number, number] = [RPS_XI_MAX_LAG + 1, RPS_XI_MAX_LAG + 1];
    for (let axis = 0; axis < 2; axis++) {
      for (let r = 1; r <= RPS_XI_MAX_LAG; r++) {
        let same = 0;
        let pairs = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const a = labels[base + y * W + x];
            if (a === RPS_NO_LABEL) continue;
            const j = axis === 0 ? base + y * W + ((x + r) % W) : base + ((y + r) % H) * W + x;
            const b = labels[j];
            if (b === RPS_NO_LABEL) continue;
            pairs++;
            if (a === b) same++;
          }
        }
        const g = p0 >= 1 || pairs === 0 ? 0 : (same / pairs - p0) / (1 - p0);
        if (g < inverseE) {
          xis[axis] = r;
          break;
        }
      }
    }
    perLayer.push(xis);
    sum += xis[0] + xis[1];
    used += 2;
  }
  return { xi: used === 0 ? null : sum / used, used, perLayer };
}

/**
 * The interface width `W` of the mobility meter (rule draft 3.1): `m(u)` is the fraction of label 1 among the living cells of line `u`
 * (averaged over the other two coordinates; lines along x for the x-stripes, along y for the y-stripes), and `W = sum over u of m (1 - m)`.
 * A line with no living cell is left out. The meter turns it into `D = pi W^2 / (8 t)`. (An addition: the plan lists the label mixing
 * index among the census observables, and the Gate-0 driver and the meter driver should share one definition of `W`.)
 */
export function labelMixingW(labels: Uint8Array, dims: RpsDims, axis: "x" | "y"): number {
  const { W, H, D } = dims;
  const lines = axis === "x" ? W : H;
  const living = new Array<number>(lines).fill(0);
  const ones = new Array<number>(lines).fill(0);
  for (let z = 0; z < D; z++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const l = labels[(z * H + y) * W + x];
        if (l === RPS_NO_LABEL) continue;
        const u = axis === "x" ? x : y;
        living[u]++;
        if (l === 1) ones[u]++;
      }
    }
  }
  let sum = 0;
  for (let u = 0; u < lines; u++) {
    if (living[u] === 0) continue;
    const m = ones[u] / living[u];
    sum += m * (1 - m);
  }
  return sum;
}

/**
 * Mutant supply (rule draft 7.3, B.2): the number of distinct lineages born after the start (lineage hi word, `birth step + 1`,
 * nonzero) that hold at least `minCells` living cells.
 */
export function mutantSupply(snap: RpsSnapshot, dims: RpsDims, minCells: number = RPS_SUPPLY_MIN_CELLS): number {
  const n = checkShape(snap, dims);
  const { genomeHead } = snap;
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const hi = genomeHead[G.LIN_HI * n + i];
    const lo = genomeHead[G.LIN_LO * n + i];
    if (hi === 0) continue; // founders (hi 0) are not mutants; hi and lo both 0 is a cell that is not living
    const key = `${hi}:${lo}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let supply = 0;
  for (const c of counts.values()) if (c >= minCells) supply++;
  return supply;
}

/**
 * Cells whose MOT mirror disagrees with the genome: a living cell with `MOT >>> 24 != mask`, or a cell that is not living with a
 * nonzero mirror (plan 4.2). Zero for every valid state; the driver may use it as a bug check.
 */
export function rpsMirrorMismatches(snap: RpsSnapshot, dims: RpsDims): number {
  const n = checkShape(snap, dims);
  const { cells, genomeHead } = snap;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const mirror = rpsMirrorOf(cells[CH.MOT * n + i]);
    const living = (genomeHead[G.LIN_HI * n + i] | genomeHead[G.LIN_LO * n + i]) !== 0;
    const want = living ? rpsMaskOf(genomeHead[G.PARAM1 * n + i]) : 0;
    if (mirror !== want) bad++;
  }
  return bad;
}

/** The per-label census of one snapshot (rule draft 0). */
export function rpsCensus(snap: RpsSnapshot, dims: RpsDims, opts: RpsCensusOptions = {}): RpsCensus {
  const n = checkShape(snap, dims);
  const { cells, genomeHead } = snap;
  const WH = dims.W * dims.H;
  const labels = rpsLabels(snap, dims);
  const byLabel = new Array<number>(RPS_MAX_LABELS).fill(0);
  const massByLabel = new Array<number>(RPS_MAX_LABELS).fill(0);
  const layerLabelCells: number[][] = Array.from({ length: dims.D }, () => new Array<number>(RPS_MAX_LABELS).fill(0));
  const hist = new Uint32Array(RPS_MAX_LABELS * 256);
  let living = 0;
  for (let i = 0; i < n; i++) {
    const t = labels[i];
    if (t === RPS_NO_LABEL) continue;
    living++;
    byLabel[t]++;
    massByLabel[t] += cells[CH.B * n + i] + cells[CH.P * n + i];
    layerLabelCells[Math.floor(i / WH)][t]++;
    hist[t * 256 + rpsMaskOf(genomeHead[G.PARAM1 * n + i])]++;
  }
  const shares = byLabel.map((c) => (living === 0 ? 0 : c / living));
  const present = byLabel.map((c) => rpsIsPresent(c, living));
  const S: number[] = [];
  for (let x = 0; x < RPS_MAX_LABELS; x++) if (present[x]) S.push(x);
  const modal: (number | null)[] = byLabel.map((c, x) => {
    if (c === 0) return null;
    let best = 0;
    let bestCount = -1;
    for (let m = 0; m < 256; m++) {
      const h = hist[x * 256 + m];
      if (h > bestCount) {
        bestCount = h;
        best = m; // strict > keeps the smaller mask on a tie
      }
    }
    return best;
  });
  return {
    total: n,
    living,
    liv: living / n,
    byLabel,
    massByLabel,
    shares,
    present,
    S,
    n: S.length,
    modal,
    Y: cleanCycleLength(S, modal),
    zcoh: zCoherence(labels, dims),
    layerLabelCells,
    supply: opts.supply ? mutantSupply(snap, dims, opts.supplyMinCells ?? RPS_SUPPLY_MIN_CELLS) : 0,
    labels,
  };
}

export interface RpsChange {
  /** Cells living at both censuses. */
  both: number;
  /** Of those, cells whose label changed. */
  changed: number;
  /** `changed / both`; null if no cell lives at both. */
  turnover: number | null;
  /** Changes from `x` to `y` with `y` killing `x` (the cyclic rule of `K0`); null in jobs with mutation. */
  ndom: number | null;
  /** Changes from `x` to `y` with `x` killing `y`; null in jobs with mutation. */
  nanti: number | null;
}

/**
 * Turnover and the two chirality counts between two censuses' per-cell label arrays (`RpsCensus.labels`). Among the cells living at
 * both, a changed cell counts in `ndom` when `x = (y + 1) mod K0` (its new label's lineage kills its old label) and in `nanti`
 * when `y = (x + 1) mod K0` (the old label kills the new); a change between labels with no kill relation (possible for `K0` of 4
 * or more, or a label of `K0` or more) counts in neither. Pass `K0` null for a job with mutation: the counts are then null.
 */
export function rpsChanges(prev: Uint8Array, cur: Uint8Array, K0: number | null): RpsChange {
  if (prev.length !== cur.length) throw new RangeError(`rpsChanges: ${prev.length} cells before, ${cur.length} after`);
  if (K0 !== null && (!Number.isInteger(K0) || K0 < 3 || K0 > RPS_MAX_LABELS)) throw new RangeError(`rpsChanges: K0 ${K0} must be 3..${RPS_MAX_LABELS} or null`);
  let both = 0;
  let changed = 0;
  let ndom = 0;
  let nanti = 0;
  for (let i = 0; i < prev.length; i++) {
    const x = prev[i];
    const y = cur[i];
    if (x === RPS_NO_LABEL || y === RPS_NO_LABEL) continue;
    both++;
    if (x === y) continue;
    changed++;
    if (K0 !== null && x < K0 && y < K0) {
      if (x === (y + 1) % K0) ndom++;
      else if (y === (x + 1) % K0) nanti++;
    }
  }
  return { both, changed, turnover: both === 0 ? null : changed / both, ndom: K0 === null ? null : ndom, nanti: K0 === null ? null : nanti };
}

/**
 * Chirality over a set of censuses from the sums of their counts: `(ndom - nanti) / (ndom + nanti)`, and 0 when fewer than 200
 * changes (`ndom + nanti`) fall in the set. The one definition the driver's census and the readout both use.
 */
export function chirality(ndom: number, nanti: number): number {
  const total = ndom + nanti;
  if (total < RPS_CHI_MIN_CHANGES) return 0;
  return (ndom - nanti) / total;
}

// ---- census.tsv (rule draft B.2) ----

const labelColumns = (prefix: string) => Array.from({ length: RPS_MAX_LABELS }, (_, x) => `${prefix}${x}`);

/** The columns of `census.tsv`, in order. */
export const RPS_CENSUS_COLUMNS: readonly string[] = [
  "phase",
  "step",
  "rstep",
  "living",
  "turnover",
  "ndom",
  "nanti",
  "zcoh",
  "n",
  "Y",
  ...labelColumns("cells"),
  ...labelColumns("mass"),
  ...labelColumns("modal"),
  "supply",
];

/** The header line of `census.tsv`, newline included. */
export const RPS_CENSUS_HEADER = `${RPS_CENSUS_COLUMNS.join("\t")}\n`;

/** One row of `census.tsv`. Nullable fields are empty in the file. */
export interface RpsCensusRecord {
  /** `burn` for the burn-in's censuses (job steps 1,000 .. B_in), `run` after. */
  phase: "burn" | "run";
  /** Job step. */
  step: number;
  /** Run step: the job step minus the burn-in; 0 or negative in the burn-in. */
  rstep: number;
  /** Living cells. */
  living: number;
  /** Empty on the first row. */
  turnover: number | null;
  /** Empty on the first row and in jobs with mutation (`mutRate` above 0). */
  ndom: number | null;
  nanti: number | null;
  zcoh: number | null;
  /** `n_c`, the number of present labels. */
  n: number;
  /** `Y_c`. */
  Y: number;
  /** Living cells per label. */
  cells: number[];
  /** `B + P` per label. */
  mass: number[];
  /** Modal beats-mask per label; null (`--`) for a label with no living cells. */
  modal: (number | null)[];
  /** Empty outside section 7. */
  supply: number | null;
}

/** Builds the row for a census, the change counts against the previous census (null on the first row) and the step bookkeeping. */
export function rpsCensusRecord(
  c: RpsCensus,
  change: RpsChange | null,
  meta: { phase: "burn" | "run"; step: number; rstep: number; supply: boolean },
): RpsCensusRecord {
  return {
    phase: meta.phase,
    step: meta.step,
    rstep: meta.rstep,
    living: c.living,
    turnover: change?.turnover ?? null,
    ndom: change?.ndom ?? null,
    nanti: change?.nanti ?? null,
    zcoh: c.zcoh,
    n: c.n,
    Y: c.Y,
    cells: [...c.byLabel],
    mass: [...c.massByLabel],
    modal: [...c.modal],
    supply: meta.supply ? c.supply : null,
  };
}

const cell = (v: number | null): string => (v === null ? "" : String(v));

/** One `census.tsv` line, newline included. */
export function formatRpsCensusRow(r: RpsCensusRecord): string {
  const modal = r.modal.map((m) => (m === null ? "--" : m.toString(16).padStart(2, "0")));
  return `${[r.phase, r.step, r.rstep, r.living, cell(r.turnover), cell(r.ndom), cell(r.nanti), cell(r.zcoh), r.n, r.Y, ...r.cells, ...r.mass, ...modal, cell(r.supply)].join("\t")}\n`;
}

export class RpsCensusParseError extends Error {}

/** Parses a whole `census.tsv`. Columns are found by name, so extra columns are ignored; a missing one, a malformed field or a short row throws `RpsCensusParseError`. */
export function parseRpsCensusTsv(text: string): RpsCensusRecord[] {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) throw new RpsCensusParseError("census.tsv is empty");
  const header = lines[0].split("\t");
  const col = new Map<string, number>();
  header.forEach((h, k) => col.set(h, k));
  for (const name of RPS_CENSUS_COLUMNS) if (!col.has(name)) throw new RpsCensusParseError(`census.tsv has no ${name} column`);
  const at = (f: string[], name: string) => f[col.get(name)!];
  const out: RpsCensusRecord[] = [];
  for (let k = 1; k < lines.length; k++) {
    const f = lines[k].split("\t");
    const where = `census.tsv line ${k + 1}`;
    if (f.length !== header.length) throw new RpsCensusParseError(`${where}: ${f.length} fields, expected ${header.length}`);
    const int = (name: string): number => {
      const s = at(f, name);
      if (!/^-?\d+$/.test(s)) throw new RpsCensusParseError(`${where}: ${name} is ${JSON.stringify(s)}, not an integer`);
      return Number(s);
    };
    const optInt = (name: string): number | null => (at(f, name) === "" ? null : int(name));
    const optNum = (name: string): number | null => {
      const s = at(f, name);
      if (s === "") return null;
      const v = Number(s);
      if (!Number.isFinite(v)) throw new RpsCensusParseError(`${where}: ${name} is ${JSON.stringify(s)}, not a number`);
      return v;
    };
    const phase = at(f, "phase");
    if (phase !== "burn" && phase !== "run") throw new RpsCensusParseError(`${where}: phase is ${JSON.stringify(phase)}`);
    const modal = labelColumns("modal").map((name) => {
      const s = at(f, name);
      if (s === "--") return null;
      if (!/^[0-9a-f]{2}$/.test(s)) throw new RpsCensusParseError(`${where}: ${name} is ${JSON.stringify(s)}, not two hex digits or --`);
      return parseInt(s, 16);
    });
    out.push({
      phase,
      step: int("step"),
      rstep: int("rstep"),
      living: int("living"),
      turnover: optNum("turnover"),
      ndom: optInt("ndom"),
      nanti: optInt("nanti"),
      zcoh: optNum("zcoh"),
      n: int("n"),
      Y: int("Y"),
      cells: labelColumns("cells").map(int),
      mass: labelColumns("mass").map(int),
      modal,
      supply: optInt("supply"),
    });
  }
  return out;
}

// ---- final.bin (rule draft B.3) ----

export interface RpsFinal extends RpsDims {
  K0: number;
  cells: Uint32Array;
  genomeHead: Uint32Array;
}

/** Writes `final.bin`: little-endian u32 `W, H, D, K0`, then the 7 cell channels and the 4 genome-head channels, channel major. */
export function encodeRpsFinal(f: RpsFinal): Uint8Array {
  const n = checkShape(f, f);
  const words = 4 + (CELL_CHANNELS + HEAD_CHANNELS) * n;
  const out = new Uint8Array(words * 4);
  const view = new DataView(out.buffer);
  let w = 0;
  for (const v of [f.W, f.H, f.D, f.K0]) view.setUint32(4 * w++, v, true);
  for (let i = 0; i < f.cells.length; i++) view.setUint32(4 * w++, f.cells[i], true);
  for (let i = 0; i < f.genomeHead.length; i++) view.setUint32(4 * w++, f.genomeHead[i], true);
  return out;
}

/** Reads `final.bin`; throws if the length does not match its own header. */
export function parseRpsFinal(bytes: Uint8Array): RpsFinal {
  if (bytes.byteLength < 16) throw new RangeError("final.bin is shorter than its header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const [W, H, D, K0] = [0, 1, 2, 3].map((k) => view.getUint32(4 * k, true));
  const n = W * H * D;
  const want = 4 * (4 + (CELL_CHANNELS + HEAD_CHANNELS) * n);
  if (!(W > 0 && H > 0 && D > 0) || bytes.byteLength !== want) {
    throw new RangeError(`final.bin: header ${W} x ${H} x ${D} wants ${want} bytes, the file has ${bytes.byteLength}`);
  }
  const read = (word0: number, count: number) => {
    const a = new Uint32Array(count);
    for (let i = 0; i < count; i++) a[i] = view.getUint32(4 * (word0 + i), true);
    return a;
  };
  return { W, H, D, K0, cells: read(4, CELL_CHANNELS * n), genomeHead: read(4 + CELL_CHANNELS * n, HEAD_CHANNELS * n) };
}

/** Correlation length and z-coherence of a final snapshot (rule draft 6.1, B.1). */
export function rpsFinalMeasures(f: RpsFinal): { xi: number | null; zcoh: number | null } {
  const labels = rpsLabels(f, f);
  return { xi: correlationLength(labels, f).xi, zcoh: zCoherence(labels, f) };
}
