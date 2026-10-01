import { describe, expect, it } from "vitest";
import { checkedRootHex, countSubjects, subjectIndex, SUBJECT_IDS, wholePlanting } from "../lib/fx-root.ts";

describe("subjectIndex", () => {
  it("maps ids to fixed positions", () => {
    expect(subjectIndex("founder-0")).toBe(0);
    expect(subjectIndex("founder-11")).toBe(11);
    expect(subjectIndex("S1")).toBe(12);
    expect(subjectIndex("S5")).toBe(15);
  });
  it("throws on an unknown id", () => {
    expect(() => subjectIndex("S3")).toThrow(/unknown subject id/);
  });
});

describe("countSubjects", () => {
  const row = (subjectId: string, seed: number, originates = true) => ({ subjectId, seed, originates });
  const by = (rs: ReturnType<typeof countSubjects>, id: string) => rs.find((r) => r.id === id)!;

  it("counts a subject with originating candidates on three distinct seeds", () => {
    const r = countSubjects([row("S1", 1), row("S1", 2), row("S1", 3)]);
    expect(by(r, "S1")).toEqual({ id: "S1", runsOriginating: 3, counts: true });
  });
  it("collapses candidates from the same seed", () => {
    const r = countSubjects([row("S1", 1), row("S1", 1), row("S1", 1)]);
    expect(by(r, "S1")).toEqual({ id: "S1", runsOriginating: 1, counts: false });
  });
  it("ignores non-originating rows", () => {
    const r = countSubjects([row("S2", 1), row("S2", 2), row("S2", 3, false), row("S2", 4, false)]);
    expect(by(r, "S2").runsOriginating).toBe(2);
    expect(by(r, "S2").counts).toBe(false);
  });
  it("reports every subject id", () => {
    const r = countSubjects([]);
    expect(r.map((x) => x.id)).toEqual([...SUBJECT_IDS]);
    expect(r).toHaveLength(16);
    expect(r.every((x) => x.runsOriginating === 0 && !x.counts)).toBe(true);
  });
});

describe("wholePlanting", () => {
  const planting = (tiles: number, slots: number) => ({
    tiles: Array.from({ length: tiles }, (_, tile) => ({ tile, lineages: Array.from({ length: slots }, () => ({})) })),
  });
  it("accepts 16 tiles with the expected slots", () => {
    expect(wholePlanting(planting(16, 2), 2)).toBe(true);
  });
  it("rejects a missing tile", () => {
    expect(wholePlanting(planting(15, 2), 2)).toBe(false);
  });
  it("rejects a tile with a missing slot", () => {
    const p = planting(16, 2);
    p.tiles[7].lineages = [{}];
    expect(wholePlanting(p, 2)).toBe(false);
  });
  it("rejects duplicate tile numbers", () => {
    const p = planting(16, 2);
    p.tiles[15].tile = 0;
    expect(wholePlanting(p, 2)).toBe(false);
  });
  it("rejects undefined", () => {
    expect(wholePlanting(undefined, 2)).toBe(false);
  });
});

describe("checkedRootHex", () => {
  const c = { descendant: "5001:7", hex: "dd" };
  it("returns the root genome of a founder-lineage root that differs from the candidate", () => {
    expect(checkedRootHex(c, "0:12", "ff", "run")).toBe("ff");
  });
  it("refuses a parent walk that ends at a non-founder lineage (a missing birth record)", () => {
    expect(() => checkedRootHex(c, "5001:7", "dd", "run")).toThrow(/run: clade root 5001:7 of candidate descendant 5001:7 is not a founder lineage/);
    expect(() => checkedRootHex(c, "301:4", "ff", "run")).toThrow(/not a founder lineage/);
    expect(() => checkedRootHex(c, "0", "ff", "run")).toThrow(/not a founder lineage/);
  });
  it("refuses a missing root genome", () => {
    expect(() => checkedRootHex(c, "0:12", undefined, "run")).toThrow(/root genome missing for lineage 0:12/);
  });
  it("refuses a root whose genome equals the candidate's (the garden would compare a genome with itself)", () => {
    expect(() => checkedRootHex({ descendant: "0:3", hex: "aa" }, "0:3", "aa", "run")).toThrow(/has the genome of its clade root 0:3/);
    expect(() => checkedRootHex(c, "0:12", "dd", "run")).toThrow(/has the genome of its clade root 0:12/);
  });
});
