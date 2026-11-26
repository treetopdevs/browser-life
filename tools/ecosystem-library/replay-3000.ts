/** Bounded Node 24 proof. Run from the repository root with `node --experimental-strip-types tools/ecosystem-library/replay-3000.ts`. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ecosystem } from "../../apps/lab/src/ecosystem/model.ts";

const modelPath = "apps/lab/src/ecosystem/model.ts";
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== 24) {
  throw new Error(`This provenance check requires Node 24; found Node ${process.versions.node}`);
}
const modelHash = createHash("sha256").update(readFileSync(modelPath)).digest("hex");
const pinnedHash = "71b8cc9cd77651026430eac3913f9b0ad8ceafa4532c4bfa8703214ebccffed0";
if (modelHash !== pinnedHash) throw new Error(`Model hash mismatch: ${modelHash}`);

const staged = JSON.parse(readFileSync("docs/ecosystem-sandbox-exploration.json", "utf8"));
for (const seed of [1101, 1102, 1103]) {
  const expected = staged.results.find((result: { seed: number; staged: boolean }) =>
    result.seed === seed && result.staged)?.final;
  if (!expected) throw new Error(`No staged v4 census for seed ${seed}`);
  const sim = new Ecosystem(seed, 96, true);
  for (let tick = 0; tick < 3000; tick++) sim.step();
  const actual = sim.census();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`3,000-tick census mismatch for ${seed}: ${JSON.stringify(actual)}`);
  }
  console.log(`seed ${seed}: exact staged v4 census at tick 3,000; ${actual.population} individuals, ${actual.classes} trait classes`);
}
console.log(`model SHA-256 ${modelHash}; bounded replay complete (3 seeds × 3,000 ticks)`);
