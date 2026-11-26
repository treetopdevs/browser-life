/**
 * I06b niche construction, second rung: free-energy-matched comparators, replicated readout, ordinary-placement dose-ladder positive control.
 * Invoked through the first rung's CLI so there is one tool: `node tools/niche/niche.ts --rung fe <mode>`:
 *   --bench          one block's step rate and the projected fresh run (informational)
 *   --calibrate      dev blocks, replicate-noise control and the wall dose ladder only: writes calibration.json
 *   --freeze         write protocol.lock.json (protocol hash, seeds, registry digest, calibration and source hashes) BEFORE any fresh run
 *   --write          fixtures and fresh blocks of qualified candidates (calibration is loaded frozen); needs a verifying lock and a pushed identical freeze
 *   --check          validate the saved artifacts without simulating
 *   --replay-check   regenerate the payload from the frozen calibration and require byte equality (same freeze guard)
 *   --repin-rung1    recompute only the source hashes in the first rung's manifest.json (nothing else of rung 1 changes)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { fileURLToPath } from "node:url";
import type * as NicheTool from "./niche.ts";

// The first rung's CLI dispatches here while its own top-level await is still pending, so this module must not import it statically
// (a cycle would never settle). mainFe receives the helpers; tests and other callers get them lazily.
type Helpers = Pick<typeof NicheTool, "sha256" | "registerAliases" | "sourceFiles">;
let helperModule: Helpers | undefined;
const helpers = async (): Promise<Helpers> => (helperModule ??= await import("./niche.ts"));
export const REPO = fileURLToPath(new URL("../../", import.meta.url));
const serialize = (p: unknown): string => `${JSON.stringify(p, null, 1)}\n`;
const sha256 = async (text: string | Uint8Array): Promise<string> => (await helpers()).sha256(text);

export const OUT_DIR_FE = `${REPO}docs/niche-construction-fe-2026-11-02/`;
export const EVIDENCE_FE = `${OUT_DIR_FE}evidence.json`;
export const MANIFEST_FE = `${OUT_DIR_FE}manifest.json`;
export const CALIBRATION_FE = `${OUT_DIR_FE}calibration.json`;
export const LOCK_FE = `${OUT_DIR_FE}protocol.lock.json`;
export const RUNG1_MANIFEST = `${REPO}docs/niche-construction-2026-11-01/manifest.json`;
export const BRANCH = "claude/i06-free-energy-matched";
export const OWNER = "i06b free-energy-matched";
const REGISTRY_REL = "experiments/discovery/seed-registry.json";
const rel = (abs: string) => abs.slice(REPO.length);

const writeAtomic = (path: string, text: string): void => {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
};

const libFe = async () => {
  (await helpers()).registerAliases();
  const [evidence, protocol, schema, decision] = await Promise.all([
    import("../../packages/runner/src/niche/evidenceFe.ts"),
    import("../../packages/runner/src/niche/protocol.ts"),
    import("../../packages/schema/src/index.ts"),
    import("../../packages/runner/src/niche/decisionFe.ts"),
  ]);
  const [replicate, dose] = await Promise.all([import("../../packages/runner/src/niche/replicate.ts"), import("../../packages/runner/src/niche/dose.ts")]);
  return { ...evidence, ...protocol, ...decision, ...replicate, qualify: dose.qualify, schema };
};

/** Digest over this rung's own reservation line(s) only: another slice's reservation never invalidates this evidence. */
export const registryDigestFe = async (root = REPO): Promise<string> => {
  const text = readFileSync(`${root}${REGISTRY_REL}`, "utf8");
  const own = text.split("\n").filter((line) => line.includes(`"owner": "${OWNER}`));
  if (own.length !== 1) throw new Error(`expected exactly one registry reservation owned by "${OWNER}", found ${own.length}`);
  return sha256(own.join("\n"));
};

/** Every file whose bytes feed this rung's evidence: the first rung's source set plus this tool. */
export const frozenSources = async (root = REPO): Promise<string[]> => [...(await helpers()).sourceFiles(root), "tools/niche/fe.ts"];
export const hashSources = async (root = REPO): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const f of await frozenSources(root)) out[f] = await sha256(readFileSync(root + f));
  return out;
};

// ---------------------------------------------------------------------------
// Freeze-before-run guard

export type Git = (args: string[]) => string;
export const realGit: Git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26 });

/** Paths whose bytes the lock binds (or that the lock itself is): they must be committed and identical on the pushed branch. */
export const PLAN_FE = `${OUT_DIR_FE}PLAN.md`;
export const frozenPaths = async (root = REPO): Promise<string[]> => [...(await frozenSources(root)), REGISTRY_REL, rel(CALIBRATION_FE), rel(LOCK_FE), rel(PLAN_FE)];

/**
 * Refuse unless the freeze is clean and pushed: the frozen paths have no uncommitted change, and each path's blob on
 * origin/<BRANCH> equals the blob in the working tree (git ls-tree against git hash-object). The lock cannot name its own commit,
 * so this identical-on-the-pushed-branch check is the ordering proof. Returns problems (empty when the guard allows).
 */
export function freezeGuard(paths: string[], git: Git = realGit, branch = BRANCH): string[] {
  const problems: string[] = [];
  // The remote itself is asked (not a possibly stale remote-tracking ref); its commit must be present locally so its tree can be read.
  let ref = "";
  try {
    ref = git(["ls-remote", "--exit-code", "origin", `refs/heads/${branch}`]).split(/\s+/)[0] ?? "";
  } catch {
    return [`origin has no refs/heads/${branch} (or cannot be reached): push the freeze commit first (git push -u origin ${branch})`];
  }
  if (!/^[0-9a-f]{40}$/.test(ref)) return [`could not read the commit of origin refs/heads/${branch}`];
  let status = "";
  try {
    status = git(["status", "--porcelain", "--", ...paths]);
  } catch (e) {
    return [`git status failed: ${(e as Error).message}`];
  }
  for (const line of status.split("\n").filter(Boolean)) problems.push(`frozen file not committed clean: ${line.trim()}`);
  let tree = "";
  try {
    tree = git(["ls-tree", "-r", ref, "--", ...paths]);
  } catch {
    return [...problems, `commit ${ref} of origin/${branch} is not in the local object store: git fetch origin ${branch}`];
  }
  const remote = new Map<string, string>();
  for (const line of tree.split("\n").filter(Boolean)) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (m) remote.set(m[2], m[1]);
  }
  const local = git(["hash-object", "--", ...paths]).split("\n").filter(Boolean);
  paths.forEach((path, i) => {
    if (!remote.has(path)) problems.push(`${path} is not on ${ref}`);
    else if (remote.get(path) !== local[i]) problems.push(`${path} differs from ${ref}`);
  });
  return problems;
}

/** Lock verification: protocol, calibration, seeds, registry digest and every source hash against the current tree. */
export async function verifyLock(planPath = PLAN_FE): Promise<string[]> {
  const L = await libFe();
  const problems: string[] = [];
  if (!existsSync(LOCK_FE)) return ["no protocol.lock.json: run --calibrate and --freeze before the fresh run"];
  if (!existsSync(CALIBRATION_FE)) return ["no calibration.json"];
  const lock = JSON.parse(readFileSync(LOCK_FE, "utf8"));
  const digest = await registryDigestFe();
  const canon = L.schema.canonicalJSON;
  if (lock.registryDigest !== digest) problems.push("registry reservation changed since the freeze");
  if (lock.protocolHash !== L.protocolHashFe(digest, L.PROTOCOL_FE)) problems.push("the protocol in code differs from protocol.lock.json");
  if (canon(lock.seeds) !== canon(L.enumerateSeedsFe(L.PROTOCOL_FE))) problems.push("lock seed list differs from the protocol");
  if (lock.calibrationSha256 !== (await sha256(readFileSync(CALIBRATION_FE)))) problems.push("calibration.json changed since the freeze");
  if (lock.planSha256 !== (await sha256(readFileSync(planPath)))) problems.push("PLAN.md (with Amendment 3) changed since the freeze");
  const now = await hashSources();
  if (canon(lock.sources) !== canon(now)) for (const f of new Set([...Object.keys(lock.sources ?? {}), ...Object.keys(now)])) if (lock.sources?.[f] !== now[f]) problems.push(`source ${f} differs from the freeze`);
  return problems;
}

export async function guarded(git: Git = realGit): Promise<void> {
  const problems = [...(await verifyLock()), ...freezeGuard(await frozenPaths(), git)];
  if (problems.length) throw new Error(`refusing to read any fresh seed:\n${problems.join("\n")}`);
}

// ---------------------------------------------------------------------------

const logger = (t0: number) => (s: string) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${s}`);

/** Every path that can simulate fresh seeds starts here, so the guard lives here: no lock, dirty tree or unpushed freeze means no simulation. */
export async function generateFe(git: Git = realGit): Promise<unknown> {
  await guarded(git);
  const L = await libFe();
  const dev = JSON.parse(readFileSync(CALIBRATION_FE, "utf8"));
  return L.buildPayloadFe(await registryDigestFe(), dev, L.PROTOCOL_FE, logger(Date.now()));
}

export async function makeManifestFe(payload: any, evidenceText: string, seconds: number): Promise<Record<string, unknown>> {
  return {
    kind: "niche-fe-evidence-manifest",
    payloadFileSha256: await sha256(evidenceText),
    integritySha256: payload.integritySha256,
    protocolHash: payload.protocolHash,
    registryDigest: payload.registryDigest,
    stepProjection: payload.stepProjection,
    sources: await hashSources(),
    provenance: { note: "not replayed; excluded from the deterministic payload", node: process.version, platform: `${platform()}-${arch()}`, regenerationSeconds: Math.round(seconds), generatedAt: new Date().toISOString() },
  };
}

/** Validate saved artifacts without simulating. Returns problems (empty when sound). */
export async function checkSavedFe(root = REPO): Promise<string[]> {
  const L = await libFe();
  const problems: string[] = [];
  const paths = { evidence: EVIDENCE_FE, manifest: MANIFEST_FE, calibration: CALIBRATION_FE, lock: LOCK_FE };
  for (const f of Object.values(paths)) if (!existsSync(f)) problems.push(`${f} is missing`);
  if (problems.length) return problems;
  const text = readFileSync(paths.evidence, "utf8");
  const payload = JSON.parse(text);
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  const lock = JSON.parse(readFileSync(paths.lock, "utf8"));
  const calibration = JSON.parse(readFileSync(paths.calibration, "utf8"));
  const canon = L.schema.canonicalJSON;
  if (!L.verifySealFe(payload)) problems.push("integritySha256 does not match the payload");
  if (manifest.payloadFileSha256 !== (await sha256(text))) problems.push("manifest payloadFileSha256 does not match evidence.json");
  if (manifest.integritySha256 !== payload.integritySha256) problems.push("manifest seal differs from the payload seal");
  if (manifest.protocolHash !== payload.protocolHash) problems.push("manifest protocolHash differs from the payload");
  const digest = await registryDigestFe(root);
  if (payload.registryDigest !== digest) problems.push("this rung's registry reservation changed since the evidence was written");
  if (lock.protocolHash !== payload.protocolHash) problems.push("protocol.lock.json does not match the payload protocol hash");
  if (lock.protocolHash !== L.protocolHashFe(digest, L.PROTOCOL_FE)) problems.push("the protocol in code differs from the frozen lock");
  if (canon(payload.protocol) !== canon(L.PROTOCOL_FE)) problems.push("payload protocol differs from the protocol in code");
  if (canon(lock.seeds) !== canon(L.enumerateSeedsFe(L.PROTOCOL_FE))) problems.push("lock seed list differs from the protocol");
  if (canon(calibration) !== canon(payload.dev)) problems.push("calibration.json differs from the dev section of evidence.json");
  if (lock.calibrationSha256 !== (await sha256(readFileSync(paths.calibration)))) problems.push("lock calibrationSha256 does not match calibration.json");
  for (const c of payload.dev.candidates) if (L.PROTOCOL_FE.delta[String(c.cluster)] !== c.deltaProposed) problems.push(`delta for cluster ${c.cluster} is not the dev replicate-noise floor`);
  // Seed hygiene: every seed that can run lies in this rung's reservation, never in another owner's (rung 1's seeds included).
  const registry = JSON.parse(readFileSync(`${root}${REGISTRY_REL}`, "utf8")).reservations as { first: number; last: number; owner: string }[];
  const all = L.enumerateSeedsFe(L.PROTOCOL_FE).map((seed, i) => ({ id: `s${i}`, seed }));
  for (const f of L.schema.seedCollisions(all, registry.filter((r) => !r.owner.startsWith(OWNER)), OWNER)) problems.push(`seed collision: ${f}`);
  for (const s of all) if (!registry.some((r) => r.owner.startsWith(OWNER) && s.seed >= r.first && s.seed <= r.last)) problems.push(`seed ${s.seed} is outside this rung's reservation`);
  // Decision and qualification recomputation from the stored inputs.
  const recomputed = L.decideCandidatesFe(payload.fresh.inputs, L.PROTOCOL_FE.viableBlocksMin);
  if (canon(recomputed) !== canon(payload.fresh.results)) problems.push("fresh results do not follow the stated decision rules");
  if (canon(L.panelVerdictFe(recomputed)) !== canon(payload.fresh.panel)) problems.push("panel verdict does not follow the stated rules");
  const qual = payload.dev.candidates.map((c: any) => L.qualify(c.cluster, c.deltaProposed, c.builderPMedianTimes2, payload.dev.ladder.rows, L.PROTOCOL_FE));
  if (canon(qual) !== canon(payload.dev.qualification)) problems.push("qualification does not follow the stated positive-control rules");
  for (const q of payload.dev.qualification) {
    const sim = payload.fresh.candidates.some((c: any) => c.cluster === q.cluster);
    if (sim !== q.qualified) problems.push(`cluster ${q.cluster}: ${q.qualified ? "qualified but not simulated" : "not qualified but simulated"}`);
  }
  // Every ledger exactly zero.
  const blocks = [...payload.dev.candidates, ...payload.fresh.candidates].flatMap((c: any) => c.blocks);
  for (const b of blocks) for (const [arm, recs] of Object.entries<any[]>(b.transfers)) for (const r of recs) if (r.residual !== "0" || r.matterResidual !== "0") problems.push(`block ${b.seed} arm ${arm} op ${r.op}: nonzero residual`);
  // Sources.
  const now = await hashSources(root);
  if (canon(manifest.sources) !== canon(now)) for (const f of new Set([...Object.keys(manifest.sources), ...Object.keys(now)])) if (manifest.sources[f] !== now[f]) problems.push(`source ${f} changed since the evidence was written`);
  if (canon(lock.sources) !== canon(now)) problems.push("sources differ from the frozen lock");
  return problems;
}

export async function replayCheckFe(): Promise<string[]> {
  const fresh = serialize(await generateFe());
  return fresh === readFileSync(EVIDENCE_FE, "utf8") ? [] : ["regenerated payload differs from evidence.json"];
}

async function repinRung1(): Promise<void> {
  const m = JSON.parse(readFileSync(RUNG1_MANIFEST, "utf8"));
  const sources: Record<string, string> = {};
  for (const f of (await helpers()).sourceFiles()) sources[f] = await sha256(readFileSync(REPO + f));
  m.sources = sources;
  writeAtomic(RUNG1_MANIFEST, serialize(m));
  console.log(`re-pinned ${Object.keys(sources).length} source hashes in the first rung's manifest.json (nothing else changed)`);
}

export async function mainFe(argv: string[], injected?: Helpers): Promise<void> {
  if (injected) helperModule = injected;
  const mode = argv[2];
  const L = await libFe();
  const t0 = Date.now();
  const log = logger(t0);
  if (mode === "--bench") {
    const p = L.PROTOCOL_FE;
    const r = L.runBlockFe(p.panel[0], p.devSeeds[0], p);
    const ms = Date.now() - t0;
    const steps = 2 * p.T1 + 13 * p.R * p.T2;
    console.log(`block valid=${r.valid}: ${steps} steps in ${ms} ms = ${(ms / steps).toFixed(2)} ms/step`);
    const proj = L.stepProjectionFe(p);
    console.log(`fresh run: ${proj.freshBlocks} blocks x ${proj.stepsPerBlock} steps ~ ${Math.round((proj.freshBlocks * ms) / 1000)} s; dev blocks ${proj.devBlocks} ~ ${Math.round((proj.devBlocks * ms) / 1000)} s`);
    return;
  }
  if (mode === "--calibrate") {
    const dev = L.devReportFe(L.PROTOCOL_FE, log);
    writeAtomic(CALIBRATION_FE, serialize(dev));
    for (const q of dev.qualification) console.log(`cluster ${q.cluster}: ${q.qualified ? "QUALIFIED" : "not qualified"} delta ${q.delta} ceiling ${q.ceiling} minDetectableDose ${q.minDetectableDose} qualifyingDose ${q.qualifyingDose}: ${q.reason}`);
    console.log(`W2: ${dev.ladder.w2.status} (${dev.ladder.w2.reason})`);
    console.log("wrote calibration.json (dev only). Copy the deltas into PROTOCOL_FE.delta, then --freeze.");
    return;
  }
  if (mode === "--freeze") {
    if (!existsSync(CALIBRATION_FE)) throw new Error("run --calibrate first");
    if (existsSync(LOCK_FE) && !argv.includes("--force")) throw new Error("protocol.lock.json exists; pass --force to rewrite deliberately.");
    const digest = await registryDigestFe();
    const calibration = JSON.parse(readFileSync(CALIBRATION_FE, "utf8"));
    for (const c of calibration.candidates) if (L.PROTOCOL_FE.delta[String(c.cluster)] !== c.deltaProposed) throw new Error(`PROTOCOL_FE.delta[${c.cluster}] must be ${c.deltaProposed} (the dev replicate-noise floor)`);
    if (calibration.R !== L.PROTOCOL_FE.R) throw new Error("calibration was run with a different R");
    const lock = { kind: "niche-fe-protocol-lock", protocolHash: L.protocolHashFe(digest, L.PROTOCOL_FE), registryDigest: digest, seeds: L.enumerateSeedsFe(L.PROTOCOL_FE), calibrationSha256: await sha256(readFileSync(CALIBRATION_FE)), planSha256: await sha256(readFileSync(PLAN_FE)), sources: await hashSources(), note: "written before the fresh-seed run; fresh results never tune the protocol", frozenAt: new Date().toISOString() };
    writeAtomic(LOCK_FE, serialize(lock));
    console.log(`wrote protocol.lock.json ${lock.protocolHash}`);
    return;
  }
  if (mode === "--write") {
    if (existsSync(EVIDENCE_FE) && !argv.includes("--force")) throw new Error("evidence.json exists; files are written once. Pass --force to rewrite deliberately.");
    const payload = (await generateFe()) as any;
    const seconds = (Date.now() - t0) / 1000;
    const text = serialize(payload);
    const manifestText = serialize(await makeManifestFe(payload, text, seconds));
    writeFileSync(`${EVIDENCE_FE}.tmp`, text);
    writeFileSync(`${MANIFEST_FE}.tmp`, manifestText);
    renameSync(`${EVIDENCE_FE}.tmp`, EVIDENCE_FE);
    renameSync(`${MANIFEST_FE}.tmp`, MANIFEST_FE);
    console.log(`wrote evidence.json (${text.length} bytes) seal ${payload.integritySha256} in ${seconds.toFixed(0)} s; verdict: ${payload.fresh.panel.verdict}`);
    return;
  }
  if (mode === "--check" || mode === "--replay-check") {
    const problems = mode === "--check" ? await checkSavedFe() : await replayCheckFe();
    if (problems.length) {
      console.error(problems.join("\n"));
      process.exit(1);
    }
    console.log(`rung fe ${mode} ok${mode === "--replay-check" ? ` (${Math.round((Date.now() - t0) / 1000)} s)` : ""}`);
    return;
  }
  if (mode === "--repin-rung1") return repinRung1();
  console.error("usage: node tools/niche/niche.ts --rung fe --bench | --calibrate | --freeze | --write | --check | --replay-check | --repin-rung1");
  process.exit(2);
}
