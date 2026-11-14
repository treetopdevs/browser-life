// Post-takeover evolution in the BFF soup: types, censuses, competition
// assays, the neutral marker control, the interaction probe and leader
// trends. Definitions and decision rules: docs/soup-evolution-2026-10-31.md.
//
// A program's key is its 64 bytes with zero bytes as "0" and every other
// non-instruction byte as "_" (loops test for zero, so zero is kept apart).
// Copiers write their copy back to front and sometimes shifted, so a type is
// the class of a key under the 128 transforms "rotate by r, optionally
// reverse", and distances are taken over those transforms.
import { DEFAULT_MUTATION, evaluate, type Grid, type Lang, selfRep, Soup, TAPE } from "./bff.ts";

const UNDERSCORE = 95, ZERO = 48;
const IS_CMD = new Uint8Array(256);
for (const c of "[]+-.,<>{}") IS_CMD[c.charCodeAt(0)] = 1;

export const MIN_INSTRUCTIONS = 6;
export const COPIER = 48; // copy test at or above: a copier (host)
export const NON_COPIER = 16; // at or below: cannot copy itself
// A program is of a type when its type distance is at most MATCH_FRACTION of
// the type's symbols (instructions and zeros in forms[0]'s key); random
// programs sit about 1-2 below that count, so 40% keeps them out. The
// interaction probe labels halves at PROBE_FRACTION.
export const MATCH_FRACTION = 0.4;
export const PROBE_FRACTION = 0.25;

export function isInstruction(b: number): boolean { return IS_CMD[b] === 1; }

const KEY = new Uint8Array(256);
for (let b = 0; b < 256; b++) KEY[b] = IS_CMD[b] ? b : b === 0 ? ZERO : UNDERSCORE;

/** The program's key: instruction bytes kept, zero bytes "0", every other byte "_". */
export function keyOf(prog: Uint8Array): Uint8Array {
  const k = new Uint8Array(TAPE);
  for (let i = 0; i < TAPE; i++) k[i] = KEY[prog[i]];
  return k;
}

export function instructions(prog: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < TAPE; i++) n += IS_CMD[prog[i]];
  return n;
}

/** Source index of output position i under transform t (0..127): r = t & 63 rotation, t >= 64 reversed. */
export function src(t: number, i: number): number {
  const j = (i + (t & 63)) & 63;
  return t >= 64 ? 63 - j : j;
}

/** All 128 transforms of a 64-byte array, concatenated (128 * 64 bytes). */
export function transforms(x: Uint8Array): Uint8Array {
  const out = new Uint8Array(128 * TAPE);
  for (let t = 0; t < 128; t++) for (let i = 0; i < TAPE; i++) out[t * TAPE + i] = x[src(t, i)];
  return out;
}

const latin1 = (b: Uint8Array) => String.fromCharCode(...b);
export const bytesOf = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Canonical key of a type: the smallest of the key's 128 transforms. */
export function canonical(key: Uint8Array): string {
  const all = transforms(key);
  let best = latin1(all.subarray(0, TAPE));
  for (let t = 1; t < 128; t++) {
    const s = latin1(all.subarray(t * TAPE, (t + 1) * TAPE));
    if (s < best) best = s;
  }
  return best;
}

export function typeId(canon: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) h = Math.imul(h ^ canon.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** A type's references: the keys of its representatives, pre-transformed for distance queries. */
export class TypeRef {
  readonly forms: Uint8Array[]; // exact representative programs (1 or 2)
  readonly key: Uint8Array; // key of forms[0]
  readonly table: Uint8Array; // 128 transforms of forms[0]'s key; the mirror form is (nearly) one of them
  readonly tables: Uint8Array[];
  private mirror: Int16Array | null = null;
  readonly symbols: number; // instructions and zeros in forms[0]'s key
  readonly match: number; // classification radius: floor(MATCH_FRACTION * symbols), at least 1
  readonly probe: number; // probe radius: floor(PROBE_FRACTION * symbols), at least 1
  constructor(forms: Uint8Array[]) {
    if (forms.length === 0) throw new Error("a type needs a representative");
    this.forms = forms;
    this.key = keyOf(forms[0]);
    this.tables = forms.map((f) => transforms(keyOf(f)));
    this.table = this.tables[0];
    this.symbols = this.key.reduce((n, b) => n + (b === UNDERSCORE ? 0 : 1), 0);
    this.match = Math.max(1, Math.floor(MATCH_FRACTION * this.symbols));
    this.probe = Math.max(1, Math.floor(PROBE_FRACTION * this.symbols));
  }

  /** Smallest key Hamming distance from `prog` (at offset) to any transform of any form, giving up above `limit`; `t` is the best transform of that form. */
  distance(prog: Uint8Array, off = 0, limit = TAPE): { d: number; form: number; t: number } {
    const k = SCRATCH;
    for (let i = 0; i < TAPE; i++) k[i] = KEY[prog[off + i]];
    let best = limit + 1, bf = 0, bt = 0;
    for (let f = 0; f < this.tables.length; f++) {
      const tab = this.tables[f];
      for (let t = 0; t < 128; t++) {
        let d = 0;
        const base = t * TAPE;
        for (let i = 0; i < TAPE && d < best; i++) if (k[i] !== tab[base + i]) d++;
        if (d < best) { best = d; bf = f; bt = t; if (d === 0) return { d, form: f, t }; }
      }
    }
    return { d: best, form: bf, t: bt };
  }

  /** For a two-form type: mirrorMap()[i] is the position in forms[1] holding forms[0][i] (best key alignment); identity for one form. */
  mirrorMap(): Int16Array {
    if (this.mirror) return this.mirror;
    const m = new Int16Array(TAPE);
    if (this.forms.length < 2) { for (let i = 0; i < TAPE; i++) m[i] = i; return this.mirror = m; }
    // forms[1] ~ T_t(forms[0]), i.e. forms[1][i] = forms[0][src(t, i)]
    const k1 = keyOf(this.forms[1]);
    let best = TAPE + 1, bt = 0;
    for (let t = 0; t < 128; t++) {
      let d = 0;
      for (let i = 0; i < TAPE; i++) if (k1[i] !== this.table[t * TAPE + i]) d++;
      if (d < best) { best = d; bt = t; }
    }
    for (let i = 0; i < TAPE; i++) m[src(bt, i)] = i;
    return this.mirror = m;
  }
}

const SCRATCH = new Uint8Array(TAPE);

// ---- census ----

export interface TypeRow {
  id: string;
  canon: string; // canonical key, latin1
  count: number;
  share: number;
  families: number;
  rep: string; // hex of forms[0]
  mirror: string | null; // hex of the mirror form's most common program
  selfRep: number | null; // copy test of rep (computed for the larger types)
  instructions: number;
}

export interface Snapshot {
  epoch: number;
  num: number;
  distinct: number;
  keyed: number; // programs with at least MIN_INSTRUCTIONS instructions
  typesAbove: number; // types with share >= 0.1%
  diversity: number; // Shannon (nats) over types, keyed programs only
  copierShare: number; // share of all programs in types with selfRep >= COPIER (among types tested)
  leader: string | null; // largest type with selfRep >= COPIER
  types: TypeRow[]; // top types by count
}

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const unhex = (s: string) => Uint8Array.from(s.match(/../g)!, (h) => parseInt(h, 16));

/** Types in a soup. `top` rows are kept; copy tests run on types with share >= `testShare` (at most `maxTests`). */
export function typeCensus(programs: Uint8Array, epoch: number, opts: { top?: number; testShare?: number; maxTests?: number; lang?: Lang } = {}): Snapshot {
  const { top = 64, testShare = 0.001, maxTests = 1000, lang = "noheads" } = opts;
  const num = programs.length / TAPE;
  const exact = new Map<string, number>();
  const fam = new Map<string, Map<string, number>>(); // key -> exact program -> count
  let keyed = 0;
  for (let p = 0; p < num; p++) {
    const prog = programs.subarray(p * TAPE, (p + 1) * TAPE);
    const e = latin1(prog);
    exact.set(e, (exact.get(e) ?? 0) + 1);
    if (instructions(prog) < MIN_INSTRUCTIONS) continue;
    keyed++;
    const k = latin1(keyOf(prog));
    let m = fam.get(k);
    if (!m) fam.set(k, m = new Map());
    m.set(e, (m.get(e) ?? 0) + 1);
  }
  interface Acc { canon: string; count: number; fams: { key: string; count: number; best: string; bestN: number }[] }
  const types = new Map<string, Acc>();
  for (const [k, m] of fam) {
    let count = 0, best = "", bestN = 0;
    for (const [e, c] of m) { count += c; if (c > bestN || (c === bestN && e < best)) { bestN = c; best = e; } }
    const c = canonical(bytesOf(k));
    let acc = types.get(c);
    if (!acc) types.set(c, acc = { canon: c, count: 0, fams: [] });
    acc.count += count;
    acc.fams.push({ key: k, count, best, bestN });
  }
  const sorted = [...types.values()].sort((a, b) => b.count - a.count || (a.canon < b.canon ? -1 : 1));
  let diversity = 0;
  for (const t of sorted) { const f = t.count / keyed; diversity -= f * Math.log(f); }
  const rows: TypeRow[] = [];
  let tests = 0, copierN = 0, leader: string | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const share = t.count / num;
    const test = share >= testShare && tests < maxTests;
    if (!test && i >= top) break;
    t.fams.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
    const main = t.fams[0];
    const rep = bytesOf(main.best);
    // The mirror family: the largest other family whose key is a reversed transform of the main key.
    const mainT = transforms(bytesOf(main.key));
    let mirror: string | null = null;
    for (const f of t.fams.slice(1)) {
      const fk = f.key;
      let isRev = false;
      for (let tt = 64; tt < 128 && !isRev; tt++) isRev = latin1(mainT.subarray(tt * TAPE, (tt + 1) * TAPE)) === fk;
      if (isRev) { mirror = hex(bytesOf(f.best)); break; }
    }
    let sr: number | null = null;
    if (test) { sr = selfRep(rep, lang); tests++; if (sr >= COPIER) { copierN += t.count; if (!leader) leader = typeId(t.canon); } }
    if (i < top || test) rows.push({ id: typeId(t.canon), canon: t.canon, count: t.count, share, families: t.fams.length, rep: hex(rep), mirror, selfRep: sr, instructions: instructions(rep) });
  }
  const typesAbove = sorted.filter((t) => t.count / num >= 0.001).length;
  return { epoch, num, distinct: exact.size, keyed, typesAbove, diversity, copierShare: copierN / num, leader, types: rows };
}

export function refOf(row: Pick<TypeRow, "rep" | "mirror">): TypeRef {
  return new TypeRef(row.mirror ? [unhex(row.rep), unhex(row.mirror)] : [unhex(row.rep)]);
}

// ---- small deterministic PRNG for partners, mutants and assay seeds ----

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

export function randomProgram(r: () => number): Uint8Array {
  const p = new Uint8Array(TAPE);
  for (let i = 0; i < TAPE; i++) p[i] = Math.floor(r() * 256);
  return p;
}

// ---- competition assays ----

export interface AssayJob {
  id: string;
  kind: "pair" | "neutral" | "grid" | "gneutral" | "xpair" | "mpair"; // xpair: exploratory time points (doc: Exploratory); mpair: rerun's two-marker control
  lineage: string;
  rare: string; // type id (or "<id>*" for the marked neutral form)
  common: string;
  rareForms: string[]; // hex programs
  commonForms: string[];
  seed: number;
  num?: number; // well-mixed size (default 16384)
  grid?: Grid; // grid assays
  rareCount?: number; // default 2048 (12.5%; 512 on the 64 x 64 grid)
  epochs?: number; // default 512
  every?: number; // default 64
  marker?: { pos: number; value: number; original: number }; // neutral: position in rareForms[0]; mpair: the rare side's marker
  marker2?: { pos: number; value: number; original: number }; // mpair: the common side's marker (rerun doc)
  validAt?: number[]; // extra epochs at which the invalid-run rule is also applied (rerun doc: 512-epoch reading)
}

export interface AssayPoint { epoch: number; rare: number; common: number; other: number; f: number }
export interface AssayResult { id: string; job: Omit<AssayJob, "rareForms" | "commonForms">; points: AssayPoint[]; final: AssayPoint; valid: boolean; intruder: { id: string; count: number; selfRep: number } | null; validAt?: Record<number, boolean> }

/** Indices of the central square patch of `count` cells on a grid (closest square, trimmed row by row). */
export function patch(g: Grid, count: number): number[] {
  const side = Math.ceil(Math.sqrt(count));
  const x0 = Math.floor((g.width - side) / 2), y0 = Math.floor((g.height - side) / 2);
  const out: number[] = [];
  for (let y = 0; y < side && out.length < count; y++) for (let x = 0; x < side && out.length < count; x++) out.push((y0 + y) * g.width + x0 + x);
  return out;
}

/** Fills a soup: rareCount programs of the rare forms (alternating), the rest common forms (alternating). */
export function seedAssay(job: AssayJob): Soup {
  const num = job.grid ? job.grid.width * job.grid.height : job.num ?? 16384;
  const soup = new Soup({ num, seed: job.seed, mutation: DEFAULT_MUTATION, grid: job.grid });
  const rareCount = job.rareCount ?? (job.grid ? 512 : 2048);
  const rare = job.rareForms.map(unhex), common = job.commonForms.map(unhex);
  const rareIdx = new Set(job.grid ? patch(job.grid, rareCount) : Array.from({ length: rareCount }, (_, i) => i));
  let ri = 0, ci = 0;
  for (let p = 0; p < num; p++) {
    const prog = rareIdx.has(p) ? rare[ri++ % rare.length] : common[ci++ % common.length];
    soup.programs.set(prog, p * TAPE);
  }
  return soup;
}

/** Classifies every program as rare, common or other (pair assays: the strictly nearer type, within its radius; neutral: the marker byte). */
export function classify(programs: Uint8Array, job: AssayJob, rareRef: TypeRef, commonRef: TypeRef): { rare: number; common: number; other: number } {
  const num = programs.length / TAPE;
  let rare = 0, common = 0, other = 0;
  for (let p = 0; p < num; p++) {
    const off = p * TAPE;
    if (job.marker && job.marker2) {
      // Two-marker control: both sides are one type. Rare: its marker present and the other position original; common: the reverse.
      const m = commonRef.distance(programs, off, commonRef.match);
      if (m.d > commonRef.match) { other++; continue; }
      const v1 = programs[off + markerPosition(commonRef, m.form, m.t, job.marker.pos)];
      const v2 = programs[off + markerPosition(commonRef, m.form, m.t, job.marker2.pos)];
      if (v1 === job.marker.value && v2 === job.marker2.original) rare++;
      else if (v2 === job.marker2.value && v1 === job.marker.original) common++;
      else other++;
      continue;
    }
    if (job.marker) {
      // Neutral: both sides are one type; align to the unmarked form and read the marker position.
      const m = commonRef.distance(programs, off, commonRef.match);
      if (m.d > commonRef.match) { other++; continue; }
      const pos = markerPosition(commonRef, m.form, m.t, job.marker.pos);
      const v = programs[off + pos];
      if (v === job.marker.value) rare++; else if (v === job.marker.original) common++; else other++;
      continue;
    }
    const a = rareRef.distance(programs, off, Math.max(rareRef.match, commonRef.match));
    const b = commonRef.distance(programs, off, Math.max(rareRef.match, commonRef.match));
    if (a.d <= rareRef.match && a.d < b.d) rare++;
    else if (b.d <= commonRef.match && b.d < a.d) common++;
    else other++;
  }
  return { rare, common, other };
}

/**
 * Where, in a program aligned to `ref` form `form` under transform t, the
 * byte sits that corresponds to position `pos` of forms[0]. For the mirror
 * form the correspondence goes through the transform that best maps forms[0]
 * onto it.
 */
export function markerPosition(ref: TypeRef, form: number, t: number, pos: number): number {
  let p0 = pos; // position in forms[form]
  if (form !== 0) p0 = ref.mirrorMap()[pos];
  for (let i = 0; i < TAPE; i++) if (src(t, i) === p0) return i;
  return 0;
}

/** Invalid-run rule: a third copier type (not within either side's radius) that outnumbers both sides together. */
export function assayIntruder(programs: Uint8Array, epoch: number, pt: AssayPoint, rareRef: TypeRef, commonRef: TypeRef): AssayResult["intruder"] {
  const end = typeCensus(programs, epoch, { top: 0, testShare: 0.01, maxTests: 100 });
  for (const t of end.types) {
    if (t.count <= pt.rare + pt.common) break;
    const rep = unhex(t.rep);
    if (rareRef.distance(rep, 0, rareRef.match).d <= rareRef.match || commonRef.distance(rep, 0, commonRef.match).d <= commonRef.match) continue;
    if (t.selfRep !== null && t.selfRep >= COPIER) return { id: t.id, count: t.count, selfRep: t.selfRep };
  }
  return null;
}

export function runAssay(job: AssayJob): AssayResult {
  const soup = seedAssay(job);
  const epochs = job.epochs ?? 512, every = job.every ?? 64;
  const rareRef = new TypeRef(job.rareForms.map(unhex));
  const commonRef = new TypeRef(job.commonForms.map(unhex));
  const points: AssayPoint[] = [];
  const measure = () => {
    const c = classify(soup.programs, job, rareRef, commonRef);
    points.push({ epoch: soup.epoch, ...c, f: c.rare + c.common ? c.rare / (c.rare + c.common) : NaN });
  };
  const intruderNow = (pt: AssayPoint) => assayIntruder(soup.programs, soup.epoch, pt, rareRef, commonRef);
  const extra = new Set((job.validAt ?? []).filter((e) => e < epochs));
  const validAt: Record<number, boolean> = {};
  measure();
  while (soup.epoch < epochs) {
    soup.step();
    if (soup.epoch % every === 0 || soup.epoch === epochs) measure();
    if (extra.has(soup.epoch)) {
      if (points.at(-1)!.epoch !== soup.epoch) measure();
      validAt[soup.epoch] = intruderNow(points.at(-1)!) === null;
    }
  }
  const final = points[points.length - 1];
  const intruder = intruderNow(final);
  const { rareForms: _r, commonForms: _c, ...meta } = job;
  return { id: job.id, job: meta, points, final, valid: intruder === null, intruder, ...(extra.size ? { validAt } : {}) };
}

/** The marked form for the neutral control: forms with one data byte changed (mirror form at its corresponding position). */
export function markForms(ref: TypeRef, pos: number, value: number): Uint8Array[] {
  const a = ref.forms[0].slice();
  a[pos] = value;
  if (ref.forms.length < 2) return [a];
  const b = ref.forms[1].slice();
  b[ref.mirrorMap()[pos]] = value;
  return [a, b];
}

/** A non-instruction, non-zero byte different from `orig`, picked deterministically. */
export function markerValue(orig: number): number {
  for (let v = (orig + 97) & 255; ; v = (v + 1) & 255) if (v !== 0 && v !== orig && !IS_CMD[v]) return v;
}

export interface Marker { pos: number; value: number; original: number; carried: number; misread?: number }

/**
 * Candidate marker positions. Scanning data positions from 0 (non-zero and
 * not an instruction in forms[0], with the same byte at the mirror position),
 * those whose marker passes to offspring: in at least 7 of 13 lines of
 * [L* | random] -> offspring half -> [offspring | fresh random] ... over 5
 * generations (as the copy test), the final offspring half is of the type and
 * carries the marker at the aligned position. At most `max` are returned.
 */
export function markerCandidates(ref: TypeRef, max = 8, seed = 1, lang: Lang = "noheads"): Marker[] {
  const f0 = ref.forms[0];
  const out: Marker[] = [];
  for (let pos = 0; pos < TAPE && out.length < max; pos++) {
    const orig = f0[pos];
    if (orig === 0 || IS_CMD[orig]) continue;
    if (ref.forms.length > 1 && ref.forms[1][ref.mirrorMap()[pos]] !== orig) continue;
    const value = markerValue(orig);
    const marked = markForms(ref, pos, value);
    const r = rng(seed * 1000 + pos);
    let carried = 0;
    for (let i = 0; i < 13; i++) {
      const tape = new Uint8Array(2 * TAPE);
      tape.set(marked[0], 0);
      let ok = true;
      for (let g = 0; g < 5 && ok; g++) {
        if (g > 0) tape.copyWithin(0, TAPE, 2 * TAPE);
        tape.set(randomProgram(r), TAPE);
        evaluate(tape, lang);
        const m = ref.distance(tape, TAPE, ref.match);
        ok = m.d <= ref.match && tape[TAPE + markerPosition(ref, m.form, m.t, pos)] === value;
      }
      if (ok) carried++;
    }
    if (carried >= 7) out.push({ pos, value, original: orig, carried });
  }
  return out;
}

/**
 * The neutral marker: among markerCandidates, the one with the fewest misreads
 * (aligned programs whose marker byte is neither value) after a 128-epoch
 * neutral pilot soup (seed 99, marked rare), ties to the lower position. null:
 * no usable control for this type.
 */
export function findMarker(ref: TypeRef, lang: Lang = "noheads", pilot = { num: 4096, rareCount: 512, epochs: 128 }): Marker | null {
  return rankMarkers(ref, lang, pilot)[0] ?? null;
}

/** Every marker candidate with its pilot misreads, fewest first, ties to the lower position (findMarker's order). */
export function rankMarkers(ref: TypeRef, lang: Lang = "noheads", pilot = { num: 4096, rareCount: 512, epochs: 128 }): Marker[] {
  const ranked: Marker[] = [];
  for (const c of markerCandidates(ref, 8, 1, lang)) {
    const job: AssayJob = {
      id: "marker-pilot", kind: "neutral", lineage: "", rare: "*", common: "", seed: 99, ...pilot,
      rareForms: markForms(ref, c.pos, c.value).map(hex), commonForms: ref.forms.map(hex), marker: c,
    };
    const soup = seedAssay(job);
    while (soup.epoch < pilot.epochs) soup.step();
    let misread = 0;
    for (let p = 0; p < soup.num; p++) {
      const m = ref.distance(soup.programs, p * TAPE, ref.match);
      if (m.d > ref.match) continue;
      const v = soup.programs[p * TAPE + markerPosition(ref, m.form, m.t, c.pos)];
      if (v !== c.value && v !== c.original) misread++;
    }
    ranked.push({ ...c, misread });
  }
  return ranked.sort((x, y) => x.misread! - y.misread! || x.pos - y.pos);
}

// ---- pair outcomes and verdicts (doc: Q2) ----

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Rare fraction at the end of a valid assay run, as a share of all programs' classified A + B. */
export const START = 0.125;

export type Outcome = "a" | "b" | "coexist" | "unresolved" | "failed";

/**
 * Pair outcome from the final rare fractions when a is rare and when b is rare
 * (null = invalid run). D = mean(a rare) - mean(b rare); with sigma0 the
 * neutral runs' spread of final f, theta = 2.5 * sigma0 * sqrt(1/na + 1/nb).
 * a beats b if D > theta, b beats a if D < -theta; "coexist" if both rare
 * types gained by more than 2.5 * sigma0 / sqrt(n); "failed" if either
 * direction has fewer than 2 valid runs.
 */
export function pairOutcome(aRare: (number | null)[], bRare: (number | null)[], sigma0: number): { outcome: Outcome; D: number | null; theta: number | null } {
  const va = aRare.filter((f): f is number => f !== null && Number.isFinite(f));
  const vb = bRare.filter((f): f is number => f !== null && Number.isFinite(f));
  if (va.length < 2 || vb.length < 2) return { outcome: "failed", D: null, theta: null };
  const D = mean(va) - mean(vb);
  const theta = 2.5 * sigma0 * Math.sqrt(1 / va.length + 1 / vb.length);
  if (D > theta) return { outcome: "a", D, theta };
  if (D < -theta) return { outcome: "b", D, theta };
  const gain = (xs: number[]) => mean(xs) - START > 2.5 * sigma0 / Math.sqrt(xs.length);
  return { outcome: gain(va) && gain(vb) ? "coexist" : "unresolved", D, theta };
}

/**
 * Rerun pair outcome (docs/soup-evolution-rerun-2026-10-31.md): exact two-sided
 * permutation p for D = mean(a) - mean(b) over all splits of the pooled runs
 * (seeded Monte Carlo with 200,000 splits, p = (hits + 1) / (N + 1), when there
 * are more than 2,000,000 splits). Resolved at p < alpha; coexist when not
 * resolved and every valid run in both directions ends above START; failed
 * when either side has fewer than minValid runs.
 */
export function permPairOutcome(aRare: (number | null)[], bRare: (number | null)[], minValid: number, alpha = 0.01, seed = 1): { outcome: Outcome; D: number | null; p: number | null } {
  const va = aRare.filter((f): f is number => f !== null && Number.isFinite(f));
  const vb = bRare.filter((f): f is number => f !== null && Number.isFinite(f));
  if (va.length < minValid || vb.length < minValid) return { outcome: "failed", D: null, p: null };
  const D = mean(va) - mean(vb);
  const all = [...va, ...vb], n = all.length, k = va.length, total = all.reduce((s, x) => s + x, 0);
  const eps = 1e-12 * Math.max(1, Math.abs(D));
  const dOf = (sumA: number) => sumA / k - (total - sumA) / (n - k);
  let comb = 1;
  for (let i = 0; i < k; i++) comb = comb * (n - i) / (i + 1);
  let p: number;
  if (comb <= 2_000_000) {
    let hits = 0, count = 0;
    const rec = (start: number, left: number, sum: number) => {
      if (left === 0) { count++; if (Math.abs(dOf(sum)) >= Math.abs(D) - eps) hits++; return; }
      for (let i = start; i <= n - left; i++) rec(i + 1, left - 1, sum + all[i]);
    };
    rec(0, k, 0);
    p = hits / count;
  } else {
    const r = rng(seed), idx = all.map((_, i) => i), N = 200_000;
    let hits = 0;
    for (let s = 0; s < N; s++) {
      for (let i = 0; i < k; i++) { const j = i + Math.floor(r() * (n - i)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      let sum = 0;
      for (let i = 0; i < k; i++) sum += all[idx[i]];
      if (Math.abs(dOf(sum)) >= Math.abs(D) - eps) hits++;
    }
    p = (hits + 1) / (N + 1);
  }
  if (p < alpha) return { outcome: D > 0 ? "a" : "b", D, p };
  const gained = (xs: number[]) => xs.every((f) => f > START);
  return { outcome: gained(va) && gained(vb) ? "coexist" : "unresolved", D, p };
}

/**
 * Permutation test for "later beats earlier": the outcome graph is fixed and
 * the temporal order of the k competitors is permuted (all k! orders up to
 * k = 8, else 20,000 seeded random orders). p = share of orders with at least
 * as many later-wins as observed.
 */
export function permutationP(k: number, wins: [number, number][], seed = 1): { laterWins: number; p: number } {
  const count = (pos: number[]) => wins.reduce((n, [w, l]) => n + (pos[w] > pos[l] ? 1 : 0), 0);
  const ident = Array.from({ length: k }, (_, i) => i);
  const observed = count(ident);
  let ge = 0, total = 0;
  if (k <= 8) {
    const perm = ident.slice();
    const rec = (i: number) => {
      if (i === k) { total++; if (count(perm) >= observed) ge++; return; }
      for (let j = i; j < k; j++) { [perm[i], perm[j]] = [perm[j], perm[i]]; rec(i + 1); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    };
    rec(0);
  } else {
    const r = rng(seed);
    for (; total < 20000; total++) {
      const perm = ident.slice();
      for (let i = k - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      if (count(perm) >= observed) ge++;
    }
  }
  return { laterWins: observed, p: ge / total };
}

export type Verdict = "ADAPTIVE" | "ADAPTIVE (weak)" | "REVERSED" | "NO DIRECTION" | "INSUFFICIENT EVIDENCE";
/** Per-lineage verdict (doc: Q2) from resolved (a/b) pairs, failed assays and the permutation p. */
export function lineageVerdict(laterWins: number, resolved: number, pairs: number, failed: number, p: number | null): { verdict: Verdict; q: number | null } {
  const q = resolved ? laterWins / resolved : null;
  if (resolved < 2 || failed * 3 > pairs) return { verdict: "INSUFFICIENT EVIDENCE", q };
  if (resolved >= 5 && q! >= 0.8 && p !== null && p < 0.05) return { verdict: "ADAPTIVE", q };
  if (resolved >= 5 && q! <= 0.2) return { verdict: "REVERSED", q };
  if (resolved <= 4 && laterWins === resolved) return { verdict: "ADAPTIVE (weak)", q };
  return { verdict: "NO DIRECTION", q };
}

/** Intransitive triples among "x beats y" edges. */
export function intransitive(edges: [string, string][]): string[][] {
  const beats = new Set(edges.map(([w, l]) => `${w}>${l}`));
  const nodes = [...new Set(edges.flat())].sort();
  const out: string[][] = [];
  for (const a of nodes) for (const b of nodes) for (const c of nodes) {
    if (a < b && a < c && b !== c && beats.has(`${a}>${b}`) && beats.has(`${b}>${c}`) && beats.has(`${c}>${a}`)) out.push([a, b, c]);
  }
  return out;
}

/**
 * Sustained leader changes (doc: Q1) and the competitors in order of their
 * first sustained lead. A change is counted against the current leader (the
 * type of the last sustained lead, or the first leader), so a flicker
 * A, B, A is not a change. `frozen[k]` is the first snapshot index at which
 * competitor k was the leader at all: its representatives are taken there.
 */
export function leadership(leaders: (string | null)[], max = 12): { changes: number; competitors: string[]; firstLead: number[]; frozen: number[] } {
  const comp: string[] = [], first: number[] = [];
  const add = (l: string, i: number) => { if (!comp.includes(l)) { comp.push(l); first.push(i); } };
  let current: string | null = null, changes = 0;
  for (let i = 0; i < leaders.length; i++) {
    const l = leaders[i];
    if (l === null) continue;
    if (current === null) { current = l; add(l, i); continue; }
    if (l !== current && i + 1 < leaders.length && leaders[i + 1] === l) { current = l; changes++; add(l, i); }
  }
  const frozenOf = (id: string) => leaders.indexOf(id);
  if (comp.length <= max) return { changes, competitors: comp, firstLead: first, frozen: comp.map(frozenOf) };
  // Spacing (n - 1) / (max - 1) > 1 here, so the rounded indices are distinct.
  const idx = Array.from({ length: max }, (_, k) => Math.round(k * (comp.length - 1) / (max - 1)));
  return { changes, competitors: idx.map((i) => comp[i]), firstLead: idx.map((i) => first[i]), frozen: idx.map((i) => frozenOf(comp[i])) };
}

// ---- interaction probe (doc: Q3) ----

/** Labels a 64-byte half: "X" or "Y" when within that type's probe radius and strictly nearer to it, else "?". */
function label(tape: Uint8Array, off: number, x: TypeRef, y: TypeRef | null): string {
  const lim = Math.max(x.probe, y?.probe ?? 0);
  const dx = x.distance(tape, off, lim).d;
  const dy = y ? y.distance(tape, off, lim).d : Infinity;
  if (dx <= x.probe && dx < dy) return "X";
  if (y && dy <= y.probe && dy < dx) return "Y";
  return "?";
}

/** Evaluates [x form i | y form j] once without mutation; returns the half labels and the tape. */
export function meet(x: TypeRef, xi: number, y: TypeRef, yj: number, lang: Lang = "noheads"): { labels: string; tape: Uint8Array } {
  const tape = new Uint8Array(2 * TAPE);
  tape.set(x.forms[xi], 0);
  tape.set(y.forms[yj], TAPE);
  evaluate(tape, lang);
  const other = x === y ? null : y; // a self-pair labels against x alone
  return { labels: label(tape, 0, x, other) + label(tape, TAPE, x, other), tape };
}

/** outcome[x][y]: labels for [x | y], over all form combinations, joined by "/" (e.g. "XX/XY"). */
export interface Probe { ids: string[]; outcome: string[][] }

export function interact(refs: TypeRef[], ids: string[], lang: Lang = "noheads"): Probe {
  const outcome: string[][] = refs.map(() => []);
  for (let x = 0; x < refs.length; x++) for (let y = 0; y < refs.length; y++) {
    const ls: string[] = [];
    for (let i = 0; i < refs[x].forms.length; i++) for (let j = 0; j < refs[y].forms.length; j++) ls.push(meet(refs[x], i, refs[y], j, lang).labels);
    outcome[x][y] = ls.join("/");
  }
  return { ids, outcome };
}

/**
 * Serial propagation: starting from parasite form `pi`, three times in a row
 * [P | fresh host copy] (or [host | P] when hostFirst) ends with both halves
 * labelled P, and the next round uses the offspring half (the one that was
 * the host's).
 */
export function serial(p: TypeRef, pi: number, h: TypeRef, hj: number, hostFirst: boolean, lang: Lang = "noheads"): boolean {
  let cur = p.forms[pi].slice();
  for (let g = 0; g < 3; g++) {
    const tape = new Uint8Array(2 * TAPE);
    if (hostFirst) { tape.set(h.forms[hj], 0); tape.set(cur, TAPE); } else { tape.set(cur, 0); tape.set(h.forms[hj], TAPE); }
    evaluate(tape, lang);
    const l0 = label(tape, 0, p, h), l1 = label(tape, TAPE, p, h);
    if (l0 !== "X" || l1 !== "X") return false;
    cur = tape.slice(hostFirst ? 0 : TAPE, hostFirst ? TAPE : 2 * TAPE);
  }
  return true;
}

export interface Parasite { parasite: string; host: string; order: "parasite first" | "host first" }

/**
 * Parasites: types with share >= 0.5% and copy test <= NON_COPIER (they do not
 * copy themselves onto random partners) that propagate serially for three
 * rounds with a host (copy test >= COPIER), in some form combination and order.
 */
export function parasites(refs: TypeRef[], ids: string[], rows: Map<string, Pick<TypeRow, "share" | "selfRep">>, lang: Lang = "noheads"): Parasite[] {
  const out: Parasite[] = [];
  for (let p = 0; p < ids.length; p++) {
    const rp = rows.get(ids[p]);
    if (!rp || rp.share < 0.005 || rp.selfRep === null || rp.selfRep > NON_COPIER) continue;
    for (let h = 0; h < ids.length; h++) {
      const rh = rows.get(ids[h]);
      if (h === p || !rh || rh.selfRep === null || rh.selfRep < COPIER) continue;
      for (const hostFirst of [false, true]) {
        let found = false;
        for (let i = 0; i < refs[p].forms.length && !found; i++) for (let j = 0; j < refs[h].forms.length && !found; j++) found = serial(refs[p], i, refs[h], j, hostFirst, lang);
        if (found) out.push({ parasite: ids[p], host: ids[h], order: hostFirst ? "host first" : "parasite first" });
      }
    }
  }
  return out;
}

// ---- leader trends (doc: Q4) ----

export interface Trend { instructions: number; selfRep: number; ops: number; fidelity: number; robustness: number }

export function trend(ref: TypeRef, lang: Lang = "noheads", seed = 7): Trend {
  const prog = ref.forms[0];
  const r = rng(seed);
  let ops = 0, faithful = 0;
  for (let i = 0; i < 13; i++) {
    const tape = new Uint8Array(2 * TAPE);
    tape.set(prog, 0);
    tape.set(randomProgram(r), TAPE);
    ops += evaluate(tape, lang);
    if (ref.distance(tape, 0, 2).d <= 2 && ref.distance(tape, TAPE, 2).d <= 2) faithful++;
  }
  let rob = 0;
  for (let k = 0; k < 8; k++) {
    const m = prog.slice();
    const pos = Math.floor(r() * TAPE);
    m[pos] = (m[pos] + 1 + Math.floor(r() * 255)) & 255; // always a different byte
    rob += selfRep(m, lang);
  }
  return { instructions: instructions(prog), selfRep: selfRep(prog, lang), ops: ops / 13, fidelity: faithful / 13, robustness: rob / 8 };
}

/** Spearman rank correlation. */
export function spearman(xs: number[], ys: number[]): number {
  if (xs.some((x) => !Number.isFinite(x)) || ys.some((y) => !Number.isFinite(y))) return NaN;
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const a = rank(xs), b = rank(ys), n = xs.length;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : NaN; // undefined for constant (or NaN) input
}
