// Renderer for the "anticipation" track:
// does an evolved population pay a larger relative fitness cost than an
// unevolved founder control when a predictable light cycle is broken by an
// unannounced period switch? See docs/anticipation.md for the full estimand and inference rules this
// renderer only visualises -- it computes no new statistic anywhere below;
// every plotted number is read directly off the input JSON.
//
// Only pilot output exists for this track today (runs/anticip/
// pilot-rebase-check/{results,manifest}.json, 3 seeds, 6 Phase-A periods): `meta.status` therefore defaults to PILOT at the CLI, but this
// renderer does not hard-code that: it reads `meta.status` and adjusts the
// finding sentence's wording accordingly, so a future non-pilot rerun (via
// `--status REAL`) renders an honest finding instead of "no finding claimed"
// pilot language, without any code change here.
import {
  caveatParagraph,
  caveatsSection,
  escapeHtml,
  figure,
  header,
  keyNumbersList,
  numbersTable,
  pageShell,
  type KeyNumberItem,
} from "./page.ts";
import { linearScale, niceTicks, forestPlot, slopegraph } from "./svg.ts";
import type { ForestRow } from "./svg.ts";
import type { RenderMeta } from "../../report-html.ts";

// ---------------------------------------------------------------------------
// Input shape (results.json + manifest.json). Fields not read by this
// renderer (e.g. `founderMassAtBoundary`, `manifest.startedAt`) are typed
// loosely or omitted; `startedAt` in particular must never be read here, so
// `render` stays a pure function of the numeric contents of both files, not
// of when the run happened.
// ---------------------------------------------------------------------------

export type SwitchDirection = "shorter" | "longer";

/** One direction's Phase-B branch outcome for one seed-world. All numeric
 * fields are individually nullable: `index = costEvolved - costFounder` is
 * `null` when either side's own branch collapsed (non-positive response),
 * even for a seed whose Phase A was viable in general. */
export interface BranchRow {
  costEvolved: number | null;
  costFounder: number | null;
  index: number | null;
  continueLightMean: number;
  switchLightMean: number;
  lightMeanDelta: number;
  energyCostEvolved: number | null;
  energyCostFounder: number | null;
}

/** One seed-world's result. `branches` is `Partial` and, per
 * `collapsedPhaseA`, can be `{}` entirely -- a seed whose Phase A already
 * ended non-positive in either arm is never branched into Phase B for either
 * direction. */
export interface SeedResult {
  seed: number;
  collapsedPhaseA: boolean;
  branches: Partial<Record<SwitchDirection, BranchRow>>;
  founderMassAtBoundary?: unknown;
}

export interface FamilyCiOk {
  lo: number;
  hi: number;
  status: "ok";
}

export interface FamilyCiUnavailable {
  lo: null;
  hi: null;
  status: "insufficient-replication" | "insufficient-reps";
}

export type FamilyCi = FamilyCiOk | FamilyCiUnavailable;

/** One direction's family-level (across-seed) summary. `n` is the surviving
 * paired-sample count for that direction; `n + collapsed + phaseACollapsed`
 * always recovers the full requested seed count. `meanIndex` is `null` when
 * `n` reaches 0 (every seed's branch for this direction collapsed): the
 * producer's in-memory `mean([])` is `NaN`, which `JSON.stringify` writes as
 * the JSON literal `null` -- a legitimate all-collapsed result, not a
 * validation failure (see `FamilyCiUnavailable`, which already has the same
 * "no real result" allowance for `ci`). */
export interface FamilyRow {
  n: number;
  collapsed: number;
  phaseACollapsed: number;
  meanIndex: number | null;
  medianIndex: number;
  wilcoxonP: number;
  ci: FamilyCi;
  holmP: number;
}

export interface AnticipationResults {
  seeds: SeedResult[];
  family: Record<SwitchDirection, FamilyRow>;
}

export interface AnticipationManifestArgs {
  seeds: number[];
  period: number;
  periodsA: number;
  switchShorter: number;
  switchLonger: number;
  k: number;
  tile?: number;
  founders?: number;
  kernelRadius?: number;
  controlLevelShift?: boolean;
  reps?: number;
  bootSeed?: number;
  out?: string;
}

export interface AnticipationManifest {
  args: AnticipationManifestArgs;
  ruleVersion?: number;
  schemaVersion?: number;
  preset?: string;
  baseOverride?: Record<string, unknown>;
  /** Metadata only -- deliberately never read by `render`, so the page stays
   * a deterministic function of the two files' numeric contents. */
  startedAt?: string;
}

export interface AnticipationReport {
  results: AnticipationResults;
  manifest: AnticipationManifest;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Throws a specific, readable error naming the first missing/malformed
 * field. Deliberately does NOT require `branches.shorter`/`branches.longer`
 * or their numeric fields to be present/non-null on every seed -- a seed
 * with `collapsedPhaseA: true` (so `branches: {}`) or a per-direction
 * `index: null` is valid input, not a validation failure. */
export function validate(data: unknown): asserts data is AnticipationReport {
  if (!isObject(data)) {
    throw new Error("anticipation: expected an object with {results, manifest}");
  }
  if (!isObject(data.results)) {
    throw new Error("anticipation: missing or non-object `results`");
  }
  if (!isObject(data.manifest)) {
    throw new Error("anticipation: missing or non-object `manifest`");
  }
  const results = data.results;

  if (!Array.isArray(results.seeds)) {
    throw new Error("anticipation: results.seeds must be an array");
  }
  results.seeds.forEach((s, i) => {
    if (!isObject(s)) {
      throw new Error(`anticipation: results.seeds[${i}] must be an object`);
    }
    if (typeof s.seed !== "number") {
      throw new Error(`anticipation: results.seeds[${i}].seed must be a number`);
    }
    if (typeof s.collapsedPhaseA !== "boolean") {
      throw new Error(`anticipation: results.seeds[${i}].collapsedPhaseA must be a boolean`);
    }
    if (!isObject(s.branches)) {
      throw new Error(`anticipation: results.seeds[${i}].branches must be an object (possibly {})`);
    }
  });

  if (!isObject(results.family)) {
    throw new Error("anticipation: missing or non-object `results.family`");
  }
  for (const dir of ["shorter", "longer"] as const) {
    const row = (results.family as Record<string, unknown>)[dir];
    if (!isObject(row)) {
      throw new Error(`anticipation: missing or non-object results.family.${dir}`);
    }
    if (typeof row.n !== "number") {
      throw new Error(`anticipation: results.family.${dir}.n must be a number`);
    }
    if (row.meanIndex !== null && typeof row.meanIndex !== "number") {
      throw new Error(`anticipation: results.family.${dir}.meanIndex must be a number or null`);
    }
    if (!isObject(row.ci) || typeof row.ci.status !== "string") {
      throw new Error(`anticipation: results.family.${dir}.ci must be an object with a string status`);
    }
    if (row.ci.status === "ok" && (typeof row.ci.lo !== "number" || typeof row.ci.hi !== "number")) {
      throw new Error(`anticipation: results.family.${dir}.ci has status "ok" but lo/hi are not both numbers`);
    }
  }

  if (!isObject(data.manifest.args)) {
    throw new Error("anticipation: manifest.args must be an object");
  }
  if (typeof data.manifest.args.switchShorter !== "number") {
    throw new Error("anticipation: manifest.args.switchShorter must be a number");
  }
  if (typeof data.manifest.args.switchLonger !== "number") {
    throw new Error("anticipation: manifest.args.switchLonger must be a number");
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const DIRECTIONS: readonly SwitchDirection[] = ["shorter", "longer"];

function fmt3(v: number | null | undefined): string {
  return v === null || v === undefined ? "–" : v.toFixed(3);
}

function branchNote(seed: SeedResult, dir: SwitchDirection): string {
  if (seed.collapsedPhaseA) return "collapsed (phase A)";
  const b = seed.branches[dir];
  if (!b) return "no branch for this direction";
  if (b.costFounder === null || b.costEvolved === null) return "branch collapsed";
  return "";
}

/** Computes "nice" ticks over `values` (plus 0, so every axis crosses zero)
 * and returns a scale domain equal to the ticks' own [first, last] -- never a
 * separately-padded domain. `niceTicks` already extends its input domain
 * outward to round numbers (e.g. `niceTicks([1, 9], 5)` -> `[0, 2, 4, 6, 8,
 * 10]`), so building the scale from anything narrower than the ticks
 * themselves would place the outer ticks outside the scale's own range,
 * pushing their axis labels outside the plot's viewBox. */
function niceDomainAndTicks(values: number[], count = 4): { domain: [number, number]; ticks: number[] } {
  const all = values.length ? values : [0];
  const lo = Math.min(...all, 0);
  const hi = Math.max(...all, 0);
  const ticks = niceTicks([lo, hi], count);
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

const VBOX = { width: 340, height: 200 };
const MARGIN = { top: 26, right: 16, bottom: 18, left: 16 };

function slopegraphSvgFor(results: AnticipationResults, dir: SwitchDirection): string {
  const pairs = results.seeds.map((s) => {
    const b = s.branches[dir];
    return {
      label: `seed ${s.seed}`,
      left: b?.costFounder ?? null,
      right: b?.costEvolved ?? null,
    };
  });
  const values = pairs.flatMap((p) => [p.left, p.right]).filter((v): v is number => v !== null);
  const { domain, ticks } = niceDomainAndTicks(values, 4);
  const plotTop = MARGIN.top;
  const plotBottom = VBOX.height - MARGIN.bottom;
  const yScale = linearScale(domain, [plotBottom, plotTop]);
  return slopegraph({
    viewBox: VBOX,
    margin: MARGIN,
    pairs,
    yScale,
    yTicks: ticks,
    yFormat: (v) => v.toFixed(3),
    leftLabel: "founder",
    rightLabel: "evolved",
    referenceLines: [{ value: 0, label: "0" }],
  });
}

function fig1(results: AnticipationResults, manifest: AnticipationManifest): { svg: string; table: string } {
  const media = DIRECTIONS.map((dir) => {
    const switchPeriod = dir === "shorter" ? manifest.args.switchShorter : manifest.args.switchLonger;
    const label = dir === "shorter" ? "Shorter switch" : "Longer switch";
    return `<div>
  <p style="margin:0 0 4px;font-family:var(--font-mono);font-size:0.8rem;color:var(--muted);">${label} (switch period ${escapeHtml(String(switchPeriod))})</p>
  ${slopegraphSvgFor(results, dir)}
</div>`;
  }).join("\n");
  // "fig-multi-col" (page.ts) overrides the shared full-width figure's
  // 540px svg min-width, which would otherwise force these two
  // intentionally-narrower side-by-side panels to overflow their flex row
  // and overlap each other instead of shrinking to fit.
  const svg = `<div class="fig-multi-col">\n${media}\n</div>`;

  const rows: (string | number)[][] = [];
  for (const seed of results.seeds) {
    for (const dir of DIRECTIONS) {
      const b = seed.branches[dir];
      rows.push([
        `seed ${seed.seed}`,
        dir,
        fmt3(b?.costFounder ?? null),
        fmt3(b?.costEvolved ?? null),
        branchNote(seed, dir),
      ]);
    }
  }
  const table = numbersTable(["seed", "direction", "cost founder", "cost evolved", "note"], rows);
  return { svg, table };
}

function fig2(results: AnticipationResults): { svg: string; table: string } {
  const rows: ForestRow[] = [];
  const tableRows: (string | number)[][] = [];
  const allValues: number[] = [];

  for (const dir of DIRECTIONS) {
    for (const seed of results.seeds) {
      const b = seed.branches[dir];
      const index = b?.index ?? null;
      if (index !== null) allValues.push(index);
      rows.push({
        label: `seed ${seed.seed} (${dir})`,
        point: index,
        unavailable: index === null,
        colorToken: "--accent2",
      });
      tableRows.push([
        `seed ${seed.seed}`,
        dir,
        fmt3(index),
        "–",
        "–",
        "–",
        "–",
        "–",
        index === null ? branchNote(seed, dir) : "",
      ]);
    }
    const fam = results.family[dir];
    const ci = fam.ci;
    const [ciLo, ciHi]: [number | undefined, number | undefined] = ci.status === "ok" ? [ci.lo, ci.hi] : [undefined, undefined];
    if (ciLo !== undefined) allValues.push(ciLo);
    if (ciHi !== undefined) allValues.push(ciHi);
    if (fam.meanIndex !== null) allValues.push(fam.meanIndex);
    rows.push({
      label: `family mean (${dir})`,
      point: fam.meanIndex,
      unavailable: fam.meanIndex === null,
      lower: ciLo,
      upper: ciHi,
      colorToken: "--accent",
    });
    tableRows.push([
      `family mean`,
      dir,
      fmt3(fam.meanIndex),
      ciLo !== undefined ? ciLo.toFixed(3) : "–",
      ciHi !== undefined ? ciHi.toFixed(3) : "–",
      String(fam.n),
      fam.wilcoxonP.toFixed(3),
      fam.holmP.toFixed(3),
      ci.status === "ok" ? "" : ci.status,
    ]);
  }

  const fig2Margin = { top: 10, right: 20, bottom: 30, left: 140 };
  // Width 720 matches the other tracks' full-width figures (nullcal,
  // individuality, biogeography) so the same declared font-size renders at
  // the same effective on-page size everywhere -- this figure previously
  // declared a much narrower 360, which (scaled up to the same full-page
  // width via `.fig-media svg { width:100% }`) rendered its text roughly
  // twice as large as every other figure on the page.
  const fig2ViewBox = { width: 720, height: 34 * rows.length + 40 };
  const { domain, ticks } = niceDomainAndTicks(allValues, 5);
  const xScale = linearScale(domain, [fig2Margin.left, fig2ViewBox.width - fig2Margin.right]);
  const svg = forestPlot({
    viewBox: fig2ViewBox,
    margin: fig2Margin,
    rows,
    xScale,
    xTicks: ticks,
    xFormat: (v) => v.toFixed(3),
    xLabel: "anticipation index (evolved cost − founder cost)",
    referenceLines: [{ value: 0, label: "0" }],
  });
  const table = numbersTable(
    ["row", "direction", "index / mean", "ci low", "ci high", "n", "wilcoxon p", "holm p", "note"],
    tableRows,
  );
  return { svg, table };
}

function ciText(ci: FamilyCi): string {
  return ci.status === "ok" ? `[${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]` : `unavailable: ${ci.status}`;
}

/** Builds the header's "Key numbers" list entirely mechanically from
 * `results`/`manifest`: per direction, the family mean index, its
 * Bonferroni-adjusted CI (or why it's unavailable, as the family row's own
 * status string -- never a guessed cause), n surviving seed-worlds, and the
 * secondary Wilcoxon p; plus the manifest's Phase A period count, light
 * period, and both switch periods. No claim anywhere about whether that
 * scale was sufficient -- see this module's header doc. */
function buildKeyNumbers(results: AnticipationResults, manifest: AnticipationManifest): KeyNumberItem[] {
  const items: KeyNumberItem[] = [];
  for (const dir of DIRECTIONS) {
    const fam = results.family[dir];
    items.push({ label: `Mean index (${dir})`, value: fam.meanIndex === null ? "unavailable" : fam.meanIndex.toFixed(3) });
    items.push({ label: `Bonferroni 97.5% CI (${dir})`, value: ciText(fam.ci) });
    items.push({ label: `n seed-worlds (${dir})`, value: String(fam.n) });
    items.push({ label: `Wilcoxon p (secondary) (${dir})`, value: fam.wilcoxonP.toFixed(3) });
  }
  items.push({
    label: "Phase A periods",
    value: typeof manifest.args.periodsA === "number" ? String(manifest.args.periodsA) : "unavailable",
  });
  items.push({
    label: "Light period",
    value: typeof manifest.args.period === "number" ? String(manifest.args.period) : "unavailable",
  });
  items.push({ label: "Switch period (shorter)", value: String(manifest.args.switchShorter) });
  items.push({ label: "Switch period (longer)", value: String(manifest.args.switchLonger) });
  return items;
}

/** Purely mechanical: the seed count, nothing else -- no evaluative word
 * ("not a result", "not meaningful"). The single per-status sentence
 * (`page.ts`'s `STATUS_SENTENCE`) is where PILOT/SMOKE's meaning lives. */
function statusNote(n: number): string {
  return `${n} seed${n === 1 ? "" : "s"}`;
}

export function render(data: AnticipationReport, meta: RenderMeta): string {
  const { results, manifest } = data;
  const n = results.seeds.length;

  const f1 = fig1(results, manifest);
  const f2 = fig2(results);

  const bodyHtml = `${header({
    title: "Light-Switch Anticipation",
    question:
      "Does an evolved population pay a larger relative fitness cost than an unevolved founder control when a predictable light cycle is broken by an unannounced period switch?",
    status: meta.status,
    statusNote: statusNote(n),
    sources: meta.sources,
    keyNumbers: keyNumbersList(buildKeyNumbers(results, manifest)),
  })}
${figure(
  1,
  f1.svg,
  `Per-seed paired comparison of log-biomass cost after a light-period switch, evolved population versus founder control, one panel per switch direction (shorter and longer). Each line connects one seed's founder cost (left) to its evolved cost (right); a line sloping down means the evolved population paid a larger relative cost than the founder control did on that seed. A dashed diamond marks a seed with no data on that side (Phase-A collapse or a collapsed branch).`,
  f1.table,
)}
${figure(
  2,
  f2.svg,
  `Per-seed anticipation index (evolved cost minus founder cost) for each switch direction, plus each direction's mean with a whisker for its confidence interval when one could be computed. The dashed vertical line marks zero (no differential cost). A dashed diamond marks a seed or family value with no index; a family mean drawn without a whisker has no confidence interval.`,
  f2.table,
)}
${caveatsSection("Caveats", [
  caveatParagraph(
    "The primary decision rule is the Bonferroni-adjusted confidence interval of the mean index, not the Wilcoxon signed-rank p-value shown alongside it. Wilcoxon assumes symmetry and is secondary, and does not protect against an unobserved tail: a population that is usually near zero but rarely swings large and positive can still produce a small Wilcoxon p and a wide bootstrap interval.",
  ),
  caveatParagraph(
    "A seed-world is excluded from a direction's result when either arm's Phase A ended non-positive (collapsedPhaseA) or that direction's own Phase B branch collapsed. n plus those two exclusion counts always equals the requested seed count.",
  ),
  caveatParagraph(
    "Confidence intervals built from a small number of surviving seed-worlds are coarse by construction; a narrow interval at low n is an artifact of that, not a strong result.",
  ),
  caveatParagraph("See docs/anticipation.md for the full estimand and inference rules this page visualises."),
])}`;

  return pageShell({ title: "Light-Switch Anticipation", bodyHtml });
}
