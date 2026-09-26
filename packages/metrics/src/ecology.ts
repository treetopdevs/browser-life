// Ecological observables: reaction-flux rates, biotic recycling and
// trophic-role inference from each lineage's catalytic profile.

import { FLUX_NAMES, G, ROLE_WORDS, cellCount, type WorldConfig } from "@bl/schema";

export type FluxRates = Record<(typeof FLUX_NAMES)[number], number>;

/** Per-step rates between two cumulative flux snapshots. */
export function fluxRates(prev: bigint[], cur: bigint[], steps: number): FluxRates {
  const out = {} as FluxRates;
  FLUX_NAMES.forEach((k, i) => (out[k] = steps > 0 ? Number(cur[i] - prev[i]) / steps : 0));
  return out;
}

/**
 * Share of waste → nutrient recycling done by organisms rather than abiotic
 * photolysis. Under matter closure every quantum cycles eventually, so Finn's
 * cycling index is trivially 1; this is the informative closure measure.
 */
export function bioticRecycling(r: FluxRates): number {
  const tot = r.decomp + r.abio;
  return tot > 0 ? r.decomp / tot : 0;
}

export type Role = "phototroph" | "chemotroph" | "decomposer" | "mixed";
export const ROLES: Role[] = ["phototroph", "chemotroph", "decomposer", "mixed"];

export interface LineageProfile {
  key: string;
  cells: number;
  photo: number;
  grow: number;
  decomp: number;
  resp: number;
  role: Role;
}

/**
 * Classifies a catalytic profile. Phototrophs assimilate mainly by
 * photosynthesis, chemotrophs by energy-driven growth; decomposers recycle
 * more waste than they assimilate. Otherwise "mixed".
 */
export function classify(photo: number, grow: number, decomp: number, dominance = 0.6): Role {
  const assim = photo + grow;
  if (decomp > assim && decomp > 0) return "decomposer";
  if (assim <= 0) return "mixed";
  if (photo / assim >= dominance) return "phototroph";
  if (grow / assim >= dominance) return "chemotroph";
  return "mixed";
}

export function lineageProfiles(cfg: WorldConfig, roles: Uint32Array, genomeHead: Uint32Array): LineageProfile[] {
  const n = cellCount(cfg);
  const acc = new Map<string, LineageProfile>();
  for (let i = 0; i < n; i++) {
    const hi = genomeHead[G.LIN_HI * n + i];
    const lo = genomeHead[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    const key = `${hi}:${lo}`;
    let p = acc.get(key);
    if (!p) acc.set(key, (p = { key, cells: 0, photo: 0, grow: 0, decomp: 0, resp: 0, role: "mixed" }));
    const a = roles[i * ROLE_WORDS];
    const b = roles[i * ROLE_WORDS + 1];
    p.cells++;
    p.photo += a & 0xffff;
    p.grow += a >>> 16;
    p.decomp += b & 0xffff;
    p.resp += b >>> 16;
  }
  const out = [...acc.values()];
  for (const p of out) p.role = classify(p.photo, p.grow, p.decomp);
  return out;
}

export interface RoleSummary {
  /** Biomass-cell share per role. */
  share: Record<Role, number>;
  /** Roles holding at least `minShare` of living cells. */
  present: Role[];
}

export function roleSummary(profiles: LineageProfile[], minShare = 0.05): RoleSummary {
  const share = { phototroph: 0, chemotroph: 0, decomposer: 0, mixed: 0 } as Record<Role, number>;
  let total = 0;
  for (const p of profiles) {
    share[p.role] += p.cells;
    total += p.cells;
  }
  for (const r of ROLES) share[r] = total ? share[r] / total : 0;
  return { share, present: ROLES.filter((r) => share[r] >= minShare) };
}
