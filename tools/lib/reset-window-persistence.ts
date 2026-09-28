/** Per-flag 100-step copy-associated geometry descriptor, with no episode grouping. */
import { createHash } from "node:crypto";
import { G, cellCount, type WorldConfig } from "@bl/schema";
import type { ResetOriginMap } from "./reset-copy-extraction.ts";
import { resetTopology, type ResetFragmentationFlag } from "./reset-topology.ts";

export type ResetWindowPersistenceStatus = "known-separated" |
  "known-separated-unknown-origin" | "shared-physical-support" |
  "observed-copy-loss" | "unknown-copy-origin";
export type ResetWindowPersistenceSample = {
  step: number; offset: number; status: ResetWindowPersistenceStatus;
  knownCopySitesByBranch: number[]; unknownGenomeBearingCopySites: number;
};
export type ResetWindowPersistenceResult = {
  flagStep: number; priorComponent: number;
  branchComponentIndices: number[]; branchSitesSha256: string[];
  status: "complete-100-future-samples" | "incomplete";
  samples: ResetWindowPersistenceSample[];
  interpretation: "copy-associated-sampled-geometry-not-entity-persistence";
};
type Active = { result: ResetWindowPersistenceResult; labels: Uint32Array };
const UNKNOWN_COPY_ORIGIN = 0xffffffff;

const sha = (step: number, component: number, sites: number[]) =>
  createHash("sha256").update(JSON.stringify({ step, component, sites })).digest("hex");

export class ResetWindowPersistence {
  private readonly cfg: WorldConfig;
  private readonly n: number;
  private readonly active: Active[] = [];
  private readonly finished: ResetWindowPersistenceResult[] = [];
  private step: number;
  private readonly maxActiveBytes: number;

  constructor(cfg: WorldConfig, referenceStep: number, maxActiveBytes: number) {
    if (!Number.isSafeInteger(referenceStep) || referenceStep < 0 ||
        !Number.isSafeInteger(maxActiveBytes) || maxActiveBytes < 4 * cellCount(cfg))
      throw new Error("window persistence requires a reference and bounded active memory");
    this.cfg = cfg; this.n = cellCount(cfg); this.step = referenceStep;
    this.maxActiveBytes = maxActiveBytes;
  }

  /** Consume every physical step, including the 100-step tail after the last candidate. */
  observeStep(step: number, cells: Uint32Array, genomeHead: Uint32Array,
    oneStepOrigins: ResetOriginMap, flags: readonly ResetFragmentationFlag[]): void {
    const n = this.n;
    if (step !== this.step + 1 || oneStepOrigins.referenceStep !== this.step ||
        oneStepOrigins.currentStep !== step || oneStepOrigins.origins.length !== n ||
        cells.length !== 7 * n || genomeHead.length < 2 * n ||
        flags.some(flag => flag.step !== step))
      throw new Error("window persistence lacks exact adjacent physics and copy tags");
    const topology = resetTopology(this.cfg, cells, { threshold: 1, neighbors: 8 });
    for (const active of this.active) {
      const next = new Uint32Array(n);
      const components = active.result.branchComponentIndices.map(() => new Set<number>());
      const knownCopySitesByBranch = components.map(() => 0);
      let unknownGenomeBearingCopySites = 0;
      for (let i = 0; i < n; i++) {
        const source = oneStepOrigins.origins[i];
        if (source > n) throw new Error("window persistence copy source outside geometry");
        if ((genomeHead[G.LIN_HI * n + i] | genomeHead[G.LIN_LO * n + i]) === 0) continue;
        if (source === 0) {
          next[i] = UNKNOWN_COPY_ORIGIN;
          unknownGenomeBearingCopySites++;
          continue;
        }
        const label = active.labels[source - 1];
        next[i] = label;
        if (label === UNKNOWN_COPY_ORIGIN) {
          unknownGenomeBearingCopySites++;
          continue;
        }
        if (!label) continue;
        knownCopySitesByBranch[label - 1]++;
        const physicalComponent = topology.labels[i];
        if (physicalComponent >= 0) components[label - 1].add(physicalComponent);
      }
      active.labels = next;
      let shared = false;
      const seenComponents = new Set<number>();
      for (const branch of components)
        for (const component of branch) {
          if (seenComponents.has(component)) shared = true;
          seenComponents.add(component);
        }
      const missing = knownCopySitesByBranch.some(count => count === 0);
      const status: ResetWindowPersistenceStatus = missing ?
        unknownGenomeBearingCopySites ? "unknown-copy-origin" : "observed-copy-loss" :
        shared ? "shared-physical-support" : unknownGenomeBearingCopySites ?
          "known-separated-unknown-origin" : "known-separated";
      active.result.samples.push({ step, offset: step - active.result.flagStep,
        status, knownCopySitesByBranch, unknownGenomeBearingCopySites });
    }
    for (let i = this.active.length - 1; i >= 0; i--)
      if (step - this.active[i].result.flagStep === 100) {
        this.active[i].result.status = "complete-100-future-samples";
        this.finished.push(this.active[i].result);
        this.active.splice(i, 1);
      }
    for (const flag of flags) {
      if (this.active.length * n * 4 + n * 4 > this.maxActiveBytes)
        throw new Error("window persistence active-memory cap reached; retain partial run");
      const labels = new Uint32Array(n);
      const sitesByComponent = flag.branches.map(() => [] as number[]);
      const branchPosition = new Map(flag.branches.map((branch, index) =>
        [branch.currentComponent, index]));
      for (let i = 0; i < n; i++) {
        const position = branchPosition.get(topology.labels[i]);
        if (position === undefined) continue;
        labels[i] = position + 1;
        sitesByComponent[position].push(i);
      }
      if (sitesByComponent.some((sites, index) =>
          !sites.length || sites.length !== topology.components[flag.branches[index].currentComponent].cells))
        throw new Error("window flag branch differs from physical graph");
      this.active.push({ labels, result: {
        flagStep: step, priorComponent: flag.priorComponent,
        branchComponentIndices: flag.branches.map(x => x.currentComponent),
        branchSitesSha256: sitesByComponent.map((sites, index) =>
          sha(step, flag.branches[index].currentComponent, sites)),
        status: "incomplete", samples: [],
        interpretation: "copy-associated-sampled-geometry-not-entity-persistence",
      } });
    }
    this.step = step;
  }

  results(): ResetWindowPersistenceResult[] {
    return [...this.finished, ...this.active.map(x => x.result)]
      .sort((a, b) => a.flagStep - b.flagStep || a.priorComponent - b.priorComponent);
  }
  get currentStep(): number { return this.step; }
  get activeBytes(): number { return this.active.length * this.n * 4; }
}
