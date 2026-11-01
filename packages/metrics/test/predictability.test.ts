import { beforeAll, describe, expect, it } from "vitest";
import { baseFixtures, blobsDiffuse, coarsen, coarsenFrame, compressionOf, calibrationBins, decideLabel, fitSeries, fitSummary, evaluatePredictor, lifeBlinker, lifeBlock, lifeGlider, lifePulsar, miscalibration, movieBytes, predictInto, PREDICTORS, rankFlips, Series, type Movie, type Rational } from "../src/predictability/index.ts";
import { buildPayload, relabel, sha256, type Payload } from "../src/predictability/atlas.ts";
import { ECOLOGY, ecologyClip, ecologyConfig, ecologyInit } from "../src/predictability/ecology.ts";
import { FIXTURE_SPECS } from "../src/predictability/fixtures.ts";

const PINNED_SHA: Record<string, string> = {
  "life-block": "5bd07af625dff8984c172a5b29023a837574e9eb7a53b3e2da2c48c6a8ec4914",
  "life-blinker": "68bea1fa63df2cbea6c64ab5ebb03d143e2a425480fb2353a28bbf2bca3e800c",
  "life-pulsar": "2a8249c816b01a7a879ecaad0a6da8cf45c29ee66bcc1baffb577bc715713904",
  "life-glider": "39334ce389f6899c1b04b1f1b822242bab735f08ec7268996cbaa133ea52ad1e",
  "life-gliders-dup": "3a2786ccf230fe1ed97a20f95ec41f23f73ec0f25645527953b55878b663debd",
  "life-soup-early": "052dcd4a49c31798201219476777610e00951287ded3890c5ec4b42625b44f94",
  "random-bits": "1942adbfcc27dda40dcb5d5dd0225aee1386af03beb56d508c6cd53a80b73586",
  "random-static": "04adb46d8b1d8dc371aecd00f0b76a9a63a103a4fc7d097416fcc82c3bdf0453",
  "blobs-diffuse": "153655ccc915d6d22b26c16c7db3a1d6971e1afea1560caa7c79a69c4681ad19",
  "ecology-clip": "ba53597f6a769b159e5f0e4c5fc2df412c17a57dfc185d69ae63276d8ca06d52",
};
// Pinned deflate output sizes (fflate 0.8.3, level 6, bit-packed XOR-delta stream of 49,152 bytes).
const PINNED_DEFLATE: Record<string, number> = { "random-bits": 49162, "life-glider": 487 };

let movies: Movie[];
let payload: Payload;
let blobStats: ReturnType<typeof baseFixtures>["blobs"];
const rate = (e: number, c: number) => e / c;
const byId = (id: string) => payload.fixtures.find((f) => f.id === id)!;
const loss = (id: string, r: number, h: number, p: string) => byId(id).byResolution[r].loss[h][p];

beforeAll(() => {
  const b = baseFixtures();
  blobStats = b.blobs;
  movies = [...b.movies, ecologyClip()];
  payload = buildPayload(movies, Object.fromEntries(FIXTURE_SPECS.map((s) => [s.id, s.params])));
}, 120_000);

describe("fixtures", () => {
  it("fixtures are deterministic", () => {
    const again = [...baseFixtures().movies, ecologyClip()];
    expect(again.map((m) => m.id)).toEqual(Object.keys(PINNED_SHA));
    for (const m of again) {
      expect(sha256(movieBytes(m))).toBe(PINNED_SHA[m.id]);
      expect(sha256(movieBytes(movies.find((x) => x.id === m.id)!))).toBe(PINNED_SHA[m.id]);
    }
  });

  it("life fixtures behave as named", () => {
    const eq = (a: Uint8Array, b: Uint8Array) => a.every((v, i) => v === b[i]);
    const block = lifeBlock().frames;
    expect(block.every((f) => eq(f, block[0]))).toBe(true);
    const blink = lifeBlinker().frames;
    expect(eq(blink[2], blink[0])).toBe(true);
    expect(eq(blink[1], blink[0])).toBe(false);
    const pul = lifePulsar().frames;
    for (let k = 3; k < pul.length; k++) expect(eq(pul[k], pul[k - 3])).toBe(true);
    expect(eq(pul[1], pul[0])).toBe(false);
    expect(eq(pul[2], pul[0])).toBe(false);
    const gl = lifeGlider().frames, side = 64;
    for (const k of [0, 4, 40, 91]) for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) expect(gl[k + 4][((y + 1) % side) * side + ((x + 1) % side)]).toBe(gl[k][y * side + x]);
  });

  it("blobs conserve latent count", () => {
    expect(blobStats.latentTotal).toBe(600);
    const b = blobsDiffuse();
    expect(b.saturatedCellFrames).toBe(0); // reported, not hidden: no cell exceeded the observed cap of 15
    expect(b.maxCount).toBeLessThanOrEqual(15);
    for (const f of b.movie.frames) expect(f.reduce((a, v) => a + v, 0)).toBe(600); // equal to the latent total because nothing saturated
  });

  it("random-bits resists deflate", () => {
    const c = compressionOf(movies.find((m) => m.id === "random-bits")!);
    expect(c.ratioPerMille).toBeGreaterThanOrEqual(990);
    expect(c.packedRawBytes).toBe(96 * 64 * 64 / 8);
    for (const [id, bytes] of Object.entries(PINNED_DEFLATE)) expect(compressionOf(movies.find((m) => m.id === id)!).compressedBytes).toBe(bytes);
    expect(byId("life-glider").compression.ratioPerMille).toBeLessThan(50);
  });

  it("ecology clip protocol is recorded and plain", () => {
    expect(ECOLOGY).toMatchObject({ preset: "spots", seed: 1, frames: 96, stride: 4, channel: "B", shift: 5 });
    expect(ecologyConfig().tileW).toBe(32);
    expect(ecologyInit().kind).toBe("generalist");
  });
});

describe("observer", () => {
  it("coarsening is defined", () => {
    // four 2x2 blocks with sums 0, 1, 2 (a tie, rounds up) and 3
    const rows = [[0, 0, 1, 0], [0, 0, 0, 0], [1, 1, 1, 1], [0, 1, 1, 1]];
    expect(Array.from(coarsenFrame(Uint8Array.from(rows.flat()), 4, 4, 2))).toEqual([0, 0, 1, 1]); // sums 0,1,2,3 -> 0,0,1,1
    expect(Array.from(coarsenFrame(Uint8Array.from([15, 15, 15, 14]), 2, 2, 2))).toEqual([15]); // 59 -> floor(61/4)
    expect(coarsenFrame(Uint8Array.from([1, 2]), 2, 1, 1)).toEqual(Uint8Array.from([1, 2]));
    expect(() => coarsenFrame(new Uint8Array(9), 3, 3, 2)).toThrow();
  });

  it("fair-bit coarsening is biased: chance is not 1/2, the marginal baseline is the reference", () => {
    // At r=2 a fair-bit block is 1 with probability 11/16, so the constant marginal predictor beats persistence.
    const p = loss("random-bits", 2, 1, "persistence"), m = loss("random-bits", 2, 1, "marginal");
    expect(m.errors).toBeLessThan(p.errors);
    expect(rate(m.errors, m.cells)).toBeLessThan(0.4);
    expect(rate(p.errors, p.cells)).toBeGreaterThan(0.4);
    // at r=1 the two are nearly equal at ~1/2
    expect(Math.abs(rate(loss("random-bits", 1, 1, "persistence").errors, 294912) - 0.5)).toBeLessThan(0.01);
  });

  it("a single glider is erased at r=4 and skill is null", () => {
    expect(byId("life-glider").byResolution[4].erased).toBe(true);
    expect(byId("life-glider").byResolution[4].loss[1].persistence.skillVsBest).toBeNull();
    expect(byId("life-glider").byResolution[1].erased).toBe(false);
  });
});

describe("predictors", () => {
  const frame = (v: number[]) => Uint8Array.from(v);
  const uni = (v: number, n = 16) => new Uint8Array(n).fill(v);

  it("predictors give known outputs", () => {
    // alternating uniform 4x4 frames: even = 0, odd = 1, twelve frames
    const frames = Array.from({ length: 12 }, (_, i) => uni(i % 2));
    const s = new Series(frames, 4, 4, 2);
    const fit = fitSeries(s, 8, [1, 2, 4, 8]);
    expect(fit.period).toBe(2);
    expect(fit.marginal).toBe(0); // 4 zero frames and 4 one frames tie -> smaller value
    const out = new Uint8Array(16), conf = new Uint16Array(16);
    const t = 8;
    for (const h of [1, 2, 4]) {
      predictInto(fit, s, "persistence", t, h, out); expect(out).toEqual(frames[t - 1]);
      predictInto(fit, s, "marginal", t, h, out); expect(out).toEqual(uni(0));
      // best-period index t+h-1-p*ceil(h/p) is inside the past and has the target's parity
      predictInto(fit, s, "best-period", t, h, out); expect(out).toEqual(frames[(t + h - 1) % 2]);
      predictInto(fit, s, "local-stats", t, h, out, conf); expect(out).toEqual(frames[(t + h - 1) % 2]);
    }
    // h=1 context all-0 -> next all-1; seen 4 times x 16 cells (frames 0,2,4,6 feed origins 1..7): confidence floor(1000*(64+1)/(64+2))
    predictInto(fit, s, "local-stats", 8, 1, out, conf); // frame 7 is all-1 -> predicts 0
    expect(out).toEqual(uni(0));
    expect(conf[0]).toBe(Math.floor((1000 * (48 + 1)) / (48 + 2))); // all-1 context seen at origins 2,4,6 (3 x 16)
    // h=8: index bound, t+h-1-p*ceil(h/p) = 8+7-8 = 7 <= t-1
    predictInto(fit, s, "best-period", 8, 8, out); expect(out).toEqual(frames[7]);
    // h=8 has origins s in [1, 16] -> only s<=F-h=0 -> no pairs: the table is empty and every context falls back to marginal
    predictInto(fit, s, "local-stats", 8, 8, out, conf);
    expect(out).toEqual(uni(fit.marginal)); expect(conf[0]).toBe(500);
  });

  it("unseen contexts fall back to marginal with chance confidence", () => {
    const frames = Array.from({ length: 12 }, (_, i) => uni(i % 2));
    const lone = uni(0); lone[5] = 1;
    frames[9] = lone;
    const s = new Series(frames, 4, 4, 2);
    const fit = fitSeries(s, 8, [1]);
    const out = new Uint8Array(16), conf = new Uint16Array(16);
    predictInto(fit, s, "local-stats", 10, 1, out, conf); // sees frame 9 (lone one)
    // the cell at 5 and its eight neighbours have unseen contexts
    expect(out[5]).toBe(fit.marginal); expect(conf[5]).toBe(500);
    // a far cell (index 15 = (3,3) is a neighbour of (0,0) on the torus, but (3,3)'s block excludes 5) has the all-zero context -> predicts 1
    expect(out[15]).toBe(1); expect(conf[15]).toBeGreaterThan(500);
  });

  it("best-period picks the lowest error rate and ties go to the smaller period", () => {
    const frames = Array.from({ length: 30 }, (_, i) => uni(i % 3 === 0 ? 1 : 0));
    const fit = fitSeries(new Series(frames, 4, 4, 2), 24, [1]);
    expect(fit.period).toBe(3); // 6 also fits perfectly; the smaller wins
  });

  it("predictors, scoring and calibration use only the past", () => {
    const m = movies.find((x) => x.id === "life-soup-early")!;
    const tMax = 60, F = 24, hs = [1, 2, 4, 8];
    const run = (src: Movie) => {
      const out: Record<string, unknown> = {};
      for (const r of [1, 2, 4]) {
        const c = coarsen(src, r);
        const s = new Series(c.frames, c.w, c.h, c.q);
        const fit = fitSeries(s, F, hs);
        out[`fit${r}`] = fitSummary(fit);
        for (const p of PREDICTORS) for (const h of hs) {
          const rows: number[][] = [];
          for (let t = F; t <= tMax; t++) { const o = new Uint8Array(s.n), cf = new Uint16Array(s.n); predictInto(fit, s, p, t, h, o, cf); rows.push([...o, ...cf]); }
          out[`${r}|${p}|${h}`] = rows;
          // scoring over the origins whose targets (frame t+h-1) precede the boundary: errors, cells and the calibration bins
          const ev = evaluatePredictor(s, fit, p, h, F, tMax - h);
          out[`eval|${r}|${p}|${h}`] = { errors: ev.errors, cells: ev.cells, origins: ev.origins, bins: ev.calibration ?? null, mis: ev.calibration ? miscalibration(ev.calibration) : null };
        }
      }
      return out;
    };
    const base = run(m);
    const perturbed: Movie = { ...m, frames: m.frames.map((f, k) => (k >= tMax ? f.map((v, c) => (c % 3 === 0 ? 1 - v : v)) : f)) };
    expect(run(perturbed)).toEqual(base);
    expect((base["eval|1|local-stats|8"] as { origins: number }).origins).toBe(tMax - 8 - F + 1);
    // sanity: the full-length evaluation does see the change, so the comparison above is not vacuous
    const c1 = coarsen(m, 1), c2 = coarsen(perturbed, 1);
    const s1 = new Series(c1.frames, c1.w, c1.h, c1.q), s2 = new Series(c2.frames, c2.w, c2.h, c2.q);
    const full = (s: Series) => evaluatePredictor(s, fitSeries(s, F, [1]), "persistence", 1).errors;
    expect(full(s2)).not.toBe(full(s1));
  });

  it("fit summary binds counts to their context keys", () => {
    const mk = (a: number[], b: number[]) => ({ F: 1, q: 2, marginal: 0, period: 1, tables: new Map([[1, new Map([[0, Uint32Array.from(a)], [511, Uint32Array.from(b)]])]]) });
    expect(fitSummary(mk([1, 0], [0, 1]))).not.toEqual(fitSummary(mk([0, 1], [1, 0])));
  });

  it("fit windows are frozen", () => {
    const m = movies.find((x) => x.id === "random-bits")!;
    const alt: Movie = { ...m, frames: m.frames.map((f, k) => (k >= 24 ? f.map((v) => 1 - v) : f)) };
    const a = coarsen(m, 1), b = coarsen(alt, 1);
    expect(fitSummary(fitSeries(new Series(a.frames, a.w, a.h, a.q), 24, [1, 2, 4, 8]))).toEqual(fitSummary(fitSeries(new Series(b.frames, b.w, b.h, b.q), 24, [1, 2, 4, 8])));
  });
});

describe("evidence-level checks", () => {
  it("naive metric is fooled", () => {
    const rank = payload.naiveMetric.q2PersistenceRanking;
    expect(rank[0].id).toBe("random-bits");
    expect(rank[0].errors).toBeGreaterThan(rank[1].errors * 4);
    expect(payload.labels["random-bits"].label).toBe("noise-like");
    expect(["partial", "exact"]).not.toContain(payload.labels["random-bits"].label);
  });

  it("decision table: expected labels as literals", () => {
    for (const id of ["life-block", "life-blinker", "life-pulsar", "random-static"]) expect(payload.labels[id].label).toBe("exact");
    expect(payload.labels["random-bits"].label).toBe("noise-like");
    expect(relabel(payload)).toEqual(Object.fromEntries(Object.entries(payload.labels).map(([k, v]) => [k, v.label])));
  });

  it("decision table: every rule and its precedence on constructed values", () => {
    const base = { cells: 1000, erased: false, lBest: 500, lMarginal: 500, lBestShuffled: 500 };
    expect(decideLabel({ ...base, cells: 0, lBest: 0 })).toBe("uninformative");
    expect(decideLabel({ ...base, erased: true, lBest: 0 })).toBe("uninformative"); // rule 1 before rule 2
    expect(decideLabel({ ...base, lBest: 0, lMarginal: 0, lBestShuffled: 0 })).toBe("exact"); // rule 2 before rule 3
    expect(decideLabel(base)).toBe("noise-like");
    expect(decideLabel({ ...base, lBest: 95, lMarginal: 100, lBestShuffled: 95 + 20 })).toBe("noise-like"); // 50*20 = 1000 = cells: boundary inclusive
    expect(decideLabel({ ...base, lBest: 95, lMarginal: 100, lBestShuffled: 95 + 21 })).toBe("partial");
    expect(decideLabel({ ...base, lBest: 94, lMarginal: 100, lBestShuffled: 94 })).toBe("partial"); // 9400 < 9500
    expect(decideLabel({ ...base, lBest: 95, lMarginal: 100, lBestShuffled: 95 })).toBe("noise-like"); // 9500 >= 9500
  });

  it("time shuffle rows", () => {
    for (const id of ["random-bits", "random-static"]) { const n = payload.labels[id].numbers; expect(50 * Math.abs(n.lBestShuffled - n.lBest)).toBeLessThanOrEqual(n.cells); }
    for (const id of ["life-blinker", "life-pulsar", "life-soup-early"]) { const n = payload.labels[id].numbers; expect(n.lBestShuffled).toBeGreaterThan(n.lBest); }
    // the fit window is untouched: shuffled rows exist for every cell of the grid, with the same denominators
    const rows = payload.controls.timeShuffle.rows["life-blinker"][1][1];
    for (const p of PREDICTORS) expect(rows[p].cells).toBe(loss("life-blinker", 1, 1, p).cells);
  });

  it("phase shift rows", () => {
    for (const id of ["life-blinker", "life-pulsar"]) for (const k of [1, 3, 7]) for (const h of [1, 2, 4, 8]) {
      const row = payload.controls.phaseShift.rows[id][k][h]["best-period"];
      expect(row.errors).toBe(0);
      expect(row.cells).toBeGreaterThan(0);
      expect(row.cells).toBeLessThan(loss(id, 1, h, "best-period").cells); // denominators shrink with the later start
    }
  });

  it("duplicated motifs scale errors", () => {
    for (const r of [1, 2]) for (const p of PREDICTORS) for (const h of [1, 2, 4, 8]) {
      expect(loss("life-gliders-dup", r, h, p).errors).toBe(9 * loss("life-glider", r, h, p).errors);
      expect(payload.controls.duplicatedMotif.rows[r][h][p].equalsCopiesTimesSingle).toBe(true);
    }
    expect(loss("life-gliders-dup", 1, 1, "marginal").errors).toBeGreaterThan(0); // the motion-blind constant predictor passes the same equality
  });

  it("compression is separate", () => {
    for (const f of payload.fixtures) {
      expect(Object.keys(f.compression).sort()).toEqual(["compressedBytes", "packedRawBytes", "ratioPerMille"]);
      for (const res of Object.values(f.byResolution)) for (const hRows of Object.values(res.loss)) for (const row of Object.values(hRows))
        expect(Object.keys(row).sort()).toEqual(["cells", "errors", "origins", "skillVsBest", "skillVsMarginal", "skillVsPersistence"]);
    }
  });

  it("binning sensitivity detector", () => {
    const q = (num: number, den: number): Rational => ({ num, den });
    // a > b at the first resolution, a < b at the second: a flip
    expect(rankFlips([{ a: q(1, 2), b: q(1, 3) }, { a: q(1, 5), b: q(1, 3) }])).toEqual({ flip: true, pairs: [["a", "b"]] });
    // a > b, then tied (2/4 = 1/2): a tie is not a flip
    expect(rankFlips([{ a: q(1, 2), b: q(1, 3) }, { a: q(2, 4), b: q(1, 2) }]).flip).toBe(false);
    // nulls are dropped
    expect(rankFlips([{ a: q(1, 2), b: null }, { a: q(0, 2), b: q(1, 2) }]).flip).toBe(false);
    expect(typeof payload.binningSensitivity.rankFlipAcrossR).toBe("boolean");
  });

  it("calibration", () => {
    const bins = calibrationBins([100, 100, 300, 900, 900, 1000], [false, true, false, true, true, true]);
    expect(bins.map((b) => b.n)).toEqual([2, 1, 0, 0, 3]);
    expect(bins.map((b) => b.correct)).toEqual([1, 0, 0, 0, 3]);
    expect(bins.map((b) => b.sumConf)).toEqual([200, 300, 0, 0, 2800]);
    expect(miscalibration(bins)).toEqual({ num: 800 + 300 + 200, den: 6000 }); // deliberately miscalibrated
    expect(miscalibration(calibrationBins([500, 500], [true, false])).num).toBe(0); // calibrated
    for (const f of payload.fixtures) for (const res of Object.values(f.byResolution)) for (const h of Object.keys(res.calibration))
      expect(res.calibration[h].bins.reduce((a, b) => a + b.n, 0)).toBe(res.loss[h]["local-stats"].cells);
  });

  it("evaluation counts origins from F to T-h", () => {
    const m = movies.find((x) => x.id === "life-block")!;
    const s = new Series(m.frames, 64, 64, 2);
    const fit = fitSeries(s, 24, [1, 8]);
    expect(evaluatePredictor(s, fit, "persistence", 1).origins).toBe(96 - 1 - 24 + 1);
    expect(evaluatePredictor(s, fit, "persistence", 8).origins).toBe(96 - 8 - 24 + 1);
  });
});
