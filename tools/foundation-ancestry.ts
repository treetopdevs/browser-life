// CPU-only source-lineage audit; it never replays physics or requests a GPU.
// Usage: deno run --allow-read --allow-write tools/foundation-ancestry.ts \
//   --runs-root runs/m4 --out runs/foundations/founder-ancestry.json
import { createHash } from "node:crypto";
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { cellCount } from "@bl/schema";
import {
  ANCESTRY_CODE_FILES, ANCESTRY_CONDITIONS, ANCESTRY_SAMPLE_STEPS, ANCESTRY_SEEDS,
  MutationOriginBuilder, parseLineageCensusRow, parseMutationEdge, parseSeriesCensus,
  summarizeAncestryCensus, validateAndDeriveInitialOrigins,
  type AncestryCensusSummary, type SourceManifest,
} from "./lib/foundation-ancestry.ts";

const args = parseArgs(Deno.args, { string: ["runs-root", "out"] });
if (!args["runs-root"] || !args.out) throw new Error("usage: --runs-root <runs/m4> --out <new.json>");
const runsRoot = args["runs-root"];
const out = args.out;
try {
  await Deno.lstat(out);
  throw new Error(`output already exists: ${out}`);
} catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }

const hex = (bytes: Uint8Array) => Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
const digest = (bytes: Uint8Array) => hex(new Uint8Array(createHash("sha256").update(bytes).digest()));
interface FileDigest { sha256: string; bytes: number }
interface StreamFileDigest { sha256: string | null; bytes: number }

async function* textLines(path: string, fileDigest: StreamFileDigest): AsyncGenerator<string> {
  const hash = createHash("sha256"), decoder = new TextDecoder("utf-8", { fatal: true });
  const file = await Deno.open(path, { read: true });
  let pending = "";
  try {
    for await (const bytes of file.readable) {
      hash.update(bytes);
      fileDigest.bytes += bytes.byteLength;
      pending += decoder.decode(bytes, { stream: true });
      let at: number;
      while ((at = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, at).replace(/\r$/, "");
        pending = pending.slice(at + 1);
        if (line) yield line;
      }
      if (pending.length > 2_000_000) throw new Error(`${path}: line exceeds 2 MB`);
    }
    pending += decoder.decode();
    if (pending) yield pending.replace(/\r$/, "");
    fileDigest.sha256 = hash.digest("hex");
  } finally { try { file.close(); } catch { /* readable stream closed */ } }
}

function header(line: string | undefined, expected: string, path: string): void {
  if (line !== expected) throw new Error(`${path}: expected header ${JSON.stringify(expected)}`);
}

async function auditBundle(path: string, condition: string, seed: number) {
  const fileDigests: Record<string, FileDigest | StreamFileDigest> = {};
  const manifestBytes = await Deno.readFile(`${path}/manifest.json`);
  fileDigests["manifest.json"] = { sha256: digest(manifestBytes), bytes: manifestBytes.byteLength };
  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)) as SourceManifest;
  if (manifest.spec?.condition !== condition || manifest.spec?.seed !== seed)
    throw new Error("bundle path condition/seed disagrees with manifest");
  const { origins, identity } = validateAndDeriveInitialOrigins(manifest);

  const mutationDigest: StreamFileDigest = { sha256: null, bytes: 0 };
  fileDigests["mutations.tsv"] = mutationDigest;
  const mutationIterator = textLines(`${path}/mutations.tsv`, mutationDigest);
  const firstMutationLine = await mutationIterator.next();
  header(firstMutationLine.value, "childHi\tchildLo\tparentHi\tparentLo", "mutations.tsv");
  const sourceCellCount = cellCount(manifest.cfg);
  const builder = new MutationOriginBuilder(origins, { finalStep: manifest.spec.steps, cellCount: sourceCellCount,
    ringNamespace: manifest.cfg.ringNamespace });
  for (;;) {
    const next = await mutationIterator.next();
    if (next.done) break;
    builder.push(parseMutationEdge(next.value));
  }
  if (builder.rows !== manifest.summary.mutations)
    throw new Error(`mutation edge count ${builder.rows} != manifest summary.mutations ${manifest.summary.mutations}`);

  const seriesDigest: StreamFileDigest = { sha256: null, bytes: 0 };
  fileDigests["series.jsonl"] = seriesDigest;
  const declared = new Map<number, number>();
  let seriesRows = 0, seriesScheduleValid = true, lastSeriesStep = 0;
  const seriesIterator = textLines(`${path}/series.jsonl`, seriesDigest);
  for (;;) {
    const next = await seriesIterator.next();
    if (next.done) break;
    const row = parseSeriesCensus(next.value);
    seriesRows++;
    const expectedStep = Math.min(seriesRows * manifest.spec.censusEvery, manifest.spec.steps);
    if (row.step !== expectedStep || row.step <= lastSeriesStep) seriesScheduleValid = false;
    lastSeriesStep = row.step;
    if ((ANCESTRY_SAMPLE_STEPS as readonly number[]).includes(row.step)) declared.set(row.step, row.lineages);
  }
  const expectedSeriesRows = Math.ceil(manifest.spec.steps / manifest.spec.censusEvery);
  if (seriesRows !== expectedSeriesRows) seriesScheduleValid = false;

  const lineageDigest: StreamFileDigest = { sha256: null, bytes: 0 };
  fileDigests["lineages.tsv"] = lineageDigest;
  const targetRows = new Map<number, ReturnType<typeof parseLineageCensusRow>[]>(ANCESTRY_SAMPLE_STEPS.map((step) => [step, []]));
  const rowCounts = new Map<number, number>();
  let lineageRows = 0, lineageOrderValid = true, previousStep = 0;
  const lineageIterator = textLines(`${path}/lineages.tsv`, lineageDigest);
  const firstLineageLine = await lineageIterator.next();
  header(firstLineageLine.value, "step\tlineage\tcells", "lineages.tsv");
  for (;;) {
    const next = await lineageIterator.next();
    if (next.done) break;
    const row = parseLineageCensusRow(next.value);
    lineageRows++;
    if (row.step < previousStep) lineageOrderValid = false;
    previousStep = row.step;
    rowCounts.set(row.step, (rowCounts.get(row.step) ?? 0) + 1);
    const sampleRows = targetRows.get(row.step);
    if (sampleRows) sampleRows.push(row);
  }
  let lineageCountsMatch = true;
  for (const [step, count] of declared) if ((rowCounts.get(step) ?? 0) !== count) lineageCountsMatch = false;
  for (const step of rowCounts.keys()) if (!declared.has(step) && step > manifest.spec.steps) lineageCountsMatch = false;
  // Only selected census lineage-row totals are matched to series counts; other
  // census rows are streamed for hashes/order without claiming full consistency.

  const samples: AncestryCensusSummary[] = [];
  const sampleErrors: { step: number; error: string }[] = [];
  for (const step of ANCESTRY_SAMPLE_STEPS) {
    const rows = targetRows.get(step)!;
    try { samples.push(summarizeAncestryCensus(step, declared.get(step) ?? null, rows, builder.origins, sourceCellCount)); }
    catch (e) {
      sampleErrors.push({ step, error: String(e) });
      const hasCensus = declared.has(step);
      samples.push({ step, status: hasCensus ? "incomplete-lineage-rows" : "missing-census", declaredLineages: declared.get(step) ?? null,
        observedLineages: hasCensus ? rows.length : null,
        observedCells: hasCensus ? rows.reduce((sum, row) => sum + row.cells, 0) : null,
        founders: hasCensus ? [] : null });
    }
  }
  const completeSeries = seriesScheduleValid && seriesRows === expectedSeriesRows;
  const completeSelectedSamples = samples.every((s) => s.status !== "missing-census") && sampleErrors.length === 0;
  return {
    status: completeSeries && lineageOrderValid && lineageCountsMatch && completeSelectedSamples ? "audited" : "partial",
    sourcePath: path, condition, seed, identity,
    sourceDigests: fileDigests,
    mutationEdges: builder.rows,
    mutationDepthMeaning: "cumulative logged mutation events along lineage ancestry; includes clamped/no-op events and is not functional innovation",
    coverage: { expectedSeriesRows, observedSeriesRows: seriesRows, completeSeries,
      observedLineageRows: lineageRows, lineageOrderValid, selectedLineageCountsMatch: lineageCountsMatch,
      expectedSampleSteps: [...ANCESTRY_SAMPLE_STEPS], observedSampleSteps: [...declared.keys()], sampleErrors },
    samples,
  };
}

const selectedSourceHashes = Object.fromEntries(await Promise.all(ANCESTRY_CODE_FILES.map(async (name) => {
  const bytes = await Deno.readFile(new URL(`../${name}`, import.meta.url));
  return [name, { sha256: digest(bytes), bytes: bytes.byteLength }];
})));
const initial = {
  format: "foundation-ancestry-audit-v1",
  status: "running",
  createdAt: new Date().toISOString(),
  sourceSelection: { root: runsRoot, preset: "gradient-m3", conditions: [...ANCESTRY_CONDITIONS], seeds: [...ANCESTRY_SEEDS], sampleSteps: [...ANCESTRY_SAMPLE_STEPS] },
  sourceHashScope: "listed inputs and selected current source files; not a complete dependency closure or a physics replay",
  currentCode: { selectedSourceHashes },
  interpretation: [
    "Founder-instance origin and M3 genome slot are separate; source init and initHash are rebuilt before attribution.",
    "No-mutation histories can still sort among standing founder variants.",
    "Mutation-event depth counts logged ID-minting events, including clamped/no-op changes; it does not measure functional novelty or causation.",
    "Lineage ancestry identifies copied-genome origin, not organism pedigree or exclusive causal contribution after matter mixing.",
  ],
  expectedSources: ANCESTRY_CONDITIONS.flatMap((condition) => ANCESTRY_SEEDS.map((seed) => ({ condition, seed,
    path: `${runsRoot}/gradient-m3/${condition}/seed-${seed}` }))),
};
await Deno.writeTextFile(out, JSON.stringify(initial, null, 2) + "\n", { createNew: true });
const results: unknown[] = [];
for (const source of initial.expectedSources) {
  try {
    const result = await auditBundle(source.path, source.condition, source.seed);
    results.push(result);
    console.log(`${source.condition} seed ${source.seed}: ${result.status}`);
  } catch (e) {
    results.push({ status: "unavailable", sourcePath: source.path, condition: source.condition, seed: source.seed, error: String(e) });
    console.error(`${source.condition} seed ${source.seed}: ${e}`);
  }
  await Deno.writeTextFile(out, JSON.stringify({ ...initial, results }, null, 2) + "\n");
}
const audited = results.filter((x) => (x as { status: string }).status === "audited").length;
const partial = results.filter((x) => (x as { status: string }).status === "partial").length;
const unavailable = results.filter((x) => (x as { status: string }).status === "unavailable").length;
const status = partial || unavailable ? "completed-with-unavailable-or-partial-sources" : "completed";
await Deno.writeTextFile(out, JSON.stringify({ ...initial, status,
  coverage: { expectedSources: initial.expectedSources.length, audited, partial, unavailable }, results }, null, 2) + "\n");
if (partial || unavailable) Deno.exitCode = 1;
