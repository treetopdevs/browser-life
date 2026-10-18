// Pond routes of genotype descent in a pond-cycle run (docs/lineage-inspector.md section 8, the rule written
// 2026-10-17 before this code). Genotype descent in a pond run is exactly mutations.tsv, as in any run: the
// cycle mints no lineage id and a landed packet copies every genome word. This module adds what only the
// headless tool checks: that each edge parent -> child of an ancestry is consistent with where the run's own
// records (ponds.tsv, the descent record; picks.jsonl, a cross-check) put the two lineages.
//
//   birth node   a lineage hi:lo first exists in the state at step hi, so it is present in the pre-cycle
//                snapshot of cycle ceil(hi / P), in the tile of cell lo. A founder 0:i is born at cycle 0 in
//                the tiles where the initial world (rebuilt to the manifest's initHash) holds it.
//   walk         from the child's birth node back to the parent's birth cycle, one boundary at a time: in arms
//                scaf, rand and breed, (r, c + 1) comes from (donor of row (c, r), c); in cont from (r, c);
//                in nat and shuf donor -2 (a survivor) means (r, c); donor -1 in any transforming arm is a
//                nutrient-only refill, across which nothing alive crosses. Node 1 grew from the initial world
//                in its own tile (there is no boundary 0).
//   outcome      exact: the walk lands on the parent's birth pond. Each packet on the way is classed: it names
//                the parent as dominant, or holds two or more lineages and does not exclude it, or its columns
//                are absent. Refused (throws): it lands elsewhere, the two were born in one period in different
//                ponds, a packet holds no lineage or only another, or the walk meets a refill. Not recorded
//                (that edge only): a boundary the walk needs has no row; the packets passed before it are still
//                checked.
//
// Pure: no Deno API; bundle files arrive parsed or as line streams. The index keeps one Int32 donor per
// (cycle, recipient) and full rows only for the boundaries a route reads, so a long table streams.
import { decodeKey, parseKey, type Key } from "@bl/lineage";
import { randomKey, type WorldConfig } from "@bl/schema";
import { readPondRows, type ParsedPonds, type PondRecord } from "./pond-lineage.ts";

export type DescentArm = "scaf" | "rand" | "breed" | "cont" | "nat" | "shuf";
const ARMS: readonly DescentArm[] = ["scaf", "rand", "breed", "cont", "nat", "shuf"];

/** Donor value of a (cycle, recipient) the table has no row for. */
const MISSING = -9;

/** ponds.tsv indexed by (cycle, recipient), checked against the run's config. */
export interface PondIndex {
  arm: DescentArm;
  period: number;
  ponds: number;
  /** cfg.seed: the pick check ranks recipients by the run's pond keys. */
  seed: number;
  /** False when the bundle has no ponds.tsv: every needed boundary is then not recorded. */
  present: boolean;
  /** The step the bundle starts at: a boundary at or before it belongs to an earlier bundle. */
  startStep: number;
  /** Donor per recipient for each cycle with a row (-9 where the row is missing). */
  donors: Map<number, Int32Array>;
  /** Full rows keyed cycle x ponds + recipient: every row (`pondIndex`), or only those a route reads (`readPondIndex` + `loadRouteRows`). */
  detail: Map<number, PondRecord>;
  /** Cycles with at least one row, ascending. */
  cycles: number[];
  /** Cycles with fewer rows than ponds (a torn last append). Their missing rows are not recorded. */
  incomplete: number[];
  /** Line number of a torn last line that was dropped, or null. */
  torn: number | null;
}

const isArm = (a: unknown): a is DescentArm => ARMS.includes(a as DescentArm);
const transforms = (arm: DescentArm): boolean => arm !== "cont";
const rowKey = (index: Pick<PondIndex, "ponds">, cycle: number, pond: number): number => cycle * index.ponds + pond;

function indexer(cfg: WorldConfig, opts: { startStep?: number }) {
  const period = cfg.pondPeriod, arm = cfg.pondArm;
  if (period === undefined || !isArm(arm)) throw new Error("not a pond-cycle config: cfg.pondPeriod and cfg.pondArm are required");
  const R = cfg.tilesX * cfg.tilesY;
  const donors = new Map<number, Int32Array>();
  const counts = new Map<number, number>();
  const detail = new Map<number, PondRecord>();
  return {
    add(r: PondRecord, keep: boolean) {
      const at = `ponds.tsv cycle ${r.cycle}, recipient ${r.recipient}`;
      if (r.step !== r.cycle * period) throw new Error(`${at}: step ${r.step}, but cfg.pondPeriod ${period} puts cycle ${r.cycle} at step ${r.cycle * period}`);
      if (r.recipient >= R) throw new Error(`${at}: the run has ${R} ponds`);
      if (r.donor >= R) throw new Error(`${at}: donor ${r.donor} is not a pond (the run has ${R})`);
      if (arm === "cont" && r.donor !== -1) throw new Error(`${at}: arm cont moves nothing, but the row names donor ${r.donor}`);
      if (r.donor === -2 && arm !== "nat" && arm !== "shuf") throw new Error(`${at}: donor -2 (a survivor) in arm ${arm}`);
      let d = donors.get(r.cycle);
      if (!d) donors.set(r.cycle, (d = new Int32Array(R).fill(MISSING)));
      if (d[r.recipient] !== MISSING) throw new Error(`ponds.tsv has two rows for cycle ${r.cycle}, recipient ${r.recipient}`);
      d[r.recipient] = r.donor;
      counts.set(r.cycle, (counts.get(r.cycle) ?? 0) + 1);
      if (keep) detail.set(r.cycle * R + r.recipient, r);
    },
    finish(present: boolean, torn: number | null): PondIndex {
      const cycles = [...donors.keys()].sort((a, b) => a - b);
      return { arm, period, ponds: R, seed: cfg.seed, present, startStep: opts.startStep ?? 0, donors, detail, cycles, incomplete: cycles.filter((c) => counts.get(c)! < R), torn };
    },
  };
}

/**
 * Indexes ponds.tsv rows for the walk, keeping every row. Throws where the table contradicts the config: a row off
 * cycle x pondPeriod, a recipient or donor that is not a pond, a donor in arm cont, a survivor (-2) outside nat and
 * shuf, or a repeated (cycle, recipient). `parsed` null means the bundle has no ponds.tsv.
 */
export function pondIndex(parsed: ParsedPonds | null, cfg: WorldConfig, opts: { startStep?: number } = {}): PondIndex {
  const ix = indexer(cfg, opts);
  for (const r of parsed?.rows ?? []) ix.add(r, true);
  return ix.finish(parsed !== null, parsed?.torn ?? null);
}

/** `pondIndex` over a streamed ponds.tsv, keeping donors only; `loadRouteRows` then fetches the rows a route reads. */
export async function readPondIndex(lines: AsyncIterable<string>, cfg: WorldConfig, opts: { startStep?: number } = {}): Promise<PondIndex> {
  const ix = indexer(cfg, opts);
  const parsed = await readPondRows(lines, { onRow: (r) => ix.add(r, false) });
  return ix.finish(true, parsed.torn ?? null);
}

/** Reads ponds.tsv again and keeps the full rows at `keys` (from `routeKeys`) in `index.detail`. */
export async function loadRouteRows(index: PondIndex, lines: AsyncIterable<string>, keys: ReadonlySet<number>): Promise<void> {
  if (!keys.size) return;
  await readPondRows(lines, { onRow: (r) => keys.has(rowKey(index, r.cycle, r.recipient)) && index.detail.set(rowKey(index, r.cycle, r.recipient), r) });
}

/** Where and in which pre-cycle snapshot a lineage first exists. `ponds` null: a founder whose initial tiles are unknown. */
export interface BirthNode {
  key: Key;
  cycle: number;
  ponds: number[] | null;
}

export function birthNode(key: Key, cfg: WorldConfig, initialTiles: Map<Key, number[]> | null): BirthNode {
  const [hi] = parseKey(key);
  if (hi === 0) return { key, cycle: 0, ponds: initialTiles ? (initialTiles.get(key) ?? []) : null };
  const o = decodeKey(key, cfg);
  if (!("tile" in o)) throw new Error(`${key}: not a minted lineage`);
  return { key, cycle: Math.ceil(hi / cfg.pondPeriod!), ponds: [o.tile] };
}

export interface Hop {
  boundary: number;
  from: number;
  to: number;
}

/** A walk; `hops` are the packet transfers passed, in time order (on a stop: those after the stopping boundary). */
export type Walk =
  | { ok: true; pond: number; hops: Hop[] }
  | { ok: false; stop: "not recorded" | "refill"; boundary: number; pond: number; reason: string; hops: Hop[] };

/**
 * Walks the pond records back from node (pond, fromCycle) to cycle toCycle (<= fromCycle). Identity steps (cont, a
 * survivor, cycle 1 from the initial world) are not hops.
 */
export function walkBack(index: PondIndex, pond: number, fromCycle: number, toCycle: number): Walk {
  if (toCycle > fromCycle) throw new Error(`walkBack: cycle ${toCycle} is after ${fromCycle}`);
  const hops: Hop[] = [];
  let p = pond;
  for (let c = fromCycle; c > toCycle; c--) {
    const b = c - 1;
    if (b === 0 || !transforms(index.arm)) continue;
    const donor = index.donors.get(b)?.[p] ?? MISSING;
    if (donor === MISSING) {
      const at = b * index.period;
      const reason = !index.present
        ? "ponds.tsv is absent from the bundle"
        : at <= index.startStep
          ? `boundary ${b} (step ${at}) is not in this bundle, which starts at step ${index.startStep}: the ancestry continues in the earlier bundle`
          : `ponds.tsv has no row for boundary ${b}, pond ${p} (a torn or incomplete table)`;
      return { ok: false, stop: "not recorded", boundary: b, pond: p, reason, hops: hops.reverse() };
    }
    if (donor === -2) continue;
    if (donor === -1) return { ok: false, stop: "refill", boundary: b, pond: p, reason: `pond ${p} was refilled with nutrient only at boundary ${b} (donor -1): nothing alive crossed into it`, hops: hops.reverse() };
    hops.push({ boundary: b, from: donor, to: p });
    p = donor;
  }
  return { ok: true, pond: p, hops: hops.reverse() };
}

// ---- pick log -----------------------------------------------------------------------------------------

/** One `kind: "pick"` line of picks.jsonl (packages/runner/src/picks.ts), with who chose. */
export interface PickLine {
  step: number;
  cycle: number;
  donors: number[];
  by: string | null;
  suggested: number[] | null;
}

function pickReader() {
  const picks: PickLine[] = [];
  let n = 0;
  let held: { line: string; at: number } | null = null;
  const parse = (l: string, at: number, last: boolean): boolean => {
    let o: any;
    try {
      o = JSON.parse(l);
    } catch {
      if (last) return true;
      throw new Error(`picks.jsonl line ${at} is not JSON`);
    }
    if (o?.kind !== "pick") return false;
    const ints = (v: unknown) => Array.isArray(v) && v.every((x) => Number.isSafeInteger(x) && x >= 0);
    if (!Number.isSafeInteger(o.step) || !Number.isSafeInteger(o.cycle) || o.cycle < 1 || !ints(o.donors)) throw new Error(`picks.jsonl line ${at}: a malformed pick line`);
    const prev = picks.length ? picks[picks.length - 1].step : -1;
    if (o.step <= prev) throw new Error(`picks.jsonl line ${at}: step ${o.step} does not follow ${prev}`);
    picks.push({ step: o.step, cycle: o.cycle, donors: o.donors, by: typeof o.by === "string" ? o.by : null, suggested: ints(o.suggested) ? o.suggested : null });
    return false;
  };
  return {
    push(raw: string) {
      const l = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (l === "") return;
      n++;
      if (held) parse(held.line, held.at, false);
      held = { line: l, at: n };
    },
    finish(): { picks: PickLine[]; torn: boolean } {
      const torn = held ? parse(held.line, held.at, true) : false;
      return { picks, torn };
    },
  };
}

/**
 * The pick lines of a picks.jsonl; `failed` lines and other kinds are skipped. Steps must ascend. A last line that
 * is not JSON is a torn append and is dropped (`torn`); any other malformed line throws.
 */
export function readPickLog(lines: Iterable<string>): { picks: PickLine[]; torn: boolean } {
  const r = pickReader();
  for (const l of lines) r.push(l);
  return r.finish();
}

/** `readPickLog` over a line stream. */
export async function readPickLogStream(lines: AsyncIterable<string>): Promise<{ picks: PickLine[]; torn: boolean }> {
  const r = pickReader();
  for await (const l of lines) r.push(l);
  return r.finish();
}

/** Pick-log agreement with ponds.tsv: cycles fully checked, checked on the rows present, without rows, and ponds.tsv boundaries the log lacks. */
export interface PickCheck {
  checked: number;
  partial: number;
  unchecked: number;
  unlogged: number;
}

/**
 * Checks every pick line against ponds.tsv as the runner applies picks (`applyPondCycle`, and the runner's own
 * `picksConsistencyError`): the line's step must be its cycle x period, and every row present at that cycle must
 * name the donor the log's ordered donors assign it, `donors[i % D]`, where i is the recipient's rank among all
 * ponds by its key `randomKey(seed, cycle, pond, 2)` (ties by pond); a log with no donors means every row is -1.
 * Order matters: [1, 3] and [3, 1] assign differently. A disagreement throws. Because the rank is over all ponds,
 * an incomplete cycle still checks its present rows (`partial`). `unlogged` counts ponds.tsv boundaries in this
 * bundle the log does not hold (a picked run logs every boundary, so these come from a torn last line).
 */
export function checkPicks(index: PondIndex, picks: readonly PickLine[]): PickCheck {
  if (picks.length && index.arm !== "scaf" && index.arm !== "rand" && index.arm !== "breed") throw new Error(`picks.jsonl in arm ${index.arm}, which takes no donors`);
  let checked = 0, partial = 0, unchecked = 0;
  const logged = new Set<number>();
  for (const p of picks) {
    if (p.step !== p.cycle * index.period) throw new Error(`picks.jsonl: cycle ${p.cycle} at step ${p.step}, not cycle x pondPeriod (${index.period})`);
    logged.add(p.cycle);
    const d = index.donors.get(p.cycle);
    if (!d) {
      unchecked++;
      continue;
    }
    const order = Array.from({ length: index.ponds }, (_, pond) => ({ pond, key: randomKey(index.seed, p.cycle, pond, 2) })).sort((x, y) => x.key - y.key || x.pond - y.pond);
    const D = p.donors.length;
    let missing = 0;
    order.forEach(({ pond }, i) => {
      const want = D ? p.donors[i % D] : -1, got = d[pond];
      if (got === MISSING) missing++;
      else if (got !== want)
        throw new Error(`picks.jsonl names donors [${p.donors.join(", ")}] at cycle ${p.cycle}, which assign recipient ${pond} donor ${want} (rank ${i} of the run's pond keys), but ponds.tsv's row names donor ${got}: the records disagree`);
    });
    if (missing) partial++;
    else checked++;
  }
  const unlogged = index.cycles.filter((c) => c * index.period > index.startStep && !logged.has(c)).length;
  return { checked, partial, unchecked, unlogged };
}

// ---- route --------------------------------------------------------------------------------------------

export interface Crossing {
  boundary: number;
  step: number;
  /** Donor and recipient pond of the packet. */
  from: number;
  to: number;
  /**
   * named: the packet's dominant lineage is the parent (share = its share of the packet's B+P). not excluded: the
   * packet held two or more lineages and another dominates; the record neither names the parent nor rules it out.
   * not recorded: the table lacks the packet columns, so the parent's presence was not checked.
   */
  carried: "named" | "not excluded" | "not recorded";
  share: number | null;
  packetLineages: number | null;
  /** Who chose this boundary's donors (picks.jsonl), null when the run has no pick log or the log lacks the boundary. */
  by: string | null;
}

export interface RouteEdge {
  parent: Key;
  /** The child lineage, or null for the anchor walk (the subject to its anchor node). */
  child: Key | null;
  /** Where the walk starts: the child's birth node, or the anchor. */
  start: { pond: number; cycle: number };
  /** The parent's birth cycle, where the walk ends. */
  end: number;
  /** exact: the walk landed on the parent's birth pond (see `carried` per crossing for what each packet showed). */
  status: "exact" | "not recorded";
  reason: string | null;
  /** Packet transfers on the walk, in time order (on a not-recorded edge, those after the missing boundary). */
  crossings: Crossing[];
}

export interface PondRoute {
  arm: DescentArm;
  period: number;
  ponds: number;
  /**
   * Where the subject must be: its own birth node (`ponds` its birth tile, a founder's tiles, or null when those
   * are unknown), or a given node (a packet's donor, `pond --genotype`).
   */
  anchor: { ponds: number[] | null; cycle: number; source: "subject birth" | "given" };
  /** Birth node of every chain lineage, root first. */
  births: { key: Key; cycle: number; ponds: number[] | null }[];
  /** One per chain edge, root first, then the anchor walk when the anchor is given. */
  edges: RouteEdge[];
  /** Edges whose walk landed (`exact`) and edges with a boundary missing. */
  exact: number;
  notRecorded: number;
  /** Over every crossing of every edge: what the packet record showed about the parent. */
  crossings: { named: number; notExcluded: number; notRecorded: number };
  picks: (PickCheck & { lines: number; torn: boolean; by: Record<string, number> }) | null;
}

/**
 * What a packet row says the packet held, by the rule the route and `pond --genotype` share: null when the count
 * column is absent (nothing checked); otherwise its lineage count and dominant ("hi:lo", or null when the dominant
 * columns are absent, `domKnown` false). Throws, with `what` naming the packet, on a count of 0 (the packet carried
 * nothing alive, whatever the dominant columns say or whether they exist) and on a count of 1 or more with the
 * dominant columns present but naming none.
 */
export function packetHeld(count: number | null, dominant: string | null, domKnown: boolean, what: string): { count: number; dominant: string | null } | null {
  if (count === null) return null;
  if (count === 0) throw new Error(`${what} holds 0 lineages${dominant ? ` (yet names dominant ${dominant})` : ""}, so it carried nothing alive: the records contradict each other`);
  if (!domKnown) return { count, dominant: null };
  if (dominant === null) throw new Error(`${what} holds ${count} lineage(s) but names no dominant: the row is malformed`);
  return { count, dominant };
}

function carriedBy(r: PondRecord, h: Hop, key: Key, at: string): Pick<Crossing, "carried" | "share" | "packetLineages"> {
  const domKnown = r.domHi !== null && r.domLo !== null;
  const dom = domKnown && (r.domHi! | r.domLo!) !== 0 ? `${r.domHi}:${r.domLo}` : null;
  const packet = `the packet of boundary ${h.boundary} (pond ${h.from} -> ${h.to})`;
  const held = packetHeld(r.packetLineages, dom, domKnown, `${at}: ${packet}`);
  if (held === null || held.dominant === null) return { carried: "not recorded", share: null, packetLineages: r.packetLineages };
  if (held.dominant === key) return { carried: "named", share: r.domShare, packetLineages: held.count };
  if (held.count >= 2) return { carried: "not excluded", share: null, packetLineages: held.count };
  throw new Error(`${at}: ${packet} holds ${held.count} lineage(s), dominant ${held.dominant}, so it cannot have carried ${key}: the records contradict each other`);
}

interface RouteOpts {
  anchor?: { pond: number; cycle: number };
  initialTiles: Map<Key, number[]> | null;
}

function edgeStarts(chain: readonly Key[], cfg: WorldConfig, index: PondIndex, opts: RouteOpts) {
  const births = chain.map((k) => birthNode(k, cfg, opts.initialTiles));
  const starts: { parent: BirthNode; start: { pond: number; cycle: number }; child: Key | null }[] = [];
  for (let i = 1; i < chain.length; i++) starts.push({ parent: births[i - 1], start: { pond: births[i].ponds![0], cycle: births[i].cycle }, child: chain[i] });
  if (opts.anchor) {
    const a = opts.anchor;
    if (!(Number.isInteger(a.pond) && a.pond >= 0 && a.pond < index.ponds && Number.isInteger(a.cycle) && a.cycle >= 0)) throw new Error(`pond anchor (pond ${a.pond}, cycle ${a.cycle}) is not a node of this run`);
    starts.push({ parent: births[births.length - 1], start: { pond: a.pond, cycle: a.cycle }, child: null });
  }
  return { births, starts };
}

/** The ponds.tsv rows (`rowKey`s) a route over `chain` reads: every hop of every edge's walk, up to where it stops. */
export function routeKeys(chain: readonly Key[], cfg: WorldConfig, index: PondIndex, opts: RouteOpts): Set<number> {
  const keys = new Set<number>();
  if (!chain.length) return keys;
  for (const { parent, start } of edgeStarts(chain, cfg, index, opts).starts) {
    if (start.cycle < parent.cycle) continue;
    for (const h of walkBack(index, start.pond, start.cycle, parent.cycle).hops) keys.add(rowKey(index, h.boundary, h.to));
  }
  return keys;
}

/**
 * The pond route of a root-first genotype chain (its last key is the subject). `anchor`, when given, is a node the
 * subject must be present in (a packet's donor node); otherwise the subject's own birth node. `initialTiles` maps
 * founders to their tiles in the initial world (null when it cannot be rebuilt). Throws on any contradiction.
 * `index.detail` must hold every row `routeKeys` names.
 */
export function pondRoute(chain: readonly Key[], cfg: WorldConfig, index: PondIndex, opts: RouteOpts & { picks?: { lines: readonly PickLine[]; torn: boolean } }): PondRoute {
  if (!chain.length) throw new Error("pondRoute: empty chain");
  const by = new Map((opts.picks?.lines ?? []).map((p) => [p.cycle, p.by]));
  let picks: PondRoute["picks"] = null;
  if (opts.picks) {
    const tally: Record<string, number> = {};
    for (const p of opts.picks.lines) tally[p.by ?? "unnamed"] = (tally[p.by ?? "unnamed"] ?? 0) + 1;
    picks = { lines: opts.picks.lines.length, ...checkPicks(index, opts.picks.lines), torn: opts.picks.torn, by: tally };
  }
  const { births, starts } = edgeStarts(chain, cfg, index, opts);
  const edge = (parent: BirthNode, start: { pond: number; cycle: number }, child: Key | null): RouteEdge => {
    const at = child === null ? `${parent.key} at its anchor (pond ${start.pond}, cycle ${start.cycle})` : `${parent.key} -> ${child}`;
    if (start.cycle < parent.cycle)
      throw new Error(child === null ? `${parent.key} was born at cycle ${parent.cycle}, after its anchor (pond ${start.pond}, cycle ${start.cycle})` : `${at}: the child is born before its parent`);
    const base = { parent: parent.key, child, start, end: parent.cycle };
    const w = walkBack(index, start.pond, start.cycle, parent.cycle);
    // Every packet passed is checked, also on a walk that stops: a contradiction already in the record refuses.
    const crossings: Crossing[] = w.hops.map((h) => {
      const row = index.detail.get(rowKey(index, h.boundary, h.to));
      if (!row) throw new Error(`pondRoute: the row of boundary ${h.boundary}, pond ${h.to} was not loaded (loadRouteRows)`);
      return { boundary: h.boundary, step: h.boundary * index.period, from: h.from, to: h.to, ...carriedBy(row, h, parent.key, at), by: by.get(h.boundary) ?? null };
    });
    if (!w.ok) {
      if (w.stop === "refill") throw new Error(`${at}: ${w.reason}, yet the walk to ${parent.key}'s birth at cycle ${parent.cycle} must pass it: the records contradict each other`);
      return { ...base, status: "not recorded", reason: w.reason, crossings };
    }
    if (parent.ponds === null) return { ...base, status: "not recorded", reason: `${parent.key} is a founder and the initial world could not be rebuilt to the manifest's initHash, so its tiles are unknown`, crossings };
    if (!parent.ponds.includes(w.pond)) {
      const where = parent.ponds.length ? `pond${parent.ponds.length > 1 ? "s" : ""} ${parent.ponds.join(", ")}` : "no tile of the initial world";
      if (parent.cycle === start.cycle && child !== null) throw new Error(`${at}: born in the same period (cycle ${start.cycle}) in pond ${start.pond} and ${where}, which no genome crosses within a period`);
      throw new Error(`${at}: the walk through ponds.tsv lands on pond ${w.pond} at cycle ${parent.cycle}, but ${parent.key} was born in ${where}`);
    }
    return { ...base, status: "exact", reason: null, crossings };
  };
  const edges = starts.map((s) => edge(s.parent, s.start, s.child));
  const subject = births[births.length - 1];
  const anchor: PondRoute["anchor"] = opts.anchor ? { ponds: [opts.anchor.pond], cycle: opts.anchor.cycle, source: "given" } : { ponds: subject.ponds, cycle: subject.cycle, source: "subject birth" };
  const notRecorded = edges.filter((e) => e.status === "not recorded").length;
  const all = edges.flatMap((e) => e.crossings);
  return {
    arm: index.arm,
    period: index.period,
    ponds: index.ponds,
    anchor,
    births: births.map((b) => ({ key: b.key, cycle: b.cycle, ponds: b.ponds })),
    edges,
    exact: edges.length - notRecorded,
    notRecorded,
    crossings: { named: all.filter((c) => c.carried === "named").length, notExcluded: all.filter((c) => c.carried === "not excluded").length, notRecorded: all.filter((c) => c.carried === "not recorded").length },
    picks,
  };
}

/**
 * Whether a tracker birth recorded at census `step` links across a pond cycle's grind (protocol v1): it is the first
 * census after a transforming boundary. `afterCycle` is the set of series.jsonl censuses flagged `afterCycle`.
 * Without series.jsonl (null) the census grid is rebuilt as the runner lays it out: censuses every `censusEvery`
 * from `startStep`, the last chunk possibly shorter. The census before `step` is then step - ((step - startStep) mod
 * censusEvery, or censusEvery when that is 0), and the birth crosses when that census was a boundary (a positive
 * multiple of the period; the runner applies a boundary after its census). Arm cont grinds nothing.
 */
export function birthAcrossCycle(step: number, arm: DescentArm, period: number, censusEvery: number, startStep: number, afterCycle: ReadonlySet<number> | null): boolean {
  if (!transforms(arm)) return false;
  if (afterCycle) return afterCycle.has(step);
  const prev = step - ((step - startStep) % censusEvery || censusEvery);
  return prev > 0 && prev % period === 0;
}
