/** State-fed, assay-side serial-transfer observation. This module never advances physics. */
import { createHash } from "node:crypto";
import { canonicalConfig, cellCount, type WorldState } from "@bl/schema";
import { Tracker, census, type Census, type LifeEvent } from "@bl/metrics";
import { frameAtCensus, labelDigest, memberRanges, overlappingPriorIdentities,
  type OverlapMixing, type TrajectoryFrame } from "./foundation-lifecycle.ts";
import { extractCellPacket, type CellPacket } from "./foundation-transplant.ts";

export const SERIAL_CADENCE = 25;
export const SERIAL_SENSITIVITY_CADENCE = 100;
export const SERIAL_HORIZON = 3000;
export const SERIAL_RECRUITMENT_END = 1000;
export const SERIAL_SELECTION_SALT = "foundation-serial-transfer-v1";
export const SERIAL_MATCHED_AGES = [0, 100, 200, 500] as const;
export const SERIAL_CENSUS = { threshold: 48, minMass: 256 } as const;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export type ImportedFragmentEvidence = { kind: "evolved-source-unknown-age" } |
  { kind: "standard-founder-disc"; founderIndex: 9 } | {
  kind: "selected-observer-child";
  sourceGardenId: string;
  sourceCycle: 0 | 1;
  sourceStep: number;
  parentTrackerId: number;
  childTrackerId: number;
  packetSha256: string;
  /** Selected immediately at the observed fission census, not biological birth. */
  ageSinceObservedFissionAtPlacement: 0;
};
export interface SerialCaptureIdentity {
  sourceKey: string; arm: "donor" | "founder" | "zero-controller";
  cycle: 0 | 1 | 2; seed: number;
  importedFragment: ImportedFragmentEvidence;
}
export interface SerialCandidate {
  step: number; parentId: number; childId: number; componentIndex: number | null;
  mass: number | null; topologyEligible: boolean; rejectionReasons: string[];
  disposition: "rejected" | "selected-packet-valid" | "selected-packet-invalid" |
    "eligible-not-selected" | "eligible-after-selection";
  selectionSha256: string | null; packetSha256: string | null; packetError: string | null;
}
export interface SerialSelection { status: "none" | "packet-valid" | "packet-invalid";
  step: number | null; childId: number | null; componentIndex: number | null;
  selectionSha256: string | null; packetSha256: string | null; packetError: string | null }
export interface SerialSelectionVisibility100 {
  step: number; fineChildId: number; fineComponentIndex: number | null;
  coarseChildId: number | null; coarseRootId: number | null;
  status: "direct-root-fission" | "birth" | "retained-coarse-identity" | "absent" | "ambiguous";
  ambiguity: string | null;
}
export interface SerialVisibilityUnavailable {
  status: "unavailable"; reason: "no-selection" | "shared-census-not-yet-observed";
}
export interface SerialFate { status: "death" | "fusion" | "overlap-mixed" | "alive-at-horizon" |
  "right-censored" | "missing" | "not-introduced"; step: number | null }
export interface SerialMorphology {
  subject: "imported-root" | "selected-source-child";
  targetAgeSinceTransferOrSelection: number;
  targetStep: number;
  /** The garden's elapsed physical time since the inoculum was placed at step 0. */
  timeSincePlacement: number;
  /** Imported-root identity predates transfer; the observer cannot infer its organism age. */
  observerIdentityAge: number | null;
  /** Cycle 0 unknown; transferred source-child clock starts at its observed split census. */
  importedFragmentAgeSinceObservedFission: number | null;
  /** Physical/biological age remains unknown after either split or placement. */
  biologicalAge: null;
  status: "observed" | "death" | "fusion" | "overlap-mixed" | "right-censored" | "missing";
  frame: TrajectoryFrame | null;
  memberRanges: [number, number][] | null;
}
export interface SerialCaptureResult {
  format: "foundation-serial-capture/v1"; identity: SerialCaptureIdentity;
  schedule: { firstStep: 0; lastObservedStep: number; fineEvery: 25; coarseEvery: 100;
    horizon: 3000; recruitmentEnd: 1000; threshold: 48; minMass: 256 };
  complete: boolean; root: { status: "one-eligible" | "unavailable"; id25: number | null;
    id100: number | null; eligibleAtStep0: number; disqualifiedAt: number | null;
    disqualificationReason: "death" | "fusion" | "overlap-mixed" | null };
  selection: SerialSelection; selectionVisibility100: SerialSelectionVisibility100 | SerialVisibilityUnavailable;
  candidates: SerialCandidate[];
  events25: LifeEvent[]; events100: LifeEvent[];
  overlapMixing25: OverlapMixing[]; overlapMixing100: OverlapMixing[];
  censuses25: { step: number; labelsSha256: string; eligibleComponents: number;
    trackedIndividuals: number }[];
  censuses100: { step: number; labelsSha256: string; eligibleComponents: number;
    trackedIndividuals: number }[];
  rootSourceFate: SerialFate; selectedChildSourceFate: SerialFate;
  morphology: SerialMorphology[];
  limitations: string[];
}

interface RecordedMorphology { frame: TrajectoryFrame; memberRanges: [number, number][] }
type EventFate = { status: "death" | "fusion" | "overlap-mixed"; step: number };
const emptySelection = (): SerialSelection => ({ status: "none", step: null, childId: null,
  componentIndex: null, selectionSha256: null, packetSha256: null, packetError: null });

/** One instance per garden. observe() must receive exact immutable states at 0,25,...,3000. */
export class SerialGardenCapture {
  readonly identity: SerialCaptureIdentity;
  private readonly fine = new Tracker(SERIAL_CENSUS);
  private readonly coarse = new Tracker(SERIAL_CENSUS);
  private configCanonical: string | null = null;
  private lastStep = -SERIAL_CADENCE;
  private priorFine: { labels: Int32Array; ids: Map<number, number> } | null = null;
  private priorCoarse: { labels: Int32Array; ids: Map<number, number> } | null = null;
  private rootId25: number | null = null;
  private rootId100: number | null = null;
  private eligibleAtStep0 = 0;
  private rootDisqualification: EventFate | null = null;
  private childSourceFate: EventFate | null = null;
  private packet: CellPacket | null = null;
  private selection: SerialSelection = emptySelection();
  private visibility100: SerialSelectionVisibility100 | null = null;
  private readonly candidates: SerialCandidate[] = [];
  private readonly events25: LifeEvent[] = [];
  private readonly events100: LifeEvent[] = [];
  private readonly mixing25: OverlapMixing[] = [];
  private readonly mixing100: OverlapMixing[] = [];
  private readonly censuses25: SerialCaptureResult["censuses25"] = [];
  private readonly censuses100: SerialCaptureResult["censuses100"] = [];
  private readonly rootMorph = new Map<number, RecordedMorphology>();
  private readonly childMorph = new Map<number, RecordedMorphology>();

  constructor(identity: SerialCaptureIdentity) {
    const imported = identity.importedFragment;
    const transferred = imported?.kind === "selected-observer-child";
    if (!identity.sourceKey || !["donor", "founder", "zero-controller"].includes(identity.arm) ||
        ![0, 1, 2].includes(identity.cycle) ||
        identity.arm === "zero-controller" && identity.cycle !== 0 ||
        !Number.isSafeInteger(identity.seed) || identity.seed < 640010001 || identity.seed > 640099999 ||
        (identity.cycle === 0) !== (imported?.kind === "evolved-source-unknown-age" ||
          imported?.kind === "standard-founder-disc") ||
        (identity.arm === "donor" && identity.cycle === 0) !==
          (imported?.kind === "evolved-source-unknown-age") ||
        (identity.arm !== "donor" && identity.cycle === 0) !==
          (imported?.kind === "standard-founder-disc") ||
        imported?.kind === "standard-founder-disc" && imported.founderIndex !== 9 ||
        (identity.cycle > 0) !== transferred ||
        transferred && (!imported.sourceGardenId || imported.sourceCycle !== identity.cycle - 1 ||
          !Number.isSafeInteger(imported.sourceStep) || imported.sourceStep < 25 ||
          imported.sourceStep > SERIAL_RECRUITMENT_END || imported.sourceStep % SERIAL_CADENCE !== 0 ||
          !Number.isSafeInteger(imported.parentTrackerId) || imported.parentTrackerId < 1 ||
          !Number.isSafeInteger(imported.childTrackerId) || imported.childTrackerId < 1 ||
          imported.parentTrackerId === imported.childTrackerId ||
          !/^[a-f0-9]{64}$/.test(imported.packetSha256) ||
          imported.ageSinceObservedFissionAtPlacement !== 0))
      throw new Error("invalid serial garden identity or reserved seed");
    this.identity = { ...identity, importedFragment: { ...imported } };
  }

  selectedPacket(): CellPacket | null { return this.packet; }

  observe(state: WorldState): void {
    if (state.step !== this.lastStep + SERIAL_CADENCE || state.step > SERIAL_HORIZON)
      throw new Error(`serial capture expected step ${this.lastStep + SERIAL_CADENCE}, got ${state.step}`);
    const config = canonicalConfig(state.cfg);
    if (this.configCanonical !== null && config !== this.configCanonical)
      throw new Error("serial garden configuration changed between snapshots");
    this.configCanonical = config;
    const n = cellCount(state.cfg);
    if (state.cells.length !== 7 * n || state.genome.length < 4 * n)
      throw new Error("serial capture needs full cell and genome state");
    const c = census({ cfg: state.cfg, step: state.step, cells: state.cells,
      genomeHead: state.genome.subarray(0, 4 * n) }, SERIAL_CENSUS);
    const prior = this.priorFine;
    const events = this.fine.update(c);
    const mixing = prior ? overlappingPriorIdentities(prior.labels, prior.ids, c,
      (i) => this.fine.idOf(i), SERIAL_CENSUS.minMass) : [];
    const ids = new Map<number, number>();
    for (const component of c.components) {
      const id = this.fine.idOf(component.idx);
      if (id !== undefined) ids.set(component.idx, id);
    }
    this.priorFine = { labels: c.labels, ids };
    this.lastStep = state.step;
    this.events25.push(...events);
    this.mixing25.push(...mixing);
    this.censuses25.push({ step: c.step, labelsSha256: labelDigest(c.labels),
      eligibleComponents: c.components.filter((x) => x.mass >= SERIAL_CENSUS.minMass).length,
      trackedIndividuals: this.fine.alive.size });
    if (state.step === 0) {
      this.eligibleAtStep0 = this.fine.alive.size;
      if (this.eligibleAtStep0 === 1) this.rootId25 = [...this.fine.alive.keys()][0];
    } else {
      this.markFates(events, mixing);
      this.recordCandidates(state, c, events, mixing);
    }
    this.recordMorphology(state, c);
    if (state.step % SERIAL_SENSITIVITY_CADENCE === 0) {
      const previous = this.priorCoarse;
      const priorCoarseIds = new Set(previous?.ids.values() ?? []);
      const coarseEvents = this.coarse.update(c);
      const coarseMixing = previous ? overlappingPriorIdentities(previous.labels, previous.ids, c,
        (i) => this.coarse.idOf(i), SERIAL_CENSUS.minMass) : [];
      const coarseIds = new Map<number, number>();
      for (const component of c.components) {
        const id = this.coarse.idOf(component.idx);
        if (id !== undefined) coarseIds.set(component.idx, id);
      }
      this.priorCoarse = { labels: c.labels, ids: coarseIds };
      this.events100.push(...coarseEvents);
      this.mixing100.push(...coarseMixing);
      this.censuses100.push({ step: c.step, labelsSha256: labelDigest(c.labels),
        eligibleComponents: c.components.filter((x) => x.mass >= SERIAL_CENSUS.minMass).length,
        trackedIndividuals: this.coarse.alive.size });
      if (state.step === 0 && this.coarse.alive.size === 1) this.rootId100 = [...this.coarse.alive.keys()][0];
      if (this.selection.childId !== null && this.visibility100 === null &&
          this.selection.step !== null && state.step >= this.selection.step)
        this.visibility100 = this.classifyVisibility100(c, coarseEvents, coarseMixing, priorCoarseIds);
    }
  }

  private classifyVisibility100(c: Census, events: readonly LifeEvent[], mixing: readonly OverlapMixing[],
    priorIds: ReadonlySet<number>): SerialSelectionVisibility100 {
    const fineChildId = this.selection.childId!;
    const component = c.components.find((x) => this.fine.idOf(x.idx) === fineChildId);
    const fineComponentIndex = component?.idx ?? null;
    const coarseChildId = fineComponentIndex === null ? null : this.coarse.idOf(fineComponentIndex) ?? null;
    let status: SerialSelectionVisibility100["status"] = "ambiguous", ambiguity: string | null = null;
    if (fineComponentIndex === null || coarseChildId === null) status = "absent";
    else if (events.some((e) => e.kind === "fission" && e.parent === this.rootId100 &&
      e.children.includes(coarseChildId))) status = "direct-root-fission";
    else if (events.some((e) => e.kind === "birth" && e.id === coarseChildId)) status = "birth";
    else if (priorIds.has(coarseChildId)) status = "retained-coarse-identity";
    else ambiguity = "same-label coarse ID has no direct-root fission, birth or retained-ID classification";
    if (coarseChildId !== null && mixing.some((m) => m.currentId === coarseChildId ||
      m.priorIds.includes(coarseChildId)))
      ambiguity = [ambiguity, "coarse child participates in overlap mixing"].filter(Boolean).join("; ");
    if (this.childSourceFate?.status === "overlap-mixed")
      ambiguity = [ambiguity, "fine child has prior overlap-mixing evidence"].filter(Boolean).join("; ");
    return { step: c.step, fineChildId, fineComponentIndex, coarseChildId,
      coarseRootId: this.rootId100, status, ambiguity };
  }

  private markFates(events: readonly LifeEvent[], mixing: readonly OverlapMixing[]): void {
    const root = this.rootId25, child = this.selection.childId;
    const fate = (id: number | null): EventFate | null => {
      if (id === null) return null;
      if (mixing.some((m) => m.currentId === id || m.priorIds.includes(id)))
        return { status: "overlap-mixed", step: this.lastStep };
      if (events.some((e) => e.kind === "fusion" && (e.child === id || e.parents.includes(id))))
        return { status: "fusion", step: this.lastStep };
      if (events.some((e) => e.kind === "death" && e.id === id))
        return { status: "death", step: this.lastStep };
      return null;
    };
    this.rootDisqualification ??= fate(root);
    this.childSourceFate ??= fate(child);
  }

  private recordCandidates(state: WorldState, c: Census, events: readonly LifeEvent[],
    mixing: readonly OverlapMixing[]): void {
    const inverse = new Map<number, number>();
    for (const component of c.components) {
      const id = this.fine.idOf(component.idx);
      if (id !== undefined) inverse.set(id, component.idx);
    }
    const candidates: SerialCandidate[] = [];
    for (const event of events) {
      if (event.kind !== "fission") continue;
      for (const childId of event.children) {
        const componentIndex = inverse.get(childId) ?? null;
        const component = componentIndex === null ? null : c.components[componentIndex];
        const reasons: string[] = [];
        if (event.parent !== this.rootId25 || this.rootId25 === null) reasons.push("not-direct-imported-root-child");
        if (c.step > SERIAL_RECRUITMENT_END) reasons.push("outside-recruitment-window");
        if (this.rootDisqualification) reasons.push(`root-${this.rootDisqualification.status}-before-recruitment`);
        if (!this.fine.alive.has(event.parent)) reasons.push("parent-not-alive-at-census");
        if (componentIndex === null) reasons.push("missing-child-label-id-join");
        if (!component || component.mass < SERIAL_CENSUS.minMass) reasons.push("child-below-minimum-mass");
        if (componentIndex !== null && this.rootId25 !== null &&
            inverse.get(this.rootId25) === componentIndex) reasons.push("not-physically-separated");
        if (mixing.some((m) => m.currentId === childId || m.priorIds.includes(childId)))
          reasons.push("child-overlap-mixed-at-census");
        if (events.some((e) => e.kind === "fusion" && (e.child === childId || e.parents.includes(childId))))
          reasons.push("child-fused-at-census");
        const topologyEligible = reasons.length === 0;
        const key = topologyEligible ? sha(`${SERIAL_SELECTION_SALT}\n${this.identity.sourceKey}\n${this.identity.arm}\n${this.identity.cycle}\n${this.identity.seed}\n${c.step}\n${childId}\n${componentIndex}`) : null;
        candidates.push({ step: c.step, parentId: event.parent, childId, componentIndex,
          mass: component?.mass ?? null, topologyEligible, rejectionReasons: reasons,
          disposition: topologyEligible ? "eligible-not-selected" : "rejected",
          selectionSha256: key, packetSha256: null, packetError: null });
      }
    }
    const eligible = candidates.filter((x) => x.topologyEligible);
    if (this.selection.status === "none" && eligible.length) {
      eligible.sort((a, b) => a.selectionSha256!.localeCompare(b.selectionSha256!) || a.childId - b.childId);
      const selected = eligible[0];
      this.selection = { status: "packet-invalid", step: c.step, childId: selected.childId,
        componentIndex: selected.componentIndex, selectionSha256: selected.selectionSha256,
        packetSha256: null, packetError: null };
      try {
        const indices: number[] = [];
        for (let i = 0; i < c.labels.length; i++) if (c.labels[i] === selected.componentIndex) indices.push(i);
        const packet = extractCellPacket(state, indices);
        this.packet = packet;
        this.selection.status = "packet-valid";
        this.selection.packetSha256 = packet.sha256;
        selected.packetSha256 = packet.sha256;
        selected.disposition = "selected-packet-valid";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.selection.packetError = message;
        selected.packetError = message;
        selected.disposition = "selected-packet-invalid";
      }
    } else if (this.selection.status !== "none") {
      for (const candidate of eligible) candidate.disposition = "eligible-after-selection";
    }
    this.candidates.push(...candidates);
  }

  private recordMorphology(state: WorldState, c: Census): void {
    const roots: { id: number | null; born: number; destination: Map<number, RecordedMorphology> }[] = [
      { id: this.rootId25, born: 0, destination: this.rootMorph },
      { id: this.selection.childId, born: this.selection.step ?? 0, destination: this.childMorph },
    ];
    const due = roots.filter(({ id, born, destination }) => id !== null &&
      SERIAL_MATCHED_AGES.includes((c.step - born) as typeof SERIAL_MATCHED_AGES[number]) && !destination.has(c.step));
    if (!due.length) return;
    const frames = new Map(frameAtCensus(c, state.cells, state.cfg, this.fine, 0).map((f) => [f.id, f]));
    for (const { id, destination } of due) {
      const frame = frames.get(id!);
      if (frame) destination.set(c.step, { frame, memberRanges: memberRanges(c.labels, frame.componentIndex) });
    }
  }

  private fate(id: number | null, event: EventFate | null): SerialFate {
    if (id === null) return { status: "not-introduced", step: null };
    if (event) return event;
    if (this.lastStep < SERIAL_HORIZON) return { status: "right-censored", step: this.lastStep };
    return this.fine.alive.has(id) ? { status: "alive-at-horizon", step: SERIAL_HORIZON } :
      { status: "missing", step: this.lastStep };
  }

  result(): SerialCaptureResult {
    if (this.lastStep < 0) throw new Error("serial capture has no step-0 state");
    const morphology: SerialMorphology[] = [];
    const append = (subject: SerialMorphology["subject"], born: number | null,
      frames: Map<number, RecordedMorphology>, fate: SerialFate) => {
      if (born === null) return;
      for (const age of SERIAL_MATCHED_AGES) {
        const targetStep = born + age, saved = frames.get(targetStep);
        let status: SerialMorphology["status"] = "missing";
        if ((fate.status === "death" || fate.status === "fusion" || fate.status === "overlap-mixed") &&
          fate.step !== null && fate.step <= targetStep) status = fate.status;
        else if (saved) status = "observed";
        else if (targetStep > this.lastStep) status = "right-censored";
        morphology.push({ subject, targetAgeSinceTransferOrSelection: age, targetStep,
          timeSincePlacement: targetStep,
          observerIdentityAge: subject === "imported-root" ? null : age,
          importedFragmentAgeSinceObservedFission: subject === "imported-root" &&
            this.identity.importedFragment.kind === "selected-observer-child" ? targetStep : null,
          biologicalAge: null,
          status, frame: saved?.frame ?? null, memberRanges: saved?.memberRanges ?? null });
      }
    };
    const rootFate = this.fate(this.rootId25, this.rootDisqualification);
    const childFate = this.fate(this.selection.childId, this.childSourceFate);
    append("imported-root", this.rootId25 === null ? null : 0, this.rootMorph, rootFate);
    append("selected-source-child", this.selection.step, this.childMorph, childFate);
    return { format: "foundation-serial-capture/v1", identity: { ...this.identity },
      schedule: { firstStep: 0, lastObservedStep: this.lastStep, fineEvery: 25, coarseEvery: 100,
        horizon: 3000, recruitmentEnd: 1000, threshold: 48, minMass: 256 },
      complete: this.lastStep === SERIAL_HORIZON,
      root: { status: this.rootId25 === null ? "unavailable" : "one-eligible", id25: this.rootId25,
        id100: this.rootId100, eligibleAtStep0: this.eligibleAtStep0,
        disqualifiedAt: this.rootDisqualification?.step ?? null,
        disqualificationReason: this.rootDisqualification?.status ?? null },
      selection: { ...this.selection }, selectionVisibility100: this.visibility100 ? { ...this.visibility100 } :
        { status: "unavailable", reason: this.selection.status === "none" ?
          "no-selection" : "shared-census-not-yet-observed" },
      candidates: [...this.candidates], events25: [...this.events25],
      events100: [...this.events100], overlapMixing25: [...this.mixing25],
      overlapMixing100: [...this.mixing100], censuses25: [...this.censuses25],
      censuses100: [...this.censuses100], rootSourceFate: rootFate,
      selectedChildSourceFate: childFate, morphology,
      limitations: ["25-step and 100-step trackers share one physical history and have different local numeric IDs.",
        "Observer split children are asymmetric labels, not validated organism generations; mixing between censuses is unavailable.",
        "Morphology is measured at fixed ages; movement and de novo organization are unavailable from this capture alone.",
        "An extracted child's later source-garden fate cannot veto its already frozen packet selection."] };
  }

  snapshot(): SerialCaptureResult { return this.result(); }
}
