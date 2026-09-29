// Analysis of the foundations review (docs/plan.md, "M4 pivot: foundations review" and its
// "Operational definitions"). CPU only; reads run bundles and the JSON written by tools/assay.ts,
// streaming the large tables. Results go to --out (default runs/foundations/results).
//
//   deno run -A tools/foundations.ts validate            replays against their originals
//   deno run -A tools/foundations.ts t2-screen           test 2 screen -> confirmation candidates
//   deno run -A tools/foundations.ts t2                  test 2 with confirmations
//   deno run -A tools/foundations.ts t4                  test 4 time-shift fitness and gate counts
//   deno run -A tools/foundations.ts t1-plan | t1        test 1 garden plan, then slopes
//   deno run -A tools/foundations.ts t3-plan | t3        test 3 descendant co-culture plan, then origination
//   deno run -A tools/foundations.ts t5-plan | t5        test 5 genomes from the 9e5 checkpoints, then results
//   deno run -A tools/foundations.ts t6                  test 6 measures
//   deno run -A tools/foundations.ts gate                the decision gate from the saved results
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { G, GENOME_CHANNELS, M3_FOUNDERS, cellCount, decodeCheckpoint, encodeGenome, founderGenome } from "@bl/schema";
import { CH, allocState, defaultConfig } from "@bl/schema";
import { DEFAULT_CENSUS, census, classify, mannWhitney, morphology, passesProbabilityGate, binomialLowerBound, type Role } from "@bl/metrics";
import { ACTIVITY_THRESHOLDS } from "../experiments/endpoints.ts";
import { lineageCensuses } from "./lib/bundle.ts";
import type { Evaluation, RepEval } from "@bl/search";

const a = parseArgs(Deno.args, {
  string: ["out", "dir", "confirm", "replay", "orig", "histories", "preset", "per"],
  default: { out: "runs/foundations/results", per: "200" },
});
const cmd = String(a._[0] ?? "");
const OUT = a.out;
await Deno.mkdir(OUT, { recursive: true });

// ---------------------------------------------------------------------------------------------
// Helpers.

/** Lines of a text file, streamed. */
export async function* lines(path: string): AsyncGenerator<string> {
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
export async function* tsv(path: string): AsyncGenerator<Record<string, string>> {
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
const exists = async (p: string) => {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
};
async function jsonFiles(dir: string): Promise<any[]> {
  const out: any[] = [];
  for await (const e of Deno.readDir(dir)) if (e.isFile && e.name.endsWith(".json")) out.push({ _file: e.name, ...JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`)) });
  return out.sort((x, y) => (x._file < y._file ? -1 : 1));
}
async function sha256File(path: string): Promise<string> {
  const buf = await Deno.readFile(path);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function quantileSorted(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const pos = (xs.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}
export const median = (xs: number[]) => quantileSorted(xs.slice().sort((p, q) => p - q), 0.5);
/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const save = async (name: string, v: unknown) => {
  await Deno.writeTextFile(`${OUT}/${name}`, JSON.stringify(v, null, 1));
  console.log(`wrote ${OUT}/${name}`);
};

// ---------------------------------------------------------------------------------------------
// Replay validation: a replay is accepted when series.jsonl and lineages.tsv equal the original's.

async function validate() {
  const pairs: [string, string][] = [
    ["runs/replay-m4", "runs/m4"],
    ["runs/replay-calib", "runs/calib-neutral"],
  ];
  const rows: any[] = [];
  for (const [rep, orig] of pairs) {
    if (!(await exists(rep))) continue;
    for await (const p of Deno.readDir(rep))
      for await (const c of Deno.readDir(`${rep}/${p.name}`))
        for await (const s of Deno.readDir(`${rep}/${p.name}/${c.name}`)) {
          const d = `${rep}/${p.name}/${c.name}/${s.name}`, o = `${orig}/${p.name}/${c.name}/${s.name}`;
          const m = JSON.parse(await Deno.readTextFile(`${d}/manifest.json`));
          if (!m.summary) {
            rows.push({ run: d, status: "incomplete" });
            continue;
          }
          const same: Record<string, boolean> = {};
          for (const f of ["series.jsonl", "lineages.tsv"]) same[f] = (await sha256File(`${d}/${f}`)) === (await sha256File(`${o}/${f}`));
          rows.push({ run: d, status: same["series.jsonl"] && same["lineages.tsv"] ? "accepted" : "REJECTED", ...same });
        }
  }
  rows.sort((x, y) => (x.run < y.run ? -1 : 1));
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  console.log(`replays: ${count("accepted")} accepted, ${count("REJECTED")} rejected, ${count("incomplete")} incomplete`);
  for (const r of rows.filter((r) => r.status === "REJECTED")) console.log(`  REJECTED ${r.run}`, r);
  await save("validate.json", rows);
}

// ---------------------------------------------------------------------------------------------
// Test 2: mutation neighbourhood.

const TRAITS = ["recovery", "mass", "meanMass", "individuals", "speed", "reproduction"] as const;
type Trait = (typeof TRAITS)[number];
const repTrait = (r: RepEval, t: Trait) => r[t];
/** One estimator throughout test 2: the unweighted mean of per-tile values, a dead tile counting 0 for every trait. */
const tileValue = (x: RepEval, t: Trait) => (x.alive ? repTrait(x, t) : 0);
const tileMean = (e: Evaluation, t: Trait) => e.perRep!.reduce((s, x) => s + tileValue(x, t), 0) / e.perRep!.length;

interface ParentRef {
  f: number;
  slots: number;
  survival: number;
  lightDependent: number;
  role: Role;
  range95: Record<Trait, [number, number]>;
  tiles: RepEval[];
}

function parentRefs(units: any[]): Map<number, ParentRef> {
  const by = new Map<number, Evaluation[]>();
  for (const u of units) by.set(u.f, [...(by.get(u.f) ?? []), ...u.parent]);
  const out = new Map<number, ParentRef>();
  for (const [f, evs] of by) {
    const reps = evs.reduce((s, e) => s + e.reps, 0);
    const sums = evs.reduce((s, e) => ({ photo: s.photo + e.roleSums!.photo, grow: s.grow + e.roleSums!.grow, decomp: s.decomp + e.roleSums!.decomp }), { photo: 0, grow: 0, decomp: 0 });
    const range95 = {} as Record<Trait, [number, number]>;
    for (const t of TRAITS) {
      const xs = evs.map((e) => tileMean(e, t)).sort((p, q) => p - q);
      range95[t] = [quantileSorted(xs, 0.025), quantileSorted(xs, 0.975)];
    }
    out.set(f, {
      f,
      slots: evs.length,
      survival: evs.reduce((s, e) => s + e.survived, 0) / reps,
      lightDependent: evs.reduce((s, e) => s + e.lightDependent, 0) / reps,
      role: classify(sums.photo, sums.grow, sums.decomp),
      range95,
      tiles: evs.flatMap((e) => e.perRep!),
    });
  }
  return out;
}

function screenMutant(e: Evaluation, p: ParentRef) {
  const viable = e.survived / e.reps >= p.survival - 0.1 && e.lightDependent / e.reps >= p.lightDependent - 0.1;
  const flags: { trait: Trait; side: 1 | -1 }[] = [];
  for (const t of TRAITS) {
    const v = tileMean(e, t), [lo, hi] = p.range95[t];
    if (v < lo) flags.push({ trait: t, side: -1 });
    else if (v > hi) flags.push({ trait: t, side: 1 });
  }
  const roleChanging = e.role !== p.role;
  return { viable, changed: flags.length > 0, flags, roleChanging, role: e.role };
}

async function t2Screen() {
  const units = await jsonFiles(a.dir ?? "runs/found-t2/screen");
  const refs = parentRefs(units);
  const rows: any[] = [];
  for (const u of units)
    for (const m of u.mutants) {
      const p = refs.get(u.f)!;
      rows.push({ f: u.f, s: u.s, m: m.m, unchanged: m.unchanged, slot: m.slot, delta: m.delta, ...screenMutant(m.eval, p) });
    }
  rows.sort((x, y) => x.s - y.s || x.f - y.f || x.m - y.m);
  const summary: any[] = [];
  for (const s of [...new Set(rows.map((r) => r.s))].sort((x, y) => y - x))
    for (const f of [...refs.keys()].sort((x, y) => x - y)) {
      const rs = rows.filter((r) => r.s === s && r.f === f);
      summary.push({
        s,
        f,
        n: rs.length,
        unchanged: rs.filter((r) => r.unchanged).length,
        viable: rs.filter((r) => r.viable).length,
        viableChanged: rs.filter((r) => r.viable && r.changed).length,
        viableRoleChanging: rs.filter((r) => r.viable && r.roleChanging).length,
      });
    }
  const candidates = rows.filter((r) => r.s === 24 && r.viable && (r.changed || r.roleChanging)).map((r) => ({ f: r.f, s: r.s, m: r.m }));
  const refOut = [...refs.values()].map(({ tiles: _t, ...r }) => r);
  await save("t2-screen.json", { parents: refOut, summary, rows });
  await Deno.writeTextFile(`${OUT}/t2-candidates.json`, JSON.stringify(candidates));
  console.log(`screen: ${rows.length} mutants from ${units.length} units; ${candidates.length} step-24 candidates for confirmation`);
  for (const s of [24, 8, 4]) {
    const rs = rows.filter((r) => r.s === s);
    if (rs.length) console.log(`  step ${s}: ${rs.length} mutants, ${rs.filter((r) => r.unchanged).length} unchanged, ${rs.filter((r) => r.viable).length} viable, ${rs.filter((r) => r.viable && r.changed).length} viable+changed, ${rs.filter((r) => r.viable && r.roleChanging).length} viable+role-changing`);
  }
}

async function t2() {
  const screen = JSON.parse(await Deno.readTextFile(`${OUT}/t2-screen.json`));
  const units = await jsonFiles(a.dir ?? "runs/found-t2/screen");
  const refs = parentRefs(units);
  const conf = await jsonFiles(a.confirm ?? "runs/found-t2/confirm");
  const byKey = new Map<string, any>(screen.rows.map((r: any) => [`${r.f}:${r.s}:${r.m}`, r]));
  const r = rng(4_150_000);
  // Central 99% of 2,000 bootstrap 32-tile means of each founder's parent screen tiles.
  const boot = new Map<string, [number, number]>();
  const range99 = (f: number, t: Trait) => {
    const k = `${f}:${t}`;
    let v = boot.get(k);
    if (!v) {
      const tiles = refs.get(f)!.tiles;
      const means: number[] = [];
      for (let b = 0; b < 2000; b++) {
        let s = 0;
        for (let i = 0; i < 32; i++) s += tileValue(tiles[Math.floor(r() * tiles.length)], t);
        means.push(s / 32);
      }
      means.sort((p, q) => p - q);
      boot.set(k, (v = [quantileSorted(means, 0.005), quantileSorted(means, 0.995)]));
    }
    return v;
  };
  const rows: any[] = [];
  for (const u of conf)
    for (const c of u.candidates) {
      const sc = byKey.get(`${c.f}:${c.s}:${c.m}`);
      const p = refs.get(c.f)!;
      const e: Evaluation = c.eval, pe: Evaluation = c.parent;
      const thr = Math.min(p.survival - 0.1, 0.8), thrL = Math.min(p.lightDependent - 0.1, 0.8);
      const viable = passesProbabilityGate(e.survived, e.reps, thr) && passesProbabilityGate(e.lightDependent, e.reps, thrL);
      const viableLiteral = passesProbabilityGate(e.survived, e.reps, p.survival - 0.1) && passesProbabilityGate(e.lightDependent, e.reps, p.lightDependent - 0.1);
      const changedTraits = (sc.flags as { trait: Trait; side: number }[]).filter(({ trait, side }) => {
        const mean = tileMean(e, trait);
        const [lo, hi] = range99(c.f, trait);
        return side < 0 ? mean < lo : mean > hi;
      });
      const roleChanging = sc.roleChanging && e.role !== pe.role;
      rows.push({ f: c.f, s: c.s, m: c.m, unchanged: sc.unchanged, viable, viableLiteral, changed: changedTraits.length > 0, changedTraits: changedTraits.map((x) => x.trait), role: e.role, parentRole: pe.role, roleChanging, survived: e.survived, lightDependent: e.lightDependent, reps: e.reps });
    }
  const nStep24 = screen.rows.filter((x: any) => x.s === 24).length;
  const nCandidates = JSON.parse(await Deno.readTextFile(`${OUT}/t2-candidates.json`)).length;
  // Incomplete inputs decide nothing: every screen batch at all three step sizes (the parent reference
  // pools them), --per mutants per founder at step 24 (200, or the plan's fallback of 100), and every confirmation.
  const per = Number(a.per);
  const complete = units.length === 12 * 3 * Math.ceil(per / 16) && nStep24 === 12 * per && rows.length === nCandidates;
  const vc = (key: "viable" | "viableLiteral") => rows.filter((x) => x[key] && x.changed).length;
  const founders = (key: "viable" | "viableLiteral") => new Set(rows.filter((x) => x[key] && x.roleChanging).map((x) => x.f)).size;
  const result = {
    step24Mutants: nStep24,
    candidates: nCandidates,
    confirmed: rows.length,
    viableChanged: vc("viable"),
    viableChangedShare: vc("viable") / nStep24,
    foundersWithViableRoleChanging: founders("viable"),
    literal: { viableChanged: vc("viableLiteral"), viableChangedShare: vc("viableLiteral") / nStep24, foundersWithViableRoleChanging: founders("viableLiteral") },
    // Variation row, test 2 half: fewer than 1% viable and changed, or role-changing for fewer than 3 founders.
    complete,
    fails: complete ? vc("viable") / nStep24 < 0.01 || founders("viable") < 3 : null,
    failsLiteral: complete ? vc("viableLiteral") / nStep24 < 0.01 || founders("viableLiteral") < 3 : null,
  };
  await save("t2.json", { result, rows });
  console.log(JSON.stringify(result, null, 1));
}

// ---------------------------------------------------------------------------------------------
// Test 4: time-shift competition.

/** Per-history W(o, e) medians, extinction shares and the late-minus-early differences. */
function timeshiftHistories(rows: any[]) {
  const hs = [...new Set(rows.map((r) => r.h))].sort((x, y) => x - y);
  const [early, late] = [...new Set(rows.map((r) => r.o))].sort((x, y) => x - y);
  const margin = Math.log(1.1);
  return hs.map((h) => {
    const W: Record<string, number> = {}, ext: Record<string, number> = {}, n: Record<string, number> = {};
    for (const o of [early, late])
      for (const e of [early, late]) {
        const xs = rows.filter((r) => r.h === h && r.o === o && r.e === e);
        const k = `${o === early ? "early" : "late"}@${e === early ? "early" : "late"}`;
        W[k] = median(xs.map((r) => r.fitness));
        ext[k] = xs.filter((r) => r.nEnd === 0).length / Math.max(1, xs.length);
        n[k] = xs.length;
      }
    const dEarly = W["late@early"] - W["early@early"], dLate = W["late@late"] - W["early@late"];
    const homeAdvantage = W["early@early"] > W["late@early"] && W["late@late"] > W["early@late"];
    const lateBeatsEarly = dEarly >= margin && dLate >= margin;
    // The Opportunity row's residual condition: each other history shows home advantage, or neither
    // late-over-early edge clears the margin.
    const residualOk = lateBeatsEarly || homeAdvantage || (dEarly < margin && dLate < margin);
    return { h, W, extinct: ext, n, lateMinusEarly: { inEarly: dEarly, inLate: dLate }, lateBeatsEarly, homeAdvantage, residualOk };
  });
}

async function t4() {
  const load = async (d: string) => ((await exists(d)) ? (await jsonFiles(d)).filter((r) => !r.missing) : []);
  const per = timeshiftHistories(await load(a.dir ?? "runs/found-t4"));
  const ctl = timeshiftHistories(await load("runs/found-t4-neutral"));
  const full = (ps: any[], k: number) => ps.length === k && ps.every((p) => Object.values(p.n).every((x) => x === 20));
  const k = per.filter((p) => p.lateBeatsEarly).length, kc = ctl.filter((p) => p.lateBeatsEarly).length;
  const complete = full(per, 10) && full(ctl, 5);
  // Neutral control (dated note): clearing the margin in >= 3 of its 5 histories makes the verdict Inconclusive.
  const confounded = kc >= 3;
  const residualOk = per.every((p) => p.residualOk);
  const row = !complete ? "incomplete" : confounded ? "Inconclusive" : k <= 4 ? (residualOk ? "Opportunity" : "Inconclusive") : k >= 8 ? "Measurement" : "Inconclusive";
  const result = { histories: per.length, controlHistories: ctl.length, complete, lateBeatsEarly: k, controlLateBeatsEarly: kc, confounded, residualOk, margin: Math.log(1.1), row };
  await save("t4.json", { result, per, control: ctl });
  console.log(JSON.stringify(result));
  for (const [name, ps] of [["treatment", per], ["neutral", ctl]] as const)
    for (const p of ps) console.log(`  ${name} h${p.h}: late-early ${p.lateMinusEarly.inEarly.toFixed(3)} (early state), ${p.lateMinusEarly.inLate.toFixed(3)} (late state); extinct ${JSON.stringify(p.extinct)}`);
}

// ---------------------------------------------------------------------------------------------
// Test 5: lesion battery on evolved individuals.

const REPLAY = "runs/replay-m4/gradient-m3";
/** The M3 test under the probability-gate rule (packages/search/src/retest.ts passesStrictM3), on counts. */
const passesStrictM3Counts = (surv: number, regen: number, dark: number, reps: number) => reps >= 32 && [surv, regen, dark].every((k) => passesProbabilityGate(k, reps, 0.8));
const ckpt = (cond: string, h: number, t: number) => `${REPLAY}/${cond}/seed-${h}/checkpoints/t${String(t).padStart(9, "0")}.blck`;
/** Each lineage's cell count and genome words (PARAM0 onwards, hex) in a checkpointed state. */
async function lineagesAt(path: string): Promise<{ key: string; cells: number; hex: string }[]> {
  const st = decodeCheckpoint(await Deno.readFile(path)).state;
  const n = cellCount(st.cfg);
  const by = new Map<string, { key: string; cells: number; hex: string }>();
  for (let i = 0; i < n; i++) {
    const hi = st.genome[G.LIN_HI * n + i], lo = st.genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    const key = `${hi}:${lo}`;
    let v = by.get(key);
    if (!v) {
      let hex = "";
      for (let g = G.PARAM0; g < GENOME_CHANNELS; g++) hex += st.genome[g * n + i].toString(16).padStart(8, "0");
      by.set(key, (v = { key, cells: 0, hex }));
    }
    v.cells++;
  }
  return [...by.values()].sort((x, y) => y.cells - x.cells || (x.key < y.key ? -1 : 1));
}

async function t5Plan() {
  const genomes: { label: string; hex: string; cells: number }[] = [];
  for (const h of [1, 2, 3, 4, 5]) (await lineagesAt(ckpt("treatment", h, 900_000))).slice(0, 10).forEach((l, r) => genomes.push({ label: `h${h}-r${r}-${l.key}`, hex: l.hex, cells: l.cells }));
  await save("t5-plan.json", { seed0: 4_400_001, genomes });
}

async function t5() {
  const units = await jsonFiles(a.dir ?? "runs/found-t5");
  const rows = units.flatMap((u) => u.genomes.map((g: any) => ({ label: g.label, survived: g.eval.survived, regenerated: g.eval.regenerated, lightDependent: g.eval.lightDependent, reps: g.eval.reps, strictM3: passesStrictM3Counts(g.eval.survived, g.eval.regenerated, g.eval.lightDependent, g.eval.reps), role: g.eval.role })));
  const founders = M3_FOUNDERS.map((f) => ({ cluster: f.cluster, ...f.retest, strictM3: passesStrictM3Counts(f.retest.survived, f.retest.regenerated, f.retest.lightDependent, f.retest.reps) }));
  const share = (xs: any[], k: string) => xs.reduce((s, x) => s + x[k], 0) / xs.reduce((s, x) => s + x.reps, 0);
  const result = {
    evolved: rows.length,
    evolvedStrictM3: rows.filter((r) => r.strictM3).length,
    evolvedRates: { survived: share(rows, "survived"), regenerated: share(rows, "regenerated"), lightDependent: share(rows, "lightDependent") },
    founderRates: { survived: share(founders, "survived"), regenerated: share(founders, "regenerated"), lightDependent: share(founders, "lightDependent") },
    founderStrictM3: founders.filter((f) => f.strictM3).length,
  };
  await save("t5.json", { result, rows, founders });
  console.log(JSON.stringify(result, null, 1));
}

// ---------------------------------------------------------------------------------------------
// Test 1: life-cycle heredity.

interface Link {
  step: number;
  kind: string;
  parent: number;
  child: number;
  parentLineage: string;
  childLineage: string;
  parentPurity: number;
  childPurity: number;
}

async function linksOf(dir: string): Promise<Link[]> {
  const out: Link[] = [];
  for await (const r of tsv(`${dir}/births.tsv`))
    out.push({ step: +r.step, kind: r.kind, parent: +r.parent, child: +r.child, parentLineage: r.parentLineage, childLineage: r.childLineage, parentPurity: +r.parentPurity, childPurity: +r.childPurity });
  return out;
}
async function genomeHex(dir: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for await (const r of tsv(`${dir}/genomes.tsv`)) if (!m.has(r.lineage)) m.set(r.lineage, r.words);
  return m;
}
/** Individual id -> step it ended (death or absorption by fusion); absent while alive at the end. */
async function endsOf(dir: string): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  for await (const l of lines(`${dir}/life.jsonl`)) {
    if (!l) continue;
    const e = JSON.parse(l);
    if (e.kind === "death") m.set(e.id, e.step);
    else if (e.kind === "fusion") for (const id of e.parents.slice(1)) m.set(id, e.step);
  }
  return m;
}

async function t1Plan() {
  const r = rng(4_000_001);
  const pairs: any[] = [];
  for (let h = 1; h <= 10; h++) {
    const dir = `${REPLAY}/treatment/seed-${h}`;
    const g = await genomeHex(dir);
    const ok = (await linksOf(dir)).filter((l) => g.has(l.parentLineage) && g.has(l.childLineage));
    for (let k = 0; k < 20 && ok.length; k++) {
      const l = ok.splice(Math.floor(r() * ok.length), 1)[0];
      pairs.push({ h, ...l, parentHex: g.get(l.parentLineage), childHex: g.get(l.childLineage) });
    }
  }
  const plantings = pairs.flatMap((p, i) => [
    { id: `p${i}-parent`, hex: [p.parentHex] },
    { id: `p${i}-child`, hex: [p.childHex] },
  ]);
  await save("t1-pairs.json", pairs.map(({ parentHex: _a, childHex: _b, ...p }) => p));
  await save("t1-plan.json", { seed0: 4_000_101, reps: 8, growSteps: 20_000, plantings });
}

const TRAITS1 = ["reproMass", "membrane", "reproRate"] as const;
function gardenTraits(p: any) {
  const rm = p.tiles.flatMap((t: any) => t.reproMass);
  const mem = p.tiles.map((t: any) => t.membrane).filter((x: any) => x !== null);
  const ev = p.tiles.reduce((s: number, t: any) => s + t.reproductions, 0), ex = p.tiles.reduce((s: number, t: any) => s + t.exposure, 0);
  return {
    reproMass: rm.length ? rm.reduce((s: number, x: number) => s + x, 0) / rm.length : null,
    membrane: mem.length ? mem.reduce((s: number, x: number) => s + x, 0) / mem.length : null,
    reproRate: ex > 0 ? (1e4 * ev) / ex : null,
  };
}
function olsSlope(xs: number[], ys: number[]): number {
  const n = xs.length, mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  return sxx > 0 ? sxy / sxx : NaN;
}

async function t1() {
  const pairs = JSON.parse(await Deno.readTextFile(`${OUT}/t1-pairs.json`));
  const plantings = new Map<string, any>();
  for (const u of await jsonFiles(a.dir ?? "runs/found-t1")) for (const p of u.plantings) plantings.set(p.id, gardenTraits(p));
  const rows = pairs.map((p: any, i: number) => ({ h: p.h, kind: p.kind, clonal: p.parentLineage === p.childLineage, parentPurity: p.parentPurity, childPurity: p.childPurity, parent: plantings.get(`p${i}-parent`), child: plantings.get(`p${i}-child`) }));
  const r = rng(4_000_002);
  const hs = [...new Set(rows.map((x: any) => x.h))] as number[];
  const slopes: Record<string, any> = {};
  for (const t of TRAITS1) {
    const ok = rows.filter((x: any) => x.parent?.[t] != null && x.child?.[t] != null);
    const est = olsSlope(ok.map((x: any) => x.parent[t]), ok.map((x: any) => x.child[t]));
    const boots: number[] = [];
    for (let b = 0; b < 2000; b++) {
      const pick = hs.map(() => hs[Math.floor(r() * hs.length)]);
      const sub = pick.flatMap((h) => ok.filter((x: any) => x.h === h));
      const v = olsSlope(sub.map((x: any) => x.parent[t]), sub.map((x: any) => x.child[t]));
      if (Number.isFinite(v)) boots.push(v);
    }
    boots.sort((p, q) => p - q);
    slopes[t] = { n: ok.length, slope: est, ci95: [quantileSorted(boots, 0.025), quantileSorted(boots, 0.975)], validBoots: boots.length };
  }
  // Chains: three links in series whose last individual lives >= 1e4 steps (from births.tsv and life.jsonl).
  const chains: any[] = [];
  for (let h = 1; h <= 10; h++) {
    const dir = `${REPLAY}/treatment/seed-${h}`;
    const links = await linksOf(dir), ends = await endsOf(dir);
    const parentOf = new Map<number, number>(), bornAt = new Map<number, number>();
    for (const l of links) if (!parentOf.has(l.child)) {
      parentOf.set(l.child, l.parent);
      bornAt.set(l.child, l.step);
    }
    const depth = (id: number) => {
      let d = 0, x = id;
      while (parentOf.has(x) && d < 3) [x, d] = [parentOf.get(x)!, d + 1];
      return d;
    };
    let viable = 0, deep = 0;
    for (const [id, born] of bornAt) {
      if (depth(id) < 3) continue;
      deep++;
      if ((ends.get(id) ?? 1_000_000) - born >= 10_000) viable++;
    }
    chains.push({ h, links: links.length, clonalShare: links.filter((l) => l.parentLineage === l.childLineage).length / Math.max(1, links.length), g3Individuals: deep, viableG3: viable, holds: viable > 0, meanParentPurity: links.reduce((s, l) => s + l.parentPurity, 0) / Math.max(1, links.length) });
  }
  const histories = chains.filter((c) => c.holds).length;
  const noSlope = TRAITS1.every((t) => !(slopes[t].ci95[0] > 0.2));
  // Incomplete inputs decide nothing: 10 histories, 200 pairs, and both plantings of every pair.
  const complete = pairs.length === 200 && rows.every((x: any) => x.parent && x.child) && chains.length === 10;
  const result = { complete, slopes, historiesWithViableChain: histories, substrateCondition: complete ? noSlope || histories < 5 : null, noSlopeAbove02: noSlope };
  await save("t1.json", { result, chains, rows });
  console.log(JSON.stringify(result, null, 1));
}

// ---------------------------------------------------------------------------------------------
// Test 3: single-founder starts.

const ROLES4: Role[] = ["phototroph", "chemotroph", "decomposer", "mixed"];
interface DeepCensus {
  step: number;
  total: number;
  share: Record<Role, number>;
  /** Lineage with the most cells in each role. */
  top: Partial<Record<Role, { key: string; cells: number }>>;
}
/** Role shares of living cells at each deep census of a run's profiles.tsv. */
async function deepCensuses(dir: string): Promise<DeepCensus[]> {
  const out: DeepCensus[] = [];
  let cur: DeepCensus | null = null;
  const flush = () => {
    if (!cur) return;
    for (const r of ROLES4) cur.share[r] = cur.total ? cur.share[r] / cur.total : 0;
    out.push(cur);
  };
  for await (const r of tsv(`${dir}/profiles.tsv`)) {
    const step = +r.step;
    if (!cur || cur.step !== step) {
      flush();
      cur = { step, total: 0, share: { phototroph: 0, chemotroph: 0, decomposer: 0, mixed: 0 }, top: {} };
    }
    const role = r.role as Role, cells = +r.cells;
    cur.total += cells;
    cur.share[role] += cells;
    if (!cur.top[role] || cells > cur.top[role]!.cells) cur.top[role] = { key: r.lineage, cells };
  }
  flush();
  return out;
}
/** Windows of consecutive deep censuses with the role's share >= 5%, spanning >= 1e5 steps. */
function qualifying(dc: DeepCensus[], role: Role): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= dc.length; i++) {
    const ok = i < dc.length && dc[i].share[role] >= 0.05;
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (dc[i - 1].step - dc[start].step >= 100_000) out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}
const soloRuns = async () => {
  const runs: { dir: string; founder: number; seed: number; mutation: boolean }[] = [];
  for (const cond of ["treatment", "no-mutation"]) {
    const root = `runs/solo/gradient-m3/${cond}`;
    if (!(await exists(root))) continue;
    for await (const e of Deno.readDir(root)) {
      const m = JSON.parse(await Deno.readTextFile(`${root}/${e.name}/manifest.json`));
      if (m.summary) runs.push({ dir: `${root}/${e.name}`, founder: m.spec.soloFounder, seed: m.spec.seed, mutation: cond === "treatment" });
    }
  }
  return runs.sort((x, y) => x.founder - y.founder || x.seed - y.seed);
};

async function t3Plan() {
  const runs = await soloRuns();
  const founderHex = (k: number) => Array.from(encodeGenome(founderGenome(M3_FOUNDERS[k]), 0, 0).subarray(G.PARAM0), (x) => x.toString(16).padStart(8, "0")).join("");
  const qual: any[] = [];
  const nmRoles = new Map<number, Set<Role>>();
  for (const r of runs.filter((r) => !r.mutation)) {
    const dc = await deepCensuses(r.dir);
    const set = nmRoles.get(r.founder) ?? new Set<Role>();
    for (const role of ROLES4) if (qualifying(dc, role).length) set.add(role);
    nmRoles.set(r.founder, set);
  }
  const candidates: any[] = [];
  for (const r of runs.filter((r) => r.mutation)) {
    const dc = await deepCensuses(r.dir);
    const g = await genomeHex(r.dir);
    const roles = ROLES4.filter((role) => qualifying(dc, role).length);
    qual.push({ founder: r.founder, seed: r.seed, mutation: true, roles });
    for (const role of roles) {
      if (nmRoles.get(r.founder)?.has(role)) continue;
      const [i, j] = qualifying(dc, role)[0];
      const mid = (dc[i].step + dc[j].step) / 2;
      const at = dc.slice(i, j + 1).reduce((b, c) => (Math.abs(c.step - mid) < Math.abs(b.step - mid) ? c : b));
      const top = at.top[role]!;
      candidates.push({ founder: r.founder, seed: r.seed, role, window: [dc[i].step, dc[j].step], descendant: top.key, atStep: at.step, hex: g.get(top.key) ?? null });
    }
  }
  for (const [f, set] of nmRoles) qual.push({ founder: f, mutation: false, roles: [...set] });
  if (candidates.some((c) => !c.hex)) throw new Error("a descendant lineage has no genome in genomes.tsv");
  const plantings = [
    ...candidates.map((c, i) => ({ id: `c${i}`, hex: [c.hex, founderHex(c.founder)] })),
    // Each founder alone: its role when it is inactive beside a descendant.
    ...M3_FOUNDERS.map((_, k) => ({ id: `f${k}`, hex: [founderHex(k)] })),
  ];
  await save("t3-candidates.json", { qualifying: qual, candidates, soloRuns: runs.length });
  await save("t3-plan.json", { seed0: 4_250_001, reps: 16, growSteps: 20_000, plantings });
  console.log(`test 3: ${runs.length} runs, ${candidates.length} candidate roles (${plantings.length} with genomes)`);
}

async function t3() {
  const { candidates, qualifying: qual, soloRuns } = JSON.parse(await Deno.readTextFile(`${OUT}/t3-candidates.json`));
  const res = new Map<string, any>();
  for (const u of await jsonFiles(a.dir ?? "runs/found-t3")) for (const p of u.plantings) res.set(p.id, p);
  // A lineage is active in the garden when it is present and catalyses; roles are only compared between active lineages.
  const fluxOf = (p: any, slot: number) => p.tiles.reduce((s: number[], t: any) => {
    const l = t.lineages[slot];
    return [s[0] + l.photo, s[1] + l.grow, s[2] + l.decomp, s[3] + l.cellCensuses];
  }, [0, 0, 0, 0]);
  const roleOf = (f: number[]) => (f[3] > 0 && f[0] + f[1] + f[2] > 0 ? classify(f[0], f[1], f[2]) : null);
  const rows = candidates.map((c: any, i: number) => {
    const p = res.get(`c${i}`);
    if (!p) return { ...c, hex: undefined, missing: true };
    const descRole = roleOf(fluxOf(p, 0));
    let founderRole = roleOf(fluxOf(p, 1)), founderFrom = "co-culture";
    if (!founderRole) {
      const m = res.get(`f${c.founder}`);
      founderRole = m ? roleOf(fluxOf(m, 0)) : null;
      founderFrom = "monoculture";
    }
    const outcome = !descRole ? "descendant inactive" : !founderRole ? "founder inactive" : descRole !== founderRole ? "different role" : "same role";
    return { ...c, hex: undefined, descendantGardenRole: descRole, founderGardenRole: founderRole, founderFrom, outcome, originates: outcome === "different role" };
  });
  const perFounder = M3_FOUNDERS.map((_, f) => {
    const seeds = new Set(rows.filter((r: any) => r.founder === f && r.originates).map((r: any) => r.seed));
    return { founder: f, runsOriginating: seeds.size, counts: seeds.size >= 3 };
  });
  const founders = perFounder.filter((p) => p.counts).length;
  // Incomplete inputs decide nothing: all 96 single-founder runs and every garden result.
  const complete = soloRuns === 96 && rows.every((r: any) => !r.missing) && M3_FOUNDERS.every((_, k) => res.has(`f${k}`));
  const result = { complete, candidates: rows.length, originating: rows.filter((r: any) => r.originates).length, outcomes: Object.fromEntries(["different role", "same role", "descendant inactive", "founder inactive"].map((o) => [o, rows.filter((r: any) => r.outcome === o).length])), foundersCounting: founders, fails: complete ? founders < 3 : null };
  await save("t3.json", { result, perFounder, rows, qualifying: qual });
  console.log(JSON.stringify(result, null, 1));
}

// ---------------------------------------------------------------------------------------------
// Test 6: measurement validation.

/** One-sided 95% Clopper–Pearson upper bound on a rate k/n. */
const binomialUpperBound = (k: number, n: number) => 1 - binomialLowerBound(n - k, n);

/** Binomial draw: inversion for small means, a clamped normal approximation otherwise. */
function binom(n: number, p: number, r: () => number): number {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  if (p > 0.5) return n - binom(n, 1 - p, r);
  const mean = n * p;
  if (mean < 30) {
    const q = 1 - p, s = p / q;
    let k = 0, pk = Math.pow(q, n), cdf = pk;
    const u = r();
    while (u > cdf && k < n) {
      pk *= (s * (n - k)) / (k + 1);
      cdf += pk;
      k++;
    }
    return k;
  }
  const u1 = r() || 1e-12, u2 = r();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.min(n, Math.round(mean + z * Math.sqrt(mean * (1 - p)))));
}

/**
 * Shadow excess: the run's cumulative new activity minus the median of `k` demography-matched
 * shadows. Each shadow keeps the run's living cells at each census and its lineage births (each
 * entering at its first-census count) and redraws the remaining cells multinomially from its own
 * previous abundances. Flagged when the run exceeds every shadow.
 */
async function shadowExcess(dir: string, threshold: number, k = 20, seed = 4_500_001) {
  const r = rng(seed);
  let prev = new Set<string>();
  const real = new Map<string, { act: number; crossed: boolean }>();
  let realNew = 0;
  const sh = Array.from({ length: k }, () => ({ counts: [] as number[], act: [] as number[], crossed: [] as boolean[], cumNew: 0 }));
  for await (const [, rows] of lineageCensuses(dir)) {
    const now = new Set<string>();
    let total = 0, bornCells = 0;
    const births: number[] = [];
    for (const [key, c] of rows) {
      if (c <= 0) continue;
      now.add(key);
      total += c;
      let v = real.get(key);
      if (!v) real.set(key, (v = { act: 0, crossed: false }));
      v.act += c;
      if (!v.crossed && v.act > threshold) {
        v.crossed = true;
        realNew++;
      }
      if (!prev.has(key)) {
        births.push(c);
        bornCells += c;
      }
    }
    for (const key of [...real.keys()]) if (!now.has(key)) real.delete(key);
    prev = now;
    const rest = Math.max(0, total - bornCells);
    for (const x of sh) {
      const mass = x.counts.reduce((s, c) => s + c, 0);
      let n = mass > 0 ? rest : 0, left = mass;
      const counts: number[] = [], act: number[] = [], crossed: boolean[] = [];
      for (let i = 0; i < x.counts.length && n > 0; i++) {
        const c = binom(n, x.counts[i] / left, r);
        left -= x.counts[i];
        n -= c;
        if (c > 0) {
          counts.push(c);
          act.push(x.act[i] + c);
          crossed.push(x.crossed[i]);
        }
      }
      for (const b of births) {
        counts.push(b);
        act.push(b);
        crossed.push(false);
      }
      for (let i = 0; i < act.length; i++)
        if (!crossed[i] && act[i] > threshold) {
          crossed[i] = true;
          x.cumNew++;
        }
      [x.counts, x.act, x.crossed] = [counts, act, crossed];
    }
  }
  const shadows = sh.map((x) => x.cumNew).sort((p, q) => p - q);
  return { real: realNew, shadowMedian: quantileSorted(shadows, 0.5), shadowMax: shadows[shadows.length - 1], excess: realNew - quantileSorted(shadows, 0.5), flagged: realNew > shadows[shadows.length - 1] };
}

/** Phenotype-bin novelty (plain and persistent) and uncapped role clusters from profiles.tsv. */
async function profileMeasures(dir: string) {
  const firstSeen = new Map<string, number>();
  const persistent = new Set<string>();
  const streak = new Map<string, number>(); // lineage|bin -> first step of its current >= 1% streak
  let lastStep = -1;
  const clusters: number[] = [];
  let rowsAt: { key: string; cells: number; mu: number; sigma: number; role: string; v: number[] }[] = [];
  const flush = (step: number) => {
    if (step < 0) return;
    const total = rowsAt.reduce((s, x) => s + x.cells, 0) || 1;
    const live = new Set<string>();
    for (const x of rowsAt) {
      if (x.cells / total < 0.01) continue;
      const bin = `${Math.floor(x.mu / 8)}:${Math.floor(x.sigma / 4)}:${x.role}`;
      if (!firstSeen.has(bin)) firstSeen.set(bin, step);
      const sk = `${x.key}|${bin}`;
      live.add(sk);
      if (!streak.has(sk)) streak.set(sk, step);
      if (step - streak.get(sk)! >= 100_000) persistent.add(bin);
    }
    for (const sk of [...streak.keys()]) if (!live.has(sk)) streak.delete(sk);
    if (step > 500_000) {
      const big = rowsAt.filter((x) => x.cells / total >= 0.05).map((x) => x.v);
      const parent = big.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      for (let i = 0; i < big.length; i++)
        for (let j = i + 1; j < big.length; j++) if (big[i].reduce((s, v, t) => s + Math.abs(v - big[j][t]), 0) < 0.2) parent[find(i)] = find(j);
      clusters.push(new Set(big.map((_, i) => find(i))).size);
    }
    rowsAt = [];
  };
  for await (const r of tsv(`${dir}/profiles.tsv`)) {
    const step = +r.step;
    if (step !== lastStep) {
      flush(lastStep);
      lastStep = step;
    }
    const f = [+r.photo, +r.grow, +r.decomp, +r.resp], sum = f.reduce((s, x) => s + x, 0) || 1;
    rowsAt.push({ key: r.lineage, cells: +r.cells, mu: +r.mu, sigma: +r.sigma, role: r.role, v: f.map((x) => x / sum) });
  }
  flush(lastStep);
  const novel = [...firstSeen].filter(([, s]) => s > 100_000).map(([b]) => b);
  return { novelty: novel.length, persistentNovelty: novel.filter((b) => persistent.has(b)).length, roleClusters: clusters.length ? clusters.reduce((s, x) => s + x, 0) / clusters.length : null };
}

/** The compartment detector on hand-built discs: a membrane rim around a biomass core, and none. */
function compartmentCheck() {
  const out: any[] = [];
  for (const radius of [2, 3, 4, 6, 10])
    for (const rim of [true, false])
      for (const at of ["centre", "tile edge"]) {
        const cfg = defaultConfig({ tileW: 64, tileH: 64, tilesX: 2, tilesY: 1 });
        const st = allocState(cfg);
        const n = cellCount(cfg), W = 128;
        const cx = at === "centre" ? 32 : 63, cy = 32;
        for (let dy = -radius; dy <= radius; dy++)
          for (let dx = -radius; dx <= radius; dx++) {
            const d2 = dx * dx + dy * dy;
            if (d2 > radius * radius) continue;
            const x = (cx + dx + 64) % 64, i = (cy + dy) * W + x;
            const edge = d2 > (radius - 1) * (radius - 1);
            st.cells[CH.B * n + i] = rim && edge ? 40 : 200;
            st.cells[CH.P * n + i] = rim && edge ? 200 : 0;
          }
        const c = census({ cfg, step: 0, cells: st.cells, genomeHead: st.genome.subarray(0, 4 * n) }, DEFAULT_CENSUS);
        out.push({ radius, rim, at, individuals: c.components.filter((k) => k.mass >= DEFAULT_CENSUS.minMass).length, compartmentalised: morphology(cfg, st.cells, c, DEFAULT_CENSUS.minMass).compartmentalised });
      }
  return out;
}

async function runDirs(root: string): Promise<{ dir: string; seed: number; spec: any }[]> {
  const out: { dir: string; seed: number; spec: any }[] = [];
  if (!(await exists(root))) return out;
  for await (const e of Deno.readDir(root)) {
    const d = `${root}/${e.name}`;
    try {
      const m = JSON.parse(await Deno.readTextFile(`${d}/manifest.json`));
      if (m.summary) out.push({ dir: d, seed: m.spec.seed, spec: m.spec });
    } catch { /* not a finished run */ }
  }
  return out.sort((x, y) => x.seed - y.seed);
}

async function t6() {
  const cacheFile = `${OUT}/t6-runs.json`;
  const cache: Record<string, any> = (await exists(cacheFile)) ? JSON.parse(await Deno.readTextFile(cacheFile)) : {};
  const measure = async (dir: string, preset: string, withProfiles: boolean) => {
    if (!cache[dir]) {
      const t0 = performance.now();
      cache[dir] = { preset, ...(await shadowExcess(dir, ACTIVITY_THRESHOLDS[preset].value!)), ...(withProfiles && (await exists(`${dir}/profiles.tsv`)) ? await profileMeasures(dir) : {}) };
      await Deno.writeTextFile(cacheFile, JSON.stringify(cache));
      console.log(`  ${dir} (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
    }
    return cache[dir];
  };
  const group = async (root: string, preset: string, profiles = true, filter: (s: any) => boolean = () => true) => {
    const out: any[] = [];
    for (const r of (await runDirs(root)).filter((r) => filter(r.spec))) out.push({ seed: r.seed, ...(await measure(r.dir, preset, profiles)) });
    return out;
  };
  // Worlds known to differ (test 6).
  const T = await group("runs/replay-m4/gradient-m3/treatment", "gradient-m3");
  const NM = await group("runs/replay-m4/gradient-m3/no-mutation", "gradient-m3");
  const soloNM = await group("runs/solo/gradient-m3/no-mutation", "gradient-m3");
  // Null checks: the 70 neutral runs, replayed with the observers (profiles), shadows from lineages.tsv.
  const neutral = [
    ...(await group("runs/replay-calib/gradient-m3/neutral", "gradient-m3")),
    ...(await group("runs/replay-calib/spots-m3/neutral", "spots-m3")),
    ...(await group("runs/replay-m4/gradient-m3/neutral", "gradient-m3")),
    ...(await group("runs/replay-m4/spots-m3/neutral", "spots-m3")),
  ];
  const effect = (x: number[], y: number[]) => (x.length && y.length ? mannWhitney(x, y).effect : null);
  const vals = (xs: any[], k: string) => xs.map((x) => x[k]).filter((v) => v !== null && v !== undefined) as number[];
  const flagRate = (k: string, test: (x: any) => boolean) => {
    const xs = neutral.filter((x) => x[k] !== undefined && x[k] !== null);
    const f = xs.filter(test).length;
    return { flagged: f, of: xs.length, upper95: xs.length ? binomialUpperBound(f, xs.length) : null, passes: xs.length === 70 && binomialUpperBound(f, xs.length) < 0.1 };
  };
  // Between-condition sanity check: 1,000 random 10/10 splits of each preset's pilot, one-sided at alpha 0.05.
  const splits = (k: string) => {
    const r = rng(4_500_101);
    const res: Record<string, number> = {};
    for (const preset of ["gradient-m3", "spots-m3"]) {
      const xs = neutral.filter((x) => x.preset === preset && x.seed >= 1001 && x.seed <= 1020 && x[k] != null).map((x) => x[k] as number);
      if (xs.length !== 20) continue;
      let rej = 0;
      for (let b = 0; b < 1000; b++) {
        const idx = xs.map((_, i) => i);
        for (let i = idx.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [idx[i], idx[j]] = [idx[j], idx[i]];
        }
        const A = idx.slice(0, 10).map((i) => xs[i]), B = idx.slice(10).map((i) => xs[i]);
        if (mannWhitney(A, B).pGreater < 0.05) rej++;
      }
      res[preset] = rej / 1000;
    }
    return res;
  };
  const measures = {
    shadowExcess: {
      treatmentVsNoMutation: effect(vals(T, "excess"), vals(NM, "excess")),
      null: flagRate("flagged", (x) => x.flagged),
      splits: splits("excess"),
    },
    novelty: {
      treatmentVsNoMutation: effect(vals(T, "novelty"), vals(NM, "novelty")),
      noMutationMedian: median(vals(NM, "novelty")),
      soloNoMutationMedian: median(vals(soloNM, "novelty")),
      null: flagRate("novelty", (x) => x.novelty > 0),
      splits: splits("novelty"),
    },
    persistentNovelty: {
      treatmentVsNoMutation: effect(vals(T, "persistentNovelty"), vals(NM, "persistentNovelty")),
      noMutationMedian: median(vals(NM, "persistentNovelty")),
      soloNoMutationMedian: median(vals(soloNM, "persistentNovelty")),
      null: flagRate("persistentNovelty", (x) => x.persistentNovelty > 0),
      splits: splits("persistentNovelty"),
    },
    roleClusters: {
      noMutationVsSoloNoMutation: effect(vals(NM, "roleClusters"), vals(soloNM, "roleClusters")),
      treatmentMean: vals(T, "roleClusters").reduce((s, x) => s + x, 0) / Math.max(1, T.length),
      splits: splits("roleClusters"),
    },
    compartment: compartmentCheck(),
  };
  await save("t6.json", { measures, runs: { treatment: T, noMutation: NM, soloNoMutation: soloNM, neutral } });
  console.log(JSON.stringify({ ...measures, compartment: measures.compartment.map((c: any) => `${c.radius}${c.rim ? "rim" : ""}@${c.at}:${c.compartmentalised}/${c.individuals}`).join(" ") }, null, 1));
}

// ---------------------------------------------------------------------------------------------
// The decision gate (docs/plan.md): rows checked in order, the first whose condition holds decides.

async function gate() {
  const load = async (f: string) => ((await exists(`${OUT}/${f}`)) ? JSON.parse(await Deno.readTextFile(`${OUT}/${f}`)).result : null);
  const [t1r, t2r, t3r, t4r] = [await load("t1.json"), await load("t2.json"), await load("t3.json"), await load("t4.json")];
  const notes: string[] = [];
  let row: string | null = null;
  // Substrate: test 1's condition, and then a life-cycle MAP-Elites search that also finds none.
  if (!t1r || t1r.substrateCondition === null) notes.push("test 1 incomplete");
  else if (t1r.substrateCondition) {
    const me = await load("mapelites.json");
    if (!me || me.complete !== true || typeof me.found !== "boolean") notes.push("test 1 meets the Substrate condition; the life-cycle MAP-Elites search has not run to completion");
    else if (me.found === false) row = "Substrate";
    else notes.push("test 1 meets the Substrate condition, but the MAP-Elites search found a heritable life cycle");
  }
  // Variation: tests 2 and 3 both fail.
  if (!row) {
    if (!t2r || t2r.fails === null) notes.push("test 2 incomplete");
    if (!t3r || t3r.fails === null) notes.push("test 3 incomplete");
    if (t2r?.fails === true && t3r?.fails === true) row = "Variation";
    else if (t2r?.fails === true || t3r?.fails === true) notes.push(`only test ${t2r?.fails === true ? 2 : 3} fails; recorded, and the gate moves on to test 4`);
  }
  // Opportunity, Measurement or Inconclusive: test 4's row (already Inconclusive when its neutral control is confounded).
  if (!row) {
    if (!t4r || t4r.row === "incomplete") notes.push("test 4 incomplete");
    else row = t4r.row;
  }
  // Anything undecided within the time box and budget is Inconclusive; an earlier incomplete test
  // cannot be skipped over, since it could have decided first.
  const blocking = notes.filter((n) => n.includes("incomplete") || n.includes("has not run to completion"));
  const decided = blocking.length === 0 && row !== null;
  const result = { row: decided ? row : "Inconclusive", decided, candidateRow: row, notes, t1: t1r, t2: t2r, t3: t3r, t4: t4r };
  await save("gate.json", result);
  console.log(JSON.stringify({ row: result.row, decided, candidateRow: row, notes }, null, 1));
}

// ---------------------------------------------------------------------------------------------

switch (cmd) {
  case "validate":
    await validate();
    break;
  case "t2-screen":
    await t2Screen();
    break;
  case "t2":
    await t2();
    break;
  case "t4":
    await t4();
    break;
  case "t5-plan":
    await t5Plan();
    break;
  case "t5":
    await t5();
    break;
  case "t3-plan":
    await t3Plan();
    break;
  case "t3":
    await t3();
    break;
  case "t6":
    await t6();
    break;
  case "gate":
    await gate();
    break;
  case "shadow-one":
    console.log(JSON.stringify(await shadowExcess(a.dir!, ACTIVITY_THRESHOLDS[a.preset ?? "gradient-m3"].value!)));
    break;
  case "t1-plan":
    await t1Plan();
    break;
  case "t1":
    await t1();
    break;
  default:
    throw new Error(`unknown subcommand '${cmd}'`);
}
