// Stitches a coordinator experiment's segments into run bundles for tools/analyze.ts.
//
//   deno run -A tools/stitch.ts --experiment <name> [--coordinator http://localhost:4000] [--out runs] [--allow-unverified] [--require-observations-verified]
//   (a garden's name exports its verified prefix; see the garden paragraph below)
//
// Export is administrative: pass the coordinator's admin token with --token
// (or BL_ADMIN_TOKEN); without one only a loopback coordinator that allows
// local administration (the dev default) will answer.
//
// Each complete run is written to <out>/<experiment>/<preset>/<condition>/seed-<n>/,
// the layout tools/run.ts uses. A run is stitched only when every segment is
// done and (unless --allow-unverified) its final segment has been verified by
// another island; other runs are listed and skipped. Every downloaded file must
// match the SHA-256 the coordinator recorded for the accepted attempt (which
// proves it is that attempt's upload). A verify attempt may separately have
// reported its own regenerated observation files' digests, compared
// server-side against the accepted upload's (`observationsVerified`, carried
// into the stitched manifest); segments where they disagree are printed as a
// warning, and --require-observations-verified additionally skips a run
// unless EVERY included segment's observations were verified as matching —
// checking only the final segment would still export earlier segments whose
// own observation files were never confirmed against the accepted upload
// (replaying the final segment alone doesn't touch them). Off by default,
// since this is a secondary signal, not what run correctness rests on (that's
// the physics+observer digest alone). A bred run (one whose config has a
// pondScore: the breeder preset, or a pond-breed-/pond-mass-/pond-drift-
// condition) is the exception: its ponds.tsv is the record of which donors the
// rule chose and why, so a segment whose observations mismatch is skipped
// without the flag too (docs/archipelago-breed-2026-10-18.md). Every
// downloaded manifest must also describe exactly the task the coordinator
// handed out (taskSpecError in packages/runner/src/stitch.ts: no overrides or
// any other key a producer added, and the config that spec builds), since a
// manifest is the producer's alone and no verifier's digest covers it; an
// export already on disk is held to the same binding before it is kept. The
// coordinator is authoritative: an existing export whose run is no longer
// exportable, or whose accepted history has changed (including its
// verification metadata, or a metrics-version bump since it was written), is
// moved aside to seed-<n>.stale-<time> (outside analyze.ts's input) before
// anything new is written.
//
// A garden (an experiment whose spec has "garden": true; apps/coordinator
// README, "The garden") never has every segment done: its days are released
// one dawn at a time up to its horizon. Its export is its verified prefix: the
// days from day 0 that are all verified (with --allow-unverified, done or
// verified), stitched over (0, end of the last such day]. Each day's manifest
// carries the letters as of its assignment; stitchRun checks each day's log
// against its own list, refuses a list that rewrites an earlier day, writes the
// union of what the days applied as the stitched schedule, and checks that
// union against the experiment's current list over the stitched range
// (packages/runner/src/stitch.ts, docs/garden-stitch-rule-2026-10-17.md).
// When the prefix grows, an export of a shorter prefix of the same accepted
// history is replaced in place (the old copy renamed aside, the new one renamed
// in, the old one removed: for that moment no seed-<n> exists, so do not run
// analyze.ts on a garden while exporting it); anything else that differs is
// moved aside as above. A garden's run is exported under an exclusive lock on
// seed-<n>'s hidden sibling .seed-<n>.lock (released when the process exits,
// however it exits), and the coordinator's listing is fetched again once the
// lock is held, so two exporters of one garden take turns and neither acts on
// a listing older than the export it finds. A cached garden export is
// re-checked before it is kept: its range against the days the coordinator
// lists, and its schedule and log against the coordinator's list.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { METRICS_VERSION, PRESETS, defaultConfig } from "@bl/schema";
import {
  BUNDLE_FILES,
  EXCHANGES_FILE,
  INTERVENTIONS_FILE,
  MIGRATIONS_FILE,
  PONDS_FILE,
  SPECIES_FILE,
  checkInterventionLog,
  checkPondsFile,
  ownedInterventions,
  sameIntervention,
  stitchRun,
  stitchablePrefix,
  validateInterventions,
  type ScheduledIntervention,
  specConfig,
  taskSpecError,
  type DistributedTask,
  type RunSpec,
  type StitchSegment,
} from "@bl/runner";

// Optional files (not in BUNDLE_FILES): recorded only when the run has the
// corresponding mechanism configured (tile migration / a metapopulation /
// RunSpec.speciesCensus / the pond cycle / scheduled interventions), so a run
// without that mechanism never carries them (see MIGRATIONS_FILE/
// EXCHANGES_FILE/SPECIES_FILE/PONDS_FILE's own docs in
// packages/runner/src/stitch.ts and INTERVENTIONS_FILE's in interventions.ts).
const OPTIONAL_FILES = [MIGRATIONS_FILE, EXCHANGES_FILE, SPECIES_FILE, PONDS_FILE, INTERVENTIONS_FILE] as const;

const a = parseArgs(Deno.args, {
  string: ["experiment", "coordinator", "out", "token"],
  boolean: ["allow-unverified", "require-observations-verified"],
  default: { coordinator: "http://localhost:4000", out: "runs" },
});
if (!a.experiment) {
  console.error("usage: stitch.ts --experiment <name> [--coordinator URL] [--token T] [--out runs] [--allow-unverified] [--require-observations-verified]");
  Deno.exit(2);
}
const base = a.coordinator.replace(/\/$/, "");
const token = a.token ?? Deno.env.get("BL_ADMIN_TOKEN");

async function get(path: string): Promise<Response> {
  const r = await fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${await r.text()}`);
  return r;
}

interface Listed {
  id: string;
  run: string;
  condition: string;
  seed: number;
  index: number;
  last: boolean;
  startStep: number;
  steps: number;
  status: string;
  digest: string | null;
  /** Bundle file name -> SHA-256, recorded by the coordinator for the accepted run attempt. */
  files: Record<string, string> | null;
  producedBy: string | null;
  verifiedBy: string | null;
  /** true/false only when a verify attempt matching the current accepted digest also reported observation-file digests; null otherwise (see `Coordinator.Queue`'s `{:experiment, name}` handler). */
  observationsVerified: boolean | null;
}
type Experiment = {
  spec: { experiment: string; steps: number; presetId: string; censusEvery: number; deepEvery: number; seeds?: number[]; metapopulation?: Record<string, unknown>; interventions?: unknown; garden?: unknown };
  segments: Listed[];
};
const fetchExperiment = async (): Promise<Experiment> => await (await get(`/api/experiments/${encodeURIComponent(a.experiment!)}`)).json();
const exp = await fetchExperiment();

const byRun = new Map<string, Listed[]>();
for (const s of exp.segments) byRun.set(s.run, [...(byRun.get(s.run) ?? []), s]);

// Segments whose verify attempt's regenerated observation files disagree with
// the accepted upload's — printed regardless of a run's export eligibility,
// since this is informational (run correctness rests on the physics+observer
// digest alone; see packages/runner/src/stitch.ts's `StitchSegment` doc).
for (const s of exp.segments) if (s.observationsVerified === false) console.warn(`WARNING: ${s.run} #${s.index}: observation files mismatch (producedBy ${s.producedBy}, verifiedBy ${s.verifiedBy})`);

// Whether this *experiment* has a metapopulation at all -- the source of
// truth for whether exchanges.tsv is expected on every segment, rather than
// inferring it from whether any segment happens to have the file recorded
// (review P2: if every segment of a metapopulation run were missing it due
// to a bug, file-presence inference would silently read that as "not
// configured" instead of catching the gap). `spec["metapopulation"]` is
// experiment-wide (Coordinator.Queue's `put_metapopulation/2`), so this is
// the same for every run in `exp`, including its "no-migration" control.
const metapopConfigured = Boolean(exp.spec.metapopulation);
// Likewise for ponds.tsv: the pond cycle comes from the experiment's preset
// (a coordinator spec carries no config overrides, and the pond conditions
// only change the arm), so a pond preset expects it on every segment even
// if none recorded one.
const pondCfg = PRESETS.find((p) => p.id === exp.spec.presetId)?.cfg;
const pondsConfigured = pondCfg?.pondPeriod !== undefined;
// And for interventions.jsonl: the schedule is the experiment's spec
// (Coordinator.Queue carries it whole into every segment), so a scheduled
// experiment expects the log on every segment even if none recorded one.
const scheduled = exp.spec.interventions !== undefined;
// A garden (Coordinator.Queue marks its stored spec "garden": true) exports
// its verified prefix; its `interventions` is the current list (founding plus
// live letters), which stitchRun checks the prefix's union against (re-read
// under the run's lock, with the listing: see the loop below).
const garden = exp.spec.garden === true;
// Whether optional file `f` is configured for a run whose segments are `segs`.
const configuredFor = (f: (typeof OPTIONAL_FILES)[number], segs: Listed[]) =>
  f === EXCHANGES_FILE ? metapopConfigured : f === INTERVENTIONS_FILE ? scheduled : (f === PONDS_FILE && pondsConfigured) || segs.some((s) => s.files?.[f]);
// Why a run cannot be exported (yet), or null.
// For a garden, `segs` is its prefix (`stitchablePrefix`), whose days are all
// done or verified as the flags ask, so the two checks on the whole run below
// do not apply (its final segment is the horizon's, never in a prefix).
function ineligible(segs: Listed[]): string | null {
  if (garden) return filesIneligible(segs);
  const unfinished = segs.filter((s) => s.status !== "done" && s.status !== "verified");
  if (unfinished.length) return `${unfinished.length} segment(s) not done (${[...new Set(unfinished.map((s) => s.status))].join(", ")})`;
  if (!a["allow-unverified"] && segs.find((s) => s.last)?.status !== "verified") return "final segment not yet verified (pass --allow-unverified to stitch anyway)";
  return filesIneligible(segs);
}
// The task the coordinator handed out for segment `s` (`Coordinator.Queue`'s task/4), for taskSpecError.
const taskOf = (s: Listed): DistributedTask => ({
  experiment: exp.spec.experiment,
  presetId: exp.spec.presetId,
  condition: s.condition,
  seed: s.seed,
  steps: s.steps,
  censusEvery: exp.spec.censusEvery,
  deepEvery: exp.spec.deepEvery,
  seeds: exp.spec.seeds,
  metapopulation: exp.spec.metapopulation,
  interventions: exp.spec.interventions,
});
// Whether a run is bred: its task's config has a pondScore (one condition and seed per run, so its first segment's says).
function bred(segs: Listed[]): boolean {
  try {
    return specConfig(taskOf(segs[0]) as unknown as RunSpec).pondScore !== undefined;
  } catch {
    return false;
  }
}
function filesIneligible(segs: Listed[]): string | null {
  if (a["require-observations-verified"] && segs.some((s) => s.observationsVerified !== true))
    return "not every segment's observations were verified as matching (pass without --require-observations-verified to stitch anyway)";
  // A bred run's donor record (ponds.tsv) is what the run is for: a verifier that regenerated it differently is never
  // overridden here (null, no comparison made, stays the flag's to decide).
  const mismatched = segs.filter((s) => s.observationsVerified === false);
  if (mismatched.length && bred(segs))
    return `${mismatched.length} segment(s) of this bred run have observation files (ponds.tsv among them) that the verifier regenerated differently`;
  const unbound = segs.filter((s) => BUNDLE_FILES.some((f) => !s.files?.[f]));
  if (unbound.length) return `${unbound.length} segment(s) lack a complete, digest-recorded bundle (uploaded before the coordinator recorded file digests?)`;
  // An optional file is recorded (like every other bundle file) whenever a
  // segment's run has the corresponding mechanism configured (see
  // OPTIONAL_FILES's doc) -- not in BUNDLE_FILES, since a run without that
  // mechanism never has it, but once *any* segment of this run does, the
  // config didn't change mid-run, so every segment must: a run whose segments
  // disagree indicates a partial/corrupted record. Checked here (against the
  // coordinator's recorded file digests) so a missing one is caught before
  // `download` ever runs -- `download` and `stitchRun` enforce the same thing
  // again, defensively.
  for (const f of OPTIONAL_FILES) {
    // exchanges.tsv's and interventions.jsonl's "is this configured" come
    // from the experiment's own spec (see metapopConfigured's and scheduled's
    // docs), not file presence, and ponds.tsv's from its preset
    // (pondsConfigured); migrations.tsv and species.tsv have no equivalent
    // experiment-wide flag exposed here, so they keep the file-presence
    // inference.
    const configured = configuredFor(f, segs);
    if (configured) {
      const missing = segs.filter((s) => !s.files?.[f]);
      if (missing.length) return `${f} is configured for this run but ${missing.length} segment(s) have no recorded ${f}`;
    }
  }
  return null;
}

// The accepted history an export was made from: each segment's artifact
// digest and file digests, plus its verification metadata — a segment that
// gets verified (or whose observation comparison changes) after an earlier,
// --allow-unverified export must trigger a re-export so the stitched
// manifest's own verifiedBy/observationsVerified aren't left stale, even
// though the underlying bytes (digest/files) didn't change.
type Recorded = { digest: string | null; files: Record<string, string> | null; verifiedBy: string | null; observationsVerified: boolean | null };
const fingerprintRows = (segs: Recorded[]) => segs.map((s) => JSON.stringify([s.digest, Object.entries(s.files ?? {}).sort(([x], [y]) => x.localeCompare(y)), s.verifiedBy, s.observationsVerified]));
const fingerprint = (segs: Recorded[]) => `[${fingerprintRows(segs).join(",")}]`;
// Whether an export of `old` (its manifest's segments) is a shorter prefix of
// `segs`, row for row: a garden whose prefix grew since, over the same
// accepted history and verification metadata.
const shorterPrefix = (old: Recorded[], segs: Recorded[]) => {
  const was = fingerprintRows(old), now = fingerprintRows(segs);
  return was.length > 0 && was.length < now.length && was.every((r, i) => r === now[i]);
};

// The fingerprint of an existing export, "incomplete" if files are missing,
// "invalid-task: <why>" if its manifest does not describe the coordinator's task (taskSpecError),
// "invalid-ponds: <why>" if a pond run's ponds.tsv fails the stitch rules,
// "invalid-range: <why>" if a garden export's manifest does not cover the
// steps its days end at on the coordinator (or runs past its exportable prefix),
// "invalid-interventions: <why>" if a garden export's schedule or log fails the
// checks against the coordinator's list,
// "stale-metrics-version" if it predates the current METRICS_VERSION (which
// would otherwise never be caught: stitchRun's own version check only runs
// on a fresh re-stitch, and an unchanged fingerprint would keep this export
// forever without one), null if there is none.
// `segs` is the coordinator's *current* listing for this run (the same one `ineligible`
// checked; a garden's prefix), used only to tell whether migration is configured for it -- not
// trusted for anything else here, since the export being inspected might predate it. `total` is
// the steps the export covers (a garden's prefix's end; otherwise the experiment's steps).
// `onSegments` receives the export's own segment records when it has a manifest that passes.
// `list` is a garden's current schedule, the coordinator's (read with `segs`).
async function existing(dir: string, segs: Listed[], total: number, list?: readonly ScheduledIntervention[], onSegments?: (old: Recorded[]) => void): Promise<string | null> {
  let manifest;
  try {
    manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      try {
        await Deno.stat(dir);
        return "incomplete";
      } catch {
        return null;
      }
    }
    return "incomplete";
  }
  for (const f of BUNDLE_FILES) if (!(await Deno.stat(`${dir}/${f}`).catch(() => null))) return "incomplete";
  // An optional file isn't in BUNDLE_FILES (see OPTIONAL_FILES's doc: a run
  // without that mechanism never has one), but once the coordinator's own
  // recorded file digests for this run's segments show it does (the same
  // signal `ineligible` uses above), a local export missing it on disk is
  // incomplete. An older exporter that only ever fetched BUNDLE_FILES
  // (review 1) could otherwise produce a structurally "complete" export
  // that's silently missing this file -- its fingerprint would still match
  // (fingerprint covers accepted digests, not which files ended up on disk),
  // and it would never get rebuilt.
  for (const f of OPTIONAL_FILES) {
    if (configuredFor(f, segs) && !(await Deno.stat(`${dir}/${f}`).catch(() => null))) return "incomplete";
  }
  if ((manifest.metricsVersion ?? 1) !== METRICS_VERSION) return "stale-metrics-version";
  // A garden's export covers a prefix of its days, possibly shorter than today's (then it is replaced, not moved aside):
  // its range is where the coordinator says its last day ends (not what its own manifest claims, which the fingerprint
  // does not cover), and its manifest must say the same.
  // `segs` was listed under the run's lock, after any export now on disk was written, so an export longer than it covers
  // days that are no longer exportable (a done day reset, or an export made with --allow-unverified and this one without).
  let over = total;
  if (garden) {
    const n = Array.isArray(manifest.segments) ? manifest.segments.length : 0;
    if (n === 0) return "invalid-range: its manifest lists no days";
    if (n > segs.length) return `invalid-range: its ${n} day(s) run past the ${segs.length}-day prefix exportable now`;
    over = segs[n - 1].startStep + segs[n - 1].steps;
    if (manifest.spec?.steps !== over || manifest.summary?.steps !== over)
      return `invalid-range: its manifest covers ${manifest.spec?.steps} steps (summary ${manifest.summary?.steps}), its ${n} day(s) end at ${over}`;
    // Its schedule and log, which the fingerprint does not cover, are re-checked as stitchRun checked them when it wrote
    // them: the log is exactly the schedule's entries in [0, over], the manifest's block counts it, and the schedule is the
    // coordinator's over the same range. Read outside the try, like ponds.tsv below.
    const log = await Deno.readTextFile(`${dir}/${INTERVENTIONS_FILE}`);
    try {
      const sched: unknown = manifest.spec?.interventions;
      const errs = validateInterventions(sched);
      if (errs.length) throw new Error(`its spec's ${errs[0]}`);
      const mine = sched as ScheduledIntervention[], want = ownedInterventions(list, 0, over);
      if (mine.length !== want.length || mine.some((e, i) => !sameIntervention(e, want[i])))
        throw new Error(`its spec.interventions is not the coordinator's schedule over [0, ${over}]`);
      checkInterventionLog(dir, log, mine, manifest.cfg, 0, over, manifest.interventions);
    } catch (e) {
      return `invalid-interventions: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  // Its manifest is bound to the coordinator's task as each downloaded segment's is (taskSpecError), over the steps it
  // covers: the fingerprint covers accepted digests, not the stitched spec and config, so an export written before that
  // binding existed, or edited since (an injected overrides.pondScore, say), would otherwise be kept as "already present".
  if (segs.length) {
    const unbound = taskSpecError(manifest, { ...taskOf(segs[0]), steps: over }, { garden });
    if (unbound) return `invalid-task: ${unbound}`;
  }
  // A pond run's ponds.tsv is re-checked against the stitch rules, whole, because the fingerprint covers accepted
  // digests and not these rules: an export written by a stitcher that did not yet check each recipient, or edited
  // since, would otherwise be kept for as long as the coordinator's record is unchanged.
  if (pondsConfigured && pondCfg) {
    // Read outside the try: a file that cannot be read is an operational error to surface, not evidence the export is invalid
    // (which would move a possibly good bundle aside before its replacement is downloaded).
    const text = await Deno.readTextFile(`${dir}/${PONDS_FILE}`);
    const cfg = { ...defaultConfig(), ...pondCfg };
    try {
      // The arm is the run's own, from the manifest the stitcher wrote (the preset's is not: a nat or shuf run is a pond preset's
      // with another arm). A manifest whose config has no arm (an export older than the arm) no longer reaches here: it is not
      // the config its task builds, so taskSpecError above has already refused it.
      checkPondsFile(dir, text, cfg.pondPeriod, cfg.tilesX * cfg.tilesY, 0, over, manifest.cfg?.pondArm, manifest.cfg?.pondScore);
    } catch (e) {
      return `invalid-ponds: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  onSegments?.(manifest.segments ?? []);
  return fingerprint(manifest.segments ?? []);
}

// Moves an export out of analyze.ts's input layout (it reads only seed-<n>), keeping it for inspection.
async function quarantine(dir: string, why: string) {
  const to = `${dir}.stale-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await Deno.rename(dir, to);
  console.warn(`moved ${dir} aside to ${to}: ${why}`);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Downloads one segment's bundle, checking every file against the digest the
// coordinator recorded for the accepted attempt.
async function download(s: Listed): Promise<StitchSegment> {
  const files: Record<string, string> = {};
  for (const f of BUNDLE_FILES) {
    const bytes = new Uint8Array(await (await get(`/api/segments/${s.id}/files/${f}`)).arrayBuffer());
    const got = await sha256(bytes);
    if (got !== s.files![f]) throw new Error(`${s.run} #${s.index}: ${f} has SHA-256 ${got}, the accepted attempt recorded ${s.files![f]}`);
    files[f] = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  // The manifest is the producer's own (no verifier's digest covers it): it must describe the task it was handed.
  const unbound = taskSpecError(JSON.parse(files["manifest.json"]), taskOf(s), { garden });
  if (unbound) throw new Error(`${s.run} #${s.index}: manifest.json does not describe the coordinator's task: ${unbound}`);
  // Optional, unlike the files above: only present when this run has the
  // corresponding mechanism configured (`ineligible` already required each on
  // every segment or none).
  for (const f of OPTIONAL_FILES) {
    if (!s.files?.[f]) continue;
    const bytes = new Uint8Array(await (await get(`/api/segments/${s.id}/files/${f}`)).arrayBuffer());
    const got = await sha256(bytes);
    if (got !== s.files[f]) throw new Error(`${s.run} #${s.index}: ${f} has SHA-256 ${got}, the accepted attempt recorded ${s.files[f]}`);
    files[f] = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  return { ...s, digest: s.digest!, fileDigests: s.files, files };
}

let written = 0, kept = 0;
const skipped: string[] = [];
const exported: string[] = [];

// Exports one run: `listed` is its segments and `list` the experiment's schedule, as the coordinator lists them (for a
// garden, read under the run's lock).
async function exportRun(run: string, listed: Listed[], list: readonly ScheduledIntervention[] | undefined) {
  const dir = `${a.out}/${run}`;
  let segs = [...listed].sort((x, y) => x.index - y.index);
  let total = exp.spec.steps;
  let why: string | null = null;
  if (garden) {
    const n = stitchablePrefix(segs, a["allow-unverified"]);
    if (n === 0) why = `garden: day 0 not yet ${a["allow-unverified"] ? "done" : "verified"}`;
    else {
      segs = segs.slice(0, n);
      total = segs[n - 1].startStep + segs[n - 1].steps;
    }
  }
  let old: Recorded[] | null = null;
  const have = await existing(dir, segs, total, list, (o) => (old = o));
  why ??= ineligible(segs);
  if (why) {
    skipped.push(`${run}: ${why}`);
    if (have !== null) await quarantine(dir, `run is not exportable now: ${why}`);
    return;
  }
  const want = fingerprint(segs);
  if (have === want) {
    kept++;
    if (garden) exported.push(`${run}: ${segs.length} day(s), steps (0, ${total}]`);
    return;
  }
  // A garden's export of a shorter prefix of this same history is replaced once the new one is staged, not moved aside.
  const superseded = garden && old !== null && shorterPrefix(old, segs) ? (old as Recorded[]).length : 0;
  if (have !== null && !superseded)
    await quarantine(
      dir,
      have === "incomplete"
        ? "export is incomplete"
        : have === "stale-metrics-version"
          ? "export predates the current metrics version"
          : have.startsWith("invalid-ponds: ")
            ? `export fails the ponds.tsv check (${have.slice("invalid-ponds: ".length)})`
            : have.startsWith("invalid-task: ")
              ? `export's manifest does not describe the coordinator's task (${have.slice("invalid-task: ".length)})`
              : have.startsWith("invalid-range: ")
                ? `export's range is not its days' (${have.slice("invalid-range: ".length)})`
                : have.startsWith("invalid-interventions: ")
                  ? `export's schedule fails the check against the coordinator's (${have.slice("invalid-interventions: ".length)})`
                  : "history differs from the coordinator's accepted one",
    );

  // A garden is stitched in garden mode against the coordinator's current list; any other run as an ordinary one.
  const stitched = stitchRun(await Promise.all(segs.map(download)), total, garden ? { garden: { interventions: list as ScheduledIntervention[] } } : {});
  // Staged in a directory private to this invocation beside the destination
  // (hidden, so analyze.ts never reads it), then renamed into place: a
  // concurrent exporter or an interruption never leaves a partial bundle.
  const parent = dir.replace(/\/[^/]+$/, "");
  const leaf = dir.slice(parent.length + 1);
  await Deno.mkdir(parent, { recursive: true });
  const tmp = await Deno.makeTempDir({ dir: parent, prefix: `.${leaf}.` });
  try {
    for (const [f, text] of Object.entries(stitched)) await Deno.writeTextFile(`${tmp}/${f}`, text);
    if (superseded) {
      // Under the run's lock (no other exporter of this garden runs now). A rename onto an existing directory fails, so
      // the old prefix steps aside (hidden) first and is put back if the new one cannot take its place; it is removed
      // only once the new one is in.
      const aside = `${parent}/.${leaf}.superseded-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await Deno.rename(dir, aside);
      try {
        await Deno.rename(tmp, dir);
      } catch (e) {
        try {
          await Deno.rename(aside, dir);
        } catch (back) {
          throw new Error(`could not install ${run}'s ${segs.length}-day prefix (${e}), nor put the ${superseded}-day prefix back from ${aside} (${back})`);
        }
        throw e;
      }
      await Deno.remove(aside, { recursive: true }).catch((e) => console.warn(`could not remove the superseded ${aside}: ${e}`));
      console.log(`replaced ${run}'s ${superseded}-day prefix with a ${segs.length}-day prefix`);
    } else await Deno.rename(tmp, dir);
  } catch (e) {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
    if ((await existing(dir, segs, total, list)) !== want) throw e;
    kept++; // a concurrent exporter published the same history first
    if (garden) exported.push(`${run}: ${segs.length} day(s), steps (0, ${total}]`);
    return;
  }
  written++;
  if (garden) exported.push(`${run}: ${segs.length} day(s), steps (0, ${total}]`);
  console.log(`stitched ${run} (${segs.length} segments, ${segs.filter((s) => s.status === "verified").length} verified)`);
}

for (const [run, listed] of byRun) {
  if (!garden) {
    await exportRun(run, listed, undefined);
    continue;
  }
  // A garden's run is exported under an exclusive lock on a hidden sibling of its directory (flock: released when the
  // process exits, however it exits, so it is never stale; the file itself is left in place), and its listing and schedule
  // are read again once the lock is held: an export found on disk was then written from a listing no newer than this one.
  const dir = `${a.out}/${run}`;
  const parent = dir.replace(/\/[^/]+$/, "");
  await Deno.mkdir(parent, { recursive: true });
  const lock = await Deno.open(`${parent}/.${dir.slice(parent.length + 1)}.lock`, { create: true, write: true });
  try {
    await lock.lock(true);
    const now = await fetchExperiment();
    await exportRun(run, now.segments.filter((s) => s.run === run), now.spec.interventions as ScheduledIntervention[] | undefined);
  } finally {
    lock.close();
  }
}
for (const s of skipped) console.log(`skip ${s}`);
for (const e of exported) console.log(`garden prefix ${e}`);
console.log(`${written} written, ${kept} already present, ${skipped.length} skipped`);
if (written + kept) console.log(`analyze: deno run -A tools/analyze.ts ${a.out}/${a.experiment}/${exp.spec.presetId}`);
