// Divergence-control analysis. Reads only a verified RELEASED study: the pinned roster
// and report plus the runner's output, re-validating every result, its provenance and
// every replay. Writes a new report; never overwrites.
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
import {
  ledger,
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
const outcome = (r: AssayResult): Outcome => ({
  status: r.status,
  score: r.score,
});

/** Load and re-validate the runner's output for the given requests and replays. */
export async function collect(
  out: string,
  requests: readonly Request[],
  replay: readonly { request: Request; expected: AssayResult }[],
  sourceManifestHash: string,
  identity: { candidateSha256: string; releaseSha256: string },
) {
  if (await exists(join(out, "RUNNING"))) throw Error("runner lock is active");
  if ((await ledger(out)).reserved) {
    throw Error("unresolved invocation reservation");
  }
  const results = new Map<string, Outcome>();
  const keys = new Set(requests.map((r) => r.cacheKey));
  if (await exists(join(out, "assays"))) {
    for await (const e of Deno.readDir(join(out, "assays"))) {
      if (!e.isFile || !keys.has(e.name.slice(0, -5))) {
        throw Error("foreign assay result");
      }
    }
  }
  for (const r of requests) {
    const path = join(out, "assays", `${r.cacheKey}.json`);
    if (!await exists(path)) {
      results.set(r.cacheKey, null);
      continue;
    }
    const raw = await Deno.readTextFile(path);
    const value = validateAssayResult(
      JSON.parse(raw),
      r.cacheKey,
      r.descendantHex,
      r.founderHex,
      r.seed,
      r.assignment,
      sourceManifestHash,
    );
    if (raw !== JSON.stringify(value) + "\n") {
      throw Error(`result bytes drift ${r.cacheKey}`);
    }
    const provenance = JSON.stringify({
      format: "discovery-divergence-control-provenance/v1",
      ...identity,
      cacheKey: r.cacheKey,
      resultSha256: sha256(raw),
    }) + "\n";
    if (
      await Deno.readTextFile(join(out, "provenance", `${r.cacheKey}.json`)) !==
        provenance
    ) {
      throw Error(`provenance drift ${r.cacheKey}`);
    }
    results.set(r.cacheKey, outcome(value));
  }
  let matched = 0;
  for (const r of replay) {
    const path = join(out, "replay", `${r.request.cacheKey}.json`);
    if (!await exists(path)) continue;
    const rec = JSON.parse(await Deno.readTextFile(path));
    const value = validateAssayResult(
      rec.result,
      r.request.cacheKey,
      r.request.descendantHex,
      r.request.founderHex,
      r.request.seed,
      r.request.assignment,
      sourceManifestHash,
    );
    const matches = sameOutcome(value, r.expected);
    if (matches !== rec.matches) {
      throw Error(
        `replay record disagrees with recomputation ${r.request.cacheKey}`,
      );
    }
    if (matches) matched++;
  }
  return { results, replay: { expected: replay.length, matched } };
}

export async function analyze(releasePath: string, reportPath: string) {
  const r = await released(releasePath);
  const roster = JSON.parse(await Deno.readTextFile(r.c.roster.path)) as Roster;
  const frozen = JSON.parse(
    await Deno.readTextFile(r.c.report.path),
  ) as ImprovementReport;
  const evolvedIds = new Set(roster.evolved.flatMap((e) => e.observationIds));
  const evolvedObservations = new Map<string, Outcome>();
  for (const o of frozen.observations) {
    if (!evolvedIds.has(o.id)) continue;
    evolvedObservations.set(
      o.id,
      o.status === "scored" || o.status === "both-extinct"
        ? { status: o.status, score: o.score }
        : null,
    );
  }
  const { results, replay } = await collect(
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
  });
  const report = {
    ...analysis,
    inputs: {
      releaseSha256: r.identity.releaseSha256,
      candidateSha256: r.identity.candidateSha256,
      rosterSha256: r.c.roster.sha256,
      frozenReportSha256: r.c.report.sha256,
      protocolSha256: r.c.protocol.sha256,
    },
  };
  await writeNew(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({
    technicalComplete: report.technicalComplete,
    selectionCertifiedBlocks: report.selection.certifiedBlocks,
    selectionCriterionMet: report.selection.criterionMet,
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
