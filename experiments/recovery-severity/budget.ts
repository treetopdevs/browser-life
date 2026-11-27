/** Shared engineering allowance. Initialization must include retained earlier attempts/checks. */
export async function openBudget(path:string) {
  const lock=await Deno.open(`${path}.lock`,{write:true,createNew:true});
  try {
    const budget=JSON.parse(await Deno.readTextFile(path));
    const {spentMs,spentBytes}=budget;
    if(budget.maxMs!==1200000 || budget.maxBytes!==536870912 || ![spentMs,spentBytes].every(x=>Number.isSafeInteger(x)&&x>=0)
      || spentMs>=budget.maxMs-1000 || spentBytes>=budget.maxBytes || !Array.isArray(budget.attempts)) throw new Error("invalid/exhausted aggregate engineering budget");
    const started=Date.now();
    return {maxMs:budget.maxMs-spentMs,maxBytes:budget.maxBytes-spentBytes,
      snapshot:budget,
      async settle(out:string, finalBytes=0, publish:()=>Promise<void>=async()=>{}) {
        let bytes=0;
        const count=async(p:string)=>{try {for await(const e of Deno.readDir(p)) {if(e.isDirectory)await count(`${p}/${e.name}`);else bytes+=(await Deno.stat(`${p}/${e.name}`)).size;}} catch(e){if(!(e instanceof Deno.errors.NotFound))throw e;}};
        let debited=false;
        try {
          await count(out);
          const elapsedMs=Date.now()-started;
          const next={...budget,spentMs:spentMs+elapsedMs+1000,spentBytes:spentBytes+bytes+finalBytes+4096,attempts:[...budget.attempts,{out,elapsedMs,bytes:bytes+finalBytes}]};
          await Deno.writeTextFile(`${path}.tmp`,JSON.stringify(next,null,2)+"\n",{createNew:true});
          if(next.spentMs>budget.maxMs || next.spentBytes>budget.maxBytes)throw new Error("aggregate budget exhausted during settlement");
          await Deno.rename(`${path}.tmp`,path);
          debited=true; await publish();
        } finally {lock.close();if(debited)await Deno.remove(`${path}.lock`);}
      }};
  } catch(e) {lock.close();await Deno.remove(`${path}.lock`);throw e;}
}
