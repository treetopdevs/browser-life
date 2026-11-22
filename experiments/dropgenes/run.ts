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
 * Linked templates (docs/droplet-genes-linked-2026-11-21/PLAN.md) are switched on through --ov, for example
 *   --ov '{"linked":true,"linkSites":"molecule","linkJoin":0.2,"linkBreak":0.001,"linkLoss":0.001}'
 * and --templates linked|single says what the founders carry (default linked when linking is on): two full
 * templates per wall tile, or two single copies of every gene. Either way that is two copies of each gene.
 * A linked run counts a gene wherever it sits (complete, copies, heredity) and adds a `linked` block to the
 * summary and to each report row. Without linking the output is what it was.
 *
 * Added for the second linked screen (docs/droplet-genes-linked2-2026-11-21/PLAN.md), new fields only:
 *   summary.deathGenes        for compartments the tracker saw end: which genes were missing at their last census
 *   summary.lastCompartments  what the arena held at the last census before the first census with no compartment
 *   lengths (beside summary and rows, linked runs only): molecules by genes carried at every census, whole arena
 *
 * "Held" for a run (docs/droplet-genes-2026-11-21/PLAN.md): over the last tenth of the run the mean number of
 * compartments is at least 10 and at least half of them carry every gene.
 */

import { DG_SCALE, DropGenesKernel, defaultDropGenesConfig, type DropGenesConfig } from '../../apps/lab/src/dropgenes/kernel.ts';
import { CompartmentTracker, gene0Share, heredity, heredityDelayed, parasiteShare, type Census } from '../../apps/lab/src/dropgenes/observe.ts';
import { addLinkedCounts, geneCopiesWithLinked, linkedCounts, linkedReadout, type LinkedCounts, type LinkedReadout } from '../../apps/lab/src/dropgenes/observe.ts';
import { deathReadout } from '../../apps/lab/src/dropgenes/observe.ts';

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

const KNOWN = new Set(['size', 'steps', 'seed', 'genes', 'cap', 'gated', 'mutPar', 'census', 'report', 'founders', 'spacing', 'ov', 'out', 'snapshot', 'label', 'templates']);
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
// Linked templates: what the founders carry. Two copies of every gene per wall tile in both forms.
const linked = cfg.linked === true;
const founderTemplates = args.templates ?? (linked ? 'linked' : 'single');
if (founderTemplates !== 'linked' && founderTemplates !== 'single') throw new Error(`--templates must be linked or single, got ${founderTemplates}`);
if (founderTemplates === 'linked' && !linked) throw new Error('--templates linked needs "linked": true in --ov');
if (founderTemplates === 'linked') world.seedLinked(2, 0.125);
else world.seedTemplates(2, 0.125, 0);
/** What the tracker reads: T, or with linking on the per-tile gene copies, single plus linked, in T's layout. */
const copiesBuf = linked ? new Uint32Array(world.T.length) : null;
const copiesNow = (): Uint32Array => (copiesBuf ? geneCopiesWithLinked(world.T, world.L, K, copiesBuf) : world.T);

/** Steps after a split at which daughters are read again for the heredity readout (PLAN.md amendment 1). */
const HEREDITY_DELAY = 500;
const tracker = new CompartmentTracker(size, size, S, K, { wallMin: cfg.gateHi, bareMax: cfg.gateLo, completeMin: 1, heredityDelay: HEREDITY_DELAY });

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
  /** Linked runs only: the linked-template readout over the whole arena at this census. */
  linked?: LinkedReadout;
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
    ...(linked ? { linked: linkedReadout(linkedCounts(world.T, world.L, K)) } : {}),
  };
}

/** Copies per species over the whole arena and inside compartments at one census (linked runs: a gene counted wherever it sits). */
function holdings(c: Census): { step: number; compartments: number; complete: number; arena: number[]; inCompartments: number[] } {
  const inCompartments = new Array<number>(S).fill(0);
  for (const k of c.compartments) for (let s = 0; s < S; s++) inCompartments[s] += k.copies[s];
  return {
    step: c.step,
    compartments: c.compartments.length,
    complete: c.compartments.filter((k) => k.complete).length,
    arena: inCompartments.map((v, s) => v + c.stranded[s]),
    inCompartments,
  };
}

const rows: Row[] = [];
const lateFrom = steps - Math.floor(steps / 10);
let lateN = 0;
let lateComps = 0;
let lateComplete = 0;
let extinctAt: number | null = null;
const t0 = performance.now();
let lastCensus = tracker.observe(0, world.W, copiesNow());
/** Linked runs: counts summed over the censuses of the late window (pooled, so a census with more templates weighs more). */
let lateLinked: LinkedCounts | null = null;
let lateLinkedN = 0;
/** Linked runs: molecules by genes carried (byLength[len - 1]) at every census from step 0, whole arena. */
const lengthSeries: number[][] = [];
if (linked) lengthSeries.push(linkedCounts(world.T, world.L, K).byLength);
/** The last census that had a compartment, and (frozen at the first census with none) what the arena held then. */
type Holdings = ReturnType<typeof holdings> & { byLength?: number[] };
let lastWith: Holdings | null = lastCensus.compartments.length > 0 ? { ...holdings(lastCensus), ...(linked ? { byLength: lengthSeries[0] } : {}) } : null;
let lastCompartments: Holdings | null = null;
for (let s = 1; s <= steps; s++) {
  world.step();
  if (s % censusEvery === 0) {
    const c = tracker.observe(s, world.W, copiesNow());
    lastCensus = c;
    const lcNow = linked ? linkedCounts(world.T, world.L, K) : null;
    if (lcNow) lengthSeries.push(lcNow.byLength.slice());
    if (lcNow && s > lateFrom) {
      const lc = lcNow;
      if (lateLinked === null) lateLinked = lc;
      else addLinkedCounts(lateLinked, lc);
      lateLinkedN++;
    }
    if (c.compartments.length === 0 && extinctAt === null) {
      extinctAt = s;
      lastCompartments = lastWith;
    }
    if (c.compartments.length > 0) lastWith = { ...holdings(c), ...(lcNow ? { byLength: lcNow.byLength.slice() } : {}) };
    if (s > lateFrom) {
      lateN++;
      lateComps += c.compartments.length;
      lateComplete += c.compartments.filter((k) => k.complete).length;
    }
    if (s % reportEvery === 0) {
      const r = rowOf(c);
      rows.push(r);
      console.error(
        `t=${s} comps=${r.compartments} complete=${r.complete} copies/comp=${r.meanCopies.toFixed(1)} par=${r.parasiteShare.toFixed(3)} ` +
          `fis=${r.fissions} fus=${r.fusions} dead=${r.deaths} denovo=${r.denovo} wall=${r.wallShare.toFixed(3)}`,
      );
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
  /** Compartments the tracker saw end: the genes missing at their last census (observe.ts, DeathReadout). */
  deathGenes: deathReadout(tracker.deathRecords, K),
  /**
   * The last census that still had a compartment before the first census with none (null: the run never had
   * none): copies per species over the whole arena and inside compartments, and for linked runs molecules by length.
   */
  lastCompartments,
  ...(linked
    ? {
        linked: {
          founders: founderTemplates,
          sites: cfg.linkSites ?? 'gene',
          /** Pooled over the censuses of the last tenth that were reached (0 censuses: the run ended first). */
          lateCensuses: lateLinkedN,
          late: lateLinked ? linkedReadout(lateLinked) : null,
          /** The same readout at the last census the run reached. */
          atEnd: linkedReadout(linkedCounts(world.T, world.L, K)),
        },
      }
    : {}),
};

if (args.snapshot === '1' || args.snapshot === 'true') {
  const snapCopies = copiesNow();
  for (let y = 0; y < size; y++) {
    let line = '';
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const w = world.W[i];
      let n = 0;
      let par = 0;
      for (let k = 0; k < K; k++) if (snapCopies[i * S + k] > 0) n++; // linked runs: a gene counted wherever it sits
      if (S > 0) par = world.T[i * S + K];
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
    await Deno.writeTextFile(`${args.out}.failed`, JSON.stringify({ summary, rows }, null, 1));
  } else {
    // `lengths` is written on one line per census; summary and rows are laid out as before.
    const body = JSON.stringify({ summary, rows }, null, 1);
    const lengths = linked ? `,\n "lengths": {\n  "census": ${censusEvery},\n  "byLength": [\n${lengthSeries.map((r) => `   ${JSON.stringify(r)}`).join(',\n')}\n  ]\n }\n}` : null;
    await Deno.writeTextFile(`${args.out}.tmp`, lengths === null ? body : body.slice(0, body.lastIndexOf('\n}')) + lengths);
    await Deno.rename(`${args.out}.tmp`, args.out);
  }
}
if (residual !== 0n) {
  console.error(`CONSERVATION RESIDUAL ${residual}`);
  Deno.exit(2);
}
