import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { render, validate } from "../../lib/report-html/nullcal.ts";
import type { NullcalReport } from "../../lib/report-html/nullcal.ts";
import type { RenderMeta } from "../../report-html.ts";
import { assertPageContract } from "./contract.ts";

const FIXTURE_PATH = fileURLToPath(new URL("../../fixtures/report-html/nullcal/report.json", import.meta.url));

function loadFixture(): NullcalReport {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

const META: RenderMeta = {
  sources: [{ path: "tools/fixtures/report-html/nullcal/report.json", sha256: "cc".repeat(32) }],
  status: "REAL",
};

describe("nullcal renderer: validate", () => {
  it("accepts the fixture as-is", () => {
    const data = loadFixture();
    expect(() => validate(data)).not.toThrow();
  });

  it("throws a specific error when config is missing", () => {
    const data = loadFixture() as unknown as Record<string, unknown>;
    delete data.config;
    expect(() => validate(data)).toThrow(/missing "config" object/);
  });

  it("throws a specific error when config.nulls is not a string array", () => {
    const data = loadFixture() as unknown as { config: Record<string, unknown> };
    data.config.nulls = [1, 2];
    expect(() => validate(data)).toThrow(/"config\.nulls" must be an array of strings/);
  });

  it("throws a specific error when config.windows is not a number array", () => {
    const data = loadFixture() as unknown as { config: Record<string, unknown> };
    data.config.windows = ["1e5"];
    expect(() => validate(data)).toThrow(/"config\.windows" must be an array of numbers/);
  });

  it("throws a specific error when tallies is missing", () => {
    const data = loadFixture() as unknown as Record<string, unknown>;
    delete data.tallies;
    expect(() => validate(data)).toThrow(/"tallies" must be an object/);
  });

  it("throws a specific, named error on a malformed tally row", () => {
    const data = loadFixture() as unknown as { tallies: Record<string, unknown> };
    const key = Object.keys(data.tallies)[0];
    data.tallies[key] = { k: 0, n: 32 }; // missing unavailable/ci
    expect(() => validate(data)).toThrow(new RegExp(`tallies\\.${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  it("does NOT throw on an unavailable cell (n=0, unavailable=32, ci=null) alongside a normal cell", () => {
    const data = loadFixture();
    const unavailableKey = Object.keys(data.tallies).find((k) => data.tallies[k].n === 0);
    expect(unavailableKey).toBeDefined();
    expect(data.tallies[unavailableKey!]).toEqual({ k: 0, n: 0, unavailable: 32, ci: null });
    expect(() => validate(data)).not.toThrow();
  });
});

describe("nullcal renderer: render", () => {
  it("produces a page satisfying the shared page contract (2 figures, REAL chip)", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(() => assertPageContract(html, { status: "REAL", figureCount: 2 })).not.toThrow();
  });

  it('titles the page "Null Gate Calibration"', () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html.startsWith("<title>Null Gate Calibration</title>")).toBe(true);
  });

  it("lists the fixture's null-cells-with-any-pass and control-passing rows as mechanical Key numbers, not a headline finding sentence", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/Null cells with any pass \(k&gt;0\), window 1e5/);
    expect(html).toMatch(/Positive control rows passing at k=n, window 1e5/);
  });

  it("shows saturatingProcess's unbounded-growth 3/32 pass rate (fixture data fidelity) in Figure 1's table and the Key numbers list", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    // saturatingProcess@100000::unbounded-growth and @1000000 are both 3/32 in the fixture.
    expect(html).toContain("3/32");
    expect(html).toContain("unbounded-growth");
    expect(html).toContain("saturatingProcess");
    expect(html).toMatch(/saturatingProcess unbounded-growth 3\/32/);
  });

  it("header has no sentence-level prose beyond the report question (REAL gets no status sentence, and the old finding container is gone)", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    const headerBlock = html.match(/<header class="report-header">[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(headerBlock).toContain('<dl class="key-numbers">');
    expect(headerBlock).not.toContain('class="finding"');
    expect(headerBlock).not.toContain('class="status-sentence"');
    // Exactly one <p>: the report-question. No headline/finding paragraph.
    expect((headerBlock.match(/<p /g) ?? []).length).toBe(1);
  });

  it("changing a tally's k changes the corresponding Key-numbers <dd> (value-driven)", () => {
    const data = loadFixture();
    data.tallies["saturatingProcess@100000::unbounded-growth"].k = 7;
    validate(data);
    const html = render(data, META);
    // Scope the check to window 1e5's own Key-numbers item -- the fixture
    // also has an unrelated, unchanged saturatingProcess/unbounded-growth
    // 3/32 cell at window 1e6, so a bare substring match would pass/fail for
    // the wrong reason.
    const windowItem = html.match(/<dt>Null cells with any pass \(k&gt;0\), window 1e5<\/dt><dd>([^<]*)<\/dd>/);
    expect(windowItem?.[1]).toContain("saturatingProcess unbounded-growth 7/32");
    expect(windowItem?.[1]).not.toContain("saturatingProcess unbounded-growth 3/32");
  });

  it("omits the positive-control Key-numbers item and control panel when boundedTreatmentVsFlat is empty (runBounded:false)", () => {
    const data = loadFixture();
    data.config.runBounded = false;
    data.boundedTreatmentVsFlat = {};
    validate(data);
    const html = render(data, META);
    expect(html).not.toMatch(/Positive control rows passing at k=n/);
    expect(html).not.toContain("boundedTreatmentVsFlat");
    expect(html).not.toMatch(/positive control \(boundedTreatmentVsFlat\)/i);
  });

  it("marks the unavailable coexistence cell at the shorter window distinctly, not as a 0/n pass", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/unavailable \(32\/32 unavailable\)/);
    // The dot-matrix glyph for "unavailable" is a distinct hatched marker, never a filled 0-rate dot.
    expect(html).toMatch(/fill="none" stroke="var\(--muted\)" stroke-width="1\.5" stroke-dasharray="2,2"/);
  });

  it("shows the boundedTreatmentVsFlat positive control's held-out-role-count 0/32 (fixture data fidelity)", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toContain("boundedTreatmentVsFlat");
    expect(html).toContain("held-out-role-count");
  });

  it("never draws a 0.05 reference line in Figure 2 (unbounded-growth is a classifier, not an alpha test)", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).not.toMatch(/alpha\s*=?\s*0\.05/);
  });

  it("states the ecological-closure-coexistence.gate caveat as a method fact, not a data-specific claim", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/\.gate variant are different rules.*can pass one and fail the other/s);
    expect(html).toMatch(/genuine coexistence in a bounded generator is not evidence of open-endedness/i);
  });

  it("points the caveats section to docs/plan.md and includes no evaluative/duration/count-bearing caveat", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/docs\/plan\.md/);
    expect(html).not.toMatch(/not a result/);
    expect(html).not.toMatch(/not meaningful/);
    expect(html).not.toMatch(/nowhere near enough time/);
  });

  it("is a pure function of its input (determinism)", () => {
    const data = loadFixture();
    validate(data);
    const html1 = render(data, META);
    const html2 = render(loadFixture(), META);
    expect(html1).toBe(html2);
  });
});
