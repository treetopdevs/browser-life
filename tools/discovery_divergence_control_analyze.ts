// Divergence-control analysis. Reads only a verified RELEASED study: the pinned roster
// and frozen report plus the runner's output, re-validating every result, its
// provenance, every replay and every audit. Partial data is analyzed only after the
// study has been formally stopped (no interim looks). Writes a new report only.
// Usage: deno run --no-lock -A tools/discovery_divergence_control_analyze.ts analyze RELEASE NEW_REPORT
import { join } from "node:path";
import { sha256 } from "./lib/founder-policy.ts";
import {
  type AssayResult,
  validateAssayResult,
  writeNew,
} from "./lib/discovery-improvement-runtime.ts";
import {
  analyzeDivergence,
  type ImprovementReport,
  type Outcome,
  type Roster,
} from "./lib/discovery-divergence-control.ts";
import { REPORT_SHA256 } from "./discovery_divergence_control.ts";
import {
  type Identity,
  ledger,
  needsAudit,
  provenanceText,
  released,
  type Request,
  sameOutcome,
} from "./discovery_divergence_control_run.ts";

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
async function names(dir: string): Promise<string[]> {
  const all: string[] = [];
  if (!await exists(dir)) return all;
  for await (const e of Deno.readDir(dir)) {
    if (e.name === ".DS_Store") continue;
    if (!e.isFile || !e.name.endsWith(".json")) {
      throw Error(`foreign entry ${dir}/${e.name}`);
    }
    all.push(e.name);
  }
  return all;
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

/** Load and re-validate the runner's output for the given requests, replays and audits. */
export async function collect(
  out: string,
  requests: readonly Request[],
  replay: readonly { request: Request; expected: AssayResult }[],
  sourceManifestHash: string,
  identity: Identity,
) {
  if (await exists(join(out, "RUNNING"))) throw Error("runner lock is active");
  const l = await ledger(out);
  if (l.reserved.length) {
    throw Error("unresolved invocation reservation");
  }
  const sid = identity.studyIdentitySha256;
  const keys = new Set(requests.map((r) => r.cacheKey));
  const assayNames = await names(join(out, "assays"));
  for (const n of assayNames) {
    if (!keys.has(n.slice(0, -5))) throw Error("foreign assay result");
  }
  for (const n of await names(join(out, "provenance"))) {
    if (!assayNames.includes(n)) throw Error("orphan provenance");
  }
  const results = new Map<string, Outcome>();
  for (const r of requests) {
    const path = join(out, "assays", `${r.cacheKey}.json`);
    if (!await exists(path)) {
      results.set(r.cacheKey, null);
      continue;
    }
    const raw = await Deno.readTextFile(path);
    const value = validate(JSON.parse(raw), r, sourceManifestHash);
    if (raw !== JSON.stringify(value) + "\n") {
      throw Error(`result bytes drift ${r.cacheKey}`);
    }
    if (
      await Deno.readTextFile(join(out, "provenance", `${r.cacheKey}.json`)) !==
        provenanceText(sid, r.cacheKey, sha256(raw))
    ) {
      throw Error(`provenance drift ${r.cacheKey}`);
    }
    results.set(r.cacheKey, { status: value.status, score: value.score });
  }
  const byReplayKey = new Map(replay.map((r) => [r.request.cacheKey, r]));
  const check = (
    rec: { studyIdentitySha256: string; matches: boolean; result: AssayResult },
    key: string,
  ) => {
    const r = byReplayKey.get(key);
    if (!r || rec.studyIdentitySha256 !== sid) {
      throw Error(`foreign replay or audit record ${key}`);
    }
    const matches = sameOutcome(
      validate(rec.result, r.request, sourceManifestHash),
      r.expected,
    );
    if (matches !== rec.matches) {
      throw Error(`replay or audit record disagrees with recomputation ${key}`);
    }
    return matches;
  };
  let matched = 0;
  for (const n of await names(join(out, "replay"))) {
    if (
      check(
        JSON.parse(await Deno.readTextFile(join(out, "replay", n))),
        n.slice(0, -5),
      )
    ) matched++;
  }
  // Every invocation that did, or may have done, new work needs its own matching audit.
  const auditOk = new Map<number, boolean>();
  for (const n of await names(join(out, "audit"))) {
    const rec = JSON.parse(await Deno.readTextFile(join(out, "audit", n)));
    if (rec.certifies !== Number(n.slice(0, 3))) {
      throw Error(`audit record misfiled ${n}`);
    }
    auditOk.set(rec.certifies, check(rec, rec.result?.cacheKey));
  }
  const owed = l.records.filter(needsAudit);
  const audits = {
    total: owed.length,
    matched: owed.filter((r) => auditOk.get(r.index) === true).length,
  };
  const missing = [...results.values()].filter((o) => o === null).length;
  if (missing && !await exists(join(out, "STOPPED.json"))) {
    throw Error(
      `${missing} results missing and the study is not stopped; no interim analysis`,
    );
  }
  return { results, replay: { expected: replay.length, matched }, audits };
}

export async function analyze(releasePath: string, reportPath: string) {
  const r = await released(releasePath);
  const frozenBytes = await Deno.readFile(r.c.report.path);
  if (sha256(frozenBytes) !== REPORT_SHA256) {
    throw Error("frozen report hash drift");
  }
  const frozen = JSON.parse(
    new TextDecoder().decode(frozenBytes),
  ) as ImprovementReport;
  const roster: Roster = r.roster;
  const used = new Set(roster.evolved.flatMap((e) => e.observationIds));
  const evolvedObservations = new Map<string, Outcome>();
  for (const o of frozen.observations) {
    if (!used.has(o.id)) continue;
    evolvedObservations.set(
      o.id,
      o.status === "scored" || o.status === "both-extinct"
        ? { status: o.status, score: o.score }
        : null,
    );
  }
  if (evolvedObservations.size !== used.size) {
    throw Error("evolved observations missing from the frozen report");
  }
  const { results, replay, audits } = await collect(
    r.out,
    r.requests,
    r.replay,
    r.manifest.sourceManifestHash,
    r.identity,
  );
  const analysis = analyzeDivergence({
    roster,
    evolvedObservations,
    results,
    replay,
    audits,
  });
  const report = {
    ...analysis,
    stopped: await exists(join(r.out, "STOPPED.json")),
    inputs: {
      ...r.identity,
      rosterSha256: r.c.roster.sha256,
      frozenReportSha256: r.c.report.sha256,
      protocolSha256: r.c.protocol.sha256,
    },
  };
  await writeNew(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({
    technicalComplete: report.technicalComplete,
    selection: report.selection.map((
      x,
    ) => [x.founderId, x.certifiedSeeds, x.criterionMet]),
    reconstruction: report.reconstruction.map((
      x,
    ) => [x.founderId, x.certifiedSeeds, x.criterionMet]),
  }));
}

if (import.meta.main) {
  const [stage, ...args] = Deno.args;
  if (stage === "analyze" && args.length === 2) await analyze(args[0], args[1]);
  else {throw Error(
      "usage: discovery_divergence_control_analyze.ts analyze RELEASE NEW_REPORT",
    );}
}
