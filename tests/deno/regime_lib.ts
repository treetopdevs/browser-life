// Shared helpers of the regime Deno tests (tests/deno/regime_*.ts) and of the M1 measurements. Exports only: no top-level work,
// so a glob that runs every regime_*.ts is harmless. Plan: docs/3d-regime-meters-plan-2026-10-23.md section 8.3; rule R4, R5, R6.
//
// Everything here is a test-side recipe, written independently of packages/sim-gpu/src/regime.ts where it checks it:
//  - scaleOf, pickSites, keyedOrder: R4.1 to R4.5 (the production versions belong to packages/metrics/src/regime3.ts, M0);
//  - p2Thresholds: R4.9;
//  - refDiffRow: a CPU recomputation of one row of the diff log from two readCells arrays;
//  - buildBank, runBank: the twin bank of R2.6 built from the module's public API, the way the runner will.
import {
  CELL_CHANNELS,
  CH,
  draw,
  initWorld,
  ledgerResidual,
  lowbias32,
  presetById,
  presetConfig,
  stateHash,
  totalsOf,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import {
  DIFF_COLS,
  DIFF_GLOBAL_WORDS,
  DIFF_SITE_WORDS,
  applyKick,
  blockGrid,
  createControlSim,
  createDiff,
  createSim,
  createTwin,
  freezeRef,
  kickBalls,
  kickSites,
  runLockstep,
  unitKick,
  type BlockGrid,
  type Diff,
  type DiffLog,
  type FrozenRef,
  type GpuSim,
  type GpuSim3,
  type KickSet,
  type LockMember,
  type RefSimLike,
} from "@bl/sim-gpu";

export type AnySim = GpuSim | GpuSim3;

// ---------------------------------------------------------------------------------------------------------------------
// Reporting

/** PASS/FAIL lines in the style of the other tests/deno scripts; `done()` exits non-zero if anything failed. */
export class Checker {
  checks = 0;
  failures = 0;
  constructor(readonly title: string) {}
  check(name: string, cond: boolean, detail = ""): boolean {
    this.checks++;
    if (!cond) this.failures++;
    console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? `: ${detail.slice(0, 900)}` : ""}`);
    return cond;
  }
  done(): never {
    console.log(`${this.title}: ${this.checks - this.failures} of ${this.checks} checks passed${this.failures ? `, ${this.failures} FAILED` : ""}`);
    Deno.exit(this.failures ? 1 : 0);
  }
}

export async function uptime(): Promise<string> {
  try {
    return new TextDecoder().decode((await new Deno.Command("uptime").output()).stdout).trim();
  } catch {
    return "uptime unavailable";
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Worlds

export interface World {
  id: string;
  cfg: WorldConfig;
  /** The initial world (a valid state of the right shape; twins are created from it and overwritten by a fork). */
  state0: WorldState;
  /** R's own initial totals: the baseline of C2 for every sim of a job. */
  start: ReturnType<typeof totalsOf>;
}

function worldOf(id: string, presetId: string, seed: number, extra: Partial<WorldConfig>): World {
  const preset = presetById(presetId)!;
  const cfg = presetConfig(preset, seed, extra);
  const state0 = initWorld(cfg, preset.init);
  return { id, cfg, state0, start: totalsOf(cfg, state0.cells) };
}

/** `slab-spots` at W x H x 8 with the B0 setting (mu 30, sigma 8, lightK 256) unless `extra` says otherwise. */
export function slabWorld(seed: number, W: number, H: number, extra: Partial<WorldConfig> = {}): World {
  return worldOf(`slab-${W}x${H}x8-s${seed}`, "slab-spots", seed, { tileW: W, tileH: H, defaultMu: 30, defaultSigma: 8, lightK: 256, ...extra });
}

/** A registered 2D preset (`spots-m3`, `gradient-m3`), optionally shrunk. */
export function flatWorld(presetId: string, seed: number, W?: number, H?: number, extra: Partial<WorldConfig> = {}): World {
  return worldOf(`${presetId}-${W ?? 256}x${H ?? 256}-s${seed}`, presetId, seed, { ...(W ? { tileW: W } : {}), ...(H ? { tileH: H } : {}), ...extra });
}

/** Creates the sim of a world and runs it `steps` steps in blocks of 100, draining the ledger after each (as a burn-in does). */
export async function burnIn(device: GPUDevice, world: World, steps: number): Promise<AnySim> {
  const sim = await createSim(device, world.state0);
  for (let s = 0; s < steps; s += 100) {
    sim.run(Math.min(100, steps - s));
    await sim.drainLedger();
  }
  return sim;
}

export const hashOf = async (sim: AnySim): Promise<string> => stateHash(await sim.readState());

/** C2 for one sim: matter equals R's initial total and the energy ledger closes, both against R's own initial totals. */
export async function c2(sim: AnySim, world: World): Promise<{ ok: boolean; matterDelta: bigint; residual: bigint }> {
  const s = await sim.readState();
  const t = totalsOf(s.cfg, s.cells);
  const matterDelta = t.matter - world.start.matter;
  const residual = ledgerResidual(world.start, s);
  return { ok: matterDelta === 0n && residual === 0n, matterDelta, residual };
}

// ---------------------------------------------------------------------------------------------------------------------
// R4 recipes (test-side)

export interface Scale {
  /** Lower median of B over the voxels with B >= 1 (R4.1); 0 if there are none. */
  Bstar: number;
  k: number;
  thetaB: number;
  thetaV: number;
  /** Eligible voxels, B >= k + 1, ascending (R4.2). */
  E: number[];
  living: number;
}

export function scaleOf(cells: Uint32Array, n: number): Scale {
  const vals: number[] = [];
  let living = 0;
  for (let v = 0; v < n; v++) {
    const b = cells[CH.B * n + v];
    if (b >= 1) vals.push(b);
    if (b + cells[CH.P * n + v] > 0) living++;
  }
  vals.sort((a, b) => a - b);
  const Bstar = vals.length ? vals[Math.floor((vals.length - 1) / 2)] : 0;
  const k = Math.max(12, Math.floor(Bstar / 2));
  const E: number[] = [];
  for (let v = 0; v < n; v++) if (cells[CH.B * n + v] >= k + 1) E.push(v);
  return { Bstar, k, thetaB: Math.ceil(k / 2), thetaV: Math.max(2, Math.ceil(k / 4)), E, living };
}

/** R4.3. */
export const startHash = (seed: number, T: number): number => lowbias32((Math.imul(seed, 7919) ^ T) >>> 0);

/** Horizontal Chebyshev torus distance in voxels between two voxel indices (z ignored). */
export function cheb(g: BlockGrid, a: number, b: number): number {
  const ax = a % g.W, ay = Math.floor(a / g.W) % g.H, bx = b % g.W, by = Math.floor(b / g.W) % g.H;
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return Math.max(Math.min(dx, g.W - dx), Math.min(dy, g.H - dy));
}

/** R4.4 (the hard-core draw), with the separation as a parameter: the 40 voxels of the rule do not fit a small test world. */
export function pickSites(g: BlockGrid, E: readonly number[], h0: number, max: number, dsep: number): number[] {
  const sites: number[] = [];
  if (E.length === 0) return sites;
  for (let j = 0; j < 4096 && sites.length < max; j++) {
    const v = E[draw(h0, j) % E.length];
    if (sites.every((s) => cheb(g, s, v) >= dsep)) sites.push(v);
  }
  return sites;
}

/** R4.5: E sorted by the key lowbias32((v ^ h0) >>> 0), ties by index. */
export function keyedOrder(E: readonly number[], h0: number): number[] {
  return E.map((v) => ({ v, key: lowbias32((v ^ h0) >>> 0) }))
    .sort((a, b) => a.key - b.key || a.v - b.v)
    .map((o) => o.v);
}

/** Median with the rule's convention (R0): the mean of the two middle values of an even count. */
export function median(xs: ArrayLike<number>): number {
  const s = Array.from(xs).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** R4.9: thetaB = ceil(M / 2), M the median |dB_blk(0)| over the S kick's blocks; thetaV = max(2, ceil(K / 2)), K the median k_v. */
export function p2Thresholds(kickS: KickSet): { thetaB: number; thetaV: number } {
  return { thetaB: Math.ceil(median(kickS.blockSums) / 2), thetaV: Math.max(2, Math.ceil(median(kickS.amounts) / 2)) };
}

/** Blocks with at least one living voxel (B + P > 0) in the cells. */
export function liveBlocks(g: BlockGrid, cells: Uint32Array): number {
  const live = new Uint8Array(g.nBlocks);
  const n = g.n;
  for (let v = 0; v < n; v++)
    if (cells[CH.B * n + v] + cells[CH.P * n + v] > 0) live[(Math.floor(v / g.W) % g.H >> 3) * g.bx + ((v % g.W) >> 3)] = 1;
  return live.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// CPU recomputation of one diff row

export interface DiffParams {
  thetaB: number;
  thetaV: number;
  occV: number;
}

/**
 * One row of the log recomputed from two readCells arrays, from the definitions of R6 and the conventions of regime.ts's header:
 * the signed block sum of B_X - B_R, voxel counters, the L1 distances clipped at 1023 per voxel, living as B + P > 0, and for
 * each S site the damaged blocks attributed by Chebyshev torus distance from the block centre (8 bx + 4, 8 by + 4), ties to
 * the lower index, with the largest distance as the reach.
 */
export function refDiffRow(g: BlockGrid, R: Uint32Array, X: Uint32Array, p: DiffParams, sites: readonly number[]): Uint32Array {
  const n = g.n;
  const row = new Array<number>(DIFF_GLOBAL_WORDS + DIFF_SITE_WORDS * sites.length).fill(0);
  const at = (name: (typeof DIFF_COLS)[number]) => DIFF_COLS.indexOf(name);
  const dBblk = new Array<number>(g.nBlocks).fill(0);
  const occ = new Array<number>(g.nBlocks).fill(0);
  const liveR = new Array<number>(g.nBlocks).fill(0);
  for (let v = 0; v < n; v++) {
    const x = v % g.W;
    const y = Math.floor(v / g.W) % g.H;
    const b = (y >> 3) * g.bx + (x >> 3);
    const rB = R[CH.B * n + v], xB = X[CH.B * n + v];
    const rP = R[CH.P * n + v], xP = X[CH.P * n + v];
    const d = xB - rB;
    const ad = Math.abs(d);
    dBblk[b] += d;
    if (ad >= p.thetaV) { row[at("n_thetaV")]++; occ[b]++; }
    if (ad >= 2 * p.thetaV) row[at("n_2thetaV")]++;
    if (ad >= 1) row[at("n_1")]++;
    const lr = rB + rP > 0, lx = xB + xP > 0;
    if (lr !== lx) row[at("n_live")]++;
    if (lr) { row[at("live_R")]++; liveR[b] = 1; }
    if (lx) row[at("live_X")]++;
    let differ = false;
    for (let ch = 0; ch < CELL_CHANNELS; ch++) if (R[ch * n + v] !== X[ch * n + v]) differ = true;
    if (differ) row[at("n_vox")]++;
    row[at("L1_A")] += Math.min(Math.abs(X[CH.A * n + v] - R[CH.A * n + v]), 1023);
    row[at("L1_B")] += Math.min(ad, 1023);
    row[at("L1_C")] += Math.min(Math.abs(X[CH.C * n + v] - R[CH.C * n + v]), 1023);
    row[at("L1_P")] += Math.min(Math.abs(xP - rP), 1023);
    row[at("SB_R")] += rB;
    row[at("SB_X")] += xB;
  }
  for (let b = 0; b < g.nBlocks; b++) {
    const ab = Math.abs(dBblk[b]);
    const net = ab >= p.thetaB, occd = occ[b] >= p.occV;
    if (net) row[at("n_blk")]++;
    if (ab >= 2 * p.thetaB) row[at("n_blk2")]++;
    if (occd) row[at("n_occ")]++;
    row[at("L1c")] += ab;
    if (liveR[b]) row[at("liveblk_R")]++;
    if ((net || occd) && sites.length) {
      const cx = (b % g.bx) * 8 + 4, cy = Math.floor(b / g.bx) * 8 + 4;
      let best = 0, bd = Infinity;
      for (let j = 0; j < sites.length; j++) {
        const sx = sites[j] % g.W, sy = Math.floor(sites[j] / g.W) % g.H;
        const dx = Math.abs(cx - sx), dy = Math.abs(cy - sy);
        const d = Math.max(Math.min(dx, g.W - dx), Math.min(dy, g.H - dy));
        if (d < bd) { bd = d; best = j; }
      }
      const o = DIFF_GLOBAL_WORDS + DIFF_SITE_WORDS * best;
      if (net) { row[o]++; row[o + 2] = Math.max(row[o + 2], bd); }
      if (occd) { row[o + 1]++; row[o + 3] = Math.max(row[o + 3], bd); }
    }
  }
  return Uint32Array.from(row);
}

/** Names the words in which two rows differ (an empty string if they are equal). */
export function rowMismatch(gpu: ArrayLike<number>, cpu: ArrayLike<number>): string {
  const bad: string[] = [];
  for (let i = 0; i < Math.max(gpu.length, cpu.length); i++) {
    if (gpu[i] === cpu[i]) continue;
    const name = i < DIFF_GLOBAL_WORDS ? DIFF_COLS[i] : `site${Math.floor((i - DIFF_GLOBAL_WORDS) / DIFF_SITE_WORDS)}.${["net", "occ", "reachNet", "reachOcc"][(i - DIFF_GLOBAL_WORDS) % DIFF_SITE_WORDS]}`;
    bad.push(`${name} gpu ${gpu[i]} cpu ${cpu[i]}`);
  }
  return bad.join("; ");
}

// ---------------------------------------------------------------------------------------------------------------------
// The twin bank (R2.6), built from the module's public API

export interface BankOptions {
  rung: "P1" | "P2";
  maxSites: number;
  /** Separation of the S sites in voxels (the rule's D_SEP is 40; small test worlds need less). */
  dsep: number;
  /** Dose sizes m (R4.5); a dose runs only if m <= N_E / 2 and its kicked blocks are at most a tenth of the living blocks. */
  doses: readonly number[];
  /** Phase length of each twin in steps (R2.6: Z 100, U 300, N 300, doses 300, S 1,000). */
  steps: { Z: number; S: number; U: number; N: number; dose: number };
  /** Also build the F pair (R_F, and X_F carrying the S kick) with its own diff. */
  F?: boolean;
  /** Run every dose with m <= N_E / 2 whatever its kicked blocks: for the M1 measurement of the full bank, never for a job. */
  ignoreCap?: boolean;
  occV?: number;
}

export interface Bank {
  world: World;
  ref: AnySim;
  frozen: FrozenRef;
  g: BlockGrid;
  scale: Scale;
  sites: number[];
  thetaB: number;
  thetaV: number;
  liveblk: number;
  kicks: { S: KickSet; U: KickSet; doses: { m: number; kick: KickSet; run: boolean }[] };
  sims: Record<string, AnySim>;
  diffs: Record<string, Diff>;
  members: LockMember[];
  /** Length of the longest twin (the phase length). */
  length: number;
  destroy(): void;
}

/** Freezes R (it must be idle), builds every twin and control, applies the kicks and creates the diffs. R is not destroyed by `destroy`. */
export async function buildBank(world: World, ref: AnySim, opts: BankOptions): Promise<Bank> {
  const frozen = await freezeRef(ref as RefSimLike);
  const g = blockGrid(ref.cfg);
  const n = g.n;
  const B = frozen.cells.subarray(CH.B * n, (CH.B + 1) * n);
  const scale = scaleOf(frozen.cells, n);
  const h0 = startHash(ref.cfg.seed, frozen.step);
  const sites = pickSites(g, scale.E, h0, opts.maxSites, opts.dsep);
  const keyed = keyedOrder(scale.E, h0);
  const liveblk = liveBlocks(g, frozen.cells);
  const p1 = opts.rung === "P1";
  const kS = p1 ? kickSites(g, B, sites, scale.k) : kickBalls(g, B, sites);
  const kU = unitKick(g, kS);
  const th = p1 ? { thetaB: scale.thetaB, thetaV: scale.thetaV } : p2Thresholds(kS);
  const doses = opts.doses.map((m) => {
    const centres = keyed.slice(0, m);
    const kick = p1 ? kickSites(g, B, centres, scale.k) : kickBalls(g, B, centres);
    return { m, kick, run: m <= scale.E.length / 2 && (opts.ignoreCap === true || kick.blocks.length <= 0.1 * liveblk) };
  });
  const sims: Record<string, AnySim> = {};
  const diffs: Record<string, Diff> = {};
  const members: LockMember[] = [];
  const bank: Bank = {
    world, ref, frozen, g, scale, sites, thetaB: th.thetaB, thetaV: th.thetaV, liveblk, kicks: { S: kS, U: kU, doses },
    sims, diffs, members, length: 0,
    destroy() {
      for (const d of Object.values(diffs)) d.destroy();
      for (const s of Object.values(sims)) s.destroy();
    },
  };
  const add = async (name: string, sim: AnySim, steps: number, against: AnySim, siteList: readonly number[]) => {
    sims[name] = sim;
    diffs[name] = await createDiff(against, sim, { startStep: frozen.step, maxSteps: steps, thetaB: th.thetaB, thetaV: th.thetaV, occV: opts.occV, sites: siteList });
    members.push({ sim, diff: diffs[name], steps });
    bank.length = Math.max(bank.length, steps);
  };
  try {
    await add("Z", await createTwin(ref, world.state0), opts.steps.Z, ref, []);
    const S = await createTwin(ref, world.state0);
    applyKick(S, frozen, kS);
    await add("S", S, opts.steps.S, ref, sites);
    const U = await createTwin(ref, world.state0);
    applyKick(U, frozen, kU);
    await add("U", U, opts.steps.U, ref, []);
    await add("N", await createControlSim(ref, world.state0, "N"), opts.steps.N, ref, []);
    for (const d of doses) {
      if (!d.run) continue;
      const D = await createTwin(ref, world.state0);
      applyKick(D, frozen, d.kick);
      await add(`D${d.m}`, D, opts.steps.dose, ref, []);
    }
    if (opts.F) {
      const rf = await createControlSim(ref, world.state0, "F");
      sims.RF = rf;
      members.push({ sim: rf, diff: null, steps: opts.steps.S });
      const xf = await createControlSim(ref, world.state0, "F");
      applyKick(xf, frozen, kS);
      await add("XF", xf, opts.steps.S, rf, sites);
    }
  } catch (e) {
    bank.destroy();
    throw e;
  }
  return bank;
}

/** Runs the bank's lockstep (the diff of row 0 first) and reads every log. */
export async function runBank(bank: Bank, steps = bank.length, opts: { stepsPerSubmit?: number; initial?: boolean; done?: number } = {}): Promise<Record<string, DiffLog>> {
  await runLockstep(bank.ref, bank.members, steps, { initial: opts.initial ?? opts.done === undefined, done: opts.done, stepsPerSubmit: opts.stepsPerSubmit });
  return readLogs(bank);
}

export async function readLogs(bank: Bank): Promise<Record<string, DiffLog>> {
  const out: Record<string, DiffLog> = {};
  for (const [name, d] of Object.entries(bank.diffs)) out[name] = await d.read();
  return out;
}
