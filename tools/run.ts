// Headless experiment runner on native WebGPU (Deno + wgpu).
//
//   deno run -A tools/run.ts --experiment pilot --preset spots --conditions treatment,neutral \
//     --seeds 1-3 --steps 50000 --census 100 [--deep 10] [--checkpoint 0] [--out runs] [--threshold N]
//     [--lineage-obs] [--solo-founder K | --solo-genome HEX | --founder-set HEX,HEX,...] [--pre-cycle B,B,...]
//     [--override mutRate=0,pondDeath=65536] [--branch-from DIR --branch-boundary B]
//     [--picker rule|random|file|command] [--pick-seed N] [--pick-dir DIR] [--pick-cmd '["argv","..."]'] [--pick-timeout SEC]
//     [--pick-label NAME] [--picks-from FILE] [--verify-against DIR]
//
// --lineage-obs adds the foundations-review observer files (RunSpec.lineageObs); --solo-founder K
// founds an m3 preset from M3 founder K alone (RunSpec.soloFounder), --solo-genome from a genome given
// as genomes.tsv hex words (RunSpec.soloGenome), --founder-set from a comma-separated list of those
// hexes cycled across founder discs (RunSpec.founderSet). --pre-cycle 34,100 (pond presets) also
// writes the state before each listed boundary's cycle to checkpoints/b<NNN>-pre.blck, with its hash
// in the manifest (RunSpec.preCycleCheckpoints); without it the bundle is as before.
//
// --override sets RunSpec.overrides from a comma list of key=integer, the keys mutRate and pondDeath only: the
// transition hunt's D3 runs (--override mutRate=0) and G1 fallback (e = 1, --override pondDeath=65536, for the
// conditions pond-nat and pond-shuf, whose own pondDeath it replaces). Without it the spec has no overrides.
// --branch-from DIR --branch-boundary B (both, with --conditions pond-nat or pond-shuf) starts each run from the
// pre-cycle checkpoint of boundary B in the bundle at DIR (its manifest's preCycleCheckpoints entry, whose hash the
// file must match) and applies that boundary's transform under the run's own seed first (RunSpec.branch, the hunt's
// "Branch contract"); --steps then counts from the source's step, and --pre-cycle may list only boundaries after B.
// Every seed of the invocation branches from the same source.
//
// Each (condition, seed) history writes a bundle to <out>/<experiment>/<preset>/<condition>/seed-<n>/.
//
// Picked runs (wild sandbox; packages/runner/src/picks.ts): on a pond preset whose arm chooses donors (scaf, rand or breed),
// --picker takes the donors of every pond boundary from a picker instead of the arm's rule (RunSpec.picked):
//   rule      the arm's own donors: the run equals the unpicked one, bit for bit
//   random    seeded (--pick-seed, default the run's seed), uniform over the ponds able to found a pond, the rule's count
//   file      writes b<NNN>-request.json and b<NNN>-sheet.png into --pick-dir (default <bundle>/picker), then waits up to
//             --pick-timeout seconds (default 900) for the file the request's `answer` names, b<NNN>-picks-<nonce>.json (one
//             per request; {"donors":[...]}, written and renamed into place; a file without the request's nonce must be newer
//             than the request)
//   command   the same files, then runs --pick-cmd (a JSON argv array; cwd = the pick directory) with the request JSON on
//             stdin and takes {"donors":[...]} from stdout; --pick-timeout defaults to 180, the command and its descendants
//             are ended at the deadline, and more than 1 MiB on stdout or stderr fails the pick
// One (condition, seed) per invocation. The bundle goes to <experiment>/<preset>/<condition>-by-<label>/seed-<n>/ (label:
// --pick-label, default the picker's name, "replay" without one), so a picked run never lands in a rule-bred run's directory and
// tools/breed.ts reads it by that name. Besides the usual files it writes picks.jsonl (one line per pond boundary: step, kind, cycle,
// donors, by, suggested), and the manifest carries spec.picked and a picks block. A failure at a boundary (a picker that errors,
// times out or answers badly) stops the run there with the world unchanged and exits 3; nothing falls back to the rule.
// A pick directory belongs to one run (its owner.json names the bundle directory): another run pointed at it is refused (exit 2),
// so one run's notebook, album and applied records never pass for another's.
//   --picks-from FILE   replay recorded donors: a picks.jsonl, or a lab run manifest (<runId>.run.json from lab storage; its pick
//                       interventions, a boundary without one takes the rule's donors; lesions, feeds or edgesFrom > 0 are refused).
//                       Alone it is an exact replay (same final hash and ponds.tsv); with --picker the record wins where it has an
//                       entry and the picker answers the rest. A lab replay reproduces the physics, not the lab's observer settings,
//                       so summary.finalHash can differ from the lab's.
//   --verify-against DIR  compare this run's final hash and ponds.tsv bytes with the bundle at DIR: prints identical, or exits 4.
// Recovery after a failure: re-run the same command with --picks-from <failed bundle>/picks.jsonl: recorded boundaries replay,
// only the missing ones are asked. The record replayed is every boundary that --picks-from, picks.jsonl and picks.recovery.jsonl
// hold between them (they must agree where they overlap); it is written to picks.recovery.jsonl first, as pick lines whatever the
// source's format, then checkpoints/ is cleared; picker/ is kept.
// A log cut mid-record by a crash is used up to its last complete line (the original stays as picks.jsonl.torn); any other damage to
// the bundle's logs, or two logs (--picks-from, picks.jsonl, picks.recovery.jsonl) that disagree at a step, refuses the recovery (exit 2)
// before anything is copied, cleared or truncated. Replaying a log rewrites it with `by: "recorded"`: what replay reproduces is the
// state, ponds.tsv and each boundary's step, cycle and donors, not the original `by` and `suggested` fields.
// A picked run cannot resume from a checkpoint, be segmented or run on an island. Exit codes: 2 invalid spec or flags (before any
// GPU work), 3 a pick failed, 4 a verification mismatch.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { PRESETS, RULE_VERSION, validateConfig, type WorldConfig, type WorldState } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import {
  PICKS_FILE,
  PickError,
  branchError,
  parseOverrides,
  mergePickLogs,
  parsePickLogPrefix,
  pickLogsConflict,
  pickedConfigError,
  picksConsistencyError,
  picksFromManifest,
  picksPreflightError,
  preCycleError,
  runExperiment,
  runId,
  sameCompletedRun,
  sameConfig,
  specConfig,
  validateSpec,
  type BranchSpec,
  type PickEntry,
  type Picker,
  type RunSpec,
  type Sink,
} from "@bl/runner";
import { branchFlagsError, branchSource } from "./lib/branch-source.ts";
import { claimPickDir, commandAnswerer, denoIo, denoRun, dirPicker, fileAnswerer, pickDirTaken, randomPicker, rulePicker } from "./lib/pickers.ts";

const a = parseArgs(Deno.args, {
  string: ["experiment", "preset", "conditions", "seeds", "out", "steps", "census", "deep", "checkpoint", "threshold", "solo-founder", "solo-genome", "founder-set", "pre-cycle", "override", "branch-from", "branch-boundary", "picker", "pick-seed", "pick-dir", "pick-cmd", "pick-timeout", "pick-label", "picks-from", "verify-against"],
  boolean: ["lineage-obs"],
  default: { experiment: "pilot", preset: "spots", conditions: "treatment", seeds: "1", out: "runs", steps: "20000", census: "100", deep: "10", checkpoint: "0" },
});

function seeds(s: string): number[] {
  return s.split(",").flatMap((part) => {
    const [lo, hi] = part.split("-").map(Number);
    return hi === undefined ? [lo] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  });
}

function fsSink(dir: string): Sink {
  const p = (f: string) => `${dir}/${f}`;
  return {
    async writeText(f, t) {
      await Deno.mkdir(p(f).replace(/\/[^/]+$/, ""), { recursive: true });
      await Deno.writeTextFile(p(f), t);
    },
    async appendText(f, t) {
      await Deno.writeTextFile(p(f), t, { append: true });
    },
    async writeBytes(f, b) {
      await Deno.mkdir(p(f).replace(/\/[^/]+$/, ""), { recursive: true });
      await Deno.writeFile(p(f), b);
    },
  };
}

const unpaired = branchFlagsError(a["branch-from"], a["branch-boundary"]);
if (unpaired) {
  console.error(unpaired);
  Deno.exit(2);
}
let overrides: RunSpec["overrides"];
let source: { branch: BranchSpec; state: WorldState } | undefined;
try {
  if (a.override !== undefined) overrides = parseOverrides(a.override);
  if (a["branch-from"] !== undefined) source = await branchSource(a["branch-from"], Number(a["branch-boundary"]));
} catch (e) {
  console.error((e as Error).message);
  Deno.exit(2);
}

const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
const info = adapter?.info;
const adapterDesc = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" ") || "unknown";
const specs: RunSpec[] = [];
for (const condition of a.conditions.split(","))
  for (const seed of seeds(a.seeds))
    specs.push({
      experiment: a.experiment,
      presetId: a.preset,
      condition,
      seed,
      steps: Number(a.steps),
      censusEvery: Number(a.census),
      deepEvery: Number(a.deep),
      checkpointEvery: Number(a.checkpoint),
      activityThreshold: a.threshold ? Number(a.threshold) : undefined,
      ...(a["lineage-obs"] ? { lineageObs: true } : {}),
      ...(a["solo-founder"] !== undefined ? { soloFounder: Number(a["solo-founder"]) } : {}),
      ...(a["solo-genome"] !== undefined ? { soloGenome: a["solo-genome"] } : {}),
      ...(a["founder-set"] !== undefined ? { founderSet: a["founder-set"].split(",").map((h) => h.trim()).filter(Boolean) } : {}),
      ...(a["pre-cycle"] !== undefined ? { preCycleCheckpoints: a["pre-cycle"].split(",").map((b) => Number(b.trim())) } : {}),
      ...(overrides !== undefined ? { overrides } : {}),
      ...(source ? { branch: source.branch } : {}),
    });

// ---- Picked runs (flags, record, picker), all checked before any GPU work.
const die = (msg: string): never => {
  console.error(msg);
  Deno.exit(2);
};
const PICKERS = ["rule", "random", "file", "command"];
const picking = a.picker !== undefined || a["picks-from"] !== undefined;
if (!picking) for (const k of ["pick-seed", "pick-dir", "pick-cmd", "pick-timeout", "pick-label"] as const) if (a[k] !== undefined) die(`--${k} needs --picker or --picks-from`);
if (a.picker !== undefined && !PICKERS.includes(a.picker)) die(`--picker must be one of ${PICKERS.join(", ")}`);
if (a.picker === "command" && a["pick-cmd"] === undefined) die("--picker command needs --pick-cmd '[\"argv\",\"...\"]'");
if (a.picker !== "command" && a["pick-cmd"] !== undefined) die("--pick-cmd is for --picker command");
if (a["pick-timeout"] !== undefined && !(Number(a["pick-timeout"]) > 0)) die("--pick-timeout must be a positive number of seconds");
if (a["pick-seed"] !== undefined && !Number.isInteger(Number(a["pick-seed"]))) die("--pick-seed must be an integer");
let pickArgv: string[] | undefined;
if (a["pick-cmd"] !== undefined) {
  try {
    pickArgv = JSON.parse(a["pick-cmd"]);
  } catch {
    die("--pick-cmd must be a JSON array of strings");
  }
  if (!Array.isArray(pickArgv) || pickArgv.length === 0 || !pickArgv.every((x) => typeof x === "string")) die("--pick-cmd must be a JSON array of strings");
}
const pickLabel = a["pick-label"] ?? a.picker ?? "replay";
if (!/^[a-z0-9][a-z0-9_.-]{0,31}$/.test(pickLabel) || pickLabel.includes("..")) die("--pick-label must match [a-z0-9][a-z0-9_.-]{0,31} and not contain '..'");
if (picking) {
  if (specs.length !== 1) die("a picked run takes one condition and one seed per invocation");
  const only = specs[0];
  specs[0] = { ...only, picked: true, runId: `${only.experiment}/${only.presetId}/${only.condition}-by-${pickLabel}/seed-${only.seed}` };
}
if (a["verify-against"] !== undefined && specs.length !== 1) die("--verify-against takes one run per invocation");

/** The record named by --picks-from: a picks.jsonl or a lab run manifest (then a boundary without an entry takes the rule's donors). */
let record: { entries: PickEntry[]; text?: string; implicit: boolean } | undefined;
if (a["picks-from"] !== undefined) {
  try {
    const text = await Deno.readTextFile(a["picks-from"]);
    let manifest: Record<string, unknown> | undefined;
    if (text.trimStart().startsWith("{")) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed?.interventions)) manifest = parsed;
      } catch { /* several JSON lines: a pick log */ }
    }
    if (manifest) {
      const spec = specs[0];
      const mismatches = [
        manifest.presetId !== spec.presetId && "presetId",
        manifest.seed !== spec.seed && "seed",
        manifest.ruleVersion !== RULE_VERSION && "ruleVersion",
        !sameConfig(manifest.cfg as WorldConfig, specConfig(spec)) && "cfg",
        JSON.stringify(manifest.init) !== JSON.stringify(PRESETS.find((x) => x.id === spec.presetId)?.init) && "init",
      ].filter(Boolean);
      if (mismatches.length) die(`the lab manifest does not describe this run: ${mismatches.join(", ")} differ`);
      const settings = manifest.settings as { censusEvery?: number; deepEvery?: number } | undefined;
      if (settings && (settings.censusEvery !== spec.censusEvery || settings.deepEvery !== spec.deepEvery))
        console.error(`note: the lab observed with census ${settings.censusEvery} / deep ${settings.deepEvery}, this run with ${spec.censusEvery} / ${spec.deepEvery}: the physics replays, but summary.finalHash can differ from the lab's`);
      record = { entries: picksFromManifest(manifest), implicit: true }; // no pick lines of its own: a recovery copy gets them written out
    } else {
      // A log cut mid-record by a crash is replayed up to its last complete line; any other damage is an error.
      const log = parsePickLogPrefix(text);
      if (log.torn !== null) console.error(`note: ${a["picks-from"]} ends in a torn record (${log.torn.length} bytes, not JSON); replaying its ${log.entries.length} complete picks`);
      record = { entries: log.entries, text: log.text, implicit: false };
    }
  } catch (e) {
    die(`--picks-from ${a["picks-from"]}: ${(e as Error).message}`);
  }
}
/** An incomplete picked bundle at the run's directory is re-run in place from everything recorded of it; a complete one never is. */
async function recover(dir: string, spec: RunSpec): Promise<void> {
  let done: Record<string, unknown>;
  try {
    done = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return;
    throw e;
  }
  if (!sameCompletedRun(done, spec)) die(`refusing to reuse ${dir}: it holds a run with a different spec, config or rule version; choose a new --experiment name`);
  if (done.summary) die(`${dir} holds a complete picked run; choose a new --experiment (a picked directory is never reused or skipped)`);
  const given = record ? [{ entries: record.entries, text: record.text, source: a["picks-from"]! }] : [];
  const kept: { entries: PickEntry[]; text?: string; source: string }[] = [];
  const torn: { source: string; text: string }[] = [];
  for (const f of [`${dir}/${PICKS_FILE}`, `${dir}/picks.recovery.jsonl`]) {
    let text: string;
    try {
      text = await Deno.readTextFile(f);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue;
      throw e;
    }
    // Damage other than a torn last record leaves the file untouched and the run refused: ignoring it would let a live run truncate recorded picks.
    let log: ReturnType<typeof parsePickLogPrefix>;
    try {
      log = parsePickLogPrefix(text);
    } catch (e) {
      die(`${f} is damaged and is left as it is: ${(e as Error).message}; repair it or choose a new --experiment`);
    }
    if (log!.torn !== null) torn.push({ source: f, text });
    kept.push({ entries: log!.entries, text: log!.text, source: f });
  }
  // Every log of this run must tell one history before anything is copied, cleared or truncated.
  const conflict = pickLogsConflict([...given, ...kept]);
  if (conflict) die(`refusing to recover ${dir}: ${conflict}; they cannot both be this run's record, so choose a new --experiment`);
  // One record out of them all, the bundle's own lines first. Not the longest log alone: a given record of later cycles
  // would otherwise displace the committed earlier ones, which the runner then truncates.
  const merged = mergePickLogs([...kept, ...given]);
  if (merged.entries.length > 0 && !record) die(`${dir} holds an incomplete picked run with ${merged.entries.length} recorded picks; re-run with --picks-from ${dir}/${PICKS_FILE} to replay them (or choose a new --experiment)`);
  const unfit = record ? picksPreflightError(merged.entries, specConfig(spec), 0, spec.steps, a.picker !== undefined || record.implicit) : null;
  if (unfit) die(`refusing to recover ${dir}: what is recorded of this run cannot drive it: ${unfit}`);
  // Keep the whole of a torn log (the cut record is the only thing the copy below drops) beside it, then the merged record before the runner truncates the log.
  for (const t of torn) {
    await Deno.writeTextFile(`${t.source}.torn`, t.text);
    console.error(`note: ${t.source} ends in a torn record; the original is kept as ${t.source}.torn and its complete picks are used`);
  }
  const recovery = kept.find((l) => l.source === `${dir}/picks.recovery.jsonl`);
  if (merged.entries.length > (recovery?.entries.length ?? 0)) {
    await Deno.writeTextFile(`${dir}/picks.recovery.jsonl.part`, merged.text);
    await Deno.rename(`${dir}/picks.recovery.jsonl.part`, `${dir}/picks.recovery.jsonl`);
  }
  if (record) record = { ...record, entries: merged.entries, text: merged.text };
  // checkpoints/ lists the boundaries tools/breed.ts reads; the failed attempt's would show boundaries this run may never reach.
  await Deno.remove(`${dir}/checkpoints`, { recursive: true }).catch((e) => { if (!(e instanceof Deno.errors.NotFound)) throw e; });
  console.log(`re-running ${dir} in place from ${record?.entries.length ?? 0} recorded picks`);
}

/** The directory the picker named by --picker shows its boundaries in, when it shows them: --pick-dir, else the bundle's picker/ for a file or command picker. */
function pickDirOf(spec: RunSpec): string | undefined {
  if (a.picker === undefined) return undefined;
  return a["pick-dir"] ?? (a.picker === "file" || a.picker === "command" ? `${a.out}/${runId(spec)}/picker` : undefined);
}
/** What a pick directory is claimed for: the run's bundle directory (compared in its canonical form, `claimPickDir`). */
const pickOwner = (spec: RunSpec) => `${a.out}/${runId(spec)}`;

/** The picker named by --picker, shown through files in its pick directory when it has one. */
async function makePicker(spec: RunSpec): Promise<Picker | undefined> {
  if (a.picker === undefined) return undefined;
  const timeoutMs = Number(a["pick-timeout"] ?? (a.picker === "file" ? 900 : 180)) * 1000;
  const given = pickDirOf(spec);
  if (given === undefined) return a.picker === "rule" ? rulePicker() : randomPicker(a["pick-seed"] !== undefined ? Number(a["pick-seed"]) : spec.seed);
  await Deno.mkdir(given, { recursive: true });
  const dir = await Deno.realPath(given);
  const run = pickOwner(spec);
  if (a.picker === "file") return dirPicker({ dir, io: denoIo, run, name: "file", answer: fileAnswerer({ io: denoIo, timeoutMs }) });
  if (a.picker === "command") return dirPicker({ dir, io: denoIo, run, name: pickLabel === "command" ? "command" : `command:${pickLabel}`, answer: commandAnswerer({ argv: pickArgv!, run: denoRun, timeoutMs }) });
  const inner = a.picker === "rule" ? rulePicker() : randomPicker(a["pick-seed"] !== undefined ? Number(a["pick-seed"]) : spec.seed);
  return dirPicker({ dir, io: denoIo, run, name: inner.name, answer: ({ req }) => inner.pick(req) });
}

for (const spec of specs) {
  const errs = validateSpec(spec);
  if (errs.length) {
    console.error(`invalid spec for ${runId(spec)}: ${errs.join("; ")}`);
    Deno.exit(2);
  }
  const cfg = specConfig(spec); // throws for unsupported preset/condition combinations
  const cfgErrs = validateConfig(cfg); // e.g. --override pondDeath on an arm other than nat and shuf
  if (cfgErrs.length) {
    console.error(`invalid spec for ${runId(spec)}: ${cfgErrs.join("; ")}`);
    Deno.exit(2);
  }
  const branchBad = branchError(spec, cfg, { branchFrom: source?.state });
  if (branchBad) {
    console.error(`invalid spec for ${runId(spec)}: ${branchBad}`);
    Deno.exit(2);
  }
  const preCycleBad = preCycleError(spec, cfg, source?.state.step ?? 0); // every run here starts from its preset at step 0, or a branch from its source's step
  if (preCycleBad) {
    console.error(`invalid spec for ${runId(spec)}: ${preCycleBad}`);
    Deno.exit(2);
  }
  // The given record's entries are checked here; whether it covers the run is judged below, on the record recovery leaves.
  const pickedBad = pickedConfigError(spec, cfg) ?? (spec.picked ? picksPreflightError(record?.entries ?? [], cfg, 0, spec.steps, true) : null);
  if (pickedBad) {
    console.error(`invalid spec for ${runId(spec)}: ${pickedBad}`);
    Deno.exit(2);
  }
}
// An incomplete picked bundle is re-run in place; checked after the spec, before the device.
if (picking) {
  const spec = specs[0];
  // A pick directory is one run's. Looked at before recovery changes anything in the bundle, claimed after it.
  const pickDir = pickDirOf(spec);
  const others = pickDir !== undefined ? await pickDirTaken(denoIo, pickDir, pickOwner(spec)) : null;
  if (others) die(others);
  await recover(`${a.out}/${runId(spec)}`, spec);
  // Coverage, on the record as recovery left it: a given record of later cycles is whole once the bundle's committed ones are merged in.
  const short = picksPreflightError(record?.entries ?? [], specConfig(spec), 0, spec.steps, a.picker !== undefined || !!record?.implicit);
  if (short) die(`invalid spec for ${runId(spec)}: ${short}`);
  if (pickDir !== undefined) {
    const taken = await claimPickDir(denoIo, pickDir, pickOwner(spec));
    if (taken) die(taken);
  }
}
const device = await requestDevice(navigator.gpu, specConfig(specs[0]));
for (const spec of specs) {
  const dir = `${a.out}/${runId(spec)}`;
  // A picked directory was checked by `recover` above; it is never skipped, and an unpicked one behaves as it always has.
  if (!spec.picked)
    try {
      const done = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
      const same = sameCompletedRun(done, spec);
      if (!same) {
        console.error(`refusing to reuse ${dir}: it holds a run with a different spec (a different branch included), config or rule version; choose a new --experiment name`);
        Deno.exit(2);
      }
      if (done.summary) {
        console.log(`skip ${runId(spec)} (complete, identical spec)`);
        continue;
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  console.log(`run ${runId(spec)} (${spec.steps} steps)`);
  let summary;
  try {
    ({ summary } = await runExperiment(device, spec, fsSink(dir), { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`, adapter: adapterDesc }, (m) => console.log(`  ${m}`), {
      branchFrom: source?.state,
      ...(spec.picked ? { picker: await makePicker(spec), picks: record?.entries ?? [], implicitRule: record?.implicit } : {}),
    }));
  } catch (e) {
    if (!(e instanceof PickError)) throw e;
    console.error(`pick failed: ${e.message}\n  the run stopped at that boundary with the world unchanged; the log ${dir}/${PICKS_FILE} holds the picks so far (recover with --picks-from)`);
    Deno.exit(3);
  }
  console.log(`  done: ${summary.stepsPerSecond.toFixed(0)} st/s, ${summary.finalIndividuals} individuals, ${summary.finalLineages} lineages, conservation ${summary.conservationOk ? "exact" : "VIOLATED"}`);
  if (spec.picked) {
    const bad = picksConsistencyError(await Deno.readTextFile(`${dir}/${PICKS_FILE}`), await Deno.readTextFile(`${dir}/ponds.tsv`), specConfig(spec).seed);
    if (bad) {
      console.error(`picks.jsonl and ponds.tsv disagree: ${bad}`);
      Deno.exit(4);
    }
  }
  if (a["verify-against"] !== undefined) {
    const other = a["verify-against"];
    const mine = { hash: summary.finalHash, ponds: await Deno.readTextFile(`${dir}/ponds.tsv`).catch(() => "") };
    const theirs = {
      hash: JSON.parse(await Deno.readTextFile(`${other}/manifest.json`)).summary?.finalHash,
      ponds: await Deno.readTextFile(`${other}/ponds.tsv`).catch(() => ""),
    };
    const diffs = [mine.hash !== theirs.hash && `finalHash ${mine.hash} vs ${theirs.hash}`, mine.ponds !== theirs.ponds && "ponds.tsv bytes differ"].filter(Boolean);
    if (diffs.length) {
      console.error(`not identical to ${other}: ${diffs.join("; ")}`);
      Deno.exit(4);
    }
    console.log(`identical to ${other} (finalHash ${mine.hash}${mine.ponds ? ", ponds.tsv bytes" : ""})`);
  }
}
