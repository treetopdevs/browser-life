// deno run --no-lock -A tests/deno/soup_lock.ts
import { strict as assert } from "node:assert";
const temp = await Deno.makeTempDir({ prefix: "soup-lock-" });
const helper = new URL("../../tools/soup/device.ts", import.meta.url).href;
const source = `${temp}/child.ts`;
await Deno.writeTextFile(source, `import { soupDevice } from ${JSON.stringify(helper)};
if (Deno.args[0] === "fail") {
  navigator.gpu.requestAdapter = async () => null;
  try { await soupDevice(); throw new Error("expected failure"); }
  catch (e) { if (!String(e).includes("no adapter")) throw e; }
  console.log("failed initialization"); await Deno.stdin.read(new Uint8Array(1));
} else {
  // No real GPU initialization delay can masquerade as waiting for the lock.
  navigator.gpu.requestAdapter = async () => ({ requestDevice: async () => ({ destroy() {} }) });
  const device = await soupDevice(); console.log("acquired");
  if (Deno.args[0] === "hold") await Deno.stdin.read(new Uint8Array(1));
  device.destroy();
}`);
const children: Deno.ChildProcess[] = [];
const launch = (mode: string) => {
  const child = new Deno.Command(Deno.execPath(), { args: ["run", "--no-lock", "-A", source, mode], env: { HOME: temp }, stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
  children.push(child); return child;
};
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  await Promise.race([
    (async () => {
      for (const mode of ["hold", "fail"]) {
        const holder = launch(mode);
        const ready = holder.stdout.getReader();
        assert.match(new TextDecoder().decode((await ready.read()).value), mode === "hold" ? /acquired/ : /failed initialization/);
        ready.releaseLock();
        const contender = launch("once");
        if (mode === "hold") {
          const blocked = contender.stderr.getReader();
          assert.match(new TextDecoder().decode((await blocked.read()).value), /waiting for another GPU soup process/);
          blocked.releaseLock();
          const output = contender.stdout.getReader();
          const acquired = output.read();
          assert.equal(await Promise.race([acquired.then(() => "acquired"), new Promise(r => setTimeout(() => r("blocked"), 250))]), "blocked");
          await holder.stdin.close();
          assert.match(new TextDecoder().decode((await acquired).value), /acquired/);
          output.releaseLock();
        } else {
          // Failed initialization must release the lock while CPU fallback lives.
          const result = await contender.output();
          assert.equal(result.success, true);
          assert.match(new TextDecoder().decode(result.stdout), /acquired/);
          await holder.stdin.close();
        }
        assert.equal((await contender.status).success, true);
        assert.equal((await holder.status).success, true);
      }
      console.log("PASS lock excludes live contender, releases on exit and failed initialization");
    })(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("lock test timed out")), 15000); }),
  ]);
} finally {
  clearTimeout(timer);
  for (const child of children) { try { child.kill(); } catch { /* already exited */ } }
  await Deno.remove(temp, { recursive: true });
}
