// Pinned renewal case runner and validator (decision D5). NOT run directly:
// tools/lib/discovery-pin.ts launches it with
//   --config=vendor/construction-renewal-v1/deno.json --no-lock --no-remote --no-npm
// so `@bl/schema` and `@bl/sim-ref` below are the pinned construction
// packages. The renewal observer and its readout are the reviewed, frozen
// construction code, imported unchanged from the vendored tree; nothing here
// re-implements them. From the workbench it uses only the pure canonical-JSON
// and digest helpers of packages/schema/src/discovery.ts.
//
// Verbs (JSON request on stdin, JSON reply on stdout; binaries as base64):
//   freeze-check  {cases: [{spec, initial: b64}]}     -> {checks: [{ok, reason}]}
//   run           {spec, initial, opts}               -> {result, files}
//   validate      {spec, initial, result, files} -> {errors, readout}
//   readout       {spec, records, initialA}           -> readout   (tests: the adapter's mapping on synthetic records)

import {
  CH,
  validateConfig,
  decodeCheckpoint,
  encodeCheckpoint,
  FLUX_NAMES,
  ledgerResidual,
  stateHash,
  totalsOf,
  type WorldState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import {
  checkObserverDomain,
  RENEWAL_OBSERVER_VERSION,
  RenewalObserver,
  roleCounterBound,
  type ObserverSnapshot,
} from "../vendor/construction-renewal-v1/tools/lib/construction-renewal-observer.ts";
import { type CaseInfo, type CensusLine, readCase, RENEWAL_READOUT_VERSION, type Thresholds } from "../vendor/construction-renewal-v1/tools/lib/construction-renewal-readout.ts";
import { canonicalJSON, RENEWAL_PIN, sha256Hex } from "../packages/schema/src/discovery.ts";

const RENEWAL_PIN_READOUT = RENEWAL_PIN.readoutVersion;
const RESULT_FILES = ["observations.jsonl", "readout.json", "end.blck"] as const;

// deno-lint-ignore no-explicit-any
type Any = any;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The pinned protocol's fixed endpoints (RENEWAL-PLAN section 5), read from the vendored copy. */
const PROTOCOL = JSON.parse(await Deno.readTextFile(new URL("../vendor/construction-renewal-v1/experiments/construction/renewal-v1/protocol.json", import.meta.url)));
const TH: Thresholds = { ...PROTOCOL.endpoints, censusEvery: PROTOCOL.censusEvery };

/**
 * Workbench assays over the pinned readout. Each names the measured outcome
 * and what the fixture expects of it; `met` is whether the expectation held.
 */
export const ASSAYS: Record<string, { kind: CaseInfo["kind"]; steps: number; expect: string }> = {
  "renewal-main": { kind: "main", steps: 10000, expect: "RENEW true: the source and a fixed site outside it are maintained over steps 9000-10000" },
  "renewal-null": { kind: "small-founder", steps: 10000, expect: "no fixed site is maintained over steps 9000-10000" },
  "renewal-positive": { kind: "small-founder", steps: 10000, expect: "at least one fixed site is maintained over steps 9000-10000" },
  "renewal-control": { kind: "capacity", steps: 3000, expect: "every initial site keeps B >= V at all censuses 2000-3000 with Q >= Qmin" },
};

function sitesOf(spec: Any): number[] {
  const W = spec.resolvedWorldConfig.tileW;
  return spec.observationSchedule.sites.map((s: { x: number; y: number }) => s.y * W + s.x);
}

function caseInfo(spec: Any): CaseInfo {
  const a = ASSAYS[spec.assayId];
  if (!a) throw new Error(`unknown renewal assay ${spec.assayId}`);
  return { id: spec.fixtureId, phase: "pilot", kind: a.kind, arm: spec.armId, seed: spec.physicsSeed, reservoir: 0, spread: spec.resolvedWorldConfig.spread, horizon: spec.steps, sourceSites: sitesOf(spec) };
}

/** The workbench readout of one renewal case, mapped from the pinned production readout. */
export function renewalReadout(spec: Any, records: CensusLine[], initialA: string): Any {
  const a = ASSAYS[spec.assayId];
  const r = readCase(caseInfo(spec), records, TH, initialA);
  const base = { readoutVersion: RENEWAL_PIN_READOUT, pinnedReadoutVersion: RENEWAL_READOUT_VERSION, assayId: spec.assayId, fixtureId: spec.fixtureId, expectation: a.expect };
  if (r.status !== "complete") return { ...base, status: "invalid-or-incomplete", met: false, extinct: null, details: { reason: r.reason } };
  const measured = spec.assayId === "renewal-main" ? r.renew === true
    : spec.assayId === "renewal-control" ? r.bothSitesPersist === true
    : r.anySiteMaintained === true;
  const met = spec.assayId === "renewal-null" ? !measured : measured;
  return { ...base, status: met ? "supported" : "unsupported-within-tested-domain", met, extinct: r.extinct, details: r };
}

function observerMasks(spec: Any) {
  return sitesOf(spec).map((s) => ({ name: `site-${s}`, sites: [s] }));
}

function fluxRecord(s: WorldState): Record<string, string> {
  return Object.fromEntries(FLUX_NAMES.map((k, i) => [k, s.flux[i].toString()]));
}

/** One census line: the observer's record plus the physics ledgers, in canonical JSON. */
function censusLine(obs: RenewalObserver, sim: RefSim, mutations: number): Any {
  const s = sim.state;
  return JSON.parse(canonicalJSON({ ...obs.census(sim), stateHash: stateHash(s), totals: totalsOf(s.cfg, s.cells), flux: fluxRecord(s), lightIn: s.lightIn, heatOut: s.heatOut, mutations }));
}

function decodeInitial(spec: Any, bytes: Uint8Array): WorldState {
  const { state } = decodeCheckpoint(bytes);
  if (canonicalJSON(state.cfg) !== canonicalJSON(spec.resolvedWorldConfig)) throw new Error("initial artifact config differs from the case's resolved config");
  if (state.step !== 0) throw new Error("initial artifact is not at step 0");
  return state;
}

/**
 * The case's shape against what the pinned readout can measure: a known assay,
 * its horizon, the census cadence, no segmentation, and sites bound to the
 * initial footprint. A renewal-main source is the single initialized cell, so
 * a seeded second founder can never count as renewal; a control names exactly
 * its initialized sites, so it can never be vacuous.
 */
function shapeErrors(spec: Any, state: WorldState): string[] {
  const errs: string[] = [];
  const a = ASSAYS[spec.assayId];
  if (!a) return [`unknown renewal assay ${spec.assayId}`];
  if (spec.steps !== a.steps) errs.push(`assay ${spec.assayId} runs ${a.steps} steps, not ${spec.steps}`);
  if (spec.observationSchedule.censusEvery !== TH.censusEvery) errs.push(`the pinned readout needs a census every ${TH.censusEvery} steps`);
  if (spec.observationSchedule.segmentAt.length) errs.push("pinned renewal cases are not segmented");
  const cfg = state.cfg, n = cfg.tileW * cfg.tileH;
  const sites = spec.observationSchedule.sites as { x: number; y: number }[];
  if (!sites.length) errs.push("a renewal case needs at least one site");
  if (sites.some((s) => s.x >= cfg.tileW || s.y >= cfg.tileH)) errs.push("a site lies outside the tile");
  const idx = sitesOf(spec);
  if (new Set(idx).size !== idx.length) errs.push("duplicate sites");
  const footprint: number[] = [];
  for (let i = 0; i < n; i++) if (state.cells[CH.B * n + i] > 0 || state.cells[CH.P * n + i] > 0) footprint.push(i);
  if (spec.assayId === "renewal-main" && !(footprint.length === 1 && idx.length === 1 && idx[0] === footprint[0])) {
    errs.push("renewal-main needs exactly one initialized cell, and that cell as its only site (the source)");
  }
  if (spec.assayId === "renewal-control" && !(footprint.length > 0 && JSON.stringify([...idx].sort((p, q) => p - q)) === JSON.stringify(footprint))) {
    errs.push("renewal-control needs its sites to be exactly the initialized cells");
  }
  return errs;
}

function freezeCheck(spec: Any, bytes: Uint8Array): { ok: boolean; reason: string } {
  try {
    const { state } = decodeCheckpoint(bytes);
    const cfgErrs = validateConfig(state.cfg);
    if (cfgErrs.length) return { ok: false, reason: `the pinned build rejects the config: ${cfgErrs.join("; ")}` };
    const shape = shapeErrors(spec, state);
    if (shape.length) return { ok: false, reason: `unsupported case shape: ${shape.join("; ")}` };
    checkObserverDomain(state.cfg);
    const bound = roleCounterBound(state.cfg, totalsOf(state.cfg, state.cells).matter);
    if (bound >= 0xffff) return { ok: false, reason: `unsupported measurement: per-cell role counters could saturate (bound ${bound} >= 65535)` };
    return { ok: true, reason: `role bound ${bound}` };
  } catch (e) {
    return { ok: false, reason: `unsupported measurement: ${(e as Error).message}` };
  }
}

async function run(req: Any): Promise<Any> {
  const { spec, opts } = req;
  const startedMs = Date.now();
  const initialBytes = unb64(req.initial);
  if ((await sha256Hex(initialBytes)) !== spec.initialArtifactDigest) throw new Error("initial artifact does not match the case's digest");
  if (!ASSAYS[spec.assayId] || ASSAYS[spec.assayId].steps !== spec.steps || spec.observationSchedule.censusEvery !== TH.censusEvery) {
    throw new Error(`renewal assay ${spec.assayId} needs ${ASSAYS[spec.assayId]?.steps} steps and a census every ${TH.censusEvery}`);
  }
  const start = decodeInitial(spec, initialBytes);
  const shape = shapeErrors(spec, start);
  if (shape.length) throw new Error(`unsupported case shape: ${shape.join("; ")}`);
  const t0 = totalsOf(start.cfg, start.cells);
  const sim = new RefSim(start);
  const obs = new RenewalObserver(sim.state, observerMasks(spec), t0.matter);
  const records: Any[] = [];
  let mutations = 0;
  const census = () => {
    const s = sim.state;
    if (totalsOf(s.cfg, s.cells).matter !== t0.matter || ledgerResidual(t0, s) !== 0n) throw new Error(`conservation failure at step ${s.step}`);
    records.push(censusLine(obs, sim, mutations));
  };
  census();
  const deadline = opts.deadlineMs ?? Infinity;
  while (sim.state.step < spec.steps) {
    obs.beforeStep(sim);
    mutations += sim.step().events.length;
    obs.afterStep(sim);
    if (sim.state.step % TH.censusEvery === 0) census();
    if (sim.state.step % 500 === 0 && Date.now() > deadline) throw new Error(`case exceeded its wall-time limit at step ${sim.state.step}`);
  }
  records.push({ kind: "final", step: sim.state.step, mutations, matterResidualMax: "0", energyResidualMax: "0" });
  const readout = renewalReadout(spec, records.slice(0, -1), String(t0.A));
  const files: Record<string, Uint8Array> = {
    "observations.jsonl": enc.encode(records.map((r) => canonicalJSON(r)).join("\n") + "\n"),
    "readout.json": enc.encode(canonicalJSON(readout)),
    "end.blck": encodeCheckpoint(sim.state, { renewal: obs.snapshot() }),
  };
  const digests: Record<string, string> = {};
  for (const f of RESULT_FILES) digests[f] = await sha256Hex(files[f]);
  const canonical = {
    caseId: req.caseId,
    campaignDigest: spec.campaignDigest,
    startArtifactDigest: spec.initialArtifactDigest,
    endStateHash: stateHash(sim.state),
    endArtifactDigest: digests["end.blck"],
    canonicalObservationDigests: { observations: digests["observations.jsonl"] },
    readoutDigest: digests["readout.json"],
    invariantChecks: { matterResidualMax: "0", energyResidualMax: "0", fluxIdentityViolations: 0, passed: true },
    outcome: "completed",
  };
  const execution = {
    attemptId: opts.attemptId,
    role: opts.role,
    leaseId: opts.leaseId,
    workerId: opts.workerId,
    physicalHostId: opts.physicalHostId,
    backendBuild: opts.backendBuild,
    sourceClosureDigest: opts.sourceClosureDigest,
    startedAt: new Date(startedMs).toISOString(),
    measuredWallMs: Math.max(0, Date.now() - startedMs),
    artifactSizes: Object.fromEntries(RESULT_FILES.map((f) => [f, files[f].byteLength])),
    files: digests,
  };
  return { result: { schemaVersion: "discovery-v1", canonical, execution }, files: Object.fromEntries(RESULT_FILES.map((f) => [f, b64(files[f])])) };
}

const DEC = (v: unknown) => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v);
const HEX16 = (v: unknown) => typeof v === "string" && /^[0-9a-f]{16}$/.test(v);
const CENSUS_KEYS = ["activeBArea", "cells", "cumulative", "flux", "heatOut", "kind", "lastStepRolesDigest", "lightExposure", "lightIn", "masks", "mutations", "stateHash", "step", "totals"];
const CUM_KEYS = ["boundBIn", "boundBOut", "boundEIn", "boundEOut", "decomp", "grow", "photo", "reactB", "reactE", "resp"];
const TOTAL_KEYS = ["A", "B", "C", "E", "P", "S", "energy", "matter"];
const PATCH_KEYS = ["grossIn", "grossOut", "internal", "netIn"];
const keysAre = (o: unknown, keys: string[]) => !!o && typeof o === "object" && !Array.isArray(o) && JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());
const intArr = (a: unknown, n: number, signed: boolean) => Array.isArray(a) && a.length === n && a.every((v) => Number.isSafeInteger(v) && (signed || (v as number) >= 0));
/** One mask's cumulative A/C traffic: non-negative gross and internal counts, netIn = grossIn - grossOut. */
const patchOk = (p: unknown) =>
  keysAre(p, ["A", "C"]) &&
  ["A", "C"].every((s) => {
    const f = (p as Any)[s];
    return keysAre(f, PATCH_KEYS) && PATCH_KEYS.every((k) => Number.isSafeInteger(f[k])) && f.grossIn >= 0 && f.grossOut >= 0 && f.internal >= 0 && f.netIn === f.grossIn - f.grossOut;
  });

/** The complete schema of one census record, before any accounting is read from it. */
function censusSchemaErrors(r: Any, n: number, siteNames: string[]): string[] {
  const out: string[] = [];
  if (!keysAre(r, CENSUS_KEYS) || r.kind !== "census") return ["census record fields"];
  if (!Number.isSafeInteger(r.step) || r.step < 0) out.push("step");
  if (!keysAre(r.cells, ["B", "E", "P"]) || !["B", "E", "P"].every((k) => intArr(r.cells[k], n, false))) out.push("cells");
  if (!keysAre(r.cumulative, CUM_KEYS) || !CUM_KEYS.every((k) => intArr(r.cumulative[k], n, k === "reactB" || k === "reactE"))) out.push("cumulative");
  if (!keysAre(r.totals, TOTAL_KEYS) || !TOTAL_KEYS.every((k) => DEC(r.totals[k]))) out.push("totals");
  if (!keysAre(r.flux, [...FLUX_NAMES]) || !FLUX_NAMES.every((k) => DEC(r.flux[k]))) out.push("flux");
  if (![r.lightIn, r.heatOut, r.lightExposure, r.activeBArea].every(DEC)) out.push("ledgers");
  if (!keysAre(r.masks, siteNames) || !siteNames.every((k) => patchOk(r.masks[k]))) out.push("masks");
  if (!HEX16(r.stateHash)) out.push("stateHash");
  if (!(r.step === 0 ? r.lastStepRolesDigest === "" : HEX16(r.lastStepRolesDigest))) out.push("lastStepRolesDigest");
  if (!Number.isSafeInteger(r.mutations) || r.mutations < 0) out.push("mutations");
  return out;
}

/** The observer snapshot of an end checkpoint, complete and consistent with the case. */
function snapshotErrors(s: Any, spec: Any, n: number, siteNames: string[]): string[] {
  if (!keysAre(s, ["activeBArea", "cumulative", "lightExposure", "masks", "step", "stepsObserved", "version"])) return ["observer snapshot fields"];
  const out: string[] = [];
  if (s.version !== RENEWAL_OBSERVER_VERSION) out.push(`observer version ${String(s.version)} is not ${RENEWAL_OBSERVER_VERSION}`);
  if (s.step !== spec.steps || s.stepsObserved !== spec.steps) out.push("observer snapshot did not observe every step");
  if (!keysAre(s.cumulative, CUM_KEYS) || !CUM_KEYS.every((k) => intArr(s.cumulative[k], n, k === "reactB" || k === "reactE"))) out.push("observer snapshot cumulative arrays");
  if (!keysAre(s.masks, siteNames) || !siteNames.every((k) => patchOk(s.masks[k]))) out.push("observer snapshot masks");
  if (!DEC(s.lightExposure) || !DEC(s.activeBArea)) out.push("observer snapshot ledgers");
  return out;
}
const sumBig = (a: number[]) => a.reduce((s, v) => s + BigInt(v), 0n);

/** Reconstructed identities of one census line (as in the construction audit), all in BigInt. */
function identities(line: Any, first: Any, prev: Any, cfg: Any, t0: Any, n: number, siteNames: string[]): string[] {
  const out: string[] = [];
  const T = line.totals, f = line.flux, cum = line.cumulative;
  if (!T || !f || !cum || !line.cells) return ["census record shape"];
  if (![...Object.values(T), ...Object.values(f), line.lightIn, line.heatOut, line.lightExposure, line.activeBArea].every(DEC)) return ["counter domain"];
  for (const k of ["B", "P", "E"]) if (!Array.isArray(line.cells[k]) || line.cells[k].length !== n || !line.cells[k].every((v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0)) return ["cells domain"];
  const b = (k: string) => BigInt(T[k]);
  const matter = b("A") + b("B") + b("C") + b("P");
  const energy = BigInt(cfg.eA) * b("A") + BigInt(cfg.eB) * b("B") + BigInt(cfg.eC) * b("C") + BigInt(cfg.eP) * b("P") + b("E") + b("S");
  if (matter !== b("matter") || matter !== t0.matter) out.push("matter");
  if (energy !== b("energy") || energy + BigInt(line.heatOut) - (t0.energy + BigInt(line.lightIn)) !== 0n) out.push("energy ledger");
  if (sumBig(line.cells.B) !== b("B") || sumBig(line.cells.P) !== b("P") || sumBig(line.cells.E) !== b("E")) out.push("cells vs totals");
  for (const r of ["photo", "grow", "resp", "decomp"]) if (sumBig(cum[r]) !== BigInt(f[r])) out.push(`${r} roles vs flux`);
  const fluxB = BigInt(f.photo) + BigInt(f.grow) - BigInt(f.resp) - BigInt(f.build) - BigInt(f.starve) - BigInt(f.bdecay);
  if (sumBig(cum.reactB) !== fluxB || b("B") - sumBig(first.cells.B) !== fluxB) out.push("B change vs flux");
  if (sumBig(cum.boundBIn) !== sumBig(cum.boundBOut) || sumBig(cum.boundEIn) !== sumBig(cum.boundEOut)) out.push("bound transport not conservative");
  for (let i = 0; i < n; i++) {
    if (line.cells.B[i] - first.cells.B[i] !== cum.reactB[i] + cum.boundBIn[i] - cum.boundBOut[i] || line.cells.E[i] - first.cells.E[i] !== cum.reactE[i] + cum.boundEIn[i] - cum.boundEOut[i]) {
      out.push(`local budget at cell ${i}`);
      break;
    }
  }
  if (prev) {
    for (const k of ["photo", "grow", "resp", "decomp", "boundBIn", "boundBOut", "boundEIn", "boundEOut"]) if (cum[k].some((v: number, i: number) => v < prev.cumulative[k][i])) out.push(`${k} decreased`);
    for (const k of FLUX_NAMES) if (BigInt(f[k]) < BigInt(prev.flux[k])) out.push(`flux ${k} decreased`);
    for (const m of siteNames) for (const s of ["A", "C"]) for (const k of ["grossIn", "grossOut", "internal"]) if (line.masks[m][s][k] < prev.masks[m][s][k]) out.push(`mask ${m} ${s}.${k} decreased`);
  }
  if (JSON.stringify(Object.keys(line.masks).sort()) !== JSON.stringify([...siteNames].sort())) out.push("site masks");
  return out;
}

async function validate(req: Any): Promise<Any> {
  const { spec, result } = req;
  const errors: string[] = [];
  const files: Record<string, Uint8Array> = Object.fromEntries(Object.entries(req.files as Record<string, string>).map(([k, v]) => [k, unb64(v)]));
  const initialBytes = unb64(req.initial);
  const start = decodeInitial(spec, initialBytes);
  const t0 = totalsOf(start.cfg, start.cells);
  const n = start.cfg.tileW * start.cfg.tileH;
  // End artifact: physics and the observer's state.
  let end: WorldState, observer: Any;
  try {
    ({ state: end, observer } = decodeCheckpoint(files["end.blck"]));
  } catch (e) {
    return { errors: [`end.blck: ${(e as Error).message}`], readout: null };
  }
  if (stateHash(end) !== result.canonical.endStateHash) errors.push("end state hash does not match the end artifact");
  if (end.step !== spec.steps) errors.push(`end state is at step ${end.step}, the case runs ${spec.steps}`);
  if (canonicalJSON(end.cfg) !== canonicalJSON(spec.resolvedWorldConfig)) errors.push("end state config differs from the case's");
  const shape = shapeErrors(spec, start);
  if (shape.length) return { errors: [...errors, `unsupported case shape: ${shape.join("; ")}`], readout: null };
  const names = observerMasks(spec).map((m) => m.name);
  if (!keysAre(observer, ["renewal"])) return { errors: [...errors, "end.blck observer section is not the renewal observer's"], readout: null };
  const snap = observer.renewal as ObserverSnapshot;
  const snapErrs = snapshotErrors(snap, spec, n, names);
  if (snapErrs.length) return { errors: [...errors, ...snapErrs], readout: null };
  // Observations: canonical lines, the schedule, identities at every census.
  const text = dec.decode(files["observations.jsonl"]);
  if (!text.endsWith("\n")) return { errors: [...errors, "observations: missing final newline"], readout: null };
  const lines = text.slice(0, -1).split("\n");
  const records: Any[] = [];
  for (const [i, line] of lines.entries()) {
    const r = JSON.parse(line);
    if (canonicalJSON(r) !== line) return { errors: [...errors, `observations: line ${i + 1} is not canonical`], readout: null };
    records.push(r);
  }
  const censuses = records.slice(0, -1), fin = records.at(-1);
  const want = spec.steps / TH.censusEvery + 1;
  if (censuses.length !== want || censuses.some((r, i) => r.step !== i * TH.censusEvery)) errors.push(`observations: expected ${want} censuses every ${TH.censusEvery} steps`);
  if (!keysAre(fin, ["energyResidualMax", "kind", "matterResidualMax", "mutations", "step"]) || fin.kind !== "final" || fin.step !== spec.steps || fin.mutations !== censuses.at(-1)?.mutations || fin.matterResidualMax !== "0" || fin.energyResidualMax !== "0") errors.push("observations: final record");
  for (const r of censuses) {
    const se = censusSchemaErrors(r, n, names);
    if (se.length) errors.push(`census ${String(r?.step)}: incomplete record (${se.join(", ")})`);
    if (errors.length > 20) break;
  }
  if (errors.length) return { errors, readout: null };
  let prev: Any = null;
  for (const r of censuses) {
    if (prev && r.mutations < prev.mutations) errors.push(`census ${r.step}: mutation count decreased`);
    for (const why of identities(r, censuses[0], prev, start.cfg, t0, n, names)) errors.push(`census ${r.step}: ${why}`);
    prev = r;
    if (errors.length > 20) break;
  }
  if (errors.length) return { errors, readout: null };
  // First census from the initial artifact; last census from the end artifact's state and observer.
  const fresh = new RefSim(start);
  if (canonicalJSON(censusLine(new RenewalObserver(fresh.state, observerMasks(spec), t0.matter), fresh, 0)) !== canonicalJSON(censuses[0])) errors.push("first census does not match the initial artifact");
  const endSim = new RefSim(end);
  const restored = censusLine(new RenewalObserver(endSim.state, observerMasks(spec), t0.matter, snap), endSim, fin.mutations);
  const last = { ...censuses.at(-1) };
  // The last step's role digest is not part of a checkpoint; every other field must re-derive.
  restored.lastStepRolesDigest = last.lastStepRolesDigest;
  if (canonicalJSON(restored) !== canonicalJSON(last)) errors.push("last census does not match the end artifact (state and observer)");
  if (last.stateHash !== stateHash(end)) errors.push("last census hash is not the end state's");
  const ic = result.canonical.invariantChecks;
  if (ic.matterResidualMax !== "0" || ic.energyResidualMax !== "0" || ic.fluxIdentityViolations !== 0 || ic.passed !== true) errors.push("invariant checks differ from the observations");
  if (fin.mutations !== 0 && spec.resolvedWorldConfig.mutRate === 0) errors.push("mutation events with mutRate 0");
  const readout = renewalReadout(spec, censuses, String(t0.A));
  if (canonicalJSON(readout) !== dec.decode(files["readout.json"])) errors.push("readout does not re-derive from the observations");
  if (readout.status === "invalid-or-incomplete") errors.push(`readout reports an invalid or incomplete history: ${readout.details.reason}`);
  return { errors, readout: errors.length ? null : readout };
}

if (import.meta.main) {
  const verb = Deno.args[0];
  const req = JSON.parse(await new Response(Deno.stdin.readable).text());
  let reply: unknown;
  if (verb === "freeze-check") reply = { checks: (req.cases as { spec: Any; initial: string }[]).map((c) => freezeCheck(c.spec, unb64(c.initial))) };
  else if (verb === "run") reply = await run(req);
  else if (verb === "validate") reply = await validate(req);
  else if (verb === "readout") reply = renewalReadout(req.spec, req.records, req.initialA);
  else throw new Error(`unknown verb ${verb}`);
  const out = enc.encode(JSON.stringify(reply));
  for (let o = 0; o < out.length;) o += await Deno.stdout.write(out.subarray(o));
}
