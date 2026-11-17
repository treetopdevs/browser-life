/** Independent evidence/continuity/accounting audit. No simulation or GPU request. */
import { canonicalObserverJSON, decodeCheckpoint } from "@bl/schema";
import { readStage0 } from "./read-stage0.ts";
import { validateTrack } from "./continuity.ts";
import {
  assertConserved,
  type branchTrace,
  compareTraces,
  returnTime,
  stateIdentity,
} from "./parity.ts";
type Trace = Awaited<ReturnType<typeof branchTrace>>;
export async function auditStage0(
  out: string,
  budgetPath: string,
  source: string,
) {
  const result = await readStage0(out, budgetPath);
  const budget = result.verifiedAccounting; // Includes the reader's normalized unique settled debit.
  const read = async (path: string) =>
    JSON.parse(await Deno.readTextFile(`${out}/${path}`));
  const audited = [];
  const required = new Set(
    [2026102401, 2026102402].flatMap((seed) =>
      ["parent", "mutant"].flatMap((subject) =>
        ["legacy", "mass-targeted", "sham"].map((arm) =>
          `${seed}-${subject}-${arm}`
        )
      )
    ),
  );
  for (const r of result.results) {
    if (!required.delete(r.id)) {
      throw Error("wrong/duplicate engineering branch");
    }
    const base = r.id.split("-").slice(0, 2).join("-");
    const grown =
      decodeCheckpoint(await Deno.readFile(`${out}/${base}-grown.blck`)).state;
    const traces: Trace[] = [];
    for (const name of ["cpu25", "gpu25", "gpu50"]) {
      const t: Trace = await read(`${r.id}-${name}.json`),
        cadence = name === "gpu50" ? 50 : 25;
      const reference = t.rows[0].mass; // replaced below by authenticated original target
      if (!Number.isFinite(reference)) throw Error("bad initial mass");
      traces.push(t);
    }
    const subject = r.id.includes("-parent-") ? "parent" : "mutant",
      seed = Number(r.id.split("-")[0]);
    const id = `science-${subject}-${seed}`;
    const c = JSON.parse(
      await Deno.readTextFile(`${source}/cases/${id}/case.json`),
    );
    const sha = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(canonicalObserverJSON(c)),
        ),
      ),
    ].map((x) => x.toString(16).padStart(2, "0")).join("");
    if (
      sha !==
        result.inputEvidence.find((e: { id: string }) => e.id === id)
          ?.caseSha256
    ) throw Error("original target source mismatch");
    const mass = c.observation.target?.mass;
    if (!Number.isSafeInteger(mass) || mass <= 0) {
      throw Error("missing original engineering target mass");
    }
    for (const t of traces) {
      validateTrack(t.track, mass, t.cadence, grown.step);
      if (
        t.rows.length !== 2000 / t.cadence + 1 || t.rows[0].offset !== 0 ||
        t.rows[0].label !== t.track.initialLabel ||
        t.rows[0].mass !== t.initialMass
      ) throw Error("trace initialization mismatch");
      for (let i = 0; i < t.track.history.length; i++) {
        const h = t.track.history[i], row = t.rows[i + 1];
        if (
          row.offset !== h.step - grown.step || row.label !== h.label ||
          row.mass !== h.mass
        ) throw Error("trace/history disagreement");
      }
    }
    compareTraces(traces[0], traces[1]);
    compareTraces(traces[1], traces[2]);
    if (returnTime(traces[1], traces[2], mass, grown.step) !== r.T) {
      throw Error("saved T mismatch");
    }
    for (const phase of ["post", "final"]) {
      const s =
        decodeCheckpoint(await Deno.readFile(`${out}/${r.id}-${phase}.blck`))
          .state;
      assertConserved(grown, s);
      if (
        stateIdentity(s) !==
          (phase === "post" ? traces[1].rows[0] : traces[1].rows.at(-1)!)
            .identity
      ) throw Error("checkpoint/trace mismatch");
    }
    if (seed === 2026102401) {
      for (const [cadence, index] of [[25, 1], [50, 2]]) {
        if (
          canonicalObserverJSON(await read(`${r.id}-replay${cadence}.json`)) !==
            canonicalObserverJSON(traces[index])
        ) {
          throw Error("replay evidence mismatch");
        }
      }
    }
    audited.push(r.id);
  }
  if (required.size) throw Error("missing engineering branches");
  return {
    status: "STAGE0-INDEPENDENT-AUDIT-PASS",
    branches: audited,
    aggregateSpentMs: budget.spentMs,
    aggregateSpentBytes: budget.spentBytes,
    scientificSeedsRun: 0,
  };
}
if (import.meta.main) {
  if (Deno.args.length !== 3) {
    throw Error("usage: audit-stage0.ts OUT SHARED_BUDGET_JSON V1_DIR");
  }
  console.log(
    JSON.stringify(
      await auditStage0(Deno.args[0], Deno.args[1], Deno.args[2]),
      null,
      2,
    ),
  );
}
