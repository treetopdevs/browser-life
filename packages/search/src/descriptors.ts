// Behaviour-atlas descriptors (I01): two physical descriptors that stay valid when component identity is ambiguous.
// They read raw per-cell bound mass (B + P), never tracker output or labels, and are an observer: nothing here is
// scored, gated or fed back into the simulation. Definitions are fixed in docs/behaviour-atlas-2026-11-01/PLAN.md.
//
//   D1  centre-of-mass displacement: NET transport of the tile's occupied mass over the window, cells per 100 steps
//       (mass-weighted circular mean on the tile torus; undefined when mass is spread evenly round the torus).
//   D2  temporal occupancy persistence: mean Jaccard index of consecutive occupancy masks, 0..1.

import { CH, cellCount, worldW, type WorldConfig } from "@bl/schema";

/** A cell is occupied at bound mass B + P >= this (the tracker's per-cell threshold). */
export const ATLAS_OCC_MIN = 48;
/** The window is the last this-many growth steps. */
export const ATLAS_WINDOW = 1000;
/** A frame has a centre of mass only when both axes' mean resultant length is at least this. */
export const ATLAS_R_MIN = 0.25;

export interface TileAtlas {
  /** Net centre-of-mass displacement, cells per 100 steps; null when any frame in the window has no defined centre. */
  d1: number | null;
  /** Path length of the centre of mass over the same intervals (the naive comparator, audit only); null as d1. */
  comPath: number | null;
  /** Mean Jaccard persistence of occupancy; null when no interval had any occupied cell. */
  d2: number | null;
  frames: number;
}

/** One replicate tile's online accumulator. Feed it the tile's per-cell bound mass at each census in the window. */
export class TileDescriptor {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private prevOcc?: Uint8Array;
  private prevPos?: [number, number];
  private first = -1;
  private last = -1;
  private vx = 0;
  private vy = 0;
  private path = 0;
  private undefinedCom = false;
  private jSum = 0;
  private jN = 0;
  frames = 0;

  constructor(readonly side: number) {
    this.cos = new Float64Array(side);
    this.sin = new Float64Array(side);
    for (let i = 0; i < side; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / side);
      this.sin[i] = Math.sin((2 * Math.PI * i) / side);
    }
  }

  /** `mass` is side*side per-cell bound mass, row-major; `step` the census step. */
  push(mass: ArrayLike<number>, step: number): void {
    const T = this.side;
    const occ = new Uint8Array(T * T);
    let m = 0, cx = 0, sx = 0, cy = 0, sy = 0;
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const v = mass[y * T + x];
        if (v < ATLAS_OCC_MIN) continue;
        occ[y * T + x] = 1;
        m += v;
        cx += v * this.cos[x];
        sx += v * this.sin[x];
        cy += v * this.cos[y];
        sy += v * this.sin[y];
      }
    let pos: [number, number] | undefined;
    if (m > 0 && Math.hypot(cx, sx) / m >= ATLAS_R_MIN && Math.hypot(cy, sy) / m >= ATLAS_R_MIN) {
      const wrap = (a: number) => ((a * T) / (2 * Math.PI) + T) % T;
      pos = [wrap(Math.atan2(sx, cx)), wrap(Math.atan2(sy, cy))];
    }
    if (this.frames === 0) this.first = step;
    else {
      if (pos && this.prevPos) {
        const dx = pos[0] - this.prevPos[0], dy = pos[1] - this.prevPos[1];
        const wx = dx - T * Math.round(dx / T), wy = dy - T * Math.round(dy / T);
        this.vx += wx;
        this.vy += wy;
        this.path += Math.hypot(wx, wy);
      } else this.undefinedCom = true;
      let inter = 0, union = 0;
      const p = this.prevOcc!;
      for (let i = 0; i < occ.length; i++) {
        if (occ[i] & p[i]) inter++;
        if (occ[i] | p[i]) union++;
      }
      if (union > 0) {
        this.jSum += inter / union;
        this.jN++;
      }
    }
    if (this.frames === 0 && !pos) this.undefinedCom = true;
    this.last = step;
    this.prevOcc = occ;
    this.prevPos = pos;
    this.frames++;
  }

  result(): TileAtlas {
    const steps = this.last - this.first;
    const ok = this.frames >= 2 && steps > 0 && !this.undefinedCom;
    return {
      d1: ok ? (Math.hypot(this.vx, this.vy) / steps) * 100 : null,
      comPath: ok ? (this.path / steps) * 100 : null,
      d2: this.jN > 0 ? this.jSum / this.jN : null,
      frames: this.frames,
    };
  }
}

/** A candidate's descriptors, from its replicate tiles. Stored on `Evaluation.atlas` and in viable.jsonl. */
export interface AtlasEval {
  /** Replicate tiles. */
  reps: number;
  /** Lower median of the defined replicates; null when fewer than half the replicates are defined. */
  d1: number | null;
  d2: number | null;
  comPath: number | null;
  d1Defined: number;
  d2Defined: number;
}

const lowerMedian = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];

/** Candidate value = lower median over defined replicates, defined when at least half of `tiles` are. */
export function summarizeAtlas(tiles: TileAtlas[]): AtlasEval {
  const reps = tiles.length;
  const med = (pick: (t: TileAtlas) => number | null) => {
    const xs = tiles.map(pick).filter((v): v is number => v !== null);
    return { n: xs.length, v: xs.length > 0 && xs.length >= Math.ceil(reps / 2) ? lowerMedian(xs) : null };
  };
  const d1 = med((t) => t.d1), d2 = med((t) => t.d2), path = med((t) => t.comPath);
  return { reps, d1: d1.v, d2: d2.v, comPath: path.v, d1Defined: d1.n, d2Defined: d2.n };
}

/** Batch-world recorder used by evaluateBatch: one TileDescriptor per tile, fed from the census readbacks it already makes. */
export class AtlasRecorder {
  private readonly tiles = new Map<number, TileDescriptor>();
  private readonly buf: Float64Array;
  constructor(
    private readonly cfg: WorldConfig,
    tileIndexes: number[],
    private readonly windowStart: number,
  ) {
    if (cfg.tileW !== cfg.tileH) throw new Error("AtlasRecorder needs square tiles");
    this.buf = new Float64Array(cfg.tileW * cfg.tileH);
    for (const t of tileIndexes) this.tiles.set(t, new TileDescriptor(cfg.tileW));
  }

  observe(input: { step: number; cells: Uint32Array }): void {
    if (input.step < this.windowStart) return;
    const { cfg } = this;
    const n = cellCount(cfg), W = worldW(cfg), T = cfg.tileW;
    for (const [t, d] of this.tiles) {
      const x0 = (t % cfg.tilesX) * T, y0 = Math.floor(t / cfg.tilesX) * T;
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) {
          const i = (y0 + y) * W + x0 + x;
          this.buf[y * T + x] = input.cells[CH.B * n + i] + input.cells[CH.P * n + i];
        }
      d.push(this.buf, input.step);
    }
  }

  tile(t: number): TileAtlas {
    return this.tiles.get(t)!.result();
  }
}

/** Atlas archive axes. Ranges are fixed by the calibration rule in PLAN.md and then frozen here. */
export interface AtlasSpec {
  id: "atlas-v1";
  bins: number;
  /** D1 range, cells per 100 steps. */
  displacementRange: [number, number];
  /** D2 range. */
  persistenceRange: [number, number];
  /** "passed" once the plan's calibration verdicts were usable for both descriptors; anything else blocks a real search. */
  calibration: string;
}

/**
 * Ranges from the calibration rule of docs/behaviour-atlas-2026-11-01/PLAN.md applied to set A (runs of 2026-11-01,
 * calibration.json). The calibration did NOT pass: D1 was defined for 34% of candidates (< 80%), so `calibration`
 * says so and tools/bootstrap.ts refuses `--archive atlas-v1` except as a labelled tool smoke test. These ranges are
 * recorded for the audit trail; they are not a frozen archive definition.
 */
export const ATLAS_V1: AtlasSpec = { id: "atlas-v1", bins: 8, displacementRange: [0, 1.75], persistenceRange: [0, 1], calibration: "failed: D1 defined for 55 of 160 (34%)" };

/**
 * Cell of an evaluation under an atlas spec: null when a descriptor is undefined (the candidate stays a viable
 * offer, it just has no atlas cell). Throws when the evaluation was made without `EvalConfig.atlas`: a missing
 * descriptor must never be binned as 0.
 */
export function atlasCell(spec: AtlasSpec, e: { atlas?: AtlasEval }): [number, number] | null {
  const a = e.atlas;
  if (!a || a.d1 === undefined || a.d2 === undefined) throw new Error("atlas archive: evaluation has no atlas descriptors (EvalConfig.atlas was off)");
  if (a.d1 === null || a.d2 === null) return null;
  if (!Number.isFinite(a.d1) || !Number.isFinite(a.d2)) throw new Error("atlas archive: non-finite descriptor (JSON would turn it into null and change the replayed cell)");
  if (!(spec.displacementRange[1] > spec.displacementRange[0] && spec.persistenceRange[1] > spec.persistenceRange[0])) throw new Error("atlas archive: empty descriptor range");
  const bin = (v: number, [lo, hi]: [number, number]) => Math.max(0, Math.min(spec.bins - 1, Math.floor(((v - lo) / (hi - lo)) * spec.bins)));
  return [bin(a.d1, spec.displacementRange), bin(a.d2, spec.persistenceRange)];
}

/** Same archive definition: id, bins and ranges (the `calibration` note may change without changing any cell). */
export function sameAtlasSpec(a: AtlasSpec, b: AtlasSpec): boolean {
  return a.id === b.id && a.bins === b.bins && a.displacementRange.join() === b.displacementRange.join() && a.persistenceRange.join() === b.persistenceRange.join();
}

/** Spearman rank correlation (average ranks for ties); NaN for fewer than two points or a constant variable. */
export function spearman(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return NaN;
  const rank = (v: number[]) => {
    const idx = v.map((_, i) => i).sort((a, b) => v[a] - v[b]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++;
      for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const a = rank(xs), b = rank(ys), n = xs.length;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa === 0 || sbb === 0 ? NaN : sab / Math.sqrt(saa * sbb);
}
