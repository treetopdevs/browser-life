// Founder-policy experiment stages. No GPU or biological work occurs in plan.
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { M3_FOUNDERS, founderGenome } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { loadPinned } from "./lib/selection-funnel-audit.ts";
import { EVOLUTION_SEEDS, PILOT_ASSAY_SEEDS, MAIN_ASSAY_SEEDS, REPAIR_ASSAY_SEEDS, designFromInputs, sha256, simHex, type Design, type ResolvedConfigs } from "./lib/founder-policy.ts";
import { assayConfig, evolutionConfig, executeCompetition } from "./lib/founder-policy-runtime.ts";
import { assayIdentity, evaluatePilot, pilotRequests, type PilotResult } from "./lib/founder-policy-pilot.ts";

const root = resolve(import.meta.dirname!, "..");
const defaultInputs = join(root, "experiments/foundations/selection-audit-v1/input-manifest.json");
const protocol = "docs/founder-policy-protocol-v1.md";
const sourceDirs = ["packages/schema/src", "packages/sim-gpu/src", "packages/sim-ref/src", "packages/runner/src", "packages/metrics/src"];
const sourceFiles = ["deno.json", "deno.lock", "package.json", protocol, "tools/lib/selection-funnel-audit.ts", "tools/lib/founder-policy.ts", "tools/lib/founder-policy-runtime.ts", "tools/lib/founder-policy-pilot.ts", "tools/founder-policy.ts", "tools/test/founder-policy.test.ts"];

function option(name: string, fallback?: string): string { const i = Deno.args.indexOf(name); if (i < 0) { if (fallback !== undefined) return fallback; throw Error(`missing ${name}`); } const value = Deno.args[i + 1]; if (!value || value.startsWith("--")) throw Error(`missing ${name} value`); return value; }
function boundedSeconds(raw: string): number { const n = Number(raw); if (!Number.isFinite(n) || n <= 0 || n > 7200) throw Error("--max-seconds must be finite in (0,7200]"); return n; }
async function listSourceFiles(): Promise<string[]> {
  const files = new Set(sourceFiles);
  const walk = async (dir: string) => { for await (const entry of Deno.readDir(join(root, dir))) { const p = `${dir}/${entry.name}`; if (entry.isDirectory) await walk(p); else if (entry.isFile && p.endsWith(".ts")) files.add(p); } };
  for (const dir of sourceDirs) await walk(dir);
  return [...files].sort();
}
export async function currentSourceHashes(): Promise<Record<string, string>> { return Object.fromEntries(await Promise.all((await listSourceFiles()).map(async (p) => [p, sha256(await Deno.readFile(join(root, p)))]))); }
async function readDesign(path: string): Promise<{ design: Design; manifestSha256: string }> {
  const bytes = await Deno.readFile(path), design = JSON.parse(new TextDecoder().decode(bytes)) as Design;
  const current = await currentSourceHashes();
  if (design.format !== 1 || JSON.stringify(design.sourceHashes) !== JSON.stringify(current)) throw Error("frozen source/protocol/config drift");
  const inputBytes = await Deno.readFile(defaultInputs);
  if (sha256(inputBytes) !== design.inputManifestSha256) throw Error("pinned input manifest drift");
  const { data } = await loadPinned(defaultInputs); // verifies every immutable snapshot hash again
  const regenerated = designFromInputs(design.inputManifestSha256, current, resolvedConfigs(), data.archive, data.viable, M3_FOUNDERS.map((x) => simHex(founderGenome(x))));
  if (JSON.stringify(design) !== JSON.stringify(regenerated)) throw Error("manifest roster/config/threshold drift from pinned inputs");
  return { design, manifestSha256: sha256(bytes) };
}
function safeOutput(path: string): string { const out = resolve(path), rel = relative(root, out); if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || ["tools", "packages", "docs", "experiments/foundations/selection-audit-v1"].some((p) => rel === p || rel.startsWith(`${p}/`))) throw Error("unsafe output path"); return out; }
async function writeNew(path: string, contents: string | Uint8Array): Promise<void> { await Deno.mkdir(dirname(path), { recursive: true }); const file = await Deno.open(path, { createNew: true, write: true }); try { const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents; let p = 0; while (p < bytes.length) p += await file.write(bytes.subarray(p)); } finally { file.close(); } }
async function jsonNew(path: string, value: unknown): Promise<void> { await writeNew(path, JSON.stringify(value, null, 2) + "\n"); }
async function readIfExists<T>(path: string): Promise<T | null> { try { return JSON.parse(await Deno.readTextFile(path)) as T; } catch (e) { if (e instanceof Deno.errors.NotFound) return null; throw e; } }

async function plan(): Promise<void> {
  const inputPath = resolve(option("--input", defaultInputs));
  if (inputPath !== resolve(defaultInputs)) throw Error("plan must use the pinned selection-audit input manifest");
  const out = safeOutput(option("--out"));
  const { data } = await loadPinned(inputPath);
  const design = designFromInputs(sha256(await Deno.readFile(inputPath)), await currentSourceHashes(), resolvedConfigs(), data.archive, data.viable, M3_FOUNDERS.map((x) => simHex(founderGenome(x))));
  await jsonNew(out, design);
  console.log(JSON.stringify({ stage: "plan", path: out, sha256: sha256(await Deno.readFile(out)), eligibleGenomes: design.eligible.length, archiveClusters: new Set(design.eligible.map((x) => x.cluster)).size, histories: design.histories.length, samples: design.sampleUnits.length, requestedTechnicalAssays: design.requestedTechnicalAssays }));
}

function resolvedConfigs(): ResolvedConfigs {
  const unit = (seed: number, mode: "normal" | "off") => ({ id: "config", cohort: "historical", seed, seedIndex: EVOLUTION_SEEDS.indexOf(seed), mode, slots: Array.from({ length: 12 }, (_, i) => i) });
  return { evolution: EVOLUTION_SEEDS.map((seed) => ({ seed, normal: evolutionConfig(unit(seed, "normal")), off: evolutionConfig(unit(seed, "off")) })), pilotAssay: PILOT_ASSAY_SEEDS.map((seed) => ({ seed, cfg: assayConfig(seed) })), mainAssay: MAIN_ASSAY_SEEDS.map((seed) => ({ seed, cfg: assayConfig(seed) })), repairAssay: REPAIR_ASSAY_SEEDS.map((seed) => ({ seed, cfg: assayConfig(seed) })) };
}

function validatePilotResult(result: PilotResult, request: ReturnType<typeof pilotRequests>[number], manifestSha256: string): void {
  if (JSON.stringify(result.request) !== JSON.stringify(request) || result.manifestSha256 !== manifestSha256) throw Error(`pilot receipt identity drift ${request.id}`);
  if (result.request.assayKey !== assayIdentity(request.descendantHex, request.ancestorHex, request.seed, request.assignment, assayConfig(request.seed))) throw Error(`pilot assay key drift ${request.id}`);
  if (JSON.stringify(result.cfg) !== JSON.stringify(assayConfig(request.seed))) throw Error(`pilot assay config drift ${request.id}`);
  if (![result.descendantMass, result.ancestorMass].every((x) => Number.isSafeInteger(x) && x >= 0)) throw Error(`pilot mass malformed ${request.id}`);
  const expected = result.descendantMass + result.ancestorMass === 0 ? null : (result.descendantMass - result.ancestorMass) / (result.descendantMass + result.ancestorMass);
  if (result.score !== expected || result.status !== (expected === null ? "both-extinct" : "scored")) throw Error(`pilot score/status mismatch ${request.id}`);
  if (!/^[0-9a-f]{16,}$/.test(result.startHash) || !/^[0-9a-f]{16,}$/.test(result.finalHash)) throw Error(`pilot state hash malformed ${request.id}`);
}

async function pilot(): Promise<void> {
  const manifestPath = resolve(option("--manifest")), out = safeOutput(option("--out")), maxSeconds = boundedSeconds(option("--max-seconds"));
  const { design, manifestSha256 } = await readDesign(manifestPath);
  const requests = pilotRequests(design, assayConfig);
  await Deno.mkdir(out, { recursive: true });
  const deadline = performance.now() + maxSeconds * 1000, results: PilotResult[] = [];
  const cache = new Map<string, PilotResult>();
  let device: GPUDevice | null = null, attempted = 0, timedOut = false, errorText: string | null = null;
  const invocationStartedAt = new Date().toISOString();
  try {
    for (const request of requests) {
      const path = join(out, `${request.id}.json`), prior = await readIfExists<PilotResult>(path);
      if (prior) { validatePilotResult(prior, request, manifestSha256); results.push(prior); cache.set(request.assayKey, prior); continue; }
      if (performance.now() >= deadline) { timedOut = true; break; }
      if (!device) device = await requestDevice(navigator.gpu, assayConfig(request.seed));
      const startedAt = new Date().toISOString(), started = performance.now(), cached = cache.get(request.assayKey);
      try {
        const observed = cached ? null : await executeCompetition(device, request.descendantHex, request.ancestorHex, request.seed, request.assignment, deadline);
        const result: PilotResult = cached
          ? { ...cached, request, reusedFrom: cached.request.id, startedAt, finishedAt: new Date().toISOString(), wallSeconds: 0 }
          : { request, status: observed!.score.status, score: observed!.score.status === "scored" ? observed!.score.value : null, descendantMass: observed!.score.descendantMass, ancestorMass: observed!.score.ancestorMass, startHash: observed!.startHash, finalHash: observed!.finalHash, cfg: observed!.cfg, startedAt, finishedAt: new Date().toISOString(), wallSeconds: (performance.now() - started) / 1000, manifestSha256 };
        validatePilotResult(result, request, manifestSha256);
        await jsonNew(path, result); results.push(result); cache.set(request.assayKey, result); attempted++;
      } catch (e) { if (e instanceof Error && e.message.includes("time limit")) { timedOut = true; break; } throw e; }
    }
    let replayPassed: boolean | null = null;
    const replayPath = join(out, "replay.json"), priorReplay = await readIfExists<{ manifestSha256: string; requestId: string; finalHash: string; replayFinalHash: string; replayScore: unknown; passed: boolean }>(replayPath);
    if (priorReplay) {
      const first = results[0];
      const expectedScore = first && { status: first.status, ...(first.status === "scored" ? { value: first.score } : {}), descendantMass: first.descendantMass, ancestorMass: first.ancestorMass };
      const derived = priorReplay.replayFinalHash === first?.finalHash && JSON.stringify(priorReplay.replayScore) === JSON.stringify(expectedScore);
      if (priorReplay.manifestSha256 !== manifestSha256 || priorReplay.requestId !== requests[0].id || priorReplay.finalHash !== first?.finalHash || typeof priorReplay.passed !== "boolean" || priorReplay.passed !== derived) throw Error("replay receipt drift");
      replayPassed = derived;
    }
    else if (results.length === requests.length && performance.now() < deadline) {
      if (!device) device = await requestDevice(navigator.gpu, assayConfig(requests[0].seed));
      try { const observed = await executeCompetition(device, requests[0].descendantHex, requests[0].ancestorHex, requests[0].seed, requests[0].assignment, deadline); replayPassed = observed.finalHash === results[0].finalHash && JSON.stringify(observed.score) === JSON.stringify({ status: results[0].status, ...(results[0].status === "scored" ? { value: results[0].score } : {}), descendantMass: results[0].descendantMass, ancestorMass: results[0].ancestorMass }); await jsonNew(replayPath, { manifestSha256, requestId: requests[0].id, finalHash: results[0].finalHash, replayFinalHash: observed.finalHash, replayScore: observed.score, passed: replayPassed, finishedAt: new Date().toISOString() }); }
      catch (e) { if (e instanceof Error && e.message.includes("time limit")) timedOut = true; else throw e; }
    }
    const gate = evaluatePilot(requests, results, replayPassed);
    if (JSON.stringify(await currentSourceHashes()) !== JSON.stringify(design.sourceHashes)) throw Error("frozen source drift during pilot");
    if (gate.complete) {
      const gatePath = join(out, "gate.json"), existing = await readIfExists<Record<string, unknown>>(gatePath);
      if (existing) { if (existing.manifestSha256 !== manifestSha256 || existing.pass !== gate.pass || existing.observedRequests !== gate.observedRequests) throw Error("existing pilot gate drift"); }
      else await jsonNew(gatePath, { manifestSha256, ...gate, finishedAt: new Date().toISOString() });
    }
    console.log(JSON.stringify({ stage: "pilot", manifestSha256, out, attempted, observed: results.length, expected: requests.length, timedOut, gate }));
  } catch (e) { errorText = e instanceof Error ? e.message : String(e); throw e; }
  finally {
    device?.destroy();
    const receipt = { stage: "pilot", manifestSha256, invocationStartedAt, invocationFinishedAt: new Date().toISOString(), maxSeconds, attempted, observed: results.length, expected: requests.length, timedOut, error: errorText };
    await jsonNew(join(out, `invocation-${invocationStartedAt.replace(/[^0-9]/g, "")}.json`), receipt);
  }
}

if (import.meta.main) {
  const stage = Deno.args[0];
  if (stage === "plan") await plan();
  else if (stage === "pilot") await pilot();
  else if (stage === "run" || stage === "analyze") throw Error(`${stage} stage is under implementation; no physical work started`);
  else throw Error("usage: founder-policy.ts plan|pilot|run|analyze [options]");
}
