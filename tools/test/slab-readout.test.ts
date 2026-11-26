// The rung 1b readout rule (tools/lib/slab-readout.ts) on synthetic layers.tsv text: the group sums over the window, the
// exact bar, every branch of the decision including the undefined cases, ties, saturation and the input errors.
import { describe, expect, it } from "vitest";
import {
  CHECK_WINDOW,
  InputError,
  LAYERS_HEADER,
  EXTENSION_SEEDS,
  FIRST_SEEDS,
  PROTOCOL_CFG,
  PROTOCOL_INIT,
  checkBundleIdentity,
  checkDistinctHistories,
  decide,
  decisionJson,
  parseLayers,
  rat,
  ratAdd,
  ratCmp,
  ratDecimal,
  ratDiv,
  ratSub,
  ratStr,
  layersIncomplete,
  render,
  seedStats,
  windowSteps,
  type Decision,
  type SeedStats,
} from "../lib/slab-readout.ts";

interface Counts {
  photo: number;
  grow: number;
  decomp: number;
  resp: number;
  sat?: number;
}
const zero: Counts = { photo: 0, grow: 0, decomp: 0, resp: 0 };

/** layers.tsv text: `layers` (z -> counts) at every window step; `decoy` fills layers 2-5 and extra steps outside the window. */
function layersFor(layers: Record<number, Counts>, opt: { decoy?: boolean; steps?: number[]; omit?: [number, number][] } = {}): string {
  const steps = opt.steps ?? windowSteps(CHECK_WINDOW);
  const rows: string[] = [LAYERS_HEADER];
  const row = (step: number, z: number, c: Counts) => rows.push(`${step}\t${z}\t${c.photo}\t${c.grow}\t${c.decomp}\t${c.resp}\t${c.sat ?? 0}`);
  const omitted = (step: number, z: number) => (opt.omit ?? []).some(([s, y]) => s === step && y === z);
  for (const step of [...(opt.decoy ? [1000, 290_000] : []), ...steps])
    for (let z = 0; z < 8; z++) {
      if (omitted(step, z)) continue;
      const outside = !steps.includes(step);
      const c = outside ? { photo: 777777, grow: 1, decomp: 2, resp: 3 } : layers[z] ?? (opt.decoy && z >= 2 && z <= 5 ? { photo: 999999, grow: 888888, decomp: 777777, resp: 666666 } : zero);
      row(step, z, c);
    }
  return rows.join("\n") + "\n";
}
const manifest = (extra: Record<string, unknown> = {}) => ({
  summary: { steps: 300_000 },
  spec: { censusEvery: 1000, deepEvery: 1 },
  cfg: { tileW: 256, tileH: 256, tileD: 8 },
  ...extra,
});
/** Both top layers hold `topPct` photo out of 100 counts, both bottom layers `botPct`: shares topPct/100 and botPct/100 whatever the window. */
function seed(topPct: number, botPct: number, o: { sat?: number; decoy?: boolean } = {}): SeedStats {
  const t: Counts = { photo: topPct, grow: 100 - topPct, decomp: 0, resp: 0, sat: o.sat };
  const b: Counts = { photo: botPct, grow: 100 - botPct, decomp: 0, resp: 0 };
  return seedStats(layersFor({ 0: t, 1: t, 6: b, 7: b }, { decoy: o.decoy }), manifest());
}
const empty = (which: "top" | "bottom"): SeedStats => {
  const full: Counts = { photo: 50, grow: 50, decomp: 0, resp: 0 };
  return seedStats(layersFor(which === "top" ? { 6: full, 7: full } : { 0: full, 1: full }), manifest());
};
const arm = (pairs: [number, number][], first = 1): Map<number, SeedStats> => new Map(pairs.map(([t, b], k) => [first + k, seed(t, b)]));
const merge = (a: Map<number, SeedStats>, b: Map<number, SeedStats>) => new Map([...a, ...b]);
const NEUTRAL0: [number, number][] = [[50, 50], [50, 50], [50, 50]]; // D = 0, m = 0, r = 0, bar 0
const HIGH: [number, number][] = [[70, 50], [75, 50], [80, 50]];
const LOW: [number, number][] = [[50, 50], [49, 50], [50, 50]];
const D = (d: Decision) => d.verdict;

describe("exact rationals", () => {
  it("compares by cross-multiplication and prints exact decimals", () => {
    expect(ratCmp(rat(1n, 3n), rat(2n, 6n))).toBe(0);
    expect(ratStr(rat(2n, 6n))).toBe("1/3");
    expect(ratStr(rat(-1n, -3n))).toBe("1/3");
    expect(ratDecimal(rat(1n, 3n))).toBe("0.333333");
    expect(ratDecimal(rat(-1n, 8n), 2)).toBe("-0.13");
    expect(ratDecimal(rat(0n), 3)).toBe("0.000");
    expect(ratStr(ratDiv(ratAdd(rat(1n, 100n), rat(2n, 100n)), 3n))).toBe("1/100");
  });
  it("two D equal as rationals but not as floats compare equal", () => {
    expect(0.3 - 0.1).not.toBe(0.2);
    expect(seed(30, 10).D).toEqual(rat(1n, 5n));
    expect(ratCmp(seed(30, 10).D!, seed(40, 20).D!)).toBe(0);
  });
});

describe("parseLayers and seedStats", () => {
  it("sums each group over the ten censuses and the group's layers only", () => {
    const s = seedStats(layersFor({ 0: { photo: 3, grow: 1, decomp: 0, resp: 0 }, 1: { photo: 5, grow: 0, decomp: 1, resp: 2 }, 6: { photo: 1, grow: 2, decomp: 3, resp: 4 }, 7: { photo: 0, grow: 0, decomp: 0, resp: 1 } }, { decoy: true }), manifest());
    expect(s.top).toMatchObject({ photo: 80n, grow: 10n, decomp: 10n, resp: 20n, total: 120n });
    expect(s.bottom).toMatchObject({ photo: 10n, grow: 20n, decomp: 30n, resp: 50n, total: 110n });
    expect(s.shareTop).toEqual(rat(80n, 120n));
    expect(s.shareBottom).toEqual(rat(10n, 110n));
    expect(s.D).toEqual(ratSub(rat(80n, 120n), rat(10n, 110n)));
  });
  it("is not moved by layers 2-5 or by censuses outside the window", () => {
    const clean = seed(60, 40), noisy = seed(60, 40, { decoy: true });
    expect(noisy).toEqual(clean);
  });
  it("leaves D undefined when a group's total is zero", () => {
    const e = empty("top");
    expect(e.shareTop).toBeUndefined();
    expect(e.shareBottom).toEqual(rat(1n, 2n));
    expect(e.D).toBeUndefined();
    expect(empty("bottom").D).toBeUndefined();
  });
  it("counts saturated fields per group and over all layers", () => {
    const s = seedStats(layersFor({ 0: { photo: 1, grow: 1, decomp: 0, resp: 0, sat: 2 }, 3: { photo: 1, grow: 0, decomp: 0, resp: 0, sat: 5 }, 6: { photo: 1, grow: 1, decomp: 0, resp: 0, sat: 1 }, 7: zero }), manifest());
    expect(s.top.saturated).toBe(20n);
    expect(s.bottom.saturated).toBe(10n);
    expect(s.all.saturated).toBe(80n);
    expect(s.top.fields).toBe(10n * 2n * 65536n * 4n);
    expect(s.all.fields).toBe(10n * 8n * 65536n * 4n);
  });
  it("accepts a shorter window for a rehearsal", () => {
    const w = { finalStep: 3000, censuses: 3 };
    const c: Counts = { photo: 1, grow: 1, decomp: 0, resp: 0 };
    const text = layersFor({ 0: c, 1: c, 6: c, 7: c }, { steps: windowSteps(w) });
    const m = manifest({ summary: { steps: 3000 } });
    expect(seedStats(text, m, w).D).toEqual(rat(0n));
    expect(() => seedStats(text, m)).toThrow(InputError);
  });
});

describe("input errors are not verdicts", () => {
  const good = layersFor({ 0: { photo: 1, grow: 1, decomp: 0, resp: 0 } });
  it("refuses a census missing from the window, a missing layer, a repeat and a bad header", () => {
    expect(() => seedStats(layersFor({}, { steps: windowSteps(CHECK_WINDOW).slice(1) }), manifest())).toThrow(/no census at step 291000/);
    expect(() => seedStats(layersFor({}, { omit: [[295_000, 4]] }), manifest())).toThrow(/no layer 4 at step 295000/);
    expect(() => seedStats(good + "300000\t3\t1\t1\t1\t1\t0\n", manifest())).toThrow(/appears twice/);
    expect(() => seedStats(good.replace("step", "Step"), manifest())).toThrow(/header/);
    expect(() => parseLayers(LAYERS_HEADER + "\n1\t2\t3\n")).toThrow(InputError);
    expect(() => parseLayers(LAYERS_HEADER + "\n1\t9\t0\t0\t0\t0\t0\n")).toThrow(/out of range/);
    expect(() => parseLayers(LAYERS_HEADER + "\n1\t1\t-3\t0\t0\t0\t0\n")).toThrow(InputError);
  });
  it("refuses a manifest that is not a finished 300,000-step, census-1000, deep-1, 8-layer run", () => {
    expect(() => seedStats(good, manifest({ summary: { steps: 299_000 } }))).toThrow(/summary.steps is 299000/);
    expect(() => seedStats(good, manifest({ summary: null }))).toThrow(/did not finish/);
    expect(() => seedStats(good, manifest({ spec: { censusEvery: 1000, deepEvery: 2 } }))).toThrow(/deepEvery/);
    expect(() => seedStats(good, manifest({ spec: { censusEvery: 500, deepEvery: 1 } }))).toThrow(/censusEvery/);
    expect(() => seedStats(good, manifest({ cfg: { tileW: 256, tileH: 256, tileD: 4 } }))).toThrow(/tileD/);
    expect(() => seedStats(good, null)).toThrow(InputError);
  });
  it("turns malformed dimensions into InputError, not a RangeError", () => {
    const m = (cfg: Record<string, unknown>) => manifest({ cfg });
    for (const cfg of [{ tileD: 8 }, { tileD: 8, tileH: 256 }, { tileD: 8, tileW: "256", tileH: 256 }, { tileD: 8, tileW: 256.5, tileH: 256 }, { tileD: 8, tileW: 0, tileH: 256 }, { tileD: 8, tileW: -1, tileH: 256 }, { tileD: 8, tileW: 1e300, tileH: 256 }, { tileD: 8, tileW: null, tileH: 256 }])
      expect(() => seedStats(good, m(cfg)), JSON.stringify(cfg)).toThrow(InputError);
  });
  it("needs seeds 1-3 in both arms", () => {
    expect(() => decide({ evolving: arm(HIGH.slice(0, 2)), neutral: arm(NEUTRAL0) })).toThrow(/evolving arm has no seed 3/);
    expect(() => decide({ evolving: arm(HIGH), neutral: new Map() })).toThrow(/neutral arm has no seed 1/);
  });
});

describe("the decision", () => {
  it("3 of 3: go in phase 1, and seeds 4-6 are listed unused even when they would fail", () => {
    const d = decide({ evolving: merge(arm(HIGH), arm(NEUTRAL0, 4)), neutral: merge(arm(NEUTRAL0), arm(NEUTRAL0, 4)) });
    expect(D(d)).toBe("go");
    expect(d.phase1.outcome).toBe("go");
    expect(d.phase2).toBeUndefined();
    expect(d.unused.length).toBe(6);
    expect(d.evolving.map((j) => j.seed)).toEqual([1, 2, 3]);
    expect(d.reason).toMatch(/go to rung 2/);
  });
  it("0 of 3: pause, depth did nothing beyond the light", () => {
    const d = decide({ evolving: arm(LOW), neutral: arm(LOW) });
    expect(D(d)).toBe("pause");
    expect(d.reason).toMatch(/depth did nothing beyond the light/);
    expect(d.phase1.passes).toBe(0);
  });
  it("1 or 2 of 3 with no extension: extend, waiting for seeds 4-6", () => {
    const two = decide({ evolving: arm([[70, 50], [75, 50], [50, 50]]), neutral: arm(NEUTRAL0) });
    expect(D(two)).toBe("extend: waiting for seeds");
    expect(two.phase1.outcome).toBe("extend");
    expect(two.phase1.passes).toBe(2);
    expect(two.waitingFor?.length).toBe(6);
    const one = decide({ evolving: merge(arm([[70, 50], [50, 50], [50, 50]]), new Map([[4, seed(70, 50)]])), neutral: merge(arm(NEUTRAL0), new Map([[4, seed(50, 50)], [5, seed(50, 50)]])) });
    expect(D(one)).toBe("extend: waiting for seeds");
    expect(one.waitingFor?.map((w) => `${w.arm}${w.seed}`).sort()).toEqual(["evolving5", "evolving6", "neutral6"]);
  });
  const TWO: [number, number][] = [[70, 50], [75, 50], [50, 50]];
  it("extension: 5 of 6 under the recomputed bar is go, 4 of 6 is pause", () => {
    const neutral = merge(arm(NEUTRAL0), arm(NEUTRAL0, 4));
    expect(D(decide({ evolving: merge(arm(TWO), arm([[70, 50], [70, 50], [70, 50]], 4)), neutral }))).toBe("go"); // 2 + 3 = 5
    const four = decide({ evolving: merge(arm(TWO), arm([[70, 50], [70, 50], [50, 50]], 4)), neutral }); // 2 + 2 = 4
    expect(D(four)).toBe("pause");
    expect(four.phase2?.passes).toBe(4);
    const five = decide({ evolving: merge(arm(TWO), arm([[70, 50], [70, 50], [70, 50]], 4)), neutral });
    expect(five.phase2?.passes).toBe(5);
    expect(five.neutral.length).toBe(6);
    expect(five.bar?.seeds).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("extension: the bar is recomputed, and seeds 1-3 are re-judged against it", () => {
    // Phase 1 bar is 0 (neutral 1-3 all D = 0): seeds 1-3 pass with D = 0.20 / 0.25, seed 3 fails. The extension's neutral seeds
    // are wide (D = 0, 0.30, -0.10 -> range 0.4 over all six), so the six-seed bar is above 0.25 and seeds 1-2 now fail.
    const neutral = merge(arm(NEUTRAL0), arm([[50, 50], [80, 50], [40, 50]], 4));
    const evolving = merge(arm([[70, 50], [75, 50], [50, 50]]), arm([[95, 50], [95, 50], [95, 50]], 4));
    const d = decide({ evolving, neutral });
    expect(d.phase1.passes).toBe(2);
    expect(d.phase2!.passes).toBe(3); // only the three 0.45 seeds clear m + r = 0.4 + (0.3 - 0.1) / 6
    expect(D(d)).toBe("pause");
    expect(d.evolving.filter((j) => j.pass).map((j) => j.seed)).toEqual([4, 5, 6]);
    const m = ratDiv(ratAdd(ratAdd(rat(0n), rat(30n, 100n)), rat(-10n, 100n)), 6n);
    expect(ratCmp(d.bar!.m, m)).toBe(0);
    expect(ratCmp(d.bar!.r, rat(40n, 100n))).toBe(0);
  });
  it("extension waiting: seeds 4-6 absent or only partly present", () => {
    const evolving = arm(TWO);
    expect(D(decide({ evolving, neutral: arm(NEUTRAL0) }))).toBe("extend: waiting for seeds");
    const partial = decide({ evolving: merge(evolving, arm(HIGH.slice(0, 2), 4)), neutral: merge(arm(NEUTRAL0), arm(NEUTRAL0, 4)) });
    expect(D(partial)).toBe("extend: waiting for seeds");
    expect(partial.waitingFor).toEqual([{ arm: "evolving", seed: 6 }]);
  });
  it("an undefined evolving D fails that seed: 2 of 3 is extend, never go; all three undefined is 0 of 3", () => {
    const withHole = new Map(arm(HIGH));
    withHole.set(2, empty("top"));
    const d = decide({ evolving: withHole, neutral: arm(NEUTRAL0) });
    expect(d.phase1.outcome).toBe("extend");
    expect(d.phase1.passes).toBe(2);
    expect(D(d)).toBe("extend: waiting for seeds");
    expect(d.evolving[1].pass).toBe(false);
    const bottomHole = new Map(arm(HIGH));
    bottomHole.set(3, empty("bottom"));
    expect(decide({ evolving: bottomHole, neutral: arm(NEUTRAL0) }).phase1.passes).toBe(2);
    const none = new Map([[1, empty("top")], [2, empty("bottom")], [3, empty("top")]]);
    const z = decide({ evolving: none, neutral: arm(NEUTRAL0) });
    expect(D(z)).toBe("pause");
    expect(z.phase1.passes).toBe(0);
  });
  it("an undefined evolving D in the extension fails that seed too", () => {
    const neutral = merge(arm(NEUTRAL0), arm(NEUTRAL0, 4));
    const ext = new Map(arm([[70, 50], [70, 50], [70, 50]], 4));
    ext.set(6, empty("top"));
    const d = decide({ evolving: merge(arm([[70, 50], [75, 50], [50, 50]]), ext), neutral });
    expect(d.phase2!.passes).toBe(4); // 1, 2, 4, 5
    expect(D(d)).toBe("pause");
  });
  it("an undefined neutral D in seeds 1-3 is 'pause: control undefined', even with every evolving seed far above any bar and with seeds 4-6 present", () => {
    for (const hole of [empty("top"), empty("bottom")]) {
      const neutral = new Map(arm(NEUTRAL0));
      neutral.set(2, hole);
      const d = decide({ evolving: merge(arm([[100, 0], [100, 0], [100, 0]]), arm(HIGH, 4)), neutral: merge(neutral, arm(NEUTRAL0, 4)) });
      expect(D(d)).toBe("pause: control undefined");
      expect(d.phase1.outcome).toBe("pause: control undefined");
      expect(d.bar).toBeUndefined();
    }
  });
  it("an undefined neutral D only in seeds 4-6 pauses the extension", () => {
    const neutral = merge(arm(NEUTRAL0), arm(NEUTRAL0, 4));
    neutral.set(5, empty("bottom"));
    const d = decide({ evolving: merge(arm([[70, 50], [75, 50], [50, 50]]), arm(HIGH, 4)), neutral });
    expect(D(d)).toBe("pause: control undefined");
    expect(d.phase1.outcome).toBe("extend");
    // ... and it does not matter when phase 1 settles the matter alone
    const go = decide({ evolving: arm(HIGH), neutral });
    expect(D(go)).toBe("go");
  });
  it("an undefined neutral D in a finished extension seed pauses at once, while other extension seeds are still missing", () => {
    const evolving = arm([[70, 50], [75, 50], [50, 50]]); // 2 of 3: extend
    for (const hole of [empty("top"), empty("bottom")]) {
      for (const present of [[4], [5], [6], [4, 6]]) {
        const neutral = merge(arm(NEUTRAL0), new Map(present.map((n) => [n, n === present[0] ? hole : seed(50, 50)] as const)));
        const d = decide({ evolving, neutral });
        expect(D(d), `present ${present}`).toBe("pause: control undefined");
        expect(d.bar).toBeUndefined();
        expect(d.phase1.outcome).toBe("extend");
        expect(d.waitingFor).toBeUndefined();
      }
    }
    // a defined extension neutral seed alone still waits
    expect(D(decide({ evolving, neutral: merge(arm(NEUTRAL0), arm([[50, 50]], 4)) }))).toBe("extend: waiting for seeds");
    // and when phase 1 settles it, an undefined extension seed is not consulted
    const nb = merge(arm(NEUTRAL0), new Map([[4, empty("top")]]));
    expect(D(decide({ evolving: arm(HIGH), neutral: nb }))).toBe("go");
    expect(D(decide({ evolving: arm(LOW), neutral: nb }))).toBe("pause");
  });
  it("D == m + r does not pass (strict); one photo count more does", () => {
    // neutral D = 0, 0.03, 0 -> m = 0.01, r = 0.03, m + r = 0.04 exactly
    const neutral = arm([[50, 50], [53, 50], [50, 50]]);
    const tie = decide({ evolving: arm([[54, 50], [54, 50], [54, 50]]), neutral });
    expect(ratCmp(tie.bar!.threshold, rat(4n, 100n))).toBe(0);
    expect(D(tie)).toBe("pause");
    expect(tie.phase1.passes).toBe(0);
    const over = decide({ evolving: arm([[55, 50], [54, 50], [55, 50]]), neutral });
    expect(over.phase1.passes).toBe(2);
    expect(D(decide({ evolving: arm([[55, 50], [55, 50], [55, 50]]), neutral }))).toBe("go");
    // a count more at the margin: D = 0.04 + epsilon through the raw counts
    const t: Counts = { photo: 541, grow: 459, decomp: 0, resp: 0 }; // 0.541 vs bottom 0.5: D = 0.041 > 0.04
    const b: Counts = { photo: 500, grow: 500, decomp: 0, resp: 0 };
    const s = seedStats(layersFor({ 0: t, 1: t, 6: b, 7: b }), manifest());
    expect(ratCmp(s.D!, rat(4n, 100n))).toBeGreaterThan(0);
  });
  it("m with k = 3 and k = 6 is exact", () => {
    const d3 = decide({ evolving: arm(HIGH), neutral: arm([[51, 50], [51, 50], [52, 50]]) });
    expect(ratStr(d3.bar!.m)).toBe("1/75"); // (1 + 1 + 2) / 100 / 3
    expect(ratStr(d3.bar!.r)).toBe("1/100");
    const d6 = decide({ evolving: merge(arm(TWO), arm(HIGH, 4)), neutral: merge(arm([[51, 50], [51, 50], [52, 50]]), arm([[50, 50], [50, 50], [53, 50]], 4)) });
    expect(ratStr(d6.bar!.m)).toBe("7/600"); // (1 + 1 + 2 + 0 + 0 + 3) / 100 / 6
    expect(ratStr(d6.bar!.r)).toBe("3/100");
  });
  it("saturation is reported and never moves a verdict, a bar or a share", () => {
    const plainNeutral = arm(NEUTRAL0), satNeutral = new Map([1, 2, 3].map((k) => [k, seed(50, 50, { sat: 4000 })] as const));
    const evolving = arm(HIGH);
    const a = decide({ evolving, neutral: plainNeutral });
    const b = decide({ evolving, neutral: satNeutral });
    expect(b.verdict).toBe(a.verdict);
    expect(b.bar).toEqual(a.bar);
    expect(b.neutral.map((j) => j.stats.D)).toEqual(a.neutral.map((j) => j.stats.D));
    expect(b.neutral[0].stats.top.saturated).toBe(80000n);
    const mdA = render(a), mdB = render(b);
    expect(mdA).toMatch(/No 16-bit count field reached/);
    expect(mdB).toMatch(/FLAG: some 16-bit count fields sit at their 65,535 cap/);
    expect(mdB).toMatch(/\| neutral \| 1 \| 80000 \|/);
  });
});

describe("render and decisionJson", () => {
  const d = decide({ evolving: arm(HIGH), neutral: arm(NEUTRAL0) });
  it("prints the verdict, the bar, per-seed sums and shares", () => {
    const md = render(d, { banner: "REHEARSAL, not a check result" });
    expect(md.startsWith("> REHEARSAL, not a check result")).toBe(true);
    expect(md).toMatch(/\*\*Verdict: go\.\*\*/);
    expect(md).toMatch(/m \+ r = 0\/1 = 0\.000000/);
    expect(md).toMatch(/## Evolving seeds/);
    expect(md).toMatch(/\| 1 \| 1400 \| 600 \| 0 \| 0 \| 1000 \| 1000 \| 0 \| 0 \| 7\/10 = 0\.700000 \| 1\/2 = 0\.500000 \| 1\/5 = 0\.200000 \| pass \|/);
    expect(render(decide({ evolving: arm(LOW), neutral: arm(LOW) }))).toMatch(/FAIL/);
  });
  it("is JSON-safe", () => {
    const j = JSON.parse(JSON.stringify(decisionJson(d)));
    expect(j.verdict).toBe("go");
    expect(j.bar.threshold.fraction).toBe("0/1");
    expect(j.evolving[0].D).toEqual({ fraction: "1/5", decimal: "0.200000000" });
    expect(FIRST_SEEDS.length + EXTENSION_SEEDS.length).toBe(6);
  });
});

describe("what a bundle must be", () => {
  const slot = { arm: "evolving", condition: "treatment", seed: 2, experiment: "slab-check", steps: 300_000 } as const;
  const expectedCfg = { ...PROTOCOL_CFG, ruleVersion: 7, seed: 2, neutral: false, defaultMu: 60, defaultSigma: 20, lightK: 1024, kBuild: 64 };
  const good = () => ({
    spec: { experiment: "slab-check", presetId: "slab-spots", condition: "treatment", seed: 2, steps: 300_000, overrides: { defaultMu: 60, defaultSigma: 20, lightK: 1024 } },
    cfg: JSON.parse(JSON.stringify(expectedCfg)),
    init: { ...PROTOCOL_INIT },
  });
  const check = (m: unknown, sl: Record<string, unknown> = {}) => checkBundleIdentity(m, { ...slot, ...sl }, expectedCfg);
  it("accepts the slot's own run, with any M4 pick", () => {
    expect(() => check(good())).not.toThrow();
    const m = good();
    m.spec.overrides = { defaultMu: 44, defaultSigma: 17, lightK: 600 };
    Object.assign(m.cfg, { defaultMu: 44, defaultSigma: 17, lightK: 600 });
    expect(() => checkBundleIdentity(m, slot, { ...expectedCfg, defaultMu: 44, defaultSigma: 17, lightK: 600 })).not.toThrow();
  });
  it("refuses a bundle in the wrong slot", () => {
    expect(() => check(good(), { seed: 3 })).toThrow(/spec.seed is 2/);
    expect(() => check(good(), { condition: "neutral", arm: "neutral" })).toThrow(/spec.condition/);
    expect(() => check(good(), { experiment: "other" })).toThrow(/spec.experiment/);
    expect(() => check(good(), { steps: 3000 })).toThrow(/spec.steps/);
    const m = good();
    m.cfg.neutral = true;
    expect(() => check(m)).toThrow(/cfg.neutral/);
    const n = good();
    n.cfg.seed = 1;
    expect(() => check(n)).toThrow(/cfg.seed is 1/);
    const p = good();
    p.spec.presetId = "spots";
    expect(() => check(p)).toThrow(/presetId/);
  });
  it("refuses a different world: geometry, light, seasons, founding, overrides, any other config key", () => {
    for (const [k, v] of [["tileW", 32], ["tileH", 32], ["tileD", 4], ["tilesX", 2], ["kernelRadius", 2], ["lightMode", "gradient"], ["lightBase", 41], ["lightAmp", 100], ["seasonPeriod", 1000], ["seasonAmp", 10]] as const) {
      const m = good();
      (m.cfg as Record<string, unknown>)[k] = v;
      expect(() => check(m), k).toThrow(new RegExp(`cfg.${k}`));
    }
    for (const [k, v] of [["founders", 4], ["nutrient", 16], ["biomass", 32], ["kind", "spots"]] as const) {
      const m = good();
      (m.init as Record<string, unknown>)[k] = v;
      expect(() => check(m), k).toThrow(new RegExp(`init.${k}`));
    }
    const extraInit = good();
    (extraInit.init as Record<string, unknown>).waste = 1;
    expect(() => check(extraInit)).toThrow(/init has keys/);
    const kb = good();
    kb.cfg.kBuild = 65;
    expect(() => check(kb)).toThrow(/cfg.kBuild/);
    const mu = good();
    mu.cfg.defaultMu = 61;
    expect(() => check(mu)).toThrow(/cfg.defaultMu/);
    const extra = good();
    (extra.spec.overrides as Record<string, number>).mutRate = 0;
    expect(() => check(extra)).toThrow(/overrides has keys/);
    const few = good();
    delete (few.spec.overrides as Record<string, number>).lightK;
    expect(() => check(few)).toThrow(/overrides has keys/);
    const nan = good();
    (nan.spec.overrides as Record<string, unknown>).lightK = "1024";
    expect(() => check(nan)).toThrow(/not an integer/);
    expect(() => check(null)).toThrow(InputError);
    // the rule version is the cross-bundle check's business
    const rv = good();
    rv.cfg.ruleVersion = 8;
    expect(() => check(rv)).not.toThrow();
  });
  it("refuses two slots with the same final state hash, and a missing hash", () => {
    expect(() => checkDistinctHistories([{ label: "evolving seed 1", finalHash: "a" }, { label: "evolving seed 2", finalHash: "b" }])).not.toThrow();
    expect(() => checkDistinctHistories([{ label: "evolving seed 1", finalHash: "a" }, { label: "neutral seed 3", finalHash: "a" }])).toThrow(/evolving seed 1 and neutral seed 3 hold the same final state hash/);
    expect(() => checkDistinctHistories([{ label: "x", finalHash: undefined }])).toThrow(/finalHash is missing/);
  });
  it("layersIncomplete says whether layers.tsv holds every census", () => {
    const full = (n: number) => LAYERS_HEADER + "\n" + Array.from({ length: n }, (_, k) => Array.from({ length: 8 }, (_, z) => `${(k + 1) * 1000}\t${z}\t1\t1\t1\t1\t0\n`).join("")).join("");
    const ok = full(3);
    expect(layersIncomplete(ok, 3000, 1000)).toBeNull();
    expect(layersIncomplete(full(2), 3000, 1000)).toMatch(/16 rows, expected 24/);
    expect(layersIncomplete(ok.slice(0, -5), 3000, 1000)).toMatch(/newline/);
    expect(layersIncomplete(LAYERS_HEADER + "\n", 3000, 1000)).toMatch(/0 rows/);
    expect(layersIncomplete("nope\n", 3000, 1000)).toMatch(/header/);
    expect(layersIncomplete(ok, 2500, 1000)).toMatch(/last census/); // the last census is at step 2500, not 3000
  });
});
