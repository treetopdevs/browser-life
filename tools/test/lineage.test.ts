import { describe, expect, it } from "vitest";
import { G, NN_BYTES, defaultConfig, encodeGenome, generalistGenome, randomGenome } from "@bl/schema";
import {
  ancestry,
  applyMutation,
  buildDossier,
  censuses,
  decodeKey,
  descendants,
  expressionOf,
  genomesOf,
  locusOf,
  pickSubject,
  probeGenome,
  readMutationLog,
  slotValue,
  tsvRows,
  initialGenomes,
  initialTiles,
  wordsHex,
  type Mutation,
} from "../lib/lineage.ts";
import { birthNode, pondIndex, pondRoute } from "../lib/pond-descent.ts";
import { parsePondRows } from "../lib/pond-lineage.ts";
import { MUT_HEADER, cpu as sharedCpu, rows } from "./lineage-fixture.ts";
import { CPU_PERIOD, CPU_STEPS, birthsLines, cpuPond, founder, handPondBundle, key, pondsLines, type HandCycle, type HandSpec } from "./pond-bundle-fixture.ts";

const cpu = sharedCpu();

describe("genome reconstruction", () => {
  it("rebuilds every living lineage's genome from the initial world and the mutation log alone", () => {
    expect(cpu.events.length).toBeGreaterThan(300);
    const words = new Map(cpu.initial);
    for (const e of cpu.events) {
      const parent = words.get(`${e.parentHi}:${e.parentLo}`);
      expect(parent).toBeDefined();
      words.set(`${e.childHi}:${e.childLo}`, applyMutation(parent!, `${e.childHi}:${e.childLo}`, `${e.parentHi}:${e.parentLo}`, cpu.cfg).words);
    }
    const live = genomesOf(cpu.sim.state, cpu.cfg);
    expect(live.size).toBeGreaterThan(10);
    for (const [k, w] of live) expect(Array.from(words.get(k)!)).toEqual(Array.from(w));
  });

  it("changes only the reported slot, and reports a clamp when nothing changed", () => {
    const cfg = defaultConfig({ seed: 5 });
    let clamped = 0;
    for (let t = 0; t < 400; t++) {
      const g = randomGenome(t, 60, 20, t % 2 ? 127 : 64); // range 127 saturates bytes, so clamps happen
      const parent = encodeGenome(g, 0, 1);
      const { words, mutation } = applyMutation(parent, `${1000 + t}:${t * 7}`, "0:1", cfg);
      expect(words[G.LIN_HI]).toBe(1000 + t);
      expect(words[G.LIN_LO]).toBe(t * 7);
      for (let s = 0; s < NN_BYTES + 3; s++) if (s !== mutation.slot) expect(slotValue(words, s)).toBe(slotValue(parent, s));
      expect(mutation.after).toBe(slotValue(words, mutation.slot));
      expect(mutation.clamped).toBe(mutation.before === mutation.after);
      if (mutation.clamped) clamped++;
    }
    expect(clamped).toBeGreaterThan(0);
  });

  it("names loci at their boundaries", () => {
    expect([0, 79, 80, 88, 151, 152, 159, 160, 161, 162].map((s) => locusOf(s).label)).toEqual([
      "A→h0", "U→h7", "bias h0", "h0→photo", "h7→moveY", "bias photo", "bias moveY", "μ", "σ", "motility gain",
    ]);
  });

  it("decodes where and when a lineage was minted", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, tilesX: 2, tilesY: 1 });
    expect(decodeKey("0:4", cfg)).toEqual({ founder: 3 });
    expect(decodeKey(`101:${64 * 3 + 40}`, cfg)).toEqual({ minted: 100, cell: 232, x: 40, y: 3, tile: 1 });
    const ring = { ...cfg, ringNamespace: 5 };
    expect(decodeKey(`101:${((5 << 22) | 232) >>> 0}`, ring)).toMatchObject({ cell: 232, x: 40, y: 3 });
  });
});

describe("controller probe", () => {
  const parent = encodeGenome(generalistGenome(60, 20), 0, 1);
  const withByte = (slot: number, v: number) => {
    const w = parent.slice();
    const wi = G.W0 + (slot >> 2), sh = (slot & 3) * 8;
    w[wi] = ((w[wi] & ~(0xff << sh)) | ((v & 0xff) << sh)) >>> 0;
    return w;
  };
  const mut = (slot: number, before: number, after: number): Mutation => ({ child: "2:1", parent: "0:1", step: 1, cell: 1, slot, ...locusOf(slot), kind: locusOf(slot).kind, locus: locusOf(slot).label, before, after, clamped: before === after });
  const p0 = probeGenome(parent);

  it("attributes a bias change to its own output only", () => {
    const slot = 152; // bias photo
    const after = slotValue(parent, slot) + 30;
    const e = expressionOf(mut(slot, slotValue(parent, slot), after), p0, probeGenome(withByte(slot, after)));
    expect(e.expression).toBe("controller");
    expect(e.maxDelta[0]).toBeGreaterThan(0);
    expect(e.maxDelta.slice(1).every((d) => d === 0)).toBe(true);
  });

  it("classes physics parameters and clamps apart from the controller", () => {
    expect(expressionOf(mut(160, 60, 72), p0, p0).expression).toBe("physics");
    expect(expressionOf(mut(5, 3, 3), p0, p0).expression).toBe("clamped");
    expect(expressionOf(mut(5, 3, 9), p0, p0).expression).toBe("probe-silent");
  });

  it("reports a light curve and regime counts", () => {
    expect(p0.lightCurve).toHaveLength(16);
    expect(p0.lightCurve[0]).toHaveLength(9);
    expect(p0.regimes).toBeGreaterThan(0);
    expect(p0.activeHidden).toBeLessThanOrEqual(8);
  });
});

describe("tables and rules", () => {
  it("reads the mutation log, counting duplicates and conflicts", async () => {
    const log = await readMutationLog(rows([MUT_HEADER, "2\t10\t0\t11", "2\t10\t0\t11", "2\t10\t0\t12", "5\t3\t2\t10", ""]));
    expect(log.parent.get("2:10")).toBe("0:11");
    expect(log.rows).toBe(4);
    expect(log.duplicates).toBe(1);
    expect(log.conflicts).toEqual([{ child: "2:10", first: "0:11", other: "0:12" }]);
    await expect(readMutationLog(rows(["child\tparent"]))).rejects.toThrow(/header/);
  });

  it("walks ancestry root first and refuses a cycle", () => {
    const p = new Map([["2:10", "0:11"], ["5:3", "2:10"]]);
    expect(ancestry("5:3", p)).toEqual(["0:11", "2:10", "5:3"]);
    expect(() => ancestry("1:1", new Map([["1:1", "2:2"], ["2:2", "1:1"]]))).toThrow(/cycle/);
  });

  it("finds descendants whatever the row order", () => {
    const edges: [string, string][] = [["5:1", "2:1"], ["9:4", "5:1"], ["7:2", "2:1"], ["8:8", "3:3"], ["12:1", "9:4"], ["3:3", "0:1"], ["2:1", "0:1"]];
    const fwd = descendants("2:1", new Map(edges));
    const rev = descendants("2:1", new Map([...edges].reverse()));
    expect([...fwd].sort()).toEqual(["12:1", "5:1", "7:2", "9:4"]);
    expect([...rev].sort()).toEqual([...fwd].sort());
  });

  it("refuses parent links that do not go back in time, so no walk can loop", async () => {
    const loop = new Map([["2:1", "3:1"], ["3:1", "2:1"]]); // unrelated to the subject 0:1
    expect(() => descendants("0:1", loop)).toThrow(/not ordered by birth step/);
    await expect(readMutationLog(rows([MUT_HEADER, "2\t1\t3\t1", "3\t1\t2\t1"]))).rejects.toThrow(/not minted before it/);
    await expect(readMutationLog(rows([MUT_HEADER, "4\t1\t4\t2"]))).rejects.toThrow(/not minted before it/);
  });

  it("picks subjects by rule, deterministically", () => {
    const census: [string, number][] = [["9:1", 50], ["3:2", 50], ["0:4", 10], ["7:7", 300], ["12:1", 2]];
    expect(pickSubject({ kind: "top" }, census)).toBe("7:7");
    expect(pickSubject({ kind: "top" }, census.filter((r) => r[0] !== "7:7"))).toBe("3:2"); // tie: earlier minted
    expect(pickSubject({ kind: "longest" }, census)).toBe("0:4");
    const r = { kind: "random" as const, seed: 3, minShare: 0.05 };
    const pick = pickSubject(r, census);
    expect(["9:1", "3:2", "7:7"]).toContain(pick);
    expect(pickSubject(r, [...census].reverse())).toBe(pick);
    expect(pickSubject({ ...r, minShare: 0.9 }, census)).toBeNull();
    for (const seed of [1.5, -1, 2 ** 32]) expect(() => pickSubject({ ...r, seed }, census)).toThrow(/seed/);
    for (const minShare of [-0.1, 1.5, NaN]) expect(() => pickSubject({ ...r, minShare }, census)).toThrow(/minShare/);
  });

  it("checks table shapes", async () => {
    const it1 = censuses(rows(["step\tlineage\tcells", "100\t0:1\t5", "50\t0:1\t5"]));
    await expect((async () => { for await (const _ of it1); })()).rejects.toThrow(/ascending/);
    const it2 = tsvRows("profiles.tsv", rows(["step\tlineage\tcells", "1\t0:1\t2"]), ["role"]);
    await expect((async () => { for await (const _ of it2); })()).rejects.toThrow(/missing column/);
  });
});

describe("dossier", () => {
  it("assembles a verified dossier for the top lineage of a CPU history", async () => {
    const d = await buildDossier(cpu.source(), { kind: "top" });
    const last = cpu.files["lineages.tsv"].filter((l) => l.startsWith("200\t")).map((l) => l.split("\t"));
    const top = last.reduce((a, b) => (Number(b[2]) > Number(a[2]) ? b : a));
    expect(Number(d.subject.cellsAtStep)).toBe(Number(top[2]));
    expect(d.root.source).toBe("initial world");
    expect(d.chain[0].key.startsWith("0:")).toBe(true);
    expect(d.mutations).toHaveLength(d.chain.length - 1);
    expect(d.verification.genomesChecked).toBe(d.chain.filter((c) => c.firstSeen !== null).length);
    expect(d.population.steps).toHaveLength(4);
    expect(d.population.clade.every((c, i) => c <= d.population.living[i])).toBe(true);
    expect(d.mutations.every((m, i) => m.parent === d.chain[i].key && m.child === d.chain[i + 1].key)).toBe(true);
    expect(d.log.complete).toBe(true);
    expect(d.subject.aliveAtEnd).toBe(true);
  });

  it("takes the census step from the rule, and refuses a contradictory option", async () => {
    const d = await buildDossier(cpu.source(), { kind: "top", step: 100 });
    expect(d.rule.step).toBe(100);
    const at100 = cpu.files["lineages.tsv"].filter((l) => l.startsWith("100\t")).map((l) => Number(l.split("\t")[2]));
    expect(d.subject.cellsAtStep).toBe(Math.max(...at100));
    await expect(buildDossier(cpu.source(), { kind: "top", step: 100 }, { step: 150 })).rejects.toThrow(/disagree/);
    await expect(buildDossier(cpu.source(), { kind: "top", step: 1.5 })).rejects.toThrow(/integer/);
  });

  it("tells empty censuses at the end of an extinct run from missing ones", async () => {
    // series.jsonl lists censuses 250 and 300 with no lineage, which lineages.tsv cannot show.
    const count = (step: number) => cpu.files["lineages.tsv"].filter((l) => l.startsWith(`${step}\t`)).length;
    const series = [50, 100, 150, 200, 250, 300].map((step) => JSON.stringify({ step, lineages: count(step) }));
    const m = { ...cpu.manifest, summary: { ...cpu.manifest.summary, steps: 300, finalLineages: 0 } };
    const src = cpu.source({ "series.jsonl": series }, m);
    const d = await buildDossier(src, { kind: "top" });
    expect(d.rule.step).toBe(200);
    expect(d.provenance.finalCensus).toBe(300);
    expect(d.subject.aliveAtEnd).toBe(false);
    expect(d.gaps.join("\n")).toMatch(/no lineage is alive at the final census \(step 300\)/);
    expect(d.population.steps).toEqual([50, 100, 150, 200, 250, 300]);
    expect(d.population.living.slice(4)).toEqual([0, 0]);
    const k = await buildDossier(src, { kind: "key", key: d.subject.key });
    expect(k.rule.step).toBe(300);
    expect(k.subject.cellsAtStep).toBe(0);
    await expect(buildDossier(src, { kind: "top", step: 300 })).rejects.toThrow(/no lineage is alive there/);
    await expect(buildDossier(src, { kind: "top", step: 275 })).rejects.toThrow(/no census at step 275/);
    // Rows missing where series.jsonl records lineages are a truncated table, not an extinction.
    const truncated = series.map((l) => l.replace('"lineages":0', '"lineages":3'));
    await expect(buildDossier(cpu.source({ "series.jsonl": truncated }, m), { kind: "top" })).rejects.toThrow(/records 3 lineage\(s\) there: lineages.tsv is incomplete/);
    const short = cpu.files["lineages.tsv"].filter((l) => !l.startsWith("200\t"));
    await expect(buildDossier(cpu.source({ "series.jsonl": series, "lineages.tsv": short }, m), { kind: "top", step: 150 })).rejects.toThrow(/step 200.*lineages.tsv is incomplete/);
    const miscount = series.map((l) => l.replace(/"step":100,"lineages":\d+/, '"step":100,"lineages":1'));
    await expect(buildDossier(cpu.source({ "series.jsonl": miscount }, m), { kind: "top" })).rejects.toThrow(/at step 100, series.jsonl records 1/);
  });

  it("checks the log by distinct children, and flags a root that is not a founder", async () => {
    const d = await buildDossier(cpu.source(), { kind: "top" });
    const subjectRow = cpu.files["mutations.tsv"].findIndex((l) => l.startsWith(`${d.subject.key.replace(":", "\t")}\t`));
    expect(subjectRow).toBeGreaterThan(0);
    // Lose the subject's own event and repeat another: the row count still matches the run's count.
    const muts = cpu.files["mutations.tsv"].filter((_, i) => i !== subjectRow);
    muts.push(muts[1]);
    expect(muts.length).toBe(cpu.files["mutations.tsv"].length);
    const cut = await buildDossier(cpu.source({ "mutations.tsv": muts }), { kind: "key", key: d.subject.key });
    expect(cut.log.complete).toBe(false);
    expect(cut.root).toEqual({ key: d.subject.key, source: "genomes.tsv" });
    const gaps = cut.gaps.join("\n");
    expect(gaps).toMatch(/distinct children but the run counted/);
    expect(gaps).toMatch(/1 mutations.tsv row\(s\) repeat/);
    expect(gaps).toMatch(new RegExp(`root ${d.subject.key} is not a founder`));
  });

  it("refuses when a reconstructed ancestor disagrees with genomes.tsv", async () => {
    const d = await buildDossier(cpu.source(), { kind: "top" });
    const victim = d.chain.find((c) => c.firstSeen !== null && c.minted !== null)!.key;
    const tampered = cpu.files["genomes.tsv"].map((l) => (l.startsWith(`${victim}\t`) ? l.replace(/.$/, (c) => (c === "0" ? "1" : "0")) : l));
    await expect(buildDossier(cpu.source({ "genomes.tsv": tampered }), { kind: "key", key: d.subject.key })).rejects.toThrow(/differs from genomes.tsv/);
  });

  it("refuses when the root genome cannot be established", async () => {
    const bad = { ...cpu.manifest, initHash: "0000000000000000" };
    await expect(buildDossier(cpu.source({ "genomes.tsv": null }, bad), { kind: "top" })).rejects.toThrow(/genome of root .* unknown/);
    // genomes.tsv still records the founders, so the root can come from there.
    const d = await buildDossier(cpu.source({}, bad), { kind: "top" });
    expect(d.root.source).toBe("genomes.tsv");
  });

  it("reports what a bundle without observer files lacks", async () => {
    const d = await buildDossier(cpu.source({ "genomes.tsv": null }), { kind: "longest" });
    expect(d.verification.against).toBeNull();
    expect(d.gaps.join("\n")).toMatch(/genomes.tsv absent/);
    expect(d.gaps.join("\n")).toMatch(/births.tsv absent/);
    expect(d.trackerBirths).toBeNull();
  });
});

describe("pond-cycle bundles", () => {
  // Boundary 1: ponds 0 and 2 seed from pond 1, ponds 1 and 3 from pond 3. Boundary 2: every pond from pond 2.
  // 0:2 (founder of pond 1) -> A (pond 2, cycle 2) -> B (pond 0, cycle 3); C is an unrelated mint in pond 3.
  const A = key(150, 2), B = key(250, 0), C = key(120, 3);
  const cycles: HandCycle[] = [
    { donors: [1, 3, 1, 3], packets: [{ lineages: 2, dom: founder(1), share: 0.7 }, { lineages: 1, dom: founder(3) }, { lineages: 1, dom: founder(1), share: 1 }, { lineages: 1, dom: founder(3) }] },
    { donors: [2, 2, 2, 2], packets: [{ lineages: 3, dom: A, share: 0.4 }, { lineages: 1, dom: A }, { lineages: 1, dom: A }, { lineages: 1, dom: A }] },
    { donors: [0, 0, 0, 0], packets: [{ lineages: 1, dom: B }, { lineages: 1, dom: B }, { lineages: 1, dom: B }, { lineages: 1, dom: B }] },
  ];
  const census = {
    50: [[founder(0), 90], [founder(1), 95], [founder(2), 80], [founder(3), 85]],
    100: [[founder(1), 120], [founder(3), 100]],
    150: [[founder(1), 60], [A, 4], [C, 3]],
    200: [[founder(1), 50], [A, 40]],
    250: [[A, 30], [B, 2]],
    300: [[A, 10], [B, 70]],
  } as Record<number, [string, number][]>;
  const scaf = (over: Partial<HandSpec> = {}) =>
    handPondBundle({ mutations: [[A, founder(1)], [C, founder(3)], [B, A]], ponds: pondsLines(cycles), census, steps: 300, ...over });

  it("no longer refuses a pond bundle; genotype descent equals mutations.tsv", async () => {
    const d = await buildDossier(scaf(), { kind: "key", key: B });
    expect(d.chain.map((c) => c.key)).toEqual([founder(1), A, B]);
    expect(d.root.source).toBe("initial world");
    expect(d.log.complete).toBe(true);
    expect(d.provenance.files).toContain("ponds.tsv");
    expect(d.pond).toMatchObject({ arm: "scaf", period: 100, ponds: 4, exact: 2, notRecorded: 0, anchor: { ponds: [0], cycle: 3, source: "subject birth" } });
    expect(d.pond!.edges.map((e) => e.crossings.map((c) => [c.boundary, c.from, c.to, c.carried]))).toEqual([[[1, 1, 2, "named"]], [[2, 2, 0, "named"]]]);
    expect(d.gaps.join("\n")).not.toMatch(/HTML panel does not draw/);
    expect(d.gaps.join("\n")).toMatch(/pond occupancy at a census \(lineages.tsv is world-wide\), spread across ponds and anything between boundaries are not recorded/);
    // The same bundle with a donor edited so that A's packet comes from pond 3: refused, not reported.
    const edited = pondsLines([{ ...cycles[0], donors: [1, 3, 3, 3] }, cycles[1], cycles[2]]);
    await expect(buildDossier(scaf({ ponds: edited }), { kind: "key", key: B })).rejects.toThrow(/hand: 0:2 -> 150:\d+: the walk through ponds.tsv lands on pond 3 at cycle 0, but 0:2 was born in pond 1 \(refusing to report\)/);
    // Without ponds.tsv the genotype dossier still stands; only the crossing edges lose their route.
    const bare = await buildDossier(scaf({ ponds: null }), { kind: "key", key: B });
    expect(bare.pond).toMatchObject({ exact: 0, notRecorded: 2 });
    expect(bare.gaps.join("\n")).toMatch(/ponds.tsv absent/);
    // Non-pond runs carry pond: null.
    expect((await buildDossier(cpu.source(), { kind: "longest" })).pond).toBeNull();
  });

  it("tracker births at the first census after a cycle are excluded and counted; cont excludes none", async () => {
    const births = birthsLines([[50, "fission", founder(1), "9:9"], [150, "fission", A, "8:8"], [200, "budding", A, "7:7"], [150, "budding", "1:1", A]]);
    const d = await buildDossier(scaf({ births }), { kind: "key", key: A });
    expect(d.trackerBirths).toMatchObject({ fission: 0, budding: 1, asParent: 1, asChild: 0, excludedAcrossCycle: 2 });
    expect(d.gaps.join("\n")).toMatch(/first census after each pond boundary .* left out \(2 touching the subject\)/);
    // Without series.jsonl the cut comes from the census grid: 150 - 50 is boundary 1.
    expect((await buildDossier(scaf({ births, series: false }), { kind: "key", key: A })).trackerBirths!.excludedAcrossCycle).toBe(2);
    // cont: the runner flags afterCycle there too, but nothing is ground, so nothing is left out.
    const contCycles: HandCycle[] = [0, 1, 2].map(() => ({ donors: [-1, -1, -1, -1] }));
    const A1 = key(150, 1);
    const cont = handPondBundle({ arm: "cont", mutations: [[A1, founder(1)]], ponds: pondsLines(contCycles), census: { 300: [[A1, 5]] }, steps: 300, births: birthsLines([[150, "fission", A1, "8:8"]]) });
    expect(cont.files["series.jsonl"].some((l) => l.includes('"step":150,') && l.includes("afterCycle"))).toBe(true);
    const c = await buildDossier(cont, { kind: "key", key: A1 });
    expect(c.trackerBirths).toMatchObject({ fission: 1, excludedAcrossCycle: 0 });
    expect(c.pond).toMatchObject({ arm: "cont", exact: 1 });
  });

  it("anchored dossier (pondAnchor) walks from the donor node and refuses a lineage born after the anchor cycle", async () => {
    // A is the dominant of the packets of boundary 2, taken from pond 2's snapshot: anchor (2, 2), census step 200.
    const d = await buildDossier(scaf(), { kind: "key", key: A }, { step: 200, pondAnchor: { pond: 2, cycle: 2 } });
    expect(d.rule.step).toBe(200);
    expect(d.pond!.anchor).toEqual({ ponds: [2], cycle: 2, source: "given" });
    expect(d.pond!.edges.at(-1)).toMatchObject({ parent: A, child: null, status: "exact", crossings: [] });
    await expect(buildDossier(scaf(), { kind: "key", key: B }, { step: 200, pondAnchor: { pond: 2, cycle: 2 } })).rejects.toThrow(/born at cycle 3, after its anchor/);
    await expect(buildDossier(scaf(), { kind: "key", key: A }, { step: 200, pondAnchor: { pond: 1, cycle: 2 } })).rejects.toThrow(/lands on pond 1/);
    await expect(buildDossier(cpu.source(), { kind: "longest" }, { pondAnchor: { pond: 0, cycle: 1 } })).rejects.toThrow(/needs a pond-cycle run/);
  });

  it("checks picks.jsonl against ponds.tsv and carries who picked", async () => {
    const pick = (step: number, donors: number[], by = "random") => JSON.stringify({ step, kind: "pick", cycle: step / 100, donors, by, suggested: donors });
    // Seed 1 ranks cycle 1's ponds 0, 3, 2, 1, so the ordered pick [1, 3] gives recipients 0..3 donors 1, 3, 1, 3.
    const picks = [pick(100, [1, 3]), JSON.stringify({ step: 200, kind: "failed", cycle: 2, by: "random", error: "x" }), pick(200, [2], "recorded"), pick(300, [0])];
    const d = await buildDossier(scaf({ picks, picked: true }), { kind: "key", key: B });
    expect(d.pond!.picks).toEqual({ lines: 3, checked: 3, partial: 0, unchecked: 0, unlogged: 0, torn: false, by: { random: 2, recorded: 1 } });
    // The same donors in the other order assign them to other recipients: the runner would have written other rows.
    await expect(buildDossier(scaf({ picks: [pick(100, [3, 1])], picked: true }), { kind: "key", key: B })).rejects.toThrow(/the records disagree/);
    // A torn last pick line is dropped: its boundary is then not logged, and both facts are gaps.
    const torn = await buildDossier(scaf({ picks: [...picks.slice(0, 3), '{"step":300,"ki'], picked: true }), { kind: "key", key: B });
    expect(torn.pond!.picks).toMatchObject({ checked: 2, unlogged: 1, torn: true });
    expect(torn.gaps.join("\n")).toMatch(/picks.jsonl ends in a torn line/);
    expect(torn.gaps.join("\n")).toMatch(/ponds.tsv has 1 boundary\(ies\) the pick log lacks/);
    expect(d.pond!.edges.flatMap((e) => e.crossings.map((c) => c.by))).toEqual(["random", "recorded"]);
    await expect(buildDossier(scaf({ picks: [pick(100, [1])], picked: true }), { kind: "key", key: B })).rejects.toThrow(/the records disagree/);
    expect((await buildDossier(scaf({ picked: true }), { kind: "key", key: B })).gaps.join("\n")).toMatch(/picks.jsonl absent from a picked run/);
  });

  it("real CPU pond history: genomes match genomes.tsv, routes walk exact across boundaries, ids imply mass", async () => {
    const h = cpuPond();
    const cfg = h.cfg;
    expect(h.idWithoutMass.every((n) => n === 0)).toBe(true);
    // Birth nodes against the real snapshots: a lineage born in the current period sits only in its birth tile.
    for (const [step, tiles] of h.tilesAt) {
      const c = Math.ceil(step / CPU_PERIOD);
      for (const [k, ts] of tiles) {
        const b = birthNode(k, cfg, null);
        expect(b.cycle).toBeLessThanOrEqual(c);
        if (b.cycle === c && b.ponds) expect([...ts]).toEqual(b.ponds);
      }
    }
    const log = await readMutationLog(rows(h.files["mutations.tsv"]));
    const recorded = new Map(h.files["genomes.tsv"].slice(1).map((l) => l.split("\t")).map((f) => [f[0], f[2]]));
    const index = pondIndex(parsePondRows(h.files["ponds.tsv"]), cfg);
    const tiles = initialTiles(h.manifest);
    expect(tiles).not.toBeNull();
    const living = h.files["lineages.tsv"].filter((l) => l.startsWith(`${CPU_STEPS}\t`)).map((l) => l.split("\t")[1]);
    expect(living.length).toBeGreaterThan(3);
    let crossing = 0, edges = 0;
    for (const k of living) {
      const chain = ancestry(k, log.parent);
      let w = h.initial.get(chain[0])!;
      for (let i = 1; i < chain.length; i++) w = applyMutation(w, chain[i], chain[i - 1], cfg).words;
      expect(wordsHex(w)).toBe(recorded.get(k));
      const r = pondRoute(chain, cfg, index, { initialTiles: tiles });
      expect(r.notRecorded).toBe(0);
      edges += r.edges.length;
      crossing += r.edges.filter((e) => e.crossings.length > 0).length;
    }
    expect(edges).toBeGreaterThan(0);
    expect(crossing).toBeGreaterThan(0);
    const d = await buildDossier(h.source(), { kind: "top" });
    expect(d.pond!.exact).toBe(d.pond!.edges.length);
    expect(d.verification.genomesChecked).toBeGreaterThan(0);
    // The dominant of a boundary-2 packet opens anchored at its donor node.
    const row = parsePondRows(h.files["ponds.tsv"]).rows.find((r) => r.cycle === 2 && r.packetLineages! > 0)!;
    const g = await buildDossier(h.source(), { kind: "key", key: `${row.domHi}:${row.domLo}` }, { step: 2 * CPU_PERIOD, pondAnchor: { pond: row.donor, cycle: 2 } });
    expect(g.pond!.anchor).toMatchObject({ ponds: [row.donor], cycle: 2, source: "given" });
    expect(g.pond!.notRecorded).toBe(0);
  }, 300_000);

  it("review fixes: cont needs no census grid, a missing table reads right in cont, the anchor census must hold the packet dominant", async () => {
    const contCycles: HandCycle[] = [0, 1, 2].map(() => ({ donors: [-1, -1, -1, -1] }));
    const A1 = key(150, 1);
    const cont = (over: Partial<HandSpec> = {}) => handPondBundle({ arm: "cont", mutations: [[A1, founder(1)]], ponds: pondsLines(contCycles), census: { 300: [[A1, 5]] }, steps: 300, births: birthsLines([[150, "fission", A1, "8:8"]]), ...over });
    const bare = cont({ series: false });
    delete (bare.manifest as any).spec.censusEvery;
    expect((await buildDossier(bare, { kind: "key", key: A1 })).trackerBirths).toMatchObject({ fission: 1, excludedAcrossCycle: 0 });
    const noGrid = scaf({ series: false, births: birthsLines([[150, "fission", A, "8:8"]]) });
    delete (noGrid.manifest as any).spec.censusEvery;
    await expect(buildDossier(noGrid, { kind: "key", key: A })).rejects.toThrow(/without series.jsonl or spec.censusEvery/);
    const noTable = await buildDossier(cont({ ponds: null }), { kind: "key", key: A1 });
    expect(noTable.pond).toMatchObject({ exact: 1, notRecorded: 0 });
    expect(noTable.gaps.join("\n")).toMatch(/ponds.tsv absent: arm cont moves nothing between ponds, so no route needs it/);
    // A anchored at the census where boundary 2's packets were measured, but lineages.tsv lacks it there.
    const thin = scaf({ census: { ...census, 200: [[founder(1), 50]] } });
    await expect(buildDossier(thin, { kind: "key", key: A }, { step: 200, pondAnchor: { pond: 2, cycle: 2 } })).rejects.toThrow(/has no row in lineages.tsv at step 200, yet the pond anchor .* the records contradict each other/);
  });

  it("review fixes: a continuation bundle, a torn table and arm nat end to end", async () => {
    // A continuation from step 200 holds boundary 3 only. P0 (minted at 150, before the bundle) -> Q (pond 0, cycle 4):
    // boundary 3 is crossed and checked, boundary 2 is in the earlier bundle.
    const P0 = key(150, 2), Q = key(320, 0);
    const late = handPondBundle({ startStep: 200, mutations: [[Q, P0]], ponds: pondsLines([{ donors: [2, 2, 2, 2], packets: [{ lineages: 1, dom: P0 }] }], { first: 3 }), census: { 350: [[Q, 4]] }, steps: 350 });
    // P0 was minted before the bundle: its genome comes from genomes.tsv (here, a founder's words).
    late.files["genomes.tsv"] = ["lineage\tfirstStep\twords", `${P0}\t150\t${wordsHex(initialGenomes(scaf().manifest)!.get(founder(2))!)}`];
    const c = await buildDossier(late, { kind: "key", key: Q });
    expect(c.pond!.edges[0]).toMatchObject({ status: "not recorded", crossings: [{ boundary: 3, from: 2, to: 0, carried: "named" }] });
    expect(c.gaps.join("\n")).toMatch(/boundary 2 \(step 200\) is not in this bundle, which starts at step 200/);
    // A torn last ponds.tsv row (cut mid-line): only the edge through it loses its route.
    const lines = pondsLines(cycles);
    const cut = [...lines.slice(0, -1), lines[lines.length - 1].slice(0, 25)];
    const t = await buildDossier(scaf({ ponds: cut }), { kind: "key", key: B });
    expect(t.pond).toMatchObject({ exact: 2, notRecorded: 0 });
    expect(t.gaps.join("\n")).toMatch(/ponds.tsv line 13 is a torn last append/);
    expect(t.gaps.join("\n")).toMatch(/cycle\(s\) 3 lack rows/);
    // Arm nat: survivors (-2) walk to themselves, a dying pond's packet crosses; births after a boundary are cut conservatively.
    const hunt: HandCycle[] = [
      { donors: [-2, 0, -2, -2], packets: [undefined, { lineages: 1, dom: founder(0) }] },
      { donors: [-2, -2, 1, -2], packets: [undefined, undefined, { lineages: 1, dom: key(150, 1) }] },
    ];
    const N1 = key(150, 1), N2 = key(250, 2);
    const nat = handPondBundle({ arm: "nat", mutations: [[N1, founder(0)], [N2, N1]], ponds: pondsLines(hunt, { died: true }), census: { 300: [[N2, 6]] }, steps: 300, births: birthsLines([[250, "fission", N2, "8:8"], [300, "budding", N2, "7:7"]]) });
    const n = await buildDossier(nat, { kind: "key", key: N2 });
    expect(n.pond).toMatchObject({ arm: "nat", exact: 2, notRecorded: 0, crossings: { named: 2, notExcluded: 0, notRecorded: 0 } });
    expect(n.pond!.edges.map((e) => e.crossings.map((x) => [x.boundary, x.from, x.to]))).toEqual([[[1, 0, 1]], [[2, 1, 2]]]);
    expect(n.trackerBirths).toMatchObject({ fission: 0, budding: 1, excludedAcrossCycle: 1 });
    expect(n.gaps.join("\n")).toMatch(/in arm nat this is conservative/);
  }, 120_000);
});
