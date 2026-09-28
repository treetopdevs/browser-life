/** Opt-in read-only check of the ignored, local A2 evidence artifact. */
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const dir = resolve(Deno.args[0] ?? "runs/foundations-next/serial-v2-stage-0-plan-v3");
const planBytes = await Deno.readFile(join(dir, "plan.json"));
const result = JSON.parse(await Deno.readTextFile(join(dir, "result.json")));
const requireEvidence = (condition: boolean, message: string) => {
  if (!condition) throw new Error(`A2 evidence check: ${message}`);
};
requireEvidence(result.status === "complete" && result.postExecutionRevalidated === true,
  "stage is not post-authenticated complete");
requireEvidence(result.planFile.sha256 === createHash("sha256").update(planBytes).digest("hex"),
  "result is not bound to its immutable plan");
requireEvidence(JSON.stringify(result.rows.map((row: { arm: string }) => row.arm)) ===
  JSON.stringify(["donor", "founder-genotype", "zero-controller-genotype", "empty"]),
  "arm order differs");
for (const row of result.rows) requireEvidence(row.status === "complete" &&
  row.outcome.conservationOk === true && row.outcome.mutations === 0 &&
  row.outcome.reference.matchedMeasured === true, `${row.arm} is not a complete control`);
const zero = result.rows[2].outcome;
requireEvidence(zero.finalInventory.B === "0" && zero.finalInventory.P === "0" &&
  zero.selection.status === "no-eligible-transition" && zero.selectedPacket === null,
  "zero-controller outcome is not completed extinction");
requireEvidence(result.rows[3].outcome.selection === null, "empty garden is not separate");
console.log(`A2 read-only local evidence check passed: ${dir}`);
