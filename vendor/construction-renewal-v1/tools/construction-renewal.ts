// Renewal experiment v1 (experiments/construction/RENEWAL-PLAN.md): freeze, run and read out.
//
//   deno run -A tools/construction-renewal.ts freeze --out runs/construction/renewal-v1
//   deno run -A tools/construction-renewal.ts controls --root runs/construction/renewal-v1
//   deno run -A tools/construction-renewal.ts pilot --root runs/construction/renewal-v1
//   deno run -A tools/construction-renewal-verify.ts pilot --root runs/construction/renewal-v1
//   deno run -A tools/construction-renewal.ts pilot-readout --root runs/construction/renewal-v1
//   # only after a qualifying, audited pilot:
//   deno run -A tools/construction-renewal.ts confirmation-freeze --root runs/construction/renewal-v1
//   deno run -A tools/construction-renewal.ts confirmation --root runs/construction/renewal-v1
//   deno run -A tools/construction-renewal-verify.ts final --root runs/construction/renewal-v1
//   deno run -A tools/construction-renewal.ts final-readout --root runs/construction/renewal-v1
//   deno run -A tools/construction-renewal.ts report --root runs/construction/renewal-v1 --out experiments/construction/renewal-v1
//
// `freeze` runs from the live workspace and executes zero steps. Every later
// operation re-executes itself from the verified frozen source tree
// <root>/source with its own import map and lock file.
import { join, relative } from "node:path";
import {
  artifactDigest,
  CH,
  decodeCheckpoint,
  encodeCheckpoint,
  FLUX_NAMES,
  genomeHex,
  ledgerResidual,
  stateHash,
  totalsOf,
  validateState,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import {
  armGenome,
  type CaseSpec,
  checkPairedArrays,
  enumerateConfirmationCases,
  enumerateInitialCases,
  expectedTotals,
  genomeByteDiff,
  initialState,
  type RenewalInputs,
  type RenewalProtocol,
  RENEWAL_LIB_BINDINGS,
  resolveConfig,
  sha256Hex,
  validateProtocol,
} from "./lib/construction-renewal.ts";
import { OBSERVER_BINDINGS, RENEWAL_OBSERVER_VERSION, RenewalObserver } from "./lib/construction-renewal-observer.ts";
import {
  type CaseInfo,
  type CaseReadout,
  type CensusLine,
  confirmationDecision,
  readCase,
  RENEWAL_READOUT_VERSION,
  selectHabitat,
  type Thresholds,
} from "./lib/construction-renewal-readout.ts";
import {
  absoluteRoot,
  checkModuleIdentity,
  completeAttempt,
  copySources,
  ENTRYPOINTS,
  exists,
  fileSha256,
  frozenSources,
  json,
  latestPassingAudit,
  listAttempts,
  moduleRoot,
  PROTOCOL_PATH,
  readJsonLines,
  runFromSnapshot,
  sourceClosure,
  writeJsonOnce,
} from "./lib/construction-renewal-store.ts";
import { renderFigure } from "./lib/construction-renewal-figure.ts";

const ENTRY = "tools/construction-renewal.ts";
const REVIEWED_REVISION = "002b12944b2af5b87c1e89446548565cea531754";
const FIGURE_SOURCES = ["tools/lib/construction-renewal-figure.ts"];

export async function loadProtocol(repo: string): Promise<{ protocol: RenewalProtocol; inputs: RenewalInputs; protocolSha256: string }> {
  const bytes = await Deno.readFile(join(repo, PROTOCOL_PATH));
  const protocol = JSON.parse(new TextDecoder().decode(bytes)) as RenewalProtocol;
  const errs = validateProtocol(protocol);
  if (errs.length) throw new Error(`invalid protocol: ${errs.join("; ")}`);
  if (await fileSha256(join(repo, protocol.plan.path)) !== protocol.plan.sha256) throw new Error("the plan's SHA-256 differs from the protocol");
  for (const input of [protocol.inputs.witness, protocol.inputs.selected]) {
    if (await fileSha256(join(repo, input.path)) !== input.sha256) throw new Error(`input ${input.path} does not match its frozen SHA-256`);
  }
  const inputs: RenewalInputs = {
    witness: JSON.parse(await Deno.readTextFile(join(repo, protocol.inputs.witness.path))),
    selected: JSON.parse(await Deno.readTextFile(join(repo, protocol.inputs.selected.path))),
  };
  return { protocol, inputs, protocolSha256: await sha256Hex(bytes) };
}

export function thresholds(p: RenewalProtocol): Thresholds {
  return { ...p.endpoints, censusEvery: p.censusEvery };
}

async function command(cmd: string, args: string[], cwd: string): Promise<string> {
  const out = await new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) throw new Error(`${cmd} ${args.join(" ")} failed: ${new TextDecoder().decode(out.stderr)}`);
  return new TextDecoder().decode(out.stdout).trim();
}

/** Every occurrence of a renewal seed in earlier construction manifests or protocols is contamination. */
async function seedContamination(repo: string, seeds: number[], ownRoot: string): Promise<string[]> {
  const hits: string[] = [];
  const pattern = new RegExp(`(^|[^0-9_])(${seeds.join("|")})([^0-9_]|$)`);
  async function walk(dir: string, depth: number): Promise<void> {
    if (!(await exists(dir)) || depth > 6) return;
    for await (const e of Deno.readDir(dir)) {
      const path = join(dir, e.name);
      if (path === ownRoot) continue;
      if (e.isDirectory) await walk(path, depth + 1);
      else if (e.isFile && (e.name === "manifest.json" || e.name === "protocol.json" || e.name === "summary.json")) {
        if (pattern.test(await Deno.readTextFile(path))) hits.push(path);
      }
    }
  }
  await walk(join(repo, "runs/construction"), 0);
  for await (const e of Deno.readDir(join(repo, "experiments/construction"))) {
    if (e.isFile && e.name.endsWith(".json")) {
      const path = join(repo, "experiments/construction", e.name);
      if (pattern.test(await Deno.readTextFile(path))) hits.push(path);
    }
  }
  return hits;
}

function caseRecord(p: RenewalProtocol, inputs: RenewalInputs, spec: CaseSpec, state: WorldState) {
  const totals = totalsOf(state.cfg, state.cells);
  return {
    ...spec,
    cfg: state.cfg,
    genome: genomeHex(armGenome(p, inputs, spec.arm)),
    initialStateHash: stateHash(state),
    initialTotals: totals,
    expectedTotals: expectedTotals(p, inputs, spec),
  };
}

async function writeInitialStates(root: string, p: RenewalProtocol, inputs: RenewalInputs, cases: CaseSpec[]) {
  const states = cases.map((spec) => ({ spec, state: initialState(p, inputs, spec) }));
  checkPairedArrays(states);
  const out = [];
  await Deno.mkdir(join(root, "initial"), { recursive: true });
  for (const { spec, state } of states) {
    if (state.step !== 0) throw new Error("initial states are at step 0");
    const rec = caseRecord(p, inputs, spec, state);
    const t = rec.initialTotals, e = rec.expectedTotals;
    if (t.B !== e.B || t.E !== e.E || t.matter !== e.matter || t.energy !== e.energy || t.P !== 0n || t.C !== 0n || t.S !== 0n) {
      throw new Error(`initial resources of ${spec.id} differ from the plan's table`);
    }
    const bytes = encodeCheckpoint(state, { case: spec.id, role: "initial" });
    const file = `initial/${spec.id}.blck`;
    await Deno.writeFile(join(root, file), bytes, { createNew: true });
    out.push({ ...rec, initialFile: file, initialFileSha256: await sha256Hex(bytes) });
  }
  return out;
}

/**
 * Phase 1, from the live workspace: seed check, exclusive root, copy of the
 * source closure, provenance. Initialization then runs in phase 2 from the
 * verified copy, so the bytes that initialize are the bytes that were frozen.
 */
async function freeze(outArg: string): Promise<void> {
  const repo = moduleRoot(import.meta.url);
  const root = absoluteRoot(outArg);
  const { protocol: p, protocolSha256 } = await loadProtocol(repo); // early validation; phase 2 re-checks against the copy
  const seeds = [p.seeds.pilot, ...p.seeds.confirmation];
  const contamination = await seedContamination(repo, seeds, root);
  if (contamination.length) throw new Error(`renewal seeds already occur in: ${contamination.join(", ")}`);
  await Deno.mkdir(join(root, ".."), { recursive: true });
  await Deno.mkdir(root); // exclusive: fails if the root exists
  const closure = await sourceClosure(repo, ENTRYPOINTS);
  // deno.lock stays outside the executable tree: the closure loads no npm or remote
  // module, and Deno would rewrite a lock it found next to the copied deno.json.
  const extra = ["deno.json", PROTOCOL_PATH, p.plan.path, p.inputs.witness.path, p.inputs.selected.path, ...FIGURE_SOURCES];
  const sources = await copySources(repo, root, [...closure, ...extra]);
  await writeJsonOnce(join(root, "sources.json"), sources);
  const lock = await Deno.readFile(join(repo, "deno.lock"));
  await Deno.writeFile(join(root, "deno.lock.at-freeze"), lock, { createNew: true });
  const dirty = (await command("jj", ["diff", "--from", REVIEWED_REVISION, "--name-only"], repo)).split("\n").filter(Boolean);
  await writeJsonOnce(join(root, "freeze-context.json"), {
    createdAt: new Date().toISOString(),
    protocolSha256,
    seedCheck: { seeds, scanned: ["runs/construction/**/{manifest,protocol,summary}.json", "experiments/construction/*.json"], contamination: [] },
    provenance: {
      reviewedRevision: REVIEWED_REVISION,
      jjRevision: await command("jj", ["log", "-r", "@", "--no-graph", "-T", "commit_id"], repo),
      jjChange: await command("jj", ["log", "-r", "@", "--no-graph", "-T", "change_id"], repo),
      changedSinceReviewedRevision: dirty,
      changedBoundSources: dirty.filter((path) => path in sources.files).map((path) => ({ path, sha256: sources.files[path] })),
      denoLockSha256: await sha256Hex(lock),
      deno: Deno.version,
      jj: await command("jj", ["--version"], repo),
      os: Deno.build,
      host: Deno.hostname(),
    },
  });
  await runFromSnapshot(import.meta.url, ENTRY, root, ["freeze-init", "--root", root]);
}

/** Phase 2, inside the frozen copy: initial states, manifest and FROZEN record. Zero steps. */
async function freezeInit(root: string): Promise<void> {
  if (await exists(join(root, "manifest.json")) || await exists(join(root, "FROZEN.json"))) throw new Error("this root is already frozen");
  const repo = moduleRoot(import.meta.url);
  const { sources, sourcesSha256 } = await frozenSources(root);
  const { protocol: p, inputs, protocolSha256 } = await loadProtocol(repo);
  if (sources.files[PROTOCOL_PATH] !== protocolSha256) throw new Error("protocol differs from its frozen copy");
  for (const pin of [p.plan, p.inputs.witness, p.inputs.selected]) {
    if (sources.files[pin.path] !== pin.sha256) throw new Error(`frozen copy of ${pin.path} does not match the protocol's pin`);
  }
  // Arms: one-byte matched comparator, ablation differs only by the gate switch.
  const builderHex = genomeHex(armGenome(p, inputs, "builder"));
  const diff = genomeByteDiff(builderHex, genomeHex(armGenome(p, inputs, "matched")));
  if (diff.length !== 1) throw new Error(`matched comparator differs in ${diff.length} bytes`);
  if (genomeHex(armGenome(p, inputs, "ablation")) !== builderHex) throw new Error("ablation genome differs from the builder");
  const cB = resolveConfig(p, inputs, { seed: 1, spread: 1, arm: "builder" }) as unknown as Record<string, unknown>;
  const cA = resolveConfig(p, inputs, { seed: 1, spread: 1, arm: "ablation" }) as unknown as Record<string, unknown>;
  const cfgDiff = Object.keys({ ...cA, ...cB }).filter((k) => cA[k] !== cB[k]);
  if (cfgDiff.join() !== "polymerTransport" || cA.polymerTransport !== false) throw new Error(`ablation config differs in ${cfgDiff}`);
  const contextPath = join(root, "freeze-context.json");
  const context = JSON.parse(await Deno.readTextFile(contextPath));
  // The seed check of phase 1 must concern exactly the protocol that was copied.
  if (context.protocolSha256 !== protocolSha256) throw new Error("the protocol changed between the seed check and the copy");
  if (JSON.stringify(context.seedCheck.seeds) !== JSON.stringify([p.seeds.pilot, ...p.seeds.confirmation]) || p.seeds.controls !== p.seeds.pilot) throw new Error("seed check does not cover the copied protocol's seeds");
  const cases = await writeInitialStates(root, p, inputs, enumerateInitialCases(p));
  const manifest = {
    kind: "construction-renewal-v1 manifest",
    createdAt: new Date().toISOString(),
    protocolId: p.id,
    protocolSha256,
    plan: p.plan,
    inputs: p.inputs,
    observerVersion: RENEWAL_OBSERVER_VERSION,
    readoutVersion: RENEWAL_READOUT_VERSION,
    stepsExecuted: 0,
    budget: p.budget,
    cases,
    sources,
    sourcesSha256,
    freezeContextSha256: await fileSha256(contextPath),
    provenance: context.provenance,
    seedCheck: context.seedCheck,
  };
  const manifestSha256 = await writeJsonOnce(join(root, "manifest.json"), manifest);
  await writeJsonOnce(join(root, "FROZEN.json"), {
    frozenAt: manifest.createdAt,
    protocolSha256,
    planSha256: p.plan.sha256,
    manifestSha256,
    sourcesSha256,
    sourceDigest: sources.digest,
    stepsExecuted: 0,
  });
  console.log(json({ frozen: root, protocolSha256, planSha256: p.plan.sha256, manifestSha256, sourceDigest: sources.digest, cases: cases.length, stepsExecuted: 0 }));
}

export interface ManifestCase extends CaseSpec {
  cfg: WorldConfig;
  initialStateHash: string;
  initialFile: string;
  initialFileSha256: string;
  initialTotals: Record<string, string>;
}

async function readManifest(root: string): Promise<{ manifest: { cases: ManifestCase[]; [k: string]: unknown }; sha256: string }> {
  const sha256 = await fileSha256(join(root, "manifest.json"));
  const frozen = JSON.parse(await Deno.readTextFile(join(root, "FROZEN.json")));
  if (frozen.manifestSha256 !== sha256) throw new Error("manifest.json differs from FROZEN.json");
  return { manifest: JSON.parse(await Deno.readTextFile(join(root, "manifest.json"))), sha256 };
}

const SPEC_KEYS = ["id", "phase", "kind", "arm", "seed", "reservoir", "spread", "horizon", "founders", "sourceSites", "habitat"] as const;

/**
 * The pilot readout, verified: bound to this manifest and to a passing
 * independent audit whose selection it repeats.
 */
async function verifiedPilotReadout(root: string, manifestSha256: string) {
  const path = join(root, "readout", "pilot-readout.json");
  const sha256 = await fileSha256(path);
  const readout = JSON.parse(await Deno.readTextFile(path));
  if (readout.manifestSha256 !== manifestSha256) throw new Error("pilot readout belongs to another manifest");
  const auditPath = join(root, readout.auditPath);
  if (await fileSha256(auditPath) !== readout.auditSha256) throw new Error("pilot audit changed after the readout");
  const audit = JSON.parse(await Deno.readTextFile(auditPath));
  if (audit.status !== "pass" || audit.manifestSha256 !== manifestSha256) throw new Error("pilot readout is not bound to a passing audit of this manifest");
  if (JSON.stringify({ s: audit.selection.status, h: audit.selection.habitat }) !== JSON.stringify({ s: readout.selection.status, h: readout.selection.habitat })) {
    throw new Error("pilot readout and audit select differently");
  }
  return { readout, sha256 };
}

/**
 * Confirmation cases, verified against the whole chain: confirmation FROZEN ->
 * freeze.json -> pilot readout -> passing audit -> manifest, and every case
 * equal to the prescribed panel for the selected habitat, initial states
 * regenerated. An unauthorized panel cannot execute or be read.
 */
async function confirmationCases(root: string, p: RenewalProtocol, inputs: RenewalInputs, manifestSha256: string): Promise<ManifestCase[]> {
  const path = join(root, "confirmation", "freeze.json");
  if (!(await exists(path))) return [];
  const frozen = JSON.parse(await Deno.readTextFile(join(root, "confirmation", "FROZEN.json")));
  if (frozen.freezeSha256 !== await fileSha256(path)) throw new Error("confirmation freeze.json differs from its FROZEN record");
  const rec = JSON.parse(await Deno.readTextFile(path));
  if (rec.manifestSha256 !== manifestSha256) throw new Error("confirmation belongs to another manifest");
  const { readout, sha256 } = await verifiedPilotReadout(root, manifestSha256);
  if (rec.pilotReadoutSha256 !== sha256) throw new Error("confirmation is not bound to the current pilot readout");
  if (rec.pilotAuditPath !== readout.auditPath || rec.pilotAuditSha256 !== readout.auditSha256) throw new Error("confirmation is not bound to the pilot readout's audit");
  if (readout.selection.status !== "selected" || JSON.stringify(readout.selection.habitat) !== JSON.stringify(rec.habitat)) {
    throw new Error("confirmation habitat is not the selected one");
  }
  const expected = enumerateConfirmationCases(p, rec.habitat);
  if (rec.cases.length !== expected.length) throw new Error("confirmation panel size differs from the protocol");
  expected.forEach((e, k) => {
    const c = rec.cases[k];
    for (const key of SPEC_KEYS) {
      if (JSON.stringify(c[key]) !== JSON.stringify(e[key])) throw new Error(`confirmation case ${k} differs from the prescribed panel in ${key}`);
    }
    if (c.initialFile !== `initial/${e.id}.blck`) throw new Error(`confirmation case ${e.id}: initial file`);
    if (c.initialStateHash !== stateHash(initialState(p, inputs, e))) throw new Error(`confirmation case ${e.id}: initial state is not the prescribed one`);
  });
  return rec.cases;
}

async function loadInitial(root: string, c: ManifestCase): Promise<WorldState> {
  const bytes = await Deno.readFile(join(root, c.initialFile));
  if (await sha256Hex(bytes) !== c.initialFileSha256) throw new Error(`initial state of ${c.id} changed`);
  const { state } = decodeCheckpoint(bytes);
  if (stateHash(state) !== c.initialStateHash || state.step !== 0) throw new Error(`initial state hash of ${c.id} differs`);
  return state;
}

function fluxRecord(s: WorldState): Record<string, string> {
  return Object.fromEntries(FLUX_NAMES.map((k, i) => [k, s.flux[i].toString()]));
}

/** Executes one case's complete history into a new exclusive attempt directory. */
export async function runCase(root: string, c: ManifestCase, checkpointSteps: number[], censusEvery: number, manifestSha256: string): Promise<void> {
  const caseDir = join(root, "cases", c.id);
  await Deno.mkdir(caseDir, { recursive: true });
  const attempts = await listAttempts(caseDir);
  if (attempts.some((a) => a.complete)) throw new Error(`${c.id} already has a complete attempt; it is immutable`);
  for (const a of attempts) {
    if (!a.superseded) {
      await writeJsonOnce(join(a.dir, "superseded.json"), {
        at: new Date().toISOString(),
        reason: a.failed ? "technical failure recorded in failed.json" : "interrupted: no result.json",
      });
    }
  }
  const attempt = (attempts.at(-1)?.attempt ?? 0) + 1;
  const dir = join(caseDir, `attempt-${attempt}`);
  await Deno.mkdir(dir); // exclusive
  const initial = await loadInitial(root, c);
  await writeJsonOnce(join(dir, "attempt.json"), {
    case: c.id,
    attempt,
    startedAt: new Date().toISOString(),
    host: Deno.hostname(),
    pid: Deno.pid,
    deno: Deno.version,
    manifestSha256,
    observerVersion: RENEWAL_OBSERVER_VERSION,
    previousAttempts: attempts.map((a) => a.attempt),
  });
  const began = performance.now();
  let step = 0;
  const census = await Deno.open(join(dir, "census.jsonl"), { write: true, createNew: true });
  try {
    const start = totalsOf(initial.cfg, initial.cells);
    const sim = new RefSim(initial);
    const masks = c.sourceSites.map((s) => ({ name: `site-${s}`, sites: [s] }));
    const observer = new RenewalObserver(sim.state, masks, start.matter);
    const n = sim.n;
    const offSource = c.spread === 0 ? Array.from({ length: n }, (_, i) => i).filter((i) => !c.sourceSites.includes(i)) : [];
    const checkpoints: { step: number; file: string; sha256: string; artifactDigest: string }[] = [];
    let mutations = 0;
    const encoder = new TextEncoder();
    const record = async () => {
      const s = sim.state;
      const totals = totalsOf(s.cfg, s.cells);
      const residual = ledgerResidual(start, s);
      if (totals.matter !== start.matter || residual !== 0n) throw new Error(`conservation failure at step ${s.step}`);
      const errs = validateState(s);
      if (errs.length) throw new Error(`invalid state at step ${s.step}: ${errs.join("; ")}`);
      const line = {
        ...observer.census(sim),
        case: c.id,
        stateHash: stateHash(s),
        totals,
        flux: fluxRecord(s),
        lightIn: s.lightIn,
        heatOut: s.heatOut,
        matterResidual: "0",
        energyResidual: "0",
        mutations,
      };
      await census.write(encoder.encode(JSON.stringify(line, (_, v) => typeof v === "bigint" ? v.toString() : v) + "\n"));
      if (checkpointSteps.includes(s.step)) {
        const observerPayload = { case: c.id, observer: observer.snapshot() };
        const bytes = encodeCheckpoint(s, observerPayload);
        const file = `checkpoint-${s.step}.blck`;
        await Deno.writeFile(join(dir, file), bytes, { createNew: true });
        checkpoints.push({ step: s.step, file, sha256: await sha256Hex(bytes), artifactDigest: artifactDigest(s, observerPayload) });
      }
    };
    await record();
    while (sim.state.step < c.horizon) {
      observer.beforeStep(sim);
      mutations += sim.step().events.length;
      observer.afterStep(sim);
      step = sim.state.step;
      if (mutations) throw new Error(`mutation event at step ${step} with mutRate 0`);
      for (const i of offSource) {
        if (sim.state.cells[CH.B * n + i] !== 0) throw new Error(`off-source B at cell ${i}, step ${step}, spread 0`);
      }
      if (step % censusEvery === 0) await record();
    }
    await census.syncData();
    census.close();
    const censusPath = join(dir, "census.jsonl");
    const info = await Deno.stat(censusPath);
    let bytes = info.size;
    for (const k of checkpoints) bytes += (await Deno.stat(join(dir, k.file))).size;
    await writeJsonOnce(join(dir, "result.json"), {
      case: c.id,
      attempt,
      status: "complete",
      horizon: c.horizon,
      finalStep: sim.state.step,
      finalStateHash: stateHash(sim.state),
      censusCount: c.horizon / censusEvery + 1,
      censusSha256: await fileSha256(censusPath),
      censusBytes: info.size,
      checkpoints,
      mutations,
      buildExpenditureB: sim.state.flux[FLUX_NAMES.indexOf("build")].toString(),
      elapsedMs: Math.round(performance.now() - began),
      artifactBytes: bytes,
      completedAt: new Date().toISOString(),
      observerVersion: RENEWAL_OBSERVER_VERSION,
    });
  } catch (e) {
    try {
      census.close();
    } catch { /* already closed */ }
    await writeJsonOnce(join(dir, "failed.json"), {
      at: new Date().toISOString(),
      step,
      reason: (e as Error).message,
      stack: (e as Error).stack,
      classification: "technical failure: incomplete, not a biological result",
    });
    throw e;
  }
}

async function runPhase(root: string, phase: "controls" | "pilot" | "confirmation"): Promise<void> {
  const { manifest, sha256 } = await readManifest(root);
  const repo = moduleRoot(import.meta.url);
  const { protocol: p, inputs } = await loadProtocol(repo);
  const all = phase === "confirmation" ? await confirmationCases(root, p, inputs, sha256) : manifest.cases;
  if (phase === "confirmation" && !all.length) throw new Error("confirmation is not frozen");
  if (phase === "pilot") {
    for (const c of manifest.cases.filter((c) => c.phase === "controls")) {
      if (!(await completeAttempt(join(root, "cases", c.id)))) throw new Error(`run all controls first: ${c.id} is not complete`);
    }
  }
  for (const c of all.filter((c) => c.phase === phase)) {
    if (await completeAttempt(join(root, "cases", c.id))) {
      console.log(json({ case: c.id, status: "already complete" }));
      continue;
    }
    console.log(json({ case: c.id, status: "running", horizon: c.horizon }));
    await runCase(root, c, p.checkpointSteps, p.censusEvery, sha256);
    const done = await completeAttempt(join(root, "cases", c.id));
    const result = JSON.parse(await Deno.readTextFile(join(done!.dir, "result.json")));
    console.log(json({ case: c.id, status: "complete", attempt: result.attempt, elapsedMs: result.elapsedMs, artifactBytes: result.artifactBytes, finalStateHash: result.finalStateHash }));
  }
}

export function caseInfo(c: ManifestCase): CaseInfo {
  return { id: c.id, phase: c.phase, kind: c.kind, arm: c.arm, seed: c.seed, reservoir: c.reservoir, spread: c.spread, horizon: c.horizon, sourceSites: c.sourceSites };
}

export async function readCompletedCase(root: string, c: ManifestCase, th: Thresholds): Promise<CaseReadout> {
  try {
    return await readCompletedCaseInner(root, c, th);
  } catch (e) {
    return { id: c.id, status: "incomplete", reason: `read error: ${(e as Error).message}` };
  }
}

async function readCompletedCaseInner(root: string, c: ManifestCase, th: Thresholds): Promise<CaseReadout> {
  const done = await completeAttempt(join(root, "cases", c.id));
  if (!done) return { id: c.id, status: "incomplete", reason: "no complete attempt" };
  const result = JSON.parse(await Deno.readTextFile(join(done.dir, "result.json")));
  const censusPath = join(done.dir, "census.jsonl");
  if (await fileSha256(censusPath) !== result.censusSha256) return { id: c.id, status: "incomplete", reason: "census file changed after completion" };
  const records: CensusLine[] = [];
  let lastHash = "";
  for await (const line of readJsonLines<CensusLine & { case: string; stateHash: string }>(censusPath)) {
    if (line.case !== c.id) return { id: c.id, status: "incomplete", reason: "census of another case" };
    records.push(line);
    lastHash = line.stateHash;
  }
  if (result.case !== c.id || result.attempt !== done.attempt || result.finalStateHash !== lastHash) return { id: c.id, status: "incomplete", reason: "result.json does not match its census" };
  return readCase(caseInfo(c), records, th, String(c.initialTotals.A));
}

/** The latest passing independent audit of this manifest; readouts bind to it by path and hash. */
async function requireAudit(root: string, name: string, manifestSha256: string): Promise<{ audit: Record<string, unknown>; auditPath: string; auditSha256: string }> {
  const found = await latestPassingAudit(root, name);
  if (!found) throw new Error(`no passing ${name} audit: run tools/construction-renewal-verify.ts ${name}`);
  if (found.audit.manifestSha256 !== manifestSha256) throw new Error(`the ${name} audit belongs to another manifest`);
  return { audit: found.audit, auditPath: relative(root, found.path), auditSha256: found.sha256 };
}

function auditDisagreements(readouts: CaseReadout[], audit: Record<string, unknown>): string[] {
  const cases = audit.cases as Record<string, { renew?: boolean; bothSitesPersist?: boolean; anySiteMaintained?: boolean; qualifyingSites?: number[]; maintainedSites?: number[] }>;
  const out: string[] = [];
  if (Object.keys(cases).length !== readouts.length) out.push(`audit has ${Object.keys(cases).length} cases, readout ${readouts.length}`);
  for (const r of readouts) {
    const a = cases[r.id];
    if (!a) {
      out.push(`${r.id}: absent from the audit`);
      continue;
    }
    if (r.status !== "complete") {
      out.push(`${r.id}: readout incomplete (${r.reason})`);
      continue;
    }
    if (r.renew !== undefined && r.renew !== a.renew) out.push(`${r.id}: RENEW ${r.renew} vs audit ${a.renew}`);
    if (r.qualifyingSites && JSON.stringify(r.qualifyingSites) !== JSON.stringify(a.qualifyingSites)) out.push(`${r.id}: qualifying sites differ`);
    if (r.bothSitesPersist !== undefined && r.bothSitesPersist !== a.bothSitesPersist) out.push(`${r.id}: control outcome differs`);
    if (r.anySiteMaintained !== undefined && r.anySiteMaintained !== a.anySiteMaintained) out.push(`${r.id}: probe outcome differs`);
    if (r.maintainedSites && JSON.stringify(r.maintainedSites) !== JSON.stringify(a.maintainedSites)) out.push(`${r.id}: maintained sites differ`);
  }
  return out;
}

/** Pilot readouts and selection recomputed from the case records. */
async function computePilot(root: string, cases: ManifestCase[], p: RenewalProtocol) {
  const th = thresholds(p);
  const all = [];
  for (const c of cases) all.push({ info: caseInfo(c), readout: await readCompletedCase(root, c, th) });
  const selection = selectHabitat(all, p.phases.confirmation.selectionOrder, p.phases.confirmation.eligibleSpreads, p.budget.pilotControlHistories);
  return { all, selection };
}

async function pilotReadout(root: string): Promise<void> {
  const { manifest, sha256 } = await readManifest(root);
  const { protocol: p } = await loadProtocol(moduleRoot(import.meta.url));
  const { audit, auditPath, auditSha256 } = await requireAudit(root, "pilot", sha256);
  const { all, selection } = await computePilot(root, manifest.cases, p);
  const disagreements = auditDisagreements(all.map((a) => a.readout), audit);
  const auditSel = audit.selection as { status: string; habitat?: unknown };
  if (JSON.stringify({ status: selection.status, habitat: "habitat" in selection ? selection.habitat : undefined }) !== JSON.stringify({ status: auditSel.status, habitat: auditSel.habitat })) {
    disagreements.push(`selection ${JSON.stringify(selection)} vs audit ${JSON.stringify(auditSel)}`);
  }
  if (disagreements.length) throw new Error(`readout and independent audit disagree: ${disagreements.join("; ")}`);
  await Deno.mkdir(join(root, "readout"), { recursive: true });
  const digest = await writeJsonOnce(join(root, "readout", "pilot-readout.json"), {
    readoutVersion: RENEWAL_READOUT_VERSION,
    manifestSha256: sha256,
    auditPath,
    auditSha256,
    createdAt: new Date().toISOString(),
    selection,
    cases: all.map((a) => a.readout),
  });
  console.log(json({ pilotReadoutSha256: digest, selection }));
}

async function confirmationFreeze(root: string): Promise<void> {
  const { manifest, sha256 } = await readManifest(root);
  const { protocol: p, inputs } = await loadProtocol(moduleRoot(import.meta.url));
  const { readout, sha256: readoutSha256 } = await verifiedPilotReadout(root, sha256);
  // Recompute the selection from the case records before opening any confirmation trajectory.
  const { selection } = await computePilot(root, manifest.cases, p);
  if (JSON.stringify(selection) !== JSON.stringify(readout.selection)) throw new Error("the recorded pilot selection differs from the case records");
  if (selection.status !== "selected") throw new Error(`no habitat qualifies (${selection.status}); the study closes without confirmation`);
  await Deno.mkdir(join(root, "confirmation")); // exclusive
  const specs = enumerateConfirmationCases(p, selection.habitat);
  const cases = await writeInitialStates(root, p, inputs, specs);
  const freezeSha256 = await writeJsonOnce(join(root, "confirmation", "freeze.json"), {
    frozenAt: new Date().toISOString(),
    manifestSha256: sha256,
    pilotReadoutSha256: readoutSha256,
    pilotAuditPath: readout.auditPath,
    pilotAuditSha256: readout.auditSha256,
    habitat: selection.habitat,
    cases,
    stepsExecuted: 0,
  });
  await writeJsonOnce(join(root, "confirmation", "FROZEN.json"), { freezeSha256, pilotReadoutSha256: readoutSha256 });
  await confirmationCases(root, p, inputs, sha256); // the chain must verify before anything runs
  console.log(json({ confirmationFreezeSha256: freezeSha256, habitat: selection.habitat, cases: cases.length }));
}

async function finalReadout(root: string): Promise<void> {
  const { sha256 } = await readManifest(root);
  const { protocol: p, inputs } = await loadProtocol(moduleRoot(import.meta.url));
  const th = thresholds(p);
  const cases = await confirmationCases(root, p, inputs, sha256);
  if (!cases.length) throw new Error("no confirmation was frozen");
  const { audit, auditPath, auditSha256 } = await requireAudit(root, "final", sha256);
  if (audit.confirmationFreezeSha256 !== await fileSha256(join(root, "confirmation", "freeze.json"))) throw new Error("the final audit is not bound to this confirmation freeze");
  const rows = [];
  for (const c of cases) rows.push({ arm: c.arm, seed: c.seed, readout: await readCompletedCase(root, c, th) });
  const disagreements = auditDisagreements(rows.map((r) => r.readout), audit);
  const decision = confirmationDecision(rows, p.phases.confirmation.arms, p.seeds.confirmation, p.phases.confirmation.blocksRequired);
  const ad = audit.decision as Record<string, unknown>;
  if (decision.status !== ad.status || (decision.status === "complete" && (decision.confirmed !== ad.confirmed || decision.constructionSpecific !== ad.constructionSpecific || JSON.stringify(decision.matrix) !== JSON.stringify(ad.matrix)))) {
    disagreements.push(`decision ${JSON.stringify(decision)} vs audit ${JSON.stringify(ad)}`);
  }
  if (disagreements.length) throw new Error(`readout and independent audit disagree: ${disagreements.join("; ")}`);
  const digest = await writeJsonOnce(join(root, "readout", "final-readout.json"), {
    readoutVersion: RENEWAL_READOUT_VERSION,
    manifestSha256: sha256,
    auditPath,
    auditSha256,
    createdAt: new Date().toISOString(),
    decision,
    cases: rows.map((r) => r.readout),
  });
  console.log(json({ finalReadoutSha256: digest, decision }));
}

/**
 * Publication rule for one case. "absent": no complete attempt, nothing to
 * publish. "unaudited": a complete attempt no bound audit covers yet (a
 * confirmation case before the final readout); nothing of it is published.
 * "audited": the bound audit recorded exactly this attempt and result.json.
 * Any other complete attempt is refused.
 */
export function publicationOf(
  id: string,
  done: { attempt: number; resultSha256: string } | null,
  auditCases: Record<string, { attempt?: number; resultSha256?: string }> | null,
): "absent" | "unaudited" | "audited" {
  if (!done) return "absent";
  if (!auditCases) return "unaudited";
  const a = auditCases[id];
  if (!a || a.attempt !== done.attempt || a.resultSha256 !== done.resultSha256) throw new Error(`${id}: result.json is not the one the bound audit recorded`);
  return "audited";
}

/**
 * The final readout, verified before anything publishes it: bound to this
 * manifest, to a passing final audit of this confirmation freeze, equal to that
 * audit's decision, and equal to the decision recomputed from the case records.
 */
async function verifiedFinalReadout(root: string, manifestSha256: string, p: RenewalProtocol, conf: ManifestCase[]) {
  const path = join(root, "readout", "final-readout.json");
  if (!(await exists(path))) return null;
  const r = JSON.parse(await Deno.readTextFile(path));
  if (r.manifestSha256 !== manifestSha256) throw new Error("final readout belongs to another manifest");
  if (typeof r.auditPath !== "string" || r.auditPath.includes("..")) throw new Error("final readout audit path");
  const auditPath = join(root, r.auditPath);
  if (await fileSha256(auditPath) !== r.auditSha256) throw new Error("final audit changed after the readout");
  const audit = JSON.parse(await Deno.readTextFile(auditPath));
  if (audit.status !== "pass" || audit.manifestSha256 !== manifestSha256) throw new Error("final readout is not bound to a passing audit of this manifest");
  if (audit.confirmationFreezeSha256 !== await fileSha256(join(root, "confirmation", "freeze.json"))) throw new Error("final audit is not bound to this confirmation freeze");
  const pick = (d: Record<string, unknown>) => JSON.stringify({ s: d.status, c: d.confirmed, x: d.constructionSpecific, m: d.matrix });
  if (pick(r.decision) !== pick(audit.decision)) throw new Error("final readout and its audit decide differently");
  const th = thresholds(p);
  const rows = [];
  for (const c of conf) rows.push({ arm: c.arm, seed: c.seed, readout: await readCompletedCase(root, c, th) });
  const decision = confirmationDecision(rows, p.phases.confirmation.arms, p.seeds.confirmation, p.phases.confirmation.blocksRequired);
  if (JSON.stringify(decision) !== JSON.stringify(r.decision)) throw new Error("final readout differs from the decision recomputed from the case records");
  if (JSON.stringify(rows.map((x) => x.readout)) !== JSON.stringify(r.cases)) throw new Error("final readout's case results differ from those recomputed from the case records");
  return { readout: r, sha256: await fileSha256(path) };
}

const LIMITATIONS = [
  "Finite-horizon local renewal only: not autonomous offspring, evolution, indefinite persistence or antifragility.",
  "Maintenance is sampled at censuses every 100 steps; no claim of survival between censuses, independence from dissolved resources supplied by the source, or autonomy from gross B exchanges.",
  "Q and reaction balance exclude static or purely imported deposits; they do not prove atom-by-atom material ancestry.",
  "All genomes are fixed (mutRate 0): this is not a heritable-selection endpoint.",
  "The reservoir changes available matter; different A levels are not an equal-resource comparison. Within an A/spread cell, arms share resources and light.",
  "Capacity and division controls apply only to spread 0 and their layouts; two small-founder sizes do not locate a viability threshold.",
  "The selected habitat is the first eligible one in a frozen order, not an optimum; arms sharing a seed are a paired block, not independent histories.",
  "Native GPU replays check state hash, ledgers, flux and last-step roles at censuses; they do not reconstruct the CPU observer's per-step history.",
  "This study's data are separate from the earlier nutrient-free construction runs.",
];

const GEN_BEGIN = "<!-- GENERATED:BEGIN (tools/construction-renewal.ts report; do not edit inside) -->";
const GEN_END = "<!-- GENERATED:END -->";

/** Compact tracked results, RESULTS.md's generated section and the figure, from verified readouts only. */
export async function report(root: string, outDir: string, loaded?: { protocol: RenewalProtocol; inputs: RenewalInputs }): Promise<void> {
  const { manifest, sha256 } = await readManifest(root);
  const { protocol: p, inputs } = loaded ?? await loadProtocol(moduleRoot(import.meta.url));
  const { readout: pilot, sha256: pilotSha256 } = await verifiedPilotReadout(root, sha256);
  // Publish nothing a reader could not recompute: stored case results and selection must equal the case records'.
  const recomputed = await computePilot(root, manifest.cases, p);
  if (JSON.stringify(recomputed.all.map((a) => a.readout)) !== JSON.stringify(pilot.cases) || JSON.stringify(recomputed.selection) !== JSON.stringify(pilot.selection)) {
    throw new Error("pilot readout's case results or selection differ from those recomputed from the case records");
  }
  const conf = await confirmationCases(root, p, inputs, sha256);
  const verifiedFinal = conf.length ? await verifiedFinalReadout(root, sha256, p, conf) : null;
  const final = verifiedFinal?.readout ?? null;
  let confirmation: Record<string, unknown>;
  if (pilot.selection.status === "none-eligible") confirmation = { status: "absent: not earned (no pilot habitat qualified)" };
  else if (pilot.selection.status !== "selected") confirmation = { status: "absent: the pilot selection is incomplete", reason: pilot.selection.reason };
  else if (!conf.length) confirmation = { status: "earned, not yet frozen", habitat: pilot.selection.habitat };
  else if (!final) {
    let complete = 0;
    for (const c of conf) if (await completeAttempt(join(root, "cases", c.id))) complete++;
    confirmation = { status: "incomplete", habitat: pilot.selection.habitat, casesComplete: complete, cases: conf.length };
  } else confirmation = { status: "complete", habitat: pilot.selection.habitat, finalReadoutSha256: verifiedFinal!.sha256, auditPath: final.auditPath, auditSha256: final.auditSha256, decision: final.decision };
  const allCases = [...manifest.cases, ...conf];
  const readouts = [...pilot.cases, ...(final?.cases ?? [])];
  const results = [];
  const series: { id: string; steps: number[]; B: number[]; Q: number[]; R: number[]; imp: number[]; fieldB: number[] }[] = [];
  // Every published result.json must be the one the bound audit recorded, byte for byte.
  const pilotAuditCases = JSON.parse(await Deno.readTextFile(join(root, pilot.auditPath))).cases ?? {};
  const finalAuditCases = final ? JSON.parse(await Deno.readTextFile(join(root, final.auditPath))).cases ?? {} : {};
  for (const c of allCases) {
    const done = await completeAttempt(join(root, "cases", c.id));
    const auditCases = c.phase === "confirmation" ? (final ? finalAuditCases : null) : pilotAuditCases;
    const publish = publicationOf(c.id, done ? { attempt: done.attempt, resultSha256: await fileSha256(join(done.dir, "result.json")) } : null, auditCases);
    if (publish === "unaudited") {
      results.push({ id: c.id, phase: c.phase, kind: c.kind, arm: c.arm, seed: c.seed, reservoir: c.reservoir, spread: c.spread, horizon: c.horizon, status: "run, not yet audited: metadata and results withheld until the final audit" });
      continue;
    }
    const result = publish === "audited" ? JSON.parse(await Deno.readTextFile(join(done!.dir, "result.json"))) : null;
    const readout = readouts.find((r: { id: string }) => r.id === c.id) ?? null;
    let last: (CensusLine & { heatOut: string; lightExposure: string; totals: Record<string, string> }) | null = null;
    const s = c.sourceSites[0];
    const row = { id: c.id, steps: [] as number[], B: [] as number[], Q: [] as number[], R: [] as number[], imp: [] as number[], fieldB: [] as number[] };
    if (done) {
      for await (const line of readJsonLines<CensusLine & { heatOut: string; lightExposure: string; totals: Record<string, string> }>(join(done.dir, "census.jsonl"))) {
        last = line;
        if (c.kind !== "main") continue;
        row.steps.push(line.step);
        row.B.push(line.cells.B[s]);
        row.Q.push(line.cumulative.photo[s] + line.cumulative.grow[s]);
        row.R.push(line.cumulative.reactB[s]);
        row.imp.push(line.cumulative.boundBIn[s] - line.cumulative.boundBOut[s]);
        row.fieldB.push(line.cells.B.reduce((a, v, i) => a + (i === s ? 0 : v), 0));
      }
      if (c.kind === "main") series.push(row);
    }
    results.push({
      id: c.id, phase: c.phase, kind: c.kind, arm: c.arm, seed: c.seed, reservoir: c.reservoir, spread: c.spread, horizon: c.horizon,
      attempt: result?.attempt ?? null, finalStateHash: result?.finalStateHash ?? null, censusSha256: result?.censusSha256 ?? null,
      elapsedMs: result?.elapsedMs ?? null, artifactBytes: result?.artifactBytes ?? null,
      accounting: last
        ? { initialTotals: c.initialTotals, finalTotals: last.totals, offeredLightExposure: last.lightExposure, harvestedLight: last.lightIn, heatExport: last.heatOut, flux: last.flux }
        : null,
      readout,
    });
  }
  const summary = {
    study: "construction-renewal-v1",
    manifestSha256: sha256,
    frozen: JSON.parse(await Deno.readTextFile(join(root, "FROZEN.json"))),
    plan: p.plan,
    inputs: p.inputs,
    pilotReadoutSha256: pilotSha256,
    pilotAudit: { path: pilot.auditPath, sha256: pilot.auditSha256 },
    selection: pilot.selection,
    confirmation,
    limitations: LIMITATIONS,
    cases: results,
  };
  await Deno.mkdir(outDir, { recursive: true });
  await Deno.writeTextFile(join(outDir, "results.json"), json(summary));
  await Deno.writeTextFile(join(outDir, "renewal-v1.svg"), renderFigure(series));
  const md = resultsMarkdown(summary, results);
  const mdPath = join(outDir, "RESULTS.md");
  const existing = (await exists(mdPath)) ? await Deno.readTextFile(mdPath) : `# Renewal v1: results\n\n${GEN_BEGIN}\n${GEN_END}\n`;
  const i = existing.indexOf(GEN_BEGIN), j = existing.indexOf(GEN_END);
  if (i < 0 || j < i) throw new Error("RESULTS.md lacks its generated-section markers");
  await Deno.writeTextFile(mdPath, existing.slice(0, i) + GEN_BEGIN + "\n" + md + GEN_END + existing.slice(j + GEN_END.length));
  console.log(json({ wrote: [join(outDir, "results.json"), join(outDir, "renewal-v1.svg"), mdPath] }));
}

// deno-lint-ignore no-explicit-any
function resultsMarkdown(summary: any, results: any[]): string {
  const out: string[] = [];
  out.push(`Manifest \`${summary.manifestSha256}\`; protocol \`${summary.frozen.protocolSha256}\`; plan \`${summary.plan.sha256}\`; source digest \`${summary.frozen.sourceDigest}\`.`);
  out.push(`Inputs: witness \`${summary.inputs.witness.sha256}\`, selected competitor \`${summary.inputs.selected.sha256}\`. Pilot readout \`${summary.pilotReadoutSha256}\`, pilot audit \`${summary.pilotAudit.sha256}\`.`, "");
  out.push(`**Selection:** ${summary.selection.status}${summary.selection.habitat ? ` (A${summary.selection.habitat.reservoir}, spread ${summary.selection.habitat.spread})` : ""}. **Confirmation:** ${summary.confirmation.status}.`, "");
  out.push("| Case | Outcome | Extinct | Final B | Source B (final / late min) | Qualifying sites | BUILD B | Harvested light | Heat export | A depletion |", "|---|---|---|---:|---|---:|---:|---:|---:|---:|");
  for (const r of results) {
    const o = r.readout;
    if (!o || o.status !== "complete") {
      out.push(`| ${r.id} | ${o ? `incomplete: ${o.reason}` : r.status ?? "not run"} | | | | | | | | |`);
      continue;
    }
    const outcome = o.renew !== undefined ? `RENEW ${o.renew}` : o.bothSitesPersist !== undefined ? `both sites persist ${o.bothSitesPersist}` : `a site maintained ${o.anySiteMaintained}`;
    const sites = o.qualifyingSites ?? o.maintainedSites ?? [];
    const sec = o.secondary;
    out.push(`| ${r.id} | ${outcome} | ${o.extinct} | ${sec.finalActiveB} | ${sec.finalSourceB.join(", ")} / ${sec.lateMinSourceB.join(", ")} | ${sites.length} | ${sec.buildExpenditureB} | ${sec.harvestedLight} | ${r.accounting?.heatExport ?? ""} | ${sec.reservoirDepletionA} |`);
  }
  const d = summary.confirmation.decision;
  if (d && d.status === "complete") {
    out.push("", "Confirmation matrix (RENEW by arm and block):", "", `| Arm | ${Object.keys(d.matrix.builder).join(" | ")} | Count |`, `|---|${Object.keys(d.matrix.builder).map(() => "---").join("|")}|---:|`);
    for (const [arm, row] of Object.entries(d.matrix as Record<string, Record<string, boolean>>)) out.push(`| ${arm} | ${Object.values(row).join(" | ")} | ${d.counts[arm]} |`);
    out.push("", `Confirmed local renewal: ${d.confirmed}. Construction-specific: ${d.constructionSpecific}.`);
  }
  out.push("", "Offered light is grid light-level exposure (sum of L over cells and executed steps): 2,611,200,000 units for 10,000 steps. Harvested light is the energy fixed by photosynthesis, an outcome.", "", "Limitations:", "", ...summary.limitations.map((l: string) => `- ${l}`), "");
  return out.join("\n");
}

/** Read-only: verifies the frozen tree and reports which cases are complete. */
async function status(root: string): Promise<void> {
  const { manifest, sha256 } = await readManifest(root);
  const { protocol: p, inputs } = await loadProtocol(moduleRoot(import.meta.url));
  const all = [...manifest.cases, ...(await confirmationCases(root, p, inputs, sha256))];
  const rows = [];
  for (const c of all) {
    const attempts = await listAttempts(join(root, "cases", c.id));
    rows.push({ case: c.id, attempts: attempts.length, complete: attempts.some((a) => a.complete) });
  }
  console.log(json({
    root,
    runningFrom: moduleRoot(import.meta.url),
    manifestSha256: sha256,
    cases: all.length,
    complete: rows.filter((r) => r.complete).length,
    withAttempts: rows.filter((r) => r.attempts > 0).length,
  }));
}

function arg(name: string): string {
  const i = Deno.args.indexOf(name);
  if (i < 0 || !Deno.args[i + 1]) throw new Error(`missing ${name}`);
  return Deno.args[i + 1];
}

if (import.meta.main) {
  const op = Deno.args[0];
  if (op === "freeze") {
    await freeze(arg("--out"));
  } else {
    const root = absoluteRoot(arg("--root"));
    // Paths are made absolute here: the frozen copy runs with its source tree as working directory.
    const rest = Deno.args.slice(1).map((a, i, all) => (all[i - 1] === "--root" || all[i - 1] === "--out" ? absoluteRoot(a) : a));
    await runFromSnapshot(import.meta.url, ENTRY, root, [op, ...rest]);
    await checkModuleIdentity(join(root, "source"), [
      [RefSim, "packages/sim-ref/src/index.ts", "RefSim"],
      [stateHash, "packages/schema/src/index.ts", "stateHash"],
      [encodeCheckpoint, "packages/schema/src/index.ts", "encodeCheckpoint"],
      [ledgerResidual, "packages/schema/src/index.ts", "ledgerResidual"],
      [RenewalObserver, "tools/lib/construction-renewal-observer.ts", "RenewalObserver"],
      [readCase, "tools/lib/construction-renewal-readout.ts", "readCase"],
      [initialState, "tools/lib/construction-renewal.ts", "initialState"],
      ...OBSERVER_BINDINGS,
      ...RENEWAL_LIB_BINDINGS,
    ]);
    if (op === "freeze-init") await freezeInit(root);
    else if (op === "status") await status(root);
    else if (op === "controls" || op === "pilot" || op === "confirmation") await runPhase(root, op);
    else if (op === "pilot-readout") await pilotReadout(root);
    else if (op === "confirmation-freeze") await confirmationFreeze(root);
    else if (op === "final-readout") await finalReadout(root);
    else if (op === "report") await report(root, absoluteRoot(arg("--out")));
    else throw new Error(`unknown operation ${op}`);
  }
}
