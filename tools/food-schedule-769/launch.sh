#!/bin/bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
NODE="/Users/nicholas/.nvm/versions/node/v24.2.0/bin/node"
cd "$ROOT"
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 && -x "$NODE" ]] || { echo 'Requires Node24.2.0 on darwin/arm64.' >&2; exit 2; }
export NODE_NO_WARNINGS=1
"$NODE" --experimental-strip-types tools/food-floor-longevity-replication/explore.ts --check --seed 1202
ATTEMPT_DIR="$("$NODE" --experimental-strip-types --input-type=module <<'JS'
import { mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { LOADED_SOURCE_SHA256, assertPinnedInputs, assertSourceIdentity } from './tools/food-schedule-769/explore.ts';
const sha=x=>createHash('sha256').update(x).digest('hex');
const syncPath=p=>{const fd=openSync(p,'r');try{fsyncSync(fd);}finally{closeSync(fd)}};
assertPinnedInputs();assertSourceIdentity();
for(const path of [...Object.keys(LOADED_SOURCE_SHA256),'tools/test/food-schedule-769.test.ts','package.json','pnpm-lock.yaml']){
 if(execFileSync('git',['status','--porcelain','--',path],{encoding:'utf8'}).trim())throw Error(`Uncommitted input ${path}`);
 const committed=execFileSync('git',['show',`HEAD:${path}`],{encoding:'buffer',maxBuffer:32*1024*1024});if(sha(committed)!==sha(readFileSync(path)))throw Error(`Input differs from commit ${path}`);
}
const root=resolve('runs/food-schedule-769/attempts');mkdirSync(root,{recursive:true});
if(readdirSync(root).length)throw Error('Existing attempt/reservation; no automatic retry');
mkdirSync(resolve(root,'reservation.lock'));syncPath(root);
const runId=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z')+'-'+process.pid;
const directory=resolve(root,'run-'+runId);mkdirSync(directory);syncPath(root);
const intent={schemaVersion:1,status:'intent-recorded-before-launch',runId,gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),prelaunchUtc:new Date().toISOString(),seed:1202,mode:'schedule-769',maxTick:6000,gateTick:3000,sourceSha256:LOADED_SOURCE_SHA256,nodeVersion:'24.2.0',environment:{NODE_NO_WARNINGS:'1'},packageJsonSha256:sha(readFileSync('package.json')),pnpmLockSha256:sha(readFileSync('pnpm-lock.yaml')),command:[process.execPath,'--experimental-strip-types','tools/food-schedule-769/explore.ts','--write','--seed','1202','--attempt-dir',directory]};
const bytes=JSON.stringify(intent)+'\n';writeFileSync(resolve(directory,'intent.json'),bytes,{flag:'wx'});syncPath(resolve(directory,'intent.json'));syncPath(directory);
writeFileSync(resolve(root,'reservation.json'),JSON.stringify({schemaVersion:1,status:'reserved',runId,attemptDir:'run-'+runId,intentSha256:sha(bytes)})+'\n',{flag:'wx'});syncPath(resolve(root,'reservation.json'));syncPath(root);syncPath(resolve(root,'..'));
process.stdout.write(directory);
JS
)"
echo "Reserved scheduled attempt: $ATTEMPT_DIR"
set +e
"$NODE" --experimental-strip-types tools/food-schedule-769/explore.ts --write --seed 1202 --attempt-dir "$ATTEMPT_DIR" > "$ATTEMPT_DIR/stdout.log" 2> "$ATTEMPT_DIR/stderr.log"
RUN_STATUS=$?
set -e
"$NODE" --input-type=module - "$ATTEMPT_DIR" "$RUN_STATUS" <<'JS'
import { readFileSync, existsSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
const [directory,code]=process.argv.slice(2),exitStatus=Number(code),failure=resolve(directory,'failures.jsonl');
const classification=exitStatus===0?'completed':existsSync(failure)?JSON.parse(readFileSync(failure,'utf8').trim().split('\n').at(-1)).classification:'invalid';
const path=resolve(directory,'result.json');writeFileSync(path,JSON.stringify({status:exitStatus===0?'completed':'failed',classification,exitStatus,finishedUtc:new Date().toISOString(),stdout:'stdout.log',stderr:'stderr.log'})+'\n',{flag:'wx'});
for(const p of [path,directory]){const fd=openSync(p,'r');try{fsyncSync(fd);}finally{closeSync(fd)}}
JS
cat "$ATTEMPT_DIR/stdout.log"
cat "$ATTEMPT_DIR/stderr.log" >&2
exit "$RUN_STATUS"
