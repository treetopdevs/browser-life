/** Gate A CPU controls. --freeze pins code/fixtures; --execute requires that freeze. */
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorld, cloneState, defaultConfig, founderGenome, encodeGenome, M3_FOUNDERS, M3_FOUNDER_SET, type WorldState } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { advanceFocal, chooseCandidate, initialFocal, interventionLink, isolateSupport, lesionSupport, linkSupport, maintenance, negativeCalibration, overallCalibration, productionEvidence, quenchSupport, recovery, sensitivityOrigin, supportFrame, PRIMARY_RULE, SENSITIVITY_RULE, type FocalState, type Frame, type Role, type RoleTally, type WindowSample } from "./lib/gate-a-evaluation-v1.ts";

const root = resolve(import.meta.dirname!, "..");
const protocol = "docs/gate-a-protocol-v1.md";
const fixture = "tools/fixtures/reset-material-bounds-mutation-v1.json";
const ownFiles = ["tools/lib/gate-a-evaluation-v1.ts", "tools/lib/reset-topology.ts", "tools/gate-a-controls-v1.ts", "tools/test/gate-a-evaluation-v1.test.ts", protocol, fixture];
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function arg(name: string, fallback?: string): string { const i = Deno.args.indexOf(name); if (i < 0) { if (fallback !== undefined) return fallback; throw Error(`missing ${name}`); } if (!Deno.args[i + 1]) throw Error(`missing ${name} value`); return Deno.args[i + 1]; }
async function files(): Promise<string[]> {
  const command = new Deno.Command(Deno.execPath(), { args: ["info", "--no-lock", "--json", "tools/gate-a-controls-v1.ts"], cwd: root, stdout: "piped", stderr: "piped" });
  const result = await command.output();
  if (!result.success) throw Error(`dependency graph failed: ${new TextDecoder().decode(result.stderr)}`);
  const graph = JSON.parse(new TextDecoder().decode(result.stdout));
  const found = new Set([...ownFiles, "deno.json"]);
  try { await Deno.stat(join(root, "deno.lock")); found.add("deno.lock"); } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  for (const module of graph.modules ?? []) {
    if (typeof module.specifier !== "string" || !module.specifier.startsWith("file:")) continue;
    const absolute = fileURLToPath(module.specifier), rel = relative(root, absolute);
    if (!rel.startsWith("..") && !isAbsolute(rel) && !rel.startsWith("node_modules/")) found.add(rel);
  }
  return [...found].sort();
}
async function sourceHashes(): Promise<Record<string, string>> { return Object.fromEntries(await Promise.all((await files()).map(async (p) => [p, sha(await Deno.readFile(join(root, p)))]))); }
async function freshDirectory(path: string) {
  const out = resolve(path);
  if (out === root || relative(root, out).startsWith("..")) throw Error("output must be inside repository");
  if (["tools", "packages", "docs"].some((prefix) => { const p = join(root, prefix); return out === p || (!relative(p, out).startsWith("..") && !isAbsolute(relative(p, out))); })) throw Error("output overlaps source directory");
  try { if ((await Array.fromAsync(Deno.readDir(out))).length) throw Error("output directory is nonempty"); }
  catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  await Deno.mkdir(out, { recursive: true }); return out;
}
async function write(path: string, value: unknown) { const tmp = path + ".tmp"; await Deno.writeTextFile(tmp, JSON.stringify(value, null, 2) + "\n"); await Deno.rename(tmp, path); }
interface Freeze { format: "gate-a-freeze/v1"; frozenAt: string; sourceHashes: Record<string, string>; fixtureSha256: string; protocolSha256: string }
async function freeze(path: string) { try { await Deno.stat(path); throw Error("freeze path already exists; use a new versioned path"); } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; } const hashes = await sourceHashes(); const obj: Freeze = { format: "gate-a-freeze/v1", frozenAt: new Date().toISOString(), sourceHashes: hashes, fixtureSha256: hashes[fixture], protocolSha256: hashes[protocol] }; await write(path, obj); console.log(JSON.stringify({ freeze: path, sources: Object.keys(hashes).length, sha256: sha(await Deno.readFile(path)) })); }
async function verifyFreeze(path: string): Promise<Freeze> { const pinned = JSON.parse(await Deno.readTextFile(path)) as Freeze, actual = await sourceHashes(); if (pinned.format !== "gate-a-freeze/v1" || JSON.stringify(pinned.sourceHashes) !== JSON.stringify(actual) || pinned.fixtureSha256 !== actual[fixture] || pinned.protocolSha256 !== actual[protocol]) throw Error("frozen source/protocol/fixture drift"); return pinned; }
const zeros = () => ({ photo: { activeSteps: 0, lowerBound: 0 }, grow: { activeSteps: 0, lowerBound: 0 }, decomp: { activeSteps: 0, lowerBound: 0 }, resp: { activeSteps: 0, lowerBound: 0 } });
function addTally(into: ReturnType<typeof zeros>, roles: RoleTally | null) { for (const key of ["photo", "grow", "decomp", "resp"] as Role[]) if (roles?.[key]?.activeSites) { into[key].activeSteps++; into[key].lowerBound += roles[key].lowerBound; } }
function shortFrame(frame: Frame, focal: FocalState) { return { step: frame.step, rule: frame.rule, worldBoundMass: frame.world.boundMass, componentCount: frame.supports.length, components: frame.supports.map((x) => ({ index: x.index, minSite: x.minSite, sites: x.sites.length, mass: x.mass, perimeter: x.perimeter, activeSiteFraction: x.activeSiteFraction })), focal: { status: focal.status, current: focal.current, firstUnresolved: focal.firstUnresolved, mass: focal.current === null ? null : frame.supports[focal.current]?.mass ?? null } }; }
interface ArmReport { name: string; lastStep: number; componentTrace: { step: number; primary: ReturnType<typeof shortFrame>["components"]; sensitivity: ReturnType<typeof shortFrame>["components"] }[]; status: "complete" | "partial"; samples: { step: number; primary: ReturnType<typeof shortFrame>; sensitivity: ReturnType<typeof shortFrame>; localPrimary: ReturnType<typeof zeros> | null; localSensitivity: ReturnType<typeof zeros> | null; wholeWorld: ReturnType<typeof zeros>; mutationCount: number }[]; ambiguities: { step: number; rule: string; from: number; status: string; successors: number[] }[]; mutationEvents: { step: number; childHi: number; childLo: number; parentHi: number; parentLo: number }[]; calibration?: unknown }
class TimeLimit extends Error {}
function deadlineCheck(deadline: number) { if (performance.now() >= deadline) throw new TimeLimit("Gate A wall-clock ceiling reached"); }
async function runArm(name: string, start: WorldState, primary0: Frame, low0: Frame, pFocal0: FocalState, lFocal0: FocalState, out: string, deadline: number): Promise<ArmReport> {
  const sim = new RefSim(cloneState(start)), firstStep = start.step;
  let pFrame = primary0, lFrame = low0, pFocal = pFocal0, lFocal = lFocal0;
  let pWindow = zeros(), lWindow = zeros(), worldWindow = zeros(), pAvailable = pFocal.status === "linked", lAvailable = lFocal.status === "linked", mutationCount = 0;
  const samples: ArmReport["samples"] = [{ step: firstStep, primary: shortFrame(pFrame, pFocal), sensitivity: shortFrame(lFrame, lFocal), localPrimary: null, localSensitivity: null, wholeWorld: zeros(), mutationCount: 0 }];
  const scorePrimary: WindowSample[] = [{ frame: pFrame, focal: pFocal, localActivity: null }], scoreLow: WindowSample[] = [{ frame: lFrame, focal: lFocal, localActivity: null }];
  const report: ArmReport = { name, lastStep: firstStep, status: "partial", componentTrace: [{ step: firstStep, primary: shortFrame(pFrame, pFocal).components, sensitivity: shortFrame(lFrame, lFocal).components }], samples, ambiguities: [], mutationEvents: [] };
  try {
    for (let t = 1; t <= 2000; t++) {
      deadlineCheck(deadline);
      const stepResult = sim.step(); report.lastStep = sim.state.step;
      for (const e of stepResult.events) report.mutationEvents.push({ step: sim.state.step, ...e });
      mutationCount += stepResult.events.length;
      const nextP = supportFrame(sim.state.cfg, sim.state.step, sim.state.cells, PRIMARY_RULE, sim.roles), nextL = supportFrame(sim.state.cfg, sim.state.step, sim.state.cells, SENSITIVITY_RULE, sim.roles);
      for (const [before, after, rule] of [[pFrame, nextP, "48/8"], [lFrame, nextL, "1/8"]] as const)
        for (const x of before.supports) { const link = linkSupport(before, after, x.index); if (link.status !== "unique") report.ambiguities.push({ step: after.step, rule, from: x.index, status: link.status, successors: link.successors }); }
      pFocal = advanceFocal(pFocal, pFrame, nextP).focal;
      lFocal = advanceFocal(lFocal, lFrame, nextL).focal;
      if (pFocal.status !== "linked") pAvailable = false;
      if (lFocal.status !== "linked") lAvailable = false;
      if (pAvailable) addTally(pWindow, nextP.supports[pFocal.current!]?.roles ?? null);
      if (lAvailable) addTally(lWindow, nextL.supports[lFocal.current!]?.roles ?? null);
      addTally(worldWindow, nextP.world.roles);
      pFrame = nextP; lFrame = nextL;
      report.componentTrace.push({ step: sim.state.step, primary: shortFrame(pFrame, pFocal).components, sensitivity: shortFrame(lFrame, lFocal).components });
      if (t % 100 === 0) {
        const primaryActivity = pAvailable ? Object.values(pWindow).some((x) => x.activeSteps > 0) : null;
        const sensitivityActivity = lAvailable ? Object.values(lWindow).some((x) => x.activeSteps > 0) : null;
        scorePrimary.push({ frame: pFrame, focal: pFocal, localActivity: primaryActivity });
        scoreLow.push({ frame: lFrame, focal: lFocal, localActivity: sensitivityActivity });
        samples.push({ step: sim.state.step, primary: shortFrame(pFrame, pFocal), sensitivity: shortFrame(lFrame, lFocal), localPrimary: pAvailable ? pWindow : null, localSensitivity: lAvailable ? lWindow : null, wholeWorld: worldWindow, mutationCount });
        await write(join(out, `${name}.json`), report);
        pWindow = zeros(); lWindow = zeros(); worldWindow = zeros(); pAvailable = pFocal.status === "linked"; lAvailable = lFocal.status === "linked"; mutationCount = 0;
      }
    }
    report.status = "complete";
    (report as ArmReport & { scores: { primary: WindowSample[]; sensitivity: WindowSample[] } }).scores = { primary: scorePrimary, sensitivity: scoreLow };
  } catch (error) { if (!(error instanceof TimeLimit)) throw error; }
  await write(join(out, `${name}.json`), report);
  return report;
}
async function execute(outArg: string, freezePath: string, maxSeconds: number) {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 540) throw Error("--max-seconds must be finite in (0,540], within the remaining Gate A budget");
  const startedAt = new Date().toISOString();
  const started = performance.now(), deadline = started + maxSeconds * 1000;
  const pinned = await verifyFreeze(freezePath), out = await freshDirectory(outArg);
  const cfg = defaultConfig({ tileW: 64, tileH: 64, tilesX: 1, tilesY: 1, seed: 6100001, kernelRadius: 9, lightMode: "uniform", lightBase: 40, lightAmp: 160, defaultMu: 60, defaultSigma: 20 });
  const init = buildWorld(cfg, { nutrient: 32, founders: [{ x: 32, y: 32, radius: 10, genome: founderGenome(M3_FOUNDERS[2]), biomass: 64, energy: 128 }] });
  const result: Record<string, unknown> = { format: "gate-a-execution/v1", startedAt, status: "partial", protocolSha256: pinned.protocolSha256, freezeSha256: sha(await Deno.readFile(freezePath)), cfgSha256: sha(JSON.stringify(cfg)), cfg, founder: { index: 2, historicalCluster: M3_FOUNDERS[2].cluster, founderSetId: M3_FOUNDER_SET, genomeHex: Array.from(encodeGenome(founderGenome(M3_FOUNDERS[2]), 0, 0).subarray(2), (word) => word.toString(16).padStart(8, "0")).join("") }, mutationRate: cfg.mutRate, preparation: null, isolation: null, lesion: null, arms: {}, production: productionEvidence(null), organization: { status: "unavailable", reason: "descriptive nonmass metrics are not a validated functional organization endpoint" }, roleInterpretation: "activity presence and saturated label totals are lower bounds; whole-world totals never substitute for focal activity", limitations: ["material-retention unavailable", "production unavailable without independent causal evidence and independently functioning descendants"] };
  const save = async () => write(join(out, "execution.json"), result);
  await save();
  try {
    const sim = new RefSim(init); let prepMutations = 0;
    for (let t = 1; t <= 3000; t++) { deadlineCheck(deadline); prepMutations += sim.step().events.length; if (t % 100 === 0) { result.preparation = { completedSteps: t, mutationEvents: prepMutations }; await save(); } }
    const prepared = supportFrame(cfg, sim.state.step, sim.state.cells), candidate = chooseCandidate(prepared);
    result.preparation = { completedSteps: 3000, mutationEvents: prepMutations, candidate: candidate ? { index: candidate.index, minSite: candidate.minSite, mass: candidate.mass, sites: candidate.sites.length } : null, allComponents: prepared.supports.map((x) => ({ index: x.index, minSite: x.minSite, mass: x.mass, sites: x.sites.length })) }; await save();
    if (!candidate) { result.status = "positive-preparation-unavailable"; return; }
    const isolated = isolateSupport(sim.state, candidate); result.isolation = { removedBoundMass: isolated.removedBoundMass, removedEnergy: isolated.removedEnergy, removedSites: isolated.removedSites, initialMass: candidate.mass }; await save();
    const sham = isolated.state, lesion = lesionSupport(sham, candidate), quenched = quenchSupport(sham);
    result.lesion = { removedBoundMass: lesion.removedBoundMass, removedEnergy: lesion.removedEnergy, fraction: lesion.fraction, residualMass: lesion.residualMass, valid: lesion.valid }; await save();
    const beforeP = supportFrame(cfg, sham.step, sham.cells), beforeL = supportFrame(cfg, sham.step, sham.cells, SENSITIVITY_RULE), p0 = chooseCandidate(beforeP)!;
    const lOrigin = sensitivityOrigin(p0, beforeL);
    const entries = [["sham", sham], ["lesion", lesion.state], ["quenched", quenched]] as const;
    for (const [name, start] of entries) {
      deadlineCheck(deadline);
      const pFrame = supportFrame(cfg, start.step, start.cells), lFrame = supportFrame(cfg, start.step, start.cells, SENSITIVITY_RULE);
      const pLink = name === "lesion" ? interventionLink(beforeP, pFrame, p0.index) : { status: "unique", to: p0.index };
      const lLink = name === "lesion" && lOrigin !== null ? interventionLink(beforeL, lFrame, lOrigin) : { status: lOrigin === null ? "no-overlap" : "unique", to: lOrigin };
      const focal = (link: { status: string; to: number | null }, origin: number): FocalState => link.status === "unique" && link.to !== null ? initialFocal(link.to) : { origin, current: null, status: "unresolved", firstUnresolved: { step: start.step, reason: link.status as "no-overlap" } };
      const arm = await runArm(name, start, pFrame, lFrame, focal(pLink, p0.index), focal(lLink, lOrigin ?? -1), out, deadline);
      const scores = (arm as ArmReport & { scores?: { primary: WindowSample[]; sensitivity: WindowSample[] } }).scores;
      if (scores && arm.status === "complete") {
        const evaluate = name === "sham" ? (x: WindowSample[]) => maintenance(x, candidate.mass) : name === "lesion" ? (x: WindowSample[]) => recovery(x, candidate.mass, lesion.valid) : negativeCalibration;
        arm.calibration = { primary: evaluate(scores.primary), sensitivity: evaluate(scores.sensitivity), overall: overallCalibration(evaluate(scores.primary), evaluate(scores.sensitivity)) };
        delete (arm as { scores?: unknown }).scores;
        await write(join(out, `${name}.json`), arm);
      }
      (result.arms as Record<string, unknown>)[name] = { status: arm.status, calibration: arm.calibration ?? null, samples: arm.samples.length, mutationEvents: arm.mutationEvents.length };
      await save();
      if (arm.status !== "complete") { result.status = "feasibility-unresolved-timeout"; return; }
    }
    result.status = "complete";
  } catch (error) { if (error instanceof TimeLimit) result.status = "feasibility-unresolved-timeout"; else { result.status = "error"; result.error = String(error); throw error; } }
  finally {
    result.elapsedSeconds = Number(((performance.now() - started) / 1000).toFixed(3)); result.finishedAt = new Date().toISOString();
    result.endSourceHashesVerified = JSON.stringify((await sourceHashes())) === JSON.stringify(pinned.sourceHashes);
    if (!result.endSourceHashesVerified) { result.status = "source-drift"; result.error = "execution source changed during run"; }
    await save();
    const outputHashes = Object.fromEntries(await Promise.all((await Array.fromAsync(Deno.readDir(out))).filter((x) => x.isFile).map(async (x) => [x.name, sha(await Deno.readFile(join(out, x.name)))])));
    await write(join(out, "receipt.json"), { format: "gate-a-receipt/v1", startedAt, finishedAt: result.finishedAt, status: result.status, freezeSha256: result.freezeSha256, sourceHashes: pinned.sourceHashes, outputHashes, elapsedSeconds: result.elapsedSeconds });
    console.log(JSON.stringify({ status: result.status, elapsedSeconds: result.elapsedSeconds, output: out }));
  }
}
if (Deno.args.includes("--freeze")) await freeze(resolve(arg("--freeze")));
else if (Deno.args.includes("--verify")) { await verifyFreeze(resolve(arg("--verify"))); console.log(JSON.stringify({ status: "verified", manifest: resolve(arg("--verify")) })); }
else if (Deno.args.includes("--execute")) await execute(arg("--out"), arg("--manifest"), Number(arg("--max-seconds", "540")));
else throw Error("use --freeze PATH or --execute --manifest PATH --out DIR [--max-seconds 540]");
