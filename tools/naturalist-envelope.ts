// Builds the naturalist's published baselines for the lab's Field notes panel (docs/naturalist-field-notes-v0-2026-10-18.md,
// "Parity"): per preset, the median and spread the anomaly bell's departure() gives over all of its envelope's neutral runs at
// every census to step 300,000, as a header (.json) and a body of doubles (.bin) under apps/lab/public/naturalist/. CPU only,
// streaming, read-only on the bundles, no model calls; the same inputs give the same bytes.
//
//   deno run -A tools/naturalist-envelope.ts --base <runs root> [--out apps/lab/public/naturalist] [--only gradient-m3|spots-m3]
//                                            [--no-verify] [--fixture <file>]
//
//   --base       the root holding the bell corpus (replay-calib, replay-m4) and the v1 fresh runs (bell-v1-null), e.g. <main checkout>/runs.
//                Only read.
//   --out        where the assets go (default apps/lab/public/naturalist). Nothing is written until every preset built has verified.
//   --only       build one preset.
//   --no-verify  skip the checks against the records (default: on). Then only the envelope runs are read.
//   --fixture    also write the lab test's excerpt of replay-m4/gradient-m3/treatment/seed-1 (censuses 1 to 160: the series fields
//                and each census's lineage rows as a count, a cell total and a SHA-256), and nothing else unless --out is given too.
//                Never a path under --base, nor a baseline file's name in --out; written last, after every asset asked for has built
//                and verified. --out and --fixture are refused with any ".." in them.
//
// Refuses (STOP, nothing written) unless: every run's manifest is the record's run (spec, a summary, cadence 100, enough steps),
// its presetIdentity is the record corpus's and the current code's, its cfg.neutral is its condition, its ruleVersion is the
// current RULE_VERSION; every census is at the cadence, passes v1's census check (tools/lib/bell1.ts censusProblem, held equal to
// the lab's copy on every census) and has finite signal cells. Verification, for gradient-m3: the 10 treatment and 70 fresh runs
// scored against the published baseline by the lab's scorer, and each of the 40 envelope runs against the other 39 (built the
// same way), give bell-v1-null.json's D11, ring and first ring exactly. For spots-m3: each of the 30 runs against the other 29 over
// all 1,000,000 steps gives bell-v0.json's D at W = 50 and its rings at Z = 4 exactly, and Z* recomputed from the 20 replay-calib
// runs is the record's.
import { PRESETS, RULE_VERSION, presetIdentity } from "@bl/schema";
import { lineageCensuses } from "./lib/bundle.ts";
import { SignalExtractor, mergeCensuses, parseSeries, splitLines, SIGNALS, type CorpusRun, type Receipt } from "./lib/bell.ts";
import { censusProblem as bell1CensusProblem, checkExactManifest, checkV0Manifest, freshRuns, v0Runs } from "./lib/bell1.ts";
import { LiveBell, censusProblem, decodeEnvelope, encodeEnvelope, envelopeAt, pick, seriesCellProblem } from "../apps/lab/src/naturalist-score.ts";
import { SERIES_FIELDS } from "../apps/lab/src/naturalist-series.ts";
import {
  CADENCE,
  HORIZON,
  RECORDS,
  baselineSpecs,
  buildHeader,
  gradientNumbers,
  headerText,
  parseV0Spots,
  parseV1Null,
  receiptKey,
  spotsNumbers,
  type BaselineSpec,
} from "./lib/naturalist-envelope.ts";

// ---------------------------------------------------------------------------------------------
// Arguments (by hand: no jsr resolution, so the lockfile is untouched).

const args = [...Deno.args];
const opt: { base?: string; out?: string; only?: string; verify: boolean; fixture?: string } = { verify: true };
while (args.length) {
  const a = args.shift()!;
  const val = () => {
    const v = args.shift();
    if (v === undefined || v === "" || v.startsWith("--")) throw new Error(`${a} needs a value`);
    return v;
  };
  if (a === "--base") opt.base = val().replace(/\/+$/, "");
  else if (a === "--out") opt.out = val().replace(/\/+$/, "");
  else if (a === "--only") opt.only = val();
  else if (a === "--fixture") opt.fixture = val();
  else if (a === "--no-verify") opt.verify = false;
  else throw new Error(`unknown argument ${a}`);
}
if (!opt.base) throw new Error("--base <runs root> is needed");
if (opt.only && opt.only !== "gradient-m3" && opt.only !== "spots-m3") throw new Error(`--only takes gradient-m3 or spots-m3, not ${opt.only}`);
const base = opt.base;
const writeAssets = opt.out !== undefined || opt.fixture === undefined;
const outDir = opt.out ?? "apps/lab/public/naturalist";
// No destination that resolves under --base is accepted (the bundles are read-only): not the assets, and not the fixture. Each destination's
// directory is resolved (through its nearest existing ancestor, before anything is created) and checked; files are then written
// to a fresh temporary file in that directory and renamed over the destination, which replaces the directory entry and never
// writes through an existing inode, so a symlink (even a dangling one) or a hardlink at the destination cannot reach the bundles.
const realBase = await Deno.realPath(base);
const inBase = (p: string) => p === realBase || p.startsWith(realBase + "/");
const parentOf = (p: string) => {
  const slash = p.replace(/\/+$/, "").lastIndexOf("/");
  return slash < 0 ? "." : p.slice(0, slash) || "/";
};
/** The real path of `p`'s nearest existing ancestor (or of `p` itself), resolved before anything is created. */
async function nearestReal(p: string): Promise<string> {
  for (let q = p; ; q = parentOf(q)) {
    const r = await Deno.realPath(q).catch(() => null);
    if (r !== null) return r;
    if (q === "." || q === "/") throw new Error(`STOP: cannot resolve ${p}`);
  }
}
// A `..` after a directory that does not exist yet would let the recursive mkdir below create directories the containment check
// never saw (`/work/missing/../runs/new`), so destinations are refused with any `..` in them.
const hasDotDot = (p: string) => p.split("/").includes("..");
if (writeAssets && hasDotDot(outDir)) throw new Error(`STOP: --out ${outDir}: give the path without ".."`);
if (opt.fixture !== undefined && hasDotDot(opt.fixture)) throw new Error(`STOP: --fixture ${opt.fixture}: give the path without ".."`);
if (writeAssets) {
  if (inBase(await nearestReal(outDir))) throw new Error(`STOP: --out ${outDir} is inside --base ${base}; the bundles are read-only`);
  await Deno.mkdir(outDir, { recursive: true });
  if (inBase(await Deno.realPath(outDir))) throw new Error(`STOP: --out ${outDir} is inside --base ${base}; the bundles are read-only`);
}
let fixtureDir: string | null = null;
if (opt.fixture !== undefined) {
  const f = opt.fixture;
  const dir = parentOf(f);
  fixtureDir = await Deno.realPath(dir).catch(() => {
    throw new Error(`STOP: --fixture ${f}: its directory ${dir} does not exist`);
  });
  const realFile = await Deno.realPath(f).catch(() => null);
  if (inBase(fixtureDir) || (realFile !== null && inBase(realFile))) throw new Error(`STOP: --fixture ${f} is inside --base ${base}; the bundles are read-only`);
}
/** Writes `bytes` as `name` in the checked real directory `dir`: a fresh temporary file, synced, then renamed over the name. */
async function publish(dir: string, name: string, bytes: Uint8Array): Promise<void> {
  if (inBase(dir)) throw new Error(`STOP: ${dir} is inside --base ${base}; the bundles are read-only`);
  // The directory was checked before the build; it must still be that directory now (not swapped for a link meanwhile).
  if ((await Deno.realPath(dir)) !== dir) throw new Error(`STOP: ${dir} changed while the baselines were built`);
  const tmp = `${dir}/.${name}.tmp-${Deno.pid}`;
  try {
    const file = await Deno.open(tmp, { write: true, createNew: true });
    try {
      let off = 0;
      while (off < bytes.byteLength) off += await file.write(bytes.subarray(off));
      await file.sync();
    } finally {
      file.close();
    }
    await Deno.rename(tmp, `${dir}/${name}`);
  } catch (e) {
    await Deno.remove(tmp).catch(() => {});
    throw e;
  }
}

const log = (m: string) => console.error(m);
const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");
const enc = new TextEncoder();
const stop = (m: string): never => {
  throw new Error(`STOP: ${m}`);
};

// ---------------------------------------------------------------------------------------------
// Bundles.

function seriesRecords(id: string, dir: string) {
  return (async function* () {
    const file = await Deno.open(`${dir}/series.jsonl`);
    yield* parseSeries(id, splitLines(file.readable.pipeThrough(new TextDecoderStream())));
  })();
}
const merged = (id: string, dir: string) => mergeCensuses(id, seriesRecords(id, dir), lineageCensuses(dir));

interface Opened {
  run: CorpusRun;
  it: AsyncGenerator<{ rec: Record<string, unknown> & { step: number }; rows: [string, number][] }>;
  ext: SignalExtractor;
}
const expectedIdentity = (preset: string) => presetIdentity(PRESETS.find((p) => p.id === preset)!);

/** Opens a run after checking its manifest: the record's run, its identity, its neutral flag and its rule version. */
async function open(run: CorpusRun, recordIdentity: string, check: (text: string) => { spec: { steps: number } }, steps: (s: number) => void): Promise<Opened> {
  const dir = `${base}/${run.rel}`;
  const text = await Deno.readTextFile(`${dir}/manifest.json`).catch(() => stop(`${run.id}: no manifest.json under ${base}`));
  const m = check(text);
  steps(m.spec.steps);
  const full = JSON.parse(text) as { presetIdentity: string; ruleVersion: number; cfg: { neutral: boolean } };
  if (full.presetIdentity !== recordIdentity) stop(`${run.id}: presetIdentity ${full.presetIdentity}, the record's corpus has ${recordIdentity}`);
  if (full.presetIdentity !== expectedIdentity(run.preset)) stop(`${run.id}: presetIdentity ${full.presetIdentity}, the current code's ${run.preset} is ${expectedIdentity(run.preset)}`);
  if (full.cfg?.neutral !== (run.condition === "neutral")) stop(`${run.id}: condition ${run.condition} but cfg.neutral ${full.cfg?.neutral}`);
  if (full.ruleVersion !== RULE_VERSION) stop(`${run.id}: ruleVersion ${full.ruleVersion}, the current code's is ${RULE_VERSION}; a baseline is built only under the rules the lab runs`);
  return { run, it: merged(run.id, dir), ext: new SignalExtractor() };
}

/** The next census of every run, checked: at step (i + 1) * cadence, v1's census check (both copies agreeing), finite cells. Returns SignalExtractor vectors. */
async function nextCensus(runs: Opened[], i: number): Promise<(number | null)[][]> {
  const want = (i + 1) * CADENCE;
  const got = await Promise.all(runs.map((r) => r.it.next()));
  return got.map((n, k) => {
    const id = runs[k].run.id;
    if (n.done) return stop(`${id}: ${i} censuses, expected more`);
    const { rec, rows } = n.value;
    if (rec.step !== want) stop(`${id}: census ${i + 1} is at step ${rec.step}, expected ${want}`);
    const a = bell1CensusProblem(rec, rows), b = censusProblem(rec, rows);
    if (a !== b) stop(`${id}: the lab's census check says ${JSON.stringify(b)}, bell1's ${JSON.stringify(a)}`);
    if (a) stop(`${id}: ${a}`);
    const cell = seriesCellProblem(rec);
    if (cell) stop(`${id}: step ${rec.step} has ${cell.field} ${JSON.stringify(cell.value)}, not a finite number`);
    return runs[k].ext.push(rec, rows);
  });
}
const closeAll = (runs: Opened[]) => Promise.all(runs.map((r) => r.it.return(undefined)));

const floorsOf = (names: readonly string[]) => names.map((n) => SIGNALS.find((d) => d.name === n)!.floor);
const without = <T,>(xs: readonly T[], k: number) => xs.filter((_, i) => i !== k);

// ---------------------------------------------------------------------------------------------
// Records.

const recordText = async (path: string) => {
  const bytes = await Deno.readFile(path);
  return { path, text: new TextDecoder().decode(bytes), sha256: await sha256(bytes) };
};
const records = Object.fromEntries(await Promise.all(Object.entries(RECORDS).map(async ([k, p]) => [k, await recordText(p)]))) as Record<keyof typeof RECORDS, { path: string; text: string; sha256: string }>;
const v1 = parseV1Null(records.v1Null.text);
const v0 = parseV0Spots(records.v0.text);
const specs = baselineSpecs(v0.zStar).filter((s) => !opt.only || s.preset === opt.only);
const recordsFor = (spec: BaselineSpec) => spec.records.map((p) => {
  const r = Object.values(records).find((x) => x.path === p)!;
  return { path: r.path, sha256: r.sha256 };
});

// ---------------------------------------------------------------------------------------------
// gradient-m3: the v1 rule.

async function buildGradient(spec: BaselineSpec): Promise<Float64Array> {
  const names = spec.signals, floors = floorsOf(names), S = names.length, N = HORIZON / CADENCE;
  const { envelope, treatment } = v0Runs();
  if (envelope.map((r) => r.id).join() !== spec.envelope.join()) stop("the v1 envelope is not the bell corpus's gradient-m3 neutral runs");
  const atLeast = (r: CorpusRun) => (s: number) => s >= HORIZON || stop(`${r.id}: ${s} steps`);
  const runs: Opened[] = [];
  for (const r of envelope) runs.push(await open(r, v1.presetIdentity, (t) => checkV0Manifest(r, t), atLeast(r)));
  if (opt.verify) {
    for (const r of treatment) runs.push(await open(r, v1.presetIdentity, (t) => checkV0Manifest(r, t), atLeast(r)));
    for (const r of freshRuns()) runs.push(await open(r, v1.presetIdentity, (t) => checkExactManifest(r, t, HORIZON), () => {}));
  }
  const M = envelope.length;
  const bells = runs.map(() => new LiveBell(names, spec.threshold, 50));
  const data = new Float64Array(N * S * 2);
  try {
    for (let i = 0; i < N; i++) {
      const vecs = (await nextCensus(runs, i)).map((v) => pick(names, v));
      const env = envelopeAt(vecs.slice(0, M), floors);
      for (let s = 0; s < S; s++) {
        data[(i * S + s) * 2] = env.median[s];
        data[(i * S + s) * 2 + 1] = env.spread[s];
      }
      if (opt.verify) {
        const step = (i + 1) * CADENCE;
        for (let r = 0; r < runs.length; r++) {
          const e = r < M ? envelopeAt(without(vecs.slice(0, M), r), floors) : env;
          bells[r].push(step, vecs[r], e.median, e.spread);
        }
      }
      if ((i + 1) % 500 === 0) log(`gradient-m3: ${i + 1} of ${N} censuses`);
    }
  } finally {
    await closeAll(runs);
  }
  if (opt.verify) {
    for (let r = 0; r < runs.length; r++) {
      const id = runs[r].run.id;
      const e = v1.runs.find((x) => x.id === id) ?? stop(`${id}: no entry in bell-v1-null.json`);
      const b = bells[r];
      if (!Object.is(b.D(), e.D11)) stop(`${id}: the lab's scorer gives D11 ${b.D()}, bell-v1-null.json says ${e.D11}`);
      if (b.D() >= 4 !== e.ring11) stop(`${id}: ring ${b.D() >= 4}, the record says ${e.ring11}`);
      const first: Receipt | null = b.receipts()[0] ?? null;
      const a = first ? receiptKey(first) : "none", w = e.firstRing11 ? receiptKey(e.firstRing11) : "none";
      if (a !== w) stop(`${id}: first ring ${a}, bell-v1-null.json says ${w}`);
    }
    log(`gradient-m3: ${runs.length} runs verified against bell-v1-null.json (40 leave-one-out, ${runs.length - M} against the published baseline)`);
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// spots-m3: v0's calibrated bell.

async function buildSpots(spec: BaselineSpec): Promise<Float64Array> {
  const names = spec.signals, floors = floorsOf(names), S = names.length, N = HORIZON / CADENCE;
  const { spots } = v0Runs();
  if (spots.map((r) => r.id).join() !== spec.envelope.join()) stop("the spots envelope is not the bell corpus's spots-m3 neutral runs");
  let steps = -1;
  const runs: Opened[] = [];
  for (const r of spots)
    runs.push(await open(r, v0.presetIdentity, (t) => checkV0Manifest(r, t), (s) => {
      if (steps >= 0 && s !== steps) stop(`${r.id}: ${s} steps, the others ${steps}`);
      steps = s;
    }));
  const total = opt.verify ? steps / CADENCE : N;
  const strict = runs.map(() => new LiveBell(names, spec.threshold, 50));
  const at4 = runs.map(() => new LiveBell(names, { Z: 4, strict: false }, 50));
  const data = new Float64Array(N * S * 2);
  try {
    for (let i = 0; i < total; i++) {
      const vecs = (await nextCensus(runs, i)).map((v) => pick(names, v));
      if (i < N) {
        const env = envelopeAt(vecs, floors);
        for (let s = 0; s < S; s++) {
          data[(i * S + s) * 2] = env.median[s];
          data[(i * S + s) * 2 + 1] = env.spread[s];
        }
      }
      if (opt.verify) {
        const step = (i + 1) * CADENCE;
        for (let r = 0; r < runs.length; r++) {
          const e = envelopeAt(without(vecs, r), floors);
          strict[r].push(step, vecs[r], e.median, e.spread);
          at4[r].push(step, vecs[r], e.median, e.spread);
        }
      }
      if ((i + 1) % 1000 === 0) log(`spots-m3: ${i + 1} of ${total} censuses`);
    }
  } finally {
    await closeAll(runs);
  }
  if (opt.verify) {
    const D = new Map<string, number>();
    for (let r = 0; r < runs.length; r++) {
      const id = runs[r].run.id;
      const e = v0.runs.get(id) ?? stop(`${id}: no all-neutral entry in bell-v0.json`);
      if (!Object.is(strict[r].D(), at4[r].D())) stop(`${id}: D depends on the threshold (${strict[r].D()} and ${at4[r].D()})`);
      if (!Object.is(at4[r].D(), e.D50)) stop(`${id}: the lab's scorer gives D ${at4[r].D()} at W = 50 over ${total} censuses, bell-v0.json says ${e.D50}`);
      const got = at4[r].receipts().map(receiptKey).sort().join("|"), want = e.rings.map(receiptKey).sort().join("|");
      if (got !== want) stop(`${id}: rings at Z = 4 ${got || "none"}, bell-v0.json lists ${want || "none"}`);
      D.set(id, e.D50);
    }
    const calib = spots.filter((r) => r.experiment === "replay-calib").map((r) => D.get(r.id)!);
    if (calib.length !== v0.calibRuns || !Object.is(Math.max(...calib), v0.zStar)) stop(`Z* recomputed from ${calib.length} replay-calib runs is ${Math.max(...calib)}, bell-v0.json says ${v0.zStar}`);
    const held = spots.filter((r) => r.experiment === "replay-m4");
    const k = held.filter((r) => D.get(r.id)! > v0.zStar).length;
    if (k !== v0.heldOut.k || held.length !== v0.heldOut.of) stop(`held out ${k} of ${held.length} above Z*, bell-v0.json says ${v0.heldOut.k} of ${v0.heldOut.of}`);
    log(`spots-m3: 30 runs verified against bell-v0.json over ${total} censuses, leave-one-out; Z* = ${v0.zStar} recomputed`);
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// The fixture.

/** The lab test's excerpt, as the bytes to write (written only after every requested asset has built and verified). */
async function buildFixture(): Promise<Uint8Array> {
  const run = v0Runs().treatment.find((r) => r.seed === 1)!;
  const o = await open(run, v1.presetIdentity, (t) => checkV0Manifest(run, t), () => {});
  const censuses: Record<string, unknown>[] = [];
  try {
    for (let i = 0; i < 160; i++) {
      const n = await o.it.next();
      if (n.done) return stop(`${run.id}: ends before census ${i + 1}`);
      const { rec, rows } = n.value;
      if (rec.step !== (i + 1) * CADENCE) stop(`${run.id}: census ${i + 1} at step ${rec.step}`);
      const p = censusProblem(rec, rows);
      if (p) stop(`${run.id}: ${p}`);
      const c: Record<string, unknown> = {};
      for (const f of SERIES_FIELDS) c[f] = rec[f];
      let cells = 0;
      for (const [, k] of rows) cells += k;
      c.rows = { count: rows.length, cells, sha256: await sha256(enc.encode(rows.map(([k, v]) => `${k}\t${v}\n`).join(""))) };
      censuses.push(c);
    }
  } finally {
    await o.it.return(undefined);
  }
  const fixture = { source: `${run.rel} (series.jsonl and lineages.tsv, censuses 1 to 160)`, presetId: run.preset, seed: run.seed, condition: run.condition, fields: [...SERIES_FIELDS], censuses };
  return enc.encode(JSON.stringify(fixture) + "\n");
}

// ---------------------------------------------------------------------------------------------
// Build, verify, then write.

// The fixture must not take the name of a baseline file in the output directory (it would replace a verified asset).
if (opt.fixture !== undefined && fixtureDir !== null && writeAssets && fixtureDir === (await Deno.realPath(outDir))) {
  const name = opt.fixture.slice(opt.fixture.lastIndexOf("/") + 1).toLowerCase();
  const taken = baselineSpecs(v0.zStar).flatMap((s) => [`${s.file}.bin`, `${s.file}.json`]);
  if (taken.some((t) => t.toLowerCase() === name)) stop(`--fixture ${opt.fixture} would replace the baseline file of that name in --out ${outDir}`);
}
const fixtureBytes = opt.fixture ? await buildFixture() : null;
const outputs: { name: string; bytes: Uint8Array }[] = [];
if (writeAssets) {
  for (const spec of specs) {
    log(`${spec.preset}: building (${spec.rule}${opt.verify ? ", verifying" : ""})`);
    const data = spec.preset === "gradient-m3" ? await buildGradient(spec) : await buildSpots(spec);
    const bin = encodeEnvelope(data);
    const back = decodeEnvelope(bin);
    for (let i = 0; i < data.length; i++) if (!(Object.is(back[i], data[i]) || (Number.isNaN(back[i]) && Number.isNaN(data[i])))) stop(`${spec.preset}: the baseline does not round-trip at double ${i}`);
    const numbers = spec.preset === "gradient-m3" ? gradientNumbers(v1, records.v1Twins.text) : spotsNumbers(v0);
    const identity = spec.preset === "gradient-m3" ? v1.presetIdentity : v0.presetIdentity;
    if (identity !== expectedIdentity(spec.preset)) stop(`${spec.preset}: the record's presetIdentity ${identity} is not the current code's ${expectedIdentity(spec.preset)}`);
    const header = buildHeader(spec, { presetIdentity: identity, ruleVersion: RULE_VERSION, binSha256: await sha256(bin), binBytes: bin.byteLength, records: recordsFor(spec), numbers });
    outputs.push({ name: `${spec.file}.bin`, bytes: bin }, { name: `${spec.file}.json`, bytes: enc.encode(headerText(header)) });
  }
}
// Every requested asset has built and verified: only now is anything written. Each preset's bin goes before its header: a run
// cut off between the two leaves a header whose pinned SHA-256 the old bin does not match, which the lab's fetch refuses.
const realOut = writeAssets ? await Deno.realPath(outDir) : null;
for (const o of outputs) {
  await publish(realOut!, o.name, o.bytes);
  log(`wrote ${outDir}/${o.name} (${o.bytes.byteLength} bytes, sha256 ${await sha256(o.bytes)})`);
}
if (opt.fixture && fixtureBytes && fixtureDir) {
  const name = opt.fixture.slice(opt.fixture.lastIndexOf("/") + 1);
  await publish(fixtureDir, name, fixtureBytes);
  log(`fixture: ${opt.fixture} (${fixtureBytes.byteLength} bytes, sha256 ${await sha256(fixtureBytes)})`);
}
