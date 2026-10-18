// Pond-cycle runner bundles in the lineage tools (docs/lineage-inspector.md section 8): the CLI's pond glue
// (tools/lib/pond-bundle.ts) on hand-built bundles, and both tools on two real runner bundles kept as fixtures.
//
// tools/test/fixtures/pond-runner/ holds two bundles written by tools/run.ts on the GPU (2026-10-17, RULE as of
// origin/main 3f04d79), trimmed to the files the lineage tools read (life.jsonl, heredity.tsv, profiles.tsv and
// activity-final.json dropped; every kept file is byte-identical to the runner's):
//   scaf-picked  ponds-small, seed 1, 6,000 steps, census 100, --lineage-obs, arm scaf, --picker random --pick-seed 7
//   cont         ponds-small, seed 1, 6,000 steps, census 100, --lineage-obs, condition pond-cont
// They pin the runner's ponds.tsv, picks.jsonl and series.jsonl shapes against these readers.
import { readFileSync } from "node:fs";
import { RULE_VERSION } from "@bl/schema";
import { describe, expect, it } from "vitest";
import { ancestry, buildDossier, readMutationLog, initialTiles, type BundleSource } from "../lib/lineage.ts";
import { birthAcrossCycle, checkPicks, pondIndex, pondRoute, readPickLog } from "../lib/pond-descent.ts";
import { packetGenotype, runnerPondHistory, sameStart } from "../lib/pond-bundle.ts";
import { buildPondHistory, parsePondRows, pondDossier } from "../lib/pond-lineage.ts";
import { rows } from "./lineage-fixture.ts";
import { founder, handPondBundle, key, pondsLines, type HandCycle, type HandSpec } from "./pond-bundle-fixture.ts";

const FIXTURES = new URL("./fixtures/pond-runner/", import.meta.url);
const lines = (dir: string, f: string): string[] | null => {
  try {
    return readFileSync(new URL(`${dir}/${f}`, FIXTURES), "utf8").split("\n");
  } catch {
    return null;
  }
};
function real(dir: string): BundleSource & { manifest: any } {
  const manifest = JSON.parse(lines(dir, "manifest.json")!.join("\n"));
  // A pin like golden-hashes: a deliberate rule change makes these genomes stale, so say that rather than fail as a lineage bug.
  if (manifest.ruleVersion !== RULE_VERSION) throw new Error(`tools/test/fixtures/pond-runner/${dir} was recorded under rule ${manifest.ruleVersion}, this is rule ${RULE_VERSION}: re-record the fixture`);
  return { dir, manifest, open: (f) => (lines(dir, f) ? rows(lines(dir, f)!) : null) };
}

describe("real runner bundles", () => {
  it("scaf-picked: every recorded lineage's ancestry walks exactly through ponds.tsv, and the ordered pick log agrees", async () => {
    const src = real("scaf-picked");
    const cfg = src.manifest.cfg;
    expect(cfg).toMatchObject({ pondArm: "scaf", pondPeriod: 1000, seed: 1 });
    const parsed = parsePondRows(lines("scaf-picked", "ponds.tsv")!);
    expect(parsed.torn).toBeNull();
    const index = pondIndex(parsed, cfg);
    expect(index.cycles).toEqual([1, 2, 3, 4, 5, 6]);
    const picks = readPickLog(lines("scaf-picked", "picks.jsonl")!);
    expect(picks.torn).toBe(false);
    expect(checkPicks(index, picks.picks)).toEqual({ checked: 6, partial: 0, unchecked: 0, unlogged: 0 });
    const log = await readMutationLog(rows(lines("scaf-picked", "mutations.tsv")!));
    const tiles = initialTiles(src.manifest);
    expect(tiles).not.toBeNull();
    const recorded = lines("scaf-picked", "genomes.tsv")!.slice(1).filter(Boolean).map((l) => l.split("\t")[0]);
    let edges = 0, exact = 0, crossingEdges = 0, named = 0, notExcluded = 0;
    for (const k of recorded) {
      const r = pondRoute(ancestry(k, log.parent), cfg, index, { initialTiles: tiles, picks: { lines: picks.picks, torn: false } });
      edges += r.edges.length;
      exact += r.exact;
      crossingEdges += r.edges.filter((e) => e.crossings.length).length;
      named += r.crossings.named;
      notExcluded += r.crossings.notExcluded;
      expect(r.notRecorded).toBe(0);
      for (const c of r.edges.flatMap((e) => e.crossings)) expect(c.by).toBe("random");
    }
    // An edge counts once per recorded lineage whose ancestry holds it.
    expect({ lineages: recorded.length, edges, exact, crossingEdges, named, notExcluded }).toEqual(REAL.scafPicked);
  });

  it("scaf-picked: series.jsonl flags afterCycle exactly where the census grid puts the first census after a boundary", () => {
    const src = real("scaf-picked");
    const series = lines("scaf-picked", "series.jsonl")!.filter(Boolean).map((l) => JSON.parse(l));
    const flagged = series.filter((r) => r.afterCycle === true).map((r) => r.step);
    expect(flagged).toEqual([1100, 2100, 3100, 4100, 5100]);
    for (const r of series) expect(birthAcrossCycle(r.step, "scaf", 1000, src.manifest.spec.censusEvery, 0, null)).toBe(flagged.includes(r.step));
    // births.tsv: no tracker birth at a census right after a boundary in this transforming run; cont keeps 21 there.
    const at = (dir: string, steps: (s: number) => boolean) => lines(dir, "births.tsv")!.slice(1).filter(Boolean).filter((l) => steps(Number(l.split("\t")[0]))).length;
    expect(at("scaf-picked", (s) => flagged.includes(s))).toBe(0);
    expect(at("cont", (s) => s > 1000 && s % 1000 === 100)).toBe(21);
  });

  it("scaf-picked: the pond tool opens the subject's packet genotype, and its dossier routes exactly", async () => {
    const src = real("scaf-picked");
    const h = runnerPondHistory(parsePondRows(lines("scaf-picked", "ponds.tsv")!), src.manifest, { hasMutations: true, picks: readPickLog(lines("scaf-picked", "picks.jsonl")!) });
    expect(h.picks).toMatchObject({ picker: "random", present: true, lines: 6, by: { random: 6 }, checked: 6 });
    const d = pondDossier(h, { kind: "top" });
    expect(d.notes.join("\n")).toMatch(/a picked run \(picker random\): .* \(6 by random\), and its ordered donors agree with ponds.tsv at 6 boundary\(ies\)/);
    const t = packetGenotype(d, h);
    expect(t.step).toBe((d.subject.cycle - 1) * 1000);
    const g = await buildDossier(src, { kind: "key", key: t.lineage }, { step: t.step, pondAnchor: t.anchor });
    expect(g.subject.cellsAtStep).toBeGreaterThan(0);
    expect(g.pond).toMatchObject({ notRecorded: 0, anchor: { ponds: [t.anchor.pond], cycle: t.anchor.cycle, source: "given" } });
    expect(g.pond!.exact).toBe(g.pond!.edges.length);
    expect(g.verification.genomesChecked).toBe(g.chain.length);
    // The whole genotype dossier of the top lineage: tracker births right after a boundary are left out.
    const top = await buildDossier(src, { kind: "top" });
    expect(top.pond!.exact).toBe(top.pond!.edges.length);
    expect(top.trackerBirths!.excludedAcrossCycle).toBe(0); // no birth row sits at a post-boundary census here (above)
  }, 300_000);

  it("cont: no route crosses, nothing is excluded, and no packet genotype exists", async () => {
    const src = real("cont");
    const index = pondIndex(parsePondRows(lines("cont", "ponds.tsv")!), src.manifest.cfg);
    const log = await readMutationLog(rows(lines("cont", "mutations.tsv")!));
    const tiles = initialTiles(src.manifest);
    const recorded = lines("cont", "genomes.tsv")!.slice(1).filter(Boolean).map((l) => l.split("\t")[0]);
    let edges = 0, exact = 0;
    for (const k of recorded) {
      const r = pondRoute(ancestry(k, log.parent), src.manifest.cfg, index, { initialTiles: tiles });
      edges += r.edges.length;
      exact += r.exact;
      expect(r.edges.every((e) => e.crossings.length === 0)).toBe(true);
    }
    expect({ lineages: recorded.length, edges, exact }).toEqual(REAL.cont);
    const top = await buildDossier(src, { kind: "top" });
    expect(top.pond).toMatchObject({ arm: "cont", notRecorded: 0, crossings: { named: 0, notExcluded: 0, notRecorded: 0 } });
    expect(top.pond!.exact).toBe(top.pond!.edges.length);
    expect(top.trackerBirths!.excludedAcrossCycle).toBe(0);
    const h = runnerPondHistory(parsePondRows(lines("cont", "ponds.tsv")!), src.manifest, { hasMutations: true, picks: null });
    expect(h.picks).toBeNull();
    expect(() => packetGenotype(pondDossier(h, { kind: "top" }), h)).toThrow(/no founding packet in this bundle \(arm cont moves nothing\)/);
  }, 300_000);
});

// Counts from the retained bundles (run once in this test; docs/lineage-inspector.md section 8 quotes them).
const REAL = {
  scafPicked: { lineages: 42, edges: 85, exact: 85, crossingEdges: 37, named: 80, notExcluded: 0 },
  cont: { lineages: 197, edges: 294, exact: 294 },
};

describe("pond tool glue (tools/lib/pond-bundle.ts)", () => {
  // Boundary 1 (seed 1 ranks ponds 0, 3, 2, 1; ordered pick [1, 3]): recipients take donors 1, 3, 1, 3. Boundary 2: every pond from pond 2.
  const A = key(150, 2);
  const cycles: HandCycle[] = [
    { donors: [1, 3, 1, 3], packets: [{ lineages: 2, dom: founder(1) }, { lineages: 1, dom: founder(3) }, { lineages: 1, dom: founder(1) }, { lineages: 1, dom: founder(3) }] },
    { donors: [2, 2, 2, 2], packets: [{ lineages: 2, dom: A }, { lineages: 1, dom: A }, { lineages: 1, dom: A }, { lineages: 1, dom: A }] },
  ];
  const bundle = (over: Partial<HandSpec> = {}) =>
    handPondBundle({ mutations: [[A, founder(1)]], ponds: pondsLines(cycles), census: { 100: [[founder(1), 9]], 200: [[A, 5]], 250: [[A, 7]] }, steps: 250, ...over });
  const pick = (cycle: number, donors: number[]) => JSON.stringify({ step: cycle * 100, kind: "pick", cycle, donors, by: "random", suggested: donors });
  const history = (b: ReturnType<typeof bundle>, picks: string[] | null = null) =>
    runnerPondHistory(parsePondRows(b.files["ponds.tsv"]), b.manifest, { hasMutations: "mutations.tsv" in b.files, picks: picks ? readPickLog(picks) : null });

  it("runnerPondHistory: arm, period, picks checked by order, a missing log in a picked run, nat/shuf refused", () => {
    const b = bundle({ picked: true });
    const h = history(b, [pick(1, [1, 3]), pick(2, [2])]);
    expect(h).toMatchObject({ arm: "scaf", period: 100, source: "runner", hasMutations: true, firstStep: 0, picks: { picker: "random", present: true, checked: 2, by: { random: 2 } } });
    expect(() => history(b, [pick(1, [3, 1]), pick(2, [2])])).toThrow(/the records disagree/);
    expect(history(b).picks).toMatchObject({ present: false, lines: 0 });
    expect(history(bundle()).picks).toBeNull();
    const nat = handPondBundle({ arm: "nat", mutations: [], ponds: pondsLines([{ donors: [-2, -2, -2, -2] }], { died: true }), census: {}, steps: 100 });
    expect(() => history(nat)).toThrow(/do not support arms nat\/shuf yet .* open their lineages as genotype dossiers instead/);
    expect(() => runnerPondHistory(parsePondRows(b.files["ponds.tsv"]), { ...b.manifest, cfg: { ...b.manifest.cfg, pondPeriod: undefined } }, { hasMutations: true, picks: null })).toThrow(/no pond cycle/);
  });

  it("runnerPondHistory: a picker named like an Object property counts like any other (`constructor`, `__proto__`)", () => {
    const b = bundle({ picked: true });
    const named = (cycle: number, donors: number[], by: string) => JSON.stringify({ ...JSON.parse(pick(cycle, donors)), by });
    const h = history(b, [named(1, [1, 3], "constructor"), named(2, [2], "__proto__")]);
    const by = h.picks!.by;
    // Entries, not a literal: `{ __proto__: 1 }` in a literal sets the prototype and has no own key.
    expect(Object.entries(by).sort()).toEqual([["__proto__", 1], ["constructor", 1]]);
    expect(Object.hasOwn(by, "__proto__")).toBe(true);
    // The text dossier's note names both pickers with their counts.
    const note = pondDossier(h, { kind: "explicit", pond: 0, cycle: 2 }).notes.find((n) => n.startsWith("a picked run"));
    expect(note).toContain("(1 by constructor, 1 by __proto__)");
  });

  it("runnerPondHistory: a first boundary short of the run's ponds is refused, not read as a smaller run (Codex pass 2)", () => {
    // Four ponds, one boundary: rows 0-2 whole, row 3 torn mid-line.
    const one = pondsLines([cycles[0]]);
    const cut = [...one.slice(0, -1), one[one.length - 1].slice(0, 20)];
    expect(parsePondRows(cut)).toMatchObject({ torn: 5 });
    expect(() => history(bundle({ ponds: cut }))).toThrow(/ponds.tsv cycle 1 holds 3 of the run's 4 ponds \(missing 3\), and it is the table's only cycle \(a torn append\): no complete cycle establishes the pond set/);
    // A first cycle lacking a row while later cycles are whole is refused the same way, without the torn-append clause.
    const gap = pondsLines(cycles).filter((_, i) => i !== 2);
    expect(() => history(bundle({ ponds: gap }))).toThrow(/cycle 1 holds 3 of the run's 4 ponds \(missing 1\): no complete cycle/);
  });

  it("packetGenotype: default and explicit cycles, and every refusal by name", async () => {
    const b = bundle();
    const h = history(b);
    const d = pondDossier(h, { kind: "explicit", pond: 0, cycle: 2 });
    // Pond 0 at cycle 2 was founded by boundary 1's packet from pond 1 (dominant 0:2), measured at step 100.
    expect(packetGenotype(d, h)).toEqual({ lineage: founder(1), step: 100, anchor: { pond: 1, cycle: 1 } });
    const g = await buildDossier(b, { kind: "key", key: founder(1) }, { step: 100, pondAnchor: { pond: 1, cycle: 1 } });
    expect(g.pond).toMatchObject({ exact: 1, notRecorded: 0, anchor: { ponds: [1], cycle: 1, source: "given" } });
    expect(packetGenotype(d, h, 2)).toEqual(packetGenotype(d, h));
    expect(() => packetGenotype(d, h, 1)).toThrow(/pond 1 at cycle 1 has no founding packet in this bundle \(cycle 1 is the bundle's first\)/);
    expect(() => packetGenotype(d, h, 7)).toThrow(/--genotype-cycle 7: the subject's chain has no node at that cycle \(it spans cycles 1..2\)/);
    const noMut = { ...h, hasMutations: false };
    expect(() => packetGenotype(d, noMut)).toThrow(/needs mutations.tsv/);
    const scaffold = buildPondHistory(parsePondRows(b.files["ponds.tsv"]), { arm: "scaf" });
    expect(() => packetGenotype(pondDossier(scaffold, { kind: "top" }), scaffold)).toThrow(/a scaffold history has no mutations.tsv/);
    const empty: HandCycle[] = [{ ...cycles[0], packets: [{ lineages: 0, dom: null }] }, cycles[1]];
    const he = history(bundle({ ponds: pondsLines(empty) }));
    expect(() => packetGenotype(pondDossier(he, { kind: "explicit", pond: 0, cycle: 2 }), he)).toThrow(/pond 0 at cycle 2 \(from pond 1\) holds 0 lineages, so it carried nothing alive/);
    // Codex pass 2: the route's packet rule applies to the opened packet too (the anchor walk starts at the donor and never passes it).
    const named0: HandCycle[] = [{ ...cycles[0], packets: [{ lineages: 0, dom: founder(1) }, ...cycles[0].packets!.slice(1)] }, cycles[1]];
    const hn = history(bundle({ ponds: pondsLines(named0) }));
    expect(() => packetGenotype(pondDossier(hn, { kind: "explicit", pond: 0, cycle: 2 }), hn)).toThrow(/holds 0 lineages \(yet names dominant 0:2\), so it carried nothing alive: the records contradict/);
    const noDom: HandCycle[] = [{ ...cycles[0], packets: [{ lineages: 2, dom: null }, ...cycles[0].packets!.slice(1)] }, cycles[1]];
    const hd = history(bundle({ ponds: pondsLines(noDom) }));
    expect(() => packetGenotype(pondDossier(hd, { kind: "explicit", pond: 0, cycle: 2 }), hd)).toThrow(/holds 2 lineage\(s\) but names no dominant: the row is malformed/);
  }, 120_000);

  it("sameStart: initial worlds rebuilt at each initHash hold the same state, and the configs differ only in the arm", () => {
    const a = bundle().manifest, r = handPondBundle({ arm: "rand", mutations: [], ponds: null, census: {}, steps: 100 }).manifest;
    expect(a.initHash).not.toBe(r.initHash); // the hash covers the config, arm included
    expect(sameStart(a, r)).toBe(true);
    expect(sameStart(a, { ...r, initHash: "other" })).toBe(false);
    expect(sameStart(a, { ...a, cfg: { ...a.cfg, mutRate: 1 } })).toBe(false);
    expect(sameStart(a, { ...a, startStep: 100 })).toBe(false);
    expect(sameStart(real("scaf-picked").manifest, real("cont").manifest)).toBe(true);
    // Codex pass 2: what the runner applies after the initHash world and before the first boundary must match too.
    const m = real("scaf-picked").manifest, c = real("cont").manifest;
    const lesion = (step: number) => ({ step, kind: "lesion", x: 10, y: 10, r: 4 });
    const withI = (man: any, list: unknown[]) => ({ ...man, spec: { ...man.spec, interventions: list } });
    expect(sameStart(withI(m, [lesion(0)]), c)).toBe(false);
    expect(sameStart(withI(m, [lesion(500)]), c)).toBe(false);
    expect(sameStart(withI(m, [lesion(0)]), withI(c, [lesion(0)]))).toBe(true);
    expect(sameStart(withI(m, [lesion(0), lesion(500)]), withI(c, [lesion(500), lesion(0)]))).toBe(false);
    expect(sameStart(withI(m, [lesion(m.cfg.pondPeriod)]), c)).toBe(true); // applied after the boundary's census and cycle
    expect(sameStart({ ...m, importedStartHash: "abc" }, c)).toBe(false);
    expect(sameStart({ ...m, spec: { ...m.spec, branch: { boundary: 1 } } }, c)).toBe(false);
  }, 120_000);
});
