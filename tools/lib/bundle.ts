// Shared run-bundle loading and ensemble-eligibility logic for the Deno
// analysis tools (tools/analyze.ts, tools/calibrate.ts). Factored out so the
// two tools use byte-identical definitions of "what counts as a loadable
// run" and "what counts as one eligible ensemble/pilot" -- analyze.ts pools
// runs across conditions for one ensemble; calibrate.ts pools neutral-only
// runs across seeds for one calibration pilot (per preset). Both must apply
// the same rule/schema/metrics-version, spec-consistency and full-horizon
// checks, or the frozen activity threshold calibrate.ts produces could be
// compared against an ensemble analyze.ts would have accepted under
// different eligibility rules.
//
// Deno-only (Deno.readTextFile/readDir): not part of any @bl/* package,
// which are host-agnostic (I/O goes through the Sink abstraction in
// packages/runner/src/runner.ts) and type-checked under tsc's Node-ish lib
// set with no Deno types. This module is checked separately via
// `deno check tools/*.ts`.
import { METRICS_VERSION, PRESETS, presetIdentity, RULE_VERSION, SCHEMA_VERSION, initWorld, stateHash, type Preset } from "@bl/schema";
import { ActivityTracker, type RunActivities } from "@bl/metrics";
import { sameConfig, specConfig } from "@bl/runner";
import { TextLineStream } from "jsr:@std/streams@1/text-line-stream";

export interface Run {
  condition: string;
  seed: number;
  dir: string;
  series: Record<string, any>[];
  manifest: any;
}

/**
 * Loads one run bundle from `dir`. Returns null for a directory that isn't a
 * complete run bundle -- most commonly a run still in progress (`tools/run.ts`
 * only writes `manifest.summary` once a history finishes), so callers can
 * walk a live output directory (e.g. an in-progress calibration pilot)
 * without ever reading a partial bundle as if it were data.
 */
export async function loadRun(dir: string, condition: string, seed: number): Promise<Run | null> {
  try {
    const manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
    if (!manifest.summary) return null;
    const series = (await Deno.readTextFile(`${dir}/series.jsonl`)).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    // lineages.tsv is streamed per census by `activities`, never loaded
    // whole: a 1e6-step run's table is hundreds of MB.
    if (!(await Deno.stat(`${dir}/lineages.tsv`)).isFile) return null;
    return { condition, seed, dir, series, manifest };
  } catch {
    return null;
  }
}

/**
 * Loads every seed-N run bundle under every condition subdirectory of
 * `root` (a "report" subdirectory, e.g. analyze.ts's own output, is
 * skipped). Incomplete bundles are silently omitted (see `loadRun`).
 * Loading never replays lineage data: cohort eligibility comes first.
 */
export async function loadRunsUnder(root: string): Promise<Run[]> {
  const loaded: Run[] = [];
  for await (const cond of Deno.readDir(root)) {
    if (!cond.isDirectory || cond.name === "report") continue;
    for await (const sd of Deno.readDir(`${root}/${cond.name}`)) {
      const m = /^seed-(\d+)$/.exec(sd.name);
      if (!m) continue;
      const r = await loadRun(`${root}/${cond.name}/${sd.name}`, cond.name, Number(m[1]));
      if (r) loaded.push(r);
    }
  }
  return loaded;
}

/**
 * Streams a run's lineages.tsv one census at a time. Rows come grouped by
 * ascending step (runner.ts appends one block per census; stitch.ts keeps
 * that order across segments), so only the current census is held.
 */
export async function* lineageCensuses(dir: string): AsyncGenerator<[number, [string, number][]]> {
  const file = await Deno.open(`${dir}/lineages.tsv`);
  const lines = file.readable.pipeThrough(new TextDecoderStream()).pipeThrough(new TextLineStream());
  let header = true;
  let step = -Infinity;
  let rows: [string, number][] = [];
  for await (const l of lines) {
    if (header || !l) {
      header = false;
      continue;
    }
    const [s, k, c] = l.split("\t");
    const n = Number(s);
    if (n !== step) {
      if (!(n > step)) throw new Error(`${dir}/lineages.tsv: step ${s} follows ${step}; rows must be in ascending census order`);
      if (rows.length) yield [step, rows];
      step = n;
      rows = [];
    }
    rows.push([k, Number(c)]);
  }
  if (rows.length) yield [step, rows];
}

/**
 * Replays a run's activity history (from `series.jsonl` census steps and
 * `lineages.tsv` per-census abundance, streamed), including empty censuses
 * after an extinction so extinct lineages leave the present set at the
 * right time. Lineage rows at a step with no census are ignored.
 * `threshold` is Infinity by default -- collect the activity distribution
 * without classifying anything as adaptively significant yet.
 */
export async function activities(r: Run, threshold = Infinity): Promise<{ tracker: ActivityTracker; snaps: ReturnType<ActivityTracker["update"]>[] }> {
  const t = new ActivityTracker(threshold);
  const snaps: ReturnType<ActivityTracker["update"]>[] = [];
  let i = 0;
  const emptyBefore = (step: number) => {
    while (i < r.series.length && r.series[i].step < step) snaps.push(t.update(r.series[i++].step, []));
  };
  for await (const [step, rows] of lineageCensuses(r.dir)) {
    emptyBefore(step);
    if (i < r.series.length && r.series[i].step === step) snaps.push(t.update(r.series[i++].step, rows));
  }
  emptyBefore(Infinity);
  return { tracker: t, snaps };
}

/** Spec fields every run in one ensemble/pilot must agree on (see `ensembleProblems`). */
export const DEFAULT_SHARED_SPEC_KEYS = ["experiment", "presetId", "steps", "censusEvery", "deepEvery", "activityThreshold"] as const;

/**
 * Rule/schema/metrics-version, spec-consistency (shared keys, config,
 * overrides) and full-horizon problems across a set of loaded runs -- "is
 * this one ensemble" (tools/analyze.ts, pooling conditions) or "is this one
 * calibration pilot" (tools/calibrate.ts, pooling neutral-only seeds for one
 * preset). Returns the empty array when every run is eligible; callers
 * decide how to report or refuse on a non-empty result (analyze.ts throws;
 * calibrate.ts reports per-preset and skips that preset).
 */
export function ensembleProblems(loaded: Run[], sharedKeys: readonly string[] = DEFAULT_SHARED_SPEC_KEYS): string[] {
  const problems: string[] = [];
  if (!loaded.length) return problems;
  const ref = loaded[0].manifest.spec;
  for (const r of loaded) {
    const m = r.manifest;
    const id = `${r.condition}/seed-${r.seed}`;
    if (m.ruleVersion !== RULE_VERSION || m.schemaVersion !== SCHEMA_VERSION)
      problems.push(`${id}: rule/schema ${m.ruleVersion}/${m.schemaVersion}, analysis expects ${RULE_VERSION}/${SCHEMA_VERSION}`);
    // A missing field predates METRICS_VERSION and is version 1 — never pool
    // runs whose held-out metrics (e.g. compressionRatio) were computed under
    // different definitions.
    if ((m.metricsVersion ?? 1) !== METRICS_VERSION) problems.push(`${id}: metrics version ${m.metricsVersion ?? 1}, analysis expects ${METRICS_VERSION}`);
    if (m.spec.condition !== r.condition || m.spec.seed !== r.seed) problems.push(`${id}: manifest says ${m.spec.condition}/seed-${m.spec.seed}`);
    for (const k of sharedKeys) if ((m.spec[k] ?? null) !== (ref[k] ?? null)) problems.push(`${id}: ${k} ${m.spec[k]} differs from ${ref[k]}`);
    if (m.spec.overrides && Object.keys(m.spec.overrides).length) problems.push(`${id}: config overrides ${JSON.stringify(m.spec.overrides)}`);
    else {
      try {
        if (!sameConfig(m.cfg, specConfig(m.spec))) problems.push(`${id}: config differs from ${m.spec.presetId} under ${m.spec.condition}`);
      } catch (e) {
        problems.push(`${id}: ${(e as Error).message}`);
      }
    }
    if ((m.startStep ?? 0) !== 0 || m.summary.steps !== m.spec.steps) problems.push(`${id}: covers ${m.startStep ?? 0}+${m.summary.steps} of ${m.spec.steps} steps`);
    if (r.series.length !== Math.ceil(m.spec.steps / m.spec.censusEvery) || r.series.some((x, i) => x.step !== Math.min((i + 1) * m.spec.censusEvery, m.spec.steps)))
      problems.push(`${id}: census steps do not follow censusEvery=${m.spec.censusEvery}`);
  }
  return problems;
}

/**
 * A metapopulation ring's seeds exchange matter and genomes at every segment
 * boundary (packages/schema/src/exchange.ts), so they are not independent
 * replicates -- pooling them the way ensemble statistics do would silently
 * misrepresent one ring as N independent draws. "no-migration" runs are
 * exempt even within a metapopulation experiment (Coordinator.Queue never
 * wires import_from for that condition). Returns null when no ringed run is
 * present; otherwise the affected conditions and seed count, for the caller
 * to render into its own refusal message.
 */
export function metapopulationRingProblems(loaded: Run[]): { conditions: string[]; count: number } | null {
  const ringed = loaded.filter((r) => r.manifest.spec?.metapopulation && r.condition !== "no-migration");
  if (!ringed.length) return null;
  return { conditions: [...new Set(ringed.map((r) => r.condition))], count: ringed.length };
}

/** Pre-registered eligibility: only histories with exact conservation enter inference. */
export function partitionByConservation(loaded: Run[]): { eligible: Run[]; invalid: Run[] } {
  return {
    eligible: loaded.filter((r) => r.manifest.summary.conservationOk),
    invalid: loaded.filter((r) => !r.manifest.summary.conservationOk),
  };
}

function initParamsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Verifies that a run's manifest actually carries the founder/config
 * provenance current code expects for `presetId` -- not just that its
 * `spec.presetId` *label* matches (Astra review, 2026-09-27, item 1):
 * `ensembleProblems`'s `sameConfig` check only ever compares `WorldConfig`
 * fields, never founder content, so a run recorded under the wrong founder
 * set (e.g. 1 founder instead of today's 13) previously passed ensemble
 * validation outright. `packages/runner/src/runner.ts` now records
 * `presetIdentity`/`init`/`initHash` on every fresh (non-continuation) run;
 * this checks each of the three against what CURRENT code (`@bl/schema`'s
 * `PRESETS`) actually produces for `presetId`:
 *   - `presetIdentity` must equal `presetIdentity(preset)`;
 *   - `init` must deep-equal `preset.init`;
 *   - `initHash` must equal `stateHash(initWorld(cfg, preset.init))`
 *     recomputed from *this run's own recorded `cfg`* -- cheap (no GPU: pure
 *     CPU founder placement + hashing) and verifies actual founder content,
 *     not just the init parameter counts.
 * A manifest missing any of the three fields (a bundle written before this
 * provenance was recorded) is refused as "legacy", never silently treated
 * as verified. Returns the empty array when every run's provenance checks
 * out. Only meaningful for a registered preset that a frozen threshold or a
 * calibration pilot depends on -- callers skip this entirely for an
 * exploratory (unregistered) preset.
 */
export function provenanceProblems(runs: Run[], presetId: string): string[] {
  const preset: Preset | undefined = PRESETS.find((p) => p.id === presetId);
  if (!preset) return runs.map((r) => `${r.condition}/seed-${r.seed}: unknown preset "${presetId}" (not in @bl/schema's PRESETS)`);
  const expectedIdentity = presetIdentity(preset);
  const problems: string[] = [];
  for (const r of runs) {
    const id = `${r.condition}/seed-${r.seed}`;
    const m = r.manifest;
    if (typeof m.presetIdentity !== "string" || m.init === undefined || typeof m.initHash !== "string") {
      problems.push(`${id}: legacy bundle lacks provenance (presetIdentity/init/initHash) -- rerun with current tools/run.ts before using it for a registered preset`);
      continue;
    }
    if (m.presetIdentity !== expectedIdentity)
      problems.push(`${id}: presetIdentity ${m.presetIdentity} does not match current preset "${presetId}"'s identity ${expectedIdentity}`);
    if (!initParamsEqual(m.init, preset.init))
      problems.push(`${id}: manifest.init ${JSON.stringify(m.init)} does not match current preset "${presetId}"'s init ${JSON.stringify(preset.init)}`);
    let expectedInitHash: string;
    try {
      expectedInitHash = stateHash(initWorld(m.cfg, preset.init));
    } catch (e) {
      problems.push(`${id}: could not recompute the founder-state hash from this run's cfg: ${(e as Error).message}`);
      continue;
    }
    if (m.initHash !== expectedInitHash)
      problems.push(`${id}: initHash ${m.initHash} does not match the recomputed founder-state hash ${expectedInitHash} for this run's config -- founder content differs from what the current preset produces`);
  }
  return problems;
}

/** The two existing scientific policies, not arbitrary caller-ordered guards. */
export type CohortPolicy =
  | { kind: "analysis"; registeredPresets: readonly string[] }
  | { kind: "calibration"; presetId: string };

export type CohortIssue =
  | { kind: "empty" }
  | { kind: "ensemble"; problems: string[] }
  | { kind: "ring"; conditions: string[]; count: number }
  | { kind: "provenance"; presetId: string; problems: string[] }
  | { kind: "conservation" }
  | { kind: "insufficient"; count: number };

interface CohortEvidence {
  /** All completed histories, including excluded seeds reserved by the experiment. */
  loaded: Run[];
  /** All histories selected by the policy, including conservation failures. */
  selected: Run[];
  ignored: Run[];
  invalid: Run[];
}

type CohortRefusal = { ok: false; issue: CohortIssue };
type CohortReady = { ok: true; presetId: string; runs: Run[] };
export type PreparedAnalysisCohort = CohortEvidence & (
  | CohortRefusal
  | (CohortReady & { neutralActivities: number[] })
);
export type PreparedCalibrationCohort = CohortEvidence & (
  | CohortRefusal
  | (CohortReady & { neutralActivities: RunActivities[] })
);
type PreparedCohort = PreparedAnalysisCohort | PreparedCalibrationCohort;

/**
 * Prepare independent histories before touching their potentially large lineage
 * tables. Analysis retains every completed seed for reservation checks and only
 * requires provenance on conservation-eligible registered runs. Calibration
 * selects neutral histories first and requires provenance even on histories
 * later excluded by conservation. These distinct policies are intentional.
 *
 * Neutral activity replay is sequential and streaming. Ignored conditions,
 * excluded histories and cohorts refused by these guards never reach replay;
 * a corrupt eligible table still throws. Threshold choice, freezeability and
 * inference remain caller responsibilities.
 */
export function prepareCohort(root: string, policy: Extract<CohortPolicy, { kind: "analysis" }>): Promise<PreparedAnalysisCohort>;
export function prepareCohort(root: string, policy: Extract<CohortPolicy, { kind: "calibration" }>): Promise<PreparedCalibrationCohort>;
export async function prepareCohort(root: string, policy: CohortPolicy): Promise<PreparedCohort> {
  const loaded = await loadRunsUnder(root);
  const selected = policy.kind === "calibration" ? loaded.filter((r) => r.condition === "neutral") : loaded;
  const ignored = policy.kind === "calibration" ? loaded.filter((r) => r.condition !== "neutral") : [];
  const { eligible, invalid } = partitionByConservation(selected);
  const evidence: CohortEvidence = { loaded, selected, ignored, invalid };
  const refuse = (issue: CohortIssue): CohortEvidence & CohortRefusal => ({ ...evidence, ok: false, issue });
  if (!selected.length) return refuse({ kind: "empty" });
  const problems = ensembleProblems(selected);
  if (problems.length) return refuse({ kind: "ensemble", problems });
  const ring = metapopulationRingProblems(selected);
  if (ring) return refuse({ kind: "ring", ...ring });

  if (policy.kind === "analysis" && !eligible.length) return refuse({ kind: "conservation" });
  const presetId = policy.kind === "calibration" ? policy.presetId : eligible[0].manifest.spec.presetId as string;
  if (policy.kind === "calibration" || policy.registeredPresets.includes(presetId)) {
    const problems = provenanceProblems(policy.kind === "calibration" ? selected : eligible, presetId);
    if (problems.length) return refuse({ kind: "provenance", presetId, problems });
  }
  if (policy.kind === "calibration" && eligible.length < 2) return refuse({ kind: "insufficient", count: eligible.length });
  const runs = policy.kind === "calibration" ? [...eligible].sort((a, b) => a.seed - b.seed) : eligible;
  // Analysis needs one pooled distribution, calibration needs per-run values
  // for resampling. Never retain both representations for analysis.
  const pooled: number[] = [];
  const perRun: RunActivities[] = [];
  for (const r of runs) {
    if (r.condition !== "neutral") continue;
    const values = (await activities(r)).tracker.allActivities();
    if (policy.kind === "calibration") perRun.push({ seed: r.seed, activities: values });
    else for (const value of values) pooled.push(value);
  }
  if (policy.kind === "calibration") return { ...evidence, ok: true, presetId, runs, neutralActivities: perRun };
  return { ...evidence, ok: true, presetId, runs, neutralActivities: pooled };
}
