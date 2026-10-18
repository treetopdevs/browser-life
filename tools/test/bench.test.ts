// The proposer bench (tools/lib/bench.ts, tools/lib/bench-fs.ts) against the rules fixed in docs/naturalist-bench-v0-2026-10-18.md:
// the plan's determinism, the dose-matched and count-matched forks, the yes gate's refusals, the run's resume and time cap with a fake
// executor, and the readout. Synthetic bundles under a temp dir; no GPU, no spawned process. The approvals here are test approvals of
// synthetic manifests in a temp dir.
import { appendFileSync, chmodSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cellCount, maxLesionRadius, worldW } from "@bl/schema";
import { mulberry32 } from "@bl/metrics";
import { formatInterventionLine, runId, specConfig, type ScheduledIntervention } from "@bl/runner";
import {
  BENCH_V0,
  BenchPlanError,
  CAVEATS_V0,
  READINGS,
  approveManifest,
  benchVoidReasons,
  bodyProblems,
  chipOf,
  comparePairs,
  doseSeed,
  drawDose,
  dryRunLines,
  manifestSha256,
  medianOf3,
  parseManifest,
  pickProposal,
  planBench,
  plannedManifest,
  reading,
  runRefusal,
  scoredFieldProblem,
  serializeManifest,
  shellQuote,
  signTestTail,
  summarizeBench,
  type BenchBody,
  type BenchConstants,
  type BenchInput,
  type BenchManifest,
  type ForkScore,
} from "../lib/bench.ts";
import { BenchRefusal, MANIFEST_COPY, RUN_LOG, hashedText, interventionLogProblem, loadBenchInputs, openRunLog, planFromDisk, publishOnce, rederiveBench, replaceIfUnchanged, runBench, scoreBench, streamSha256, type Exec } from "../lib/bench-fs.ts";
import { baselineSeed, canonical, parseNotes, proposeFromNotes, randomBaseline, specHash } from "../lib/propose.ts";
import { checkpointArtifact, lineagesText, notesJson, seriesText, sourceManifest, type RingOpts } from "./propose-fixture.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const T = 300_000;

// ---------------------------------------------------------------------------------------------
// Pure inputs: archipelago (four tiles, so a proposal has four entries), no files.

const ARCH: BenchConstants = { ...BENCH_V0, pairs: 3, selection: { experiment: "replay-m4", presetId: "archipelago", condition: "neutral" } };
const RINGS: Record<number, RingOpts[]> = {
  1: [{ signal: "patternEntropy", side: "high", startStep: 12_000 }, { signal: "livingCells", side: "high", startStep: 15_000 }], // control first, then a drain
  2: [{ signal: "maxGeneration", side: "high", startStep: 14_000 }], // lesion
  3: [{ signal: "livingCells", side: "low", startStep: 20_000 }, { signal: "fissions", side: "low", startStep: 20_000 }], // feed, and a duplicate
  4: [{ signal: "mutations", side: "high", startStep: 11_000 }],
};
function pureInput(seed: number, k: BenchConstants = ARCH, rings: RingOpts[] = RINGS[seed]): BenchInput {
  const sel = k.selection;
  const m = sourceManifest({ experiment: sel.experiment, presetId: sel.presetId, condition: sel.condition, seed, steps: 50_000 });
  const notes = parseNotes(notesJson(m, rings));
  const dir = `/base/${sel.experiment}/${sel.presetId}/${sel.condition}/seed-${seed}`;
  const notesPath = `/notes/${sel.experiment}-${sel.presetId}-${sel.condition}-seed-${seed}.notes.json`;
  const result = proposeFromNotes({ notes, notesRef: { path: notesPath, sha256: "a".repeat(64) }, manifest: m, source: { dir, manifestSha256: "b".repeat(64) }, forkFor: () => ({ step: 0, check: "initHash", hash: m.initHash! }) });
  return { seed, src: { dir, manifest: m, manifestSha256: "b".repeat(64), seriesSha256: "c".repeat(64), lineagesSha256: "d".repeat(64) }, notesPath, notesSha256: "a".repeat(64), result };
}
const WHERE = { base: "/base", notesDir: "/notes" };
const pureBody = (pairs = 3) => planBench(WHERE, Array.from({ length: pairs }, (_, i) => pureInput(i + 1)), { ...ARCH, pairs });

describe("the plan", () => {
  it("is byte-deterministic, and adding a source leaves the other entries' ids and draws unchanged", () => {
    const a = serializeManifest(plannedManifest(pureBody())), b = serializeManifest(plannedManifest(pureBody()));
    expect(a).toBe(b);
    const three = pureBody(3), four = pureBody(4);
    expect(four.entries.length).toBe(28);
    expect(four.entries.slice(0, 21).map((e) => canonical(e))).toEqual(three.entries.map((e) => canonical(e)));
    expect(four.entries.slice(21).every((e) => e.id.startsWith("seed-4-"))).toBe(true);
  });
  it("picks the first proposal that is not a replay control, with its duplicate rings", () => {
    const b = pureBody();
    expect(b.sources.map((s) => s.action)).toEqual(["drain", "lesion", "feed"]);
    expect(b.sources[0].ring.signal).toBe("livingCells");
    const r3 = b.entries.find((e) => e.id === "seed-3-rules")!;
    expect(r3.proposal!.alsoAnswers?.map((x) => x.signal)).toEqual(["fissions"]);
    expect(pickProposal({ proposals: [], skipped: [], duplicates: [] })).toBeNull();
    expect(b.entries.map((e) => e.id).slice(0, 7)).toEqual(["seed-1-rules", "seed-1-count-1", "seed-1-count-2", "seed-1-count-3", "seed-1-dose-1", "seed-1-dose-2", "seed-1-dose-3"]);
    expect(b.totals).toMatchObject({ forks: 21, steps: b.entries.reduce((n, e) => n + e.steps, 0) });
    expect(bodyProblems(b)).toEqual([]);
  });
  it("refuses a source whose notes give no feed, drain or lesion proposal, naming it", () => {
    const inputs = [pureInput(1), pureInput(2, ARCH, [{ signal: "patternEntropy", side: "low", startStep: 12_000 }]), pureInput(3)];
    expect(() => planBench(WHERE, inputs, ARCH)).toThrow(BenchPlanError);
    expect(() => planBench(WHERE, inputs, ARCH)).toThrow(/replay-m4\/archipelago\/neutral\/seed-2: its notes give no feed, drain or lesion proposal/);
  });
  it("refuses inputs that are not exactly the selection's seeds, or a bundle at another path", () => {
    expect(() => planBench(WHERE, [pureInput(1), pureInput(3), pureInput(2)], ARCH)).toThrow(/exactly the sources seed-1 to seed-3/);
    expect(() => planBench({ ...WHERE, base: "/elsewhere" }, [pureInput(1), pureInput(2), pureInput(3)], ARCH)).toThrow(/not \/elsewhere/);
  });
});

describe("the baselines", () => {
  const b = pureBody();
  const rules = (i: number) => b.entries.find((e) => e.role === "rules" && e.source === i)!;
  it("count entries are the proposer's random forks, unchanged", () => {
    for (const e of b.entries.filter((x) => x.role === "count")) {
      const r = rules(e.source);
      const again = randomBaseline({ id: r.proposalId!, status: "proposed", body: r.proposal! }, e.draw!)!;
      expect(canonical(e.proposal)).toBe(canonical(again.body));
      expect(e.proposalId).toBe(again.id);
      expect(e.anchor).toBe(again.body.replayThrough);
      expect(e.matches).toBe(r.proposalId);
    }
  });
  it("dose entries match their proposal's entry count, radius, |amount| and step; kind and centre are drawn", () => {
    for (const e of b.entries.filter((x) => x.role === "dose")) {
      const r = rules(e.source), cfg = specConfig(e.spec);
      const want = r.spec.interventions!, got = e.spec.interventions!;
      expect(got.length).toBe(want.length);
      expect(got.length).toBe(4); // archipelago's four tiles
      for (const x of got) {
        expect(x.step).toBe(r.S);
        expect(x.r).toBe(maxLesionRadius(cfg));
        if (x.kind === "feed") expect(Math.abs(x.amount)).toBe(32);
        expect(x.y * worldW(cfg) + x.x).toBeLessThan(cellCount(cfg));
        expect(x.x).toBeGreaterThanOrEqual(0);
      }
      expect(e.anchor).toBe(r.S);
      expect(e.spec.steps).toBe(r.spec.steps);
      expect(e.C).toBe(r.C);
    }
    const kinds = new Set(b.entries.filter((x) => x.role === "dose").flatMap((e) => e.spec.interventions!.map((x) => (x.kind === "lesion" ? "lesion" : x.amount > 0 ? "feed" : "drain"))));
    expect([...kinds].sort()).toEqual(["drain", "feed", "lesion"]);
  });
  it("the draw is pinned: seed = first 32 bits of SHA-256(\"dose-v0:<seed>:<spec sha>\"), then per entry kind, then cell", () => {
    const r = rules(1), cfg = specConfig(r.spec), sha = specHash(r.spec), list = r.spec.interventions!;
    const want = parseInt(createHash("sha256").update(`dose-v0:2:${sha}`).digest("hex").slice(0, 8), 16);
    expect(doseSeed(2, sha)).toBe(want);
    const rnd = mulberry32(want);
    const int = (m: number) => Math.min(m - 1, Math.floor(rnd() * m));
    const manual = list.map((e) => {
      const kind = ["lesion", "feed", "drain"][int(3)], cell = int(cellCount(cfg)), x = cell % worldW(cfg), y = Math.floor(cell / worldW(cfg));
      return kind === "lesion" ? { step: e.step, kind, x, y, r: e.r } : { step: e.step, kind: "feed", x, y, r: e.r, amount: kind === "feed" ? 32 : -32 };
    });
    const lesions = manual.filter((x) => x.kind === "lesion"), feeds = manual.filter((x) => x.kind === "feed");
    expect(drawDose(2, sha, list, cfg, 32)).toEqual([...lesions, ...feeds]);
  });
  it("the draw is pinned to literal values (a change to the hash, the PRNG or the draw order moves them)", () => {
    const sha = "0".repeat(64);
    const cfg = specConfig({ experiment: "x", presetId: "gradient-m3", condition: "treatment", seed: 1, steps: 100, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 });
    expect([doseSeed(1, sha), doseSeed(2, sha)]).toEqual([1469054614, 3643081764]);
    const entries: ScheduledIntervention[] = [{ step: 19_400, kind: "feed", x: 128, y: 128, r: 127, amount: 32 }, { step: 19_400, kind: "lesion", x: 1, y: 1, r: 9 }];
    expect(drawDose(1, sha, entries, cfg, 32)).toEqual([{ step: 19_400, kind: "lesion", x: 108, y: 146, r: 9 }, { step: 19_400, kind: "feed", x: 137, y: 188, r: 127, amount: 32 }]);
  });
  it("same seed, same draw; the stream is not random-v0's; no A gives lesions only", () => {
    const r = rules(0), cfg = specConfig(r.spec), sha = specHash(r.spec);
    const list = r.spec.interventions!;
    expect(drawDose(2, sha, list, cfg, 32)).toEqual(drawDose(2, sha, list, cfg, 32));
    expect(drawDose(2, sha, list, cfg, 32)).not.toEqual(drawDose(3, sha, list, cfg, 32));
    expect(doseSeed(1, sha)).not.toBe(baselineSeed(1, sha));
    const lesions = drawDose(1, sha, list, cfg, null);
    expect(lesions.every((x: ScheduledIntervention) => x.kind === "lesion")).toBe(true);
    expect(lesions.map((x) => x.r)).toEqual(list.map((x) => x.r));
  });
});

describe("the manifest and the yes gate (pure)", () => {
  const m = plannedManifest(pureBody());
  it("round-trips, and an edited body is refused by its hash", () => {
    expect(parseManifest(serializeManifest(m))).toEqual(m);
    const edited = JSON.parse(serializeManifest(m));
    edited.body.entries[0].spec.interventions[0].r = 5;
    expect(() => parseManifest(JSON.stringify(edited))).toThrow(/the body was edited/);
  });
  it("approve refuses names that are not a person's, a manifest that is not planned, and a bench of fewer pairs unless named", () => {
    for (const bad of ["Claude", "gpt4o bot", "A.I.", "x"]) expect(() => approveManifest(m, bad, "2026-10-18T00:00:00Z", 3)).toThrow(/not a person's name/);
    expect(() => approveManifest(m, "Test Person", "2026-10-18T00:00:00Z")).toThrow(/the manifest has 3 pairs, not 10/);
    const ok = approveManifest(m, "Test Person", "2026-10-18T00:00:00Z", 3);
    expect(ok.approval).toEqual({ by: "Test Person", at: "2026-10-18T00:00:00Z", manifestSha256: m.manifestSha256 });
    expect(() => approveManifest(ok, "Test Person", "x", 3)).toThrow(/not planned/);
  });
  it("run's gate: unapproved, a body changed after approval, a recorded version that is not this checkout's", () => {
    expect(runRefusal(m)).toMatch(/^not approved/);
    const ok = approveManifest(m, "Test Person", "2026-10-18T00:00:00Z", 3);
    expect(runRefusal(ok, 3)).toBeNull();
    expect(runRefusal(ok)).toMatch(/3 pairs, not 10/);
    const changed: BenchManifest = JSON.parse(serializeManifest(ok));
    changed.body.constants.zStarPair = 1;
    expect(runRefusal(changed)).toMatch(/changed after it was approved/);
    const v: BenchManifest = JSON.parse(serializeManifest(ok));
    v.body.versions.rule = 99;
    v.approval!.manifestSha256 = v.manifestSha256 = manifestSha256(v.body);
    expect(runRefusal(v, 3)).toMatch(/other versions than this checkout's \(rule 99 → 1\)/);
  });
  it("a body cut to fewer sources, or to none, is refused even with its hash and approval recomputed", () => {
    const cut: BenchBody = JSON.parse(JSON.stringify(m.body));
    cut.sources = cut.sources.slice(0, 1);
    cut.entries = cut.entries.filter((e) => e.source === 0);
    cut.totals.forks = cut.entries.length;
    cut.totals.steps = cut.entries.reduce((n, e) => n + e.steps, 0);
    expect(bodyProblems(cut)).toContain("the sources are not seed-1 to seed-3, one each, in order");
    cut.constants.pairs = 1;
    expect(bodyProblems(cut)).toEqual([]);
    const sha = manifestSha256(cut);
    const forged: BenchManifest = { manifestSha256: sha, status: "approved", approval: { by: "Test Person", at: "2026-10-18T00:00:00Z", manifestSha256: sha }, body: cut };
    expect(runRefusal(forged)).toMatch(/1 pairs, not 10/);
    const none: BenchBody = { ...JSON.parse(JSON.stringify(m.body)), sources: [], entries: [], totals: { forks: 0, steps: 0, byRole: m.body.totals.byRole } };
    none.constants.pairs = 0;
    expect(bodyProblems(none)[0]).toMatch(/constants.pairs 0 is not a positive integer/);
  });
  it("bodyProblems names an entry with an invalid spec, a wrong draw or a wrong argv", () => {
    const b: BenchBody = JSON.parse(JSON.stringify(m.body));
    b.entries[1].spec.steps = 7;
    b.entries[5].spec.interventions![0].x = (b.entries[5].spec.interventions![0].x + 1) % 64;
    b.entries[6].argv[3] = "tools/other.ts";
    const p = bodyProblems(b);
    expect(p.some((x) => x.startsWith('entry "seed-1-count-1"'))).toBe(true);
    expect(p.some((x) => x.startsWith('entry "seed-1-dose-2"') && /dose draw/.test(x))).toBe(true);
    expect(p.some((x) => x.startsWith('entry "seed-1-dose-3"') && /argv/.test(x))).toBe(true);
  });
  it("run's gate refuses a hand-forged approval by a model's name, a bad time, a recorded hash that is not the body's", () => {
    const ok = approveManifest(m, "Test Person", "2026-10-18T00:00:00Z", 3);
    const claude: BenchManifest = { ...ok, approval: { ...ok.approval!, by: "Claude" } };
    expect(runRefusal(claude, 3)).toBe("the approval names no person");
    expect(runRefusal({ ...ok, approval: { ...ok.approval!, at: "yesterday" } }, 3)).toMatch(/is not an ISO 8601 UTC timestamp/);
    expect(runRefusal({ ...ok, manifestSha256: "f".repeat(64) }, 3)).toMatch(/recorded manifestSha256 .* is not its body's/);
    expect(() => approveManifest(m, "Test Person", "now", 3)).toThrow(/not an ISO 8601 UTC timestamp/);
  });
  it("parseManifest refuses null, an array, an unknown key, a malformed approval, a planned manifest carrying an approval", () => {
    const good = JSON.parse(serializeManifest(m));
    expect(() => parseManifest("null")).toThrow(/not a JSON object/);
    expect(() => parseManifest("[]")).toThrow(/not a JSON object/);
    expect(() => parseManifest(JSON.stringify({ ...good, extra: 1 }))).toThrow(/unknown key "extra"/);
    expect(() => parseManifest(JSON.stringify({ ...good, body: null }))).toThrow(/no body/);
    expect(() => parseManifest(JSON.stringify({ ...good, status: "approved", approval: { by: "Test Person" } }))).toThrow(/approval is not \{by, at, manifestSha256\}/);
    expect(() => parseManifest(JSON.stringify({ ...good, approval: { by: "Test Person", at: "2026-10-18T00:00:00Z", manifestSha256: m.manifestSha256 } }))).toThrow(/a planned manifest carries an approval/);
  });
  it("shellQuote quotes what a shell would split or expand, so a printed command can be pasted", () => {
    expect(shellQuote("/x/out")).toBe("/x/out");
    expect(shellQuote("/x/my out")).toBe("'/x/my out'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(dryRunLines(m.body, "/x/my out")[0]).toMatch(/--out '\/x\/my out\/seed-1-rules'$/);
  });
  it("dry-run lines: one per entry with --out <out>/<id>, then the total", () => {
    const lines = dryRunLines(m.body, "/x/out");
    expect(lines).toHaveLength(m.body.entries.length + 1);
    m.body.entries.forEach((e, i) => expect(lines[i]).toBe(`${e.id}: ${[...e.argv, "--out", `/x/out/${e.id}`].join(" ")}`));
    expect(lines.at(-1)).toMatch(new RegExp(`^total: 21 forks, ${m.body.totals.steps} steps`));
  });
});

describe("the readout", () => {
  const k = { pairs: 10, winsToBeat: 9, K: 3 };
  it("signTestTail and medianOf3", () => {
    expect(signTestTail(9, 10)).toBeCloseTo(11 / 1024, 15);
    expect(signTestTail(0, 10)).toBe(1);
    expect(signTestTail(11, 10)).toBe(0);
    expect(medianOf3([3, 1, 2])).toBe(2);
  });
  it("a tie is not a win; 9 of 10 wins beat the baseline, 8 do not; 9 losses mean the baseline beats the rules", () => {
    const base = Array.from({ length: 10 }, () => [1, 2, 3]);
    const nine = comparePairs("count", [5, 5, 5, 5, 5, 5, 5, 5, 5, 2], base, k, 10);
    expect(nine).toMatchObject({ wins: 9, ties: 1, losses: 0, called: true, rulesBeat: true, baselineBeats: false });
    const eight = comparePairs("count", [5, 5, 5, 5, 5, 5, 5, 5, 2, 2], base, k, 10);
    expect(eight).toMatchObject({ wins: 8, ties: 2, rulesBeat: false });
    const lose = comparePairs("dose", [0, 0, 0, 0, 0, 0, 0, 0, 0, 9], base, k, 10);
    expect(lose).toMatchObject({ losses: 9, rulesBeat: false, baselineBeats: true });
  });
  it("a void fork voids its pair and the comparison is not called; a bench of fewer pairs is not called", () => {
    const base = Array.from({ length: 10 }, () => [1, 2, 3] as (number | null)[]);
    base[4] = [1, null, 3];
    const c = comparePairs("dose", Array(10).fill(5), base, k, 10);
    expect(c).toMatchObject({ voids: 1, wins: 9, called: false, rulesBeat: null, notCalledReason: "1 of 10 pairs are void" });
    expect(comparePairs("dose", [5, 5], [[1, 2, 3], [1, 2, 3]], k, 2)).toMatchObject({ called: false, notCalledReason: "the bench has 2 pairs; the bars were set for 10" });
  });
  it("the reading table (amendment 1) and its chips", () => {
    const y = { called: true, rulesBeat: true, baselineBeats: false }, n = { called: true, rulesBeat: false, baselineBeats: false };
    const b = { called: true, rulesBeat: false, baselineBeats: true }, x = { called: false, rulesBeat: null, baselineBeats: null };
    const cases: [typeof y, typeof y, string, string][] = [
      [y, y, "rules beat both random baselines (exploratory)", "Measured"],
      [y, n, "rules beat v0's random forks; the footprint-matched comparison is inconclusive", "Measured"],
      [y, b, "rules beat v0's random forks; a random action of the same footprint and timing beats the rules", "Measured"],
      [n, y, "mixed: rules beat a random action of the same footprint and timing, but not v0's random forks", "Unclear"],
      [b, y, "mixed: rules beat a random action of the same footprint and timing, but not v0's random forks", "Unclear"],
      [b, n, "a random baseline beats the rules", "Negative"],
      [n, b, "a random baseline beats the rules", "Negative"],
      [n, n, "no clear advantage seen (the bench sees only a strong one)", "Unclear"],
      [y, x as unknown as typeof y, "not called", "Unclear"],
    ];
    for (const [c, d, r, chip] of cases) {
      expect(reading(c, d)).toBe(r);
      expect(chipOf(reading(c, d))).toBe(chip);
    }
    expect(Object.values(READINGS)).toHaveLength(7);
    // 9 wins and 8 wins on the footprint-matched role: an inconclusive comparison is not read as an explanation.
    const base = Array.from({ length: 10 }, () => [1, 2, 3]);
    const nine = comparePairs("count", [5, 5, 5, 5, 5, 5, 5, 5, 5, 0], base, k, 10), eight = comparePairs("dose", [5, 5, 5, 5, 5, 5, 5, 5, 0, 0], base, k, 10);
    expect(reading(nine, eight)).toBe(READINGS.countOnly);
  });
  it("scoredFieldProblem needs every scored series field finite; benchVoidReasons keeps D = 0 for a clean fork with no difference", () => {
    const rec = { step: 100, livingCells: 1, individuals: 1, meanMass: 1, lineages: 1, lineageShannon: 0, patternEntropy: 0, bioticRecycling: 0, maxGeneration: 0, fissions: 0, fusions: 0, buddings: 0, mutations: 0 };
    expect(scoredFieldProblem(rec)).toBeNull();
    expect(scoredFieldProblem({ ...rec, meanMass: null })).toBe("step 100: meanMass is null, not a finite number");
    const { mutations: _drop, ...noMut } = rec;
    expect(scoredFieldProblem(noMut)).toMatch(/mutations is missing/);
    const r = { failed: null, diffAtOrBeforeS: null, firstDiffStep: null } as unknown as Parameters<typeof benchVoidReasons>[0];
    expect(benchVoidReasons(r, 500, null)).toEqual([]);
    expect(benchVoidReasons(r, 500, "the fork bundle has no manifest.json")).toEqual(["the fork bundle has no manifest.json", "no difference from its base after S = 500"]);
    expect(benchVoidReasons({ ...r, failed: "ended" }, 500, null)).toEqual(["stream: ended"]);
    expect(benchVoidReasons({ ...r, diffAtOrBeforeS: 400 }, 500, null)).toEqual(["differs from its base at step 400, at or before S = 500", "no difference from its base after S = 500"]);
  });
  it("summarizeBench: an invalid fork voids its pair, kinds are counted, Z*_pair is descriptive", () => {
    const sources = Array.from({ length: 10 }, (_, i) => ({ action: i < 8 ? "feed" : "drain" })) as unknown as BenchBody["sources"];
    const forks: ForkScore[] = [];
    for (let i = 0; i < 10; i++) {
      const f = (role: ForkScore["role"], D: number, valid = true): ForkScore => ({ id: `${role}-${i}-${D}`, role, source: i, anchor: 100, valid, voidReasons: valid ? [] : ["x"], D: valid ? D : null, D11: valid ? D : null, signal: null, side: null, firstDiffStep: 200, kinds: [role === "dose" && D === 3 ? "lesion" : "feed"], delivered: { feedMatter: D === 3 ? null : 100 * D, step: 200, livingCellsDelta: -D, matterDelta: D } });
      forks.push(f("rules", 10), f("count", 1), f("count", 2), f("count", 3), f("dose", 1), f("dose", 2, i !== 3), f("dose", 3));
    }
    const s = summarizeBench({ sources, constants: BENCH_V0 }, forks, [], BENCH_V0, new Map([["dose-3-2", 2], ["rules-0-10", 1]]));
    expect(s.count).toMatchObject({ wins: 10, called: true, rulesBeat: true });
    expect(s.dose).toMatchObject({ voids: 1, called: false });
    expect(s.reading).toBe("not called");
    expect(s.kinds).toEqual({ feed: 8, drain: 2 });
    expect(s.aboveZStarPair.rules).toEqual({ n: 10, of: 10 });
    expect(s.forks.void).toEqual([{ id: "dose-3-2", reasons: ["x"] }]);
    expect(s.readingNote).toBe("the rules chose feed for 8 of 10 sources, so the footprint-matched (dose) comparison is in effect a jar-disc feed at the rules' centre against a random kind at a random centre with the same radius and timing (kind and placement both differ)");
    expect(s.chip).toBe("Unclear");
    expect(s.caveats).toEqual([...CAVEATS_V0]);
    expect(s.dByKind.dose).toEqual({ feed: { n: 19, medianD: 1 }, lesion: { n: 10, medianD: 3 } });
    expect(s.dByKind.rules).toEqual({ feed: { n: 10, medianD: 10 } });
    expect(s.delivered.count).toEqual({ n: 30, medianFeedMatter: 150, medianLivingCellsDelta: -2, medianMatterDelta: 2 });
    expect(s.delivered.dose.medianFeedMatter).toBe(100); // the lesions log no matter
    expect(s.reruns).toEqual([{ id: "dose-3-2", launches: 2 }]);
    const even = Array.from({ length: 10 }, (_, i) => ({ action: i < 5 ? "feed" : "drain" })) as unknown as BenchBody["sources"];
    expect(summarizeBench({ sources: even, constants: BENCH_V0 }, forks, []).readingNote).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// On disk: gradient-m3 treatment bundles under <root>/base/replay-m4/..., notes under <root>/notes.

/** Waits up to two seconds for `ok()` (a descriptor count that lags its close); the assertion after it decides. */
async function settles(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 40 && !ok(); i++) await new Promise((r) => setTimeout(r, 50));
}

const SEL = BENCH_V0.selection;
const DISK_RINGS: Record<number, RingOpts[]> = {
  1: [{ signal: "patternEntropy", side: "high", startStep: 12_000 }, { signal: "livingCells", side: "high", startStep: 15_000 }],
  2: [{ signal: "livingCells", side: "low", startStep: 11_000 }], // S 15,900, forked from the checkpoint at 10,000
  3: [{ signal: "maxGeneration", side: "high", startStep: 13_000 }],
};
const DISK: BenchConstants = { ...BENCH_V0, pairs: 3 };
let root = "", base = "", notesDir = "";
function writeSource(seed: number, rings: RingOpts[] = DISK_RINGS[seed]) {
  const dir = join(base, SEL.experiment, SEL.presetId, SEL.condition, `seed-${seed}`);
  mkdirSync(dir, { recursive: true });
  const m = sourceManifest({ experiment: SEL.experiment, presetId: SEL.presetId, condition: SEL.condition, seed, steps: 50_000 });
  if (seed === 2) {
    const ck = checkpointArtifact(m.spec, 10_000);
    mkdirSync(join(dir, "checkpoints"), { recursive: true });
    writeFileSync(join(dir, "checkpoints", "t000010000.blck"), ck.bytes);
    m.checkpoints = [{ step: 10_000, file: "checkpoints/t000010000.blck", hash: ck.hash }];
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(m, null, 2));
  const series = seriesText(500);
  writeFileSync(join(dir, "series.jsonl"), series);
  writeFileSync(join(dir, "lineages.tsv"), lineagesText(series));
  const size = (f: string) => statSync(join(dir, f)).size;
  writeFileSync(join(notesDir, `${SEL.experiment}-${SEL.presetId}-${SEL.condition}-seed-${seed}.notes.json`), notesJson(m, rings, { sizes: { manifest: size("manifest.json"), series: size("series.jsonl"), lineages: size("lineages.tsv") } }));
}
const argOf = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];
type Mode = "fail" | "short" | "extra" | "badlog" | "early" | "late" | "big" | "none" | "nullmass";
/**
 * A fake tools/run.ts: writes the fork bundle the entry's argv names (its censuses in (C, C + steps]), replaying the source and
 * departing (+500 living cells) for the ten censuses after its first entry. Modes: fail (exit 3, no bundle), short (its last census
 * missing), extra (one census past its end), badlog (an empty interventions.jsonl), early (a departure at its anchor, so the replay
 * check fails), late (living cells 300 lower over its last 50 censuses), big (a departure of +5,000), none (no departure at all: the
 * source's history, its action applied), nullmass (meanMass null after the anchor, every lineage check still passing).
 */
function fakeExec(body: BenchBody, o: { modes?: Record<string, Mode>; onRun?: (target: string) => void } = {}): Exec {
  return async (argv) => {
    o.onRun?.(argOf(argv, "--out"));
    const target = argOf(argv, "--out");
    const e = body.entries.find((x) => target.endsWith(`/${x.id}`))!;
    const mode = o.modes?.[e.id];
    if (mode === "fail") return 3;
    const dir = join(target, runId(e.spec));
    mkdirSync(dir, { recursive: true });
    const end = e.C + e.steps;
    const size = mode === "big" ? 5000 : mode === "none" ? 0 : 500;
    const bump = (t: number) => (t > e.anchor && t <= e.anchor + 1000 ? size : 0) + (mode === "early" && t === e.anchor ? 7 : 0) + (mode === "late" && t > end - 5000 ? -300 : 0);
    let lines = seriesText(end / 100 + (mode === "extra" ? 1 : 0), 100, bump).trim().split("\n").filter((l) => JSON.parse(l).step > e.C);
    if (mode === "short") lines = lines.slice(0, -1);
    if (mode === "nullmass") lines = lines.map((l) => (JSON.parse(l).step > e.anchor ? JSON.stringify({ ...JSON.parse(l), meanMass: null }) : l));
    const series = lines.join("\n") + "\n";
    writeFileSync(join(dir, "series.jsonl"), series);
    writeFileSync(join(dir, "lineages.tsv"), lineagesText(series));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ startStep: e.C, ...(e.C === 0 ? { initHash: e.fork.hash } : {}), summary: { steps: end } }));
    writeFileSync(join(dir, "interventions.jsonl"), mode === "badlog" ? "" : (e.spec.interventions ?? []).map((x) => formatInterventionLine(x.kind === "lesion" ? x : { ...x, matter: 1 })).join(""));
    return 0;
  };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "bench-"));
  base = join(root, "base");
  notesDir = join(root, "notes");
  mkdirSync(notesDir, { recursive: true });
  for (const s of [1, 2, 3]) writeSource(s);
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("plan and re-derivation on disk", () => {
  it("the same body from absolute and relative paths, and twice", async () => {
    const a = await planFromDisk({ base, notesDir }, DISK);
    const b = await planFromDisk({ base: relative(process.cwd(), base), notesDir: join(notesDir, "..", "notes") }, DISK);
    expect(serializeManifest(plannedManifest(a.body))).toBe(serializeManifest(plannedManifest(b.body)));
    expect(a.body.sources.map((s) => s.action)).toEqual(["drain", "feed", "lesion"]);
    expect(a.body.entries.filter((e) => e.source === 1).every((e) => e.C === 10_000 && e.fork.check === "checkpoint")).toBe(true);
    expect(a.body.entries.filter((e) => e.source !== 1).every((e) => e.C === 0)).toBe(true);
    expect((await rederiveBench(a.body, DISK)).refusal).toBeUndefined();
  }, T);
  it("refuses a source without an intervention proposal, naming it", async () => {
    const alt = join(root, "alt");
    cpSync(base, join(alt, "base"), { recursive: true });
    cpSync(notesDir, join(alt, "notes"), { recursive: true });
    const saved = [base, notesDir];
    [base, notesDir] = [join(alt, "base"), join(alt, "notes")];
    try {
      writeSource(2, [{ signal: "bioticRecycling", side: "high", startStep: 12_000 }]);
      await expect(planFromDisk({ base, notesDir }, DISK)).rejects.toThrow(/replay-m4\/gradient-m3\/treatment\/seed-2: its notes give no feed, drain or lesion proposal/);
    } finally {
      [base, notesDir] = saved;
    }
  }, T);
  it("refuses a notes directory inside the repository", async () => {
    await expect(loadBenchInputs({ base, notesDir }, DISK, root)).rejects.toThrow(/the notes directory .* is inside the repository/);
  }, T);
  it("records each source's series.jsonl and lineages.tsv SHA-256", async () => {
    const { body } = await planFromDisk({ base, notesDir }, DISK);
    const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
    for (const s of body.sources) {
      expect(s.seriesSha256).toBe(sha(join(s.dir, "series.jsonl")));
      expect(s.lineagesSha256).toBe(sha(join(s.dir, "lineages.tsv")));
    }
  }, T);
  it("refuses a notes directory inside the sources' runs tree", async () => {
    const inside = join(base, "notes-inside");
    cpSync(notesDir, inside, { recursive: true });
    try {
      await expect(planFromDisk({ base, notesDir: inside }, DISK)).rejects.toThrow(/the notes directory .* is inside the runs tree that holds the source/);
    } finally {
      rmSync(inside, { recursive: true, force: true });
    }
  }, T);
});

describe("run: the gate, resume, the time cap, a failing fork; then score", () => {
  let m: BenchManifest;
  let approved: BenchManifest;
  beforeAll(async () => {
    m = plannedManifest((await planFromDisk({ base, notesDir }, DISK)).body);
    approved = approveManifest(m, "Test Person", "2026-10-18T00:00:00Z", 3);
  }, T);
  const opts = (out: string, exec: Exec, extra: Partial<Parameters<typeof runBench>[1]> = {}) => ({ out, repo: REPO, jobs: 1, maxMinutes: 240, exec, pairs: 3, ...extra });

  it("refuses a fixture-sized manifest unless its size is named", async () => {
    const out = join(root, "out-pairs");
    await expect(runBench(approved, opts(out, fakeExec(m.body), { pairs: undefined }))).rejects.toThrow(/the manifest has 3 pairs, not 10/);
    expect(existsSync(out)).toBe(false);
  }, T);

  it("refuses an unapproved manifest and creates nothing", async () => {
    const out = join(root, "out-unapproved");
    await expect(runBench(m, opts(out, fakeExec(m.body)))).rejects.toThrow(BenchRefusal);
    await expect(runBench(m, opts(out, fakeExec(m.body)))).rejects.toThrow(/not approved/);
    expect(existsSync(out)).toBe(false);
  }, T);
  it("refuses jobs or a cap that is not positive, when called directly", async () => {
    const out = join(root, "out-opts");
    await expect(runBench(approved, opts(out, fakeExec(m.body), { jobs: 0 }))).rejects.toThrow(/--jobs 0 is not a positive integer/);
    await expect(runBench(approved, opts(out, fakeExec(m.body), { maxMinutes: 0 }))).rejects.toThrow(/--max-minutes 0 is not a positive number/);
    expect(existsSync(out)).toBe(false);
  }, T);
  it("refuses an --out that holds another manifest's copy, and a run log that is a link (the linked file is untouched)", async () => {
    const other = join(root, "out-other");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, MANIFEST_COPY), "{}\n");
    await expect(runBench(approved, opts(other, fakeExec(m.body)))).rejects.toThrow(/bench-manifest.json is another manifest's/);
    expect(readdirSync(other)).toEqual([MANIFEST_COPY]);
    const linked = join(root, "out-link"), victim = join(root, "victim.jsonl");
    mkdirSync(linked, { recursive: true });
    writeFileSync(victim, "keep\n");
    symlinkSync(victim, join(linked, RUN_LOG));
    // No lstat precheck stands in front: the refusal is O_NOFOLLOW's ELOOP on the open itself (amendment 2).
    await expect(runBench(approved, opts(linked, fakeExec(m.body)))).rejects.toThrow(/cannot be opened as the run log without following a link \(.*ELOOP/);
    expect(readFileSync(victim, "utf8")).toBe("keep\n");
    expect(readdirSync(linked)).toEqual([RUN_LOG]);
    // A hard link passes O_NOFOLLOW and is a regular file; fstat's link count on the open handle refuses it (amendment 2).
    const hard = join(root, "out-hardlink");
    mkdirSync(hard, { recursive: true });
    linkSync(victim, join(hard, RUN_LOG));
    await expect(runBench(approved, opts(hard, fakeExec(m.body)))).rejects.toThrow(/bench-run.jsonl has 2 links/);
    expect(readFileSync(victim, "utf8")).toBe("keep\n");
    expect(readdirSync(hard)).toEqual([RUN_LOG]);
  }, T);
  it("refuses a source whose series.jsonl changed after the plan, though its length and manifest did not", async () => {
    const out = join(root, "out-content");
    const f = join(base, SEL.experiment, SEL.presetId, SEL.condition, "seed-3", "series.jsonl");
    const was = readFileSync(f, "utf8");
    const i = was.lastIndexOf('"livingCells":1');
    try {
      writeFileSync(f, was.slice(0, i) + '"livingCells":2' + was.slice(i + 15));
      expect(statSync(f).size).toBe(Buffer.byteLength(was));
      await expect(runBench(approved, opts(out, fakeExec(m.body)))).rejects.toThrow(/the source series.jsonl of replay-m4\/gradient-m3\/treatment\/seed-3 changed since the plan/);
    } finally {
      writeFileSync(f, was);
    }
    expect(existsSync(out)).toBe(false);
  }, T);
  it("an entry another process claims mid-run is recorded as an error, not a crash; the other forks run and get receipts", async () => {
    const out = join(root, "out-eexist");
    const exec = fakeExec(m.body, { onRun: (target) => (target.endsWith("/seed-1-rules") ? mkdirSync(join(out, "seed-1-count-1")) : undefined) });
    const r = await runBench(approved, opts(out, exec));
    expect(r.errors).toEqual([{ id: "seed-1-count-1", error: `${join(out, "seed-1-count-1")} appeared before this run claimed it (another run?); not started here` }]);
    expect(r.finished).toHaveLength(20);
    expect(r.finished.every((f) => f.exit === 0)).toBe(true);
    expect(r.notStarted).toEqual([]);
    expect(readFileSync(join(out, RUN_LOG), "utf8").trim().split("\n")).toHaveLength(40);
    // The next run names the claimed directory and refuses until it is moved aside.
    await expect(runBench(approved, opts(out, fakeExec(m.body)))).rejects.toThrow(/seed-1-count-1 \(no run receipt\)\. A run that was stopped or a fork that failed leaves one; move it aside/);
  }, T);
  it("refuses --out inside the sources' runs tree", async () => {
    await expect(runBench(approved, opts(join(base, "x"), fakeExec(m.body)))).rejects.toThrow(/is inside the runs tree that holds the source/);
  }, T);
  it("refuses a body edited and re-approved, a changed notes file, a recorded rule version that is not this checkout's", async () => {
    const out = join(root, "out-edited");
    const forge = (edit: (b: BenchBody) => void): BenchManifest => {
      const b: BenchBody = JSON.parse(JSON.stringify(m.body));
      edit(b);
      const sha = manifestSha256(b);
      return { manifestSha256: sha, status: "approved", approval: { by: "Test Person", at: "2026-10-18T00:00:00Z", manifestSha256: sha }, body: b };
    };
    // A radius edited with the hash and approval recomputed: the entry no longer validates.
    await expect(runBench(forge((b) => (b.entries[0].spec.interventions![0].r = 5)), opts(out, fakeExec(m.body)))).rejects.toThrow(/entry "seed-1-rules"/);
    // An edit every per-entry check passes: only re-deriving the plan from its files refuses it.
    await expect(runBench(forge((b) => (b.constants.zStarPair = 1)), opts(out, fakeExec(m.body)))).rejects.toThrow(/not the plan its files give/);
    await expect(runBench(forge((b) => (b.notesCommand += " --force")), opts(out, fakeExec(m.body)))).rejects.toThrow(/not the plan its files give/);
    await expect(runBench(forge((b) => (b.versions.rule = 99)), opts(out, fakeExec(m.body)))).rejects.toThrow(/other versions than this checkout's/);
    const notes1 = join(notesDir, "replay-m4-gradient-m3-treatment-seed-1.notes.json");
    const was = readFileSync(notes1, "utf8");
    try {
      writeFileSync(notes1, was + " ");
      await expect(runBench(approved, opts(out, fakeExec(m.body)))).rejects.toThrow(/the notes file .* changed since the plan/);
    } finally {
      writeFileSync(notes1, was);
    }
    expect(existsSync(out)).toBe(false);
  }, T);

  it("resumes, stops at the cap, records a failing fork, refuses an incomplete entry by name, and then scores", async () => {
    const out = join(root, "out");
    let clock = 0;
    const tick = () => (clock += 40_000);
    // Cap 1 minute, 40 s per fork: two forks start, the rest wait.
    const r1 = await runBench(approved, opts(out, fakeExec(m.body, { onRun: tick, modes: { "seed-1-rules": "late" } }), { maxMinutes: 1, now: () => clock }));
    expect(r1.finished.map((f) => f.id)).toEqual(["seed-1-rules", "seed-1-count-1"]);
    expect(r1.finished.every((f) => f.exit === 0)).toBe(true);
    expect(r1.capped).toBe(true);
    expect(r1.notStarted).toHaveLength(19);
    const receipt = JSON.parse(readFileSync(join(out, "seed-1-rules", "run-receipt.json"), "utf8"));
    expect(receipt).toMatchObject({ exitCode: 0, entryId: "seed-1-rules", benchManifestSha256: m.manifestSha256, replayCheck: { ok: true }, identityCheck: { ok: true } });
    const logLines = readFileSync(join(out, "bench-run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(logLines.map((l) => `${l.event} ${l.id}`)).toEqual(["start seed-1-rules", "finish seed-1-rules", "start seed-1-count-1", "finish seed-1-count-1"]);
    // A cap that passes while a fork's directory is being claimed: that fork does not start, and its directory is not left behind.
    let calls = 0;
    const late = await runBench(approved, opts(join(root, "out-claim"), fakeExec(m.body), { maxMinutes: 1, now: () => (calls++ < 2 ? 0 : 120_000) }));
    expect(late).toMatchObject({ finished: [], capped: true });
    expect(calls).toBe(3); // t0, the check before the claim (in time), the check after it (past the cap)
    expect(late.notStarted).toHaveLength(21);
    expect(readdirSync(join(root, "out-claim"))).toEqual(["bench-manifest.json", "bench-run.jsonl"]);
    expect(readFileSync(join(root, "out-claim", "bench-run.jsonl"), "utf8")).toBe("");
    // Resume with three jobs, one failing fork and four bad bundles: the two done are skipped.
    const modes: Record<string, Mode> = {
      "seed-2-dose-1": "fail",
      "seed-3-count-1": "short",
      "seed-3-count-2": "extra",
      "seed-3-count-3": "badlog",
      "seed-3-dose-1": "early",
      "seed-3-dose-2": "nullmass",
      "seed-2-rules": "big",
      "seed-2-count-2": "none",
      "seed-1-dose-2": "big",
      "seed-1-dose-3": "big",
    };
    const r2 = await runBench(approved, opts(out, fakeExec(m.body, { modes }), { jobs: 3 }));
    expect(r2.skipped).toEqual(["seed-1-rules", "seed-1-count-1"]);
    expect(r2.finished).toHaveLength(19);
    expect(r2.finished.find((f) => f.id === "seed-2-dose-1")!.exit).toBe(3);
    expect(r2.finished.find((f) => f.id === "seed-3-dose-1")!.exit).toBe(4);
    expect(JSON.parse(readFileSync(join(out, "seed-2-dose-1", "run-receipt.json"), "utf8"))).toMatchObject({ exitCode: 3, runExitCode: 3 });
    // The failed entry's directory is refused by name until a person moves it aside; nothing is deleted.
    await expect(runBench(approved, opts(out, fakeExec(m.body)))).rejects.toThrow(/seed-2-dose-1 \(its receipt has exit code 3\), seed-3-dose-1 \(its receipt has exit code 4\)/);
    mkdirSync(join(root, "out-incomplete", "seed-3-rules"), { recursive: true });
    await expect(runBench(approved, opts(join(root, "out-incomplete"), fakeExec(m.body)))).rejects.toThrow(/seed-3-rules \(no run receipt\)/);
    expect(readdirSync(join(root, "out-incomplete"))).toEqual(["seed-3-rules"]);
    // The remedy (amendment 1): move the failed directories aside and run again; seed-2-dose-1 now runs clean, seed-3-dose-1 fails again.
    mkdirSync(join(out, "aside"));
    for (const id of ["seed-2-dose-1", "seed-3-dose-1"]) renameSync(join(out, id), join(out, "aside", id));
    // An interruption tore the log's last line; the next start line must still be a line of its own (amendment 2).
    appendFileSync(join(out, RUN_LOG), '{"id":"seed-3-dose-1","event":"fin');
    const r3 = await runBench(approved, opts(out, fakeExec(m.body, { modes: { "seed-3-dose-1": "early" } })));
    expect(r3.finished).toEqual([{ id: "seed-2-dose-1", exit: 0 }, { id: "seed-3-dose-1", exit: 4 }]);
    expect(r3.skipped).toHaveLength(19);

    // Score: every receipt is there (two non-zero), so the record is made; the bad forks are void with their reasons, the others valid and anchored.
    await expect(scoreBench(approved, { out })).rejects.toThrow(/3 pairs, not 10/);
    await expect(scoreBench({ ...approved, approval: { ...approved.approval!, by: "Claude" } }, { out, pairs: 3 })).rejects.toThrow(/the approval names no person/);
    await expect(scoreBench(approved, { out: join(root, "out-other"), pairs: 3 })).rejects.toThrow(/--out is not this bench's run/);
    // An entry directory that cannot be read voids only its own fork; the score is still made (amendment 2).
    chmodSync(join(out, "seed-3-count-3"), 0o000);
    let rec: Awaited<ReturnType<typeof scoreBench>>;
    try {
      rec = await scoreBench(approved, { out, pairs: 3 });
    } finally {
      chmodSync(join(out, "seed-3-count-3"), 0o755);
    }
    const byId = new Map(rec.forks.map((f) => [f.id, f]));
    const voids: Record<string, RegExp> = {
      "seed-3-dose-1": /exit code 4 .*the census at step \d+ differs/,
      "seed-3-dose-2": /stream: .*meanMass is null, not a finite number/,
      "seed-3-count-1": /stream: ended after \d+ censuses, expected \d+/,
      "seed-3-count-2": /stream: more than \d+ censuses/,
      "seed-3-count-3": /a file of the fork could not be read: .*EACCES/,
    };
    for (const [id, re] of Object.entries(voids)) {
      expect(byId.get(id), id).toMatchObject({ valid: false, D: null });
      expect(byId.get(id)!.voidReasons.join(" "), id).toMatch(re);
    }
    // An action applied with no effect is a valid D = 0, not a void (amendment 1).
    expect(byId.get("seed-2-count-2")).toMatchObject({ valid: true, D: 0, firstDiffStep: null, voidReasons: [] });
    for (const f of rec.forks.filter((x) => !(x.id in voids) && x.id !== "seed-2-count-2")) {
      expect(f.valid, `${f.id}: ${f.voidReasons.join("; ")}`).toBe(true);
      // The departure lasts ten censuses after the fork's own first entry: only a scorer anchored there sees it.
      expect(f.firstDiffStep).toBe(f.anchor + 100);
      expect(f.D!).toBeGreaterThan(1);
    }
    const counts = rec.forks.filter((f) => f.role === "count");
    expect(counts.some((f) => f.anchor < m.body.entries.find((e) => e.id === f.id)!.S - 1000)).toBe(true);
    // seed-2 forks from the checkpoint at 10,000: given the source's censuses up to C, its forks score like the others.
    expect(rec.forks.filter((f) => f.source === 1 && f.id !== "seed-2-dose-1").every((f) => f.valid && f.anchor > 10_000)).toBe(true);
    expect(rec.summary.count.called).toBe(false); // three pairs, not ten
    expect(rec.summary.count.voids).toBe(1);
    expect(rec.summary.dose.voids).toBe(1);
    // The wiring from scores to pairs: seed-1 ties v0's forks and loses to two big dose forks; seed-2's big rules fork wins both.
    expect(rec.summary.count.pairs.map((p) => p.outcome)).toEqual(["tie", "win", "void"]);
    expect(rec.summary.dose.pairs.map((p) => p.outcome)).toEqual(["loss", "win", "void"]);
    expect(rec.summary.count.pairs[1].baseline[1]).toBe(0);
    expect(byId.get("seed-2-rules")!.D!).toBeGreaterThan(byId.get("seed-2-count-1")!.D!);
    expect(rec.summary.reruns).toEqual([{ id: "seed-2-dose-1", launches: 2 }, { id: "seed-3-dose-1", launches: 2 }]);
    expect(rec.summary.caveats).toEqual([...CAVEATS_V0]);
    const feedFork = rec.forks.find((f) => f.valid && f.kinds.includes("feed"))!;
    expect(feedFork.delivered.feedMatter).toBe(feedFork.kinds.filter((x) => x !== "lesion").length);
    expect(feedFork.delivered.step).toBe(feedFork.anchor + 100);
    // Predictions: seed-1's drain says living cells end at least one spread below the source; only its rules fork does that.
    const [p1, p2, p3] = rec.summary.predictions.list;
    expect(rec.summary.predictions.of).toBe(3);
    expect(p1).toMatchObject({ source: 0, signal: "livingCells", rules: true, count: [false, false, false], dose: [false, false, false] });
    expect(p2).toMatchObject({ source: 1, rules: false, count: [false, false, false], dose: [false, false, false] });
    expect(p3).toMatchObject({ source: 2, rules: false, count: [null, null, null], dose: [null, null, false] });
    expect(rec.summary.predictions).toMatchObject({ held: 1, decided: 3, specificity: { count: { held: 0, decided: 6 }, dose: { held: 0, decided: 7 } } });

    // The bytes scored are the bytes bound (Codex pass 3): a source changed after the pre-checks passed, before it is streamed, is
    // refused by the digest over the scored stream. The edits lie past the horizon, so scoring alone would not notice them.
    const horizon = rec.parameters.horizon as number;
    const srcFile = (i: number, f: string) => join(m.body.sources[i].dir, f);
    const fds = () => (existsSync("/dev/fd") ? readdirSync("/dev/fd").length : 0);
    const fdsBefore = fds();
    const series3 = srcFile(2, "series.jsonl"), was3 = readFileSync(series3, "utf8");
    const at = was3.lastIndexOf('"livingCells":1');
    expect(JSON.parse(was3.slice(was3.lastIndexOf("\n", at) + 1, was3.indexOf("\n", at))).step).toBeGreaterThan(horizon);
    try {
      const inPlace = () => writeFileSync(series3, was3.slice(0, at) + '"livingCells":2' + was3.slice(at + 15));
      await expect(scoreBench(approved, { out, pairs: 3, beforeStream: inPlace })).rejects.toThrow(/the source series.jsonl of replay-m4\/gradient-m3\/treatment\/seed-3 that was scored is not the one the plan bound/);
    } finally {
      writeFileSync(series3, was3);
    }
    const lin1 = srcFile(0, "lineages.tsv"), wasLin1 = readFileSync(lin1, "utf8");
    try {
      const renameOver = () => {
        writeFileSync(lin1 + ".new", wasLin1 + "\n");
        renameSync(lin1 + ".new", lin1);
      };
      await expect(scoreBench(approved, { out, pairs: 3, beforeStream: renameOver })).rejects.toThrow(/the source lineages.tsv of replay-m4\/gradient-m3\/treatment\/seed-1 that was scored is not the one the plan bound/);
    } finally {
      writeFileSync(lin1, wasLin1);
    }
    const series2 = srcFile(1, "series.jsonl"), was2 = readFileSync(series2, "utf8");
    try {
      const truncate = () => writeFileSync(series2, was2.slice(0, was2.indexOf("\n", was2.length >> 2) + 1));
      await expect(scoreBench(approved, { out, pairs: 3, beforeStream: truncate })).rejects.toThrow(/treatment\/seed-2: .*(ended before step|after the last series census)/);
    } finally {
      writeFileSync(series2, was2);
    }
    // Refusals close every source file they opened (polled: a descriptor is released a moment after its stream is destroyed; a leak
    // never converges).
    await settles(() => fds() <= fdsBefore);
    expect(fds()).toBeLessThanOrEqual(fdsBefore);
  }, T);
});

describe("bench file integrity (amendment 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-integrity-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const shaOf = (t: string) => createHash("sha256").update(t).digest("hex");

  it("hashedText digests exactly the bytes read, read on to the end, and sees an in-place edit made while reading", async () => {
    const f = join(dir, "series.jsonl");
    const lines = Array.from({ length: 20_000 }, (_, i) => `{"step":${i},"é":"${"x".repeat(i % 7)}"}`).join("\n") + "\n";
    writeFileSync(f, lines);
    const whole = hashedText(f);
    let text = "";
    for await (const s of whole.text) text += s;
    expect(text).toBe(lines);
    expect(await whole.digest()).toBe(shaOf(lines));
    // Stop after the first chunk: the digest still covers the whole file, from the same open stream.
    const part = hashedText(f);
    for await (const _ of part.text) break;
    expect(await part.digest()).toBe(shaOf(lines));
    // An equal-length edit in place after the first chunk was read: the digest is not the plan's.
    const edited = hashedText(f);
    for await (const _ of edited.text) break;
    writeFileSync(f, lines.slice(0, -3) + "Z}\n");
    expect(statSync(f).size).toBe(Buffer.byteLength(lines));
    expect(await edited.digest()).not.toBe(shaOf(lines));
  });

  it("streamSha256 is not memoised: an equal-length edit that keeps the mtime is seen", async () => {
    const f = join(dir, "lineages.tsv");
    writeFileSync(f, "a\tb\n");
    const before = await streamSha256(f);
    const { atime, mtime } = statSync(f);
    writeFileSync(f, "a\tc\n");
    utimesSync(f, atime, mtime);
    expect(await streamSha256(f)).not.toBe(before);
    expect(await streamSha256(f)).toBe(shaOf("a\tc\n"));
  });

  it("publishOnce never replaces a file: identical is left, different is refused, absent is written", async () => {
    const f = join(dir, "manifest.json");
    expect(await publishOnce(f, "one\n")).toBe("wrote");
    expect(await publishOnce(f, "one\n")).toBe("unchanged");
    await expect(publishOnce(f, "two\n")).rejects.toThrow(/exists and differs; it is never replaced/);
    expect(readFileSync(f, "utf8")).toBe("one\n");
    expect(readdirSync(dir).filter((x) => x.includes(".tmp-"))).toEqual([]);
  });

  it("replaceIfUnchanged: of two approvals at once exactly one is written; a held lock and a changed file are refused (Codex pass 3)", async () => {
    const f = join(dir, "approve.json");
    writeFileSync(f, "planned\n");
    const both = await Promise.allSettled([replaceIfUnchanged(f, "planned\n", "by A\n"), replaceIfUnchanged(f, "planned\n", "by B\n")]);
    const won = both.flatMap((r, i) => (r.status === "fulfilled" ? [i] : []));
    expect(won).toHaveLength(1);
    expect(readFileSync(f, "utf8")).toBe(won[0] === 0 ? "by A\n" : "by B\n");
    const lost = both.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(BenchRefusal);
    expect(String(lost.reason.message)).toMatch(/approve.json.lock exists|changed while it was being approved/);
    await expect(replaceIfUnchanged(f, "planned\n", "by C\n")).rejects.toThrow(/changed while it was being approved/);
    writeFileSync(f + ".lock", "1\n");
    await expect(replaceIfUnchanged(f, readFileSync(f, "utf8"), "by D\n")).rejects.toThrow(/approve.json.lock exists/);
    rmSync(f + ".lock");
    expect(readFileSync(f, "utf8")).not.toMatch(/by [CD]/);
    expect(readdirSync(dir).filter((x) => x.startsWith("approve.json."))).toEqual([]);
  });

  it("hashedText.close closes the file whether or not it was read to its end", async () => {
    const f = join(dir, "close.tsv");
    writeFileSync(f, "x\n".repeat(100_000));
    if (!existsSync("/dev/fd")) return; // counted through /dev/fd (macOS, Linux)
    const fds = () => readdirSync("/dev/fd").length;
    const before = fds();
    const reads = Array.from({ length: 8 }, () => hashedText(f));
    for (const r of reads) for await (const _ of r.text) break;
    expect(fds()).toBeGreaterThanOrEqual(before + 8);
    await Promise.all(reads.map((r) => r.close()));
    await settles(() => fds() <= before);
    expect(fds()).toBeLessThanOrEqual(before);
  });

  it("interventionLogProblem: the applied log must be the schedule, entry by entry (count, step, kind, centre, radius, feed amount)", () => {
    const sched: ScheduledIntervention[] = [{ step: 500, kind: "feed", x: 3, y: 4, r: 9, amount: 32 }, { step: 600, kind: "lesion", x: 1, y: 2, r: 5 }];
    const applied = [{ step: 500, kind: "feed" as const, x: 3, y: 4, r: 9, amount: 32, matter: 70 }, { step: 600, kind: "lesion" as const, x: 1, y: 2, r: 5 }];
    expect(interventionLogProblem(sched, applied)).toBeNull();
    expect(interventionLogProblem(sched, [])).toBe("interventions.jsonl holds 0 entries, 2 were scheduled");
    expect(interventionLogProblem(sched, [{ ...applied[0], amount: -32 }, applied[1]])).toBe("interventions.jsonl entry 0 is not the scheduled one");
    expect(interventionLogProblem(sched, [applied[0], { ...applied[1], r: 4 }])).toBe("interventions.jsonl entry 1 is not the scheduled one");
    expect(interventionLogProblem(sched, [applied[1], applied[0]])).toBe("interventions.jsonl entry 0 is not the scheduled one");
  });

  it("openRunLog ends a torn last line before appending, and refuses a directory", async () => {
    const f = join(dir, RUN_LOG);
    writeFileSync(f, '{"id":"a","event":"start"}\n{"id":"a","ev');
    const h = await openRunLog(f);
    await h.appendFile('{"id":"b","event":"start"}\n');
    await h.close();
    expect(readFileSync(f, "utf8").split("\n")).toEqual(['{"id":"a","event":"start"}', '{"id":"a","ev', '{"id":"b","event":"start"}', ""]);
    const clean = await openRunLog(f);
    await clean.close();
    expect(readFileSync(f, "utf8").endsWith('"start"}\n')).toBe(true);
    mkdirSync(join(dir, "logdir"));
    await expect(openRunLog(join(dir, "logdir"))).rejects.toThrow(BenchRefusal);
  });
});
