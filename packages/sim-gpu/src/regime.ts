// The GPU instrument of the regime meters (docs/3d-regime-meters-plan-2026-10-23.md sections 8.1 and 8.2; the rule is
// runs/regime/rule-draft.md, R4.6 to R4.10 and R6). Observer-only: it reads and copies the public fields of GpuSim and GpuSim3
// (device, cfg, n, cells, genome, currentGenome, ledger, step, encodeStep) and changes nothing they compute. It is generic
// over the slab and the 2D kernel through the structural type SimLike (the 2D gate worlds use the same code), and it has no
// top-level work: no WebGPU global is touched when the file is imported (the package index re-exports it into code that also
// runs in Node).
//
//  - forkSim, createTwin, createControlSim: a twin is a device-side copy of R at step T (R4.7). The N twin and the F pair are
//    created under R's configuration with one stated key changed (R4.10) and then filled by the same copies, so `upload`'s
//    configDiff never sees them.
//  - kickSites, kickBalls, unitKick, applyKick: the perturbation (R4.6, R4.8, R4.9). A kick set is a pure value; applyKick
//    writes it into a twin with the heat entry the energy ledger needs.
//  - createDiff: one compute pass per twin per step, one workgroup per 8 x 8 x D block (R6), counters in a device log.
//  - runLockstep: the lockstep driver (R2.6) shared by the tests, the M1 measurements and the runner.
//
// Conventions fixed here (they are the rule's words made exact; the Deno tests pin them):
//  - A block is 8 x 8 columns by all layers, aligned to the grid; block id = (y >> 3) * (W / 8) + (x >> 3).
//  - The log has one row per step of the twin phase: row t holds the counters after t steps (row 0 is the pass encoded before
//    step 1). The row index is the reference ledger's step word minus `startStep`, so there is no ring wrap.
//  - A damaged block is attributed to the S site nearest to the block's centre, taken as the voxel (8 bx + 4, 8 by + 4), by
//    horizontal Chebyshev torus distance in voxels; ties go to the lower site index; no cutoff. The reach of a site is the
//    largest such distance over its damaged blocks. A kicked block's reach at t = 0 is therefore 0 to 4, not 0.
//  - dB is B of the twin minus B of the reference, as a signed 32-bit value (B is below 2^26 by MATTER_MAX). Living is B + P > 0.
import { CELL_CHANNELS, CH, LEDGER, LEDGER_WORDS, genomeChannels, lowbias32, worldH, worldW, type WorldConfig, type WorldState } from "@bl/schema";
import { createSim } from "./create.ts";
import type { GpuSim } from "./gpu-sim.ts";
import type { GpuSim3 } from "./gpu-sim3.ts";

// Numeric usage flags, as gpu-sim3.ts has them: GPUBufferUsage and GPUMapMode are not read at import time.
const STORAGE = 0x80;
const UNIFORM = 0x40;
const COPY_SRC = 0x04;
const COPY_DST = 0x08;
const MAP_READ = 0x01;

// ---------------------------------------------------------------------------------------------------------------------
// Structural types

/**
 * What the instrument needs of a simulator: the public fields GpuSim and GpuSim3 have in common. `cells[0]` always holds the
 * current state (channel-major, `CELL_CHANNELS` channels of `n` words); `currentGenome` is whichever genome buffer is current.
 */
export interface SimLike {
  readonly device: GPUDevice;
  readonly cfg: WorldConfig;
  readonly n: number;
  readonly cells: GPUBuffer[];
  readonly genome: GPUBuffer[];
  readonly currentGenome: GPUBuffer;
  readonly ledger: GPUBuffer;
  step: number;
}

/** A SimLike that can be stepped into a command encoder. */
export interface StepSim extends SimLike {
  encodeStep(enc: GPUCommandEncoder): void;
}

/** The reference sim of a job: a StepSim with the readbacks that freeze it at T. */
export interface RefSimLike extends StepSim {
  drainLedger(): Promise<unknown>;
  readCells(): Promise<Uint32Array>;
  readStats(): Promise<{ step: number; heatOut: bigint; living: number }>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Blocks

/** Block edge in columns (R6). */
export const BLOCK = 8;

export interface BlockGrid {
  W: number;
  H: number;
  /** Layers: `tileD` for a slab, 1 for a 2D world. */
  D: number;
  n: number;
  /** Blocks along x and y. */
  bx: number;
  by: number;
  nBlocks: number;
}

/** Block geometry of a world. Throws unless the world is a whole number of blocks wide and high. */
export function blockGrid(cfg: WorldConfig): BlockGrid {
  const W = worldW(cfg);
  const H = worldH(cfg);
  const D = cfg.tileD ?? 1;
  if (W % BLOCK !== 0 || H % BLOCK !== 0) throw new Error(`regime: a ${W} x ${H} world is not a whole number of ${BLOCK} x ${BLOCK} blocks`);
  return { W, H, D, n: W * H * D, bx: W / BLOCK, by: H / BLOCK, nBlocks: (W / BLOCK) * (H / BLOCK) };
}

/** Column coordinates of a voxel index (the layer is `floor(v / (W * H))`). */
export function voxelXY(g: BlockGrid, v: number): [number, number] {
  return [v % g.W, Math.floor(v / g.W) % g.H];
}

/** Id of the block that holds voxel `v`. */
export function blockOf(g: BlockGrid, v: number): number {
  const [x, y] = voxelXY(g, v);
  return (y >> 3) * g.bx + (x >> 3);
}

// ---------------------------------------------------------------------------------------------------------------------
// Kick sets (R4.6, R4.8, R4.9): pure values

/**
 * A perturbation: voxels that lose `amounts` of B to C. A voxel appears once (the union rule), so no voxel is kicked twice
 * and the unsigned B channel cannot underflow.
 */
export interface KickSet {
  /** Kicked voxels, strictly ascending. */
  voxels: Uint32Array;
  /** B-to-C amount at each kicked voxel, at least 1. */
  amounts: Uint32Array;
  /** Sum of the amounts: the dose (R4.8). */
  total: number;
  /** Blocks that hold a kicked voxel, ascending (`n0` is their number)... */
  blocks: Uint32Array;
  /** ...and the sum of the amounts in each: the block's net difference at step 0 (C5). */
  blockSums: Uint32Array;
}

function buildKick(g: BlockGrid, pairs: Map<number, number>): KickSet {
  const vox = [...pairs.keys()].sort((a, b) => a - b);
  const voxels = Uint32Array.from(vox);
  const amounts = Uint32Array.from(vox, (v) => pairs.get(v)!);
  const perBlock = new Map<number, number>();
  let total = 0;
  for (let j = 0; j < voxels.length; j++) {
    total += amounts[j];
    const b = blockOf(g, voxels[j]);
    perBlock.set(b, (perBlock.get(b) ?? 0) + amounts[j]);
  }
  const ids = [...perBlock.keys()].sort((a, b) => a - b);
  return { voxels, amounts, total, blocks: Uint32Array.from(ids), blockSums: Uint32Array.from(ids, (b) => perBlock.get(b)!) };
}

/**
 * Rung P1 (R4.6): `k` units of B to C at each site. `B` is the reference's B channel at T. A site needs `B >= k + 1` so that the
 * voxel stays living; a site listed twice is an error (a voxel is kicked once).
 */
export function kickSites(g: BlockGrid, B: ArrayLike<number>, sites: ArrayLike<number>, k: number): KickSet {
  if (!Number.isInteger(k) || k < 1) throw new Error(`kickSites: k = ${k} is not a positive integer`);
  const pairs = new Map<number, number>();
  for (let j = 0; j < sites.length; j++) {
    const v = sites[j];
    if (!Number.isInteger(v) || v < 0 || v >= g.n) throw new Error(`kickSites: site ${v} is not a voxel`);
    if (pairs.has(v)) throw new Error(`kickSites: voxel ${v} is listed twice`);
    if (B[v] < k + 1) throw new Error(`kickSites: voxel ${v} holds B = ${B[v]}; a site needs B >= k + 1 = ${k + 1} to stay living`);
    pairs.set(v, k);
  }
  return buildKick(g, pairs);
}

/** A ball is the voxels within this Euclidean distance of its centre (R4.9): at most 123 in a slab, 29 in a 2D world. */
export const BALL_RADIUS = 3;
/** Rung P2 kicks a ball voxel only if it holds at least this much B (R4.9). */
export const BALL_MIN_B = 3;

/** Voxels of the ball of `radius` around `centre` (x and y wrap, z is clipped at the walls), in no particular order. */
export function ballVoxels(g: BlockGrid, centre: number, radius = BALL_RADIUS): number[] {
  const cx = centre % g.W;
  const cy = Math.floor(centre / g.W) % g.H;
  const cz = Math.floor(centre / (g.W * g.H));
  const out: number[] = [];
  for (let dz = -radius; dz <= radius; dz++) {
    const z = cz + dz;
    if (z < 0 || z >= g.D) continue;
    for (let dy = -radius; dy <= radius; dy++) {
      const y = (cy + dy + g.H) % g.H;
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
        out.push((z * g.H + y) * g.W + ((cx + dx + g.W) % g.W));
      }
    }
  }
  return out;
}

/**
 * Rung P2 (R4.9): the kicked set is the union of the balls around `centres`, restricted to voxels with `B >= BALL_MIN_B` in the
 * frozen reference; each such voxel is kicked once, by `floor(B / 2)` of its value in the reference at T (never recomputed from
 * a partly kicked state). `B` is the reference's B channel at T.
 */
export function kickBalls(g: BlockGrid, B: ArrayLike<number>, centres: ArrayLike<number>): KickSet {
  const pairs = new Map<number, number>();
  for (let j = 0; j < centres.length; j++) {
    const c = centres[j];
    if (!Number.isInteger(c) || c < 0 || c >= g.n) throw new Error(`kickBalls: centre ${c} is not a voxel`);
    for (const v of ballVoxels(g, c)) if (B[v] >= BALL_MIN_B && !pairs.has(v)) pairs.set(v, B[v] >>> 1);
  }
  return buildKick(g, pairs);
}

/**
 * The unit-kick control (R4.8): the same voxels at `max(1, floor(k_v / divisor))`, at every voxel the full kick touches, so the
 * control is never an empty perturbation (an amount of 1 is kept even where `k_v` is below the divisor).
 */
export function unitKick(g: BlockGrid, kick: KickSet, divisor = 8): KickSet {
  const pairs = new Map<number, number>();
  for (let j = 0; j < kick.voxels.length; j++) pairs.set(kick.voxels[j], Math.max(1, Math.floor(kick.amounts[j] / divisor)));
  return buildKick(g, pairs);
}

// ---------------------------------------------------------------------------------------------------------------------
// The frozen reference, and applying a kick

/** R at T, as the kicks are defined against it (R4.7): its step, all cells, and its heat counter. */
export interface FrozenRef {
  step: number;
  /** All channels, channel-major, as `readCells` returns them. */
  cells: Uint32Array;
  heatOut: bigint;
}

/** Drains R's ledger (so the copied event counter is 0, R4.7), then reads its cells and heat counter. R must be idle. */
export async function freezeRef(ref: RefSimLike): Promise<FrozenRef> {
  await ref.drainLedger();
  const cells = await ref.readCells();
  const st = await ref.readStats();
  if (st.step !== ref.step) throw new Error(`freezeRef: the ledger is at step ${st.step} but the sim says ${ref.step}`);
  return { step: st.step, cells, heatOut: st.heatOut };
}

/**
 * Writes the matter side of a kick into a twin: B and C of the whole channel, from the frozen reference, at byte offset
 * `ch * n * 4`. The twin must be a fork of the frozen reference that has not stepped (checked by its step). No ledger entry:
 * see `applyKick`, which adds the heat. Throws if a voxel would underflow.
 */
export function writeKick(sim: SimLike, frozen: FrozenRef, kick: KickSet): void {
  if (sim.step !== frozen.step) throw new Error(`writeKick: the twin is at step ${sim.step}, the frozen reference at ${frozen.step}; kick a fork before it steps`);
  const n = sim.n;
  if (frozen.cells.length !== n * CELL_CHANNELS) throw new Error("writeKick: the frozen cells do not belong to this world");
  if (kick.voxels.length === 0) return;
  const B = frozen.cells.slice(CH.B * n, (CH.B + 1) * n);
  const C = frozen.cells.slice(CH.C * n, (CH.C + 1) * n);
  for (let j = 0; j < kick.voxels.length; j++) {
    const v = kick.voxels[j];
    const a = kick.amounts[j];
    if (v >= n) throw new Error(`writeKick: voxel ${v} is outside the world`);
    if (j > 0 && v <= kick.voxels[j - 1]) throw new Error("writeKick: the kicked voxels are not strictly ascending");
    if (B[v] < a) throw new Error(`writeKick: voxel ${v} holds B = ${B[v]}, less than its kick ${a}`);
    B[v] -= a;
    C[v] += a;
  }
  sim.device.queue.writeBuffer(sim.cells[0], CH.B * n * 4, B as unknown as BufferSource);
  sim.device.queue.writeBuffer(sim.cells[0], CH.C * n * 4, C as unknown as BufferSource);
}

/** Rewrites the 64-bit `heatOut` counter of a sim's ledger (the two words at LEDGER.HEAT_LO). */
export function writeHeat(sim: SimLike, heatOut: bigint): void {
  sim.device.queue.writeBuffer(sim.ledger, LEDGER.HEAT_LO * 4, Uint32Array.of(Number(heatOut & 0xffffffffn), Number(heatOut >> 32n)) as unknown as BufferSource);
}

/**
 * Applies a kick to a twin (R4.6): B to C at the kicked voxels and `total * (eB - eC)` added to `heatOut`, the heat the decay
 * law B -> C exports per unit, so that matter and the energy ledger stay exact. Returns the twin's new `heatOut`. Both writes
 * are queued before the next submission, so they land between steps. An empty kick (the Z and N twins) writes nothing.
 */
export function applyKick(sim: SimLike, frozen: FrozenRef, kick: KickSet): bigint {
  writeKick(sim, frozen, kick);
  if (kick.voxels.length === 0) return frozen.heatOut;
  const heat = frozen.heatOut + BigInt(kick.total) * BigInt(sim.cfg.eB - sim.cfg.eC);
  writeHeat(sim, heat);
  return heat;
}

// ---------------------------------------------------------------------------------------------------------------------
// Forks and control twins

/**
 * Copies R's state into `to` on the device (R4.7): `cells[0]`, the current genome buffer into both genome buffers, and the
 * ledger, then `to.step = from.step`. The two worlds must have the same shape. The event counter and the dropped counter of the
 * copy are cleared (R is drained before a fork, so they are 0 in the copy anyway; the physics never reads them, and neither
 * is part of a state hash). Queued: later writes and steps on `to` follow it. A 2D sim whose light was changed with `setLight`
 * is not forked faithfully (the sun is not part of the copied state); the gate worlds run on their own light.
 */
export function forkSim(from: SimLike, to: SimLike): void {
  if (from.n !== to.n || from.device !== to.device) throw new Error("forkSim: the sims differ in size or device");
  const gc = genomeChannels(from.cfg);
  if (gc !== genomeChannels(to.cfg)) throw new Error("forkSim: the sims differ in genome width (slab against 2D)");
  const cellBytes = from.n * CELL_CHANNELS * 4;
  const genomeBytes = from.n * gc * 4;
  const enc = from.device.createCommandEncoder();
  enc.copyBufferToBuffer(from.cells[0], 0, to.cells[0], 0, cellBytes);
  enc.copyBufferToBuffer(from.currentGenome, 0, to.genome[0], 0, genomeBytes);
  enc.copyBufferToBuffer(from.currentGenome, 0, to.genome[1], 0, genomeBytes);
  enc.copyBufferToBuffer(from.ledger, 0, to.ledger, 0, LEDGER_WORDS * 4);
  enc.clearBuffer(to.ledger, LEDGER.EVENTS * 4, 8);
  from.device.queue.submit([enc.finish()]);
  to.step = from.step;
}

/**
 * A new sim under `cfg` (default: R's) holding R's state at its step. `state0` is any valid state of the world's shape (the
 * initial world is fine): the sim is created from it (config equality is enforced there) and the fork overwrites it.
 */
export async function createTwin(ref: SimLike, state0: WorldState, cfg: WorldConfig = ref.cfg): Promise<GpuSim | GpuSim3> {
  const sim = await createSim(ref.device, { ...state0, cfg });
  try {
    forkSim(ref, sim);
  } catch (e) {
    sim.destroy();
    throw e;
  }
  return sim;
}

export type ControlKind = "N" | "F";

/** Seed of the noise-swapped twin (R4.10): every stochastic rounding and lottery of R draws differently under it. */
export const noiseSeed = (seed: number): number => lowbias32((seed ^ 0x4e4e4e4e) >>> 0);

/**
 * Configuration of a control (R4.10), R's with exactly the stated keys changed: N, `seed` becomes `noiseSeed(seed)`; F, `dtQ`
 * becomes 0 and `motility` false (zero displacement, so a voxel with B <= 16 sends nothing and a kick stays where it is).
 */
export function controlConfig(cfg: WorldConfig, kind: ControlKind): WorldConfig {
  if (kind === "N") {
    const seed = noiseSeed(cfg.seed);
    if (seed === cfg.seed) throw new Error(`controlConfig: the noise seed of ${cfg.seed} is itself`);
    return { ...cfg, seed };
  }
  return { ...cfg, dtQ: 0, motility: false };
}

/**
 * A control sim (R4.10): R's state at T under `controlConfig(ref.cfg, kind)`. Created with the overridden configuration and
 * filled by `forkSim`, with no `upload`, so `configDiff` never sees the difference. The F pair is two such sims (R_F and X_F);
 * a kick, if any, is applied to X_F afterwards. C1 does not apply to controls; C2 uses R's own initial totals; C8 is
 * `configDiff(ref.cfg, sim.cfg)` equal to `["seed"]` (N) or `["dtQ", "motility"]` (F).
 */
export function createControlSim(ref: SimLike, state0: WorldState, kind: ControlKind): Promise<GpuSim | GpuSim3> {
  return createTwin(ref, state0, controlConfig(ref.cfg, kind));
}

// ---------------------------------------------------------------------------------------------------------------------
// Channel reads

/** Reads whole channels of a sim's current cells (`n` words each: about 2 MB for the slab), in one submission. */
export async function readChannels(sim: SimLike, channels: readonly number[]): Promise<Uint32Array[]> {
  const n = sim.n;
  const enc = sim.device.createCommandEncoder();
  const stages = channels.map((ch) => {
    if (!Number.isInteger(ch) || ch < 0 || ch >= CELL_CHANNELS) throw new Error(`readChannels: channel ${ch}`);
    const st = sim.device.createBuffer({ size: n * 4, usage: MAP_READ | COPY_DST });
    enc.copyBufferToBuffer(sim.cells[0], ch * n * 4, st, 0, n * 4);
    return st;
  });
  sim.device.queue.submit([enc.finish()]);
  return Promise.all(
    stages.map(async (st) => {
      await st.mapAsync(MAP_READ);
      const out = new Uint32Array(st.getMappedRange().slice(0));
      st.unmap();
      st.destroy();
      return out;
    }),
  );
}

/** One channel of a sim's current cells (`CH.B`, ...). */
export async function readChannel(sim: SimLike, ch: number): Promise<Uint32Array> {
  return (await readChannels(sim, [ch]))[0];
}

// ---------------------------------------------------------------------------------------------------------------------
// The diff pass and its log (R6)

/**
 * Global counters of a log row, in the plan's order (8.2). `n_blk`, `n_blk2` and `L1c` are the net-sum decider's, `n_occ` the
 * occupancy decider's; `n_thetaV` is the number of voxels with `abs(dB) >= thetaV` (the sum of the occupancy counts); `L1_*` are
 * sums of `min(abs(d), 1023)` over voxels. Everything is an exact u32 count or sum.
 */
export const DIFF_COLS = [
  "n_blk",
  "n_blk2",
  "n_occ",
  "L1c",
  "liveblk_R",
  "n_thetaV",
  "n_2thetaV",
  "n_1",
  "n_live",
  "n_vox",
  "L1_A",
  "L1_B",
  "L1_C",
  "L1_P",
  "SB_R",
  "live_R",
  "SB_X",
  "live_X",
] as const;
export type DiffCol = (typeof DIFF_COLS)[number];
/** Words of a row before the per-site words. */
export const DIFF_GLOBAL_WORDS = DIFF_COLS.length;
/** Words per S site: damaged blocks attributed under the net decider, under the occupancy decider, then the two reaches. */
export const DIFF_SITE_WORDS = 4;
/** The counters of the zero control: all 0 at every step for a fork with no kick (C1). */
export const DIFF_ZERO_COLS: readonly DiffCol[] = ["n_blk", "n_blk2", "n_occ", "L1c", "n_thetaV", "n_2thetaV", "n_1", "n_live", "n_vox", "L1_A", "L1_B", "L1_C", "L1_P"];
const COL = Object.fromEntries(DIFF_COLS.map((c, i) => [c, i])) as Record<DiffCol, number>;

/** Index of a global counter within a log row. */
export const diffCol = (name: DiffCol): number => COL[name];

/** A log read back from the device: `rows` rows of `rowWords` words, row t = the counters after t steps. */
export class DiffLog {
  constructor(
    readonly words: Uint32Array,
    readonly rowWords: number,
    readonly nSites: number,
    readonly rows: number,
  ) {}

  /** The whole row of step `t`. */
  row(t: number): Uint32Array {
    return this.words.subarray(t * this.rowWords, (t + 1) * this.rowWords);
  }

  /** A global counter at step `t`. */
  at(t: number, col: DiffCol): number {
    return this.words[t * this.rowWords + COL[col]];
  }

  /** The per-site words at step `t`. */
  site(t: number, j: number): { net: number; occ: number; reachNet: number; reachOcc: number } {
    const o = t * this.rowWords + DIFF_GLOBAL_WORDS + DIFF_SITE_WORDS * j;
    return { net: this.words[o], occ: this.words[o + 1], reachNet: this.words[o + 2], reachOcc: this.words[o + 3] };
  }

  /** A global counter over steps `from` to `to` inclusive. */
  series(col: DiffCol, from = 0, to = this.rows - 1): number[] {
    const out: number[] = [];
    for (let t = from; t <= to; t++) out.push(this.at(t, col));
    return out;
  }
}

export interface DiffOptions {
  /** Reference step at which the twin phase starts: row 0 is the pass encoded while the reference's ledger says this. */
  startStep: number;
  /** Steps the log can hold: rows 0 to maxSteps. A pass at a later step is dropped, never written out of range. */
  maxSteps: number;
  /** Block threshold of the net decider: a block is damaged if abs(dB_blk) >= thetaB. At least 1. */
  thetaB: number;
  /** Voxel threshold (n_thetaV, n_2thetaV and the occupancy decider). At least 1. */
  thetaV: number;
  /** Voxels per block at or above thetaV that make a block damaged under the occupancy decider (OCC_V). Default 8. */
  occV?: number;
  /** Voxel indices of the S sites (S and the F pair's X_F), for the per-site words. Only the column (x, y) is used. */
  sites?: ArrayLike<number>;
}

export interface Diff {
  /** Rows in the log (maxSteps + 1) and words per row (DIFF_GLOBAL_WORDS + DIFF_SITE_WORDS * sites). */
  readonly rows: number;
  readonly rowWords: number;
  readonly nSites: number;
  /** Encodes the diff as a compute pass of its own. */
  encode(enc: GPUCommandEncoder): void;
  /** Encodes the diff into a pass the caller has open (the lockstep driver shares one pass among all diffs of a step). */
  encodeInto(pass: GPUComputePassEncoder): void;
  /** Encodes a clear of the log. */
  encodeClear(enc: GPUCommandEncoder): void;
  /** Encodes the copy of the log to the staging buffer; `collect` maps it after the submission that holds this. */
  encodeRead(enc: GPUCommandEncoder): void;
  collect(): Promise<DiffLog>;
  /** `encodeRead`, a submission and `collect`: the log as it stands. One read at a time per diff (they share a staging buffer). */
  read(): Promise<DiffLog>;
  /** Changes the thresholds and the start step for later passes. */
  setParams(p: { startStep?: number; thetaB?: number; thetaV?: number; occV?: number }): void;
  destroy(): void;
}

const pipelines = new WeakMap<GPUDevice, Map<string, Promise<GPUComputePipeline>>>();

/** The diff kernel of a world shape, compiled once per device. */
function diffPipeline(device: GPUDevice, g: BlockGrid): Promise<GPUComputePipeline> {
  let byShape = pipelines.get(device);
  if (!byShape) pipelines.set(device, (byShape = new Map()));
  const key = `${g.W}x${g.H}x${g.D}`;
  let p = byShape.get(key);
  if (!p) {
    p = (async () => {
      const module = device.createShaderModule({ code: diffShader(g), label: `regime-diff ${key}` });
      const info = await module.getCompilationInfo?.();
      const errs = info?.messages.filter((m) => m.type === "error") ?? [];
      if (errs.length) throw new Error(`regime-diff ${key}: ${errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join("\n")}`);
      return device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" }, label: `regime-diff ${key}` });
    })();
    p.catch(() => byShape!.delete(key));
    byShape.set(key, p);
  }
  return p;
}

/**
 * The block diff pass of twin `x` against reference `ref` (R6): one workgroup of 8 x 8 threads per block, each thread walking the
 * layers of its column. A workgroup reduces the signed `B_X - B_R` over its block in workgroup memory (no global atomics for the
 * block sum), accumulates the voxel counters in workgroup atomics and adds each non-zero counter once to the log row; the
 * per-site words are touched only by damaged blocks. Bindings: the two cell buffers, the reference's ledger (for the step word),
 * the site list, the log, and a small uniform with the thresholds (a deviation from the plan's list of five bindings: it lets one
 * compiled kernel serve every job and every twin, whose thresholds differ). The F pair is compared the same way, X_F against R_F.
 */
export async function createDiff(ref: SimLike, x: SimLike, opts: DiffOptions): Promise<Diff> {
  const g = blockGrid(ref.cfg);
  const gx = blockGrid(x.cfg);
  if (g.W !== gx.W || g.H !== gx.H || g.D !== gx.D) throw new Error("createDiff: the sims differ in shape");
  if (ref.device !== x.device) throw new Error("createDiff: the sims are on different devices");
  const device = ref.device;
  const sites = Array.from(opts.sites ?? []);
  const occV = opts.occV ?? 8;
  for (const [name, v] of [["startStep", opts.startStep], ["maxSteps", opts.maxSteps], ["thetaB", opts.thetaB], ["thetaV", opts.thetaV], ["occV", occV]] as const)
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`createDiff: ${name} = ${v}`);
  if (opts.thetaB < 1 || opts.thetaV < 1 || occV < 1) throw new Error("createDiff: thresholds must be at least 1");
  if (g.W > 0xffff || g.H > 0xffff) throw new Error("createDiff: a world wider than 65535 columns");
  for (const s of sites) if (!Number.isInteger(s) || s < 0 || s >= g.n) throw new Error(`createDiff: site ${s} is not a voxel`);

  const rows = opts.maxSteps + 1;
  const nSites = sites.length;
  const rowWords = DIFF_GLOBAL_WORDS + DIFF_SITE_WORDS * nSites;
  const logWords = rows * rowWords;
  const pipe = await diffPipeline(device, g);

  device.pushErrorScope("validation");
  let diff: Diff;
  let made: GPUBuffer[] = [];
  try {
    const mk = (size: number, usage: number, label: string) => {
      const b = device.createBuffer({ size: Math.max(16, size), usage, label });
      made.push(b);
      return b;
    };
    const logBuf = mk(logWords * 4, STORAGE | COPY_SRC | COPY_DST, "regime-log");
    const stage = mk(logWords * 4, MAP_READ | COPY_DST, "regime-log-stage");
    const sitesBuf = mk(Math.max(1, nSites) * 4, STORAGE | COPY_DST, "regime-sites");
    const paramsBuf = mk(32, UNIFORM | COPY_DST, "regime-params");
    if (nSites > 0) device.queue.writeBuffer(sitesBuf, 0, Uint32Array.from(sites, (v) => (v % g.W) | ((Math.floor(v / g.W) % g.H) << 16)) as unknown as BufferSource);
    const params = { startStep: opts.startStep, thetaB: opts.thetaB, thetaV: opts.thetaV, occV };
    const writeParams = () => device.queue.writeBuffer(paramsBuf, 0, Uint32Array.of(params.thetaB, params.thetaV, params.occV, nSites, rowWords, params.startStep, rows, 0) as unknown as BufferSource);
    writeParams();
    const group = device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [ref.cells[0], x.cells[0], ref.ledger, sitesBuf, logBuf, paramsBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    let collected = false;
    const encodeInto = (pass: GPUComputePassEncoder) => {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(g.bx, g.by, 1);
    };
    const encodeRead = (enc: GPUCommandEncoder) => {
      enc.copyBufferToBuffer(logBuf, 0, stage, 0, logWords * 4);
      collected = false;
    };
    const collect = async () => {
      if (collected) throw new Error("Diff.collect: the staging buffer was already collected; encodeRead again");
      await stage.mapAsync(MAP_READ);
      const words = new Uint32Array(stage.getMappedRange().slice(0, logWords * 4));
      stage.unmap();
      collected = true;
      return new DiffLog(words, rowWords, nSites, rows);
    };
    diff = {
      rows,
      rowWords,
      nSites,
      encodeInto,
      encode(enc) {
        const pass = enc.beginComputePass();
        encodeInto(pass);
        pass.end();
      },
      encodeClear(enc) {
        enc.clearBuffer(logBuf);
      },
      encodeRead,
      collect,
      async read() {
        const enc = device.createCommandEncoder();
        encodeRead(enc);
        device.queue.submit([enc.finish()]);
        return collect();
      },
      setParams(p) {
        if (p.startStep !== undefined) params.startStep = p.startStep;
        if (p.thetaB !== undefined) params.thetaB = p.thetaB;
        if (p.thetaV !== undefined) params.thetaV = p.thetaV;
        if (p.occV !== undefined) params.occV = p.occV;
        if (params.thetaB < 1 || params.thetaV < 1 || params.occV < 1) throw new Error("Diff.setParams: thresholds must be at least 1");
        writeParams();
      },
      destroy() {
        for (const b of made) b.destroy();
        made = [];
      },
    };
  } catch (e) {
    for (const b of made) b.destroy();
    throw e;
  } finally {
    const err = await device.popErrorScope();
    if (err) {
      for (const b of made) b.destroy();
      throw new Error(`WebGPU validation: ${err.message}`);
    }
  }
  return diff;
}

/** WGSL of the diff kernel for a world shape. Dimensions and channel offsets are constants; thresholds are in the uniform. */
function diffShader(g: BlockGrid): string {
  const n = g.n;
  return /* wgsl */ `
const W = ${g.W}u;
const H = ${g.H}u;
const D = ${g.D}u;
const L_STEP = ${LEDGER.STEP}u;
const CH_A = ${CH.A * n}u;
const CH_B = ${CH.B * n}u;
const CH_C = ${CH.C * n}u;
const CH_P = ${CH.P * n}u;
const CH_E = ${CH.E * n}u;
const CH_S = ${CH.S * n}u;
const CH_MOT = ${CH.MOT * n}u;
const CLIP = 1023u;
const NCOL = ${DIFF_GLOBAL_WORDS}u;
const SITE_WORDS = ${DIFF_SITE_WORDS}u;

struct Params { thetaB: u32, thetaV: u32, occV: u32, nSites: u32, rowWords: u32, startStep: u32, rows: u32, pad: u32 }

@group(0) @binding(0) var<storage, read> ra: array<u32>;
@group(0) @binding(1) var<storage, read> xa: array<u32>;
@group(0) @binding(2) var<storage, read> ctrl: array<u32>;
@group(0) @binding(3) var<storage, read> sites: array<u32>;
@group(0) @binding(4) var<storage, read_write> log: array<atomic<u32>>;
@group(0) @binding(5) var<uniform> P: Params;

// acc: 0 signed block sum of dB (bitcast), 1 voxels with abs(dB) >= thetaV, 2 >= 2 thetaV, 3 >= 1, 4 living status differs,
// 5 any channel differs, 6..9 L1 of A, B, C, P, 10 sum of B_R, 11 living in R, 12 sum of B_X, 13 living in X.
var<workgroup> acc: array<atomic<u32>, 16>;

fn ad(a: u32, b: u32) -> u32 { return select(a - b, b - a, b > a); }
fn cl(a: u32, b: u32) -> u32 { return min(ad(a, b), CLIP); }

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  if (li < 16u) { atomicStore(&acc[li], 0u); }
  workgroupBarrier();
  let x = wid.x * 8u + lid.x;
  let y = wid.y * 8u + lid.y;
  let tv = P.thetaV;
  var s_db = 0i;
  var c_tv = 0u; var c_2tv = 0u; var c_1 = 0u; var c_live = 0u; var c_vox = 0u;
  var l_a = 0u; var l_b = 0u; var l_c = 0u; var l_p = 0u;
  var sb_r = 0u; var lv_r = 0u; var sb_x = 0u; var lv_x = 0u;
  for (var z = 0u; z < D; z++) {
    let i = (z * H + y) * W + x;
    let rA = ra[CH_A + i]; let xA = xa[CH_A + i];
    let rB = ra[CH_B + i]; let xB = xa[CH_B + i];
    let rC = ra[CH_C + i]; let xC = xa[CH_C + i];
    let rP = ra[CH_P + i]; let xP = xa[CH_P + i];
    let rE = ra[CH_E + i]; let xE = xa[CH_E + i];
    let rS = ra[CH_S + i]; let xS = xa[CH_S + i];
    let rM = ra[CH_MOT + i]; let xM = xa[CH_MOT + i];
    let db = i32(xB) - i32(rB);
    let adb = u32(abs(db));
    s_db += db;
    if (adb >= tv) { c_tv++; }
    if (adb >= 2u * tv) { c_2tv++; }
    if (adb >= 1u) { c_1++; }
    let lr = (rB + rP) > 0u;
    let lx = (xB + xP) > 0u;
    if (lr != lx) { c_live++; }
    if (rA != xA || rB != xB || rC != xC || rP != xP || rE != xE || rS != xS || rM != xM) { c_vox++; }
    l_a += cl(rA, xA); l_b += cl(rB, xB); l_c += cl(rC, xC); l_p += cl(rP, xP);
    sb_r += rB; sb_x += xB;
    if (lr) { lv_r++; }
    if (lx) { lv_x++; }
  }
  atomicAdd(&acc[0], bitcast<u32>(s_db));
  atomicAdd(&acc[1], c_tv);
  atomicAdd(&acc[2], c_2tv);
  atomicAdd(&acc[3], c_1);
  atomicAdd(&acc[4], c_live);
  atomicAdd(&acc[5], c_vox);
  atomicAdd(&acc[6], l_a);
  atomicAdd(&acc[7], l_b);
  atomicAdd(&acc[8], l_c);
  atomicAdd(&acc[9], l_p);
  atomicAdd(&acc[10], sb_r);
  atomicAdd(&acc[11], lv_r);
  atomicAdd(&acc[12], sb_x);
  atomicAdd(&acc[13], lv_x);
  workgroupBarrier();

  // Row of this pass: the reference ledger's step word minus the start step. A pass outside the log is dropped.
  let row = ctrl[L_STEP] - P.startStep;
  if (row >= P.rows) { return; }
  let base = row * P.rowWords;
  let dB = bitcast<i32>(atomicLoad(&acc[0]));
  let absB = u32(abs(dB));
  let occ = atomicLoad(&acc[1]);
  let liveR = atomicLoad(&acc[11]);

  // Threads 0 to 17 each add one counter of the block to its column of the row.
  var v = 0u;
  switch (li) {
    case 0u: { if (absB >= P.thetaB) { v = 1u; } }
    case 1u: { if (absB >= 2u * P.thetaB) { v = 1u; } }
    case 2u: { if (occ >= P.occV) { v = 1u; } }
    case 3u: { v = absB; }
    case 4u: { if (liveR > 0u) { v = 1u; } }
    case 5u: { v = occ; }
    case 6u: { v = atomicLoad(&acc[2]); }
    case 7u: { v = atomicLoad(&acc[3]); }
    case 8u: { v = atomicLoad(&acc[4]); }
    case 9u: { v = atomicLoad(&acc[5]); }
    case 10u: { v = atomicLoad(&acc[6]); }
    case 11u: { v = atomicLoad(&acc[7]); }
    case 12u: { v = atomicLoad(&acc[8]); }
    case 13u: { v = atomicLoad(&acc[9]); }
    case 14u: { v = atomicLoad(&acc[10]); }
    case 15u: { v = liveR; }
    case 16u: { v = atomicLoad(&acc[12]); }
    case 17u: { v = atomicLoad(&acc[13]); }
    default: {}
  }
  if (li < NCOL && v != 0u) { atomicAdd(&log[base + li], v); }

  // Per-site attribution, only for a damaged block: the nearest site to the block's centre by Chebyshev torus distance,
  // ties to the lower index.
  if (li == 32u && P.nSites > 0u && (absB >= P.thetaB || occ >= P.occV)) {
    let cx = wid.x * 8u + 4u;
    let cy = wid.y * 8u + 4u;
    var best = 0u;
    var bd = 0xffffffffu;
    for (var j = 0u; j < P.nSites; j++) {
      let sp = sites[j];
      var dx = ad(cx, sp & 0xffffu);
      dx = min(dx, W - dx);
      var dy = ad(cy, sp >> 16u);
      dy = min(dy, H - dy);
      let d = max(dx, dy);
      if (d < bd) { bd = d; best = j; }
    }
    let sb = base + NCOL + SITE_WORDS * best;
    if (absB >= P.thetaB) { atomicAdd(&log[sb], 1u); atomicMax(&log[sb + 2u], bd); }
    if (occ >= P.occV) { atomicAdd(&log[sb + 1u], 1u); atomicMax(&log[sb + 3u], bd); }
  }
}
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Lockstep

/** One twin of a bank: its sim, its diff against the reference (null for a sim that is only stepped), and its length in steps. */
export interface LockMember {
  sim: StepSim;
  diff: Diff | null;
  /** The sim runs for steps 1 to `steps` of the phase (Z 100, U 300, N 300, doses 300, S 1,000, ...). */
  steps: number;
}

export interface LockstepOptions {
  /** Lockstep steps already done in this phase, for a phase run in several calls (default 0). */
  done?: number;
  /** Also encode the pass before step 1 (row 0 of every diff). Only for the first call of a phase. */
  initial?: boolean;
  /** Lockstep steps per command buffer (default 10; a runner parameter, not a rule constant). */
  stepsPerSubmit?: number;
  /** Steps between waits for the queue and calls of `onBatch` (default 100). */
  batch?: number;
  /** Called after each batch has completed on the device, with the lockstep steps done in the phase. */
  onBatch?: (done: number) => void | Promise<void>;
}

/**
 * Runs the reference and its twins `steps` steps in lockstep (R2.6): each step encodes R's step, then each active twin's step,
 * then one compute pass holding every active diff, so a diff sees all of them stepped. Twins past their length idle. The logs
 * stay on the device: read them with `Diff.read` (a diff is cheap to read: about 330 KB for S).
 */
export async function runLockstep(
  ref: StepSim,
  members: readonly LockMember[],
  steps: number,
  opts: LockstepOptions = {},
): Promise<{ done: number; simSteps: number; submits: number }> {
  const device = ref.device;
  const per = Math.max(1, Math.floor(opts.stepsPerSubmit ?? 10));
  const batch = Math.max(per, Math.floor(opts.batch ?? 100));
  const start = opts.done ?? 0;
  let simSteps = 0;
  let submits = 0;
  let enc = device.createCommandEncoder();
  let inEnc = 0;
  const diffPass = (e: GPUCommandEncoder, t: number) => {
    let pass: GPUComputePassEncoder | null = null;
    for (const m of members) {
      if (!m.diff || t > m.steps) continue;
      pass ??= e.beginComputePass();
      m.diff.encodeInto(pass);
    }
    pass?.end();
  };
  if (opts.initial) {
    // Row 0: the pass before step 1, in a command buffer of its own so that a phase of zero steps still logs it.
    diffPass(enc, start + 1);
    device.queue.submit([enc.finish()]);
    submits++;
    enc = device.createCommandEncoder();
  }
  for (let s = 1; s <= steps; s++) {
    const t = start + s;
    ref.encodeStep(enc);
    simSteps++;
    for (const m of members) {
      if (t > m.steps) continue;
      m.sim.encodeStep(enc);
      simSteps++;
    }
    diffPass(enc, t);
    // A batch ends on a submit: when `batch` is not a multiple of `stepsPerSubmit` the encoder still holds steps at the batch boundary, and waiting
    // (or calling onBatch with "t steps done") before submitting them would report steps that are not on the device.
    const atBatch = s % batch === 0 || s === steps;
    inEnc++;
    if (inEnc === per || atBatch) {
      device.queue.submit([enc.finish()]);
      submits++;
      enc = device.createCommandEncoder();
      inEnc = 0;
    }
    if (atBatch) {
      await device.queue.onSubmittedWorkDone();
      await opts.onBatch?.(t);
    }
  }
  return { done: start + steps, simSteps, submits };
}
