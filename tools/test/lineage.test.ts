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
  type Mutation,
} from "../lib/lineage.ts";
import { MUT_HEADER, cpu as sharedCpu, rows } from "./lineage-fixture.ts";

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
