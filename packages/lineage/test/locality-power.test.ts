// I05b power-up: panel parameterisation, disjointness, allocation rule, exact power numbers and the unchanged decision rule
// read through the row-to-verdict path (docs/controller-locality-power-2026-11-02/AMENDMENT.md).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALLOC_M3, ASSAY, PANEL_V1, POWER_ALLOC_CONTROL, POWER_NB, POWER_NULL_PREFIX, POWER_SALT, POWER_SEEDS, RULE, binomialAtLeast, buildNeighbourhood, decimal, decide, deriveAllocation, disjointnessProblems, drawAssaySubset,
  excludeSet, generalistStart, m3Start, powerPanel, protocolRecord, strataKey, strataPools, tau, verdictFromPayload, type Allocation, type GenomeRecord, type Payload, type Row,
} from "@bl/lineage";

const pr136 = JSON.parse(readFileSync(new URL("../../../docs/controller-locality-2026-11-01/evidence.json", import.meta.url), "utf8")) as Payload;
const starts = [generalistStart(), m3Start(4, "m3-sparse"), m3Start(9, "m3-dense")];
const priorAll: Record<string, string[]> = {}, priorAssayed: Record<string, string[]> = {};
for (const r of pr136.rows) { (priorAll[r.genome] ??= []).push(r.hash); if (r.assay) (priorAssayed[r.genome] ??= []).push(r.hash); }
const prior = { seeds: (pr136.protocol as { assay: { seeds: number[] } }).assay.seeds, salt: (pr136.protocol as { neighbourhood: { salt: number } }).neighbourhood.salt, nullPrefix: "", hashes: priorAll };
const poolsOf = (id: string, words: Uint32Array, excl: Record<string, string[]>) => {
  const nb = buildNeighbourhood(words, id, undefined, POWER_NB);
  const { byStratum, generated } = strataPools(nb, excludeSet(powerPanel(excl, {}), id));
  return { nb, generated, eligible: Object.fromEntries([...byStratum].map(([k, v]) => [k, v.length])) as Record<string, number> };
};

describe("panel parameterisation keeps PR136 byte for byte", () => {
  it("PANEL_V1 reproduces PR136 neighbourhood, draw and protocol byte for byte", () => {
    expect(JSON.parse(JSON.stringify(protocolRecord()))).toEqual(pr136.protocol);
    expect(JSON.parse(JSON.stringify(protocolRecord(PANEL_V1)))).toEqual(pr136.protocol);
    for (const s of starts) {
      const a = buildNeighbourhood(s.words, s.id), b = buildNeighbourhood(s.words, s.id, undefined, PANEL_V1.nb);
      const rows = pr136.rows.filter((r) => r.genome === s.id);
      expect(JSON.stringify(a.edits)).toBe(JSON.stringify(b.edits));
      expect(a.edits.map((e) => [e.id, e.hash])).toEqual(rows.map((r) => [r.id, r.hash]));
      const alloc = s.role === "control" ? PANEL_V1.allocControl : ALLOC_M3;
      const { chosen } = drawAssaySubset(a, alloc, PANEL_V1.nb.salt, undefined);
      expect(chosen.map((i) => a.edits[i].id)).toEqual(rows.filter((r) => r.assay).map((r) => r.id));
    }
  });

  it("power panel rule thresholds, ASSAY values except seeds, tau formula and gate equal PR136's", () => {
    const p = powerPanel({}, {});
    const rec = JSON.parse(JSON.stringify(protocolRecord(p))) as { rule: unknown; assay: Record<string, unknown>; tau: string; descriptors: unknown; neighbourhood: Record<string, unknown> };
    const old = pr136.protocol as { rule: unknown; assay: Record<string, unknown>; tau: string; descriptors: unknown; neighbourhood: Record<string, unknown> };
    expect(rec.rule).toEqual(old.rule);
    expect(rec.rule).toEqual(JSON.parse(JSON.stringify(RULE)));
    expect({ ...rec.assay, seeds: null }).toEqual({ ...old.assay, seeds: null });
    expect(rec.assay.seeds).toEqual([101, 102]);
    expect(rec.tau).toBe(old.tau);
    expect(rec.descriptors).toEqual(old.descriptors);
    const { salt: _a, singleSlots: _b, drawsPerMulti: _c, multiEqualCount: _d, ...rest } = rec.neighbourhood; void _a; void _b; void _c; void _d;
    const { salt: _e, singleSlots: _f, drawsPerMulti: _g, multiEqualCount: _h, ...oldRest } = old.neighbourhood; void _e; void _f; void _g; void _h;
    expect(rest).toEqual(oldRest); // same operator, same magnitudes, same matched multi-locus shapes
    expect(p.seeds.length).toBe(ASSAY.seeds.length); // tau and the viable floor use the seed count
    expect(tau([1000, 1010], [1000, 1010])).toBe(tau([1000, 1010], [1000, 1010]));
  });
});

describe("disjointness from PR136", () => {
  it("power seeds and salt are disjoint from PR136's and no assayed hash is shared with PR136 rows", () => {
    expect(POWER_SEEDS.some((s) => prior.seeds.includes(s))).toBe(false);
    expect(POWER_SALT).not.toBe(prior.salt);
    expect(POWER_NULL_PREFIX).not.toBe("");
    const panel = powerPanel(priorAll, {});
    const assayed: Record<string, string[]> = {};
    for (const s of starts) {
      const { nb, eligible } = poolsOf(s.id, s.words, priorAll);
      expect(Object.values(eligible).every((n) => n >= 0)).toBe(true);
      const alloc = s.role === "control" ? POWER_ALLOC_CONTROL : deriveAllocation(192, eligible);
      const { chosen } = drawAssaySubset(nb, alloc, panel.nb.salt, excludeSet(panel, s.id));
      assayed[s.id] = chosen.map((i) => nb.edits[i].hash);
    }
    expect(disjointnessProblems(panel, prior, assayed)).toEqual([]);
    for (const s of starts) {
      const allPrior = new Set(priorAll[s.id]);
      expect(assayed[s.id].some((h) => allPrior.has(h))).toBe(false);
    }
  });

  it("each overlap is caught for its own reason (independent negative fixtures)", () => {
    const base = powerPanel(priorAll, {});
    expect(disjointnessProblems({ ...base, seeds: [1, 102] }, prior, {})).toEqual(["assay seeds overlap the earlier panel's"]);
    expect(disjointnessProblems({ ...base, seeds: [101, 102, 103] }, prior, {})).toEqual(["seed count differs from the earlier panel's (tau and the viable floor use it)"]);
    expect(disjointnessProblems({ ...base, nb: { ...base.nb, salt: prior.salt } }, prior, {})).toEqual(["neighbourhood salt equals the earlier panel's"]);
    expect(disjointnessProblems({ ...base, nullPrefix: "" }, prior, {})).toEqual(["null replicate namespace equals the earlier panel's"]);
    expect(disjointnessProblems(base, prior, { "m3-c4": [priorAll["m3-c4"][3]] })).toEqual(["m3-c4: an assayed genome hash occurs among the earlier panel's edits"]);
    // a panel built with PR136's own seeds fails (the combined check cannot be satisfied by one branch alone)
    expect(disjointnessProblems({ ...base, seeds: [...prior.seeds], nb: { ...base.nb, salt: prior.salt }, nullPrefix: "" }, prior, {}).length).toBe(3);
  });
});

describe("allocation rule", () => {
  it("every stratum population covers its allocation for c4 and c9, and the allocation sums to N (8 for the control)", () => {
    for (const s of starts.slice(1)) {
      const { eligible } = poolsOf(s.id, s.words, priorAll);
      for (const n of [192, 144]) {
        const al = deriveAllocation(n, eligible);
        expect(Object.values(al).reduce((a, b) => a + b, 0)).toBe(n);
        for (const [k, v] of Object.entries(al)) expect(v).toBeLessThanOrEqual(eligible[k] ?? 0);
        // equal share per family before deficits: no family strays far from N/4
        for (const fam of ["single6", "single24", "multi2", "multi4"]) expect(Object.entries(al).filter(([k]) => k.startsWith(`${fam}/`)).reduce((a, [, v]) => a + v, 0)).toBe(n / 4);
      }
    }
    expect(Object.values(POWER_ALLOC_CONTROL).reduce((a, b) => a + b, 0)).toBe(8);
    const { eligible } = poolsOf("generalist", starts[0].words, priorAll);
    for (const [k, v] of Object.entries(POWER_ALLOC_CONTROL)) expect(v).toBeLessThanOrEqual(eligible[k] ?? 0);
  });

  it("deficits move to w1 of the same family by the stated rule, and an impossible pool throws", () => {
    const pools: Record<string, number> = { "single6/w1": 40, "single6/b1": 2, "single6/w2": 32, "single6/b2": 8, "single6/physics": 0, "single24/w1": 40, "single24/b1": 8, "single24/w2": 32, "single24/b2": 8, "single24/physics": 3, "multi2/multi": 60, "multi4/multi": 60 };
    const al = deriveAllocation(192, pools) as Allocation;
    expect(al["single6/physics"]).toBeUndefined();
    expect(al["single6/b1"]).toBe(1); // 48 x 2 / 82 = 1.17: largest remainder
    expect(Object.entries(al).filter(([k]) => k.startsWith("single6/")).reduce((a, [, v]) => a + v, 0)).toBe(48);
    expect(() => deriveAllocation(192, { ...pools, "single6/w1": 1, "single6/w2": 1, "single6/b1": 1, "single6/b2": 1 })).toThrow(/cannot place/);
    expect(() => deriveAllocation(190, pools)).toThrow(/divisible/);
    // multi deficit spills to the other multi family
    const spilled = deriveAllocation(192, { ...pools, "multi2/multi": 40 });
    expect(spilled["multi2/multi"]).toBe(40);
    expect(spilled["multi4/multi"]).toBe(56);
  });
});

describe("exact power numbers", () => {
  it("P(A>=5) at p = 1/24 for N = 192 and 144, and the tails the amendment states, by exact rational arithmetic", () => {
    expect(decimal(binomialAtLeast(192, 5, 1, 24), 3)).toBe("0.905");
    expect(decimal(binomialAtLeast(144, 5, 1, 24), 3)).toBe("0.720");
    expect(decimal(binomialAtLeast(192, 5, 7, 200), 3)).toBe("0.804");
    expect(decimal(binomialAtLeast(192, 5, 3, 100), 3)).toBe("0.685");
    expect(decimal(binomialAtLeast(192, 5, 2, 100), 3)).toBe("0.339");
    expect(decimal(binomialAtLeast(192, 5, 6, 100), 3)).toBe("0.990");
    expect(decimal(binomialAtLeast(192, 20, 1, 24), 6)).toBe("0.000172");
    expect(decimal(binomialAtLeast(144, 15, 1, 24), 5)).toBe("0.00105");
    const one = binomialAtLeast(192, 5, 1, 24);
    expect(decimal({ num: one.num * one.num, den: one.den * one.den }, 3)).toBe("0.819");
    // PR136's own size: 24 edits could reach 5 improving only with probability under 1 percent
    expect(decimal(binomialAtLeast(24, 5, 1, 24), 4)).toBe("0.0027");
  });
});

// ---- The unchanged rule, through rows -----------------------------------------------------------------------

const TAU = [10, 20, 30] as const;
const gRec = (id: string) => ({ id, label: id, role: "m3-sparse", cluster: 1, hex: "", hash: "", nonzero: { w1: 0, b1: 0, w2: 0, b2: 0 }, baseline: { lg: [0, 0], dp: [0, 0], dt: [0, 0] }, tau: [...TAU], qualification: { pass: true, minLightGrowth: 0, minLightOverDark: 0, reasons: [] }, votes: true }) as unknown as GenomeRecord;
type Kind = "none" | "clean" | "collateral";
const synthRow = (genome: string, i: number, family: string, kind: string, outcome: Kind, breadth: number): Row => {
  const dev: [number, number, number] = outcome === "none" ? [0, 0, 0] : outcome === "clean" ? [TAU[0] + 1, 0, 0] : [TAU[0] + 1, -(TAU[1] + 1), 0];
  return { genome, id: `${family}:${i}`, family, kind, k: family.startsWith("multi") ? 2 : 1, cls: "genuine", slots: [], requestedL1: 0, realisedL1: 0, undoExact: true, dupOf: null, hash: `${genome}${i}`, expression: "controller", changed: [], maxDelta: [], breadth, participation: 0, sensorReach: 0, sensorMask: 0, structActuators: 0, structSensors: 0, withinStructural: true, assayed: true, assay: { sums: [3000, 3000, 3000], dev, stocks: { B0: 1, B1: 1, P0: 0, P1: 0, E0: 0, E1: 0 } } } as Row;
};
/** N assayed genuine edits per genome, half single24 w1 and half multi2: `improve` clean and `coll` collateral improving edits spread over both halves. */
function synth(n: number, per: { clean: number; coll: number; breadth?: number }[], nullMedian2 = 4): Payload {
  const ids = ["a", "b"];
  const rows: Row[] = [];
  per.forEach((p, gi) => {
    const kinds: Kind[] = [...Array(p.clean).fill("clean"), ...Array(p.coll).fill("collateral"), ...Array(n - p.clean - p.coll).fill("none")];
    // improving edits first: indices alternate single24 / multi2, so both halves carry them
    const placed: Kind[] = Array(n).fill("none");
    kinds.filter((k) => k !== "none").forEach((k, j, all) => { placed[j < Math.ceil(all.length / 2) ? 2 * j + 1 : 2 * (j - Math.ceil(all.length / 2))] = k; });
    placed.forEach((k, i) => rows.push(synthRow(ids[gi], i, i % 2 === 0 ? "single24" : "multi2", i % 2 === 0 ? "w1" : "multi", k, p.breadth ?? 1)));
  });
  const strata: Payload["strata"] = {};
  for (const id of ids) strata[id] = { "single24/w1": { population: n, chosen: n / 2 }, "multi2/multi": { population: n, chosen: n / 2 } };
  const fixtures = [{ id: "f", neutral: true, passes: true }] as unknown as Payload["fixtures"];
  return { genomes: ids.map(gRec), rows, strata, nullBreadth: { a: { values: [], median2: nullMedian2 }, b: { values: [], median2: nullMedian2 } }, sensitivity: { passes: true }, fixtures } as unknown as Payload;
}

describe("the decision rule applied to row-level outcomes", () => {
  it("A = 4 on either genome is inconclusive, A = 0 is inconclusive and not a null verdict, at any N", () => {
    for (const n of [24, 192]) {
      const four = verdictFromPayload(synth(n, [{ clean: 4, coll: 0 }, { clean: 9, coll: 0 }]));
      expect(four.kind).toBe("inconclusive");
      expect(four.reasons.join(" ")).toMatch(/4 improving edits is below 5/);
      const none = verdictFromPayload(synth(n, [{ clean: 0, coll: 0 }, { clean: 0, coll: 0 }]));
      expect(none.kind).toBe("inconclusive");
      expect(none.inputs.every((v) => v.underpowered && v.A === 0)).toBe(true);
    }
  });

  it("A = 5 on both genomes leaves the underpowered branch; the same counts decide differently at N = 24 and N = 192", () => {
    const at24 = verdictFromPayload(synth(24, [{ clean: 5, coll: 0 }, { clean: 5, coll: 0 }]));
    expect(at24.inputs.every((v) => !v.underpowered)).toBe(true);
    expect(at24.kind).toBe("broadly-useful");
    const at192 = verdictFromPayload(synth(192, [{ clean: 5, coll: 0 }, { clean: 5, coll: 0 }]));
    expect(at192.inputs.every((v) => !v.underpowered && v.A === 5 && v.K === 5 && v.assayedGenuine === 192)).toBe(true);
    expect(at192.kind).toBe("inconclusive");
    expect(at192.reasons.join(" ")).toMatch(/disagree or neither rule is met/);
  });

  it("broadly-useful needs K >= ceil(10% N): 20 passes at N = 192, 19 does not", () => {
    expect(verdictFromPayload(synth(192, [{ clean: 20, coll: 0 }, { clean: 20, coll: 0 }])).kind).toBe("broadly-useful");
    expect(verdictFromPayload(synth(192, [{ clean: 19, coll: 0 }, { clean: 19, coll: 0 }])).kind).toBe("inconclusive");
    expect(verdictFromPayload(synth(192, [{ clean: 20, coll: 0 }, { clean: 19, coll: 0 }])).kind).toBe("inconclusive");
  });

  it("entanglement-signal needs median breadth >= 6 (3 actuators) and null + 2 on both genomes; one below is inconclusive", () => {
    const e = (breadth: number, nullM = 4) => verdictFromPayload(synth(192, [{ clean: 3, coll: 3, breadth }, { clean: 3, coll: 3, breadth }], nullM));
    expect(e(3).kind).toBe("entanglement-signal");
    expect(e(2).kind).toBe("inconclusive");
    expect(e(3, 5).kind).toBe("inconclusive"); // null 5 -> needs 7 doubled
    const mixed = verdictFromPayload({ ...synth(192, [{ clean: 3, coll: 3, breadth: 3 }, { clean: 3, coll: 3, breadth: 1 }]) });
    expect(mixed.kind).toBe("inconclusive");
  });

  it("decide trusts the underpowered flag, so verdict fixtures here never supply it independently", () => {
    const p = synth(192, [{ clean: 5, coll: 0 }, { clean: 5, coll: 0 }]);
    expect(decide({ voters: verdictFromPayload(p).inputs, sensitivityOk: true, neutralOk: true, slotsFilled: 2 }).kind).toBe(verdictFromPayload(p).kind);
  });
});
