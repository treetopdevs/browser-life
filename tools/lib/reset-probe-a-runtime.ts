/** Mutation-enabled historical replay for one frozen Probe A history. No selection changes. */
import { createHash } from "node:crypto";
import { artifactDigest, canonicalConfig, stateHash } from "@bl/schema";
import { decodeArtifact } from "@bl/runner";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import type { MutationEvent } from "@bl/sim-ref";
import { ResetOriginMap } from "./reset-copy-extraction.ts";
import { ResetGpuCopyAudit } from "./reset-gpu-copy-audit.ts";
import { joinResetMutationEvents } from "./reset-gpu-event-join.ts";
import { ResetProbeAAnalysis, type ResetSelectedLink,
  type ResetLinkEvidence } from "./reset-probe-a-analysis.ts";
import { ResetProbeAObserver } from "./reset-probe-a-observer.ts";
import type { ResetDesignHistory, ResetFileIdentity, ResetFreeze } from "./reset-probe-a-auth.ts";
import { resetWindowFrame, resolveResetWindowInterval,
  type ResetWindowFrame } from "./reset-window.ts";
import { ResetWindowPersistence,
  type ResetWindowPersistenceResult } from "./reset-window-persistence.ts";

export type ResetCheckpointVerification = {
  step: number; physicsHash: string; artifactDigest: string;
  originalBytesSha256: string;
};
export type ResetHistoryResult = {
  status: "running" | "complete" | "incomplete-time-cap" |
    "incomplete-memory-cap" | "incomplete-gpu-contention" |
    "incomplete-output-cap" | "incomplete-output-io" | "failed-parity-or-source";
  history: number; attempt: number; planSha256: string; designSha256: string;
  startedAt: string; finishedAt: string | null;
  elapsedSeconds: number; maxSeconds: number; adapter: Record<string, string> | null;
  evidence: ResetLinkEvidence[];
  unavailableRows: { rowIndex: number; reason: "not-reached-in-attempt" |
    "missing-from-complete-run" }[];
  checkpointVerifications: ResetCheckpointVerification[];
  windows: { frames: ResetWindowFrame[]; persistence: ResetWindowPersistenceResult[] };
  mutationLedger: { sourceSha256: string; replaySha256: string | null;
    count: number; dropped: number; effects: Record<string, number> };
  lifeLedger: { sourceSha256: string; replaySha256: string | null; count: number };
  lineageLedger: { sourceSha256: string; replaySha256: string | null; count: number };
  sourcePostvalidated: boolean; error: string | null;
  interpretation: "selected-links-copy-evidence-not-reproduction-classification";
};

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const utf8 = new TextEncoder();
const ms = () => performance.now();

export class ResetTimeCapError extends Error {}
export class ResetMemoryCapError extends Error {}
export class ResetOutputCapError extends Error {}

export async function runResetProbeAHistory(args: {
  history: ResetDesignHistory; rows: ResetSelectedLink[];
  freeze: ResetFreeze; preflight: { checkpoints: { h: number; step: number;
    physicsHash: string; artifactHash: string }[] };
  attempt: number; planSha256: string; designSha256: string;
  reservedMaxSeconds: number;
  deadlineMs: number; startedAt: string;
  activeLabelsBytes: number;
  save: (result: ResetHistoryResult) => Promise<void>;
  checkHostGpu: () => Promise<void>;
  checkOutputBudget: () => Promise<void>;
}): Promise<ResetHistoryResult> {
  const { history, rows, freeze, preflight } = args;
  const start = ms();
  const maxSeconds = args.reservedMaxSeconds;
  const input = new Map(freeze.inputs.map(x => [x.path, x]));
  const source = (file: string): ResetFileIdentity => {
    const path = `${history.sourceDirectory}/${file}`;
    const found = input.get(path);
    if (!found) throw new Error(`source freeze lacks original input ${path}`);
    return found;
  };
  const manifest = JSON.parse(await Deno.readTextFile(source("manifest.json").path));
  if (manifest.spec.seed !== history.seed || manifest.spec.presetId !== history.preset ||
      manifest.spec.condition !== history.condition || manifest.spec.steps !== history.endStep ||
      manifest.spec.censusEvery !== 100 || !manifest.spec.lineageObs ||
      manifest.spec.metapopulation || manifest.cfg.migrationPeriod)
    throw new Error("original source manifest disagrees with prospective history");
  const mutationSource = source("mutations.tsv"), lifeSource = source("life.jsonl");
  const lineageSource = source("lineages.tsv");
  const mutationHash = createHash("sha256"), lifeHash = createHash("sha256");
  const lineageHash = createHash("sha256");
  mutationHash.update("childHi\tchildLo\tparentHi\tparentLo\n");
  lineageHash.update("step\tlineage\tcells\n");
  const fresh = ResetProbeAObserver.fromFresh(manifest.spec, manifest.initHash);
  if (canonicalConfig(fresh.state.cfg) !== canonicalConfig(manifest.cfg))
    throw new Error("fresh source configuration differs from original manifest");
  const observer = fresh.adapter;
  const analysis = new ResetProbeAAnalysis(fresh.state.cfg, observer, rows);
  const persistence = new ResetWindowPersistence(fresh.state.cfg,
    history.continuousWindow.referenceStep, args.activeLabelsBytes);
  const result: ResetHistoryResult = { status: "running", history: history.history,
    attempt: args.attempt, planSha256: args.planSha256,
    designSha256: args.designSha256,
    startedAt: args.startedAt, finishedAt: null,
    elapsedSeconds: 0, maxSeconds, adapter: null, evidence: [],
    unavailableRows: rows.map(x => ({ rowIndex: x.rowIndex,
      reason: "not-reached-in-attempt" })), checkpointVerifications: [],
    windows: { frames: [], persistence: [] },
    mutationLedger: { sourceSha256: mutationSource.sha256, replaySha256: null,
      count: 0, dropped: 0, effects: {} },
    lifeLedger: { sourceSha256: lifeSource.sha256, replaySha256: null, count: 0 },
    lineageLedger: { sourceSha256: lineageSource.sha256, replaySha256: null, count: 0 },
    sourcePostvalidated: false, error: null,
    interpretation: "selected-links-copy-evidence-not-reproduction-classification" };
  let sim: GpuSim | undefined, audit: ResetGpuCopyAudit | undefined;
  let intervalFrames: ResetWindowFrame[] = [];
  const checkTime = () => {
    if (ms() > args.deadlineMs) throw new ResetTimeCapError("Probe A history time cap reached");
  };
  const refresh = async () => {
    result.elapsedSeconds = ms() - start;
    result.elapsedSeconds /= 1000;
    result.evidence = analysis.rows();
    const seen = new Set(result.evidence.map(x => x.original.rowIndex));
    result.unavailableRows = rows.filter(x => !seen.has(x.rowIndex)).map(x => ({
      rowIndex: x.rowIndex, reason: result.status === "complete" ?
        "missing-from-complete-run" as const : "not-reached-in-attempt" as const }));
    result.windows.persistence = persistence.results();
    await args.save(result);
  };
  try {
    checkTime(); await args.checkHostGpu();
    const device = await requestDevice(navigator.gpu, fresh.state.cfg);
    result.adapter = { description: device.adapterInfo.description,
      vendor: device.adapterInfo.vendor, architecture: device.adapterInfo.architecture,
      deno: Deno.version.deno, os: Deno.build.os };
    sim = await GpuSim.create(device, fresh.state);
    audit = await ResetGpuCopyAudit.create(sim, fresh.state);
    const w = history.continuousWindow;
    let priorCensusFrame: { step: number; cells: Uint32Array;
      genomeHead: Uint32Array } | null = null;
    let intervalEvents: MutationEvent[] = [];
    let intervalMap: ResetOriginMap | null = null;
    for (let censusStep = 100; censusStep <= history.endStep; censusStep += 100) {
      checkTime();
      const perStep = censusStep > w.referenceStep && censusStep <= w.followupLast;
      let physical: { step: number; cells: Uint32Array; genomeHead: Uint32Array };
      let map: ResetOriginMap;
      if (perStep) {
        if (!priorCensusFrame || priorCensusFrame.step !== censusStep - 100)
          throw new Error("continuous window lacks previous physical census");
        intervalMap = ResetOriginMap.atPhysicalCensus(fresh.state.cfg,
          priorCensusFrame.step, priorCensusFrame.cells, priorCensusFrame.genomeHead);
        let priorCells = priorCensusFrame.cells;
        intervalFrames = [];
        for (let step = censusStep - 99; step <= censusStep; step++) {
          checkTime();
          audit.run(1);
          const [current, tagged, ledger] = await Promise.all([
            sim.readSnapshot(), audit.readSnapshot(), sim.drainLedger()]);
          if (ledger.dropped) throw new Error("original mutation ledger dropped events");
          const oneStep = ResetOriginMap.fromSnapshot(tagged);
          if (oneStep.referenceStep !== step - 1 || current.step !== step)
            throw new Error("per-step passive audit lost physical alignment");
          intervalMap = intervalMap.compose(tagged);
          const joined = joinResetMutationEvents(fresh.state.cfg,
            step - 1, tagged, ledger.events);
          for (const m of joined) result.mutationLedger.effects[m.effect] =
            (result.mutationLedger.effects[m.effect] ?? 0) + 1;
          for (const event of ledger.events) {
            mutationHash.update(`${event.childHi}\t${event.childLo}\t${event.parentHi}\t${event.parentLo}\n`);
            result.mutationLedger.count++;
          }
          intervalEvents.push(...ledger.events);
          let flags = [] as ResetWindowFrame["flags"];
          if (step >= w.candidateStepsFirst && step <= w.candidateStepsLast) {
            const raw = resetWindowFrame(fresh.state.cfg, step,
              w.candidateStepsFirst, w.candidateStepsLast,
              priorCells, current.cells, current.genomeHead, oneStep);
            // Retain the triggering flag before a memory-cap stop.
            intervalFrames.push(raw); flags = raw.flags;
          }
          try {
            persistence.observeStep(step, current.cells, current.genomeHead, oneStep, flags);
          } catch (error) {
            if (String(error).includes("active-memory cap"))
              throw new ResetMemoryCapError(String(error));
            throw error;
          }
          audit.rebaseFromCurrentGpu(step);
          priorCells = current.cells;
          physical = current;
        }
        map = intervalMap;
      } else {
        audit.run(100);
        const [current, tagged, ledger] = await Promise.all([
          sim.readSnapshot(), audit.readSnapshot(), sim.drainLedger()]);
        if (ledger.dropped) throw new Error("original mutation ledger dropped events");
        physical = current;
        map = ResetOriginMap.fromSnapshot(tagged);
        const joined = joinResetMutationEvents(fresh.state.cfg,
          censusStep - 100, tagged, ledger.events);
        for (const m of joined) result.mutationLedger.effects[m.effect] =
          (result.mutationLedger.effects[m.effect] ?? 0) + 1;
        for (const event of ledger.events) {
          mutationHash.update(`${event.childHi}\t${event.childLo}\t${event.parentHi}\t${event.parentLo}\n`);
          result.mutationLedger.count++;
        }
        intervalEvents = ledger.events;
      }
      if (physical!.step !== censusStep || map.referenceStep !== censusStep - 100 ||
          map.currentStep !== censusStep)
        throw new Error("physical census and copy reference disagree");
      const observed = analysis.observeCensus(physical!, map, intervalEvents.length);
      for (const life of observed.life) { lifeHash.update(JSON.stringify(life) + "\n");
        result.lifeLedger.count++; }
      const c = observer.census;
      for (const lineage of c.lineages) {
        lineageHash.update(`${c.step}\t${lineage.key}\t${lineage.cells}\n`);
        result.lineageLedger.count++;
      }
      if (intervalFrames.length) {
        result.windows.frames.push(...resolveResetWindowInterval(
          intervalFrames, censusStep, observed.life));
        intervalFrames = [];
      }
      priorCensusFrame = physical!;
      intervalEvents = [];
      if (!perStep) audit.rebaseFromCurrentGpu(censusStep);
      if (history.checkpointSteps.includes(censusStep)) {
        const sourceRow = manifest.checkpoints.find((x: { step: number }) =>
          x.step === censusStep);
        const expected = preflight.checkpoints.find(x =>
          x.h === history.history && x.step === censusStep);
        if (!sourceRow || !expected || sourceRow.hash !== expected.physicsHash)
          throw new Error("original checkpoint schedule or hash changed");
        const checkpoint = source(sourceRow.file);
        const sourceBytes = await Deno.readFile(checkpoint.path);
        if (sourceBytes.length !== checkpoint.bytes || sha(sourceBytes) !== checkpoint.sha256)
          throw new Error("original checkpoint bytes changed during replay");
        const final = await sim.readState();
        observer.verifyCheckpoint(final, sourceBytes, { bytesSha256: checkpoint.sha256,
          physicsHash: expected.physicsHash, artifactDigest: expected.artifactHash });
        result.checkpointVerifications.push({ step: censusStep,
          physicsHash: stateHash(final),
          artifactDigest: artifactDigest(final, observer.observerState()),
          originalBytesSha256: checkpoint.sha256 });
        await refresh(); await args.checkOutputBudget();
      }
      if (censusStep % 10000 === 0) {
        await args.checkHostGpu(); checkTime();
      }
    }
    result.mutationLedger.replaySha256 = mutationHash.digest("hex");
    result.lifeLedger.replaySha256 = lifeHash.digest("hex");
    result.lineageLedger.replaySha256 = lineageHash.digest("hex");
    if (result.mutationLedger.replaySha256 !== mutationSource.sha256 ||
        result.lifeLedger.replaySha256 !== lifeSource.sha256 ||
        result.lineageLedger.replaySha256 !== lineageSource.sha256 ||
        result.checkpointVerifications.length !== 10 ||
        analysis.rows().length !== rows.length || persistence.results().some(x =>
          x.status !== "complete-100-future-samples"))
      throw new Error("original event streams, checkpoint schedule or fixed rows differ");
    checkTime();
    result.status = "running"; // caller authenticates all frozen files again before completion.
    await refresh();
    return result;
  } catch (error) {
    if (intervalFrames.length) {
      // An interrupted census has no authenticated tracker co-occurrence verdict.
      result.windows.frames.push(...intervalFrames.map(frame => ({ ...frame,
        trackerIntervalCooccurrence: "unavailable" as const })));
      intervalFrames = [];
    }
    result.status = error instanceof ResetTimeCapError ? "incomplete-time-cap" :
      error instanceof ResetMemoryCapError ? "incomplete-memory-cap" :
      error instanceof ResetOutputCapError ? "incomplete-output-cap" :
      String(error).includes("GPU worker") ? "incomplete-gpu-contention" :
      "failed-parity-or-source";
    result.error = error instanceof Error ? error.message : String(error);
    result.finishedAt = new Date().toISOString();
    try { await refresh(); }
    catch (saveError) {
      result.status = saveError instanceof ResetOutputCapError ?
        "incomplete-output-cap" : "incomplete-output-io";
      result.error = `could not replace the last valid partial snapshot: ${String(saveError)}`;
    }
    return result;
  } finally { audit?.destroy(); sim?.destroy(); }
}
