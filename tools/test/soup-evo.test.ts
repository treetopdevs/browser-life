import { describe, expect, it } from "vitest";
import { evaluate, selfRep, TAPE } from "../soup/bff.ts";
import {
  canonical, findMarker, intransitive, interact, keyOf, leadership, lineageVerdict, markForms, pairOutcome, patch, permutationP,
  runAssay, spearman, src, START, transforms, TypeRef, typeCensus, unhex,
} from "../soup/evo.ts";

// A copier from the well-mixed seed 2 run (copy test 64) and one from grid seed 1.
const WM2 = unhex("80b6f65bf6b6ff81dca81f73a13d3cb6a12c4cee7de6b4262836a9363636924c4c5d36bb3636362826e0e67d4c4c2ca1b63c3da1b61f4fdc6e0f5b265bf6b6a1");
const G1 = unhex("b54eb9865b3fb3ddb3f62332ab3c2c7d31f987a16c6c87a10387eaea875da1876c6ca187f9317d2c3cab3223f603ddb33f5ba8c881c60ccec34a4342b5a17675");
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const t = (x: Uint8Array, k: number) => transforms(x).slice(k * TAPE, (k + 1) * TAPE);

describe("types", () => {
  it("transforms are rotations and reversals", () => {
    const x = Uint8Array.from({ length: TAPE }, (_, i) => i);
    expect([...t(x, 0)]).toEqual([...x]);
    expect(t(x, 1)[0]).toBe(1);
    expect(t(x, 64)[0]).toBe(63);
    expect(new Set(Array.from({ length: 128 }, (_, k) => t(x, k).join(","))).size).toBe(128);
    for (let k = 0; k < 128; k++) for (let i = 0; i < TAPE; i++) expect(t(x, k)[i]).toBe(src(k, i));
  });

  it("keys keep instructions and zero bytes", () => {
    const p = new Uint8Array(TAPE).fill(7);
    p[0] = "[".charCodeAt(0); p[1] = 0;
    const k = String.fromCharCode(...keyOf(p));
    expect(k.slice(0, 3)).toBe("[0_");
  });

  it("a program, its rotations and its reversal share one canonical key", () => {
    const k = keyOf(WM2);
    const c = canonical(k);
    for (const j of [3, 64, 100, 127]) expect(canonical(t(k, j))).toBe(c);
    expect(canonical(keyOf(G1))).not.toBe(c);
  });

  it("type distance is zero to every transform of either form", () => {
    const rev = t(WM2, 64 + 5);
    const ref = new TypeRef([WM2, rev]);
    expect(ref.distance(WM2).d).toBe(0);
    expect(ref.distance(t(WM2, 17)).d).toBe(0);
    expect(ref.distance(rev).d).toBe(0);
    const m = ref.mirrorMap();
    for (let i = 0; i < TAPE; i++) expect(rev[m[i]]).toBe(WM2[i]);
    const g = new TypeRef([G1]);
    expect(g.distance(WM2).d).toBeGreaterThan(g.match);
    expect(g.match).toBe(Math.floor(0.4 * g.symbols));
  });
});

describe("census", () => {
  it("merges mirror forms into one type and picks a copier as leader", () => {
    const num = 400;
    const programs = new Uint8Array(num * TAPE);
    const rev = t(WM2, 64 + 9);
    const junk = new Uint8Array(TAPE).fill(1);
    junk.set([..."[[[[[[[[".split("").map((c) => c.charCodeAt(0))]);
    for (let p = 0; p < num; p++) programs.set(p < 100 ? WM2 : p < 190 ? rev : p < 350 ? junk : G1, p * TAPE);
    const s = typeCensus(programs, 0);
    expect(s.types[0].count).toBe(190);
    expect(s.types[0].families).toBe(2);
    expect(s.types[0].rep).toBe(hexOf(WM2));
    expect(s.types[0].mirror).toBe(hexOf(rev));
    // the junk type is larger than G1's but cannot copy itself, so it is never the leader
    expect(s.types[1].count).toBe(160);
    expect(s.types[1].selfRep).toBeLessThan(16);
    expect(s.leader).toBe(s.types[0].id);
    expect(s.copierShare).toBeCloseTo(240 / 400);
  });
});

describe("assays", () => {
  it("are deterministic and start at the rare fraction", () => {
    const job = { id: "x", kind: "pair" as const, lineage: "t", rare: "a", common: "b", rareForms: [hexOf(WM2)], commonForms: [hexOf(G1)], seed: 5, num: 256, rareCount: 32, epochs: 8, every: 4 };
    const r1 = runAssay(job), r2 = runAssay(job);
    expect(r1.points[0].f).toBe(32 / 256);
    expect(r1.points.map((p) => p.epoch)).toEqual([0, 4, 8]);
    expect(r1).toEqual(r2);
    expect(START).toBe(0.125);
  });

  it("plants the grid's rare patch in the centre", () => {
    const g = { width: 64, height: 64, radius: 2 };
    const p = patch(g, 512);
    expect(p.length).toBe(512);
    expect(new Set(p).size).toBe(512);
    const xs = p.map((i) => i % 64), ys = p.map((i) => Math.floor(i / 64));
    expect(Math.min(...xs)).toBe(20);
    expect(Math.max(...xs)).toBe(42);
    expect(Math.min(...ys)).toBe(20);
  });

  it("finds a heritable marker that leaves the type unchanged", () => {
    const ref = new TypeRef([WM2]);
    const m = findMarker(ref, "noheads", { num: 256, rareCount: 32, epochs: 4 });
    expect(m).not.toBeNull();
    expect(m!.carried).toBeGreaterThanOrEqual(7);
    expect(m!.misread).toBeGreaterThanOrEqual(0);
    const [marked] = markForms(ref, m!.pos, m!.value);
    expect(ref.distance(marked).d).toBe(0);
    expect(marked[m!.pos]).toBe(m!.value);
    expect(selfRep(marked)).toBeGreaterThanOrEqual(48);
  });
});

describe("outcomes and verdicts", () => {
  const s0 = 0.04; // theta = 2.5 * 0.04 * sqrt(2/3) ~ 0.082
  it("scores pairs by the difference in rare fractions", () => {
    expect(pairOutcome([0.5, 0.6, 0.55], [0.02, 0.01, 0.05], s0).outcome).toBe("a");
    expect(pairOutcome([0.02, 0.01, 0.05], [0.5, 0.6, 0.55], s0).outcome).toBe("b");
    expect(pairOutcome([0.3, 0.32, 0.29], [0.3, 0.31, 0.33], s0).outcome).toBe("coexist");
    expect(pairOutcome([0.12, 0.13, 0.14], [0.11, 0.13, 0.12], s0).outcome).toBe("unresolved");
    expect(pairOutcome([0.5, null, null], [0.1, 0.1, 0.1], s0).outcome).toBe("failed");
  });

  it("permutation p counts orders with at least as many later wins", () => {
    // 3 competitors, later always wins: only the identity order gives 3 of 3.
    expect(permutationP(3, [[1, 0], [2, 0], [2, 1]])).toEqual({ laterWins: 3, p: 1 / 6 });
    // One win by the earlier type: 0 later wins, every order has >= 0.
    expect(permutationP(2, [[0, 1]])).toEqual({ laterWins: 0, p: 1 });
    const big = permutationP(10, Array.from({ length: 9 }, (_, i) => [i + 1, i] as [number, number]));
    expect(big.laterWins).toBe(9);
    expect(big.p).toBeLessThan(0.001);
  });

  it("verdicts follow the pre-registered rule", () => {
    expect(lineageVerdict(6, 6, 10, 0, 0.01).verdict).toBe("ADAPTIVE");
    expect(lineageVerdict(6, 6, 10, 0, 0.2).verdict).toBe("NO DIRECTION");
    expect(lineageVerdict(3, 3, 3, 0, 0.17).verdict).toBe("ADAPTIVE (weak)");
    expect(lineageVerdict(0, 5, 6, 0, 1).verdict).toBe("REVERSED");
    expect(lineageVerdict(1, 1, 3, 0, 0.5).verdict).toBe("INSUFFICIENT EVIDENCE");
    expect(lineageVerdict(5, 5, 10, 4, 0.01).verdict).toBe("INSUFFICIENT EVIDENCE");
  });

  it("finds intransitive triples", () => {
    expect(intransitive([["a", "b"], ["b", "c"], ["c", "a"]])).toEqual([["a", "b", "c"]]);
    expect(intransitive([["a", "b"], ["b", "c"], ["a", "c"]])).toEqual([]);
  });
});

describe("leadership", () => {
  it("counts only changes that hold for the next snapshot", () => {
    const r = leadership(["a", "a", "b", "a", "a", "c", "c", null, "c", "a", "a"]);
    expect(r.changes).toBe(2); // a->c (held), c->a at the end (held); the b flicker is not counted
    expect(r.competitors).toEqual(["a", "c"]);
    expect(r.firstLead).toEqual([0, 5]);
  });

  it("freezes representatives at a type's first lead, sustained or not", () => {
    const r = leadership(["a", "b", "a", "b", "b"]);
    expect(r.changes).toBe(1);
    expect(r.competitors).toEqual(["a", "b"]);
    expect(r.firstLead).toEqual([0, 3]);
    expect(r.frozen).toEqual([0, 1]);
  });

  it("subsamples more than 12 competitors evenly, keeping the ends", () => {
    const ls = Array.from({ length: 40 }, (_, i) => `t${Math.floor(i / 2)}`);
    const r = leadership(ls);
    expect(r.changes).toBe(19);
    expect(r.competitors.length).toBe(12);
    expect(new Set(r.competitors).size).toBe(12);
    expect(r.competitors[0]).toBe("t0");
    expect(r.competitors[11]).toBe("t19");
  });
});

describe("probe and trends", () => {
  it("labels a copier filling both halves", () => {
    const noise = Uint8Array.from({ length: TAPE }, (_, i) => (i * 37 + 11) & 255);
    const tape = new Uint8Array(2 * TAPE);
    tape.set(WM2); tape.set(noise, TAPE);
    evaluate(tape);
    const pr = interact([new TypeRef([WM2]), new TypeRef([noise])], ["w", "n"]);
    expect(pr.outcome[0][1]).toBe("XX");
  });

  it("spearman", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 2, 3], [5, 5, 5])).toBeNaN();
    expect(spearman([1, 2, 3], [1, NaN, 3])).toBeNaN();
  });
});
