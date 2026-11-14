// Cross-implementation golden test: the CPU reference and the GPU kernels
// must produce bit-identical state, ledger and mutation events. Runs in any
// WebGPU host (Chrome/Dawn, Safari, Firefox/wgpu, Deno/wgpu).

import {
  B2_OFF3,
  CH,
  GENOME_CHANNELS3,
  M3_FOUNDERS,
  MATTER_MAX,
  NN_BYTES3,
  POOL_MAX,
  POOL_MAX3,
  allocState3,
  buildWorld,
  buildWorld3,
  cellCount,
  cloneState,
  defaultConfig,
  encodeGenome3,
  founderGenome,
  generalistGenome3,
  generalistWorld,
  m3World,
  slabSpotsWorld,
  soupWorld,
  stateHash,
  totalsOf,
  ledgerResidual,
  lowbias32,
  type Genome,
  type Genome3,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim, applyLesion, createSim as createRefSim } from "@bl/sim-ref";
import { GpuSim } from "./gpu-sim.ts";
import { createSim as createGpuSim } from "./create.ts";

export interface GoldenCase {
  name: string;
  cfg: WorldConfig;
  init: (c: WorldConfig) => WorldState;
  steps: number;
  every: number;
  /** Lesion (x, y, r) applied after the first checkpoint. */
  lesion?: [number, number, number];
}

export interface GoldenResult {
  name: string;
  ok: boolean;
  steps: number;
  hash: string;
  detail: string;
  events: number;
}

/**
 * An irregular, strongly polymer-heavy field: crosses the 16383 `poly()` cap
 * in most cells and produces both positive and negative, mostly
 * non-power-of-two-divisible Sobel gradients, so the adhesion term's actual
 * gain materially changes transport (confirmed by a scratch check: with this
 * field, zero gain diverges from both explicit 64 and omitted gain from step 1;
 * a natural, lightly-built-up P field like `generalistWorld`'s does not move
 * the needle enough to tell them apart over a whole run).
 */
function irregularPolymerField(c: WorldConfig): WorldState {
  const s = buildWorld(c, { nutrient: 0, founders: [] });
  const n = c.tileW * c.tileH;
  for (let y = 0; y < c.tileH; y++)
    for (let x = 0; x < c.tileW; x++) {
      const i = y * c.tileW + x;
      s.cells[CH.P * n + i] = (37 * x * x + 91 * y + 12345) % 40000;
      s.cells[CH.B * n + i] = (17 * x + 5 * y * y) % 500;
      s.cells[CH.E * n + i] = (23 * x * y) % 2000;
    }
  return s;
}

/**
 * The M3 founders with kernel ring offsets planted (WorldConfig.shapeReach),
 * so every branch of shapeDensity runs from step 0: neutral; near rings
 * reweighted; the inner ring at weight 0 with the far ring on; neutral near
 * rings plus the far ring; the far ring alone; every weight 0 (density 0);
 * a negative far byte (weight 0) with a reweighted near ring; and offsets
 * below -64 (floored at weight 0) with the largest far weight.
 */
function ringedFounders(): Genome[] {
  const rings: [number, number, number][] = [[0, 0, 0], [20, -30, 0], [-64, 10, 40], [0, 0, 25], [-64, -64, 25], [-64, -64, 0], [10, 0, -20], [-128, -100, 127]];
  return M3_FOUNDERS.map((f, k) => ({ ...founderGenome(f), rings: rings[k % rings.length] }));
}

/** A slab config: gradient light by default (lightK set), kernel radius 3, `extra` overrides. */
function slabCfg(w: number, h: number, d: number, seed: number, extra: Partial<WorldConfig> = {}): WorldConfig {
  return defaultConfig({ tileW: w, tileH: h, tileD: d, lightK: 1024, kernelRadius: 3, seed, mutRate: 60_000_000, lightMode: "gradient", eventCap: 4096, defaultMu: 60, defaultSigma: 20, ...extra });
}

/**
 * Slab founders against both walls (z = 0 and z = D - 1, balls clipped by the closed floor and surface) plus a
 * tall biomass column through every layer at one (x, y): the column shades its own lower layers, and the wall
 * founders push matter, energy and signal at the z boundaries from step 0.
 */
function shadedColumnWorld(c: WorldConfig): WorldState {
  const D = c.tileD!;
  const g = generalistGenome3(c.defaultMu, c.defaultSigma);
  const s = buildWorld3(c, {
    nutrient: 48,
    founders: [
      { x: 6, y: 6, z: 0, radius: 3, genome: g, biomass: 64, energy: 128 },
      { x: 24 % c.tileW, y: 8, z: D - 1, radius: 3, genome: g, biomass: 64, energy: 128 },
      { x: 10, y: 22 % c.tileH, z: D >> 1, radius: 3, genome: g, biomass: 64, energy: 128 },
    ],
  });
  const n = cellCount(c);
  const x = c.tileW >> 1;
  const y = c.tileH >> 1;
  const words = Array.from({ length: s.genome.length / n }, (_, k) => s.genome[k * n + (6 * c.tileW + 6)]);
  for (let z = 0; z < D; z++) {
    const i = (z * c.tileH + y) * c.tileW + x;
    s.cells[CH.B * n + i] = 900;
    s.cells[CH.E * n + i] = 1500;
    for (let k = 0; k < words.length; k++) s.genome[k * n + i] = words[k];
  }
  return s;
}

/** A genome with every reaction output pinned to +127 through the output biases (and chosen motility biases). */
function maxGenome3(mot: [number, number, number] = [0, 0, 0], motGain = 255): Genome3 {
  const g = generalistGenome3(154, 24);
  g.motGain = motGain;
  g.weights.fill(0);
  for (let k = 0; k < 6; k++) g.weights[B2_OFF3 + k] = 127;
  for (let k = 0; k < 3; k++) g.weights[B2_OFF3 + 6 + k] = mot[k];
  return g;
}

function setCellGenome3(s: WorldState, i: number, g: Genome3, lo: number, hi = 0): void {
  const n = cellCount(s.cfg);
  const w = encodeGenome3(g, hi, lo);
  for (let k = 0; k < GENOME_CHANNELS3; k++) s.genome[k * n + i] = w[k];
}

/** A small deterministic hash stream: the same on every host. */
function hashStream(seed: number): () => number {
  let x = lowbias32(seed >>> 0);
  return () => (x = lowbias32((x + 0x9e3779b9) >>> 0));
}

/**
 * Energy at the limit. The 27 cells around `target` are living, aimed (motility bytes at the extremes, gain 255, no
 * flow term, spread 0) so that all of their E and S lands on the target cell, with E and S at POOL_MAX3 in every
 * cell: the post-transport E there is 27 * 2^27 (past 2^32 / 2 in a u32 sum), the cap24 sensor inputs are
 * saturated, and the per-cell cap at 2^27 exports the excess as heat. Removing SGZ's cap24, using the 2D pool cap
 * or losing the per-cell heat carry changes this hash.
 */
function energyStormWorld(c: WorldConfig): WorldState {
  const s = allocState3(c);
  const n = cellCount(c);
  const W = c.tileW, H = c.tileH, D = c.tileD!;
  s.cells.fill(0x808080, CH.MOT * n, (CH.MOT + 1) * n);
  const [tx, ty, tz] = [W >> 1, H >> 1, D >> 1]; // (8, 8, 4) on 16 x 16 x 8: the workgroup seam in all three axes
  const g = maxGenome3();
  const byte = (o: number) => (o < 0 ? 255 : o > 0 ? 0 : 128); // a source at offset o moves by -o
  let k = 1;
  for (let oz = -1; oz <= 1; oz++)
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const i = ((tz + oz) * H + (ty + oy)) * W + (tx + ox);
        setCellGenome3(s, i, g, k++);
        s.cells[CH.B * n + i] = 1_000_000;
        s.cells[CH.P * n + i] = 1_000_000;
        s.cells[CH.MOT * n + i] = (byte(ox) | (byte(oy) << 8) | (byte(oz) << 16)) >>> 0;
      }
  s.cells.fill(POOL_MAX3, CH.E * n, (CH.E + 1) * n);
  s.cells.fill(POOL_MAX3, CH.S * n, (CH.S + 1) * n);
  return s;
}

/**
 * Signals at the limit: random full-range controllers (every input weight live, SGX / SGY / SGZ included), living
 * cells on half the slab, and S in {2^27, 0, anything below 2^24, anything up to 2^27} cell by cell so the
 * neighbour differences straddle cap24 (2^24 - 1) in all six directions, at signalGain 127.
 */
function signalLimitWorld(c: WorldConfig): WorldState {
  const s = allocState3(c);
  const n = cellCount(c);
  const r = hashStream(c.seed ^ 0x5151);
  for (let i = 0; i < n; i++) {
    const h = r();
    if (h % 2 === 0 && i < n - 1) {
      const g = generalistGenome3(60 + (r() % 120), 12 + (r() % 40));
      g.motGain = r() % 256;
      for (let b = 0; b < NN_BYTES3; b++) g.weights[b] = (r() % 256) - 128;
      setCellGenome3(s, i, g, i + 1); // lineage (0, i + 1): one genome per id
      s.cells[CH.B * n + i] = 200 + (r() % 400);
      s.cells[CH.P * n + i] = r() % 300;
      s.cells[CH.E * n + i] = r() % 5000;
      s.cells[CH.MOT * n + i] = (1 + (r() % 255)) | ((1 + (r() % 255)) << 8) | ((1 + (r() % 255)) << 16);
    }
    const kind = r() % 4;
    s.cells[CH.S * n + i] = kind === 0 ? POOL_MAX3 : kind === 1 ? 0 : kind === 2 ? r() % (1 << 24) : r() % (POOL_MAX3 + 1);
    s.cells[CH.A * n + i] = r() % 48;
  }
  return s;
}

/**
 * Rounding boundaries of the nested shares. Half the cells are living, with B, P and E drawn from the values around
 * multiples of D1 = 2 * (32 + spread) (D1 - 1, D1, D1 + 1, 2 * D1 - 1, 3 * D1 + 1) and around 2^27 (2^27, 2^27 - 1,
 * 2^27 - D1 + 1), and motility bytes at the extremes with gain 255 and no flow term, so the displacement sits on and
 * next to +-dmax and the weights run through 0, 1, D1 - 1 and D1.
 */
function roundingWorld(c: WorldConfig): WorldState {
  const s = allocState3(c);
  const n = cellCount(c);
  const D1 = 2 * (32 + c.spread);
  const matter = [1, D1 - 1, D1, D1 + 1, 2 * D1 - 1, 3 * D1 + 1, 4999, 16381];
  const energy = [POOL_MAX3, POOL_MAX3 - 1, POOL_MAX3 - D1 + 1, POOL_MAX3 - D1, D1 - 1, 1, 12_345_678, 0];
  const motBytes = [0, 1, 127, 128, 129, 254, 255, 192];
  const r = hashStream(c.seed ^ 0x7777);
  for (let i = 0; i < n; i++) {
    if (r() % 2 !== 0 || i === n - 1) continue; // lineage lo = i + 1 must stay below the cell count
    const g = maxGenome3();
    setCellGenome3(s, i, g, i + 1);
    s.cells[CH.B * n + i] = matter[r() % matter.length];
    s.cells[CH.P * n + i] = matter[r() % matter.length];
    s.cells[CH.E * n + i] = energy[r() % energy.length];
    s.cells[CH.MOT * n + i] = (motBytes[r() % 8] | (motBytes[r() % 8] << 8) | (motBytes[r() % 8] << 16)) >>> 0;
  }
  return s;
}

function slabCases(): GoldenCase[] {
  const spots = (c: WorldConfig, count = 24) => slabSpotsWorld(c, generalistGenome3(c.defaultMu, c.defaultSigma), count, 48, 64);
  const out: GoldenCase[] = [];
  for (const [w, h, steps, every] of [[32, 32, 60, 20], [64, 64, 30, 10]] as const) {
    const t = `${w}x${h}x8`;
    const count = w === 32 ? 24 : 80;
    out.push(
      { name: `slab-default-${t}`, cfg: slabCfg(w, h, 8, 301), init: (c) => spots(c, count), steps, every },
      { name: `slab-neutral-${t}`, cfg: slabCfg(w, h, 8, 302, { neutral: true }), init: (c) => spots(c, count), steps, every },
      { name: `slab-shaded-column-${t}`, cfg: slabCfg(w, h, 8, 303), init: shadedColumnWorld, steps, every },
      {
        name: `slab-motility-signal-${t}`,
        cfg: slabCfg(w, h, 8, 304, { motility: true, signalGain: 127, kSDecay: 13, kEmit: 1024 }),
        init: (c) => spots(c, count),
        steps,
        every,
      },
      {
        name: `slab-seasons-${t}`,
        cfg: slabCfg(w, h, 8, 305, { lightMode: "uniform", lightBase: 30, lightAmp: 150, seasonPeriod: 37, seasonAmp: 60 }),
        init: (c) => spots(c, count),
        steps: Math.max(steps, 40),
        every,
      },
    );
  }
  // Arithmetic-boundary and option coverage, kept small (16 x 16 x 8, a few steps) so the CPU pins stay cheap.
  const cheapEnergy = { eA: 0, eC: 0, eB: 30, eP: 31, kResp: 4096, kDecomp: 4096, kGrow: 4096, kBuild: 4096, kEmit: 4096, kPhoto: 4096 };
  const aimed = { spread: 0, dtQ: 0, motility: true, lightBase: 55, lightAmp: 200, diffA: 256, diffC: 256, diffS: 256, mutRate: 429_497 };
  out.push(
    { name: "slab-e-saturation-16x16x8", cfg: slabCfg(16, 16, 8, 311, { ...aimed, ...cheapEnergy }), init: energyStormWorld, steps: 4, every: 2 },
    { name: "slab-signal-limit-16x16x8", cfg: slabCfg(16, 16, 8, 312, { signalGain: 127, kSDecay: 13, kEmit: 1024, motility: true }), init: signalLimitWorld, steps: 6, every: 2 },
    { name: "slab-rounding-spread8-16x16x8", cfg: slabCfg(16, 16, 8, 313, { dtQ: 0, motility: true, kResp: 4096, kPhoto: 4096, eB: 30, eP: 31 }), init: roundingWorld, steps: 6, every: 2 },
    { name: "slab-rounding-spread0-16x16x8", cfg: slabCfg(16, 16, 8, 314, { spread: 0, dtQ: 0, motility: true, kResp: 4096, kPhoto: 4096, eB: 30, eP: 31 }), init: roundingWorld, steps: 6, every: 2 },
    { name: "slab-rounding-spread32-16x16x8", cfg: slabCfg(16, 16, 8, 315, { spread: 32, dtQ: 0, motility: true, kResp: 4096, kPhoto: 4096, eB: 30, eP: 31 }), init: roundingWorld, steps: 6, every: 2 },
    {
      name: "slab-motility-off-16x16x8",
      cfg: slabCfg(16, 16, 8, 316, { motility: false, signalGain: 127, kSDecay: 13, kEmit: 1024 }),
      init: (c) => slabSpotsWorld(c, generalistGenome3(c.defaultMu, c.defaultSigma), 24, 48, 64),
      steps: 20,
      every: 10,
    },
  );
  return out;
}

export function goldenCases(): GoldenCase[] {
  const base = { tileW: 40, tileH: 40, kernelRadius: 5 };
  return [
    { name: "soup", cfg: defaultConfig({ ...base, seed: 11 }), init: (c) => soupWorld(c, 6), steps: 120, every: 20 },
    {
      name: "tiled+mutation-heavy",
      cfg: defaultConfig({ tileW: 24, tileH: 24, tilesX: 2, tilesY: 2, kernelRadius: 4, seed: 5, mutRate: 60_000_000 }),
      init: (c) => soupWorld(c, 8),
      steps: 120,
      every: 30,
    },
    {
      name: "patches+seasons",
      cfg: defaultConfig({ ...base, seed: 99, lightMode: "patches", lightBase: 20, lightAmp: 150, seasonPeriod: 37, seasonAmp: 60 }),
      init: (c) => generalistWorld(c, 4),
      steps: 120,
      every: 40,
    },
    {
      // Sandbox light mode (a rotating planet): the sun crosses the 40-cell tile
      // every 37 steps, so 120 steps cover several days and the x wrap.
      name: "sweep",
      cfg: defaultConfig({ ...base, seed: 77, lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 37 }),
      init: (c) => generalistWorld(c, 4),
      steps: 120,
      every: 40,
    },
    {
      // Sandbox signal-gradient gain on random controllers (which emit and
      // move), with a long-lived signal so gradients are large enough to clamp.
      name: "signal-gain",
      cfg: defaultConfig({ ...base, seed: 78, signalGain: 127, kSDecay: 13, kEmit: 1024 }),
      init: (c) => soupWorld(c, 6),
      steps: 120,
      every: 40,
    },
    {
      // Sandbox wandering sun: no rotation, the meridian swings 30 cells out
      // and back every 50 steps, so 120 steps cover both directions and wraps.
      name: "sweep-wander",
      cfg: defaultConfig({ ...base, seed: 79, lightMode: "sweep", lightBase: 20, lightAmp: 220, dayPeriod: 0, wanderPeriod: 50, wanderAmp: 30 }),
      init: (c) => generalistWorld(c, 4),
      steps: 120,
      every: 40,
    },
    {
      name: "lesion+stats",
      cfg: defaultConfig({ ...base, seed: 3, defaultMu: 60, defaultSigma: 20 }),
      init: (c) => generalistWorld(c, 5, 32, 64),
      steps: 90,
      every: 30,
      lesion: [20, 20, 12],
    },
    {
      name: "blocked-affinity",
      cfg: defaultConfig({ tileW: 32, tileH: 48, tilesX: 2, kernelRadius: 7, seed: 8, defaultMu: 60, defaultSigma: 20 }),
      init: (c) => soupWorld(c, 6, 32, 96),
      steps: 90,
      every: 45,
    },
    {
      // Review regression: state at the arithmetic bounds (total matter at
      // MATTER_MAX, E at POOL_MAX, maximal leak and decay) must keep the ledger
      // exact and the per-workgroup 64-bit reductions carry-correct.
      name: "extremes",
      cfg: defaultConfig({ tileW: 16, tileH: 16, kernelRadius: 3, seed: 13, kELeak: 65535, kBDecay: 65535, kAbio: 65535, eB: 30, eP: 31, eC: 1 }),
      init: (c) => {
        const s = buildWorld(c, { nutrient: 0, founders: [] });
        const n = 256;
        const per = Math.floor(MATTER_MAX / 64);
        for (let y = 4; y < 12; y++)
          for (let x = 4; x < 12; x++) {
            const i = y * 16 + x;
            s.cells[CH.B * n + i] = per;
            s.cells[CH.E * n + i] = POOL_MAX;
            s.cells[CH.S * n + i] = POOL_MAX;
          }
        return s;
      },
      steps: 20,
      every: 5,
    },
    {
      name: "neutral-shadow",
      cfg: defaultConfig({ ...base, seed: 21, neutral: true, mutRate: 20_000_000, defaultMu: 60, defaultSigma: 20 }),
      init: (c) => soupWorld(c, 6, 32, 64),
      steps: 90,
      every: 30,
    },
    {
      // Adhesion actuator (docs/plan.md decision 4, WorldConfig.adhesion): the
      // flow kernel's extra polymer-gradient term must match GPU/CPU exactly.
      name: "adhesion",
      cfg: defaultConfig({ ...base, seed: 31, adhesion: true, kAdhesion: 256, defaultMu: 60, defaultSigma: 20 }),
      init: (c) => generalistWorld(c, 5, 32, 64),
      steps: 90,
      every: 30,
    },
    {
      // Adhesion at the arithmetic boundary: P crosses the 16383 poly() cap
      // in most cells, kAdhesion is at its RANGES max (1024) together with
      // dtQ at its max (1024) and massUnit at its min (16, so massDiv = 128,
      // the smallest divisor the adhesion term ever sees) and an irregular
      // per-cell P field that produces both positive and negative, mostly
      // non-power-of-two-divisible Sobel gradients across the grid.
      name: "adhesion-extremes",
      cfg: defaultConfig({ tileW: 16, tileH: 16, kernelRadius: 3, seed: 41, adhesion: true, kAdhesion: 1024, dtQ: 1024, massUnit: 16 }),
      init: irregularPolymerField,
      steps: 20,
      every: 5,
    },
    {
      // Adhesion with kAdhesion omitted: GPU and CPU must bake in the same
      // DEFAULT_K_ADHESION fallback (see WorldConfig.adhesion), not just
      // agree when the config spells the gain out. Uses the same
      // polymer-heavy field as "adhesion-extremes" (see
      // irregularPolymerField), not a natural/generalist one: a scratch
      // check confirmed the fallback (64) vs kAdhesion:0 on a natural P
      // field are bit-identical over the whole run -- the field has to
      // actually make the gain matter for this case to test anything.
      name: "adhesion-default-gain",
      cfg: defaultConfig({ ...base, seed: 43, adhesion: true, defaultMu: 60, defaultSigma: 20 }),
      init: irregularPolymerField,
      steps: 90,
      every: 30,
    },
    {
      // Review regression: mutCap = floor(U32_MAX / mutRate) = 1, so a cell
      // synthesising exactly one quantum mutates with probability ~1/2 and
      // only larger syntheses saturate.
      name: "mutation-boundary",
      cfg: defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 4, seed: 17, mutRate: 0x80000001 }),
      init: (c) => soupWorld(c, 6),
      steps: 40,
      every: 10,
    },
    {
      // Metapopulation review P1: WorldConfig.ringNamespace must pack into
      // LIN_LO identically on GPU and CPU, for both founders (soupWorld's
      // random-genome founders, id (0, founderIndex+1)) and mutations (a high
      // mutRate, like "tiled+mutation-heavy", so several are actually born
      // during the run) -- see packLineageLo (@bl/schema).
      name: "ring-namespace",
      cfg: defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 4, seed: 23, mutRate: 60_000_000, ringNamespace: 7 }),
      init: (c) => soupWorld(c, 8),
      steps: 120,
      every: 30,
    },
    {
      // Lossy takeover (WorldConfig.takeover, ownership sandbox): the 12 M3
      // founders (distinct lineages and mu/sigma) in contact, with mutation,
      // so non-kin bound shares become waste and release energy into E.
      name: "takeover-lineage",
      cfg: defaultConfig({ ...base, seed: 51, mutRate: 60_000_000, takeover: "lossy", takeoverKin: "lineage" }),
      init: (c) => m3World(c, 12, 32, 64),
      steps: 120,
      every: 30,
    },
    {
      // As "takeover-lineage" with kin = mu/sigma within a tolerance.
      name: "takeover-growth",
      cfg: defaultConfig({ ...base, seed: 53, mutRate: 60_000_000, takeover: "lossy", takeoverKin: "growth", takeoverTol: 8 }),
      init: (c) => m3World(c, 12, 32, 64),
      steps: 120,
      every: 30,
    },
    {
      // Recurring injury (WorldConfig.injuryPeriod, ownership sandbox): every
      // 7th step about 1 cell in 150 centres a radius-2 wound, on founders in
      // contact with mutation, so wounds overlap bodies, tile edges and each other.
      name: "injury",
      cfg: defaultConfig({ ...base, seed: 59, mutRate: 60_000_000, injuryPeriod: 7, injuryRadius: 2, injuryProb: 28_633_115 }),
      init: (c) => m3World(c, 12, 32, 64),
      steps: 120,
      every: 30,
    },
    {
      // Polymer shell (WorldConfig.injuryShell): the "injury" world with a
      // shell of 2 polymer, so wounds both spare shelled cells (P >= shell:
      // the wound takes exactly the shell, B, E and lineage stay) and lesion
      // thin ones (P < shell), as test/injury.test.ts checks.
      name: "injury-shell",
      cfg: defaultConfig({ ...base, seed: 59, mutRate: 60_000_000, injuryPeriod: 7, injuryRadius: 2, injuryProb: 28_633_115, injuryShell: 2 }),
      init: (c) => m3World(c, 12, 32, 64),
      steps: 120,
      every: 30,
    },
    {
      // As "takeover-lineage" with kin = at most 1 differing genome word, so
      // single mutants stay kin to their parents and founders do not.
      name: "takeover-genome",
      cfg: defaultConfig({ ...base, seed: 57, mutRate: 60_000_000, takeover: "lossy", takeoverKin: "genome", takeoverTol: 1 }),
      init: (c) => m3World(c, 12, 32, 64),
      steps: 120,
      every: 30,
    },
    {
      // Injury review (Codex, 2026-10-03): injury at the arithmetic bounds and
      // across tiles. Two 16 x 16 tiles; half the left one holds
      // MATTER_MAX / 256 polymer per cell with E at POOL_MAX and the widest
      // energy gap, so one wound exports far more than 2^32 heat through the
      // 64-bit reductions, and wounds of radius 7 (the largest a 16-cell tile
      // allows) wrap inside their own tile, every other step. The right tile
      // holds a founder, so a wound leaking across tiles would show.
      name: "injury-extremes",
      cfg: defaultConfig({ tileW: 16, tileH: 16, tilesX: 2, kernelRadius: 3, seed: 71, eB: 30, eP: 31, eC: 1, injuryPeriod: 2, injuryRadius: 7, injuryProb: 2 ** 32 / 64 }),
      init: (c) => {
        const s = buildWorld(c, { nutrient: 0, founders: [{ x: 24, y: 8, radius: 5, genome: founderGenome(M3_FOUNDERS[0]), biomass: 64, energy: 128 }] });
        const n = 512;
        const per = Math.floor(MATTER_MAX / 256);
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 8; x++) {
            const i = y * 32 + (x < 4 ? x : x + 8);
            s.cells[CH.P * n + i] = per;
            s.cells[CH.E * n + i] = POOL_MAX;
          }
        return s;
      },
      steps: 12,
      every: 4,
    },
    {
      // Heritable shape (WorldConfig.shapeReach, cells sandbox) with a far
      // ring, on 2x2-blocked affinity (tiles a multiple of 16): ringed
      // founders in contact, with mutation reaching the three ring slots.
      name: "shape-far",
      cfg: defaultConfig({ tileW: 48, tileH: 48, kernelRadius: 5, seed: 61, mutRate: 60_000_000, shapeReach: 8 }),
      init: (c) => m3World(c, 12, 32, 64, ringedFounders()),
      steps: 120,
      every: 30,
    },
    {
      // As "shape-far" without a far ring (shapeReach == kernelRadius: two
      // rings, the third byte inert) and on unblocked affinity.
      name: "shape-near",
      cfg: defaultConfig({ ...base, seed: 67, mutRate: 60_000_000, shapeReach: 5 }),
      init: (c) => m3World(c, 12, 32, 64, ringedFounders()),
      steps: 120,
      every: 30,
    },
    {
      // Wild sandbox: every optional lever in one config (a rotating and
      // wandering sun with seasons, signal gain, recurring wounds and a
      // far-ring heritable shape), which no single sandbox's cases combine.
      name: "wild-stack",
      cfg: defaultConfig({
        tileW: 48, tileH: 48, kernelRadius: 5, seed: 83, mutRate: 60_000_000,
        lightMode: "sweep", lightBase: 20, lightAmp: 170, dayPeriod: 37, wanderPeriod: 50, wanderAmp: 30, seasonPeriod: 37, seasonAmp: 60,
        signalGain: 127, kSDecay: 13, kEmit: 1024,
        injuryPeriod: 7, injuryRadius: 2, injuryProb: 28_633_115,
        shapeReach: 8,
      }),
      init: (c) => m3World(c, 12, 32, 64, ringedFounders()),
      steps: 120,
      every: 30,
    },
    {
      // Capability genes (WorldConfig.genes, the game kernel line): the M3
      // founders in contact, every other one carrying the decomposition gene
      // so the gate and the gene's maintenance run from step 0, with heavy
      // mutation and half of all events flipping the gene, so gains and losses
      // both happen within 120 steps.
      name: "genes-decomp",
      cfg: defaultConfig({ ...base, seed: 89, mutRate: 60_000_000, genes: "decomp", kGene: 100, geneFlip: 2 ** 31 }),
      init: (c) => m3World(c, 12, 32, 64, M3_FOUNDERS.map((f, k) => ({ ...founderGenome(f), ...(k % 2 ? { genes: 1 } : {}) }))),
      steps: 120,
      every: 30,
    },
    {
      // Genes at the arithmetic bounds: one gene-carrying founder whose cells
      // hold MATTER_MAX / 128 biomass each with E at POOL_MAX, kGene, kMaint
      // and kCost at their maxima (the cost sum's three terms at once) and
      // every mutation event a flip, so carriers lose the gene mid-run too.
      name: "genes-bounds",
      cfg: defaultConfig({ tileW: 16, tileH: 16, kernelRadius: 3, seed: 97, eB: 30, eP: 31, eC: 1, kGene: 65535, kMaint: 65535, kCost: 65535, mutRate: 60_000_000, genes: "decomp", geneFlip: 2 ** 32 - 1 }),
      init: (c) => {
        const s = buildWorld(c, { nutrient: 0, founders: [{ x: 8, y: 8, radius: 5, genome: { ...founderGenome(M3_FOUNDERS[0]), genes: 1 }, biomass: 64, energy: 128 }] });
        const n = 256;
        const per = Math.floor(MATTER_MAX / 128);
        for (let i = 0; i < n; i++)
          if (s.cells[CH.B * n + i] > 0) {
            s.cells[CH.B * n + i] = per;
            s.cells[CH.C * n + i] = 4096;
            s.cells[CH.E * n + i] = POOL_MAX;
          }
        return s;
      },
      steps: 20,
      every: 5,
    },
    {
      // The "ladder" gene set (decomposition and polymer building): as
      // "genes-decomp", with the founders carrying none, decomposition only,
      // building only and both genes in turn, so both gates and the cost of
      // one and of two carried genes run from step 0, and flips touch either bit.
      name: "genes-ladder",
      cfg: defaultConfig({ ...base, seed: 91, mutRate: 60_000_000, genes: "ladder", kGene: 100, geneFlip: 2 ** 31 }),
      init: (c) => m3World(c, 12, 32, 64, M3_FOUNDERS.map((f, k) => ({ ...founderGenome(f), ...(k % 4 ? { genes: k % 4 } : {}) }))),
      steps: 120,
      every: 30,
    },
    {
      // As "genes-bounds" under the "ladder" set with the founder carrying
      // both genes: the three cost terms at their maximum rate constants plus
      // two carried genes on heavy biomass, and every mutation event a flip.
      name: "genes-ladder-bounds",
      cfg: defaultConfig({ tileW: 16, tileH: 16, kernelRadius: 3, seed: 101, eB: 30, eP: 31, eC: 1, kGene: 65535, kMaint: 65535, kCost: 65535, mutRate: 60_000_000, genes: "ladder", geneFlip: 2 ** 32 - 1 }),
      init: (c) => {
        const s = buildWorld(c, { nutrient: 0, founders: [{ x: 8, y: 8, radius: 5, genome: { ...founderGenome(M3_FOUNDERS[0]), genes: 3 }, biomass: 64, energy: 128 }] });
        const n = 256;
        const per = Math.floor(MATTER_MAX / 128);
        for (let i = 0; i < n; i++)
          if (s.cells[CH.B * n + i] > 0) {
            s.cells[CH.B * n + i] = per;
            s.cells[CH.C * n + i] = 4096;
            s.cells[CH.E * n + i] = POOL_MAX;
          }
        return s;
      },
      steps: 20,
      every: 5,
    },
    {
      // Gene v2 (WorldConfig.geneDrive): as "genes-ladder" with a floor of 32
      // on build carriers' BUILD output. M3 founders 5, 8, 10 and 11 put 0 on
      // BUILD over the whole probe grid, so founder 10 (genes 2) builds only
      // through the floor and the floor's branch runs from step 0.
      name: "genes-drive",
      cfg: defaultConfig({ ...base, seed: 103, mutRate: 60_000_000, genes: "ladder", kGene: 100, geneFlip: 2 ** 31, geneDrive: 32 }),
      init: (c) => m3World(c, 12, 32, 64, M3_FOUNDERS.map((f, k) => ({ ...founderGenome(f), ...(k % 4 ? { genes: k % 4 } : {}) }))),
      steps: 120,
      every: 30,
    },
    {
      // As "genes-ladder-bounds" with the floor at its maximum 127: the
      // building capacity and the work term at the largest rectified output
      // on heavy biomass, with the three cost terms at their maxima. The floor
      // turns the biomass to polymer, so there are no births and no flips here;
      // "genes-ladder-bounds" covers flips at these costs.
      name: "genes-drive-bounds",
      cfg: defaultConfig({ tileW: 16, tileH: 16, kernelRadius: 3, seed: 107, eB: 30, eP: 31, eC: 1, kGene: 65535, kMaint: 65535, kCost: 65535, mutRate: 60_000_000, genes: "ladder", geneFlip: 2 ** 32 - 1, geneDrive: 127 }),
      init: (c) => {
        const s = buildWorld(c, { nutrient: 0, founders: [{ x: 8, y: 8, radius: 5, genome: { ...founderGenome(M3_FOUNDERS[0]), genes: 3 }, biomass: 64, energy: 128 }] });
        const n = 256;
        const per = Math.floor(MATTER_MAX / 128);
        for (let i = 0; i < n; i++)
          if (s.cells[CH.B * n + i] > 0) {
            s.cells[CH.B * n + i] = per;
            s.cells[CH.C * n + i] = 4096;
            s.cells[CH.E * n + i] = POOL_MAX;
          }
        return s;
      },
      steps: 20,
      every: 5,
    },
    ...slabCases(),
  ];
}

export async function runGolden(device: GPUDevice, log: (s: string) => void = () => {}): Promise<GoldenResult[]> {
  const results: GoldenResult[] = [];
  for (const gc of goldenCases()) {
    const init = gc.init(gc.cfg);
    const start = totalsOf(gc.cfg, init.cells);
    const ref = createRefSim(cloneState(init));
    const gpu = await createGpuSim(device, cloneState(init));
    let ok = true;
    let detail = "";
    let refEvents: string[] = [];
    let gpuEvents: string[] = [];
    let hash = "";
    try {
      for (let s = 0; s < gc.steps && ok; s += gc.every) {
        for (let k = 0; k < gc.every; k++) for (const e of ref.step().events) refEvents.push(`${e.childHi}:${e.childLo}<${e.parentHi}:${e.parentLo}`);
        gpu.run(gc.every);
        const snap = await gpu.drainLedger();
        for (const e of snap.events) gpuEvents.push(`${e.childHi}:${e.childLo}<${e.parentHi}:${e.parentLo}`);
        const g = await gpu.readState();
        const hr = stateHash(ref.state);
        const hg = stateHash(g);
        hash = hg;
        const resid = ledgerResidual(start, g);
        if (hr !== hg) {
          ok = false;
          detail = `hash mismatch at step ${ref.state.step}: ref ${hr} gpu ${hg}; ${firstDiff(ref.state, g)}`;
        } else if (g.lightIn !== ref.state.lightIn || g.heatOut !== ref.state.heatOut) {
          ok = false;
          detail = `ledger mismatch at step ${ref.state.step}: light ${ref.state.lightIn}/${g.lightIn} heat ${ref.state.heatOut}/${g.heatOut}`;
        } else if (g.flux.some((f, k) => f !== ref.state.flux[k])) {
          ok = false;
          detail = `flux mismatch at step ${ref.state.step}: ref ${ref.state.flux.join(",")} gpu ${g.flux.join(",")}`;
        } else if (!sameWords(await gpu.readRoles(), ref.roles)) {
          ok = false;
          detail = `role buffer mismatch at step ${ref.state.step}`;
        } else if (resid !== 0n) {
          ok = false;
          detail = `energy residual ${resid} at step ${ref.state.step}`;
        } else if (snap.dropped > 0) {
          ok = false;
          detail = `dropped ${snap.dropped} events`;
        } else {
          const t = totalsOf(gc.cfg, ref.state.cells);
          const st = await gpu.readStats();
          if (st.A !== t.A || st.B !== t.B || st.C !== t.C || st.P !== t.P || st.E !== t.E || st.S !== t.S) {
            ok = false;
            detail = `stats reduction mismatch at step ${ref.state.step}`;
          }
        }
        if (ok && gc.lesion && s === 0) {
          const [lx, ly, lr] = gc.lesion;
          // Lesions are 2D only: a slab has no lesion rule (GpuSim3 has no lesion()).
          if (!(ref instanceof RefSim) || !(gpu instanceof GpuSim)) throw new Error(`golden case ${gc.name}: lesion on a slab`);
          applyLesion(ref, lx, ly, lr);
          gpu.lesion(lx, ly, lr);
        }
      }
      refEvents = refEvents.sort();
      gpuEvents = gpuEvents.sort();
      if (ok && refEvents.join() !== gpuEvents.join()) {
        ok = false;
        detail = `event mismatch: ref ${refEvents.length} gpu ${gpuEvents.length}`;
      }
    } finally {
      gpu.destroy();
    }
    const r = { name: gc.name, ok, steps: gc.steps, hash, detail: detail || "bit-exact", events: refEvents.length };
    log(`${ok ? "PASS" : "FAIL"} ${gc.name} (${gc.steps} steps, ${r.events} mutations, hash ${hash}) ${detail}`);
    results.push(r);
  }
  return results;
}

function sameWords(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
}

function firstDiff(a: WorldState, b: WorldState): string {
  const n = cellCount(a.cfg);
  for (let k = 0; k < a.cells.length; k++)
    if (a.cells[k] !== b.cells[k]) return `cells ch${Math.floor(k / n)} cell ${k % n}: ${a.cells[k]} vs ${b.cells[k]}`;
  for (let k = 0; k < a.genome.length; k++)
    if (a.genome[k] !== b.genome[k]) return `genome ch${Math.floor(k / n)} cell ${k % n}: ${a.genome[k]} vs ${b.genome[k]}`;
  return "no cell diff (step counter?)";
}
