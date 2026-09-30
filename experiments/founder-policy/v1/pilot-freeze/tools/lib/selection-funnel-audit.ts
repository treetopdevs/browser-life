// Read-only reconstruction of pinned historical records. No simulator imports.
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface Genome { mu: number; sigma: number; motGain: number; weights: number[] }
export interface Evaluation { reps: number; survived: number; regenerated: number; lightDependent: number; [key: string]: unknown }
export interface ManifestEntry { id: string; snapshotPath: string; sha256: string; bytes: number; sourcePath: string; kind: string }
export interface Manifest { format: number; sourceRoot: string; entries: ManifestEntry[] }
export interface Observation { source: string; index: number; genomeKey: string; genomeHex: string; label?: string; subject?: number; eval?: Evaluation; cluster?: number | null; pass?: boolean; committed?: boolean }
export interface Finding { severity: "error" | "limitation"; code: string; detail: string }
export interface History { subject: number; label: string; counts: boolean; diagnosticCluster: number | null; historicalCluster: number | null; genomeKey: string; classification: string; observations: Record<string, Observation[]>; admission: { eligible: boolean | null; positions: number[]; confirmationStrongPosition: number | null; compatiblePerStrong: number[]; explanation: string }; confirmationFailures: string[] | null; retestFailures: string[] | null; winner?: { label: string; decisive: string }; replicationFailures: string[] | null; founderIndex: number | null }

function integer(n: unknown, lo: number, hi: number, name: string): number {
  if (!Number.isSafeInteger(n) || (n as number) < lo || (n as number) > hi) throw Error(`invalid ${name}: ${JSON.stringify(n)}`);
  return n as number;
}
export function normalizeGenome(raw: unknown): Genome {
  const g = raw as Record<string, unknown>;
  if (!g || typeof g !== "object") throw Error("genome is not an object");
  if (!Array.isArray(g.weights) || g.weights.length !== 160) throw Error("genome requires 160 weights");
  return { mu: integer(g.mu, 0, 65535, "mu"), sigma: integer(g.sigma, 0, 65535, "sigma"), motGain: integer(g.motGain, 0, 255, "motGain"), weights: g.weights.map((w, i) => integer(w, -128, 127, `weight ${i}`)) };
}
export function fromHex(hex: string): Genome {
  if (!/^[0-9a-f]{336}$/.test(hex)) throw Error("genome hex must be 336 lowercase characters");
  const words = Array.from({ length: 42 }, (_, i) => parseInt(hex.slice(i * 8, i * 8 + 8), 16) >>> 0);
  if ((words[1] >>> 8) !== 0) throw Error("noncanonical genome parameter padding");
  const weights: number[] = [];
  for (const word of words.slice(2)) for (let b = 0; b < 4; b++) { const u = (word >>> (b * 8)) & 255; weights.push(u > 127 ? u - 256 : u); }
  return normalizeGenome({ mu: words[0] & 65535, sigma: words[0] >>> 16, motGain: words[1] & 255, weights });
}
export function toHex(raw: Genome): string {
  const g = normalizeGenome(raw);
  const words = [((g.sigma << 16) | g.mu) >>> 0, g.motGain];
  for (let i = 0; i < 160; i += 4) words.push(((g.weights[i] & 255) | ((g.weights[i + 1] & 255) << 8) | ((g.weights[i + 2] & 255) << 16) | ((g.weights[i + 3] & 255) << 24)) >>> 0);
  return words.map((w) => w.toString(16).padStart(8, "0")).join("");
}
export function genomeKey(raw: unknown): string { const g = normalizeGenome(raw); return JSON.stringify([g.mu, g.sigma, g.motGain, g.weights]); }
export function strictFailures(e: Evaluation): string[] {
  if (!e || !Number.isSafeInteger(e.reps) || e.reps < 0) throw Error("invalid evaluation reps");
  const failures = e.reps < 32 ? ["reps"] : [];
  for (const field of ["survived", "regenerated", "lightDependent"] as const) {
    const k = integer(e[field], 0, e.reps, field);
    if (binomialTail(k, e.reps, 0.8) >= 0.05) failures.push(field);
  }
  return failures;
}
export function binomialTail(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let term = Math.pow(1 - p, n), sum = 0;
  for (let i = 0; i <= n; i++) {
    if (i >= k) sum += term;
    if (i < n) term *= ((n - i) / (i + 1)) * (p / (1 - p));
  }
  return sum;
}
export function selectWinners<T extends { cluster: number | null; eval: Evaluation; label: string }>(rows: T[]): T[] {
  const ids = [...new Set(rows.flatMap((r) => r.cluster === null ? [] : [r.cluster]))].sort((a, b) => a - b);
  return ids.flatMap((id) => {
    const pass = rows.filter((r) => r.cluster === id && strictFailures(r.eval).length === 0);
    if (!pass.length) return [];
    return [pass.reduce((best, r) => (r.eval.regenerated > best.eval.regenerated || (r.eval.regenerated === best.eval.regenerated && (r.eval.lightDependent > best.eval.lightDependent || (r.eval.lightDependent === best.eval.lightDependent && r.eval.survived > best.eval.survived)))) ? r : best)];
  });
}
export function decisiveField(a: Evaluation, b: Evaluation): string {
  for (const f of ["regenerated", "lightDependent", "survived"] as const) if (a[f] !== b[f]) return f;
  return "retest order";
}
export function referenceGeneralistGenome(): Genome {
  // Pinned codeGenome.ts generalistGenome(60,20), with the 10x8/8x8/8
  // controller layout encoded in its 160-byte weight vector.
  const weights = Array(160).fill(0);
  for (const [i, value] of [[32, 127], [41, 127], [82, 64], [89, -127], [91, 127], [96, 110], [153, 70], [154, 40], [155, -24], [156, 12]]) weights[i] = value;
  return { mu: 60, sigma: 20, motGain: 0, weights };
}
export function compatiblePerStrong(confirmRows: any[], retestRows: any[]): number[] {
  const by = new Map<number, any[]>();
  for (const r of confirmRows) if (r.pass && r.cluster !== null) by.set(r.cluster, [...(by.get(r.cluster) ?? []), r]);
  if (retestRows.length === 0 || retestRows[0].cluster !== null || retestRows[0].label !== "generalistGenome(60,20)" || genomeKey(retestRows[0].genome) !== genomeKey(referenceGeneralistGenome()) || retestRows.slice(1).some((r) => r.cluster === null)) return [];
  const expected = retestRows.slice(1);
  const max = Math.max(0, ...[...by.values()].map((v) => v.length));
  const out: number[] = [];
  for (let limit = 0; limit <= max + 1; limit++) {
    const roster = [...by.entries()].flatMap(([id, rs]) => {
      const weak = !rs.some((r) => r.regenLowerBound > 0.8);
      return (weak ? rs : rs.filter((r) => r.regenLowerBound > 0.8).slice(0, limit)).map((r, i) => ({ genomeKey: genomeKey(r.genome), cluster: id, weak, label: `c${id}.${i}`, prior: `${r.eval.regenerated}/${r.eval.reps}` }));
    });
    if (roster.length === expected.length && roster.every((x, i) => x.genomeKey === genomeKey(expected[i].genome) && (expected[i].cluster === undefined || x.cluster === expected[i].cluster) && (expected[i].weak === undefined || x.weak === expected[i].weak) && (expected[i].label === undefined || x.label === expected[i].label) && (expected[i].prior === undefined || x.prior === expected[i].prior))) out.push(limit);
  }
  return out;
}
export function parseFounders(source: string): { id: string; rows: (Genome & { cluster: number; eval: Evaluation; retest: Evaluation; replication: Evaluation })[] } {
  const id = source.match(/export const M3_FOUNDER_SET = "(m3-[0-9a-f]{16})";/)?.[1];
  const body = source.match(/export const M3_FOUNDERS:[^=]*= \[([\s\S]*?)\];/)?.[1];
  if (!id || body === undefined) throw Error("founder source has no canonical id/array");
  const rows = [...body.matchAll(/^\s*\{ cluster: (\d+), survived: (\d+), regenerated: (\d+), lightDependent: (\d+), reps: (\d+), retest: \{ survived: (\d+), regenerated: (\d+), lightDependent: (\d+), reps: (\d+) \}, replication: \{ survived: (\d+), regenerated: (\d+), lightDependent: (\d+), reps: (\d+) \}, mu: (\d+), sigma: (\d+), motGain: (\d+), weights: "([0-9a-f]{320})" \},?\s*$/gm)];
  if (!rows.length || body.replace(/^\s*\{[^\n]*\},?\s*$/gm, "").trim()) throw Error("unparsed founder source; refusing code execution");
  return { id, rows: rows.map((m) => {
    const n = m.slice(1, 17).map(Number), weights = Array.from({ length: 160 }, (_, i) => { const u = parseInt(m[17].slice(i * 2, i * 2 + 2), 16); return u > 127 ? u - 256 : u; });
    return { cluster: n[0], eval: { survived: n[1], regenerated: n[2], lightDependent: n[3], reps: n[4] }, retest: { survived: n[5], regenerated: n[6], lightDependent: n[7], reps: n[8] }, replication: { survived: n[9], regenerated: n[10], lightDependent: n[11], reps: n[12] }, mu: n[13], sigma: n[14], motGain: n[15], weights };
  }) };
}
export function founderSetId(genomes: Genome[]): string {
  const words = genomes.flatMap((g) => { const x = normalizeGenome(g); return [x.mu, x.sigma, x.motGain, ...x.weights.map((w) => w & 255)]; });
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < words.length; i++) { const w = words[i]; a = Math.imul(a ^ w, 0x85ebca6b) >>> 0; a = ((a << 13) | (a >>> 19)) >>> 0; b = Math.imul(b + w + i, 0xc2b2ae35) >>> 0; b = (b ^ (b >>> 16)) >>> 0; }
  return `m3-${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}
function obs(source: string, index: number, row: any): Observation {
  const g = row.hex ? fromHex(row.hex) : normalizeGenome(row.genome ?? row);
  if (row.hex && row.genome && genomeKey(row.genome) !== genomeKey(g)) throw Error(`${source}[${index}] conflicting genome identities`);
  return { source, index, genomeKey: genomeKey(g), genomeHex: toHex(g), ...(row.label !== undefined ? { label: row.label } : {}), ...(row.subject !== undefined ? { subject: row.subject } : {}), ...(row.eval ? { eval: row.eval } : {}), ...(row.cluster !== undefined ? { cluster: row.cluster } : {}), ...(row.pass !== undefined ? { pass: row.pass } : {}) };
}
export function reconstruct(data: Record<string, any>): { ledger: Observation[]; histories: History[]; summary: History[]; reconciliation: Record<string, unknown>; findings: Finding[] } {
  const findings: Finding[] = [], ledger: Observation[] = [];
  const add = (source: string, rows: any[]) => { const v = rows.map((r, i) => obs(source, i, r)); ledger.push(...v); return v; };
  const archive = data.archive, viable = data.viable, gate = data.gate, confirm = data.confirm, retest = data.retest, replicate = data.replicate, subjects = data.fdSubjects.subjects, pool = data.fdPool.pool, fd = data.fdResults;
  const a = add("archive.elites", archive.elites), v = add("viable", viable), g = add("gate", gate), c = add("confirm", confirm.rows), t = add("retest", retest.rows), r = add("replicate", replicate.rows), s = add("fdSubjects", subjects), p = add("fdPool", pool);
  v.forEach((x, i) => x.committed = i < archive.viableCount);
  if (archive.viableCount > v.length) findings.push({ severity: "error", code: "viable-prefix-short", detail: `${archive.viableCount} > ${v.length}` });
  const founders = parseFounders(data.founders);
  const f = add("founders", founders.rows);
  const countsRows = fd.uniform.perSubject.filter((x: any) => x.source === "archive" && x.counts);
  const contextRows = fd.uniform.perSubject.filter((x: any) => x.source === "archive" && !x.counts);
  if (countsRows.length !== 7 || contextRows.length !== 9) findings.push({ severity: "error", code: "target-count", detail: `primary uniform archive split ${countsRows.length}/${contextRows.length}, expected 7/9` });
  if (new Set(subjects.filter((x: any) => x.source === "archive").map((x: any) => x.subject)).size !== 16) findings.push({ severity: "error", code: "subject-roster", detail: "archive subject count/identity mismatch" });
  const multiplicities = (rows: Observation[]) => { const m = new Map<string, number>(); for (const x of rows) m.set(x.genomeKey, (m.get(x.genomeKey) ?? 0) + 1); return m; };
  const gm = multiplicities(g), cm = multiplicities(c);
  if (g.length !== c.length || [...gm].some(([k, n]) => cm.get(k) !== n)) findings.push({ severity: "error", code: "screen-confirm-roster", detail: "screening and confirmation genome multisets differ" });
  else if (g.some((x, i) => x.genomeKey !== c[i]?.genomeKey)) findings.push({ severity: "limitation", code: "screen-confirm-order", detail: "screening and confirmation row order differs; indexed observations retained separately" });
  for (const x of p) if (c[x.index === -1 ? -1 : pool[x.index]?.row]?.genomeKey !== x.genomeKey) findings.push({ severity: "error", code: "diagnostic-pool-source", detail: `pool row ${x.index} does not match referenced confirmation genome` });
  for (const x of s.filter((x) => subjects[x.index]?.source === "archive")) {
    const label = subjects[x.index].label;
    const match = p.find((y) => y.label === label);
    if (!match || match.genomeKey !== x.genomeKey) findings.push({ severity: "error", code: "diagnostic-subject-source", detail: `subject ${x.subject} ${label} does not match diagnostic pool` });
  }
  for (const [i, row] of confirm.rows.entries()) {
    const ev = row.eval as Evaluation;
    const expectedPass = ev.reps >= 16 && ev.survived > 0 && ev.regenerated / ev.reps > 0.8 && ev.lightDependent === ev.reps;
    const expectedStrong = binomialTail(ev.regenerated, ev.reps, 0.8) < 0.05;
    if (row.pass !== expectedPass || (row.cluster !== null) !== expectedPass || (row.regenLowerBound > 0.8) !== expectedStrong) findings.push({ severity: "error", code: "confirmation-decision", detail: `row ${i} recorded pass, cluster or lower bound differs from pinned rule` });
  }
  const compatible = compatiblePerStrong(confirm.rows, retest.rows);
  const maxStrongMembers = Math.max(0, ...[...new Set(confirm.rows.filter((x: any) => x.pass && x.cluster !== null).map((x: any) => x.cluster))].map((id) => confirm.rows.filter((x: any) => x.pass && x.cluster === id && x.regenLowerBound > 0.8).length));
  const compatiblePerStrongTailFrom = compatible.includes(maxStrongMembers + 1) ? maxStrongMembers : null;
  if (!compatible.length) findings.push({ severity: "error", code: "admission-roster", detail: "no perStrong setting reproduces the full ordered retest admission roster" });
  const winners = selectWinners(retest.rows as { cluster: number | null; eval: Evaluation; label: string; genome: Genome }[]), winnerObs = winners.map((x) => t[retest.rows.indexOf(x)]);
  const replicationExpected = winnerObs.map((x) => x.genomeKey);
  if (replicationExpected.length !== r.length || replicationExpected.some((k, i) => k !== r[i]?.genomeKey)) findings.push({ severity: "error", code: "replication-roster", detail: "ordered replication roster differs from selected candidate roster" });
  const pooled = winners.map((w, i) => {
    const rep = replicate.rows[i];
    if (!rep || genomeKey(rep.genome) !== genomeKey(w.genome)) return null;
    const e = { reps: w.eval.reps + rep.eval.reps, survived: w.eval.survived + rep.eval.survived, regenerated: w.eval.regenerated + rep.eval.regenerated, lightDependent: w.eval.lightDependent + rep.eval.lightDependent };
    return { winner: w, rep, eval: e, failures: strictFailures(e) };
  });
  const kept = pooled.filter((x) => x && !x.failures.length) as NonNullable<(typeof pooled)[number]>[];
  const countEqual = (x: Evaluation, y: Evaluation) => ["survived", "regenerated", "lightDependent", "reps"].every((k) => x[k] === y[k]);
  if (kept.length !== f.length || kept.some((x, i) => genomeKey(x.winner.genome) !== f[i]?.genomeKey || x.winner.cluster !== founders.rows[i]?.cluster || !countEqual(x.eval, founders.rows[i]?.eval) || !countEqual(x.winner.eval, founders.rows[i]?.retest) || !countEqual(x.rep.eval, founders.rows[i]?.replication))) findings.push({ severity: "error", code: "founder-roster", detail: "ordered final genome, cluster or counts differ from pinned founder source" });
  const computedId = founderSetId(kept.map((x) => x.winner.genome));
  if (computedId !== founders.id || founderSetId(founders.rows) !== founders.id) findings.push({ severity: "error", code: "founder-id", detail: `recorded ${founders.id}, reconstructed ${computedId}` });
  const maps = Object.fromEntries([["archive.elites", a], ["viable", v.filter((x) => x.committed)], ["gate", g], ["confirm", c], ["retest", t], ["replicate", r], ["founders", f], ["fdPool", p]].map(([name, rows]) => [name, new Map<string, Observation[]>((rows as Observation[]).map((x) => [x.genomeKey, (rows as Observation[]).filter((y) => y.genomeKey === x.genomeKey)]))]));
  const hist: History[] = subjects.filter((x: any) => x.source === "archive").map((row: any): History => {
    const so = s.find((x) => x.subject === row.subject)!; const key = so.genomeKey;
    const observations = Object.fromEntries(Object.entries(maps).map(([name, map]) => [name, (map as Map<string, Observation[]>).get(key) ?? []]));
    observations.fdSubjects = [so];
    const diag = fd.uniform.perSubject.find((x: any) => x.subject === row.subject && x.source === "archive");
    if (!diag) findings.push({ severity: "error", code: "missing-diagnostic", detail: `archive subject ${row.subject}` });
    const distinctConfirm = new Set(observations.confirm.map((x) => { const q = confirm.rows[x.index]; return JSON.stringify([q.pass, q.cluster, q.regenLowerBound > 0.8, q.eval.reps, q.eval.survived, q.eval.regenerated, q.eval.lightDependent]); }));
    const distinctRetest = new Set(observations.retest.map((x) => JSON.stringify(retest.rows[x.index].eval)));
    const ambiguous = distinctConfirm.size > 1 || distinctRetest.size > 1;
    if (ambiguous) findings.push({ severity: "error", code: "conflicting-repeated-observation", detail: `subject ${row.subject} has divergent same-stage observations` });
    const cx = observations.confirm[0];
    const tx = observations.retest[0]; const rx = observations.replicate[0]; const fx = observations.founders[0];
    const confIndex = cx?.index ?? -1; const cr = confIndex >= 0 ? confirm.rows[confIndex] : null;
    const eligible = cr ? (cr.pass && (cr.cluster === null ? false : !confirm.rows.some((x: any) => x.pass && x.cluster === cr.cluster && x.regenLowerBound > 0.8) || cr.regenLowerBound > 0.8)) : null;
    const strongRows = cr && cr.cluster !== null ? confirm.rows.filter((x: any) => x.pass && x.cluster === cr.cluster && x.regenLowerBound > 0.8) : [];
    const confirmationStrongPosition = cr?.regenLowerBound > 0.8 ? strongRows.findIndex((x: any) => genomeKey(x.genome) === key) + 1 : null;
    const winner = tx ? winners.find((x: any) => x.cluster === retest.rows[tx.index].cluster) : null;
    const confirmFailures = cr ? [ ...(cr.eval.reps < 16 ? ["reps"] : []), ...(cr.eval.survived <= 0 ? ["survived"] : []), ...(cr.eval.regenerated / cr.eval.reps <= 0.8 ? ["regenerated"] : []), ...(cr.eval.lightDependent !== cr.eval.reps ? ["lightDependent"] : []) ] : null;
    const failures = tx ? strictFailures(retest.rows[tx.index].eval) : null;
    const repFailures = rx && tx ? strictFailures({ reps: retest.rows[tx.index].eval.reps + replicate.rows[rx.index].eval.reps, survived: retest.rows[tx.index].eval.survived + replicate.rows[rx.index].eval.survived, regenerated: retest.rows[tx.index].eval.regenerated + replicate.rows[rx.index].eval.regenerated, lightDependent: retest.rows[tx.index].eval.lightDependent + replicate.rows[rx.index].eval.lightDependent }) : null;
    let classification = "missing/conflicting evidence";
    if (ambiguous) classification = "missing/conflicting evidence";
    else if (fx) classification = "included";
    else if (repFailures?.length) classification = "pooled-gate failure";
    else if (tx && failures?.length === 1 && failures[0] === "regenerated") classification = "regeneration-only measured failure";
    else if (tx && failures?.length) classification = "other/multiple measured failures";
    else if (tx && winner && genomeKey(winner.genome) !== key) classification = "assessed eligible; within-cluster ranking loss";
    else if (!tx && eligible) classification = compatible.length ? "eligible; not admitted under compatible limit" : "eligible; non-advancement unresolved";
    else if (!tx && cr && confirmFailures?.length === 1 && confirmFailures[0] === "regenerated") classification = "confirmation regeneration-only measured failure";
    else if (!tx && cr && confirmFailures?.length) classification = "confirmation other/multiple measured failures";
    else if (!tx && cr && !eligible) classification = "confirmed; strong admission criterion failure";
    else if (!tx && cr) classification = "non-advancement unresolved";
    const h: History = { subject: row.subject, label: row.label, counts: !!diag?.counts, diagnosticCluster: row.cluster ?? null, historicalCluster: cr?.cluster ?? null, genomeKey: key, classification, observations, admission: { eligible, positions: observations.retest.map((x) => x.index), confirmationStrongPosition, compatiblePerStrong: compatible, explanation: tx ? "admitted in recorded retest order" : eligible === false ? "not eligible under pinned admission rule" : eligible === null ? "no matching confirmation record" : compatible.length ? `eligible strong candidate at position ${confirmationStrongPosition}, outside compatible limit` : "admission setting unresolved" }, confirmationFailures: confirmFailures, retestFailures: failures, ...(winner && tx ? { winner: { label: winner.label, decisive: genomeKey(winner.genome) === key ? "selected" : decisiveField(winner.eval, retest.rows[tx.index].eval) } } : {}), replicationFailures: repFailures, founderIndex: fx?.index ?? null };
    if (eligible && !tx && !compatible.length) findings.push({ severity: "limitation", code: "ambiguous-admission", detail: row.label });
    return h;
  });
  if (data.viableTailRows > 0) findings.push({ severity: "limitation", code: "uncommitted-viable-tail", detail: `${data.viableTailRows} rows excluded after committed prefix` });
  findings.push({ severity: "limitation", code: "legacy-inexact-resume", detail: JSON.stringify(archive.resumes) });
  findings.push({ severity: "limitation", code: "quality-zero-unrecorded", detail: "Only viable offers are logged; quality-zero search evaluations have no genome-level record." });
  findings.push({ severity: "limitation", code: "historical-code-provenance", detail: "Pinned selection code may reconstruct records but is not proven to be the exact historical execution version." });
  const reconciliation = { status: findings.some((x) => x.severity === "error") ? "blocked" : "reconciled", counts: { archiveElites: a.length, viableRows: v.length, committedViable: v.filter((x) => x.committed).length, screening: g.length, confirmation: c.length, retest: t.length, selected: winners.length, replication: r.length, pooledKept: kept.length, founders: f.length, targets: countsRows.length, context: contextRows.length }, compatiblePerStrong: compatible.filter((n) => compatiblePerStrongTailFrom === null || n <= compatiblePerStrongTailFrom), compatiblePerStrongTailFrom, selectedRoster: winnerObs.map((x) => ({ label: x.label, cluster: x.cluster, genomeHex: x.genomeHex })), replicationRoster: r.map((x) => ({ label: x.label, cluster: x.cluster, genomeHex: x.genomeHex })), founderRoster: f.map((x) => ({ cluster: x.cluster, genomeHex: x.genomeHex })), recordedFounderSetId: founders.id, reconstructedFounderSetId: computedId };
  return { ledger, histories: hist, summary: hist.filter((x) => x.counts), reconciliation, findings };
}
export function assertSafeOutput(manifestPath: string, out: string, manifest: Manifest): void {
  const o = resolve(out), m = resolve(manifestPath), base = dirname(m);
  const contains = (parent: string, child: string) => { const r = relative(parent, child); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };
  if (contains(o, m) || contains(join(base, "inputs"), o)) throw Error("output path overlaps pinned inputs or manifest");
  for (const e of manifest.entries) {
    const input = resolve(base, e.snapshotPath), source = resolve(manifest.sourceRoot, e.sourcePath);
    if (contains(o, input) || contains(o, source)) throw Error(`output path overlaps source ${e.id}`);
  }
}
export async function loadPinned(manifestPath: string): Promise<{ manifest: Manifest; data: Record<string, any> }> {
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath)) as Manifest;
  if (manifest.format !== 1 || manifest.entries.length !== 19 || new Set(manifest.entries.map((e) => e.id)).size !== 19) throw Error("invalid input manifest roster");
  const base = dirname(resolve(manifestPath)), data: Record<string, any> = {};
  for (const e of manifest.entries) {
    if (isAbsolute(e.snapshotPath) || e.snapshotPath.split("/").includes("..")) throw Error(`unsafe snapshot path ${e.snapshotPath}`);
    const bytes = await Deno.readFile(join(base, e.snapshotPath));
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== e.sha256 || bytes.length !== e.bytes) throw Error(`source drift: ${e.id} ${sha}/${bytes.length} != ${e.sha256}/${e.bytes}`);
    const source = new TextDecoder().decode(bytes);
    if (e.id === "viable") {
      const count = integer(data.archive?.viableCount, 0, Number.MAX_SAFE_INTEGER, "committed viableCount");
      const lines = source.trimEnd().split("\n");
      data.viableTailRows = Math.max(0, lines.length - count);
      data.viable = lines.slice(0, count).map((line) => JSON.parse(line));
    } else data[e.id] = e.kind === "code" ? source : JSON.parse(source);
  }
  return { manifest, data };
}
