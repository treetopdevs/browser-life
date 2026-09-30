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
//
// Plans and readouts go under --out (default runs/foundations/results), matching tools/foundations.ts.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { M3_FOUNDERS, founderGenome, genomeHex } from "@bl/schema";
import { GRADIENT_GARDEN, originationCandidates, tsv } from "./foundations.ts";

const a = parseArgs(Deno.args, {
  string: ["out", "run", "step", "dir"],
  default: { out: "runs/foundations/results", step: "100000", dir: "runs/founders-x" },
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

async function readCmd() {
  await Deno.mkdir(OUT, { recursive: true });
  const runs = await fxRuns(a.dir);
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
    default:
      throw new Error(`unknown subcommand '${cmd}' (want cloud | plan | read)`);
  }
}
