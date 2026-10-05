// Recurrence readout (docs/plan.md, "Recurrence readout (fixed 2026-09-30, before computing)"):
// after a role's first qualifying window, do later windows keep appearing (a role that returns after
// >= 1e5 steps below 5%, or a new founder clade holding a role already filled)? CPU only; no GPU, no
// new runs. Streams profiles.tsv, mutations.tsv and genomes.tsv per run; one run is in memory at a time.
//
//   deno run -A tools/recurrence-x.ts runs    [--family b,c,solo,diag] [--force]
//       Per-run records under --cache (default runs/foundations/results/recurrence/).
//   deno run -A tools/recurrence-x.ts summary [--out experiments/foundations/fr-v2.json]
//       Strata, comparisons and the pre-stated reading, from the per-run records; refuses incomplete inputs
//       (writes { complete: false, problems }). Never point --out at the recorded experiments/foundations/fr.json.
//   deno run -A tools/recurrence-x.ts         (both; never the -m4 subcommands)
//
// The registered worlds (docs/plan.md, "Recurrence on the registered worlds (fixed 2026-10-01, before computing)"):
//   deno run -A tools/recurrence-x.ts runs-m4 [--base runs] [--cache-m4 runs/foundations/results/recurrence-m4] [--force]
//       M4 replays (35 runs x 4 role variants, from profiles.tsv + mutations.tsv + genomes.tsv) and the 10^7 extension
//       (15 runs, role shares from series.jsonl) read under <base>/replay-m4/gradient-m3 and <base>/m4-ext/gradient-m3.
//   deno run -A tools/recurrence-x.ts summary-m4 [--cache-m4 ...] [--out-m4 experiments/foundations/fr-m4.json]
//       Readings from the 155 records; refuses incomplete inputs. Never writes --out (fr-v2.json).
//
// Definitions and the reading rule are fixed in docs/plan.md before this was run; logic in tools/lib/recurrence.ts.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { parentMap, rootWalker } from "./lib/clade.ts";
import {
  EXPECTED_GROUPS,
  EXT_EXPOSURE_1E5,
  EXT_RUNS,
  EXT_SEED0,
  EXT_STEPS,
  M4_RUNS,
  M4_STEPS,
  RECURRENCE_RECORD_VERSION,
  ROLES,
  ROLE_VARIANTS,
  bootstrapDiffInDiff,
  bootstrapMean,
  bootstrapPairedDiffInDiff,
  censusFromSeriesLine,
  censusesFrom,
  cladeOfRoots,
  completenessProblems,
  eventsByRole,
  extStatement,
  groupOf,
  m4CompletenessProblems,
  mean,
  overallReading,
  readRun,
  returnProfile,
  spacing,
  summariseStratum,
  variantRole,
  withoutRoleEvents,
  type Census,
  type LegacyFamily,
  type RoleVariant,
  type RunRecord,
  type StratumRow,
} from "./lib/recurrence.ts";

const a = parseArgs(Deno.args, {
  string: ["cache", "out", "family", "base", "cache-m4", "out-m4"],
  boolean: ["force"],
  default: {
    cache: "runs/foundations/results/recurrence",
    out: "experiments/foundations/fr-v2.json",
    family: "b,c,solo,diag",
    base: "runs",
    "cache-m4": "runs/foundations/results/recurrence-m4",
    "out-m4": "experiments/foundations/fr-m4.json",
  },
});
const cmd = String(a._[0] ?? "all");

const exists = async (p: string) => {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
};

/** Lines of a text file, streamed. */
async function* lines(path: string): AsyncGenerator<string> {
  const file = await Deno.open(path);
  let pending = "";
  for await (const chunk of file.readable.pipeThrough(new TextDecoderStream())) {
    const parts = (pending + chunk).split("\n");
    pending = parts.pop()!;
    for (const p of parts) yield p;
  }
  if (pending) yield pending;
}
/** Rows of a TSV with a header, as objects of strings. */
async function* tsv(path: string): AsyncGenerator<Record<string, string>> {
  let head: string[] | null = null;
  for await (const l of lines(path)) {
    if (!l) continue;
    const f = l.split("\t");
    if (!head) {
      head = f;
      continue;
    }
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = f[i]));
    yield o;
  }
}

// ---------------------------------------------------------------------------------------------
// Per run.

/** FNV-1a-style 53-bit hash, hex: a short label for a founder genome. */
function label(words: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < words.length; i++) {
    const c = words.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

async function analyseRun(dir: string, id: { family: RunRecord["family"]; group: string; mutation: boolean }, manifest: any): Promise<RunRecord> {
  const rootOf = rootWalker(await parentMap(lines(`${dir}/mutations.tsv`)));
  const dc = await censusesFrom(tsv(`${dir}/profiles.tsv`) as any, rootOf);
  if (!dc.length) throw new Error(`${dir}: profiles.tsv is empty`);
  // Founder genome per root lineage (clones from different discs share a clade when their genomes are identical).
  const roots = new Set<string>();
  for (const c of dc) for (const m of Object.values(c.byRole)) for (const k of m.keys()) roots.add(k);
  const genome = new Map<string, string>();
  for await (const r of tsv(`${dir}/genomes.tsv`)) if (roots.has(r.lineage)) genome.set(r.lineage, label(r.words));
  const { windows, ...readout } = readRun(dc, cladeOfRoots(roots, genome, dir));
  return {
    version: RECURRENCE_RECORD_VERSION,
    id: `${id.family}-${manifest.spec.seed}`,
    family: id.family,
    group: id.group,
    mutation: id.mutation,
    seed: manifest.spec.seed,
    extinct: !!manifest.summary.extinct,
    steps: manifest.summary.steps ?? manifest.spec.steps,
    spacing: spacing(dc),
    readout,
    windows,
  };
}

const ROOTS: Record<string, string[]> = {
  b: ["founders-x-b/gradient-m3"],
  c: ["founders-x-c/gradient-m3", "founders-x-c/gradient-m3-waste"],
  solo: ["solo/gradient-m3"],
  diag: ["founders-diag/gradient-m3"],
};

async function runsCmd() {
  await Deno.mkdir(a.cache, { recursive: true });
  const families = a.family.split(",").map((s) => s.trim()).filter(Boolean);
  let done = 0, skipped = 0, bad = 0;
  for (const fam of families) {
    for (const root of ROOTS[fam] ?? []) {
      for (const cond of ["treatment", "no-mutation"]) {
        const dir0 = `${a.base}/${root}/${cond}`;
        if (!(await exists(dir0))) continue;
        const entries: string[] = [];
        for await (const e of Deno.readDir(dir0)) if (e.isDirectory) entries.push(e.name);
        entries.sort();
        for (const name of entries) {
          const dir = `${dir0}/${name}`;
          const m = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
          if (!m.summary) continue;
          const g = groupOf({ experiment: m.spec.experiment, seed: m.spec.seed, soloFounder: m.spec.soloFounder });
          if (!g || g.mutation !== (cond === "treatment")) {
            console.error(`skip ${dir}: outside the plan layout`);
            bad++;
            continue;
          }
          const out = `${a.cache}/${g.family}-${m.spec.seed}.json`;
          if (!a.force && (await exists(out))) {
            skipped++;
            continue;
          }
          const t0 = performance.now();
          const rec = await analyseRun(dir, g, m);
          await Deno.writeTextFile(out, JSON.stringify(rec));
          done++;
          console.log(`${rec.id} ${g.group} ${cond} fills ${rec.readout.fillCount} post-fill ${rec.readout.postFill} (${rec.readout.returns} returns, ${rec.readout.replacements} replacements) clades ${rec.readout.clades} ${((performance.now() - t0) / 1000).toFixed(1)}s`);
        }
      }
    }
  }
  console.log(`runs: ${done} analysed, ${skipped} cached, ${bad} outside layout`);
}

// ---------------------------------------------------------------------------------------------
// Summary.

async function loadRecords(): Promise<RunRecord[]> {
  const out: RunRecord[] = [];
  for await (const e of Deno.readDir(a.cache)) if (e.isFile && e.name.endsWith(".json")) out.push(JSON.parse(await Deno.readTextFile(`${a.cache}/${e.name}`)));
  return out.sort((x, y) => (x.family < y.family ? -1 : x.family > y.family ? 1 : x.seed - y.seed));
}

const readJson = async (p: string) => JSON.parse(await Deno.readTextFile(p));

/**
 * Which sets count on the uniform garden. B and C come from the re-gardened experiments/foundations/fx-root.json
 * (each candidate against its own ancestor, plan 002); solo and diag from t3.json and fd.json (never hardcoded here).
 */
async function counting() {
  const fxRootPath = "experiments/foundations/fx-root.json";
  if (!(await exists(fxRootPath))) throw new Error(`${fxRootPath} is missing: run plan 002 first`);
  const fxRoot = await readJson(fxRootPath);
  if (fxRoot.uniform?.complete !== true) throw new Error(`${fxRootPath} uniform.complete is not true: run plan 002 first`);
  const fd = await readJson("experiments/foundations/fd.json");
  const t3 = await readJson("experiments/foundations/t3.json");
  const subjects = new Map<string, boolean>(fxRoot.uniform.perSubject.map((p: any) => [p.id as string, p.counts === true]));
  for (const id of [...EXPECTED_GROUPS.B, ...EXPECTED_GROUPS.C]) if (!subjects.has(id)) throw new Error(`${fxRootPath} has no subject ${id}: run plan 002 first`);
  return {
    B: new Set<string>(EXPECTED_GROUPS.B.filter((id) => subjects.get(id))),
    C: new Set<string>(EXPECTED_GROUPS.C.filter((id) => subjects.get(id))),
    solo: new Set<string>(t3.perFounder.filter((p: any) => p.counts).map((p: any) => `founder-${p.founder}`)),
    diag: new Set<string>(fd.uniform.perSubject.filter((p: any) => p.counts).map((p: any) => `subject-${p.subject}`)),
  };
}

function eventCounts(rs: RunRecord[]) {
  const out: Record<string, number> = {};
  for (const r of rs) for (const w of r.readout.events) out[`${w.role}:${w.kind}`] = (out[`${w.role}:${w.kind}`] ?? 0) + 1;
  return out;
}

/** inactiveShare of every mixed-role post-fill event (null: no mixed cells in the window). */
const mixedEventShares = (rs: RunRecord[]) => rs.flatMap((r) => r.readout.events.filter((e) => e.role === "mixed").map((e) => e.inactiveShare ?? null));

/** Mean of the per-run mixedInactiveShare, nulls skipped; null when no run has mixed cells. */
const meanInactive = (rs: RunRecord[]) => {
  const xs = rs.map((r) => r.readout.mixedInactiveShare).filter((x): x is number => x !== null && x !== undefined);
  return xs.length ? mean(xs) : null;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((p, q) => p - q), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function summaryCmd() {
  const recs = await loadRecords();
  if (!recs.length) throw new Error(`no per-run records under ${a.cache}; run the 'runs' subcommand first`);
  // Incomplete inputs decide nothing (docs/plan.md, fixed definitions).
  const problems = completenessProblems(recs);
  await Deno.mkdir(a.out.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  if (problems.length) {
    await Deno.writeTextFile(a.out, JSON.stringify({ complete: false, recordsFound: recs.length, problems }, null, 1));
    console.log(`wrote ${a.out}: INCOMPLETE, ${problems.length} problems over ${recs.length} records (no readings)`);
    for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
    if (problems.length > 20) console.log(`  ... and ${problems.length - 20} more`);
    return;
  }
  const cnt = await counting();
  const fam = (f: RunRecord["family"]) => recs.filter((r) => r.family === f);
  const inGroups = (f: RunRecord["family"], groups: Set<string>, want = true) => fam(f).filter((r) => groups.has(r.group) === want);
  const strata: { name: string; primary?: boolean; runs: RunRecord[] }[] = [
    { name: "C counting sets pooled (S1+S5), uniform garden", primary: true, runs: inGroups("C", cnt.C) },
    { name: "C non-counting sets pooled (S2+S4)", runs: inGroups("C", cnt.C, false) },
    { name: "C all four sets", runs: fam("C") },
    { name: "B clouds, all 12", runs: fam("B") },
    { name: "B counting clouds", runs: inGroups("B", cnt.B) },
    { name: "B non-counting clouds", runs: inGroups("B", cnt.B, false) },
    { name: "Solo point founders (test 3), all 12", runs: fam("solo") },
    { name: "Solo counting founders", runs: inGroups("solo", cnt.solo) },
    { name: "Diagnostic subjects, all 24", runs: fam("diag") },
    { name: "Diagnostic counting subjects", runs: inGroups("diag", cnt.diag) },
    { name: "Diagnostic non-counting subjects", runs: inGroups("diag", cnt.diag, false) },
  ];
  const rows = strata.map((s) => ({
    primary: !!s.primary,
    ...summariseStratum(s.name, s.runs),
    eventsByRoleKind: {
      mutation: eventCounts(s.runs.filter((r) => r.mutation)),
      noMutation: eventCounts(s.runs.filter((r) => !r.mutation)),
      mixedEventInactiveShares: { mutation: mixedEventShares(s.runs.filter((r) => r.mutation)), noMutation: mixedEventShares(s.runs.filter((r) => !r.mutation)) },
    },
    mixedInactiveShare: { mutation: meanInactive(s.runs.filter((r) => r.mutation)), noMutation: meanInactive(s.runs.filter((r) => !r.mutation)) },
  }));
  // Per set (finest grain).
  const setNames = [...new Set(recs.map((r) => `${r.family}:${r.group}`))].sort();
  const perSet: (StratumRow & { family: string; group: string; counts: boolean })[] = setNames.map((n) => {
    const [family, group] = n.split(":") as [LegacyFamily, string];
    const rs = recs.filter((r) => r.family === family && r.group === group);
    return { family, group, counts: cnt[family].has(group), ...summariseStratum(n, rs) };
  });
  // Comparisons (ii) and (iii).
  const arms = (rs: RunRecord[], f: (r: RunRecord) => number) => ({ mut: rs.filter((r) => r.mutation).map(f), nm: rs.filter((r) => !r.mutation).map(f) });
  const post = (r: RunRecord) => r.readout.postFill, ret = (r: RunRecord) => r.readout.returns;
  const cCount = inGroups("C", cnt.C), cNon = inGroups("C", cnt.C, false);
  const pairedGroups = EXPECTED_GROUPS.B.map((g) => ({ x: arms(fam("B").filter((r) => r.group === g), ret), y: arms(fam("solo").filter((r) => r.group === g), ret) }));
  const comparisons = {
    countingVsNonCountingC: {
      note: "(mutation - no-mutation) post-fill events per run in S1+S5 minus the same in S2+S4",
      diffInDiff: bootstrapDiffInDiff(arms(cCount, post), arms(cNon, post), 777),
    },
    cloudsVsPointFounders: {
      returnsPairedByFounder: {
        note: "comparison (iii) as fixed: returns only (replacement cannot exist for a point founder); per founder k, (B founder-k mutation - no-mutation) minus (solo founder-k mutation - no-mutation), averaged over the 12 founders; runs resampled within each of the four arms of each founder",
        diffInDiff: bootstrapPairedDiffInDiff(pairedGroups, 783),
      },
      returnsPooledLegacy: {
        note: "the first run's pooled form (all 12 founders pooled per arm); kept for comparison with fr.json, not the fixed comparison",
        diffInDiff: bootstrapDiffInDiff(arms(fam("B"), ret), arms(fam("solo"), ret), 778),
      },
      postFillPooledContextOnly: {
        note: "post-fill events (returns plus replacements), pooled; context only",
        diffInDiff: bootstrapDiffInDiff(arms(fam("B"), post), arms(fam("solo"), post), 779),
      },
      mutationArmReturns: { B: bootstrapMean(arms(fam("B"), ret).mut, 780), solo: bootstrapMean(arms(fam("solo"), ret).mut, 781), diag: bootstrapMean(arms(fam("diag"), ret).mut, 782) },
    },
  };
  const primary = rows.find((r) => r.primary)!;
  const countingRows = ["B counting clouds", "Solo counting founders", "Diagnostic counting subjects"].map((n) => rows.find((r) => r.stratum === n)!);
  const overall = overallReading(primary, countingRows);
  // Bar (c), two readings of "the strata above (clouds, point founders, S1/S5 pool)": all pooled strata, or the counting strata only.
  const pooled = new Set([primary.stratum, "B clouds, all 12", "Solo point founders (test 3), all 12", "Diagnostic subjects, all 24"]);
  const countingOnly = new Set([primary.stratum, ...countingRows.map((r) => r.stratum)]);
  const best = (rs: typeof rows) => rs.reduce((b, r) => (r.mutation.postFill.mean > b.mean ? { stratum: r.stratum, mean: r.mutation.postFill.mean, hi: r.mutation.postFill.hi } : b), { stratum: "", mean: -Infinity, hi: -Infinity });
  const maxMutationArm = best(rows.filter((r) => pooled.has(r.stratum)));
  const maxCountingMutationArm = best(rows.filter((r) => countingOnly.has(r.stratum)));
  const bestSingleSet = perSet.reduce((b, r) => (r.mutation.postFill.mean > b.mean ? { stratum: r.stratum, mean: r.mutation.postFill.mean, runsWithEvent: r.mutation.runsWithEvent } : b), { stratum: "", mean: -Infinity, runsWithEvent: 0 });
  const allRuns = recs.length;
  const allMixedEventShares = mixedEventShares(recs);
  const fr = {
    complete: true,
    recordVersion: RECURRENCE_RECORD_VERSION,
    note: "exploratory recurrence readout; definitions and the reading rule fixed in docs/plan.md ('Recurrence readout (fixed 2026-09-30, before computing)') before computing; descriptive, no significance claims. Hardened rerun: completeness-checked, counting strata from fx-root.json, early re-entries count every window k >= 2 before 2e5, comparison (iii) paired by founder, string lineage keys",
    tool: "tools/recurrence-x.ts + tools/lib/recurrence.ts",
    definitions: {
      window: "consecutive deep censuses (every 1,000 steps) with role share >= 5% spanning >= 1e5 steps",
      fill: "first window of a role in a run; atStart = begins at step 100; late = begins at step >= 2e5",
      postFillEvent: "window k>=2 starting at step >= 2e5 that is a return (gap from previous window >= 1e5 steps) or a replacement (gap < 1e5 and the holder clade has not held an earlier window of the role)",
      earlyReentry: "any window k>=2 (return, replacement or flicker) that starts before step 2e5; reported apart, never counted as an event",
      clade: "founder lineage reached by walking mutations.tsv parents (string keys, cycle-checked); clones with identical founder genomes share a clade",
      statistic: "events per run (and per 1e5 steps = / 8), percentile bootstrap over runs, 5000 resamples, 90% interval (5th-95th)",
      mixedInactive: "share of cells in rows classed mixed whose photo, grow and decomp fluxes are all 0 in the deep-census snapshot; descriptive, never used to relabel",
    },
    counting: { B: [...cnt.B], C: [...cnt.C], solo: [...cnt.solo], diag: [...cnt.diag].sort() },
    countingSource: { B: "experiments/foundations/fx-root.json", C: "experiments/foundations/fx-root.json", solo: "experiments/foundations/t3.json", diag: "experiments/foundations/fd.json" },
    runs: { total: allRuns, B: fam("B").length, C: fam("C").length, solo: fam("solo").length, diag: fam("diag").length, extinct: recs.filter((r) => r.extinct).length },
    primaryReading: { stratum: primary.stratum, reading: primary.reading, readingWithoutExtinct: primary.readingWithoutExtinct, diff: primary.diffPostFill },
    overallReading: overall,
    strata: rows,
    perSet,
    comparisons,
    mixedInactive: {
      note: "pooled over all runs",
      meanShareMutationRuns: meanInactive(recs.filter((r) => r.mutation)),
      meanShareNoMutationRuns: meanInactive(recs.filter((r) => !r.mutation)),
      mixedPostFillEvents: allMixedEventShares.length,
      medianEventInactiveShare: median(allMixedEventShares.filter((x): x is number => x !== null)),
    },
    barForStep1: {
      rule: "S6 shows more than one-shot filling only if (a) mutation-arm post-fill events per run exceed its no-mutation arm with the 90% interval of the difference excluding zero; (b) >= 3 of 5 mutation runs have >= 1 post-fill event; (c) the S6 mutation-arm mean exceeds the largest mutation-arm mean among the strata above (clouds, point founders, S1/S5 pool); (d) its producer-only and obligate-only mutation controls show fewer post-fill events per run than S6",
      largestPooledMutationArmMean: maxMutationArm,
      largestCountingMutationArmMean: maxCountingMutationArm,
      barCNote: "The fixed text names 'the strata above (clouds, point founders, S1/S5 pool)'; both readings of that phrase are reported; the operator chooses before S6 is read.",
      bestSingleSetForContext: bestSingleSet,
      noMutationArmMeanOfPrimary: primary.noMutation.postFill,
    },
  };
  await Deno.writeTextFile(a.out, JSON.stringify(fr, null, 1));
  console.log(`wrote ${a.out}`);
  const f = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "NA");
  const iv = (i: { mean: number; lo: number; hi: number }) => `${f(i.mean)} [${f(i.lo)}, ${f(i.hi)}]`;
  for (const r of rows) {
    console.log(`${r.primary ? "*" : " "} ${r.stratum.padEnd(50)} mut n=${r.mutation.runs} fills ${f(r.mutation.fills.mean)} late ${f(r.mutation.lateFills.mean)} post ${iv(r.mutation.postFill)} | nm n=${r.noMutation.runs} fills ${f(r.noMutation.fills.mean)} late ${f(r.noMutation.lateFills.mean)} post ${iv(r.noMutation.postFill)} | diff ${iv(r.diffPostFill)} -> ${r.reading}`);
  }
  console.log(`primary: ${primary.reading} (without extinct: ${primary.readingWithoutExtinct}); overall: ${overall.reading}${overall.disagree.length ? ` (disagree: ${overall.disagree.join("; ")})` : ""}${overall.empty.length ? ` (empty: ${overall.empty.join("; ")})` : ""}; mean over all runs ${f(mean(recs.map((r) => r.readout.postFill)))}`);
}

// ---------------------------------------------------------------------------------------------
// The registered worlds (plan 004): M4 replays and the 10^7 extension. CPU only; every file streamed.

/** Seed directories of a condition, checked against the expected seeds (a missing or surplus run stops the pass). */
async function seedDirs(dir: string, expected: number[]): Promise<void> {
  const got: number[] = [];
  for await (const e of Deno.readDir(dir)) {
    const m = e.isDirectory ? /^seed-(\d+)$/.exec(e.name) : null;
    if (m) got.push(+m[1]);
  }
  got.sort((p, q) => p - q);
  if (got.length !== expected.length || got.some((s, i) => s !== expected[i])) throw new Error(`${dir}: seeds [${got.join(",")}] (want ${expected[0]}..${expected.at(-1)})`);
}

/** Manifest of a registered run; throws unless it is the expected experiment, condition, seed and horizon. */
async function registeredManifest(dir: string, experiment: string, condition: string, seed: number, steps: number): Promise<any> {
  const m = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
  if (m.spec?.experiment !== experiment) throw new Error(`${dir}: experiment ${m.spec?.experiment} (want ${experiment})`);
  if (m.spec?.condition !== condition) throw new Error(`${dir}: condition ${m.spec?.condition} (want ${condition})`);
  if (m.spec?.seed !== seed) throw new Error(`${dir}: seed ${m.spec?.seed} (want ${seed})`);
  if (!m.summary || m.summary.steps !== steps) throw new Error(`${dir}: summary.steps ${m.summary?.steps} (want ${steps})`);
  return m;
}

/** Counts rows whose d0.6 role differs from the stored role column; throws on the first (the variants would not be comparable). */
const d06Check = { rows: 0, runs: 0 };
async function* assertD06(rows: AsyncIterable<Record<string, string>>, dir: string): AsyncGenerator<Record<string, string>> {
  const vr = variantRole("d0.6");
  for await (const r of rows) {
    const got = vr(r);
    if (got !== r.role) throw new Error(`${dir}: d0.6 role '${got}' differs from stored role '${r.role}' at step ${r.step}, lineage ${r.lineage} (photo ${r.photo}, grow ${r.grow}, decomp ${r.decomp})`);
    d06Check.rows++;
    yield r;
  }
  d06Check.runs++;
}

async function runsM4Cmd() {
  const cache = a["cache-m4"];
  await Deno.mkdir(cache, { recursive: true });
  let written = 0, cached = 0;
  const t00 = performance.now();
  // M4 replays: 35 runs x 4 role variants.
  for (const [cond, n] of Object.entries(M4_RUNS)) {
    const seeds = Array.from({ length: n }, (_, i) => i + 1);
    const dir0 = `${a.base}/replay-m4/gradient-m3/${cond}`;
    await seedDirs(dir0, seeds);
    for (const seed of seeds) {
      const dir = `${dir0}/seed-${seed}`;
      const m = await registeredManifest(dir, "replay-m4", cond, seed, M4_STEPS);
      const outOf = (v: RoleVariant) => `${cache}/m4r-${cond}-${seed}-${v}.json`;
      const todo: RoleVariant[] = [];
      for (const v of ROLE_VARIANTS) {
        if (!a.force && (await exists(outOf(v)))) cached++;
        else todo.push(v);
      }
      if (!todo.length) continue;
      const t0 = performance.now();
      const rootOf = rootWalker(await parentMap(lines(`${dir}/mutations.tsv`)));
      const dcs = new Map<RoleVariant, Census[]>();
      for (const v of todo) {
        const rows = v === "d0.6" ? assertD06(tsv(`${dir}/profiles.tsv`), dir) : tsv(`${dir}/profiles.tsv`);
        const dc = await censusesFrom(rows as any, rootOf, variantRole(v));
        if (!dc.length) throw new Error(`${dir}: profiles.tsv is empty`);
        dcs.set(v, dc);
      }
      // Founder genome per root lineage, for the roots any variant saw (clones with identical genomes share a clade, as in analyseRun).
      const roots = new Set<string>();
      for (const dc of dcs.values()) for (const c of dc) for (const mm of Object.values(c.byRole)) for (const k of mm.keys()) roots.add(k);
      const genome = new Map<string, string>();
      for await (const r of tsv(`${dir}/genomes.tsv`)) if (roots.has(r.lineage)) genome.set(r.lineage, label(r.words));
      const cladeOf = cladeOfRoots(roots, genome, dir);
      for (const v of todo) {
        const dc = dcs.get(v)!;
        const { windows, ...readout } = readRun(dc, cladeOf);
        const rec: RunRecord = {
          version: RECURRENCE_RECORD_VERSION,
          id: `m4r-${cond}-${seed}-${v}`,
          family: "m4r",
          group: cond,
          mutation: cond === "treatment",
          seed,
          extinct: !!m.summary.extinct,
          steps: m.summary.steps,
          spacing: spacing(dc),
          readout,
          windows,
          condition: cond,
          variant: v,
        };
        await Deno.writeTextFile(outOf(v), JSON.stringify(rec));
        written++;
        console.log(`${rec.id} fills ${readout.fillCount} post-fill ${readout.postFill} (${readout.returns} returns, ${readout.replacements} replacements) clades ${readout.clades} mixedInactive ${readout.mixedInactiveShare === null ? "NA" : readout.mixedInactiveShare.toFixed(3)}`);
      }
      console.log(`  ${dir}: ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    }
  }
  // 10^7 extension: 15 runs, role shares from series.jsonl.
  for (const cond of Object.keys(M4_RUNS)) {
    const seeds = Array.from({ length: EXT_RUNS }, (_, i) => EXT_SEED0 + i);
    const dir0 = `${a.base}/m4-ext/gradient-m3/${cond}`;
    await seedDirs(dir0, seeds);
    for (const seed of seeds) {
      const out = `${cache}/ext-${cond}-${seed}.json`;
      if (!a.force && (await exists(out))) {
        cached++;
        continue;
      }
      const dir = `${dir0}/seed-${seed}`;
      const m = await registeredManifest(dir, "m4-ext", cond, seed, EXT_STEPS);
      const t0 = performance.now();
      const dc: Census[] = [];
      for await (const l of lines(`${dir}/series.jsonl`)) {
        if (!l) continue;
        const c = censusFromSeriesLine(JSON.parse(l));
        if (c) dc.push(c);
      }
      if (!dc.length) throw new Error(`${dir}: series.jsonl has no census with role shares`);
      const { windows, ...readout } = readRun(dc, () => "all");
      const rec: RunRecord = {
        version: RECURRENCE_RECORD_VERSION,
        id: `ext-${cond}-${seed}`,
        family: "ext",
        group: cond,
        mutation: cond === "treatment",
        seed,
        extinct: !!m.summary.extinct,
        steps: m.summary.steps,
        spacing: spacing(dc),
        readout,
        windows,
        condition: cond,
        variant: "shares",
        profile: returnProfile(readout.events, 1_000_000, 10, 5_000_000),
      };
      await Deno.writeTextFile(out, JSON.stringify(rec));
      written++;
      console.log(`${rec.id} fills ${readout.fillCount} returns ${readout.returns} per-block [${rec.profile!.perBlock.join(",")}] late ${rec.profile!.late} (${dc.length} deep censuses, ${((performance.now() - t0) / 1000).toFixed(1)}s)`);
    }
  }
  console.log(`d0.6 role assertion: ${d06Check.rows} rows over ${d06Check.runs} runs, 0 mismatches`);
  console.log(`runs-m4: ${written} written, ${cached} cached (${((performance.now() - t00) / 1000).toFixed(0)}s)`);
}

async function loadM4Records(): Promise<RunRecord[]> {
  const out: RunRecord[] = [];
  for await (const e of Deno.readDir(a["cache-m4"])) if (e.isFile && e.name.endsWith(".json")) out.push(JSON.parse(await Deno.readTextFile(`${a["cache-m4"]}/${e.name}`)));
  return out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

async function summaryM4Cmd() {
  const recs = await loadM4Records();
  if (!recs.length) throw new Error(`no per-run records under ${a["cache-m4"]}; run the 'runs-m4' subcommand first`);
  const outPath = a["out-m4"];
  const problems = m4CompletenessProblems(recs);
  await Deno.mkdir(outPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  if (problems.length) {
    await Deno.writeTextFile(outPath, JSON.stringify({ complete: false, recordsFound: recs.length, problems }, null, 1));
    console.log(`wrote ${outPath}: INCOMPLETE, ${problems.length} problems over ${recs.length} records (no readings)`);
    for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
    if (problems.length > 20) console.log(`  ... and ${problems.length - 20} more`);
    return;
  }
  const m4 = (cond: string, v: RoleVariant) => recs.filter((r) => r.family === "m4r" && r.condition === cond && r.variant === v);
  const ext = (cond: string) => recs.filter((r) => r.family === "ext" && r.condition === cond);
  const asMutation = (rs: RunRecord[]) => rs.map((r) => ({ ...r, mutation: true }));
  // 1. M4 replays, per variant: treatment against no-mutation, and the neutral replays against the same no-mutation runs as the null.
  const byVariant = ROLE_VARIANTS.map((v) => {
    const tr = m4("treatment", v), nm = m4("no-mutation", v), ne = m4("neutral", v);
    const main = summariseStratum(`m4 ${v}`, [...tr, ...nm]);
    const nullRow = summariseStratum(`m4 neutral ${v}`, [...asMutation(ne), ...nm]);
    return {
      variant: v,
      reading: main.reading,
      diffPostFill: main.diffPostFill,
      diffReturns: main.diffReturns,
      nullReading: nullRow.reading,
      nullDiffPostFill: nullRow.diffPostFill,
      nullDiffReturns: nullRow.diffReturns,
      mixedInactiveShare: { treatment: meanInactive(tr), noMutation: meanInactive(nm), neutral: meanInactive(ne) },
      main,
      null: nullRow,
      // Added after the fixed reading was seen (plan 004 review): descriptive context only.
      eventsByRole: { treatment: eventsByRole(tr), "no-mutation": eventsByRole(nm), neutral: eventsByRole(ne) },
    };
  });
  const robustness = new Set(byVariant.map((v) => v.reading)).size === 1 ? "robust" : "threshold-sensitive";
  const d06 = byVariant.find((v) => v.variant === "d0.6")!;
  const specificity = d06.nullReading === "recurring" ? "not specific" : "specific";
  // 2. The 10^7 extension: only returns exist (one pseudo-clade), so post-fill events equal returns.
  const extAll = recs.filter((r) => r.family === "ext");
  if (extAll.some((r) => r.readout.replacements !== 0 || r.readout.postFill !== r.readout.returns)) throw new Error("extension record with replacements: the single pseudo-clade cannot produce them");
  const { perE5: _perE5, ...extRow } = summariseStratum("ext", [...ext("treatment"), ...ext("no-mutation")]);
  const { perE5: _perE5Null, ...extNullRow } = summariseStratum("ext neutral", [...asMutation(ext("neutral")), ...ext("no-mutation")]);
  const extReading = extRow.reading;
  const extNullReading = extNullRow.reading;
  const extSpecificity = extNullReading === "recurring" ? "not specific" : "specific";
  const statement = extStatement(extReading, extNullReading);
  const perCondition = Object.fromEntries(
    Object.keys(M4_RUNS).map((cond) => {
      const rs = ext(cond);
      const returns = mean(rs.map((r) => r.readout.returns));
      return [cond, { runs: rs.length, meanReturns: returns, returnsPerE5: returns / EXT_EXPOSURE_1E5, perBlockMean: Array.from({ length: 10 }, (_, b) => mean(rs.map((r) => r.profile!.perBlock[b]))), lateMean: mean(rs.map((r) => r.profile!.late)) }];
    }),
  );
  const pick = (k: "perBlockMean" | "lateMean") => Object.fromEntries(Object.entries(perCondition).map(([c, v]) => [c, v[k]]));
  // Descriptive breakdown added after the fixed reading was seen: returns by role, and the same treatment-vs-no-mutation row without mixed-role events.
  const returnsByRole = Object.fromEntries(Object.keys(M4_RUNS).map((cond) => [cond, eventsByRole(ext(cond), "return")]));
  const noMixedTreatment = ext("treatment").map((r) => withoutRoleEvents(r, "mixed"));
  const noMixedRow = summariseStratum("ext excluding mixed", [...noMixedTreatment, ...ext("no-mutation").map((r) => withoutRoleEvents(r, "mixed"))]);
  const postHocExcludingMixed = {
    note: "post hoc, computed after the fixed reading was seen; context only; the fixed reading and statement above stand",
    treatmentReturnsPerRun: [...noMixedTreatment].sort((p, q) => p.seed - q.seed).map((r) => ({ seed: r.seed, returns: r.readout.returns })),
    treatmentReturns: noMixedRow.mutation.returns,
    noMutationReturns: noMixedRow.noMutation.returns,
    diffReturns: noMixedRow.diffReturns,
    reading: noMixedRow.reading,
  };
  const fr = {
    note: "exploratory recurrence readout on the registered worlds (M4 replays and the 10^7 extension); definitions and the reading rule fixed in docs/plan.md ('Recurrence on the registered worlds (fixed 2026-10-01, before computing)') before computing; descriptive, no significance claims",
    complete: true,
    recordVersion: RECURRENCE_RECORD_VERSION,
    tool: "tools/recurrence-x.ts (runs-m4, summary-m4) + tools/lib/recurrence.ts",
    definitions: {
      windowsFillsReturnsReplacements: "as fixed in docs/plan.md for the recurrence readout: windows of consecutive deep censuses with role share >= 5% spanning >= 1e5 steps; a return is a window k>=2 after a gap >= 1e5 steps, a replacement a window after a shorter gap held by a clade that has not held an earlier window of the role; events count from windows starting at step >= 2e5",
      m4: "profiles.tsv deep censuses every 1,000 steps; clades from mutations.tsv roots and founder genomes; 10 treatment against 5 no-mutation, 20 neutral replays against the same no-mutation runs as the null",
      m4Variants: "role recomputed from profiles.tsv photo/grow/decomp fluxes with classify at dominance 0.5, 0.6 or 0.7; d0.6-noinactive counts zero-flux rows in the living total but in no role; d0.6 is asserted equal to the stored role column on every row",
      ext: "series.jsonl role shares at every deep census (every 1,000 steps, steps 100 .. 9,999,100); one pseudo-clade, so only returns; seeds 101-105 per condition; returns per 1e5 steps = mean returns / 98",
      robustness: "robust if the treatment reading is the same under all four variants, otherwise threshold-sensitive",
      specificity: "specific unless the neutral null reads recurring (M4: on variant d0.6)",
    },
    runs: { total: recs.length, m4: recs.filter((r) => r.family === "m4r").length, ext: extAll.length, extinct: recs.filter((r) => r.extinct).length },
    m4: { byVariant, robustness, specificity, specificityByVariant: Object.fromEntries(byVariant.map((v) => [v.variant, v.nullReading === "recurring" ? "not specific" : "specific"])) },
    ext: {
      reading: extReading,
      diffReturns: extRow.diffReturns,
      null: { reading: extNullReading, diffReturns: extNullRow.diffReturns },
      specificity: extSpecificity,
      perBlockMean: pick("perBlockMean"),
      lateMean: pick("lateMean"),
      statement,
      perCondition,
      row: extRow,
      nullRow: extNullRow,
      returnsByRole,
      postHocExcludingMixed,
    },
  };
  await Deno.writeTextFile(outPath, JSON.stringify(fr, null, 1));
  console.log(`wrote ${outPath}`);
  const f = (x: number | null) => (x !== null && Number.isFinite(x) ? x.toFixed(2) : "NA");
  const iv = (i: { mean: number; lo: number; hi: number }) => `${f(i.mean)} [${f(i.lo)}, ${f(i.hi)}]`;
  for (const v of byVariant) {
    console.log(`m4 ${v.variant.padEnd(16)} treatment ${iv(v.main.mutation.postFill)} vs no-mutation ${iv(v.main.noMutation.postFill)} diff ${iv(v.diffPostFill)} (returns ${iv(v.diffReturns)}) -> ${v.reading} | null ${iv(v.nullDiffPostFill)} -> ${v.nullReading} | mixedInactive tr ${f(v.mixedInactiveShare.treatment)} nm ${f(v.mixedInactiveShare.noMutation)} ne ${f(v.mixedInactiveShare.neutral)}`);
  }
  console.log(`m4: ${robustness}; ${specificity}`);
  console.log(`ext: treatment ${iv(extRow.mutation.returns)} vs no-mutation ${iv(extRow.noMutation.returns)} diff ${iv(extRow.diffReturns)} -> ${extReading} | neutral null -> ${extNullReading} (${extSpecificity}); ${statement}`);
  for (const [c, v] of Object.entries(perCondition)) console.log(`  ${c.padEnd(12)} returns ${f(v.meanReturns)} (${f(v.returnsPerE5)} per 1e5) per-block [${v.perBlockMean.map(f).join(", ")}] late ${f(v.lateMean)}`);
  for (const [c, v] of Object.entries(returnsByRole)) console.log(`  ${c.padEnd(12)} returns by role ${ROLES.map((r) => `${r} ${v.total[r]}`).join(", ")}; per run ${v.perRun.map((p) => `${p.seed}: ${ROLES.map((r) => p[r]).join("/")}`).join("  ")}`);
  console.log(`ext post hoc excluding mixed: treatment per run [${postHocExcludingMixed.treatmentReturnsPerRun.map((p) => p.returns).join(", ")}] diff ${iv(postHocExcludingMixed.diffReturns)} -> ${postHocExcludingMixed.reading}`);
}

if (import.meta.main) {
  if (cmd === "runs" || cmd === "all") await runsCmd();
  if (cmd === "summary" || cmd === "all") await summaryCmd();
  if (cmd === "runs-m4") await runsM4Cmd();
  if (cmd === "summary-m4") await summaryM4Cmd();
  if (!["runs", "summary", "all", "runs-m4", "summary-m4"].includes(cmd)) throw new Error(`unknown subcommand '${cmd}' (want runs | summary | runs-m4 | summary-m4)`);
}
