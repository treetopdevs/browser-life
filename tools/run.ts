// Headless experiment runner on native WebGPU (Deno + wgpu).
//
//   deno run -A tools/run.ts --experiment pilot --preset spots --conditions treatment,neutral \
//     --seeds 1-3 --steps 50000 --census 100 [--deep 10] [--checkpoint 0] [--out runs] [--threshold N]
//     [--lineage-obs] [--solo-founder K | --solo-genome HEX | --founder-set HEX,HEX,...] [--pre-cycle B,B,...]
//     [--override mutRate=0,pondDeath=65536] [--branch-from DIR --branch-boundary B]
//     [--picker rule|random|file|command] [--pick-seed N] [--pick-dir DIR] [--pick-cmd '["argv","..."]'] [--pick-timeout SEC]
//     [--pick-label NAME] [--picks-from FILE] [--verify-against DIR]
//     [--lesion STEP:X,Y,R]... [--feed STEP:X,Y,R,AMOUNT]... [--interventions FILE]
//     [--start-from DIR --start-step N]
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
// Scheduled interventions (RunSpec.interventions; packages/runner/src/interventions.ts): lesions and feeds applied at their steps as the
// lab applies them by hand, so a wounded or fed world runs, and replays, headless bit for bit.
//   --lesion STEP:X,Y,R          destroys the bound structure in the disc of radius R at cell (X,Y) once the world has run STEP steps
//   --feed STEP:X,Y,R,AMOUNT     adds AMOUNT quanta of nutrient to every cell of that disc (a negative AMOUNT drains, up to that much
//                                per cell; a signed integer, 1 to 4096 in size)
//   --interventions FILE         a JSON array of the same entries, {"step":137,"kind":"lesion","x":20,"y":20,"r":4} and
//                                {"step":200,"kind":"feed","x":30,"y":30,"r":3,"amount":16} (a feed may add "matter": the net quanta the
//                                feed must move, else the run stops); or an interventions.jsonl a run wrote, which replays as a schedule
// --lesion and --feed repeat; all three may be combined. They are merged (the file's entries, then the lesions, then the feeds, each in
// the order given), stable-sorted by step, and become RunSpec.interventions of every (condition, seed) of the invocation, so several at
// one step apply in that order (parseArgs does not keep the interleaving of --lesion and --feed; a file does). Step 0 is allowed and is
// the starting world itself; an entry after --steps is refused. Each is applied after that step's census and boundary transforms, before
// any checkpoint, so a checkpoint carries the post-intervention world. Besides the usual files the bundle then has interventions.jsonl (one
// line per applied entry: step, kind, x, y, the effective radius, and for a feed its amount and the matter it moved) and the manifest has
// spec.interventions and an interventions block {file, applied}; without a schedule neither exists and the bundle is as before. A feed
// changes the world's matter (the conservation check moves its baseline by what the feed moved; the observer's `fed` total records it) and is
// refused in a pond world, where each pond's matter is fixed by its cycle; a lesion works anywhere. A scheduled run is distributed too:
// the same JSON array as an experiment spec's "interventions" (POST /api/experiments) rides in every segment's task, segments go
// only to islands that advertise interventions-v1, each applies the entries it owns, and tools/stitch.ts joins their logs into
// this bundle. Refused with exit 2, before any GPU work: a
// malformed entry or flag, a centre outside the world, a feed that feedError refuses, an entry after --steps, and any of the three flags
// with --branch-from (a branch starts mid-history) or with --picks-from naming a lab run manifest (the manifest is the history);
// --picks-from itself is refused with --branch-from for the same reason, and with the founder options (the start world is the preset's).
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
//                       interventions, a boundary without one takes the rule's donors; edgesFrom > 0 is refused).
//                       Alone it is an exact replay (same final hash and ponds.tsv); with --picker the record wins where it has an
//                       entry and the picker answers the rest. A lab replay reproduces the physics, not the lab's observer settings,
//                       so summary.finalHash can differ from the lab's.
//                       A lab manifest's lesions and feeds replay too: they become the run's schedule (above), each feed carrying the
//                       matter the lab logged, and a feed that moves other matter stops the run (exit 4, "this is not the observed
//                       history"). A feed logged without its matter, a log not in one step order, a lesion or feed logged ahead of a pick
//                       of its own step, and a manifest whose startHash is not the start world this checkout builds are refused (exit 2). The run is picked only with a picker, a picks.jsonl, or a manifest of a pond world whose arm chooses
//                       donors; a plain fed or wounded world is an ordinary run with no picks.jsonl. Either way it lands at
//                       <experiment>/<preset>/<condition>-by-<label>/seed-<n>/ (label as below, default replay), one condition and one seed
//                       per invocation, and --steps must reach the manifest's last intervention (a lab history replays whole).
//                       The proof is the lab's own record: the manifest's checkpoint taken at --steps, after every intervention logged up
//                       to it (a checkpoint stores how many were logged when it was saved, so one saved before an intervention at its own
//                       step is not comparable), holds a stateHash, which covers the physics only and so does not depend on the observer
//                       settings. The run prints "matches the lab's checkpoint at t=N (stateHash ...)", or both hashes and exits 4;
//                       without a comparable checkpoint it prints a note saying so. A complete replay directory is never skipped or
//                       reused (exit 2): choose a new --experiment or --pick-label.
//   --verify-against DIR  compare this run's final hash and ponds.tsv bytes with the bundle at DIR: prints identical, or exits 4.
// Recovery after a failure: re-run the same command with --picks-from <failed bundle>/picks.jsonl: recorded boundaries replay,
// only the missing ones are asked. The record replayed is every boundary that --picks-from, picks.jsonl and picks.recovery.jsonl
// hold between them (they must agree where they overlap); it is written to picks.recovery.jsonl first, as pick lines whatever the
// source's format, then checkpoints/ is cleared; picker/ is kept.
// A log cut mid-record by a crash is used up to its last complete line (the original stays as picks.jsonl.torn); any other damage to
// the bundle's logs, or two logs (--picks-from, picks.jsonl, picks.recovery.jsonl) that disagree at a step, refuses the recovery (exit 2)
// before anything is copied, cleared or truncated. Replaying a log rewrites it with `by: "recorded"`: what replay reproduces is the
// state, ponds.tsv and each boundary's step, cycle and donors, not the original `by` and `suggested` fields.
// Pressures (the lab's pond keeper; RunSpec.pressures): a lab run manifest or a session file in --picks-from may hold `pressure`
// interventions, the breeder's dial ({"step":5000,"kind":"pressure","cycle":1,"score":"drive"}). They replay with it: at each boundary no
// recorded pick covers, the rule's donors are those of the latest pressure's score (cycle <= the boundary), not the world's own pondScore.
// ponds.tsv keeps the world's header, and its score and donorScore columns stay the world's score values, as under a hand pick; picks.jsonl's
// `suggested` is the pressured rule's donors. A pressured run is a picked run (the manifest's spec carries pressures) and, like one,
// cannot be segmented or sent to an island. Exit 2, before any GPU work, for a pressure that is not the observed history (a cycle
// that is not the one set at that step, a world whose arm is not breed) or that lies after --steps. A run with no pressure is unchanged.
// A picked run cannot resume from a checkpoint, be segmented or run on an island; a scheduled run can be segmented, run on islands and
// stitched back. Exit codes: 2 invalid spec or flags (before any GPU work), 3 a pick failed, 4 a verification mismatch: the lab's
// checkpoint or --verify-against differs, or a scheduled feed could not be applied as logged (it moved other matter than the lab's log says).
//
// Forks from a checkpoint (the experiment proposer, tools/propose.ts; docs/naturalist-proposer-v0-2026-10-18.md):
//   --start-from DIR --start-step N   continue the history in the bundle at DIR from its checkpoint at step N (the manifest's
//                                     `checkpoints` entry; the file must decode and its stateHash match the entry), with the
//                                     checkpoint's observer, as an island continues a segment (RunOptions.start and observer;
//                                     the runner's continuationError: the same config and observer settings as this spec).
//                                     --steps then counts from N, and every --lesion, --feed and --interventions entry must lie in
//                                     (N, N + steps]. One condition and one seed. Refused with exit 2, before any GPU work: one flag
//                                     without the other; with --branch-from, --picks-from, --picker, --solo-founder, --solo-genome,
//                                     --founder-set, --lineage-obs, --pre-cycle or --verify-against; no checkpoint at N, a file that does not read,
//                                     decode or hash to the entry; a spec the checkpoint cannot continue; an entry outside the
//                                     window; and an existing manifest.json in the run's directory, or (just before the run) an
//                                     existing run directory at all: a fork claims it with an atomic mkdir and is never skipped,
//                                     reused or written over (the spec records no start, so a step-0 run of the same spec would
//                                     look identical).
//                                     Without these flags nothing here changes.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { PRESETS, RULE_VERSION, initWorld, stateHash, validateConfig, type WorldConfig, type WorldState } from "@bl/schema";
import { join as joinPath } from "node:path";
import { requestDevice } from "@bl/sim-gpu";
import {
  INTERVENTIONS_FILE,
  InterventionError,
  PICKS_FILE,
  PickError,
  branchError,
  continuationError,
  decodeArtifact,
  interventionsError,
  labHistory,
  parseInterventionLog,
  parseOverrides,
  mergePickLogs,
  parsePickLogPrefix,
  pickLogsConflict,
  pickedConfigError,
  picksConsistencyError,
  picksPreflightError,
  preCycleError,
  pressuresConfigError,
  runExperiment,
  runId,
  sameCompletedRun,
  sameConfig,
  specConfig,
  validateSpec,
  type BranchSpec,
  type ObserverState,
  type PickEntry,
  type Picker,
  type PressureEntry,
  type RunSpec,
  type ScheduledIntervention,
  type Sink,
} from "@bl/runner";
import { branchFlagsError, branchSource } from "./lib/branch-source.ts";
import { claimPickDir, commandAnswerer, denoIo, denoRun, dirPicker, fileAnswerer, pickDirTaken, randomPicker, rulePicker } from "./lib/pickers.ts";

const a = parseArgs(Deno.args, {
  string: ["experiment", "preset", "conditions", "seeds", "out", "steps", "census", "deep", "checkpoint", "threshold", "solo-founder", "solo-genome", "founder-set", "pre-cycle", "override", "branch-from", "branch-boundary", "picker", "pick-seed", "pick-dir", "pick-cmd", "pick-timeout", "pick-label", "picks-from", "verify-against", "lesion", "feed", "interventions", "start-from", "start-step"],
  collect: ["lesion", "feed"],
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

/** A schedule entry with its keys in the order the runner and the lab write them, so one schedule always serialises (and compares in `sameCompletedRun`) the same; keys it does not know follow, for validateSpec to refuse. */
function inKeyOrder(e: unknown): unknown {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return e;
  const o = e as Record<string, unknown>;
  // No prototype, and own keys only: on a plain {} a key such as "constructor" or "toString" counts as already there (`in` walks the
  // prototype chain) and an own "__proto__" would set the prototype instead of a key, so validateSpec would never see either.
  const out: Record<string, unknown> = Object.create(null);
  for (const k of ["step", "kind", "x", "y", "r", "amount", "matter"]) if (Object.hasOwn(o, k)) out[k] = o[k];
  for (const k of Object.keys(o)) if (!Object.hasOwn(out, k)) out[k] = o[k];
  return out;
}
const LESION_FLAG = /^(\d+):(\d+),(\d+),(\d+)$/;
const FEED_FLAG = /^(\d+):(\d+),(\d+),(\d+),([+-]?\d+)$/;

/**
 * The schedule --interventions, --lesion and --feed name (RunSpec.interventions), merged in that order and stable-sorted by
 * step, so several at one step apply file first, then lesions, then feeds, each in the order given (parseArgs does not keep the
 * interleaving of --lesion and --feed; a file does). [] when none is given. Throws a message for a grammar miss or an unreadable
 * file; the entries' values are validateSpec's to judge.
 */
async function scheduleFromFlags(): Promise<ScheduledIntervention[]> {
  const list: unknown[] = [];
  if (a.interventions !== undefined) {
    const file = `--interventions ${a.interventions}`;
    let given: unknown;
    try {
      const text = await Deno.readTextFile(a.interventions);
      // A JSON array, or an interventions.jsonl log written by an earlier run (its lines replay as a schedule).
      given = text.trimStart().startsWith("[") ? JSON.parse(text) : parseInterventionLog(text);
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message} (expected a JSON array of lesions and feeds, or an ${INTERVENTIONS_FILE})`);
    }
    if (!Array.isArray(given) || given.length === 0) throw new Error(`${file}: expected a non-empty JSON array of lesions and feeds`);
    list.push(...given.map(inKeyOrder));
  }
  for (const v of a.lesion) {
    const m = LESION_FLAG.exec(v);
    if (!m) throw new Error(`--lesion ${JSON.stringify(v)}: expected STEP:X,Y,R, non-negative integers (for example 137:20,20,4)`);
    list.push({ step: Number(m[1]), kind: "lesion", x: Number(m[2]), y: Number(m[3]), r: Number(m[4]) });
  }
  for (const v of a.feed) {
    const m = FEED_FLAG.exec(v);
    if (!m) throw new Error(`--feed ${JSON.stringify(v)}: expected STEP:X,Y,R,AMOUNT, AMOUNT a signed integer, negative to drain (for example 200:30,30,3,16)`);
    list.push({ step: Number(m[1]), kind: "feed", x: Number(m[2]), y: Number(m[3]), r: Number(m[4]), amount: Number(m[5]) });
  }
  // Array.prototype.sort is stable; an entry with no numeric step sorts last, where validateSpec reports it.
  const stepOf = (e: unknown) => (typeof (e as { step?: unknown } | null)?.step === "number" ? (e as { step: number }).step : Infinity);
  return list.sort((p, q) => (stepOf(p) === stepOf(q) ? 0 : stepOf(p) - stepOf(q))) as ScheduledIntervention[];
}

const unpaired = branchFlagsError(a["branch-from"], a["branch-boundary"]);
if (unpaired) {
  console.error(unpaired);
  Deno.exit(2);
}
let overrides: RunSpec["overrides"];
let source: { branch: BranchSpec; state: WorldState } | undefined;
let scheduled: ScheduledIntervention[] = [];
try {
  if (a["branch-from"] !== undefined && (a.lesion.length > 0 || a.feed.length > 0 || a.interventions !== undefined))
    throw new Error("--lesion, --feed and --interventions cannot be combined with --branch-from: a branch starts mid-history, and a schedule counts its steps from the start of a world");
  // A record is a whole history from step 0 (a picks.jsonl makes a picked run, which validateSpec refuses as a branch; a lab manifest's
  // lesions and feeds would be counted from a start the branch never runs from), so it is refused here, before the source is read.
  if (a["branch-from"] !== undefined && a["picks-from"] !== undefined)
    throw new Error("--picks-from cannot be combined with --branch-from: a record or a lab manifest is a whole history from step 0, and a branch starts mid-history");
  scheduled = await scheduleFromFlags();
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
      ...(scheduled.length ? { interventions: scheduled } : {}),
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
if (picking && specs.length !== 1) die("a --picker or --picks-from run takes one condition and one seed per invocation");
if (a["verify-against"] !== undefined && specs.length !== 1) die("--verify-against takes one run per invocation");

/** The record named by --picks-from: a picks.jsonl or a lab run manifest (then a boundary without an entry takes the rule's donors). */
let record: { entries: PickEntry[]; text?: string; implicit: boolean } | undefined;
/**
 * A lab run manifest's other half (packages/runner/src/interventions.ts `labHistory`): its lesions and feeds, which become the run's
 * schedule, and what the lab recorded to compare the replay with (its checkpoints, and every logged intervention of any kind, which a
 * checkpoint counts). `pondPicks`: the manifest's config is a pond config whose arm chooses donors, or the manifest holds picks, so
 * the replay is a picked run; a plain (fed or wounded) world is not.
 */
let lab: { scheduled: ScheduledIntervention[]; pressures: PressureEntry[]; checkpoints: { step?: unknown; hash?: unknown; interventions?: unknown; file?: unknown }[]; logged: { step?: unknown }[]; pondPicks: boolean } | undefined;
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
      if (scheduled.length > 0) die("--lesion, --feed and --interventions cannot be combined with a lab run manifest in --picks-from: the manifest is the history, and its lesions and feeds are the schedule");
      // The start world is the preset's, which the lab planted and whose hash is checked below; a founder option would build
      // another world under the same config, which that check cannot see (it hashes the preset's start).
      if (a["solo-founder"] !== undefined || a["solo-genome"] !== undefined || a["founder-set"] !== undefined)
        die("--solo-founder, --solo-genome and --founder-set cannot be combined with a lab run manifest in --picks-from: the manifest is the history, and its start world is the preset's");
      const spec = specs[0];
      const labPreset = PRESETS.find((x) => x.id === spec.presetId);
      const mismatches = [
        manifest.presetId !== spec.presetId && "presetId",
        manifest.seed !== spec.seed && "seed",
        manifest.ruleVersion !== RULE_VERSION && "ruleVersion",
        !sameConfig(manifest.cfg as WorldConfig, specConfig(spec)) && "cfg",
        JSON.stringify(manifest.init) !== JSON.stringify(labPreset?.init) && "init",
      ].filter(Boolean);
      if (mismatches.length) die(`the lab manifest does not describe this run: ${mismatches.join(", ")} differ`);
      // The lab recorded the hash of the world it planted. Its lesions and feeds are at absolute coordinates, so a start world that this
      // checkout builds differently (initWorld or a founder set drifted without a RULE_VERSION bump) would take them on another world.
      if (typeof manifest.startHash === "string" && labPreset !== undefined) {
        const here = stateHash(initWorld(specConfig(spec), labPreset.init));
        if (manifest.startHash !== here)
          die(`the lab planted a start world with hash ${manifest.startHash}, but this checkout builds ${here} from the same preset, config and seed: the start world has changed since, so the manifest's lesions and feeds would land on another world`);
      }
      const settings = manifest.settings as { censusEvery?: number; deepEvery?: number } | undefined;
      if (settings && (settings.censusEvery !== spec.censusEvery || settings.deepEvery !== spec.deepEvery))
        console.error(`note: the lab observed with census ${settings.censusEvery} / deep ${settings.deepEvery}, this run with ${spec.censusEvery} / ${spec.deepEvery}: the physics replays, but summary.finalHash can differ from the lab's`);
      const history = labHistory(manifest); // refuses edgesFrom > 0 and a lesion or feed that does not validate
      record = { entries: history.picks, implicit: true }; // no pick lines of its own: a recovery copy gets them written out
      const labCfg = specConfig(spec);
      lab = {
        scheduled: history.scheduled,
        pressures: history.pressures,
        checkpoints: Array.isArray(manifest.checkpoints) ? manifest.checkpoints : [],
        logged: manifest.interventions as { step?: unknown }[],
        pondPicks: history.picks.length > 0 || (labCfg.pondPeriod !== undefined && (labCfg.pondArm === "scaf" || labCfg.pondArm === "rand" || labCfg.pondArm === "breed")),
      };
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
if (picking) {
  const only = specs[0];
  // A picker, a picks.jsonl or a lab manifest of a donor-choosing pond world makes a picked run. A lab manifest of any other world
  // (fed, wounded or plain) replays as an ordinary run under the same -by-<label> directory, with no picks.jsonl. Keys in the order
  // an earlier picked spec had them (picked, runId), so an existing picked bundle still compares equal.
  const picked = a.picker !== undefined || (record !== undefined && (!record.implicit || lab!.pondPicks));
  // Pressures are the breeder's dial: only a donor-choosing pond world can have them, so a manifest that holds some is a picked run.
  if (lab && lab.pressures.length > 0 && !picked) die("the lab manifest holds pressures, but its world is not a pond world whose arm chooses donors, so there is no picked run to replay them in");
  specs[0] = {
    ...only,
    ...(lab && lab.scheduled.length > 0 ? { interventions: lab.scheduled } : {}),
    ...(lab && lab.pressures.length > 0 ? { pressures: lab.pressures } : {}),
    ...(picked ? { picked: true as const } : {}),
    runId: `${only.experiment}/${only.presetId}/${only.condition}-by-${pickLabel}/seed-${only.seed}`,
  };
}
/** A fork from a checkpoint (--start-from DIR --start-step N): the decoded, hash-checked state and observer the run continues. */
let startFrom: { step: number; state: WorldState; observer: ObserverState } | undefined;
if ((a["start-from"] === undefined) !== (a["start-step"] === undefined)) die("--start-from and --start-step go together");
if (a["start-from"] !== undefined) {
  const dir = a["start-from"];
  const clash = ["branch-from", "picks-from", "picker", "solo-founder", "solo-genome", "founder-set", "pre-cycle", "verify-against"].find((k) => a[k as keyof typeof a] !== undefined) ?? (a["lineage-obs"] ? "lineage-obs" : undefined);
  if (clash) die(`--start-from cannot be combined with --${clash}: a fork continues the source's own history from its checkpoint`);
  if (specs.length !== 1) die("--start-from takes one condition and one seed per invocation");
  const N = Number(a["start-step"]);
  if (!/^[1-9]\d*$/.test(a["start-step"]!) || !Number.isSafeInteger(N)) die("--start-step must be a positive integer (a checkpoint step of the source)");
  let entry: { step?: unknown; file?: unknown; hash?: unknown } | undefined;
  try {
    const m = JSON.parse(await Deno.readTextFile(joinPath(dir, "manifest.json")));
    entry = (Array.isArray(m?.checkpoints) ? m.checkpoints : []).find((c: { step?: unknown }) => c?.step === N);
  } catch (e) {
    die(`--start-from ${dir}: ${(e as Error).message}`);
  }
  if (!entry || typeof entry.file !== "string" || typeof entry.hash !== "string") die(`--start-from ${dir}: its manifest lists no checkpoint at step ${N}`);
  const file = entry!.file as string;
  if (file.startsWith("/") || file.split(/[/\\]/).includes("..")) die(`--start-from ${dir}: checkpoint ${file} is not a path inside the bundle`);
  try {
    const { state, observer } = decodeArtifact(await Deno.readFile(joinPath(dir, file)));
    if (state.step !== N) die(`--start-from ${dir}: ${file} holds step ${state.step}, not ${N}`);
    const h = stateHash(state);
    if (h !== entry!.hash) die(`--start-from ${dir}: ${file} hashes to ${h}, its manifest entry says ${entry!.hash}`);
    startFrom = { step: N, state, observer };
  } catch (e) {
    die(`--start-from ${dir}: ${file}: ${(e as Error).message}`);
  }
  const spec = specs[0];
  const cannot = continuationError(spec, startFrom!.state, startFrom!.observer);
  if (cannot) die(`--start-from ${dir} at step ${N}: ${cannot}`);
  const outside = (spec.interventions ?? []).findIndex((e) => !(e.step > N && e.step <= N + spec.steps));
  if (outside >= 0) {
    const e = spec.interventions![outside];
    die(`invalid spec for ${runId(spec)}: interventions[${outside}] (${e.kind} at t=${e.step}) is not in the fork's window (${N}, ${N + spec.steps}]: a fork from step ${N} applies only entries after its start, up to its last step`);
  }
  try {
    await Deno.lstat(`${a.out}/${runId(spec)}/manifest.json`);
    die(`${a.out}/${runId(spec)} already holds a run; a fork is never skipped or reused (its spec records no start), so choose a new --out or --experiment`);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
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
  // A schedule's entries are checked by validateSpec above; here the run's own length and world. An entry after the last step is never
  // reached (a typo, or a lab history longer than --steps: picks past the run are refused the same way); step 0 is the start itself.
  const late = (spec.interventions ?? []).findIndex((e) => e.step > (startFrom?.step ?? 0) + spec.steps); // a fork's --steps counts from its start
  if (late >= 0) {
    const e = spec.interventions![late];
    console.error(`invalid spec for ${runId(spec)}: interventions[${late}] (${e.kind} at t=${e.step}) is after the run's last step (--steps ${spec.steps}), so the run never reaches it; use --steps ${e.step} or more${lab ? "; a lab history replays whole, so --steps must reach its last intervention" : ""}`);
    Deno.exit(2);
  }
  const intervBad = interventionsError(spec, cfg, 0); // a centre off the world, a feed in a pond world
  if (intervBad) {
    console.error(`invalid spec for ${runId(spec)}: ${intervBad}`);
    Deno.exit(2);
  }
  // The given record's entries are checked here; whether it covers the run is judged below, on the record recovery leaves.
  const pickedBad = pickedConfigError(spec, cfg) ?? pressuresConfigError(spec, cfg) ?? (spec.picked ? picksPreflightError(record?.entries ?? [], cfg, 0, spec.steps, true) : null);
  if (pickedBad) {
    console.error(`invalid spec for ${runId(spec)}: ${pickedBad}`);
    Deno.exit(2);
  }
}
// An incomplete picked bundle is re-run in place; checked after the spec, before the device. A lab replay that is not a picked run
// (no pond donors to choose) has no picks, no pick directory and nothing to recover.
if (specs[0].picked) {
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
  // A fork claims its directory with a mkdir that fails when it exists (atomic), so a run that appeared there after its start checks, or a
  // second fork writing to the same directory, is refused rather than reused or overwritten (its spec records no start). A fork that
  // fails after this leaves the directory behind; a new --out or --experiment is then needed.
  if (startFrom) {
    await Deno.mkdir(dir.replace(/\/[^/]+$/, ""), { recursive: true });
    try {
      await Deno.mkdir(dir);
    } catch (e) {
      if (e instanceof Deno.errors.AlreadyExists) die(`${dir} now exists; a fork is never skipped or reused (its spec records no start), so choose a new --out or --experiment`);
      throw e;
    }
  }
  // A picked directory was checked by `recover` above; it is never skipped, and an unpicked one behaves as it always has.
  else if (!spec.picked)
    try {
      const done = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
      const same = sameCompletedRun(done, spec);
      if (!same) {
        console.error(`refusing to reuse ${dir}: it holds a run with a different spec (a different branch included), config or rule version; choose a new --experiment name`);
        Deno.exit(2);
      }
      if (done.summary) {
        // A lab replay is run to be compared with the lab's checkpoint, which needs the final state a skip never has.
        if (lab) {
          console.error(`${dir} holds a complete replay of this lab manifest; its comparison with the lab's checkpoint needs a run, so choose a new --experiment or --pick-label`);
          Deno.exit(2);
        }
        console.log(`skip ${runId(spec)} (complete, identical spec)`);
        continue;
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  console.log(`run ${runId(spec)} (${spec.steps} steps)`);
  let summary, final;
  try {
    ({ summary, final } = await runExperiment(device, spec, fsSink(dir), { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`, adapter: adapterDesc }, (m) => console.log(`  ${m}`), {
      branchFrom: source?.state,
      ...(startFrom ? { start: startFrom.state, observer: startFrom.observer } : {}),
      keepFinal: lab !== undefined, // the lab comparison below hashes the final state
      ...(spec.picked ? { picker: await makePicker(spec), picks: record?.entries ?? [], implicitRule: record?.implicit } : {}),
    }));
  } catch (e) {
    if (e instanceof InterventionError) {
      // A feed that moved other matter than the log says is the replay failing to be the observed history; a feed the world refuses stops the run the same way.
      // Step 0 is applied on the CPU before the run writes a file, so nothing exists to point at; later entries stop the run with the log started.
      const where = e.step === 0 ? "the run stopped before it began; nothing was written" : `the run stopped there; ${dir}/${INTERVENTIONS_FILE} holds the interventions applied so far`;
      console.error(`scheduled intervention failed: ${e.message}\n  ${where}`);
      Deno.exit(4);
    }
    if (!(e instanceof PickError)) throw e;
    console.error(`pick failed: ${e.message}\n  the run stopped at that boundary with the world unchanged; the log ${dir}/${PICKS_FILE} holds the picks so far (recover with --picks-from)`);
    Deno.exit(3);
  }
  console.log(`  done: ${summary.stepsPerSecond.toFixed(0)} st/s, ${summary.finalIndividuals} individuals, ${summary.finalLineages} lineages, conservation ${summary.conservationOk ? "exact" : "VIOLATED"}`);
  if (spec.interventions) console.log(`  ${parseInterventionLog(await Deno.readTextFile(`${dir}/${INTERVENTIONS_FILE}`)).length} of ${spec.interventions.length} scheduled interventions applied (${INTERVENTIONS_FILE})`);
  if (spec.picked) {
    const bad = picksConsistencyError(await Deno.readTextFile(`${dir}/${PICKS_FILE}`), await Deno.readTextFile(`${dir}/ponds.tsv`), specConfig(spec).seed);
    if (bad) {
      console.error(`picks.jsonl and ponds.tsv disagree: ${bad}`);
      Deno.exit(4);
    }
  }
  if (lab && final) {
    // The lab's checkpoint hash is stateHash (physics only), so the observer settings the replay differs in do not enter. A checkpoint
    // is comparable when it was taken at this run's last step after every intervention logged up to it: the lab writes the log's length
    // into the checkpoint when it saves, so one saved before an intervention at its own step carries fewer and is a different state.
    const mine = stateHash(final);
    const logged = lab.logged.filter((iv) => typeof iv?.step === "number" && iv.step <= spec.steps).length;
    const comparable = lab.checkpoints.filter((ck) => ck?.step === spec.steps && ck.interventions === logged && typeof ck.hash === "string");
    if (comparable.length === 0) {
      const at = [...new Set(lab.checkpoints.map((ck) => ck?.step).filter((x) => typeof x === "number"))].sort((x, y) => (x as number) - (y as number));
      console.log(`note: no lab checkpoint to compare with: none was saved at t=${spec.steps} after the ${logged} interventions the manifest logs up to it (${at.length ? `its checkpoints are at t=${at.join(", ")}` : "it has no checkpoints"}), so this replay is not checked against the lab`);
    } else {
      const bad = comparable.find((ck) => ck.hash !== mine);
      if (bad) {
        console.error(`not the lab's history: after ${spec.steps} steps this run's stateHash is ${mine}, the lab's checkpoint${typeof bad.file === "string" ? ` ${bad.file}` : ""} says ${bad.hash}`);
        Deno.exit(4);
      }
      console.log(`matches the lab's checkpoint at t=${spec.steps} (stateHash ${mine})`);
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
