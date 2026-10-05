// Replay one saved witness from its exact genome, configuration and documented placements.
// deno run -A tools/construction-verify.ts runs/construction/core-v1/builder-on-seed-101.json
import {
  decodeCheckpoint,
  genomeFromHex,
  ledgerResidual,
  stateHash,
  totalsOf,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { constructionGenome, constructionWorld } from "./lib/construction.ts";
const path = Deno.args[0];
if (!path?.endsWith(".json")) {
  throw new Error("provide an individual witness .json");
}
const { row } = JSON.parse(await Deno.readTextFile(path));
const manifest = JSON.parse(
  await Deno.readTextFile(
    path.slice(0, path.lastIndexOf("/")) + "/manifest.json",
  ),
);
const c = manifest.cases.find((c: { name: string }) => c.name === row.case);
if (!c) throw new Error("case absent from manifest");
const x = c.mirror ? 16 + (c.neighbour ?? 0) : 16,
  nx = c.mirror ? 16 : 16 + (c.neighbour ?? 0);
const placements = [{ x, y: 16, genome: genomeFromHex(row.genome) }];
if (c.neighbour) {
  placements.push({ x: nx, y: 16, genome: constructionGenome({ build: 0 }) });
}
const s = constructionWorld(row.cfg, placements),
  start = totalsOf(s.cfg, s.cells),
  sim = new RefSim(s);
let events = 0;
for (let t = 0; t < manifest.steps; t++) events += sim.step().events.length;
const saved =
  decodeCheckpoint(await Deno.readFile(path.replace(/\.json$/, ".blck"))).state;
if (
  events || stateHash(saved) !== row.hash ||
  stateHash(sim.state) !== row.hash ||
  ledgerResidual(start, sim.state) !== 0n ||
  totalsOf(sim.cfg, sim.state.cells).matter !== start.matter
) throw new Error("witness replay failed");
console.log(
  JSON.stringify({
    verified: path,
    steps: sim.state.step,
    hash: row.hash,
    mutationEvents: events,
    matterResidual: 0,
    energyResidual: 0,
  }),
);
