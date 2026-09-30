// Independent stricter validation; does not alter the frozen measurement runner.
import { type Design } from './discovery_capability.ts';
import { validateReceipt } from './lib/discovery-receipt-validation.ts';
import { sha256 } from './lib/founder-policy.ts';
const [root,out]=Deno.args;if(!root||!out)throw Error('usage: discovery_validate.ts ROOT NEW_REPORT');
const text=await Deno.readTextFile(`${root}/capability-design.json`),design:Design=JSON.parse(text),designHash=sha256(text);
for(const [p,h] of Object.entries({...design.inputs,...design.sources}))if(sha256(await Deno.readFile(p))!==h)throw Error(`Source/input drift ${p}`);
const units=[];
for(const unit of design.units){
  try{const raw=await Deno.readTextFile(`${root}/capability-results/${unit.id}.json`);validateReceipt(JSON.parse(raw),design,designHash,unit);units.push({id:unit.id,status:'valid',sha256:sha256(raw)});}
  catch(e){units.push({id:unit.id,status:e instanceof Deno.errors.NotFound?'missing':'invalid',error:String(e)});}
}
const invalid=units.filter(u=>u.status==='invalid').length,missing=units.filter(u=>u.status==='missing').length;
const report={designHash,status:invalid?'invalid':missing?'incomplete':'complete',valid:units.length-invalid-missing,missing,invalid,units,validatorSha256:sha256(await Deno.readFile('tools/lib/discovery-receipt-validation.ts'))};
await Deno.writeTextFile(out,JSON.stringify(report,null,2)+'\n',{createNew:true});console.log(JSON.stringify({status:report.status,valid:report.valid,missing,invalid}));
if(invalid)Deno.exit(1);
