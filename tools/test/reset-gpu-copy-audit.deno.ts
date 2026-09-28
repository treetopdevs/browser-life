/** Opt-in native WebGPU control; not part of the portable Vitest suite. */
import { createHash } from "node:crypto";
import { CH, GENOME_CHANNELS, allocState, cellCount, cloneState, defaultConfig,
  encodeGenome, generalistGenome, stateHash, type WorldState } from "@bl/schema";
import { RefSim, type MutationEvent } from "@bl/sim-ref";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { ResetCopyLedger } from "../lib/reset-copy-ledger.ts";
import { diagnosticWord, ResetGpuCopyAudit } from "../lib/reset-gpu-copy-audit.ts";
import { joinResetMutationEvents } from "../lib/reset-gpu-event-join.ts";

function world(): WorldState {
  const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
    kernelRadius: 2, seed: 17, mutRate: 0xffffffff, lightMode: "uniform" as const,
    lightBase: 0, lightAmp: 255, kPhoto: 4096, kGrow: 4096, kCost: 0, kMaint: 0 };
  const state = allocState(cfg), n = cellCount(cfg);
  const words = encodeGenome(generalistGenome(cfg.defaultMu, cfg.defaultSigma), 0, 1);
  for (let i = 0; i < n; i++) state.cells[CH.A * n + i] = 256;
  for (const i of [0, 1]) {
    state.cells[CH.B * n + i] = 64;
    state.cells[CH.E * n + i] = 1000;
    for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + i] = words[g];
  }
  return state;
}

function minorityWorld(): WorldState {
  const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
    kernelRadius: 2, seed: 2, spread: 20, mutRate: 0xffffffff };
  const state = allocState(cfg), n = cellCount(cfg);
  for (let i = 0; i < n; i++) {
    state.cells[CH.A * n + i] = 32;
    state.cells[CH.MOT * n + i] = 128 | (128 << 8);
  }
  for (const [i, B, lo] of [[0, 1000, 1], [1, 300, 2]]) {
    state.cells[CH.B * n + i] = B;
    state.cells[CH.E * n + i] = 150;
    const words = encodeGenome(generalistGenome(cfg.defaultMu, cfg.defaultSigma), 0, lo);
    for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + i] = words[g];
  }
  return state;
}

function referenceStep(sim: RefSim): { before: WorldState; after: WorldState;
  displacement: Uint32Array; events: MutationEvent[] } {
  const before = cloneState(sim.state);
  const phases = sim as unknown as { affinity(): void; flow(): void; transport(): void;
    react(): { events: MutationEvent[] }; disp: Uint32Array };
  phases.affinity(); phases.flow();
  const displacement = phases.disp.slice();
  phases.transport(); const { events } = phases.react(); sim.state.step++;
  return { before, after: cloneState(sim.state), displacement, events };
}

async function fileIdentity(path: string) {
  const bytes = await Deno.readFile(path);
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

Deno.test("passive GPU audit matches exact reference lottery and leaves mutation-enabled physics unchanged", async () => {
  const startedAt = new Date().toISOString(), start = performance.now();
  const initial = world(), n = cellCount(initial.cfg);
  const device = await requestDevice(navigator.gpu);
  const gpu = await GpuSim.create(device, cloneState(initial));
  const twin = await GpuSim.create(device, cloneState(initial));
  const audit = await ResetGpuCopyAudit.create(gpu, initial);
  const ref = new RefSim(cloneState(initial)), cpu = new ResetCopyLedger(initial);
  const all = Array.from({ length: n }, (_, i) => i);
  let mutationCount = 0, comparedSites = 0;
  try {
    const first = referenceStep(ref);
    const firstExpected = cpu.observeStep(first.before, first.after, first.events,
      { displacement: first.displacement, record: all });
    mutationCount += first.events.length;
    audit.run(1);
    const observed = await audit.readSnapshot();
    const firstActual = await gpu.readState();
    if (stateHash(firstActual) !== stateHash(first.after))
      throw new Error("passive GPU and RefSim full physics/genome differ at step 1");
    for (const row of firstExpected.observedCells) {
      const i = row.index, d = observed.diagnostics;
      const winner = diagnosticWord(d, n, 0, i);
      const source = winner === 0xffffffff ? null : winner;
      if (source !== row.winnerSourceIndex ||
          diagnosticWord(d, n, 1, i) !== row.incoming.B ||
          diagnosticWord(d, n, 2, i) !== row.incoming.P ||
          diagnosticWord(d, n, 3, i) !== row.incoming.E ||
          observed.tags[i] !== (row.copySource ? row.copySource.cellIndex + 1 : 0))
        throw new Error(`passive GPU source/share/tag differs from reference at ${i}`);
      comparedSites++;
    }
    // Four exact reference steps, then four interleaved physical/passive GPU steps in one batch.
    for (let k = 0; k < 4; k++) {
      const step = referenceStep(ref);
      cpu.observeStep(step.before, step.after, step.events,
        { displacement: step.displacement, record: [] });
      mutationCount += step.events.length;
    }
    audit.run(4);
    const finalReference = cloneState(ref.state);
    if (finalReference.step !== 5) throw new Error("reference did not reach five steps");
    const finalTags = await audit.readSnapshot();
    for (let i = 0; i < n; i++) {
      const source = cpu.tagAt(i);
      if (finalTags.tags[i] !== (source ? source.cellIndex + 1 : 0))
        throw new Error(`batched passive tag differs from continuous reference at ${i}`);
    }
    twin.run(5);
    const [physical, uninstrumented, passiveEvents, twinEvents] = await Promise.all([
      gpu.readState(), twin.readState(), gpu.drainLedger(), twin.drainLedger(),
    ]);
    if (stateHash(physical) !== stateHash(uninstrumented) ||
        stateHash(physical) !== stateHash(finalReference) ||
        JSON.stringify(passiveEvents.events) !== JSON.stringify(twinEvents.events))
      throw new Error("passive audit altered full GPU physics or mutation ledger");
    const joined = joinResetMutationEvents(initial.cfg, 0, finalTags, passiveEvents.events);
    if (joined.length !== passiveEvents.events.length ||
        joined.some(row => row.childStep < 5 && row.effect !== "unavailable-earlier-step"))
      throw new Error("mutation join invented unavailable earlier genotype effects");
    const pendingRead = audit.readSnapshot();
    audit.run(1);
    const priorSnapshot = await pendingRead;
    if (priorSnapshot.step !== 5 ||
        priorSnapshot.tags.some((tag, i) => tag !== finalTags.tags[i]))
      throw new Error("passive readback was relabeled after a concurrent later step");
    await device.queue.onSubmittedWorkDone();
    const sixth = referenceStep(ref);
    const sixthActual = await gpu.readState();
    if (stateHash(sixth.after) !== stateHash(sixthActual))
      throw new Error("readback-race step changed physics");
    let wrongStepRejected = false;
    try { audit.rebaseFromCurrentGpu(5); }
    catch { wrongStepRejected = true; }
    if (!wrongStepRejected) throw new Error("GPU rebase accepted a wrong expected step");
    const strictSim = await GpuSim.create(device, cloneState(sixthActual));
    const strictAudit = await ResetGpuCopyAudit.create(strictSim, sixthActual);
    await strictAudit.resetToPhysicalCensus(sixthActual);
    audit.rebaseFromCurrentGpu(6);
    const rebased = new ResetCopyLedger(sixthActual);
    const seventh = referenceStep(ref);
    rebased.observeStep(seventh.before, seventh.after, seventh.events,
      { displacement: seventh.displacement, record: [] });
    audit.run(1);
    strictAudit.run(1);
    const resetSnapshot = await audit.readSnapshot();
    const strictSnapshot = await strictAudit.readSnapshot();
    if (resetSnapshot.referenceStep !== 6 || resetSnapshot.step !== 7 ||
        resetSnapshot.tags.some((tag, i) => {
          const source = rebased.tagAt(i);
          return tag !== (source ? source.cellIndex + 1 : 0);
        }) || resetSnapshot.tags.some((tag, i) => tag !== strictSnapshot.tags[i]))
      throw new Error("authenticated physical-census tag reset differs from reference");
    if (stateHash(await gpu.readState()) !== stateHash(seventh.after) ||
        stateHash(await strictSim.readState()) !== stateHash(seventh.after))
      throw new Error("census tag reset changed physical dynamics");
    strictAudit.destroy(); strictSim.destroy();
    const raceSim = await GpuSim.create(device, cloneState(sixthActual));
    const raceAudit = await ResetGpuCopyAudit.create(raceSim, sixthActual);
    try {
      let release!: () => void;
      const gate = new Promise<void>(resolve => release = resolve);
      raceSim.readState = async () => { await gate; return cloneState(sixthActual); };
      const pending = raceAudit.resetToPhysicalCensus(sixthActual);
      raceAudit.run(1);
      release();
      let staleResetRejected = false;
      try { await pending; } catch { staleResetRejected = true; }
      if (!staleResetRejected)
        throw new Error("strict reset accepted an old census after a concurrent physical step");
      await device.queue.onSubmittedWorkDone();
    } finally { raceAudit.destroy(); raceSim.destroy(); }
    const minorityInitial = minorityWorld();
    const minorityRef = referenceStep(new RefSim(cloneState(minorityInitial)));
    const minorityGpu = await GpuSim.create(device, cloneState(minorityInitial));
    const minorityAudit = await ResetGpuCopyAudit.create(minorityGpu, minorityInitial);
    try {
      minorityAudit.run(1);
      const minoritySnap = await minorityAudit.readSnapshot();
      const minorityCpu = new ResetCopyLedger(minorityInitial).observeStep(
        minorityRef.before, minorityRef.after, minorityRef.events,
        { displacement: minorityRef.displacement, record: [57] }).observedCells[0];
      const source = diagnosticWord(minoritySnap.diagnostics, n, 0, 57);
      if (source !== 0 || minorityCpu.winnerSourceIndex !== 0 ||
          minorityCpu.sourceShares.find(s => s.sourceIndex === 0)?.B !== 31 ||
          minorityCpu.sourceShares.find(s => s.sourceIndex === 1)?.B !== 35 ||
          diagnosticWord(minoritySnap.diagnostics, n, 1, 57) !== minorityCpu.incoming.B ||
          diagnosticWord(minoritySnap.diagnostics, n, 2, 57) !== minorityCpu.incoming.P ||
          diagnosticWord(minoritySnap.diagnostics, n, 3, 57) !== minorityCpu.incoming.E ||
          stateHash(await minorityGpu.readState()) !== stateHash(minorityRef.after))
        throw new Error("GPU passive minority-material lottery differs from reference");
    } finally { minorityAudit.destroy(); minorityGpu.destroy(); }
    const elapsedMs = performance.now() - start;
    const output = `runs/foundational-reset/gpu-passive-control-${Date.now()}.json`;
    await Deno.mkdir("runs/foundational-reset", { recursive: true });
    const receipt = { status: "passed-development-control", startedAt,
      finishedAt: new Date().toISOString(), elapsedMs, deviceAdapter: "native-WebGPU",
      comparedPhysicalSteps: 5, extraReadbackRaceStep: 1,
      extraEventLocalResetStep: 1, minorityWinnerControl: true,
      strictResetRaceRejected: true,
      joinedMutationEvents: joined.length, comparedSites, mutationCount,
      initialStateHash: stateHash(initial), finalStateHash: stateHash(physical),
      sourceFiles: await Promise.all([
        "packages/sim-gpu/src/gpu-sim.ts", "packages/sim-gpu/src/shaders.ts",
        "tools/lib/reset-gpu-copy-audit.ts", "tools/lib/reset-copy-ledger.ts",
        "tools/lib/reset-gpu-event-join.ts",
        "tools/test/reset-gpu-copy-audit.deno.ts",
      ].map(fileIdentity)),
      limitations: ["synthetic 8x8 development control, not historical Test 1 evidence",
        "transient mutation events require ledger join after reaction"] };
    await Deno.writeTextFile(output, JSON.stringify(receipt, null, 2) + "\n", { createNew: true });
    console.log(output);
  } finally { audit.destroy(); gpu.destroy(); twin.destroy(); }
});
