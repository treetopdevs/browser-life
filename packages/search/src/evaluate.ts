// Batch evaluation of candidate genomes for the M3 bootstrap: every candidate
// is founded in several independent tiles of one world, grown, lesioned, and
// separately deprived of light. Measured, not optimised for: individuals,
// size and speed (descriptors); lesion recovery and light dependence (quality).

import {
  CH,
  G,
  NN_BYTES,
  ROLE_WORDS,
  buildWorld,
  cellCount,
  clampLesionRadius,
  cloneState,
  defaultConfig,
  packLineageLo,
  ringsOf,
  worldW,
  type Founder,
  type Genome,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { GpuSim } from "@bl/sim-gpu";
import { Tracker, census, classify, individuals, type Census, type Role } from "@bl/metrics";

export interface EvalConfig {
  /** Tile side (multiple of 16 enables blocked affinity). */
  tile: number;
  /** Tiles per side of the batch world. */
  side: number;
  /** Independent replicate tiles per candidate. */
  reps: number;
  growSteps: number;
  recoverSteps: number;
  darkSteps: number;
  censusEvery: number;
  /** Disc lesion radius as a fraction of the tile (0.31 removes ~30% of area). */
  lesionFrac: number;
  world: Partial<WorldConfig>;
  nutrient: number;
  biomass: number;
  seed: number;
  /**
   * Foundations-review observers, off by default (M3 evaluations are unchanged): `roles` sums each
   * tile's per-cell catalytic fluxes over the censuses of the last 1,000 growth steps and reports
   * each genome's dominant role; `perRep` also returns every replicate tile's own values.
   */
  roles?: boolean;
  perRep?: boolean;
  /**
   * With `roles` and a `medium.background`: `"lineage"` attributes each role flux to the cell's
   * lineage instead of the whole tile, so `roleSums`/`role` describe the candidate lineage alone,
   * and the rest of the tile (the producer) is reported as `roleSumsOther` with its pre-lesion
   * bound mass as `otherMass`. Default `"tile"` (and any non-background medium) is unchanged.
   */
  roleScope?: "tile" | "lineage";
  /**
   * Conditioned medium for consumer/decomposer screens. Absent from DEFAULT_EVAL so existing
   * evaluations stay byte-identical. `waste` fills channel C; `background` seeds a producer
   * ring (large disc) under the candidate disc in every tile — measures then use the candidate
   * lineage only (see lineageMass).
   */
  medium?: { waste?: number; background?: Genome; backgroundBiomass?: number };
}

export const DEFAULT_EVAL: EvalConfig = {
  tile: 64,
  side: 8,
  reps: 4,
  growSteps: 3000,
  recoverSteps: 2000,
  darkSteps: 2000,
  censusEvery: 100,
  lesionFrac: 0.31,
  world: { defaultMu: 60, defaultSigma: 20, kernelRadius: 9, lightMode: "uniform", lightBase: 40, lightAmp: 160 },
  nutrient: 32,
  biomass: 64,
  seed: 1,
};

/**
 * An EvalConfig read back from JSON (archive.json, confirm.json). JSON.stringify writes an
 * Int8Array as {"0": …}, so a background genome's weights are rebuilt as an Int8Array here;
 * a missing or out-of-range weight throws. Configs without a background are returned as is.
 */
export function reviveEvalConfig(raw: EvalConfig): EvalConfig {
  const bg = raw.medium?.background;
  if (!bg) return raw;
  const w = bg.weights as unknown as ArrayLike<number>;
  const weights = Int8Array.from({ length: NN_BYTES }, (_, i) => {
    const v = w[i];
    if (!Number.isInteger(v) || v < -128 || v > 127) throw new Error(`reviveEvalConfig: background weight ${i} is ${v}`);
    return v;
  });
  return { ...raw, medium: { ...raw.medium, background: { mu: bg.mu, sigma: bg.sigma, motGain: bg.motGain, weights, ...(ringsOf(bg) ? { rings: ringsOf(bg) } : {}) } } };
}

/**
 * Written into confirm.json by tools/bootstrap.ts when the confirmation ran with a background genome,
 * once background genomes are encoded by index (encodeGenome). Confirmations without it ran beside a
 * ring whose controller weights were all zero.
 */
export const BACKGROUND_ENCODING = "by-index";

/**
 * Throws when `prev` (an existing confirm.json about to be extended by --resume) used a background genome
 * but predates BACKGROUND_ENCODING: its rows ran beside a zero-weight ring, so adding rows evaluated against
 * the real producer would pool two different conditions in one gate.
 */
export function checkConfirmResumable(prev: { eval?: EvalConfig; backgroundEncoding?: string } | undefined, file: string): void {
  if (prev?.eval?.medium?.background && prev.backgroundEncoding !== BACKGROUND_ENCODING)
    throw new Error(
      `${file} was confirmed before background genomes were encoded by index: its background ring had all controller weights zero, so resuming would mix those rows with rows against the real producer. Keep it as the record; copy archive.json, gate.json and viable.jsonl to a new --out and run --confirm-only there to re-confirm against the real producer.`,
    );
}

export interface Evaluation {
  /** Replicates with living bound mass after growth. */
  survived: number;
  /** Replicates whose bound mass returned to >= 90% of the pre-lesion value. */
  recovered: number;
  /**
   * Replicates whose bound mass fell below 10% of its value after light was
   * removed while a matched illuminated control kept >= 50%.
   */
  lightDependent: number;
  reps: number;
  /** Mean individuals per tile after growth. */
  individuals: number;
  /** Mean mass of individuals after growth. */
  meanMass: number;
  /** Mean speed of individuals (cells per 100 steps) during growth. */
  speed: number;
  /** Mean bound mass per tile before the lesion. */
  mass: number;
  /** Mean fraction of pre-lesion mass reached after recovery (capped at 1). */
  recovery: number;
  /**
   * Replicates whose largest individual survived a lesion removing ~30% of
   * its own area (tracked by overlap identity) and regrew to >= 90% of its mass.
   */
  regenerated: number;
  /** Fission + budding events per tile during growth. */
  reproduction: number;
  /** With `EvalConfig.roles`: catalytic fluxes summed over the genome's tiles, and their role. */
  roleSums?: RoleSums;
  role?: Role;
  /** With `roleScope: "lineage"` on a background medium: fluxes of every non-candidate lineage in the genome's tiles, and their mean bound mass per tile. */
  roleSumsOther?: RoleSums;
  otherMass?: number;
  /** With `EvalConfig.perRep`: each replicate tile's values (a dead tile has zero traits). */
  perRep?: RepEval[];
}

export interface RoleSums {
  photo: number;
  grow: number;
  decomp: number;
  resp: number;
}

export interface RepEval {
  alive: boolean;
  recovery: number;
  recovered: boolean;
  regenerated: boolean;
  lightDependent: boolean;
  individuals: number;
  meanMass: number;
  speed: number;
  mass: number;
  reproduction: number;
  roleSums?: RoleSums;
  roleSumsOther?: RoleSums;
  otherMass?: number;
}

export function quality(e: Evaluation): number {
  if (e.survived === 0) return 0;
  const regen = e.regenerated / e.reps;
  return (e.survived / e.reps) * (0.3 * e.recovery + 0.2 * (e.recovered / e.reps) + 0.5 * regen) * (0.5 + 0.5 * (e.lightDependent / e.reps));
}

/** Archive score for conditioned-medium screens: survival × recovery × light dependence; regeneration is reported, not scored. */
export function qualityMaintenance(e: Evaluation): number {
  if (e.survived === 0) return 0;
  return (e.survived / e.reps) * (0.5 * e.recovery + 0.5 * (e.recovered / e.reps)) * (0.5 + 0.5 * (e.lightDependent / e.reps));
}

function tileMass(cfg: WorldConfig, cells: Uint32Array): Float64Array {
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const out = new Float64Array(cfg.tilesX * cfg.tilesY);
  for (let i = 0; i < n; i++) {
    const x = i % W;
    const y = (i - x) / W;
    const t = Math.floor(y / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW);
    out[t] += cells[CH.B * n + i] + cells[CH.P * n + i];
  }
  return out;
}

/** Bound mass (B+P) per tile for cells whose founder lineage id is `rawId` (LIN_HI 0, LIN_LO = packLineageLo(cfg, rawId)). */
export function lineageMass(cfg: WorldConfig, cells: Uint32Array, genomeHead: Uint32Array, rawId: number): Float64Array {
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const wantLo = packLineageLo(cfg, rawId);
  const out = new Float64Array(cfg.tilesX * cfg.tilesY);
  for (let i = 0; i < n; i++) {
    if (genomeHead[G.LIN_HI * n + i] !== 0 || genomeHead[G.LIN_LO * n + i] !== wantLo) continue;
    const x = i % W;
    const y = (i - x) / W;
    const t = Math.floor(y / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW);
    out[t] += cells[CH.B * n + i] + cells[CH.P * n + i];
  }
  return out;
}

async function runChunked(device: GPUDevice, sim: GpuSim, steps: number, every: number, onCensus?: (c: Census) => void, onRoles?: (done: number, roles: () => Promise<Uint32Array>) => Promise<void>) {
  for (let s = 0; s < steps; s += every) {
    const k = Math.min(every, steps - s);
    for (let j = 0; j < k; j += 64) sim.run(Math.min(64, k - j));
    await device.queue.onSubmittedWorkDone();
    if (onCensus) {
      const [cells, genomeHead] = await Promise.all([sim.readCells(), sim.readGenomeChannels(0, 4)]);
      onCensus(census({ cfg: sim.cfg, step: sim.step, cells, genomeHead }));
    }
    if (onRoles) await onRoles(s + k, () => sim.readRoles());
  }
}

/** Adds one role-buffer readback (last step's per-cell fluxes) into per-tile sums. */
export function addTileRoles(cfg: WorldConfig, roles: Uint32Array, into: RoleSums[]): void {
  const n = cellCount(cfg);
  const W = worldW(cfg);
  for (let i = 0; i < n; i++) {
    const a = roles[i * ROLE_WORDS], b = roles[i * ROLE_WORDS + 1];
    if ((a | b) === 0) continue;
    const x = i % W;
    const t = Math.floor((i - x) / W / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW);
    const r = into[t];
    r.photo += a & 0xffff;
    r.grow += a >>> 16;
    r.decomp += b & 0xffff;
    r.resp += b >>> 16;
  }
}

/**
 * Like `addTileRoles`, but splits each cell's fluxes by lineage: cells whose founder lineage is the
 * candidate's for their tile (`candLo[tile]`, LIN_HI 0) go to `cand`, every other cell to `other`.
 */
export function addLineageRoles(cfg: WorldConfig, roles: Uint32Array, genomeHead: Uint32Array, candLo: ArrayLike<number>, cand: RoleSums[], other: RoleSums[]): void {
  const n = cellCount(cfg);
  const W = worldW(cfg);
  for (let i = 0; i < n; i++) {
    const a = roles[i * ROLE_WORDS], b = roles[i * ROLE_WORDS + 1];
    if ((a | b) === 0) continue;
    const x = i % W;
    const t = Math.floor((i - x) / W / cfg.tileH) * cfg.tilesX + Math.floor(x / cfg.tileW);
    const r = (genomeHead[G.LIN_HI * n + i] === 0 && genomeHead[G.LIN_LO * n + i] === candLo[t] ? cand : other)[t];
    r.photo += a & 0xffff;
    r.grow += a >>> 16;
    r.decomp += b & 0xffff;
    r.resp += b >>> 16;
  }
}

/** Evaluates up to side²/reps genomes in one batch world. */
export async function evaluateBatch(device: GPUDevice, genomes: Genome[], ec: EvalConfig = DEFAULT_EVAL): Promise<Evaluation[]> {
  const tiles = ec.side * ec.side;
  const perBatch = Math.floor(tiles / ec.reps);
  if (genomes.length > perBatch) throw new Error(`batch holds ${perBatch} genomes`);
  const cfg = defaultConfig({ ...ec.world, tileW: ec.tile, tileH: ec.tile, tilesX: ec.side, tilesY: ec.side, seed: ec.seed, mutRate: 0 });
  const owner = new Int32Array(tiles).fill(-1);
  const candidateRawId = new Int32Array(tiles);
  const founders: Founder[] = [];
  const bg = ec.medium?.background;
  const bgBiomass = ec.medium?.backgroundBiomass ?? ec.biomass;
  const candRadius = Math.floor(ec.tile / 6);
  const bgRadius = Math.floor(ec.tile / 3);
  genomes.forEach((g, k) => {
    for (let r = 0; r < ec.reps; r++) {
      const t = k * ec.reps + r;
      owner[t] = k;
      const x = (t % ec.side) * ec.tile + ec.tile / 2;
      const y = Math.floor(t / ec.side) * ec.tile + ec.tile / 2;
      // Background first as a larger disc. The candidate disc then overwrites the genome words at the
      // centre but ADDS its biomass and energy to the background's (buildWorld uses +=), so in a
      // background medium a candidate starts with roughly twice its own seeded mass.
      if (bg)
        founders.push({
          x,
          y,
          radius: bgRadius,
          genome: bg,
          biomass: bgBiomass,
          energy: 2 * bgBiomass,
        });
      founders.push({
        x,
        y,
        radius: candRadius,
        genome: g,
        biomass: ec.biomass,
        energy: 2 * ec.biomass,
      });
      candidateRawId[t] = founders.length; // raw lineage id = founder index + 1
    }
  });
  const init = buildWorld(cfg, { nutrient: ec.nutrient, waste: ec.medium?.waste, founders });
  const sim = await GpuSim.create(device, init);
  const tracker = new Tracker({ threshold: 48, minMass: 128 });
  const repro = new Float64Array(tiles);
  const dist = new Float64Array(tiles);
  const obs = new Float64Array(tiles);
  const last = new Map<number, [number, number]>();
  const tileOf = (x: number, y: number) => Math.floor(y / ec.tile) * ec.side + Math.floor(x / ec.tile);
  const tileRoles: RoleSums[] = Array.from({ length: tiles }, () => ({ photo: 0, grow: 0, decomp: 0, resp: 0 }));
  const byLineage = !!ec.roles && ec.roleScope === "lineage" && !!bg;
  const otherRoles: RoleSums[] = Array.from({ length: tiles }, () => ({ photo: 0, grow: 0, decomp: 0, resp: 0 }));
  const candLo = new Uint32Array(tiles);
  const onRoles = ec.roles
    ? async (done: number, read: () => Promise<Uint32Array>) => {
        if (done <= ec.growSteps - 1000) return;
        if (!byLineage) return addTileRoles(cfg, await read(), tileRoles);
        const [roles, head] = await Promise.all([read(), sim.readGenomeChannels(0, 4)]);
        addLineageRoles(cfg, roles, head, candLo, tileRoles, otherRoles);
      }
    : undefined;
  for (let t = 0; t < tiles; t++) candLo[t] = owner[t] < 0 ? 0 : packLineageLo(cfg, candidateRawId[t]);
  const candLineage = (t: number) => `0:${packLineageLo(cfg, candidateRawId[t])}`;
  const isCand = (t: number, lineage: string) => !bg || lineage === candLineage(t);
  let grown: WorldState;
  try {
    await runChunked(device, sim, ec.growSteps, ec.censusEvery, (c) => {
      for (const e of tracker.update(c)) {
        if (e.kind === "fission" || e.kind === "birth") {
          const id = e.kind === "fission" ? e.parent : e.id;
          const ind = tracker.alive.get(id);
          if (ind && isCand(tileOf(ind.cx, ind.cy), ind.lineage)) repro[tileOf(ind.cx, ind.cy)]++;
        }
      }
      for (const ind of tracker.alive.values()) {
        if (!isCand(ind.tile, ind.lineage)) continue;
        const p = last.get(ind.id);
        if (p) {
          const dx = Math.min(Math.abs(ind.cx - p[0]), ec.tile - Math.abs(ind.cx - p[0]));
          const dy = Math.min(Math.abs(ind.cy - p[1]), ec.tile - Math.abs(ind.cy - p[1]));
          const t = tileOf(ind.cx, ind.cy);
          dist[t] += Math.hypot(dx, dy) * (100 / ec.censusEvery);
          obs[t]++;
        }
        last.set(ind.id, [ind.cx, ind.cy]);
      }
    }, onRoles);
    grown = await sim.readState();
  } finally {
    sim.destroy();
  }
  const massFrom = (cells: Uint32Array, genomeHead: Uint32Array) => {
    if (!bg) return tileMass(cfg, cells);
    const out = new Float64Array(tiles);
    for (let t = 0; t < tiles; t++) {
      if (owner[t] < 0) continue;
      out[t] = lineageMass(cfg, cells, genomeHead, candidateRawId[t])[t];
    }
    return out;
  };
  const before = massFrom(grown.cells, grown.genome);
  const otherMass = byLineage ? tileMass(cfg, grown.cells).map((m, t) => m - before[t]) : undefined;
  const c0 = census({ cfg, step: grown.step, cells: grown.cells, genomeHead: grown.genome.subarray(0, cellCount(cfg) * 4) });
  const ind0 = individuals(c0, { threshold: 48, minMass: 128 }).filter((k) => isCand(k.tile, k.lineage));
  const indCount = new Float64Array(tiles);
  const indMass = new Float64Array(tiles);
  for (const k of ind0) {
    indCount[k.tile]++;
    indMass[k.tile] += k.mass;
  }

  // Lesion arm.
  const lesioned = await GpuSim.create(device, cloneState(grown));
  let afterLesion: Float64Array;
  try {
    const r = Math.floor(ec.tile * ec.lesionFrac);
    for (let t = 0; t < tiles; t++) lesioned.lesion((t % ec.side) * ec.tile + ec.tile / 2, Math.floor(t / ec.side) * ec.tile + ec.tile / 2, r);
    await runChunked(device, lesioned, ec.recoverSteps, 500);
    afterLesion = bg
      ? massFrom(...(await Promise.all([lesioned.readCells(), lesioned.readGenomeChannels(0, 4)])))
      : tileMass(cfg, await lesioned.readCells());
  } finally {
    lesioned.destroy();
  }

  // Regeneration arm: remove ~30% of each tile's largest individual (measured
  // on its own cells) and follow the surviving remnant by overlap identity.
  const regen = new Uint8Array(tiles);
  {
    const W = ec.tile * ec.side;
    const maxR = clampLesionRadius(cfg, ec.tile);
    const targetIdx = new Map<number, number>();
    for (const k of ind0) {
      const t = targetIdx.get(k.tile);
      if (t === undefined || k.mass > c0.components[t].mass) targetIdx.set(k.tile, k.idx);
    }
    const members = new Map<number, number[]>();
    for (let i = 0; i < c0.labels.length; i++) {
      const l = c0.labels[i];
      if (l >= 0) {
        const arr = members.get(l);
        if (arr) arr.push(i);
        else members.set(l, [i]);
      }
    }
    // Tile-torus distance between two cells of the same tile.
    const dist2 = (a: number, b: number) => {
      const dx = Math.abs((a % W) - (b % W)), dy = Math.abs(Math.floor(a / W) - Math.floor(b / W));
      const wx = Math.min(dx, ec.tile - dx), wy = Math.min(dy, ec.tile - dy);
      return wx * wx + wy * wy;
    };
    const plan = new Map<number, { cells: number[]; mass: number; center: number; r: number }>();
    for (const [tile, idx] of targetIdx) {
      const cells = members.get(idx) ?? [];
      const comp = c0.components[idx];
      if (cells.length < 4) continue;
      // Centre the disc on the member cell farthest from the centroid (an edge cell),
      // then grow it until it covers >= 30% of the target's own cells.
      const cxy = Math.round(comp.cy) * W + Math.round(comp.cx);
      let center = cells[0];
      for (const i of cells) if (dist2(i, cxy) > dist2(center, cxy)) center = i;
      let r = 1;
      const covered = (rr: number) => cells.filter((i) => dist2(i, center) <= rr * rr).length;
      while (r < maxR && covered(r) < 0.3 * cells.length) r++;
      if (covered(r) < 0.25 * cells.length) continue; // cannot damage it enough: not counted as regenerated
      plan.set(tile, { cells, mass: comp.mass, center, r });
    }
    const sim2 = await GpuSim.create(device, cloneState(grown));
    try {
      for (const [, p] of plan) sim2.lesion(p.center % W, Math.floor(p.center / W), p.r);
      const trk = new Tracker({ threshold: 48, minMass: 128 });
      const snap0 = await sim2.readSnapshot(false);
      const c1 = census({ cfg, step: snap0.step, cells: snap0.cells, genomeHead: snap0.genomeHead });
      trk.update(c1);
      const watch = new Map<number, { id: number; mass: number }>();
      for (const [tile, p] of plan) {
        // Remnant = post-lesion component with the largest overlap with the target's cells.
        const votes = new Map<number, number>();
        for (const i of p.cells) if (c1.labels[i] >= 0) votes.set(c1.labels[i], (votes.get(c1.labels[i]) ?? 0) + 1);
        let best = -1, n = 0;
        for (const [l, v] of votes) if (v > n) [best, n] = [l, v];
        if (best < 0) continue;
        // The lesion must actually have removed >= 20% of the target's mass.
        if (c1.components[best].mass > 0.8 * p.mass) continue;
        const id = trk.idOf(best);
        if (id !== undefined) watch.set(tile, { id, mass: p.mass });
      }
      await runChunked(device, sim2, ec.recoverSteps, 50, (c) => trk.update(c));
      for (const [tile, w] of watch) {
        const ind = trk.alive.get(w.id);
        if (ind && ind.mass >= 0.9 * w.mass) regen[tile] = 1;
      }
    } finally {
      sim2.destroy();
    }
  }

  // Dark arm with a matched illuminated control from the same grown state:
  // light dependence = dies in the dark while staying viable in the light.
  const runArm = async (armCfg: WorldConfig) => {
    const st = cloneState(grown);
    st.cfg = armCfg;
    const armSim = await GpuSim.create(device, st);
    try {
      await runChunked(device, armSim, ec.darkSteps, 500);
      if (!bg) return tileMass(cfg, await armSim.readCells());
      return massFrom(...(await Promise.all([armSim.readCells(), armSim.readGenomeChannels(0, 4)])));
    } finally {
      armSim.destroy();
    }
  };
  const afterDark = await runArm({ ...cfg, lightBase: 0, lightAmp: 0, seasonAmp: 0 });
  const afterLight = await runArm(cfg);

  return genomes.map((_, k) => {
    const ts = [...owner.keys()].filter((t) => owner[t] === k);
    const extra: Partial<Evaluation> = {};
    if (ec.roles) {
      const sums = ts.reduce((a, t) => ({ photo: a.photo + tileRoles[t].photo, grow: a.grow + tileRoles[t].grow, decomp: a.decomp + tileRoles[t].decomp, resp: a.resp + tileRoles[t].resp }), { photo: 0, grow: 0, decomp: 0, resp: 0 });
      extra.roleSums = sums;
      extra.role = classify(sums.photo, sums.grow, sums.decomp);
      if (byLineage) {
        extra.roleSumsOther = ts.reduce((a, t) => ({ photo: a.photo + otherRoles[t].photo, grow: a.grow + otherRoles[t].grow, decomp: a.decomp + otherRoles[t].decomp, resp: a.resp + otherRoles[t].resp }), { photo: 0, grow: 0, decomp: 0, resp: 0 });
        extra.otherMass = ts.reduce((a, t) => a + otherMass![t], 0) / ts.length;
      }
    }
    if (ec.perRep)
      extra.perRep = ts.map((t) => {
        const alive = before[t] > 0 && indCount[t] > 0;
        const frac = before[t] > 0 ? Math.min(1, afterLesion[t] / before[t]) : 0;
        return {
          alive,
          recovery: alive ? frac : 0,
          recovered: alive && frac >= 0.9,
          regenerated: alive && regen[t] === 1,
          lightDependent: alive && afterDark[t] < 0.1 * before[t] && afterLight[t] >= 0.5 * before[t],
          individuals: indCount[t],
          meanMass: indCount[t] > 0 ? indMass[t] / indCount[t] : 0,
          speed: obs[t] > 0 ? dist[t] / obs[t] : 0,
          mass: before[t],
          reproduction: repro[t],
          ...(ec.roles ? { roleSums: tileRoles[t] } : {}),
          ...(byLineage ? { roleSumsOther: otherRoles[t], otherMass: otherMass![t] } : {}),
        };
      });
    let survived = 0, recovered = 0, lightDep = 0, recovery = 0, inds = 0, mm = 0, sp = 0, spN = 0, mass = 0, rep = 0, reg = 0;
    for (const t of ts) {
      const alive = before[t] > 0 && indCount[t] > 0;
      if (alive) survived++;
      const frac = before[t] > 0 ? Math.min(1, afterLesion[t] / before[t]) : 0;
      if (alive) recovery += frac;
      if (alive && frac >= 0.9) recovered++;
      if (alive && afterDark[t] < 0.1 * before[t] && afterLight[t] >= 0.5 * before[t]) lightDep++;
      inds += indCount[t];
      mm += indMass[t];
      sp += dist[t];
      spN += obs[t];
      mass += before[t];
      rep += repro[t];
      if (alive) reg += regen[t];
    }
    return {
      survived,
      recovered,
      lightDependent: lightDep,
      reps: ts.length,
      individuals: inds / ts.length,
      meanMass: inds > 0 ? mm / inds : 0,
      speed: spN > 0 ? sp / spN : 0,
      mass: mass / ts.length,
      recovery: survived > 0 ? recovery / survived : 0,
      reproduction: rep / ts.length,
      regenerated: reg,
      ...extra,
    };
  });
}
