/** An engineered, open-energy 3D toy world. Float64 replay is same-runtime only. */
export type PresetId = 'flocks' | 'pursuit' | 'colonies';
export type Family = 0 | 1 | 2;
export interface Particle {
  id: number; family: Family;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  energy: number; age: number; lifespan: number; generation: number; traits: number[];
}
export interface FoodPatch { x: number; y: number; z: number; radius: number; amount: number }
export interface Census {
  tick: number; population: number; counts: [number, number, number];
  births: number; deaths: number; mutations: number; blockedBirths: number; maxGeneration: number;
  meanSpeed: number; meanAbsVx: number; meanAbsVy: number; meanAbsVz: number;
  traitSpread: number; particleEnergy: number; foodEnergy: number;
  occupiedBins: number; occupiedZBands: number;
}

export const RULES = Object.freeze({
  version: 1, sourceVersion: 4,
  populationMax: 240, initialPopulation: 120,
  speedMax: .008, interactionRadius: .20, repulsionRadius: .018, force: .0012, drag: .92,
  foodCapacity: 35, foodRenewal: .65, uptake: .11, upkeep: .028, movementCost: 3,
  birthEnergy: 8, maxEnergy: 10, mutationChance: .18, mutationSize: .15,
  foodSeekingForce: .000035, foodPatchRadius: .30, foodPatchInitial: 30,
  initialEnergy: 4, initialVelocityRange: .004, initialAgeRange: 300,
  lifespanBase: 900, lifespanRange: 500, birthOffset: .025,
  sampleEvery: 10, historyMax: 300,
  foodPatchCenters: [.25, .75] as const,
  spatialBinsPerAxis: 5, zBands: 5,
});

export const PRESETS = [
  { id: 'flocks' as const, name: 'Flocks', description: 'Neighbours align and gather into moving family groups.', rows: [[.75,.15,.15],[.15,.75,.15],[.15,.15,.75]], alignment: .12 },
  { id: 'pursuit' as const, name: 'Pursuit', description: 'Each family chases one colour and flees another. Chasing does not eat particles.', rows: [[.2,.95,-.9],[-.9,.2,.95],[.95,-.9,.2]], alignment: 0 },
  { id: 'colonies' as const, name: 'Colonies', description: 'Strong family attraction and cross-family repulsion form separate clusters.', rows: [[1,-.6,-.6],[-.6,1,-.6],[-.6,-.6,1]], alignment: .015 },
] as const;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const torusDelta = (d: number) => d - Math.round(d);
export const wrap = (n: number) => ((n % 1) + 1) % 1;
function stream(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = Math.imul(state ^ state >>> 15, state | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export class SpatialWorld {
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

  constructor(seed: number, preset: PresetId = 'flocks', mutation = true) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer');
    if (typeof mutation !== 'boolean') throw new Error('Mutation must be a boolean');
    if (!PRESETS.some(p => p.id === preset)) throw new Error('Unknown spatial preset');
    this.seed = seed; this.preset = preset; this.mutation = mutation;
    this.random = stream(seed ^ 0x83a9f214);
    this.mutationRandom = stream(seed ^ 0x1bd9237a);
    // Stable index order: z outermost, then y, then x.
    for (const z of RULES.foodPatchCenters) for (const y of RULES.foodPatchCenters) for (const x of RULES.foodPatchCenters) {
      this.food.push({ x, y, z, radius: RULES.foodPatchRadius, amount: RULES.foodPatchInitial });
    }
    for (let i = 0; i < RULES.initialPopulation; i++) {
      const family = (i % 3) as Family;
      const x = this.random(), y = this.random(), z = this.random();
      const vx = (this.random() - .5) * RULES.initialVelocityRange;
      const vy = (this.random() - .5) * RULES.initialVelocityRange;
      const vz = (this.random() - .5) * RULES.initialVelocityRange;
      const age = Math.floor(this.random() * RULES.initialAgeRange);
      const lifespan = RULES.lifespanBase + Math.floor(this.random() * RULES.lifespanRange);
      this.particles.push({ id: this.nextId++, family, x, y, z, vx, vy, vz, energy: RULES.initialEnergy, age, lifespan, generation: 0, traits: [...PRESETS.find(p => p.id === preset)!.rows[family]] });
    }
    this.ledger.initial = this.particles.reduce((s,p) => s + p.energy,0) + this.food.reduce((s,p) => s + p.amount,0);
    this.history.push(this.census());
  }

  step(count = 1): void {
    if (!Number.isInteger(count) || count < 0 || count > 100000) throw new Error('Tick count must be an integer from 0 to 100000');
    for (let step = 0; step < count && this.particles.length; step++) this.advance();
  }

  private advance(): void {
    this.tick++;
    for (const patch of this.food) {
      const renewed = Math.min(RULES.foodRenewal, RULES.foodCapacity - patch.amount);
      patch.amount += renewed; this.ledger.renewed += renewed;
    }
    const old = this.particles;
    const velocities: [number, number, number][] = [];
    // Compute every adult's velocity from the same old particle state.
    for (let i = 0; i < old.length; i++) {
      const p = old[i]; let fx = 0, fy = 0, fz = 0, avx = 0, avy = 0, avz = 0, neighbours = 0;
      for (let j = 0; j < old.length; j++) {
        if (i === j) continue;
        const q = old[j], dx = torusDelta(q.x - p.x), dy = torusDelta(q.y - p.y), dz = torusDelta(q.z - p.z), d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= RULES.interactionRadius ** 2 || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const force = d < RULES.repulsionRadius ? -2 * (1 - d / RULES.repulsionRadius) : p.traits[q.family] * (1 - (d - RULES.repulsionRadius) / (RULES.interactionRadius - RULES.repulsionRadius));
        fx += force * dx / d; fy += force * dy / d; fz += force * dz / d;
        avx += q.vx; avy += q.vy; avz += q.vz; neighbours++;
      }
      let vx = p.vx * RULES.drag, vy = p.vy * RULES.drag, vz = p.vz * RULES.drag;
      if (neighbours) {
        vx += RULES.force * fx / Math.sqrt(neighbours) + this.alignment * (avx / neighbours - p.vx);
        vy += RULES.force * fy / Math.sqrt(neighbours) + this.alignment * (avy / neighbours - p.vy);
        vz += RULES.force * fz / Math.sqrt(neighbours) + this.alignment * (avz / neighbours - p.vz);
      }
      // A deliberately supplied weak food-seeking force, identical for all families.
      let nearest = this.food[0], distance = Infinity;
      for (const patch of this.food) {
        const dx = torusDelta(patch.x-p.x), dy = torusDelta(patch.y-p.y), dz = torusDelta(patch.z-p.z), d2 = dx*dx+dy*dy+dz*dz;
        if (d2 < distance) { distance = d2; nearest = patch; }
      }
      const d = Math.sqrt(distance);
      if (d > .001) {
        vx += RULES.foodSeekingForce * torusDelta(nearest.x-p.x)/d;
        vy += RULES.foodSeekingForce * torusDelta(nearest.y-p.y)/d;
        vz += RULES.foodSeekingForce * torusDelta(nearest.z-p.z)/d;
      }
      const speed = Math.sqrt(vx*vx + vy*vy + vz*vz);
      if (speed > RULES.speedMax) { vx *= RULES.speedMax/speed; vy *= RULES.speedMax/speed; vz *= RULES.speedMax/speed; }
      velocities.push([vx,vy,vz]);
    }
    const survivors: Particle[] = [], newborns: Particle[] = [];
    // Adults stay in ascending ID order. Food competition and cap decisions use that fixed order.
    for (let i = 0; i < old.length; i++) {
      const p = old[i]; [p.vx,p.vy,p.vz] = velocities[i];
      p.x=wrap(p.x+p.vx); p.y=wrap(p.y+p.vy); p.z=wrap(p.z+p.vz); p.age++;
      for (const patch of this.food) {
        const dx=torusDelta(patch.x-p.x),dy=torusDelta(patch.y-p.y),dz=torusDelta(patch.z-p.z);
        if (dx*dx+dy*dy+dz*dz <= patch.radius*patch.radius) {
          const eaten=Math.min(patch.amount,RULES.uptake,RULES.maxEnergy-p.energy);
          patch.amount-=eaten; p.energy+=eaten; this.ledger.consumed+=eaten; break;
        }
      }
      const cost=Math.min(p.energy,RULES.upkeep+RULES.movementCost*Math.sqrt(p.vx*p.vx+p.vy*p.vy+p.vz*p.vz));
      p.energy-=cost; this.ledger.dissipated+=cost;
      if (p.energy <= 0 || p.age >= p.lifespan) { this.deaths++; this.ledger.deathLoss+=p.energy; continue; }
      if (p.energy >= RULES.birthEnergy) {
        // Conservative cap: vacancies from deaths become available on the next tick.
        if (old.length + newborns.length >= RULES.populationMax) this.blockedBirths++;
        else {
          p.energy /= 2;
          const traits=[...p.traits];
          if (this.mutation && this.mutationRandom() < RULES.mutationChance) {
            const trait=Math.floor(this.mutationRandom()*3);
            traits[trait]=clamp(traits[trait]+(this.mutationRandom()<.5?-1:1)*RULES.mutationSize,-1,1);
            if (traits[trait] !== p.traits[trait]) this.mutations++;
          }
          const xOffset=(this.random()-.5)*RULES.birthOffset;
          const yOffset=(this.random()-.5)*RULES.birthOffset;
          const zOffset=(this.random()-.5)*RULES.birthOffset;
          const lifespan=RULES.lifespanBase+Math.floor(this.random()*RULES.lifespanRange);
          newborns.push({id:this.nextId++,family:p.family,x:wrap(p.x+xOffset),y:wrap(p.y+yOffset),z:wrap(p.z+zOffset),vx:-p.vx,vy:-p.vy,vz:-p.vz,energy:p.energy,age:0,lifespan,generation:p.generation+1,traits});
          this.births++;
        }
      }
      survivors.push(p);
    }
    this.particles=survivors.concat(newborns);
    if (this.tick % RULES.sampleEvery === 0 || !this.particles.length) {
      this.history.push(this.census()); if (this.history.length>RULES.historyMax) this.history.shift();
    }
  }

  private get alignment(): number { return PRESETS.find(p => p.id === this.preset)!.alignment; }

  census(): Census {
    const counts: [number,number,number]=[0,0,0]; let particleEnergy=0,meanSpeed=0,maxGeneration=0,meanAbsVx=0,meanAbsVy=0,meanAbsVz=0;
    const sums=[0,0,0], squares=[0,0,0], bins=new Set<number>(), zBands=new Set<number>();
    for (const p of this.particles) {
      counts[p.family]++; particleEnergy+=p.energy; meanSpeed+=Math.sqrt(p.vx*p.vx+p.vy*p.vy+p.vz*p.vz); maxGeneration=Math.max(maxGeneration,p.generation);
      meanAbsVx+=Math.abs(p.vx); meanAbsVy+=Math.abs(p.vy); meanAbsVz+=Math.abs(p.vz);
      bins.add(Math.floor(p.x*5) + 5*Math.floor(p.y*5) + 25*Math.floor(p.z*5)); zBands.add(Math.floor(p.z*5));
      p.traits.forEach((t,i)=>{sums[i]+=t;squares[i]+=t*t;});
    }
    const n=this.particles.length;
    const traitSpread=n?Math.sqrt(sums.reduce((total,s,i)=>total+Math.max(0,squares[i]/n-(s/n)**2),0)/3):0;
    return {tick:this.tick,population:n,counts,births:this.births,deaths:this.deaths,mutations:this.mutations,blockedBirths:this.blockedBirths,maxGeneration,
      meanSpeed:n?meanSpeed/n:0,meanAbsVx:n?meanAbsVx/n:0,meanAbsVy:n?meanAbsVy/n:0,meanAbsVz:n?meanAbsVz/n:0,traitSpread,
      particleEnergy,foodEnergy:this.food.reduce((s,p)=>s+p.amount,0),occupiedBins:bins.size,occupiedZBands:zBands.size};
  }

  snapshot() {
    return structuredClone({kind:'spatial-world-observation',description:'Engineered open-energy 3D toy. Observation only, not a resumable checkpoint. Same-runtime seeded replay only.',rules:RULES,settings:{seed:this.seed,preset:this.preset,mutation:this.mutation,recipe:{rows:PRESETS.find(p=>p.id===this.preset)!.rows,alignment:this.alignment}},current:this.census(),ledger:this.ledger,particles:this.particles,food:this.food,history:this.history});
  }
}
