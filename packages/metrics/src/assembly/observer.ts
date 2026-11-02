// Evidence assembly. Node-only (node:crypto); not part of the browser barrel. Deterministic payload only: no clock, platform or repo SHA.
import { createHash } from "node:crypto";
import { METRICS_VERSION, RULE_VERSION } from "../../../schema/src/config.ts";
import { FFLATE_VERSION } from "../predictability/losses.ts";
import { ASSEMBLY_VERSION } from "./version.ts";
import { PROTOCOL } from "./protocol.ts";
import { CLASS_IDS, CLASS_NOTES, SEAM_IDS, buildPatch, type ClassId } from "./fixtures.ts";
import { ConstructionService } from "./construct.ts";
import { baselineScalars, cmpRat, DIRECTION, patchReadouts, READOUTS, rat, scalars, type PatchReadouts, type Rat, type ReadoutName } from "./readouts.ts";
import { bestDirection, decideVerdict, isOne, pairAccuracy, verdictSentence } from "./verdict.ts";
import { segment } from "./segment.ts";
import { StreamObserver, type MovieReadouts } from "./stream.ts";
import { lazyFixtures } from "./lazy.ts";
import type { Conn } from "./grammar.ts";

export const sha256 = (v: string | Uint8Array): string => createHash("sha256").update(v).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const STATEMENTS = [
  "CPU only",
  "no GPU evidence",
  "no score selected which worlds or clips were shown; negative-class motifs are selected by construction-length score (best of 256 candidates)",
  "destruction/reconstruction interventions: not done (later rung)",
  "no evolving-world positive case",
  "no life-detection claim is made at any outcome",
] as const;

type Dict<T> = Record<string, T>;
const patchHash = (id: string, rep: number, frame: Uint8Array) => sha256(Buffer.concat([Buffer.from(`${id}|r${rep}|64x64|`), frame]));

export interface ReplicateRow {
  replicate: number; sha256: string;
  meta: { occupied: number; padding: number; objects: number; note: string; motifs: { key: string; a: number; status: string; copies: number; candidate: number }[] };
  primary: PatchReadouts;
  conn8: { objects: number; scalars: Dict<Rat | null> };
  perturbation?: Dict<{ objects: number; classes: number; maxCopies: number }>;
  /** Replicate 0 only: occupied cell indices (y * w + x), so the page can draw the patch without regenerating it. */
  cells?: number[];
}
export interface ClassResult { id: ClassId; role: string; matched: boolean; replicates: ReplicateRow[] }

export interface ReadoutVerdict {
  direction: "lower" | "higher" | null;
  hasNull: boolean;
  dupNegativesOrdered: boolean;
  accuracy: { lower: Rat; higher: Rat };
  negatives: Dict<{ lower: Rat; higher: Rat }>;
  cells: { id: string; separates: boolean }[];
  baselines: Dict<Rat>;
  baselineBest: Rat;
  incrementalValue: Rat | null;
  spacedConn8AgreesWithConn4: boolean;
  verdict: string;
  sentence: string;
}

export interface MovieRow { id: string; matched: false; label: "unmatched"; sha256: string; w: number; h: number; q: number; variants: Dict<Dict<MovieReadouts>> }
export interface ClipRow extends MovieRow { preset: string; segmentationDominated: boolean; swing: Dict<Swing> }

export interface Payload {
  kind: "assembly-observer-evidence";
  versions: { assembly: number; ruleVersion: number; metricsVersion: number };
  statements: readonly string[];
  protocol: typeof PROTOCOL;
  compression: { library: string; version: string };
  replicates: number;
  calibration: ClassResult[];
  verdicts: Dict<ReadoutVerdict>;
  descriptivePairs: Dict<Dict<{ lower: Rat; higher: Rat } | null>>;
  fixtures: MovieRow[];
  clips: ClipRow[];
  solverNodes: number;
  notDone: readonly string[];
  integritySha256?: string;
}

export const NOT_DONE = [
  "destruction/reconstruction interventions (a later rung)",
  "any evolving-world positive case",
  "exact construction length beyond 10 cells (larger objects are upper bounds)",
] as const;

const scalarsDict = (r: PatchReadouts): Dict<Rat | null> => ({ ...scalars(r) });

function perturb(frame: Uint8Array, w: number, h: number, mode: "dilate" | "erode"): Uint8Array {
  const out = new Uint8Array(frame.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = (dx: number, dy: number) => frame[((y + dy + h) % h) * w + ((x + dx + w) % w)];
    if (mode === "dilate") {
      let any = frame[y * w + x] ? 1 : 0;
      for (let dy = -1; dy <= 1 && !any; dy++) for (let dx = -1; dx <= 1; dx++) if (at(dx, dy)) { any = 1; break; }
      out[y * w + x] = any;
    } else out[y * w + x] = frame[y * w + x] && at(0, -1) && at(-1, 0) && at(1, 0) && at(0, 1) ? 1 : 0;
  }
  return out;
}

const occupiedCells = (frame: Uint8Array): number[] => { const out: number[] = []; for (let c = 0; c < frame.length; c++) if (frame[c]) out.push(c); return out; };

function lightTally(frame: Uint8Array, w: number, h: number) {
  const objs = segment(frame, w, h, { conn: 4, tau: 1 }).filter((o) => !o.spans);
  const counts = new Map<string, number>();
  for (const o of objs) { const k = o.cells.join(","); counts.set(k, (counts.get(k) ?? 0) + 1); }
  return { objects: objs.length, classes: counts.size, maxCopies: Math.max(0, ...counts.values()) };
}

export interface BuildOptions { replicates?: number; classes?: readonly ClassId[]; skipMovies?: boolean; log?: (s: string) => void }

export function calibrate(svc: ConstructionService, opt: BuildOptions = {}): ClassResult[] {
  const reps = opt.replicates ?? PROTOCOL.replicates;
  const ids = opt.classes ?? [...CLASS_IDS, ...SEAM_IDS];
  const out: ClassResult[] = [];
  for (const id of ids) {
    const rows: ReplicateRow[] = [];
    for (let r = 0; r < reps; r++) {
      const p = buildPatch(id, r);
      const primary = patchReadouts(p.frame, p.w, p.h, { conn: 4, tau: PROTOCOL.tau }, svc);
      const c8 = patchReadouts(p.frame, p.w, p.h, { conn: 8, tau: PROTOCOL.tau }, svc);
      const row: ReplicateRow = {
        replicate: r, sha256: patchHash(id, r, p.frame),
        meta: { occupied: p.meta.occupied, padding: p.meta.padding, objects: p.meta.objects, note: p.meta.note, motifs: p.meta.motifs },
        primary, conn8: { objects: c8.objects, scalars: scalarsDict(c8) },
      };
      if (r === 0) row.cells = occupiedCells(p.frame);
      if (r === 0) row.perturbation = { identity: lightTally(p.frame, p.w, p.h), dilate: lightTally(perturb(p.frame, p.w, p.h, "dilate"), p.w, p.h), erode: lightTally(perturb(p.frame, p.w, p.h, "erode"), p.w, p.h) };
      rows.push(row);
    }
    out.push({ id, role: CLASS_NOTES[id].role, matched: CLASS_NOTES[id].matched, replicates: rows });
    opt.log?.(`calibrated ${id}`);
  }
  return out;
}

/** Readouts whose value for the 12-cell negatives is the beam bound, and whose negatives were picked by that same bound. */
const BOUND_SELECTED = new Set<ReadoutName>(["sharedBound", "reuseRatio"]);
const BOUND_CAVEAT = "; caveat: the 12-cell negative motifs are picked by the beam bound, which favours shapes the beam handles worst (beam 10 to 11 against exact 6 to 7, amendment 1), so the ordering survives exact values but the size of the gap does not";

const byId = (cls: readonly ClassResult[], id: ClassId) => cls.find((c) => c.id === id);
const values = (c: ClassResult, name: ReadoutName, which: "primary" | "conn8"): (Rat | null)[] =>
  c.replicates.map((r) => (which === "primary" ? scalars(r.primary)[name] : r.conn8.scalars[name]));

/** Every class the verdict rule reads. */
export const REQUIRED_CLASSES = ["hier-12", "random-dup", "random-dup-hi", "random-dup-12", "seam-hier-12", "seam-dup-12"] as const;

/** Paths of every {num, den} in a value whose denominator is not a positive integer or whose numerator is not a non-negative integer. */
function badRationals(v: unknown, path: string, out: string[]): void {
  if (Array.isArray(v)) v.forEach((x, i) => badRationals(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("num" in o && "den" in o) {
      if (!Number.isInteger(o.num) || !Number.isInteger(o.den) || (o.den as number) <= 0 || (o.num as number) < 0) out.push(`${path} is not a valid rational (${JSON.stringify(o)})`);
    } else for (const [k, x] of Object.entries(o)) badRationals(x, `${path}.${k}`, out);
  }
}

/** Structure the verdict rule relies on: every required class once, each with exactly `replicates` rows numbered 0..replicates-1. */
export function validateCalibration(cls: readonly ClassResult[], replicates: number = PROTOCOL.replicates): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(replicates) || replicates < 1) return [`replicate count ${replicates} is not a positive integer`];
  const seen = new Set<string>();
  for (const c of cls) {
    if (seen.has(c.id)) problems.push(`class ${c.id} appears twice`);
    seen.add(c.id);
    if (c.replicates.length !== replicates) problems.push(`class ${c.id} has ${c.replicates.length} replicates, expected ${replicates}`);
    else if (c.replicates.some((r, i) => r.replicate !== i)) problems.push(`class ${c.id} replicates are not numbered 0..${replicates - 1}`);
  }
  for (const id of REQUIRED_CLASSES) if (!seen.has(id)) problems.push(`required class ${id} is missing`);
  for (const c of cls) for (const r of c.replicates) {
    badRationals(r.primary, `${c.id}[${r.replicate}].primary`, problems);
    badRationals(r.conn8, `${c.id}[${r.replicate}].conn8`, problems);
  }
  return problems;
}

/** Verdicts per readout from the stored rows (also what --check re-derives). Throws on a structurally invalid set. */
export function deriveVerdicts(cls: readonly ClassResult[], replicates: number = PROTOCOL.replicates): { verdicts: Dict<ReadoutVerdict>; descriptive: Dict<Dict<{ lower: Rat; higher: Rat } | null>> } {
  const bad = validateCalibration(cls, replicates);
  if (bad.length) throw new Error(`invalid calibration set: ${bad.join("; ")}`);
  const hier = byId(cls, "hier-12")!, dup12 = byId(cls, "random-dup-12")!;
  const seamH = byId(cls, "seam-hier-12"), seamD = byId(cls, "seam-dup-12");
  const negs: ClassId[] = ["random-dup", "random-dup-hi", "random-dup-12"];
  const verdicts: Dict<ReadoutVerdict> = {};
  const descriptive: Dict<Dict<{ lower: Rat; higher: Rat } | null>> = {};
  const clean = (xs: (Rat | null)[]): Rat[] | null => (xs.some((x) => x === null) ? null : (xs as Rat[]));
  for (const name of READOUTS) {
    const dir = DIRECTION[name];
    const pos = clean(values(hier, name, "primary")), neg = clean(values(dup12, name, "primary"));
    let hasNull = pos === null || neg === null;
    const acc = pos && neg ? { lower: pairAccuracy(pos, neg, "lower"), higher: pairAccuracy(pos, neg, "higher") } : { lower: rat(0, 1), higher: rat(0, 1) };
    const negatives: Dict<{ lower: Rat; higher: Rat }> = {};
    let negOk = true;
    for (const n of negs) {
      const c = byId(cls, n);
      const v = c ? clean(values(c, name, "primary")) : null;
      if (!v || !pos) { hasNull = true; continue; }
      negatives[n] = { lower: pairAccuracy(pos, v, "lower"), higher: pairAccuracy(pos, v, "higher") };
      if (dir && !isOne(negatives[n][dir])) negOk = false;
    }
    const cells: { id: string; separates: boolean }[] = [];
    const sep = (a: Rat | undefined) => (dir && a ? isOne(a) : false);
    cells.push({ id: "spaced-4", separates: sep(dir ? acc[dir] : undefined) });
    const pos8 = clean(values(hier, name, "conn8")), neg8 = clean(values(dup12, name, "conn8"));
    if (!pos8 || !neg8) hasNull = true;
    cells.push({ id: "spaced-8", separates: pos8 && neg8 && dir ? isOne(pairAccuracy(pos8, neg8, dir)) : false });
    if (seamH && seamD) {
      for (const which of ["primary", "conn8"] as const) {
        const a = clean(values(seamH, name, which)), b = clean(values(seamD, name, which));
        if (!a || !b) hasNull = true;
        cells.push({ id: which === "primary" ? "seam-4" : "seam-8", separates: a && b && dir ? isOne(pairAccuracy(a, b, dir)) : false });
      }
    }
    // baselines on the primary matched pair, both directions
    const baselines: Dict<Rat> = {};
    for (const key of Object.keys(baselineScalars(hier.replicates[0].primary))) {
      const p = hier.replicates.map((r) => baselineScalars(r.primary)[key]), q = dup12.replicates.map((r) => baselineScalars(r.primary)[key]);
      baselines[key] = p.some((x) => x === null) || q.some((x) => x === null) ? rat(0, 1) : bestDirection(p as Rat[], q as Rat[]);
    }
    const baselineBest = Object.values(baselines).reduce((m, x) => (cmpRat(x, m) > 0 ? x : m), rat(0, 1));
    const d = decideVerdict({ direction: dir, hasNull, dupNegativesOrdered: negOk, cells, baselineBest });
    const spacedAgree = hier.replicates.every((r) => r.conn8.objects === r.primary.objects) && dup12.replicates.every((r) => r.conn8.objects === r.primary.objects);
    verdicts[name] = {
      direction: dir, hasNull, dupNegativesOrdered: negOk, accuracy: acc, negatives, cells: d.cells, baselines, baselineBest,
      incrementalValue: dir && pos && neg ? rat(acc[dir].num - baselineBest.num * (acc[dir].den / baselineBest.den), acc[dir].den) : null,
      spacedConn8AgreesWithConn4: spacedAgree, verdict: d.verdict, sentence: verdictSentence(d.verdict) + (BOUND_SELECTED.has(name) && d.verdict.startsWith("separates") ? BOUND_CAVEAT : ""),
    };
  }
  // descriptive pairs: positives against negatives, declared direction (or both when not directional)
  const pairs: [ClassId, ClassId][] = [["hier-12", "random-field"], ["hier-12", "random-scatter"], ["hierarchy", "random-dup"], ["hierarchy", "random-dup-hi"], ["hierarchy", "random-dup-12"], ["hierarchy-mixed", "random-field"], ["tile-repeat", "random-field"], ["crystal-spaced", "random-field"]];
  for (const [a, b] of pairs) {
    const ca = byId(cls, a), cb = byId(cls, b);
    if (!ca || !cb) continue;
    descriptive[`${a} vs ${b}`] = {};
    for (const name of READOUTS) {
      const p = clean(values(ca, name, "primary")), q = clean(values(cb, name, "primary"));
      descriptive[`${a} vs ${b}`][name] = p && q ? { lower: pairAccuracy(p, q, "lower"), higher: pairAccuracy(p, q, "higher") } : null;
    }
  }
  return { verdicts, descriptive };
}

// ---- movies ----------------------------------------------------------------------------------------------------

const GRID_VARIANTS = (taus: readonly number[]) => PROTOCOL.connGrid.flatMap((conn) => taus.map((tau) => ({ conn: conn as Conn, tau })));
const variantKey = (v: { conn: number; tau: number }) => `conn${v.conn}-tau${v.tau}`;

/** One pass over a lazy frame source feeds every variant x stride observer; only one frame is live at a time. */
export function observeVariants(frames: Iterable<Uint8Array>, w: number, h: number, variants: { conn: Conn; tau: number }[], svc: ConstructionService, onFrame?: (f: Uint8Array) => void): Dict<Dict<MovieReadouts>> {
  const lags = PROTOCOL.persistenceLags;
  const obs = variants.map((v) => PROTOCOL.strides.map((s) => ({ s, o: new StreamObserver(w, h, v, lags) })));
  let k = 0;
  for (const f of frames) {
    onFrame?.(f);
    obs.forEach((row) => row.forEach(({ s, o }) => { if (k % s === 0) o.push(f); }));
    k++;
  }
  return Object.fromEntries(variants.map((v, i) => [variantKey(v), Object.fromEntries(obs[i].map(({ s, o }) => [String(s), o.finish(svc)]))]));
}

export interface Swing { min: string; max: string; factor2: boolean; /** factor-2 swing between 4- and 8-connectivity at one fixed tau */ connAtFixedTau: boolean; /** factor-2 swing across tau at one fixed connectivity */ tauAtFixedConn: boolean }

const factorTwo = (lo: Rat, hi: Rat): boolean => hi.num > 0 && (lo.num === 0 || hi.num * lo.den >= PROTOCOL.segmentationFactor * lo.num * hi.den);

const swingOf = (grid: Dict<Dict<MovieReadouts>>) => {
  const metrics: Dict<(m: MovieReadouts) => Rat | null> = {
    objectsPerFrame: (m) => m.objectsPerFrame,
    largeOrSpansCellShare: (m) => (m.largeCellShare && m.spansCellShare ? rat(m.largeCellShare.num * m.spansCellShare.den + m.spansCellShare.num * m.largeCellShare.den, m.largeCellShare.den * m.spansCellShare.den) : null),
    classesT: (m) => rat(m.classesT, 1),
  };
  const out: Dict<Swing> = {};
  const spread = (xs: readonly Rat[]): boolean => {
    if (xs.length < 2) return false;
    let lo = xs[0], hi = xs[0];
    for (const x of xs) { if (cmpRat(x, lo) < 0) lo = x; if (cmpRat(x, hi) > 0) hi = x; }
    return factorTwo(lo, hi);
  };
  for (const [name, f] of Object.entries(metrics)) {
    const vals = Object.entries(grid).map(([k, v]) => [k, f(v["1"])] as const).filter((x): x is [string, Rat] => x[1] !== null);
    if (!vals.length) continue;
    let lo = vals[0], hi = vals[0];
    for (const x of vals) { if (cmpRat(x[1], lo[1]) < 0) lo = x; if (cmpRat(x[1], hi[1]) > 0) hi = x; }
    const at = (conn: number, tau: number) => vals.find(([k]) => k === `conn${conn}-tau${tau}`)?.[1];
    const connAtFixedTau = PROTOCOL.tauGrid.some((tau) => spread([at(4, tau), at(8, tau)].filter((x): x is Rat => !!x)));
    const tauAtFixedConn = PROTOCOL.connGrid.some((conn) => spread(PROTOCOL.tauGrid.map((tau) => at(conn, tau)).filter((x): x is Rat => !!x)));
    out[name] = { min: lo[0], max: hi[0], factor2: factorTwo(lo[1], hi[1]), connAtFixedTau, tauAtFixedConn };
  }
  return out;
};

export async function movies(svc: ConstructionService, opt: BuildOptions, clipSource: (preset: string) => { frames: Iterable<Uint8Array>; side: number }): Promise<{ fixtures: MovieRow[]; clips: ClipRow[] }> {
  const fixtures: MovieRow[] = [];
  for (const m of lazyFixtures()) {
    // lazy frames and an incremental hash: no movie is ever materialised (header and bytes equal I14 movieBytes)
    const hash = createHash("sha256");
    hash.update(`${m.id}|${m.w}x${m.h}|q${m.q}|T${m.frameCount}|`);
    const variants = observeVariants(m.frames(), m.w, m.h, GRID_VARIANTS([1]), svc, (f) => hash.update(f));
    fixtures.push({ id: m.id, matched: false, label: "unmatched", sha256: hash.digest("hex"), w: m.w, h: m.h, q: m.q, variants });
    opt.log?.(`fixture ${m.id}`);
  }
  const clips: ClipRow[] = [];
  for (const preset of PROTOCOL.clips.presets) {
    const { frames, side } = clipSource(preset);
    const hash = createHash("sha256");
    const id = `clip-${preset}`;
    hash.update(`${id}|${side}x${side}|q16|T${PROTOCOL.clips.frames}|`);
    const grid = observeVariants(frames, side, side, GRID_VARIANTS(PROTOCOL.tauGrid), svc, (f) => hash.update(f));
    const swing = swingOf(grid);
    clips.push({ id, preset, matched: false, label: "unmatched", sha256: hash.digest("hex"), w: side, h: side, q: 16, variants: grid, swing, segmentationDominated: Object.values(swing).some((s) => s.factor2) });
    opt.log?.(`clip ${preset}`);
  }
  return { fixtures, clips };
}

export function sealPayload(p: Payload): Payload {
  const body = { ...p };
  delete body.integritySha256;
  return { ...p, integritySha256: sha256(canonical(body)) };
}
export function verifySeal(p: Payload): boolean {
  const body = { ...p };
  delete body.integritySha256;
  return p.integritySha256 === sha256(canonical(body));
}

export async function buildPayload(clipSource: (preset: string) => { frames: Iterable<Uint8Array>; side: number }, opt: BuildOptions = {}): Promise<Payload> {
  const svc = new ConstructionService();
  const calibration = calibrate(svc, opt);
  const { verdicts, descriptive } = deriveVerdicts(calibration, opt.replicates ?? PROTOCOL.replicates);
  const { fixtures, clips } = opt.skipMovies ? { fixtures: [], clips: [] } : await movies(svc, opt, clipSource);
  return sealPayload({
    kind: "assembly-observer-evidence",
    versions: { assembly: ASSEMBLY_VERSION, ruleVersion: RULE_VERSION, metricsVersion: METRICS_VERSION },
    statements: STATEMENTS,
    protocol: PROTOCOL,
    compression: { library: "fflate", version: FFLATE_VERSION },
    replicates: opt.replicates ?? PROTOCOL.replicates,
    calibration, verdicts, descriptivePairs: descriptive, fixtures, clips,
    solverNodes: svc.nodes,
    notDone: NOT_DONE,
  });
}
