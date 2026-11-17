// Fixed, content-addressed pick logs (docs/archipelago-breed-2026-10-18.md, amendment 2026-11-02): the runner's narrowed
// refusal of a continuing picked run, the canonical log and its digest. No GPU: the refusals are thrown before any state is built.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRESETS, initWorld } from "@bl/schema";
import {
  appliedHistoryError,
  appliedPicksFromPonds,
  appliedPicksText,
  canonicalPickLog,
  mergePickLogs,
  parseCanonicalPickLog,
  parsePickLog,
  pickLogDigest,
  picksConsistencyError,
  picksPreflightError,
  runExperiment,
  sha256Hex,
  specConfig,
  validateSpec,
  verifiedPickLog,
  type PickEntry,
  type Picker,
  type RunSpec,
} from "@bl/runner";

const spec: RunSpec = { experiment: "fx", presetId: "breeder", condition: "treatment", seed: 1, steps: 5000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0, picked: true };
const cfg = specConfig(spec);
const start = { ...initWorld(cfg, PRESETS.find((p) => p.id === "breeder")!.init), step: 5000 };
const sink = { writeText: async () => {}, appendText: async () => {}, writeBytes: async () => {} };
const host = { host: "t", adapter: "t" };
const fakeDevice = {} as GPUDevice;
const entry = (cycle: number, donors: number[]): PickEntry => ({ step: cycle * 5000, cycle, donors });

describe("a picked run continuing from a checkpoint", () => {
  it("recorded-only picked run may take a start checkpoint; picker run still refuses it", async () => {
    const picker: Picker = { name: "p", pick: async () => [0] };
    await expect(runExperiment(fakeDevice, spec, sink, host, () => {}, { start, picker })).rejects.toThrow(/live picker cannot continue from a checkpoint/);
    await expect(runExperiment(fakeDevice, spec, sink, host, () => {}, { start, picker, picks: [] })).rejects.toThrow(/live picker cannot continue/);
    // Recorded picks with no picker pass the picked preflight (the entries here are for the window); the fake device then fails later, in the GPU.
    const err = await runExperiment(fakeDevice, spec, sink, host, () => {}, { start, picks: [entry(2, [1])], implicitRule: true }).catch((e: Error) => e);
    expect(String(err)).not.toMatch(/cannot continue|picked run needs|outside the run|boundary/);
  });

  it("picksPreflightError with startStep>0 slices to the window and rejects outside entries", () => {
    const c = { pondPeriod: 5000 };
    expect(picksPreflightError([entry(2, [1])], c, 5000, 5000, true)).toBeNull();
    expect(picksPreflightError([entry(1, [1])], c, 5000, 5000, true)).toMatch(/outside the run \(t=5000 to 10000\)/);
    expect(picksPreflightError([entry(3, [1])], c, 5000, 5000, true)).toMatch(/outside the run/);
    // Strict: the window's own boundary must be covered.
    expect(picksPreflightError([], c, 5000, 5000, false)).toMatch(/covers 0 of the run's 1 pond boundaries/);
  });

  it("a recorded picked run must still name a pond config, and an unpicked run takes no picks", async () => {
    await expect(runExperiment(fakeDevice, { ...spec, picked: undefined }, sink, host, () => {}, { picks: [] })).rejects.toThrow(/need spec.picked/);
    await expect(runExperiment(fakeDevice, spec, sink, host, () => {}, { picks: [entry(1, [1, 1])] })).rejects.toThrow(/does not name distinct ponds/);
  });
});

describe("validateSpec for pickLog and pickImplicit", () => {
  const good = "a".repeat(64);
  it("accepts pickLog with picked, optionally with pickImplicit", () => {
    expect(validateSpec({ ...spec, pickLog: good })).toEqual([]);
    expect(validateSpec({ ...spec, pickLog: good, pickImplicit: true })).toEqual([]);
  });
  it("refuses a malformed digest, pickLog without picked or beside pressures, and pickImplicit without pickLog", () => {
    expect(validateSpec({ ...spec, pickLog: "ABC" })).toContain("pickLog must be a 64-digit lowercase hex SHA-256");
    expect(validateSpec({ ...spec, picked: undefined, pickLog: good })).toContain("pickLog needs picked: true");
    expect(validateSpec({ ...spec, pickLog: good, pressures: [{ step: 0, cycle: 1, score: "mass" }] as never }).join()).toContain("a pick log cannot be combined with pressures");
    expect(validateSpec({ ...spec, pickImplicit: true })).toContain("pickImplicit needs pickLog");
    expect(validateSpec({ ...spec, pickLog: good, pickImplicit: false as never })).toContain("pickImplicit must be true or absent");
  });
});

describe("the canonical pick log", () => {
  const lab = [entry(1, [3, 9, 12, 0]), entry(3, [5, 12, 3, 1])];

  it("sha256Hex equals crypto.subtle across lengths that cross the padding boundaries", async () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 31 + n) & 255);
      const want = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
      expect(sha256Hex(bytes)).toBe(want);
    }
  });

  it("key order, no by/suggested, one line per pick: the same entries give the same bytes and digest", () => {
    const text = canonicalPickLog(lab);
    expect(text).toBe('{"step":5000,"kind":"pick","cycle":1,"donors":[3,9,12,0]}\n{"step":15000,"kind":"pick","cycle":3,"donors":[5,12,3,1]}\n');
    expect(pickLogDigest(text)).toBe(pickLogDigest(canonicalPickLog(lab.map((e) => ({ ...e })))));
    expect(pickLogDigest(text)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable under the merge of a picks.jsonl and a lab manifest's picks", () => {
    const fileText = lab.map((e) => JSON.stringify({ step: e.step, kind: "pick", cycle: e.cycle, donors: e.donors, by: "recorded", suggested: [9] }) + "\n").join("") + '{"step":20000,"kind":"failed","cycle":4,"by":"x","error":"e"}\n';
    const fromFile = { entries: parsePickLog(fileText), text: fileText };
    const fromLab = { entries: lab };
    for (const logs of [[fromFile, fromLab], [fromLab, fromFile], [fromFile], [fromLab]]) expect(canonicalPickLog(mergePickLogs(logs).entries)).toBe(canonicalPickLog(lab));
  });

  it("parses back to the entries, and refuses anything that is not canonical text", () => {
    const text = canonicalPickLog(lab);
    expect(parseCanonicalPickLog(text)).toEqual(lab);
    expect(parseCanonicalPickLog("")).toEqual([]);
    expect(() => parseCanonicalPickLog(text + '{"step":20000,"kind":"failed","cycle":4}\n')).toThrow(/not a pick/);
    expect(() => parseCanonicalPickLog(text.replace('"kind":"pick","cycle":1', '"cycle":1,"kind":"pick"'))).toThrow(/canonical form/);
    expect(() => parseCanonicalPickLog(text.trimEnd())).toThrow(/canonical form/);
    expect(() => parseCanonicalPickLog('{"step":15000,"kind":"pick","cycle":3,"donors":[1]}\n{"step":5000,"kind":"pick","cycle":1,"donors":[1]}\n')).toThrow(/in order/);
  });

  it("verifiedPickLog checks the digest first", () => {
    const text = canonicalPickLog(lab);
    expect(verifiedPickLog(text, pickLogDigest(text))).toEqual(lab);
    expect(() => verifiedPickLog(text, "0".repeat(64))).toThrow(/hashes to .*not the spec's/);
  });
});

describe("the applied history of a picked run", () => {
  const fx = (f: string) => readFileSync(new URL(`./fixtures/picked/${f}`, import.meta.url), "utf8");
  const ponds = fx("ponds.tsv");
  const applied = appliedPicksFromPonds(ponds, 1);

  it("is consistent with ponds.tsv (donor order included) once written as picks.jsonl", () => {
    const text = appliedPicksText(applied, [applied[0]]);
    expect(picksConsistencyError(text, ponds, 1)).toBeNull();
    expect(text.split("\n").filter(Boolean).map((l) => JSON.parse(l).by)).toEqual(["recorded", "rule(implicit)", "rule(implicit)"]);
  });

  it("a wrong seed or a swapped donor order is found by the consistency check, so the recovered order is not arbitrary", () => {
    const swapped = applied.map((e, i) => (i === 0 ? { ...e, donors: [e.donors[1], e.donors[0], ...e.donors.slice(2)] } : e));
    expect(picksConsistencyError(appliedPicksText(swapped, []), ponds, 1)).toMatch(/recipient \d+ took donor/);
  });

  it("appliedHistoryError: every input entry identical, every other boundary only when implicit", () => {
    expect(appliedHistoryError(applied, [applied[0]], true)).toBeNull();
    expect(appliedHistoryError(applied, [applied[0]], false)).toMatch(/strict/);
    expect(appliedHistoryError(applied, applied, false)).toBeNull();
    expect(appliedHistoryError(applied, [{ ...applied[0], donors: [3, 9, 0, 12] }], true)).toMatch(/applied donors \[3, 9, 12, 0\], the pick log says \[3, 9, 0, 12\]/);
  });
});
