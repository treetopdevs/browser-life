import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CH, G, GENE_SHIFT, defaultConfig } from "@bl/schema";
import {
  FIRSTS_LADDER,
  FIRSTS_RULES,
  FIRSTS_RULESET,
  FIRSTS_RULESET_V0,
  FIRSTS_RULESET_V1,
  FIRSTS_THRESHOLDS,
  FirstsDetector,
  Tracker,
  buildFirstsInput,
  census,
  firstsContext,
  firstsRules,
  nextUp,
  pondLeaders,
  readLineageCells,
  type FirstsBody,
  type FirstsContext,
  type FirstsEntry,
  type FirstsInput,
} from "@bl/metrics";

const CTX: FirstsContext = { tileW: 64, tileH: 64, tilesX: 1, tiles: 1, censusEvery: 100, pondReseeds: false, geneBits: [] };

const body = (id: number, cells: number, o: Partial<FirstsBody> = {}): FirstsBody => ({ id, generation: 0, cells, cx: 10, cy: 10, tile: 0, lineage: "A", elongation: 1, ...o });
const cen = (step: number, o: Partial<FirstsInput> = {}): FirstsInput => {
  const bodies = o.bodies ?? [];
  const lineages = o.lineages ?? [{ key: "A", cells: bodies.reduce((a, b) => a + b.cells, 0) }].filter((l) => l.cells > 0);
  return { step, bodies, lineages, fissions: 0, deaths: 0, livingCells: lineages.reduce((a, l) => a + l.cells, 0), pondLeaders: [], wounds: [], ...o };
};
/** Feed censuses and collect every entry fired, with the step it fired at. */
function feed(d: FirstsDetector, inputs: FirstsInput[]): FirstsEntry[] {
  const out: FirstsEntry[] = [];
  for (const i of inputs) out.push(...d.observe(i));
  return out;
}
const ids = (es: readonly FirstsEntry[]) => es.map((e) => e.id);
const find = (d: FirstsDetector, id: string) => d.entries().find((e) => e.id === id);

/**
 * A scripted stream that makes every rule fire, on STREAM_CTX (step 100 * (k + 1)): body 1 grows, drifts diagonally (traveller at k = 19, far traveller
 * at k = 38) and reaches 250 cells at k = 230, and is long (elongation 3.5) from k = 30; body 2 descends a generation every ten censuses and carries gene 0 from k = 61;
 * bodies 3 and 4 swing 10 cells either way each census in pond 2 (a moving pond from k = 5); lineage B appears at
 * k = 3 and holds on (new lineage k = 53, 20,000 steps k = 203) and takes over at k = 71; lineage C appears at k = 90 above B and takes over second at k = 99.
 * Pond 1 is led by A until k = 9 and by B from k = 10 (a change of hands at k = 14); a lesion at k = 40 (step 4,050) in pond 2, whose bodies lose cells
 * at that census, is outlived at k = 42; the family tree splits at k = 100.
 */
const STREAM_CTX: FirstsContext = { tileW: 64, tileH: 64, tilesX: 2, tiles: 2, censusEvery: 100, pondPeriod: 500, pondReseeds: false, geneBits: [0] };
const stream = (n: number): FirstsInput[] => {
  const out: FirstsInput[] = [];
  for (let k = 0; k < n; k++) {
    const b1 = body(1, 20 + k, { cx: (5 + 0.7 * k) % 64, cy: (20 + 0.5 * k) % 64, elongation: k >= 30 ? 3.5 : 1.5 });
    const b2 = body(2, 10 + (k % 40), { generation: Math.floor(k / 10), cx: 30, cy: 40, tile: 1, geneCells: [k > 60 ? 10 + (k % 40) : 0] });
    const b3 = body(3, 12, { cx: 20 + 10 * (k % 2), cy: 5, tile: 1 });
    const b4 = body(4, 12, { cx: 40, cy: 20 + 10 * (k % 2), tile: 1 });
    out.push({
      step: 100 * (k + 1),
      bodies: [b1, b2, b3, b4],
      lineages: [{ key: "A", cells: Math.max(50, 200 - k) }, ...(k >= 3 ? [{ key: "B", cells: 16 + 2 * k }] : []), ...(k >= 90 ? [{ key: "C", cells: 210 + k }] : [])],
      fissions: Math.floor(k / 10),
      deaths: k % 7 === 0 ? 1 : 0,
      livingCells: 100,
      pondLeaders: [k < 10 ? ["A"] : ["B"], []],
      wounds: k === 40 ? [{ step: 4050, tile: 1, r: 10 }] : [],
      family: { splits: k === 100 ? [{ name: "Reed amber", parentName: "Reed", step: 10100, cells: 34, parentCells: 120 }] : [], candidateRun: (k % 55) * 100 },
    });
  }
  return out;
};


describe("rules table", () => {
  const noteRows = (file: string) =>
    readFileSync(fileURLToPath(new URL(`../../../docs/${file}`, import.meta.url)), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("| `"))
      .map((l) => l.trim().slice(1, -1).split(" | ").map((c) => c.replace(/`/g, "").trim()));

  it("equals the tables in the contract notes: v0's nine rows, then v1's five, then v2's five", () => {
    const v0 = noteRows("pond-keeper-v0-2026-10-17.md");
    const v1 = noteRows("pond-keeper-v1-2026-10-17.md");
    const v2 = noteRows("pond-keeper-v2-2026-10-17.md");
    const fixed0 = v0.filter((r) => r[0] !== "gene-<b>").map((r) => ({ id: r[0], name: r[1], text: r[2] }));
    const fixed1 = v1.map((r) => ({ id: r[0], name: r[1], text: r[2] }));
    const fixed2 = v2.map((r) => ({ id: r[0], name: r[1], text: r[2] }));
    expect(fixed0).toHaveLength(9);
    expect(fixed1.map((r) => r.id)).toEqual(["body-250", "gen-10", "far-traveller", "lineage-20k", "takeover-2"]);
    expect(fixed2.map((r) => r.id)).toEqual(["moving-pond", "long-body", "pond-change", "outlive-wound", "new-family"]);
    expect(FIRSTS_RULES).toHaveLength(19);
    expect(FIRSTS_RULES).toEqual([...fixed0, ...fixed1, ...fixed2]);
    const gene = v0.find((r) => r[0] === "gene-<b>")!;
    expect(gene[1]).toBe("First carrier body of gene b");
  });

  it("the ladder is the contract's order, over every fixed rule, and the gene rules are not in it", () => {
    expect(FIRSTS_LADDER).toEqual([
      "body", "body-40", "split", "grandchild", "traveller", "moving-pond", "new-lineage", "body-100", "long-body", "takeover", "outlive-wound",
      "gen-5", "pond-change", "new-family", "far-traveller", "body-250", "lineage-20k", "takeover-2", "gen-10",
    ]);
    const all = FIRSTS_RULES.map((r) => r.id);
    expect(FIRSTS_LADDER.every((id) => all.includes(id))).toBe(true);
    expect(all.filter((id) => !FIRSTS_LADDER.includes(id))).toEqual([]);
    expect(firstsRules([0, 1]).map((r) => r.id).filter((id) => !FIRSTS_LADDER.includes(id))).toEqual(["gene-0", "gene-1"]);
    expect(FIRSTS_RULESET).toBe("firsts-v2");
    expect(FIRSTS_RULESET_V1).toBe("firsts-v1");
    expect(FIRSTS_RULESET_V0).toBe("firsts-v0");
  });

  it("adds one gene rule per gainable bit, and none without genes", () => {
    expect(firstsRules([])).toEqual(FIRSTS_RULES);
    const g = firstsRules([0, 1]);
    expect(g.map((r) => r.id)).toEqual([...FIRSTS_RULES.map((r) => r.id), "gene-0", "gene-1"]);
    expect(g[g.length - 1]).toEqual({ id: "gene-1", name: "First carrier body of gene 1", text: "some body has more than half of its cells carrying gene bit 1" });
    expect(FIRSTS_THRESHOLDS).toEqual({
      big: 40,
      large: 100,
      huge: 250,
      travel: 16,
      farTravel: 32,
      lineageCells: 16,
      lineageSteps: 5000,
      longLineageSteps: 20000,
      leadCensuses: 10,
      moveCells: 8,
      moveCensuses: 5,
      movingBodies: 2,
      longBody: 40,
      longRatio: 3,
      changeCensuses: 5,
      woundSteps: 1000,
    });
  });

  it("firstsContext reads tile sizes, pond period and the gene bits of the config", () => {
    const plain = firstsContext(defaultConfig({ tileW: 32, tileH: 24 }), 100);
    expect(plain).toEqual({ tileW: 32, tileH: 24, tilesX: 1, tiles: 1, censusEvery: 100, pondReseeds: false, geneBits: [] });
    expect("pondPeriod" in plain).toBe(false);
    const pond = firstsContext(defaultConfig({ tilesX: 3, tilesY: 2, pondPeriod: 1000, pondK: 8, pondArm: "scaf", genes: "ladder" }), 50);
    expect(pond.tiles).toBe(6);
    expect(pond.tilesX).toBe(3);
    expect(pond.pondPeriod).toBe(1000);
    expect(pond.pondReseeds).toBe(true);
    // only the arms that grind and reseed a pond end a cycle; `cont` only measures
    const arm = (a: "scaf" | "rand" | "cont" | "nat" | "shuf" | "breed") => firstsContext(defaultConfig({ tilesX: 2, pondPeriod: 1000, pondK: 8, pondArm: a }), 100).pondReseeds;
    expect(["scaf", "rand", "breed", "cont", "nat", "shuf"].map((a) => arm(a as "scaf"))).toEqual([true, true, true, false, false, false]);
    expect(pond.geneBits).toEqual([0, 1]);
    expect(firstsContext(defaultConfig({ genes: "decomp" }), 100).geneBits).toEqual([0]);
  });
});

describe("body, size, descent and split rules", () => {
  it("each fires once, at the first census where it holds, not as already there", () => {
    const d = new FirstsDetector(CTX);
    expect(feed(d, [cen(100)])).toEqual([]);
    expect(d.watchedFrom).toBe(100);
    expect(ids(d.observe(cen(200, { bodies: [body(1, 30)] })))).toEqual(["body"]);
    expect(ids(d.observe(cen(300, { bodies: [body(1, 39)] })))).toEqual([]);
    expect(ids(d.observe(cen(400, { bodies: [body(1, 40)] })))).toEqual(["body-40"]);
    expect(ids(d.observe(cen(500, { bodies: [body(1, 99), body(2, 5)] })))).toEqual([]);
    expect(ids(d.observe(cen(600, { bodies: [body(1, 100)] })))).toEqual(["body-100"]);
    expect(ids(d.observe(cen(700, { bodies: [body(1, 200)] })))).toEqual([]);
    expect(d.entries().map((e) => [e.id, e.step, e.already])).toEqual([
      ["body", 200, false],
      ["body-40", 400, false],
      ["body-100", 600, false],
    ]);
    expect(find(d, "body")!.name).toBe("First body");
    expect(find(d, "body-40")!.detail).toBe("40 cells");
  });

  it("fires several rules at one census in rule-table order", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100));
    const fired = d.observe(cen(200, { bodies: [body(3, 120, { generation: 5 })], fissions: 1 }));
    expect(ids(fired)).toEqual(["body", "body-40", "body-100", "split", "grandchild", "gen-5"]);
    expect(fired.every((e) => !e.already)).toBe(true);
    expect(find(d, "gen-5")!.detail).toBe("generation 5, 120 cells");
  });

  it("split needs the fission count to rise past the first watched census", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { bodies: [body(1, 50)], fissions: 7 }));
    expect(ids(d.observe(cen(200, { bodies: [body(1, 50)], fissions: 7 })))).toEqual([]);
    expect(ids(d.observe(cen(300, { bodies: [body(1, 50)], fissions: 8 })))).toEqual(["split"]);
    expect(find(d, "split")).toMatchObject({ step: 300, already: false, detail: "1 split counted since t=100" });
    expect(ids(d.observe(cen(400, { bodies: [body(1, 50)], fissions: 9 })))).toEqual([]);
  });

  it("grandchild and fifth generation read the living bodies' generation", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { bodies: [body(1, 50, { generation: 1 })] }));
    expect(ids(d.observe(cen(200, { bodies: [body(1, 50, { generation: 1 }), body(2, 20, { generation: 2 })] })))).toEqual(["grandchild"]);
    // a generation that falls away again does not un-fire or re-fire anything
    expect(ids(d.observe(cen(300, { bodies: [body(1, 50, { generation: 4 })] })))).toEqual([]);
    expect(ids(d.observe(cen(400, { bodies: [body(1, 50, { generation: 5 })] })))).toEqual(["gen-5"]);
    expect(find(d, "grandchild")!.step).toBe(200);
    expect(find(d, "gen-5")!.step).toBe(400);
  });

  it("names the pond only when the world has more than one", () => {
    const ponds = new FirstsDetector({ ...CTX, tiles: 4 });
    ponds.observe(cen(100));
    ponds.observe(cen(200, { bodies: [body(1, 52, { tile: 1 })] }));
    expect(find(ponds, "body")!.detail).toBe("52 cells, in pond 2");
    const one = new FirstsDetector(CTX);
    one.observe(cen(100));
    one.observe(cen(200, { bodies: [body(1, 52, { tile: 0 })] }));
    expect(find(one, "body")!.detail).toBe("52 cells");
  });
});

describe("the start case", () => {
  it("a condition that already holds at the first watched census is 'already there', never a first", () => {
    const d = new FirstsDetector({ ...CTX, geneBits: [0, 1] });
    const first = cen(100, { bodies: [body(1, 120, { generation: 5, geneCells: [100, 10] })], fissions: 3 });
    const fired = d.observe(first);
    expect(fired.map((e) => [e.id, e.already])).toEqual([
      ["body", true],
      ["body-40", true],
      ["body-100", true],
      ["grandchild", true],
      ["gen-5", true],
      ["gene-0", true],
    ]);
    // split cannot already hold: it is a rise since this very census
    expect(find(d, "split")).toBeUndefined();
    // a rule that only fires later is not marked, even for the same body
    const later = d.observe(cen(200, { bodies: [body(1, 120, { generation: 5, geneCells: [100, 90] })], fissions: 4 }));
    expect(later.map((e) => [e.id, e.already])).toEqual([["split", false], ["gene-1", false]]);
  });

  it("watchedFrom is whatever the first census fed was, and the baseline and starting lineages come from it", () => {
    const d = new FirstsDetector(CTX);
    d.observe(
      cen(4200, {
        bodies: [body(1, 60, { generation: 2 }), body(2, 30)],
        lineages: [{ key: "A", cells: 70 }, { key: "B", cells: 20 }],
      }),
    );
    const s = d.summary();
    expect(s.watchedFrom).toBe(4200);
    expect(s.baseline).toEqual({ bodies: 2, largestBody: 60, maxGeneration: 2, lineages: 2 });
    expect(s.startingLineages).toBe(2);
    expect(s.startingLineagesPresent).toBe(2);
  });
});

describe("traveller", () => {
  const at = (step: number, x: number, y = 10, id = 1) => cen(step, { bodies: [body(id, 50, { cx: x, cy: y })] });

  it("fires at 16 cells from where the log first saw the body, not before", () => {
    const d = new FirstsDetector(CTX);
    d.observe(at(100, 10));
    expect(d.observe(at(200, 25.9))).toEqual([]);
    expect(find(d, "traveller")).toBeUndefined();
    expect(ids(d.observe(at(300, 26)))).toEqual(["traveller"]);
    expect(find(d, "traveller")).toMatchObject({ step: 300, already: false, detail: "moved 16.0 cells" });
  });

  it("measures distance on the torus, per axis, the short way round", () => {
    const wrap = new FirstsDetector(CTX);
    wrap.observe(at(100, 2));
    // x 2 -> 50 is 48 one way and 16 the other
    expect(ids(wrap.observe(at(200, 51)))).toEqual([]);
    expect(ids(wrap.observe(at(300, 50)))).toEqual(["traveller"]);
    const diag = new FirstsDetector(CTX);
    diag.observe(at(100, 0, 0));
    // 11 and 11: hypot 15.56, under 16
    expect(ids(diag.observe(at(200, 11, 11)))).toEqual([]);
    // 12 and 12: hypot 16.97
    expect(ids(diag.observe(at(300, 12, 12)))).toEqual(["traveller"]);
    expect(find(diag, "traveller")!.detail).toBe("moved 17.0 cells");
    const wrapY = new FirstsDetector(CTX);
    wrapY.observe(at(100, 10, 60));
    expect(ids(wrapY.observe(at(200, 10, 8)))).toEqual([]); // 52 one way, 12 the other
    expect(ids(wrapY.observe(at(300, 10, 44)))).toEqual(["traveller"]); // 16 the other way
  });

  it("a body must be matched at every census: one missing census loses its origin", () => {
    const d = new FirstsDetector(CTX);
    d.observe(at(100, 10));
    d.observe(at(200, 20));
    d.observe(cen(300)); // gone for a census
    expect(ids(d.observe(at(400, 30)))).toEqual([]); // 20 from where it was first seen, but the log lost it
    expect(ids(d.observe(at(500, 45)))).toEqual([]); // 15 from the new origin
    expect(ids(d.observe(at(600, 46)))).toEqual(["traveller"]); // 16 from x = 30
  });

  it("a body first seen later has its own origin, and a still body never fires", () => {
    const d = new FirstsDetector(CTX);
    d.observe(at(100, 10, 10, 1));
    const both = (step: number, x2: number) => cen(step, { bodies: [body(1, 50, { cx: 10 }), body(2, 50, { cx: x2 })] });
    d.observe(both(200, 40));
    d.observe(both(300, 41));
    d.observe(both(400, 55));
    expect(find(d, "traveller")).toBeUndefined();
    expect(ids(d.observe(both(500, 56)))).toEqual(["traveller"]); // body 2: 56 - 40
  });

  it("distance is within a body's own tile: a body on a different tile than first seen restarts", () => {
    const d = new FirstsDetector({ ...CTX, tiles: 2 });
    d.observe(at(100, 5));
    d.observe(cen(200, { bodies: [body(1, 50, { cx: 40, tile: 1 })] }));
    expect(find(d, "traveller")).toBeUndefined();
    d.observe(cen(300, { bodies: [body(1, 50, { cx: 55, tile: 1 })] }));
    expect(find(d, "traveller")).toBeUndefined();
    expect(ids(d.observe(cen(400, { bodies: [body(1, 50, { cx: 56, tile: 1 })] })))).toEqual(["traveller"]);
    expect(find(d, "traveller")!.detail).toBe("moved 16.0 cells, in pond 2");
  });
});

describe("new lineage to last", () => {
  const A = (step: number, b: number): FirstsInput => cen(step, { lineages: [{ key: "A", cells: 100 }, ...(b >= 0 ? [{ key: "B", cells: b }] : [])] });

  it("fires at the census that completes 5,000 steps at 16 cells or more, never for a starting lineage", () => {
    const d = new FirstsDetector(CTX);
    d.observe(A(100, -1));
    for (let step = 200; step < 5200; step += 100) expect(d.observe(A(step, 16))).toEqual([]);
    // A has held 100 cells since the start, a starting lineage: it never counts
    expect(find(d, "new-lineage")).toBeUndefined();
    expect(ids(d.observe(A(5200, 16)))).toEqual(["new-lineage"]);
    expect(find(d, "new-lineage")).toMatchObject({ step: 5200, already: false });
    expect(find(d, "new-lineage")!.detail).toContain("lineage B");
    expect(find(d, "new-lineage")!.detail).toContain("t=200");
    expect(d.observe(A(5300, 16))).toEqual([]);
  });

  it("4,900 steps is not enough, and a dip below 16 cells for one census restarts the count", () => {
    const d = new FirstsDetector(CTX);
    d.observe(A(100, -1));
    for (let step = 200; step <= 5100; step += 100) expect(d.observe(A(step, step === 3000 ? 15 : 40))).toEqual([]);
    // held since t=3100 now; 4,900 steps by 8000, 5,000 at 8100
    for (let step = 5200; step < 8100; step += 100) expect(d.observe(A(step, 40))).toEqual([]);
    expect(ids(d.observe(A(8100, 40)))).toEqual(["new-lineage"]);
    expect(find(d, "new-lineage")!.detail).toContain("t=3,100");
  });

  it("a lineage that vanishes for a census restarts its count", () => {
    const d = new FirstsDetector(CTX);
    d.observe(A(100, -1));
    for (let step = 200; step <= 4000; step += 100) d.observe(A(step, 30));
    d.observe(A(4100, -1));
    for (let step = 4200; step <= 9100; step += 100) expect(d.observe(A(step, 30))).toEqual([]);
    expect(ids(d.observe(A(9200, 30)))).toEqual(["new-lineage"]);
    expect(find(d, "new-lineage")!.detail).toContain("t=4,200");
  });

  it("the lineage must hold 16 cells at every census, but its cells may vary above that", () => {
    const d = new FirstsDetector(CTX);
    d.observe(A(100, -1));
    let step = 200;
    for (; step < 5200; step += 100) d.observe(A(step, 16 + (step % 300)));
    expect(ids(d.observe(A(step, 20)))).toEqual(["new-lineage"]);
  });
});

describe("takeover", () => {
  const lead = (step: number, a: number, b: number, c = 0): FirstsInput =>
    cen(step, { lineages: [{ key: "A", cells: a }, { key: "B", cells: b }, ...(c ? [{ key: "C", cells: c }] : [])] });

  it("fires at the tenth census in a row led by one non-starting lineage, saying when the lead began", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { lineages: [{ key: "A", cells: 100 }] }));
    let step = 200;
    for (; step < 1100; step += 100) expect(d.observe(lead(step, 100, 120))).toEqual([]); // 9 censuses: 200..1000
    expect(ids(d.observe(lead(1100, 100, 120)))).toEqual(["takeover"]);
    expect(find(d, "takeover")).toMatchObject({ step: 1100, already: false, detail: "lineage B, ahead since t=200" });
    expect(d.observe(lead(1200, 100, 120))).toEqual([]);
  });

  it("an interrupted streak restarts, and the entry names when the unbroken lead began", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { lineages: [{ key: "A", cells: 100 }] }));
    for (let step = 200; step <= 800; step += 100) d.observe(lead(step, 100, 120)); // 7 censuses
    expect(d.observe(lead(900, 130, 120))).toEqual([]); // the starting lineage retakes the lead
    for (let step = 1000; step < 1900; step += 100) expect(d.observe(lead(step, 100, 120))).toEqual([]);
    expect(ids(d.observe(lead(1900, 100, 120)))).toEqual(["takeover"]);
    expect(find(d, "takeover")!.detail).toBe("lineage B, ahead since t=1,000");
  });

  it("a starting lineage leading never counts, however long", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { lineages: [{ key: "A", cells: 100 }, { key: "B", cells: 50 }] }));
    for (let step = 200; step <= 5000; step += 100) d.observe(lead(step, 150, 90));
    expect(find(d, "takeover")).toBeUndefined();
  });

  it("two different new leaders alternating never build a streak, and a tie goes to the smaller key", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { lineages: [{ key: "A", cells: 100 }] }));
    for (let step = 200; step <= 4000; step += 100) d.observe(step % 200 === 0 ? lead(step, 50, 90, 80) : lead(step, 50, 80, 90));
    expect(find(d, "takeover")).toBeUndefined();
    const tie = new FirstsDetector(CTX);
    tie.observe(cen(100, { lineages: [{ key: "A", cells: 100 }] }));
    for (let step = 200; step <= 1100; step += 100) tie.observe(lead(step, 50, 90, 90));
    expect(find(tie, "takeover")!.detail).toBe("lineage B, ahead since t=200");
  });

  it("a lineage tied for the most cells still has the most: a newcomer drawing level does not end its streak", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { lineages: [{ key: "A", cells: 100 }] }));
    for (let step = 200; step <= 1000; step += 100) d.observe(lead(step, 50, 120)); // B leads alone, 9 censuses
    expect(ids(d.observe(lead(1100, 50, 120, 120)))).toEqual(["takeover"]); // C draws level at the tenth
    expect(find(d, "takeover")!.detail).toBe("lineage B, ahead since t=200");
  });

  it("an empty jar resets the streak", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { lineages: [{ key: "A", cells: 100 }] }));
    for (let step = 200; step <= 800; step += 100) d.observe(lead(step, 100, 120));
    d.observe(cen(900, { lineages: [], livingCells: 0 }));
    for (let step = 1000; step <= 1800; step += 100) d.observe(lead(step, 100, 120));
    expect(find(d, "takeover")).toBeUndefined();
    expect(ids(d.observe(lead(1900, 100, 120)))).toEqual(["takeover"]);
  });
});

describe("v0 rules keep their behaviour under firsts-v2", () => {
  // The v0 scripted stream, verbatim, and the entries the v0 detector gave it (captured before firsts-v1 was written).
  const legacy = (n: number): FirstsInput[] => {
    const out: FirstsInput[] = [];
    for (let k = 0; k < n; k++) {
      const b1 = body(1, 20 + k, { cx: (5 + 0.7 * k) % 64, cy: 20 });
      const b2 = body(2, 10 + (k % 40), { generation: Math.floor(k / 10), cx: 30, cy: 40, tile: 1, geneCells: [k > 60 ? 10 + (k % 40) : 0] });
      out.push({
        step: 100 * (k + 1),
        bodies: [b1, b2],
        lineages: [{ key: "A", cells: 200 - k }, ...(k >= 3 ? [{ key: "B", cells: 16 + 2 * k }] : [])],
        fissions: Math.floor(k / 10),
        deaths: k % 7 === 0 ? 1 : 0,
        livingCells: 100,
        pondLeaders: [],
        wounds: [],
      });
    }
    return out;
  };

  it("the nine v0 entries keep their exact steps, flags and detail lines", () => {
    const d = new FirstsDetector({ tileW: 64, tileH: 64, tilesX: 2, tiles: 2, censusEvery: 100, pondPeriod: 500, pondReseeds: false, geneBits: [0] });
    feed(d, legacy(120));
    const v0 = new Set(FIRSTS_RULES.slice(0, 9).map((r) => r.id).concat("gene-0"));
    expect(d.entries().filter((e) => v0.has(e.id)).map((e) => [e.id, e.step, e.already, e.detail])).toEqual([
      ["body", 100, true, "20 cells, in pond 1"],
      ["split", 1100, false, "1 split counted since t=100"],
      ["body-40", 2100, false, "40 cells, in pond 1"],
      ["grandchild", 2100, false, "generation 2, 30 cells, in pond 2"],
      ["traveller", 2400, false, "moved 16.1 cells, in pond 1"],
      ["gen-5", 5100, false, "generation 5, 20 cells, in pond 2"],
      ["new-lineage", 5400, false, "lineage B, 122 cells, holding 16 or more since t=400"],
      ["gene-0", 6200, false, "31 of 31 cells carry it, in pond 2"],
      ["takeover", 7200, false, "lineage B, ahead since t=6,300"],
      ["body-100", 8100, false, "100 cells, in pond 1"],
    ]);
    // the only v1 rung this stream reaches, and the summary is v0's but for the rule set id
    expect(d.entries().filter((e) => !v0.has(e.id)).map((e) => [e.id, e.step, e.detail])).toEqual([["gen-10", 10100, "generation 10, 30 cells, in pond 2"]]);
    expect(d.summary()).toEqual({
      ruleSet: "firsts-v2",
      watchedFrom: 100,
      step: 12000,
      baseline: { bodies: 2, largestBody: 20, maxGeneration: 0, lineages: 1 },
      latest: { bodies: 2, largestBody: 139, maxGeneration: 11, lineages: 2 },
      startingLineages: 1,
      startingLineagesPresent: 1,
      lastBodyStep: 12000,
      bodiesLost: 17,
      bodiesLostAtCycle: 3,
      emptiedAt: null,
      censuses: 120,
    });
  });
});

describe("huge body and tenth generation", () => {
  it("fire at 250 cells and generation 10, once, and can already be there", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100));
    expect(ids(d.observe(cen(200, { bodies: [body(1, 249, { generation: 9 })] })))).toEqual(["body", "body-40", "body-100", "grandchild", "gen-5"]);
    const fired = d.observe(cen(300, { bodies: [body(1, 250, { generation: 10 })] }));
    expect(fired.map((e) => [e.id, e.name, e.already, e.detail])).toEqual([
      ["body-250", "First huge body", false, "250 cells"],
      ["gen-10", "Tenth generation", false, "generation 10, 250 cells"],
    ]);
    expect(d.observe(cen(400, { bodies: [body(1, 400, { generation: 12 })] }))).toEqual([]);
    const start = new FirstsDetector(CTX);
    expect(start.observe(cen(100, { bodies: [body(1, 300, { generation: 11 })] })).map((e) => [e.id, e.already])).toEqual([
      ["body", true], ["body-40", true], ["body-100", true], ["grandchild", true], ["gen-5", true], ["body-250", true], ["gen-10", true],
    ]);
  });

  it("read the largest body and the deepest living generation at the census; bodies do not add up", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100));
    expect(ids(d.observe(cen(200, { bodies: [body(1, 249), body(2, 100, { generation: 9 })] })))).toEqual(["body", "body-40", "body-100", "grandchild", "gen-5"]);
    expect(d.observe(cen(300, { bodies: [body(1, 200, { generation: 9 }), body(2, 200, { generation: 3 })] }))).toEqual([]);
    expect(ids(d.observe(cen(400, { bodies: [body(1, 249), body(2, 5, { generation: 10 })] })))).toEqual(["gen-10"]);
  });
});

describe("far traveller", () => {
  const at = (step: number, x: number, y: number, id = 1) => cen(step, { bodies: [body(id, 50, { cx: x, cy: y })] });

  it("fires at 32 cells from the same origin the traveller used, after the traveller", () => {
    const d = new FirstsDetector(CTX);
    d.observe(at(100, 0, 0));
    expect(d.observe(at(200, 11, 11))).toEqual([]);
    expect(ids(d.observe(at(300, 12, 12)))).toEqual(["traveller"]);
    // the origin was kept: (22, 22) is 31.1 from (0, 0), and (23, 23) is 32.5
    expect(d.observe(at(400, 22, 22))).toEqual([]);
    expect(d.observe(at(500, 23, 23)).map((e) => [e.id, e.name, e.step, e.already, e.detail])).toEqual([["far-traveller", "First far traveller", 500, false, "moved 32.5 cells"]]);
    expect(d.observe(at(600, 40, 40))).toEqual([]);
  });

  it("a jump straight past 32 fires both at one census, traveller first, and never as already there", () => {
    const d = new FirstsDetector(CTX);
    d.observe(at(100, 0, 0));
    expect(d.observe(at(200, 24, 24)).map((e) => [e.id, e.already, e.detail])).toEqual([
      ["traveller", false, "moved 33.9 cells"],
      ["far-traveller", false, "moved 33.9 cells"],
    ]);
  });

  it("a missing census loses the origin, even after the traveller fired", () => {
    const d = new FirstsDetector(CTX);
    d.observe(at(100, 0, 0));
    d.observe(at(200, 12, 12));
    expect(find(d, "traveller")).toBeDefined();
    d.observe(cen(300));
    d.observe(at(400, 30, 30)); // a new origin
    expect(d.observe(at(500, 50, 50))).toEqual([]); // 28.3 from it
    expect(ids(d.observe(at(600, 63, 63)))).toEqual(["far-traveller"]); // 43.8: the short way round on both axes
  });

  it("names the pond like the traveller", () => {
    const d = new FirstsDetector({ ...CTX, tiles: 2 });
    d.observe(cen(100, { bodies: [body(1, 50, { cx: 0, cy: 0, tile: 1 })] }));
    d.observe(cen(200, { bodies: [body(1, 50, { cx: 24, cy: 24, tile: 1 })] }));
    expect(find(d, "far-traveller")!.detail).toBe("moved 33.9 cells, in pond 2");
  });
});

describe("lineage to last 20,000 steps", () => {
  const A = (step: number, b: number): FirstsInput => cen(step, { lineages: [{ key: "A", cells: 100 }, ...(b >= 0 ? [{ key: "B", cells: b }] : [])] });

  it("fires at the census that completes 20,000 steps, from the run new-lineage counted, never for a starting lineage", () => {
    const d = new FirstsDetector(CTX);
    d.observe(A(100, -1));
    for (let step = 200; step < 20200; step += 100) d.observe(A(step, 16));
    expect(ids(d.entries())).toEqual(["new-lineage"]);
    expect(find(d, "new-lineage")!.step).toBe(5200);
    expect(ids(d.observe(A(20200, 16)))).toEqual(["lineage-20k"]);
    expect(find(d, "lineage-20k")).toMatchObject({ name: "First lineage to last 20,000 steps", step: 20200, already: false, detail: "lineage B, 16 cells, holding 16 or more since t=200" });
    expect(d.observe(A(20300, 16))).toEqual([]);
  });

  it("19,900 steps is not enough, and a dip or a vanishing restarts the count", () => {
    const d = new FirstsDetector(CTX);
    d.observe(A(100, -1));
    for (let step = 200; step <= 20100; step += 100) d.observe(A(step, step === 10000 ? 15 : 40)); // held since t=10,100
    expect(find(d, "lineage-20k")).toBeUndefined();
    for (let step = 20200; step < 30100; step += 100) expect(ids(d.observe(A(step, 40)))).not.toContain("lineage-20k");
    expect(ids(d.observe(A(30100, 40)))).toEqual(["lineage-20k"]);
    expect(find(d, "lineage-20k")!.detail).toContain("t=10,100");
    const v = new FirstsDetector(CTX);
    v.observe(A(100, -1));
    for (let step = 200; step <= 12000; step += 100) v.observe(A(step, step === 12000 ? -1 : 40));
    for (let step = 12100; step < 32100; step += 100) expect(ids(v.observe(A(step, 40)))).not.toContain("lineage-20k");
    expect(ids(v.observe(A(32100, 40)))).toEqual(["lineage-20k"]);
  });

  it("names the longest run, then the smaller key, when two have completed 20,000 steps at one census", () => {
    const run = (cFrom: number, bFrom: number) => {
      const d = new FirstsDetector(CTX);
      d.observe(cen(100, { lineages: [{ key: "A", cells: 100 }] }));
      const ls = (step: number) => [{ key: "A", cells: 100 }, ...(step >= bFrom ? [{ key: "B", cells: 30 }] : []), ...(step >= cFrom ? [{ key: "C", cells: 30 }] : [])];
      for (let step = 200; step <= 20100; step += 100) d.observe(cen(step, { lineages: ls(step) }));
      expect(find(d, "lineage-20k")).toBeUndefined();
      // the census after a gap: both runs have completed 20,000 steps
      d.observe(cen(20400, { lineages: ls(20400) }));
      return find(d, "lineage-20k")!.detail;
    };
    expect(run(200, 300)).toBe("lineage C, 30 cells, holding 16 or more since t=200");
    expect(run(300, 200)).toBe("lineage B, 30 cells, holding 16 or more since t=200");
    expect(run(200, 200)).toBe("lineage B, 30 cells, holding 16 or more since t=200");
  });
});

describe("second takeover", () => {
  const lead = (step: number, a: number, b: number, c = 0, e = 0): FirstsInput =>
    cen(step, { lineages: [{ key: "A", cells: a }, { key: "B", cells: b }, ...(c ? [{ key: "C", cells: c }] : []), ...(e ? [{ key: "D", cells: e }] : [])] });
  /** B takes over at t=1,100 (it has led since t=200). */
  const first = () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { lineages: [{ key: "A", cells: 100 }] }));
    for (let step = 200; step <= 1100; step += 100) d.observe(lead(step, 100, 120));
    expect(find(d, "takeover")!.step).toBe(1100);
    return d;
  };

  it("fires at the tenth census in a row led by another new lineage, counting from the census after the first", () => {
    const d = first();
    for (let step = 1200; step < 2100; step += 100) expect(d.observe(lead(step, 100, 120, 150))).toEqual([]); // 9 censuses: 1200..2000
    expect(ids(d.observe(lead(2100, 100, 120, 150)))).toEqual(["takeover-2"]);
    expect(find(d, "takeover-2")).toMatchObject({ name: "Second takeover", step: 2100, already: false, detail: "lineage C, ahead since t=1,200" });
    expect(d.observe(lead(2200, 100, 120, 150))).toEqual([]);
  });

  it("never counts the lineage the first takeover named, nor a starting lineage, and the most cells is over every lineage", () => {
    const d = first();
    for (let step = 1200; step <= 6000; step += 100) d.observe(lead(step, 100, 120)); // B keeps leading
    for (let step = 6100; step <= 9000; step += 100) d.observe(lead(step, 150, 140)); // A leads
    for (let step = 9100; step <= 12000; step += 100) d.observe(lead(step, 100, 130, 120)); // C is second to B
    expect(find(d, "takeover-2")).toBeUndefined();
  });

  it("a lineage that tied for the lead at the first takeover still needs ten more censuses after it", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { lineages: [{ key: "A", cells: 100 }] }));
    for (let step = 200; step <= 1100; step += 100) d.observe(lead(step, 50, 90, 90)); // B and C tied for ten censuses: B (smaller key) is named
    expect(find(d, "takeover")!.detail).toBe("lineage B, ahead since t=200");
    expect(find(d, "takeover-2")).toBeUndefined();
    for (let step = 1200; step < 2100; step += 100) expect(d.observe(lead(step, 50, 80, 90))).toEqual([]);
    expect(ids(d.observe(lead(2100, 50, 80, 90)))).toEqual(["takeover-2"]);
    expect(find(d, "takeover-2")!.detail).toBe("lineage C, ahead since t=1,200");
  });

  it("an interrupted streak restarts and a tie goes to the longer lead, then the smaller key", () => {
    const d = first();
    for (let step = 1200; step <= 1800; step += 100) d.observe(lead(step, 100, 120, 150)); // 7 censuses
    expect(d.observe(lead(1900, 100, 160, 150))).toEqual([]); // B, excluded, ahead: ends C's streak
    for (let step = 2000; step < 2900; step += 100) expect(d.observe(lead(step, 100, 120, 150, 150))).toEqual([]);
    expect(ids(d.observe(lead(2900, 100, 120, 150, 150)))).toEqual(["takeover-2"]);
    expect(find(d, "takeover-2")!.detail).toBe("lineage C, ahead since t=2,000");
  });
});

describe("several new rungs at one census", () => {
  it("fire in rule-table order", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { bodies: [body(1, 20, { cx: 0, cy: 0 })] }));
    const fired = d.observe(cen(200, { bodies: [body(1, 300, { cx: 23, cy: 23, generation: 10 })], fissions: 1 }));
    expect(ids(fired)).toEqual(["body-40", "body-100", "split", "grandchild", "gen-5", "traveller", "body-250", "gen-10", "far-traveller"]);
  });
});

describe("next up", () => {
  const A = (step: number, b: number): FirstsInput => cen(step, { lineages: [{ key: "A", cells: 100 }, ...(b >= 0 ? [{ key: "B", cells: b }] : [])] });
  const lead = (step: number, a: number, b: number): FirstsInput => cen(step, { lineages: [{ key: "A", cells: a }, { key: "B", cells: b }] });
  const row = (n: { id: string; value: number; target: number; unit: string; kind: string }) => [n.id, n.value, n.target, n.unit, n.kind];

  it("a fresh detector offers the first three rungs of the ladder at value 0", () => {
    const d = new FirstsDetector(CTX);
    expect(d.nextUp().map(row)).toEqual([
      ["body", 0, 1, "cells", "best"],
      ["body-40", 0, 40, "cells", "best"],
      ["split", 0, 1, "splits", "best"],
    ]);
    expect(d.nextUp()[1].name).toBe("First big body");
    expect(nextUp(d)).toEqual(d.nextUp());
    expect(nextUp(d, 2)).toEqual(d.nextUp(2));
  });

  it("body rungs show the largest body seen so far, which does not fall when the body shrinks", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100));
    d.observe(cen(200, { bodies: [body(1, 30)] }));
    expect(d.nextUp().map(row)).toEqual([
      ["body-40", 30, 40, "cells", "best"],
      ["split", 0, 1, "splits", "best"],
      ["grandchild", 0, 2, "generations", "best"],
    ]);
    d.observe(cen(300, { bodies: [body(1, 10)] }));
    expect(d.nextUp()[0].value).toBe(30);
    expect(d.nextUp(20).filter((n) => n.unit === "cells").map((n) => [n.id, n.value, n.target])).toEqual([["body-40", 30, 40], ["body-100", 30, 100], ["body-250", 30, 250]]);
  });

  it("generation rungs show the deepest generation seen so far", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { bodies: [body(1, 50, { generation: 1 })] }));
    expect(d.nextUp(4).map(row)).toContainEqual(["grandchild", 1, 2, "generations", "best"]);
    d.observe(cen(200, { bodies: [body(1, 50, { generation: 4 })] }));
    d.observe(cen(300, { bodies: [body(1, 50, { generation: 2 })] }));
    const gens = d.nextUp(20).filter((n) => n.unit === "generations");
    expect(gens.map(row)).toEqual([["gen-5", 4, 5, "generations", "best"], ["gen-10", 4, 10, "generations", "best"]]);
  });

  it("traveller rungs show the farthest a tracked body has moved from where it was first seen, in whole cells", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { bodies: [body(1, 50, { cx: 10 })] }));
    d.observe(cen(200, { bodies: [body(1, 50, { cx: 20.9 })] }));
    expect(d.nextUp(20).filter((n) => n.unit === "cells moved").map(row)).toEqual([["traveller", 10, 16, "cells moved", "best"], ["far-traveller", 10, 32, "cells moved", "best"]]);
    d.observe(cen(300, { bodies: [body(1, 50, { cx: 12 })] })); // back again: the best stands
    expect(d.nextUp(20).find((n) => n.id === "traveller")!.value).toBe(10);
    d.observe(cen(400, { bodies: [body(1, 50, { cx: 26 })] })); // traveller fires
    expect(d.nextUp(20).filter((n) => n.unit === "cells moved").map(row)).toEqual([["far-traveller", 16, 32, "cells moved", "best"]]);
  });

  it("lineage rungs show the longest unbroken run held now, and fall to 0 on a dip", () => {
    const d = new FirstsDetector(CTX);
    d.observe(A(100, -1));
    expect(d.nextUp(20).find((n) => n.id === "new-lineage")).toMatchObject({ value: 0, target: 5000, unit: "steps", kind: "now" });
    d.observe(A(200, 30));
    d.observe(A(1200, 30));
    expect(d.nextUp(20).find((n) => n.id === "new-lineage")!.value).toBe(1000);
    expect(d.nextUp(20).find((n) => n.id === "lineage-20k")).toMatchObject({ value: 1000, target: 20000, kind: "now" });
    d.observe(A(1300, 15));
    expect(d.nextUp(20).find((n) => n.id === "new-lineage")!.value).toBe(0);
    d.observe(A(1400, 30));
    d.observe(A(1900, 30));
    expect(d.nextUp(20).find((n) => n.id === "new-lineage")!.value).toBe(500);
    // after new-lineage fired the 20,000-step rung keeps counting the same run
    for (let step = 2000; step <= 6400; step += 100) d.observe(A(step, 30));
    expect(find(d, "new-lineage")!.step).toBe(6400);
    expect(d.nextUp(20).find((n) => n.id === "lineage-20k")).toMatchObject({ value: 5000, target: 20000 });
  });

  it("takeover rungs show the longest current lead, in censuses, and fall to 0 when it ends", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { lineages: [{ key: "A", cells: 100 }] }));
    expect(d.nextUp(20).find((n) => n.id === "takeover")).toMatchObject({ value: 0, target: 10, unit: "censuses", kind: "now" });
    for (let step = 200; step <= 500; step += 100) d.observe(lead(step, 100, 120));
    expect(d.nextUp(20).find((n) => n.id === "takeover")!.value).toBe(4);
    expect(d.nextUp(20).find((n) => n.id === "takeover-2")!.value).toBe(0);
    d.observe(lead(600, 130, 120));
    expect(d.nextUp(20).find((n) => n.id === "takeover")!.value).toBe(0);
    for (let step = 700; step <= 1500; step += 100) d.observe(lead(step, 100, 120)); // 9 censuses
    expect(d.nextUp(20).find((n) => n.id === "takeover")!.value).toBe(9);
    d.observe(lead(1600, 100, 120)); // the tenth
    expect(d.nextUp(20).find((n) => n.id === "takeover")).toBeUndefined();
    expect(d.nextUp(20).find((n) => n.id === "takeover-2")!.value).toBe(0);
    d.observe(cen(1700, { lineages: [{ key: "A", cells: 100 }, { key: "B", cells: 120 }, { key: "C", cells: 150 }] }));
    d.observe(cen(1800, { lineages: [{ key: "A", cells: 100 }, { key: "B", cells: 120 }, { key: "C", cells: 150 }] }));
    expect(d.nextUp(20).find((n) => n.id === "takeover-2")!.value).toBe(2);
  });

  it("gene rungs follow the ladder, showing the latest census's best share of a body's cells, needing more than half", () => {
    const d = new FirstsDetector({ ...CTX, geneBits: [0, 1] });
    expect(d.nextUp(30).map((n) => n.id)).toEqual([...FIRSTS_LADDER, "gene-0", "gene-1"]);
    d.observe(cen(100, { bodies: [body(1, 20, { geneCells: [8, 0] }), body(2, 30, { geneCells: [3, 10] })] }));
    const gene = (b: number) => d.nextUp(20).find((n) => n.id === `gene-${b}`)!;
    expect(gene(0)).toMatchObject({ value: 40, target: 50, unit: "% of a body’s cells", kind: "now", above: true });
    expect(gene(1).value).toBe(33);
    d.observe(cen(200, { bodies: [body(1, 20, { geneCells: [4, 0] })] }));
    expect(gene(0).value).toBe(20);
    expect(gene(1).value).toBe(0);
    expect(d.nextUp(20).filter((n) => !n.id.startsWith("gene-")).every((n) => n.above === undefined)).toBe(true);
  });

  it("skips rungs already reached, offers the gene rungs once every other rung is, and then the list is empty", () => {
    const d = new FirstsDetector({ ...CTX, tiles: 2, pondPeriod: 500, geneBits: [0, 1] });
    expect(d.nextUp(3).map((n) => n.id)).toEqual(["body", "body-40", "split"]);
    feed(d, stream(240).map((i) => ({ ...i, bodies: i.bodies.map((b) => ({ ...b, geneCells: [b.geneCells?.[0] ?? 0, 0] })) })));
    expect(d.entries().map((e) => e.id).sort()).toEqual(firstsRules([0, 1]).map((r) => r.id).filter((id) => id !== "gene-1").sort());
    expect(d.nextUp().map(row)).toEqual([["gene-1", 0, 50, "% of a body’s cells", "now"]]);
    const plain = new FirstsDetector({ ...CTX, tiles: 2, pondPeriod: 500, geneBits: [0] });
    feed(plain, stream(240));
    expect(plain.nextUp()).toEqual([]);
  });

  it("count clamps, and reading it changes nothing", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { bodies: [body(1, 30)] }));
    const before = JSON.stringify(d.snapshot());
    expect(d.nextUp(0)).toEqual([]);
    expect(d.nextUp(-4)).toEqual([]);
    expect(d.nextUp(100).map((n) => n.id)).toEqual(FIRSTS_LADDER.filter((id) => id !== "body"));
    expect(d.nextUp(2)).toHaveLength(2);
    expect(JSON.stringify(d.snapshot())).toBe(before);
  });

  it("a replay shows the same numbers: a restored detector's list equals the original's", () => {
    const all = stream(120);
    const a = new FirstsDetector({ tileW: 64, tileH: 64, tilesX: 2, tiles: 2, censusEvery: 100, pondPeriod: 500, pondReseeds: false, geneBits: [0] });
    feed(a, all.slice(0, 60));
    const b = FirstsDetector.restore(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.nextUp(20)).toEqual(a.nextUp(20));
    feed(a, all.slice(60));
    feed(b, all.slice(60));
    expect(b.nextUp(20)).toEqual(a.nextUp(20));
  });
});

describe("gene rules", () => {
  it("fire only for the context's gene bits, on a strict majority of a body's cells", () => {
    const d = new FirstsDetector({ ...CTX, geneBits: [0, 1] });
    d.observe(cen(100, { bodies: [body(1, 20, { geneCells: [0, 0] })] }));
    expect(d.observe(cen(200, { bodies: [body(1, 20, { geneCells: [10, 0] })] }))).toEqual([]); // half is not more than half
    const fired = d.observe(cen(300, { bodies: [body(1, 20, { geneCells: [11, 5] }), body(2, 10, { geneCells: [2, 5] })] }));
    expect(fired.map((e) => [e.id, e.name, e.detail])).toEqual([["gene-0", "First carrier body of gene 0", "11 of 20 cells carry it"]]);
    expect(ids(d.observe(cen(400, { bodies: [body(2, 10, { geneCells: [0, 6] })] })))).toEqual(["gene-1"]);
    expect(d.observe(cen(500, { bodies: [body(2, 10, { geneCells: [10, 10] })] }))).toEqual([]);
  });

  it("a world without genes has no gene rules, whatever the bodies carry", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100));
    feed(d, [cen(200, { bodies: [body(1, 20, { geneCells: [20] })] }), cen(300, { bodies: [body(1, 20, { geneCells: [20, 20] })] })]);
    expect(ids(d.entries())).toEqual(["body"]);
    // a gene world whose bodies carry no counts (the census was fed without genome words) fires nothing and does not throw
    const g = new FirstsDetector({ ...CTX, geneBits: [0] });
    g.observe(cen(100));
    expect(g.observe(cen(200, { bodies: [body(1, 20)] })).map((e) => e.id)).toEqual(["body"]);
  });

  it("the gene bit named in the context need not be bit 0 of the byte", () => {
    const d = new FirstsDetector({ ...CTX, geneBits: [1] });
    d.observe(cen(100));
    expect(ids(d.observe(cen(200, { bodies: [body(1, 20, { geneCells: [15] })] })))).toEqual(["body", "gene-1"]);
  });
});

describe("step guard", () => {
  it("a census at or below the last step is a no-op", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { bodies: [body(1, 30)] }));
    d.observe(cen(200, { bodies: [body(1, 45)], deaths: 2 }));
    const before = JSON.stringify(d.snapshot());
    const sum = d.summary();
    expect(d.observe(cen(200, { bodies: [body(1, 300)], fissions: 9, deaths: 5 }))).toEqual([]);
    expect(d.observe(cen(100, { bodies: [body(1, 300)], fissions: 9 }))).toEqual([]);
    expect(d.observe(cen(0, { bodies: [body(1, 300)] }))).toEqual([]);
    expect(JSON.stringify(d.snapshot())).toBe(before);
    expect(d.summary()).toEqual(sum);
    expect(d.lastStep).toBe(200);
    expect(d.observe(cen(201, { bodies: [body(1, 300)] })).map((e) => e.id)).toEqual(["body-100", "body-250"]);
  });

  it("never throws on empty bodies and lineages", () => {
    const d = new FirstsDetector({ ...CTX, geneBits: [0] });
    expect(() => feed(d, [cen(100), cen(200), cen(300, { bodies: [], lineages: [], livingCells: 0 })])).not.toThrow();
    expect(d.entries()).toEqual([]);
    expect(d.summary().baseline).toEqual({ bodies: 0, largestBody: 0, maxGeneration: 0, lineages: 0 });
    expect(new FirstsDetector(CTX).summary()).toMatchObject({ watchedFrom: null, step: null, baseline: null, latest: null, lastBodyStep: null, censuses: 0 });
  });

  it("keeps no reference to what it was fed", () => {
    const d = new FirstsDetector({ ...CTX, geneBits: [0] });
    const b = body(1, 50, { cx: 10, geneCells: [3] });
    const lineages = [{ key: "A", cells: 50 }];
    d.observe(cen(100, { bodies: [b], lineages }));
    const before = JSON.stringify(d.snapshot());
    b.cx = 40;
    b.cells = 500;
    b.geneCells = [500];
    lineages[0].cells = 0;
    lineages.push({ key: "Z", cells: 9 });
    expect(JSON.stringify(d.snapshot())).toBe(before);
    expect(d.observe(cen(200, { bodies: [body(1, 50, { cx: 10 })], lineages: [{ key: "A", cells: 50 }] }))).toEqual([]);
  });
});

describe("summary", () => {
  it("counts bodies lost (not at the first census), those at a pond cycle, starting lineages present and the jar emptying", () => {
    const d = new FirstsDetector({ ...CTX, tiles: 4, pondPeriod: 400 });
    d.observe(cen(100, { bodies: [body(1, 60)], lineages: [{ key: "A", cells: 60 }, { key: "B", cells: 20 }], deaths: 3 }));
    d.observe(cen(200, { bodies: [body(1, 70)], lineages: [{ key: "A", cells: 70 }, { key: "B", cells: 5 }, { key: "C", cells: 9 }], deaths: 1 }));
    d.observe(cen(300, { bodies: [], lineages: [{ key: "A", cells: 12 }, { key: "C", cells: 9 }], deaths: 1 }));
    d.observe(cen(400, { bodies: [], lineages: [{ key: "C", cells: 9 }], deaths: 1 })); // a boundary is 400: its deaths show at 500
    d.observe(cen(500, { bodies: [], lineages: [{ key: "C", cells: 9 }], deaths: 4 }));
    let s = d.summary();
    expect(s).toMatchObject({
      ruleSet: FIRSTS_RULESET,
      watchedFrom: 100,
      step: 500,
      startingLineages: 2,
      startingLineagesPresent: 0,
      lastBodyStep: 200,
      bodiesLost: 7,
      bodiesLostAtCycle: 4,
      emptiedAt: null,
      censuses: 5,
    });
    expect(s.baseline).toEqual({ bodies: 1, largestBody: 60, maxGeneration: 0, lineages: 2 });
    expect(s.latest).toEqual({ bodies: 0, largestBody: 0, maxGeneration: 0, lineages: 1 });
    d.observe(cen(600, { bodies: [], lineages: [], livingCells: 0 }));
    d.observe(cen(700, { bodies: [body(9, 60)], lineages: [{ key: "D", cells: 60 }] }));
    d.observe(cen(800, { bodies: [], lineages: [], livingCells: 0 }));
    s = d.summary();
    expect(s.emptiedAt).toBe(600); // the first, and it stays
    expect(s.lastBodyStep).toBe(700);
  });

  it("a world that never had life does not 'empty'", () => {
    const d = new FirstsDetector(CTX);
    feed(d, [cen(100, { lineages: [], livingCells: 0 }), cen(200, { lineages: [], livingCells: 0 })]);
    expect(d.summary().emptiedAt).toBeNull();
  });

  it("a world without a pond period never counts deaths at a cycle", () => {
    const d = new FirstsDetector(CTX);
    feed(d, [cen(100), cen(200, { deaths: 2 }), cen(300, { deaths: 2 })]);
    expect(d.summary()).toMatchObject({ bodiesLost: 4, bodiesLostAtCycle: 0 });
  });
});

describe("snapshot and restore", () => {
  const ctx = STREAM_CTX;

  it("the scripted stream fires every rule, the new rungs at the steps its design gives", () => {
    const d = new FirstsDetector(ctx);
    feed(d, stream(240));
    expect(d.entries().map((e) => e.id).sort()).toEqual(firstsRules([0]).map((r) => r.id).sort());
    const at = (id: string) => [find(d, id)!.step, find(d, id)!.already];
    expect([at("traveller"), at("far-traveller"), at("new-lineage"), at("takeover"), at("takeover-2"), at("gen-10"), at("lineage-20k"), at("body-250")]).toEqual([
      [2000, false], [3900, false], [5400, false], [7200, false], [10000, false], [10100, false], [20400, false], [23100, false],
    ]);
    expect(find(d, "takeover-2")!.detail).toBe("lineage C, ahead since t=9,100");
    expect(find(d, "lineage-20k")!.detail).toContain("lineage B");
    // the v2 rungs: a moving pond once six censuses are watched, a long body, a change of hands, an outlived wound, the family split
    expect(["moving-pond", "long-body", "pond-change", "outlive-wound", "new-family"].map((id) => [id, find(d, id)!.step, find(d, id)!.already, find(d, id)!.detail])).toEqual([
      ["moving-pond", 600, false, "pond 2: 2 of 3 bodies, 24 of 39 cells, moving"],
      ["long-body", 3100, false, "3.5 times as long as wide, 50 cells, in pond 1"],
      ["pond-change", 1500, false, "lineage A led from t=100; lineage B ahead since t=1,100, in pond 1"],
      ["outlive-wound", 4300, false, "wounded at t=4,050 (radius 10, 39 cells lost), 3 bodies now, in pond 2"],
      ["new-family", 10100, false, "Reed amber from Reed, 34 and 120 cells"],
    ]);
    expect(d.nextUp()).toEqual([]);
  });

  it("restoring at any census then feeding the rest gives the same log as an uninterrupted detector", () => {
    const all = stream(240);
    const whole = new FirstsDetector(ctx);
    feed(whole, all);
    for (const cut of [0, 1, 4, 5, 6, 9, 10, 13, 14, 15, 19, 20, 23, 24, 25, 29, 30, 31, 38, 39, 40, 41, 42, 43, 52, 53, 54, 70, 71, 72, 89, 90, 99, 100, 101, 119, 203, 204, 230, 231, 239]) {
      const a = new FirstsDetector(ctx);
      feed(a, all.slice(0, cut));
      const snap = JSON.parse(JSON.stringify(a.snapshot()));
      const b = FirstsDetector.restore(snap);
      expect(b.snapshot()).toEqual(a.snapshot());
      const rest = all.slice(cut);
      const fa = feed(a, rest);
      const fb = feed(b, rest);
      expect(fb).toEqual(fa);
      expect(b.entries()).toEqual(whole.entries());
      expect(b.summary()).toEqual(whole.summary());
      expect(b.nextUp(20)).toEqual(whole.nextUp(20));
      expect(JSON.stringify(b.snapshot())).toBe(JSON.stringify(whole.snapshot()));
    }
  });

  it("a restored detector keeps its step guard and watchedFrom", () => {
    const all = stream(10);
    const a = new FirstsDetector(ctx);
    feed(a, all);
    const b = FirstsDetector.restore(structuredClone(a.snapshot()));
    expect(b.watchedFrom).toBe(100);
    expect(b.lastStep).toBe(1000);
    expect(b.observe(all[9])).toEqual([]);
    expect(b.observe(all[3])).toEqual([]);
  });

  it("restoring is independent of the snapshot object and the detector it came from", () => {
    const a = new FirstsDetector(ctx);
    feed(a, stream(30));
    const snap = a.snapshot();
    const b = FirstsDetector.restore(snap);
    feed(a, stream(60).slice(30));
    expect(b.lastStep).toBe(3000);
    expect(snap.lastStep).toBe(3000);
    feed(b, stream(40).slice(30));
    expect(snap.lastStep).toBe(3000);
  });

  it("a fresh detector's snapshot restores", () => {
    const b = FirstsDetector.restore(JSON.parse(JSON.stringify(new FirstsDetector(ctx).snapshot())));
    expect(b.watchedFrom).toBeNull();
    expect(b.lastStep).toBeNull();
    expect(feed(b, stream(2)).map((e) => e.id)).toEqual(["body"]);
  });

  it("refuses what is not a snapshot", () => {
    const good = new FirstsDetector(ctx);
    feed(good, stream(5));
    const snap = () => JSON.parse(JSON.stringify(good.snapshot()));
    const bad = (mut: (s: Record<string, unknown>) => void) => {
      const s = snap();
      mut(s);
      expect(() => FirstsDetector.restore(s)).toThrow();
    };
    expect(() => FirstsDetector.restore(snap())).not.toThrow();
    bad((s) => (s.v = 1));
    bad((s) => (s.ruleSet = "firsts-v0"));
    bad((s) => ((s.v = 1), (s.ruleSet = "firsts-v0")));
    bad((s) => delete s.ctx);
    bad((s) => ((s.ctx as Record<string, unknown>).geneBits = [9]));
    bad((s) => delete s.entries);
    bad((s) => (s.entries = [{ id: "nope", name: "x", step: 1, already: false, detail: "" }]));
    bad((s) => (s.entries = [...(s.entries as unknown[]), (s.entries as unknown[])[0]]));
    bad((s) => (s.seen = [[1, 2]]));
    bad((s) => (s.held = [[1, 2]]));
    bad((s) => (s.lastStep = null));
    bad((s) => (s.censuses = -1));
    bad((s) => (s.bestBody = -1));
    bad((s) => delete s.bestGen);
    bad((s) => (s.farthest = null));
    bad((s) => (s.lastFissions = 1.5));
    bad((s) => (s.geneShare = []));
    bad((s) => (s.geneShare = [101]));
    bad((s) => (s.takeoverKey = "B")); // no takeover entry yet
    bad((s) => (s.takeoverKey = 7));
    // v2 fields
    bad((s) => (s.v = 2));
    bad((s) => ((s.v = 2), (s.ruleSet = "firsts-v1")));
    bad((s) => delete s.trail);
    bad((s) => (s.trail = [[100, [[1, 2, 3]]]]));
    bad((s) => (s.trail = [[100, []], [100, []]]));
    bad((s) => (s.trail = [[100, [[1, 2, 3, 9]]]])); // a tile past the world's
    bad((s) => (s.trail = Array.from({ length: 6 }, (_, i) => [100 * (i + 1), []])));
    bad((s) => (s.pondLead = []));
    bad((s) => (s.pondLead = [{ cur: ["A", 100, 0], est: null }, { cur: null, est: null }]));
    bad((s) => (s.pondLead = [{ cur: null }, { cur: null, est: null }]));
    bad((s) => (s.pondCells = [1]));
    bad((s) => (s.pondCells = [1, -1]));
    bad((s) => (s.wounds = [[100, 5, 10, 0, 3]]));
    bad((s) => (s.wounds = [[100, 1, 10, 0, 0]]));
    bad((s) => (s.movingShare = 101));
    bad((s) => (s.bestLong = -1));
    bad((s) => (s.candidateRun = 1.5));
    bad((s) => delete (s.ctx as Record<string, unknown>).tilesX);
    bad((s) => {
      // reseeds with no period
      delete (s.ctx as Record<string, unknown>).pondPeriod;
      (s.ctx as Record<string, unknown>).pondReseeds = true;
    });
    bad((s) => ((s.ctx as Record<string, unknown>).pondReseeds = "yes"));
    expect(() => FirstsDetector.restore(null as never)).toThrow();
  });
});

describe("buildFirstsInput on a real census", () => {
  it("reads bodies, generation, gene cells, lineages, fissions and deaths from the census and the tracker", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, genes: "decomp" });
    const n = 32 * 32;
    const make = (step: number, blocks: { x0: number; x1: number; hi: number; gene: boolean }[]) => {
      const cells = new Uint32Array(7 * n);
      const genomeHead = new Uint32Array(4 * n);
      for (const b of blocks)
        for (let y = 4; y <= 13; y++)
          for (let x = b.x0; x <= b.x1; x++) {
            const i = y * 32 + x;
            cells[CH.B * n + i] = 64;
            genomeHead[G.LIN_HI * n + i] = b.hi;
            genomeHead[G.LIN_LO * n + i] = 1;
            genomeHead[G.PARAM1 * n + i] = b.gene ? (1 << GENE_SHIFT) >>> 0 : 0;
          }
      return { c: census({ cfg, step, cells, genomeHead }), genomeHead };
    };
    const ctx = firstsContext(cfg, 100);
    expect(ctx.geneBits).toEqual([0]);
    const tracker = new Tracker();

    // census 1: one 100-cell body, half of it carrying the gene
    const one = make(100, [{ x0: 4, x1: 13, hi: 0, gene: false }]);
    for (let y = 4; y <= 13; y++) for (let x = 4; x <= 8; x++) one.genomeHead[G.PARAM1 * n + y * 32 + x] = (1 << GENE_SHIFT) >>> 0;
    const ev1 = tracker.update(one.c);
    const in1 = buildFirstsInput(one.c, tracker, one.genomeHead, ev1, ctx);
    expect(in1.step).toBe(100);
    expect(in1.bodies).toHaveLength(1);
    expect(in1.bodies[0]).toMatchObject({ cells: 100, generation: 0, tile: 0, lineage: "0:1", geneCells: [50] });
    expect(in1.bodies[0].cx).toBeCloseTo(8.5, 5);
    expect(in1.lineages).toEqual([{ key: "0:1", cells: 100 }]);
    expect(in1.fissions).toBe(0);
    expect(in1.deaths).toBe(0);
    expect(in1.livingCells).toBe(100);

    // census 2: the body splits into a 50-cell body with the gene and a 20-cell body of a new lineage
    const two = make(200, [
      { x0: 4, x1: 8, hi: 0, gene: true },
      { x0: 12, x1: 13, hi: 150, gene: false },
    ]);
    const ev2 = tracker.update(two.c);
    const in2 = buildFirstsInput(two.c, tracker, two.genomeHead, ev2, ctx);
    expect(in2.fissions).toBe(1);
    expect(in2.bodies.map((b) => [b.cells, b.generation, b.geneCells]).sort()).toEqual([[20, 1, [0]], [50, 0, [50]]].sort());
    expect(in2.bodies[0].id).not.toBe(in2.bodies[1].id);
    expect(in2.lineages.map((l) => l.key).sort()).toEqual(["0:1", "150:1"]);
    expect(in2.livingCells).toBe(70);

    // without genome words, or in a world without genes, no gene counts and no throw
    expect(buildFirstsInput(two.c, tracker, undefined, ev2, ctx).bodies.every((b) => b.geneCells === undefined)).toBe(true);
    expect(buildFirstsInput(two.c, tracker, two.genomeHead, ev2, { ...ctx, geneBits: [] }).bodies.every((b) => b.geneCells === undefined)).toBe(true);

    // census 3: both bodies vanish; the tracker's death events are counted
    const three = make(300, []);
    const ev3 = tracker.update(three.c);
    expect(buildFirstsInput(three.c, tracker, three.genomeHead, ev3, ctx)).toMatchObject({ bodies: [], deaths: 2, fissions: 1, livingCells: 0 });

    // through the detector: the split and the gene carrier are firsts at census 2, the body was already there at census 1
    const d = new FirstsDetector(ctx);
    expect(d.observe(in1).map((e) => [e.id, e.already])).toEqual([["body", true], ["body-40", true], ["body-100", true]]);
    expect(d.observe(in2).map((e) => [e.id, e.already])).toEqual([["split", false], ["gene-0", false]]);
    expect(find(d, "gene-0")!.detail).toBe("50 of 50 cells carry it");
  });
});


// ---- firsts-v2 ---------------------------------------------------------------------------------------------------------------------------

/** Two ponds side by side; a 600-step reseeding cycle when `reseeds` (boundaries at 600, 1,200, ...). */
const PONDS: FirstsContext = { tileW: 64, tileH: 64, tilesX: 2, tiles: 2, censusEvery: 100, pondPeriod: 600, pondReseeds: true, geneBits: [] };
const PONDS_CONT: FirstsContext = { ...PONDS, pondReseeds: false };
/** The steps 100, 200, ..., 100 * n. */
const upTo = (n: number) => Array.from({ length: n }, (_, k) => 100 * (k + 1));

describe("moving pond", () => {
  /** Two 20-cell bodies in pond 2 at x = 10 and 30, plus whatever `more` adds; `dx(step)` is how far the first two are from there. */
  const mv = (step: number, dx: number, more: FirstsBody[] = []) =>
    cen(step, { bodies: [body(1, 20, { cx: 10 + dx, tile: 1 }), body(2, 20, { cx: 30 + dx, tile: 1 }), ...more] });

  it("fires at the sixth census, when two bodies matched throughout have each moved 8 cells, naming the pond", () => {
    const d = new FirstsDetector(PONDS_CONT);
    for (const step of upTo(5)) expect(ids(d.observe(mv(step, 0)).filter((e) => e.id === "moving-pond"))).toEqual([]);
    // jumping at the sixth: censuses 100..500 are at home, the oldest of the six is 100
    expect(d.observe(mv(600, 7.9)).filter((e) => e.id === "moving-pond")).toEqual([]);
    const fired = new FirstsDetector(PONDS_CONT);
    for (const step of upTo(5)) fired.observe(mv(step, 0));
    const got = fired.observe(mv(600, 8)).filter((e) => e.id === "moving-pond");
    expect(got.map((e) => [e.name, e.step, e.already, e.detail])).toEqual([["First moving pond", 600, false, "pond 2: 2 of 2 bodies, 40 of 40 cells, moving"]]);
    expect(fired.observe(mv(700, 20)).filter((e) => e.id === "moving-pond")).toEqual([]);
  });

  it("needs two moving bodies, holding at least half of the pond's body cells", () => {
    const run = (more: FirstsBody[], twoMove = true) => {
      const d = new FirstsDetector(PONDS_CONT);
      for (const step of upTo(5)) d.observe(cen(step, { bodies: [body(1, 20, { cx: 10, tile: 1 }), body(2, 20, { cx: 30, tile: 1 }), ...more] }));
      d.observe(cen(600, { bodies: [body(1, 20, { cx: 20, tile: 1 }), body(2, 20, { cx: twoMove ? 40 : 30, tile: 1 }), ...more] }));
      return find(d, "moving-pond");
    };
    expect(run([body(3, 40, { cx: 50, tile: 1 })])!.detail).toBe("pond 2: 2 of 3 bodies, 40 of 80 cells, moving"); // exactly half is enough
    expect(run([body(3, 41, { cx: 50, tile: 1 })])).toBeUndefined();
    expect(run([], false)).toBeUndefined(); // one moving body is not a moving pond
    // a body in another pond counts for that pond only
    expect(run([body(3, 500, { cx: 50, tile: 0 })])!.detail).toBe("pond 2: 2 of 2 bodies, 40 of 40 cells, moving");
  });

  it("a body must be matched at all six censuses, in the same pond", () => {
    const d = new FirstsDetector(PONDS_CONT);
    for (const step of upTo(5)) d.observe(step === 300 ? cen(step, { bodies: [body(1, 20, { cx: 10, tile: 1 })] }) : mv(step, 0));
    d.observe(mv(600, 20));
    expect(find(d, "moving-pond")).toBeUndefined(); // body 2 was missing at 300
    const t = new FirstsDetector(PONDS_CONT);
    for (const step of upTo(5)) t.observe(mv(step, 0));
    t.observe(cen(600, { bodies: [body(1, 20, { cx: 30, tile: 0 }), body(2, 20, { cx: 50, tile: 0 })] })); // same ids, other pond
    expect(find(t, "moving-pond")).toBeUndefined();
  });

  it("measures the move on the pond's torus", () => {
    const d = new FirstsDetector(PONDS_CONT);
    for (const step of upTo(5)) d.observe(cen(step, { bodies: [body(1, 20, { cx: 62, tile: 0 }), body(2, 20, { cx: 61, tile: 0 })] }));
    // 62 -> 6 is 8 cells the short way round, 61 -> 4 is 7
    d.observe(cen(600, { bodies: [body(1, 20, { cx: 6, tile: 0 }), body(2, 20, { cx: 4, tile: 0 })] }));
    expect(find(d, "moving-pond")).toBeUndefined();
    d.observe(cen(700, { bodies: [body(1, 20, { cx: 6, tile: 0 }), body(2, 20, { cx: 5, tile: 0 })] })); // 61 -> 5 is 8
    expect(find(d, "moving-pond")!.detail).toBe("pond 1: 2 of 2 bodies, 40 of 40 cells, moving");
  });

  it("names the pond with the largest share of moving cells, then the smaller pond, and says no pond when there is one", () => {
    const d = new FirstsDetector({ ...PONDS_CONT, tiles: 3 });
    const at = (step: number, away: boolean) =>
      cen(step, {
        bodies: [
          body(1, 10, { cx: away ? 30 : 10, tile: 0 }), body(2, 10, { cx: away ? 30 : 10, tile: 0 }), body(3, 10, { cx: 50, tile: 0 }), // 2 of 3 bodies, 20 of 30 cells
          body(4, 10, { cx: away ? 30 : 10, tile: 2 }), body(5, 10, { cx: away ? 30 : 10, tile: 2 }), body(6, 6, { cx: 50, tile: 2 }), // 20 of 26 cells
          body(7, 10, { cx: away ? 30 : 10, tile: 1 }), body(8, 10, { cx: away ? 30 : 10, tile: 1 }), body(9, 6, { cx: 50, tile: 1 }), // 20 of 26 cells
        ],
      });
    for (const step of upTo(5)) d.observe(at(step, false));
    d.observe(at(600, true));
    expect(find(d, "moving-pond")!.detail).toBe("pond 2: 2 of 3 bodies, 20 of 26 cells, moving");
    const one = new FirstsDetector(CTX);
    for (const step of upTo(5)) one.observe(cen(step, { bodies: [body(1, 20, { cx: 10 }), body(2, 20, { cx: 30 })] }));
    one.observe(cen(600, { bodies: [body(1, 20, { cx: 20 }), body(2, 20, { cx: 40 })] }));
    expect(find(one, "moving-pond")!.detail).toBe("2 of 2 bodies, 40 of 40 cells, moving");
  });

  it("is never 'already there': it needs six watched censuses", () => {
    const d = new FirstsDetector(PONDS_CONT);
    expect(CTX.pondReseeds).toBe(false);
    for (const step of upTo(5)) d.observe(mv(step, 0));
    d.observe(mv(600, 30));
    expect(find(d, "moving-pond")!.already).toBe(false);
  });

  it("within one cycle: a boundary inside the span stops it, the census at the boundary does not", () => {
    // home until step 700, away from 800 on; boundaries at 600 and 1,200
    const at = (step: number) => mv(step, step >= 800 ? 20 : 0);
    const free = new FirstsDetector(PONDS_CONT);
    const cyc = new FirstsDetector(PONDS);
    for (const step of upTo(12)) {
      free.observe(at(step));
      cyc.observe(at(step));
    }
    // without cycles the six censuses 300..800 already show the move
    expect(find(free, "moving-pond")!.step).toBe(800);
    // with them: 400..900, ..., 600..1100 hold the boundary 600 (a span from 600 holds it too); 700..1200 does not (1200 is its end)
    expect(find(cyc, "moving-pond")!.step).toBe(1200);
    // a span that ENDS at a boundary is whole: the census at 600 belongs to the cycle that ends there
    const edge = new FirstsDetector(PONDS);
    for (const step of upTo(6)) edge.observe(mv(step, step >= 300 ? 20 : 0));
    expect(find(edge, "moving-pond")!.step).toBe(600);
    // a span that STARTS at a boundary is not: 600..1100 with the move at 700
    const start = new FirstsDetector(PONDS);
    for (const step of upTo(11)) start.observe(mv(step, step >= 700 ? 20 : 0));
    expect(find(start, "moving-pond")).toBeUndefined();
    start.observe(mv(1200, 20)); // 700..1200 shows no move: it all happened at 700
    expect(find(start, "moving-pond")).toBeUndefined();
  });

  it("next up shows the largest share of moving cells now, floored, and falls back when they stop", () => {
    const d = new FirstsDetector(CTX);
    const item = () => d.nextUp(30).find((n) => n.id === "moving-pond")!;
    expect(item()).toMatchObject({ value: 0, target: 50, kind: "now" });
    for (const step of upTo(5)) d.observe(cen(step, { bodies: [body(1, 20, { cx: 10 }), body(2, 14, { cx: 30 })] }));
    expect(item().value).toBe(0);
    d.observe(cen(600, { bodies: [body(1, 20, { cx: 20 }), body(2, 14, { cx: 30 })] })); // one body moved: 20 of 34
    expect(item().value).toBe(58);
    expect(find(d, "moving-pond")).toBeUndefined(); // one moving body is not enough, but the share is shown
    d.observe(cen(700, { bodies: [body(1, 20, { cx: 20 }), body(2, 14, { cx: 30 })] }));
    expect(item().value).toBe(58);
    d.observe(cen(800, { bodies: [body(1, 20, { cx: 20 }), body(2, 14, { cx: 30 })] }));
    d.observe(cen(900, { bodies: [body(1, 20, { cx: 20 }), body(2, 14, { cx: 30 })] }));
    d.observe(cen(1000, { bodies: [body(1, 20, { cx: 20 }), body(2, 14, { cx: 30 })] }));
    d.observe(cen(1100, { bodies: [body(1, 20, { cx: 20 }), body(2, 14, { cx: 30 })] }));
    expect(item().value).toBe(0);
  });
});

describe("long body", () => {
  it("needs 40 cells and a ratio of 3 or more, and names the longest", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100));
    expect(d.observe(cen(200, { bodies: [body(1, 39, { elongation: 9 }), body(2, 60, { elongation: 2.99 })] })).filter((e) => e.id === "long-body")).toEqual([]);
    const got = d.observe(cen(300, { bodies: [body(1, 40, { elongation: 3 }), body(2, 52, { elongation: 3.456 }), body(3, 70, { elongation: 3.456 })] })).filter((e) => e.id === "long-body");
    expect(got.map((e) => [e.name, e.step, e.already, e.detail])).toEqual([["First long body", 300, false, "3.4 times as long as wide, 70 cells"]]);
    expect(d.observe(cen(400, { bodies: [body(1, 60, { elongation: 8 })] }))).toEqual([]);
  });

  it("ties on the ratio go to the larger body, then the smaller id; the pond is named when there are several", () => {
    const d = new FirstsDetector({ ...CTX, tiles: 2, tilesX: 2 });
    d.observe(cen(100));
    d.observe(cen(200, { bodies: [body(5, 60, { elongation: 4, tile: 0 }), body(4, 60, { elongation: 4, tile: 1 }), body(6, 50, { elongation: 4, tile: 0 })] }));
    expect(find(d, "long-body")!.detail).toBe("4.0 times as long as wide, 60 cells, in pond 2");
  });

  it("can already be there at the first watched census", () => {
    const d = new FirstsDetector(CTX);
    expect(d.observe(cen(100, { bodies: [body(1, 40, { elongation: 3 })] })).filter((e) => e.id === "long-body").map((e) => e.already)).toEqual([true]);
  });

  it("next up shows the longest ratio of a body of 40 cells or more seen so far, floored to one decimal", () => {
    const d = new FirstsDetector(CTX);
    const item = () => d.nextUp(30).find((n) => n.id === "long-body")!;
    expect(item()).toMatchObject({ value: 0, target: 3, kind: "best", decimals: 1, unit: "times as long as wide" });
    d.observe(cen(100, { bodies: [body(1, 39, { elongation: 2.9 })] }));
    expect(item().value).toBe(0); // under 40 cells does not count
    d.observe(cen(200, { bodies: [body(1, 45, { elongation: 2.78 })] }));
    expect(item().value).toBe(2.7);
    d.observe(cen(300, { bodies: [body(1, 45, { elongation: 1.2 })] }));
    expect(item().value).toBe(2.7); // seen so far
    d.observe(cen(400, { bodies: [body(1, 45, { elongation: 2.99 })] }));
    expect(item().value).toBe(2.9);
    expect(nextUp(d, 30).filter((n) => n.decimals !== undefined).map((n) => n.id)).toEqual(["long-body"]);
  });
});

describe("change of hands in a pond", () => {
  const lead = (step: number, ...tiles: string[][]) => cen(step, { pondLeaders: tiles });
  const feedLeads = (d: FirstsDetector, from: number, n: number, ...tiles: string[][]) => {
    for (let i = 0; i < n; i++) d.observe(lead(from + 100 * i, ...tiles));
  };

  it("fires at the fifth census of a second lineage's strict lead, after a first lineage's five", () => {
    const d = new FirstsDetector(CTX);
    feedLeads(d, 100, 5, ["A"]); // A established at 500
    feedLeads(d, 600, 4, ["B"]);
    expect(find(d, "pond-change")).toBeUndefined();
    expect(ids(d.observe(lead(1000, ["B"])))).toEqual(["pond-change"]);
    expect(find(d, "pond-change")).toMatchObject({ name: "First change of hands in a pond", step: 1000, already: false, detail: "lineage A led from t=100; lineage B ahead since t=600" });
    expect(d.observe(lead(1100, ["B"]))).toEqual([]);
  });

  it("a tie is no lead: it ends a run, and the incumbent cannot keep leading through the successor's run", () => {
    const d = new FirstsDetector(CTX);
    feedLeads(d, 100, 5, ["A"]);
    feedLeads(d, 600, 3, ["A", "B"]); // tied: nobody leads
    feedLeads(d, 900, 4, ["B"]);
    d.observe(lead(1300, ["A", "B"]));
    feedLeads(d, 1400, 4, ["B"]); // the run was broken by the tie
    expect(find(d, "pond-change")).toBeUndefined();
    expect(ids(d.observe(lead(1800, ["B"])))).toEqual(["pond-change"]);
    expect(find(d, "pond-change")!.detail).toBe("lineage A led from t=100; lineage B ahead since t=1,400");
    // an empty pond leads nobody either
    const e = new FirstsDetector(CTX);
    feedLeads(e, 100, 4, ["A"]);
    e.observe(lead(500, []));
    feedLeads(e, 600, 4, ["A"]);
    feedLeads(e, 1000, 5, ["B"]);
    expect(find(e, "pond-change")).toBeUndefined(); // A never had five in a row, so B is only the first to establish itself
  });

  it("the same lineage returning is no change; the first to complete five is the established leader", () => {
    const d = new FirstsDetector(CTX);
    feedLeads(d, 100, 5, ["A"]);
    feedLeads(d, 600, 3, ["B"]);
    feedLeads(d, 900, 9, ["A"]);
    expect(find(d, "pond-change")).toBeUndefined();
    feedLeads(d, 1800, 5, ["B"]);
    expect(find(d, "pond-change")!.step).toBe(2200);
    // B established first, then A's later run changes hands
    const e = new FirstsDetector(CTX);
    feedLeads(e, 100, 5, ["B"]);
    feedLeads(e, 600, 5, ["A"]);
    expect(find(e, "pond-change")!.detail).toBe("lineage B led from t=100; lineage A ahead since t=600");
  });

  it("names the pond, and of several at once the run that began first, then the smaller pond", () => {
    const d = new FirstsDetector({ ...CTX, tiles: 4, tilesX: 2 });
    // ponds 2 and 3 change hands together at 1,000 (the smaller is named); pond 4 only starts its run at 700
    for (let i = 0; i < 5; i++) d.observe(lead(100 + 100 * i, ["A"], ["A"], ["A"], ["A"]));
    d.observe(lead(600, ["A"], ["B"], ["B"], ["A"]));
    for (let i = 0; i < 3; i++) d.observe(lead(700 + 100 * i, ["A"], ["B"], ["B"], ["B"]));
    const fired = d.observe(lead(1000, ["A"], ["B"], ["B"], ["B"]));
    expect(ids(fired)).toEqual(["pond-change"]);
    expect(fired[0].detail).toBe("lineage A led from t=100; lineage B ahead since t=600, in pond 2");
  });

  it("a reseeding cycle starts every pond afresh", () => {
    // A leads 200..600 (the census at the 600 boundary is in the old cycle), B 700..1100
    const runs = (ctx: FirstsContext) => {
      const d = new FirstsDetector(ctx);
      d.observe(lead(100, []));
      feedLeads(d, 200, 5, ["A"]);
      feedLeads(d, 700, 5, ["B"]);
      return find(d, "pond-change");
    };
    expect(runs(PONDS_CONT)!.step).toBe(1100);
    expect(runs(PONDS)).toBeUndefined();
    // A's five completed in the cycle that ends at 600, B's in the next: nothing changed hands. Inside one cycle (601..1200) it does:
    const d = new FirstsDetector(PONDS);
    feedLeads(d, 700, 5, ["A"]); // 700..1100
    d.observe(lead(1200, ["B"])); // the census at the boundary is still in this cycle
    feedLeads(d, 1300, 4, ["B"]); // 1300 starts the next cycle: B's run is cut at the boundary
    expect(find(d, "pond-change")).toBeUndefined();
  });

  it("next up shows the longest run held by a lineage other than the established leader", () => {
    const d = new FirstsDetector(CTX);
    const item = () => d.nextUp(30).find((n) => n.id === "pond-change")!;
    expect(item()).toMatchObject({ value: 0, target: 5, unit: "censuses", kind: "now" });
    feedLeads(d, 100, 4, ["A"]);
    expect(item().value).toBe(0); // no established leader yet
    feedLeads(d, 500, 1, ["A"]);
    expect(item().value).toBe(0); // the leader itself does not count
    feedLeads(d, 600, 3, ["B"]);
    expect(item().value).toBe(3);
    d.observe(lead(900, ["A", "B"]));
    expect(item().value).toBe(0);
  });
});

describe("outlive a wound", () => {
  const bodiesIn = (tile: number, cells: number) => (cells > 0 ? [body(tile + 1, cells, { tile, cx: 10 })] : []);
  const at = (step: number, cells1: number, wounds: { step: number; tile: number; r: number }[] = [], cells0 = 100) =>
    cen(step, { bodies: [...bodiesIn(0, cells0), ...bodiesIn(1, cells1)], wounds });
  /** Period 1,000: cycles end at 1,000, 2,000, ...; H = 500. */
  const P1000: FirstsContext = { ...PONDS, pondPeriod: 1000 };

  it("fires at the first census at or after w + H, once the wound cost cells, saying radius and cells lost", () => {
    const d = new FirstsDetector(P1000);
    for (const step of [100, 200, 300, 400]) d.observe(at(step, 100));
    d.observe(at(500, 60, [{ step: 450, tile: 1, r: 10 }]));
    for (const step of [600, 700, 800, 900]) expect(d.observe(at(step, 70))).toEqual([]);
    // 450 + 500 = 950: the first census at or after is 1,000, the census at the boundary, still in the cycle it ends
    expect(ids(d.observe(at(1000, 70)))).toEqual(["outlive-wound"]);
    expect(find(d, "outlive-wound")).toMatchObject({ name: "First pond to outlive a wound", step: 1000, already: false, detail: "wounded at t=450 (radius 10, 40 cells lost), 1 body now, in pond 2" });
  });

  it("a wound counts only if the pond's bodies lost cells over it", () => {
    const d = new FirstsDetector(P1000);
    d.observe(at(100, 100));
    d.observe(at(200, 100, [{ step: 150, tile: 1, r: 8 }])); // an empty patch: no loss
    for (let step = 300; step <= 900; step += 100) d.observe(at(step, 100));
    expect(find(d, "outlive-wound")).toBeUndefined();
    // growth over a wound is no loss either; the other pond's loss is not this pond's
    const e = new FirstsDetector(P1000);
    e.observe(at(100, 100, [], 100));
    e.observe(at(200, 120, [{ step: 150, tile: 1, r: 8 }], 50));
    for (let step = 300; step <= 1000; step += 100) e.observe(at(step, 120, [], 50));
    expect(find(e, "outlive-wound")).toBeUndefined();
    // the first watched census has no census before it
    const f = new FirstsDetector(P1000);
    f.observe(at(100, 10, [{ step: 50, tile: 1, r: 8 }]));
    for (let step = 200; step <= 900; step += 100) f.observe(at(step, 10));
    expect(find(f, "outlive-wound")).toBeUndefined();
  });

  it("fails at a census where the pond holds no body, and each wound has its own clock", () => {
    const d = new FirstsDetector(P1000);
    d.observe(at(100, 100));
    d.observe(at(200, 50, [{ step: 150, tile: 1, r: 8 }])); // wound 1
    d.observe(at(300, 0)); // pond 2 holds no body: wound 1 fails
    d.observe(at(400, 40, [{ step: 350, tile: 1, r: 6 }])); // 0 -> 40 is no loss
    d.observe(at(500, 80));
    d.observe(at(600, 30, [{ step: 550, tile: 1, r: 12 }])); // wound 2: lost 50
    for (let step = 700; step <= 1000; step += 100) expect(d.observe(at(step, 30))).toEqual([]);
    expect(find(d, "outlive-wound")).toBeUndefined(); // 550 + 500 = 1,050 is in the next cycle
  });

  it("a pond wounded again still counts its earlier wound, which is named first when both are due", () => {
    const d = new FirstsDetector(P1000);
    d.observe(at(100, 100));
    d.observe(at(200, 80, [{ step: 150, tile: 1, r: 5 }])); // wound at 150: due at 650 -> 700
    d.observe(at(300, 60, [{ step: 250, tile: 1, r: 7 }])); // due at 750 -> 800
    for (let step = 400; step <= 600; step += 100) d.observe(at(step, 60));
    expect(ids(d.observe(at(700, 60)))).toEqual(["outlive-wound"]);
    expect(find(d, "outlive-wound")!.detail).toBe("wounded at t=150 (radius 5, 20 cells lost), 1 body now, in pond 2");
    // two due at once: the earlier wound, then the smaller pond
    const e = new FirstsDetector(P1000);
    e.observe(at(100, 100));
    e.observe(at(200, 50, [{ step: 130, tile: 1, r: 9 }, { step: 120, tile: 0, r: 4 }], 60));
    for (let step = 300; step <= 600; step += 100) e.observe(at(step, 50, [], 60));
    expect(ids(e.observe(at(700, 50, [], 60)))).toEqual(["outlive-wound"]);
    expect(find(e, "outlive-wound")!.detail).toBe("wounded at t=120 (radius 4, 40 cells lost), 1 body now, in pond 1");
  });

  it("a wound's clock ends unfired at a reseeding boundary; one just after a boundary earns nothing", () => {
    const d = new FirstsDetector(P1000); // H = 500
    for (let step = 100; step <= 500; step += 100) d.observe(at(step, 100));
    d.observe(at(600, 40, [{ step: 550, tile: 1, r: 10 }])); // due at 1,050: the cycle ends at 1,000
    for (let step = 700; step <= 1500; step += 100) d.observe(at(step, 40));
    expect(find(d, "outlive-wound")).toBeUndefined();
    // the census at 1,000 is pre-cycle; a lesion logged at 1,000 comes after its boundary: no wound that counts
    const e = new FirstsDetector(P1000);
    for (let step = 100; step <= 1000; step += 100) e.observe(at(step, 100));
    e.observe(at(1100, 40, [{ step: 1000, tile: 1, r: 10 }]));
    for (let step = 1200; step <= 1900; step += 100) e.observe(at(step, 40));
    expect(find(e, "outlive-wound")).toBeUndefined();
    // a lesion shortly after the boundary, with a census between the two, does count
    const f = new FirstsDetector(P1000);
    for (let step = 100; step <= 1100; step += 100) f.observe(at(step, 100));
    f.observe(at(1200, 40, [{ step: 1150, tile: 1, r: 10 }]));
    for (let step = 1300; step <= 1600; step += 100) f.observe(at(step, 40));
    expect(ids(f.observe(at(1700, 40)))).toEqual(["outlive-wound"]);
  });

  it("H is 1,000 steps, or half the pond period if that is shorter; without a period it is 1,000", () => {
    const run = (ctx: FirstsContext) => {
      const d = new FirstsDetector(ctx);
      d.observe(at(100, 100));
      d.observe(at(200, 50, [{ step: 150, tile: 1, r: 8 }]));
      for (let step = 300; step <= 3000; step += 100) {
        d.observe(at(step, 50));
        if (find(d, "outlive-wound")) return find(d, "outlive-wound")!.step;
      }
      return null;
    };
    expect(run({ ...PONDS_CONT, pondPeriod: 600 })).toBe(500); // 150 + 300 = 450 -> 500
    expect(run({ ...PONDS_CONT, pondPeriod: 4000 })).toBe(1200); // 150 + 1,000 = 1,150 -> 1,200
    const noPeriod = { ...PONDS_CONT };
    delete noPeriod.pondPeriod;
    expect(run(noPeriod)).toBe(1200);
    // in a world that does not reseed the clocks never end
    expect(run({ ...PONDS_CONT, pondPeriod: 200 })).toBe(300); // H = 100: 250 -> 300
  });

  it("next up shows how long the pond has held a body since a wound that counts and is still on its clock", () => {
    const d = new FirstsDetector(P1000);
    const item = () => d.nextUp(30).find((n) => n.id === "outlive-wound")!;
    expect(item()).toMatchObject({ value: 0, target: 500, unit: "steps", kind: "now" });
    d.observe(at(100, 100));
    d.observe(at(200, 50, [{ step: 150, tile: 1, r: 8 }]));
    expect(item().value).toBe(50);
    d.observe(at(300, 50));
    d.observe(at(400, 50));
    expect(item().value).toBe(250);
    d.observe(at(500, 0)); // the pond is empty: the wound failed
    expect(item().value).toBe(0);
  });

  it("is never 'already there'", () => {
    const d = new FirstsDetector(P1000);
    d.observe(at(100, 100));
    d.observe(at(200, 50, [{ step: 150, tile: 1, r: 8 }]));
    for (let step = 300; step <= 700; step += 100) d.observe(at(step, 50));
    expect(find(d, "outlive-wound")!.already).toBe(false);
  });
});

describe("new family", () => {
  const split = { name: "Reed amber", parentName: "Reed", step: 5100, cells: 34, parentCells: 120 };
  it("fires when the family tree split a family at this census, naming both and their cells, and the first split wins", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { family: { splits: [], candidateRun: 0 } }));
    expect(d.observe(cen(200))).toEqual([]);
    const fired = d.observe(cen(300, { family: { splits: [split, { ...split, name: "Moss slow" }], candidateRun: 0 } }));
    expect(fired.map((e) => [e.id, e.name, e.step, e.already, e.detail])).toEqual([["new-family", "First new family", 300, false, "Reed amber from Reed, 34 and 120 cells"]]);
    expect(d.observe(cen(400, { family: { splits: [split], candidateRun: 0 } }))).toEqual([]);
  });

  it("next up shows the longest split-candidate run now, of 5,000 steps", () => {
    const d = new FirstsDetector(CTX);
    const item = () => d.nextUp(30).find((n) => n.id === "new-family")!;
    expect(item()).toMatchObject({ value: 0, target: 5000, unit: "steps", kind: "now" });
    d.observe(cen(100, { family: { splits: [], candidateRun: 1200 } }));
    expect(item().value).toBe(1200);
    d.observe(cen(200)); // no tree fed: no run
    expect(item().value).toBe(0);
  });
});

describe("the rungs together", () => {
  it("the new rungs are offered in the ladder's order", () => {
    const d = new FirstsDetector({ ...CTX, geneBits: [0] });
    expect(d.nextUp(30).map((n) => n.id)).toEqual([...FIRSTS_LADDER, "gene-0"]);
    expect(FIRSTS_LADDER.indexOf("moving-pond")).toBeGreaterThan(FIRSTS_LADDER.indexOf("traveller"));
    expect(FIRSTS_LADDER.indexOf("moving-pond")).toBeLessThan(FIRSTS_LADDER.indexOf("new-lineage"));
    expect(FIRSTS_LADDER.indexOf("long-body")).toBe(FIRSTS_LADDER.indexOf("body-100") + 1);
    expect(FIRSTS_LADDER.indexOf("outlive-wound")).toBe(FIRSTS_LADDER.indexOf("takeover") + 1);
    expect(FIRSTS_LADDER.indexOf("new-family")).toBe(FIRSTS_LADDER.indexOf("pond-change") + 1);
  });

  it("several fire at one census in rule-table order", () => {
    const d = new FirstsDetector(CTX);
    d.observe(cen(100, { pondLeaders: [["A"]] }));
    const fired = d.observe(cen(200, { bodies: [body(1, 60, { elongation: 5 })], family: { splits: [{ name: "Reed amber", parentName: "Reed", step: 200, cells: 20, parentCells: 40 }], candidateRun: 0 } }));
    expect(ids(fired)).toEqual(["body", "body-40", "long-body", "new-family"]);
  });

  it("snapshot and restore carry the trail, the leads, the pond cells and the wound clocks through a mid-history cut", () => {
    const script = (n: number): FirstsInput[] =>
      Array.from({ length: n }, (_, k) => {
        const step = 100 * (k + 1);
        const cells1 = k === 8 ? 40 : 100;
        return cen(step, {
          bodies: [body(1, 20, { cx: 10 + (k >= 7 ? 12 : 0), tile: 0 }), body(2, 20, { cx: 30 + (k >= 7 ? 12 : 0), tile: 0 }), body(3, cells1, { cx: 10, tile: 1 })],
          pondLeaders: [k < 5 ? ["A"] : ["B"], []],
          wounds: k === 8 ? [{ step: 850, tile: 1, r: 9 }] : [],
        });
      });
    const ctx: FirstsContext = { ...PONDS_CONT, pondPeriod: 1000 };
    const all = script(40);
    const whole = new FirstsDetector(ctx);
    feed(whole, all);
    expect(["moving-pond", "pond-change", "outlive-wound"].map((id) => find(whole, id)?.step)).toEqual([800, 1000, 1400]);
    for (let cut = 0; cut <= 40; cut++) {
      const a = new FirstsDetector(ctx);
      feed(a, all.slice(0, cut));
      const b = FirstsDetector.restore(JSON.parse(JSON.stringify(a.snapshot())));
      expect(b.snapshot()).toEqual(a.snapshot());
      expect(feed(b, all.slice(cut))).toEqual(feed(a, all.slice(cut)));
      expect(JSON.stringify(b.snapshot())).toBe(JSON.stringify(whole.snapshot()));
      expect(b.nextUp(30)).toEqual(whole.nextUp(30));
    }
  });
});

// ---- the census-side reads ---------------------------------------------------------------------------------------------------------------

describe("buildFirstsInput: shape, lineages by pond and by body", () => {
  /** Two 32 x 32 ponds side by side. `blocks` fill cells of mass 64 with a lineage (hi, 1). */
  const cfg = defaultConfig({ tileW: 32, tileH: 32, tilesX: 2, tilesY: 1 });
  const n = 2 * 32 * 32;
  const W = 64;
  type Block = { cells: [number, number][]; hi: number; lo?: number };
  const world = (step: number, blocks: Block[]) => {
    const cells = new Uint32Array(7 * n);
    const genomeHead = new Uint32Array(4 * n);
    for (const b of blocks)
      for (const [x, y] of b.cells) {
        const i = y * W + x;
        cells[CH.B * n + i] = 64;
        genomeHead[G.LIN_HI * n + i] = b.hi;
        genomeHead[G.LIN_LO * n + i] = b.lo ?? 1;
      }
    return { c: census({ cfg, step, cells, genomeHead }), genomeHead };
  };
  const rect = (x0: number, y0: number, w: number, h: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y]);
    return out;
  };
  const ctx = firstsContext(cfg, 100);
  const build = (blocks: Block[], extras?: Parameters<typeof buildFirstsInput>[5]) => {
    const { c, genomeHead } = world(100, blocks);
    const tracker = new Tracker();
    const events = tracker.update(c);
    return { c, tracker, genomeHead, input: buildFirstsInput(c, tracker, genomeHead, events, ctx, extras) };
  };

  it("firstsContext of this config reads the tile layout", () => {
    expect(ctx).toMatchObject({ tileW: 32, tileH: 32, tilesX: 2, tiles: 2, pondReseeds: false });
  });

  it("elongation: a line of n cells is n, a 3 by 9 block 3, a square 1", () => {
    const { input } = build([
      { cells: rect(2, 2, 20, 1), hi: 0 }, // a line of 20: mass 1280
      { cells: rect(2, 10, 9, 3), hi: 0 }, // 3 by 9 block
      { cells: rect(2, 20, 8, 8), hi: 0 }, // square
      { cells: rect(40, 5, 1, 12), hi: 0 }, // a vertical line of 12 in pond 2
    ]);
    const by = (cells: number) => input.bodies.find((b) => b.cells === cells)!;
    expect(by(20).elongation).toBeCloseTo(20, 10);
    expect(by(27).elongation).toBe(3);
    expect(by(64).elongation).toBeCloseTo(1, 10);
    expect(by(12).elongation).toBeCloseTo(12, 10);
    expect(by(12).tile).toBe(1);
  });

  it("elongation: a body across its pond's wrap is unwrapped, in both directions and in the second pond", () => {
    const { input } = build([
      { cells: [...rect(28, 4, 4, 1), ...rect(0, 4, 4, 1)], hi: 0 }, // x 28..31 and 0..3 in pond 1: a line of 8 across the wrap
      { cells: [...rect(10, 28, 1, 4), ...rect(10, 0, 1, 4)], hi: 0 }, // y 28..31 and 0..3: a line of 8 across the wrap
      { cells: [...rect(62, 20, 2, 1), ...rect(32, 20, 6, 1)], hi: 0 }, // pond 2 spans x = 32..63: 62, 63, 32..37 is a line of 8
    ]);
    expect(input.bodies).toHaveLength(3);
    for (const b of input.bodies) {
      expect(b.cells).toBe(8);
      expect(b.elongation).toBeCloseTo(8, 10);
    }
    expect(input.bodies.map((b) => b.tile).sort()).toEqual([0, 0, 1]);
  });

  it("elongation: an L is shorter than its longer arm, and a body that wraps the whole pond still gets a finite ratio", () => {
    const { input } = build([
      { cells: [...rect(2, 2, 10, 1), ...rect(2, 3, 1, 5)], hi: 0 }, // an L: 10 across, 6 down
      { cells: rect(0, 12, 32, 2), hi: 0 }, // two full rows: a band all the way round the pond
    ]);
    for (const b of input.bodies) {
      expect(Number.isFinite(b.elongation)).toBe(true);
      expect(b.elongation).toBeGreaterThanOrEqual(1);
    }
    const l = input.bodies.find((b) => b.cells === 15)!;
    expect(l.elongation).toBeGreaterThan(1.2);
    expect(l.elongation).toBeLessThan(10);
  });

  it("pond leaders: every key tied for the most cells in a pond, [] for an empty pond; bodies' compositions", () => {
    const { input, c, tracker, genomeHead } = build([
      { cells: rect(2, 2, 10, 5), hi: 0, lo: 1 }, // pond 1: 50 cells of 0:1 ...
      { cells: rect(2, 10, 5, 10), hi: 7, lo: 3 }, // ... and 50 of 7:3, a tie
      { cells: rect(14, 2, 4, 1), hi: 0, lo: 2 }, // 4 cells of another key: the smallest body there is
    ]);
    expect(input.pondLeaders).toEqual([["0:1", "7:3"], []]);
    const lc = readLineageCells(c, tracker, genomeHead, ctx);
    expect(lc.ponds[0].get("0:1")).toBe(50);
    expect(lc.ponds[0].get("7:3")).toBe(50);
    expect(lc.ponds[0].get("0:2")).toBe(4);
    expect(lc.ponds[1].size).toBe(0);
    expect(pondLeaders(lc)).toEqual(input.pondLeaders);
    expect(lc.bodies).toHaveLength(3);
    expect(lc.bodies.map((b) => [b.cells, b.keys] as const).sort((p, q) => p[0] - q[0])).toEqual([
      [4, [["0:2", 4]]],
      [50, [["0:1", 50]]],
      [50, [["7:3", 50]]],
    ]);
  });

  it("a body of two lineages carries both counts, in birth order, and a lone leader is a strict one", () => {
    const { input, c, tracker, genomeHead } = build([
      { cells: rect(2, 2, 6, 5), hi: 12, lo: 5 },
      { cells: rect(8, 2, 4, 5), hi: 3, lo: 9 }, // touching: one body of 50 cells, 30 + 20
      { cells: rect(40, 2, 2, 2), hi: 0, lo: 4 },
    ]);
    const lc = readLineageCells(c, tracker, genomeHead, ctx);
    expect(lc.bodies.map((b) => b.keys)).toEqual([[["3:9", 20], ["12:5", 30]], [["0:4", 4]]]);
    expect(lc.bodies[0].cells).toBe(50);
    expect(input.pondLeaders).toEqual([["12:5"], ["0:4"]]);
  });

  it("uses the shared read it is given, takes the wounds and the family, and copies them", () => {
    const { c, tracker, genomeHead } = build([{ cells: rect(2, 2, 10, 5), hi: 0 }]);
    const lc = readLineageCells(c, tracker, genomeHead, ctx);
    lc.ponds[1].set("9:9", 4);
    const wounds = [{ step: 150, tile: 1, r: 8 }];
    const family = { splits: [{ name: "Reed amber", parentName: "Reed", step: 100, cells: 20, parentCells: 40 }], candidateRun: 700 };
    const input = buildFirstsInput(c, tracker, genomeHead, [], ctx, { lineageCells: lc, wounds, family });
    expect(input.pondLeaders).toEqual([["0:1"], ["9:9"]]);
    expect(input.wounds).toEqual(wounds);
    expect(input.wounds).not.toBe(wounds);
    expect(input.family).toEqual(family);
    expect(input.family!.splits).not.toBe(family.splits);
    // not given: no wounds, no family
    const plain = buildFirstsInput(c, tracker, genomeHead, [], ctx);
    expect(plain.wounds).toEqual([]);
    expect(plain.family).toBeUndefined();
    // without genome words there are no pond leaders but one empty list per pond
    expect(buildFirstsInput(c, tracker, undefined, [], ctx).pondLeaders).toEqual([[], []]);
  });

  it("through the detector: a long body on a real census fires long-body as already there", () => {
    const { input } = build([{ cells: rect(2, 2, 30, 2), hi: 0 }, { cells: rect(2, 8, 30, 1), hi: 0 }]); // 60 cells, 15 times as long as wide; and a line of 30: too small
    const d = new FirstsDetector(ctx);
    const fired = d.observe(input);
    expect(fired.filter((e) => e.id === "long-body").map((e) => [e.already, e.detail])).toEqual([[true, "15.0 times as long as wide, 60 cells, in pond 1"]]);
  });
});
