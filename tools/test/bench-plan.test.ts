// The committed bench plan (experiments/naturalist/bench-v0-plan.json) against what its note says it is
// (docs/naturalist-bench-v0-2026-10-18.md, "Built" and amendment 1): it parses, its hash is the one cited, it is planned and not
// approved, every pure check passes, and its counts are the note's. Pure: no source bundle is read (the plan's paths are this
// machine's; `dry-run` re-derives it from its files). If this checkout's versions are not the plan's, the plan is void by its own
// rule and the test checks only that the gate refuses it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bodyProblems, parseManifest, runRefusal, versionRefusal } from "../lib/bench.ts";

const PLAN = fileURLToPath(new URL("../../experiments/naturalist/bench-v0-plan.json", import.meta.url));
const SHA = "a5d0c39a5187798a643835cf18102dde039028759817694993a167c5e183bad9";

describe("the committed bench v0 plan", () => {
  const m = parseManifest(readFileSync(PLAN, "utf8"));
  const kind = (x: { kind: string; amount?: number }) => (x.kind === "lesion" ? "lesion" : (x.amount ?? 0) > 0 ? "feed" : "drain");
  const tally = (role: string) => {
    const out: Record<string, number> = {};
    for (const e of m.body.entries.filter((x) => x.role === role)) for (const x of e.spec.interventions ?? []) out[kind(x)] = (out[kind(x)] ?? 0) + 1;
    return out;
  };
  it("parses, has the cited hash, and is planned with no approval", () => {
    expect(m.manifestSha256).toBe(SHA);
    expect(m.status).toBe("planned");
    expect(m.approval).toBeUndefined();
    expect(runRefusal(m)).toMatch(/^not approved/);
  });
  it("has the note's counts: 70 forks, 2,683,100 steps, 8 feeds and 2 drains chosen, the draws' kinds", () => {
    expect(m.body.totals).toEqual({ forks: 70, steps: 2_683_100, byRole: { rules: { forks: 10, steps: 383_300 }, count: { forks: 30, steps: 1_149_900 }, dose: { forks: 30, steps: 1_149_900 } } });
    expect(m.body.sources.map((s) => s.action).sort()).toEqual([...Array(2).fill("drain"), ...Array(8).fill("feed")]);
    expect(tally("dose")).toEqual({ drain: 16, feed: 4, lesion: 10 });
    expect(tally("count")).toEqual({ drain: 11, feed: 9, lesion: 10 });
    expect(m.body.sources.every((s) => /^[0-9a-f]{64}$/.test(s.seriesSha256) && /^[0-9a-f]{64}$/.test(s.lineagesSha256))).toBe(true);
  });
  it("passes every pure check under this checkout's versions, or is refused as void", () => {
    if (versionRefusal(m.body) === null) expect(bodyProblems(m.body)).toEqual([]);
    else expect(bodyProblems(m.body)[0]).toMatch(/other versions than this checkout's/);
  });
});
