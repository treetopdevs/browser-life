// CPU-only constructed-possibility search. All candidate summaries retained; no evolutionary claim.
// deno run -A tools/construction-search.ts [output-directory]
import {
  founderGenome,
  generalistGenome,
  type Genome,
  genomeHex,
  ledgerResidual,
  M3_FOUNDERS,
  stateHash,
  totalsOf,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import {
  constructionConfig,
  constructionGenome,
  constructionWorld,
  withoutBuilding,
} from "./lib/construction.ts";
import {
  constructionProvenance,
  newConstructionOutput,
} from "./lib/construction-provenance.ts";
const out = Deno.args[0] ?? "runs/construction/competitor-search";
await newConstructionOutput(out);
const candidates: { name: string; genome: Genome }[] = [];
for (const photo of [64, 127]) {
  for (const resp of [0, 8, 16, 32, 64]) {
    for (const decomp of [32, 64, 127]) {
      for (const grow of [0, 64, 127]) {
        candidates.push({
          name: `simple-p${photo}-r${resp}-d${decomp}-g${grow}`,
          genome: constructionGenome({ build: 0, photo, resp, decomp, grow }),
        });
      }
    }
  }
}
candidates.push({
  name: "generalist-no-build",
  genome: withoutBuilding(generalistGenome(154, 24)),
});
for (const f of M3_FOUNDERS) {
  candidates.push({
    name: `m3-${f.cluster}-no-build`,
    genome: withoutBuilding(founderGenome(f)),
  });
}
await Deno.writeTextFile(
  `${out}/manifest.json`,
  JSON.stringify(
    {
      created: new Date().toISOString(),
      sources: await constructionProvenance(),
      config: constructionConfig(1),
      seeds: [1, 2],
      steps: 3000,
      initial: {
        x: 16,
        y: 16,
        biomass: 1024,
        energy: 2048,
        polymer: 0,
        nutrient: 0,
        waste: 0,
      },
      candidates: candidates.map((c) => ({
        name: c.name,
        genome: genomeHex(c.genome),
      })),
      ranking:
        "descending final B, then integrated B; summed over seeds; validation seeds separate",
      label: "constructed comparator screen, not evolution",
    },
    null,
    2,
  ),
);
const results = [];
for (const candidate of candidates) {
  const rows = [];
  for (const seed of [1, 2]) {
    const s = constructionWorld(constructionConfig(seed), [{
      x: 16,
      y: 16,
      genome: candidate.genome,
    }]);
    const initial = totalsOf(s.cfg, s.cells), sim = new RefSim(s);
    let biomassArea = 0;
    for (let t = 0; t < 3000; t++) {
      sim.step();
      biomassArea += sim.state.cells[1024 + 528];
    }
    const totals = totalsOf(s.cfg, sim.state.cells);
    if (
      totals.matter !== initial.matter ||
      ledgerResidual(initial, sim.state) !== 0n
    ) throw new Error("conservation failed");
    rows.push({ seed, totals, biomassArea, hash: stateHash(sim.state) });
  }
  const r = { name: candidate.name, genome: genomeHex(candidate.genome), rows };
  results.push(r);
  await Deno.writeTextFile(
    `${out}/rows.jsonl`,
    JSON.stringify(r, (_, v) => typeof v === "bigint" ? v.toString() : v) +
      "\n",
    { append: true },
  );
  console.log(candidate.name, rows.map((r) => String(r.totals.B)).join(","));
}
results.sort((a, b) =>
  b.rows.reduce((s, r) => s + Number(r.totals.B), 0) -
    a.rows.reduce((s, r) => s + Number(r.totals.B), 0) ||
  b.rows.reduce((s, r) => s + r.biomassArea, 0) -
    a.rows.reduce((s, r) => s + r.biomassArea, 0)
);
await Deno.writeTextFile(
  `${out}/ranking.json`,
  JSON.stringify(
    results,
    (_, v) => typeof v === "bigint" ? v.toString() : v,
    2,
  ),
);
