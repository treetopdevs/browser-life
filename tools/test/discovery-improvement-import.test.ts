import { join, resolve } from "node:path";
import { sha256 } from "../lib/founder-policy.ts";
import {
  buildManifest,
  checkpointPaths,
  writeCheckpoint,
} from "../lib/discovery-improvement-runtime.ts";
import { discoveryEvolutionWorld } from "../lib/discovery-evolution.ts";
import {
  fileInventory,
  importHistories,
  inventory,
  noSymlinks,
  validateTerminal,
} from "../discovery_improvement_import.ts";
async function rejects(work: () => Promise<unknown>, pattern: RegExp) {
  try {
    await work();
  } catch (e) {
    if (pattern.test(String(e))) return;
    throw e;
  }
  throw Error("expected rejection");
}
function assert(x: unknown) {
  if (!x) throw Error("assertion failed");
}
Deno.test("terminal semantic inventory rejects truncation drift extra and symlinks", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  try {
    const shortlist = JSON.parse(
      await Deno.readTextFile(
        "experiments/founder-discovery/v1/shortlist.json",
      ),
    );
    const sources = Object.fromEntries(
      await Promise.all(
        [
          "tools/lib/discovery-improvement-runtime.ts",
          "tools/lib/discovery-evolution.ts",
          "tools/lib/founder-policy.ts",
        ].map(async (p) => [p, sha256(await Deno.readFile(p))]),
      ),
    );
    const m = buildManifest({
        format: "discovery-improvement-manifest/v1",
        ruleVersion: 1,
        sourceRoot: Deno.cwd(),
        pilotDesignSha256: "a".repeat(64),
        pilotAnalysisSha256: "b".repeat(64),
        inputs: {},
        sources,
        sourceManifestHash: "c".repeat(64),
        founders: shortlist.selected.map((f: any) => ({
          id: f.id,
          hex: f.hex,
          cluster: f.cluster,
        })),
      }),
      unit = m.units.find((u) => u.mode === "off")!,
      source = join(dir, "source"),
      unitDir = join(source, "histories", unit.id);
    const state =
      discoveryEvolutionWorld(unit.seed, unit.mode, unit.founderHex).state;
    let prior = null;
    for (let step = 0; step <= 1000000; step += 100000) {
      prior = await writeCheckpoint(
        unitDir,
        m,
        unit,
        { ...state, step },
        [],
        [],
        prior,
      );
    }
    const checked = await validateTerminal(unitDir, m, unit);
    assert(Object.keys(checked.files).length === 33);
    const cp = checkpointPaths(unitDir, 500000).checkpoint,
      original = await Deno.readFile(cp);
    await Deno.writeFile(cp, original.subarray(0, 30));
    await rejects(
      () => validateTerminal(unitDir, m, unit, checked.files),
      /inventory drift/,
    );
    await Deno.writeFile(cp, original);
    await Deno.writeTextFile(join(unitDir, "extra.json"), "{}");
    await rejects(() => fileInventory(unitDir), /extra/);
    await Deno.remove(join(unitDir, "extra.json"));
    const receipt = checkpointPaths(unitDir, 1000000).receipt,
      receiptBytes = await Deno.readFile(receipt);
    await Deno.remove(receipt);
    await rejects(() => fileInventory(unitDir), /missing/);
    await Deno.writeFile(receipt, receiptBytes);
    const link = join(dir, "link");
    await Deno.symlink(source, link);
    await rejects(() => noSymlinks(join(link, "histories")), /symlink/);
    const manifestPath = join(dir, "manifest.json"),
      allocationPath = join(dir, "allocation.json"),
      report = join(dir, "inventory.json");
    await Deno.writeTextFile(manifestPath, JSON.stringify(m));
    const allocation = {
      minimumFreeBytes: 20 * 1024 ** 3,
      manifestSha256: sha256(await Deno.readFile(manifestPath)),
      manifestHash: m.manifestHash,
      sourceManifestHash: m.sourceManifestHash,
      hosts: [{
        id: "fixture",
        root: dir,
        outputRel: "source",
        unitIds: m.units.map((u) => u.id),
      }],
    };
    await Deno.writeTextFile(allocationPath, JSON.stringify(allocation));
    await inventory(manifestPath, allocationPath, "fixture", source, report, [
      unit.id,
    ]);
    await rejects(
      () =>
        inventory(
          manifestPath,
          allocationPath,
          "fixture",
          source,
          join(dir, "foreign.json"),
          ["foreign"],
        ),
      /foreign/,
    );
    const staging = join(dir, "staging");
    await Deno.mkdir(join(staging, "histories"), { recursive: true });
    await Deno.rename(unitDir, join(staging, "histories", unit.id));
    const dest = resolve("runs", `.import-test-${crypto.randomUUID()}`);
    try {
      await Deno.mkdir(dest, { recursive: true });
      const outside = join(dir, "outside-destination");
      await Deno.mkdir(outside);
      await Deno.symlink(outside, join(dest, "histories"));
      await rejects(
        () =>
          importHistories(manifestPath, allocationPath, report, staging, dest),
        /symlink/,
      );
      assert([...Deno.readDirSync(outside)].length === 0);
      await Deno.remove(join(dest, "histories"));
      await Deno.mkdir(join(dest, "histories", "foreign-existing"), {
        recursive: true,
      });
      await rejects(
        () =>
          importHistories(manifestPath, allocationPath, report, staging, dest),
        /unexpected destination/,
      );
      await Deno.remove(join(dest, "histories", "foreign-existing"));
      await Deno.symlink(outside, join(dest, "provenance"));
      await rejects(
        () =>
          importHistories(manifestPath, allocationPath, report, staging, dest),
        /symlink/,
      );
      assert([...Deno.readDirSync(outside)].length === 0);
      await Deno.remove(join(dest, "provenance"));
      await importHistories(
        manifestPath,
        allocationPath,
        report,
        staging,
        dest,
      );
      await importHistories(
        manifestPath,
        allocationPath,
        report,
        staging,
        dest,
      );
      const prov = [];
      for await (const e of Deno.readDir(join(dest, "provenance"))) {
        prov.push(e.name);
      }
      assert(prov.length === 2);
      assert(
        JSON.stringify(
          await fileInventory(join(dest, "histories", unit.id)),
        ) === JSON.stringify(checked.files),
      );
      await Deno.writeTextFile(join(dest, "SHARD_RUNNING"), "{}");
      await rejects(
        () =>
          importHistories(manifestPath, allocationPath, report, staging, dest),
        /active/,
      );
      await Deno.remove(join(dest, "SHARD_RUNNING"));
      const target =
        checkpointPaths(join(dest, "histories", unit.id), 100000).edges;
      await Deno.writeTextFile(target, "[1]\n");
      await rejects(
        () =>
          importHistories(manifestPath, allocationPath, report, staging, dest),
        /inventory drift/,
      );
    } finally {
      await Deno.remove(dest, { recursive: true });
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
