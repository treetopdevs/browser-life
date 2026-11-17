// Synthetic filesystem regressions only; no GPU or scientific worlds.
import { openBudget } from "../../experiments/recovery-severity/budget.ts";
const dir=await Deno.makeTempDir();
const assert=(b:boolean)=>{if(!b)throw new Error("budget regression");};
try {
 const path=`${dir}/budget.json`,out=`${dir}/out`;
 await Deno.mkdir(out);await Deno.writeTextFile(`${out}/data`,"12345");
 await Deno.writeTextFile(path,JSON.stringify({maxMs:1200000,maxBytes:536870912,spentMs:100,spentBytes:200,attempts:[]}));
 const first=await openBudget(path);assert(first.maxMs===1199900&&first.maxBytes===536870712);
 let rejected=false;try{await openBudget(path);}catch{rejected=true;}assert(rejected);
 await first.settle(out);
 const saved=JSON.parse(await Deno.readTextFile(path));assert(saved.spentMs>=100&&saved.spentBytes===4301&&saved.attempts.length===1);
 const second=await openBudget(path);assert(second.maxBytes===536870912-saved.spentBytes);await second.settle(`${dir}/absent`);
 saved.spentMs=1200000;await Deno.writeTextFile(path,JSON.stringify(saved));
 rejected=false;try{await openBudget(path);}catch{rejected=true;}assert(rejected);
 try{await Deno.stat(`${path}.lock`);throw Error("leaked lock");}catch(e){if(!(e instanceof Deno.errors.NotFound))throw e;}
 const failed=`${dir}/failed-budget.json`;
 await Deno.writeTextFile(failed,JSON.stringify({maxMs:1200000,maxBytes:536870912,spentMs:0,spentBytes:0,attempts:[]}));
 const broken=await openBudget(failed);await Deno.writeTextFile(`${failed}.tmp`,"blocked");
 let published=false;rejected=false;
 try{await broken.settle(out,100,async()=>{published=true;});}catch{rejected=true;}
 assert(rejected&&!published);await Deno.stat(`${failed}.lock`);
 rejected=false;try{await openBudget(failed);}catch{rejected=true;}assert(rejected);
 const publishedBudget=`${dir}/published-budget.json`;
 await Deno.writeTextFile(publishedBudget,JSON.stringify({maxMs:1200000,maxBytes:536870912,spentMs:0,spentBytes:0,attempts:[]}));
 const publishing=await openBudget(publishedBudget);
 await publishing.settle(out,7,async()=>{await Deno.writeTextFile(`${out}/final`,"1234567",{createNew:true});});
 const charged=JSON.parse(await Deno.readTextFile(publishedBudget));
 assert(charged.attempts[0].bytes===12&&charged.spentBytes===4108);
 console.log("PASS final-byte debit; failed debit blocks publication and retains lock; aggregate debit, exclusive lock, exhausted budget and lock cleanup");
}finally{await Deno.remove(dir,{recursive:true});}
// The independent reader holds the same exclusive lock while it reads and verifies the budget.
import { withSettledBudget } from "../../experiments/recovery-severity/read-stage0.ts";
const readerDir=await Deno.makeTempDir();
try {
 const path=`${readerDir}/budget.json`;
 await Deno.writeTextFile(path,JSON.stringify({maxMs:1200000,maxBytes:536870912,spentMs:0,spentBytes:0,attempts:[]}));
 const lockGone=async()=>{try{await Deno.stat(`${path}.lock`);return false;}catch(e){if(e instanceof Deno.errors.NotFound)return true;throw e;}};
 // An attempt opened before the reader: the reader refuses and leaves that lock in place.
 const attempt=await openBudget(path);
 let refused=false;try{await withSettledBudget(path,()=>true);}catch(e){refused=String(e).includes("budget unsettled");}
 assert(refused&&!await lockGone());
 await attempt.settle(`${readerDir}/absent`);assert(await lockGone());
 // While the reader verifies, no attempt can open; the lock is released afterwards.
 let blocked=false;
 const seen=await withSettledBudget(path,async(budget)=>{try{await openBudget(path);}catch{blocked=true;}return budget.attempts.length;});
 assert(blocked&&seen===1&&await lockGone());
 // A throwing verification and a stale settlement temp both release the reader's lock.
 refused=false;try{await withSettledBudget(path,()=>{throw Error("bad debit");});}catch(e){refused=String(e).includes("bad debit");}
 assert(refused&&await lockGone());
 await Deno.writeTextFile(`${path}.tmp`,"stale");
 refused=false;try{await withSettledBudget(path,()=>true);}catch(e){refused=String(e).includes("budget unsettled");}
 assert(refused&&await lockGone());
 console.log("PASS reader budget lock: refuses an open attempt without removing its lock, blocks openBudget while verifying, releases its own lock on success, throw and stale temp");
}finally{await Deno.remove(readerDir,{recursive:true});}
