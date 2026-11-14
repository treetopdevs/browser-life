import {createHash} from 'node:crypto';
import * as fs from 'node:fs';
import {decodeCheckpoint,stateHash,validateState} from '@bl/schema';
import {census,verdict} from './assay.ts';
const dir='runs/rps/invasion-a4-v1';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const require=(ok:boolean,msg:string)=>{if(!ok)throw Error(msg);};
const read=(name:string)=>JSON.parse(fs.readFileSync(`${dir}/${name}`,'utf8'));
require(!fs.existsSync(`${dir}/STOP.json`),'Stopped batch');
const manifest=read('manifest.json');
for(const [p,h] of Object.entries(manifest.sha256))require(sha(fs.readFileSync(p))===h,`source ${p}`);
const rows:any[]=[];const checks:any[]=[];
for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.blck'))){
 const bytes=fs.readFileSync(`${dir}/${file}`),{state}=decodeCheckpoint(bytes);
 require(validateState(state).length===0,`invalid ${file}`);
 const h=sha(bytes);const record=read(file.replace('.blck',file.includes('-burn')?'-sites.json':'.json').replace('-burn-sites','-sites'));
 require(h===(file.includes('-burn')?record.burnHash:record.outputHash),`digest ${file}`);
 if(!file.includes('-burn')){
  require(stateHash(state)===record.endStateHash,`state ${file}`);
  require(JSON.stringify(census(state,record.marker))===JSON.stringify(record.rows.at(-1)),`census ${file}`);
  rows.push(record);
 }
 checks.push({file,sha256:h,stateHash:stateHash(state)});
}
require(checks.length===20&&rows.length===16,'checkpoint count');
const decision=verdict(rows),result=read('RESULT.json');
for(const key of ['label','independentSeeds','pairs','seeds'])require(JSON.stringify(decision[key])===JSON.stringify(result[key]),`verdict ${key}`);
const bytes=fs.readdirSync(dir).reduce((sum,f)=>sum+fs.statSync(`${dir}/${f}`).size,0);
require(bytes<2*1024**3&&result.wallSeconds<=5400,'budget');
console.log(JSON.stringify({verified:true,checkpointCount:checks.length,bytes,decision,checks},null,2));
