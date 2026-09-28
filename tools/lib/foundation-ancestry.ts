// Read-only founder-origin summaries from complete M4 lineage/mutation logs.
// Mutation-event depth is genetic lineage depth, not functional innovation.
import {
  G, GENOME_CHANNELS, M3_FOUNDER_SET, M3_FOUNDERS, METRICS_VERSION, PRESETS, RING_CELL_BITS, RING_CELL_MASK,
  RULE_VERSION, SCHEMA_VERSION, cellCount, decodeGenome, founderGenome,
  initWorld, packLineageLo, presetIdentity, stateHash, type WorldConfig, type WorldState,
} from "@bl/schema";
import { runId, sameConfig, specConfig, type RunSpec } from "@bl/runner";
import { genomeKey } from "../../packages/search/src/mapelites.ts";

export const ANCESTRY_SAMPLE_STEPS = [100_000, 500_000, 900_000] as const;
export const ANCESTRY_CONDITIONS = ["treatment", "no-mutation"] as const;
export const ANCESTRY_SEEDS = [1, 2, 3, 4, 5] as const;

export const ANCESTRY_CODE_FILES = [
  "tools/foundation-ancestry.ts", "tools/lib/foundation-ancestry.ts",
  "packages/schema/src/config.ts", "packages/schema/src/founders.ts", "packages/schema/src/genome.ts",
  "packages/schema/src/layout.ts", "packages/schema/src/world.ts", "packages/schema/src/accounting.ts",
  "packages/schema/src/presets.ts", "packages/runner/src/runner.ts", "packages/runner/src/conditions.ts",
  "packages/search/src/mapelites.ts",
] as const;

export interface InitialFounderOrigin {
  lineageId: string;
  founderLineageId: string;
  /** Initial founder instance in the recorded initialization order. */
  founderInstanceIndex: number;
  /** M3 genome-set slot; distinct founder instances may share this slot/genome. */
  genomeFounderIndex: number;
  initialGenomeKey: string;
}

export interface MutationOriginEdge { childLineageId: string; parentLineageId: string }
export interface MutationOriginBounds { finalStep: number; cellCount: number; ringNamespace?: number }
export interface LineageCensusRow { step: number; lineageId: string; cells: number }
export interface LineageOrigin extends InitialFounderOrigin { mutationEventDepth: number }

const int = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const canonicalId = (id: string) => {
  const m = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(id);
  if (!m) throw new Error(`invalid lineage id ${JSON.stringify(id)}`);
  const hi = Number(m[1]), lo = Number(m[2]);
  if (!Number.isSafeInteger(hi) || !Number.isSafeInteger(lo) || hi > 0xffff_ffff || lo > 0xffff_ffff)
    throw new Error(`lineage id outside u32: ${id}`);
  return { hi, lo };
};

/** Build the expected init with the recorded founder count, then verify it against initHash. */
export interface SourceManifest {
  runId: string;
  spec: RunSpec;
  cfg: WorldConfig;
  init: unknown;
  initHash: string;
  presetIdentity: string;
  schemaVersion: number;
  ruleVersion: number;
  metricsVersion: number;
  startStep: number;
  summary: { steps: number; mutations: number; conservationOk: boolean };
  [key: string]: unknown;
}

export function validateAndDeriveInitialOrigins(m: SourceManifest): {
  origins: InitialFounderOrigin[];
  initialState: WorldState;
  identity: {
    runId: string; presetId: string; condition: string; seed: number; initHash: string;
    presetIdentity: string; founderSetId: string; recordedInit: unknown; declaredFounderInstances: number;
    visibleInitialLineages: number; sourceVersions: { schema: number; rule: number; metrics: number };
  };
} {
  const spec = m.spec;
  if (!spec || spec.experiment !== "m4" || spec.presetId !== "gradient-m3" ||
      !(ANCESTRY_CONDITIONS as readonly string[]).includes(spec.condition) ||
      !(ANCESTRY_SEEDS as readonly number[]).includes(spec.seed))
    throw new Error("source must be a selected m4/gradient-m3 treatment or no-mutation run with seed 1..5");
  if (spec.metapopulation || (spec.overrides && Object.keys(spec.overrides).length) || m.startStep !== 0)
    throw new Error("metapopulation, overridden, or continuation source is unsupported");
  if (m.summary?.conservationOk !== true || m.summary.steps !== spec.steps || m.summary.mutations < 0 || !int(m.summary.mutations))
    throw new Error("source is incomplete, nonconserved, or has an invalid mutation count");
  if (spec.steps < ANCESTRY_SAMPLE_STEPS.at(-1)! || spec.censusEvery <= 0 ||
      ANCESTRY_SAMPLE_STEPS.some((step) => step % spec.censusEvery !== 0))
    throw new Error("source does not cover the requested census steps");
  if (m.schemaVersion !== SCHEMA_VERSION || m.ruleVersion !== RULE_VERSION || m.metricsVersion !== METRICS_VERSION)
    throw new Error("source schema/rule/metrics versions differ from current code");
  const preset = PRESETS.find((p) => p.id === spec.presetId);
  if (!preset || m.presetIdentity !== presetIdentity(preset) || JSON.stringify(m.init) !== JSON.stringify(preset.init))
    throw new Error("source preset/init identity differs from current registered gradient-m3 preset");
  if (m.runId !== runId(spec) || !sameConfig(m.cfg as never, specConfig(spec)))
    throw new Error("source run/config identity mismatch");
  const cfg = m.cfg;
  const initialState = initWorld(cfg, preset.init);
  const computedInitHash = stateHash(initialState);
  if (m.initHash !== computedInitHash) throw new Error("source initHash does not match rebuilt initial state");

  // Use the recorded preset's founder count, not M3_FOUNDERS.length or m3World's default.
  // m3World assigns genome slot i % N to initialization instance i.
  const origins: InitialFounderOrigin[] = Array.from({ length: preset.init.founders }, (_, founderInstanceIndex) => {
    const genomeFounderIndex = founderInstanceIndex % M3_FOUNDERS.length;
    const genome = founderGenome(M3_FOUNDERS[genomeFounderIndex]);
    const founderLineageId = `0:${packLineageLo(cfg, founderInstanceIndex + 1)}`;
    return { lineageId: founderLineageId, founderLineageId, founderInstanceIndex, genomeFounderIndex,
      initialGenomeKey: genomeKey(genome) };
  });
  const expected = new Map(origins.map((o) => [o.lineageId, o]));
  const n = cellCount(cfg), seen = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    const hi = initialState.genome[G.LIN_HI * n + i], lo = initialState.genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    const id = `${hi}:${lo}`, origin = expected.get(id);
    if (!origin) throw new Error(`rebuilt initialization contains unexpected founder lineage ${id}`);
    const words = Array.from({ length: GENOME_CHANNELS }, (_, g) => initialState.genome[g * n + i]);
    const actualGenomeKey = genomeKey(decodeGenome(words));
    if (actualGenomeKey !== origin.initialGenomeKey) throw new Error(`initial genome does not match founder instance ${origin.founderInstanceIndex}`);
    const prior = seen.get(id);
    if (prior && prior !== actualGenomeKey) throw new Error(`initial lineage ${id} has multiple genomes`);
    seen.set(id, actualGenomeKey);
  }
  return { origins, initialState, identity: {
    runId: m.runId, presetId: spec.presetId, condition: spec.condition, seed: spec.seed,
    initHash: computedInitHash, presetIdentity: m.presetIdentity, founderSetId: M3_FOUNDER_SET,
    recordedInit: m.init, declaredFounderInstances: origins.length, visibleInitialLineages: seen.size,
    sourceVersions: { schema: m.schemaVersion, rule: m.ruleVersion, metrics: m.metricsVersion },
  } };
}

export class MutationOriginBuilder {
  readonly origins = new Map<string, LineageOrigin>();
  rows = 0;
  private previousChildHi = 0;

  constructor(initial: readonly InitialFounderOrigin[], private readonly bounds: MutationOriginBounds) {
    if (!int(bounds.finalStep) || bounds.finalStep <= 0 || !int(bounds.cellCount) || bounds.cellCount <= 0)
      throw new Error("invalid mutation lineage bounds");
    for (const origin of initial) {
      const { hi } = canonicalId(origin.lineageId);
      if (hi !== 0 || origin.founderLineageId !== origin.lineageId || this.origins.has(origin.lineageId))
        throw new Error(`invalid or duplicate initial founder lineage ${origin.lineageId}`);
      this.origins.set(origin.lineageId, { ...origin, mutationEventDepth: 0 });
    }
    if (!initial.length) throw new Error("initial founder set is empty");
  }

  push(edge: MutationOriginEdge): void {
    const child = canonicalId(edge.childLineageId), parent = canonicalId(edge.parentLineageId);
    if (child.hi === 0 || child.hi <= parent.hi) throw new Error(`mutation edge is out of causal order: ${edge.parentLineageId} -> ${edge.childLineageId}`);
    if (child.hi > this.bounds.finalStep) throw new Error(`mutation child ${edge.childLineageId} is after source final step ${this.bounds.finalStep}`);
    const cellIndex = this.bounds.ringNamespace === undefined ? child.lo : child.lo & RING_CELL_MASK;
    if (cellIndex >= this.bounds.cellCount || (this.bounds.ringNamespace !== undefined &&
        (child.lo >>> RING_CELL_BITS) !== this.bounds.ringNamespace))
      throw new Error(`mutation child ${edge.childLineageId} is outside source cell/namespace bounds`);
    if (child.hi < this.previousChildHi) throw new Error("mutation rows are out of causal order");
    if (this.origins.has(edge.childLineageId)) throw new Error(`duplicate mutation child ${edge.childLineageId}`);
    const parentOrigin = this.origins.get(edge.parentLineageId);
    if (!parentOrigin) throw new Error(`unknown or non-prior parent ${edge.parentLineageId} for ${edge.childLineageId}`);
    this.origins.set(edge.childLineageId, { ...parentOrigin, lineageId: edge.childLineageId,
      mutationEventDepth: parentOrigin.mutationEventDepth + 1 });
    this.previousChildHi = child.hi;
    this.rows++;
  }
}

export function buildMutationOriginMap(initial: readonly InitialFounderOrigin[], edges: Iterable<MutationOriginEdge>,
  bounds: MutationOriginBounds): Map<string, LineageOrigin> {
  const builder = new MutationOriginBuilder(initial, bounds);
  for (const edge of edges) builder.push(edge);
  return builder.origins;
}

export type AncestryCensusStatus = "observed" | "zero-extant" | "missing-census" | "incomplete-lineage-rows";
export interface FounderCensusSummary extends InitialFounderOrigin {
  extantLineages: number;
  extantCells: number;
  maxMutationEventDepth: number;
  cellWeightedMeanMutationEventDepth: number | null;
}
export interface AncestryCensusSummary {
  step: number;
  status: AncestryCensusStatus;
  declaredLineages: number | null;
  observedLineages: number | null;
  observedCells: number | null;
  founders: FounderCensusSummary[] | null;
}

export function summarizeAncestryCensus(step: number, declaredLineages: number | null,
  rows: readonly LineageCensusRow[], origins: ReadonlyMap<string, LineageOrigin>, maxCellCount: number): AncestryCensusSummary {
  if (!int(step) || step <= 0 || !int(maxCellCount) || maxCellCount <= 0 ||
      (declaredLineages !== null && !int(declaredLineages))) throw new Error("invalid census identity/count");
  if (declaredLineages === null) {
    if (rows.length) throw new Error("lineage rows exist without a recorded census");
    return { step, status: "missing-census", declaredLineages: null, observedLineages: null, observedCells: null, founders: null };
  }
  if (rows.length !== declaredLineages) throw new Error(`lineage row count ${rows.length} != series count ${declaredLineages} at step ${step}`);
  const seen = new Set<string>();
  const grouped = new Map<string, { lineages: number; cells: number; maxDepth: number; depthCells: number }>();
  let observedCells = 0;
  for (const row of rows) {
    if (row.step !== step || !int(row.cells) || row.cells <= 0 || seen.has(row.lineageId)) throw new Error(`invalid/duplicate lineage row at step ${step}`);
    seen.add(row.lineageId);
    const origin = origins.get(row.lineageId);
    if (!origin) throw new Error(`lineage ${row.lineageId} has no validated founder origin at step ${step}`);
    if (canonicalId(row.lineageId).hi > step) throw new Error(`lineage ${row.lineageId} is born after census step ${step}`);
    let g = grouped.get(origin.founderLineageId);
    if (!g) grouped.set(origin.founderLineageId, (g = { lineages: 0, cells: 0, maxDepth: 0, depthCells: 0 }));
    g.lineages++;
    g.cells += row.cells;
    g.maxDepth = Math.max(g.maxDepth, origin.mutationEventDepth);
    g.depthCells += origin.mutationEventDepth * row.cells;
    observedCells += row.cells;
    if (observedCells > maxCellCount) throw new Error(`census cells ${observedCells} exceed world cell count ${maxCellCount} at step ${step}`);
  }
  const founders = [...origins.values()].filter((o) => o.lineageId === o.founderLineageId)
    .sort((a, b) => a.founderInstanceIndex - b.founderInstanceIndex).map((origin): FounderCensusSummary => {
      const g = grouped.get(origin.founderLineageId);
      return { ...origin, extantLineages: g?.lineages ?? 0, extantCells: g?.cells ?? 0,
        maxMutationEventDepth: g?.maxDepth ?? 0,
        cellWeightedMeanMutationEventDepth: g?.cells ? g.depthCells / g.cells : null };
    });
  return { step, status: declaredLineages === 0 ? "zero-extant" : "observed", declaredLineages,
    observedLineages: rows.length, observedCells, founders };
}

export function parseMutationEdge(line: string): MutationOriginEdge {
  const fields = line.trim().split("\t");
  if (fields.length !== 4 || fields.some((x) => !/^(0|[1-9]\d*)$/.test(x))) throw new Error("malformed mutations.tsv row");
  return { childLineageId: `${Number(fields[0])}:${Number(fields[1])}`, parentLineageId: `${Number(fields[2])}:${Number(fields[3])}` };
}

export function parseLineageCensusRow(line: string): LineageCensusRow {
  const fields = line.trim().split("\t");
  if (fields.length !== 3 || !/^(0|[1-9]\d*)$/.test(fields[0]) || !/^(0|[1-9]\d*)$/.test(fields[2]))
    throw new Error("malformed lineages.tsv row");
  const row = { step: Number(fields[0]), lineageId: fields[1], cells: Number(fields[2]) };
  canonicalId(row.lineageId);
  return row;
}

export function parseSeriesCensus(line: string): { step: number; lineages: number } {
  const row = JSON.parse(line) as Record<string, unknown>;
  if (!int(row.step) || !int(row.lineages)) throw new Error("series.jsonl row lacks finite step/lineage counts");
  return { step: row.step, lineages: row.lineages };
}
