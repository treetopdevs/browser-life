// Red Queen for copiers: docs/soup-redqueen-2026-11-01.md.
//
//   deno run -A tools/soup-rq.ts plan [--out runs/soup/rq] [--with-c]
//       panel -> <out>/panel.json; races -> <out>/races/jobs.jsonl (Part A; with --with-c also
//       Part C's finals and head-to-heads, once all 18 hall runs have a summary.json).
//       Existing jobs are kept exactly; a plan that would change one is refused.
//   deno run -A tools/soup-evo.ts assay --out <out>/races [--gpu] [--shard i/n]
//   deno run -A tools/soup-rq.ts analyze [--out runs/soup/rq]  -> <out>/results.json and a summary
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { type AssayJob, type AssayResult, permPairOutcome, spearman, TypeRef, unhex } from "./soup/evo.ts";
import { ARMS, fnv } from "./soup/hall.ts";
import {
  aVerdict, bounded, cVerdict, type FailedMode, MODES, net, type Player, playerKey, pooledOrderTest, type Side, sideOf, signFlip, sustainedSeries,
} from "./soup/rq.ts";

const a = parseArgs(Deno.args, { string: ["out", "from", "hall"], boolean: ["with-c"], default: { from: "runs/soup/evo/plan.json" } });
const cmd = String(a._[0] ?? "");
const out = String(a.out ?? "runs/soup/rq");
const hallDir = String(a.hall ?? `${out}/hall`);
const racesDir = `${out}/races`;
const NUM = 16384, SEEDS = [401, 402, 403, 404, 405, 406, 407, 408], MIN_VALID = 6;
const LINEAGES = ["wm2", "wm6", "wm8", "g1"], HALL_LINEAGES = ["wm2", "wm6", "wm8"], REPS = [1, 2, 3];

interface Run1Competitor { id: string; row: { rep: string; mirror: string | null } }
interface Run1Lineage { key: string; from: number; epochs: number[]; leaders: (string | null)[]; competitors: Run1Competitor[] }
const run1: Run1Lineage[] = JSON.parse(await Deno.readTextFile(String(a.from))).lineages;
const lineageOf = (k: string) => run1.find((l) => l.key === k)!;
const playerOf = (c: Run1Competitor): Player => ({ id: c.id, forms: c.row.mirror ? [c.row.rep, c.row.mirror] : [c.row.rep] });

// The panel: first and last run-1 competitor of each lineage (doc: The panel).
const panel = LINEAGES.map((k) => { const c = lineageOf(k).competitors; return { lineage: k, members: [playerOf(c[0]), playerOf(c[c.length - 1])] }; });
const opponentsOf = (lineage: string) => panel.filter((p) => p.lineage !== lineage).flatMap((p) => p.members);

/** Both directions of one pair, players ordered by key so a pair always has the same jobs. */
function pairJobs(x: Player, y: Player): AssayJob[] {
  const [p, q] = playerKey(x) < playerKey(y) ? [x, y] : [y, x];
  const jobs: AssayJob[] = [];
  for (const [rare, common] of [[p, q], [q, p]]) for (const s of SEEDS) {
    const id = `rq-${playerKey(p)}-${playerKey(q)}-r${playerKey(rare)}-s${s}`;
    jobs.push({ id, kind: "pair", lineage: "rq", rare: rare.id, common: common.id, rareForms: rare.forms, commonForms: common.forms, seed: fnv(id), num: NUM, epochs: 512, every: 64 });
  }
  return jobs;
}
const jobId = (p: Player, q: Player, rare: Player, s: number) => {
  const [x, y] = playerKey(p) < playerKey(q) ? [p, q] : [q, p];
  return `rq-${playerKey(x)}-${playerKey(y)}-r${playerKey(rare)}-s${s}`;
};

interface HallSummary { lineage: string; arm: string; rep: number; P: number; changes: number; history: { id: string; forms: string[] }[]; planted: number; final: { id: string; forms: string[]; returned: boolean; share: number | null; rare: boolean } }
async function hallSummaries(): Promise<(HallSummary | null)[]> {
  const res = [];
  for (const L of HALL_LINEAGES) for (const arm of ARMS) for (const rep of REPS) {
    try { res.push(JSON.parse(await Deno.readTextFile(`${hallDir}/${L}-${arm}-${rep}/summary.json`))); } catch { res.push(null); }
  }
  return res;
}

if (cmd === "plan") {
  const jobs = new Map<string, AssayJob>();
  const add = (x: Player, y: Player) => { for (const j of pairJobs(x, y)) jobs.set(j.id, j); };
  // Part A: every run-1 competitor against its six panel opponents.
  for (const k of LINEAGES) for (const c of lineageOf(k).competitors) for (const o of opponentsOf(k)) add(playerOf(c), o);
  if (a["with-c"]) {
    const sums = await hallSummaries();
    if (sums.some((s) => !s)) throw new Error(`--with-c: ${sums.filter((s) => !s).length} hall runs have no summary.json yet`);
    const pilotP = JSON.parse(await Deno.readTextFile(`${out}/pilot/pilot.json`)).P;
    const wrongP = (sums as HallSummary[]).filter((s) => s.P !== pilotP);
    if (!pilotP || wrongP.length) throw new Error(`--with-c: pilot P ${pilotP}, but ${wrongP.length} hall runs used another P`);
    for (const s of sums as HallSummary[]) for (const o of opponentsOf(s.lineage)) add(s.final, o);
    // C2: HALL final against CTRL final of the same pair, unless their forms are identical.
    for (const L of HALL_LINEAGES) for (const rep of REPS) {
      const h = (sums as HallSummary[]).find((s) => s.lineage === L && s.arm === "HALL" && s.rep === rep)!;
      const c = (sums as HallSummary[]).find((s) => s.lineage === L && s.arm === "CTRL" && s.rep === rep)!;
      if (playerKey(h.final) !== playerKey(c.final)) add(h.final, c.final);
    }
  }
  // Never change a job that exists: ids name forms and seeds, so a changed job means a changed input.
  let existing: AssayJob[] = [];
  try { existing = (await Deno.readTextFile(`${racesDir}/jobs.jsonl`)).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { /* none yet */ }
  for (const e of existing) {
    const n = jobs.get(e.id);
    if (!n || JSON.stringify(n) !== JSON.stringify(e)) throw new Error(`refusing: existing job ${e.id} would change or vanish`);
  }
  // Only now, with the whole plan checked, write anything.
  await Deno.mkdir(`${racesDir}/assays`, { recursive: true });
  await Deno.writeTextFile(`${out}/panel.json`, JSON.stringify(panel, null, 1) + "\n");
  const seen = new Set(existing.map((e) => e.id));
  const all = [...existing, ...[...jobs.values()].filter((j) => !seen.has(j.id))];
  await Deno.writeTextFile(`${racesDir}/jobs.jsonl`, all.map((j) => JSON.stringify(j)).join("\n") + "\n");
  console.log(`${all.length} jobs (${all.length - existing.length} new) -> ${racesDir}/jobs.jsonl`);
} else if (cmd === "analyze") {
  const jobs: AssayJob[] = (await Deno.readTextFile(`${racesDir}/jobs.jsonl`)).trim().split("\n").map((l) => JSON.parse(l));
  const results = new Map<string, AssayResult>();
  for (const j of jobs) { try { results.set(j.id, JSON.parse(await Deno.readTextFile(`${racesDir}/assays/${j.id}.json`))); } catch { /* missing */ } }
  const fOf = (id: string) => { const r = results.get(id); return r && r.valid && Number.isFinite(r.final.f) ? r.final.f : null; };
  const done = (p: Player, q: Player) => SEEDS.every((s) => results.has(jobId(p, q, p, s)) && results.has(jobId(p, q, q, s)));
  /** The pair outcome from p's side, or null if any of its races is missing. */
  const side = (p: Player, q: Player): Side | null => {
    if (!done(p, q)) return null;
    const o = permPairOutcome(SEEDS.map((s) => fOf(jobId(p, q, p, s))), SEEDS.map((s) => fOf(jobId(p, q, q, s))), MIN_VALID);
    return sideOf(o.outcome, true);
  };
  const score = (p: Player, lineage: string) => {
    const opp = opponentsOf(lineage);
    const sides = opp.map((o) => side(p, o));
    if (sides.some((s) => s === null)) return null;
    const ss = sides as Side[];
    return {
      sides: Object.fromEntries(opp.map((o, i) => [o.id, ss[i]])), wins: ss.filter((s) => s === "win").length, losses: ss.filter((s) => s === "loss").length,
      failed: ss.filter((s) => s === "failed").length, net: Object.fromEntries(MODES.map((m) => [m, net(ss, m)])) as Record<FailedMode, number>,
    };
  };

  // Part A.
  const partA = LINEAGES.map((k) => ({ lineage: k, players: lineageOf(k).competitors.map((c) => ({ id: c.id, ...score(playerOf(c), k) })) }));
  const aMissing = jobs.filter((j) => !results.has(j.id)).length; // Part A is planned first; any missing race may be Part A's
  const aComplete = partA.every((l) => l.players.every((p) => "net" in p && p.net));
  // deno-lint-ignore no-explicit-any
  const netsOf = (m: FailedMode) => partA.map((l) => l.players.map((p: any) => p.net[m] as number));
  const aByMode = aComplete ? Object.fromEntries(MODES.map((m) => { const t = pooledOrderTest(netsOf(m)); return [m, { ...t, verdict: aVerdict(t.T, t.p) }]; })) as Record<FailedMode, { T: number; rhos: number[]; p: number; verdict: ReturnType<typeof aVerdict> }> : null;
  const aVerdictFinal = !aComplete ? "INCOMPLETE" : bounded({ "as-is": aByMode!["as-is"].verdict, win: aByMode!.win.verdict, loss: aByMode!.loss.verdict });

  // Part B (exploratory).
  const symDist = (x: Player, y: Player) => {
    const rx = new TypeRef(x.forms.map(unhex)), ry = new TypeRef(y.forms.map(unhex));
    return (rx.distance(unhex(y.forms[0])).d / rx.symbols + ry.distance(unhex(x.forms[0])).d / ry.symbols) / 2;
  };
  const leaderAt = (L: Run1Lineage, delta: number) => {
    const ser = sustainedSeries(L.leaders);
    let idx = -1;
    for (let i = 0; i < L.epochs.length; i++) if (L.epochs[i] <= L.from + delta) idx = i;
    const id = idx >= 0 ? ser[idx] : null;
    const c = L.competitors.find((c) => c.id === id);
    return c ? playerOf(c) : null;
  };
  const span = Math.min(...run1.map((L) => L.epochs.at(-1)! - L.from));
  const partB: { delta: number; leaders: (string | null)[]; distance: Record<string, number | null> }[] = [];
  for (let delta = 0; delta <= span; delta += 2048) {
    const ls = LINEAGES.map((k) => leaderAt(lineageOf(k), delta));
    const row: Record<string, number | null> = {};
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) row[`${LINEAGES[i]}-${LINEAGES[j]}`] = ls[i] && ls[j] ? symDist(ls[i]!, ls[j]!) : null;
    partB.push({ delta, leaders: ls.map((l) => l?.id ?? null), distance: row });
  }
  // Each lineage pair's Spearman rho of distance against time (exploratory, no p).
  const partBTrend = Object.fromEntries(Object.keys(partB[0].distance).map((k) => {
    const pts = partB.filter((r) => r.distance[k] !== null);
    return [k, pts.length >= 3 ? spearman(pts.map((r) => r.delta), pts.map((r) => r.distance[k]!)) : null];
  }));

  // Part C.
  const sums = await hallSummaries();
  const pilot = await Deno.readTextFile(`${out}/pilot/pilot.json`).then(JSON.parse).catch(() => null);
  let partC: unknown = { verdict: pilot && pilot.P === null ? "NOT RUN" : "INCOMPLETE" };
  if (sums.every(Boolean) && pilot?.P) {
    const S = sums as HallSummary[];
    const get = (L: string, arm: string, rep: number) => S.find((s) => s.lineage === L && s.arm === arm && s.rep === rep)!;
    // deno-lint-ignore no-explicit-any
    const pairs: any[] = [];
    let c1Complete = true, c2Complete = true;
    const wrongP = S.filter((s) => s.P !== pilot.P).length;
    // C1's failed-race bound per pair: as-is; low = HALL's failed races lost and CTRL's won; high = the reverse.
    const D_MODES = ["as-is", "low", "high"] as const;
    for (const L of HALL_LINEAGES) for (const rep of REPS) {
      const h = get(L, "HALL", rep), c = get(L, "CTRL", rep);
      const same = playerKey(h.final) === playerKey(c.final);
      const sh = score(h.final, L), sc = score(c.final, L);
      if (!sh || !sc) c1Complete = false;
      if (!same && !done(h.final, c.final)) c2Complete = false;
      const d = sh && sc
        ? { "as-is": same ? 0 : sh.net["as-is"] - sc.net["as-is"], low: same ? 0 : sh.net.loss - sc.net.win, high: same ? 0 : sh.net.win - sc.net.loss }
        : null;
      const h2h = same ? "same forms" : side(h.final, c.final);
      pairs.push({ lineage: L, rep, hall: { id: h.final.id, ...sh, returned: h.final.returned, finalShare: h.final.share, rare: h.final.rare, changes: h.changes, history: h.history.length }, ctrl: { id: c.final.id, ...sc, returned: c.final.returned, finalShare: c.final.share, rare: c.final.rare, changes: c.changes, history: c.history.length }, d, h2h });
    }
    const c2 = {
      complete: c2Complete,
      hallWins: pairs.filter((p) => p.h2h === "win").length, ctrlWins: pairs.filter((p) => p.h2h === "loss").length,
      other: pairs.filter((p) => p.h2h === "other" || p.h2h === "failed").length, sameForms: pairs.filter((p) => p.h2h === "same forms").length,
    };
    if (wrongP) partC = { verdict: `INVALID (${wrongP} hall runs used a P other than the pilot's ${pilot.P})`, pairs, c2 };
    else if (!c1Complete) partC = { verdict: "INCOMPLETE", pairs, c2 };
    else {
      const byMode = Object.fromEntries(D_MODES.map((m) => { const t = signFlip(pairs.map((p) => p.d![m])); return [m, { ...t, verdict: cVerdict(t) }]; })) as Record<typeof D_MODES[number], ReturnType<typeof signFlip> & { verdict: ReturnType<typeof cVerdict> }>;
      const v = byMode["as-is"].verdict;
      partC = { verdict: v === byMode.low.verdict && v === byMode.high.verdict ? v : "INSUFFICIENT (failed races)", byMode, pairs, c2, P: pilot.P };
    }
  }
  // No-planting reference: run 1's own sustained leader at branch + 16,384 (descriptive).
  const reference = HALL_LINEAGES.map((k) => { const L = lineageOf(k), p = leaderAt(L, 16384); return { lineage: k, id: p?.id ?? null, ...(p ? score(p, k) : {}) }; });

  const summary = {
    partA: { verdict: aVerdictFinal, T: aByMode?.["as-is"].T ?? null, p: aByMode?.["as-is"].p ?? null, rhos: aByMode ? Object.fromEntries(LINEAGES.map((k, i) => [k, aByMode["as-is"].rhos[i]])) : null, byMode: aByMode },
    // deno-lint-ignore no-explicit-any
    partC: { verdict: (partC as any).verdict, c2: (partC as any).c2 ?? null },
    missing: aMissing, races: jobs.length,
  };
  await Deno.writeTextFile(`${out}/results.json`, JSON.stringify({ summary, partA, partB: { label: "exploratory", rows: partB, trend: partBTrend }, partC, reference, panel: panel.map((p) => ({ lineage: p.lineage, members: p.members.map((m) => m.id) })) }, null, 1) + "\n");
  console.log(JSON.stringify(summary, null, 1));
} else {
  throw new Error("usage: soup-rq.ts plan [--with-c] | analyze  [--out dir]");
}
