// Obligate characterisation: what do the background-medium obligates actually do?
// Plan + run + read in one script (docs/plan.md, "Obligate characterisation (fixed 2026-09-30, before
// any result)"). Reuses evaluateBatch with the optional role observer; DEFAULT_EVAL output is unchanged.
//
//   deno run -A tools/obligates-x.ts [--stage plan|run|read|all] [--reps 16] [--seed 4790001]
//     [--dir runs/bootstrap-medium-background] [--work runs/obligates-x] [--out experiments/foundations/fo.json]
//     [--media standard,waste,bg0,bg2,x4] [--batches N]   (--batches / --media limit a run, for smoke tests)
//
// plan  CPU only: picks the subjects and the second producer, writes plan.json (and the plan key of fo.json).
// run   native WebGPU: evaluates every subject in every medium, appending one JSON line per batch to
//       <work>/batches.jsonl (resumable: batches already present are skipped).
// read  CPU only: assembles the cells and applies the pre-stated readings (tools/lib/obligates-x.ts).
//
// Roles are read out, never scored. Seeds: batch b of medium k uses seed + 20 k + b.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { M3_FOUNDERS, emptyGenome, founderGenome, genomeDistance, genomeHex, type Genome } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { DEFAULT_EVAL, evaluateBatch, type EvalConfig, type Evaluation } from "@bl/search";
import { MEDIA, farthest, interleave, pickSubjects, readOut, type Cell, type Cells, type MediumId, type Subject } from "./lib/obligates-x.ts";

const a = parseArgs(Deno.args, {
  string: ["stage", "reps", "seed", "dir", "work", "out", "media", "batches"],
  default: { stage: "all", reps: "16", seed: "4790001", dir: "runs/bootstrap-medium-background", work: "runs/obligates-x", out: "experiments/foundations/fo.json" },
});
const reps = Number(a.reps), seed0 = Number(a.seed);
if (!Number.isSafeInteger(reps) || reps < 8 || !Number.isSafeInteger(seed0)) throw new Error("--reps must be an integer >= 8 and --seed an integer");
const perBatch = Math.floor((DEFAULT_EVAL.side * DEFAULT_EVAL.side) / reps);

type Enc = { mu: number; sigma: number; motGain: number; weights: number[] | Record<string, number> };
const toG = (g: Enc): Genome => ({ mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Int8Array.from({ length: 160 }, (_, i) => (Array.isArray(g.weights) ? g.weights[i] : g.weights[String(i)]) ?? 0) });
const key = (g: Genome) => JSON.stringify([g.mu, g.sigma, g.motGain, Array.from(g.weights)]);
const json = (x: unknown) => JSON.stringify(x, null, 1) + "\n";

// ---------- plan (deterministic, CPU)
const confirm = JSON.parse(await Deno.readTextFile(`${a.dir}/confirm.json`));
const dep: { genome: Enc; obligate: boolean }[] = confirm.dependence.rows;
const obligateByKey = new Map(dep.map((d) => [key(toG(d.genome)), d.obligate]));
const confirmed: { genome: Enc; cluster: number }[] = confirm.rows.filter((r: { pass: boolean }) => r.pass);
const pool = confirmed.map((r) => {
  const ob = obligateByKey.get(key(toG(r.genome)));
  if (ob === undefined) throw new Error("a confirmed genome has no dependence row in confirm.json");
  return { genome: toG(r.genome), cluster: r.cluster, obligate: ob };
});
if (pool.filter((p) => p.obligate).length !== confirm.dependence.obligate) throw new Error(`pool holds ${pool.filter((p) => p.obligate).length} obligates, confirm.json records ${confirm.dependence.obligate}`);
const producer0 = founderGenome(M3_FOUNDERS[0]);
const screenBackground = toG(confirm.eval.medium.background);
if (genomeDistance(producer0, screenBackground) !== 0) throw new Error("the screen's background genome is not M3 founder 0");
const founders = M3_FOUNDERS.map(founderGenome);
const p2 = 1 + farthest(producer0, founders.slice(1));
const producer2 = founders[p2];
const reference: Subject[] = [
  { id: "producer0", group: "producer0", cluster: null, genome: producer0 },
  { id: `producer2:founder${p2}`, group: "producer2", cluster: null, genome: producer2 },
  { id: "null", group: "null", cluster: null, genome: emptyGenome(DEFAULT_EVAL.world.defaultMu!, DEFAULT_EVAL.world.defaultSigma!) },
];
const subjects = interleave([...pickSubjects(pool), ...reference]);
const batches = Array.from({ length: Math.ceil(subjects.length / perBatch) }, (_, b) => subjects.slice(b * perBatch, (b + 1) * perBatch));

const base: EvalConfig = { ...DEFAULT_EVAL, reps, roles: true, perRep: true };
const mediaDef: Record<MediumId, { label: string; patch: Partial<EvalConfig> }> = {
  standard: { label: "standard (DEFAULT_EVAL)", patch: {} },
  waste: { label: "waste 8/24 (nutrient 8, waste 24)", patch: { nutrient: 8, medium: { waste: 24 } } },
  bg0: { label: "background: M3 founder 0 (the screen's producer), darkSteps 4000", patch: { medium: { background: producer0 }, darkSteps: 4000, roleScope: "lineage" } },
  bg2: { label: `background: M3 founder ${p2} (farthest from founder 0 in genome slots), darkSteps 4000`, patch: { medium: { background: producer2 }, darkSteps: 4000, roleScope: "lineage" } },
  x4: { label: "standard at 4x seeding biomass (256, energy 512)", patch: { biomass: 256 } },
};
const selected = (a.media ? a.media.split(",") : MEDIA) as MediumId[];
for (const m of selected) if (!MEDIA.includes(m)) throw new Error(`unknown medium ${m}`);
const nBatches = a.batches ? Math.min(Number(a.batches), batches.length) : batches.length;
const seedOf = (m: MediumId, b: number) => seed0 + 20 * MEDIA.indexOf(m) + b;

const plan = {
  date: "2026-09-30",
  script: "tools/obligates-x.ts",
  reps,
  seeds: { base: seed0, rule: "seed + 20 * mediumIndex + batchIndex", media: MEDIA },
  media: Object.fromEntries(MEDIA.map((m) => [m, mediaDef[m].label])),
  producer2: { founderIndex: p2, distanceToProducer0: genomeDistance(producer0, producer2), rule: "M3 founder (1..11) farthest from founder 0 in genome slots; ties to the lowest index" },
  subjects: subjects.map((s) => ({ id: s.id, group: s.group, cluster: s.cluster, hex: genomeHex(s.genome) })),
  counts: subjects.reduce<Record<string, number>>((m, s) => ({ ...m, [s.group]: (m[s.group] ?? 0) + 1 }), {}),
  batches: batches.map((b) => b.map((s) => s.id)),
};
await Deno.mkdir(a.work, { recursive: true });
const planPath = `${a.work}/plan.json`;
const planOnDisk = await Deno.readTextFile(planPath).catch(() => undefined);
if (planOnDisk !== undefined && a.stage !== "plan" && planOnDisk !== json(plan)) throw new Error(`${planPath} differs from the plan recomputed from ${a.dir}/confirm.json; refusing to run or read against a different subject list`);
const batchesPath = `${a.work}/batches.jsonl`;

async function readLines(): Promise<{ medium: MediumId; batch: number; seed: number; ids: string[]; evals: Evaluation[] }[]> {
  try {
    return (await Deno.readTextFile(batchesPath)).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
}

/** Throws unless each line's seed, subject ids and replicate counts are the ones this plan assigns, and no batch repeats. */
function checkLines(ls: Awaited<ReturnType<typeof readLines>>) {
  const seen = new Set<string>();
  for (const l of ls) {
    const k = `${l.medium}:${l.batch}`;
    if (seen.has(k)) throw new Error(`batches.jsonl repeats ${k}`);
    seen.add(k);
    if (!MEDIA.includes(l.medium)) throw new Error(`batches.jsonl has unknown medium ${l.medium}`);
    if (l.seed !== seedOf(l.medium, l.batch)) throw new Error(`batches.jsonl ${k}: seed ${l.seed}, plan says ${seedOf(l.medium, l.batch)}`);
    if (JSON.stringify(l.ids) !== JSON.stringify(batches[l.batch]?.map((s) => s.id))) throw new Error(`batches.jsonl ${k}: subject ids differ from the plan`);
    if (l.evals.some((e) => e.reps !== reps)) throw new Error(`batches.jsonl ${k}: an evaluation has reps other than ${reps}`);
  }
}

if (a.stage === "plan" || a.stage === "all") {
  await Deno.writeTextFile(planPath, json(plan));
  console.log(`plan: ${subjects.length} subjects in ${batches.length} batches of ${perBatch} (${JSON.stringify(plan.counts)}); producer2 = founder ${p2} (distance ${plan.producer2.distanceToProducer0})`);
}

// ---------- run (GPU)
if (a.stage === "run" || a.stage === "all") {
  const device = await requestDevice(navigator.gpu);
  const existing = await readLines();
  checkLines(existing);
  const done = new Set(existing.map((l) => `${l.medium}:${l.batch}`));
  for (const m of selected) {
    for (let b = 0; b < nBatches; b++) {
      if (done.has(`${m}:${b}`)) continue;
      const t0 = performance.now();
      const evals = await evaluateBatch(device, batches[b].map((s) => s.genome), { ...base, ...mediaDef[m].patch, seed: seedOf(m, b) });
      const line = JSON.stringify({ medium: m, batch: b, seed: seedOf(m, b), ids: batches[b].map((s) => s.id), evals }) + "\n";
      await Deno.writeTextFile(batchesPath, line, { append: true });
      console.log(`${m} batch ${b + 1}/${nBatches}: survived ${evals.map((e) => e.survived).join(",")} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
    }
  }
}

// ---------- read (CPU)
if (a.stage === "read" || a.stage === "all") {
  const lines = await readLines();
  checkLines(lines);
  const cells: Cells = {};
  for (const l of lines)
    l.ids.forEach((id, k) => {
      const e = l.evals[k];
      const c: Cell = {
        survived: e.survived,
        reps: e.reps,
        recovered: e.recovered,
        lightDependent: e.lightDependent,
        regenerated: e.regenerated,
        recovery: e.recovery,
        individuals: e.individuals,
        meanMass: e.meanMass,
        speed: e.speed,
        mass: e.mass,
        reproduction: e.reproduction,
        role: e.role,
        roleSums: e.roleSums,
        roleSumsOther: e.roleSumsOther,
        otherMass: e.otherMass,
      };
      cells[id] = { ...cells[id], [l.medium]: c };
    });
  const complete = subjects.every((s) => MEDIA.every((m) => cells[s.id]?.[m]));
  const confirmByKey = new Map(confirm.rows.map((r: { genome: Enc; eval: Evaluation }) => [key(toG(r.genome)), r.eval]));
  const deadRingConfirmation = Object.fromEntries(subjects.map((s) => {
    const e = confirmByKey.get(key(s.genome)) as Evaluation | undefined;
    return [s.id, e ? { survived: e.survived, regenerated: e.regenerated, lightDependent: e.lightDependent, reps: e.reps } : null];
  }));
  const out = {
    note: "exploratory; subjects, media, measures and readings fixed in docs/plan.md before any result. Roles are read out, never scored.",
    complete,
    plan,
    cells,
    deadRingNote: "The background-medium confirmation (confirm.json) ran beside a ring with founder 0's mu/sigma/motGain and all controller weights zero (JSON round-trip bug fixed later); these counts are that dead-ring condition, not a live producer.",
    deadRingConfirmation,
    reading: complete ? readOut(subjects, cells) : null,
  };
  await Deno.writeTextFile(a.out, json(out));
  console.log(`read: ${lines.length} batches, complete=${complete}, wrote ${a.out}`);
}
