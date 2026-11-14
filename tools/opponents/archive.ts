/**
 * Historical-opponents archive tournament (second rung). CPU only (sim-ref). Node 24, relative imports only (@bl/* via boot.ts):
 *   node tools/opponents/archive.ts --select [--jobs N]        build archive.json from RUNS/<source>/archive.json (viability screen on seeds 901..903)
 *   node tools/opponents/archive.ts --freeze-check             freeze commit is an ancestor, frozen files unchanged, no outcomes in it
 *   node tools/opponents/archive.ts --write [--jobs N]         write evidence.json and manifest.json (once; --force rewrites)
 *   node tools/opponents/archive.ts --check                    validate saved artifacts and recompute every summary and verdict, no simulation
 *   node tools/opponents/archive.ts --replay-check [--jobs N] [--sample PCT]   regenerate and compare (a frozen deterministic sample of jobs with PCT)
 *   node tools/opponents/archive.ts --calibrate-chain --percents 70,45,20,0 [--jobs N]   planted-chain trial on screen seeds (prints only)
 *   node tools/opponents/archive.ts --mini --print             tiny configuration to stdout (tests)
 * Reuses the first rung's runJobs/boot/worker; the first rung's sources are not modified.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { pathToFileURL } from "node:url";
import { runJobs, REPO } from "./assay.ts";
import {
  buildPayload, canonical, expectedConstants, keptSources, panelFromFirstRung, planOf, recompute, scheduleCounts, sealPayload, sha256, verifySeal, STATEMENTS, LIMITS, SALT_NOTE, weakId,
  type ArchiveConfig, type ArchiveFixture, type Payload, type SourceFixture, type SnapshotRec,
} from "../../packages/metrics/src/archive-tournament/evidence.ts";
import { selectSnapshots, viableBins, type Elite } from "../../packages/metrics/src/archive-tournament/index.ts";
import type { JobSpec, RunRec } from "../../packages/metrics/src/opponents/evidence.ts";
import { atFloor } from "../../packages/metrics/src/opponents/payoff.ts";

export { REPO };
export const SLICE_DIR = `${REPO}docs/historical-opponents-archive-2026-11-02/`;
export const ARCHIVE = `${SLICE_DIR}archive.json`;
export const EVIDENCE = `${SLICE_DIR}evidence.json`;
export const MANIFEST = `${SLICE_DIR}manifest.json`;
export const CONFIG_PATH = `${REPO}tools/opponents/archive-config.json`;
export const FIRST_RUNG_EVIDENCE = `${REPO}docs/historical-opponents-2026-11-01/evidence.json`;
export const CONFIG: ArchiveConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
export const CPU_CAP_SECONDS = 3 * 3600;

const { buildPanel, weaken } = await import("../../packages/metrics/src/opponents/panel.ts");
const { checkpointSteps, PLANT, buildContestWorld, stepZero, contestConfig } = await import("../../packages/metrics/src/opponents/arena.ts");
const { RULE_VERSION, validateConfig } = await import("../../packages/schema/src/config.ts");
const { validateState } = await import("../../packages/schema/src/world.ts");
const { genomeFromHex, genomeHex } = await import("../../packages/schema/src/index.ts");

/** Frozen inventory: every scientific file. Compared byte for byte with the freeze commit. */
export function frozenFiles(root = REPO): string[] {
  const ls = (d: string, ext: string) => (existsSync(root + d) ? readdirSync(root + d).filter((f) => f.endsWith(ext)).sort().map((f) => d + f) : []);
  return [
    ...ls("packages/metrics/src/archive-tournament/", ".ts"),
    ...ls("packages/metrics/src/opponents/", ".ts"),
    ...ls("packages/schema/src/", ".ts"),
    ...ls("packages/sim-ref/src/", ".ts"),
    "packages/metrics/src/stats.ts",
    "docs/historical-opponents-archive-2026-11-02/PLAN.md", "docs/historical-opponents-archive-2026-11-02/chain-calibration.json",
    "tools/opponents/archive.ts", "tools/opponents/archive-config.json", "tools/opponents/assay.ts", "tools/opponents/boot.ts", "tools/opponents/worker.ts", "tools/opponents/config.json",
    "docs/historical-opponents-archive-2026-11-02/archive.json", "docs/historical-opponents-2026-11-01/evidence.json",
  ];
}
const OUTCOME_FILES = ["docs/historical-opponents-archive-2026-11-02/evidence.json", "docs/historical-opponents-archive-2026-11-02/manifest.json"];
const git = (root: string, args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).trim();
const fileAt = (root: string, commit: string, path: string): Buffer | null => { try { return execFileSync("git", ["show", `${commit}:${path}`], { cwd: root, maxBuffer: 1 << 28 }); } catch { return null; } };

/** First commit that added the frozen config, unless `commit` is given. */
export function freezeCommit(root = REPO, configPath = "tools/opponents/archive-config.json"): string | null {
  const out = git(root, ["log", "--diff-filter=A", "--format=%H", "--", configPath]);
  const lines = out.split("\n").filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}
export interface FreezeResult { problems: string[]; commit: string | null; inventory: Record<string, string> }
/** Verifies the freeze: ancestor of HEAD, every inventoried file byte-identical to the commit, no outcome files in it, manifest agrees. */
export function freezeCheck(root = REPO, files: string[] = frozenFiles(root), commit?: string, manifestPath = MANIFEST): FreezeResult {
  const problems: string[] = [];
  const c = commit ?? freezeCommit(root);
  if (!c) return { problems: ["no freeze commit: archive-config.json was never committed"], commit: null, inventory: {} };
  try { git(root, ["merge-base", "--is-ancestor", c, "HEAD"]); } catch { problems.push(`freeze commit ${c} is not an ancestor of HEAD`); }
  const tree = git(root, ["ls-tree", "-r", "--name-only", c]).split("\n");
  for (const o of OUTCOME_FILES) if (tree.includes(o)) problems.push(`outcome file ${o} is in the freeze commit`);
  const inventory: Record<string, string> = {};
  for (const f of files) {
    const then = fileAt(root, c, f);
    if (!then) { problems.push(`frozen file ${f} is not in the freeze commit`); continue; }
    inventory[f] = sha256(then);
    if (!existsSync(root + f)) problems.push(`frozen file ${f} is missing from the working tree`);
    else if (sha256(readFileSync(root + f)) !== inventory[f]) problems.push(`frozen file ${f} changed after the freeze`);
  }
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (m.freeze?.commit !== c) problems.push("manifest freeze commit differs from the freeze commit");
    else if (canonical(m.freeze.inventory) !== canonical(inventory)) problems.push("manifest freeze inventory differs from the freeze commit");
  }
  return { problems, commit: c, inventory };
}

// ---- hex map and arena params ----------------------------------------------------------------------------------------------

export function hexMap(cfg: ArchiveConfig, fx: ArchiveFixture): Record<string, string> {
  const P = buildPanel(cfg.weakenPercent);
  const hex: Record<string, string> = { G: P.hex.G, W: P.hex.W };
  cfg.chain.percents.forEach((p, k) => { hex[`p${k}`] = genomeHex(p === 0 ? P.genomes.G : weaken(P.genomes.G, p)); });
  for (const s of keptSources(fx)) {
    for (const sn of s.snapshots) hex[sn.id] = sn.hex;
    const L = s.snapshots[s.snapshots.length - 1];
    hex[weakId(L.id)] = genomeHex(weaken(genomeFromHex(L.hex), cfg.weakenPercent));
  }
  return hex;
}
/** First rung's runJobs reads cfg.arena and cfg.depletion.override only. */
const runnerCfg = (cfg: ArchiveConfig) => ({ arena: cfg.arena, depletion: { override: cfg.depletion, pair: ["", ""] } }) as never;

export async function generate(cfg: ArchiveConfig, fx: ArchiveFixture, nWorkers: number, onlyKeys?: Set<string>): Promise<{ runs: RunRec[]; hex: Record<string, string> }> {
  const hex = hexMap(cfg, fx);
  const jobs = planOf(cfg, fx).jobs.filter((j) => !onlyKeys || onlyKeys.has(j.key));
  const runs = await runJobs(runnerCfg(cfg), jobs, hex, nWorkers);
  return { runs, hex };
}
const arenaParams = (cfg: ArchiveConfig, depletion: boolean) => ({ ...cfg.arena, override: depletion ? cfg.depletion : undefined }) as never;

export const serialize = (p: unknown): string => `${JSON.stringify(p, null, 1)}\n`;
export const loadFirstRung = () => panelFromFirstRung(JSON.parse(readFileSync(FIRST_RUNG_EVIDENCE, "utf8")));

export async function generatePayload(cfg: ArchiveConfig, fx: ArchiveFixture, archiveText: string, nWorkers: number): Promise<Payload> {
  const { runs, hex } = await generate(cfg, fx, nWorkers);
  const panel = loadFirstRung();
  return sealPayload(buildPayload(cfg, fx, runs, panel, hex, sha256(archiveText), sha256(readFileSync(FIRST_RUNG_EVIDENCE)), checkpointSteps(cfg.arena.steps), { ...PLANT }, RULE_VERSION));
}

// ---- selection (--select) ----------------------------------------------------------------------------------------------------

const encGenomeHex = (g: { mu: number; sigma: number; motGain: number; weights: number[]; rings?: [number, number, number] }): string =>
  genomeHex({ mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Int8Array.from(g.weights), ...(g.rings ? { rings: g.rings } : {}) });

/** Decidable compatibility: the genome decodes (round trip) and the arena world built from it validates. */
export function compat(cfg: ArchiveConfig, hex: string): string[] {
  const problems: string[] = [];
  try {
    if (genomeHex(genomeFromHex(hex)) !== hex) problems.push("hex does not round-trip");
    const job = { key: "compat", seed: cfg.screen.seeds[0], hexA: hex, hexB: null, slotsA: [0, 1], slotsB: [] };
    const p = { ...cfg.arena };
    problems.push(...validateConfig(contestConfig(job.seed, p)).map((m: string) => `config: ${m}`));
    problems.push(...validateState(buildContestWorld(job, p)).map((m: string) => `state: ${m}`));
  } catch (e) { problems.push((e as Error).message); }
  return problems;
}

export const TRANSFER_CONDITIONS = [
  "search worlds: 64x64 tile, uniform light (base 40, amplitude 160), mu/sigma 60/20, kernel radius 9; arena: 32x32 tile, gradient light, amplitude 200, mu/sigma 154/24 (the first rung's arena)",
  "search score: survival, recovery after a 30% lesion and light dependence over 7000 steps; arena payoff: biomass share at step 300 against another label, mutation off",
  "bootstrap-200 records a legacy resume with exact:false (resumed from its elites and gate passers, not byte-exact)",
];

export async function selectArchive(cfg: ArchiveConfig, runsDir: string, nWorkers: number): Promise<ArchiveFixture> {
  const raw = cfg.sources.map((s) => {
    const file = `${runsDir}/${s.name}/archive.json`;
    const bytes = readFileSync(file);
    const a = JSON.parse(bytes.toString("utf8"));
    const elites: Elite[] = a.elites.map((e: { cell: [number, number]; born: number; quality: number; genome: never }) => ({ cell: e.cell, born: e.born, quality: e.quality, hex: encGenomeHex(e.genome) }));
    return { s, file, sha: sha256(bytes), a, elites };
  });
  const screens = new Map<string, { viable: boolean; b0: number[]; b300: number[] }>();
  const selections = () => raw.map((r) => {
    const need: string[] = [];
    const sel = selectSnapshots(r.elites, cfg.bins, (e) => {
      const sc = screens.get(e.hex);
      if (sc) return sc.viable;
      need.push(e.hex);
      return true; // provisional: stops this bin until screened
    });
    return { sel, need };
  });
  for (;;) {
    const sels = selections();
    const need = [...new Set(sels.flatMap((x) => x.need))];
    if (!need.length) break;
    const hex: Record<string, string> = {};
    const jobs: JobSpec[] = [];
    need.forEach((h, i) => {
      hex[`g${i}`] = h;
      for (const seed of cfg.screen.seeds) jobs.push({ key: `s|g${i}|m01|${seed}`, seed, a: `g${i}`, b: null, slotsA: [0, 1], slotsB: [], depletion: false });
    });
    const runs = await runJobs(runnerCfg(cfg), jobs, hex, nWorkers);
    const byKey = new Map(runs.map((r) => [r.key, r]));
    need.forEach((h, i) => {
      const rs = cfg.screen.seeds.map((seed) => byKey.get(`s|g${i}|m01|${seed}`) as RunRec);
      const b0 = rs.map((r) => r.b0[0]), b300 = rs.map((r) => r.cp[r.cp.length - 1][0]);
      screens.set(h, { viable: rs.every((r) => !atFloor(r.cp[r.cp.length - 1][0], r.b0[0])), b0, b300 });
    });
    console.error(`screened ${need.length} genomes (${screens.size} total)`);
  }
  const final = selections();
  const sources: SourceFixture[] = [];
  const seenHex = new Map<string, string>();
  raw.forEach((r, si) => {
    const { sel } = final[si];
    const snaps: SnapshotRec[] = sel.bins.filter((b) => b.pick).map((b) => {
      const e = b.pick as Elite;
      return { id: `${r.s.short}:${b.bin}`, bin: b.bin, cell: e.cell, born: e.born, quality: e.quality, hex: e.hex, sharedWith: [] };
    });
    for (const sn of snaps) {
      const prior = seenHex.get(sn.hex);
      if (prior) sn.sharedWith.push(prior);
    }
    snaps.forEach((sn) => { if (!seenHex.has(sn.hex)) seenHex.set(sn.hex, sn.id); });
    const problems = snaps.flatMap((sn) => compat(cfg, sn.hex).map((m) => `${sn.id}: ${m}`));
    let status: SourceFixture["status"] = "kept", dropReason: string | null = null;
    if (viableBins(sel.bins) < cfg.minViableBins) { status = "dropped"; dropReason = `fewer than ${cfg.minViableBins} viable bins (${viableBins(sel.bins)})`; }
    else if (si > 0 && snaps.every((sn) => sn.sharedWith.length > 0)) { status = "dropped"; dropReason = "every snapshot is byte-identical to a snapshot of an earlier source"; }
    else if (problems.length) { status = "dropped"; dropReason = `incompatible with the arena: ${problems[0]}`; }
    const resumes = r.a.resumes as { from: number; exact: boolean }[] | undefined;
    sources.push({
      name: r.s.name, short: r.s.short, file: `runs/${r.s.name}/archive.json`, fileSha256: r.sha, evaluated: r.a.evaluated, elites: r.elites.length, horizon: sel.horizon,
      resumeExact: resumes ? resumes.every((x) => x.exact) : null,
      bins: sel.bins.map((b) => ({ bin: b.bin, lo: b.lo, hi: b.hi, status: b.status, candidates: b.candidates, screened: b.screened, snapshot: b.pick ? `${r.s.short}:${b.bin}` : null })),
      snapshots: snaps, status, dropReason, compat: { ok: problems.length === 0, problems },
      screens: [...new Set(sel.bins.flatMap((b) => (b.pick ? [b.pick.hex] : [])))].map((h) => ({ hex: h, ...(screens.get(h) as { viable: boolean; b0: number[]; b300: number[] }) })),
    });
  });
  return { kind: "historical-opponents-archive-fixture", version: 1, transferConditions: TRANSFER_CONDITIONS, screenSeeds: cfg.screen.seeds, sources };
}

// ---- manifest and check ---------------------------------------------------------------------------------------------------------

export function sourceFiles(root = REPO): string[] {
  const ls = (d: string) => (existsSync(root + d) ? readdirSync(root + d).filter((f) => f.endsWith(".ts")).sort().map((f) => d + f) : []);
  return [
    ...ls("packages/metrics/src/archive-tournament/"), ...ls("packages/metrics/src/opponents/"), ...ls("packages/schema/src/"), ...ls("packages/sim-ref/src/"),
    "packages/metrics/src/stats.ts", "tools/opponents/archive.ts", "tools/opponents/archive-config.json", "tools/opponents/assay.ts", "tools/opponents/worker.ts", "tools/opponents/boot.ts", "tools/opponents/config.json",
  ];
}
const sourceHashes = (root = REPO): Record<string, string> => Object.fromEntries(sourceFiles(root).map((f) => [f, sha256(readFileSync(root + f))]));

export function makeManifest(payload: Payload, evidenceText: string, freeze: FreezeResult, cpuSeconds: number | null): Record<string, unknown> {
  return {
    kind: "historical-opponents-archive-manifest",
    payloadFileSha256: sha256(evidenceText),
    integritySha256: payload.integritySha256,
    archiveSha256: payload.archiveSha256,
    config: payload.config,
    constants: payload.constants,
    schedule: payload.schedule,
    verdict: payload.verdict,
    freeze: { commit: freeze.commit, inventory: freeze.inventory },
    sources: sourceHashes(),
    provenance: { note: "not replayed; excluded from the deterministic payload", node: process.version, platform: `${platform()}-${arch()}`, generatedAt: new Date().toISOString(), cpuSeconds },
  };
}

export const expectedHex = (cfg: ArchiveConfig, fx: ArchiveFixture) => hexMap(cfg, fx);

/** Compare the archive fixture with the source files when `runsDir` is given; otherwise only internal consistency. Returns problems and a skip note. */
export function checkFixture(fx: ArchiveFixture, cfg: ArchiveConfig, runsDir: string | null): { problems: string[]; note: string | null } {
  const problems: string[] = [];
  for (const s of fx.sources) {
    for (const sc of s.screens) {
      const ints = (v: unknown): v is number[] => Array.isArray(v) && v.length === cfg.screen.seeds.length && v.every((x) => Number.isInteger(x) && x >= 0);
      if (!ints(sc.b0) || !ints(sc.b300) || sc.b0.some((x) => x <= 0)) problems.push(`${s.short}: screen record for ${sc.hex.slice(0, 12)} has malformed counts`);
      else if (sc.viable !== sc.b300.every((b, i) => !atFloor(b, sc.b0[i]))) problems.push(`${s.short}: screen record for ${sc.hex.slice(0, 12)} has a viable flag that contradicts its counts`);
    }
    const viableHex = new Set(s.screens.filter((x) => x.viable).map((x) => x.hex));
    for (const sn of s.snapshots) {
      if (!viableHex.has(sn.hex)) problems.push(`${sn.id}: snapshot has no passing viability screen`);
      if (compat(cfg, sn.hex).length) problems.push(`${sn.id}: snapshot is not arena-compatible`);
    }
  }
  if (canonical(fx.screenSeeds) !== canonical(cfg.screen.seeds)) problems.push("fixture screen seeds differ from the config");
  if (!runsDir) return { problems, note: "source-hash check skipped: RUNS is not set (runs/ exists only in the main checkout)" };
  for (const s of fx.sources) {
    const file = `${runsDir}/${s.name}/archive.json`;
    if (!existsSync(file)) { problems.push(`${s.name}: source file missing under RUNS`); continue; }
    const bytes = readFileSync(file);
    if (sha256(bytes) !== s.fileSha256) { problems.push(`${s.name}: source file SHA-256 differs from the fixture`); continue; }
    const a = JSON.parse(bytes.toString("utf8"));
    const elites: Elite[] = a.elites.map((e: { cell: [number, number]; born: number; quality: number; genome: never }) => ({ cell: e.cell, born: e.born, quality: e.quality, hex: encGenomeHex(e.genome) }));
    const screened = new Map(s.screens.map((x) => [x.hex, x.viable]));
    const sel = selectSnapshots(elites, cfg.bins, (e) => screened.get(e.hex) ?? false);
    if (sel.horizon !== s.horizon) problems.push(`${s.name}: horizon differs`);
    for (const b of sel.bins) {
      const rec = s.bins[b.bin];
      const want = b.pick ? `${s.short}:${b.bin}` : null;
      if (rec.snapshot !== want) problems.push(`${s.name}: bin ${b.bin} selection differs from the recomputed one`);
      if (b.pick && s.snapshots.find((x) => x.id === want)?.hex !== b.pick.hex) problems.push(`${s.name}: bin ${b.bin} genome differs`);
    }
  }
  return { problems, note: null };
}

/** Validate saved artifacts without simulating. */
export function checkSaved(o: { evidencePath?: string; manifestPath?: string; archivePath?: string; configPath?: string; root?: string; runsDir?: string | null } = {}): string[] {
  const evidencePath = o.evidencePath ?? EVIDENCE, manifestPath = o.manifestPath ?? MANIFEST, archivePath = o.archivePath ?? ARCHIVE, root = o.root ?? REPO;
  const problems: string[] = [];
  if (!existsSync(evidencePath) || !existsSync(manifestPath)) return ["evidence.json or manifest.json is missing"];
  const text = readFileSync(evidencePath, "utf8");
  const payload = JSON.parse(text) as Payload;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const archiveText = readFileSync(archivePath, "utf8");
  const fx = JSON.parse(archiveText) as ArchiveFixture;
  const cfg: ArchiveConfig = JSON.parse(readFileSync(o.configPath ?? CONFIG_PATH, "utf8"));
  if (!verifySeal(payload)) problems.push("integritySha256 does not match the payload");
  if (manifest.payloadFileSha256 !== sha256(text)) problems.push("manifest payloadFileSha256 does not match evidence.json");
  if (manifest.integritySha256 !== payload.integritySha256) problems.push("manifest seal differs from the payload seal");
  if (manifest.archiveSha256 !== sha256(archiveText) || payload.archiveSha256 !== sha256(archiveText)) problems.push("archive.json changed since the evidence was written");
  if (canonical(manifest.config) !== canonical(payload.config)) problems.push("manifest config differs from the payload");
  if (canonical(manifest.verdict) !== canonical(payload.verdict)) problems.push("manifest verdict differs from the payload");
  if (canonical(payload.config) !== canonical(cfg)) problems.push("payload config differs from the frozen archive-config.json");
  if (JSON.stringify(payload.statements) !== JSON.stringify(STATEMENTS)) problems.push("statements differ");
  if (payload.note !== SALT_NOTE) problems.push("payload note differs");
  if (payload.kind !== "historical-opponents-archive-evidence" || payload.version !== 1) problems.push("payload kind or version differs");
  if (canonical(payload.limits) !== canonical(LIMITS)) problems.push("payload limits differ");
  if (payload.firstRungEvidenceSha256 !== sha256(readFileSync(root + "docs/historical-opponents-2026-11-01/evidence.json"))) problems.push("first rung evidence.json changed");
  const listed = Object.keys(manifest.sources as Record<string, string>);
  for (const f of sourceFiles(root)) if (!listed.includes(f)) problems.push(`source ${f} is not in the manifest (added since the evidence was written)`);
  for (const [file, hash] of Object.entries(manifest.sources as Record<string, string>)) {
    if (!existsSync(root + file)) problems.push(`source ${file} is missing`);
    else if (sha256(readFileSync(root + file)) !== hash) problems.push(`source ${file} changed since the evidence was written`);
  }
  const cmp = (name: string, want: unknown, got: unknown) => { if (canonical(want) !== canonical(got ?? null)) problems.push(`${name} differs from the value reconstructed from the frozen inputs`); };
  cmp("payload hex map", hexMap(cfg, fx), payload.hex);
  cmp("payload panel", loadFirstRungAt(root), payload.panel);
  cmp("payload constants", expectedConstants(checkpointSteps(cfg.arena.steps), { ...PLANT }, RULE_VERSION), payload.constants);
  cmp("payload schedule counts", scheduleCounts(planOf(cfg, fx).jobs), payload.schedule);
  cmp("manifest constants", payload.constants, manifest.constants);
  cmp("manifest schedule", payload.schedule, manifest.schedule);
  if (root === REPO) problems.push(...freezeCheck(REPO, undefined, undefined, manifestPath).problems);
  else if (!manifest.freeze?.commit || !/^[0-9a-f]{40}$/.test(manifest.freeze.commit)) problems.push("manifest has no valid freeze commit");
  const fixture = checkFixture(fx, cfg, o.runsDir === undefined ? (process.env.RUNS ?? null) : o.runsDir);
  problems.push(...fixture.problems);
  problems.push(...recompute(payload, fx));
  problems.push(...checkStepZero(payload, fx));
  return problems;
}
const loadFirstRungAt = (root: string) => panelFromFirstRung(JSON.parse(readFileSync(root + "docs/historical-opponents-2026-11-01/evidence.json", "utf8")));

/** Rebuild every run's step-zero world (no simulation step) and compare the stored inventories with it. */
export function checkStepZero(payload: Payload, fx: ArchiveFixture): string[] {
  const out: string[] = [];
  const stored = new Map(payload.runs.map((r) => [r.key, r]));
  for (const j of planOf(payload.config, fx).jobs) {
    const r = stored.get(j.key);
    if (!r) continue;
    const job = { key: j.key, seed: j.seed, hexA: payload.hex[j.a.replace(/'$/, "")], hexB: j.b === null ? null : payload.hex[j.b.replace(/'$/, "")], slotsA: j.slotsA, slotsB: j.slotsB };
    const p = arenaParams(payload.config, j.depletion);
    const z = stepZero(buildContestWorld(job, p), job, p);
    if (r.b0[0] !== z.b0A || r.b0[1] !== z.b0B || r.e0[0] !== z.e0A || r.e0[1] !== z.e0B) { out.push(`${j.key}: stored step-zero inventories differ from the rebuilt world`); if (out.length >= 10) break; }
  }
  return out;
}

/** Deterministic sample of jobs: FNV-1a of the key modulo 100 below `pct`. */
export const sampled = (key: string, pct: number): boolean => { let h = 2166136261; for (const c of key) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h % 100 < pct; };

export async function replayCheck(nWorkers: number, pct = 100): Promise<string[]> {
  // saved evidence, seal, manifest and freeze provenance are verified first, in full, before any simulation is spent
  if (!existsSync(EVIDENCE) || !existsSync(MANIFEST)) return ["evidence.json or manifest.json is missing: nothing to replay (and no scoring seed is spent)"];
  const pre = checkSaved();
  if (pre.length) return pre;
  const archiveText = readFileSync(ARCHIVE, "utf8");
  const fx = JSON.parse(archiveText) as ArchiveFixture;
  if (pct >= 100) {
    const fresh = serialize(await generatePayload(CONFIG, fx, archiveText, nWorkers));
    return fresh === readFileSync(EVIDENCE, "utf8") ? [] : ["regenerated payload differs from evidence.json"];
  }
  const saved = JSON.parse(readFileSync(EVIDENCE, "utf8")) as Payload;
  const keys = new Set(planOf(CONFIG, fx).jobs.map((j) => j.key).filter((k) => sampled(k, pct)));
  const { runs } = await generate(CONFIG, fx, nWorkers, keys);
  const byKey = new Map(saved.runs.map((r) => [r.key, r]));
  const bad = runs.filter((r) => canonical(r) !== canonical(byKey.get(r.key)));
  console.log(`replayed ${runs.length} of ${saved.runs.length} jobs (${pct}% deterministic sample)`);
  return bad.length ? [`${bad.length} replayed run records differ from evidence.json (first ${bad[0].key})`] : [];
}

// ---- mini configuration (tests) -------------------------------------------------------------------------------------------------

/** Tiny config: two seeds, 60 steps, a four-snapshot source of weakened generalists, a two-level chain. */
export function mini(): { cfg: ArchiveConfig; fx: ArchiveFixture } {
  const P = buildPanel(50);
  const hexes = [60, 40, 20, 0].map((p) => genomeHex(p === 0 ? P.genomes.G : weaken(P.genomes.G, p)));
  const cfg: ArchiveConfig = { ...CONFIG, arena: { tile: 32, radius: 3, steps: 60 }, seeds: [7001, 7002], chain: { percents: [60, 40, 20, 0] }, effectTarget: 0.1 };
  const snaps: SnapshotRec[] = hexes.map((h, i) => ({ id: `mm:${i}`, bin: i, cell: [i, 0] as [number, number], born: i, quality: 1, hex: h, sharedWith: [] }));
  const src: SourceFixture = {
    name: "mini", short: "mm", file: "mini", fileSha256: "0".repeat(64), evaluated: 0, elites: 4, horizon: 4, resumeExact: null,
    bins: snaps.map((s) => ({ bin: s.bin, lo: s.bin, hi: s.bin + 1, status: "viable" as const, candidates: 1, screened: 1, snapshot: s.id })), snapshots: snaps, status: "kept", dropReason: null,
    compat: { ok: true, problems: [] }, screens: hexes.map((hex) => ({ hex, viable: true, b0: [], b300: [] })),
  };
  return { cfg, fx: { kind: "historical-opponents-archive-fixture", version: 1, transferConditions: [], screenSeeds: cfg.screen.seeds, sources: [src] } };
}

// ---- main -----------------------------------------------------------------------------------------------------------------------------

const arg = (name: string, dflt: string): string => { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
function startCpuGuard(): () => number {
  const t = setInterval(() => { const u = process.cpuUsage(); if ((u.user + u.system) / 1e6 > CPU_CAP_SECONDS) { console.error(`aborting: cumulative CPU exceeded ${CPU_CAP_SECONDS} s`); process.exit(3); } }, 5000);
  t.unref();
  return () => { const u = process.cpuUsage(); return Math.round((u.user + u.system) / 1e6); };
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const nWorkers = Number(arg("--jobs", "4"));
  const cpu = startCpuGuard();
  const archiveText = existsSync(ARCHIVE) ? readFileSync(ARCHIVE, "utf8") : "";
  if (mode === "--select") {
    const runsDir = process.env.RUNS;
    if (!runsDir) throw new Error("set RUNS to the main checkout's runs/ directory");
    if (existsSync(ARCHIVE) && !process.argv.includes("--force")) throw new Error("archive.json exists; pass --force to rebuild deliberately");
    const fx = await selectArchive(CONFIG, runsDir, nWorkers);
    writeFileSync(ARCHIVE, serialize(fx));
    for (const s of fx.sources) console.log(`${s.name}: ${s.status}${s.dropReason ? ` (${s.dropReason})` : ""} bins ${s.bins.map((b) => (b.snapshot ? "V" : "-")).join("")} horizon ${s.horizon}`);
    console.log(`cpu ${cpu()} s`);
  } else if (mode === "--freeze-check") {
    const r = freezeCheck();
    if (r.problems.length) { console.error(r.problems.join("\n")); process.exit(1); }
    console.log(`--freeze-check ok (freeze commit ${r.commit}, ${Object.keys(r.inventory).length} frozen files)`);
  } else if (mode === "--write") {
    if (existsSync(EVIDENCE) && !process.argv.includes("--force")) throw new Error("evidence.json exists; files are written once. Pass --force to rewrite deliberately.");
    const fr = freezeCheck();
    if (fr.problems.length) throw new Error(`refusing to score before a valid freeze:\n${fr.problems.join("\n")}`);
    const fx = JSON.parse(archiveText) as ArchiveFixture;
    const payload = await generatePayload(CONFIG, fx, archiveText, nWorkers);
    const text = serialize(payload);
    const manifestText = serialize(makeManifest(payload, text, fr, cpu()));
    writeFileSync(`${EVIDENCE}.tmp`, text); writeFileSync(`${MANIFEST}.tmp`, manifestText);
    renameSync(`${EVIDENCE}.tmp`, EVIDENCE); renameSync(`${MANIFEST}.tmp`, MANIFEST);
    console.log(`wrote evidence.json (${text.length} bytes) verdict ${JSON.stringify(payload.verdict)} seal ${payload.integritySha256} cpu ${cpu()} s`);
  } else if (mode === "--check") {
    const problems = checkSaved();
    const note = checkFixture(JSON.parse(archiveText), CONFIG, process.env.RUNS ?? null).note;
    if (note) console.log(note);
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log("--check ok");
  } else if (mode === "--replay-check") {
    const problems = await replayCheck(nWorkers, Number(arg("--sample", "100")));
    console.log(`cpu ${cpu()} s`);
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log("--replay-check ok");
  } else if (mode === "--calibrate-chain") {
    const percents = arg("--percents", "70,45,20,0").split(",").map(Number);
    const cfg: ArchiveConfig = { ...CONFIG, seeds: CONFIG.screen.seeds, chain: { percents } };
    const fx: ArchiveFixture = { kind: "historical-opponents-archive-fixture", version: 1, transferConditions: [], screenSeeds: cfg.screen.seeds, sources: [] };
    const { runs, hex } = await generate(cfg, fx, nWorkers);
    const panel = loadFirstRung();
    const p = buildPayload(cfg, fx, runs, panel, hex, "", "", checkpointSteps(cfg.arena.steps), { ...PLANT }, RULE_VERSION);
    const t = p.summary.chain.tournament;
    console.log(JSON.stringify({ percents, label: p.summary.chain.fixture.label, rDir: t.analysis.rank.rDir, rDirResid: t.analysis.residRank?.rDir, payoff: t.payoff, edges: t.edges, gw: p.summary.gw }, null, 1));
    console.log(`cpu ${cpu()} s`);
  } else if (mode === "--mini" && process.argv.includes("--print")) {
    const { cfg, fx } = mini();
    const { runs, hex } = await generate(cfg, fx, nWorkers);
    const panel = loadFirstRung();
    process.stdout.write(serialize(sealPayload(buildPayload(cfg, fx, runs, panel, hex, "", "", checkpointSteps(cfg.arena.steps), { ...PLANT }, RULE_VERSION))));
  } else {
    console.error("usage: node tools/opponents/archive.ts --select | --freeze-check | --write | --check | --replay-check | --calibrate-chain | --mini --print");
    process.exit(2);
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
