/** Zero-time CPU feasibility. deno run -A experiments/recovery-severity/feasibility.ts V1_DIR NEW_OUT_DIR */
import { canonicalObserverJSON, decodeCheckpoint, stateHash, validateState, totalsOf, ledgerResidual } from "@bl/schema";
import { validateCase, subjects, genomeHex, worldConfig, initialState, type CaseResult } from "../recovery-accessibility/protocol.ts";
import { enumerateCandidatesDetailed, selectPair } from "./selector.ts";

const [source, out, ...extra] = Deno.args;
if (!source || !out || extra.length) throw new Error("usage: feasibility.ts V1_DIR NEW_OUT_DIR");
const EXPECTED_MANIFEST = "8c68136f8e68f551a8ec5f34a93349c729ef0268ad7e2182c6fd2431877dc1f7";
const enc = new TextEncoder();
const stable = canonicalObserverJSON;
const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>))].map(x=>x.toString(16).padStart(2,"0")).join("");
const digest = async (v: unknown) => sha(enc.encode(stable(v)));
const read = async (p: string) => JSON.parse(await Deno.readTextFile(p));
try { await Deno.stat(out); throw new Error("output already exists; use a new directory"); } catch(e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
const manifest = await read(`${source}/manifest.json`);
if (await digest(manifest) !== EXPECTED_MANIFEST || (await read(`${source}/manifest-digest.json`)).sha256 !== EXPECTED_MANIFEST) throw new Error("not the frozen v1 manifest");
const genotypes = subjects();
const audit = await read("docs/recovery-severity-2026-10-24/audit.json");
const pinnedCases = new Map<string,string>(audit.cases.map((r: {id:string;source_sha256:string}) => [r.id,r.source_sha256]));
if(pinnedCases.size!==64) throw new Error("incomplete case inventory");
const started = Date.now();
const MAX_MS = 20*60*1000, MAX_BYTES = 512*1024*1024;
const inputEvidence: {id:string;caseSha256:string;checkpointSha256:string}[]=[];
const rows: unknown[]=[];
let admitted=0;
// A stop preserves partial output; it can never be read as a successful feasibility report.
const parentDir=out.includes("/")?out.slice(0,out.lastIndexOf("/"))||"/":".";
await Deno.mkdir(parentDir,{recursive:true});
await Deno.mkdir(out); // exclusive ownership, including concurrent launches
let writtenBytes=0;
const write = async (name:string, value:unknown) => {
 const b=enc.encode(JSON.stringify(value,null,2)+"\n");
 if (writtenBytes+b.length>MAX_BYTES) throw new Error("CAP: storage limit");
 await Deno.writeFile(`${out}/${name}.tmp`,b,{createNew:true});
 await Deno.rename(`${out}/${name}.tmp`,`${out}/${name}`); writtenBytes+=b.length;
};
async function load(seed:number, subject:"parent"|"mutant") {
 const id=`science-${subject}-${seed}`, folder=`${source}/cases/${id}`;
 const caseBytes=await Deno.readFile(`${folder}/case.json`);
 if(await sha(caseBytes)!==pinnedCases.get(id)) throw new Error(`case differs from pinned engineering inventory: ${id}`);
 const c:CaseResult=JSON.parse(new TextDecoder().decode(caseBytes));
 const caseSha256=await digest(c);
 if ((await read(`${folder}/digest.json`)).sha256!==caseSha256) throw new Error(`case digest mismatch: ${id}`);
 validateCase(c,{manifestHash:EXPECTED_MANIFEST,id,seed,subject,genome:genomeHex(genotypes[subject])});
 const a=c.artifacts.find(a=>a.path==="grown.blck");
 if (!a || c.artifacts.filter(a=>a.path==="grown.blck").length!==1) throw new Error(`missing/duplicate grown artifact: ${id}`);
 const bytes=await Deno.readFile(`${folder}/grown.blck`);
 const checkpointSha256=await sha(bytes);
 if (bytes.length!==a.bytes || checkpointSha256!==a.sha256) throw new Error(`grown digest mismatch: ${id}`);
 const state=decodeCheckpoint(bytes).state;
 const errors=validateState(state);
 if(errors.length) throw new Error(`invalid grown state: ${errors.join(", ")}`);
 const baseline=totalsOf(state.cfg,initialState(seed,genotypes[subject]).cells);
 if(totalsOf(state.cfg,state.cells).matter!==baseline.matter || ledgerResidual(baseline,state)!==0n) throw new Error(`grown conservation mismatch: ${id}`);
 if (stable(state.cfg)!==stable(worldConfig(seed)) || state.step!==3000 || stateHash(state)!==c.observation.states.grown.hash) throw new Error(`grown identity mismatch: ${id}`);
 if (!c.observation.target) throw new Error(`missing original target: ${id}`);
 inputEvidence.push({id,caseSha256,checkpointSha256});
 return {state,target:c.observation.target};
}
try {
 const paths=["experiments/recovery-severity/feasibility.ts","experiments/recovery-severity/selector.ts","docs/recovery-severity-2026-10-24/PLAN.md","docs/recovery-severity-2026-10-24/audit.json"];
 const git = async (args:string[]) => {
  const r=await new Deno.Command("git",{args,stdout:"piped",stderr:"piped"}).output();
  if(!r.success) throw new Error("could not capture source revision");
  return new TextDecoder().decode(r.stdout);
 };
 const revision={head:(await git(["rev-parse","HEAD"])).trim(),patch:await git(["diff","HEAD","--"])};
 const sources=[];
 for (const path of paths) sources.push({path,sha256:await sha(await Deno.readFile(path))});
 await write("manifest.json",{protocol:"recovery-severity-feasibility-v1",runtime:Deno.version,stage:"engineering-only",sourceManifest:EXPECTED_MANIFEST,revision,sources,maxMs:MAX_MS,maxBytes:MAX_BYTES,startedAt:new Date(started).toISOString()});
 for (let seed=2026102401;seed<=2026102432;seed++) {
  if (Date.now()-started>=MAX_MS) throw new Error("CAP: execution time limit");
  const parent=await load(seed,"parent"),mutant=await load(seed,"mutant");
  const p=enumerateCandidatesDetailed(parent.state,parent.target),m=enumerateCandidatesDetailed(mutant.state,mutant.target);
  const selection=selectPair(p.candidates,m.candidates);
  if(selection)admitted++;
  const row={seed,parent:p.counts,mutant:m.counts,parentCandidates:p.candidates.length,mutantCandidates:m.candidates.length,selection};
  rows.push(row);await write(`pair-${seed}.json`,row);
  console.log(`${seed}: ${selection?"feasible":"unmatchable"}; candidates ${p.candidates.length}/${m.candidates.length}`);
 }
 if (Date.now()-started>=MAX_MS) throw new Error("CAP: execution time limit");
 const status=admitted>=30?"FEASIBILITY-PASS-ENGINEERING-PENDING":"DOSE-CONTROL-NOT-READY";
 const result={status,admitted,total:32,sourceManifest:EXPECTED_MANIFEST,inputEvidence,pairs:rows,elapsedMs:Date.now()-started,scientificSeedsRun:0,meaning:"No time integration; no recovery or genotype advantage inferred. GPU engineering validation still required before fresh trials."};
 await write("result-digest.json",{sha256:await digest(result)});
 await write("result.json",result); // final atomic publication; readers require digest and no failure.json
 console.log(`${status}: ${admitted}/32; no fresh trials run`);
 Deno.exitCode=admitted>=30?0:3;
} catch(e) {
 try { await write("failure.json",{status:"TECHNICAL-STOP",error:String(e),completedPairs:rows.length,elapsedMs:Date.now()-started,scientificSeedsRun:0}); }
 catch(reportError) { console.error("Could not preserve failure marker:",String(reportError)); }
 throw e;
}
