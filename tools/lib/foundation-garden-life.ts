/** Compact, in-situ observer capture for the registered solo garden controls. */
import { cellCount, type WorldState } from "@bl/schema";
import { Tracker, census, unb64 } from "@bl/metrics";
import type { ObserverState } from "@bl/runner";
import { parseSavedLifeEvent, type SavedLifeEvent } from "./foundation-life.ts";
import { frameAtCensus, labelDigest, overlappingPriorIdentities,
  type ObservedWindow } from "./foundation-lifecycle.ts";

export interface GardenLifeTrace {
  scope: "one-solo-garden-in-situ-observer-trace";
  status: "partial" | "complete";
  plannedEndStep: 3000;
  lastCapturedStep: number;
  window: ObservedWindow;
  unreconciledEvents: SavedLifeEvent[];
  analysis: null;
  limitations: [
    "tracker-identities-are-overlap-inferred",
    "baseline-roots-left-truncated-at-step-100",
    "physical-template-and-shared-pools-prevent-transmission-or-heritability-inference",
    "exact-component-membership-not-retained"
  ];
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const DEFAULT_OPT = { threshold: 48, minMass: 256 } as const;

/** Life rows arrive before the checkpoint at the same census step. No full state is retained. */
export class GardenLifeCapture {
  readonly window: ObservedWindow = { startStep: 100, endStep: 100,
    frames: [], life: [], trackerEvents: [], overlapMixing: [], censusDigests: [], membership: [] };
  private pendingLife: SavedLifeEvent[] = [];
  private lastStep = 0;
  private previousLabels: Int32Array | null = null;
  private previousIds = new Map<number, number>();
  private counts = { birth: 0, death: 0, fission: 0, fusion: 0, budding: 0 };

  acceptLifeText(text: string): void {
    for (const line of text.split("\n")) {
      if (!line) continue;
      const event = parseSavedLifeEvent(JSON.parse(line));
      const expected = this.lastStep + 100;
      if (event.step !== expected || event.step > 3000)
        throw new Error(`solo life event at ${event.step} outside pending census ${expected}`);
      this.pendingLife.push(event);
    }
  }

  acceptCheckpoint(state: WorldState, observer: ObserverState): void {
    const expected = this.lastStep + 100;
    if (state.step !== expected || state.step > 3000 || observer.step !== state.step ||
        observer.settings.censusEvery !== 100 || observer.settings.deepEvery !== 10 ||
        observer.tracker.opt.threshold !== DEFAULT_OPT.threshold ||
        observer.tracker.opt.minMass !== DEFAULT_OPT.minMass ||
        observer.censusIdx !== state.step / 100 || observer.mutations !== 0)
      throw new Error(`solo observer/checkpoint schedule or tracker settings mismatch at ${state.step}`);
    if (this.pendingLife.some((e) => e.step !== state.step) || (state.step === 100 && this.pendingLife.length))
      throw new Error(`solo event order mismatch at ${state.step}`);
    const tracked = Tracker.fromJSON(observer.tracker);
    const c = census({ cfg: state.cfg, step: state.step, cells: state.cells, genomeHead: state.genome });
    const savedLabels = observer.tracker.prevLabels;
    if (!savedLabels || !sameBytes(unb64(savedLabels), new Uint8Array(c.labels.buffer, c.labels.byteOffset, c.labels.byteLength)))
      throw new Error(`solo observer labels differ from decoded physics at ${state.step}`);
    const n = cellCount(state.cfg);
    if (c.labels.length !== n) throw new Error("solo component geometry mismatch");
    const overlapMixing = this.previousLabels ? overlappingPriorIdentities(
      this.previousLabels, this.previousIds, c, (idx) => tracked.idOf(idx), DEFAULT_OPT.minMass) : [];
    const frames = frameAtCensus(c, state.cells, state.cfg, tracked, 100);
    for (const event of this.pendingLife) this.counts[event.kind]++;
    if (observer.tracker.counts.birth !== this.counts.birth + this.counts.budding ||
        observer.tracker.counts.death !== this.counts.death ||
        observer.tracker.counts.fission !== this.counts.fission ||
        observer.tracker.counts.fusion !== this.counts.fusion || observer.buddings !== this.counts.budding)
      throw new Error(`solo life event counts disagree with observer at ${state.step}`);
    this.window.overlapMixing.push(...overlapMixing);
    this.window.life.push(...this.pendingLife);
    this.pendingLife = [];
    this.window.frames.push(...frames);
    this.window.censusDigests.push({ step: state.step, labelsSha256: labelDigest(c.labels),
      eligibleComponents: c.components.filter((component) => component.mass >= DEFAULT_OPT.minMass).length,
      trackedIndividuals: tracked.alive.size });
    this.previousLabels = c.labels;
    this.previousIds = new Map(c.components.flatMap((component) => {
      const id = tracked.idOf(component.idx);
      return id === undefined ? [] : [[component.idx, id] as [number, number]];
    }));
    this.lastStep = state.step;
    this.window.endStep = state.step;
  }

  trace(requireComplete = false): GardenLifeTrace {
    if (requireComplete && (this.lastStep !== 3000 || this.window.censusDigests.length !== 30 || this.pendingLife.length))
      throw new Error("solo garden lifecycle capture is incomplete");
    return { scope: "one-solo-garden-in-situ-observer-trace",
      status: this.lastStep === 3000 && !this.pendingLife.length ? "complete" : "partial",
      plannedEndStep: 3000, lastCapturedStep: this.lastStep,
      window: this.window, unreconciledEvents: [...this.pendingLife], analysis: null,
      limitations: ["tracker-identities-are-overlap-inferred", "baseline-roots-left-truncated-at-step-100",
        "physical-template-and-shared-pools-prevent-transmission-or-heritability-inference",
        "exact-component-membership-not-retained"] };
  }
}
