// Renderer tests for tools/lib/report-html/individuality.ts, against the
// small hand-trimmed fixture at
// tools/fixtures/report-html/individuality/report.json (derived from the
// real real8 run's report.md/report.json -- see that file's own header
// comment and this suite's assertions below for the exact values it must
// reproduce byte-for-byte).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { render, validate, type IndividualityReport } from "../../lib/report-html/individuality.ts";
import { assertPageContract } from "./contract.ts";

const FIXTURE_PATH = fileURLToPath(
  new URL("../../fixtures/report-html/individuality/report.json", import.meta.url),
);

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

const META = {
  sources: [{ path: "tools/fixtures/report-html/individuality/report.json", sha256: "ab".repeat(32) }],
  status: "REAL" as const,
};

describe("individuality validate", () => {
  it("accepts the fixture", () => {
    const data = loadFixture();
    expect(() => validate(data)).not.toThrow();
  });

  it("accepts a row with profiles: {} (worlds<2) as valid input, not an error", () => {
    const data = loadFixture() as IndividualityReport;
    const noProfileRow = data.rows.find((r) => r.kind === "component" && r.id === "0");
    expect(noProfileRow).toBeDefined();
    expect(noProfileRow?.profiles.default).toBeUndefined();
    expect(() => validate(data)).not.toThrow();
  });

  it("throws a specific error when rows is missing", () => {
    expect(() => validate({ config: { worlds: 1, calibrationWorlds: 1 }, minCalibratedWorlds: 1, holmFamilySize: 1 })).toThrow(
      /report\.rows must be an array/,
    );
  });

  it("throws a specific error when a row's profiles.default.autonomyStar.point is missing", () => {
    const data = loadFixture() as Record<string, unknown>;
    const rows = (data.rows as Record<string, unknown>[]).map((r) => structuredClone(r));
    const bad = rows.find((r) => r.kind === "genetic-cluster" && r.id === "0") as Record<string, unknown>;
    delete ((bad.profiles as Record<string, unknown>).default as Record<string, unknown>).autonomyStar;
    expect(() => validate({ ...data, rows })).toThrow(/autonomyStar\.point must be a number/);
  });

  it("throws a specific error when config.worlds is missing", () => {
    const data = loadFixture() as Record<string, unknown>;
    const { worlds: _worlds, ...restConfig } = data.config as Record<string, unknown>;
    expect(() => validate({ ...data, config: restConfig })).toThrow(/report\.config\.worlds must be a number/);
  });

  it("accepts both exact:true and exact:false nullTest shapes present in the fixture", () => {
    const data = loadFixture() as IndividualityReport;
    const exactRow = data.rows.find((r) => r.kind === "genetic-cluster" && r.id === "1");
    const monteCarloRow = data.rows.find((r) => r.kind === "genetic-cluster" && r.id === "0");
    expect(exactRow?.profiles.default?.nonClosure.nullTest.exact).toBe(true);
    expect(monteCarloRow?.profiles.default?.nonClosure.nullTest.exact).toBe(false);
    expect(() => validate(data)).not.toThrow();
  });
});

describe("individuality render", () => {
  const data = loadFixture() as IndividualityReport;
  validate(data);
  const html = render(data, META);

  it("satisfies the shared page contract with 3 figures and a REAL status chip", () => {
    assertPageContract(html, { status: "REAL", figureCount: 3 });
  });

  it("titles the page 'Colony Individuality'", () => {
    expect(html.startsWith("<title>Colony Individuality</title>")).toBe(true);
  });

  it("plots autonomyStar for eligible rows and lists ineligible rows with a 'no eligible worlds' note (Figure 1)", () => {
    // 8 of the fixture's 10 rows have profiles.default (worlds>=2); the
    // other 2 (component 0, colony 0,2,3,4,5) do not.
    expect(html).toContain("0.482 [0.297, 0.675]"); // genetic-cluster 0
    expect(html).toContain("0.744 [0.430, 1.054]"); // genetic-cluster 5, highest autonomy
    expect(html).toContain("no eligible worlds (worlds&lt;2)");
    // Every row label appears somewhere in the page (table, if not chart).
    expect(html).toContain("genetic-cluster 0");
    expect(html).toContain("component 0");
    expect(html).toContain("colony 0,2,3,4,5");
  });

  it("plots nonClosure with its cross-world p and Holm-adjusted p, and a 0 reference line (Figure 2)", () => {
    expect(html).toContain("0.029 [0.009, 0.054]"); // genetic-cluster 0 nonClosure CI
    expect(html).toContain("0.038 [0.016, 0.066]"); // genetic-cluster 4 nonClosure CI
    // genetic-cluster 4's raw p and Holm-adjusted p, the run's smallest of each.
    expect(html).toContain("0.004");
    expect(html).toContain("0.238");
  });

  it("shows the raw-p vs Holm-adjusted-p slopegraph with a 0.05 reference line, explained as reference-only in the caption", () => {
    expect(html).toMatch(/<text[^>]*>0\.05<\/text>/);
    expect(html).toMatch(/0\.05 line is drawn for reference only/);
    expect(html).toContain("raw p");
    expect(html).toContain("Holm-adjusted p");
  });

  it("uses the same viewBox width for Figure 3 as Figures 1 and 2 (consistent effective font size)", () => {
    const widths = [...html.matchAll(/<svg viewBox="0 0 (\d+) /g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(0);
    expect(new Set(widths).size).toBe(1);
  });

  it("lists the lowest Holm-adjusted cross-world p (default profile) and the Holm family size as mechanical Key numbers, not a headline finding sentence", () => {
    expect(html).toContain('<dl class="key-numbers">');
    expect(html).not.toContain('class="finding"');
    expect(html).toMatch(/Lowest Holm-adjusted cross-world p, default profile, nonClosure/);
    expect(html).toContain("0.238"); // the fixture's smallest Holm-adjusted p (genetic-cluster 4)
    expect(html).toContain("genetic-cluster 4");
    expect(html).toMatch(/Holm family size/);
    expect(html).toContain("54"); // holmFamilySize from the fixture
  });

  it("omits the coarse-profile Key numbers item when no row carries a coarse profile", () => {
    expect(html).not.toMatch(/coarse profile, nonClosure/);
  });

  it("states the calibration/uncalibrated caveat distinguishing 'no profile' from 'uncalibrated', without a specific number", () => {
    expect(html).toMatch(/no profile at all/);
    expect(html).toMatch(/uncalibrated/);
    expect(html).toMatch(/calibration threshold \(minCalibratedWorlds\)/);
    expect(html).not.toMatch(/minCalibratedWorlds=\d/);
  });

  it("points the caveats section to docs/individuality-info-theory.md and drops the numeric coverage-measurement caveat", () => {
    expect(html).toMatch(/docs\/individuality-info-theory\.md/);
    expect(html).not.toMatch(/84% coverage/);
    expect(html).not.toMatch(/Nominal 90% intervals/);
  });

  it("header has no sentence-level prose beyond the report question (REAL gets no status sentence)", () => {
    const headerBlock = html.match(/<header class="report-header">[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(headerBlock).not.toContain('class="status-sentence"');
    expect((headerBlock.match(/<p /g) ?? []).length).toBe(1);
  });

  it("changing a row's Holm-adjusted nonClosure changes the Key-numbers 'lowest' <dd> (value-driven)", () => {
    const mutated = structuredClone(loadFixture() as IndividualityReport);
    const row = mutated.rows.find((r) => r.kind === "genetic-cluster" && r.id === "4")!;
    row.nullTestsHolm!.default!.nonClosure = 0.001;
    validate(mutated);
    const mutatedHtml = render(mutated, META);
    expect(mutatedHtml).toContain("0.001 (genetic-cluster 4)");
    expect(mutatedHtml).not.toContain("0.238 (genetic-cluster 4)");
  });

  it("is deterministic: rendering the same fixture twice yields byte-identical output", () => {
    const again = render(loadFixture() as IndividualityReport, META);
    expect(again).toBe(html);
  });

  it("computes the 'nonClosure intervals excluding 0' Key number from the actual bounds (fixture: 5 of 8)", () => {
    // genetic-cluster 0, 2, 4, 5 and component 4 all have lower>0 in the
    // fixture; genetic-cluster 1, 3 and colony 0,2,4,5 include 0.
    expect(html).toMatch(/<dt>nonClosure intervals excluding 0 \(default profile\)<\/dt><dd>5 of 8<\/dd>/);
  });

  it("does not repeat the status word in the status chip note (chip label already shows it once)", () => {
    expect(html).not.toMatch(/REAL\s*--\s*REAL/);
    expect(html).not.toMatch(/<span class="status-chip-note">REAL/);
  });
});

describe("individuality render: computed nonClosure-excludes-zero Key number", () => {
  it("reports '0 of 8' when every eligible interval spans zero", () => {
    const data = loadFixture() as IndividualityReport;
    for (const row of data.rows) {
      const def = row.profiles.default;
      if (def) {
        def.nonClosure.ci.lower = -0.01;
        def.nonClosure.ci.upper = 0.2;
      }
    }
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/<dt>nonClosure intervals excluding 0 \(default profile\)<\/dt><dd>0 of 8<\/dd>/);
  });
});
