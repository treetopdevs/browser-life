// The pond route of a genotype dossier, drawn in the lineage panel (docs/lineage-inspector.md section 8, "Route
// panel", the rule written 2026-10-18 before this code). It reads `pond` (tools/lib/pond-descent.ts `PondRoute`) as
// the dossier holds it and adds no field: a dossier without `pond`, or with `pond: null`, has no route section.
//
//   lanes    one per pond (every pond when the run has 8 or fewer, otherwise the ponds the route touches), plus a
//            "pond unknown" lane when the root's tiles are unknown.
//   x axis   the step, over the ancestry figure's range and margins, with a tick at every boundary c x P (cycle
//            numbers thinned to about 20 past 40 boundaries, ticks past 200; the caption says so).
//   line     the ancestry: the root from its mint step (a founder from step 0) in the pond its walk lands on; each
//            crossing a vertical step at its boundary from the donor's lane to the recipient's; each mutation at its
//            mint step in the child's birth pond. A not-recorded edge is a dashed stretch from the parent's point to
//            the first recorded point. The line ends at the subject's birth, or at a given anchor node.
//
// One event list (`routeEvents`) feeds both the SVG and the text table, so the two never disagree. Nothing here
// infers where else a lineage lived: the route records boundaries, not occupancy.
import type { Crossing, PondRoute } from "../pond-descent.ts";
import type { GenotypeInput } from "./lineage.ts";
import { escapeHtml, figure, numbersTable, type Evidence, type KeyNumberItem } from "./page.ts";
import { axis, linearScale, num } from "./svg.ts";
import { EXPRESSIONS, endStep, int, marker, pct, svgOpen, text, ticksAndDomain, type Expression } from "./lineage-shared.ts";

// ---- validation -----------------------------------------------------------------------------------------

const ARMS = ["scaf", "rand", "breed", "cont", "nat", "shuf"] as const;
const CARRIED = ["named", "not excluded", "not recorded"] as const;
const DONOR_ARMS: readonly string[] = ["scaf", "rand", "breed"];

function fail(path: string, what: string): never {
  throw new Error(`lineage dossier: ${path} ${what}`);
}
function rec(x: unknown, path: string): Record<string, unknown> {
  if (typeof x !== "object" || x === null || Array.isArray(x)) fail(path, "must be an object");
  return x as Record<string, unknown>;
}
function arr(x: unknown, path: string): unknown[] {
  if (!Array.isArray(x)) fail(path, "must be an array");
  return x;
}
function numAt(x: unknown, path: string, nullable = false): void {
  if (nullable && x === null) return;
  if (typeof x !== "number" || !Number.isFinite(x)) fail(path, `must be a finite number${nullable ? " or null" : ""}`);
}
function strAt(x: unknown, path: string, nullable = false): void {
  if (nullable && x === null) return;
  if (typeof x !== "string") fail(path, `must be a string${nullable ? " or null" : ""}`);
}
function posInt(x: unknown, path: string): void {
  if (!Number.isSafeInteger(x) || (x as number) <= 0) fail(path, "must be a positive integer");
}
function count(x: unknown, path: string, min = 0): number {
  if (!Number.isSafeInteger(x) || (x as number) < min) fail(path, `must be an integer of at least ${min}`);
  return x as number;
}
function pondAt(x: unknown, path: string, ponds: number): void {
  if (!Number.isSafeInteger(x) || (x as number) < 0 || (x as number) >= ponds) fail(path, `must be a pond of the run (0 to ${ponds - 1})`);
}
function pondList(x: unknown, path: string, ponds: number): void {
  arr(x, path).forEach((p, i) => pondAt(p, `${path}[${i}]`, ponds));
}
const samePonds = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** n consecutive boundaries from `first`, in words: listed when few, as a range when many. */
const span = (first: number, n: number): string =>
  n === 0 ? "none" : n <= 12 ? Array.from({ length: n }, (_, j) => first + j).join(", ") : `${first} to ${first + n - 1}`;

/**
 * Checks a dossier's `pond` against its chain (keys root first) as tools/lib/pond-descent.ts `pondRoute` writes it,
 * so the figure draws only what a route can hold and agrees with the key numbers:
 *  - field kinds and domains: counts are non-negative integers, every step (boundary x period, cycle x period) a safe
 *    integer, shares in [0, 1], ponds inside the run;
 *  - one birth per chain lineage, in order, at cycle ceil(hi / P); the anchor equal to the subject's birth node, or
 *    one given node;
 *  - one edge per chain edge (plus the anchor walk when the anchor is given) naming the chain's lineages, starting at
 *    the child's birth node (or the anchor) and ending at the parent's birth cycle; a reason exactly when the walk
 *    is not recorded;
 *  - crossings inside the walk's boundaries, in time order, each landing where the next departs and the last in the
 *    start pond; in scaf, rand and breed every boundary an exact walk passes (a stopped walk: those after the
 *    missing one), in cont none; an exact walk lands on one of the parent's birth ponds; each packet class with the
 *    values it can hold (named: 1 or more lineages; not excluded: 2 or more, no share; not recorded: no share); a
 *    picker only with a pick log, and one its tally names; a minted lineage born in exactly one pond;
 *  - the totals equal to what the edges hold, the pick tally summing to the log's lines, and no pick lines in an arm
 *    that takes no donors.
 * Throws naming the field.
 */
export function validatePondRoute(x: unknown, chain: readonly string[]): void {
  const at = "pond";
  const r = rec(x, at);
  if (!(ARMS as readonly unknown[]).includes(r.arm)) fail(`${at}.arm`, `must be one of ${ARMS.join(", ")}`);
  posInt(r.period, `${at}.period`);
  posInt(r.ponds, `${at}.ponds`);
  const R = r.ponds as number, P = r.period as number;
  const cycleAt = (v: unknown, path: string): number => {
    const c = count(v, path);
    if (!Number.isSafeInteger(c * P)) fail(path, `must put its step (cycle x period ${P}) within the safe integers`);
    return c;
  };
  const births = arr(r.births, `${at}.births`);
  if (births.length !== chain.length) fail(`${at}.births`, `must have one entry per chain lineage (${chain.length}), has ${births.length}`);
  const birth = births.map((b, i) => {
    const o = rec(b, `${at}.births[${i}]`);
    if (o.key !== chain[i]) fail(`${at}.births[${i}].key`, `must be ${chain[i]} (the chain, root first)`);
    const cycle = cycleAt(o.cycle, `${at}.births[${i}].cycle`);
    // A lineage hi:lo first exists in the state at step hi, so in the snapshot of cycle ceil(hi / P); a founder at 0.
    const hi = Number(chain[i].split(":")[0]);
    if (!Number.isSafeInteger(hi) || hi < 0) fail(`${at}.births[${i}].key`, "must be a lineage key hi:lo");
    if (cycle !== Math.ceil(hi / P)) fail(`${at}.births[${i}].cycle`, `must be ${Math.ceil(hi / P)} (${chain[i]} first exists at step ${hi}, period ${P})`);
    if (o.ponds !== null) pondList(o.ponds, `${at}.births[${i}].ponds`, R);
    // A minted lineage is born in its one tile (birthNode); only a founder can hold several, none, or unknown tiles.
    if (hi > 0 && (o.ponds === null || (o.ponds as number[]).length !== 1)) fail(`${at}.births[${i}].ponds`, `must name one pond (${chain[i]} is minted, so it is born in one tile)`);
    return { cycle, ponds: o.ponds as number[] | null };
  });
  const subject = birth[birth.length - 1];
  const a = rec(r.anchor, `${at}.anchor`);
  if (a.ponds !== null) pondList(a.ponds, `${at}.anchor.ponds`, R);
  const anchorCycle = cycleAt(a.cycle, `${at}.anchor.cycle`);
  if (a.source !== "subject birth" && a.source !== "given") fail(`${at}.anchor.source`, 'must be "subject birth" or "given"');
  const given = a.source === "given";
  if (given && (a.ponds === null || (a.ponds as number[]).length !== 1)) fail(`${at}.anchor.ponds`, "must name one pond when the anchor is given");
  if (!given && (anchorCycle !== subject.cycle || !samePonds(a.ponds, subject.ponds))) fail(`${at}.anchor`, "must be the subject's birth node when its source is the subject's birth");
  const edges = arr(r.edges, `${at}.edges`);
  const want = chain.length - 1 + (given ? 1 : 0);
  if (edges.length !== want) fail(`${at}.edges`, `must have one entry per chain edge${given ? " plus the anchor walk" : ""} (${want}), has ${edges.length}`);
  const donorArm = DONOR_ARMS.includes(r.arm as string);
  // The pick log first: a crossing's picker must be one its tally names.
  const hasPicks = r.picks !== null;
  const pickers = new Set<string>();
  if (hasPicks) {
    const k = rec(r.picks, `${at}.picks`);
    const [lines, checked, partial, unchecked] = ["lines", "checked", "partial", "unchecked"].map((f) => count(k[f], `${at}.picks.${f}`));
    count(k.unlogged, `${at}.picks.unlogged`);
    if (checked + partial + unchecked !== lines) fail(`${at}.picks`, `checked, partial and unchecked must sum to its lines (${lines}), sum to ${checked + partial + unchecked}`);
    if (typeof k.torn !== "boolean") fail(`${at}.picks.torn`, "must be a boolean");
    let tally = 0;
    for (const [name, v] of Object.entries(rec(k.by, `${at}.picks.by`))) {
      tally += count(v, `${at}.picks.by.${name}`, 1);
      pickers.add(name);
    }
    if (tally !== lines) fail(`${at}.picks.by`, `must tally the log's lines (${lines}), tallies ${tally}`);
    // As checkPicks: pick lines in an arm that takes no donors refuse.
    if (lines > 0 && !donorArm) fail(`${at}.picks`, `must hold no pick lines in arm ${r.arm}, which takes no donors`);
  }
  let exact = 0, named = 0, notExcluded = 0, notRecorded = 0;
  edges.forEach((e, i) => {
    const p = `${at}.edges[${i}]`;
    const o = rec(e, p);
    const anchorEdge = given && i === edges.length - 1;
    const parentAt = anchorEdge ? chain.length - 1 : i;
    const parent = chain[parentAt];
    const child = anchorEdge ? null : chain[i + 1];
    if (o.parent !== parent) fail(`${p}.parent`, `must be ${parent} (the chain edge it walks)`);
    if (o.child !== child) fail(`${p}.child`, child === null ? "must be null on the anchor walk" : `must be ${child} (the chain edge it walks)`);
    const s = rec(o.start, `${p}.start`);
    pondAt(s.pond, `${p}.start.pond`, R);
    const startCycle = cycleAt(s.cycle, `${p}.start.cycle`);
    const startPond = s.pond as number;
    if (anchorEdge) {
      if (startPond !== (a.ponds as number[])[0] || startCycle !== anchorCycle) fail(`${p}.start`, `must be the given anchor (pond ${(a.ponds as number[])[0]}, cycle ${anchorCycle})`);
    } else {
      const b = birth[i + 1];
      if (startCycle !== b.cycle || !b.ponds?.includes(startPond)) fail(`${p}.start`, `must be ${child}'s birth node (cycle ${b.cycle}, pond ${b.ponds?.join(", ") ?? "unknown"})`);
    }
    const end = count(o.end, `${p}.end`);
    if (end !== birth[parentAt].cycle) fail(`${p}.end`, `must be ${parent}'s birth cycle (${birth[parentAt].cycle})`);
    if (end > startCycle) fail(`${p}.end`, `must not be after the walk's start (cycle ${startCycle})`);
    if (o.status !== "exact" && o.status !== "not recorded") fail(`${p}.status`, 'must be "exact" or "not recorded"');
    if (o.status === "exact") {
      exact++;
      if (o.reason !== null) fail(`${p}.reason`, "must be null on an exact walk");
    } else strAt(o.reason, `${p}.reason`);
    const crossings = arr(o.crossings, `${p}.crossings`);
    let prev: { boundary: number; to: number } | null = null;
    crossings.forEach((c, j) => {
      const q = `${p}.crossings[${j}]`;
      const k = rec(c, q);
      const boundary = count(k.boundary, `${q}.boundary`, 1);
      if (boundary < end || boundary >= startCycle) fail(`${q}.boundary`, `must be a boundary the walk passes (${Math.max(1, end)} to ${startCycle - 1})`);
      if (prev && boundary <= prev.boundary) fail(`${q}.boundary`, `must follow boundary ${prev.boundary} (crossings in time order)`);
      if (k.step !== boundary * P) fail(`${q}.step`, `must be boundary x period (${boundary * P})`);
      pondAt(k.from, `${q}.from`, R);
      pondAt(k.to, `${q}.to`, R);
      if (prev && k.from !== prev.to) fail(`${q}.from`, `must be pond ${prev.to}, where the previous crossing landed`);
      if (j === crossings.length - 1 && k.to !== startPond) fail(`${q}.to`, `must be pond ${startPond}, where the walk starts`);
      prev = { boundary, to: k.to as number };
      if (!(CARRIED as readonly unknown[]).includes(k.carried)) fail(`${q}.carried`, `must be one of ${CARRIED.join(", ")}`);
      numAt(k.share, `${q}.share`, true);
      if (k.share !== null && ((k.share as number) < 0 || (k.share as number) > 1)) fail(`${q}.share`, "must be a share between 0 and 1, or null");
      if (k.packetLineages !== null) count(k.packetLineages, `${q}.packetLineages`, 1);
      const n = k.packetLineages as number | null;
      if (k.carried === "named") {
        named++;
        if (n === null) fail(`${q}.packetLineages`, "must be counted on a named crossing");
      } else {
        if (k.share !== null) fail(`${q}.share`, `must be null on a crossing ${k.carried}`);
        if (k.carried === "not excluded") {
          notExcluded++;
          if (n === null || n < 2) fail(`${q}.packetLineages`, "must be 2 or more on a crossing not excluded");
        } else notRecorded++;
      }
      strAt(k.by, `${q}.by`, true);
      if (!hasPicks && k.by !== null) fail(`${q}.by`, "must be null without a pick log (pond.picks null)");
      if (hasPicks && k.by !== null && !pickers.has(k.by as string)) fail(`${q}.by`, `must be a picker the pick log's tally names (${[...pickers].sort().join(", ") || "none"})`);
    });
    // Which boundaries a walk records: cont moves nothing; scaf, rand and breed transfer at every boundary (a refill
    // refuses), so an exact walk lists every boundary it passes and a stopped one the run after the missing boundary;
    // nat and shuf skip survivors.
    const bs = crossings.map((c) => (c as { boundary: number }).boundary);
    if (r.arm === "cont" && bs.length) fail(`${p}.crossings`, "must be empty in arm cont, which moves nothing between ponds");
    if (donorArm) {
      // Compared by arithmetic, not by building the expected list: the walk's span comes from the dossier.
      const first = o.status === "exact" ? Math.max(1, end) : startCycle - bs.length;
      const n = Math.max(0, startCycle - first);
      if ((o.status === "exact" && bs.length !== n) || bs.some((b, j) => b !== first + j))
        fail(`${p}.crossings`, `must hold ${o.status === "exact" ? "every boundary the walk passes" : "the boundaries after the missing one"} in arm ${r.arm} (${span(first, n)}), holds ${bs.join(", ") || "none"}`);
    }
    if (o.status === "exact") {
      const landing = (crossings[0] as { from?: number } | undefined)?.from ?? startPond;
      const ponds = birth[parentAt].ponds;
      if (!ponds?.includes(landing)) fail(`${p}.status`, `exact, yet the walk lands on pond ${landing}, which is not ${parent}'s birth pond (${ponds?.join(", ") || "unknown"})`);
    }
  });
  if (count(r.exact, `${at}.exact`) !== exact) fail(`${at}.exact`, `must equal the edges whose walk is exact (${exact}), is ${r.exact}`);
  if (count(r.notRecorded, `${at}.notRecorded`) !== edges.length - exact) fail(`${at}.notRecorded`, `must equal the edges whose walk is not recorded (${edges.length - exact}), is ${r.notRecorded}`);
  const cx = rec(r.crossings, `${at}.crossings`);
  for (const [k, n] of [["named", named], ["notExcluded", notExcluded], ["notRecorded", notRecorded]] as const) {
    if (count(cx[k], `${at}.crossings.${k}`) !== n) fail(`${at}.crossings.${k}`, `must equal the crossings the edges hold (${n}), is ${cx[k]}`);
  }
}

// ---- events -----------------------------------------------------------------------------------------------

/** A lane: a pond, or "unknown" for a root whose tiles could not be established. */
export type Lane = number | "unknown";
export interface RoutePoint {
  step: number;
  lane: Lane;
}

export type RouteEvent =
  | { kind: "root"; at: RoutePoint; key: string; cycle: number; tiles: number[] | null; source: string }
  | { kind: "gap"; from: RoutePoint; to: RoutePoint; edge: number; parent: string; child: string | null; reason: string | null }
  | { kind: "crossing"; at: RoutePoint; edge: number; parent: string; crossing: Crossing; status: string }
  | { kind: "mutation"; at: RoutePoint; edge: number; parent: string; child: string; cycle: number; expression: Expression; locus: string; status: string }
  | { kind: "anchor"; at: RoutePoint; edge: number; key: string; pond: number; cycle: number; status: string };

export interface RouteSegment {
  from: RoutePoint;
  to: RoutePoint;
  dashed: boolean;
}

export interface RouteLayout {
  route: PondRoute;
  events: RouteEvent[];
  segments: RouteSegment[];
  /** Lanes drawn, top to bottom. */
  lanes: Lane[];
  /** Ponds among `lanes` (the unknown lane excluded). */
  pondsShown: number;
}

/** The pond a lane names, in words. */
const laneName = (l: Lane): string => (l === "unknown" ? "pond unknown" : `pond ${l}`);

/** The root's lane: where its first walk lands (first crossing's donor, or the child's birth pond); else its first tile. */
function rootLane(route: PondRoute): Lane {
  const e = route.edges[0];
  if (e && e.status === "exact") return e.crossings[0]?.from ?? e.start.pond;
  return route.births[0].ponds?.[0] ?? "unknown";
}

/**
 * Every event the route figure draws, in time order (root; then per edge: a gap where the walk is not recorded, its
 * crossings, the child's mutation or the anchor), and the line between them. Requires a validated `pond`.
 */
export function routeEvents(d: GenotypeInput): RouteLayout {
  const route = d.pond!;
  const P = route.period;
  const chain = d.chain;
  const events: RouteEvent[] = [];
  const segments: RouteSegment[] = [];
  const rootKey = chain[0].key;
  const root: RoutePoint = { step: chain[0].minted ?? 0, lane: rootLane(route) };
  events.push({ kind: "root", at: root, key: rootKey, cycle: route.births[0].cycle, tiles: route.births[0].ponds, source: d.root.source });
  let cur = root;
  route.edges.forEach((e, i) => {
    const anchorEdge = e.child === null;
    const end: RoutePoint = anchorEdge ? { step: e.start.cycle * P, lane: e.start.pond } : { step: chain[i + 1].minted ?? d.mutations[i].step, lane: e.start.pond };
    if (e.status === "not recorded") {
      const first: RoutePoint = e.crossings.length ? { step: e.crossings[0].step, lane: e.crossings[0].from } : end;
      segments.push({ from: cur, to: first, dashed: true });
      events.push({ kind: "gap", from: cur, to: first, edge: i, parent: e.parent, child: e.child, reason: e.reason });
      cur = first;
    }
    for (const c of e.crossings) {
      const depart: RoutePoint = { step: c.step, lane: c.from }, arrive: RoutePoint = { step: c.step, lane: c.to };
      segments.push({ from: cur, to: depart, dashed: false });
      if (c.from !== c.to) segments.push({ from: depart, to: arrive, dashed: false });
      events.push({ kind: "crossing", at: arrive, edge: i, parent: e.parent, crossing: c, status: e.status });
      cur = arrive;
    }
    segments.push({ from: cur, to: end, dashed: false });
    if (anchorEdge) events.push({ kind: "anchor", at: end, edge: i, key: e.parent, pond: e.start.pond, cycle: e.start.cycle, status: e.status });
    else {
      const m = d.mutations[i];
      events.push({ kind: "mutation", at: end, edge: i, parent: e.parent, child: e.child!, cycle: route.births[i + 1].cycle, expression: m.expression, locus: m.locus, status: e.status });
    }
    cur = end;
  });
  const touched = new Set<number>();
  for (const ev of events) {
    if (ev.kind === "gap") {
      for (const p of [ev.from, ev.to]) if (p.lane !== "unknown") touched.add(p.lane);
    } else if (ev.at.lane !== "unknown") touched.add(ev.at.lane);
    if (ev.kind === "crossing") touched.add(ev.crossing.from);
  }
  const ponds = route.ponds <= 8 ? Array.from({ length: route.ponds }, (_, p) => p) : [...touched].sort((a, b) => a - b);
  const lanes: Lane[] = [...(root.lane === "unknown" ? (["unknown"] as Lane[]) : []), ...ponds];
  return { route, events, segments, lanes, pondsShown: ponds.length };
}

// ---- wording ----------------------------------------------------------------------------------------------

const crossingCount = (r: PondRoute): number => r.crossings.named + r.crossings.notExcluded + r.crossings.notRecorded;
const pondChanges = (r: PondRoute): number => r.edges.reduce((n, e) => n + e.crossings.filter((c) => c.from !== c.to).length, 0);
const takesDonors = (r: PondRoute): boolean => DONOR_ARMS.includes(r.arm);
const lineagesInPacket = (n: number): string => `${n} lineage${n === 1 ? "" : "s"} in the packet`;
const plural = (n: number, one: string, many = `${one}s`): string => `${int(n)} ${n === 1 ? one : many}`;

/** pondRoute tallies a pick line logged without `by` as "unnamed"; a picker of that name tallies the same. */
const UNNAMED = "unnamed";
/**
 * `by` values the runner writes that are not a picker's name (packages/runner/src/picks.ts `PickNote.by`). A picker
 * may carry any name, these included, and the log cannot tell the two apart, so each is said as either.
 */
const NOT_PICKERS: Record<string, string> = {
  recorded: "a recorded pick, replayed",
  "rule(implicit)": "the arm's own rule (no pick recorded, no picker)",
  none: "no pond occupied",
};
const notPicker = (by: string): string | undefined => (Object.hasOwn(NOT_PICKERS, by) ? NOT_PICKERS[by] : undefined);
/**
 * Code points a reader cannot see or tell from a plain space: controls (C1; JSON already escapes C0), format
 * controls (bidi, zero-width, tags), line and paragraph separators, every space but U+0020, and the other default
 * ignorables (combining grapheme joiner, Hangul fillers, Khmer inherent vowels, Mongolian and other variation
 * selectors).
 */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180f\u3164\ufe00-\ufe0f\uffa0\u{e0100}-\u{e01ef}]|(?! )\p{Zs}/gu;
/**
 * A picker's name as printed: always quoted, JSON-escaped (quotes, backslashes, controls) and with every code point
 * in UNSEEN written as a \u escape, so two different names never print alike (`none` and `"none"` are `"none"` and
 * `"\"none\""`; `ab` and `a\u206ab` are `"ab"` and `"a\u206ab"`; `a  b` is `"a  b"`) and a name cannot reorder or hide the words
 * around it. Letters that merely look alike (Latin a, Cyrillic а) still print as they are.
 */
export const quoteName = (s: string): string =>
  JSON.stringify(s).replace(UNSEEN, (c) => {
    const cp = c.codePointAt(0)!;
    return cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, "0")}`;
  }).replace(/(?<= ) /g, "\\u0020"); // HTML and SVG text collapse a run of spaces: the second and later are written out.
/** The two readings of a runner mark. */
const markWords = (by: string): string => `the runner's mark for ${notPicker(by)}, or a picker of that name`;
/** One sentence per runner mark among `names`, said once. */
const markNotes = (names: string[]): string =>
  names
    .filter((n) => notPicker(n) !== undefined)
    .map((n) => ` ${quoteName(n)} is ${markWords(n)}.`)
    .join("");
const tallyEntry = (name: string, n: number): string => `${quoteName(name)} ${int(n)}`;
/** The pick tally as a list, by name. */
const tallyList = (by: Record<string, number>): string =>
  Object.keys(by)
    .sort()
    .map((n) => tallyEntry(n, by[n]))
    .join(", ") || "no pick lines";

/** The picker, from what the dossier holds: the pick tally and each crossing's own `by`, never inferred per boundary. */
function pickerLine(r: PondRoute): string {
  const k = r.picks;
  if (!k) return takesDonors(r) ? "Picker: not recorded (the bundle has no picks.jsonl)." : `Picker: n/a (arm ${r.arm} takes no picked donors).`;
  const names = Object.keys(k.by).sort();
  const lines = int(k.lines);
  if (names.length === 1 && k.unlogged === 0) {
    const n = names[0];
    if (n === UNNAMED) return `All ${lines} logged pick lines tally as "${UNNAMED}": logged without a picker's name, or by a picker of that name. Each crossing shows what its own line holds.`;
    if (notPicker(n) !== undefined) return `At all ${lines} logged boundaries the pick log says ${quoteName(n)}: ${markWords(n)}.`;
    return `Picked by ${quoteName(n)} at all ${lines} logged boundaries.`;
  }
  const unnamed = Object.hasOwn(k.by, UNNAMED) ? ` A line logged without a picker's name tallies as "${UNNAMED}".` : "";
  const unlogged = k.unlogged ? ` ${plural(k.unlogged, "boundary", "boundaries")} in ponds.tsv ${k.unlogged === 1 ? "is" : "are"} not in the log.` : "";
  return `Pick log tally: ${tallyList(k.by)}; each crossing names its own picker.${markNotes(names)}${unnamed}${unlogged}`;
}

/**
 * A crossing with no picker: without a pick log, not recorded (or n/a where the arm takes no donors). With one, its
 * boundary is either missing from the log or logged without a name, and the dossier tells the two apart only when the
 * log covers every boundary (`unlogged` 0) or no line tallies as unnamed.
 */
function noPicker(r: PondRoute): string {
  const k = r.picks;
  if (!k) return takesDonors(r) ? "not recorded" : "n/a";
  if (k.unlogged === 0) return "no picker named in the pick log";
  return Object.hasOwn(k.by, UNNAMED) ? "unnamed, or not in the pick log" : "not in the pick log";
}

/** The table's picker cell. */
function pickedBy(r: PondRoute, c: Crossing): string {
  if (c.by === null) return noPicker(r);
  return notPicker(c.by) !== undefined ? `${quoteName(c.by)}: ${markWords(c.by)}` : quoteName(c.by);
}

/** A picker's name in a label, quoted and cut to LABEL_NAME code points (never inside a surrogate pair), the cut
 * marked by an ellipsis outside the quotes; the table carries it whole. */
const LABEL_NAME = 20;
const clip = (s: string): string => {
  const cps = [...s];
  return cps.length > LABEL_NAME ? `${quoteName(cps.slice(0, LABEL_NAME - 1).join(""))}…` : quoteName(s);
};
/** The label's picker line, or null when there is nothing to say (no pick log). */
function pickedByShort(r: PondRoute, c: Crossing): string | null {
  if (c.by === null) return r.picks ? noPicker(r) : null;
  return `by ${clip(c.by)}`;
}

function packetText(c: Crossing): string {
  if (c.carried === "named") return `named${c.packetLineages !== null ? ` (${lineagesInPacket(c.packetLineages)})` : ""}`;
  if (c.carried === "not excluded") return `not excluded${c.packetLineages !== null ? ` (${lineagesInPacket(c.packetLineages)})` : ""}`;
  return c.packetLineages !== null ? `not recorded (${lineagesInPacket(c.packetLineages)}, no dominant columns)` : "not recorded (no packet columns)";
}

/** Short label drawn beside a crossing mark. */
function markLabel(c: Crossing): string {
  if (c.carried === "named") return c.share !== null ? `named ${pct(c.share)}` : "named";
  if (c.carried === "not excluded") return c.packetLineages !== null ? `not excluded (${c.packetLineages})` : "not excluded";
  return "not recorded";
}

/** "exact" only when every edge walk is exact and every birth on the chain has known, non-empty ponds. */
export function routeSectionEvidence(r: PondRoute): Evidence {
  return r.notRecorded === 0 && r.births.every((b) => b.ponds !== null && b.ponds.length > 0) ? "exact" : "not recorded";
}

/** Key numbers for a pond-cycle dossier. */
export function routeKeyNumbers(r: PondRoute): KeyNumberItem[] {
  const cx = r.crossings;
  const k = r.picks;
  const pick: KeyNumberItem = k
    ? {
        label: "Pick log (picks.jsonl): lines, boundaries checked, pickers",
        value: `${int(k.lines)} lines, ${int(k.checked)} checked${k.partial ? `, ${k.partial} partly` : ""}${k.unchecked ? `, ${k.unchecked} without rows` : ""}${k.unlogged ? `, ${k.unlogged} not logged` : ""}${k.torn ? ", torn last line dropped" : ""}; ${tallyList(k.by)}`,
        evidence: k.partial || k.unchecked || k.unlogged ? "not recorded" : "exact",
      }
    : takesDonors(r)
      ? { label: "Pick log (picks.jsonl)", value: "not recorded", evidence: "not recorded" }
      : { label: "Pick log (picks.jsonl)", value: `n/a (arm ${r.arm} takes no picked donors)` };
  return [
    { label: "Pond arm, ponds, period", value: `${r.arm}, ${int(r.ponds)} ponds, ${int(r.period)} steps`, evidence: "exact" },
    { label: "Pond-route edge walks: exact / not recorded", value: `${int(r.exact)} / ${int(r.notRecorded)}`, evidence: r.notRecorded ? "not recorded" : "exact" },
    { label: "Packet crossings: named / not excluded / not recorded", value: `${int(cx.named)} / ${int(cx.notExcluded)} / ${int(cx.notRecorded)}`, evidence: cx.notRecorded ? "not recorded" : "exact" },
    pick,
  ];
}

// ---- figure -----------------------------------------------------------------------------------------------

const slug = (s: string): string => s.replace(/ /g, "-");
export const ordinal = (k: number): string => {
  const tail = k % 100 >= 11 && k % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][k % 10] ?? "th");
  return `${k}${tail}`;
};

/** A crossing mark: a distinct shape per class (filled, hollow, dashed with "?"), so no class rests on colour. */
function crossingMark(carried: Crossing["carried"], x: number, y: number): string {
  const tri = `${num(x)},${num(y - 5.5)} ${num(x + 5.5)},${num(y + 4.5)} ${num(x - 5.5)},${num(y + 4.5)}`;
  switch (carried) {
    case "named":
      return `<polygon points="${tri}" fill="var(--pass)" />`;
    case "not excluded":
      return `<polygon points="${tri}" fill="var(--panel)" stroke="var(--accent)" stroke-width="1.6" />`;
    case "not recorded":
      return `<rect x="${num(x - 5)}" y="${num(y - 5)}" width="10" height="10" fill="var(--panel)" stroke="var(--muted)" stroke-width="1.2" stroke-dasharray="2,1.5" /><text x="${num(x)}" y="${num(y + 3)}" text-anchor="middle" fill="var(--muted)" font-size="8">?</text>`;
  }
}
const anchorMark = (x: number, y: number): string =>
  `<circle cx="${num(x)}" cy="${num(y)}" r="6" fill="none" stroke="var(--ink)" stroke-width="1.6" /><circle cx="${num(x)}" cy="${num(y)}" r="1.6" fill="var(--ink)" />`;

/**
 * Crossing labels are set in the page's monospace stack (IBM Plex Mono, SF Mono, Consolas, Liberation Mono, then
 * the generic monospace: advances 0.55 to 0.6 em on printable ASCII and Latin-1), so such a line's width is known
 * rather than guessed: 6.2 units a code point at 10px. Any other code point may come from a fallback font of any
 * width (U+0BF5 or U+FDFD run to several em), so it is allotted 12.4 units and its line is drawn with SVG
 * `textLength` at exactly its allotment, glyphs squeezed or spread to fit. Either way a label is never drawn wider
 * than its span.
 */
const LABEL_FONT = ' style="font-family:var(--font-mono)"';
const ADVANCE = 6.2;
/** Printable ASCII and Latin-1, which every monospace face carries at one advance. */
const isNarrow = (cp: number): boolean => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff);
const lineWidth = (l: string): number => [...l].reduce((w, ch) => w + (isNarrow(ch.codePointAt(0)!) ? ADVANCE : 2 * ADVANCE), 0);
/** A label line's attributes: a line with any code point outside the monospace face is held to its allotment. */
export const lineFit = (l: string): string => ([...l].every((ch) => isNarrow(ch.codePointAt(0)!)) ? "" : ` textLength="${num(lineWidth(l))}" lengthAdjust="spacingAndGlyphs"`);
export const labelWidth = (lines: string[]): number => Math.max(...lines.map(lineWidth)) + 4;
/** The least horizontal gap between two crossing labels. */
export const LABEL_GAP = 6;
/** The route SVG's least CSS width, so its 10px text stays near 9px on a phone (the figure box scrolls). */
const ROUTE_MIN_WIDTH = 860;

export function routeFigure(d: GenotypeInput, n: number): string {
  const L = routeEvents(d);
  const r = L.route;
  const chain = d.chain;
  const W = 960, left = 210, right = 36, laneH = 30, top = 76, bottom = 44;
  const H = top + L.lanes.length * laneH + bottom;
  const last = endStep(d);
  const { ticks, domain } = ticksAndDomain(0, last, 6);
  const x = linearScale(domain, [left, W - right]);
  const laneIndex = new Map(L.lanes.map((l, i) => [l, i]));
  const y = (l: Lane): number => top + (laneIndex.get(l) ?? 0) * laneH + laneH / 2;
  const nCross = crossingCount(r);
  const moves = pondChanges(r);
  const pondsText = L.pondsShown === r.ponds ? `${int(r.ponds)} ponds` : `${int(L.pondsShown)} of ${int(r.ponds)} ponds shown`;
  const parts: string[] = [svgOpen(W, H, `Pond route: ${chain.length} lineages from root ${chain[0].key} to subject ${chain[chain.length - 1].key}, ${plural(nCross, "packet crossing")} (${int(moves)} changing pond), ${pondsText}`, ROUTE_MIN_WIDTH)];

  // Legend: expression markers, then crossing classes, the gap and the anchor.
  let lx = 8;
  for (const k of ["root", ...EXPRESSIONS] as const) {
    parts.push(marker(k, lx + 4, 12), text(lx + 12, 15.5, k === "root" ? "root" : `mutation: ${k}`));
    lx += k === "root" ? 52 : (k.length + 10) * 6.2 + 22;
  }
  lx = 8;
  for (const c of CARRIED) {
    parts.push(crossingMark(c, lx + 5, 32), text(lx + 14, 35.5, `crossing ${c}`));
    lx += (c.length + 9) * 6.2 + 26;
  }
  parts.push(`<line x1="${num(lx)}" x2="${num(lx + 24)}" y1="32" y2="32" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="4,3" />`, text(lx + 30, 35.5, "route not recorded"));
  lx += 30 + 18 * 6.2 + 22;
  parts.push(anchorMark(lx + 6, 32), text(lx + 16, 35.5, "anchor node (given)"));
  // The picker summary is in the lead paragraph, where it wraps; the figure keeps only the lane note.
  if (L.pondsShown !== r.ponds) parts.push(text(8, 55.5, `${pondsText}.`));

  // Lanes and boundary ticks, up to the last boundary the run reaches (not the axis's rounded end).
  L.lanes.forEach((l) => {
    const ly = y(l);
    parts.push(`<line x1="${left}" x2="${W - right}" y1="${num(ly)}" y2="${num(ly)}" stroke="var(--rule)" stroke-width="1" />`);
    parts.push(text(left - 10, ly + 3.5, laneName(l), ` text-anchor="end" data-lane="${escapeHtml(String(l))}"`));
  });
  const boundaries = Math.floor(last / r.period);
  const tickEvery = Math.max(1, Math.ceil(boundaries / 200));
  // Cycle numbers thin past 40 boundaries, always on a drawn tick.
  const labelEvery = boundaries > 40 ? tickEvery * Math.ceil(Math.ceil(boundaries / 20) / tickEvery) : tickEvery;
  const laneBottom = top + L.lanes.length * laneH;
  parts.push(text(left - 10, top - 6, "boundary (cycle)", ' text-anchor="end"'));
  for (let c = tickEvery; c <= boundaries; c += tickEvery) {
    const bx = x(c * r.period);
    parts.push(`<line x1="${num(bx)}" x2="${num(bx)}" y1="${num(top - 2)}" y2="${num(laneBottom)}" stroke="var(--muted)" stroke-width="1" stroke-opacity="0.5" stroke-dasharray="2,3" data-boundary="${c}" />`);
    if (c % labelEvery === 0) parts.push(text(bx, top - 6, String(c), ' text-anchor="middle"'));
  }
  parts.push(axis({ orientation: "bottom", scale: x, ticks, at: laneBottom + 4, format: int, label: "step", viewBox: { width: W, height: H } }));

  // The line, then the marks on top of it.
  for (const s of L.segments) {
    if (s.dashed) continue;
    parts.push(`<line x1="${num(x(s.from.step))}" x2="${num(x(s.to.step))}" y1="${num(y(s.from.lane))}" y2="${num(y(s.to.lane))}" stroke="var(--ink)" stroke-width="1.6" />`);
  }
  // Labels go left to right and are drawn only where they clear the last one drawn, on any lane (lanes are 30 units
  // apart, so a label below one lane meets a label above the next); one near the right edge flips to the left.
  let labelEnd = -Infinity, labelled = 0;
  for (const ev of L.events) {
    switch (ev.kind) {
      case "root":
        parts.push(`<g data-event="root">${marker("root", x(ev.at.step), y(ev.at.lane))}</g>`);
        break;
      case "gap": {
        const x0 = x(ev.from.step), y0 = y(ev.from.lane), x1 = x(ev.to.step), y1 = y(ev.to.lane);
        parts.push(
          `<g data-event="gap" data-gap=""><line x1="${num(x0)}" x2="${num(x1)}" y1="${num(y0)}" y2="${num(y1)}" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="4,3" />${text((x0 + x1) / 2, Math.min(y0, y1) - 6, "route not recorded", ' text-anchor="middle"')}</g>`,
        );
        break;
      }
      case "crossing": {
        const c = ev.crossing, cx = x(c.step), cy = y(ev.at.lane);
        parts.push(`<g data-event="crossing" data-carried="${slug(c.carried)}">${crossingMark(c.carried, cx, cy)}</g>`);
        const by = pickedByShort(r, c);
        const lines = [markLabel(c), ...(by !== null ? [by] : [])];
        const w = labelWidth(lines);
        const flip = cx + 8 + w > W - right;
        const x0 = flip ? cx - 8 - w : cx + 8, x1 = x0 + w;
        if (x0 >= labelEnd + LABEL_GAP && x0 >= 0) {
          const anchor = (flip ? ' text-anchor="end"' : "") + LABEL_FONT;
          const tx = flip ? cx - 8 : cx + 8;
          // Above and below the lane, clear of the marks (half-height 5.5) on it.
          parts.push(`<g data-crossing-label="${num(x0)} ${num(x1)}">${text(tx, cy - 10, lines[0], anchor + lineFit(lines[0]))}${lines[1] !== undefined ? text(tx, cy + 17, lines[1], anchor + lineFit(lines[1])) : ""}</g>`);
          labelEnd = x1;
          labelled++;
        }
        break;
      }
      case "mutation":
        parts.push(`<g data-event="mutation">${marker(ev.expression, x(ev.at.step), y(ev.at.lane))}</g>`);
        break;
      case "anchor":
        parts.push(`<g data-event="anchor" data-anchor="">${anchorMark(x(ev.at.step), y(ev.at.lane))}</g>`);
        break;
    }
  }
  parts.push("</svg>");

  const rows = L.events.map((ev, i) => {
    const idx = String(i + 1);
    switch (ev.kind) {
      case "root": {
        const others = ev.tiles && ev.at.lane !== "unknown" ? ev.tiles.filter((t) => t !== ev.at.lane) : [];
        const note = ev.tiles === null ? "a founder whose initial tiles are unknown (the initial world was not rebuilt)" : others.length ? `also in initial tile${others.length > 1 ? "s" : ""} ${others.join(", ")}` : ev.tiles.length === 0 ? "a founder in no tile of the initial world" : "";
        return [idx, "root", int(ev.at.step), `cycle ${ev.cycle}`, laneName(ev.at.lane), ev.key, "", "", "", "", note];
      }
      case "gap":
        return [idx, "route not recorded", `${int(ev.from.step)} to ${int(ev.to.step)}`, "", `${laneName(ev.from.lane)} → ${laneName(ev.to.lane)}`, `${ev.parent} → ${ev.child ?? "anchor"}`, "", "", "", "not recorded", ev.reason ?? ""];
      case "crossing": {
        const c = ev.crossing;
        return [idx, c.from === c.to ? "crossing (same pond)" : "crossing", int(c.step), `boundary ${c.boundary}`, `${c.from} → ${c.to}`, ev.parent, packetText(c), c.carried === "named" && c.share !== null ? pct(c.share) : "", pickedBy(r, c), ev.status, ""];
      }
      case "mutation":
        return [idx, "mutation", int(ev.at.step), `cycle ${ev.cycle}`, laneName(ev.at.lane), `${ev.parent} → ${ev.child}`, "", "", "", ev.status, `${ev.locus}, ${ev.expression}`];
      case "anchor":
        return [idx, `anchor (pond ${ev.pond}, cycle ${ev.cycle})`, int(ev.at.step), `cycle ${ev.cycle}`, laneName(ev.at.lane), ev.key, "", "", "", ev.status, "a given node the subject must be present in"];
    }
  });
  const table = numbersTable(["#", "event", "step", "boundary or cycle", "ponds", "lineage", "packet", "share", "picked by", "edge route", "note"], rows);
  const ends = r.anchor.source === "given" ? `at the given anchor node (pond ${r.anchor.ponds?.join(", ") ?? "unknown"}, cycle ${r.anchor.cycle})` : `at the subject's birth`;
  const labels = nCross === 0 ? "" : labelled === nCross ? "" : labelled === 0 ? ` With ${int(nCross)} crossings this close together, the marks carry no labels.` : ` Labels sit on ${int(labelled)} of the ${int(nCross)} crossings, where they fit.`;
  return figure(
    n,
    parts.join(""),
    `One lane per pond (${pondsText}), the step on the x axis over the ancestry figure's range, ${tickEvery === 1 ? "a tick at every pond boundary" : `a tick at every ${ordinal(tickEvery)} pond boundary`} (boundary c at step c × ${int(r.period)})${labelEvery > 1 ? `, numbered at every ${ordinal(labelEvery)}` : ""}. The line follows the ancestry from root ${chain[0].key}${crossingWords(r)} A marker is the mutation that minted a lineage, at its mint step in its birth pond (its cycle: the first pond snapshot it is in, so cycle c holds steps after boundary c − 1 up to boundary c). Dashes: an edge whose route is not recorded. The line ends ${ends}; it says nothing about where else a lineage lived.${labels} The table lists every drawn event in time order.`,
    table,
    { scrollLabel: `Figure ${n}, pond route (scrolls sideways on a narrow screen; the table below holds every event)` },
  );
}

/** What a crossing's mark says, defined once in the caption of any arm whose route can hold crossings. */
const MARK_WORDS =
  " Its mark says what the packet record shows: named, the packet's dominant lineage is this ancestor, labelled with that lineage's share of the packet's B+P (a share of matter, not a confidence); not excluded, the packet held two or more lineages and another dominated, so the record neither names this ancestor nor rules it out; not recorded, the bundle lacks the packet columns.";

/** What a crossing and its mark mean in this arm (tools/lib/pond-descent.ts, the walk), said once in the caption. */
function crossingWords(r: PondRoute): string {
  if (r.arm === "cont") return `. In arm cont the route records no packet between ponds, so the line keeps to its pond.`;
  if (!takesDonors(r))
    return ` through the donors ponds.tsv records. In arm ${r.arm} a surviving pond (donor −2) keeps its own contents across a boundary, so no crossing is drawn there and the line stays in its lane; a pond whose row names a donor descends from that donor's packet, a crossing, drawn as a vertical step from the donor's lane to the recipient's when the two differ.${MARK_WORDS}`;
  return ` through the donors ponds.tsv records: at a boundary every pond is reseeded from its donor's packet alone, so a crossing is that packet, drawn as a vertical step from the donor's lane to the recipient's when the two differ (a pond can be its own donor).${MARK_WORDS}`;
}

/** The lead paragraph text of the route section. */
export function routeLead(d: GenotypeInput): string {
  const r = d.pond!;
  const n = crossingCount(r);
  const moves = pondChanges(r);
  const where = n === 0 ? "" : moves === n ? (n === 1 ? ", which changes pond" : ", each changing pond") : moves === 0 ? `, none changing pond (each pond is its own donor)` : ` (${int(moves)} changing pond; at the other ${int(n - moves)} the pond is its own donor)`;
  const crossings = n === 0 ? "There is no packet crossing on this route." : `${plural(n, "packet crossing")} on this route${where}: ${r.crossings.named} named, ${r.crossings.notExcluded} not excluded, ${r.crossings.notRecorded} not recorded.`;
  return `${crossings} ${pickerLine(r)}`;
}
