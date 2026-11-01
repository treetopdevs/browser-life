import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NN_BYTES, generalistGenome, randomGenome, type Genome } from "@bl/schema";
import {
  ARCHIVE_CELLS,
  ATLAS_V1,
  Archive,
  DEFAULT_ARCHIVE,
  DEFAULT_EVAL,
  HELDOUT_ASSAYS,
  SEED_LEDGER,
  atlasCell,
  genomeKey,
  heldoutConfig,
  mutateGenome,
  proposalGenome,
  searchedArchive,
  type AtlasEval,
  type Evaluation,
  type Provenance,
} from "@bl/search";

const genome = (fill: number): Genome => ({ mu: 60, sigma: 20, motGain: 0, weights: new Int8Array(NN_BYTES).fill(fill) });
const ev = (partial: Partial<Evaluation>): Evaluation => ({ survived: 4, recovered: 4, lightDependent: 4, reps: 4, individuals: 1, meanMass: 256, speed: 1, mass: 256, recovery: 1, regenerated: 4, reproduction: 0, ...partial });
const atlas = (d1: number | null, d2: number | null): AtlasEval => ({ reps: 4, d1, d2, comPath: d1, d1Defined: d1 === null ? 0 : 4, d2Defined: d2 === null ? 0 : 4 });

// A small deterministic offer stream with parents, displacement, duplicates and non-passers.
function stream(): { genome: Genome; eval: Evaluation; born: number; prov?: Provenance }[] {
  const out: { genome: Genome; eval: Evaluation; born: number; prov?: Provenance }[] = [];
  const g0 = generalistGenome(60, 20);
  out.push({ genome: g0, eval: ev({ recovery: 0.5, speed: 0.5 }), born: 0, prov: { op: "generalist", parent: null } });
  for (let i = 1; i < 30; i++) {
    const parent = Math.floor(i / 2);
    const pg = out[parent].genome;
    const seed = 1000 + i, count = 1 + (i % 4);
    out.push({
      genome: i % 11 === 0 ? randomGenome(5, 60, 20) : mutateGenome(pg, seed, count),
      eval: ev({ recovery: ((i * 37) % 100) / 100 + 0.01, speed: (i % 9) / 2, meanMass: 100 * (1 + (i % 13)), regenerated: i % 5 }),
      born: Math.floor(i / 4),
      prov: i % 11 === 0 ? { op: "random", parent: null, seed: 5 } : { op: "mutant", parent, seed, count },
    });
  }
  return out;
}
const strip = (log: ReturnType<typeof stream>) => log.map(({ prov: _p, ...r }) => r);
const snap = (a: Archive) => ({
  cells: a.elites().map((e) => [e.cell, genomeKey(e.genome), e.quality]),
  passers: a.gatePassing().map((e) => genomeKey(e.genome)),
  lineages: a.lineages().map((l) => [l.size, l.passers, l.best.length, l.best[0].cell, l.best[0].quality]),
  evaluated: a.evaluated,
});

describe("provenance does not change the archive", () => {
  const log = stream();
  it("cells, passers and lineages are identical with and without prov", () => {
    expect(snap(Archive.replay(log, 99))).toEqual(snap(Archive.replay(strip(log), 99)));
  });
  it("a viable.jsonl line without prov decodes to undefined and offers identically", () => {
    const line = JSON.parse(JSON.stringify({ born: 3, eval: ev({}), genome: { mu: 60, sigma: 20, motGain: 0, weights: Array.from(genome(2).weights) } }));
    expect(line.prov).toBeUndefined();
    const a = new Archive();
    a.offer({ ...line.genome, weights: Int8Array.from(line.genome.weights) }, line.eval, line.born, line.prov);
    expect(a.ledger()[0].prov).toBeUndefined();
    expect(a.ledger()[0].inserted).toBe(true);
  });
  it("the mass/speed cell function is untouched by the opt-in argument", () => {
    const a = new Archive(), b = new Archive(DEFAULT_ARCHIVE, undefined, undefined, ARCHIVE_CELLS["mass-speed"]);
    const e = ev({ meanMass: 1000, speed: 2 });
    expect(a.cellOf(e)).toEqual(b.cellOf(e));
    expect(a.cellOf(e)).toEqual([3, 4]);
  });
});

describe("accepted-candidate ledger", () => {
  const a = Archive.replay(stream(), 100);
  const led = a.ledger();
  it("has one entry per viable offer, in order, with the proposal it came from", () => {
    expect(led.map((l) => l.idx)).toEqual(a.viableLog().map((_, i) => i));
    expect(led[0].prov).toEqual({ op: "generalist", parent: null });
    expect(led[5].prov).toMatchObject({ op: "mutant", parent: 2 });
  });
  it("agrees with the archive: inserted/current/displaced", () => {
    const current = led.filter((l) => l.current).map((l) => l.idx).sort((x, y) => x - y);
    expect(current).toEqual(a.elites().map((e) => e.idx!).sort((x, y) => x - y));
    for (const l of led) if (l.displaced !== null) {
      expect(l.inserted).toBe(true);
      expect(led[l.displaced].cell).toEqual(l.cell);
      expect(led[l.displaced].current).toBe(false);
    }
    // Every inserted entry took a cell at the time; a later one may have displaced it.
    expect(led.filter((l) => l.inserted).length).toBeGreaterThanOrEqual(current.length);
    expect(a.elites().length).toBe(current.length);
  });
  it("counts passers and duplicates", () => {
    expect(led.filter((l) => l.passer).length).toBe(a.viableLog().filter((e) => a.gate(e.eval)).length);
    expect(led.filter((l) => l.duplicate).length).toBeGreaterThan(0);
    expect(led.every((l) => !l.duplicate || led.findIndex((o) => o.key === l.key) < l.idx)).toBe(true);
  });
  it("keeps the earlier elite on an equal-quality tie and does not log non-viable offers", () => {
    const t = new Archive();
    t.offer(genome(1), ev({}), 0);
    t.offer(genome(2), ev({}), 0); // same cell, equal quality: not inserted
    t.offer(genome(3), ev({ survived: 0 }), 0); // quality 0: counted, never logged
    const l = t.ledger();
    expect(l.map((x) => [x.inserted, x.current, x.displaced])).toEqual([[true, true, null], [false, false, null]]);
    expect(t.evaluated).toBe(3);
    expect(t.viableLog()).toHaveLength(2);
  });
  it("is rebuilt exactly by replay", () => {
    expect(Archive.replay(a.viableLog(), a.evaluated).ledger()).toEqual(led);
  });
  it("lets an audit regenerate a mutant from its parent and the logged arguments", () => {
    for (const l of led) {
      if (l.prov?.op !== "mutant") continue;
      const regen = proposalGenome(l.prov, a.viableLog()[l.prov.parent!].genome, 60, 20);
      expect(genomeKey(regen)).toBe(l.key);
    }
    expect(genomeKey(proposalGenome({ op: "random", parent: null, seed: 9 }, undefined, 60, 20))).toBe(genomeKey(randomGenome(9, 60, 20)));
    expect(genomeKey(proposalGenome({ op: "generalist-mutant", parent: null, seed: 4, count: 6 }, undefined, 60, 20))).toBe(genomeKey(mutateGenome(generalistGenome(60, 20), 4, 6)));
    expect(() => proposalGenome({ op: "mutant", parent: 0, seed: 1, count: 1 }, undefined, 60, 20)).toThrow(/parent/);
  });
});

describe("atlas archive (opt-in)", () => {
  const cellFn = ARCHIVE_CELLS["atlas-v1"]!;
  it("places by descriptors, keeps undefined-descriptor offers as stepping stones without a cell", () => {
    const a = new Archive(DEFAULT_ARCHIVE, undefined, undefined, cellFn);
    a.offer(genome(1), ev({ atlas: atlas(0.5, 0.9) }), 0);
    a.offer(genome(2), ev({ atlas: atlas(null, 0.9) }), 0);
    a.offer(genome(3), ev({ atlas: atlas(0.5, 0.9), recovery: 0.2 }), 0); // same cell, worse
    expect(a.elites()).toHaveLength(1);
    expect(a.viableLog()).toHaveLength(3);
    expect(a.lineages().reduce((s, l) => s + l.size, 0)).toBe(3);
    const led = a.ledger();
    expect(led.map((l) => l.cell === null)).toEqual([false, true, false]);
    expect(led.map((l) => l.inserted)).toEqual([true, false, false]);
    expect(a.elites()[0].cell).toEqual(atlasCell(ATLAS_V1, { atlas: atlas(0.5, 0.9) }));
  });
  it("throws on an evaluation made without the atlas observer instead of binning it as 0", () => {
    const a = new Archive(DEFAULT_ARCHIVE, undefined, undefined, cellFn);
    expect(() => a.offer(genome(1), ev({}), 0)).toThrow(/no atlas descriptors/);
  });
  it("replays under its own cell function; the wrong archive gives a different archive (why the record matters)", () => {
    const a = new Archive(DEFAULT_ARCHIVE, undefined, undefined, cellFn);
    for (let i = 0; i < 10; i++) a.offer(genome(i + 1), ev({ atlas: atlas(i / 5, i / 10), meanMass: 300, speed: 1 }), i);
    const same = Archive.replay(a.viableLog(), a.evaluated, DEFAULT_ARCHIVE, undefined, undefined, cellFn);
    expect(snap(same)).toEqual(snap(a));
    const wrong = Archive.replay(a.viableLog(), a.evaluated);
    expect(wrong.elites().length).not.toBe(a.elites().length);
  });
  it("reads the archive of record, defaulting to mass-speed, refusing unknown names and listing a disagreeing flag", () => {
    expect(searchedArchive(undefined)).toEqual({ archive: "mass-speed", ignored: [] });
    expect(searchedArchive({ archive: "atlas-v1" }, "atlas-v1")).toEqual({ archive: "atlas-v1", ignored: [] });
    expect(searchedArchive({}, "atlas-v1").ignored).toEqual(["--archive atlas-v1 (searched with mass-speed)"]);
    expect(() => searchedArchive({ archive: "toString" })).toThrow(/unknown archive/);
  });
});

describe("held-out capability tests are fixed and independent of search", () => {
  it("use environments the screening evaluation does not", () => {
    for (const id of ["H1", "H2", "H3"] as const) {
      const c = heldoutConfig(id, 0);
      expect(JSON.stringify({ ...c, seed: 0, reps: 0, recoverSteps: 0, darkSteps: 0 })).not.toBe(JSON.stringify({ ...DEFAULT_EVAL, seed: 0, reps: 0, recoverSteps: 0, darkSteps: 0 }));
    }
    expect(heldoutConfig("H1", 0)).toMatchObject({ nutrient: 16, biomass: 32, reps: 16 });
    expect(heldoutConfig("H2", 0).world).toMatchObject({ lightBase: 20, lightAmp: 80 });
    expect(heldoutConfig("H3", 0).world).toMatchObject({ lightMode: "patches" });
    expect(Object.keys(HELDOUT_ASSAYS)).toEqual(["H0", "H1", "H2", "H3"]);
  });
  it("draw seeds from a range disjoint from every search, confirmation and calibration range", () => {
    const rs = Object.entries(SEED_LEDGER).filter(([k]) => k !== "newHistoriesFrom").map(([k, v]) => [k, v as readonly [number, number]] as const);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(rs[i][1][1] < rs[j][1][0] || rs[j][1][1] < rs[i][1][0], `${rs[i][0]} vs ${rs[j][0]}`).toBe(true);
    expect(SEED_LEDGER.newHistoriesFrom).toBeGreaterThan(SEED_LEDGER.heldout[1]);
    for (const id of ["H0", "H1", "H2", "H3"] as const) for (const b of [0, 99]) {
      const s = heldoutConfig(id, b).seed;
      expect(s).toBeGreaterThanOrEqual(SEED_LEDGER.heldout[0]);
      expect(s).toBeLessThanOrEqual(SEED_LEDGER.heldout[1]);
    }
  });
  it("share no import with the descriptors or the registered held-out ecology endpoints", () => {
    const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    const imports = (f: string) => src(f).split("\n").filter((l) => /^import|from \"/.test(l)).join("\n");
    expect(imports("heldout.ts")).not.toMatch(/descriptors|atlas|endpoints/);
    expect(imports("descriptors.ts")).not.toMatch(/endpoints|heldout/);
  });
});
