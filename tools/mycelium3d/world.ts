// Mycelium in a volume, rung R0: the CPU reference for neural particles over a conserved 3D field.
//
// The rules in prose, with every arithmetic bound, are in tools/mycelium3d/RULES.md; this file is their
// executable form and the later WGSL twin must match it bit for bit. It copies the 2D mycelium world
// (tools/mycelium/world.ts, rule mycelium-r0) except where RULES.md says otherwise: x and y wrap, z is
// closed, light enters at layer 0 and is shaded layer by layer, waste and trail may sink, the controller
// is 13 -> 8 -> 9 with an MZ output. It does not import tools/mycelium/, so the 3D rule never moves with
// the 2D one; the small pure helpers it shares are copied here.
//
// Every step is order-free apart from births, whose ids and slots come from a prefix sum over slot order.
import { B1_OFF, B2_OFF, cellBase, clampi, divi, divu, draw, lowbias32, mulFrac, NN_BYTES, NN_H, NN_I, NN_O, W1_OFF, W2_OFF } from "@bl/schema";
import { diffOut6 } from "@bl/sim-ref";

export const RULE_ID = "mycelium3d-r0";
/** Fixed-point positions: one field cell is 256 position units on each axis. */
export const POS_SHIFT = 8;

// ---- controller layout: 13 inputs -> 8 hidden -> 9 outputs ---------------------------------------
export const NN_I3 = 13;
export const NN_H3 = 8;
export const NN_O3 = 9;
export const W1_OFF3 = 0;
export const B1_OFF3 = W1_OFF3 + NN_I3 * NN_H3; // 104
export const W2_OFF3 = B1_OFF3 + NN_H3; // 112
export const B2_OFF3 = W2_OFF3 + NN_H3 * NN_O3; // 184
/** Weight bytes (mutation and random draws range over these). */
export const NN_WEIGHTS3 = B2_OFF3 + NN_O3; // 193
/** Bytes per genome record: 49 u32 words, the last 3 bytes padding and always 0. */
export const NN_BYTES3 = 196;

/** Controller outputs this rule reads. BOND (5) is read only with bondBreak; 6 and 7 are reserved, as in 2D. */
export const OUT = { MX: 0, MY: 1, EAT: 2, DEPOSIT: 3, SPLIT: 4, BOND: 5, MZ: 8 } as const;
/** An empty bond slot. Ids end at ID_MAX = 0xfffffffe, so this is never an id. */
export const BOND_NONE = 0xffffffff;
export const BOND_BREAK_MAX = 1024;
/** Controller inputs, in order. */
export const SENSORS = [
  "nutrient", "waste", "trail", "trail east-west", "trail south-north", "nutrient east-west", "nutrient south-north", "energy", "body",
  "crowding", "trail down-up", "nutrient down-up", "light",
] as const;

/** 13 -> 8 -> 9 controller with the kernel's arithmetic: int8 weights, ReLU hidden saturating at 127, outputs in +-127, divi by 128. */
export function controllerForward13(wb: Int8Array, x: Int32Array, h: Int32Array, o: Int32Array): void {
  for (let j = 0; j < NN_H3; j++) {
    let acc = wb[B1_OFF3 + j] * 128;
    for (let k = 0; k < NN_I3; k++) acc += wb[W1_OFF3 + k * NN_H3 + j] * x[k];
    h[j] = clampi(divi(acc, 128), 0, 127);
  }
  for (let k = 0; k < NN_O3; k++) {
    let acc = wb[B2_OFF3 + k] * 128;
    for (let j = 0; j < NN_H3; j++) acc += wb[W2_OFF3 + j * NN_O3 + k] * h[j];
    o[k] = clampi(divi(acc, 128), -127, 127);
  }
}

/**
 * Lifts a 2D mycelium genome (160 bytes, 10 -> 8 -> 8) into the 3D record. W1 moves by (input, hidden) and W2 by
 * (hidden, output), never by byte offset; rows 10-12 of W1, the MZ column of W2, the MZ bias and the padding are 0,
 * so the lift's outputs 0..7 equal the 2D net's and MZ is 0.
 */
export function liftMyceliumGenome(g2: Int8Array): Int8Array {
  if (g2.length !== NN_BYTES) throw new Error(`liftMyceliumGenome: ${g2.length} bytes; expected ${NN_BYTES}`);
  const out = new Int8Array(NN_BYTES3);
  for (let i = 0; i < NN_I; i++) for (let j = 0; j < NN_H; j++) out[W1_OFF3 + i * NN_H3 + j] = g2[W1_OFF + i * NN_H + j];
  for (let j = 0; j < NN_H; j++) out[B1_OFF3 + j] = g2[B1_OFF + j];
  for (let j = 0; j < NN_H; j++) for (let k = 0; k < NN_O; k++) out[W2_OFF3 + j * NN_O3 + k] = g2[W2_OFF + j * NN_O + k];
  for (let k = 0; k < NN_O; k++) out[B2_OFF3 + k] = g2[B2_OFF + k];
  return out;
}

// ---- configuration --------------------------------------------------------------------------------
export type Heredity = "inherit" | "frozen" | "blocked";
export type LightPattern = "uniform" | "gradient";
export type TrailDiscountMode = "public" | "toll";
export type TrailOwnerMode = "id" | "gid";
export const TRAIL_DISCOUNT_MAX = 256;
export const CONDUIT_MAX = 255;
export const CONDUIT_DD_MAX = 128;
/** The slab's cap on the shading matter of one cell (step3d.ts MCAP). */
export const MCAP = 16383;
export const DEPTH_MAX = 64;
export const CELLS_MAX = 1 << 24;

/** The trail conduit's per-edge A rate (2D rule, copied): min before multiply, at most 128, symmetric. */
export function conduitRate(De: number, g: number, q: number, pk: number, pn: number): number {
  const x = Math.min(pk, pn, q);
  return Math.min(De + ((x * g) >>> 4), CONDUIT_DD_MAX);
}

/** The owner conduit's per-edge A rate (2D rule, copied): only a same-owner edge conducts. */
export function ownerRate(De: number, g: number, q: number, zk: number, zn: number, qk: number, qn: number): number {
  if (zk === 0 || zk !== zn) return De;
  return Math.min(De + ((Math.min(qk, qn, q) * g) >>> 4), CONDUIT_DD_MAX);
}

/** Phase 5's claim resolution for owner worlds (2D rule, copied): two passes of max, then same-clan depositors all count. */
export function resolveClaims(Z: Uint32Array, Q: Uint32Array, N: number, cell: readonly number[], dep: readonly number[], tag: readonly number[]): void {
  const W1 = new Uint32Array(N), W2 = new Uint32Array(N);
  for (let j = 0; j < cell.length; j++) if (dep[j] > W1[cell[j]]) W1[cell[j]] = dep[j];
  for (let j = 0; j < cell.length; j++) if (dep[j] === W1[cell[j]] && tag[j] > W2[cell[j]]) W2[cell[j]] = tag[j];
  for (let j = 0; j < cell.length; j++) if (tag[j] === W2[cell[j]]) Q[cell[j]] += dep[j];
  for (let j = 0; j < cell.length; j++) if (Z[cell[j]] === 0) Z[cell[j]] = W2[cell[j]];
}

/** The 3D cell index of cell i shifted by (+s, +s) within its layer (the ghost controls read there). */
export function shiftCell(i: number, s: number, W: number, H: number): number {
  const x = i % W, y = ((i / W) | 0) % H, z = (i / (W * H)) | 0;
  return (z * H + ((y + s) % H)) * W + ((x + s) % W);
}

export const ownerTag = (v: number): number => v + 1;

export interface Mycelium3dConfig {
  rule: typeof RULE_ID;
  width: number;
  height: number;
  /** Layers: 0 is the surface, depth - 1 the floor. */
  depth: number;
  seed: number;
  maxParticles: number;
  founders: number;
  founderMatter: number;
  founderEnergy: number;
  weightSpan: number;
  nutrient0: number;
  eA: number;
  maxEat: number;
  bodyMax: number;
  speed: number;
  upkeep: number;
  moveCost: number;
  massUpkeepShift: number;
  maxDeposit: number;
  depositCost: number;
  excreteShift: number;
  splitEnergy: number;
  splitMatter: number;
  energyMax: number;
  /** Waste turned into nutrient per cell per step under unshaded light (the only energy input). */
  light: number;
  lightPattern: LightPattern;
  /** Shading half-saturation: each layer passes T(m) = floor(256 * lightK / (lightK + m)) / 256 of the light above. */
  lightK: number;
  pDecay: number;
  /** Diffusion of A and C over the six faces (slab diffOut6: about q * De / 256 leaves an interior cell in total). */
  diffA: number;
  diffC: number;
  heredity: Heredity;
  /** Optional. Integer 1..16: each step every cell above the floor sends C / 2^k and P / 2^k (stochastically rounded) to the cell below. */
  sinkShift?: number;
  /** Optional. Integer 0..16: waste shades the light below too, as C >> k units of shading matter (RULES.md, "Waste shading"). */
  wasteShade?: number;
  trailMoveDiscount?: number;
  trailDiscountMode?: TrailDiscountMode;
  trailConduit?: number;
  trailConduitCap?: number;
  trailConduitGhost?: number;
  trailOwner?: TrailOwnerMode;
  ownerDefend?: number;
  ownerConduit?: number;
  ownerConduitCap?: number;
  ownerGhost?: number;
  /** Optional. Integer 1..1024 (position units): turns bonds on; a bond breaks when its partners end a step farther apart (RULES.md, "Bonds"). */
  bondBreak?: number;
  /** Optional, requires bondBreak. Integer 0..4096: energy each partner pays per bond per step, as heat (absent means 0). */
  bondCost?: number;
  /** Optional, requires bondBreak. A child is born bonded to its parent when the parent has a free bond slot. */
  bondChild?: true;
  mutRate: number;
  mutCount: number;
  mutStep: number;
  sensorShift: number;
  energyShift: number;
  massShift: number;
}

/** Engineered defaults for a 32 x 32 x 16 world (RULES.md, "Tuning"); choices, not findings. */
export function defaultConfig(over: Partial<Mycelium3dConfig> = {}): Mycelium3dConfig {
  return {
    rule: RULE_ID,
    width: 32,
    height: 32,
    depth: 16,
    seed: 1,
    maxParticles: 8192,
    founders: 1024,
    founderMatter: 32,
    founderEnergy: 512,
    weightSpan: 48,
    nutrient0: 48,
    eA: 4,
    maxEat: 16,
    bodyMax: 256,
    speed: 128,
    upkeep: 6,
    moveCost: 2,
    massUpkeepShift: 6,
    maxDeposit: 4,
    depositCost: 2,
    excreteShift: 6,
    splitEnergy: 384,
    splitMatter: 48,
    energyMax: 4096,
    light: 1,
    lightPattern: "uniform",
    lightK: 64,
    pDecay: 655,
    diffA: 40,
    diffC: 40,
    heredity: "inherit",
    mutRate: 16384,
    mutCount: 2,
    mutStep: 16,
    sensorShift: 0,
    energyShift: 4,
    massShift: 1,
    ...over,
  };
}

export interface Totals {
  lightIn: number;
  heat: number;
  births: number;
  deaths: number;
  refused: number;
  contended: number;
  mutations: number;
}

export interface Mycelium3dState {
  config: Mycelium3dConfig;
  step: number;
  /** Field: nutrient, waste, trail; index (z * H + y) * W + x. */
  A: Uint32Array;
  C: Uint32Array;
  P: Uint32Array;
  /** Only with trailOwner: owner tag and owned trail per cell. */
  Z?: Uint32Array;
  Q?: Uint32Array;
  /** Only with bondBreak: each particle's two bond slots (partner id or BOND_NONE; canonical: one bond in bond0, two in increasing id order), slot order. */
  bond0?: Uint32Array;
  bond1?: Uint32Array;
  n: number;
  id: Uint32Array;
  parent: Uint32Array;
  gid: Uint32Array;
  x: Uint32Array;
  y: Uint32Array;
  z: Uint32Array;
  M: Uint32Array;
  E: Uint32Array;
  age: Uint32Array;
  /** NN_BYTES3 bytes per particle, in slot order. */
  genome: Int8Array;
  nextId: number;
  nextGid: number;
  matter0: number;
  energy0: number;
  totals: Totals;
}

const INT_KEYS: (keyof Mycelium3dConfig)[] = [
  "width", "height", "depth", "seed", "maxParticles", "founders", "founderMatter", "founderEnergy", "weightSpan", "nutrient0", "eA", "maxEat",
  "bodyMax", "speed", "upkeep", "moveCost", "massUpkeepShift", "maxDeposit", "depositCost", "excreteShift", "splitEnergy",
  "splitMatter", "energyMax", "light", "lightK", "pDecay", "diffA", "diffC", "mutRate", "mutCount", "mutStep", "sensorShift", "energyShift", "massShift",
];
/** Every key a config may carry; anything else (including the 2D keys not ported) is rejected. */
const KNOWN_KEYS = new Set<string>([
  "rule", "lightPattern", "heredity", ...INT_KEYS, "sinkShift", "wasteShade", "trailMoveDiscount", "trailDiscountMode", "trailConduit", "trailConduitCap",
  "trailConduitGhost", "trailOwner", "ownerDefend", "ownerConduit", "ownerConduitCap", "ownerGhost", "bondBreak", "bondCost", "bondChild",
]);

/** Ranges that keep every product in step() below 2^32; RULES.md derives each one. Returns problems, empty when valid. */
export function validateConfig(c: Mycelium3dConfig): string[] {
  const bad: string[] = [];
  if (c.rule !== RULE_ID) bad.push(`rule must be ${RULE_ID}`);
  for (const k of Object.keys(c)) if (!KNOWN_KEYS.has(k)) bad.push(`unknown key ${k}`);
  for (const k of INT_KEYS) {
    const v = c[k] as number;
    if (!Number.isInteger(v) || v < 0) bad.push(`${k} must be a non-negative integer`);
  }
  const range = (k: keyof Mycelium3dConfig, lo: number, hi: number) => {
    const v = c[k] as number;
    if (!(v >= lo && v <= hi)) bad.push(`${k} must be in [${lo}, ${hi}]`);
  };
  range("width", 8, 512); range("height", 8, 512); range("depth", 1, DEPTH_MAX); range("seed", 0, 0xffffffff);
  if (c.width * c.height * c.depth > CELLS_MAX) bad.push("width * height * depth must not exceed 2^24");
  range("maxParticles", 1, 1 << 16); range("founders", 0, c.maxParticles);
  range("weightSpan", 0, 127); range("eA", 1, 255); range("maxEat", 0, 255); range("bodyMax", 1, 1 << 16);
  range("speed", 0, 256); range("upkeep", 0, 1 << 12); range("moveCost", 0, 1 << 12); range("massUpkeepShift", 1, 16);
  range("maxDeposit", 0, 255); range("depositCost", 1, 1 << 12); range("excreteShift", 1, 16);
  range("splitEnergy", 0, 1 << 24); range("splitMatter", 2, 1 << 16); range("energyMax", 1, 1 << 24);
  range("founderMatter", 1, c.bodyMax); range("founderEnergy", 0, c.energyMax);
  range("light", 0, 1 << 12); range("lightK", 1, 65536); range("pDecay", 0, 65535); range("diffA", 0, 256); range("diffC", 0, 256);
  range("mutRate", 0, 65536); range("mutCount", 0, 16); range("mutStep", 1, 127);
  range("sensorShift", 0, 24); range("energyShift", 0, 24); range("massShift", 0, 16);
  if (c.heredity !== "inherit" && c.heredity !== "frozen" && c.heredity !== "blocked") bad.push("heredity must be inherit, frozen or blocked");
  if (c.lightPattern !== "uniform" && c.lightPattern !== "gradient") bad.push("lightPattern must be uniform or gradient");
  const isInt = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
  const shiftMax = Math.min(c.width, c.height) - 1;
  if (c.sinkShift !== undefined && !isInt(c.sinkShift, 1, 16)) bad.push("sinkShift must be an integer in [1, 16]");
  if (c.wasteShade !== undefined && !isInt(c.wasteShade, 0, 16)) bad.push("wasteShade must be an integer in [0, 16]");
  if (c.trailMoveDiscount !== undefined && !isInt(c.trailMoveDiscount, 0, TRAIL_DISCOUNT_MAX)) bad.push(`trailMoveDiscount must be an integer in [0, ${TRAIL_DISCOUNT_MAX}]`);
  if (c.trailDiscountMode !== undefined) {
    if (c.trailDiscountMode !== "public" && c.trailDiscountMode !== "toll") bad.push("trailDiscountMode must be public or toll");
    if (c.trailMoveDiscount === undefined) bad.push("trailDiscountMode requires trailMoveDiscount");
  }
  if (c.trailConduit !== undefined) {
    if (!isInt(c.trailConduit, 0, CONDUIT_MAX)) bad.push(`trailConduit must be an integer in [0, ${CONDUIT_MAX}]`);
    if (c.diffA > CONDUIT_DD_MAX) bad.push(`trailConduit requires diffA <= ${CONDUIT_DD_MAX}`);
  }
  if (c.trailConduitCap !== undefined) {
    if (!isInt(c.trailConduitCap, 1, CONDUIT_MAX)) bad.push(`trailConduitCap must be an integer in [1, ${CONDUIT_MAX}]`);
    if (c.trailConduit === undefined) bad.push("trailConduitCap requires trailConduit");
  }
  if (c.trailConduitGhost !== undefined) {
    if (!isInt(c.trailConduitGhost, 1, shiftMax)) bad.push(`trailConduitGhost must be an integer in [1, ${shiftMax}]`);
    if (c.trailConduit === undefined) bad.push("trailConduitGhost requires trailConduit");
  }
  if (c.trailOwner !== undefined && c.trailOwner !== "id" && c.trailOwner !== "gid") bad.push("trailOwner must be id or gid");
  if (c.ownerDefend !== undefined) {
    if (!isInt(c.ownerDefend, 1, 255)) bad.push("ownerDefend must be an integer in [1, 255]");
    if (c.trailOwner === undefined) bad.push("ownerDefend requires trailOwner");
  }
  if (c.ownerConduit !== undefined) {
    if (!isInt(c.ownerConduit, 0, CONDUIT_MAX)) bad.push(`ownerConduit must be an integer in [0, ${CONDUIT_MAX}]`);
    if (c.trailOwner === undefined) bad.push("ownerConduit requires trailOwner");
    if (c.diffA > CONDUIT_DD_MAX) bad.push(`ownerConduit requires diffA <= ${CONDUIT_DD_MAX}`);
    if (c.trailConduit !== undefined) bad.push("ownerConduit excludes trailConduit");
  }
  if (c.ownerConduitCap !== undefined) {
    if (!isInt(c.ownerConduitCap, 1, CONDUIT_MAX)) bad.push(`ownerConduitCap must be an integer in [1, ${CONDUIT_MAX}]`);
    if (c.ownerConduit === undefined) bad.push("ownerConduitCap requires ownerConduit");
  }
  if (c.ownerGhost !== undefined) {
    if (!isInt(c.ownerGhost, 1, shiftMax)) bad.push(`ownerGhost must be an integer in [1, ${shiftMax}]`);
    if (c.ownerConduit === undefined) bad.push("ownerGhost requires ownerConduit");
  }
  if (c.bondBreak !== undefined && !isInt(c.bondBreak, 1, BOND_BREAK_MAX)) bad.push(`bondBreak must be an integer in [1, ${BOND_BREAK_MAX}]`);
  if (c.bondCost !== undefined) {
    if (!isInt(c.bondCost, 0, 1 << 12)) bad.push("bondCost must be an integer in [0, 4096]");
    if (c.bondBreak === undefined) bad.push("bondCost requires bondBreak");
  }
  if (c.bondChild !== undefined) {
    if (c.bondChild !== true) bad.push("bondChild must be true or absent");
    if (c.bondBreak === undefined) bad.push("bondChild requires bondBreak");
  }
  const total = c.width * c.height * c.depth * c.nutrient0 + c.founders * c.founderMatter;
  if (total > 2 ** 31) bad.push("initial matter must not exceed 2^31");
  return bad;
}

/** Slot of particle `id` among the first n slots (slot order is id order), or -1. */
export function slotOfId(ids: Uint32Array, n: number, id: number): number {
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (ids[m] < id) lo = m + 1; else hi = m; }
  return lo < n && ids[lo] === id ? lo : -1;
}

/** The bond graph's invariants (RULES.md, "Bonds"): canonical slots, no self or repeated bond, a live partner, symmetric. */
function bondProblems(s: Mycelium3dState): string[] {
  const bad: string[] = [];
  const b0 = s.bond0!, b1 = s.bond1!;
  for (let i = 0; i < s.n && bad.length < 20; i++) {
    const a = b0[i], b = b1[i], me = s.id[i];
    if (a === BOND_NONE && b !== BOND_NONE) { bad.push(`particle ${me}: bond in slot 1 with slot 0 empty`); continue; }
    if (b !== BOND_NONE && !(a < b)) { bad.push(`particle ${me}: bond slots not in increasing id order`); continue; }
    for (const p of [a, b]) {
      if (p === BOND_NONE) continue;
      if (p === me) { bad.push(`particle ${me} is bonded to itself`); continue; }
      const j = slotOfId(s.id, s.n, p);
      if (j < 0) bad.push(`particle ${me} is bonded to ${p}, which is not alive`);
      else if (b0[j] !== me && b1[j] !== me) bad.push(`particle ${me} is bonded to ${p}, which does not name it back`);
    }
  }
  return bad;
}

export const LEDGER_MAX = 2 ** 50;
export const ID_MAX = 0xfffffffe;
/** Total matter bound (RULES.md, "Bounds"): it bounds every cell and every sum of cells, so u32 never wraps. */
export const MATTER_MAX = 2 ** 31;
/** Largest step a state may hold; step() refuses to run from it, so the counter never stops being exact. */
export const STEP_MAX = Number.MAX_SAFE_INTEGER;
const COUNTERS = ["lightIn", "heat", "births", "deaths", "refused", "contended", "mutations"] as const;
const isCount = (v: unknown, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= hi;

/** State-level checks: counts, ranges, the genome padding, the owner invariants and the two ledger identities. */
export function validateState(s: Mycelium3dState): string[] {
  const c = s.config;
  const bad = validateConfig(c);
  if (bad.length) return bad;
  if (!isCount(s.n, c.maxParticles)) return [...bad, "particle count out of range"];
  if (!isCount(s.step, STEP_MAX)) bad.push("step must be an integer in [0, 2^53 - 1]");
  if (!isCount(s.matter0, MATTER_MAX)) bad.push("matter0 must be an integer in [0, 2^31]");
  if (!isCount(s.energy0, LEDGER_MAX)) bad.push("energy0 must be an integer in [0, 2^50]");
  const keys = s.totals && typeof s.totals === "object" ? Object.keys(s.totals) : [];
  if (keys.length !== COUNTERS.length || COUNTERS.some((k) => !isCount(s.totals[k], LEDGER_MAX))) bad.push(`totals must hold exactly ${COUNTERS.join(", ")}, each an integer in [0, 2^50]`);
  const spanX = c.width << POS_SHIFT, spanY = c.height << POS_SHIFT, spanZ = c.depth << POS_SHIFT;
  for (let i = 0; i < s.n && bad.length < 20; i++) {
    if (s.x[i] >= spanX || s.y[i] >= spanY || s.z[i] >= spanZ) bad.push(`particle ${s.id[i]} outside the world`);
    if (s.M[i] === 0 || s.M[i] > c.bodyMax || s.E[i] > c.energyMax) bad.push(`particle ${s.id[i]} has no body, too much body or too much energy`);
    if (i > 0 && s.id[i] <= s.id[i - 1]) bad.push("slot order is not id order");
    if (s.id[i] >= s.nextId) bad.push(`particle id ${s.id[i]} not below nextId`);
    if (s.gid[i] >= s.nextGid) bad.push(`genotype id ${s.gid[i]} not below nextGid`);
    for (let b = NN_WEIGHTS3; b < NN_BYTES3; b++) if (s.genome[i * NN_BYTES3 + b] !== 0) { bad.push(`particle ${s.id[i]} has nonzero genome padding`); break; }
  }
  if (!Number.isInteger(s.nextId) || s.nextId < 0 || s.nextId > ID_MAX + 1) bad.push("nextId out of range");
  if (!Number.isInteger(s.nextGid) || s.nextGid < 0 || s.nextGid > ID_MAX + 1) bad.push("nextGid out of range");
  if (c.trailOwner === undefined) {
    if (s.Z !== undefined || s.Q !== undefined) bad.push("Z and Q require trailOwner");
  } else if (!s.Z || !s.Q || s.Z.length !== s.A.length || s.Q.length !== s.A.length) {
    bad.push("trailOwner requires Z and Q planes");
  } else {
    const limit = c.trailOwner === "id" ? s.nextId : s.nextGid;
    for (let k = 0; k < s.Z.length && bad.length < 20; k++) {
      if (s.Q[k] > s.P[k]) bad.push(`cell ${k}: owned trail ${s.Q[k]} above trail ${s.P[k]}`);
      if ((s.Z[k] === 0) !== (s.Q[k] === 0)) bad.push(`cell ${k}: owner tag and owned trail disagree`);
      if (s.Z[k] > limit) bad.push(`cell ${k}: owner tag ${s.Z[k]} beyond the ids issued`);
    }
  }
  if (c.bondBreak === undefined) {
    if (s.bond0 !== undefined || s.bond1 !== undefined) bad.push("bond slots require bondBreak");
  } else if (!s.bond0 || !s.bond1 || s.bond0.length < s.n || s.bond1.length < s.n) {
    bad.push("bondBreak requires the bond0 and bond1 slots");
  } else {
    bad.push(...bondProblems(s).slice(0, 20 - Math.min(bad.length, 20)));
  }
  // Every amount is a u32, so with the total at most 2^31 every cell and every sum of cells is too (RULES.md, "Bounds").
  const m = matterTotal(s);
  if (m > MATTER_MAX) bad.push(`total matter ${m} above 2^31`);
  if (m !== s.matter0) bad.push(`matter residual ${m - s.matter0}`);
  const e = energyTotal(s);
  const book = s.energy0 + s.totals.lightIn - s.totals.heat;
  if (e !== book) bad.push(`energy residual ${e - book}`);
  return bad;
}

const PARTICLE_SALT = 0x6d796331;
const FOUNDER_STEP = 0xffffffff;
const pbase = (seed: number, step: number, id: number) => cellBase((seed ^ PARTICLE_SALT) >>> 0, step, id);
const RND = { DX: 0, DY: 1, MUT: 2, MUT_SLOT: 3, MUT_DELTA: 40, UPKEEP: 90, EXCRETE: 91, DZ: 92, WEIGHT: 100 } as const;
/** Field stream slots, keyed on (seed, step, cell). */
const FIELD = { DECAY: 0, LIGHT: 1, SINK_C: 2, SINK_P: 3 } as const;
const DIFF_SALT = 0x64696666;
/** Stochastically rounded q / 2^shift for 1 <= shift <= 16; exact for any u32 q (mulFrac with k <= 2^15). */
const shrFrac = (q: number, shift: number, rnd: number) => mulFrac(q, 1 << (16 - shift), 16, rnd);

function randomWeights(out: Int8Array, off: number, base: number, span: number): void {
  for (let b = 0; b < NN_WEIGHTS3; b++) out[off + b] = (draw(base, RND.WEIGHT + b) % (2 * span + 1)) - span;
  for (let b = NN_WEIGHTS3; b < NN_BYTES3; b++) out[off + b] = 0;
}

function createEmpty(c: Mycelium3dConfig): Mycelium3dState {
  const N = c.width * c.height * c.depth, cap = c.maxParticles;
  const s: Mycelium3dState = {
    config: { ...c }, step: 0, A: new Uint32Array(N), C: new Uint32Array(N), P: new Uint32Array(N), n: 0,
    id: new Uint32Array(cap), parent: new Uint32Array(cap), gid: new Uint32Array(cap),
    x: new Uint32Array(cap), y: new Uint32Array(cap), z: new Uint32Array(cap),
    M: new Uint32Array(cap), E: new Uint32Array(cap), age: new Uint32Array(cap), genome: new Int8Array(cap * NN_BYTES3),
    nextId: 0, nextGid: 0, matter0: 0, energy0: 0, totals: { lightIn: 0, heat: 0, births: 0, deaths: 0, refused: 0, contended: 0, mutations: 0 },
  };
  if (c.trailOwner !== undefined) { s.Z = new Uint32Array(N); s.Q = new Uint32Array(N); }
  if (c.bondBreak !== undefined) { s.bond0 = new Uint32Array(cap).fill(BOND_NONE); s.bond1 = new Uint32Array(cap).fill(BOND_NONE); }
  return s;
}

export function createWorld(config: Mycelium3dConfig): Mycelium3dState {
  const bad = validateConfig(config);
  if (bad.length) throw new Error(`invalid mycelium3d config: ${bad.join("; ")}`);
  const s = createEmpty(config);
  const c = s.config;
  s.A.fill(c.nutrient0);
  for (let i = 0; i < c.founders; i++) {
    const base = pbase(c.seed, FOUNDER_STEP, i);
    s.id[i] = i; s.parent[i] = 0xffffffff; s.gid[i] = i;
    s.x[i] = draw(base, RND.DX) % (c.width << POS_SHIFT);
    s.y[i] = draw(base, RND.DY) % (c.height << POS_SHIFT);
    s.z[i] = draw(base, RND.DZ) % (c.depth << POS_SHIFT);
    s.M[i] = c.founderMatter; s.E[i] = c.founderEnergy;
    randomWeights(s.genome, i * NN_BYTES3, base, c.weightSpan);
  }
  s.n = c.founders; s.nextId = c.founders; s.nextGid = c.founders;
  s.matter0 = matterTotal(s);
  s.energy0 = energyTotal(s);
  return s;
}

export function matterTotal(s: Mycelium3dState): number {
  let t = 0;
  for (let k = 0; k < s.A.length; k++) t += s.A[k] + s.C[k] + s.P[k];
  for (let i = 0; i < s.n; i++) t += s.M[i];
  return t;
}

/** Particle energy plus the chemical energy stored in nutrient (eA per unit). C and P carry none. */
export function energyTotal(s: Mycelium3dState): number {
  let t = 0;
  for (let k = 0; k < s.A.length; k++) t += s.A[k];
  t *= s.config.eA;
  for (let i = 0; i < s.n; i++) t += s.E[i];
  return t;
}

export interface StepStats {
  lightIn: number;
  heat: number;
  births: number;
  deaths: number;
  refused: number;
  contended: number;
  mutations: number;
  /** Only with bondBreak, on the CPU only (not in totals): what the bond passes did this step. */
  bonds?: BondStats;
}
/**
 * Bond events of one step, each bond counted once: proposals made, bonds formed, released because a partner died (counted at the
 * survivor) or because an end let go (BOND < 0), stretched apart, and children born bonded.
 */
export interface BondStats { proposals: number; formed: number; partnerDied: number; letGo: number; stretched: number; childBonds: number }

const sat = (v: number) => (v > 127 ? 127 : v);
const relu = (v: number) => (v > 0 ? v : 0);

interface Bins {
  cell: Uint32Array;
  /** Crowding: particles per cell. */
  crowd: Uint32Array;
  /** The light plane in 1/256 units of conversion, from start-of-step P and binned M (and C, with wasteShade). */
  I: Uint32Array;
}

/** The surface light of column x, in 1/256 units (RULES.md, "The light plane"). */
function surfaceLight(c: Mycelium3dConfig, x: number): number {
  const top = c.light << 8;
  return c.lightPattern === "uniform" ? top : divu(top * (x + 1), c.width);
}

/**
 * The light plane from the field P, the per-cell particle matter Mb and (only with wasteShade) the waste C: layer 0 gets the
 * surface light, each layer below passes T(m) of it. P + Mb + C is at most the total matter (2^31), so the sum is exact.
 */
function shade(c: Mycelium3dConfig, P: Uint32Array, Mb: Uint32Array, C: Uint32Array): Uint32Array {
  const W = c.width, H = c.height, D = c.depth, WH = W * H;
  const I = new Uint32Array(WH * D);
  const K = c.lightK;
  const num = 256 * K;
  const ws = c.wasteShade;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let L = surfaceLight(c, x);
      I[y * W + x] = L;
      for (let z = 1; z < D; z++) {
        const above = (z - 1) * WH + y * W + x;
        const m = Math.min(P[above] + Mb[above] + (ws === undefined ? 0 : C[above] >>> ws), MCAP);
        const T = divu(num, K + m);
        L = (L * T) >>> 8;
        I[z * WH + y * W + x] = L;
      }
    }
  }
  return I;
}

/** Phase 1: each live particle's cell, the crowding counts and the light plane. Reads state, changes nothing. */
function binParticles(s: Mycelium3dState): Bins {
  const c = s.config;
  const W = c.width, H = c.height, N = W * H * c.depth;
  const cell = new Uint32Array(s.n);
  const crowd = new Uint32Array(N);
  const Mb = new Uint32Array(N);
  for (let i = 0; i < s.n; i++) {
    const ci = ((s.z[i] >>> POS_SHIFT) * H + (s.y[i] >>> POS_SHIFT)) * W + (s.x[i] >>> POS_SHIFT);
    cell[i] = ci;
    crowd[ci]++;
    Mb[ci] += s.M[i];
  }
  return { cell, crowd, I: shade(c, s.P, Mb, s.C) };
}

/** The light plane the next step will use (1/256 units of conversion per cell), for observers and tests. */
export function lightPlane(s: Mycelium3dState): Uint32Array {
  return binParticles(s).I;
}

/** Phases 2-3: sense the start-of-step field and run the controller. Returns NN_O3 outputs per particle in slot order. */
function senseAndThink(s: Mycelium3dState, b: Bins): Int32Array {
  const c = s.config;
  const W = c.width, H = c.height, D = c.depth, WH = W * H;
  const n = s.n;
  const { A, C, P, E, M } = s;
  const out = new Int32Array(n * NN_O3);
  const xin = new Int32Array(NN_I3), h = new Int32Array(NN_H3), o = new Int32Array(NN_O3);
  const sh = c.sensorShift;
  const top = c.light << 8;
  for (let i = 0; i < n; i++) {
    const ci = b.cell[i];
    const cx = ci % W, cy = ((ci / W) | 0) % H, cz = (ci / WH) | 0;
    const layer = cz * WH;
    const e = layer + cy * W + ((cx + 1) % W), w = layer + cy * W + ((cx + W - 1) % W);
    const so = layer + ((cy + 1) % H) * W + cx, no = layer + ((cy + H - 1) % H) * W + cx;
    // A z neighbour outside the volume reads the cell's own value (zero gradient at the walls, the slab's rule).
    const up = cz > 0 ? ci - WH : ci, dn = cz < D - 1 ? ci + WH : ci;
    xin[0] = sat(A[ci] >>> sh);
    xin[1] = sat(C[ci] >>> sh);
    xin[2] = sat(P[ci] >>> sh);
    xin[3] = clampi(sat(P[e] >>> sh) - sat(P[w] >>> sh), -127, 127);
    xin[4] = clampi(sat(P[so] >>> sh) - sat(P[no] >>> sh), -127, 127);
    xin[5] = clampi(sat(A[e] >>> sh) - sat(A[w] >>> sh), -127, 127);
    xin[6] = clampi(sat(A[so] >>> sh) - sat(A[no] >>> sh), -127, 127);
    xin[7] = sat(E[i] >>> c.energyShift);
    xin[8] = sat(M[i] >>> c.massShift);
    xin[9] = sat(b.crowd[ci] * 16);
    // Down - up, as east - west: +z minus -z, so a positive weight to MZ (which adds to z) steers toward more.
    xin[10] = clampi(sat(P[dn] >>> sh) - sat(P[up] >>> sh), -127, 127);
    xin[11] = clampi(sat(A[dn] >>> sh) - sat(A[up] >>> sh), -127, 127);
    xin[12] = top === 0 ? 0 : divu(b.I[ci] * 127, top);
    controllerForward13(s.genome.subarray(i * NN_BYTES3, (i + 1) * NN_BYTES3), xin, h, o);
    out.set(o, i * NN_O3);
  }
  return out;
}

/** What every live particle's controller would output on the next step (NN_O3 per particle, slot order), without changing the state. */
export function probe(s: Mycelium3dState): Int32Array {
  return senseAndThink(s, binParticles(s));
}

/** Advance one step in place and return what happened in it. */
export function step(s: Mycelium3dState): StepStats {
  const c = s.config;
  const W = c.width, H = c.height, D = c.depth, WH = W * H, N = WH * D;
  const spanX = W << POS_SHIFT, spanY = H << POS_SHIFT, zMax = (D << POS_SHIFT) - 1;
  const n = s.n;
  const { A, C, P, x, y, z, M, E } = s;
  const st: StepStats = { lightIn: 0, heat: 0, births: 0, deaths: 0, refused: 0, contended: 0, mutations: 0 };
  // Refuse before changing anything: the step counter must stay exact, and the event counters rise by at most
  // max(cells, maxParticles) in one step, so a state that close to 2^50 cannot step.
  const room = LEDGER_MAX - Math.max(N, c.maxParticles);
  if (!isCount(s.step, STEP_MAX - 1)) throw new Error(`step ${s.step} cannot advance: the step counter would pass 2^53 - 1`);
  for (const k of COUNTERS.slice(2)) if (!isCount(s.totals[k], room)) throw new Error(`totals.${k} ${s.totals[k]} is too close to 2^50 to step`);

  // 1. Bin: cells, crowding and the light plane from start-of-step state.
  const bins = binParticles(s);
  const { cell, I } = bins;

  // 2-3. Sense and think (shared with probe()).
  const out = senseAndThink(s, bins);

  // Trail use (optional): discount from START-of-step trail in the particle's own cell.
  let disc: Uint32Array | null = null;
  if (c.trailMoveDiscount !== undefined) {
    disc = new Uint32Array(n);
    const toll = c.trailDiscountMode === "toll";
    for (let i = 0; i < n; i++) {
      const req = (c.maxDeposit * relu(out[i * NN_O3 + OUT.DEPOSIT])) >>> 7;
      if (toll && req === 0) continue;
      disc[i] = Math.min(Math.min(P[cell[i]], 256) * c.trailMoveDiscount, 256);
    }
  }

  const ownerMode = c.trailOwner;
  const Z = s.Z, Q = s.Q;
  if (ownerMode !== undefined && (!Z || !Q)) throw new Error("trailOwner requires the Z and Q planes");
  const tagOf = (i: number) => ownerTag(ownerMode === "gid" ? s.gid[i] : s.id[i]);
  const theta = c.ownerDefend;

  // 4. Eat: requests summed per cell; a contended cell shares pro rata, rounding down, the remainder stays.
  const req = new Uint32Array(n);
  const R = new Uint32Array(N);
  for (let i = 0; i < n; i++) {
    const room = c.bodyMax > M[i] ? c.bodyMax - M[i] : 0;
    let r = Math.min((c.maxEat * relu(out[i * NN_O3 + OUT.EAT])) >>> 7, room);
    if (theta !== undefined) {
      const zz = Z![cell[i]];
      if (zz !== 0 && zz !== tagOf(i) && Q![cell[i]] >= theta) r = 0;
    }
    req[i] = r;
    R[cell[i]] += r;
  }
  const taken = new Uint32Array(N);
  const grant = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const ci = cell[i];
    const r = req[i];
    const g = R[ci] <= A[ci] ? r : divu(r * A[ci], R[ci]);
    grant[i] = g;
    taken[ci] += g;
  }
  for (let k = 0; k < N; k++) {
    if (R[k] > A[k]) st.contended++;
    A[k] -= taken[k];
  }

  // 5. Metabolism, trail, turnover, death and movement. Field writes are commutative additions into the start cell.
  // With bonds the move waits for phase 5b, and the cost carries the upkeep of the bonds held at the start of the step.
  const bonded = c.bondBreak !== undefined;
  const B0 = s.bond0, B1 = s.bond1;
  if (bonded && (!B0 || !B1)) throw new Error("bondBreak requires the bond0 and bond1 slots");
  const bondCost = c.bondCost ?? 0;
  const dd = bonded ? new Int32Array(3 * n) : null;
  const alive = new Uint8Array(n);
  const wants = new Uint8Array(n);
  const candCell: number[] = [], candDep: number[] = [], candTag: number[] = [];
  for (let i = 0; i < n; i++) {
    const ci = cell[i];
    const oi = i * NN_O3;
    const g = grant[i];
    let m = M[i] + g;
    let en = E[i] + g * c.eA;
    if (en > c.energyMax) { st.heat += en - c.energyMax; en = c.energyMax; }
    const mx = out[oi + OUT.MX], my = out[oi + OUT.MY], mz = out[oi + OUT.MZ];
    const pb = pbase(c.seed, s.step, s.id[i]);
    const raw = ((mx < 0 ? -mx : mx) + (my < 0 ? -my : my) + (mz < 0 ? -mz : mz)) * c.moveCost;
    const move = disc === null ? raw >>> 7 : (raw * (256 - disc[i])) >>> 15;
    let cost = c.upkeep + move + shrFrac(m, c.massUpkeepShift, draw(pb, RND.UPKEEP));
    if (bonded) cost += bondCost * ((B0![i] !== BOND_NONE ? 1 : 0) + (B1![i] !== BOND_NONE ? 1 : 0));
    if (en < cost) {
      st.heat += en; C[ci] += m; st.deaths++;
      continue;
    }
    en -= cost; st.heat += cost;
    let dep = Math.min((c.maxDeposit * relu(out[oi + OUT.DEPOSIT])) >>> 7, m);
    if (dep * c.depositCost > en) dep = divu(en, c.depositCost);
    en -= dep * c.depositCost; st.heat += dep * c.depositCost;
    m -= dep; P[ci] += dep;
    if (ownerMode !== undefined && dep > 0) {
      const t = tagOf(i);
      const zz = Z![ci];
      if (zz === t) Q![ci] += dep;
      else if (zz === 0) { candCell.push(ci); candDep.push(dep); candTag.push(t); }
    }
    const ex = shrFrac(m, c.excreteShift, draw(pb, RND.EXCRETE));
    m -= ex; C[ci] += ex;
    if (m === 0) {
      st.heat += en; st.deaths++;
      continue;
    }
    M[i] = m; E[i] = en;
    if (dd) {
      dd[3 * i] = divi(mx * c.speed, 128); dd[3 * i + 1] = divi(my * c.speed, 128); dd[3 * i + 2] = divi(mz * c.speed, 128);
    } else {
      x[i] = (x[i] + spanX + divi(mx * c.speed, 128)) % spanX;
      y[i] = (y[i] + spanY + divi(my * c.speed, 128)) % spanY;
      z[i] = clampi(z[i] + divi(mz * c.speed, 128), 0, zMax);
    }
    s.age[i]++;
    alive[i] = 1;
    wants[i] = out[oi + OUT.SPLIT] > 0 && en >= c.splitEnergy && m >= c.splitMatter ? 1 : 0;
  }

  if (ownerMode !== undefined) resolveClaims(Z!, Q!, N, candCell, candDep, candTag);

  // 5b. Bonds: release, propose, accept, move, stretch (RULES.md, "Bonds"). Positions are still the start-of-step ones.
  const bs = bonded ? bondPhase(s, out, cell, alive, dd!) : null;
  if (bs) st.bonds = bs.stats;

  // 6. Compact survivors in slot order.
  let k = 0;
  const newSlot = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    if (k !== i) {
      s.id[k] = s.id[i]; s.parent[k] = s.parent[i]; s.gid[k] = s.gid[i];
      x[k] = x[i]; y[k] = y[i]; z[k] = z[i]; M[k] = M[i]; E[k] = E[i]; s.age[k] = s.age[i];
      s.genome.copyWithin(k * NN_BYTES3, i * NN_BYTES3, (i + 1) * NN_BYTES3);
    }
    // Bond slots come from phase 5b's arrays (indexed by the old slot), so the copy order does not matter.
    if (bs) { B0![k] = bs.b0[i]; B1![k] = bs.b1[i]; }
    newSlot[i] = k++;
  }
  const survivors = k;

  // 7. Births: a prefix sum over slot order gives each accepted split its child's id and slot.
  const free = c.maxParticles - survivors;
  let rank = 0, newGids = 0;
  for (let i = 0; i < n; i++) {
    if (!alive[i] || !wants[i]) continue;
    if (rank >= free || s.nextId + rank > ID_MAX || s.nextGid + newGids > ID_MAX) { st.refused++; continue; }
    const p = newSlot[i];
    const q = survivors + rank;
    const pid = s.id[p];
    const base = pbase(c.seed, s.step, pid);
    const cm = M[p] >>> 1, ce = E[p] >>> 1;
    M[p] -= cm; E[p] -= ce;
    s.id[q] = s.nextId + rank;
    s.parent[q] = pid;
    x[q] = (x[p] + spanX + (draw(base, RND.DX) & 255) - 128) % spanX;
    y[q] = (y[p] + spanY + (draw(base, RND.DY) & 255) - 128) % spanY;
    z[q] = clampi(z[p] + (draw(base, RND.DZ) & 255) - 128, 0, zMax);
    M[q] = cm; E[q] = ce; s.age[q] = 0;
    if (bonded) {
      B0![q] = BOND_NONE; B1![q] = BOND_NONE;
      // bondChild: a parent with a free slot takes the child (the largest id alive, so it goes last in the parent's slots).
      if (c.bondChild && B1![p] === BOND_NONE) {
        if (B0![p] === BOND_NONE) B0![p] = s.id[q]; else B1![p] = s.id[q];
        B0![q] = pid;
        st.bonds!.childBonds++;
      }
    }
    let novel = false;
    if (c.heredity === "blocked") {
      randomWeights(s.genome, q * NN_BYTES3, base, c.weightSpan);
      novel = true;
    } else {
      s.genome.copyWithin(q * NN_BYTES3, p * NN_BYTES3, (p + 1) * NN_BYTES3);
      if (c.heredity === "inherit" && (draw(base, RND.MUT) & 0xffff) < c.mutRate) {
        for (let j = 0; j < c.mutCount; j++) {
          const slot = draw(base, RND.MUT_SLOT + j) % NN_WEIGHTS3;
          let delta = (draw(base, RND.MUT_DELTA + j) % (2 * c.mutStep + 1)) - c.mutStep;
          if (delta === 0) delta = 1;
          const at = q * NN_BYTES3 + slot;
          s.genome[at] = clampi(s.genome[at] + delta, -127, 127);
        }
        for (let b = 0; b < NN_WEIGHTS3; b++) {
          if (s.genome[q * NN_BYTES3 + b] !== s.genome[p * NN_BYTES3 + b]) { novel = true; break; }
        }
        if (novel) st.mutations++;
      }
    }
    s.gid[q] = novel ? s.nextGid + newGids++ : s.gid[p];
    rank++;
    st.births++;
  }
  s.nextGid += newGids;
  s.n = survivors + rank;
  s.nextId += rank;

  // 8.1 Light (from the start-of-step plane) turns waste into nutrient; trail decays to waste.
  const fseed = c.seed;
  for (let ci = 0; ci < N; ci++) {
    const fb = cellBase(fseed, s.step, ci);
    const Ii = I[ci];
    const L = (Ii >>> 8) + ((draw(fb, FIELD.LIGHT) & 255) < (Ii & 255) ? 1 : 0);
    const conv = Math.min(C[ci], L);
    C[ci] -= conv; A[ci] += conv;
    st.lightIn += conv * c.eA;
    if (P[ci] > 0 && c.pDecay > 0) {
      const dec = Math.min(P[ci], mulFrac(P[ci], c.pDecay, 16, draw(fb, FIELD.DECAY)));
      P[ci] -= dec; C[ci] += dec;
      if (Q !== undefined && Q[ci] > 0) {
        Q[ci] -= Math.min(Q[ci], mulFrac(Q[ci], c.pDecay, 16, draw(fb, FIELD.DECAY)));
        if (Q[ci] === 0) Z![ci] = 0;
      }
    }
  }

  // 8.2 Sinking (optional): every send from the post-decay snapshot, then applied, so matter falls at most one layer.
  if (c.sinkShift !== undefined && D > 1) {
    const k2 = c.sinkShift;
    const top = (D - 1) * WH;
    const sC = new Uint32Array(top), sP = new Uint32Array(top);
    for (let ci = 0; ci < top; ci++) {
      const fb = cellBase(fseed, s.step, ci);
      sC[ci] = shrFrac(C[ci], k2, draw(fb, FIELD.SINK_C));
      const rp = draw(fb, FIELD.SINK_P);
      sP[ci] = shrFrac(P[ci], k2, rp);
      // What sinks loses its owner: owned trail falls with the same draw and arrivals are unowned, so Q <= P holds.
      if (Q !== undefined && Q[ci] > 0) {
        Q[ci] -= Math.min(Q[ci], shrFrac(Q[ci], k2, rp));
        if (Q[ci] === 0) Z![ci] = 0;
      }
    }
    for (let ci = 0; ci < top; ci++) { C[ci] -= sC[ci]; P[ci] -= sP[ci]; }
    for (let ci = 0; ci < top; ci++) { C[ci + WH] += sC[ci]; P[ci + WH] += sP[ci]; }
  }

  // 8.3 Diffusion over six faces: A (with the conduit rules), then C.
  const dseed = (fseed ^ DIFF_SALT) >>> 0;
  diffuse(A, W, H, D, c.diffA, dseed, s.step, 0,
    c.trailConduit === undefined ? undefined : { P, g: c.trailConduit, q: c.trailConduitCap ?? CONDUIT_MAX, shift: c.trailConduitGhost },
    c.ownerConduit === undefined ? undefined : { Z: Z!, Q: Q!, g: c.ownerConduit, q: c.ownerConduitCap ?? CONDUIT_MAX, shift: c.ownerGhost });
  diffuse(C, W, H, D, c.diffC, dseed, s.step, 1);

  s.step++;
  const t = s.totals;
  if (t.lightIn + st.lightIn > LEDGER_MAX || t.heat + st.heat > LEDGER_MAX) throw new Error(`ledger counters passed 2^50 at step ${s.step}; the run is over`);
  t.lightIn += st.lightIn; t.heat += st.heat; t.births += st.births; t.deaths += st.deaths;
  t.refused += st.refused; t.contended += st.contended; t.mutations += st.mutations;
  return st;
}

/** |a - b| on a ring of `span` positions (the minimum image). */
const ringDist = (a: number, b: number, span: number) => { const d = a > b ? a - b : b - a; return d > span - d ? span - d : d; };

/**
 * Phase 5b (RULES.md, "Bonds"), on the start-of-step slots: release, propose, accept, move, stretch. Moves every survivor (the
 * move phase 5 left out) and returns each slot's bonds after the step, in canonical order, for the compaction to carry.
 */
function bondPhase(s: Mycelium3dState, out: Int32Array, cell: Uint32Array, alive: Uint8Array, dd: Int32Array) {
  const c = s.config;
  const W = c.width, H = c.height, D = c.depth, n = s.n;
  const spanX = W << POS_SHIFT, spanY = H << POS_SHIFT, zMax = (D << POS_SHIFT) - 1;
  const { x, y, z, id } = s;
  const B0 = s.bond0!, B1 = s.bond1!;
  const R = c.bondBreak!;
  const stats: BondStats = { proposals: 0, formed: 0, partnerDied: 0, letGo: 0, stretched: 0, childBonds: 0 };
  const want = (i: number) => out[i * NN_O3 + OUT.BOND];
  // Working bonds (ids, canonical) and the partners' slots, per start-of-step slot.
  const b0 = new Uint32Array(n).fill(BOND_NONE), b1 = new Uint32Array(n).fill(BOND_NONE);
  const s0 = new Int32Array(n).fill(-1), s1 = new Int32Array(n).fill(-1);
  const keep = (i: number, pid: number, j: number) => {
    if (b0[i] === BOND_NONE) { b0[i] = pid; s0[i] = j; } else { b1[i] = pid; s1[i] = j; }
  };
  // 1. Release: a partner that died, or either end letting go (BOND < 0). Kept bonds keep their order.
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    for (const pid of [B0[i], B1[i]]) {
      if (pid === BOND_NONE) continue;
      const j = slotOfId(id, n, pid);
      if (alive[j] && want(i) >= 0 && want(j) >= 0) keep(i, pid, j);
      else if (!alive[j]) stats.partnerDied++;
      else if (i < j) stats.letGo++; // once per bond, at the smaller slot
    }
  }
  // 2. Propose: per-cell lists in any order; the choice is the minimum (d^2, id), so the order does not matter.
  const N = W * H * D;
  const head = new Int32Array(N).fill(-1), next = new Int32Array(n);
  for (let i = 0; i < n; i++) { next[i] = head[cell[i]]; head[cell[i]] = i; }
  const free = (i: number) => b1[i] === BOND_NONE;
  const prop = new Int32Array(n).fill(-1);
  const nb = new Int32Array(6);
  for (let i = 0; i < n; i++) {
    if (!alive[i] || want(i) <= 0 || !free(i)) continue;
    neighbours6(cell[i], W, H, D, nb);
    let best = -1, bd = 0;
    for (let q = 0; q < 7; q++) {
      const cc = q === 0 ? cell[i] : nb[q - 1];
      if (cc < 0) continue;
      for (let j = head[cc]; j >= 0; j = next[j]) {
        if (j === i || !alive[j] || want(j) <= 0 || !free(j) || b0[i] === id[j]) continue;
        const dx = ringDist(x[i], x[j], spanX), dy = ringDist(y[i], y[j], spanY), dz = z[i] > z[j] ? z[i] - z[j] : z[j] - z[i];
        const d2 = dx * dx + dy * dy + dz * dz;
        // Slot order is id order, so the smaller slot is the smaller id.
        if (best < 0 || d2 < bd || (d2 === bd && j < best)) { best = j; bd = d2; }
      }
    }
    prop[i] = best;
    if (best >= 0) stats.proposals++;
  }
  // 3. Accept: mutual proposals only, a matching, so each particle gains at most one bond.
  for (let i = 0; i < n; i++) {
    const j = prop[i];
    if (j < 0 || prop[j] !== i) continue;
    const pid = id[j];
    if (b0[i] === BOND_NONE) { b0[i] = pid; s0[i] = j; }
    else if (pid > b0[i]) { b1[i] = pid; s1[i] = j; }
    else { b1[i] = b0[i]; s1[i] = s0[i]; b0[i] = pid; s0[i] = j; }
    if (i < j) stats.formed++;
  }
  // 4. Move: the displacement is the truncated mean of the intended ones over the particle and its partners.
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    let sx = dd[3 * i], sy = dd[3 * i + 1], sz = dd[3 * i + 2], k = 1;
    for (const j of [s0[i], s1[i]]) {
      if (j < 0) continue;
      sx += dd[3 * j]; sy += dd[3 * j + 1]; sz += dd[3 * j + 2]; k++;
    }
    x[i] = (x[i] + spanX + divi(sx, k)) % spanX;
    y[i] = (y[i] + spanY + divi(sy, k)) % spanY;
    z[i] = clampi(z[i] + divi(sz, k), 0, zMax);
  }
  // 5. Stretch: per axis first, so the squares stay below 2^22.
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const pa = b0[i], pb = b1[i], ja = s0[i], jb = s1[i];
    b0[i] = BOND_NONE; b1[i] = BOND_NONE;
    for (const [pid, j] of [[pa, ja], [pb, jb]]) {
      if (pid === BOND_NONE) continue;
      const dx = ringDist(x[i], x[j], spanX), dy = ringDist(y[i], y[j], spanY), dz = z[i] > z[j] ? z[i] - z[j] : z[j] - z[i];
      if (dx > R || dy > R || dz > R || dx * dx + dy * dy + dz * dz > R * R) { if (i < j) stats.stretched++; continue; }
      if (b0[i] === BOND_NONE) b0[i] = pid; else b1[i] = pid;
    }
  }
  return { b0, b1, stats };
}

/** The six face neighbours of cell k (0 +x, 1 -x, 2 +y, 3 -y, 4 +z down, 5 -z up), -1 outside the volume in z. */
function neighbours6(k: number, W: number, H: number, D: number, out: Int32Array): void {
  const WH = W * H;
  const cx = k % W, cy = ((k / W) | 0) % H, cz = (k / WH) | 0;
  const layer = cz * WH;
  out[0] = layer + cy * W + ((cx + 1) % W);
  out[1] = layer + cy * W + ((cx + W - 1) % W);
  out[2] = layer + ((cy + 1) % H) * W + cx;
  out[3] = layer + ((cy + H - 1) % H) * W + cx;
  out[4] = cz < D - 1 ? k + WH : -1;
  out[5] = cz > 0 ? k - WH : -1;
}

/**
 * Conservative six-face diffusion with the slab's diffOut6: sixth-portions that sum to the amount, each sent at
 * 4 * Dd / 1024, stochastically rounded. A portion aimed outside the volume in z is not sent and stays.
 * Sends go to a scratch plane and are gathered, so nothing depends on order. `sp` keeps the A and C draws apart.
 */
function diffuse(
  f: Uint32Array, W: number, H: number, D: number, De: number, dseed: number, step: number, sp: number,
  conduit?: { P: Uint32Array; g: number; q: number; shift?: number },
  owner?: { Z: Uint32Array; Q: Uint32Array; g: number; q: number; shift?: number },
): void {
  if (De === 0 && !conduit && !owner) return;
  const N = W * H * D;
  const sent = new Uint32Array(6 * N);
  const nb = new Int32Array(6);
  for (let k = 0; k < N; k++) {
    if (f[k] === 0) continue;
    const base = cellBase(dseed, step, k);
    neighbours6(k, W, H, D, nb);
    for (let d = 0; d < 6; d++) {
      const j = nb[d];
      if (j < 0) continue;
      let Dd = De;
      if (conduit) {
        const gs = conduit.shift;
        const pk = gs === undefined ? conduit.P[k] : conduit.P[shiftCell(k, gs, W, H)];
        const pn = gs === undefined ? conduit.P[j] : conduit.P[shiftCell(j, gs, W, H)];
        Dd = conduitRate(De, conduit.g, conduit.q, pk, pn);
      } else if (owner) {
        const gs = owner.shift;
        const a = gs === undefined ? k : shiftCell(k, gs, W, H);
        const b = gs === undefined ? j : shiftCell(j, gs, W, H);
        Dd = ownerRate(De, owner.g, owner.q, owner.Z[a], owner.Z[b], owner.Q[a], owner.Q[b]);
      }
      sent[6 * k + d] = diffOut6(f[k], d, Dd, base, sp);
    }
  }
  for (let k = 0; k < N; k++) {
    neighbours6(k, W, H, D, nb);
    let o = 0, inflow = 0;
    for (let d = 0; d < 6; d++) {
      o += sent[6 * k + d];
      // The neighbour in direction d sends toward this cell in the opposite direction d ^ 1.
      if (nb[d] >= 0) inflow += sent[6 * nb[d] + (d ^ 1)];
    }
    f[k] = f[k] - o + inflow;
  }
}

// ---- checkpoint encoding and digest ----------------------------------------------------------------

const MAGIC = 0x334d4c42; // "BLM3"
const FORMAT = 1;
const PLANES = ["id", "parent", "gid", "x", "y", "z", "M", "E", "age"] as const;

/** Every persistent field, in a fixed byte layout: a JSON header, then the field, the live particles and (with trailOwner) Z and Q. */
export function encode(s: Mycelium3dState): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify({
    format: FORMAT, config: s.config, step: s.step, n: s.n, nextId: s.nextId, nextGid: s.nextGid,
    matter0: s.matter0, energy0: s.energy0, totals: s.totals,
  }));
  const pad = (4 - (header.length % 4)) % 4;
  const N = s.A.length, n = s.n;
  const owner = s.config.trailOwner !== undefined;
  const bonds = s.config.bondBreak !== undefined;
  const words = 2 + 3 * N + PLANES.length * n + (owner ? 2 * N : 0) + (bonds ? 2 * n : 0);
  const bytes = new Uint8Array(4 * words + header.length + pad + n * NN_BYTES3);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, header.length, true);
  bytes.set(header, 8);
  let off = 8 + header.length + pad;
  const put = (a: Uint32Array, len: number) => { for (let i = 0; i < len; i++, off += 4) dv.setUint32(off, a[i], true); };
  put(s.A, N); put(s.C, N); put(s.P, N);
  for (const p of PLANES) put(s[p], n);
  bytes.set(new Uint8Array(s.genome.buffer, s.genome.byteOffset, n * NN_BYTES3), off);
  off += n * NN_BYTES3;
  if (owner) { put(s.Z!, N); put(s.Q!, N); }
  if (bonds) { put(s.bond0!, n); put(s.bond1!, n); }
  return bytes;
}

export function decode(bytes: Uint8Array): Mycelium3dState {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error("not a mycelium3d checkpoint");
  const hl = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl)));
  if (head.format !== FORMAT) throw new Error(`unsupported mycelium3d checkpoint format ${head.format}`);
  const c = head.config as Mycelium3dConfig;
  const cbad = validateConfig(c);
  if (cbad.length) throw new Error(`invalid mycelium3d checkpoint: ${cbad.slice(0, 3).join("; ")}`);
  const s = createEmpty(c);
  Object.assign(s, { step: head.step, n: head.n, nextId: head.nextId, nextGid: head.nextGid, matter0: head.matter0, energy0: head.energy0, totals: { ...head.totals } });
  if (!(Number.isInteger(s.n) && s.n >= 0 && s.n <= c.maxParticles)) throw new Error("invalid mycelium3d checkpoint: particle count out of range");
  let off = 8 + hl + ((4 - (hl % 4)) % 4);
  const N = c.width * c.height * c.depth;
  const need = off + 4 * (3 * N + PLANES.length * s.n + (c.trailOwner !== undefined ? 2 * N : 0) + (c.bondBreak !== undefined ? 2 * s.n : 0)) + s.n * NN_BYTES3;
  if (bytes.byteLength !== need) throw new Error(`invalid mycelium3d checkpoint: ${bytes.byteLength} bytes; expected ${need}`);
  const get = (a: Uint32Array, len: number) => { for (let i = 0; i < len; i++, off += 4) a[i] = dv.getUint32(off, true); };
  get(s.A, N); get(s.C, N); get(s.P, N);
  for (const p of PLANES) get(s[p], s.n);
  s.genome.set(new Int8Array(bytes.buffer, bytes.byteOffset + off, s.n * NN_BYTES3));
  off += s.n * NN_BYTES3;
  if (c.trailOwner !== undefined) { get(s.Z!, N); get(s.Q!, N); }
  if (c.bondBreak !== undefined) { get(s.bond0!, s.n); get(s.bond1!, s.n); }
  const bad = validateState(s);
  if (bad.length) throw new Error(`invalid mycelium3d checkpoint: ${bad.slice(0, 3).join("; ")}`);
  return s;
}

/** 64-bit digest (two FNV-1a lanes) of the encoded state. */
export function stateDigest(s: Mycelium3dState): string {
  const b = encode(s);
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ b[i], 0x01000193) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  return lowbias32(h1).toString(16).padStart(8, "0") + lowbias32(h2).toString(16).padStart(8, "0");
}

/** Distinct genotype ids among live particles. */
export function liveGenotypes(s: Mycelium3dState): number {
  const seen = new Set<number>();
  for (let i = 0; i < s.n; i++) seen.add(s.gid[i]);
  return seen.size;
}

/** One layer of the census by depth. Light is the plane the next step uses, as a mean in 1/256 units per cell. */
export interface LayerCensus {
  z: number;
  particles: number;
  M: number;
  A: number;
  C: number;
  P: number;
  light: number;
}

/** Particles, matter (A, C, P, M) and mean light per layer, surface first. Reads state, changes nothing. */
export function censusByDepth(s: Mycelium3dState): LayerCensus[] {
  const c = s.config;
  const WH = c.width * c.height;
  const I = lightPlane(s);
  const rows: LayerCensus[] = [];
  for (let zz = 0; zz < c.depth; zz++) {
    let a = 0, cc = 0, p = 0, l = 0;
    for (let k = zz * WH; k < (zz + 1) * WH; k++) { a += s.A[k]; cc += s.C[k]; p += s.P[k]; l += I[k]; }
    rows.push({ z: zz, particles: 0, M: 0, A: a, C: cc, P: p, light: Math.round(l / WH) });
  }
  for (let i = 0; i < s.n; i++) { const r = rows[s.z[i] >>> POS_SHIFT]; r.particles++; r.M += s.M[i]; }
  return rows;
}
