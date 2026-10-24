// The M4b calibration rule (experiments/3d-slab/m4b-rule.ts) on synthetic results: validation, the three
// qualifying conditions at their integer edges, the pick order, and the neutral stage.
import { describe, expect, it } from "vitest";
import {
  CELLS, decide, expectedConfig, expectedInit, gridSettings, jobId, jobsFor, PLANE, seedVerdict, validate, neutralPasses,
  type Condition, type Job, type Result, type Setting,
} from "../3d-slab/m4b-rule.ts";

const GROUP = 2 * PLANE;
/** `living` spread over the 8 layers, every layer at most PLANE. */
const spread = (living: number) => Array.from({ length: 8 }, (_, z) => Math.floor(living / 8) + (z < living % 8 ? 1 : 0));
const flat = (living: number) => [1, 2, 3, 4, 5, 6, 7, living, living, living].map((v, i) => (i < 7 ? Math.max(1, Math.min(v, living)) : v));
function result(job: Job, o: Partial<Result> = {}): Result {
  const living = o.living ?? (o.livingByLayer ? o.livingByLayer.reduce((a, b) => a + b, 0) : 100_000);
  const r: Result = {
    id: job.id, condition: job.condition, neutral: job.condition === "neutral", presetId: "slab-spots",
    init: expectedInit(job) as Result["init"],
    cfg: JSON.parse(JSON.stringify(expectedConfig(job))),
    ruleVersion: 1, nutrient: job.nutrient, mu: job.mu, sigma: job.sigma, lightK: job.lightK, seed: job.seed,
    requestedSteps: 50_000, step: 50_000, extinctAt: null, living,
    livingTrace5k: flat(living), denseTrace5k: new Array(10).fill(10),
    lightLayerSum: [1000, 900, 800, 700, 600, 500, 400, 500], livingByLayer: spread(living),
    massByLayer: new Array(8).fill(1), activityByLayer: new Array(8).fill(7),
    matterOk: true, energyResidual: "0", ...o,
  };
  if (o.livingTrace5k === undefined && o.extinctAt == null) r.livingTrace5k = flat(living);
  if (o.livingByLayer === undefined) r.livingByLayer = spread(living);
  if (o.massByLayer === undefined) r.massByLayer = r.livingByLayer.map((v) => 30 * v);
  return r;
}
const extinctAt = (step: number): Partial<Result> => ({ extinctAt: step, step, living: 0, livingTrace5k: [...new Array(Math.floor(step / 5000)).fill(5)].map((v, i, a) => (i === a.length - 1 && step % 5000 === 0 ? 0 : v)), denseTrace5k: new Array(Math.floor(step / 5000)).fill(0) });
const job = (s: Setting, seed = 101, c: Condition = "treatment"): Job => ({ ...s, seed, condition: c, id: jobId(c, s, seed) });
const S: Setting = { nutrient: 16, mu: 30, sigma: 8, lightK: 64 };

/** Every evolving job, failing by default (extinct), with `over` replacing chosen settings' results. */
function grid(over: Map<string, (j: Job) => Result> = new Map()): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const j of jobsFor("treatment", gridSettings())) {
    const f = over.get(`${j.nutrient}/${j.mu}/${j.sigma}/${j.lightK}`);
    m.set(j.id, f ? f(j) : result(j, extinctAt(5000)));
  }
  return m;
}
const key = (s: Setting) => `${s.nutrient}/${s.mu}/${s.sigma}/${s.lightK}`;

describe("grid", () => {
  it("has 80 settings and 240 evolving jobs with condition and N in the id", () => {
    expect(gridSettings()).toHaveLength(80);
    const jobs = jobsFor("treatment", gridSettings());
    expect(jobs).toHaveLength(240);
    expect(new Set(jobs.map((j) => j.id)).size).toBe(240);
    expect(jobs[0].id).toBe("treatment-n8-mu30-s8-k64-seed101");
  });
});

describe("validate", () => {
  const j = job(S);
  it("accepts a well-formed result", () => expect(validate(result(j), j)).toEqual([]));
  it.each([
    ["condition", { condition: "neutral" as const }],
    ["neutral flag", { neutral: true }],
    ["rule version", { ruleVersion: 2 }],
    ["requested steps", { requestedSteps: 1000 }],
    ["conservation", { matterOk: false }],
    ["energy residual", { energyResidual: "3" }],
    ["nutrient", { nutrient: 12 }],
    ["init nutrient", { init: { kind: "slab-spots", founders: 8, nutrient: 32, biomass: 64 } }],
    ["short run", { step: 40_000, livingTrace5k: [1, 2, 3, 4, 5, 6, 7, 100_000], denseTrace5k: [1, 2, 3, 4, 5, 6, 7, 8] }],
    ["trace length", { livingTrace5k: [1, 2, 3] }],
    ["layer array", { livingByLayer: [1, 2, 3] }],
    ["non-integer", { activityByLayer: [1.5, 0, 0, 0, 0, 0, 0, 0] }],
    ["trace end", { livingTrace5k: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
    ["extinct but living", { extinctAt: 5000, step: 5000, livingTrace5k: [1], denseTrace5k: [1] }],
    ["layer above a plane", { livingByLayer: [65_537, 0, 0, 0, 0, 0, 0, 0], living: 65_537 }],
    ["layers not summing to living", { livingByLayer: spread(100_000), living: 99_999, livingTrace5k: flat(99_999) }],
    ["trace zero before the end", { livingTrace5k: [1, 2, 0, 4, 5, 6, 7, 100_000, 100_000, 100_000] }],
    ["extinct with a live last census", { ...extinctAt(10_000), livingTrace5k: [5, 5] }],
    ["extinction off a census step", { ...extinctAt(10_000), extinctAt: 10_500, step: 10_500 }],
    ["light sum above 255 per cell", { lightLayerSum: [255 * 65_536 + 1, 0, 0, 0, 0, 0, 0, 0] }],
  ])("refuses a wrong %s", (_, o) => expect(validate(result(j, o as Partial<Result>), j).length).toBeGreaterThan(0));
  it("refuses a cfg that disagrees with the job, including cfg.neutral", () => {
    const r = result(j);
    expect(validate({ ...r, cfg: { ...r.cfg, lightK: 256 } }, j).length).toBeGreaterThan(0);
    expect(validate({ ...r, cfg: { ...r.cfg, neutral: true } }, j).length).toBeGreaterThan(0);
    expect(validate({ ...r, cfg: { ...r.cfg, kPhoto: (r.cfg.kPhoto as number) + 1 } }, j).length).toBeGreaterThan(0);
    expect(validate({ ...r, cfg: { ...r.cfg, mutRate: 0 } }, j).length).toBeGreaterThan(0);
    expect(validate({ ...r, cfg: { ...r.cfg, extraKey: 1 } }, j).length).toBeGreaterThan(0);
    expect(validate({ ...r, init: { ...r.init, waste: 4 } }, j).length).toBeGreaterThan(0);
    const n = job(S, 101, "neutral");
    const rn = result(n);
    expect(validate(rn, n)).toEqual([]);
    expect(validate({ ...rn, cfg: { ...rn.cfg, neutral: undefined } }, n).length).toBeGreaterThan(0);
  });
  it("accepts an extinction as a result", () => {
    expect(validate(result(j, extinctAt(9000)), j)).toEqual([]);
    expect(validate(result(j, extinctAt(10_000)), j)).toEqual([]);
    expect(validate(result(j, extinctAt(4000)), j)).toEqual([]);
  });
  it("refuses junk", () => {
    expect(validate("unparseable", j).length).toBeGreaterThan(0);
    expect(validate(null, j).length).toBeGreaterThan(0);
  });
});

describe("seedVerdict", () => {
  const j = job(S);
  const lo = Math.ceil(CELLS / 100), hi = CELLS / 2; // 5,243 and 262,144
  it("living window edges are 1 % and 50 % inclusive", () => {
    expect(seedVerdict(result(j, { living: lo })).window).toBe(true);
    expect(seedVerdict(result(j, { living: lo - 1 })).window).toBe(false);
    expect(seedVerdict(result(j, { living: hi })).window).toBe(true);
    expect(seedVerdict(result(j, { living: hi + 1 })).window).toBe(false);
  });
  it("light window edges are 5 % and 80 % inclusive", () => {
    const at = (s7: number) => seedVerdict(result(j, { lightLayerSum: [1000, 0, 0, 0, 0, 0, 0, s7] })).window;
    expect([at(50), at(49), at(800), at(801)]).toEqual([true, false, true, false]);
    expect(seedVerdict(result(j, { lightLayerSum: [0, 0, 0, 0, 0, 0, 0, 0] })).window).toBe(false);
  });
  it("settled rejects M4's two rising nearest misses and accepts a flat trace", () => {
    const tr = (a: number, b: number, c: number) => [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, a, b, c].map((p) => Math.round(p * CELLS));
    const v = (t: number[]) => { const r = result(j, { living: t[9], livingTrace5k: t }); expect(validate(r, j)).toEqual([]); return seedVerdict(r).settled; };
    expect(v(tr(0.3336, 0.3913, 0.4396))).toBe(false);
    expect(v(tr(0.3726, 0.4127, 0.4487))).toBe(false);
    expect(v(tr(0.2, 0.21, 0.2))).toBe(true);
  });
  it("settled bounds: 5 points and the 0.8-1.25 ratio, both must hold; 40k and 45k in the window", () => {
    const v = (l40: number, l45: number, l50: number) => { const r = result(j, { living: l50, livingTrace5k: [1, 2, 3, 4, 5, 6, 7, l40, l45, l50] }); expect(validate(r, j)).toEqual([]); return seedVerdict(r).settled; };
    const pp5 = CELLS / 20; // 26,214.4
    expect(v(200_000, 200_000, 200_000 + Math.floor(pp5))).toBe(true);
    expect(v(200_000, 200_000, 200_000 + Math.ceil(pp5))).toBe(false);
    expect(v(10_000, 10_000, 12_500)).toBe(true); // ratio exactly 1.25
    expect(v(10_000, 10_000, 12_501)).toBe(false);
    expect(v(10_000, 10_000, 8_000)).toBe(true); // ratio exactly 0.8
    expect(v(10_000, 10_000, 7_999)).toBe(false);
    expect(v(lo - 1, 10_000, 10_000)).toBe(false);
    expect(v(10_000, hi + 1, 10_000)).toBe(false);
  });
  it("both ends need 1 % living (1,311 of 131,072) and activity in each group", () => {
    expect(Math.ceil(GROUP / 100)).toBe(1311);
    const ends = (lv: number[], act: number[] = new Array(8).fill(1)) => { const r = result(j, { livingByLayer: lv, activityByLayer: act }); expect(validate(r, j)).toEqual([]); return seedVerdict(r).ends; };
    expect(ends([700, 611, 0, 0, 0, 0, 1311, 0])).toBe(true);
    expect(ends([700, 610, 0, 0, 0, 0, 1311, 0])).toBe(false);
    expect(ends([1311, 0, 0, 0, 0, 0, 0, 1310])).toBe(false);
    expect(ends([5000, 0, 0, 0, 0, 0, 0, 5000], [0, 0, 9, 9, 9, 9, 1, 0])).toBe(false);
    expect(ends([5000, 0, 0, 0, 0, 0, 0, 5000], [0, 1, 9, 9, 9, 9, 0, 1])).toBe(true);
  });
  it("an extinct run fails everything", () => {
    const v = seedVerdict(result(j, extinctAt(5000)));
    expect(v.ok).toBe(false);
  });
});

describe("decide", () => {
  const ok = (living: number) => (j: Job) => result(j, { living });
  it("blocks on a file that is not a grid job, and on an invalid result", () => {
    const m = grid();
    m.set("mu30-s8-k256-seed101", {});
    expect(decide(m).decision.status).toBe("blocked");
    const m2 = grid();
    const id = jobId("treatment", S, 101);
    m2.set(id, { ...(m2.get(id) as Result), energyResidual: "1" });
    expect(decide(m2).decision.status).toBe("blocked");
  });
  it("is not final while an evolving result is missing", () => {
    const m = grid();
    m.delete(jobId("treatment", S, 102));
    const d = decide(m).decision;
    expect(d.status).toBe("incomplete");
  });
  it("none qualifies when every setting fails", () => expect(decide(grid()).decision.status).toBe("none-qualifies"));
  it("a setting qualifies only if all three seeds pass", () => {
    const m = grid(new Map([[key(S), (j: Job) => result(j, { living: j.seed === 103 ? 300_000 : 100_000 })]]));
    expect(decide(m).decision.status).toBe("none-qualifies");
  });
  it("orders by median living, then lightK, sigma, mu (smaller), nutrient (larger)", () => {
    const A: Setting = { nutrient: 8, mu: 30, sigma: 8, lightK: 64 };
    const B: Setting = { nutrient: 8, mu: 30, sigma: 8, lightK: 256 };
    const C: Setting = { nutrient: 8, mu: 30, sigma: 16, lightK: 256 };
    const Dd: Setting = { nutrient: 8, mu: 40, sigma: 16, lightK: 256 };
    const E: Setting = { nutrient: 24, mu: 30, sigma: 16, lightK: 256 };
    const F: Setting = { nutrient: 12, mu: 60, sigma: 8, lightK: 64 };
    const m = grid(new Map([[key(A), ok(100_000)], [key(B), ok(100_000)], [key(C), ok(100_000)], [key(Dd), ok(100_000)], [key(E), ok(100_000)], [key(F), ok(150_000)]]));
    const q = decide(m).qualifying.map((r) => `${r.nutrient}/${r.mu}/${r.sigma}/${r.lightK}`);
    expect(q).toEqual([key(F), key(E), key(C), key(Dd), key(B), key(A)]);
  });
  it("median is the middle seed", () => {
    const m = grid(new Map([[key(S), (j: Job) => result(j, { living: j.seed === 101 ? 10_000 : j.seed === 102 ? 200_000 : 50_000 })]]));
    expect(decide(m).qualifying[0].medianLiving).toBe(50_000);
  });
  it("asks for the first candidate's neutral runs, picks it if they pass, and moves on if not", () => {
    const A: Setting = { nutrient: 8, mu: 30, sigma: 8, lightK: 64 };
    const B: Setting = { nutrient: 12, mu: 30, sigma: 8, lightK: 64 };
    const m = grid(new Map([[key(A), ok(150_000)], [key(B), ok(100_000)]]));
    const d1 = decide(m).decision;
    expect(d1).toEqual({ status: "needs-neutral", candidate: A, jobs: [101, 102, 103].map((s) => jobId("neutral", A, s)) });
    for (const s of [101, 102, 103]) m.set(jobId("neutral", A, s), result(job(A, s, "neutral"), { living: 100_000 }));
    expect(decide(m).decision).toEqual({ status: "pick", pick: A, tried: [A] });
    m.set(jobId("neutral", A, 102), result(job(A, 102, "neutral"), { living: 5000 }));
    expect(decide(m).decision.status).toBe("needs-neutral");
    for (const s of [101, 102, 103]) m.set(jobId("neutral", B, s), result(job(B, s, "neutral"), { living: 100_000 }));
    expect(decide(m).decision).toEqual({ status: "pick", pick: B, tried: [A, B] });
  });
  it("a neutral seed with an empty end fails the candidate", () => {
    const j = job(S, 101, "neutral");
    expect(neutralPasses(result(j))).toBe(true);
    expect(neutralPasses(result(j, { livingByLayer: [5000, 5000, 0, 0, 0, 0, 0, 0] }))).toBe(false);
    expect(neutralPasses(result(j, { living: 5242 }))).toBe(false);
  });
  it("tries at most three candidates, then the neutral stage fails", () => {
    const cands: Setting[] = [8, 12, 16, 20].map((nutrient) => ({ nutrient, mu: 30, sigma: 8, lightK: 64 }));
    const m = grid(new Map(cands.map((c, i) => [key(c), ok(200_000 - i * 10_000)])));
    for (const c of cands) for (const s of [101, 102, 103]) m.set(jobId("neutral", c, s), result(job(c, s, "neutral"), { living: c.nutrient === 20 ? 100_000 : 1000 }));
    expect(decide(m).decision).toEqual({ status: "neutral-failed", tried: cands.slice(0, 3) });
  });
});
