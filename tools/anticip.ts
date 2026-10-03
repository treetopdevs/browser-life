// Anticipation track: the fitness cost of unpredictability. A
// difference-in-differences over whole seed-worlds -- see docs/anticipation.md
// for the estimand, why phase-lead measurement cannot answer this question,
// and how to read the output.
//
//   deno run -A tools/anticip.ts \
//     --seeds 1,2,3,4 --period 2000 --periods-a 20 \
//     --switch-shorter 1000 --switch-longer 4000 --k 3 \
//     --out runs/anticip/<name> \
//     [--tile 256] [--founders 12] [--kernel-radius 9] \
//     [--control-level-shift] [--reps 2000] [--boot-seed 1]
//
// Phase A runs each seed to a Phase-A end-state under both arms (EVOLVED:
// ordinary mutation; FOUNDER: the existing "no-mutation" condition, same
// ecology/acclimation, no evolution) at the predictable period P. Phase B
// branches from each end-state in memory -- `{ ...state, cfg: { ...state.cfg,
// seasonPeriod } }` followed by `new RefSim(...)`, no checkpoint round-trip
// in the control-flow path -- into CONTINUE (stay at P) and SWITCH (an
// unannounced P') for both a shorter and a longer P'. Response is world
// total biomass at a fixed horizon of k*P steps post-branch; cost is
// log(respSwitch/respContinue); the anticipation index is
// cost_evolved - cost_founder per seed-world. Inference is paired across
// seeds (the unit is one whole world), never across founders within one.
//
// CPU-only (RefSim, no GPU path): see docs/anticipation.md's "how to run" for
// why, and for the mechanical RefSim -> GpuSim swap a longer, evolutionary-
// scale run would need.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import {
  M3_FOUNDERS,
  PRESETS,
  SCHEMA_VERSION,
  cloneState,
  defaultConfig,
  encodeCheckpoint,
  m3World,
  presetConfig,
  totalsOf,
  validateConfig,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { census, holm } from "@bl/metrics";
import { conditionById } from "@bl/runner";
import { anticipationIndex, bootstrapMeanCI, logCost, medianOf, onesidedWilcoxonNegative, pairSeedCosts } from "./lib/anticip-stats.ts";
import { founderAbundance, founderClusterMap } from "./lib/founder-identity.ts";
import { realizedLightMean } from "./lib/light.ts";

// Primary decision rule (docs/anticipation.md section 3): Holm adjustment
// (used below for the secondary Wilcoxon p-values) does not apply to CIs, so
// the shorter/longer family of mean CIs is instead judged with a
// Bonferroni-adjusted alpha -- 0.05 / 2 directions -- i.e. a 97.5% CI per
// direction, rather than two unadjusted marginal 95% CIs.
const PRIMARY_ALPHA = 0.025;

const SPOTS_M3 = PRESETS.find((p) => p.id === "spots-m3")!;
// + seasonPeriod, mutRate set per call in baseCfg.
const BASE_OVERRIDE = { lightAmp: 0, lightBase: 20, seasonAmp: 150 } as const;
const SWITCH_DIRS = ["shorter", "longer"] as const;
type SwitchDir = (typeof SWITCH_DIRS)[number];

// --- Config construction (pure; exported so tests can exercise this tool's
// own composition instead of re-implementing it -- see tools/test/fixtures/
// anticip-checks.ts, spawned under Deno because this file's top-level
// `jsr:` import can't be pulled into vitest/node directly). ---
export interface AnticipParams {
  tile: number;
  founders: number;
  kernelRadius: number;
  period: number;
  periodsA: number;
}

export function baseCfg(p: AnticipParams, seed: number, seasonPeriod: number, mutRate: number): WorldConfig {
  const cfg = { ...presetConfig(SPOTS_M3, seed), tileW: p.tile, tileH: p.tile, kernelRadius: p.kernelRadius, ...BASE_OVERRIDE, seasonPeriod, mutRate } as WorldConfig;
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error(`invalid config (seed ${seed}): ${errs.join("; ")}`);
  return cfg;
}
// The ordinary nonzero default -- selection and mutation both on.
export const evolvedMutRate = defaultConfig().mutRate;
// The existing no-mutation condition, not a bare `{ mutRate: 0 }` literal.
export const founderMutRate = conditionById("no-mutation").apply({} as WorldConfig).mutRate!;

export function phaseA(p: AnticipParams, seed: number, mutRate: number): WorldState {
  const cfg = baseCfg(p, seed, p.period, mutRate);
  const world = m3World(cfg, p.founders, 32, 64);
  const sim = new RefSim(world);
  for (let i = 0; i < p.period * p.periodsA; i++) sim.step();
  return sim.state;
}

export interface BranchResult {
  resp: number;
  energy: number;
  lightMean: number;
  /** The branch's full post-horizon simulation state -- not read by `main`
   * (which only needs `resp`/`energy`/`lightMean`), but exposed so
   * tools/test/fixtures/anticip-checks.ts can prove the in-memory branch
   * shortcut is state-equivalent (via `stateHash`, not just matching
   * totals) to branching from an encode/decode checkpoint round trip. */
  state: WorldState;
}
export function branch(state: WorldState, seasonPeriod: number, horizonSteps: number, lightBaseDelta = 0): BranchResult {
  const cfg = { ...state.cfg, seasonPeriod, lightBase: state.cfg.lightBase + lightBaseDelta };
  // `branch` is called several times from the same Phase-A end state (CONTINUE,
  // both SWITCH directions, optionally the level-shift control); RefSim's
  // double-buffered cells/genome arrays alias back into the state object it is
  // given after every other step, so each independent branch needs its own
  // clone rather than sharing (and silently corrupting) the source arrays.
  const sim = new RefSim({ ...cloneState(state), cfg });
  for (let i = 0; i < horizonSteps; i++) sim.step();
  const totals = totalsOf(cfg, sim.state.cells);
  return { resp: Number(totals.B), energy: Number(totals.energy), lightMean: realizedLightMean(cfg, state.step, horizonSteps), state: sim.state };
}

// --- CLI (guarded so importing this module's pure functions above, e.g. from
// a Deno test fixture, never parses Deno.args or touches the filesystem). ---
if (import.meta.main) await main();
async function main(): Promise<void> {
const a = parseArgs(Deno.args, {
  string: ["seeds", "period", "periods-a", "switch-shorter", "switch-longer", "k", "out", "tile", "founders", "kernel-radius", "reps", "boot-seed"],
  boolean: ["control-level-shift"],
  default: { tile: "256", founders: String(M3_FOUNDERS.length), "kernel-radius": "9", reps: "2000", "boot-seed": "1" },
});
function posInt(name: string, v: string | undefined): number {
  if (v === undefined) throw new Error(`--${name} is required`);
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer, got ${JSON.stringify(v)}`);
  return n;
}
if (!a.seeds) throw new Error("--seeds is required (comma-separated u32s)");
if (!a.out) throw new Error("--out is required");
const seeds = a.seeds.split(",").map((s) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error(`--seeds: ${JSON.stringify(s)} is not a u32 integer`);
  return n;
});
if (seeds.length === 0) throw new Error("--seeds must be non-empty");
if (new Set(seeds).size !== seeds.length) throw new Error(`--seeds must be distinct, got ${a.seeds}`);

const period = posInt("period", a.period);
const periodsA = posInt("periods-a", a["periods-a"]);
const k = posInt("k", a.k);
const switchShorter = posInt("switch-shorter", a["switch-shorter"]);
const switchLonger = posInt("switch-longer", a["switch-longer"]);
if (!(switchShorter < period && period < switchLonger))
  throw new Error(`--switch-shorter (${switchShorter}) must be < --period (${period}) < --switch-longer (${switchLonger})`);
const tile = posInt("tile", a.tile);
if (tile % 8 !== 0) throw new Error(`--tile must be a multiple of 8, got ${tile}`);
const founders = posInt("founders", a.founders);
if (founders > M3_FOUNDERS.length) throw new Error(`--founders must be <= ${M3_FOUNDERS.length} (M3_FOUNDERS.length); a larger request would silently repeat genomes`);
const kernelRadius = posInt("kernel-radius", a["kernel-radius"]);
if (2 * kernelRadius + 1 > tile) throw new Error(`--kernel-radius ${kernelRadius} is too large for --tile ${tile} (need 2*radius+1 <= tile)`);
// m3World places each founder with a fixed radius of 12 (packages/schema/src/world.ts),
// not configurable from here; checked up front so a too-small --tile fails
// before any physics steps run, with a message naming the actual constraint.
const M3_FOUNDER_RADIUS = 12;
if (2 * M3_FOUNDER_RADIUS + 1 > tile) throw new Error(`--tile ${tile} is too small to place an m3World founder (fixed radius ${M3_FOUNDER_RADIUS}; need --tile >= ${2 * M3_FOUNDER_RADIUS + 1})`);
const reps = posInt("reps", a.reps);
const bootSeed = posInt("boot-seed", a["boot-seed"]);
const controlLevelShift = a["control-level-shift"] as boolean;

let outExists = true;
try {
  await Deno.stat(a.out);
} catch {
  outExists = false;
}
if (outExists) throw new Error(`${a.out} already exists; this tool always writes a fresh --out directory and never resumes -- choose a different path`);
await Deno.mkdir(`${a.out}/checkpoints`, { recursive: true });

const params: AnticipParams = { tile, founders, kernelRadius, period, periodsA };
const switchPeriod: Record<SwitchDir, number> = { shorter: switchShorter, longer: switchLonger };

interface SeedRow {
  seed: number;
  collapsedPhaseA: boolean;
  /** Sum of CH.B + CH.P (a census lineage's whole `mass`, not biomass alone)
   * per M3 founder cluster at the Phase A/B boundary -- descriptive only,
   * out of the primary (biomass-only) analysis. See docs/anticipation.md
   * section 4 for the near-duplicate-genome caveat. */
  founderMassAtBoundary?: { evolved: ReturnType<typeof founderAbundance>; founder: ReturnType<typeof founderAbundance> };
  branches: Partial<
    Record<
      SwitchDir,
      {
        costEvolved: number | null;
        costFounder: number | null;
        index: number | null;
        /** Each branch's own realized mean light (`lightAt` averaged over
         * the horizon) plus the signed CONTINUE-minus-SWITCH difference --
         * not just its magnitude, so an increase and a decrease in exposure
         * are distinguishable. */
        continueLightMean: number;
        switchLightMean: number;
        lightMeanDelta: number;
        /** Secondary/descriptive: the same log-cost computed from total free-energy stock instead of biomass. */
        energyCostEvolved: number | null;
        energyCostFounder: number | null;
      }
    >
  >;
  levelShiftControl?: {
    costEvolved: number | null;
    costFounder: number | null;
    index: number | null;
    delta: number;
    applied: boolean;
    /** True when the delta-shifted config (`lightBase + delta`) fell outside
     * the valid light range (`validateConfig`); the control was not run for
     * this seed rather than crashing the whole tool run over a descriptive,
     * non-Holm-family control. See docs/anticipation.md section 4. */
    unavailable?: boolean;
    reason?: string;
  };
}

const rows: SeedRow[] = [];
const costsBySeedDir: Record<SwitchDir, { evolved: Map<number, number>; founder: Map<number, number> }> = {
  shorter: { evolved: new Map(), founder: new Map() },
  longer: { evolved: new Map(), founder: new Map() },
};
// Seeds whose Phase B response collapsed (population died out) in this
// direction, for evolved and/or founder -- excluded from `costsBySeedDir`
// and thus from inference, but counted so the report never presents
// survivor-only inference as if it covered every seed-world (see
// docs/anticipation.md section 3).
const collapsedBySeedDir: Record<SwitchDir, number[]> = { shorter: [], longer: [] };
// Seeds whose Phase A response already collapsed for either arm, before any
// branching happens -- excluded from both directions equally (Phase A has no
// switch direction of its own). Tracked separately from `collapsedBySeedDir`
// so `family.<dir>.collapsed` keeps meaning "died in this direction's Phase B
// branch" and a reader can still recover each direction's *total* exclusion
// count (`collapsed + phaseACollapsed`) from the family block alone, without
// cross-referencing `seeds[].collapsedPhaseA` (see docs/anticipation.md
// section 3).
const phaseACollapsedSeeds: number[] = [];

const startedAt = new Date().toISOString();
const t0 = performance.now();
let totalSteps = 0;
for (const seed of seeds) {
  const stateEvolved = phaseA(params, seed, evolvedMutRate);
  const stateFounder = phaseA(params, seed, founderMutRate);
  totalSteps += 2 * period * periodsA;
  await Deno.writeFile(`${a.out}/checkpoints/seed-${seed}-evolved-phaseA.blck`, encodeCheckpoint(stateEvolved));
  await Deno.writeFile(`${a.out}/checkpoints/seed-${seed}-founder-phaseA.blck`, encodeCheckpoint(stateFounder));

  const bEvolved = totalsOf(stateEvolved.cfg, stateEvolved.cells).B;
  const bFounder = totalsOf(stateFounder.cfg, stateFounder.cells).B;
  const collapsedPhaseA = !(bEvolved > 0n) || !(bFounder > 0n);
  if (collapsedPhaseA) phaseACollapsedSeeds.push(seed);
  const row: SeedRow = { seed, collapsedPhaseA, branches: {} };

  if (!collapsedPhaseA) {
    const horizon = k * period;
    const continueEvolved = branch(stateEvolved, period, horizon);
    const continueFounder = branch(stateFounder, period, horizon);
    totalSteps += 2 * horizon;

    let longerSwitchEvolvedLightMean = 0;
    for (const dir of SWITCH_DIRS) {
      const switchEvolved = branch(stateEvolved, switchPeriod[dir], horizon);
      const switchFounder = branch(stateFounder, switchPeriod[dir], horizon);
      totalSteps += 2 * horizon;
      if (dir === "longer") longerSwitchEvolvedLightMean = switchEvolved.lightMean;

      const cEvolved = logCost(continueEvolved.resp, switchEvolved.resp);
      const cFounder = logCost(continueFounder.resp, switchFounder.resp);
      const index = cEvolved.collapsed || cFounder.collapsed ? null : cEvolved.cost! - cFounder.cost!;
      const eEvolved = logCost(continueEvolved.energy, switchEvolved.energy);
      const eFounder = logCost(continueFounder.energy, switchFounder.energy);
      row.branches[dir] = {
        costEvolved: cEvolved.cost,
        costFounder: cFounder.cost,
        index,
        continueLightMean: continueEvolved.lightMean,
        switchLightMean: switchEvolved.lightMean,
        lightMeanDelta: switchEvolved.lightMean - continueEvolved.lightMean,
        energyCostEvolved: eEvolved.cost,
        energyCostFounder: eFounder.cost,
      };
      if (index !== null) {
        costsBySeedDir[dir].evolved.set(seed, cEvolved.cost!);
        costsBySeedDir[dir].founder.set(seed, cFounder.cost!);
      } else {
        collapsedBySeedDir[dir].push(seed);
      }
    }

    if (controlLevelShift) {
      // The best available control that changes light by a comparable
      // amount without changing seasonPeriod at all: a same-period
      // level shift, signed and sized to match the "longer" switch's own
      // realized light-mean change (not its magnitude -- an increase and a
      // decrease are different perturbations). This tests fragility to a
      // light *level* change in general, not specifically to a break in the
      // cycle's timing -- a different, weaker confound than the one the
      // switch treatment probes (see docs/anticipation.md's confounds
      // section). Descriptive only, not part of the Holm family below.
      // `lightBase` is an integer channel (0..255): a sub-0.5 realized
      // change (as in the documented tiny pilot) rounds to 0 and the control
      // is then not actually perturbing anything -- `applied` says so
      // explicitly rather than reporting a spurious zero-cost "control".
      const rawDelta = longerSwitchEvolvedLightMean - continueEvolved.lightMean;
      const delta = Math.sign(rawDelta) * Math.round(Math.abs(rawDelta));
      // `branch()` builds its cfg the same way (`lightBase: state.cfg.lightBase
      // + lightBaseDelta`); validate that derived cfg *before* running the
      // control's two branches, since RefSim's constructor (`validateState` ->
      // `validateConfig`) throws on an out-of-range light channel and would
      // otherwise abort this seed's entire run -- including the already-
      // computed, otherwise-valid primary shorter/longer result -- over a
      // descriptive, non-Holm-family control (docs/anticipation.md section 4).
      const levelCfg = { ...stateEvolved.cfg, seasonPeriod: period, lightBase: stateEvolved.cfg.lightBase + delta };
      const levelCfgErrs = delta === 0 ? [] : validateConfig(levelCfg);
      if (levelCfgErrs.length) {
        row.levelShiftControl = { costEvolved: null, costFounder: null, index: null, delta, applied: false, unavailable: true, reason: levelCfgErrs.join("; ") };
      } else {
        const levelEvolved = branch(stateEvolved, period, horizon, delta);
        const levelFounder = branch(stateFounder, period, horizon, delta);
        totalSteps += 2 * horizon;
        const lEvolved = logCost(continueEvolved.resp, levelEvolved.resp);
        const lFounder = logCost(continueFounder.resp, levelFounder.resp);
        row.levelShiftControl = {
          costEvolved: lEvolved.cost,
          costFounder: lFounder.cost,
          index: lEvolved.collapsed || lFounder.collapsed ? null : lEvolved.cost! - lFounder.cost!,
          delta,
          applied: delta !== 0,
        };
      }
    }

    const cfgAtBoundary = stateEvolved.cfg;
    const clusterMap = founderClusterMap(cfgAtBoundary, founders);
    const censusEvolved = census({ cfg: stateEvolved.cfg, step: stateEvolved.step, cells: stateEvolved.cells, genomeHead: stateEvolved.genome });
    const censusFounder = census({ cfg: stateFounder.cfg, step: stateFounder.step, cells: stateFounder.cells, genomeHead: stateFounder.genome });
    row.founderMassAtBoundary = {
      evolved: founderAbundance(clusterMap, censusEvolved.lineages, (l) => l.mass!),
      founder: founderAbundance(clusterMap, censusFounder.lineages, (l) => l.mass!),
    };
  }

  rows.push(row);
  const el = (performance.now() - t0) / 1000;
  console.error(`seed ${seed} done (${(totalSteps / el).toFixed(0)} st/s so far)`);
}

function familyResult(dir: SwitchDir) {
  const paired = pairSeedCosts(costsBySeedDir[dir].evolved, costsBySeedDir[dir].founder);
  const indices = paired.map(anticipationIndex);
  // PRIMARY: the mean anticipation index and its Bonferroni-adjusted 97.5%
  // bootstrap CI (docs/anticipation.md section 3) -- `ci.mean` is always
  // computed, even when `lo`/`hi` are unavailable (too few seed-worlds or
  // too few bootstrap reps), so `meanIndex` is present either way.
  const ci = bootstrapMeanCI(indices, reps, bootSeed, PRIMARY_ALPHA);
  // Descriptive only, not the primary estimand -- see `medianOf`'s doc comment.
  const medianIndex = medianOf(indices);
  // SECONDARY: a symmetric-location test, not a test of the mean -- see
  // `onesidedWilcoxonNegative`'s doc comment for why it can diverge from the
  // primary (mean) result.
  const wilcoxonP = onesidedWilcoxonNegative(indices);
  // Inference here is conditional on Phase B survival in both arms:
  // `collapsed` counts the seed-worlds this direction had to exclude because
  // one arm's Phase B branch died out; `phaseACollapsed` counts seed-worlds
  // excluded earlier still, because one arm's Phase A end-state itself never
  // survived to be branched (same count in both directions -- Phase A has no
  // switch direction). `collapsed + phaseACollapsed` is this direction's full
  // exclusion count, so a reader can see when the paired sample (`n`) is a
  // survivor subset rather than the full seed list without cross-referencing
  // `seeds[].collapsedPhaseA` (docs/anticipation.md section 3).
  return {
    n: paired.length,
    collapsed: collapsedBySeedDir[dir].length,
    phaseACollapsed: phaseACollapsedSeeds.length,
    meanIndex: ci.mean,
    medianIndex,
    wilcoxonP,
    ci: { lo: ci.lo, hi: ci.hi, status: ci.status },
  };
}

const family = { shorter: familyResult("shorter"), longer: familyResult("longer") } as const;
const holmPs = holm([family.shorter.wilcoxonP, family.longer.wilcoxonP]);

const results = {
  seeds: rows,
  family: {
    shorter: { ...family.shorter, holmP: holmPs[0] },
    longer: { ...family.longer, holmP: holmPs[1] },
  },
};
await Deno.writeTextFile(`${a.out}/results.json`, JSON.stringify(results, null, 2));

await Deno.writeTextFile(
  `${a.out}/manifest.json`,
  JSON.stringify(
    {
      args: { seeds, period, periodsA, switchShorter, switchLonger, k, tile, founders, kernelRadius, controlLevelShift, reps, bootSeed, out: a.out },
      ruleVersion: baseCfg(params, seeds[0], period, evolvedMutRate).ruleVersion,
      schemaVersion: SCHEMA_VERSION,
      preset: SPOTS_M3.id,
      baseOverride: BASE_OVERRIDE,
      startedAt,
    },
    null,
    2,
  ),
);

const wall = (performance.now() - t0) / 1000;
console.log(JSON.stringify({ wallSeconds: wall, totalSteps, stepsPerSecond: totalSteps / wall, out: a.out, family: results.family }, null, 2));
}
