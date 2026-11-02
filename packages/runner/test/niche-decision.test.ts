import { describe, expect, it } from "vitest";
import { canonicalJSON } from "@bl/schema";
import { decideCandidates, medianTimes2, panelVerdict, ratLe, signTestP, type CandidateInput } from "../src/niche/decision.ts";

const eight = (k: number, size = 100): number[] => Array.from({ length: 8 }, (_, i) => (i < k ? size : i % 2 ? 0 : -size));
const cand = (id: string, over: Partial<CandidateInput> & { k?: number | number[] } = {}): CandidateInput => {
  const ks = Array.isArray(over.k) ? over.k : [over.k ?? 8, over.k ?? 8, over.k ?? 8, over.k ?? 8];
  const { k: _k, ...rest } = over;
  return {
    id,
    status: "ok",
    invalidReasons: [],
    contrasts: { builder: eight(ks[0]), poly: eight(ks[1]), space: eight(ks[2]), inoc: eight(ks[3]), spaceP: eight(0), spaceNP: eight(0) },
    delta: 10,
    survivedBlocks: 8,
    blocks: 8,
    polymerAdequate: true,
    expectedBlocks: 8,
    ...rest,
  };
};

describe("niche decision", () => {
  it("exact sign-test p-values for k = 6, 7, 8 of 8 match hand enumeration", () => {
    expect(signTestP(8, 8)).toEqual({ num: 1, den: 256 });
    expect(signTestP(8, 7)).toEqual({ num: 9, den: 256 });
    expect(signTestP(8, 6)).toEqual({ num: 37, den: 256 });
    expect(signTestP(8, 0)).toEqual({ num: 256, den: 256 });
  });

  it("zeros count as non-positive", () => {
    const r = decideCandidates([cand("a", { contrasts: { builder: Array(8).fill(0), poly: eight(8), space: eight(8), inoc: eight(8), spaceP: eight(0), spaceNP: eight(0) } })], true);
    expect(r[0].gating.builder.k).toBe(0);
    expect(r[0].label).toBe("unsupported-within-tested-domain");
  });

  it("median needs the two middle values summed", () => {
    expect(medianTimes2([1, 2, 3, 10])).toBe(5);
    expect(medianTimes2([1, 2, 3])).toBe(4);
  });

  it("intersection-union takes the max p of the four contrasts", () => {
    const r = decideCandidates([cand("a", { k: [8, 8, 8, 7] })], true);
    expect(r[0].pCand).toEqual({ num: 9, den: 256 });
  });

  it("Holm across 3 candidates: k=8 passes the first rank, k=7 fails the first two thresholds (1/60, 1/40) and 9/256 > 1/20 is false", () => {
    expect(ratLe({ num: 1, den: 256 }, { num: 1, den: 60 })).toBe(true);
    expect(ratLe({ num: 9, den: 256 }, { num: 1, den: 60 })).toBe(false);
    expect(ratLe({ num: 9, den: 256 }, { num: 1, den: 40 })).toBe(false);
    expect(ratLe({ num: 9, den: 256 }, { num: 1, den: 20 })).toBe(true);
    const r = decideCandidates([cand("a", { k: 8 }), cand("b", { k: 7 }), cand("c", { k: 7 })], true);
    expect(r.map((x) => x.label)).toEqual(["supported", "unsupported-within-tested-domain", "unsupported-within-tested-domain"]);
    expect(r[0].holmThreshold).toEqual({ num: 1, den: 60 });
    // Holm stops at the first failure: b fails 1/40, so c is not rejected either although 9/256 <= 1/20.
    expect(r[2].holmRejected).toBe(false);
  });

  it("a single candidate is tested at 1/20, so k=7 supports it and k=6 does not", () => {
    expect(decideCandidates([cand("a", { k: 7 })], true)[0].label).toBe("supported");
    expect(decideCandidates([cand("a", { k: 6 })], true)[0].label).toBe("unsupported-within-tested-domain");
  });

  it("supported only when all four contrasts, delta and survival pass", () => {
    expect(decideCandidates([cand("a")], true)[0].label).toBe("supported");
    expect(decideCandidates([cand("a", { delta: 1000 })], true)[0].label).toBe("unsupported-within-tested-domain");
    expect(decideCandidates([cand("a", { survivedBlocks: 6 })], true)[0].label).toBe("unsupported-within-tested-domain");
    expect(decideCandidates([cand("a", { k: [8, 8, 5, 8] })], true)[0].label).toBe("unsupported-within-tested-domain");
  });

  it("null field gives unsupported", () => {
    const z = Array(8).fill(0);
    const c = cand("a", { contrasts: { builder: z, poly: z, space: z, inoc: z, spaceP: z, spaceNP: z } });
    expect(decideCandidates([c], true)[0].label).toBe("unsupported-within-tested-domain");
  });

  it("adequacy failure gives unsupported-measurement, not unsupported", () => {
    expect(decideCandidates([cand("a")], false)[0].label).toBe("unsupported-measurement");
    expect(decideCandidates([cand("a", { polymerAdequate: false })], true)[0].label).toBe("unsupported-measurement");
  });

  it("an incomplete candidate is invalid-or-incomplete and never dropped from Holm", () => {
    const r = decideCandidates([cand("a", { blocks: 7 }), cand("b", { k: 8 })], true);
    expect(r[0].label).toBe("invalid-or-incomplete");
    expect(r[1].holmThreshold).toEqual({ num: 1, den: 40 });
  });

  it("mechanism text comes from the attribution reconstructions only", () => {
    const base = cand("a");
    const pOnly = { ...base, contrasts: { ...base.contrasts, spaceP: eight(8), spaceNP: eight(0) } };
    expect(decideCandidates([pOnly], true)[0].mechanism).toBe("polymer-arrangement-attributed");
    const npOnly = { ...base, contrasts: { ...base.contrasts, spaceP: eight(0), spaceNP: eight(8) } };
    expect(decideCandidates([npOnly], true)[0].mechanism).toBe("non-polymer field pattern");
    expect(decideCandidates([base], true)[0].mechanism).toBe("combined conditioned field");
  });

  it("panel verdict is not negative when a candidate is invalid or measurement-limited", () => {
    const neg = decideCandidates([cand("a", { k: 0 }), cand("b", { k: 0 })], true);
    expect(panelVerdict(neg).verdict).toBe("no-causal-benefit-detected");
    const mixed = decideCandidates([cand("a", { k: 0 }), cand("b", { blocks: 6 })], true);
    const p = panelVerdict(mixed);
    expect(p.verdict).toBe("invalid-or-incomplete");
    expect(p.negative).toEqual(["a"]);
    expect(p.unusable).toEqual(["b"]);
    const sup = panelVerdict(decideCandidates([cand("a"), cand("b", { k: 0 })], true));
    expect(sup.verdict).toBe("causal-benefit-detected");
  });

  it("not-run candidates are reported as not run and excluded from the Holm count", () => {
    const r = decideCandidates([cand("a"), cand("b", { status: "not-run" })], true);
    expect(r[1].label).toBe("not-run");
    expect(r[0].holmThreshold).toEqual({ num: 1, den: 20 });
    expect(panelVerdict(r).text).toContain("Not run");
  });

  it("no floats in sealed payloads", () => {
    const r = decideCandidates([cand("a"), cand("b", { k: 7 })], true);
    expect(() => canonicalJSON({ r, p: panelVerdict(r) })).not.toThrow();
  });
});
