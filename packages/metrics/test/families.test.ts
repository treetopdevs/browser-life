import { describe, expect, it } from "vitest";
import { CH, G, defaultConfig } from "@bl/schema";
import {
  FAMILIES_RULESET,
  FAMILY_EPITHETS,
  FAMILY_GENERA,
  FAMILY_THRESHOLDS,
  FamilyTree,
  Tracker,
  buildFamilyInput,
  census,
  firstsContext,
  fnv1a32,
  readLineageCells,
  type FamilyEvent,
  type FamilyInput,
} from "@bl/metrics";

/** A ledger: child key -> parent key. A key not in it has no known parent (a root). */
const ledger = (links: Record<string, string>) => (key: string) => links[key];

type Body = { id: number; cells: number; keys: [string, number][] };
const at = (step: number, lineages: Record<string, number>, bodies: Body[] = []): FamilyInput => ({
  step,
  lineages: Object.entries(lineages).map(([key, cells]) => ({ key, cells })),
  bodies,
});
/** A body made only of these cells of these keys. */
const bodyOf = (id: number, ...keys: [string, number][]): Body => ({ id, cells: keys.reduce((a, k) => a + k[1], 0), keys });
/** The same, with every lineage's cells in one body: nothing goes to film. */
const atb = (step: number, lineages: Record<string, number>): FamilyInput => at(step, lineages, [bodyOf(1, ...(Object.entries(lineages) as [string, number][]))]);
const kinds = (es: readonly FamilyEvent[]) => es.map((e) => e.kind);

/** Keys of a ledger where a, b, c of one family hang from the founder f: f -> A -> B and A -> C, plus extras given. */
const GRAPH = ledger({ "1:1": "0:1", "2:1": "1:1", "3:1": "1:1", "6:1": "0:1" });

describe("names", () => {
  it("two lists of 64 distinct words: genus capitalised, epithets lower case", () => {
    expect(FAMILY_GENERA).toHaveLength(64);
    expect(new Set(FAMILY_GENERA).size).toBe(64);
    expect(FAMILY_GENERA.every((w) => /^[A-Z][a-z]+$/.test(w))).toBe(true);
    expect(FAMILY_EPITHETS).toHaveLength(64);
    expect(new Set(FAMILY_EPITHETS).size).toBe(64);
    expect(FAMILY_EPITHETS.every((w) => /^[a-z]+$/.test(w))).toBe(true);
    expect(FAMILY_GENERA.map((w) => w.toLowerCase()).filter((w) => FAMILY_EPITHETS.includes(w))).toEqual([]);
  });

  it("FNV-1a, 32 bit, over the key's bytes", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
    expect(fnv1a32("0:1")).toBe(fnv1a32("0:1"));
  });

  it("a starting family takes the word its key hashes to; the same key is named the same in every tree", () => {
    const a = new FamilyTree();
    const b = new FamilyTree();
    a.observe(at(100, { "0:7": 30 }), ledger({}));
    b.observe(at(500, { "0:7": 3, "0:8": 40 }), ledger({}));
    expect(a.families()[0].name).toBe(FAMILY_GENERA[fnv1a32("0:7") % 64]);
    expect(b.families().find((f) => f.founder === "0:7")!.name).toBe(a.families()[0].name);
  });

  it("a taken word moves on to the next unused one (wrapping), in founding order, key birth order breaking ties", () => {
    // two keys whose hashes land on the same word
    const keys: string[] = [];
    const want = fnv1a32("0:1") % 64;
    for (let n = 2; keys.length < 2; n++) if (fnv1a32(`0:${n}`) % 64 === want) keys.push(`0:${n}`);
    const t = new FamilyTree();
    t.observe(at(100, { "0:1": 10, [keys[1]]: 10, [keys[0]]: 10 }), ledger({}));
    const names = Object.fromEntries(t.families().map((f) => [f.founder, f.name]));
    expect(names["0:1"]).toBe(FAMILY_GENERA[want]);
    expect(names[keys[0]]).toBe(FAMILY_GENERA[(want + 1) % 64]);
    expect(names[keys[1]]).toBe(FAMILY_GENERA[(want + 2) % 64]);
  });

  it("when the list is used up the name takes a numeral, and every name stays unique", () => {
    const lin: Record<string, number> = {};
    for (let n = 1; n <= 66; n++) lin[`0:${n}`] = 5;
    const t = new FamilyTree();
    t.observe(at(100, lin), ledger({}));
    const names = t.families().map((f) => f.name);
    expect(new Set(names).size).toBe(66);
    expect(names.filter((n) => /^[A-Z][a-z]+$/.test(n))).toHaveLength(64);
    expect(names.filter((n) => / 2$/.test(n))).toHaveLength(2);
  });
});

describe("roots and unknown descent", () => {
  it("every root among the living ancestries founds a starting family; founders are not 'unknown descent', other roots are", () => {
    const t = new FamilyTree();
    const ev = t.observe(at(100, { "2:1": 20, "3:1": 20, "9:4": 15 }), GRAPH);
    expect(ev).toEqual([]); // starting families are not events
    const fam = t.families();
    expect(fam.map((f) => [f.founder, f.founded, f.unknownDescent, f.parent, f.depth])).toEqual([
      ["0:1", 100, false, null, 0],
      ["9:4", 100, true, null, 0],
    ]);
    expect(fam[0].cells).toBe(40);
    expect(fam[1].cells).toBe(15);
    expect(t.summary()).toEqual({ rules: FAMILIES_RULESET, watchedFrom: 100, step: 100, named: 2, starting: 2, split: 0, living: 2, film: 0, extinct: 0 });
  });

  it("a root first seen later founds a family then, with a 'found' event, marked of unknown descent even if it is a founder's key", () => {
    const t = new FamilyTree();
    t.observe(at(100, { "0:1": 20 }), ledger({}));
    expect(t.observe(at(200, { "0:1": 20 }), ledger({}))).toEqual([]);
    const ev = t.observe(at(300, { "0:1": 20, "0:2": 25 }), ledger({}));
    expect(ev.map((e) => [e.step, e.kind, e.family])).toEqual([[300, "found", "0:2"]]);
    const f = t.families().find((x) => x.founder === "0:2")!;
    expect([f.founded, f.unknownDescent, f.parent]).toEqual([300, true, null]);
    expect(t.events().map((e) => e.kind)).toEqual(["found"]);
    // an ancestor-less key whose descendants already belong to a family does not found a second one
    expect(t.observe(at(400, { "0:1": 20, "0:2": 25 }), ledger({}))).toEqual([]);
  });

  it("a lineage joins the family founded at its nearest ancestor-or-self that founds one", () => {
    const t = new FamilyTree();
    t.observe(at(100, { "2:1": 20, "3:1": 20, "6:1": 7 }), GRAPH);
    expect(t.families()).toHaveLength(1);
    expect(t.families()[0].cells).toBe(47);
    expect(t.families()[0].share).toBe(1);
  });

  it("parent links that loop are an error", () => {
    const t = new FamilyTree();
    expect(() => t.observe(at(100, { "1:1": 20 }), ledger({ "1:1": "2:2", "2:2": "1:1" }))).toThrow(/cycle/);
  });
});

describe("the split rule", () => {
  /** f = 0:1 with a long chain 1:1 -> 2:1 -> ... and two tips. */
  const chain = ledger({ "1:1": "0:1", "2:1": "1:1", "3:1": "2:1", "4:1": "3:1", "5:1": "3:1", "5:2": "0:1" });

  it("splits at exactly 5,000 steps of both halves at 16 cells or more, not at 4,900", () => {
    const t = new FamilyTree();
    for (let step = 100; step <= 5000; step += 100) expect(t.observe(atb(step, { "4:1": 20, "5:2": 16 }), chain)).toEqual([]);
    expect(t.candidateRun()).toBe(4900);
    expect(t.families()).toHaveLength(1);
    const ev = t.observe(atb(5100, { "4:1": 20, "5:2": 16 }), chain);
    expect(ev.map((e) => [e.step, e.kind, e.family])).toEqual([[5100, "split", "1:1"]]);
    expect(t.families()).toHaveLength(2);
    expect(t.splitsAt(5100)).toEqual([{ name: t.families()[1].name, parentName: t.families()[0].name, step: 5100, cells: 20, parentCells: 16 }]);
    expect(t.splitsAt(5000)).toEqual([]);
    // the run is cleared by a split
    expect(t.candidateRun()).toBe(0);
  });

  it("a half under 16 cells never qualifies, and one census under restarts the run", () => {
    const quiet = new FamilyTree();
    for (let step = 100; step <= 8000; step += 100) quiet.observe(atb(step, { "4:1": 20, "5:2": 15 }), chain);
    expect(quiet.families()).toHaveLength(1);
    expect(quiet.candidateRun()).toBe(0);
    const dip = new FamilyTree();
    for (let step = 100; step <= 3000; step += 100) dip.observe(atb(step, { "4:1": 20, "5:2": 16 }), chain);
    dip.observe(atb(3100, { "4:1": 20, "5:2": 15 }), chain);
    for (let step = 3200; step <= 8100; step += 100) expect(dip.observe(atb(step, { "4:1": 20, "5:2": 16 }), chain)).toEqual([]);
    expect(kinds(dip.observe(atb(8200, { "4:1": 20, "5:2": 16 }), chain))).toEqual(["split"]);
  });

  it("a chain whose remainder is empty never splits, however long", () => {
    const t = new FamilyTree();
    for (let step = 100; step <= 7000; step += 100) t.observe(atb(step, { "4:1": 100 }), chain);
    expect(t.families()).toHaveLength(1);
    expect(t.events()).toEqual([]);
    expect(t.candidateRun()).toBe(0);
  });

  it("the candidate may be a living member itself, and a split family takes its root's genus and an epithet", () => {
    const t = new FamilyTree();
    const lin = { "0:1": 18, "3:1": 20 }; // the founder keeps 18; 3:1 lives, and is a candidate (and so are 1:1 and 2:1, ahead of it by key)
    for (let step = 100; step <= 5000; step += 100) t.observe(atb(step, lin), chain);
    const ev = t.observe(atb(5100, lin), chain);
    expect(ev[0].family).toBe("1:1"); // equal runs and halves: the older key
    const [root, kid] = t.families();
    expect(kid.name).toBe(`${root.name} ${FAMILY_EPITHETS[fnv1a32("1:1") % 64]}`);
    expect(kid.parent).toBe("0:1");
    expect(kid.parentName).toBe(root.name);
    expect(kid.depth).toBe(1);
    expect([root.cells, kid.cells]).toEqual([18, 20]);
    expect(ev[0].detail).toContain(`${kid.name} split from ${root.name}`);
  });

  it("among qualifying candidates the run that began first wins, then the larger half, then the older key", () => {
    const g = ledger({ "1:1": "0:1", "2:1": "0:1", "5:1": "1:1", "5:2": "2:1" });
    const run = (first: Record<string, number>, later: Record<string, number>, switchAt: number) => {
      const t = new FamilyTree();
      let ev: FamilyEvent[] = [];
      for (let step = 100; step <= 6000 && !ev.length; step += 100) ev = t.observe(atb(step, step < switchAt ? first : later), g);
      return ev;
    };
    // 2:1 qualifies from step 100, 1:1 only from 300 (before that 5:1 is under 16): 2:1's run began first
    const early = run({ "0:1": 20, "5:1": 10, "5:2": 30 }, { "0:1": 20, "5:1": 40, "5:2": 30 }, 300);
    expect(early.map((e) => [e.step, e.family])).toEqual([[5100, "2:1"]]);
    // began together: the larger half
    const lin = { "0:1": 20, "5:1": 20, "5:2": 30 };
    const half = run(lin, lin, 0);
    expect(half.map((e) => [e.step, e.family])).toEqual([[5100, "2:1"]]);
    // began together, equal halves: the older key
    const even = { "0:1": 20, "5:1": 25, "5:2": 25 };
    const tie = run(even, even, 0);
    expect(tie.map((e) => [e.step, e.family])).toEqual([[5100, "1:1"]]);
  });

  it("only one split per family per census; the other candidate's run is cleared and counts afresh", () => {
    const g = ledger({ "1:1": "0:1", "2:1": "0:1", "5:1": "1:1", "5:2": "2:1" });
    const t = new FamilyTree();
    for (let step = 100; step <= 5100; step += 100) t.observe(atb(step, { "5:1": 25, "5:2": 25 }), g);
    expect(t.families().map((f) => f.founder)).toEqual(["0:1", "1:1"]);
    expect(t.candidateRun()).toBe(0);
    // after the split the root family holds 5:2 alone (2:1's half would leave nothing): no further candidate
    for (let step = 5200; step <= 12000; step += 100) t.observe(atb(step, { "5:1": 25, "5:2": 25 }), g);
    expect(t.families()).toHaveLength(2);
  });

  it("a split moves the families already split below it beneath the new family, keeping their names", () => {
    const t = new FamilyTree();
    const lin1 = { "2:1": 20, "3:1": 20 }; // the founder is dead, so only the siblings 2:1 and 3:1 qualify (1:1 would leave no remainder)
    for (let step = 100; step <= 5000; step += 100) expect(t.observe(atb(step, lin1), GRAPH)).toEqual([]);
    const first = t.observe(atb(5100, lin1), GRAPH);
    expect(first.map((e) => [e.kind, e.family])).toEqual([["split", "2:1"]]);
    const bName = t.families().find((f) => f.founder === "2:1")!.name;
    // a new key hangs from the founder: now 1:1 splits C's side from the rest, with B's family beneath it
    const lin2 = { "3:1": 20, "6:1": 20 };
    // B's family has no cell left and goes extinct (its name stays on the tree); nothing else happens
    expect(kinds(t.observe(atb(5200, lin2), GRAPH))).toEqual(["extinct"]);
    for (let step = 5300; step < 10200; step += 100) expect(t.observe(atb(step, lin2), GRAPH)).toEqual([]);
    const second = t.observe(atb(10200, lin2), GRAPH);
    expect(second.map((e) => [e.kind, e.family])).toEqual([["split", "1:1"]]);
    const fam = t.families();
    expect(fam.map((f) => [f.founder, f.parent, f.depth])).toEqual([
      ["0:1", null, 0],
      ["1:1", "0:1", 1],
      ["2:1", "1:1", 2],
    ]);
    expect(fam[2].name).toBe(bName); // names stay
    expect(fam[2].parentName).toBe(fam[1].name);
    // both splits carry the root's genus
    expect(fam.every((f) => f.name.startsWith(fam[0].name))).toBe(true);
    expect(new Set(fam.map((f) => f.name)).size).toBe(3);
  });

  it("is not tripped by lineages that are not (any longer) living, nor by a family that has gone extinct", () => {
    const t = new FamilyTree();
    for (let step = 100; step <= 6000; step += 100) t.observe(atb(step, step < 3000 ? { "4:1": 20, "5:2": 16 } : { "4:1": 20 }), chain);
    expect(t.families()).toHaveLength(1);
  });
});

describe("bodies, purity, film and extinction", () => {
  it("a body belongs to the family holding most of its keyed cells (a tie: the older founding key); purity is the family's own share of the bodies it owns", () => {
    const t = new FamilyTree();
    t.observe(
      at(100, { "0:1": 70, "0:2": 40 }, [
        bodyOf(1, ["0:1", 30], ["0:2", 10]),
        bodyOf(2, ["0:1", 10]),
        bodyOf(3, ["0:2", 15], ["0:1", 15]), // tied: the older founding key owns it
        bodyOf(4, ["0:2", 20]),
      ]),
      ledger({}),
    );
    const [a, b] = t.families();
    expect([a.founder, a.bodies, a.purity, a.bodyNow]).toEqual(["0:1", 3, (30 + 10 + 15) / (40 + 10 + 30), true]);
    expect([b.founder, b.bodies, b.purity, b.bodyNow]).toEqual(["0:2", 1, 1, true]);
  });

  it("purity is none for a family with no body, a body counts its own cells against its total, and a body with no keyed cell has no family", () => {
    const t = new FamilyTree();
    t.observe(
      at(100, { "0:1": 50, "0:2": 20 }, [
        { id: 1, cells: 50, keys: [["0:1", 40]] }, // 10 cells carry no lineage
        { id: 2, cells: 30, keys: [] },
      ]),
      ledger({}),
    );
    const [a, b] = t.families();
    expect(a.purity).toBe(40 / 50);
    expect(a.bodies).toBe(1);
    expect([b.purity, b.bodies, b.bodyNow]).toEqual([null, 0, false]);
  });

  it("film means no cell in any body, not a lost plurality: a family that is a minority of a shared body is still in a body", () => {
    const t = new FamilyTree();
    for (let step = 100; step <= 1000; step += 100) t.observe(at(step, { "0:1": 60, "0:2": 20 }, [bodyOf(1, ["0:1", 60], ["0:2", 5])]), ledger({}));
    const b = t.families()[1];
    expect([b.status, b.bodyNow, b.bodies, b.purity]).toEqual(["living", true, 0, null]);
    expect(t.events()).toEqual([]);
  });

  it("gone to film only after 5 censuses in a row with no cell in a body (logged at the fifth, saying since when), back only after 5 in a body", () => {
    const t = new FamilyTree();
    const inBody = [bodyOf(1, ["0:1", 30])];
    const frame = (step: number, body: boolean) => t.observe(at(step, { "0:1": 30 }, body ? inBody : []), ledger({}));
    expect(frame(100, true)).toEqual([]);
    for (let step = 200; step <= 500; step += 100) expect(frame(step, false)).toEqual([]); // 4 censuses out of a body
    expect(frame(600, true)).toEqual([]); // reset
    for (let step = 700; step <= 1000; step += 100) expect(frame(step, false)).toEqual([]);
    const gone = frame(1100, false);
    expect(gone.map((e) => [e.step, e.kind, e.family])).toEqual([[1100, "film", "0:1"]]);
    expect(gone[0].detail).toContain("since t=700");
    expect(t.families()[0].status).toBe("film");
    expect(t.summary()).toMatchObject({ living: 0, film: 1 });
    for (let step = 1200; step <= 1500; step += 100) expect(frame(step, true)).toEqual([]); // 4 in a body: still film
    expect(t.families()[0].status).toBe("film");
    expect(t.families()[0].bodyNow).toBe(true);
    expect(frame(1600, false)).toEqual([]);
    for (let step = 1700; step <= 2000; step += 100) expect(frame(step, true)).toEqual([]);
    const back = frame(2100, true);
    expect(back.map((e) => [e.step, e.kind])).toEqual([[1600 + 500, "back"]]);
    expect(t.families()[0].status).toBe("living");
    expect(kinds(t.events())).toEqual(["film", "back"]);
  });

  it("a family never in a body goes to film after its first 5 censuses", () => {
    const t = new FamilyTree();
    for (let step = 100; step < 500; step += 100) expect(t.observe(at(step, { "0:1": 30 }), ledger({}))).toEqual([]);
    expect(t.observe(at(500, { "0:1": 30 }), ledger({})).map((e) => [e.kind, e.detail.includes("since t=100")])).toEqual([["film", true]]);
  });

  it("extinct at the first census with no living cell, and final", () => {
    const t = new FamilyTree();
    t.observe(at(100, { "0:1": 30, "0:2": 20 }, [bodyOf(1, ["0:1", 30]), bodyOf(2, ["0:2", 20])]), ledger({}));
    expect(t.observe(at(200, { "0:1": 30 }, [bodyOf(1, ["0:1", 30])]), ledger({})).map((e) => [e.kind, e.family])).toEqual([["extinct", "0:2"]]);
    const b = t.families()[1];
    expect([b.status, b.cells, b.bodies, b.purity, b.share]).toEqual(["extinct", 0, 0, null, 0]);
    // nothing brings it back: it stays extinct, and says so once
    for (let step = 300; step <= 1500; step += 100) expect(t.observe(at(step, { "0:1": 30 }, [bodyOf(1, ["0:1", 30])]), ledger({}))).toEqual([]);
    expect(t.families()[1].status).toBe("extinct");
    expect(t.summary()).toMatchObject({ living: 1, extinct: 1 });
    // a family in film goes straight to extinct
    const u = new FamilyTree();
    for (let step = 100; step <= 500; step += 100) u.observe(at(step, { "0:1": 30, "0:2": 10 }, [bodyOf(1, ["0:1", 30])]), ledger({}));
    expect(u.families()[1].status).toBe("film");
    expect(kinds(u.observe(at(600, { "0:1": 30 }, [bodyOf(1, ["0:1", 30])]), ledger({})))).toEqual(["extinct"]);
  });

  it("a split family counts its cells out of its parent's: the shares add up to the jar", () => {
    const t = new FamilyTree();
    const lin = { "4:1": 20, "5:2": 16, "0:1": 4 };
    const g = ledger({ "1:1": "0:1", "2:1": "1:1", "4:1": "2:1", "5:2": "0:1" });
    for (let step = 100; step <= 5100; step += 100) t.observe(at(step, lin, [bodyOf(1, ["4:1", 20]), bodyOf(2, ["5:2", 16], ["0:1", 4])]), g);
    const fam = t.families();
    expect(fam.map((f) => f.cells)).toEqual([20, 20]);
    expect(fam.reduce((a, f) => a + f.share, 0)).toBeCloseTo(1, 12);
    expect(fam.map((f) => f.bodies)).toEqual([1, 1]);
    expect(fam[0].purity).toBe(20 / 20);
  });
});

describe("tree order and views", () => {
  it("lists parents before children, siblings by founding step and then key birth order, with depth", () => {
    const g = ledger({ "1:1": "0:1", "2:1": "0:1", "9:1": "1:1", "9:2": "1:1", "5:1": "1:1" });
    const t = new FamilyTree();
    t.observe(at(100, { "0:1": 40, "0:5": 5 }), g);
    t.observe(at(200, { "0:1": 40, "0:5": 5, "0:3": 7 }), g); // a later root
    const order = t.families().map((f) => [f.founder, f.depth]);
    expect(order).toEqual([["0:1", 0], ["0:5", 0], ["0:3", 0]]);
  });
});

describe("step guard", () => {
  it("a census at or below the last step is a no-op", () => {
    const t = new FamilyTree();
    t.observe(at(100, { "0:1": 20 }), ledger({}));
    t.observe(at(200, { "0:1": 20 }), ledger({}));
    const before = JSON.stringify(t.snapshot());
    expect(t.observe(at(200, { "0:9": 99 }), ledger({}))).toEqual([]);
    expect(t.observe(at(100, { "0:9": 99 }), ledger({}))).toEqual([]);
    expect(JSON.stringify(t.snapshot())).toBe(before);
    expect(t.lastStep).toBe(200);
    expect(t.watchedFrom).toBe(100);
  });

  it("a fresh tree has nothing", () => {
    const t = new FamilyTree();
    expect(t.families()).toEqual([]);
    expect(t.events()).toEqual([]);
    expect(t.candidateRun()).toBe(0);
    expect(t.splitsAt(100)).toEqual([]);
    expect(t.summary()).toEqual({ rules: "families-v1", watchedFrom: null, step: null, named: 0, starting: 0, split: 0, living: 0, film: 0, extinct: 0 });
    expect(t.observe(at(100, {}), ledger({}))).toEqual([]);
    expect(t.families()).toEqual([]);
    expect(FAMILY_THRESHOLDS).toEqual({ halfCells: 16, splitSteps: 5000, filmCensuses: 5 });
  });

  it("keeps no reference to what it was fed", () => {
    const t = new FamilyTree();
    const lineages = [{ key: "0:1", cells: 30 }];
    const bodies = [{ id: 1, cells: 30, keys: [["0:1", 30]] as [string, number][] }];
    t.observe({ step: 100, lineages, bodies }, ledger({}));
    const before = JSON.stringify(t.snapshot());
    lineages[0].cells = 0;
    bodies[0].keys[0][1] = 999;
    expect(JSON.stringify(t.snapshot())).toBe(before);
  });
});

describe("snapshot and restore", () => {
  /** The reparenting history: the first split at 5,100, the second at 10,200, a body that comes and goes, and a family that dies. */
  const script = (): FamilyInput[] => {
    const out: FamilyInput[] = [];
    for (let step = 100; step <= 11000; step += 100) {
      const lin: Record<string, number> = step < 5200 ? { "2:1": 20, "3:1": 20 } : { "3:1": 20, "6:1": 20 };
      if (step >= 3000 && step < 3400) lin["0:7"] = 12; // a root that comes and goes
      const bodies = step % 1300 < 700 ? [bodyOf(1, ["3:1", 20])] : [];
      out.push(at(step, lin, bodies));
    }
    return out;
  };

  it("restoring at any census then feeding the rest gives the same tree as an uninterrupted one", () => {
    const all = script();
    const whole = new FamilyTree();
    const wholeEvents = all.flatMap((i) => whole.observe(i, GRAPH));
    expect(kinds(wholeEvents.filter((e) => e.kind === "split" || e.kind === "extinct" || e.kind === "found"))).toEqual(["found", "extinct", "split", "extinct", "split"]);
    for (let cut = 0; cut <= all.length; cut++) {
      const a = new FamilyTree();
      const head = all.slice(0, cut).flatMap((i) => a.observe(i, GRAPH));
      const b = FamilyTree.restore(JSON.parse(JSON.stringify(a.snapshot())));
      expect(b.snapshot()).toEqual(a.snapshot());
      const restEvents = all.slice(cut).flatMap((i) => b.observe(i, GRAPH));
      expect([...head, ...restEvents]).toEqual(wholeEvents);
      expect(JSON.stringify(b.snapshot())).toBe(JSON.stringify(whole.snapshot()));
      expect(b.families()).toEqual(whole.families());
      expect(b.events()).toEqual(whole.events());
      expect(b.summary()).toEqual(whole.summary());
      expect(b.candidateRun()).toBe(whole.candidateRun());
    }
  });

  it("a restored tree keeps its step guard, and is independent of the snapshot and of the tree it came from", () => {
    const a = new FamilyTree();
    a.observe(at(100, { "0:1": 20 }), ledger({}));
    const snap = a.snapshot();
    const b = FamilyTree.restore(snap);
    a.observe(at(200, { "0:1": 20, "0:2": 20 }), ledger({}));
    expect(b.lastStep).toBe(100);
    expect(snap.lastStep).toBe(100);
    expect(b.observe(at(100, { "0:5": 5 }), ledger({}))).toEqual([]);
    b.observe(at(200, { "0:1": 20 }), ledger({}));
    expect(snap.lastStep).toBe(100);
    expect(FamilyTree.restore(JSON.parse(JSON.stringify(new FamilyTree().snapshot()))).families()).toEqual([]);
  });

  it("refuses what is not a snapshot", () => {
    const good = new FamilyTree();
    for (const i of script().slice(0, 60)) good.observe(i, GRAPH);
    const snap = () => JSON.parse(JSON.stringify(good.snapshot()));
    const bad = (mut: (s: Record<string, unknown>) => void) => {
      const s = snap();
      mut(s);
      expect(() => FamilyTree.restore(s)).toThrow();
    };
    const rec = (s: Record<string, unknown>, i: number) => (s.recs as Record<string, unknown>[])[i];
    expect(() => FamilyTree.restore(snap())).not.toThrow();
    expect((snap().recs as unknown[]).length).toBeGreaterThanOrEqual(2);
    bad((s) => (s.v = 2));
    bad((s) => (s.ruleSet = "families-v0"));
    bad((s) => delete s.recs);
    bad((s) => (s.lastStep = null));
    bad((s) => (s.livingCells = -1));
    bad((s) => (rec(s, 0).name = "Other"));
    bad((s) => (rec(s, 1).name = rec(s, 0).name));
    bad((s) => (rec(s, 0).genus = 64));
    bad((s) => (rec(s, 0).status = "gone"));
    bad((s) => (rec(s, 0).cells = -1));
    bad((s) => (rec(s, 1).founder = rec(s, 0).founder));
    bad((s) => (rec(s, 0).parent = rec(s, 0).founder));
    bad((s) => (rec(s, 0).parent = "9:9"));
    bad((s) => (rec(s, 0).origin = "split")); // a split family has a parent and an epithet
    bad((s) => (rec(s, 0).founded = 99999));
    bad((s) => (rec(s, 0).bodyNow = 1));
    bad((s) => (s.runs = [["1:1", "nope", 100]]));
    bad((s) => (s.runs = [["1:1", rec(s, 0).founder, 99999]]));
    bad((s) => (s.runs = [["1:1", rec(s, 0).founder, 100], ["1:1", rec(s, 0).founder, 100]]));
    bad((s) => (s.events = [{ step: 100, kind: "mystery", family: rec(s, 0).founder, name: rec(s, 0).name, detail: "" }]));
    bad((s) => (s.events = [{ step: 100, kind: "film", family: rec(s, 0).founder, name: "Wrong", detail: "" }]));
    bad((s) => (s.splits = [{ name: "No such", parentName: rec(s, 0).name, step: 100, cells: 1, parentCells: 1 }]));
    expect(() => FamilyTree.restore(null as never)).toThrow();
  });
});

describe("from a census", () => {
  it("buildFamilyInput carries the census lineages and the bodies' compositions, and a tree can be fed with it", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, tilesX: 1, tilesY: 1 });
    const n = 32 * 32;
    const cells = new Uint32Array(7 * n);
    const genomeHead = new Uint32Array(4 * n);
    const put = (x0: number, w: number, hi: number, lo: number) => {
      for (let y = 4; y < 9; y++)
        for (let x = x0; x < x0 + w; x++) {
          const i = y * 32 + x;
          cells[CH.B * n + i] = 64;
          genomeHead[G.LIN_HI * n + i] = hi;
          genomeHead[G.LIN_LO * n + i] = lo;
        }
    };
    put(2, 6, 0, 1);
    put(8, 3, 4, 2); // touching: one body of 45 cells, 30 + 15
    put(20, 4, 0, 3); // another body, a founder
    const c = census({ cfg, step: 100, cells, genomeHead });
    const tracker = new Tracker();
    tracker.update(c);
    const lc = readLineageCells(c, tracker, genomeHead, firstsContext(cfg, 100));
    const input = buildFamilyInput(c, lc);
    expect(input.step).toBe(100);
    expect(input.lineages.map((l) => [l.key, l.cells]).sort()).toEqual([["0:1", 30], ["0:3", 20], ["4:2", 15]]);
    expect(input.bodies.map((b) => [b.cells, b.keys])).toEqual([[45, [["0:1", 30], ["4:2", 15]]], [20, [["0:3", 20]]]]);
    const t = new FamilyTree();
    t.observe(input, ledger({ "4:2": "0:1" }));
    expect(t.families().map((f) => [f.founder, f.cells, f.bodies, f.purity])).toEqual([["0:1", 45, 1, 1], ["0:3", 20, 1, 1]]);
  });
});
