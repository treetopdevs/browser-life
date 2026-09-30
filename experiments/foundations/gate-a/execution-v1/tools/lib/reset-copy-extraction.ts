/** Compose exact genome-copy site origins across census rebases and report numeric attribution. */
import { CH, G, cellCount, type WorldConfig } from "@bl/schema";
import type { Census } from "@bl/metrics";
import type { ResetGpuSnapshot } from "./reset-gpu-copy-audit.ts";
import type { ResetParentSupport } from "./reset-probe-a-observer.ts";

export class ResetOriginMap {
  readonly referenceStep: number;
  readonly currentStep: number;
  readonly origins: Uint32Array;
  private constructor(referenceStep: number, currentStep: number, origins: Uint32Array) {
    this.referenceStep = referenceStep; this.currentStep = currentStep; this.origins = origins;
  }

  static fromSnapshot(snapshot: ResetGpuSnapshot): ResetOriginMap {
    if (snapshot.referenceStep >= snapshot.step || !snapshot.tags.length)
      throw new Error("copy origin map requires a complete later census");
    const n = snapshot.tags.length;
    if (snapshot.tags.some(tag => tag > n)) throw new Error("copy origin tag exceeds world geometry");
    return new ResetOriginMap(snapshot.referenceStep, snapshot.step, snapshot.tags.slice());
  }

  /** Identity mapping at a branch's birth census, before any later physical step. */
  static atPhysicalCensus(cfg: WorldConfig, step: number, cells: Uint32Array,
    genomeHead: Uint32Array): ResetOriginMap {
    const n = cellCount(cfg);
    if (!Number.isSafeInteger(step) || step < 0 || cells.length !== 7 * n ||
        genomeHead.length < 2 * n)
      throw new Error("identity origin map lacks a physical census");
    const tags = new Uint32Array(n);
    for (let i = 0; i < n; i++)
      if (cells[CH.B * n + i] + cells[CH.P * n + i] > 0 &&
          (genomeHead[G.LIN_HI * n + i] | genomeHead[G.LIN_LO * n + i]) !== 0)
        tags[i] = i + 1;
    return new ResetOriginMap(step, step, tags);
  }

  /** Current→prior site map composed with the retained prior→reference site map. */
  compose(snapshot: ResetGpuSnapshot): ResetOriginMap {
    if (snapshot.referenceStep !== this.currentStep || snapshot.step <= this.currentStep ||
        snapshot.tags.length !== this.origins.length)
      throw new Error("copy origin composition has a gap, overlap or changed geometry");
    const n = this.origins.length, next = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const prior = snapshot.tags[i];
      if (prior > n) throw new Error("copy origin tag exceeds world geometry");
      next[i] = prior === 0 ? 0 : this.origins[prior - 1];
    }
    return new ResetOriginMap(this.referenceStep, snapshot.step, next);
  }

  /** Compose a retained census interval map after one or more per-step GPU rebases. */
  composeMap(nextMap: ResetOriginMap): ResetOriginMap {
    if (nextMap.referenceStep !== this.currentStep ||
        nextMap.currentStep <= this.currentStep ||
        nextMap.origins.length !== this.origins.length)
      throw new Error("copy origin maps have a gap, overlap or changed geometry");
    const n = this.origins.length, next = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const prior = nextMap.origins[i];
      if (prior > n) throw new Error("copy origin map exceeds reference geometry");
      next[i] = prior === 0 ? 0 : this.origins[prior - 1];
    }
    return new ResetOriginMap(this.referenceStep, nextMap.currentStep, next);
  }
}

export type ResetCopyShare = {
  status: "available" | "unavailable-parent-support" |
    "unavailable-no-genome-bearing-child-sites";
  referenceStep: number; step: number; componentIndex: number;
  parentId: number; parentSitesSha256: string | null;
  physicalSites: number; genomeBearingSites: number; genomeFreeSites: number;
  parentLinkedSites: number | null; knownNonparentSites: number | null; unknownSites: number | null;
  parentLinkedBoundCarrierMass: number | null;
  knownNonparentBoundCarrierMass: number | null;
  unknownBoundCarrierMass: number | null;
  parentCellFractionInterval: [number, number] | null;
  parentBoundCarrierFractionInterval: [number, number] | null;
  /** These fractions classify cells by genome-copy origin, never material origin. */
  interpretation: "copy-tagged-current-support-not-inherited-material";
};

export function resetCopyShare(cfg: WorldConfig, census: Census, cells: Uint32Array,
  genomeHead: Uint32Array, componentIndex: number, map: ResetOriginMap,
  parent: ResetParentSupport): ResetCopyShare {
  const n = cellCount(cfg);
  if (census.step !== map.currentStep || parent.referenceStep !== map.referenceStep ||
      census.labels.length !== n || map.origins.length !== n ||
      cells.length !== 7 * n || genomeHead.length < 2 * n ||
      !Number.isSafeInteger(componentIndex) || componentIndex < 0 ||
      componentIndex >= census.components.length)
    throw new Error("copy share lacks matching physical census or reference");
  const parentSites = parent.status === "available" ? new Set(parent.sites) : null;
  if (parent.status === "available" && parentSites &&
      (parentSites.size !== parent.sites.length ||
      [...parentSites].some(i => !Number.isSafeInteger(i) || i < 0 || i >= n)))
    throw new Error("copy share parent support is duplicate or outside geometry");
  let physicalSites = 0, genomeBearingSites = 0, genomeFreeSites = 0;
  let parentLinkedSites = 0, knownNonparentSites = 0, unknownSites = 0;
  let parentMass = 0, otherMass = 0, unknownMass = 0;
  for (let i = 0; i < n; i++) {
    if (census.labels[i] !== componentIndex) continue;
    physicalSites++;
    if ((genomeHead[G.LIN_HI * n + i] | genomeHead[G.LIN_LO * n + i]) === 0) {
      genomeFreeSites++; continue;
    }
    genomeBearingSites++;
    if (!parentSites) continue;
    const tag = map.origins[i], mass = cells[CH.B * n + i] + cells[CH.P * n + i];
    if (tag > n) throw new Error("copy origin map contains invalid source site");
    if (tag === 0) { unknownSites++; unknownMass += mass; }
    else if (parentSites.has(tag - 1)) { parentLinkedSites++; parentMass += mass; }
    else { knownNonparentSites++; otherMass += mass; }
  }
  if (physicalSites !== census.components[componentIndex].cells)
    throw new Error("copy share component membership differs from census");
  const totalMass = parentMass + otherMass + unknownMass;
  return { status: !parentSites ? "unavailable-parent-support" :
      !genomeBearingSites ? "unavailable-no-genome-bearing-child-sites" : "available",
    referenceStep: map.referenceStep, step: map.currentStep, componentIndex,
    parentId: parent.parentId,
    parentSitesSha256: parent.status === "available" ? parent.sitesSha256 : null,
    physicalSites, genomeBearingSites, genomeFreeSites,
    parentLinkedSites: parentSites ? parentLinkedSites : null,
    knownNonparentSites: parentSites ? knownNonparentSites : null,
    unknownSites: parentSites ? unknownSites : null,
    parentLinkedBoundCarrierMass: parentSites ? parentMass : null,
    knownNonparentBoundCarrierMass: parentSites ? otherMass : null,
    unknownBoundCarrierMass: parentSites ? unknownMass : null,
    parentCellFractionInterval: parentSites && genomeBearingSites ?
      [parentLinkedSites / genomeBearingSites,
        (parentLinkedSites + unknownSites) / genomeBearingSites] : null,
    parentBoundCarrierFractionInterval: parentSites && totalMass ?
      [parentMass / totalMass, (parentMass + unknownMass) / totalMass] : null,
    interpretation: "copy-tagged-current-support-not-inherited-material" };
}
