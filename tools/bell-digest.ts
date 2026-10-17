// The anomaly bell v1, part C's tooling (docs/naturalist-bell-v1-plan-2026-10-17.md, "Fixed before running", section C): the frozen
// item manifest and digests, and the scoring of whatever answers come back. CPU only, streaming, NO model call. Logic and constants
// in tools/lib/bell-digest.ts (its header says how items, digests and the code baselines are defined); this file reads bundles
// and writes files.
//
//   deno run -A tools/bell-digest.ts build --runs <runs root> --base <runs root holding replay-m4> --out <dir> --call-settings <json file>
//       [--nudges experiments/naturalist/bell-v1-nudges.json] [--voids <the twin bell's record>] [--force]
//   deno run -A tools/bell-digest.ts score --manifest <dir> --answers <dir> [--runs <root> --base <root>]
//       [--pair-record experiments/naturalist/bell-v1-twins.json] [--record <file>] [--force]
//       (the --pair-record must hash to the manifest's twinRecord.sha256, else score stops)
//   (test only, either subcommand)  --pilot <root>   the design-pilot bundles in place of --runs/--base, S = 30,000, 20,000-step
//                                   windows (see pilotLayout); the manifest says mode "pilot" and refuses to go under experiments/
//
// build reads the 10 treatment bases <base>/replay-m4/gradient-m3/treatment/seed-<k> (bundles of at least 300,000 steps, read to that
// horizon: the replay-m4 ones run to 1,000,000) and the 50 twins <runs>/bell-v1-twins-<arm>/
// gradient-m3/treatment/seed-<k> (arm nudge, nudge2, l64, l96, f), every census of each (series.jsonl by line, lineages.tsv through
// lineageCensuses; no table is held whole, only the signal vectors of the window range). A census must have finite livingCells and
// lineages and lineage rows that match them exactly. A twin is void (its items are left out and reported, their draws kept) if its
// manifest is not a finished 300,000-step run, its interventions.jsonl is not exactly the scheduled entry, a census fails, or it
// differs from its base before S. The twin bell's record (--voids, default experiments/naturalist/bell-v1-twins.json) is required in a
// production build: it is the authority on the full-history checks, and its void twins are void here too; it must carry the identity
// and parameters tools/bell1.ts twins writes for the note's plan and one explicit validity decision for each of the 50 twins, else
// build stops (a plain json array of "arm-seed" strings is accepted in a pilot only). The manifest keeps the record's file name (not its path) and SHA-256. A twin
// identical to its base over the whole window is kept and reported. Writes, under --out: items/<id>.txt (ids are shuffled, see the
// lib's header), prompts/T1.txt and T2.txt, schema-T1.json and schema-T2.json, manifest.json, call-settings.json when --call-settings
// (required in production: the model id and its settings, a json object with a string "model", copied verbatim so that its hash is
// frozen too), and
// last hashes.json (SHA-256 of each of those), which is the commit marker: an --out that has files is refused unless --force. A call
// sends composePrompt(prompt, item text), so its hash covers both, and never an item id. A production build without --call-settings
// stops (the note freezes the model id and settings before the yes); a pilot build only warns.
//
// score reads hashes.json and refuses if any frozen file has changed ("a change after that voids the run"), then <answers>/<id>.json
// (or .txt): the model's final reply text for each item, one retry already done upstream. Missing, unparsable or schema-failing =
// miss on a positive, false alarm on a negative. Scores T1 and T2 apart against the bars; the T2 code baseline needs the bundles
// (--runs and --base, or --pilot), the T1 comparator needs the twin bell's record (reported "not available" when absent). The record
// goes to --record (default <answers>/score.json); an existing record is refused unless --force. A production manifest frozen with
// no call-settings.json is scored as complete:false with nothing called (model, code T1 and code T2 withheld, counts kept). A twin
// the record marks void is void for every score, and the T1 comparator withholds its comparison when a scored item is void.
// Unknown flags and extra arguments stop the run.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { lineageCensuses } from "./lib/bundle.ts";
import { interventionsMatch, planJobs, type NudgeCentres } from "./lib/bell-v1-jobs.ts";
import { mergeCensuses, parseManifest, parseSeries, splitLines, type CorpusRun } from "./lib/bell.ts";
import {
  CALL_SETTINGS_FILE,
  CENSUS_EVERY,
  DIGEST_VERSION,
  assemble,
  callSettingsProblem,
  buildPrompt,
  buildSchema,
  checkReceipt,
  codeBaselineT2,
  decisionOutcome,
  itemRun,
  lineageBlocksThrough,
  loadTable,
  makeManifest,
  normaliseReason,
  orientationReport,
  parseAnswer,
  pilotLayout,
  planItems,
  productionLayout,
  readPairRecord,
  readVoids,
  refKey,
  renderManifest,
  scoreTask,
  seriesThrough,
  sha256Hex,
  t1Comparator,
  t2Windows,
  twinRecordProblem,
  windowStart,
  withhold,
  withholdComparator,
  type DigestLayout,
  type Manifest,
  type ManifestItem,
  type Outcome,
  type PlannedItem,
  type RunRef,
  type RunTable,
  type TableResult,
  type TaskScore,
} from "./lib/bell-digest.ts";

const a = parseArgs(Deno.args, {
  string: ["runs", "base", "out", "nudges", "voids", "manifest", "answers", "pair-record", "record", "pilot", "call-settings"],
  boolean: ["force"],
  default: { nudges: "experiments/naturalist/bell-v1-nudges.json", "pair-record": "experiments/naturalist/bell-v1-twins.json" },
  unknown: (arg) => {
    if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    return true;
  },
});
for (const k of ["runs", "base", "out", "nudges", "voids", "manifest", "answers", "pair-record", "record", "pilot", "call-settings"] as const) if (a[k] === "") throw new Error(`--${k} needs a path`);
const cmd = String(a._[0] ?? "");
if ((cmd !== "build" && cmd !== "score") || a._.length > 1) throw new Error(`usage: bell-digest.ts build|score ... (got ${a._.map(String).join(" ") || "nothing"})`);

// ---------------------------------------------------------------------------------------------
// File helpers.

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
const readOrNull = (p: string) => Deno.readTextFile(p).catch((e) => (e instanceof Deno.errors.NotFound ? null : Promise.reject(e)));
async function nonEmpty(dir: string): Promise<boolean> {
  try {
    for await (const _ of Deno.readDir(dir)) return true;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Layout and run directories.

const pilot = a.pilot !== undefined;
const layout: DigestLayout = pilot ? pilotLayout() : productionLayout();
if (!pilot && (!a.runs || !a.base) && (cmd === "build" || a.runs || a.base)) throw new Error("--runs and --base are both needed (or --pilot <root>, test only)");
const PILOT_DIR: Record<string, string> = { base: "base", nudge: "lesion", nudge2: "lesion", l64: "l64", l96: "l96", f: "f32" };
const dirOf = (r: RunRef): string =>
  pilot
    ? `${a.pilot}/${PILOT_DIR[r.kind === "base" ? "base" : r.arm]}/bellv1-pilot/gradient-m3/neutral/seed-${r.seed}`
    : r.kind === "base"
    ? `${a.base}/replay-m4/gradient-m3/treatment/seed-${r.seed}`
    : `${a.runs}/bell-v1-twins-${r.arm}/gradient-m3/treatment/seed-${r.seed}`;
const corpusOf = (r: RunRef): CorpusRun => {
  const experiment = pilot ? "bellv1-pilot" : r.kind === "base" ? "replay-m4" : `bell-v1-twins-${r.arm}`;
  const condition = pilot ? "neutral" : "treatment";
  const rel = `${experiment}/gradient-m3/${condition}/seed-${r.seed}`;
  return { id: rel, experiment, preset: "gradient-m3", condition, seed: r.seed, rel };
};

let nudgeCentres: NudgeCentres | null = null;
async function nudges(): Promise<NudgeCentres> {
  if (nudgeCentres) return nudgeCentres;
  const j = JSON.parse(await Deno.readTextFile(a.nudges!));
  const out: NudgeCentres = {};
  for (const c of j.centres ?? []) (out[c.seed] ??= {} as NudgeCentres[number])[c.arm as "nudge" | "nudge2"] = { x: c.x, y: c.y };
  return (nudgeCentres = out);
}

/** Why a twin's interventions.jsonl is not its job's exactly one scheduled entry, or null. Production only (the pilot has other doses). */
async function interventionProblem(r: Extract<RunRef, { kind: "twin" }>): Promise<string | null> {
  const job = planJobs(await nudges()).find((j) => j.arm === r.arm && j.seed === r.seed);
  if (!job) return `no job for ${r.arm} seed ${r.seed}`;
  const text = await readOrNull(`${dirOf(r)}/interventions.jsonl`);
  const applied = (text ?? "").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  return interventionsMatch(job, applied) ? null : "interventions.jsonl is not exactly the scheduled entry";
}

/**
 * One run's table over [lo, hi]; with `lenient` a twin's failure is a void reason, otherwise (and always for a base) it throws.
 * A twin is exactly the horizon long; a base may be longer (replay-m4 bases are 1,000,000 steps) and is read to the horizon.
 */
async function loadRun(ref: RunRef, lo: number, hi: number, lenient: boolean): Promise<TableResult> {
  const run = corpusOf(ref), dir = dirOf(ref);
  try {
    const m = parseManifest(run, await Deno.readTextFile(`${dir}/manifest.json`));
    const base = ref.kind === "base";
    if (!(base ? m.spec.steps >= layout.steps : m.spec.steps === layout.steps) || m.spec.censusEvery !== CENSUS_EVERY) {
      throw new Error(`${run.id}: manifest has ${m.spec.steps} steps every ${m.spec.censusEvery}, expected ${base ? "at least " : ""}${layout.steps} every ${CENSUS_EVERY}`);
    }
    if (!pilot && ref.kind === "twin") {
      const bad = await interventionProblem(ref);
      if (bad) throw new Error(`${run.id}: ${bad}`);
    }
    const textLines = async function* (name: string) {
      const file = await Deno.open(`${dir}/${name}`);
      yield* splitLines(file.readable.pipeThrough(new TextDecoderStream()));
    };
    const series = parseSeries(run.id, textLines("series.jsonl"));
    // A base is cut at the horizon before the merge (mergeCensuses reads one lineage census ahead); a twin is read whole.
    const merged = base
      ? mergeCensuses(run.id, seriesThrough(series, layout.steps), lineageBlocksThrough(run.id, textLines("lineages.tsv"), layout.steps))
      : mergeCensuses(run.id, series, lineageCensuses(dir));
    return { table: await loadTable(run.id, merged, { lo, hi, steps: layout.steps, truncate: base }) };
  } catch (e) {
    if (lenient && ref.kind === "twin") return { void: normaliseReason((e as Error).message) };
    throw e;
  }
}
/** Loads runs a few at a time. */
async function loadAll(refs: readonly RunRef[], lo: number, hi: number, lenient: boolean): Promise<Map<string, TableResult>> {
  const out = new Map<string, TableResult>();
  const todo = [...new Map(refs.map((r) => [refKey(r), r])).values()];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, async () => {
    while (next < todo.length) {
      const r = todo[next++];
      out.set(refKey(r), await loadRun(r, lo, hi, lenient));
      console.log(`  read ${refKey(r)} (${out.size}/${todo.length})`);
    }
  }));
  return out;
}
const rangeOf = (items: readonly PlannedItem[]) => ({
  lo: Math.min(...items.map((i) => windowStart(layout, i))),
  hi: Math.min(layout.steps, Math.max(...items.map((i) => windowStart(layout, i) + layout.windowSteps))),
});

// ---------------------------------------------------------------------------------------------
// build.

async function build() {
  if (!a.out) throw new Error("--out needs a directory");
  if (pilot && /(^|\/)experiments(\/|$)/.test(a.out)) throw new Error("STOP: a pilot manifest does not go under experiments/");
  if (!a.force && (await nonEmpty(a.out))) throw new Error(`STOP: --out ${a.out} is not empty; choose a fresh directory (or --force to write into it)`);
  if (!pilot && !a["call-settings"]) throw new Error("STOP: a production build needs --call-settings <json file> (the model id and its settings, frozen and hashed with the manifest before the yes)");
  const items = planItems({ seeds: layout.seeds });
  const voidPath = a.voids ?? (pilot ? undefined : a["pair-record"]!);
  const voidText = voidPath ? await readOrNull(voidPath) : null;
  const voidJson = voidText === null ? null : JSON.parse(voidText);
  const refusal = twinRecordProblem(layout.mode, voidJson);
  if (refusal) throw new Error(`STOP: ${refusal}`);
  const voidList = voidJson === null ? [] : readVoids(voidJson);
  const voids = new Map<string, string>();
  for (const it of items) if (it.arm !== "base" && voidList.includes(`${it.arm}-${it.seed}`)) voids.set(it.id, `void in the twin bell's record (${it.arm}-${it.seed})`);
  const { lo, hi } = rangeOf(items);
  const refs: RunRef[] = layout.seeds.map((seed) => ({ kind: "base", seed }));
  for (const it of items) refs.push(itemRun(it));
  console.log(`reading ${new Set(refs.map(refKey)).size} runs, window range ${lo}..${hi}`);
  const tables = await loadAll(refs, lo, hi, true);
  const built = assemble(items, layout, (r) => tables.get(refKey(r)) ?? { void: "not read" }, voids);
  const manifest = await makeManifest(built, layout, undefined, voidText === null ? null : { path: voidPath!.slice(voidPath!.lastIndexOf("/") + 1), sha256: await sha256Hex(voidText) });

  // Files: items, prompts, schemas, manifest, hashes last.
  const files: Record<string, string> = {};
  for (const b of built) if (b.text !== null) files[`items/${b.item.id}.txt`] = b.text;
  for (const t of ["T1", "T2"] as const) {
    files[`prompts/${t}.txt`] = buildPrompt(t, layout.windowSteps);
    files[`schema-${t}.json`] = JSON.stringify(buildSchema(t, layout.windowSteps), null, 1) + "\n";
  }
  let settingsText: string | null = null;
  if (a["call-settings"]) {
    settingsText = await Deno.readTextFile(a["call-settings"]);
    const j = JSON.parse(settingsText);
    if (j === null || typeof j !== "object" || Array.isArray(j) || typeof j.model !== "string" || !j.model) throw new Error("--call-settings must be a json object with a non-empty string \"model\" (and the settings of the call)");
    files[CALL_SETTINGS_FILE] = settingsText;
  }
  files["manifest.json"] = renderManifest(manifest);
  const hashes: Record<string, string> = {};
  for (const [name, text] of Object.entries(files)) hashes[name] = await sha256Hex(text);
  const frozen = ["prompts/T1.txt", "prompts/T2.txt", "schema-T1.json", "schema-T2.json", "manifest.json"];
  for (const [name, text] of Object.entries(files)) if (name !== "manifest.json") await writeAtomic(`${a.out}/${name}`, text);
  await writeAtomic(`${a.out}/manifest.json`, files["manifest.json"]);
  await writeAtomic(`${a.out}/hashes.json`, JSON.stringify({ rule: "anomaly-bell-v1-digest", version: DIGEST_VERSION, mode: manifest.mode, files: hashes }, null, 1) + "\n");

  const voidItems = built.filter((b) => b.void);
  console.log(`items: ${built.length}, void: ${voidItems.length}; mode ${manifest.mode}`);
  for (const b of voidItems) console.log(`  void ${b.item.id} (${b.item.task} ${b.item.arm} seed ${b.item.seed}): ${b.void}`);
  console.log("twin items (first line differing from the base, relative t; U is the census at S, the first line after it is U+200):");
  const flat = built.filter((x) => x.item.arm !== "base" && !x.void && x.firstDiffT === null);
  if (flat.length) console.log(`WARNING: ${flat.length} twin item(s) are identical to their base over the whole window (kept, not void): ${flat.map((b) => b.item.id).join(", ")}`);
  for (const b of built.filter((x) => x.item.arm !== "base" && !x.void)) console.log(`  ${b.item.id} ${b.item.task} ${b.item.arm} seed ${b.item.seed}: U=${b.item.U} firstDiffT=${b.firstDiffT}`);
  if (settingsText === null) console.log("WARNING (pilot): no --call-settings: the model id and its settings are not frozen (a production build refuses this)");
  for (const f of settingsText === null ? frozen : [...frozen, CALL_SETTINGS_FILE]) console.log(`sha256 ${f} ${hashes[f]}`);
  console.log(`written: ${a.out}`);
}

// ---------------------------------------------------------------------------------------------
// score.

async function score() {
  if (!a.manifest || !a.answers) throw new Error("score needs --manifest <dir> and --answers <dir>");
  const recordPath = a.record ?? `${a.answers}/score.json`;
  if (!a.force && (await readOrNull(recordPath)) !== null) throw new Error(`STOP: ${recordPath} exists (--force to replace it, or choose another --record)`);
  const hj = JSON.parse(await Deno.readTextFile(`${a.manifest}/hashes.json`));
  for (const [name, want] of Object.entries(hj.files as Record<string, string>)) {
    const got = await sha256Hex(await Deno.readTextFile(`${a.manifest}/${name}`));
    if (got !== want) throw new Error(`STOP: ${name} has changed since the manifest was frozen (sha256 ${got}, hashes.json says ${want}); a change after the freeze voids the run`);
  }
  const manifest: Manifest = JSON.parse(await Deno.readTextFile(`${a.manifest}/manifest.json`));
  if (manifest.mode === "pilot" && !pilot) throw new Error("this is a pilot manifest; pass --pilot <root> (test only)");
  if (manifest.mode === "production" && pilot) throw new Error("--pilot is for a pilot manifest");
  if (manifest.mode === "production" && !manifest.twinRecord) throw new Error("STOP: this production manifest names no twin record (built before the twin-record gate); build it again");
  // Without frozen call settings (production) the record is written, but nothing is called.
  const freeze = callSettingsProblem(manifest.mode, Object.keys(hj.files));
  const wsteps = manifest.windowSteps;
  const texts = new Map<string, string>();
  const outcomes = new Map<string, Outcome>();
  for (const it of manifest.items) {
    if (it.void || !it.file) continue;
    const text = await Deno.readTextFile(`${a.manifest}/${it.file}`);
    if ((await sha256Hex(text)) !== it.digestSha256) throw new Error(`STOP: ${it.file} does not match the manifest's digest hash`);
    texts.set(it.id, text);
    const reply = (await readOrNull(`${a.answers}/${it.id}.json`)) ?? (await readOrNull(`${a.answers}/${it.id}.txt`));
    outcomes.set(it.id, parseAnswer(reply, it.task, wsteps));
  }
  // The twin record: the T1 comparator reads it, and a twin it marks void is void for the model's scoring too.
  let t1Code: unknown = { available: false, called: false, reason: "no twin record" };
  let items: ManifestItem[] = manifest.items;
  const pairText = await readOrNull(a["pair-record"]!);
  if (pairText !== null) {
    // The record that decided which items are void is the record the comparator reads: a different file is a stop.
    const pairSha = await sha256Hex(pairText);
    if (manifest.twinRecord && manifest.twinRecord.sha256 !== pairSha) {
      throw new Error(`STOP: ${a["pair-record"]} (sha256 ${pairSha}) is not the twin record the manifest was built from (${manifest.twinRecord.path}, sha256 ${manifest.twinRecord.sha256}); pass the right --pair-record`);
    }
    try {
      const json = JSON.parse(pairText);
      const bad = twinRecordProblem(manifest.mode, json);
      if (bad) throw new Error(bad);
      const rec = readPairRecord(json);
      items = manifest.items.map((i) => (!i.void && i.arm !== "base" && rec.voids.includes(`${i.arm}-${i.seed}`) ? { ...i, void: `void in the twin bell's record (${i.arm}-${i.seed})` } : i));
      const c = t1Comparator(items, rec);
      t1Code = { available: true, record: a["pair-record"], recordSha256: pairSha, zStarPair: rec.zStar, zStarCalled: rec.called, ...(freeze ? withholdComparator(c, freeze) : c) };
    } catch (e) {
      t1Code = { available: false, called: false, reason: (e as Error).message };
    }
  }
  const scoreModel = (t: "T1" | "T2") => (freeze ? withhold(scoreTask(t, items, outcomes), freeze) : scoreTask(t, items, outcomes));
  const model = { T1: scoreModel("T1"), T2: scoreModel("T2") };

  // Receipts (reported, not scored). A note whose measure is not a digest column (or that quotes no number, or names no line) is unchecked.
  const receipts = { checked: 0, tOk: 0, measureOk: 0, valuesOk: 0, valuesChecked: 0, unchecked: { "no number": 0, "unknown measure": 0, "no line at t": 0 } };
  for (const [id, o] of outcomes) {
    if (o.status !== "ok") continue;
    for (const n of o.answer.notes) {
      const r = checkReceipt(n, texts.get(id)!);
      receipts.checked++;
      if (r.tOk) receipts.tOk++;
      if (r.measureOk) receipts.measureOk++;
      if (r.unchecked) receipts.unchecked[r.unchecked]++;
      if (r.valuesOk !== null) {
        receipts.valuesChecked++;
        if (r.valuesOk) receipts.valuesOk++;
      }
    }
  }

  // T2 code baseline.
  let t2Code: unknown = { available: false, reason: "pass --runs and --base (or --pilot) to compute it" };
  let t2CodeScore: TaskScore | null = null;
  if (pilot || (a.runs && a.base)) {
    const planned: PlannedItem[] = manifest.items.filter((i) => i.task === "T2").map((i) => ({ id: i.id, task: i.task, seed: i.seed, arm: i.arm, U: i.U }));
    const live = planned.filter((p) => !manifest.items.find((i) => i.id === p.id)!.void);
    const { lo, hi } = rangeOf(planned);
    const refs: RunRef[] = layout.seeds.map((seed) => ({ kind: "base", seed }));
    for (const p of live) refs.push(itemRun(p));
    console.log(`T2 code baseline: reading ${new Set(refs.map(refKey)).size} runs`);
    const tables = await loadAll(refs, lo, hi, false);
    const table = (r: RunRef): RunTable => {
      const t = tables.get(refKey(r));
      if (!t || "void" in t) throw new Error(`${refKey(r)} is unusable`);
      return t.table;
    };
    const wins = planned.map((p) => {
      const isLive = live.includes(p);
      return { id: p.id, arm: p.arm, w: isLive ? t2Windows(table(itemRun(p)), layout.refsOf(p).map(table), windowStart(layout, p), wsteps) : null };
    });
    const base = codeBaselineT2(wins);
    const codeOutcomes = new Map<string, Outcome>([...base.decisions].map(([id, d]) => [id, decisionOutcome(d)]));
    t2CodeScore = scoreTask("T2", items, codeOutcomes);
    if (freeze) t2CodeScore = withhold(t2CodeScore, freeze);
    t2Code = { available: base.Z !== null, Z_T2: base.Z, reason: base.reason, D: Object.fromEntries([...base.decisions].map(([id, d]) => [id, d])), score: t2CodeScore };
  }

  const record = {
    rule: "anomaly-bell-v1-digest-score",
    version: DIGEST_VERSION,
    mode: manifest.mode,
    complete: freeze === null && model.T1.called && model.T2.called,
    ...(freeze ? { notCalled: freeze } : {}),
    note: "the model's and the code's results sit beside each other and are never pooled; the code's false alarms on the bases are 0 by construction (calibration), its comparative figure is on the nudge and nudge2 items",
    hashes: hj.files,
    callSettingsFrozen: CALL_SETTINGS_FILE in hj.files,
    orientation: orientationReport(manifest.items),
    model,
    receipts,
    codeT1: t1Code,
    codeT2: t2Code,
  };
  await writeAtomic(recordPath, JSON.stringify(record, null, 1) + "\n");

  const f = (c: { k: number; n: number }) => `${c.k}/${c.n}`;
  for (const t of ["T1", "T2"] as const) {
    const s = model[t];
    console.log(`${t} (model): ${s.called ? (s.bars!.met ? "bar met" : "bar missed") : `not called (${s.reason})`}; hits ${f(s.hits)}, false alarms ${f(s.falseAlarms)} ${JSON.stringify(s.falseAlarms.byClass)}, L64 hits ${f(s.l64)}, kinds on hits ${JSON.stringify(s.kinds)}, invalid or missing ${s.invalidOrMissing}`);
  }
  if (t2CodeScore) console.log(`T2 (code, Z_T2 ${(t2Code as { Z_T2: number | null }).Z_T2}): hits ${f(t2CodeScore.hits)}, false alarms ${f(t2CodeScore.falseAlarms)} ${JSON.stringify(t2CodeScore.falseAlarms.byClass)} (bases 0 by construction)`);
  const c1 = t1Code as { available: boolean; called?: boolean; positives?: { k: number; n: number }; reason?: string };
  console.log(`T1 (code, detection only): ${c1.available ? (c1.called ? `hits ${f(c1.positives!)}` : `withheld (${c1.reason})`) : `not available (${c1.reason})`}`);
  const o = orientationReport(manifest.items);
  console.log(`T1 orientation: twin is X on ${f(o.allTwinIsX)} items, ${f(o.positivesTwinIsX)} scored positives; an always-"yes, X" answerer would hit ${f(o.alwaysYesX.hits)} and false-alarm ${f(o.alwaysYesX.falseAlarms)}`);
  if (freeze) console.log(`NOT CALLED: ${freeze}`);
  else if (!(CALL_SETTINGS_FILE in hj.files)) console.log("WARNING (pilot): the model id and settings were not frozen with the manifest (no call-settings.json in hashes.json)");
  console.log(`receipts: ${JSON.stringify(receipts)}`);
  console.log(`record: ${recordPath}`);
}

await (cmd === "build" ? build() : score());
