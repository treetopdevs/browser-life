// Information-theoretic individuality vs. genetic/component individuality
// (docs/individuality-info-theory.md). Runs R independent replicate analysis
// worlds (same config and founder layout, different seeds) of a small
// CPU-reference (RefSim) run, tracks components/collectives/genetic clusters
// with the existing census/tracker/collectives machinery through a fixed
// window-start step, then analyses three FIXED aggregate kinds over a fixed
// window that follows -- a genetic cluster anchored to an M3 founder, a
// tracked component alive throughout, and a colony (founder clusters linked
// at window start) -- against a cross-world null and a bootstrap-over-worlds
// CI. A disagreement table, not a verdict. Held out: nothing here feeds any
// search objective (docs/individuality-info-theory.md).
//
// Additionally runs C independent CALIBRATION worlds (same config/founder
// layout, seeds disjoint from every analysis world -- see
// CALIBRATION_SEED_OFFSET below) whose ONLY job is fitting the quantile bins
// that turn each anchor's raw feature history into S/E symbols. Those bins
// are then frozen and reused, unchanged, for every analysis world, the
// bootstrap-over-worlds CI, and the cross-world null -- see
// docs/individuality-info-theory.md §3 for why bins must never be fit (or
// refit) from the same data being bootstrapped or permuted.
//
//   deno run -A tools/individuality.ts --worlds 12 --window-start 600 \
//     --window-steps 250 --tile 64 --founders 6 --seed 1 \
//     [--calibration-worlds 4] [--out runs/individuality/<label>] \
//     [--bootstrap-draws 2000] [--ring-width 6]
//
// Each world (analysis or calibration) runs `window-start` steps to let the
// colony settle (census/Tracker/CollectiveTracker every step), snapshots
// which aggregates exist at that instant, then runs `window-steps` more
// steps recording raw features for every aggregate that survives the window
// intact. An anchor that never exists at window start, or that stops meeting
// its own definition mid-window (dies -- every kind; or, for a component
// specifically, fissions/fuses -- see docs/individuality-info-theory.md §4
// for why genetic clusters/colonies are NOT excluded on a component-tracker
// fission/fusion event), is excluded for that world (not spliced back
// together). For analysis worlds this is counted in the anchor's
// `excludedWorlds` -- eligible plus excluded always sums to WORLDS for every
// aggregate kind, including a colony composition that simply never forms in
// a given world.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import {
  buildWorld,
  CH,
  cellCount,
  defaultConfig,
  founderGenome,
  G,
  lineageKey,
  M3_FOUNDERS,
  packLineageLo,
  type Founder,
  type WorldConfig,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import {
  aggregateFeatures,
  applyQuantileBins,
  buildWorldTrajectory,
  census,
  CollectiveTracker,
  DEFAULT_CENSUS,
  DEFAULT_COLLECTIVES,
  environmentFeatures,
  fitQuantileBins,
  holm,
  individualityReport,
  MIN_CALIBRATED_WORLDS,
  Tracker,
  type IndividualityResult,
  type QuantileBinner,
  type WorldTrajectory,
} from "@bl/metrics";
import { CLUSTER_DISTANCE, geneticClusters } from "@bl/search";

const a = parseArgs(Deno.args, {
  string: ["window-start", "window-steps", "worlds", "calibration-worlds", "bootstrap-draws", "tile", "founders", "seed", "out", "ring-width"],
  default: {
    "window-start": "600",
    "window-steps": "250",
    worlds: "12",
    "calibration-worlds": "4",
    "bootstrap-draws": "2000",
    tile: "64",
    founders: "6",
    seed: "1",
    out: "",
    "ring-width": "6",
  },
});
const WINDOW_START = Number(a["window-start"]);
const WINDOW_STEPS = Number(a["window-steps"]);
const WORLDS = Number(a.worlds);
const CALIBRATION_WORLDS = Number(a["calibration-worlds"]);
const BOOTSTRAP_DRAWS = Number(a["bootstrap-draws"]);
const TILE = Number(a.tile);
const FOUNDER_COUNT = Math.max(4, Math.min(Number(a.founders), 6));
const SEED = Number(a.seed);
const RING_WIDTH = Number(a["ring-width"]);
const OUT = a.out || `runs/individuality/${new Date().toISOString().replace(/[:.]/g, "-")}`;

// Calibration worlds' seeds must never collide with an analysis world's seed
// (SEED..SEED+WORLDS-1) -- otherwise a calibration world could BE an analysis
// world, silently reintroducing the "bins fit on the same data being
// analysed" bug this rework removes. A large fixed offset (not derived from
// WORLDS) guarantees disjointness for any realistic --worlds value without
// requiring the two ranges to be checked against each other at runtime.
const CALIBRATION_SEED_OFFSET = 900_000_001;
if (CALIBRATION_WORLDS < 2) {
  console.error(`--calibration-worlds must be >= 2 (bins need >=1 world's worth of variation to fit a quantile spread from), got ${CALIBRATION_WORLDS}`);
  Deno.exit(1);
}

// Two coarse-graining profiles (§3.2/§6 of the doc): the default bin-count
// profile and a coarser sensitivity check, applied to the SAME raw feature
// histories (no re-simulation).
const PROFILES = {
  default: { S_BINS: { logMass: 3, membraneFraction: 2, photoShare: 2 }, E_BINS: { meanLight: 3, meanNutrientA: 2 } },
  coarse: { S_BINS: { logMass: 2, membraneFraction: 2, photoShare: 2 }, E_BINS: { meanLight: 2, meanNutrientA: 2 } },
} as const;
type ProfileName = keyof typeof PROFILES;
type BinCounts = (typeof PROFILES)[ProfileName]["S_BINS"];
type EBinCounts = (typeof PROFILES)[ProfileName]["E_BINS"];

function alphabets(name: ProfileName): { sAlphabet: number; eAlphabet: number } {
  const { S_BINS, E_BINS } = PROFILES[name];
  return { sAlphabet: S_BINS.logMass * S_BINS.membraneFraction * S_BINS.photoShare, eAlphabet: E_BINS.meanLight * E_BINS.meanNutrientA };
}

// Sample-size floor: average occupancy >= 2 samples/cell on the largest
// table |S|*|E|*|S'| at the default profile, i.e. T >= 2*|S|*|E|*|S'|. This
// is a PER-WORLD floor, not worlds*T: every MI table is fit once per world
// from that world's own T observations (bootstrapOverWorlds/crossWorldNull
// never pool raw symbols across worlds -- see packages/metrics/src/
// individuality.ts's doc comments), so running more worlds improves the
// precision of the mean across worlds but adds nothing to any single
// table's occupancy. T (the number of (S,E,S') triples per world) is
// window-steps - 1, not window-steps: `--window-steps` records that many S
// points, but the last one is consumed only as S's own successor (S'),
// never paired with its own E as a full triple. A warning, not a hard
// failure -- a global run-design check, not a per-anchor pass/fail.
const T_EFFECTIVE = WINDOW_STEPS - 1;
{
  const { sAlphabet, eAlphabet } = alphabets("default");
  const floor = 2 * sAlphabet * eAlphabet * sAlphabet;
  const have = T_EFFECTIVE;
  console.log(`sample-size floor at the default profile (|S|=${sAlphabet}, |E|=${eAlphabet}): need PER-WORLD (window-steps-1) >= ${floor}, have ${have} per world (running more worlds does not raise this).`);
  if (have < floor) console.error(`warning: below the recommended per-world floor -- each fitted table is sparse; estimates may be unreliable.`);
}

// --out refuses to reuse an existing directory, checked before any of the
// now-expensive R-world work.
try {
  await Deno.stat(OUT);
  throw new Error(`${OUT} already exists -- choose a different --out`);
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
}

// --- Founder/geometry construction: fixed across all worlds, only each
// world's sim seed differs. Colony triangle (side ~8, radius 3 -> disks well
// clear of each other, centres <= linkDist=10 apart) plus isolated founders
// far from it and from each other (>> linkDist), scaled to --tile. ---
const geomCfg: WorldConfig = defaultConfig({ ruleVersion: 1, tileW: TILE, tileH: TILE, tilesX: 1, tilesY: 1, kernelRadius: 5, lightMode: "gradient", mutRate: 0 });
const n = cellCount(geomCfg);

const scale = TILE / 64;
const positions: [number, number][] = [
  [16 * scale, 16 * scale],
  [24 * scale, 16 * scale],
  [20 * scale, 23 * scale],
  [48 * scale, 10 * scale],
  [10 * scale, 48 * scale],
  [48 * scale, 48 * scale],
].map(([x, y]) => [Math.round(x), Math.round(y)]);

const founders: Founder[] = [];
for (let i = 0; i < FOUNDER_COUNT; i++) {
  const [x, y] = positions[i];
  founders.push({ x, y, radius: i < 3 ? Math.max(3, Math.round(3 * scale)) : Math.max(4, Math.round(4 * scale)), genome: founderGenome(M3_FOUNDERS[i]), biomass: 256, energy: 512 });
}

// Fail loudly on any pairwise founder-disk overlap rather than letting
// buildWorld silently let the later-processed founder overwrite an earlier
// one's genome in the overlap region. Verified non-overlapping at --tile 64.
for (let i = 0; i < founders.length; i++) {
  for (let j = i + 1; j < founders.length; j++) {
    const dxRaw = Math.abs(founders[i].x - founders[j].x) % TILE;
    const dyRaw = Math.abs(founders[i].y - founders[j].y) % TILE;
    const dx = Math.min(dxRaw, TILE - dxRaw);
    const dy = Math.min(dyRaw, TILE - dyRaw);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const rsum = founders[i].radius + founders[j].radius;
    if (dist < rsum) {
      console.error(`founder ${i} and founder ${j} disks overlap at --tile ${TILE} (centre distance ${dist.toFixed(2)} < combined radius ${rsum}) -- rerun at --tile 64 or larger.`);
      Deno.exit(1);
    }
  }
}

const clusterOfFounder = geneticClusters(founders.map((f) => f.genome), CLUSTER_DISTANCE);
// packLineageLo is independent of `seed` (only `ringNamespace`, unset here),
// so lineage identity is fixed across all worlds -- computed once.
const lineageKeyOfFounder = founders.map((_, i) => lineageKey(0, packLineageLo(geomCfg, i + 1)));
const clusterOfLineageKey = new Map<string, number>();
lineageKeyOfFounder.forEach((k, i) => clusterOfLineageKey.set(k, clusterOfFounder[i]));
console.log(`founders: ${FOUNDER_COUNT}, genetic clusters among them: ${new Set(clusterOfFounder).size} (${clusterOfFounder.join(",")})`);
if (new Set(clusterOfFounder.slice(0, 3)).size < 2) {
  console.error("colony founders (indices 0-2) do not span >=2 genetic clusters -- fix founder selection");
  Deno.exit(1);
}

interface Point {
  logMass: number;
  membraneFraction: number;
  photoShare: number;
  meanLight: number;
  meanNutrientA: number;
}
const FEATURE_KEYS = ["logMass", "membraneFraction", "photoShare", "meanLight", "meanNutrientA"] as const;
function finitePoint(p: Point): boolean {
  return FEATURE_KEYS.every((k) => Number.isFinite(p[k]));
}

/** Per-world outcome for one anchor: its full T-point history, `"excluded"` (a candidate that was invalidated mid-window), or `undefined` (never a candidate in this world). */
type Outcome = Point[] | "excluded" | undefined;

interface WorldOutcome {
  geneticCluster: Map<number, Outcome>; // founderIdx -> outcome
  component: Map<number, Outcome>; // founderIdx -> outcome
  colony: Map<string, { clusters: number[]; outcome: Exclude<Outcome, undefined> }>; // colonyKey -> outcome (always a candidate if present)
}

/**
 * Runs one independent replicate world: window-start settling, snapshot
 * eligible anchors, then window-steps of recording. Takes the RAW sim seed
 * directly (not a world index) so the same function serves both analysis
 * worlds (seed = SEED + w) and calibration worlds (seed = SEED +
 * CALIBRATION_SEED_OFFSET + c) -- everything else about the run (geometry,
 * founders, window-start/window-steps) is identical between the two.
 */
function runWorld(seed: number): WorldOutcome {
  const cfg: WorldConfig = defaultConfig({ ruleVersion: 1, seed, tileW: TILE, tileH: TILE, tilesX: 1, tilesY: 1, kernelRadius: 5, lightMode: "gradient", mutRate: 0 });
  const world = buildWorld(cfg, { nutrient: 256, founders });
  const sim = new RefSim(world);
  const tracker = new Tracker(DEFAULT_CENSUS);
  const collectiveTracker = new CollectiveTracker({ ...DEFAULT_COLLECTIVES, tileW: cfg.tileW, tileH: cfg.tileH });

  const clustersOfCells = (cells: number[]): number[] => {
    const set = new Set<number>();
    for (const i of cells) {
      const hi = sim.state.genome[G.LIN_HI * n + i];
      const lo = sim.state.genome[G.LIN_LO * n + i];
      if (hi === 0 && lo === 0) continue;
      const cl = clusterOfLineageKey.get(lineageKey(hi, lo));
      if (cl !== undefined) set.add(cl);
    }
    return [...set].sort((x, y) => x - y);
  };

  // --- Phase 1: settle, running census/Tracker/CollectiveTracker every step
  // from step 0 (identity continuity must never be voted on a coarser
  // cadence, and must start at the true initial state -- a --window-start 0
  // run still needs the trackers seeded before the window-start snapshot below). ---
  let c = census({ cfg, step: 0, cells: sim.state.cells, genomeHead: sim.state.genome }, DEFAULT_CENSUS);
  tracker.update(c);
  collectiveTracker.update(0, tracker.alive.values());
  for (let step = 1; step <= WINDOW_START; step++) {
    sim.step();
    c = census({ cfg, step, cells: sim.state.cells, genomeHead: sim.state.genome }, DEFAULT_CENSUS);
    tracker.update(c);
    collectiveTracker.update(step, tracker.alive.values());
  }

  const idxToId0 = new Map<number, number>();
  for (let idx = 0; idx < c.components.length; idx++) {
    const id = tracker.idOf(idx);
    if (id !== undefined) idxToId0.set(idx, id);
  }
  const cellsByIndividual0 = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const id = c.labels[i] >= 0 ? idxToId0.get(c.labels[i]) : undefined;
    if (id === undefined) continue;
    let arr = cellsByIndividual0.get(id);
    if (!arr) cellsByIndividual0.set(id, (arr = []));
    arr.push(i);
  }

  // Genetic-cluster eligibility (>=1 living cell of founder i's lineage) and
  // the component majority-overlap anchor (the single Tracker individual
  // holding a STRICT majority of founder i's living lineage mass, among
  // components containing >=1 cell of it; undefined if no such majority).
  const geneticEligible = new Set<number>();
  const componentAnchor = new Map<number, number>();
  for (let fi = 0; fi < FOUNDER_COUNT; fi++) {
    const key = lineageKeyOfFounder[fi];
    let totalMass = 0;
    const massByComponent = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const hi = sim.state.genome[G.LIN_HI * n + i];
      const lo = sim.state.genome[G.LIN_LO * n + i];
      if (hi === 0 && lo === 0 || lineageKey(hi, lo) !== key) continue;
      const mass = sim.state.cells[CH.B * n + i] + sim.state.cells[CH.P * n + i];
      totalMass += mass;
      const id = c.labels[i] >= 0 ? idxToId0.get(c.labels[i]) : undefined;
      if (id !== undefined) massByComponent.set(id, (massByComponent.get(id) ?? 0) + mass);
    }
    if (totalMass <= 0) continue;
    geneticEligible.add(fi);
    for (const [id, mass] of massByComponent) if (mass > totalMass / 2) componentAnchor.set(fi, id);
  }

  // Colony candidates: founder-clusters linked (>=3 members, >=2 clusters)
  // at this instant. CollectiveTracker is never queried again after this.
  const colonyCandidates = new Map<string, number[]>();
  for (const [, coll] of collectiveTracker.alive) {
    if (coll.members.size < 3) continue;
    const cells: number[] = [];
    for (const memberId of coll.members) cells.push(...(cellsByIndividual0.get(memberId) ?? []));
    const clusters = clustersOfCells(cells);
    if (clusters.length >= 2) colonyCandidates.set(clusters.join(","), clusters);
  }

  // --- Phase 2: record raw features for every surviving candidate. A
  // colony's mask is the fixed union of its founder-clusters' own masks --
  // decoupled from CollectiveTracker/component identity for the rest of the
  // window, per the architecture note in docs/individuality-info-theory.md. ---
  const geneticActive = new Set(geneticEligible);
  const componentActive = new Map(componentAnchor);
  const colonyActive = new Map(colonyCandidates);
  const geneticHistory = new Map<number, Point[]>([...geneticActive].map((fi) => [fi, []]));
  const componentHistory = new Map<number, Point[]>([...componentActive.keys()].map((fi) => [fi, []]));
  const colonyHistory = new Map<string, Point[]>([...colonyActive.keys()].map((k) => [k, []]));

  for (let step = WINDOW_START + 1; step <= WINDOW_START + WINDOW_STEPS; step++) {
    sim.step();
    c = census({ cfg, step, cells: sim.state.cells, genomeHead: sim.state.genome }, DEFAULT_CENSUS);
    const trackerEvents = tracker.update(c);

    for (const ev of trackerEvents) {
      if (ev.kind === "fission") {
        for (const [fi, id] of componentActive) if (id === ev.parent) componentActive.delete(fi);
      } else if (ev.kind === "fusion") {
        for (const [fi, id] of componentActive) if (id === ev.child) componentActive.delete(fi);
      }
    }
    for (const [fi, id] of componentActive) if (!tracker.alive.has(id)) componentActive.delete(fi);

    if (geneticActive.size === 0 && componentActive.size === 0 && colonyActive.size === 0) break; // nothing left to record in this world

    const idxToId = new Map<number, number>();
    for (let idx = 0; idx < c.components.length; idx++) {
      const id = tracker.idOf(idx);
      if (id !== undefined) idxToId.set(idx, id);
    }
    const cellsByIndividual = new Map<number, number[]>();
    const cellsByCluster = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const id = c.labels[i] >= 0 ? idxToId.get(c.labels[i]) : undefined;
      if (id !== undefined) {
        let arr = cellsByIndividual.get(id);
        if (!arr) cellsByIndividual.set(id, (arr = []));
        arr.push(i);
      }
      const hi = sim.state.genome[G.LIN_HI * n + i];
      const lo = sim.state.genome[G.LIN_LO * n + i];
      if (hi === 0 && lo === 0) continue;
      const cl = clusterOfLineageKey.get(lineageKey(hi, lo));
      if (cl === undefined) continue;
      let arr2 = cellsByCluster.get(cl);
      if (!arr2) cellsByCluster.set(cl, (arr2 = []));
      arr2.push(i);
    }
    const light = (x: number, y: number) => sim.light(x, y, step);
    const featuresOf = (cells: number[]): Point => {
      const mask = new Uint8Array(n);
      for (const i of cells) mask[i] = 1;
      const sf = aggregateFeatures(cfg, sim.state.cells, sim.roles, mask);
      const ef = environmentFeatures(cfg, sim.state.cells, mask, light, RING_WIDTH);
      return { logMass: sf.logMass, membraneFraction: sf.membraneFraction, photoShare: sf.photoShare, meanLight: ef.meanLight, meanNutrientA: ef.meanNutrientA };
    };

    for (const fi of geneticActive) {
      const p = featuresOf(cellsByCluster.get(clusterOfFounder[fi]) ?? []);
      if (!finitePoint(p)) geneticActive.delete(fi);
      else geneticHistory.get(fi)!.push(p);
    }
    for (const [fi, id] of componentActive) {
      const p = featuresOf(cellsByIndividual.get(id) ?? []);
      if (!finitePoint(p)) componentActive.delete(fi);
      else componentHistory.get(fi)!.push(p);
    }
    for (const [key, clusters] of colonyActive) {
      // A colony is the FIXED set of founder-clusters linked at window
      // start; if any one of them has no living cells left this step, the
      // colony as originally defined no longer exists and must be excluded
      // outright -- silently flatMapping over the survivors would keep
      // reporting a shrunken colony under the original key, which is exactly
      // the mid-window membership change the fixed-aggregate rule forbids.
      if (clusters.some((cl) => !cellsByCluster.has(cl))) {
        colonyActive.delete(key);
        continue;
      }
      const cells = clusters.flatMap((cl) => cellsByCluster.get(cl)!);
      const p = featuresOf(cells);
      if (!finitePoint(p)) colonyActive.delete(key);
      else colonyHistory.get(key)!.push(p);
    }
  }

  const geneticCluster = new Map<number, Outcome>();
  for (let fi = 0; fi < FOUNDER_COUNT; fi++) {
    geneticCluster.set(fi, geneticEligible.has(fi) ? (geneticActive.has(fi) ? geneticHistory.get(fi)! : "excluded") : undefined);
  }
  const component = new Map<number, Outcome>();
  for (let fi = 0; fi < FOUNDER_COUNT; fi++) {
    component.set(fi, componentAnchor.has(fi) ? (componentActive.has(fi) ? componentHistory.get(fi)! : "excluded") : undefined);
  }
  const colony = new Map<string, { clusters: number[]; outcome: Exclude<Outcome, undefined> }>();
  for (const [key, clusters] of colonyCandidates) {
    colony.set(key, { clusters, outcome: colonyActive.has(key) ? colonyHistory.get(key)! : "excluded" });
  }
  return { geneticCluster, component, colony };
}

// --- Run every world (analysis and calibration alike), aggregating each
// anchor's per-world outcome. `worldIndices[i]` names the world
// `histories[i]` came from -- needed so the disagreement table (below) can
// match definitions on a common eligible-world population by world identity,
// not just by count. For analysis worlds, `excludedWorlds` is always the
// derived `WORLDS - histories.length`: every world not present in
// `histories` was ineligible for this exact anchor (never a candidate at
// window start, died/fissioned/fused mid-window, or -- for a colony -- simply
// never formed in that world), so eligible+excluded sums to WORLDS for every
// anchor kind without visiting worlds that never mention it. ---
interface AnchorAgg {
  founders: number[];
  histories: Point[][];
  worldIndices: number[];
}

/** Runs `seeds.length` independent worlds and aggregates every anchor's per-world outcome, the same aggregation shape for analysis and calibration worlds alike. `allPoints` is every recorded (t,t+1) feature point from every anchor of every kind across all of `seeds` -- the pooled fallback bin-fitting source (see `frozenBinsFor` below). */
function runWorldsAndAggregate(
  seeds: readonly number[],
  label: string,
): { geneticAgg: Map<number, AnchorAgg>; componentAgg: Map<number, AnchorAgg>; colonyAgg: Map<string, AnchorAgg>; allPoints: Point[] } {
  const geneticAgg = new Map<number, AnchorAgg>();
  const componentAgg = new Map<number, AnchorAgg>();
  const colonyAgg = new Map<string, AnchorAgg>();
  for (let fi = 0; fi < FOUNDER_COUNT; fi++) {
    geneticAgg.set(fi, { founders: [fi], histories: [], worldIndices: [] });
    componentAgg.set(fi, { founders: [fi], histories: [], worldIndices: [] });
  }
  const allPoints: Point[] = [];
  seeds.forEach((seed, w) => {
    console.log(`${label} world ${w + 1}/${seeds.length} (seed ${seed})...`);
    const outcome = runWorld(seed);
    for (const [fi, res] of outcome.geneticCluster) {
      if (res !== "excluded" && res !== undefined) {
        geneticAgg.get(fi)!.histories.push(res);
        geneticAgg.get(fi)!.worldIndices.push(w);
        allPoints.push(...res);
      }
    }
    for (const [fi, res] of outcome.component) {
      if (res !== "excluded" && res !== undefined) {
        componentAgg.get(fi)!.histories.push(res);
        componentAgg.get(fi)!.worldIndices.push(w);
        allPoints.push(...res);
      }
    }
    for (const [key, { clusters, outcome: res }] of outcome.colony) {
      let agg = colonyAgg.get(key);
      if (!agg) colonyAgg.set(key, (agg = { founders: clusters, histories: [], worldIndices: [] }));
      if (res !== "excluded") {
        agg.histories.push(res);
        agg.worldIndices.push(w);
        allPoints.push(...res);
      }
    }
  });
  return { geneticAgg, componentAgg, colonyAgg, allPoints };
}

const analysisSeeds = Array.from({ length: WORLDS }, (_, w) => SEED + w);
const { geneticAgg, componentAgg, colonyAgg } = runWorldsAndAggregate(analysisSeeds, "analysis");

const calibrationSeeds = Array.from({ length: CALIBRATION_WORLDS }, (_, c) => CALIBRATION_SEED_OFFSET + SEED + c);
const {
  geneticAgg: calibGeneticAgg,
  componentAgg: calibComponentAgg,
  colonyAgg: calibColonyAgg,
  allPoints: calibAllPoints,
} = runWorldsAndAggregate(calibrationSeeds, "calibration");

// --- Fit shared quantile bins ONLY from the calibration worlds above (never
// from analysis histories), then freeze them -- docs/individuality-info-theory.md
// §3. Per anchor identity (same founder index, or the same colony
// composition) when that exact anchor was itself eligible in
// >=MIN_CALIBRATION_WORLDS_FOR_ANCHOR calibration worlds; otherwise falls
// back to bins fit on EVERY calibration-world point pooled together (every
// kind, every anchor, every calibration world) for that feature. Fallback,
// not exclusion: logMass/membraneFraction/photoShare/meanLight/meanNutrientA
// are per-cell physical summaries with the same meaning and scale regardless
// of which founder or colony produced them, so pooling across anchors for
// the fallback does not mix incomparable quantities, and it keeps every
// analysis anchor answerable rather than dropping a row the run would
// otherwise report -- e.g. exactly a small-R colony composition that may not
// recur in only a handful of calibration worlds even though it recurred in
// several analysis worlds. Bins fit once here are used for that anchor's
// point estimate, its bootstrap-over-worlds CI (which only resamples
// analysis worlds, never touches bins), and its cross-world null (which only
// permutes analysis worlds' E, also never touching bins). ---
const MIN_CALIBRATION_WORLDS_FOR_ANCHOR = 2;

function fitBinsFromPoints(points: readonly Point[], sBins: BinCounts, eBins: EBinCounts) {
  const pooled: Record<(typeof FEATURE_KEYS)[number], number[]> = { logMass: [], membraneFraction: [], photoShare: [], meanLight: [], meanNutrientA: [] };
  for (const p of points) for (const k of FEATURE_KEYS) pooled[k].push(p[k]);
  return {
    sBin: {
      logMass: fitQuantileBins(pooled.logMass, sBins.logMass),
      membraneFraction: fitQuantileBins(pooled.membraneFraction, sBins.membraneFraction),
      photoShare: fitQuantileBins(pooled.photoShare, sBins.photoShare),
    },
    eBin: {
      meanLight: fitQuantileBins(pooled.meanLight, eBins.meanLight),
      meanNutrientA: fitQuantileBins(pooled.meanNutrientA, eBins.meanNutrientA),
    },
  };
}

interface FrozenBins {
  sBin: { logMass: QuantileBinner; membraneFraction: QuantileBinner; photoShare: QuantileBinner };
  eBin: { meanLight: QuantileBinner; meanNutrientA: QuantileBinner };
  /** `"anchor"`: fit from this exact anchor's own calibration-world histories. `"global-fallback"`: fit from every calibration-world point pooled together (this anchor had too few, or zero, eligible calibration worlds). */
  source: "anchor" | "global-fallback";
  /** Eligible calibration worlds this exact anchor had (0 if it never appeared in calibration at all); reported regardless of which `source` was used. */
  calibrationWorlds: number;
}

function frozenBinsFor(calibAgg: AnchorAgg | undefined, name: ProfileName): FrozenBins {
  const { S_BINS, E_BINS } = PROFILES[name];
  const calibrationWorlds = calibAgg?.histories.length ?? 0;
  if (calibrationWorlds >= MIN_CALIBRATION_WORLDS_FOR_ANCHOR) {
    const { sBin, eBin } = fitBinsFromPoints(calibAgg!.histories.flat(), S_BINS, E_BINS);
    return { sBin, eBin, source: "anchor", calibrationWorlds };
  }
  const { sBin, eBin } = fitBinsFromPoints(calibAllPoints, S_BINS, E_BINS);
  return { sBin, eBin, source: "global-fallback", calibrationWorlds };
}

function binsByProfileFor(calibAgg: AnchorAgg | undefined): Record<ProfileName, FrozenBins> {
  const out = {} as Record<ProfileName, FrozenBins>;
  for (const name of Object.keys(PROFILES) as ProfileName[]) out[name] = frozenBinsFor(calibAgg, name);
  return out;
}

const geneticBins = new Map<number, Record<ProfileName, FrozenBins>>();
for (const fi of geneticAgg.keys()) geneticBins.set(fi, binsByProfileFor(calibGeneticAgg.get(fi)));
const componentBins = new Map<number, Record<ProfileName, FrozenBins>>();
for (const fi of componentAgg.keys()) componentBins.set(fi, binsByProfileFor(calibComponentAgg.get(fi)));
const colonyBins = new Map<string, Record<ProfileName, FrozenBins>>();
for (const key of colonyAgg.keys()) colonyBins.set(key, binsByProfileFor(calibColonyAgg.get(key)));

function symbolizeS(p: Point, bin: FrozenBins["sBin"], bins: BinCounts): number {
  const a1 = applyQuantileBins(p.logMass, bin.logMass), a2 = applyQuantileBins(p.membraneFraction, bin.membraneFraction), a3 = applyQuantileBins(p.photoShare, bin.photoShare);
  return (a1 * bins.membraneFraction + a2) * bins.photoShare + a3;
}
function symbolizeE(p: Point, bin: FrozenBins["eBin"], bins: EBinCounts): number {
  return applyQuantileBins(p.meanLight, bin.meanLight) * bins.meanNutrientA + applyQuantileBins(p.meanNutrientA, bin.meanNutrientA);
}

/** Symbolizes `histories` (which may be a restricted subset, e.g. the disagreement table's common-worlds intersection) into WorldTrajectories using the given, already-FROZEN `bins` -- no fitting happens here. */
function symbolizeHistories(histories: readonly Point[][], bins: FrozenBins, name: ProfileName): WorldTrajectory[] {
  const { S_BINS, E_BINS } = PROFILES[name];
  const { sAlphabet, eAlphabet } = alphabets(name);
  return histories.map((hist) => {
    const sSymbols = hist.map((p) => symbolizeS(p, bins.sBin, S_BINS));
    const eSymbols = hist.slice(0, -1).map((p) => symbolizeE(p, bins.eBin, E_BINS));
    return buildWorldTrajectory(sSymbols, eSymbols, sAlphabet, eAlphabet);
  });
}

/**
 * Builds the individuality report for one anchor at one profile from ANALYSIS
 * `histories` and already-frozen `bins` (fit only from calibration worlds,
 * above). `individualityReport`'s own bootstrap-over-worlds CI resamples
 * these analysis worlds with replacement but never refits `bins`, and its
 * cross-world null permutes which analysis world's E accompanies which
 * world's S/S' but also never refits `bins` -- both are exactly why the bins
 * must be independent of `histories` in the first place (fitting bins from
 * data that includes duplicated or permuted analysis worlds would fit each
 * resampled/permuted world more tightly than an independent fit could,
 * biasing every derived plug-in-MI quantity upward; see
 * docs/individuality-info-theory.md §3 for the bug this replaces).
 */
function buildProfileReport(histories: Point[][], name: ProfileName, seed: number, excludedWorlds: number, bins: FrozenBins): IndividualityResult {
  const { sAlphabet, eAlphabet } = alphabets(name);
  const worlds = symbolizeHistories(histories, bins, name);
  return individualityReport(worlds, sAlphabet, eAlphabet, { bootstrapDraws: BOOTSTRAP_DRAWS, seed, excludedWorlds });
}

function analyzeAnchor(agg: AnchorAgg, seed: number, binsByProfile: Record<ProfileName, FrozenBins>): Partial<Record<ProfileName, IndividualityResult>> {
  const out: Partial<Record<ProfileName, IndividualityResult>> = {};
  if (agg.histories.length < 2) return out;
  const excludedWorlds = WORLDS - agg.histories.length;
  for (const name of Object.keys(PROFILES) as ProfileName[]) out[name] = buildProfileReport(agg.histories, name, seed, excludedWorlds, binsByProfile[name]);
  return out;
}

interface AnchorRow {
  kind: "genetic-cluster" | "component" | "colony";
  id: string;
  founders: number[];
  worlds: number;
  excludedWorlds: number;
  profiles: Partial<Record<ProfileName, IndividualityResult>>;
  /** Which calibration data fitted this anchor's bins, per profile -- see `frozenBinsFor`. */
  binSource: Record<ProfileName, { source: "anchor" | "global-fallback"; calibrationWorlds: number }>;
}
function binSourceSummary(bins: Record<ProfileName, FrozenBins>): AnchorRow["binSource"] {
  const out = {} as AnchorRow["binSource"];
  for (const name of Object.keys(PROFILES) as ProfileName[]) out[name] = { source: bins[name].source, calibrationWorlds: bins[name].calibrationWorlds };
  return out;
}
const rows: AnchorRow[] = [];
for (const [fi, agg] of geneticAgg) {
  const bins = geneticBins.get(fi)!;
  rows.push({ kind: "genetic-cluster", id: String(fi), founders: agg.founders, worlds: agg.histories.length, excludedWorlds: WORLDS - agg.histories.length, profiles: analyzeAnchor(agg, 1_000_000 + fi, bins), binSource: binSourceSummary(bins) });
}
for (const [fi, agg] of componentAgg) {
  const bins = componentBins.get(fi)!;
  rows.push({ kind: "component", id: String(fi), founders: agg.founders, worlds: agg.histories.length, excludedWorlds: WORLDS - agg.histories.length, profiles: analyzeAnchor(agg, 2_000_000 + fi, bins), binSource: binSourceSummary(bins) });
}
let colonyIdx = 0;
for (const [key, agg] of colonyAgg) {
  const bins = colonyBins.get(key)!;
  rows.push({ kind: "colony", id: key, founders: agg.founders, worlds: agg.histories.length, excludedWorlds: WORLDS - agg.histories.length, profiles: analyzeAnchor(agg, 3_000_000 + colonyIdx++, bins), binSource: binSourceSummary(bins) });
}

// --- Disagreement table: for each founder, pair its genetic-cluster reading
// against its component reading and against each colony sharing its cluster,
// PAIRWISE -- each pair restricted to the intersection of the two
// definitions' own eligible-world sets (matched by world identity, not just
// count) and both sides of the pair recomputed on exactly that intersection.
// Pairwise, not one n-way intersection across every definition at once: two
// colony compositions sharing a founder are typically mutually exclusive
// per world (whichever grouping the founder's clusters actually formed that
// world), so requiring all of them plus genetic-cluster and component to
// share one common set would collapse to empty even when each PAIR overlaps
// substantially -- exactly the kind of uncontrolled-population comparison
// this table exists to avoid. A pair sharing fewer than 2 common worlds is
// skipped, not compared. ---
interface AnchorGroupMember {
  kind: "component" | "colony";
  id: string;
  agg: AnchorAgg;
}
interface Disagreement {
  founder: number;
  otherKind: "component" | "colony";
  otherId: string;
  worlds: number; // worlds common to both sides of this pair
  geneticAutonomyStar: number;
  otherAutonomyStar: number;
  geneticNonClosurePoint: number;
  otherNonClosurePoint: number;
  geneticNonClosureP: number;
  otherNonClosureP: number;
}
const disagreements: Disagreement[] = [];
const disagreementSkipped: string[] = [];
for (let fi = 0; fi < FOUNDER_COUNT; fi++) {
  const gAgg = geneticAgg.get(fi)!;
  if (gAgg.histories.length < 2) continue; // no genetic-cluster baseline to compare against for this founder
  const others: AnchorGroupMember[] = [];
  const cAgg = componentAgg.get(fi)!;
  if (cAgg.histories.length >= 2) others.push({ kind: "component", id: String(fi), agg: cAgg });
  for (const [key, agg] of colonyAgg) {
    if (agg.founders.includes(clusterOfFounder[fi]) && agg.histories.length >= 2) others.push({ kind: "colony", id: key, agg });
  }
  const gWorlds = new Set(gAgg.worldIndices);
  const restrictTo = (agg: AnchorAgg, common: Set<number>) => agg.worldIndices.map((w, i) => [w, agg.histories[i]] as const).filter(([w]) => common.has(w)).map(([, hist]) => hist);
  for (const other of others) {
    const common = new Set(other.agg.worldIndices.filter((w) => gWorlds.has(w)));
    if (common.size < 2) {
      disagreementSkipped.push(`founder ${fi}: genetic-cluster (${gAgg.histories.length} eligible) and ${other.kind} ${other.id} (${other.agg.histories.length} eligible) share only ${common.size} world(s)`);
      continue;
    }
    // Reuses the SAME frozen bins as that anchor's main row above (fit only
    // from calibration worlds, never from this restricted analysis subset) --
    // the disagreement table compares two definitions on a controlled
    // analysis-world population, not two different binnings.
    const otherBins = other.kind === "component" ? componentBins.get(Number(other.id))! : colonyBins.get(other.id)!;
    const gRes = buildProfileReport(restrictTo(gAgg, common), "default", 9_000_000 + fi, 0, geneticBins.get(fi)!.default);
    const oRes = buildProfileReport(restrictTo(other.agg, common), "default", 9_500_000 + fi, 0, otherBins.default);
    disagreements.push({
      founder: fi,
      otherKind: other.kind,
      otherId: other.id,
      worlds: common.size,
      geneticAutonomyStar: gRes.autonomyStar.point,
      otherAutonomyStar: oRes.autonomyStar.point,
      geneticNonClosurePoint: gRes.nonClosure.ci.point,
      otherNonClosurePoint: oRes.nonClosure.ci.point,
      geneticNonClosureP: gRes.nonClosure.nullTest.p,
      otherNonClosureP: oRes.nonClosure.nullTest.p,
    });
  }
}

// Holm correction across the FULL declared family of cross-world-null tests
// this run actually computes: nonClosure, PID uniqueE and PID synergy, at
// BOTH coarse-graining profiles, for every aggregate with >=2 eligible
// worlds. Earlier versions of this correction covered only the default
// profile's nonClosure column (a fraction of the true family), which
// understates the true family size and overstates significance -- e.g. one
// row's default-profile nonClosure p can look Holm-significant when
// adjusted against 9 tests but not against the 54 actually run. The
// disagreement table above recomputes some of these same quantities on
// restricted, pairwise-matched world subsets; those are a different
// (smaller, non-independent) population answering a different question
// ("do two definitions on the same worlds disagree") and are reported
// separately, uncorrected, as an exploratory diagnostic -- folding them
// into this family would both double-count the main-row tests they revisit
// and mix two different world populations under one correction.
type NullQuantity = "nonClosure" | "pidUniqueE" | "pidSynergy";
const NULL_QUANTITIES: NullQuantity[] = ["nonClosure", "pidUniqueE", "pidSynergy"];
function nullTestOf(r: IndividualityResult, q: NullQuantity) {
  return q === "nonClosure" ? r.nonClosure.nullTest : q === "pidUniqueE" ? r.pid.uniqueE.nullTest : r.pid.synergy.nullTest;
}
interface FamilyMember {
  row: AnchorRow;
  profile: ProfileName;
  quantity: NullQuantity;
}
const family: FamilyMember[] = [];
for (const r of rows) {
  for (const profile of Object.keys(PROFILES) as ProfileName[]) {
    const res = r.profiles[profile];
    if (!res) continue;
    for (const quantity of NULL_QUANTITIES) family.push({ row: r, profile, quantity });
  }
}
const familyPAdj = holm(family.map((m) => nullTestOf(m.row.profiles[m.profile]!, m.quantity).p));
type HolmByQuantity = Record<NullQuantity, number>;
const holmByRowProfile = new Map<AnchorRow, Partial<Record<ProfileName, HolmByQuantity>>>();
family.forEach((m, i) => {
  let byProfile = holmByRowProfile.get(m.row);
  if (!byProfile) holmByRowProfile.set(m.row, (byProfile = {}));
  let byQuantity = byProfile[m.profile];
  if (!byQuantity) byProfile[m.profile] = byQuantity = {} as HolmByQuantity;
  byQuantity[m.quantity] = familyPAdj[i];
});
console.log(`Holm correction applied across ${family.length} tests (every aggregate x profile x {nonClosure, PID uniqueE, PID synergy} with >=2 eligible worlds).`);
// Default profile's nonClosure column specifically, used by the headline table below -- one member of the full family Holm-corrected above, not a separate correction.
const nonClosurePAdjByRow = new Map(rows.map((r) => [r, holmByRowProfile.get(r)?.default?.nonClosure ?? null]));

// --- Write the report. No wall-clock timestamp: byte-identical across
// identically-seeded reruns (a `new Date()` embedded in the Markdown would
// make that false). The run is identified by its own config line instead. ---
await Deno.mkdir(OUT, { recursive: true });

// `status` on a BootstrapCI is `"ci"` (coverage-checked reasonable at
// R>=MIN_CALIBRATED_WORLDS) or `"uncalibrated"` (coverage measurably poor
// below it, per packages/metrics/test/individuality.test.ts and
// docs/individuality-info-theory.md §3) -- render the same [lower, upper]
// numbers either way, but never call an uncalibrated one a confidence
// interval.
function fmtCI(ci: { lower: number; upper: number; status: "ci" | "uncalibrated" }): string {
  const range = `[${ci.lower.toFixed(3)}, ${ci.upper.toFixed(3)}]`;
  return ci.status === "ci" ? range : `${range} (uncalibrated resampling range, not a CI)`;
}

const binFallbacks = rows.flatMap((r) => Object.values(r.binSource)).filter((b) => b.source === "global-fallback").length;
const binTotal = rows.flatMap((r) => Object.values(r.binSource)).length;
console.log(
  `calibration bins: ${binTotal - binFallbacks}/${binTotal} anchor x profile combinations fit from that exact anchor's own calibration-world histories; ${binFallbacks} fell back to the pooled-all-calibration-anchors bins (fewer than ${MIN_CALIBRATION_WORLDS_FOR_ANCHOR} eligible calibration worlds for that exact anchor).`,
);

const report = {
  config: {
    windowStart: WINDOW_START,
    windowSteps: WINDOW_STEPS,
    worlds: WORLDS,
    calibrationWorlds: CALIBRATION_WORLDS,
    bootstrapDraws: BOOTSTRAP_DRAWS,
    tile: TILE,
    founders: FOUNDER_COUNT,
    seed: SEED,
    ringWidth: RING_WIDTH,
  },
  calibrationSeeds,
  minCalibratedWorlds: MIN_CALIBRATED_WORLDS,
  profiles: { default: alphabets("default"), coarse: alphabets("coarse") },
  founderGeneticClusters: clusterOfFounder,
  // holmFamilySize: the full declared family this run's Holm correction was
  // computed across (every aggregate x profile x null-tested quantity with
  // >=2 eligible worlds) -- every p-value under `nullTestsHolm` below was
  // adjusted against this same family, not a per-row or per-quantity subset.
  holmFamilySize: family.length,
  rows: rows.map((r) => ({ ...r, nullTestsHolm: holmByRowProfile.get(r) ?? {} })),
  disagreements,
  disagreementSkipped,
};
await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

const md: string[] = [];
md.push("# Individuality run");
md.push("");
md.push(
  `window-start=${WINDOW_START} window-steps=${WINDOW_STEPS} worlds=${WORLDS} calibration-worlds=${CALIBRATION_WORLDS} bootstrap-draws=${BOOTSTRAP_DRAWS} tile=${TILE} founders=${FOUNDER_COUNT} seed=${SEED} ring-width=${RING_WIDTH}`,
);
md.push(`founder genetic clusters: ${clusterOfFounder.join(",")}. Default profile |S|=${alphabets("default").sAlphabet} |E|=${alphabets("default").eAlphabet}; coarse profile |S|=${alphabets("coarse").sAlphabet} |E|=${alphabets("coarse").eAlphabet}.`);
md.push(
  `Quantile bins are fit ONLY from ${CALIBRATION_WORLDS} calibration worlds (seeds ${calibrationSeeds.join(",")} -- disjoint from the ${WORLDS} analysis worlds' seeds ${SEED}..${SEED + WORLDS - 1}) and then frozen: the bootstrap-over-worlds CI and the cross-world null below both resample/permute only the analysis worlds and never touch the bins (docs/individuality-info-theory.md §3). ${
    binTotal - binFallbacks
  }/${binTotal} anchor x profile bin fits used that exact anchor's own calibration-world data; ${binFallbacks} fell back to bins pooled across every calibration anchor (report.json's \`rows[].binSource\` has the per-row/profile detail).`,
);
md.push(
  `A CI's \`status\` is \`"uncalibrated"\` whenever it has fewer than MIN_CALIBRATED_WORLDS=${MIN_CALIBRATED_WORLDS} analysis worlds -- coverage-checked poor at that R in packages/metrics/test/individuality.test.ts -- and is reported below as a descriptive resampling range, not a confidence interval. Intervals at or above that threshold are nominal 90% percentile intervals with measured undercoverage (~84% at R=12).`,
);
md.push(
  `A nonClosure interval excluding 0 is not evidence of S-E coupling: it targets the bias-corrected statistic under frozen bins, residual bias included. Only the cross-world permutation p tests whether within-world pairing beats cross-world pairing.`,
);
md.push(
  `Holm correction below is computed across the full declared family of ${family.length} cross-world-null tests this run performs (every aggregate x profile x {nonClosure, PID uniqueE, PID synergy} with >=2 eligible worlds); the table shows only the default-profile nonClosure column of that family (see report.json's \`nullTestsHolm\` for every profile/quantity). The disagreement table further below recomputes some of these same quantities on smaller, pairwise-matched world subsets and is a separate, uncorrected, exploratory comparison -- not part of this family.`,
);
md.push("");
md.push("| kind | id | worlds | excluded | autonomyStar (default: point, CI/range) | nonClosure (default: point, CI/range, cross-world p, Holm-adjusted p over the full family) |");
md.push("|---|---|---|---|---|---|");
for (const r of rows) {
  const d = r.profiles.default;
  const pAdj = nonClosurePAdjByRow.get(r);
  md.push(
    `| ${r.kind} | ${r.id} | ${r.worlds} | ${r.excludedWorlds} | ${d ? `${d.autonomyStar.point.toFixed(3)}, ${fmtCI(d.autonomyStar)}` : "-"} | ${
      d ? `${d.nonClosure.ci.point.toFixed(3)}, ${fmtCI(d.nonClosure.ci)}, p=${d.nonClosure.nullTest.p.toFixed(3)}, p_holm=${pAdj!.toFixed(3)}` : "-"
    } |`,
  );
}
md.push("");
md.push("## Disagreement table (default profile, genetic-cluster vs. one other definition, each pair on its own common eligible worlds; raw p, uncorrected -- a separate, exploratory comparison, not part of the Holm family above)");
md.push("| founder | vs. | common worlds | autonomyStar (genetic / other) | nonClosure point (genetic / other) | nonClosure p (genetic / other) |");
md.push("|---|---|---|---|---|---|");
for (const d of disagreements) {
  md.push(
    `| ${d.founder} | ${d.otherKind} ${d.otherId} | ${d.worlds} | ${d.geneticAutonomyStar.toFixed(3)} / ${d.otherAutonomyStar.toFixed(3)} | ${d.geneticNonClosurePoint.toFixed(3)} / ${d.otherNonClosurePoint.toFixed(3)} | ${d.geneticNonClosureP.toFixed(3)} / ${d.otherNonClosureP.toFixed(3)} |`,
  );
}
if (disagreementSkipped.length) {
  md.push("");
  md.push("Skipped (fewer than 2 worlds common to that pair):");
  for (const s of disagreementSkipped) md.push(`- ${s}`);
}
await Deno.writeTextFile(`${OUT}/report.md`, md.join("\n") + "\n");

console.log(`wrote ${OUT}/report.json and ${OUT}/report.md`);
console.log(`aggregates: ${rows.length} (${rows.filter((r) => r.profiles.default).length} with >=2 eligible worlds)`);
for (const r of rows) console.log(`- ${r.kind} ${r.id}: ${r.worlds} eligible worlds, ${r.excludedWorlds} excluded`);
