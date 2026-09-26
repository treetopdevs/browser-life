// Stitches a coordinator experiment's segments into run bundles for tools/analyze.ts.
//
//   deno run -A tools/stitch.ts --experiment <name> [--coordinator http://localhost:4000] [--out runs] [--allow-unverified] [--require-observations-verified]
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
// the physics+observer digest alone). The
// coordinator is authoritative: an existing export whose run is no longer
// exportable, or whose accepted history has changed (including its
// verification metadata, or a metrics-version bump since it was written), is
// moved aside to seed-<n>.stale-<time> (outside analyze.ts's input) before
// anything new is written.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { METRICS_VERSION } from "@bl/schema";
import { BUNDLE_FILES, MIGRATIONS_FILE, stitchRun, type StitchSegment } from "@bl/runner";

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
const exp: { spec: { steps: number; presetId: string }; segments: Listed[] } = await (await get(`/api/experiments/${encodeURIComponent(a.experiment)}`)).json();

const byRun = new Map<string, Listed[]>();
for (const s of exp.segments) byRun.set(s.run, [...(byRun.get(s.run) ?? []), s]);

// Segments whose verify attempt's regenerated observation files disagree with
// the accepted upload's — printed regardless of a run's export eligibility,
// since this is informational (run correctness rests on the physics+observer
// digest alone; see packages/runner/src/stitch.ts's `StitchSegment` doc).
for (const s of exp.segments) if (s.observationsVerified === false) console.warn(`WARNING: ${s.run} #${s.index}: observation files mismatch (producedBy ${s.producedBy}, verifiedBy ${s.verifiedBy})`);

// Why a run cannot be exported (yet), or null.
function ineligible(segs: Listed[]): string | null {
  const unfinished = segs.filter((s) => s.status !== "done" && s.status !== "verified");
  if (unfinished.length) return `${unfinished.length} segment(s) not done (${[...new Set(unfinished.map((s) => s.status))].join(", ")})`;
  if (!a["allow-unverified"] && segs.find((s) => s.last)?.status !== "verified") return "final segment not yet verified (pass --allow-unverified to stitch anyway)";
  if (a["require-observations-verified"] && segs.some((s) => s.observationsVerified !== true))
    return "not every segment's observations were verified as matching (pass without --require-observations-verified to stitch anyway)";
  const unbound = segs.filter((s) => BUNDLE_FILES.some((f) => !s.files?.[f]));
  if (unbound.length) return `${unbound.length} segment(s) lack a complete, digest-recorded bundle (uploaded before the coordinator recorded file digests?)`;
  // migrations.tsv is recorded (like every other bundle file) whenever a segment's
  // run had migration configured (see runner.ts) -- not in BUNDLE_FILES, since a
  // migration-disabled run never has it, but once *any* segment of this run does,
  // the config didn't change mid-run, so every segment must: a run whose segments
  // disagree indicates a partial/corrupted record, not a legitimately
  // migration-disabled one. Checked here (against the coordinator's recorded file
  // digests) so a missing one is caught before `download` ever runs -- `download`
  // and `stitchRun` enforce the same thing again, defensively.
  const migrating = segs.some((s) => s.files?.[MIGRATIONS_FILE]);
  if (migrating) {
    const missing = segs.filter((s) => !s.files?.[MIGRATIONS_FILE]);
    if (missing.length) return `migration is configured for this run but ${missing.length} segment(s) have no recorded ${MIGRATIONS_FILE}`;
  }
  return null;
}

// The accepted history an export was made from: each segment's artifact
// digest and file digests, plus its verification metadata — a segment that
// gets verified (or whose observation comparison changes) after an earlier,
// --allow-unverified export must trigger a re-export so the stitched
// manifest's own verifiedBy/observationsVerified aren't left stale, even
// though the underlying bytes (digest/files) didn't change.
const fingerprint = (segs: { digest: string | null; files: Record<string, string> | null; verifiedBy: string | null; observationsVerified: boolean | null }[]) =>
  JSON.stringify(segs.map((s) => [s.digest, Object.entries(s.files ?? {}).sort(([x], [y]) => x.localeCompare(y)), s.verifiedBy, s.observationsVerified]));

// The fingerprint of an existing export, "incomplete" if files are missing,
// "stale-metrics-version" if it predates the current METRICS_VERSION (which
// would otherwise never be caught: stitchRun's own version check only runs
// on a fresh re-stitch, and an unchanged fingerprint would keep this export
// forever without one), null if there is none.
// `segs` is the coordinator's *current* listing for this run (the same one `ineligible`
// checked), used only to tell whether migration is configured for it -- not trusted for
// anything else here, since the export being inspected might predate it.
async function existing(dir: string, segs: Listed[]): Promise<string | null> {
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
  // migrations.tsv isn't in BUNDLE_FILES (see MIGRATIONS_FILE's doc: a
  // migration-disabled run never has one), but once the coordinator's own
  // recorded file digests for this run's segments show it does (the same
  // signal `ineligible` uses above), a local export missing it on disk is
  // incomplete. An older exporter that only ever fetched BUNDLE_FILES
  // (review 1) could otherwise produce a structurally "complete" export
  // that's silently missing this file -- its fingerprint would still match
  // (fingerprint covers accepted digests, not which files ended up on disk),
  // and it would never get rebuilt.
  if (segs.some((s) => s.files?.[MIGRATIONS_FILE]) && !(await Deno.stat(`${dir}/${MIGRATIONS_FILE}`).catch(() => null))) return "incomplete";
  if ((manifest.metricsVersion ?? 1) !== METRICS_VERSION) return "stale-metrics-version";
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
  // Optional, unlike the files above: only present when this run had migration
  // configured (`ineligible` already required it on every segment or none).
  if (s.files?.[MIGRATIONS_FILE]) {
    const bytes = new Uint8Array(await (await get(`/api/segments/${s.id}/files/${MIGRATIONS_FILE}`)).arrayBuffer());
    const got = await sha256(bytes);
    if (got !== s.files[MIGRATIONS_FILE]) throw new Error(`${s.run} #${s.index}: ${MIGRATIONS_FILE} has SHA-256 ${got}, the accepted attempt recorded ${s.files[MIGRATIONS_FILE]}`);
    files[MIGRATIONS_FILE] = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  return { ...s, digest: s.digest!, fileDigests: s.files, files };
}

let written = 0, kept = 0;
const skipped: string[] = [];
for (const [run, segs] of byRun) {
  const dir = `${a.out}/${run}`;
  const have = await existing(dir, segs);
  const why = ineligible(segs);
  if (why) {
    skipped.push(`${run}: ${why}`);
    if (have !== null) await quarantine(dir, `run is not exportable now: ${why}`);
    continue;
  }
  const want = fingerprint(segs);
  if (have === want) {
    kept++;
    continue;
  }
  if (have !== null)
    await quarantine(
      dir,
      have === "incomplete"
        ? "incomplete bundle"
        : have === "stale-metrics-version"
          ? "export predates the current metrics version"
          : "history differs from the coordinator's accepted one",
    );

  const stitched = stitchRun(await Promise.all(segs.map(download)), exp.spec.steps);
  // Staged in a directory private to this invocation beside the destination
  // (hidden, so analyze.ts never reads it), then renamed into place: a
  // concurrent exporter or an interruption never leaves a partial bundle.
  const parent = dir.replace(/\/[^/]+$/, "");
  await Deno.mkdir(parent, { recursive: true });
  const tmp = await Deno.makeTempDir({ dir: parent, prefix: `.${dir.slice(parent.length + 1)}.` });
  try {
    for (const [f, text] of Object.entries(stitched)) await Deno.writeTextFile(`${tmp}/${f}`, text);
    await Deno.rename(tmp, dir);
  } catch (e) {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
    if ((await existing(dir, segs)) !== want) throw e;
    kept++; // a concurrent exporter published the same history first
    continue;
  }
  written++;
  console.log(`stitched ${run} (${segs.length} segments, ${segs.filter((s) => s.status === "verified").length} verified)`);
}
for (const s of skipped) console.log(`skip ${s}`);
console.log(`${written} written, ${kept} already present, ${skipped.length} skipped`);
if (written + kept) console.log(`analyze: deno run -A tools/analyze.ts ${a.out}/${a.experiment}/${exp.spec.presetId}`);
