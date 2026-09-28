/** One bounded A2 garden on the unchanged simulator and runner. */
import { createHash } from "node:crypto";
import { CH, G, artifactDigest, cellCount, cloneState, stateHash, type WorldState } from "@bl/schema";
import { census } from "@bl/metrics";
import { runExperiment, type HostInfo } from "@bl/runner";
import { GpuSim } from "@bl/sim-gpu";
import { colorLivingSources, assertColorTwinParity, type ColorSnapshot } from
  "./foundation-copy-ancestry.ts";
import { buildSerialV2Frame } from "./foundation-serial-v2-frame.ts";
import { V2ParityTranscript } from "./foundation-serial-v2-parity.ts";
import { selectFirstCopyLinkedTransition, type CopyTransitionFrame,
  type V2Selection } from "./foundation-serial-v2-selection.ts";
import { V2ObserverSink, type V2ObserverTrace } from "./foundation-serial-v2-observe.ts";
import { boundIncorporationAccounting, serialInventory } from "./foundation-serial-transfer.ts";
import { runReferenceReplay, type ReferenceResult } from "./foundation-sensitivity.ts";
import { ObservationHashSink } from "./foundation-replay.ts";
import { assertShamMatch } from "../foundation-transplant-pilot.ts";
import { exciseCellPacket, extractCellPacket, restoreCellPacket,
  type CellPacket, type Inventory } from "./foundation-transplant.ts";
import { packetBoundAccounting, type V2Start } from "./foundation-serial-v2.ts";

export interface V2GardenOutcome {
  status: "complete"; arm: V2Start["arm"]; stage: V2Start["stage"]; seed: number;
  initialStateHash: string; measuredPhysicsHash: string; measuredArtifactHash: string;
  terminalTwinPhysicsHash: string | null; conservationOk: true; mutations: 0;
  initialInventory: ReturnType<typeof serialInventory>;
  finalInventory: ReturnType<typeof serialInventory>;
  incorporatedBoundMatterLowerBound: string;
  sham: ReturnType<typeof assertShamMatch> | null;
  reference: ReferenceResult;
  colorParity: ReturnType<V2ParityTranscript["finish"]> | null;
  selection: V2Selection | null; selectedPacket: CellPacket | null;
  selectedPacketError: string | null;
  incomingPacketInventory: Inventory | null; selectedOutgoingPacketInventory: Inventory | null;
  packetBoundIncorporationLowerBound: string | null;
  packetBoundEvidence: "unavailable-no-packet" | "zero-lower-bound" | "positive-lower-bound";
  organizationReconstruction: { status: "unavailable"; reason: string };
  ageAccounting: { timeSincePlacementAtSelection: number | null;
    timeSinceDetectedSeparationAtExtraction: 0 | null; biologicalBirthAge: null };
  frameDigests: { step: number; stateHashSha256: string; copyMapSha256: string;
    separationEvidenceSha256: string; framePayloadSha256: string; components: number }[];
  frameCertificates: CopyTransitionFrame[];
  observer: V2ObserverTrace;
  limitations: string[];
}

const snapOf = (x: Awaited<ReturnType<GpuSim["readSnapshot"]>>): ColorSnapshot =>
  ({ step: x.step, cells: x.cells, genomeHead: x.genomeHead, flux: x.flux });
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

export async function runV2Garden(device: GPUDevice, start: V2Start, host: HostInfo,
  check: (where: string) => void,
  progress: (row: { step: number; phase: string; selectionStatus?: string }) => Promise<void> = async () => {},
): Promise<V2GardenOutcome> {
  check(`before ${start.arm} sham`);
  let sham: V2GardenOutcome["sham"] = null;
  if (start.inoculum) {
    const restored = restoreCellPacket(exciseCellPacket(start.state, start.inoculum), start.inoculum);
    if (stateHash(restored) !== start.initialStateHash)
      throw new Error("A2 exact extraction/reinsertion sham changed initial physics");
    const short = { ...start.spec, steps: 25, checkpointEvery: 0 };
    const controlSink = new ObservationHashSink(), restoredSink = new ObservationHashSink();
    const control = await runExperiment(device, short, controlSink, host,
      () => check(`sham control ${start.arm}`), { start: cloneState(start.state), keepFinal: true });
    const restoredRun = await runExperiment(device, short, restoredSink, host,
      () => check(`sham restored ${start.arm}`), { start: restored, keepFinal: true });
    if (control.summary.mutations !== 0 || restoredRun.summary.mutations !== 0)
      throw new Error("A2 sham mutated under mutation-off configuration");
    sham = assertShamMatch(control, restoredRun, controlSink.digest(), restoredSink.digest(), 25);
  }
  check(`after ${start.arm} sham`);
  let selection: V2Selection | null = null, selectedPacket: CellPacket | null = null;
  let selectedPacketError: string | null = null, colorParity: V2GardenOutcome["colorParity"] = null;
  let terminalTwinPhysicsHash: string | null = null;
  const frameDigests: V2GardenOutcome["frameDigests"] = [], expected = new Map<number, string>();
  const frames: CopyTransitionFrame[] = [];
  if (start.inoculum) {
    const twin = colorLivingSources(start.state);
    if (!twin.colors.length) throw new Error("A2 inoculated garden has no initial living copy colors");
    const transcript = new V2ParityTranscript();
    let plain: GpuSim | undefined, colored: GpuSim | undefined;
    try {
      plain = await GpuSim.create(device, cloneState(start.state));
      colored = await GpuSim.create(device, twin.state);
      const initial = await Promise.all([plain.readSnapshot(), colored.readSnapshot()]);
      transcript.observe(snapOf(initial[0]), snapOf(initial[1]));
      let previousColored = twin.state;
      for (let step = 1; step <= 1000; step++) {
        check(`A2 twin before ${start.arm} step ${step}`);
        plain.run(1); colored.run(1);
        const read = await Promise.all([plain.readSnapshot(), colored.readSnapshot()]);
        transcript.observe(snapOf(read[0]), snapOf(read[1]));
        if (step % 25 !== 0) continue;
        const [plainState, coloredState] = await Promise.all([plain.readState(), colored.readState()]);
        assertColorTwinParity(plainState, coloredState);
        const frame = buildSerialV2Frame(previousColored, coloredState, plainState,
          twin.colors, transcript.snapshot());
        frames.push(frame); previousColored = coloredState;
        expected.set(step, stateHash(plainState));
        frameDigests.push({ step, stateHashSha256: frame.currentStateHash,
          copyMapSha256: frame.copyMapSha256,
          separationEvidenceSha256: frame.separationEvidenceSha256,
          framePayloadSha256: createHash("sha256").update(JSON.stringify(frame)).digest("hex"),
          components: frame.components.length });
        const now = selectFirstCopyLinkedTransition({ sourceKey: "m4/gradient-m3/treatment/seed-1",
          arm: start.arm as "donor" | "founder-genotype" | "zero-controller-genotype",
          stage: start.stage, seed: start.seed }, frames);
        if (!selection?.selected && now.selected) {
          const c = census({ cfg: plainState.cfg, step: plainState.step,
            cells: plainState.cells, genomeHead: plainState.genome });
          const indices: number[] = [];
          for (let i = 0; i < c.labels.length; i++)
            if (c.labels[i] === now.selected.componentIndex) indices.push(i);
          try { selectedPacket = extractCellPacket(plainState, indices); }
          catch (e) { selectedPacketError = errorText(e); }
        }
        selection = now;
        await progress({ step, phase: "copy-census", selectionStatus: selection.status });
      }
      colorParity = transcript.finish();
      colored.destroy(); colored = undefined;
      for (let step = 1000; step < 3000;) {
        check(`A2 twin terminal continuation ${start.arm} at ${step}`);
        const count = Math.min(100, 3000 - step); plain.run(count);
        await device.queue.onSubmittedWorkDone(); step += count;
      }
      const final = await plain.readState();
      const ledger = await plain.drainLedger();
      if (final.step !== 3000 || ledger.dropped || ledger.events.length)
        throw new Error("A2 terminal twin continuation incomplete or mutated");
      terminalTwinPhysicsHash = stateHash(final);
    } finally { plain?.destroy(); colored?.destroy(); }
  }
  check(`before ${start.arm} original observer`);
  const sink = new V2ObserverSink(check, (state) => {
    const known = expected.get(state.step);
    if (known && stateHash(state) !== known)
      throw new Error(`A2 original runner differs from copy twin at step ${state.step}`);
    if (selection?.selected?.step === state.step) {
      const c = census({ cfg: state.cfg, step: state.step,
        cells: state.cells, genomeHead: state.genome });
      const indices: number[] = [];
      for (let i = 0; i < c.labels.length; i++)
        if (c.labels[i] === selection.selected.componentIndex) indices.push(i);
      try {
        const packet = extractCellPacket(state, indices);
        if (!selectedPacket || packet.sha256 !== selectedPacket.sha256 || selectedPacketError)
          throw new Error("A2 runner-selected packet differs from twin selection");
      } catch (error) {
        if (!selectedPacketError || errorText(error) !== selectedPacketError)
          throw new Error("A2 runner-selected extraction failure differs from twin");
      }
    }
  }, selection?.selected ? { step: selection.selected.step,
    componentIndex: selection.selected.componentIndex } : undefined);
  const measured = await runExperiment(device, start.spec, sink, host,
    () => check(`A2 measured ${start.arm}`), { start: cloneState(start.state), keepFinal: true });
  if (!measured.final || measured.final.step !== 3000 || !measured.summary.conservationOk ||
      measured.summary.mutations !== 0 || terminalTwinPhysicsHash &&
      stateHash(measured.final) !== terminalTwinPhysicsHash)
    throw new Error("A2 measured garden incomplete, nonconserving, mutated or differs from twin");
  const observer = sink.result(true);
  const measuredPhysicsHash = stateHash(measured.final);
  const ref = await GpuSim.create(device, cloneState(start.state));
  let reference: ReferenceResult;
  try { reference = await runReferenceReplay({ run: (count) => ref.run(count),
      settle: () => device.queue.onSubmittedWorkDone(), drainLedger: () => ref.drainLedger(),
      readState: () => ref.readState() }, 0, 3000, measuredPhysicsHash, check); }
  finally { ref.destroy(); }
  if (!reference.matchedMeasured || reference.drainedMutationEvents !== 0 ||
      reference.droppedMutationEvents !== 0)
    throw new Error("A2 unsampled physics reference mismatch or mutation events");
  const accounting = start.inoculum ?
    boundIncorporationAccounting(start.state, measured.final, start.inoculum) :
    { initial: serialInventory(start.state), final: serialInventory(measured.final),
      incorporatedBoundMatterLowerBound: "0" };
  if (JSON.stringify(accounting.initial) !== JSON.stringify(start.initialInventory))
    throw new Error("A2 initial resource accounting differs from frozen start");
  const packetBound = packetBoundAccounting(start.inoculum?.inventory ?? null,
    selectedPacket?.inventory ?? null);
  return { status: "complete", arm: start.arm, stage: start.stage, seed: start.seed,
    initialStateHash: start.initialStateHash, measuredPhysicsHash,
    measuredArtifactHash: artifactDigest(measured.final, measured.observer),
    terminalTwinPhysicsHash, conservationOk: true, mutations: 0,
    initialInventory: accounting.initial, finalInventory: accounting.final,
    incorporatedBoundMatterLowerBound: accounting.incorporatedBoundMatterLowerBound,
    sham, reference, colorParity, selection, selectedPacket, selectedPacketError,
    incomingPacketInventory: start.inoculum?.inventory ?? null,
    selectedOutgoingPacketInventory: selectedPacket?.inventory ?? null,
    packetBoundIncorporationLowerBound: packetBound.lowerBound,
    packetBoundEvidence: packetBound.status,
    organizationReconstruction: { status: "unavailable",
      reason: "No calibrated informative non-mass trait and attribution to newly built packet structure are fixed for this pilot." },
    ageAccounting: { timeSincePlacementAtSelection: selection?.selected?.step ?? null,
      timeSinceDetectedSeparationAtExtraction: selection?.selected ? 0 : null,
      biologicalBirthAge: null },
    frameDigests, frameCertificates: frames, observer,
    limitations: ["Selection uses conservative physical separation, not immediate genetic parenthood.",
      "Old material flow after reaction and selected-packet newly built structure remain unavailable.",
      "Selected source-garden fate is observer identity continuity only."] };
}
