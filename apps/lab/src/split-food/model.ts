/**
 * Isolated split-food copy of stationary-food/model.ts.
 * Copied source SHA-256: 7bd5af02243cb0629547a20d889a05cd904246a16227f58df4e420edc84a859f
 * The only new mode offers the same number of target tiles as a stationary 48-column band,
 * split into columns 0–23 and 48–71. All pre-existing modes retain their behavior.
 */

export const RULES = Object.freeze({
  version: 1,
  width: 96,
  height: 96,
  tileCount: 96 * 96,
  directions: 4,
  initialFood: 20,
  maxFood: 40,
  foodSupplyEvery: 5,
  foodSupplyPerTile: 1,
  absorbPerCell: 2,
  storeCap: 160,
  upkeepDivisor: 8,
  structurePerCell: 4,
  growthCost: 4,
  growthEvery: 6,
  reproductionEvery: 80,
  reproductionCellFraction: 0.75,
  reproductionThreshold: 24,
  reproductionCost: 16,
  newbornStore: 12,
  birthPlacementAttempts: 16,
  birthPlacementRadius: 8,
  maxOrganisms: 48,
  maxCellsPerOrganism: 32,
  maxOccupied: 1536,
  maxAge: 600,
  historyEvery: 20,
  maxHistory: 451,
  maxLineage: 10_000,
  maxStepCount: 100_000,
  founderCount: 12,
  mutationRate: 0.25,
  mutationSeedXor: 0x9e3779b9,
} as const);

export interface DevelopmentGenome {
  readonly turnEvery: number;
  readonly turn: -1 | 0 | 1;
  readonly branchEvery: number;
  readonly maxCells: number;
}

export const GENOME_PRESETS: readonly DevelopmentGenome[] = Object.freeze([
  Object.freeze({ turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 }),
  Object.freeze({ turnEvery: 4, turn: 1, branchEvery: 3, maxCells: 24 }),
  Object.freeze({ turnEvery: 4, turn: 0, branchEvery: 2, maxCells: 24 }),
]);

export type DevelopmentDirection = 0 | 1 | 2 | 3;
export type MutationField = keyof DevelopmentGenome;

export interface DevelopmentAttempt {
  readonly parentCell: number;
  readonly direction: DevelopmentDirection;
}

export interface DevelopmentCell {
  readonly tile: number;
  readonly heading: DevelopmentDirection;
  readonly depth: number;
}

export interface DevelopmentOrganism {
  readonly id: number;
  readonly parentID: number | null;
  readonly family: number;
  readonly generation: number;
  readonly age: number;
  readonly store: number;
  readonly genome: DevelopmentGenome;
  readonly births: number;
  readonly cells: readonly DevelopmentCell[];
  readonly growthQueue: readonly DevelopmentAttempt[];
  readonly growthCursor: number;
}

export interface GenomeMutation {
  readonly field: MutationField;
  readonly from: number;
  readonly to: number;
}

export interface DevelopmentLineageNode {
  readonly id: number;
  readonly parentID: number | null;
  readonly family: number;
  readonly generation: number;
  readonly birthTick: number;
  readonly genome: DevelopmentGenome;
  readonly mutation: GenomeMutation | null;
  readonly deathTick: number | null;
  readonly deathCause: 'starvation' | 'age' | null;
  readonly parentRecordDropped: boolean;
}

export interface DevelopmentCensus {
  readonly tick: number;
  readonly population: number;
  readonly cells: number;
  readonly familyCounts: readonly [number, number, number];
  readonly births: number;
  readonly growths: number;
  readonly deaths: number;
  readonly effectiveMutations: number;
  readonly attemptedMutations: number;
  readonly maxGeneration: number;
  readonly totalCells: number;
  readonly totalEnergy: number;
  readonly meanBodyCells: number;
  readonly meanEnergy: number;
  readonly blockedBirths: number;
  readonly blockedSpaceBirths: number;
  readonly blockedCapBirths: number;
  readonly ledgerResidual: number;
  readonly genomeVariantCount: number;
}

export interface DevelopmentLedger {
  readonly initialEnergy: number;
  readonly supplied: number;
  readonly dissipated: number;
  readonly deathLoss: number;
  readonly expected: number;
  readonly actual: number;
  readonly residual: number;
}

export interface DevelopmentHistory extends DevelopmentCensus {}

export interface DevelopmentSnapshot {
  readonly schemaVersion: 1;
  readonly description: 'observation only; not a resume checkpoint';
  readonly runtime: string;
  readonly rules: typeof RULES;
  readonly seed: number;
  readonly mutation: boolean;
  readonly tick: number;
  readonly extinctionTick: number | null;
  readonly food: readonly number[];
  readonly occupancy: readonly number[];
  readonly organisms: readonly DevelopmentOrganism[];
  readonly ledger: DevelopmentLedger;
  readonly counters: Readonly<DevelopmentCounters>;
  readonly history: readonly DevelopmentHistory[];
  readonly droppedHistory: number;
  readonly lineage: readonly DevelopmentLineageNode[];
  readonly droppedLineage: number;
}

export interface DevelopmentCounters {
  births: number;
  growths: number;
  deaths: number;
  effectiveMutations: number;
  attemptedMutations: number;
  blockedSpaceBirths: number;
  blockedCapBirths: number;
}

export interface DevelopmentFounderFixture {
  tile: number;
  heading: number;
  genome: unknown;
  age: number;
  store: number;
}

export interface DevelopmentFixtureSpec {
  seed: number;
  mutation: boolean;
  food: number | Uint8Array;
  founders: readonly DevelopmentFounderFixture[];
}

export type FoodMode = 'original' | 'uniform' | 'patches' | 'moving-band' | 'stationary-band' | 'split-band';

export interface HungryEnvironment {
  readonly version: 1;
  readonly mode: FoodMode;
  readonly pulseBudget: number;
  readonly targetCount: number;
  readonly pulses: number;
  readonly offered: number;
  readonly accepted: number;
  readonly overflow: number;
  readonly initialFoodPerTile: number;
  /** Present only for band modes, preserving the historical uniform environment shape. */
  readonly bandLeft?: number;
  readonly bandWidth?: number;
  /** Present only for split-band; inclusive world-column ranges in ascending order. */
  readonly bandColumns?: readonly (readonly [number, number])[];
}

const SCARCE_PULSE_BUDGET = 768;
const TARGET_STRIDE = 2053;
export const MOVING_BAND_WIDTH = 48;
export const MOVING_BAND_TARGET_COUNT = RULES.height * MOVING_BAND_WIDTH;
export const SPLIT_BAND_WIDTH = 24;
export const SPLIT_BAND_COLUMNS = Object.freeze([Object.freeze([0, 23] as const), Object.freeze([48, 71] as const)] as const);
export const SPLIT_BAND_TARGET_COUNT = RULES.height * SPLIT_BAND_WIDTH * SPLIT_BAND_COLUMNS.length;

export function splitBandGeometry(): Readonly<{ columns: typeof SPLIT_BAND_COLUMNS; width: 24; tiles: readonly number[] }> {
  const tiles: number[] = [];
  for (let tile = 0; tile < RULES.tileCount; tile++) {
    const column = tile % RULES.width;
    if (column < 24 || (column >= 48 && column < 72)) tiles.push(tile);
  }
  return Object.freeze({ columns: SPLIT_BAND_COLUMNS, width: SPLIT_BAND_WIDTH, tiles: Object.freeze(tiles) });
}

export function isSplitBandTile(tile: number): boolean {
  if (!Number.isSafeInteger(tile) || tile < 0 || tile >= RULES.tileCount) throw new RangeError('tile is out of range');
  const column = tile % RULES.width;
  return column < 24 || (column >= 48 && column < 72);
}

const SPLIT_BAND_TILES = splitBandGeometry().tiles;
export function splitBandPulseTargetTile(pulse: number, slot: number, seed: number): number {
  if (!Number.isSafeInteger(pulse) || pulse < 0) throw new RangeError('pulse must be a nonnegative safe integer');
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= SCARCE_PULSE_BUDGET) throw new RangeError('slot is outside the pulse budget');
  if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError('seed must be a nonnegative safe integer');
  const targetIndex = ((pulse * SCARCE_PULSE_BUDGET + slot) * TARGET_STRIDE + seed % SPLIT_BAND_TARGET_COUNT) % SPLIT_BAND_TARGET_COUNT;
  return SPLIT_BAND_TILES[targetIndex]!;
}

export function movingBandPulseTargetTile(pulse: number, slot: number, seed: number, tick: number): number {
  if (!Number.isSafeInteger(pulse) || pulse < 0) throw new RangeError('pulse must be a nonnegative safe integer');
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= SCARCE_PULSE_BUDGET) throw new RangeError('slot is outside the pulse budget');
  if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError('seed must be a nonnegative safe integer');
  const targetIndex = ((pulse * SCARCE_PULSE_BUDGET + slot) * TARGET_STRIDE + seed % MOVING_BAND_TARGET_COUNT) % MOVING_BAND_TARGET_COUNT;
  return movingBandTargetTile(targetIndex, tick);
}

export function movingBandLeftEdge(tick: number): number {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('tick must be a nonnegative safe integer');
  return Math.floor(tick / 50) % RULES.width;
}

export function movingBandTargetTile(targetIndex: number, tick: number): number {
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= MOVING_BAND_TARGET_COUNT) {
    throw new RangeError(`targetIndex must be from 0 to ${MOVING_BAND_TARGET_COUNT - 1}`);
  }
  const y = Math.floor(targetIndex / MOVING_BAND_WIDTH);
  const localX = targetIndex % MOVING_BAND_WIDTH;
  const x = (localX + movingBandLeftEdge(tick)) % RULES.width;
  return y * RULES.width + x;
}

export function movingBandGeometry(tick: number): Readonly<{ left: number; width: number; tiles: readonly number[] }> {
  const left = movingBandLeftEdge(tick);
  const tiles = Object.freeze(Array.from({ length: MOVING_BAND_TARGET_COUNT }, (_, index) => movingBandTargetTile(index, tick)));
  return Object.freeze({ left, width: MOVING_BAND_WIDTH, tiles });
}

export function stationaryBandGeometry(): Readonly<{ left: 0; width: number; tiles: readonly number[] }> {
  const tiles = Object.freeze(Array.from({ length: MOVING_BAND_TARGET_COUNT }, (_, index) => movingBandTargetTile(index, 0)));
  return Object.freeze({ left: 0, width: MOVING_BAND_WIDTH, tiles });
}

export function isMovingBandTile(tile: number, tick: number): boolean {
  if (!Number.isSafeInteger(tile) || tile < 0 || tile >= RULES.tileCount) throw new RangeError('tile is out of range');
  const x = tile % RULES.width;
  const localX = (x - movingBandLeftEdge(tick) + RULES.width) % RULES.width;
  return localX < MOVING_BAND_WIDTH;
}

export function isStationaryBandTile(tile: number): boolean {
  if (!Number.isSafeInteger(tile) || tile < 0 || tile >= RULES.tileCount) throw new RangeError('tile is out of range');
  return tile % RULES.width < MOVING_BAND_WIDTH;
}

function requireFoodMode(mode: unknown): asserts mode is FoodMode {
  if (mode !== 'original' && mode !== 'uniform' && mode !== 'patches' && mode !== 'moving-band' && mode !== 'stationary-band' && mode !== 'split-band') {
    throw new TypeError("food mode must be 'original', 'uniform', 'patches', 'moving-band', 'stationary-band', or 'split-band'");
  }
}

function foodTargetTiles(mode: FoodMode): readonly number[] {
  if (mode === 'moving-band') return Object.freeze(Array.from({ length: MOVING_BAND_TARGET_COUNT }, (_, index) => index));
  if (mode === 'stationary-band') return stationaryBandGeometry().tiles;
  if (mode === 'split-band') return SPLIT_BAND_TILES;
  if (mode !== 'patches') return Object.freeze(Array.from({ length: RULES.tileCount }, (_, tile) => tile));
  const selected = new Uint8Array(RULES.tileCount);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
    const centerX = 12 + col * 24;
    const centerY = 16 + row * 32;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = (centerX + dx + RULES.width) % RULES.width;
      const y = (centerY + dy + RULES.height) % RULES.height;
      selected[y * RULES.width + x] = 1;
    }
  }
  const targets: number[] = [];
  for (let tile = 0; tile < selected.length; tile++) if (selected[tile]) targets.push(tile);
  return Object.freeze(targets);
}

interface MutableCell { tile: number; heading: DevelopmentDirection; depth: number }
interface MutableOrganism {
  id: number;
  parentID: number | null;
  family: number;
  generation: number;
  age: number;
  store: number;
  genome: DevelopmentGenome;
  births: number;
  cells: MutableCell[];
  growthQueue: DevelopmentAttempt[];
  growthCursor: number;
}
interface MutableLineage extends Omit<DevelopmentLineageNode, 'parentRecordDropped'> {
  deathTick: number | null;
  deathCause: 'starvation' | 'age' | null;
}

const GENES: readonly MutationField[] = ['turnEvery', 'turn', 'branchEvery', 'maxCells'];
const GENE_BOUNDS: Record<MutationField, readonly [number, number]> = {
  turnEvery: [2, 8], turn: [-1, 1], branchEvery: [2, 6], maxCells: [16, 32],
};

function plainOwnDataObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false;
    const desc = Object.getOwnPropertyDescriptor(value, key);
    return !!desc && 'value' in desc && desc.enumerable;
  });
}
function copyDenseArray(value: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maxLength || Reflect.ownKeys(value).length !== value.length + 1) {
    throw new TypeError(`expected a dense plain array of at most ${maxLength} items`);
  }
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(value, String(i));
    if (!desc || !('value' in desc) || !desc.enumerable) throw new TypeError('array items must be own data fields without holes');
    result.push(desc.value);
  }
  return result;
}

export function validateGenome(value: unknown): DevelopmentGenome {
  if (!plainOwnDataObject(value)) throw new TypeError('genome must be a plain object with own data fields');
  const expected = ['turnEvery', 'turn', 'branchEvery', 'maxCells'];
  if (Reflect.ownKeys(value).length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError('genome must contain exactly turnEvery, turn, branchEvery, and maxCells');
  }
  const input = value as Record<string, unknown>;
  for (const field of expected) {
    if (typeof input[field] !== 'number' || !Number.isInteger(input[field]) || !Number.isFinite(input[field])) {
      throw new TypeError(`${field} must be a finite integer`);
    }
  }
  for (const field of GENES) {
    const [min, max] = GENE_BOUNDS[field];
    if ((input[field] as number) < min || (input[field] as number) > max) throw new RangeError(`${field} is outside ${min}..${max}`);
  }
  const turn = Object.is(input.turn, -0) ? 0 : input.turn as number;
  return Object.freeze({ turnEvery: input.turnEvery as number, turn: turn as -1 | 0 | 1,
    branchEvery: input.branchEvery as number, maxCells: input.maxCells as number });
}

export function developmentDirections(genomeValue: DevelopmentGenome, heading: number, depth: number): readonly DevelopmentDirection[] {
  const genome = validateGenome(genomeValue);
  assertDirection(heading);
  if (!Number.isSafeInteger(depth) || depth < 0) throw new RangeError('depth must be a nonnegative safe integer');
  const forward = ((heading + (depth > 0 && depth % genome.turnEvery === 0 ? genome.turn : 0) + 4) % 4) as DevelopmentDirection;
  const directions: DevelopmentDirection[] = [forward];
  if (depth === 0 || depth % genome.branchEvery === 0) {
    directions.push(((forward + 3) % 4) as DevelopmentDirection, ((forward + 1) % 4) as DevelopmentDirection);
  }
  return Object.freeze(directions);
}

export function wrappedNeighbor(tile: number, direction: number): number {
  if (!Number.isInteger(tile) || tile < 0 || tile >= RULES.tileCount) throw new RangeError('tile is out of range');
  assertDirection(direction);
  const x = tile % RULES.width;
  const y = Math.floor(tile / RULES.width);
  switch (direction) {
    case 0: return y * RULES.width + ((x + 1) % RULES.width);
    case 1: return ((y + 1) % RULES.height) * RULES.width + x;
    case 2: return y * RULES.width + ((x + RULES.width - 1) % RULES.width);
    default: return ((y + RULES.height - 1) % RULES.height) * RULES.width + x;
  }
}

function assertDirection(direction: number): asserts direction is DevelopmentDirection {
  if (!Number.isInteger(direction) || direction < 0 || direction > 3) throw new RangeError('direction must be 0..3');
}
function uint32(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError(`${name} must be a uint32`);
  return value >>> 0;
}
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
function integerDraw(random: () => number, n: number): number { return Math.floor(random() * n); }
function canonicalGenome(genome: DevelopmentGenome): string {
  return `${genome.turnEvery},${Object.is(genome.turn, -0) ? 0 : genome.turn},${genome.branchEvery},${genome.maxCells}`;
}
function copyGenome(genome: DevelopmentGenome): DevelopmentGenome { return validateGenome(genome); }
function freezeCell(cell: MutableCell): DevelopmentCell { return Object.freeze({ ...cell }); }
function freezeAttempt(attempt: DevelopmentAttempt): DevelopmentAttempt { return Object.freeze({ ...attempt }); }
function freezeOrganism(o: MutableOrganism): DevelopmentOrganism {
  return Object.freeze({ id: o.id, parentID: o.parentID, family: o.family, generation: o.generation, age: o.age,
    store: o.store, genome: copyGenome(o.genome), births: o.births,
    cells: Object.freeze(o.cells.map(freezeCell)), growthQueue: Object.freeze(o.growthQueue.map(freezeAttempt)), growthCursor: o.growthCursor });
}

export class DevelopmentWorld {
  readonly seed: number;
  readonly mutation: boolean;
  private ecology: () => number;
  private mutationRandom: () => number;
  private _tick = 0;
  private _extinctionTick: number | null = null;
  private _food = new Uint8Array(RULES.tileCount);
  private _occupancy = new Float64Array(RULES.tileCount);
  private living: MutableOrganism[] = [];
  private nextID = 1;
  private initialEnergy = 0;
  private supplied = 0;
  private dissipated = 0;
  private deathLoss = 0;
  private counters: DevelopmentCounters = { births: 0, growths: 0, deaths: 0, effectiveMutations: 0,
    attemptedMutations: 0, blockedSpaceBirths: 0, blockedCapBirths: 0 };
  private samples: DevelopmentHistory[] = [];
  private droppedSamples = 0;
  private nodes: MutableLineage[] = [];
  private droppedNodes = 0;
  private _mode: FoodMode = 'original';
  private _foodTargets: readonly number[] = Object.freeze([]);
  private pulseCount = 0;
  private offered = 0;
  private overflow = 0;

  constructor(seed: number, mutation: boolean, mode: FoodMode = 'original') {
    this.seed = uint32(seed, 'seed');
    if (typeof mutation !== 'boolean') throw new TypeError('mutation must be boolean');
    requireFoodMode(mode);
    this.mutation = mutation;
    this._mode = mode;
    this._foodTargets = foodTargetTiles(mode);
    this.ecology = mulberry32(this.seed);
    this.mutationRandom = mulberry32((this.seed ^ RULES.mutationSeedXor) >>> 0);
    this._food.fill(RULES.initialFood);
    const sites: number[] = [];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
      sites.push((16 + row * 32) * RULES.width + (12 + col * 24));
    }
    for (let i = sites.length - 1; i > 0; i--) {
      const j = integerDraw(this.ecology, i + 1);
      [sites[i], sites[j]] = [sites[j], sites[i]];
    }
    const headings = sites.map(() => integerDraw(this.ecology, 4) as DevelopmentDirection);
    sites.forEach((tile, i) => this.addFounder(tile, headings[i], GENOME_PRESETS[i % 3], 0, 24, i % 3));
    this.finishInitialization();
  }

  private static empty(seed: number, mutation: boolean, mode: FoodMode): DevelopmentWorld {
    const world = Object.create(DevelopmentWorld.prototype) as DevelopmentWorld;
    Object.defineProperties(world, {
      seed: { value: uint32(seed, 'seed'), enumerable: true },
      mutation: { value: mutation, enumerable: true },
    });
    world.ecology = mulberry32(world.seed);
    world.mutationRandom = mulberry32((world.seed ^ RULES.mutationSeedXor) >>> 0);
    world._food = new Uint8Array(RULES.tileCount);
    world._occupancy = new Float64Array(RULES.tileCount);
    world.living = [];
    world.nextID = 1;
    world._tick = 0;
    world._extinctionTick = null;
    world.initialEnergy = 0;
    world.supplied = world.dissipated = world.deathLoss = 0;
    world.counters = { births: 0, growths: 0, deaths: 0, effectiveMutations: 0, attemptedMutations: 0, blockedSpaceBirths: 0, blockedCapBirths: 0 };
    world.samples = [];
    world.droppedSamples = 0;
    world.nodes = [];
    world.droppedNodes = 0;
    world.lastMutation = null;
    world._mode = mode;
    world._foodTargets = foodTargetTiles(mode);
    world.pulseCount = 0;
    world.offered = 0;
    world.overflow = 0;
    return world;
  }

  private addFounder(tile: number, heading: DevelopmentDirection, genomeValue: DevelopmentGenome, age: number, store: number, family: number): void {
    const genome = copyGenome(genomeValue);
    const organism = this.makeOrganism({ id: this.nextID++, parentID: null, family, generation: 0, age, store, genome, tile, heading });
    this.living.push(organism);
    this._occupancy[tile] = organism.id;
    this.nodes.push({ id: organism.id, parentID: null, family, generation: 0, birthTick: 0, genome: copyGenome(genome), mutation: null, deathTick: null, deathCause: null });
  }

  private makeOrganism(input: { id: number; parentID: number | null; family: number; generation: number; age: number; store: number; genome: DevelopmentGenome; tile: number; heading: DevelopmentDirection }): MutableOrganism {
    const cell: MutableCell = { tile: input.tile, heading: input.heading, depth: 0 };
    return { id: input.id, parentID: input.parentID, family: input.family, generation: input.generation, age: input.age,
      store: input.store, genome: copyGenome(input.genome), births: 0, cells: [cell],
      growthQueue: developmentDirections(input.genome, input.heading, 0).map((direction) => ({ parentCell: 0, direction })), growthCursor: 0 };
  }

  private finishInitialization(): void {
    this.initialEnergy = this.sumFood() + this.sumBodyEnergy();
    if (this.living.length === 0) this._extinctionTick = 0;
    this.recordHistory(true);
  }

  get tick(): number { return this._tick; }
  get extinctionTick(): number | null { return this._extinctionTick; }
  get organisms(): readonly DevelopmentOrganism[] { return Object.freeze(this.living.map(freezeOrganism)); }
  get food(): Uint8Array { return this._food.slice(); }
  get occupancy(): Float64Array { return this._occupancy.slice(); }
  get history(): readonly DevelopmentHistory[] { return Object.freeze(this.samples.map((sample) => Object.freeze({ ...sample, familyCounts: Object.freeze([...sample.familyCounts]) as unknown as readonly [number, number, number] }))); }
  get lineage(): readonly DevelopmentLineageNode[] {
    const ids = new Set(this.nodes.map((node) => node.id));
    return Object.freeze(this.nodes.map((node) => Object.freeze({ ...node, genome: copyGenome(node.genome), mutation: node.mutation ? Object.freeze({ ...node.mutation }) : null,
      parentRecordDropped: node.parentID !== null && !ids.has(node.parentID) })));
  }
  get ledger(): DevelopmentLedger { return this.computeLedger(); }
  get countersView(): Readonly<DevelopmentCounters> { return Object.freeze({ ...this.counters }); }
  get environment(): HungryEnvironment {
    const pulseBudget = this._mode === 'original' ? RULES.tileCount : SCARCE_PULSE_BUDGET;
    const base = { version: 1 as const, mode: this._mode, pulseBudget, targetCount: this._foodTargets.length,
      pulses: this.pulseCount, offered: this.offered, accepted: this.supplied, overflow: this.overflow,
      initialFoodPerTile: RULES.initialFood };
    return this._mode === 'moving-band'
      ? Object.freeze({ ...base, bandLeft: movingBandLeftEdge(this._tick), bandWidth: MOVING_BAND_WIDTH })
      : this._mode === 'stationary-band'
        ? Object.freeze({ ...base, bandLeft: 0, bandWidth: MOVING_BAND_WIDTH })
        : this._mode === 'split-band'
          ? Object.freeze({ ...base, bandColumns: SPLIT_BAND_COLUMNS, bandWidth: SPLIT_BAND_WIDTH })
        : Object.freeze(base);
  }
  get foodTargets(): readonly number[] {
    return this._mode === 'moving-band' ? movingBandGeometry(this._tick).tiles : Object.freeze([...this._foodTargets]);
  }

  step(count = 1): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > RULES.maxStepCount) throw new RangeError(`count must be an integer from 0 to ${RULES.maxStepCount}`);
    for (let i = 0; i < count; i++) {
      if (this._extinctionTick !== null) break;
      this._tick++;
      if (this._tick % RULES.foodSupplyEvery === 0) this.supplyFood();
      const starting = [...this.living].sort((a, b) => a.id - b.id);
      const newborns: MutableOrganism[] = [];
      for (const organism of starting) {
        if (!this.living.includes(organism)) continue;
        organism.age++;
        this.feed(organism);
        const upkeep = Math.ceil(organism.cells.length / RULES.upkeepDivisor);
        if (organism.store < upkeep) {
          this.dissipated += organism.store;
          organism.store = 0;
          this.remove(organism, 'starvation');
          continue;
        }
        organism.store -= upkeep;
        this.dissipated += upkeep;
        if (organism.age >= RULES.maxAge) {
          this.remove(organism, 'age');
          continue;
        }
        if (organism.age % RULES.growthEvery === 0 && organism.store >= RULES.growthCost && organism.cells.length < organism.genome.maxCells) {
          this.grow(organism);
        }
        if (organism.age % RULES.reproductionEvery === 0 && organism.cells.length >= Math.ceil(RULES.reproductionCellFraction * organism.genome.maxCells) && organism.store >= RULES.reproductionThreshold) {
          if (this.living.length + newborns.length >= RULES.maxOrganisms) {
            this.counters.blockedCapBirths++;
          } else {
            const child = this.reproduce(organism);
            if (child) newborns.push(child);
          }
        }
      }
      this.living.push(...newborns);
      this.living.sort((a, b) => a.id - b.id);
      if (this.living.length === 0) this._extinctionTick = this._tick;
      if (this._tick % RULES.historyEvery === 0 || this._extinctionTick === this._tick) this.recordHistory(false);
      this.assertSafeAccounting();
    }
  }

  census(): DevelopmentCensus { return this.makeCensus(); }

  snapshot(): DevelopmentSnapshot {
    return Object.freeze({ schemaVersion: 1, description: 'observation only; not a resume checkpoint',
      runtime: typeof process !== 'undefined' && typeof process.versions?.node === 'string'
        ? `Node ${process.versions.node}` : 'browser',
      rules: RULES, seed: this.seed, mutation: this.mutation, tick: this._tick, extinctionTick: this._extinctionTick,
      food: Object.freeze(Array.from(this._food)), occupancy: Object.freeze(Array.from(this._occupancy)),
      organisms: this.organisms, ledger: this.computeLedger(), counters: Object.freeze({ ...this.counters }), history: this.history,
      droppedHistory: this.droppedSamples, lineage: this.lineage, droppedLineage: this.droppedNodes });
  }

  /** Internal fixture construction stays inside the model so callers cannot write live private state. */
  static createFixture(specValue: DevelopmentFixtureSpec, mode: FoodMode = 'original'): DevelopmentWorld {
    requireFoodMode(mode);
    if (!plainOwnDataObject(specValue) || Reflect.ownKeys(specValue).length !== 4 ||
      !['seed', 'mutation', 'food', 'founders'].every((key) => Object.hasOwn(specValue, key))) {
      throw new TypeError('fixture must contain exactly seed, mutation, food, and founders');
    }
    const spec = specValue as unknown as Record<string, unknown>;
    const seed = uint32(spec.seed as number, 'seed');
    if (typeof spec.mutation !== 'boolean') throw new TypeError('mutation must be boolean');
    const founders = copyDenseArray(spec.founders, RULES.maxOrganisms);
    const world = DevelopmentWorld.empty(seed, spec.mutation, mode);
    if (typeof spec.food === 'number') {
      if (!Number.isInteger(spec.food) || spec.food < 0 || spec.food > RULES.maxFood) throw new RangeError('food must be an integer from 0 to 40');
      world._food.fill(spec.food);
    } else if (spec.food instanceof Uint8Array) {
      if (spec.food.length !== RULES.tileCount) throw new RangeError('food array must contain 9216 entries');
      for (const food of spec.food) if (food > RULES.maxFood) throw new RangeError('food values must be 0..40');
      world._food = new Uint8Array(spec.food);
    } else throw new TypeError('food must be a scalar or Uint8Array');
    const used = new Set<number>();
    founders.forEach((rawFounder, index) => {
      if (!plainOwnDataObject(rawFounder) || Reflect.ownKeys(rawFounder).length !== 5 || !['tile', 'heading', 'genome', 'age', 'store'].every((key) => Object.hasOwn(rawFounder, key))) {
        throw new TypeError('each fixture founder must contain exactly tile, heading, genome, age, and store');
      }
      const founder = rawFounder as Record<string, unknown>;
      const tile = founder.tile, heading = founder.heading, age = founder.age, store = founder.store;
      if (typeof tile !== 'number' || !Number.isSafeInteger(tile) || tile < 0 || tile >= RULES.tileCount || used.has(tile)) throw new RangeError('founder tiles must be unique valid tile indices');
      if (typeof heading !== 'number') throw new RangeError('founder heading must be 0..3');
      assertDirection(heading);
      if (typeof age !== 'number' || !Number.isSafeInteger(age) || age < 0 || age >= RULES.maxAge) throw new RangeError('founder age must be from 0 to 599');
      if (typeof store !== 'number' || !Number.isSafeInteger(store) || store < 0 || store > RULES.storeCap) throw new RangeError('founder store must be from 0 to 160');
      used.add(tile);
      world.addFounder(tile, heading, validateGenome(founder.genome), age, store, index % 3);
    });
    world.finishInitialization();
    return world;
  }

  private supplyFood(): void {
    const pulse = this.pulseCount;
    const targetCount = this._foodTargets.length;
    const pulseBudget = this._mode === 'original' ? RULES.tileCount : SCARCE_PULSE_BUDGET;
    const rotation = this.seed % targetCount;
    for (let j = 0; j < pulseBudget; j++) {
      const targetIndex = this._mode === 'original'
        ? j
        : ((pulse * SCARCE_PULSE_BUDGET + j) * TARGET_STRIDE + rotation) % targetCount;
      const tile = this._mode === 'moving-band'
        ? movingBandPulseTargetTile(pulse, j, this.seed, this._tick)
        : this._mode === 'split-band'
          ? splitBandPulseTargetTile(pulse, j, this.seed)
        : this._foodTargets[targetIndex];
      this.offered++;
      if (this._food[tile] < RULES.maxFood) {
        this._food[tile]++;
        this.supplied++;
      } else {
        this.overflow++;
      }
    }
    this.pulseCount++;
  }
  private feed(organism: MutableOrganism): void {
    for (const cell of organism.cells) {
      if (organism.store >= RULES.storeCap) break;
      const amount = Math.min(RULES.absorbPerCell, RULES.storeCap - organism.store, this._food[cell.tile]);
      this._food[cell.tile] -= amount;
      organism.store += amount;
    }
  }
  private grow(organism: MutableOrganism): void {
    while (organism.growthCursor < organism.growthQueue.length) {
      const attempt = organism.growthQueue[organism.growthCursor++];
      if (this._occupancy[wrappedNeighbor(organism.cells[attempt.parentCell].tile, attempt.direction)] !== 0) continue;
      const parent = organism.cells[attempt.parentCell];
      const tile = wrappedNeighbor(parent.tile, attempt.direction);
      organism.store -= RULES.growthCost;
      const index = organism.cells.length;
      const cell: MutableCell = { tile, heading: attempt.direction, depth: parent.depth + 1 };
      organism.cells.push(cell);
      this.counters.growths++;
      this._occupancy[tile] = organism.id;
      for (const direction of developmentDirections(organism.genome, cell.heading, cell.depth)) {
        organism.growthQueue.push({ parentCell: index, direction });
      }
      return;
    }
  }
  private reproduce(parent: MutableOrganism): MutableOrganism | null {
    let tile: number | null = null;
    for (let i = 0; i < RULES.birthPlacementAttempts; i++) {
      const dx = integerDraw(this.ecology, RULES.birthPlacementRadius * 2 + 1) - RULES.birthPlacementRadius;
      const dy = integerDraw(this.ecology, RULES.birthPlacementRadius * 2 + 1) - RULES.birthPlacementRadius;
      const root = parent.cells[0].tile;
      const x = (root % RULES.width + dx + RULES.width) % RULES.width;
      const y = (Math.floor(root / RULES.width) + dy + RULES.height) % RULES.height;
      const candidate = y * RULES.width + x;
      if (this._occupancy[candidate] === 0) { tile = candidate; break; }
    }
    if (tile === null) { this.counters.blockedSpaceBirths++; return null; }
    const heading = integerDraw(this.ecology, 4) as DevelopmentDirection;
    this.lastMutation = null;
    const childGenome = this.mutate ? this.mutateGenome(parent.genome) : copyGenome(parent.genome);
    parent.store -= RULES.reproductionCost;
    parent.births++;
    this.counters.births++;
    const child = this.makeOrganism({ id: this.nextID++, parentID: parent.id, family: parent.family, generation: parent.generation + 1,
      age: 0, store: RULES.newbornStore, genome: childGenome, tile, heading });
    this._occupancy[tile] = child.id; // Reserve now; the child enters `living` only after the parent loop.
    this.nodes.push({ id: child.id, parentID: parent.id, family: child.family, generation: child.generation, birthTick: this._tick,
      genome: copyGenome(childGenome), mutation: this.lastMutation, deathTick: null, deathCause: null });
    this.pruneLineage();
    return child;
  }
  private lastMutation: GenomeMutation | null = null;
  private get mutate(): boolean { return this.mutation; }
  private mutateGenome(parent: DevelopmentGenome): DevelopmentGenome {
    this.lastMutation = null;
    if (this.mutationRandom() >= RULES.mutationRate) return copyGenome(parent);
    this.counters.attemptedMutations++;
    const field = GENES[integerDraw(this.mutationRandom, GENES.length)];
    const sign = this.mutationRandom() < 0.5 ? -1 : 1;
    const [min, max] = GENE_BOUNDS[field];
    const from = parent[field];
    const to = Math.max(min, Math.min(max, from + sign));
    if (to === from) return copyGenome(parent);
    this.counters.effectiveMutations++;
    this.lastMutation = Object.freeze({ field, from, to });
    return validateGenome({ ...parent, [field]: to });
  }
  private remove(organism: MutableOrganism, cause: 'starvation' | 'age'): void {
    const idx = this.living.indexOf(organism);
    if (idx < 0) return;
    this.living.splice(idx, 1);
    for (const cell of organism.cells) this._occupancy[cell.tile] = 0;
    this.deathLoss += organism.store + RULES.structurePerCell * organism.cells.length;
    organism.store = 0;
    this.counters.deaths++;
    const node = this.nodes.find((n) => n.id === organism.id);
    if (node) { node.deathTick = this._tick; node.deathCause = cause; }
    this.pruneLineage();
  }
  private pruneLineage(): void {
    while (this.nodes.length > RULES.maxLineage) {
      const livingIDs = new Set(this.living.map((o) => o.id));
      const index = this.nodes.findIndex((n) => n.parentID !== null && n.deathTick !== null && !livingIDs.has(n.id));
      if (index < 0) return;
      this.nodes.splice(index, 1);
      this.droppedNodes++;
    }
  }
  private sumFood(): number { let sum = 0; for (const f of this._food) sum += f; return sum; }
  private sumBodyEnergy(): number { return this.living.reduce((sum, o) => sum + o.store + RULES.structurePerCell * o.cells.length, 0); }
  private computeLedger(): DevelopmentLedger {
    const actual = this.sumFood() + this.sumBodyEnergy();
    const expected = this.initialEnergy + this.supplied - this.dissipated - this.deathLoss;
    return Object.freeze({ initialEnergy: this.initialEnergy, supplied: this.supplied, dissipated: this.dissipated, deathLoss: this.deathLoss,
      expected, actual, residual: actual - expected });
  }
  private makeCensus(): DevelopmentCensus {
    const familyCounts: [number, number, number] = [0, 0, 0];
    let cells = 0, totalEnergy = 0, maxGeneration = 0;
    const variants = new Set<string>();
    for (const organism of this.living) {
      familyCounts[organism.family]++;
      cells += organism.cells.length;
      totalEnergy += organism.store + RULES.structurePerCell * organism.cells.length;
      maxGeneration = Math.max(maxGeneration, organism.generation);
      variants.add(canonicalGenome(organism.genome));
    }
    const ledger = this.computeLedger();
    const blockedBirths = this.counters.blockedSpaceBirths + this.counters.blockedCapBirths;
    return Object.freeze({ tick: this._tick, population: this.living.length, cells, familyCounts: Object.freeze(familyCounts),
      births: this.counters.births, growths: this.counters.growths, deaths: this.counters.deaths, effectiveMutations: this.counters.effectiveMutations,
      attemptedMutations: this.counters.attemptedMutations, maxGeneration, totalCells: cells, totalEnergy,
      meanBodyCells: this.living.length ? cells / this.living.length : 0,
      meanEnergy: this.living.length ? totalEnergy / this.living.length : 0,
      blockedBirths, blockedSpaceBirths: this.counters.blockedSpaceBirths, blockedCapBirths: this.counters.blockedCapBirths,
      ledgerResidual: ledger.residual, genomeVariantCount: variants.size });
  }
  private recordHistory(force: boolean): void {
    const census = this.makeCensus();
    if (!force && this.samples[this.samples.length - 1]?.tick === census.tick) return;
    this.samples.push(census);
    if (this.samples.length > RULES.maxHistory) { this.samples.shift(); this.droppedSamples++; }
  }
  private assertSafeAccounting(): void {
    for (const value of [this._tick, this.supplied, this.dissipated, this.deathLoss, this.nextID,
      ...Object.values(this.counters)]) {
      if (!Number.isSafeInteger(value)) throw new RangeError('model counters exceeded safe integer bounds');
    }
  }
}

/** Create a validated fixture from copied food and one-cell founders; this is not a resume API. */
export function createDevelopmentFixture(spec: DevelopmentFixtureSpec): DevelopmentWorld { return DevelopmentWorld.createFixture(spec); }

/** Mode-aware fixture helper for focused hungry-shapes model checks. */
export function createHungryFixture(spec: DevelopmentFixtureSpec, mode: FoodMode = 'original'): DevelopmentWorld {
  return DevelopmentWorld.createFixture(spec, mode);
}

/** The isolated copy's public world name; DevelopmentWorld remains available for fixture compatibility. */
export { DevelopmentWorld as HungryWorld };
