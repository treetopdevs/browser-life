import {
  buildManifest,
  requestsFromSamples,
  type Sample,
} from "../lib/discovery-improvement-runtime.ts";
import {
  atomicNew,
  provenanceMatches,
  readiness,
  type Slot,
} from "../discovery_improvement_reconcile.ts";
import type { HistoryInventory } from "../discovery_improvement_import.ts";
function assert(x: unknown): asserts x {
  if (!x) throw Error("assertion failed");
}
const shortlist = JSON.parse(
  await Deno.readTextFile("experiments/founder-discovery/v1/shortlist.json"),
);
const m = buildManifest({
  format: "discovery-improvement-manifest/v1",
  ruleVersion: 1,
  sourceRoot: Deno.cwd(),
  pilotDesignSha256: "a".repeat(64),
  pilotAnalysisSha256: "b".repeat(64),
  inputs: {},
  sources: {},
  sourceManifestHash: "c".repeat(64),
  founders: shortlist.selected.map((f: any) => ({
    id: f.id,
    hex: f.hex,
    cluster: f.cluster,
  })),
});
const slots: Slot[] = m.units.map((u) => ({
  unitId: u.id,
  hostId: "local",
  status: "complete",
}));
function samples() {
  return Object.fromEntries(
    m.units.map(
      (u) => [
        u.id,
        Object.fromEntries(
          m.times.map((
            time,
            index,
          ) => [
            time,
            {
              time,
              drawSeeds: u.drawSeeds[index],
              draws: {
                status: "present",
                genomes: [u.founderHex, u.founderHex],
                unresolvedMass: 0,
              },
            } as Sample,
          ]),
        ),
      ],
    ),
  );
}
Deno.test("global readiness requires exact64 complete slots with zero unexpected artifacts", () => {
  const data = samples();
  for (
    const altered of [
      slots.slice(1),
      [...slots.slice(1), slots[1]],
      [...slots.slice(1), { ...slots[0], unitId: "foreign" }],
      slots.map((s, i) => i === 0 ? { ...s, status: "missing" as const } : s),
      slots.map((s, i) => i === 0 ? { ...s, status: "invalid" as const } : s),
    ]
  ) {
    const gate = readiness(m, altered, [], data);
    assert(
      !gate.physicalComplete && gate.roster === null &&
        gate.rosterBytes === null,
    );
  }
  assert(readiness(m, slots, ["foreign"], data).rosterBytes === null);
});
Deno.test("complete gate preserves original384draw6144requests unavailable outcomes and dedup bytes", () => {
  const data = samples();
  data[m.units[0].id][0] = {
    ...data[m.units[0].id][0],
    draws: { status: "absent", genomes: [], unresolvedMass: 0 },
  };
  data[m.units[1].id][100000] = {
    ...data[m.units[1].id][100000],
    draws: { status: "unresolved", genomes: [], unresolvedMass: 1 },
  };
  const expected = requestsFromSamples(m, data),
    gate = readiness(m, slots, [], data);
  assert(gate.physicalComplete);
  assert(gate.roster);
  assert(
    gate.rosterBytes ===
      JSON.stringify({ manifestHash: m.manifestHash, ...expected }) + "\n",
  );
  assert(
    gate.roster?.draws.length === 384 && gate.roster.assays.length === 6144,
  );
  assert(
    gate.roster.assays.filter((a) => a.status === "absent").length === 32 &&
      gate.roster.assays.filter((a) => a.status === "unresolved").length === 32,
  );
  assert(gate.roster.uniqueKeys.length < gate.roster.assays.length);
});
Deno.test("provenance requires exact expected host allocation source final receipt and filehashes", () => {
  const slot: Slot = {
      ...slots[0],
      files: { receipt: "d".repeat(64) },
      finalReceiptSha256: "e".repeat(64),
    },
    entry = {
      id: slot.unitId,
      files: slot.files!,
      finalReceiptSha256: slot.finalReceiptSha256!,
    },
    p = {
      format: "discovery-improvement-history-import/v1",
      manifestHash: m.manifestHash,
      manifestSha256: "ms",
      allocationSha256: "as",
      hostId: "local",
      sourceOutput: "/source",
      destination: "/dest",
      inventorySha256: "f".repeat(64),
      units: [entry],
    },
    inv: HistoryInventory = {
      format: "discovery-improvement-history-inventory/v1",
      manifestHash: m.manifestHash,
      manifestSha256: "ms",
      allocationSha256: "as",
      sourceManifestHash: m.sourceManifestHash,
      hostId: "local",
      sourceOutput: "/source",
      observedAt: "test",
      units: [entry],
    };
  const match = (p: any, i = inv) =>
    provenanceMatches(p, i, slot, m, "ms", "as", "/dest", "/source");
  assert(match(p));
  for (
    const bad of [
      { ...p, hostId: "foreign" },
      { ...p, allocationSha256: "foreign" },
      { ...p, sourceOutput: "/foreign" },
      { ...p, units: [{ ...entry, finalReceiptSha256: "0".repeat(64) }] },
      { ...p, units: [{ ...entry, files: { receipt: "0".repeat(64) } }] },
    ]
  ) assert(!match(bad));
  assert(!match(p, { ...inv, hostId: "foreign" }));
  assert(!match({ ...p, units: [] }));
  assert(!match({ ...p, units: [entry, { ...entry, id: "extra" }] }));
  assert(
    !match(p, {
      ...inv,
      units: [entry, {
        ...entry,
        id: "omitted-contradiction",
        finalReceiptSha256: "0".repeat(64),
      }],
    }),
  );
});

Deno.test("atomic output preserves existing bytes and leaves no temporary artifact", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  try {
    const path = `${dir}/roster.json`;
    await atomicNew(path, "original\n");
    let rejected = false;
    try {
      await atomicNew(path, "changed\n");
    } catch {
      rejected = true;
    }
    assert(rejected);
    assert(await Deno.readTextFile(path) === "original\n");
    assert([...Deno.readDirSync(dir)].length === 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
