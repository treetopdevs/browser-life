// I02b: the fresh-family recipe, the confirm protocol, the committed-amendment gate and the mechanical reading
// (docs/prediction-confirm-2026-11-02/PLAN.md, section 7). No confirm family is ever simulated here.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { canonical } from "../lib/propose.ts";
import { COMPARATORS, buildConfirmProtocol, buildConfirmation, buildLedger, confirmDigest, confirmReading, coverageProblems, digestProblems, disjointnessProblems, expectedCases, provenanceProblems, reservedConfirmProblems, freshFamilies, identityProblems, amendmentRefusal, recipeTupleProblems, type AmendmentGateInput, type LedgerRow, type ReadingParams, type V0RecipeRow } from "../lib/prediction/confirm.ts";
import { protocolHash, splitPlanOf, type CaseRow, type PredictionLine, type Protocol } from "../lib/prediction/run.ts";
import type { PredictionEnvelope } from "../lib/prediction/envelope.ts";
import { assertNoLeak } from "../lib/prediction/splits.ts";
import { renderReport } from "../lib/prediction/report-html.ts";
import { sha256Text } from "../lib/propose.ts";
import { tinyPipeline } from "./prediction-helpers.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const EXP = join(root, "experiments/prediction-envelope");
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const v0 = readJson<Protocol>(join(EXP, "protocol.json"));
const confirm = readJson<Protocol>(join(EXP, "protocol.confirm.json"));
const v0Recipes = readFileSync(join(EXP, "v0/recipes.jsonl"), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as V0RecipeRow);

describe("fresh families", () => {
  it("fresh families are disjoint from every v0 family", () => {
    expect(disjointnessProblems(confirm, v0, v0Recipes)).toEqual([]);
    // explicit, independent of the helper
    const used = new Set<number>();
    for (const f of v0.families) used.add(f.seed).add(f.seed + v0.seedVariantOffset);
    for (const r of v0Recipes) used.add(r.seed);
    for (const f of confirm.families) {
      expect(used.has(f.seed)).toBe(false);
      expect(used.has(f.seed + confirm.seedVariantOffset)).toBe(false);
      expect(v0.families.some((g) => g.id === f.id)).toBe(false);
    }
    expect(confirm.salt).not.toBe(v0.salt);
  });
  it("the helper catches reuse of a v0 seed, a v0 variant seed, a v0 id and the v0 salt", () => {
    const bad = structuredClone(confirm);
    bad.families[0].seed = 5003;
    bad.families[1].seed = 5003 + 7919; // a v0 qualification-variant seed (12922)
    bad.families[2].id = "f05";
    bad.salt = v0.salt;
    const problems = disjointnessProblems(bad, v0, v0Recipes).join("\n");
    expect(problems).toMatch(/seed 5003/);
    expect(problems).toMatch(/seed 12922 \(family c01\) is a v0 seed/);
    expect(problems).toMatch(/id f05/);
    expect(problems).toMatch(/salt/);
  });
  it("confirm protocol differs from the frozen protocol only in identity fields", () => {
    expect(identityProblems(confirm, v0)).toEqual([]);
    expect(recipeTupleProblems(confirm, v0)).toEqual([]);
    expect(canonical(confirm)).not.toBe(canonical(v0));
    // the committed file is exactly what the recipe builds, and its freeze file is its hash
    expect(canonical(confirm)).toBe(canonical(buildConfirmProtocol(v0)));
    expect(readFileSync(join(EXP, "protocol.confirm.freeze.sha256"), "utf8")).toBe(protocolHash(confirm) + "\n");
    expect(confirm.frozen).toBe(true);
    expect(confirm.minEffect).toBe(25);
    expect(confirm.devPrior).toEqual(v0.devPrior);
    expect(freshFamilies()).toEqual(confirm.families);
    // v0's frozen files stay as frozen
    expect(readFileSync(join(EXP, "protocol.freeze.sha256"), "utf8").trim()).toBe(protocolHash(v0));
  });
  it("an edit outside the identity fields, or a changed recipe tuple, is caught", () => {
    const m = structuredClone(confirm);
    m.minEffect = 26;
    m.window.horizon = 201;
    expect(identityProblems(m, v0).sort()).toEqual(["minEffect", "window"]);
    const t = structuredClone(confirm);
    t.families[3].founders += 1;
    t.families[16].nutrient = 7;
    expect(recipeTupleProblems(t, v0)).toHaveLength(2);
  });
  it("split plan: 16 test families (12 original, 4 rising), no family in two splits, donors stay within split, assertNoLeak clean", () => {
    const plan = splitPlanOf(confirm);
    expect(plan.test).toHaveLength(16);
    expect(plan.dev).toHaveLength(4);
    expect(plan.qualify).toEqual([]);
    const rising = new Set(confirm.families.filter((f) => f.cohort === "rising").map((f) => f.id));
    expect(plan.test.filter((f) => rising.has(f))).toHaveLength(4);
    expect(plan.test.filter((f) => !rising.has(f))).toHaveLength(12);
    expect(plan.test.length * 6).toBe(96);
    expect(plan.dev.filter((f) => plan.test.includes(f))).toEqual([]);
    expect(new Set([...plan.dev, ...plan.test]).size).toBe(20);
    const devSet = new Set(plan.dev);
    for (const [f, d] of Object.entries(confirm.donors)) {
      expect(f).not.toBe(d);
      expect(devSet.has(f)).toBe(devSet.has(d));
    }
    expect(assertNoLeak(plan, confirm.donors, [])).toEqual([]);
    expect(plan.test.length).toBeGreaterThanOrEqual(10);
  });
});

describe("the committed-amendment gate", () => {
  const h = protocolHash(confirm) + "\n";
  const pj = JSON.stringify(confirm);
  const ok = (): AmendmentGateInput => ({ protocol: confirm, freezeWorking: h, protocolWorking: pj, amendmentWorking: "A", committed: { amendment: "A", protocol: pj, freeze: h }, dirtyPaths: [], outDirNonEmpty: false, exploratory: false });
  it("passes when everything matches", () => {
    expect(amendmentRefusal(ok())).toBeNull();
  });
  it("gate refuses", () => {
    const r = (m: (i: AmendmentGateInput) => void): string | null => {
      const i = ok();
      m(i);
      return amendmentRefusal(i);
    };
    expect(r((i) => (i.exploratory = true))).toMatch(/exploratory/);
    expect(r((i) => (i.freezeWorking = null))).toMatch(/missing/);
    expect(r((i) => (i.freezeWorking = "0".repeat(64)))).toMatch(/does not match/);
    expect(r((i) => (i.protocol = { ...confirm, minEffect: 26 }))).toMatch(/does not match/);
    expect(r((i) => (i.protocol = { ...confirm, frozen: false }))).toMatch(/not frozen/);
    expect(r((i) => (i.amendmentWorking = null))).toMatch(/amendment file is missing/);
    expect(r((i) => (i.committed.amendment = null))).toMatch(/amendment is not committed/);
    expect(r((i) => (i.committed.protocol = null))).toMatch(/protocol is not committed/);
    expect(r((i) => (i.committed.freeze = null))).toMatch(/freeze file is not committed/);
    expect(r((i) => (i.committed.amendment = "B"))).toMatch(/amendment differs/);
    expect(r((i) => (i.committed.protocol = pj + " "))).toMatch(/protocol differs/);
    expect(r((i) => (i.committed.freeze = "x"))).toMatch(/freeze file differs/);
    expect(r((i) => (i.dirtyPaths = [" M tools/predict.ts"]))).toMatch(/uncommitted changes \( ?M tools\/predict.ts/);
    expect(r((i) => (i.outDirNonEmpty = true))).toMatch(/not empty/);
  });
});

describe("the CLI honours --protocol", () => {
  const dir = mkdtempSync(join(tmpdir(), "predict-confirm-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const deno = (args: string[]) => spawnSync("deno", ["run", "--no-lock", "-A", "tools/predict.ts", ...args], { cwd: root, encoding: "utf8" });
  it("refuses the confirm protocol with --exploratory, with a missing amendment and with a real but uncommitted amendment; never writes output", () => {
    const out = join(dir, "o1");
    const base = ["run", "--stage", "confirm", "--protocol", join(EXP, "protocol.confirm.json"), "--freeze", join(EXP, "protocol.confirm.freeze.sha256"), "--out", out];
    const a = deno([...base, "--amendment", join(dir, "missing.md")]);
    expect(a.status).toBe(1);
    expect(a.stderr).toMatch(/refusing to confirm/);
    const b = deno(["run", "--stage", "confirm", "--protocol", join(EXP, "protocol.confirm.json"), "--out", out]);
    expect(b.status).toBe(1);
    expect(b.stderr).toMatch(/needs --freeze and --amendment/);
    const c = deno([...base, "--amendment", join(dir, "missing.md"), "--exploratory", "yes"]);
    expect(c.status).toBe(1);
    expect(c.stderr).toMatch(/exploratory/);
    const d = deno(["run", "--stage", "dev", "--protocol", join(EXP, "protocol.confirm.json"), "--out", out]);
    expect(d.status).toBe(1);
    // a real amendment file that HEAD has no copy of (outside the repo, so `git show HEAD:<path>` finds nothing)
    const real = join(dir, "AMENDMENT.md");
    writeFileSync(real, "an amendment nobody committed\n");
    const e = deno([...base, "--amendment", real]);
    expect(e.status).toBe(1);
    expect(e.stderr).toMatch(/amendment is not committed/);
    expect(existsSync(out)).toBe(false);
  }, 120_000);
  it("smoke refuses the reserved confirmation identities, renamed snapshots included, and writes nothing (dev and the unamended confirm can only read v0's own protocol file)", () => {
    const out = join(dir, "o2");
    const smoke = deno(["run", "--stage", "smoke", "--protocol", join(EXP, "protocol.confirm.json"), "--out", out]);
    expect(smoke.status).toBe(1);
    expect(smoke.stderr).toMatch(/reserved held-out confirmation identities/);
    // renamed: different salt and family ids, same seeds
    const renamed = structuredClone(confirm);
    renamed.salt = "renamed";
    renamed.families = renamed.families.map((f, k) => ({ ...f, id: `z${k}` }));
    const rp = join(dir, "renamed.json");
    writeFileSync(rp, JSON.stringify(renamed));
    const r = deno(["run", "--stage", "smoke", "--protocol", rp, "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/reserved confirmation seed/);
    expect(existsSync(out)).toBe(false);
    expect(reservedConfirmProblems(v0)).toEqual([]);
    // a qualification variant (base + offset) landing on a reserved seed is caught too: v0 family at 5999, offset 1 -> 6000 is reserved
    const variant = structuredClone(v0);
    variant.families = [{ ...v0.families[0], seed: 5999 }];
    variant.seedVariantOffset = 1;
    expect(reservedConfirmProblems(variant).join(" ")).toMatch(/reserved confirmation seed 5999/);
    const variant2 = structuredClone(variant);
    variant2.families[0].seed = 6001 - 1000;
    variant2.seedVariantOffset = 1000;
    expect(reservedConfirmProblems(variant2).length).toBeGreaterThan(0);
    expect(reservedConfirmProblems(confirm).length).toBeGreaterThan(0);
  }, 120_000);
  it("protocol-confirm never overwrites", () => {
    const r = deno(["protocol-confirm"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not overwriting/);
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The reading, on synthetic ledgers.

const prior = { up: 135, down: 271, none: 594 };
const prm: ReadingParams = { devPrior: prior, resamples: 400, seed: 7, status: "CONFIRM" };
type Cls = "up" | "down" | "none";
const P = (c: Cls, conf: number): { up: number; down: number; none: number } => {
  const rest = Math.floor((1000 - conf) / 2);
  const o = { up: rest, down: rest, none: rest };
  o[c] = 1000 - 2 * rest;
  return o;
};
interface Spec {
  families?: number;
  casesPerFamily?: number;
  observed: (i: number, f: number) => Cls;
  nt: (i: number, f: number, o: Cls) => LedgerRow["probs"];
  shuffled?: (i: number, f: number, o: Cls) => LedgerRow["probs"];
  prior?: (i: number, f: number, o: Cls) => LedgerRow["probs"];
  limited?: (i: number, f: number) => boolean;
}
function ledgerOf(s: Spec): LedgerRow[] {
  const F = s.families ?? 12, C = s.casesPerFamily ?? 6;
  const rows: LedgerRow[] = [];
  for (let f = 0; f < F; f++)
    for (let i = 0; i < C; i++) {
      const o = s.observed(i, f);
      const mk = (proposer: string, probs: LedgerRow["probs"]): LedgerRow => ({
        familyId: `c${f}`,
        caseId: `k${f}-${i}`,
        proposer,
        status: probs ? "answered" : "missing",
        predicted: probs ? (Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0] as Cls) : null,
        probs,
        observed: o,
        expected: o,
        measurementLimited: s.limited?.(i, f) ?? false,
      });
      rows.push(mk("numericTrend", s.nt(i, f, o)), mk("shuffledEvidence", (s.shuffled ?? (() => prior))(i, f, o)), mk("priorMajority", (s.prior ?? (() => prior))(i, f, o)));
    }
  return rows;
}
const cyc = (i: number): Cls => (["up", "down", "none"] as const)[i % 3];

describe("reading", () => {
  // numericTrend right with confidence on every case; the controls are poor.
  const good = (): Spec => ({ observed: (i) => cyc(i), nt: (i, _f, o) => P(o, 800), shuffled: (i) => P(cyc(i + 1), 800), prior: () => prior });
  it("POSITIVE when both intervals lie wholly below 0", () => {
    const r = confirmReading(ledgerOf(good()), prm);
    expect(r.overrides).toEqual([]);
    expect(r.label).toBe("POSITIVE");
    expect(r.comparisons.vsShuffledEvidence.interval!.hi).toBeLessThan(0);
    expect(r.comparisons.vsPriorMajority.interval!.hi).toBeLessThan(0);
  });
  it("NEGATIVE when numericTrend is overconfidently wrong: interval wholly above 0", () => {
    const l = ledgerOf({ observed: (i) => cyc(i), nt: (i) => P(cyc(i + 1), 900), shuffled: (i) => P(cyc(i + 1), 900), prior: () => prior });
    const r = confirmReading(l, prm);
    expect(r.label).toBe("NEGATIVE");
    expect(r.comparisons.vsPriorMajority.interval!.lo).toBeGreaterThan(0);
  });
  it("negative fixture fools a naive metric: high directional accuracy, still NEGATIVE by Brier; and an always-none predictor is degenerate, not POSITIVE", () => {
    const sure = (c: Cls): LedgerRow["probs"] => ({ up: c === "up" ? 998 : 1, down: c === "down" ? 998 : 1, none: c === "none" ? 998 : 1 });
    // 12 cases per family: 10 none, 1 up, 1 down. numericTrend says none (998) on the none cases and is confidently wrong on the other two.
    const obs = (i: number): Cls => (i === 10 ? "up" : i === 11 ? "down" : "none");
    const l = ledgerOf({ casesPerFamily: 12, observed: obs, nt: (i) => (i === 10 ? sure("down") : i === 11 ? sure("up") : sure("none")), shuffled: () => prior, prior: () => ({ up: 100, down: 100, none: 800 }) });
    const nt = l.filter((r) => r.proposer === "numericTrend");
    expect(new Set(nt.map((r) => r.predicted)).size).toBe(3);
    expect(nt.filter((r) => r.predicted === r.observed).length / nt.length).toBeGreaterThan(0.8);
    const r = confirmReading(l, prm);
    expect(r.overrides).toEqual([]);
    expect(r.comparisons.vsPriorMajority.interval!.lo).toBeGreaterThan(0);
    expect(r.label).toBe("NEGATIVE");
    // always none: high accuracy on a none-heavy set, but degenerate => UNINFORMATIVE by override, never POSITIVE
    const z = confirmReading(ledgerOf({ observed: () => "none", nt: () => sure("none"), shuffled: () => P("down", 800), prior: () => P("down", 800) }), prm);
    expect(z.label).toBe("UNINFORMATIVE");
    expect(z.overrides.join(" ")).toMatch(/degenerate/);
  });
  // numericTrend equals the prior except on i%3==0 cases, where it says up with {400,300,300}: better when the case is up (good family), worse when it is down.
  const mixed = (good: (f: number) => boolean, bad: LedgerRow["probs"]): Spec => ({ observed: (i, f) => (i % 3 === 0 ? (good(f) ? "up" : "down") : "none"), nt: (i, f) => (i % 3 !== 0 ? prior : good(f) ? { up: 400, down: 300, none: 300 } : bad), shuffled: () => prior, prior: () => prior });
  it("UNINFORMATIVE ('no improvement shown') when the point estimate is positive but the interval spans 0; a non-negative point estimate alone is never NEGATIVE", () => {
    const r = confirmReading(ledgerOf(mixed((f) => f % 2 === 0, { up: 800, down: 20, none: 180 })), prm);
    expect(r.overrides).toEqual([]);
    expect(r.comparisons.vsPriorMajority.interval!.mean).toBeGreaterThan(0);
    expect(r.comparisons.vsPriorMajority.interval!.lo).toBeLessThan(0);
    expect(r.label).toBe("UNINFORMATIVE");
    expect(r.suffix).toBe("no improvement shown");
  });
  it("UNINFORMATIVE ('improvement not supported') when the point estimate is negative but the interval reaches 0", () => {
    const r = confirmReading(ledgerOf(mixed((f) => f < 2, { up: 150, down: 230, none: 620 })), prm);
    expect(r.overrides).toEqual([]);
    expect(r.comparisons.vsPriorMajority.interval!.mean).toBeLessThan(0);
    expect(r.comparisons.vsPriorMajority.interval!.hi).toBeGreaterThan(0);
    expect(r.label).toBe("UNINFORMATIVE");
    expect(r.suffix).toBe("improvement not supported");
  });
  it("each override fires, and an override beats NEGATIVE", () => {
    const bad = (): Spec => ({ observed: (i) => cyc(i), nt: (i) => P(cyc(i + 1), 900), shuffled: (i) => P(cyc(i + 1), 900), prior: () => prior });
    expect(confirmReading(ledgerOf(bad()), prm).label).toBe("NEGATIVE");
    expect(confirmReading(ledgerOf({ ...bad(), families: 9 }), prm)).toMatchObject({ label: "UNINFORMATIVE", overrides: expect.arrayContaining([expect.stringMatching(/fewer than 10/)]) });
    expect(confirmReading(ledgerOf(bad()), { ...prm, status: "EXPLORATORY" })).toMatchObject({ label: "UNINFORMATIVE", overrides: expect.arrayContaining([expect.stringMatching(/not CONFIRM/)]) });
    // incomplete pairing: drop one shuffledEvidence row
    const l = ledgerOf(bad());
    const i = l.findIndex((r) => r.proposer === "shuffledEvidence");
    const cut = [...l.slice(0, i), ...l.slice(i + 1)];
    expect(confirmReading(cut, prm)).toMatchObject({ label: "UNINFORMATIVE", overrides: expect.arrayContaining([expect.stringMatching(/not identical/)]) });
    // invalid numericTrend prediction
    const inv = ledgerOf(bad()).map((r, k) => (r.proposer === "numericTrend" && k === 0 ? { ...r, status: "invalid" as const, probs: null, predicted: null } : r));
    expect(confirmReading(inv, prm)).toMatchObject({ label: "UNINFORMATIVE", overrides: expect.arrayContaining([expect.stringMatching(/invalid or missing/)]) });
    // invalid comparator prediction
    const invC = ledgerOf(bad()).map((r) => (r.proposer === "priorMajority" && r.caseId === "k0-0" ? { ...r, status: "invalid" as const, probs: null, predicted: null } : r));
    expect(confirmReading(invC, prm).overrides.join(" ")).toMatch(/priorMajority has 1 invalid/);
    // zero answered
    const zero = ledgerOf(bad()).map((r) => (r.proposer === "numericTrend" ? { ...r, status: "abstained" as const, probs: null, predicted: null } : r));
    expect(confirmReading(zero, prm).overrides.join(" ")).toMatch(/answered no test case/);
    // degenerate
    expect(confirmReading(ledgerOf({ ...bad(), nt: () => P("none", 900) }), prm).overrides.join(" ")).toMatch(/degenerate/);
    // more than 25% measurement-limited
    const lim = confirmReading(ledgerOf({ ...bad(), limited: (i) => i < 2 }), prm);
    expect(lim.label).toBe("UNINFORMATIVE");
    expect(lim.overrides.join(" ")).toMatch(/measurement-limited/);
    // exactly 25% is not over the limit
    expect(confirmReading(ledgerOf({ ...bad(), casesPerFamily: 8, limited: (i) => i < 2 }), prm).overrides.join(" ")).not.toMatch(/measurement-limited/);
    // a non-finite interval with >= 10 families fires that override alone
    const nan = ledgerOf(bad()).map((r) => (r.proposer === "numericTrend" ? { ...r, probs: { up: NaN, down: NaN, none: NaN } } : r));
    const nr = confirmReading(nan, prm);
    expect(nr.testFamilies).toBeGreaterThanOrEqual(10);
    expect(nr.label).toBe("UNINFORMATIVE");
    expect(nr.overrides.length).toBeGreaterThan(0);
    expect(nr.overrides.every((o) => /null or not finite/.test(o))).toBe(true);
    // withheld provenance is an override on its own
    const pv = confirmReading(ledgerOf(bad()), { ...prm, provenance: ["x"] });
    expect(pv.overrides).toEqual(["provenance: x"]);
    expect(pv.label).toBe("UNINFORMATIVE");
  });
  it("the sealed document recomputes from its ledger alone and the digest names both files", () => {
    const l = ledgerOf(good());
    const doc = buildConfirmation({ ...confirm, devPrior: prior, bootstrap: { resamples: 400, seed: 7 } } as Protocol, "CONFIRM", l);
    const again = confirmReading(JSON.parse(JSON.stringify(l)) as LedgerRow[], prm);
    expect(JSON.parse(canonical(doc.reading))).toEqual(JSON.parse(canonical(again)));
    expect(doc.failedPredictions).toEqual([]);
    expect(COMPARATORS.vsPriorMajority).toBe("priorMajority");
    expect(confirmDigest("a", "b")).toBe(`${sha256Text("a")}  confirmation.json\n${sha256Text("b")}  ledger.jsonl\n`);
  });
});

describe("the notebook", () => {
  it("report lists failed predictions first and shows CONFIRM status and the reading table", () => {
    const { p, built } = tinyPipeline();
    const read = (n: string): string => built.files[n];
    const lines = read("predictions.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const envelopes = read("envelopes.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const rows = read("outcomes.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const ledgerFake: LedgerRow[] = ledgerOf({ observed: (i) => cyc(i), nt: (i, f) => (f === 0 && i === 0 ? P("down", 900) : P(cyc(i), 900)), shuffled: (i) => P(cyc(i + 1), 800) });
    const doc = buildConfirmation({ ...p, devPrior: prior, bootstrap: { resamples: 200, seed: 3 } } as Protocol, "CONFIRM", ledgerFake);
    expect(doc.failedPredictions.length).toBeGreaterThan(0);
    const html = renderReport({ comparison: built.comparison, envelopes, lines, rows, minEffect: p.minEffect!, proposerIds: ["priorMajority", "numericTrend"], confirmation: doc });
    expect(html).toMatch(/Status: CONFIRM/);
    expect(html).toMatch(/Reading: (POSITIVE|NEGATIVE|UNINFORMATIVE)/);
    expect(html.indexOf("Failed predictions of numericTrend")).toBeGreaterThan(0);
    expect(html.indexOf("Failed predictions of numericTrend")).toBeLessThan(html.indexOf("<h2>Comparison</h2>"));
    expect(html.indexOf("Primary comparisons")).toBeLessThan(html.indexOf("<h2>Cases</h2>"));
    expect(html).not.toMatch(/<script|https?:\/\//i);
    // held-out test cases come before dev cases in the case list, failed predictions first within each
    const caseSplits = [...html.matchAll(/<small>family \S+, (dev|test)<\/small>/g)].map((m) => m[1]);
    expect(caseSplits.indexOf("test")).toBe(0);
    expect(caseSplits.lastIndexOf("test")).toBeLessThan(caseSplits.indexOf("dev"));
    // within the held-out group, numericTrend's failed cases come first (the cases the confirmation section lists)
    const arts = html.split('<article ').slice(1).filter((x) => /, test<\/small>/.test(x));
    const failed = arts.map((x) => /<li class="bad"><b>numericTrend<\/b>/.test(x));
    expect(failed.some(Boolean)).toBe(true);
    expect(failed.some((f) => !f)).toBe(true);
    expect(failed.indexOf(false)).toBeGreaterThan(failed.lastIndexOf(true));
    // the dev baseline line and table are labelled as having no role in decisions
    expect(html).not.toMatch(/Strongest simple baseline on dev/);
    expect(html).toMatch(/no role in any decision/);
    expect(html).toMatch(/\.banner\{/);
    // without a confirmation the report is the v0 notebook, with the v0 stylesheet byte for byte
    const v0Html = readFileSync(join(EXP, "v0/report.html"), "utf8");
    const style = (h: string): string => /<style>([\s\S]*?)<\/style>/.exec(h)![1];
    expect(style(renderReport({ comparison: built.comparison, envelopes, lines, rows, minEffect: p.minEffect!, proposerIds: ["priorMajority"] }))).toBe(style(v0Html));
    const plain = renderReport({ comparison: built.comparison, envelopes, lines, rows, minEffect: p.minEffect!, proposerIds: ["priorMajority"] });
    expect(plain).not.toMatch(/Status:/);
  });
});

describe.skipIf(!existsSync(join(EXP, "confirm-2026-11-02/confirmation.json")))("delivered confirm outputs", () => {
  const dir = join(EXP, "confirm-2026-11-02");
  it("is a CONFIRM run on the freeze-hash protocol, with a sealed reading that recomputes from the ledger", () => {
    const meta = readJson<{ status: string; protocolSha256: string; amendment: { sha256: string } }>(join(dir, "meta.json"));
    const doc = readJson<ReturnType<typeof buildConfirmation>>(join(dir, "confirmation.json"));
    const ledger = readFileSync(join(dir, "ledger.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerRow);
    expect(meta.status).toBe("CONFIRM");
    expect(doc.status).toBe("CONFIRM");
    expect(meta.protocolSha256).toBe(readFileSync(join(EXP, "protocol.confirm.freeze.sha256"), "utf8").trim());
    expect(doc.protocolSha256).toBe(meta.protocolSha256);
    expect(sha256Text(readFileSync(join(root, "docs/prediction-confirm-2026-11-02/AMENDMENT.md"), "utf8"))).toBe(meta.amendment.sha256);
    expect(doc.reading.testFamilies).toBeGreaterThanOrEqual(10);
    const recomputed = confirmReading(ledger, { devPrior: confirm.devPrior!, resamples: confirm.bootstrap.resamples, seed: confirm.bootstrap.seed, status: meta.status });
    expect(JSON.parse(canonical(recomputed))).toEqual(JSON.parse(canonical(doc.reading)));
    expect(readFileSync(join(dir, "confirm.sha256"), "utf8")).toBe(confirmDigest(readFileSync(join(dir, "confirmation.json"), "utf8"), readFileSync(join(dir, "ledger.jsonl"), "utf8")));
  });
});

describe("review fixes: coverage, digests, provenance", () => {
  const pipe = () => {
    const { p, built } = tinyPipeline();
    const parse = <T>(n: string): T[] => built.files[n].split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
    return { p, built, envelopes: parse<PredictionEnvelope>("envelopes.jsonl"), lines: parse<PredictionLine>("predictions.jsonl"), rows: parse<CaseRow>("outcomes.jsonl") };
  };
  it("the case inventory comes from the protocol, and buildLedger rejects a run with a family removed", () => {
    const { p, envelopes, lines, rows } = pipe();
    const inv = expectedCases(p);
    expect(inv.all).toHaveLength(p.families.length * p.mechanisms.length);
    expect(inv.test.length).toBe(splitPlanOf(p).test.length * p.mechanisms.length);
    expect(coverageProblems(p, envelopes, rows)).toEqual([]);
    const full = buildLedger(p, envelopes, lines, rows);
    expect(full.length).toBeGreaterThan(0);
    const gone = splitPlanOf(p).test[0];
    const cut = <T extends { familyId: string }>(xs: readonly T[]): T[] => xs.filter((x) => x.familyId !== gone);
    expect(() => buildLedger(p, cut(envelopes), lines, cut(rows))).toThrow(/does not cover the frozen case inventory/);
    expect(() => buildLedger(p, envelopes, lines, cut(rows))).toThrow(/outcome rows/);
    expect(() => buildLedger(p, cut(envelopes), lines, rows)).toThrow(/envelopes/);
    // and the families are still counted from the inventory, not from what was supplied
    expect(new Set(full.map((r) => r.familyId)).size).toBe(splitPlanOf(p).test.length);
  });
  it("canonical.sha256 is checked against the data files", () => {
    const { built } = pipe();
    const read = (n: string): string => built.files[n];
    expect(digestProblems(built.files["canonical.sha256"], read)).toEqual([]);
    const tampered = (n: string): string => (n === "outcomes.jsonl" ? read(n).replace(/"effect"/, '"effect "') : read(n));
    expect(digestProblems(built.files["canonical.sha256"], tampered)).toEqual(["outcomes.jsonl does not match canonical.sha256"]);
    expect(digestProblems("", read)).toHaveLength(6);
  });
  it("CONFIRM status needs amended-run provenance", () => {
    const text = readFileSync(join(EXP, "protocol.confirm.json"), "utf8");
    const freeze = readFileSync(join(EXP, "protocol.confirm.freeze.sha256"), "utf8");
    const good = () => ({ meta: { stage: "confirm", status: "CONFIRM", protocolSha256: protocolHash(confirm), gitDirty: false, amendment: { sha256: sha256Text("A") } }, snapshot: confirm, committed: { amendment: "A", protocol: text, freeze } });
    expect(provenanceProblems(good())).toEqual([]);
    // a default v0 confirm run: CONFIRM status, v0 snapshot, no amendment
    const v0run = { meta: { stage: "confirm", status: "CONFIRM", protocolSha256: protocolHash(v0), gitDirty: false }, snapshot: v0, committed: { amendment: null, protocol: null, freeze: null } };
    expect(provenanceProblems(v0run).join("\n")).toMatch(/no amendment provenance/);
    expect(provenanceProblems(v0run).join("\n")).toMatch(/not the reserved fresh-family recipe/);
    const dirty = good();
    dirty.meta.gitDirty = true;
    expect(provenanceProblems(dirty).join("\n")).toMatch(/uncommitted/);
    const other = good();
    other.committed.amendment = "B";
    expect(provenanceProblems(other).join("\n")).toMatch(/committed amendment does not match/);
    const smoke = good();
    smoke.meta.status = "SMOKE";
    expect(provenanceProblems(smoke).join("\n")).toMatch(/not a confirm-stage CONFIRM run/);
    const nofreeze = good();
    nofreeze.committed.freeze = "0".repeat(64);
    expect(provenanceProblems(nofreeze).join("\n")).toMatch(/freeze hash does not match/);
  });
  it("buildConfirmation withholds CONFIRM, and the notebook its held-out claim, when provenance fails", () => {
    const { p, built } = tinyPipeline();
    const l = ledgerOf({ observed: (i) => cyc(i), nt: (i, _f, o) => P(o, 800), shuffled: (i) => P(cyc(i + 1), 800) });
    const doc = buildConfirmation({ ...p, devPrior: prior, bootstrap: { resamples: 100, seed: 3 } } as Protocol, "CONFIRM", l, ["meta.json carries no amendment provenance"]);
    expect(doc.status).toBe("UNVERIFIED");
    expect(doc.reading.label).toBe("UNINFORMATIVE");
    expect(doc.reading.overrides.join(" ")).toMatch(/provenance:/);
    const rows = built.files["outcomes.jsonl"].split("\n").filter(Boolean).map((x) => JSON.parse(x));
    const envelopes = built.files["envelopes.jsonl"].split("\n").filter(Boolean).map((x) => JSON.parse(x));
    const html = renderReport({ comparison: built.comparison, envelopes, lines: [], rows, minEffect: p.minEffect!, proposerIds: [], confirmation: doc });
    expect(html).not.toMatch(/fixed in a committed amendment/);
    expect(html).toMatch(/Status: UNVERIFIED/);
  });
});
