// The breeder call's tied-at-zero line (apps/lab/src/rank-labels.ts `tiedAtZero`; docs/pond-keeper-v3-2026-10-22.md, section 3): when the
// score in force is 0 for every occupied pond, the panel says the score cannot tell the ponds apart and the rule falls to the heaviest.
// A pure function of the waiting cycle's own message, so a hand-built `terms` is the whole input.
import { describe, expect, it } from "vitest";
import { POND_TERMS, worstRanks, type PondScore, type PondTerm } from "@bl/schema";
import { tiedAtZero } from "../src/rank-labels.ts";

type Waiting = Parameters<typeof tiedAtZero>[0];
const PONDS = 6;
/** A waiting breed cycle over six ponds; `terms` fills in the measures, anything left out is flat zero. */
function waiting(terms: Partial<Record<PondTerm, number[]>>, extra: Partial<Waiting> = {}): Waiting {
  const flat = () => new Array<number>(PONDS).fill(0);
  return {
    arm: "breed", score: "drive+seed+body", ruleScore: null,
    terms: Object.fromEntries(POND_TERMS.map((t) => [t, terms[t] ?? flat()])) as Record<PondTerm, number[]>,
    ...extra,
  };
}
/** Ponds 0 to 3 hold something, 4 and 5 are empty. */
const MASS = [900, 700, 500, 300, 0, 0];

describe("tiedAtZero", () => {
  it("names the measure every occupied pond ties at the bottom of, and not the ones that do tell the ponds apart", () => {
    // Nothing moves (drive is flat), so each pond ties for last on drive and scores 0, however the seed packets and bodies differ.
    const a = waiting({ mass: MASS, drive: [0, 0, 0, 0, 0, 0], seed: [5, 9, 2, 7, 0, 0], body: [40, 10, 90, 20, 0, 0] });
    expect(worstRanks(["drive", "seed", "body"].map((t) => a.terms[t as PondTerm])).slice(0, 4)).toEqual([0, 0, 0, 0]);
    const line = tiedAtZero(a)!;
    expect(line).toBe("The occupied ponds are all tied on moving mass, so the rule’s score cannot tell them apart and the rule picks the heaviest ponds instead. Another choice under “The rule breeds for” may separate them.");
    // Only the flat measure is named: the two that separate the ponds are not.
    expect(line).not.toMatch(/seed packet|body size/);
  });

  it("lists every flat measure when more than one ties, with an 'and'", () => {
    const a = waiting({ mass: MASS, drive: [0, 0, 0, 0, 0, 0], seed: [0, 0, 0, 0, 0, 0], body: [40, 10, 90, 20, 0, 0] });
    expect(tiedAtZero(a)).toMatch(/^The occupied ponds are all tied on moving mass and seed packet, so /);
  });

  it("says each pond is at the bottom of something when no one measure is flat", () => {
    // Pond 0 is last on drive, pond 1 on seed, ponds 2 and 3 (tied) on body, and each is high on the rest: all four score 0, yet no measure is flat.
    const a = waiting({ mass: MASS, drive: [0, 5, 5, 5, 0, 0], seed: [5, 0, 5, 5, 0, 0], body: [5, 5, 0, 0, 0, 0] });
    expect(worstRanks(["drive", "seed", "body"].map((t) => a.terms[t as PondTerm])).slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(tiedAtZero(a)).toMatch(/^Each occupied pond is at the bottom of at least one of moving mass, seed packet and body size, so the rule’s score cannot tell them apart/);
  });

  it("uses the player's words: no rank talk, no 'pressure dial', no 'scores above 0'", () => {
    const a = waiting({ mass: MASS, drive: [0, 0, 0, 0, 0, 0], seed: [5, 9, 2, 7, 0, 0], body: [40, 10, 90, 20, 0, 0] });
    expect(tiedAtZero(a)).not.toMatch(/pressure|above 0|worst rank|scores/i);
  });

  it("is null when even one occupied pond scores above 0", () => {
    // Pond 1 is strictly above pond 0 on all three, so it scores 1 (one pond below it on every measure).
    const a = waiting({ mass: MASS, drive: [0, 3, 3, 0, 0, 0], seed: [1, 2, 2, 1, 0, 0], body: [5, 6, 6, 5, 0, 0] });
    expect(worstRanks(["drive", "seed", "body"].map((t) => a.terms[t as PondTerm])).some((v, p) => MASS[p] > 0 && v > 0)).toBe(true);
    expect(tiedAtZero(a)).toBeNull();
  });

  it("reads a single-measure score by its own values: all zero ties, any positive pond does not", () => {
    const zero = waiting({ mass: MASS, body: [0, 0, 0, 0, 0, 0] }, { score: "body" });
    expect(tiedAtZero(zero)).toMatch(/^The occupied ponds are all tied on body size, so the rule’s score cannot tell them apart/);
    const some = waiting({ mass: MASS, body: [0, 0, 12, 0, 0, 0] }, { score: "body" });
    expect(tiedAtZero(some)).toBeNull();
  });

  it("uses the score in force: the dial's setting over the world's own, and none at all gives null", () => {
    // The world's own score ties at zero (no drive); the dial has moved to body size, which tells the ponds apart.
    const terms = { mass: MASS, drive: [0, 0, 0, 0, 0, 0], body: [40, 10, 90, 20, 0, 0] };
    expect(tiedAtZero(waiting(terms, { score: "drive+body", ruleScore: "body" }))).toBeNull();
    expect(tiedAtZero(waiting(terms, { score: "body", ruleScore: "drive" }))).toMatch(/tied on moving mass, so/);
    expect(tiedAtZero(waiting(terms, { score: null, ruleScore: null }))).toBeNull();
  });

  it("says nothing for an arm other than breed, whatever the values", () => {
    for (const arm of ["scaf", "rand", "cont", "nat"]) expect(tiedAtZero(waiting({ mass: MASS }, { arm })), arm).toBeNull();
  });

  it("does not count empty ponds as occupied: they score 0 without being a tie, and a world with no occupied pond has nothing to tell apart", () => {
    // Ponds 4 and 5 are empty and their measures are 0; the occupied ones differ, so the empty zeros are no reason to speak.
    expect(tiedAtZero(waiting({ mass: MASS, drive: [4, 3, 2, 1, 0, 0] }, { score: "drive" }))).toBeNull();
    // An empty pond's own value is not looked at: all the occupied ponds are at 0, so the line still speaks.
    expect(tiedAtZero(waiting({ mass: MASS, drive: [0, 0, 0, 0, 7, 0] }, { score: "drive" }))).not.toBeNull();
    const none: PondScore = "drive";
    expect(tiedAtZero(waiting({ mass: [0, 0, 0, 0, 0, 0] }, { score: none }))).toBeNull();
  });
});
