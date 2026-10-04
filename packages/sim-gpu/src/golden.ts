// Cross-implementation golden test: the CPU reference and the GPU kernels
// must produce bit-identical state, ledger and mutation events. Runs in any
// WebGPU host (Chrome/Dawn, Safari, Firefox/wgpu, Deno/wgpu).

import {
  CH,
  M3_FOUNDERS,
  MATTER_MAX,
  POOL_MAX,
  buildWorld,
  cloneState,
  defaultConfig,
  founderGenome,
  generalistWorld,
  m3World,
  soupWorld,
  stateHash,
  totalsOf,
  ledgerResidual,
  type Genome,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim, applyLesion } from "@bl/sim-ref";
import { GpuSim } from "./gpu-sim.ts";

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
  ];
}

export async function runGolden(device: GPUDevice, log: (s: string) => void = () => {}): Promise<GoldenResult[]> {
  const results: GoldenResult[] = [];
  for (const gc of goldenCases()) {
    const init = gc.init(gc.cfg);
    const start = totalsOf(gc.cfg, init.cells);
    const ref = new RefSim(cloneState(init));
    const gpu = await GpuSim.create(device, cloneState(init));
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
  const n = a.cells.length / 7;
  for (let k = 0; k < a.cells.length; k++)
    if (a.cells[k] !== b.cells[k]) return `cells ch${Math.floor(k / n)} cell ${k % n}: ${a.cells[k]} vs ${b.cells[k]}`;
  for (let k = 0; k < a.genome.length; k++)
    if (a.genome[k] !== b.genome[k]) return `genome ch${Math.floor(k / n)} cell ${k % n}: ${a.genome[k]} vs ${b.genome[k]}`;
  return "no cell diff (step counter?)";
}
