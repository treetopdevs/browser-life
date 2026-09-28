/** Compact original-observer capture for A2; never substitutes for copy-link evidence. */
import { cellCount, type WorldState } from "@bl/schema";
import { Tracker, census, unb64 } from "@bl/metrics";
import { decodeArtifact, type Sink } from "@bl/runner";
import { labelDigest, overlappingPriorIdentities } from "./foundation-lifecycle.ts";
import { ObservationHashSink, type FileDigest } from "./foundation-replay.ts";

export interface V2ObserverTrace {
  status: "partial" | "complete"; lastStep: number;
  series: Record<string, unknown>[]; life: Record<string, unknown>[];
  censuses: { step: number; labelsSha256: string; eligibleComponents: number;
    trackedIndividuals: number }[];
  overlapMixing: ReturnType<typeof overlappingPriorIdentities>;
  observationFiles: Record<string, FileDigest> | null;
  selectedObserverIdentity: { step: number; componentIndex: number; trackerId: number | null;
    finalStatus: "alive" | "death-event" | "fusion-event" | "missing" | "unavailable" } | null;
  limitations: string[];
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length &&
  a.every((v, i) => v === b[i]);

export class V2ObserverSink implements Sink {
  private readonly observed = new ObservationHashSink();
  private finalDigest: Record<string, FileDigest> | null = null;
  private lastStep = 0;
  private previousLabels: Int32Array | null = null;
  private previousIds = new Map<number, number>();
  private readonly series: Record<string, unknown>[] = [];
  private readonly life: Record<string, unknown>[] = [];
  private readonly censuses: V2ObserverTrace["censuses"] = [];
  private readonly mixing: V2ObserverTrace["overlapMixing"] = [];
  private selectedTrackerId: number | null = null;
  private lastAlive = new Set<number>();
  constructor(private readonly check: (where: string) => void,
    private readonly expectedAtStep?: (state: WorldState) => void,
    private readonly selected?: { step: number; componentIndex: number }) {}

  async writeText(name: string, content: string): Promise<void> {
    this.check(`observer write ${name}`); await this.observed.writeText(name, content);
  }
  async appendText(name: string, content: string): Promise<void> {
    this.check(`observer append ${name}`); await this.observed.appendText(name, content);
    if (name !== "series.jsonl" && name !== "life.jsonl") return;
    for (const line of content.split("\n")) if (line) {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (!Number.isSafeInteger(row.step) || (row.step as number) <= 0 ||
          (row.step as number) > 3000 || (row.step as number) % 25 !== 0)
        throw new Error(`A2 ${name} has invalid census step`);
      if (name === "series.jsonl") {
        if (row.step !== (this.series.length + 1) * 25 || row.conservationOk !== true ||
            row.mutations !== 0) throw new Error("A2 series census violates cadence/conservation/mutation off");
        this.series.push(row);
      } else this.life.push(row);
    }
  }
  async writeBytes(name: string, bytes: Uint8Array): Promise<void> {
    this.check(`observer checkpoint ${name}`);
    const { state, observer } = decodeArtifact(bytes);
    if (!name.startsWith("checkpoints/") || state.step !== this.lastStep + 25 ||
        observer.step !== state.step || observer.settings.censusEvery !== 25 ||
        observer.settings.deepEvery !== 40 || observer.mutations !== 0 ||
        observer.tracker.opt.threshold !== 48 || observer.tracker.opt.minMass !== 256)
      throw new Error("A2 observer checkpoint schedule or settings mismatch");
    this.expectedAtStep?.(state);
    const n = cellCount(state.cfg), c = census({ cfg: state.cfg, step: state.step,
      cells: state.cells, genomeHead: state.genome.subarray(0, 4 * n) });
    const savedLabels = observer.tracker.prevLabels;
    if (!savedLabels || !sameBytes(unb64(savedLabels), new Uint8Array(c.labels.buffer,
      c.labels.byteOffset, c.labels.byteLength)))
      throw new Error("A2 original observer labels disagree with checkpoint physics");
    const tracker = Tracker.fromJSON(observer.tracker);
    if (this.selected && state.step === this.selected.step) {
      if (!c.components[this.selected.componentIndex])
        throw new Error("A2 selected packet component absent from original observer census");
      this.selectedTrackerId = tracker.idOf(this.selected.componentIndex) ?? null;
    }
    this.lastAlive = new Set(tracker.alive.keys());
    if (this.previousLabels)
      this.mixing.push(...overlappingPriorIdentities(this.previousLabels, this.previousIds,
        c, (idx) => tracker.idOf(idx), 256));
    this.previousLabels = c.labels;
    this.previousIds = new Map(c.components.flatMap((component) => {
      const id = tracker.idOf(component.idx);
      return id === undefined ? [] : [[component.idx, id] as [number, number]];
    }));
    this.censuses.push({ step: state.step, labelsSha256: labelDigest(c.labels),
      eligibleComponents: c.components.filter((x) => x.mass >= 256).length,
      trackedIndividuals: tracker.alive.size });
    this.lastStep = state.step;
    await this.observed.writeBytes();
  }
  result(requireComplete = false): V2ObserverTrace {
    const complete = this.lastStep === 3000 && this.censuses.length === 120 &&
      this.series.length === 120;
    if (requireComplete && !complete) throw new Error("A2 observer trace incomplete");
    if (complete) this.finalDigest ??= this.observed.digest();
    const selectedObserverIdentity = this.selected ? { step: this.selected.step,
      componentIndex: this.selected.componentIndex, trackerId: this.selectedTrackerId,
      finalStatus: this.selectedTrackerId === null ? "unavailable" as const :
        this.lastAlive.has(this.selectedTrackerId) ? "alive" as const :
        this.life.some((row) => row.kind === "death" && row.id === this.selectedTrackerId) ?
          "death-event" as const :
        this.life.some((row) => row.kind === "fusion" && (row.child === this.selectedTrackerId ||
          Array.isArray(row.parents) && row.parents.includes(this.selectedTrackerId))) ?
          "fusion-event" as const : "missing" as const } : null;
    return { status: complete ? "complete" : "partial", lastStep: this.lastStep,
      series: [...this.series], life: [...this.life], censuses: [...this.censuses],
      overlapMixing: [...this.mixing], observationFiles: this.finalDigest, selectedObserverIdentity,
      limitations: ["Observer IDs are overlap-inferred labels, not genome-copy parents.",
        "Twenty-five-step censuses can miss intervening topology changes.",
        "Selected source-garden fate is observer-identity continuity, not genetic-copy survival."] };
  }
}
