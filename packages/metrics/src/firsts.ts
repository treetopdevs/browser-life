// The log of firsts (rule set `firsts-v2`: `firsts-v0`'s nine rules, docs/pond-keeper-v0-2026-10-17.md, unchanged,
// plus v1's five rungs, docs/pond-keeper-v1-2026-10-17.md, plus v2's five, docs/pond-keeper-v2-2026-10-17.md). A detector reads only
// what the census and the tracker already infer, at each census an observer takes, and records the
// first census at which each fixed rule's condition holds. Observer only: nothing here touches the
// physics, declares a category or scores a world. The thresholds are design choices, stated in the
// notes so a player and a replay can check them; a change to a rule is a new rule set id.
//
// Next up (`nextUp`) is a pure read of the detector's own counters: the first rungs of the ladder not
// yet reached, each with its progress, so a replay shows the same numbers as the live run.
//
// The detector is a pure function of the censuses it is fed, in order, so a replay that feeds it the
// same censuses reaches the same log, and a snapshot taken at any census restores to a detector that
// continues exactly as an uninterrupted one would.

import { G, GENE_SHIFT, geneMasks, type WorldConfig } from "@bl/schema";
import { individuals, type Census } from "./census.ts";
import type { LifeEvent, Tracker } from "./tracker.ts";

export const FIRSTS_RULESET = "firsts-v2" as const;
/** The rule set of version 2 session files; this detector refuses its snapshots (see `restore`). */
export const FIRSTS_RULESET_V1 = "firsts-v1" as const;
/** The rule set of version 1 session files; this detector refuses its snapshots (see `restore`). */
export const FIRSTS_RULESET_V0 = "firsts-v0" as const;
export const FIRSTS_THRESHOLDS = {
  big: 40,
  large: 100,
  huge: 250,
  travel: 16,
  farTravel: 32,
  lineageCells: 16,
  lineageSteps: 5000,
  longLineageSteps: 20000,
  leadCensuses: 10,
  /** v2: a body moves when its centroid is this far (cells, on its pond's torus) from where it was 5 censuses ago. */
  moveCells: 8,
  /** v2: censuses back a moving body is compared with (so it must be matched at moveCensuses + 1 censuses). */
  moveCensuses: 5,
  /** v2: bodies a pond needs moving by the rule. */
  movingBodies: 2,
  longBody: 40,
  longRatio: 3,
  /** v2: censuses in a row a lineage must strictly lead a pond. */
  changeCensuses: 5,
  /** v2: the wound horizon H, before the half-pond-period cap. */
  woundSteps: 1000,
} as const;

export interface FirstsRule {
  id: string;
  name: string;
  text: string;
}

/** The nineteen fixed rules in the notes' table order (v0's nine, v1's five, v2's five), with the notes' names and "Fires at the first census where" text. */
export const FIRSTS_RULES: readonly FirstsRule[] = [
  { id: "body", name: "First body", text: "some body exists (on a world planted with founder discs this is usually already there)" },
  { id: "body-40", name: "First big body", text: "some body has 40 cells or more" },
  { id: "body-100", name: "First large body", text: "some body has 100 cells or more" },
  { id: "split", name: "First split", text: "the tracker's fission count has risen since the first watched census" },
  { id: "grandchild", name: "First grandchild", text: "some living body is of generation 2 or more" },
  { id: "gen-5", name: "Fifth generation", text: "some living body is of generation 5 or more" },
  {
    id: "traveller",
    name: "First traveller",
    text: "some body, matched as the same body at every census since the log first saw it, has its centroid 16 cells or more from where the log first saw it (distance on its pond's torus)",
  },
  {
    id: "new-lineage",
    name: "First new lineage to last",
    text: "a lineage that is not a starting lineage has held 16 cells or more at every census for 5,000 steps (fires at the census that completes the 5,000 steps)",
  },
  {
    id: "takeover",
    name: "First takeover",
    text: "a lineage that is not a starting lineage has had the most cells of any lineage at 10 censuses in a row (fires at the tenth; the entry says when its lead began)",
  },
  { id: "body-250", name: "First huge body", text: "some body has 250 cells or more" },
  { id: "gen-10", name: "Tenth generation", text: "some living body is of generation 10 or more" },
  { id: "far-traveller", name: "First far traveller", text: "the traveller condition with 32 cells instead of 16" },
  { id: "lineage-20k", name: "First lineage to last 20,000 steps", text: "the new-lineage condition with 20,000 steps instead of 5,000" },
  {
    id: "takeover-2",
    name: "Second takeover",
    text: "the takeover condition, by a non-starting lineage other than the one named by takeover (counting starts at the census after takeover fired)",
  },
  {
    id: "moving-pond",
    name: "First moving pond",
    text: "some pond has at least two bodies, and at least half of its bodies' cells, in bodies that moved 8 cells or more over the last 5 censuses: matched as the same body at each of the 6 censuses, within one cycle, distance between its centroids then and now on its pond's torus",
  },
  {
    id: "long-body",
    name: "First long body",
    text: "some body of 40 cells or more is at least 3 times as long as it is wide: the square root of the ratio of the two principal second moments of its cells' unwrapped positions, each cell counted as a unit square (so a straight line of n cells has ratio n, a 3 by 9 block 3)",
  },
  {
    id: "pond-change",
    name: "First change of hands in a pond",
    text: "in some pond, within one cycle, a lineage has had strictly the most cells of the pond (no other lineage tied) at 5 censuses in a row, and later a different lineage has had strictly the most at 5 censuses in a row, a run that began after the first lineage's fifth census (fires at the second lineage's fifth)",
  },
  {
    id: "outlive-wound",
    name: "First pond to outlive a wound",
    text: "a pond took a wound at step w that counts (below), and has held at least one body at every census after w up to the first census at or after w + H, where H = 1,000 steps, or half the pond period if that is shorter, all within one cycle (fires at that census; the entry gives the wound's radius and the cells its bodies lost)",
  },
  { id: "new-family", name: "First new family", text: "the family rule (§3) split a family for the first time" },
];

/** The ladder's order (what Next up offers first); the `gene-<b>` rules follow, bit ascending. */
export const FIRSTS_LADDER: readonly string[] = [
  "body", "body-40", "split", "grandchild", "traveller", "moving-pond", "new-lineage", "body-100", "long-body", "takeover", "outlive-wound",
  "gen-5", "pond-change", "new-family", "far-traveller", "body-250", "lineage-20k", "takeover-2", "gen-10",
];

/** The fixed rules, then `gene-<b>` for each gainable gene bit (gene worlds only). */
export function firstsRules(geneBits: readonly number[]): FirstsRule[] {
  return [
    ...FIRSTS_RULES.map((r) => ({ ...r })),
    ...geneBits.map((b) => ({ id: `gene-${b}`, name: `First carrier body of gene ${b}`, text: `some body has more than half of its cells carrying gene bit ${b}` })),
  ];
}

export interface FirstsContext {
  tileW: number;
  tileH: number;
  /** Tiles per row, for cell -> tile. */
  tilesX: number;
  /** tilesX * tilesY: more than 1 means "pond n" can be said. */
  tiles: number;
  censusEvery: number;
  /** cfg.pondPeriod; deaths at (boundary + censusEvery) count as "at a pond cycle", and it sets the wound horizon. */
  pondPeriod?: number;
  /** True iff pondPeriod is set and the arm reseeds (scaf, rand or breed; `cont` only measures): each boundary then ends a cycle. */
  pondReseeds: boolean;
  /** Gainable gene bits (bit b of the gene byte), [] when the world has no genes. */
  geneBits: readonly number[];
}

/** From the world's config: tile sizes, pondPeriod and whether it reseeds, and the gene bits `geneMasks(cfg).set` names. */
export function firstsContext(cfg: WorldConfig, censusEvery: number): FirstsContext {
  const set = geneMasks(cfg).set;
  const geneBits: number[] = [];
  for (let b = 0; b < 8; b++) if ((set >>> (GENE_SHIFT + b)) & 1) geneBits.push(b);
  const pondReseeds = cfg.pondPeriod !== undefined && (cfg.pondArm === "scaf" || cfg.pondArm === "rand" || cfg.pondArm === "breed");
  const ctx: FirstsContext = { tileW: cfg.tileW, tileH: cfg.tileH, tilesX: cfg.tilesX, tiles: cfg.tilesX * cfg.tilesY, censusEvery, pondReseeds, geneBits };
  if (cfg.pondPeriod !== undefined) ctx.pondPeriod = cfg.pondPeriod;
  return ctx;
}

export interface FirstsBody {
  /** Tracker individual id: the same body across censuses. */
  id: number;
  generation: number;
  cells: number;
  cx: number;
  cy: number;
  tile: number;
  lineage: string;
  /**
   * How much longer than wide the body is (v2): the square root of the ratio of the two principal second moments of its cells'
   * unwrapped positions, each cell a unit square. 1 for a round body, n for a straight line of n cells.
   */
  elongation: number;
  /** Cells carrying gene bit ctx.geneBits[j], aligned with ctx.geneBits; absent without genes. */
  geneCells?: readonly number[];
}

/** A lesion the caller logged: centre pond (tile) and effective radius. */
export interface FirstsWound {
  step: number;
  tile: number;
  r: number;
}

/** What the family tree (families.ts) says at this same census, for the `new-family` rung and its progress. */
export interface FirstsFamily {
  /** Splits the tree made at this census, in its order. */
  splits: readonly { name: string; parentName: string; step: number; cells: number; parentCells: number }[];
  /** The longest current run, in steps, of a split candidate. */
  candidateRun: number;
}

export interface FirstsInput {
  step: number;
  /** Every body (census individual) at this census. */
  bodies: readonly FirstsBody[];
  /** Census lineage table: key and cells. */
  lineages: readonly { key: string; cells: number }[];
  /** Tracker's cumulative fission count. */
  fissions: number;
  /** Tracker death events at this census. */
  deaths: number;
  livingCells: number;
  /** Per tile: every lineage key tied for the most living cells in that pond; [] when the pond has no living cell. */
  pondLeaders: readonly (readonly string[])[];
  /** Lesions logged since the previous census: that census's step <= step < this census's step. */
  wounds: readonly FirstsWound[];
  /** From the family tree at this same census; absent when no tree is fed. */
  family?: FirstsFamily;
}

/** Orders lineage keys "hi:lo" by birth (birth step, then cell); anything else by string. */
export function lineageKeyOrder(a: string, b: string): number {
  const ma = /^(\d+):(\d+)$/.exec(a);
  const mb = /^(\d+):(\d+)$/.exec(b);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]) || Number(ma[2]) - Number(mb[2]);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** What one census says about who carries which lineage: read once from the labels and the genome words, used by both the firsts and the family tree. */
export interface LineageCells {
  /** Per tile: living cells by lineage key (bodies and film alike). */
  ponds: Map<string, number>[];
  /** Per body (census individual with a tracker id), in `individuals` order: its cells and the lineage composition of its keyed cells, keys in birth order. */
  bodies: { id: number; cells: number; keys: [string, number][] }[];
}

/**
 * Reads each cell's lineage key once. A key string is built once per distinct (hi, lo), not per cell. Pond counts cover every keyed
 * cell; a body's composition covers its keyed cells only (its `cells` may be more).
 */
export function readLineageCells(c: Census, tracker: Tracker, genomeHead: Uint32Array, ctx: FirstsContext): LineageCells {
  const n = c.labels.length;
  const { tileW, tileH, tilesX } = ctx;
  const W = tilesX * tileW;
  const inds: { id: number; cells: number; idx: number }[] = [];
  for (const k of individuals(c)) {
    const id = tracker.idOf(k.idx);
    if (id !== undefined) inds.push({ id, cells: k.cells, idx: k.idx });
  }
  const slot = new Int32Array(c.components.length).fill(-1);
  inds.forEach((b, s) => (slot[b.idx] = s));
  const pondCounts: Map<number, number>[] = Array.from({ length: ctx.tiles }, () => new Map());
  const bodyCounts: Map<number, number>[] = inds.map(() => new Map());
  const byHi = new Map<number, Map<number, number>>();
  const keys: string[] = [];
  let lastHi = -1;
  let lastLo = -1;
  let lastLid = -1;
  for (let i = 0; i < n; i++) {
    const hi = genomeHead[G.LIN_HI * n + i];
    const lo = genomeHead[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    if (hi !== lastHi || lo !== lastLo) {
      let row = byHi.get(hi);
      if (!row) byHi.set(hi, (row = new Map()));
      let lid = row.get(lo);
      if (lid === undefined) {
        lid = keys.length;
        keys.push(`${hi}:${lo}`);
        row.set(lo, lid);
      }
      lastHi = hi;
      lastLo = lo;
      lastLid = lid;
    }
    const x = i % W;
    const y = (i - x) / W;
    const pc = pondCounts[Math.floor(y / tileH) * tilesX + Math.floor(x / tileW)];
    if (pc) pc.set(lastLid, (pc.get(lastLid) ?? 0) + 1);
    const l = c.labels[i];
    if (l >= 0 && slot[l] >= 0) {
      const bc = bodyCounts[slot[l]];
      bc.set(lastLid, (bc.get(lastLid) ?? 0) + 1);
    }
  }
  return {
    ponds: pondCounts.map((m) => new Map([...m].map(([lid, cnt]) => [keys[lid], cnt] as const))),
    bodies: inds.map((b, s) => ({
      id: b.id,
      cells: b.cells,
      keys: [...bodyCounts[s]].map(([lid, cnt]) => [keys[lid], cnt] as [string, number]).sort((p, q) => lineageKeyOrder(p[0], q[0])),
    })),
  };
}

/** Per tile, every key tied for the most cells in that pond (in birth order); [] for a pond with no living cell. */
export function pondLeaders(lc: LineageCells): string[][] {
  return lc.ponds.map((m) => {
    let most = 0;
    for (const cnt of m.values()) if (cnt > most) most = cnt;
    if (most === 0) return [];
    const out: string[] = [];
    for (const [k, cnt] of m) if (cnt === most) out.push(k);
    return out.sort(lineageKeyOrder);
  });
}

/**
 * How much longer than wide each wanted body is (see `FirstsBody.elongation`). Each body's cells are unwrapped on its pond's torus by a
 * four-neighbour flood fill over the body's own cells from its lowest-index cell, as the census found it; the covariance of the unwrapped
 * positions gets 1/12 added to each eigenvalue (a cell is a unit square). All sums are exact integers: with n cells, Sx and so on over the
 * unwrapped positions, C = n·S2 − S1² is n² times the population covariance, and 12·n²·λ = 6·(tr C ± sqrt(disc)) + n².
 */
function elongations(c: Census, ctx: FirstsContext, wanted: ReadonlySet<number>): Map<number, number> {
  const out = new Map<number, number>();
  if (!wanted.size) return out;
  const n = c.labels.length;
  const { tileW, tileH, tilesX } = ctx;
  const W = tilesX * tileW;
  const start = new Map<number, number>();
  for (let i = 0; i < n && start.size < wanted.size; i++) {
    const l = c.labels[i];
    if (l >= 0 && wanted.has(l) && !start.has(l)) start.set(l, i);
  }
  const queue = new Int32Array(n);
  const offX = new Int32Array(n);
  const offY = new Int32Array(n);
  const seen = new Uint8Array(n);
  for (const [label, s] of start) {
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    seen[s] = 1;
    offX[s] = 0;
    offY[s] = 0;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    while (head < tail) {
      const i = queue[head++];
      const ox = offX[i];
      const oy = offY[i];
      sx += ox;
      sy += oy;
      sxx += ox * ox;
      syy += oy * oy;
      sxy += ox * oy;
      const x = i % W;
      const y = (i - x) / W;
      const tx = Math.floor(x / tileW);
      const ty = Math.floor(y / tileH);
      const lx = x - tx * tileW;
      const ly = y - ty * tileH;
      for (let d = 0; d < 4; d++) {
        const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
        const dy = d === 2 ? 1 : d === 3 ? -1 : 0;
        const j = (ty * tileH + ((ly + dy + tileH) % tileH)) * W + tx * tileW + ((lx + dx + tileW) % tileW);
        if (seen[j] || c.labels[j] !== label) continue;
        seen[j] = 1;
        offX[j] = ox + dx;
        offY[j] = oy + dy;
        queue[tail++] = j;
      }
    }
    const cnt = tail;
    const cxx = cnt * sxx - sx * sx;
    const cyy = cnt * syy - sy * sy;
    const cxy = cnt * sxy - sx * sy;
    const tr = cxx + cyy;
    const disc = Math.sqrt((cxx - cyy) * (cxx - cyy) + 4 * cxy * cxy);
    const big = 6 * (tr + disc) + cnt * cnt;
    const small = 6 * (tr - disc) + cnt * cnt;
    out.set(label, small > 0 ? Math.sqrt(big / small) : 1);
  }
  return out;
}

/** What the caller may hand `buildFirstsInput` beyond the census: the shared lineage read, the lesions since the previous census, and the family tree's view. */
export interface FirstsExtras {
  /** From `readLineageCells`; computed here (from `genomeHead`) when absent. */
  lineageCells?: LineageCells;
  wounds?: readonly FirstsWound[];
  family?: FirstsFamily;
}

/**
 * A pure read of one observed census: call it right after `tracker.update(c)` (generations are
 * the tracker's at that census) and before the next census mutates the tracker. A component the
 * tracker gave no id (cannot happen after `update`) is skipped rather than thrown on. Without genome
 * words there are no gene counts and no pond leaders (every pond's list is empty).
 */
export function buildFirstsInput(c: Census, tracker: Tracker, genomeHead: Uint32Array | undefined, events: readonly LifeEvent[], ctx: FirstsContext, extras?: FirstsExtras): FirstsInput {
  const bodies: FirstsBody[] = [];
  const slot = new Map<number, number[]>();
  const withGenes = genomeHead !== undefined && ctx.geneBits.length > 0;
  const comps = individuals(c);
  const elong = elongations(c, ctx, new Set(comps.filter((k) => tracker.idOf(k.idx) !== undefined).map((k) => k.idx)));
  for (const k of comps) {
    const id = tracker.idOf(k.idx);
    if (id === undefined) continue;
    const body: FirstsBody = {
      id, generation: tracker.alive.get(id)?.generation ?? 0, cells: k.cells, cx: k.cx, cy: k.cy, tile: k.tile, lineage: k.lineage, elongation: elong.get(k.idx) ?? 1,
    };
    if (withGenes) {
      const counts = ctx.geneBits.map(() => 0);
      body.geneCells = counts;
      slot.set(k.idx, counts);
    }
    bodies.push(body);
  }
  if (withGenes && slot.size) {
    const n = c.labels.length;
    for (let i = 0; i < n; i++) {
      const counts = slot.get(c.labels[i]);
      if (!counts) continue;
      const word = genomeHead[G.PARAM1 * n + i];
      for (let j = 0; j < ctx.geneBits.length; j++) if ((word >>> (GENE_SHIFT + ctx.geneBits[j])) & 1) counts[j]++;
    }
  }
  let deaths = 0;
  for (const e of events) if (e.kind === "death") deaths++;
  const lc = extras?.lineageCells ?? (genomeHead ? readLineageCells(c, tracker, genomeHead, ctx) : undefined);
  const input: FirstsInput = {
    step: c.step,
    bodies,
    lineages: c.lineages.map((l) => ({ key: l.key, cells: l.cells })),
    fissions: tracker.fissions,
    deaths,
    livingCells: c.livingCells,
    pondLeaders: lc ? pondLeaders(lc) : Array.from({ length: ctx.tiles }, () => []),
    wounds: extras?.wounds ? extras.wounds.map((w) => ({ step: w.step, tile: w.tile, r: w.r })) : [],
  };
  if (extras?.family) input.family = { splits: extras.family.splits.map((s) => ({ ...s })), candidateRun: extras.family.candidateRun };
  return input;
}

export interface FirstsEntry {
  /** A rule id: "body", "body-40", ..., "gene-0". */
  id: string;
  name: string;
  /** Census step at which the condition first held (for takeover, the step of the tenth census). */
  step: number;
  /** The condition already held at the first watched census: shown muted, "already there when watching began". */
  already: boolean;
  /** One plain line, deterministic, e.g. "52 cells, in pond 2" / "ahead since t=4,200". */
  detail: string;
}

export interface FirstsStats {
  bodies: number;
  largestBody: number;
  maxGeneration: number;
  lineages: number;
}

export interface FirstsSummary {
  ruleSet: typeof FIRSTS_RULESET;
  watchedFrom: number | null;
  /** Step of the latest watched census. */
  step: number | null;
  baseline: FirstsStats | null;
  latest: FirstsStats | null;
  startingLineages: number;
  startingLineagesPresent: number;
  /** Last census step with at least one body, null if none was ever seen. */
  lastBodyStep: number | null;
  /** Individuals the tracker lost since watchedFrom (sum of `deaths`), and how many of those at a pond cycle (the census after a boundary). */
  bodiesLost: number;
  bodiesLostAtCycle: number;
  /** First census with no living cells after living cells had been seen; null otherwise. The jar emptied. */
  emptiedAt: number | null;
  censuses: number;
}

/** JSON-safe, plain data only: `structuredClone` and `JSON.stringify` round-trip it. The other keys are the detector's private counters. */
export interface FirstsSnapshot {
  v: 3;
  ruleSet: typeof FIRSTS_RULESET;
  ctx: FirstsContext;
  [k: string]: unknown;
}

/** Rules whose condition can already hold at the first watched census. The rest need a later census by their wording. */
const CAN_BE_ALREADY = (id: string) =>
  id === "body" || id === "long-body" || id === "body-40" || id === "body-100" || id === "body-250" || id === "grandchild" || id === "gen-5" || id === "gen-10" || id.startsWith("gene-");

/** Thousands separators without locale dependence, so a detail line is the same on every host. */
const num = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export interface NextUpItem {
  id: string;
  name: string;
  /** Progress read off the detector's own counters. Whole numbers, except where `decimals` says one decimal (floored). */
  value: number;
  target: number;
  /** Plain words after "of target", e.g. "cells", "steps". */
  unit: string;
  /** "best": the best seen so far since watching began. "now": as of the latest watched census. */
  kind: "best" | "now";
  /** The rung needs MORE than `target` (the gene rungs: more than half). */
  above?: true;
  /** `value` is floored to this many decimals (long body: 1), not a whole number. */
  decimals?: 1;
}

interface State {
  watchedFrom: number | null;
  lastStep: number | null;
  censuses: number;
  baseline: FirstsStats | null;
  latest: FirstsStats | null;
  baselineFissions: number;
  starting: string[];
  startingPresent: number;
  entries: FirstsEntry[];
  /** Body id -> where the log first saw it: [id, x, y, tile]. Emptied once the far-traveller rule fired. */
  seen: [number, number, number, number][];
  /** Non-starting lineage key -> first census step of its current unbroken run at 16 cells or more. Emptied once lineage-20k fired. */
  held: [string, number][];
  /**
   * The eligible lineages with the most cells at the latest census: [key, first census of the streak, censuses in it]. Eligible: not a
   * starting lineage and, once takeover fired, not the lineage it named. Cleared when takeover fires (counting for takeover-2 starts at
   * the next census) and when takeover-2 fires.
   */
  leads: [string, number, number][];
  /** The lineage the takeover rung named, null until it fired. */
  takeoverKey: string | null;
  /** Progress counters for Next up, as of the censuses watched. */
  bestBody: number;
  bestGen: number;
  /** The farthest any tracked body has moved from where the log first saw it (cells, unrounded). */
  farthest: number;
  lastFissions: number;
  /** Per ctx.geneBits index: the best share (whole percent, floored) of one body's cells carrying the bit, at the latest census. */
  geneShare: number[];
  lastBodyStep: number | null;
  bodiesLost: number;
  bodiesLostAtCycle: number;
  emptiedAt: number | null;
  everLiving: boolean;
  /** v2. The latest (up to moveCensuses) censuses: [step, [body id, cx, cy, tile][]], oldest first, the latest included. */
  trail: [number, [number, number, number, number][]][];
  /** v2. The largest share (whole percent, floored) of a pond's body cells in bodies moving by the rule, at the latest census. */
  movingShare: number;
  /** v2. The longest elongation seen among bodies of longBody cells or more (unrounded). */
  bestLong: number;
  /**
   * v2. Per tile, within the current cycle: `cur` the lineage strictly leading now, [key, first census of its run, censuses in the run];
   * `est` the first lineage to complete changeCensuses in a row, [key, first census of its run, census that completed it].
   */
  pondLead: { cur: [string, number, number] | null; est: [string, number, number] | null }[];
  /** v2. Per tile: cells in bodies at the latest census. */
  pondCells: number[];
  /** v2. Wounds that count and are still on their clock: [step, tile, radius, cycle, cells the pond's bodies lost]. */
  wounds: [number, number, number, number, number][];
  /** v2. The family tree's longest split-candidate run at the latest census (0 with no tree). */
  candidateRun: number;
}

function freshState(): State {
  return {
    watchedFrom: null, lastStep: null, censuses: 0, baseline: null, latest: null, baselineFissions: 0, starting: [], startingPresent: 0, entries: [],
    seen: [], held: [], leads: [], takeoverKey: null, bestBody: 0, bestGen: 0, farthest: 0, lastFissions: 0, geneShare: [],
    lastBodyStep: null, bodiesLost: 0, bodiesLostAtCycle: 0, emptiedAt: null, everLiving: false,
    trail: [], movingShare: 0, bestLong: 0, pondLead: [], pondCells: [], wounds: [], candidateRun: 0,
  };
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStats = (v: unknown): boolean => v === null || (!!v && typeof v === "object" && ["bodies", "largestBody", "maxGeneration", "lineages"].every((k) => isInt((v as Record<string, unknown>)[k])));

function validContext(c: unknown): c is FirstsContext {
  if (!c || typeof c !== "object") return false;
  const x = c as Record<string, unknown>;
  return (
    isNum(x.tileW) && isNum(x.tileH) && isInt(x.tilesX) && x.tilesX >= 1 && isInt(x.tiles) && x.tiles >= x.tilesX && x.tiles % x.tilesX === 0 && isInt(x.censusEvery) &&
    (x.pondPeriod === undefined || (isInt(x.pondPeriod) && x.pondPeriod >= 1)) && typeof x.pondReseeds === "boolean" && (!x.pondReseeds || x.pondPeriod !== undefined) &&
    Array.isArray(x.geneBits) && x.geneBits.every((b) => Number.isInteger(b) && b >= 0 && b < 8)
  );
}

export class FirstsDetector {
  private readonly ctx: FirstsContext;
  private readonly rules: Map<string, FirstsRule>;
  private s: State = freshState();

  constructor(ctx: FirstsContext) {
    this.ctx = structuredClone({ ...ctx, geneBits: [...ctx.geneBits] });
    this.rules = new Map(firstsRules(this.ctx.geneBits).map((r) => [r.id, r]));
    this.s.geneShare = this.ctx.geneBits.map(() => 0);
    this.s.pondLead = Array.from({ length: this.ctx.tiles }, () => ({ cur: null, est: null }));
    this.s.pondCells = Array.from({ length: this.ctx.tiles }, () => 0);
  }

  /** The period of reseeding cycles, null when the world has none (the whole history is then one cycle). */
  private get period(): number | null {
    const p = this.ctx.pondPeriod;
    return this.ctx.pondReseeds && p !== undefined && p >= 1 ? p : null;
  }

  /** Which cycle a census belongs to: the census at a boundary b is pre-cycle and belongs to the cycle ending at b. */
  private cycleOf(step: number): number {
    const p = this.period;
    return p === null ? 0 : Math.floor(Math.max(step - 1, 0) / p);
  }

  /** Is there a reseeding boundary b with lo <= b <= hi? */
  private boundaryIn(lo: number, hi: number): boolean {
    const p = this.period;
    if (p === null || hi < lo) return false;
    return Math.floor(hi / p) > Math.floor((Math.max(lo, 1) - 1) / p);
  }

  /** The wound horizon H: 1,000 steps, or half the pond period if that is shorter (a world with no pond period: 1,000). */
  private get horizon(): number {
    const p = this.ctx.pondPeriod;
    return p === undefined ? FIRSTS_THRESHOLDS.woundSteps : Math.min(FIRSTS_THRESHOLDS.woundSteps, p / 2);
  }

  get watchedFrom(): number | null {
    return this.s.watchedFrom;
  }

  /** Latest observed census step, or null. */
  get lastStep(): number | null {
    return this.s.lastStep;
  }

  entries(): readonly FirstsEntry[] {
    return this.s.entries;
  }

  private has(id: string): boolean {
    return this.s.entries.some((e) => e.id === id);
  }

  /**
   * A census with `input.step <= lastStep` is a no-op returning []. Returns the entries newly fired
   * at this census, in rule-table order (the fixed rules, then gene bits in order). Copies what it
   * keeps: the caller may feed it from views that the next step overwrites.
   */
  observe(input: FirstsInput): FirstsEntry[] {
    const s = this.s;
    if (s.lastStep !== null && input.step <= s.lastStep) return [];
    const first = s.watchedFrom === null;
    const prevStep = s.lastStep;
    const step = input.step;
    const { tileW, tileH } = this.ctx;
    const pond = (tile: number) => (this.ctx.tiles > 1 ? `, in pond ${tile + 1}` : "");

    // Stats and the witnesses: the largest body (ties: the smaller id), the deepest generation
    // (ties: the larger body, then the smaller id).
    let largest: FirstsBody | null = null;
    let deepest: FirstsBody | null = null;
    for (const b of input.bodies) {
      if (!largest || b.cells > largest.cells || (b.cells === largest.cells && b.id < largest.id)) largest = b;
      if (!deepest || b.generation > deepest.generation || (b.generation === deepest.generation && (b.cells > deepest.cells || (b.cells === deepest.cells && b.id < deepest.id)))) deepest = b;
    }
    const stats: FirstsStats = { bodies: input.bodies.length, largestBody: largest?.cells ?? 0, maxGeneration: deepest?.generation ?? 0, lineages: input.lineages.length };

    if (first) {
      s.watchedFrom = step;
      s.baseline = { ...stats };
      s.baselineFissions = input.fissions;
      s.starting = input.lineages.map((l) => l.key);
    } else {
      // The first census's deaths happened before the log was watching.
      s.bodiesLost += input.deaths;
      const { pondPeriod, censusEvery } = this.ctx;
      if (pondPeriod !== undefined && step > censusEvery && (step - censusEvery) % pondPeriod === 0) s.bodiesLostAtCycle += input.deaths;
    }
    const starting = new Set(s.starting);
    s.startingPresent = 0;
    for (const l of input.lineages) if (starting.has(l.key) && l.cells > 0) s.startingPresent++;
    s.latest = stats;
    s.lastStep = step;
    s.censuses++;
    if (input.bodies.length) s.lastBodyStep = step;
    if (input.livingCells > 0) s.everLiving = true;
    else if (s.everLiving && s.emptiedAt === null) s.emptiedAt = step;

    s.bestBody = Math.max(s.bestBody, stats.largestBody);
    s.bestGen = Math.max(s.bestGen, stats.maxGeneration);
    s.lastFissions = input.fissions;

    // The scans first (travel, held, leads), then the rules fire in table order below.
    // Traveller and far traveller: a body counts only if it was matched at every census since the log first saw it,
    // so every id absent from this census loses its origin. Distance is on the body's own tile torus. The farthest
    // body (ties: the smaller id) is the witness for both: the one at 16 or more is also the one at 32 or more if any.
    let far: FirstsBody | null = null;
    let farD = 0;
    if (this.has("far-traveller")) s.seen = [];
    else {
      const origin = new Map(s.seen.map((o) => [o[0], o] as const));
      const next: [number, number, number, number][] = [];
      for (const b of input.bodies) {
        const o = origin.get(b.id);
        if (!o || o[3] !== b.tile) {
          next.push([b.id, b.cx, b.cy, b.tile]);
          continue;
        }
        next.push(o);
        const dx = Math.abs(b.cx - o[1]);
        const dy = Math.abs(b.cy - o[2]);
        const d = Math.hypot(Math.min(dx, tileW - dx), Math.min(dy, tileH - dy));
        if (!far || d > farD || (d === farD && b.id < far.id)) [far, farD] = [b, d];
      }
      s.seen = next;
      if (far) s.farthest = Math.max(s.farthest, farD);
      if (far && farD >= FIRSTS_THRESHOLDS.farTravel) s.seen = [];
    }

    // New lineage to last, and the 20,000-step one: per non-starting key, the first census of its unbroken run at 16 cells
    // or more. Each rung names the lineage whose run is longest (ties: the smaller key) among those that completed its steps.
    let held5: { key: string; since: number; cells: number } | null = null;
    let held20: { key: string; since: number; cells: number } | null = null;
    if (this.has("lineage-20k")) s.held = [];
    else {
      const since = new Map(s.held);
      const next: [string, number][] = [];
      const better = (best: { key: string; since: number } | null, from: number, key: string) => !best || from < best.since || (from === best.since && key < best.key);
      for (const l of input.lineages) {
        if (starting.has(l.key) || l.cells < FIRSTS_THRESHOLDS.lineageCells) continue;
        const from = since.get(l.key) ?? step;
        next.push([l.key, from]);
        if (step - from >= FIRSTS_THRESHOLDS.lineageSteps && better(held5, from, l.key)) held5 = { key: l.key, since: from, cells: l.cells };
        if (step - from >= FIRSTS_THRESHOLDS.longLineageSteps && better(held20, from, l.key)) held20 = { key: l.key, since: from, cells: l.cells };
      }
      s.held = next;
      if (held20) s.held = [];
    }

    // Takeover and second takeover: an eligible lineage has had the most cells at ten censuses in a row. Every lineage tied
    // for the most cells has the most; a census at which a lineage is not among them (or the jar is empty) ends its streak.
    // Two qualifying at once: the longer lead, then the smaller key, is named. Eligible: not a starting lineage and, once
    // takeover has fired, not the lineage it named. "The most cells" is over every lineage. Counting for the second
    // takeover starts at the census after the first fired (that census clears the streaks).
    let takeoverWon: [string, number, number] | undefined;
    let takeover2Won: [string, number, number] | undefined;
    if (!this.has("takeover-2")) {
      const afterFirst = this.has("takeover");
      let most = 0;
      for (const l of input.lineages) if (l.cells > most) most = l.cells;
      const prev = new Map(s.leads.map(([key, since, streak]) => [key, [since, streak]] as const));
      const next: [string, number, number][] = [];
      if (most > 0)
        for (const l of input.lineages) {
          if (l.cells !== most || starting.has(l.key) || l.key === s.takeoverKey) continue;
          const p = prev.get(l.key);
          next.push(p ? [l.key, p[0], p[1] + 1] : [l.key, step, 1]);
        }
      next.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      s.leads = next;
      const won = next.find(([, , streak]) => streak >= FIRSTS_THRESHOLDS.leadCensuses);
      if (won && afterFirst) {
        takeover2Won = won;
        s.leads = [];
      } else if (won) {
        takeoverWon = won;
        s.takeoverKey = won[0];
        s.leads = [];
      }
    }

    // Gene carriers: a body with more than half of its cells carrying the bit (gene worlds only).
    const geneWitness = this.ctx.geneBits.map((_, j) => {
      let best: FirstsBody | null = null;
      let share = 0;
      for (const b of input.bodies) {
        const g = b.geneCells?.[j] ?? 0;
        if (b.cells > 0) share = Math.max(share, Math.floor((100 * g) / b.cells));
        if (g * 2 <= b.cells) continue;
        const bg = best?.geneCells?.[j] ?? 0;
        if (!best || g > bg || (g === bg && (b.cells > best.cells || (b.cells === best.cells && b.id < best.id)))) best = b;
      }
      s.geneShare[j] = share;
      return best;
    });

    // v2 scans. A new reseeding cycle (the first census after a boundary) starts every pond's leads afresh; moving-pond and the wound
    // clocks test the cycle where they use it.
    const T = FIRSTS_THRESHOLDS;
    const tiles = this.ctx.tiles;
    const curCycle = this.cycleOf(step);
    if (prevStep !== null && this.cycleOf(prevStep) !== curCycle) s.pondLead = Array.from({ length: tiles }, () => ({ cur: null, est: null }));
    const pondOf = Array.from({ length: tiles }, () => ({ bodies: 0, cells: 0, mBodies: 0, mCells: 0 }));
    for (const b of input.bodies) {
      const p = pondOf[b.tile];
      if (!p) continue;
      p.bodies++;
      p.cells += b.cells;
    }

    // Moving pond: a body moves when it was matched at each of the last moveCensuses + 1 censuses (all in this cycle) and its centroid is
    // moveCells or more from where it was then, on its own pond's torus. A pond qualifies with at least movingBodies such bodies holding at
    // least half of the pond's body cells. The pond named has the largest share of moving cells (compared exactly), then the smaller index.
    const moving = new Set<number>();
    if (s.trail.length === T.moveCensuses && !this.boundaryIn(s.trail[0][0], step - 1)) {
      const old = new Map(s.trail[0][1].map((r) => [r[0], r] as const));
      const later = s.trail.slice(1).map((t) => new Set(t[1].map((r) => r[0])));
      for (const b of input.bodies) {
        const o = old.get(b.id);
        if (!o || o[3] !== b.tile || !later.every((z) => z.has(b.id))) continue;
        const dx = Math.abs(b.cx - o[1]);
        const dy = Math.abs(b.cy - o[2]);
        if (Math.hypot(Math.min(dx, tileW - dx), Math.min(dy, tileH - dy)) >= T.moveCells) moving.add(b.id);
      }
    }
    let movingWin: { pond: number; mBodies: number; bodies: number; mCells: number; cells: number } | null = null;
    s.movingShare = 0;
    for (const b of input.bodies) {
      const p = pondOf[b.tile];
      if (p && moving.has(b.id)) {
        p.mBodies++;
        p.mCells += b.cells;
      }
    }
    pondOf.forEach((p, i) => {
      if (p.cells <= 0) return;
      s.movingShare = Math.max(s.movingShare, Math.floor((100 * p.mCells) / p.cells));
      if (p.mBodies < T.movingBodies || 2 * p.mCells < p.cells) return;
      // share a/b > c/d <=> a*d > c*b
      if (!movingWin || p.mCells * movingWin.cells > movingWin.mCells * p.cells) movingWin = { pond: i, mBodies: p.mBodies, bodies: p.bodies, mCells: p.mCells, cells: p.cells };
    });

    // Long body: the witness has the largest elongation among bodies of longBody cells or more (ties: more cells, then the smaller id).
    let longest: FirstsBody | null = null;
    for (const b of input.bodies) {
      if (b.cells < T.longBody) continue;
      s.bestLong = Math.max(s.bestLong, b.elongation);
      if (b.elongation < T.longRatio) continue;
      if (!longest || b.elongation > longest.elongation || (b.elongation === longest.elongation && (b.cells > longest.cells || (b.cells === longest.cells && b.id < longest.id)))) longest = b;
    }

    // Change of hands: per pond, a strict lead (exactly one lineage with the most cells) extends the run of that lineage, anything else
    // ends it. The first lineage to complete changeCensuses in a row is the pond's established leader; a different lineage that
    // completes a run which began after the leader's run completed fires the rung. Several at once: the run that began first, then the
    // smaller pond, then the smaller key.
    let changeWin: { pond: number; key: string; since: number; est: [string, number, number] } | null = null;
    if (this.has("pond-change")) s.pondLead = Array.from({ length: tiles }, () => ({ cur: null, est: null }));
    else {
      s.pondLead.forEach((st, p) => {
        const leaders = input.pondLeaders?.[p] ?? [];
        if (leaders.length !== 1) {
          st.cur = null;
          return;
        }
        const key = leaders[0];
        st.cur = st.cur && st.cur[0] === key ? [key, st.cur[1], st.cur[2] + 1] : [key, step, 1];
        if (st.cur[2] < T.changeCensuses) return;
        if (!st.est) st.est = [key, st.cur[1], step];
        else if (key !== st.est[0] && st.cur[1] > st.est[2]) {
          const better = !changeWin || st.cur[1] < changeWin.since || (st.cur[1] === changeWin.since && (p < changeWin.pond || (p === changeWin.pond && key < changeWin.key)));
          if (better) changeWin = { pond: p, key, since: st.cur[1], est: st.est };
        }
      });
    }

    // Outlive a wound. A lesion in [previous census, this census) counts when no reseeding boundary b lies between that census and the
    // lesion (inclusive) and its pond's body cells dropped from the previous census to this one. Each counted wound has its own clock
    // over this cycle; it fails at a census where its pond holds no body, ends unfired at the next cycle, and fires at the first census
    // at or after w + H. Several at once: the earlier wound, then the smaller pond.
    let woundWin: { w: number; tile: number; r: number; lost: number; bodies: number } | null = null;
    if (this.has("outlive-wound")) s.wounds = [];
    else {
      for (const w of input.wounds ?? []) {
        if (prevStep === null || w.step < prevStep || w.step >= step || !(w.tile >= 0 && w.tile < tiles)) continue;
        if (this.boundaryIn(prevStep, w.step)) continue;
        const lost = s.pondCells[w.tile] - pondOf[w.tile].cells;
        if (lost > 0) s.wounds.push([w.step, w.tile, w.r, this.cycleOf(prevStep), lost]);
      }
      const keep: [number, number, number, number, number][] = [];
      const due: [number, number, number, number, number][] = [];
      for (const wd of s.wounds) {
        if (wd[3] !== curCycle || pondOf[wd[1]].bodies === 0) continue;
        (step >= wd[0] + this.horizon ? due : keep).push(wd);
      }
      s.wounds = keep;
      due.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (due.length) {
        woundWin = { w: due[0][0], tile: due[0][1], r: due[0][2], lost: due[0][4], bodies: pondOf[due[0][1]].bodies };
        s.wounds = [];
      }
    }
    s.candidateRun = input.family?.candidateRun ?? 0;

    const fired: FirstsEntry[] = [];
    const fire = (id: string, detail: string) => {
      if (this.has(id)) return;
      const entry: FirstsEntry = { id, name: this.rules.get(id)!.name, step, already: first && CAN_BE_ALREADY(id), detail };
      s.entries.push(entry);
      fired.push(entry);
    };
    const cellsLine = (b: FirstsBody) => `${b.cells} cells${pond(b.tile)}`;
    const generationLine = (b: FirstsBody) => `generation ${b.generation}, ${cellsLine(b)}`;
    const heldLine = (h: { key: string; since: number; cells: number }) => `lineage ${h.key}, ${h.cells} cells, holding ${FIRSTS_THRESHOLDS.lineageCells} or more since t=${num(h.since)}`;
    const leadLine = (w: [string, number, number]) => `lineage ${w[0]}, ahead since t=${num(w[1])}`;

    if (largest) fire("body", cellsLine(largest));
    if (largest && largest.cells >= FIRSTS_THRESHOLDS.big) fire("body-40", cellsLine(largest));
    if (largest && largest.cells >= FIRSTS_THRESHOLDS.large) fire("body-100", cellsLine(largest));
    if (input.fissions > s.baselineFissions) {
      const n = input.fissions - s.baselineFissions;
      fire("split", `${n} split${n === 1 ? "" : "s"} counted since t=${num(s.watchedFrom!)}`);
    }
    if (deepest && deepest.generation >= 2) fire("grandchild", generationLine(deepest));
    if (deepest && deepest.generation >= 5) fire("gen-5", generationLine(deepest));
    if (far && farD >= FIRSTS_THRESHOLDS.travel) fire("traveller", `moved ${farD.toFixed(1)} cells${pond(far.tile)}`);
    if (held5) fire("new-lineage", heldLine(held5));
    if (takeoverWon) fire("takeover", leadLine(takeoverWon));
    if (largest && largest.cells >= FIRSTS_THRESHOLDS.huge) fire("body-250", cellsLine(largest));
    if (deepest && deepest.generation >= 10) fire("gen-10", generationLine(deepest));
    if (far && farD >= FIRSTS_THRESHOLDS.farTravel) fire("far-traveller", `moved ${farD.toFixed(1)} cells${pond(far.tile)}`);
    if (held20) fire("lineage-20k", heldLine(held20));
    if (takeover2Won) fire("takeover-2", leadLine(takeover2Won));
    if (movingWin) {
      const m = movingWin as { pond: number; mBodies: number; bodies: number; mCells: number; cells: number };
      fire("moving-pond", `${tiles > 1 ? `pond ${m.pond + 1}: ` : ""}${m.mBodies} of ${m.bodies} bodies, ${m.mCells} of ${m.cells} cells, moving`);
    }
    if (longest) fire("long-body", `${(Math.floor(longest.elongation * 10 + 1e-9) / 10).toFixed(1)} times as long as wide, ${cellsLine(longest)}`);
    if (changeWin) {
      const w = changeWin as { pond: number; key: string; since: number; est: [string, number, number] };
      fire("pond-change", `lineage ${w.est[0]} led from t=${num(w.est[1])}; lineage ${w.key} ahead since t=${num(w.since)}${pond(w.pond)}`);
    }
    if (woundWin) {
      const w = woundWin as { w: number; tile: number; r: number; lost: number; bodies: number };
      fire("outlive-wound", `wounded at t=${num(w.w)} (radius ${w.r}, ${w.lost} cells lost), ${w.bodies} bod${w.bodies === 1 ? "y" : "ies"} now${pond(w.tile)}`);
    }
    if (input.family && input.family.splits.length) {
      const f = input.family.splits[0];
      fire("new-family", `${f.name} from ${f.parentName}, ${f.cells} and ${f.parentCells} cells`);
    }
    this.ctx.geneBits.forEach((bit, j) => {
      const best = geneWitness[j];
      if (best) fire(`gene-${bit}`, `${best.geneCells![j]} of ${best.cells} cells carry it${pond(best.tile)}`);
    });

    // What the next census compares with.
    if (this.has("pond-change")) s.pondLead = Array.from({ length: tiles }, () => ({ cur: null, est: null }));
    if (this.has("moving-pond")) s.trail = [];
    else {
      s.trail.push([step, input.bodies.map((b) => [b.id, b.cx, b.cy, b.tile] as [number, number, number, number])]);
      if (s.trail.length > T.moveCensuses) s.trail.shift();
    }
    s.pondCells = pondOf.map((p) => p.cells);

    return fired;
  }

  summary(): FirstsSummary {
    const s = this.s;
    return {
      ruleSet: FIRSTS_RULESET,
      watchedFrom: s.watchedFrom,
      step: s.lastStep,
      baseline: s.baseline ? { ...s.baseline } : null,
      latest: s.latest ? { ...s.latest } : null,
      startingLineages: s.starting.length,
      startingLineagesPresent: s.startingPresent,
      lastBodyStep: s.lastBodyStep,
      bodiesLost: s.bodiesLost,
      bodiesLostAtCycle: s.bodiesLostAtCycle,
      emptiedAt: s.emptiedAt,
      censuses: s.censuses,
    };
  }

  /**
   * The first `count` rungs of the ladder (then the gene rungs, bit ascending) that have not fired, each with its progress. Pure
   * read of the detector's counters: before any census every value is 0, and a replay that feeds the same censuses shows the same.
   */
  nextUp(count = 3): NextUpItem[] {
    const s = this.s;
    const T = FIRSTS_THRESHOLDS;
    const out: NextUpItem[] = [];
    const want = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 3;
    const item = (id: string): NextUpItem => {
      const base = { id, name: this.rules.get(id)!.name };
      const best = (value: number, target: number, unit: string): NextUpItem => ({ ...base, value, target, unit, kind: "best" });
      const now = (value: number, target: number, unit: string): NextUpItem => ({ ...base, value, target, unit, kind: "now" });
      const run = s.held.reduce((m, [, from]) => Math.max(m, (s.lastStep ?? from) - from), 0);
      const streak = s.leads.reduce((m, l) => Math.max(m, l[2]), 0);
      switch (id) {
        case "body": return best(s.bestBody, 1, "cells");
        case "body-40": return best(s.bestBody, T.big, "cells");
        case "body-100": return best(s.bestBody, T.large, "cells");
        case "body-250": return best(s.bestBody, T.huge, "cells");
        case "split": return best(Math.max(0, s.lastFissions - s.baselineFissions), 1, "splits");
        case "grandchild": return best(s.bestGen, 2, "generations");
        case "gen-5": return best(s.bestGen, 5, "generations");
        case "gen-10": return best(s.bestGen, 10, "generations");
        case "traveller": return best(Math.floor(s.farthest), T.travel, "cells moved");
        case "far-traveller": return best(Math.floor(s.farthest), T.farTravel, "cells moved");
        case "new-lineage": return now(run, T.lineageSteps, "steps");
        case "lineage-20k": return now(run, T.longLineageSteps, "steps");
        case "takeover": return now(streak, T.leadCensuses, "censuses");
        case "takeover-2": return now(this.has("takeover") ? streak : 0, T.leadCensuses, "censuses");
        case "moving-pond": return now(s.movingShare, 50, "% of a pond’s body cells");
        case "long-body": return { ...best(Math.floor(s.bestLong * 10 + 1e-9) / 10, T.longRatio, "times as long as wide"), decimals: 1 };
        case "pond-change": return now(s.pondLead.reduce((m, p) => (p.est && p.cur && p.cur[0] !== p.est[0] ? Math.max(m, p.cur[2]) : m), 0), T.changeCensuses, "censuses");
        case "outlive-wound": return now(s.wounds.reduce((m, w) => Math.max(m, (s.lastStep ?? w[0]) - w[0]), 0), this.horizon, "steps");
        case "new-family": return now(s.candidateRun, 5000, "steps");
        default: {
          const j = this.ctx.geneBits.indexOf(Number(id.slice("gene-".length)));
          return { ...now(s.geneShare[j] ?? 0, 50, "% of a body’s cells"), above: true };
        }
      }
    };
    const order = [...FIRSTS_LADDER, ...this.ctx.geneBits.map((b) => `gene-${b}`)];
    for (const id of order) {
      if (out.length >= want) break;
      if (!this.has(id)) out.push(item(id));
    }
    return out;
  }

  snapshot(): FirstsSnapshot {
    return structuredClone({ v: 3 as const, ruleSet: FIRSTS_RULESET, ctx: this.ctx, ...this.s }) as FirstsSnapshot;
  }

  /** The v2 fields of a snapshot, as strictly as the others. */
  private static validV2(snap: Record<string, unknown>): boolean {
    const ctx = snap.ctx as FirstsContext;
    const T = FIRSTS_THRESHOLDS;
    const entries = snap.entries as FirstsEntry[];
    const done = (id: string) => entries.some((e) => e.id === id);
    const pair = (p: unknown, kinds: ((v: unknown) => boolean)[]) => Array.isArray(p) && p.length === kinds.length && kinds.every((k, i) => k(p[i]));
    const str = (v: unknown) => typeof v === "string";
    const lastStep = snap.lastStep as number | null;
    const trailOk =
      Array.isArray(snap.trail) && snap.trail.length <= T.moveCensuses &&
      snap.trail.every((t, i, all) =>
        pair(t, [isInt, Array.isArray]) &&
        (t[1] as unknown[]).every((r) => pair(r, [isInt, isNum, isNum, (v) => isInt(v) && (v as number) < ctx.tiles])) &&
        (i === 0 || (all[i - 1] as [number])[0] < t[0]) &&
        t[0] <= (lastStep ?? -1)) &&
      (snap.trail.length === 0 || (snap.trail[snap.trail.length - 1] as [number])[0] === lastStep) &&
      (!done("moving-pond") || snap.trail.length === 0);
    const run = (v: unknown) => v === null || pair(v, [str, isInt, (n) => isInt(n) && (n as number) >= 1]);
    const leadsOk =
      Array.isArray(snap.pondLead) && snap.pondLead.length === ctx.tiles &&
      snap.pondLead.every((p) => !!p && typeof p === "object" && run((p as Record<string, unknown>).cur) && run((p as Record<string, unknown>).est));
    return (
      trailOk && leadsOk &&
      isInt(snap.movingShare) && (snap.movingShare as number) <= 100 && isNum(snap.bestLong) && (snap.bestLong as number) >= 0 &&
      Array.isArray(snap.pondCells) && snap.pondCells.length === ctx.tiles && snap.pondCells.every(isInt) &&
      Array.isArray(snap.wounds) && (snap.wounds as unknown[]).every((w) => pair(w, [isInt, (t) => isInt(t) && (t as number) < ctx.tiles, (r) => isNum(r) && (r as number) >= 0, isInt, (l) => isInt(l) && (l as number) > 0])) &&
      (!done("outlive-wound") || snap.wounds.length === 0) &&
      isInt(snap.candidateRun)
    );
  }

  /**
   * Throws only on a snapshot that is not one (wrong v/ruleSet/shape); callers fall back to a fresh detector. A `firsts-v0` snapshot
   * (v 1) is refused, not upgraded: it lacks the best-so-far counters and the traveller/new-lineage/takeover state v0 cleared once
   * those rules fired, so no upgrade would be truthful. A `firsts-v1` snapshot (v 2) is refused for the same reason: it lacks the
   * motion trail, the per-pond leads, the pond cells and the wound clocks the v2 rungs read.
   */
  static restore(snapshot: FirstsSnapshot): FirstsDetector {
    const snap = structuredClone(snapshot) as unknown as Record<string, unknown>;
    if (!snap || typeof snap !== "object" || snap.v !== 3 || snap.ruleSet !== FIRSTS_RULESET || !validContext(snap.ctx)) throw new Error("not a firsts snapshot");
    const maybe = (v: unknown) => v === null || isInt(v);
    const rules = new Set(firstsRules(snap.ctx.geneBits).map((r) => r.id));
    const pair = (p: unknown, kinds: ((v: unknown) => boolean)[]) => Array.isArray(p) && p.length === kinds.length && kinds.every((k, i) => k(p[i]));
    const ok =
      maybe(snap.watchedFrom) && maybe(snap.lastStep) && isInt(snap.censuses) && isStats(snap.baseline) && isStats(snap.latest) &&
      isInt(snap.baselineFissions) && Array.isArray(snap.starting) && snap.starting.every((k) => typeof k === "string") && isInt(snap.startingPresent) &&
      Array.isArray(snap.entries) &&
      snap.entries.every((e) => !!e && typeof e === "object" && rules.has(e.id) && typeof e.name === "string" && isInt(e.step) && typeof e.already === "boolean" && typeof e.detail === "string") &&
      new Set((snap.entries as FirstsEntry[]).map((e) => e.id)).size === snap.entries.length &&
      Array.isArray(snap.seen) && snap.seen.every((p) => pair(p, [isInt, isNum, isNum, isInt])) &&
      Array.isArray(snap.held) && snap.held.every((p) => pair(p, [(v) => typeof v === "string", isInt])) &&
      Array.isArray(snap.leads) && snap.leads.every((p) => pair(p, [(v) => typeof v === "string", isInt, isInt])) &&
      (snap.takeoverKey === null || typeof snap.takeoverKey === "string") &&
      (snap.takeoverKey !== null) === (snap.entries as FirstsEntry[]).some((e) => e.id === "takeover") &&
      isInt(snap.bestBody) && isInt(snap.bestGen) && isNum(snap.farthest) && (snap.farthest as number) >= 0 && isInt(snap.lastFissions) &&
      Array.isArray(snap.geneShare) && snap.geneShare.length === snap.ctx.geneBits.length && snap.geneShare.every((v) => isInt(v) && v <= 100) &&
      maybe(snap.lastBodyStep) && isInt(snap.bodiesLost) && isInt(snap.bodiesLostAtCycle) && maybe(snap.emptiedAt) && typeof snap.everLiving === "boolean" &&
      (snap.watchedFrom === null) === (snap.lastStep === null) && this.validV2(snap);
    if (!ok) throw new Error("malformed firsts snapshot");
    const d = new FirstsDetector(snap.ctx);
    const { v: _v, ruleSet: _r, ctx: _c, ...state } = snap;
    d.s = state as unknown as State;
    return d;
  }
}

/** The first `count` (default 3) rungs in ladder order that have not fired, each with its progress. Before any census, value 0. */
export function nextUp(detector: FirstsDetector, count = 3): NextUpItem[] {
  return detector.nextUp(count);
}
