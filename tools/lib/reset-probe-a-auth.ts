/** Prospective Probe A design and source-freeze validation; no device work. */
import { createHash } from "node:crypto";
import type { ResetSelectedLink } from "./reset-probe-a-analysis.ts";

export type ResetFileIdentity = { path: string; bytes: number; sha256: string };
export type ResetSavedSource = ResetFileIdentity & { savedPath: string };
export type ResetFreeze = {
  format: number; status: string; workspace: string;
  sources: ResetSavedSource[]; inputs: ResetFileIdentity[];
  evidence: ResetSavedSource[]; baselines: ResetSavedSource[];
};
export type ResetDesignHistory = {
  history: number; seed: number; preset: string; condition: string;
  startStep: number; endStep: number; rowIndices: number[];
  checkpointSteps: number[];
  continuousWindow: { referenceStep: number; candidateStepsFirst: number;
    candidateStepsLast: number; followupLast: number; observationEvery: number };
  sourceDirectory: string;
};
export type ResetDesign = {
  format: number; id: string; status: string;
  protocol: ResetFileIdentity;
  sample: ResetFileIdentity & { rows: ResetSelectedLink[] };
  histories: ResetDesignHistory[];
  rules: { censusEvery: number; parentReferenceOffset: number;
    followupReferenceOffset: number; followupOffsets: number[];
    graphs: { threshold: number; neighbors: number }[];
    windowPersistence: { futureOffsets: number[]; graph: { threshold: number;
      neighbors: number }; completeRequiresAll100: boolean;
      candidateCountCutoff: number | null } };
};

const isSha = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
export function validateResetDesign(design: ResetDesign): void {
  if (design.format !== 1 || design.id !== "probe-a-design-v2" ||
      design.status !== "prospective-design-not-launch-approval" ||
      !isSha(design.protocol?.sha256) || !isSha(design.sample?.sha256) ||
      design.rules?.censusEvery !== 100 || design.rules.parentReferenceOffset !== -100 ||
      design.rules.followupReferenceOffset !== 0 ||
      JSON.stringify(design.rules.followupOffsets) !== JSON.stringify(
        Array.from({ length: 11 }, (_, i) => 100 * i)) ||
      JSON.stringify(design.rules.graphs) !== JSON.stringify([
        { threshold: 48, neighbors: 4 }, { threshold: 1, neighbors: 8 }]) ||
      JSON.stringify(design.rules.windowPersistence.futureOffsets) !== JSON.stringify(
        Array.from({ length: 100 }, (_, i) => i + 1)) ||
      design.rules.windowPersistence.graph.threshold !== 1 ||
      design.rules.windowPersistence.graph.neighbors !== 8 ||
      design.rules.windowPersistence.completeRequiresAll100 !== true ||
      design.rules.windowPersistence.candidateCountCutoff !== null ||
      !Array.isArray(design.sample.rows) || design.sample.rows.length !== 200 ||
      !Array.isArray(design.histories) || design.histories.length !== 10)
    throw new Error("Probe A design lacks the fixed prospective protocol");
  const indexed = new Set<number>(), seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const row = design.sample.rows[i];
    if (row.rowIndex !== i || !Number.isSafeInteger(row.h) || row.h < 1 || row.h > 10 ||
        !Number.isSafeInteger(row.step) || row.step < 100 || row.step % 100 !== 0 ||
        !["budding", "fission"].includes(row.kind) ||
        !Number.isSafeInteger(row.parent) || row.parent <= 0 ||
        !Number.isSafeInteger(row.child) || row.child <= 0 || row.child === row.parent ||
        !Number.isFinite(row.parentPurity) || !Number.isFinite(row.childPurity))
      throw new Error("Probe A selected row is malformed");
    const key = `${row.h}/${row.step}/${row.kind}/${row.parent}/${row.child}`;
    if (seen.has(key)) throw new Error("Probe A selected link is duplicated");
    seen.add(key); indexed.add(i);
  }
  for (let i = 0; i < 10; i++) {
    const h = design.histories[i], expected = i + 1;
    if (h.history !== expected || h.seed !== expected || h.preset !== "gradient-m3" ||
        h.condition !== "treatment" || h.startStep !== 0 || h.endStep !== 1000000 ||
        h.rowIndices.length !== 20 || new Set(h.rowIndices).size !== 20 ||
        h.rowIndices.some(index => !indexed.has(index) ||
          design.sample.rows[index].h !== expected) ||
        JSON.stringify(h.checkpointSteps) !== JSON.stringify(
          Array.from({ length: 10 }, (_, j) => 100000 * (j + 1))) ||
        h.continuousWindow.referenceStep !== 100000 + 70000 * i ||
        h.continuousWindow.candidateStepsFirst !== h.continuousWindow.referenceStep + 1 ||
        h.continuousWindow.candidateStepsLast !== h.continuousWindow.referenceStep + 1000 ||
        h.continuousWindow.followupLast !== h.continuousWindow.referenceStep + 1100 ||
        h.continuousWindow.observationEvery !== 1 ||
        !h.sourceDirectory.endsWith(`/gradient-m3/treatment/seed-${expected}`))
      throw new Error("Probe A history allocation, row set or window changed");
  }
  if (new Set(design.histories.flatMap(h => h.rowIndices)).size !== 200)
    throw new Error("Probe A histories do not cover exactly the fixed rows");
}

export async function resetIdentity(path: string): Promise<ResetFileIdentity> {
  const file = await Deno.open(path);
  const hash = createHash("sha256"); let bytes = 0;
  try { for await (const chunk of file.readable) { hash.update(chunk); bytes += chunk.length; } }
  finally { try { file.close(); } catch { /* stream may already close it */ } }
  return { path, bytes, sha256: hash.digest("hex") };
}
export async function assertResetIdentity(expected: ResetFileIdentity): Promise<void> {
  const actual = await resetIdentity(expected.path);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
    throw new Error(`Probe A frozen file changed: ${expected.path}`);
}
export async function validateResetFreeze(freeze: ResetFreeze,
  designPath: string, designSha256: string): Promise<void> {
  if (freeze.format !== 1 || freeze.status !== "complete-not-launch-approval" ||
      freeze.workspace !== "/Users/nicholas/develop/browser-life-foundations" ||
      !Array.isArray(freeze.sources) || !freeze.sources.length ||
      !Array.isArray(freeze.inputs) || freeze.inputs.length < 300 ||
      !Array.isArray(freeze.evidence) || !Array.isArray(freeze.baselines))
    throw new Error("Probe A source freeze is incomplete");
  const evidence = freeze.evidence.find(row => row.path === designPath);
  if (!evidence || evidence.sha256 !== designSha256)
    throw new Error("Probe A design is not preserved in source freeze");
  const paths = new Set<string>();
  for (const row of [...freeze.sources, ...freeze.evidence, ...freeze.baselines]) {
    if (paths.has(row.savedPath) || !isSha(row.sha256))
      throw new Error("Probe A frozen source inventory duplicates saved paths");
    paths.add(row.savedPath);
    if (!freeze.baselines.includes(row)) await assertResetIdentity(row);
    await assertResetIdentity({ path: row.savedPath,
      bytes: row.bytes, sha256: row.sha256 });
  }
  for (const input of freeze.inputs) await assertResetIdentity(input);
}

export async function validateResetRawSample(design: ResetDesign): Promise<void> {
  await assertResetIdentity(design.protocol);
  await assertResetIdentity(design.sample);
  const raw = JSON.parse(await Deno.readTextFile(design.sample.path));
  if (!Array.isArray(raw) || raw.length !== 200) throw new Error("original selected sample changed");
  const fields = ["h", "step", "kind", "parent", "child", "parentLineage",
    "childLineage", "parentPurity", "childPurity"] as const;
  for (let i = 0; i < 200; i++)
    for (const field of fields)
      if (raw[i][field] !== design.sample.rows[i][field])
        throw new Error(`original selected row ${i} differs from frozen design`);
}
