import { describe, expect, it } from "vitest";
import { ARMS, S, STEPS, interventionsMatch, jobProblems, nearestBiomass, planJobs, runArgs, type NudgeCentres } from "../lib/bell-v1-jobs.ts";

const nudges: NudgeCentres = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, { nudge: { x: 127, y: 128 }, nudge2: { x: 64, y: 60 } }]));

describe("nearestBiomass", () => {
  it("finds the nearest positive cell, wrapping both axes", () => {
    const W = 8, H = 6, b = new Array(W * H).fill(0);
    b[5 * W + 7] = 3; // (7, 5): from (0, 0) it is dx 1, dy 1 across the wrap
    b[2 * W + 2] = 1; // (2, 2): d2 8
    expect(nearestBiomass(b, W, H, 0, 0)).toEqual({ x: 7, y: 5, d2: 2 });
  });
  it("breaks ties by the smaller y, then the smaller x", () => {
    const W = 9, H = 9, b = new Array(W * H).fill(0);
    for (const [x, y] of [[5, 4], [3, 4], [4, 5], [4, 3]]) b[y * W + x] = 1;
    expect(nearestBiomass(b, W, H, 4, 4)).toEqual({ x: 4, y: 3, d2: 1 });
    b[3 * W + 4] = 0;
    expect(nearestBiomass(b, W, H, 4, 4)).toEqual({ x: 3, y: 4, d2: 1 });
  });
  it("returns the centre itself when it has biomass, null when no cell does, and checks the size", () => {
    const b = [0, 0, 0, 5];
    expect(nearestBiomass(b, 2, 2, 1, 1)).toEqual({ x: 1, y: 1, d2: 0 });
    expect(nearestBiomass([0, 0, 0, 0], 2, 2, 0, 0)).toBeNull();
    expect(() => nearestBiomass([1, 2, 3], 2, 2, 0, 0)).toThrow(/3 cells/);
  });
});

describe("the job list", () => {
  const jobs = planJobs(nudges);
  it("is 70 nulls (seeds 2002-2071) and 50 twins (5 arms x seeds 1-10), all destinations distinct and names valid", () => {
    expect(jobs.length).toBe(120);
    const nulls = jobs.filter((j) => j.part === "A");
    expect(nulls.map((j) => j.seed)).toEqual(Array.from({ length: 70 }, (_, i) => 2002 + i));
    expect(nulls.every((j) => j.condition === "neutral" && j.intervention.length === 0 && j.expected === null)).toBe(true);
    const twins = jobs.filter((j) => j.part === "B");
    expect(twins.length).toBe(50);
    for (const arm of ARMS) expect(twins.filter((j) => j.arm === arm).map((j) => j.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(jobProblems(jobs)).toEqual([]);
    expect(new Set(jobs.map((j) => j.rel)).size).toBe(120);
  });
  it("schedules each arm's intervention at S", () => {
    const by = (arm: string, seed = 3) => jobs.find((j) => j.arm === arm && j.seed === seed)!;
    expect(by("nudge").intervention).toEqual(["--lesion", `${S}:127,128,1`]);
    expect(by("nudge2").intervention).toEqual(["--lesion", `${S}:64,60,1`]);
    expect(by("l64").intervention).toEqual(["--lesion", `${S}:128,128,64`]);
    expect(by("l96").intervention).toEqual(["--lesion", `${S}:128,128,96`]);
    expect(by("f").intervention).toEqual(["--feed", `${S}:128,128,32,64`]);
    expect(by("f").rel).toBe("bell-v1-twins-f/gradient-m3/treatment/seed-3");
  });
  it("builds the run.ts arguments with the seed, steps, observers and an absolute out", () => {
    const j = jobs.find((x) => x.id === "twin-l96-7")!;
    expect(runArgs(j, "/r")).toEqual(["--experiment", "bell-v1-twins-l96", "--preset", "gradient-m3", "--conditions", "treatment", "--seeds", "7", "--steps", String(STEPS), "--census", "100", "--deep", "10", "--lineage-obs", "--lesion", `${S}:128,128,96`, "--out", "/r"]);
  });
  it("refuses a missing nudge centre, and flags duplicates and bad names", () => {
    const partial = { ...nudges };
    delete partial[4];
    expect(() => planJobs(partial)).toThrow(/nudge centre for seed 4/);
    const j = jobs[0];
    expect(jobProblems([j, { ...j }])).toEqual(expect.arrayContaining([expect.stringMatching(/duplicate job id/), expect.stringMatching(/share/)]));
    expect(jobProblems([{ ...j, experiment: "Bell-V1" }])).toEqual([expect.stringMatching(/validateSpec/)]);
  });
});

describe("interventionsMatch", () => {
  const jobs = planJobs(nudges);
  const f = jobs.find((j) => j.id === "twin-f-1")!, n = jobs.find((j) => j.id === "null-2002")!, l = jobs.find((j) => j.id === "twin-nudge-1")!;
  it("needs exactly the scheduled entry", () => {
    expect(interventionsMatch(f, [{ step: S, kind: "feed", x: 128, y: 128, r: 32, amount: 64, matter: 205376 }])).toBe(true);
    expect(interventionsMatch(f, [{ step: S, kind: "feed", x: 128, y: 128, r: 32, amount: 32, matter: 1 }])).toBe(false);
    expect(interventionsMatch(l, [{ step: S, kind: "lesion", x: 127, y: 128, r: 1 }])).toBe(true);
    expect(interventionsMatch(l, [{ step: S, kind: "lesion", x: 127, y: 128, r: 0 }])).toBe(false);
    expect(interventionsMatch(l, [])).toBe(false);
    expect(interventionsMatch(l, [{ step: S, kind: "lesion", x: 127, y: 128, r: 1 }, { step: S, kind: "lesion", x: 127, y: 128, r: 1 }])).toBe(false);
    expect(interventionsMatch(n, [])).toBe(true);
    expect(interventionsMatch(n, [{ step: 1 }])).toBe(false);
  });
});
