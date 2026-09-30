// Freeze a diverse candidate shortlist only after complete capability evidence.
import { geneticClusters, type Genome } from '@bl/schema';
import { normalizeGenome, fromHex, toHex } from './lib/selection-funnel-audit.ts';
import { sha256 } from './lib/founder-policy.ts';
const [root,activityPath,out]=Deno.args;if(!root||!activityPath||!out)throw Error('usage: discovery_select.ts ROOT ACTIVITY_REPORT NEW_SHORTLIST');
const activityText=await Deno.readTextFile(activityPath),activity=JSON.parse(activityText);
const designText=await Deno.readTextFile(`${root}/capability-design.json`);
if(activity.status!=='complete'||activity.designHash!==sha256(designText))throw Error('Complete matching activity report required');
const strictText=await Deno.readTextFile(`${root}/strict-validation-final.json`),strict=JSON.parse(strictText);
if(strict.status!=='complete'||sha256(strictText)!==activity.strictValidationSha256)throw Error('Matching complete strict validation required');
const inventoryText=await Deno.readTextFile(`${root}/initial-inventory/inventory.json`),inventory=JSON.parse(inventoryText);
for(const [p,v] of Object.entries(inventory.files) as [string,{sha256:string}][])if(sha256(await Deno.readFile(`${root}/initial-inventory/${p}`))!==v.sha256)throw Error(`Archive drift ${p}`);
const pool=new Map<string,Genome>();
for(const name of ['bootstrap-medium-waste','bootstrap-medium-background']){
  const archive=JSON.parse(await Deno.readTextFile(`${root}/initial-inventory/${name}/archive.json`));
  const lines=(await Deno.readTextFile(`${root}/initial-inventory/${name}/viable.jsonl`)).trim().split('\n');
  if(lines.length!==archive.viableCount)throw Error('Committed prefix mismatch');
  for(const text of lines){const row=JSON.parse(text);if(row.eval.survived<=0)continue;const g=normalizeGenome(row.genome);pool.set(toHex(g),{...g,weights:Int8Array.from(g.weights)});}
}
const hexes=[...pool.keys()],clusters=geneticClusters([...pool.values()]),clusterOf=new Map(hexes.map((h,i)=>[h,clusters[i]]));
const roster=JSON.parse(await Deno.readTextFile(`${root}/candidates.json`));
const validCandidates=new Map<string,string>();
for(const study of roster.studies)for(const [i,c] of study.selected.entries())validCandidates.set(`${study.name.endsWith('waste')?'waste':'background'}-${i}`,c.hex);
const eligible=new Map<string,{hex:string;cluster:number;subjects:string[]}>();
for(const group of activity.groups){if(group.environment!=='gradient'||!group.broaderEligible||!validCandidates.has(group.subject))continue;
  if(validCandidates.get(group.subject)!==group.hex||!clusterOf.has(group.hex))throw Error('Candidate identity mismatch');
  fromHex(group.hex);
  const old=eligible.get(group.hex);if(old)old.subjects.push(group.subject);else eligible.set(group.hex,{hex:group.hex,cluster:clusterOf.get(group.hex)!,subjects:[group.subject]});
}
const namespace='founder-discovery-improvement-v1-selection-2026-09-30';
const groups=new Map<number,typeof eligible extends Map<string,infer T>?T[]:never>();
for(const row of eligible.values()){if(!groups.has(row.cluster))groups.set(row.cluster,[]);groups.get(row.cluster)!.push(row);}
const ordered=[...groups].map(([cluster,members])=>({cluster,members,rank:sha256(`${namespace}/cluster/${cluster}`)})).sort((a,b)=>a.rank.localeCompare(b.rank)||a.cluster-b.cluster);
const selected=ordered.slice(0,4).map(({cluster,members})=>{members.sort((a,b)=>sha256(`${namespace}/genome/${a.hex}`).localeCompare(sha256(`${namespace}/genome/${b.hex}`)));return {...members[0],id:`discovery-cluster-${cluster}`};});
const report={status:selected.length?'shortlisted-awaiting-fresh-assay-confirmation':'no-eligible-candidates',namespace,poolUnique:pool.size,poolClusters:new Set(clusters).size,eligibleGenomes:eligible.size,eligibleClusters:groups.size,eligible:[...eligible.values()],selected,selection:'At most four hash-ranked distinct clusters, then one hash-ranked eligible genome per cluster. Distance-10 single linkage reconstructed over the full union of both committed surviving pools. No growth/regeneration ranking. This is an exploratory shortlist, not confirmed founders or an evolution result.',inputHashes:{activity:sha256(activityText),strictValidation:sha256(strictText),inventory:sha256(inventoryText),design:sha256(designText)},selectorSha256:sha256(await Deno.readFile('tools/discovery_select.ts'))};
await Deno.writeTextFile(out,JSON.stringify(report,null,2)+'\n',{createNew:true});console.log(JSON.stringify({status:report.status,poolUnique:report.poolUnique,poolClusters:report.poolClusters,eligibleGenomes:report.eligibleGenomes,eligibleClusters:report.eligibleClusters,selected:selected.length}));
