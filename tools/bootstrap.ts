// M3 bootstrap: MAP-Elites search for viable, self-maintaining founders.
//
//   deno run -A tools/bootstrap.ts --batches 20 [--out runs/bootstrap] [--seed 1]
//
// Writes archive.json (elites with genomes and evaluations) and gate.json
// (elites that recover from a 30% lesion with p > 0.8 and die without light).
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { generalistGenome, randomGenome, type Genome } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { Archive, DEFAULT_EVAL, evaluateBatch, mutateGenome, pick, quality } from "@bl/search";

const a = parseArgs(Deno.args, { string: ["batches", "out", "seed", "random"], default: { batches: "10", out: "runs/bootstrap", seed: "1", random: "0.25" } });
const ec = { ...DEFAULT_EVAL, seed: Number(a.seed) };
const perBatch = Math.floor((ec.side * ec.side) / ec.reps);
const device = await requestDevice(navigator.gpu);
const archive = new Archive();
const mu = ec.world.defaultMu!, sigma = ec.world.defaultSigma!;
let rng = Number(a.seed) * 7919;
const enc = (g: Genome) => ({ mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Array.from(g.weights) });

await Deno.mkdir(a.out, { recursive: true });
for (let b = 0; b < Number(a.batches); b++) {
  const cands: Genome[] = [];
  for (let k = 0; k < perBatch; k++) {
    rng++;
    const el = archive.elites();
    if (b === 0 && k === 0) cands.push(generalistGenome(mu, sigma));
    else if (!el.length || (rng * 2654435761 >>> 0) / 2 ** 32 < Number(a.random)) cands.push(k % 2 ? randomGenome(rng, mu, sigma) : mutateGenome(generalistGenome(mu, sigma), rng, 6));
    else cands.push(mutateGenome(pick(el, rng).genome, rng, 1 + (rng % 4)));
  }
  const t0 = performance.now();
  const evals = await evaluateBatch(device, cands, { ...ec, seed: ec.seed + b });
  let inserted = 0;
  cands.forEach((g, k) => archive.offer(g, evals[k], b) && inserted++);
  const best = archive.elites().reduce((m, e) => Math.max(m, e.quality), 0);
  console.log(
    `batch ${b}: ${inserted}/${cands.length} inserted, coverage ${(archive.coverage() * 100).toFixed(0)}%, best q ${best.toFixed(3)}, gate-passing ${archive.gatePassing().length} (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
  );
  const dump = archive.elites().map((e) => ({ cell: e.cell, quality: e.quality, born: e.born, eval: e.eval, genome: enc(e.genome) }));
  await Deno.writeTextFile(`${a.out}/archive.json`, JSON.stringify({ evaluated: archive.evaluated, eval: ec, elites: dump }, null, 1));
  await Deno.writeTextFile(`${a.out}/gate.json`, JSON.stringify(archive.gatePassing().map((e) => ({ cell: e.cell, quality: quality(e.eval), eval: e.eval, genome: enc(e.genome) })), null, 1));
}
