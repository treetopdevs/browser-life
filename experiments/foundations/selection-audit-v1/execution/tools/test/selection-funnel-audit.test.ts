import nodeAssert from "node:assert/strict";
const assert = (x: unknown) => nodeAssert.ok(x);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepEqual(a, b);
const assertThrows = (fn: () => unknown) => nodeAssert.throws(fn);
const assertRejects = (fn: () => Promise<unknown>, _type: unknown, message: string) => nodeAssert.rejects(fn, { message: new RegExp(message) });
import { compatiblePerStrong, decisiveField, founderSetId, fromHex, genomeKey, loadPinned, normalizeGenome, parseFounders, referenceGeneralistGenome, selectWinners, strictFailures, toHex } from "../lib/selection-funnel-audit.ts";

const g = (mu = 30) => ({ mu, sigma: 20, motGain: 0, weights: Array(160).fill(0) });
const e = (regenerated: number, survived = 32, lightDependent = 32) => ({ reps: 32, survived, regenerated, lightDependent });
Deno.test("signed and hex identities match, including byte boundaries", () => { const x = g(); x.weights[0] = -128; x.weights[1] = 127; x.weights[159] = -1; assertEquals(genomeKey(fromHex(toHex(x))), genomeKey(x)); });
Deno.test("malformed and conflicting identities fail", () => { assertThrows(() => normalizeGenome({ ...g(), weights: [1] })); assertThrows(() => normalizeGenome({ ...g(), weights: [...Array(159).fill(0), 128] })); assertThrows(() => fromHex("z".repeat(336))); assertThrows(() => fromHex("00000000ffffffff" + "0".repeat(320))); });
Deno.test("strict gate reports every measured failure", () => { assertEquals(strictFailures(e(28)), ["regenerated"]); assertEquals(strictFailures(e(28, 27, 26)), ["survived", "regenerated", "lightDependent"]); assertEquals(strictFailures(e(30)), []); });
Deno.test("admission respects full roster order and missing perStrong", () => { const a = g(1), b = g(2), c = g(3); const rows = [a, b, c].map((genome) => ({ pass: true, cluster: 0, regenLowerBound: 0.9, genome, eval: { regenerated: 16, reps: 16 } })); const admitted = [{ genome: referenceGeneralistGenome(), cluster: null, label: "generalistGenome(60,20)" }, { genome: a }, { genome: b }]; assertEquals(compatiblePerStrong(rows, admitted), [2]); assertEquals(compatiblePerStrong(rows, [{ ...admitted[0], genome: g(99) }, ...admitted.slice(1)]), []); assertEquals(compatiblePerStrong(rows, [{ genome: referenceGeneralistGenome(), cluster: null, label: "generalistGenome(60,20)" }, { genome: b }, { genome: a }]), []); assertEquals(compatiblePerStrong(rows, [{ genome: referenceGeneralistGenome(), cluster: null, label: "generalistGenome(60,20)" }]), [0]); });
Deno.test("all-member admission retains multiple compatible limits", () => { const rows = [g(1), g(2)].map((genome) => ({ pass: true, cluster: 0, regenLowerBound: 0.9, genome, eval: { regenerated: 16, reps: 16 } })); assertEquals(compatiblePerStrong(rows, [{ genome: referenceGeneralistGenome(), cluster: null, label: "generalistGenome(60,20)" }, ...rows]), [2, 3]); });
Deno.test("selection breaks ties by retest order and detects pooled failure", () => { const rows = [{ cluster: 2, label: "early", eval: e(30) }, { cluster: 2, label: "later", eval: e(30) }]; assertEquals(selectWinners(rows)[0].label, "early"); assertEquals(decisiveField(rows[0].eval, rows[1].eval), "retest order"); assertEquals(strictFailures({ reps: 64, survived: 64, regenerated: 56, lightDependent: 64 }), ["regenerated"]); });
Deno.test("missing retests are not measured failures", () => { const rows = [{ cluster: 0, label: "seen", eval: e(30) }]; assertEquals(selectWinners(rows).length, 1); assertEquals(rows.find((x) => x.label === "absent"), undefined); });
Deno.test("founder source parses without execution and ordered identity changes", () => { const src = `export const M3_FOUNDER_SET = "m3-0000000000000000";\nexport const M3_FOUNDERS: readonly M3Founder[] = [\n  { cluster: 0, survived: 64, regenerated: 60, lightDependent: 64, reps: 64, retest: { survived: 32, regenerated: 30, lightDependent: 32, reps: 32 }, replication: { survived: 32, regenerated: 30, lightDependent: 32, reps: 32 }, mu: 30, sigma: 20, motGain: 0, weights: "${"00".repeat(160)}" },\n];`; const parsed = parseFounders(src); assertEquals(parsed.rows.length, 1); assertEquals(parsed.rows[0].mu, 30); assert(founderSetId([g(1), g(2)]) !== founderSetId([g(2), g(1)])); assertThrows(() => parseFounders(src.replace("\n];", "\n  runMalicious();\n];"))); });
Deno.test("source drift rejects modified snapshot", async () => { const tmp = await Deno.makeTempDir(); try { await Deno.writeTextFile(`${tmp}/input.json`, "{}"); await Deno.writeTextFile(`${tmp}/manifest.json`, JSON.stringify({ format: 1, entries: Array.from({ length: 19 }, (_, i) => ({ id: `${i}`, snapshotPath: "input.json", sha256: "bad", bytes: 2 })) })); await assertRejects(() => loadPinned(`${tmp}/manifest.json`), Error, "source drift"); } finally { await Deno.remove(tmp, { recursive: true }); } });
Deno.test("pinned integration preserves repeated observations and committed prefix", async () => {
  const manifest = new URL("../../experiments/foundations/selection-audit-v1/input-manifest.json", import.meta.url).pathname;
  const { data } = await loadPinned(manifest);
  const { reconstruct } = await import("../lib/selection-funnel-audit.ts");
  const audit = reconstruct(data);
  assertEquals(audit.reconciliation.status, "reconciled");
  assertEquals(audit.ledger.filter((x) => x.source === "viable" && x.committed).length, data.archive.viableCount);
  assertEquals(audit.ledger.filter((x) => x.source === "viable").length, data.viable.length);
  assertEquals(audit.summary.length, 7);
  assert(audit.summary.every((x) => x.observations.retest.length === 0));
  const repeated = audit.ledger.filter((x) => x.genomeKey === audit.summary[0].genomeKey);
  assert(repeated.length > 1);
  assert(repeated.some((x) => x.source === "confirm") && repeated.some((x) => x.source === "fdSubjects"));
  assertEquals(audit.reconciliation.compatiblePerStrong, [4]);
});
Deno.test("loader excludes a malformed uncommitted viable tail", async () => {
  const originalPath = new URL("../../experiments/foundations/selection-audit-v1/input-manifest.json", import.meta.url).pathname;
  const original = JSON.parse(await Deno.readTextFile(originalPath));
  const base = originalPath.slice(0, originalPath.lastIndexOf("/"));
  const tmp = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tmp}/inputs`);
    for (const entry of original.entries) await Deno.symlink(`${base}/${entry.snapshotPath}`, `${tmp}/${entry.snapshotPath}`);
    const viable = original.entries.find((x: { id: string }) => x.id === "viable");
    await Deno.remove(`${tmp}/${viable.snapshotPath}`);
    const modified = await Deno.readTextFile(`${base}/${viable.snapshotPath}`) + "NOT JSON\n";
    await Deno.writeTextFile(`${tmp}/${viable.snapshotPath}`, modified);
    const { createHash } = await import("node:crypto");
    viable.sha256 = createHash("sha256").update(modified).digest("hex"); viable.bytes = new TextEncoder().encode(modified).length;
    await Deno.writeTextFile(`${tmp}/manifest.json`, JSON.stringify(original));
    const { data } = await loadPinned(`${tmp}/manifest.json`);
    assertEquals(data.viable.length, data.archive.viableCount);
    assertEquals(data.viableTailRows, 1);
  } finally { await Deno.remove(tmp, { recursive: true }); }
});
Deno.test("reconstruction blocks divergent same-stage and diagnostic identities", async () => {
  const manifest = new URL("../../experiments/foundations/selection-audit-v1/input-manifest.json", import.meta.url).pathname;
  const { data } = await loadPinned(manifest);
  const { reconstruct } = await import("../lib/selection-funnel-audit.ts");
  const repeated = structuredClone(data); const target = repeated.fdSubjects.subjects[1];
  const original = repeated.confirm.rows.find((x: { genome: unknown }) => genomeKey(x.genome) === genomeKey(fromHex(target.hex)));
  repeated.confirm.rows.push({ ...original, eval: { ...original.eval, survived: 0, lightDependent: 0 } });
  const first = reconstruct(repeated);
  assertEquals(first.reconciliation.status, "blocked");
  assertEquals(first.histories[1].classification, "missing/conflicting evidence");
  assertEquals(first.histories[1].observations.confirm.length, 2);
  const changed = structuredClone(data); changed.fdSubjects.subjects[1].hex = "f" + target.hex.slice(1);
  const second = reconstruct(changed);
  assertEquals(second.reconciliation.status, "blocked");
  assert(second.findings.some((x) => x.code === "diagnostic-subject-source"));
});
Deno.test("output path cannot overwrite manifest or snapshots", async () => {
  const manifestPath = new URL("../../experiments/foundations/selection-audit-v1/input-manifest.json", import.meta.url).pathname;
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
  const { assertSafeOutput } = await import("../lib/selection-funnel-audit.ts");
  assertThrows(() => assertSafeOutput(manifestPath, manifestPath.slice(0, manifestPath.lastIndexOf("/")), manifest));
  assertThrows(() => assertSafeOutput(manifestPath, manifestPath.slice(0, manifestPath.lastIndexOf("/")) + "/inputs", manifest));
});
