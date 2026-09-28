// Pure inline-SVG chart primitives for tools/report-html.ts's four track
// renderers. Every function here returns an SVG string built only from
// `var(--token)` fills/strokes/text colours (never a literal hex colour) and
// only finite pixel coordinates -- `num()` below throws rather than ever
// emitting NaN/Infinity into a `d`/`points`/coordinate attribute, so a
// renderer bug surfaces immediately instead of shipping a silently broken
// chart. No Date/Math.random anywhere in this file: same input, same SVG
// string, always (tools/test/report-html/determinism.test.ts).
//
// "Drawn to scale" (design contract): a domain passed to `linearScale`/
// `logScale`/`niceTicks` must already be extended by the CALLER to cover
// every whisker/CI endpoint actually drawn, not just point estimates -- a
// renderer computes its own domain (typically
// `[min(...allValuesIncludingWhiskers), max(...)]`) before calling these.
import { escapeHtml } from "./page.ts";

export type Scale = (value: number) => number;

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewBox {
  width: number;
  height: number;
}

/** Formats a pixel coordinate for an SVG attribute, rounded to 3 decimal
 * places to keep markup compact. Throws on NaN/Infinity rather than ever
 * emitting one -- a non-finite coordinate is always a caller bug (a
 * degenerate scale, a null value that should have been filtered out
 * upstream), never something to paper over silently. */
export function num(v: number): string {
  if (!Number.isFinite(v)) {
    throw new Error(`svg: refusing to emit a non-finite coordinate (${v}) -- check the caller's scale/domain`);
  }
  return String(Math.round(v * 1000) / 1000);
}

/**
 * A linear scale mapping `domain` (a value range) onto `range` (a pixel
 * range), inclusive at both ends: `scale(domain[0]) === range[0]` and
 * `scale(domain[1]) === range[1]` exactly. When the domain is degenerate
 * (`domain[0] === domain[1]`, e.g. every replicate reports an identical
 * value) returns a constant function at the midpoint of `range` instead of
 * dividing by zero.
 */
export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) {
    const mid = (r0 + r1) / 2;
    return () => mid;
  }
  const m = (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * m;
}

/**
 * A logarithmic scale (natural log internally; the base cancels out of the
 * ratio, so any log works) mapping a strictly-positive `domain` onto `range`,
 * inclusive at both ends like `linearScale`. Throws if either domain bound is
 * <= 0 -- a log scale over a domain touching or crossing zero has no honest
 * pixel mapping, so this is a caller bug, not a value to clamp away. Also
 * degenerate-safe like `linearScale`.
 */
export function logScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  if (!(d0 > 0) || !(d1 > 0)) {
    throw new Error(`logScale: domain must be strictly positive, got [${d0}, ${d1}]`);
  }
  const [r0, r1] = range;
  if (d1 === d0) {
    const mid = (r0 + r1) / 2;
    return () => mid;
  }
  const l0 = Math.log(d0);
  const l1 = Math.log(d1);
  const m = (r1 - r0) / (l1 - l0);
  return (v: number) => r0 + (Math.log(v) - l0) * m;
}

/** "Nice" round-number ticks (the standard Sparks/Heckbert algorithm)
 * spanning at least `domain`, with roughly `count` ticks. Degenerate domain
 * (`domain[0] === domain[1]`) returns that single value rather than dividing
 * by zero while picking a step. Requires `domain[0] <= domain[1]`. */
export function niceTicks(domain: [number, number], count = 5): number[] {
  const [lo, hi] = domain;
  if (lo > hi) throw new Error(`niceTicks: domain min ${lo} > max ${hi}`);
  if (lo === hi) return [lo];
  const n = Math.max(2, Math.floor(count));
  const span = niceNum(hi - lo, false);
  const step = niceNum(span / (n - 1), true);
  const niceLo = Math.floor(lo / step) * step;
  const niceHi = Math.ceil(hi / step) * step;
  const steps = Math.round((niceHi - niceLo) / step);
  const ticks: number[] = [];
  for (let i = 0; i <= steps; i++) ticks.push(roundToStep(niceLo + i * step, step));
  return ticks;
}

function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

/** Rounds `v` to avoid float-accumulation noise (e.g. `0.1 + 0.2`) when
 * walking a tick range in steps of `step`; keeps ~6 significant digits past
 * `step`'s own magnitude. */
function roundToStep(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 6);
  const factor = Math.pow(10, decimals);
  return Math.round(v * factor) / factor;
}

export type Orientation = "bottom" | "left";

export interface AxisOptions {
  orientation: Orientation;
  scale: Scale;
  ticks: number[];
  /** Pixel position of the axis baseline along the cross-axis: the y for a
   * bottom axis, the x for a left axis. */
  at: number;
  /** When given, draws a faint gridline from each tick out to this pixel
   * position (the far edge of the plot area) instead of just a short tick
   * mark. */
  gridTo?: number;
  format?: (v: number) => string;
  label?: string;
  viewBox: ViewBox;
}

/** Renders one axis: a baseline, a tick + label per value in `ticks`, an
 * optional faint gridline per tick, and an optional axis title. All strokes
 * and text use `--rule`/`--muted` tokens. */
export function axis(o: AxisOptions): string {
  const fmt = o.format ?? ((v: number) => String(v));
  const parts: string[] = [];
  const px = o.ticks.map(o.scale);
  const lo = Math.min(...px);
  const hi = Math.max(...px);
  if (o.orientation === "bottom") {
    parts.push(
      `<line x1="${num(lo)}" x2="${num(hi)}" y1="${num(o.at)}" y2="${num(o.at)}" stroke="var(--rule)" stroke-width="1" />`,
    );
    for (const t of o.ticks) {
      const x = o.scale(t);
      if (o.gridTo !== undefined) {
        parts.push(
          `<line x1="${num(x)}" x2="${num(x)}" y1="${num(o.gridTo)}" y2="${num(o.at)}" stroke="var(--rule)" stroke-width="1" stroke-opacity="0.5" />`,
        );
      }
      parts.push(
        `<line x1="${num(x)}" x2="${num(x)}" y1="${num(o.at)}" y2="${num(o.at + 5)}" stroke="var(--muted)" stroke-width="1" />`,
      );
      parts.push(
        `<text x="${num(x)}" y="${num(o.at + 18)}" text-anchor="middle" fill="var(--muted)" font-size="11">${escapeHtml(fmt(t))}</text>`,
      );
    }
    if (o.label) {
      parts.push(
        `<text x="${num(o.viewBox.width / 2)}" y="${num(o.viewBox.height - 4)}" text-anchor="middle" fill="var(--muted)" font-size="11">${escapeHtml(o.label)}</text>`,
      );
    }
  } else {
    parts.push(
      `<line x1="${num(o.at)}" x2="${num(o.at)}" y1="${num(lo)}" y2="${num(hi)}" stroke="var(--rule)" stroke-width="1" />`,
    );
    for (const t of o.ticks) {
      const y = o.scale(t);
      if (o.gridTo !== undefined) {
        parts.push(
          `<line x1="${num(o.at)}" x2="${num(o.gridTo)}" y1="${num(y)}" y2="${num(y)}" stroke="var(--rule)" stroke-width="1" stroke-opacity="0.5" />`,
        );
      }
      parts.push(
        `<line x1="${num(o.at - 5)}" x2="${num(o.at)}" y1="${num(y)}" y2="${num(y)}" stroke="var(--muted)" stroke-width="1" />`,
      );
      parts.push(
        `<text x="${num(o.at - 8)}" y="${num(y + 3.5)}" text-anchor="end" fill="var(--muted)" font-size="11">${escapeHtml(fmt(t))}</text>`,
      );
    }
    if (o.label) {
      parts.push(
        `<text x="12" y="${num(o.viewBox.height / 2)}" text-anchor="middle" fill="var(--muted)" font-size="11" transform="rotate(-90 12 ${num(o.viewBox.height / 2)})">${escapeHtml(o.label)}</text>`,
      );
    }
  }
  return `<g>${parts.join("")}</g>`;
}

/** A dashed vertical (for a bottom-scaled axis) or horizontal (for a
 * left-scaled axis) reference line -- e.g. 0, alpha, a nominal threshold --
 * spanning the plot area, with a small label. */
export function referenceLine(
  orientation: Orientation,
  posPx: number,
  spanFrom: number,
  spanTo: number,
  label: string,
  colorToken = "--muted",
): string {
  if (orientation === "bottom") {
    return `<g><line x1="${num(posPx)}" x2="${num(posPx)}" y1="${num(spanFrom)}" y2="${num(spanTo)}" stroke="var(${colorToken})" stroke-width="1" stroke-dasharray="4,3" /><text x="${num(posPx + 4)}" y="${num(spanFrom + 10)}" fill="var(${colorToken})" font-size="10">${escapeHtml(label)}</text></g>`;
  }
  // "left" orientation (used by slopegraph): the plotted marks live entirely
  // within [spanFrom, spanTo] (the two label columns and the lines between
  // them), so placing the label just past `spanTo` -- in the empty margin
  // space, never over the columns -- keeps it clear of every mark instead of
  // sitting on top of the left column the way a `spanFrom`-anchored label
  // would.
  return `<g><line x1="${num(spanFrom)}" x2="${num(spanTo)}" y1="${num(posPx)}" y2="${num(posPx)}" stroke="var(${colorToken})" stroke-width="1" stroke-dasharray="4,3" /><text x="${num(spanTo + 8)}" y="${num(posPx + 3.5)}" fill="var(${colorToken})" font-size="10">${escapeHtml(label)}</text></g>`;
}

export interface ForestRow {
  label: string;
  /** Point estimate; `null` only alongside `unavailable: true`. */
  point: number | null;
  lower?: number | null;
  upper?: number | null;
  colorToken?: string;
  /** True when this row has no data at all for this endpoint/window (e.g.
   * nullcal's `n=0` cells, or an individuality row with no `profiles.default`)
   * -- rendered as a distinct hatched glyph, never the same mark as an
   * observed value of 0. */
  unavailable?: boolean;
}

export interface ForestPlotOptions {
  viewBox: ViewBox;
  margin: Margin;
  rows: ForestRow[];
  xScale: Scale;
  xTicks: number[];
  xFormat?: (v: number) => string;
  xLabel?: string;
  referenceLines?: { value: number; label: string }[];
}

/** One point + optional whisker per row, stacked vertically with a
 * categorical (label) axis on the left and a numeric axis (`xScale`) on the
 * bottom. A row with `unavailable: true` (or `point: null`) draws an open
 * diamond with no fill instead of a point -- visually distinct from a real
 * value plotted at 0. */
export function forestPlot(o: ForestPlotOptions): string {
  const plotLeft = o.margin.left;
  const plotRight = o.viewBox.width - o.margin.right;
  const plotTop = o.margin.top;
  const plotBottom = o.viewBox.height - o.margin.bottom;
  const rowH = (plotBottom - plotTop) / Math.max(1, o.rows.length);
  const parts: string[] = [];

  parts.push(
    axis({
      orientation: "bottom",
      scale: o.xScale,
      ticks: o.xTicks,
      at: plotBottom,
      gridTo: plotTop,
      format: o.xFormat,
      label: o.xLabel,
      viewBox: o.viewBox,
    }),
  );

  for (const rl of o.referenceLines ?? []) {
    parts.push(referenceLine("bottom", o.xScale(rl.value), plotTop, plotBottom, rl.label));
  }

  o.rows.forEach((row, i) => {
    const y = plotTop + (i + 0.5) * rowH;
    const color = `var(${row.colorToken ?? "--accent"})`;
    parts.push(
      `<text x="${num(plotLeft - 8)}" y="${num(y + 3.5)}" text-anchor="end" fill="var(--ink)" font-size="12">${escapeHtml(row.label)}</text>`,
    );
    if (row.unavailable || row.point === null) {
      const r = 5;
      parts.push(
        `<rect x="${num(plotLeft - r)}" y="${num(y - r)}" width="${num(2 * r)}" height="${num(2 * r)}" transform="rotate(45 ${num(plotLeft)} ${num(y)})" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="2,2" />`,
      );
      return;
    }
    if (row.lower != null && row.upper != null) {
      const x0 = o.xScale(row.lower);
      const x1 = o.xScale(row.upper);
      parts.push(`<line x1="${num(x0)}" x2="${num(x1)}" y1="${num(y)}" y2="${num(y)}" stroke="${color}" stroke-width="1.5" />`);
      parts.push(`<line x1="${num(x0)}" x2="${num(x0)}" y1="${num(y - 4)}" y2="${num(y + 4)}" stroke="${color}" stroke-width="1.5" />`);
      parts.push(`<line x1="${num(x1)}" x2="${num(x1)}" y1="${num(y - 4)}" y2="${num(y + 4)}" stroke="${color}" stroke-width="1.5" />`);
    }
    const x = o.xScale(row.point);
    parts.push(`<circle cx="${num(x)}" cy="${num(y)}" r="4" fill="${color}" />`);
  });

  return `<svg viewBox="0 0 ${o.viewBox.width} ${o.viewBox.height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

export interface DotMatrixCell {
  /** Rate in [0, 1]; ignored when `unavailable` is true. */
  value: number | null;
  unavailable?: boolean;
  ciLower?: number | null;
  ciUpper?: number | null;
}

export interface DotMatrixOptions {
  viewBox: ViewBox;
  margin: Margin;
  rowLabels: string[];
  colLabels: string[];
  /** `cells[row][col]`. */
  cells: DotMatrixCell[][];
  maxRadius?: number;
  colorToken?: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A rows x columns pass-rate matrix. Dot AREA (not radius/diameter) is
 * proportional to `value`, so a doubled rate reads as a doubled area:
 * `radius = maxRadius * sqrt(value)`. A cell with `value === 0` still draws a
 * small open (unfilled) ring so an observed zero stays visible and distinct
 * from a cell with no dot; a cell with `unavailable: true` draws the same
 * hatched glyph `forestPlot` uses for "no data", never a 0%-rate dot. When
 * `ciLower`/`ciUpper` are given, draws a thin vertical whisker spanning the
 * radius each bound maps to (above and below the dot's centre). */
export function dotMatrix(o: DotMatrixOptions): string {
  const plotLeft = o.margin.left;
  const plotRight = o.viewBox.width - o.margin.right;
  const plotTop = o.margin.top;
  const plotBottom = o.viewBox.height - o.margin.bottom;
  const nCols = o.colLabels.length;
  const nRows = o.rowLabels.length;
  const colW = (plotRight - plotLeft) / Math.max(1, nCols);
  const rowH = (plotBottom - plotTop) / Math.max(1, nRows);
  const maxR = o.maxRadius ?? Math.min(colW, rowH) * 0.38;
  const color = `var(${o.colorToken ?? "--accent"})`;
  const parts: string[] = [];

  // A column label wider than its column collides with its neighbor when set
  // horizontally (e.g. 4 null-generator ids like "saturatingProcess" in a
  // narrow matrix) -- estimate label width at this font-size and, when it
  // would not fit, angle the label instead of letting it overlap. Anchored
  // with text-anchor="end" at the column's own tick point (x, plotTop - 8)
  // and rotated 40deg (SVG's clockwise-positive convention), so the label
  // reads bottom-right (at the tick) to top-left -- the standard tilted
  // axis-label layout, and one that only needs headroom, not extra width.
  // The caller must budget enough `margin.top` above the matrix for the
  // tallest rotated label (`label.length * FONT_SIZE * 0.6 * sin(40deg)`) --
  // see nullcal.ts's MATRIX_MARGIN for the concrete allowance.
  const COL_FONT_SIZE = 11;
  const APPROX_CHAR_WIDTH = COL_FONT_SIZE * 0.6;
  o.colLabels.forEach((label, c) => {
    const x = plotLeft + (c + 0.5) * colW;
    const approxWidth = label.length * APPROX_CHAR_WIDTH;
    if (approxWidth > colW * 0.9) {
      parts.push(
        `<text x="${num(x)}" y="${num(plotTop - 8)}" text-anchor="end" transform="rotate(40 ${num(x)} ${num(plotTop - 8)})" fill="var(--muted)" font-size="${COL_FONT_SIZE}">${escapeHtml(label)}</text>`,
      );
    } else {
      parts.push(
        `<text x="${num(x)}" y="${num(plotTop - 8)}" text-anchor="middle" fill="var(--muted)" font-size="${COL_FONT_SIZE}">${escapeHtml(label)}</text>`,
      );
    }
  });
  o.rowLabels.forEach((label, r) => {
    const y = plotTop + (r + 0.5) * rowH;
    parts.push(
      `<text x="${num(plotLeft - 8)}" y="${num(y + 3.5)}" text-anchor="end" fill="var(--ink)" font-size="12">${escapeHtml(label)}</text>`,
    );
  });

  o.cells.forEach((rowCells, r) => {
    const y = plotTop + (r + 0.5) * rowH;
    rowCells.forEach((cell, c) => {
      const x = plotLeft + (c + 0.5) * colW;
      if (cell.unavailable || cell.value === null) {
        parts.push(
          `<rect x="${num(x - 5)}" y="${num(y - 5)}" width="10" height="10" transform="rotate(45 ${num(x)} ${num(y)})" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="2,2" />`,
        );
        return;
      }
      const v = clamp01(cell.value);
      const radius = maxR * Math.sqrt(v);
      if (v === 0) {
        parts.push(`<circle cx="${num(x)}" cy="${num(y)}" r="2" fill="none" stroke="${color}" stroke-width="1.2" />`);
      } else {
        const opacity = 0.35 + 0.65 * v;
        parts.push(`<circle cx="${num(x)}" cy="${num(y)}" r="${num(radius)}" fill="${color}" fill-opacity="${opacity.toFixed(2)}" />`);
      }
      if (cell.ciLower != null && cell.ciUpper != null) {
        const rLower = maxR * Math.sqrt(clamp01(cell.ciLower));
        const rUpper = maxR * Math.sqrt(clamp01(cell.ciUpper));
        parts.push(
          `<line x1="${num(x)}" x2="${num(x)}" y1="${num(y - rUpper)}" y2="${num(y - rLower)}" stroke="${color}" stroke-width="1.2" />`,
        );
        parts.push(
          `<line x1="${num(x)}" x2="${num(x)}" y1="${num(y + rLower)}" y2="${num(y + rUpper)}" stroke="${color}" stroke-width="1.2" />`,
        );
      }
    });
  });

  return `<svg viewBox="0 0 ${o.viewBox.width} ${o.viewBox.height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

export interface ScatterPoint {
  x: number;
  y: number;
  label?: string;
  colorToken?: string;
}

export interface ScatterFit {
  fn: (x: number) => number;
  domain: [number, number];
  colorToken?: string;
  samples?: number;
}

export interface ScatterWithFitOptions {
  viewBox: ViewBox;
  margin: Margin;
  points: ScatterPoint[];
  xScale: Scale;
  yScale: Scale;
  xTicks: number[];
  yTicks: number[];
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
  /** A single fitted curve, sampled and drawn as one line. Deliberately no
   * CI-band option: turning a slope-only bootstrap CI into a shaded band
   * around the curve would need a joint (intercept, slope) covariance this
   * pipeline does not compute (see biogeography Fig 1 in the plan) -- draw
   * the CI as a separate annotation/whisker next to the curve instead. */
  fit?: ScatterFit;
}

/** A scatter plot with axes and, optionally, a single fitted curve. */
export function scatterWithFit(o: ScatterWithFitOptions): string {
  const plotTop = o.margin.top;
  const plotBottom = o.viewBox.height - o.margin.bottom;
  const plotLeft = o.margin.left;
  const plotRight = o.viewBox.width - o.margin.right;
  const parts: string[] = [];

  parts.push(
    axis({ orientation: "bottom", scale: o.xScale, ticks: o.xTicks, at: plotBottom, gridTo: plotTop, format: o.xFormat, label: o.xLabel, viewBox: o.viewBox }),
  );
  parts.push(
    axis({ orientation: "left", scale: o.yScale, ticks: o.yTicks, at: plotLeft, gridTo: plotRight, format: o.yFormat, label: o.yLabel, viewBox: o.viewBox }),
  );

  if (o.fit) {
    const n = o.fit.samples ?? 40;
    const [d0, d1] = o.fit.domain;
    const step = (d1 - d0) / Math.max(1, n - 1);
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = d0 + i * step;
      const px = o.xScale(x);
      const py = o.yScale(o.fit.fn(x));
      pts.push(`${num(px)},${num(py)}`);
    }
    parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="var(${o.fit.colorToken ?? "--accent"})" stroke-width="2" />`);
  }

  for (const p of o.points) {
    parts.push(`<circle cx="${num(o.xScale(p.x))}" cy="${num(o.yScale(p.y))}" r="3.5" fill="var(${p.colorToken ?? "--accent2"})" fill-opacity="0.85" />`);
  }

  return `<svg viewBox="0 0 ${o.viewBox.width} ${o.viewBox.height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

export interface LineSeriesLine {
  id: string;
  points: { x: number; y: number }[];
  colorToken?: string;
  /** Rendered as a small label at the line's last point. */
  label?: string;
}

export interface LineSeriesOverlay {
  x: number;
  y: number;
  /** Half-length of a vertical +-SD whisker in data units (mapped through
   * `yScale`), omitted when not given. */
  sd?: number;
  colorToken?: string;
}

export interface LineSeriesOptions {
  viewBox: ViewBox;
  margin: Margin;
  lines: LineSeriesLine[];
  xScale: Scale;
  yScale: Scale;
  xTicks: number[];
  yTicks: number[];
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
  /** Bold mean(+-SD) markers overlaid on top of the per-line series, e.g.
   * biogeography's `isolation.meanByRate`. */
  overlay?: LineSeriesOverlay[];
}

const LINE_COLOR_CYCLE = ["--accent", "--accent2", "--pass", "--fail"] as const;

/** Multiple lines (e.g. one per seed) over a shared, NUMERIC x-axis: x
 * position comes from `xScale(point.x)` directly, so unevenly-spaced x
 * values (a migration rate sweep, say) are spaced proportionally to their
 * actual value, never laid out as evenly-spaced categorical ticks. Lines
 * without an explicit `colorToken` cycle through a small fixed token
 * palette. */
export function lineSeries(o: LineSeriesOptions): string {
  const plotTop = o.margin.top;
  const plotBottom = o.viewBox.height - o.margin.bottom;
  const plotLeft = o.margin.left;
  const plotRight = o.viewBox.width - o.margin.right;
  const parts: string[] = [];

  parts.push(
    axis({ orientation: "bottom", scale: o.xScale, ticks: o.xTicks, at: plotBottom, gridTo: plotTop, format: o.xFormat, label: o.xLabel, viewBox: o.viewBox }),
  );
  parts.push(
    axis({ orientation: "left", scale: o.yScale, ticks: o.yTicks, at: plotLeft, gridTo: plotRight, format: o.yFormat, label: o.yLabel, viewBox: o.viewBox }),
  );

  o.lines.forEach((line, i) => {
    const color = `var(${line.colorToken ?? LINE_COLOR_CYCLE[i % LINE_COLOR_CYCLE.length]})`;
    const sorted = [...line.points].sort((a, b) => a.x - b.x);
    const pts = sorted.map((p) => `${num(o.xScale(p.x))},${num(o.yScale(p.y))}`).join(" ");
    parts.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity="0.85" />`);
    for (const p of sorted) {
      parts.push(`<circle cx="${num(o.xScale(p.x))}" cy="${num(o.yScale(p.y))}" r="2.5" fill="${color}" />`);
    }
  });

  for (const ov of o.overlay ?? []) {
    const color = `var(${ov.colorToken ?? "--ink"})`;
    const x = o.xScale(ov.x);
    const y = o.yScale(ov.y);
    if (ov.sd != null) {
      const yLo = o.yScale(ov.y - ov.sd);
      const yHi = o.yScale(ov.y + ov.sd);
      parts.push(`<line x1="${num(x)}" x2="${num(x)}" y1="${num(yLo)}" y2="${num(yHi)}" stroke="${color}" stroke-width="2" />`);
    }
    parts.push(`<circle cx="${num(x)}" cy="${num(y)}" r="5" fill="${color}" stroke="var(--panel)" stroke-width="1.5" />`);
  }

  return `<svg viewBox="0 0 ${o.viewBox.width} ${o.viewBox.height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

export interface SlopegraphPair {
  label: string;
  /** `null` when this side has no value (e.g. a collapsed branch) -- drawn
   * as an unavailable glyph on that side instead of a connecting line. */
  left: number | null;
  right: number | null;
  colorToken?: string;
}

export interface SlopegraphOptions {
  viewBox: ViewBox;
  margin: Margin;
  pairs: SlopegraphPair[];
  /** Shared value scale for both columns -- use `linearScale` (not
   * `logScale`) whenever the plotted quantity can be negative, e.g. an
   * anticipation index, so sign is preserved rather than folded/clipped. */
  yScale: Scale;
  yTicks: number[];
  yFormat?: (v: number) => string;
  leftLabel: string;
  rightLabel: string;
  referenceLines?: { value: number; label: string }[];
}

/** A two-column paired slopegraph: one line per pair connecting its left and
 * right values, preserving sign (a negative value is plotted below the
 * scale's zero point, never mirrored to a magnitude). A side with `null`
 * draws an unavailable glyph on that column instead of a point. */
export function slopegraph(o: SlopegraphOptions): string {
  const plotTop = o.margin.top;
  const plotBottom = o.viewBox.height - o.margin.bottom;
  const xLeft = o.margin.left + 24;
  const xRight = o.viewBox.width - o.margin.right - 24;
  const parts: string[] = [];

  parts.push(
    axis({ orientation: "left", scale: o.yScale, ticks: o.yTicks, at: xLeft, gridTo: xRight, format: o.yFormat, viewBox: o.viewBox }),
  );
  for (const rl of o.referenceLines ?? []) {
    parts.push(referenceLine("left", o.yScale(rl.value), xLeft, xRight, rl.label));
  }
  parts.push(`<text x="${num(xLeft)}" y="${num(plotTop - 10)}" text-anchor="middle" fill="var(--muted)" font-size="11">${escapeHtml(o.leftLabel)}</text>`);
  parts.push(`<text x="${num(xRight)}" y="${num(plotTop - 10)}" text-anchor="middle" fill="var(--muted)" font-size="11">${escapeHtml(o.rightLabel)}</text>`);

  const glyph = (x: number, y: number) =>
    `<rect x="${num(x - 4)}" y="${num(y - 4)}" width="8" height="8" transform="rotate(45 ${num(x)} ${num(y)})" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="2,2" />`;

  o.pairs.forEach((pair) => {
    const color = `var(${pair.colorToken ?? "--accent"})`;
    if (pair.left != null && pair.right != null) {
      const yL = o.yScale(pair.left);
      const yR = o.yScale(pair.right);
      parts.push(`<line x1="${num(xLeft)}" x2="${num(xRight)}" y1="${num(yL)}" y2="${num(yR)}" stroke="${color}" stroke-width="1.3" stroke-opacity="0.85" />`);
      parts.push(`<circle cx="${num(xLeft)}" cy="${num(yL)}" r="3" fill="${color}" />`);
      parts.push(`<circle cx="${num(xRight)}" cy="${num(yR)}" r="3" fill="${color}" />`);
    } else {
      if (pair.left != null) parts.push(`<circle cx="${num(xLeft)}" cy="${num(o.yScale(pair.left))}" r="3" fill="${color}" />`);
      else parts.push(glyph(xLeft, (plotTop + plotBottom) / 2));
      if (pair.right != null) parts.push(`<circle cx="${num(xRight)}" cy="${num(o.yScale(pair.right))}" r="3" fill="${color}" />`);
      else parts.push(glyph(xRight, (plotTop + plotBottom) / 2));
    }
  });

  return `<svg viewBox="0 0 ${o.viewBox.width} ${o.viewBox.height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}
