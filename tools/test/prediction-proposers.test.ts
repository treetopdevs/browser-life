// Baseline proposers: validator-clean output, what each one ignores, the shuffled control's donor rules, the v0 adapter and the model seam.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bodySha256, canonical, proposalId, RULES, specHash } from "../lib/propose.ts";
import { draftProtocol } from "../lib/prediction/run.ts";
import { abstainAll, alwaysNone, fixedRule, fromRulesProposal, leadProbs, mechanismRule, numericTrend, priorMajority, shuffledEvidence, toPerMille, trendDirection, v0Rules } from "../lib/prediction/proposers.ts";
import { argmax, validatePrediction } from "../lib/prediction/validate.ts";
import { assignSplits, donorsFor } from "../lib/prediction/splits.ts";
import { DRAIN, FEED, LESION, SHAM, censusSeries, synthEnv } from "./prediction-helpers.ts";

const K = draftProtocol().proposers;
const envs = [LESION, FEED, DRAIN, SHAM].map((op, i) => synthEnv(op, { caseId: `c${i}`, census: censusSeries(1000, i - 1.5) }));

describe("proposers", () => {
  it("every baseline emits validator-clean output on every envelope", () => {
    const ps = [fixedRule(K.fixedRule), numericTrend(K.numericTrend), priorMajority({ up: 100, down: 200, none: 700 }), alwaysNone(), abstainAll(), v0Rules(K.v0Rules), mechanismRule(K.mechanismRule)];
    for (const p of ps) for (const e of envs) expect(validatePrediction(p.propose(e), e), `${p.id} on ${e.caseId}`).toEqual({ ok: true, errors: [] });
  });
  it("fixedRule follows the operation and ignores the census", () => {
    const p = fixedRule(K.fixedRule);
    const a = synthEnv(FEED, { census: censusSeries(1000, 5) }), b = synthEnv(FEED, { census: censusSeries(9, -3) });
    expect(p.propose(a).probs).toEqual(p.propose(b).probs);
    expect(p.propose(a).probs).toEqual({ up: 600, down: 200, none: 200 });
    expect(p.propose(synthEnv(LESION)).probs!.down).toBe(600);
    expect(p.propose(synthEnv(DRAIN)).probs!.down).toBe(600);
    expect(p.propose(synthEnv(SHAM)).probs!.none).toBe(600);
  });
  it("numericTrend ignores frames and the task", () => {
    const p = numericTrend(K.numericTrend);
    const a = synthEnv(FEED, { census: censusSeries(1000, 2) });
    const b = { ...synthEnv(LESION, { census: censusSeries(1000, 2) }), frames: [] };
    expect(p.propose(a).probs).toEqual(p.propose(b as never).probs);
    expect(trendDirection(censusSeries(1000, 2), 200, K.numericTrend)).toBe("up");
    expect(trendDirection(censusSeries(1000, -2), 200, K.numericTrend)).toBe("down");
    expect(trendDirection(censusSeries(1000, 0), 200, K.numericTrend)).toBe("none");
  });
  it("alwaysNone and priorMajority are valid forecasts; abstainAll abstains", () => {
    const e = envs[0];
    expect(alwaysNone().propose(e).probs).toEqual({ up: 0, down: 0, none: 1000 });
    expect(priorMajority({ up: 139, down: 208, none: 653 }).propose(e).probs).toEqual({ up: 139, down: 208, none: 653 });
    expect(abstainAll().propose(e).abstain).toBe(true);
  });
  it("leadProbs and toPerMille always sum to 1000", () => {
    for (const lead of [334, 500, 601, 999]) for (const d of ["up", "down", "none"] as const) {
      const p = leadProbs(d, lead);
      expect(p.up + p.down + p.none).toBe(1000);
      expect(p[d]).toBe(lead);
    }
    const q = toPerMille({ up: 1, down: 1, none: 1 });
    expect(q.up + q.down + q.none).toBe(1000);
  });
  it("the v0 rule proposer maps through fromRulesProposal (direction mass, remainder on none)", () => {
    const e = synthEnv(FEED);
    expect(v0Rules(K.v0Rules).propose(e).probs).toEqual({ up: 600, down: 0, none: 400 });
    expect(v0Rules(K.v0Rules).propose(synthEnv(SHAM)).probs).toEqual({ up: 0, down: 0, none: 1000 });
    expect(fromRulesProposal(e, { kind: "directional", statement: "s", direction: RULES.livingCells.high.direction }, 600).probs).toEqual({ up: 0, down: 600, none: 400 });
  });
  it("hashes of existing v0 helpers are unchanged by the additive export (values computed from the HEAD copy of propose.ts)", () => {
    expect(canonical({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    const body = { proposalVersion: 0, generator: "rules-v0", constants: { W: 50, burnInStep: 10000, horizon: 20000, threshold: 1, feedAmount: 64 }, ring: { index: 3, signal: "livingCells", label: "x", side: "low", D: 2.5, spread: 0.5 }, rule: { action: "feed", hypothesis: "h" }, fork: { step: 1000, check: "initHash", hash: "ab" }, interventionStep: 2000, replayThrough: 2000, argv: ["a", "b"], reason: "r", prediction: { kind: "directional", statement: "s", direction: "up" } } as never;
    expect(bodySha256(body)).toBe("b8f45c64a8b4264807ce939656d9db86f5431401b3b425801c18b05719745a0f");
    expect(proposalId(body)).toBe("b8f45c64a8b42648");
    const spec = { experiment: "naturalist-fork", presetId: "archipelago", condition: "neutral", seed: 1, steps: 100, censusEvery: 10 } as never;
    expect(specHash(spec)).toBe("9f1b5c26fb19ab465e92b9ff5a5a004fe9bd1606b7fd5a5463f18e83b35ee00f");
  });
});

describe("shuffledEvidence", () => {
  const plan = assignSplits(["fA", "fB", "fC", "fD", "fE", "fF"], "salt", 3, 1);
  const donors = donorsFor(plan, "salt");
  const byFam = new Map(plan.dev.concat(plan.test).map((f, i) => [f, synthEnv(FEED, { familyId: f, caseId: `d-${f}`, census: censusSeries(1000, i - 2) })]));
  const splitOf = (f: string) => (plan.dev.includes(f) ? "dev" : plan.test.includes(f) ? "test" : undefined) as "dev" | "test" | undefined;
  it("is deterministic, uses a different family of the same split, and equals numericTrend on the donor's census", () => {
    const p = shuffledEvidence(K.numericTrend, donors, (f) => byFam.get(f), splitOf);
    for (const [f, e] of byFam) {
      const d = donors[f];
      expect(d).not.toBe(f);
      expect(splitOf(d)).toBe(splitOf(f));
      expect(p.propose(e)).toEqual(p.propose(e));
      expect(p.propose(e).probs).toEqual(numericTrend(K.numericTrend).propose(byFam.get(d)!).probs);
    }
  });
  it("refuses a later window of the same history, and a donor from another split", () => {
    const own = synthEnv(FEED, { familyId: "fA", historyId: "fA:s1", caseId: "own" });
    const later = synthEnv(FEED, { familyId: "fZ", historyId: "fA:s1", caseId: "later" });
    const p = shuffledEvidence(K.numericTrend, { fA: "fZ" }, () => later, () => "dev");
    expect(() => p.propose(own)).toThrow(/same history/);
    const cross = shuffledEvidence(K.numericTrend, { fA: "fB" }, () => synthEnv(FEED, { familyId: "fB", caseId: "x" }), (f) => (f === "fA" ? "dev" : "test"));
    expect(() => cross.propose(own)).toThrow(/another split/);
    const same = shuffledEvidence(K.numericTrend, { fA: "fA" }, () => own, () => "dev");
    expect(() => same.propose(own)).toThrow(/same family/);
  });
});

describe("numericTrend vs shuffledEvidence on opposite trends", () => {
  // The delivered real run has every fixture world declining, so both predict "down" everywhere; this proves the harness CAN separate them.
  const rising = synthEnv(FEED, { familyId: "fR", caseId: "rise", census: censusSeries(1000, 2) });
  const falling = synthEnv(FEED, { familyId: "fF", caseId: "fall", census: censusSeries(1000, -2) });
  it("numericTrend says up on a rising census and down on a falling one", () => {
    expect(argmax(numericTrend(K.numericTrend).propose(rising).probs!)).toBe("up");
    expect(argmax(numericTrend(K.numericTrend).propose(falling).probs!)).toBe("down");
  });
  it("shuffledEvidence differs from numericTrend on at least one such pair, because it reads the donor's census", () => {
    const sh = shuffledEvidence(K.numericTrend, { fR: "fF", fF: "fR" }, (f) => (f === "fR" ? rising : falling), () => "test");
    const nt = numericTrend(K.numericTrend);
    expect(argmax(sh.propose(rising).probs!)).toBe("down");
    expect(argmax(sh.propose(falling).probs!)).toBe("up");
    const differs = [rising, falling].filter((e) => canonical(sh.propose(e).probs) !== canonical(nt.propose(e).probs));
    expect(differs.length).toBe(2);
  });
});

describe("module hygiene", () => {
  it("the model seam and the proposers import nothing outside the repo and no network API", () => {
    for (const f of ["model-seam.ts", "proposers.ts", "validate.ts", "score.ts"]) {
      const src = readFileSync(new URL(`../lib/prediction/${f}`, import.meta.url), "utf8");
      const mods = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const m of mods) expect(m.startsWith(".") || m.startsWith("@bl/"), `${f} imports ${m}`).toBe(true);
      expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|node:http|node:net/);
    }
  });
});
