// tools/bootstrap.ts --resume: a search stopped after batch k and resumed to
// batch n must end exactly where one uninterrupted n-batch search does
// (archive, gate.json, viable.jsonl), and the resumed confirmation must keep
// the earlier rows, confirm only the new screening passers on the next seeds,
// and end up with the same set of confirmed genomes. Recovery from a run
// stopped between checkpoint writes, legacy archives, preflight refusals,
// seeds above an earlier dependence re-screen and --confirm-only's score of
// record are checked first on synthetic checkpoints.
//
// Real GPU, 16 default-size search batches plus confirmations (about 8 minutes):
// seed 1 first screens passers in batches 4-7, so both halves confirm some.
// Run from the repo root: deno run -A tests/deno/bootstrap-resume.ts
import { NN_BYTES } from "@bl/schema";
import { DEFAULT_EVAL, type Evaluation } from "@bl/search";

let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail}` : ""}`);
  ok &&= cond;
};

const root = await Deno.makeTempDir({ prefix: "bl-bootstrap-resume-" });
const run = async (out: string, ...args: string[]) => {
  const r = await new Deno.Command(Deno.execPath(), { args: ["run", "-A", "tools/bootstrap.ts", "--out", out, ...args], stdout: "piped", stderr: "piped" }).output();
  const text = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr);
  if (!r.success) throw new Error(`bootstrap ${args.join(" ")} failed:\n${text}`);
  return text;
};
const read = (dir: string, f: string) => Deno.readTextFile(`${dir}/${f}`);
const withoutResumes = (json: string) => JSON.stringify({ ...JSON.parse(json), resumes: undefined });

// --- Recovery and preflight, on synthetic checkpoints (no GPU needed). ---
const ec1 = { ...DEFAULT_EVAL, seed: 1 };
const search = { select: "lineages", passBias: 0.5, random: 0.25 };
const genome = (fill: number) => ({ mu: 60, sigma: 20, motGain: 0, weights: new Array(NN_BYTES).fill(fill) });
const ev = (regenerated: number): Evaluation => ({ survived: 4, recovered: 4, lightDependent: 4, reps: 4, individuals: 1, meanMass: 256, speed: 1, mass: 256, recovery: 1, regenerated, reproduction: 0 });
const fails = async (out: string, ...args: string[]) => {
  try {
    await run(out, ...args);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};
const mkdir = async (name: string, files: Record<string, unknown>) => {
  const dir = `${root}/${name}`;
  await Deno.mkdir(dir, { recursive: true });
  for (const [f, v] of Object.entries(files)) await Deno.writeTextFile(`${dir}/${f}`, typeof v === "string" ? v : JSON.stringify(v));
  return dir;
};
const exactArchive = (batches: number, viableCount: number) => ({ evaluated: batches * 16, eval: ec1, search, searchSeeds: [1, batches], batches, viableCount, resumes: [], elites: [] });

// A run stopped after committing archive.json but before rewriting gate.json:
// resuming regenerates gate.json from the replayed archive.
{
  const dir = await mkdir("stale-gate", {
    "archive.json": exactArchive(1, 1),
    "viable.jsonl": JSON.stringify({ born: 0, eval: ev(4), genome: genome(1) }) + "\n",
    "gate.json": [],
  });
  await run(dir, "--resume", "--batches", "1", "--confirm-reps", "0");
  const gate = JSON.parse(await read(dir, "gate.json"));
  check("resume regenerates a gate.json that lagged the committed archive", gate.length === 1 && JSON.stringify(gate[0].genome) === JSON.stringify(genome(1)), JSON.stringify(gate.length));
}
// The same stop followed by a plain --confirm-only: only committed passers are
// confirmed (here none), not ones from the batch that never committed.
{
  const dir = await mkdir("stale-gate-confirm-only", {
    "archive.json": exactArchive(1, 0),
    "viable.jsonl": JSON.stringify({ born: 1, eval: ev(4), genome: genome(3) }) + "\n",
    "gate.json": [{ cell: [0, 0], quality: 1, eval: ev(4), genome: genome(3) }],
  });
  const log = await run(dir, "--confirm-only");
  const confirm = JSON.parse(await read(dir, "confirm.json"));
  check("--confirm-only ignores passers from an uncommitted batch", confirm.rows.length === 0 && JSON.parse(await read(dir, "gate.json")).length === 0, log.slice(0, 300));
}
// A legacy archive where one genome is a non-passing elite in one cell and a
// displaced passer from another: the passing evaluation must survive the reseed.
{
  const dir = await mkdir("legacy-repeat", {
    "archive.json": { evaluated: 16, eval: ec1, search, searchSeeds: [1, 1], elites: [{ cell: [0, 0], quality: 0.5, born: 0, eval: ev(0), genome: genome(2) }] },
    "gate.json": [{ cell: [1, 1], quality: 1, eval: ev(4), genome: genome(2) }],
  });
  const log = await run(dir, "--resume", "--batches", "1", "--confirm-reps", "0");
  const gate = JSON.parse(await read(dir, "gate.json"));
  check("legacy resume keeps a passer whose genome is also a non-passing elite", gate.length === 1 && gate[0].eval.regenerated === 4, JSON.stringify(gate));
  check("legacy resume says it is approximate", log.includes("legacy archive"));
  const migrated = JSON.parse(await read(dir, "archive.json"));
  const lines = (await read(dir, "viable.jsonl")).split("\n").filter(Boolean).length;
  check(
    "legacy resume commits the reseeded archive with its log before searching",
    migrated.viableCount === 2 && lines === 2 && migrated.batches === 1 && JSON.stringify(migrated.resumes) === JSON.stringify([{ from: 1, exact: false }]),
    JSON.stringify({ viableCount: migrated.viableCount, lines, resumes: migrated.resumes }),
  );
}
// A new search would truncate the log under an existing archive.
{
  const dir = await mkdir("existing", { "archive.json": exactArchive(1, 0), "viable.jsonl": "", "gate.json": [] });
  check("refuses a new search into an existing archive", (await fails(dir, "--batches", "2")).includes("pass --resume"));
  check("refuses a new search of zero batches", (await fails(`${root}/zero`, "--batches", "0")).includes("at least 1"));
}
// Confirmation must start above the seeds a search will use; with no search
// the pending range is known and checked exactly.
{
  const dir = await mkdir("confirm-low", { "archive.json": exactArchive(1, 0), "viable.jsonl": "", "gate.json": [] });
  const msg = await fails(dir, "--resume", "--batches", "3", "--confirm-seed", "2");
  check("refuses confirmation seeds that a resumed search would reach", msg.includes("must start above") && JSON.parse(await read(dir, "archive.json")).batches === 1, msg.slice(0, 200));
  const five = [1, 2, 3, 4, 5].map((f) => ({ cell: [0, 0], quality: 1, eval: ev(4), genome: genome(f) }));
  const dir2 = await mkdir("confirm-only-low", {
    "archive.json": exactArchive(10, 5),
    "viable.jsonl": five.map((p) => JSON.stringify({ born: 0, eval: p.eval, genome: p.genome }) + "\n").join(""),
    "gate.json": five,
  });
  check("refuses --confirm-only seeds whose pending range reaches the search seeds", (await fails(dir2, "--confirm-only", "--confirm-seed", "9")).includes("overlap search seeds 1..10"));
}
// Conflicts with an earlier confirmation are refused before any search batch runs.
const confirmFile = (seeds: [number, number][], reps = 16) => ({ gate: { confirmSeed: seeds[0][0], confirmSeeds: seeds, batchSize: (ec1.side * ec1.side) / reps }, eval: { ...ec1, reps, seed: seeds[0][0] }, rows: [] });
for (const [i, [label, confirm, args]] of ([
  ["a search that would grow into earlier confirmation seeds", confirmFile([[2, 2]]), ["--batches", "3"]],
  ["the same with confirmation disabled", confirmFile([[2, 2]]), ["--batches", "3", "--confirm-reps", "0"]],
  ["an earlier confirmation with another replicate count", confirmFile([[500, 500]], 8), ["--batches", "3"]],
  // A dependence block from before dependenceSeeds was recorded still counts.
  ["a search that would grow into earlier dependence seeds", { ...confirmFile([[500, 500]]), dependence: { seed: 2, seeds: [2, 2], obligate: 0, rows: [] } }, ["--batches", "3"]],
] as const).entries()) {
  const dir = await mkdir(`preflight-${i}`, { "archive.json": exactArchive(1, 0), "viable.jsonl": "", "gate.json": [], "confirm.json": confirm });
  const msg = await fails(dir, "--resume", ...args);
  const after = JSON.parse(await read(dir, "archive.json"));
  check(`refuses ${label} before searching`, msg !== "" && after.batches === 1 && !msg.includes("batch 1:"), msg.split("\n").find((l) => l.includes("Error")) ?? msg.slice(0, 200));
}
// A resumed confirmation starts above every recorded seed, the dependence re-screen's included.
{
  const dir = await mkdir("confirm-above-dependence", {
    "archive.json": exactArchive(1, 0),
    "viable.jsonl": "",
    "gate.json": [],
    "confirm.json": { ...confirmFile([[500, 502]]), dependence: { seed: 503, seeds: [503, 504], obligate: 0, rows: [] } },
  });
  const log = await run(dir, "--resume", "--batches", "1");
  const confirm = JSON.parse(await read(dir, "confirm.json"));
  check("resumed confirmation starts above the earlier dependence seeds", log.includes("new screening passers from seed 505"), log.slice(0, 300));
  check("resumed confirmation keeps the earlier dependence seeds on record", JSON.stringify(confirm.gate.dependenceSeeds) === "[[503,504]]" && JSON.stringify(confirm.gate.confirmSeeds) === "[[500,502]]", JSON.stringify(confirm.gate));
  // A range recorded only in dependenceSeeds survives the rewrite, so a second resume stays above it too.
  const confirmGateOnly = confirmFile([[500, 502]]);
  const dir2 = await mkdir("confirm-above-gate-only-dependence", {
    "archive.json": exactArchive(1, 0),
    "viable.jsonl": "",
    "gate.json": [],
    "confirm.json": { ...confirmGateOnly, gate: { ...confirmGateOnly.gate, dependenceSeeds: [[503, 504]] } },
  });
  const logs = [await run(dir2, "--resume", "--batches", "1"), await run(dir2, "--resume", "--batches", "1")];
  check("a second resume stays above dependence seeds recorded only in dependenceSeeds", logs.every((l) => l.includes("new screening passers from seed 505")) && JSON.stringify(JSON.parse(await read(dir2, "confirm.json")).gate.dependenceSeeds) === "[[503,504]]", logs.map((l) => l.slice(0, 200)).join(" | "));
}
// --confirm-only confirms under the score the archive was searched with: one without a recorded score was
// searched with quality, whatever --score says.
{
  // An m3 passer that never recovers: viable under quality, not under qualityMaintenance.
  const unrecovered = { ...ev(4), recovered: 0, recovery: 0 };
  const dir = await mkdir("confirm-only-score", {
    "archive.json": exactArchive(1, 1),
    "viable.jsonl": JSON.stringify({ born: 0, eval: unrecovered, genome: genome(4) }) + "\n",
    "gate.json": [],
  });
  const log = await run(dir, "--confirm-only", "--score", "maintenance", "--confirm-reps", "0");
  const gate = JSON.parse(await read(dir, "gate.json"));
  check("--confirm-only replays a score-less archive under quality despite --score maintenance", gate.length === 1 && gate[0].quality === 0.5, JSON.stringify(gate.map((g: { quality: number }) => g.quality)));
  check("--confirm-only warns that it ignores a --score the archive was not searched with", log.includes("ignoring --score maintenance (searched with quality)"), log.slice(0, 300));
  const dir2 = await mkdir("confirm-only-score-provenance", { "archive.json": exactArchive(1, 0), "viable.jsonl": "", "gate.json": [] });
  await run(dir2, "--confirm-only", "--score", "maintenance");
  check("--confirm-only records the archive's score, not the flag's", JSON.parse(await read(dir2, "confirm.json")).provenance.score === "quality");
}
check("rejects a non-integer --batches", (await fails(`${root}/bad-flag`, "--batches", "3.5")).includes("--batches must be a nonnegative integer"));

// --- Exact continuation on the GPU. ---
const full = `${root}/full`, split = `${root}/split`;
await run(full, "--batches", "8");
await run(split, "--batches", "6");
const first: { rows: { genome: unknown }[]; gate: { confirmSeeds: [number, number][] } } = JSON.parse(await read(split, "confirm.json"));
const log = await run(split, "--batches", "8", "--resume");

check("resumed search logs that it resumed exactly", log.includes("resuming after batch 5:") && !log.includes("legacy"), log.split("\n")[0]);
check("archive.json matches the uninterrupted search", withoutResumes(await read(full, "archive.json")) === withoutResumes(await read(split, "archive.json")));
check("gate.json matches the uninterrupted search", (await read(full, "gate.json")) === (await read(split, "gate.json")));
check("viable.jsonl matches the uninterrupted search", (await read(full, "viable.jsonl")) === (await read(split, "viable.jsonl")));
check("archive.json records the resume", JSON.stringify(JSON.parse(await read(split, "archive.json")).resumes) === JSON.stringify([{ from: 6, exact: true }]));

const a: { rows: { genome: unknown }[] } = JSON.parse(await read(full, "confirm.json"));
const b: { rows: { genome: unknown }[]; gate: { confirmSeeds: [number, number][] } } = JSON.parse(await read(split, "confirm.json"));
const keys = (rows: { genome: unknown }[]) => rows.map((r) => JSON.stringify(r.genome)).sort();
check("the test exercises confirmation on both sides of the resume", first.rows.length > 0 && b.rows.length > first.rows.length, `${first.rows.length} then ${b.rows.length}`);
// Cluster labels are recomputed over all confirmations; the evaluations themselves must not change.
const core = (rows: unknown[]) => JSON.stringify(rows.map((r) => { const { screenCell, cell, eval: e, genome } = r as Record<string, unknown>; return { screenCell, cell, e, genome }; }));
check("resumed confirmation keeps the earlier rows unchanged", core(b.rows.slice(0, first.rows.length)) === core(first.rows));
check("resumed confirmation covers the same screening passers as the uninterrupted one", JSON.stringify(keys(a.rows)) === JSON.stringify(keys(b.rows)), `${a.rows.length} vs ${b.rows.length}`);
const ranges = b.gate.confirmSeeds;
check(
  "new confirmation seeds follow the earlier ones without overlap",
  JSON.stringify(ranges.slice(0, first.gate.confirmSeeds.length)) === JSON.stringify(first.gate.confirmSeeds) && ranges.every((r, i) => i === 0 || r[0] === ranges[i - 1][1] + 1),
  JSON.stringify(ranges),
);

await Deno.remove(root, { recursive: true });
Deno.exit(ok ? 0 : 1);
