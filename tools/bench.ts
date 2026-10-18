// The proposer bench, v0 (docs/naturalist-bench-v0-2026-10-18.md): do the proposer's rule-based proposals (tools/propose.ts) beat a
// random fork at producing a departure, scored by bell v1's pair scorer? A pre-registered plan first; nothing runs without one
// person's yes for the whole batch. No model is called, nothing is written under runs/.
//
//   deno run -A tools/bench.ts plan    --base <runs> --notes <notes dir> --out <manifest.json> [--pairs 10]
//   deno run -A tools/bench.ts dry-run <manifest.json> [--out <dir>]
//   deno run -A tools/bench.ts approve <manifest.json> --by "<a person's name>"
//   deno run -A tools/bench.ts run     <manifest.json> [--out <dir>] [--jobs 3] [--max-minutes 240]
//   deno run -A tools/bench.ts score   <manifest.json> [--out <dir>] --record <record.json>
//
// A manifest of fewer than ten pairs (a test fixture's) is refused by dry-run, approve, run and score unless --pairs names its size.
//
// plan     the sources by the fixed rule (<base>/replay-m4/gradient-m3/treatment/seed-1..10, and no others), each one's notes file
//          (<notes>/replay-m4-gradient-m3-treatment-seed-<n>.notes.json, written by the one tools/notebook.ts command the manifest
//          records), the proposer's proposals for each, and per source: the first proposal that is not a replay control (rules),
//          its random-v0 forks with seeds 1, 2, 3 (count) and its dose-v0 forks with seeds 1, 2, 3 (dose). Writes the manifest
//          (status "planned"): every entry's id, spec, spec SHA-256 and tools/run.ts command, and the totals. Refuses, writing
//          nothing, when any source gives no feed, drain or lesion proposal. An existing file is never replaced (an identical one is
//          left as it is). --pairs is for test fixtures; the bars are called only at 10, and the notes directory must lie outside
//          the repository and every runs tree.
// dry-run  validates every entry's spec with the proposer's validators (the runner's validateInterventions, specConfig,
//          interventionsError, validateSpec), re-derives the whole plan from its files, and prints every exact command and the total
//          steps. Runs nothing, writes nothing.
// approve  a person's yes for the whole batch: checks the name (the proposer's isPersonName), re-derives the plan from its files byte
//          for byte, and writes status "approved" with {by, at, manifestSha256}. Agents never run it.
// run      refuses unless approved, the approval binds this exact body, and the body re-derives from its files and this checkout's
//          versions; then runs each fork into <out>/<id>/ (default $HOME/browser-life-bench/<first 16 hex of the manifest SHA-256>),
//          three at a time, starting none after --max-minutes; an entry whose receipt has exit 0 is skipped (resume), any other
//          entry directory is refused by name. Each fork is replay- and identity-checked as tools/propose.ts run checks one.
// score    on an approved manifest with a receipt for every entry: the readout (bell v1's pair score per fork, the paired sign tests,
//          the reading, the predictions), written once to --record (refused if it exists).
//
// --out (and the manifest's and the record's directories) are refused inside the repository's runs/, the runs tree holding the
// sources, and any source bundle. Each command takes only its own flags (above); any other is refused. Exit codes: 0 done; 2 a
// refusal (bad input, a failed check, not approved), before anything is written or run; 3 run stopped at the time cap with forks
// not started (run it again to resume); 4 a fork failed (its receipt says why) or an entry hit a file-system error (named).
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BENCH_V0,
  approveManifest,
  chipOf,
  bodyProblems,
  defaultOut,
  dryRunLines,
  pairsRefusal,
  parseManifest,
  plannedManifest,
  serializeManifest,
  type BenchManifest,
} from "./lib/bench.ts";
import { BenchRefusal, guardOutAll, planFromDisk, publishOnce, rederiveBench, replaceIfUnchanged, runBench, scoreBench } from "./lib/bench-fs.ts";
import { denoExec } from "./lib/bench-exec.ts";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));

const refuse = (msg: string): never => {
  throw new BenchRefusal(msg);
};
const STRINGS = ["base", "notes", "out", "by", "pairs", "jobs", "max-minutes", "record"] as const;
const parse = () =>
  parseArgs(Deno.args, {
    string: [...STRINGS],
    unknown: (arg) => {
      if (arg.startsWith("-")) refuse(`unknown flag ${arg}`);
      return true;
    },
  });
let a: ReturnType<typeof parse>;

/** The flags each command reads; any other given to it is refused, so a flag never silently does nothing (`run --by` is not an approval). */
const FLAGS: Record<string, readonly (typeof STRINGS)[number][]> = {
  plan: ["base", "notes", "out", "pairs"],
  "dry-run": ["out", "pairs"],
  approve: ["by", "pairs"],
  run: ["out", "jobs", "max-minutes", "pairs"],
  score: ["out", "record", "pairs"],
};
const onlyFlags = (cmd: string) => {
  const bad = STRINGS.filter((k) => a[k] !== undefined && !FLAGS[cmd].includes(k));
  if (bad.length) refuse(`${cmd} takes no ${bad.map((k) => `--${k}`).join(", ")}${bad.includes("by") ? " (only approve records a yes)" : ""}`);
};
const positional = (n: number, usage: string): string[] => {
  const args = a._.slice(1).map(String);
  if (args.length !== n) refuse(`usage: ${usage}`);
  return args;
};
const needFlag = (k: (typeof STRINGS)[number]): string => {
  const v = a[k];
  if (v === undefined || v === "") refuse(`--${k} is required`);
  return v!;
};
const intFlag = (k: (typeof STRINGS)[number], def: number, min = 1): number => {
  const v = a[k];
  if (v === undefined) return def;
  if (!/^(0|[1-9]\d*)$/.test(v) || Number(v) < min) refuse(`--${k} must be an integer >= ${min}`);
  return Number(v);
};
async function exists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
async function readManifest(file: string): Promise<{ real: string; text: string; m: BenchManifest }> {
  const real = await Deno.realPath(file).catch((e) => refuse(`${file}: ${(e as Error).message}`));
  const text = await Deno.readTextFile(real);
  let m: BenchManifest;
  try {
    m = parseManifest(text);
  } catch (e) {
    refuse((e as Error).message);
  }
  return { real, text, m: m! };
}
const outFor = (m: BenchManifest): string => {
  if (a.out !== undefined && a.out !== "") return resolve(a.out);
  const home = Deno.env.get("HOME");
  if (!home) refuse("HOME is not set; pass --out");
  return defaultOut(home!, m.manifestSha256);
};

async function cmdPlan(): Promise<void> {
  positional(0, "plan --base <runs> --notes <notes dir> --out <manifest.json> [--pairs 10]");
  const base = needFlag("base"), notes = needFlag("notes"), out = resolve(needFlag("out"));
  const pairs = intFlag("pairs", BENCH_V0.pairs);
  const { body } = await planFromDisk({ base, notesDir: notes }, { ...BENCH_V0, pairs });
  await guardOutAll(dirname(out), REPO, body, "the manifest's directory");
  const m = plannedManifest(body), text = serializeManifest(m);
  for (const s of body.sources) {
    const r = body.entries.find((e) => e.role === "rules" && e.source === body.sources.indexOf(s))!;
    console.log(`  ${s.runId}: proposal ${s.proposalId}, ring ${s.ring.index} ${s.ring.signal} ${s.ring.side} → ${s.action} at step ${r.S}, fork from step ${r.C}, ${r.steps} steps`);
  }
  console.log(`${body.totals.forks} forks, ${body.totals.steps} steps; manifest ${m.manifestSha256}`);
  if (await exists(out)) {
    const had = await Deno.readTextFile(out);
    if (had === text) {
      console.log(`unchanged ${out}`);
      return;
    }
    refuse(`refused: ${out} exists and differs (approved, edited, or another plan); it is never replaced`);
  }
  await Deno.mkdir(dirname(out), { recursive: true });
  // Published without replacing: a manifest another planner wrote (and someone approved) meanwhile is never overwritten (amendment 2).
  if ((await publishOnce(out, text, `${out} (approved, edited, or another plan)`)) === "unchanged") {
    console.log(`unchanged ${out}`);
    return;
  }
  console.log(`wrote ${out} (status planned; a person approves it with tools/bench.ts approve ${out} --by "<name>")`);
}

async function cmdDryRun(): Promise<void> {
  const [file] = positional(1, "dry-run <manifest.json> [--out <dir>]");
  const real = await Deno.realPath(file).catch((e) => refuse(`${file}: ${(e as Error).message}`));
  const text = await Deno.readTextFile(real);
  // Every entry is validated first, so a hand-edited spec is named by its entry before the hash says the body changed.
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    refuse(`manifest: not JSON (${(e as Error).message})`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) refuse("manifest: not a JSON object");
  const rawBody = (raw as { body?: unknown }).body;
  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) refuse("manifest: no body");
  const probs = bodyProblems(rawBody as BenchManifest["body"]);
  const pr = pairsRefusal(rawBody as BenchManifest["body"], intFlag("pairs", BENCH_V0.pairs));
  if (pr) probs.unshift(pr);
  if (probs.length) refuse(`refused: ${probs.length} problem(s):\n  ${probs.join("\n  ")}`);
  let m: BenchManifest;
  try {
    m = parseManifest(text);
  } catch (e) {
    refuse((e as Error).message);
  }
  const again = await rederiveBench(m!.body);
  if (again.refusal !== undefined) refuse(`refused: ${again.refusal}`);
  const out = outFor(m!);
  await guardOutAll(out, REPO, m!.body);
  console.log(`# manifest ${m!.manifestSha256} (${m!.status}); every spec validates and the plan re-derives from its files; nothing is run`);
  console.log(`# from ${REPO}`);
  for (const line of dryRunLines(m!.body, out)) console.log(line);
}

async function cmdApprove(): Promise<void> {
  const [file] = positional(1, 'approve <manifest.json> --by "<name>"');
  const by = needFlag("by");
  const { real, text, m } = await readManifest(file);
  let done: BenchManifest;
  try {
    done = approveManifest(m, by, new Date().toISOString(), intFlag("pairs", BENCH_V0.pairs));
  } catch (e) {
    refuse((e as Error).message);
  }
  const again = await rederiveBench(m.body);
  if (again.refusal !== undefined) refuse(`refused: the plan does not re-derive from its files: ${again.refusal}`);
  await guardOutAll(dirname(real), REPO, m.body, "the manifest's directory");
  // The file must still be the one checked: an approval or edit written meanwhile is not replaced by this one (amendment 2), and two
  // approvals at once are serialised by a lock beside the file, so one is written and the other refused (Codex pass 3).
  await replaceIfUnchanged(real, text, serializeManifest(done!));
  console.log(`approved ${done!.manifestSha256} by ${done!.approval!.by}: ${m.body.totals.forks} forks, ${m.body.totals.steps} steps`);
}

async function cmdRun(): Promise<void> {
  const [file] = positional(1, "run <manifest.json> [--out <dir>] [--jobs 3] [--max-minutes 240]");
  const { m } = await readManifest(file);
  const jobs = intFlag("jobs", 3), maxMinutes = intFlag("max-minutes", 240);
  const out = outFor(m);
  const r = await runBench(m, { out, repo: REPO, jobs, maxMinutes, exec: denoExec, pairs: intFlag("pairs", BENCH_V0.pairs), log: (l) => console.log(l) });
  const failed = r.finished.filter((f) => f.exit !== 0);
  console.log(`${r.out}: ${r.skipped.length} already done, ${r.finished.length} run now (${failed.length} failed), ${r.errors.length} hit an error, ${r.notStarted.length} not started${r.capped ? ` (the ${maxMinutes}-minute cap; run again to resume)` : ""}`);
  for (const e of r.errors) console.log(`  error ${e.id}: ${e.error}`);
  if (failed.length || r.errors.length) {
    console.log(`a failed fork's directory, or one an error left without a receipt, is refused by the next run until it is moved aside (for example into ${resolve(r.out, "aside")}/); the next run then re-runs it from the start`);
    Deno.exit(4);
  }
  if (r.notStarted.length) Deno.exit(3);
}

async function cmdScore(): Promise<void> {
  const [file] = positional(1, "score <manifest.json> [--out <dir>] --record <record.json>");
  const record = resolve(needFlag("record"));
  const { m } = await readManifest(file);
  if (await exists(record)) refuse(`refused: ${record} exists; the record is written once`);
  await guardOutAll(dirname(record), REPO, m.body, "the record's directory");
  const rec = await scoreBench(m, { out: outFor(m), pairs: intFlag("pairs", BENCH_V0.pairs) });
  await Deno.mkdir(dirname(record), { recursive: true });
  // Written once: a complete temp file is hard-linked into place, which fails if the record appeared meanwhile (another scorer).
  const tmp = `${record}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmp, JSON.stringify(rec, null, 1) + "\n");
  try {
    await Deno.link(tmp, record);
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) refuse(`refused: ${record} appeared while scoring; the record is written once`);
    throw e;
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
  const s = rec.summary;
  console.log(`proposer bench v0: ${s.forks.valid} of ${s.forks.total} forks valid`);
  for (const c of [s.count, s.dose]) console.log(`  ${c.role}: ${c.wins} wins, ${c.losses} losses, ${c.ties} ties, ${c.voids} void; ${c.called ? (c.rulesBeat ? "rules beat it" : c.baselineBeats ? "it beats the rules" : "no call either way") : `not called (${c.notCalledReason})`}`);
  console.log(`  reading: ${s.reading} [${chipOf(s.reading)}]${s.readingNote ? ` (${s.readingNote})` : ""}${s.baselineBeats.length ? `; ${s.baselineBeats.join("; ")}` : ""}`);
  if (s.reruns.length) console.log(`  re-run after a failure: ${s.reruns.map((x) => `${x.id} (${x.launches} launches)`).join(", ")}`);
  console.log(`  predictions: ${s.predictions.held} of ${s.predictions.decided} decided hold (${s.predictions.of} stated)`);
  console.log(`wrote ${record}`);
}

const COMMANDS: Record<string, () => Promise<void>> = { plan: cmdPlan, "dry-run": cmdDryRun, approve: cmdApprove, run: cmdRun, score: cmdScore };
try {
  a = parse();
  const cmd = String(a._[0] ?? "");
  const f = COMMANDS[cmd];
  if (!f) refuse(`usage: tools/bench.ts plan|dry-run|approve|run|score ... (got ${JSON.stringify(cmd)})`);
  onlyFlags(cmd);
  await f();
} catch (e) {
  if (e instanceof BenchRefusal) {
    console.error(e.message);
    Deno.exit(2);
  }
  throw e;
}
