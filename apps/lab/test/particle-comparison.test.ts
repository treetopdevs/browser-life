import { describe, expect, it } from 'vitest';
import { createExploration, keepFavorite, parseExploration, serializeExploration, recipeNode, MAX_SELECTIONS, MAX_IMPORT_BYTES } from '../src/particles/comparison.ts';
import { ParticleWorld, PRESETS, recipeForPreset, validateRecipe } from '../src/particles/model.ts';

const flatten=(recipe:ReturnType<typeof recipeForPreset>)=>[...recipe.rows.flat(),recipe.alignment,recipe.foodRenewal];
describe('particle recipe selection',()=>{
  it('starts with three distinct preset roots, selected preset first',()=>{
    for(const preset of PRESETS){const s=createExploration(123,preset.id);expect(s.nodes[0].recipe).toEqual(recipeForPreset(preset.id));expect(s.nodes.every(n=>n.parentId===null)).toBe(true);expect(new Set(s.nodes.map(n=>JSON.stringify(n.recipe))).size).toBe(3);expect(parseExploration(serializeExploration(s))).toEqual(s);}
  });
  it('keeps the exact favorite, adds two real one-coordinate variations and preserves parent/history',()=>{
    const original=createExploration(1201,'pursuit'),before=serializeExploration(original),parent=recipeNode(original,original.slate[2]);
    const next=keepFavorite(original,2,1000,'I like the clusters');
    expect(serializeExploration(original)).toBe(before);expect(next.slate[0]).toBe(parent.id);expect(recipeNode(next,parent.id).recipe).toEqual(parent.recipe);
    expect(next.selections[0]).toMatchObject({chosenId:parent.id,candidateIds:original.slate,evaluationTick:1000,reason:'I like the clusters',seed:1201,nextSlate:next.slate});
    const children=next.slate.slice(1).map(id=>recipeNode(next,id));
    for(const child of children){expect(child.parentId).toBe(parent.id);expect(flatten(child.recipe).filter((n,i)=>n!==flatten(parent.recipe)[i])).toHaveLength(1);expect(validateRecipe(child.recipe)).toEqual(child.recipe);}
    expect(children[0].recipe).not.toEqual(children[1].recipe);expect(Object.isFrozen(next.nodes)).toBe(true);
  });
  it('generates deterministic bounded history through the final allowed slate and round trips it',()=>{
    let a=createExploration(0xffffffff,'colonies'),b=createExploration(0xffffffff,'colonies');
    for(let i=0;i<MAX_SELECTIONS;i++){a=keepFavorite(a,(i%3) as 0|1|2,i*100,'choice');b=keepFavorite(b,(i%3) as 0|1|2,i*100,'choice');}
    expect(a).toEqual(b);expect(a.nodes).toHaveLength(3+2*MAX_SELECTIONS);expect(new Set(a.nodes.map(n=>n.id)).size).toBe(a.nodes.length);
    expect(()=>keepFavorite(a,0,0)).toThrow(/limit/);expect(parseExploration(serializeExploration(a))).toEqual(a);
    expect(new TextEncoder().encode(serializeExploration(a)).length).toBeLessThan(MAX_IMPORT_BYTES);
  });
  it('reflects at every parameter bound without identical children or collateral coordinate changes',()=>{
    for(const high of [false,true])for(let seed=0;seed<22;seed++){
      const s=structuredClone(createExploration(seed,'flocks'));
      s.nodes[0].recipe={rows:Array.from({length:3},()=>Array(3).fill(high?1:-1)),alignment:high?.2:0,foodRenewal:high?1:.3};
      const next=keepFavorite(s,0,0),parent=flatten(s.nodes[0].recipe);
      for(const id of next.slate.slice(1)){const child=recipeNode(next,id).recipe;expect(()=>validateRecipe(child)).not.toThrow();expect(flatten(child).filter((v,i)=>v!==parent[i])).toHaveLength(1);}
      expect(recipeNode(next,next.slate[1]).recipe).not.toEqual(recipeNode(next,next.slate[2]).recipe);
    }
  });
  it('rejects bad values, invented recipes, relationships, history, versions and oversized files',()=>{
    const s=keepFavorite(createExploration(1201,'flocks'),0,200,'test');
    const bad=[(v:any)=>v.modelVersion=99,(v:any)=>v.nodes[3].parentId='missing',(v:any)=>v.nodes[3].recipe.rows[0][0]=.123,(v:any)=>v.selections[0].candidateIds.reverse(),(v:any)=>v.selections[0].evaluationTick=-1,(v:any)=>v.selections[0].reason='a'.repeat(241),(v:any)=>v.nodes[1].id=v.nodes[0].id,(v:any)=>v.slate.reverse(),(v:any)=>v.extra=true,(v:any)=>v.seed=1.5,(v:any)=>v.mutation='yes'];
    for(const change of bad){const v=JSON.parse(serializeExploration(s));change(v);expect(()=>parseExploration(JSON.stringify(v))).toThrow();}
    expect(()=>parseExploration('x'.repeat(MAX_IMPORT_BYTES+1))).toThrow();expect(()=>parseExploration('{')).toThrow();
    expect(()=>keepFavorite(s,0,10_000_001)).toThrow();expect(()=>keepFavorite(s,0,NaN)).toThrow();
  });
  it('rejects deeply nested unknown fields with a controlled error rather than a stack overflow',()=>{
    const s=JSON.parse(serializeExploration(createExploration(1201,'flocks')));
    let nested: unknown = 0;for(let i=0;i<100;i++)nested={child:nested};s.extra=nested;
    expect(()=>parseExploration(JSON.stringify(s))).toThrow('Selection file has unsupported nesting');
    try{parseExploration(JSON.stringify(s));}catch(error){expect(error).not.toBeInstanceOf(RangeError);}
  });
  it('accepts harmless JSON key ordering and safely retains reason text',()=>{
    const s=keepFavorite(createExploration(1,'flocks'),1,0,'<img src=x onerror=alert(1)>');const reordered=Object.fromEntries(Object.entries(JSON.parse(serializeExploration(s))).reverse());
    expect(parseExploration(JSON.stringify(reordered))).toEqual(s);
  });
  it('replays a selected recipe independently of card order or observations',()=>{
    const s=keepFavorite(createExploration(1202,'pursuit'),0,1000),recipe=recipeNode(s,s.slate[1]).recipe;
    const a=new ParticleWorld(s.seed,s.preset,s.mutation,recipe),b=new ParticleWorld(s.seed,s.preset,s.mutation,recipe);
    a.step(300);for(let i=0;i<300;i++){b.census();b.step();}expect(a.snapshot()).toEqual(b.snapshot());
  });
});
