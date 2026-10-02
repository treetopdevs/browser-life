// Continuation analysis. Reads only a verified RELEASED study: the pinned roster plus
// the runner's output, re-validating every result, its provenance, every replay and
// every audit through the divergence-control collector, unchanged. Partial data is
// analyzed only after the study has been formally stopped (no interim looks).
// Usage: deno run --no-lock -A tools/discovery_continuation_analyze.ts analyze RELEASE NEW_REPORT
import { join } from "node:path";
import { writeNew } from "./lib/discovery-improvement-runtime.ts";
import { analyzeContinuation } from "./lib/discovery-continuation.ts";
import { collect } from "./discovery_divergence_control_analyze.ts";
import { released } from "./discovery_continuation_run.ts";

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

export async function analyze(releasePath: string, reportPath: string) {
  const r = await released(releasePath);
  const { results, replay, audits } = await collect(
    r.out,
    r.requests,
    r.replay,
    r.manifest.sourceManifestHash,
    r.identity,
  );
  const analysis = analyzeContinuation({
    roster: r.roster,
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
    continuation: report.continuation.map((
      x,
    ) => [x.founderId, x.certifiedSeeds, x.criterionMet]),
  }));
}

if (import.meta.main) {
  const [stage, ...args] = Deno.args;
  if (stage === "analyze" && args.length === 2) await analyze(args[0], args[1]);
  else {
    throw Error(
      "usage: discovery_continuation_analyze.ts analyze RELEASE NEW_REPORT",
    );
  }
}
