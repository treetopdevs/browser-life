// Renders tools/nullcal.ts's report.json (gate
// calibration against exchangeable null generators) into the "Null Gate
// Calibration" report page.
//
// Track status: REAL (32 replicates per null generator x window).
import {
  caveatParagraph,
  caveatsSection,
  figure,
  header,
  keyNumbersList,
  numbersTable,
  pageShell,
  type KeyNumberItem,
} from "./page.ts";
import { dotMatrix, forestPlot, linearScale, type ForestRow } from "./svg.ts";

export interface CIInterval {
  lower: number;
  upper: number;
}

/** One row of `tallies`/`boundedTreatmentVsFlat`: `n` decided trials (never
 * a fixed replicate count) plus `unavailable` trials tracked separately --
 * `n === 0` means every replicate was unavailable for this cell, a
 * "could not be evaluated" state distinct from an observed 0/n pass. */
export interface TallyRow {
  k: number;
  n: number;
  unavailable: number;
  ci: CIInterval | null;
}

export interface NullcalConfig {
  nulls: string[];
  windows: number[];
  replicates?: number;
  seedsPerCondition?: number;
  censusEvery?: number;
  deepEvery?: number;
  masterSeed?: number;
  experiment?: string;
  runBounded?: boolean;
}

export interface NullcalReport {
  config: NullcalConfig;
  codeIdentity?: unknown;
  wall?: unknown;
  /** Keyed `"${nullId}@${windowSteps}::${endpointId}"`. */
  tallies: Record<string, TallyRow>;
  /** Keyed `"boundedTreatmentVsFlat@${windowSteps}::${endpointId}"` -- the
   * positive control (a real bounded treatment vs. flat control effect),
   * never itself a null. */
  boundedTreatmentVsFlat: Record<string, TallyRow>;
  trials?: unknown[];
}

/** The 10 endpoint rows nullcal.ts tallies, in the fixed order this page
 * always displays them (4 null generators x this list = Figure 1's matrix
 * rows). `ecological-closure-coexistence.gate` is its own row here (matches
 * the source data 1:1) even though it is identical to
 * `ecological-closure-coexistence` in every run observed so far -- Figure 2
 * collapses the two into one panel and says so, but Figure 1's matrix shows
 * every row the producer actually reports. */
const ENDPOINTS = [
  "adaptive-activity",
  "unbounded-growth",
  "ecological-closure-recycling",
  "ecological-closure-coexistence",
  "ecological-closure-coexistence.gate",
  "held-out-temporal-mi",
  "held-out-differentiation",
  "held-out-compartmentalised",
  "held-out-role-count",
  "held-out-summary",
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isTallyRow(v: unknown): v is TallyRow {
  if (!isRecord(v)) return false;
  if (typeof v.k !== "number" || typeof v.n !== "number" || typeof v.unavailable !== "number") return false;
  if (!Number.isInteger(v.k) || !Number.isInteger(v.n) || !Number.isInteger(v.unavailable)) return false;
  if (v.k < 0 || v.n < 0 || v.unavailable < 0) return false;
  // A tally can never report more passes than decided trials.
  if (v.k > v.n) return false;
  if (v.ci === null) return true;
  if (!isRecord(v.ci)) return false;
  if (typeof v.ci.lower !== "number" || typeof v.ci.upper !== "number") return false;
  // A pass-rate confidence interval must sit inside [0,1] and be ordered.
  if (v.ci.lower < 0 || v.ci.upper > 1 || v.ci.lower > v.ci.upper) return false;
  return true;
}

function assertTallyMap(v: unknown, name: string): asserts v is Record<string, TallyRow> {
  if (!isRecord(v)) throw new Error(`nullcal: "${name}" must be an object, got ${v === null ? "null" : typeof v}`);
  for (const [key, row] of Object.entries(v)) {
    if (!isTallyRow(row)) {
      throw new Error(
        `nullcal: "${name}.${key}" is not a valid tally row -- expected {k:number,n:number,unavailable:number,ci:{lower,upper}|null}, got ${JSON.stringify(row)}`,
      );
    }
  }
}

export function validate(data: unknown): asserts data is NullcalReport {
  if (!isRecord(data)) throw new Error(`nullcal: report must be an object, got ${data === null ? "null" : typeof data}`);
  if (!isRecord(data.config)) throw new Error('nullcal: missing "config" object');
  const config = data.config;
  if (!Array.isArray(config.nulls) || !config.nulls.every((x) => typeof x === "string")) {
    throw new Error('nullcal: "config.nulls" must be an array of strings');
  }
  if (!Array.isArray(config.windows) || !config.windows.every((x) => typeof x === "number")) {
    throw new Error('nullcal: "config.windows" must be an array of numbers');
  }
  assertTallyMap(data.tallies, "tallies");
  assertTallyMap(data.boundedTreatmentVsFlat, "boundedTreatmentVsFlat");
}

/** Renders `steps` as `<mantissa>e<exponent>` ONLY when it is an exact
 * round-number multiple of a power of ten (a single-digit mantissa) --
 * `toExponential(0)` would otherwise silently ROUND the mantissa to one
 * digit and change the displayed value (e.g. 150000 -> "2e5", which reads as
 * 200,000). A non-round window falls back to a plain thousands-separated
 * integer instead of a misleading scientific form. */
function formatWindow(steps: number): string {
  if (steps < 1000) return String(steps);
  const exponent = Math.floor(Math.log10(steps));
  const mantissa = steps / Math.pow(10, exponent);
  if (Number.isInteger(mantissa)) return `${mantissa}e${exponent}`;
  return steps.toLocaleString("en-US");
}

function formatSteps(steps: number): string {
  return `${steps.toLocaleString("en-US")} steps`;
}

function formatKN(t: TallyRow | undefined): string {
  if (!t) return "n/a";
  if (t.n === 0) return `unavailable (${t.unavailable}/${t.unavailable} unavailable)`;
  return `${t.k}/${t.n}`;
}

function formatCI(t: TallyRow | undefined): string {
  if (!t || t.ci === null) return "unavailable";
  return `[${t.ci.lower.toFixed(3)}, ${t.ci.upper.toFixed(3)}]`;
}

function tallyToForestRow(label: string, t: TallyRow | undefined, colorToken: string): ForestRow {
  if (!t || t.n === 0) return { label, point: null, unavailable: true, colorToken };
  return { label, point: t.k / t.n, lower: t.ci?.lower ?? null, upper: t.ci?.upper ?? null, colorToken };
}

/** Whether this input actually carries a positive control: `config.runBounded`
 * is not explicitly `false` AND `boundedTreatmentVsFlat` has at least one
 * entry. A legitimate `runBounded:false` report (or one with an empty control
 * map for any other reason) renders NO control panel/column/caption clause --
 * presence is derived from the input, never assumed. */
function hasControl(data: NullcalReport): boolean {
  return data.config.runBounded !== false && Object.keys(data.boundedTreatmentVsFlat).length > 0;
}

// top=100 (up from an original 34) leaves enough headroom for dotMatrix's
// longest column label ("saturatingProcess", 17 chars) rotated 40deg when it
// doesn't fit its column width -- see svg.ts's dotMatrix doc for the
// rotation rule and the approximate-height formula this budgets for. Height
// grows by the same 66px so the matrix's plotted row spacing (rowH) is
// unchanged; the single-column control matrix (whose one label always fits
// horizontally) just gets a little extra header whitespace above it.
const MATRIX_VIEWBOX = { width: 720, height: 382 };
const MATRIX_MARGIN = { top: 100, right: 16, bottom: 10, left: 250 };

function passRateMatrix(data: NullcalReport, windowSteps: number, colLabels: readonly string[]): string {
  const isControl = colLabels.length === 1 && colLabels[0] === "boundedTreatmentVsFlat";
  const colorToken = isControl ? "--accent2" : "--accent";
  const cells = ENDPOINTS.map((endpoint) =>
    colLabels.map((col) => {
      const key = `${col}@${windowSteps}::${endpoint}`;
      const t = isControl ? data.boundedTreatmentVsFlat[key] : data.tallies[key];
      if (!t || t.n === 0) return { value: null, unavailable: true };
      return { value: t.k / t.n, ciLower: t.ci?.lower ?? null, ciUpper: t.ci?.upper ?? null };
    })
  );
  return dotMatrix({
    viewBox: MATRIX_VIEWBOX,
    margin: MATRIX_MARGIN,
    rowLabels: [...ENDPOINTS],
    colLabels: [...colLabels],
    cells,
    colorToken,
  });
}

function figure1(data: NullcalReport): { svg: string; table: string } {
  const control = hasControl(data);
  const parts: string[] = [];
  for (const w of data.config.windows) {
    parts.push(`<h3>Window ${formatWindow(w)} (${formatSteps(w)})</h3>`);
    parts.push(passRateMatrix(data, w, data.config.nulls));
    if (control) {
      parts.push(`<p class="report-question">Positive control (boundedTreatmentVsFlat): a real bounded effect, not a null.</p>`);
      parts.push(passRateMatrix(data, w, ["boundedTreatmentVsFlat"]));
    }
  }
  const svg = parts.join("\n");

  const headers = ["endpoint", "window", ...data.config.nulls, ...(control ? ["boundedTreatmentVsFlat"] : [])];
  const rows: (string | number)[][] = [];
  for (const endpoint of ENDPOINTS) {
    for (const w of data.config.windows) {
      const row: (string | number)[] = [endpoint, formatWindow(w)];
      for (const nullId of data.config.nulls) {
        row.push(formatKN(data.tallies[`${nullId}@${w}::${endpoint}`]));
      }
      if (control) row.push(formatKN(data.boundedTreatmentVsFlat[`boundedTreatmentVsFlat@${w}::${endpoint}`]));
      rows.push(row);
    }
  }
  return { svg, table: numbersTable(headers, rows) };
}

const FOREST_VIEWBOX = { width: 720, height: 20 + (10) * 26 + 30 };
const FOREST_MARGIN = { top: 20, right: 24, bottom: 30, left: 160 };

function forestRowsForEndpoint(data: NullcalReport, endpoint: string): ForestRow[] {
  const control = hasControl(data);
  const rows: ForestRow[] = [];
  for (const w of data.config.windows) {
    for (const nullId of data.config.nulls) {
      rows.push(tallyToForestRow(`${nullId} @ ${formatWindow(w)}`, data.tallies[`${nullId}@${w}::${endpoint}`], "--accent"));
    }
    if (control) {
      rows.push(
        tallyToForestRow(
          `control @ ${formatWindow(w)}`,
          data.boundedTreatmentVsFlat[`boundedTreatmentVsFlat@${w}::${endpoint}`],
          "--accent2",
        ),
      );
    }
  }
  return rows;
}

function figure2(data: NullcalReport): { svg: string; table: string } {
  const xTicks = [0, 0.25, 0.5, 0.75, 1];
  const xFormat = (v: number) => `${Math.round(v * 100)}%`;
  const xScale = linearScale([0, 1], [FOREST_MARGIN.left, FOREST_VIEWBOX.width - FOREST_MARGIN.right]);

  const unboundedRows = forestRowsForEndpoint(data, "unbounded-growth");
  const coexRows = forestRowsForEndpoint(data, "ecological-closure-coexistence");

  const svg = `<h3>unbounded-growth</h3>
${forestPlot({ viewBox: FOREST_VIEWBOX, margin: FOREST_MARGIN, rows: unboundedRows, xScale, xTicks, xFormat, xLabel: "pass rate" })}
<h3>ecological-closure-coexistence (ordinary rule; .gate is in Figure 1)</h3>
${forestPlot({ viewBox: FOREST_VIEWBOX, margin: FOREST_MARGIN, rows: coexRows, xScale, xTicks, xFormat, xLabel: "pass rate" })}`;

  const control = hasControl(data);
  const headers = ["endpoint", "series", "window", "k/n", "95% CI"];
  const rows: (string | number)[][] = [];
  for (const [label, endpoint] of [
    ["unbounded-growth", "unbounded-growth"],
    ["ecological-closure-coexistence", "ecological-closure-coexistence"],
  ] as const) {
    for (const w of data.config.windows) {
      for (const nullId of data.config.nulls) {
        const t = data.tallies[`${nullId}@${w}::${endpoint}`];
        rows.push([label, nullId, formatWindow(w), formatKN(t), formatCI(t)]);
      }
      if (control) {
        const bt = data.boundedTreatmentVsFlat[`boundedTreatmentVsFlat@${w}::${endpoint}`];
        rows.push([label, "boundedTreatmentVsFlat (control)", formatWindow(w), formatKN(bt), formatCI(bt)]);
      }
    }
  }
  return { svg, table: numbersTable(headers, rows) };
}

/** The replicate count shown in the Key numbers list: `config.replicates`
 * when the producer recorded it, else the first decided cell's own `n` --
 * never a fixed literal, so a rerun with a different replicate count renders
 * its own true number. */
function computeReplicateCount(data: NullcalReport): number {
  return (
    data.config.replicates ?? Object.values(data.tallies).find((t) => t.n > 0)?.n ?? Object.values(data.tallies)[0]?.n ?? 0
  );
}

/** Every (nullId, endpoint) cell at window `w` with k>0, formatted as
 * "nullId endpoint k/n" -- a mechanical listing (every cell's own k/n, never
 * a shared/assumed denominator), not a judgment about which cells are
 * "exceptions" to anything. */
function cellsWithAnyPass(data: NullcalReport, w: number): string {
  const entries: string[] = [];
  for (const endpoint of ENDPOINTS) {
    for (const nullId of data.config.nulls) {
      const t = data.tallies[`${nullId}@${w}::${endpoint}`];
      if (t && t.n > 0 && t.k > 0) entries.push(`${nullId} ${endpoint} ${t.k}/${t.n}`);
    }
  }
  return entries.length ? entries.join("; ") : "none";
}

/** Every endpoint whose positive control (boundedTreatmentVsFlat) cell at
 * window `w` passes at k===n. Only meaningful when `hasControl(data)` is
 * true; the caller gates on that before adding this item. */
function controlRowsPassingAtKEqualsN(data: NullcalReport, w: number): string {
  const entries: string[] = [];
  for (const endpoint of ENDPOINTS) {
    const t = data.boundedTreatmentVsFlat[`boundedTreatmentVsFlat@${w}::${endpoint}`];
    if (t && t.n > 0 && t.k === t.n) entries.push(endpoint);
  }
  return entries.length ? entries.join(", ") : "none";
}

/** Builds the header's "Key numbers" list entirely mechanically from
 * `data`: replicates/generators/windows from config, then two per-window
 * items (null cells with any pass, and -- only when the input actually has a
 * positive control -- control rows passing at k=n). No interpretation of
 * what these facts mean. */
function buildKeyNumbers(data: NullcalReport): KeyNumberItem[] {
  const control = hasControl(data);
  const items: KeyNumberItem[] = [
    { label: "Replicates", value: String(computeReplicateCount(data)) },
    { label: "Null generators", value: data.config.nulls.join(", ") || "none" },
    { label: "Windows", value: data.config.windows.map(formatWindow).join(", ") || "none" },
  ];
  for (const w of data.config.windows) {
    items.push({
      label: `Null cells with any pass (k>0), window ${formatWindow(w)}`,
      value: cellsWithAnyPass(data, w),
    });
    if (control) {
      items.push({
        label: `Positive control rows passing at k=n, window ${formatWindow(w)}`,
        value: controlRowsPassingAtKEqualsN(data, w),
      });
    }
  }
  return items;
}

/** Method-only caveats: every sentence here is true for any valid nullcal
 * input, never a claim built from this run's specific tallies. The
 * boundedTreatmentVsFlat caveat is only included when the input actually has
 * a control (see `hasControl`). */
function buildCaveats(data: NullcalReport): string[] {
  const caveats: string[] = [
    caveatParagraph(
      "unbounded-growth is a majority/minority classification rule, not a significance test at a fixed alpha, so any nonzero pass rate among the null generators reflects finite-window classification behavior, not a coded false-positive rate.",
    ),
    caveatParagraph(
      "ecological-closure-coexistence and its .gate variant are different rules: .gate requires more coexisting roles, so a history can pass one and fail the other. Figure 1 shows both; Figure 2 plots only the ordinary rule. Genuine coexistence in a bounded generator is not evidence of open-endedness.",
    ),
  ];

  if (hasControl(data)) {
    caveats.push(
      caveatParagraph(
        `boundedTreatmentVsFlat is a real bounded treatment-vs-control effect, not a null generator: a high pass rate there shows "treatment differs from control", not "open-endedness" specifically.`,
      ),
    );
  }

  caveats.push(
    caveatParagraph(
      "A finite replicate count leaves wide Clopper-Pearson intervals on rare events; treat any single-digit k as imprecise, not a precise rate.",
    ),
  );
  caveats.push(
    caveatParagraph(
      "See docs/plan.md (the gate-calibration method under \"Milestones and gates\") for the full calibration method this page visualises.",
    ),
  );

  return caveats;
}

export function render(data: NullcalReport, meta: { sources: { path: string; sha256: string }[]; status: "REAL" | "PILOT" | "SMOKE" }): string {
  const fig1 = figure1(data);
  const fig2 = figure2(data);
  const repN = computeReplicateCount(data);
  const nullCount = data.config.nulls.length;
  const windowCount = data.config.windows.length;
  const control = hasControl(data);

  const body = `${header({
    title: "Null Gate Calibration",
    question: "Do the held-out endpoint gates falsely fire on data known to be bounded, non-open-ended (exchangeable nulls)?",
    status: meta.status,
    statusNote: `${repN} replicate${repN === 1 ? "" : "s"} x ${nullCount} null generator${nullCount === 1 ? "" : "s"} x ${windowCount} window${windowCount === 1 ? "" : "s"}${control ? ", plus a bounded positive control" : ""}`,
    sources: meta.sources,
    keyNumbers: keyNumbersList(buildKeyNumbers(data)),
  })}
${figure(
  1,
  `<div class="fig-panels">${fig1.svg}</div>`,
  `Pass rate (k/n, each cell's own denominator, never a fixed one) per endpoint row, one panel per configured window. Dot area is proportional to the rate, with a Clopper-Pearson whisker when n>0. A hatched open diamond marks a cell where all replicates were unavailable (n=0); never the same mark as an observed 0% pass.${control ? " When the input has a positive control (boundedTreatmentVsFlat), it is shown as its own one-column panel below each window's matrix, in a different color." : ""}`,
  fig1.table,
)}
${figure(
  2,
  fig2.svg,
  `unbounded-growth and ecological-closure-coexistence (the ordinary rule only; .gate is in Figure 1), one row per null generator${control ? " plus the positive control" : ""} per configured window. No 0.05 reference line is drawn: unbounded-growth is a majority/minority classification rule, not an alpha test, so a threshold line would misstate what the number means.`,
  fig2.table,
)}
${caveatsSection("Caveats", buildCaveats(data))}`;

  return pageShell({ title: "Null Gate Calibration", bodyHtml: body });
}
