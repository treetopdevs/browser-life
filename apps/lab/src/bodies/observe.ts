// Observer-only readouts for rules v3 (recognition marks and boundaries). Nothing in model.ts imports this file and nothing
// here feeds back into a world: patches, basins and labels exist only to be looked at. All arithmetic is integer.
//
// Matching in these readouts always uses the real marks (it ignores `tagBlind`), so a tagBlind control can be read with the
// same eyes as a gated world: "would these two neighbours have matched?".
import { RULES, basinLabels, census } from './model.ts';
import type { BodiesWorld } from './model.ts';

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

/** Real-mark match of two live cells (ignores tagBlind; same tolerance rule as the dynamics). */
export function realMatch(w: BodiesWorld, i: number, p: number): boolean { return realMarksMatch(w, w.kin[i], w.kinTol[i], w.kin[p], w.kinTol[p]); }
/** Same rule on bare marks and tolerances (used to compare a tile with its own mark at an earlier sample). */
export function realMarksMatch(w: BodiesWorld, ka: number, ta: number, kb: number, tb: number): boolean {
  let x = ka - kb; if (x < 0) x = -x; if (x > 128) x = 256 - x;
  const tol = w.R.TAG_TOL_GENE > 0 && !w.blind ? Math.min(ta, tb) : w.R.TAG_TOL;
  return x <= tol;
}

export interface SeamStats {
  /** Live 4-neighbour pairs (each edge once), pairs whose marks do not match, and the permille of mismatched pairs. */
  pairs: number; seamPairs: number; seamPermille: number;
  /** Live cells with at least one non-matching live 4-neighbour. */
  seamCells: number; seamCellsPermille: number;
  /** Live 4-neighbour pairs that straddle two different root basins, and the permille of mark seams that sit on a basin border. */
  basinBorderPairs: number; seamOnBasinBorderPermille: number;
}
export function seamStats(w: BodiesWorld, label?: Int32Array): SeamStats {
  const { W, H, N } = RULES; const lab = label ?? basinLabels(w).label;
  let pairs = 0, seam = 0, border = 0, seamOnBorder = 0, cells = 0, seamCells = 0;
  const flagged = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!w.cell[i]) continue;
    cells++;
    const x = i % W, y = (i - x) / W;
    for (let q = 0; q < 2; q++) {
      const p = q === 0 ? y * W + ((x + 1) % W) : ((y + 1) % H) * W + x;
      if (!w.cell[p]) continue;
      pairs++;
      const bb = lab[i] !== lab[p]; if (bb) border++;
      if (!realMatch(w, i, p)) { seam++; flagged[i] = 1; flagged[p] = 1; if (bb) seamOnBorder++; }
    }
  }
  for (let i = 0; i < N; i++) if (flagged[i]) seamCells++;
  return {
    pairs, seamPairs: seam, seamPermille: pairs ? Math.floor(seam * 1000 / pairs) : 0, seamCells, seamCellsPermille: cells ? Math.floor(seamCells * 1000 / cells) : 0,
    basinBorderPairs: border, seamOnBasinBorderPermille: seam ? Math.floor(seamOnBorder * 1000 / seam) : 0,
  };
}

/**
 * Tag-connected patches: connected components (8-neighbourhood, like `census`) of live cells where two adjacent cells are joined only when
 * their marks match. Matching is not transitive when the tolerance is above 0, so a patch is a chain-linked set: its end cells may not match each other.
 * label[i] = patch number (0-based, largest first) or -1 for an empty tile.
 */
export function kinPatches(w: BodiesWorld): { label: Int32Array; sizes: number[] } {
  const { W, H, N } = RULES; const raw = new Int32Array(N).fill(-1); const sizes0: number[] = []; const work = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!w.cell[s] || raw[s] >= 0) continue;
    const id = sizes0.length; let sp = 0, size = 0; work[sp++] = s; raw[s] = id;
    while (sp) {
      const i = work[--sp]; size++;
      const x = i % W, y = (i - x) / W;
      for (let k = 0; k < 8; k++) {
        const p = ((y + DY[k] + H) % H) * W + ((x + DX[k] + W) % W);
        if (w.cell[p] && raw[p] < 0 && realMatch(w, i, p)) { raw[p] = id; work[sp++] = p; }
      }
    }
    sizes0.push(size);
  }
  const order = sizes0.map((z, id) => id).sort((a, b) => sizes0[b] - sizes0[a] || a - b);
  const rank = new Int32Array(sizes0.length); order.forEach((id, r) => { rank[id] = r; });
  for (let i = 0; i < N; i++) if (raw[i] >= 0) raw[i] = rank[raw[i]];
  return { label: raw, sizes: order.map((id) => sizes0[id]) };
}

export interface PatchReadout {
  /** All patches, patches of at least `minSize` cells, and the sizes of the (up to) 8 largest. */
  n: number; nBig: number; sizesTop8: number[]; largestSharePermille: number; medianBig: number;
  /** Turnover since the previous sample (null at the first sample), counted over patches of at least `minSize` cells. */
  births: number | null; deaths: number | null;
  /** Tiles live at both samples whose mark no longer matches the mark the same tile had at the previous sample (a clade replaced in place; null at the first sample). Not limited to big patches. */
  replacedTiles: number | null;
  /** Age in steps of the live big patches (median, max), and the cumulative completed lifetimes of patches that died. */
  ageMedian: number; ageMax: number; deadCount: number; deadLifeMean: number | null;
}

/**
 * Patch turnover by overlap. Between two samples an earlier big patch P and a later big patch Q are LINKED when they share at least half of the
 * smaller one's tiles; a tile counts as shared only if it is live at both samples AND its mark at the later sample still matches the mark it had
 * at the earlier one (a tile taken over by a foreign mark in between is not shared, so replacing a clade in place is a death plus a birth). A later big patch with no link is a BIRTH; an earlier big patch with no link DIES (a merge links both parents to the merged
 * patch, so neither dies; a split links the pieces that keep half of the smaller side). A linked later patch inherits the age of the linked earlier
 * patch with the largest overlap (+ the steps between samples). Overlap is counted by tile, so the tracker is only as fine as
 * the sampling interval. Ages and `deadLifeMean` are measured at samples: a patch born between samples starts at age 0 at the first sample that sees
 * it, and one that dies between samples loses its last interval, so true lifetimes are longer by up to about one interval at each end. Patches below `minSize` cells are dust and are ignored here.
 */
export class PatchTracker {
  private prevLabel: Int32Array | null = null; private prevKin = new Uint8Array(RULES.N); private prevTol = new Uint8Array(RULES.N); private prevSizes: number[] = []; private prevAge: number[] = []; private prevT = 0;
  deadCount = 0; deadLifeSum = 0;
  readonly minSize: number;
  constructor(minSize = 10) { this.minSize = minSize; }
  sample(w: BodiesWorld): PatchReadout {
    const { N } = RULES; const { label, sizes } = kinPatches(w); const min = this.minSize;
    const age: number[] = sizes.map(() => 0); let births: number | null = null, deaths: number | null = null, replaced: number | null = null;
    if (this.prevLabel) {
      const dt = w.t - this.prevT; const ov = new Map<number, number>();
      replaced = 0;
      for (let i = 0; i < N; i++) {
        const a = this.prevLabel[i], b = label[i];
        if (a >= 0 && b >= 0) {
          if (realMarksMatch(w, this.prevKin[i], this.prevTol[i], w.kin[i], w.kinTol[i])) ov.set(a * N + b, (ov.get(a * N + b) ?? 0) + 1); else replaced++;
        }
      }
      const bestForNew = new Map<number, [number, number]>(); const linkedOld = new Set<number>();
      for (const [key, c] of ov) {
        const a = Math.floor(key / N), b = key % N;
        if (this.prevSizes[a] >= min && sizes[b] >= min && c * 2 >= Math.min(this.prevSizes[a], sizes[b])) {
          const cur = bestForNew.get(b); if (!cur || c > cur[1] || (c === cur[1] && a < cur[0])) bestForNew.set(b, [a, c]);
          linkedOld.add(a);
        }
      }
      let nb = 0, nd = 0;
      sizes.forEach((z, b) => {
        if (z < min) return;
        const best = bestForNew.get(b);
        if (best) age[b] = this.prevAge[best[0]] + dt; else nb++;
      });
      this.prevSizes.forEach((z, a) => {
        if (z < min) return;
        if (!linkedOld.has(a)) { nd++; this.deadCount++; this.deadLifeSum += this.prevAge[a]; }
      });
      births = nb; deaths = nd;
    }
    this.prevKin.set(w.kin); this.prevTol.set(w.kinTol); this.prevLabel = label; this.prevSizes = sizes; this.prevAge = age; this.prevT = w.t;
    const big = sizes.filter((z) => z >= min); const ages = age.filter((_, b) => sizes[b] >= min).sort((a, b) => a - b);
    const cells = sizes.reduce((a, b) => a + b, 0);
    return {
      n: sizes.length, nBig: big.length, sizesTop8: sizes.slice(0, 8), largestSharePermille: cells ? Math.floor((sizes[0] ?? 0) * 1000 / cells) : 0,
      medianBig: big.length ? big[Math.floor((big.length - 1) / 2)] : 0, births, deaths, replacedTiles: replaced,
      ageMedian: ages.length ? ages[Math.floor((ages.length - 1) / 2)] : 0, ageMax: ages.length ? ages[ages.length - 1] : 0,
      deadCount: this.deadCount, deadLifeMean: this.deadCount ? Math.floor(this.deadLifeSum / this.deadCount) : null,
    };
  }
}

export interface KinReadout {
  distinct: number; /** live cells per 16-wide bucket of the mark (0..15). */ hist16: number[]; dominantSharePermille: number;
  /** Mean tolerance x10 over live cells (the constant when the tolerance is not a gene). */ tolMeanX10: number;
  /** Generation (births along the parent chain): median, mean x10, max over live cells. */ genMedian: number; genMeanX10: number; genMax: number;
}
export function kinStats(w: BodiesWorld): KinReadout {
  const { N } = RULES; const hist = new Array(16).fill(0); const per = new Map<number, number>(); let tol = 0, cells = 0, gsum = 0, gmax = 0; const gens: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!w.cell[i]) continue;
    cells++; per.set(w.kin[i], (per.get(w.kin[i]) ?? 0) + 1); hist[w.kin[i] >> 4]++; tol += w.R.TAG_TOL_GENE > 0 ? w.kinTol[i] : w.R.TAG_TOL;
    gens.push(w.gen[i]); gsum += w.gen[i]; if (w.gen[i] > gmax) gmax = w.gen[i];
  }
  gens.sort((a, b) => a - b); let top = 0; for (const c of per.values()) if (c > top) top = c;
  return {
    distinct: per.size, hist16: hist, dominantSharePermille: cells ? Math.floor(top * 1000 / cells) : 0, tolMeanX10: cells ? Math.floor(tol * 10 / cells) : 0,
    genMedian: gens.length ? gens[Math.floor((gens.length - 1) / 2)] : 0, genMeanX10: cells ? Math.floor(gsum * 10 / cells) : 0, genMax: gmax,
  };
}

/** One row of every v3 readout: world census, root basins, mark patches and turnover, seam statistics, mark and depth statistics, v3 counters. */
export function observe(w: BodiesWorld, tracker: PatchTracker, ref = 0) {
  const c = census(w); const bl = basinLabels(w); const seams = seamStats(w, bl.label); const patches = tracker.sample(w); const kin = kinStats(w);
  let orphan255 = 0; for (let i = 0; i < RULES.N; i++) if (w.cell[i] && w.d[i] === 255) orphan255++;
  const bs = c.domains.sizes; let within2 = 0; if (ref) for (const z of bs) if (z * 2 >= ref && z <= ref * 2) within2 += z;
  return {
    t: w.t, cells: c.cells, comps: c.comps, largestSharePermille: c.largestSharePermille, interiorPermille: c.interiorPermille, roots: c.roots,
    basins: { n: c.domains.n, q: c.domains.q, unrooted: c.domains.unrooted, sizesTop8: bs.slice(0, 8), within2Permille: ref && c.cells ? Math.floor(within2 * 1000 / c.cells) : null },
    patches, seams, kin, dEq255Cells: orphan255,
    genes: { variants: c.genomeVariants, meansX10: c.geneMeansX10 },
    counters: {
      births: w.births, mutations: w.mutations, rootings: w.rootings, rootsCreated: w.rootsCreated, rootsEnded: w.rootsEnded, foraged: w.foraged, moved: w.moved,
      tagMutations: w.tagMutations, blockedGrow: w.blockedGrow, blockedBud: w.blockedBud, raided: w.raided, seamBurned: w.seamBurned,
    },
  };
}
