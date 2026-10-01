// Shared page shell for tools/report-html.ts's four track renderers
// (tools/lib/report-html/{nullcal,individuality,anticipation,biogeography}.ts).
// Everything here is a pure string-building function -- no Date/Math.random,
// no DOM -- so a renderer built entirely from these helpers is a deterministic
// function of its input data (tools/test/report-html/determinism.test.ts).
//
// Output is an HTML FRAGMENT meant to be published as a claude.ai Artifact:
// no <!doctype>/<html>/<head>/<body>, starting with <title> then <style>.
// This file owns
// the CSS custom-property tokens, the page shell, the header block (title,
// question, DATA STATUS chip, source path + SHA-256, one static per-status
// sentence, and a mechanical "Key numbers" definition list), and the
// figure/numbers-table helpers every track renderer composes with.
//
// Architectural rule: a
// renderer never writes a free-form sentence that interprets or characterizes
// the data -- no "the gate holds", "not enough time", "this shows autonomy".
// Every number a renderer wants to surface up top goes in the header's Key
// numbers <dl> (`keyNumbersList` below) as a {label, value} pair: the label is
// static text naming the exact statistic/scope, the value is read verbatim
// off the input (or "unavailable" when null/missing -- never a guessed
// cause). The only prose sentence tied to DATA STATUS is the single static
// one per status defined in `STATUS_SENTENCE` below, identical across every
// track. Captions/caveats still exist but are held to the same rule: a
// caption describes only what is plotted and how to read it, and a caveat
// states only a method fact true for any valid input (see each track's own
// header doc for its caveats' pointer to the relevant docs/*.md).

/** Escapes `&<>"'` for safe use in HTML text and attribute contexts. This is
 * the ONLY string-escaping helper in this module family -- every renderer
 * must route untrusted/data-derived text (labels, ids, paths, numbers
 * formatted as strings) through this before interpolating into markup. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type DataStatus = "REAL" | "PILOT" | "SMOKE";

export interface SourceRef {
  /** The input file path as given on the CLI (relative or absolute), shown
   * verbatim in the header -- never resolved to an absolute path, so the
   * page stays deterministic across machines/checkouts. */
  path: string;
  /** Lowercase hex SHA-256 of the file's raw bytes. */
  sha256: string;
}

/** Google Fonts stylesheet link. IBM Plex Sans Condensed (headings),
 * IBM Plex Serif (prose), IBM Plex Mono (numbers/tables/axis labels) -- the
 * three families the design contract specifies, one weight-set each. This is
 * the page's only external resource besides the fonts.googleapis.com host it
 * points at. */
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Serif:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap";

/**
 * CSS custom-property tokens. Light values live on the bare `:root` (a full
 * palette, not a partial one); dark values are redefined ONLY under the two
 * required dark blocks -- `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {...} }`
 * and `:root[data-theme="dark"] {...}` -- each setting `color-scheme: dark`.
 * A page-embedding host can force light via `data-theme="light"` on an
 * ancestor, or force dark via `data-theme="dark"`, without JS.
 *
 * Every token below is referenced by name (`var(--x)`) somewhere in this
 * module or in tools/lib/report-html/svg.ts; the page-contract test helper
 * (tools/test/report-html/contract.ts) asserts the reverse too -- every
 * `var(--x)` used inside an `<svg>` must have a matching `--x:` declaration
 * right here, in the bare `:root` block, so a renderer can never reference a
 * token that only exists in one theme.
 */
const LIGHT_TOKENS = `
  --ground: #F5F6F2;
  --panel: #FFFFFF;
  --ink: #1C2421;
  --muted: #5C6A64;
  --rule: #D9DED8;
  --accent: #A8661B;
  --accent2: #2F6690;
  --pass: #2E7D4F;
  --fail: #B3261E;
  --ci: rgba(168, 102, 27, 0.25);
`.trim();

const DARK_TOKENS = `
  --ground: #121715;
  --panel: #1A201D;
  --ink: #E2E8E4;
  --muted: #93A29B;
  --rule: #2E3833;
  --accent: #E0A04F;
  --accent2: #82B4DD;
  --pass: #6CC08E;
  --fail: #F08A80;
  --ci: rgba(224, 160, 79, 0.25);
`.trim();

/** The full `<style>` body: tokens (both themes), base layout, typography,
 * the DATA STATUS chip, and figure/table/caption styles. A single constant
 * shared by every track renderer, so the four report pages are visually one
 * system. */
const PAGE_STYLES = `
:root {
  ${LIGHT_TOKENS}
  color-scheme: light;

  --font-head: "IBM Plex Sans Condensed", "Arial Narrow", Arial, sans-serif;
  --font-body: "IBM Plex Serif", Georgia, "Times New Roman", serif;
  --font-mono: "IBM Plex Mono", "SF Mono", Consolas, "Liberation Mono", monospace;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    ${DARK_TOKENS}
    color-scheme: dark;
  }
}

:root[data-theme="dark"] {
  ${DARK_TOKENS}
  color-scheme: dark;
}

* { box-sizing: border-box; }

body {
  background: var(--ground);
  color: var(--ink);
  margin: 0;
}

.report-wrap {
  max-width: 960px;
  margin-inline: auto;
  padding-inline: 16px;
  padding-block: 24px 48px;
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.55;
}

.report-wrap h1, .report-wrap h2, .report-wrap h3 {
  font-family: var(--font-head);
  font-weight: 600;
  line-height: 1.2;
  color: var(--ink);
  margin: 1.6em 0 0.5em;
}

.report-wrap h1 { font-size: 1.9rem; margin-top: 0; }
.report-wrap h2 { font-size: 1.25rem; }

.report-wrap p, .report-wrap li {
  max-width: 65ch;
}

.report-wrap .prose-wide {
  max-width: 960px;
}

.report-wrap a { color: var(--accent2); }

.report-wrap .mono, .report-wrap code, .report-wrap table {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

/* --- header --- */

.report-header {
  border-bottom: 1px solid var(--rule);
  padding-bottom: 1.25em;
  margin-bottom: 1.5em;
}

.report-question {
  font-size: 1.05rem;
  color: var(--muted);
}

.status-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 0.6em;
  border: 1px solid var(--rule);
  border-radius: 999px;
  padding: 0.2em 0.9em;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  margin: 0.4em 0;
  background: var(--panel);
}

.status-chip-label {
  font-weight: 600;
  letter-spacing: 0.04em;
}

.status-chip-note {
  color: var(--muted);
  max-width: 52ch;
}

.status-real .status-chip-label { color: var(--pass); }
.status-real { border-color: var(--pass); }
.status-pilot .status-chip-label { color: var(--accent); }
.status-pilot { border-color: var(--accent); }
.status-smoke .status-chip-label { color: var(--accent2); }
.status-smoke { border-color: var(--accent2); }

.source-list {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--muted);
  margin: 0.75em 0;
  padding: 0;
  list-style: none;
}

.source-list li {
  max-width: 960px;
  overflow-wrap: anywhere;
}

.status-sentence {
  color: var(--muted);
  max-width: 65ch;
  margin: 0.6em 0;
}

.key-numbers {
  background: var(--panel);
  border: 1px solid var(--rule);
  border-radius: 8px;
  padding: 0.9em 1.1em;
  max-width: 960px;
  margin: 0.75em 0 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.6em 1.5em;
}

.key-number {
  display: flex;
  flex-direction: column;
  gap: 0.15em;
  margin: 0;
}

.key-number dt {
  font-size: 0.78rem;
  color: var(--muted);
}

.key-number dd {
  margin: 0;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  font-weight: 600;
}

/* --- figures --- */

.fig {
  margin: 2em 0;
  max-width: 960px;
}

.fig-media {
  border: 1px solid var(--rule);
  border-radius: 8px;
  background: var(--panel);
  padding: 8px;
  overflow-x: auto;
}

.fig-media svg {
  display: block;
  width: 100%;
  min-width: 540px;
  height: auto;
}

/* Scoped override for a figure that intentionally draws several narrower
   panels side by side (e.g. anticipation's Figure 1, one slopegraph per
   switch direction) instead of one full-width chart. Without this, the
   blanket 540px min-width above forces two side-by-side panels to demand
   more combined width than their flex row has, so each panel's svg
   overflows its own flex item and overlaps its neighbour instead of
   shrinking to fit. Higher specificity than .fig-media svg (two classes
   vs. one) so it wins regardless of source order. */
.fig-media .fig-multi-col {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.fig-media .fig-multi-col > div {
  flex: 1 1 260px;
  min-width: 220px;
}

.fig-media .fig-multi-col svg {
  min-width: 260px;
}

.fig figcaption {
  font-size: 0.9rem;
  color: var(--muted);
  margin-top: 0.6em;
  max-width: 65ch;
}

.fig figcaption strong { color: var(--ink); }

.table-wrap {
  overflow-x: auto;
  margin-top: 0.75em;
  max-width: 960px;
}

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.85rem;
}

th, td {
  text-align: right;
  padding: 0.3em 0.7em;
  border-bottom: 1px solid var(--rule);
  white-space: nowrap;
}

th:first-child, td:first-child {
  text-align: left;
  font-family: var(--font-body);
  font-variant-numeric: normal;
}

thead th {
  color: var(--muted);
  font-weight: 500;
  border-bottom: 1px solid var(--ink);
}

.caveats {
  margin-top: 2.5em;
  padding-top: 1em;
  border-top: 1px solid var(--rule);
  font-size: 0.92rem;
  color: var(--muted);
}

.caveats p { max-width: 65ch; }

/* --- evidence chips (tools/lib/report-html/lineage.ts): the word carries the
   meaning, the colour only repeats it --- */

.evidence {
  display: inline-block;
  border: 1px solid var(--rule);
  border-radius: 999px;
  padding: 0 0.55em;
  margin-left: 0.4em;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.03em;
  line-height: 1.5;
  vertical-align: 0.15em;
  white-space: nowrap;
}

.evidence-exact { color: var(--pass); border-color: var(--pass); }
.evidence-inferred { color: var(--accent); border-color: var(--accent); }
.evidence-context { color: var(--accent2); border-color: var(--accent2); }
.evidence-missing { color: var(--muted); border-style: dashed; }

@media (max-width: 420px) {
  .report-wrap { padding-inline: 16px; }
  .status-chip { flex-wrap: wrap; }
}
`.trim();

/** One static sentence per DATA STATUS, identical across every track --
 * mechanical fact about what the status itself means, never a data-derived
 * evaluative claim (no "not enough time", no "not meaningful"). REAL gets no
 * sentence: a REAL run's numbers speak via the Key numbers list below, not a
 * blanket qualifier. */
const STATUS_SENTENCE: Record<DataStatus, string> = {
  PILOT:
    "Pilot data: a pipeline check run before the full experiment; no conclusion is drawn here.",
  SMOKE: "Smoke-test data: a pipeline check run before the full experiment; no conclusion is drawn here.",
  REAL: "",
};

export interface HeaderOptions {
  /** 2-4 word track name, e.g. "Null Gate Calibration" -- also used as the
   * page's `<title>`. */
  title: string;
  /** One plain sentence: the question this page answers. */
  question: string;
  status: DataStatus;
  /** Plain-language, purely mechanical statement of what the data actually
   * is, e.g. "3 seeds" or "32 replicates x 2 null generators x 2 windows" --
   * facts and counts only, never an evaluative word ("not a result", "not
   * meaningful"): that judgment is `STATUS_SENTENCE`'s job, not this note's. */
  statusNote: string;
  sources: SourceRef[];
  /** Pre-built "Key numbers" `<dl>` HTML -- see `keyNumbersList`. Replaces
   * any free-form finding/interpretation paragraph: every number a renderer
   * wants to surface here is a {label, value} pair, the label static text
   * naming the exact statistic/scope, the value read verbatim off the input. */
  keyNumbers: string;
}

/** Renders the compact header: track name, one-sentence question, DATA
 * STATUS chip, one source line per input file (path + SHA-256), the single
 * static per-status sentence (empty for REAL), and the Key numbers list. No
 * hero, no interpretive prose. */
export function header(o: HeaderOptions): string {
  const sourceItems = o.sources
    .map((s) => `<li>${escapeHtml(s.path)} &mdash; sha256:${escapeHtml(s.sha256)}</li>`)
    .join("\n");
  const statusSentence = STATUS_SENTENCE[o.status];
  return `<header class="report-header">
  <h1>${escapeHtml(o.title)}</h1>
  <p class="report-question">${escapeHtml(o.question)}</p>
  ${statusChip(o.status, o.statusNote)}
  <ul class="source-list">
${sourceItems}
  </ul>
  ${statusSentence ? `<p class="status-sentence">${escapeHtml(statusSentence)}</p>` : ""}
  ${o.keyNumbers}
</header>`;
}

/** How a number is known (docs/lineage-inspector.md, section 3): logged or
 * reconstructed and checked, attributed by the tracker, realized and
 * environment-dependent, or absent from the data. */
export type Evidence = "exact" | "inferred" | "context" | "not recorded";

/** A small chip naming an `Evidence` class. The word is always printed, so
 * colour never carries the class alone. */
export function evidenceChip(e: Evidence): string {
  const cls = e === "not recorded" ? "missing" : e;
  return `<span class="evidence evidence-${cls}">${escapeHtml(e)}</span>`;
}

export interface KeyNumberItem {
  /** Static text naming the exact statistic, its scope (profile, window,
   * condition, family, ...), and what it is -- never a data value itself. */
  label: string;
  /** The value read verbatim off the input, already formatted as a string by
   * the caller (fixed decimals, a "k/n" pair, a joined list, ...) --
   * "unavailable" when the underlying value is null/missing, with no guessed
   * cause attached. */
  value: string;
  /** When given, an evidence chip follows the value. */
  evidence?: Evidence;
}

/** Renders a mechanical "Key numbers" definition list: one {label, value}
 * pair per item, both escaped here. This is the ONLY place a renderer states
 * a number in the header -- no surrounding sentence, no interpretation. */
export function keyNumbersList(items: KeyNumberItem[]): string {
  const entries = items
    .map(
      (it) =>
        `<div class="key-number"><dt>${escapeHtml(it.label)}</dt><dd>${escapeHtml(it.value)}${it.evidence ? evidenceChip(it.evidence) : ""}</dd></div>`,
    )
    .join("\n");
  return `<dl class="key-numbers">\n${entries}\n</dl>`;
}

/** The DATA STATUS chip alone (also used by `header`). Colour is semantic
 * and fixed per status: REAL uses `--pass` (trustworthy, calibrated data),
 * PILOT uses `--accent` (a deliberately underpowered check, not yet a
 * finding), SMOKE uses `--accent2` (a pipeline/plumbing check, not yet
 * ecologically meaningful) -- three distinct tokens, none of them `--fail`,
 * which stays reserved for an actual failing value inside a figure. */
export function statusChip(status: DataStatus, note: string): string {
  const cls = `status-${status.toLowerCase()}`;
  return `<span class="status-chip ${cls}"><span class="status-chip-label">${escapeHtml(status)}</span><span class="status-chip-note">${escapeHtml(note)}</span></span>`;
}

/** Wraps a rendered SVG chart (and an optional numbers table) in a numbered
 * `<figure>`. `caption` is plain text describing what is plotted, the n, and
 * how to read it -- escaped, not raw HTML, so a renderer never has to worry
 * about a data-derived label breaking the caption markup. */
export function figure(n: number, svg: string, caption: string, tableHtml?: string): string {
  return `<figure class="fig">
  <div class="fig-media">
${svg}
  </div>
  <figcaption><strong>Figure ${n}.</strong> ${escapeHtml(caption)}</figcaption>
  ${tableHtml ? `<div class="table-wrap">\n${tableHtml}\n  </div>` : ""}
</figure>`;
}

/** A compact numbers table: the exact values shown in the figure above it.
 * `rows` cells are pre-formatted strings (a renderer formats its own numbers
 * -- fixed decimals, "unavailable", "n/a", etc. -- before calling this) and
 * are escaped here. The first column is left-aligned (row labels); the rest
 * are right-aligned tabular numerals via the `table`/`th`/`td` CSS above. */
export function numbersTable(headers: string[], rows: (string | number)[][]): string {
  const thead = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

/** Renders one plain paragraph of caveat text inside the caveats section
 * (see `caveatsSection`). Kept separate so a renderer can build a caveats
 * section from several short paragraphs instead of one long one. */
export function caveatParagraph(text: string): string {
  return `<p>${escapeHtml(text)}</p>`;
}

/** Wraps one or more caveat paragraphs (already-built HTML, e.g. from
 * `caveatParagraph`) in the page's caveats section, placed after the last
 * figure. */
export function caveatsSection(heading: string, paragraphsHtml: string[]): string {
  return `<section class="caveats">
  <h2>${escapeHtml(heading)}</h2>
${paragraphsHtml.join("\n")}
</section>`;
}

export interface PageOptions {
  /** 2-4 word track name, no dash/colon explainer. Becomes `<title>`. */
  title: string;
  /** Everything after the `<style>`/font `<link>`: header + figures +
   * caveats, already assembled HTML. */
  bodyHtml: string;
}

/** The page shell: `<title>`, then `<style>` (tokens + base CSS), then the
 * Google Fonts `<link>`, then a single wrapper `div.report-wrap` with
 * `padding-inline` holding `bodyHtml`. No `<!doctype>`/`<html>`/`<head>`/
 * `<body>` -- this is a fragment, not a document, meant to be published as a
 * claude.ai Artifact. */
export function pageShell(o: PageOptions): string {
  return `<title>${escapeHtml(o.title)}</title>
<style>
${PAGE_STYLES}
</style>
<link rel="stylesheet" href="${FONTS_HREF}">
<div class="report-wrap">
${o.bodyHtml}
</div>`;
}
