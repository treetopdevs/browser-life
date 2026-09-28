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
import { ActivityTracker } from "@bl/metrics";
import { sameConfig, specConfig } from "@bl/runner";

export interface Run {
  condition: string;
  seed: number;
  dir: string;
  series: Record<string, any>[];
  /**
   * In-memory lineage table (census step -> [lineage, cells]) for synthetic
   * runs built without a bundle on disk (tools/nullcal.ts). Real bundles
   * leave it unset and `activities` streams their lineages.tsv instead.
   */
  lineages?: Map<number, [string, number][]>;
  /** In-memory sibling pairs at fission ([muA, muB, sigmaA, sigmaB]) for a synthetic run; see `heredityPairs`. */
  heredity?: [number, number, number, number][];
  manifest: any;
  /** Set by a `loadRunsUnder` reducer that replays activities as each run loads (see calibrate.ts). */
  activities?: number[];
}

export class RunReplayError extends Error {
  constructor(readonly runDir: string, cause: unknown) {
    super(`${runDir}: activity replay failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
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
 * `reduce`, applied to each run as it loads, lets a caller derive what it
 * needs up front (e.g. calibrate.ts's activity distribution).
 */
export async function loadRunsUnder(root: string, reduce: (r: Run) => Run | Promise<Run> = (r) => r): Promise<Run[]> {
  const loaded: Run[] = [];
  for await (const cond of Deno.readDir(root)) {
    if (!cond.isDirectory || cond.name === "report") continue;
    for await (const sd of Deno.readDir(`${root}/${cond.name}`)) {
      const m = /^seed-(\d+)$/.exec(sd.name);
      if (!m) continue;
      const r = await loadRun(`${root}/${cond.name}/${sd.name}`, cond.name, Number(m[1]));
      if (r) {
        try {
          loaded.push(await reduce(r));
        } catch (e) {
          throw new RunReplayError(r.dir, e);
        }
      }
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
  // Split lines by hand rather than with jsr:@std/streams, so that importing
  // this module (via tools/analyze.ts) needs no jsr: resolution under vitest.
  async function* lines(): AsyncGenerator<string> {
    const file = await Deno.open(`${dir}/lineages.tsv`);
    // Each chunk is scanned once; an unfinished line's fragments are kept
    // until its newline arrives, so the cost is linear in the file size.
    let pending: string[] = [];
    for await (const chunk of file.readable.pipeThrough(new TextDecoderStream())) {
      let start = 0;
      let nl: number;
      while ((nl = chunk.indexOf("\n", start)) >= 0) {
        const line = pending.length ? pending.join("") + chunk.slice(start, nl) : chunk.slice(start, nl);
        pending = [];
        yield line.endsWith("\r") ? line.slice(0, -1) : line;
        start = nl + 1;
      }
      if (start < chunk.length) pending.push(chunk.slice(start));
    }
    const last = pending.join("");
    if (last) yield last.endsWith("\r") ? last.slice(0, -1) : last;
  }
  let header = true;
  let step = -Infinity;
  let rows: [string, number][] = [];
  for await (const l of lines()) {
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
  const censuses = r.lineages
    ? (async function* () {
      yield* [...r.lineages!.entries()].sort((a, b) => a[0] - b[0]);
    })()
    : lineageCensuses(r.dir);
  for await (const [step, rows] of censuses) {
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

/**
 * Sibling growth-parameter pairs at fission from a run's heredity.tsv
 * (columns step, muA, muB, sigmaA, sigmaB, massA, massB): `Run.heredity` for
 * an in-memory run, the file for a real bundle, or null when a synthetic run
 * carries none or a bundle has no such file.
 */
export async function heredityPairs(r: Run): Promise<[number, number, number, number][] | null> {
  if (r.heredity) return r.heredity;
  if (r.lineages) return null;
  let text: string;
  try {
    text = await Deno.readTextFile(`${r.dir}/heredity.tsv`);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
  const [head, ...rows] = text.trim().split("\n");
  const cols = head.split("\t");
  const at = (name: string) => {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`${r.dir}/heredity.tsv lacks column ${name}`);
    return i;
  };
  const [ma, mb, sa, sb] = [at("muA"), at("muB"), at("sigmaA"), at("sigmaB")];
  return rows.filter(Boolean).map((l) => {
    const f = l.split("\t").map(Number);
    return [f[ma], f[mb], f[sa], f[sb]];
  });
}
