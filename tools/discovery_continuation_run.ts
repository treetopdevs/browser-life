// Continuation competition runner. A PREPARED candidate never authorizes GPU execution;
// only a RELEASED file naming the candidate's hash does. Execution reuses the reviewed
// divergence-control invocation core unchanged (replays first, atomic results with
// provenance, per-invocation audits, budget, lock, stop and recovery rules), and
// competitions run through the frozen study's executeAssay via its generated adapter.
// Protocol: experiments/founder-discovery/v1/continuation-protocol.md
// Usage:
//   candidate ROSTER MANIFEST REPORT PROTOCOL FORECAST HISTORIES_DIR NEW_CANDIDATE CAP_SECONDS MAX_INVOCATIONS
//   verify RELEASE | status RELEASE | run RELEASE SECONDS | supervise RELEASE SECONDS
//   resolve RELEASE REASON   (after a killed process: settle its reservation as failed)
//   stop RELEASE REASON      (permanently end execution; allows analysis of partial data)
import { join, resolve } from "node:path";
import { sha256 } from "./lib/founder-policy.ts";
import {
  type AssayResult,
  type Manifest,
  validateAssayResult,
  validateManifest,
  writeNew,
} from "./lib/discovery-improvement-runtime.ts";
import { discoveryCompetitionConfig } from "./lib/discovery-competition.ts";
import type { ImprovementReport } from "./lib/discovery-divergence-control.ts";
import {
  buildContinuationRoster,
  type ContinuationRoster,
} from "./lib/discovery-continuation.ts";
import { REPORT_SHA256 } from "./discovery_divergence_control.ts";
import { ancestry } from "./discovery_continuation.ts";
import {
  EVOLVED_RESULTS,
  hashMap,
  type Identity,
  invocation,
  ledger,
  MAX_INVOCATION_SECONDS,
  needsAudit,
  type Request,
  resolveStale,
} from "./discovery_divergence_control_run.ts";
import { adapterText } from "./discovery_improvement_shard.ts";

const WATCHDOG_GRACE_SECONDS = 120;
export const RUNNER_SOURCES = [
  "tools/discovery_continuation_run.ts",
  "tools/discovery_continuation_analyze.ts",
  "tools/discovery_continuation.ts",
  "tools/lib/discovery-continuation.ts",
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
  "tools/discovery_continuation_analyze.ts",
  "tools/discovery_continuation.ts",
  "tools/lib/discovery-continuation.ts",
  "tools/discovery_divergence_control_analyze.ts",
  "tools/discovery_divergence_control.ts",
  "tools/lib/discovery-divergence-control.ts",
];
export const OUTPUT_REL = "runs/founder-discovery-continuation-v1";
const IGNORED = new Set([".DS_Store"]);

type Pin = { path: string; sha256: string };
export interface Candidate {
  format: "discovery-continuation-candidate/v1";
  status: "PREPARED";
  authorizesGpu: false;
  studyIdentitySha256: string;
  protocol: Pin;
  roster: Pin;
  manifest: Pin & { manifestHash: string; sourceManifestHash: string };
  report: Pin;
  forecast: Pin;
  midpointReceipts: Record<string, string>;
  rederivedHistories: string[];
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
  format: "discovery-continuation-release/v1";
  status: "RELEASED";
  candidatePath: string;
  candidateSha256: string;
  reviewedBy: string;
  reviewReference: string;
  reviewedAt: string;
}

const hashFile = async (p: string) => sha256(await Deno.readFile(p));
/**
 * Results, replays and audits bind to what determines them: roster, manifest, frozen
 * report, replay originals and execution-path sources. Not to the protocol text,
 * analysis-only code, midpoint receipts (the roster carries their hashes) or budget.
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

/** In this study the assay's "founder" role holds the midpoint (H) genome. */
export function requestsOf(roster: ContinuationRoster): Request[] {
  return roster.assays.map((a) => ({
    cacheKey: a.cacheKey,
    descendantHex: a.descendantHex,
    founderHex: a.ancestorHex,
    seed: a.assaySeed,
    assignment: a.assignment,
  }));
}

async function frozenReport(path: string) {
  const bytes = await Deno.readFile(path);
  if (sha256(bytes) !== REPORT_SHA256) throw Error("frozen report hash drift");
  return JSON.parse(new TextDecoder().decode(bytes)) as ImprovementReport;
}

/**
 * PREPARED candidate. Re-derives the whole roster: every history's chain is re-verified
 * by the frozen loader, every 500k ancestor is re-traced, and the roster must be the
 * generator's exact output. A candidate that re-derived only some histories (tests) is
 * recorded as such and never verifies as released.
 */
export async function candidate(
  rosterPath: string,
  manifestPath: string,
  reportPath: string,
  protocolPath: string,
  forecastPath: string,
  historiesDir: string,
  candidatePath: string,
  capSeconds: number,
  maxInvocations: number,
  only?: readonly string[], // tests only: re-sample a subset of histories
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
  const rosterBytes = await Deno.readFile(rosterPath);
  const stored = JSON.parse(
    new TextDecoder().decode(rosterBytes),
  ) as ContinuationRoster;
  const traced = await ancestry(report, manifestPath, historiesDir, only);
  for (const t of traced.ancestry) {
    const h = stored.histories.find((x) => x.unitId === t.history.unitId);
    const a = stored.ancestors.filter((x) => x.unitId === t.history.unitId);
    if (
      JSON.stringify(h) !== JSON.stringify(t.history) ||
      JSON.stringify(a) !== JSON.stringify(t.ancestors)
    ) throw Error(`ancestry does not re-derive ${t.history.unitId}`);
  }
  const roster = buildContinuationRoster(
    report,
    REPORT_SHA256,
    manifest,
    stored.histories.map((history) => ({
      history,
      ancestors: stored.ancestors.filter((a) => a.unitId === history.unitId),
    })),
  );
  if (
    new TextDecoder().decode(rosterBytes) !==
      JSON.stringify(roster, null, 2) + "\n"
  ) {
    throw Error("roster is not the generator's exact output for this report");
  }
  const midpointReceipts: Record<string, string> = {};
  for (const h of roster.histories) {
    for (
      const [step, hash] of [
        [500000, h.receipt500kSha256],
        [1000000, h.receipt1MSha256],
      ] as const
    ) {
      const p = join(historiesDir, h.unitId, `receipt-${step}.json`);
      if (await hashFile(p) !== hash) {
        throw Error(`midpoint receipt drift ${h.unitId}/${step}`);
      }
      midpointReceipts[p] = hash;
    }
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
    const raw = await Deno.readFile(join(EVOLVED_RESULTS, `${r.cacheKey}.json`));
    const frozenScore = report.observations.find((o) =>
      o.id === r.observationId
    )?.score;
    if (JSON.parse(new TextDecoder().decode(raw)).score !== frozenScore) {
      throw Error(`replay original disagrees with the frozen report ${r.cacheKey}`);
    }
    replayExpected[r.cacheKey] = sha256(raw);
  }
  const body: Omit<Candidate, "studyIdentitySha256"> = {
    format: "discovery-continuation-candidate/v1",
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
    midpointReceipts,
    rederivedHistories: traced.ancestry.map((t) => t.history.unitId),
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
  const value: Candidate = { studyIdentitySha256: studyIdentity(body), ...body };
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
    release.format !== "discovery-continuation-release/v1" ||
    release.status !== "RELEASED" || !release.reviewedBy ||
    !release.reviewReference ||
    !Number.isFinite(Date.parse(release.reviewedAt))
  ) throw Error("not a RELEASED continuation file");
  const candidateBytes = await Deno.readFile(release.candidatePath);
  if (sha256(candidateBytes) !== release.candidateSha256) {
    throw Error("candidate hash drift");
  }
  const c = JSON.parse(new TextDecoder().decode(candidateBytes)) as Candidate;
  const { studyIdentitySha256, ...body } = c;
  if (
    c.format !== "discovery-continuation-candidate/v1" ||
    c.status !== "PREPARED" || c.authorizesGpu !== false ||
    c.host.outputRel !== OUTPUT_REL || c.report.sha256 !== REPORT_SHA256 ||
    c.budget.maxInvocationSeconds !== MAX_INVOCATION_SECONDS ||
    studyIdentity(body) !== studyIdentitySha256
  ) throw Error("candidate format drift");
  if (await Deno.realPath(Deno.cwd()) !== c.host.root) {
    throw Error("host root drift");
  }
  for (const pin of [c.protocol, c.roster, c.manifest, c.report, c.forecast]) {
    if (await hashFile(pin.path) !== pin.sha256) {
      throw Error(`pin drift ${pin.path}`);
    }
  }
  for (const [p, h] of Object.entries(c.midpointReceipts)) {
    if (await hashFile(p) !== h) throw Error(`midpoint receipt drift ${p}`);
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
  const roster = JSON.parse(
    await Deno.readTextFile(c.roster.path),
  ) as ContinuationRoster;
  if (
    JSON.stringify(c.rederivedHistories) !==
      JSON.stringify(roster.histories.map((h) => h.unitId)) ||
    Object.keys(c.midpointReceipts).length !== 2 * roster.histories.length
  ) throw Error("candidate did not re-derive every history");
  const replay: { request: Request; expected: AssayResult }[] = [];
  for (const r of roster.replay) {
    const raw = await Deno.readFile(join(EVOLVED_RESULTS, `${r.cacheKey}.json`));
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
export async function status(releasePath: string) {
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
        "tools/discovery_continuation_run.ts",
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
      "usage: candidate ROSTER MANIFEST REPORT PROTOCOL FORECAST HISTORIES_DIR NEW_CANDIDATE CAP_SECONDS MAX_INVOCATIONS | verify RELEASE | status RELEASE | run RELEASE SECONDS | supervise RELEASE SECONDS | resolve RELEASE REASON | stop RELEASE REASON",
    );
  }
}
