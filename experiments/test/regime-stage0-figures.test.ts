// Tests of the Stage 0 run 1 figures (experiments/3d-slab/regime-stage0-figures.ts) and the --stage0-figures flag of regime-html.ts.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ReaderError } from "../3d-slab/regime-readout.ts";
import { htmlMain } from "../3d-slab/regime-html.ts";
import {
  CAL_COLUMNS, DAMAGE_COLUMNS, STAGE0_BANNER, calClass, calibrationFigureHtml, calibrationSummary, calibrationTableHtml, damageFigureHtml, damageTableHtml,
  assertCalibrationGrid, inBand, lightOk, parseCalibrationTsv, parseDamageTsv, stage0SectionHtml,
} from "../3d-slab/regime-stage0-figures.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "3d-slab");
const damageText = readFileSync(join(dir, "regime-stage0-run1-damage.tsv"), "utf8");
const m4Text = readFileSync(join(dir, "m4-results.tsv"), "utf8");
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("Stage 0 run 1 figures", () => {
  it("parses the committed damage TSV: 36 rows, 18 jobs, 2 rungs, 11 columns, U has only step 30", () => {
    const f = parseDamageTsv(damageText);
    expect(f.rows).toHaveLength(36);
    expect(new Set(f.rows.map((r) => r.job)).size).toBe(18);
    expect(new Set(f.rows.map((r) => r.rung))).toEqual(new Set(["P1", "P2"]));
    expect(Object.keys(f.rows[0])).toHaveLength(DAMAGE_COLUMNS.length);
    expect(DAMAGE_COLUMNS.filter((c) => c.startsWith("U_"))).toEqual(["U_30"]);
    expect(f.note).toContain("pilot numbers, not results");
  });

  it("parses the committed calibration TSV: 180 rows, 60 settings, 28 extinct", () => {
    const rows = parseCalibrationTsv(m4Text);
    expect(rows).toHaveLength(180);
    const s = calibrationSummary(rows);
    expect(s.settings).toBe(60);
    expect(s.completeSettings).toBe(60);
    expect(s.extinctRuns).toBe(28);
  });

  it("damage figure: one point per recorded value (252 data-pt marks), 8 panels, S 108 / F 108 / U 36, zeros drawn and counted", () => {
    const f = parseDamageTsv(damageText);
    const h = damageFigureHtml(f);
    expect(count(h, /<svg class="dpanel"/g)).toBe(8);
    expect(count(h, /data-pt="/g)).toBe(36 * 7);
    expect(count(h, /data-pt="S"/g)).toBe(108);
    expect(count(h, /data-pt="F"/g)).toBe(108);
    expect(count(h, /data-pt="U"/g)).toBe(36);
    const zeros = f.rows.reduce((n, r) => n + [r.S_30, r.S_100, r.S_1000, r.F_30, r.F_100, r.F_1000, r.U_30].filter((v) => v === 0).length, 0);
    expect(zeros).toBeGreaterThan(0);
    expect(count(h, /data-v="0"/g)).toBe(zeros);
    // every recorded value appears as a mark, in row order per series
    for (const key of ["S", "F"] as const) for (const s of [30, 100, 1000]) {
      const want = f.rows.map((r) => r[`${key}_${s}` as "S_30"]).sort((a, b) => a - b);
      const got = [...h.matchAll(new RegExp(`data-pt="${key}" data-step="${s}" data-v="(\\d+)"`, "g"))].map((m) => Number(m[1])).sort((a, b) => a - b);
      expect(got).toEqual(want);
    }
  });

  it("damage figure: no interpolation, each S and F line has exactly its 3 recorded vertices and U has no line", () => {
    const h = damageFigureHtml(parseDamageTsv(damageText));
    const lines = [...h.matchAll(/<polyline class="ln ([SF])" points="([^"]*)"/g)];
    expect(lines).toHaveLength(72);
    for (const m of lines) expect(m[2].trim().split(" ")).toHaveLength(3);
    expect(count(h, /class="ln U"/g)).toBe(0);
    expect(count(h, /<polyline class="ln S"/g)).toBe(36);
  });

  it("damage figure: labels present, pilot banner text, no result chip", () => {
    const sec = stage0SectionHtml(damageText, m4Text);
    for (const t of ["steps after the kick, log scale", "damaged blocks, log scale", "U (step 30 only)", "not results", "STAGE0-CLOSED", "9001-9003", "Stage 0 run 1 (pilot, candidate closed)", "never frozen"]) expect(sec).toContain(t);
    expect(STAGE0_BANNER).toContain("Pilot numbers on development seeds 9001-9003, not results.");
    expect(sec).not.toMatch(/RESULT/);
    expect(sec).not.toMatch(/class="chip[^"]*result/i);
    expect(count(sec, /class="dl S"/g)).toBe(8);
    expect(count(sec, /class="dl F"/g)).toBe(8);
    expect(count(sec, /class="dl U"/g)).toBe(8);
  });

  it("calibration figure: 180 seed-run stripes, 3 panels, legend, band named, outcome derived", () => {
    const rows = parseCalibrationTsv(m4Text);
    const h = calibrationFigureHtml(rows);
    expect(count(h, /data-seed-run="/g)).toBe(180);
    expect(count(h, /<svg class="cpanel"/g)).toBe(3);
    expect(count(h, /class="xmark"/g)).toBe(2 * (28 + 1)); // 28 extinct stripes plus the legend swatch
    expect(h).toContain("1 to 50% living (the pick rule's band)");
    expect(h).toContain("none qualifies");
    expect(h).toContain("0 of 60 settings qualify");
    expect(h).toContain("10 of 180 seed runs are inside the living band, and 0 of those also meet the light condition");
    expect(count(h, /class="bandbox"/g)).toBe(10 + 1);
  });

  it("calibration summary agrees with m4-pick-output.md and with an independent recomputation of the pick rule", () => {
    const rows = parseCalibrationTsv(m4Text);
    const pick = readFileSync(join(dir, "m4-pick-output.md"), "utf8");
    expect(pick).toContain("PICK: none qualifies");
    const s = calibrationSummary(rows);
    expect(s.qualifying).toBe(0);
    // independent: group by id prefix
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.id.replace(/-seed\d+$/, ""), [...(by.get(r.id.replace(/-seed\d+$/, "")) ?? []), r]);
    let q = 0;
    for (const g of by.values()) if (g.length === 3 && g.every((r) => r.livingFrac >= 0.01 && r.livingFrac <= 0.5 && r.lightRatio7to0 >= 0.05 && r.lightRatio7to0 <= 0.8)) q++;
    expect(q).toBe(s.qualifying);
    expect(rows.filter(inBand).length).toBe(10);
    expect(rows.filter((r) => inBand(r) && lightOk(r)).length).toBe(0);
    expect(rows.filter((r) => calClass(r) === "extinct")).toHaveLength(28);
    // every row of the pick table is a "no"
    expect(pick).not.toMatch(/\| yes \|/);
  });

  it("accessibility: every svg has role=img and a title; the tables carry every row and every column", () => {
    const sec = stage0SectionHtml(damageText, m4Text);
    const svgs = [...sec.matchAll(/<svg class="(?:dpanel|cpanel)"[^>]*>/g)].map((m) => m[0]);
    expect(svgs).toHaveLength(11);
    for (const s of svgs) { expect(s).toContain('role="img"'); expect(s).toContain("aria-labelledby"); }
    expect(count(sec, /<svg class="(?:dpanel|cpanel)"[^>]*>\s*<title/g)).toBe(11);
    const dt = damageTableHtml(parseDamageTsv(damageText));
    expect(count(dt, /<tr>/g)).toBe(37);
    for (const c of DAMAGE_COLUMNS) expect(dt).toContain(`<th scope="col">${c}</th>`);
    const ct = calibrationTableHtml(parseCalibrationTsv(m4Text));
    expect(count(ct, /<tr>/g)).toBe(181);
    for (const c of CAL_COLUMNS) expect(ct).toContain(`<th scope="col">${c}</th>`);
    expect(count(sec, /<details class="tdetails"><summary>/g)).toBe(2);
  });

  it("deterministic: two builds of the section are identical, and two page builds with the flag are byte-identical", () => {
    expect(stage0SectionHtml(damageText, m4Text)).toBe(stage0SectionHtml(damageText, m4Text));
    const root = mkdtempSync(join(tmpdir(), "regime-s0-"));
    try {
      const a = join(root, "a.html"), b = join(root, "b.html");
      expect(htmlMain(["--synthetic", "--quick", "--stage0-figures", `--out=${a}`], () => {})).toBe(0);
      expect(htmlMain(["--synthetic", "--quick", "--stage0-figures", `--out=${b}`], () => {})).toBe(0);
      expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 120_000);

  it("malformed inputs are refused: wrong header, short row, non-numeric, unknown rung", () => {
    const lines = damageText.split("\n");
    const bad = (mut: (l: string[]) => void) => { const l = [...lines]; mut(l); return l.join("\n"); };
    expect(() => parseDamageTsv(bad((l) => { l[1] = l[1].replace("S_30", "S_31"); }))).toThrow(ReaderError);
    expect(() => parseDamageTsv(bad((l) => { l[2] = l[2].split("\t").slice(0, 10).join("\t"); }))).toThrow(ReaderError);
    expect(() => parseDamageTsv(bad((l) => { l[2] = l[2].replace(/\t(\d+)$/, "\tx$1"); }))).toThrow(ReaderError);
    expect(() => parseDamageTsv(bad((l) => { l[2] = l[2].replace("\tP1\t", "\tP9\t").replace("\tP2\t", "\tP9\t"); }))).toThrow(ReaderError);
    expect(() => parseDamageTsv(bad((l) => { l.shift(); }))).toThrow(ReaderError);
    const m = m4Text.split("\n");
    expect(() => parseCalibrationTsv(m.slice(1).join("\n"))).toThrow(ReaderError);
    expect(() => parseCalibrationTsv([m[0], m[1].split("\t").slice(0, 14).join("\t")].join("\n"))).toThrow(ReaderError);
    const root = mkdtempSync(join(tmpdir(), "regime-s0-"));
    try {
      const out = join(root, "p.html");
      expect(htmlMain(["--synthetic", "--quick", "--stage0-figures", "--stage0-damage=/nonexistent.tsv", `--out=${out}`], () => {})).toBe(2);
      expect(existsSync(out)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 120_000);

  it("rejects negative, nonfinite and out-of-range numbers instead of drawing them", () => {
    const lines = damageText.split("\n");
    const bad = (col: number, v: string) => { const l = [...lines]; const f = l[2].split("\t"); f[col] = v; l[2] = f.join("\t"); return l.join("\n"); };
    expect(() => parseDamageTsv(bad(4, "-1"))).toThrow(/negative/);
    expect(() => parseDamageTsv(bad(4, "9".repeat(400)))).toThrow(/safe integer/);
    expect(() => parseDamageTsv(bad(2, "1.5"))).toThrow(/\[0, 1\]/);
    expect(() => parseDamageTsv(bad(2, "-0.1"))).toThrow(/\[0, 1\]/);
    expect(() => parseDamageTsv(bad(2, "9".repeat(400) + ".5"))).toThrow(ReaderError);
    const m = m4Text.split("\n");
    for (const col of [9, 11]) { const g = m[1].split("\t"); g[col] = "9".repeat(400) + ".5"; expect(() => parseCalibrationTsv([m[0], g.join("\t")].join("\n"))).toThrow(/not finite/); }
    const f = m[1].split("\t"); f[8] = "1.2";
    expect(() => parseCalibrationTsv([m[0], f.join("\t")].join("\n"))).toThrow(/\[0, 1\]/);
  });

  it("calibration grid must be the complete unique 60 x 3 grid: incomplete, duplicate and off-grid rows are refused", () => {
    const rows = parseCalibrationTsv(m4Text);
    expect(() => assertCalibrationGrid(rows)).not.toThrow();
    expect(() => calibrationFigureHtml(rows.slice(1))).toThrow(/incomplete/);
    expect(() => calibrationFigureHtml([...rows.slice(1), rows[1]])).toThrow(/duplicate/);
    expect(() => calibrationFigureHtml([...rows.slice(1), { ...rows[0], mu: 70 }])).toThrow(/off the drawn grid/);
    expect(() => stage0SectionHtml(damageText, m4Text.split("\n").slice(0, -3).join("\n"))).toThrow(ReaderError);
  });

  it("class and pick-rule boundaries: 0.01, 0.5 and 0.85 living; 0.05 and 0.8 light", () => {
    const base = parseCalibrationTsv(m4Text)[0];
    const r = (livingFrac: number, lightRatio7to0 = 0.4, extinctAt: number | null = null) => ({ ...base, livingFrac, lightRatio7to0, extinctAt });
    expect(calClass(r(0.0099))).toBe("under1");
    expect(calClass(r(0.01))).toBe("band");
    expect(calClass(r(0.5))).toBe("band");
    expect(calClass(r(0.5001))).toBe("mid");
    expect(calClass(r(0.8499))).toBe("mid");
    expect(calClass(r(0.85))).toBe("carpet");
    expect(calClass(r(0, 0.4, 100))).toBe("extinct");
    expect(inBand(r(0.01)) && inBand(r(0.5))).toBe(true);
    expect(inBand(r(0.0099)) || inBand(r(0.5001))).toBe(false);
    expect(lightOk(r(0.2, 0.05)) && lightOk(r(0.2, 0.8))).toBe(true);
    expect(lightOk(r(0.2, 0.0499)) || lightOk(r(0.2, 0.8001))).toBe(false);
  });

  it("outcome text and panel descriptions follow the data: a qualifying setting changes both, and the device sentence names both machines", () => {
    const rows = parseCalibrationTsv(m4Text).map((r) => (r.mu === 20 && r.sigma === 8 && r.lightK === 256 ? { ...r, extinctAt: null, livingFrac: 0.2, lightRatio7to0: 0.4 } : r));
    const h = calibrationFigureHtml(rows);
    expect(h).toContain("1 of 60 settings qualify");
    expect(h).not.toContain("0 of 60 settings qualify");
    expect(h).toContain("1 of 20 cells meet the pick rule");
    expect(h).toContain("No cell meets the pick rule");
    expect(h).not.toContain("<strong>none qualifies.</strong>");
    const sec = stage0SectionHtml(damageText, m4Text);
    expect(sec).toContain("2 machines (Apple M1 Max, 79 runs; Apple M3 Pro, 101 runs)");
    expect(sec).not.toContain("one Apple M3 Pro");
    expect(sec).toContain("SHA-256 0bed3086bae784d7cc5ef27fad07285435894cb3ee657b4c874c4147182a3d24; <code>regime-rule-closed.md</code> is that draft plus");
  });

  it("flag handling: --stage0-damage without --stage0-figures and --stage0-figures=VALUE are refused", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(htmlMain(["--synthetic", "--quick", "--stage0-damage=x.tsv", "--out=/nonexistent-dir-xyz/p.html"], () => {})).toBe(2);
      expect(htmlMain(["--synthetic", "--quick", "--stage0-damage", "--stage0-figures", "--out=/nonexistent-dir-xyz/p.html"], () => {})).toBe(2);
      expect(htmlMain(["--synthetic", "--quick", "--stage0-figures=1", "--out=/nonexistent-dir-xyz/p.html"], () => {})).toBe(2);
      expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toContain("needs --stage0-figures");
    } finally { err.mockRestore(); }
  }, 60_000);

  it("deterministic across processes: the section rebuilt in a fresh deno process (the toolchain that builds the page) is byte-identical", () => {
    const here = stage0SectionHtml(damageText, m4Text);
    const script = `import { readFileSync } from "node:fs"; import { stage0SectionHtml } from ${JSON.stringify(join(dir, "regime-stage0-figures.ts"))}; process.stdout.write(stage0SectionHtml(readFileSync(${JSON.stringify(join(dir, "regime-stage0-run1-damage.tsv"))}, "utf8"), readFileSync(${JSON.stringify(join(dir, "m4-results.tsv"))}, "utf8")));`;
    const out = spawnSync("deno", ["eval", "--no-lock", script], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toBe(here);
  }, 60_000);
});
