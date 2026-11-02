/**
 * I08 collective sensing under moving light: controlled navigation benchmark, first rung. CPU only (sim-ref), Node 24 (relative imports
 * only; @bl/* is resolved by the hook below, as in tools/niche/niche.ts). At most two worker processes are ever started.
 *   node tools/movinglight/movinglight.ts --bench          step rate here and the projected regeneration time (informational)
 *   node tools/movinglight/movinglight.ts --calibrate      dev and replicate-noise seeds only: writes calibration.json (floors, sensitivity, cross-talk)
 *   node tools/movinglight/movinglight.ts --freeze         write protocol.lock.json BEFORE any fresh run (commit and push it first)
 *   node tools/movinglight/movinglight.ts --write          write evidence.json and manifest.json (once, deliberately; needs a matching lock)
 *   node tools/movinglight/movinglight.ts --check          validate the saved artifacts without simulating
 *   node tools/movinglight/movinglight.ts --replay-check   regenerate a frozen two-block subset and the cheap fixtures; require equality
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { arch, platform } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const writeAtomic = (path: string, text: string): void => {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
};

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const OUT_DIR = `${REPO}docs/moving-light-2026-11-02/`;
export const EVIDENCE = `${OUT_DIR}evidence.json`;
export const MANIFEST = `${OUT_DIR}manifest.json`;
export const CALIBRATION = `${OUT_DIR}calibration.json`;
export const LOCK = `${OUT_DIR}protocol.lock.json`;
export const REGISTRY = `${REPO}experiments/discovery/seed-registry.json`;
export const BASE_COMMIT = "c4b16ccd";
/** PLAN G1: regeneration (--write) under about ten minutes on a loaded machine; replay-check on a two-block subset under about two. */
export const WRITE_TARGET_SECONDS = 600;
export const REPLAY_TARGET_SECONDS = 120;
const SRC_DIR = "packages/runner/src/movinglight/";
const OWN_NAMESPACE = "i08 moving light";

let hooked = false;
function registerAliases(): void {
  if (hooked || process.env.VITEST) return;
  hooked = true;
  try {
    registerHooks({
      resolve(specifier, context, next) {
        const m = /^@bl\/(.+)$/.exec(specifier);
        return m ? next(pathToFileURL(`${REPO}packages/${m[1]}/src/index.ts`).href, context) : next(specifier, context);
      },
    });
  } catch { /* already running under a loader that resolves @bl/* (vitest) */ }
}

const lib = async () => {
  registerAliases();
  const [movinglight, schema] = await Promise.all([import("../../packages/runner/src/movinglight/index.ts"), import("../../packages/schema/src/index.ts")]);
  return { ...movinglight, schema };
};

export const serialize = (p: unknown): string => `${JSON.stringify(p, null, 1)}\n`;
export const sha256 = async (text: string | Uint8Array): Promise<string> => {
  const { schema } = await lib();
  return schema.sha256HexJS(typeof text === "string" ? new TextEncoder().encode(text) : text);
};
/** Reservation-scoped: only this slice's own reservations are hashed, so another slice reserving seeds does not change the protocol hash. The collision check against every other reservation stays global (checkSaved). */
export const registryDigest = async (root = REPO): Promise<string> => {
  const { schema } = await lib();
  const reservations = (JSON.parse(readFileSync(`${root}experiments/discovery/seed-registry.json`, "utf8")).reservations as { owner: string }[]).filter((r) => r.owner.startsWith(OWN_NAMESPACE));
  return sha256(schema.canonicalJSON(reservations));
};

/** Files whose bytes feed the evidence: the library, the simulator and schema it reads, and this tool. */
const SOURCE_DIRS = [SRC_DIR, "packages/schema/src/", "packages/sim-ref/src/"];
export function sourceFiles(root = REPO): string[] {
  const dirs = SOURCE_DIRS.flatMap((d) => readdirSync(`${root}${d}`).filter((f) => f.endsWith(".ts")).sort().map((f) => d + f));
  return [...dirs, "tools/movinglight/movinglight.ts"];
}

/** At most two child processes; each runs one block job (--job '<json>') and prints the BlockRecord as JSON. Results keep job order. */
export async function pool(specs: any[], workers = 2): Promise<any[]> {
  const results = new Array(specs.length);
  let next = 0;
  const script = fileURLToPath(import.meta.url);
  const runOne = (spec: any) =>
    new Promise<any>((resolve, reject) => {
      const child = spawn(process.execPath, ["--no-warnings", script, "--job", JSON.stringify(spec)], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, VITEST: "" } });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`job exited ${code}: ${JSON.stringify(spec)}`))));
    });
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= specs.length) return;
      results[i] = await runOne(specs[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, 2) }, lane));
  return results;
}

export async function sourceHashes(root = REPO): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of sourceFiles(root)) out[f] = await sha256(readFileSync(root + f));
  return out;
}

export async function makeManifest(payload: any, evidenceText: string, seconds: number): Promise<Record<string, unknown>> {
  const sources = await sourceHashes();
  return {
    kind: "movinglight-evidence-manifest",
    payloadFileSha256: await sha256(evidenceText),
    integritySha256: payload.integritySha256,
    protocolHash: payload.protocolHash,
    registryDigest: payload.registryDigest,
    workload: payload.workload,
    sources,
    provenance: { note: "not replayed; excluded from the deterministic payload", baseCommit: BASE_COMMIT, node: process.version, platform: `${platform()}-${arch()}`, regenerationSeconds: Math.round(seconds), generatedAt: new Date().toISOString() },
  };
}

/** --write needs a lock (written before any fresh run) and refuses to overwrite; returns nothing or throws. */
export function writeGuard(paths: { lock: string; evidence: string }, force: boolean): void {
  if (existsSync(paths.evidence) && !force) throw new Error("evidence.json exists; files are written once. Pass --force to rewrite deliberately.");
  if (!existsSync(paths.lock)) throw new Error("no protocol.lock.json: run --calibrate and --freeze before the fresh run");
}

export const loadCalibration = (path = CALIBRATION): any => JSON.parse(readFileSync(path, "utf8"));

/** Validate saved artifacts without simulating. Returns problems (empty when sound). */
export async function checkSaved(paths = { evidence: EVIDENCE, manifest: MANIFEST, calibration: CALIBRATION, lock: LOCK }, root = REPO): Promise<string[]> {
  const L = await lib();
  const problems: string[] = [];
  for (const f of Object.values(paths)) if (!existsSync(f)) problems.push(`${f} is missing`);
  if (problems.length) return problems;
  const text = readFileSync(paths.evidence, "utf8");
  const payload = JSON.parse(text);
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  const lock = JSON.parse(readFileSync(paths.lock, "utf8"));
  const calibration = JSON.parse(readFileSync(paths.calibration, "utf8"));
  const canon = L.schema.canonicalJSON;
  if (!L.verifySeal(payload)) problems.push("integritySha256 does not match the payload");
  if (manifest.payloadFileSha256 !== (await sha256(text))) problems.push("manifest payloadFileSha256 does not match evidence.json");
  if (manifest.integritySha256 !== payload.integritySha256) problems.push("manifest seal differs from the payload seal");
  if (manifest.protocolHash !== payload.protocolHash) problems.push("manifest protocolHash differs from the payload");
  const digest = await registryDigest(root);
  if (payload.registryDigest !== digest) problems.push("this slice's seed reservation changed since the evidence was written");
  if (lock.protocolHash !== payload.protocolHash) problems.push("protocol.lock.json does not match the payload protocol hash");
  if (lock.protocolHash !== L.protocolHash(digest, L.PROTOCOL)) problems.push("the protocol in code differs from the frozen lock");
  if (canon(payload.protocol) !== canon(L.PROTOCOL)) problems.push("payload protocol differs from the protocol in code");
  if (canon(lock.seeds) !== canon({ dev: L.PROTOCOL.devSeeds, noise: L.PROTOCOL.noiseSeeds, fixtures: L.PROTOCOL.fixtureSeeds, fresh: L.PROTOCOL.freshSeeds })) problems.push("lock seed lists differ from the protocol");
  if (canon(calibration) !== canon(payload.calibration)) problems.push("calibration.json differs from the calibration section of evidence.json");
  if (lock.calibrationSha256 !== (await sha256(readFileSync(paths.calibration)))) problems.push("lock calibrationSha256 does not match calibration.json");
  for (const sc of L.SCHEDULE_IDS) if (canon(L.PROTOCOL.delta[sc]) !== canon(calibration.floors[sc])) problems.push(`PROTOCOL.delta.${sc} is not the replicate-noise floor in calibration.json`);
  const registry = JSON.parse(readFileSync(`${root}experiments/discovery/seed-registry.json`, "utf8")).reservations as { first: number; last: number; owner: string }[];
  const all = [...L.PROTOCOL.devSeeds, ...L.PROTOCOL.noiseSeeds, ...L.PROTOCOL.fixtureSeeds, ...L.PROTOCOL.freshSeeds].map((seed, i) => ({ id: `s${i}`, seed }));
  for (const f of L.schema.seedCollisions(all, registry.filter((r) => !r.owner.startsWith(OWN_NAMESPACE)), OWN_NAMESPACE)) problems.push(`seed collision: ${f}`);
  if (!registry.some((r) => r.owner.startsWith(OWN_NAMESPACE) && r.first <= L.PROTOCOL.seedRange.first && r.last >= L.PROTOCOL.seedRange.last)) problems.push("the seed registry has no reservation for this slice");
  // Decisions recomputed from the stored blocks and the stored floors.
  const re = L.decideFresh(payload.calibration, payload.fresh.blocks, L.PROTOCOL);
  if (canon(re.decisions) !== canon(payload.fresh.decisions) || canon(re.verdict) !== canon(payload.fresh.verdict)) problems.push("fresh decisions do not follow the stated decision rules");
  if (L.PROTOCOL.freshSeeds.some((s: number, i: number) => payload.fresh.blocks[i]?.seed !== s)) problems.push("fresh blocks are not the frozen fresh seeds in order");
  for (const b of payload.fresh.blocks) for (const e of b.patchAudit.problems) problems.push(`block ${b.seed}: ${e}`);
  // The full fixture inventory, its expected outcomes, and every cheap fixture recomputed; physical fixtures are re-judged from their stored series.
  problems.push(...checkFixtures(L, payload));
  if (canon(lock.sources ?? null) !== canon(manifest.sources)) problems.push("the source hashes in protocol.lock.json differ from the manifest: the implementation changed between the freeze and the run");
  const manifestSources = Object.keys(manifest.sources as Record<string, string>);
  if (existsSync(root + SRC_DIR)) for (const f of sourceFiles(root)) if (!manifestSources.includes(f)) problems.push(`source ${f} is not in the manifest (added since the evidence was written)`);
  for (const [file, hash] of Object.entries<string>(manifest.sources)) {
    if (!existsSync(root + file)) problems.push(`source ${file} is missing`);
    else if ((await sha256(readFileSync(root + file))) !== hash) problems.push(`source ${file} changed since the evidence was written`);
  }
  return problems;
}

/** Fixture inventory against the frozen expected-outcome table (not against the file itself), plus recomputation of everything cheap. */
export function checkFixtures(L: any, payload: any): string[] {
  const problems: string[] = [];
  const canon = L.schema.canonicalJSON;
  const fx = payload.fixtures;
  const P = L.PROTOCOL;
  if (canon(fx.syntheticOpts) !== canon(L.SYNTH)) problems.push("fixture synthetic options differ from the protocol in code");
  const floors: Record<string, number> = { fixed: L.syntheticFloor("fixed", P), wandering: L.syntheticFloor("wandering", P) };
  if (canon(fx.syntheticFloor) !== canon(floors)) problems.push("synthetic floors differ from their recomputation");
  const key = (c: any) => `${c.id}/${c.schedule}`;
  if (canon(fx.coordination.map(key)) !== canon(L.EXPECTED_FIXTURES.coordination.map(key))) problems.push("coordination fixture inventory differs from the frozen inventory");
  for (const e of L.EXPECTED_FIXTURES.coordination) {
    const f = fx.coordination.find((c: any) => key(c) === key(e));
    if (!f) continue;
    if (f.label !== e.label || f.rejected !== e.rejected || f.naiveReads !== e.naiveReads) problems.push(`fixture ${key(e)}: outcome ${f.label}/rejected ${f.rejected}/naive ${f.naiveReads} differs from the expected ${e.label}/${e.rejected}/${e.naiveReads}`);
    const re = L.coordFixture(e.id, e.schedule, e.id === "static-sun" ? 0 : floors[e.schedule], P, L.SYNTH);
    if (canon(re) !== canon(f)) problems.push(`fixture ${key(e)} differs from its recomputation`);
  }
  const fooled = fx.coordination.filter((c: any) => c.naiveReads && c.rejected).map((c: any) => c.id);
  if (canon(fooled) !== canon(fx.naiveFooled)) problems.push("naiveFooled differs from the fixtures");
  if (canon(fx.physical.map((f: any) => f.id)) !== canon(L.EXPECTED_FIXTURES.physical.map((f: any) => f.id))) problems.push("physical fixture inventory differs from the frozen inventory");
  const floorFixed = payload.calibration.floors.fixed;
  for (const e of L.EXPECTED_FIXTURES.physical) {
    const f = fx.physical.find((q: any) => q.id === e.id);
    if (!f) continue;
    if (f.S.length !== P.fixtureSeeds.length || f.B.length !== P.fixtureSeeds.length || f.residual.length !== P.fixtureSeeds.length) problems.push(`physical fixture ${e.id}: series are not one per fixture seed`);
    if (f.B.some((b: number) => b !== 0)) problems.push(`physical fixture ${e.id}: B is not zero by identity`);
    const j = L.judgePhysical(e.id, f.S, f.B, f.residual, floorFixed, P);
    for (const k of Object.keys(j)) if (canon(j[k]) !== canon(f[k])) problems.push(`physical fixture ${e.id}: ${k} does not follow from the stored series`);
    if (f.rejected !== e.rejected) problems.push(`physical fixture ${e.id}: rejected ${f.rejected}, expected ${e.rejected}`);
  }
  if (canon(fx.planted.map((q: any) => q.id)) !== canon(L.EXPECTED_FIXTURES.planted.map((q: any) => q.id))) problems.push("planted fixture inventory differs from the frozen inventory");
  for (const c of L.PLANTED_CASES) {
    const f = fx.planted.find((q: any) => q.id === c.id);
    const exp = L.EXPECTED_FIXTURES.planted.find((q: any) => q.id === c.id);
    if (f && exp && f.verdict.label !== exp.label) problems.push(`planted fixture ${c.id}: ${f.verdict.label}, expected ${exp.label}`);
    if (f && canon(L.plantedReport(c.id, c.planted, P)) !== canon(f)) problems.push(`planted fixture ${c.id} differs from its recomputation`);
  }
  if (canon(fx.plantedFloors) !== canon(L.PLANTED_FLOORS)) problems.push("planted floors differ from the code");
  return problems;
}

/** Regenerate a frozen two-block subset (first two fresh seeds, all schedules) and the cheap fixtures; require byte equality with the saved payload. */
export async function replayCheck(evidencePath = EVIDENCE, calibrationPath = CALIBRATION, runner?: (specs: any[]) => Promise<any[]>): Promise<string[]> {
  const L = await lib();
  const saved = JSON.parse(readFileSync(evidencePath, "utf8"));
  const run = runner ?? pool;
  const seeds = L.PROTOCOL.freshSeeds.slice(0, 2);
  const specs = L.jobsFor(seeds, L.SCHEDULE_IDS, L.PROTOCOL.strategies, { stripSeed: L.PROTOCOL.freshSeeds[0] });
  const blocks = L.mergeBlocks(await run(specs));
  const problems: string[] = [];
  blocks.forEach((b: any, i: number) => {
    if (L.schema.canonicalJSON(b) !== L.schema.canonicalJSON(saved.fresh.blocks[i])) problems.push(`regenerated block ${b.seed} differs from evidence.json`);
  });
  problems.push(...checkFixtures(L, saved));
  // The first two fixture seeds of the physical fixtures, regenerated and compared series by series.
  const fseeds = L.PROTOCOL.fixtureSeeds.slice(0, 2);
  const pblocks = L.mergeBlocks(await run(fseeds.map((seed: number) => ({ seed, schedules: ["fixed"], strategies: L.PHYS_STRATEGIES }))));
  const phys = L.physicalFixtures(saved.calibration.floors.fixed, L.PROTOCOL, pblocks);
  for (const f of phys) {
    const sv = saved.fixtures.physical.find((q: any) => q.id === f.id);
    for (const k of ["S", "B", "residual", "naiveSignAgreementPpm"]) if (L.schema.canonicalJSON(f[k]) !== L.schema.canonicalJSON(sv?.[k]?.slice(0, 2))) problems.push(`regenerated physical fixture ${f.id}.${k} differs`);
  }
  void calibrationPath;
  return problems;
}

async function generate(): Promise<any> {
  const L = await lib();
  const cal = loadCalibration();
  return L.buildPayload(await registryDigest(), cal, pool as any);
}

async function bench(): Promise<void> {
  const L = await lib();
  const t0 = Date.now();
  const b = L.runBlock({ seed: L.PROTOCOL.devSeeds[0], schedules: ["fixed"], strategies: ["sense"], placements: ["grouped"] });
  const ms = Date.now() - t0;
  const w = L.workload();
  const perStep = ms / L.PROTOCOL.T;
  console.log(`one world (${b.runs.fixed["sense/grouped"].endHash.slice(0, 8)}): ${L.PROTOCOL.T} steps in ${ms} ms = ${perStep.toFixed(2)} ms/step`);
  console.log(`workload ${w.worldsFresh} fresh + ${w.worldsFixtures} fixture worlds = ${w.steps} steps; projected --write with 2 processes ~ ${Math.round((w.steps * perStep) / 2000)} s (target ${WRITE_TARGET_SECONDS} s)`);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "--job") {
    const L = await lib();
    const spec = JSON.parse(process.argv[3]);
    // A fresh seed is never simulated before the protocol lock exists.
    if (L.PROTOCOL.freshSeeds.includes(spec.seed) && !existsSync(LOCK)) throw new Error("refusing to run a fresh seed before protocol.lock.json exists");
    process.stdout.write(JSON.stringify(L.runBlock(spec)));
    return;
  }
  if (mode === "--bench") return bench();
  if (mode === "--calibrate") {
    const L = await lib();
    const t0 = Date.now();
    const cal = await L.calibrationReport(pool as any);
    writeAtomic(CALIBRATION, serialize(cal));
    for (const sc of L.SCHEDULE_IDS) console.log(`floors ${sc}: cap ${cal.floors[sc].cap} ppm, res ${cal.floors[sc].res}`);
    console.log(`sense tracks the sun on dev: ${cal.sensitivity.senseTracks} (2*median gain ${cal.sensitivity.gain2}, 2*noise ${2 * cal.sensitivity.noiseFloor}); capture floor usable: ${cal.sensitivity.floorUsable}; assay sensitive: ${cal.sensitivity.sensitive}`);
    console.log(`signal-difference proxy (dispersed) ${cal.crossTalk.dispersed.signalDiffPpm} ppm, grouped ${cal.crossTalk.grouped.signalDiffPpm} ppm, flagged ${cal.crossTalk.flagged}`);
    console.log(`wrote calibration.json (dev and noise seeds only) in ${Math.round((Date.now() - t0) / 1000)} s. Copy the floors into PROTOCOL.delta, then --freeze.`);
    return;
  }
  if (mode === "--freeze") {
    const L = await lib();
    if (!existsSync(CALIBRATION)) throw new Error("run --calibrate first");
    if (existsSync(LOCK) && !process.argv.includes("--force")) throw new Error("protocol.lock.json exists; pass --force to rewrite deliberately.");
    if (existsSync(EVIDENCE)) throw new Error("evidence.json exists: the protocol can no longer be frozen");
    const digest = await registryDigest();
    const cal = loadCalibration();
    for (const sc of L.SCHEDULE_IDS) if (L.schema.canonicalJSON(L.PROTOCOL.delta[sc]) !== L.schema.canonicalJSON(cal.floors[sc])) throw new Error(`PROTOCOL.delta.${sc} must be ${JSON.stringify(cal.floors[sc])} (the replicate-noise floor)`);
    const lock = { kind: "movinglight-protocol-lock", protocolHash: L.protocolHash(digest, L.PROTOCOL), registryDigest: digest, seeds: { dev: L.PROTOCOL.devSeeds, noise: L.PROTOCOL.noiseSeeds, fixtures: L.PROTOCOL.fixtureSeeds, fresh: L.PROTOCOL.freshSeeds }, calibrationSha256: await sha256(readFileSync(CALIBRATION)), sources: await sourceHashes(), note: "written before the fresh-seed run; fresh results never tune the protocol; the source hashes bind the implementation", frozenAt: new Date().toISOString() };
    writeAtomic(LOCK, serialize(lock));
    console.log(`wrote protocol.lock.json ${lock.protocolHash}`);
    return;
  }
  if (mode === "--write") {
    writeGuard({ lock: LOCK, evidence: EVIDENCE }, process.argv.includes("--force"));
    const L = await lib();
    const lock = JSON.parse(readFileSync(LOCK, "utf8"));
    if (lock.protocolHash !== L.protocolHash(await registryDigest(), L.PROTOCOL)) throw new Error("the protocol in code differs from protocol.lock.json");
    if (lock.calibrationSha256 !== (await sha256(readFileSync(CALIBRATION)))) throw new Error("calibration.json differs from the frozen lock");
    const now = await sourceHashes();
    for (const [f, h] of Object.entries<string>(lock.sources ?? {})) if (now[f] !== h) throw new Error(`${f} changed since the freeze; re-freeze before the fresh run`);
    if (!lock.sources || Object.keys(now).some((f) => !(f in lock.sources))) throw new Error("the lock does not bind every source file; re-freeze");
    // One writer at a time (two pools would exceed the two-process cap).
    const running = `${EVIDENCE}.running`;
    writeFileSync(running, `${process.pid}\n`, { flag: "wx" });
    const t0 = Date.now();
    let payload: any;
    try {
      payload = await generate();
    } finally {
      rmSync(running, { force: true });
    }
    const seconds = (Date.now() - t0) / 1000;
    const text = serialize(payload);
    const manifestText = serialize(await makeManifest(payload, text, seconds));
    writeAtomic(EVIDENCE, text);
    writeAtomic(MANIFEST, manifestText);
    console.log(`wrote evidence.json (${text.length} bytes) seal ${payload.integritySha256} in ${seconds.toFixed(0)} s${seconds > WRITE_TARGET_SECONDS ? ` WARNING: over the ${WRITE_TARGET_SECONDS} s target` : ` (within ${WRITE_TARGET_SECONDS} s)`}; verdict: ${payload.fresh.verdict.label}`);
    return;
  }
  if (mode === "--check" || mode === "--replay-check") {
    const t0 = Date.now();
    const problems = mode === "--check" ? await checkSaved() : await replayCheck();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    const seconds = (Date.now() - t0) / 1000;
    console.log(`${mode} ok${mode === "--replay-check" ? ` (${seconds.toFixed(0)} s${seconds > REPLAY_TARGET_SECONDS ? `, over the ${REPLAY_TARGET_SECONDS} s target` : ""})` : ""}`);
    return;
  }
  console.error("usage: node tools/movinglight/movinglight.ts --bench | --calibrate | --freeze | --write | --check | --replay-check");
  process.exit(2);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
