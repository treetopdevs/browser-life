// M3 bootstrap: MAP-Elites search for viable, self-maintaining founders, then
// the M3 gate.
//
//   deno run -A tools/bootstrap.ts --batches 20 [--out runs/bootstrap] [--seed 1]
//     [--confirm-reps 16] [--confirm-seed 1000001] [--confirm-only]
//     [--select lineages|cells] [--pass-bias 0.5] [--random 0.25]
//
// Parents are chosen by genetic lineage (Archive.pickParent) so that one
// lineage holding many behaviour cells does not crowd out other founders;
// --select cells restores uniform choice over cell elites. --random is the
// fraction of fresh candidates (random genomes and generalist mutants).
//
// Writes archive.json (elites with genomes and evaluations) and gate.json
// (screening passers: elites that recovered from a 30% lesion with p > 0.8 and
// died without light, over DEFAULT_EVAL.reps replicates). It then re-evaluates
// every screening passer on fresh seeds with --confirm-reps replicates and
// writes confirm.json with the M3 gate (m3Gate: genetic clusters of confirmed
// passers). --confirm-only skips the search and confirms an existing gate.json
// in --out; --confirm-reps 0 skips confirmation.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { generalistGenome, randomGenome, type Genome } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { binomialLowerBound } from "@bl/metrics";
import { Archive, CONFIRM_REPS, DEFAULT_EVAL, evaluateBatch, geneticClusters, confirmsGate, m3Gate, mutateGenome, parseProbability, pick, quality, type Evaluation } from "@bl/search";

const a = parseArgs(Deno.args, {
  string: ["batches", "out", "seed", "random", "confirm-reps", "confirm-seed", "select", "pass-bias"],
  boolean: ["confirm-only"],
  default: { batches: "10", out: "runs/bootstrap", seed: "1", random: "0.25", "confirm-reps": String(CONFIRM_REPS), "confirm-seed": "1000001", select: "lineages", "pass-bias": "0.5" },
});
const ec = { ...DEFAULT_EVAL, seed: Number(a.seed) };
if (a.select !== "lineages" && a.select !== "cells") throw new Error(`--select must be lineages or cells, not ${a.select}`);
const search = { select: a.select, passBias: parseProbability("--pass-bias", a["pass-bias"]), random: parseProbability("--random", a.random) };
const perBatch = Math.floor((ec.side * ec.side) / ec.reps);
const device = await requestDevice(navigator.gpu);
const archive = new Archive();
const mu = ec.world.defaultMu!, sigma = ec.world.defaultSigma!;
let rng = Number(a.seed) * 7919;
type EncGenome = { mu: number; sigma: number; motGain: number; weights: number[] };
const enc = (g: Genome): EncGenome => ({ mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Array.from(g.weights) });
const dec = (g: EncGenome): Genome => ({ ...g, weights: Int8Array.from(g.weights) });

await Deno.mkdir(a.out, { recursive: true });
if (!a["confirm-only"]) {
  for (let b = 0; b < Number(a.batches); b++) {
    const cands: Genome[] = [];
    for (let k = 0; k < perBatch; k++) {
      rng++;
      const el = archive.elites();
      if (b === 0 && k === 0) cands.push(generalistGenome(mu, sigma));
      else if (!el.length || (rng * 2654435761 >>> 0) / 2 ** 32 < search.random) cands.push(k % 2 ? randomGenome(rng, mu, sigma) : mutateGenome(generalistGenome(mu, sigma), rng, 6));
      else cands.push(mutateGenome(search.select === "cells" ? pick(el, rng).genome : archive.pickParent(rng, search.passBias)!.genome, rng, 1 + (rng % 4)));
    }
    const t0 = performance.now();
    const evals = await evaluateBatch(device, cands, { ...ec, seed: ec.seed + b });
    let inserted = 0;
    cands.forEach((g, k) => archive.offer(g, evals[k], b) && inserted++);
    const best = archive.elites().reduce((m, e) => Math.max(m, e.quality), 0);
    const lineages = archive.lineages();
    console.log(
      `batch ${b}: ${inserted}/${cands.length} inserted, coverage ${(archive.coverage() * 100).toFixed(0)}%, best q ${best.toFixed(3)}, gate-passing ${archive.gatePassing().length}, lineages ${lineages.length} (${lineages.filter((l) => l.passers > 0).length} with passers) (${((performance.now() - t0) / 1000).toFixed(1)}s)`,
    );
    const dump = archive.elites().map((e) => ({ cell: e.cell, quality: e.quality, born: e.born, eval: e.eval, genome: enc(e.genome) }));
    await Deno.writeTextFile(`${a.out}/archive.json`, JSON.stringify({ evaluated: archive.evaluated, eval: ec, search, searchSeeds: [ec.seed, ec.seed + b], lineages: lineages.map((l) => ({ size: l.size, passers: l.passers, best: l.best.length, bestCell: l.best[0].cell, bestQuality: l.best[0].quality })), elites: dump }, null, 1));
    await Deno.writeTextFile(`${a.out}/gate.json`, JSON.stringify(archive.gatePassing().map((e) => ({ cell: e.cell, quality: quality(e.eval), eval: e.eval, genome: enc(e.genome) })), null, 1));
  }
}

// Confirmation on fresh seeds: screening passes over a few replicates include
// candidates that passed by chance among the thousands screened.
const reps = Number(a["confirm-reps"]);
if (reps > 0) {
  const confirmSeed = Number(a["confirm-seed"]);
  const screened: { cell: [number, number]; genome: EncGenome }[] = JSON.parse(await Deno.readTextFile(`${a.out}/gate.json`));
  // The search's seed range comes from its archive, so --confirm-only checks it too.
  // Archives written before searchSeeds was recorded hold one batch of candidates per seed.
  const arch: { evaluated: number; eval: typeof ec; searchSeeds?: [number, number] } = JSON.parse(await Deno.readTextFile(`${a.out}/archive.json`));
  const [s0, s1] = arch.searchSeeds ?? [arch.eval.seed, arch.eval.seed + Math.ceil(arch.evaluated / Math.floor((arch.eval.side * arch.eval.side) / arch.eval.reps)) - 1];
  const cec = { ...arch.eval, reps, seed: confirmSeed };
  const per = Math.floor((cec.side * cec.side) / reps);
  if (per < 1) throw new Error(`--confirm-reps ${reps} exceeds the ${cec.side * cec.side} tiles of a batch`);
  const confirmBatches = Math.ceil(screened.length / per);
  if (confirmSeed <= s1 && confirmSeed + confirmBatches - 1 >= s0) {
    throw new Error(`confirmation seeds ${confirmSeed}..${confirmSeed + confirmBatches - 1} overlap search seeds ${s0}..${s1}; pass another --confirm-seed`);
  }
  if (reps < CONFIRM_REPS) console.warn(`--confirm-reps ${reps} < ${CONFIRM_REPS}: exploratory only, confirmations cannot meet the M3 gate`);
  const rows: { screenCell: [number, number]; cell: [number, number]; genome: Genome; eval: Evaluation }[] = [];
  for (let i = 0; i < screened.length; i += per) {
    const chunk = screened.slice(i, i + per);
    const t0 = performance.now();
    const evals = await evaluateBatch(device, chunk.map((s) => dec(s.genome)), { ...cec, seed: confirmSeed + i / per });  // batch i / per holds gate.json entries i..i + per - 1
    chunk.forEach((s, k) => rows.push({ screenCell: s.cell, cell: archive.cellOf(evals[k]), genome: dec(s.genome), eval: evals[k] }));
    console.log(`confirm ${rows.length}/${screened.length}: ${rows.filter((r) => confirmsGate(r.eval)).length} passing (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  }
  const gate = m3Gate(rows);
  const passing = rows.filter((r) => confirmsGate(r.eval));
  const cluster = geneticClusters(passing.map((r) => r.genome));
  const detail = {
    ...gate,
    reps,
    confirmSeed,
    batchSize: per,
    searchSeeds: [s0, s1],
    /** Confirmed passers whose regeneration rate has a 95% lower bound above 0.8 (informational). */
    lowerBoundAbove08: passing.filter((r) => binomialLowerBound(r.eval.regenerated, r.eval.reps) > 0.8).length,
    distinctCells: new Set(passing.map((r) => r.cell.join(","))).size,
  };
  console.log(`M3 gate ${gate.met ? "MET" : "NOT MET"}: ${JSON.stringify(detail)}`);
  const out = rows.map((r) => {
    const p = passing.indexOf(r);
    return { screenCell: r.screenCell, cell: r.cell, pass: p >= 0, cluster: p >= 0 ? cluster[p] : null, regenLowerBound: binomialLowerBound(r.eval.regenerated, r.eval.reps), eval: r.eval, genome: enc(r.genome) };
  });
  await Deno.writeTextFile(`${a.out}/confirm.json`, JSON.stringify({ gate: detail, eval: cec, rows: out }, null, 1));
}
