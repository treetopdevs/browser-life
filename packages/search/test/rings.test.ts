// Kernel ring offsets (WorldConfig.shapeReach; docs/sandbox-cells.md) are part of a genome's identity
// wherever the search machinery compares or records genomes, and a neutral genome's identities are
// what they were before the offsets existed.
import { describe, expect, it } from "vitest";
import { M3_FOUNDERS, founderGenome, ringsOf, type Genome } from "@bl/schema";
import { founderSetId, genomeKey, replicatedFounders, reviveEvalConfig, DEFAULT_EVAL, type EncGenome, type Evaluation, type ReplicateRow, type RetestRow } from "@bl/search";

const plain = founderGenome(M3_FOUNDERS[0]);
const ringed: Genome = { ...plain, rings: [1, 0, 0] };
const enc = (g: Genome): EncGenome => ({ mu: g.mu, sigma: g.sigma, motGain: g.motGain, weights: Array.from(g.weights), ...(ringsOf(g) ? { rings: ringsOf(g) } : {}) });

describe("ring offsets in search identities", () => {
  it("ringsOf treats absence and all-zero as one", () => {
    expect(ringsOf(plain)).toBeUndefined();
    expect(ringsOf({ rings: [0, 0, 0] })).toBeUndefined();
    expect(ringsOf({ rings: [0, -3, 0] })).toEqual([0, -3, 0]);
  });

  it("genomeKey separates ring variants and leaves neutral keys as they were", () => {
    expect(genomeKey(plain)).toBe(`${plain.mu}:${plain.sigma}:${plain.motGain}:${Array.from(plain.weights).join(",")}`);
    expect(genomeKey({ ...plain, rings: [0, 0, 0] })).toBe(genomeKey(plain));
    expect(genomeKey(ringed)).not.toBe(genomeKey(plain));
    expect(genomeKey({ ...plain, rings: [0, 1, 0] })).not.toBe(genomeKey(ringed));
  });

  it("founderSetId changes with a ring offset and not for a neutral set", () => {
    const set = M3_FOUNDERS.slice(0, 3).map((f) => enc(founderGenome(f)));
    const id = founderSetId(set);
    expect(founderSetId(set.map((g) => ({ ...g, rings: [0, 0, 0] })))).toBe(id);
    expect(founderSetId([{ ...set[0], rings: [1, 0, 0] }, set[1], set[2]])).not.toBe(id);
    // The offset belongs to its own genome: moving it to the next one is a different set.
    expect(founderSetId([{ ...set[0], rings: [1, 0, 0] }, set[1], set[2]])).not.toBe(founderSetId([set[0], { ...set[1], rings: [1, 0, 0] }, set[2]]));
  });

  it("replication of a neutral genome does not stand in for its ring variant", () => {
    const ev = { survived: 32, regenerated: 32, lightDependent: 32, reps: 32 } as unknown as Evaluation;
    const row = { label: "a", cluster: 0, weak: false, prior: null, genome: enc(ringed), eval: ev } as unknown as RetestRow;
    const neutralRep = { label: "a", cluster: 0, genome: enc(plain), eval: ev } as ReplicateRow;
    expect(() => replicatedFounders([row], [neutralRep])).toThrow(/no replication/);
    expect(replicatedFounders([row], [{ ...neutralRep, genome: enc(ringed) }]).length).toBe(1);
  });

  it("reviveEvalConfig keeps a background genome's ring offsets", () => {
    const raw = JSON.parse(JSON.stringify({ ...DEFAULT_EVAL, medium: { kind: "background", background: { ...enc(ringed) } } }));
    const back = reviveEvalConfig(raw).medium?.background;
    expect(back?.rings).toEqual([1, 0, 0]);
  });
});
