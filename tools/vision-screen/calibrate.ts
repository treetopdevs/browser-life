/** Real local CLIP calibration, before any simulation selection. Node24.2.0. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { calibrationFixtures, rasterFrame, PROMPTS } from '../../apps/lab/src/vision-screen/core.ts';

const root = resolve(import.meta.dirname, '../..');
const runDir = resolve(root, 'runs/vision-screen/calibration');
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const tracked = ['apps/lab/src/vision-screen/core.ts','tools/vision-screen/calibrate.ts','tools/vision-screen/score.py'];
function hashes() { return Object.fromEntries(tracked.map(path => [path, hash(readFileSync(resolve(root,path)))])); }
function atomic(path: string, value: unknown) { const text=JSON.stringify(value,null,2)+'\n'; if(Buffer.byteLength(text)>32*1024*1024) throw Error('Artifact exceeds32MiB'); writeFileSync(path+'.tmp',text); renameSync(path+'.tmp',path); }
if (process.version !== 'v24.2.0') throw Error('Calibration capture requires Node v24.2.0');
if(existsSync(runDir)) throw Error('Calibration output directory already exists; preserve it under another name before rerunning. No files were written.');
mkdirSync(runDir,{recursive:true});
const before=hashes();
const fixtures=calibrationFixtures();
const items=fixtures.map(fixture=>{
  const rgb=rasterFrame(fixture.frame), path=fixture.id+'.ppm';
  writeFileSync(resolve(runDir,path),Buffer.concat([Buffer.from('P6\n128 128\n255\n'),Buffer.from(rgb)]));
  return {id:fixture.id,frames:[{path,sha256:hash(rgb)}]};
});
const representative=items.find(item=>item.id===fixtures.find(f=>f.count===120&&f.layout===0&&f.group==='12')?.id)!;
items.push({id:'frozen-repeat',frames:[representative.frames[0],representative.frames[0]]});
atomic(resolve(runDir,'manifest.json'),{schemaVersion:1,prompts:PROMPTS.map(prompt=>prompt.text),items});
const result=spawnSync(resolve(root,'runs/vision-screen/.venv/bin/python'),[resolve(root,'tools/vision-screen/score.py'),'--manifest',resolve(runDir,'manifest.json'),'--output',resolve(runDir,'scores.json'),'--model-dir',resolve(root,'runs/vision-screen/model')],{cwd:root,encoding:'utf8',timeout:20*60*1000,maxBuffer:1024*1024});
writeFileSync(resolve(runDir,'scorer.log'),(result.stdout??'')+(result.stderr??''));
if(result.error||result.status!==0){atomic(resolve(runDir,'interrupted.json'),{status:'interrupted',stage:'calibration-scoring',error:String(result.error??result.status),completedIds:[],sourceSha256:before});throw Error('Scorer failed; inspect calibration/scorer.log');}
if(JSON.stringify(before)!==JSON.stringify(hashes()))throw Error('Calibration source changed during scoring; result not accepted');
console.log('Calibration input and real local scores written; inspect scores and validate gate before selection.');
