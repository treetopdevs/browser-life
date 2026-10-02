// Divergence-control competition runner. A PREPARED candidate never authorizes GPU
// execution; only a RELEASED file naming the candidate's hash does. Competitions run
// through the frozen study's executeAssay via its exact generated adapter.
// Protocol: experiments/founder-discovery/v1/divergence-control-protocol.md
// Usage:
//   candidate ROSTER MANIFEST REPORT PROTOCOL NEW_CANDIDATE CAP_SECONDS MAX_INVOCATIONS
//   verify RELEASE | status RELEASE | run RELEASE SECONDS | supervise RELEASE SECONDS
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
} from "./lib/discovery-divergence-control.ts";
import { adapterText } from "./discovery_improvement_shard.ts";
import { noSymlinks } from "./discovery_improvement_import.ts";

export const MAX_INVOCATION_SECONDS = 3600;
const START_MARGIN_SECONDS = 60; // no new competition this close to the reservation
const RUNNER_SOURCES = [
  "tools/discovery_divergence_control_run.ts",
  "tools/discovery_divergence_control.ts",
  "tools/lib/discovery-divergence-control.ts",
  "tools/discovery_improvement_shard.ts",
  "tools/discovery_improvement_import.ts",
  "tools/discovery_improvement_adapter.generated.ts",
];
const EVOLVED_RESULTS =
  "runs/founder-discovery-improvement-consolidated-v1/assays";
const OUTPUT_REL = "runs/founder-discovery-divergence-control-v1";

export type Request = {
  cacheKey: string;
  descendantHex: string;
  founderHex: string;
  seed: number;
  assignment: number;
};
type Pin = { path: string; sha256: string };
export interface Candidate {
  format: "discovery-divergence-control-candidate/v1";
  status: "PREPARED";
  authorizesGpu: false;
  protocol: Pin;
  roster: Pin;
  manifest: Pin & { manifestHash: string; sourceManifestHash: string };
  report: Pin;
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

const readBytes = (p: string) => Deno.readFile(p);
const hashFile = async (p: string) => sha256(await readBytes(p));
const canonical = (r: AssayResult) => JSON.stringify(r) + "\n";
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

export function requestsOf(roster: ReturnType<typeof buildRoster>): Request[] {
  const genome = new Map(roster.genomes.map((g) => [g.id, g]));
  return roster.assays.map((a) => ({
    cacheKey: a.cacheKey,
    descendantHex: genome.get(a.genomeId)!.descendantHex,
    founderHex: genome.get(a.genomeId)!.founderHex,
    seed: a.assaySeed,
    assignment: a.assignment,
  }));
}

export async function candidate(
  rosterPath: string,
  manifestPath: string,
  reportPath: string,
  protocolPath: string,
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
  const reportBytes = await readBytes(reportPath);
  const rosterBytes = await readBytes(rosterPath);
  const roster = buildRoster(
    JSON.parse(new TextDecoder().decode(reportBytes)) as ImprovementReport,
    sha256(reportBytes),
    manifest,
  );
  if (
    new TextDecoder().decode(rosterBytes) !==
      JSON.stringify(roster, null, 2) + "\n"
  ) {
    throw Error("roster is not the generator's exact output for this report");
  }
  const executionSources: Record<string, string> = {};
  for (const [p, h] of Object.entries(manifest.sources)) {
    if (await hashFile(p) !== h) throw Error(`frozen source drift ${p}`);
    executionSources[p] = h;
  }
  for (const p of RUNNER_SOURCES) executionSources[p] = await hashFile(p);
  const replayExpected: Record<string, string> = {};
  for (const r of roster.replay) {
    replayExpected[r.cacheKey] = await hashFile(
      join(EVOLVED_RESULTS, `${r.cacheKey}.json`),
    );
  }
  const value: Candidate = {
    format: "discovery-divergence-control-candidate/v1",
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
    report: { path: reportPath, sha256: sha256(reportBytes) },
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
  await writeNew(candidatePath, JSON.stringify(value, null, 2) + "\n");
  console.log(
    JSON.stringify({ candidateSha256: await hashFile(candidatePath) }),
  );
}

/** Verify a RELEASED file and every pin it transitively names. */
export async function released(releasePath: string) {
  const releaseBytes = await readBytes(releasePath);
  const release = JSON.parse(new TextDecoder().decode(releaseBytes)) as Release;
  if (
    release.format !== "discovery-divergence-control-release/v1" ||
    release.status !== "RELEASED" || !release.reviewedBy ||
    !release.reviewReference
  ) throw Error("not a RELEASED divergence-control file");
  const candidateBytes = await readBytes(release.candidatePath);
  if (sha256(candidateBytes) !== release.candidateSha256) {
    throw Error("candidate hash drift");
  }
  const c = JSON.parse(new TextDecoder().decode(candidateBytes)) as Candidate;
  if (
    c.format !== "discovery-divergence-control-candidate/v1" ||
    c.status !== "PREPARED" || c.authorizesGpu !== false ||
    c.host.outputRel !== OUTPUT_REL ||
    c.budget.maxInvocationSeconds !== MAX_INVOCATION_SECONDS
  ) throw Error("candidate format drift");
  if (await Deno.realPath(Deno.cwd()) !== c.host.root) {
    throw Error("host root drift");
  }
  for (const pin of [c.protocol, c.roster, c.manifest, c.report]) {
    if (await hashFile(pin.path) !== pin.sha256) {
      throw Error(`pin drift ${pin.path}`);
    }
  }
  for (const [p, h] of Object.entries(c.executionSources)) {
    if (await hashFile(p) !== h) throw Error(`execution source drift ${p}`);
  }
  const manifest = validateManifest(
    JSON.parse(await Deno.readTextFile(c.manifest.path)),
  );
  const roster = JSON.parse(
    await Deno.readTextFile(c.roster.path),
  ) as ReturnType<typeof buildRoster>;
  const replay: { request: Request; expected: AssayResult }[] = [];
  for (const r of roster.replay) {
    const path = join(EVOLVED_RESULTS, `${r.cacheKey}.json`);
    const raw = await readBytes(path);
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
    validateAssayResult(
      expected,
      request.cacheKey,
      request.descendantHex,
      request.founderHex,
      request.seed,
      request.assignment,
      manifest.sourceManifestHash,
    );
    replay.push({ request, expected });
  }
  return {
    c,
    manifest,
    requests: requestsOf(roster),
    replay,
    identity: {
      candidateSha256: release.candidateSha256,
      releaseSha256: sha256(releaseBytes),
    },
    out: resolve(c.host.root, c.host.outputRel),
  };
}

type Ledger = { count: number; charged: number; reserved: number };
async function ledger(out: string): Promise<Ledger> {
  const dir = join(out, "invocations"),
    l = { count: 0, charged: 0, reserved: 0 };
  if (!await exists(dir)) return l;
  for await (const e of Deno.readDir(dir)) {
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
    if (r.status === "reserved") l.reserved++;
  }
  return l;
}

export interface InvocationOptions {
  out: string;
  seconds: number;
  capSeconds: number;
  maxInvocations: number;
  minimumFreeBytes: number;
  sourceManifestHash: string;
  identity: { candidateSha256: string; releaseSha256: string };
  replay: { request: Request; expected: AssayResult }[];
  requests: Request[];
  clock?: () => number; // seconds
  freeBytes?: (path: string) => number;
}
export type Execute = (request: Request) => Promise<AssayResult>;

/** One bounded invocation: replays first, then roster order; resumes from validated results. */
export async function invocation(o: InvocationOptions, execute: Execute) {
  const clock = o.clock ?? (() => performance.now() / 1000);
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
    if (
      e.isSymlink ||
      !["assays", "provenance", "replay", "invocations", "RUNNING"].includes(
        e.name,
      )
    ) {
      throw Error(`unexpected output artifact ${e.name}`);
    }
  }
  const lock = join(o.out, "RUNNING");
  await writeNew(lock, JSON.stringify({ pid: Deno.pid, ...o.identity }) + "\n");
  try {
    const l = await ledger(o.out);
    if (l.reserved) throw Error("unresolved invocation reservation");
    if (
      l.count + 1 > o.maxInvocations || l.charged + o.seconds > o.capSeconds
    ) {
      throw Error("budget exhausted");
    }
    const receiptPath = join(
      o.out,
      "invocations",
      `${String(l.count + 1).padStart(3, "0")}-${Deno.pid}.json`,
    );
    const receipt: Record<string, unknown> = {
      format: "discovery-divergence-control-invocation/v1",
      ...o.identity,
      status: "reserved",
      chargedSeconds: o.seconds,
      startedAt: new Date().toISOString(),
    };
    await writeNew(receiptPath, JSON.stringify(receipt) + "\n");
    const start = clock();
    let newAssays = 0, replayed = 0;
    try {
      // Resume: every cached artifact must be a known, valid, provenance-matched result.
      const byKey = new Map(o.requests.map((r) => [r.cacheKey, r]));
      const replayByKey = new Map(o.replay.map((r) => [r.request.cacheKey, r]));
      const done = new Set<string>(), replayDone = new Set<string>();
      const provenance = (key: string, resultSha256: string) =>
        JSON.stringify({
          format: "discovery-divergence-control-provenance/v1",
          ...o.identity,
          cacheKey: key,
          resultSha256,
        }) + "\n";
      for (const dir of ["assays", "provenance", "replay"]) {
        await Deno.mkdir(join(o.out, dir), { recursive: true });
      }
      for await (const e of Deno.readDir(join(o.out, "replay"))) {
        const r = replayByKey.get(e.name.slice(0, -5));
        if (!r || !e.isFile) throw Error("foreign replay record");
        const rec = JSON.parse(
          await Deno.readTextFile(join(o.out, "replay", e.name)),
        );
        if (rec.matches !== true) {
          throw Error("replay mismatch recorded; stop for diagnosis");
        }
        replayDone.add(r.request.cacheKey);
      }
      for await (const e of Deno.readDir(join(o.out, "assays"))) {
        const key = e.name.slice(0, -5), request = byKey.get(key);
        if (!request || !e.isFile || !e.name.endsWith(".json")) {
          throw Error("foreign assay cache entry");
        }
        const raw = await Deno.readTextFile(join(o.out, "assays", e.name));
        const value = JSON.parse(raw) as AssayResult;
        validateAssayResult(
          value,
          key,
          request.descendantHex,
          request.founderHex,
          request.seed,
          request.assignment,
          o.sourceManifestHash,
        );
        if (raw !== canonical(value)) throw Error("cached result bytes drift");
        if (
          await Deno.readTextFile(join(o.out, "provenance", e.name)) !==
            provenance(key, sha256(raw))
        ) {
          throw Error("cached provenance drift");
        }
        done.add(key);
      }
      for await (const e of Deno.readDir(join(o.out, "provenance"))) {
        if (!done.has(e.name.slice(0, -5))) throw Error("orphan provenance");
      }
      const room = () => clock() - start + START_MARGIN_SECONDS < o.seconds;
      const checked = async (request: Request) => {
        if (freeBytes(o.out) < o.minimumFreeBytes) {
          throw Error("storage floor reached");
        }
        const result = await execute(request);
        validateAssayResult(
          result,
          request.cacheKey,
          request.descendantHex,
          request.founderHex,
          request.seed,
          request.assignment,
          o.sourceManifestHash,
        );
        return result;
      };
      for (const r of o.replay) {
        if (replayDone.has(r.request.cacheKey)) continue;
        if (!room()) break;
        const result = await checked(r.request);
        const matches = sameOutcome(result, r.expected);
        await writeNew(
          join(o.out, "replay", `${r.request.cacheKey}.json`),
          JSON.stringify({ matches, result }) + "\n",
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
          await writeNew(
            join(o.out, "assays", `${request.cacheKey}.json`),
            text,
          );
          await writeNew(
            join(o.out, "provenance", `${request.cacheKey}.json`),
            provenance(request.cacheKey, sha256(text)),
          );
          done.add(request.cacheKey);
          newAssays++;
        }
      }
      const complete = replayDone.size === o.replay.length &&
        done.size === o.requests.length;
      Object.assign(receipt, {
        status: "settled",
        chargedSeconds: clock() - start,
        finishedAt: new Date().toISOString(),
        replayed,
        newAssays,
        complete,
      });
      return {
        replayed,
        newAssays,
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
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    } finally {
      await Deno.writeTextFile(receiptPath, JSON.stringify(receipt) + "\n");
    }
  } finally {
    await Deno.remove(lock);
  }
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

async function status(releasePath: string) {
  const r = await released(releasePath);
  const count = async (d: string) => {
    let n = 0;
    if (await exists(join(r.out, d))) {
      for await (const _ of Deno.readDir(join(r.out, d))) {
        n++;
      }
    }
    return n;
  };
  const l = await ledger(r.out);
  return {
    replayed: await count("replay"),
    replayTotal: r.replay.length,
    assays: await count("assays"),
    assayTotal: r.requests.length,
    invocations: l.count,
    chargedSeconds: l.charged,
    unresolvedReservations: l.reserved,
    capSeconds: r.c.budget.capSeconds,
    maxInvocations: r.c.budget.maxInvocations,
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

/** Sequential bounded invocations in fresh processes until complete or a failure. */
async function supervise(releasePath: string, seconds: number) {
  for (;;) {
    const s = await status(releasePath);
    if (s.replayed === s.replayTotal && s.assays === s.assayTotal) {
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
    const { code } = await child.status;
    if (code !== 0) throw Error(`invocation failed with exit ${code}; stopped`);
    const after = await status(releasePath);
    if (after.replayed === s.replayed && after.assays === s.assays) {
      throw Error("invocation made no progress; stopped");
    }
  }
}

if (import.meta.main) {
  const [stage, ...args] = Deno.args;
  if (stage === "candidate" && args.length === 7) {
    await candidate(
      args[0],
      args[1],
      args[2],
      args[3],
      args[4],
      Number(args[5]),
      Number(args[6]),
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
  } else {
    throw Error(
      "usage: candidate ROSTER MANIFEST REPORT PROTOCOL NEW_CANDIDATE CAP_SECONDS MAX_INVOCATIONS | verify RELEASE | status RELEASE | run RELEASE SECONDS | supervise RELEASE SECONDS",
    );
  }
}
