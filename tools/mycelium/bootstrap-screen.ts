// EXPLORATORY screen of the bootstrap rules (pre-laid trail P, free first layer F, owner conduit O): docs/mycelium-bootstrap-2026-11-14/DESIGN.md.
// Not a pre-registered test; no confirmatory claim.
//
//   deno run -A --no-lock tools/mycelium/bootstrap-screen.ts --audit                        (the seed audit only: exit 1 on any problem)
//   deno run -A --no-lock tools/mycelium/bootstrap-screen.ts --propose                      (the first table base whose whole table audits clean)
//   deno run -A --no-lock tools/mycelium/bootstrap-screen.ts --series T --count             (how many runs, planned steps, projected hours; no GPU)
//   deno run -A --no-lock tools/mycelium/bootstrap-screen.ts --out runs/mycelium-bootstrap/<name> --table [--series T]
//   deno run -A --no-lock tools/mycelium/bootstrap-screen.ts --out runs/mycelium-bootstrap/<name> --label [--sizing <file>]
//   deno run -A --no-lock tools/mycelium/bootstrap-screen.ts --out runs/mycelium-bootstrap/<name> --size       (sizing rules R1 to R6 from the S runs; writes <out>/sizing.json)
//   deno run -A --no-lock tools/mycelium/bootstrap-screen.ts --series <S1|S2|S2d|S3|S4|T|D0|D|B|F|O|R7> --out runs/mycelium-bootstrap/<name>
//        [--sizing <file>] [--dry] [--steps N] [--jobs 3] [--slots a,b] [--held] [--extras] [--only <id-substring>] [--no-branch] [--smoke]
//        [--branch-steps 2000] [--branch-grid 25] [--rate <wall seconds per 1000 steps>] [--base <table base>] [--log docs/mycelium-bootstrap-2026-11-14/run-log.jsonl]
//
// Every run is one GPU world (128 x 128). Both ledgers and validateState are checked on the full state at every read (every 100 steps at least;
// a residual aborts that run, logs it as failed, and the process exits 1). R2b's scalar census every 100 steps, its heavy census plus R4's, the
// conduit readouts and the bootstrap readouts every 500. Every read also keeps the exact totals and the field sum (a Snap), from which births,
// deaths, population and the exact intake of any window follow; the telescoping identity of the intake is asserted per run (exit 2 on mismatch).
// A run with branch checkpoints is read back there and each variant (conduit off, ghost, free layer off, null seeds, owner switches) is continued from
// the identical state on a fresh GPU world, read every --branch-grid steps. Output: <out>/runs/<id>.json (a finished run is skipped, so the screen
// resumes; several processes may share one --out, a claim file stops two taking the same run) and one line per start, finish or failure to the log.
//
// Exit codes: 0 clean; 1 a run failed or had a ledger residual; 2 usage, a seed-audit problem, a refused gate or an intake-identity mismatch.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { GpuMycelium, myceliumDevice } from "./gpu.ts";
import { R4Observer, r4WindowMeans } from "./observe-r4.ts";
import { runValues } from "./observe-r2b.ts";
import { conduitCensus, conduitWindow, emptyConduit, pushConduit, type ConduitSeries } from "./observe-conduit.ts";
import {
  BOOT_KEYS, colWindow, DEF_THETAS, defenceCurve, emptyCols, ghostCorrP, independentIntakeProblem, meanEdgeRate, observerView, ownerCensus, ownerEdgeCorr, projectHours, PROJECTION_MAX_HOURS, pushCols, roadCensus, ROAD_KEYS, snapOf,
  telescopeProblem, tmSplit, xflux, xMedOccupied, type ColSeries, type Snap,
} from "./observe-bootstrap.ts";
import {
  BRANCH_LEN, branchCheckpoints, expandRuns, PROVISIONAL, rateFromLog, RELAX_LEN, resumeProblem, runSummary, schedule, SERIES_IDS, SIZING_FIELDS, sizingStamp, specConfig, unmeasuredNeeds, variantState,
  type RunSpec, type Sizing,
} from "./bootstrap-arms.ts";
import { analyzeD, analyzeD0, analyzeF, analyzeT, branchTable, fmt, identityProblems, labelRows, runTable, type BranchFile, type BranchSideFile, type RunFile } from "./bootstrap-analyze.ts";
import { sizeFromS } from "./bootstrap-size.ts";
import { auditTable, BASE_CANDIDATES, BOOT_BASE, proposeBase, type RegisteredSet, slotsOf, tableRows } from "./bootstrap-seeds.ts";
import { FRESH_MIN } from "./r2-protocol.ts";
import { embargoReason, R2_SEEDS, R2B_WORLD_SEEDS } from "./r2b-seeds.ts";
import { NOT_R3_SLOTS, R3_WORLD_SEEDS, r3EmbargoReason } from "./r3-seeds.ts";
import { R4_WORLD_SEEDS, r4EmbargoReason } from "./r4-seeds.ts";
import { ALL_SLOTS as CONDUIT_SLOTS, HEREDITY_OFFSET as CONDUIT_OFFSET } from "./conduit-screen.ts";
import { createWorld, energyTotal, matterTotal, type MyceliumState, validateState } from "./world.ts";

const BOOT_LOG = "docs/mycelium-bootstrap-2026-11-14/run-log.jsonl";

// ---- the seed audit ---------------------------------------------------------------------------------------------

async function logSeedsOf(path: string): Promise<number[]> {
  const out = new Set<number>();
  let txt: string;
  try { txt = await Deno.readTextFile(path); } catch { return []; }
  for (const line of txt.split("\n")) if (line.trim()) { const o = JSON.parse(line); if (typeof o.worldSeed === "number") out.add(o.worldSeed); }
  return [...out];
}

/** Every registered set the audit checks against, read from the imports and from every run-log under docs/mycelium-* except the bootstrap's own. */
export async function registeredSets(): Promise<RegisteredSet[]> {
  const sets: RegisteredSet[] = [
    { name: "R2b worlds (slots 2001-2020, 5001-5016 plus arm offsets)", seeds: R2B_WORLD_SEEDS }, { name: "R2 seeds (101-105, 9001-9005)", seeds: R2_SEEDS },
    { name: "R3 worlds", seeds: R3_WORLD_SEEDS }, { name: "R4 worlds", seeds: R4_WORLD_SEEDS }, { name: "reserved NOT_R3 slots 8001-8099", seeds: NOT_R3_SLOTS },
    { name: "conduit screen worlds (ALL_SLOTS x HEREDITY_OFFSET)", seeds: Object.values(CONDUIT_OFFSET).flatMap((o) => CONDUIT_SLOTS.map((s) => s + o)) },
    { name: "shaping scratch range", range: [200_011, 240_013] },
  ];
  for await (const e of Deno.readDir("docs")) {
    if (!e.isDirectory || !e.name.startsWith("mycelium-") || e.name.startsWith("mycelium-bootstrap")) continue;
    const seeds = await logSeedsOf(`docs/${e.name}/run-log.jsonl`);
    if (seeds.length) sets.push({ name: `run-log worldSeeds of docs/${e.name}`, seeds });
  }
  return sets;
}
const refuseOf = (seed: number): string | null => embargoReason(seed, { r2b: true, r2: true }) ?? r3EmbargoReason(seed) ?? r4EmbargoReason(seed) ?? (seed < FRESH_MIN ? null : "at or above FRESH_MIN");

async function runAudit(base: number, logPath: string): Promise<{ problems: string[]; report: string[] }> {
  return auditTable(base, await registeredSets(), { refuse: refuseOf, bootLogSeeds: await logSeedsOf(logPath) });
}

// ---- one run ----------------------------------------------------------------------------------------------------

const ledgerBad = (s: MyceliumState): boolean => matterTotal(s) - s.matter0 !== 0 || energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat) !== 0 || validateState(s).length > 0;
const HYP_T = { g: 255, q: 2 } as const;
const HYP_C = { g: 8, q: 255 } as const;

/** Matter-neutral butterfly: one unit from A to C at the lowest-index cell with A > 0, with both anchors retaken. */
function butterfly(s: MyceliumState): void {
  const k = s.A.findIndex((a) => a > 0);
  if (k < 0) throw new Error("butterfly: no cell with A > 0");
  s.A[k]--; s.C[k]++;
  s.matter0 = matterTotal(s); s.energy0 = energyTotal(s);
}

/** One variant continued `len` steps from `s0`, one read every `grid` steps; snap steps are relative to the checkpoint. */
async function branchRun(device: GPUDevice, s0: MyceliumState, vs: MyceliumState, len: number, grid: number): Promise<BranchSideFile> {
  const g = await GpuMycelium.create(device, vs);
  const snaps: Snap[] = [{ ...snapOf(vs), step: 0 }];
  let bad = 0, last = vs;
  try {
    for (let t = grid; t <= len; t += grid) {
      g.step(grid);
      const s = await g.read();
      if (ledgerBad(s)) bad++;
      snaps.push({ ...snapOf(s), step: t });
      const ip = independentIntakeProblem(last, s, snaps[snaps.length - 2], snaps[snaps.length - 1]);
      if (ip) throw Object.assign(new Error(`branch intake cross-check: ${ip}`), { fatal: true });
      last = s;
    }
  } finally { g.destroy(); }
  const side: BranchSideFile = { snaps, ledgerBad: bad, nEnd: last.n };
  const tp = telescopeProblem(snaps, s0.config.eA);
  if (tp) throw Object.assign(new Error(`branch intake identity: ${tp}`), { fatal: true });
  if (last.config.trailConduitGhost !== undefined) side.ghostCorr = ghostCorrP(last, last.config.trailConduitGhost);
  else if (last.config.ownerGhost !== undefined && last.config.ownerConduit !== undefined && last.Z && last.Q) side.ghostCorr = ownerEdgeCorr(last, last.config.ownerConduit, last.config.ownerConduitCap ?? 255, last.config.ownerGhost);
  return side;
}

interface Opts { branchSteps: number; branchGrid: number; noBranch: boolean; steps: number | null; smoke: boolean }

async function runOne(device: GPUDevice, r: RunSpec, sz: Sizing, o: Opts): Promise<RunFile & { ledgerBadChecks: number }> {
  const cfg = specConfig(r);
  const steps = o.steps ?? r.steps;
  const s0 = createWorld(cfg);
  if (r.butterfly) butterfly(s0);
  const gpu = await GpuMycelium.create(device, s0);
  let dead = false;
  const kill = () => { if (!dead) { dead = true; gpu.destroy(); } };
  try {
  const r4 = new R4Observer();
  const cser: ConduitSeries = emptyConduit();
  const boot: ColSeries = emptyCols(BOOT_KEYS);
  const road: ColSeries | null = cfg.trailInit !== undefined ? emptyCols(ROAD_KEYS) : null;
  const useG = cfg.trailConduit ?? HYP_C.g, useQ = cfg.trailConduitCap ?? HYP_C.q;
  const fluxG = cfg.trailConduit ?? HYP_T.g, fluxQ = cfg.trailConduit !== undefined ? (cfg.trailConduitCap ?? 255) : HYP_T.q;
  const F = cfg.trailFreeLayer ?? 0;
  const branchAt = branchCheckpoints(r.branch, steps, { noBranch: o.noBranch, stepsGiven: o.steps !== null });
  // The window edges of the analysis must be reads: t0, the plateau t_alive values (capped at 1,000), D1/D2 edges and the D0 window end.
  const edges = [sz.t0, sz.t0 + 2000, 2000, 5000, 10_000, ...Object.values(sz.tAlive).map((x) => Math.min(x, 1000))];
  const sched = schedule(r.reads, steps, [...branchAt, ...edges]);
  const snaps: Snap[] = [snapOf(s0)];
  const branches: BranchFile[] = [];
  let checks = 0, residual = 0, branchErrors = 0, minN = s0.n, prev = 0, prevState: MyceliumState = s0;
  for (const t of sched) {
    gpu.step(t - prev); prev = t;
    const s = await gpu.read();
    checks++;
    if (ledgerBad(s)) { residual++; kill(); throw Object.assign(new Error(`ledger residual at step ${s.step}`), { residual: true, step: s.step }); }
    minN = Math.min(minN, s.n);
    snaps.push(snapOf(s));
    // The intake of this interval from the matter ledger, an independent route to the same integer (the telescoping sum below cannot fail on its own).
    const ip = independentIntakeProblem(prevState, s, snaps[snaps.length - 2], snaps[snaps.length - 1]);
    if (ip) { kill(); throw Object.assign(new Error(`intake cross-check: ${ip}`), { fatal: true }); }
    prevState = s;
    // observe-r2b's depositMeasure (inside r4.heavy) steps a clone that shares the owner planes, so the existing R2b/R4 observers get a view with Z and Q
    // copied (it is the view that ends up one step ahead); every other readout, and every branch, reads the pristine `s`.
    if (t % 100 === 0) r4.scalar(s);
    const heavy = t % 500 === 0;
    if (heavy) {
      r4.heavy(observerView(s)); pushConduit(cser, t, conduitCensus(s, useG, useQ));
      const tm = tmSplit(s, F), oc = s.Z ? ownerCensus(s) : null;
      const dc = s.Z ? defenceCurve(s, DEF_THETAS) : null;
      pushCols(boot, t, {
        tm: tm.tm, tmAbove: tm.tmAbove, tmFree: tm.tmFree, tmAbove2: tm.tmAbove2, tmFree2: tm.tmFree2,
        // Trail above ONE ceiling (F*) in every run, so the F dose arms (own ceilings F*/4, F*) compare like with like.
        tmAboveStar: sz.Fstar > 0 ? tmSplit(s, sz.Fstar).tmAbove : null,
        ghostCorr: cfg.trailConduitGhost !== undefined ? ghostCorrP(s, cfg.trailConduitGhost) : null, xMedOcc: xMedOccupied(s),
        meanEdge: cfg.trailConduit !== undefined ? meanEdgeRate(s, cfg.trailConduit, cfg.trailConduitCap ?? 255) : null,
        ownedCells: oc?.ownedCells ?? null, ownedOccupied: oc?.ownedOccupied ?? null, ownedShareP: oc?.ownedShareP ?? null, qP50: oc?.qP50 ?? null, qP90: oc?.qP90 ?? null,
        own: oc?.own ?? null, foreignDefended: oc?.foreignDefended ?? null, open: oc?.open ?? null, sameEdge: oc?.sameEdge ?? null, deadFence: oc?.deadFence ?? null,
        ownerGhostCorr: cfg.ownerGhost !== undefined && cfg.ownerConduit !== undefined ? ownerEdgeCorr(s, cfg.ownerConduit, cfg.ownerConduitCap ?? 255, cfg.ownerGhost) : null,
        ...Object.fromEntries(DEF_THETAS.map((th, k) => [`def${th}`, dc ? dc[k].particles : null])),
      });
    }
    if (road && (r.reads !== "std" || heavy)) {
      const rc = roadCensus(s)!;
      pushCols(road, t, {
        laidA8: rc.laidA8, desert: rc.desert, xMed: rc.xMed, xGe1: rc.xGe1, xGe2: rc.xGe2, xGe3: rc.xGe3, onLaid: rc.onLaid, road: rc.road,
        meanDd1: rc.meanDd1, meanDd2: rc.meanDd2, meanDd3: rc.meanDd3, xflux: xflux(s, fluxG, fluxQ), n: s.n,
      });
    }
    if (branchAt.includes(t) && r.branch && s.n > 0) {
      if (ledgerBad(s)) { kill(); throw Object.assign(new Error(`state corrupted by an observer before the branch at step ${t}`), { residual: true, step: t }); }
      const last = t === branchAt[branchAt.length - 1];
      const b: BranchFile = { at: t, len: o.branchSteps, variants: {} };
      for (const v of r.branch.variants) {
        if (v.startsWith("relax-") && !last) continue;
        let vs: ReturnType<typeof variantState>;
        try { vs = variantState(s, v, sz); } catch (e) { b.variants[v] = { snaps: [], ledgerBad: 0, nEnd: 0, error: String((e as Error).message) }; branchErrors++; continue; }
        if (!vs) continue;
        const len = vs.len || o.branchSteps;
        try { b.variants[v] = await branchRun(device, s, vs.state, len, o.branchGrid); }
        catch (e) { if ((e as any).fatal) { kill(); throw e; } b.variants[v] = { snaps: [], ledgerBad: 0, nEnd: 0, error: String((e as Error).message) }; branchErrors++; }
        if (b.variants[v].ledgerBad) residual++;
      }
      branches.push(b);
    }
  }
  kill();
  const tp = telescopeProblem(snaps, cfg.eA);
  if (tp) throw Object.assign(new Error(`intake identity: ${tp}`), { fatal: true });
  const ser = r4.series();
  const lo = steps / 2;
  const win = (a: number, b: number) => ({ runValues: runValues(ser, a, b, null), r4: r4WindowMeans(ser, a, b), conduit: conduitWindow(cser, a, b), boot: colWindow(boot, a, b) });
  return {
    id: r.runId, series: r.series, armId: r.id, heredity: r.hered1, slot: r.slot, worldSeed: cfg.seed, steps, smoke: o.smoke,
    branchAt, branchLen: o.branchSteps, branchGrid: o.branchGrid, branchErrors, sizing: sizingStamp(sz, r.series),
    config: cfg as unknown as RunFile["config"], ledgerChecks: checks, ledgerBadChecks: residual, minN, snaps, telescope: tp,
    roadSeries: road, bootSeries: boot, late: win(lo, steps), early: { runValues: runValues(ser, 10_000, 20_000, null) },
    conduitSeries: cser, branches,
    // The census series stay in the file so any window can be re-read; r4 is the R2b-plus-R4 series.
    r4Series: ser,
  } as unknown as RunFile & { ledgerBadChecks: number };
  } catch (e) { kill(); throw e; }
}

// ---- planning, tables, main -------------------------------------------------------------------------------------

/** Planned simulated steps of a run: the main run plus every branch variant (the cost the projection is made from). */
export function plannedSteps(r: RunSpec, o: Pick<Opts, "branchSteps" | "noBranch" | "steps">): number {
  const steps = o.steps ?? r.steps;
  if (o.noBranch || !r.branch) return steps;
  const at = o.steps !== null ? [steps] : r.branch.at.filter((t) => t <= steps);
  let t = steps;
  for (let k = 0; k < at.length; k++) for (const v of r.branch.variants) t += v.startsWith("relax-") ? (k === at.length - 1 ? RELAX_LEN : 0) : o.branchSteps;
  return t;
}

async function loadRows(out: string, series: string | undefined): Promise<RunFile[]> {
  const rows: RunFile[] = [];
  for await (const e of Deno.readDir(`${out}/runs`)) if (e.name.endsWith(".json")) { const r = JSON.parse(await Deno.readTextFile(`${out}/runs/${e.name}`)) as RunFile; if (!series || r.series === series) rows.push(r); }
  return rows;
}

async function loadSizing(path: string | undefined): Promise<Sizing> {
  if (!path) return PROVISIONAL;
  const f = JSON.parse(await Deno.readTextFile(path));
  const measured: string[] = Array.isArray(f.measured) ? f.measured : [];
  return { ...PROVISIONAL, ...f, measured, provisional: SIZING_FIELDS.some((k) => !measured.includes(k)) };
}

/** The measured wall rate of a run-log file (see rateFromLog in bootstrap-arms.ts for what counts). */
export async function measuredRate(logPath: string, series?: string): Promise<{ rate: number; lines: number; basis: string } | null> {
  let txt: string;
  try { txt = await Deno.readTextFile(logPath); } catch { return null; }
  return rateFromLog(txt, series);
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, {
    string: ["out", "steps", "jobs", "slots", "only", "log", "series", "sizing", "base", "branch-steps", "branch-grid", "rate"],
    boolean: ["table", "label", "audit", "propose", "size", "count", "dry", "no-branch", "reclaim", "smoke", "extras", "held", "no-gate"],
  });
  const logPath = a.log ?? BOOT_LOG;
  const base = Number(a.base ?? BOOT_BASE);
  if (a.propose) {
    const r = proposeBase(BASE_CANDIDATES, await registeredSets(), { refuse: refuseOf });
    console.log(`candidates tried: ${r.tried.map((t) => `${t.base} (${t.problems} problems)`).join(", ")}`);
    console.log(r.base === null ? "no candidate audits clean" : `proposed base: ${r.base}`);
    Deno.exit(r.base === null ? 1 : 0);
  }
  const audit = await runAudit(base, logPath);
  if (a.audit) { console.log(audit.report.join("\n")); if (audit.problems.length) console.log(`PROBLEMS:\n${audit.problems.join("\n")}`); else console.log("audit clean: zero collisions"); Deno.exit(audit.problems.length ? 1 : 0); }
  if (audit.problems.length) { console.error(`seed audit failed:\n${audit.problems.join("\n")}`); Deno.exit(2); }
  const sz = await loadSizing(a.sizing);
  const series = a.series as string | undefined;
  if (series && !a.count && !(SERIES_IDS as readonly string[]).includes(series)) { console.error(`--series must be one of ${SERIES_IDS.join(", ")}`); Deno.exit(2); }
  const o: Opts = { branchSteps: Number(a["branch-steps"] ?? BRANCH_LEN), branchGrid: Number(a["branch-grid"] ?? 25), noBranch: !!a["no-branch"], steps: a.steps ? Number(a.steps) : null, smoke: !!a.smoke || series === "R7" };
  if (!Number.isInteger(o.branchSteps) || !Number.isInteger(o.branchGrid) || o.branchSteps % o.branchGrid !== 0 || o.branchSteps < o.branchGrid) { console.error("--branch-steps must be a multiple of --branch-grid"); Deno.exit(2); }
  if (o.steps !== null && (!Number.isInteger(o.steps) || o.steps < 100 || o.steps % 100 !== 0)) { console.error("--steps must be a multiple of 100"); Deno.exit(2); }
  if (a.count) {
    if (!series) { console.error("--series is required (a comma list is allowed with --count)"); Deno.exit(2); }
    let allRuns = 0, allHours = 0, allUnmeasured = false;
    for (const sid of series.split(",")) {
      if (!(SERIES_IDS as readonly string[]).includes(sid)) { console.error(`unknown series ${sid}`); Deno.exit(2); }
      const runs = expandRuns(sid, sz, base, { held: a.held, extras: a.extras });
      const total = runs.reduce((t, r) => t + plannedSteps(r, o), 0);
      const m = a.rate ? { rate: Number(a.rate), basis: "--rate" } : await measuredRate(logPath, sid);
      allRuns += runs.length;
      if (m) allHours += projectHours(total, m.rate); else allUnmeasured = true;
      console.log(`${sid}: ${runs.length} runs, ${total} planned steps (main runs plus branch variants)${m === null ? "; no measured rate yet" : `, rate ${m.rate.toFixed(2)} wall s per 1000 steps (${m.basis}) = ${projectHours(total, m.rate).toFixed(2)} h`}`);
    }
    console.log(`total: ${allRuns} runs, ${allHours.toFixed(2)} h${allUnmeasured ? " (some series have no measured rate)" : ""}, gate ${PROJECTION_MAX_HOURS} h`);
    Deno.exit(0);
  }
  if (a.table || a.label || a.size) {
    if (!a.out) { console.error("--out <dir> is required"); Deno.exit(2); }
    const rows = await loadRows(a.out, a.label ? undefined : series);   // a label reads every series (T needs D0's vote); the table filters by --series
    if (a.size) {
      const all = await loadRows(a.out, undefined);
      const r = sizeFromS(all);
      console.log(r.lines.join("\n"));
      const file = `${a.out}/sizing.json`;
      await Deno.writeTextFile(file, JSON.stringify(r.sizing, null, 1) + "\n");
      console.log(`\nwrote ${file} (measured: ${(r.sizing.measured as string[]).join(", ") || "nothing"}); pass it as --sizing to the series that need those fields`);
      Deno.exit(0);
    }
    const bad = identityProblems(rows);
    if (a.table) {
      if (sz.provisional) console.log(`WARNING: unmeasured sizing fields (stand-ins): ${SIZING_FIELDS.filter((k) => !sz.measured.includes(k)).join(", ")}\n`);
      console.log(`### Runs (${rows.length})\n`); console.log(runTable(rows).join("\n"));
      const withBranch = rows.filter((r) => r.branches?.length);
      if (withBranch.length) { console.log(`\n### Branches (variant against \`on\`, same state)\n`); console.log(branchTable(withBranch).join("\n")); }
      console.log(`\nIntake identity (sum of per-read intakes equals the telescoped intake) failed for ${bad.length} of ${rows.length} runs${bad.length ? `:\n${bad.join("\n")}` : ""}`);
      Deno.exit(bad.length ? 2 : 0);
    }
    const lr = labelRows(rows);
    for (const n of lr.notes) console.log(`NOTE: ${n}`);
    const d0 = analyzeD0(lr.rows, sz);
    console.log(analyzeT(lr.rows, sz, lr.rows.some((r) => r.series === "D0") ? d0.vote : null).lines.join("\n")); console.log(`\n${d0.lines.join("\n")}`);
    console.log(`\n${analyzeD(lr.rows, sz).lines.join("\n")}`);
    console.log(`\n${analyzeF(lr.rows, sz).lines.join("\n")}`);
    console.log(`\nO: the owner-edge readouts (b)(c)(d) of DESIGN 9.5 (observe-owner.ts) are not built in this step: no O label is issued here.${sz.ownerStopRule ? " The S0.4 stop rule fired (under 50 percent of occupied cells owned in the toll substrate): O is INCOMPLETE, not run." : ""} K, owner census and the PAYALL branch pairs are in the tables.`);
    console.log(bad.length ? `\nIntake identity FAILED:\n${bad.join("\n")}` : "\nIntake identity exact for every run.");
    Deno.exit(bad.length ? 2 : 0);
  }
  // ---- run ----
  if (!series) { console.error("--series is required"); Deno.exit(2); }
  if (!a.out) { console.error("--out <dir> is required"); Deno.exit(2); }
  const out = a.out;
  const sizingFree = ["S1", "S2", "S2d", "S4", "R7"].includes(series);
  let todo = expandRuns(series, sz, base, { held: a.held, extras: a.extras });
  if (a.slots) {
    const want = a.slots.split(",").map(Number), allowed = new Set(tableRows(base).map((r) => r.slot));
    for (const s of want) if (!allowed.has(s)) { console.error(`slot ${s} refused: not a row of the table at base ${base}`); Deno.exit(2); }
    if (o.smoke) for (const s of want) if (!slotsOf(base, "SMOKE", "smoke").includes(s)) { console.error(`slot ${s} refused: smoke runs use only the SMOKE slots ${slotsOf(base, "SMOKE", "smoke").join(",")}`); Deno.exit(2); }
    todo = expandRuns(series, sz, base, { held: a.held, extras: a.extras, slots: want, smoke: o.smoke });
    // A slot belongs to one slot series: asking series ${series} for another series' slot (an S dev slot, a SMOKE slot without --smoke, a held slot without --held) is a refusal.
    const used = new Set(todo.map((r) => r.slot));
    for (const s of want) if (!used.has(s)) { console.error(`slot ${s} refused: no arm of series ${series} takes it (dev S slots never enter a series; SMOKE slots need --smoke; held slots need --held)`); Deno.exit(2); }
  } else if (o.smoke) { console.error("--smoke needs --slots (a SMOKE slot)"); Deno.exit(2); }
  if (a.only) todo = todo.filter((r) => r.runId.includes(a.only!));
  await Deno.mkdir(`${out}/runs`, { recursive: true });
  const exists = async (p: string) => { try { await Deno.stat(p); return true; } catch { return false; } };
  const pending: RunSpec[] = [];
  for (const r of todo) {
    const p = `${out}/runs/${r.runId}.json`;
    if (await exists(p)) {
      const done = JSON.parse(await Deno.readTextFile(p));
      const stepsNow = o.steps ?? r.steps;
      const why = resumeProblem(done, { steps: stepsNow, smoke: o.smoke, config: specConfig(r), sizing: sizingStamp(sz, r.series), branchAt: branchCheckpoints(r.branch, stepsNow, { noBranch: o.noBranch, stepsGiven: o.steps !== null }), branchLen: o.branchSteps, branchGrid: o.branchGrid });
      if (why) { console.error(`${r.runId} ${why}`); Deno.exit(2); }
      continue;
    }
    pending.push(r);
  }
  const jobs = Number(a.jobs ?? 3);
  if (!Number.isInteger(jobs) || jobs < 1) { console.error(`--jobs must be a positive integer (got ${a.jobs})`); Deno.exit(2); }
  const planned = pending.reduce((t, r) => t + plannedSteps(r, o), 0);
  // Per-arm gate: a real run is refused unless the sizing file measured every field its arms are built from.
  const missing = unmeasuredNeeds(sz, pending);
  if (missing.length && !o.smoke && !a["no-gate"]) { console.error(`series ${series} refused: the sizing did not measure ${missing.join(", ")} (--sizing <file> from the sizing step; --smoke for stand-ins)${series === "S3" ? "; S3: run the FREE-ONLY arms first (--only free), --size, then the treated arm with --sizing" : ""}`); Deno.exit(2); }
  if (series === "O" && sz.ownerStopRule && !o.smoke && !a["no-gate"]) { console.error("series O refused: the S0.4 stop rule fired (under 50 percent of occupied cells owned in the toll substrate, DESIGN 7); O is INCOMPLETE and not run"); Deno.exit(2); }
  if (!o.smoke && !sizingFree && !a["no-gate"]) {
    const m = a.rate ? { rate: Number(a.rate), basis: "--rate" } : await measuredRate(logPath, series);
    if (m === null) { console.error("refused: no measured rate (run R7 first or give --rate <wall seconds per 1000 steps>)"); Deno.exit(2); }
    const h = projectHours(planned, m.rate);
    console.error(`projection: ${pending.length} runs, ${planned} planned steps at ${m.rate.toFixed(2)} wall s per 1000 steps (${m.basis}) = ${h.toFixed(2)} h (gate ${PROJECTION_MAX_HOURS} h)`);
    if (h > PROJECTION_MAX_HOURS) { console.error("refused: the projection exceeds the gate; apply the cut order of DESIGN section 8 and record the cuts"); Deno.exit(2); }
  }
  if (a.dry) { console.error(`dry run: ${pending.length} runs, ${planned} planned steps, all gates passed; nothing started`); Deno.exit(0); }
  const device = await myceliumDevice();
  const log = async (x: Record<string, unknown>) => await Deno.writeTextFile(logPath, JSON.stringify({ t: new Date().toISOString(), out, series, smoke: o.smoke, standIn: unmeasuredNeeds(sz, pending).length > 0, sizing: { measured: sz.measured, unmeasured: SIZING_FIELDS.filter((k) => !sz.measured.includes(k)) }, ...x }) + "\n", { append: true });
  let next = 0, failures = 0, fatal = 0, skippedClaims = 0;
  const worker = async () => {
    while (next < pending.length) {
      const r = pending[next++];
      const claim = `${out}/runs/${r.runId}.claim`;
      if (a.reclaim) { try { await Deno.remove(claim); } catch { /* none */ } }
      try { (await Deno.open(claim, { createNew: true, write: true })).close(); } catch { skippedClaims++; console.error(`${r.runId} is claimed (another process, or a killed one); NOT run`); continue; }
      const cfg = specConfig(r);
      const plan = plannedSteps(r, o);
      await log({ id: r.runId, state: "started", steps: o.steps ?? r.steps, plannedSteps: plan, jobs, worldSeed: cfg.seed, slot: r.slot, arm: r.id, heredity: r.hered1, over: r.over });
      const t0 = performance.now();
      try {
        const res = await runOne(device, r, sz, o);
        const seconds = +((performance.now() - t0) / 1000).toFixed(1);
        await Deno.writeTextFile(`${out}/runs/${r.runId}.json.tmp`, JSON.stringify({ ...res, seconds }));
        await Deno.rename(`${out}/runs/${r.runId}.json.tmp`, `${out}/runs/${r.runId}.json`);
        if (res.ledgerBadChecks || res.branchErrors) failures++;
        const nb = res.branches.reduce((t, b) => t + Object.keys(b.variants).length, 0);
        await log({ id: r.runId, state: "finished", seconds, steps: res.steps, plannedSteps: plan, jobs, ledgerChecks: res.ledgerChecks, ledgerBadChecks: res.ledgerBadChecks, branchErrors: res.branchErrors, minN: res.minN, lateN: res.late.runValues.meanN, lateTM: res.late.runValues.TM, branchVariants: nb, intakeIdentity: "exact (telescoping sum and the independent matter-ledger route)" });
        console.error(`${r.runId} done in ${seconds}s: ledger bad ${res.ledgerBadChecks}/${res.ledgerChecks}, n(late) ${fmt(res.late.runValues.meanN, 0)}, TM(late) ${fmt(res.late.runValues.TM)}, branch variants ${nb}`);
      } catch (e) {
        failures++;
        if ((e as any).fatal) fatal++;
        try { await Deno.remove(claim); } catch { /* none */ }
        await log({ id: r.runId, state: "failed", seconds: +((performance.now() - t0) / 1000).toFixed(1), error: String((e as Error).message ?? e), residual: (e as any).residual === true, fatal: (e as any).fatal === true, step: (e as any).step ?? null, plannedSteps: plan, jobs });
        console.error(`${r.runId} FAILED: ${(e as Error).message}`);
      }
    }
  };
  console.error(`${pending.length} runs, ${planned} planned steps, jobs ${jobs}${missing.length ? ` (sizing not measured for ${missing.join(",")})` : ""}${o.smoke ? " (SMOKE)" : ""}`);
  await Promise.all(Array.from({ length: jobs }, worker));
  const sum = runSummary({ failures, fatal, skippedClaims });
  console.error(sum.message);
  Deno.exit(sum.code);
}
