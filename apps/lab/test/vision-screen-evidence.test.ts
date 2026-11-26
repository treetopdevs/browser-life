import {it,expect} from 'vitest';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'../../..');
const evidence=JSON.parse(readFileSync(join(root,'docs/creative-prototypes/vision-calibration.json'),'utf8'));
function check(value:unknown){const dir=mkdtempSync(join(tmpdir(),'vision-check-'));try{const path=join(dir,'artifact.json');writeFileSync(path,JSON.stringify(value));return spawnSync(process.execPath,[join(root,'tools/vision-screen/check.ts'),path],{cwd:root,encoding:'utf8'});}finally{rmSync(dir,{recursive:true,force:true});}}
it('accepts the recorded stopped calibration without running inference',()=>{const result=check(evidence);expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('No inference rerun');});
it('rejects missing source and model provenance instead of vacuous hash checks',()=>{for(const patch of [{sourceSha256:{}},{provenance:{}},{runtime:{}},{scoreFileSha256:null}]){const result=check({...evidence,...patch});expect(result.status).not.toBe(0);}});
it('rejects pixel drift and inverted gate conclusions',()=>{const drift=structuredClone(evidence);drift.fixtures[0].frame.dots[0][2]++;expect(check(drift).status).not.toBe(0);expect(check({...evidence,status:'calibration-passed'}).status).not.toBe(0);});
