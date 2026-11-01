// Behaviour atlas tooling (I01; docs/behaviour-atlas-2026-11-01/PLAN.md).
//
//   deno run -A tools/atlas.ts fixture [--out docs/behaviour-atlas-2026-11-01/fixture-evidence.json]
//       CPU. Runs the descriptor fixtures (known values, negative cases) and writes machine-readable evidence.
//   deno run -A tools/atlas.ts replay-check <dir> [--out file]
//       CPU. Replays <dir>/viable.jsonl under the archive of record and compares the rebuilt archive to
//       <dir>/archive.json (elites, lineages, counts). Nothing in <dir> is written.
//   deno run -A tools/atlas.ts ledger <dir> --out <outdir>
//       CPU. Writes ledger.jsonl (the accepted-candidate ledger) and manifest.json for an archive directory.
//   deno run -A tools/atlas.ts calibrate --src <archive dir> --out <outdir> [--n 160]
//       GPU (local WebGPU). Plain-twin qualification, then descriptor calibration (sets A, B, elites) per the plan.
//       Appends to <outdir>/rows.jsonl and resumes from it; writes <outdir>/timing.json.
//   deno run -A tools/atlas.ts report --out <outdir> [--json file]
//       CPU. Computes the calibration report from <outdir>/rows.jsonl.

import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION, ringsOf, type Genome } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { ARCHIVE_CELLS, ATLAS_V1, sameAtlasSpec, Archive, DEFAULT_ARCHIVE, DEFAULT_EVAL, GATES, SCORES, calibrate, evaluateBatch, genomeKey, proposalGenome, searchedArchive, searchedWith, type CalRow, type EvalConfig, type Evaluation, type Provenance } from "@bl/search";
import { FIXTURE_CADENCE, FIXTURE_FRAMES, FIXTURE_TILE, fixtures, runFixture } from "../packages/search/src/atlas-fixtures.ts";

type EncGenome = { mu: number; sigma: number; motGain: number; weights: number[]; rings?: number[] };
const enc = (g: Genome): EncGenome => ({ mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Array.from(g.weights), ...(ringsOf(g) ? { rings: ringsOf(g) } : {}) });
const dec = (g: EncGenome): Genome => ({ mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Int8Array.from(g.weights), ...(ringsOf(g) ? { rings: ringsOf(g) } : {}) });
const sha256 = async (path: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await Deno.readFile(path)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const readLines = async (p: string) => (await Deno.readTextFile(p)).split("\n").filter(Boolean);
const gitSha = async () => new TextDecoder().decode((await new Deno.Command("git", { args: ["rev-parse", "HEAD"], stdout: "piped" }).output()).stdout).trim();

const a = parseArgs(Deno.args, { string: ["out", "src", "n", "json"], default: { n: "160" } });
const [cmd, dirArg] = a._ as string[];

type Saved = {
  evaluated: number;
  eval: EvalConfig;
  search?: { score?: string; gate?: string; archive?: string };
  batches?: number;
  viableCount?: number;
  lineages: { size: number; passers: number; best: number; bestCell: [number, number] | null; bestQuality: number }[];
  elites: { cell: [number, number]; quality: number; born: number; genome: EncGenome }[];
};

/** Rebuilds the archive of record from <dir>: the replay `tools/bootstrap.ts --resume` performs. */
async function replayDir(dir: string) {
  const saved: Saved = JSON.parse(await Deno.readTextFile(`${dir}/archive.json`));
  if (saved.viableCount === undefined) throw new Error(`${dir}/archive.json predates viable.jsonl (no viableCount)`);
  const { score, gate } = searchedWith(saved.search);
  const { archive: name } = searchedArchive(saved.search);
  const savedSpec = (saved as { provenance?: { atlasSpec?: typeof ATLAS_V1 } }).provenance?.atlasSpec;
  if (name === "atlas-v1" && (!savedSpec || !sameAtlasSpec(savedSpec, ATLAS_V1))) throw new Error(`${dir}/archive.json recorded atlas definition ${JSON.stringify(savedSpec)}, which is not the current ATLAS_V1; replaying would rebuild different cells`);
  const lines = (await readLines(`${dir}/viable.jsonl`)).slice(0, saved.viableCount);
  if (lines.length < saved.viableCount) throw new Error(`${dir}/viable.jsonl has ${lines.length} lines, archive.json expects ${saved.viableCount}`);
  const log = lines.map((l) => {
    const r = JSON.parse(l);
    return { genome: dec(r.genome), eval: r.eval as Evaluation, born: r.born as number, ...(r.prov ? { prov: r.prov as Provenance } : {}) };
  });
  const archive = Archive.replay(log, saved.evaluated, DEFAULT_ARCHIVE, SCORES[score], GATES[gate], ARCHIVE_CELLS[name]);
  return { saved, archive, name, provLines: log.filter((l) => l.prov).length };
}

if (cmd === "fixture") {
  const out = a.out ?? "docs/behaviour-atlas-2026-11-01/fixture-evidence.json";
  const rows = fixtures().map((f) => ({ id: f.id, note: f.note, expect: f.expect, got: runFixture(f) }));
  await Deno.writeTextFile(out, JSON.stringify({ definition: "docs/behaviour-atlas-2026-11-01/PLAN.md", tile: FIXTURE_TILE, frames: FIXTURE_FRAMES, cadenceSteps: FIXTURE_CADENCE, ruleVersion: RULE_VERSION, rows }, null, 1) + "\n");
  for (const r of rows) console.log(`${r.id.padEnd(22)} d1 ${r.got.d1 === null ? "undefined" : r.got.d1.toFixed(4)}  path ${r.got.comPath === null ? "-" : r.got.comPath.toFixed(4)}  d2 ${r.got.d2 === null ? "undefined" : r.got.d2.toFixed(4)}`);
} else if (cmd === "replay-check") {
  const { saved, archive, provLines } = await replayDir(dirArg);
  const byCell = new Map(archive.elites().map((e) => [e.cell!.join(","), e]));
  const elites = saved.elites.map((e) => {
    const m = byCell.get(e.cell.join(","));
    return !!m && genomeKey(m.genome) === genomeKey(dec(e.genome)) && m.quality === e.quality && m.born === e.born;
  });
  const lin = archive.lineages();
  const lineages = saved.lineages.map((l, i) => { const m = lin[i]; return !!m && m.size === l.size && m.passers === l.passers && m.best.length === l.best && JSON.stringify(m.best[0].cell) === JSON.stringify(l.bestCell) && m.best[0].quality === l.bestQuality; });
  const checks = {
    passersMatchGateJson: await (async () => {
      const g = await Deno.readTextFile(`${dirArg}/gate.json`).then((t) => JSON.parse(t) as { genome: EncGenome }[]).catch(() => undefined);
      if (!g) return true; // no gate.json to compare
      const want = new Set(g.map((r) => genomeKey(dec(r.genome))));
      const got = archive.gatePassing().map((e) => genomeKey(e.genome));
      return want.size === got.length && got.every((k) => want.has(k));
    })(),
    elitesCount: archive.elites().length === saved.elites.length,
    elitesAllMatch: elites.every(Boolean),
    lineagesCount: lin.length === saved.lineages.length,
    lineagesAllMatch: lineages.every(Boolean),
    viableCount: archive.viableLog().length === saved.viableCount,
    evaluated: archive.evaluated === saved.evaluated,
  };
  const report = { dir: dirArg, identical: Object.values(checks).every(Boolean), checks, counts: { viable: saved.viableCount, evaluated: saved.evaluated, elites: saved.elites.length, lineages: saved.lineages.length, passers: archive.gatePassing().length, linesWithProv: provLines } };
  console.log(JSON.stringify(report, null, 1));
  if (a.out) await Deno.writeTextFile(a.out, JSON.stringify(report, null, 1) + "\n");
  if (!report.identical) Deno.exit(1);
} else if (cmd === "ledger") {
  if (!a.out) throw new Error("ledger needs --out");
  await Deno.mkdir(a.out, { recursive: true });
  const { saved, archive, name, provLines } = await replayDir(dirArg);
  const ledger = archive.ledger();
  await Deno.writeTextFile(`${a.out}/ledger.jsonl`, ledger.map((l) => JSON.stringify(l)).join("\n") + "\n");
  // Audit: every logged proposal must regenerate its genome from its provenance and its parent's logged genome.
  const log = archive.viableLog();
  const mu = saved.eval.world.defaultMu!, sigma = saved.eval.world.defaultSigma!;
  const regenerated = ledger.filter((l) => l.prov && genomeKey(proposalGenome(l.prov, l.prov.parent === null ? undefined : log[l.prov.parent].genome, mu, sigma)) === l.key).length;
  const cellsUsed = new Set(ledger.flatMap((l) => (l.cell ? [l.cell.join(",")] : [])));
  const viable = ledger.length;
  const manifest = {
    source: dirArg,
    codeSha: await gitSha(),
    versions: { schema: SCHEMA_VERSION, rule: RULE_VERSION, metrics: METRICS_VERSION },
    archive: name,
    ...(name === "atlas-v1" ? { atlasSpec: ATLAS_V1 } : { archiveSpec: DEFAULT_ARCHIVE }),
    files: { "viable.jsonl": await sha256(`${dirArg}/viable.jsonl`), "archive.json": await sha256(`${dirArg}/archive.json`) },
    evaluated: saved.evaluated,
    viable,
    nonViableNotLogged: saved.evaluated - viable,
    withProvenance: provLines,
    provenanceRegenerated: regenerated,
    inserted: ledger.filter((l) => l.inserted).length,
    currentElites: ledger.filter((l) => l.current).length,
    displaced: ledger.filter((l) => l.displaced !== null).length,
    passersDistinct: archive.gatePassing().length,
    passingOffers: ledger.filter((l) => l.passer).length,
    duplicateGenomes: ledger.filter((l) => l.duplicate).length,
    duplicateRate: viable ? ledger.filter((l) => l.duplicate).length / viable : 0,
    noCell: ledger.filter((l) => l.cell === null).length,
    cellsEverOccupied: cellsUsed.size,
    stepStoneNote: "the ledger keeps every viable offer; cells hold only the current elite. Non-viable proposals (quality 0) are counted, not logged.",
  };
  await Deno.writeTextFile(`${a.out}/manifest.json`, JSON.stringify(manifest, null, 1) + "\n");
  console.log(JSON.stringify(manifest, null, 1));
} else if (cmd === "calibrate") {
  if (!a.src || !a.out) throw new Error("calibrate needs --src and --out");
  await Deno.mkdir(a.out, { recursive: true });
  const n = Number(a.n);
  const ec: EvalConfig = { ...DEFAULT_EVAL, atlas: true };
  const perBatch = Math.floor((ec.side * ec.side) / ec.reps);
  // Set A: distinct genome keys of the source's viable log in file order, every k-th, first n.
  const seen = new Set<string>();
  const distinct: Genome[] = [];
  for (const l of await readLines(`${a.src}/viable.jsonl`)) {
    const g = dec(JSON.parse(l).genome);
    if (!seen.has(genomeKey(g))) { seen.add(genomeKey(g)); distinct.push(g); }
  }
  const k = Math.floor(distinct.length / n);
  const setA = Array.from({ length: n }, (_, i) => distinct[i * k]);
  const saved: Saved = JSON.parse(await Deno.readTextFile(`${a.src}/archive.json`));
  const elites = saved.elites.map((e) => dec(e.genome));
  const setB = setA.slice(0, 32);
  const plan: { set: "twin" | "A" | "B" | "elites"; seed: number; genomes: Genome[]; atlas: boolean }[] = [];
  const add = (set: "twin" | "A" | "B" | "elites", seed0: number, gs: Genome[], atlas = true) => {
    for (let i = 0; i * perBatch < gs.length; i++) plan.push({ set, seed: seed0 + i, genomes: gs.slice(i * perBatch, (i + 1) * perBatch), atlas });
  };
  add("A", 3000001, setA);
  add("elites", 3000001 + Math.ceil(setA.length / perBatch), elites);
  add("B", 3000101, setB);
  add("twin", 3000001, setA.slice(0, perBatch), false);
  const rowsPath = `${a.out}/rows.jsonl`;
  const done = new Set((await Deno.readTextFile(rowsPath).catch(() => "")).split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.set}:${r.seed}`; }));
  const timingPath = `${a.out}/timing.json`;
  const timing: { batches: { set: string; seed: number; genomes: number; seconds: number }[] } = JSON.parse(await Deno.readTextFile(timingPath).catch(() => '{"batches":[]}'));
  const device = await requestDevice(navigator.gpu);
  for (const b of plan) {
    if (done.has(`${b.set}:${b.seed}`)) continue;
    const t0 = performance.now();
    const evals = await evaluateBatch(device, b.genomes, { ...ec, atlas: b.atlas, seed: b.seed });
    const seconds = (performance.now() - t0) / 1000;
    await Deno.writeTextFile(rowsPath, b.genomes.map((g, i) => JSON.stringify({ set: b.set, seed: b.seed, key: genomeKey(g), genome: enc(g), eval: evals[i] }) + "\n").join(""), { append: true });
    timing.batches.push({ set: b.set, seed: b.seed, genomes: b.genomes.length, seconds });
    await Deno.writeTextFile(timingPath, JSON.stringify(timing, null, 1));
    console.log(`${b.set} seed ${b.seed}: ${b.genomes.length} genomes ${seconds.toFixed(1)}s`);
  }
  console.log(`done: ${timing.batches.length} batches, ${timing.batches.reduce((s, x) => s + x.genomes, 0)} genome evaluations, ${timing.batches.reduce((s, x) => s + x.seconds, 0).toFixed(0)}s of evaluation wall time`);
} else if (cmd === "report") {
  if (!a.out) throw new Error("report needs --out");
  const rows = (await readLines(`${a.out}/rows.jsonl`)).map((l) => JSON.parse(l) as { set: string; seed: number; key: string; eval: Evaluation });
  const of = (s: string): CalRow[] => rows.filter((r) => r.set === s).map((r) => ({ key: r.key, eval: r.eval }));
  const A = of("A"), B = of("B"), E = of("elites"), twinOn = A.slice(0, 16), twinOff = of("twin");
  const strip = (e: Evaluation) => { const { atlas: _a, ...rest } = e; return JSON.stringify(rest); };
  const twinIdentical = twinOff.length > 0 && twinOff.length === twinOn.length && twinOff.every((r, i) => r.key === twinOn[i].key && strip(r.eval) === strip(twinOn[i].eval));
  const rep = calibrate(A, B);
  const timing = JSON.parse(await Deno.readTextFile(`${a.out}/timing.json`).catch(() => '{"batches":[]}'));
  const sum = (f: (b: { set: string; genomes: number; seconds: number }) => number) => timing.batches.reduce((s: number, b: { set: string; genomes: number; seconds: number }) => s + f(b), 0);
  const bin = (v: number, [lo, hi]: [number, number]) => Math.max(0, Math.min(7, Math.floor(((v - lo) / (hi - lo)) * 8)));
  const eliteAtlas = E.filter((r) => r.eval.atlas?.d1 != null && r.eval.atlas?.d2 != null).map((r) => `${bin(r.eval.atlas!.d1!, rep.ranges.displacementRange)},${bin(r.eval.atlas!.d2!, rep.ranges.persistenceRange)}`);
  const out = {
    plan: "docs/behaviour-atlas-2026-11-01/PLAN.md",
    twin: { genomes: twinOff.length, identicalExceptAtlas: twinIdentical },
    calibration: rep,
    eliteAudit: { elites: E.length, withBothDescriptors: eliteAtlas.length, distinctAtlasCells: new Set(eliteAtlas).size, massSpeedCells: E.length, note: "the 47 mass/speed elites re-described by D1/D2 under the calibrated ranges; spread across atlas cells is breadth, not capability" },
    cost: { batches: timing.batches.length, genomeEvaluations: sum((b) => b.genomes), tileReplicates: sum((b) => b.genomes) * DEFAULT_EVAL.reps, evaluationWallSeconds: Math.round(sum((b) => b.seconds)), secondsPerBatch: timing.batches.length ? sum((b) => b.seconds) / timing.batches.length : null },
  };
  console.log(JSON.stringify(out, null, 1));
  if (a.json) await Deno.writeTextFile(a.json, JSON.stringify(out, null, 1) + "\n");
} else throw new Error("usage: atlas.ts fixture | replay-check <dir> | ledger <dir> --out <dir> | calibrate --src <dir> --out <dir> | report --out <dir>");
