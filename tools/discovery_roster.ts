// CPU-only preparation of an exploratory survival-only discovery roster.
import { geneticClusters, type Genome } from '@bl/schema';

import { normalizeGenome, toHex } from './lib/selection-funnel-audit.ts';

const [snapshot, output] = Deno.args;
if (!snapshot || !output) throw new Error('usage: discovery_roster.ts SNAPSHOT OUTPUT');
const enc = new TextEncoder();
async function hash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2,'0')).join('');
}
const manifestText = await Deno.readTextFile(`${snapshot}/inventory.json`);
const manifest = JSON.parse(manifestText);
for (const [name, expected] of Object.entries(manifest.files) as [string, {sha256:string}][]) {
  if (await hash(await Deno.readFile(`${snapshot}/${name}`)) !== expected.sha256) throw new Error(`Source drift: ${name}`);
}
const namespace = 'founder-discovery-v1-survival-only-2026-09-30';
const studies = [];
for (const name of ['bootstrap-medium-waste', 'bootstrap-medium-background']) {
  const rows = (await Deno.readTextFile(`${snapshot}/${name}/viable.jsonl`)).trim().split('\n').map(s=>JSON.parse(s));
  const genomes: Genome[] = [], hexes: string[] = [], observations: {line:number; eval:unknown}[][] = [];
  const seen = new Map<string,number>();
  for (const [i,row] of rows.entries()) {
    const normalized = normalizeGenome(row.genome);
    const g = {...normalized, weights: Int8Array.from(normalized.weights)} as Genome;
    const hex = toHex(normalized);
    let ix = seen.get(hex);
    if (ix === undefined) { ix = genomes.length; seen.set(hex,ix); genomes.push(g); hexes.push(hex); observations.push([]); }
    observations[ix].push({line:i+1,eval:row.eval});
  }
  const eligible = genomes.map((_,i)=>i).filter(i=>observations[i].some(o=>(o.eval as {survived:number}).survived>0));
  const ids = geneticClusters(eligible.map(i=>genomes[i]));
  const clusters = new Map<number,number[]>();
  for (const [j,i] of eligible.entries()) { const c=ids[j]; if(!clusters.has(c)) clusters.set(c,[]); clusters.get(c)!.push(i); }
  const ordered = await Promise.all([...clusters].map(async ([cluster,members])=>({cluster,members, rank:await hash(enc.encode(`${namespace}/${name}/cluster/${cluster}`))})));
  ordered.sort((a,b)=>a.rank.localeCompare(b.rank) || a.cluster-b.cluster);
  if (ordered.length<12) throw new Error(`${name}: fewer than 12 clusters; no silent reduction`);
  const selected=[];
  for (const {cluster,members} of ordered.slice(0,12)) {
    const ranks=await Promise.all(members.map(async i=>({i, rank:await hash(enc.encode(`${namespace}/${name}/genome/${hexes[i]}`))})));
    ranks.sort((a,b)=>a.rank.localeCompare(b.rank) || a.i-b.i);
    const i=ranks[0].i;
    selected.push({cluster,hex:hexes[i],observations:observations[i]});
  }
  studies.push({name,uniqueEligible:eligible.length,clusters:clusters.size,selected});
}
const report={namespace,inventorySha256:await hash(enc.encode(manifestText)),
  selection:'Hash-ranked 12 distinct distance-10 single-linkage clusters, then one genome within each. Eligibility: recorded survival > 0 in any screening observation. Regeneration and light dependence not ranked. Cluster IDs local to each snapshot pool.',
  status:'Frozen exploratory candidate roster; no follow-up outcomes or evolution claim.',studies};
await Deno.writeTextFile(output,JSON.stringify(report,null,2)+'\n',{createNew:true});
console.log(JSON.stringify(studies.map(s=>({name:s.name,eligible:s.uniqueEligible,clusters:s.clusters,selected:s.selected.length}))));
