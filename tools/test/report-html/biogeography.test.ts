import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { render, validate } from "../../lib/report-html/biogeography.ts";
import type { BiogeographyReport } from "../../lib/report-html/biogeography.ts";
import type { RenderMeta } from "../../report-html.ts";
import { assertPageContract } from "./contract.ts";

const REPORT_PATH = fileURLToPath(new URL("../../fixtures/report-html/biogeography/report.json", import.meta.url));
const EXPERIMENT_PATH = fileURLToPath(new URL("../../fixtures/report-html/biogeography/experiment.json", import.meta.url));

function loadFixture(): BiogeographyReport {
  return {
    report: JSON.parse(readFileSync(REPORT_PATH, "utf8")),
    experiment: JSON.parse(readFileSync(EXPERIMENT_PATH, "utf8")),
  };
}

const META: RenderMeta = {
  sources: [
    { path: "tools/fixtures/report-html/biogeography/report.json", sha256: "dd".repeat(32) },
    { path: "tools/fixtures/report-html/biogeography/experiment.json", sha256: "ee".repeat(32) },
  ],
  status: "SMOKE",
};

describe("biogeography renderer: validate", () => {
  it("accepts the fixture as-is", () => {
    const data = loadFixture();
    expect(() => validate(data)).not.toThrow();
  });

  it("throws when report is missing", () => {
    const data = loadFixture() as unknown as Record<string, unknown>;
    delete data.report;
    expect(() => validate(data)).toThrow(/missing or malformed "report"/);
  });

  it("throws when experiment is missing", () => {
    const data = loadFixture() as unknown as Record<string, unknown>;
    delete data.experiment;
    expect(() => validate(data)).toThrow(/missing or malformed "experiment"/);
  });

  it("throws a specific error when report.areaFits is missing", () => {
    const data = loadFixture() as unknown as { report: Record<string, unknown> };
    delete data.report.areaFits;
    expect(() => validate(data)).toThrow(/report\.areaFits must be an object/);
  });

  it("does NOT throw when an areaFits[condition] is shaped as {error} instead of a fit", () => {
    const data = loadFixture() as unknown as { report: { areaFits: Record<string, unknown> } };
    data.report.areaFits.treatment = { error: "fewer than 3 positive-richness points" };
    expect(() => validate(data)).not.toThrow();
  });

  it("throws when an areaFits[condition] is neither {error} nor a well-formed fit", () => {
    const data = loadFixture() as unknown as { report: { areaFits: Record<string, unknown> } };
    data.report.areaFits.treatment = { z: 0.5 }; // missing logC/r2/n/excludedZeros/zs
    expect(() => validate(data)).toThrow(/report\.areaFits\["treatment"\] is neither/);
  });

  it("throws when a perRunHistories row is missing a required field", () => {
    const data = loadFixture() as unknown as { report: { perRunHistories: Record<string, unknown>[] } };
    delete data.report.perRunHistories[0].richness;
    expect(() => validate(data)).toThrow(/report\.perRunHistories\[0\] must have/);
  });

  it("throws when a perRunHistories isolation-arm row's runId is missing from experiment.runs", () => {
    const data = loadFixture() as unknown as { experiment: { runs: { runId: string }[] } };
    // a576-treatment-s1 is an isolation-arm row in the fixture; drop its join target.
    data.experiment.runs = data.experiment.runs.filter((r) => r.runId !== "a576-treatment-s1");
    expect(() => validate(data)).toThrow(/a576-treatment-s1.*has no matching entry in experiment\.json/s);
  });

  it("does NOT throw when a non-isolation-arm run has no experiment.runs entry", () => {
    const data = loadFixture() as unknown as { experiment: { runs: { runId: string }[] } };
    // a1600-no-migration-s2 is area-only (no "isolation" arm) in the fixture.
    data.experiment.runs = data.experiment.runs.filter((r) => r.runId !== "a1600-no-migration-s2");
    expect(() => validate(data)).not.toThrow();
  });

  it("accepts a turnoverSummary row with crossingStep/equilibriumRichness both null", () => {
    const data = loadFixture();
    const hasNullRow = data.report.turnoverSummary.some((r) => r.crossingStep === null && r.equilibriumRichness === null);
    expect(hasNullRow).toBe(true);
    expect(() => validate(data)).not.toThrow();
  });

  it("throws when experiment.migrationPeriod is not a number", () => {
    const data = loadFixture() as unknown as { experiment: Record<string, unknown> };
    delete data.experiment.migrationPeriod;
    expect(() => validate(data)).toThrow(/experiment\.migrationPeriod must be a finite number/);
  });
});

describe("biogeography renderer: render", () => {
  it("produces a page satisfying the shared page contract (3 figures, SMOKE chip)", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(() => assertPageContract(html, { status: "SMOKE", figureCount: 3 })).not.toThrow();
  });

  it('titles the page "Island Biogeography"', () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html.startsWith("<title>Island Biogeography</title>")).toBe(true);
  });

  it("lists the per-condition z/CI/n and the isolation trend/best-rate comparison as mechanical Key numbers, not a headline finding sentence", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toContain('<dl class="key-numbers">');
    expect(html).not.toContain('class="finding"');
    expect(html).toMatch(/<dt>z \(95% CI\), treatment<\/dt>/);
    expect(html).toMatch(/<dt>Trend r \(seed-blocked\)<\/dt><dd>0\.970<\/dd>/);
    expect(html).toMatch(/<dt>Best rate vs no-migration \(exploratory\)<\/dt><dd>rate 0\.050/);
  });

  it("shows the treatment and no-migration species-area fit numbers (fixture data fidelity)", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toContain("0.538"); // treatment z
    expect(html).toContain("0.677"); // no-migration z
    expect(html).toContain("6"); // n=6 for treatment (also appears elsewhere, checked loosely)
  });

  it("reports excludedZeros=1 for the no-migration fit and shows an extinct-run marker", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/no-migration[\s\S]*?<\/table>[\s\S]*?1/);
    expect(html).toContain("excludedZeros");
    expect(html).toMatch(/extinct/);
  });

  it("never draws a shaded CI band around the species-area fit curves (only annotation text)", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    // The fit CI is reported as text/table, not as a filled band shape tied to it.
    expect(html).toMatch(/no CI band/);
  });

  it("shows the isolation trend correlation and exploratory best-rate comparison as annotated numbers", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toContain("0.970"); // trendCorrelation (fixture value, 3dp)
    expect(html).toMatch(/exploratory/i);
  });

  it('marks a turnoverSummary row with crossingStep:null as "no equilibrium reached", not dropped or zeroed', () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/no equilibrium reached/);
    expect(html).toContain("a576-treatment-s1");
  });

  it("states the two different zero-richness exclusion rules for the area fit vs. isolation analysis", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/species-area fit excludes zero-richness RUNS/);
    expect(html).toMatch(/isolation analysis does NOT exclude zero-richness/);
  });

  it("is a pure function of its input (determinism)", () => {
    const data = loadFixture();
    validate(data);
    const html1 = render(data, META);
    const html2 = render(loadFixture(), META);
    expect(html1).toBe(html2);
  });

  it("accepts a meanByRate row with sd: null (a single eligible observation at that rate) and renders that specific cell as unavailable, not just some 'n/a' elsewhere on the page", () => {
    const data = loadFixture();
    const isolation = data.report.isolation as { meanByRate: { rate: number; mean: number; sd: number | null; n: number }[] };
    isolation.meanByRate[0].sd = null;
    const { rate, mean, n } = isolation.meanByRate[0];
    expect(() => validate(data)).not.toThrow();
    const html = render(data, META);
    // The exact table row for this rate: rate, mean, sd ("n/a"), n -- not a
    // loose page-wide "n/a" match, which any unrelated null elsewhere could
    // also satisfy.
    const rateStr = rate.toFixed(3);
    const meanStr = mean.toFixed(3);
    const rowRe = new RegExp(
      `<tr><td>${rateStr.replace(".", "\\.")}</td><td>${meanStr.replace(".", "\\.")}</td><td>n/a</td><td>${n}</td></tr>`,
    );
    expect(html).toMatch(rowRe);
  });

  it("renders 'CI unavailable' with no guessed cause whenever the isolation trend CI is null, regardless of why", () => {
    // Case 1: trendCorrelation itself is null (correlation undefined).
    const dataA = loadFixture();
    const isoA = dataA.report.isolation as { trendCorrelation: number | null; trendCI: unknown };
    isoA.trendCorrelation = null;
    isoA.trendCI = null;
    validate(dataA);
    const htmlA = render(dataA, META);
    expect(htmlA).toMatch(/<dt>Trend 95% CI \(seed-blocked\)<\/dt><dd>CI unavailable<\/dd>/);
    expect(htmlA).not.toMatch(/correlation undefined/);
    expect(htmlA).not.toMatch(/undefined trend correlation/);

    // Case 2: trendCorrelation stays a real number but the CI is still null
    // for a reason this data doesn't establish (both fixture seeds 1 and 2
    // appear at more than one rate, so ">=2 seed blocks" isn't the cause
    // either) -- same mechanical output, no cause asserted either way.
    const dataB = loadFixture();
    const isoB = dataB.report.isolation as { trendCI: unknown };
    isoB.trendCI = null;
    validate(dataB);
    const htmlB = render(dataB, META);
    expect(htmlB).toMatch(/<dt>Trend 95% CI \(seed-blocked\)<\/dt><dd>CI unavailable<\/dd>/);
    expect(htmlB).not.toMatch(/fewer than 2 seed blocks/);
  });

  it("accepts null best-rate comparison p-values and renders them as unavailable", () => {
    const data = loadFixture();
    const isolation = data.report.isolation as { bestRateVsNoMigration: { p: number | null; holmAdjustedP: number | null } };
    isolation.bestRateVsNoMigration.p = null;
    isolation.bestRateVsNoMigration.holmAdjustedP = null;
    expect(() => validate(data)).not.toThrow();
    const html = render(data, META);
    expect(html).toMatch(/<dt>Best rate vs no-migration \(exploratory\)<\/dt><dd>rate 0\.050, p unavailable, Holm p unavailable, effect 1\.000<\/dd>/);
  });

  it("Figure 2's caption promises no mean/SD overlay when the isolation analysis errored", () => {
    const data = loadFixture();
    expect(render(data, META)).toMatch(/overlaid with the mean/);
    (data.report as { isolation: unknown }).isolation = { error: "no eligible no-migration control runs" };
    expect(() => validate(data)).not.toThrow();
    const html = render(data, META);
    expect(html).not.toMatch(/overlaid with the mean/);
    expect(html).toMatch(/The isolation analysis did not run for this input/);
  });

  it("renders a compact reached/total counts summary, not a per-tile chart, when no tile reached equilibrium", () => {
    const data = loadFixture();
    for (const row of data.report.turnoverSummary) {
      row.crossingStep = null;
      row.equilibriumRichness = null;
    }
    validate(data);
    const html = render(data, META);
    expect(() => assertPageContract(html, { status: "SMOKE", figureCount: 3 })).not.toThrow();
    expect(html).toMatch(/nothing to plot as a per-tile chart/);
    expect(html).toMatch(/tiles reaching turnover equilibrium, by condition/);
    expect(html).toContain("treatment");
    expect(html).toContain("no-migration");
    // The per-tile table collapses to reached/total counts too -- a 5-row
    // (or 48-row, at real scale) table that all say "no equilibrium reached"
    // is exactly the clutter this branch exists to avoid.
    expect(html).not.toContain("a576-treatment-s1");
    expect(html).toMatch(/tiles reaching equilibrium/);
  });

  it("keeps the per-tile chart, restricted to the tiles that reached equilibrium, when at least one did", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/restricted to the tiles that reached the turnoverEquilibrium criterion/);
    // Reached tiles are plotted as forest-plot row labels...
    expect(html).toContain("a576-treatment-s1 / tile 0");
    expect(html).toContain("a1024-treatment-s1 / tile 0");
    expect(html).toContain("a1600-treatment-s2 / tile 0");
    // ...the not-reached tile is not among the plotted row labels, only in
    // the table as "no equilibrium reached".
    expect(html).not.toContain("a576-treatment-s1 / tile 1");
  });

  it("identifies Figure 3's turnover as founder-set based, not geneticRichness, and does not claim geneticRichness is used throughout", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).not.toMatch(/the figures above use geneticRichness throughout/);
    expect(html).toMatch(/Figures 1 and 2.*use geneticRichness/);
    expect(html).toMatch(/Figure 3(&#39;|')s turnover is founder-set based/);
  });

  it("states the run's scale (eligible runs, steps, seeds, areas) as mechanical Key numbers, derived from the data", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/<dt>Eligible runs<\/dt><dd>12<\/dd>/);
    expect(html).toMatch(/<dt>Steps<\/dt><dd>120<\/dd>/);
    expect(html).toMatch(/<dt>Seeds<\/dt><dd>2<\/dd>/);
    expect(html).toMatch(/<dt>Areas \(cells\)<\/dt><dd>576, 1024, 1600<\/dd>/);
  });

  it("never states an evaluative 'not ecologically meaningful'/'not a result' claim anywhere, at any status", () => {
    const data = loadFixture();
    validate(data);
    for (const status of ["SMOKE", "PILOT", "REAL"] as const) {
      const html = render(data, { ...META, status });
      expect(html).not.toMatch(/not ecologically meaningful/);
      expect(html).not.toMatch(/not a result/);
    }
  });

  it("points the caveats section to experiments/biogeography-island.md", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/experiments\/biogeography-island\.md/);
  });

  it("header has no sentence-level prose beyond the static per-status sentence (REAL gets none, SMOKE gets the shared one)", () => {
    const data = loadFixture();
    validate(data);
    const smokeHtml = render(data, META);
    const smokeHeader = smokeHtml.match(/<header class="report-header">[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(smokeHeader).toMatch(/class="status-sentence">Smoke-test data:/);
    expect((smokeHeader.match(/<p /g) ?? []).length).toBe(2); // report-question + status-sentence

    const realHtml = render(data, { ...META, status: "REAL" });
    const realHeader = realHtml.match(/<header class="report-header">[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(realHeader).not.toContain('class="status-sentence"');
    expect((realHeader.match(/<p /g) ?? []).length).toBe(1);
  });

  it("changing the treatment fit's z changes the corresponding Key-numbers <dd> (value-driven)", () => {
    const data = loadFixture();
    (data.report.areaFits.treatment as { z: number }).z = 0.123;
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/<dt>z \(95% CI\), treatment<\/dt><dd>0\.123 /);
  });

  it("does not repeat the status word in the status chip note (chip label already shows it once)", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).not.toMatch(/SMOKE\s*--\s*SMOKE/);
    expect(html).not.toMatch(/<span class="status-chip-note">SMOKE/);
  });
});
