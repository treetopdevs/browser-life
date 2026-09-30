// Full-size gradient competition preparation. No runs are launched by this module.
// This is a new assay design, not a repair or reinterpretation of the failed 128 chamber.
import { buildWorld, cellCount, CELL_CHANNELS, CH, G, lineageKey, packLineageLo, PRESETS, presetConfig, type WorldConfig, type WorldState } from '@bl/schema';
import { asSimGenome } from './founder-policy.ts';
import { fromHex } from './selection-funnel-audit.ts';

const LEFT={x:64,y:128}, RIGHT={x:192,y:128}, RADIUS=12;
export function discoveryCompetitionConfig(seed:number):WorldConfig {
  return {...presetConfig(PRESETS.find(p=>p.id==='gradient-m3')!,seed),mutRate:0};
}
export function discoveryCompetitionWorld(cfg:WorldConfig,descendantHex:string,ancestorHex:string|null,assignment:number){
  if(cfg.tileW!==256||cfg.tileH!==256||cfg.tilesX!==1||cfg.tilesY!==1||cfg.mutRate!==0)throw Error('Competition geometry/measurement mutation setting mismatch');
  if(!Number.isInteger(assignment)||assignment<0||assignment>3)throw Error('Invalid assignment');
  const descendantLeft=(assignment&1)===0,descendantFirst=(assignment&2)===0;
  const d={...(descendantLeft?LEFT:RIGHT),radius:RADIUS,biomass:64,energy:128,genome:asSimGenome(fromHex(descendantHex))};
  const a=ancestorHex!==null?{...(descendantLeft?RIGHT:LEFT),radius:RADIUS,biomass:64,energy:128,genome:asSimGenome(fromHex(ancestorHex))}:null;
  const state=buildWorld(cfg,{nutrient:32,founders:a?(descendantFirst?[d,a]:[a,d]):[d]});
  const descendantRaw=descendantFirst?1:2,ancestorRaw=descendantFirst?2:1;
  const n=cellCount(cfg),W=cfg.tileW;
  // Preserve the planned label even for a one-genome empty-slot control.
  if(!a&&!descendantFirst)for(let i=0;i<n;i++)if(state.genome[G.LIN_LO*n+i]===packLineageLo(cfg,1)&&state.genome[G.LIN_HI*n+i]===0)state.genome[G.LIN_LO*n+i]=packLineageLo(cfg,2);
  const template=buildWorld(cfg,{nutrient:32,founders:[{...d,...LEFT}]});
  for(let dy=-RADIUS;dy<=RADIUS;dy++)for(let dx=-RADIUS;dx<=RADIUS;dx++){
    if(dx*dx+dy*dy>RADIUS*RADIUS)continue;
    const source=(LEFT.y+dy)*W+LEFT.x+dx;
    for(const center of a?[LEFT,RIGHT]:[descendantLeft?LEFT:RIGHT]){
      const target=(center.y+dy)*W+center.x+dx;
      for(let ch=0;ch<CELL_CHANNELS;ch++)state.cells[ch*n+target]=template.cells[ch*n+source];
    }
  }
  return {state,descendantLineage:lineageKey(0,packLineageLo(cfg,descendantRaw)),ancestorLineage:ancestorHex!==null?lineageKey(0,packLineageLo(cfg,ancestorRaw)):null,assignment};
}
export function discoveryCompetitionMasses(state:WorldState,descendantLineage:string,ancestorLineage:string|null){
  const n=cellCount(state.cfg);let descendant=0,ancestor=0,unassociated=0,unexpected=0;
  for(let i=0;i<n;i++){
    const mass=state.cells[CH.B*n+i]+state.cells[CH.P*n+i],hi=state.genome[G.LIN_HI*n+i],lo=state.genome[G.LIN_LO*n+i];
    if(hi===0&&lo===0){unassociated+=mass;continue;}
    const id=lineageKey(hi,lo);if(id===descendantLineage)descendant+=mass;else if(id===ancestorLineage)ancestor+=mass;else unexpected+=mass;
  }
  return {descendant,ancestor,unassociated,unexpected};
}
