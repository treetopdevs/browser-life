/** Deliberate fork of the frozen matter model; only nutrient circulation is added. */

export const MATTER_WIDTH = 64;
export const MATTER_HEIGHT = 48;
export const MATTER_SIZE = MATTER_WIDTH * MATTER_HEIGHT;
export const MATTER_INITIAL_RESERVOIR = 32768;
export const MATTER_MAX_TOTAL = 69760;
export const MATTER_HISTORY_CAPACITY = 122;
export const RULES = Object.freeze({
  version: 1,
  width: MATTER_WIDTH,
  height: MATTER_HEIGHT,
  directions: Object.freeze(["east", "south", "west", "north"] as const),
  horizontalWrap: true,
  verticalWrap: false,
  initialNMin: 4,
  initialNMax: 12,
  founderB: 16,
  founderSites: Object.freeze([[8, 12], [24, 12], [40, 12], [56, 12], [8, 28], [24, 28], [40, 28], [56, 28]] as const),
  initialReservoir: MATTER_INITIAL_RESERVOIR,
  initialSediment: 0,
  rainPeriod: 8,
  rainPerTopTile: 1,
  rainRow: 0,
  rainRotatesEastward: true,
  initialMatterMax: MATTER_MAX_TOTAL,
  nutrientRelaxDivisor: 4,
  growthThreshold: 4,
  growthPerTick: 1,
  biomassCap: 64,
  lightCenterPeriod: 10,
  litDepthExclusive: 36,
  lightHalfwidth: 24,
  extensionPeriod: 12,
  extensionDonorThreshold: 24,
  extensionAmount: 4,
  routineMortalityPeriod: 10,
  routineMortalityAmount: 1,
  thresholdLossBelow: 4,
  recyclingPeriod: 24,
  recyclingAmount: 1,
  settlingAmount: 2,
  burialPeriod: 4,
  burialDepthInclusive: 40,
  burialAmount: 1,
  samplePeriod: 50,
  historyCapacity: MATTER_HISTORY_CAPACITY,
  current: Object.freeze({ mode: "circulating", period: 4, geometry: "32 paired-column width-2 full-height loops", nutrientOnly: true }),
});
export const MODES = Object.freeze(["closed", "rain", "burial", "rain-burial"] as const);
export const CURRENT_CONDITIONS = Object.freeze([
  Object.freeze({ id: "closed-still", mode: "closed", current: "off" }),
  Object.freeze({ id: "closed-current", mode: "closed", current: "circulating" }),
  Object.freeze({ id: "rain-still", mode: "rain", current: "off" }),
  Object.freeze({ id: "rain-current", mode: "rain", current: "circulating" }),
] as const);

export type MatterMode = "closed" | "rain" | "burial" | "rain-burial";
export type CurrentMode = "off" | "circulating";
export type MatterFields = {
  nutrient: Uint32Array;
  biomass: Uint32Array;
  detritus: Uint32Array;
  phases: Uint8Array;
};
export type MatterCounters = {
  imported: number;
  buried: number;
  growth: number;
  routineDecay: number;
  thresholdLoss: number;
  mortality: number;
  recycled: number;
  relaxed: number;
  spread: number;
  colonizedTiles: number;
  settled: number;
  circulated: number;
};
export type MatterCensus = MatterCounters & {
  current: CurrentMode;
  tick: number;
  extinctionTick: number | null;
  nutrient: number;
  biomass: number;
  detritus: number;
  activeMatter: number;
  reservoir: number;
  sediment: number;
  initialTotal: number;
  initialNutrient: number;
  initialBiomass: number;
  initialDetritus: number;
  initialReservoir: number;
  residual: number;
  activeCells: number;
  components: number;
  largestComponentCells: number;
};
export type MatterHistorySample = MatterCensus & {
  intervalFromTick: number | null;
  intervalToTick: number | null;
  meanAbsBChange: number | null;
  maskFlipFraction: number | null;
  relaxedInterval: number | null;
  settledInterval: number | null;
};
export type MatterFixture = {
  seed: number;
  mode: MatterMode;
  current: CurrentMode;
  nutrient: Uint32Array | number[];
  biomass: Uint32Array | number[];
  detritus: Uint32Array | number[];
  phases: Uint8Array | number[];
  reservoir: number;
};
export type MatterSnapshot = {
  schemaVersion: 1;
  observationOnly: true;
  description: "Observation only; not a resumable checkpoint";
  rules: typeof RULES;
  runtime: string;
  seed: number;
  mode: MatterMode;
  current: CurrentMode;
  tick: number;
  extinctionTick: number | null;
  fields: { nutrient: number[]; biomass: number[]; detritus: number[]; phases: number[] };
  reservoir: number;
  sediment: number;
  initialNutrient: number;
  initialBiomass: number;
  initialDetritus: number;
  initialReservoir: number;
  initialTotal: number;
  counters: MatterCounters;
  history: MatterHistorySample[];
  droppedSamples: number;
};

const DIRECTIONS: readonly [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function validMode(mode: unknown): mode is MatterMode {
  return mode === "closed" || mode === "rain" || mode === "burial" || mode === "rain-burial";
}
function validCurrent(current: unknown): current is CurrentMode { return current === "off" || current === "circulating"; }
function assertUint32(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffff_ffff) throw new RangeError(`${label} must be a uint32`);
}
function assertSeed(seed: unknown) { assertUint32(seed, "seed"); }
function assertCount(count: number) {
  if (!Number.isInteger(count) || count < 0 || count > 100_000) throw new RangeError("step count must be an integer from 0 through 100000");
}
function idx(x: number, y: number) { return y * MATTER_WIDTH + x; }

/** Successor in the 32 disjoint width-2, height-48 nutrient conveyor loops. */
export function currentSuccessor(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= MATTER_SIZE) throw new RangeError("tile index out of range");
  const x = index % MATTER_WIDTH, y = Math.floor(index / MATTER_WIDTH);
  const left = 2 * Math.floor(x / 2), right = left + 1;
  if (x === left) return y === 0 ? idx(right, 0) : idx(left, y - 1);
  return y === MATTER_HEIGHT - 1 ? idx(left, y) : idx(right, y + 1);
}

/** Valid physical neighbors in direction order E,S,W,N; x wraps, y does not. */
export function matterNeighbors(x: number, y: number): number[] {
  if (!Number.isInteger(x) || x < 0 || x >= MATTER_WIDTH || !Number.isInteger(y) || y < 0 || y >= MATTER_HEIGHT) throw new RangeError("tile coordinates out of range");
  const out: number[] = [];
  for (const [dx, dy] of DIRECTIONS) {
    const ny = y + dy;
    if (ny < 0 || ny >= MATTER_HEIGHT) continue;
    out.push(idx((x + dx + MATTER_WIDTH) % MATTER_WIDTH, ny));
  }
  return out;
}

/** Supplied moving light schedule, including its shallow-water eligibility. */
export function isMatterLit(tick: number, x: number, y: number): boolean {
  if (!Number.isInteger(tick) || tick < 0 || !Number.isInteger(x) || x < 0 || x >= MATTER_WIDTH || !Number.isInteger(y) || y < 0 || y >= MATTER_HEIGHT) throw new RangeError("invalid light coordinates or tick");
  const center = Math.floor(tick / 10) % MATTER_WIDTH;
  const distance = Math.min((x - center + MATTER_WIDTH) % MATTER_WIDTH, (center - x + MATTER_WIDTH) % MATTER_WIDTH);
  return y < 36 && distance <= 24;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function copyValidatedArray(value: unknown, Type: Uint32ArrayConstructor | Uint8ArrayConstructor, label: string, max: number): Uint32Array | Uint8Array {
  let out: Uint32Array | Uint8Array;
  if (value instanceof Type) {
    if (value.length !== MATTER_SIZE) throw new RangeError(`${label} must contain ${MATTER_SIZE} values`);
    out = Type === Uint32Array ? new Uint32Array(value as Uint32Array) : new Uint8Array(value as Uint8Array);
  } else if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${label} must be a plain number array`);
    if (value.length !== MATTER_SIZE) throw new RangeError(`${label} must contain ${MATTER_SIZE} values`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allowedKeys = new Set(["length", ...Array.from({ length: MATTER_SIZE }, (_, i) => String(i))]);
    if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowedKeys.has(key))) throw new TypeError(`${label} must not have extra properties`);
    for (let i = 0; i < MATTER_SIZE; i++) {
      const d = descriptors[String(i)];
      if (!d || !("value" in d)) throw new TypeError(`${label}[${i}] must be an own data value`);
      const n = d.value;
      if (!Number.isInteger(n) || n < 0 || n > max) throw new RangeError(`${label}[${i}] is out of range`);
    }
    out = Type === Uint32Array ? new Uint32Array(value as number[]) : new Uint8Array(value as number[]);
  } else throw new TypeError(`${label} must be a typed array or plain number array`);
  for (let i = 0; i < MATTER_SIZE; i++) if (out[i] > max) throw new RangeError(`${label}[${i}] is out of range`);
  return out;
}

/** Apply one synchronous nutrient permutation without mutating or aliasing input. */
export function circulateNutrient(input: Uint32Array | number[]): { nutrient: Uint32Array; movedUnits: number } {
  const source = copyValidatedArray(input, Uint32Array, "nutrient", MATTER_MAX_TOTAL) as Uint32Array;
  const nutrient = new Uint32Array(MATTER_SIZE);
  let movedUnits = 0;
  for (let i = 0; i < MATTER_SIZE; i++) {
    const amount = source[i];
    nutrient[currentSuccessor(i)] = amount;
    movedUnits += amount;
  }
  if (!Number.isSafeInteger(movedUnits)) throw new RangeError("nutrient total exceeds safe integer range");
  return { nutrient, movedUnits };
}

function fixtureCopy(input: MatterFixture): MatterFields {
  if (!input || typeof input !== "object") throw new TypeError("fixture must be an object");
  const expected = ["seed", "mode", "current", "nutrient", "biomass", "detritus", "phases", "reservoir"].sort();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== expected.length || keys.some((k) => typeof k !== "string" || !expected.includes(k)) || expected.some((k) => !Object.hasOwn(input, k))) throw new TypeError("fixture must have exactly the required own data fields");
  for (const k of expected) if (!("value" in Object.getOwnPropertyDescriptor(input, k)!)) throw new TypeError(`fixture.${k} must be an own data field`);
  assertSeed(input.seed);
  if (!validMode(input.mode)) throw new TypeError("invalid mode");
  if (!validCurrent(input.current)) throw new TypeError("invalid current");
  assertUint32(input.reservoir, "reservoir");
  const nutrient = copyValidatedArray(input.nutrient, Uint32Array, "nutrient", MATTER_MAX_TOTAL) as Uint32Array;
  const biomass = copyValidatedArray(input.biomass, Uint32Array, "biomass", 64) as Uint32Array;
  const detritus = copyValidatedArray(input.detritus, Uint32Array, "detritus", MATTER_MAX_TOTAL) as Uint32Array;
  const phases = copyValidatedArray(input.phases, Uint8Array, "phases", 3) as Uint8Array;
  let active = input.reservoir;
  for (let i = 0; i < MATTER_SIZE; i++) {
    if (nutrient[i] > MATTER_MAX_TOTAL || detritus[i] > MATTER_MAX_TOTAL) throw new RangeError("fixture stock exceeds total-matter bound");
    active += nutrient[i] + biomass[i] + detritus[i];
    if (active > MATTER_MAX_TOTAL) throw new RangeError("fixture total matter exceeds bound");
  }
  return { nutrient, biomass, detritus, phases };
}

function zeroCounters(): MatterCounters {
  return { imported: 0, buried: 0, growth: 0, routineDecay: 0, thresholdLoss: 0, mortality: 0, recycled: 0, relaxed: 0, spread: 0, colonizedTiles: 0, settled: 0, circulated: 0 };
}
function copiedCounters(c: MatterCounters): MatterCounters { return { ...c }; }
function checkedDelta(stock: number, delta: number, maximum: number, label: string): number {
  const value = stock + delta;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} delta violates its integer stock bound`);
  return value;
}

export class MatterWorld {
  readonly seed: number;
  readonly mode: MatterMode;
  readonly current: CurrentMode;
  private readonly stocks: MatterFields;
  private clock = 0;
  private deadAt: number | null = null;
  private source: number;
  private buriedStock = 0;
  private readonly initialN: number;
  private readonly initialB: number;
  private readonly initialD: number;
  private readonly initialSource: number;
  private readonly initialTotal: number;
  private readonly totals = zeroCounters();
  private samples: MatterHistorySample[] = [];
  private discarded = 0;

  constructor(seed: number, mode: MatterMode, current: CurrentMode = "off") {
    assertSeed(seed);
    if (!validMode(mode)) throw new TypeError("invalid mode");
    if (!validCurrent(current)) throw new TypeError("invalid current");
    this.seed = seed;
    this.mode = mode;
    this.current = current;
    const random = mulberry32(seed);
    const nutrient = new Uint32Array(MATTER_SIZE);
    for (let i = 0; i < MATTER_SIZE; i++) nutrient[i] = 4 + Math.floor(random() * 9);
    const biomass = new Uint32Array(MATTER_SIZE);
    for (const y of [12, 28]) for (const x of [8, 24, 40, 56]) biomass[idx(x, y)] = 16;
    const phases = new Uint8Array(MATTER_SIZE);
    for (let i = 0; i < MATTER_SIZE; i++) phases[i] = Math.floor(random() * 4);
    const detritus = new Uint32Array(MATTER_SIZE);
    this.stocks = { nutrient, biomass, detritus, phases };
    this.source = MATTER_INITIAL_RESERVOIR;
    this.initialN = sum(nutrient); this.initialB = sum(biomass); this.initialD = 0; this.initialSource = this.source;
    this.initialTotal = this.initialN + this.initialB + this.initialD + this.initialSource;
    this.recordSample(true);
  }

  static fromFixture(input: MatterFixture): MatterWorld {
    const fields = fixtureCopy(input);
    const world = Object.create(MatterWorld.prototype) as MatterWorld;
    Object.defineProperties(world, {
      seed: { value: input.seed, enumerable: true }, mode: { value: input.mode, enumerable: true }, current: { value: input.current, enumerable: true },
      stocks: { value: fields }, clock: { value: 0, writable: true }, deadAt: { value: sum(fields.biomass) === 0 ? 0 : null, writable: true },
      source: { value: input.reservoir, writable: true }, buriedStock: { value: 0, writable: true },
      initialN: { value: sum(fields.nutrient) }, initialB: { value: sum(fields.biomass) }, initialD: { value: sum(fields.detritus) },
      initialSource: { value: input.reservoir }, initialTotal: { value: sum(fields.nutrient) + sum(fields.biomass) + sum(fields.detritus) + input.reservoir },
      totals: { value: zeroCounters() }, samples: { value: [] }, discarded: { value: 0, writable: true },
    });
    world.recordSample(true);
    return world;
  }

  get tick() { return this.clock; }
  get extinctionTick() { return this.deadAt; }
  get reservoir() { return this.source; }
  get sediment() { return this.buriedStock; }
  get droppedSamples() { return this.discarded; }
  get fields(): MatterFields { return { nutrient: new Uint32Array(this.stocks.nutrient), biomass: new Uint32Array(this.stocks.biomass), detritus: new Uint32Array(this.stocks.detritus), phases: new Uint8Array(this.stocks.phases) }; }
  get history(): MatterHistorySample[] { return this.samples.map((s) => ({ ...s })); }

  step(count = 1): void {
    assertCount(count);
    for (let n = 0; n < count; n++) this.advance();
  }

  private advance() {
    this.clock++;
    if (!Number.isSafeInteger(this.clock)) throw new Error("tick exceeds the safe integer range");
    const { nutrient: N, biomass: B, detritus: D, phases } = this.stocks;

    // 1. Finite, rotating top-row rain.
    if ((this.mode === "rain" || this.mode === "rain-burial") && this.clock % 8 === 0) {
      const first = (Math.floor(this.clock / 8) - 1) % MATTER_WIDTH;
      for (let i = 0; i < MATTER_WIDTH && this.source > 0; i++) {
        const x = (first + i) % MATTER_WIDTH;
        N[idx(x, 0)]++; this.source--; this.totals.imported++;
      }
    }

    // 2. Engineered, nutrient-only conveyor. The pulse follows rain and uses a
    // copied pre-phase field so every source moves exactly once.
    if (this.current === "circulating" && this.clock % 4 === 0) {
      const moved = circulateNutrient(N);
      N.set(moved.nutrient);
      this.totals.circulated += moved.movedUnits;
    }

    // 3. Synchronous threshold relaxation over each undirected edge exactly once.
    const nd = new Int32Array(MATTER_SIZE);
    let relaxed = 0;
    const edge = (a: number, b: number) => {
      const difference = N[a] - N[b];
      const amount = Math.floor(Math.abs(difference) / 4);
      if (!amount) return;
      if (difference > 0) { nd[a] -= amount; nd[b] += amount; }
      else { nd[b] -= amount; nd[a] += amount; }
      relaxed += amount;
    };
    for (let y = 0; y < MATTER_HEIGHT; y++) for (let x = 0; x < MATTER_WIDTH; x++) {
      const a = idx(x, y); edge(a, idx((x + 1) % MATTER_WIDTH, y));
      if (y + 1 < MATTER_HEIGHT) edge(a, idx(x, y + 1));
    }
    for (let i = 0; i < MATTER_SIZE; i++) N[i] = checkedDelta(N[i], nd[i], this.initialTotal, "nutrient");
    this.totals.relaxed += relaxed;

    // 4. Supplied light and local N -> B conversion.
    for (let y = 0; y < MATTER_HEIGHT; y++) for (let x = 0; x < MATTER_WIDTH; x++) {
      const i = idx(x, y);
      if (B[i] >= 4 && isMatterLit(this.clock, x, y) && B[i] < 64 && N[i] > 0) { const amount = Math.min(1, N[i], 64 - B[i]); N[i] -= amount; B[i] += amount; this.totals.growth += amount; }
    }

    // 5. Mortality precedes extension; first routine loss, then threshold collapse.
    if (this.clock % 10 === 0) for (let i = 0; i < MATTER_SIZE; i++) if (B[i] > 0) {
      B[i]--; D[i]++; this.totals.routineDecay++;
    }
    for (let i = 0; i < MATTER_SIZE; i++) if (B[i] > 0 && B[i] < 4) {
      this.totals.thresholdLoss += B[i]; D[i] += B[i]; B[i] = 0;
    }
    this.totals.mortality = this.totals.routineDecay + this.totals.thresholdLoss;

    // 6. Synchronous patch extension, into post-mortality empty sites only.
    if (this.clock % 12 === 0) {
      const bd = new Int32Array(MATTER_SIZE);
      const targets = new Set<number>();
      const directionOffset = Math.floor(this.clock / 12);
      for (let i = 0; i < MATTER_SIZE; i++) if (B[i] >= 24) {
        const direction = (phases[i] + directionOffset) % 4;
        const x = i % MATTER_WIDTH, y = Math.floor(i / MATTER_WIDTH);
        const [dx, dy] = DIRECTIONS[direction];
        const ty = y + dy;
        if (ty < 0 || ty >= MATTER_HEIGHT) continue;
        const target = idx((x + dx + MATTER_WIDTH) % MATTER_WIDTH, ty);
        if (B[target] !== 0) continue;
        bd[i] -= 4; bd[target] += 4; targets.add(target); this.totals.spread += 4;
      }
      for (let i = 0; i < MATTER_SIZE; i++) B[i] = checkedDelta(B[i], bd[i], 64, "biomass");
      this.totals.colonizedTiles += targets.size;
    }

    // 7. Slow recycling.
    if (this.clock % 24 === 0) for (let i = 0; i < MATTER_SIZE; i++) if (D[i] > 0) { D[i]--; N[i]++; this.totals.recycled++; }

    // 8. Synchronous downward settling.
    const dd = new Int32Array(MATTER_SIZE);
    let settled = 0;
    for (let y = 0; y + 1 < MATTER_HEIGHT; y++) for (let x = 0; x < MATTER_WIDTH; x++) {
      const from = idx(x, y), amount = Math.min(2, D[from]);
      if (amount) { dd[from] -= amount; dd[from + MATTER_WIDTH] += amount; settled += amount; }
    }
    for (let i = 0; i < MATTER_SIZE; i++) D[i] = checkedDelta(D[i], dd[i], this.initialTotal, "detritus");
    this.totals.settled += settled;

    // 9. Irreversible deep-zone burial after settling.
    if ((this.mode === "burial" || this.mode === "rain-burial") && this.clock % 4 === 0) {
      for (let y = 40; y < MATTER_HEIGHT; y++) for (let x = 0; x < MATTER_WIDTH; x++) {
        const i = idx(x, y), amount = Math.min(1, D[i]);
        D[i] -= amount; this.buriedStock += amount; this.totals.buried += amount;
      }
    }

    if (this.deadAt === null && sum(B) === 0) this.deadAt = this.clock;
    for (const key of Object.keys(this.totals) as (keyof MatterCounters)[]) if (!Number.isSafeInteger(this.totals[key]) || this.totals[key] < 0) throw new Error(`${key} counter exceeds the safe integer range`);
    if (this.clock % 50 === 0 || this.deadAt === this.clock) this.recordSample(false);
  }

  census(): MatterCensus {
    const nutrient = sum(this.stocks.nutrient), biomass = sum(this.stocks.biomass), detritus = sum(this.stocks.detritus);
    const { components, largest } = componentStats(this.stocks.biomass);
    return {
      current: this.current, tick: this.clock, extinctionTick: this.deadAt, nutrient, biomass, detritus, activeMatter: nutrient + biomass + detritus,
      reservoir: this.source, sediment: this.buriedStock, initialTotal: this.initialTotal,
      initialNutrient: this.initialN, initialBiomass: this.initialB, initialDetritus: this.initialD, initialReservoir: this.initialSource,
      residual: nutrient + biomass + detritus + this.source + this.buriedStock - this.initialTotal,
      activeCells: countActive(this.stocks.biomass), components, largestComponentCells: largest, ...copiedCounters(this.totals),
    };
  }

  private recordSample(initial: boolean) {
    const census = this.census();
    const previous = this.samples[this.samples.length - 1];
    let intervalFromTick: number | null = null, intervalToTick: number | null = null;
    let meanAbsBChange: number | null = null, maskFlipFraction: number | null = null, relaxedInterval: number | null = null, settledInterval: number | null = null;
    if (!initial && previous) {
      intervalFromTick = previous.tick;
      intervalToTick = census.tick;
      const b = this.stocks.biomass;
      let abs = 0, flips = 0;
      // Samples store a private biomass baseline outside the public census shape.
      const previousFields = (previous as MatterHistorySample & { __b?: Uint32Array }).__b;
      if (previousFields) {
        abs = 0; flips = 0;
        for (let i = 0; i < MATTER_SIZE; i++) { abs += Math.abs(b[i] - previousFields[i]); if ((b[i] >= 4) !== (previousFields[i] >= 4)) flips++; }
      }
      meanAbsBChange = abs / MATTER_SIZE;
      maskFlipFraction = flips / MATTER_SIZE;
      relaxedInterval = census.relaxed - previous.relaxed;
      settledInterval = census.settled - previous.settled;
    }
    const sample = { ...census, intervalFromTick, intervalToTick, meanAbsBChange, maskFlipFraction, relaxedInterval, settledInterval } as MatterHistorySample & { __b?: Uint32Array };
    Object.defineProperty(sample, "__b", { value: new Uint32Array(this.stocks.biomass), enumerable: false });
    this.samples.push(sample);
    if (this.samples.length > MATTER_HISTORY_CAPACITY) { this.samples.shift(); this.discarded++; }
  }

  snapshot(): MatterSnapshot {
    return {
      schemaVersion: 1, observationOnly: true, description: "Observation only; not a resumable checkpoint", rules: RULES, runtime: runtimeLabel(), seed: this.seed, mode: this.mode, current: this.current, tick: this.clock,
      extinctionTick: this.deadAt, fields: { nutrient: Array.from(this.stocks.nutrient), biomass: Array.from(this.stocks.biomass), detritus: Array.from(this.stocks.detritus), phases: Array.from(this.stocks.phases) }, reservoir: this.source, sediment: this.buriedStock,
      initialNutrient: this.initialN, initialBiomass: this.initialB, initialDetritus: this.initialD, initialReservoir: this.initialSource,
      initialTotal: this.initialTotal, counters: copiedCounters(this.totals), history: this.history, droppedSamples: this.discarded,
    };
  }
}

function runtimeLabel(): string {
  const p = globalThis as typeof globalThis & { process?: { versions?: { node?: string } } };
  return p.process?.versions?.node ? `Node ${p.process.versions.node}` : "browser";
}
function sum(a: Uint32Array): number { let total = 0; for (const value of a) total += value; return total; }
function countActive(b: Uint32Array) { let total = 0; for (const value of b) if (value >= 4) total++; return total; }
function componentStats(b: Uint32Array): { components: number; largest: number } {
  const seen = new Uint8Array(MATTER_SIZE), queue = new Int32Array(MATTER_SIZE);
  let components = 0, largest = 0;
  for (let start = 0; start < MATTER_SIZE; start++) if (b[start] >= 4 && !seen[start]) {
    components++; let head = 0, tail = 0, size = 0; queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head++]; size++;
      const x = i % MATTER_WIDTH, y = Math.floor(i / MATTER_WIDTH);
      const neighbors = [idx((x + 1) % MATTER_WIDTH, y), idx((x + MATTER_WIDTH - 1) % MATTER_WIDTH, y), ...(y > 0 ? [i - MATTER_WIDTH] : []), ...(y + 1 < MATTER_HEIGHT ? [i + MATTER_WIDTH] : [])];
      for (const n of neighbors) if (b[n] >= 4 && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
    }
    largest = Math.max(largest, size);
  }
  return { components, largest };
}

/** Build a copied, validated tick-zero fixture using the production update rules. */
export function createMatterFixture(input: MatterFixture): MatterWorld { return MatterWorld.fromFixture(input); }

