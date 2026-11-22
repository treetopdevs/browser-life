/**
 * Droplet genes: one run of the sandbox kernel, one JSON result file.
 *
 * Usage (deno, no GPU needed):
 *   deno run -A --no-lock experiments/dropgenes/run.ts --genes 2 --cap 16 --gated 1 --mutPar 1e-6 \
 *     --size 64 --steps 200000 --seed 5 --out runs/dropgenes/<name>.json
 *
 * Options: --size N (square), --steps N, --seed N, --genes K, --cap sites per tile at wall 1.0,
 *   --gated 1|0, --mutPar p, --census steps between tracker censuses (default 50),
 *   --report steps between time-series rows (default 2000), --founders grid|one, --spacing tiles (default 16),
 *   --ov '{"kDecT":0.03}' any other DropGenesConfig overrides, --out file (omit to print the summary only),
 *   --snapshot 1 prints an ASCII picture at the end.
 *
 * Ladder worlds (heritable trait, docs/droplet-genes-trait-2026-11-21/PLAN.md): --levels V (levels per gene; turns
 *   the ladder on), --mutLevel p (chance a new copy is one level away), --neutral 1 (neutral twin),
 *   --startLevel v (the level every founder copy starts at, default 0), --series steps between rows of the
 *   level time series (default 500). --mutPar must be 0. The output then has a `ladder` section in the summary,
 *   a `ladder` object on every report row and a `levelSeries` array; nothing else changes.
 *
 * "Held" for a run (docs/droplet-genes-2026-11-21/PLAN.md): over the last tenth of the run the mean number of
 * compartments is at least 10 and at least half of them carry every gene.
 */

import { DG_SCALE, DropGenesKernel, defaultDropGenesConfig, type DropGenesConfig } from '../../apps/lab/src/dropgenes/kernel.ts';
import { CompartmentTracker, gene0Share, heredity, heredityDelayed, parasiteShare, type Census } from '../../apps/lab/src/dropgenes/observe.ts';
import {
  DescentWindow,
  heredityLastSeen,
  ladderGene0Share,
  ladderLevelCounts,
  ladderMeanLevel,
  ladderTopShare,
  type ResponseReadout,
} from '../../apps/lab/src/dropgenes/observe.ts';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[a.slice(2)] = v;
  }
  return out;
}

function num(args: Record<string, string>, key: string, dflt: number): number {
  if (args[key] === undefined) return dflt;
  const v = Number(args[key]);
  if (!Number.isFinite(v)) throw new Error(`--${key} must be a number, got ${args[key]}`);
  return v;
}

const KNOWN = new Set(['size', 'steps', 'seed', 'genes', 'cap', 'gated', 'mutPar', 'census', 'report', 'founders', 'spacing', 'ov', 'out', 'snapshot', 'label']);
for (const k of ['levels', 'mutLevel', 'neutral', 'startLevel', 'series']) KNOWN.add(k); // ladder worlds
const args = parseArgs(Deno.args);
for (const k of Object.keys(args)) if (!KNOWN.has(k)) throw new Error(`Unknown option --${k}`);

const size = num(args, 'size', 64);
const steps = num(args, 'steps', 20000);
const seed = num(args, 'seed', 1);
const genes = num(args, 'genes', 2);
const censusEvery = num(args, 'census', 50);
const reportEvery = num(args, 'report', 2000);
const founders = args.founders ?? 'grid';
const spacing = num(args, 'spacing', 16);
const overrides = JSON.parse(args.ov ?? '{}') as Partial<DropGenesConfig>;
// A run is identified by its own flags; an override of one of these would make the file name and the recorded
// seed, size or arm disagree with what actually ran.
for (const k of ['seed', 'width', 'height', 'genes', 'capPerTile', 'gated', 'mutPar']) {
  if (k in overrides) throw new Error(`--ov must not set ${k}; use the matching option`);
}
// Ladder worlds: the ladder keys enter the configuration only when --levels is given, so a first-rung run's
// recorded configuration is unchanged.
const ladderLevels = num(args, 'levels', 0);
const ladderOn = ladderLevels > 0;
const ladderNeutral = (args.neutral ?? '0') !== '0';
const startLevel = num(args, 'startLevel', 0);
const seriesEvery = num(args, 'series', 500);
for (const k of ['ladderLevels', 'mutLevel', 'ladderNeutral']) {
  if (k in overrides) throw new Error(`--ov must not set ${k}; use --levels, --mutLevel, --neutral`);
}
if (!ladderOn && (args.mutLevel !== undefined || args.neutral !== undefined || args.startLevel !== undefined || args.series !== undefined)) {
  throw new Error('--mutLevel, --neutral, --startLevel and --series need --levels');
}
if (ladderOn && seriesEvery % censusEvery !== 0) throw new Error('--series must be a multiple of --census');
const ladderCfg: Partial<DropGenesConfig> = ladderOn ? { ladderLevels, mutLevel: num(args, 'mutLevel', 0), ladderNeutral } : {};
if (reportEvery % censusEvery !== 0) throw new Error('--report must be a multiple of --census');
if (steps % censusEvery !== 0) throw new Error('--steps must be a multiple of --census');

const cfg = defaultDropGenesConfig({
  width: size,
  height: size,
  seed,
  genes,
  capPerTile: num(args, 'cap', 16),
  gated: (args.gated ?? '1') !== '0',
  mutPar: num(args, 'mutPar', 0),
  ...overrides,
  ...ladderCfg,
});
// PLAN fixes kRepPar = 2 * kRep. defaultDropGenesConfig derives it when only kRep is overridden; refuse any other ratio.
if (cfg.kRepPar !== 2 * cfg.kRep) throw new Error(`kRepPar (${cfg.kRepPar}) must be 2 * kRep (${cfg.kRep}); leave kRepPar out of --ov`);
const world = new DropGenesKernel(cfg);
const K = cfg.genes;
const S = world.p.species;

if (founders === 'one') {
  world.seedDroplet(size >> 1, size >> 1, 3);
} else {
  const gridN = Math.max(1, Math.floor(size / spacing));
  for (let gy = 0; gy < gridN; gy++) {
    for (let gx = 0; gx < gridN; gx++) {
      world.seedDroplet(Math.floor(((gx + 0.5) / gridN) * size), Math.floor(((gy + 0.5) / gridN) * size), 3);
    }
  }
}
if (ladderOn) world.seedTemplatesAtLevel(2, startLevel, 0.125);
else world.seedTemplates(2, 0.125, 0);

/** Steps after a split at which daughters are read again for the heredity readout (PLAN.md amendment 1). */
const HEREDITY_DELAY = 500;
const tracker = new CompartmentTracker(size, size, S, K, {
  wallMin: cfg.gateHi, bareMax: cfg.gateLo, completeMin: 1, heredityDelay: HEREDITY_DELAY,
  ...(ladderOn ? { ladderLevels, ladderNeutral } : {}),
});

interface Row {
  step: number;
  compartments: number;
  complete: number;
  meanArea: number;
  meanCopies: number;
  /** total copies per species over the whole arena (essential genes then parasite) */
  totals: number[];
  strandedShare: number;
  /** stranded split by tile wall: bare (at or below gateLo), halo (between), small patches (below minArea) */
  strandedBareShare: number;
  strandedHaloShare: number;
  strandedSmallShare: number;
  parasiteShare: number;
  /** variance among compartments of the gene-0 share, and of the parasite share */
  varGene0: number | null;
  varParasite: number | null;
  wallShare: number;
  fissions: number;
  fusions: number;
  deaths: number;
  denovo: number;
  /** Ladder worlds only. */
  ladder?: LadderRow;
}

/** Ladder readouts of one census (levels run 0 .. V - 1; the top level is the parasite end). */
interface LadderRow {
  /** Copy-weighted mean level of the copies inside compartments, and per gene. */
  levelMean: number | null;
  levelMeanByGene: (number | null)[];
  /** Share of the copies inside compartments at each level. */
  levelShares: number[];
  /** Across compartments: the distribution of each compartment's own mean level. */
  compLevel: { n: number; mean: number | null; sd: number | null; min: number | null; q10: number | null; q50: number | null; q90: number | null; max: number | null };
  /** Compartments by their mean level rounded to the nearest level. */
  compLevelCounts: number[];
  /** Free templates, outside every compartment: mean level, shares by level, and the mean on bare tiles only. */
  strandedLevelMean: number | null;
  strandedLevelShares: number[];
  strandedBareLevelMean: number | null;
  /** Mean level of every copy in the arena. */
  allLevelMean: number | null;
  /** Response check over the report window that ends at this row (null for a row with no window before it). */
  resp: ResponseReadout | null;
}

function ladderRowOf(c: Census, resp: ResponseReadout | null): LadderRow {
  const V = ladderLevels;
  const inComp = new Array<number>(S).fill(0);
  for (const k of c.compartments) for (let s = 0; s < S; s++) inComp[s] += k.copies[s];
  const counts = ladderLevelCounts(inComp, K, V);
  const tot = counts.reduce((a, b) => a + b, 0);
  const zs = c.compartments.map((k) => ladderMeanLevel(k.copies, K, V)).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const q = (f: number) => (zs.length ? zs[Math.min(zs.length - 1, Math.floor(f * zs.length))] : null);
  const zMean = zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : null;
  const zVar = variance(zs);
  const compCounts = new Array<number>(V).fill(0);
  for (const z of zs) compCounts[Math.min(V - 1, Math.round(z))]++;
  const sCounts = ladderLevelCounts(c.stranded, K, V);
  const sTot = sCounts.reduce((a, b) => a + b, 0);
  return {
    levelMean: ladderMeanLevel(inComp, K, V),
    levelMeanByGene: Array.from({ length: K }, (_, k) => ladderMeanLevel(inComp.slice(k * V, (k + 1) * V), 1, V)),
    levelShares: counts.map((n) => (tot > 0 ? n / tot : 0)),
    compLevel: { n: zs.length, mean: zMean, sd: zVar === null ? null : Math.sqrt(zVar), min: q(0), q10: q(0.1), q50: q(0.5), q90: q(0.9), max: zs.length ? zs[zs.length - 1] : null },
    compLevelCounts: compCounts,
    strandedLevelMean: ladderMeanLevel(c.stranded, K, V),
    strandedLevelShares: sCounts.map((n) => (sTot > 0 ? n / sTot : 0)),
    strandedBareLevelMean: ladderMeanLevel(c.strandedBare, K, V),
    allLevelMean: ladderMeanLevel(inComp.map((n, s) => n + c.stranded[s]), K, V),
    resp,
  };
}

function variance(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
}

function rowOf(c: Census): Row {
  const comps = c.compartments;
  const totals = new Array<number>(S).fill(0);
  let inComp = 0;
  let area = 0;
  for (const k of comps) {
    area += k.area;
    for (let s = 0; s < S; s++) { totals[s] += k.copies[s]; inComp += k.copies[s]; }
  }
  let strandedTot = 0;
  for (let s = 0; s < S; s++) { totals[s] += c.stranded[s]; strandedTot += c.stranded[s]; }
  const all = inComp + strandedTot;
  const share = (part: number[]) => (all > 0 ? part.reduce((a, b) => a + b, 0) / all : 0);
  let wall = 0;
  for (let i = 0; i < world.nTiles; i++) wall += world.W[i];
  const g0 = comps.map((k) => gene0Share(k.copies, K)).filter((v): v is number => v !== null);
  const ps = comps.map((k) => parasiteShare(k.copies, K)).filter((v): v is number => v !== null);
  if (ladderOn) return ladderBaseRow(c, totals, inComp, strandedTot, area, wall, share);
  return {
    step: c.step,
    compartments: comps.length,
    complete: comps.filter((k) => k.complete).length,
    meanArea: comps.length ? area / comps.length : 0,
    meanCopies: comps.length ? inComp / comps.length : 0,
    totals,
    strandedShare: all > 0 ? strandedTot / all : 0,
    strandedBareShare: share(c.strandedBare),
    strandedHaloShare: share(c.strandedHalo),
    strandedSmallShare: share(c.strandedSmall),
    parasiteShare: all > 0 && S > 0 ? totals[K] / all : 0,
    varGene0: K >= 2 ? variance(g0) : null,
    varParasite: variance(ps),
    wallShare: wall / (world.nTiles * cfg.initMatterPerTile),
    fissions: tracker.totals.fissions,
    fusions: tracker.totals.fusions,
    deaths: tracker.totals.deaths,
    denovo: tracker.totals.denovo,
  };
}

/**
 * The first-rung row fields for a ladder world, where the species layout differs: the parasite share is the
 * share at the top level, and the gene-0 share counts gene 0 at every level.
 */
function ladderBaseRow(c: Census, totals: number[], inComp: number, strandedTot: number, area: number, wall: number, share: (part: number[]) => number): Row {
  const comps = c.compartments;
  const all = inComp + strandedTot;
  const g0 = comps.map((k) => ladderGene0Share(k.copies, K, ladderLevels)).filter((v): v is number => v !== null);
  const ps = comps.map((k) => ladderTopShare(k.copies, K, ladderLevels)).filter((v): v is number => v !== null);
  return {
    step: c.step,
    compartments: comps.length,
    complete: comps.filter((k) => k.complete).length,
    meanArea: comps.length ? area / comps.length : 0,
    meanCopies: comps.length ? inComp / comps.length : 0,
    totals,
    strandedShare: all > 0 ? strandedTot / all : 0,
    strandedBareShare: share(c.strandedBare),
    strandedHaloShare: share(c.strandedHalo),
    strandedSmallShare: share(c.strandedSmall),
    parasiteShare: ladderTopShare(totals, K, ladderLevels) ?? 0,
    varGene0: K >= 2 ? variance(g0) : null,
    varParasite: variance(ps),
    wallShare: wall / (world.nTiles * cfg.initMatterPerTile),
    fissions: tracker.totals.fissions,
    fusions: tracker.totals.fusions,
    deaths: tracker.totals.deaths,
    denovo: tracker.totals.denovo,
  };
}

// Ladder accumulators (unused in a first-rung run).
const levelTrait = (copies: number[]) => ladderMeanLevel(copies, K, ladderLevels);
/** [step, compartments, copies anywhere, mean level of all copies, mean level in compartments, top-level share of all copies] */
const levelSeries: (number | null)[][] = [];
const lateLadder = { n: 0, level: 0, compMean: 0, compMeanN: 0, compSd: 0, compSdN: 0, top: 0, stranded: 0, strandedN: 0, all: 0, allN: 0 };
let peakAllLevel: number | null = null;
let lastWithCopies: { step: number; copies: number; allLevelMean: number; topShare: number } | null = null;
let descent: DescentWindow | null = null;
const responses: { step: number; r: ResponseReadout }[] = [];
function ladderCensus(c: Census, s: number, late: boolean): ResponseReadout | null {
  const V = ladderLevels;
  const inComp = new Array<number>(S).fill(0);
  for (const k of c.compartments) for (let sp = 0; sp < S; sp++) inComp[sp] += k.copies[sp];
  const everywhere = inComp.map((n, sp) => n + c.stranded[sp]);
  const copies = everywhere.reduce((a, b) => a + b, 0);
  const allLevel = ladderMeanLevel(everywhere, K, V);
  const compLevel = ladderMeanLevel(inComp, K, V);
  if (allLevel !== null && copies >= 50) {
    if (peakAllLevel === null || allLevel > peakAllLevel) peakAllLevel = allLevel;
    lastWithCopies = { step: s, copies, allLevelMean: allLevel, topShare: ladderTopShare(everywhere, K, V) ?? 0 };
  }
  if (s % seriesEvery === 0) levelSeries.push([s, c.compartments.length, copies, allLevel, compLevel, ladderTopShare(everywhere, K, V)]);
  if (late) {
    if (compLevel !== null) {
      lateLadder.n++;
      lateLadder.level += compLevel;
      lateLadder.top += ladderTopShare(inComp, K, V) ?? 0;
    }
    const zs = c.compartments.map((k) => levelTrait(k.copies)).filter((v): v is number => v !== null);
    if (zs.length > 0) {
      lateLadder.compMean += zs.reduce((a, b) => a + b, 0) / zs.length;
      lateLadder.compMeanN++;
    }
    const zv = variance(zs);
    if (zv !== null) {
      lateLadder.compSd += Math.sqrt(zv);
      lateLadder.compSdN++;
    }
    const st = ladderMeanLevel(c.stranded, K, V);
    if (st !== null) {
      lateLadder.stranded += st;
      lateLadder.strandedN++;
    }
    if (allLevel !== null) {
      lateLadder.all += allLevel;
      lateLadder.allN++;
    }
  }
  // Response check: one window per report interval.
  let resp: ResponseReadout | null = null;
  if (descent) descent.update(c);
  if (s % reportEvery === 0) {
    if (descent) {
      resp = descent.finish(c);
      responses.push({ step: s, r: resp });
    }
    descent = new DescentWindow(c, levelTrait);
  }
  return resp;
}

const rows: Row[] = [];
const lateFrom = steps - Math.floor(steps / 10);
let lateN = 0;
let lateComps = 0;
let lateComplete = 0;
let extinctAt: number | null = null;
const t0 = performance.now();
let lastCensus = tracker.observe(0, world.W, world.T);
if (ladderOn) ladderCensus(lastCensus, 0, false);
for (let s = 1; s <= steps; s++) {
  world.step();
  if (s % censusEvery === 0) {
    const c = tracker.observe(s, world.W, world.T);
    lastCensus = c;
    if (c.compartments.length === 0 && extinctAt === null) extinctAt = s;
    if (s > lateFrom) {
      lateN++;
      lateComps += c.compartments.length;
      lateComplete += c.compartments.filter((k) => k.complete).length;
    }
    const resp = ladderOn ? ladderCensus(c, s, s > lateFrom) : null;
    if (s % reportEvery === 0) {
      const r = rowOf(c);
      if (ladderOn) r.ladder = ladderRowOf(c, resp);
      rows.push(r);
      console.error(
        `t=${s} comps=${r.compartments} complete=${r.complete} copies/comp=${r.meanCopies.toFixed(1)} par=${r.parasiteShare.toFixed(3)} ` +
          `fis=${r.fissions} fus=${r.fusions} dead=${r.deaths} denovo=${r.denovo} wall=${r.wallShare.toFixed(3)}`,
      );
      if (r.ladder) {
        const l = r.ladder;
        console.error(
          `   level=${l.levelMean?.toFixed(3) ?? 'n/a'} comp sd=${l.compLevel.sd?.toFixed(3) ?? 'n/a'} shares=${l.levelShares.map((v) => v.toFixed(2)).join('/')} ` +
            `free=${l.strandedLevelMean?.toFixed(3) ?? 'n/a'} cov=${l.resp?.cov?.toFixed(4) ?? 'n/a'} between=${l.resp?.between?.toFixed(4) ?? 'n/a'} within=${l.resp?.within?.toFixed(4) ?? 'n/a'}`,
        );
      }
    }
    // A world with no wall and no templates cannot change again: stop early, the late window counts as zeros.
    if (c.compartments.length === 0) {
      let anyWall = false;
      for (let i = 0; i < world.nTiles && !anyWall; i++) if (world.W[i] > 0) anyWall = true;
      if (!anyWall) {
        const remaining = Math.floor(steps / censusEvery) - Math.floor(s / censusEvery);
        lateN += Math.max(0, Math.min(remaining, Math.floor((steps - Math.max(s, lateFrom)) / censusEvery)));
        break;
      }
    }
  }
}
const residual = world.totalMatter() - world.initTotalMatter;
const seconds = (performance.now() - t0) / 1000;

const lateMeanComps = lateN > 0 ? lateComps / lateN : 0;
const lateCompleteShare = lateComps > 0 ? lateComplete / lateComps : 0;
const held = lateMeanComps >= 10 && lateCompleteShare >= 0.5;
function ages(xs: number[]): { n: number; median: number | null } {
  const sorted = xs.slice().sort((a, b) => a - b);
  return { n: sorted.length, median: sorted.length ? sorted[sorted.length >> 1] : null };
}
const lifetimes = tracker.totals.lifetimes.slice().sort((a, b) => a - b);
const summary = {
  label: args.label ?? null,
  config: cfg,
  size,
  steps,
  stepsRun: world.stepCount,
  /** Steps between tracker censuses: fissions, fusions and deaths (and complete/incomplete at death) depend on it. */
  census: censusEvery,
  /** How the run was set up and observed, so runs made differently cannot be tabled together unnoticed. */
  protocol: { census: censusEvery, report: reportEvery, heredityDelay: HEREDITY_DELAY, founders, spacing, seedPerGene: 2 },
  /** Effective parasite copy-rate advantage, kRepPar / kRep (PLAN: 2). */
  kRepParRatio: cfg.kRep > 0 ? cfg.kRepPar / cfg.kRep : null,
  seed,
  genes: K,
  gated: cfg.gated,
  mutPar: cfg.mutPar,
  capPerTile: cfg.capPerTile,
  residual: residual.toString(),
  seconds,
  stepsPerSecond: world.stepCount / seconds,
  extinctAt,
  lateMeanCompartments: lateMeanComps,
  lateCompleteShare,
  held,
  fissions: tracker.totals.fissions,
  fusions: tracker.totals.fusions,
  deaths: tracker.totals.deaths,
  deathsComplete: tracker.totals.deathsComplete,
  deathsIncomplete: tracker.totals.deathsIncomplete,
  denovo: tracker.totals.denovo,
  /** Median age at death over observed deaths only (censored: leaves out absorbed and still-alive compartments). */
  medianLifetime: lifetimes.length ? lifetimes[lifetimes.length >> 1] : null,
  ages: {
    observedDeaths: ages(tracker.totals.lifetimes),
    absorbedByFusion: ages(tracker.totals.absorbedAges),
    aliveAtEnd: ages(lastCensus.compartments.map((k) => lastCensus.step - k.bornStep)),
  },
  heredityGene0: K >= 2 ? heredity(tracker.fissionRecords, (c) => gene0Share(c, K)) : null,
  heredityParasite: K >= 1 ? heredity(tracker.fissionRecords, (c) => parasiteShare(c, K)) : null,
  heredityDelay: HEREDITY_DELAY,
  heredityGene0Delayed: K >= 2 ? heredityDelayed(tracker.fissionRecords, (c) => gene0Share(c, K)) : null,
  heredityParasiteDelayed: K >= 1 ? heredityDelayed(tracker.fissionRecords, (c) => parasiteShare(c, K)) : null,
  fissionRecordsKept: tracker.fissionRecords.length,
};

// Ladder worlds: replace the first-rung readouts that read the species layout K genes + parasite, and add the
// ladder section. A first-rung run does not enter this block and its summary is unchanged.
if (ladderOn) {
  const V = ladderLevels;
  const recs = tracker.fissionRecords;
  const recsLate = recs.filter((r) => r.step > steps / 2);
  const g0 = (c: number[]) => ladderGene0Share(c, K, V);
  const top = (c: number[]) => ladderTopShare(c, K, V);
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const respOf = (rs: { step: number; r: ResponseReadout }[]) => ({
    windows: rs.length,
    windowsWithCov: rs.filter((x) => x.r.cov !== null).length,
    negativeCov: rs.filter((x) => x.r.cov !== null && x.r.cov < 0).length,
    meanN: mean(rs.map((x) => x.r.n)),
    meanCov: mean(rs.map((x) => x.r.cov)),
    meanBetween: mean(rs.map((x) => x.r.between)),
    meanWithin: mean(rs.map((x) => x.r.within)),
    meanW: mean(rs.map((x) => x.r.meanW)),
    orphans: rs.reduce((a, x) => a + x.r.orphans, 0),
    traitless: rs.reduce((a, x) => a + x.r.traitless, 0),
  });
  const av = (sum: number, n: number) => (n > 0 ? sum / n : null);
  Object.assign(summary, {
    kRepParRatio: world.p.ladderNeutral ? 1 : 2,
    heredityGene0: K >= 2 ? heredity(recs, g0) : null,
    heredityParasite: heredity(recs, top),
    heredityGene0Delayed: K >= 2 ? heredityDelayed(recs, g0) : null,
    heredityParasiteDelayed: heredityDelayed(recs, top),
    ladder: {
      levels: V,
      mutLevel: cfg.mutLevel ?? 0,
      /** The rate the kernel uses: mutLevel rounded to 1 / 65536. */
      mutLevelEffective: world.p.mutLevelQ16 / 65536,
      neutral: ladderNeutral,
      startLevel,
      /** Copy rate (Q16) and function weight by level, as the kernel built them. */
      rateQ16: world.p.ladderRateQ16.slice(0, V),
      weight: world.p.ladderWeight.slice(0, V),
      seriesEvery,
      /** Means over the censuses of the last tenth of the planned run (null: no census there had copies). */
      lateLevelMean: av(lateLadder.level, lateLadder.n),
      lateLevelCensuses: lateLadder.n,
      lateTopShare: av(lateLadder.top, lateLadder.n),
      lateCompLevelMean: av(lateLadder.compMean, lateLadder.compMeanN),
      lateCompLevelSd: av(lateLadder.compSd, lateLadder.compSdN),
      lateStrandedLevelMean: av(lateLadder.stranded, lateLadder.strandedN),
      lateAllLevelMean: av(lateLadder.all, lateLadder.allN),
      /** Highest mean level of all copies at any census with at least 50 copies, and the last such census. */
      peakAllLevelMean: peakAllLevel,
      lastWithCopies,
      /** Parent to daughter resemblance in mean level: at the census of the split (at most `census` steps after it),
       * at the delayed read (survivors only), and scored when last seen (not conditioned on surviving). */
      heredityLevel: heredity(recs, levelTrait),
      heredityLevelDelayed: heredityDelayed(recs, levelTrait),
      heredityLevelLastSeen: heredityLastSeen(recs, levelTrait),
      /** The same three over the splits of the second half of the planned run only. While the level is still
       * moving (the climb from a low start), every compartment resembles every other through the time trend,
       * which inflates parent and control correlations alike; the second half is read after that. */
      heredityLevelSecondHalf: heredity(recsLate, levelTrait),
      heredityLevelDelayedSecondHalf: heredityDelayed(recsLate, levelTrait),
      heredityLevelLastSeenSecondHalf: heredityLastSeen(recsLate, levelTrait),
      /** Response check, one window per report interval: all windows, and those ending in the last tenth. */
      response: respOf(responses),
      responseLate: respOf(responses.filter((x) => x.step > lateFrom)),
      /** The windows that end in the second half of the planned run: what the pass rule reads. */
      responseSecondHalf: respOf(responses.filter((x) => x.step > steps / 2)),
      responseWindowSteps: reportEvery,
    },
  });
}

if (args.snapshot === '1' || args.snapshot === 'true') {
  for (let y = 0; y < size; y++) {
    let line = '';
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const w = world.W[i];
      let n = 0;
      let par = 0;
      for (let k = 0; k < K; k++) if (world.T[i * S + k] > 0) n++;
      if (S > 0) par = world.T[i * S + K];
      if (ladderOn) {
        // Ladder layout: the digit counts genes with a working copy (below the top level; any level in the
        // neutral twin), and 'p' / '!' mark top-level copies.
        n = 0;
        par = 0;
        const working = ladderNeutral ? ladderLevels : ladderLevels - 1;
        for (let k = 0; k < K; k++) {
          let has = 0;
          for (let v = 0; v < working; v++) has += world.T[i * S + k * ladderLevels + v];
          if (has > 0) n++;
          par += world.T[i * S + k * ladderLevels + ladderLevels - 1];
        }
      }
      line += w < 0.03 * DG_SCALE ? (par > 0 ? '!' : ' ') : w < cfg.gateHi * DG_SCALE ? '.' : par > 0 ? 'p' : String.fromCharCode(48 + Math.min(9, n));
    }
    console.error(line);
  }
}

console.log(JSON.stringify({ ...summary, config: undefined }, null, 0));
if (args.out) {
  const slash = args.out.lastIndexOf('/');
  if (slash > 0) await Deno.mkdir(args.out.slice(0, slash), { recursive: true });
  // A run that broke conservation is written beside the requested name, never under it, so a sweep cannot
  // take it for a finished run. A good run appears under its name only once it is complete.
  if (residual !== 0n) {
    await Deno.writeTextFile(`${args.out}.failed`, JSON.stringify(ladderOn ? { summary, rows, levelSeries } : { summary, rows }, null, 1));
  } else {
    await Deno.writeTextFile(`${args.out}.tmp`, JSON.stringify(ladderOn ? { summary, rows, levelSeries } : { summary, rows }, null, 1));
    await Deno.rename(`${args.out}.tmp`, args.out);
  }
}
if (residual !== 0n) {
  console.error(`CONSERVATION RESIDUAL ${residual}`);
  Deno.exit(2);
}
