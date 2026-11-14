// Mycelium world, rung R0: the CPU reference for neural particles over a conserved field.
//
// The rules in prose, with every arithmetic bound, are in tools/mycelium/RULES.md; this file is
// their executable form and a later WGSL port (R1) must match it bit for bit. It is a separate rule
// set (RULE_ID below), not a mode of the research kernel: it reuses the kernel's integer helpers,
// its counter-based PRNG and its controller arithmetic (controllerForward), and nothing else.
//
// Every step is order-free apart from births, whose ids and slots come from a prefix sum over slot
// order: sensing reads start-of-step state, contended eating is shared from cell totals, and
// deposits, excretion and deaths are commutative additions into the field.
import { B1_OFF, B2_OFF, cellBase, clampi, divi, divu, draw, lowbias32, mulFrac, NN_BYTES, NN_H, NN_I, NN_O, W1_OFF, W2_OFF } from "@bl/schema";
import { controllerForward, diffOut } from "@bl/sim-ref";

export const RULE_ID = "mycelium-r0";
/** Fixed-point positions: one field cell is 256 position units. */
export const POS_SHIFT = 8;
/** Controller outputs this rule reads. 5..7 are reserved and ignored in R0. */
export const OUT = { MX: 0, MY: 1, EAT: 2, DEPOSIT: 3, SPLIT: 4 } as const;
/** Controller inputs, in order. */
export const SENSORS = ["nutrient", "waste", "trail", "trail east-west", "trail south-north", "nutrient east-west", "nutrient south-north", "energy", "body", "crowding"] as const;

/** How a child's controller relates to its parent's: the experimental arm. */
export type Heredity = "inherit" | "frozen" | "blocked";
export type LightPattern = "uniform" | "gradient";
/** Largest physarumDeposit (1/256 matter per particle-step): 3 units a step, so DEPOSIT = 96 stays below the 127 output ceiling. */
export const PHYSARUM_DEPOSIT_MAX = 768;
/** What phase 3 (Think) runs. Absent from a config means "neural"; "physarum" is the R2 null (RULES.md). */
export type ControllerKind = "neural" | "physarum";
/** Who may take the trail movement discount: every particle ("public") or only a particle that requests a deposit this step ("toll"). */
export type TrailDiscountMode = "public" | "toll";
/** Largest trailMoveDiscount; 256 means one unit of trail under a particle makes its movement free. */
export const TRAIL_DISCOUNT_MAX = 256;

export interface MyceliumConfig {
  rule: typeof RULE_ID;
  width: number;
  height: number;
  seed: number;
  /** Hard cap on live particles; births beyond it are refused and counted. */
  maxParticles: number;
  founders: number;
  founderMatter: number;
  founderEnergy: number;
  /** Founder (and blocked-child) weights are uniform in [-span, span]. */
  weightSpan: number;
  /** Initial dissolved nutrient A per cell. */
  nutrient0: number;
  /** Chemical energy per unit of nutrient: eating q units gives q matter and q * eA energy. */
  eA: number;
  /** Nutrient a particle asks for per step at full EAT output (127). */
  maxEat: number;
  /** A particle's matter never exceeds this through eating. */
  bodyMax: number;
  /** Position units moved per step at full MX or MY output (256 = one cell). */
  speed: number;
  /** Energy paid every step, plus moveCost per 127 units of |MX| + |MY|, plus M >> massUpkeepShift. */
  upkeep: number;
  moveCost: number;
  massUpkeepShift: number;
  /** Matter a particle lays as trail per step at full DEPOSIT output, and the energy per unit it costs. */
  maxDeposit: number;
  depositCost: number;
  /** Body turnover: M / 2^excreteShift (stochastically rounded) becomes waste C every step. */
  excreteShift: number;
  /** A particle may split only with at least this much energy and matter. */
  splitEnergy: number;
  splitMatter: number;
  /** Energy above this is lost as heat. */
  energyMax: number;
  /** Waste turned back into nutrient per cell per step by light (the only energy input). */
  light: number;
  lightPattern: LightPattern;
  /** Trail decay to waste per step, in 1/65536. */
  pDecay: number;
  /** Diffusion of A and C to each of the four neighbours per step, in 1/1024 (the kernel's diffOut, at most 256). */
  diffA: number;
  diffC: number;
  heredity: Heredity;
  /**
   * Optional (R2). Absent means "neural". "physarum" replaces the network by a fixed trail-following rule
   * and requires heredity "frozen". defaultConfig() never sets it, so every existing config encodes the same.
   */
  controller?: ControllerKind;
  /**
   * Optional (R2b). Only with controller "physarum": the null's deposit, in 1/256 matter per particle-step (0..768).
   * Each step a particle deposits u = (v >> 8) + [draw(pb, 64) % 256 < (v & 255)] units (DEPOSIT = 32 * u). Absent means
   * DEPOSIT = 32 (the R2 null, one unit per step) and no slot-64 draw. defaultConfig() never sets it.
   */
  physarumDeposit?: number;
  /**
   * Optional (R2b positive control). true forces the two trail-gradient inputs (3 and 4) to 0 in the sense phase for every
   * particle; the controller still runs on the other eight inputs. Absent means false. defaultConfig() never sets it.
   */
  blindTrailGradient?: boolean;
  /**
   * Optional (trail use, exploratory). Integer 0..256. The movement term of the cost shrinks with the start-of-step trail in the
   * particle's own cell: f = min(min(P, 256) * trailMoveDiscount, 256), term = ((|MX|+|MY|) * moveCost * (256 - f)) >> 15
   * (f = 0 is today's `>> 7`). Absent means no discount. defaultConfig() never sets it.
   */
  trailMoveDiscount?: number;
  /** Optional, only with trailMoveDiscount. "toll": f = 0 unless the particle's deposit request is positive. Absent means "public". */
  trailDiscountMode?: TrailDiscountMode;
  /** Chance a birth mutates (inherit arm), in 1/65536; a mutation changes mutCount weights by up to ±mutStep. */
  mutRate: number;
  mutCount: number;
  mutStep: number;
  /** Sensor scaling: A, C, P >> sensorShift; E >> energyShift; M >> massShift. */
  sensorShift: number;
  energyShift: number;
  massShift: number;
}

/** Engineered defaults, tuned by hand so a 128 x 128 world keeps a population; they are choices, not findings. */
export function defaultConfig(over: Partial<MyceliumConfig> = {}): MyceliumConfig {
  return {
    rule: RULE_ID,
    width: 128,
    height: 128,
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

export interface MyceliumState {
  config: MyceliumConfig;
  step: number;
  /** Field: dissolved nutrient, dissolved waste, trail polymer (row-major, width * height). */
  A: Uint32Array;
  C: Uint32Array;
  P: Uint32Array;
  /** Live particle count; particle arrays have capacity maxParticles and slot order is id order. */
  n: number;
  id: Uint32Array;
  parent: Uint32Array;
  gid: Uint32Array;
  x: Uint32Array;
  y: Uint32Array;
  M: Uint32Array;
  E: Uint32Array;
  age: Uint32Array;
  /** NN_BYTES int8 weights per particle, in slot order. */
  genome: Int8Array;
  nextId: number;
  nextGid: number;
  /** Total matter fixed at creation, and energy at creation; the ledger checks against them. */
  matter0: number;
  energy0: number;
  totals: Totals;
}

const INT_KEYS: (keyof MyceliumConfig)[] = [
  "width", "height", "seed", "maxParticles", "founders", "founderMatter", "founderEnergy", "weightSpan", "nutrient0", "eA", "maxEat",
  "bodyMax", "speed", "upkeep", "moveCost", "massUpkeepShift", "maxDeposit", "depositCost", "excreteShift", "splitEnergy",
  "splitMatter", "energyMax", "light", "pDecay", "diffA", "diffC", "mutRate", "mutCount", "mutStep", "sensorShift", "energyShift", "massShift",
];

/** Ranges that keep every product in step() below 2^32; RULES.md derives each one. Returns problems, empty when valid. */
export function validateConfig(c: MyceliumConfig): string[] {
  const bad: string[] = [];
  if (c.rule !== RULE_ID) bad.push(`rule must be ${RULE_ID}`);
  for (const k of INT_KEYS) {
    const v = c[k] as number;
    if (!Number.isInteger(v) || v < 0) bad.push(`${k} must be a non-negative integer`);
  }
  const range = (k: keyof MyceliumConfig, lo: number, hi: number) => {
    const v = c[k] as number;
    if (v < lo || v > hi) bad.push(`${k} must be in [${lo}, ${hi}]`);
  };
  range("width", 8, 512); range("height", 8, 512); range("seed", 0, 0xffffffff);
  range("maxParticles", 1, 1 << 16); range("founders", 0, c.maxParticles);
  range("weightSpan", 0, 127); range("eA", 1, 255); range("maxEat", 0, 255); range("bodyMax", 1, 1 << 16);
  range("speed", 0, 256); range("upkeep", 0, 1 << 12); range("moveCost", 0, 1 << 12); range("massUpkeepShift", 1, 16);
  range("maxDeposit", 0, 255); range("depositCost", 1, 1 << 12); range("excreteShift", 1, 16);
  range("splitEnergy", 0, 1 << 24); range("splitMatter", 2, 1 << 16); range("energyMax", 1, 1 << 24);
  range("founderMatter", 1, c.bodyMax); range("founderEnergy", 0, c.energyMax);
  range("light", 0, 1 << 12); range("pDecay", 0, 65535); range("diffA", 0, 256); range("diffC", 0, 256);
  range("mutRate", 0, 65536); range("mutCount", 0, 16); range("mutStep", 1, 127);
  range("sensorShift", 0, 24); range("energyShift", 0, 24); range("massShift", 0, 16);
  if (c.heredity !== "inherit" && c.heredity !== "frozen" && c.heredity !== "blocked") bad.push("heredity must be inherit, frozen or blocked");
  if (c.lightPattern !== "uniform" && c.lightPattern !== "gradient") bad.push("lightPattern must be uniform or gradient");
  if (c.controller !== undefined) {
    if (c.controller !== "neural" && c.controller !== "physarum") bad.push("controller must be neural or physarum");
    else if (c.controller === "physarum" && c.heredity !== "frozen") bad.push("controller physarum requires heredity frozen");
  }
  if (c.physarumDeposit !== undefined) {
    if (!Number.isInteger(c.physarumDeposit) || c.physarumDeposit < 0 || c.physarumDeposit > PHYSARUM_DEPOSIT_MAX) bad.push(`physarumDeposit must be an integer in [0, ${PHYSARUM_DEPOSIT_MAX}]`);
    if (c.controller !== "physarum") bad.push("physarumDeposit requires controller physarum");
  }
  if (c.blindTrailGradient !== undefined && typeof c.blindTrailGradient !== "boolean") bad.push("blindTrailGradient must be a boolean");
  if (c.trailMoveDiscount !== undefined && (!Number.isInteger(c.trailMoveDiscount) || c.trailMoveDiscount < 0 || c.trailMoveDiscount > TRAIL_DISCOUNT_MAX)) {
    bad.push(`trailMoveDiscount must be an integer in [0, ${TRAIL_DISCOUNT_MAX}]`);
  }
  if (c.trailDiscountMode !== undefined) {
    if (c.trailDiscountMode !== "public" && c.trailDiscountMode !== "toll") bad.push("trailDiscountMode must be public or toll");
    if (c.trailMoveDiscount === undefined) bad.push("trailDiscountMode requires trailMoveDiscount");
  }
  // Total matter bounds every field cell and every sum of them (RULES.md, "Bounds").
  const total = c.width * c.height * c.nutrient0 + c.founders * c.founderMatter;
  if (total > 2 ** 31) bad.push("initial matter must not exceed 2^31");
  return bad;
}

/** State-level checks: counts, ranges and the two ledger identities. Returns problems, empty when valid. */
export function validateState(s: MyceliumState): string[] {
  const c = s.config;
  const bad = validateConfig(c);
  if (s.n < 0 || s.n > c.maxParticles) bad.push("particle count out of range");
  const span = (c.width << POS_SHIFT) >>> 0;
  const spanY = (c.height << POS_SHIFT) >>> 0;
  for (let i = 0; i < s.n; i++) {
    if (s.x[i] >= span || s.y[i] >= spanY) bad.push(`particle ${s.id[i]} outside the world`);
    if (s.M[i] === 0 || s.E[i] > c.energyMax) bad.push(`particle ${s.id[i]} has no body or too much energy`);
    if (i > 0 && s.id[i] <= s.id[i - 1]) bad.push("slot order is not id order");
  }
  for (const [k, v] of [["energy0", s.energy0], ["lightIn", s.totals.lightIn], ["heat", s.totals.heat]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > LEDGER_MAX) bad.push(`${k} must be an integer in [0, 2^50]`);
  }
  if (!Number.isInteger(s.nextId) || s.nextId < 0 || s.nextId > ID_MAX + 1) bad.push("nextId out of range");
  if (!Number.isInteger(s.nextGid) || s.nextGid < 0 || s.nextGid > ID_MAX + 1) bad.push("nextGid out of range");
  for (let i = 0; i < s.n; i++) {
    if (s.id[i] >= s.nextId) bad.push(`particle id ${s.id[i]} not below nextId`);
    if (s.gid[i] >= s.nextGid) bad.push(`genotype id ${s.gid[i]} not below nextGid`);
  }
  const m = matterTotal(s);
  if (m !== s.matter0) bad.push(`matter residual ${m - s.matter0}`);
  const e = energyTotal(s);
  const book = s.energy0 + s.totals.lightIn - s.totals.heat;
  if (e !== book) bad.push(`energy residual ${e - book}`);
  return bad;
}

/**
 * Lifetime bound on the energy anchors and cumulative counters: every ledger sum stays an exact double
 * (below 2^53) when each of them is at most 2^50. A run that would cross it stops with an error.
 */
export const LEDGER_MAX = 2 ** 50;
/** Largest particle or genotype id; 0xffffffff is the founders' "no parent" sentinel. */
export const ID_MAX = 0xfffffffe;

/** Particles draw from a stream keyed on their id, apart from the field's stream keyed on cell. */
const PARTICLE_SALT = 0x6d796331;
const FOUNDER_STEP = 0xffffffff;
const pbase = (seed: number, step: number, id: number) => cellBase((seed ^ PARTICLE_SALT) >>> 0, step, id);
const RND = { DX: 0, DY: 1, MUT: 2, MUT_SLOT: 3, MUT_DELTA: 40, TURN_X: 60, TURN_Y: 61, WANDER_X: 62, WANDER_Y: 63, PHYS_DEPOSIT: 64, UPKEEP: 90, EXCRETE: 91, WEIGHT: 100 } as const;
/** Field streams: decay and light keyed on (seed, step, cell); diffusion on its own salted stream. */
const FIELD = { DECAY: 0, LIGHT: 1 } as const;
const DIFF_SALT = 0x64696666;
/** Stochastically rounded q / 2^shift, for 1 <= shift <= 16 and q < 2^16. */
const shrFrac = (q: number, shift: number, rnd: number) => mulFrac(q, 1 << (16 - shift), 16, rnd);

function randomWeights(out: Int8Array, off: number, base: number, span: number): void {
  for (let b = 0; b < NN_BYTES; b++) out[off + b] = (draw(base, RND.WEIGHT + b) % (2 * span + 1)) - span;
}

export function createWorld(config: MyceliumConfig): MyceliumState {
  const bad = validateConfig(config);
  if (bad.length) throw new Error(`invalid mycelium config: ${bad.join("; ")}`);
  const c = { ...config };
  const N = c.width * c.height;
  const cap = c.maxParticles;
  const s: MyceliumState = {
    config: c,
    step: 0,
    A: new Uint32Array(N).fill(c.nutrient0),
    C: new Uint32Array(N),
    P: new Uint32Array(N),
    n: 0,
    id: new Uint32Array(cap), parent: new Uint32Array(cap), gid: new Uint32Array(cap),
    x: new Uint32Array(cap), y: new Uint32Array(cap), M: new Uint32Array(cap), E: new Uint32Array(cap), age: new Uint32Array(cap),
    genome: new Int8Array(cap * NN_BYTES),
    nextId: 0, nextGid: 0, matter0: 0, energy0: 0,
    totals: { lightIn: 0, heat: 0, births: 0, deaths: 0, refused: 0, contended: 0, mutations: 0 },
  };
  for (let i = 0; i < c.founders; i++) {
    const base = pbase(c.seed, FOUNDER_STEP, i);
    s.id[i] = i; s.parent[i] = 0xffffffff; s.gid[i] = i;
    s.x[i] = draw(base, RND.DX) % (c.width << POS_SHIFT);
    s.y[i] = draw(base, RND.DY) % (c.height << POS_SHIFT);
    s.M[i] = c.founderMatter; s.E[i] = c.founderEnergy;
    randomWeights(s.genome, i * NN_BYTES, base, c.weightSpan);
  }
  s.n = c.founders; s.nextId = c.founders; s.nextGid = c.founders;
  s.matter0 = matterTotal(s);
  s.energy0 = energyTotal(s);
  return s;
}

export function matterTotal(s: MyceliumState): number {
  let t = 0;
  for (let k = 0; k < s.A.length; k++) t += s.A[k] + s.C[k] + s.P[k];
  for (let i = 0; i < s.n; i++) t += s.M[i];
  return t;
}

/** Particle energy plus the chemical energy stored in nutrient (eA per unit). */
export function energyTotal(s: MyceliumState): number {
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
}

const sat = (v: number) => (v > 127 ? 127 : v);
const relu = (v: number) => (v > 0 ? v : 0);

/** Phase 1: each live particle's cell index and the per-cell particle counts. Reads state, changes nothing. */
function binParticles(s: MyceliumState): { cell: Uint32Array; D: Uint32Array } {
  const W = s.config.width;
  const cell = new Uint32Array(s.n);
  const D = new Uint32Array(W * s.config.height);
  for (let i = 0; i < s.n; i++) {
    const ci = (s.y[i] >>> POS_SHIFT) * W + (s.x[i] >>> POS_SHIFT);
    cell[i] = ci;
    D[ci]++;
  }
  return { cell, D };
}

/**
 * Phases 2-3: sense the start-of-step field and run the controller, for every live particle. Returns the
 * NN_O outputs of each particle in slot order. step() and probe() both call this, so a probe sees exactly
 * what the next step would act on. It reads s.step (the physarum draws are keyed on it) and changes nothing.
 */
function senseAndThink(s: MyceliumState, cell: Uint32Array, D: Uint32Array): Int32Array {
  const c = s.config;
  const W = c.width, H = c.height;
  const n = s.n;
  const { A, C, P, E, M } = s;
  const out = new Int32Array(n * NN_O);
  const xin = new Int32Array(NN_I), h = new Int32Array(NN_H), o = new Int32Array(NN_O);
  const sh = c.sensorShift;
  const wb = new Int8Array(NN_BYTES);
  const physarum = c.controller === "physarum";
  const blind = c.blindTrailGradient === true;
  for (let i = 0; i < n; i++) {
    const ci = cell[i];
    const cx = ci % W, cy = (ci / W) | 0;
    const e = cy * W + ((cx + 1) % W), w = cy * W + ((cx + W - 1) % W);
    const so = ((cy + 1) % H) * W + cx, no = ((cy + H - 1) % H) * W + cx;
    xin[0] = sat(A[ci] >>> sh);
    xin[1] = sat(C[ci] >>> sh);
    xin[2] = sat(P[ci] >>> sh);
    xin[3] = blind ? 0 : clampi(sat(P[e] >>> sh) - sat(P[w] >>> sh), -127, 127);
    xin[4] = blind ? 0 : clampi(sat(P[so] >>> sh) - sat(P[no] >>> sh), -127, 127);
    xin[5] = clampi(sat(A[e] >>> sh) - sat(A[w] >>> sh), -127, 127);
    xin[6] = clampi(sat(A[so] >>> sh) - sat(A[no] >>> sh), -127, 127);
    xin[7] = sat(E[i] >>> c.energyShift);
    xin[8] = sat(M[i] >>> c.massShift);
    xin[9] = sat(D[ci] * 16);
    if (physarum) {
      physarumThink(xin, pbase(c.seed, s.step, s.id[i]), o, c.physarumDeposit);
    } else {
      wb.set(s.genome.subarray(i * NN_BYTES, (i + 1) * NN_BYTES));
      controllerForward(wb, xin, h, o);
    }
    out.set(o, i * NN_O);
  }
  return out;
}

/** The R2 null controller (RULES.md, "Physarum null"): fixed outputs, up the trail gradient at half speed plus a small random turn. */
function physarumThink(xin: Int32Array, pb: number, o: Int32Array, deposit: number | undefined): void {
  const gx = xin[3], gy = xin[4];
  const m = Math.max(gx < 0 ? -gx : gx, gy < 0 ? -gy : gy);
  let bx: number, by: number;
  if (m > 0) {
    bx = divi(gx * 64, m);
    by = divi(gy * 64, m);
  } else {
    bx = (draw(pb, RND.WANDER_X) % 129) - 64;
    by = (draw(pb, RND.WANDER_Y) % 129) - 64;
  }
  o.fill(0);
  o[OUT.MX] = clampi(bx + (draw(pb, RND.TURN_X) % 33) - 16, -127, 127);
  o[OUT.MY] = clampi(by + (draw(pb, RND.TURN_Y) % 33) - 16, -127, 127);
  o[OUT.EAT] = 127;
  // R2b: a matched deposit in 1/256 unit per step, stochastically rounded; absent keeps the R2 null (32, no draw).
  o[OUT.DEPOSIT] = deposit === undefined ? 32 : 32 * ((deposit >>> 8) + ((draw(pb, RND.PHYS_DEPOSIT) % 256) < (deposit & 255) ? 1 : 0));
  o[OUT.SPLIT] = 127;
}

/**
 * What every live particle's controller would output on the next step, without changing the state. The
 * outputs are the NN_O values per particle in slot order (MX, MY, EAT, DEPOSIT, SPLIT, then reserved).
 */
export function probe(s: MyceliumState): Int32Array {
  const { cell, D } = binParticles(s);
  return senseAndThink(s, cell, D);
}

/** Advance one step in place and return what happened in it. */
export function step(s: MyceliumState): StepStats {
  const c = s.config;
  const W = c.width, H = c.height, N = W * H;
  const spanX = W << POS_SHIFT, spanY = H << POS_SHIFT;
  const n = s.n;
  const { A, C, P, x, y, M, E } = s;
  const st: StepStats = { lightIn: 0, heat: 0, births: 0, deaths: 0, refused: 0, contended: 0, mutations: 0 };

  // 1. Bin: each particle's cell and the count of particles per cell.
  const { cell, D } = binParticles(s);

  // 2-3. Sense start-of-step state and think. Pure per particle (shared with probe()).
  const out = senseAndThink(s, cell, D);

  // Trail use (optional): each particle's discount factor f, from the START-of-step trail in its cell. Computed here, before phase 5
  // adds any deposit, so it is order-free (the GPU computes it in k_think for the same reason).
  let disc: Uint32Array | null = null;
  if (c.trailMoveDiscount !== undefined) {
    disc = new Uint32Array(n);
    const toll = c.trailDiscountMode === "toll";
    for (let i = 0; i < n; i++) {
      const req = (c.maxDeposit * relu(out[i * NN_O + OUT.DEPOSIT])) >>> 7;
      if (toll && req === 0) continue;
      disc[i] = Math.min(Math.min(P[cell[i]], 256) * c.trailMoveDiscount, 256);
    }
  }

  // 4. Eat: requests summed per cell; a contended cell shares its nutrient pro rata, rounding down,
  // and the remainder stays in the field. maxEat * 127 < 2^15, so every request fits in 16 bits.
  const req = new Uint32Array(n);
  const R = new Uint32Array(N);
  for (let i = 0; i < n; i++) {
    const room = c.bodyMax > M[i] ? c.bodyMax - M[i] : 0;
    const r = Math.min((c.maxEat * relu(out[i * NN_O + OUT.EAT])) >>> 7, room);
    req[i] = r;
    R[cell[i]] += r;
  }
  const taken = new Uint32Array(N);
  const grant = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const ci = cell[i];
    const r = req[i];
    // Contended means R > A, so A < R <= 253 * n and r * A < 253^2 * 2^16 < 2^32 (RULES.md, maxParticles <= 2^16).
    const g = R[ci] <= A[ci] ? r : divu(r * A[ci], R[ci]);
    grant[i] = g;
    taken[ci] += g;
  }
  for (let k = 0; k < N; k++) {
    if (R[k] > A[k]) st.contended++;
    A[k] -= taken[k];
  }

  // 5. Metabolism, trail, turnover, death and movement. Field writes are commutative additions.
  const alive = new Uint8Array(n);
  const wants = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const ci = cell[i];
    const oi = i * NN_O;
    const g = grant[i];
    let m = M[i] + g;
    let en = E[i] + g * c.eA;
    if (en > c.energyMax) { st.heat += en - c.energyMax; en = c.energyMax; }
    const mx = out[oi + OUT.MX], my = out[oi + OUT.MY];
    const pb = pbase(c.seed, s.step, s.id[i]);
    const raw = ((mx < 0 ? -mx : mx) + (my < 0 ? -my : my)) * c.moveCost;
    const move = disc === null ? raw >>> 7 : (raw * (256 - disc[i])) >>> 15;
    const cost = c.upkeep + move + shrFrac(m, c.massUpkeepShift, draw(pb, RND.UPKEEP));
    if (en < cost) {
      st.heat += en; C[ci] += m; st.deaths++;
      continue;
    }
    en -= cost; st.heat += cost;
    let dep = Math.min((c.maxDeposit * relu(out[oi + OUT.DEPOSIT])) >>> 7, m);
    if (dep * c.depositCost > en) dep = divu(en, c.depositCost);
    en -= dep * c.depositCost; st.heat += dep * c.depositCost;
    m -= dep; P[ci] += dep;
    const ex = shrFrac(m, c.excreteShift, draw(pb, RND.EXCRETE));
    m -= ex; C[ci] += ex;
    if (m === 0) {
      st.heat += en; st.deaths++;
      continue;
    }
    M[i] = m; E[i] = en;
    x[i] = (x[i] + spanX + divi(mx * c.speed, 128)) % spanX;
    y[i] = (y[i] + spanY + divi(my * c.speed, 128)) % spanY;
    s.age[i]++;
    alive[i] = 1;
    wants[i] = out[oi + OUT.SPLIT] > 0 && en >= c.splitEnergy && m >= c.splitMatter ? 1 : 0;
  }

  // 6. Compact survivors in slot order, remembering where each parent went.
  let k = 0;
  const newSlot = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    if (k !== i) {
      s.id[k] = s.id[i]; s.parent[k] = s.parent[i]; s.gid[k] = s.gid[i];
      x[k] = x[i]; y[k] = y[i]; M[k] = M[i]; E[k] = E[i]; s.age[k] = s.age[i];
      s.genome.copyWithin(k * NN_BYTES, i * NN_BYTES, (i + 1) * NN_BYTES);
    }
    newSlot[i] = k++;
  }
  const survivors = k;

  // 7. Births: a prefix sum over slot order gives each accepted split its child's id and slot.
  const free = c.maxParticles - survivors;
  let rank = 0, newGids = 0;
  for (let i = 0; i < n; i++) {
    if (!alive[i] || !wants[i]) continue;
    // Refused: no free slot, or the id space would run out (this birth might need a new genotype id too).
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
    M[q] = cm; E[q] = ce; s.age[q] = 0;
    let novel = false;
    if (c.heredity === "blocked") {
      randomWeights(s.genome, q * NN_BYTES, base, c.weightSpan);
      novel = true;
    } else {
      s.genome.copyWithin(q * NN_BYTES, p * NN_BYTES, (p + 1) * NN_BYTES);
      if (c.heredity === "inherit" && (draw(base, RND.MUT) & 0xffff) < c.mutRate) {
        for (let j = 0; j < c.mutCount; j++) {
          const slot = draw(base, RND.MUT_SLOT + j) % NN_BYTES;
          let delta = (draw(base, RND.MUT_DELTA + j) % (2 * c.mutStep + 1)) - c.mutStep;
          if (delta === 0) delta = 1;
          const at = q * NN_BYTES + slot;
          s.genome[at] = clampi(s.genome[at] + delta, -127, 127);
        }
        // A mutation counts, and starts a new genotype, only if the weights actually differ
        // (clamping, cancelling deltas or mutCount 0 can leave them unchanged).
        for (let b = 0; b < NN_BYTES; b++) {
          if (s.genome[q * NN_BYTES + b] !== s.genome[p * NN_BYTES + b]) { novel = true; break; }
        }
        if (novel) st.mutations++;
      }
    }
    s.gid[q] = novel ? s.nextGid + newGids++ : s.gid[p];
    rank++;
    st.births++;
  }
  // Genotype ids are handed out in birth order to every child whose controller differs from its parent's.
  s.nextGid += newGids;
  s.n = survivors + rank;
  s.nextId += rank;

  // 8. Field: light turns waste into nutrient, trail decays to waste, A and C diffuse.
  const fseed = s.config.seed;
  for (let cIdx = 0; cIdx < N; cIdx++) {
    const fb = cellBase(fseed, s.step, cIdx);
    // Gradient light: light * (column + 1) / width, stochastically rounded so every column gets its share.
    const lf = c.light * ((cIdx % W) + 1);
    const L = c.lightPattern === "uniform" ? c.light : divu(lf, W) + ((draw(fb, FIELD.LIGHT) % W) < (lf % W) ? 1 : 0);
    const conv = Math.min(C[cIdx], L);
    C[cIdx] -= conv; A[cIdx] += conv;
    st.lightIn += conv * c.eA;
    if (P[cIdx] > 0 && c.pDecay > 0) {
      const dec = Math.min(P[cIdx], mulFrac(P[cIdx], c.pDecay, 16, draw(fb, FIELD.DECAY)));
      P[cIdx] -= dec; C[cIdx] += dec;
    }
  }
  const dseed = (fseed ^ DIFF_SALT) >>> 0;
  diffuse(A, W, H, c.diffA, dseed, s.step, 0);
  diffuse(C, W, H, c.diffC, dseed, s.step, 1);

  s.step++;
  const t = s.totals;
  if (t.lightIn + st.lightIn > LEDGER_MAX || t.heat + st.heat > LEDGER_MAX) throw new Error(`ledger counters passed 2^50 at step ${s.step}; the run is over`);
  t.lightIn += st.lightIn; t.heat += st.heat; t.births += st.births; t.deaths += st.deaths;
  t.refused += st.refused; t.contended += st.contended; t.mutations += st.mutations;
  return st;
}

/**
 * Conservative 4-neighbour diffusion on a torus with the kernel's diffOut: a cell splits its amount into
 * four quarter-portions that sum to it exactly and sends portion * De / 256 of each, stochastically
 * rounded, so even a cell holding one unit can move it. Directions: 0 east, 1 west, 2 south, 3 north;
 * d ^ 1 is the opposite direction. `sp` keeps the A and C draws apart.
 */
function diffuse(f: Uint32Array, W: number, H: number, De: number, dseed: number, step: number, sp: number): void {
  if (De === 0) return;
  const N = W * H;
  const sent = new Uint32Array(4 * N);
  for (let k = 0; k < N; k++) {
    const base = cellBase(dseed, step, k);
    for (let d = 0; d < 4; d++) sent[4 * k + d] = diffOut(f[k], d, De, base, sp);
  }
  for (let k = 0; k < N; k++) {
    const cx = k % W, cy = (k / W) | 0;
    const east = cy * W + ((cx + 1) % W), west = cy * W + ((cx + W - 1) % W);
    const south = ((cy + 1) % H) * W + cx, north = ((cy + H - 1) % H) * W + cx;
    const out = sent[4 * k] + sent[4 * k + 1] + sent[4 * k + 2] + sent[4 * k + 3];
    // The east neighbour's westward send arrives here, and so on.
    const inflow = sent[4 * east + 1] + sent[4 * west] + sent[4 * south + 3] + sent[4 * north + 2];
    f[k] = f[k] - out + inflow;
  }
}

// ---- checkpoint encoding and digest ----------------------------------------------------------------

const MAGIC = 0x594d4c42; // "BLMY"
const FORMAT = 1;

/** Every persistent field, in a fixed byte layout: a JSON header, then the field and the live particles. */
export function encode(s: MyceliumState): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify({
    format: FORMAT, config: s.config, step: s.step, n: s.n, nextId: s.nextId, nextGid: s.nextGid,
    matter0: s.matter0, energy0: s.energy0, totals: s.totals,
  }));
  const pad = (4 - (header.length % 4)) % 4;
  const N = s.A.length, n = s.n;
  const words = 2 + 3 * N + 8 * n;
  const bytes = new Uint8Array(4 * words + header.length + pad + n * NN_BYTES);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, header.length, true);
  bytes.set(header, 8);
  let off = 8 + header.length + pad;
  const put = (a: Uint32Array, len: number) => { for (let i = 0; i < len; i++, off += 4) dv.setUint32(off, a[i], true); };
  put(s.A, N); put(s.C, N); put(s.P, N);
  for (const a of [s.id, s.parent, s.gid, s.x, s.y, s.M, s.E, s.age]) put(a, n);
  bytes.set(new Uint8Array(s.genome.buffer, s.genome.byteOffset, n * NN_BYTES), off);
  return bytes;
}

export function decode(bytes: Uint8Array): MyceliumState {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error("not a mycelium checkpoint");
  const hl = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl)));
  if (head.format !== FORMAT) throw new Error(`unsupported mycelium checkpoint format ${head.format}`);
  const c = head.config as MyceliumConfig;
  const s = createEmpty(c);
  Object.assign(s, { step: head.step, n: head.n, nextId: head.nextId, nextGid: head.nextGid, matter0: head.matter0, energy0: head.energy0, totals: { ...head.totals } });
  let off = 8 + hl + ((4 - (hl % 4)) % 4);
  const get = (a: Uint32Array, len: number) => { for (let i = 0; i < len; i++, off += 4) a[i] = dv.getUint32(off, true); };
  const N = c.width * c.height;
  get(s.A, N); get(s.C, N); get(s.P, N);
  for (const a of [s.id, s.parent, s.gid, s.x, s.y, s.M, s.E, s.age]) get(a, s.n);
  s.genome.set(new Int8Array(bytes.buffer, bytes.byteOffset + off, s.n * NN_BYTES));
  const bad = validateState(s);
  if (bad.length) throw new Error(`invalid mycelium checkpoint: ${bad.slice(0, 3).join("; ")}`);
  return s;
}

function createEmpty(c: MyceliumConfig): MyceliumState {
  const N = c.width * c.height, cap = c.maxParticles;
  return {
    config: { ...c }, step: 0, A: new Uint32Array(N), C: new Uint32Array(N), P: new Uint32Array(N), n: 0,
    id: new Uint32Array(cap), parent: new Uint32Array(cap), gid: new Uint32Array(cap), x: new Uint32Array(cap), y: new Uint32Array(cap),
    M: new Uint32Array(cap), E: new Uint32Array(cap), age: new Uint32Array(cap), genome: new Int8Array(cap * NN_BYTES),
    nextId: 0, nextGid: 0, matter0: 0, energy0: 0, totals: { lightIn: 0, heat: 0, births: 0, deaths: 0, refused: 0, contended: 0, mutations: 0 },
  };
}

/** 64-bit digest (two FNV-1a lanes) of the encoded state. */
export function stateDigest(s: MyceliumState): string {
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
export function liveGenotypes(s: MyceliumState): number {
  const seen = new Set<number>();
  for (let i = 0; i < s.n; i++) seen.add(s.gid[i]);
  return seen.size;
}

// Controller-layout offsets are part of this rule's identity: the genome is the kernel's 160-byte layout.
export const GENOME_LAYOUT = { W1_OFF, B1_OFF, W2_OFF, B2_OFF, NN_BYTES } as const;
