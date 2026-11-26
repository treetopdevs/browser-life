import { expect, it } from "vitest";
import { POND_TERMS, type PondTerm } from "@bl/schema";
import type { PondAwaitMsg } from "../src/protocol.ts";
import { rankOrder, rankValues } from "../src/pond-ranking.ts";

it("ranks shell shares, excludes massless ponds, and breaks equal shares by mass then index without changing rule donors", () => {
  const a: PondAwaitMsg = {
    type: "pondAwait", world: 1, step: 20, cycle: 1, arm: "breed", score: "mass", ruleScore: "mass", revision: 1, kept: null,
    suggested: [0], terms: Object.fromEntries(POND_TERMS.map(t => [t, t === "mass" ? [100, 20, 30, 30, 0, 10] : [0, 0, 0, 0, 0, 0]])) as Record<PondTerm, number[]>,
    shells: [{ wearing: 10, living: 100 }, { wearing: 1, living: 2 }, { wearing: 3, living: 6 }, { wearing: 2, living: 4 }, { wearing: 1, living: 1 }, { wearing: 0, living: 0 }],
  };
  const before = structuredClone(a);
  expect(rankValues(a, "shell")).toEqual([10, 50, 50, 50, 100, 0]);
  expect(rankOrder(a, "shell")).toEqual([2, 3, 1, 0, 5]);
  expect(rankOrder(a, "score")).toEqual([0, 2, 3, 1, 5]);
  expect(a).toEqual(before);
  a.shells = a.shells!.map(() => ({ wearing: 0, living: 10 }));
  expect(rankOrder(a, "shell")).toEqual(rankOrder(a, "mass"));
  // A no-shell survey, and an older runtime message without the display field, both stay finite and use the existing ties.
  a.shells = null;
  expect(rankValues(a, "shell")).toEqual([0, 0, 0, 0, 0, 0]);
  expect(rankOrder(a, "shell")).toEqual([0, 2, 3, 1, 5]);
  Reflect.deleteProperty(a, "shells");
  expect(rankValues(a, "shell")).toEqual([0, 0, 0, 0, 0, 0]);
  expect(rankOrder(a, "shell")).toEqual([0, 2, 3, 1, 5]);
});
