import { validateReceipt, type Receipt } from '../lib/discovery-receipt-validation.ts';
import { initial, masses, continuation, type Design, type Unit } from '../discovery_capability.ts';
import { defaultConfig, generalistGenome, stateHash, DEFAULT_RULE_VERSION } from '@bl/schema';
import { toHex } from '../lib/selection-funnel-audit.ts';
const g=generalistGenome(60,20),plain={...g,weights:Array.from(g.weights)},cfg=defaultConfig({tileW:64,tileH:64,tilesX:1,tilesY:1,mutRate:0});
const design:Design={ruleVersion:DEFAULT_RULE_VERSION,inputs:{},sources:{},units:[],background:plain,configs:{waste:cfg,background:cfg,gradient:cfg},times:[0,1000,3000,10000],criterion:'test'};
function fixture(supported=false,empty=false):[Receipt,Unit]{const unit:Unit={id:'test',subject:'test',hex:empty?null:toHex(plain),environment:supported?'background':'waste',seed:6300001};const a=initial(design,unit);const samples=design.times.map(step=>({step,mass:masses(a.state,a.candidateLo,a.backgroundLo),flux:a.state.flux.map(String),stateHash:stateHash(a.state)}));return [{designHash:'fixed',unit,samples,standaloneContinuation:continuation(samples,supported),elapsedSeconds:1},unit];}
function rejected(r:Receipt,u:Unit){let caught=false;try{validateReceipt(r,design,'fixed',u)}catch{caught=true}if(!caught)throw Error('Invalid receipt accepted');}
Deno.test('valid complete synthetic receipt is accepted',()=>{const [r,u]=fixture();validateReceipt(r,design,'fixed',u)});
Deno.test('omitted supported candidate mass is rejected',()=>{const [r,u]=fixture(true);delete (r.samples[1].mass as Partial<typeof r.samples[1]['mass']>).candidate;rejected(r,u)});
Deno.test('missing, negative, and decreasing cumulative fluxes rejected',()=>{for(const kind of ['missing','negative','decreasing']){const [r,u]=fixture(true);if(kind==='missing')r.samples[1].flux=[];else if(kind==='negative')r.samples[1].flux[0]='-1';else r.samples[1].flux[0]='1';rejected(r,u)}});
Deno.test('altered initial mass is rejected',()=>{const [r,u]=fixture();r.samples[0].mass.candidate++;rejected(r,u)});
Deno.test('empty unsupported unassociated biomass is rejected',()=>{const [r,u]=fixture(false,true);r.samples[3].mass.unassociated=1;rejected(r,u)});
Deno.test('missing sample is rejected instead of counted as extinction',()=>{const [r,u]=fixture();r.samples.pop();rejected(r,u)});

Deno.test('producer-only control cannot acquire candidate mass',()=>{const [r,u]=fixture(true,true);r.samples[3].mass.candidate=1;rejected(r,u)});
Deno.test('unsupported candidate cannot acquire producer mass',()=>{const [r,u]=fixture();r.samples[3].mass.background=1;rejected(r,u)});
