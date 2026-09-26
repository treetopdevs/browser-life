// Stitches a coordinator experiment's segments into run bundles for tools/analyze.ts.
//
//   deno run -A tools/stitch.ts --experiment <name> [--coordinator http://localhost:4000] [--out runs] [--allow-unverified]
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
// proves it is that attempt's upload; verifiers replay the physics+observer
// artifact, not these observation files, so their content rests on the
// producing island). The
// coordinator is authoritative: an existing export whose run is no longer
// exportable, or whose accepted history has changed, is moved aside to
// seed-<n>.stale-<time> (outside analyze.ts's input) before anything new is written.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { BUNDLE_FILES, stitchRun, type StitchSegment } from "@bl/runner";

const a = parseArgs(Deno.args, {
  string: ["experiment", "coordinator", "out", "token"],
  boolean: ["allow-unverified"],
  default: { coordinator: "http://localhost:4000", out: "runs" },
});
if (!a.experiment) {
  console.error("usage: stitch.ts --experiment <name> [--coordinator URL] [--token T] [--out runs] [--allow-unverified]");
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
}
const exp: { spec: { steps: number; presetId: string }; segments: Listed[] } = await (await get(`/api/experiments/${encodeURIComponent(a.experiment)}`)).json();

const byRun = new Map<string, Listed[]>();
for (const s of exp.segments) byRun.set(s.run, [...(byRun.get(s.run) ?? []), s]);

// Why a run cannot be exported (yet), or null.
function ineligible(segs: Listed[]): string | null {
  const unfinished = segs.filter((s) => s.status !== "done" && s.status !== "verified");
  if (unfinished.length) return `${unfinished.length} segment(s) not done (${[...new Set(unfinished.map((s) => s.status))].join(", ")})`;
  if (!a["allow-unverified"] && segs.find((s) => s.last)?.status !== "verified") return "final segment not yet verified (pass --allow-unverified to stitch anyway)";
  const unbound = segs.filter((s) => BUNDLE_FILES.some((f) => !s.files?.[f]));
  if (unbound.length) return `${unbound.length} segment(s) lack a complete, digest-recorded bundle (uploaded before the coordinator recorded file digests?)`;
  return null;
}

// The accepted history an export was made from: each segment's artifact digest and file digests.
const fingerprint = (segs: { digest: string | null; files: Record<string, string> | null }[]) =>
  JSON.stringify(segs.map((s) => [s.digest, Object.entries(s.files ?? {}).sort(([x], [y]) => x.localeCompare(y))]));

// The fingerprint of an existing export, "incomplete" if files are missing, null if there is none.
async function existing(dir: string): Promise<string | null> {
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
  return { ...s, digest: s.digest!, fileDigests: s.files, files };
}

let written = 0, kept = 0;
const skipped: string[] = [];
for (const [run, segs] of byRun) {
  const dir = `${a.out}/${run}`;
  const have = await existing(dir);
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
  if (have !== null) await quarantine(dir, have === "incomplete" ? "incomplete bundle" : "history differs from the coordinator's accepted one");

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
    if ((await existing(dir)) !== want) throw e;
    kept++; // a concurrent exporter published the same history first
    continue;
  }
  written++;
  console.log(`stitched ${run} (${segs.length} segments, ${segs.filter((s) => s.status === "verified").length} verified)`);
}
for (const s of skipped) console.log(`skip ${s}`);
console.log(`${written} written, ${kept} already present, ${skipped.length} skipped`);
if (written + kept) console.log(`analyze: deno run -A tools/analyze.ts ${a.out}/${a.experiment}/${exp.spec.presetId}`);
