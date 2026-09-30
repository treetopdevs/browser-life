// Readout assays of the ecological-scaffolding sandbox (docs/scaffold-protocol-v1.md, "Readouts (assay seeds)"
// and R1-R4), on native WebGPU. Sources are full checkpoints written by tools/scaffold.ts (gzipped
// encodeCheckpoint). Each assay plants standard fragments (or discs) of a source into fresh ponds, runs one
// period with mutation off, and writes <out>/assay.json and <out>/assay.tsv.
//
//   deno run -A tools/scaffold-assays.ts competence   --source CKPT --k K --period P --seed S --out DIR   (R3)
//     --arm scaf|rand|cont|ancestor [--history I] --timing a|b [--calibration 1|2]
//     [--ref REF] [--quench | --swap-hex HEX | --swap-from CKPT | --swap-founder I [--swap-label ea|ae]]
//     [--side 8] [--replicates 2] [--tag NAME]
//   deno run -A tools/scaffold-assays.ts transmission --source CKPT --k K --period P --seed S --out DIR   (R1)
//     --arm scaf|rand --history I --time 0|1 [--donor-seed D] [--ref REF] [--side 8] [--replicates 2] [--tag NAME]
//   deno run -A tools/scaffold-assays.ts garden       --source CKPT --k K --period P --seed S --out DIR   (R2)
//     --arm scaf|rand --history I --time 0|1 [--inoculum fragment|disc] [--frag-seed F] [--ref REF]
//     [--side 8] [--replicates 2] [--tag NAME]
//   deno run -A tools/scaffold-assays.ts continue     --source CKPT --steps N --seed S --out CKPT         (R3 timing b)
//     [--mut-rate R] [--census 100]
//   deno run -A tools/scaffold-assays.ts capability   --source CKPT[,CKPT...] --seed S --out DIR          (R4)
//     --arm ARM[,ARM...] [--history I[,I...]] [--tag NAME[,NAME...]]
//
// --replicates is at most 8: s = 8 and s = 9 are reserved for R1's permutation stream and donor selection, so
// they never seed a fragment or a physics stream. capability's --arm, --history and --tag are comma lists parallel
// to --source (--history "-" for the ancestor); its rows go under `capability` in assay.json, which
// scaffold-report r4 reads.
//
// --seed is the assay seed of replicate 0 (assaySeed(r, h, t, v, 0)); replicate s uses --seed + s for its
// fragment sampling and physics seed (common random numbers across variants). R2's disc inoculum passes
// its own v = 1 seed as --seed and the v = 0 seed as --frag-seed. transmission draws its donors with
// --donor-seed (default --seed + 9, i.e. assaySeed(1, h, t, 0, 9)), which must equal that value for the labelled
// history and time. Every seed must lie in 4,800,001-4,849,999 unless --allow-any-seed (smoke tests only).
//
// --arm/--history and --time (0 = time 0) or --timing (a = time 0) label the history the source belongs to;
// they are written under `labels` in assay.json, which scaffold-report reads. Unless --allow-any-seed, the
// seeds are decoded (assaySeed's inverse) and must carry the assay's r, the labelled h (6 arm + i, 18 for the
// ancestor) and t, replicate s carrying s. The one exception is swap-ea (Ge-on-Fa): its fragments come from the
// ancestor source, so its seeds carry h = 18 while the labels name the scaf history it tests. A P1 calibration set
// is labelled --arm ancestor --timing a --calibration 1 (ancestor competence) or 2 (with --quench); both use seed
// 4,802,011 (+ s), so the quenched control gets the ancestor's fragments and physics stream.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { M3_FOUNDERS, decodeGenome, encodeGenome, founderGenome, genomeFromHex, totalsOf, type WorldState } from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { DEFAULT_EVAL, evaluateBatch, quality } from "@bl/search";
import {
  ASSAY_COLUMNS,
  assayJson,
  assayLine,
  assaySuccess,
  buildAssayWorld,
  checkAssaySeeds,
  checkDonorSeed,
  fragmentDominant,
  parseAssayLabels,
  quench,
  r1Donors,
  standardFragment,
  swapGenome,
  type AssayItem,
  type AssayLabelSet,
  type AssayName,
  type Fragment,
  type Planted,
} from "./lib/pond-assay.ts";
import { loadCheckpoint, runPeriod, saveCheckpoint } from "./lib/pond-gpu.ts";
import { dominantGenome, ledgerEnergy, pondConfig, pondTraits } from "./lib/ponds.ts";

const a = parseArgs(Deno.args, {
  string: ["source", "k", "period", "ref", "seed", "frag-seed", "donor-seed", "swap-hex", "swap-from", "swap-founder", "swap-label", "tag", "out", "side", "replicates", "inoculum", "steps", "census", "mut-rate", "arm", "history", "time", "timing", "calibration"],
  boolean: ["quench", "allow-any-seed"],
  default: { side: "8", replicates: "2", census: "100", inoculum: "fragment" },
});
const cmd = String(a._[0] ?? "");

function need(name: keyof typeof a): string {
  const v = a[name];
  if (typeof v !== "string" || v === "") throw new Error(`--${name} is required`);
  return v;
}
function int(name: keyof typeof a, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const v = Number(need(name));
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`--${name} must be an integer in ${min}..${max}, got ${a[name]}`);
  return v;
}
/** Seeds live in the sandbox's reserved range (4,800,001-4,849,999); --allow-any-seed is for smoke tests only. */
function checkSeed(name: string, v: number): number {
  if (!a["allow-any-seed"] && !(Number.isInteger(v) && v >= 4_800_001 && v <= 4_849_999)) throw new Error(`${name} ${v} is outside 4,800,001-4,849,999`);
  return v;
}

const protocolSha256 = Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", await Deno.readFile(new URL("../docs/scaffold-protocol-v1.md", import.meta.url)))),
  (b) => b.toString(16).padStart(2, "0"),
).join("");

const baseName = (p: string) => p.replace(/^.*\//, "").replace(/\.blck(\.gz)?$/, "");
const words = (g: Uint32Array) => Array.from(g, (x) => x.toString(16).padStart(8, "0")).join("");

/** The swap arms' genome words (`--swap-hex`, `--swap-from` or `--swap-founder`) with their label, or null. */
async function swapSpec(): Promise<{ words: Uint32Array; label: string; from: string } | null> {
  const given = [a["swap-hex"], a["swap-from"], a["swap-founder"]].filter((v) => v !== undefined);
  if (given.length === 0) return null;
  if (given.length > 1) throw new Error("give one of --swap-hex, --swap-from, --swap-founder");
  if (a.quench) throw new Error("--quench and a swap are separate arms");
  let w: Uint32Array, from: string, label: string;
  if (a["swap-from"] !== undefined) {
    const dom = dominantGenome(await loadCheckpoint(a["swap-from"]));
    if (!dom) throw new Error(`${a["swap-from"]} has no eligible cell, so no dominant genome`);
    w = dom.words;
    from = `${a["swap-from"]} (dominant ${dom.hi}:${dom.lo})`;
    label = "swap-ea";
  } else if (a["swap-hex"] !== undefined) {
    w = encodeGenome(genomeFromHex(a["swap-hex"]), 0, 1);
    from = `hex ${a["swap-hex"]}`;
    label = "swap-ae";
  } else {
    const i = Number(a["swap-founder"]);
    if (!Number.isInteger(i) || i < 0 || i >= M3_FOUNDERS.length) throw new Error(`--swap-founder must be 0-${M3_FOUNDERS.length - 1}`);
    w = encodeGenome(founderGenome(M3_FOUNDERS[i]), 0, 1);
    from = `M3_FOUNDERS[${i}]`;
    label = "swap-ae";
  }
  if (a["swap-label"] !== undefined) {
    if (a["swap-label"] !== "ea" && a["swap-label"] !== "ae") throw new Error("--swap-label must be ea or ae");
    label = `swap-${a["swap-label"]}`;
  }
  return { words: w, label, from };
}

interface Plan {
  /** Fragment of pond f, or null for an absent one. */
  item: AssayItem;
  family: number;
}

interface AssaySpec {
  name: string;
  sourcePath: string;
  source: WorldState;
  tag: string;
  k: number;
  period: number;
  ref: number | undefined;
  side: number;
  replicates: number;
  seed: number;
  fragSeed: number;
  inoculum: string;
  /** The history this source belongs to, written to assay.json for scaffold-report. */
  labels: AssayLabelSet;
  /** Fragment f of replicate sigma `sigma`; the family label is the donor pond in R1, else -1. */
  plan: (sigma: number, f: number) => Plan;
}

/** One period of an assay world on the GPU with matter and the energy ledger checked at every census. */
async function runWorld(device: GPUDevice, state: WorldState, period: number, censusEvery: number): Promise<WorldState> {
  const sim = await GpuSim.create(device, state);
  try {
    const check = { startMatter: totalsOf(state.cfg, state.cells).matter, baseline: ledgerEnergy(state) };
    const r = await runPeriod(sim, device, period, censusEvery, check);
    if (!r.conservationOk) throw new Error(`matter or the energy ledger broke in the assay world (seed ${state.cfg.seed})`);
    return await sim.readState();
  } finally {
    sim.destroy();
  }
}

/** Runs every replicate of `spec` (one period, mutation off) and writes assay.json and assay.tsv into `out`. */
async function runAssay(spec: AssaySpec, out: string, extra: Record<string, unknown>, rowFilter?: () => boolean) {
  const t0 = performance.now();
  const ponds = spec.side * spec.side;
  const seeds = Array.from({ length: spec.replicates }, (_, s) => ({ physics: checkSeed("seed", spec.seed + s), fragment: checkSeed("fragment seed", spec.fragSeed + s) }));
  if (!a["allow-any-seed"]) seeds.forEach((sd, s) => checkAssaySeeds(spec.name as AssayName, spec.labels, spec.inoculum, sd, s));
  const device = await requestDevice(navigator.gpu, pondConfig(spec.side, seeds[0].physics, 0));
  const lines: string[] = [ASSAY_COLUMNS.join("\t")];
  const sum = { rows: 0, success: 0, end: 0, ret: 0, retE: 0, absent: 0, truncated: 0 };
  if (rowFilter === undefined || rowFilter()) {
    for (let s = 0; s < spec.replicates; s++) {
      const plans = Array.from({ length: ponds }, (_, f) => spec.plan(seeds[s].fragment, f));
      const cfg = pondConfig(spec.side, seeds[s].physics, 0);
      const { state, planted } = buildAssayWorld(cfg, plans.map((p) => p.item));
      // A world with nothing planted has nothing to grow: every fragment is absent and fails.
      const traits = plans.every((p) => p.item === null) ? new Array<number>(ponds).fill(0) : pondTraits(await runWorld(device, state, spec.period, Number(a.census)));
      plans.forEach((p, f) => {
        const pl: Planted = planted[f];
        const success = p.item === null ? (spec.ref === undefined ? -1 : 0) : assaySuccess(traits[f], pl.retMass, spec.ref);
        lines.push(assayLine({ assay: spec.name, source: spec.tag, replicate: s, pond: f, family: p.family, inoculum: spec.inoculum, planted: pl, endTrait: traits[f], success }));
        sum.rows++;
        sum.success += Math.max(success, 0);
        sum.end += traits[f];
        sum.ret += pl.retMass;
        sum.retE += pl.retE;
        if (p.item === null) sum.absent++;
        if (pl.truncated) sum.truncated++;
      });
    }
  }
  await Deno.mkdir(out, { recursive: true });
  await Deno.writeTextFile(`${out}/assay.tsv`, lines.join("\n") + "\n");
  await Deno.writeTextFile(
    `${out}/assay.json`,
    JSON.stringify(
      assayJson({
        protocolSha256,
        assay: spec.name,
        source: spec.sourcePath,
        tag: spec.tag,
        k: spec.k,
        period: spec.period,
        ref: spec.ref ?? null,
        side: spec.side,
        replicates: spec.replicates,
        censusEvery: Number(a.census),
        inoculum: spec.inoculum,
        seeds,
        labels: spec.labels,
        extra,
        summary: {
          rows: sum.rows,
          competence: spec.ref === undefined || sum.rows === 0 ? null : sum.success / sum.rows,
          meanEndTrait: sum.rows ? sum.end / sum.rows : null,
          meanRetMass: sum.rows ? sum.ret / sum.rows : null,
          meanRetE: sum.rows ? sum.retE / sum.rows : null,
          absent: sum.absent,
          truncated: sum.truncated,
        },
        wallSeconds: (performance.now() - t0) / 1000,
      }),
      null,
      2,
    ) + "\n",
  );
  console.log(`${spec.name} ${spec.tag}: ${sum.rows} rows${spec.ref === undefined ? "" : sum.rows === 0 ? ", no rows (insufficient or empty source)" : `, competence ${(sum.success / sum.rows).toFixed(3)}`} -> ${out}`);
}

async function specFromArgs(name: AssayName): Promise<AssaySpec> {
  const sourcePath = need("source");
  const seed = int("seed", 0);
  return {
    labels: parseAssayLabels(name, { arm: a.arm, history: a.history, time: a.time, timing: a.timing, calibration: a.calibration }),
    name,
    sourcePath,
    source: await loadCheckpoint(sourcePath),
    tag: a.tag ?? baseName(sourcePath),
    k: int("k", 1, 64),
    period: int("period", 1),
    ref: a.ref === undefined ? undefined : Number(a.ref),
    side: int("side", 1, 16),
    replicates: int("replicates", 1, 8),
    seed,
    fragSeed: a["frag-seed"] === undefined ? seed : int("frag-seed", 0),
    inoculum: "fragment",
    plan: () => ({ item: null, family: -1 }),
  };
}

const fragmentItem = (f: Fragment | null): AssayItem => (f === null ? null : { kind: "fragment", fragment: f });

switch (cmd) {
  case "competence": {
    const spec = await specFromArgs("competence");
    const swap = await swapSpec();
    if (swap) spec.inoculum = swap.label;
    else if (a.quench) spec.inoculum = "quenched";
    const cal = spec.labels.calibration;
    if (cal === 1 && (swap || a.quench)) throw new Error("--calibration 1 is the plain ancestor competence");
    if (cal === 2 && !a.quench) throw new Error("--calibration 2 is the quenched control (--quench)");
    if (cal === undefined && (swap || a.quench) && spec.labels.arm !== "scaf") throw new Error("swap and quenched arms label a scaf history (--arm scaf)");
    spec.plan = (sigma, f) => {
      const fr = standardFragment(spec.source, spec.k, sigma, f);
      const item = fr === null ? null : a.quench ? quench(fr) : swap ? swapGenome(fr, swap.words) : fr;
      return { item: fragmentItem(item), family: -1 };
    };
    await runAssay(spec, need("out"), { quench: !!a.quench, swap: swap && { label: swap.label, from: swap.from, words: words(swap.words) } });
    break;
  }
  case "transmission": {
    const spec = await specFromArgs("transmission");
    const donorSeed = checkSeed("donor seed", a["donor-seed"] === undefined ? spec.seed + 9 : int("donor-seed", 0));
    if (!a["allow-any-seed"]) checkDonorSeed(spec.labels, donorSeed);
    const { donors, eligible, insufficient } = r1Donors(spec.source, donorSeed);
    spec.plan = (sigma, f) => {
      const donor = donors[f % donors.length];
      return { item: fragmentItem(standardFragment(spec.source, spec.k, sigma, f, donor)), family: donor };
    };
    // Fewer than two eligible ponds: R1 is not demonstrated for the history, and no row is written.
    await runAssay(spec, need("out"), { donorSeed, donors, eligible, insufficient }, () => !insufficient);
    break;
  }
  case "garden": {
    const spec = await specFromArgs("garden");
    if (a.inoculum !== "fragment" && a.inoculum !== "disc") throw new Error("--inoculum must be fragment or disc");
    spec.inoculum = a.inoculum;
    spec.plan = (sigma, f) => {
      const fr = standardFragment(spec.source, spec.k, sigma, f);
      if (a.inoculum === "fragment" || fr === null) return { item: fragmentItem(fr), family: -1 };
      // Standardised inoculum: the fragment's dominant genome (by B+P) as the standard disc.
      const dom = fragmentDominant(fr);
      return { item: dom === null ? null : { kind: "disc", genome: decodeGenome(dom.words) }, family: -1 };
    };
    await runAssay(spec, need("out"), {});
    break;
  }
  case "continue": {
    const src = await loadCheckpoint(need("source"));
    const steps = int("steps", 1);
    const seed = checkSeed("seed", int("seed", 0));
    const mutRate = a["mut-rate"] === undefined ? src.cfg.mutRate : int("mut-rate", 0);
    if (mutRate === 0) throw new Error("continue runs with mutation on: the source has mutRate 0 (pass --mut-rate)");
    const state: WorldState = { ...src, cfg: { ...src.cfg, seed, mutRate } };
    const device = await requestDevice(navigator.gpu, state.cfg);
    const sim = await GpuSim.create(device, state);
    const t0 = performance.now();
    try {
      const check = { startMatter: totalsOf(state.cfg, state.cells).matter, baseline: ledgerEnergy(state) };
      const r = await runPeriod(sim, device, steps, int("census", 1), check);
      if (!r.conservationOk) throw new Error("matter or the energy ledger broke during the continuation");
      const end = await sim.readState();
      await saveCheckpoint(need("out"), end);
      console.log(`continue ${a.source}: ${steps} steps from step ${src.step} to ${end.step}, ${r.events} mutation events, seed ${seed}, conservation OK, ${((performance.now() - t0) / 1000).toFixed(1)}s -> ${a.out}`);
    } finally {
      sim.destroy();
    }
    break;
  }
  case "capability": {
    const sources = need("source").split(",");
    const tags = a.tag === undefined ? sources.map(baseName) : a.tag.split(",");
    if (tags.length !== sources.length) throw new Error("--tag needs one name per source");
    const arms = need("arm").split(",");
    if (arms.length !== sources.length) throw new Error("--arm needs one arm per source");
    const histories = a.history === undefined ? arms.map(() => "-") : a.history.split(",");
    if (histories.length !== sources.length) throw new Error("--history needs one entry per source (\"-\" for the ancestor)");
    const labels = arms.map((arm, i) => {
      if (arm !== "scaf" && arm !== "rand" && arm !== "cont" && arm !== "ancestor") throw new Error(`--arm must be scaf|rand|cont|ancestor, got ${arm}`);
      if (arm === "ancestor") {
        if (histories[i] !== "-") throw new Error("--history does not apply to the ancestor (use \"-\")");
        return { arm };
      }
      const h = Number(histories[i]);
      if (!Number.isInteger(h) || h < 0 || h > 5) throw new Error(`--history must be 0-5 for arm ${arm}, got ${histories[i]}`);
      return { arm, history: h };
    });
    const seed = checkSeed("seed", int("seed", 0));
    const t0 = performance.now();
    const doms: ReturnType<typeof dominantGenome>[] = [];
    for (const s of sources) doms.push(dominantGenome(await loadCheckpoint(s)));
    const rows: { arm: string; history?: number; tag: string; source: string; hi: number; lo: number; evaluation: Awaited<ReturnType<typeof evaluateBatch>>[number] | null }[] = sources.map((source, i) => ({
      ...labels[i],
      tag: tags[i],
      source,
      hi: doms[i]?.hi ?? 0,
      lo: doms[i]?.lo ?? 0,
      evaluation: null,
    }));
    const have = rows.filter((_, i) => doms[i] !== null);
    if (have.length > 0) {
      const device = await requestDevice(navigator.gpu);
      const perBatch = Math.floor((DEFAULT_EVAL.side * DEFAULT_EVAL.side) / DEFAULT_EVAL.reps);
      for (let b = 0; b < have.length; b += perBatch) {
        const chunk = have.slice(b, b + perBatch);
        const genomes = chunk.map((r) => decodeGenome(doms[rows.indexOf(r)]!.words));
        const evals = await evaluateBatch(device, genomes, { ...DEFAULT_EVAL, seed });
        chunk.forEach((r, i) => (r.evaluation = evals[i]));
      }
    }
    const out = need("out");
    await Deno.mkdir(out, { recursive: true });
    const cols = ["assay", "source", "arm", "history", "hi", "lo", "survived", "recovered", "lightDependent", "reps", "individuals", "meanMass", "mass", "recovery", "regenerated", "quality"];
    const lines = [cols.join("\t")];
    for (const r of rows) {
      const e = r.evaluation;
      lines.push(["capability", r.tag, r.arm, r.history ?? "-", r.hi, r.lo, ...(e ? [e.survived, e.recovered, e.lightDependent, e.reps, e.individuals, e.meanMass, e.mass, e.recovery, e.regenerated, quality(e)] : cols.slice(6).map(() => "NA"))].join("\t"));
    }
    // One row per source for scaffold-report r4: arm and history label it, the measures sit beside them (numeric
    // ones are summarised per arm; the dominant genome's id is a string so it is not).
    const capability = rows.map(({ evaluation: e, hi, lo, ...r }) => ({ ...r, dominant: `${hi}:${lo}`, evaluated: e !== null, ...(e ? { ...e, quality: quality(e) } : {}) }));
    // assay.tsv keeps the shared header; capability rows are per genome, not per fragment, so they live in capability.tsv.
    await Deno.writeTextFile(`${out}/assay.tsv`, ASSAY_COLUMNS.join("\t") + "\n");
    await Deno.writeTextFile(`${out}/capability.tsv`, lines.join("\n") + "\n");
    await Deno.writeTextFile(
      `${out}/assay.json`,
      JSON.stringify({ tool: "scaffold-assays", protocolSha256, assay: "capability", seed, eval: { ...DEFAULT_EVAL, seed }, capability, wallSeconds: (performance.now() - t0) / 1000 }, null, 2) + "\n",
    );
    console.log(`capability: ${have.length}/${rows.length} genomes evaluated -> ${out}`);
    break;
  }
  default:
    throw new Error(`usage: scaffold-assays.ts competence|transmission|garden|continue|capability (see the file header), got "${cmd}"`);
}
