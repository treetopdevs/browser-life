// tools/submit-picks.ts's input side: the loader it shares with tools/run.ts (tools/lib/pick-record.ts), its submit-only policy and the
// canonical log it sends (docs/archipelago-breed-2026-10-18.md, amendment 2026-11-02). The pond keeper fixtures all hold pressures or
// lesions and are the refusal cases; the picks-only session is the usable one. No GPU, no coordinator.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalPickLog, pickLogDigest, type RunSpec } from "@bl/runner";
import { loadPickRecord, submitRefusal } from "../lib/pick-record.ts";

const fixture = (name: string) => readFileSync(new URL(`../../tests/e2e/fixtures/${name}`, import.meta.url), "utf8");
const spec = (over: Partial<RunSpec> = {}): RunSpec => ({ experiment: "e", presetId: "breeder", condition: "treatment", seed: 1, steps: 15000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0, ...over });

class Died extends Error {}
const load = (text: string, s: RunSpec = spec(), extra: { scheduledCount?: number; founderOption?: boolean } = {}) => {
  const notes: string[] = [];
  const out = loadPickRecord(text, {
    file: "f",
    spec: s,
    scheduledCount: extra.scheduledCount ?? 0,
    founderOption: extra.founderOption ?? false,
    die: (m): never => {
      throw new Died(m);
    },
    note: (m) => notes.push(m),
  });
  return { ...out, notes };
};

describe("the picks-only session is submittable", () => {
  const text = fixture("picks-only-session.json");

  it("loads as a sparse (implicit) record of two non-rule picks, with no lab extras", () => {
    const { record, lab } = load(text);
    expect(record.implicit).toBe(true);
    expect(record.entries).toEqual([
      { step: 5000, cycle: 1, donors: [3, 9, 12, 0] },
      { step: 15000, cycle: 3, donors: [5, 12, 3, 1] },
    ]);
    expect(lab!.scheduled).toEqual([]);
    expect(lab!.pressures).toEqual([]);
    expect(submitRefusal(lab)).toBeNull();
  });

  it("the same input gives the same canonical log and digest twice, and a picks.jsonl of the same picks the same digest", () => {
    const one = canonicalPickLog(load(text).record.entries);
    const two = canonicalPickLog(load(text).record.entries);
    expect(one).toBe(two);
    const jsonl = load(text).record.entries.map((e) => JSON.stringify({ ...e, kind: "pick", by: "recorded", suggested: [0] }) + "\n").join("");
    expect(pickLogDigest(canonicalPickLog(load(jsonl).record.entries))).toBe(pickLogDigest(one));
    expect(load(jsonl).record.implicit).toBe(false);
  });
});

describe("the submit-only policy", () => {
  it("refuses a lab history with a lesion, naming it (the pond keeper session v3 has one)", () => {
    const { lab } = load(fixture("pond-keeper-session-v3.json"), spec({ deepEvery: 5 }));
    expect(submitRefusal(lab)).toMatch(/holds \d+ lesions? besides its picks/);
  });

  it("refuses pressures (v2), a feed and a sun, each by name, never silently dropped", () => {
    expect(submitRefusal(load(fixture("pond-keeper-session-v2.json"), spec({ deepEvery: 5 })).lab)).toMatch(/\d+ pressures?/);
    const m = JSON.parse(fixture("picks-only-session.json"));
    m.interventions.push({ step: 15000, kind: "sun", percent: 75, span: 100 });
    expect(submitRefusal(load(JSON.stringify(m)).lab)).toMatch(/1 sun besides its picks/);
  });

  it("refuses a picks.jsonl that also holds lesion, feed, sun or pressure lines, naming them", () => {
    const pick = JSON.stringify({ step: 5000, kind: "pick", cycle: 1, donors: [3, 9, 12, 0] });
    const extra = [
      { step: 6000, kind: "lesion", x: 1, y: 1, r: 2 },
      { step: 7000, kind: "feed", x: 1, y: 1, r: 2, amount: 5 },
      { step: 8000, kind: "sun", percent: 75, span: 100 },
      { step: 9000, kind: "pressure", cycle: 2, score: "mass" },
    ].map((e) => JSON.stringify(e));
    const text = [pick, ...extra].join("\n") + "\n";
    const { lab } = load(text);
    expect(lab).toBeUndefined();
    expect(submitRefusal(lab, text)).toMatch(/1 lesion, 1 feed, 1 sun, 1 pressure besides its picks/);
    expect(submitRefusal(lab, pick + "\n")).toBeNull();
  });

  it("the pond keeper fixture with a lesion on a scaf world is refused too", () => {
    const { lab } = load(fixture("pond-keeper-session.json"), spec({ presetId: "ponds-small", deepEvery: 5 }));
    expect(submitRefusal(lab)).toMatch(/1 lesion besides its picks/);
  });

  it("refuses a manifest of another seed, another preset, or a changed rule version, as tools/run.ts does", () => {
    const m = JSON.parse(fixture("picks-only-session.json"));
    expect(() => load(JSON.stringify(m), spec({ seed: 2 }))).toThrow(/does not describe this run: .*seed/);
    expect(() => load(JSON.stringify({ ...m, ruleVersion: 999 }))).toThrow(/ruleVersion/);
    expect(() => load(JSON.stringify({ ...m, startHash: "0".repeat(16) }))).toThrow(/start world has changed/);
    expect(() => load(JSON.stringify({ ...m, edgesFrom: 100 }))).toThrow(/observed only from step 100/);
  });

  it("refuses a lab manifest beside scheduled flags, as before", () => {
    expect(() => load(fixture("picks-only-session.json"), spec(), { scheduledCount: 1 })).toThrow(/cannot be combined with a lab run manifest/);
  });
});
