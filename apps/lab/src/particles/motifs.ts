import { RULES, ParticleWorld, recipeForPreset, type Census, type ParticleEnvironment, type ParticleRecipe } from './model.ts';
import { buildOccupancyHistogram, occupiedSpatialBins, totalVariationDistance, type OccupancyHistogram } from './motif-observers.ts';

export const GRAMMAR_VERSION = 1 as const;
export const MOTIF_SAMPLE_EVERY = 100;
export const MOTIF_HISTORY_LIMIT = 61;

export type MotifInteraction = 'chase' | 'gather';
export type MotifCoordination = 'independent' | 'aligned';
export type MotifHabitat = 'still' | 'travelling' | 'seasonal';

/** The complete version 1 grammar sentence. It has no optional or implied fields. */
export interface MotifSentence {
  interaction: MotifInteraction;
  coordination: MotifCoordination;
  habitat: MotifHabitat;
}

export interface CompiledMotif {
  readonly version: typeof GRAMMAR_VERSION;
  readonly id: string;
  readonly title: string;
  readonly sentence: Readonly<MotifSentence>;
  readonly recipe: ParticleRecipe;
  readonly environment: ParticleEnvironment;
  readonly explanation: string;
}

export interface MotifSample {
  readonly tick: number;
  readonly census: Readonly<Census>;
  readonly histogram: OccupancyHistogram;
  readonly occupiedBins: number;
  /** Total variation from the preceding scheduled sample; null at tick zero. */
  readonly textureChange: number | null;
}

export interface MotifWorldObservation {
  readonly kind: 'motif-world-observation';
  readonly description: string;
  readonly version: typeof GRAMMAR_VERSION;
  readonly sentence: Readonly<MotifSentence>;
  readonly motif: Readonly<Pick<CompiledMotif, 'id' | 'title' | 'explanation'>>;
  readonly tick: number;
  readonly extinctionTick: number | null;
  readonly current: Readonly<Census>;
  readonly base: ReturnType<ParticleWorld['snapshot']>;
  readonly sampledObservations: readonly MotifSample[];
  readonly droppedSamples: number;
}

const interactions = ['chase', 'gather'] as const;
const coordinations = ['independent', 'aligned'] as const;
const habitats = ['still', 'travelling', 'seasonal'] as const;

const display = (value: string) => value[0].toUpperCase() + value.slice(1);

function copySentence(sentence: MotifSentence): Readonly<MotifSentence> {
  return Object.freeze({
    interaction: sentence.interaction,
    coordination: sentence.coordination,
    habitat: sentence.habitat,
  });
}

function validateSentence(input: unknown): MotifSentence {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new Error('Motif sentence must be a plain object');
  }
  const keys = Reflect.ownKeys(input);
  const required = ['interaction', 'coordination', 'habitat'];
  if (keys.length !== required.length || keys.some(key => typeof key !== 'string' || !required.includes(key))) {
    throw new Error('Motif sentence must have exactly interaction, coordination, and habitat fields');
  }
  for (const key of required) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error(`Motif sentence field ${key} must be an enumerable data property`);
    }
  }
  const value = input as Record<string, unknown>;
  if (!(interactions as readonly unknown[]).includes(value.interaction)) throw new Error('Unknown motif interaction');
  if (!(coordinations as readonly unknown[]).includes(value.coordination)) throw new Error('Unknown motif coordination');
  if (!(habitats as readonly unknown[]).includes(value.habitat)) throw new Error('Unknown motif habitat');
  return { interaction: value.interaction as MotifInteraction, coordination: value.coordination as MotifCoordination, habitat: value.habitat as MotifHabitat };
}

function compiledRecipe(sentence: MotifSentence): ParticleRecipe {
  const source = recipeForPreset(sentence.interaction === 'chase' ? 'pursuit' : 'flocks');
  const recipe = {
    rows: source.rows.map(row => [...row]),
    alignment: sentence.coordination === 'aligned' ? .12 : 0,
    foodRenewal: RULES.foodRenewal,
  };
  return Object.freeze({ ...recipe, rows: Object.freeze(recipe.rows.map(row => Object.freeze(row))) as unknown as number[][] });
}

function compiledEnvironment(habitat: MotifHabitat): ParticleEnvironment {
  if (habitat === 'still') return Object.freeze({ kind: 'still' });
  if (habitat === 'travelling') return Object.freeze({ kind: 'travelling', speed: .00025 });
  return Object.freeze({ kind: 'seasonal', period: 600 });
}

/** Compile one exact grammar sentence into a copied, immutable world recipe. */
export function compileMotif(sentence: unknown, version: number = GRAMMAR_VERSION): CompiledMotif {
  if (version !== GRAMMAR_VERSION) throw new Error(`Unsupported motif grammar version: ${version}`);
  const checked = validateSentence(sentence);
  const frozenSentence = copySentence(checked);
  const id = `${checked.interaction}-${checked.coordination}-${checked.habitat}`;
  const preset = checked.interaction === 'chase' ? 'pursuit' : 'flocks';
  const coordination = checked.coordination === 'aligned' ? 'aligned' : 'independent';
  const habitat = checked.habitat === 'travelling' ? 'travelling at speed 0.00025' : checked.habitat === 'seasonal' ? 'seasonal with period 600' : 'still';
  return Object.freeze({
    version: GRAMMAR_VERSION,
    id,
    title: `${display(checked.interaction)} · ${display(checked.coordination)} · ${display(checked.habitat)}`,
    sentence: frozenSentence,
    recipe: compiledRecipe(checked),
    environment: compiledEnvironment(checked.habitat),
    explanation: `Initial composition: ${checked.interaction} attraction from the ${preset} rows, ${coordination} coordination, ${habitat} habitat, and food renewal ${RULES.foodRenewal}. Particles can inherit changed attraction rows; chase does not mean predation.`,
  });
}

/** All twelve grammar sentences in their canonical deterministic order. */
export function motifCatalog(): readonly CompiledMotif[] {
  const catalog = interactions.flatMap(interaction => coordinations.flatMap(coordination => habitats.map(habitat =>
    compileMotif({ interaction, coordination, habitat }),
  )));
  return Object.freeze(catalog);
}

function copyCensus(census: Census): Readonly<Census> {
  return Object.freeze({ ...census, counts: Object.freeze([...census.counts]) as unknown as [number, number, number] });
}

function copySample(sample: MotifSample): MotifSample {
  return Object.freeze({
    tick: sample.tick,
    census: copyCensus(sample.census as Census),
    histogram: Object.freeze({ population: sample.histogram.population, counts: Object.freeze([...sample.histogram.counts]) }),
    occupiedBins: sample.occupiedBins,
    textureChange: sample.textureChange,
  });
}

/**
 * A motif-facing owner around the existing particle model. It advances one base
 * tick at a time so exact extinction and observation cadence cannot be skipped.
 */
export class MotifWorld {
  readonly base: ParticleWorld;
  readonly motif: CompiledMotif;
  private readonly samples: MotifSample[] = [];
  private dropped = 0;
  private extinctAt: number | null = null;

  constructor(seed: number, motif: CompiledMotif | MotifSentence) {
    if (!motif || typeof motif !== 'object' || Object.getPrototypeOf(motif) !== Object.prototype) throw new Error('Motif must be a plain sentence or canonical compiled motif');
    if ('version' in motif || 'recipe' in motif || 'sentence' in motif) {
      const keys = ['version', 'id', 'title', 'sentence', 'recipe', 'environment', 'explanation'];
      if (Reflect.ownKeys(motif).length !== keys.length || keys.some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(motif, key);
        return !descriptor?.enumerable || !('value' in descriptor);
      })) throw new Error('Compiled motif must contain canonical data fields');
      const supplied = motif as CompiledMotif;
      const canonical = compileMotif(supplied.sentence, supplied.version);
      for (const key of keys as (keyof CompiledMotif)[]) {
        if (JSON.stringify(supplied[key]) !== JSON.stringify(canonical[key])) throw new Error(`Compiled motif ${key} differs from its sentence`);
      }
      this.motif = canonical;
    } else this.motif = compileMotif(motif);
    this.base = new ParticleWorld(seed, this.motif.sentence.interaction === 'chase' ? 'pursuit' : 'flocks', true, this.motif.recipe, this.motif.environment);
    this.recordSample();
  }

  get sentence(): Readonly<MotifSentence> { return this.motif.sentence; }
  get tick(): number { return this.base.tick; }
  get extinctionTick(): number | null { return this.extinctAt; }
  get droppedSamples(): number { return this.dropped; }
  get sampledObservations(): readonly MotifSample[] { return Object.freeze(this.samples.map(copySample)); }

  step(count = 1): void {
    if (!Number.isInteger(count) || count < 0 || count > 100000) throw new Error('Tick count must be an integer from 0 to 100000');
    for (let i = 0; i < count && this.extinctAt === null; i++) {
      this.base.step(1);
      if (this.base.particles.length === 0) this.extinctAt = this.base.tick;
      if (this.base.tick % MOTIF_SAMPLE_EVERY === 0 || this.extinctAt !== null) this.recordSample();
    }
  }

  observation(): MotifWorldObservation {
    return Object.freeze({
      kind: 'motif-world-observation',
      description: 'Observation only, not a resumable checkpoint. Grammar describes initial composition; individuals may inherit changed attraction rows.',
      version: this.motif.version,
      sentence: copySentence(this.motif.sentence as MotifSentence),
      motif: Object.freeze({ id: this.motif.id, title: this.motif.title, explanation: this.motif.explanation }),
      tick: this.tick,
      extinctionTick: this.extinctAt,
      current: copyCensus(this.base.census()),
      base: this.base.snapshot(),
      sampledObservations: this.sampledObservations,
      droppedSamples: this.dropped,
    });
  }

  private recordSample(): void {
    const census = this.base.census();
    const histogram = buildOccupancyHistogram(this.base.particles);
    const prior = this.samples[this.samples.length - 1];
    const sample: MotifSample = Object.freeze({
      tick: this.base.tick,
      census: copyCensus(census),
      histogram,
      occupiedBins: occupiedSpatialBins(histogram),
      textureChange: prior ? totalVariationDistance(histogram, prior.histogram) : null,
    });
    this.samples.push(sample);
    if (this.samples.length > MOTIF_HISTORY_LIMIT) { this.samples.shift(); this.dropped++; }
  }
}

