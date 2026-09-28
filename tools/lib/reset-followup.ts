/** Birth-census copy references and later sampled, physical support relations. */
import { createHash } from "node:crypto";
import { CH, G, cellCount, type WorldConfig } from "@bl/schema";
import type { Census } from "@bl/metrics";
import type { ResetOriginMap } from "./reset-copy-extraction.ts";
import { resetTopology, type ResetTopologyRule } from "./reset-topology.ts";

export type ResetBirthEvent =
  | { step: number; kind: "budding"; parent: number; child: number }
  | { step: number; kind: "fission"; parent: number; focalChild: number; children: number[] };

export type ResetBirthBranch = {
  id: number;
  role: "focal" | "parent-id-candidate" | "sibling";
  status: "available" | "unavailable-tracker-support";
  sites: number[] | null;
  sitesSha256: string | null;
};

export type ResetBirthReferences = {
  step: number;
  event: ResetBirthEvent;
  branches: ResetBirthBranch[];
  /** Birth-t branches, not the broad parent family at t−100. */
  reference: "birth-census-branch-copy-support";
};

const shaSites = (step: number, id: number, sites: number[]) =>
  createHash("sha256").update(JSON.stringify({ step, id, sites })).digest("hex");

/** Freeze exactly the emitted focal and comparison identities at birth t. */
export function resetBirthReferences(census: Census, emittedLife: readonly object[],
  event: ResetBirthEvent, componentForTrackerId: (id: number) => number | null):
  ResetBirthReferences {
  if (census.step !== event.step || !Number.isSafeInteger(event.parent) || event.parent <= 0)
    throw new Error("birth reference step or parent identity invalid");
  const child = event.kind === "budding" ? event.child : event.focalChild;
  if (!Number.isSafeInteger(child) || child <= 0 || child === event.parent ||
      (event.kind === "fission" && (event.children.length === 0 ||
        !event.children.includes(event.focalChild) ||
        new Set(event.children).size !== event.children.length ||
        event.children.some(x => !Number.isSafeInteger(x) || x <= 0 || x === event.parent))))
    throw new Error("birth reference child identities invalid");
  const recorded = emittedLife.some(raw => {
    if (!raw || typeof raw !== "object") return false;
    const e = raw as Record<string, unknown>;
    return e.step === event.step && e.kind === event.kind && e.parent === event.parent &&
      (event.kind === "budding" ? e.child === event.child :
        Array.isArray(e.children) && JSON.stringify(e.children) === JSON.stringify(event.children));
  });
  if (!recorded) throw new Error("birth reference is not an exact emitted life event");
  const ids = event.kind === "budding" ? [event.child, event.parent] :
    [event.focalChild, event.parent,
      ...event.children.filter(id => id !== event.focalChild)];
  const branches = ids.map((id, position): ResetBirthBranch => {
    const role = position === 0 ? "focal" : position === 1 ? "parent-id-candidate" : "sibling";
    const component = componentForTrackerId(id);
    if (component === null) return { id, role, status: "unavailable-tracker-support",
      sites: null, sitesSha256: null };
    if (!Number.isSafeInteger(component) || component < 0 || component >= census.components.length)
      throw new Error("birth tracker component outside physical census");
    const sites: number[] = [];
    for (let i = 0; i < census.labels.length; i++)
      if (census.labels[i] === component) sites.push(i);
    if (sites.length !== census.components[component].cells)
      throw new Error("birth tracker support differs from physical census");
    return { id, role, status: "available", sites,
      sitesSha256: shaSites(event.step, id, sites) };
  });
  return { step: event.step, event, branches,
    reference: "birth-census-branch-copy-support" };
}

export type ResetBranchSample = {
  id: number; role: ResetBirthBranch["role"];
  status: "available" | "unavailable-birth-support" | "observed-copy-loss" |
    "unknown-copy-origin";
  genomeBearingCopySites: number;
  copyAssociatedBoundCarrierMass: number;
  physicalComponents: number[];
};
export type ResetComparisonSample = {
  comparisonId: number;
  status: "sampled-disconnected" | "shared-physical-support" |
    "known-copy-disconnected-unknown-origin" | "observed-copy-loss" |
    "unavailable-birth-support" | "unknown-copy-origin" |
    "below-graph-threshold";
};
export type ResetFollowupSample = {
  birthStep: number; step: number; timeSinceObservedBirth: number;
  rule: ResetTopologyRule;
  branches: ResetBranchSample[];
  comparisons: ResetComparisonSample[];
  unknownGenomeBearingCopySites: number;
  /** These are sampled graph/copy associations, never exclusive entity identities. */
  interpretation: "sampled-descendant-associated-copy-support-not-viability";
};

/** Score one of the eleven t..t+1000 samples against composed birth-t copy origins. */
export function resetFollowupSample(cfg: WorldConfig, birth: ResetBirthReferences,
  origin: ResetOriginMap, cells: Uint32Array, genomeHead: Uint32Array,
  rule: ResetTopologyRule): ResetFollowupSample {
  const n = cellCount(cfg);
  if (origin.referenceStep !== birth.step || origin.currentStep < birth.step ||
      origin.currentStep > birth.step + 1000 || (origin.currentStep - birth.step) % 100 !== 0 ||
      origin.origins.length !== n || cells.length !== 7 * n || genomeHead.length < 2 * n)
    throw new Error("follow-up sample lacks exact birth reference, cadence or physical geometry");
  const topology = resetTopology(cfg, cells, rule);
  let unknownGenomeBearingCopySites = 0;
  for (let i = 0; i < n; i++)
    if ((genomeHead[G.LIN_HI * n + i] | genomeHead[G.LIN_LO * n + i]) !== 0 &&
        origin.origins[i] === 0) unknownGenomeBearingCopySites++;
  const branches: ResetBranchSample[] = birth.branches.map(branch => {
    if (!branch.sites) return { id: branch.id, role: branch.role,
      status: "unavailable-birth-support", genomeBearingCopySites: 0,
      copyAssociatedBoundCarrierMass: 0, physicalComponents: [] };
    const sourceSites = new Set(branch.sites);
    if (sourceSites.size !== branch.sites.length ||
        [...sourceSites].some(site => !Number.isSafeInteger(site) || site < 0 || site >= n) ||
        shaSites(birth.step, branch.id, branch.sites) !== branch.sitesSha256)
      throw new Error("follow-up birth branch membership changed");
    let genomeBearingCopySites = 0, copyAssociatedBoundCarrierMass = 0;
    const components = new Set<number>();
    for (let i = 0; i < n; i++) {
      const source = origin.origins[i];
      if (source > n) throw new Error("follow-up origin outside source geometry");
      if (source === 0 || !sourceSites.has(source - 1) ||
          (genomeHead[G.LIN_HI * n + i] | genomeHead[G.LIN_LO * n + i]) === 0) continue;
      genomeBearingCopySites++;
      copyAssociatedBoundCarrierMass += cells[CH.B * n + i] + cells[CH.P * n + i];
      if (topology.labels[i] >= 0) components.add(topology.labels[i]);
    }
    return { id: branch.id, role: branch.role,
      status: genomeBearingCopySites ? "available" :
        unknownGenomeBearingCopySites ? "unknown-copy-origin" : "observed-copy-loss",
      genomeBearingCopySites, copyAssociatedBoundCarrierMass,
      physicalComponents: [...components].sort((a, b) => a - b) };
  });
  const focal = branches[0];
  const comparisons: ResetComparisonSample[] = branches.slice(1).map(other => {
    let status: ResetComparisonSample["status"];
    if (focal.status === "unavailable-birth-support" ||
        other.status === "unavailable-birth-support") status = "unavailable-birth-support";
    else if (focal.status === "unknown-copy-origin" || other.status === "unknown-copy-origin")
      status = "unknown-copy-origin";
    else if (focal.status === "observed-copy-loss" || other.status === "observed-copy-loss")
      status = "observed-copy-loss";
    else if (!focal.physicalComponents.length || !other.physicalComponents.length)
      status = "below-graph-threshold";
    else status = other.physicalComponents.some(x => focal.physicalComponents.includes(x)) ?
      "shared-physical-support" : unknownGenomeBearingCopySites ?
        "known-copy-disconnected-unknown-origin" : "sampled-disconnected";
    return { comparisonId: other.id, status };
  });
  return { birthStep: birth.step, step: origin.currentStep,
    timeSinceObservedBirth: origin.currentStep - birth.step, rule, branches, comparisons,
    unknownGenomeBearingCopySites,
    interpretation: "sampled-descendant-associated-copy-support-not-viability" };
}
