// Does evolution continue after the copiers take over? Runs the analysis
// fixed in docs/soup-evolution-2026-10-31.md over long tools/soup.ts runs.
//
//   deno run -A tools/soup-evo.ts census <run-dir> --from <T0> [--shard i/n]
//       types per snapshot -> <run-dir>/evo/census/<epoch>.json (skips done ones)
//   deno run -A tools/soup-evo.ts plan --lineage wm2=runs/soup/noheads/seed-2:12609:45056 ... [--grid-lineage g1] [--out runs/soup/evo]
//       (key=run-dir:T0:end; both snapshots must exist)
//       leaders, turnover, competitors -> <out>/plan.json, assay jobs -> <out>/jobs.jsonl
//   deno run -A tools/soup-evo.ts assay [--out runs/soup/evo] [--shard i/n]
//       runs the jobs not yet done -> <out>/assays/<id>.json (run shards in parallel)
//   deno run -A tools/soup-evo.ts analyze [--out runs/soup/evo]
//       verdicts, probes, trends, similarity graph -> <out>/results.json, and a summary
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { TAPE } from "./soup/bff.ts";
import {
  type AssayJob, type AssayResult, findMarker, hex, intransitive, interact, leadership, lineageVerdict, markForms, pairOutcome,
  parasites, permutationP, refOf, runAssay, sd, type Snapshot, spearman, trend, type TypeRow, typeCensus, unhex,
} from "./soup/evo.ts";

const a = parseArgs(Deno.args, { string: ["from", "shard", "out", "grid-lineage"], collect: ["lineage"], default: { out: "runs/soup/evo" } });
const cmd = String(a._[0] ?? "");
const out = String(a.out);

function shard(): [number, number] {
  if (!a.shard) return [0, 1];
  const m = String(a.shard).match(/^(\d+)\/(\d+)$/);
  if (!m || Number(m[1]) >= Number(m[2])) throw new Error("--shard expects i/n with 0 <= i < n");
  return [Number(m[1]), Number(m[2])];
}

async function exists(p: string): Promise<boolean> {
  try { await Deno.stat(p); return true; } catch { return false; }
}

/** Snapshot epochs in a run dir (soup-<epoch>.bin, not transition snapshots), at or after `from`. */
async function snapshots(dir: string, from: number): Promise<number[]> {
  const eps: number[] = [];
  for await (const e of Deno.readDir(dir)) {
    const m = e.name.match(/^soup-(\d+)\.bin$/);
    if (m && Number(m[1]) >= from) eps.push(Number(m[1]));
  }
  return eps.sort((x, y) => x - y);
}

async function readCensus(dir: string, from: number, only?: number[]): Promise<Snapshot[]> {
  const eps = only ?? await snapshots(dir, from);
  const out: Snapshot[] = [];
  for (const e of eps) {
    const p = `${dir}/evo/census/${e}.json`;
    if (!(await exists(p))) throw new Error(`missing census ${p}: run census first`);
    out.push(JSON.parse(await Deno.readTextFile(p)));
  }
  return out;
}

const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; };
const formsOf = (r: Pick<TypeRow, "rep" | "mirror">) => r.mirror ? [r.rep, r.mirror] : [r.rep];

interface Lineage { key: string; dir: string; from: number; to: number; grid: boolean }
interface Competitor { id: string; firstLead: number; epoch: number; row: TypeRow }
interface Plan {
  lineages: (Lineage & { epochs: number[]; leaders: (string | null)[]; changes: number; competitors: Competitor[]; timePoints: Competitor[]; marker: ReturnType<typeof findMarker> })[];
}

if (cmd === "census") {
  const dir = String(a._[1] ?? "");
  if (!dir || a.from === undefined) throw new Error("usage: census <run-dir> --from <T0>");
  const [i, n] = shard();
  await Deno.mkdir(`${dir}/evo/census`, { recursive: true });
  const eps = (await snapshots(dir, Number(a.from))).filter((_, k) => k % n === i);
  for (const e of eps) {
    const p = `${dir}/evo/census/${e}.json`;
    if (await exists(p)) continue;
    const t = performance.now();
    const snap = typeCensus(await Deno.readFile(`${dir}/soup-${e}.bin`), e);
    await Deno.writeTextFile(p + ".tmp", JSON.stringify(snap));
    await Deno.rename(p + ".tmp", p);
    console.log(`${dir} ${e}: ${snap.typesAbove} types >= 0.1%, copiers ${(snap.copierShare * 100).toFixed(1)}%, leader ${snap.leader} (${((performance.now() - t) / 1000).toFixed(1)}s)`);
  }
} else if (cmd === "plan") {
  const lins: Lineage[] = (a.lineage as string[]).map((s) => {
    const m = s.match(/^([\w-]+)=(.+):(\d+):(\d+)$/);
    if (!m) throw new Error("--lineage expects key=run-dir:T0:end");
    return { key: m[1], dir: m[2], from: Number(m[3]), to: Number(m[4]), grid: m[1] === a["grid-lineage"] };
  });
  if (!lins.length) throw new Error("plan needs at least one --lineage");
  const plan: Plan = { lineages: [] };
  const jobs: AssayJob[] = [];
  for (const L of lins) {
    const snaps = (await readCensus(L.dir, L.from)).filter((s) => s.epoch <= L.to);
    if (snaps[0]?.epoch !== L.from || snaps.at(-1)?.epoch !== L.to) throw new Error(`${L.key}: snapshots must run from exactly ${L.from} to ${L.to} (have ${snaps[0]?.epoch}..${snaps.at(-1)?.epoch})`);
    const leaders = snaps.map((s) => s.leader);
    const lead = leadership(leaders);
    // Representatives are frozen at the first snapshot where the type led at all.
    const competitors: Competitor[] = lead.competitors.map((id, k) => {
      const s = snaps[lead.frozen[k]];
      const row = s.types.find((r) => r.id === id);
      if (!row) throw new Error(`${L.key}: leader ${id} has no census row at ${s.epoch}`);
      return { id, firstLead: lead.firstLead[k], epoch: s.epoch, row };
    });
    const L0 = competitors[0];
    const marker = L0 ? findMarker(refOf(L0.row)) : null;
    // Exploratory: the leaders at 5 evenly spaced snapshots (sustained or not), deduplicated, frozen there.
    const timePoints: Competitor[] = [];
    for (const q of [0, 1, 2, 3, 4]) {
      const si = Math.round(q * (snaps.length - 1) / 4);
      const id = snaps[si].leader;
      if (!id || timePoints.some((c) => c.id === id)) continue;
      timePoints.push({ id, firstLead: si, epoch: snaps[si].epoch, row: snaps[si].types.find((r) => r.id === id)! });
    }
    plan.lineages.push({ ...L, epochs: snaps.map((s) => s.epoch), leaders, changes: lead.changes, competitors, timePoints, marker });
    // Pair assays: every distinct unordered pair, both directions, seeds 1..3.
    const pairJobs = (kind: "pair" | "grid" | "xpair", set: Competitor[] = competitors) => {
      for (let x = 0; x < set.length; x++) for (let y = x + 1; y < set.length; y++) {
        for (const [rare, common] of [[set[x], set[y]], [set[y], set[x]]]) {
          for (let s = 1; s <= 3; s++) {
            const id = `${L.key}-${kind}-${set[x].id}-${set[y].id}-r${rare.id}-s${s}`;
            jobs.push({
              id, kind, lineage: L.key, rare: rare.id, common: common.id, rareForms: formsOf(rare.row), commonForms: formsOf(common.row), seed: fnv(id),
              ...(kind === "grid" ? { grid: { width: 64, height: 64, radius: 2 } } : {}),
            });
          }
        }
      }
    };
    pairJobs("pair");
    if (L.grid) pairJobs("grid");
    pairJobs("xpair", timePoints);
    // Neutral: L0* vs L0, both directions, calibration seeds 1..3 and validation seeds 4..6.
    if (L0 && marker) {
      const ref = refOf(L0.row);
      const marked = markForms(ref, marker.pos, marker.value).map(hex);
      const kinds: ("neutral" | "gneutral")[] = L.grid ? ["neutral", "gneutral"] : ["neutral"];
      for (const kind of kinds) for (const markedRare of [true, false]) for (let s = 1; s <= (kind === "neutral" ? 6 : 3); s++) {
        const id = `${L.key}-${kind}-${L0.id}-${markedRare ? "marked" : "plain"}-rare-s${s}`;
        jobs.push({
          id, kind, lineage: L.key, ...(kind === "gneutral" ? { grid: { width: 64, height: 64, radius: 2 } } : {}), rare: markedRare ? `${L0.id}*` : L0.id, common: markedRare ? L0.id : `${L0.id}*`,
          rareForms: markedRare ? marked : formsOf(L0.row), commonForms: markedRare ? formsOf(L0.row) : marked, seed: fnv(id),
          // Classification reads the marker: "rare" = whoever holds the rare side's byte.
          marker: markedRare ? marker : { pos: marker.pos, value: marker.original, original: marker.value },
        });
      }
    }
    console.log(`${L.key}: ${snaps.length} snapshots ${snaps[0]?.epoch}..${snaps.at(-1)?.epoch}, ${lead.changes} sustained leader changes, ${competitors.length} competitors, marker ${marker ? `at ${marker.pos}` : "none"}`);
  }
  await Deno.mkdir(`${out}/assays`, { recursive: true });
  await Deno.writeTextFile(`${out}/plan.json`, JSON.stringify(plan, null, 1));
  await Deno.writeTextFile(`${out}/jobs.jsonl`, jobs.map((j) => JSON.stringify(j)).join("\n") + "\n");
  console.log(`${jobs.length} assay jobs -> ${out}/jobs.jsonl`);
} else if (cmd === "assay") {
  const [i, n] = shard();
  const jobs: AssayJob[] = (await Deno.readTextFile(`${out}/jobs.jsonl`)).trim().split("\n").map((l) => JSON.parse(l));
  await Deno.mkdir(`${out}/assays`, { recursive: true });
  for (let k = i; k < jobs.length; k += n) {
    const p = `${out}/assays/${jobs[k].id}.json`;
    if (await exists(p)) continue;
    const t = performance.now();
    const r = runAssay(jobs[k]);
    await Deno.writeTextFile(p + ".tmp", JSON.stringify(r));
    await Deno.rename(p + ".tmp", p);
    console.log(`${jobs[k].id}: f ${r.final.f.toFixed(3)} other ${r.final.other}${r.valid ? "" : " INVALID"} (${((performance.now() - t) / 1000).toFixed(0)}s)`);
  }
} else if (cmd === "analyze") {
  const plan: Plan = JSON.parse(await Deno.readTextFile(`${out}/plan.json`));
  const jobs: AssayJob[] = (await Deno.readTextFile(`${out}/jobs.jsonl`)).trim().split("\n").map((l) => JSON.parse(l));
  const results = new Map<string, AssayResult>();
  let missing = 0, missingExploratory = 0; // exploratory (xpair) jobs never hold up the headline
  for (const j of jobs) {
    const p = `${out}/assays/${j.id}.json`;
    if (await exists(p)) results.set(j.id, JSON.parse(await Deno.readTextFile(p)));
    else if (j.kind === "xpair") missingExploratory++;
    else missing++;
  }
  const fOf = (r: AssayResult | undefined) => r && r.valid && Number.isFinite(r.final.f) ? r.final.f : null;
  const seedOf = (id: string) => Number(id.match(/-s(\d+)$/)![1]);

  // Neutral calibration (seeds 1..3) and validation (seeds 4..6).
  const neutral = jobs.filter((j) => j.kind === "neutral");
  const calibJobs = neutral.filter((j) => seedOf(j.id) <= 3);
  const calibDone = calibJobs.every((j) => results.has(j.id));
  const calib = calibJobs.map((j) => fOf(results.get(j.id))).filter((f): f is number => f !== null);
  // sigma0 only from the complete calibration batch.
  const sigma0 = calibDone && calib.length >= 3 ? sd(calib) : NaN;
  const allNeutral = neutral.map((j) => fOf(results.get(j.id))).filter((f): f is number => f !== null);
  const validation = plan.lineages.map((L) => {
    const v = neutral.filter((j) => j.lineage === L.key && seedOf(j.id) >= 4);
    const markedRare = v.filter((j) => j.rare.endsWith("*")).map((j) => fOf(results.get(j.id)));
    const plainRare = v.filter((j) => !j.rare.endsWith("*")).map((j) => fOf(results.get(j.id)));
    return { lineage: L.key, ...(v.length ? pairOutcome(markedRare, plainRare, sigma0) : { outcome: "no control", D: null, theta: null }) };
  });
  const calibrationFailed = validation.some((v) => v.outcome === "a" || v.outcome === "b");

  const lineageResults = [];
  for (const L of plan.lineages) {
    const comp = L.competitors;
    const score = (kind: "pair" | "grid" | "xpair", comp: Competitor[] = L.competitors, s0 = sigma0) => {
      const k = comp.length;
      const pairs: { a: string; b: string; outcome: string; D: number | null; theta: number | null; aRare: (number | null)[]; bRare: (number | null)[] }[] = [];
      const wins: [number, number][] = [];
      for (let x = 0; x < k; x++) for (let y = x + 1; y < k; y++) {
        const base = `${L.key}-${kind}-${comp[x].id}-${comp[y].id}`;
        const fs = (rare: string) => [1, 2, 3].map((s) => fOf(results.get(`${base}-r${rare}-s${s}`)));
        const aRare = fs(comp[x].id), bRare = fs(comp[y].id);
        const o = pairOutcome(aRare, bRare, s0);
        pairs.push({ a: comp[x].id, b: comp[y].id, ...o, aRare, bRare });
        if (o.outcome === "a") wins.push([x, y]); else if (o.outcome === "b") wins.push([y, x]);
      }
      const resolved = wins.length, failed = pairs.filter((p) => p.outcome === "failed").length;
      const perm = resolved ? permutationP(k, wins) : { laterWins: 0, p: null };
      const v = lineageVerdict(perm.laterWins, resolved, pairs.length, failed, perm.p);
      const cyc = intransitive(wins.map(([w, l]) => [comp[w].id, comp[l].id]));
      return { pairs, resolved, failed, laterWins: perm.laterWins, p: perm.p, ...v, cyclic: cyc, coexist: pairs.filter((p) => p.outcome === "coexist").map((p) => [p.a, p.b]) };
    };
    const wellMixed = score("pair");
    const gn = jobs.filter((j) => j.kind === "gneutral" && j.lineage === L.key);
    const gf = gn.map((j) => fOf(results.get(j.id))).filter((f): f is number => f !== null);
    const sigmaGrid = gn.length && gn.every((j) => results.has(j.id)) && gf.length >= 3 ? sd(gf) : NaN;
    const grid = L.grid ? { sigma0: sigmaGrid, ...score("grid", L.competitors, sigmaGrid) } : null;
    const explore = score("xpair", L.timePoints);

    // Censuses for probes, trends and the similarity graph.
    const snaps = await readCensus(L.dir, L.from, L.epochs);
    const probeAt = [0, Math.floor((snaps.length - 1) / 2), snaps.length - 1];
    const probes = [];
    for (const si of probeAt) {
      const s = snaps[si];
      const picked = s.types.filter((r, i) => i < 16 || (r.share >= 0.005 && r.selfRep !== null && r.selfRep <= 16));
      const refs = picked.map(refOf), ids = picked.map((r) => r.id);
      const rows = new Map(picked.map((r) => [r.id, r]));
      const probe = interact(refs, ids);
      probes.push({ epoch: s.epoch, probe, types: picked.map((r) => ({ id: r.id, share: r.share, selfRep: r.selfRep })), parasites: parasites(refs, ids, rows) });
    }
    const trends: ({ epoch: number; id: string } & ReturnType<typeof trend>)[] = [];
    for (const s of snaps) {
      const row = s.types.find((r) => r.id === s.leader);
      if (row) trends.push({ epoch: s.epoch, id: row.id, ...trend(refOf(row)) });
    }
    const t = trends.map((x) => x.epoch);
    const trendCorr = Object.fromEntries((["instructions", "selfRep", "ops", "fidelity", "robustness"] as const).map((m) => [m, spearman(t, trends.map((x) => x[m]))]));
    const similarity: { epoch: number; id: string; parent: string | null; distance: number | null }[] = [];
    const seen = new Set<string>();
    for (let si = 0; si < snaps.length; si++) {
      for (const r of snaps[si].types.slice(0, 8)) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        if (si === 0) { similarity.push({ epoch: snaps[si].epoch, id: r.id, parent: null, distance: null }); continue; }
        let best: TypeRow | null = null, bd = TAPE + 1, radius = 0;
        for (const q of snaps[si - 1].types.slice(0, 64)) {
          const ref = refOf(q);
          const d = ref.distance(unhex(r.rep), 0, TAPE).d;
          if (d < bd || (d === bd && best && q.count > best.count)) { bd = d; best = q; radius = ref.match; }
        }
        similarity.push({ epoch: snaps[si].epoch, id: r.id, parent: best && bd <= radius ? best.id : null, distance: best ? bd : null });
      }
    }
    // Leader chain: each change of the snapshot leader, with the key distance from the previous leader.
    const chain: { epoch: number; id: string; distance: number | null }[] = [];
    let prevRow: TypeRow | null = null;
    for (const s of snaps) {
      const row = s.types.find((r) => r.id === s.leader) ?? null;
      if (!row || (prevRow && row.id === prevRow.id)) continue;
      chain.push({ epoch: s.epoch, id: row.id, distance: prevRow ? refOf(prevRow).distance(unhex(row.rep), 0, TAPE).d : null });
      prevRow = row;
    }
    // Clade view (exploratory): each type coloured by the nearest competitor or time-point leader within that one's radius, else null.
    const anchors = [...comp, ...L.timePoints.filter((c) => !comp.some((d) => d.id === c.id))].map((c) => ({ id: c.id, ref: refOf(c.row) }));
    const cladeOf = (r: TypeRow): string | null => {
      let best: string | null = null, bd = Infinity;
      for (const a of anchors) { const d = a.ref.distance(unhex(r.rep), 0, a.ref.match).d; if (d <= a.ref.match && d < bd) { bd = d; best = a.id; } }
      return best;
    };
    // Composition per snapshot over every type with a copy test (share >= 0.1%): shares by clade, other copiers, non-copiers.
    const muller = snaps.map((s) => {
      const clades: Record<string, number> = {};
      let otherCopier = 0, nonCopier = 0;
      for (const r of s.types) {
        if (r.selfRep === null) continue;
        const c = r.selfRep >= 48 ? cladeOf(r) : null;
        if (c) clades[c] = (clades[c] ?? 0) + r.share;
        else if (r.selfRep >= 48) otherCopier += r.share;
        else nonCopier += r.share;
      }
      return { epoch: s.epoch, copierShare: s.copierShare, typesAbove: s.typesAbove, diversity: s.diversity, distinct: s.distinct, leader: s.leader, clades, otherCopier, nonCopier, top: s.types.slice(0, 12).map((r) => [r.id, r.share, r.selfRep, cladeOf(r)]) };
    });
    const turnover = L.changes >= 3 ? "TURNOVER" : L.changes === 0 ? "no turnover" : "some turnover";
    lineageResults.push({ key: L.key, changes: L.changes, turnover, competitors: comp.map((c) => ({ id: c.id, epoch: c.epoch, selfRep: c.row.selfRep, instructions: c.row.instructions, canon: c.row.canon, rep: c.row.rep })), timePoints: L.timePoints.map((c) => ({ id: c.id, epoch: c.epoch, selfRep: c.row.selfRep, instructions: c.row.instructions, canon: c.row.canon, rep: c.row.rep })), marker: L.marker, wellMixed, grid, explore, probes, trends, trendCorr, similarity, chain, muller });
  }
  const turnoverN = lineageResults.filter((l) => l.turnover === "TURNOVER").length;
  const bothN = lineageResults.filter((l) => l.turnover === "TURNOVER" && l.wellMixed.verdict === "ADAPTIVE").length;
  const stasisN = lineageResults.filter((l) => l.turnover === "no turnover").length;
  const complete = missing === 0 && plan.lineages.length === 4 && Number.isFinite(sigma0);
  const headline = bothN >= 2 ? "Evolution continues: later copiers beat earlier ones"
    : turnoverN >= 2 ? "Copiers keep replacing each other; improvement not shown"
    : stasisN >= 2 ? "Stasis after takeover" : "Little turnover";
  const parasiteLineages = lineageResults.filter((l) => l.probes.some((p) => p.parasites.length > 0)).length;
  const summary = {
    headline: !complete ? `INCOMPLETE (${missing} assays missing, ${plan.lineages.length} of 4 lineages, sigma0 ${Number.isFinite(sigma0) ? "set" : "not set"}): ${headline}`
      : calibrationFailed ? `${headline} (calibration failed: provisional)` : headline,
    missingAssays: missing, missingExploratory, sigma0, neutralCalibrationRuns: calib.length, neutralMeanF: allNeutral.length ? allNeutral.reduce((s, x) => s + x, 0) / allNeutral.length : null,
    validation, calibrationFailed, parasitesPresent: parasiteLineages >= 2, parasiteLineages,
    lineages: lineageResults.map((l) => ({ key: l.key, changes: l.changes, turnover: l.turnover, competitors: l.competitors.length, verdict: l.wellMixed.verdict, resolved: l.wellMixed.resolved, laterWins: l.wellMixed.laterWins, p: l.wellMixed.p, failed: l.wellMixed.failed, cyclic: l.wellMixed.cyclic.length, coexist: l.wellMixed.coexist.length, grid: l.grid ? l.grid.verdict : null, explore: `${l.explore.verdict} (${l.explore.laterWins}/${l.explore.resolved}, p ${l.explore.p})`, parasites: l.probes.map((p) => p.parasites.length) })),
  };
  await Deno.writeTextFile(`${out}/results.json`, JSON.stringify({ summary, lineages: lineageResults }));
  console.log(JSON.stringify(summary, null, 1));
} else {
  throw new Error("usage: soup-evo.ts census|plan|assay|analyze (see the header comment)");
}
