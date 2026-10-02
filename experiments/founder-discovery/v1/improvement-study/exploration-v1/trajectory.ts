// Exploratory, post hoc (not confirmatory): founder-lineage abundance by genome at every
// saved checkpoint of the completed improvement study. Read-only over the consolidated
// histories; each checkpoint and edge delta is hash-checked against its receipt.
// No simulation, assay or analysis-chain validation is run.
// Usage: deno run --no-lock -A experiments/founder-discovery/v1/improvement-study/exploration-v1/trajectory.ts HISTORIES_DIR NEW_OUT.jsonl
import { decodeCheckpoint, lineageKey, packLineageLo } from "@bl/schema";
import { join } from "node:path";
import {
  ancestryResolver,
  type MutationEdge,
  rootMasses,
  sha256,
} from "../../../../../tools/lib/founder-policy.ts";

const MANIFEST =
  "experiments/founder-discovery/v1/improvement-study/manifest.json";
const [historiesDir, outPath] = Deno.args;
if (!historiesDir || !outPath) {
  throw Error("usage: trajectory.ts HISTORIES_DIR NEW_OUT.jsonl");
}
const manifest = JSON.parse(await Deno.readTextFile(MANIFEST));
const out = await Deno.open(outPath, { createNew: true, write: true });
const enc = new TextEncoder();

for (const unit of manifest.units) {
  const dir = join(historiesDir, unit.id);
  let edges: MutationEdge[] = [];
  for (const step of manifest.checkpointSteps as number[]) {
    const receipt = JSON.parse(
      await Deno.readTextFile(join(dir, `receipt-${step}.json`)),
    );
    const bytes = await Deno.readFile(join(dir, `checkpoint-${step}.blck`));
    const edgeBytes = await Deno.readFile(join(dir, `edges-${step}.json`));
    if (
      receipt.unitId !== unit.id || receipt.step !== step ||
      sha256(bytes) !== receipt.checkpointSha256 ||
      sha256(edgeBytes) !== receipt.edgeDeltaSha256
    ) throw Error(`receipt mismatch ${unit.id}/${step}`);
    edges = edges.concat(JSON.parse(new TextDecoder().decode(edgeBytes)));
    const { state } = decodeCheckpoint(bytes);
    if (state.step !== step) throw Error(`step mismatch ${unit.id}/${step}`);
    const roots = { [lineageKey(0, packLineageLo(state.cfg, 1))]: 0 };
    const m = rootMasses(state, ancestryResolver(roots, edges));
    await out.write(enc.encode(
      JSON.stringify({
        unitId: unit.id,
        founderId: unit.founderId,
        seed: unit.seed,
        mode: unit.mode,
        step,
        rootMass: m.roots[0].totalMass,
        unknownAncestryMass: m.unknownAncestryMass,
        unassociatedMass: m.unassociatedMass,
        byGenome: m.roots[0].byGenome,
      }) + "\n",
    ));
  }
  console.log(unit.id);
}
out.close();
