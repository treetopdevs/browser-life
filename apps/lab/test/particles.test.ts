import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ParticleWorld, PRESETS, RULES, torusDelta, recipeForPreset, validateRecipe } from '../src/particles/model.ts';

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
    expect(snapshot.rules.version).toBe(2);expect(snapshot.settings.seed).toBe(1);
  });
});


describe('particle recipes', () => {
  it('preserves all v1 default physical fixtures and explicit preset behavior', () => {
    // Captured before the v2 recipe extension: Node24, seed1201, 300ticks, PR85 86d3a6e.
    const hashes = ['1648ae2c52defce09833eedb4893f69c26655f70e0d2ddd46b9fc4981e7e10b5','58b227dbc2264997140377b9a61f82813aafb02b1862ddfb20d1783778784265','ae06f75acd79a449b7760464c82032668885f351e57d74359d2f407d94cad813'];
    PRESETS.forEach((preset,i) => {
      const w=new ParticleWorld(1201,preset.id), explicit=new ParticleWorld(1201,preset.id,true,recipeForPreset(preset.id));w.step(300);explicit.step(300);
      const physical={tick:w.tick,particles:w.particles,food:w.food,ledger:w.ledger,census:w.census()};
      expect(createHash('sha256').update(JSON.stringify(physical)).digest('hex')).toBe(hashes[i]);
      expect(w.snapshot()).toEqual(explicit.snapshot());
    });
  });
  it('custom recipes change forces without changing initial positions and are isolated from caller mutation', () => {
    const recipe=structuredClone(recipeForPreset('flocks'));recipe.rows[0][1]=-.9;
    const a=new ParticleWorld(1201,'flocks'),b=new ParticleWorld(1201,'flocks',true,recipe);
    expect(a.particles.map(p=>[p.x,p.y,p.vx,p.vy,p.age])).toEqual(b.particles.map(p=>[p.x,p.y,p.vx,p.vy,p.age]));
    recipe.rows[0][1]=0;expect(b.recipe.rows[0][1]).toBe(-.9);expect(Object.isFrozen(b.recipe.rows[0])).toBe(true);
    a.step(50);b.step(50);expect(a.particles).not.toEqual(b.particles);expect(b.snapshot().settings.recipe.rows[0][1]).toBe(-.9);
  });
  it('rejects invalid recipes and keeps corner recipes bounded with balanced energy', () => {
    const base=structuredClone(recipeForPreset('flocks'));
    for(const invalid of [{...base,foodRenewal:NaN},{...base,foodRenewal:.2},{...base,alignment:Infinity},{...base,alignment:.201},{...base,rows:Array(3)},{...base,rows:[Array(3),[0,0,0],[0,0,0]]},{...base,rows:[[0]]},{...base,rows:[[2,0,0],[0,0,0],[0,0,0]]},{...base,extra:true}])expect(()=>validateRecipe(invalid)).toThrow();
    for(const high of [false,true]){
      const w=new ParticleWorld(1203,'pursuit',true,{rows:Array.from({length:3},()=>Array(3).fill(high?1:-1)),alignment:high?.2:0,foodRenewal:high?1:.3});
      w.step(300);const c=w.census();expect(c.population).toBeLessThanOrEqual(RULES.populationMax);
      expect(Math.abs(c.particleEnergy+c.foodEnergy+w.ledger.dissipated+w.ledger.deathLoss-w.ledger.initial-w.ledger.renewed)).toBeLessThan(1e-7);
      expect(w.particles.every(p=>Number.isFinite(p.x+p.y+p.energy)&&Math.hypot(p.vx,p.vy)<=RULES.speedMax+1e-12)).toBe(true);
    }
  });
});
