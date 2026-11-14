import { CH, G, cellCount, lowbias32, type WorldState } from '@bl/schema';
export const SEEDS = [1101,1102,1103,1104] as const;
export const MARKERS = [4,5] as const;
export const BURN = 6000, HORIZON = 10000, EVERY = 1000;
export interface Census { step:number; marked:number; parent:number; living:number; markedMass:number; types:number[]; frequency:number; globalShare:number; exposed:number }
export function census(s:WorldState,marker:number):Census {
 const n=cellCount(s.cfg);let marked=0,parent=0,living=0,markedMass=0,exposed=0;const types=Array(5).fill(0) as number[];
 for(let i=0;i<n;i++){
  const hi=s.genome[G.LIN_HI*n+i],lo=s.genome[G.LIN_LO*n+i];
  const mass=s.cells[CH.B*n+i]+s.cells[CH.P*n+i];
  if(!(hi||lo)||mass===0)continue;
  living++;const type=(s.genome[G.PARAM1*n+i]>>>8)&255;types[type]++;
  if(hi===0&&lo===marker){marked++;markedMass+=mass;if(hasPredator(s,i))exposed++;}else if(type===0)parent++;
 }
 return {step:s.step,marked,parent,living,markedMass,types,exposed,frequency:marked+parent?marked/(marked+parent):0,globalShare:living?marked/living:0};
}
/** Census-time exposure to a predator of ancestral type 0; a diagnostic, not an exact kill counter. */
export function hasPredator(s:WorldState,i:number):boolean {
 const n=cellCount(s.cfg),w=s.cfg.tileW,h=s.cfg.tileH,d=s.cfg.tileD!,x=i%w,y=Math.floor(i/w)%h,z=Math.floor(i/(w*h));
 for(const [dx,dy,dz]of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
  if(z+dz<0||z+dz>=d)continue;
  const j=((z+dz)*h+(y+dy+h)%h)*w+(x+dx+w)%w;
  if(s.cells[CH.B*n+j]>=s.cfg.rpsMin!&&((s.cells[CH.MOT*n+j]>>>24)&1))return true;
 }
 return false;
}
export function sites(s:WorldState,seed:number):number[]{
 const n=cellCount(s.cfg);const eligible:number[]=[];
 for(let i=0;i<n;i++)if((s.genome[G.LIN_HI*n+i]||s.genome[G.LIN_LO*n+i])&&s.cells[CH.B*n+i]+s.cells[CH.P*n+i]>0&&((s.genome[G.PARAM1*n+i]>>>8)&255)===0)eligible.push(i);
 if(eligible.length<100)throw Error('SETUP-STOP: fewer than 100 eligible parent cells');
 eligible.sort((a,b)=>(lowbias32(seed^a)-lowbias32(seed^b))||(a-b));
 return eligible.slice(0,Math.max(1,Math.floor(eligible.length/100)));
}
export function inoculate(s:WorldState,selected:number[],marker:number,immune:boolean):WorldState {
 if(!MARKERS.includes(marker as 4|5)||!selected.length||new Set(selected).size!==selected.length)throw Error('Invalid marker or sites');
 const out=structuredClone(s),n=cellCount(s.cfg);
 for(const i of selected){
  if(!Number.isInteger(i)||i<0||i>=n)throw Error('Invalid site');
  const word=s.genome[G.PARAM1*n+i];
  if(s.genome[G.LIN_HI*n+i]!==0||s.genome[G.LIN_LO*n+i]!==1||((word>>>8)&255)!==0||((word>>>16)&255)!==2||s.cells[CH.B*n+i]+s.cells[CH.P*n+i]===0)throw Error('Invalid donor');
  out.genome[G.LIN_LO*n+i]=marker;
  if(immune)out.genome[G.PARAM1*n+i]=(word&0xffff00ff)|(3<<8);
 }
 // Cells, all controllers, masks, and all nonselected genome words are unchanged by construction.
 return out;
}
export function meanFinal(rows:Census[]):number {
 if(rows.length!==11||rows.some((r,i)=>r.step!==BURN+i*EVERY))throw Error('Incomplete census schedule');
 for(const r of rows){
  if([r.marked,r.parent,r.living,r.markedMass,r.exposed,...r.types].some(v=>!Number.isSafeInteger(v)||v<0)||r.types.length!==5||r.types.reduce((a,b)=>a+b,0)!==r.living||r.marked+r.parent>r.living||r.exposed>r.marked||r.frequency!==(r.marked+r.parent?r.marked/(r.marked+r.parent):0)||r.globalShare!==(r.living?r.marked/r.living:0))throw Error('Malformed census');
 }
 return rows.slice(-3).reduce((a,r)=>a+r.frequency,0)/3;
}
function exactMean(rows:Census[]):[bigint,bigint]{
 let a=0n,b=1n;
 for(const r of rows.slice(-3)){const d=BigInt(r.marked+r.parent);if(d){a=a*d+BigInt(r.marked)*b;b*=d;}}
 return [a,b*3n];
}
export function verdict(results:{seed:number;marker:number;immune:boolean;rows:Census[]}[]){
 if(results.length!==16)throw Error('Incomplete batch');
 const pairs=SEEDS.flatMap(seed=>MARKERS.map(marker=>{
  const get=(immune:boolean)=>{const xs=results.filter(r=>r.seed===seed&&r.marker===marker&&r.immune===immune);if(xs.length!==1)throw Error('Duplicate/missing arm');return xs[0].rows;};
  const a=get(true),b=get(false),initial=a[0].frequency;
  if(!(initial>0)||initial!==b[0].frequency)throw Error('Mismatched initial frequencies');
  const immuneMean=meanFinal(a),neutralMean=meanFinal(b);
  const [an,ad]=exactMean(a),[bn,bd]=exactMean(b);
  const doublesStart=an*BigInt(a[0].marked+a[0].parent)>=2n*BigInt(a[0].marked)*ad;
  const doublesNeutral=an*bd>=2n*bn*ad;
  return {seed,marker,initial,immuneMean,neutralMean,pass:a.at(-1)!.marked>0&&doublesStart&&doublesNeutral};
 }));
 const seeds=SEEDS.map(seed=>({seed,pass:pairs.filter(p=>p.seed===seed).every(p=>p.pass)}));
 return {label:seeds.filter(s=>s.pass).length>=3?'SELECTION-LEAD':'NO-SELECTION-LEAD',independentSeeds:4,pairs,seeds};
}
