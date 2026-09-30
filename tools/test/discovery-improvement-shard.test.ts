import {
  adapterText,
  type Allocation,
  mapped,
  validateAllocation,
} from "../discovery_improvement_shard.ts";
import type { Manifest } from "../lib/discovery-improvement-runtime.ts";
function fails(f: () => unknown) {
  let failed = false;
  try {
    f();
  } catch {
    failed = true;
  }
  if (!failed) throw Error("expected rejection");
}
Deno.test("adapter preserves helper bytes and rejects ambiguous dispatch", () => {
  const source =
    'const helper = 3;\nif (import.meta.main) {throw Error("cli");}\n';
  const actual = adapterText(source);
  if (
    !actual.startsWith("const helper = 3;\n") ||
    actual.includes('throw Error("cli")')
  ) throw Error("transform drift");
  fails(() => adapterText("missing"));
  fails(() => adapterText(source + source));
});
Deno.test("relocation rejects frozen path outside registered root", () => {
  if (mapped("/old/a", "/old", "/new") !== "/new/a") throw Error("mapping");
  fails(() => mapped("/outside/a", "/old", "/new"));
});
Deno.test("allocation rejects overlaps omissions and global resource overflow", () => {
  const m = {
    manifestHash: "m",
    sourceManifestHash: "s",
    units: [{ id: "a" }, { id: "b" }],
  } as Manifest;
  const a = {
    format: "discovery-improvement-history-allocation/v1",
    manifestHash: "m",
    sourceManifestHash: "s",
    globalCapSeconds: 345600,
    globalPriorSeconds: 20,
    priorInvocations: 1,
    engineeringReserveSeconds: 1000,
    engineeringReserveInvocations: 2,
    reservationSeconds: 3600,
    minimumFreeBytes: 20 * 1024 ** 3,
    hosts: [{
      id: "local",
      unitIds: ["a"],
      capSeconds: 100000,
      maxInvocations: 170,
      estimatedStorageBytes: 1,
    }, {
      id: "remote",
      unitIds: ["b"],
      capSeconds: 130000,
      maxInvocations: 220,
      estimatedStorageBytes: 1,
    }],
  } as Allocation;
  validateAllocation(a, m);
  fails(() =>
    validateAllocation({
      ...a,
      hosts: [a.hosts[0], { ...a.hosts[1], unitIds: ["a"] }],
    }, m)
  );
  fails(() => validateAllocation({ ...a, globalPriorSeconds: 200000 }, m));
  fails(() => validateAllocation({ ...a, priorInvocations: 500 }, m));
});
