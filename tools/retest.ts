// Retests M3 confirmed passers under the probability-gate rule adopted for
// gates after M3 (docs/plan.md, "Probability gates"): 32 replicates on fresh
// seeds, and survival, regeneration and death without light each need a
// one-sided 95% Clopper–Pearson lower bound above 0.8 (30 or more of 32).
//
//   deno run -A tools/retest.ts --confirm runs/bootstrap/confirm.json --out runs/retest
//     [--per-strong 4] [--seed 2000001]
//   deno run -A tools/retest.ts --from runs/retest/retest.json --replicate runs/replicate --seed 5000001
//   deno run -A tools/retest.ts --from runs/retest/retest.json --replication runs/replicate/replicate.json \
//     --founders packages/schema/src/founders.ts
//
// The first form evaluates every member of each cluster with no 16-replicate
// strict passer, up to --per-strong strict members of every other cluster, and
// generalistGenome(60, 20), and writes retest.json. The others reclassify an
// existing retest.json under the rule (no GPU) and pick each cluster's best
// passer (selectFounders in packages/search/src/retest.ts). --replicate
// evaluates those candidates again on fresh seeds and writes replicate.json,
// because picking the best of a cluster favours lucky batches. --founders
// keeps the candidates whose retest pooled with their replication still passes
// (replicatedFounders) and writes the ensemble founder set. Every stage refuses
// seeds not recorded as disjoint from all seeds used before it.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { generalistGenome, type Genome } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { binomialLowerBound, PROBABILITY_GATE } from "@bl/metrics";
import { checkFresh, usedSeeds, DEFAULT_EVAL, evaluateBatch, founderSetId, geneticClusters, passesStrictM3, replicatedFounders, selectFounders, type EncGenome, type Evaluation, type ReplicateRow, type RetestProvenance, type RetestRow } from "@bl/search";

const a = parseArgs(Deno.args, { string: ["confirm", "out", "per-strong", "seed", "from", "founders", "replicate", "replication"], default: { "per-strong": "4", seed: "2000001" } });
type Row = RetestRow;
const dec = (g: EncGenome): Genome => ({ ...g, weights: Int8Array.from(g.weights) });
const enc = (g: Genome): EncGenome => ({ mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Array.from(g.weights) });

let rows: Row[];
let provenance: RetestProvenance;
if (a.from) {
  const rec: { rows: Row[]; seeds?: [number, number]; provenance?: RetestProvenance } = JSON.parse(await Deno.readTextFile(a.from));
  if (!rec.provenance) throw new Error(`${a.from} records no seed provenance; its seeds cannot be shown to be fresh`);
  if (JSON.stringify(rec.seeds) !== JSON.stringify(rec.provenance.seeds)) throw new Error(`${a.from}: seeds ${JSON.stringify(rec.seeds)} disagree with provenance seeds ${JSON.stringify(rec.provenance.seeds)}`);
  rows = rec.rows;
  provenance = rec.provenance;
  checkFresh(provenance);
} else {
  if (!a.confirm || !a.out) throw new Error("pass --confirm and --out, or --from");
  const seed0 = Number(a.seed), perStrong = Number(a["per-strong"]);
  if (!Number.isSafeInteger(seed0) || !Number.isSafeInteger(perStrong) || perStrong < 0) throw new Error("--seed and --per-strong must be nonnegative integers");
  const c = JSON.parse(await Deno.readTextFile(a.confirm));
  // Clusters as the M3 gate counted them; weak = no member with a 16-replicate lower bound above 0.8.
  const by = new Map<number, { regenLowerBound: number; eval: Evaluation; genome: EncGenome }[]>();
  for (const r of c.rows.filter((r: { pass: boolean }) => r.pass)) by.set(r.cluster, [...(by.get(r.cluster) ?? []), r]);
  const items: Omit<Row, "eval">[] = [{ label: "generalistGenome(60,20)", cluster: null, weak: null, prior: null, genome: enc(generalistGenome(60, 20)) }];
  for (const [id, rs] of by) {
    const weak = !rs.some((r) => r.regenLowerBound > 0.8);
    (weak ? rs : rs.filter((r) => r.regenLowerBound > 0.8).slice(0, perStrong)).forEach((r, i) =>
      items.push({ label: `c${id}.${i}`, cluster: id, weak, prior: `${r.eval.regenerated}/${r.eval.reps}`, genome: r.genome })
    );
  }
  const ec = { ...DEFAULT_EVAL, reps: PROBABILITY_GATE.reps };
  const per = Math.floor((ec.side * ec.side) / ec.reps);
  const last = seed0 + Math.ceil(items.length / per) - 1;
  provenance = { seeds: [seed0, last], used: usedSeeds(c.gate ?? {}, c.rows.length) as [number, number][] };
  checkFresh(provenance);
  console.log(`${items.length} genomes (${items.filter((i) => i.weak).length} from weak clusters), ${ec.reps} replicates, seeds ${seed0}..${last}`);
  const device = await requestDevice(navigator.gpu);
  rows = [];
  for (let i = 0; i < items.length; i += per) {
    const chunk = items.slice(i, i + per);
    const t0 = performance.now();
    const evals = await evaluateBatch(device, chunk.map((x) => dec(x.genome)), { ...ec, seed: seed0 + i / per });
    chunk.forEach((x, k) => rows.push({ ...x, eval: evals[k] }));
    console.log(`retest ${rows.length}/${items.length} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  }
  await Deno.mkdir(a.out, { recursive: true });
  await Deno.writeTextFile(`${a.out}/retest.json`, JSON.stringify({ reps: ec.reps, seeds: [seed0, last], provenance, rows }, null, 1));
}

const lb = (k: number, n: number) => binomialLowerBound(k, n).toFixed(3);
const g = rows.find((r) => r.cluster === null);
if (g) console.log(`generalist: survived ${g.eval.survived}/${g.eval.reps}, regenerated ${g.eval.regenerated} (LB ${lb(g.eval.regenerated, g.eval.reps)}), died without light ${g.eval.lightDependent}, passes ${passesStrictM3(g.eval)}`);
const ids = [...new Set(rows.flatMap((r) => (r.cluster === null ? [] : [r.cluster])))].sort((x, y) => x - y);
for (const id of ids) {
  const rs = rows.filter((r) => r.cluster === id);
  console.log(`cluster ${id}${rs[0].weak ? " (weak)" : ""}: ${rs.filter((r) => passesStrictM3(r.eval)).length}/${rs.length} pass`);
}
const best = selectFounders(rows);
const passers = rows.filter((r) => r.cluster !== null && passesStrictM3(r.eval));
console.log(
  `rule: ${PROBABILITY_GATE.reps} replicates, lower bound > 0.8 for survival, regeneration and death without light; ` +
    `${passers.length} passers in ${best.length} of ${ids.length} clusters (${new Set(geneticClusters(passers.map((r) => dec(r.genome)))).size} after reclustering)`,
);

const ec32 = { ...DEFAULT_EVAL, reps: PROBABILITY_GATE.reps };
const per32 = Math.floor((ec32.side * ec32.side) / ec32.reps);
// Everything a replication must not reuse: the retest's own seeds and all seeds before it.
const priorToReplication: [number, number][] = [...provenance.used, provenance.seeds];

if (a.replicate) {
  const seed0 = Number(a.seed);
  if (!Number.isSafeInteger(seed0) || seed0 < 0) throw new Error("--seed must be a nonnegative integer");
  const repProv: RetestProvenance = { seeds: [seed0, seed0 + Math.ceil(best.length / per32) - 1], used: priorToReplication };
  checkFresh(repProv);
  console.log(`replicating ${best.length} founder candidates, ${ec32.reps} replicates, seeds ${repProv.seeds[0]}..${repProv.seeds[1]}`);
  const device = await requestDevice(navigator.gpu);
  const repRows: ReplicateRow[] = [];
  for (let i = 0; i < best.length; i += per32) {
    const chunk = best.slice(i, i + per32);
    const evals = await evaluateBatch(device, chunk.map((x) => dec(x.genome)), { ...ec32, seed: seed0 + i / per32 });
    chunk.forEach((x, k) => repRows.push({ label: x.label, cluster: x.cluster!, genome: x.genome, eval: evals[k] }));
  }
  for (const r of repRows) console.log(`replication cluster ${r.cluster}: survived ${r.eval.survived}, regenerated ${r.eval.regenerated}, died without light ${r.eval.lightDependent} of ${r.eval.reps}`);
  await Deno.mkdir(a.replicate, { recursive: true });
  await Deno.writeTextFile(`${a.replicate}/replicate.json`, JSON.stringify({ reps: ec32.reps, seeds: repProv.seeds, provenance: repProv, rows: repRows }, null, 1));
}

if (a.founders) {
  if (!a.replication) throw new Error("--founders needs --replication: founders are the candidates that hold up on a fresh-seed replication");
  const rec: { seeds?: [number, number]; provenance?: RetestProvenance; rows: ReplicateRow[] } = JSON.parse(await Deno.readTextFile(a.replication));
  if (!rec.provenance) throw new Error(`${a.replication} records no seed provenance`);
  if (JSON.stringify(rec.seeds) !== JSON.stringify(rec.provenance.seeds)) throw new Error(`${a.replication}: seeds disagree with provenance seeds`);
  checkFresh(rec.provenance);
  const has = (r: [number, number]) => rec.provenance!.used.some((u) => u[0] === r[0] && u[1] === r[1]);
  for (const r of priorToReplication) if (!has(r)) throw new Error(`${a.replication} does not record seeds ${r[0]}..${r[1]} as used, so its independence from ${a.from ?? "the retest"} is not shown`);
  const kept = replicatedFounders(best, rec.rows);
  const dropped = best.filter((b) => !kept.some((k) => k.row === b));
  console.log(`replication (seeds ${rec.provenance.seeds[0]}..${rec.provenance.seeds[1]}): ${kept.length} of ${best.length} candidates pass pooled; dropped clusters ${dropped.map((d) => d.cluster).join(", ") || "none"}`);
  const counts = (e: Evaluation) => `{ survived: ${e.survived}, regenerated: ${e.regenerated}, lightDependent: ${e.lightDependent}, reps: ${e.reps} }`;
  const hex = (w: number[]) => w.map((b) => (b & 0xff).toString(16).padStart(2, "0")).join("");
  const src = `// Generated by tools/retest.ts --founders from ${a.from ?? `${a.out}/retest.json`}; do not edit.
//
// The ensemble founder set: the best genome of each M3 genetic cluster that
// passes the M3 test under the later-gate rule (docs/plan.md, "Probability
// gates") — survival, regeneration after a 30% lesion and death without light
// each at a one-sided 95% lower bound above 0.8 — on ${PROBABILITY_GATE.reps} fresh-seed replicates
// (seeds ${provenance.seeds[0]}..${provenance.seeds[1]}), and still passes with those pooled with an
// independent replication (seeds ${rec.provenance.seeds[0]}..${rec.provenance.seeds[1]}, ${a.replication}).
//
// M3_FOUNDER_SET is the content digest of the set (founderSetId in
// packages/search/src/retest.ts). Presets bind to one set by id: a different
// set needs new preset ids, so runs from different sets are never pooled.
import type { Genome } from "./genome.ts";

export const M3_FOUNDER_SET = "${founderSetId(kept.map((k) => k.row.genome))}";

export interface M3Founder {
  /** Genetic cluster in the M3 confirmation (runs/bootstrap-200/confirm.json). */
  cluster: number;
  /** Retest and replication counts pooled, out of \`reps\`. */
  survived: number;
  regenerated: number;
  lightDependent: number;
  reps: number;
  retest: { survived: number; regenerated: number; lightDependent: number; reps: number };
  replication: { survived: number; regenerated: number; lightDependent: number; reps: number };
  mu: number;
  sigma: number;
  motGain: number;
  /** Controller weights, int8 as two's-complement hex. */
  weights: string;
}

export const M3_FOUNDERS: readonly M3Founder[] = [
${kept.map(({ row: r, replication: p, pooled: q }) => `  { cluster: ${r.cluster}, survived: ${q.survived}, regenerated: ${q.regenerated}, lightDependent: ${q.lightDependent}, reps: ${q.reps}, retest: ${counts(r.eval)}, replication: ${counts(p.eval)}, mu: ${r.genome.mu}, sigma: ${r.genome.sigma}, motGain: ${r.genome.motGain}, weights: "${hex(r.genome.weights)}" },`).join("\n")}
];

export function founderGenome(f: M3Founder): Genome {
  const w = new Int8Array(f.weights.length / 2);
  for (let i = 0; i < w.length; i++) w[i] = parseInt(f.weights.slice(2 * i, 2 * i + 2), 16) << 24 >> 24;
  return { mu: f.mu, sigma: f.sigma, motGain: f.motGain, weights: w };
}
`;
  await Deno.writeTextFile(a.founders, src);
  console.log(`wrote ${kept.length} founders to ${a.founders}`);
}
