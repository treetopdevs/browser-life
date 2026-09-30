import { initial, masses, type Design } from './discovery_capability.ts';
import { sha256 } from './lib/founder-policy.ts';
import { GpuSim, requestDevice } from '@bl/sim-gpu';
import { stateHash } from '@bl/schema';
const [root,id,out]=Deno.args;
if(!root||!id||!out)throw Error('usage: replay ROOT UNIT_ID OUTPUT');
const raw=await Deno.readTextFile(`${root}/capability-design.json`), design:Design=JSON.parse(raw);
for(const [p,h] of Object.entries({...design.inputs,...design.sources}))if(sha256(await Deno.readFile(p))!==h)throw Error(`Source drift ${p}`);
const unit=design.units.find(u=>u.id===id);if(!unit)throw Error('Unknown unit');
const prior=JSON.parse(await Deno.readTextFile(`${root}/capability-results/${id}.json`));if(prior.designHash!==sha256(raw))throw Error('Design mismatch');
const init=initial(design,unit),device=await requestDevice(navigator.gpu),sim=await GpuSim.create(device,init.state);
const samples=[];let state=init.state;
try{for(const end of design.times){for(let t=state.step;t<end;t+=100){sim.run(Math.min(100,end-t));await device.queue.onSubmittedWorkDone();}if(end>0)state=await sim.readState();samples.push({step:state.step,mass:masses(state,init.candidateLo,init.backgroundLo),flux:state.flux.map(String),stateHash:stateHash(state)});}}finally{sim.destroy();device.destroy()}
const pass=JSON.stringify(samples)===JSON.stringify(prior.samples);
await Deno.writeTextFile(out,JSON.stringify({id,designHash:sha256(raw),pass,samples,replaySourceSha256:sha256(await Deno.readFile('tools/discovery_capability_replay.ts'))},null,2)+'\n',{createNew:true});
if(!pass)throw Error('Replay differs');console.log(JSON.stringify({id,pass}));
