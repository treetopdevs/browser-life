import { CH, cellCount, worldW, cloneState, maxLesionRadius, type WorldState } from "@bl/schema";
import { RefSim, applyLesion } from "@bl/sim-ref";
import { census } from "@bl/metrics";

export interface SeverityTarget { cells: readonly number[]; mass: number }
export interface SeverityCandidate {
  center: number;
  radius: number;
  damage: number;
  originalMass: number;
  collateral: number;
  survivingMass: number;
  remnantLabel: number;
  remnantMass: number;
  remnantTargetMass: number;
  remnantOverlapCells: number;
}
export interface CandidateCounts {
  enumerated: number;
  doseRejected: number;
  collateralRejected: number;
  noEligibleRemnant: number;
  fragmented: number;
  eligible: number;
}
export interface SeverityPair { parent: SeverityCandidate; mutant: SeverityCandidate }
const abs = (x: bigint) => x < 0n ? -x : x;
type Ratio = readonly [bigint, bigint];
const cmp = (a: Ratio, b: Ratio) => a[0] * b[1] < b[0] * a[1] ? -1 : a[0] * b[1] > b[0] * a[1] ? 1 : 0;

/** Pure zero-step selection. Counts partition all enumerated discs by first failed gate. */
export function enumerateCandidatesDetailed(state: WorldState, target: SeverityTarget): { candidates: SeverityCandidate[]; counts: CandidateCounts } {
  const n = cellCount(state.cfg), W = worldW(state.cfg);
  const { tileW, tileH } = state.cfg;
  const members = [...target.cells].sort((a, b) => a - b);
  if (!members.length || new Set(members).size !== members.length || members.some(i => !Number.isSafeInteger(i) || i < 0 || i >= n)) throw new Error("invalid target cells");
  const tileOf = (i: number) => Math.floor((i % W) / tileW) + state.cfg.tilesX * Math.floor(Math.floor(i / W) / tileH);
  if (members.some(i => tileOf(i) !== tileOf(members[0]))) throw new Error("target crosses tiles");
  const mass = (s: WorldState, i: number) => s.cells[CH.B * n + i] + s.cells[CH.P * n + i];
  const originalMass = members.reduce((sum, i) => sum + mass(state, i), 0);
  if (!Number.isSafeInteger(originalMass) || originalMass <= 0 || originalMass !== target.mass) throw new Error("target mass does not match original cells");
  const original = BigInt(originalMass), mask = new Set(members);
  const counts: CandidateCounts = { enumerated: 0, doseRejected: 0, collateralRejected: 0, noEligibleRemnant: 0, fragmented: 0, eligible: 0 };
  const candidates: SeverityCandidate[] = [];
  const maxR = Math.min(31, maxLesionRadius(state.cfg));
  for (const center of members) {
    const cx = center % W, cy = Math.floor(center / W);
    const tx = Math.floor(cx / tileW) * tileW, ty = Math.floor(cy / tileH) * tileH;
    // Ring histograms compute every radius before allocating any simulator/census.
    const damageRing = new Float64Array(maxR + 1), collateralRing = new Float64Array(maxR + 1);
    for (let y = ty; y < ty + tileH; y++) for (let x = tx; x < tx + tileW; x++) {
      const dx = Math.min(Math.abs(x - cx), tileW - Math.abs(x - cx));
      const dy = Math.min(Math.abs(y - cy), tileH - Math.abs(y - cy));
      const radius = Math.ceil(Math.sqrt(dx * dx + dy * dy));
      if (radius > maxR) continue;
      const i = y * W + x;
      (mask.has(i) ? damageRing : collateralRing)[radius] += mass(state, i);
    }
    let predictedDamage = damageRing[0], predictedCollateral = collateralRing[0];
    for (let radius = 1; radius <= maxR; radius++) {
      counts.enumerated++;
      predictedDamage += damageRing[radius]; predictedCollateral += collateralRing[radius];
      const d = BigInt(predictedDamage);
      if (40n * d < 15n * original || 40n * d > 17n * original) { counts.doseRejected++; continue; }
      if (20n * BigInt(predictedCollateral) > original) { counts.collateralRejected++; continue; }
      const post = cloneState(state);
      applyLesion(new RefSim(post), cx, cy, radius);
      const survivingMass = members.reduce((sum, i) => sum + mass(post, i), 0);
      const damage = originalMass - survivingMass;
      let collateral = 0;
      for (let i = 0; i < n; i++) if (!mask.has(i)) collateral += mass(state, i) - mass(post, i);
      if (damage !== predictedDamage || collateral !== predictedCollateral) throw new Error("lesion prediction differs from CPU operator");
      const c = census({ cfg: post.cfg, step: post.step, cells: post.cells, genomeHead: post.genome }, { threshold: 48, minMass: 128 });
      const votes = new Map<number, number>();
      for (const i of members) if (c.labels[i] >= 0) votes.set(c.labels[i], (votes.get(c.labels[i]) ?? 0) + 1);
      // Match v1: most original cells overlapping, then smallest census label.
      const winner = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      if (!winner || c.components[winner[0]].mass < 128) { counts.noEligibleRemnant++; continue; }
      const [remnantLabel, remnantOverlapCells] = winner;
      const remnantTargetMass = members.reduce((sum, i) => sum + (c.labels[i] === remnantLabel ? mass(post, i) : 0), 0);
      if (5n * BigInt(remnantTargetMass) < 4n * BigInt(survivingMass)) { counts.fragmented++; continue; }
      candidates.push({ center, radius, damage, originalMass, collateral, survivingMass, remnantLabel, remnantMass: c.components[remnantLabel].mass, remnantTargetMass, remnantOverlapCells });
      counts.eligible++;
    }
  }
  return { candidates, counts };
}
export function enumerateCandidates(state: WorldState, target: SeverityTarget): SeverityCandidate[] {
  return enumerateCandidatesDetailed(state, target).candidates;
}

function objective(parent: SeverityCandidate, mutant: SeverityCandidate): Ratio[] {
  const pm = BigInt(parent.originalMass), mm = BigInt(mutant.originalMass);
  const pd = BigInt(parent.damage), md = BigInt(mutant.damage);
  const pe: Ratio = [abs(5n * pd - 2n * pm), 5n * pm];
  const me: Ratio = [abs(5n * md - 2n * mm), 5n * mm];
  return [cmp(pe, me) >= 0 ? pe : me,
    [abs(pd * mm - md * pm), pm * mm],
    [BigInt(parent.collateral) * mm + BigInt(mutant.collateral) * pm, pm * mm],
    ...[parent.radius + mutant.radius, parent.center, mutant.center, parent.radius, mutant.radius].map(x => [BigInt(x), 1n] as const)];
}
/** Joint fixed lexicographic prescription; never uses recovery outcomes. */
export function selectPair(parentCandidates: readonly SeverityCandidate[], mutantCandidates: readonly SeverityCandidate[]): SeverityPair | null {
  let best: SeverityPair | null = null, bestObjective: Ratio[] | null = null;
  for (const parent of parentCandidates) for (const mutant of mutantCandidates) {
    const o = objective(parent, mutant);
    if (40n * o[1][0] > o[1][1]) continue;
    let order = -1;
    if (bestObjective) {
      order = 0;
      for (let i = 0; i < o.length; i++) { order = cmp(o[i], bestObjective[i]); if (order) break; }
    }
    if (order < 0) { best = { parent, mutant }; bestObjective = o; }
  }
  return best;
}
