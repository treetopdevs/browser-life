// Clade measures from the mutation tree, v1 (docs/clade-measures-2026-10-18.md): TMRCA95, mutant-clade sweeps and
// gross clade replacement on the M4 treatment runs, test 6's 70 neutral runs and the M4 no-mutation runs, with the
// eligibility rules of the note. Exploratory, CPU only, streaming, read-only on the run bundles.
//
//   deno run -A tools/clade.ts pilot                              2 runs: timings, retained nodes and the cadence rule; no measure values
//   deno run -A tools/clade.ts all --cadence 1|10 --cache FILE    every run -> experiments/foundations/clade-v1.json (resumes from FILE)
//
//   --base       directory standing in for "runs" (default runs; from a worktree, pass the main checkout's runs/)
//   --cache      per-run cache, required by `all`; must not be under --base (run bundles are read-only)
//   --out        the record (default experiments/foundations/clade-v1.json)
//   --cadence    1 = measures at every census, 10 = at every 10th; chosen by the pilot's rule, required by `all`
//   --cap-hours  wall-time cap for `all` (default 12); when hit, the record is written with partial: true
//
// Each cache entry records its input (manifest ids and hashes, sizes and modification times of lineages.tsv and
// mutations.tsv) and is refused when the files under --base differ. Contents are not digested (about 20 GB per pass), so
// an edit that keeps both size and mtime is not caught. Cache keys carry a SHA-256 of this file,
// tools/lib/clade-measures.ts, tools/lib/bundle.ts (the census parser), tools/lib/measures6.ts (the split RNG),
// packages/metrics/src/stats.ts (the statistics) and the parameters, so entries from other code
// are never reused; the record carries the same hash. --cache and --out must
// not resolve under --base. Cache and record are written atomically (temp file, sync, rename). Run one `all`
// per cache file at a time.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { lineageCensuses } from "./lib/bundle.ts";
import { type CladeResult, type RunRecord, type RunSet, cladeMeasures, eligibility, ELIGIBILITY, isUnder, PARAMS, splitLines } from "./lib/clade-measures.ts";

const a = parseArgs(Deno.args, {
  string: ["base", "cache", "out", "cadence", "cap-hours"],
  default: { base: "runs", out: "experiments/foundations/clade-v1.json", "cap-hours": "12" },
});
const cmd = String(a._[0] ?? "");
const VERSION = 1;
const HORIZON = 1_000_000;
const CENSUS_EVERY = 100;

// ---------------------------------------------------------------------------------------------
// Runs.

const disk = (dir: string) => {
  if (!dir.startsWith("runs/")) throw new Error(`run directory ${dir} does not start with runs/`);
  return `${a.base}${dir.slice("runs".length)}`;
};
interface RunRef { set: RunSet; dir: string; seed: number; preset: string; extinct: boolean }
/** The three sets in the fixed order of the note, each root with its preset, condition and expected run count. */
const SETS: { set: RunSet; roots: [string, string, string, number][] }[] = [
  { set: "treatment", roots: [["runs/m4/gradient-m3/treatment", "gradient-m3", "treatment", 20], ["runs/m4/spots-m3/treatment", "spots-m3", "treatment", 10]] },
  {
    set: "neutral",
    roots: [
      ["runs/replay-calib/gradient-m3/neutral", "gradient-m3", "neutral", 20],
      ["runs/replay-calib/spots-m3/neutral", "spots-m3", "neutral", 20],
      ["runs/replay-m4/gradient-m3/neutral", "gradient-m3", "neutral", 20],
      ["runs/replay-m4/spots-m3/neutral", "spots-m3", "neutral", 10],
    ],
  },
  { set: "noMutation", roots: [["runs/m4/gradient-m3/no-mutation", "gradient-m3", "no-mutation", 20], ["runs/m4/spots-m3/no-mutation", "spots-m3", "no-mutation", 10]] },
];

const exists = async (p: string) => {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
};

/** Every run of the three sets, checked against the note's counts and settings; throws STOP on any difference. */
async function listRuns(): Promise<RunRef[]> {
  const out: RunRef[] = [];
  const problems: string[] = [];
  for (const { set, roots } of SETS)
    for (const [root, preset, condition, expected] of roots) {
      const here: RunRef[] = [];
      for await (const e of Deno.readDir(disk(root))) {
        if (!e.isDirectory || !/^seed-\d+$/.test(e.name)) continue;
        const dir = `${root}/${e.name}`;
        let m: any;
        try {
          m = JSON.parse(await Deno.readTextFile(`${disk(dir)}/manifest.json`));
        } catch {
          problems.push(`${dir}: no readable manifest`);
          continue;
        }
        if (!m.summary) problems.push(`${dir}: unfinished (no summary)`);
        if (m.spec?.presetId !== preset || m.spec?.condition !== condition) problems.push(`${dir}: manifest says ${m.spec?.presetId}/${m.spec?.condition}`);
        if (m.spec?.steps !== HORIZON || m.summary?.steps !== HORIZON) problems.push(`${dir}: steps ${m.spec?.steps}/${m.summary?.steps}, expected ${HORIZON}`);
        if (m.spec?.censusEvery !== CENSUS_EVERY) problems.push(`${dir}: censusEvery ${m.spec?.censusEvery}, expected ${CENSUS_EVERY}`);
        if (`seed-${m.spec?.seed}` !== e.name) problems.push(`${dir}: manifest seed ${m.spec?.seed}`);
        for (const f of ["mutations.tsv", "lineages.tsv"]) if (!(await exists(`${disk(dir)}/${f}`))) problems.push(`${dir}: no ${f}`);
        here.push({ set, dir, seed: m.spec?.seed, preset, extinct: m.summary?.extinct === true });
      }
      if (here.length !== expected) problems.push(`${root}: ${here.length} runs, expected ${expected}`);
      out.push(...here.sort((x, y) => x.seed - y.seed));
    }
  if (problems.length) throw new Error(`STOP: the corpus differs from the note:\n  ${problems.join("\n  ")}`);
  return out;
}

/** mutations.tsv lines, streamed (the header included; the measures skip it). */
async function* fileLines(path: string): AsyncGenerator<string> {
  const file = await Deno.open(path);
  yield* splitLines(file.readable.pipeThrough(new TextDecoderStream()));
}

/** Measures one run; STOP when the data's completeness disagrees with the manifest (truncated or gapped lineages.tsv). */
async function measureRun(ref: { dir: string; extinct: boolean }, cadence: 1 | 10): Promise<CladeResult> {
  const r = await cladeMeasures(lineageCensuses(disk(ref.dir)), fileLines(`${disk(ref.dir)}/mutations.tsv`), {
    horizon: HORIZON,
    cadence,
    censusEvery: CENSUS_EVERY,
    expectedCensuses: HORIZON / CENSUS_EVERY,
  });
  if (r.complete === ref.extinct) {
    throw new Error(`STOP: ${ref.dir}: manifest says extinct ${ref.extinct}, but lineages.tsv has ${r.censuses} non-empty censuses (expected ${HORIZON / CENSUS_EVERY}, one every ${CENSUS_EVERY} steps), last ${r.lastCensus}`);
  }
  return r;
}

/**
 * SHA-256 over the code that computes the measures and the eligibility readout, and the parameters (hex, first 16
 * characters): this file, the measures, the census parser, the split RNG (measures6.ts) and the statistics
 * (mannWhitney, binomialLowerBound in packages/metrics/src/stats.ts). Import maps and the rest of @bl/* are not hashed.
 */
const CODE_FILES = ["./lib/clade-measures.ts", "./lib/bundle.ts", "./lib/measures6.ts", "../packages/metrics/src/stats.ts"];
async function codeHash(): Promise<string> {
  const src = await Promise.all(CODE_FILES.map((f) => new URL(f, import.meta.url)).concat(new URL(import.meta.url)).map((u) => Deno.readTextFile(u)));
  const bytes = new TextEncoder().encode(JSON.stringify([src, PARAMS, ELIGIBILITY, HORIZON, CENSUS_EVERY]));
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

interface RunInput {
  runId: string | null;
  initHash: string | null;
  finalHash: string | null;
  steps: number | null;
  lineagesBytes: number;
  mutationsBytes: number;
  lineagesMtime: number | null;
  mutationsMtime: number | null;
}
async function runInput(ref: { dir: string }): Promise<RunInput> {
  const d = disk(ref.dir);
  const m = JSON.parse(await Deno.readTextFile(`${d}/manifest.json`));
  const [ls, ms] = [await Deno.stat(`${d}/lineages.tsv`), await Deno.stat(`${d}/mutations.tsv`)];
  return {
    runId: m.runId ?? null,
    initHash: m.initHash ?? null,
    finalHash: m.summary?.finalHash ?? null,
    steps: m.summary?.steps ?? null,
    lineagesBytes: ls.size,
    mutationsBytes: ms.size,
    lineagesMtime: ls.mtime?.getTime() ?? null,
    mutationsMtime: ms.mtime?.getTime() ?? null,
  };
}
const sameInput = (x: RunInput, y: RunInput) => (Object.keys(y) as (keyof RunInput)[]).every((k) => x[k] === y[k]);

async function sync(path: string) {
  const f = await Deno.open(path, { read: true });
  try {
    await f.syncData();
  } finally {
    f.close();
  }
}
let writes = 0;
async function writeAtomic(path: string, text: string) {
  const tmp = `${path}.${Deno.pid}.${++writes}.tmp`;
  let wrote = false;
  try {
    await Deno.writeTextFile(tmp, text, { createNew: true });
    wrote = true;
    await sync(tmp);
    await Deno.rename(tmp, path);
  } catch (e) {
    if (wrote || !(e instanceof Deno.errors.AlreadyExists)) await Deno.remove(tmp).catch(() => {});
    throw e;
  }
}

const timed = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
  const t0 = performance.now();
  const v = await f();
  return [v, (performance.now() - t0) / 1000];
};
const mb = (n: number) => `${(n / 1e6).toFixed(0)}MB`;
const hms = (s: number) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
const uptime = () => {
  try {
    return new TextDecoder().decode(new Deno.Command("uptime").outputSync().stdout).trim();
  } catch {
    return `load ${Deno.loadavg().join(" ")}`;
  }
};

// ---------------------------------------------------------------------------------------------
// Pilot: timings and retained-node diagnostics only. No measure value is printed.

async function pilot() {
  console.log(`pilot: ${uptime()}`);
  const runs = await listRuns();
  console.log(`corpus OK: ${runs.length} runs (${runs.filter((r) => r.extinct).length} extinct)`);
  const pick = ["runs/m4/gradient-m3/treatment/seed-1", "runs/replay-m4/spots-m3/neutral/seed-1"].map((d) => runs.find((r) => r.dir === d)!);
  const bytes = async (r: RunRef) => {
    const i = await runInput(r);
    return i.lineagesBytes + i.mutationsBytes;
  };
  const rate: Record<string, Record<number, number>> = {};
  const project = async (cadence: 1 | 10) => {
    let s = 0, b = 0;
    for (const r of runs) {
      const x = await bytes(r);
      b += x;
      s += rate[r.preset][cadence] * x;
    }
    return { seconds: s, bytes: b };
  };
  const timeAt = async (cadence: 1 | 10) => {
    for (const ref of pick) {
      const b = await bytes(ref);
      const [res, secs] = await timed(() => measureRun(ref, cadence));
      (rate[ref.preset] ??= {})[cadence] = secs / b;
      console.log(`  ${ref.dir} (${mb(b)} lineages+mutations) cadence ${cadence}: ${secs.toFixed(0)}s (${(secs / (b / 1e6)).toFixed(2)} s/MB); censuses ${res.censuses}, evaluated ${res.evaluated}; peak retained ${res.peakRetained}`);
      console.log(`    by tenth of the run: retained ${res.retainedByDecile.join(" ")}`);
      console.log(`                         living   ${res.livingByDecile.join(" ")}`);
      console.log(`                         depth    ${res.depthByDecile.join(" ")}`);
    }
    const p = await project(cadence);
    console.log(`projection at cadence ${cadence} for ${runs.length} runs (${mb(p.bytes)}): ${hms(p.seconds)} (${(p.seconds / 3600).toFixed(2)} h) at ${uptime()}`);
    return p.seconds;
  };
  const c1 = await timeAt(1);
  if (c1 <= 8 * 3600) {
    console.log("cadence rule: projection at cadence 1 is at most 8 h -> cadence 1");
    return;
  }
  const c10 = await timeAt(10);
  console.log(`cadence rule: projection at cadence 1 is over 8 h -> cadence 10${c10 > 12 * 3600 ? " (projected over the 12 h cap: expect a partial readout)" : ""}`);
}

// ---------------------------------------------------------------------------------------------
// The full computation.

interface Entry { input: RunInput; result: CladeResult; seconds: number }

async function all() {
  const cadence = Number(a.cadence);
  if (cadence !== 1 && cadence !== 10) throw new Error("all needs --cadence 1 or --cadence 10 (the pilot's rule chooses)");
  if (!a.cache) throw new Error("all needs --cache FILE (outside --base)");
  const capHours = Number(a["cap-hours"]);
  if (!(capHours >= 0)) throw new Error(`--cap-hours ${a["cap-hours"]}`);
  const base = await Deno.realPath(a.base);
  const dirOf = (f: string) => Deno.realPath(f.includes("/") ? f.slice(0, f.lastIndexOf("/")) || "/" : ".");
  for (const [flag, f] of [["--cache", a.cache], ["--out", a.out]] as const) {
    if (isUnder(await dirOf(f), base)) throw new Error(`${flag} ${f} is under --base ${a.base}; run bundles are read-only`);
  }
  const code = await codeHash();

  const uptimeStart = uptime();
  console.log(`all: cadence ${cadence}, cap ${capHours} h, cache ${a.cache}, code ${code}; ${uptimeStart}`);
  const runs = await listRuns();
  const cache: Record<string, Entry> = (await exists(a.cache)) ? JSON.parse(await Deno.readTextFile(a.cache)) : {};
  const key = (r: RunRef) => `${r.dir}|v${VERSION}|c${cadence}|${code}`;
  const inputs = new Map<string, RunInput>();
  for (const r of runs) {
    const now = await runInput(r);
    inputs.set(key(r), now);
    const c = cache[key(r)];
    if (c && !sameInput(c.input, now)) throw new Error(`STOP: cache entry ${key(r)} was computed from different inputs; use another --cache`);
  }

  const t00 = performance.now();
  const missing: string[] = [];
  let i = 0;
  for (const r of runs) {
    i++;
    const k = key(r);
    if (cache[k]) {
      console.log(`[${i}/${runs.length}] ${r.set} ${r.dir}: cached`);
      continue;
    }
    if ((performance.now() - t00) / 3.6e6 >= capHours) {
      missing.push(r.dir);
      continue;
    }
    const [result, seconds] = await timed(() => measureRun(r, cadence as 1 | 10));
    // Diagnostic for the stop condition "retained nodes growing with file length": the per-tenth retained counts stay in the
    // cache; here only the ratio of the last tenth to the first is logged.
    const growth = result.retainedByDecile[9] / Math.max(1, result.retainedByDecile[0]);
    cache[k] = { input: inputs.get(k)!, result, seconds };
    await writeAtomic(a.cache, JSON.stringify(cache));
    console.log(`[${i}/${runs.length}] ${r.set} ${r.dir}: ${seconds.toFixed(0)}s, peak retained ${result.peakRetained} (last/first tenth ${growth.toFixed(1)}); rss ${mb(Deno.memoryUsage().rss)}, load ${Deno.loadavg()[0].toFixed(0)}, elapsed ${hms((performance.now() - t00) / 1000)}`);
  }
  if (missing.length) console.log(`cap of ${capHours} h reached: ${missing.length} runs not computed`);

  // Per-run scalars only (no series, no sweep lists, no diagnostics).
  const records: RunRecord[] = [];
  for (const r of runs) {
    const c = cache[key(r)];
    if (!c) continue;
    const x = c.result;
    records.push({
      set: r.set, preset: r.preset, seed: r.seed, dir: r.dir,
      tmrca95Median2: x.tmrca95Median2, tmrca95Final: x.tmrca95Final, flaggedTmrca: x.flaggedTmrca, tmrcaAllFinal: x.tmrcaAllFinal, firstMonophyly95: x.firstMonophyly95,
      mutantSweeps: x.mutantSweeps, founderSweeps: x.founderSweeps, founderSweepsFromLow: x.founderSweepsFromLow, flaggedSweeps: x.flaggedSweeps,
      grossReplacement2: x.grossReplacement2, netReplacement2: x.netReplacement2, intervals: x.intervals,
      meanCells2: x.meanCells2, mutationsPer1e5_2: x.mutationsPer1e5_2,
      complete: x.complete, censuses: x.censuses, evaluated: x.evaluated, lastCensus: x.lastCensus, trailingEdges: x.trailingEdges,
      peakRetained: x.peakRetained, livingLast: x.livingLast, retainedLast: x.retainedLast, depthLast: x.depthLast, seconds: Math.round(c.seconds),
    });
  }
  const el = eligibility(records);
  const bySet = (s: RunSet) => records.filter((x) => x.set === s);
  const secs = (s: RunSet) => Math.round(runs.filter((r) => r.set === s && cache[key(r)]).reduce((t, r) => t + cache[key(r)].seconds, 0));
  const record = {
    note: "Exploratory clade measures from the mutation tree (docs/clade-measures-2026-10-18.md); rules fixed in that note before computing. " +
      "Contrast: M4 treatment originals against test 6's 70 neutral runs per preset; no-mutation is descriptive. Not a registration.",
    version: VERSION,
    code,
    params: PARAMS,
    horizon: HORIZON,
    cadence,
    rules: ELIGIBILITY,
    corpora: Object.fromEntries(SETS.map((s) => [s.set, s.roots.map(([root, preset, , n]) => ({ root, preset, runs: n }))])),
    partial: missing.length > 0,
    missing,
    extinct: runs.filter((r) => r.extinct).map((r) => r.dir),
    incompleteRuns: el.incompleteRuns,
    eligible: el.eligible,
    measures: el.measures,
    runs: { treatment: bySet("treatment"), neutral: bySet("neutral"), noMutation: bySet("noMutation") },
    timings: { computeSeconds: { treatment: secs("treatment"), neutral: secs("neutral"), noMutation: secs("noMutation") }, wallSecondsThisInvocation: Math.round((performance.now() - t00) / 1000) },
    uptime: { start: uptimeStart, end: uptime() },
  };
  await writeAtomic(a.out, JSON.stringify(record, null, 1) + "\n");
  console.log(`wrote ${a.out}${record.partial ? " (PARTIAL)" : ""}; ${record.uptime.end}`);
}

if (import.meta.main) {
  if (cmd === "pilot") await pilot();
  else if (cmd === "all") await all();
  else {
    console.error("usage: deno run -A tools/clade.ts pilot | all --cadence 1|10 --cache FILE [--base D] [--out F] [--cap-hours H]");
    Deno.exit(2);
  }
}
