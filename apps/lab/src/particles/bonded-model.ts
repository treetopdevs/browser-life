import { ParticleWorld, RULES as PARTICLE_RULES, torusDelta, type Census, type Particle, type ParticleEnvironment, type PresetId } from './model.ts';

export type BondMode = 'none' | 'chains' | 'mesh';
export type BondRemovalCause = 'stretchBreak' | 'deathRemoval';
export interface BondRecord { readonly a: number; readonly b: number; readonly bornTick: number }
export interface BondRemovalEvent extends BondRecord { readonly removedAtTick: number; readonly cause: BondRemovalCause; readonly stage: 'beforeStep' | 'afterDeath'; readonly completedTicks: number }
export interface BondLifetimeSummary { count: number; meanCompletedTicks: number | null; medianCompletedTicks: number | null }

export const BOND_RULES = Object.freeze({
  version: 1,
  restLength: .045,
  formationDistance: .06,
  breakDistance: .12,
  stiffness: .08,
  pairImpulseMax: .0015,
  chainsDegreeMax: 2,
  meshDegreeMax: 4,
});

export interface BondGraphSummary {
  tick: number;
  population: number;
  families: [number, number, number];
  particleEnergy: number;
  foodEnergy: number;
  ledgerResidual: number;
  nodes: number;
  isolatedParticles: number;
  isolatedFraction: number | null;
  meanDegree: number | null;
  linkedComponents: number;
  largestComponent: number;
  edgeCount: number;
  liveEdgeAgeMean: number | null;
  liveEdgeAgeMedian: number | null;
  formations: number;
  stretchBreaks: number;
  deathRemovals: number;
  lifetimes: Record<BondRemovalCause, BondLifetimeSummary>;
  netImpulseMagnitude: number;
}

interface LifetimeCounter { count: number; sum: number; histogram: number[] }
interface LifetimeTotals { count: number; sum: number; histogram: readonly number[] }
const MAX_LIFETIME = PARTICLE_RULES.lifespanBase + PARTICLE_RULES.lifespanRange;
const REMOVAL_EVENT_LIMIT = 10_000;

/** Shared graph and base-ledger observations used by the wrapper and its consumers. */
export function summarizeBondGraph(
  base: ParticleWorld,
  bonds: readonly BondRecord[],
  counters: { formations: number; stretchBreaks: number; deathRemovals: number; lifetimes: Record<BondRemovalCause, LifetimeTotals>; netImpulseMagnitude: number },
): BondGraphSummary {
  const census = base.census();
  const degree = new Map<number, number>();
  const adjacency = new Map<number, number[]>();
  for (const p of base.particles) { degree.set(p.id, 0); adjacency.set(p.id, []); }
  const edgeAges = bonds.map(b => base.tick - b.bornTick + 1).sort((a, b) => a - b);
  for (const bond of bonds) {
    degree.set(bond.a, (degree.get(bond.a) ?? 0) + 1);
    degree.set(bond.b, (degree.get(bond.b) ?? 0) + 1);
    adjacency.get(bond.a)?.push(bond.b);
    adjacency.get(bond.b)?.push(bond.a);
  }
  let isolatedParticles = 0;
  for (const value of degree.values()) if (!value) isolatedParticles++;
  let linkedComponents = 0, largestComponent = 0;
  const visited = new Set<number>();
  for (const [id, neighbors] of adjacency) {
    if (!neighbors.length || visited.has(id)) continue;
    linkedComponents++;
    let size = 0;
    const pending = [id]; visited.add(id);
    while (pending.length) {
      const current = pending.pop()!; size++;
      for (const next of adjacency.get(current) ?? []) if (!visited.has(next)) { visited.add(next); pending.push(next); }
    }
    largestComponent = Math.max(largestComponent, size);
  }
  const median = (values: number[]): number | null => values.length ? (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2 : null;
  const histogramMedian = (histogram: readonly number[], count: number): number | null => {
    if (!count) return null;
    const ranks = [(count - 1) >> 1, count >> 1];
    const values = [0, 0]; let cumulative = 0, rankIndex = 0;
    for (let age = 0; age < histogram.length && rankIndex < ranks.length; age++) {
      cumulative += histogram[age];
      while (rankIndex < ranks.length && ranks[rankIndex] < cumulative) values[rankIndex++] = age;
    }
    return (values[0] + values[1]) / 2;
  };
  const lifetimeSummary = (totals: LifetimeTotals): BondLifetimeSummary => {
    return { count: totals.count, meanCompletedTicks: totals.count ? totals.sum / totals.count : null, medianCompletedTicks: histogramMedian(totals.histogram, totals.count) };
  };
  const expected = base.ledger.initial + base.ledger.renewed - base.ledger.dissipated - base.ledger.deathLoss;
  const n = base.particles.length;
  return {
    tick: base.tick, population: census.population, families: [...census.counts] as [number, number, number],
    particleEnergy: census.particleEnergy, foodEnergy: census.foodEnergy,
    ledgerResidual: census.particleEnergy + census.foodEnergy - expected,
    nodes: n, isolatedParticles, isolatedFraction: n ? isolatedParticles / n : null,
    meanDegree: n ? 2 * bonds.length / n : null,
    linkedComponents, largestComponent, edgeCount: bonds.length,
    liveEdgeAgeMean: edgeAges.length ? edgeAges.reduce((sum, age) => sum + age, 0) / edgeAges.length : null,
    liveEdgeAgeMedian: median(edgeAges),
    formations: counters.formations, stretchBreaks: counters.stretchBreaks, deathRemovals: counters.deathRemovals,
    lifetimes: { stretchBreak: lifetimeSummary(counters.lifetimes.stretchBreak), deathRemoval: lifetimeSummary(counters.lifetimes.deathRemoval) },
    netImpulseMagnitude: counters.netImpulseMagnitude,
  };
}

const pairKey = (a: number, b: number) => `${a}:${b}`;
const canonicalBond = (a: number, b: number, bornTick: number): BondRecord => Object.freeze({ a: Math.min(a, b), b: Math.max(a, b), bornTick });
/** Separate, versioned spring-steering extension over the unchanged ParticleWorld. */
export class BondedWorld {
  readonly base: ParticleWorld;
  readonly mode: BondMode;
  private bondMap = new Map<string, BondRecord>();
  private formations = 0;
  private stretchBreaks = 0;
  private deathRemovals = 0;
  private readonly lifetimes: Record<BondRemovalCause, LifetimeCounter> = { stretchBreak: this.newLifetimeCounter(), deathRemoval: this.newLifetimeCounter() };
  private readonly removals: BondRemovalEvent[] = [];
  private removalCount = 0;
  private impulseMagnitude = 0;

  constructor(seed: number, preset: PresetId = 'flocks', mutation = true, mode: BondMode = 'none') {
    if (mode !== 'none' && mode !== 'chains' && mode !== 'mesh') throw new Error('Unknown bond mode');
    this.base = new ParticleWorld(seed, preset, mutation);
    this.mode = mode;
  }

  get tick(): number { return this.base.tick; }
  get particles(): Particle[] { return this.base.particles; }
  get food() { return this.base.food; }
  get history(): Census[] { return this.base.history; }
  get environment(): ParticleEnvironment { return this.base.environment; }
  get bonds(): readonly BondRecord[] { return [...this.bondMap.values()].sort((a, b) => a.a - b.a || a.b - b.b); }
  get edges(): readonly BondRecord[] { return this.bonds; }
  get removalEvents(): readonly BondRemovalEvent[] { return this.removals.map(event => Object.freeze({ ...event })); }
  get removalEventCount(): number { return this.removalCount; }
  get removalEventsTruncated(): number { return Math.max(0, this.removalCount - this.removals.length); }

  step(count = 1): void {
    if (!Number.isInteger(count) || count < 0 || count > 100000) throw new Error('Tick count must be an integer from 0 to 100000');
    // This fast path must remain observationally and physically identical to ParticleWorld.
    if (this.mode === 'none') { this.base.step(count); return; }
    for (let i = 0; i < count && this.base.particles.length; i++) this.advanceBondedTick();
  }

  private advanceBondedTick(): void {
    const oldTick = this.base.tick;
    const particles = [...this.base.particles].sort((a, b) => a.id - b.id);
    const byId = new Map(particles.map(p => [p.id, p]));
    for (const bond of this.bonds) {
      const a = byId.get(bond.a), b = byId.get(bond.b);
      if (!a || !b) this.remove(bond, 'deathRemoval', 'beforeStep', oldTick + 1, oldTick - bond.bornTick + 1);
      else if (distance(a, b) > BOND_RULES.breakDistance) this.remove(bond, 'stretchBreak', 'beforeStep', oldTick + 1, oldTick - bond.bornTick + 1);
    }
    this.formEligibleBonds(particles, oldTick + 1);
    this.applySpringImpulses(particles);
    this.base.step();
    const alive = new Set(this.base.particles.map(p => p.id));
    for (const bond of this.bonds) if (!alive.has(bond.a) || !alive.has(bond.b)) this.remove(bond, 'deathRemoval', 'afterDeath', this.base.tick, this.base.tick - bond.bornTick + 1);
  }

  private formEligibleBonds(particles: Particle[], bornTick: number): void {
    const cap = this.mode === 'chains' ? BOND_RULES.chainsDegreeMax : BOND_RULES.meshDegreeMax;
    const degree = new Map<number, number>(particles.map(p => [p.id, 0]));
    const existing = new Set<string>();
    for (const bond of this.bonds) { existing.add(pairKey(bond.a, bond.b)); degree.set(bond.a, (degree.get(bond.a) ?? 0) + 1); degree.set(bond.b, (degree.get(bond.b) ?? 0) + 1); }
    const candidates: { a: Particle; b: Particle; distance: number }[] = [];
    for (let i = 0; i < particles.length; i++) for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i], b = particles[j];
      if (a.family !== b.family || existing.has(pairKey(a.id, b.id))) continue;
      const d = distance(a, b);
      if (d <= BOND_RULES.formationDistance) candidates.push({ a, b, distance: d });
    }
    candidates.sort((left, right) => left.distance - right.distance || left.a.id - right.a.id || left.b.id - right.b.id);
    for (const candidate of candidates) {
      const { a, b } = candidate;
      if ((degree.get(a.id) ?? 0) >= cap || (degree.get(b.id) ?? 0) >= cap) continue;
      const bond = canonicalBond(a.id, b.id, bornTick);
      this.bondMap.set(pairKey(bond.a, bond.b), bond); existing.add(pairKey(bond.a, bond.b));
      degree.set(a.id, (degree.get(a.id) ?? 0) + 1); degree.set(b.id, (degree.get(b.id) ?? 0) + 1);
      this.formations++;
    }
  }

  private applySpringImpulses(particles: Particle[]): void {
    const byId = new Map(particles.map(p => [p.id, p]));
    const sums = new Map<number, [number, number]>(particles.map(p => [p.id, [0, 0]]));
    for (const bond of this.bonds) {
      const a = byId.get(bond.a)!, b = byId.get(bond.b)!;
      const dx = torusDelta(b.x - a.x), dy = torusDelta(b.y - a.y), d = Math.hypot(dx, dy);
      if (!d) continue;
      const magnitude = Math.max(-BOND_RULES.pairImpulseMax, Math.min(BOND_RULES.pairImpulseMax, BOND_RULES.stiffness * (d - BOND_RULES.restLength)));
      const ix = magnitude * dx / d, iy = magnitude * dy / d;
      const sa = sums.get(a.id)!, sb = sums.get(b.id)!;
      sa[0] += ix; sa[1] += iy; sb[0] -= ix; sb[1] -= iy;
    }
    for (const p of particles) {
      const sum = sums.get(p.id)!;
      p.vx += sum[0]; p.vy += sum[1];
      this.impulseMagnitude += Math.hypot(sum[0], sum[1]);
    }
  }

  private remove(bond: BondRecord, cause: BondRemovalCause, stage: BondRemovalEvent['stage'], removedAtTick: number, completedTicks: number): void {
    if (!this.bondMap.delete(pairKey(bond.a, bond.b))) return;
    const life = Math.max(0, completedTicks);
    if (cause === 'stretchBreak') this.stretchBreaks++; else this.deathRemovals++;
    const totals = this.lifetimes[cause];
    totals.count++; totals.sum += life; totals.histogram[Math.min(life, MAX_LIFETIME)]++;
    this.removals.push(Object.freeze({ ...bond, removedAtTick, cause, stage, completedTicks: life }));
    this.removalCount++;
    if (this.removals.length > REMOVAL_EVENT_LIMIT) this.removals.shift();
  }

  census(): Census { return this.base.census(); }
  graphSummary(): BondGraphSummary {
    return summarizeBondGraph(this.base, this.bonds, {
      formations: this.formations, stretchBreaks: this.stretchBreaks, deathRemovals: this.deathRemovals,
      lifetimes: { stretchBreak: this.lifetimes.stretchBreak, deathRemoval: this.lifetimes.deathRemoval },
      netImpulseMagnitude: this.impulseMagnitude,
    });
  }

  snapshot() {
    return structuredClone({
      kind: 'bonded-particle-playground-observation',
      description: 'Observation only; not resumable. Supplied breakable spring steering changes particle motion; particles reproduce individually and bonds are not inherited.',
      base: this.base.snapshot(),
      extension: { rules: BOND_RULES, mode: this.mode, bonds: this.bonds, graph: this.graphSummary(), removalEvents: this.removalEvents, removalEventCount: this.removalEventCount, removalEventsTruncated: this.removalEventsTruncated },
    });
  }

  private newLifetimeCounter(): LifetimeCounter { return { count: 0, sum: 0, histogram: Array(MAX_LIFETIME + 1).fill(0) }; }
}

function distance(a: Particle, b: Particle): number {
  return Math.hypot(torusDelta(b.x - a.x), torusDelta(b.y - a.y));
}
