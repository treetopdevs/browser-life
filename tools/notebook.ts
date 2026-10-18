// The naturalist's field notebook, v0 (docs/naturalist-bell-v0-2026-10-17.md, "The field notebook, v0: fixed before generating"):
// turns run bundles into one self-contained HTML page of field notes each, every note with its receipts. CPU only, streaming, no
// model calls. Logic in tools/lib/notebook.ts, the page in tools/lib/notebook-html.ts; the bell itself is tools/lib/bell.ts.
//
//   deno run -A tools/notebook.ts <bundle-dir>... --out <dir> [--base runs] [--record experiments/naturalist/bell-v0.json]
//                                 [--date YYYY-MM-DD] [--force]
//
// Each <bundle-dir> holds manifest.json, series.jsonl and lineages.tsv. Bundles are grouped by preset; per preset, the bell's
// envelope (every neutral run of that preset in the bell corpus, 40 for gradient-m3, 30 for spots-m3) must be present under
// --base, and all of it is read in lockstep with the bundles, one census at a time (series.jsonl by line, lineages.tsv through
// lineageCensuses); no table is held whole. A bundle that is a corpus directory under --base (same canonical path) is that corpus
// run: a neutral one is scored leave-one-out, and its D at W = 50 must equal the record's or the tool stops. The tool rings only at
// the record's calibrated Z* for the preset, strictly above it, and stops on any disagreement between the bell and its own trace.
//   --out     directory for <experiment>-<preset>-<condition>-seed-<n>.html and .notes.json (required, so nothing is written under
//             runs/ by default; refused inside --base, inside the repository's runs/, and inside any bundle given); an existing page
//             is refused unless --force. Nothing is written until every page has passed its cross-check.
//   --base    directory standing in for "runs"                                                       (default runs)
//   --record  the bell's committed record (complete, its calibrated readout called)        (default experiments/naturalist/bell-v0.json)
//   --date    the date printed on the page                                                            (default today, UTC)
//   --force   replace existing pages in --out
// Unknown flags stop the run. Every series cell a signal is read from must be a finite number; every envelope run's manifest must
// match the record's corpus entry (presetIdentity, steps, censusEvery); and every envelope run, scored leave-one-out in the same
// read, must reproduce the record's D at W = 50 and its rings at the primary Z, W exactly, or the run stops. A manifest's condition
// must agree with its cfg.neutral flag, with no spec overrides.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lineageCensuses } from "./lib/bundle.ts";
import {
  BellScorer,
  SignalExtractor,
  checkGroupIdentity,
  corpusRuns,
  mergeCensuses,
  parseManifest,
  parseSeries,
  type BellManifest,
  splitLines,
  type CorpusRun,
} from "./lib/bell.ts";
import {
  NOTEBOOK_W,
  RECORD_PATH,
  ZTrace,
  buildNotebook,
  checkAgainstRecordCorpus,
  checkCorpusScore,
  checkSignalCells,
  crossCheck,
  parseBellRecord,
  parseSubjectManifest,
  planNotebook,
  zStarFor,
  type SubjectInput,
} from "./lib/notebook.ts";
import { renderNotebook } from "./lib/notebook-html.ts";

const a = parseArgs(Deno.args, {
  string: ["base", "out", "record", "date"],
  boolean: ["force"],
  default: { base: "runs", record: RECORD_PATH },
  unknown: (arg) => {
    if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    return true;
  },
});
for (const k of ["base", "out", "record", "date"] as const) if (a[k] === "") throw new Error(`--${k} needs a value`);
if (!a.out) throw new Error("--out <dir> is required");
// parseArgs turns a positional that looks like a number into one ("007" -> 7), which would name another directory.
const dirs = a._.map((v) => {
  if (typeof v !== "string") throw new Error(`a bundle directory reads as the number ${v}; prefix it with ./ so it is taken as a path`);
  return v;
});
if (!dirs.length) throw new Error("give at least one bundle directory");
const generated = a.date ?? new Date().toISOString().slice(0, 10);
const asDate = new Date(`${generated}T00:00:00Z`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(generated) || Number.isNaN(asDate.getTime()) || asDate.toISOString().slice(0, 10) !== generated) throw new Error(`--date ${generated} is not a date in YYYY-MM-DD`);
const out = a.out;
const t0 = Date.now();

// ---------------------------------------------------------------------------------------------
// Helpers.

async function realOrNull(p: string): Promise<string | null> {
  try {
    return await Deno.realPath(p);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}
const FILES = ["manifest.json", "series.jsonl", "lineages.tsv"] as const;
async function bundleReal(dir: string): Promise<string | null> {
  const real = await realOrNull(dir);
  if (!real) return null;
  for (const f of FILES) if (!(await realOrNull(`${real}/${f}`))) return null;
  return real;
}
function seriesRecords(id: string, dir: string) {
  return (async function* () {
    const file = await Deno.open(`${dir}/series.jsonl`);
    yield* parseSeries(id, splitLines(file.readable.pipeThrough(new TextDecoderStream())));
  })();
}
/**
 * Every file written whole, in two passes so a failure leaves no half set: each text to a temp file beside its target, synced; then
 * each linked into place (refused if the target appeared meanwhile, unless --force: renamed over it). Temp files are removed on
 * any failure. A failure in the second pass (another writer racing this one) can still leave the pages linked before it.
 */
async function writeAll(files: { path: string; text: string }[]) {
  const tmps: string[] = [];
  try {
    for (const [i, f] of files.entries()) {
      const tmp = `${f.path}.${Deno.pid}.${i}.tmp`;
      const h = await Deno.open(tmp, { write: true, createNew: true });
      tmps.push(tmp); // ours from here on, so removed on any later failure (not before: createNew may have hit someone else's)
      try {
        const bytes = new TextEncoder().encode(f.text);
        for (let off = 0; off < bytes.length;) off += await h.write(bytes.subarray(off));
        await h.syncData();
      } finally {
        h.close();
      }
    }
    for (const [i, f] of files.entries()) {
      if (a.force) await Deno.rename(tmps[i], f.path);
      else {
        try {
          await Deno.link(tmps[i], f.path);
        } catch (e) {
          if (e instanceof Deno.errors.AlreadyExists) throw new Error(`STOP: ${f.path} appeared while scoring (another writer?); not replacing it without --force`);
          throw e;
        }
        await Deno.remove(tmps[i]);
      }
    }
  } finally {
    for (const t of tmps) await Deno.remove(t).catch(() => {});
  }
}
/** rel (from path.relative) climbs out of its base: ".." or "../…", or another root. A name like "..reports" stays inside. */
const climbs = (rel: string) => rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
/** child is parent or lies under it (both absolute). */
const inside = (child: string, parent: string) => !climbs(relative(parent, child));
/** A path as printed on a page: relative to the working directory when inside it, else with the home directory as ~. */
function shown(p: string): string {
  const abs = resolve(p), rel = relative(Deno.cwd(), abs);
  if (rel && !climbs(rel)) return rel;
  const home = Deno.env.get("HOME");
  return home && inside(abs, home) ? `~/${relative(home, abs)}` : abs;
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------------------------
// The record and the bundles.

const recordBytes = await Deno.readFile(a.record);
const record = parseBellRecord(new TextDecoder().decode(recordBytes));
const recordSha256 = await sha256Hex(recordBytes);

const subjectsByPreset = new Map<string, SubjectInput[]>();
for (const dir of dirs) {
  const real = await bundleReal(dir);
  if (!real) throw new Error(`${dir}: not a bundle directory (needs ${FILES.join(", ")})`);
  const manifest = parseSubjectManifest(dir, await Deno.readTextFile(`${real}/manifest.json`));
  const p = manifest.spec.presetId;
  zStarFor(record, p); // refuse early, before any reading
  subjectsByPreset.set(p, [...(subjectsByPreset.get(p) ?? []), { dir, real, manifest }]);
}

// Never write into the bundles' tree: --out may not lie inside --base, the repository's runs/, or any bundle given (each checked
// as given and by canonical path, out's canonical path taken through its nearest existing ancestor), before anything is created.
// Refuse to overwrite before any long read. The directory is created only when the pages are written.
const outAbs = resolve(out);
async function canonical(p: string): Promise<string> {
  let head = resolve(p), tail: string[] = [];
  let real: string | null;
  while (!(real = await realOrNull(head))) {
    const up = resolve(head, "..");
    if (up === head) return resolve(p);
    tail = [head.slice(up.length).replace(/^[/\\]+/, ""), ...tail];
    head = up;
  }
  return resolve(real, ...tail);
}
{
  const outCanon = await canonical(out);
  const repoRuns = resolve(fileURLToPath(new URL("..", import.meta.url)), "runs");
  const guarded: [string, string][] = [[a.base, "--base"], [repoRuns, "the repository's runs/"]];
  for (const subs of subjectsByPreset.values()) for (const s of subs) guarded.push([s.dir, `the bundle ${s.dir}`], [s.real, `the bundle ${s.dir}`]);
  for (const [p, what] of guarded) {
    const pAbs = resolve(p), pCanon = await canonical(p);
    for (const o of [outAbs, outCanon]) for (const g of [pAbs, pCanon]) if (inside(o, g)) throw new Error(`STOP: --out ${out} is inside ${what}; the notebook never writes into the runs tree or a bundle`);
  }
}

// How the base is named on the page: as given, relative to the working directory or with ~ for the home directory.
const baseLabel = shown(a.base).replace(/\/+$/, "");
const plans = [];
for (const [preset, subjects] of subjectsByPreset) {
  const corpus: { run: CorpusRun; real: string | null }[] = [];
  for (const run of corpusRuns().filter((r) => r.preset === preset)) corpus.push({ run, real: await bundleReal(`${a.base}/${run.rel}`) });
  const plan = planNotebook({ preset, record, subjects, corpus });
  for (const s of plan.subjects) {
    for (const ext of [".html", ".notes.json"]) {
      if (!a.force && (await realOrNull(resolve(outAbs, s.outName + ext)))) throw new Error(`STOP: ${out}/${s.outName}${ext} exists (pass --force to replace it)`);
    }
  }
  plans.push(plan);
}

// ---------------------------------------------------------------------------------------------
// Per preset, in lockstep.

const pages: { path: string; text: string }[] = [];
for (const plan of plans) {
  const byDir = new Map(corpusRuns().map((r) => [r.id, r]));
  const identities = [];
  for (const [i, r] of plan.runs.entries()) {
    const text = await Deno.readTextFile(`${r.dir}/manifest.json`);
    const env: BellManifest | null = i < plan.envelope.length ? parseManifest(byDir.get(r.id)!, text) : null;
    // parseSubjectManifest also holds the condition to the config (an envelope run must be cfg.neutral, without overrides).
    const m: BellManifest = env ?? parseSubjectManifest(r.id, text);
    if (env) parseSubjectManifest(r.id, text);
    const ident = { id: r.id, presetIdentity: m.presetIdentity, steps: m.spec.steps, censusEvery: m.spec.censusEvery };
    // The envelope Z* was calibrated on is the record's: same identity, horizon and cadence, run by run.
    if (i < plan.envelope.length) checkAgainstRecordCorpus(record, ident);
    else {
      const cr = plan.subjects.find((x) => x.run === i)?.corpusRun;
      if (cr) checkAgainstRecordCorpus(record, { ...ident, id: cr.id });
    }
    identities.push(ident);
  }
  checkGroupIdentity(identities);
  const { steps, censusEvery } = identities[0] as { steps: number; censusEvery: number };
  const censusCount = steps / censusEvery;
  console.log(`${plan.preset}: Z* ${plan.zStar}; ${plan.envelope.length} envelope runs, ${plan.subjects.length} bundle(s), ${plan.runs.length} streams, ${censusCount} censuses each`);

  // Scored too: every envelope run, leave-one-out, to hold its D and its rings at the primary Z, W to the record's (checkCorpusScore),
  // so Z* and the false alarms on the page are the data on disk and not only the manifests. Results come back in this order.
  const envelopeScorings = plan.envelope.map((i) => ({ id: `envelope ${plan.envelopeIds[i]}`, run: i, envelope: "all-neutral" }));
  const scorer = new BellScorer(plan.runs.map((r) => r.id), [{ id: "all-neutral", members: plan.envelope }], [...plan.subjects.map((s) => ({ id: s.id, run: s.run, envelope: "all-neutral" })), ...envelopeScorings], {
    Z: [plan.zRing, record.parameters.primary.Z],
    W: [NOTEBOOK_W],
    cadence: censusEvery,
  });
  const traces = plan.subjects.map((s) => new ZTrace(censusCount, plan.envelope, s.run));
  const gens = plan.runs.map((r) => mergeCensuses(r.id, seriesRecords(r.id, r.dir), lineageCensuses(r.dir)));
  const extractors = plan.runs.map(() => new SignalExtractor());
  try {
    for (;;) {
      const nexts = await Promise.all(gens.map((g, i) => g.next().catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(msg.includes(plan.runs[i].id) ? msg : `${plan.runs[i].id}: ${msg}`);
      })));
      const ended = nexts.map((n) => !!n.done);
      if (ended.every(Boolean)) break;
      if (ended.some(Boolean)) {
        const i = ended.indexOf(true), j = ended.indexOf(false);
        throw new Error(`lockstep: ${plan.runs[i].id} ended after ${scorer.censuses} censuses but ${plan.runs[j].id} has more`);
      }
      const censuses = nexts.map((n, i) => {
        const { rec, rows } = n.value as { rec: Record<string, unknown> & { step: number }; rows: [string, number][] };
        checkSignalCells(plan.runs[i].id, rec);
        return { step: rec.step, values: extractors[i].push(rec, rows) };
      });
      scorer.push(censuses);
      const vectors = censuses.map((c) => c.values);
      for (const [k, t] of traces.entries()) t.push(censuses[plan.subjects[k].run].step, vectors);
      if (scorer.censuses % 1000 === 0) console.log(`  ${plan.preset}: ${scorer.censuses} censuses (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  } finally {
    await Promise.allSettled(gens.map((g) => g.return(undefined)));
  }
  if (scorer.censuses !== censusCount) throw new Error(`${plan.preset}: ${scorer.censuses} censuses read, the manifests promise ${censusCount} (steps ${steps} every ${censusEvery})`);

  // Every envelope file read, with its size (the receipt for the reference values).
  const envelopeSources = [];
  for (const i of plan.envelope) for (const f of FILES) envelopeSources.push({ path: `${baseLabel}/${plan.envelopeIds[i]}/${f}`, bytes: (await Deno.stat(`${plan.runs[i].dir}/${f}`)).size });
  const results = scorer.results();
  for (const [j, i] of plan.envelope.entries()) checkCorpusScore(record, plan.envelopeIds[i], results[plan.subjects.length + j]);
  console.log(`  ${plan.preset}: all ${plan.envelope.length} envelope runs reproduce their record D and rings`);
  for (const [k, s] of plan.subjects.entries()) {
    const result = results[k];
    if (s.corpusRun) checkCorpusScore(record, s.corpusRun.id, result);
    const rings = crossCheck(result, traces[k], { id: s.id, zStar: plan.zStar, zRing: plan.zRing, recordD: s.recordD });
    const sources = [];
    for (const f of FILES) sources.push({ path: s.corpusRun ? `${baseLabel}/${s.corpusRun.rel}/${f}` : `${shown(s.dir)}/${f}`, bytes: (await Deno.stat(`${s.real}/${f}`)).size });
    const model = buildNotebook({ plan, subject: s, result, trace: traces[k], rings, record, meta: { generated, recordPath: shown(a.record), recordSha256, base: baseLabel, sources, envelopeSources } });
    pages.push({ path: resolve(outAbs, `${s.outName}.notes.json`), text: JSON.stringify(model, null, 1) + "\n" });
    pages.push({ path: resolve(outAbs, `${s.outName}.html`), text: renderNotebook(model) });
    console.log(`  ${s.id}: D ${result.D[0]}${s.recordD === null ? "" : ` (record ${s.recordD}, equal)`}; ${rings.length} ring(s) above Z* ${plan.zStar}${rings.length ? `: ${rings.map((r) => `${r.signal} ${r.side} from step ${r.receipt.startStep}`).join(", ")}` : ""}`);
  }
}

// Every page passed its cross-check: only now is anything written.
await Deno.mkdir(outAbs, { recursive: true });
await writeAll(pages);
console.log(`${pages.length} files in ${out}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
