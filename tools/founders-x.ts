// Ecology-first founder discovery (docs/plan.md, "Ecology-first founder discovery"): drifted-cloud
// founders (B) and empty-niche founder sets (C). CPU only; no GPU.
//
//   deno run -A tools/founders-x.ts cloud --run <dir> --step 100000
//       Top-13 lineages at a deep census (ties by lineage key), hex from genomes.tsv, as a
//       --founder-set string.
//   deno run -A tools/founders-x.ts plan
//       Run lists for B (clouds × 8 seeds from 4,720,001) and C (sets S1/S2/S4/S5 × 8 from 4,740,001).
//   deno run -A tools/founders-x.ts read [--dir runs/founders-x]
//       Test-3 origination rules on completed B/C runs; garden plans from 4,760,001.
//       Superseded by read-root (plan 002).
//   deno run -A tools/founders-x.ts read-root --garden-seed N --garden-seed-gradient M [--dir runs]
//       The same candidates, each gardened beside its own clade root (mutations.tsv walk, genome
//       from genomes.tsv) instead of founderSet[0]. Needs all 128 B/C runs finished at 1e6 steps, each
//       profiles.tsv holding every deep census (steps 100..999,100 unless extinct), and every root a founder lineage.
//       Writes fxr-candidates.json, fxr-plan-uniform.json, fxr-plan-gradient.json (plan ids are
//       stamped into the garden outputs by tools/assay.ts) and refuses to overwrite different content.
//   deno run -A tools/founders-x.ts summary-root [--uniform-dir D] [--gradient-dir D]
//       Counts per cloud/set from the finished gardens -> experiments/foundations/fx-root.json.
//
// Plans and readouts go under --out (default runs/foundations/results), matching tools/foundations.ts.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { M3_FOUNDERS, founderGenome, genomeHex } from "@bl/schema";
import { GRADIENT_GARDEN, gardenOutcome, lines, originationCandidates, tsv } from "./foundations.ts";
import { parentMap, rootWalker } from "./lib/clade.ts";
import { RUNS_PER_SUBJECT, SUBJECT_IDS, checkedRootHex, countSubjects, subjectIndex, wholePlanting } from "./lib/fx-root.ts";
import { LAST_DEEP_STEP, groupOf, profileCoverageProblems } from "./lib/recurrence.ts";

const a = parseArgs(Deno.args, {
  string: ["out", "run", "step", "dir", "garden-seed", "garden-seed-gradient", "uniform-dir", "gradient-dir"],
  default: { out: "runs/foundations/results", step: "100000", "uniform-dir": "runs/found-fxr-uniform", "gradient-dir": "runs/found-fxr-gradient" },
});
const cmd = String(a._[0] ?? "");
const OUT = a.out;
const CLOUD_STEP = Number(a.step);
const B_SEED0 = 4_720_001;
const C_SEED0 = 4_740_001;
const GARDEN_SEED0 = 4_760_001;
/** S1: non-producer diagnostic subjects (distinct-cluster chemotroph/mixed). */
const S1_SUBJECTS = [0, 3, 1, 6] as const;
/** S2: phototroph M3 founders (drop mixed indices 2, 8, 10). */
const S2_FOUNDER_IDX = [0, 1, 3, 4, 5, 6, 7, 9, 11] as const;
/** C set indices (seed = C_SEED0 + 10 * setIndex + j). S3 is M4 reuse, not planned here. */
const C_SET_INDEX = { S1: 0, S2: 1, S4: 2, S5: 3 } as const;
/** Full B subject pick: 6 counting + 6 non-counting from the diagnostic's primary reading. */
const B_COUNTING = [0, 1, 3, 4, 5, 6] as const;
const B_NON_COUNTING = [2, 8, 9, 10, 11, 12] as const;

/** Interleave two lists so both appear early among the 13 discs (a0,b0,a1,b1,…). */
export function interleaveGenomes(a: string[], b: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

const exists = async (p: string) => {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
};

const save = async (name: string, v: unknown) => {
  await Deno.mkdir(OUT, { recursive: true });
  await Deno.writeTextFile(`${OUT}/${name}`, JSON.stringify(v, null, 1));
  console.log(`wrote ${OUT}/${name}`);
};

/** The 13 most abundant lineages at `step` (cells desc, lineage key asc on ties); hex from genomes.tsv.
 * If `step` is not a deep-census row (cadence is usually 100 + 1000k), snaps to the nearest available
 * step (ties prefer the lower), so `--step 100000` works on the usual lineageObs schedule. */
export async function cloudFromRun(dir: string, step: number): Promise<{ step: number; lineages: { key: string; cells: number; hex: string }[]; founderSet: string }> {
  const byStep = new Map<number, { key: string; cells: number }[]>();
  for await (const r of tsv(`${dir}/profiles.tsv`)) {
    const s = Number(r.step);
    const list = byStep.get(s) ?? [];
    list.push({ key: r.lineage, cells: Number(r.cells) });
    byStep.set(s, list);
  }
  if (!byStep.size) throw new Error(`${dir}: profiles.tsv is empty`);
  let atStep = step;
  if (!byStep.has(step)) {
    const steps = [...byStep.keys()];
    steps.sort((a, b) => Math.abs(a - step) - Math.abs(b - step) || a - b);
    atStep = steps[0];
  }
  const at = byStep.get(atStep)!;
  at.sort((x, y) => y.cells - x.cells || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const top = at.slice(0, 13);
  const hexBy = new Map<string, string>();
  for await (const r of tsv(`${dir}/genomes.tsv`)) hexBy.set(r.lineage, r.words);
  const lineages = top.map((l) => {
    const hex = hexBy.get(l.key);
    if (!hex) throw new Error(`${dir}: lineage ${l.key} has no genome in genomes.tsv`);
    return { key: l.key, cells: l.cells, hex };
  });
  return { step: atStep, lineages, founderSet: lineages.map((l) => l.hex).join(",") };
}

async function cloudCmd() {
  if (!a.run) throw new Error("cloud needs --run <dir>");
  const { step, lineages, founderSet } = await cloudFromRun(a.run, CLOUD_STEP);
  console.log(`# ${a.run} step ${step}${step !== CLOUD_STEP ? ` (nearest to ${CLOUD_STEP})` : ""}: ${lineages.length} lineages`);
  for (const l of lineages) console.log(`# ${l.key}\t${l.cells}\t${l.hex.slice(0, 16)}…`);
  console.log(`--founder-set ${founderSet}`);
}

type CloudSrc = { id: string; kind: "founder" | "subject"; index: number; sourceDir: string; sourceSeed: number };

/** Source runs whose deep census supplies a cloud: 12 founder solo + 12 diagnostic subjects. */
function cloudSources(): CloudSrc[] {
  const founders: CloudSrc[] = M3_FOUNDERS.map((_, k) => ({
    id: `founder-${k}`,
    kind: "founder" as const,
    index: k,
    sourceDir: `runs/solo/gradient-m3/treatment/seed-${4_200_001 + 10 * k}`,
    sourceSeed: 4_200_001 + 10 * k,
  }));
  const subjects: CloudSrc[] = [...B_COUNTING, ...B_NON_COUNTING].map((c) => ({
    id: `subject-${c}`,
    kind: "subject" as const,
    index: c,
    sourceDir: `runs/founders-diag/gradient-m3/treatment/seed-${4_210_001 + 10 * c}`,
    sourceSeed: 4_210_001 + 10 * c,
  }));
  return [...founders, ...subjects];
}

function runLine(experiment: string, condition: string, seed: number, founderSet: string, preset = "gradient-m3"): string {
  return `${experiment} ${condition} ${seed} ${preset} 1000000 0 --lineage-obs --founder-set ${founderSet}`;
}

async function planB() {
  const sources = cloudSources();
  const clouds: { id: string; kind: string; index: number; sourceDir: string; sourceSeed: number; founderSet: string; lineages: { key: string; cells: number }[]; censusStep?: number; missing?: boolean }[] = [];
  for (const s of sources) {
    if (!(await exists(`${s.sourceDir}/profiles.tsv`))) {
      clouds.push({ id: s.id, kind: s.kind, index: s.index, sourceDir: s.sourceDir, sourceSeed: s.sourceSeed, founderSet: "", lineages: [], missing: true });
      continue;
    }
    const { step, lineages, founderSet } = await cloudFromRun(s.sourceDir, CLOUD_STEP);
    clouds.push({
      id: s.id,
      kind: s.kind,
      index: s.index,
      sourceDir: s.sourceDir,
      sourceSeed: s.sourceSeed,
      censusStep: step,
      founderSet,
      lineages: lineages.map(({ key, cells }) => ({ key, cells })),
    });
  }
  const present = clouds.filter((c) => !c.missing);
  const foundersOnly = present.filter((c) => c.kind === "founder");
  const full = present;
  const linesFor = (list: typeof present, seed0: number) =>
    list.flatMap((c, i) =>
      [0, 1, 2, 3, 4, 5, 6, 7].map((j) => ({
        cloud: c.id,
        seed: seed0 + 10 * i + j,
        condition: j < 5 ? "treatment" : "no-mutation",
        founderSet: c.founderSet,
      })),
    );
  const foundersRuns = linesFor(foundersOnly, B_SEED0);
  const fullRuns = linesFor(full, B_SEED0);
  await save("fx-b-plan.json", {
    seed0: B_SEED0,
    step: CLOUD_STEP,
    note: "B drifted-cloud founders; 5 mutation + 3 no-mutation per cloud. Trimmed = 12 founder clouds; full adds 6 counting + 6 non-counting subjects.",
    countingSubjects: [...B_COUNTING],
    nonCountingSubjects: [...B_NON_COUNTING],
    clouds,
    foundersClouds: foundersOnly.length,
    fullClouds: full.length,
  });
  await Deno.writeTextFile(
    `${OUT}/fx-b-founders-runs.txt`,
    foundersRuns.map((r) => runLine("founders-x-b", r.condition, r.seed, r.founderSet)).join("\n") + (foundersRuns.length ? "\n" : ""),
  );
  await Deno.writeTextFile(
    `${OUT}/fx-b-full-runs.txt`,
    fullRuns.map((r) => runLine("founders-x-b", r.condition, r.seed, r.founderSet)).join("\n") + (fullRuns.length ? "\n" : ""),
  );
  console.log(`B: ${foundersOnly.length} founder clouds (${foundersRuns.length} runs), ${full.length} full clouds (${fullRuns.length} runs); ${clouds.filter((c) => c.missing).length} sources missing`);
}

async function planC() {
  const subjectsPath = `${OUT}/fd-subjects.json`;
  if (!(await exists(subjectsPath))) throw new Error(`C needs ${subjectsPath}`);
  const { subjects } = JSON.parse(await Deno.readTextFile(subjectsPath));
  const byId = new Map<number, { subject: number; hex: string; role: string }>(subjects.map((s: any) => [s.subject, s]));
  const s1 = S1_SUBJECTS.map((c) => {
    const s = byId.get(c);
    if (!s) throw new Error(`S1 subject ${c} missing from fd-subjects.json`);
    return { subject: c, hex: s.hex, role: s.role };
  });
  const s2 = S2_FOUNDER_IDX.map((k) => ({ founder: k, hex: genomeHex(founderGenome(M3_FOUNDERS[k])) }));
  const s1Hex = s1.map((s) => s.hex);
  const s2Hex = s2.map((s) => s.hex);
  // S5 = S1 + S2 interleaved (non-producer, producer, …) so both appear among the 13 discs.
  const s5Genomes = interleaveGenomes(s1Hex, s2Hex);
  const s5Ordering: { disc: number; source: "S1" | "S2"; index: number; hex: string }[] = [];
  {
    let disc = 0;
    for (let k = 0; k < Math.max(s1Hex.length, s2Hex.length); k++) {
      if (k < s1Hex.length) {
        s5Ordering.push({ disc, source: "S1", index: S1_SUBJECTS[k], hex: s1Hex[k] });
        disc++;
      }
      if (k < s2Hex.length) {
        s5Ordering.push({ disc, source: "S2", index: S2_FOUNDER_IDX[k], hex: s2Hex[k] });
        disc++;
      }
    }
  }
  // S4 = S2 genomes on gradient-m3-waste. Fixed setIndex (not array order) so S1/S2/S4 seeds stay put when S5 is added.
  const sets: { id: keyof typeof C_SET_INDEX; label: string; genomes: string[]; preset: string; setIndex: number }[] = [
    { id: "S1", label: "non-producers (subjects 0,3,1,6)", genomes: s1Hex, preset: "gradient-m3", setIndex: C_SET_INDEX.S1 },
    { id: "S2", label: "phototroph founders (drop mixed 2,8,10)", genomes: s2Hex, preset: "gradient-m3", setIndex: C_SET_INDEX.S2 },
    {
      id: "S4",
      label: "producers + waste (S2 on gradient-m3-waste)",
      genomes: s2Hex,
      preset: "gradient-m3-waste",
      setIndex: C_SET_INDEX.S4,
    },
    {
      id: "S5",
      label: "S1 + producers interleaved (S1 genomes with S2 phototrophs)",
      genomes: s5Genomes,
      preset: "gradient-m3",
      setIndex: C_SET_INDEX.S5,
    },
  ];
  const runs = sets.flatMap((s) =>
    [0, 1, 2, 3, 4, 5, 6, 7].map((j) => ({
      set: s.id,
      seed: C_SEED0 + 10 * s.setIndex + j,
      condition: j < 5 ? "treatment" : "no-mutation",
      founderSet: s.genomes.join(","),
      preset: s.preset,
    })),
  );
  await save("fx-c-plan.json", {
    seed0: C_SEED0,
    note: "C empty-niche founder sets; S3 is the full 12 founders (reuse M4, do not re-run). S4 = S2 genomes on gradient-m3-waste. S5 = S1+S2 interleaved (setIndex 3).",
    s1Subjects: s1,
    s2Founders: s2,
    s5Ordering,
    sets,
  });
  await Deno.writeTextFile(
    `${OUT}/fx-c-runs.txt`,
    runs.map((r) => runLine("founders-x-c", r.condition, r.seed, r.founderSet, r.preset)).join("\n") + (runs.length ? "\n" : ""),
  );
  console.log(`C: ${sets.map((s) => s.id).join(", ")} → ${runs.length} runs`);
}

async function planCmd() {
  await Deno.mkdir(OUT, { recursive: true });
  await planB();
  await planC();
}

/** Completed B/C bundles under `--dir`, keyed like soloRuns for originationCandidates. */
async function fxRuns(base: string) {
  type Row = { dir: string; subject: number; seed: number; mutation: boolean; extinct: boolean; experiment: string; founderSet?: string[]; setKey: string };
  const rows: Row[] = [];
  for (const experiment of ["founders-x-b", "founders-x-c"]) {
    for (const preset of ["gradient-m3", "gradient-m3-waste"]) {
      for (const cond of ["treatment", "no-mutation"]) {
        const root = `${base}/${experiment}/${preset}/${cond}`;
        if (!(await exists(root))) continue;
        for await (const e of Deno.readDir(root)) {
          if (!e.isDirectory) continue;
          const dir = `${root}/${e.name}`;
          const m = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
          if (!m.summary) continue;
          const founderSet = m.spec.founderSet as string[] | undefined;
          rows.push({
            dir,
            subject: 0,
            seed: m.spec.seed,
            mutation: cond === "treatment",
            extinct: m.summary.extinct,
            experiment,
            founderSet,
            setKey: `${experiment}\0${preset}\0${founderSet?.join(",") ?? ""}`,
          });
        }
      }
    }
  }
  const keys = [...new Set(rows.map((r) => r.setKey))].sort();
  const subj = new Map(keys.map((k, i) => [k, i]));
  return rows
    .map(({ setKey, ...r }) => ({ ...r, subject: subj.get(setKey)! }))
    .sort((x, y) => x.subject - y.subject || x.seed - y.seed);
}

// Superseded by read-root (plan 002): read compares every candidate with founderSet[0], and its fx-plan-*.json no longer match runs/found-fx-* outputs.
async function readCmd() {
  await Deno.mkdir(OUT, { recursive: true });
  const runs = await fxRuns(a.dir ?? "runs/founders-x");
  if (!runs.length) {
    await save("fx-read.json", { complete: false, runs: 0, note: "no completed founders-x bundles under --dir" });
    console.log("read: no completed runs");
    return;
  }
  const { qual, candidates } = await originationCandidates(runs);
  for (const q of qual) if (q.mutation) q.extinct = runs.find((r) => r.subject === q.subject && r.seed === q.seed)?.extinct;
  // Garden plantings: each candidate beside its founding set's first hex (standing variation's "founder").
  const setHex = new Map<number, string>();
  for (const r of runs) {
    if (!setHex.has(r.subject) && r.founderSet?.length) setHex.set(r.subject, r.founderSet[0]);
  }
  const plantings = [
    ...candidates.map((c: any, i: number) => ({ id: `c${i}`, hex: [c.hex, setHex.get(c.subject)] })),
    ...[...setHex.entries()].map(([subject, hex]) => ({ id: `m${subject}`, hex: [hex] })),
  ];
  await save("fx-candidates.json", { qualifying: qual, candidates, runs: runs.length });
  await save("fx-plan-uniform.json", { seed0: GARDEN_SEED0, reps: 16, growSteps: 20_000, plantings });
  await save("fx-plan-gradient.json", { seed0: GARDEN_SEED0 + 10_000, reps: 16, growSteps: 20_000, plantings, gradient: GRADIENT_GARDEN });
  console.log(`read: ${runs.length} runs, ${candidates.length} candidate roles, ${plantings.length} garden plantings`);
}

// ---------------------------------------------------------------------------------------------
// Plan 002: each candidate gardened beside its own clade root.

/** Plantings per garden unit: assay.ts garden fits floor(64 tiles / 16 replicates) plantings in one batch. */
const GARDEN_PER_UNIT = 4;
const FX_ROOT_SUMMARY = "experiments/foundations/fx-root.json";

type RootRun = { dir: string; subjectId: string; subject: number; seed: number; mutation: boolean; extinct: boolean; steps: number | undefined; founderSet: string[] | undefined };

/** Every B/C bundle under `base`, with a fixed subject id from the seed layout (not from sorted keys). */
async function rootRuns(base: string): Promise<RootRun[]> {
  const runs: RootRun[] = [];
  const layouts = [["founders-x-b", "gradient-m3"], ["founders-x-c", "gradient-m3"], ["founders-x-c", "gradient-m3-waste"]];
  for (const [experiment, preset] of layouts) {
    for (const cond of ["treatment", "no-mutation"]) {
      const root = `${base}/${experiment}/${preset}/${cond}`;
      if (!(await exists(root))) continue;
      for await (const e of Deno.readDir(root)) {
        if (!e.isDirectory) continue;
        const dir = `${root}/${e.name}`;
        const m = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
        if (m.spec.experiment !== experiment) throw new Error(`${dir}: manifest experiment ${m.spec.experiment} does not match its directory ${experiment}`);
        const g = groupOf({ experiment: m.spec.experiment, seed: m.spec.seed });
        if (!g) throw new Error(`${dir}: seed ${m.spec.seed} is outside the ${experiment} seed layout`);
        if (g.mutation !== (cond === "treatment")) throw new Error(`${dir}: the seed layout says mutation=${g.mutation} but the run sits under ${cond}`);
        runs.push({ dir, subjectId: g.group, subject: subjectIndex(g.group), seed: m.spec.seed, mutation: g.mutation, extinct: !!m.summary?.extinct, steps: m.summary?.steps, founderSet: m.spec.founderSet });
      }
    }
  }
  return runs.sort((x, y) => x.subject - y.subject || x.seed - y.seed);
}

/** What is missing from the 16 subjects x (5 mutation + 3 no-mutation) runs, each finished at 1e6 steps. */
function rootRunProblems(runs: RootRun[]): string[] {
  const out: string[] = [];
  const seen = new Set<number>();
  for (const r of runs) {
    if (seen.has(r.seed)) out.push(`seed ${r.seed} appears twice`);
    seen.add(r.seed);
  }
  for (const id of SUBJECT_IDS) {
    const mine = runs.filter((r) => r.subjectId === id);
    const nm = mine.filter((r) => r.mutation).length;
    if (nm !== RUNS_PER_SUBJECT.mutation) out.push(`${id}: ${nm} mutation runs (want ${RUNS_PER_SUBJECT.mutation})`);
    if (mine.length - nm !== RUNS_PER_SUBJECT.noMutation) out.push(`${id}: ${mine.length - nm} no-mutation runs (want ${RUNS_PER_SUBJECT.noMutation})`);
    for (const r of mine) if (r.steps !== 1_000_000) out.push(`${id} seed ${r.seed}: ${r.steps === undefined ? "no summary" : `${r.steps} steps`} (want 1000000)`);
  }
  return out;
}

/**
 * Deep-census coverage of every run's profiles.tsv (every 1,000 steps from 100 to 999,100 unless extinct): originationCandidates
 * reads roles from it, so a truncated or header-only file would hide a control's role or drop a candidate.
 */
async function rootCoverageProblems(runs: RootRun[]): Promise<string[]> {
  const out: string[] = [];
  for (const r of runs) out.push(...(await profileCoverageProblems(`${r.subjectId} seed ${r.seed}`, tsv(`${r.dir}/profiles.tsv`) as AsyncIterable<any>, LAST_DEEP_STEP, r.extinct)));
  return out;
}

/** Writes each file only when it is absent or already byte-identical; otherwise says so and writes nothing. */
async function saveNew(files: [string, unknown][]): Promise<boolean> {
  await Deno.mkdir(OUT, { recursive: true });
  const texts = files.map(([name, v]) => [name, JSON.stringify(v, null, 1)] as const);
  for (const [name, text] of texts) {
    const p = `${OUT}/${name}`;
    if ((await exists(p)) && (await Deno.readTextFile(p)) !== text) {
      console.log(`read-root: ${p} already exists with different content; not overwriting anything. Move it aside or use another --out.`);
      Deno.exitCode = 1;
      return false;
    }
  }
  for (const [name, text] of texts) {
    await Deno.writeTextFile(`${OUT}/${name}`, text);
    console.log(`wrote ${OUT}/${name}`);
  }
  return true;
}

/** First 16 hex characters of the SHA-256 of the plan's JSON (without its own id). */
async function planIdOf(plan: unknown): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(plan)));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function readRootCmd() {
  const seedU = a["garden-seed"], seedG = a["garden-seed-gradient"];
  if (!/^\d+$/.test(seedU ?? "") || !/^\d+$/.test(seedG ?? "")) throw new Error("read-root needs integer --garden-seed and --garden-seed-gradient");
  const seed0U = Number(seedU), seed0G = Number(seedG);
  const runs = await rootRuns(a.dir ?? "runs");
  const problems = rootRunProblems(runs);
  if (runs.length !== SUBJECT_IDS.length * (RUNS_PER_SUBJECT.mutation + RUNS_PER_SUBJECT.noMutation)) problems.unshift(`${runs.length} runs found (want 128)`);
  if (!problems.length) problems.push(...(await rootCoverageProblems(runs)));
  if (problems.length) {
    const res = { complete: false, runs: runs.length, missing: problems };
    console.log(JSON.stringify(res, null, 1));
    await saveNew([["fxr-read.json", res]]);
    return;
  }

  const { qual, candidates } = await originationCandidates(runs);
  for (const q of qual) if (q.mutation) q.extinct = runs.find((r) => r.subject === q.subject && r.seed === q.seed)?.extinct;

  // Each candidate's clade root: walk mutations.tsv child -> parent to the lineage that is nobody's child (a founder, else refused).
  const bySeed = new Map<number, number[]>();
  candidates.forEach((c: any, i: number) => bySeed.set(c.seed, [...(bySeed.get(c.seed) ?? []), i]));
  for (const [seed, idx] of bySeed) {
    const run = runs.find((r) => r.seed === seed)!;
    const walk = rootWalker(await parentMap(lines(`${run.dir}/mutations.tsv`)));
    const roots = idx.map((i) => walk(candidates[i].descendant));
    const need = new Set(roots);
    const hexByRoot = new Map<string, string>();
    for await (const r of tsv(`${run.dir}/genomes.tsv`)) if (need.has(r.lineage) && !hexByRoot.has(r.lineage)) hexByRoot.set(r.lineage, r.words);
    idx.forEach((i, k) => {
      const c = candidates[i];
      const rootHex = checkedRootHex(c, roots[k], hexByRoot.get(roots[k]), run.dir);
      Object.assign(c, {
        subjectId: SUBJECT_IDS[c.subject],
        rootKey: roots[k],
        rootHex,
        oldComparatorHex: run.founderSet?.[0] ?? null,
        sameAsOldComparator: rootHex === run.founderSet?.[0],
        windowAtFounding: c.window[0] === 100,
      });
    });
  }

  // Plantings: c<i> = candidate beside its root; r<k> = each distinct root alone (its role if inactive beside a descendant).
  const rootMonocultures: Record<string, string> = {};
  for (const c of candidates) if (!(c.rootHex in rootMonocultures)) rootMonocultures[c.rootHex] = `r${Object.keys(rootMonocultures).length}`;
  const plantings = [
    ...candidates.map((c: any, i: number) => ({ id: `c${i}`, hex: [c.hex, c.rootHex] })),
    ...Object.entries(rootMonocultures).map(([hex, id]) => ({ id, hex: [hex] })),
  ];
  const uniform0 = { seed0: seed0U, reps: 16, growSteps: 20_000, plantings };
  const gradient0 = { seed0: seed0G, reps: 16, growSteps: 20_000, plantings, gradient: GRADIENT_GARDEN };
  const planUniform = { id: await planIdOf(uniform0), ...uniform0 };
  const planGradient = { id: await planIdOf(gradient0), ...gradient0 };
  const ok = await saveNew([
    ["fxr-candidates.json", { complete: true, runs: runs.length, qualifying: qual, candidates, rootMonocultures }],
    ["fxr-plan-uniform.json", planUniform],
    ["fxr-plan-gradient.json", planGradient],
  ]);
  if (!ok) return;

  const distinctRootRuns = new Set(candidates.map((c: any) => `${c.seed}:${c.rootKey}`)).size;
  const units = Math.ceil(plantings.length / GARDEN_PER_UNIT);
  console.log(
    `read-root: ${runs.length} runs, ${candidates.length} candidate roles, ${Object.keys(rootMonocultures).length} distinct root genomes (${distinctRootRuns} distinct run+root), ` +
      `${candidates.filter((c: any) => !c.sameAsOldComparator).length} with a different comparator from founderSet[0], ` +
      `${candidates.filter((c: any) => c.windowAtFounding).length} with a window starting at step 100; ` +
      `${plantings.length} plantings = ${units} garden units per plan (plan ids ${planUniform.id}, ${planGradient.id})`,
  );
  const oldPath = `${OUT}/fx-candidates.json`;
  if (await exists(oldPath)) {
    const old = JSON.parse(await Deno.readTextFile(oldPath)).candidates as { seed: number; role: string; descendant: string }[];
    const key = (c: { seed: number; role: string; descendant: string }) => `${c.seed}|${c.role}|${c.descendant}`;
    const oldKeys = new Set(old.map(key)), newKeys = new Set(candidates.map(key));
    console.log(`read-root: old fx-candidates.json has ${old.length} candidates; ${[...oldKeys].filter((k) => !newKeys.has(k)).length} only in old, ${[...newKeys].filter((k) => !oldKeys.has(k)).length} only in new`);
  }
}

const OUTCOME_NAMES = ["different role", "same role", "descendant inactive", "founder inactive"] as const;

/** Units of one garden directory; a missing directory is no units. Throws on a unit from another plan. */
async function readRootGarden(dir: string, plan: { id: string }) {
  const planting = new Map<string, any>();
  let units = 0;
  if (await exists(dir)) {
    for await (const e of Deno.readDir(dir)) {
      if (!/^g\d+\.json$/.test(e.name)) continue;
      const u = JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`));
      if (u.planId !== plan.id) throw new Error(`${dir}/${e.name} has planId ${u.planId ?? "(none)"}, not ${plan.id}`);
      units++;
      for (const p of u.plantings) planting.set(p.id, p);
    }
  }
  return { planting, units };
}

async function summaryRootCmd() {
  const cand = JSON.parse(await Deno.readTextFile(`${OUT}/fxr-candidates.json`));
  if (!cand.complete) throw new Error(`${OUT}/fxr-candidates.json is not complete`);
  const candidates = cand.candidates as any[];
  const rootMono = cand.rootMonocultures as Record<string, string>;
  const old = JSON.parse(await Deno.readTextFile("experiments/foundations/fx.json"));
  const planU = JSON.parse(await Deno.readTextFile(`${OUT}/fxr-plan-uniform.json`));
  const planG = JSON.parse(await Deno.readTextFile(`${OUT}/fxr-plan-gradient.json`));

  type OldPer = { id: string; runsOriginating: number; counts: boolean };
  const summarise = async (dir: string, plan: any, oldPer: OldPer[]) => {
    const { planting, units } = await readRootGarden(dir, plan);
    const expectedUnits = Math.ceil(plan.plantings.length / GARDEN_PER_UNIT);
    const incomplete: string[] = [];
    for (let i = 0; i < candidates.length; i++) if (!wholePlanting(planting.get(`c${i}`), 2)) incomplete.push(`c${i}`);
    for (const id of Object.values(rootMono)) if (!wholePlanting(planting.get(id), 1)) incomplete.push(id);
    if (units !== expectedUnits || incomplete.length) {
      return { complete: false as const, units, expectedUnits, incompletePlantings: incomplete.length, firstIncomplete: incomplete.slice(0, 10) };
    }
    const rows = candidates.map((c, i) => ({
      candidate: i,
      subjectId: c.subjectId as string,
      seed: c.seed as number,
      role: c.role,
      window: c.window,
      windowAtFounding: c.windowAtFounding,
      sameAsOldComparator: c.sameAsOldComparator,
      ...gardenOutcome(planting.get(`c${i}`), planting.get(rootMono[c.rootHex])),
    }));
    const outcomes = Object.fromEntries(OUTCOME_NAMES.map((o) => [o, rows.filter((r) => r.outcome === o).length]));
    const perSubject = countSubjects(rows).map((c) => {
      const o = oldPer.find((x) => x.id === c.id);
      return { ...c, old: o ? { runsOriginating: o.runsOriginating, counts: o.counts } : null };
    });
    const changed = perSubject.filter((c) => !c.old || c.old.counts !== c.counts).map((c) => c.id);
    return { complete: true as const, units, expectedUnits, perSubject, outcomes, rows, changed };
  };

  const uniform = await summarise(a["uniform-dir"], planU, old.uniform.perCloudOrSet);
  const gradient = await summarise(a["gradient-dir"], planG, old.gradient.perCloudOrSet);
  const { changed: chU, ...uniformOut } = uniform as typeof uniform & { changed?: string[] };
  const { changed: chG, ...gradientOut } = gradient as typeof gradient & { changed?: string[] };
  const out = {
    note: "exploratory; plan 002: each candidate gardened beside its own clade root (mutations.tsv walk, genome from genomes.tsv) instead of founderSet[0]; test 3's rules otherwise unchanged; uniform garden primary",
    seeds: { uniform: planU.seed0, gradient: planG.seed0 },
    planIds: { uniform: planU.id, gradient: planG.id },
    runs: cand.runs,
    candidates: candidates.length,
    candidatesWithNewComparator: candidates.filter((c) => !c.sameAsOldComparator).length,
    candidatesWindowAtFounding: candidates.filter((c) => c.windowAtFounding).length,
    uniform: uniformOut,
    gradient: gradientOut,
    changed: { uniform: chU ?? [], gradient: chG ?? [] },
  };
  await Deno.mkdir("experiments/foundations", { recursive: true });
  await Deno.writeTextFile(FX_ROOT_SUMMARY, JSON.stringify(out, null, 1));
  console.log(`wrote ${FX_ROOT_SUMMARY}`);
  for (const [name, g] of [["uniform", uniform], ["gradient", gradient]] as const) {
    if (!g.complete) console.log(`${name}: incomplete (${g.units}/${g.expectedUnits} units, ${g.incompletePlantings} plantings not whole)`);
    else console.log(`${name}: ${g.perSubject.filter((c) => c.runsOriginating > 0).map((c) => `${c.id} ${c.runsOriginating}/5${c.counts ? "*" : ""}`).join(", ")}; changed: ${g.changed.join(", ") || "none"}`);
  }
}

if (import.meta.main) {
  switch (cmd) {
    case "cloud":
      await cloudCmd();
      break;
    case "plan":
      await planCmd();
      break;
    case "read":
      await readCmd();
      break;
    case "read-root":
      await readRootCmd();
      break;
    case "summary-root":
      await summaryRootCmd();
      break;
    default:
      throw new Error(`unknown subcommand '${cmd}' (want cloud | plan | read | read-root | summary-root)`);
  }
}
