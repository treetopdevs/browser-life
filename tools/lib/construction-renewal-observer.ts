// Read-only per-step local accounting for the renewal experiment
// (RENEWAL-PLAN.md section 7B). Call `beforeStep(sim)` immediately before
// `sim.step()` and `afterStep(sim)` immediately after it. The observer never
// writes to the simulator's state.
//
// Bound transport is recomputed exactly with the rule-1 integer functions
// (`w1d`, `mulShareD`) for zero displacement: eight outgoing neighbours,
// torus wrapping inside the single tile, the unsent remainder staying at the
// source. The local reaction change of B (and E) at a cell is then
// `after - after_transport`. PHOTO, GROW, RESP and DECOMP per cell come from
// `RefSim.roles` after every step and are reconciled to the global flux.
import {
  cellCount,
  CH,
  digestWords,
  FLUX_NAMES,
  type FluxName,
  type WorldConfig,
  type WorldState,
  worldW,
} from "@bl/schema";
import { mulShareD, type RefSim, w1d } from "@bl/sim-ref";
import { patchTransport, type PatchTransport } from "./construction-transport.ts";

export const RENEWAL_OBSERVER_VERSION = "construction-renewal-observer-v1";

/** Optional WorldConfig keys allowed in the observer's domain (only the ablation's gate switch). */
const ALLOWED_OPTIONAL = new Set(["polymerTransport"]);
const FORBIDDEN_OPTIONAL = [
  "polymerDrag",
  "adhesion",
  "kAdhesion",
  "migrationPeriod",
  "migrantCount",
  "ringNamespace",
  "pondPeriod",
  "pondK",
  "pondArm",
];

/** Throws unless cfg is inside the restricted rule-1 / dtQ0 / motility-off / no-drag domain. */
export function checkObserverDomain(cfg: WorldConfig): void {
  const fail = (why: string) => {
    throw new Error(`renewal observer domain: ${why}`);
  };
  if (cfg.ruleVersion !== 1) fail("ruleVersion must be 1");
  if (cfg.dtQ !== 0) fail("dtQ must be 0 (zero displacement)");
  if (cfg.motility !== false) fail("motility must be off");
  if (cfg.tilesX !== 1 || cfg.tilesY !== 1) fail("a single tile is required");
  if (!Number.isInteger(cfg.spread) || cfg.spread < 0 || cfg.spread > 63) fail("invalid spread");
  for (const key of FORBIDDEN_OPTIONAL) {
    if (key in cfg && (cfg as unknown as Record<string, unknown>)[key] !== undefined) fail(`${key} must be absent`);
  }
  for (const key of Object.keys(cfg)) {
    if (!(key in DOMAIN_KEYS) && !ALLOWED_OPTIONAL.has(key)) fail(`unexpected config key ${key}`);
  }
}
const DOMAIN_KEYS: Record<string, true> = Object.fromEntries([
  "ruleVersion", "seed", "tileW", "tileH", "tilesX", "tilesY", "eA", "eB", "eC", "eP", "massUnit",
  "kernelRadius", "thetaMass", "dtQ", "spread", "defaultMu", "defaultSigma", "diffA", "diffC", "diffS",
  "gateK", "kCatHalf", "kPhoto", "kResp", "kDecomp", "kGrow", "kBuild", "kEmit", "kCost", "kMaint",
  "kPDecay", "kBDecay", "kELeak", "kSDecay", "kAbio", "mutRate", "mutStep", "lightMode", "lightBase",
  "lightAmp", "seasonPeriod", "seasonAmp", "eventCap", "neutral", "motility",
].map((k) => [k, true]));

/**
 * Largest per-step amount any recorded role (PHOTO, GROW, RESP, DECOMP) can
 * take in one cell: each reaction moves at most floor(cat * rate / 4096) + 1
 * quanta, cat <= B <= the world's total matter, and the controller and light
 * factors are at most 127/128 and 255/256.
 */
export function roleCounterBound(cfg: WorldConfig, totalMatter: bigint): number {
  const rate = Math.max(cfg.kPhoto, cfg.kGrow, cfg.kResp, cfg.kDecomp);
  const bound = (totalMatter * BigInt(rate)) / 4096n + 1n;
  return Number(bound > 0xffffffffn ? 0xffffffffn : bound);
}

/** Exact bound shares leaving a cell with zero displacement, per direction. */
export interface BoundStencil {
  hw: number;
  d2: number;
  /** [dx, dy, weight] for the eight off-centre directions with nonzero weight. */
  dirs: [number, number, number][];
}
export function boundStencil(spread: number): BoundStencil {
  const hw = 32 + spread, d2 = 4 * hw * hw;
  const dirs: [number, number, number][] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const w = w1d(0, dx, hw) * w1d(0, dy, hw);
      if (w > 0) dirs.push([dx, dy, w]);
    }
  }
  return { hw, d2, dirs };
}

/**
 * Exact post-transport amounts of one bound channel with zero displacement.
 * Returns the amount after transport and the gross amounts entering and
 * leaving each cell. Pure: reads `q`, writes only its outputs.
 */
export function boundTransport(
  q: ArrayLike<number>,
  W: number,
  H: number,
  stencil: BoundStencil,
): { after: Float64Array; grossIn: Float64Array; grossOut: Float64Array } {
  const n = W * H;
  const after = new Float64Array(n), grossIn = new Float64Array(n), grossOut = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const amount = q[s];
    if (amount === 0) continue;
    const x = s % W, y = (s - x) / W;
    for (const [dx, dy, w] of stencil.dirs) {
      const share = mulShareD(amount, w, stencil.d2);
      if (share === 0) continue;
      const t = ((y + dy + H) % H) * W + ((x + dx + W) % W);
      grossOut[s] += share;
      grossIn[t] += share;
    }
  }
  for (let i = 0; i < n; i++) after[i] = q[i] - grossOut[i] + grossIn[i];
  return { after, grossIn, grossOut };
}

const CUMULATIVE = [
  "photo",
  "grow",
  "resp",
  "decomp",
  "reactB",
  "boundBIn",
  "boundBOut",
  "reactE",
  "boundEIn",
  "boundEOut",
] as const;
export type CumulativeName = (typeof CUMULATIVE)[number];
export const CUMULATIVE_NAMES: readonly CumulativeName[] = CUMULATIVE;

export interface MaskSpec {
  name: string;
  sites: number[];
}

export interface ObserverSnapshot {
  version: string;
  step: number;
  stepsObserved: number;
  cumulative: Record<CumulativeName, number[]>;
  masks: Record<string, PatchTransport>;
  lightExposure: string;
  activeBArea: string;
}

export interface CensusRecord {
  kind: "census";
  step: number;
  stateHash?: string;
  /** Per-cell amounts at this census. */
  cells: { B: number[]; P: number[]; E: number[] };
  /** Per-cell cumulative observer values since step 0 (signed for reactB, reactE). */
  cumulative: Record<CumulativeName, number[]>;
  masks: Record<string, PatchTransport>;
  /** Sum over executed steps and cells of the offered light level L. */
  lightExposure: string;
  /** Sum over executed steps of total active B after the step. */
  activeBArea: string;
  /** digestWords hex of RefSim.roles after the last executed step ("" at step 0). */
  lastStepRolesDigest: string;
}

const emptyPatch = (): PatchTransport => ({
  A: { grossIn: 0, grossOut: 0, netIn: 0, internal: 0 },
  C: { grossIn: 0, grossOut: 0, netIn: 0, internal: 0 },
});

export function rolesDigest(roles: Uint32Array): string {
  const [a, b] = digestWords(roles);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

const FX = Object.fromEntries(FLUX_NAMES.map((k, i) => [k, i])) as Record<FluxName, number>;

export class RenewalObserver {
  readonly n: number;
  readonly W: number;
  readonly H: number;
  readonly stencil: BoundStencil;
  readonly roleBound: number;
  private readonly cum: Record<CumulativeName, Float64Array>;
  private readonly masks: { spec: MaskSpec; mask: Uint8Array; flux: PatchTransport }[];
  private lightExposure = 0n;
  private activeBArea = 0n;
  private stepsObserved = 0;
  private step: number;
  // Per-step scratch, filled by beforeStep and consumed by afterStep.
  private pending: {
    step: number;
    preB: Float64Array;
    preE: Float64Array;
    B: ReturnType<typeof boundTransport>;
    E: ReturnType<typeof boundTransport>;
    flux: bigint[];
    patches: PatchTransport[];
    exposure: number;
  } | null = null;

  constructor(state: WorldState, masks: MaskSpec[], totalMatter: bigint, snapshot?: ObserverSnapshot) {
    const cfg = state.cfg;
    checkObserverDomain(cfg);
    this.n = cellCount(cfg);
    this.W = worldW(cfg);
    this.H = this.n / this.W;
    this.stencil = boundStencil(cfg.spread);
    this.roleBound = roleCounterBound(cfg, totalMatter);
    if (this.roleBound >= 0xffff) {
      throw new Error(`role counters could saturate (bound ${this.roleBound}); per-cell roles are not exact here`);
    }
    this.cum = Object.fromEntries(CUMULATIVE.map((k) => [k, new Float64Array(this.n)])) as Record<CumulativeName, Float64Array>;
    this.masks = masks.map((spec) => {
      const mask = new Uint8Array(this.n);
      for (const s of spec.sites) {
        if (!Number.isInteger(s) || s < 0 || s >= this.n) throw new Error(`invalid mask site ${s}`);
        mask[s] = 1;
      }
      return { spec, mask, flux: emptyPatch() };
    });
    this.step = state.step;
    if (snapshot) this.restore(snapshot, state.step);
  }

  private restore(s: ObserverSnapshot, step: number): void {
    if (s.version !== RENEWAL_OBSERVER_VERSION) throw new Error(`observer version ${s.version}`);
    if (s.step !== step) throw new Error(`observer snapshot at step ${s.step}, state at ${step}`);
    for (const k of CUMULATIVE) {
      if (s.cumulative[k].length !== this.n) throw new Error(`snapshot ${k} length`);
      this.cum[k].set(s.cumulative[k]);
    }
    for (const m of this.masks) {
      const f = s.masks[m.spec.name];
      if (!f) throw new Error(`snapshot lacks mask ${m.spec.name}`);
      m.flux = structuredClone(f);
    }
    this.lightExposure = BigInt(s.lightExposure);
    this.activeBArea = BigInt(s.activeBArea);
    this.stepsObserved = s.stepsObserved;
  }

  /** Records everything the next step needs, from the incoming state. Read-only. */
  beforeStep(sim: RefSim): void {
    if (this.pending) throw new Error("beforeStep called twice without afterStep");
    const st = sim.state, n = this.n;
    if (st.step !== this.step) throw new Error(`observer at step ${this.step}, simulator at ${st.step}`);
    // Copy, not reference: RefSim swaps and reuses its cell buffers.
    const preB = Float64Array.from(st.cells.subarray(CH.B * n, (CH.B + 1) * n));
    const preE = Float64Array.from(st.cells.subarray(CH.E * n, (CH.E + 1) * n));
    const B = boundTransport(preB, this.W, this.H, this.stencil);
    const E = boundTransport(preE, this.W, this.H, this.stencil);
    const patches = this.masks.map((m) => patchTransport(st, m.mask));
    let exposure = 0;
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) exposure += sim.light(x, y, st.step);
    this.pending = { step: st.step, preB, preE, B, E, flux: st.flux.slice(), patches, exposure };
  }

  /** Accounts the executed step and reconciles it to the simulator's global ledgers. */
  afterStep(sim: RefSim): void {
    const p = this.pending;
    if (!p) throw new Error("afterStep without beforeStep");
    const st = sim.state, n = this.n;
    if (st.step !== p.step + 1) throw new Error(`expected step ${p.step + 1}, simulator at ${st.step}`);
    const roles = sim.roles;
    const d = (name: FluxName) => Number(st.flux[FX[name]] - p.flux[FX[name]]);
    let sumPhoto = 0, sumGrow = 0, sumResp = 0, sumDecomp = 0;
    let preBTotal = 0, postBTotal = 0, afterBTotal = 0, sumReactB = 0;
    let preETotal = 0, postETotal = 0;
    const reactB = new Float64Array(n), reactE = new Float64Array(n);
    const role = new Uint32Array(4 * n);
    for (let i = 0; i < n; i++) {
      const r0 = roles[i * 2], r1 = roles[i * 2 + 1];
      const photo = r0 & 0xffff, grow = r0 >>> 16, decomp = r1 & 0xffff, resp = r1 >>> 16;
      if (photo > this.roleBound || grow > this.roleBound || decomp > this.roleBound || resp > this.roleBound) {
        throw new Error(`role counter at cell ${i} exceeds its proven bound ${this.roleBound}`);
      }
      role[4 * i] = photo;
      role[4 * i + 1] = grow;
      role[4 * i + 2] = resp;
      role[4 * i + 3] = decomp;
      sumPhoto += photo;
      sumGrow += grow;
      sumResp += resp;
      sumDecomp += decomp;
      const Bafter = st.cells[CH.B * n + i], Eafter = st.cells[CH.E * n + i];
      reactB[i] = Bafter - p.B.after[i];
      reactE[i] = Eafter - p.E.after[i];
      preBTotal += p.preB[i];
      postBTotal += p.B.after[i];
      afterBTotal += Bafter;
      sumReactB += reactB[i];
      preETotal += p.preE[i];
      postETotal += p.E.after[i];
    }
    const fail = (why: string) => {
      throw new Error(`observer reconciliation failed at step ${st.step}: ${why}`);
    };
    if (postBTotal !== preBTotal) fail("bound B transport is not conservative");
    if (postETotal !== preETotal) fail("bound E transport is not conservative");
    if (sumPhoto !== d("photo")) fail(`photo roles ${sumPhoto} != flux ${d("photo")}`);
    if (sumGrow !== d("grow")) fail(`grow roles ${sumGrow} != flux ${d("grow")}`);
    if (sumResp !== d("resp")) fail(`resp roles ${sumResp} != flux ${d("resp")}`);
    if (sumDecomp !== d("decomp")) fail(`decomp roles ${sumDecomp} != flux ${d("decomp")}`);
    const fluxB = d("photo") + d("grow") - d("resp") - d("build") - d("starve") - d("bdecay");
    if (afterBTotal - preBTotal !== fluxB) fail(`global B change ${afterBTotal - preBTotal} != photo+grow-resp-build-starve-bdecay ${fluxB}`);
    if (sumReactB !== fluxB) fail(`summed local reaction change ${sumReactB} != ${fluxB}`);
    // Commit only after every check passed.
    const c = this.cum;
    for (let i = 0; i < n; i++) {
      c.photo[i] += role[4 * i];
      c.grow[i] += role[4 * i + 1];
      c.resp[i] += role[4 * i + 2];
      c.decomp[i] += role[4 * i + 3];
      c.reactB[i] += reactB[i];
      c.boundBIn[i] += p.B.grossIn[i];
      c.boundBOut[i] += p.B.grossOut[i];
      c.reactE[i] += reactE[i];
      c.boundEIn[i] += p.E.grossIn[i];
      c.boundEOut[i] += p.E.grossOut[i];
    }
    this.masks.forEach((m, k) => {
      for (const sp of ["A", "C"] as const) {
        for (const key of ["grossIn", "grossOut", "netIn", "internal"] as const) m.flux[sp][key] += p.patches[k][sp][key];
      }
    });
    this.lightExposure += BigInt(p.exposure);
    this.activeBArea += BigInt(afterBTotal);
    this.stepsObserved++;
    this.step = st.step;
    this.pending = null;
  }

  /** Census of the current state; `stateHash` is added by the caller. */
  census(sim: RefSim): CensusRecord {
    if (this.pending) throw new Error("census between beforeStep and afterStep");
    const st = sim.state, n = this.n;
    if (st.step !== this.step) throw new Error("census out of step");
    const chan = (ch: number) => Array.from(st.cells.subarray(ch * n, (ch + 1) * n));
    const snap = this.snapshot();
    for (const k of CUMULATIVE) {
      for (const v of snap.cumulative[k]) if (!Number.isSafeInteger(v)) throw new Error(`cumulative ${k} left the safe-integer range`);
    }
    return {
      kind: "census",
      step: st.step,
      cells: { B: chan(CH.B), P: chan(CH.P), E: chan(CH.E) },
      cumulative: snap.cumulative,
      masks: snap.masks,
      lightExposure: snap.lightExposure,
      activeBArea: snap.activeBArea,
      lastStepRolesDigest: this.stepsObserved === 0 ? "" : rolesDigest(sim.roles),
    };
  }

  /** Observer state for a physics+observer checkpoint (plain JSON, no bigint). */
  snapshot(): ObserverSnapshot {
    return {
      version: RENEWAL_OBSERVER_VERSION,
      step: this.step,
      stepsObserved: this.stepsObserved,
      cumulative: Object.fromEntries(CUMULATIVE.map((k) => [k, Array.from(this.cum[k])])) as Record<CumulativeName, number[]>,
      masks: Object.fromEntries(this.masks.map((m) => [m.spec.name, structuredClone(m.flux)])),
      lightExposure: this.lightExposure.toString(),
      activeBArea: this.activeBArea.toString(),
    };
  }
}

/** Bindings this module uses, for the frozen launch's module-identity check. */
export const OBSERVER_BINDINGS: [unknown, string, string][] = [
  [mulShareD, "packages/sim-ref/src/index.ts", "mulShareD"],
  [w1d, "packages/sim-ref/src/index.ts", "w1d"],
  [digestWords, "packages/schema/src/index.ts", "digestWords"],
  [cellCount, "packages/schema/src/index.ts", "cellCount"],
  [patchTransport, "tools/lib/construction-transport.ts", "patchTransport"],
];
