import { describe, expect, it } from "vitest";
import { G, cellCount, cloneState, defaultConfig, initWorld, type WorldState } from "@bl/schema";
import { RefSim, type MutationEvent } from "@bl/sim-ref";
import { MutationEdges, applyMutation, genomesOf, lineageAncestry, lineageView, mutationSite, probeLineage, wordsHex, type EdgeEvent, type Key } from "../src/index.ts";

const ev = (child: string, parent: string): EdgeEvent => {
  const [childHi, childLo] = child.split(":").map(Number), [parentHi, parentLo] = parent.split(":").map(Number);
  return { childHi, childLo, parentHi, parentLo };
};
const byChild = (a: MutationEvent, b: MutationEvent) => a.childHi - b.childHi || a.childLo - b.childLo;

/** A small CPU history with a raised mutation rate; its ledger drained every 50 steps, sorted as GpuSim drains it. */
function history() {
  const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 23, mutRate: 429_497 * 80 });
  const start = initWorld(cfg, { kind: "m3", founders: 13, nutrient: 256, biomass: 256 });
  const sim = new RefSim(cloneState(start));
  const drains: MutationEvent[][] = [];
  let at100: WorldState | null = null;
  for (let t = 1; t <= 200; t++) {
    if (t % 50 === 1) drains.push([]);
    drains[drains.length - 1].push(...sim.step().events);
    if (t === 100) at100 = cloneState(sim.state);
  }
  for (const d of drains) d.sort(byChild);
  const n = cellCount(cfg);
  const cells = new Map<Key, number>();
  for (let i = 0; i < n; i++) {
    const hi = sim.state.genome[G.LIN_HI * n + i], lo = sim.state.genome[G.LIN_LO * n + i];
    if (hi | lo) cells.set(`${hi}:${lo}`, (cells.get(`${hi}:${lo}`) ?? 0) + 1);
  }
  const rows = [...cells].sort((a, b) => b[1] - a[1]);
  return { cfg, start, sim, drains, at100: at100!, rows };
}
const h = history();
const deepest = (edges: MutationEdges, keys: Key[]) => {
  let best = keys[0], depth = -1;
  for (const k of keys) {
    let d = 0;
    for (let p = edges.parentOf(k); p !== undefined; p = edges.parentOf(p)) d++;
    if (d > depth) [best, depth] = [k, d];
  }
  return best;
};

describe("MutationEdges", () => {
  it("finds parents, children and descendants, and round-trips through words", () => {
    const e = new MutationEdges();
    e.append([ev("2:1", "0:1"), ev("2:5", "0:2")]);
    e.append([ev("5:3", "2:1"), ev("7:7", "2:1"), ev("9:1", "5:3")]);
    expect(e.length).toBe(5);
    expect(e.parentOf("9:1")).toBe("5:3");
    expect(e.parentOf("0:1")).toBeUndefined();
    expect(e.parentOf("5:4")).toBeUndefined();
    expect(e.childCounts(["0:1", "2:1", "9:1"])).toEqual(new Map([["0:1", 1], ["2:1", 2], ["9:1", 0]]));
    expect([...e.descendants("2:1")].sort()).toEqual(["5:3", "7:7", "9:1"]);
    expect(e.countBefore(5)).toBe(3);
    const copy = new MutationEdges(e.words());
    expect(copy.length).toBe(5);
    expect(copy.parentOf("7:7")).toBe("2:1");
    copy.truncate(2);
    expect(copy.parentOf("5:3")).toBeUndefined();
    expect(() => copy.truncate(3)).toThrow(/cannot keep 3 of 2/);
  });

  it("refuses edges out of child order or minted no later than their parent, and grows past its first buffer", () => {
    const e = new MutationEdges();
    e.append([ev("3:1", "0:1")]);
    expect(() => e.append([ev("3:1", "0:2")])).toThrow(/does not follow 3:1/);
    expect(() => e.append([ev("4:1", "4:0")])).toThrow(/not minted before it/);
    expect(e.length).toBe(1);
    const many = Array.from({ length: 5000 }, (_, i) => ev(`${10 + i}:1`, "3:1"));
    e.append(many);
    expect(e.length).toBe(5001);
    expect(e.parentOf("5009:1")).toBe("3:1");
    expect(() => new MutationEdges(new Uint32Array(5))).toThrow(/whole number of edges/);
  });
});

describe("lineageView", () => {
  const edges = new MutationEdges();
  for (const d of h.drains) edges.append(d);
  const live = { source: "live world", genomes: genomesOf(h.sim.state, h.cfg) };
  const startWorld = { source: "start world", genomes: genomesOf(h.start, h.cfg) };
  const census = { step: 200, rows: h.rows };
  const subject = deepest(edges, h.rows.map((r) => r[0]));

  it("replays a living lineage from its founder and checks it against the live world", () => {
    const v = lineageView({ subject, cfg: h.cfg, edges, known: [startWorld, live], census, edgesFrom: 0, dropped: 0 });
    expect(v.chain.length).toBeGreaterThan(2);
    expect(v.chain[0].key.startsWith("0:")).toBe(true);
    expect(v.chain[0].genomeFrom).toBe("start world");
    expect(v.chain.slice(1).every((n) => n.genomeFrom === "replayed")).toBe(true);
    expect(v.chain[v.chain.length - 1].checkedBy).toEqual(["live world"]);
    expect(v.mutations).toHaveLength(v.chain.length - 1);
    expect(v.mutations.every((m) => m.expression !== null && m.before !== null)).toBe(true);
    expect(v.cells).toBe(h.rows.find((r) => r[0] === subject)![1]);
    expect(v.gaps).toEqual([]);
    // The same replay, done by hand.
    let w = startWorld.genomes.get(v.chain[0].key)!;
    for (let i = 1; i < v.chain.length; i++) w = applyMutation(w, v.chain[i].key, v.chain[i - 1].key, h.cfg).words;
    expect(wordsHex(w)).toBe(wordsHex(live.genomes.get(subject)!));
  });

  it("starts at what a world loaded from a file can know, and says what it cannot", () => {
    const later = new MutationEdges();
    for (const d of h.drains.slice(2)) later.append(d); // the edges after step 100
    const restored = { source: "restored state", genomes: genomesOf(h.at100, h.cfg) };
    const v = lineageView({ subject, cfg: h.cfg, edges: later, known: [restored, live], census, edgesFrom: 100, dropped: 0 });
    const root = v.chain[0];
    expect(root.minted === null || root.minted < 100).toBe(true);
    if (root.minted !== null) expect(v.gaps.join("\n")).toMatch(/mutation edges start at step 100/);
    expect(v.chain[v.chain.length - 1].checkedBy).toEqual(["live world"]);
  });

  it("names the mutation sites of ancestors whose genomes are unknown", () => {
    const onlySubject = { source: "live world", genomes: new Map([[subject, live.genomes.get(subject)!]]) };
    const v = lineageView({ subject, cfg: h.cfg, edges, known: [onlySubject], census, edgesFrom: 0, dropped: 3 });
    expect(v.chain.findIndex((n) => n.genomeFrom !== null)).toBe(v.chain.length - 1);
    expect(v.chain[0].genomeFrom).toBeNull();
    expect(v.mutations[0].before).toBeNull();
    expect(v.mutations[0].locus).toBe(mutationSite(v.chain[1].key, h.cfg).locus);
    expect(v.gaps.join("\n")).toMatch(/3 mutation events were dropped/);
    expect(v.gaps.join("\n")).toMatch(/ancestor genome\(s\) are unknown/);
  });

  it("says that counts start where a loaded world's edges start, even for a founder", () => {
    const founder = [...startWorld.genomes.keys()][0];
    const v = lineageView({ subject: founder, cfg: h.cfg, edges, known: [startWorld], census, edgesFrom: 20_000, dropped: 0 });
    expect(v.chain).toHaveLength(1);
    expect(v.gaps.join("\n")).toMatch(/recorded from step 20000.*not counted/);
  });

  it("probes in slices to the same view, and stops when cancelled", async () => {
    const input = { subject, cfg: h.cfg, edges, known: [startWorld, live], census, edgesFrom: 0, dropped: 0 };
    const whole = lineageView(input);
    const sliced = lineageAncestry(input);
    expect(sliced.view.chain.every((n) => n.probe === null)).toBe(true);
    expect(await probeLineage(sliced, { batch: 2 })).toBe(true);
    expect(sliced.view).toEqual(whole);
    const stopped = lineageAncestry(input);
    expect(await probeLineage(stopped, { batch: 1, cancelled: () => true })).toBe(false);
    expect(stopped.view.chain.slice(1).every((n) => n.probe === null)).toBe(true);
  });

  it("refuses to report when a replayed genome disagrees with a known one", () => {
    const tampered = new Map(live.genomes);
    const w = tampered.get(subject)!.slice();
    w[G.PARAM1] ^= 1;
    tampered.set(subject, w);
    expect(() => lineageView({ subject, cfg: h.cfg, edges, known: [startWorld, { source: "live world", genomes: tampered }], census, edgesFrom: 0, dropped: 0 })).toThrow(/differs from the live world/);
  });
});
