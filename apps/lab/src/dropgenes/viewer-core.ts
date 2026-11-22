/**
 * Pure parts of the /dropgenes/ viewer: the settings a visitor can choose, how a world is founded, the readouts,
 * the colours of the picture and the run a worker steps. Nothing here touches the DOM, and nothing here changes
 * a run: the kernel is stepped as experiments/dropgenes/run.ts steps it and only read afterwards.
 *
 * Settings and the recorded outcomes are those of docs/droplet-genes-2026-11-21/RESULTS.md;
 * apps/lab/test/dropgenes-viewer.test.ts reads that file and checks them against it.
 */

import { DG_SCALE, DropGenesKernel, defaultDropGenesConfig, type DropGenesConfig } from './kernel.ts';
import { CompartmentTracker, labelCompartments, parasiteShare, type Census } from './observe.ts';

// ---- settings ----------------------------------------------------------------------------------------------

/** The arena of every recorded run. */
export const ARENA = 64;
/** Founders sit on a grid this many tiles apart, each a disc of wall of radius 3 with two copies of every gene. */
export const FOUNDER_SPACING = 16;
export const FOUNDER_RADIUS = 3;
export const SEED_PER_GENE = 2;
/** Template sites on a tile of full wall: the site count the viewer's two sizes were both recorded at. */
export const SITES_PER_TILE = 16;
/** Frozen for every recorded run (the kernel's own default is 0.2). */
export const FROZEN_DIFF_T = 0.1;
/** The parasite arms' rate: chance per tile per step that one gene copy there becomes a parasite copy. */
export const PARASITE_RATE = 1e-4;
/** `LARGE` in RESULTS.md: all three diffusion rates doubled. */
export const LARGE_PHYSICS = { diffW: 0.03, diffF: 0.6, diffA: 0.44 } as const;
/** Steps between censuses of the tracker that counts splits and deaths, as in the recorded runs. */
export const CENSUS_EVERY = 50;
/** Smallest patch of dense wall that counts as a compartment (the tracker's default). */
export const MIN_AREA = 3;

export type SizeId = 'default' | 'large';
export const GENE_CHOICES = [2, 4, 8] as const;
export type GeneCount = (typeof GENE_CHOICES)[number];

export interface ViewerOptions {
  readonly seed: number;
  readonly genes: GeneCount;
  readonly gated: boolean;
  readonly parasite: boolean;
  readonly size: SizeId;
}

/** The headline cell of RESULTS.md, on its first confirmation seed. */
export const DEFAULT_OPTIONS: ViewerOptions = { seed: 5, genes: 2, gated: true, parasite: true, size: 'large' };

export function viewerConfig(o: ViewerOptions): DropGenesConfig {
  return defaultDropGenesConfig({
    width: ARENA,
    height: ARENA,
    seed: o.seed,
    genes: o.genes,
    capPerTile: SITES_PER_TILE,
    gated: o.gated,
    mutPar: o.parasite ? PARASITE_RATE : 0,
    diffT: FROZEN_DIFF_T,
    ...(o.size === 'large' ? LARGE_PHYSICS : {}),
  });
}

/** Founds a world exactly as experiments/dropgenes/run.ts does with `--founders grid` (its default). */
export function foundWorld(cfg: DropGenesConfig): DropGenesKernel {
  const world = new DropGenesKernel(cfg);
  const size = cfg.width;
  const gridN = Math.max(1, Math.floor(size / FOUNDER_SPACING));
  for (let gy = 0; gy < gridN; gy++) {
    for (let gx = 0; gx < gridN; gx++) {
      world.seedDroplet(Math.floor(((gx + 0.5) / gridN) * size), Math.floor(((gy + 0.5) / gridN) * size), FOUNDER_RADIUS);
    }
  }
  world.seedTemplates(SEED_PER_GENE, 0.125, 0);
  return world;
}

export const SEED_MAX = 0x7fffffff;

/** A whole number from 0 to 2147483647, or the default seed with `replaced` set. */
export function parseSeed(text: string): { seed: number; replaced: boolean } {
  const t = text.trim();
  if (/^\d{1,10}$/.test(t)) {
    const n = Number(t);
    if (n <= SEED_MAX) return { seed: n, replaced: false };
  }
  return { seed: DEFAULT_OPTIONS.seed, replaced: true };
}

// ---- what each choice changes, in words -------------------------------------------------------------------------

export interface Choice<V> {
  readonly value: V;
  readonly name: string;
  /** What this choice changes and why it matters. A statement of the rule, never of an outcome. */
  readonly effect: string;
}

const perGene = (k: number) => {
  const n = SITES_PER_TILE / k;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

export const GENE_CHOICE_TEXT: readonly Choice<GeneCount>[] = GENE_CHOICES.map((k) => ({
  value: k,
  name: `${k} genes`,
  effect: `Wall is made only where all ${k} kinds have copies nearby. A full tile's ${SITES_PER_TILE} sites are shared, about ${perGene(k)} per gene, so ${k === 2 ? 'each kind has room' : 'a kind is easier to lose by chance'}.`,
}));

export const GATE_CHOICE_TEXT: readonly Choice<boolean>[] = [
  { value: true, name: 'Gate on', effect: 'A hop is scaled by the thinner wall of its two tiles and shut on bare water. Copies mostly stay in a compartment or its thin rim; a wall that shrinks can leave some behind on bare water.' },
  { value: false, name: 'Gate off', effect: 'Templates leak: copies hop across the gaps between compartments, the parasite’s included.' },
];

const oneIn = (p: number) => Math.round(1 / p).toLocaleString('en-US');

export const PARASITE_CHOICE_TEXT: readonly Choice<boolean>[] = [
  { value: true, name: 'Parasite on', effect: `A template that copies twice as fast and does nothing. It arises by rare mutation (1 in ${oneIn(PARASITE_RATE)} per tile per step) and takes sites the genes need.` },
  { value: false, name: 'Parasite off', effect: 'No parasite ever arises. A compartment can still lose a gene by chance.' },
];

const BASE = defaultDropGenesConfig();
const rates = (c: { diffW: number; diffF: number; diffA: number }) => `wall ${c.diffW}, food ${c.diffF}, leftovers ${c.diffA}`;

export const SIZE_CHOICE_TEXT: readonly Choice<SizeId>[] = [
  { value: 'large', name: 'Larger compartments', effect: `All three diffusion rates doubled (${rates(LARGE_PHYSICS)}). Compartments cover about 19 to 22 tiles in the recorded runs and hold more copies. A bundle of changes, not size alone.` },
  { value: 'default', name: 'Default compartments', effect: `Diffusion at ${rates(BASE)}. Compartments cover about 12 tiles in the recorded runs, so each holds fewer copies of every gene.` },
];

/** Most steps a worker takes between two pictures. */
export const PACE_CHOICES = [1, 4, 16, 64] as const;
export const DEFAULT_PACE = 16;
export const PACE_CHOICE_TEXT: readonly Choice<number>[] = [
  { value: 1, name: '1 step', effect: 'Slow motion: every step is drawn, to watch one compartment split.' },
  { value: 4, name: '4 steps', effect: 'Steady: four steps between pictures, slow enough to follow a split.' },
  { value: 16, name: '16 steps', effect: 'Brisk: sixteen steps between pictures. The page starts here.' },
  { value: 64, name: '64 steps', effect: 'Fastest: the picture jumps ahead, for getting thousands of steps in.' },
];

// ---- what the recorded runs found for a setting -----------------------------------------------------------------

export const RECORDED_SEEDS = 4;
const key = (size: SizeId, genes: number, gated: boolean, parasite: boolean) => `${size}:${genes}:${gated ? 'gated' : 'ungated'}:${parasite ? 'par' : 'nopar'}`;

/**
 * Seeds held, of four, for the settings this page offers that RESULTS.md records (16 sites per tile, seeds 5 to 8,
 * 200,000 steps). Four and eight genes were run at the larger setting only.
 */
const RECORDED_HELD: Readonly<Record<string, number>> = {
  [key('default', 2, true, true)]: 1,
  [key('default', 2, true, false)]: 4,
  [key('default', 2, false, true)]: 0,
  [key('default', 2, false, false)]: 4,
  [key('large', 2, true, true)]: 4,
  [key('large', 2, true, false)]: 4,
  [key('large', 2, false, true)]: 0,
  [key('large', 2, false, false)]: 4,
  [key('large', 4, true, true)]: 0,
  [key('large', 4, true, false)]: 4,
  [key('large', 4, false, true)]: 0,
  [key('large', 4, false, false)]: 4,
  [key('large', 8, true, true)]: 0,
  [key('large', 8, true, false)]: 0,
  [key('large', 8, false, true)]: 0,
  [key('large', 8, false, false)]: 0,
};

/** Seeds on which the recorded runs of this setting were held, or null when the setting was not run. */
export function recordedHeld(o: Pick<ViewerOptions, 'size' | 'genes' | 'gated' | 'parasite'>): number | null {
  return RECORDED_HELD[key(o.size, o.genes, o.gated, o.parasite)] ?? null;
}

/** One or two sentences on what the recorded runs found for this setting. No claim beyond RESULTS.md. */
export function recordedSentence(o: Pick<ViewerOptions, 'size' | 'genes' | 'gated' | 'parasite'>): string {
  const held = recordedHeld(o);
  if (held === null) {
    return 'This combination was not in the recorded runs (four and eight genes were run at the larger setting only), so there is no result to compare what you see with.';
  }
  const lead = `Recorded runs of this setting (seeds 5 to 8, 200,000 steps): held on ${held} of ${RECORDED_SEEDS} seeds.`;
  const tail = ' Held means that over the last tenth of the run there were at least 10 compartments on average and at least half of them carried every gene.';
  if (o.genes === 8) return `${lead} Every run had ended by step 400, with or without the gate or the parasite, so this setting says nothing about either.${tail}`;
  if (o.genes === 2 && o.parasite && !o.gated && o.size === 'large') return `${lead} Those runs ended, with no wall left, between steps 2,500 and 5,100.${tail}`;
  if (o.genes === 2 && o.parasite && o.gated && o.size === 'large') return `${lead} Late in those runs there were about 36 compartments, with the parasite at 11 to 16 percent of all copies.${tail}`;
  if (o.genes === 2 && o.parasite && o.gated && o.size === 'default') return `${lead} The other three ended at steps 13,050, 64,250 and 106,200, so a world that looks settled here can still be lost later.${tail}`;
  if (o.genes === 4 && o.parasite && o.gated) return `${lead} Those runs ended between steps 3,750 and 7,850.${tail}`;
  return lead + tail;
}

// ---- reading a world --------------------------------------------------------------------------------------------

const trackerOptions = (cfg: DropGenesConfig) => ({ wallMin: cfg.gateHi, bareMax: cfg.gateLo, completeMin: 1, maxFissionRecords: 0 });

/** A tracker set up as experiments/dropgenes/run.ts sets its own up, keeping no per-split records. */
export function newTracker(world: DropGenesKernel): CompartmentTracker {
  return new CompartmentTracker(world.cfg.width, world.cfg.height, world.p.species, world.cfg.genes, trackerOptions(world.cfg));
}

export interface FrameView {
  /** 0 outside every compartment, else 1 + the compartment's index in `census.compartments`. */
  readonly labels: Int32Array;
  readonly census: Census;
}

/**
 * The observer's labelling and census of the world as it stands, with no memory of earlier steps (a fresh tracker),
 * so it can be read at any step without disturbing the tracker that counts splits and deaths.
 */
export function observeFrame(world: DropGenesKernel): FrameView {
  const { width, height, gateHi } = world.cfg;
  const { labels, areas } = labelCompartments(world.W, width, height, Math.round(gateHi * DG_SCALE), MIN_AREA);
  const census = newTracker(world).observe(world.stepCount, world.W, world.T);
  if (areas.length - 1 !== census.compartments.length) throw new Error('The labelling and the census disagree on the number of compartments');
  return { labels, census };
}

export interface Readouts {
  readonly step: number;
  readonly compartments: number;
  /** Compartments with at least one copy of every gene somewhere in them. */
  readonly complete: number;
  /** complete / compartments; null with no compartments. */
  readonly completeShare: number | null;
  /** Template copies of every kind inside compartments, per compartment; null with no compartments. */
  readonly meanCopies: number | null;
  /** Parasite copies as a share of all template copies in the arena, loose ones included; null with no copies. */
  readonly parasiteShare: number | null;
}

/** The same figures as a time-series row of experiments/dropgenes/run.ts. */
export function readoutsOf(census: Census, genes: number): Readouts {
  const comps = census.compartments;
  let inside = 0;
  let parasites = 0;
  let complete = 0;
  for (const c of comps) {
    for (const n of c.copies) inside += n;
    parasites += c.copies[genes] ?? 0;
    if (c.complete) complete++;
  }
  let all = inside;
  for (const n of census.stranded) all += n;
  parasites += census.stranded[genes] ?? 0;
  return {
    step: census.step,
    compartments: comps.length,
    complete,
    completeShare: comps.length > 0 ? complete / comps.length : null,
    meanCopies: comps.length > 0 ? inside / comps.length : null,
    parasiteShare: all > 0 ? parasites / all : null,
  };
}

// ---- the picture ------------------------------------------------------------------------------------------------

export type RGB = readonly [number, number, number];

/** The arena is a jar: dark in both themes, so these colours do not follow the theme. */
export const FIELD: RGB = [13, 19, 17];
/** Wall outside compartments, at full density. */
export const WALL_GREY: RGB = [112, 124, 120];
/** A compartment carrying every gene. */
export const COMPLETE: RGB = [62, 196, 222];
/** A compartment missing one gene, and one missing every gene; counts in between step from one to the other. */
export const MISSING_ONE: RGB = [240, 190, 62];
export const MISSING_ALL: RGB = [232, 92, 58];
/** What a compartment fades toward as the parasite's share of its copies rises. */
export const PARASITE_FADE: RGB = [84, 88, 92];
/**
 * How far toward grey a compartment that is all parasite goes. Short of 1, so that the gene colour survives: a
 * compartment that has lost a gene and is nearly all parasite must still read as incomplete, not as plain grey.
 */
export const FADE_MAX = 0.7;
/**
 * Template copies outside every compartment: genes, and the parasite. Blue and pink, never grey, so a tile of
 * loose copies is not taken for a compartment that the parasite has faded.
 */
export const LOOSE_GENE: RGB = [96, 160, 220];
export const LOOSE_PARASITE: RGB = [255, 120, 214];

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c: RGB) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;

/** The colour of a compartment holding `held` of `genes` kinds, before any fading. */
export function geneTint(held: number, genes: number): RGB {
  if (held >= genes) return COMPLETE;
  const missing = genes - held;
  return genes <= 1 ? MISSING_ALL : mix(MISSING_ONE, MISSING_ALL, (missing - 1) / (genes - 1));
}

/** Kinds of gene with at least one copy in a compartment (the observer's "complete" is this reaching `genes`). */
export function genesHeld(copies: readonly number[], genes: number): number {
  let held = 0;
  for (let k = 0; k < genes; k++) if (copies[k] >= 1) held++;
  return held;
}

/** A compartment's colour: its gene tint, faded toward grey by the parasite's share of the copies inside it. */
export function compartmentColour(copies: readonly number[], genes: number): RGB {
  const tint = geneTint(genesHeld(copies, genes), genes);
  const share = parasiteShare(copies as number[], genes) ?? 0;
  return mix(tint, PARASITE_FADE, FADE_MAX * share);
}

/** Brightness of a wall density, 0 to 1. The square root keeps the thin rim around a compartment visible. */
export function wallLevel(w: number): number {
  return Math.sqrt(Math.min(1, w / DG_SCALE));
}

/** How strongly loose template copies on a tile show, 0 to 0.5: faint for one copy, never as solid as a compartment. */
export function looseAlpha(copies: number): number {
  return copies <= 0 ? 0 : Math.min(0.5, 0.2 + 0.05 * copies);
}

/** Paints the arena into `out` (RGBA, one pixel per tile). */
export function paintArena(world: DropGenesKernel, view: FrameView, out: Uint8ClampedArray): void {
  const { W, T } = world;
  const S = world.p.species;
  const K = world.cfg.genes;
  const colours = view.census.compartments.map((c) => compartmentColour(c.copies, K));
  for (let i = 0; i < world.nTiles; i++) {
    const level = wallLevel(W[i]);
    const label = view.labels[i];
    let c: RGB;
    if (label > 0) {
      c = mix(FIELD, colours[label - 1], 0.55 + 0.45 * level);
    } else {
      c = mix(FIELD, WALL_GREY, 0.6 * level);
      let genes = 0;
      for (let k = 0; k < K; k++) genes += T[i * S + k];
      const par = S > 0 ? T[i * S + K] : 0;
      const loose = genes + par;
      if (loose > 0) c = mix(c, mix(LOOSE_GENE, LOOSE_PARASITE, par / loose), looseAlpha(loose));
    }
    const o = i * 4;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = 255;
  }
}

export interface LegendItem {
  readonly swatch: string;
  readonly text: string;
}

/** The legend, drawn from the same colours as the picture. `swatch` is a CSS background. */
export function legendItems(genes: number): LegendItem[] {
  const steps: string[] = [];
  for (let held = genes - 1; held >= 0; held--) steps.push(css(geneTint(held, genes)));
  const ramp = steps.length > 1 ? `linear-gradient(90deg, ${steps.map((c, i) => `${c} ${(i / steps.length) * 100}% ${((i + 1) / steps.length) * 100}%`).join(', ')})` : steps[0];
  return [
    { swatch: css(COMPLETE), text: `Compartment carrying all ${genes} genes` },
    { swatch: ramp, text: genes === 2 ? 'Missing one gene, then both' : `Missing one gene, stepping to all ${genes}` },
    { swatch: `linear-gradient(90deg, ${css(COMPLETE)}, ${css(mix(COMPLETE, PARASITE_FADE, FADE_MAX))})`, text: 'Fades toward grey as the parasite takes a larger share of the copies inside; a missing gene still shows' },
    { swatch: css(mix(FIELD, WALL_GREY, 0.45)), text: 'Thin wall outside any compartment' },
    { swatch: css(mix(FIELD, LOOSE_GENE, 0.5)), text: 'Gene copies outside any compartment' },
    { swatch: css(mix(FIELD, LOOSE_PARASITE, 0.5)), text: 'Parasite copies outside any compartment' },
  ];
}

// ---- the running chart ------------------------------------------------------------------------------------------

export interface HistoryPoint {
  readonly step: number;
  readonly compartments: number;
  /** 0 when there are no compartments. */
  readonly completeShare: number;
}

/**
 * The whole run at a bounded size: readings arrive one census apart, and each time the store fills, every other
 * reading is dropped and the spacing doubles.
 */
export class History {
  points: HistoryPoint[] = [];
  interval: number;

  constructor(
    private readonly cap = 240,
    interval = CENSUS_EVERY,
  ) {
    this.interval = interval;
  }

  push(p: HistoryPoint): void {
    if (p.step % this.interval !== 0) return;
    this.points.push(p);
    if (this.points.length > this.cap) {
      this.interval *= 2;
      this.points = this.points.filter((q) => q.step % this.interval === 0);
    }
  }
}

/** Steps per second over a short window of (time, step) readings; null until the window is long enough to trust. */
export class RateMeter {
  private samples: [number, number][] = [];

  constructor(private readonly windowMs = 2000) {}

  push(timeMs: number, step: number): void {
    this.samples.push([timeMs, step]);
    while (this.samples.length > 2 && timeMs - this.samples[1][0] >= this.windowMs) this.samples.shift();
  }

  clear(): void {
    this.samples = [];
  }

  rate(): number | null {
    if (this.samples.length < 2) return null;
    const [t0, s0] = this.samples[0];
    const [t1, s1] = this.samples[this.samples.length - 1];
    return t1 - t0 >= 250 && s1 > s0 ? ((s1 - s0) * 1000) / (t1 - t0) : null;
  }
}

// ---- the run a worker steps -------------------------------------------------------------------------------------

export interface Frame {
  readonly step: number;
  /** RGBA picture of the arena, one pixel per tile. */
  readonly rgba: Uint8ClampedArray;
  readonly readouts: Readouts;
  /** Total matter now minus total matter at the start, exact. Must be "0". */
  readonly residual: string;
  /** Splits and deaths the tracker has inferred, at a census every CENSUS_EVERY steps. */
  readonly fissions: number;
  readonly deaths: number;
  /** Step of the census that last counted the splits and deaths. */
  readonly censusStep: number;
  /** First census from which there has been no compartment, or null while there is one. */
  readonly emptySince: number | null;
  /** No wall is left anywhere: wall is only made from wall, so nothing can change again. */
  readonly ended: boolean;
  readonly history: { readonly interval: number; readonly points: readonly HistoryPoint[] };
}

export class ViewerSession {
  readonly opts: ViewerOptions;
  readonly cfg: DropGenesConfig;
  readonly world: DropGenesKernel;
  readonly history = new History();
  private readonly tracker: CompartmentTracker;
  private censusStep = 0;
  emptySince: number | null = null;
  ended = false;

  constructor(opts: ViewerOptions) {
    this.opts = opts;
    this.cfg = viewerConfig(opts);
    this.world = foundWorld(this.cfg);
    this.tracker = newTracker(this.world);
    this.census();
  }

  private census(): void {
    const { world } = this;
    const c = this.tracker.observe(world.stepCount, world.W, world.T);
    this.censusStep = c.step;
    // The tracker keeps every age at death for the experiment's summary. The viewer shows only the counts, and a
    // page left running would grow these lists without end; the tracker itself never reads them back. (Its private
    // record of which ids ever merged still grows, by one small entry per merge; only observe.ts can prune that.)
    this.tracker.totals.lifetimes.length = 0;
    this.tracker.totals.absorbedAges.length = 0;
    const r = readoutsOf(c, this.cfg.genes);
    this.history.push({ step: c.step, compartments: r.compartments, completeShare: r.completeShare ?? 0 });
    if (r.compartments > 0) {
      this.emptySince = null;
      return;
    }
    if (this.emptySince === null) this.emptySince = c.step;
    let wall = false;
    for (let i = 0; i < world.nTiles && !wall; i++) if (world.W[i] > 0) wall = true;
    if (!wall) this.ended = true;
  }

  /**
   * Steps up to `maxSteps` times, stopping early once `budgetMs` has passed or the world has ended. Returns the
   * steps taken. The tracker's census falls on every CENSUS_EVERY-th step whatever the sizes of the calls.
   */
  advance(maxSteps: number, budgetMs = Infinity, now: () => number = () => performance.now()): number {
    const t0 = now();
    let done = 0;
    while (done < maxSteps && !this.ended) {
      this.world.step();
      done++;
      if (this.world.stepCount % CENSUS_EVERY === 0) this.census();
      if (done < maxSteps && now() - t0 >= budgetMs) break;
    }
    return done;
  }

  residual(): bigint {
    return this.world.totalMatter() - this.world.initTotalMatter;
  }

  frame(): Frame {
    const view = observeFrame(this.world);
    const rgba = new Uint8ClampedArray(this.world.nTiles * 4);
    paintArena(this.world, view, rgba);
    return {
      step: this.world.stepCount,
      rgba,
      readouts: readoutsOf(view.census, this.cfg.genes),
      residual: this.residual().toString(),
      fissions: this.tracker.totals.fissions,
      deaths: this.tracker.totals.deaths,
      censusStep: this.censusStep,
      emptySince: this.emptySince,
      ended: this.ended,
      history: { interval: this.history.interval, points: this.history.points },
    };
  }
}

// ---- messages between the page and its worker -------------------------------------------------------------------

/** Longest a worker steps before it answers, so a pause or a new setting is never far away. */
export const TICK_BUDGET_MS = 100;

export type ToWorker =
  | { readonly type: 'reset'; readonly gen: number; readonly opts: ViewerOptions }
  | { readonly type: 'tick'; readonly gen: number; readonly steps: number };

export type FromWorker =
  | { readonly type: 'frame'; readonly gen: number; readonly frame: Frame }
  | { readonly type: 'error'; readonly gen: number; readonly message: string };
