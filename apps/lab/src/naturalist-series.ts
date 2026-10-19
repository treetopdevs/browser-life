// The series fields the naturalist reads from a lab census (docs/naturalist-field-notes-v0-2026-10-18.md, "Parity"): the
// thirteen numbers of a run bundle's series.jsonl record that the bell's signals are read from, computed with the runner's own
// expressions in the runner's order (packages/runner/src/runner.ts, the `rec` of each census, around lines 1293-1318), so a lab
// world and the bundle of the same preset and seed give the same numbers census for census. Pure: no DOM, no GPU.
import { bioticRecycling, entropy, individuals, type Census, type FluxRates } from "@bl/metrics";

/** The presets the naturalist holds a baseline for (docs/naturalist-field-notes-v0-2026-10-18.md, "Which rule, per world"). */
export const NATURALIST_PRESETS: ReadonlySet<string> = new Set(["gradient-m3", "spots-m3"]);
/** The baselines' cadence and last census (naturalist.ts CADENCE and HORIZON, which import these): the worker posts nothing the panel would not read. */
export const NATURALIST_CADENCE = 100;
export const NATURALIST_HORIZON = 300_000;

/**
 * Whether a census at `step` of a history whose first logged intervention is at `touched` (null: none) can still matter to the
 * panel: up to the first census past the horizon (which ends the reading) and the first census after a change by hand (which stops it).
 */
export const naturalistReads = (step: number, touched: number | null): boolean =>
  step <= NATURALIST_HORIZON + NATURALIST_CADENCE && (touched === null || touched >= step - NATURALIST_CADENCE);

/** The series record's fields a bell signal is read from, plus its step. Every value is a number as the runner writes it. */
export interface SeriesFields {
  step: number;
  livingCells: number;
  individuals: number;
  meanMass: number;
  lineages: number;
  lineageShannon: number;
  patternEntropy: number;
  bioticRecycling: number;
  maxGeneration: number;
  fissions: number;
  fusions: number;
  buddings: number;
  mutations: number;
}
/** The fields in a fixed order (the fixture and the parity checks compare them in this order). */
export const SERIES_FIELDS = ["step", "livingCells", "individuals", "meanMass", "lineages", "lineageShannon", "patternEntropy", "bioticRecycling", "maxGeneration", "fissions", "fusions", "buddings", "mutations"] as const satisfies readonly (keyof SeriesFields)[];

/** The observer counters a census's record carries, read right after `observeCensus` and before the boundary's transforms. */
export interface SeriesCounters {
  fissions: number;
  fusions: number;
  buddings: number;
  maxGeneration: number;
  mutations: number;
}

/**
 * The record's fields for census `c`: `sym` is its occupancy pattern (`observeCensus`), `rates` the flux rates since the previous
 * census (`fluxRates(prev, cur, steps)`, null when unknown), `counters` the tracker's and observer's totals at this census.
 */
export function seriesFields(c: Census, sym: Uint8Array, rates: FluxRates | null, counters: SeriesCounters): SeriesFields {
  const ind = individuals(c);
  const totalMass = c.lineages.reduce((a, l) => a + l.mass, 0) || 1;
  let shannon = 0;
  for (const l of c.lineages) shannon -= (l.mass / totalMass) * Math.log2(l.mass / totalMass || 1);
  return {
    step: c.step,
    livingCells: c.livingCells,
    individuals: ind.length,
    meanMass: ind.reduce((a, k) => a + k.mass, 0) / Math.max(1, ind.length),
    lineages: c.lineages.length,
    lineageShannon: shannon,
    patternEntropy: entropy(sym),
    // Without the previous census's flux (no start state) the rate is not known: NaN, which the naturalist refuses to read.
    bioticRecycling: rates ? bioticRecycling(rates) : NaN,
    maxGeneration: counters.maxGeneration,
    fissions: counters.fissions,
    fusions: counters.fusions,
    buddings: counters.buddings,
    mutations: counters.mutations,
  };
}

/** A census's lineage rows as lineages.tsv holds them: [key, cells], in the census's order. */
export const lineageRows = (c: Census): [string, number][] => c.lineages.map((l) => [l.key, l.cells]);

/** The earliest step of any logged intervention (a wound, a feed or drain, or any other), or null when none is logged. */
export function firstIntervention(log: readonly { step: number }[]): number | null {
  let first: number | null = null;
  for (const iv of log) if (first === null || iv.step < first) first = iv.step;
  return first;
}
