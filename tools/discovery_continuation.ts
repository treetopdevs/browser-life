// Continuation roster generator. For every normal history, verifies the whole chain with
// the frozen loader, checks the frozen 1M draws against its verified sample, finds each
// draw's 500k ancestor genome through the recorded mutation-parent edges, and writes a
// PREPARED roster. Reads checkpoints only; no simulation, no new randomness except the
// null mutants' fixed seeds.
// Protocol: experiments/founder-discovery/v1/continuation-protocol.md
// Usage: deno run --no-lock -A tools/discovery_continuation.ts plan REPORT MANIFEST HISTORIES_DIR NEW_ROSTER
import { dirname } from "node:path";
import { sha256 } from "./lib/founder-policy.ts";
import {
  validateManifest,
  writeNew,
} from "./lib/discovery-improvement-runtime.ts";
import {
  buildRoster,
  type ImprovementReport,
} from "./lib/discovery-divergence-control.ts";
import {
  buildContinuationRoster,
  historyAncestry,
} from "./lib/discovery-continuation.ts";
import { REPORT_SHA256 } from "./discovery_divergence_control.ts";

export const HISTORIES =
  "runs/founder-discovery-improvement-consolidated-v1/histories";

export async function frozenReport(path: string) {
  const bytes = await Deno.readFile(path);
  if (sha256(bytes) !== REPORT_SHA256) throw Error("report hash drift");
  return JSON.parse(new TextDecoder().decode(bytes)) as ImprovementReport;
}

/**
 * 500k ancestry for every normal history, in manifest order. Scratch hard links live in
 * a temporary directory directly under `runs/`, on the histories' filesystem but
 * outside the frozen study's tree.
 */
export async function ancestry(
  report: ImprovementReport,
  manifestPath: string,
  historiesDir: string,
  only?: readonly string[],
  log = (_: string) => {},
) {
  const manifest = validateManifest(
    JSON.parse(await Deno.readTextFile(manifestPath)),
  );
  const late = buildRoster(report, REPORT_SHA256, manifest).evolved;
  const scratch = await Deno.makeTempDir({
    dir: dirname(dirname(historiesDir)),
    prefix: "continuation-scratch-",
  });
  try {
    const out = [];
    for (const unit of manifest.units.filter((u) => u.mode === "normal")) {
      if (only && !only.includes(unit.id)) continue;
      const draws = late.filter((e) => e.unitId === unit.id).sort((a, b) =>
        a.draw - b.draw
      );
      if (draws.length !== 2 || draws.some((d, i) => d.draw !== i)) {
        throw Error(`late draws missing ${unit.id}`);
      }
      out.push(
        await historyAncestry(
          historiesDir,
          scratch,
          manifest,
          unit,
          draws.map((d) => d.descendantHex),
        ),
      );
      log(unit.id);
    }
    return { manifest, ancestry: out };
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}

export async function plan(
  reportPath: string,
  manifestPath: string,
  historiesDir: string,
  rosterPath: string,
) {
  const report = await frozenReport(reportPath);
  try {
    await Deno.lstat(rosterPath);
    throw new Deno.errors.AlreadyExists(rosterPath);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const { manifest, ancestry: a } = await ancestry(
    report,
    manifestPath,
    historiesDir,
    undefined,
    (id) => console.error(`traced ${id}`),
  );
  const roster = buildContinuationRoster(report, REPORT_SHA256, manifest, a);
  await writeNew(rosterPath, JSON.stringify(roster, null, 2) + "\n");
  console.log(JSON.stringify(roster.counts));
}

if (import.meta.main) {
  const [stage, ...args] = Deno.args;
  if (stage === "plan" && args.length === 4) {
    await plan(args[0], args[1], args[2], args[3]);
  } else {
    throw Error(
      "usage: discovery_continuation.ts plan REPORT MANIFEST HISTORIES_DIR NEW_ROSTER",
    );
  }
}
