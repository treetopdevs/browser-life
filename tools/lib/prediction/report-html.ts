// Static notebook view (PLAN.md, section 10): per case an observation block (census sparkline, frame thumbnails), a hypothesis
// block (probabilities per proposer, with the free-text reason, escaped) and a measured-outcome block (the paired result), visibly
// distinct. Failed predictions first; invalid or missing ones listed in their own section. No scripts, no external URLs, works from
// file://. A pure function of its inputs.
import { escapeHtml } from "../report-html/page.ts";
import { labelOf } from "./fixtures.ts";
import type { PredictionEnvelope } from "./envelope.ts";
import type { ConfirmationDoc } from "./confirm.ts";
import type { CaseRow, Comparison, PredictionLine, SplitTable } from "./run.ts";
import { argmax, validatePredictionFile } from "./validate.ts";

const esc = escapeHtml;
const pct = (v: number | null): string => (v === null ? "n/a" : v.toFixed(3));

function spark(env: PredictionEnvelope): string {
  const pts = env.census.map((c) => c.mass);
  const lo = Math.min(...pts), hi = Math.max(...pts), span = Math.max(1, hi - lo);
  const w = 160, h = 40;
  const d = pts.map((v, i) => `${((i / Math.max(1, pts.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="body mass over the observed steps ${env.census[0].step} to ${env.census[env.census.length - 1].step}"><polyline points="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}
/** The last frame as four-level quantised paths (one path per level, empty blocks omitted), to keep the page small. */
function thumb(f: PredictionEnvelope["frames"][number]): string {
  const max = Math.max(1, ...f.mass), s = 6;
  const paths: string[] = ["", "", "", ""];
  f.mass.forEach((m, i) => {
    if (m <= 0) return;
    const lvl = Math.min(3, Math.floor((m / max) * 4));
    paths[lvl] += `M${(i % f.side) * s} ${Math.floor(i / f.side) * s}h${s}v${s}h-${s}z`;
  });
  const body = paths.map((d, i) => (d ? `<path d="${d}" fill="currentColor" fill-opacity="${[0.25, 0.5, 0.75, 1][i]}"/>` : "")).join("");
  return `<figure class="thumb"><svg viewBox="0 0 ${f.side * s} ${f.side * s}" role="img" aria-label="mass by block at step ${f.step}">${body}</svg><figcaption>t=${f.step}</figcaption></figure>`;
}
function bar(p: { up: number; down: number; none: number }): string {
  return `<span class="bar" aria-hidden="true"><i class="up" style="width:${p.up / 10}%"></i><i class="down" style="width:${p.down / 10}%"></i><i class="none" style="width:${p.none / 10}%"></i></span>`;
}

function tableHtml(t: SplitTable, note = ""): string {
  const head = ["proposer", "role", "n", "answered", "abstained", "invalid", "missing", "coverage", "Brier (imputed)", "Brier (answered)", "direction acc.", "balanced acc.", "acc. @ matched coverage", "valid non-null yield"];
  const body = t.rows.map((r) => `<tr><th scope="row">${esc(r.id)}</th><td>${esc(r.role)}</td><td>${r.n}</td><td>${r.answered}</td><td>${r.abstained}</td><td>${r.invalid}</td><td>${r.missing}</td><td>${pct(r.coverage)}</td><td>${pct(r.brierImputed)}</td><td>${pct(r.brierAnswered)}</td><td>${pct(r.directionalAccuracy)}</td><td>${pct(r.balancedAccuracy)}</td><td>${pct(r.accuracyAtMatchedCoverage)}</td><td>${pct(r.validNonNullYield)}</td></tr>`).join("");
  return `<h3>${esc(t.split)}${note ? ` <small>${esc(note)}</small>` : ""} (${t.nCases} cases, ${t.nFamilies} families; up ${t.classCounts.up}, down ${t.classCounts.down}, none ${t.classCounts.none})</h3><div class="scroll"><table><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export interface ReportInput {
  comparison: Comparison;
  envelopes: readonly PredictionEnvelope[];
  lines: readonly PredictionLine[];
  rows: readonly CaseRow[];
  minEffect: number;
  proposerIds: readonly string[];
  /** Whether a proposer was run on an envelope (the dev-only oracle is not shown, and not counted missing, on test cases). Default: always. */
  eligible?: (proposerId: string, env: PredictionEnvelope) => boolean;
  /** The sealed confirmation (I02b): adds the status banner, the reading and the failed predictions first. Absent for v0 reports, which stay byte-identical. */
  confirmation?: ConfirmationDoc;
}

const BANNER_CSS = ".banner{border:2px solid #1d2328;border-radius:6px;padding:.25rem 1rem;margin:1rem 0}.banner.rehearsal{border-style:dashed}";
const ivText = (iv: { mean: number; lo: number; hi: number } | null): string => (iv ? `${iv.mean.toFixed(4)} [${iv.lo.toFixed(4)}, ${iv.hi.toFixed(4)}]` : "n/a");

/** The confirmation section: banner, reading, the two primary comparisons, then numericTrend's failed predictions, then descriptive rows. */
function confirmationHtml(d: ConfirmationDoc): string {
  const r = d.reading;
  const cmpRow = (name: string, c: ConfirmationDoc["reading"]["comparisons"]["vsPriorMajority"]): string => `<tr><th scope="row">${esc(d.primaryRule)} minus ${esc(c.comparator)} (${esc(name)})</th><td>${ivText(c.interval)}</td><td>${c.nFamilies}</td><td>${c.pairingComplete ? "yes" : "no"}</td></tr>`;
  const failed = d.failedPredictions.length
    ? `<ul>${d.failedPredictions.map((f) => `<li><a href="#${esc(f.caseId)}">${esc(f.caseId)}</a> family ${esc(f.familyId)}: ${f.status === "answered" ? `predicted ${esc(f.predicted ?? "?")}` : esc(f.status)}, measured ${esc(f.observed)}</li>`).join("")}</ul>`
    : "<p>None.</p>";
  const desc = d.descriptive.map((x) => `<tr><th scope="row">${esc(x.proposer)}</th><td>${x.n}</td><td>${x.answered}</td><td>${x.abstained}</td><td>${x.invalid}</td><td>${x.missing}</td><td>${pct(x.brierImputed)}</td><td>${pct(x.directionalAccuracy)}</td><td>${x.predictedClasses.up}/${x.predictedClasses.down}/${x.predictedClasses.none}</td><td>${pct(x.labelAgreementWithExpectation)}</td></tr>`).join("");
  return `<section class="banner ${d.status === "CONFIRM" ? "confirm" : "rehearsal"}" aria-label="confirmation status"><p><b>Status: ${esc(d.status)}.</b> ${d.status === "CONFIRM" ? "A held-out confirmation on families fixed in a committed amendment before any outcome was computed." : "Not a held-out confirmation; no claim."}</p>
<p><b>Reading: ${esc(r.label)}</b>${r.suffix ? ` (${esc(r.suffix)})` : ""}. ${esc(r.basis)}. ${r.testFamilies} test families, ${r.testCases} test cases, rule <code>${esc(d.primaryRule)}</code>.</p>${r.overrides.length ? `<ul>${r.overrides.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}</section>
<h2>Primary comparisons (test split)</h2><p>Imputed multiclass Brier, per-family means, paired whole-family bootstrap, difference ${esc(d.primaryRule)} minus comparator (negative favours ${esc(d.primaryRule)}), mean [95% interval].</p>
<div class="scroll"><table><thead><tr><th scope="col">comparison</th><th scope="col">difference</th><th scope="col">families</th><th scope="col">pairing complete</th></tr></thead><tbody>${cmpRow("A", r.comparisons.vsShuffledEvidence)}${cmpRow("B", r.comparisons.vsPriorMajority)}</tbody></table></div>
<h2>Failed predictions of ${esc(d.primaryRule)} (test split, ${d.failedPredictions.length})</h2>${failed}
<h2>Descriptive rows (cannot produce a claim)</h2><div class="scroll"><table><thead><tr>${["proposer", "n", "answered", "abstained", "invalid", "missing", "Brier (imputed)", "direction acc.", "predicted up/down/none", "agrees with fixture expectation"].map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${desc}</tbody></table></div>`;
}

export function renderReport(inp: ReportInput): string {
  const { comparison: c, envelopes, lines, rows, minEffect } = inp;
  const eligible = inp.eligible ?? (() => true);
  const proposerIds = inp.proposerIds;
  const idsFor = (e: PredictionEnvelope): string[] => proposerIds.filter((id) => eligible(id, e));
  const rowOf = new Map(rows.map((r) => [r.caseId, r]));
  // Per-proposer validation (so invalid lines show up here as they do in the scorer).
  const status = new Map<string, Map<string, "answered" | "abstained" | "invalid" | "missing">>();
  const preds = new Map<string, Map<string, PredictionLine["prediction"] | null>>();
  for (const id of proposerIds) {
    const chk = validatePredictionFile(lines.filter((l) => l.proposer === id).map((l) => JSON.stringify(l.prediction)), envelopes);
    const s = new Map<string, "answered" | "abstained" | "invalid" | "missing">(), pm = new Map<string, PredictionLine["prediction"] | null>();
    for (const e of envelopes) {
      const g = chk.byCase.get(e.caseId);
      s.set(e.caseId, !g ? "missing" : !g.prediction ? "invalid" : g.prediction.abstain ? "abstained" : "answered");
      pm.set(e.caseId, g?.prediction ?? null);
    }
    status.set(id, s);
    preds.set(id, pm);
  }
  const envOf = new Map(envelopes.map((e) => [e.caseId, e]));
  const failures = (caseId: string): number => {
    const r = rowOf.get(caseId)!;
    const o = labelOf(r.effect.bodyMass, minEffect);
    let k = 0;
    for (const id of idsFor(envOf.get(caseId)!)) {
      const st = status.get(id)!.get(caseId)!;
      const p = preds.get(id)!.get(caseId);
      if (st === "invalid" || st === "missing" || (st === "answered" && p?.probs && argmax(p.probs) !== o)) k++;
    }
    return k;
  };
  // In a confirmation report the held-out test cases come before the dev cases, failed predictions first within each.
  // The confirmation lists the primary rule's failures, so its case order puts those first (then all-proposer failures).
  const primaryFails = (caseId: string): number => {
    if (!inp.confirmation) return 0;
    const id = inp.confirmation.primaryRule;
    if (!status.has(id)) return 0;
    const st = status.get(id)!.get(caseId)!;
    const p = preds.get(id)!.get(caseId);
    const o = labelOf(rowOf.get(caseId)!.effect.bodyMass, minEffect);
    return st === "invalid" || st === "missing" || (st === "answered" && p?.probs && argmax(p.probs) !== o) ? 1 : 0;
  };
  const testFirst = (e: PredictionEnvelope): number => (inp.confirmation && rowOf.get(e.caseId)!.split === "test" ? 0 : 1);
  const ordered = [...envelopes].filter((e) => rowOf.has(e.caseId)).sort((a, b) => testFirst(a) - testFirst(b) || primaryFails(b.caseId) - primaryFails(a.caseId) || failures(b.caseId) - failures(a.caseId) || (a.caseId < b.caseId ? -1 : 1));
  const caseHtml = (e: PredictionEnvelope): string => {
    const r = rowOf.get(e.caseId)!;
    const o = labelOf(r.effect.bodyMass, minEffect);
    const hyp = idsFor(e)
      .map((id) => {
        const st = status.get(id)!.get(e.caseId)!;
        const p = preds.get(id)!.get(e.caseId);
        if (!p || st === "invalid" || st === "missing") return `<li class="bad"><b>${esc(id)}</b> ${esc(st)}</li>`;
        if (p.abstain) return `<li><b>${esc(id)}</b> abstains <q>${esc(p.reason ?? "")}</q></li>`;
        const a = argmax(p.probs!);
        return `<li class="${a === o ? "ok" : "bad"}"><b>${esc(id)}</b> ${bar(p.probs!)} up ${p.probs!.up} / down ${p.probs!.down} / none ${p.probs!.none} per-mille, says ${esc(a)} <q>${esc(p.reason ?? "")}</q></li>`;
      })
      .join("");
    const op = e.task.op;
    const opText = op.kind === "none" ? "no operation (sham)" : `${op.kind} at (${op.x}, ${op.y}) radius ${op.r}${op.amount !== undefined ? `, amount ${op.amount}` : ""}`;
    return `<article id="${esc(e.caseId)}" class="case"><h3>${esc(e.caseId)} <small>family ${esc(e.familyId)}, ${esc(r.split)}</small></h3>
<section class="obs"><h4>Observation (steps up to ${e.task.forkStep})</h4>${spark(e)}<div class="thumbs">${thumb(e.frames[e.frames.length - 1])}</div></section>
<section class="hyp"><h4>Hypotheses</h4><p>Question: ${esc(opText)} at step ${e.task.forkStep + e.task.delta}; direction of the ${esc(e.task.readout)} difference at step ${e.task.forkStep + e.task.horizon}.</p><ul>${hyp}</ul></section>
<section class="out"><h4>Measured outcome</h4><p>treated ${r.treated}, control ${r.control}, effect ${r.effect.bodyMass} (minimum effect ${minEffect}) so <b>${esc(o)}</b>; fixture expectation ${esc(r.expected)}${o === r.expected ? "" : " (measured differs)"}.</p></section></article>`;
  };
  const bad = ordered.filter((e) => idsFor(e).some((id) => ["invalid", "missing"].includes(status.get(id)!.get(e.caseId)!)));
  const css = `body{font:15px/1.5 system-ui,sans-serif;max-width:72rem;margin:0 auto;padding:1rem;color:#1d2328;background:#fbfaf6}table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #cfc9bb;padding:.25rem .5rem;text-align:left}.scroll{overflow-x:auto}.case{border:1px solid #cfc9bb;border-radius:6px;margin:1rem 0;padding:.5rem 1rem;display:grid;gap:.5rem}.obs{background:#eef3f6;padding:.5rem;border-radius:4px;color:#27475a}${inp.confirmation ? BANNER_CSS : ""}.hyp{background:#fbf3e3;padding:.5rem;border-radius:4px}.out{background:#e8f2e8;padding:.5rem;border-radius:4px}.spark{width:10rem;height:2.5rem}.thumbs{display:flex;gap:.5rem;flex-wrap:wrap}.thumb{margin:0}.thumb svg{width:3.5rem;height:3.5rem;background:#fff;border:1px solid #cfc9bb}.thumb figcaption{font-size:11px}ul{padding-left:1rem;margin:.25rem 0}li.ok b{color:#1f6b2a}li.bad b{color:#9b2c1c}q{color:#555}.bar{display:inline-flex;width:6rem;height:.6rem;vertical-align:middle;margin-right:.4rem;background:#ddd}.bar i{display:block;height:100%}.bar .up{background:#2a7a3a}.bar .down{background:#b23b2a}.bar .none{background:#8a8f94}small{color:#666;font-weight:normal}code{overflow-wrap:anywhere}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${inp.confirmation ? "Prediction envelope: confirmation notebook" : "Prediction envelope v0: notebook"}</title><style>${css}</style></head><body>
<h1>${inp.confirmation ? "Prediction envelope: confirmation notebook" : "Prediction envelope v0: notebook"}</h1>
<p>${esc(c.noModelStatement)}</p>
<p>Protocol hash <code>${esc(c.protocolHash)}</code>. ${inp.confirmation ? "" : `Strongest simple baseline on dev: <b>${esc(c.strongestBaselineOnDev)}</b>. `}Primary readout: body mass (B+P), minimum effect ${minEffect}. Failed predictions first.</p>
<p>The mechanism oracle is a dev diagnostic: it is run on, and shown for, dev cases only.</p>
${inp.confirmation ? confirmationHtml(inp.confirmation) : ""}<h2>Comparison</h2>${tableHtml(c.dev, inp.confirmation ? "split machinery only; no role in any decision" : "")}${tableHtml(c.test)}${tableHtml(c.testExcludingMeasurementLimited)}
<h2>Invalid or missing predictions</h2>${bad.length ? `<ul>${bad.map((e) => `<li><a href="#${esc(e.caseId)}">${esc(e.caseId)}</a></li>`).join("")}</ul>` : "<p>None.</p>"}
<h2>Cases</h2>${ordered.map(caseHtml).join("\n")}
</body></html>
`;
}
