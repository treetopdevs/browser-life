// The host validator (docs/prediction-envelope-2026-11-01/PLAN.md, section 3): what it accepts, what it rejects, and that a sham is no operation.
import { describe, expect, it } from "vitest";
import { validateInterventions } from "@bl/runner";
import { sealEnvelope, envelopeBody } from "../lib/prediction/envelope.ts";
import { adaptModelOutput, REGISTERED_ADAPTERS } from "../lib/prediction/model-seam.ts";
import { argmax, taskSchedule, validateEnvelope, validatePrediction, validatePredictionFile, type Prediction } from "../lib/prediction/validate.ts";
import { DRAIN, FEED, LESION, SHAM, synthEnv } from "./prediction-helpers.ts";

const good = (env = synthEnv(LESION)): Prediction => ({ version: 1, caseId: env.caseId, envelopeHash: env.envelopeHash, task: env.task, probs: { up: 100, down: 700, none: 200 }, abstain: false, reason: "r" });

describe("serialization stability", () => {
  const env = synthEnv(LESION);
  it("rejects an object whose required fields are inherited (it would serialize as {})", () => {
    const inherited = Object.create(good(env));
    expect(validatePrediction(inherited, env).ok).toBe(false);
    expect(JSON.stringify(inherited)).toBe("{}");
    const bareProto = Object.create(null);
    Object.assign(bareProto, good(env));
    expect(validatePrediction(bareProto, env).ok).toBe(true); // a null-prototype record is plain JSON data
  });
  it("rejects inherited probs, an inherited task, and a toJSON that changes what is stored", () => {
    const g = good(env);
    expect(validatePrediction({ ...g, probs: Object.create(g.probs!) }, env).ok).toBe(false);
    expect(validatePrediction({ ...g, task: Object.create(g.task) }, env).ok).toBe(false);
    const sneaky = { ...g, probs: { ...g.probs!, toJSON: () => ({ up: 0, down: 0, none: 1000 }) } };
    expect(validatePrediction(sneaky, env).ok).toBe(false);
    expect(validatePrediction({ ...g, reason: undefined }, env).ok).toBe(false);
  });
  it("rejects required fields that are own but hidden from JSON (non-enumerable), and getters", () => {
    const g = good(env);
    const hiddenCase = { ...g } as Record<string, unknown>;
    Object.defineProperty(hiddenCase, "caseId", { value: g.caseId, enumerable: false });
    expect(JSON.stringify(hiddenCase)).not.toContain("caseId");
    expect(validatePrediction(hiddenCase, env).ok).toBe(false);
    const hiddenProb = { up: 100, down: 700 } as Record<string, unknown>;
    Object.defineProperty(hiddenProb, "none", { value: 200, enumerable: false });
    expect(validatePrediction({ ...g, probs: hiddenProb }, env).ok).toBe(false);
    const getter = { ...g } as Record<string, unknown>;
    Object.defineProperty(getter, "reason", { get: () => "r", enumerable: true });
    expect(validatePrediction(getter, env).ok).toBe(false);
    expect(validatePrediction({ ...g, [Symbol("s")]: 1 }, env).ok).toBe(false);
  });
  it("a prediction that validates survives a JSON round trip unchanged", () => {
    const g = good(env);
    expect(JSON.parse(JSON.stringify(g))).toEqual(g);
  });
  it("validatePredictionFile counts an unsound envelope (stale hash) as invalid and lists it", () => {
    const tampered = { ...env, census: env.census.map((c, i) => (i === 0 ? { ...c, mass: c.mass + 1 } : c)) };
    const r = validatePredictionFile([JSON.stringify(good(env))], [tampered]);
    expect(r.badEnvelopes).toEqual([env.caseId]);
    expect(r.invalid).toBe(1);
    expect(r.byCase.get(env.caseId)!.prediction).toBeNull();
  });
});

describe("validatePrediction", () => {
  it("accepts menu lesion, feed, drain and sham tasks", () => {
    for (const op of [LESION, FEED, DRAIN, SHAM]) {
      const env = synthEnv(op);
      expect(validatePrediction(good(env), env)).toEqual({ ok: true, errors: [] });
    }
  });
  it("accepts an abstention without probs", () => {
    const env = synthEnv(LESION);
    const { probs: _p, ...rest } = good(env);
    void _p;
    expect(validatePrediction({ ...rest, abstain: true }, env).ok).toBe(true);
  });
  it.each([
    ["sum 999", { up: 100, down: 700, none: 199 }],
    ["sum 1001", { up: 100, down: 700, none: 201 }],
    ["float", { up: 100.5, down: 699.5, none: 200 }],
    ["negative", { up: -100, down: 900, none: 200 }],
    ["over 1000", { up: 0, down: 1001, none: -1 }],
    ["extra class", { up: 0, down: 500, none: 500, maybe: 0 }],
    ["missing class", { up: 500, down: 500 }],
  ])("rejects probs with %s", (_n, probs) => {
    const env = synthEnv(LESION);
    expect(validatePrediction({ ...good(env), probs }, env).ok).toBe(false);
  });
  it("rejects an abstention that carries probs, and missing probs without abstaining", () => {
    const env = synthEnv(LESION);
    expect(validatePrediction({ ...good(env), abstain: true }, env).ok).toBe(false);
    const { probs: _p, ...rest } = good(env);
    void _p;
    expect(validatePrediction({ ...rest, abstain: false }, env).ok).toBe(false);
  });
  it("rejects a task that differs in readout, intervention or time (the question is fixed)", () => {
    const env = synthEnv(LESION);
    expect(validatePrediction({ ...good(env), task: { ...env.task, readout: "livingCells" } }, env).ok).toBe(false);
    expect(validatePrediction({ ...good(env), task: { ...env.task, op: { kind: "none" } } }, env).ok).toBe(false);
    expect(validatePrediction({ ...good(env), task: { ...env.task, delta: 11 } }, env).ok).toBe(false);
    expect(validatePrediction({ ...good(env), task: { ...env.task, horizon: 100 } }, env).ok).toBe(false);
  });
  it("rejects extra keys, wrong caseId or hash, __proto__ keys and non-objects", () => {
    const env = synthEnv(LESION);
    expect(validatePrediction({ ...good(env), extra: 1 }, env).ok).toBe(false);
    expect(validatePrediction({ ...good(env), caseId: "other" }, env).ok).toBe(false);
    expect(validatePrediction({ ...good(env), envelopeHash: "0".repeat(64) }, env).ok).toBe(false);
    expect(validatePrediction(JSON.parse(`{"__proto__":{"x":1},"caseId":"${env.caseId}"}`), env).ok).toBe(false);
    expect(validatePrediction(JSON.parse(`{"constructor":1}`), env).ok).toBe(false);
    for (const bad of [null, 3, "x", [1]]) expect(validatePrediction(bad, env).ok).toBe(false);
  });
});

describe("tasks and the menu", () => {
  it("converts every non-sham operation to a schedule the runner validator accepts", () => {
    for (const op of [LESION, FEED, DRAIN]) {
      const t = taskSchedule(synthEnv(op));
      expect(t.errors).toEqual([]);
      expect(t.schedule).not.toBeNull();
      expect(validateInterventions(t.schedule)).toEqual([]);
      expect(t.schedule![0].step).toBe(310);
    }
    expect(taskSchedule(synthEnv(DRAIN)).schedule![0]).toMatchObject({ kind: "feed", amount: -64 });
  });
  it("maps the sham to no scheduled operation", () => {
    expect(taskSchedule(synthEnv(SHAM))).toEqual({ schedule: null, errors: [] });
  });
  it("does not offer a radius-0 lesion or a zero feed", () => {
    expect(taskSchedule(synthEnv({ kind: "lesion", x: 1, y: 1, r: 0 })).errors.length).toBeGreaterThan(0);
    expect(taskSchedule(synthEnv({ kind: "feed", x: 1, y: 1, r: 2, amount: 0 })).errors.length).toBeGreaterThan(0);
  });
  it("rejects out-of-menu operations, radii, amounts, times and centres", () => {
    expect(taskSchedule(synthEnv({ kind: "sun" as never })).errors.length).toBeGreaterThan(0);
    expect(taskSchedule(synthEnv({ kind: "lesion", x: 1, y: 1, r: 7 })).errors.length).toBeGreaterThan(0);
    expect(taskSchedule(synthEnv({ kind: "feed", x: 1, y: 1, r: 2, amount: 4097 })).errors.length).toBeGreaterThan(0);
    expect(taskSchedule(synthEnv({ kind: "lesion", x: 99, y: 1, r: 2 })).errors.length).toBeGreaterThan(0);
    expect(taskSchedule(synthEnv(LESION, { delta: 0 })).errors.length).toBeGreaterThan(0);
    expect(taskSchedule(synthEnv(LESION, { delta: 400 })).errors.length).toBeGreaterThan(0);
    expect(taskSchedule(synthEnv({ kind: "none", r: 3 })).errors.length).toBeGreaterThan(0);
    expect(taskSchedule(synthEnv({ kind: "lesion", x: 1, y: 1, r: 2, amount: 5 })).errors.length).toBeGreaterThan(0);
  });
  it("detects a tampered envelope", () => {
    const env = synthEnv(LESION);
    expect(validateEnvelope(env).ok).toBe(true);
    expect(validateEnvelope({ ...env, census: [...env.census.slice(1)] }).ok).toBe(false);
    void sealEnvelope;
    void envelopeBody;
  });
});

describe("argmax tie order", () => {
  it("breaks ties none > down > up", () => {
    expect(argmax({ up: 500, down: 500, none: 0 })).toBe("down");
    expect(argmax({ up: 334, down: 333, none: 333 })).toBe("up");
    expect(argmax({ up: 333, down: 333, none: 334 })).toBe("none");
    expect(argmax({ up: 0, down: 500, none: 500 })).toBe("none");
  });
});

describe("file-level checks and the model seam", () => {
  it("counts duplicate, missing and extra cases, and never repairs", () => {
    const a = synthEnv(LESION, { caseId: "cA" }), b = synthEnv(FEED, { caseId: "cB" });
    const lines = [JSON.stringify(good(a)), JSON.stringify(good(a)), JSON.stringify({ ...good(a), caseId: "zzz" }), "not json", "[1]"];
    const r = validatePredictionFile(lines, [a, b]);
    expect(r.duplicates).toEqual(["cA"]);
    expect(r.missing).toEqual(["cB"]);
    expect(r.extra).toEqual(["zzz"]);
    expect(r.notObject).toBe(2);
    expect(r.byCase.get("cA")!.prediction).toBeNull();
  });
  it("routes raw model output through the validator, rejecting out-of-menu output", () => {
    const env = synthEnv(LESION);
    expect(adaptModelOutput(JSON.stringify(good(env)), env).prediction).not.toBeNull();
    const other = { ...good(env), task: { ...env.task, op: { kind: "feed", x: 1, y: 1, r: 9, amount: 5 } } };
    expect(adaptModelOutput(other, env).prediction).toBeNull();
    expect(adaptModelOutput("{broken", env).validation.ok).toBe(false);
  });
  it("registers no adapter by default", () => {
    expect(REGISTERED_ADAPTERS).toHaveLength(0);
  });
});
