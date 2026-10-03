// CPU-only exploratory follow-up to the immobile constructed retention witness.
// deno run --allow-read --allow-write tools/construction-flow-probe.ts [--phase base|cheap|compact-ablation|compact-factorial|compact-gains|compact-confirmation] [--out DIR] [--seed N] [--steps N] [--limit N] [--gain N] [--size N]
// Every attempted candidate, including extinction, is retained. No claim of evolution.
import { CH, FLUX_NAMES, cellCount, encodeCheckpoint, genomeHex, ledgerResidual, stateHash, totalsOf, validateState, type WorldConfig } from '@bl/schema';
import { RefSim } from '@bl/sim-ref';
import { constructionConfig, constructionGenome, constructionWorld } from './lib/construction.ts';
import { newConstructionOutput } from './lib/construction-provenance.ts';
import { patchTransport, type PatchTransport } from './lib/construction-transport.ts';

function option(name:string,fallback:string):string {const i=Deno.args.indexOf(name);return i<0?fallback:Deno.args[i+1]??(()=>{throw new Error(`missing ${name}`);})();}
const out=option('--out','runs/construction/flow-pilot'), seed=Number(option('--seed','1'));
const phase=option('--phase','base');
if(!['base','cheap','compact-ablation','compact-factorial','compact-gains','compact-confirmation'].includes(phase))throw new Error('invalid phase');
const chosenGain=Number(option('--gain','1024'));
if(!Number.isInteger(chosenGain)||chosenGain<0||chosenGain>1024)throw new Error('invalid adhesion gain');
const size=Number(option('--size','24'));
if(!Number.isInteger(size)||size<8||size>4096||size%8!==0)throw new Error('size must be a multiple of 8 in 8..4096');
const steps=Number(option('--steps','3000')), limit=Number(option('--limit','16'));
if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||!Number.isInteger(steps)||steps<1||!Number.isInteger(limit)||limit<1)throw new Error('invalid seed, steps or limit');
interface Candidate {name:string;patch:number;biomass:number;mu:number;sigma:number;cfg:Partial<WorldConfig>;reason:string;}
const standard={dtQ:51,spread:1,kernelRadius:4,gateK:1};
const allCandidates:Candidate[]=[
  {name:'compact-mu38',patch:3,biomass:256,mu:38,sigma:27,cfg:standard,reason:'Requested low-mu Flow-Lenia reference; low spread.'},
  {name:'compact-mu60',patch:3,biomass:256,mu:60,sigma:20,cfg:standard,reason:'Requested intermediate-mu reference.'},
  {name:'compact-mu154',patch:3,biomass:256,mu:154,sigma:24,cfg:standard,reason:'Original construction genome with physical flow.'},
  {name:'wide-default-flow',patch:5,biomass:256,mu:154,sigma:24,cfg:{...standard,spread:8},reason:'Larger initial support at default dt/spread.'},
  {name:'dense-mu154',patch:5,biomass:512,mu:154,sigma:27,cfg:standard,reason:'More initial local catalyst without weakening decay.'},
  {name:'dense-soft-crowding',patch:5,biomass:512,mu:154,sigma:27,cfg:{...standard,thetaMass:2048},reason:'Avoid immediate crowding dispersion of dense seed.'},
  {name:'dense-mu384',patch:5,biomass:512,mu:384,sigma:64,cfg:{...standard,thetaMass:2048},reason:'Density target ~96 quanta instead of ~9.5 at mu38.'},
  {name:'dense-mu640',patch:5,biomass:512,mu:640,sigma:96,cfg:{...standard,thetaMass:2048},reason:'Density target ~160 quanta near catalyst half-saturation128.'},
  {name:'large-kernel-lowmu',patch:5,biomass:512,mu:38,sigma:27,cfg:{...standard,kernelRadius:9},reason:'Requested broad spatial kernel with low-mu target.'},
  {name:'large-kernel-mu154',patch:5,biomass:512,mu:154,sigma:27,cfg:{...standard,kernelRadius:9,thetaMass:2048},reason:'Broader kernel and dense seed without immediate crowding.'},
  {name:'dense-mu640-gate4',patch:5,biomass:512,mu:640,sigma:96,cfg:{...standard,thetaMass:2048,gateK:4},reason:'Weaker membrane barrier permits more uptake as well as escape.'},
  {name:'dense-mu640-spread8',patch:5,biomass:512,mu:640,sigma:96,cfg:{...standard,thetaMass:2048,spread:8},reason:'Higher density target at default reintegration spread.'},
  {name:'adhesion64-mu154',patch:5,biomass:512,mu:154,sigma:27,cfg:{...standard,thetaMass:2048,adhesion:true,kAdhesion:64},reason:'Existing polymer-gradient adhesion at its default gain.'},
  {name:'adhesion1024-mu154',patch:5,biomass:512,mu:154,sigma:27,cfg:{...standard,thetaMass:2048,adhesion:true,kAdhesion:1024},reason:'Existing adhesion at maximum gain tests whether dilution is avoidable.'},
  {name:'adhesion1024-mu640',patch:5,biomass:512,mu:640,sigma:96,cfg:{...standard,thetaMass:2048,adhesion:true,kAdhesion:1024},reason:'Combine finite existing adhesion and catalyst-compatible density target.'},
  {name:'compact-dense-mu640',patch:3,biomass:512,mu:640,sigma:96,cfg:{...standard,thetaMass:2048,adhesion:true,kAdhesion:1024},reason:'Check whether the largest-seed candidate depends on a large inoculum.'},
];
const candidates=(phase==='cheap'?allCandidates.filter(c=>['large-kernel-mu154','adhesion1024-mu640'].includes(c.name)):
  phase.startsWith('compact-')?allCandidates.filter(c=>c.name==='compact-dense-mu640').map(c=>({...c,cfg:{...c.cfg,kAdhesion:chosenGain,adhesion:chosenGain>0}})):allCandidates).slice(0,limit);
const builds=phase==='cheap'?[0,1,2,4,8]:[0,16];
await newConstructionOutput(out);
const stringify=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
const sourceFiles=['tools/construction-flow-probe.ts','tools/lib/construction.ts','tools/lib/construction-provenance.ts','tools/lib/construction-transport.ts',
  'packages/sim-ref/src/step.ts','packages/schema/src/config.ts','packages/schema/src/world.ts',
  'packages/schema/src/genome.ts','packages/schema/src/layout.ts','packages/schema/src/int.ts',
  'packages/schema/src/kernel.ts','packages/schema/src/accounting.ts','packages/schema/src/checkpoint.ts'];
const sourceSha256:Record<string,string>={};
for(const path of sourceFiles){
  const bytes=await Deno.readFile(path);
  sourceSha256[path]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const snapshot=`${out}/sources/${path}`;await Deno.mkdir(snapshot.slice(0,snapshot.lastIndexOf('/')),{recursive:true});await Deno.writeFile(snapshot,bytes);
}
const protocol={kind:'exploratory constructed flow retention probe',phase,seed,steps,size,builders:builds,candidates,sourceSha256,
  ...(phase==='compact-gains'?{adhesionGains:[0,64,256,512,1024],nonbuilderControl:'One matched BUILD0 control. P initially zero and BUILD flux zero imply P remains identically zero, so adhesion gain cannot affect nonbuilder dynamics.'}:{}),
  ...(phase==='compact-confirmation'?{additionalCompetitor:'Simple PHOTO127 RESP0 DECOMP127 GROW64 BUILD0, same mu640/sigma96, adapted from the stronger stationary-search competitor. Useful independent challenge, not certified best in this different ecology.'}:{}),
  initial:'Square of exact B and E=2B; A=C=P=S=0. Same cell arrays across build0/build16. Separate same-genotype founder ids per planted cell.',
  spatialSampling:'sampledMaxExternalB and sampledMaxActiveCells are maxima only among 100-step census observations and the final observation; intermediate peaks are not measured.',
  endpoint:'Active B, B outside original planted cells, and exact cumulative build cost. P persistence alone is not life.',
  transport:'Exact pre-step A/C directed flux accumulated across the fixed initial planting footprint. It is a spatial patch, not a moving inferred organism. Reported cumulatively through each observed step.',
  earlyStop:'B=0 is absorbing because only B catalyses synthesis. Final material/P state is recorded at observed stop; no full-state extrapolation.',
  selection:'All listed candidates reported. A follow-up signal is builder B >=10% initial B, builder B minus B0 >=5% initial B, and final outside B >=5% initial B; this is an exploratory triage rule, not a scientific success gate. In cheap phase any builder that exceeds its nonbuilder gets an extra cost-retaining transport-off arm, even if below this triage threshold.'};
await Deno.writeTextFile(`${out}/protocol.json`,stringify(protocol));
const summaries:unknown[]=[];
for(const candidate of candidates){
  const pair:Record<string,Record<string,number|string>>={};
  const arms:Array<{build:number;gate:boolean;adhesion?:boolean;gain?:number;strongCompetitor?:boolean}>=(phase==='compact-gains'?[0]:builds).map(build=>({build,gate:true}));
  if(phase.startsWith('compact-')&&phase!=='compact-gains')arms.push({build:16,gate:false});
  if(phase==='compact-factorial')arms.push({build:16,gate:true,adhesion:false},{build:16,gate:false,adhesion:false});
  if(phase==='compact-gains')for(const gain of [0,64,256,512,1024])for(const gate of [true,false])arms.push({build:16,gate,gain,adhesion:gain>0});
  if(phase==='compact-confirmation')arms.push({build:0,gate:true,strongCompetitor:true});
  for(const arm of arms){
    const {build,gate,adhesion,gain,strongCompetitor}=arm;
    const cfg=constructionConfig(seed,{tileW:size,tileH:size,...candidate.cfg,...(gate?{}:{polymerTransport:false}),...(adhesion===undefined?{}:{adhesion}),...(gain===undefined?{}:{kAdhesion:gain})});
    const controllerSpec=strongCompetitor?{build:0,photo:127,resp:0,decomp:127,grow:64}:{build};
    const genome=constructionGenome(controllerSpec);genome.mu=candidate.mu;genome.sigma=candidate.sigma;
    const placements=[];
    for(let dy=-(candidate.patch>>1);dy<=candidate.patch>>1;dy++)for(let dx=-(candidate.patch>>1);dx<=candidate.patch>>1;dx++)
      placements.push({x:(size>>1)+dx,y:(size>>1)+dy,genome,biomass:candidate.biomass,energy:2*candidate.biomass});
    const initial=constructionWorld(cfg,placements),n=cellCount(cfg),mask=new Uint8Array(n);
    for(const p of placements)mask[p.y*cfg.tileW+p.x]=1;
    const initialTotals=totalsOf(cfg,initial.cells),initialHash=stateHash(initial);
    const gainSuffix=gain===undefined?(adhesion===false?'-adhesion-off':''):`-adhesion-gain-${gain}`;
    const name=`${candidate.name}-build-${build}${gate?'':'-gate-off'}${gainSuffix}${strongCompetitor?'-simple-competitor':''}-seed-${seed}`;
    // Refuse to silently replace a previous pilot run.
    await Deno.writeFile(`${out}/${name}-initial.blck`,encodeCheckpoint(initial),{createNew:true});
    const sim=new RefSim(initial),started=performance.now();
    let sampledMaxExternalB=0,sampledMaxActiveCells=0;
    const transport:PatchTransport={A:{grossIn:0,grossOut:0,netIn:0,internal:0},C:{grossIn:0,grossOut:0,netIn:0,internal:0}};
    const trace:unknown[]=[];
    function measure(){
      const total=totalsOf(cfg,sim.state.cells);let externalB=0,activeCells=0,maxB=0;
      for(let i=0;i<n;i++){const b=sim.state.cells[CH.B*n+i];if(!mask[i])externalB+=b;if(b>0)activeCells++;maxB=Math.max(maxB,b);}
      sampledMaxExternalB=Math.max(sampledMaxExternalB,externalB);sampledMaxActiveCells=Math.max(sampledMaxActiveCells,activeCells);
      if(total.matter!==initialTotals.matter||ledgerResidual(initialTotals,sim.state)!==0n)throw new Error(`conservation failed ${name} step ${sim.state.step}`);
      const validation=validateState(sim.state);if(validation.length)throw new Error(validation.join('; '));
      const buildQuanta=sim.state.flux[FLUX_NAMES.indexOf('build')];
      const row={step:sim.state.step,B:Number(total.B),P:Number(total.P),A:Number(total.A),C:Number(total.C),E:Number(total.E),externalB,activeCells,maxB,
        transport:{A:{...transport.A},C:{...transport.C}},
        energyResidual:'0',matterResidual:'0',flux:Object.fromEntries(FLUX_NAMES.map((f,i)=>[f,sim.state.flux[i]])),
        buildBiomassCost:buildQuanta,buildFreeEnergyCost:buildQuanta*BigInt(cfg.eP-cfg.eB),lightIn:sim.state.lightIn,heatOut:sim.state.heatOut};
      trace.push(row);return row;
    }
    let final=measure();
    for(let i=0;i<steps;i++){
      const current=patchTransport(sim.state,mask);
      for(const sp of ['A','C'] as const)for(const field of ['grossIn','grossOut','netIn','internal'] as const)transport[sp][field]+=current[sp][field];
      const r=sim.step();if(r.events.length)throw new Error('mutation in mutation-off probe');
      if(sim.state.step%100===0||sim.state.step===steps){final=measure();if(final.B===0)break;}
    }
    await Deno.writeFile(`${out}/${name}-final.blck`,encodeCheckpoint(sim.state),{createNew:true});
    const key=strongCompetitor?'simple-p127-r0-d127-g64':`${build}${gate?'':'-off'}${gain===undefined?(adhesion===false?'-noadh':''):`-g${gain}`}`;
    pair[key]={B:final.B,P:final.P,externalB:final.externalB,activeCells:final.activeCells,maxB:final.maxB,sampledMaxExternalB,sampledMaxActiveCells,
      observedStep:sim.state.step,buildBiomassCost:String(final.buildBiomassCost),buildFreeEnergyCost:String(final.buildFreeEnergyCost)};
    const record={candidate,build,controllerSpec,gate,adhesion:cfg.adhesion===true,seed,cfg,genome:genomeHex(genome),initial:{hash:initialHash,totals:initialTotals,placements:placements.map(({genome:_,...p})=>p)},
      outcome:{...pair[key],extinct:final.B===0,requestedSteps:steps,finalHash:stateHash(sim.state),elapsedMs:performance.now()-started},trace,sourceSha256};
    await Deno.writeTextFile(`${out}/${name}.json`,stringify(record),{createNew:true});
    console.log(JSON.stringify({name,...pair[key],elapsedMs:Math.round(performance.now()-started)}));
    if(phase==='cheap'&&gate&&build>0&&final.B>Number(pair['0'].B))arms.push({build,gate:false});
  }
  const initialB=candidate.patch*candidate.patch*candidate.biomass;
  const signals=Object.entries(pair).filter(([key,r])=>key!=='0'&&!key.startsWith('simple')&&!key.includes('off')&&Number(r.B)>=.1*initialB && Number(r.B)-Number(pair['0'].B)>=.05*initialB && Number(r.externalB)>=.05*initialB).map(([key])=>key);
  summaries.push({name:candidate.name,initialB,pair,followUpSignal:signals.length>0,signalArms:signals});
  await Deno.writeTextFile(`${out}/summary.json`,stringify({protocol,results:summaries}));
}
