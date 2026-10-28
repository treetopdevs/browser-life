/** A seeded, open-energy field toy. Values are Float64 proxies, not matter or organisms. */
export const BOUNDARY_MODES = ['smooth', 'walls', 'threshold', 'both'] as const;
export type BoundaryMode = (typeof BOUNDARY_MODES)[number];

export const BOUNDARY_RULES = Object.freeze({
  version: 1,
  size: 64,
  cells: 64 * 64,
  dt: 0.25,
  biomassDiffusion: 0.16,
  nutrientDiffusion: 0.30,
  wallThreshold: 0.55,
  biomassFloor: 0.0001,
  activeThreshold: 0.35,
  componentMinSize: 4,
  initialBlobs: 6,
  initialBackground: 0.02,
  initialPeak: 0.75,
  nutrientInitial: 0.8,
  sampleEvery: 100,
  historyMax: 300,
  maxStepCount: 100000,
  smoothGrowth: 0.20,
  thresholdGrowth: 0.70,
  biomassDecay: 0.015,
  nutrientUptake: 0.10,
  wallReinforcement: 0.80,
  wallDecay: 0.01,
  diffusionResidualMax: 1e-10,
  clampAdjustmentMax: 1e-10,
  cumulativeBalanceMax: 1e-6,
});

export interface BoundaryFields {
  density: Float64Array;
  nutrient: Float64Array;
  wall: Float64Array;
}

export interface BoundaryStepAccounting {
  densityBefore: number;
  densityReaction: number;
  densityDiffusionResidual: number;
  nutrientDiffusionResidual: number;
  densityClampAdjustment: number;
  densityFloorLoss: number;
  densityAfter: number;
}

export interface BoundaryAccounting {
  initialDensity: number;
  densityReaction: number;
  densityDiffusionResidual: number;
  nutrientDiffusionResidual: number;
  densityClampAdjustment: number;
  densityFloorLoss: number;
  expectedDensity: number;
  actualDensity: number;
  residual: number;
  maxAbsDensityDiffusionResidual: number;
  maxAbsNutrientDiffusionResidual: number;
  maxAbsClampAdjustment: number;
}

export interface BoundarySampledChange {
  fromTick: number;
  toTick: number;
  meanAbsDelta: number;
  maskFlipFraction: number;
}

export interface BoundaryCensus {
  tick: number;
  densityTotal: number;
  nutrientMean: number;
  activeCellFraction: number;
  components: number;
  tinyComponents: number;
  largestComponent: number;
  neighborContrast: number;
  blockedEdgeFraction: number;
  sampledChange: BoundarySampledChange | null;
}

export interface BoundarySnapshot {
  kind: 'boundary-field-observation';
  description: string;
  rules: typeof BOUNDARY_RULES;
  seed: number;
  mode: BoundaryMode;
  tick: number;
  extinctionTick: number | null;
  fields: BoundaryFields;
  accounting: BoundaryAccounting;
  history: BoundaryCensus[];
  droppedSamples: number;
}

export interface ComponentStats {
  activeCellFraction: number;
  components: number;
  tinyComponents: number;
  largestComponent: number;
  maskFlipFraction: number | null;
}

const clamp = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, value));
const wallEnabled = (mode: BoundaryMode): boolean => mode === 'walls' || mode === 'both';
const thresholdEnabled = (mode: BoundaryMode): boolean => mode === 'threshold' || mode === 'both';
const isMode = (value: unknown): value is BoundaryMode => BOUNDARY_MODES.includes(value as BoundaryMode);

function assertSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 1 || size > 256) throw new Error('Size must be an integer from 1 to 256');
}

function validateFields(fields: BoundaryFields, size: number): BoundaryFields {
  const length = size * size;
  for (const name of ['density', 'nutrient', 'wall'] as const) {
    const values = fields?.[name];
    if (!(values instanceof Float64Array) || values.length !== length) throw new Error(`${name} must be a Float64Array with ${length} values`);
    for (const value of values) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} values must be finite and within 0 and 1`);
  }
  return { density: fields.density.slice(), nutrient: fields.nutrient.slice(), wall: fields.wall.slice() };
}

function neighborIndices(index: number, size: number): [number, number, number, number] {
  const x = index % size, y = Math.floor(index / size);
  return [y * size + (x + 1) % size, ((y + 1) % size) * size + x,
    y * size + (x + size - 1) % size, ((y + size - 1) % size) * size + x];
}

/** Pure synchronous update seam; it clones and never mutates supplied fields. */
export function stepFields(input: BoundaryFields, mode: BoundaryMode, size: number = BOUNDARY_RULES.size): { fields: BoundaryFields; accounting: BoundaryStepAccounting } {
  assertSize(size);
  if (!isMode(mode)) throw new Error('Unknown boundary mode');
  const old = validateFields(input, size);
  const length = size * size, { dt } = BOUNDARY_RULES;
  const densityFlux = new Float64Array(length), nutrientFlux = new Float64Array(length);
  // Each periodic east/south edge is evaluated once. Equal and opposite edge fluxes
  // preserve the unique-edge topology even when the field is not directionally symmetric.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = y * size + x;
    for (const b of [y * size + (x + 1) % size, ((y + 1) % size) * size + x]) {
      const gate = wallEnabled(mode) && (old.wall[a] >= BOUNDARY_RULES.wallThreshold || old.wall[b] >= BOUNDARY_RULES.wallThreshold);
      const nutrientTransfer = dt * BOUNDARY_RULES.nutrientDiffusion * (old.nutrient[a] - old.nutrient[b]);
      nutrientFlux[a] -= nutrientTransfer;
      nutrientFlux[b] += nutrientTransfer;
      if (!gate) {
        const biomassTransfer = dt * BOUNDARY_RULES.biomassDiffusion * (old.density[a] - old.density[b]);
        densityFlux[a] -= biomassTransfer;
        densityFlux[b] += biomassTransfer;
      }
    }
  }
  const density = new Float64Array(length), nutrient = new Float64Array(length);
  // Wall-disabled recipes keep W exactly zero, even if a caller supplies a stale field.
  const wall = wallEnabled(mode) ? old.wall.slice() : new Float64Array(length);
  let densityBefore = 0, densityReaction = 0, densityDiffusionResidual = 0, nutrientDiffusionResidual = 0;
  let densityClampAdjustment = 0, densityFloorLoss = 0, densityAfter = 0;
  for (let i = 0; i < length; i++) {
    const b = old.density[i], n = old.nutrient[i];
    const neighbors = neighborIndices(i, size);
    const maxContrast = Math.max(...neighbors.map(j => Math.abs(b - old.density[j])));
    const reactionRate = thresholdEnabled(mode)
      ? BOUNDARY_RULES.thresholdGrowth * b * (b - 0.25) * (1 - b) * n - BOUNDARY_RULES.biomassDecay * b
      : BOUNDARY_RULES.smoothGrowth * b * n * (1 - b) - BOUNDARY_RULES.biomassDecay * b;
    const reaction = dt * reactionRate;
    const nutrientReaction = dt * (0.01 + 0.05 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (i % size) / BOUNDARY_RULES.size) * Math.cos(2 * Math.PI * Math.floor(i / size) / BOUNDARY_RULES.size))) * (1 - n)
      - dt * BOUNDARY_RULES.nutrientUptake * b * n;
    densityBefore += b;
    densityReaction += reaction;
    densityDiffusionResidual += densityFlux[i];
    nutrientDiffusionResidual += nutrientFlux[i];
    const preClamp = b + reaction + densityFlux[i];
    const clamped = clamp(preClamp);
    densityClampAdjustment += clamped - preClamp;
    if (clamped < BOUNDARY_RULES.biomassFloor) {
      densityFloorLoss += clamped;
      density[i] = 0;
    } else density[i] = clamped;
    nutrient[i] = clamp(n + nutrientReaction + nutrientFlux[i]);
    if (wallEnabled(mode)) wall[i] = clamp(old.wall[i] + dt * (BOUNDARY_RULES.wallReinforcement * b * maxContrast - BOUNDARY_RULES.wallDecay * old.wall[i]));
    densityAfter += density[i];
  }
  return {
    fields: { density, nutrient, wall },
    accounting: { densityBefore, densityReaction, densityDiffusionResidual, nutrientDiffusionResidual, densityClampAdjustment, densityFloorLoss, densityAfter },
  };
}

/** Four-connected periodic component counts on the >= active-threshold mask. */
export function componentStats(densityInput: Float64Array, previousInput?: Float64Array, size: number = BOUNDARY_RULES.size): ComponentStats {
  assertSize(size);
  const length = size * size;
  if (!(densityInput instanceof Float64Array) || densityInput.length !== length) throw new Error(`density must be a Float64Array with ${length} values`);
  for (const value of densityInput) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('density values must be finite and within 0 and 1');
  if (previousInput !== undefined && (!(previousInput instanceof Float64Array) || previousInput.length !== length || Array.from(previousInput).some(v => !Number.isFinite(v) || v < 0 || v > 1))) throw new Error('previous density must be a matching Float64Array within 0 and 1');
  const active = new Uint8Array(length), visited = new Uint8Array(length);
  let activeCount = 0, flips = 0;
  for (let i = 0; i < length; i++) {
    active[i] = densityInput[i] >= BOUNDARY_RULES.activeThreshold ? 1 : 0;
    activeCount += active[i];
    if (previousInput && active[i] !== (previousInput[i] >= BOUNDARY_RULES.activeThreshold ? 1 : 0)) flips++;
  }
  let components = 0, tinyComponents = 0, largestComponent = 0;
  const queue = new Int32Array(length);
  for (let seed = 0; seed < length; seed++) {
    if (!active[seed] || visited[seed]) continue;
    let head = 0, tail = 0;
    queue[tail++] = seed; visited[seed] = 1;
    while (head < tail) {
      const i = queue[head++];
      for (const j of neighborIndices(i, size)) if (active[j] && !visited[j]) { visited[j] = 1; queue[tail++] = j; }
    }
    if (tail >= BOUNDARY_RULES.componentMinSize) { components++; largestComponent = Math.max(largestComponent, tail); }
    else tinyComponents++;
  }
  return { activeCellFraction: activeCount / length, components, tinyComponents, largestComponent, maskFlipFraction: previousInput ? flips / length : null };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function initialFields(seed: number, size: number): BoundaryFields {
  const random = mulberry32(seed), blobs = Array.from({ length: BOUNDARY_RULES.initialBlobs }, () => ({ x: size * random(), y: size * random(), r: 3 + 2 * random() }));
  const density = new Float64Array(size * size), nutrient = new Float64Array(size * size).fill(BOUNDARY_RULES.nutrientInitial), wall = new Float64Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let value = BOUNDARY_RULES.initialBackground;
    for (const blob of blobs) {
      const dx = Math.abs(x - blob.x), dy = Math.abs(y - blob.y);
      const tx = Math.min(dx, size - dx), ty = Math.min(dy, size - dy);
      value += BOUNDARY_RULES.initialPeak * Math.exp(-(tx * tx + ty * ty) / (2 * blob.r * blob.r));
    }
    value += random() * 0.01;
    density[y * size + x] = Math.min(0.95, value);
  }
  return { density, nutrient, wall };
}

function sum(values: Float64Array): number { let total = 0; for (const value of values) total += value; return total; }

export class BoundaryWorld {
  readonly seed: number;
  readonly mode: BoundaryMode;
  readonly size: number;
  private fieldsValue: BoundaryFields;
  private tickValue = 0;
  private extinctionTickValue: number | null = null;
  private historyValue: BoundaryCensus[] = [];
  private droppedSamplesValue = 0;
  private previousSampleDensity: Float64Array;
  private previousSampleTick = 0;
  private sampledChangeValue: BoundarySampledChange | null = null;
  private accountingValue: BoundaryAccounting;

  constructor(seed: number, mode: BoundaryMode) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer');
    if (!isMode(mode)) throw new Error('Unknown boundary mode');
    this.seed = seed; this.mode = mode; this.size = BOUNDARY_RULES.size;
    this.fieldsValue = initialFields(seed, this.size);
    const initialDensity = sum(this.fieldsValue.density);
    this.accountingValue = { initialDensity, densityReaction: 0, densityDiffusionResidual: 0, nutrientDiffusionResidual: 0,
      densityClampAdjustment: 0, densityFloorLoss: 0, expectedDensity: initialDensity, actualDensity: initialDensity, residual: 0,
      maxAbsDensityDiffusionResidual: 0, maxAbsNutrientDiffusionResidual: 0, maxAbsClampAdjustment: 0 };
    this.previousSampleDensity = this.fieldsValue.density.slice();
    this.recordSample();
  }

  get tick(): number { return this.tickValue; }
  get extinctionTick(): number | null { return this.extinctionTickValue; }
  get density(): Float64Array { return this.fieldsValue.density.slice(); }
  get nutrient(): Float64Array { return this.fieldsValue.nutrient.slice(); }
  get wall(): Float64Array { return this.fieldsValue.wall.slice(); }
  get history(): BoundaryCensus[] { return structuredClone(this.historyValue); }
  get droppedSamples(): number { return this.droppedSamplesValue; }
  get accounting(): BoundaryAccounting { return { ...this.accountingValue }; }

  step(count = 1): void {
    if (!Number.isInteger(count) || count < 0 || count > BOUNDARY_RULES.maxStepCount) throw new Error('Tick count must be an integer from 0 to 100000');
    for (let n = 0; n < count && this.extinctionTickValue === null; n++) this.advance();
  }

  private advance(): void {
    this.tickValue++;
    const result = stepFields(this.fieldsValue, this.mode, this.size);
    this.fieldsValue = result.fields;
    const part = result.accounting, accounting = this.accountingValue;
    accounting.densityReaction += part.densityReaction;
    accounting.densityDiffusionResidual += part.densityDiffusionResidual;
    accounting.nutrientDiffusionResidual += part.nutrientDiffusionResidual;
    accounting.densityClampAdjustment += part.densityClampAdjustment;
    accounting.densityFloorLoss += part.densityFloorLoss;
    accounting.maxAbsDensityDiffusionResidual = Math.max(accounting.maxAbsDensityDiffusionResidual, Math.abs(part.densityDiffusionResidual));
    accounting.maxAbsNutrientDiffusionResidual = Math.max(accounting.maxAbsNutrientDiffusionResidual, Math.abs(part.nutrientDiffusionResidual));
    accounting.maxAbsClampAdjustment = Math.max(accounting.maxAbsClampAdjustment, Math.abs(part.densityClampAdjustment));
    accounting.expectedDensity = accounting.initialDensity + accounting.densityReaction + accounting.densityDiffusionResidual
      + accounting.densityClampAdjustment - accounting.densityFloorLoss;
    accounting.actualDensity = sum(this.fieldsValue.density);
    accounting.residual = accounting.actualDensity - accounting.expectedDensity;
    if (accounting.maxAbsDensityDiffusionResidual > BOUNDARY_RULES.diffusionResidualMax || accounting.maxAbsNutrientDiffusionResidual > BOUNDARY_RULES.diffusionResidualMax) throw new Error('Diffusion residual exceeded the per-tick bound');
    if (accounting.maxAbsClampAdjustment > BOUNDARY_RULES.clampAdjustmentMax) throw new Error('Density clamp adjustment exceeded the per-tick bound');
    if (Math.abs(accounting.residual) > BOUNDARY_RULES.cumulativeBalanceMax) throw new Error('Density accounting residual exceeded the cumulative bound');
    if (sum(this.fieldsValue.density) === 0) {
      this.extinctionTickValue = this.tickValue;
      this.finishSample();
    } else if (this.tickValue % BOUNDARY_RULES.sampleEvery === 0) this.finishSample();
  }

  private finishSample(): void {
    if (this.historyValue[this.historyValue.length - 1]?.tick === this.tickValue) return;
    const current = this.fieldsValue.density;
    let delta = 0;
    for (let i = 0; i < current.length; i++) delta += Math.abs(current[i] - this.previousSampleDensity[i]);
    this.sampledChangeValue = { fromTick: this.previousSampleTick, toTick: this.tickValue, meanAbsDelta: delta / current.length,
      maskFlipFraction: componentStats(current, this.previousSampleDensity, this.size).maskFlipFraction! };
    this.previousSampleDensity = current.slice(); this.previousSampleTick = this.tickValue;
    this.recordSample();
  }

  private recordSample(): void {
    this.historyValue.push(this.census());
    if (this.historyValue.length > BOUNDARY_RULES.historyMax) { this.historyValue.shift(); this.droppedSamplesValue++; }
  }

  census(): BoundaryCensus {
    const density = this.fieldsValue.density, nutrient = this.fieldsValue.nutrient, wall = this.fieldsValue.wall;
    const stats = componentStats(density, undefined, this.size);
    let nutrientTotal = 0, contrast = 0, blocked = 0;
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      const a = y * this.size + x;
      nutrientTotal += nutrient[a];
      for (const b of [y * this.size + (x + 1) % this.size, ((y + 1) % this.size) * this.size + x]) {
        contrast += Math.abs(density[a] - density[b]);
        if (wallEnabled(this.mode) && (wall[a] >= BOUNDARY_RULES.wallThreshold || wall[b] >= BOUNDARY_RULES.wallThreshold)) blocked++;
      }
    }
    return { tick: this.tickValue, densityTotal: sum(density), nutrientMean: nutrientTotal / density.length,
      activeCellFraction: stats.activeCellFraction, components: stats.components, tinyComponents: stats.tinyComponents,
      largestComponent: stats.largestComponent, neighborContrast: contrast / (2 * density.length),
      blockedEdgeFraction: blocked / (2 * density.length), sampledChange: this.sampledChangeValue ? { ...this.sampledChangeValue } : null };
  }

  snapshot(): BoundarySnapshot {
    return structuredClone({ kind: 'boundary-field-observation' as const,
      description: 'Open-energy Float64 field proxies on a periodic grid. No particles, organism identities, heredity, or resumable checkpoint.',
      rules: BOUNDARY_RULES, seed: this.seed, mode: this.mode, tick: this.tickValue, extinctionTick: this.extinctionTickValue,
      fields: this.fieldsValue, accounting: this.accountingValue, history: this.historyValue, droppedSamples: this.droppedSamplesValue });
  }
}
