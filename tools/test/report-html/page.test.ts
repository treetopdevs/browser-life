import { describe, expect, it } from "vitest";
import { caveatParagraph, caveatsSection, escapeHtml, figure, header, keyNumbersList, numbersTable, pageShell, statusChip } from "../../lib/report-html/page.ts";

describe("escapeHtml", () => {
  it("escapes & < > \" ' and nothing else", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });

  it("escapes each character independently, in an order that never double-escapes", () => {
    // If '&' were replaced after '<', "<" -> "&lt;" would then have its '&'
    // re-escaped to "&amp;lt;". Assert that does NOT happen.
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("a & b < c")).toBe("a &amp; b &lt; c");
  });
});

describe("statusChip", () => {
  it("renders REAL/PILOT/SMOKE with distinct classes and the given note", () => {
    const real = statusChip("REAL", "32 replicates/window");
    expect(real).toContain('class="status-chip status-real"');
    expect(real).toContain(">REAL<");
    expect(real).toContain("32 replicates/window");

    const pilot = statusChip("PILOT", "3 seeds, not a result");
    expect(pilot).toContain('class="status-chip status-pilot"');
    expect(pilot).toContain(">PILOT<");

    const smoke = statusChip("SMOKE", "pipeline check only");
    expect(smoke).toContain('class="status-chip status-smoke"');
    expect(smoke).toContain(">SMOKE<");
  });

  it("escapes the note", () => {
    expect(statusChip("PILOT", "<script>")).toContain("&lt;script&gt;");
  });
});

describe("header", () => {
  it("includes the title, question, one status chip, every source line, and the key numbers", () => {
    const html = header({
      title: "Null Gate Calibration",
      question: "Do the held-out gates false-positive on exchangeable nulls?",
      status: "REAL",
      statusNote: "32 replicates/window",
      sources: [{ path: "../browser-life-nullgates/runs/nullcal/report.json", sha256: "ab".repeat(32) }],
      keyNumbers: keyNumbersList([{ label: "Replicates", value: "32" }]),
    });
    expect(html).toContain("Null Gate Calibration");
    expect(html).toContain("Do the held-out gates false-positive on exchangeable nulls?");
    expect((html.match(/status-chip /g) ?? []).length).toBe(1);
    expect(html).toContain("../browser-life-nullgates/runs/nullcal/report.json");
    expect(html).toContain("ab".repeat(32));
    expect(html).toContain('<dl class="key-numbers">');
    expect(html).toContain("Replicates");
  });

  it("renders one source line per input file, in order", () => {
    const html = header({
      title: "Island Biogeography",
      question: "Does richness scale with area, and with isolation?",
      status: "SMOKE",
      statusNote: "12 runs",
      sources: [
        { path: "report.json", sha256: "11".repeat(32) },
        { path: "experiment.json", sha256: "22".repeat(32) },
      ],
      keyNumbers: keyNumbersList([{ label: "Eligible runs", value: "12" }]),
    });
    const reportIdx = html.indexOf("report.json");
    const experimentIdx = html.indexOf("experiment.json");
    expect(reportIdx).toBeGreaterThan(-1);
    expect(experimentIdx).toBeGreaterThan(reportIdx);
  });

  it("renders the one static per-status sentence for PILOT/SMOKE and none for REAL", () => {
    const real = header({
      title: "T",
      question: "Q?",
      status: "REAL",
      statusNote: "1 run",
      sources: [{ path: "x.json", sha256: "aa".repeat(32) }],
      keyNumbers: keyNumbersList([{ label: "L", value: "1" }]),
    });
    expect(real).not.toContain('class="status-sentence"');

    const pilot = header({
      title: "T",
      question: "Q?",
      status: "PILOT",
      statusNote: "1 seed",
      sources: [{ path: "x.json", sha256: "aa".repeat(32) }],
      keyNumbers: keyNumbersList([{ label: "L", value: "1" }]),
    });
    expect(pilot).toMatch(/class="status-sentence">Pilot data:/);

    const smoke = header({
      title: "T",
      question: "Q?",
      status: "SMOKE",
      statusNote: "1 run",
      sources: [{ path: "x.json", sha256: "aa".repeat(32) }],
      keyNumbers: keyNumbersList([{ label: "L", value: "1" }]),
    });
    expect(smoke).toMatch(/class="status-sentence">Smoke-test data:/);
  });
});

describe("keyNumbersList", () => {
  it("renders one label/value pair per item, escaped", () => {
    const html = keyNumbersList([
      { label: "Holm family size", value: "54" },
      { label: "A & B <caveat>", value: "n/a" },
    ]);
    expect(html).toContain('<dl class="key-numbers">');
    expect(html).toContain("<dt>Holm family size</dt><dd>54</dd>");
    expect(html).toContain("A &amp; B &lt;caveat&gt;");
  });
});

describe("figure", () => {
  it("numbers the figure and includes the escaped caption and an optional table", () => {
    const svg = `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"></svg>`;
    const withTable = figure(2, svg, "Pass rate <matrix>.", numbersTable(["row", "k/n"], [["adaptive-activity", "0/32"]]));
    expect(withTable).toContain("<strong>Figure 2.</strong>");
    expect(withTable).toContain("Pass rate &lt;matrix&gt;.");
    expect(withTable).toContain("<table>");
    expect(withTable).toContain("adaptive-activity");

    const withoutTable = figure(1, svg, "No table here.");
    expect(withoutTable).not.toContain("<table>");
  });
});

describe("numbersTable", () => {
  it("renders headers and rows, escaping cell content", () => {
    const html = numbersTable(["endpoint", "k/n"], [["a & b", "3/32"], ["c<d", "0/32"]]);
    expect(html).toContain("<th>endpoint</th>");
    expect(html).toContain("<th>k/n</th>");
    expect(html).toContain("a &amp; b");
    expect(html).toContain("c&lt;d");
    expect(html).toContain("3/32");
  });
});

describe("caveatsSection / caveatParagraph", () => {
  it("wraps escaped paragraphs under a heading", () => {
    const html = caveatsSection("Caveats", [caveatParagraph("A <caveat> with & an ampersand.")]);
    expect(html).toContain("<h2>Caveats</h2>");
    expect(html).toContain("A &lt;caveat&gt; with &amp; an ampersand.");
  });
});

describe("pageShell", () => {
  const shell = pageShell({ title: "Null Gate Calibration", bodyHtml: "<p>body</p>" });

  it("starts with <title> then <style>, before anything else", () => {
    expect(shell.startsWith("<title>Null Gate Calibration</title>")).toBe(true);
    const titleEnd = shell.indexOf("</title>") + "</title>".length;
    expect(shell.slice(titleEnd).trimStart().startsWith("<style>")).toBe(true);
  });

  it("never contains a doctype/html/head/body root tag", () => {
    expect(shell).not.toMatch(/<!doctype/i);
    expect(shell).not.toMatch(/<html[\s>]/i);
    expect(shell).not.toMatch(/<head[\s>]/i);
    expect(shell).not.toMatch(/<body[\s>]/i);
  });

  it("only references fonts.googleapis.com as an external resource", () => {
    const urls = shell.match(/https?:\/\/[^\s"')]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith("https://fonts.googleapis.com/")).toBe(true);
  });

  it("defines every light-theme token in the bare :root block", () => {
    const rootMatch = shell.match(/:root\s*\{([^}]*)\}/);
    expect(rootMatch).not.toBeNull();
    const rootBlock = rootMatch![1];
    for (const token of ["--ground", "--panel", "--ink", "--muted", "--rule", "--accent", "--accent2", "--pass", "--fail", "--ci"]) {
      expect(rootBlock).toContain(`${token}:`);
    }
  });

  it("redefines the same tokens under both required dark blocks, each with color-scheme: dark", () => {
    expect(shell).toContain('@media (prefers-color-scheme: dark) {');
    expect(shell).toMatch(/:root:not\(\[data-theme="light"\]\)\s*\{[^}]*color-scheme:\s*dark/);
    expect(shell).toMatch(/:root\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark/);
  });

  it("gives body an explicit background token", () => {
    expect(shell).toMatch(/body\s*\{[^}]*background:\s*var\(--ground\)/);
  });

  it("wraps the body in a single outer wrapper with padding-inline", () => {
    expect(shell).toContain('<div class="report-wrap">');
    expect(shell).toMatch(/\.report-wrap\s*\{[^}]*padding-inline:/);
    expect(shell).toContain("<p>body</p>");
  });
});
