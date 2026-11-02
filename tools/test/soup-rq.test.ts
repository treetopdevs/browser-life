import { describe, expect, it } from "vitest";
import { TAPE } from "../soup/bff.ts";
import { hex } from "../soup/evo.ts";
import { GROUPS, History, plant, plantGroups, plantSlots } from "../soup/hall.ts";
import { aVerdict, bounded, cVerdict, net, orderRho, playerKey, pooledOrderTest, sideOf, signFlip, sustainedSeries } from "../soup/rq.ts";

const row = (id: string, b = 1) => ({ id, rep: hex(new Uint8Array(TAPE).fill(b)), mirror: null });

describe("hall history (doc: Each interval)", () => {
  it("changes leader only after two consecutive censuses, by exact id", () => {
    const h = new History();
    h.observe(row("A"), 0);
    expect(h.members.map((m) => m.id)).toEqual(["A"]);
    h.observe(row("B"), 1); // once: no change
    expect(h.members[h.current].id).toBe("A");
    h.observe(row("A"), 2);
    h.observe(row("B"), 3);
    h.observe(null, 4); // a census with no copier breaks the run
    h.observe(row("B"), 5);
    expect(h.members[h.current].id).toBe("A");
    h.observe(row("B"), 6);
    expect(h.members[h.current].id).toBe("B");
    expect(h.changes).toBe(1);
    expect(h.members[1].since).toBe(6); // forms frozen at the second census
  });
  it("a type that leads again keeps its first forms and is not re-admitted", () => {
    const h = new History();
    h.observe(row("A", 1), 0);
    h.observe(row("B"), 1); h.observe(row("B"), 2);
    h.observe(row("A", 9), 3); h.observe(row("A", 9), 4);
    expect(h.members.length).toBe(2);
    expect(h.members[h.current].id).toBe("A");
    expect(h.members[0].forms[0]).toBe(row("A", 1).rep);
    expect(h.changes).toBe(2);
  });
  it("returned marks a leader that came back, even when it is the newest member", () => {
    const h = new History();
    for (const [id, e] of [["A", 0], ["B", 1], ["B", 2], ["C", 3], ["C", 4]] as const) h.observe(row(id), e);
    expect(h.returned).toBe(false);
    h.observe(row("B"), 5); h.observe(row("B"), 6);
    expect(h.returned).toBe(true);
    h.observe(row("C"), 7); h.observe(row("C"), 8); // C is the newest member, yet it came back
    expect(h.members[h.current].id).toBe("C");
    expect(h.returned).toBe(true);
    h.observe(row("D"), 9); h.observe(row("D"), 10);
    expect(h.returned).toBe(false);
  });
  it("save and load round-trip", () => {
    const h = new History();
    h.observe(row("A"), 0); h.observe(row("B"), 1); h.observe(row("B"), 2);
    h.rr = 8;
    const g = History.load(JSON.parse(JSON.stringify(h.save())));
    expect(g.save()).toEqual(h.save());
    g.observe(row("C"), 3); h.observe(row("C"), 3);
    g.observe(row("C"), 4); h.observe(row("C"), 4);
    expect(g.save()).toEqual(h.save());
  });
});

describe("planting (doc: Arms)", () => {
  const hist = (ids: string[]) => {
    const h = new History();
    ids.forEach((id, i) => { h.observe(row(id, i + 1), 2 * i); if (i) h.observe(row(id, i + 1), 2 * i + 1); });
    return h;
  };
  it("CTRL plants the current leader; HALL with no past does too", () => {
    const h = hist(["A"]);
    expect(plantGroups("CTRL", h)).toEqual(Array(GROUPS).fill(h.members[0].forms));
    expect(plantGroups("HALL", h)).toEqual(Array(GROUPS).fill(h.members[0].forms));
  });
  it("HALL round-robins over every past leader, excluding the current one", () => {
    const h = hist(["A", "B", "C", "D", "E", "F"]); // current F; past A..E
    const ids = (g: string[][]) => g.map((f) => h.members.find((m) => m.forms === f)!.id);
    expect(ids(plantGroups("HALL", h))).toEqual(["A", "B", "C", "D"]);
    expect(ids(plantGroups("HALL", h))).toEqual(["E", "A", "B", "C"]);
    const c = hist(["A", "B", "C", "D", "E", "F"]);
    expect(plantGroups("CTRL", c).every((f) => f === c.members[5].forms)).toBe(true);
    expect(c.rr).toBe(0);
  });
  it("slots are distinct, deterministic and the dose is the same in both arms", () => {
    const s = plantSlots(1000, 400, 7, 512);
    expect(new Set(s).size).toBe(400);
    expect(s.every((x) => x >= 0 && x < 1000)).toBe(true);
    expect(plantSlots(1000, 400, 7, 512)).toEqual(s);
    expect(plantSlots(1000, 400, 7, 1024)).not.toEqual(s);
    const h = hist(["A", "B"]);
    const a = new Uint8Array(1000 * TAPE), b = new Uint8Array(1000 * TAPE);
    expect(plant(a, plantGroups("HALL", h), 10, 7, 512)).toBe(plant(b, plantGroups("CTRL", h), 10, 7, 512));
  });
  it("writes group g into its own P slots", () => {
    const progs = new Uint8Array(100 * TAPE);
    plant(progs, [[row("x", 3).rep], [row("y", 5).rep]], 10, 1, 0);
    const slots = plantSlots(100, 20, 1, 0);
    expect(slots.slice(0, 10).every((s) => progs[s * TAPE] === 3)).toBe(true);
    expect(slots.slice(10).every((s) => progs[s * TAPE] === 5)).toBe(true);
    let n = 0;
    for (let p = 0; p < 100; p++) if (progs[p * TAPE]) n++;
    expect(n).toBe(20);
  });
});

describe("scores and tests (doc: Score, Part A, C1)", () => {
  it("player keys separate equal ids with different forms", () => {
    expect(playerKey({ id: "a", forms: ["00"] })).not.toBe(playerKey({ id: "a", forms: ["01"] }));
    expect(playerKey({ id: "a", forms: ["00"] })).toBe(playerKey({ id: "a", forms: ["00"] }));
  });
  it("sides and net, with the failed-race modes", () => {
    expect(sideOf("a", true)).toBe("win");
    expect(sideOf("a", false)).toBe("loss");
    expect(sideOf("coexist", true)).toBe("other");
    const s = ["win", "win", "loss", "other", "failed", "failed"] as const;
    expect(net([...s])).toBeCloseTo(1 / 6);
    expect(net([...s], "win")).toBeCloseTo(3 / 6);
    expect(net([...s], "loss")).toBeCloseTo(-1 / 6);
    expect(() => net(["win"])).toThrow();
  });
  it("order rho is 0 for constant scores and handles ties", () => {
    expect(orderRho([0, 0, 0])).toBe(0);
    expect(orderRho([0, 1, 2])).toBeCloseTo(1);
    expect(orderRho([2, 1, 1])).toBeCloseTo(-Math.sqrt(3) / 2);
  });
  it("pooled order test: strong trend is significant, none is not, seeded", () => {
    const up = [[0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5], [0, 1, 2, 3]];
    const r = pooledOrderTest(up, 20000);
    expect(r.T).toBeCloseTo(4);
    expect(r.p).toBeLessThan(0.001);
    expect(aVerdict(r.T, r.p)).toBe("LATER MORE GENERAL");
    const flat = pooledOrderTest([[1, 1, 1, 1], [0, 0, 0]], 2000);
    expect(flat.T).toBe(0);
    expect(flat.p).toBeCloseTo(1, 2);
    expect(pooledOrderTest(up, 2000).p).toBe(pooledOrderTest(up, 2000).p);
  });
  it("sign flip: exact p and the non-zero rule", () => {
    const all = signFlip([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(all.p).toBeCloseTo(2 / 512);
    expect(cVerdict(all)).toBe("HISTORY MAKES MORE GENERAL");
    const five = signFlip([1, 1, 1, 1, 1, 0, 0, 0, 0]);
    expect(five.nonzero).toBe(5);
    expect(five.p).toBeCloseTo(2 / 32); // zeros flip to themselves
    expect(cVerdict(five)).toBe("INSUFFICIENT EVIDENCE");
    expect(cVerdict(signFlip([-1, -1, -1, -1, -1, -1, 0, 0, 0]))).toBe("HISTORY MAKES LESS GENERAL");
    expect(cVerdict(signFlip([1, -1, 1, -1, 1, -1, 1, 0, 0]))).toBe("NO DIFFERENCE SHOWN");
  });
  it("failed-race bound", () => {
    expect(bounded({ "as-is": "X", win: "X", loss: "X" })).toBe("X");
    expect(bounded({ "as-is": "X", win: "Y", loss: "X" })).toBe("INSUFFICIENT (failed races)");
  });
  it("run 1's sustained series", () => {
    expect(sustainedSeries(["A", "B", "B", "A", "C", null, "C", "C"])).toEqual(["A", "B", "B", "B", "B", "B", "C", "C"]);
  });
});
