// The family tree (rule set `families-v1`, docs/pond-keeper-v2-2026-10-17.md §3): named families of lineages, told apart by
// descent, with their purity, split by a stated persistence rule, and "gone to film" told apart from "extinct". Observer only:
// nothing here touches the physics or declares a category. The tree is a pure function of the censuses it is fed, in order, and of
// the parent links it is asked for, so a replay that feeds the same censuses reaches the same tree, and a snapshot taken at any
// census restores to a tree that continues exactly as an uninterrupted one would.
//
// A family is a clade: the lineages descending from one founding lineage, less the ones that belong to a family founded further
// down. A lineage with no known parent is a root and founds a family (a founder's key, hi 0, or a key whose parent the lab cannot
// know: "of unknown descent"). A family splits at lineage L when L, on the ancestry of a living member, has held both halves of the
// family (L's descendants and the rest) at 16 cells or more at every census for 5,000 steps.

import { lineageKeyOrder, type LineageCells } from "./firsts.ts";
import type { Census } from "./census.ts";

export const FAMILIES_RULESET = "families-v1" as const;
export const FAMILY_THRESHOLDS = {
  /** Cells each half of a family needs for its split candidate to qualify at a census. */
  halfCells: 16,
  /** Steps a candidate must qualify at every census before the family splits. */
  splitSteps: 5000,
  /** Censuses in a row with no cell in a body before "gone to film", and in a body before "back from film". */
  filmCensuses: 5,
} as const;

/** 64 genus words (gentle nature nouns), fixed: a name is a pure function of the founding key and the history. */
export const FAMILY_GENERA: readonly string[] = [
  "Reed", "Moss", "Fern", "Alder", "Willow", "Lily", "Sedge", "Rush", "Clover", "Heron", "Otter", "Wren", "Finch", "Sparrow", "Newt", "Frog",
  "Minnow", "Pebble", "Brook", "Meadow", "Marsh", "Dew", "Mist", "Ripple", "Lotus", "Cattail", "Maple", "Birch", "Hazel", "Rowan", "Elder", "Linden",
  "Aspen", "Cedar", "Juniper", "Thistle", "Heather", "Bracken", "Sorrel", "Violet", "Poppy", "Daisy", "Iris", "Acorn", "Bramble", "Cress", "Glen", "Hollow",
  "Tern", "Plover", "Egret", "Snail", "Mallow", "Yarrow", "Tansy", "Fennel", "Sage", "Thyme", "Mint", "Larch", "Spruce", "Holly", "Ivy", "Teasel",
];
/** 64 epithets (lower-case adjectives), fixed. */
export const FAMILY_EPITHETS: readonly string[] = [
  "amber", "slow", "quiet", "bright", "pale", "golden", "silver", "soft", "swift", "gentle", "mellow", "hazy", "misty", "dusky", "rosy", "ruddy",
  "russet", "ashen", "azure", "calm", "clear", "cool", "crisp", "dappled", "deep", "dim", "downy", "dry", "early", "faint", "fond", "fresh",
  "glassy", "green", "hardy", "hushed", "humble", "lazy", "light", "little", "lone", "long", "mild", "mossy", "narrow", "nimble", "patient", "plain",
  "proud", "round", "rustic", "shy", "sleepy", "sandy", "small", "sunny", "tall", "tender", "tiny", "wild", "wide", "windy", "young", "brindled",
];

/** FNV-1a, 32 bit, over the UTF-8 bytes of the text. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type FamilyStatus = "living" | "film" | "extinct";

export interface FamilyInput {
  step: number;
  /** The census lineage table: every living key and its cells. */
  lineages: readonly { key: string; cells: number }[];
  /** Every body (census individual with a tracker id): its cells, and the lineage composition of its keyed cells. */
  bodies: readonly { id: number; cells: number; keys: readonly [string, number][] }[];
}

/** The tree's input for one census, from the census and the shared lineage read (`readLineageCells`). */
export function buildFamilyInput(c: Census, lc: LineageCells): FamilyInput {
  return { step: c.step, lineages: c.lineages.map((l) => ({ key: l.key, cells: l.cells })), bodies: lc.bodies.map((b) => ({ id: b.id, cells: b.cells, keys: b.keys.map((k) => [k[0], k[1]] as [string, number]) })) };
}

export interface FamilyEvent {
  step: number;
  /** `found`: a root of unknown descent first seen after the first watched census. */
  kind: "split" | "film" | "back" | "extinct" | "found";
  /** The family's founding lineage key. */
  family: string;
  name: string;
  detail: string;
}

export interface FamilyView {
  /** The founding lineage key. */
  founder: string;
  name: string;
  /** The parent family's founding key and name; null for a root family. */
  parent: string | null;
  parentName: string | null;
  founded: number;
  /** A root whose key is not a founder's, or a root first seen after the first watched census. */
  unknownDescent: boolean;
  /** With the persistence rule: `film` only after 5 censuses with no cell in a body, `living` again only after 5 in a body. */
  status: FamilyStatus;
  /** Whether any of its cells lies in a body at the latest census (the raw reading under `status`). */
  bodyNow: boolean;
  /** Living cells of its member lineages, bodies and film alike. */
  cells: number;
  /** Bodies whose family it is. */
  bodies: number;
  /** Its own share (0 to 1) of the cells of the bodies whose family it is; null with no body. */
  purity: number | null;
  /** Its share (0 to 1) of the jar's living cells. */
  share: number;
  /** Depth in the tree: 0 for a root family. */
  depth: number;
}

export interface FamilySplit {
  name: string;
  parentName: string;
  step: number;
  /** The new family's cells and what the parent kept, at the split. */
  cells: number;
  parentCells: number;
}

export interface FamilySummary {
  rules: typeof FAMILIES_RULESET;
  watchedFrom: number | null;
  step: number | null;
  /** Every family named, starting and split and later roots. */
  named: number;
  starting: number;
  split: number;
  living: number;
  film: number;
  extinct: number;
}

/** One family's record. Plain data: it is the snapshot. */
interface Rec {
  founder: string;
  parent: string | null;
  founded: number;
  unknownDescent: boolean;
  /** `start`: a root at the first watched census; `root`: a root first seen later; `split`. */
  origin: "start" | "root" | "split";
  genus: number;
  genusNum: number;
  epithet: number | null;
  epithetNum: number;
  name: string;
  status: FamilyStatus;
  /** Censuses in a row with no cell in a body (and the first of them), and in a body. */
  noRun: number;
  noSince: number;
  inRun: number;
  cells: number;
  bodies: number;
  ownCells: number;
  bodyCells: number;
  bodyNow: boolean;
}

interface State {
  watchedFrom: number | null;
  lastStep: number | null;
  livingCells: number;
  recs: Rec[];
  /** Split candidates now qualifying: [lineage key, founder of the family it is a candidate in, first census of its unbroken run]. */
  runs: [string, string, number][];
  events: FamilyEvent[];
  splits: FamilySplit[];
}

/** JSON-safe, plain data only. */
export interface FamilySnapshot {
  v: 1;
  ruleSet: typeof FAMILIES_RULESET;
  [k: string]: unknown;
}

const num = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isStr = (v: unknown): v is string => typeof v === "string";
const hiOf = (key: string): number => {
  const m = /^(\d+):(\d+)$/.exec(key);
  return m ? Number(m[1]) : Number.NaN;
};

const nameOf = (r: Pick<Rec, "genus" | "genusNum" | "epithet" | "epithetNum">): string => {
  const genus = FAMILY_GENERA[r.genus] + (r.genusNum > 1 ? ` ${r.genusNum}` : "");
  return r.epithet === null ? genus : `${genus} ${FAMILY_EPITHETS[r.epithet]}${r.epithetNum > 1 ? ` ${r.epithetNum}` : ""}`;
};

/** Index `h` into a list of 64, moving on to the next unused (wrapping); when none is unused, `h` itself with the next numeral. */
function pick(h: number, uses: ReadonlyMap<number, number>): { index: number; num: number } {
  if (uses.size < 64) {
    let i = h;
    while (uses.has(i)) i = (i + 1) % 64;
    return { index: i, num: 1 };
  }
  return { index: h, num: (uses.get(h) ?? 0) + 1 };
}

export class FamilyTree {
  private s: State = { watchedFrom: null, lastStep: null, livingCells: 0, recs: [], runs: [], events: [], splits: [] };
  private byFounder = new Map<string, Rec>();
  /** Memos derived from `parentOf`, rebuilt on demand and never in a snapshot. */
  private readonly parents = new Map<string, string | null>();
  private readonly roots = new Map<string, string>();

  get watchedFrom(): number | null {
    return this.s.watchedFrom;
  }

  /** Latest observed census step, or null. */
  get lastStep(): number | null {
    return this.s.lastStep;
  }

  events(): readonly FamilyEvent[] {
    return this.s.events;
  }

  /** The longest current run, in steps, of a split candidate (0 with none): "5,000 steps" is the rung. */
  candidateRun(): number {
    const last = this.s.lastStep;
    return last === null ? 0 : this.s.runs.reduce((m, r) => Math.max(m, last - r[2]), 0);
  }

  /** The splits made at census `step`, in the order the tree made them. */
  splitsAt(step: number): FamilySplit[] {
    return this.s.splits.filter((x) => x.step === step).map((x) => ({ ...x }));
  }

  summary(): FamilySummary {
    const s = this.s;
    const count = (f: (r: Rec) => boolean) => s.recs.filter(f).length;
    return {
      rules: FAMILIES_RULESET,
      watchedFrom: s.watchedFrom,
      step: s.lastStep,
      named: s.recs.length,
      starting: count((r) => r.origin === "start"),
      split: count((r) => r.origin === "split"),
      living: count((r) => r.status === "living"),
      film: count((r) => r.status === "film"),
      extinct: count((r) => r.status === "extinct"),
    };
  }

  /** Every family in tree order: parents before children, siblings by founding step, then key birth order. */
  families(): FamilyView[] {
    const s = this.s;
    const kids = new Map<string | null, Rec[]>();
    for (const r of s.recs) {
      const list = kids.get(r.parent) ?? [];
      list.push(r);
      kids.set(r.parent, list);
    }
    for (const list of kids.values()) list.sort((a, b) => a.founded - b.founded || lineageKeyOrder(a.founder, b.founder));
    const out: FamilyView[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const r of kids.get(parent) ?? []) {
        out.push({
          founder: r.founder,
          name: r.name,
          parent: r.parent,
          parentName: r.parent === null ? null : (this.byFounder.get(r.parent)?.name ?? null),
          founded: r.founded,
          unknownDescent: r.unknownDescent,
          status: r.status,
          bodyNow: r.bodyNow,
          cells: r.cells,
          bodies: r.bodies,
          purity: r.bodyCells > 0 ? r.ownCells / r.bodyCells : null,
          share: s.livingCells > 0 ? r.cells / s.livingCells : 0,
          depth,
        });
        walk(r.founder, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  /**
   * A census with `input.step <= lastStep` is a no-op returning []. `parentOf` is the ledger's parent link for a key, undefined when
   * unknown (a root); it is asked once per key and must give the same answer from then on. Returns the events of this census (found,
   * split, then film, back and extinct in founding order). Throws if the parent links form a cycle.
   */
  observe(input: FamilyInput, parentOf: (key: string) => string | undefined): FamilyEvent[] {
    const s = this.s;
    if (s.lastStep !== null && input.step <= s.lastStep) return [];
    const step = input.step;
    const first = s.watchedFrom === null;
    const events: FamilyEvent[] = [];
    const T = FAMILY_THRESHOLDS;

    const parent = (k: string): string | null => {
      let p = this.parents.get(k);
      if (p === undefined) {
        const q = parentOf(k);
        p = q === undefined || q === k ? null : q;
        this.parents.set(k, p);
      }
      return p;
    };
    const rootOf = (k: string): string => {
      const path: string[] = [];
      let cur = k;
      let root: string;
      for (;;) {
        const known = this.roots.get(cur);
        if (known !== undefined) {
          root = known;
          break;
        }
        path.push(cur);
        const p = parent(cur);
        if (path.length > this.parents.size) throw new Error(`lineage parent links form a cycle at ${cur}`);
        if (p === null) {
          root = cur;
          break;
        }
        cur = p;
      }
      for (const x of path) this.roots.set(x, root);
      return root;
    };
    const descends = (key: string, of: string): boolean => {
      for (let k = parent(key), n = 0; k !== null; k = parent(k)) {
        if (k === of) return true;
        if (++n > this.parents.size) throw new Error(`lineage parent links form a cycle at ${k}`);
      }
      return false;
    };

    const living = input.lineages.filter((l) => l.cells > 0);
    s.livingCells = living.reduce((a, l) => a + l.cells, 0);
    if (first) s.watchedFrom = step;
    s.lastStep = step;

    // Roots: every root among the living ancestries founds a family. At the first census they are the starting families.
    const fresh = [...new Set(living.map((l) => rootOf(l.key)))].filter((r) => !this.byFounder.has(r)).sort(lineageKeyOrder);
    for (const root of fresh) {
      const rec = this.add(root, null, first ? "start" : "root", !first || hiOf(root) !== 0, step);
      if (!first) events.push({ step, kind: "found", family: root, name: rec.name, detail: `${rec.name} found: lineage ${root} has no known parent` });
    }

    // Membership: the nearest ancestor-or-self that founds a family.
    let memo = new Map<string, string | undefined>();
    const resolve = (k: string): string | undefined => {
      const path: string[] = [];
      let cur: string | null = k;
      let hit: string | undefined;
      while (cur !== null) {
        const m = memo.get(cur);
        if (m !== undefined) {
          hit = m;
          break;
        }
        path.push(cur);
        if (this.byFounder.has(cur)) {
          hit = cur;
          break;
        }
        if (path.length > this.parents.size + 1) throw new Error(`lineage parent links form a cycle at ${cur}`);
        cur = parent(cur);
      }
      if (hit !== undefined) for (const p of path) memo.set(p, hit);
      return hit;
    };
    const membersOf = () => {
      const out = new Map<string, { key: string; cells: number }[]>();
      for (const l of living) {
        const f = resolve(l.key);
        if (f === undefined) continue;
        const list = out.get(f) ?? [];
        list.push({ key: l.key, cells: l.cells });
        out.set(f, list);
      }
      return out;
    };
    const members = membersOf();

    // The split rule, on the membership as the census found it. A candidate is any lineage between a living member and the family's
    // founder, living or not; its half is the cells of the members descending from it or equal to it.
    const before = new Map(s.runs.map((r) => [r[0], r] as const));
    let next: [string, string, number][] = [];
    const chosen: { rec: Rec; key: string; half: number; rest: number; since: number }[] = [];
    for (const rec of s.recs) {
      if (rec.status === "extinct") continue;
      const list = members.get(rec.founder) ?? [];
      const total = list.reduce((a, m) => a + m.cells, 0);
      if (total < 2 * T.halfCells) continue;
      // Halves bottom-up, so a census costs one visit per lineage on the family's living ancestries, not one walk per member: mark
      // the nodes between each member and the founder (stopping at a node already marked), give each its depth below the founder,
      // then add each node's subtree into its parent, deepest first.
      const half = new Map<string, number>();
      const depth = new Map<string, number>([[rec.founder, 0]]);
      for (const m of list) {
        const path: string[] = [];
        let k: string | null = m.key;
        while (k !== null && !depth.has(k)) {
          path.push(k);
          k = parent(k);
        }
        let d = k === null ? 0 : depth.get(k)!;
        for (let i = path.length - 1; i >= 0; i--) {
          depth.set(path[i], ++d);
          half.set(path[i], 0);
        }
        if (m.key !== rec.founder) half.set(m.key, half.get(m.key)! + m.cells);
      }
      for (const k of [...half.keys()].sort((a, b) => depth.get(b)! - depth.get(a)!)) {
        const p = parent(k);
        if (p !== null && p !== rec.founder && half.has(p)) half.set(p, half.get(p)! + half.get(k)!);
      }
      let best: { key: string; half: number; since: number } | null = null;
      for (const [key, h] of half) {
        if (h < T.halfCells || total - h < T.halfCells) continue;
        const prev = before.get(key);
        const since = prev && prev[1] === rec.founder ? prev[2] : step;
        next.push([key, rec.founder, since]);
        if (step - since < T.splitSteps) continue;
        if (!best || since < best.since || (since === best.since && (h > best.half || (h === best.half && lineageKeyOrder(key, best.key) < 0)))) best = { key, half: h, since };
      }
      if (best) chosen.push({ rec, key: best.key, half: best.half, rest: total - best.half, since: best.since });
    }

    // Apply the splits in family order. A split clears the runs of its family (the new family has none yet), and families already split
    // from F that descend from L move beneath the new one.
    for (const c of chosen) {
      const root = this.rootRec(c.rec);
      const rec = this.add(c.key, c.rec.founder, "split", false, step, root);
      next = next.filter((r) => r[1] !== c.rec.founder);
      for (const g of s.recs) if (g.parent === c.rec.founder && g.founder !== c.key && descends(g.founder, c.key)) g.parent = c.key;
      events.push({
        step,
        kind: "split",
        family: c.key,
        name: rec.name,
        detail: `${rec.name} split from ${c.rec.name} at lineage ${c.key}: ${c.half} and ${c.rest} cells, both halves held since t=${num(c.since)}`,
      });
      s.splits.push({ name: rec.name, parentName: c.rec.name, step, cells: c.half, parentCells: c.rest });
    }
    s.runs = next;
    if (chosen.length) memo = new Map();
    const finalMembers = chosen.length ? membersOf() : members;

    // Cells, bodies and purity at this census.
    for (const r of s.recs) {
      r.cells = 0;
      r.bodies = 0;
      r.ownCells = 0;
      r.bodyCells = 0;
      r.bodyNow = false;
    }
    for (const [f, list] of finalMembers) this.byFounder.get(f)!.cells = list.reduce((a, m) => a + m.cells, 0);
    for (const b of input.bodies) {
      const counts = new Map<string, number>();
      for (const [k, n] of b.keys) {
        const f = n > 0 ? resolve(k) : undefined;
        if (f !== undefined) counts.set(f, (counts.get(f) ?? 0) + n);
      }
      let owner: string | null = null;
      for (const [f, n] of counts) {
        this.byFounder.get(f)!.bodyNow = true;
        if (owner === null || n > counts.get(owner)! || (n === counts.get(owner) && lineageKeyOrder(f, owner) < 0)) owner = f;
      }
      if (owner === null) continue; // no cell carrying a lineage: no family
      const r = this.byFounder.get(owner)!;
      r.bodies++;
      r.bodyCells += b.cells;
      r.ownCells += counts.get(owner)!;
    }

    // Status, with strict persistence. Extinct is final.
    for (const r of s.recs) {
      if (r.status === "extinct") continue;
      if (r.cells === 0) {
        r.status = "extinct";
        events.push({ step, kind: "extinct", family: r.founder, name: r.name, detail: `${r.name} extinct: no living cell left` });
        continue;
      }
      if (r.bodyNow) {
        r.noRun = 0;
        r.inRun++;
      } else {
        if (r.noRun === 0) r.noSince = step;
        r.noRun++;
        r.inRun = 0;
      }
      if (r.status === "living" && r.noRun >= T.filmCensuses) {
        r.status = "film";
        events.push({ step, kind: "film", family: r.founder, name: r.name, detail: `${r.name} gone to film: no cell in a body since t=${num(r.noSince)}` });
      } else if (r.status === "film" && r.inRun >= T.filmCensuses) {
        r.status = "living";
        events.push({ step, kind: "back", family: r.founder, name: r.name, detail: `${r.name} back from film: in a body again for ${T.filmCensuses} censuses` });
      }
    }
    s.events.push(...events);
    return events.map((e) => ({ ...e }));
  }

  private rootRec(r: Rec): Rec {
    let cur = r;
    for (let n = 0; cur.parent !== null && n <= this.s.recs.length; n++) cur = this.byFounder.get(cur.parent)!;
    return cur;
  }

  /** Founds a family. A root takes a genus word; a split takes its root family's genus and an epithet unique within it. */
  private add(founder: string, parent: string | null, origin: Rec["origin"], unknownDescent: boolean, step: number, root?: Rec): Rec {
    const recs = this.s.recs;
    const h = fnv1a32(founder) % 64;
    let genus: number;
    let genusNum: number;
    let epithet: number | null = null;
    let epithetNum = 1;
    if (origin === "split" && root) {
      genus = root.genus;
      genusNum = root.genusNum;
      const uses = new Map<number, number>();
      for (const r of recs) if (r.epithet !== null && r.genus === genus && r.genusNum === genusNum) uses.set(r.epithet, (uses.get(r.epithet) ?? 0) + 1);
      const e = pick(h, uses);
      epithet = e.index;
      epithetNum = e.num;
    } else {
      const uses = new Map<number, number>();
      for (const r of recs) if (r.epithet === null) uses.set(r.genus, (uses.get(r.genus) ?? 0) + 1);
      const g = pick(h, uses);
      genus = g.index;
      genusNum = g.num;
    }
    const rec: Rec = {
      founder, parent, founded: step, unknownDescent, origin, genus, genusNum, epithet, epithetNum, name: "",
      status: "living", noRun: 0, noSince: 0, inRun: 0, cells: 0, bodies: 0, ownCells: 0, bodyCells: 0, bodyNow: false,
    };
    rec.name = nameOf(rec);
    recs.push(rec);
    this.byFounder.set(founder, rec);
    return rec;
  }

  snapshot(): FamilySnapshot {
    return structuredClone({ v: 1 as const, ruleSet: FAMILIES_RULESET, ...this.s }) as FamilySnapshot;
  }

  /**
   * Throws only on a snapshot that is not one (wrong v/ruleSet/shape, a name that is not the one its fields give, a parent that does not
   * exist or loops); callers fall back to a fresh tree. The memos derived from `parentOf` are not in it and are rebuilt as keys are asked for.
   */
  static restore(snapshot: FamilySnapshot): FamilyTree {
    const snap = structuredClone(snapshot) as unknown as Record<string, unknown>;
    if (!snap || typeof snap !== "object" || snap.v !== 1 || snap.ruleSet !== FAMILIES_RULESET) throw new Error("not a family tree snapshot");
    const maybe = (v: unknown) => v === null || isInt(v);
    const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
    const fail = () => new Error("malformed family tree snapshot");
    if (!maybe(snap.watchedFrom) || !maybe(snap.lastStep) || (snap.watchedFrom === null) !== (snap.lastStep === null) || !isInt(snap.livingCells)) throw fail();
    if (!Array.isArray(snap.recs) || !Array.isArray(snap.runs) || !Array.isArray(snap.events) || !Array.isArray(snap.splits)) throw fail();
    const last = snap.lastStep as number | null;
    const from = snap.watchedFrom as number | null;
    if (last === null && (snap.recs.length || snap.runs.length || snap.events.length || snap.splits.length)) throw fail();
    const statuses = ["living", "film", "extinct"];
    const origins = ["start", "root", "split"];
    const recs: Rec[] = [];
    const byFounder = new Map<string, Rec>();
    const names = new Set<string>();
    for (const x of snap.recs as unknown[]) {
      if (!obj(x)) throw fail();
      const ok =
        isStr(x.founder) && (x.parent === null || isStr(x.parent)) && isInt(x.founded) && x.founded >= (from ?? 0) && x.founded <= (last ?? -1) &&
        typeof x.unknownDescent === "boolean" && origins.includes(x.origin as string) &&
        isInt(x.genus) && x.genus < 64 && isInt(x.genusNum) && x.genusNum >= 1 && (x.epithet === null || (isInt(x.epithet) && x.epithet < 64)) && isInt(x.epithetNum) && x.epithetNum >= 1 &&
        isStr(x.name) && statuses.includes(x.status as string) &&
        isInt(x.noRun) && isInt(x.noSince) && isInt(x.inRun) && isInt(x.cells) && isInt(x.bodies) && isInt(x.ownCells) && isInt(x.bodyCells) && typeof x.bodyNow === "boolean" &&
        (x.origin === "split") === (x.parent !== null) && (x.origin === "split") === (x.epithet !== null) && (x.origin !== "start" || x.founded === from) &&
        (x.epithet !== null || x.epithetNum === 1) && (x.status !== "extinct" || (x.cells === 0 && x.bodies === 0 && !x.bodyNow));
      if (!ok) throw fail();
      const r = x as unknown as Rec;
      if (r.name !== nameOf(r) || names.has(r.name) || byFounder.has(r.founder)) throw fail();
      names.add(r.name);
      byFounder.set(r.founder, r);
      recs.push(r);
    }
    // Parents exist, are not the family itself, and the tree has no loop; a split family carries its root's genus.
    for (const r of recs) {
      let cur: Rec = r;
      for (let n = 0; cur.parent !== null; n++) {
        const p = byFounder.get(cur.parent);
        if (!p || p === cur || n > recs.length) throw fail();
        cur = p;
      }
      if (r.origin === "split" && (cur.genus !== r.genus || cur.genusNum !== r.genusNum)) throw fail();
      if (r.origin !== "split" && cur !== r) throw fail();
    }
    const keys = new Set<string>();
    for (const x of snap.runs as unknown[]) {
      if (!Array.isArray(x) || x.length !== 3 || !isStr(x[0]) || !isStr(x[1]) || !isInt(x[2]) || x[2] > (last ?? -1) || !byFounder.has(x[1]) || keys.has(x[0])) throw fail();
      keys.add(x[0]);
    }
    const kinds = ["split", "film", "back", "extinct", "found"];
    for (const x of snap.events as unknown[]) {
      if (!obj(x) || !isInt(x.step) || x.step > (last ?? -1) || !kinds.includes(x.kind as string) || !isStr(x.family) || !isStr(x.name) || !isStr(x.detail) || byFounder.get(x.family)?.name !== x.name) throw fail();
    }
    for (const x of snap.splits as unknown[]) {
      if (!obj(x) || !isStr(x.name) || !isStr(x.parentName) || !isInt(x.step) || x.step > (last ?? -1) || !isInt(x.cells) || !isInt(x.parentCells) || !names.has(x.name) || !names.has(x.parentName)) throw fail();
    }
    const t = new FamilyTree();
    t.s = { watchedFrom: from, lastStep: last, livingCells: snap.livingCells as number, recs, runs: snap.runs as [string, string, number][], events: snap.events as FamilyEvent[], splits: snap.splits as FamilySplit[] };
    t.byFounder = byFounder;
    return t;
  }
}
