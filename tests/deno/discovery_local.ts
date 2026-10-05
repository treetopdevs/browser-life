// Fault injection on the discovery shard path (PLAN Stage 3a; PRD O3, O5, O8).
//   deno run -A tests/deno/discovery_local.ts [--keep]
//
// Freezes the engineering protocol into a scratch root and drives
// tools/discovery.ts as a user would: kills a run mid-case, corrupts an
// accepted attempt's bytes, plants a wrong-observer-version attempt and a
// duplicate result, and plants a disagreeing replay. Host labels "host-a" and
// "host-b" are two labels on one machine: this exercises the plumbing and is
// not the two-physical-host proof.

import { RESULT_FILES, canonicalJSON, decodeCheckpoint, encodeCheckpoint, sha256Hex, stateHash, type CaseSpec, type ResultManifest } from "@bl/schema";
import { engineeringReadout } from "@bl/metrics";
import { decodeObservations, encodeObservations } from "../../packages/runner/src/discovery.ts";

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const root = await Deno.makeTempDir({ prefix: "bl-discovery-local-" });
const R = `${root}/campaign`;
const keep = Deno.args.includes("--keep");
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures++;
};

async function tool(args: string[]): Promise<{ code: number; out: string }> {
  const p = new Deno.Command("deno", { args: ["run", "-A", `${REPO}/tools/discovery.ts`, ...args], stdout: "piped", stderr: "piped", cwd: REPO }).outputSync();
  const out = new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr);
  return { code: p.code, out };
}

async function listDirs(p: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(p)) if (e.isDirectory) out.push(e.name);
  } catch {
    // missing
  }
  return out.sort();
}

async function readJSON<T>(p: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(p)) as T;
}

async function reseal(dir: string, r: ResultManifest, newAttempt?: { attemptId: string; host: string }): Promise<void> {
  for (const f of RESULT_FILES) {
    const b = await Deno.readFile(`${dir}/${f}`);
    r.execution.files[f] = await sha256Hex(b);
    r.execution.artifactSizes[f] = b.byteLength;
  }
  r.canonical.endArtifactDigest = r.execution.files["end.blck"];
  r.canonical.canonicalObservationDigests.observations = r.execution.files["observations.jsonl"];
  r.canonical.readoutDigest = r.execution.files["readout.json"];
  if (newAttempt) {
    r.execution.attemptId = newAttempt.attemptId;
    r.execution.physicalHostId = newAttempt.host;
  }
  await Deno.writeTextFile(`${dir}/result.json`, canonicalJSON(r));
}

async function copyDir(src: string, dst: string) {
  await Deno.mkdir(dst, { recursive: true });
  for await (const e of Deno.readDir(src)) if (e.isFile) await Deno.copyFile(`${src}/${e.name}`, `${dst}/${e.name}`);
}

// 1. Freeze.
let r = await tool(["freeze", "--protocol", `${REPO}/experiments/discovery/engineering-v1/protocol.json`, "--out", R]);
check(r.code === 0 && r.out.includes("zero simulation steps executed"), "freeze writes a new root and steps nothing");
r = await tool(["freeze", "--protocol", `${REPO}/experiments/discovery/engineering-v1/protocol.json`, "--out", R]);
check(r.code !== 0, "freeze refuses an existing root");
r = await tool(["freeze", "--protocol", `${REPO}/experiments/discovery/engineering-v1/protocol.json`, "--out", `${REPO}/apps/coordinator/data/discovery-x`]);
check(r.code !== 0 && r.out.includes("belongs to the coordinator"), "freeze refuses a root inside the coordinator's directory (O9)");
const manifest = await readJSON<{ orderedCaseIds: string[] }>(`${R}/manifest.json`);
const ids = manifest.orderedCaseIds;
const fixtureOf = async (id: string) => (await readJSON<{ fixtureId: string }>(`${R}/cases/${id}/case.json`)).fixtureId;

// 2. Kill a run mid-case: an interrupted case leaves a retained partial attempt.
const child = new Deno.Command("deno", { args: ["run", "-A", `${REPO}/tools/discovery.ts`, "run", "--root", R, "--host", "host-a", "--concurrency", "1"], stdout: "null", stderr: "null", cwd: REPO }).spawn();
const slow = (await Promise.all(ids.map(async (id) => [id, await fixtureOf(id)] as const))).find(([, f]) => f === "reacting-ledger")![0];
const t0 = Date.now();
while (Date.now() - t0 < 120_000) {
  if ((await listDirs(`${R}/cases/${slow}/attempts`)).some((d) => d.startsWith(".partial-"))) break;
  await new Promise((res) => setTimeout(res, 100));
}
await new Promise((res) => setTimeout(res, 1500));
child.kill("SIGKILL");
await child.status;
const afterKill = await listDirs(`${R}/cases/${slow}/attempts`);
check(afterKill.includes(".partial-host-a.primary.1") && !afterKill.includes("host-a.primary.1"), "a killed run leaves the in-flight attempt as a retained partial");

// 3. Rerun: one accepted primary per case; the partial is retained and never reused.
r = await tool(["run", "--root", R, "--host", "host-a"]);
check(r.code === 0, "rerun completes");
const slowDirs = await listDirs(`${R}/cases/${slow}/attempts`);
check(slowDirs.includes(".partial-host-a.primary.1") && slowDirs.includes("host-a.primary.2"), "the rerun uses a new attempt number and keeps the partial");
r = await tool(["run", "--root", R, "--host", "host-a"]);
check(r.out.includes("0 completed") && (r.out.match(/has a valid primary/g) ?? []).length === 12, "a third run validates existing results and skips all 12");

// 4. Corrupt an accepted attempt's bytes: validation rejects it and the runner reruns instead of skipping.
const victim = ids[0];
const vdir = `${R}/cases/${victim}/attempts/host-a.primary.1`;
const obs = await Deno.readFile(`${vdir}/observations.jsonl`);
obs[20] ^= 0x01;
await Deno.writeFile(`${vdir}/observations.jsonl`, obs);
r = await tool(["status", "--root", R]);
check(r.out.includes("host-a.primary.1!"), "status shows the corrupted attempt as invalid");
r = await tool(["run", "--root", R, "--host", "host-a"]);
check(r.out.includes("-> host-a.primary.2") && r.out.includes("1 completed"), "the runner validates before skipping and reruns the corrupted case");

// 5. Replays from a second label.
r = await tool(["replay", "--root", R, "--host", "host-b"]);
check(r.code === 0 && r.out.includes("12 completed"), "replay of all 12 from host-b");
r = await tool(["replay", "--root", R, "--host", "host-a"]);
check(r.out.includes("0 completed"), "host-a may not replay its own primaries");

// 6. Plant a wrong-observer-version attempt (self-consistent digests) and a duplicate result.
const w = ids[6];
const wsrc = `${R}/cases/${w}/attempts/${(await listDirs(`${R}/cases/${w}/attempts`)).find((x) => !x.startsWith("."))}`;
const wdst = `${R}/replays/${w}/host-c/host-c.replay.1`;
await copyDir(wsrc, wdst);
{
  const { state, observer } = decodeCheckpoint(await Deno.readFile(`${wdst}/end.blck`));
  (observer as { exactLedger: { version: string } }).exactLedger.version = "exact-ledger-v0";
  await Deno.writeFile(`${wdst}/end.blck`, encodeCheckpoint(state, observer));
  const res = await readJSON<ResultManifest>(`${wdst}/result.json`);
  res.execution.role = "replay";
  await reseal(wdst, res, { attemptId: "host-c.replay.1", host: "host-c" });
}
const d = ids[2];
const dsrc = `${R}/cases/${d}/attempts/host-a.primary.1`;
const ddst = `${R}/cases/${d}/attempts/host-b.primary.1`;
await copyDir(dsrc, ddst);
await reseal(ddst, await readJSON<ResultManifest>(`${ddst}/result.json`), { attemptId: "host-b.primary.1", host: "host-b" });

r = await tool(["validate", "--root", R]);
const idx = await readJSON<{ cases: { caseId: string; decision: string; attempts: { attemptId: string; valid: boolean; errors: string[] }[] }[] }>(`${R}/acceptance.json`);
const wcase = idx.cases.find((c) => c.caseId === w)!;
check(wcase.decision === "accepted" && wcase.attempts.some((a) => a.attemptId === "host-c.replay.1" && !a.valid && a.errors.some((e) => e.includes("observer version"))), "a wrong observer version is rejected; the case keeps its accepted result");
const dcase = idx.cases.find((c) => c.caseId === d)!;
check(dcase.decision === "accepted" && dcase.attempts.filter((a) => a.valid).length === 3, "a duplicate agreeing result leaves one accepted result for the case");
check(idx.cases.every((c) => c.decision === "accepted"), "all 12 cases accepted");
r = await tool(["reduce", "--root", R]);
check(r.out.startsWith("complete: 12/12"), "reduce reports complete");
const rep1 = await readJSON<{ reductionDigest: string }>(`${R}/report.json`);

// 6b. Crash boundaries and stale state.
{
  // A crash after every file was written but before the rename leaves a complete-looking partial: never accepted.
  const src = `${R}/cases/${ids[1]}/attempts/host-a.primary.1`;
  await copyDir(src, `${R}/cases/${ids[1]}/attempts/.partial-host-a.primary.9`);
  // A crash while writing the acceptance index leaves a temporary file beside it.
  await Deno.writeTextFile(`${R}/acceptance.json.tmp-crashed`, "{garbage");
  r = await tool(["validate", "--root", R]);
  const idxc = await readJSON<{ cases: { caseId: string; decision: string; attempts: { attemptId: string; partial: boolean; valid: boolean }[] }[] }>(`${R}/acceptance.json`);
  const c1 = idxc.cases.find((c) => c.caseId === ids[1])!;
  check(c1.decision === "accepted" && c1.attempts.some((a) => a.attemptId === "host-a.primary.9" && a.partial && !a.valid), "a complete but unrenamed attempt stays a partial and is never accepted");
  r = await tool(["reduce", "--root", R]);
  check(r.out.startsWith("complete"), "a leftover temporary index file does not disturb validation or reduction");
  // Results change after validation: reduce refuses the stale index.
  const dupReadout = `${R}/cases/${d}/attempts/host-b.primary.1/readout.json`;
  await Deno.writeTextFile(dupReadout, (await Deno.readTextFile(dupReadout)) + " ");
  r = await tool(["reduce", "--root", R]);
  check(r.code !== 0 && r.out.includes("stale"), "reduce refuses an acceptance index that no longer matches the files");
  await Deno.writeTextFile(`${R}/acceptance.json`, "{");
  r = await tool(["reduce", "--root", R]);
  check(r.code !== 0, "reduce refuses a truncated acceptance index");
  r = await tool(["validate", "--root", R]);
  r = await tool(["reduce", "--root", R]);
  check(r.out.startsWith("complete"), "validate rewrites the index atomically and reduction resumes");
}

// 6c. Root lock: no second writing invocation beside a live one; a killed holder's lock vanishes with it.
{
  const holder = new Deno.Command("deno", { args: ["eval", `const f = await Deno.open(${JSON.stringify(`${R}/locks/root.lock`)}, { create: true, write: true }); console.log(await f.tryLock(true)); await new Promise((r) => setTimeout(r, 60000));`], stdout: "piped" }).spawn();
  const reader = holder.stdout.getReader();
  await reader.read(); // the holder has the lock
  r = await tool(["run", "--root", R, "--host", "host-a"]);
  check(r.code !== 0 && r.out.includes("refusing to run beside it"), "a second writing invocation is refused while another holds the root");
  r = await tool(["validate", "--root", R]);
  check(r.code !== 0 && r.out.includes("refusing to run beside it"), "validation also waits its turn");
  holder.kill("SIGKILL");
  await holder.status;
  reader.releaseLock();
  r = await tool(["run", "--root", R, "--host", "host-a"]);
  check(r.code === 0, "the lock of a killed holder is gone; work resumes");
}

// 7. Export, and reproduce the reduction from the export alone.
r = await tool(["export", "--root", R, "--out", `${root}/export`]);
check(r.code === 0, "export");
await tool(["validate", "--root", `${root}/export`]);
await tool(["reduce", "--root", `${root}/export`]);
const rep2 = await readJSON<{ reductionDigest: string }>(`${root}/export/report.json`);
check(rep1.reductionDigest === rep2.reductionDigest, "the export reproduces the reduction digest");
const sums = await Deno.readTextFile(`${root}/export/SHA256SUMS`);
check(sums.includes("manifest.json") && sums.includes("acceptance.json") && (await Deno.stat(`${root}/export/rejected.json`)).isFile, "the export carries manifest, acceptance index, rejected attempts and hashes");

// 8. A disagreeing replay (different physics, self-consistent) quarantines its case and keeps both attempts.
const q = ids[4];
const qsrc = `${R}/replays/${q}/host-b/host-b.replay.1`;
const qdst = `${R}/replays/${q}/host-d/host-d.replay.1`;
await copyDir(qsrc, qdst);
{
  const { state, observer } = decodeCheckpoint(await Deno.readFile(`${qdst}/end.blck`));
  const n = state.cfg.tileW * state.cfg.tileH;
  state.cells[1] += 1; // channel A, which holds nutrient everywhere
  state.cells[2] -= 1;
  await Deno.writeFile(`${qdst}/end.blck`, encodeCheckpoint(state, observer));
  const res = await readJSON<ResultManifest>(`${qdst}/result.json`);
  res.canonical.endStateHash = stateHash(state);
  await reseal(qdst, res, { attemptId: "host-d.replay.1", host: "host-d" });
}
r = await tool(["validate", "--root", R]);
let idx2 = await readJSON<{ cases: { caseId: string; decision: string; attempts: { attemptId: string; valid: boolean }[] }[] }>(`${R}/acceptance.json`);
// Its last census no longer matches its end state, so it is rejected before any comparison.
check(idx2.cases.find((c) => c.caseId === q)!.decision === "accepted", "a replay whose end state disagrees with its own observations is rejected, not trusted");
{
  // Now make it fully self-consistent: observations and readout follow the changed end state.
  const { state } = decodeCheckpoint(await Deno.readFile(`${qdst}/end.blck`));
  const recs = decodeObservations(await Deno.readFile(`${qdst}/observations.jsonl`));
  const last = [...recs].reverse().find((x) => x.kind === "census") as { stateHash: string };
  last.stateHash = stateHash(state);
  await Deno.writeFile(`${qdst}/observations.jsonl`, encodeObservations(recs));
  const spec = await readJSON<CaseSpec>(`${R}/cases/${q}/case.json`);
  await Deno.writeTextFile(`${qdst}/readout.json`, canonicalJSON(engineeringReadout(spec, recs)));
  await reseal(qdst, await readJSON<ResultManifest>(`${qdst}/result.json`));
}
r = await tool(["validate", "--root", R]);
idx2 = await readJSON(`${R}/acceptance.json`);
const qcase = idx2.cases.find((c) => c.caseId === q)!;
check(qcase.decision === "quarantined" && qcase.attempts.length === 3 && qcase.attempts.every((a) => a.valid), "two valid but disagreeing hosts quarantine the case and keep every attempt");
r = await tool(["reduce", "--root", R]);
check(r.out.startsWith("quarantined"), "the reduction reports the quarantine instead of a complete campaign");

// 9. Hard caps: storage and campaign wall time stop the campaign as incomplete, never silently.
{
  const proto = JSON.parse(await Deno.readTextFile(`${REPO}/experiments/discovery/engineering-v1/protocol.json`));
  proto.campaign = "caps-test";
  proto.resourceLimits.campaignBytes = 2_900_000;
  await Deno.writeTextFile(`${root}/caps-protocol.json`, JSON.stringify(proto));
  r = await tool(["freeze", "--protocol", `${root}/caps-protocol.json`, "--out", `${root}/caps`]);
  r = await tool(["run", "--root", `${root}/caps`, "--host", "host-a", "--concurrency", "4"]);
  const capsBytes = await (async function walk(p: string): Promise<number> {
    let t = 0;
    for await (const e of Deno.readDir(p)) t += e.isDirectory ? await walk(`${p}/${e.name}`) : (await Deno.stat(`${p}/${e.name}`)).size;
    return t;
  })(`${root}/caps`);
  check(r.out.includes("storage cap") && r.out.includes("incomplete") && capsBytes <= 2_900_000 + 64_000, `the storage cap stops publication before it is exceeded (${capsBytes} bytes on disk)`);
  proto.campaign = "wall-test";
  proto.resourceLimits.campaignBytes = 2_000_000_000;
  proto.resourceLimits.campaignWallSeconds = 3;
  await Deno.writeTextFile(`${root}/wall-protocol.json`, JSON.stringify(proto));
  await tool(["freeze", "--protocol", `${root}/wall-protocol.json`, "--out", `${root}/wall`]);
  const t0 = Date.now();
  r = await tool(["run", "--root", `${root}/wall`, "--host", "host-a", "--concurrency", "1"]);
  const took = (Date.now() - t0) / 1000;
  check(r.out.includes("wall-time") && took < 15, `the campaign wall-time cap ends running cases too (${took.toFixed(1)} s for a 3 s cap)`);
  r = await tool(["run", "--root", `${root}/wall`, "--host", "host-a"]);
  check(r.out.includes("wall-time cap") && r.out.includes("0 completed"), "the used time persists across invocations");
}

console.log(failures ? `${failures} FAILED (root ${root})` : `all passed${keep ? ` (root ${root})` : ""}`);
if (!keep && !failures) await Deno.remove(root, { recursive: true });
Deno.exit(failures ? 1 : 0);
