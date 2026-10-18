import { describe, expect, it } from "vitest";
import type { FamilyEvent, FamilySummary, FamilyView, NextUpItem } from "@bl/metrics";
import { EXTINCT_FOLD, LOG_SHOWN, MAX_ROWS, logWindow, originLine, percentWords, shareWords, statsLine, summaryWords, visibleFamilies } from "../src/family-panel.ts";
import { WOUND_HINT, familyCardRows, rungWords } from "../src/firsts-panel.ts";

// The panels' DOM is drawn in the browser; these are the pure pieces that decide what it says.

const fam = (over: Partial<FamilyView> = {}): FamilyView => ({
  founder: "0:1", name: "Reed", parent: null, parentName: null, founded: 0, unknownDescent: false, status: "living", bodyNow: true,
  cells: 312, bodies: 2, purity: 0.849, share: 0.184, depth: 0, ...over,
});
const ev = (step: number, kind: FamilyEvent["kind"] = "film"): FamilyEvent => ({ step, kind, family: "0:1", name: "Reed", detail: `event ${step}` });

describe("rungWords", () => {
  const base: NextUpItem = { id: "long-body", name: "First long body", value: 2.4, target: 3, unit: "times as long as wide", kind: "best", decimals: 1 };
  it("shows long-body with one decimal and an integer target", () => {
    expect(rungWords(base)).toBe("2.4 of 3 times as long as wide · seen so far");
    expect(rungWords({ ...base, value: 0 })).toBe("0.0 of 3 times as long as wide · seen so far");
    expect(rungWords({ ...base, value: 1234.5 })).toBe("1,234.5 of 3 times as long as wide · seen so far");
  });
  it("keeps whole numbers whole and plural units as before", () => {
    const body: NextUpItem = { id: "body-40", name: "Big body", value: 12, target: 40, unit: "cells", kind: "best" };
    expect(rungWords(body)).toBe("12 of 40 cells · seen so far");
    expect(rungWords({ ...body, value: 0, target: 1 })).toBe("0 of 1 cell · seen so far");
    expect(rungWords({ id: "takeover", name: "x", value: 3, target: 5, unit: "censuses", kind: "now" })).toBe("3 of 5 censuses · now");
  });
  it("says a share as a share, and a rung that needs more than its target so", () => {
    expect(rungWords({ id: "moving-pond", name: "x", value: 40, target: 50, unit: "% of a pond’s body cells", kind: "now" })).toBe("40% of a pond’s body cells, needs 50% · now");
    expect(rungWords({ id: "gene-1", name: "x", value: 30, target: 50, unit: "% of a body’s cells", kind: "now", above: true })).toBe("30% of a body’s cells, needs more than 50% · now");
  });
  it("counts the wound rung in steps and the family rung in steps", () => {
    expect(rungWords({ id: "outlive-wound", name: "x", value: 0, target: 1000, unit: "steps", kind: "now" })).toBe("0 of 1,000 steps · now");
    expect(rungWords({ id: "new-family", name: "x", value: 4800, target: 5000, unit: "steps", kind: "now" })).toBe("4,800 of 5,000 steps · now");
  });
  it("has a hint for the wound rung that names the tool", () => {
    expect(WOUND_HINT).toContain("Wound");
  });
});

describe("family words", () => {
  it("floors purity and shows a dash for none", () => {
    expect(percentWords(0.849)).toBe("84%");
    expect(percentWords(1)).toBe("100%");
    expect(percentWords(0.999)).toBe("99%");
    expect(percentWords(0)).toBe("0%");
    expect(percentWords(null)).toBe("—");
  });
  it("shows a small share as under one percent, not as nothing", () => {
    expect(shareWords(0.004, 12)).toBe("<1%");
    expect(shareWords(0, 0)).toBe("0%");
    expect(shareWords(0.184, 312)).toBe("18%");
  });
  it("writes the stats and origin lines", () => {
    expect(statsLine(fam())).toBe("312 cells · 18% of the jar · 2 bodies · purity 84%");
    expect(statsLine(fam({ cells: 1, bodies: 1, share: 0.2, purity: 1 }))).toBe("1 cell · 20% of the jar · 1 body · purity 100%");
    expect(statsLine(fam({ bodies: 0, purity: null, status: "film" }))).toBe("312 cells · 18% of the jar · 0 bodies · purity —");
    expect(originLine(fam({ founded: 12000 }))).toBe("founded t=12,000 · a starting family");
    expect(originLine(fam({ unknownDescent: true }))).toBe("founded t=0 · of unknown descent");
    expect(originLine(fam({ parent: "0:1", parentName: "Reed", founded: 5000 }))).toBe("founded t=5,000 · from Reed");
  });
  it("sums the counts", () => {
    const s: FamilySummary = { rules: "families-v1", watchedFrom: 0, step: 100, named: 5, starting: 3, split: 2, living: 3, film: 1, extinct: 1 };
    expect(summaryWords(s)).toBe("5 named · 3 living · 1 gone to film · 1 extinct");
    expect(summaryWords({ ...s, named: 0 })).toBe("No families named yet");
  });
});

describe("the card's families rows", () => {
  it("says none yet before the tree has named a family", () => {
    expect(familyCardRows({ named: 0, starting: 0, split: 0, living: 0, film: 0, extinct: 0 })).toEqual([["Families named", "None yet"]]);
  });
  it("gives named (starting and split), living, gone to film and extinct", () => {
    expect(familyCardRows({ named: 5, starting: 3, split: 2, living: 3, film: 1, extinct: 1 })).toEqual([
      ["Families named", "5 (3 starting, 2 split off)"], ["Living", "3"], ["Gone to film", "1"], ["Extinct", "1"],
    ]);
    expect(familyCardRows({ named: 4, starting: 3, split: 0, living: 4, film: 0, extinct: 0 })[0]).toEqual(["Families named", "4 (3 starting, 1 found later)"]);
  });
});

describe("what the tree draws", () => {
  const many = (extinct: number, living = 2) => [
    ...Array.from({ length: living }, (_, i) => fam({ founder: `0:${i}`, name: `L${i}` })),
    ...Array.from({ length: extinct }, (_, i) => fam({ founder: `1:${i}`, name: `E${i}`, status: "extinct", cells: 0, bodies: 0, purity: null, share: 0 })),
  ];
  it("shows every family when there are few extinct ones", () => {
    const v = visibleFamilies(many(EXTINCT_FOLD), false);
    expect(v.rows).toHaveLength(2 + EXTINCT_FOLD);
    expect(v.folded).toBe(0);
  });
  it("folds extinct families behind the toggle when there are many, and opens them again", () => {
    const folded = visibleFamilies(many(EXTINCT_FOLD + 1), false);
    expect(folded.rows.map((f) => f.name)).toEqual(["L0", "L1"]);
    expect(folded.folded).toBe(EXTINCT_FOLD + 1);
    expect(folded.extinct).toBe(EXTINCT_FOLD + 1);
    const open = visibleFamilies(many(EXTINCT_FOLD + 1), true);
    expect(open.rows).toHaveLength(2 + EXTINCT_FOLD + 1);
    expect(open.folded).toBe(0);
  });
  it("keeps tree order and says how many rows it cut", () => {
    const v = visibleFamilies(many(0, MAX_ROWS + 7), false);
    expect(v.rows).toHaveLength(MAX_ROWS);
    expect(v.rows[0].name).toBe("L0");
    expect(v.cut).toBe(7);
  });
  it("shows the log newest first, the last eight, and all on request", () => {
    const events = Array.from({ length: 12 }, (_, i) => ev((i + 1) * 100));
    const few = logWindow(events, false);
    expect(few.rows).toHaveLength(LOG_SHOWN);
    expect(few.rows[0].step).toBe(1200);
    expect(few.rows[LOG_SHOWN - 1].step).toBe(500);
    expect(few.hidden).toBe(12 - LOG_SHOWN);
    const all = logWindow(events, true);
    expect(all.rows).toHaveLength(12);
    expect(all.rows[11].step).toBe(100);
    expect(all.hidden).toBe(0);
    expect(logWindow([], false)).toEqual({ rows: [], hidden: 0 });
    expect(events[0].step).toBe(100);
  });
});
