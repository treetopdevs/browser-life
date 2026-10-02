// Divergence-control competition runner. A PREPARED candidate never authorizes GPU
// execution; only a RELEASED file naming the candidate's hash does. Competitions run
// through the frozen study's executeAssay via its exact generated adapter.
// Protocol: experiments/founder-discovery/v1/divergence-control-protocol.md
// Usage:
//   candidate ROSTER MANIFEST REPORT PROTOCOL FORECAST ENGINEERING_CHECK NEW_CANDIDATE CAP_SECONDS MAX_INVOCATIONS
//   verify RELEASE | status RELEASE | run RELEASE SECONDS | supervise RELEASE SECONDS
//   resolve RELEASE REASON   (after a killed process: settle its reservation as failed)
//   stop RELEASE REASON      (permanently end execution; allows analysis of partial data)
import { join, resolve } from "node:path";
import { statfsSync } from "node:fs";
import { sha256 } from "./lib/founder-policy.ts";
import {
  type AssayResult,
  type Manifest,
  validateAssayResult,
  validateManifest,
  writeNew,
} from "./lib/discovery-improvement-runtime.ts";
import { discoveryCompetitionConfig } from "./lib/discovery-competition.ts";
import {
  buildRoster,
  type ImprovementReport,
  type Roster,
} from "./lib/discovery-divergence-control.ts";
import { REPORT_SHA256 } from "./discovery_divergence_control.ts";
import { adapterText } from "./discovery_improvement_shard.ts";
import { noSymlinks } from "./discovery_improvement_import.ts";

// Matches the frozen runners' per-process bound.
export const MAX_INVOCATION_SECONDS = 600;
const START_MARGIN_SECONDS = 60; // no new competition this close to the reservation
const WATCHDOG_GRACE_SECONDS = 120;
export const RUNNER_SOURCES = [
  "tools/discovery_divergence_control_run.ts",
  "tools/discovery_divergence_control_analyze.ts",
  "tools/discovery_divergence_control.ts",
  "tools/lib/discovery-divergence-control.ts",
  "tools/discovery_improvement_shard.ts",
  "tools/discovery_improvement_import.ts",
  "tools/discovery_improvement_adapter.generated.ts",
];
// Pinned by every candidate but outside the study identity: they do not determine
// results (the roster's own hash covers the generator's output).
const ANALYSIS_ONLY = [
  "tools/discovery_divergence_control_analyze.ts",
  "tools/discovery_divergence_control.ts",
  "tools/lib/discovery-divergence-control.ts",
];
export const EVOLVED_RESULTS =
  "runs/founder-discovery-improvement-consolidated-v1/assays";
export const OUTPUT_REL = "runs/founder-discovery-divergence-control-v1";
const OUT_ENTRIES = [
  "assays",
  "provenance",
  "replay",
  "audit",
  "invocations",
  "resolutions",
  "tmp",
  "RUNNING",
  "STOPPED.json",
];
const IGNORED = new Set([".DS_Store"]);

export type Request = {
  cacheKey: string;
  descendantHex: string;
  founderHex: string;
  seed: number;
  assignment: number;
};
type Pin = { path: string; sha256: string };
export interface Candidate {
  format: "discovery-divergence-control-candidate/v2";
  status: "PREPARED";
  authorizesGpu: false;
  studyIdentitySha256: string;
  protocol: Pin;
  roster: Pin;
  manifest: Pin & { manifestHash: string; sourceManifestHash: string };
  report: Pin;
  forecast: Pin;
  engineeringCheck: Pin;
  replayExpected: Record<string, string>;
  executionSources: Record<string, string>;
  host: { id: "local"; root: string; outputRel: string };
  budget: {
    capSeconds: number;
    maxInvocations: number;
    maxInvocationSeconds: number;
  };
  minimumFreeBytes: number;
}
export interface Release {
  format: "discovery-divergence-control-release/v1";
  status: "RELEASED";
  candidatePath: string;
  candidateSha256: string;
  reviewedBy: string;
  reviewReference: string;
  reviewedAt: string;
}
export type Identity = {
  studyIdentitySha256: string;
  candidateSha256: string;
  releaseSha256: string;
};

const hashFile = async (p: string) => sha256(await Deno.readFile(p));
const canonical = (r: AssayResult) => JSON.stringify(r) + "\n";
const pad = (n: number) => String(n).padStart(3, "0");
const env = () => ({
  deno: Deno.version.deno,
  os: Deno.build.os,
  arch: Deno.build.arch,
});
export function hashMap(map: Record<string, string>): string {
  return sha256(
    JSON.stringify(Object.entries(map).sort(([a], [b]) => a.localeCompare(b))),
  );
}
/**
 * Results, replays and audits bind to what determines them: roster, manifest,
 * frozen report, replay originals and execution-path sources. Not to the protocol
 * text, analysis-only code or the budget, so a dated amendment, an analyzer fix or a
 * larger budget can be released as a successor candidate that reuses results.
 */
export function studyIdentity(c: Omit<Candidate, "studyIdentitySha256">) {
  return sha256(JSON.stringify({
    roster: c.roster.sha256,
    manifest: c.manifest.sha256,
    report: c.report.sha256,
    replayExpected: c.replayExpected,
    executionSources: Object.fromEntries(
      Object.entries(c.executionSources).filter(([p]) =>
        !ANALYSIS_ONLY.includes(p)
      ),
    ),
  }));
}
async function exists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
/** Replays must agree in every field except wall-clock elapsedSeconds. */
export function sameOutcome(a: AssayResult, b: AssayResult): boolean {
  return JSON.stringify({ ...a, elapsedSeconds: 0 }) ===
    JSON.stringify({ ...b, elapsedSeconds: 0 });
}
export const provenanceText = (
  studyIdentitySha256: string,
  cacheKey: string,
  resultSha256: string,
) =>
  JSON.stringify({
    format: "discovery-divergence-control-provenance/v2",
    studyIdentitySha256,
    cacheKey,
    resultSha256,
  }) + "\n";
const validate = (r: AssayResult, q: Request, source: string) =>
  validateAssayResult(
    r,
    q.cacheKey,
    q.descendantHex,
    q.founderHex,
    q.seed,
    q.assignment,
    source,
  );

export function requestsOf(roster: Roster): Request[] {
  const genome = new Map(roster.genomes.map((g) => [g.id, g]));
  return roster.assays.map((a) => ({
    cacheKey: a.cacheKey,
    descendantHex: genome.get(a.genomeId)!.descendantHex,
    founderHex: genome.get(a.genomeId)!.founderHex,
    seed: a.assaySeed,
    assignment: a.assignment,
  }));
}

async function frozenReport(path: string) {
  const bytes = await Deno.readFile(path);
  if (sha256(bytes) !== REPORT_SHA256) throw Error("frozen report hash drift");
  return JSON.parse(new TextDecoder().decode(bytes)) as ImprovementReport;
}

export async function candidate(
  rosterPath: string,
  manifestPath: string,
  reportPath: string,
  protocolPath: string,
  forecastPath: string,
  engineeringCheckPath: string,
  candidatePath: string,
  capSeconds: number,
  maxInvocations: number,
): Promise<void> {
  if (
    !Number.isFinite(capSeconds) || capSeconds <= 0 ||
    !Number.isSafeInteger(maxInvocations) || maxInvocations < 1
  ) throw Error("invalid budget");
  const manifest = validateManifest(
    JSON.parse(await Deno.readTextFile(manifestPath)),
  );
  if (hashMap(manifest.sources) !== manifest.sourceManifestHash) {
    throw Error("source manifest hash drift");
  }
  const report = await frozenReport(reportPath);
  const roster = buildRoster(report, REPORT_SHA256, manifest);
  const rosterBytes = await Deno.readFile(rosterPath);
  if (
    new TextDecoder().decode(rosterBytes) !==
      JSON.stringify(roster, null, 2) + "\n"
  ) {
    throw Error("roster is not the generator's exact output for this report");
  }
  const forecast = JSON.parse(await Deno.readTextFile(forecastPath));
  if (
    forecast.capSeconds !== capSeconds ||
    forecast.maxInvocations !== maxInvocations
  ) {
    throw Error("budget differs from the pinned forecast");
  }
  const executionSources: Record<string, string> = {};
  for (const [p, h] of Object.entries(manifest.sources)) {
    if (await hashFile(p) !== h) throw Error(`frozen source drift ${p}`);
    executionSources[p] = h;
  }
  for (const p of RUNNER_SOURCES) executionSources[p] = await hashFile(p);
  const replayExpected: Record<string, string> = {};
  for (const r of roster.replay) {
    const raw = await Deno.readFile(
      join(EVOLVED_RESULTS, `${r.cacheKey}.json`),
    );
    const frozenScore = report.observations.find((o) =>
      o.id === r.observationId
    )?.score;
    if (JSON.parse(new TextDecoder().decode(raw)).score !== frozenScore) {
      throw Error(
        `replay original disagrees with the frozen report ${r.cacheKey}`,
      );
    }
    replayExpected[r.cacheKey] = sha256(raw);
  }
  const check = JSON.parse(await Deno.readTextFile(engineeringCheckPath));
  if (
    check.reproduced !== true ||
    replayExpected[check.cacheKey] !== check.expectedSha256
  ) {
    throw Error(
      "engineering check does not reproduce a pinned replay original",
    );
  }
  const body: Omit<Candidate, "studyIdentitySha256"> = {
    format: "discovery-divergence-control-candidate/v2",
    status: "PREPARED",
    authorizesGpu: false,
    protocol: { path: protocolPath, sha256: await hashFile(protocolPath) },
    roster: { path: rosterPath, sha256: sha256(rosterBytes) },
    manifest: {
      path: manifestPath,
      sha256: await hashFile(manifestPath),
      manifestHash: manifest.manifestHash,
      sourceManifestHash: manifest.sourceManifestHash,
    },
    report: { path: reportPath, sha256: REPORT_SHA256 },
    forecast: { path: forecastPath, sha256: await hashFile(forecastPath) },
    engineeringCheck: {
      path: engineeringCheckPath,
      sha256: await hashFile(engineeringCheckPath),
    },
    replayExpected,
    executionSources,
    host: {
      id: "local",
      root: await Deno.realPath(Deno.cwd()),
      outputRel: OUTPUT_REL,
    },
    budget: {
      capSeconds,
      maxInvocations,
      maxInvocationSeconds: MAX_INVOCATION_SECONDS,
    },
    minimumFreeBytes: 20 * 1024 ** 3,
  };
  const value: Candidate = {
    studyIdentitySha256: studyIdentity(body),
    ...body,
  };
  await writeNew(candidatePath, JSON.stringify(value, null, 2) + "\n");
  console.log(
    JSON.stringify({
      candidateSha256: await hashFile(candidatePath),
      studyIdentitySha256: value.studyIdentitySha256,
    }),
  );
}

/** Verify a RELEASED file and every pin it transitively names. */
export async function released(releasePath: string) {
  const releaseBytes = await Deno.readFile(releasePath);
  const release = JSON.parse(new TextDecoder().decode(releaseBytes)) as Release;
  if (
    release.format !== "discovery-divergence-control-release/v1" ||
    release.status !== "RELEASED" || !release.reviewedBy ||
    !release.reviewReference ||
    !Number.isFinite(Date.parse(release.reviewedAt))
  ) throw Error("not a RELEASED divergence-control file");
  const candidateBytes = await Deno.readFile(release.candidatePath);
  if (sha256(candidateBytes) !== release.candidateSha256) {
    throw Error("candidate hash drift");
  }
  const c = JSON.parse(new TextDecoder().decode(candidateBytes)) as Candidate;
  const { studyIdentitySha256, ...body } = c;
  if (
    c.format !== "discovery-divergence-control-candidate/v2" ||
    c.status !== "PREPARED" || c.authorizesGpu !== false ||
    c.host.outputRel !== OUTPUT_REL || c.report.sha256 !== REPORT_SHA256 ||
    c.budget.maxInvocationSeconds !== MAX_INVOCATION_SECONDS ||
    studyIdentity(body) !== studyIdentitySha256
  ) throw Error("candidate format drift");
  if (await Deno.realPath(Deno.cwd()) !== c.host.root) {
    throw Error("host root drift");
  }
  for (
    const pin of [
      c.protocol,
      c.roster,
      c.manifest,
      c.report,
      c.forecast,
      c.engineeringCheck,
    ]
  ) {
    if (await hashFile(pin.path) !== pin.sha256) {
      throw Error(`pin drift ${pin.path}`);
    }
  }
  const manifest = validateManifest(
    JSON.parse(await Deno.readTextFile(c.manifest.path)),
  );
  if (
    hashMap(manifest.sources) !== manifest.sourceManifestHash ||
    manifest.sourceManifestHash !== c.manifest.sourceManifestHash
  ) throw Error("source manifest hash drift");
  for (const p of [...Object.keys(manifest.sources), ...RUNNER_SOURCES]) {
    if (!(p in c.executionSources)) {
      throw Error(`execution source not pinned ${p}`);
    }
  }
  for (const [p, h] of Object.entries(c.executionSources)) {
    if (await hashFile(p) !== h) throw Error(`execution source drift ${p}`);
  }
  const roster = JSON.parse(await Deno.readTextFile(c.roster.path)) as Roster;
  const replay: { request: Request; expected: AssayResult }[] = [];
  for (const r of roster.replay) {
    const raw = await Deno.readFile(
      join(EVOLVED_RESULTS, `${r.cacheKey}.json`),
    );
    if (sha256(raw) !== c.replayExpected[r.cacheKey]) {
      throw Error(`replay evidence drift ${r.cacheKey}`);
    }
    const expected = JSON.parse(new TextDecoder().decode(raw)) as AssayResult;
    const request = {
      cacheKey: r.cacheKey,
      descendantHex: expected.descendantHex,
      founderHex: expected.founderHex,
      seed: expected.seed,
      assignment: expected.assignment,
    };
    validate(expected, request, manifest.sourceManifestHash);
    replay.push({ request, expected });
  }
  return {
    c,
    manifest,
    roster,
    requests: requestsOf(roster),
    replay,
    identity: {
      studyIdentitySha256,
      candidateSha256: release.candidateSha256,
      releaseSha256: sha256(releaseBytes),
    } as Identity,
    out: resolve(c.host.root, c.host.outputRel),
  };
}

export type InvocationRecord = {
  name: string;
  index: number;
  status: "reserved" | "settled" | "failed";
  chargedSeconds: number;
  newAssays?: number;
};
type Ledger = {
  count: number;
  charged: number;
  reserved: string[];
  records: InvocationRecord[];
};
export async function ledger(out: string): Promise<Ledger> {
  const dir = join(out, "invocations");
  const l: Ledger = { count: 0, charged: 0, reserved: [], records: [] };
  if (!await exists(dir)) return l;
  for await (const e of Deno.readDir(dir)) {
    if (IGNORED.has(e.name)) continue;
    if (!e.isFile || !/^[0-9]{3}-[0-9]+\.json$/.test(e.name)) {
      throw Error("foreign invocation record");
    }
    const r = JSON.parse(await Deno.readTextFile(join(dir, e.name)));
    if (
      !["reserved", "settled", "failed"].includes(r.status) ||
      !(r.chargedSeconds >= 0)
    ) {
      throw Error("invalid invocation record");
    }
    l.count++;
    l.charged += r.chargedSeconds;
    if (r.status === "reserved") l.reserved.push(e.name);
    l.records.push({
      name: e.name,
      index: Number(e.name.slice(0, 3)),
      status: r.status,
      chargedSeconds: r.chargedSeconds,
      newAssays: r.newAssays,
    });
  }
  l.records.sort((a, b) => a.index - b.index);
  return l;
}
/** Invocations that did, or may have done, new work must each carry a matching audit. */
export const needsAudit = (r: InvocationRecord) =>
  r.newAssays === undefined || r.newAssays > 0;

/** Cheap pre-reservation scan: any recorded replay or audit mismatch stops the study. */
async function recordedMismatch(out: string): Promise<boolean> {
  for (const dir of ["replay", "audit"]) {
    if (!await exists(join(out, dir))) continue;
    for await (const e of Deno.readDir(join(out, dir))) {
      if (!e.isFile || !e.name.endsWith(".json")) continue;
      if (
        JSON.parse(await Deno.readTextFile(join(out, dir, e.name))).matches !==
          true
      ) return true;
    }
  }
  return false;
}

/** Write a file into place atomically, via the output's tmp directory. */
async function place(out: string, path: string, text: string) {
  if (await exists(path)) throw new Deno.errors.AlreadyExists(path);
  const tmp = join(out, "tmp", `${crypto.randomUUID()}.json`);
  await Deno.writeTextFile(tmp, text, { createNew: true });
  await Deno.rename(tmp, path);
}

export interface InvocationOptions {
  out: string;
  seconds: number;
  capSeconds: number;
  maxInvocations: number;
  minimumFreeBytes: number;
  sourceManifestHash: string;
  identity: Identity;
  replay: { request: Request; expected: AssayResult }[];
  requests: Request[];
  clock?: () => number; // seconds; wall clock by default, so host sleep is charged
  freeBytes?: (path: string) => number;
  signals?: boolean; // install SIGINT/SIGTERM handlers (CLI only)
  shouldStop?: () => boolean; // test hook equivalent to a received signal
}
export type Execute = (request: Request) => Promise<AssayResult>;

/**
 * One bounded invocation: catch-up audits, replays, roster order, then one audit of
 * this invocation's work. Resumes only from re-validated results, replays and audits.
 */
export async function invocation(o: InvocationOptions, execute: Execute) {
  const clock = o.clock ?? (() => Date.now() / 1000);
  const freeBytes = o.freeBytes ?? ((p: string) => {
    const fs = statfsSync(p);
    return Number(fs.bavail) * Number(fs.bsize);
  });
  if (
    !(o.seconds > START_MARGIN_SECONDS && o.seconds <= MAX_INVOCATION_SECONDS)
  ) {
    throw Error("invocation seconds out of range");
  }
  await Deno.mkdir(o.out, { recursive: true });
  await noSymlinks(o.out);
  for await (const e of Deno.readDir(o.out)) {
    if (IGNORED.has(e.name)) continue;
    if (e.isSymlink || !OUT_ENTRIES.includes(e.name)) {
      throw Error(`unexpected output artifact ${e.name}`);
    }
  }
  if (await exists(join(o.out, "STOPPED.json"))) throw Error("study stopped");
  const lock = join(o.out, "RUNNING");
  await writeNew(lock, JSON.stringify({ pid: Deno.pid, ...o.identity }) + "\n");
  let signalled = false;
  const onSignal = () => {
    signalled = true;
  };
  const stopping = () => signalled || (o.shouldStop?.() ?? false);
  if (o.signals) {
    Deno.addSignalListener("SIGINT", onSignal);
    Deno.addSignalListener("SIGTERM", onSignal);
  }
  try {
    const l = await ledger(o.out);
    if (l.reserved.length) throw Error("unresolved invocation reservation");
    if (await recordedMismatch(o.out)) {
      throw Error("replay or audit mismatch recorded; stop for diagnosis");
    }
    if (
      l.count + 1 > o.maxInvocations || l.charged + o.seconds > o.capSeconds
    ) {
      throw Error("budget exhausted");
    }
    if (freeBytes(o.out) < o.minimumFreeBytes) {
      throw Error("storage floor reached");
    }
    const index = l.count + 1;
    const receiptPath = join(
      o.out,
      "invocations",
      `${pad(index)}-${Deno.pid}.json`,
    );
    const receipt: Record<string, unknown> = {
      format: "discovery-divergence-control-invocation/v2",
      ...o.identity,
      status: "reserved",
      chargedSeconds: o.seconds,
      startedAt: new Date().toISOString(),
      env: env(),
    };
    await writeNew(receiptPath, JSON.stringify(receipt) + "\n");
    const start = clock();
    let newAssays = 0, replayed = 0, audited = 0, repaired = 0;
    try {
      const sid = o.identity.studyIdentitySha256;
      const byKey = new Map(o.requests.map((r) => [r.cacheKey, r]));
      const replayByKey = new Map(o.replay.map((r) => [r.request.cacheKey, r]));
      const done = new Set<string>(),
        replayDone = new Set<string>(),
        auditDone = new Set<number>();
      for (const dir of ["assays", "provenance", "replay", "audit", "tmp"]) {
        await Deno.mkdir(join(o.out, dir), { recursive: true });
      }
      for await (const e of Deno.readDir(join(o.out, "tmp"))) {
        await Deno.remove(join(o.out, "tmp", e.name));
      }
      const recordOk = (
        rec: {
          studyIdentitySha256: string;
          matches: boolean;
          result: AssayResult;
        },
        r: { request: Request; expected: AssayResult },
      ) => {
        validate(rec.result, r.request, o.sourceManifestHash);
        return rec.studyIdentitySha256 === sid && rec.matches === true &&
          sameOutcome(rec.result, r.expected);
      };
      const entries = async (dir: string) => {
        const all = [];
        for await (const e of Deno.readDir(join(o.out, dir))) {
          if (!IGNORED.has(e.name)) all.push(e);
        }
        return all;
      };
      for (const e of await entries("replay")) {
        const r = replayByKey.get(e.name.slice(0, -5));
        if (!r || !e.isFile || !e.name.endsWith(".json")) {
          throw Error("foreign replay record");
        }
        if (
          !recordOk(
            JSON.parse(await Deno.readTextFile(join(o.out, "replay", e.name))),
            r,
          )
        ) {
          throw Error("replay mismatch recorded; stop for diagnosis");
        }
        replayDone.add(r.request.cacheKey);
      }
      for (const e of await entries("audit")) {
        if (!e.isFile || !/^[0-9]{3}\.json$/.test(e.name)) {
          throw Error("foreign audit record");
        }
        const rec = JSON.parse(
          await Deno.readTextFile(join(o.out, "audit", e.name)),
        );
        const r = replayByKey.get(rec.result?.cacheKey);
        if (!r || !recordOk(rec, r)) {
          throw Error("audit mismatch recorded; stop for diagnosis");
        }
        auditDone.add(Number(e.name.slice(0, 3)));
      }
      for (const e of await entries("assays")) {
        const key = e.name.slice(0, -5), request = byKey.get(key);
        if (!request || !e.isFile || !e.name.endsWith(".json")) {
          throw Error("foreign assay cache entry");
        }
        const raw = await Deno.readTextFile(join(o.out, "assays", e.name));
        const value = validate(
          JSON.parse(raw) as AssayResult,
          request,
          o.sourceManifestHash,
        );
        if (raw !== canonical(value)) throw Error("cached result bytes drift");
        if (
          await Deno.readTextFile(join(o.out, "provenance", e.name)) !==
            provenanceText(sid, key, sha256(raw))
        ) {
          throw Error("cached provenance drift");
        }
        done.add(key);
      }
      for (const e of await entries("provenance")) {
        if (!e.isFile || !byKey.has(e.name.slice(0, -5))) {
          throw Error("foreign provenance");
        }
        if (!done.has(e.name.slice(0, -5))) {
          // Provenance is placed before its result; a lone one means the result was never recorded.
          await Deno.remove(join(o.out, "provenance", e.name));
          repaired++;
        }
      }
      const room = () =>
        !stopping() && clock() - start + START_MARGIN_SECONDS < o.seconds;
      const checked = async (request: Request) => {
        if (freeBytes(o.out) < o.minimumFreeBytes) {
          throw Error("storage floor reached");
        }
        return validate(await execute(request), request, o.sourceManifestHash);
      };
      const audit = async (certifies: number) => {
        const r = o.replay[(certifies - 1) % o.replay.length];
        const result = await checked(r.request);
        const matches = sameOutcome(result, r.expected);
        await place(
          o.out,
          join(o.out, "audit", `${pad(certifies)}.json`),
          JSON.stringify({
            studyIdentitySha256: sid,
            certifies,
            matches,
            result,
          }) + "\n",
        );
        audited++;
        if (!matches) throw Error("audit mismatch; stop for diagnosis");
        auditDone.add(certifies);
      };
      // Catch-up: earlier invocations that failed or were killed after doing work.
      for (const rec of l.records) {
        if (needsAudit(rec) && !auditDone.has(rec.index)) {
          if (!room()) break;
          await audit(rec.index);
        }
      }
      for (const r of o.replay) {
        if (replayDone.has(r.request.cacheKey)) continue;
        if (!room()) break;
        const result = await checked(r.request);
        const matches = sameOutcome(result, r.expected);
        await place(
          o.out,
          join(o.out, "replay", `${r.request.cacheKey}.json`),
          JSON.stringify({ studyIdentitySha256: sid, matches, result }) + "\n",
        );
        replayed++;
        if (!matches) throw Error("replay mismatch; stop for diagnosis");
        replayDone.add(r.request.cacheKey);
      }
      if (replayDone.size === o.replay.length) {
        for (const request of o.requests) {
          if (done.has(request.cacheKey)) continue;
          if (!room()) break;
          const text = canonical(await checked(request));
          await place(
            o.out,
            join(o.out, "provenance", `${request.cacheKey}.json`),
            provenanceText(sid, request.cacheKey, sha256(text)),
          );
          await place(
            o.out,
            join(o.out, "assays", `${request.cacheKey}.json`),
            text,
          );
          done.add(request.cacheKey);
          newAssays++;
        }
      }
      if (stopping()) throw Error("interrupted by signal");
      // The device must still reproduce a frozen result after this invocation's work.
      if (newAssays > 0) await audit(index);
      const complete = replayDone.size === o.replay.length &&
        done.size === o.requests.length;
      Object.assign(receipt, {
        status: "settled",
        chargedSeconds: Math.max(0, clock() - start),
        finishedAt: new Date().toISOString(),
        replayed,
        newAssays,
        audited,
        repaired,
        complete,
      });
      return {
        replayed,
        newAssays,
        audited,
        repaired,
        complete,
        chargedSeconds: receipt.chargedSeconds as number,
      };
    } catch (e) {
      Object.assign(receipt, {
        status: "failed",
        chargedSeconds: o.seconds,
        finishedAt: new Date().toISOString(),
        replayed,
        newAssays,
        audited,
        repaired,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    } finally {
      await Deno.writeTextFile(receiptPath, JSON.stringify(receipt) + "\n");
    }
  } finally {
    if (o.signals) {
      Deno.removeSignalListener("SIGINT", onSignal);
      Deno.removeSignalListener("SIGTERM", onSignal);
    }
    await Deno.remove(lock);
  }
}

async function alive(pid: number): Promise<boolean> {
  const { code } = await new Deno.Command("ps", {
    args: ["-p", String(pid)],
    stdout: "null",
    stderr: "null",
  }).output();
  return code === 0;
}

/** After a killed process: settle its reservation as failed (full charge) and clear its lock. */
export async function resolveStale(out: string, reason: string, by: string) {
  if (!reason.trim()) throw Error("a reason is required");
  const lockPath = join(out, "RUNNING");
  const lock = await exists(lockPath)
    ? JSON.parse(await Deno.readTextFile(lockPath))
    : null;
  if (lock && await alive(lock.pid)) {
    throw Error(`process ${lock.pid} is still alive`);
  }
  const l = await ledger(out);
  if (!lock && !l.reserved.length) throw Error("nothing to resolve");
  const settled = [];
  for (const name of l.reserved) {
    if (lock && !name.endsWith(`-${lock.pid}.json`)) {
      throw Error(`reservation ${name} does not belong to the stale lock`);
    }
    const path = join(out, "invocations", name);
    const r = JSON.parse(await Deno.readTextFile(path));
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        ...r,
        status: "failed",
        error: "resolved after process loss",
        finishedAt: new Date().toISOString(),
      }) + "\n",
    );
    settled.push({ name, chargedSeconds: r.chargedSeconds });
  }
  await Deno.mkdir(join(out, "resolutions"), { recursive: true });
  await writeNew(
    join(out, "resolutions", `${Date.now()}.json`),
    JSON.stringify({
      resolvedAt: new Date().toISOString(),
      by,
      reason,
      lock,
      settled,
    }) + "\n",
  );
  if (lock) await Deno.remove(lockPath);
  return settled;
}

async function frozenExecutor(manifest: Manifest) {
  const source = await Deno.readTextFile("tools/discovery_improvement.ts");
  if (
    sha256(new TextEncoder().encode(source)) !==
      manifest.sources["tools/discovery_improvement.ts"]
  ) {
    throw Error("frozen runner source drift");
  }
  const adapterPath = resolve(
    "tools/discovery_improvement_adapter.generated.ts",
  );
  if (await Deno.readTextFile(adapterPath) !== adapterText(source)) {
    throw Error("generated adapter drift");
  }
  const helper = await import(new URL(`file://${adapterPath}`).href);
  let device: GPUDevice | null = null;
  return {
    execute: async (request: Request): Promise<AssayResult> => {
      device ??= await (await import("@bl/sim-gpu")).requestDevice(
        navigator.gpu,
        discoveryCompetitionConfig(request.seed),
      );
      return await helper.executeAssay(device, manifest, request);
    },
    destroy: () => device?.destroy(),
  };
}

async function count(dir: string) {
  let n = 0;
  if (await exists(dir)) {
    for await (const e of Deno.readDir(dir)) if (!IGNORED.has(e.name)) n++;
  }
  return n;
}
async function status(releasePath: string) {
  const r = await released(releasePath);
  const l = await ledger(r.out);
  return {
    replayed: await count(join(r.out, "replay")),
    replayTotal: r.replay.length,
    assays: await count(join(r.out, "assays")),
    assayTotal: r.requests.length,
    audits: await count(join(r.out, "audit")),
    auditsOwed: l.records.filter(needsAudit).length,
    mismatchRecorded: await recordedMismatch(r.out),
    invocations: l.count,
    chargedSeconds: l.charged,
    unresolvedReservations: l.reserved.length,
    capSeconds: r.c.budget.capSeconds,
    maxInvocations: r.c.budget.maxInvocations,
    stopped: await exists(join(r.out, "STOPPED.json")),
  };
}

async function run(releasePath: string, seconds: number) {
  const r = await released(releasePath);
  const ex = await frozenExecutor(r.manifest);
  try {
    const result = await invocation({
      out: r.out,
      seconds,
      capSeconds: r.c.budget.capSeconds,
      maxInvocations: r.c.budget.maxInvocations,
      minimumFreeBytes: r.c.minimumFreeBytes,
      sourceManifestHash: r.manifest.sourceManifestHash,
      identity: r.identity,
      replay: r.replay,
      requests: r.requests,
      signals: true,
    }, ex.execute);
    const after = await released(releasePath);
    if (after.identity.releaseSha256 !== r.identity.releaseSha256) {
      throw Error("release changed during run");
    }
    console.log(JSON.stringify(result));
  } finally {
    ex.destroy();
  }
}

/**
 * Sequential bounded invocations in fresh processes until complete. Stops on a failed
 * or stalled invocation or a recorded mismatch; a child exceeding its reservation plus
 * grace is terminated (SIGTERM, then SIGKILL) and supervision stops for diagnosis.
 */
async function supervise(releasePath: string, seconds: number) {
  for (;;) {
    const s = await status(releasePath);
    if (s.stopped) throw Error("study stopped");
    if (s.mismatchRecorded) {
      throw Error("replay or audit mismatch recorded; stop for diagnosis");
    }
    if (
      s.replayed === s.replayTotal && s.assays === s.assayTotal &&
      s.audits >= s.auditsOwed
    ) {
      console.log(JSON.stringify({ complete: true, ...s }));
      return;
    }
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-lock",
        "-A",
        "tools/discovery_divergence_control_run.ts",
        "run",
        releasePath,
        String(seconds),
      ],
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    let killed = false;
    const term = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, (seconds + WATCHDOG_GRACE_SECONDS) * 1000);
    const hard = setTimeout(
      () => child.kill("SIGKILL"),
      (seconds + WATCHDOG_GRACE_SECONDS + 30) * 1000,
    );
    const { code } = await child.status;
    clearTimeout(term);
    clearTimeout(hard);
    if (killed) {
      throw Error(
        "invocation exceeded its reservation and was terminated; stopped",
      );
    }
    if (code !== 0) throw Error(`invocation failed with exit ${code}; stopped`);
    const after = await status(releasePath);
    if (
      after.replayed === s.replayed && after.assays === s.assays &&
      after.audits === s.audits
    ) {
      throw Error("invocation made no progress; stopped");
    }
  }
}

if (import.meta.main) {
  const [stage, ...args] = Deno.args;
  const who = Deno.env.get("USER") ?? "unknown";
  if (stage === "candidate" && args.length === 9) {
    await candidate(
      args[0],
      args[1],
      args[2],
      args[3],
      args[4],
      args[5],
      args[6],
      Number(args[7]),
      Number(args[8]),
    );
  } else if (stage === "verify" && args.length === 1) {
    await released(args[0]);
    console.log("verified RELEASED");
  } else if (stage === "status" && args.length === 1) {
    console.log(JSON.stringify(await status(args[0])));
  } else if (stage === "run" && args.length === 2) {
    await run(args[0], Number(args[1]));
  } else if (stage === "supervise" && args.length === 2) {
    await supervise(args[0], Number(args[1]));
  } else if (stage === "resolve" && args.length === 2) {
    const r = await released(args[0]);
    console.log(JSON.stringify(await resolveStale(r.out, args[1], who)));
  } else if (stage === "stop" && args.length === 2) {
    const r = await released(args[0]);
    if (await exists(join(r.out, "RUNNING"))) {
      throw Error("runner lock is active");
    }
    await Deno.mkdir(r.out, { recursive: true });
    await writeNew(
      join(r.out, "STOPPED.json"),
      JSON.stringify({
        stoppedAt: new Date().toISOString(),
        by: who,
        reason: args[1],
        ...r.identity,
      }) + "\n",
    );
    console.log("stopped");
  } else {
    throw Error(
      "usage: candidate ROSTER MANIFEST REPORT PROTOCOL FORECAST ENGINEERING_CHECK NEW_CANDIDATE CAP_SECONDS MAX_INVOCATIONS | verify RELEASE | status RELEASE | run RELEASE SECONDS | supervise RELEASE SECONDS | resolve RELEASE REASON | stop RELEASE REASON",
    );
  }
}
