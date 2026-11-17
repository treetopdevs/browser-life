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
