// Pond lineage dossiers for the scaffold line (docs/scaffold-protocol-v1.md, "Pond cycle"; design in
// docs/lineage-inspector.md, section 7). In a scaffold history every tile is a pond, and at each boundary
// every pond is ground down and reseeded by a k x k packet copied from a donor pond. Pond descent is
// therefore exact by construction, and ponds.tsv records it. This module reads that table by header name
// and builds the pond genealogy, subject rules, ancestry, offspring, clade sizes and the population band.
// Pure: no Deno API, no import from tools/lib/ponds.ts or tools/scaffold.ts (the pond code is moving into
// packages/schema, and reading the header keeps standalone histories and future runner bundles both readable).
//
// What a row means. Boundary c (c = 1, 2, ...) is step c * period, after the census. Row (c, r) of ponds.tsv
// holds two things about recipient r, both read from the PRE-CYCLE snapshot at boundary c:
//   * r's own state just before the transform ground it down: recipientTrait (B+P over cells with B+P >= 48),
//     recipientIndividuals (M3 census components in r's tile, -1 when no census ran), recipientLineages
//     (distinct lineage ids among cells with B+P >= 48) and heat (the gross energy booked when r was ground up);
//   * the transfer that reseeds r right after boundary c: donor d, and the k x k packet copied from d's
//     pre-cycle snapshot at the same boundary (donorTrait is d's own trait there, so it equals row (c, d)'s
//     recipientTrait; cx, cy are the packet centre in d's tile; landed, reqMass, retMass, reqE, retE,
//     truncated describe the copy; packetLineages, domHi:domLo and domShare describe the retained landed
//     cells with B+P > 0; light is the energy booked for them). A donor can seed several recipients and
//     can seed itself. Donor -1 and cx = cy = -1 mean no transfer (arm cont, or no pond was eligible).
//
// Node and parent. A node (p, c) is pond p's pre-cycle snapshot at boundary c, the state measured by row
// (c, p). Its parent, for c > 1, is (d, c - 1), where d is the donor of row (c - 1, p): the packet that
// reseeded p after boundary c - 1 was copied bit for bit from d's snapshot at c - 1, and p then grew for one
// period into (p, c). The packet columns of row (c - 1, p) therefore describe how node (p, c) was founded
// (its inbound packet), while the recipient* columns of row (c, p) describe node (p, c) itself. The donor of
// row (c, p) is NOT part of (p, c)'s ancestry: it names the parent of (p, c + 1). Nodes at cycle 1 have no
// parent: they grew from the initial standard disc. Nodes at the last cycle have children that are seeded
// but never measured: the rows of the last cycle record which ponds were seeded, and from what.
//
// Lineage ids ("hi:lo", as in lineages.tsv) persist through transfers because a packet carries all 44
// genome words, so the dominant packet lineage of a node is a genotype lineage the main lineage tool can open.
// The same id can be present in several ponds after one donor seeds several recipients. Standalone scaffold
// histories have no mutations.tsv, so genotype ancestry of those ids is only available once the runner
// integration writes bundles.
//
// Arm cont has no transfer: nothing is ground down, so a pond's ancestry is the pond itself. Its dossier says
// so (descent "none", chain = the pond's own trajectory, no offspring, no clade) and invents no descent.
//
// Selection caveat: in an arm scaf history the donors at a cycle are by construction the D' highest-trait
// ponds, so the top pond is a donor and has floor(R/D') or ceil(R/D') children, unless more than D' ponds tie
// for the top trait (the scaffold breaks donor ties by a random key, the top rule by the smallest pond index).
// Compare clade sizes across later cycles with the rand twin, not the first-generation child count.

import { lowbias32 } from "@bl/schema";

/** Version of the dossier object this module writes. */
export const DOSSIER_VERSION = 1;

export type PondArm = "scaf" | "rand" | "cont";

/** One ponds.tsv row, parsed by header name. Optional columns that the header lacks are null. */
export interface PondRecord {
  cycle: number;
  step: number;
  recipient: number;
  donor: number;
  recipientTrait: number;
  donorTrait: number | null;
  recipientIndividuals: number | null;
  recipientLineages: number | null;
  cx: number | null;
  cy: number | null;
  landed: number | null;
  reqMass: number | null;
  retMass: number | null;
  reqE: number | null;
  retE: number | null;
  truncated: boolean | null;
  packetLineages: number | null;
  domHi: number | null;
  domLo: number | null;
  domShare: number | null;
  /** Decimal strings of bigints. */
  heat: string | null;
  light: string | null;
}

export interface ParsedPonds {
  rows: PondRecord[];
  /** Optional columns the header lacks, so the dossier can list them as gaps. */
  absentColumns: string[];
}

/** Columns without which no genealogy can be built. */
const REQUIRED = ["cycle", "step", "recipient", "donor", "recipientTrait"] as const;
const OPTIONAL_INT = ["donorTrait", "recipientIndividuals", "recipientLineages", "cx", "cy", "landed", "reqMass", "retMass", "reqE", "retE", "truncated", "packetLineages", "domHi", "domLo"] as const;
const OPTIONAL = [...OPTIONAL_INT, "domShare", "heat", "light"] as const;

const lineageKey = (hi: number, lo: number): string => `${hi}:${lo}`;

/**
 * Parses a ponds.tsv (header first) by column name, so column order and extra columns do not matter. Throws,
 * naming the line, on a header that lacks a required column, a row with the wrong field count or a malformed number.
 */
export function parsePondRows(lines: Iterable<string>): ParsedPonds {
  const reader = rowReader();
  for (const l of lines) reader.push(l);
  return reader.finish();
}

/** `parsePondRows` over an async line stream (for example a file read line by line). */
export async function readPondRows(lines: AsyncIterable<string>): Promise<ParsedPonds> {
  const reader = rowReader();
  for await (const l of lines) reader.push(l);
  return reader.finish();
}

function rowReader(): { push(line: string): void; finish(): ParsedPonds } {
  let col: Map<string, number> | null = null;
  let width = 0;
  let lineNo = 0;
  const rows: PondRecord[] = [];
  const int = (f: string[], name: string, required: boolean): number | null => {
    const at = col!.get(name);
    if (at === undefined) return required ? fail(`missing column ${name}`) : null;
    const s = f[at];
    if (!/^-?\d+$/.test(s) || !Number.isSafeInteger(Number(s))) return fail(`${name} is not an integer: ${JSON.stringify(s)}`);
    return Number(s);
  };
  const fail = (msg: string): never => {
    throw new Error(`ponds.tsv line ${lineNo}: ${msg}`);
  };
  return {
    push(raw: string) {
      lineNo++;
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (line === "") return;
      const f = line.split("\t");
      if (col === null) {
        col = new Map();
        f.forEach((name, i) => {
          if (col!.has(name)) fail(`duplicate header column ${name}`);
          col!.set(name, i);
        });
        width = f.length;
        const lacking = REQUIRED.filter((c) => !col!.has(c));
        if (lacking.length) throw new Error(`ponds.tsv header lacks required column(s) ${lacking.join(", ")} (header has: ${f.join(", ")})`);
        return;
      }
      if (f.length !== width) fail(`${f.length} fields, header has ${width}`);
      const o = (name: (typeof OPTIONAL_INT)[number]) => int(f, name, false);
      const at = (name: string) => col!.get(name);
      let domShare: number | null = null;
      if (at("domShare") !== undefined) {
        domShare = Number(f[at("domShare")!]);
        if (!Number.isFinite(domShare) || domShare < 0 || domShare > 1) fail(`domShare is not in [0, 1]: ${JSON.stringify(f[at("domShare")!])}`);
      }
      const big = (name: string): string | null => {
        const i = at(name);
        if (i === undefined) return null;
        if (!/^-?\d+$/.test(f[i])) fail(`${name} is not an integer string: ${JSON.stringify(f[i])}`);
        return f[i];
      };
      const truncated = o("truncated");
      rows.push({
        cycle: int(f, "cycle", true)!,
        step: int(f, "step", true)!,
        recipient: int(f, "recipient", true)!,
        donor: int(f, "donor", true)!,
        recipientTrait: int(f, "recipientTrait", true)!,
        donorTrait: o("donorTrait"),
        recipientIndividuals: o("recipientIndividuals"),
        recipientLineages: o("recipientLineages"),
        cx: o("cx"),
        cy: o("cy"),
        landed: o("landed"),
        reqMass: o("reqMass"),
        retMass: o("retMass"),
        reqE: o("reqE"),
        retE: o("retE"),
        truncated: truncated === null ? null : truncated !== 0,
        packetLineages: o("packetLineages"),
        domHi: o("domHi"),
        domLo: o("domLo"),
        domShare,
        heat: big("heat"),
        light: big("light"),
      });
    },
    finish() {
      if (col === null) throw new Error("ponds.tsv is empty: no header line");
      const bad = rows.find((r) => r.cycle < 1 || r.recipient < 0 || r.donor < -1);
      if (bad) throw new Error(`ponds.tsv has a row with cycle ${bad.cycle}, recipient ${bad.recipient}, donor ${bad.donor} (cycle >= 1, recipient >= 0, donor >= -1 expected)`);
      return { rows, absentColumns: OPTIONAL.filter((c) => !col!.has(c)) };
    },
  };
}

// ---- history -------------------------------------------------------------------------------------------

/** A parsed history indexed by (cycle, recipient). */
export interface PondHistory {
  /** From meta.json when the caller knows it; null otherwise. */
  arm: PondArm | null;
  /** Pond ids, ascending. */
  ponds: number[];
  /** Cycles present, ascending and contiguous. */
  cycles: number[];
  firstCycle: number;
  lastCycle: number;
  /** Steps per cycle (step / cycle of the first row) or null if it is not an integer. */
  period: number | null;
  /** True when some cycle has donors, that is when descent through packets is recorded. */
  transfer: boolean;
  /** The cycle at which no pond was eligible (arm scaf or rand): the last cycle, or null. */
  endedAt: number | null;
  rows: Map<number, Map<number, PondRecord>>;
  absentColumns: string[];
  /** Non-fatal inconsistencies found while indexing (for example a donorTrait that differs from the donor's own trait). */
  warnings: string[];
}

/**
 * Indexes parsed rows. Throws on a duplicate (cycle, recipient), non-contiguous cycles, a cycle whose ponds
 * differ from cycle 1's, a donor that is not a pond, a cycle that mixes transfers with none, or a history
 * that continues past a cycle without transfers while another cycle has them. A last cycle that is missing
 * ponds (a torn append) is dropped and noted in `warnings`. `arm` "cont" with donors is an error.
 */
export function buildPondHistory(parsed: ParsedPonds, opts: { arm?: PondArm } = {}): PondHistory {
  const arm = opts.arm ?? null;
  const warnings: string[] = [];
  const byCycle = new Map<number, Map<number, PondRecord>>();
  for (const r of parsed.rows) {
    let m = byCycle.get(r.cycle);
    if (!m) byCycle.set(r.cycle, (m = new Map()));
    if (m.has(r.recipient)) throw new Error(`ponds.tsv has two rows for cycle ${r.cycle}, recipient ${r.recipient}`);
    m.set(r.recipient, r);
  }
  const cycles = [...byCycle.keys()].sort((a, b) => a - b);
  if (cycles.length === 0) throw new Error("ponds.tsv has no data rows");
  cycles.forEach((c, i) => {
    if (c !== cycles[0] + i) throw new Error(`ponds.tsv cycles are not contiguous: ${cycles[0]}..${cycles[cycles.length - 1]} lacks ${cycles[0] + i}`);
  });
  const ponds = [...byCycle.get(cycles[0])!.keys()].sort((a, b) => a - b);
  const pondSet = new Set(ponds);
  for (let i = 1; i < cycles.length; i++) {
    const m = byCycle.get(cycles[i])!;
    const same = m.size === ponds.length && ponds.every((p) => m.has(p));
    if (same) continue;
    if (i === cycles.length - 1 && [...m.keys()].every((p) => pondSet.has(p)) && m.size < ponds.length) {
      warnings.push(`cycle ${cycles[i]} has ${m.size} of ${ponds.length} ponds (a torn last append) and was dropped`);
      byCycle.delete(cycles[i]);
      cycles.pop();
      continue;
    }
    throw new Error(`ponds.tsv cycle ${cycles[i]} has a different set of ponds than cycle ${cycles[0]}`);
  }

  const hasDonors = (c: number) => [...byCycle.get(c)!.values()].some((r) => r.donor >= 0);
  const transferCycles = cycles.filter(hasDonors);
  for (const c of transferCycles) {
    for (const r of byCycle.get(c)!.values()) {
      if (r.donor < 0) throw new Error(`cycle ${c} mixes recipients with and without a donor (recipient ${r.recipient})`);
      if (!pondSet.has(r.donor)) throw new Error(`cycle ${c}, recipient ${r.recipient}: donor ${r.donor} is not a pond of this history`);
    }
  }
  const transfer = transferCycles.length > 0;
  const lastCycle = cycles[cycles.length - 1];
  if (arm === "cont" && transfer) throw new Error("arm cont has no donor transfer, but ponds.tsv records donors");
  if (transfer && transferCycles.length !== cycles.length && !(transferCycles.length === cycles.length - 1 && !hasDonors(lastCycle)))
    throw new Error("ponds.tsv has a cycle without transfers before its last cycle, yet other cycles have donors");

  const lastRows = [...byCycle.get(lastCycle)!.values()];
  const noneEligible = lastRows.every((r) => r.recipientTrait === 0);
  const endedAt = !hasDonors(lastCycle) && noneEligible && arm !== "cont" && (transfer || arm !== null) ? lastCycle : null;

  const first = byCycle.get(cycles[0])!.get(ponds[0])!;
  const period = first.step % first.cycle === 0 ? first.step / first.cycle : null;
  if (period !== null) {
    const off = parsed.rows.find((r) => byCycle.has(r.cycle) && r.step !== r.cycle * period);
    if (off) warnings.push(`step ${off.step} at cycle ${off.cycle} is not cycle x period (${period})`);
  }

  // Both traits come from the same pre-cycle snapshot, so the donor's own row must agree.
  let mismatches = 0, ineligible = 0;
  let example = "";
  for (const c of transferCycles) {
    const m = byCycle.get(c)!;
    for (const r of m.values()) {
      const d = m.get(r.donor)!;
      if (r.donorTrait !== null && r.donorTrait !== d.recipientTrait) {
        if (mismatches++ === 0) example = `cycle ${c}, recipient ${r.recipient}: donorTrait ${r.donorTrait} but donor ${r.donor} measured ${d.recipientTrait}`;
      }
      if (d.recipientTrait <= 0) ineligible++;
    }
  }
  if (mismatches) warnings.push(`${mismatches} donorTrait value(s) differ from the donor's own recipientTrait at the same cycle (first: ${example})`);
  if (ineligible) warnings.push(`${ineligible} recipient row(s) name a donor pond with trait 0`);

  return { arm, ponds, cycles, firstCycle: cycles[0], lastCycle, period, transfer, endedAt, rows: byCycle, absentColumns: parsed.absentColumns, warnings };
}

const rowAt = (h: PondHistory, cycle: number, pond: number): PondRecord => {
  const r = h.rows.get(cycle)?.get(pond);
  if (!r) throw new Error(`no ponds.tsv row for cycle ${cycle}, pond ${pond}`);
  return r;
};

// ---- subject rules -------------------------------------------------------------------------------------

/**
 * How the subject node is chosen (mirrors the genotype tool's rules). `cycle` defaults to the last cycle.
 *   explicit  the node (pond, cycle).
 *   top       the pond with the highest recipientTrait at the cycle; ties go to the smallest pond index; the
 *             trait must be above 0.
 *   random    a seeded uniform pick among the ponds with recipientTrait >= minTrait (default 1: eligible ponds),
 *             in ascending pond order; see `seededPick`.
 */
export type PondSubjectRule =
  | { kind: "explicit"; pond: number; cycle: number }
  | { kind: "top"; cycle?: number }
  | { kind: "random"; seed: number; cycle?: number; minTrait?: number };

/** The rule with every default filled in, as written to the dossier. */
export type ResolvedPondRule =
  | { kind: "explicit"; pond: number; cycle: number }
  | { kind: "top"; cycle: number; cycleDefaulted: boolean }
  | { kind: "random"; seed: number; cycle: number; cycleDefaulted: boolean; minTrait: number };

export interface PondSubject {
  pond: number;
  cycle: number;
  rule: ResolvedPondRule;
  /** Ponds the rule chose among (explicit: 1). */
  candidates: number;
  /** top: how many ponds share the highest trait (the smallest pond index won). */
  tied: number | null;
  /** random: the index into the ascending candidate list. */
  pickIndex: number | null;
}

/**
 * A deterministic uniform index in 0..n-1 from (seed, cycle): a lowbias32 stream, with rejection of the top
 * sliver of the 32-bit range so every index is exactly equally likely. Changing this changes which pond a
 * seed picks, so treat it as part of the rule.
 */
export function seededPick(seed: number, cycle: number, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new Error(`seededPick: n must be a positive integer, got ${n}`);
  const base = (lowbias32(seed) ^ Math.imul(cycle, 0x9e3779b1)) >>> 0;
  const limit = Math.floor(0x100000000 / n) * n;
  for (let ctr = 0; ; ctr++) {
    const h = lowbias32((base + Math.imul(ctr, 0x85ebca6b)) >>> 0);
    if (h < limit) return h % n;
  }
}

/** Resolves a rule against a history. `defaultCycle` replaces the history's last cycle as the default (see `pondTwin`). */
export function selectPondSubject(h: PondHistory, rule: PondSubjectRule, defaultCycle: number = h.lastCycle): PondSubject {
  const cycleDefaulted = rule.kind !== "explicit" && rule.cycle === undefined;
  const cycle = rule.kind === "explicit" ? rule.cycle : (rule.cycle ?? defaultCycle);
  if (!Number.isInteger(cycle) || cycle < h.firstCycle || cycle > h.lastCycle) throw new Error(`cycle ${cycle} is outside this history's cycles ${h.firstCycle}..${h.lastCycle}`);
  const rows = h.rows.get(cycle)!;
  if (rule.kind === "explicit") {
    if (!rows.has(rule.pond)) throw new Error(`pond ${rule.pond} is not in this history (ponds ${h.ponds[0]}..${h.ponds[h.ponds.length - 1]})`);
    return { pond: rule.pond, cycle, rule: { kind: "explicit", pond: rule.pond, cycle }, candidates: 1, tied: null, pickIndex: null };
  }
  if (rule.kind === "top") {
    let best = -1, tied = 0, pond = -1;
    for (const p of h.ponds) {
      const t = rows.get(p)!.recipientTrait;
      if (t > best) {
        best = t;
        pond = p;
        tied = 1;
      } else if (t === best) tied++;
    }
    if (best <= 0) throw new Error(`no eligible pond at cycle ${cycle}: every pond has trait 0 (pass an explicit cycle)`);
    return { pond, cycle, rule: { kind: "top", cycle, cycleDefaulted }, candidates: h.ponds.filter((p) => rows.get(p)!.recipientTrait > 0).length, tied, pickIndex: null };
  }
  if (!Number.isInteger(rule.seed) || rule.seed < 0 || rule.seed > 0xffffffff) throw new Error(`random seed must be an integer in 0..4294967295, got ${rule.seed}`);
  const minTrait = rule.minTrait ?? 1;
  if (!Number.isInteger(minTrait) || minTrait < 0) throw new Error(`minTrait must be a non-negative integer, got ${minTrait}`);
  const pool = h.ponds.filter((p) => rows.get(p)!.recipientTrait >= minTrait);
  if (pool.length === 0) throw new Error(`no pond has trait >= ${minTrait} at cycle ${cycle}`);
  const pickIndex = seededPick(rule.seed, cycle, pool.length);
  return { pond: pool[pickIndex], cycle, rule: { kind: "random", seed: rule.seed, cycle, cycleDefaulted, minTrait }, candidates: pool.length, tied: null, pickIndex };
}

// ---- population band -----------------------------------------------------------------------------------

export interface PondBandPoint {
  cycle: number;
  step: number;
  /** Ponds, and how many of them have trait > 0. */
  n: number;
  eligible: number;
  /** Order statistics of the trait over all ponds (nearest rank, rank = ceil(q n), lower median for even n). */
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  sum: number;
}

/** Trait distribution across all ponds at every cycle, for drawing a subject's trace over a band. */
export function traitBand(h: PondHistory): PondBandPoint[] {
  return h.cycles.map((cycle) => {
    const rows = [...h.rows.get(cycle)!.values()];
    const t = rows.map((r) => r.recipientTrait).sort((a, b) => a - b);
    const n = t.length;
    const nth = (num: number, den: number) => t[Math.max(1, Math.floor((n * num + den - 1) / den)) - 1];
    return { cycle, step: rows[0].step, n, eligible: t.filter((x) => x > 0).length, min: t[0], q1: nth(1, 4), median: nth(1, 2), q3: nth(3, 4), max: t[n - 1], sum: t.reduce((a, x) => a + x, 0) };
  });
}

// ---- dossier -------------------------------------------------------------------------------------------

/** The packet that reseeded a pond, with the donor's side of it. Fields the header lacks are null. */
export interface PondPacket {
  donor: number;
  /** The donor's own pre-cycle trait at the boundary the packet was taken. */
  donorTrait: number | null;
  /** Packet centre in the donor's tile-local coordinates. */
  cx: number | null;
  cy: number | null;
  /** Cells landed, B+P requested and retained, E requested and retained (retained < requested only when truncated). */
  landed: number | null;
  reqMass: number | null;
  retMass: number | null;
  reqE: number | null;
  retE: number | null;
  truncated: boolean | null;
  /** Distinct lineage ids among retained cells with B+P > 0. */
  lineages: number | null;
  /** The packet's dominant lineage by B+P ("hi:lo"; ties to the smallest id) and its share of the retained B+P. null when the packet holds none. */
  dominant: string | null;
  domShare: number | null;
  /** Gross energy booked as light for the retained cells (decimal string). */
  light: string | null;
}

export interface PondNode {
  pond: number;
  cycle: number;
  step: number;
  /** The pond's own pre-cycle trait (B+P over cells with B+P >= 48), census individuals (null if none ran), distinct lineages, and heat booked when it was ground up. */
  trait: number;
  individuals: number | null;
  lineages: number | null;
  heat: string | null;
  /** (donor, cycle - 1), or null at the first cycle and for histories without transfers. */
  parent: { pond: number; cycle: number } | null;
  /** The packet that founded this node's period, from row (cycle - 1, pond); null when parent is null. */
  packet: PondPacket | null;
  /** On a dossier's chain: ponds at the subject's cycle whose ancestry passes through this node (the subject itself counts 1). null without transfers. */
  descendants: number | null;
}

export interface PondChild {
  pond: number;
  /** The child node is (pond, cycle + 1). */
  cycle: number;
  /** The child's own trait, or null when its boundary was never reached (the subject is at the last cycle). */
  trait: number | null;
  /** How many ponds the child itself seeded at its boundary, or null when unmeasured. */
  seeded: number | null;
  packet: PondPacket;
}

export interface PondOffspring {
  /** Recipients of the subject's boundary whose donor was the subject, in pond order. Exact. */
  count: number;
  /** False when the children are seeded at the last boundary and so never measured. */
  measured: boolean;
  children: PondChild[];
}

export interface CladePoint {
  cycle: number;
  /** Ponds whose ancestry passes through the subject node (the subject itself at its own cycle), how many of them have trait > 0, and their trait sum. */
  size: number;
  eligible: number;
  traitSum: number;
}

export interface PondClade {
  series: CladePoint[];
  /** The clade has a node at the last cycle / a node with trait > 0 there. */
  extant: boolean;
  alive: boolean;
  /** First cycle at which the clade has no node, or null. */
  extinctAt: number | null;
  /** Ponds seeded at the last boundary by clade members: unmeasured, since the history ends there. */
  seededAfterLast: number;
}

export interface PondDossier {
  kind: "pond";
  dossierVersion: 1;
  arm: PondArm | null;
  /** "donor-packet": ancestry follows recorded donors. "none": the history has no transfer (arm cont), so a pond's ancestry is the pond itself. */
  descent: "donor-packet" | "none";
  subject: {
    pond: number;
    cycle: number;
    step: number;
    trait: number;
    /** 1 + the number of ponds with a strictly higher trait at the subject's cycle, out of `of` ponds. */
    rank: number;
    of: number;
    rule: ResolvedPondRule;
    candidates: number;
    tied: number | null;
    pickIndex: number | null;
  };
  history: { ponds: number; firstCycle: number; lastCycle: number; period: number | null; endedAt: number | null };
  ancestry: {
    /** Transfers on the path from the root to the subject (0 without transfers). */
    depth: number;
    rootPond: number;
    rootCycle: number;
    /** Distinct ponds among the subject's ancestors (every chain node but the subject): the donors the line passed through. */
    distinctDonorPonds: number;
    /**
     * The latest chain cycle whose node every pond at the subject's cycle descends from: the ancestry up to there
     * is the whole population's, not the subject's own. null if no chain node is that old (or there is no transfer).
     */
    commonAncestorCycle: number | null;
    /** Root first, subject last. Without transfers: the pond's own nodes, cycle by cycle, with parent null. */
    chain: PondNode[];
  };
  /** The packet dominant lineage of each chain node that has one, for opening genotype dossiers. */
  genotypeLinks: { pond: number; cycle: number; lineage: string; share: number | null }[];
  /** null when there is no transfer. */
  offspring: PondOffspring | null;
  clade: PondClade | null;
  band: PondBandPoint[];
  notes: string[];
  gaps: string[];
  warnings: string[];
}

function packetOf(r: PondRecord): PondPacket {
  const dom = r.domHi !== null && r.domLo !== null && (r.domHi | r.domLo) !== 0 ? lineageKey(r.domHi, r.domLo) : null;
  return {
    donor: r.donor,
    donorTrait: r.donorTrait,
    cx: r.cx,
    cy: r.cy,
    landed: r.landed,
    reqMass: r.reqMass,
    retMass: r.retMass,
    reqE: r.reqE,
    retE: r.retE,
    truncated: r.truncated,
    lineages: r.packetLineages,
    dominant: dom,
    domShare: r.domShare,
    light: r.light,
  };
}

function nodeOf(h: PondHistory, pond: number, cycle: number): PondNode {
  const own = rowAt(h, cycle, pond);
  const inbound = h.transfer && cycle > h.firstCycle ? rowAt(h, cycle - 1, pond) : null;
  return {
    pond,
    cycle,
    step: own.step,
    trait: own.recipientTrait,
    individuals: own.recipientIndividuals !== null && own.recipientIndividuals >= 0 ? own.recipientIndividuals : null,
    lineages: own.recipientLineages,
    heat: own.heat,
    parent: inbound ? { pond: inbound.donor, cycle: cycle - 1 } : null,
    packet: inbound ? packetOf(inbound) : null,
    descendants: null,
  };
}

/** Root-first chain of nodes ending at (pond, cycle); without transfers, the pond's own nodes from the first cycle. */
function chainOf(h: PondHistory, pond: number, cycle: number): PondNode[] {
  const chain: PondNode[] = [];
  if (!h.transfer) {
    for (let c = h.firstCycle; c <= cycle; c++) chain.push(nodeOf(h, pond, c));
    return chain;
  }
  let p = pond;
  for (let c = cycle; c >= h.firstCycle; c--) {
    const n = nodeOf(h, p, c);
    chain.push(n);
    if (!n.parent) break;
    p = n.parent.pond;
  }
  return chain.reverse();
}

const recipientsOf = (h: PondHistory, cycle: number, donors: ReadonlySet<number>): number[] =>
  [...h.rows.get(cycle)!.values()].filter((r) => donors.has(r.donor)).map((r) => r.recipient).sort((a, b) => a - b);

/**
 * Sets each chain node's `descendants`: the ponds at the subject's cycle whose ancestry passes through it.
 * One backward pass from the subject's cycle, linear in the history: a pond's count at cycle c is the sum of
 * the counts at c + 1 of the recipients it seeded at boundary c. Chain nodes sit at consecutive cycles.
 */
function setDescendants(h: PondHistory, chain: PondNode[]): void {
  let count = new Map<number, number>(h.ponds.map((p) => [p, 1]));
  for (let i = chain.length - 1; i >= 0; i--) {
    chain[i].descendants = count.get(chain[i].pond) ?? 0;
    if (i === 0) break;
    const prev = new Map<number, number>();
    for (const r of h.rows.get(chain[i].cycle - 1)!.values()) prev.set(r.donor, (prev.get(r.donor) ?? 0) + (count.get(r.recipient) ?? 0));
    count = prev;
  }
}

function offspringOf(h: PondHistory, pond: number, cycle: number): PondOffspring {
  const measured = cycle < h.lastCycle;
  const children = recipientsOf(h, cycle, new Set([pond])).map((r): PondChild => {
    const next = measured ? rowAt(h, cycle + 1, r) : null;
    return {
      pond: r,
      cycle: cycle + 1,
      trait: next ? next.recipientTrait : null,
      seeded: next ? recipientsOf(h, cycle + 1, new Set([r])).length : null,
      packet: packetOf(rowAt(h, cycle, r)),
    };
  });
  return { count: children.length, measured, children };
}

function cladeOf(h: PondHistory, pond: number, cycle: number): PondClade {
  const series: CladePoint[] = [];
  let members = new Set<number>([pond]);
  const point = (c: number): CladePoint => {
    const rows = [...members].map((p) => rowAt(h, c, p));
    return { cycle: c, size: rows.length, eligible: rows.filter((r) => r.recipientTrait > 0).length, traitSum: rows.reduce((a, r) => a + r.recipientTrait, 0) };
  };
  series.push(point(cycle));
  for (let c = cycle; c < h.lastCycle; c++) {
    members = new Set(recipientsOf(h, c, members));
    series.push(point(c + 1));
  }
  const last = series[series.length - 1];
  const dead = series.find((s) => s.size === 0);
  return { series, extant: last.size > 0, alive: last.eligible > 0, extinctAt: dead ? dead.cycle : null, seededAfterLast: recipientsOf(h, h.lastCycle, members).length };
}

/**
 * The dossier of one pond node: its rule, ancestry chain, offspring and clade, the population band, and the
 * gaps. `defaultCycle` is the cycle a rule without `cycle` resolves to (default: the history's last cycle).
 */
export function pondDossier(h: PondHistory, rule: PondSubjectRule, opts: { defaultCycle?: number } = {}): PondDossier {
  const s = selectPondSubject(h, rule, opts.defaultCycle);
  const own = rowAt(h, s.cycle, s.pond);
  const chain = chainOf(h, s.pond, s.cycle);
  if (h.transfer) setDescendants(h, chain);
  const ancestors = h.transfer ? chain.slice(0, -1) : [];
  const common = chain.filter((n) => n.descendants === h.ponds.length).map((n) => n.cycle);
  const rank = 1 + [...h.rows.get(s.cycle)!.values()].filter((r) => r.recipientTrait > own.recipientTrait).length;

  const notes: string[] = [];
  if (!h.transfer) notes.push("no donor transfer is recorded (arm cont, or no pond was eligible at the first boundary): a pond's ancestry is the pond itself, so the chain is its own trajectory and there is no offspring or clade");
  if (s.rule.kind === "top" && h.arm === "scaf") {
    const tie = s.tied !== null && s.tied > 1 ? `; ${s.tied} ponds tie for the top trait and the scaffold breaks donor ties by a random key, so this pick (the smallest pond index) need not be a donor` : "";
    notes.push(`in arm scaf the donors at a cycle are the highest-trait ponds by construction, so a top subject's child count reflects that selection, not its success; compare clade sizes at later cycles${tie}`);
  }
  if (h.endedAt !== null) notes.push(`no pond was eligible at cycle ${h.endedAt}: the history ended there`);

  const gaps = [
    "mutations.tsv: standalone scaffold histories have none, so the genotype ancestry of the packet lineages is not reconstructable until the runner integration writes bundles",
    "lineage composition of the subject's own pond: lineages.tsv holds it only at boundaries 1, floor(C/3), floor(2C/3) and C (every boundary when mutation is off), and it is not read here",
    "packet contents beyond the lineage count and the dominant lineage",
    "pond state between boundaries: ponds.tsv has one pre-cycle snapshot per boundary",
    ...h.absentColumns.map((c) => `column ${c} is absent from the ponds.tsv header`),
  ];
  if (h.arm === null) gaps.push("arm: not supplied (meta.json), so cont and an ended scaf/rand history are told apart only by the rows");
  if (h.transfer && s.cycle === h.lastCycle) gaps.push("the subject's children are seeded at the last boundary but never measured");

  return {
    kind: "pond",
    dossierVersion: DOSSIER_VERSION,
    arm: h.arm,
    descent: h.transfer ? "donor-packet" : "none",
    subject: { pond: s.pond, cycle: s.cycle, step: own.step, trait: own.recipientTrait, rank, of: h.ponds.length, rule: s.rule, candidates: s.candidates, tied: s.tied, pickIndex: s.pickIndex },
    history: { ponds: h.ponds.length, firstCycle: h.firstCycle, lastCycle: h.lastCycle, period: h.period, endedAt: h.endedAt },
    ancestry: {
      depth: h.transfer ? chain.length - 1 : 0,
      rootPond: chain[0].pond,
      rootCycle: chain[0].cycle,
      distinctDonorPonds: new Set(ancestors.map((n) => n.pond)).size,
      commonAncestorCycle: common.length ? Math.max(...common) : null,
      chain,
    },
    genotypeLinks: chain.filter((n) => n.packet?.dominant).map((n) => ({ pond: n.pond, cycle: n.cycle, lineage: n.packet!.dominant!, share: n.packet!.domShare })),
    offspring: h.transfer ? offspringOf(h, s.pond, s.cycle) : null,
    clade: h.transfer ? cladeOf(h, s.pond, s.cycle) : null,
    band: traitBand(h),
    notes,
    gaps,
    warnings: [...h.warnings],
  };
}

// ---- twin ----------------------------------------------------------------------------------------------

export interface PondTwin {
  kind: "pond-twin";
  dossierVersion: 1;
  /** The rule as resolved for the scaf history. */
  rule: ResolvedPondRule;
  scaf: PondDossier;
  rand: PondDossier;
  notes: string[];
}

/**
 * The same subject rule applied to a scaf history and its rand twin (same replicate index). A rule without
 * `cycle` resolves to the last cycle both histories reached, so the two dossiers are read at the same boundary
 * even when one ended early. The two histories must have the same number of ponds. The pick of a seeded
 * random rule is an index into each history's own candidate list, so the two histories can name different ponds.
 */
export function pondTwin(scaf: PondHistory, rand: PondHistory, rule: PondSubjectRule): PondTwin {
  if (scaf.arm !== null && scaf.arm !== "scaf") throw new Error(`pondTwin: the first history is arm ${scaf.arm}, expected scaf`);
  if (rand.arm !== null && rand.arm !== "rand") throw new Error(`pondTwin: the second history is arm ${rand.arm}, expected rand`);
  if (scaf.ponds.length !== rand.ponds.length) throw new Error(`pondTwin: the histories have ${scaf.ponds.length} and ${rand.ponds.length} ponds`);
  const defaultCycle = Math.min(scaf.lastCycle, rand.lastCycle);
  const a = pondDossier(scaf, rule, { defaultCycle });
  const b = pondDossier(rand, rule, { defaultCycle });
  const notes = [
    "scaf and rand histories use different seeds (protocol: 4,810,001 + 100 x arm + i) and share no random stream: they are matched by replicate index and protocol, not by physics",
  ];
  if (scaf.lastCycle !== rand.lastCycle) notes.push(`the histories reached cycles ${scaf.lastCycle} and ${rand.lastCycle}; a rule without a cycle uses ${defaultCycle}`);
  return { kind: "pond-twin", dossierVersion: DOSSIER_VERSION, rule: a.subject.rule, scaf: a, rand: b, notes };
}
