import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { PRESETS, RULE_VERSION, presetConfig, presetIdentity } from "@bl/schema";
import { BellScorer, SIGNALS, SignalExtractor, type Receipt } from "../../../tools/lib/bell.ts";
import { LiveBell, NATURALIST_BASELINES, baselineAt, censusProblem, decodeEnvelope, encodeEnvelope, envelopeAt, headerProblem, pick, type EnvelopeHeader } from "../src/naturalist-score.ts";
import { HORIZON, NaturalistModel, headerMismatch, matchWorld, rootOf, viewStrings, type Asset, type NaturalistCensus, type WorldManifest } from "../src/naturalist.ts";
import { NATURALIST_PRESETS, SERIES_FIELDS, firstIntervention, naturalistReads, type SeriesFields } from "../src/naturalist-series.ts";
import { assetRoot, fetchBaseline } from "../src/naturalist-panel.ts";
import { RECORDS, baselineSpecs, buildHeader, gradientNumbers, headerText, parseV0Spots, parseV1Null, spotsNumbers } from "../../../tools/lib/naturalist-envelope.ts";

// The Field notes panel's arithmetic and model (docs/naturalist-field-notes-v0-2026-10-18.md). The page itself is in
// tests/e2e/lab-naturalist.spec.ts.

const file = (p: string) => new URL(`../../../${p}`, import.meta.url);
const readJson = <T>(p: string): T => JSON.parse(readFileSync(file(p), "utf8")) as T;
const asset = (preset: string): { header: EnvelopeHeader; data: Float64Array; bin: Buffer } => {
  const f = NATURALIST_BASELINES[preset].file;
  const header = readJson<EnvelopeHeader>(`apps/lab/public/naturalist/${f}.json`);
  const bin = readFileSync(file(`apps/lab/public/naturalist/${header.bin.file}`));
  return { header, bin, data: decodeEnvelope(new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength)) };
};
const ready = (preset: string): Asset => {
  const a = asset(preset);
  return { kind: "ready", header: a.header, data: a.data };
};

/** A deterministic generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Six runs × 160 censuses of the thirteen signals at cadence 100 (burn-in at census 100), rates undefined for the first ten.
 * Small integer ranges give ties; run 5 departs low on living cells and high on mutations from census 95 and flips sign on
 * lineages, so it rings on some signals, crosses back on others, and starts just before the burn-in boundary.
 */
function syntheticSeries(): { step: number; values: (number | null)[] }[][] {
  const R = 6, N = 160, rand = rng(7);
  const out: { step: number; values: (number | null)[] }[][] = [];
  for (let i = 0; i < N; i++) {
    const step = (i + 1) * 100;
    const row: { step: number; values: (number | null)[] }[] = [];
    for (let r = 0; r < R; r++) {
      const v = SIGNALS.map((d, s) => {
        if (d.kind === "rate" && i < 10) return null;
        const base = 100 + s * 7 + Math.floor(rand() * 4); // ties: four values per signal
        if (r !== 5 || i < 95) return d.floor < 1 ? base / 1000 : base;
        if (d.name === "livingCells") return base - 60;
        if (d.name === "mutations") return base + 40;
        if (d.name === "lineages") return base + (i % 2 ? 30 : -30);
        return d.floor < 1 ? base / 1000 : base;
      });
      row.push({ step, values: v });
    }
    out.push(row);
  }
  return out;
}

const NAMES = SIGNALS.map((d) => d.name);
const FLOORS = SIGNALS.map((d) => d.floor);
const V1 = NAMES.filter((n) => n !== "maxGeneration" && n !== "dominantShare");

function liveScore(series: ReturnType<typeof syntheticSeries>, run: number, members: number[], names: string[], threshold = { Z: 4, strict: false }) {
  const b = new LiveBell(names, threshold, 50);
  const floors = names.map((n) => FLOORS[NAMES.indexOf(n)]);
  for (const c of series) {
    const env = envelopeAt(members.filter((m) => m !== run).map((m) => pick(names, c[m].values)), floors);
    b.push(c[0].step, pick(names, c[run].values), env.median, env.spread);
  }
  return b;
}

describe("LiveBell", () => {
  const series = syntheticSeries();
  const runIds = series[0].map((_, r) => `run-${r}`);
  const members = [0, 1, 2, 3, 4];

  it("scores a fixed series exactly as BellScorer does", () => {
    for (const run of [5, 0]) {
      const bell = new BellScorer(runIds, [{ id: "E", members }], [{ id: "s", run, envelope: "E" }], { Z: [4], W: [50], cadence: 100 });
      for (const c of series) bell.push(c);
      const want = bell.results()[0];
      const live = liveScore(series, run, members, NAMES);
      expect(live.dBySignal()).toEqual(want.dBySignal);
      expect(live.receipts()).toEqual(want.receipts);
      expect(Object.is(live.D(), want.D[0])).toBe(true);
      if (run === 5) expect(want.receipts.length).toBeGreaterThan(0);
      // The v1 rule: eleven signals, D11 = the largest D among them (bell1's d11Of).
      const live11 = liveScore(series, run, members, V1);
      const d11 = Math.max(0, ...want.dBySignal.filter((d) => V1.includes(d.signal)).map((d) => d.D));
      expect(Object.is(live11.D(), d11)).toBe(true);
      expect(live11.receipts()).toEqual(want.receipts.filter((r) => V1.includes(r.signal)));
    }
  });

  it("strict Z* rings above it and never on an exact tie", () => {
    const run = (x: number, strict: boolean) => {
      const b = new LiveBell(["livingCells"], { Z: 4, strict }, 50);
      for (let i = 0; i < 160; i++) b.push((i + 1) * 100, [x], [0], [1]);
      return b;
    };
    expect(run(-4, false).receipts()).toHaveLength(1);
    expect(run(-4, true).receipts()).toHaveLength(0);
    expect(run(-4.000001, true).receipts()[0]).toMatchObject({ signal: "livingCells", side: "low", startStep: 10_000, endStep: 14_900 });
  });

  it("encodes the baseline bit for bit, NaN as one pattern", () => {
    const data = Float64Array.of(1.5, NaN, -0, 1e-300, Number.MAX_VALUE, 0 / 0);
    const bytes = encodeEnvelope(data);
    expect(Array.from(bytes.slice(8, 16))).toEqual([0, 0, 0, 0, 0, 0, 0xf8, 0x7f]);
    expect(Array.from(bytes.slice(40, 48))).toEqual([0, 0, 0, 0, 0, 0, 0xf8, 0x7f]);
    const back = decodeEnvelope(bytes);
    expect(Object.is(back[2], -0)).toBe(true);
    expect([back[0], back[3], back[4]]).toEqual([1.5, 1e-300, Number.MAX_VALUE]);
  });

  it("copies bell1's census check exactly", async () => {
    const bell1Path = "../../../tools/lib/bell1.ts"; // not imported statically: the lab's typecheck would follow it (see censusProblem)
    const { censusProblem: theirs } = (await import(/* @vite-ignore */ bell1Path)) as { censusProblem: typeof censusProblem };
    const cases: [Record<string, unknown> & { step: number }, [string, number][]][] = [
      [{ step: 100, livingCells: 3, lineages: 2 }, [["a", 1], ["b", 2]]],
      [{ step: 100, livingCells: 4, lineages: 2 }, [["a", 1], ["b", 2]]],
      [{ step: 100, livingCells: 3, lineages: 1 }, [["a", 1], ["b", 2]]],
      [{ step: 100, livingCells: 0, lineages: 0 }, []],
      [{ step: 100, livingCells: 5, lineages: 0 }, []],
      [{ step: 100, livingCells: NaN, lineages: 0 }, []],
      [{ step: 100, lineages: 0 }, []],
      [{ step: 100, livingCells: 1, lineages: "1" }, [["a", 1]]],
    ];
    for (const [rec, rows] of cases) expect(censusProblem(rec, rows)).toBe(theirs(rec, rows));
  });
});

// ---------------------------------------------------------------------------------------------
// The committed assets and the record.

interface Fixture { fields: string[]; censuses: (SeriesFields & { rows: { count: number; cells: number; sha256: string } })[] }
const fixture = readJson<Fixture>("apps/lab/test/fixtures/naturalist-gradient-m3-treatment-seed-1.json");
const v1Null = readJson<{ runs: { id: string; firstRing11: Receipt | null }[] }>("experiments/naturalist/bell-v1-null.json");
const seed1Ring = v1Null.runs.find((r) => r.id === "replay-m4/gradient-m3/treatment/seed-1")!.firstRing11!;

describe("the published baselines", () => {
  it("each header matches its .bin, the current preset and the records", () => {
    expect([...NATURALIST_PRESETS].sort()).toEqual(Object.keys(NATURALIST_BASELINES).sort());
    for (const preset of NATURALIST_PRESETS) {
      const { header, bin, data } = asset(preset);
      expect(headerProblem(header, preset, NATURALIST_BASELINES[preset])).toBeNull();
      expect(header.bin.file).toBe(`${NATURALIST_BASELINES[preset].file}.bin`);
      expect(createHash("sha256").update(bin).digest("hex")).toBe(header.bin.sha256);
      expect(bin.byteLength).toBe(header.bin.bytes);
      expect(header.presetIdentity).toBe(presetIdentity(PRESETS.find((p) => p.id === preset)!));
      expect(header.ruleVersion).toBe(RULE_VERSION);
      expect([header.cadence, header.horizon, header.censuses, header.W, header.burnIn]).toEqual([100, HORIZON, 3000, 50, 10_000]);
      for (const r of header.records) {
        expect(existsSync(file(r.path))).toBe(true);
        expect(createHash("sha256").update(readFileSync(file(r.path))).digest("hex")).toBe(r.sha256);
      }
      // Censuses 1 to 10: rates undefined (NaN), levels defined; afterwards everything defined.
      const S = header.signals.length;
      const rate = header.signals.findIndex((s) => s.kind === "rate");
      expect(Number.isNaN(baselineAt(data, S, 9).median[rate])).toBe(true);
      expect(Number.isNaN(baselineAt(data, S, 10).median[rate])).toBe(false);
      expect(Number.isNaN(baselineAt(data, S, 0).median[0])).toBe(false);
    }
    expect(asset("gradient-m3").header.signals.map((s) => s.name)).toEqual(V1);
    expect(asset("gradient-m3").header.threshold).toEqual({ Z: 4, strict: false });
    expect(asset("spots-m3").header.signals.map((s) => s.name)).toEqual(NAMES);
    expect(asset("spots-m3").header.threshold).toEqual({ Z: 11.4665, strict: true });
    // The numbers themselves, pinned as built and verified by tools/naturalist-envelope.ts (re-pin deliberately on a rebuild).
    expect(asset("gradient-m3").header.bin.sha256).toBe("6680621727b3c05581a404387b7fd7118fa7a06b5b37ea3ef853692c38d15894");
    expect(asset("spots-m3").header.bin.sha256).toBe("8678878c3a495f3211d257c4d78a0257d7ca29e6dc8837974519cbcb9c136f4c");
  });

  it("a header cannot change the rule it is scored by", () => {
    const { header } = asset("gradient-m3");
    const spec = NATURALIST_BASELINES["gradient-m3"];
    const bad = (over: Partial<EnvelopeHeader>) => headerProblem({ ...header, ...over }, "gradient-m3", spec);
    expect(bad({ threshold: { Z: 1, strict: false } })).toMatch(/threshold is at least 1, not bell-v1-A's at least 4/);
    expect(bad({ threshold: { Z: 4, strict: true } })).toMatch(/threshold/);
    expect(bad({ signals: header.signals.slice(1) })).toMatch(/signals are not bell-v1-A's 11/);
    expect(bad({ envelope: { ...header.envelope, runs: header.envelope.runs.slice(1) } })).toMatch(/39 runs, not bell-v1-A's 40/);
    const spots = asset("spots-m3").header;
    expect(headerProblem({ ...spots, threshold: { Z: 11.4664, strict: true } }, "spots-m3", NATURALIST_BASELINES["spots-m3"])).toMatch(/threshold/);
  });

  it("every census of both baselines holds a finite median and a positive spread (rates from census 11)", () => {
    for (const preset of NATURALIST_PRESETS) {
      const { header, data } = asset(preset);
      const S = header.signals.length;
      for (let i = 0; i < header.censuses; i++) {
        const b = baselineAt(data, S, i);
        for (let k = 0; k < S; k++) {
          if (header.signals[k].kind === "rate" && i < 10) {
            expect(Number.isNaN(b.median[k]) && Number.isNaN(b.spread[k])).toBe(true);
            continue;
          }
          if (!(Number.isFinite(b.median[k]) && b.spread[k] > 0 && Number.isFinite(b.spread[k]))) throw new Error(`${preset} census ${i + 1} ${header.signals[k].name}: median ${b.median[k]} spread ${b.spread[k]}`);
        }
      }
    }
  });

  it("each header is rebuilt from the committed records alone, byte for byte (the numbers the panel prints)", () => {
    const rec = (path: string) => ({ path, text: readFileSync(file(path), "utf8"), sha256: createHash("sha256").update(readFileSync(file(path))).digest("hex") });
    const v1 = parseV1Null(rec(RECORDS.v1Null).text);
    const v0 = parseV0Spots(rec(RECORDS.v0).text);
    const twins = rec(RECORDS.v1Twins).text;
    for (const spec of baselineSpecs(v0.zStar)) {
      const committed = readFileSync(file(`apps/lab/public/naturalist/${spec.file}.json`), "utf8");
      const h = JSON.parse(committed) as EnvelopeHeader;
      const numbers = spec.preset === "gradient-m3" ? gradientNumbers(v1, twins) : spotsNumbers(v0);
      const identity = spec.preset === "gradient-m3" ? v1.presetIdentity : v0.presetIdentity;
      const built = buildHeader(spec, { presetIdentity: identity, ruleVersion: RULE_VERSION, binSha256: h.bin.sha256, binBytes: h.bin.bytes, records: spec.records.map((p) => { const r = rec(p); return { path: r.path, sha256: r.sha256 }; }), numbers });
      expect(headerText(built)).toBe(committed);
    }
    expect(v0.calibSecond).toBe(4.047);
    expect(() => baselineSpecs(11.4664)).toThrow(/STOP: the lab's spots-m3 rule is not bell-v0.json's/);
  });

  it("fetchBaseline checks the header against the rule, then the numbers' size and SHA-256", async () => {
    type Serve = (path: string) => Response | Promise<Response>;
    const disk: Serve = (path) => {
      const p = `apps/lab/public${path.split("?")[0]}`;
      return existsSync(file(p)) ? new Response(readFileSync(file(p))) : new Response("missing", { status: 404 });
    };
    const via = (serve: Serve) => {
      const asked: string[] = [];
      const get = (async (input: RequestInfo | URL) => { asked.push(String(input)); return serve(String(input)); }) as typeof fetch;
      return { get, asked };
    };
    const ok = via(disk);
    const a = await fetchBaseline("gradient-m3", ok.get);
    expect(a.kind).toBe("ready");
    if (a.kind === "ready") expect(Array.from(a.data.slice(0, 40))).toEqual(Array.from(asset("gradient-m3").data.slice(0, 40)));
    const sha = asset("gradient-m3").header.bin.sha256;
    expect(ok.asked).toEqual(["/naturalist/envelope-gradient-m3-v1.json", `/naturalist/envelope-gradient-m3-v1.bin?sha256=${sha}`]);
    const h = asset("gradient-m3").header;
    const withHeader = (over: Partial<EnvelopeHeader>): Serve => (path) => (path.endsWith(".json") ? new Response(JSON.stringify({ ...h, ...over })) : disk(path));
    const reason = async (serve: Serve, preset = "gradient-m3", subtle?: SubtleCrypto | null) => {
      const r = await fetchBaseline(preset, via(serve).get, subtle === null ? null : (subtle ?? globalThis.crypto.subtle));
      return r.kind === "failed" ? r.reason : `not failed: ${r.kind}`;
    };
    expect(await reason(withHeader({ threshold: { Z: 1, strict: false } }))).toMatch(/threshold/);
    expect(await reason(() => new Response("missing", { status: 404 }))).toBe("its header answered 404");
    expect(await reason((p) => (p.includes(".bin") ? new Response("gone", { status: 503 }) : disk(p)))).toBe("its numbers answered 503");
    expect(await reason(withHeader({ bin: { ...h.bin, file: "../x.bin" } }))).toBe("its header names an odd file");
    expect(await reason((p) => (p.includes(".bin") ? new Response(new Uint8Array(h.bin.bytes - 8)) : disk(p)))).toBe(`its numbers are ${h.bin.bytes - 8} bytes, the header says ${h.bin.bytes}`);
    expect(await reason((p) => (p.includes(".bin") ? new Response(new Uint8Array(h.bin.bytes)) : disk(p)))).toBe("its numbers do not match the SHA-256 in its header");
    expect(await reason(() => { throw new TypeError("Failed to fetch"); })).toBe("it could not be fetched or read (Failed to fetch)");
    expect(await reason(disk, "gradient-m3", null)).toMatch(/not served over a secure connection/);
    expect(await reason(disk, "spots")).toBe("no baseline is published for spots");
    expect((await fetchBaseline("spots-m3", via(disk).get)).kind).toBe("ready");
    // Under a build's base URL (Vite serves public/ there), both files are asked for under it.
    expect(assetRoot("/")).toBe("/naturalist/");
    expect(assetRoot(undefined)).toBe("/naturalist/");
    expect(assetRoot("/preview")).toBe("/preview/naturalist/");
    const sub = via((p) => (p.startsWith("/preview/") ? disk(p.slice("/preview".length)) : new Response("missing", { status: 404 })));
    expect((await fetchBaseline("gradient-m3", sub.get, globalThis.crypto.subtle, assetRoot("/preview/"))).kind).toBe("ready");
    expect(sub.asked).toEqual(["/preview/naturalist/envelope-gradient-m3-v1.json", `/preview/naturalist/envelope-gradient-m3-v1.bin?sha256=${sha}`]);
    // With no root passed, fetchBaseline reads the build's base URL when called.
    vi.stubEnv("BASE_URL", "/preview/");
    try {
      const bare = via((p) => (p.startsWith("/preview/") ? disk(p.slice("/preview".length)) : new Response("missing", { status: 404 })));
      expect((await fetchBaseline("gradient-m3", bare.get)).kind).toBe("ready");
      expect(bare.asked).toEqual(["/preview/naturalist/envelope-gradient-m3-v1.json", `/preview/naturalist/envelope-gradient-m3-v1.bin?sha256=${sha}`]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("the committed seed-1 excerpt rings living cells low with the record's receipt", () => {
    const { header, data } = asset("gradient-m3");
    const names = header.signals.map((s) => s.name);
    const ext = new SignalExtractor();
    const b = new LiveBell(names, header.threshold, header.W, header.burnIn);
    fixture.censuses.forEach((c, i) => {
      const at = baselineAt(data, names.length, i);
      b.push(c.step, pick(names, ext.push(c as unknown as Record<string, unknown>, [])), at.median, at.spread);
    });
    const ring = b.receipts().find((r) => r.signal === "livingCells" && r.side === "low");
    expect(ring).toEqual(seed1Ring);
    expect(seed1Ring).toMatchObject({ startStep: 10_000, endStep: 14_900, minAbsZ: 5.494653187635131, value: 21452, median: 33684 });
    expect(b.receipts()[0]).toEqual(seed1Ring);
  });
});

// ---------------------------------------------------------------------------------------------
// The model.

const gradient = PRESETS.find((p) => p.id === "gradient-m3")!;
const manifest = (over: Partial<WorldManifest> = {}, preset = gradient, seed = 1): WorldManifest => ({
  runId: `${preset.id}-s${seed}-abc`, presetId: preset.id, seed, cfg: presetConfig(preset, seed), init: preset.init, ruleVersion: RULE_VERSION, settings: { censusEvery: 100 }, interventions: [], ...over,
});
/** Lineage rows that hold together with the record: `lineages` rows summing to `livingCells`. */
const rowsFor = (c: SeriesFields): [string, number][] => Array.from({ length: c.lineages }, (_, i) => [`k${i}`, i === 0 ? c.livingCells - (c.lineages - 1) : 1]);
const recOf = (c: Fixture["censuses"][number]): SeriesFields => Object.fromEntries(SERIES_FIELDS.map((f) => [f, c[f]])) as unknown as SeriesFields;
const msg = (world: number, runId: string, c: SeriesFields, over: Partial<NaturalistCensus> = {}): NaturalistCensus => ({ world, runId, step: c.step, rec: c, rows: rowsFor(c), touched: null, dropped: 0, ...over });
const fixtureRecs = fixture.censuses.map(recOf);
/** Censuses past the fixture: the last one held still (rates 0), each at its step. */
const later = (step: number): SeriesFields => ({ ...fixtureRecs[fixtureRecs.length - 1], step });

function planted(opts: { asset?: boolean } = {}) {
  const requests: string[] = [];
  const model = new NaturalistModel((p) => requests.push(p));
  const m = manifest();
  model.onLoaded(m, 0, 1);
  if (opts.asset !== false) model.setAsset("gradient-m3", ready("gradient-m3"));
  return { model, m, requests };
}
const feed = (model: NaturalistModel, world: number, runId: string, recs: SeriesFields[], over: Partial<NaturalistCensus> = {}) => recs.forEach((c) => model.onCensus(msg(world, runId, c, over)));

/** The gradient-m3 baseline with every spread huge, so every z is about 0 and nothing rings. */
function wideAsset(): Asset {
  const { header, data } = asset("gradient-m3");
  const wide = data.slice();
  for (let i = 1; i < wide.length; i += 2) if (!Number.isNaN(wide[i])) wide[i] = 1e12;
  return { kind: "ready", header, data: wide };
}

describe("NaturalistModel", () => {
  it("rings on the seed-1 excerpt with the record's receipt and the notebook's words", () => {
    const { model, m, requests } = planted();
    expect(requests).toEqual(["gradient-m3"]);
    expect(model.view().state).toBe("listening");
    feed(model, 1, m.runId, fixtureRecs);
    const v = model.view();
    expect(v.state).toBe("rings");
    const note = v.notes.find((n) => n.signal === "livingCells" && n.side === "low")!;
    expect(note.receipt).toMatchObject(seed1Ring);
    expect(note.chips).toEqual(["Measured", "Unclear"]);
    expect(note.sentence).toBe("Fewer living cells: 21,452 at step 10,000, against a neutral median there of 33,684. At least four spreads below it for 50 censuses in a row, from step 10,000 to step 14,900; the weakest of them was 5.49 spreads below the median.");
    expect(v.readTo).toBe(16_000);
    expect(v.standing.map((s) => s.chip)).toEqual(["Measured", "Measured", "Not yet measured"]);
    expect(v.standing[1].text).toContain("9 of them first on living cells low in the first window it counts, from step 10,000 to step 14,900, and the other later, by step 26,100");
    expect(v.hedge).toEqual([]);
    expect(v.cannot[0]).toContain("A twin bell was tried on Bright to dim (searched founders) and did not meet its bar there (it heard 4 of 10 large wounds and 4 of 10 feeds)");
    // Filed by start step, then by the weakest |z|, largest first.
    for (let i = 1; i < v.notes.length; i++) {
      const a = v.notes[i - 1].receipt, b = v.notes[i].receipt;
      expect(a.startStep < b.startStep || (a.startStep === b.startStep && a.minAbsZ >= b.minAbsZ)).toBe(true);
    }
  });

  it("drops a census from an older generation or another run", () => {
    const { model, m } = planted();
    model.onLoaded(m, 0, 2);
    feed(model, 1, m.runId, fixtureRecs.slice(0, 3));
    feed(model, 2, "someone-else", fixtureRecs.slice(0, 3));
    expect(model.view().readTo).toBeNull();
    feed(model, 2, m.runId, fixtureRecs.slice(0, 3));
    expect(model.view().readTo).toBe(300);
  });

  it("a world watched from step 200 gets no notes", () => {
    const model = new NaturalistModel(() => {});
    const m = manifest();
    model.onLoaded(m, 200, 1);
    model.setAsset("gradient-m3", ready("gradient-m3"));
    feed(model, 1, m.runId, fixtureRecs.slice(2));
    const v = model.view();
    expect(v.state).toBe("late");
    expect(v.status).toBe("Watching since t=200.");
    expect(v.notes).toEqual([]);
  });

  it("a rewind to t keeps censuses up to t and recomputes, and the replay gives the same notes", () => {
    const { model, m } = planted();
    feed(model, 1, m.runId, fixtureRecs);
    const before = model.view().notes;
    expect(before.length).toBeGreaterThan(0);
    // A restore of this run at t = 12,000.
    model.onLoaded(m, 12_000, 2);
    let v = model.view();
    expect(v.readTo).toBe(12_000);
    expect(v.notes).toEqual([]);
    feed(model, 2, m.runId, fixtureRecs.slice(120));
    expect(model.view().notes).toEqual(before);
    // A jump forks the run id; its history up to the step it lands on is this run's.
    const fork = { ...m, runId: `${m.runId}-bk2x9` };
    model.onLoaded(fork, 13_000, 3);
    expect(model.view().readTo).toBe(13_000);
    feed(model, 3, fork.runId, fixtureRecs.slice(130));
    expect(model.view().notes).toEqual(before);
    // A sibling fork (a second jump through a checkpoint the first one inherited) is the same planting, the same history.
    const sibling = { ...m, runId: `${m.runId}-bzz01` };
    model.onLoaded(sibling, 11_000, 4);
    expect(model.view().readTo).toBe(11_000);
    feed(model, 4, sibling.runId, fixtureRecs.slice(110));
    expect(model.view().notes).toEqual(before);
    expect(rootOf(`${m.runId}-bk2x9-bzz01`)).toBe(m.runId);
    expect(rootOf("gradient-m3-s1-mgb2xq")).toBe("gradient-m3-s1-mgb2xq");
    // Another run at a later step is a late join.
    model.onLoaded({ ...m, runId: "gradient-m3-s1-zzz" }, 13_000, 5);
    v = model.view();
    expect(v.state).toBe("late");
    expect(v.notes).toEqual([]);
  });

  it("keeps only what a restored history shares: censuses before its own first change by hand", () => {
    // Read to 16,000 untouched; then the same planting comes back at 15,000 from a history wounded at 11,000 (another tab's save).
    const { model, m } = planted();
    feed(model, 1, m.runId, fixtureRecs);
    expect(model.view().notes.length).toBeGreaterThan(0);
    model.onLoaded({ ...m, runId: `${m.runId}-bq1`, interventions: [{ step: 11_000 }] }, 15_000, 2);
    const v = model.view();
    expect(v.readTo).toBe(11_000);
    expect(v.notes).toEqual([]);
    expect(v.state).toBe("touched");
    expect(v.status).toBe("Stopped reading at step 11,100: the world was changed by hand at step 11,000.");
    // A history the store stopped on by hand, restored without that change past the stop, is another history: read afresh.
    const other = planted();
    feed(other.model, 1, other.m.runId, fixtureRecs.slice(0, 50));
    other.model.onCensus(msg(1, other.m.runId, fixtureRecs[50], { touched: 5_000 }));
    other.model.onLoaded({ ...other.m, runId: `${other.m.runId}-bq2` }, 8_000, 2);
    expect(other.model.view().state).toBe("late");
  });

  it("marks the notes at once when the world is changed by hand while paused", () => {
    const { model, m } = planted();
    feed(model, 1, m.runId, fixtureRecs);
    model.onTouched(1, "another-run", 16_000);
    model.onTouched(0, m.runId, 16_000);
    expect(model.view().state).toBe("rings");
    model.onTouched(1, m.runId, 16_000);
    const v = model.view();
    expect(v.state).toBe("touched");
    expect(v.status).toBe("Stopped reading: the world was changed by hand at step 16,000.");
    expect(v.notes.every((n) => n.filedBefore === 16_000)).toBe(true);
    model.onCensus(msg(1, m.runId, later(16_100), { touched: 16_000 }));
    expect(model.view().status).toBe("Stopped reading at step 16,100: the world was changed by hand at step 16,000.");
  });

  it("stops reading after the first intervention and keeps the notes filed before it", () => {
    const { model, m } = planted();
    feed(model, 1, m.runId, fixtureRecs.slice(0, 150));
    // A wound logged at step 15,000: the census at 15,000 is still read, the next is not.
    model.onCensus(msg(1, m.runId, fixtureRecs[149], { touched: 15_000 }));
    model.onCensus(msg(1, m.runId, fixtureRecs[150], { touched: 15_000 }));
    feed(model, 1, m.runId, fixtureRecs.slice(151));
    const v = model.view();
    expect(v.readTo).toBe(15_000);
    expect(v.state).toBe("touched");
    expect(v.status).toBe("Stopped reading at step 15,100: the world was changed by hand at step 15,000.");
    expect(v.notes.length).toBeGreaterThan(0);
    expect(v.notes.every((n) => n.filedBefore === 15_000)).toBe(true);
    expect(firstIntervention([{ step: 900 }, { step: 300 }])).toBe(300);
    expect(firstIntervention([])).toBeNull();
  });

  it("stops on a census that does not hold together; the rates' warm-up is not a stop", () => {
    const { model, m } = planted();
    feed(model, 1, m.runId, fixtureRecs.slice(0, 10));
    expect(model.view().state).toBe("listening");
    model.onCensus({ ...msg(1, m.runId, fixtureRecs[10]), rows: [["a", 1]] });
    const v = model.view();
    expect(v.state).toBe("stopped");
    expect(v.readTo).toBe(1_000);
    expect(v.status).toContain("the census does not hold together");
    const { model: m2, m: man2 } = planted();
    feed(m2, 1, man2.runId, fixtureRecs.slice(0, 4));
    m2.onCensus(msg(1, man2.runId, { ...fixtureRecs[4], meanMass: NaN }));
    expect(m2.view().status).toContain("mean body mass was NaN at step 500, not a measured number");
    const { model: m3, m: man3 } = planted();
    feed(m3, 1, man3.runId, fixtureRecs.slice(0, 4));
    m3.onCensus(msg(1, man3.runId, fixtureRecs[5]));
    expect(m3.view().status).toContain("the census at step 500 never reached the panel");
    const { model: m4, m: man4 } = planted();
    m4.onCensus(msg(1, man4.runId, fixtureRecs[0], { dropped: 3 }));
    expect(m4.view().state).toBe("stopped");
  });

  it("stops reading at the horizon", () => {
    const { model, m } = planted();
    feed(model, 1, m.runId, fixtureRecs);
    for (let step = 16_100; step <= HORIZON + 100; step += 100) model.onCensus(msg(1, m.runId, later(step)));
    const v = model.view();
    expect(v.state).toBe("ended");
    expect(v.readTo).toBe(HORIZON);
    expect(v.status).toBe("The baseline ends at step 300,000, so the naturalist has stopped reading.");
  });

  it("scores censuses that arrived before the baseline", () => {
    const early = planted({ asset: false });
    expect(early.model.view().state).toBe("loading");
    feed(early.model, 1, early.m.runId, fixtureRecs);
    early.model.setAsset("gradient-m3", ready("gradient-m3"));
    const late = planted();
    feed(late.model, 1, late.m.runId, fixtureRecs);
    expect(early.model.view()).toEqual(late.model.view());
    const failed = planted({ asset: false });
    failed.model.setAsset("gradient-m3", { kind: "failed", reason: "its numbers do not match the SHA-256 in its header" });
    expect(failed.model.view().state).toBe("unavailable");
  });

  it("has no baseline for other worlds and fetches nothing for them", () => {
    const cases: [WorldManifest, RegExp][] = [
      [manifest({ cfg: presetConfig(gradient, 1, { mutRate: 1 }) }), /settings differ .*\(mutRate\)/],
      [manifest({ presetId: "imported" }), /opened from a file/],
      [manifest({ cfg: presetConfig(gradient, 1, { neutral: true }) }), /seed 1, one of the runs the baseline is made of/],
      [manifest({ cfg: presetConfig(gradient, 1001, { neutral: true }), seed: 1001 }), /one of the runs the baseline is made of/],
      [manifest({ settings: { censusEvery: 50 } }), /counted every 50 steps/],
      [manifest({ cfg: presetConfig(gradient, 1, { neutral: true }), seed: 2002 }), /runs on seed 1, not the seed 2002/],
      [manifest({}, PRESETS.find((p) => p.id === "spots")!), /baselines only for/],
      [manifest({}, PRESETS.find((p) => p.id === "gradient-m3-waste")!), /baselines only for/],
      [manifest({ init: { ...gradient.init, nutrient: 1 } }), /not planted the way/],
    ];
    for (const [m, why] of cases) {
      const requests: string[] = [];
      const model = new NaturalistModel((p) => requests.push(p));
      model.onLoaded(m, 0, 1);
      const v = model.view();
      expect(v.state).toBe("no-baseline");
      expect(v.status).toBe("The naturalist has no baseline for this world yet.");
      expect(v.detail).toMatch(why);
      expect(requests).toEqual([]);
    }
    // A neutral world outside the envelope matches, scored as neutral.
    expect(matchWorld(manifest({ cfg: presetConfig(gradient, 2002, { neutral: true }), seed: 2002 }))).toEqual({ kind: "match", preset: "gradient-m3", neutral: true });
    // A rule-version or identity mismatch is found when the header arrives.
    const h = asset("gradient-m3").header;
    expect(headerMismatch(manifest({ ruleVersion: RULE_VERSION + 1 }), h)).toMatch(/runs rules v2; the baseline was built under rules v1/);
    expect(headerMismatch(manifest(), { ...h, presetIdentity: "0000" })).toMatch(/has changed since its baseline was built/);
    const model = new NaturalistModel(() => {});
    model.onLoaded(manifest({ ruleVersion: RULE_VERSION + 1 }), 0, 1);
    model.setAsset("gradient-m3", ready("gradient-m3"));
    expect(model.view().state).toBe("no-baseline");
  });

  it("asks for each preset's baseline once and words spots-m3 by its calibrated Z*", () => {
    const requests: string[] = [];
    const model = new NaturalistModel((p) => requests.push(p));
    const spots = PRESETS.find((p) => p.id === "spots-m3")!;
    model.onLoaded(manifest({}, spots, 7), 0, 1);
    model.onLoaded(manifest({}, gradient, 1), 0, 2);
    model.onLoaded(manifest({ runId: "spots-m3-s7-again" }, spots, 7), 0, 3);
    expect(requests).toEqual(["spots-m3", "gradient-m3"]);
    model.setAsset("spots-m3", ready("spots-m3"));
    const v = model.view();
    expect(v.state).toBe("listening");
    expect(v.standing.map((s) => s.chip)).toEqual(["Measured", "Not yet measured", "Not yet measured"]);
    expect(v.rule?.threshold).toBe("A ring needs every census of a window strictly beyond Z* = 11.4665 spreads.");
    // Only spots-m3's own record: no twin bell or v1 number from gradient-m3, and the held-out check with its bound.
    expect(v.standing[0].text).toBe("Of 10 held-out neutral runs, 0 scored above Z* (upper 95% bound 25.9%, from only 10 runs). Z* is the largest score of 20 calibration runs.");
    expect(v.cannot[0]).toContain("No twin bell has been run on this world.");
    expect(v.cannot.join(" ")).not.toMatch(/4 of 10|wounds|feeds heard/);
    expect(v.cannot[2]).toContain("Z* = 11.4665 is the largest of 20 calibration scores, set by one run, and the next largest was 4.05");
    expect(v.cannot[2]).toContain("upper bound 25.9%");
    expect(v.rule?.records.map((r) => r.path)).toEqual([RECORDS.v0]);
  });

  it("a restore between censuses of the same history keeps its notes", () => {
    const { model, m } = planted();
    feed(model, 1, m.runId, fixtureRecs.slice(0, 150));
    const before = model.view().notes;
    expect(before.length).toBeGreaterThan(0);
    model.onLoaded(m, 15_040, 2);
    const v = model.view();
    expect(v.state).toBe("rings");
    expect(v.readTo).toBe(15_000);
    expect(v.notes).toEqual(before);
    feed(model, 2, m.runId, fixtureRecs.slice(150));
    expect(model.view().readTo).toBe(16_000);
    // A census off the baseline's grid stops the reading and says so.
    const off = planted();
    feed(off.model, 1, off.m.runId, fixtureRecs.slice(0, 3));
    off.model.onCensus(msg(1, off.m.runId, { ...fixtureRecs[3], step: 350 }));
    expect(off.model.view().status).toBe("Stopped reading at step 350: the census at step 350 is not on the baseline’s grid of one every 100 steps.");
  });

  it("a checkpoint saved right after a wound at its own step comes back marked", () => {
    const { model, m } = planted();
    feed(model, 1, m.runId, fixtureRecs);
    model.onLoaded({ ...m, interventions: [{ step: 16_000 }] }, 16_000, 2);
    let v = model.view();
    expect(v.state).toBe("touched");
    expect(v.status).toBe("Stopped reading: the world was changed by hand at step 16,000.");
    expect(v.notes.length).toBeGreaterThan(0);
    expect(v.notes.every((n) => n.filedBefore === 16_000)).toBe(true);
    model.onCensus(msg(2, m.runId, later(16_100), { touched: 16_000 }));
    v = model.view();
    expect(v.status).toBe("Stopped reading at step 16,100: the world was changed by hand at step 16,000.");
    // A replay that re-applies a wound after the restored step: the worker says so at once (naturalistTouched) and the notes are marked.
    const r = planted();
    feed(r.model, 1, r.m.runId, fixtureRecs.slice(0, 150));
    const fork = `${r.m.runId}-bq9`;
    r.model.onLoaded({ ...r.m, runId: fork }, 14_900, 2);
    r.model.onTouched(2, fork, 14_925);
    expect(r.model.view().state).toBe("touched");
    expect(r.model.view().notes.every((n) => n.filedBefore === 14_925)).toBe(true);
  });

  it("a note's stretch says it is no longer being read once reading stops", () => {
    const { model, m } = planted();
    feed(model, 1, m.runId, fixtureRecs.slice(0, 150));
    const ongoing = model.view().notes.find((n) => n.signal === "livingCells")!;
    expect(ongoing.stretch).toMatch(/^Still beyond the threshold at step 15,000: \d+ censuses in a row so far\.$/);
    model.onTouched(1, m.runId, 15_000);
    expect(model.view().notes.find((n) => n.signal === "livingCells")!.stretch).toMatch(/^Still beyond the threshold at its last census read, step 15,000: \d+ censuses in a row\.$/);
  });

  it("quiet: no note past step 14,900 carries the notebook's hedge", () => {
    const model = new NaturalistModel(() => {});
    const m = manifest();
    model.onLoaded(m, 0, 1);
    model.setAsset("gradient-m3", wideAsset());
    feed(model, 1, m.runId, fixtureRecs.slice(0, 148));
    expect(model.view().state).toBe("listening");
    expect(model.view().hedge).toEqual([]);
    feed(model, 1, m.runId, fixtureRecs.slice(148));
    const v = model.view();
    expect(v.state).toBe("quiet");
    expect(v.badge).toBe("quiet");
    expect(v.status).toBe("Quiet so far: no signal has stayed beyond the threshold for 50 censuses in a row.");
    expect(v.hedge.map((x) => x.chip)).toEqual(["Measured", "Not yet measured"]);
    expect(v.hedge[0].text).toMatch(/^The furthest any signal has stayed from the neutral median for 50 censuses in a row so far is 0\.00 spreads \(.+\); a note needs at least four\.$/);
    expect(v.hedge[1].text).toContain("That nothing is going on in this world");
  });

  it("a world that fails stops the reading, keeps its notes, and a new load reads again", () => {
    // Before any note: listening becomes stopped, and later censuses of that world are not read.
    const a = planted();
    feed(a.model, 1, a.m.runId, fixtureRecs.slice(0, 20));
    a.model.onFailed();
    let v = a.model.view();
    expect(v.state).toBe("stopped");
    expect(v.status).toBe("Stopped reading after step 2,000: the world stopped and sends no more censuses.");
    feed(a.model, 1, a.m.runId, fixtureRecs.slice(20));
    expect(a.model.view().readTo).toBe(2_000);
    expect(a.model.view().notes).toEqual([]);
    // After a ring: the notes stay, and an ongoing stretch no longer says "so far".
    const b = planted();
    feed(b.model, 1, b.m.runId, fixtureRecs.slice(0, 150));
    const before = b.model.view().notes.length;
    expect(before).toBeGreaterThan(0);
    b.model.onFailed();
    v = b.model.view();
    expect(v.state).toBe("stopped");
    expect(v.notes).toHaveLength(before);
    expect(v.notes.find((n) => n.signal === "livingCells")!.stretch).toMatch(/at its last census read, step 15,000/);
    // A restore of the same history at a census already read takes up the reading again.
    b.model.onLoaded({ ...b.m, runId: `${b.m.runId}-bxyz` }, 15_000, 2);
    expect(b.model.view().state).toBe("rings");
    expect(b.model.view().notes).toHaveLength(before);
    feed(b.model, 2, `${b.m.runId}-bxyz`, fixtureRecs.slice(150));
    expect(b.model.view().readTo).toBe(16_000);
    // An error the worker did not handle stops the reading too, and says so; a world's own failure after it is the one named.
    const c = planted();
    feed(c.model, 1, c.m.runId, fixtureRecs.slice(0, 20));
    c.model.onFailed("worker");
    v = c.model.view();
    expect(v.state).toBe("stopped");
    expect(v.status).toBe("Stopped reading after step 2,000: the lab’s worker reported an error it did not handle.");
    expect(v.detail).toMatch(/^The world may still be running, but the naturalist no longer reads its censuses\./);
    feed(c.model, 1, c.m.runId, fixtureRecs.slice(20));
    expect(c.model.view().readTo).toBe(2_000);
    c.model.onFailed();
    expect(c.model.view().status).toBe("Stopped reading after step 2,000: the world stopped and sends no more censuses.");
    c.model.onFailed("worker");
    expect(c.model.view().status).toBe("Stopped reading after step 2,000: the world stopped and sends no more censuses.");
    c.model.onLoaded({ ...c.m, runId: "gradient-m3-s1-new" }, 0, 2);
    expect(c.model.view().state).toBe("listening");
    // A failure before any world is loaded changes nothing.
    const none = new NaturalistModel(() => {});
    none.onFailed();
    expect(none.view().state).toBe("none");
  });

  it("asks again for a baseline that failed, on the next matching world", () => {
    const { model, m, requests } = planted({ asset: false });
    model.setAsset("gradient-m3", { kind: "failed", reason: "it could not be fetched or read (offline)" });
    expect(model.view().state).toBe("unavailable");
    model.onLoaded({ ...m, runId: "gradient-m3-s1-new" }, 0, 2);
    expect(requests).toEqual(["gradient-m3", "gradient-m3"]);
    expect(model.view().state).toBe("loading");
    model.setAsset("gradient-m3", ready("gradient-m3"));
    expect(model.view().state).toBe("listening");
    model.onLoaded({ ...m, runId: "gradient-m3-s1-newer" }, 0, 3);
    expect(requests).toHaveLength(2);
  });

  it("the worker posts only censuses the panel can still read", () => {
    expect(naturalistReads(300_100, null)).toBe(true);
    expect(naturalistReads(300_200, null)).toBe(false);
    expect(naturalistReads(15_100, 15_000)).toBe(true);
    expect(naturalistReads(15_100, 15_050)).toBe(true);
    expect(naturalistReads(15_200, 15_050)).toBe(false);
  });

  it("never says event or discovery", () => {
    const views = [];
    const { model, m } = planted();
    feed(model, 1, m.runId, fixtureRecs);
    views.push(model.view());
    model.onCensus(msg(1, m.runId, later(16_100), { touched: 16_000 }));
    views.push(model.view());
    const none = new NaturalistModel(() => {});
    none.onLoaded(manifest({ presetId: "imported" }), 0, 1);
    views.push(none.view());
    const late = new NaturalistModel(() => {});
    late.onLoaded(manifest(), 500, 1);
    late.setAsset("gradient-m3", ready("gradient-m3"));
    views.push(late.view());
    const spots = new NaturalistModel(() => {});
    spots.onLoaded(manifest({}, PRESETS.find((p) => p.id === "spots-m3")!, 3), 0, 1);
    spots.setAsset("spots-m3", ready("spots-m3"));
    views.push(spots.view());
    const quiet = new NaturalistModel(() => {});
    quiet.onLoaded(manifest(), 0, 1);
    quiet.setAsset("gradient-m3", wideAsset());
    feed(quiet, 1, manifest().runId, fixtureRecs);
    expect(quiet.view().state).toBe("quiet");
    views.push(quiet.view());
    quiet.onFailed();
    views.push(quiet.view());
    const quietWorker = new NaturalistModel(() => {});
    quietWorker.onLoaded(manifest(), 0, 1);
    quietWorker.setAsset("gradient-m3", wideAsset());
    feed(quietWorker, 1, manifest().runId, fixtureRecs.slice(0, 10));
    quietWorker.onFailed("worker");
    views.push(quietWorker.view());
    const html = readFileSync(file("apps/lab/lab/index.html"), "utf8");
    const section = html.slice(html.indexOf('id="naturalist"'), html.indexOf("</section>", html.indexOf('id="naturalist"')));
    const text = [...views.flatMap(viewStrings), section].join("\n");
    expect(text).not.toMatch(/\bevents?\b/i);
    expect(text).not.toMatch(/discover/i);
    expect(text).not.toMatch(/\b(Confirmed|Seen)\b/);
  });
});
