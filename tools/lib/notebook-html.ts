// The field notebook's page (docs/naturalist-bell-v0-2026-10-17.md, "The field notebook, v0"): renderNotebook(model) is a pure
// function of a NotebookModel (tools/lib/notebook.ts) to one self-contained HTML document. No Date, no randomness, no script, no
// external file: the site's colour tokens are copied from apps/lab/src/tokens.css (a test holds them equal), light by default and
// dark under prefers-color-scheme (and under data-theme="dark", as the site sets it). Fonts are Rubik when installed, else the
// system stack; there is no @font-face because /fonts/ does not exist beside a file opened on its own. Pictures are inline SVG
// coloured by CSS classes. Chips use the site's .state classes and DESIGN.md's words; this page uses only Measured, Negative,
// Unclear and Not yet measured.
import { escapeHtml } from "./report-html/page.ts";
import { RATE_LAG, SIGNALS } from "./bell.ts";
import { BIN, fmtValue, fmtZ, group, textOf, type Chip, type NotebookModel, type PictureBin, type RingNote, type Stretch } from "./notebook.ts";

const e = (s: string | number) => escapeHtml(String(s));

/** Copied from apps/lab/src/tokens.css (:root and :root[data-theme="dark"]); tools/test/notebook-html.test.ts holds them equal. */
export const LIGHT_TOKENS: Readonly<Record<string, string>> = {
  "--bg": "oklch(94.5% 0.012 88)",
  "--surface": "oklch(98.5% 0.007 88)",
  "--raised": "oklch(91.5% 0.014 88)",
  "--line": "oklch(83% 0.016 88)",
  "--line-soft": "oklch(90% 0.012 88)",
  "--text": "oklch(23% 0.022 80)",
  "--muted": "oklch(45% 0.022 80)",
  "--soft": "oklch(51% 0.022 80)",
  "--sun": "oklch(87% 0.165 93)",
  "--sun-soft": "oklch(94% 0.08 95)",
  "--sun-ink": "oklch(49% 0.125 72)",
  "--error": "oklch(51% 0.18 28)",
  "--error-fill": "oklch(92% 0.05 28)",
  "--sans": `"Rubik", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`,
  "--mono": `ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
  "--radius": "8px",
  "--radius-lg": "14px",
};
export const DARK_TOKENS: Readonly<Record<string, string>> = {
  "--bg": "oklch(17% 0.012 80)",
  "--surface": "oklch(20.5% 0.013 80)",
  "--raised": "oklch(26% 0.016 80)",
  "--line": "oklch(35% 0.016 80)",
  "--line-soft": "oklch(28% 0.014 80)",
  "--text": "oklch(94% 0.012 85)",
  "--muted": "oklch(71% 0.016 85)",
  "--soft": "oklch(64% 0.016 85)",
  "--sun": "oklch(85% 0.16 92)",
  "--sun-soft": "oklch(36% 0.06 85)",
  "--sun-ink": "oklch(82% 0.14 88)",
  "--error": "oklch(76% 0.14 28)",
  "--error-fill": "oklch(30% 0.07 28)",
};
const decl = (t: Readonly<Record<string, string>>) => Object.entries(t).map(([k, v]) => `${k}: ${v};`).join(" ");

const CSS = `
:root { color-scheme: light; ${decl(LIGHT_TOKENS)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; ${decl(DARK_TOKENS)} } }
:root[data-theme="dark"] { color-scheme: dark; ${decl(DARK_TOKENS)} }
* { box-sizing: border-box; }
html, body { margin: 0; min-width: 320px; }
body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 17px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
main { max-width: 60rem; margin: 0 auto; padding: 40px 16px 72px; }
p, li { max-width: 66ch; }
a { color: var(--text); text-decoration-color: var(--sun-ink); text-decoration-thickness: 2px; text-underline-offset: 3px; }
.eyebrow, .state, .aside-label { color: var(--sun-ink); font-size: .75rem; font-weight: 700; line-height: 1.4; letter-spacing: .08em; text-transform: uppercase; }
.eyebrow { margin: 0 0 12px; }
h1, h2, h3, h4 { font-weight: 800; letter-spacing: -.03em; text-wrap: balance; }
h1 { margin: 0; font-size: clamp(1.9rem, 5vw, 3.1rem); line-height: 1.05; overflow-wrap: anywhere; }
h2 { margin: 56px 0 14px; font-size: clamp(1.45rem, 3vw, 1.95rem); line-height: 1.12; }
h3 { margin: 32px 0 10px; font-size: 1.25rem; letter-spacing: -.02em; }
h4 { margin: 0 0 6px; font-size: 1.0625rem; letter-spacing: -.01em; }
.lede { margin: 18px 0 0; color: var(--muted); font-size: clamp(1.0625rem, 1.6vw, 1.25rem); line-height: 1.5; }
.fine { color: var(--muted); font-size: .875rem; }
.mono { font-family: var(--mono); font-size: .875rem; overflow-wrap: anywhere; }
.card { background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--radius-lg); padding: 20px; margin: 16px 0; }
.state { display: inline-flex; align-items: center; min-height: 26px; padding: 2px 10px; border-radius: 99px; background: var(--sun-soft); color: var(--sun-ink); white-space: nowrap; }
.state.measured { background: var(--sun-soft); color: var(--sun-ink); }
.state.pending { background: var(--raised); color: var(--muted); }
.state.negative { background: var(--error-fill); color: var(--error); }
.chips { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0 0 10px; }
.chip-pair { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.card > h4 { margin: 24px 0 8px; }
.card > .chips + h4 { margin-top: 4px; }
.claims { list-style: none; margin: 20px 0 0; padding: 0; display: grid; gap: 12px; }
.claims li { display: grid; grid-template-columns: 11.5rem 1fr; gap: 12px; align-items: start; max-width: none; }
.claims li .state { justify-self: start; }
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 0; }
dl.facts dt { color: var(--muted); }
dl.facts dd { margin: 0; overflow-wrap: anywhere; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: .9375rem; }
th, td { text-align: left; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.timeline { display: grid; gap: 4px; margin: 12px 0 0; }
.tl-row { display: grid; grid-template-columns: 12.5rem 1fr; gap: 12px; align-items: center; }
.tl-label { font-size: .875rem; }
.tl-row svg { height: 24px; }
.tl-label .side { color: var(--sun-ink); font-weight: 700; }
.tl-axis { display: flex; justify-content: space-between; color: var(--muted); font-size: .8125rem; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 10px 0 0; color: var(--muted); font-size: .875rem; }
.key { display: inline-block; width: 14px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: 6px; }
.key.bar { background: var(--sun); border: 1px solid var(--sun-ink); }
.key.burn { background: var(--raised); border: 1px solid var(--line); }
.key.band { background: var(--raised); border: 1px solid var(--line); }
.key.hist { background: var(--text); height: 3px; vertical-align: 3px; }
.key.span { background: var(--sun); opacity: .6; }
figure { margin: 14px 0; }
figcaption { color: var(--muted); font-size: .875rem; margin-top: 6px; }
svg { display: block; width: 100%; height: auto; }
svg .bg { fill: var(--surface); stroke: var(--line); stroke-width: 1; }
svg .burn { fill: var(--raised); }
svg .mid { stroke: var(--line-soft); stroke-width: 1; }
svg .bar { fill: var(--sun); stroke: var(--sun-ink); stroke-width: 1; }
svg .span { fill: var(--sun); fill-opacity: .45; }
svg .band { fill: var(--raised); stroke: var(--line); stroke-width: 1; }
svg .med { fill: none; stroke: var(--muted); stroke-width: 1.2; stroke-dasharray: 4 3; }
svg .hist { fill: none; stroke: var(--text); stroke-width: 1.6; stroke-linecap: square; }
svg .bg, svg .band, svg .med, svg .hist, svg .mid, svg .bar { vector-effect: non-scaling-stroke; }
.pic svg { height: 220px; }
details { margin: 10px 0; }
summary { cursor: pointer; color: var(--muted); }
ul.plain { padding-left: 1.2em; }
ul.plain li { margin: 6px 0; }
@media (max-width: 640px) {
  .claims li, .tl-row { grid-template-columns: 1fr; gap: 4px; }
  .pic svg { height: 170px; }
  dl.facts { grid-template-columns: 1fr; gap: 0; }
  dl.facts dd { margin: 0 0 8px; }
}
`;

const CHIP_CLASS: Record<Chip, string> = { Measured: "measured", Negative: "negative", Unclear: "pending", "Not yet measured": "pending" };
export const chip = (c: Chip) => `<span class="state ${CHIP_CLASS[c]}">${e(c)}</span>`;
/** An SVG coordinate; a non-finite one stops the page (renderNotebook runs before anything is written). */
const n1 = (v: number) => {
  if (!Number.isFinite(v)) throw new Error(`STOP: a picture coordinate came out ${v}; the page is not drawn from values out of range`);
  return (Math.round(v * 10) / 10).toFixed(1);
};
const raw = (v: number) => e(String(v));

const VW = 720;

/** The 13-row timeline: burn-in shaded, each ring's stretches as bars, high in the top half and low in the bottom half. */
function timeline(m: NotebookModel): string {
  const n = m.run.censuses;
  const burn = m.run.burnInStep / m.run.censusEvery - 1; // census index of the first counted census
  const H = 24;
  const xOf = (i: number) => (i / n) * VW;
  const rows = m.timeline.map((row) => {
    const sides = [...new Set(row.stretches.map((s) => s.side))];
    const bars = row.stretches.map((s) => {
      const x = xOf(s.startIdx), w = Math.max(1.5, xOf(s.endIdx + 1) - x);
      const y = s.side === "high" ? 2 : 13;
      return `<rect class="bar" x="${n1(x)}" y="${y}" width="${n1(w)}" height="9"/>`;
    });
    const label = `${e(row.label)}${sides.length ? ` <span class="side">${sides.map((s) => e(s)).join(", ")}</span>` : ""}`;
    const aria = row.stretches.length ? `${row.label}: ${row.stretches.map((s) => `${s.side} from step ${group(s.startStep)} to ${group(s.endStep)}`).join("; ")}` : `${row.label}: no stretch above Z*`;
    return `<div class="tl-row"><div class="tl-label">${label}</div><svg viewBox="0 0 ${VW} ${H}" preserveAspectRatio="none" role="img" aria-label="${e(aria)}"><rect class="bg" x="0.5" y="0.5" width="${VW - 1}" height="${H - 1}"/><rect class="burn" x="1" y="1" width="${n1(Math.max(0, xOf(burn) - 1))}" height="${H - 2}"/><line class="mid" x1="0" y1="12" x2="${VW}" y2="12"/>${bars.join("")}</svg></div>`;
  });
  return `<div class="timeline">${rows.join("\n")}<div class="tl-row"><div></div><div class="tl-axis"><span>step 0</span><span>step ${group(m.run.steps)}</span></div></div></div>
<div class="legend"><span><span class="key bar"></span>a stretch above Z* (top half: high side; bottom half: low side)</span><span><span class="key burn"></span>before step ${group(m.run.burnInStep)}: not counted</span></div>`;
}

/** A note's picture: per column of BIN censuses the run's lowest to highest value, the envelope median, and the Z* band. */
function picture(m: NotebookModel, note: RingNote): string {
  const bins = note.picture;
  const n = m.run.censuses;
  const H = 180, top = 6, bot = H - 6;
  let lo = 0, hi = -Infinity;
  for (const b of bins) {
    lo = Math.min(lo, b.lo);
    hi = Math.max(hi, b.hi, b.bandHi, b.median);
  }
  if (!(hi > lo)) hi = lo < 0 ? 0 : 1; // all one value (lo <= 0 always, since the scale starts at 0)
  // Halved before subtracting, so values near ±1.8e308 do not overflow the span (the ratio is the same).
  const yOf = (v: number) => bot - ((Math.min(hi, Math.max(lo, v)) / 2 - lo / 2) / (hi / 2 - lo / 2)) * (bot - top);
  const xOf = (i: number) => (i / n) * VW;
  const xc = (b: PictureBin) => xOf((b.from + b.to + 1) / 2);
  const burn = m.run.burnInStep / m.run.censusEvery - 1;
  const spans = note.stretches.map((s: Stretch) => `<rect class="span" x="${n1(xOf(s.startIdx))}" y="${top}" width="${n1(Math.max(1.5, xOf(s.endIdx + 1) - xOf(s.startIdx)))}" height="${bot - top}"/>`).join("");
  const band = bins.length
    ? `<path class="band" d="M${bins.map((b) => `${n1(xc(b))} ${n1(yOf(b.bandHi))}`).join("L")}L${[...bins].reverse().map((b) => `${n1(xc(b))} ${n1(yOf(b.bandLo))}`).join("L")}Z"/>`
    : "";
  const med = bins.length ? `<path class="med" d="M${bins.map((b) => `${n1(xc(b))} ${n1(yOf(b.median))}`).join("L")}"/>` : "";
  const hist = bins.length ? `<path class="hist" d="${bins.map((b) => `M${n1(xc(b))} ${n1(yOf(b.hi))}V${n1(yOf(b.lo))}`).join("")}"/>` : "";
  const name = note.signal;
  const aria = `${note.label} across the run against the neutral median and the Z* band; shaded where it stayed ${note.side === "high" ? "above" : "below"} the band.`;
  return `<figure class="pic"><svg viewBox="0 0 ${VW} ${H}" preserveAspectRatio="none" role="img" aria-label="${e(aria)}"><rect class="bg" x="0.5" y="0.5" width="${VW - 1}" height="${H - 1}"/><rect class="burn" x="1" y="1" width="${n1(Math.max(0, xOf(burn) - 1))}" height="${H - 2}"/>${band}${spans}${med}${hist}</svg>
<figcaption>Scale ${e(fmtValue(name, lo))} to ${e(fmtValue(name, hi))}, step 0 to step ${group(m.run.steps)}. Each column is ${BIN} censuses: the line runs from the run’s lowest to its highest value in it, so no census is hidden. Dashed: the neutral median; grey band: the median ± Z* spreads, both at the column’s last census. Pictures are drawn, not read: nothing on this page is computed from them.</figcaption>
<div class="legend"><span><span class="key hist"></span>this run</span><span><span class="key band"></span>median ± Z* spreads</span><span><span class="key span"></span>a stretch above Z*</span><span><span class="key burn"></span>not counted</span></div></figure>`;
}

function stretchTable(note: RingNote): string {
  const rows = note.stretches.map((s) => `<tr><td class="num">${group(s.startStep)}</td><td class="num">${group(s.endStep)}</td><td class="num">${group(s.censuses)}</td><td class="num">${fmtZ(s.minAbsZ)}</td><td class="num">${fmtZ(s.maxAbsZ)}</td><td>${s.ongoing ? "yes, at the last census" : "no"}</td></tr>`);
  return `<div class="scroll"><table><thead><tr><th class="num">From step</th><th class="num">To step</th><th class="num">Censuses</th><th class="num">Weakest |z|</th><th class="num">Strongest |z|</th><th>Still going</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function noteCard(m: NotebookModel, note: RingNote): string {
  const r = note.receipt;
  const t = textOf(note.signal);
  return `<article class="card">
<div class="chips"><span class="chip-pair">${chip("Measured")}<span class="fine">the numbers</span></span><span class="chip-pair">${chip("Unclear")}<span class="fine">what it means</span></span></div>
<h4>${e(note.label)}, ${e(note.side)} side</h4>
<p>${e(note.sentence)}</p>
<p class="fine">${e(t.meaning)} Computed in <span class="mono">${e(t.source)}</span>.</p>
${picture(m, note)}
<h4>Stretches above Z*</h4>
<p class="fine">Every unbroken run of at least ${m.run.W} counted censuses strictly more than Z* = ${fmtZ(m.run.zStar)} spreads ${note.side === "high" ? "above" : "below"} the median. Drawn, not scored; nothing else is read from them.</p>
${stretchTable(note)}
<h4>Receipt</h4>
<dl class="facts">
<dt>First window</dt><dd>step ${group(r.startStep)} to step ${group(r.endStep)} (${m.run.W} censuses)</dd>
<dt>Smallest |z| in that window</dt><dd class="mono">${raw(r.minAbsZ)}</dd>
<dt>Value at its first census</dt><dd class="mono">${raw(r.value)}</dd>
<dt>Neutral median there</dt><dd class="mono">${raw(r.median)}</dd>
<dt>Spread there</dt><dd class="mono">${raw(note.spread)}</dd>
<dt>D on this signal and side</dt><dd class="mono">${raw(note.D)}</dd>
<dt>Bell threshold</dt><dd class="mono">Z = ${raw(r.Z)} (the smallest double above Z* = ${raw(m.run.zStar)})</dd>
</dl>
<p class="fine">What it means: <b>Unclear</b>. The notebook gives no cause, mechanism or importance.</p>
</article>`;
}

/** "a, b and c". */
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The bell corpus's arms at the primary Z, W, from the record: the readout's finding, said of the corpus and not of this run. */
function armsSentence(m: NotebookModel): string {
  const fa = m.firstPage.falseAlarms, a = m.firstPage.armsFromBurnIn;
  return `In the bell’s readout, at Z = ${fa.Z} and W = ${fa.W}, ${a.k} of the ${a.of} treatment and no-mutation runs of the bell corpus rang from step ${group(m.run.burnInStep)}, the first census counted: those arms stand apart from the neutral runs from the start, which the Milestone 4 runs already showed.`;
}

/** The seven statements of the note's "What this cannot tell you", with the record's numbers. */
export function cannotTell(m: NotebookModel): string[] {
  const h = m.firstPage.heldOut, fa = m.firstPage.falseAlarms;
  const sigs = m.firstPage.falseAlarmSignals.map((f) => `${f.label.toLowerCase()}, ${f.side} side (${f.runs} ${f.runs === 1 ? "run" : "runs"})`);
  return [
    "It compares this world with the neutral runs of its preset, not with a twin of itself: a note says “unlike the neutral runs”, not “something changed here”. The twin bell does not exist yet.",
    `${armsSentence(m)} So a note on a treatment or no-mutation world says its arm differs from the neutral runs, not that something arose in it.`,
    `Z* is the largest of ${m.firstPage.calibRuns} calibration scores: one order statistic, with its own noise. Held out, ${h.k} of ${h.of} neutral runs scored above it; a run can be noted on neutral dynamics alone.`,
    `At Z = ${fa.Z}, W = ${fa.W} the ${fa.k} neutral runs that rang did so on ${listOf(sigs)}; a run can ring on more than one. The readout reads deepest generation and the largest lineage’s share as heavy upper tails under drift.`,
    "A signal noted once is not shown to be noted again: each note gives its stretches, not a forecast.",
    "Nothing is said about cause, mechanism or importance, and nothing about how the 13 signals relate to each other beyond “first stretches from the same census”.",
    `The page is only as complete as the 13 signals: a departure of any other kind is invisible to it, and so is anything before step ${group(m.run.burnInStep)}.`,
  ];
}

export function renderNotebook(m: NotebookModel): string {
  const r = m.run;
  const fa = m.firstPage.falseAlarms, h = m.firstPage.heldOut;
  const zs = Object.entries(m.firstPage.zStars).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, z]) => `${e(p)} ${fmtZ(z)}`).join(", ");
  const status: string[] = [];
  if (r.falseAlarm === "held-out")
    status.push(`This is one of the bell’s ${h.of} held-out neutral runs, so every note below is a false alarm of the bell by definition: it is one of the ${h.k} of ${h.of} held-out neutral runs that scored above Z*.`);
  if (r.falseAlarm === "neutral") status.push("This is a neutral run, so every note below is the bell ringing on neutral dynamics alone; it is not one of the held-out runs the thresholds were judged on.");
  if (r.calibration) status.push(`This run is one of the ${e(m.firstPage.calibRuns)} calibration runs that fixed Z* for ${e(r.preset)}, so it cannot ring here by construction.`);
  if (!r.inCorpus) status.push(`This run is not part of the bell corpus; it is scored against all ${r.envelopeSize} envelope runs.`);
  const first = `<section class="first">
<p class="eyebrow">Field notebook · v${m.notebookVersion} · generated ${e(m.meta.generated)}</p>
<h1>${e(r.id)}</h1>
<p class="lede">Field notes from the anomaly bell for one run: where it stood outside the neutral runs of its world, for how long, and the numbers behind each note. Code wrote every sentence from fixed templates; no model was asked.</p>
<ul class="claims">
<li>${chip("Negative")}<span>At Z = ${e(fa.Z)}, W = ${e(fa.W)} the bell rings on drift: ${e(fa.k)} of ${e(fa.n)} neutral runs rang there.</span></li>
<li>${chip("Measured")}<span>Thresholds calibrated per world on ${e(m.firstPage.calibRuns)} neutral runs each held out of sample: ${e(h.k)} of ${e(h.of)} held-out neutral runs scored above them, about ${e(h.expected.toFixed(1))} expected (Z*: ${zs}).</span></li>
<li>${chip("Not yet measured")}<span>That the bell hears something arise inside a single run.</span></li>
</ul>
<p>This notebook rings only at the calibrated threshold: a signal is noted only when, for ${r.W} censuses in a row from step ${group(r.burnInStep)} on, it stays strictly more than Z* = ${fmtZ(r.zStar)} spreads from the neutral median.</p>
<p>The bell measures where a world stands against the neutral runs of its preset, not when something starts inside one. ${e(armsSentence(m))} A note on a treatment or no-mutation world therefore says its arm is a different world. The step a note is filed under is where its first stretch beyond Z* begins, counted from step ${group(r.burnInStep)}; it is not when anything started.</p>
${status.map((s) => `<p><b>${s}</b></p>`).join("")}
</section>`;

  const run = `<section><h2>The run</h2><div class="card"><dl class="facts">
<dt>Run</dt><dd class="mono">${e(r.id)}</dd>
<dt>Experiment</dt><dd>${e(r.experiment)}</dd>
<dt>World</dt><dd>${e(r.preset)}</dd>
<dt>Condition</dt><dd>${e(r.condition)}</dd>
<dt>Seed</dt><dd>${e(r.seed)}</dd>
<dt>Steps</dt><dd>${group(r.steps)}, a census every ${group(r.censusEvery)} (${group(r.censuses)} censuses)</dd>
<dt>presetIdentity</dt><dd class="mono">${e(r.presetIdentity)}</dd>
<dt>Z* (W = ${r.W})</dt><dd>${fmtZ(r.zStar)} <span class="mono fine">${raw(r.zStar)}</span></dd>
<dt>Envelope</dt><dd>the ${r.envelopeIds.length} neutral runs of ${e(r.preset)} in the bell corpus; ${r.leftOut ? `this run is one of them, so it was scored against the other ${r.envelopeSize}` : "this run is not one of them"}</dd>
<dt>D at W = ${r.W}</dt><dd>${fmtZ(r.D)} <span class="mono fine">${raw(r.D)}</span></dd>
<dt>Rings</dt><dd>${m.rings}</dd>
</dl>${status.map((s) => `<p>${s}</p>`).join("")}</div></section>`;

  const tl = `<section><h2>Across the run</h2><p class="fine">Each row is one of the 13 signals. A bar is a stretch of a ring: at least ${r.W} counted censuses in a row strictly beyond Z*.</p>${timeline(m)}</section>`;

  let notes: string;
  if (!m.entries.length) {
    notes = `<section><h2>Notes</h2><div class="card">
<ul class="claims"><li>${chip("Measured")}<span>The bell did not ring on this run at Z* = ${fmtZ(r.zStar)}: no signal stayed beyond it for ${r.W} counted censuses in a row. Its D values are below.</span></li>
<li>${chip("Not yet measured")}<span>That nothing is going on in this run. No part of the bell tests that.</span></li></ul></div></section>`;
  } else {
    notes = `<section><h2>Notes</h2><p class="fine">One note per ring, filed under the step its first stretch beyond Z* begins: the first census of ${r.W} in a row beyond Z*, counted from step ${group(r.burnInStep)}. That step is not an onset; it depends on Z* and on the burn-in. Signals filed together had their first stretches begin at the same census; that is not to say one caused another.</p>${m.entries
      .map((en) => `<h3>${en.notes.length > 1 ? `First stretches from step ${group(en.startStep)}` : `First stretch from step ${group(en.startStep)}`}</h3>${en.notes.map((nt) => noteCard(m, nt)).join("\n")}`)
      .join("\n")}</section>`;
  }

  const quietRows = m.quiet.map((q) => `<tr><td>${e(q.label)}</td><td>${e(q.side)}</td><td class="num">${fmtZ(q.D)}</td><td class="num">${fmtZ(q.gap)}</td><td>${q.rang ? "rang" : "quiet"}</td></tr>`);
  const quiet = `<section><h2>Every signal against Z*</h2><div class="chips">${chip("Measured")}</div><p class="fine">D at W = ${r.W} for every signal and side: the largest, over counted ${r.W}-census windows, of the window’s smallest |z| on that side. Nothing below Z* = ${fmtZ(r.zStar)} is narrated; Z* − D says how close each quiet one came.</p>
<div class="scroll"><table><thead><tr><th>Signal</th><th>Side</th><th class="num">D</th><th class="num">Z* − D</th><th></th></tr></thead><tbody>${quietRows.join("")}</tbody></table></div></section>`;

  const cannot = `<section><h2>What this cannot tell you</h2><ul class="plain">${cannotTell(m).map((s) => `<li>${e(s)}</li>`).join("")}</ul></section>`;

  const meanings = SIGNALS.map((d) => {
    const t = textOf(d.name);
    return `<tr><td>${e(t.label)}</td><td>${e(t.meaning)}${d.kind === "rate" ? ` Counted as the increase over the last ${RATE_LAG} censuses.` : ""}</td><td class="mono">${e(t.source)}</td></tr>`;
  });
  const receipts = `<section><h2>Receipts</h2><div class="card"><dl class="facts">
<dt>Bell record</dt><dd class="mono">${e(m.meta.recordPath)}</dd>
<dt>Its SHA-256</dt><dd class="mono">${e(m.meta.recordSha256)}</dd>
<dt>Rules</dt><dd class="mono">${e(m.notePath)}</dd>
<dt>Versions</dt><dd>bell ${m.bellVersion}, notebook ${m.notebookVersion}</dd>
<dt>Leave-one-out</dt><dd>${r.leftOut ? "yes" : "no"}</dd>
<dt>Record D</dt><dd>${r.recordD === null ? "not a corpus run, nothing to match" : `matches: <span class="mono">${raw(r.recordD)}</span>`}</dd>
<dt>Base directory</dt><dd class="mono">${e(m.meta.base)}</dd>
<dt>Files read for this run</dt><dd>${m.meta.sources.map((s) => `<span class="mono">${e(s.path)}</span> (${group(s.bytes)} bytes)`).join("<br>")}</dd>
<dt>Files read for the envelope</dt><dd>${m.meta.envelopeSources.length} files, ${group(m.meta.envelopeSources.reduce((t, s) => t + s.bytes, 0))} bytes in all (listed below)</dd>
</dl>
<details><summary>The ${r.envelopeIds.length} envelope runs and their files</summary><p class="mono">${m.meta.envelopeSources.map((s) => `${e(s.path)} (${group(s.bytes)} bytes)`).join("<br>")}</p></details>
<details><summary>What each signal means, and where it is computed</summary><div class="scroll"><table><tbody>${meanings.join("")}</tbody></table></div></details>
</div></section>`;

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Field notebook · ${e(r.id)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${first}
${run}
${tl}
${notes}
${quiet}
${cannot}
${receipts}
</main>
</body>
</html>
`;
}
