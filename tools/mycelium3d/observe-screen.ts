// EXPLORATORY first screen of the 3D mycelium world (docs/3d-expansion-plan-2026-11-15.md, Phase 1 B4): the grid of settings
// and the pure readouts that tools/mycelium3d/screen.ts takes from GPU read-backs. Nothing here touches the GPU or Deno, so the
// vitest suite (tools/test/mycelium3d-screen.test.ts) imports it directly. Not a pre-registered test: no gates, no labels.
//
// Readouts, all on a full state from read():
//   - by depth, in 8 groups of D / 8 layers (surface first): particles, body matter M, field A, C and P, mean light, trail cells;
//   - the fraction of occupied cells (at least one particle) that hold trail (P >= 1);
//   - the largest 6-connected component of cells with P >= 1 (x and y wrap, z closed), its size, z-range and cells per group,
//     once over the whole volume and once with the floor layer left out (with sinking, trail rains onto the floor and sits there);
//   - over every trail component: the count, the largest z-span, and how many reach from the surface group to the floor group;
//   - in owner worlds, the same-owner share of directed face edges between owned cells and the median min(Q, Q) on them, the
//     number of owned cells and the median Q over them, the number of distinct owners and the largest owner's share of owned cells
//     (so one owner's carpet is not read as many territories);
//   - the mean light of the floor layer alone (the floor group G8 averages its D / 8 layers);
//   - side (x by z, summed over y) and top (x by y, summed over z) projections of particle count and of trail (and, with bonds, of
//     particles in bodies);
//   - with bonds: the bond count, bodies (connected components of the bond graph with two or more particles: count, largest,
//     mean size, rings, a size histogram), bodies and their members by depth group, mean age of bonded and free particles, and the
//     share of particles whose BOND output is positive (probe). Bond survival between read-backs is in `bondSurvival`.
// Net upward transport of matter by particles is in `transport` (below says what it counts and what it misses).
import { BOND_NONE, defaultConfig, lightPlane, type Mycelium3dConfig, type Mycelium3dState, NN_O3, OUT, POS_SHIFT, probe, slotOfId } from "./world.ts";
import { encodePng } from "../lib/png.ts";

/** Bumped whenever a readout's definition changes, so a stored result is never reused across definitions. */
export const READOUT_VERSION = 6;
export const GROUPS = 8;

// ---- the grid ----------------------------------------------------------------------------------------------------

export type TrailArm = "none" | "toll" | "owner" | "move12" | "ownertoll";
/**
 * One arm. `owner` replaces OWNER (the owner keys) for the owner arms; `wasteShade` adds the dark-floor key. The first screen's
 * settings carry neither, so their configs are unchanged.
 */
export interface Setting { id: string; sink: number | null; trail: TrailArm; lightK: number; wasteShade?: number; owner?: OwnerKeys; bonds?: BondKeys }
export type BondKeys = Required<Pick<Mycelium3dConfig, "bondBreak">> & Partial<Pick<Mycelium3dConfig, "bondCost" | "bondChild">>;
export type OwnerKeys = Required<Pick<Mycelium3dConfig, "trailOwner">> & Partial<Pick<Mycelium3dConfig, "ownerDefend" | "ownerConduit" | "ownerConduitCap">>;
export const SINKS: readonly (number | null)[] = [null, 6, 4];
export const TRAILS: readonly TrailArm[] = ["none", "toll", "owner"];
export const LIGHT_KS: readonly number[] = [16, 64];
export const SEEDS: readonly number[] = [1, 2];
/** 64 x 64 x 32 is 8 times the default's 32 x 32 x 16 cells, so founders and the particle cap scale by 8 (65,536 is the rule's cap). */
export const SHAPE = { width: 64, height: 64, depth: 32, founders: 8192, maxParticles: 65536 } as const;
/** The 2D R4 toll road (tools/mycelium/bootstrap-arms.ts TOLL): it also raises moveCost from 2 to 12. */
export const TOLL = { moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" } as const;
/** The 2D owner screen's no-toll N-EC arm: gid owners, gate theta 4, owner conduit g 30, cap absent (255). Sized in 2D, not in 3D. */
export const OWNER = { trailOwner: "gid", ownerDefend: 4, ownerConduit: 30 } as const;

export const settingId = (sink: number | null, trail: TrailArm, lightK: number): string => `sink${sink ?? "off"}.${trail}.k${lightK}`;
export const SETTINGS: readonly Setting[] = SINKS.flatMap((sink) => TRAILS.flatMap((trail) => LIGHT_KS.map((lightK) => ({ id: settingId(sink, trail, lightK), sink, trail, lightK }))));

export function screenConfig(st: Setting, seed: number): Mycelium3dConfig {
  const over: Partial<Mycelium3dConfig> = { ...SHAPE, seed, lightK: st.lightK };
  if (st.sink !== null) over.sinkShift = st.sink;
  if (st.wasteShade !== undefined) over.wasteShade = st.wasteShade;
  if (st.trail === "toll" || st.trail === "ownertoll") Object.assign(over, TOLL);
  if (st.trail === "move12") over.moveCost = TOLL.moveCost;
  if (st.trail === "owner" || st.trail === "ownertoll") Object.assign(over, st.owner ?? OWNER);
  if (st.bonds) Object.assign(over, st.bonds);
  return defaultConfig(over);
}

// ---- the second screen: owner sizing pilots and the owner / dark-floor screen (16 Nov 2026) ---------------------------

/** Pilot seeds for sizing, kept apart from the second screen's seeds. */
export const PILOT_SEEDS: readonly number[] = [21, 22];
export const SCREEN2_SEEDS: readonly number[] = [11, 12, 13, 14];
const ownerLabel = (o: OwnerKeys) => `${o.trailOwner}.t${o.ownerDefend ?? "off"}.g${o.ownerConduit ?? "off"}${o.ownerConduitCap === undefined ? "" : `.q${o.ownerConduitCap}`}`;
const ownerSetting = (sink: number | null, o: OwnerKeys, trail: "owner" | "ownertoll" = "owner", wasteShade?: number, lightK = 64): Setting => ({
  id: `sink${sink ?? "off"}.${trail}.${ownerLabel(o)}${wasteShade === undefined ? "" : `.ws${wasteShade}`}.k${lightK}`, sink, trail, lightK, owner: o,
  ...(wasteShade === undefined ? {} : { wasteShade }),
});
/**
 * Owner sizing pilots at the second screen's substrate (sink 6, lightK 64): owner by gid and by id, gate theta 1..64 (the gate
 * fires on a stranger's Q >= theta, so a lower theta is a stronger gate), owner conduit g 30..255; then two diagnostics, no
 * sinking and the toll substrate the 2D territories formed on.
 */
export const OWNER_PILOTS: readonly Setting[] = [
  ...(["gid", "id"] as const).flatMap((m) => [1, 4, 16, 64].flatMap((t) => [30, 120, 255].map((g) => ownerSetting(6, { trailOwner: m, ownerDefend: t, ownerConduit: g })))),
  ...(["gid", "id"] as const).map((m) => ownerSetting(null, { trailOwner: m, ownerDefend: 1, ownerConduit: 255 })),
  ...(["gid", "id"] as const).flatMap((m) => [1, 4].map((t) => ownerSetting(6, { trailOwner: m, ownerDefend: t, ownerConduit: 120 }, "ownertoll"))),
];
/** Dark-floor probe: no rule at sink 6, lightK 64, over wasteShade (none, 0, 2, 4, 6). */
export const SHADE_PILOTS: readonly Setting[] = [undefined, 0, 2, 4, 6].map((ws) => ({
  id: `sink6.none${ws === undefined ? "" : `.ws${ws}`}.k64`, sink: 6, trail: "none", lightK: 64, ...(ws === undefined ? {} : { wasteShade: ws }),
}));
/** The owner keys and waste shading the second screen uses; set from the pilots (experiments/mycelium3d/owner-darkfloor-screen-2026-11-16.md). */
export const OWNER3D: OwnerKeys = { trailOwner: "gid", ownerDefend: 1, ownerConduit: 255 };
export const WASTE_SHADE = 2;
/** The second screen: six arms at sink 6, lightK 64. */
export const SCREEN2: readonly Setting[] = [
  { id: "sink6.none.k64", sink: 6, trail: "none", lightK: 64 },
  { id: "sink6.toll.k64", sink: 6, trail: "toll", lightK: 64 },
  { id: "sink6.move12.k64", sink: 6, trail: "move12", lightK: 64 },
  ownerSetting(6, OWNER3D),
  ownerSetting(6, OWNER3D, "owner", WASTE_SHADE),
  { id: `sink6.none.ws${WASTE_SHADE}.k64`, sink: 6, trail: "none", lightK: 64, wasteShade: WASTE_SHADE },
];
// ---- the bodies screen: bonds (16 Nov 2026) ---------------------------------------------------------------------------

const bondLabel = (b: BondKeys) => `bonds.b${b.bondBreak}.c${b.bondCost ?? 0}${b.bondChild ? ".child" : ""}`;
const bondSetting = (b: BondKeys, trail: "none" | "toll" = "none", wasteShade?: number): Setting => ({
  id: `sink6.${trail}.${bondLabel(b)}${wasteShade === undefined ? "" : `.ws${wasteShade}`}.k64`, sink: 6, trail, lightK: 64, bonds: b,
  ...(wasteShade === undefined ? {} : { wasteShade }),
});
/**
 * Bond sizing pilots at the bodies screen's substrate (sink 6, lightK 64), on the pilot seeds: break 256 / 512 / 1024 at cost 1 and 4,
 * and children bonded at each break with cost 1; then a diagnostic added after those (bonding was purged in all of them): no upkeep
 * (cost 0, the key absent) at break 512, with and without children.
 */
export const BOND_PILOTS: readonly Setting[] = [
  ...[256, 512, 1024].flatMap((b) => [1, 4].map((c) => bondSetting({ bondBreak: b, bondCost: c }))),
  ...[256, 512, 1024].map((b) => bondSetting({ bondBreak: b, bondCost: 1, bondChild: true })),
  bondSetting({ bondBreak: 512 }), bondSetting({ bondBreak: 512, bondChild: true }),
];
/**
 * The bond keys the bodies screen uses, set from the pilots by the rule stated before them: the non-child setting with the most
 * bonded particles in the late window (seed mean), ties within 10% to the smaller break and then the lower cost
 * (experiments/mycelium3d/bonds-screen-2026-11-16.md).
 */
export const BONDS3D: BondKeys = { bondBreak: 1024, bondCost: 1 };
/** The bodies screen: five arms at sink 6, lightK 64, and a sixth, diagnostic one without the upkeep (cost 0, the key absent). */
export const BODIES: readonly Setting[] = [
  { id: "sink6.none.k64", sink: 6, trail: "none", lightK: 64 },
  bondSetting(BONDS3D),
  bondSetting({ ...BONDS3D, bondChild: true }),
  bondSetting(BONDS3D, "toll"),
  bondSetting(BONDS3D, "none", WASTE_SHADE),
  bondSetting({ bondBreak: BONDS3D.bondBreak }),
];

// ---- the leads screen: the two lone-seed leads on fresh seeds (16 Nov 2026) --------------------------------------------

/** Twelve fresh seeds: 1, 2, 11 to 14, 21 and 22 are spent on the earlier screens and pilots. */
export const LEADS_SEEDS: readonly number[] = [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42];
/**
 * The two arms that showed a lead on a minority of seeds, unchanged: bonds without the upkeep (the bodies screen's diagnostic arm,
 * 1 of 4 seeds kept bodies) and the toll alone (screen 2, a surface-to-floor trail component late on 2 of 4 seeds). The bars are
 * LEADS_BARS, written before the runs (experiments/mycelium3d/leads-screen-2026-11-16.md).
 */
export const LEADS: readonly Setting[] = [bondSetting({ bondBreak: BONDS3D.bondBreak }), { id: "sink6.toll.k64", sink: 6, trail: "toll", lightK: 64 }];
/** Late window (lateFrom, steps]; a seed keeps bodies at share >= bondedShare in EVERY late readout; it spans when at least spanShare of its late readouts have a G1-to-G8 trail component. */
export const LEADS_BARS = { lateFrom: 25000, bondedShare: 0.25, spanShare: 0.5 } as const;

/** The parts of a readout the leads tally reads (a full Readout fits). */
export interface LeadsReadout {
  step: number; n: number; trailMass: number; spans: Pick<Spans, "topToFloorGroups">;
  bonds: Pick<BondReadout, "bonded" | "largest" | "bodies" | "rings"> | null;
}
export interface LeadsRun { steps: number; every: number; readouts: readonly LeadsReadout[]; windows?: readonly { step: number; transport: Pick<Transport, "net"> }[] }
export interface LeadsTally {
  late: number;
  /** Share of particles bonded over the late readouts (NaN without bonds); keepsBodies is null without bonds. */
  bondedMin: number; bondedMean: number; bondedMax: number; keepsBodies: boolean | null;
  /** Late readouts with a G1-to-G8 trail component, and whether that is at least spanShare of them. */
  spanReads: number; spans: boolean;
  largestBodyMax: number; bodiesMean: number; ringsMean: number; particlesMean: number; trailMean: number;
  /** Net matter lifted by particles per 1,000 steps (matter-layers), late window mean; NaN without windows. */
  netUpMean: number;
}

/**
 * One seed against the leads bars, over the late readouts (lateFrom, steps]. Throws unless the late window holds exactly one readout
 * at every multiple of `every` in it, so a partial run is never tallied, and when bonds are present in some late readouts but not others.
 */
export function leadsTally(run: LeadsRun, bars: { lateFrom: number; bondedShare: number; spanShare: number } = LEADS_BARS): LeadsTally {
  const { steps, every } = run;
  if (!(every > 0) || !(steps > bars.lateFrom)) throw new Error(`leadsTally: steps ${steps} must exceed lateFrom ${bars.lateFrom} (every ${every})`);
  const want: number[] = [];
  for (let t = (Math.floor(bars.lateFrom / every) + 1) * every; t <= steps; t += every) want.push(t);
  const ro = run.readouts.filter((x) => x.step > bars.lateFrom);
  if (ro.length !== want.length || ro.some((x, i) => x.step !== want[i])) {
    throw new Error(`leadsTally: late window (${bars.lateFrom}, ${steps}] has readouts at [${ro.map((x) => x.step).join(", ")}], expected ${want.length} at every ${every}`);
  }
  for (const x of ro) if (typeof x.spans?.topToFloorGroups !== "number") throw new Error(`leadsTally: readout at step ${x.step} has no spans.topToFloorGroups`);
  const withBonds = ro.filter((x) => x.bonds).length;
  if (withBonds !== 0 && withBonds !== ro.length) throw new Error(`leadsTally: bonds in ${withBonds} of ${ro.length} late readouts`);
  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
  const bonded = withBonds ? ro.map((x) => (x.n ? x.bonds!.bonded / x.n : 0)) : [];
  const spanReads = ro.filter((x) => x.spans.topToFloorGroups >= 1).length;
  const wi = (run.windows ?? []).filter((w) => w.step > bars.lateFrom);
  return {
    late: ro.length,
    bondedMin: withBonds ? Math.min(...bonded) : NaN, bondedMean: avg(bonded), bondedMax: withBonds ? Math.max(...bonded) : NaN,
    keepsBodies: withBonds ? bonded.every((v) => v >= bars.bondedShare) : null,
    spanReads, spans: spanReads / ro.length >= bars.spanShare,
    largestBodyMax: withBonds ? Math.max(...ro.map((x) => x.bonds!.largest)) : NaN,
    bodiesMean: withBonds ? avg(ro.map((x) => x.bonds!.bodies)) : NaN, ringsMean: withBonds ? avg(ro.map((x) => x.bonds!.rings)) : NaN,
    particlesMean: avg(ro.map((x) => x.n)), trailMean: avg(ro.map((x) => x.trailMass)),
    netUpMean: avg(wi.map((w) => (1000 * w.transport.net) / every)),
  };
}

export interface Grid { settings: readonly Setting[]; seeds: readonly number[]; title: string }
export const GRIDS: Record<string, Grid> = {
  first: { settings: SETTINGS, seeds: SEEDS, title: "3D MYCELIUM TRAIL SCREEN" },
  "owner-pilots": { settings: OWNER_PILOTS, seeds: PILOT_SEEDS, title: "3D MYCELIUM OWNER SIZING PILOTS" },
  "shade-pilots": { settings: SHADE_PILOTS, seeds: PILOT_SEEDS, title: "3D MYCELIUM WASTE-SHADE PROBE" },
  "owner-darkfloor": { settings: SCREEN2, seeds: SCREEN2_SEEDS, title: "3D MYCELIUM OWNER / DARK-FLOOR SCREEN" },
  "bond-pilots": { settings: BOND_PILOTS, seeds: PILOT_SEEDS, title: "3D MYCELIUM BOND SIZING PILOTS" },
  bodies: { settings: BODIES, seeds: SCREEN2_SEEDS, title: "3D MYCELIUM BODIES (BONDS) SCREEN" },
  leads: { settings: LEADS, seeds: LEADS_SEEDS, title: "3D MYCELIUM LEADS SCREEN (BODIES WITHOUT UPKEEP, TOLL SPAN)" },
};

/** What a stored run must match to be reused: the readout definitions, the config and every cadence. */
export function fingerprint(config: Mycelium3dConfig, steps: number, every: number, moveEvery: number): string {
  return JSON.stringify({ readout: READOUT_VERSION, config, steps, every, moveEvery });
}

// ---- upward transport --------------------------------------------------------------------------------------------

type Bodies = Pick<Mycelium3dState, "n" | "id" | "z" | "M">;
export interface Transport { up: number; down: number; net: number; matched: number; total: number }
export const emptyTransport = (): Transport => ({ up: 0, down: 0, net: 0, matched: 0, total: 0 });

/**
 * Matter moved up by particles between two read-backs: for every particle alive in both (matched by id; slot order is id
 * order, so a two-pointer merge), M at the earlier read times the layers it rose, (z_before - z_after) / 256 (z grows
 * downward, so rising is z falling). `up` and `down` are the gross sums, `net = up - down`, in matter-layers. `matched` is
 * the earlier read's matter on matched particles and `total` all of it.
 *
 * It misses: particles born or dead between the reads (their moves and the matter they carried), changes of M between the
 * reads (eating at one depth and excreting at another inside an interval is counted at the earlier M), back-and-forth inside an
 * interval (only net displacement counts), a child placed above or below its parent, and every field transport (diffusion of A
 * and C, sinking of C and P).
 */
export function addTransport(acc: Transport, before: Bodies, after: Bodies): Transport {
  let i = 0, j = 0;
  for (let k = 0; k < before.n; k++) acc.total += before.M[k];
  while (i < before.n && j < after.n) {
    const a = before.id[i], b = after.id[j];
    if (a < b) i++;
    else if (b < a) j++;
    else {
      const m = before.M[i], dz = (before.z[i] - after.z[j]) / (1 << POS_SHIFT);
      if (dz > 0) acc.up += m * dz; else acc.down -= m * dz;
      acc.matched += m;
      i++; j++;
    }
  }
  acc.net = acc.up - acc.down;
  return acc;
}

// ---- trail components --------------------------------------------------------------------------------------------

export interface Component { size: number; zMin: number; zMax: number; byGroup: number[] }

/**
 * The largest 6-connected component of cells with P >= `min` among layers z < zLimit. x and y wrap, z is closed.
 * size 0 (zMin and zMax -1) when no cell qualifies. Ties keep the first found in index order.
 */
export function largestComponent(P: ArrayLike<number>, W: number, H: number, D: number, min = 1, zLimit = D): Component {
  const WH = W * H, N = WH * zLimit;
  const seen = new Uint8Array(N), queue = new Int32Array(N);
  let best: Component = { size: 0, zMin: -1, zMax: -1, byGroup: new Array(GROUPS).fill(0) };
  const per = D / GROUPS;
  for (let s = 0; s < N; s++) {
    if (seen[s] || P[s] < min) continue;
    let head = 0, tail = 0, zMin = D, zMax = -1;
    const layers = new Array(D).fill(0);
    seen[s] = 1; queue[tail++] = s;
    while (head < tail) {
      const k = queue[head++];
      const x = k % W, y = ((k / W) | 0) % H, z = (k / WH) | 0;
      layers[z]++;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
      const nb = [
        z * WH + y * W + ((x + 1) % W), z * WH + y * W + ((x + W - 1) % W),
        z * WH + ((y + 1) % H) * W + x, z * WH + ((y + H - 1) % H) * W + x,
        z + 1 < zLimit ? k + WH : -1, z > 0 ? k - WH : -1,
      ];
      for (const m of nb) if (m >= 0 && !seen[m] && P[m] >= min) { seen[m] = 1; queue[tail++] = m; }
    }
    if (tail > best.size) {
      const byGroup = new Array(GROUPS).fill(0);
      for (let z = 0; z < D; z++) byGroup[Math.floor(z / per)] += layers[z];
      best = { size: tail, zMin, zMax, byGroup };
    }
  }
  return best;
}

export interface Spans { components: number; maxSpan: number; topToFloorGroups: number; topToFloorLayers: number }

/**
 * Every 6-connected component of cells with P >= `min` (x and y wrap, z closed), not just the largest: how many there are, the
 * largest z-span (layers covered) among them, how many reach from the surface group G1 to the floor group G8 (a cell in each),
 * and how many reach from layer 0 to layer D - 1.
 */
export function componentSpans(P: ArrayLike<number>, W: number, H: number, D: number, min = 1): Spans {
  const WH = W * H, N = WH * D, per = D / GROUPS;
  const seen = new Uint8Array(N), queue = new Int32Array(N);
  const out: Spans = { components: 0, maxSpan: 0, topToFloorGroups: 0, topToFloorLayers: 0 };
  for (let s = 0; s < N; s++) {
    if (seen[s] || P[s] < min) continue;
    let head = 0, tail = 0, zMin = D, zMax = -1;
    seen[s] = 1; queue[tail++] = s;
    while (head < tail) {
      const k = queue[head++];
      const x = k % W, y = ((k / W) | 0) % H, z = (k / WH) | 0;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
      const nb = [
        z * WH + y * W + ((x + 1) % W), z * WH + y * W + ((x + W - 1) % W),
        z * WH + ((y + 1) % H) * W + x, z * WH + ((y + H - 1) % H) * W + x,
        z + 1 < D ? k + WH : -1, z > 0 ? k - WH : -1,
      ];
      for (const m of nb) if (m >= 0 && !seen[m] && P[m] >= min) { seen[m] = 1; queue[tail++] = m; }
    }
    out.components++;
    out.maxSpan = Math.max(out.maxSpan, zMax - zMin + 1);
    if (zMin < per && zMax >= D - per) out.topToFloorGroups++;
    if (zMin === 0 && zMax === D - 1) out.topToFloorLayers++;
  }
  return out;
}

// ---- owner edges -------------------------------------------------------------------------------------------------

export interface OwnerEdges { owned: number; sameShare: number; medianMinQ: number; ownedCells: number; medianQ: number; owners: number; topOwnerShare: number }

/**
 * Directed face edges from an owned cell (Z != 0): the share whose neighbour has the same owner, and the median min(Q, Q) over
 * those; the owned cells, with the median Q over them (both medians capped at 256); the distinct owner tags, and the share of
 * owned cells held by the most common one.
 */
export function ownerEdges(Z: ArrayLike<number>, Q: ArrayLike<number>, W: number, H: number, D: number): OwnerEdges {
  const WH = W * H;
  let owned = 0, same = 0, ownedCells = 0;
  const hist = new Uint32Array(257), qHist = new Uint32Array(257);
  const perOwner = new Map<number, number>();
  for (let k = 0; k < WH * D; k++) {
    if (Z[k] === 0) continue;
    ownedCells++; qHist[Math.min(Q[k], 256)]++;
    perOwner.set(Z[k], (perOwner.get(Z[k]) ?? 0) + 1);
    const x = k % W, y = ((k / W) | 0) % H, z = (k / WH) | 0;
    const nb = [
      z * WH + y * W + ((x + 1) % W), z * WH + y * W + ((x + W - 1) % W),
      z * WH + ((y + 1) % H) * W + x, z * WH + ((y + H - 1) % H) * W + x,
      z + 1 < D ? k + WH : -1, z > 0 ? k - WH : -1,
    ];
    for (const m of nb) {
      if (m < 0) continue;
      owned++;
      if (Z[m] === Z[k]) { same++; hist[Math.min(Q[k], Q[m], 256)]++; }
    }
  }
  const median = (h: Uint32Array, count: number) => {
    let acc = 0;
    for (let v = 0; v <= 256 && count > 0; v++) { acc += h[v]; if (2 * acc >= count) return v; }
    return 0;
  };
  let top = 0;
  for (const v of perOwner.values()) top = Math.max(top, v);
  return {
    owned, sameShare: owned ? same / owned : 0, medianMinQ: median(hist, same), ownedCells, medianQ: median(qHist, ownedCells),
    owners: perOwner.size, topOwnerShare: ownedCells ? top / ownedCells : 0,
  };
}

// ---- bonds and bodies --------------------------------------------------------------------------------------------

type Bonded = Pick<Mycelium3dState, "n" | "id" | "bond0" | "bond1">;
/** Body size classes of the histogram: 2, 3, 4-7, 8-15, 16 and more. */
export const BODY_SIZES = ["2", "3", "4-7", "8-15", "16+"] as const;
const sizeClass = (k: number) => (k <= 3 ? k - 2 : k < 8 ? 2 : k < 16 ? 3 : 4);

export interface BondReadout {
  /** Bonds (edges of the graph), and particles holding at least one. */
  bonds: number;
  bonded: number;
  /** Bodies: connected components with two or more particles. */
  bodies: number;
  largest: number;
  meanSize: number;
  /** Bodies in which every member holds two bonds (a closed ring). */
  rings: number;
  sizeHist: number[];
  /** Per depth group: particles in bodies, and bodies by the group of their mean layer. */
  inBodiesByGroup: number[];
  bodiesByGroup: number[];
  /** Mean body size by group (by mean layer), NaN where a group has none. */
  meanSizeByGroup: number[];
  /** Mean age of particles in bodies and of free ones (NaN when none). */
  ageBonded: number;
  ageFree: number;
  /** Share of particles whose BOND output is positive on the next step (probe), 0 with no particles. */
  want: number;
}

/** The bond graph of a state with bond slots: bonds, bodies and where they are. Reads state, changes nothing. */
export function bondReadout(s: Mycelium3dState): BondReadout {
  const c = s.config, D = c.depth, n = s.n;
  const b0 = s.bond0!, b1 = s.bond1!;
  const seen = new Uint8Array(n), queue = new Int32Array(n);
  const out: BondReadout = {
    bonds: 0, bonded: 0, bodies: 0, largest: 0, meanSize: NaN, rings: 0, sizeHist: new Array(BODY_SIZES.length).fill(0),
    inBodiesByGroup: new Array(GROUPS).fill(0), bodiesByGroup: new Array(GROUPS).fill(0), meanSizeByGroup: new Array(GROUPS).fill(NaN),
    ageBonded: NaN, ageFree: NaN, want: 0,
  };
  const sizeSum = new Array(GROUPS).fill(0);
  let members = 0, ageB = 0, ageF = 0, nFree = 0;
  for (let i = 0; i < n; i++) {
    const deg = (b0[i] !== BOND_NONE ? 1 : 0) + (b1[i] !== BOND_NONE ? 1 : 0);
    out.bonds += deg;
    if (deg === 0) { ageF += s.age[i]; nFree++; continue; }
    out.bonded++; ageB += s.age[i];
    if (seen[i]) continue;
    let head = 0, tail = 0, zSum = 0, ring = true;
    seen[i] = 1; queue[tail++] = i;
    while (head < tail) {
      const k = queue[head++];
      zSum += s.z[k] >>> POS_SHIFT;
      if (b1[k] === BOND_NONE) ring = false;
      for (const p of [b0[k], b1[k]]) {
        if (p === BOND_NONE) continue;
        const j = slotOfId(s.id, n, p);
        if (j >= 0 && !seen[j]) { seen[j] = 1; queue[tail++] = j; }
      }
    }
    const g = groupOf(Math.floor(zSum / tail), D);
    out.bodies++; members += tail; out.largest = Math.max(out.largest, tail);
    if (ring) out.rings++;
    out.sizeHist[sizeClass(tail)]++;
    out.bodiesByGroup[g]++; sizeSum[g] += tail;
    for (let q = 0; q < tail; q++) out.inBodiesByGroup[groupOf(s.z[queue[q]] >>> POS_SHIFT, D)]++;
  }
  out.bonds /= 2;
  out.meanSize = out.bodies ? members / out.bodies : NaN;
  for (let g = 0; g < GROUPS; g++) if (out.bodiesByGroup[g]) out.meanSizeByGroup[g] = sizeSum[g] / out.bodiesByGroup[g];
  out.ageBonded = out.bonded ? ageB / out.bonded : NaN;
  out.ageFree = nFree ? ageF / nFree : NaN;
  if (n) {
    const o = probe(s);
    let w = 0;
    for (let i = 0; i < n; i++) if (o[i * NN_O3 + OUT.BOND] > 0) w++;
    out.want = w / n;
  }
  return out;
}

export interface Survival { bonds: number; bothAlive: number; kept: number }
export const emptySurvival = (): Survival => ({ bonds: 0, bothAlive: 0, kept: 0 });

/**
 * Bonds at the earlier read-back that are still there at the later one, added to `acc`: `bonds` counts every bond of `before`,
 * `bothAlive` those whose two particles are alive at `after`, `kept` those still bonded at `after` (the same pair; a bond that
 * broke and formed again in between counts as kept). Both states hold bond slots; ids are matched by binary search.
 */
export function bondSurvival(acc: Survival, before: Bonded, after: Bonded): Survival {
  const a0 = before.bond0!, a1 = before.bond1!, c0 = after.bond0!, c1 = after.bond1!;
  for (let i = 0; i < before.n; i++) {
    const me = before.id[i];
    for (const p of [a0[i], a1[i]]) {
      if (p === BOND_NONE || p < me) continue; // each bond once, from its smaller id
      acc.bonds++;
      const ja = slotOfId(after.id, after.n, me), jb = slotOfId(after.id, after.n, p);
      if (ja < 0 || jb < 0) continue;
      acc.bothAlive++;
      if (c0[ja] === p || c1[ja] === p) acc.kept++;
    }
  }
  return acc;
}

// ---- readout by depth --------------------------------------------------------------------------------------------

export interface Group { particles: number; M: number; A: number; C: number; P: number; light: number; trailCells: number; occupied: number; occupiedTrail: number }
export interface Layers { particles: number[]; M: number[]; A: number[]; C: number[]; P: number[] }
export interface Readout {
  step: number;
  n: number;
  groups: Group[];
  /** The same sums per layer (surface first), for the field fluxes. */
  layers: Layers;
  /** Occupied cells with P >= 1, over all occupied cells (0 when none is occupied). */
  occTrailFrac: number;
  trailMass: number;
  /** Mean light of the floor layer z = D - 1 alone, in 1/256 units of conversion. */
  floorLight: number;
  comp: Component;
  compAboveFloor: Component;
  /** Over every trail component, not only the largest. */
  spans: Spans;
  owner: OwnerEdges | null;
  /** Only with bonds. */
  bonds: BondReadout | null;
}

/** Group index of layer z: GROUPS equal slabs of D / GROUPS layers (D must be a multiple of GROUPS). */
export const groupOf = (z: number, D: number): number => Math.floor(z / (D / GROUPS));

export function readout(s: Mycelium3dState): Readout {
  const c = s.config, W = c.width, H = c.height, D = c.depth, WH = W * H;
  if (D % GROUPS !== 0) throw new Error(`readout: depth ${D} is not a multiple of ${GROUPS}`);
  const groups: Group[] = Array.from({ length: GROUPS }, () => ({ particles: 0, M: 0, A: 0, C: 0, P: 0, light: 0, trailCells: 0, occupied: 0, occupiedTrail: 0 }));
  const I = lightPlane(s);
  const crowd = new Uint32Array(WH * D);
  const z0 = () => new Array(D).fill(0);
  const layers: Layers = { particles: z0(), M: z0(), A: z0(), C: z0(), P: z0() };
  for (let i = 0; i < s.n; i++) {
    const z = s.z[i] >>> POS_SHIFT;
    crowd[(z * H + (s.y[i] >>> POS_SHIFT)) * W + (s.x[i] >>> POS_SHIFT)]++;
    const g = groups[groupOf(z, D)];
    g.particles++; g.M += s.M[i];
    layers.particles[z]++; layers.M[z] += s.M[i];
  }
  let trailMass = 0, occ = 0, occTrail = 0;
  for (let k = 0; k < WH * D; k++) {
    const z = (k / WH) | 0, g = groups[groupOf(z, D)];
    g.A += s.A[k]; g.C += s.C[k]; g.P += s.P[k]; g.light += I[k];
    layers.A[z] += s.A[k]; layers.C[z] += s.C[k]; layers.P[z] += s.P[k];
    trailMass += s.P[k];
    if (s.P[k] >= 1) g.trailCells++;
    if (crowd[k] > 0) { g.occupied++; occ++; if (s.P[k] >= 1) { g.occupiedTrail++; occTrail++; } }
  }
  // Light as the mean per cell of each group, in 1/256 units of conversion.
  for (const g of groups) g.light = Math.round(g.light / (WH * (D / GROUPS)));
  let floorLight = 0;
  for (let k = (D - 1) * WH; k < D * WH; k++) floorLight += I[k];
  return {
    step: s.step, n: s.n, groups, layers, occTrailFrac: occ ? occTrail / occ : 0, trailMass, floorLight: floorLight / WH,
    comp: largestComponent(s.P, W, H, D), compAboveFloor: largestComponent(s.P, W, H, D, 1, D - 1),
    spans: componentSpans(s.P, W, H, D),
    owner: s.Z && s.Q ? ownerEdges(s.Z, s.Q, W, H, D) : null,
    bonds: s.bond0 && s.bond1 ? bondReadout(s) : null,
  };
}

export interface FieldFlux { sinkDown: number; diffUpA: number; diffUpC: number }

/**
 * Expected vertical matter flux of the field rules per step, in matter-layers (one unit moved one layer is 1), from per-layer
 * totals: sinking sends (C + P) / 2^sinkShift down from every layer above the floor; diffusion sends q * De / 1536 through each z
 * face (diffOut6: six portions of q / 6, each passed at 4 * De / 1024), so the net upward flux across the face between layers z - 1
 * and z is (q_z - q_(z-1)) * De / 1536, with C taken after the expected sinking (diffusion follows sinking in a step). Approximate: it reads the end-of-step state where sinking reads the post-decay amounts, and
 * it ignores the conduits' extra A rate.
 */
export function fieldFlux(l: Pick<Layers, "A" | "C" | "P">, c: Pick<Mycelium3dConfig, "depth" | "diffA" | "diffC" | "sinkShift">): FieldFlux {
  const D = c.depth;
  let sinkDown = 0, diffUpA = 0, diffUpC = 0;
  // Diffusion runs after sinking within a step, so C diffuses from the profile sinking leaves (expected values).
  const C = [...l.C];
  if (c.sinkShift !== undefined) {
    const k = 2 ** c.sinkShift;
    for (let z = 0; z < D - 1; z++) { sinkDown += (l.C[z] + l.P[z]) / k; C[z] -= l.C[z] / k; C[z + 1] += l.C[z] / k; }
  }
  for (let z = 1; z < D; z++) { diffUpA += ((l.A[z] - l.A[z - 1]) * c.diffA) / 1536; diffUpC += ((C[z] - C[z - 1]) * c.diffC) / 1536; }
  return { sinkDown, diffUpA, diffUpC };
}

// ---- projections and pictures ------------------------------------------------------------------------------------

export interface Projections {
  W: number; H: number; D: number; sideParticles: number[]; sideTrail: number[]; topParticles: number[]; topTrail: number[];
  /** Only with bonds: particles holding a bond, side and top. */
  sideBonded?: number[]; topBonded?: number[];
}

/** Side views are D rows of W (row 0 the surface), summed over y; top views H rows of W, summed over z. */
export function projections(s: Mycelium3dState): Projections {
  const c = s.config, W = c.width, H = c.height, D = c.depth, WH = W * H;
  const sp = new Array(W * D).fill(0), st = new Array(W * D).fill(0), tp = new Array(W * H).fill(0), tt = new Array(W * H).fill(0);
  const bonds = s.bond0 !== undefined;
  const sb = bonds ? new Array(W * D).fill(0) : [], tb = bonds ? new Array(W * H).fill(0) : [];
  for (let i = 0; i < s.n; i++) {
    const x = s.x[i] >>> POS_SHIFT, y = s.y[i] >>> POS_SHIFT, z = s.z[i] >>> POS_SHIFT;
    sp[z * W + x]++; tp[y * W + x]++;
    if (bonds && s.bond0![i] !== BOND_NONE) { sb[z * W + x]++; tb[y * W + x]++; }
  }
  for (let k = 0; k < WH * D; k++) {
    if (!s.P[k]) continue;
    const x = k % W, y = ((k / W) | 0) % H, z = (k / WH) | 0;
    st[z * W + x] += s.P[k]; tt[y * W + x] += s.P[k];
  }
  return { W, H, D, sideParticles: sp, sideTrail: st, topParticles: tp, topTrail: tt, ...(bonds ? { sideBonded: sb, topBonded: tb } : {}) };
}

type RGB = readonly [number, number, number];
/** Log scale shared by every run: t = log(1 + v) / log(1 + max), so a run with no trail stays black whatever the others hold. */
export const logT = (v: number, max: number): number => (v <= 0 || max <= 0 ? 0 : Math.min(1, Math.log1p(v) / Math.log1p(max)));
const ramp = (stops: readonly RGB[], t: number): RGB => {
  const u = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(u)), f = u - i;
  return [0, 1, 2].map((ch) => Math.round(stops[i][ch] + (stops[i + 1][ch] - stops[i][ch]) * f)) as unknown as RGB;
};
export const PARTICLE_RAMP: readonly RGB[] = [[0, 0, 0], [110, 30, 10], [230, 120, 20], [255, 240, 200]];
export const TRAIL_RAMP: readonly RGB[] = [[0, 0, 0], [10, 60, 70], [30, 170, 150], [210, 255, 230]];

/** Paints a w x h value image (row-major) into `img` (RGB, `width` wide) at (x0, y0), each value a `scale` x `scale` block. */
export function paint(img: Uint8Array, width: number, x0: number, y0: number, vals: readonly number[], w: number, h: number, max: number, stops: readonly RGB[], scale: number): void {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const rgb = ramp(stops, logT(vals[y * w + x], max));
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) img.set(rgb, ((y0 + y * scale + dy) * width + x0 + x * scale + dx) * 3);
  }
}

// A 3 x 5 capital font: five rows of three bits each, written as octal digits (4 is the left pixel).
const FONT: Record<string, string> = {
  "0": "75557", "1": "26227", "2": "71747", "3": "71317", "4": "55711", "5": "74717", "6": "74757", "7": "71122", "8": "75757", "9": "75717",
  A: "25755", B: "65656", C: "34443", D: "65556", E: "74647", F: "74644", G: "34553", H: "55755", I: "72227", J: "11152", K: "55655",
  L: "44447", M: "57755", N: "65555", O: "25552", P: "65644", Q: "25563", R: "65655", S: "34216", T: "72222", U: "55557", V: "55552",
  W: "55775", X: "55255", Y: "55222", Z: "71247", " ": "00000", "-": "00700", ".": "00002", "/": "11244", "=": "07070", ":": "02020", ",": "00012", "(": "12221", ")": "42224",
};
export const textWidth = (text: string, scale: number): number => Math.max(0, text.length * 4 - 1) * scale;

/** Draws `text` (upper-cased; characters without a glyph are blank) with its top-left at (x, y), clipped to the image. */
export function drawText(img: Uint8Array, width: number, x: number, y: number, text: string, scale: number, colour: RGB): void {
  const height = img.length / 3 / width;
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT[" "];
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
      if (!((Number(g[gy]) >> (2 - gx)) & 1)) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const px = cx + gx * scale + dx, py = y + gy * scale + dy;
        if (px >= 0 && px < width && py >= 0 && py < height) img.set(colour, (py * width + px) * 3);
      }
    }
    cx += 4 * scale;
  }
}

export interface Maxes { particles: number; trail: number; topParticles: number; topTrail: number }
/** The largest value of each kind over every run's projections: the shared scale. */
export function sharedMax(ps: readonly Projections[]): Maxes {
  const m = (f: (p: Projections) => number[]) => Math.max(1, ...ps.map((p) => f(p).reduce((a, v) => Math.max(a, v), 0)));
  return { particles: m((p) => p.sideParticles), trail: m((p) => p.sideTrail), topParticles: m((p) => p.topParticles), topTrail: m((p) => p.topTrail) };
}

export const TILE_SCALE = 3, TILE_GAP = 4, LABEL_H = 16;
/** One run's tile: a label, then top views (particles | trail), then side views (particles | trail, surface up). */
export function tileSize(p: Projections): { w: number; h: number } {
  return { w: 2 * p.W * TILE_SCALE + TILE_GAP, h: LABEL_H + p.H * TILE_SCALE + TILE_GAP + p.D * TILE_SCALE };
}
export function drawTile(img: Uint8Array, width: number, x0: number, y0: number, p: Projections, mx: Maxes, label: string): void {
  const s = TILE_SCALE, pw = p.W * s;
  drawText(img, width, x0, y0 + 3, label, 2, [235, 235, 235]);
  const ty = y0 + LABEL_H, sy = ty + p.H * s + TILE_GAP;
  paint(img, width, x0, ty, p.topParticles, p.W, p.H, mx.topParticles, PARTICLE_RAMP, s);
  paint(img, width, x0 + pw + TILE_GAP, ty, p.topTrail, p.W, p.H, mx.topTrail, TRAIL_RAMP, s);
  paint(img, width, x0, sy, p.sideParticles, p.W, p.D, mx.particles, PARTICLE_RAMP, s);
  paint(img, width, x0 + pw + TILE_GAP, sy, p.sideTrail, p.W, p.D, mx.trail, TRAIL_RAMP, s);
}

const BG: RGB = [28, 28, 34];
export async function tilePng(p: Projections, mx: Maxes, label: string): Promise<Uint8Array> {
  const { w, h } = tileSize(p), W = w + 8, H = h + 8;
  const img = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) img.set(BG, i * 3);
  drawTile(img, W, 4, 4, p, mx, label);
  return encodePng(W, H, img);
}

/** A labelled grid of tiles, `cols` per row, under a header of text lines. */
export async function contactSheet(tiles: readonly { p: Projections; label: string }[], mx: Maxes, cols: number, header: readonly string[]): Promise<Uint8Array> {
  if (!tiles.length) throw new Error("contactSheet: no tiles");
  const { w, h } = tileSize(tiles[0].p), pad = 10, headH = header.length * 14 + pad;
  const rows = Math.ceil(tiles.length / cols);
  const W = pad + cols * (w + pad), H = headH + pad + rows * (h + pad);
  const img = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) img.set(BG, i * 3);
  header.forEach((line, i) => drawText(img, W, pad, pad + i * 14, line, 2, [200, 200, 160]));
  tiles.forEach((t, i) => drawTile(img, W, pad + (i % cols) * (w + pad), headH + pad + Math.floor(i / cols) * (h + pad), t.p, mx, t.label));
  return encodePng(W, H, img);
}
