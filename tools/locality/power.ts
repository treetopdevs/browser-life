/**
 * I05b controller-locality power-up. CPU only, no GPU. Exploratory; see docs/controller-locality-power-2026-11-02/AMENDMENT.md.
 *   deno run -A --no-lock tools/locality/power.ts --calibrate            baseline-only timing (median of 3); assays no mutant; writes nothing
 *   deno run -A --no-lock tools/locality/power.ts --freeze [--dry]       choose N, allocation, assay set; write freeze.json (once; --dry prints only)
 *   deno run -A --no-lock tools/locality/power.ts --freeze-check         recompute freeze.json without any mutant assay and require equality
 *   deno run -A --no-lock tools/locality/power.ts --write [--workers n]  assay exactly the frozen set once; write evidence.json and manifest.json
 *   deno run -A --no-lock tools/locality/power.ts --check                validate the saved artifacts without simulating
 *   deno run -A --no-lock tools/locality/power.ts --replay-check [--workers n]   regenerate the payload and require byte equality
 * Serial is the reference path. The worker pool of PLAN 3.3 is built only if the serial projection exceeds the budget; it did not,
 * so `--workers n` is accepted, recorded and has no effect.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { EVIDENCE as PR136_EVIDENCE, REPO, canonical, checkSaved, makeManifest, serialize, sha256, sourceFiles, sourceHashes, verifySeal, type CheckOptions } from "./matrix.ts";

const lib = await import("@bl/lineage");
type Payload = import("@bl/lineage").Payload;
type Panel = import("@bl/lineage").Panel;
type Allocation = import("@bl/lineage").Allocation;

export const POWER_DIR = `${REPO}docs/controller-locality-power-2026-11-02/`;
export const FREEZE = `${POWER_DIR}freeze.json`;
export const POWER_EVIDENCE = `${POWER_DIR}evidence.json`;
export const POWER_MANIFEST = `${POWER_DIR}manifest.json`;
export const AMENDMENT = `${POWER_DIR}AMENDMENT.md`;
export const EXTRA_SOURCES = ["tools/locality/power.ts"] as const;
export const BRANCH = "claude/i05-power";

/** Budget (seconds) of the full run on a loaded machine, and the two candidate sizes, in the order the rule tries them. */
export const BUDGET_SECONDS = 20 * 60;
export const CANDIDATE_N = [192, 144] as const;
/** Fixture runs and slack added to the projected number of simulation runs. */
const FIXTURE_AND_SLACK_RUNS = 100;

// ---- Inputs -------------------------------------------------------------------------------------------------

/** PR136's genome hashes per start genome (every edit it generated, assayed or not) and the assayed ones. */
export function earlierHashes(pr136Path = PR136_EVIDENCE): { all: Record<string, string[]>; assayed: Record<string, string[]>; seeds: number[]; salt: number } {
  const p = JSON.parse(readFileSync(pr136Path, "utf8")) as Payload;
  const all: Record<string, string[]> = {}, assayed: Record<string, string[]> = {};
  for (const r of p.rows) {
    (all[r.genome] ??= []).push(r.hash);
    if (r.assay) (assayed[r.genome] ??= []).push(r.hash);
  }
  for (const m of [all, assayed]) for (const k of Object.keys(m)) m[k] = [...new Set(m[k])].sort();
  const proto = p.protocol as { assay: { seeds: number[] }; neighbourhood: { salt: number } };
  return { all, assayed, seeds: proto.assay.seeds, salt: proto.neighbourhood.salt };
}

// ---- Calibration (baseline only) -------------------------------------------------------------------------------

const median = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

export interface Calibration {
  note: string;
  repetitions: number;
  baselineRuns: number;
  /** Mutant assays performed by the calibration. Always 0: it has no code path that assays an edited genome. */
  mutantAssays: number;
  secondsPerRunMedian: number;
  secondsPerProbeMedian: number;
}

/** Baseline-only workload: the start-genome baseline assays of the generalist, M3 c4 and M3 c9 under both seed pairs, and one probe of each. */
export function calibrate(repetitions = 3): Calibration {
  const starts = [lib.generalistStart(), lib.m3Start(4, "m3-sparse"), lib.m3Start(9, "m3-dense")];
  const pairs: readonly (readonly number[])[] = [lib.ASSAY.seeds, lib.POWER_SEEDS];
  const runT: number[] = [], probeT: number[] = [];
  let runs = 0;
  for (let r = 0; r < repetitions; r++) {
    const cache = new lib.AssayCache();
    const t0 = performance.now();
    for (const s of starts) for (const seeds of pairs) lib.baselineOf(cache, s.words, seeds);
    runT.push((performance.now() - t0) / 1000 / cache.runs);
    runs = cache.runs;
    const t1 = performance.now();
    for (const s of starts) lib.probeGenome(s.words);
    probeT.push((performance.now() - t1) / 1000 / starts.length);
  }
  return { note: "timing is provenance, not part of any deterministic payload", repetitions, baselineRuns: runs, mutantAssays: 0, secondsPerRunMedian: median(runT), secondsPerProbeMedian: median(probeT) };
}

export interface Workload { assayRuns: number; probes: number }
/** Projected seconds of the whole run: simulation runs plus controller probes, from counted work and the calibration. */
export const projectedSeconds = (w: Workload, c: Calibration): number => w.assayRuns * c.secondsPerRunMedian + w.probes * c.secondsPerProbeMedian;
/** The deterministic N rule: the first candidate within budget, else null (stop and report without running; no third N). */
export function chooseN(projected: Record<number, number>): number | null {
  for (const n of CANDIDATE_N) if (projected[n] <= BUDGET_SECONDS) return n;
  return null;
}

// ---- Freeze --------------------------------------------------------------------------------------------------

export interface GenomePlan {
  id: string;
  votes: boolean;
  /** Genuine non-duplicate edits per stratum: all generated, and eligible (not in the earlier panel). */
  generated: Record<string, number>;
  eligible: Record<string, number>;
  allocation: Allocation;
  chosen: [string, string][];
  /** Outcome-free upper bound of the median breadth (doubled) of genuine single-locus w1/b1 edits: the wiring bound popcount(structActuators). */
  breadthUpperBound2: number;
  entanglementReachable: boolean;
}

export interface Freeze {
  kind: "controller-locality-power-freeze";
  version: 1;
  statement: string;
  n: number;
  /** The allocation the rule gives at each candidate size, per M3 genome (the amendment prints these). */
  allocations: Record<string, Record<string, Allocation>>;
  panel: Panel;
  genomes: import("@bl/lineage").GenomeRecord[];
  candidates: import("@bl/lineage").CandidateRecord[];
  plans: GenomePlan[];
  fixtureInventory: string[];
  workload: Record<string, Workload>;
  projectedSeconds: Record<string, number>;
  calibration: Calibration;
  baselineAssayRuns: number;
  inputs: { pr136EvidenceSha256: string; amendmentSha256: string };
  sources: Record<string, string>;
  integritySha256?: string;
}

const median2 = (a: number[]): number => lib.median2(a);

/** Everything the run needs, computed without assaying any edited genome. `n` forces a size (tests, --dry); otherwise the rule picks it. */
export function planFreeze(calibration: Calibration, forceN?: number, say: (m: string) => void = () => {}, testPanel?: { salt: number; seeds: readonly number[]; extraExclude?: Record<string, string[]> }): Freeze {
  const earlier = earlierHashes();
  if (testPanel?.extraExclude) for (const [k, v] of Object.entries(testPanel.extraExclude)) earlier.all[k] = [...new Set([...(earlier.all[k] ?? []), ...v])].sort();
  const cache = new lib.AssayCache();
  // `testPanel` (the reduced-payload test only) swaps in a different draw salt and seeds, so that test never assays an edit of the real panel.
  const nbParams = testPanel ? { ...lib.POWER_NB, salt: testPanel.salt } : lib.POWER_NB;
  const mk = (alloc: Record<string, Allocation>) => { const pn = lib.powerPanel(earlier.all, alloc); return testPanel ? { ...pn, id: "power-reduced-test", nb: nbParams, seeds: testPanel.seeds } : pn; };
  const qualPanel = mk({});
  const q = lib.qualifyStarts(qualPanel, cache, say);
  const baselineAssayRuns = cache.runs;
  const starts = [q.gen, ...q.chosenStarts];
  const nbs = new Map<string, import("@bl/lineage").Neighbourhood>();
  const pools = new Map<string, { generated: Record<string, number>; eligible: Record<string, number> }>();
  const workload: Record<string, Workload> = {};
  for (const s of starts) {
    const nb = lib.buildNeighbourhood(s.words, s.id, undefined, nbParams);
    nbs.set(s.id, nb);
    const ex = lib.excludeSet(qualPanel, s.id);
    const { generated, byStratum } = lib.strataPools(nb, ex);
    pools.set(s.id, { generated, eligible: Object.fromEntries([...byStratum].map(([k, v]) => [k, v.length])) });
  }
  const probeCount = (): number => starts.reduce((a, s) => a + nbs.get(s.id)!.edits.length + lib.RULE.nullReplicates * nbs.get(s.id)!.edits.filter((e) => e.k === 1 && (e.kind === "w1" || e.kind === "b1")).length, 0);
  const allocations: Freeze["allocations"] = {};
  const projected: Record<string, number> = {};
  const projectedByN: Record<number, number> = {};
  const sizes: number[] = [...CANDIDATE_N];
  if (forceN !== undefined && !sizes.includes(forceN)) sizes.push(forceN); // tests: a reduced panel gets its own allocation, never an empty one
  for (const n of sizes) {
    let mutants = 0;
    for (const s of starts) {
      if (s.role === "control") { mutants += Object.values(lib.POWER_ALLOC_CONTROL).reduce((a, b) => a + b, 0); continue; }
      const al = lib.deriveAllocation(n, pools.get(s.id)!.eligible);
      (allocations[s.id] ??= {})[String(n)] = al;
      mutants += n;
    }
    workload[String(n)] = { assayRuns: mutants * lib.SCENARIO_IDS.length * lib.ASSAY.seeds.length + baselineAssayRuns + FIXTURE_AND_SLACK_RUNS, probes: probeCount() };
    projected[String(n)] = Math.round(projectedSeconds(workload[String(n)], calibration));
    projectedByN[n] = projected[String(n)];
  }
  const n = forceN ?? chooseN(projectedByN);
  if (n === null) throw new Error(`projected ${JSON.stringify(projected)} s exceeds the ${BUDGET_SECONDS} s budget at every size: stop and report without running`);
  const allocByGenome: Record<string, Allocation> = {};
  for (const s of q.chosenStarts) allocByGenome[s.id] = allocations[s.id][String(n)];
  const panel = mk(allocByGenome);
  const plans: GenomePlan[] = starts.map((s) => {
    const nb = nbs.get(s.id)!;
    const alloc = lib.allocFor(panel, s.id, s.role === "control");
    const { chosen } = lib.drawAssaySubset(nb, alloc, panel.nb.salt, lib.excludeSet(panel, s.id));
    const wb = nb.edits.filter((e) => e.cls === "genuine" && e.k === 1 && (e.kind === "w1" || e.kind === "b1"));
    const bound = wb.map((e) => {
      const i = nb.edits.indexOf(e);
      return lib.popcount(lib.structuralReach(s.words, e.slots.map((x) => x.slot)).actuators | lib.structuralReach(nb.words[i], e.slots.map((x) => x.slot)).actuators);
    });
    const bound2 = median2(bound);
    const rec = q.genomes.find((g) => g.id === s.id)!;
    return {
      id: s.id, votes: rec.votes, generated: pools.get(s.id)!.generated, eligible: pools.get(s.id)!.eligible, allocation: alloc,
      chosen: chosen.map((i): [string, string] => [nb.edits[i].id, nb.edits[i].hash]),
      breadthUpperBound2: bound2,
      entanglementReachable: rec.votes ? bound2 >= 2 * lib.RULE.entanglement.minMedianBreadthActuators : false,
    };
  });
  for (const p of plans) {
    const have = Object.values(p.allocation).reduce((a, b) => a + b, 0), got = p.chosen.length;
    if (have !== got) throw new Error(`${p.id}: drew ${got} edits for an allocation of ${have}`);
  }
  const fixtureInventory = ["generalist-hidden-permutation", "generalist-dead-hidden-edit", "generalist-clamp-edit", "generalist-shuffled-sensor-labels", "generalist-localised-edit", ...q.chosenStarts.filter((s) => lib.widestPermutation(s.words) !== null).map((s) => `${s.id}-hidden-permutation`)];
  const freeze: Freeze = {
    kind: "controller-locality-power-freeze", version: 1,
    statement: "Written before any edited genome of this panel was assayed. Baselines only: no mutant outcome exists when this file is made.",
    n, allocations, panel, genomes: q.genomes, candidates: q.candidates, plans, fixtureInventory, workload, projectedSeconds: projected, calibration, baselineAssayRuns,
    inputs: { pr136EvidenceSha256: sha256(readFileSync(PR136_EVIDENCE)), amendmentSha256: existsSync(AMENDMENT) ? sha256(readFileSync(AMENDMENT)) : "absent" },
    sources: sourceHashes(EXTRA_SOURCES),
  };
  return freeze;
}

export const sealFreeze = (f: Freeze): Freeze => { const { integritySha256: _d, ...rest } = f; return { ...rest, integritySha256: sha256(canonical(rest)) }; };
export const verifyFreezeSeal = (f: Freeze): boolean => { const { integritySha256, ...rest } = f; return integritySha256 === sha256(canonical(rest)); };
export const readFreeze = (path = FREEZE): Freeze => JSON.parse(readFileSync(path, "utf8")) as Freeze;

/** Recompute the freeze from scratch (no mutant assay) and compare to the saved one, ignoring only the timing provenance. */
export function freezeCheck(path = FREEZE): string[] {
  if (!existsSync(path)) return ["freeze.json is missing"];
  const saved = readFreeze(path);
  const out: string[] = [];
  if (!verifyFreezeSeal(saved)) out.push("freeze integritySha256 does not match");
  const again = planFreeze(saved.calibration, saved.n);
  const strip = (f: Freeze) => { const { integritySha256: _s, ...r } = f; return r; };
  if (canonical(strip(sealFreeze(again))) !== canonical(strip(saved))) out.push("recomputed freeze differs from freeze.json");
  if (!CANDIDATE_N.includes(saved.n as 192 | 144)) out.push(`N ${saved.n} is not one of the two pre-stated sizes`);
  if (chooseN(Object.fromEntries(Object.entries(saved.projectedSeconds).map(([k, v]) => [Number(k), v]))) !== saved.n) out.push("N does not follow from the projected times by the stated rule");
  return out;
}

// ---- Git guards ----------------------------------------------------------------------------------------------

const git = (args: string[]): string => execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
export function committedProblems(paths: readonly string[], requirePushed: boolean): string[] {
  const out: string[] = [];
  for (const p of paths) {
    try { git(["ls-files", "--error-unmatch", p]); } catch { out.push(`${p} is not tracked by git`); continue; }
    try { git(["diff", "--quiet", "HEAD", "--", p]); } catch { out.push(`${p} differs from HEAD`); }
  }
  if (requirePushed) {
    try {
      const last = git(["log", "-1", "--format=%H", "--", "docs/controller-locality-power-2026-11-02/freeze.json"]);
      if (!last) out.push("freeze.json has no commit");
      else git(["merge-base", "--is-ancestor", last, `origin/${BRANCH}`]);
    } catch { out.push(`the freeze commit is not an ancestor of origin/${BRANCH}: push it before running`); }
  }
  return out;
}

export const freezeInputPaths = (): string[] => [...sourceFiles(REPO, EXTRA_SOURCES), "docs/controller-locality-power-2026-11-02/AMENDMENT.md", "docs/controller-locality-power-2026-11-02/freeze.json", "docs/controller-locality-2026-11-01/evidence.json"];

/** Why `--write` must refuse right now (empty when it may proceed). */
export function writeRefusals(opts: { requirePushed?: boolean; freezePath?: string; evidencePath?: string } = {}): string[] {
  const freezePath = opts.freezePath ?? FREEZE, evidencePath = opts.evidencePath ?? POWER_EVIDENCE;
  if (!existsSync(freezePath)) return ["freeze.json is missing: run --freeze, review, commit and push it first"];
  const f = readFreeze(freezePath);
  const out: string[] = [];
  if (!verifyFreezeSeal(f)) out.push("freeze.json seal fails");
  const now = sourceHashes(EXTRA_SOURCES);
  for (const k of new Set([...Object.keys(now), ...Object.keys(f.sources)])) if (now[k] !== f.sources[k]) out.push(`source ${k} differs from the frozen hash`);
  if (f.inputs.pr136EvidenceSha256 !== sha256(readFileSync(PR136_EVIDENCE))) out.push("PR136 evidence differs from the frozen hash");
  if (!existsSync(AMENDMENT) || f.inputs.amendmentSha256 !== sha256(readFileSync(AMENDMENT))) out.push("AMENDMENT.md differs from the frozen hash");
  if (existsSync(evidencePath)) out.push("evidence.json exists: files are written once");
  out.push(...committedProblems(freezeInputPaths(), opts.requirePushed ?? true));
  return out;
}

// ---- Run, check, replay ------------------------------------------------------------------------------------------

export function generate(f: Freeze, onProgress?: (m: string) => void, freezePath = FREEZE): Payload {
  const frozen: import("@bl/lineage").FrozenChoice = Object.fromEntries(f.plans.map((p) => [p.id, p.chosen]));
  const study = lib.runStudy({ panel: f.panel, frozen, onProgress });
  const payload = { ...lib.buildPayload(study), freezeSha256: sha256(readFileSync(freezePath)) } as Payload;
  const { integritySha256: _d, ...rest } = payload;
  return { ...rest, integritySha256: sha256(canonical(rest)) } as Payload;
}

export const checkOptions = (f: Freeze): CheckOptions => ({ extraSources: EXTRA_SOURCES, fixtureInventory: f.fixtureInventory });

/** Freeze-bound checks on a saved payload (no simulation), in addition to the shared integrity and recomputation checks. */
export function powerProblems(payload: Payload, f: Freeze, pr136Path = PR136_EVIDENCE, freezePath = FREEZE, extraEarlier: Record<string, string[]> = {}): string[] {
  const out: string[] = [];
  if (!payload.panel) return [...out, "payload carries no panel record"];
  if (canonical(payload.panel) !== canonical(f.panel)) out.push("payload panel differs from the frozen panel");
  if (canonical(payload.genomes) !== canonical(f.genomes)) out.push("genome baselines, tau or qualification differ from the frozen ones");
  if (canonical(payload.candidates) !== canonical(f.candidates)) out.push("candidates differ from the frozen ones");
  for (const p of f.plans) {
    const got = payload.rows.filter((r) => r.genome === p.id && r.assay).map((r): [string, string] => [r.id, r.hash]);
    if (canonical(got) !== canonical(p.chosen)) out.push(`${p.id}: the assayed set differs from the frozen one`);
    const want = Object.values(p.allocation).reduce((a, b) => a + b, 0);
    if (got.length !== want) out.push(`${p.id}: ${got.length} assayed edits, frozen ${want}`);
    if (p.votes && got.length !== f.n) out.push(`${p.id}: ${got.length} assayed edits, fixed N is ${f.n}`);
    const strata = payload.strata[p.id] ?? {};
    for (const [k, v] of Object.entries(p.allocation)) if (strata[k]?.chosen !== v) out.push(`${p.id}: stratum ${k} chosen ${strata[k]?.chosen}, frozen ${v}`);
    for (const [k, v] of Object.entries(p.eligible)) if (payload.strata[p.id]?.[k] && payload.strata[p.id][k].population !== v) out.push(`${p.id}: stratum ${k} eligible population differs from the frozen one`);
    // The allocation is the stated rule's output on the recomputed eligible pools.
    if (p.votes) {
      const el: Record<string, number> = {};
      for (const r of payload.rows) if (r.genome === p.id && r.cls === "genuine" && r.dupOf === null && !payload.panel.exclude[p.id]?.includes(r.hash)) { const k = lib.strataKey(r as unknown as Parameters<typeof lib.strataKey>[0]); el[k] = (el[k] ?? 0) + 1; }
      if (canonical(lib.deriveAllocation(f.n, el)) !== canonical(p.allocation)) out.push(`${p.id}: allocation does not follow from the eligible pools by the stated rule`);
    }
  }
  // Disjointness from PR136, read from its saved evidence.
  const prior = earlierHashes(pr136Path);
  for (const [k, v] of Object.entries(extraEarlier)) prior.all[k] = [...new Set([...(prior.all[k] ?? []), ...v])].sort(); // reduced-payload test only
  const assayed: Record<string, string[]> = {};
  for (const r of payload.rows) if (r.assay) (assayed[r.genome] ??= []).push(r.hash);
  out.push(...lib.disjointnessProblems(payload.panel, { seeds: prior.seeds, salt: prior.salt, nullPrefix: "", hashes: prior.all }, assayed));
  if (canonical(payload.panel.exclude) !== canonical(prior.all)) out.push("panel exclusion lists differ from PR136's recorded hashes");
  if (payload.freezeSha256 !== sha256(readFileSync(freezePath))) out.push("payload freezeSha256 differs from freeze.json");
  return out;
}

/** The power-specific manifest fields: freeze binding, N, and the recorded worker metadata. */
export function manifestProblems(m: { freezeSha256?: unknown; n?: unknown; workers?: { requested?: unknown; used?: unknown } }, f: Freeze, freezePath = FREEZE): string[] {
  const out: string[] = [];
  if (m.freezeSha256 !== sha256(readFileSync(freezePath))) out.push("manifest freezeSha256 differs from freeze.json");
  if (m.n !== f.n) out.push(`manifest n ${String(m.n)} differs from the frozen N ${f.n}`);
  const w = m.workers;
  if (!w || !Number.isInteger(w.requested) || (w.requested as number) < 1 || w.used !== 1) out.push("manifest worker metadata is missing or invalid (requested >= 1 integer, used 1)");
  return out;
}

export function checkPower(evidence = POWER_EVIDENCE, manifest = POWER_MANIFEST, root = REPO, freezePath = FREEZE, extraEarlier: Record<string, string[]> = {}): string[] {
  if (!existsSync(freezePath)) return ["freeze.json is missing"];
  const f = readFreeze(freezePath);
  const out: string[] = [];
  if (!verifyFreezeSeal(f)) out.push("freeze integritySha256 does not match");
  out.push(...checkSaved(evidence, manifest, root, checkOptions(f)));
  if (existsSync(evidence)) {
    const p = JSON.parse(readFileSync(evidence, "utf8")) as Payload;
    if (!verifySeal(p)) return out;
    out.push(...powerProblems(p, f, PR136_EVIDENCE, freezePath, extraEarlier));
  }
  if (existsSync(manifest)) out.push(...manifestProblems(JSON.parse(readFileSync(manifest, "utf8")), f, freezePath));
  return out;
}

export function replayCheck(freezePath = FREEZE, evidence = POWER_EVIDENCE): string[] {
  const f = readFreeze(freezePath);
  return serialize(generate(f, undefined, freezePath)) === readFileSync(evidence, "utf8") ? [] : ["regenerated payload differs from evidence.json"];
}

// ---- CLI --------------------------------------------------------------------------------------------------------

function main(): void {
  const mode = process.argv[2];
  const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const workers = Number(arg("--workers") ?? 1);
  if (mode === "--calibrate") {
    const c = calibrate();
    console.log(JSON.stringify(c, null, 1));
  } else if (mode === "--freeze") {
    const dry = process.argv.includes("--dry");
    if (!dry && existsSync(FREEZE)) throw new Error("freeze.json exists; it is written once. Amend by a new dated amendment, not by rewriting.");
    const forced = arg("--n");
    if (forced && !dry) throw new Error("--n is for --dry only");
    const f = sealFreeze(planFreeze(calibrate(), forced ? Number(forced) : undefined, (m) => console.error(m)));
    if (dry) console.log(JSON.stringify({ n: f.n, allocations: f.allocations, workload: f.workload, projectedSeconds: f.projectedSeconds, calibration: f.calibration, plans: f.plans.map((p) => ({ id: p.id, votes: p.votes, generated: p.generated, eligible: p.eligible, allocation: p.allocation, chosenCount: p.chosen.length, breadthUpperBound2: p.breadthUpperBound2, entanglementReachable: p.entanglementReachable })), genomes: f.genomes.map((g) => ({ id: g.id, baseline: g.baseline, tau: g.tau, qualification: g.qualification })), fixtureInventory: f.fixtureInventory }, null, 1));
    else { writeFileSync(`${FREEZE}.tmp`, serialize(f)); renameSync(`${FREEZE}.tmp`, FREEZE); console.log(`wrote freeze.json N=${f.n} seal ${f.integritySha256}`); }
  } else if (mode === "--freeze-check") {
    const problems = freezeCheck();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log("--freeze-check ok");
  } else if (mode === "--write") {
    const problems = writeRefusals();
    if (problems.length) { console.error(`refusing to run:\n${problems.join("\n")}`); process.exit(1); }
    const f = readFreeze();
    const t = performance.now();
    const payload = generate(f, (m) => console.error(m));
    const text = serialize(payload);
    const seconds = Math.round((performance.now() - t) / 1000);
    const manifestText = serialize(makeManifest(payload, text, seconds, EXTRA_SOURCES, { freezeSha256: sha256(readFileSync(FREEZE)), n: f.n, workers: { requested: workers, used: 1, note: "worker pool not built: the serial projection is within the budget" } }));
    writeFileSync(`${POWER_EVIDENCE}.tmp`, text);
    writeFileSync(`${POWER_MANIFEST}.tmp`, manifestText);
    renameSync(`${POWER_EVIDENCE}.tmp`, POWER_EVIDENCE);
    renameSync(`${POWER_MANIFEST}.tmp`, POWER_MANIFEST);
    console.log(`wrote evidence.json (${text.length} bytes) seal ${payload.integritySha256} in ${seconds} s`);
  } else if (mode === "--check" || mode === "--replay-check") {
    const problems = mode === "--check" ? checkPower() : replayCheck();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log(`${mode} ok`);
  } else {
    console.error("usage: deno run -A --no-lock tools/locality/power.ts --calibrate | --freeze [--dry] | --freeze-check | --write | --check | --replay-check");
    process.exit(2);
  }
}
const isMain = (import.meta as { main?: boolean }).main ?? false;
if (isMain) main();
