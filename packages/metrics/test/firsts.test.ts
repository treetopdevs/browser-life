import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CH, G, GENE_SHIFT, defaultConfig } from "@bl/schema";
import {
  FIRSTS_RULES,
  FIRSTS_RULESET,
  FIRSTS_THRESHOLDS,
  FirstsDetector,
  Tracker,
  buildFirstsInput,
  census,
  firstsContext,
  firstsRules,
  type FirstsBody,
  type FirstsContext,
  type FirstsEntry,
  type FirstsInput,
} from "@bl/metrics";

const CTX: FirstsContext = { tileW: 64, tileH: 64, tiles: 1, censusEvery: 100, geneBits: [] };

const body = (id: number, cells: number, o: Partial<FirstsBody> = {}): FirstsBody => ({ id, generation: 0, cells, cx: 10, cy: 10, tile: 0, lineage: "A", ...o });
const cen = (step: number, o: Partial<FirstsInput> = {}): FirstsInput => {
  const bodies = o.bodies ?? [];
  const lineages = o.lineages ?? [{ key: "A", cells: bodies.reduce((a, b) => a + b.cells, 0) }].filter((l) => l.cells > 0);
  return { step, bodies, lineages, fissions: 0, deaths: 0, livingCells: lineages.reduce((a, l) => a + l.cells, 0), ...o };
};
/** Feed censuses and collect every entry fired, with the step it fired at. */
function feed(d: FirstsDetector, inputs: FirstsInput[]): FirstsEntry[] {
  const out: FirstsEntry[] = [];
  for (const i of inputs) out.push(...d.observe(i));
  return out;
}
const ids = (es: readonly FirstsEntry[]) => es.map((e) => e.id);
const find = (d: FirstsDetector, id: string) => d.entries().find((e) => e.id === id);

describe("rules table", () => {
  it("equals the table in the contract note", () => {
    const note = readFileSync(fileURLToPath(new URL("../../../docs/pond-keeper-v0-2026-10-17.md", import.meta.url)), "utf8");
    const rows = note
      .split("\n")
      .filter((l) => l.startsWith("| `"))
      .map((l) => l.trim().slice(1, -1).split(" | ").map((c) => c.trim()));
    const fixed = rows.filter((r) => r[0] !== "`gene-<b>`").map((r) => ({ id: r[0].replace(/`/g, ""), name: r[1], text: r[2] }));
    expect(fixed).toHaveLength(9);
    expect(FIRSTS_RULES).toEqual(fixed);
    const gene = rows.find((r) => r[0] === "`gene-<b>`")!;
    expect(gene[1]).toBe("First carrier body of gene b");
  });

  it("adds one gene rule per gainable bit, and none without genes", () => {
    expect(firstsRules([])).toEqual(FIRSTS_RULES);
    const g = firstsRules([0, 1]);
    expect(g.map((r) => r.id)).toEqual([...FIRSTS_RULES.map((r) => r.id), "gene-0", "gene-1"]);
    expect(g[g.length - 1]).toEqual({ id: "gene-1", name: "First carrier body of gene 1", text: "some body has more than half of its cells carrying gene bit 1" });
    expect(FIRSTS_THRESHOLDS).toEqual({ big: 40, large: 100, travel: 16, lineageCells: 16, lineageSteps: 5000, leadCensuses: 10 });
  });

  it("firstsContext reads tile sizes, pond period and the gene bits of the config", () => {
    const plain = firstsContext(defaultConfig({ tileW: 32, tileH: 24 }), 100);
    expect(plain).toEqual({ tileW: 32, tileH: 24, tiles: 1, censusEvery: 100, geneBits: [] });
    expect("pondPeriod" in plain).toBe(false);
    const pond = firstsContext(defaultConfig({ tilesX: 3, tilesY: 2, pondPeriod: 1000, genes: "ladder" }), 50);
    expect(pond.tiles).toBe(6);
    expect(pond.pondPeriod).toBe(1000);
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
    expect(d.observe(cen(201, { bodies: [body(1, 300)] })).map((e) => e.id)).toEqual(["body-100"]);
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
  /** A scripted stream that makes every rule fire: growth, descent, a traveller, a durable second lineage that overtakes, a gene. */
  const stream = (n: number): FirstsInput[] => {
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
      });
    }
    return out;
  };
  const ctx: FirstsContext = { tileW: 64, tileH: 64, tiles: 2, censusEvery: 100, pondPeriod: 500, geneBits: [0] };

  it("the scripted stream fires every rule", () => {
    const d = new FirstsDetector(ctx);
    feed(d, stream(120));
    expect(d.entries().map((e) => e.id).sort()).toEqual(firstsRules([0]).map((r) => r.id).sort());
  });

  it("restoring at any census then feeding the rest gives the same log as an uninterrupted detector", () => {
    const all = stream(120);
    const whole = new FirstsDetector(ctx);
    feed(whole, all);
    for (const cut of [0, 1, 4, 23, 24, 25, 52, 53, 54, 70, 71, 72, 119]) {
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
    bad((s) => (s.v = 2));
    bad((s) => (s.ruleSet = "firsts-v1"));
    bad((s) => delete s.ctx);
    bad((s) => ((s.ctx as Record<string, unknown>).geneBits = [9]));
    bad((s) => delete s.entries);
    bad((s) => (s.entries = [{ id: "nope", name: "x", step: 1, already: false, detail: "" }]));
    bad((s) => (s.entries = [...(s.entries as unknown[]), (s.entries as unknown[])[0]]));
    bad((s) => (s.seen = [[1, 2]]));
    bad((s) => (s.held = [[1, 2]]));
    bad((s) => (s.lastStep = null));
    bad((s) => (s.censuses = -1));
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
