import { describe, expect, it } from "vitest";
import { figure, header, keyNumbersList, numbersTable, pageShell } from "../../lib/report-html/page.ts";
import { forestPlot, linearScale } from "../../lib/report-html/svg.ts";
import { assertPageContract } from "./contract.ts";

function buildValidPage(): string {
  const xScale = linearScale([0, 1], [40, 300]);
  const svg = forestPlot({
    viewBox: { width: 320, height: 80 },
    margin: { top: 10, right: 10, bottom: 30, left: 140 },
    rows: [{ label: "adaptive-activity", point: 0, lower: 0, upper: 0.1 }],
    xScale,
    xTicks: [0, 0.5, 1],
  });
  const body = `${header({
    title: "Null Gate Calibration",
    question: "Do the held-out gates false-positive on exchangeable nulls?",
    status: "REAL",
    statusNote: "32 replicates/window",
    sources: [{ path: "report.json", sha256: "ab".repeat(32) }],
    keyNumbers: keyNumbersList([{ label: "Replicates", value: "32" }]),
  })}\n${figure(1, svg, "Pass rate per endpoint.", numbersTable(["endpoint", "k/n"], [["adaptive-activity", "0/32"]]))}`;
  return pageShell({ title: "Null Gate Calibration", bodyHtml: body });
}

describe("assertPageContract", () => {
  it("passes on a page built entirely from page.ts/svg.ts helpers", () => {
    const html = buildValidPage();
    expect(() => assertPageContract(html, { status: "REAL", figureCount: 1 })).not.toThrow();
  });

  it("fails when the figure count is wrong", () => {
    const html = buildValidPage();
    expect(() => assertPageContract(html, { status: "REAL", figureCount: 2 })).toThrow();
  });

  it("fails when the status chip label doesn't match", () => {
    const html = buildValidPage();
    expect(() => assertPageContract(html, { status: "PILOT", figureCount: 1 })).toThrow();
  });

  it("fails when the SVG uses a token the bare :root block never declares", () => {
    // Target an occurrence specifically inside the SVG's own markup (a
    // `fill=` attribute), not the page's <style> block, which also contains
    // "var(--accent)" text earlier in the document.
    const html = buildValidPage().replace('fill="var(--accent)"', 'fill="var(--not-a-real-token)"');
    expect(() => assertPageContract(html, { status: "REAL", figureCount: 1 })).toThrow(/not-a-real-token/);
  });

  it("fails when the SVG contains a literal hex colour", () => {
    const html = buildValidPage().replace('fill="var(--accent)"', 'fill="#A8661B"');
    expect(() => assertPageContract(html, { status: "REAL", figureCount: 1 })).toThrow(/literal hex/);
  });

  it("fails when an external URL outside fonts.googleapis.com is present", () => {
    const html = buildValidPage().replace(
      "fonts.googleapis.com",
      "evil.example.com",
    );
    expect(() => assertPageContract(html, { status: "REAL", figureCount: 1 })).toThrow(/external URL/);
  });

  it("fails when the page does not start with <title> then <style>", () => {
    const html = `<div>oops</div>${buildValidPage()}`;
    expect(() => assertPageContract(html, { status: "REAL", figureCount: 1 })).toThrow();
  });

  it("fails when a dark block is missing", () => {
    const html = buildValidPage().replace(
      /:root\[data-theme="dark"\]\s*\{[^}]*\}/,
      "",
    );
    expect(() => assertPageContract(html, { status: "REAL", figureCount: 1 })).toThrow(/data-theme="dark"/);
  });
});
