// The sharper rerun of the post-takeover test: docs/soup-evolution-rerun-2026-10-31.md.
// Reuses run 1's frozen competitors (runs/soup/evo/plan.json); run 1's own code
// (tools/soup-evo.ts) is untouched.
//
//   deno run -A tools/soup-evo2.ts plan --pilot [--out runs/soup/evo2-pilot]
//       the 8 pilot races (wm6 and wm8, first two competitors, seeds 901-902, 1,024 epochs)
//   deno run -A tools/soup-evo2.ts pilot-check [--out runs/soup/evo2-pilot]
//       the go / fall-back rule -> prints H
//   deno run -A tools/soup-evo2.ts plan --horizon 1024|512 [--out runs/soup/evo2]
//       every pair (both directions) and the two-marker controls -> <out>/jobs.jsonl
//   deno run -A tools/soup-evo.ts assay --out <out> [--shard i/n]      (run 1's runner, unchanged)
//   deno run -A tools/soup-evo2.ts analyze [--out runs/soup/evo2]
//       verdicts and headline -> <out>/results.json, and a summary
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import {
  type AssayJob, type AssayResult, hex, intransitive, lineageVerdict, markForms, permPairOutcome, permutationP, rankMarkers, refOf,
  type TypeRow,
} from "./soup/evo.ts";

const a = parseArgs(Deno.args, { string: ["out", "from", "horizon"], boolean: ["pilot"], default: { from: "runs/soup/evo/plan.json" } });
const cmd = String(a._[0] ?? "");
const out = String(a.out ?? (a.pilot || cmd === "pilot-check" ? "runs/soup/evo2-pilot" : "runs/soup/evo2"));

interface Competitor { id: string; firstLead: number; epoch: number; row: TypeRow }
interface Run1Lineage { key: string; changes: number; competitors: Competitor[] }
const NUM = 16384;

const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; };
const formsOf = (r: Pick<TypeRow, "rep" | "mirror">) => r.mirror ? [r.rep, r.mirror] : [r.rep];
const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const readJobs = async (dir: string): Promise<AssayJob[]> => (await Deno.readTextFile(`${dir}/jobs.jsonl`)).trim().split("\n").map((l) => JSON.parse(l));
async function readResult(dir: string, id: string): Promise<AssayResult | null> {
  try { return JSON.parse(await Deno.readTextFile(`${dir}/assays/${id}.json`)); } catch { return null; }
}

/** Fixed in the doc: H = 1,024 with seeds 101-108 (marker control 201-208), or the fall-back H = 512 with 101-116 (201-216). */
function design(h: number) {
  if (h === 1024) return { epochs: 1024, seeds: range(101, 108), mseeds: range(201, 208), minValid: 6, validAt: [512] };
  if (h === 512) return { epochs: 512, seeds: range(101, 116), mseeds: range(201, 216), minValid: 12, validAt: [] as number[] };
  throw new Error("--horizon must be 1024 or 512");
}

const pairId = (L: string, x: { id: string }, y: { id: string }, rare: { id: string }, s: number) => `${L}-pair-${x.id}-${y.id}-r${rare.id}-s${s}`;
function pairJobs(L: string, x: Competitor, y: Competitor, seeds: number[], epochs: number, validAt: number[]): AssayJob[] {
  const jobs: AssayJob[] = [];
  for (const [rare, common] of [[x, y], [y, x]]) for (const s of seeds) {
    const id = pairId(L, x, y, rare, s);
    jobs.push({ id, kind: "pair", lineage: L, rare: rare.id, common: common.id, rareForms: formsOf(rare.row), commonForms: formsOf(common.row), seed: fnv(id), num: NUM, epochs, every: 64, ...(validAt.length ? { validAt } : {}) });
  }
  return jobs;
}

// Never replan over existing jobs or results: ids overlap between designs and the runner skips done ones.
async function refuseReplan() {
  for (const f of ["jobs.jsonl", "plan.json"]) {
    try { await Deno.stat(`${out}/${f}`); throw new Error(`${out}/${f} exists: refusing to replan (use a fresh --out)`); } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  }
}

async function write(jobs: AssayJob[], meta: unknown) {
  await Deno.mkdir(`${out}/assays`, { recursive: true });
  await Deno.writeTextFile(`${out}/plan.json`, JSON.stringify(meta, null, 1));
  await Deno.writeTextFile(`${out}/jobs.jsonl`, jobs.map((j) => JSON.stringify(j)).join("\n") + "\n");
  console.log(`${jobs.length} jobs -> ${out}/jobs.jsonl`);
}

if (cmd === "plan") await refuseReplan();
const run1: Run1Lineage[] = JSON.parse(await Deno.readTextFile(String(a.from))).lineages;

if (cmd === "plan" && a.pilot) {
  const jobs: AssayJob[] = [];
  for (const key of ["wm6", "wm8"]) {
    const L = run1.find((l) => l.key === key)!;
    jobs.push(...pairJobs(key, L.competitors[0], L.competitors[1], [901, 902], 1024, []));
  }
  await write(jobs, { pilot: true, from: a.from });
} else if (cmd === "pilot-check") {
  const jobs = await readJobs(out);
  const rows = [];
  let go = true;
  for (const j of jobs) {
    const r = await readResult(out, j.id);
    const other = r ? r.final.other / NUM : NaN;
    const ok = !!r && r.final.epoch === 1024 && r.valid && other <= 0.5;
    if (!ok) go = false;
    rows.push({ id: j.id, done: !!r, valid: r?.valid ?? null, other: Number.isFinite(other) ? Number(other.toFixed(3)) : null, f: r?.final.f ?? null, ok });
  }
  console.table(rows);
  console.log(rows.every((r) => r.done) ? `H = ${go ? 1024 : 512}` : "pilot incomplete");
} else if (cmd === "plan") {
  const d = design(Number(a.horizon));
  const jobs: AssayJob[] = [];
  const controls = [];
  for (const L of run1) {
    const c = L.competitors;
    for (let x = 0; x < c.length; x++) for (let y = x + 1; y < c.length; y++) jobs.push(...pairJobs(L.key, c[x], c[y], d.seeds, d.epochs, d.validAt));
    // Two-marker control on L0: the two best markers by run 1's procedure.
    const ref = refOf(c[0].row);
    const ranked = rankMarkers(ref);
    if (ranked.length < 2) { controls.push({ lineage: L.key, markers: ranked, control: "no marker control" }); continue; }
    const [m1, m2] = ranked;
    controls.push({ lineage: L.key, markers: [m1, m2], control: "two-marker" });
    const f1 = markForms(ref, m1.pos, m1.value).map(hex), f2 = markForms(ref, m2.pos, m2.value).map(hex);
    for (const oneRare of [true, false]) for (const s of d.mseeds) {
      const id = `${L.key}-mpair-${c[0].id}-m${oneRare ? 1 : 2}-rare-s${s}`;
      jobs.push({
        id, kind: "mpair", lineage: L.key, rare: `${c[0].id}^${oneRare ? 1 : 2}`, common: `${c[0].id}^${oneRare ? 2 : 1}`,
        rareForms: oneRare ? f1 : f2, commonForms: oneRare ? f2 : f1, seed: fnv(id), num: NUM, epochs: d.epochs, every: 64,
        marker: oneRare ? m1 : m2, marker2: oneRare ? m2 : m1, ...(d.validAt.length ? { validAt: d.validAt } : {}),
      });
    }
  }
  await write(jobs, { horizon: d.epochs, seeds: d.seeds, mseeds: d.mseeds, minValid: d.minValid, from: a.from, lineages: run1.map((l) => ({ key: l.key, changes: l.changes, competitors: l.competitors.map((c) => c.id) })), controls });
} else if (cmd === "analyze") {
  const plan = JSON.parse(await Deno.readTextFile(`${out}/plan.json`));
  const d = design(plan.horizon);
  const jobs = await readJobs(out);
  const results = new Map<string, AssayResult>();
  for (const j of jobs) { const r = await readResult(out, j.id); if (r) results.set(j.id, r); }
  const missing = jobs.length - results.size;
  // f at an epoch, from a run valid at that epoch; null otherwise.
  const fAt = (r: AssayResult | undefined, epoch: number) => {
    if (!r) return null;
    const valid = epoch === plan.horizon ? r.valid : r.validAt?.[epoch];
    const pt = r.points.find((p) => p.epoch === epoch);
    return valid && pt && Number.isFinite(pt.f) ? pt.f : null;
  };
  const readings = plan.horizon === 1024 ? [1024, 512] : [512];

  // Score the rerun's own saved inputs, never a freshly read run 1 plan.
  const saved: { key: string; changes: number; competitors: string[] }[] = plan.lineages;
  const lineages = [];
  for (const S of saved) {
    const L = { key: S.key, changes: S.changes }, comp = S.competitors.map((id) => ({ id })), k = comp.length;
    const byReading: Record<number, unknown> = {};
    for (const epoch of readings) {
      const pairs = [], wins: [number, number][] = [];
      for (let x = 0; x < k; x++) for (let y = x + 1; y < k; y++) {
        const fs = (rare: { id: string }) => d.seeds.map((s) => fAt(results.get(pairId(L.key, comp[x], comp[y], rare, s)), epoch));
        const aRare = fs(comp[x]), bRare = fs(comp[y]);
        const o = permPairOutcome(aRare, bRare, d.minValid);
        pairs.push({ a: comp[x].id, b: comp[y].id, ...o, aRare, bRare });
        if (o.outcome === "a") wins.push([x, y]); else if (o.outcome === "b") wins.push([y, x]);
      }
      const resolved = wins.length, failed = pairs.filter((p) => p.outcome === "failed").length;
      const perm = resolved ? permutationP(k, wins) : { laterWins: 0, p: null };
      const v = lineageVerdict(perm.laterWins, resolved, pairs.length, failed, perm.p);
      byReading[epoch] = {
        pairs, resolved, failed, laterWins: perm.laterWins, p: perm.p, ...v,
        cyclic: intransitive(wins.map(([w, l]) => [comp[w].id, comp[l].id])), coexist: pairs.filter((p) => p.outcome === "coexist").map((p) => [p.a, p.b]),
      };
    }
    const mj = jobs.filter((j) => j.kind === "mpair" && j.lineage === L.key);
    const control = mj.length
      ? (() => {
        const one = mj.filter((j) => j.rare.endsWith("^1")).map((j) => fAt(results.get(j.id), plan.horizon));
        const two = mj.filter((j) => j.rare.endsWith("^2")).map((j) => fAt(results.get(j.id), plan.horizon));
        return { ...permPairOutcome(one, two, d.minValid), oneRare: one, twoRare: two };
      })()
      : { outcome: "no marker control" };
    const turnover = L.changes >= 3 ? "TURNOVER" : L.changes === 0 ? "no turnover" : "some turnover";
    lineages.push({ key: L.key, changes: L.changes, turnover, competitors: comp.map((c) => c.id), primary: byReading[plan.horizon], secondary512: plan.horizon === 1024 ? byReading[512] : null, control });
  }
  // deno-lint-ignore no-explicit-any
  const verdictOf = (l: any) => l.primary.verdict;
  const turnoverN = lineages.filter((l) => l.turnover === "TURNOVER").length;
  const bothN = lineages.filter((l) => l.turnover === "TURNOVER" && verdictOf(l) === "ADAPTIVE").length;
  const stasisN = lineages.filter((l) => l.turnover === "no turnover").length;
  const headline = bothN >= 2 ? "Evolution continues: later copiers beat earlier ones"
    : turnoverN >= 2 ? "Copiers keep replacing each other; improvement not shown"
    : stasisN >= 2 ? "Stasis after takeover" : "Little turnover";
  const summary = {
    headline: missing ? `INCOMPLETE (${missing} of ${jobs.length} jobs missing): ${headline}` : headline,
    horizon: plan.horizon, missing,
    lineages: lineages.map((l) => {
      // deno-lint-ignore no-explicit-any
      const p = l.primary as any, s = l.secondary512 as any;
      return {
        key: l.key, turnover: l.turnover, competitors: l.competitors.length, verdict: p.verdict, resolved: p.resolved, laterWins: p.laterWins, p: p.p, failed: p.failed,
        cyclic: p.cyclic.length, coexist: p.coexist.length, control: l.control.outcome, at512: s ? `${s.verdict} (${s.laterWins}/${s.resolved})` : null,
      };
    }),
  };
  await Deno.writeTextFile(`${out}/results.json`, JSON.stringify({ summary, lineages }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
} else {
  console.error("usage: soup-evo2.ts plan --pilot | pilot-check | plan --horizon 1024|512 | analyze  [--out dir]");
  Deno.exit(2);
}
