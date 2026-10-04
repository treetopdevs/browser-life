// Discovery workbench, local shard path (PLAN Stage 3a; DESIGN section 5).
//
//   deno run -A tools/discovery.ts freeze   --protocol experiments/discovery/<campaign>/protocol.json --out <root>
//   deno run -A tools/discovery.ts run      --root <root> --shard 0/2 --host <label> [--concurrency N]
//   deno run -A tools/discovery.ts replay   --root <root> --shard 0/1 --host <label> [--concurrency N]
//   deno run -A tools/discovery.ts validate --root <root>
//   deno run -A tools/discovery.ts reduce   --root <root>
//   deno run -A tools/discovery.ts export   --root <root> --out <dir>
//   deno run -A tools/discovery.ts stats    --root <root>
//   deno run -A tools/discovery.ts status   --root <root>
//   deno run -A tools/discovery.ts check-attempt --manifest <manifest.json> --case <case.json> --attempt <dir>
//   deno run -A tools/discovery.ts submit   --root <root> --coordinator URL [--admin-token T] [--qualify <caseId>]
//   deno run -A tools/discovery.ts collect  --coordinator URL --campaign <manifest digest> --out <dir> [--admin-token T]
//
// check-attempt is the validator the coordinator runs on every uploaded
// attempt (one JSON verdict line). submit registers a frozen root with the
// discovery plane, pinning the qualification case's accepted canonical result
// from this root; collect exports a plane campaign into the same layout, so
// validate and reduce read it exactly as they read a shard run.
//
// Research roots live under runs/discovery/ (or any directory outside the
// coordinator's data directory); freeze refuses a root inside it. Collection
// across hosts is a directory copy: attempt names carry the host label, so two
// machines' results never overwrite each other. `validate` writes the
// acceptance index; `reduce` reads it. Every case runs on the CPU reference;
// no GPU is requested.

import { resolve } from "node:path";
import { RESULT_FILES, canonicalJSON, sha256Hex, type CaseSpec, type DiscoveryProtocol, type ResultManifest, type SeedReservation } from "@bl/schema";
import { campaignCoreDigest, caseIdOf, type CampaignManifest } from "@bl/schema";
import { CPU_BACKEND, caseContextErrors, freezeCampaign, reduceCampaign, reportMarkdown, validateAttempt, type AcceptanceIndex, type CaseFiles } from "../packages/runner/src/discovery.ts";
import { closureDigest } from "./lib/discovery-closure.ts";
import {
  buildAcceptanceIndex,
  checkAttempt,
  dirBytes,
  exists,
  listAttempts,
  loadCampaign,
  publishAttempt,
  readAttemptFiles,
  readInitial,
  mkdirDurable,
  syncDir,
  writeAtomic,
  writeDurable,
  type Campaign,
} from "./lib/discovery-fs.ts";

const enc = new TextEncoder();
const REPO = resolve(new URL("..", import.meta.url).pathname);
const HOST_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const USAGE_TICK_MS = 5000;

function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) throw new Error(`unexpected argument ${args[i]}`);
    const k = args[i].slice(2);
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) out[k] = "true";
    else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

function need(f: Record<string, string>, k: string): string {
  if (!f[k]) throw new Error(`--${k} is required`);
  return f[k];
}

function shardOf(s: string): { i: number; n: number } {
  const m = /^(\d+)\/(\d+)$/.exec(s);
  if (!m || +m[2] < 1 || +m[1] >= +m[2]) throw new Error(`--shard must be i/N with 0 <= i < N, got ${s}`);
  return { i: +m[1], n: +m[2] };
}

/** The real path of `p`: the real path of its deepest existing ancestor, plus the rest. Follows symlinks. */
function realish(p: string): string {
  let head = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return [Deno.realPathSync(head), ...tail].join("/");
    } catch {
      const up = resolve(head, "..");
      if (up === head) return resolve(p);
      tail.unshift(head.slice(up.length + 1));
      head = up;
    }
  }
}

const inside = (a: string, b: string) => a === b || a.startsWith(b.endsWith("/") ? b : b + "/");

/** O9: research roots stay out of the coordinator's directories, through symlinks too. */
function assertResearchRoot(root: string): void {
  const r = realish(root);
  const forbidden = [resolve(REPO, "apps/coordinator"), ...["BL_DATA_DIR", "BL_DISCOVERY_DATA_DIR"].flatMap((k) => (Deno.env.get(k) ? [resolve(Deno.env.get(k)!)] : []))].map(realish);
  for (const f of forbidden) if (inside(r, f)) throw new Error(`refusing research root ${r}: inside ${f}, which belongs to the coordinator`);
}

/**
 * One writing invocation per campaign root at a time, whatever its host
 * label, so concurrency, attempt and storage caps cannot be bypassed by a
 * second invocation. A kernel advisory lock (flock): it is released when the
 * holding process exits or is killed, so there is no stale lock to take over.
 */
async function acquireRootLock(root: string): Promise<() => void> {
  await Deno.mkdir(`${root}/locks`, { recursive: true });
  const f = await Deno.open(`${root}/locks/root.lock`, { create: true, write: true });
  if (!(await f.tryLock(true))) {
    f.close();
    throw new Error(`another invocation is working on ${root}; refusing to run beside it`);
  }
  await f.truncate(0);
  await f.write(enc.encode(JSON.stringify({ pid: Deno.pid, hostname: Deno.hostname(), at: new Date().toISOString() }) + "\n"));
  return () => f.close();
}

async function appendLog(root: string, entry: Record<string, unknown>): Promise<void> {
  await Deno.writeTextFile(`${root}/runlog.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", { append: true });
}

// ---------------------------------------------------------------------------

async function freeze(f: Record<string, string>): Promise<void> {
  const protoPath = need(f, "protocol");
  const out = resolve(need(f, "out"));
  assertResearchRoot(out);
  const protoText = await Deno.readTextFile(protoPath);
  const protocol = JSON.parse(protoText) as DiscoveryProtocol;
  const registry = (JSON.parse(await Deno.readTextFile(f.registry ?? `${REPO}/experiments/discovery/seed-registry.json`)) as { reservations: SeedReservation[] }).reservations;
  const closure = closureDigest(REPO);
  const frozen = await freezeCampaign(protocol, { sourceClosureDigest: closure.digest, registry });
  await mkdirDurable(resolve(out, ".."));
  await Deno.mkdir(out); // exclusive: fails if the root exists
  await syncDir(resolve(out, ".."));
  await Deno.mkdir(`${out}/initial`);
  await Deno.mkdir(`${out}/cases`);
  await Deno.mkdir(`${out}/replays`);
  await writeDurable(`${out}/protocol.json`, enc.encode(protoText));
  await writeDurable(`${out}/source-closure.json`, enc.encode(JSON.stringify(closure, null, 1) + "\n"));
  for (const [d, bytes] of frozen.initialArtifacts) await writeDurable(`${out}/initial/${d}.blck`, bytes);
  for (const { caseId, spec } of frozen.cases) {
    await Deno.mkdir(`${out}/cases/${caseId}/attempts`, { recursive: true });
    await writeDurable(`${out}/cases/${caseId}/case.json`, enc.encode(canonicalJSON(spec)));
    await syncDir(`${out}/cases/${caseId}`);
  }
  for (const d of ["initial", "cases", "replays"]) await syncDir(`${out}/${d}`);
  await writeDurable(`${out}/manifest.json`, enc.encode(canonicalJSON(frozen.manifest)));
  await writeDurable(`${out}/MANIFEST-DIGEST`, enc.encode(frozen.manifestDigest + "\n"));
  await syncDir(out);
  const m = frozen.manifest;
  const steps = frozen.cases.reduce((a, c) => a + c.spec.steps, 0);
  console.log(
    [
      `froze ${m.campaign} (${m.purpose}) at ${out}`,
      `question: ${m.question}`,
      `cases: ${frozen.cases.length} (${m.resolvedParameterDomain.length} fixtures x ${m.seedNamespaces.blocks.length} blocks, ${m.assayDefinitions.length} assays), ${steps.toLocaleString()} simulation steps per full pass; replay policy ${m.verificationPolicy.replay} doubles executions`,
      `controls: ${m.assayDefinitions.map((a) => a.assayId).join(", ")}`,
      `caps: ${JSON.stringify(m.resourceLimits)}`,
      `budget: not yet measured for this campaign; run shards, then \`stats\``,
      `manifest ${frozen.manifestDigest}`,
      `campaign core ${frozen.campaignDigest}`,
      `source closure ${m.sourceClosureDigest} (${closure.files.length} files)`,
      "zero simulation steps executed",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------

interface Job {
  caseId: string;
  spec: CaseSpec;
  role: "primary" | "replay";
}

async function plan(c: Campaign, role: "primary" | "replay", host: string, shard: { i: number; n: number }): Promise<{ jobs: Job[]; skipped: string[] }> {
  const jobs: Job[] = [];
  const skipped: string[] = [];
  const cap = c.manifest.resourceLimits.attemptsPerCasePerRole;
  for (const [idx, caseId] of c.manifest.orderedCaseIds.entries()) {
    if (idx % shard.n !== shard.i) continue;
    const spec = c.specs.get(caseId)!;
    if (spec.requiredBackendContract !== CPU_BACKEND) {
      skipped.push(`${caseId}: requires backend ${spec.requiredBackendContract}; this host provides ${CPU_BACKEND} only`);
      continue;
    }
    const attempts = await listAttempts(c.root, caseId);
    const infos = await Promise.all(attempts.map((a) => checkAttempt(c, caseId, a)));
    const validPrimaries = infos.filter((a) => a.role === "primary" && a.verdict.valid);
    const tried = attempts.filter((a) => a.role === role).length;
    if (role === "primary") {
      if (validPrimaries.length) {
        skipped.push(`${caseId}: has a valid primary (${validPrimaries[0].attemptId})`);
        continue;
      }
    } else {
      if (!validPrimaries.length) {
        skipped.push(`${caseId}: no valid primary to replay yet`);
        continue;
      }
      if (validPrimaries.every((a) => a.physicalHostId === host)) {
        skipped.push(`${caseId}: every valid primary ran on ${host}; a replay must come from another physical host`);
        continue;
      }
      if (infos.some((a) => a.role === "replay" && a.verdict.valid && a.physicalHostId === host)) {
        skipped.push(`${caseId}: already has a valid replay from ${host}`);
        continue;
      }
    }
    if (tried >= cap) {
      skipped.push(`${caseId}: ${role} attempt cap (${cap}) reached; case stays incomplete`);
      continue;
    }
    jobs.push({ caseId, spec, role });
  }
  return { jobs, skipped };
}

async function nextAttemptDir(c: Campaign, job: Job, host: string): Promise<{ attemptId: string; partial: string; final: string }> {
  const base = job.role === "primary" ? `${c.root}/cases/${job.caseId}/attempts` : `${c.root}/replays/${job.caseId}/${host}`;
  await mkdirDurable(base);
  for (let k = 1; ; k++) {
    const attemptId = `${host}.${job.role}.${k}`;
    const final = `${base}/${attemptId}`;
    const partial = `${base}/.partial-${attemptId}`;
    if ((await exists(final)) || (await exists(partial))) continue;
    try {
      await Deno.mkdir(partial); // exclusive claim of this attempt number
    } catch (e) {
      if (e instanceof Deno.errors.AlreadyExists) continue;
      throw e;
    }
    return { attemptId, partial, final };
  }
}

/** Campaign wall time already used: the largest usage tick of every earlier invocation, killed ones included. */
async function priorWallMs(root: string): Promise<number> {
  if (!(await exists(`${root}/runlog.jsonl`))) return 0;
  const used = new Map<string, { ms: number; ended: boolean }>();
  for (const line of (await Deno.readTextFile(`${root}/runlog.jsonl`)).split("\n")) {
    if (!line.trim()) continue;
    let e: { invocation?: string; wallMs?: number; event?: string };
    try {
      e = JSON.parse(line);
    } catch {
      continue; // a line torn by a crash
    }
    if (e.invocation && (e.event === "invocation-start" || e.event === "usage" || e.event === "invocation-end")) {
      const u = used.get(e.invocation) ?? { ms: 0, ended: false };
      if (typeof e.wallMs === "number") u.ms = Math.max(u.ms, e.wallMs);
      if (e.event === "invocation-end") u.ended = true;
      used.set(e.invocation, u);
    }
  }
  // An invocation without an end record was killed: charge it the longest untracked gap, one usage interval.
  return [...used.values()].reduce((a, u) => a + u.ms + (u.ended ? 0 : USAGE_TICK_MS), 0);
}

function runInWorker(spec: CaseSpec, initial: Uint8Array, opts: Record<string, unknown>, timeoutMs: number): Promise<{ result: ResultManifest; files: CaseFiles }> {
  return new Promise((res, rej) => {
    const w = new Worker(new URL("./discovery-case-worker.ts", import.meta.url).href, { type: "module" });
    const timer = setTimeout(() => {
      w.terminate();
      rej(new Error(`case exceeded its wall-time limit (${timeoutMs / 1000} s); worker terminated`));
    }, timeoutMs);
    w.onmessage = (ev) => {
      clearTimeout(timer);
      w.terminate();
      const d = ev.data as { ok: boolean; error?: string; result?: ResultManifest; files?: CaseFiles };
      d.ok ? res({ result: d.result!, files: d.files! }) : rej(new Error(d.error));
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      w.terminate();
      e.preventDefault();
      rej(new Error(e.message));
    };
    w.postMessage({ spec, initial, opts });
  });
}

async function execute(f: Record<string, string>, role: "primary" | "replay"): Promise<void> {
  const root = resolve(need(f, "root"));
  assertResearchRoot(root);
  const host = need(f, "host");
  if (!HOST_RE.test(host)) throw new Error(`--host must match ${HOST_RE}`);
  const shard = shardOf(f.shard ?? "0/1");
  const c = await loadCampaign(root);
  const closure = closureDigest(REPO);
  if (closure.digest !== c.manifest.sourceClosureDigest)
    throw new Error(`source closure of this checkout (${closure.digest}) differs from the manifest's (${c.manifest.sourceClosureDigest}); refusing to run`);
  const lim = c.manifest.resourceLimits;
  const concurrency = Math.max(1, Math.min(lim.concurrentCasesPerHost, f.concurrency ? +f.concurrency : lim.concurrentCasesPerHost));
  const maxCases = f["max-cases"] ? +f["max-cases"] : Infinity;
  const release = await acquireRootLock(root);
  let planned: Awaited<ReturnType<typeof plan>>;
  try {
    planned = await plan(c, role, host, shard);
  } catch (e) {
    release();
    throw e;
  }
  const { jobs, skipped } = planned;
  for (const s of skipped) console.log(`skip ${s}`);
  const t0 = Date.now();
  const prior = await priorWallMs(root);
  const invocation = crypto.randomUUID();
  const campaignDeadline = t0 + lim.campaignWallSeconds * 1000 - prior;
  await appendLog(root, { event: "invocation-start", invocation, role, host, shard: f.shard ?? "0/1", jobs: jobs.length, concurrency });
  // Persist usage while running, so a killed invocation still counts against the campaign cap.
  const ticker = setInterval(() => void appendLog(root, { event: "usage", invocation, wallMs: Date.now() - t0 }).catch(() => {}), USAGE_TICK_MS);
  let publishing = Promise.resolve();
  const queue = jobs.slice(0, maxCases === Infinity ? jobs.length : maxCases);
  let done = 0;
  let failed = 0;
  let stopped = "";
  const backendBuild = `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch} ${CPU_BACKEND}`;
  const worker = async () => {
    while (!stopped) {
      // Take the job before any await, so concurrent loops never race for the last one.
      const job = queue.shift();
      if (!job) break;
      if (Date.now() >= campaignDeadline) {
        stopped = `campaign wall-time cap (${lim.campaignWallSeconds} s) reached`;
        break;
      }
      const bytes = await dirBytes(root);
      if (bytes > lim.campaignBytes) {
        stopped = `campaign storage cap (${lim.campaignBytes} bytes) reached at ${bytes}`;
        break;
      }
      const slot = await nextAttemptDir(c, job, host);
      await Deno.writeTextFile(`${slot.partial}/started.json`, JSON.stringify({ attemptId: slot.attemptId, role, host, at: new Date().toISOString() }) + "\n");
      const opts = {
        attemptId: slot.attemptId,
        role,
        leaseId: null,
        workerId: `${host}-cli`,
        physicalHostId: host,
        backendBuild,
        sourceClosureDigest: closure.digest,
        deadline: Math.min(Date.now() + lim.caseWallSeconds * 1000, campaignDeadline),
      };
      try {
        const initial = await readInitial(c, job.spec);
        // The case's own limit, cut short by the campaign's remaining time: the worker is terminated at whichever comes first.
        const out = await runInWorker(job.spec, initial, opts, Math.max(1, Math.min(lim.caseWallSeconds * 1000 + 5000, campaignDeadline - Date.now())));
        // Publications are serialized and checked against the storage cap with their own bytes counted.
        const turn = publishing.then(async () => {
          const adding = RESULT_FILES.reduce((a, k) => a + out.files[k].byteLength, 0) + 4096;
          const have = await dirBytes(root);
          if (have + adding > lim.campaignBytes) throw new Error(`campaign storage cap (${lim.campaignBytes} bytes) would be exceeded (${have} + ${adding}); result not published`);
          await publishAttempt(slot.partial, slot.final, out.result, out.files);
        });
        publishing = turn.catch(() => {});
        await turn;
        done++;
        console.log(`${role} ${job.caseId.slice(0, 12)} ${job.spec.fixtureId}/${job.spec.blockId} -> ${slot.attemptId} ${(out.result.execution.measuredWallMs / 1000).toFixed(1)} s`);
        await appendLog(root, { event: "attempt-complete", caseId: job.caseId, attemptId: slot.attemptId, wallMs: out.result.execution.measuredWallMs });
      } catch (e) {
        failed++;
        console.error(`${role} ${job.caseId.slice(0, 12)} ${job.spec.fixtureId}/${job.spec.blockId} FAILED (${slot.attemptId}, partial retained): ${(e as Error).message}`);
        if ((e as Error).message.includes("storage cap")) stopped = (e as Error).message;
        await Deno.writeTextFile(`${slot.partial}/failure.json`, JSON.stringify({ error: (e as Error).message, at: new Date().toISOString() }) + "\n");
        await appendLog(root, { event: "attempt-failed", caseId: job.caseId, attemptId: slot.attemptId, error: (e as Error).message });
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    clearInterval(ticker);
    release();
  }
  const wallMs = Date.now() - t0;
  await appendLog(root, { event: "invocation-end", invocation, role, host, done, failed, stopped, wallMs });
  console.log(`${role}: ${done} completed, ${failed} failed, ${skipped.length} skipped${stopped ? `; stopped: ${stopped}` : ""} (${(wallMs / 1000).toFixed(1)} s)`);
  if (stopped) console.log("a cap was reached: the campaign is incomplete, and no case was dropped or changed");
}

// ---------------------------------------------------------------------------

async function validate(f: Record<string, string>): Promise<AcceptanceIndex> {
  const root = resolve(need(f, "root"));
  assertResearchRoot(root);
  const release = await acquireRootLock(root);
  try {
  const c = await loadCampaign(root);
  const idx = await buildAcceptanceIndex(c);
  await writeAtomic(`${root}/acceptance.json`, enc.encode(canonicalJSON(idx)));
  const count = (d: string) => idx.cases.filter((x) => x.decision === d).length;
  console.log(`validated ${idx.cases.length} cases: ${count("accepted")} accepted, ${count("pending-replay")} pending replay, ${count("missing")} missing, ${count("quarantined")} quarantined${idx.strays.length ? `; ${idx.strays.length} stray directories ignored` : ""}`);
  for (const x of idx.cases)
    for (const a of x.attempts) if (!a.valid) console.log(`  ${x.caseId.slice(0, 12)} ${a.attemptId}${a.partial ? " (partial)" : ""}: ${a.errors.join("; ")}`);
  for (const x of idx.cases) if (x.decision === "quarantined") console.log(`  QUARANTINED ${x.caseId}: ${x.reason}`);
  return idx;
  } finally {
    release();
  }
}

async function reduce(f: Record<string, string>): Promise<void> {
  const root = resolve(need(f, "root"));
  assertResearchRoot(root);
  const release = await acquireRootLock(root);
  try {
  const c = await loadCampaign(root);
  const text = await Deno.readTextFile(`${root}/acceptance.json`).catch(() => "");
  // Reduce only an index that still describes the files on disk.
  const fresh = canonicalJSON(await buildAcceptanceIndex(c));
  if (text !== fresh) throw new Error("acceptance.json is missing or stale (results changed since it was written); run validate first");
  const idx = JSON.parse(text) as AcceptanceIndex;
  const rep = await reduceCampaign(c.manifest, c.specs, idx);
  await writeAtomic(`${root}/report.json`, enc.encode(canonicalJSON(rep)));
  await writeAtomic(`${root}/report.md`, enc.encode(reportMarkdown(rep, ["Engineering cases are plumbing checks, not evidence about evolution."])));
  console.log(`${rep.status}: ${rep.counts.accepted}/${rep.cases.length} accepted; reduction ${rep.reductionDigest}`);
  for (const fx of rep.fixtures) console.log(`  ${fx.fixtureId}: ${fx.met}/${fx.blocks} met, ${fx.status}`);
  } finally {
    release();
  }
}

async function copyTree(src: string, dst: string): Promise<void> {
  await Deno.mkdir(dst, { recursive: true });
  for await (const e of Deno.readDir(src)) {
    if (e.isDirectory) await copyTree(`${src}/${e.name}`, `${dst}/${e.name}`);
    else if (e.isFile) await Deno.copyFile(`${src}/${e.name}`, `${dst}/${e.name}`);
  }
}

async function exportCampaign(f: Record<string, string>): Promise<void> {
  const root = resolve(need(f, "root"));
  const out = resolve(need(f, "out"));
  assertResearchRoot(out);
  if (inside(realish(out), realish(root)) || inside(realish(root), realish(out))) throw new Error("export destination must lie outside the campaign root (and not contain it)");
  // Hold the source root while checking freshness and copying, so no run or validation changes it mid-export.
  const release = await acquireRootLock(root);
  try {
  const c = await loadCampaign(root);
  const idx = JSON.parse(await Deno.readTextFile(`${root}/acceptance.json`)) as AcceptanceIndex;
  const fresh = await buildAcceptanceIndex(c);
  if (canonicalJSON(fresh) !== canonicalJSON(idx)) throw new Error("acceptance.json is stale; run validate first");
  const rep = await reduceCampaign(c.manifest, c.specs, idx);
  await Deno.mkdir(out); // exclusive
  for (const name of ["protocol.json", "manifest.json", "MANIFEST-DIGEST", "source-closure.json", "acceptance.json"]) await Deno.copyFile(`${root}/${name}`, `${out}/${name}`);
  await copyTree(`${root}/initial`, `${out}/initial`);
  // Every attempt, accepted or rejected, partial ones included, keeps its place.
  await copyTree(`${root}/cases`, `${out}/cases`);
  await copyTree(`${root}/replays`, `${out}/replays`);
  const rejected = idx.cases.flatMap((x) => x.attempts.filter((a) => !a.valid).map((a) => ({ caseId: x.caseId, ...a })));
  await Deno.writeTextFile(`${out}/rejected.json`, canonicalJSON(rejected));
  await Deno.writeTextFile(`${out}/report.json`, canonicalJSON(rep));
  await Deno.writeTextFile(`${out}/report.md`, reportMarkdown(rep, ["Reproduce: `deno run -A tools/discovery.ts validate --root <this dir>` then `reduce`; the reduction digest must match."]));
  const sums: string[] = [];
  const walk = async (d: string, rel: string) => {
    const names: string[] = [];
    for await (const e of Deno.readDir(d)) names.push(e.name);
    for (const n of names.sort()) {
      const p = `${d}/${n}`;
      const r = rel ? `${rel}/${n}` : n;
      if ((await Deno.stat(p)).isDirectory) await walk(p, r);
      else sums.push(`${await sha256Hex(await Deno.readFile(p))}  ${r}`);
    }
  };
  await walk(out, "");
  await Deno.writeTextFile(`${out}/SHA256SUMS`, sums.join("\n") + "\n");
  console.log(`exported ${c.manifest.campaign} to ${out}: ${rep.status}, reduction ${rep.reductionDigest}, ${sums.length} files hashed`);
  } finally {
    release();
  }
}

function pct(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}

async function stats(f: Record<string, string>): Promise<void> {
  const root = resolve(need(f, "root"));
  assertResearchRoot(root);
  const release = await acquireRootLock(root);
  try {
  const c = await loadCampaign(root);
  const rows: { role: string; fixture: string; seconds: number; bytes: number }[] = [];
  for (const id of c.manifest.orderedCaseIds)
    for (const a of await listAttempts(root, id)) {
      if (a.partial) continue;
      const info = await checkAttempt(c, id, a);
      if (!info.verdict.valid) continue;
      const r = JSON.parse(await Deno.readTextFile(`${a.dir}/result.json`)) as ResultManifest;
      rows.push({ role: a.role, fixture: c.specs.get(id)!.fixtureId, seconds: r.execution.measuredWallMs / 1000, bytes: RESULT_FILES.reduce((s, k) => s + r.execution.artifactSizes[k], 0) });
    }
  const summary = (["primary", "replay"] as const).map((role) => {
    const xs = rows.filter((r) => r.role === role);
    return { role, executions: xs.length, medianSeconds: pct(xs.map((x) => x.seconds), 0.5), p90Seconds: pct(xs.map((x) => x.seconds), 0.9), medianBytes: pct(xs.map((x) => x.bytes), 0.5), p90Bytes: pct(xs.map((x) => x.bytes), 0.9) };
  });
  const out = { campaign: c.manifest.campaign, manifestDigest: c.manifestDigest, note: "Measured from valid attempts' own wall time and artifact sizes (observer, serialization and hashing included; validation and transfer excluded). Engineering figures price the plumbing only, never a scientific campaign.", summary, byFixture: rows };
  await writeAtomic(`${root}/stats.json`, enc.encode(JSON.stringify(out, null, 1) + "\n"));
  for (const s of summary) console.log(`${s.role}: n=${s.executions} median ${s.medianSeconds.toFixed(2)} s, p90 ${s.p90Seconds.toFixed(2)} s; median ${s.medianBytes} bytes, p90 ${s.p90Bytes} bytes`);
  } finally {
    release();
  }
}

async function status(f: Record<string, string>): Promise<void> {
  const root = resolve(need(f, "root"));
  const c = await loadCampaign(root);
  const idx = await buildAcceptanceIndex(c);
  const by = new Map<string, number>();
  for (const x of idx.cases) by.set(x.decision, (by.get(x.decision) ?? 0) + 1);
  console.log(`${c.manifest.campaign}: ${[...by].map(([k, v]) => `${v} ${k}`).join(", ")}`);
  for (const x of idx.cases) console.log(`  ${x.caseId.slice(0, 12)} ${c.specs.get(x.caseId)!.fixtureId}/${c.specs.get(x.caseId)!.blockId}: ${x.decision} (${x.reason}); attempts ${x.attempts.map((a) => `${a.attemptId}${a.valid ? "" : a.partial ? "~" : "!"}`).join(" ") || "none"}`);
}

// ---------------------------------------------------------------------------
// Plane bridge

async function checkAttemptCmd(f: Record<string, string>): Promise<void> {
  const say = (v: { valid: boolean; errors: string[]; canonical: unknown }) => console.log(JSON.stringify(v));
  const mText = await Deno.readTextFile(need(f, "manifest"));
  const cText = await Deno.readTextFile(need(f, "case"));
  let manifest: CampaignManifest;
  let spec: CaseSpec;
  try {
    manifest = JSON.parse(mText);
    spec = JSON.parse(cText);
  } catch {
    return say({ valid: false, errors: ["manifest or case is not JSON"], canonical: null });
  }
  if (canonicalJSON(manifest) !== mText || canonicalJSON(spec) !== cText) return say({ valid: false, errors: ["manifest or case is not canonical"], canonical: null });
  const ctx = { manifest, campaignDigest: await campaignCoreDigest(manifest), caseId: await caseIdOf(spec), spec };
  const ctxErrs = await caseContextErrors(ctx);
  if (ctxErrs.length) return say({ valid: false, errors: ctxErrs, canonical: null });
  const { result, files } = await readAttemptFiles(need(f, "attempt"));
  const v = await validateAttempt(ctx, result, files, f.initial ? await Deno.readFile(f.initial) : null);
  say({ valid: v.valid, errors: v.errors, canonical: v.valid ? (JSON.parse(new TextDecoder().decode(result!)) as ResultManifest).canonical : null });
}

function adminHeaders(f: Record<string, string>): Record<string, string> {
  const t = f["admin-token"] ?? Deno.env.get("BL_ADMIN_TOKEN");
  return t ? { authorization: `Bearer ${t}` } : {};
}

async function http(method: string, url: string, headers: Record<string, string>, body?: BodyInit): Promise<Response> {
  const res = await fetch(url, { method, headers, body });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res;
}

async function submit(f: Record<string, string>): Promise<void> {
  const root = resolve(need(f, "root"));
  const base = need(f, "coordinator").replace(/\/$/, "");
  const c = await loadCampaign(root);
  const h = adminHeaders(f);
  const idx = JSON.parse(await Deno.readTextFile(`${root}/acceptance.json`)) as AcceptanceIndex;
  // The qualification reference: an accepted case of this root (default: the shortest one).
  // Prefer an accepted case; before any cross-host replay exists, a validated primary is the reference.
  const usable = idx.cases.filter((x) => x.decision === "accepted" || x.attempts.some((a) => a.valid));
  const rank = (x: { decision: string; caseId: string }) => (x.decision === "accepted" ? 0 : 1) * 1e9 + c.specs.get(x.caseId)!.steps;
  const q = f.qualify ? usable.find((x) => x.caseId === f.qualify) : [...usable].sort((a, b) => rank(a) - rank(b))[0];
  if (!q) throw new Error("the qualification case needs a validated result in this root (run and validate first)");
  const qid = q.caseId;
  if (q.decision !== "accepted") console.log(`qualification reference ${qid} is a validated primary, not yet cross-host accepted`);
  const qa = q.attempts.find((a) => a.valid)!;
  const qdir = qa.role === "primary" ? `${root}/cases/${qid}/attempts/${qa.attemptId}` : `${root}/replays/${qid}/${qa.physicalHostId}/${qa.attemptId}`;
  const canonical = (JSON.parse(await Deno.readTextFile(`${qdir}/result.json`)) as ResultManifest).canonical;
  for (const spec of c.specs.values()) {
    const bytes = await readInitial(c, spec);
    await http("PUT", `${base}/api/discovery/blobs/${spec.initialArtifactDigest}`, { ...h, "content-type": "application/octet-stream" }, bytes as BodyInit);
  }
  const cases: Record<string, string> = {};
  for (const id of c.manifest.orderedCaseIds) cases[id] = await Deno.readTextFile(`${root}/cases/${id}/case.json`);
  const body = {
    manifest: await Deno.readTextFile(`${root}/manifest.json`),
    protocol: await Deno.readTextFile(`${root}/protocol.json`),
    sourceClosure: await Deno.readTextFile(`${root}/source-closure.json`),
    cases,
    qualification: { caseId: qid, canonical },
  };
  const r = await (await http("POST", `${base}/api/discovery/campaigns`, { ...h, "content-type": "application/json" }, JSON.stringify(body))).json();
  console.log(`submitted ${c.manifest.campaign}: ${JSON.stringify(r)}; qualification case ${qid}`);
}

interface PlaneIndex {
  campaign: string;
  manifestDigest: string;
  frozen: Record<string, string>;
  cases: { caseId: string; initial: string; decision: { decision: string }; attempts: { attemptId: string; role: string; host: string; worker: string; status: string; errors: string[]; files: Record<string, string> }[] }[];
  qualifications: { attemptId: string; host: string; status: string; errors: string[]; files: Record<string, string> }[];
}

async function collect(f: Record<string, string>): Promise<void> {
  const base = need(f, "coordinator").replace(/\/$/, "");
  const md = need(f, "campaign");
  const out = resolve(need(f, "out"));
  assertResearchRoot(out);
  const h = adminHeaders(f);
  const idx = (await (await http("GET", `${base}/api/discovery/campaigns/${md}`, h)).json()) as PlaneIndex;
  // Every path component below comes from the coordinator: check each one before it touches the filesystem.
  const HEX64 = /^[0-9a-f]{64}$/;
  const ATTEMPT = /^[a-z0-9][a-z0-9-]{0,31}\.(primary|replay|qualify)\.[1-9][0-9]{0,5}$/;
  const FROZEN = new Set(["manifest.json", "protocol.json", "source-closure.json"]);
  const FILES = new Set<string>([...RESULT_FILES, "result.json"]);
  const bad = (what: string) => {
    throw new Error(`collect: the coordinator sent an unsafe ${what}; refusing to write it`);
  };
  if (idx.manifestDigest !== md) bad("manifest digest");
  for (const [name, sha] of Object.entries(idx.frozen)) if (!FROZEN.has(name) || !HEX64.test(sha)) bad(`frozen file ${JSON.stringify(name)}`);
  const checkAttempt = (a: { attemptId: string; host: string; files: Record<string, string> }) => {
    if (!ATTEMPT.test(a.attemptId) || !HOST_RE.test(a.host) || !a.attemptId.startsWith(`${a.host}.`)) bad(`attempt ${JSON.stringify(a.attemptId)}`);
    for (const [name, sha] of Object.entries(a.files)) if (!FILES.has(name) || !HEX64.test(sha)) bad(`file ${JSON.stringify(name)}`);
  };
  for (const c of idx.cases) {
    if (!HEX64.test(c.caseId) || !HEX64.test(c.initial)) bad(`case ${JSON.stringify(c.caseId)}`);
    for (const a of c.attempts) {
      checkAttempt(a);
      if (a.role !== "primary" && a.role !== "replay") bad(`role ${JSON.stringify(a.role)}`);
    }
  }
  for (const q of idx.qualifications) checkAttempt(q);
  const within = (p: string) => (inside(resolve(p), out) ? p : bad(`path ${JSON.stringify(p)}`));
  const blob = async (sha: string) => {
    const b = new Uint8Array(await (await http("GET", `${base}/api/discovery/blobs/${sha}`, h)).arrayBuffer());
    if ((await sha256Hex(b)) !== sha) throw new Error(`blob ${sha} is corrupt`);
    return b;
  };
  await Deno.mkdir(resolve(out, ".."), { recursive: true });
  await Deno.mkdir(out); // exclusive
  for (const [name, sha] of Object.entries(idx.frozen)) await Deno.writeFile(within(`${out}/${name}`), await blob(sha));
  await Deno.writeTextFile(`${out}/MANIFEST-DIGEST`, idx.manifestDigest + "\n");
  await Deno.mkdir(`${out}/initial`);
  await Deno.mkdir(`${out}/replays`);
  const writeAttempt = async (dir: string, a: { status: string; errors: string[]; worker?: string; files: Record<string, string> }) => {
    await Deno.mkdir(within(dir), { recursive: true });
    const missing: string[] = [];
    for (const [name, sha] of Object.entries(a.files)) {
      try {
        await Deno.writeFile(within(`${dir}/${name}`), await blob(sha));
      } catch (e) {
        // A valid attempt's bytes must exist; anything else is kept with a note.
        if (a.status === "valid") throw e;
        missing.push(`${name}: ${(e as Error).message}`);
      }
    }
    await Deno.writeTextFile(`${dir}/plane-status.json`, JSON.stringify({ status: a.status, errors: [...a.errors, ...missing.map((m) => `not collected: ${m}`)], worker: a.worker ?? null }) + "\n");
  };
  for (const c of idx.cases) {
    await Deno.mkdir(`${out}/cases/${c.caseId}/attempts`, { recursive: true });
    await Deno.writeFile(`${out}/cases/${c.caseId}/case.json`, await blob(c.caseId));
    if (!(await exists(`${out}/initial/${c.initial}.blck`))) await Deno.writeFile(`${out}/initial/${c.initial}.blck`, await blob(c.initial));
    for (const a of c.attempts) {
      // Never completed (expired or still leased): a retained partial attempt, as on the shard path.
      // Rejected by the coordinator: kept under .rejected-, so the export decides exactly as the plane did;
      // the shard validator still re-validates every attempt the plane accepted.
      const name = a.status === "valid" ? a.attemptId : a.status === "rejected" ? `.rejected-${a.attemptId}` : `.partial-${a.attemptId}`;
      const dir = a.role === "primary" ? `${out}/cases/${c.caseId}/attempts/${name}` : `${out}/replays/${c.caseId}/${a.host}/${name}`;
      await writeAttempt(dir, a);
    }
  }
  for (const q of idx.qualifications) await writeAttempt(`${out}/qualifications/${q.attemptId}`, q);
  await Deno.writeTextFile(`${out}/plane-index.json`, JSON.stringify(idx, null, 1) + "\n");
  const decisions = new Map<string, number>();
  for (const c of idx.cases) decisions.set(c.decision.decision, (decisions.get(c.decision.decision) ?? 0) + 1);
  console.log(`collected ${idx.campaign} into ${out}: plane decisions ${[...decisions].map(([k, v]) => `${v} ${k}`).join(", ")}; now run validate and reduce on it`);
}

const [cmd, ...rest] = Deno.args;
const f = flags(rest);
try {
  if (cmd === "freeze") await freeze(f);
  else if (cmd === "run") await execute(f, "primary");
  else if (cmd === "replay") await execute(f, "replay");
  else if (cmd === "validate") await validate(f);
  else if (cmd === "reduce") await reduce(f);
  else if (cmd === "export") await exportCampaign(f);
  else if (cmd === "stats") await stats(f);
  else if (cmd === "status") await status(f);
  else if (cmd === "check-attempt") await checkAttemptCmd(f);
  else if (cmd === "submit") await submit(f);
  else if (cmd === "collect") await collect(f);
  else {
    console.error("usage: tools/discovery.ts freeze|run|replay|validate|reduce|export|stats|status|check-attempt|submit|collect [flags] (see the header comment)");
    Deno.exit(2);
  }
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  Deno.exit(1);
}
