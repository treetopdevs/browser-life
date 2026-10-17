// The log of firsts (rule set `firsts-v0`, docs/pond-keeper-v0-2026-10-17.md). A detector reads only
// what the census and the tracker already infer, at each census an observer takes, and records the
// first census at which each fixed rule's condition holds. Observer only: nothing here touches the
// physics, declares a category or scores a world. The thresholds are design choices, stated in the
// note so a player and a replay can check them; a change to a rule is a new rule set id.
//
// The detector is a pure function of the censuses it is fed, in order, so a replay that feeds it the
// same censuses reaches the same log, and a snapshot taken at any census restores to a detector that
// continues exactly as an uninterrupted one would.

import { G, GENE_SHIFT, geneMasks, type WorldConfig } from "@bl/schema";
import { individuals, type Census } from "./census.ts";
import type { LifeEvent, Tracker } from "./tracker.ts";

export const FIRSTS_RULESET = "firsts-v0" as const;
export const FIRSTS_THRESHOLDS = { big: 40, large: 100, travel: 16, lineageCells: 16, lineageSteps: 5000, leadCensuses: 10 } as const;

export interface FirstsRule {
  id: string;
  name: string;
  text: string;
}

/** The nine fixed rules in the note's table order, with the note's names and "Fires at the first census where" text. */
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
  /** tilesX * tilesY: more than 1 means "pond n" can be said. */
  tiles: number;
  censusEvery: number;
  /** cfg.pondPeriod; deaths at (boundary + censusEvery) count as "at a pond cycle". */
  pondPeriod?: number;
  /** Gainable gene bits (bit b of the gene byte), [] when the world has no genes. */
  geneBits: readonly number[];
}

/** From the world's config: tile sizes, pondPeriod, and the gene bits `geneMasks(cfg).set` names. */
export function firstsContext(cfg: WorldConfig, censusEvery: number): FirstsContext {
  const set = geneMasks(cfg).set;
  const geneBits: number[] = [];
  for (let b = 0; b < 8; b++) if ((set >>> (GENE_SHIFT + b)) & 1) geneBits.push(b);
  const ctx: FirstsContext = { tileW: cfg.tileW, tileH: cfg.tileH, tiles: cfg.tilesX * cfg.tilesY, censusEvery, geneBits };
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
  /** Cells carrying gene bit ctx.geneBits[j], aligned with ctx.geneBits; absent without genes. */
  geneCells?: readonly number[];
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
}

/**
 * A pure read of one observed census: call it right after `tracker.update(c)` (generations are
 * the tracker's at that census) and before the next census mutates the tracker. A component the
 * tracker gave no id (cannot happen after `update`) is skipped rather than thrown on.
 */
export function buildFirstsInput(c: Census, tracker: Tracker, genomeHead: Uint32Array | undefined, events: readonly LifeEvent[], ctx: FirstsContext): FirstsInput {
  const bodies: FirstsBody[] = [];
  const slot = new Map<number, number[]>();
  const withGenes = genomeHead !== undefined && ctx.geneBits.length > 0;
  for (const k of individuals(c)) {
    const id = tracker.idOf(k.idx);
    if (id === undefined) continue;
    const body: FirstsBody = { id, generation: tracker.alive.get(id)?.generation ?? 0, cells: k.cells, cx: k.cx, cy: k.cy, tile: k.tile, lineage: k.lineage };
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
  return {
    step: c.step,
    bodies,
    lineages: c.lineages.map((l) => ({ key: l.key, cells: l.cells })),
    fissions: tracker.fissions,
    deaths,
    livingCells: c.livingCells,
  };
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
  v: 1;
  ruleSet: typeof FIRSTS_RULESET;
  ctx: FirstsContext;
  [k: string]: unknown;
}

/** Rules whose condition can already hold at the first watched census. The rest need a later census by their wording. */
const CAN_BE_ALREADY = (id: string) => id === "body" || id === "body-40" || id === "body-100" || id === "grandchild" || id === "gen-5" || id.startsWith("gene-");

/** Thousands separators without locale dependence, so a detail line is the same on every host. */
const num = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

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
  /** Body id -> where the log first saw it: [id, x, y, tile]. Emptied once the traveller rule fired. */
  seen: [number, number, number, number][];
  /** Non-starting lineage key -> first census step of its current unbroken run at 16 cells or more. Emptied once new-lineage fired. */
  held: [string, number][];
  /** The non-starting lineages with the most cells at the latest census: [key, first census of the streak, censuses in it]. */
  leads: [string, number, number][];
  lastBodyStep: number | null;
  bodiesLost: number;
  bodiesLostAtCycle: number;
  emptiedAt: number | null;
  everLiving: boolean;
}

function freshState(): State {
  return {
    watchedFrom: null, lastStep: null, censuses: 0, baseline: null, latest: null, baselineFissions: 0, starting: [], startingPresent: 0, entries: [],
    seen: [], held: [], leads: [], lastBodyStep: null, bodiesLost: 0, bodiesLostAtCycle: 0, emptiedAt: null, everLiving: false,
  };
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStats = (v: unknown): boolean => v === null || (!!v && typeof v === "object" && ["bodies", "largestBody", "maxGeneration", "lineages"].every((k) => isInt((v as Record<string, unknown>)[k])));

function validContext(c: unknown): c is FirstsContext {
  if (!c || typeof c !== "object") return false;
  const x = c as Record<string, unknown>;
  return (
    isNum(x.tileW) && isNum(x.tileH) && isInt(x.tiles) && isInt(x.censusEvery) && (x.pondPeriod === undefined || isInt(x.pondPeriod)) &&
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

    const fired: FirstsEntry[] = [];
    const fire = (id: string, detail: string) => {
      if (this.has(id)) return;
      const entry: FirstsEntry = { id, name: this.rules.get(id)!.name, step, already: first && CAN_BE_ALREADY(id), detail };
      s.entries.push(entry);
      fired.push(entry);
    };
    const cellsLine = (b: FirstsBody) => `${b.cells} cells${pond(b.tile)}`;

    if (largest) fire("body", cellsLine(largest));
    if (largest && largest.cells >= FIRSTS_THRESHOLDS.big) fire("body-40", cellsLine(largest));
    if (largest && largest.cells >= FIRSTS_THRESHOLDS.large) fire("body-100", cellsLine(largest));
    if (input.fissions > s.baselineFissions) {
      const n = input.fissions - s.baselineFissions;
      fire("split", `${n} split${n === 1 ? "" : "s"} counted since t=${num(s.watchedFrom!)}`);
    }
    if (deepest && deepest.generation >= 2) fire("grandchild", `generation ${deepest.generation}, ${cellsLine(deepest)}`);
    if (deepest && deepest.generation >= 5) fire("gen-5", `generation ${deepest.generation}, ${cellsLine(deepest)}`);

    // Traveller: a body counts only if it was matched at every census since the log first saw it,
    // so every id absent from this census loses its origin. Distance is on the body's own tile torus.
    if (this.has("traveller")) s.seen = [];
    else {
      const origin = new Map(s.seen.map((o) => [o[0], o] as const));
      const next: [number, number, number, number][] = [];
      let far: FirstsBody | null = null;
      let farD = 0;
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
        if (d >= FIRSTS_THRESHOLDS.travel && (!far || d > farD || (d === farD && b.id < far.id))) [far, farD] = [b, d];
      }
      s.seen = next;
      if (far) {
        fire("traveller", `moved ${farD.toFixed(1)} cells${pond(far.tile)}`);
        s.seen = [];
      }
    }

    // New lineage to last: per non-starting key, the first census of its unbroken run at 16 cells or more.
    if (this.has("new-lineage")) s.held = [];
    else {
      const since = new Map(s.held);
      const next: [string, number][] = [];
      let best: { key: string; since: number; cells: number } | null = null;
      for (const l of input.lineages) {
        if (starting.has(l.key) || l.cells < FIRSTS_THRESHOLDS.lineageCells) continue;
        const from = since.get(l.key) ?? step;
        next.push([l.key, from]);
        if (step - from >= FIRSTS_THRESHOLDS.lineageSteps && (!best || from < best.since || (from === best.since && l.key < best.key))) best = { key: l.key, since: from, cells: l.cells };
      }
      s.held = next;
      if (best) {
        fire("new-lineage", `lineage ${best.key}, ${best.cells} cells, holding 16 or more since t=${num(best.since)}`);
        s.held = [];
      }
    }

    // Takeover: a non-starting lineage has had the most cells at ten censuses in a row. Every lineage tied for the
    // most cells has the most; a census at which a lineage is not among them (or the jar is empty) ends its streak.
    // Two qualifying at once: the longer lead, then the smaller key, is named.
    if (!this.has("takeover")) {
      let most = 0;
      for (const l of input.lineages) if (l.cells > most) most = l.cells;
      const prev = new Map(s.leads.map(([key, since, streak]) => [key, [since, streak]] as const));
      const next: [string, number, number][] = [];
      if (most > 0)
        for (const l of input.lineages) {
          if (l.cells !== most || starting.has(l.key)) continue;
          const p = prev.get(l.key);
          next.push(p ? [l.key, p[0], p[1] + 1] : [l.key, step, 1]);
        }
      next.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      s.leads = next;
      const won = next.find(([, , streak]) => streak >= FIRSTS_THRESHOLDS.leadCensuses);
      if (won) {
        fire("takeover", `lineage ${won[0]}, ahead since t=${num(won[1])}`);
        s.leads = [];
      }
    }

    // Gene carriers: a body with more than half of its cells carrying the bit (gene worlds only).
    this.ctx.geneBits.forEach((bit, j) => {
      let best: FirstsBody | null = null;
      for (const b of input.bodies) {
        const g = b.geneCells?.[j] ?? 0;
        if (g * 2 <= b.cells) continue;
        const bg = best?.geneCells?.[j] ?? 0;
        if (!best || g > bg || (g === bg && (b.cells > best.cells || (b.cells === best.cells && b.id < best.id)))) best = b;
      }
      if (best) fire(`gene-${bit}`, `${best.geneCells![j]} of ${best.cells} cells carry it${pond(best.tile)}`);
    });

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

  snapshot(): FirstsSnapshot {
    return structuredClone({ v: 1 as const, ruleSet: FIRSTS_RULESET, ctx: this.ctx, ...this.s }) as FirstsSnapshot;
  }

  /** Throws only on a snapshot that is not one (wrong v/ruleSet/shape); callers fall back to a fresh detector. */
  static restore(snapshot: FirstsSnapshot): FirstsDetector {
    const snap = structuredClone(snapshot) as unknown as Record<string, unknown>;
    if (!snap || typeof snap !== "object" || snap.v !== 1 || snap.ruleSet !== FIRSTS_RULESET || !validContext(snap.ctx)) throw new Error("not a firsts snapshot");
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
      maybe(snap.lastBodyStep) && isInt(snap.bodiesLost) && isInt(snap.bodiesLostAtCycle) && maybe(snap.emptiedAt) && typeof snap.everLiving === "boolean" &&
      (snap.watchedFrom === null) === (snap.lastStep === null);
    if (!ok) throw new Error("malformed firsts snapshot");
    const d = new FirstsDetector(snap.ctx);
    const { v: _v, ruleSet: _r, ctx: _c, ...state } = snap;
    d.s = state as unknown as State;
    return d;
  }
}
