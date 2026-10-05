// Replay and independent audit for the renewal experiment (RENEWAL-PLAN.md section 7D).
//
//   deno run -A tools/construction-renewal-verify.ts pilot --root runs/construction/renewal-v1
//   deno run -A tools/construction-renewal-verify.ts final --root runs/construction/renewal-v1
//
// `pilot`: complete CPU replay and native GPU replay of the predesignated
// cases, then an audit of all 40 pilot/control cases. `final`: an audit of
// the confirmation cases and the confirmation decision. The audit recomputes
// every endpoint from the saved census records with its own code and does
// NOT import tools/lib/construction-renewal-readout.ts.
import { join } from "node:path";
import {
  artifactDigest,
  CH,
  decodeCheckpoint,
  FLUX_NAMES,
  ledgerResidual,
  stateHash,
  totalsOf,
  type WorldState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { initialState, RENEWAL_LIB_BINDINGS, type RenewalInputs, sha256Hex } from "./lib/construction-renewal.ts";
import { OBSERVER_BINDINGS, RenewalObserver, rolesDigest } from "./lib/construction-renewal-observer.ts";
import {
  absoluteRoot,
  checkModuleIdentity,
  completeAttempt,
  exists,
  fileSha256,
  json,
  moduleRoot,
  newVerifyAttempt,
  PROTOCOL_PATH,
  readJsonLines,
  runFromSnapshot,
  writeJsonOnce,
} from "./lib/construction-renewal-store.ts";

const ENTRY = "tools/construction-renewal-verify.ts";
export const RENEWAL_AUDIT_VERSION = "construction-renewal-audit-v1";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface AuditCase {
  id: string;
  phase: string;
  kind: string;
  arm: string;
  seed: number;
  reservoir: number;
  spread: number;
  horizon: number;
  sourceSites: number[];
  initialFile: string;
  initialFileSha256: string;
  initialStateHash: string;
  initialTotals: Record<string, string>;
  expectedTotals: Record<string, string>;
}

/** JSON with object keys sorted recursively and bigints as decimal strings. */
function sortKeys(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}
const canonical = (v: unknown) => JSON.stringify(sortKeys(v));

async function loadInitial(root: string, c: AuditCase): Promise<WorldState> {
  const bytes = await Deno.readFile(join(root, c.initialFile));
  if (await sha256Hex(bytes) !== c.initialFileSha256) throw new Error(`${c.id}: initial file hash`);
  const { state } = decodeCheckpoint(bytes);
  if (stateHash(state) !== c.initialStateHash) throw new Error(`${c.id}: initial state hash`);
  return state;
}

/** Window statistics by stepping through consecutive census pairs, in BigInt. */
function windowOk(lines: Map<number, Any>, site: number, from: number, to: number, every: number, V: bigint, Qmin: bigint, Rmin: bigint) {
  let minB: bigint | null = null, Q = 0n, R = 0n, count = 0;
  for (let t = from; t <= to; t += every) {
    const line = lines.get(t);
    if (!line) throw new Error(`missing census ${t}`);
    const b = BigInt(line.cells.B[site]);
    minB = minB === null || b < minB ? b : minB;
    count++;
    if (t > from) {
      const prev = lines.get(t - every);
      Q += BigInt(line.cumulative.photo[site]) - BigInt(prev.cumulative.photo[site]);
      Q += BigInt(line.cumulative.grow[site]) - BigInt(prev.cumulative.grow[site]);
      R += BigInt(line.cumulative.reactB[site]) - BigInt(prev.cumulative.reactB[site]);
    }
  }
  return { count, minB: minB!, Q, R, B: minB! >= V, Qok: Q >= Qmin, Rok: R >= Rmin };
}

const sumBig = (a: number[]) => a.reduce((s, v) => s + BigInt(v), 0n);

/**
 * Reconstructed identities of one census record, all in BigInt: channel totals
 * and the energy formula, the ledger residual, cells against totals, roles
 * against the global flux, local reaction change against the B flux,
 * conservative bound transport, per-cell budgets since step 0, monotone
 * cumulative counters, offered light exposure and the founder masks.
 */
function censusIdentities(line: Any, first: Any, prev: Any, cfg: Any, t0: Any, c: AuditCase, n: number): string[] {
  const out: string[] = [];
  const T = line.totals, f = line.flux, cum = line.cumulative;
  // Counter domains: decimal non-negative integers; flux and ledgers never decrease.
  const dec = (v: unknown) => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v);
  if (canonical(Object.keys(T).sort()) !== canonical(["A", "B", "C", "E", "P", "S", "energy", "matter"])) out.push("totals fields");
  if (!Object.values(T).every(dec)) out.push("totals domain");
  if (canonical(Object.keys(f).sort()) !== canonical([...FLUX_NAMES].sort()) || !Object.values(f).every(dec)) out.push("flux domain");
  if (!dec(line.lightIn) || !dec(line.heatOut) || !dec(line.lightExposure) || !dec(line.activeBArea)) out.push("ledger domain");
  const nonneg = (a: unknown) => Array.isArray(a) && a.length === n && a.every((v) => Number.isSafeInteger(v) && v >= 0);
  const signed = (a: unknown) => Array.isArray(a) && a.length === n && a.every((v) => Number.isSafeInteger(v));
  if (!nonneg(line.cells?.B) || !nonneg(line.cells?.P) || !nonneg(line.cells?.E)) return [...out, "cells domain"];
  for (const k of ["photo", "grow", "resp", "decomp", "boundBIn", "boundBOut", "boundEIn", "boundEOut"]) if (!nonneg(cum?.[k])) return [...out, `${k} domain`];
  for (const k of ["reactB", "reactE"]) if (!signed(cum?.[k])) return [...out, `${k} domain`];
  if (prev) {
    for (const k of FLUX_NAMES) if (BigInt(f[k]) < BigInt(prev.flux[k])) out.push(`flux ${k} decreased`);
    if (BigInt(line.lightIn) < BigInt(prev.lightIn) || BigInt(line.heatOut) < BigInt(prev.heatOut)) out.push("ledger decreased");
  }
  const b = (k: string) => BigInt(T[k]);
  const matter = b("A") + b("B") + b("C") + b("P");
  const energy = BigInt(cfg.eA) * b("A") + BigInt(cfg.eB) * b("B") + BigInt(cfg.eC) * b("C") + BigInt(cfg.eP) * b("P") + b("E") + b("S");
  if (matter !== b("matter") || matter !== BigInt(t0.matter)) out.push("matter");
  if (energy !== b("energy")) out.push("energy formula");
  if (energy + BigInt(line.heatOut) - (BigInt(t0.energy) + BigInt(line.lightIn)) !== 0n) out.push("energy ledger residual");
  if (sumBig(line.cells.B) !== b("B") || sumBig(line.cells.P) !== b("P") || sumBig(line.cells.E) !== b("E")) out.push("cells vs totals");
  for (const r of ["photo", "grow", "resp", "decomp"]) if (sumBig(cum[r]) !== BigInt(f[r])) out.push(`${r} roles vs flux`);
  const fluxB = BigInt(f.photo) + BigInt(f.grow) - BigInt(f.resp) - BigInt(f.build) - BigInt(f.starve) - BigInt(f.bdecay);
  if (sumBig(cum.reactB) !== fluxB) out.push("local reaction change vs B flux");
  if (b("B") - sumBig(first.cells.B) !== fluxB) out.push("global B change vs flux");
  if (sumBig(cum.boundBIn) !== sumBig(cum.boundBOut) || sumBig(cum.boundEIn) !== sumBig(cum.boundEOut)) out.push("bound transport not conservative");
  for (let i = 0; i < n; i++) {
    if (line.cells.B[i] - first.cells.B[i] !== cum.reactB[i] + cum.boundBIn[i] - cum.boundBOut[i]) {
      out.push(`B budget at cell ${i}`);
      break;
    }
    if (line.cells.E[i] - first.cells.E[i] !== cum.reactE[i] + cum.boundEIn[i] - cum.boundEOut[i]) {
      out.push(`E budget at cell ${i}`);
      break;
    }
  }
  if (prev) {
    for (const k of ["photo", "grow", "resp", "decomp", "boundBIn", "boundBOut", "boundEIn", "boundEOut"]) {
      if (cum[k].some((v: number, i: number) => v < prev.cumulative[k][i])) out.push(`${k} decreased`);
    }
    if (BigInt(line.activeBArea) < BigInt(prev.activeBArea)) out.push("active-B area decreased");
  }
  if (cfg.lightMode !== "uniform" || cfg.seasonPeriod !== 0 || cfg.lightAmp !== 0) out.push("light is not uniform and constant");
  else if (BigInt(line.lightExposure) !== BigInt(n) * BigInt(Math.min(255, cfg.lightBase)) * BigInt(line.step)) out.push("offered light exposure");
  const masks = Object.keys(line.masks ?? {}).sort();
  if (canonical(masks) !== canonical(c.sourceSites.map((s) => `site-${s}`).sort())) out.push("founder masks");
  if (line.step === 0 && (line.lastStepRolesDigest !== "" || sumBig(cum.photo) !== 0n || BigInt(line.activeBArea) !== 0n)) out.push("step-0 census is not empty");
  return out;
}

/** Audit of one case; any read or decode error makes the case invalid, never a result. */
export async function auditCase(root: string, c: AuditCase, p: Any): Promise<Any> {
  try {
    return await auditCaseInner(root, c, p);
  } catch (e) {
    return { id: c.id, status: "invalid", issues: [`audit error: ${(e as Error).message}`] };
  }
}

async function auditCaseInner(root: string, c: AuditCase, p: Any): Promise<Any> {
  const every = p.censusEvery, e = p.endpoints;
  const V = BigInt(e.V), Qmin = BigInt(e.Qmin), Rmin = BigInt(e.Rmin);
  const issues: string[] = [];
  const done = await completeAttempt(join(root, "cases", c.id));
  if (!done) return { id: c.id, status: "incomplete", issues: ["no complete attempt"] };
  const result = JSON.parse(await Deno.readTextFile(join(done.dir, "result.json")));
  const censusPath = join(done.dir, "census.jsonl");
  if (await fileSha256(censusPath) !== result.censusSha256) issues.push("census file hash differs from result.json");
  // Initial resources against the plan's table.
  const initial = await loadInitial(root, c);
  const t0 = totalsOf(initial.cfg, initial.cells);
  for (const k of ["B", "E", "matter", "energy"]) if (String(t0[k as keyof typeof t0]) !== String(c.expectedTotals[k])) issues.push(`initial ${k} differs from the plan`);
  const n = initial.cfg.tileW * initial.cfg.tileH;
  for (let i = 0; i < n; i++) if (initial.cells[CH.A * n + i] !== c.reservoir) issues.push(`initial A at ${i}`);
  const lines = new Map<number, Any>();
  const full = new Map<number, Any>(); // complete census lines at checkpoint steps
  const ckSteps = new Set<number>(p.checkpointSteps);
  let expected = 0, first: Any = null, prev: Any = null;
  for await (const line of readJsonLines<Any>(censusPath)) {
    first ??= line;
    for (const why of censusIdentities(line, first, prev, initial.cfg, t0, c, n)) issues.push(`census ${line.step}: ${why}`);
    prev = line;
    if (ckSteps.has(line.step)) full.set(line.step, line);
    if (line.case !== c.id) issues.push("census of another case");
    if (line.step !== expected) issues.push(`census step ${line.step}, expected ${expected}`);
    expected += every;
    if (line.matterResidual !== "0" || line.energyResidual !== "0") issues.push(`residual at ${line.step}`);
    if (String(line.totals.matter) !== String(t0.matter)) issues.push(`matter at ${line.step}`);
    if (line.mutations !== 0) issues.push(`mutations at ${line.step}`);
    if (c.spread === 0) {
      line.cells.B.forEach((b: number, i: number) => {
        if (b !== 0 && !c.sourceSites.includes(i)) issues.push(`off-source B at ${i}, census ${line.step}, spread 0`);
      });
    }
    // Keep only what the endpoints and checks need.
    lines.set(line.step, { step: line.step, stateHash: line.stateHash, cells: { B: line.cells.B }, cumulative: { photo: line.cumulative.photo, grow: line.cumulative.grow, reactB: line.cumulative.reactB }, flux: line.flux, observerStep: line.step });
  }
  if (lines.size !== c.horizon / every + 1 || !lines.has(c.horizon)) issues.push("census count");
  if (lines.get(0)?.stateHash !== c.initialStateHash) issues.push("first census is not the frozen initial state");
  if (lines.get(c.horizon)?.stateHash !== result.finalStateHash) issues.push("final hash differs from result.json");
  if (result.mutations !== 0) issues.push("mutations recorded");
  if (result.case !== c.id || result.attempt !== done.attempt || result.status !== "complete" || result.finalStep !== c.horizon) issues.push("result.json identity");
  // Checkpoints decode, match their census and their recorded artifact digest.
  const wanted = p.checkpointSteps.filter((s: number) => s <= c.horizon);
  if (canonical(result.checkpoints.map((k: Any) => k.step)) !== canonical(wanted)) issues.push("checkpoint steps");
  for (const k of result.checkpoints) {
    const bytes = await Deno.readFile(join(done.dir, k.file));
    if (await sha256Hex(bytes) !== k.sha256) issues.push(`checkpoint ${k.step} file hash`);
    let decoded: ReturnType<typeof decodeCheckpoint>;
    try {
      decoded = decodeCheckpoint(bytes);
    } catch (e) {
      issues.push(`checkpoint ${k.step} does not decode: ${(e as Error).message}`);
      continue;
    }
    const { state, observer } = decoded;
    if (stateHash(state) !== lines.get(k.step)?.stateHash) issues.push(`checkpoint ${k.step} state differs from census`);
    if (artifactDigest(state, observer) !== k.artifactDigest) issues.push(`checkpoint ${k.step} artifact digest`);
    if (ledgerResidual({ energy: t0.energy }, state) !== 0n) issues.push(`checkpoint ${k.step} energy residual`);
    const obs = observer as Any;
    if (obs?.observer?.step !== k.step || obs?.case !== c.id) issues.push(`checkpoint ${k.step} observer payload`);
    // The checkpoint's cells and complete observer payload must equal the census at that step.
    const line = full.get(k.step);
    if (!line) {
      issues.push(`checkpoint ${k.step} has no census`);
      continue;
    }
    const chan = (ch: number) => Array.from(state.cells.subarray(ch * n, (ch + 1) * n));
    if (canonical({ B: chan(CH.B), P: chan(CH.P), E: chan(CH.E) }) !== canonical(line.cells)) issues.push(`checkpoint ${k.step} cells differ from census`);
    const o = obs?.observer ?? {};
    if (canonical(o.cumulative) !== canonical(line.cumulative)) issues.push(`checkpoint ${k.step} cumulative observer values differ from census`);
    if (canonical(o.masks) !== canonical(line.masks) || o.lightExposure !== line.lightExposure || o.activeBArea !== line.activeBArea) issues.push(`checkpoint ${k.step} observer totals differ from census`);
    if (String(state.lightIn) !== String(line.lightIn) || String(state.heatOut) !== String(line.heatOut)) issues.push(`checkpoint ${k.step} ledger differs from census`);
    if (canonical(totalsOf(state.cfg, state.cells)) !== canonical(line.totals)) issues.push(`checkpoint ${k.step} channel totals differ from census`);
    if (canonical(Object.fromEntries(FLUX_NAMES.map((f, i) => [f, state.flux[i]]))) !== canonical(line.flux)) issues.push(`checkpoint ${k.step} flux differs from census`);
  }
  if (issues.length) return { id: c.id, status: "invalid", issues: issues.slice(0, 20) };
  const out: Any = {
    id: c.id,
    status: "complete",
    attempt: done.attempt,
    resultSha256: await fileSha256(join(done.dir, "result.json")),
    extinct: lines.get(c.horizon).cells.B.every((b: number) => b === 0),
  };
  const site = (s: number, from: number, to: number) => windowOk(lines, s, from, to, every, V, Qmin, Rmin);
  if (c.kind === "main") {
    const source = c.sourceSites[0], w = e.mainWindow;
    const src = site(source, w.from, w.to);
    const srcMaintained = src.B && src.Qok && src.Rok;
    const qualifying: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === source) continue;
      const s = site(j, w.from, w.to);
      if (s.B && s.Qok && s.Rok) qualifying.push(j);
    }
    out.renew = srcMaintained && qualifying.length > 0;
    out.sourceMaintained = srcMaintained;
    out.qualifyingSites = qualifying;
    out.source = { minB: String(src.minB), Q: String(src.Q), R: String(src.R) };
  } else if (c.kind === "capacity" || c.kind === "division") {
    const w = e.controlWindow;
    const sites = c.sourceSites.map((s) => site(s, w.from, w.to));
    out.bothSitesPersist = sites.every((s) => s.B && s.Qok);
    out.sites = sites.map((s, k) => ({ site: c.sourceSites[k], minB: String(s.minB), Q: String(s.Q), R: String(s.R) }));
  } else {
    const w = e.mainWindow, maintained: number[] = [];
    for (let j = 0; j < n; j++) {
      const s = site(j, w.from, w.to);
      if (s.B && s.Qok && s.Rok) maintained.push(j);
    }
    out.anySiteMaintained = maintained.length > 0;
    out.maintainedSites = maintained;
  }
  out.buildExpenditureB = lines.get(c.horizon).flux.build;
  return out;
}

export async function cpuReplay(root: string, c: AuditCase, p: Any): Promise<Any> {
  const done = await completeAttempt(join(root, "cases", c.id));
  if (!done) return { case: c.id, backend: "cpu", status: "incomplete", reason: "no complete attempt" };
  const result = JSON.parse(await Deno.readTextFile(join(done.dir, "result.json")));
  const initial = await loadInitial(root, c);
  const start = totalsOf(initial.cfg, initial.cells);
  const sim = new RefSim(initial);
  const observer = new RenewalObserver(sim.state, c.sourceSites.map((s) => ({ name: `site-${s}`, sites: [s] })), start.matter);
  const saved = readJsonLines<Any>(join(done.dir, "census.jsonl"));
  let compared = 0, mutations = 0;
  const mismatches: string[] = [];
  const compare = async () => {
    const next = await saved.next();
    if (next.done) {
      mismatches.push(`no saved census at ${sim.state.step}`);
      return;
    }
    const s = sim.state, line = next.value;
    const ours = {
      ...observer.census(sim),
      case: c.id,
      stateHash: stateHash(s),
      totals: totalsOf(s.cfg, s.cells),
      flux: Object.fromEntries(FLUX_NAMES.map((k, i) => [k, s.flux[i].toString()])),
      lightIn: s.lightIn,
      heatOut: s.heatOut,
      matterResidual: "0",
      energyResidual: "0",
      mutations,
    };
    if (ledgerResidual(start, s) !== 0n) mismatches.push(`replay residual at ${s.step}`);
    if (canonical(ours) !== canonical(line)) mismatches.push(`census ${s.step} differs`);
    const k = result.checkpoints.find((x: Any) => x.step === s.step);
    if (k && artifactDigest(s, { case: c.id, observer: observer.snapshot() }) !== k.artifactDigest) mismatches.push(`checkpoint ${s.step} digest differs`);
    compared++;
  };
  const began = performance.now();
  await compare();
  while (sim.state.step < c.horizon && mismatches.length < 5) {
    observer.beforeStep(sim);
    mutations += sim.step().events.length;
    observer.afterStep(sim);
    if (sim.state.step % p.censusEvery === 0) await compare();
  }
  if (!(await saved.next()).done) mismatches.push("saved census has extra records");
  return { case: c.id, backend: "cpu", status: mismatches.length ? "mismatch" : "match", censusesCompared: compared, steps: sim.state.step, mismatches, elapsedMs: Math.round(performance.now() - began) };
}

export async function gpuReplay(root: string, c: AuditCase, p: Any): Promise<Any> {
  const done = await completeAttempt(join(root, "cases", c.id));
  if (!done) return { case: c.id, backend: "gpu", status: "incomplete", reason: "no complete attempt" };
  if (!("gpu" in navigator)) return { case: c.id, backend: "gpu", status: "incomplete", reason: "no WebGPU" };
  const initial = await loadInitial(root, c);
  const device = await requestDevice(navigator.gpu, initial.cfg);
  let lost = "";
  device.lost.then((x) => {
    if (x.reason !== "destroyed") lost = x.message;
  });
  const gpu = await GpuSim.create(device, initial);
  const mismatches: string[] = [];
  let compared = 0, mutations = 0;
  const began = performance.now();
  try {
    const saved = readJsonLines<Any>(join(done.dir, "census.jsonl"));
    const first = await saved.next();
    if (first.done || first.value.stateHash !== stateHash(initial)) mismatches.push("initial census");
    for (let step = p.censusEvery; step <= c.horizon && mismatches.length < 5; step += p.censusEvery) {
      gpu.run(p.censusEvery);
      const ledger = await gpu.drainLedger();
      if (lost) throw new Error(`GPU lost: ${lost}`);
      if (ledger.dropped) mismatches.push(`dropped events at ${step}`);
      mutations += ledger.events.length;
      const state = await gpu.readState();
      const roles = await gpu.readRoles();
      const next = await saved.next();
      if (next.done) {
        mismatches.push(`no saved census at ${step}`);
        break;
      }
      const line = next.value;
      const flux = Object.fromEntries(FLUX_NAMES.map((k, i) => [k, state.flux[i].toString()]));
      if (state.step !== step || line.step !== step) mismatches.push(`step ${state.step} vs ${line.step}`);
      if (stateHash(state) !== line.stateHash) mismatches.push(`state hash at ${step}`);
      if (canonical(flux) !== canonical(line.flux)) mismatches.push(`flux at ${step}`);
      if (String(state.lightIn) !== String(line.lightIn) || String(state.heatOut) !== String(line.heatOut)) mismatches.push(`ledger at ${step}`);
      if (rolesDigest(roles) !== line.lastStepRolesDigest) mismatches.push(`last-step roles at ${step}`);
      compared++;
    }
  } finally {
    gpu.destroy?.();
    device.destroy();
  }
  if (mutations) mismatches.push(`${mutations} GPU mutation events`);
  return {
    case: c.id,
    backend: "gpu",
    status: mismatches.length ? "mismatch" : "match",
    censusesCompared: compared,
    mismatches,
    elapsedMs: Math.round(performance.now() - began),
    claim: "state hash, global ledger and flux, and last-step roles at every census; no per-step GPU readback",
  };
}

/** Independent candidate selection, from the audit's own per-case RENEW values. */
export function auditSelection(cases: Record<string, Any>, all: AuditCase[], p: Any) {
  const pilot = all.filter((c) => c.phase === "pilot");
  if (all.length !== p.budget.pilotControlHistories || Object.values(cases).some((c: Any) => c.status !== "complete")) return { status: "incomplete" };
  const eligible = [];
  for (const h of p.phases.confirmation.selectionOrder) {
    if (!p.phases.confirmation.eligibleSpreads.includes(h.spread)) continue;
    const arms = pilot.filter((c) => c.reservoir === h.reservoir && c.spread === h.spread);
    if (arms.length !== 4) return { status: "incomplete" };
    if (arms.some((c) => cases[c.id].renew === true)) eligible.push({ reservoir: h.reservoir, spread: h.spread });
  }
  return eligible.length ? { status: "selected", habitat: eligible[0], eligible } : { status: "none-eligible", eligible: [] };
}

export function auditDecision(cases: Record<string, Any>, conf: AuditCase[], p: Any) {
  if (Object.values(cases).some((c: Any) => c.status !== "complete")) return { status: "incomplete" };
  const arms: string[] = p.phases.confirmation.arms, seeds: number[] = p.seeds.confirmation, need = p.phases.confirmation.blocksRequired;
  const matrix: Record<string, Record<string, boolean>> = {};
  for (const a of arms) matrix[a] = {};
  for (const c of conf) matrix[c.arm][String(c.seed)] = cases[c.id].renew;
  const counts = Object.fromEntries(arms.map((a) => [a, seeds.reduce((s, x) => s + (matrix[a][String(x)] ? 1 : 0), 0)]));
  const confirmed = arms.some((a) => counts[a] >= need);
  let specific = 0;
  for (const seed of seeds) {
    const id = (arm: string) => conf.find((c) => c.arm === arm && c.seed === seed)!.id;
    const builderOnly = matrix.builder[String(seed)] && arms.every((a) => a === "builder" || !matrix[a][String(seed)]);
    const paid = BigInt(cases[id("builder")].buildExpenditureB) > 0n && BigInt(cases[id("ablation")].buildExpenditureB) > 0n;
    if (builderOnly && paid) specific++;
  }
  return { status: "complete", matrix, counts, confirmed, constructionSpecific: specific >= need, specificBlockCount: specific };
}

/**
 * Independent check that the frozen confirmation panel is exactly the one the
 * protocol prescribes for the habitat the passing pilot audit selected.
 */
async function confirmationPanelIssues(root: string, repo: string, p: Any, manifestSha256: string, conf: Any, pilotAudit: Any): Promise<string[]> {
  const out: string[] = [];
  const freezePath = join(root, "confirmation", "freeze.json");
  const frozen = JSON.parse(await Deno.readTextFile(join(root, "confirmation", "FROZEN.json")));
  if (frozen.freezeSha256 !== await fileSha256(freezePath)) out.push("freeze.json differs from its FROZEN record");
  if (conf.manifestSha256 !== manifestSha256) out.push("confirmation belongs to another manifest");
  const sel = pilotAudit?.audit?.selection;
  if (!sel || sel.status !== "selected") out.push("no passing pilot audit pinned by the freeze selected a habitat");
  else if (canonical(sel.habitat) !== canonical(conf.habitat)) out.push(`frozen habitat ${canonical(conf.habitat)} is not the audit's ${canonical(sel.habitat)}`);
  const inputs: RenewalInputs = {
    witness: JSON.parse(await Deno.readTextFile(join(repo, p.inputs.witness.path))),
    selected: JSON.parse(await Deno.readTextFile(join(repo, p.inputs.selected.path))),
  };
  const cc = p.phases.confirmation, founder = p.phases.pilot.founder;
  const cases: Any[] = conf.cases;
  if (cases.length !== cc.arms.length * p.seeds.confirmation.length || cases.length !== p.budget.confirmationHistories) out.push("panel size");
  if (new Set(cases.map((c) => c.id)).size !== cases.length) out.push("duplicate case ids");
  for (const seed of p.seeds.confirmation) {
    for (const arm of cc.arms) {
      const hits = cases.filter((c) => c.arm === arm && c.seed === seed);
      if (hits.length !== 1) {
        out.push(`${arm}/${seed}: ${hits.length} cases`);
        continue;
      }
      const c = hits[0];
      if (c.phase !== "confirmation" || c.kind !== "main" || c.reservoir !== conf.habitat.reservoir || c.spread !== conf.habitat.spread || c.horizon !== cc.horizon) out.push(`${c.id}: specification`);
      if (canonical(c.founders) !== canonical([founder]) || canonical(c.sourceSites) !== canonical([founder.y * 32 + founder.x])) out.push(`${c.id}: founders`);
      const expected = initialState(p, inputs, { ...c, founders: [founder] });
      if (stateHash(expected) !== c.initialStateHash) out.push(`${c.id}: initial state is not the prescribed one`);
    }
  }
  return out;
}

async function main(op: string, root: string): Promise<void> {
  const repo = moduleRoot(import.meta.url);
  const p = JSON.parse(await Deno.readTextFile(join(repo, PROTOCOL_PATH)));
  const manifestSha256 = await fileSha256(join(root, "manifest.json"));
  const frozen = JSON.parse(await Deno.readTextFile(join(root, "FROZEN.json")));
  if (frozen.manifestSha256 !== manifestSha256) throw new Error("manifest.json differs from FROZEN.json");
  if (frozen.protocolSha256 !== await fileSha256(join(repo, PROTOCOL_PATH))) throw new Error("protocol differs from the frozen one");
  const manifest = JSON.parse(await Deno.readTextFile(join(root, "manifest.json")));
  if (op === "pilot") {
    const dir = await newVerifyAttempt(root, "pilot");
    const all: AuditCase[] = manifest.cases;
    const replays = [];
    for (const id of p.verification.replayCases) {
      const c = all.find((x) => x.id === id)!;
      for (const backend of p.verification.backends) {
        let r: Any;
        try {
          r = backend === "cpu" ? await cpuReplay(root, c, p) : await gpuReplay(root, c, p);
        } catch (e) {
          r = { case: id, backend, status: "incomplete", reason: `replay error: ${(e as Error).message}` };
        }
        await writeJsonOnce(join(dir, `${backend}-replay-${id}.json`), r);
        console.log(json({ replay: id, backend, status: r.status, censusesCompared: r.censusesCompared, elapsedMs: r.elapsedMs }));
        replays.push(r);
      }
    }
    const cases: Record<string, Any> = {};
    for (const c of all) cases[c.id] = await auditCase(root, c, p);
    const selection = auditSelection(cases, all, p);
    const ok = replays.every((r) => r.status === "match") && Object.values(cases).every((c: Any) => c.status === "complete") && selection.status !== "incomplete";
    const sha = await writeJsonOnce(join(dir, "audit.json"), {
      auditVersion: RENEWAL_AUDIT_VERSION,
      manifestSha256,
      createdAt: new Date().toISOString(),
      status: ok ? "pass" : "fail",
      replays: replays.map((r) => ({ case: r.case, backend: r.backend, status: r.status, censusesCompared: r.censusesCompared, mismatches: r.mismatches, reason: r.reason })),
      cases,
      selection,
    });
    console.log(json({ attempt: dir, pilotAuditSha256: sha, status: ok ? "pass" : "fail", selection }));
    if (!ok) Deno.exit(1);
  } else if (op === "final") {
    const freezePath = join(root, "confirmation", "freeze.json");
    if (!(await exists(freezePath))) throw new Error("no confirmation was frozen");
    const conf = JSON.parse(await Deno.readTextFile(freezePath));
    // The pilot audit pinned by the confirmation freeze, not merely the latest one: a later
    // equivalent audit has a different hash and must not revoke an immutable freeze.
    let pilotAudit: Any = null;
    if (typeof conf.pilotAuditPath === "string" && !conf.pilotAuditPath.includes("..")) {
      const path = join(root, conf.pilotAuditPath);
      if (await exists(path)) {
        const sha256 = await fileSha256(path);
        const audit = JSON.parse(await Deno.readTextFile(path));
        if (sha256 === conf.pilotAuditSha256 && audit.status === "pass" && audit.manifestSha256 === manifestSha256) pilotAudit = { sha256, audit };
      }
    }
    const panelIssues = await confirmationPanelIssues(root, repo, p, manifestSha256, conf, pilotAudit);
    const dir = await newVerifyAttempt(root, "final");
    const cases: Record<string, Any> = {};
    if (!panelIssues.length) for (const c of conf.cases) cases[c.id] = await auditCase(root, c, p);
    const decision = panelIssues.length ? { status: "incomplete" } : auditDecision(cases, conf.cases, p);
    const ok = !panelIssues.length && decision.status === "complete";
    const sha = await writeJsonOnce(join(dir, "audit.json"), {
      auditVersion: RENEWAL_AUDIT_VERSION,
      manifestSha256,
      confirmationFreezeSha256: await fileSha256(freezePath),
      pilotAuditSha256: pilotAudit?.sha256 ?? null,
      createdAt: new Date().toISOString(),
      status: ok ? "pass" : "fail",
      panelIssues,
      cases,
      decision,
    });
    console.log(json({ attempt: dir, finalAuditSha256: sha, status: ok ? "pass" : "fail", panelIssues, decision }));
    if (!ok) Deno.exit(1);
  } else {
    throw new Error(`unknown operation ${op}`);
  }
}

if (import.meta.main) {
  const op = Deno.args[0];
  const i = Deno.args.indexOf("--root");
  if (i < 0 || !Deno.args[i + 1]) throw new Error("missing --root");
  const root = absoluteRoot(Deno.args[i + 1]);
  await runFromSnapshot(import.meta.url, ENTRY, root, [op, "--root", root]);
  await checkModuleIdentity(join(root, "source"), [
    [RefSim, "packages/sim-ref/src/index.ts", "RefSim"],
    [GpuSim, "packages/sim-gpu/src/index.ts", "GpuSim"],
    [stateHash, "packages/schema/src/index.ts", "stateHash"],
    [decodeCheckpoint, "packages/schema/src/index.ts", "decodeCheckpoint"],
    [totalsOf, "packages/schema/src/index.ts", "totalsOf"],
    [artifactDigest, "packages/schema/src/index.ts", "artifactDigest"],
    [RenewalObserver, "tools/lib/construction-renewal-observer.ts", "RenewalObserver"],
    [initialState, "tools/lib/construction-renewal.ts", "initialState"],
    ...OBSERVER_BINDINGS,
    ...RENEWAL_LIB_BINDINGS,
  ]);
  await main(op, root);
}
