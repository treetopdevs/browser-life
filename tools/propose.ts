// The experiment proposer, v0: the AI naturalist's shape 3 in its code baseline (docs/naturalist-proposer-v0-2026-10-18.md). No model
// is called; fixed rules turn each ring of a field notebook into a run spec, and nothing runs without a person's yes.
//
//   deno run -A tools/propose.ts propose  <bundle> --notes <notes.json> --out <dir>
//   deno run -A tools/propose.ts baseline <bundle> --notes <notes.json> --proposals <dir> --seed <n> --out <dir>
//   deno run -A tools/propose.ts approve  <file.proposal.json> --by "<a person's name>"
//   deno run -A tools/propose.ts run      <file.proposal.json> --out <dir> [--print]
//
// propose   reads the bundle (tools/run.ts output, the one the notes file was written from) and the notes file (tools/notebook.ts's
//           .notes.json), checks that the notes describe this bundle (run id, presetIdentity, steps, cadence, the three files'
//           byte sizes) and that v0 can fork it, and writes one <id>.proposal.json per ring with status "proposed": a fork from the
//           last recoverable step before the ring's receipt ended (a checkpoint whose stateHash matches, or step 0, whose rebuilt
//           start world must match initHash), the rules table's intervention on the jar disc at that step, 20,000 steps after it,
//           a reason citing the receipt and giving the intervention's size, and a prediction. Skipped rings are printed with their
//           reasons; a ring whose run spec an earlier ring already has is recorded on that proposal (alsoAnswers). An existing file
//           is never overwritten (an identical one is left as it is).
// baseline  one random fork per proposal in --proposals that has an intervention: same fork step, length and entry count (not the
//           same dose), entries drawn by mulberry32 seeded from SHA-256("<seed>:<matched spec's SHA-256>"), so the same seed always
//           gives the same draws wherever the files sit.
// approve   a person's yes: re-validates the proposal (every field re-derived from its ring, fork and source), then re-derives it
//           from the files it names (the bundle at its real path with the recorded manifest, the notes file with the recorded SHA-256:
//           the rules must give this exact body, or this seed's draw of the proposal it matches), refuses a file inside a runs tree
//           or the bundle (by the file's real path, the run key from the source's manifest), sets status "approved" with {by, at,
//           bodySha256}, and prints the reason and prediction it approved. Agents never run it.
// run       refuses unless approved, the approval binds this exact body, the body re-validates, the source manifest is unchanged,
//           the fork point re-checks (the checkpoint's hash and the runner's continuationError) and the body re-derives from its files
//           as at approve; then runs the stored tools/run.ts command with --out <dir>/<id> (from the repository root), checks that the
//           fork bundle starts at C (from step 0, at the source's initHash) and the source manifest did not change during the run,
//           and that the fork's series.jsonl equals the source's at every census in (C, replayThrough] (S for a rules proposal, a
//           random fork's first entry), and writes proposal.json and run-receipt.json beside the fork. --print does every check,
//           prints the command and runs nothing.
//
// --out is required and refused inside the repository's runs/, the runs tree holding the source, and the source bundle.
// Exit codes: 0 done; 2 a refusal (bad input, a failed check, not approved), before anything is written or run; 4 the fork did
// not replay the source's history up to replayThrough, or its bundle is not the fork the proposal names; a failing tools/run.ts
// exits with its own code.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runId } from "@bl/runner";
import {
  RULES_V0,
  approve,
  bindNotesToManifest,
  bodySha256,
  parseNotes,
  parseProposal,
  randomBaseline,
  runRefusal,
  serializeProposal,
  sourceRefusal,
  validateProposal,
  validateProposalSpec,
  type Proposal,
} from "./lib/propose.ts";
import { finishInput, finishRun, forkPointError, guardOut, initError, loadSource, proposalsFor, readNotesFile, rederive, writeAtomic } from "./lib/propose-fs.ts";

const REPO = fileURLToPath(new URL("..", import.meta.url));

class Refusal extends Error {}
const refuse = (msg: string): never => {
  throw new Refusal(msg);
};

const parse = () =>
  parseArgs(Deno.args, {
    string: ["notes", "out", "proposals", "seed", "by"],
    boolean: ["print"],
    unknown: (arg) => {
      if (arg.startsWith("-")) refuse(`unknown flag ${arg}`);
      return true;
    },
  });
let a: ReturnType<typeof parse>;

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
const positional = (n: number, usage: string): string[] => {
  const args = a._.slice(1).map(String);
  if (args.length !== n) refuse(`usage: ${usage}`);
  return args;
};
const needFlag = (k: "notes" | "out" | "proposals" | "seed" | "by"): string => {
  const v = a[k];
  if (v === undefined || v === "") refuse(`--${k} is required`);
  return v!;
};

/** The source and notes, checked (refusal, initHash, parse, binding), and --out guarded. */
async function sourceAndNotes(bundle: string, notesPath: string, out: string) {
  const src = await loadSource(bundle).catch((e) => refuse((e as Error).message));
  const why = sourceRefusal(src.manifest);
  if (why) refuse(`v0 cannot fork ${bundle}: ${why}`);
  const initBad = initError(src.manifest);
  if (initBad) refuse(`step 0 of ${bundle} does not check: ${initBad}`);
  // The notes file's absolute real path, so the same file named another way gives the same proposal id (amendment 2026-10-18), and
  // its text and SHA-256 from one read of it, so the hash recorded is the hash of the text parsed.
  const notesReal = await Deno.realPath(notesPath).catch((e) => refuse(`--notes ${notesPath}: ${(e as Error).message}`));
  const read = await readNotesFile(notesReal).catch((e) => refuse(`--notes ${notesPath}: ${(e as Error).message}`));
  let notes;
  try {
    notes = parseNotes(read.text, RULES_V0);
    bindNotesToManifest(notes, src.manifest, src.sizes);
  } catch (e) {
    refuse((e as Error).message);
  }
  await guardOut(out, REPO, { dir: src.dir, given: bundle, key: src.manifest.spec }).catch((e) => refuse((e as Error).message));
  return { src, notes: notes!, notesPath: notesReal, notesSha: read.sha256 };
}

/** Writes each proposal unless its file exists (an identical one is left alone, a different one is never replaced). */
async function writeProposals(out: string, list: Proposal[]): Promise<void> {
  await Deno.mkdir(out, { recursive: true });
  for (const p of list) {
    const path = join(out, `${p.id}.proposal.json`);
    const text = serializeProposal(p);
    if (await exists(path)) {
      const had = await Deno.readTextFile(path);
      console.log(had === text ? `  unchanged ${path}` : `  kept ${path} (it exists and differs, approved or edited; not replaced)`);
      continue;
    }
    await writeAtomic(path, text);
    console.log(`  wrote ${path}`);
  }
}

async function cmdPropose(): Promise<void> {
  const [bundle] = positional(1, "propose <bundle> --notes <notes.json> --out <dir>");
  const notesPath = needFlag("notes"), out = needFlag("out");
  const { src, notes, notesPath: notesReal, notesSha } = await sourceAndNotes(bundle, notesPath, out);
  let result;
  try {
    result = await proposalsFor(src, notes, { path: notesReal, sha256: notesSha }, (msg) => console.error(`note: ${msg}`));
  } catch (e) {
    refuse((e as Error).message);
  }
  const r = result!;
  console.log(`${notes.run.id}: ${notes.rings.length} ring(s); ${r.proposals.length} proposal(s), ${r.skipped.length} skipped, ${r.duplicates.length} duplicate(s)`);
  for (const p of r.proposals) {
    const b = p.body;
    console.log(`  ${p.id}  ring ${b.ring.index} ${b.ring.signal} ${b.ring.side}: ${b.rule.action} at step ${b.interventionStep}, fork from step ${b.fork.step} (${b.fork.check}), ${b.spec.steps} steps`);
    for (const x of b.alsoAnswers ?? []) console.log(`      also answers ring ${x.index} ${x.signal} ${x.side} (its own prediction is in the file)`);
  }
  for (const s of r.skipped) console.log(`  skipped ring ${s.ring} ${s.signal} ${s.side}: ${s.reason}`);
  for (const d of r.duplicates) console.log(`  duplicate ring ${d.ring} ${d.signal} ${d.side}: the same run spec as proposal ${d.of} (recorded there under alsoAnswers)`);
  await writeProposals(out, r.proposals);
}

async function cmdBaseline(): Promise<void> {
  const [bundle] = positional(1, "baseline <bundle> --notes <notes.json> --proposals <dir> --seed <n> --out <dir>");
  const notesPath = needFlag("notes"), dir = needFlag("proposals"), out = needFlag("out"), seedText = needFlag("seed");
  if (!/^(0|[1-9]\d*)$/.test(seedText) || Number(seedText) > 0xffffffff) refuse("--seed must be an integer in 0..2^32 - 1");
  const seed = Number(seedText);
  const { src, notesSha } = await sourceAndNotes(bundle, notesPath, out);
  const names = [];
  for await (const e of Deno.readDir(dir)) if (e.isFile && e.name.endsWith(".proposal.json")) names.push(e.name);
  names.sort();
  const made: Proposal[] = [];
  let rules = 0;
  for (const name of names) {
    let p: Proposal;
    try {
      p = parseProposal(await Deno.readTextFile(join(dir, name)));
    } catch (e) {
      refuse(`${name}: ${(e as Error).message}`);
    }
    if (p!.body.generator !== "rules-v0") continue;
    rules++;
    const b = p!.body;
    if (b.source.manifestSha256 !== src.manifestSha256 || b.notes.sha256 !== notesSha) refuse(`${name} was made from another bundle or notes file`);
    const bad = validateProposal(b);
    if (bad) refuse(`${name} does not validate: ${bad}`);
    const r = randomBaseline(p!, seed);
    if (r) made.push(r);
  }
  console.log(`${rules} rules proposal(s) in ${dir}; ${made.length} random fork(s) with seed ${seed} (replay controls get none)`);
  await writeProposals(out, made);
}

async function cmdApprove(): Promise<void> {
  const [file] = positional(1, 'approve <file.proposal.json> --by "<name>"');
  const by = needFlag("by");
  // The file's real path: the guard and the write below name the same directory (a "link/.." in the path climbs from the link's target).
  const real = await Deno.realPath(file).catch((e) => refuse(`${file}: ${(e as Error).message}`));
  let p: Proposal;
  try {
    p = parseProposal(await Deno.readTextFile(real));
  } catch (e) {
    refuse((e as Error).message);
  }
  let done: Proposal;
  try {
    done = approve(p!, by, new Date().toISOString());
  } catch (e) {
    refuse((e as Error).message);
  }
  // Re-derived from the files it names (the bundle and the notes), so the yes is given to what the rules would write.
  const again = await rederive(done!);
  if (again.refusal !== undefined) refuse(`refused: the proposal does not re-derive from its files: ${again.refusal}`);
  const src = again.src!;
  // The file is rewritten in place (its temp file beside it): never inside the repository's runs/, the source's runs tree or the
  // bundle, with the run key taken from the source's own manifest.
  const b = done!.body;
  await guardOut(dirname(real), REPO, { dir: src.dir, key: src.manifest.spec }, "the proposal's directory").catch((e) => refuse((e as Error).message));
  await writeAtomic(real, serializeProposal(done!));
  console.log(`approved ${done!.id} by ${done!.approval!.by} (body ${done!.approval!.bodySha256})`);
  console.log(`  reason: ${b.reason}`);
  console.log(`  prediction: ${b.prediction.statement}`);
}

const quote = (s: string) => (/^[A-Za-z0-9_./:,=+@%-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);

async function cmdRun(): Promise<void> {
  const [file] = positional(1, "run <file.proposal.json> --out <dir> [--print]");
  const out = needFlag("out");
  const text = await Deno.readTextFile(file).catch((e) => refuse(`${file}: ${(e as Error).message}`));
  let p: Proposal;
  try {
    p = parseProposal(text);
  } catch (e) {
    refuse((e as Error).message);
  }
  const why = runRefusal(p!); // never throws: a malformed body is a refusal
  if (why) refuse(`refused: ${why}`);
  const b = p!.body;
  if (!isAbsolute(b.source.dir)) refuse(`refused: source.dir ${b.source.dir} is not an absolute path`);
  const src = await loadSource(b.source.dir).catch((e) => refuse((e as Error).message));
  if (src.manifestSha256 !== b.source.manifestSha256) refuse(`refused: the source manifest changed since the proposal (sha256 ${src.manifestSha256}, the proposal says ${b.source.manifestSha256})`);
  const srcBad = sourceRefusal(src.manifest);
  if (srcBad) refuse(`refused: ${srcBad}`);
  const specBad = validateProposalSpec(b.spec, b.fork.step, src.manifest);
  if (specBad) refuse(`refused: the spec does not fit its source: ${specBad}`);
  const forkBad = await forkPointError(src.dir, src.manifest, b.fork, b.spec);
  if (forkBad) refuse(`refused: the fork point does not re-check: ${forkBad}`);
  const again = await rederive(p!);
  if (again.refusal !== undefined) refuse(`refused: the proposal does not re-derive from its files: ${again.refusal}`);
  await guardOut(out, REPO, { dir: src.dir, key: src.manifest.spec }).catch((e) => refuse((e as Error).message));
  // Absolute: tools/run.ts runs from the repository root, and the receipt and the replay check must name the same directory.
  const target = resolve(out, p!.id);
  const argv = [...b.argv, "--out", target];
  if (a.print) {
    console.log(`# from ${REPO}`);
    console.log(argv.map(quote).join(" "));
    return;
  }
  // Claimed by a mkdir that fails when the directory exists (atomic), so two runs of one proposal into one --out never share it.
  await Deno.mkdir(dirname(target), { recursive: true });
  try {
    await Deno.mkdir(target);
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) refuse(`refused: ${target} exists; choose another --out`);
    throw e;
  }
  await writeAtomic(join(target, "proposal.json"), text);
  const startedAt = new Date().toISOString();
  console.log(`run ${p!.id}: ${argv.map(quote).join(" ")}`);
  const status = await new Deno.Command(Deno.execPath(), { args: argv.slice(1), cwd: REPO, stdin: "null", stdout: "inherit", stderr: "inherit" }).output();
  const forkDir = join(target, runId(b.spec));
  // A rules proposal replays the source up to S; a random fork only up to its first entry (body.replayThrough, re-derived by validateProposal).
  const done = await finishRun(
    finishInput(p!, { srcDir: src.dir, sourceSha256: src.manifestSha256, target, forkDir, exitCode: status.code, receipt: { proposalId: p!.id, bodySha256: bodySha256(b), approval: p!.approval, argv, cwd: REPO, startedAt, forkBundle: forkDir } }),
  );
  for (const line of done.lines) (done.exit === 0 ? console.log : console.error)(line);
  if (done.exit !== 0) Deno.exit(done.exit);
  console.log(`fork bundle: ${forkDir}`);
}

const COMMANDS: Record<string, () => Promise<void>> = { propose: cmdPropose, baseline: cmdBaseline, approve: cmdApprove, run: cmdRun };
try {
  a = parse();
  const cmd = String(a._[0] ?? "");
  const f = COMMANDS[cmd];
  if (!f) refuse(`usage: tools/propose.ts propose|baseline|approve|run ... (got ${JSON.stringify(cmd)})`);
  await f();
} catch (e) {
  if (e instanceof Refusal) {
    console.error(e.message);
    Deno.exit(2);
  }
  throw e;
}
