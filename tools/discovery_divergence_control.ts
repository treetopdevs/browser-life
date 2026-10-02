// Divergence-control generator. `plan` writes a PREPARED roster from the frozen
// operation042 report; a PREPARED roster never authorizes execution.
// Usage: deno run --no-lock -A tools/discovery_divergence_control.ts plan REPORT MANIFEST NEW_ROSTER
import { sha256 } from "./lib/founder-policy.ts";
import {
  validateManifest,
  writeNew,
} from "./lib/discovery-improvement-runtime.ts";
import {
  buildRoster,
  type ImprovementReport,
} from "./lib/discovery-divergence-control.ts";

export const REPORT_SHA256 =
  "085d55cf1f7121ece85ff3a5dc9fa5f236c912531e480e3262db99ad205ec68a";

export async function plan(
  reportPath: string,
  manifestPath: string,
  rosterPath: string,
): Promise<void> {
  const bytes = await Deno.readFile(reportPath);
  if (sha256(bytes) !== REPORT_SHA256) throw Error("report hash drift");
  const report = JSON.parse(
    new TextDecoder().decode(bytes),
  ) as ImprovementReport;
  const manifest = validateManifest(
    JSON.parse(await Deno.readTextFile(manifestPath)),
  );
  const roster = buildRoster(report, REPORT_SHA256, manifest);
  await writeNew(rosterPath, JSON.stringify(roster, null, 2) + "\n");
  console.log(JSON.stringify(roster.counts));
}

if (import.meta.main) {
  const [stage, ...args] = Deno.args;
  if (stage === "plan" && args.length === 3) {
    await plan(args[0], args[1], args[2]);
  } else {
    throw Error(
      "usage: discovery_divergence_control.ts plan REPORT MANIFEST NEW_ROSTER",
    );
  }
}
