import { describe, expect, it } from 'vitest';
import { ParticleWorld, PRESETS, RULES, torusDelta } from '../src/particles/model.ts';

describe('engineered particle world', () => {
  it('replays 3000 ticks exactly and pure observations do not affect the world', () => {
    const a=new ParticleWorld(1201,'pursuit'),b=new ParticleWorld(1201,'pursuit');
    for(let i=0;i<3000;i++){a.step();b.step(); if(i%100===0){a.census();a.snapshot();}}
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.history.length).toBeLessThanOrEqual(RULES.historyMax);
  });
  it('keeps finite bounded states, actual turnover and an energy ledger in all presets', () => {
    for(const preset of PRESETS){
      const world=new ParticleWorld(1202,preset.id);
      for(let i=0;i<1000;i++){
        world.step(); const c=world.census();
        const expected=world.ledger.initial+world.ledger.renewed-world.ledger.dissipated-world.ledger.deathLoss;
        expect(Math.abs(c.particleEnergy+c.foodEnergy-expected)).toBeLessThan(1e-7);
        expect(c.population).toBeLessThanOrEqual(RULES.populationMax);
        for(const p of world.particles){
          expect(Number.isFinite(p.energy+p.x+p.y+p.vx+p.vy)).toBe(true);
          expect(p.x>=0&&p.x<1&&p.y>=0&&p.y<1).toBe(true);
          expect(Math.hypot(p.vx,p.vy)).toBeLessThanOrEqual(RULES.speedMax+1e-12);
          expect(p.traits.every(t=>t>=-1&&t<=1)).toBe(true);
        }
      }
      expect(world.births).toBeGreaterThan(0);expect(world.deaths).toBeGreaterThan(0);expect(world.mutations).toBeGreaterThan(0);
    }
  });
  it('splits energy without processing newborns, inheriting family and traits with mutation off', () => {
    const world=new ParticleWorld(4,'colonies',false),parent=world.particles[0];
    world.particles=[parent]; parent.energy=9; parent.age=0; parent.x=world.food[0].x; parent.y=world.food[0].y; parent.vx=parent.vy=0;
    const before=parent.energy;world.step();
    expect(world.particles.length).toBe(2);const child=world.particles[1];
    expect(child.age).toBe(0);expect(parent.age).toBe(1);expect(child.generation).toBe(parent.generation+1);
    expect(child.family).toBe(parent.family);expect(child.traits).toEqual(parent.traits);expect(child.traits).not.toBe(parent.traits);
    expect(child.energy).toBe(parent.energy);
    expect(parent.energy+child.energy).toBeCloseTo(before+RULES.uptake-RULES.upkeep,10);
    expect(world.births).toBe(1);expect(world.mutations).toBe(0);
  });
  it('handles toroidal seams and excludes self from force/alignment', () => {
    expect(torusDelta(.98)).toBeCloseTo(-.02);expect(torusDelta(-.98)).toBeCloseTo(.02);
    const world=new ParticleWorld(4,'flocks',false),p=world.particles[0];world.particles=[p];
    p.x=world.food[0].x;p.y=world.food[0].y;p.vx=.002;p.vy=0;p.energy=2;
    world.step();expect(p.vx).toBeCloseTo(.002*RULES.drag,12);expect(p.vy).toBe(0);
    const seam=new ParticleWorld(4,'pursuit',false),away=new ParticleWorld(4,'pursuit',false);
    for(const w of [seam,away]){w.particles=w.particles.slice(0,2);for(const q of w.particles){q.vx=q.vy=0;q.energy=2;q.y=.5;}w.particles[0].x=.99;w.particles[1].x=.01;}
    // Translating both particles and every food patch preserves the toroidal forces.
    for(const q of away.particles)q.x=(q.x+.3)%1;
    for(const q of away.food)q.x=(q.x+.3)%1;
    seam.step();away.step();
    expect(seam.particles[0].vx).toBeCloseTo(away.particles[0].vx,12);
    expect(seam.particles[0].vy).toBeCloseTo(away.particles[0].vy,12);
  });
  it('counts blocked birth attempts, ages out and never resurrects', () => {
    const world=new ParticleWorld(4,'flocks');
    while(world.particles.length<RULES.populationMax)world.particles.push({...world.particles[0],id:1000+world.particles.length,traits:[...world.particles[0].traits]});
    for(const p of world.particles){p.energy=9;p.age=0;}
    world.step();expect(world.particles.length).toBe(RULES.populationMax);expect(world.blockedBirths).toBe(RULES.populationMax);
    for(const p of world.particles)p.age=p.lifespan;
    world.step();expect(world.particles).toHaveLength(0);const tick=world.tick;world.step(100);expect(world.tick).toBe(tick);
  });
  it('rejects invalid recipes and returns detached observation data', () => {
    expect(()=>new ParticleWorld(NaN)).toThrow();expect(()=>new ParticleWorld(-1)).toThrow();
    const world=new ParticleWorld(1);expect(()=>world.step(.5)).toThrow();
    const snapshot=world.snapshot();snapshot.particles[0].energy=0;snapshot.food[0].amount=0;
    expect(world.particles[0].energy).toBe(4);expect(world.food[0].amount).toBe(30);
    expect(snapshot.rules.version).toBe(1);expect(snapshot.settings.seed).toBe(1);
  });
});
