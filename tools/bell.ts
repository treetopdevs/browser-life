// The anomaly bell, v0 (docs/naturalist-bell-v0-2026-10-17.md, "Fixed before running"): a code detector that says when a run has
// left the envelope of the neutral runs of its preset. CPU only, streaming, no model calls. Logic and constants in
// tools/lib/bell.ts; this file reads bundles, runs the scorer in lockstep per preset and writes the records.
//
//   deno run -A tools/bell.ts [run] [--base runs] [--out <dir>] [--record <file>] [--allow-incomplete] [--preliminary-only] [--force]
//
// Reads, for each run of the fixed corpus (the note's "Corpora": 70 neutral, 10 treatment, 5 no-mutation), <base>/<experiment>/
// <preset>/<condition>/seed-<n>/{manifest.json, series.jsonl, lineages.tsv}, one census at a time (series.jsonl by line,
// lineages.tsv through lineageCensuses); no table is held whole. The runs of one preset are read together, in lockstep: they must
// share preset identity, steps and census cadence, every census must be present and at the cadence, and any mismatch stops the
// run naming the run. Nothing is aligned silently.
//   --base              directory standing in for "runs"                                        (default runs)
//   --out               per-run detail (D by signal, side and W; every receipt), written first      (default runs/naturalist/bell-v0 for a
//                       complete readout, runs/naturalist/bell-v0.preliminary or .incomplete otherwise)
//   --record            the compact summary record, written atomically (temp file, rename) after the detail files, so it is
//                       the commit marker                                                          (default experiments/naturalist/bell-v0.json
//                       for a complete readout, bell-v0.preliminary.json or bell-v0.incomplete.json otherwise)
//                       --out must be empty or absent (refused otherwise, unless --force). A run that scored nothing writes
//                       nothing, and an incomplete or preliminary run refuses to replace a record that is complete:true unless --force.
//   --allow-incomplete  score whatever corpus runs exist; the record says complete:false and criterion 1, 2 and the reading are
//                       not called (default: refuse when any expected run directory is missing)
//   --preliminary-only  only the replay-m4 gradient-m3 runs against the 20 M4 neutral seeds; complete:false, nothing is called
//   --force             let an incomplete or preliminary record replace a complete one at the same --record, and write into a
//                       non-empty --out
// Unknown flags and extra arguments stop the run.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { lineageCensuses } from "./lib/bundle.ts";
import {
  BELL_VERSION,
  BellScorer,
  GRID,
  NOTE_PATH,
  PRIMARY,
  SIGNALS,
  SignalExtractor,
  checkGroupIdentity,
  corpusRuns,
  defaultOutputs,
  entryOf,
  mergeCensuses,
  parseManifest,
  parseSeries,
  planGroup,
  recordRefusal,
  splitLines,
  summarize,
  type BellManifest,
  type CorpusRun,
  type ScoredEntry,
  type ScoringResult,
} from "./lib/bell.ts";

const a = parseArgs(Deno.args, {
  string: ["base", "out", "record"],
  boolean: ["allow-incomplete", "preliminary-only", "force"],
  default: { base: "runs" },
  unknown: (arg) => {
    if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    return true;
  },
});
// A string flag with no operand (last, or followed by another flag) parses as "": stop before any I/O rather than resolve under "/".
for (const k of ["base", "out", "record"] as const) if (a[k] === "") throw new Error(`--${k} needs a path`);
const cmd = String(a._[0] ?? "run");
if (cmd !== "run" || a._.length > 1) throw new Error(`unexpected argument${a._.length > 1 ? "s" : ""} ${a._.map(String).join(" ")} (only "run")`);
const preliminaryOnly = !!a["preliminary-only"];
const allowIncomplete = !!a["allow-incomplete"];

// ---------------------------------------------------------------------------------------------
// File helpers.

const dirOf = (r: CorpusRun) => `${a.base}/${r.rel}`;
async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}
/** series.jsonl, one record at a time. */
function seriesRecords(r: CorpusRun) {
  return (async function* () {
    const file = await Deno.open(`${dirOf(r)}/series.jsonl`);
    yield* parseSeries(r.id, splitLines(file.readable.pipeThrough(new TextDecoderStream())));
  })();
}
let writes = 0;
/** Replaced whole: write a unique temp file in the same directory, sync, rename. */
async function writeAtomic(path: string, text: string) {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
  await Deno.mkdir(dir, { recursive: true });
  const tmp = `${path}.${Deno.pid}.${++writes}.tmp`;
  let wrote = false;
  try {
    await Deno.writeTextFile(tmp, text, { createNew: true });
    wrote = true;
    const f = await Deno.open(tmp, { read: true });
    try {
      await f.syncData();
    } finally {
      f.close();
    }
    await Deno.rename(tmp, path);
  } catch (e) {
    if (wrote || !(e instanceof Deno.errors.AlreadyExists)) await Deno.remove(tmp).catch(() => {});
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Corpus discovery.

let corpus = corpusRuns();
if (preliminaryOnly) corpus = corpus.filter((r) => r.experiment === "replay-m4" && r.preset === "gradient-m3");
const present: CorpusRun[] = [];
const missing: string[] = [];
for (const r of corpus) {
  const ok = (await Promise.all(["manifest.json", "series.jsonl", "lineages.tsv"].map((f) => exists(`${dirOf(r)}/${f}`)))).every(Boolean);
  if (ok) present.push(r);
  else missing.push(r.id);
}
if (missing.length && !allowIncomplete) {
  throw new Error(`STOP: ${missing.length} of ${corpus.length} expected run directories are missing under ${a.base} (first: ${missing[0]}); --allow-incomplete scores what exists and calls nothing`);
}
const complete = missing.length === 0 && !preliminaryOnly;
const out = a.out ?? defaultOutputs({ complete, preliminaryOnly }).out;
// Checked before any reading. A record names its detail directory, so an occupied one is refused: rewriting it in place could
// leave an older record pointing at a mix of old and new detail files.
const occupied = await (async () => {
  try {
    for await (const _ of Deno.readDir(out)) return true;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return false;
})();
if (occupied && !a.force) throw new Error(`STOP: --out ${out} is not empty; choose a fresh directory (or --force to write into it)`);

// ---------------------------------------------------------------------------------------------
// Per preset, in lockstep.

type Manifest = BellManifest;
const entries: ScoredEntry[] = [];
const corpusInfo: { id: string; presetIdentity: string; steps: number; censusEvery: number }[] = [];
const detail = new Map<string, { run: CorpusRun; manifest: Manifest; result: ScoringResult }>();

const byPreset = new Map<string, CorpusRun[]>();
for (const r of present) byPreset.set(r.preset, [...(byPreset.get(r.preset) ?? []), r]);

for (const [preset, group] of byPreset) {
  const plan = planGroup(group, { preliminaryOnly });
  if (!plan.runs.length || !plan.scorings.length) {
    console.log(`${preset}: nothing to score (no scoring has a reference run left)`);
    continue;
  }
  console.log(`${preset}: ${plan.runs.length} runs, envelopes ${plan.envelopes.map((e) => `${e.id}(${e.members.length})`).join(", ")}, ${plan.scorings.length} scorings`);
  const manifests: Manifest[] = [];
  for (const r of plan.runs) {
    const m = parseManifest(r, await Deno.readTextFile(`${dirOf(r)}/manifest.json`).catch((e) => {
      throw new Error(`${r.id}: cannot read manifest.json (${(e as Error).message})`);
    }));
    manifests.push(m);
  }
  checkGroupIdentity(plan.runs.map((r, i) => ({ id: r.id, presetIdentity: manifests[i].presetIdentity, steps: manifests[i].spec.steps, censusEvery: manifests[i].spec.censusEvery })));
  const { steps, censusEvery } = manifests[0].spec;
  plan.runs.forEach((r, i) => corpusInfo.push({ id: r.id, presetIdentity: manifests[i].presetIdentity, steps, censusEvery }));

  const scorer = new BellScorer(plan.runs.map((r) => r.id), plan.envelopes, plan.scorings, { cadence: censusEvery });
  const gens = plan.runs.map((r) => mergeCensuses(r.id, seriesRecords(r), lineageCensuses(dirOf(r))));
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
      scorer.push(nexts.map((n, i) => {
        const { rec, rows } = n.value as { rec: Record<string, unknown> & { step: number }; rows: [string, number][] };
        return { step: rec.step, values: extractors[i].push(rec, rows) };
      }));
      if (scorer.censuses % 2000 === 0) console.log(`  ${preset}: ${scorer.censuses} censuses`);
    }
  } finally {
    await Promise.allSettled(gens.map((g) => g.return(undefined)));
  }
  if (scorer.censuses !== steps / censusEvery) throw new Error(`${preset}: ${scorer.censuses} censuses read, the manifests promise ${steps / censusEvery} (steps ${steps} every ${censusEvery})`);
  scorer.results().forEach((res, k) => {
    const sc = plan.scorings[k];
    const run = plan.runs[sc.run];
    entries.push(entryOf(run, res));
    detail.set(res.id, { run, manifest: manifests[sc.run], result: res });
  });
}

// ---------------------------------------------------------------------------------------------
// Records.

const summary = summarize(entries, { complete });
const perRun = [...detail.values()].map(({ run, manifest, result }) => {
  const wi = GRID.W.indexOf(PRIMARY.W as never);
  const D = result.D[wi];
  const flagged = D >= PRIMARY.Z;
  const receipts = result.receipts.filter((r) => r.Z === PRIMARY.Z && r.W === PRIMARY.W);
  const first = receipts.length ? [...receipts].sort((x, y) => x.endStep - y.endStep)[0] : null;
  return {
    id: run.id,
    experiment: run.experiment,
    preset: run.preset,
    condition: run.condition,
    seed: run.seed,
    envelope: result.envelope,
    D: Object.fromEntries(GRID.W.map((w, i) => [String(w), result.D[i]])),
    D_primary: D,
    flagged,
    firstRing: first,
    rings: flagged ? receipts : [],
    presetIdentity: manifest.presetIdentity,
  };
});

const record = {
  rule: "anomaly-bell",
  version: BELL_VERSION,
  note: NOTE_PATH,
  complete,
  preliminaryOnly,
  missing,
  parameters: { primary: PRIMARY, grid: GRID, signals: SIGNALS.map((s) => ({ name: s.name, kind: s.kind, floor: s.floor, source: s.source })) },
  corpus: corpusInfo,
  summary,
  runs: perRun,
};
const recordPath = a.record ?? defaultOutputs({ complete, preliminaryOnly }).record;
const existing = await Deno.readTextFile(recordPath).catch(() => null);
const refusal = recordRefusal(existing, { complete, scored: entries.length, force: !!a.force });
if (refusal) throw new Error(`STOP: not writing ${recordPath}: ${refusal}`);
// Detail files first, the record last: the record is the commit marker, so a crash leaves no record pointing at a partial detail set.
for (const { run, manifest, result } of detail.values()) {
  const file = `${out}/${run.rel}${result.envelope === "all-neutral" ? "" : `.${result.envelope}`}.json`;
  await writeAtomic(file, JSON.stringify({ rule: "anomaly-bell", version: BELL_VERSION, id: run.id, envelope: result.envelope, presetIdentity: manifest.presetIdentity, spec: manifest.spec, D: Object.fromEntries(GRID.W.map((w, i) => [String(w), result.D[i]])), windows: result.windows, dBySignal: result.dBySignal, receipts: result.receipts }, null, 1) + "\n");
}
await writeAtomic(recordPath, JSON.stringify({ ...record, detail: { dir: out, files: detail.size } }, null, 1) + "\n");

// ---------------------------------------------------------------------------------------------
// Short human summary.

const f = (x: number | null | undefined, d = 3) => (x === null || x === undefined ? "n/a" : x.toFixed(d));
const cnt = (c: { k: number; of: number }) => `${c.k}/${c.of}`;
console.log("");
console.log(`anomaly bell v${BELL_VERSION}${complete ? "" : " (INCOMPLETE: nothing is called)"}; primary Z=${PRIMARY.Z}, W=${PRIMARY.W}`);
const c1 = summary.criterion1, c2 = summary.criterion2;
console.log(`  criterion 1 (false alarms, at most 2 of 70): ${c1.status}; ${c1.k} of ${c1.n} neutral ring, upper95 ${f(c1.upper95)}${c1.reason ? ` (${c1.reason})` : ""}`);
console.log(`  criterion 2 (separation >= 0.8): ${c2.status}; treatment vs gradient-m3 neutral effect ${f(c2.effect)} (${c2.nTreatment} vs ${c2.nNeutral})${c2.reason ? ` (${c2.reason})` : ""}`);
console.log(`  reading: ${summary.reading}`);
console.log(`  reported: no-mutation vs neutral effect ${f(summary.reported.noMutationVsNeutral.effect)}, rings ${cnt(summary.reported.noMutationVsNeutral.rings)}; treatment rings ${cnt(summary.reported.treatmentRings)}; treatment vs no-mutation effect ${f(summary.reported.treatmentVsNoMutation.effect)}`);
const p = summary.reported.preliminary;
console.log(`  preliminary (20 M4 neutral seeds): false alarms ${cnt(p.falseAlarms)}, treatment rings ${cnt(p.treatmentRings)}, no-mutation rings ${cnt(p.noMutationRings)}, effect ${f(p.effectTreatmentVsNeutral)}`);
console.log(`  grid (Z, W: false alarms of 70 / of 20 prelim, treatment rings, effect):`);
for (const c of summary.grid) console.log(`    Z=${c.Z} W=${c.W}: ${cnt(c.falseAlarms)} / ${cnt(c.falseAlarmsPrelim)}, ${cnt(c.treatmentRings)}, ${f(c.effectTreatmentVsNeutral)}`);
const s2 = summary.secondary;
console.log(`  calibrated held-out (W=${s2.W}): ${s2.status}${s2.reason ? ` (${s2.reason})` : ""}`);
for (const [pr, v] of Object.entries(s2.perPreset)) console.log(`    ${pr}: Z*=${f(v.zStar)} from ${v.calibRuns} calibration runs; held-out neutral above ${cnt(v.heldOutNeutral)} (expected ${f(v.expected, 2)})`);
console.log(`    held-out neutral above Z* (all presets): ${cnt(s2.heldOutNeutralTotal)} (expected ${f(s2.heldOutNeutralTotal.expected, 2)})`);
console.log(`    treatment above Z*_gradient ${cnt(summary.secondary.treatment)}, no-mutation ${cnt(summary.secondary.noMutation)}`);
console.log(`record: ${recordPath}; detail: ${out}`);
