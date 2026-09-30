import { initial, masses, continuation, type Design, type Unit } from '../discovery_capability.ts';
import { stateHash, FLUX_NAMES } from '@bl/schema';
export interface Sample {step:number;mass:{candidate:number;background:number;unassociated:number;unknown:number};flux:string[];stateHash:string}
export interface Receipt {designHash:string;unit:Unit;samples:Sample[];standaloneContinuation:boolean|null;elapsedSeconds:number}
export function validateReceipt(raw:unknown,design:Design,designHash:string,unit:Unit):Receipt {
  const r=raw as Receipt;
  if(!r || typeof r!=='object'||r.designHash!==designHash||JSON.stringify(r.unit)!==JSON.stringify(unit))throw Error('Receipt identity mismatch');
  if(!Array.isArray(r.samples)||r.samples.length!==design.times.length||r.samples.some((s,i)=>!s||s.step!==design.times[i]))throw Error('Exact-time roster mismatch');
  if(!Number.isFinite(r.elapsedSeconds)||r.elapsedSeconds<0)throw Error('Invalid elapsed time');
  let previous:bigint[]|undefined;
  for(const s of r.samples){
    if(!s.mass||typeof s.mass!=='object')throw Error('Missing mass');
    for(const field of ['candidate','background','unassociated','unknown'] as const)if(!Number.isSafeInteger(s.mass[field])||s.mass[field]<0)throw Error(`Invalid mass.${field}`);
    if(s.mass.unknown!==0)throw Error('Unresolved copy lineage');
    if(unit.hex===null&&s.mass.candidate!==0)throw Error('Absent candidate has associated mass');
    if(unit.environment!=='background'&&s.mass.background!==0)throw Error('Absent background has associated mass');
    if(typeof s.stateHash!=='string'||!/^[0-9a-f]{16}$/.test(s.stateHash))throw Error('Invalid state hash');
    if(!Array.isArray(s.flux)||s.flux.length!==FLUX_NAMES.length||s.flux.some(x=>typeof x!=='string'||!/^(0|[1-9][0-9]*)$/.test(x)))throw Error('Malformed cumulative flux');
    const flux=s.flux.map(BigInt);if(previous&&flux.some((x,i)=>x<previous![i]))throw Error('Decreasing cumulative flux');previous=flux;
    if(unit.hex===null&&unit.environment!=='background'){
      if(Object.values(s.mass).some(x=>x!==0))throw Error('Empty unsupported control has bound mass');
      if(flux[FLUX_NAMES.indexOf('photo')]!==0n||flux[FLUX_NAMES.indexOf('grow')]!==0n)throw Error('Empty unsupported control has synthesis');
    }
  }
  const start=initial(design,unit),s=r.samples[0];
  if(s.stateHash!==stateHash(start.state)||JSON.stringify(s.mass)!==JSON.stringify(masses(start.state,start.candidateLo,start.backgroundLo))||JSON.stringify(s.flux)!==JSON.stringify(start.state.flux.map(String)))throw Error('Initial state/mass/flux mismatch');
  if(r.standaloneContinuation!==continuation(r.samples,unit.environment==='background'))throw Error('Frozen classification mismatch');
  return r;
}
