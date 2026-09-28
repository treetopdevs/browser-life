/** The frozen selected-link census adapter; it does not declare reproduction. */
import { cellCount, type WorldConfig } from "@bl/schema";
import type { ResetOriginMap, ResetCopyShare } from "./reset-copy-extraction.ts";
import { ResetOriginMap as OriginMap, resetCopyShare } from "./reset-copy-extraction.ts";
import { resetBirthReferences, resetFollowupSample,
  type ResetBirthEvent, type ResetBirthReferences,
  type ResetFollowupSample } from "./reset-followup.ts";
import type { ResetProbeAObserver, ResetParentSupport } from "./reset-probe-a-observer.ts";

export interface ResetSelectedLink {
  rowIndex: number; h: number; step: number; kind: "fission" | "budding";
  parent: number; child: number;
  parentLineage: string; childLineage: string;
  parentPurity: number; childPurity: number;
}
export type ResetLinkEvidence = {
  original: ResetSelectedLink;
  status: "available" | "unavailable-child-support";
  parentSupport: ResetParentSupport;
  birthCopyShare: ResetCopyShare | null;
  birthReferences: ResetBirthReferences | null;
  samples: ResetFollowupSample[];
  interpretation: "observer-link-with-copy-attribution-not-biological-reproduction";
};

type ObserverView = Pick<ResetProbeAObserver,
  "currentStep" | "census" | "parentSupport" | "componentForTrackerId" | "observeNext">;
type Frame = { step: number; cells: Uint32Array; genomeHead: Uint32Array };
const graphRules = [{ threshold: 48, neighbors: 4 },
  { threshold: 1, neighbors: 8 }] as const;

/** Origin maps remain anchored to each birth t across all later census rebases. */
export class ResetProbeAAnalysis {
  private readonly cfg: WorldConfig;
  private readonly observer: ObserverView;
  private readonly byStep = new Map<number, ResetSelectedLink[]>();
  private readonly evidence = new Map<number, ResetLinkEvidence>();
  private readonly pending = new Map<number, ResetOriginMap>();

  constructor(cfg: WorldConfig, observer: ObserverView, rows: readonly ResetSelectedLink[]) {
    this.cfg = cfg; this.observer = observer;
    const indices = new Set<number>();
    for (const row of rows) {
      if (!Number.isSafeInteger(row.rowIndex) || row.rowIndex < 0 || indices.has(row.rowIndex) ||
          row.kind !== "fission" && row.kind !== "budding" ||
          !Number.isSafeInteger(row.step) || row.step < 100 || row.step % 100 !== 0 ||
          !Number.isSafeInteger(row.parent) || row.parent <= 0 ||
          !Number.isSafeInteger(row.child) || row.child <= 0 || row.child === row.parent)
        throw new Error("selected-link identity or census time invalid");
      indices.add(row.rowIndex);
      const atStep = this.byStep.get(row.step) ?? [];
      atStep.push(row); this.byStep.set(row.step, atStep);
    }
  }

  observeCensus(frame: Frame, intervalOrigin: ResetOriginMap,
    mutationCount: number): { life: object[]; examinedRows: number } {
    const previous = this.observer.currentStep, n = cellCount(this.cfg);
    if (frame.step !== previous + 100 || intervalOrigin.referenceStep !== previous ||
        intervalOrigin.currentStep !== frame.step || intervalOrigin.origins.length !== n ||
        frame.cells.length !== 7 * n || frame.genomeHead.length < 2 * n)
      throw new Error("selected-link census lacks a complete previous-census copy path");
    const due = this.byStep.get(frame.step) ?? [];
    const parents = new Map<number, ResetParentSupport>();
    for (const row of due) {
      const support = this.observer.parentSupport(row.parent);
      if (support.status === "available") {
        const component = this.observer.census.labels[support.sites[0]];
        const p = this.observer.census.components[component];
        if (!p || p.lineage !== row.parentLineage ||
            Number(p.purity.toFixed(4)) !== row.parentPurity)
          throw new Error("selected parent lineage/purity differs from original birth row");
      }
      parents.set(row.rowIndex, support);
    }
    const observed = this.observer.observeNext(frame, mutationCount);
    // Existing birth-t maps must advance before their t+100..t+1000 samples.
    for (const [rowIndex, priorMap] of this.pending) {
      const record = this.evidence.get(rowIndex);
      if (!record?.birthReferences) throw new Error("pending follow-up lacks birth reference");
      const currentMap = priorMap.composeMap(intervalOrigin);
      for (const rule of graphRules)
        record.samples.push(resetFollowupSample(this.cfg, record.birthReferences,
          currentMap, frame.cells, frame.genomeHead, rule));
      if (frame.step - record.original.step === 1000) this.pending.delete(rowIndex);
      else this.pending.set(rowIndex, currentMap);
    }
    for (const row of due) {
      const parentSupport = parents.get(row.rowIndex);
      if (!parentSupport) throw new Error("selected-link parent support was not captured before update");
      const component = this.observer.componentForTrackerId(row.child);
      let event: ResetBirthEvent | null = null;
      if (row.kind === "budding") {
        if (observed.life.some(raw => raw && typeof raw === "object" &&
            (raw as { step?: unknown; kind?: unknown; parent?: unknown; child?: unknown }).step === row.step &&
            (raw as { kind?: unknown }).kind === "budding" &&
            (raw as { parent?: unknown }).parent === row.parent &&
            (raw as { child?: unknown }).child === row.child))
          event = { step: row.step, kind: "budding", parent: row.parent, child: row.child };
      } else {
        const emitted = observed.life.find(raw => raw && typeof raw === "object" &&
          (raw as { step?: unknown }).step === row.step &&
          (raw as { kind?: unknown }).kind === "fission" &&
          (raw as { parent?: unknown }).parent === row.parent &&
          Array.isArray((raw as { children?: unknown }).children) &&
          (raw as { children: number[] }).children.includes(row.child)) as
          { children: number[] } | undefined;
        if (emitted) event = { step: row.step, kind: "fission", parent: row.parent,
          focalChild: row.child, children: emitted.children };
      }
      if (!event) throw new Error("selected historical link lacks exact emitted life event");
      const result: ResetLinkEvidence = { original: row,
        status: component === null ? "unavailable-child-support" : "available",
        parentSupport, birthCopyShare: null, birthReferences: null, samples: [],
        interpretation: "observer-link-with-copy-attribution-not-biological-reproduction" };
      if (component !== null) {
        const child = observed.census.components[component];
        if (!child || child.lineage !== row.childLineage ||
            Number(child.purity.toFixed(4)) !== row.childPurity)
          throw new Error("selected child lineage/purity differs from original birth row");
        result.birthCopyShare = resetCopyShare(this.cfg, observed.census, frame.cells,
          frame.genomeHead, component, intervalOrigin, parentSupport);
        result.birthReferences = resetBirthReferences(observed.census, observed.life,
          event, id => this.observer.componentForTrackerId(id));
        const birthMap = OriginMap.atPhysicalCensus(this.cfg, frame.step,
          frame.cells, frame.genomeHead);
        for (const rule of graphRules)
          result.samples.push(resetFollowupSample(this.cfg, result.birthReferences,
            birthMap, frame.cells, frame.genomeHead, rule));
        this.pending.set(row.rowIndex, birthMap);
      }
      this.evidence.set(row.rowIndex, result);
    }
    return { life: observed.life, examinedRows: due.length };
  }

  rows(): ResetLinkEvidence[] {
    return [...this.evidence.values()].sort((a, b) => a.original.rowIndex - b.original.rowIndex);
  }
  pendingRows(): number[] { return [...this.pending.keys()].sort((a, b) => a - b); }
}
