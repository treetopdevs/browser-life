// Run: deno test --no-lock -A tools/test/m4-growth-precision.deno.ts
// Engineering phase only (the consumed 2026-09-29 development master); outputs go to temp dirs.
import assert from "node:assert/strict";
import { join } from "node:path";
import { runTrial } from "../lib/m4-growth-precision.ts";
import { plan, report, run } from "../m4-growth-precision.ts";

const PARENT = "experiments/m4/growth-precision-v1/parent-validation-v4-manifest.json";
const FIXTURE = "tools/test/fixtures/m4-growth-v4-paired-null-rows.json";

Deno.test("under Deno a trial reproduces the frozen 2026-09-29 validation rows byte for byte", async () => {
  const { rows } = JSON.parse(await Deno.readTextFile(FIXTURE));
  for (const want of rows) {
    const got = await runTrial("validation", 650009002, 64, { scenario: want.scenario, preset: want.preset, trial: want.trial });
    for (const k of ["identity", "endpoint2", "endpoint1", "endpoint1Method", "jointPerPresetObserved", "threshold"] as const) {
      assert.equal(JSON.stringify(got[k]), JSON.stringify(want[k]), k);
    }
  }
});

Deno.test("plan binds the parent's sources with parity, and refuses a drifted parent or an existing manifest", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const out = join(dir, "manifest.json");
    const m = await plan({ parent: PARENT, out, phase: "precision-extension", shards: 4, cap: 10_800, forecast: 4_200 });
    assert.deepEqual([m.masterSeed, m.trials, m.parentParity.identical, m.parentParity.sources], [650009003, 20_000, true, 48]);
    const parent = JSON.parse(await Deno.readTextFile(PARENT));
    for (const [p, h] of Object.entries(parent.sourceHashes)) assert.equal(m.sourceHashes[p], h, p);
    await assert.rejects(() => plan({ parent: PARENT, out, phase: "precision-extension", shards: 4, cap: 10_800, forecast: 4_200 }), Deno.errors.AlreadyExists);
    const drifted = join(dir, "parent.json");
    await Deno.writeTextFile(drifted, (await Deno.readTextFile(PARENT)) + "\n");
    await assert.rejects(() => plan({ parent: drifted, out: join(dir, "m2.json"), phase: "precision-extension", shards: 4, cap: 10_800, forecast: 4_200 }), /parent validation manifest hash drift/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("engineering shards stop, resume, refuse tampering and report only when complete", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const manifest = join(dir, "manifest.json");
    await plan({ parent: PARENT, out: manifest, phase: "precision-engineering", shards: 2, cap: 600, forecast: 10, trials: 2 });
    const out = join(dir, "out");
    const r0 = await run({ manifest, out, shard: 0, maxTrials: 1 });
    assert.deepEqual([r0.complete, r0.newTrials, r0.stopped, r0.failure], [false, 1, true, null]);
    await assert.rejects(() => run({ manifest, out, shard: 0 }), Deno.errors.AlreadyExists);
    await assert.rejects(() => report({ manifest, out }), /not complete|no such file|NotFound|No such file/);
    const r1 = await run({ manifest, out, shard: 0, resume: true });
    assert.deepEqual([r1.complete, r1.newTrials, r1.retainedTrials, r1.attempt], [true, 1, 1, 2]);
    assert.ok(r1.cumulativeWallSeconds >= r0.cumulativeWallSeconds);
    await assert.rejects(() => run({ manifest, out, shard: 0, resume: true }), /already complete/);
    await assert.rejects(() => report({ manifest, out }), /shard-1|NotFound|No such file/);
    await run({ manifest, out, shard: 1 });
    // A changed manifest byte refuses resume; a tampered row refuses the report.
    const other = join(dir, "other.json");
    await Deno.writeTextFile(other, (await Deno.readTextFile(manifest)) + " ");
    await assert.rejects(() => run({ manifest: other, out, shard: 1, resume: true }), /manifest bytes changed/);
    const log = join(out, "shard-1", "trials.jsonl");
    const original = await Deno.readTextFile(log);
    await Deno.writeTextFile(log, original.replace('"supported":false', '"supported":true'));
    await assert.rejects(() => report({ manifest, out }), /not complete and authenticated/);
    await Deno.writeTextFile(log, original);
    const rep = await report({ manifest, out });
    assert.deepEqual([rep.complete, rep.precisionPass, rep.results.map((r) => r.n)], [true, null, [2, 2]]);
    assert.ok(rep.results.every((r) => r.acceptancePass === true || r.acceptancePass === false));
    await assert.rejects(() => report({ manifest, out }), Deno.errors.AlreadyExists);
    // Rows carry the engineering identity, never the scientific master.
    const rows = (await Deno.readTextFile(join(out, "shard-0", "trials.jsonl"))).trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((r) => r.identity.generatorIdentity), [
      "precision-engineering:650009001:pairedEndpoint1Null:gradient-m3:0",
      "precision-engineering:650009001:pairedEndpoint1Null:gradient-m3:1",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
