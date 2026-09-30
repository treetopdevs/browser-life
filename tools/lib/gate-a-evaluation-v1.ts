/** Gate A operational geometry and conservative classifiers. Observer functions never mutate inputs. */
import { CH, CELL_CHANNELS, GENOME_CHANNELS, cellCount, cloneState, worldW, type WorldConfig, type WorldState } from "@bl/schema";
import { resetTopology, type ResetTopologyRule } from "./reset-topology.ts";

export const PRIMARY_RULE: ResetTopologyRule = { threshold: 48, neighbors: 8 };
export const SENSITIVITY_RULE: ResetTopologyRule = { threshold: 1, neighbors: 8 };
export type Role = "photo" | "grow" | "decomp" | "resp";
export const ROLES: readonly Role[] = ["photo", "grow", "decomp", "resp"];
export type RoleTally = Record<Role, { activeSites: number; lowerBound: number }>;
export interface Support { index: number; sites: number[]; minSite: number; mass: number; perimeter: number; activeSiteFraction: number | null; roles: RoleTally | null }
export interface Frame { step: number; rule: ResetTopologyRule; labels: Int32Array; supports: Support[]; world: { boundMass: number; roles: RoleTally | null } }
export type LinkStatus = "unique" | "no-overlap" | "split" | "merge" | "missing-frame";
export interface Link { from: number; to: number | null; status: LinkStatus; overlapSites: number; successors: number[] }
export interface FocalState { origin: number; current: number | null; status: "linked" | "unresolved"; firstUnresolved: { step: number; reason: LinkStatus } | null }
export interface Calibration { status: "supported" | "refuted" | "unavailable"; reasons: string[] }

function emptyTally(): RoleTally { return { photo: { activeSites: 0, lowerBound: 0 }, grow: { activeSites: 0, lowerBound: 0 }, decomp: { activeSites: 0, lowerBound: 0 }, resp: { activeSites: 0, lowerBound: 0 } }; }
function addRoles(t: RoleTally, packed0: number, packed1: number): boolean {
  const values = [packed0 & 65535, packed0 >>> 16, packed1 & 65535, packed1 >>> 16];
  let active = false;
  ROLES.forEach((name, i) => { if (values[i]) { t[name].activeSites++; t[name].lowerBound += values[i]; active = true; } });
  return active;
}
export function supportFrame(cfg: WorldConfig, step: number, cells: Uint32Array, rule: ResetTopologyRule = PRIMARY_RULE, roles?: Uint32Array): Frame {
  const n = cellCount(cfg), w = worldW(cfg);
  if (!Number.isSafeInteger(step) || step < 0 || cells.length !== CELL_CHANNELS * n || (roles && roles.length !== 2 * n)) throw Error("malformed support frame");
  const topology = resetTopology(cfg, cells, rule);
  const sites = topology.components.map(() => [] as number[]), totals = topology.components.map(() => emptyTally()), active = topology.components.map(() => 0);
  const worldRoles = roles ? emptyTally() : null;
  let boundMass = 0;
  for (let i = 0; i < n; i++) {
    boundMass += cells[CH.B * n + i] + cells[CH.P * n + i];
    if (roles) addRoles(worldRoles!, roles[2 * i], roles[2 * i + 1]);
    const id = topology.labels[i]; if (id < 0) continue;
    sites[id].push(i);
    if (roles && addRoles(totals[id], roles[2 * i], roles[2 * i + 1])) active[id]++;
  }
  const supports: Support[] = topology.components.map((x, id) => {
    let perimeter = 0;
    for (const i of sites[id]) {
      const x0 = i % w, y0 = Math.floor(i / w), tx = Math.floor(x0 / cfg.tileW), ty = Math.floor(y0 / cfg.tileH);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx * cfg.tileW + ((x0 - tx * cfg.tileW + dx + cfg.tileW) % cfg.tileW);
        const ny = ty * cfg.tileH + ((y0 - ty * cfg.tileH + dy + cfg.tileH) % cfg.tileH);
        if (topology.labels[ny * w + nx] !== id) perimeter++;
      }
    }
    return { index: id, sites: sites[id], minSite: sites[id][0], mass: x.boundMass, perimeter,
      activeSiteFraction: roles ? active[id] / sites[id].length : null, roles: roles ? totals[id] : null };
  });
  return { step, rule, labels: topology.labels, supports, world: { boundMass, roles: worldRoles } };
}
export function chooseCandidate(frame: Frame): Support | null {
  return frame.supports.filter((x) => x.mass >= 256).sort((a, b) => b.mass - a.mass || a.minSite - b.minSite)[0] ?? null;
}
function overlapLink(before: Frame, after: Frame, from: number, expectedDelta: number): Link {
  if (after.step !== before.step + expectedDelta || before.rule.threshold !== after.rule.threshold || before.rule.neighbors !== after.rule.neighbors || before.labels.length !== after.labels.length || !before.supports[from]) return { from, to: null, status: "missing-frame", overlapSites: 0, successors: [] };
  const hits = new Map<number, number>();
  for (const site of before.supports[from].sites) { const id = after.labels[site]; if (id >= 0) hits.set(id, (hits.get(id) ?? 0) + 1); }
  const successors = [...hits.keys()].sort((a, b) => a - b);
  if (!successors.length) return { from, to: null, status: "no-overlap", overlapSites: 0, successors };
  if (successors.length > 1) return { from, to: null, status: "split", overlapSites: [...hits.values()].reduce((a, b) => a + b, 0), successors };
  const id = successors[0];
  const predecessors = new Set<number>();
  for (const site of after.supports[id].sites) { const prior = before.labels[site]; if (prior >= 0) predecessors.add(prior); }
  if (predecessors.size !== 1 || !predecessors.has(from)) return { from, to: null, status: "merge", overlapSites: hits.get(id)!, successors };
  return { from, to: id, status: "unique", overlapSites: hits.get(id)!, successors };
}
export function sensitivityOrigin(primary: Support, sensitivity: Frame): number | null {
  if (!primary.sites.length) return null;
  const ids = new Set(primary.sites.map((site) => sensitivity.labels[site]));
  return ids.size === 1 && !ids.has(-1) ? [...ids][0] : null;
}
export function linkSupport(before: Frame, after: Frame, from: number): Link { return overlapLink(before, after, from, 1); }
export function interventionLink(before: Frame, after: Frame, from: number): Link { return overlapLink(before, after, from, 0); }
export function initialFocal(origin: number): FocalState { return { origin, current: origin, status: "linked", firstUnresolved: null }; }
export function advanceFocal(state: FocalState, before: Frame, after: Frame): { focal: FocalState; link: Link | null } {
  if (state.status === "unresolved" || state.current === null) return { focal: state, link: null };
  const link = linkSupport(before, after, state.current);
  if (link.status !== "unique") return { focal: { ...state, current: null, status: "unresolved", firstUnresolved: { step: after.step, reason: link.status } }, link };
  return { focal: { ...state, current: link.to }, link };
}
export function isolateSupport(state: WorldState, support: Support): { state: WorldState; removedBoundMass: number; removedEnergy: number; removedSites: number } {
  const copy = cloneState(state), n = cellCount(copy.cfg), keep = new Set(support.sites);
  let removedBoundMass = 0, removedEnergy = 0, removedSites = 0;
  for (let i = 0; i < n; i++) if (!keep.has(i)) {
    const mass = copy.cells[CH.B * n + i] + copy.cells[CH.P * n + i], energy = copy.cells[CH.E * n + i];
    if (mass || energy) removedSites++;
    removedBoundMass += mass; removedEnergy += energy;
    for (const ch of [CH.B, CH.P, CH.E]) copy.cells[ch * n + i] = 0;
    for (let ch = 0; ch < GENOME_CHANNELS; ch++) copy.genome[ch * n + i] = 0;
  }
  return { state: copy, removedBoundMass, removedEnergy, removedSites };
}
export function lesionSupport(state: WorldState, support: Support): { state: WorldState; removedBoundMass: number; removedEnergy: number; fraction: number; residualMass: number; valid: boolean } {
  const copy = cloneState(state), n = cellCount(copy.cfg), target = support.mass * 0.3;
  let removedBoundMass = 0, removedEnergy = 0;
  for (const i of support.sites) {
    if (removedBoundMass >= target) break;
    removedBoundMass += copy.cells[CH.B * n + i] + copy.cells[CH.P * n + i];
    removedEnergy += copy.cells[CH.E * n + i];
    for (const ch of [CH.B, CH.P, CH.E]) copy.cells[ch * n + i] = 0;
    for (let ch = 0; ch < GENOME_CHANNELS; ch++) copy.genome[ch * n + i] = 0;
  }
  const fraction = support.mass ? removedBoundMass / support.mass : NaN, residualMass = support.mass - removedBoundMass;
  const residual = supportFrame(copy.cfg, copy.step, copy.cells);
  const originalSites = new Set(support.sites);
  const residualOverlaps = residual.supports.filter((x) => x.sites.some((site) => originalSites.has(site)));
  return { state: copy, removedBoundMass, removedEnergy, fraction, residualMass,
    valid: fraction >= 0.3 && fraction <= 0.5 && residualMass > 0 && residualOverlaps.length === 1 && residualOverlaps[0].mass >= 256 };
}
export function quenchSupport(state: WorldState): WorldState {
  const copy = cloneState(state), n = cellCount(copy.cfg);
  copy.genome.fill(0); copy.cells.fill(0, CH.E * n, (CH.E + 1) * n);
  return copy;
}
export interface WindowSample { frame: Frame; focal: FocalState; localActivity: boolean | null }
function finalFive(samples: WindowSample[], initialMass?: number): { last: WindowSample[] | null; error: Calibration | null } {
  if (samples.length !== 21 || samples.some((x, i) => x.frame.step !== samples[0].frame.step + i * 100 ||
      ![true, false, null].includes(x.localActivity) ||
      (x.focal.status === "linked" && (x.focal.current === null || !x.frame.supports[x.focal.current]))))
    return { last: null, error: { status: "unavailable", reasons: ["malformed or missing fixed 0..2000 samples"] } };
  if (initialMass !== undefined && (!Number.isFinite(initialMass) || initialMass <= 0))
    return { last: null, error: { status: "unavailable", reasons: ["invalid initial mass"] } };
  const last = samples.slice(-5);
  if (samples.some((x) => x.focal.status !== "linked" || x.focal.current === null))
    return { last: null, error: { status: "unavailable", reasons: ["focal identity unresolved"] } };
  if (last.some((x) => x.localActivity === null))
    return { last: null, error: { status: "unavailable", reasons: ["local activity unavailable"] } };
  return { last, error: null };
}
export function maintenance(samples: WindowSample[], initialMass: number): Calibration {
  const checked = finalFive(samples, initialMass); if (checked.error) return checked.error;
  const last = checked.last!, reasons: string[] = [];
  if (last.some((x) => x.frame.supports[x.focal.current!].mass < 0.5 * initialMass)) reasons.push("mass below 50% in final-five sample");
  if (last.some((x) => x.localActivity !== true)) reasons.push("no local activity in final-five window");
  return { status: reasons.length ? "refuted" : "supported", reasons };
}
export function recovery(samples: WindowSample[], initialMass: number, lesionValid: boolean): Calibration {
  if (!lesionValid) return { status: "unavailable", reasons: ["lesion calibration invalid"] };
  const checked = finalFive(samples, initialMass); if (checked.error) return checked.error;
  const last = checked.last!, reasons: string[] = [];
  if (last.some((x) => x.localActivity !== true)) reasons.push("no local activity in final-five window");
  if (last.at(-1)!.frame.supports[last.at(-1)!.focal.current!].mass < 0.9 * initialMass) reasons.push("final mass below 90% initial");
  return { status: reasons.length ? "refuted" : "supported", reasons };
}
export function negativeCalibration(samples: WindowSample[]): Calibration {
  const checked = finalFive(samples); if (checked.error) return checked.error;
  const last = checked.last!;
  return last.some((x) => x.localActivity) ? { status: "refuted", reasons: ["local metabolic activity observed"] } : { status: "supported", reasons: [] };
}
export type SyntheticProductionEvidence = { kind: "synthetic-classifier-control"; independentCausalEvidence: boolean; independentlyFunctioningDescendants: boolean };
export function productionEvidence(evidence: SyntheticProductionEvidence | null): { status: "supported-synthetic" | "unavailable"; reason: string } {
  return evidence?.kind === "synthetic-classifier-control" && evidence.independentCausalEvidence && evidence.independentlyFunctioningDescendants ?
    { status: "supported-synthetic", reason: "scripted classifier control only" } : { status: "unavailable", reason: "independent causal production and functioning descendants not established" };
}

export function overallCalibration(primary: Calibration, sensitivity: Calibration): Calibration {
  if (primary.status !== sensitivity.status) return { status: "unavailable", reasons: ["segmentation-dependent threshold disagreement"] };
  return { status: primary.status, reasons: [...new Set([...primary.reasons, ...sensitivity.reasons])] };
}
