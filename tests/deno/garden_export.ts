// tools/stitch.ts exporting a garden, end to end, against a fake coordinator: no GPU, no Phoenix. A loopback HTTP server
// answers the two routes the tool reads (`GET /api/experiments/:name`, `GET /api/segments/:id/files/:file`) for one garden
// run of four 10-step days whose bundles are hand-built (the same shape as packages/runner/test/stitch.test.ts's: internally
// consistent, no relation to a real run); each day's manifest carries the list as of its assignment. The tool runs as a
// subprocess (`deno run -A tools/stitch.ts`) into a scratch --out directory, and every exported file is compared with
// stitchRun's own output for the same days in garden mode.
//
// Pass, in order:
//  1. days 0-1 verified, day 2 done: the 2-day prefix is written, steps (0, 20], its schedule the union [F, A, Q, B, P];
//  2. run again unchanged: kept, nothing written;
//  3. day 2 verified: the 3-day prefix replaces the 2-day one in place (no .stale- or .superseded- directory left);
//  4. the cached manifest's founding entry edited: moved aside (the schedule check) and written again;
//  5. the cached interventions.jsonl edited: the same;
//  5b. the cached manifest given a spec key its task never carried (overrides): the same (the aside it leaves is removed);
//  6. a listing that is stale on a process's first read (day 2 "done") and fresh after: the 3-day export is kept, not
//     moved aside (the listing is read again under the run's lock);
//  7. --allow-unverified with day 3 done: 4 days; then without it: the 4-day export is moved aside (its range runs past
//     the verified prefix) and the 3-day prefix written;
//  8. two exporters at once after day 3 is verified, sequenced by the fake coordinator rather than by timing: exporter A
//     is held at its first file download (so it holds the run's lock and has not yet replaced the 3-day export), then
//     exporter B starts and its first listing is served stale (day 3 still "done": a 3-day prefix, as on disk). While A
//     is held, B must make no second listing read (it is waiting for the lock; without the lock it would re-read at
//     once). A is then released: A writes the 4-day prefix, B re-reads under the lock, finds that export and keeps it,
//     and nothing is moved aside (without the re-read under the lock B would act on its stale 3-day listing and move the
//     4-day export aside);
//  9. the coordinator's list rewritten inside the exported range: the export refuses (exit non-zero, "not the
//     coordinator's").
//
// Run from the repo root: deno run -A tests/deno/garden_export.ts
import { METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION, clampLesionRadius } from "@bl/schema";
import { INTERVENTIONS_FILE, formatInterventionLine, ownedInterventions, runId, specConfig, stitchRun, type InterventionLogEntry, type RunSpec, type ScheduledIntervention, type StitchSegment } from "@bl/runner";

const T0 = performance.now();
try {
  console.log(`uptime: ${new TextDecoder().decode((await new Deno.Command("uptime").output()).stdout).trim()}`);
} catch {
  console.log("uptime: unavailable");
}
let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail.slice(0, 1200)}` : ""}`);
  ok &&= cond;
};

const NAME = "gx", RUN = `${NAME}/spots/treatment/seed-1`, DAY = 10, DAYS = 4;
const baseSpec: RunSpec = { experiment: NAME, presetId: "spots", condition: "treatment", seed: 1, steps: 0, censusEvery: 10, deepEvery: 1000, checkpointEvery: 0 };
const cfg = specConfig(baseSpec);
const F: ScheduledIntervention = { step: 0, kind: "lesion", x: 1, y: 2, r: 3 };
const A: ScheduledIntervention = { step: 10, kind: "lesion", x: 3, y: 3, r: 2 };
const Q: ScheduledIntervention = { step: 10, kind: "feed", x: 2, y: 6, r: 1, amount: -2, matter: -10 };
const B: ScheduledIntervention = { step: 20, kind: "lesion", x: 4, y: 4, r: 2 };
const P: ScheduledIntervention = { step: 20, kind: "feed", x: 5, y: 1, r: 2, amount: 3 };
const X: ScheduledIntervention = { step: 30, kind: "lesion", x: 5, y: 5, r: 2 }; // dropped before day 2 was assigned
const C: ScheduledIntervention = { step: 30, kind: "lesion", x: 6, y: 6, r: 2 };
const D: ScheduledIntervention = { step: 40, kind: "lesion", x: 7, y: 7, r: 2 };
const LISTS = [[F, A, Q], [F, A, Q, B, P, X], [F, A, Q, B, P, C], [F, A, Q, B, P, C, D]];
const FINAL = LISTS[3];

const logLine = (e: ScheduledIntervention): string => formatInterventionLine({ ...e, r: clampLesionRadius(cfg, e.r), ...(e.kind === "feed" ? { matter: e.matter ?? 0 } : {}) } as InterventionLogEntry);

/** Day `d`'s bundle, carrying `list` (the schedule as of its assignment). */
function day(d: number, list: ScheduledIntervention[]): StitchSegment {
  const startStep = d * DAY, end = startStep + DAY;
  const row = { step: end, individuals: 1, lineages: 1, mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, conservationOk: true };
  const owned = ownedInterventions(list, startStep, DAY);
  const manifest = {
    runId: runId(baseSpec),
    spec: { ...baseSpec, steps: DAY, interventions: list },
    cfg,
    init: "seed",
    schemaVersion: SCHEMA_VERSION,
    ruleVersion: RULE_VERSION,
    metricsVersion: METRICS_VERSION,
    host: { host: "test", adapter: "test" },
    startStep,
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(0).toISOString(),
    checkpoints: [],
    summary: { steps: end, wallSeconds: 1, stepsPerSecond: 1, finalHash: `digest-${d}`, mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0, finalIndividuals: 1, finalLineages: 1, extinct: false, conservationOk: true },
    interventions: { file: INTERVENTIONS_FILE, applied: owned.length },
  };
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify(manifest),
    "series.jsonl": JSON.stringify(row) + "\n",
    "lineages.tsv": "step\tlineage\tcells\n",
    "mutations.tsv": "childHi\tchildLo\tparentHi\tparentLo\n",
    "heredity.tsv": "step\tmuA\tmuB\tsigmaA\tsigmaB\tmassA\tmassB\n",
    "life.jsonl": "",
    "activity-final.json": "{}",
    [INTERVENTIONS_FILE]: owned.map(logLine).join(""),
  };
  return { index: d, startStep, steps: DAY, digest: `digest-${d}`, files };
}
const days = LISTS.map((l, d) => day(d, l));

const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");
const digests = await Promise.all(days.map(async (s) => Object.fromEntries(await Promise.all(Object.entries(s.files).map(async ([f, t]) => [f, await sha256(t)])))));

// The fake coordinator's state: each day's status, the experiment's current list, and an optional stale listing that the
// next experiment read of each tool process gets once (keyed by nothing but order: `staleNext` reads are served stale).
// `reads` counts experiment reads and `downloads` file requests; while `gate` is set, every file download waits on it.
const state = {
  status: ["verified", "verified", "done", "pending"],
  list: FINAL as ScheduledIntervention[],
  staleNext: 0,
  stale: null as string[] | null,
  reads: 0,
  downloads: 0,
  gate: null as Promise<void> | null,
};
const listing = (status: string[]) => ({
  spec: { experiment: NAME, presetId: "spots", steps: DAYS * DAY, segmentSteps: DAY, censusEvery: 10, deepEvery: 1000, interventions: state.list, garden: true },
  segments: days.map((s, d) => {
    const has = status[d] === "done" || status[d] === "verified";
    return {
      id: `seg-${d}`,
      run: RUN,
      // As the coordinator lists them: tools/stitch.ts binds each day's manifest to the task built from these.
      condition: baseSpec.condition,
      seed: baseSpec.seed,
      index: d,
      last: d === DAYS - 1,
      startStep: s.startStep,
      steps: s.steps,
      status: status[d],
      digest: has ? s.digest : null,
      files: has ? digests[d] : null,
      producedBy: has ? "island-a" : null,
      verifiedBy: status[d] === "verified" ? "island-b" : null,
      observationsVerified: null,
    };
  }),
});
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (req) => {
  const path = new URL(req.url).pathname;
  if (path === `/api/experiments/${NAME}`) {
    state.reads++;
    const stale = state.staleNext > 0 && state.stale !== null;
    if (stale) state.staleNext--;
    return Response.json(listing(stale ? state.stale! : state.status));
  }
  const m = /^\/api\/segments\/seg-(\d+)\/files\/(.+)$/.exec(path);
  if (m && days[Number(m[1])]?.files[m[2]] !== undefined) {
    state.downloads++;
    if (state.gate) await state.gate;
    return new Response(days[Number(m[1])].files[m[2]]);
  }
  return new Response("not found", { status: 404 });
});
const coordinator = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;

const out = await Deno.makeTempDir({ prefix: "bl-garden-export-" });
const parent = `${out}/${NAME}/spots/treatment`, dir = `${out}/${RUN}`;
const stitch = async (...extra: string[]) => {
  const r = await new Deno.Command(Deno.execPath(), { args: ["run", "--no-lock", "-A", "tools/stitch.ts", "--experiment", NAME, "--coordinator", coordinator, "--out", out, ...extra], stdout: "piped", stderr: "piped", stdin: "null" }).output();
  const dec = new TextDecoder();
  return { code: r.code, text: dec.decode(r.stdout) + dec.decode(r.stderr) };
};
/** The export's files, by name (null: no export). */
const exportFiles = async (): Promise<Record<string, string> | null> => {
  try {
    const files: Record<string, string> = {};
    for await (const e of Deno.readDir(dir)) files[e.name] = await Deno.readTextFile(`${dir}/${e.name}`);
    return files;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
};
const siblings = async () => {
  const names: string[] = [];
  for await (const e of Deno.readDir(parent)) names.push(e.name);
  return names.sort();
};
const asideCount = async (kind: "stale" | "superseded") => (await siblings()).filter((n) => n.includes(`.${kind}-`)).length;
/** Whether the export is, file for file and byte for byte, stitchRun's garden-mode output for days 0..n-1 against the current list. */
const exportIs = async (n: number): Promise<{ ok: boolean; why: string }> => {
  const want = stitchRun(days.slice(0, n), n * DAY, { garden: { interventions: state.list } });
  const have = await exportFiles();
  if (have === null) return { ok: false, why: "no export" };
  const names = [...new Set([...Object.keys(want), ...Object.keys(have)])].sort();
  // The manifest's own segment records (verifiedBy etc.) come from the listing, so the manifest is compared without them.
  const bare = (t: string) => {
    const { segments: _s, ...rest } = JSON.parse(t);
    return JSON.stringify(rest);
  };
  const differ = names.filter((f) => (f === "manifest.json" ? have[f] === undefined || bare(have[f]) !== bare(want[f]) : have[f] !== want[f]));
  const segs = have["manifest.json"] ? JSON.parse(have["manifest.json"]).segments?.length : undefined;
  return { ok: differ.length === 0 && segs === n, why: `differ: ${differ.join(", ")}; segments ${segs}` };
};
/** Resolves once `cond` holds, polling; throws after `ms`. */
const until = async (cond: () => boolean, ms: number, what: string) => {
  const t = performance.now();
  while (!cond()) {
    if (performance.now() - t > ms) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};
const manifest = async () => JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));

try {
  // 1. The verified prefix: days 0-1.
  let r = await stitch();
  let e = await exportIs(2);
  check("1. days 0-1 verified, day 2 done: the 2-day prefix is written", r.code === 0 && /1 written, 0 already present/.test(r.text) && /garden prefix .*: 2 day\(s\), steps \(0, 20\]/.test(r.text) && e.ok, `${r.text}\n${e.why}`);
  const m1 = await manifest();
  check("   its schedule is the union of what days 0-1 applied, [F, A, Q, B, P], and it covers 20 steps", JSON.stringify(m1.spec.interventions) === JSON.stringify([F, A, Q, B, P]) && m1.spec.steps === 20 && m1.interventions?.applied === 5, JSON.stringify(m1.spec));

  // 2. Unchanged: kept.
  r = await stitch();
  check("2. run again unchanged: kept", r.code === 0 && /0 written, 1 already present/.test(r.text), r.text);

  // 3. The prefix grows: replaced in place.
  state.status = ["verified", "verified", "verified", "pending"];
  r = await stitch();
  e = await exportIs(3);
  check("3. day 2 verified: the 3-day prefix replaces the 2-day one in place", r.code === 0 && /replaced .*'s 2-day prefix with a 3-day prefix/.test(r.text) && /1 written/.test(r.text) && e.ok, `${r.text}\n${e.why}`);
  check("   nothing is moved aside or left over", (await asideCount("stale")) === 0 && (await asideCount("superseded")) === 0 && (await siblings()).every((n) => n === "seed-1" || n === ".seed-1.lock"), (await siblings()).join(", "));

  // 4. A cached manifest whose founding entry was edited (its segment records, range and log untouched).
  const m3 = await manifest();
  m3.spec.interventions[0].x = 9;
  await Deno.writeTextFile(`${dir}/manifest.json`, JSON.stringify(m3));
  r = await stitch();
  e = await exportIs(3);
  check("4. an edited cached schedule is moved aside and the prefix written again", r.code === 0 && /export's schedule fails the check against the coordinator's/.test(r.text) && /1 written/.test(r.text) && e.ok && (await asideCount("stale")) === 1, `${r.text}\n${e.why}`);

  // 5. A cached log with one line edited.
  const log = await Deno.readTextFile(`${dir}/${INTERVENTIONS_FILE}`);
  await Deno.writeTextFile(`${dir}/${INTERVENTIONS_FILE}`, log.replace(`"x":4`, `"x":8`));
  r = await stitch();
  e = await exportIs(3);
  check("5. an edited cached log is moved aside and the prefix written again", r.code === 0 && /export's schedule fails the check/.test(r.text) && /interventions\.jsonl line/.test(r.text) && e.ok && (await asideCount("stale")) === 2, `${r.text}\n${e.why}`);

  // 5b. A cached manifest with a key its task never carried (Codex pass 2, slice 11): moved aside and written again. The
  // aside it leaves is removed, so the counts below are unchanged.
  const staleBefore = (await siblings()).filter((n) => n.includes(".stale-"));
  const m5 = await manifest();
  m5.spec.overrides = { pondPeriod: 7 };
  await Deno.writeTextFile(`${dir}/manifest.json`, JSON.stringify(m5));
  r = await stitch();
  e = await exportIs(3);
  const newAside = (await siblings()).filter((n) => n.includes(".stale-") && !staleBefore.includes(n));
  check("5b. a cached manifest that does not describe the coordinator's task is moved aside and written again", r.code === 0 && /export's manifest does not describe the coordinator's task \(spec carries overrides/.test(r.text) && /1 written/.test(r.text) && e.ok && newAside.length === 1, `${r.text}\n${e.why}`);
  for (const n of newAside) await Deno.remove(`${parent}/${n}`, { recursive: true });

  // 6. A process whose first listing is stale (day 2 still "done"): the listing read under the lock is the current one.
  state.stale = ["verified", "verified", "done", "pending"];
  state.staleNext = 1;
  r = await stitch();
  e = await exportIs(3);
  check("6. a stale first listing does not move the longer export aside: kept", r.code === 0 && /0 written, 1 already present/.test(r.text) && !/moved .* aside/.test(r.text) && e.ok && (await asideCount("stale")) === 2, `${r.text}\n${e.why}`);
  state.stale = null;

  // 7. --allow-unverified exports the done day 3; a verified-only export then moves that aside.
  state.status = ["verified", "verified", "verified", "done"];
  r = await stitch("--allow-unverified");
  e = await exportIs(4);
  check("7. --allow-unverified with day 3 done: the 4-day prefix replaces the 3-day one", r.code === 0 && /3-day prefix with a 4-day prefix/.test(r.text) && e.ok, `${r.text}\n${e.why}`);
  r = await stitch();
  e = await exportIs(3);
  check("   without it, the 4-day export runs past the verified prefix: moved aside, the 3-day prefix written", r.code === 0 && /run past the 3-day prefix exportable now/.test(r.text) && e.ok && (await asideCount("stale")) === 3, `${r.text}\n${e.why}`);

  // 8. Two exporters at once, sequenced by the fake coordinator (see the header): A held at its first download, B started
  // with a stale first listing, B's reads watched while A is held, then A released.
  state.status = ["verified", "verified", "verified", "verified"];
  let release = () => {};
  state.gate = new Promise<void>((r) => (release = r));
  state.downloads = 0;
  const readsBefore = state.reads;
  const pa = stitch();
  await until(() => state.downloads > 0, 120_000, "exporter A's first download");
  const readsA = state.reads - readsBefore; // A's first listing and its listing under the lock
  state.stale = ["verified", "verified", "verified", "done"];
  state.staleNext = 1;
  const pb = stitch();
  await until(() => state.reads - readsBefore > readsA, 120_000, "exporter B's first listing");
  // B now waits for the lock that A holds; give it time to (wrongly) read again or download.
  await new Promise((r) => setTimeout(r, 3000));
  const readsWhileHeld = state.reads - readsBefore - readsA, downloadsWhileHeld = state.downloads;
  release();
  state.gate = null;
  const [p, q] = await Promise.all([pa, pb]);
  state.stale = null;
  e = await exportIs(4);
  const texts = `A:\n${p.text}\n---\nB:\n${q.text}`;
  check(
    "8. while A holds the lock, B reads one listing and downloads nothing",
    readsA === 2 && readsWhileHeld === 1 && state.staleNext === 0 && downloadsWhileHeld <= DAYS,
    `A's reads ${readsA}, B's reads while A was held ${readsWhileHeld}, downloads while A was held ${downloadsWhileHeld}\n${texts}`,
  );
  check(
    "   then A writes the 4-day prefix and B, re-reading under the lock, keeps it: nothing moved aside",
    p.code === 0 && q.code === 0 && /1 written, 0 already present/.test(p.text) && /0 written, 1 already present/.test(q.text) && !/moved .* aside/.test(q.text) && e.ok && (await asideCount("stale")) === 3 && (await asideCount("superseded")) === 0,
    `${texts}\n${e.why}`,
  );

  // 9. The coordinator's list rewritten inside the exported range (day 1's letter moved): refused.
  const truth = state.list;
  state.list = truth.map((x) => (x === B ? { ...B, x: 9 } : x));
  r = await stitch();
  check("9. a coordinator list that rewrites an exported day is refused", r.code !== 0 && /the stitched schedule is not the coordinator's over \[0, 40\]/.test(r.text), r.text);
  state.list = truth;
} finally {
  await server.shutdown();
  await Deno.remove(out, { recursive: true }).catch(() => {});
}

console.log(`[${((performance.now() - T0) / 1000).toFixed(1)} s]`);
console.log(ok ? "ALL PASS" : "SOME FAILED");
Deno.exit(ok ? 0 : 1);
