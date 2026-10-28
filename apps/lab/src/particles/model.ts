/** An engineered, open-energy toy world. Float64 replay is promised within one runtime only. */
export type PresetId = 'flocks' | 'pursuit' | 'colonies';
export type Family = 0 | 1 | 2;
export interface Particle { id: number; family: Family; x: number; y: number; vx: number; vy: number; energy: number; age: number; lifespan: number; generation: number; traits: number[] }
export interface FoodPatch { x: number; y: number; radius: number; amount: number }
export interface Census { tick: number; population: number; counts: [number, number, number]; births: number; deaths: number; mutations: number; blockedBirths: number; maxGeneration: number; meanSpeed: number; traitSpread: number; particleEnergy: number; foodEnergy: number }
export type ParticleEnvironment = { kind: 'still' } | { kind: 'travelling'; speed: 0.0001 | 0.00025 } | { kind: 'seasonal'; period: 600 | 1800 };
export function validateEnvironment(input: unknown): ParticleEnvironment {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Environment must be an object');
  const value = input as Record<string, unknown>;
  const keys=Reflect.ownKeys(value);
  const kind = value.kind;
  if (kind === 'still' && keys.length === 1 && keys[0] === 'kind') return Object.freeze({ kind: 'still' });
  if (kind === 'travelling' && keys.length === 2 && keys.every(key=>typeof key==='string') && keys.includes('kind') && keys.includes('speed')) {
    const speed = value.speed;
    if (speed === 0.0001 || speed === 0.00025) return Object.freeze({ kind: 'travelling', speed });
  }
  if (kind === 'seasonal' && keys.length === 2 && keys.every(key=>typeof key==='string') && keys.includes('kind') && keys.includes('period')) {
    const period = value.period;
    if (period === 600 || period === 1800) return Object.freeze({ kind: 'seasonal', period });
  }
  throw new Error('Invalid particle environment');
}
function positiveStep(step: number): void {
  if (!Number.isSafeInteger(step) || step <= 0) throw new Error('Step must be a positive safe integer');
}
/** Return the seasonal phase applied at `step` and the first tick of the next phase. */
export function seasonalPhase(environment: ParticleEnvironment, step: number): { phase: number; nextChangeTick: number } | null {
  positiveStep(step);
  if (environment.kind !== 'seasonal') return null;
  const completedPhases = Math.floor((step - 1) / environment.period);
  return { phase: completedPhases % 3, nextChangeTick: (completedPhases + 1) * environment.period + 1 };
}
/** Seasonal renewal factor for one patch at a positive, one-based world step. */
export function renewalMultiplier(environment: ParticleEnvironment, step: number, patchIndex: number): number {
  positiveStep(step);
  if (!Number.isSafeInteger(patchIndex) || patchIndex < 0) throw new Error('Patch index must be a non-negative safe integer');
  if (environment.kind !== 'seasonal') return 1;
  const phase = Math.floor((step - 1) / environment.period) % 3;
  const multipliers = [1.75, 1, 0.25] as const;
  return multipliers[(Math.floor(patchIndex / 3) - phase + 3) % 3];
}
/** Move the fixed 3x3 patch field on a horizontal torus without changing its stock or geometry. */
export function moveFoodPatches(food: FoodPatch[], environment: ParticleEnvironment): void {
  if (environment.kind !== 'travelling') return;
  for (let i = 0; i < food.length; i++) {
    const direction = Math.floor(i / 3) % 2 === 0 ? 1 : -1;
    food[i].x = wrap(food[i].x + direction * environment.speed);
  }
}
export const RULES = Object.freeze({ version: 4, populationMax: 240, initialPopulation: 120, speedMax: .008, interactionRadius: .12, repulsionRadius: .018, force: .0012, drag: .92, foodCapacity: 35, foodRenewal: .65, uptake: .11, upkeep: .028, movementCost: 3, birthEnergy: 8, maxEnergy: 10, mutationChance: .18, mutationSize: .15, foodSeekingForce: .000035, foodPatchRadius: .18, foodPatchInitial: 30, initialEnergy: 4, initialVelocityRange: .004, initialAgeRange: 300, lifespanBase: 900, lifespanRange: 500, birthOffset: .025, sampleEvery: 10, historyMax: 300 });
export const PRESETS = [
  { id: 'flocks' as const, name: 'Flocks', description: 'Neighbours align and gather into moving family groups.', rows: [[.75,.15,.15],[.15,.75,.15],[.15,.15,.75]], alignment: .12 },
  { id: 'pursuit' as const, name: 'Pursuit', description: 'Each family chases one colour and flees another. Chasing does not eat particles.', rows: [[.2,.95,-.9],[-.9,.2,.95],[.95,-.9,.2]], alignment: 0 },
  { id: 'colonies' as const, name: 'Colonies', description: 'Strong family attraction and cross-family repulsion form separate clusters.', rows: [[1,-.6,-.6],[-.6,1,-.6],[-.6,-.6,1]], alignment: .015 },
] as const;
export interface ParticleRecipe { rows: number[][]; alignment: number; foodRenewal: number }
/** Reject malformed values rather than silently changing a saved recipe. */
export function validateRecipe(input: unknown): ParticleRecipe {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Recipe must be an object');
  const r = input as Record<string, unknown>;
  if (Object.keys(r).sort().join(',') !== 'alignment,foodRenewal,rows') throw new Error('Recipe has unexpected fields');
  if (!Array.isArray(r.rows) || r.rows.length !== 3 || !Array.from(r.rows).every(row => Array.isArray(row) && row.length === 3 && Array.from(row).every(v => typeof v === 'number' && Number.isFinite(v) && v >= -1 && v <= 1))) throw new Error('Attraction rows must be a finite 3 by 3 matrix within -1 and 1');
  if (typeof r.alignment !== 'number' || !Number.isFinite(r.alignment) || r.alignment < 0 || r.alignment > .2) throw new Error('Alignment must be between 0 and 0.2');
  if (typeof r.foodRenewal !== 'number' || !Number.isFinite(r.foodRenewal) || r.foodRenewal < .3 || r.foodRenewal > 1) throw new Error('Food renewal must be between 0.3 and 1');
  const recipe: ParticleRecipe = { rows: r.rows.map(row => [...row]), alignment: r.alignment, foodRenewal: r.foodRenewal };
  for (const row of recipe.rows) Object.freeze(row);
  Object.freeze(recipe.rows);
  return Object.freeze(recipe);
}
export function recipeForPreset(preset: PresetId): ParticleRecipe {
  const settings = PRESETS.find(p => p.id === preset);
  if (!settings) throw new Error('Unknown particle preset');
  return validateRecipe({ rows: settings.rows, alignment: settings.alignment, foodRenewal: RULES.foodRenewal });
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const torusDelta = (d: number) => d - Math.round(d);
const wrap = (n: number) => ((n % 1) + 1) % 1;
function stream(seed: number) { let state = seed >>> 0; return () => { state = (state + 0x6d2b79f5) >>> 0; let t = Math.imul(state ^ state >>> 15, state | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export class ParticleWorld {
  readonly seed: number;
  readonly preset: PresetId;
  readonly mutation: boolean;
  particles: Particle[] = [];
  readonly food: FoodPatch[] = [];
  readonly history: Census[] = [];
  readonly ledger = { initial: 0, renewed: 0, consumed: 0, dissipated: 0, deathLoss: 0 };
  tick = 0;
  births = 0;
  deaths = 0;
  mutations = 0;
  blockedBirths = 0;
  private nextId = 0;
  private readonly random: () => number;
  private readonly mutationRandom: () => number;
  readonly recipe: ParticleRecipe;
  readonly environment: ParticleEnvironment;

  constructor(seed: number, preset: PresetId = 'flocks', mutation = true, recipe?: ParticleRecipe, environment: ParticleEnvironment = { kind: 'still' }) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer');
    const settings = PRESETS.find(p => p.id === preset);
    if (!settings) throw new Error('Unknown particle preset');
    this.seed = seed; this.preset = preset; this.mutation = mutation; this.recipe = recipe === undefined ? recipeForPreset(preset) : validateRecipe(recipe); this.environment = validateEnvironment(environment);
    this.random = stream(seed ^ 0x83a9f214); this.mutationRandom = stream(seed ^ 0x1bd9237a);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) this.food.push({ x: (x + .5) / 3, y: (y + .5) / 3, radius: RULES.foodPatchRadius, amount: RULES.foodPatchInitial });
    for (let i = 0; i < RULES.initialPopulation; i++) {
      const family = (i % 3) as Family;
      this.particles.push({ id: this.nextId++, family, x: this.random(), y: this.random(), vx: (this.random() - .5) * RULES.initialVelocityRange, vy: (this.random() - .5) * RULES.initialVelocityRange, energy: RULES.initialEnergy, age: Math.floor(this.random() * RULES.initialAgeRange), lifespan: RULES.lifespanBase + Math.floor(this.random() * RULES.lifespanRange), generation: 0, traits: [...this.recipe.rows[family]] });
    }
    this.ledger.initial = this.particles.reduce((s,p) => s + p.energy,0) + this.food.reduce((s,p) => s + p.amount,0);
    this.history.push(this.census());
  }

  step(count = 1) {
    if (!Number.isInteger(count) || count < 0 || count > 100000) throw new Error('Tick count must be an integer from 0 to 100000');
    for (let step = 0; step < count && this.particles.length; step++) this.advance();
  }

  private advance() {
    this.tick++;
    moveFoodPatches(this.food, this.environment);
    for (let i = 0; i < this.food.length; i++) {
      const patch = this.food[i];
      const offered = this.environment.kind === 'seasonal' ? this.recipe.foodRenewal * renewalMultiplier(this.environment, this.tick, i) : this.recipe.foodRenewal;
      const renewed = Math.min(offered, RULES.foodCapacity - patch.amount);
      patch.amount += renewed; this.ledger.renewed += renewed;
    }
    const old = this.particles;
    const velocities: [number, number][] = [];
    for (let i = 0; i < old.length; i++) {
      const p = old[i]; let fx = 0, fy = 0, avx = 0, avy = 0, neighbours = 0;
      for (let j = 0; j < old.length; j++) {
        if (i === j) continue;
        const q = old[j], dx = torusDelta(q.x - p.x), dy = torusDelta(q.y - p.y), d2 = dx * dx + dy * dy;
        if (d2 >= RULES.interactionRadius ** 2 || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const force = d < RULES.repulsionRadius ? -2 * (1 - d / RULES.repulsionRadius) : p.traits[q.family] * (1 - (d - RULES.repulsionRadius) / (RULES.interactionRadius - RULES.repulsionRadius));
        fx += force * dx / d; fy += force * dy / d; avx += q.vx; avy += q.vy; neighbours++;
      }
      let vx = p.vx * RULES.drag, vy = p.vy * RULES.drag;
      if (neighbours) { vx += RULES.force * fx / Math.sqrt(neighbours) + this.recipe.alignment * (avx / neighbours - p.vx); vy += RULES.force * fy / Math.sqrt(neighbours) + this.recipe.alignment * (avy / neighbours - p.vy); }
      // A deliberately supplied weak food-seeking force, identical for all families.
      let nearest = this.food[0], distance = Infinity;
      for (const patch of this.food) { const dx = torusDelta(patch.x-p.x), dy = torusDelta(patch.y-p.y), d2 = dx*dx+dy*dy; if (d2 < distance) { distance=d2; nearest=patch; } }
      const d = Math.sqrt(distance);
      if (d > .001) { vx += RULES.foodSeekingForce * torusDelta(nearest.x-p.x)/d; vy += RULES.foodSeekingForce * torusDelta(nearest.y-p.y)/d; }
      const speed = Math.hypot(vx,vy); if (speed > RULES.speedMax) { vx *= RULES.speedMax/speed; vy *= RULES.speedMax/speed; }
      velocities.push([vx,vy]);
    }
    const survivors: Particle[] = [], newborns: Particle[] = [];
    // Adults stay in ascending ID order. Food competition and cap decisions use that fixed order.
    for (let i = 0; i < old.length; i++) {
      const p = old[i]; [p.vx,p.vy] = velocities[i]; p.x=wrap(p.x+p.vx); p.y=wrap(p.y+p.vy); p.age++;
      for (const patch of this.food) {
        const dx=torusDelta(patch.x-p.x),dy=torusDelta(patch.y-p.y);
        if (dx*dx+dy*dy <= patch.radius*patch.radius) { const eaten=Math.min(patch.amount,RULES.uptake,RULES.maxEnergy-p.energy); patch.amount-=eaten; p.energy+=eaten; this.ledger.consumed+=eaten; break; }
      }
      const cost=Math.min(p.energy,RULES.upkeep+RULES.movementCost*Math.hypot(p.vx,p.vy)); p.energy-=cost; this.ledger.dissipated+=cost;
      if (p.energy <= 0 || p.age >= p.lifespan) { this.deaths++; this.ledger.deathLoss+=p.energy; continue; }
      if (p.energy >= RULES.birthEnergy) {
        // Conservative cap: vacancies from deaths become available on the next tick.
        if (old.length + newborns.length >= RULES.populationMax) this.blockedBirths++;
        else {
          p.energy /= 2;
          const traits=[...p.traits];
          if (this.mutation && this.mutationRandom() < RULES.mutationChance) { const trait=Math.floor(this.mutationRandom()*3); traits[trait]=clamp(traits[trait]+(this.mutationRandom()<.5?-1:1)*RULES.mutationSize,-1,1); if (traits[trait] !== p.traits[trait]) this.mutations++; }
          newborns.push({id:this.nextId++,family:p.family,x:wrap(p.x+(this.random()-.5)*RULES.birthOffset),y:wrap(p.y+(this.random()-.5)*RULES.birthOffset),vx:-p.vx,vy:-p.vy,energy:p.energy,age:0,lifespan:RULES.lifespanBase+Math.floor(this.random()*RULES.lifespanRange),generation:p.generation+1,traits}); this.births++;
        }
      }
      survivors.push(p);
    }
    this.particles=survivors.concat(newborns);
    if (this.tick % RULES.sampleEvery === 0 || !this.particles.length) { this.history.push(this.census()); if (this.history.length>RULES.historyMax) this.history.shift(); }
  }

  census(): Census {
    const counts: [number,number,number]=[0,0,0]; let particleEnergy=0,meanSpeed=0,maxGeneration=0;
    const sums=[0,0,0], squares=[0,0,0];
    for (const p of this.particles) { counts[p.family]++; particleEnergy+=p.energy; meanSpeed+=Math.hypot(p.vx,p.vy); maxGeneration=Math.max(maxGeneration,p.generation); p.traits.forEach((t,i)=>{sums[i]+=t;squares[i]+=t*t;}); }
    const n=this.particles.length;
    const traitSpread=n?Math.sqrt(sums.reduce((total,s,i)=>total+Math.max(0,squares[i]/n-(s/n)**2),0)/3):0;
    return {tick:this.tick,population:n,counts,births:this.births,deaths:this.deaths,mutations:this.mutations,blockedBirths:this.blockedBirths,maxGeneration,meanSpeed:n?meanSpeed/n:0,traitSpread,particleEnergy,foodEnergy:this.food.reduce((s,p)=>s+p.amount,0)};
  }

  snapshot() {
    return structuredClone({kind:'particle-playground-observation',description:'Engineered open-energy toy. Observation only, not a resumable checkpoint. Same-runtime seeded replay only.',rules:RULES,settings:{seed:this.seed,preset:this.preset,mutation:this.mutation,recipe:this.recipe,environment:this.environment},current:this.census(),ledger:this.ledger,particles:this.particles,food:this.food,history:this.history});
  }
}
