import {it,expect} from 'vitest';
import {CH,G,cellCount,validateState} from '@bl/schema';
import {jobConfig,mixParams} from '../3d-rps/gate0-spike/rungs';
import {rpsMix} from '../3d-rps/gate0-spike/world';
import {sites,inoculate,census,meanFinal,verdict,SEEDS,MARKERS,type Census} from '../3d-rps/invasion/assay';
const state=()=>rpsMix({...jobConfig('S0',[32,32,4],8,9101),rpsTypes:5,rpsMin:4,rpsKill:'vacancy',rpsRate:64},mixParams('S0'));
it('pairs exact sites and matter; only type byte differs between arms',()=>{
 const s=state(),selected=sites(s,9101),n=cellCount(s.cfg);
 expect(selected).toEqual(sites(s,9101));expect(selected.length).toBeGreaterThan(0);
 for(const marker of MARKERS){const a=inoculate(s,selected,marker,true),b=inoculate(s,selected,marker,false);
 expect(validateState(a)).toEqual([]);expect(validateState(b)).toEqual([]);expect(a.cells).toEqual(b.cells);expect(a.cells).toEqual(s.cells);
 const differences=[];for(let k=0;k<a.genome.length;k++)if(a.genome[k]!==b.genome[k])differences.push(k);
 expect(differences.sort((a,b)=>a-b)).toEqual(selected.map(i=>G.PARAM1*n+i).sort((a,b)=>a-b));
 expect(census(a,marker).frequency).toBe(census(b,marker).frequency);
 expect(census(a,marker).marked).toBe(selected.length);
 }
});
it('refuses invalid donors, duplicate sites and inadequate substrate',()=>{
 const s=state(),selected=sites(s,9101);expect(()=>inoculate(s,[selected[0],selected[0]],4,true)).toThrow();
 const n=cellCount(s.cfg);s.cells.fill(0,CH.B*n,(CH.B+1)*n);expect(()=>sites(s,9101)).toThrow('SETUP-STOP');
});
const rows=(f:number):Census[]=>Array.from({length:11},(_,i)=>{
 const marked=Math.round((i===0?.01:f)*100000);
 return {step:6000+i*1000,frequency:marked/100000,marked,parent:100000-marked,living:100000,markedMass:marked,types:[100000,0,0,0,0],globalShare:marked/100000,exposed:marked?1:0};
});
it('does not count identifier repeats as independent and never passes identical arms',()=>{
 const batch=SEEDS.flatMap(seed=>MARKERS.flatMap(marker=>[false,true].map(immune=>({seed,marker,immune,rows:rows(.01)}))));
 expect(verdict(batch).label).toBe('NO-SELECTION-LEAD');
 for(const r of batch)if(r.immune&&r.seed!==1104)r.rows=rows(.02);
 expect(verdict(batch).label).toBe('SELECTION-LEAD');
 const extinct=structuredClone(batch);extinct.filter(r=>r.immune).forEach(r=>{r.rows[10]={...r.rows[10],marked:0,parent:100000,markedMass:0,frequency:0,globalShare:0,exposed:0};});expect(verdict(extinct).label).toBe('NO-SELECTION-LEAD');
 batch.find(r=>r.immune&&r.seed===1103&&r.marker===5)!.rows=rows(.01999);
 expect(verdict(batch).label).toBe('NO-SELECTION-LEAD');
 const malformed=structuredClone(batch);malformed[0].rows[10].frequency=NaN;expect(()=>verdict(malformed)).toThrow('Malformed');
 expect(()=>verdict(batch.slice(1))).toThrow();expect(()=>meanFinal(rows(.1).slice(1))).toThrow();
});

it('counts parent and immigrant separately and handles a zero denominator',()=>{
 const s=state(),n=cellCount(s.cfg);s.cells.fill(0);s.genome.fill(0);
 for(const [i,type,marker,B]of [[0,0,4,3],[1,0,1,7],[2,2,3,2],[3,3,4,0]]){
  s.genome[G.LIN_LO*n+i]=marker;s.genome[G.PARAM1*n+i]=type<<8;s.cells[CH.B*n+i]=B;
 }
 const c=census(s,4);expect(c.marked).toBe(1);expect(c.parent).toBe(1);expect(c.living).toBe(3);expect(c.markedMass).toBe(3);expect(c.frequency).toBe(.5);expect(c.globalShare).toBe(1/3);
 s.cells.fill(0);expect(census(s,4).frequency).toBe(0);expect(census(s,4).globalShare).toBe(0);
});
