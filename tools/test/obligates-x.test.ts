import { describe, expect, it } from "vitest";
import { emptyGenome } from "@bl/schema";
import { fisherTwoSided, interleave, medoid, pickSubjects, readOut, shares, status, type Cell, type Cells, type Subject } from "../lib/obligates-x.ts";

const g = (mu: number, ws: number[] = []) => {
  const x = emptyGenome(mu, 20);
  ws.forEach((v, i) => (x.weights[i] = v));
  return x;
};
const cell = (survived: number, extra: Partial<Cell> = {}): Cell => ({ survived, reps: 16, recovered: 0, lightDependent: 0, regenerated: 0, recovery: 0, individuals: 0, meanMass: 0, speed: 0, mass: 0, reproduction: 0, ...extra });

describe("status", () => {
  it("is viable from 12/16, dead up to 2/16, marginal between", () => {
    expect([16, 12, 11, 3, 2, 0].map((s) => status(cell(s)))).toEqual(["viable", "viable", "marginal", "marginal", "dead", "dead"]);
  });
});

describe("medoid and pickSubjects", () => {
  it("medoid is the member nearest the rest, ties to the lowest index", () => {
    const gs = [g(1, [0]), g(1, [1]), g(1, [1, 1]), g(1, [1, 1, 1, 1, 1])];
    expect(medoid(gs, [0, 1, 2])).toBe(1);
    expect(medoid(gs, [2])).toBe(2);
  });

  it("takes obligate medoids, non-obligate cluster medoids, mixed-cluster siblings and two extras in the dominant cluster", () => {
    const far = (k: number) => g(60, Array.from({ length: 40 }, (_, i) => (i < k * 8 ? 1 : 0)).map((v, i) => (Math.floor(i / 8) === k ? 5 : 0)));
    const pool = [
      { genome: g(60, [0]), cluster: 0, obligate: true },
      { genome: g(60, [1]), cluster: 0, obligate: true },
      { genome: g(60, [1, 1]), cluster: 0, obligate: true },
      { genome: g(60, [1, 1, 1]), cluster: 0, obligate: true },
      { genome: g(60, [1, 1, 1, 1, 1, 1]), cluster: 0, obligate: true },
      { genome: g(60, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9]), cluster: 0, obligate: false },
      { genome: far(1), cluster: 1, obligate: false },
      { genome: far(2), cluster: 2, obligate: true },
    ];
    const subs = pickSubjects(pool);
    const ids = subs.map((s) => s.id);
    expect(ids).toContain("obligate:c0");
    expect(ids).toContain("obligate:c2");
    expect(ids).toContain("nonobligate-cluster:c1");
    expect(ids).toContain("facultative-sibling:c0");
    expect(ids).not.toContain("facultative-sibling:c2");
    expect(subs.filter((s) => s.group === "obligate-extra")).toHaveLength(2);
    expect(subs.filter((s) => s.group === "obligate-extra").every((s) => s.cluster === 0)).toBe(true);
  });
});

describe("interleave", () => {
  it("round-robins across groups without losing any item", () => {
    const xs = [{ group: "a", v: 1 }, { group: "a", v: 2 }, { group: "a", v: 3 }, { group: "b", v: 4 }, { group: "c", v: 5 }];
    const out = interleave(xs);
    expect(out.map((x) => x.v)).toEqual([1, 4, 5, 2, 3]);
  });
});

describe("fisherTwoSided", () => {
  it("matches known values", () => {
    expect(fisherTwoSided(3, 1, 1, 3)).toBeCloseTo(0.4857, 3); // classic tea-tasting table
    expect(fisherTwoSided(5, 0, 0, 5)).toBeCloseTo(2 / 252, 6);
    expect(fisherTwoSided(2, 2, 2, 2)).toBeCloseTo(1, 9);
  });
});

describe("shares", () => {
  it("is the fraction of photo, grow and decomp, or zero with no flux", () => {
    expect(shares({ photo: 2, grow: 1, decomp: 1, resp: 99 })).toEqual({ photo: 0.5, grow: 0.25, decomp: 0.25 });
    expect(shares(undefined)).toEqual({ photo: 0, grow: 0, decomp: 0 });
  });
});

describe("readOut", () => {
  const sub = (id: string, group: Subject["group"], cluster: number | null): Subject => ({ id, group, cluster, genome: g(60) });
  const phot = { photo: 10, grow: 1, decomp: 1, resp: 0 };
  const dec = { photo: 1, grow: 1, decomp: 10, resp: 0 };
  /** o1 and o2 are the obligate representatives (cluster 3 dominant); the null candidate is dead in both producer backgrounds. */
  const fixture = () => {
    const subjects = [sub("o1", "obligate", 3), sub("o2", "obligate", 4), sub("x1", "obligate-extra", 3), sub("x2", "obligate-extra", 3), sub("n1", "nonobligate-cluster", 7), sub("n2", "nonobligate-cluster", 8), sub("null", "null", null)];
    const mk = (std: number, bg0: number, bg2: number, waste: number, x4: number, role: string, rs: typeof phot): Partial<Record<string, Cell>> => ({
      standard: cell(std),
      waste: cell(waste),
      bg0: cell(bg0, { role, roleSums: rs, otherMass: 50 }),
      bg2: cell(bg2, { otherMass: 50 }),
      x4: cell(x4),
    });
    const cells = {
      o1: mk(0, 16, 15, 0, 2, "decomposer", dec),
      o2: mk(0, 16, 2, 0, 3, "decomposer", dec),
      x1: mk(1, 15, 14, 0, 1, "decomposer", dec),
      x2: mk(0, 16, 13, 0, 0, "decomposer", dec),
      n1: mk(16, 16, 16, 16, 16, "phototroph", phot),
      n2: mk(16, 16, 16, 16, 16, "phototroph", phot),
      null: { bg0: cell(0, { otherMass: 100 }), bg2: cell(0, { otherMass: 100 }) },
    } as Cells;
    return { subjects, cells };
  };
  it("confirms obligates, applies the density kill and separates trophic classes", () => {
    const { subjects, cells } = fixture();
    const r = readOut(subjects, cells);
    expect(r.replication.confirmed).toBe(2);
    expect(r.replication.verdict).toBe("does-not-reproduce");
    expect(r.dominantCluster.cluster).toBe(3);
    expect(r.dominantCluster.verdict).toBe("stage-1-success");
    expect(r.dependence.map((d) => d.cls)).toEqual(["producer-general", "producer-0-only"]);
    expect(r.trophic.obligateConfirmed.nonPhototroph).toBe(2);
    expect(r.trophic.nonObligateClusters.nonPhototroph).toBe(0);
    expect(r.trophic.fisherTwoSidedNonPhototroph).toBeLessThan(0.34);
    expect(r.consumptionSummary).toMatchObject({ nullControlValid: true, decomposerType: 2, of: 2 });
    expect(r.consumption[0].producerEffect).toBe("draws-down");
    const killed = readOut(subjects, { ...cells, o1: { ...cells.o1, x4: cell(9) } });
    expect(killed.dominantCluster.verdict).toBe("density-rescues (kill)");
  });

  it("reports every producer effect as invalid, and no consumption verdict, when the null candidate is viable", () => {
    const { subjects, cells } = fixture();
    const r = readOut(subjects, { ...cells, null: { ...cells.null, bg0: cell(16, { otherMass: 100 }) } });
    expect(r.consumptionSummary.nullControlValid).toBe(false);
    expect(r.consumption).toHaveLength(2);
    for (const x of r.consumption) {
      expect(x.producerEffect).toBe("invalid (null control viable)");
      expect(x.consumes).toBe("unknown");
    }
    expect(r.consumptionSummary.consumes).toEqual({ unknown: 2 });
  });

  it("says a decomposer-type that draws the producer down consumes, and anything weaker is unknown", () => {
    const { subjects, cells } = fixture();
    const r = readOut(subjects, cells);
    expect(r.consumption[0].consumes).toBe("yes");
    expect(r.consumptionSummary.consumes.yes).toBeGreaterThanOrEqual(1);
    // a neutral producer response (ratio 1.0) is not enough
    const neutral = readOut(subjects, { ...cells, o1: { ...cells.o1, bg0: cell(16, { role: "decomposer", roleSums: dec, otherMass: 100 }) } });
    expect(neutral.consumption[0].producerEffect).toBe("neutral");
    expect(neutral.consumption[0].consumes).toBe("unknown");
  });

  it("lists obligate representatives that live only beside producer 2 (invisible to the confirmed-obligate rule)", () => {
    const { subjects, cells } = fixture();
    const o3 = sub("o3", "obligate", 9);
    const r = readOut([...subjects, o3], { ...cells, o3: { standard: cell(0), bg0: cell(2), bg2: cell(16) } } as Cells);
    expect(r.bg2OnlyUnconfirmed).toEqual([9]);
    expect(readOut(subjects, cells).bg2OnlyUnconfirmed).toEqual([]);
  });
});
