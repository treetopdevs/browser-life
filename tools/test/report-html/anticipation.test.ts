import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { render, validate } from "../../lib/report-html/anticipation.ts";
import type { AnticipationReport } from "../../lib/report-html/anticipation.ts";
import type { RenderMeta } from "../../report-html.ts";
import { assertPageContract } from "./contract.ts";

const FIXTURE_DIR = fileURLToPath(new URL("../../fixtures/report-html/anticipation/", import.meta.url));

function loadFixture(): AnticipationReport {
  const results = JSON.parse(readFileSync(`${FIXTURE_DIR}results.json`, "utf8"));
  const manifest = JSON.parse(readFileSync(`${FIXTURE_DIR}manifest.json`, "utf8"));
  return { results, manifest };
}

const META: RenderMeta = {
  sources: [
    { path: "tools/fixtures/report-html/anticipation/results.json", sha256: "aa".repeat(32) },
    { path: "tools/fixtures/report-html/anticipation/manifest.json", sha256: "bb".repeat(32) },
  ],
  status: "PILOT",
};

describe("anticipation renderer: validate", () => {
  it("accepts the fixture as-is (including a collapsedPhaseA seed and a per-direction null index)", () => {
    const data = loadFixture();
    expect(() => validate(data)).not.toThrow();
  });

  it("throws a specific error when results.seeds is missing", () => {
    const data = loadFixture() as unknown as { results: Record<string, unknown> };
    delete (data.results as Record<string, unknown>).seeds;
    expect(() => validate(data)).toThrow(/results\.seeds must be an array/);
  });

  it("throws a specific error when a seed is missing collapsedPhaseA", () => {
    const data = loadFixture() as unknown as { results: { seeds: Record<string, unknown>[] } };
    delete data.results.seeds[0].collapsedPhaseA;
    expect(() => validate(data)).toThrow(/collapsedPhaseA must be a boolean/);
  });

  it("throws a specific error when results.family is missing", () => {
    const data = loadFixture() as unknown as { results: Record<string, unknown> };
    delete (data.results as Record<string, unknown>).family;
    expect(() => validate(data)).toThrow(/results\.family/);
  });

  it("throws a specific error when a family row's ci is status \"ok\" but lo/hi are not numbers", () => {
    const data = loadFixture() as unknown as {
      results: { family: { shorter: { ci: Record<string, unknown> } } };
    };
    data.results.family.shorter.ci = { status: "ok" };
    expect(() => validate(data)).toThrow(/lo\/hi are not both numbers/);
  });

  it("does NOT throw when a seed has collapsedPhaseA true and branches: {} (valid, not a validation failure)", () => {
    const data = loadFixture();
    const collapsed = data.results.seeds.find((s) => s.collapsedPhaseA);
    expect(collapsed).toBeDefined();
    expect(collapsed?.branches).toEqual({});
    expect(() => validate(data)).not.toThrow();
  });

  it("does NOT throw when a family row's ci.status is not \"ok\" (e.g. insufficient-reps)", () => {
    const data = loadFixture();
    expect(data.results.family.longer.ci.status).toBe("insufficient-reps");
    expect(() => validate(data)).not.toThrow();
  });
});

/** Builds a genuinely all-collapsed input: every seed's Phase A collapsed
 * (so `branches: {}` for all of them, not just one), and both directions'
 * family rows report n=0/meanIndex=null/ci unavailable -- the real shape the
 * producer writes when nothing survived, not a fixture with a few fields
 * poked to null while its per-seed branches still carry live numbers. */
function buildAllCollapsedFixture(): AnticipationReport {
  const base = loadFixture();
  const seeds = base.results.seeds.map((s) => ({ ...s, collapsedPhaseA: true, branches: {} }));
  const collapsedFamilyRow = () => ({
    n: 0,
    collapsed: 0,
    phaseACollapsed: seeds.length,
    meanIndex: null,
    medianIndex: 0,
    wilcoxonP: 1,
    ci: { lo: null, hi: null, status: "insufficient-reps" as const },
    holmP: 1,
  });
  return {
    results: {
      seeds,
      family: { shorter: collapsedFamilyRow(), longer: collapsedFamilyRow() },
    },
    manifest: base.manifest,
  };
}

describe("anticipation renderer: render", () => {
  it("produces a page satisfying the shared page contract (2 figures, PILOT chip)", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(() => assertPageContract(html, { status: "PILOT", figureCount: 2 })).not.toThrow();
  });

  it("titles the page \"Light-Switch Anticipation\"", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html.startsWith("<title>Light-Switch Anticipation</title>")).toBe(true);
  });

  it("lists the family mean/CI/n/Wilcoxon-p per direction and the manifest's period facts as mechanical Key numbers", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toContain('<dl class="key-numbers">');
    expect(html).not.toContain('class="finding"');
    expect(html).toMatch(/<dt>Mean index \(shorter\)<\/dt><dd>-0\.003<\/dd>/);
    expect(html).toMatch(/<dt>Bonferroni 97\.5% CI \(shorter\)<\/dt><dd>\[-0\.020, 0\.010\]<\/dd>/);
    expect(html).toMatch(/<dt>Bonferroni 97\.5% CI \(longer\)<\/dt><dd>unavailable: insufficient-reps<\/dd>/);
    expect(html).toMatch(/<dt>Phase A periods<\/dt><dd>6<\/dd>/);
    expect(html).toMatch(/<dt>Light period<\/dt><dd>200<\/dd>/);
    expect(html).toMatch(/<dt>Switch period \(shorter\)<\/dt><dd>100<\/dd>/);
    expect(html).toMatch(/<dt>Switch period \(longer\)<\/dt><dd>400<\/dd>/);
  });

  it("header has no sentence-level prose beyond the report question and the static PILOT sentence", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    const headerBlock = html.match(/<header class="report-header">[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(headerBlock).toMatch(/class="status-sentence">Pilot data:/);
    expect((headerBlock.match(/<p /g) ?? []).length).toBe(2); // report-question + status-sentence
  });

  it("changing a direction's family mean/n changes the corresponding Key-numbers <dd> (value-driven)", () => {
    const data = loadFixture();
    data.results.family.shorter.meanIndex = 0.5;
    data.results.family.shorter.n = 9;
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/<dt>Mean index \(shorter\)<\/dt><dd>0\.500<\/dd>/);
    expect(html).toMatch(/<dt>n seed-worlds \(shorter\)<\/dt><dd>9<\/dd>/);
  });

  it("includes every seed's cost founder/evolved values (fixture data fidelity) in Figure 1's table", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    // seed 1, shorter: costFounder 0.020, costEvolved 0.010
    expect(html).toContain("0.020");
    expect(html).toContain("0.010");
    // seed 3, longer: branch collapsed (costEvolved/index null) -- rendered as a note, not "null"/NaN.
    expect(html).toContain("branch collapsed");
    expect(html).not.toMatch(/\bnull\b/);
    expect(html).not.toMatch(/NaN/);
  });

  it("includes the collapsedPhaseA seed's exclusion note", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toContain("collapsed (phase A)");
  });

  it("includes the family mean/CI numbers for both directions (fixture data fidelity) in Figure 2's table", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    // shorter family: meanIndex -0.003333... -> "-0.003", ci [-0.020, 0.010]
    expect(html).toContain("-0.003");
    expect(html).toContain("-0.020");
    expect(html).toContain("0.010");
    // longer family: ci unavailable -- shown as its status string, not a fabricated interval.
    expect(html).toContain("insufficient-reps");
  });

  it("is a pure function of its input (determinism)", () => {
    const data = loadFixture();
    validate(data);
    const html1 = render(data, META);
    const html2 = render(loadFixture(), META);
    expect(html1).toBe(html2);
  });

  it("renders a REAL-status page with the same mechanical Key numbers, no PILOT/SMOKE status sentence", () => {
    const data = loadFixture();
    validate(data);
    const realMeta: RenderMeta = { ...META, status: "REAL" };
    const html = render(data, realMeta);
    expect(() => assertPageContract(html, { status: "REAL", figureCount: 2 })).not.toThrow();
    expect(html).not.toMatch(/class="status-sentence"/);
    expect(html).toMatch(/<dt>Mean index \(shorter\)<\/dt><dd>-0\.003<\/dd>/);
  });

  it("never asserts a duration/selection-time judgement anywhere on the page", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).not.toMatch(/not enough time/);
    expect(html).not.toMatch(/nowhere near enough time/);
    expect(html).not.toMatch(/sit near zero/);
  });

  it("handles a truly all-collapsed input (every seed's Phase A collapsed, family n=0) without a fabricated mean", () => {
    const data = buildAllCollapsedFixture();
    validate(data);
    const html = render(data, META);
    expect(html).toMatch(/<dt>Mean index \(shorter\)<\/dt><dd>unavailable<\/dd>/);
    expect(html).toMatch(/<dt>Mean index \(longer\)<\/dt><dd>unavailable<\/dd>/);
    expect(html).toMatch(/<dt>n seed-worlds \(shorter\)<\/dt><dd>0<\/dd>/);
    expect(html).toMatch(/<dt>Bonferroni 97\.5% CI \(shorter\)<\/dt><dd>unavailable: insufficient-reps<\/dd>/);
    // Every seed is now collapsed (phase A), including the ones that had live
    // branches in the base fixture -- the note appears once per (seed,
    // direction) pair in both Figure 1's and Figure 2's tables.
    const directionCount = 2; // shorter, longer
    expect((html.match(/collapsed \(phase A\)/g) ?? []).length).toBe(data.results.seeds.length * directionCount * 2);
  });

  it("does not repeat the status word in the status chip note (chip label already shows it once)", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    expect(html).not.toMatch(/PILOT\s*[-–]\s*PILOT/);
    expect(html).not.toMatch(/<span class="status-chip-note">PILOT/);
  });

  it("uses the same viewBox width for Figure 2 as its own full-width standard (no oversized text)", () => {
    const data = loadFixture();
    validate(data);
    const html = render(data, META);
    const widths = [...html.matchAll(/<svg viewBox="0 0 (\d+) /g)].map((m) => Number(m[1]));
    // Figure 1 draws two side-by-side (narrower, intentionally) slopegraphs;
    // Figure 2 is a single full-width forest plot and must match the other
    // tracks' standard full-width figures (720), not a much narrower value
    // that would render its text far larger once scaled to full page width.
    expect(widths).toContain(720);
  });
});
