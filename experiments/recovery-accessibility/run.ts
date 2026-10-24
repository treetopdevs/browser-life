import { seedInventory } from "./seeds.ts";
// Local, single-lane diagnostic. Commands: prepare|calibrate|first32|extend|read OUT.
// Protocol gates, seeds and subjects are fixed in protocol.ts; no scientific overrides.
import { canonicalObserverJSON, decodeCheckpoint, encodeCheckpoint, stateHash, totalsOf, ledgerResidual, type WorldState } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { evaluateBatch } from "@bl/search";
import { RecoveryObserver, OBSERVER_VERSION } from "./observer.ts";
import { PROTOCOL, ENGINEERING_SEEDS, SCIENCE_SEEDS, evalConfig, worldConfig, subjects, genomeHex, summarize, validateCase, initialState, type CaseResult, type Pair } from "./protocol.ts";

const [command, out] = Deno.args;
if (!out || !["prepare", "calibrate", "first32", "extend", "read"].includes(command)) throw new Error("usage: deno run -A experiments/recovery-accessibility/run.ts prepare|calibrate|first32|extend|read OUT");
const ROOT = Deno.cwd();
const MAX_BYTES = 2 * 1024 ** 3, MAX_MS = 60 * 60 * 1000;
const enc = new TextEncoder();
const sha = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>)), x => x.toString(16).padStart(2, "0")).join("");
const stable = canonicalObserverJSON;
const digest = async (o: unknown) => sha(enc.encode(stable(o)));
const readJSON = async (p: string) => JSON.parse(await Deno.readTextFile(p));
const exists = async (p: string) => { try { await Deno.stat(p); return true; } catch (e) { if (e instanceof Deno.errors.NotFound) return false; throw e; } };
async function bytes(path: string): Promise<number> {
  let total = 0;
  for await (const e of Deno.readDir(path)) {
    if (e.isSymlink) throw new Error("symlink in output tree");
    total += e.isDirectory ? await bytes(`${path}/${e.name}`) : (await Deno.stat(`${path}/${e.name}`)).size;
  }
  return total;
}
async function write(p: string, b: Uint8Array) {
  if (await bytes(out) + b.length > MAX_BYTES) throw new Error("CAP: storage budget exhausted");
  await Deno.writeFile(`${p}.tmp`, b);
  await Deno.rename(`${p}.tmp`, p);
}
const writeJSON = async (p: string, value: unknown) => write(p, enc.encode(JSON.stringify(value, null, 2) + "\n"));
async function git(args: string[]) {
  const r = await new Deno.Command("git", { args, stdout: "piped", stderr: "piped" }).output();
  if (!r.success) throw new Error(new TextDecoder().decode(r.stderr));
  return new TextDecoder().decode(r.stdout);
}
async function sources() {
  const names = [...new Set((await git(["ls-files", "-c", "-o", "--exclude-standard", "-z"])).split("\0").filter(Boolean))].sort();
  const files = [];
  for (const path of names) files.push({ path, sha256: await sha(await Deno.readFile(path)) });
  return files;
}
const genomes = subjects();
const genomeIds = Object.fromEntries(Object.entries(genomes).map(([k, g]) => [k, genomeHex(g)]));
const protocolPath = "docs/recovery-accessibility-2026-10-24/PLAN.md";
const runtimeFile = (path: string) => /\.(?:ts|json|lock)$/.test(path) || path === protocolPath || path.endsWith("AGENTS.md");

if (command === "prepare") {
  if (await exists(out)) throw new Error("output already exists; preserve the existing campaign");
  if (!out.startsWith("runs/recovery-accessibility/")) throw new Error("use a new runs/recovery-accessibility/ directory");
  const audit = await readJSON("docs/recovery-accessibility-2026-10-24/audit.json");
  if (audit.selected.mutant_hex !== genomeIds.mutant) throw new Error("candidate genome differs from retrospective audit");
  const seedAudit = await seedInventory([...ENGINEERING_SEEDS, ...SCIENCE_SEEDS]);
  const source = await sources();
  // Reserve seeds before launch. The campaign record also documents a targeted prior-art seed search.
  const manifest = { protocol: PROTOCOL, observer: OBSERVER_VERSION, preparedAt: new Date().toISOString(),
    head: (await git(["rev-parse", "HEAD"])).trim(), source, sourceHash: await digest(source),
    patch: await git(["diff", "HEAD", "--"]), planHash: await sha(await Deno.readFile(protocolPath)),
    seedAudit, engineeringSeeds: ENGINEERING_SEEDS, scienceSeeds: SCIENCE_SEEDS, genomes: genomeIds,
    configs: { engineering: ENGINEERING_SEEDS.map(worldConfig), science: SCIENCE_SEEDS.map(worldConfig) },
    interval: "Bonferroni-Hoeffding paired difference; descriptive only", maxMs: MAX_MS, maxBytes: MAX_BYTES,
    command: "calibrate, first32, conditional extend; one local GPU lane; no cloud" };
  await Deno.mkdir(out, { recursive: true });
  await writeJSON(`${out}/manifest.json`, manifest);
  await writeJSON(`${out}/manifest-digest.json`, { sha256: await digest(manifest) });
  await writeJSON(`${out}/budget.json`, { spentMs: 0, active: null });
  console.log(`prepared ${out} ${await digest(manifest)}`);
  Deno.exit(0);
}
const manifest = await readJSON(`${out}/manifest.json`);
const manifestHash = (await readJSON(`${out}/manifest-digest.json`)).sha256;
if (await digest(manifest) !== manifestHash || manifest.protocol !== PROTOCOL || manifest.observer !== OBSERVER_VERSION || stable(manifest.genomes) !== stable(genomeIds)
  || stable(manifest.engineeringSeeds) !== stable(ENGINEERING_SEEDS) || stable(manifest.scienceSeeds) !== stable(SCIENCE_SEEDS)) throw new Error("manifest mismatch");
{
  const now = (await sources()).filter(f => runtimeFile(f.path));
  if (stable(now) !== stable(manifest.source.filter((f: { path: string }) => runtimeFile(f.path)))) throw new Error("source changed after freeze; preserve results and start a new version");
}
async function caseRead(id: string, seed: number, subject: CaseResult["subject"]): Promise<CaseResult> {
  const folder = `${out}/cases/${id}`;
  const c: CaseResult = await readJSON(`${folder}/case.json`);
  if ((await readJSON(`${folder}/digest.json`)).sha256 !== await digest(c)) throw new Error(`case checksum mismatch: ${id}`);
  validateCase(c, { id, manifestHash, seed, subject, genome: genomeIds[subject] });
  if (c.artifacts.length !== 7 || new Set(c.artifacts.map(a => a.path)).size !== 7) throw new Error("checkpoint set incomplete");
  const expectedInitial = initialState(seed, genomes[subject]);
  const initialTotals = totalsOf(expectedInitial.cfg, expectedInitial.cells);
  const seen = new Set<string>();
  for (const a of c.artifacts) {
    if (!/^(initial|grown|tile-lesion-end|regen-start|regen-end|dark-end|light-end)\.blck$/.test(a.path)) throw new Error("unexpected artifact path");
    const b = await Deno.readFile(`${folder}/${a.path}`);
    if (b.length !== a.bytes || await sha(b) !== a.sha256) throw new Error(`artifact mismatch: ${id}/${a.path}`);
    const state = decodeCheckpoint(b).state;
    const phase = a.path.slice(0, -5);
    const expectedCfg = phase === "dark-end" ? { ...worldConfig(seed), lightBase: 0, lightAmp: 0, seasonAmp: 0 } : worldConfig(seed);
    if (stable(state.cfg) !== stable(expectedCfg) || state.step !== (phase === "initial" ? 0 : phase === "grown" || phase === "regen-start" ? 3000 : 5000)) throw new Error("checkpoint config/seed/step mismatch");
    if (phase === "initial" && stateHash(state) !== stateHash(expectedInitial)) throw new Error("initial genome/template mismatch");
    const totals = totalsOf(state.cfg, state.cells);
    if (totals.matter !== initialTotals.matter || ledgerResidual(initialTotals, state) !== 0n) throw new Error("checkpoint ledger mismatch");
    if (stateHash(state) !== c.observation.states[phase].hash) throw new Error("checkpoint/state hash mismatch");
    seen.add(phase);
  }
  if (seen.size !== 7) throw new Error("missing state");
  return c;
}
async function pairsRead(n: number): Promise<Pair[]> {
  const pairs: Pair[] = [];
  for (const seed of SCIENCE_SEEDS.slice(0, n)) pairs.push({ seed,
    parent: await caseRead(`science-parent-${seed}`, seed, "parent"), mutant: await caseRead(`science-mutant-${seed}`, seed, "mutant") });
  return pairs;
}
function identityFree(c: CaseResult) {
  return { evaluation: c.evaluation, observation: c.observation, genome: c.genome, config: c.config,
    artifacts: c.artifacts };
}
async function requireCalibration() {
  const saved = await readJSON(`${out}/calibration.json`);
  if (saved.manifestHash !== manifestHash || saved.status !== "CALIBRATION-PASS") throw new Error("calibration has not passed");
  const controls = [];
  for (const seed of ENGINEERING_SEEDS) for (const subject of ["parent", "generalist"] as const) controls.push(await caseRead(`cal-${subject}-${seed}`, seed, subject));
  const parent = controls.filter(c => c.subject === "parent").reduce((n, c) => n + c.evaluation.regenerated, 0);
  const generalist = controls.filter(c => c.subject === "generalist").reduce((n, c) => n + c.evaluation.regenerated, 0);
  if (parent < 3 || generalist > 1) throw new Error("calibration counts fail");
  for (const seed of ENGINEERING_SEEDS.slice(0, 2)) {
    const replay = await caseRead(`cal-replay-parent-${seed}`, seed, "parent");
    const original = controls.find(c => c.seed === seed && c.subject === "parent")!;
    if (stable(identityFree(replay)) !== stable(identityFree(original))) throw new Error("calibration replay mismatch");
  }
}
async function finish(n: number) {
  await requireCalibration();
  const pairs = await pairsRead(n);
  for (const seed of [SCIENCE_SEEDS[0], SCIENCE_SEEDS[31]]) for (const subject of ["parent", "mutant"] as const) {
    const replay = await caseRead(`replay-${subject}-${seed}`, seed, subject);
    const original = pairs.find(p => p.seed === seed)![subject];
    if (stable(identityFree(replay)) !== stable(identityFree(original))) throw new Error("scientific replay mismatch");
  }
  if (n === 128 && summarize(pairs.slice(0, 32), SCIENCE_SEEDS.slice(0, 32), "first32").status !== "EXTEND-TO-128") throw new Error("extension was not earned");
  const result = summarize(pairs, SCIENCE_SEEDS.slice(0, n), n === 32 ? "first32" : "final128");
  await writeJSON(`${out}/summary-${n}.json`, { manifestHash, ...result });
  await write(`${out}/cases-${n}.jsonl`, enc.encode(pairs.flatMap(p => [p.parent, p.mutant]).map(c => JSON.stringify({ id: c.id, seed: c.seed, subject: c.subject,
    R: c.observation.R, R_clean: c.observation.R_clean, reason: c.observation.reason, survived: c.evaluation.survived, lightDependent: c.evaluation.lightDependent,
    targetMass: c.observation.target?.mass ?? 0, removedMass: c.observation.removedMass })).join("\n") + "\n"));
  await write(`${out}/readout.md`, enc.encode(`# Recovery accessibility\n\nStatus: **${result.status}**. ${n} matched pairs; one mutation.\n\n| Measure | Parent | Mutant |\n|---|---:|---:|\n| Legacy regeneration | ${result.parent.R}/${n} | ${result.mutant.R}/${n} |\n| Clean recovery | ${result.parent.clean}/${n} | ${result.mutant.clean}/${n} |\n| Survival | ${result.parent.survived}/${n} | ${result.mutant.survived}/${n} |\n| Light dependence | ${result.parent.light}/${n} | ${result.mutant.light}/${n} |\n\nGates: ${JSON.stringify(result.gates)}.\n\nNo evidence here establishes autonomous reproduction or general impossibility of improvement.\n`));
  console.log(JSON.stringify(result, null, 2));
}
if (command === "read") {
  if (await exists(`${out}/summary-128.json`)) await finish(128);
  else if (await exists(`${out}/cases/science-parent-${SCIENCE_SEEDS[0]}/case.json`)) await finish(32);
  else console.log(await readJSON(`${out}/calibration.json`));
  Deno.exit(0);
}
if (command === "calibrate" && await exists(`${out}/cases`)) throw new Error("calibration already attempted; preserve its stop/result and use read");
const budget = await readJSON(`${out}/budget.json`);
if (budget.active !== null) throw new Error("interrupted active attempt; inspect retained evidence before any retry");
if (budget.spentMs >= MAX_MS) throw new Error("CAP: time budget exhausted");
const began = Date.now();
budget.active = began;
await writeJSON(`${out}/budget.json`, budget);
const timer = setTimeout(() => { console.error("CAP: execution time exhausted; active attempt retained"); Deno.exit(2); }, MAX_MS - budget.spentMs);
let device: GPUDevice | undefined;
try {
  device = await requestDevice(navigator.gpu, worldConfig(ENGINEERING_SEEDS[0]));
  let deviceError: string | undefined;
  device.addEventListener("uncapturederror", e => { deviceError = (e as GPUUncapturedErrorEvent).error.message; });
  device.lost.then(info => { if (info.reason !== "destroyed") deviceError = info.message; });
  const adapterInfo = device.adapterInfo;
  await writeJSON(`${out}/device-${command}.json`, { vendor: adapterInfo.vendor, architecture: adapterInfo.architecture, device: adapterInfo.device, description: adapterInfo.description, deno: Deno.version, host: Deno.hostname() });
  const costs: number[] = [];
  const sizes: number[] = [];
  async function runCase(id: string, seed: number, subject: CaseResult["subject"]) {
    if (await exists(`${out}/cases/${id}/case.json`)) return await caseRead(id, seed, subject);
    const folder = `${out}/cases/${id}`;
    if (await exists(folder)) throw new Error(`partial attempt retained: ${id}`);
    await Deno.mkdir(folder, { recursive: true });
    const t0 = Date.now();
    await writeJSON(`${folder}/attempt.json`, { id, seed, subject, manifestHash, beganAt: new Date().toISOString() });
    const artifacts: CaseResult["artifacts"] = [];
    const observer = new RecoveryObserver(async (phase: string, state: WorldState) => {
      if (deviceError) throw new Error(`GPU: ${deviceError}`);
      const b = encodeCheckpoint(state);
      const path = `${phase}.blck`;
      await write(`${folder}/${path}`, b);
      artifacts.push({ path, bytes: b.length, sha256: await sha(b) });
    });
    try {
      const [evaluation] = await evaluateBatch(device!, [genomes[subject]], evalConfig(seed), e => observer.observe(e));
      const observation = observer.finish(evaluation);
      const c: CaseResult = { protocol: PROTOCOL, manifestHash, id, seed, subject, genome: genomeIds[subject], config: worldConfig(seed), evaluation, observation, artifacts };
      validateCase(c, { id, seed, subject, genome: genomeIds[subject], manifestHash });
      await writeJSON(`${folder}/case.json`, c);
      await writeJSON(`${folder}/digest.json`, { sha256: await digest(c) });
      await caseRead(id, seed, subject);
      costs.push(Date.now() - t0);
      sizes.push(await bytes(folder));
      console.log(`${id}: R=${Number(observation.R)} clean=${Number(observation.R_clean)} ${observation.reason} (${((Date.now()-t0)/1000).toFixed(1)}s)`);
      return c;
    } catch (e) {
      await writeJSON(`${folder}/failure.json`, { id, error: String(e), manifestHash });
      throw e;
    }
  }
  if (command === "calibrate") {
    const controls: CaseResult[] = [];
    for (const seed of ENGINEERING_SEEDS) for (const subject of ["parent", "generalist"] as const) controls.push(await runCase(`cal-${subject}-${seed}`, seed, subject));
    const parent = controls.filter(c => c.subject === "parent").reduce((n, c) => n + c.evaluation.regenerated, 0);
    const generalist = controls.filter(c => c.subject === "generalist").reduce((n, c) => n + c.evaluation.regenerated, 0);
    if (parent < 3 || generalist > 1) {
      await writeJSON(`${out}/calibration.json`, { manifestHash, status: "ASSAY-CALIBRATION-FAILED", parent, generalist });
      console.log(`ASSAY-CALIBRATION-FAILED parent=${parent}/4 generalist=${generalist}/4; scientific seeds not run`);
    } else {
      for (const seed of ENGINEERING_SEEDS.slice(0, 2)) {
        const replay = await runCase(`cal-replay-parent-${seed}`, seed, "parent");
        const original = controls.find(c => c.seed === seed && c.subject === "parent")!;
        if (stable(identityFree(replay)) !== stable(identityFree(original))) throw new Error("calibration replay mismatch");
      }
      const upperMs = Math.max(...costs), spent = budget.spentMs + Date.now() - began;
      const remainingCalls = 256 + 4;
      const projectedMs = spent + remainingCalls * upperMs;
      const projectedBytes = await bytes(out) + remainingCalls * Math.max(...sizes);
      const withinCaps = projectedMs <= MAX_MS && projectedBytes <= MAX_BYTES;
      await writeJSON(`${out}/calibration.json`, { manifestHash, status: withinCaps ? "CALIBRATION-PASS" : "CAP-PROJECTION-STOP", parent, generalist, costsMs: costs, upperMs, projectedMs, projectedBytes, upperBytes: Math.max(...sizes), bytes: await bytes(out) });
      console.log(withinCaps ? "CALIBRATION-PASS" : "CAP-PROJECTION-STOP");
    }
  } else {
    await requireCalibration();
    const start = command === "extend" ? 32 : 0, end = command === "extend" ? 128 : 32;
    if (start && summarize(await pairsRead(32), SCIENCE_SEEDS.slice(0, 32), "first32").status !== "EXTEND-TO-128") throw new Error("extension not earned");
    for (let i = start; i < end; i++) {
      const seed = SCIENCE_SEEDS[i];
      const order = i % 2 ? ["mutant", "parent"] as const : ["parent", "mutant"] as const;
      for (const subject of order) await runCase(`science-${subject}-${seed}`, seed, subject);
    }
    if (!start) for (const seed of [SCIENCE_SEEDS[0], SCIENCE_SEEDS[31]]) for (const subject of ["parent", "mutant"] as const) await runCase(`replay-${subject}-${seed}`, seed, subject);
    await finish(end);
  }
} finally {
  device?.destroy();
  clearTimeout(timer);
  budget.spentMs += Date.now() - began;
  budget.active = null;
  await writeJSON(`${out}/budget.json`, budget);
}
