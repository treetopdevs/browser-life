// CPU-only CLI regression: evidence is observational, replayable and create-only.
// deno run -A --no-lock tests/deno/soup_evidence.ts
import { strict as assert } from "node:assert";
import { Soup } from "../../tools/soup/bff.ts";

const root = new URL("../../", import.meta.url);
const temp = await Deno.makeTempDir({ prefix: "soup-evidence-" });
async function run(name: string, args: string[] = [], ok = true) {
  const r = await new Deno.Command(Deno.execPath(), { cwd: root,
    args: ["run", "--no-lock", "-A", "tools/soup.ts", "--cpu", "--seed", "2", "--num-log2", "9",
      "--epochs", "20", "--every", "1", "--save", "10", "--transition", "100", "--out", `${temp}/${name}`, ...args],
    stdout: "piped", stderr: "piped",
  }).output();
  assert.equal(r.success, ok, new TextDecoder().decode(r.stderr));
}
const json = async (name: string) => JSON.parse(await Deno.readTextFile(`${temp}/${name}`));
try {
  await run("bad-input", ["--evidence", "--load", `${temp}/soup-10.bin`], false);
  await assert.rejects(Deno.stat(`${temp}/bad-input`), Deno.errors.NotFound);
  await run("plain");
  const rows = (await Deno.readTextFile(`${temp}/plain/log.csv`)).trim().split("\n").slice(1).map(l => l.split(","));
  const first = Number(rows[0][3]);
  const later = rows.find(r => Number(r[3]) > first + 0.00001);
  assert.ok(later, "fixture needs a later entropy record");
  const threshold = (first + Number(later[3])) / 2;
  await run("evidence", ["--evidence", `--transition=${threshold}`, "--after", "100"]);
  assert.deepEqual(await Deno.readFile(`${temp}/plain/soup-20.bin`), await Deno.readFile(`${temp}/evidence/soup-20.bin`));
  const record = await json("evidence/transition.json");
  assert.ok(record.epoch > 1);
  const cpu = new Soup({ num: 512, seed: 2 });
  while (cpu.epoch < record.epoch - 1) cpu.step();
  assert.deepEqual(await Deno.readFile(`${temp}/evidence/soup-${cpu.epoch}-pre-transition.bin`), cpu.programs);
  await run("pre-replay", ["--evidence", "--load", `${temp}/evidence/soup-${cpu.epoch}-pre-transition.bin`]);
  assert.deepEqual(await Deno.readFile(`${temp}/pre-replay/soup-20.bin`), await Deno.readFile(`${temp}/plain/soup-20.bin`));
  assert.equal((await json("pre-replay/completion.json")).thresholdCrossingEpoch, null);
  const invocation = await json("evidence/invocation.json");
  assert.equal(invocation.startingEpoch, 0);
  assert.ok(invocation.sources["tools/soup.ts"]);
  assert.equal(invocation.sourceCopiesAuthoritative, true);
  assert.equal(invocation.patchExcludesUntracked, true);
  const measured = await new Deno.Command(Deno.execPath(), { cwd: root,
    args: ["run", "--no-lock", "-A", "tools/soup-receipt.ts", `${temp}/evidence/soup-20.bin`], stdout: "piped" }).output();
  assert.ok(measured.success);
  const receipt = JSON.parse(new TextDecoder().decode(measured.stdout));
  assert.equal(receipt.sha256, (await json("evidence/completion.json")).finalStateSha256);
  assert.deepEqual(receipt.compressor, invocation.compressor);
  assert.ok(invocation.compressor.implementation);
  assert.deepEqual(await Deno.readFile(`${temp}/evidence/sources/tools/soup.ts`), await Deno.readFile(new URL("tools/soup.ts", root)));
  await run("inherited", ["--evidence", "--load", `${temp}/evidence/soup-${record.epoch}-transition.bin`, "--after", "0"]);
  const inherited = await json("inherited/completion.json");
  assert.equal(inherited.thresholdCrossingEpoch, null);
  assert.equal((await json("inherited/transition.json")).observedInInvocation, false);
  assert.equal(inherited.inheritedStoppingBoundary.epoch, record.epoch);
  const completion = await json("evidence/completion.json");
  assert.equal(completion.finalEpoch, 20);
  assert.equal(completion.thresholdCrossingEpoch, record.epoch);
  const preservedNames = ["invocation.json", "completion.json", "params.json", "log.csv", "transition.json", "soup-20.bin"];
  const before = await Promise.all(preservedNames.map(name => Deno.readFile(`${temp}/evidence/${name}`)));
  await run("evidence", ["--evidence"], false);
  await run("evidence", [], false);
  for (const [i, name] of preservedNames.entries()) assert.deepEqual(await Deno.readFile(`${temp}/evidence/${name}`), before[i]);
  await Deno.mkdir(`${temp}/older-evidence`);
  await Deno.writeTextFile(`${temp}/older-evidence/invocation.json`, "{}");
  await run("older-evidence", [], false);
  assert.deepEqual(Array.from(Deno.readDirSync(`${temp}/older-evidence`), e => e.name), ["invocation.json"]);
  await Deno.mkdir(`${temp}/dangling-evidence`);
  await Deno.symlink(`${temp}/missing-invocation`, `${temp}/dangling-evidence/invocation.json`);
  await run("dangling-evidence", [], false);
  assert.deepEqual(Array.from(Deno.readDirSync(`${temp}/dangling-evidence`), e => e.name), ["invocation.json"]);
  await run("resumed", ["--evidence", "--load", `${temp}/plain/soup-10.bin`]);
  assert.equal((await json("resumed/invocation.json")).startingEpoch, 10);
  assert.deepEqual(await Deno.readFile(`${temp}/resumed/soup-20.bin`), await Deno.readFile(`${temp}/plain/soup-20.bin`));
  console.log("PASS evidence: unchanged dynamics, preceding census bytes, create-only records, resume identity");
} finally { await Deno.remove(temp, { recursive: true }); }
