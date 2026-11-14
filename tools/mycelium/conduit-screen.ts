// EXPLORATORY screen of the optional trail conduit rule (docs/mycelium-conduit-2026-11-14/DESIGN.md section 6 and SCREEN.md). Not a pre-registered test.
//
//   deno run -A --no-lock tools/mycelium/conduit-screen.ts --audit                     (the seed audit only; exit 1 on any collision)
//   deno run -A --no-lock tools/mycelium/conduit-screen.ts --out <dir> --table         (markdown tables of the finished runs, no GPU)
//   deno run -A --no-lock tools/mycelium/conduit-screen.ts --out <dir> [--steps 100000] [--jobs 3] [--slots 8101,8102,8103,8104]
//        [--only <id-substring>] [--log docs/mycelium-conduit-2026-11-14/run-log.jsonl] [--no-branch]
//
// Runs every (arm, heredity, slot) of ARMS on the GPU (128 x 128). Both ledgers and validateState are checked on the full state every 100 steps
// (a residual aborts that run, logs it as failed, and the process exits 1). R2b's scalar census every 100 steps, its heavy census plus R4's
// readouts and the conduit readouts every 500. At the end a conduit run takes the 200-step conduit-off branch. Output: <out>/runs/<id>.json
// (a finished run is skipped, so the screen resumes; several processes may share one --out, a claim file stops two taking the same run) and one
// line per start, finish or failure to the --log file (nothing dropped).
//
// World seeds: slot + the heredity's offset, slots 8101-8108 (the screen takes 8101-8104, 8105-8108 are held for the extension to 8 seeds).
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { GpuMycelium, myceliumDevice } from "./gpu.ts";
import { R4Observer, r4WindowMeans } from "./observe-r4.ts";
import { runValues } from "./observe-r2b.ts";
import { CONDUIT_KEYS, conduitCensus, conduitWindow, emptyConduit, pushConduit, type ConduitSeries } from "./observe-conduit.ts";
import { FRESH_MIN } from "./r2-protocol.ts";
import { embargoReason, R2_SEEDS, R2B_WORLD_SEEDS } from "./r2b-seeds.ts";
import { R3_WORLD_SEEDS } from "./r3-seeds.ts";
import { R4_WORLD_SEEDS } from "./r4-seeds.ts";
import { createWorld, defaultConfig, energyTotal, matterTotal, type MyceliumConfig, type MyceliumState, validateState } from "./world.ts";

export type Heredity4 = "inherit" | "blocked" | "physarum" | "blind";
/** World seed = slot + offset. All below FRESH_MIN (9001), so tools/mycelium/run.ts would not refuse any of them; none is a registered world (auditSeeds). */
export const HEREDITY_OFFSET: Record<Heredity4, number> = { inherit: 0, blocked: 200, physarum: 400, blind: 600 };
export const SCREEN_SLOTS = [8101, 8102, 8103, 8104];
export const HELD_SLOTS = [8105, 8106, 8107, 8108];
export const ALL_SLOTS = [...SCREEN_SLOTS, ...HELD_SLOTS];
/** The conduit strength the keyless and toll runs are censused at (hypothetical exposure, not a rule they run). */
export const HYP = { g: 8, q: 255 } as const;

export interface Arm { id: string; stratum: "uniform" | "gradient"; over: Partial<MyceliumConfig>; hered: Heredity4[] }
const NEURAL: Heredity4[] = ["inherit", "blocked"], ALL4: Heredity4[] = ["inherit", "blocked", "physarum", "blind"];
const TOLL = { moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" } as const;
export const ARMS: Arm[] = [
  { id: "base", stratum: "uniform", over: {}, hered: ALL4 },
  { id: "diffA56", stratum: "uniform", over: { diffA: 56 }, hered: ["inherit"] },
  { id: "diffA80", stratum: "uniform", over: { diffA: 80 }, hered: ["inherit"] },
  { id: "diffA104", stratum: "uniform", over: { diffA: 104 }, hered: ["inherit"] },
  { id: "c2", stratum: "uniform", over: { trailConduit: 2 }, hered: NEURAL },
  { id: "c8", stratum: "uniform", over: { trailConduit: 8 }, hered: ALL4 },
  { id: "c32", stratum: "uniform", over: { trailConduit: 32 }, hered: NEURAL },
  // Added after sizing (SCREEN.md "Deviations"): the keyless neural worlds hold 0 to 3 trail per occupied cell, so g of 2 to 32 would give eff under 5 percent of the headroom there.
  { id: "c128", stratum: "uniform", over: { trailConduit: 128 }, hered: NEURAL },
  { id: "g-base", stratum: "gradient", over: { lightPattern: "gradient" }, hered: NEURAL },
  { id: "g-c8", stratum: "gradient", over: { lightPattern: "gradient", trailConduit: 8 }, hered: NEURAL },
  { id: "mc12-base", stratum: "uniform", over: { moveCost: 12 }, hered: NEURAL },
  { id: "toll-ref", stratum: "uniform", over: { ...TOLL }, hered: NEURAL },
];

/** defaultConfig() + the arm's delta + the heredity arm (copied from r4-protocol.ts: physarum is frozen with physarumDeposit 256, blind is that follower with the gradient inputs zeroed). */
export function screenConfig(arm: Arm, h: Heredity4, slot: number): MyceliumConfig {
  const her: Partial<MyceliumConfig> =
    h === "inherit" ? { heredity: "inherit" }
    : h === "blocked" ? { heredity: "blocked" }
    : h === "physarum" ? { heredity: "frozen", controller: "physarum", physarumDeposit: 256 }
    : { heredity: "frozen", controller: "physarum", physarumDeposit: 256, blindTrailGradient: true };
  return defaultConfig({ ...arm.over, ...her, seed: slot + HEREDITY_OFFSET[h] });
}

/** Every world seed the screen can use, checked against every registered set; returns the problems (empty = clear) and a printable report. */
export function auditSeeds(registeredLog: readonly number[]): { problems: string[]; report: string[] } {
  const problems: string[] = [], report: string[] = [];
  const all: { seed: number; label: string }[] = [];
  for (const h of Object.keys(HEREDITY_OFFSET) as Heredity4[]) for (const s of ALL_SLOTS) all.push({ seed: s + HEREDITY_OFFSET[h], label: `${h}/${s}` });
  const seeds = all.map((x) => x.seed);
  if (new Set(seeds).size !== seeds.length) problems.push("two (heredity, slot) pairs share a world seed");
  const sets: [string, readonly number[]][] = [
    ["R2b worlds (slots 2001-2020, 5001-5016 plus arm offsets)", R2B_WORLD_SEEDS], ["R2 seeds (101-105, 9001-9005)", R2_SEEDS], ["R3 worlds", R3_WORLD_SEEDS],
    ["R4 worlds", R4_WORLD_SEEDS], ["trail-use screen run-log worldSeeds", registeredLog],
  ];
  for (const [name, set] of sets) {
    const hit = all.filter((x) => set.includes(x.seed));
    report.push(`${name}: ${set.length} seeds, ${hit.length} collisions${hit.length ? ` (${hit.map((x) => x.seed).join(",")})` : ""}`);
    if (hit.length) problems.push(`${name}: ${hit.map((x) => x.seed).join(",")}`);
  }
  const refused = all.filter((x) => !(x.seed < FRESH_MIN) || embargoReason(x.seed, { r2b: true, r2: true }));
  report.push(`run.ts gates (seed < ${FRESH_MIN} and embargoReason null) refuse ${refused.length} of ${all.length} screen world seeds`);
  if (refused.length) problems.push(`run.ts would refuse: ${refused.map((x) => x.seed).join(",")}`);
  report.push(`screen world seeds (${seeds.length}): ${Object.keys(HEREDITY_OFFSET).map((h) => `${h} ${ALL_SLOTS.map((s) => s + HEREDITY_OFFSET[h as Heredity4]).join(",")}`).join("; ")}`);
  return { problems, report };
}

async function trailUseLogSeeds(): Promise<number[]> {
  const txt = await Deno.readTextFile("docs/mycelium-trail-use-2026-11-13/run-log.jsonl");
  const out = new Set<number>();
  for (const line of txt.split("\n")) if (line.trim()) { const o = JSON.parse(line); if (typeof o.worldSeed === "number") out.add(o.worldSeed); }
  return [...out];
}

// ---- one run -----------------------------------------------------------------------------------------------

const ledgerBad = (s: MyceliumState): boolean => matterTotal(s) - s.matter0 !== 0 || energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat) !== 0 || validateState(s).length > 0;
const sumA = (s: MyceliumState): number => { let t = 0; for (let k = 0; k < s.A.length; k++) t += s.A[k]; return t; };

export interface BranchSide { nStart: number[]; births: number; deaths: number; intake: number; ledgerBad: number; first: { births: number; deaths: number; intake: number; n: number }; nEnd: number }
export interface Branch { steps: number; on: BranchSide; off: BranchSide }

/** 200 steps one at a time from the state `s0` (already on `gpu`), one read per step: n at the start of each step is the denominator. */
async function runSide(gpu: GpuMycelium, s0: MyceliumState, steps: number): Promise<BranchSide> {
  const side: BranchSide = { nStart: [], births: 0, deaths: 0, intake: 0, ledgerBad: 0, first: { births: 0, deaths: 0, intake: 0, n: s0.n }, nEnd: s0.n };
  let prev = s0, prevA = sumA(s0);
  for (let t = 0; t < steps; t++) {
    side.nStart.push(prev.n);
    gpu.step(1);
    const cur = await gpu.read();
    if (ledgerBad(cur)) side.ledgerBad++;
    const aNow = sumA(cur);
    const b = cur.totals.births - prev.totals.births, d = cur.totals.deaths - prev.totals.deaths;
    const dl = cur.totals.lightIn - prev.totals.lightIn;
    if (dl % cur.config.eA !== 0) side.ledgerBad++;
    // The A the particles ate this step: A only enters by light (C -> A at eA energy per unit) and leaves by eating or stays (diffusion is a pure move).
    const intake = prevA + dl / cur.config.eA - aNow;
    side.births += b; side.deaths += d; side.intake += intake;
    if (t === 0) side.first = { births: b, deaths: d, intake, n: prev.n };
    prev = cur; prevA = aNow; side.nEnd = cur.n;
  }
  return side;
}

async function runOne(device: GPUDevice, arm: Arm, h: Heredity4, slot: number, steps: number, branch: boolean): Promise<Record<string, unknown> & { ledgerBadChecks: number }> {
  const cfg = screenConfig(arm, h, slot);
  const gpu = await GpuMycelium.create(device, createWorld(cfg));
  const r4 = new R4Observer();
  const cser: ConduitSeries = emptyConduit();
  const g = cfg.trailConduit ?? HYP.g, q = cfg.trailConduitCap ?? HYP.q;
  let checks = 0, residual = 0, minN = Infinity, last: MyceliumState | null = null;
  for (let t = 100; t <= steps; t += 100) {
    gpu.step(100);
    const s = await gpu.read();
    checks++;
    if (ledgerBad(s)) { residual++; gpu.destroy(); throw Object.assign(new Error(`ledger residual at step ${s.step}`), { residual: true, step: s.step }); }
    minN = Math.min(minN, s.n);
    r4.scalar(s);
    if (t % 500 === 0) { r4.heavy(s); pushConduit(cser, s.step, conduitCensus(s, g, q)); }
    last = s;
  }
  let br: Branch | null = null;
  if (branch && cfg.trailConduit !== undefined && last && last.n > 0) {
    const stripped: MyceliumConfig = { ...last.config }; delete stripped.trailConduit; delete stripped.trailConduitCap;
    const off = await GpuMycelium.create(device, { ...last, config: stripped });
    const on = await runSide(gpu, last, 200);
    const offSide = await runSide(off, last, 200);
    off.destroy();
    br = { steps: 200, on, off: offSide };
    if (on.ledgerBad || offSide.ledgerBad) residual++;
  }
  gpu.destroy();
  const ser = r4.series();
  const win = (lo: number, hi: number) => ({ runValues: runValues(ser, lo, hi, null), r4: r4WindowMeans(ser, lo, hi), conduit: conduitWindow(cser, lo, hi) });
  return {
    worldSeed: cfg.seed, config: cfg, steps, ledgerChecks: checks, ledgerBadChecks: residual, minN,
    census: { g, q, hypothetical: cfg.trailConduit === undefined }, early: win(10_000, 20_000), mid: win(25_000, 50_000), late: win(steps / 2, steps),
    branch: br, series: ser, conduitSeries: cser,
  };
}

// ---- tables ------------------------------------------------------------------------------------------------

type Row = any;
async function loadRows(out: string): Promise<Row[]> {
  const rows: Row[] = [];
  for await (const e of Deno.readDir(`${out}/runs`)) if (e.name.endsWith(".json")) rows.push(JSON.parse(await Deno.readTextFile(`${out}/runs/${e.name}`)));
  return rows;
}
const med = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const f = (v: number | null | undefined, d = 3) => (v === null || v === undefined || Number.isNaN(v) ? "-" : v.toFixed(d));
const sv = (rs: Row[], g: (r: Row) => number | null | undefined, d = 3) => rs.map((r) => f(g(r), d)).join(" / ");
const md = (rs: Row[], g: (r: Row) => number | null | undefined) => med(rs.map(g).filter((x): x is number => x !== null && x !== undefined));
/** Branch deltas, per particle-step: births and intake, on minus off (the conduit's effect over the 200 steps). */
export function branchRates(b: Branch | null): { bOn: number; bOff: number; iOn: number; iOff: number; rel: number | null } | null {
  if (!b) return null;
  const den = (s: BranchSide) => s.nStart.reduce((t, x) => t + x, 0);
  const bOn = b.on.births / Math.max(1, den(b.on)), bOff = b.off.births / Math.max(1, den(b.off));
  return { bOn, bOff, iOn: b.on.intake / Math.max(1, den(b.on)), iOff: b.off.intake / Math.max(1, den(b.off)), rel: bOn > 0 ? (bOn - bOff) / bOn : null };
}

function printTables(rows: Row[]): void {
  console.log("Per arm and heredity: values are window means over the heavy (500-step) or scalar (100-step) censuses; per-seed values in slot order; medians over seeds. Late = (steps/2, steps] (the second half of each run), early = (10k, 20k].\n");
  const arms = ARMS.map((a) => a.id);
  for (const aid of arms) {
    const ar = rows.filter((r) => r.armId === aid);
    if (!ar.length) continue;
    console.log(`### ${aid}\n`);
    console.log("| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const h of ["inherit", "blocked", "physarum", "blind"]) {
      const rs = ar.filter((r) => r.heredity === h).sort((x, y) => x.slot - y.slot);
      if (!rs.length) continue;
      const bad = rs.reduce((t, r) => t + r.ledgerBadChecks, 0), checks = rs.reduce((t, r) => t + r.ledgerChecks, 0);
      const kept = rs.filter((r) => (r.late.runValues.TM ?? 0) >= 0.1).length;
      console.log(`| ${h} | ${rs.length} | ${f(md(rs, (r) => r.early.runValues.TM))} | ${sv(rs, (r) => r.late.runValues.TM, 2)} | ${f(md(rs, (r) => r.late.runValues.TM))} | ${kept}/${rs.length} | ${f(md(rs, (r) => r.late.runValues.d), 4)} | ${f(md(rs, (r) => r.late.runValues.meanN), 0)} | ${f(md(rs, (r) => r.late.runValues.AGE), 0)} | ${f(md(rs, (r) => r.late.r4?.align))} | ${f(md(rs, (r) => r.late.r4?.acute))} | ${f(md(rs, (r) => r.late.r4?.occ), 2)} (${f(md(rs, (r) => r.late.r4?.occShift), 2)}) | ${f(md(rs, (r) => r.late.r4?.speed))} | ${checks - bad}/${checks} exact |`);
    }
    const hyp = ar[0].census.hypothetical;
    console.log(`\nConduit readouts (late window; ${hyp ? `HYPOTHETICAL g=${HYP.g}: what a conduit of that strength would offer on this world's own trail, not a rule the world ran` : "the rule the world ran"}):\n`);
    console.log("| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const h of ["inherit", "blocked", "physarum", "blind"]) {
      const rs = ar.filter((r) => r.heredity === h).sort((x, y) => x.slot - y.slot);
      if (!rs.length) continue;
      const c = (k: string, d = 3) => f(md(rs, (r) => r.late.conduit[k]), d);
      const br = rs.map((r) => branchRates(r.branch)).filter((x) => x !== null) as NonNullable<ReturnType<typeof branchRates>>[];
      console.log(`| ${h} | ${c("csat")} | ${c("csatCap")} | ${c("effP10", 1)}/${c("effP50", 1)}/${c("effP90", 1)} | ${c("pcP10", 1)}/${c("pcP50", 1)}/${c("pcP90", 1)} | ${c("impLayer", 4)} / ${c("impNon", 4)} | ${c("impHi", 4)} / ${c("impLo", 4)} | ${c("connShare")} / ${c("connLargest", 0)} | ${c("occx", 2)} (${c("occxShift", 2)}) | ${c("sensLevel", 4)} / ${c("sensNut", 4)} | ${br.length ? `${f(1000 * med(br.map((x) => x.bOn)), 3)} / ${f(1000 * med(br.map((x) => x.bOff)), 3)}` : "-"} | ${br.length ? `${f(med(br.map((x) => x.iOn)), 4)} / ${f(med(br.map((x) => x.iOff)), 4)}` : "-"} |`);
    }
    console.log("");
  }
  console.log("### Every run (nothing dropped)\n");
  console.log("| run | world seed | TM late | d late | n late | age late | ALIGN | OCC | impLayer | impNon | birth rel. drop on branch | TM early | ledger |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of [...rows].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const b = branchRates(r.branch);
    console.log(`| ${r.id} | ${r.worldSeed} | ${f(r.late.runValues.TM)} | ${f(r.late.runValues.d, 4)} | ${f(r.late.runValues.meanN, 0)} | ${f(r.late.runValues.AGE, 0)} | ${f(r.late.r4?.align)} | ${f(r.late.r4?.occ, 2)} | ${f(r.late.conduit.impLayer, 4)} | ${f(r.late.conduit.impNon, 4)} | ${b ? f(b.rel) : "-"} | ${f(r.early.runValues.TM)} | ${r.ledgerChecks - r.ledgerBadChecks}/${r.ledgerChecks} |`);
  }
}


// ---- section 7 labels ----------------------------------------------------------------------------------------

/** Per-seed predicates of DESIGN.md section 7 for an inherit run, paired with its blocked run (same slot) and the physarum anchor's acute. */
export function seedPredicates(inh: Row, blk: Row | undefined, anchorAcute: number | null) {
  const K = (inh.late.runValues.TM ?? 0) >= 0.1;
  const br = branchRates(inh.branch);
  const a = !!br && br.bOn > 0 && br.rel !== null && br.rel >= 0.05 && !inh.branch.on.ledgerBad && !inh.branch.off.ledgerBad && inh.branch.on.nEnd > 0 && inh.branch.off.nEnd > 0;
  // (b): both groups present in at least half of the late-window heavy censuses, and the window means ordered.
  const cs = inh.conduitSeries, late = cs.step.map((s: number, i: number) => (s > inh.steps / 2 ? i : -1)).filter((i: number) => i >= 0);
  const both = late.filter((i: number) => cs.cols.impLayer[i] !== null && cs.cols.impNon[i] !== null).length;
  const cl = inh.late.conduit;
  const b = late.length > 0 && both * 2 >= late.length && cl.impLayer !== null && cl.impNon !== null && cl.impLayer > 0 && cl.impLayer > cl.impNon;
  const bl = blk?.late;
  const hi = (inh.late.conduit.occx - inh.late.conduit.occxShift) - (bl ? bl.conduit.occx - bl.conduit.occxShift : 0) > 0.25;
  const sensOk = (x: number | null, y: number | null | undefined) => x !== null && x >= 0.005 && x >= 2 * (y ?? 0);
  const hii = bl ? sensOk(cl.sensLevel, bl.conduit.sensLevel) || sensOk(cl.sensNut, bl.conduit.sensNut) : false;
  const hiii = bl && anchorAcute !== null ? inh.late.r4.acute - bl.r4.acute > anchorAcute / 2 : false;
  const H = !!bl && (hi || hii || hiii);
  const G = !!bl && inh.late.r4.speed >= 0.05 && inh.late.r4.speed >= 0.5 * bl.r4.speed;
  const d = cl.csat !== null && cl.csatCap !== null && cl.csat <= 0.5 && cl.csatCap <= 0.5;
  return { K, a, b, d, H, G, c: H && G, hCases: { occx: hi, sens: hii, acute: hiii } };
}

function printLabels(rows: Row[]): void {
  const pick = (aid: string, h: string) => rows.filter((r) => r.armId === aid && r.heredity === h).sort((x, y) => x.slot - y.slot);
  const phys = pick("base", "physarum").map((r) => r.late.r4.acute as number);
  const anchorAcute = phys.length ? med(phys) : null;
  console.log(`Physarum anchor acute (median over the base-arm physarum runs): ${f(anchorAcute, 4)}\n`);
  const m = (aid: string) => med(pick(aid, "inherit").map((r) => r.late.runValues.TM));
  const strengths = ["c2", "c8", "c32", "c128"];
  const control = ["diffA56", "diffA80", "diffA104"].map((id) => ({ id, kept: pick(id, "inherit").filter((r) => (r.late.runValues.TM ?? 0) >= 0.1).length, n: pick(id, "inherit").length }));
  const fOk = control.every((c) => c.kept <= 1);
  console.log(`(f) control, uniform diffusion bracket kept: ${control.map((c) => `${c.id} ${c.kept}/${c.n}`).join(", ")} -> ${fOk ? "holds" : "FAILS"}`);
  console.log(`keyless inherit (base) kept: ${pick("base", "inherit").filter((r) => (r.late.runValues.TM ?? 0) >= 0.1).length}/${pick("base", "inherit").length}\n`);
  console.log("| strength | seeds | K | (a) branch | (b) import | (c) behaviour (H and G) | H without G | (d) unsaturated | (e) dose | label |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  const eOf = (s: string) => (s === "c2" ? true : s === "c8" ? m("c8") >= m("c2") : s === "c32" ? m("c32") >= 0.8 * m("c8") : m("c128") >= 0.8 * m("c32"));
  for (const s of strengths) {
    const inh = pick(s, "inherit");
    if (!inh.length) continue;
    const ps = inh.map((r) => seedPredicates(r, pick(s, "blocked").find((x) => x.slot === r.slot), anchorAcute));
    const kept = ps.filter((p) => p.K);
    const cnt = (g: (p: (typeof ps)[number]) => boolean) => kept.filter(g).length;
    const nK = kept.length, na = cnt((p) => p.a), nb = cnt((p) => p.b), nc = cnt((p) => p.c), nd = cnt((p) => p.d), nHnoG = cnt((p) => p.H && !p.G);
    const e = eOf(s);
    const nTot = inh.length, need = Math.ceil(0.75 * nTot);
    // Complete cohort: 4 or 8 seeds, a blocked partner per slot, and every diffusion control at the same size.
    const complete = (nTot === 4 || nTot === 8) && inh.every((r) => pick(s, "blocked").some((x) => x.slot === r.slot)) && control.every((c) => c.n === nTot);
    let label: string;
    if (!complete) label = "INCOMPLETE (no label: cohort or controls missing)";
    else if (nK <= Math.floor(nTot / 4)) label = "PURGED";
    else if (nK * 2 === nTot) label = "INCONCLUSIVE (extend to 8 seeds)";
    else if (na >= need && nb >= need && nc >= need && nd >= need && e && fOk) label = "KEPT-AND-USED";
    else if (na >= need && nb >= need && nd >= need && e && fOk && nHnoG >= need) label = "KEPT-STATIC-SPONGE";
    else {
      const why = [na < need && "(a)", nb < need && "(b)", nc < need && "(c)", nd < need && "(d)", !e && "(e)", !fOk && "(f)"].filter(Boolean).join(", ");
      label = `KEPT-BY-PRESENCE-ONLY (failing: ${why})`;
    }
    console.log(`| ${s} | ${nTot} | ${nK}/${nTot} | ${na} | ${nb} | ${nc} | ${nHnoG} | ${nd} | ${e ? "yes" : "no"}${s === "c128" ? " (post hoc form)" : ""} | ${label} |`);
  }
  console.log("\nPer seed (inherit runs): K, a, b, c(H,G), d, and which H branch.\n");
  console.log("| run | K | a | b | H | G | d | H via occx/sens/acute |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const s of strengths) for (const r of pick(s, "inherit")) {
    const p = seedPredicates(r, pick(s, "blocked").find((x) => x.slot === r.slot), anchorAcute);
    const y = (v: boolean) => (v ? "y" : "n");
    console.log(`| ${r.id} | ${y(p.K)} | ${y(p.a)} | ${y(p.b)} | ${y(p.H)} | ${y(p.G)} | ${y(p.d)} | ${y(p.hCases.occx)}/${y(p.hCases.sens)}/${y(p.hCases.acute)} |`);
  }
}

// ---- main --------------------------------------------------------------------------------------------------

if (import.meta.main) {
  const a = parseArgs(Deno.args, { string: ["out", "steps", "jobs", "slots", "only", "log"], boolean: ["table", "label", "audit", "no-branch", "reclaim"] });
  const audit = auditSeeds(await trailUseLogSeeds());
  if (a.audit) { console.log(audit.report.join("\n")); Deno.exit(audit.problems.length ? 1 : 0); }
  if (audit.problems.length) { console.error(`seed audit failed:\n${audit.problems.join("\n")}`); Deno.exit(2); }
  if (!a.out) { console.error("--out <dir> is required"); Deno.exit(2); }
  const out = a.out;
  if (a.table) { printTables(await loadRows(out)); Deno.exit(0); }
  if (a.label) { printLabels(await loadRows(out)); Deno.exit(0); }
  const steps = Number(a.steps ?? 100_000), jobs = Number(a.jobs ?? 3), logPath = a.log ?? "docs/mycelium-conduit-2026-11-14/run-log.jsonl";
  if (!Number.isInteger(steps) || steps < 500 || steps % 500 !== 0) { console.error("--steps must be a multiple of 500 (the heavy census cadence)"); Deno.exit(2); }
  const slots = (a.slots ?? SCREEN_SLOTS.join(",")).split(",").map(Number);
  for (const s of slots) if (!ALL_SLOTS.includes(s)) { console.error(`slot ${s} refused: the screen's slots are 8101-8108`); Deno.exit(2); }
  await Deno.mkdir(`${out}/runs`, { recursive: true });
  const exists = async (p: string) => { try { await Deno.stat(p); return true; } catch { return false; } };
  const todo: { arm: Arm; h: Heredity4; slot: number; id: string }[] = [];
  for (const slot of slots) for (const arm of ARMS) for (const h of arm.hered) {
    const id = `${arm.id}.${h}.${slot}`;
    if (a.only && !id.includes(a.only)) continue;
    if (await exists(`${out}/runs/${id}.json`)) {
      const done = JSON.parse(await Deno.readTextFile(`${out}/runs/${id}.json`));
      if (done.steps !== steps) { console.error(`${id} exists with ${done.steps} steps, not ${steps}; use a fresh --out`); Deno.exit(2); }
      if (done.ledgerBadChecks) { console.error(`${id} exists with ledger residuals; remove it and its claim to rerun`); Deno.exit(2); }
      if (arm.over.trailConduit !== undefined && !a["no-branch"] && done.branch === null && done.late.runValues.meanN > 0) { console.error(`${id} exists without a branch; remove it and its claim to rerun`); Deno.exit(2); }
      continue;
    }
    todo.push({ arm, h, slot, id });
  }
  const device = await myceliumDevice();
  const log = async (o: Record<string, unknown>) => await Deno.writeTextFile(logPath, JSON.stringify({ t: new Date().toISOString(), out, ...o }) + "\n", { append: true });
  let next = 0, failures = 0;
  const worker = async () => {
    while (next < todo.length) {
      const { arm, h, slot, id } = todo[next++];
      const claim = `${out}/runs/${id}.claim`;
      if (a.reclaim) { try { await Deno.remove(claim); } catch { /* none */ } }
      try { (await Deno.open(claim, { createNew: true, write: true })).close(); } catch { console.error(`${id} is claimed by another process; skipped`); continue; }
      const cfg = screenConfig(arm, h, slot);
      await log({ id, state: "started", steps, worldSeed: cfg.seed, slot, arm: arm.id, heredity: h, over: arm.over });
      const t0 = performance.now();
      try {
        const res = await runOne(device, arm, h, slot, steps, !a["no-branch"]);
        const seconds = +((performance.now() - t0) / 1000).toFixed(1);
        await Deno.writeTextFile(`${out}/runs/${id}.json.tmp`, JSON.stringify({ id, armId: arm.id, stratum: arm.stratum, heredity: h, slot, seconds, ...res }));
        await Deno.rename(`${out}/runs/${id}.json.tmp`, `${out}/runs/${id}.json`);
        if (res.ledgerBadChecks) failures++;
        const late = (res as any).late;
        await log({ id, state: "finished", seconds, ledgerChecks: res.ledgerChecks, ledgerBadChecks: res.ledgerBadChecks, minN: res.minN, lateTM: late.runValues.TM, lateN: late.runValues.meanN });
        console.error(`${id} done in ${seconds}s: ledger bad ${res.ledgerBadChecks}/${res.ledgerChecks}, n(late) ${late.runValues.meanN?.toFixed(0)}, TM(late) ${late.runValues.TM?.toFixed(3)}`);
      } catch (e) {
        failures++;
        try { await Deno.remove(claim); } catch { /* none */ }
        await log({ id, state: "failed", seconds: +((performance.now() - t0) / 1000).toFixed(1), error: String((e as Error).message ?? e), residual: (e as any).residual === true, step: (e as any).step ?? null });
        console.error(`${id} FAILED: ${(e as Error).message}`);
      }
    }
  };
  console.error(`${todo.length} runs, ${steps} steps, jobs ${jobs}`);
  await Promise.all(Array.from({ length: jobs }, worker));
  console.error(failures ? `${failures} runs failed or had ledger residuals` : "all ledgers exact");
  Deno.exit(failures ? 1 : 0);
}
void CONDUIT_KEYS;
