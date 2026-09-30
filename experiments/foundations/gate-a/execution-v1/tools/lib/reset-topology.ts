/** Pure within-tile toroidal connectivity and per-step copy-associated split flags. */
import { CH, G, cellCount, worldW, type WorldConfig } from "@bl/schema";
import type { ResetOriginMap } from "./reset-copy-extraction.ts";

export type ResetTopologyRule = { threshold: 1 | 48; neighbors: 4 | 8 };
export interface ResetPhysicalComponent {
  index: number; tile: number; cells: number; boundMass: number;
}
export interface ResetTopology {
  rule: ResetTopologyRule; labels: Int32Array;
  components: ResetPhysicalComponent[];
}

export function resetTopology(cfg: WorldConfig, cells: Uint32Array,
  rule: ResetTopologyRule): ResetTopology {
  const n = cellCount(cfg), width = worldW(cfg);
  if (cells.length !== 7 * n || ![1, 48].includes(rule.threshold) ||
      ![4, 8].includes(rule.neighbors))
    throw new Error("topology requires full cells and fixed graph rule");
  const labels = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  const components: ResetPhysicalComponent[] = [];
  const mass = (i: number) => cells[CH.B * n + i] + cells[CH.P * n + i];
  const directions = rule.neighbors === 4 ?
    [[1, 0], [-1, 0], [0, 1], [0, -1]] :
    [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || mass(start) < rule.threshold) continue;
    const x0 = start % width, y0 = Math.floor(start / width);
    const tx = Math.floor(x0 / cfg.tileW), ty = Math.floor(y0 / cfg.tileH);
    const tile = ty * cfg.tilesX + tx, index = components.length;
    let head = 0, tail = 0, boundMass = 0;
    queue[tail++] = start; labels[start] = index;
    while (head < tail) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      boundMass += mass(i);
      const lx = x - tx * cfg.tileW, ly = y - ty * cfg.tileH;
      for (const [dx, dy] of directions) {
        const nx = tx * cfg.tileW + ((lx + dx + cfg.tileW) % cfg.tileW);
        const ny = ty * cfg.tileH + ((ly + dy + cfg.tileH) % cfg.tileH);
        const j = ny * width + nx;
        if (labels[j] !== -1 || mass(j) < rule.threshold) continue;
        labels[j] = index; queue[tail++] = j;
      }
    }
    components.push({ index, tile, cells: tail, boundMass });
  }
  return { rule, labels, components };
}

export interface ResetFragmentationBranch {
  currentComponent: number; currentMass: number; copiedSitesFromPrior: number;
  /** Geometry overlap at the preceding step; it is not inherited matter. */
  preexistingOtherBoundSites: number;
  preexistingOtherBoundCarrierMass: number;
}
export interface ResetFragmentationFlag {
  step: number; priorComponent: number; priorMass: number;
  branches: ResetFragmentationBranch[];
  interpretation: "copy-associated-separation-candidate-not-birth";
}

/** One-step flags only. No episode grouping, unique event counts or tracker-event matching. */
export function resetFragmentationFlags(cfg: WorldConfig, step: number,
  priorCells: Uint32Array, currentCells: Uint32Array, currentGenomeHead: Uint32Array,
  oneStepOrigins: ResetOriginMap): ResetFragmentationFlag[] {
  const n = cellCount(cfg);
  if (step !== oneStepOrigins.currentStep || oneStepOrigins.referenceStep !== step - 1 ||
      priorCells.length !== 7 * n || currentCells.length !== 7 * n ||
      currentGenomeHead.length < 2 * n || oneStepOrigins.origins.length !== n)
    throw new Error("fragmentation flag requires exact adjacent physical steps");
  const rule: ResetTopologyRule = { threshold: 1, neighbors: 8 };
  const before = resetTopology(cfg, priorCells, rule);
  const after = resetTopology(cfg, currentCells, rule);
  const linked = new Map<number, Map<number, number>>();
  const preexisting = new Map<number, { sites: number; mass: number;
    byPrior: Map<number, { sites: number; mass: number }> }>();
  for (let i = 0; i < n; i++) {
    const current = after.labels[i], tag = oneStepOrigins.origins[i];
    const previousAtSameSite = before.labels[i];
    if (current >= 0 && previousAtSameSite >= 0) {
      const record = preexisting.get(current) ??
        { sites: 0, mass: 0, byPrior: new Map() };
      const mass = currentCells[CH.B * n + i] + currentCells[CH.P * n + i];
      record.sites++; record.mass += mass;
      const same = record.byPrior.get(previousAtSameSite) ?? { sites: 0, mass: 0 };
      same.sites++; same.mass += mass;
      record.byPrior.set(previousAtSameSite, same);
      preexisting.set(current, record);
    }
    if (current < 0 || tag === 0 ||
        (currentGenomeHead[G.LIN_HI * n + i] |
          currentGenomeHead[G.LIN_LO * n + i]) === 0) continue;
    if (tag > n) throw new Error("fragmentation tag outside prior geometry");
    const prior = before.labels[tag - 1];
    if (prior < 0) continue;
    const destinations = linked.get(prior) ?? new Map<number, number>();
    destinations.set(current, (destinations.get(current) ?? 0) + 1);
    linked.set(prior, destinations);
  }
  const flags: ResetFragmentationFlag[] = [];
  for (const [prior, destinations] of linked) {
    const qualifying = [...destinations].filter(([current]) =>
      after.components[current].boundMass >= 256);
    if (qualifying.length < 2) continue;
    const branches: ResetFragmentationBranch[] = qualifying.map(([current, copied]) => {
      const aggregate = preexisting.get(current);
      const same = aggregate?.byPrior.get(prior);
      const preexistingOtherBoundSites = (aggregate?.sites ?? 0) - (same?.sites ?? 0);
      const preexistingOtherBoundCarrierMass = (aggregate?.mass ?? 0) -
        (same?.mass ?? 0);
      return { currentComponent: current,
        currentMass: after.components[current].boundMass,
        copiedSitesFromPrior: copied, preexistingOtherBoundSites,
        preexistingOtherBoundCarrierMass };
    }).sort((a, b) => a.currentComponent - b.currentComponent);
    flags.push({ step, priorComponent: prior, priorMass: before.components[prior].boundMass,
      branches, interpretation: "copy-associated-separation-candidate-not-birth" });
  }
  return flags.sort((a, b) => a.priorComponent - b.priorComponent);
}
