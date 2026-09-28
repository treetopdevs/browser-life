/** Assay-side morphology and event-graph trajectory analysis. No simulator state changes. */
import { createHash } from "node:crypto";
import { CH, cellCount, worldW, type WorldConfig } from "@bl/schema";
import { census, type Census, type LifeEvent, type Tracker } from "@bl/metrics";
import type { SavedLifeEvent } from "./foundation-life.ts";

export const LIFECYCLE_CADENCE = 100;
export const MATCHED_AGES = [100, 200] as const;
export const LIFECYCLE_SELECTION_SALT = "foundation-lifecycle-trace-v1";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface Shape {
  cells: number; mass: number; biomass: number; membraneFraction: number;
  membraneCellStd: number; rimCoreMembraneDifference: number | null; compartmentalised: boolean;
  /** Means over the component's member cells, not external resource pools. */
  cellResourceMeans: { A: number; C: number; E: number; S: number };
}
export interface TrajectoryFrame extends Shape {
  step: number; id: number; componentIndex: number; tile: number;
  born: number; age: number | null; leftTruncated: boolean;
  lineage: string; purity: number;
}
export interface ObservedWindow {
  startStep: number; endStep: number; frames: TrajectoryFrame[];
  life: SavedLifeEvent[]; trackerEvents: LifeEvent[];
  overlapMixing: OverlapMixing[];
  censusDigests: { step: number; labelsSha256: string; eligibleComponents: number; trackedIndividuals: number }[];
  /** Exact component membership is retained only for selected families and their controls. */
  membership: { step: number; id: number; ranges: [number, number][] }[];
}
export interface OverlapMixing { step: number; componentIndex: number; currentId: number; priorIds: number[] }

/** Independent of Tracker fusion rows: a crossing split can mix two prior IDs while both continue elsewhere. */
export function overlappingPriorIdentities(previousLabels: Int32Array, previousIds: ReadonlyMap<number, number>,
  current: Census, currentIdOf: (componentIndex: number) => number | undefined, minMass: number): OverlapMixing[] {
  if (previousLabels.length !== current.labels.length) throw new Error("overlap label geometry mismatch");
  const byComponent = new Map<number, Set<number>>();
  for (let i = 0; i < current.labels.length; i++) {
    const p = previousLabels[i], q = current.labels[i];
    if (p < 0 || q < 0 || current.components[q].mass < minMass) continue;
    const id = previousIds.get(p);
    if (id === undefined) continue;
    const ids = byComponent.get(q) ?? new Set<number>();
    ids.add(id); byComponent.set(q, ids);
  }
  return [...byComponent.entries()].filter(([, ids]) => ids.size > 1).map(([componentIndex, ids]) => {
    const currentId = currentIdOf(componentIndex);
    if (currentId === undefined) throw new Error("mixed tracked component lacks current identity");
    return { step: current.step, componentIndex, currentId, priorIds: [...ids].sort((a, b) => a - b) };
  }).sort((a, b) => a.componentIndex - b.componentIndex);
}

/** Mirrors the existing aggregate morphology's per-cell membrane and rim/core definitions. */
export function componentShapes(cfg: WorldConfig, cells: Uint32Array, c: Census): Shape[] {
  const n = cellCount(cfg), W = worldW(cfg);
  if (cells.length !== n * 7 || c.labels.length !== n) throw new Error("component morphology buffer length mismatch");
  const sums = c.components.map(() => ({ mass: 0, biomass: 0, polymer: 0, f: 0, f2: 0, count: 0,
    rim: 0, rimN: 0, core: 0, coreN: 0, A: 0, C: 0, E: 0, S: 0 }));
  for (let i = 0; i < n; i++) {
    const label = c.labels[i];
    if (label < 0) continue;
    const s = sums[label], b = cells[CH.B * n + i], p = cells[CH.P * n + i], m = b + p;
    const f = p / Math.max(1, m);
    s.mass += m; s.biomass += b; s.polymer += p; s.f += f; s.f2 += f * f; s.count++;
    s.A += cells[CH.A * n + i]; s.C += cells[CH.C * n + i];
    s.E += cells[CH.E * n + i]; s.S += cells[CH.S * n + i];
    const x = i % W, y = (i - x) / W;
    const ox = x - x % cfg.tileW, oy = y - y % cfg.tileH;
    const at = (dx: number, dy: number) =>
      (oy + ((y - oy + dy + cfg.tileH) % cfg.tileH)) * W + ox + ((x - ox + dx + cfg.tileW) % cfg.tileW);
    if (c.labels[at(1, 0)] !== label || c.labels[at(-1, 0)] !== label ||
        c.labels[at(0, 1)] !== label || c.labels[at(0, -1)] !== label) { s.rim += f; s.rimN++; }
    else { s.core += f; s.coreN++; }
  }
  return c.components.map((component, i) => {
    const s = sums[i], mean = s.f / Math.max(1, s.count);
    if (s.count !== component.cells || s.mass !== component.mass || s.biomass !== component.biomass)
      throw new Error(`component ${i} morphology disagrees with census`);
    const rimCore = s.rimN && s.coreN ? s.rim / s.rimN - s.core / s.coreN : null;
    return { cells: s.count, mass: s.mass, biomass: s.biomass,
      membraneFraction: s.polymer / Math.max(1, s.mass),
      membraneCellStd: Math.sqrt(Math.max(0, s.f2 / Math.max(1, s.count) - mean * mean)),
      rimCoreMembraneDifference: rimCore, compartmentalised: rimCore !== null && rimCore > 0.15,
      cellResourceMeans: { A: s.A / Math.max(1, s.count), C: s.C / Math.max(1, s.count),
        E: s.E / Math.max(1, s.count), S: s.S / Math.max(1, s.count) } };
  });
}

export function frameAtCensus(c: Census, cells: Uint32Array, cfg: WorldConfig, tracker: Tracker,
  startStep: number): TrajectoryFrame[] {
  const shapes = componentShapes(cfg, cells, c);
  const frames: TrajectoryFrame[] = [];
  for (const component of c.components) {
    const id = tracker.idOf(component.idx);
    if (id === undefined) continue;
    const individual = tracker.alive.get(id);
    if (!individual) throw new Error(`tracker id ${id} has no live individual`);
    frames.push({ ...shapes[component.idx], step: c.step, id, componentIndex: component.idx,
      tile: component.tile, born: individual.born,
      age: individual.born > startStep ? c.step - individual.born : null,
      leftTruncated: individual.born <= startStep, lineage: component.lineage, purity: component.purity });
  }
  if (frames.length !== tracker.alive.size) throw new Error("tracker and census component count differ");
  return frames;
}

export function labelDigest(labels: Int32Array): string {
  return createHash("sha256").update(new Uint8Array(labels.buffer, labels.byteOffset, labels.byteLength)).digest("hex");
}

export function memberRanges(labels: Int32Array, componentIndex: number): [number, number][] {
  const ranges: [number, number][] = [];
  for (let i = 0; i < labels.length;) {
    if (labels[i] !== componentIndex) { i++; continue; }
    const begin = i;
    while (i < labels.length && labels[i] === componentIndex) i++;
    ranges.push([begin, i - begin]);
  }
  return ranges;
}

export interface LifeOutcome { status: "observed" | "death" | "fusion" | "overlap-mixed" | "right-censored" | "missing";
  step: number | null; age: number | null }
export interface TraitPair { age: number; parentId: number; childId: number;
  parentMass: number; childMass: number; parentMembraneFraction: number; childMembraneFraction: number;
  parentCompartmentalised: boolean; childCompartmentalised: boolean }
export interface Chain {
  ids: [number, number, number]; births: [number, number, number];
  g2Age200: LifeOutcome; g2NextFission: LifeOutcome;
  g0g1: TraitPair[]; g1g2: TraitPair[];
  nonlinkedObserverFamilyControls: { link: "g0g1" | "g1g2"; age: number; controlParentId: number | null; pair: TraitPair | null }[];
  /** Hashed matched reassignment with replacement, not a bijective permutation. */
  matchedParentReassignmentControls: { link: "g0g1" | "g1g2"; parentId: number | null; pairs: TraitPair[] }[];
  ambiguousGeneticIdentity: boolean;
}
export interface LifecycleAnalysis {
  scope: "one-source-in-situ-observer-traceability";
  denominators: { baselineLeftTruncated: number; postBaselineIntroduced: number; fissionChildren: number;
    cleanFissionEdges: number; rawThreeIdentityChains: number; cleanThreeIdentityChains: number;
    overlapMixedComponents: number; overlapMixedWithoutTrackerFusion: number;
    age200Observed: number; age200Death: number; age200Fusion: number; age200OverlapMixed: number;
    age200RightCensored: number; age200Missing: number;
    g2Reproduced: number; g2DeathBeforeReproduction: number; g2FusionBeforeReproduction: number;
    g2OverlapMixedBeforeReproduction: number;
    g2RightCensoredBeforeReproduction: number; nonlinkedMatchedPairs: number; nonlinkedUnmatchedPairs: number;
    reassignmentAvailable: number; reassignmentUnavailable: number };
  selectedChains: Chain[]; allRawChainIds: [number, number, number][]; allCleanChainIds: [number, number, number][];
  limitations: string[];
}

/** Topology is assessed before traits, so missing ages remain missing rather than selecting successful families. */
export function analyzeLifecycle(window: ObservedWindow, selectionKey: string, maxSelected = 16): LifecycleAnalysis {
  const { startStep: start, endStep: end } = window;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start ||
      (end - start) % LIFECYCLE_CADENCE !== 0 || !Number.isSafeInteger(maxSelected) || maxSelected < 0)
    throw new Error("invalid lifecycle analysis window");
  const rowsById = new Map<number, Map<number, TrajectoryFrame>>();
  for (const frame of window.frames) {
    if (frame.step < start || frame.step > end || (frame.step - start) % LIFECYCLE_CADENCE ||
        frame.id <= 0 || !Number.isFinite(frame.mass) || !Number.isFinite(frame.membraneFraction))
      throw new Error("invalid lifecycle frame");
    const byStep = rowsById.get(frame.id) ?? new Map<number, TrajectoryFrame>();
    if (byStep.has(frame.step)) throw new Error("duplicate lifecycle frame");
    byStep.set(frame.step, frame); rowsById.set(frame.id, byStep);
  }
  const baselineLeftTruncated = window.frames.filter((f) => f.step === start && f.leftTruncated).length;
  const born = new Map<number, { step: number; origin: "fission" | "birth" | "budding"; parent?: number }>();
  const fusion = new Map<number, number>(), death = new Map<number, number>(), mixed = new Map<number, number>(),
    fissions = new Map<number, number[]>();
  const edges: { parent: number; child: number; step: number }[] = [];
  let fissionChildren = 0;
  const setFirst = (map: Map<number, number>, id: number, step: number) => map.set(id, Math.min(map.get(id) ?? Infinity, step));
  for (const overlap of window.overlapMixing) {
    if (overlap.step <= start || overlap.step > end || overlap.priorIds.length < 2 ||
        new Set(overlap.priorIds).size !== overlap.priorIds.length)
      throw new Error("invalid overlap-mixed observation");
    setFirst(mixed, overlap.currentId, overlap.step);
  }
  for (const e of window.life) {
    if (e.step <= start || e.step > end || e.step % LIFECYCLE_CADENCE) throw new Error("life event outside lifecycle schedule");
    if (e.kind === "fission") {
      fissionChildren += e.children.length;
      fissions.set(e.parent, [...(fissions.get(e.parent) ?? []), e.step]);
      for (const child of e.children) {
        if (born.has(child)) throw new Error("duplicate fission child");
        born.set(child, { step: e.step, origin: "fission", parent: e.parent });
        edges.push({ parent: e.parent, child, step: e.step });
      }
    } else if (e.kind === "birth") {
      if (born.has(e.id)) throw new Error("duplicate birth");
      born.set(e.id, { step: e.step, origin: "birth" });
    } else if (e.kind === "budding") {
      if (born.has(e.child)) throw new Error("duplicate budding");
      born.set(e.child, { step: e.step, origin: "budding", parent: e.parent });
    } else if (e.kind === "death") setFirst(death, e.id, e.step);
    else if (e.kind === "fusion") for (const id of [...e.parents, e.child]) setFirst(fusion, id, e.step);
  }
  const eventBeforeOrAt = (id: number, step: number) => (fusion.get(id) ?? Infinity) <= step;
  const cleanEdges = edges.filter((edge) => {
    const pBorn = born.get(edge.parent)?.step ?? start;
    return !eventBeforeOrAt(edge.parent, edge.step) && !eventBeforeOrAt(edge.child, edge.step) &&
      (mixed.get(edge.parent) ?? Infinity) > edge.step && (mixed.get(edge.child) ?? Infinity) > edge.step &&
      (death.get(edge.parent) ?? Infinity) > edge.step && edge.step > pBorn;
  });
  const byParent = new Map<number, typeof cleanEdges>();
  for (const edge of cleanEdges) byParent.set(edge.parent, [...(byParent.get(edge.parent) ?? []), edge]);
  const allChains: [number, number, number][] = [];
  for (const first of cleanEdges) {
    if (!born.has(first.parent)) continue; // checkpoint cohort has unknown age
    for (const second of byParent.get(first.child) ?? []) allChains.push([first.parent, first.child, second.child]);
  }
  const rawChains = edges.flatMap((first) => (edges.filter((second) => second.parent === first.child && born.has(first.parent))
    .map((second) => [first.parent, first.child, second.child] as [number, number, number])));
  const picked = [...allChains].sort((a, b) => sha(`${LIFECYCLE_SELECTION_SALT}\n${selectionKey}\n${a.join(":")}`)
    .localeCompare(sha(`${LIFECYCLE_SELECTION_SALT}\n${selectionKey}\n${b.join(":")}`))).slice(0, maxSelected);
  const frame = (id: number, step: number) => rowsById.get(id)?.get(step);
  const outcome = (id: number, birth: number, target: number): LifeOutcome => {
    const fusionStep = fusion.get(id) ?? Infinity, deathStep = death.get(id) ?? Infinity;
    const mixStep = mixed.get(id) ?? Infinity;
    if (mixStep <= target && mixStep <= fusionStep && mixStep <= deathStep)
      return { status: "overlap-mixed", step: mixStep, age: mixStep - birth };
    if (fusionStep <= target && fusionStep <= deathStep) return { status: "fusion", step: fusionStep, age: fusionStep - birth };
    if (deathStep <= target) return { status: "death", step: deathStep, age: deathStep - birth };
    if (target > end) return { status: "right-censored", step: end, age: end - birth };
    if (!frame(id, target)) return { status: "missing", step: target, age: target - birth };
    return { status: "observed", step: target, age: target - birth };
  };
  const nextFission = (id: number, birth: number): LifeOutcome => {
    const f = (fissions.get(id) ?? []).find((step) => step > birth) ?? Infinity;
    const competing = Math.min(fusion.get(id) ?? Infinity, death.get(id) ?? Infinity, mixed.get(id) ?? Infinity);
    if (Number.isFinite(competing) && competing <= f) return {
      status: mixed.get(id) === competing ? "overlap-mixed" : fusion.get(id) === competing ? "fusion" : "death",
      step: competing, age: competing - birth };
    if (f !== Infinity) return { status: "observed", step: f, age: f - birth };
    return { status: "right-censored", step: end, age: end - birth };
  };
  const traitPair = (p: number, child: number, age: number): TraitPair | null => {
    const pb = born.get(p)?.step, cb = born.get(child)?.step;
    if (pb === undefined || cb === undefined || outcome(p, pb, pb + age).status !== "observed" ||
        outcome(child, cb, cb + age).status !== "observed") return null;
    const pr = frame(p, pb + age)!, cr = frame(child, cb + age)!;
    return { age, parentId: p, childId: child, parentMass: pr.mass, childMass: cr.mass,
      parentMembraneFraction: pr.membraneFraction, childMembraneFraction: cr.membraneFraction,
      parentCompartmentalised: pr.compartmentalised, childCompartmentalised: cr.compartmentalised };
  };
  const rootOf = (id: number): number => {
    const seen = new Set<number>();
    while (born.get(id)?.parent !== undefined) {
      if (seen.has(id)) throw new Error("cycle in saved observer ancestry");
      seen.add(id); id = born.get(id)!.parent!;
    }
    return id;
  };
  const resourceBin = (f: TrajectoryFrame) => [f.cellResourceMeans.A, f.cellResourceMeans.C,
    f.cellResourceMeans.E, f.cellResourceMeans.S].map((v) => Math.floor(v / 128)).join(":");
  const unrelated = (p: number, child: number, age: number): { controlParentId: number | null; pair: TraitPair | null } => {
    const ref = frame(p, born.get(p)!.step), refBirth = born.get(p)!.step;
    if (!ref) return { controlParentId: null, pair: null };
    const bin = (v: number) => Math.floor(Math.log2(Math.max(1, v)));
    const choices = [...born.keys()].filter((id) => rootOf(id) !== rootOf(p) && rootOf(id) !== rootOf(child) &&
      Math.abs(born.get(id)!.step - refBirth) <= LIFECYCLE_CADENCE)
      .filter((id) => { const f = frame(id, born.get(id)!.step);
        return !!f && f.tile === ref.tile && bin(f.mass) === bin(ref.mass) && resourceBin(f) === resourceBin(ref) &&
          traitPair(id, child, age) !== null; });
    choices.sort((a, b) => sha(`${selectionKey}:${p}:${child}:${age}:${a}`)
      .localeCompare(sha(`${selectionKey}:${p}:${child}:${age}:${b}`)));
    const id = choices[0];
    return id === undefined ? { controlParentId: null, pair: null } : { controlParentId: id, pair: traitPair(id, child, age) };
  };
  const chains: Chain[] = picked.map((ids) => {
    const births = ids.map((id) => born.get(id)!.step) as [number, number, number];
    const g0g1 = MATCHED_AGES.flatMap((age) => traitPair(ids[0], ids[1], age) ?? []);
    const g1g2 = MATCHED_AGES.flatMap((age) => traitPair(ids[1], ids[2], age) ?? []);
    const nonlinkedObserverFamilyControls = (["g0g1", "g1g2"] as const).flatMap((link, index) =>
      MATCHED_AGES.map((age) => ({ link, age, ...unrelated(ids[index], ids[index + 1], age) })));
    const ambiguousGeneticIdentity = ids.some((id) => [...(rowsById.get(id)?.values() ?? [])].some((f) => f.purity < 1));
    return { ids, births, g2Age200: outcome(ids[2], births[2], births[2] + 200),
      g2NextFission: nextFission(ids[2], births[2]), g0g1, g1g2, nonlinkedObserverFamilyControls,
      matchedParentReassignmentControls: [{ link: "g0g1", parentId: null, pairs: [] },
        { link: "g1g2", parentId: null, pairs: [] }], ambiguousGeneticIdentity };
  });
  // Deterministic matched reassignment with replacement; unavailable if no nonlinked family fits.
  for (const chain of chains) for (const item of chain.matchedParentReassignmentControls) {
    const index = item.link === "g0g1" ? 0 : 1, p = chain.ids[index];
    const target = frame(p, chain.births[index]);
    if (!target) continue;
    const choices = chains.filter((other) => other !== chain && rootOf(other.ids[index]) !== rootOf(chain.ids[index + 1]) &&
      Math.abs(other.births[index] - chain.births[index]) <= LIFECYCLE_CADENCE)
      .filter((other) => { const f = frame(other.ids[index], other.births[index]);
        return !!f && f.tile === target.tile && Math.floor(Math.log2(Math.max(1, f.mass))) ===
          Math.floor(Math.log2(Math.max(1, target.mass))) && resourceBin(f) === resourceBin(target) &&
          MATCHED_AGES.some((age) => traitPair(other.ids[index], chain.ids[index + 1], age) !== null); });
    choices.sort((a, b) => sha(`${selectionKey}:shuffle:${chain.ids.join(":")}:${item.link}:${a.ids[index]}`)
      .localeCompare(sha(`${selectionKey}:shuffle:${chain.ids.join(":")}:${item.link}:${b.ids[index]}`)));
    item.parentId = choices[0]?.ids[index] ?? null;
    item.pairs = item.parentId === null ? [] : MATCHED_AGES.flatMap((age) =>
      traitPair(item.parentId!, chain.ids[index + 1], age) ?? []);
  }
  const ageOutcomes = allChains.map((ids) => outcome(ids[2], born.get(ids[2])!.step,
    born.get(ids[2])!.step + 200).status);
  const reproduction = allChains.map((ids) => nextFission(ids[2], born.get(ids[2])!.step).status);
  const controlRows = chains.flatMap((c) => c.nonlinkedObserverFamilyControls);
  const reassigned = chains.flatMap((c) => c.matchedParentReassignmentControls);
  return { scope: "one-source-in-situ-observer-traceability",
    denominators: { baselineLeftTruncated, postBaselineIntroduced: born.size, fissionChildren,
      cleanFissionEdges: cleanEdges.length, rawThreeIdentityChains: rawChains.length,
      cleanThreeIdentityChains: allChains.length,
      overlapMixedComponents: window.overlapMixing.length,
      overlapMixedWithoutTrackerFusion: window.overlapMixing.filter((m) => !window.life.some((e) =>
        e.kind === "fusion" && e.step === m.step && (e.child === m.currentId || e.parents.includes(m.currentId)))).length,
      age200Observed: ageOutcomes.filter((s) => s === "observed").length,
      age200Death: ageOutcomes.filter((s) => s === "death").length,
      age200Fusion: ageOutcomes.filter((s) => s === "fusion").length,
      age200OverlapMixed: ageOutcomes.filter((s) => s === "overlap-mixed").length,
      age200RightCensored: ageOutcomes.filter((s) => s === "right-censored").length,
      age200Missing: ageOutcomes.filter((s) => s === "missing").length,
      g2Reproduced: reproduction.filter((s) => s === "observed").length,
      g2DeathBeforeReproduction: reproduction.filter((s) => s === "death").length,
      g2FusionBeforeReproduction: reproduction.filter((s) => s === "fusion").length,
      g2OverlapMixedBeforeReproduction: reproduction.filter((s) => s === "overlap-mixed").length,
      g2RightCensoredBeforeReproduction: reproduction.filter((s) => s === "right-censored").length,
      nonlinkedMatchedPairs: controlRows.filter((r) => r.pair !== null).length,
      nonlinkedUnmatchedPairs: controlRows.filter((r) => r.pair === null).length,
      reassignmentAvailable: reassigned.filter((r) => r.parentId !== null).length,
      reassignmentUnavailable: reassigned.filter((r) => r.parentId === null).length },
    selectedChains: chains, allRawChainIds: rawChains, allCleanChainIds: allChains,
    limitations: ["One physical source and overlapping families are not independent replicates; no heritability p-value is defined.",
      "Tracker's largest-overlap fragment keeps its parent's ID and birth step; these are asymmetric observer-identity ages, not organism generations.",
      "Observer fission edges are topology labels, not verified organism reproduction; unreported overlap mixing is independently marked.",
      "Age-200 persistence of G2 is distinct from G2 itself reproducing; fusion is a competing event.",
      "Member-cell resource means are not controlled external environments; common gardens remain necessary.",
      "Nonlinked controls exclude known observer ancestry only; shared genetic origin and unobserved historical relatedness remain possible.",
      "Matched parent reassignment is with replacement, not a permutation or independent null distribution.",
      "Dominant lineage and purity do not prove identical full genomes or inherited morphology."] };
}

export function censusSnapshot(cfg: WorldConfig, step: number, cells: Uint32Array, genomeHead: Uint32Array): Census {
  return census({ cfg, step, cells, genomeHead });
}
