/**
 * I06 niche construction evidence: the builder->receiver dependency edge, first causal rung. CPU only (sim-ref), Node 24 (relative
 * imports only; @bl/* is resolved by the hook below, as in tools/predictability/atlas.ts):
 *   node tools/niche/niche.ts --bench          step rate on this machine and the projected regeneration time (informational)
 *   node tools/niche/niche.ts --calibrate      dev seeds only: writes calibration.json (delta floors, polymer adequacy, hand-wall G3)
 *   node tools/niche/niche.ts --freeze         write protocol.lock.json (protocol hash, seed lists, registry digest) BEFORE any fresh run
 *   node tools/niche/niche.ts --write          write evidence.json and manifest.json (once, deliberately; needs a matching lock)
 *   node tools/niche/niche.ts --check          validate the saved artifacts without simulating
 *   node tools/niche/niche.ts --replay-check   regenerate the payload and require byte equality
 */
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { arch, platform } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const writeAtomic = (path: string, text: string): void => {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
};

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const OUT_DIR = `${REPO}docs/niche-construction-2026-11-01/`;
export const EVIDENCE = `${OUT_DIR}evidence.json`;
export const MANIFEST = `${OUT_DIR}manifest.json`;
export const CALIBRATION = `${OUT_DIR}calibration.json`;
export const LOCK = `${OUT_DIR}protocol.lock.json`;
export const REGISTRY = `${REPO}experiments/discovery/seed-registry.json`;
export const BASE_COMMIT = "dc7dbbde";
/** PLAN G6: regeneration (blocks, dev wall controls and fixtures) should take under five minutes on an unloaded machine. Load-dependent, so over-target is reported loudly rather than failing a replay. */
export const RUNTIME_TARGET_SECONDS = 300;
const runtimeNote = (seconds: number): string => (seconds > RUNTIME_TARGET_SECONDS ? ` WARNING: over the ${RUNTIME_TARGET_SECONDS} s target (G6); check machine load before trusting the budget` : ` (within the ${RUNTIME_TARGET_SECONDS} s target)`);
const SRC_DIR = "packages/runner/src/niche/";

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
  const [evidence, protocol, schema, decision, assay, fixtures] = await Promise.all([
    import("../../packages/runner/src/niche/evidence.ts"),
    import("../../packages/runner/src/niche/protocol.ts"),
    import("../../packages/schema/src/index.ts"),
    import("../../packages/runner/src/niche/decision.ts"),
    import("../../packages/runner/src/niche/assay.ts"),
    import("../../packages/runner/src/niche/fixtures.ts"),
  ]);
  return { ...evidence, ...protocol, ...decision, ...assay, FIXTURE_SEEDS: fixtures.FIXTURE_SEEDS, schema };
};

export const serialize = (p: unknown): string => `${JSON.stringify(p, null, 1)}\n`;
export const sha256 = async (text: string | Uint8Array): Promise<string> => {
  const { schema } = await lib();
  return schema.sha256HexJS(typeof text === "string" ? new TextEncoder().encode(text) : text);
};
export const registryDigest = async (root = REPO): Promise<string> => sha256(readFileSync(`${root}experiments/discovery/seed-registry.json`));

/** Files whose bytes feed the evidence: the library, the simulator and schema it reads, and this tool. */
const SOURCE_DIRS = [SRC_DIR, "packages/schema/src/", "packages/sim-ref/src/"];
export function sourceFiles(root = REPO): string[] {
  const dirs = SOURCE_DIRS.flatMap((d) => readdirSync(`${root}${d}`).filter((f) => f.endsWith(".ts")).sort().map((f) => d + f));
  return [...dirs, "tools/niche/niche.ts"];
}

export async function generate(): Promise<unknown> {
  const L = await lib();
  return L.buildPayload(await registryDigest());
}

export async function makeManifest(payload: any, evidenceText: string, seconds: number): Promise<Record<string, unknown>> {
  const sources: Record<string, string> = {};
  for (const f of sourceFiles()) sources[f] = await sha256(readFileSync(REPO + f));
  return {
    kind: "niche-evidence-manifest",
    payloadFileSha256: await sha256(evidenceText),
    integritySha256: payload.integritySha256,
    protocolHash: payload.protocolHash,
    registryDigest: payload.registryDigest,
    stepProjection: payload.stepProjection,
    sources,
    provenance: { note: "not replayed; excluded from the deterministic payload", baseCommit: BASE_COMMIT, node: process.version, platform: `${platform()}-${arch()}`, regenerationSeconds: Math.round(seconds), generatedAt: new Date().toISOString() },
  };
}

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
  // The protocol was frozen (lock written) before the fresh run, and nothing changed since.
  const digest = await registryDigest(root);
  if (payload.registryDigest !== digest) problems.push("seed-registry.json changed since the evidence was written");
  if (lock.protocolHash !== payload.protocolHash) problems.push("protocol.lock.json does not match the payload protocol hash");
  if (lock.protocolHash !== L.protocolHash(digest, L.PROTOCOL)) problems.push("the protocol in code differs from the frozen lock");
  if (canon(payload.protocol) !== canon(L.PROTOCOL)) problems.push("payload protocol differs from the protocol in code");
  if (canon(lock.seeds) !== canon({ dev: L.PROTOCOL.devSeeds, replicates: L.PROTOCOL.devReplicateSeeds, wall: L.PROTOCOL.wallSeeds, fresh: L.PROTOCOL.freshSeeds })) problems.push("lock seed lists differ from the protocol");
  // Dev results are reported separately and match the calibration file the protocol was frozen on.
  if (canon(calibration) !== canon(payload.dev)) problems.push("calibration.json differs from the dev section of evidence.json");
  if (lock.calibrationSha256 !== (await sha256(readFileSync(paths.calibration)))) problems.push("lock calibrationSha256 does not match calibration.json");
  for (const c of payload.dev.candidates) if (L.PROTOCOL.delta[String(c.cluster)] !== c.deltaProposed) problems.push(`delta for cluster ${c.cluster} (${L.PROTOCOL.delta[String(c.cluster)]}) is not the dev replicate floor (${c.deltaProposed})`);
  // Seed hygiene.
  const registry = JSON.parse(readFileSync(`${root}experiments/discovery/seed-registry.json`, "utf8")).reservations as { first: number; last: number; owner: string }[];
  const all = [...L.PROTOCOL.devSeeds, ...L.PROTOCOL.devReplicateSeeds, ...L.PROTOCOL.wallSeeds, ...L.PROTOCOL.freshSeeds, ...L.FIXTURE_SEEDS].map((seed, i) => ({ id: `s${i}`, seed }));
  const own = "i06 niche construction";
  const foreign = L.schema.seedCollisions(all, registry.filter((r) => !r.owner.startsWith(own)), own);
  for (const f of foreign) problems.push(`seed collision: ${f}`);
  // Decision recomputation from the stored inputs.
  const recomputed = payload.fresh.ran === false ? payload.fresh.results : L.decideCandidates(payload.fresh.candidates.map((c: any) => c.input), payload.dev.wall.positiveControlPassed);
  if (canon(recomputed) !== canon(payload.fresh.results)) problems.push("fresh results do not follow the stated decision rules");
  if (canon(L.panelVerdict(recomputed)) !== canon(payload.fresh.panel)) problems.push("panel verdict does not follow the stated rules");
  // Every ledger exactly zero.
  const blocks = [...payload.dev.candidates, ...payload.fresh.candidates].flatMap((c: any) => c.blocks);
  for (const b of blocks) for (const [arm, recs] of Object.entries<any[]>(b.transfers)) for (const r of recs) if (r.residual !== "0" || r.matterResidual !== "0") problems.push(`block ${b.seed} arm ${arm} op ${r.op}: nonzero residual`);
  // Manifest sources.
  const listed = Object.keys(manifest.sources as Record<string, string>);
  if (existsSync(root + SRC_DIR)) for (const f of sourceFiles(root)) if (!listed.includes(f)) problems.push(`source ${f} is not in the manifest (added since the evidence was written)`);
  for (const [file, hash] of Object.entries<string>(manifest.sources)) {
    if (!existsSync(root + file)) problems.push(`source ${file} is missing`);
    else if ((await sha256(readFileSync(root + file))) !== hash) problems.push(`source ${file} changed since the evidence was written`);
  }
  return problems;
}

export async function replayCheck(evidencePath = EVIDENCE): Promise<string[]> {
  const fresh = serialize(await generate());
  return fresh === readFileSync(evidencePath, "utf8") ? [] : ["regenerated payload differs from evidence.json"];
}

async function bench(): Promise<void> {
  const L = await lib();
  const t0 = Date.now();
  const r = L.runBlock(L.PROTOCOL.panel[0], L.PROTOCOL.devSeeds[0], L.PROTOCOL, L.PROTOCOL.devReplicateSeeds[0]);
  const ms = Date.now() - t0;
  const steps = 2 * L.PROTOCOL.T1 + 12 * L.PROTOCOL.T2; // 2 histories, 10 arms and 2 replicate arms (all steps incl. fixtures are in the projection)
  const proj = L.stepProjection();
  console.log(`block valid=${r.valid}: ${steps} steps in ${ms} ms = ${(ms / steps).toFixed(2)} ms/step`);
  console.log(`projected regeneration: ${proj.steps} steps (${proj.formula}) ~ ${Math.round((proj.steps * ms) / steps / 1000)} s`);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "--bench") return bench();
  if (mode === "--calibrate") {
    const L = await lib();
    const dev = L.devReport();
    writeAtomic(CALIBRATION, serialize(dev));
    for (const c of dev.candidates) console.log(`cluster ${c.cluster}: delta ${c.deltaProposed} builder P median x2 ${c.builderPMedianTimes2} adequate ${c.polymerAdequate}`);
    console.log(`hand-wall: W1 k=${dev.wall.W1.k} passes=${dev.wall.W1.passes}; W2 k=${dev.wall.W2.k} passes=${dev.wall.W2.passes}; positive control ${dev.wall.positiveControlPassed ? "passed" : "FAILED"} (${dev.wall.used})`);
    console.log("wrote calibration.json (dev only). Copy the deltas into PROTOCOL.delta, then --freeze.");
    return;
  }
  if (mode === "--freeze") {
    const L = await lib();
    if (!existsSync(CALIBRATION)) throw new Error("run --calibrate first");
    if (existsSync(LOCK) && !process.argv.includes("--force")) throw new Error("protocol.lock.json exists; pass --force to rewrite deliberately.");
    const digest = await registryDigest();
    const calibration = JSON.parse(readFileSync(CALIBRATION, "utf8"));
    for (const c of calibration.candidates) if (L.PROTOCOL.delta[String(c.cluster)] !== c.deltaProposed) throw new Error(`PROTOCOL.delta[${c.cluster}] must be ${c.deltaProposed} (the dev replicate floor)`);
    const lock = { kind: "niche-protocol-lock", protocolHash: L.protocolHash(digest, L.PROTOCOL), registryDigest: digest, seeds: { dev: L.PROTOCOL.devSeeds, replicates: L.PROTOCOL.devReplicateSeeds, wall: L.PROTOCOL.wallSeeds, fresh: L.PROTOCOL.freshSeeds }, calibrationSha256: await sha256(readFileSync(CALIBRATION)), note: "written before the fresh-seed run; fresh results never tune the protocol", frozenAt: new Date().toISOString() };
    writeAtomic(LOCK, serialize(lock));
    console.log(`wrote protocol.lock.json ${lock.protocolHash}`);
    return;
  }
  if (mode === "--write") {
    if (existsSync(EVIDENCE) && !process.argv.includes("--force")) throw new Error("evidence.json exists; files are written once. Pass --force to rewrite deliberately.");
    if (!existsSync(LOCK)) throw new Error("no protocol.lock.json: run --calibrate and --freeze before the fresh run");
    const L = await lib();
    const lock = JSON.parse(readFileSync(LOCK, "utf8"));
    if (lock.protocolHash !== L.protocolHash(await registryDigest(), L.PROTOCOL)) throw new Error("the protocol in code differs from protocol.lock.json");
    const t0 = Date.now();
    const payload = (await generate()) as any;
    const seconds = (Date.now() - t0) / 1000;
    const text = serialize(payload);
    const manifestText = serialize(await makeManifest(payload, text, seconds));
    writeFileSync(`${EVIDENCE}.tmp`, text);
    writeFileSync(`${MANIFEST}.tmp`, manifestText);
    renameSync(`${EVIDENCE}.tmp`, EVIDENCE);
    renameSync(`${MANIFEST}.tmp`, MANIFEST);
    console.log(`wrote evidence.json (${text.length} bytes) seal ${payload.integritySha256} in ${seconds.toFixed(0)} s${runtimeNote(seconds)}; verdict: ${payload.fresh.panel.verdict}`);
    return;
  }
  if (mode === "--check" || mode === "--replay-check") {
    const t0 = Date.now();
    const problems = mode === "--check" ? await checkSaved() : await replayCheck();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    const seconds = (Date.now() - t0) / 1000;
    console.log(`${mode} ok${mode === "--replay-check" ? ` (${seconds.toFixed(0)} s)${runtimeNote(seconds)}` : ""}`);
    return;
  }
  console.error("usage: node tools/niche/niche.ts --bench | --calibrate | --freeze | --write | --check | --replay-check");
  process.exit(2);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
