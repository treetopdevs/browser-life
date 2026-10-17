import { describe, expect, it } from "vitest";
import {
  BARS,
  CALL_SETTINGS_FILE,
  CENSUS_EVERY,
  DIGEST_FIELDS,
  HIT_TOLERANCE,
  LINE_EVERY,
  ID_SEED,
  MANIFEST_SEED,
  S,
  U_COUNT,
  U_MIN,
  U_STEP,
  V1_SIGNALS,
  WINDOW_STEPS,
  assemble,
  bandRows,
  buildPrompt,
  buildSchema,
  callSettingsProblem,
  censusProblem,
  checkReceipt,
  codeBaselineT2,
  composePrompt,
  decisionOutcome,
  digestRows,
  firstDifference,
  formatNumber,
  itemRun,
  lineageBlocksThrough,
  loadTable,
  makeManifest,
  normaliseReason,
  orientationReport,
  parseAnswer,
  pilotLayout,
  planItems,
  productionLayout,
  readPairRecord,
  readVoids,
  refKey,
  renderManifest,
  renderT1,
  renderT2,
  scoreTask,
  seriesThrough,
  sha256Hex,
  t1Comparator,
  t2Decide,
  t2Windows,
  tablesAgreeThrough,
  twinRecordProblem,
  twinLabel,
  withhold,
  withholdComparator,
  type Answer,
  type ItemArm,
  type ManifestItem,
  type Outcome,
  type PlannedItem,
  type RunRef,
  type RunTable,
  type Task,
} from "../lib/bell-digest.ts";
import { SIGNALS, mergeCensuses, parseSeries, splitLines } from "../lib/bell.ts";
import { BELL1_VERSION, NOTE1_PATH } from "../lib/bell1.ts";
import { rng } from "../lib/measures6.ts";

// ---------------------------------------------------------------------------------------------
// Helpers.

const NS = SIGNALS.length;
/** A table with a vector at every 100-step census in [lo, hi]. */
function makeTable(lo: number, hi: number, f: (step: number, k: number) => number): RunTable {
  const t: RunTable = new Map();
  for (let s = lo; s <= hi; s += CENSUS_EVERY) t.set(s, Array.from({ length: NS }, (_, k) => f(s, k)));
  return t;
}
const asManifestItems = (items: PlannedItem[]): ManifestItem[] =>
  items.map((i) => ({ id: i.id, task: i.task, seed: i.seed, arm: i.arm, U: i.U, ...(i.orientation ? { orientation: i.orientation } : {}), file: null, digestSha256: null, firstDiffT: null, void: null }));
const ok = (o: Partial<Answer> = {}): Outcome => ({ status: "ok", answer: { intervention: "no", world: null, t: null, kind: null, notes: [], ...o } });
const DEFAULT_SEEDS_T = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const EXPECTED_KIND: Record<ItemArm, "removal" | "addition"> = { nudge: "removal", nudge2: "removal", l64: "removal", l96: "removal", f: "addition", base: "removal" };

/** The answers of a perfect reader: yes with the right twin / the right t on l64, l96 and f, no on the rest. */
function perfect(items: PlannedItem[]): Map<string, Outcome> {
  const m = new Map<string, Outcome>();
  for (const i of items) {
    const positive = i.arm === "l64" || i.arm === "l96" || i.arm === "f";
    m.set(i.id, positive ? ok({ intervention: "yes", world: i.task === "T1" ? twinLabel(i) : null, t: i.U + LINE_EVERY, kind: EXPECTED_KIND[i.arm] }) : ok());
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
describe("planItems: the manifest's enumeration and draws", () => {
  const items = planItems();
  it("has the note's 100 items in order: T1 seed-major, then T2 twins, nudge2, bases", () => {
    expect(items.length).toBe(100);
    expect(items.slice(0, 40).map((i) => `${i.task} ${i.arm} ${i.seed}`)).toEqual(
      Array.from({ length: 10 }, (_, s) => ["nudge", "l64", "l96", "f"].map((arm) => `T1 ${arm} ${s + 1}`)).flat());
    expect(items.slice(40, 80).map((i) => `${i.task} ${i.arm} ${i.seed}`)).toEqual(
      Array.from({ length: 10 }, (_, s) => ["nudge", "l64", "l96", "f"].map((arm) => `T2 ${arm} ${s + 1}`)).flat());
    expect(items.slice(80, 90).map((i) => `${i.arm} ${i.seed}`)).toEqual(Array.from({ length: 10 }, (_, s) => `nudge2 ${s + 1}`));
    expect(items.slice(90).map((i) => `${i.arm} ${i.seed}`)).toEqual(Array.from({ length: 10 }, (_, s) => `base ${s + 1}`));
  });
  it("draws U first and then the T1 coin from one mulberry32 stream seeded at 6,100,001", () => {
    const r = rng(6_100_001);
    expect(MANIFEST_SEED).toBe(6_100_001);
    for (const it of items) {
      expect(it.U).toBe(5000 + 200 * Math.floor(r() * 51));
      if (it.task === "T1") expect(it.orientation).toBe(r() < 0.5 ? "X=twin" : "X=base");
      else expect(it.orientation).toBeUndefined();
    }
  });
  it("keeps U on the grid 5,000..15,000 by 200 (51 values) and states the coin: rng() < 0.5 means X is the twin", () => {
    for (const it of items) {
      expect(it.U).toBeGreaterThanOrEqual(5000);
      expect(it.U).toBeLessThanOrEqual(15000);
      expect((it.U - U_MIN) % U_STEP).toBe(0);
    }
    expect(U_COUNT).toBe(51);
    const t1 = items.filter((i) => i.task === "T1");
    expect(t1.some((i) => i.orientation === "X=twin")).toBe(true);
    expect(t1.some((i) => i.orientation === "X=base")).toBe(true);
    expect(twinLabel({ orientation: "X=twin" })).toBe("X");
    expect(twinLabel({ orientation: "X=base" })).toBe("Y");
  });
  it("is deterministic and gives the ids t1-01..t1-40 and t2-01..t2-60 once each", () => {
    expect(planItems()).toEqual(planItems());
    expect(planItems({ manifestSeed: 1 })).not.toEqual(planItems());
    expect(items.filter((i) => i.task === "T1").map((i) => i.id).sort()).toEqual(Array.from({ length: 40 }, (_, i) => `t1-${String(i + 1).padStart(2, "0")}`));
    expect(items.filter((i) => i.task === "T2").map((i) => i.id).sort()).toEqual(Array.from({ length: 60 }, (_, i) => `t2-${String(i + 1).padStart(2, "0")}`));
    expect(new Set(items.map((i) => i.id)).size).toBe(100);
  });
  it("deals the ids by a shuffle apart from the manifest stream: the draws are untouched, and the number carries no arm or seed", () => {
    // The draws (U, coin) do not depend on the id seed; only the ids move.
    const other = planItems({ idSeed: ID_SEED + 1 });
    expect(other.map(({ id: _i, ...d }) => d)).toEqual(items.map(({ id: _i, ...d }) => d));
    expect(other.map((i) => i.id)).not.toEqual(items.map((i) => i.id));
    expect(ID_SEED).not.toBe(MANIFEST_SEED);
    const num = (i: PlannedItem) => Number(i.id.slice(3));
    // Enumeration order is not id order: the unshuffled ordinal pattern (arm cycling with period 4; T2 classes in ranges) is gone.
    const t1 = items.filter((i) => i.task === "T1"), t2 = items.filter((i) => i.task === "T2");
    expect(t1.map(num)).not.toEqual(t1.map((_, k) => k + 1));
    expect(t2.map(num)).not.toEqual(t2.map((_, k) => k + 1));
    expect(t1.every((i, k) => (num(i) - 1) % 4 === (k % 4))).toBe(false);
    // Taken in id order, the 20 negatives of T2 (bases and nudge2 and nudge) are not one contiguous block.
    const byId = [...t2].sort((a, b) => num(a) - num(b));
    const negativeRuns = byId.map((i) => (i.arm === "base" || i.arm === "nudge2" ? 1 : 0)).join("");
    expect(negativeRuns).not.toMatch(/1{20}/);
    expect(byId.slice(0, 20).some((i) => i.arm === "base")).toBe(true); // the first 20 ids hold some of the bases...
    expect(byId.slice(0, 20).some((i) => i.arm !== "base")).toBe(true); // ...and some that are not
  });
  it("lets a twin's T1 and T2 draws differ (and coincide only by chance)", () => {
    const t1 = items.filter((i) => i.task === "T1"), t2 = items.slice(40, 80);
    expect(t1.map((i) => i.U)).not.toEqual(t2.map((i) => i.U));
  });
});

// ---------------------------------------------------------------------------------------------
describe("number format and digests", () => {
  it("prints integers as integers and other values to 3 decimals", () => {
    expect(formatNumber(36900)).toBe("36900");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(7733.92)).toBe("7733.920");
    expect(formatNumber(0.0004)).toBe("0.000");
    expect(formatNumber(-0.0004)).toBe("0.000");
    expect(formatNumber(2.5)).toBe("2.500");
    expect(formatNumber(-3)).toBe("-3");
    expect(() => formatNumber(NaN)).toThrow();
  });
  it("renders 151 lines of 13 fields, steps relative to the window start", () => {
    const rows = Array.from({ length: 151 }, (_, i) => Array.from({ length: NS }, (_, k) => i * 10 + k));
    const t1 = renderT1(rows, rows).split("\n");
    expect(t1[0]).toBe("DIGEST X");
    expect(t1[1].split(" ")).toEqual(["t", ...DIGEST_FIELDS]);
    expect(t1[2]).toBe(`0 ${Array.from({ length: NS }, (_, k) => k).join(" ")}`);
    expect(t1[2 + 150].startsWith("30000 ")).toBe(true);
    expect(t1[2 + 151]).toBe("");
    expect(t1[2 + 152]).toBe("DIGEST Y");
    expect(t1.length).toBe(2 + 151 + 1 + 2 + 151 + 1);
    const band = rows.map((r) => r.map((v) => ({ q25: v - 1, median: v + 0.5, q75: v + 2 })));
    const t2 = renderT2(rows, band).split("\n");
    expect(t2[2]).toBe(`0 ${rows[0].map((v) => `${v}(${v - 1}/${v}.500/${v + 2})`).join(" ")}`);
  });
  it("shows counters as C(t) - C(t - 1000) from the run's own history, across the window start", async () => {
    // A cumulative counter C(n) = n^2 at census n (step 100 n); the lineage rows match livingCells and lineages exactly.
    async function* merged() {
      for (let n = 1; n <= 40; n++) {
        const rows: [string, number][] = [["0:1", 10], ["0:2", n]];
        yield { rec: { step: n * 100, livingCells: 10 + n, lineages: 2, individuals: 3, meanMass: 1.5, fissions: n * n, fusions: 2 * n, buddings: 0, mutations: 7 * n }, rows };
      }
    }
    const table = await loadTable("synthetic", merged(), { lo: 2000, hi: 3000, steps: 4000 });
    expect([...table.keys()][0]).toBe(2000);
    expect(table.size).toBe(11);
    const fis = SIGNALS.findIndex((d) => d.name === "fissions"), mut = SIGNALS.findIndex((d) => d.name === "mutations");
    // The window starts at step 2000 (census 20): its counter is 400 - 100 (census 10), counted from before the window.
    expect(table.get(2000)![fis]).toBe(400 - 100);
    expect(table.get(2200)![fis]).toBe(22 * 22 - 12 * 12);
    expect(table.get(2000)![mut]).toBe(7 * 10);
    const rows = digestRows(table, 2000, 6);
    expect(rows[0][fis]).toBe(300);
    expect(rows[1][fis]).toBe(22 * 22 - 12 * 12);
    expect(rows[1][SIGNALS.findIndex((d) => d.name === "dominantShare")]).toBeCloseTo(22 / 32, 12);
    expect(() => digestRows(table, 2000, 7)).toThrow(/step 3200/);
  });
  it("rejects a run with a gap, a failed lineage check, a missing field, or the wrong length", async () => {
    const rec = (n: number, extra: Record<string, unknown> = {}) => ({ step: n * 100, livingCells: 5, lineages: 1, ...extra });
    const gen = (recs: Record<string, unknown>[], rows: [string, number][] = [["0:1", 5]]) => (async function* () {
      for (const r of recs) yield { rec: r as { step: number } & Record<string, unknown>, rows };
    })();
    await expect(loadTable("r", gen([rec(1), rec(3)]), { lo: 0, hi: 1e9, steps: 300 })).rejects.toThrow(/census 2 is at step 300, expected 200/);
    await expect(loadTable("r", gen([rec(1), rec(2)]), { lo: 0, hi: 1e9, steps: 300 })).rejects.toThrow(/2 censuses/);
    await expect(loadTable("r", gen([rec(1, { livingCells: 6 })]), { lo: 0, hi: 1e9, steps: 100 })).rejects.toThrow(/sum to 5 cells, livingCells is 6/);
    await expect(loadTable("r", gen([{ step: 100, lineages: 1 }]), { lo: 0, hi: 1e9, steps: 100 })).rejects.toThrow(/livingCells is null/);
    await expect(loadTable("r", gen([rec(1)], [["0:1", 5], ["0:2", 0]]), { lo: 0, hi: 1e9, steps: 100 })).rejects.toThrow(/2 lineage rows, lineages is 1/);
  });
  it("reads a base longer than the horizon to the horizon only (truncate), and still refuses a twin that runs on", async () => {
    // 1,000-step stream; the horizon is 400 steps. Beyond it the data is not even valid (a gap and a bad census): never looked at.
    let closed = false;
    async function* merged(n: number) {
      try {
        for (let i = 1; i <= n; i++) {
          const beyond = i > 4;
          yield { rec: { step: beyond ? i * 100 + 7 : i * 100, livingCells: beyond ? NaN : 5, lineages: 1 } as { step: number } & Record<string, unknown>, rows: [["0:1", 5]] as [string, number][] };
        }
      } finally {
        closed = true;
      }
    }
    const table = await loadTable("base", merged(10), { lo: 0, hi: 1e9, steps: 400, truncate: true });
    expect([...table.keys()]).toEqual([100, 200, 300, 400]);
    expect(closed).toBe(true); // the stream is closed on the early exit
    // A twin (no truncate) fails on the same stream: the census after the horizon is not the horizon's.
    await expect(loadTable("twin", merged(10), { lo: 0, hi: 1e9, steps: 400 })).rejects.toThrow(/census 5 is at step 507/);
    // ... and, with good data, on a longer one.
    async function* longer() {
      for (let i = 1; i <= 5; i++) yield { rec: { step: i * 100, livingCells: 5, lineages: 1 } as { step: number } & Record<string, unknown>, rows: [["0:1", 5]] as [string, number][] };
    }
    await expect(loadTable("twin", longer(), { lo: 0, hi: 1e9, steps: 400 })).rejects.toThrow(/5 censuses \(500 steps\), expected 4/);
    // A truncated base that stops short still fails.
    await expect(loadTable("base", merged(3), { lo: 0, hi: 1e9, steps: 400, truncate: true })).rejects.toThrow(/3 censuses/);
  });
  it("truncates a base through the real composed stream: garbage after the horizon in both files is never read", async () => {
    // series.jsonl and lineages.tsv as text chunks, through splitLines, parseSeries, the horizon cuts and mergeCensuses, as loadRun does.
    const H = 400;
    const seriesText = [1, 2, 3, 4].map((n) => JSON.stringify({ step: n * 100, livingCells: 5, lineages: 1 })).join("\n") + "\nnot json at all\n" + JSON.stringify({ step: 700 }) + "\n";
    // The first line after the horizon's block is malformed (a non-numeric step), then a block out of order: lineageCensuses would throw on either.
    const lineText = "step\tkey\tcells\n" + [1, 2, 3, 4].map((n) => `${n * 100}\t0:1\t5`).join("\n") + "\nxyz\t0:1\t5\n100\t0:1\t9\n";
    async function* chunks(text: string) {
      for (let i = 0; i < text.length; i += 7) yield text.slice(i, i + 7);
    }
    let lineagesRead = 0;
    async function* counted(lines: AsyncIterable<string>) {
      for await (const l of lines) {
        lineagesRead++;
        yield l;
      }
    }
    const merged = () => mergeCensuses("base", seriesThrough(parseSeries("base", splitLines(chunks(seriesText))), H), lineageBlocksThrough("base", counted(splitLines(chunks(lineText))), H));
    const table = await loadTable("base", merged(), { lo: 0, hi: 1e9, steps: H, truncate: true });
    expect([...table.keys()]).toEqual([100, 200, 300, 400]);
    expect(lineagesRead).toBe(6); // the header, four rows, and the one line that ends the horizon's census (never parsed further)
    // Uncut, the same series fails past the horizon (what the twin path, read whole, must still do).
    await expect(loadTable("twin", mergeCensuses("twin", parseSeries("twin", splitLines(chunks(seriesText))), lineageBlocksThrough("twin", splitLines(chunks(lineText)), H)), { lo: 0, hi: 1e9, steps: H })).rejects.toThrow(/not JSON/);
    // Within the horizon the lineage reader is as strict as lineageCensuses: a step out of order throws.
    const bad = "h\n100\t0:1\t5\n300\t0:1\t5\n200\t0:1\t5\n";
    await expect((async () => {
      for await (const _ of lineageBlocksThrough("r", splitLines(chunks(bad)), 400));
    })()).rejects.toThrow(/step 200 follows 300/);
    // No rows at the horizon (an extinct census): the census before it is yielded, and the stream ends at the first line past it.
    const blocks: number[] = [];
    for await (const [st] of lineageBlocksThrough("r", splitLines(chunks("h\n100\t0:1\t5\n200\t0:1\t5\n500\t0:1\t5\nzzz\n")), 400)) blocks.push(st);
    expect(blocks).toEqual([100, 200]);
    // A series with no record past the horizon is passed through whole.
    const st: number[] = [];
    for await (const r of seriesThrough((async function* () {
      for (const n of [1, 2]) yield { step: n * 100 };
    })(), 400)) st.push(r.step);
    expect(st).toEqual([100, 200]);
  });
  it("normaliseReason strips absolute paths and keeps relative run ids", () => {
    expect(normaliseReason("NotFound: No such file or directory (os error 2): open '/Users/x/runs/a/b.json'")).toBe("NotFound: No such file or directory (os error 2): open '<path>'");
    expect(normaliseReason("bell-v1-twins-l96/gradient-m3/treatment/seed-3: 5 censuses")).toBe("bell-v1-twins-l96/gradient-m3/treatment/seed-3: 5 censuses");
    expect(normaliseReason("/abs/dir/file failed")).toBe("<path> failed");
  });
  it("censusProblem: finite fields and exact rows; an empty census only with both 0", () => {
    expect(censusProblem({ livingCells: 5, lineages: 1 }, [["a", 5]])).toBeNull();
    expect(censusProblem({ livingCells: 0, lineages: 0 }, [])).toBeNull();
    expect(censusProblem({ livingCells: 5, lineages: 1 }, [])).toMatch(/0 cells/);
    expect(censusProblem({ livingCells: 0, lineages: 1 }, [])).toMatch(/0 lineage rows/);
    expect(censusProblem({ livingCells: Infinity, lineages: 1 }, [])).toMatch(/livingCells/);
    expect(censusProblem({ livingCells: 5, lineages: "1" }, [["a", 5]])).toMatch(/lineages/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the stated normal", () => {
  it("takes quantiles of the references with v0's rule", () => {
    const refs = Array.from({ length: 9 }, (_, r) => [Array.from({ length: NS }, () => r + 1)]);
    const b = bandRows(refs);
    expect(b[0][0]).toEqual({ q25: 3, median: 5, q75: 7 });
    expect(bandRows([[[1, ...Array(NS - 1).fill(0)]], [[2, ...Array(NS - 1).fill(0)]]])[0][0]).toEqual({ q25: 1.25, median: 1.5, q75: 1.75 });
    expect(() => bandRows([])).toThrow();
  });
  it("leaves the item's own seed out: nine other bases, never the item itself", () => {
    const L = productionLayout();
    for (const seed of L.seeds) {
      const refs = L.refsOf({ seed, arm: "l96" });
      expect(refs.length).toBe(9);
      expect(refs.every((r) => r.kind === "base" && r.seed !== seed)).toBe(true);
    }
  });
  it("ignores an own-seed outlier in the band, for twins and bases alike", () => {
    const L = productionLayout();
    const items = planItems().filter((i) => i.task === "T2" && (i.seed === 3) && (i.arm === "base" || i.arm === "l96"));
    expect(items.length).toBe(2);
    // Base k has living_cells 1000 k at every census; seed 3's base is the 'outlier' only for the others' bands.
    const tables = new Map<string, RunTable>();
    const get = (ref: RunRef) => {
      const k = refKey(ref);
      if (!tables.has(k)) tables.set(k, makeTable(184000, 226000, (s, i) => (i === 0 ? 1000 * ref.seed + (ref.kind === "twin" && s > S ? 7 : 0) : 5)));
      return { table: tables.get(k)! };
    };
    const built = assemble(items, L, get);
    for (const b of built) {
      const line = b.text!.split("\n")[2].split(" ")[1]; // the first value with its band
      // Others: 1000, 2000, 4000..10000: sorted [1,2,4,5,6,7,8,9,10] thousand; q25 = 4000, median 6000, q75 = 8000.
      expect(line.endsWith("(4000/6000/8000)")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("assemble: the whole manifest on synthetic runs", () => {
  const L = productionLayout();
  const items = planItems();
  const mk = (ref: RunRef, twinBump = true) =>
    makeTable(184000, 226000, (s, k) => {
      const base = 1000 * k + 10 * ref.seed + (s % 700) / 100 + (k === 3 ? 0.5 : 0);
      if (ref.kind === "twin" && s > S && twinBump) return base + (ref.arm === "f" ? 3 : -3) * (k + 1);
      return base;
    });
  const run = () => assemble(items, L, (r) => ({ table: mk(r) }));
  const built = run();

  it("builds all 100 items, with a T2 band and a T1 pair", () => {
    expect(built.every((b) => b.void === null && b.text !== null)).toBe(true);
    expect(built[0].text!.startsWith("DIGEST X\n")).toBe(true);
    expect(built[40].text!.startsWith("DIGEST\n")).toBe(true);
    expect(built[40].text!.split("\n").length).toBe(2 + 151 + 1);
  });
  it("puts the twin in X exactly when the coin said so, and the pair is byte-equal through t = U and first differs at U + 200", () => {
    for (const b of built.filter((x) => x.item.task === "T1")) {
      const lines = b.text!.split("\n");
      const X = lines.slice(2, 153), Y = lines.slice(156, 307);
      expect(X.length).toBe(151);
      expect(Y.length).toBe(151);
      const u = b.item.U / LINE_EVERY;
      expect(X.slice(0, u + 1)).toEqual(Y.slice(0, u + 1));
      expect(X[u + 1]).not.toEqual(Y[u + 1]);
      expect(b.firstDiffT).toBe(b.item.U + LINE_EVERY);
      // f twins add, the others subtract: the twin's living_cells is higher in X exactly when (twin is X) xor (arm is not f).
      const vx = Number(X[u + 1].split(" ")[1]), vy = Number(Y[u + 1].split(" ")[1]);
      const twinIsX = b.item.orientation === "X=twin";
      expect(twinIsX ? vx > vy : vy > vx).toBe(b.item.arm === "f");
    }
  });
  it("shows no seed, arm, run id or absolute step in any item", () => {
    for (const b of built) {
      for (const line of b.text!.split("\n")) {
        expect(line).not.toMatch(/seed|nudge|lesion|feed|l64|l96|base|twin|bell-v1|replay/i);
        if (/^\d/.test(line)) expect(Number(line.split(" ")[0])).toBeLessThanOrEqual(WINDOW_STEPS);
      }
    }
  });
  it("is deterministic: the same inputs give the same manifest text and hashes", async () => {
    const a = renderManifest(await makeManifest(built, L)), b = renderManifest(await makeManifest(run(), L));
    expect(a).toBe(b);
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
    const m = JSON.parse(a);
    expect(m.items.length).toBe(100);
    expect(m.items[0]).toMatchObject({ id: items[0].id, task: "T1", seed: 1, arm: "nudge", file: `items/${items[0].id}.txt` });
    expect(m.idRule).toMatch(new RegExp(`mulberry32 stream seeded at ${ID_SEED}`));
    expect(m.items[0].digestSha256).toBe(await sha256Hex(built[0].text!));
    expect(m.items[0].digestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.orientationRule).toMatch(/rng\(\) < 0\.5 means X is the twin/);
    // A changed digest changes the manifest hash.
    const other = assemble(items, L, (r) => ({ table: mk(r, false) }));
    expect(await sha256Hex(renderManifest(await makeManifest(other, L)))).not.toBe(await sha256Hex(a));
  });
  it("keeps every draw when a twin is void, marks its items void with no digest, and leaves the others unchanged", () => {
    const voided = assemble(items, L, (r) => (r.kind === "twin" && r.arm === "l96" && r.seed === 4 ? { void: "exit 1" } : { table: mk(r) }));
    expect(voided.map((b) => b.item)).toEqual(built.map((b) => b.item));
    const bad = voided.filter((b) => b.void);
    expect(bad.map((b) => `${b.item.task} ${b.item.arm} ${b.item.seed}`).sort()).toEqual(["T1 l96 4", "T2 l96 4"]);
    expect(bad.every((b) => b.text === null && b.void === "exit 1")).toBe(true);
    voided.forEach((b, i) => {
      if (!b.void) expect(b.text).toBe(built[i].text);
    });
    // The twin record's void list works the same way and costs no table.
    const voids = new Map([[items[2].id, "twin bell: void"]]);
    expect(assemble(items, L, (r) => ({ table: mk(r) }), voids)[2]).toMatchObject({ void: "twin bell: void", text: null });
  });
  it("voids a twin that differs from its base before S, and a window that leaves the run", () => {
    const early = assemble(items, L, (r) => ({ table: r.kind === "twin" && r.arm === "nudge" && r.seed === 2 ? makeTable(184000, 226000, (s, k) => 1000 * k + 20 + (s === 190000 ? 1 : 0) + (s % 700) / 100 + (k === 3 ? 0.5 : 0)) : mk(r) }));
    const t1Nudge2 = items.find((i) => i.task === "T1" && i.arm === "nudge" && i.seed === 2)!, t2Nudge2 = items.find((i) => i.task === "T2" && i.arm === "nudge" && i.seed === 2)!;
    expect(early.filter((b) => b.void).map((b) => b.item.id).sort()).toEqual([t1Nudge2.id, t2Nudge2.id].sort());
    expect(early.find((b) => b.item.id === t1Nudge2.id)!.void).toMatch(/differs from its base at step 190000/);
    const short = assemble(items.slice(0, 4), { ...L, steps: 200_000 }, (r) => ({ table: mk(r) }));
    expect(short.every((b) => b.void && /not inside the run/.test(b.void))).toBe(true);
  });
  it("throws when a base is unusable (the bases are not optional)", () => {
    expect(() => assemble(items.slice(0, 4), L, (r) => (r.kind === "base" ? { void: "gone" } : { table: mk(r) }))).toThrow(/base:1 is needed and unusable/);
  });
  it("tablesAgreeThrough and firstDifference", () => {
    const a = makeTable(100, 500, (s) => s), b = makeTable(100, 500, (s) => (s > 300 ? s + 1 : s));
    expect(tablesAgreeThrough(a, b, 300)).toBeNull();
    expect(tablesAgreeThrough(a, b, 400)).toMatch(/step 400/);
    expect(firstDifference([[1], [2], [3]], [[1], [2], [4]])).toBe(2 * LINE_EVERY);
    expect(firstDifference([[1]], [[1]])).toBeNull();
  });
  it("the pilot layout is a test layout with 101 lines and no nine bases", () => {
    const P = pilotLayout();
    expect(P.mode).toBe("pilot");
    expect(P.refsOf({ seed: 2001, arm: "l96" }).map(refKey)).not.toContain("twin:l96:2001");
    expect(itemRun({ seed: 3, arm: "base" })).toEqual({ kind: "base", seed: 3 });
    expect(itemRun({ seed: 3, arm: "nudge2" })).toEqual({ kind: "twin", arm: "nudge2", seed: 3 });
  });
});

// ---------------------------------------------------------------------------------------------
describe("prompts and schemas", () => {
  it("name only the schema's labels: no S, arm, dose or seed vocabulary", () => {
    for (const task of ["T1", "T2"] as const) {
      const p = buildPrompt(task);
      expect(p).not.toMatch(/lesion|feed|nudge|twin|seed|radius|quanta|200000|l64|l96|\bbase\b/i);
      expect(p).not.toMatch(/\bS\b/);
      expect(p).toMatch(/removal/);
      expect(p).toMatch(/addition/);
      expect(p).toContain("151 lines");
      expect(p).toContain(`"intervention": "yes" | "no"`);
      for (const f of DIGEST_FIELDS) expect(p).toContain(f);
    }
    expect(buildPrompt("T1")).toContain('"world": "X" | "Y" | null');
    expect(buildPrompt("T2")).toContain('"world": null');
    expect(buildPrompt("T2")).toContain("percentiles of nine other worlds");
    expect(buildPrompt("T1")).not.toContain("percentiles");
  });
  it("is stable, and a call's text is the prompt then the item", () => {
    expect(buildPrompt("T1")).toBe(buildPrompt("T1"));
    expect(buildPrompt("T1")).not.toBe(buildPrompt("T2"));
    expect(composePrompt("P\n", "I\n")).toBe("P\n\nI\n");
    const s = buildSchema("T1") as { properties: { world: unknown; notes: { minItems: number } }; required: string[] };
    expect(s.required).toEqual(["intervention", "world", "t", "kind", "notes"]);
    expect(s.properties.notes.minItems).toBe(3);
    expect(buildSchema("T2")).toMatchObject({ properties: { world: { type: "null" } } });
  });
});

// ---------------------------------------------------------------------------------------------
describe("parseAnswer: the answer contract", () => {
  const notes = [1, 2, 3].map((i) => ({ t: i * 200, measure: "living_cells", values: "100", note: "x" }));
  const base = { intervention: "yes", world: "X", t: 1000, kind: "removal", notes };
  const txt = (o: Record<string, unknown>) => JSON.stringify(o);
  const bad = (o: unknown, task: Task = "T1") => parseAnswer(typeof o === "string" ? o : JSON.stringify(o), task);

  it("accepts a well-formed reply, bare or inside one code fence", () => {
    expect(parseAnswer(txt(base), "T1").status).toBe("ok");
    expect(parseAnswer("```json\n" + txt(base) + "\n```", "T1").status).toBe("ok");
    expect(parseAnswer("```\n" + txt(base) + "\n```\n", "T1").status).toBe("ok");
    expect(parseAnswer(` ${txt({ ...base, intervention: "no", world: null, t: null, kind: null })}\n`, "T2").status).toBe("ok");
    const r = parseAnswer(txt(base), "T1");
    expect(r.status === "ok" && r.answer.world).toBe("X");
  });
  it("rejects synonyms and case variants", () => {
    for (const v of ["Yes", "YES", "true", true, "y", "yes.", 1, null]) expect(bad({ ...base, intervention: v }).status).toBe("invalid");
    expect(bad({ ...base, world: "x" }).status).toBe("invalid");
    expect(bad({ ...base, world: "Z" }).status).toBe("invalid");
    expect(bad({ ...base, kind: "removed" }).status).toBe("invalid");
    expect(bad({ ...base, kind: "add" }).status).toBe("invalid");
    expect(bad({ ...base, kind: "Removal" }).status).toBe("invalid");
  });
  it("allows null fields where the schema does", () => {
    expect(bad({ ...base, intervention: "no", world: null, t: null, kind: null }).status).toBe("ok");
    expect(bad({ ...base, world: null }).status).toBe("ok"); // valid, though a miss when scored
    expect(bad({ ...base, t: null }).status).toBe("ok");
    expect(bad({ ...base, kind: null }).status).toBe("ok");
  });
  it("T2 needs world null; T1 needs X, Y or null", () => {
    expect(bad({ ...base, world: "X" }, "T2").status).toBe("invalid");
    expect(bad({ ...base, world: null }, "T2").status).toBe("ok");
  });
  it("is strict about t", () => {
    for (const t of [250, -200, 30200, "200", 200.5, true, [200]]) expect(bad({ ...base, t }).status).toBe("invalid");
    expect(parseAnswer(txt({ ...base, t: 30000 }), "T1").status).toBe("ok");
    expect(parseAnswer(txt({ ...base, t: 30200 }), "T1", 30_000).status).toBe("invalid");
    expect(parseAnswer(txt({ ...base, t: 20000 }), "T1", 20_000).status).toBe("ok");
    expect(parseAnswer(txt({ ...base, t: 20200 }), "T1", 20_000).status).toBe("invalid");
  });
  it("rejects extra keys, missing keys and malformed notes", () => {
    expect(bad({ ...base, comment: "hi" }).status).toBe("invalid");
    const { notes: _n, ...noNotes } = base;
    expect(bad(noNotes).status).toBe("invalid");
    expect(bad({ ...base, notes: notes.slice(0, 2) }).status).toBe("invalid");
    expect(bad({ ...base, notes: [...notes, notes[0]] }).status).toBe("invalid");
    expect(bad({ ...base, notes: [{ ...notes[0], extra: 1 }, notes[1], notes[2]] }).status).toBe("invalid");
    expect(bad({ ...base, notes: [{ ...notes[0], values: 100 }, notes[1], notes[2]] }).status).toBe("invalid");
    expect(bad({ ...base, notes: [{ ...notes[0], t: 1.5 }, notes[1], notes[2]] }).status).toBe("invalid");
    expect(bad({ ...base, notes: "none" }).status).toBe("invalid");
  });
  it("rejects malformed JSON, prose around the JSON, non-objects, and calls an empty reply missing", () => {
    expect(bad("{").status).toBe("invalid");
    expect(bad("Sure! " + txt(base)).status).toBe("invalid");
    expect(bad(txt(base) + " Hope that helps").status).toBe("invalid");
    expect(bad("[1]").status).toBe("invalid");
    expect(bad("null").status).toBe("invalid");
    expect(bad('"yes"').status).toBe("invalid");
    expect(bad("```json\n{\n```").status).toBe("invalid");
    expect(parseAnswer("", "T1").status).toBe("missing");
    expect(parseAnswer("  \n", "T1").status).toBe("missing");
    expect(parseAnswer(null, "T2").status).toBe("missing");
    expect(parseAnswer(undefined, "T2").status).toBe("missing");
  });
  it("checks receipts against the named column, X and Y apart, and the band in T2", () => {
    const row = (lc: number, ind: number) => Array.from({ length: NS }, (_, k) => (k === 0 ? lc : k === 1 ? ind : 0.5));
    const X = [row(100, 7), row(120, 8)], Y = [row(100, 7), row(130, 9)];
    const t1 = renderT1(X, Y);
    // living_cells at t = 200 is 120 in X and 130 in Y; individuals 8 and 9.
    expect(checkReceipt({ t: 200, measure: "living_cells", values: "120", note: "" }, t1)).toEqual({ tOk: true, measureOk: true, valuesOk: true, unchecked: null, byDigest: { X: true, Y: false } });
    expect(checkReceipt({ t: 200, measure: "living_cells", values: "130", note: "" }, t1).byDigest).toEqual({ X: false, Y: true });
    expect(checkReceipt({ t: 200, measure: "Living cells", values: "120.0", note: "" }, t1).valuesOk).toBe(true);
    // A number from another column on the same line is not a receipt for this one (pooling the line accepted it).
    expect(checkReceipt({ t: 200, measure: "living_cells", values: "8", note: "" }, t1).valuesOk).toBe(false);
    expect(checkReceipt({ t: 200, measure: "individuals", values: "8", note: "" }, t1)).toMatchObject({ valuesOk: true, byDigest: { X: true, Y: false } });
    // A paired note quotes the named column from each digest: it passes, though neither digest alone holds both numbers.
    expect(checkReceipt({ t: 200, measure: "living_cells", values: "X: 120, Y: 130", note: "" }, t1)).toMatchObject({ valuesOk: true, byDigest: { X: false, Y: false } });
    // A number from another column still fails, paired or not.
    expect(checkReceipt({ t: 200, measure: "living_cells", values: "120 vs 9", note: "" }, t1).valuesOk).toBe(false);
    // Unknown measure: unchecked, and said so; no number: unchecked; no line at t: unchecked.
    expect(checkReceipt({ t: 200, measure: "foo", values: "120", note: "" }, t1)).toEqual({ tOk: true, measureOk: false, valuesOk: null, unchecked: "unknown measure", byDigest: {} });
    expect(checkReceipt({ t: 400, measure: "lineages", values: "no numbers here", note: "" }, t1)).toMatchObject({ tOk: false, measureOk: true, valuesOk: null, unchecked: "no number" });
    expect(checkReceipt({ t: 400, measure: "lineages", values: "5", note: "" }, t1)).toMatchObject({ tOk: false, valuesOk: null, unchecked: "no line at t" });
    // T2: the value or one of its band's three numbers, of the named column only.
    const band = [X[0], X[1]].map((r) => r.map((v, k) => (k === 0 ? { q25: 90, median: 95, q75: 99 } : { q25: v - 1, median: v, q75: v + 1 })));
    const t2 = renderT2(X, band);
    expect(checkReceipt({ t: 200, measure: "living_cells", values: "120, band 90 to 99", note: "" }, t2)).toEqual({ tOk: true, measureOk: true, valuesOk: true, unchecked: null, byDigest: { "": true } });
    expect(checkReceipt({ t: 200, measure: "living_cells", values: "9", note: "" }, t2).valuesOk).toBe(false); // individuals' band, not this column's
  });
});

// ---------------------------------------------------------------------------------------------
describe("scoring the model", () => {
  const items = planItems();
  const mitems = asManifestItems(items);
  const byTask = (t: Task) => items.filter((i) => i.task === t);
  const withIds = (task: Task, arm: ItemArm) => items.filter((i) => i.task === task && i.arm === arm);

  it("a perfect reader meets both bars, with the right kinds", () => {
    const out = perfect(items);
    const t1 = scoreTask("T1", mitems, out), t2 = scoreTask("T2", mitems, out);
    for (const s of [t1, t2]) {
      expect(s.called).toBe(true);
      expect(s.hits).toMatchObject({ k: 20, n: 20 });
      expect(s.falseAlarms.k).toBe(0);
      expect(s.bars).toEqual({ hits: true, falseAlarms: true, met: true });
      expect(s.kinds).toEqual({ right: 20, wrong: 0, none: 0 });
      expect(s.l64).toEqual({ k: 10, n: 10 });
    }
    expect(t1.falseAlarms.n).toBe(10);
    expect(t2.falseAlarms.n).toBe(30);
    expect(Object.keys(t2.falseAlarms.byClass).sort()).toEqual(["base", "nudge", "nudge2"]);
    expect(t2.hits.lower95).not.toBeNull();
  });
  it("T1: a hit needs yes and the twin's label; the wrong twin, null world and no are misses", () => {
    const it0 = withIds("T1", "l96")[0];
    const right = twinLabel(it0)!, wrong = right === "X" ? "Y" : "X";
    const run = (o: Outcome) => scoreTask("T1", mitems, new Map([[it0.id, o]])).items.find((r) => r.id === it0.id)!;
    expect(run(ok({ intervention: "yes", world: right, t: 0, kind: "removal" })).hit).toBe(true);
    expect(run(ok({ intervention: "yes", world: wrong })).hit).toBe(false);
    expect(run(ok({ intervention: "yes", world: null })).hit).toBe(false);
    expect(run(ok({ intervention: "no", world: right })).hit).toBe(false);
    // T1 does not score timing: any t is fine.
    expect(run(ok({ intervention: "yes", world: right, t: 30000 })).hit).toBe(true);
    // Kind is reported on hits, not scored.
    const s = scoreTask("T1", mitems, new Map([[it0.id, ok({ intervention: "yes", world: right, kind: "addition" })]]));
    expect(s.hits.k).toBe(1);
    expect(s.kinds).toEqual({ right: 0, wrong: 1, none: 0 });
  });
  it("T1: a yes on a nudge is a false alarm, whatever the world", () => {
    const n = withIds("T1", "nudge")[0];
    const s = scoreTask("T1", mitems, new Map([[n.id, ok({ intervention: "yes", world: "X", kind: "removal" })]]));
    expect(s.falseAlarms.k).toBe(10); // this one, and the nine unanswered nudges (a missing answer is a false alarm on a negative)
    expect(s.items.find((r) => r.id === n.id)!.falseAlarm).toBe(true);
  });
  it("a missing, unparsable or schema-failing answer is a miss on a positive and a false alarm on a negative", () => {
    const pos = withIds("T2", "l96")[0], neg = withIds("T2", "base")[0], oth = withIds("T2", "l64")[0];
    const out = new Map<string, Outcome>([
      [pos.id, { status: "invalid", reason: "bad" }],
      [neg.id, { status: "missing", reason: "no answer" }],
      [oth.id, { status: "invalid", reason: "bad" }],
    ]);
    const s = scoreTask("T2", mitems, out);
    const get = (id: string) => s.items.find((r) => r.id === id)!;
    expect(get(pos.id)).toMatchObject({ hit: false, falseAlarm: false, yes: false, status: "invalid" });
    expect(get(neg.id)).toMatchObject({ hit: false, falseAlarm: true, yes: true, status: "missing" });
    expect(get(oth.id)).toMatchObject({ hit: false, falseAlarm: false });
    // Items with no outcome at all are missing answers.
    expect(s.invalidOrMissing).toBe(60);
    expect(s.falseAlarms.k).toBe(30);
    expect(s.hits.k).toBe(0);
  });
  it("T2: a hit needs |t - U| <= 1000, inclusive; yes with no t is a miss", () => {
    const it0 = withIds("T2", "f")[0];
    const hit = (t: number | null) => scoreTask("T2", mitems, new Map([[it0.id, ok({ intervention: "yes", t, kind: "addition" })]])).items.find((r) => r.id === it0.id)!.hit;
    expect(hit(it0.U)).toBe(true);
    expect(hit(it0.U + 1000)).toBe(true);
    expect(hit(it0.U - 1000)).toBe(it0.U - 1000 >= 0);
    expect(hit(it0.U + 1200)).toBe(false);
    expect(hit(null)).toBe(false);
    expect(HIT_TOLERANCE).toBe(1000);
  });
  it("applies the bars: 16 of 20 hits, and at most 2 (T1) or 3 (T2) false alarms", () => {
    const build = (task: Task, misses: number, fas: number) => {
      const out = perfect(items);
      const pos = byTask(task).filter((i) => i.arm === "l96" || i.arm === "f");
      pos.slice(0, misses).forEach((i) => out.set(i.id, ok()));
      const neg = byTask(task).filter((i) => (task === "T1" ? i.arm === "nudge" : i.arm === "nudge" || i.arm === "nudge2" || i.arm === "base"));
      neg.slice(0, fas).forEach((i) => out.set(i.id, ok({ intervention: "yes", world: task === "T1" ? "X" : null, t: i.U, kind: "removal" })));
      return scoreTask(task, mitems, out);
    };
    expect(BARS.T1).toMatchObject({ hitsAtLeast: 16, falseAlarmsAtMost: 2 });
    expect(BARS.T2).toMatchObject({ hitsAtLeast: 16, falseAlarmsAtMost: 3 });
    expect(build("T1", 4, 2).bars).toEqual({ hits: true, falseAlarms: true, met: true });
    expect(build("T1", 5, 0).bars).toEqual({ hits: false, falseAlarms: true, met: false });
    expect(build("T1", 0, 3).bars).toEqual({ hits: true, falseAlarms: false, met: false });
    expect(build("T2", 4, 3).bars).toEqual({ hits: true, falseAlarms: true, met: true });
    expect(build("T2", 5, 0).bars?.met).toBe(false);
    expect(build("T2", 0, 4).bars?.met).toBe(false);
    expect(build("T2", 0, 4).falseAlarms.k).toBe(4);
  });
  it("does not call a task when a scored item is void, or the counts are short; a void L64 item does not matter", () => {
    const a = asManifestItems(items);
    const l96 = a.find((i) => i.task === "T1" && i.arm === "l96")!;
    l96.void = "exit 1";
    const s = scoreTask("T1", a, perfect(items));
    expect(s.called).toBe(false);
    expect(s.reason).toMatch(/void/);
    expect(s.bars).toBeNull();
    expect(scoreTask("T2", a, perfect(items)).called).toBe(true);
    const b = asManifestItems(items);
    b.find((i) => i.task === "T2" && i.arm === "l64")!.void = "x";
    expect(scoreTask("T2", b, perfect(items)).called).toBe(true);
    expect(scoreTask("T2", b.filter((i) => i.arm !== "base" || i.seed !== 1), perfect(items)).called).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the T2 code baseline", () => {
  const A0 = 190_000, N = 301;
  const ref = (i: number): RunTable => makeTable(A0, A0 + 30_000, (s, k) => (k === 0 ? 1000 + (i - 4) : 50 + k)); // livingCells 996..1004; the rest constant
  const refs = Array.from({ length: 9 }, (_, i) => ref(i));
  /** An item: living cells at 1000 except `fn(census index)` added. */
  const item = (fn: (c: number) => number) => makeTable(A0, A0 + 30_000, (s, k) => (k === 0 ? 1000 + fn((s - A0) / 100) : 50 + k));

  it("uses eleven signals and 292 windows of ten censuses, every one wholly inside the item window", () => {
    expect(V1_SIGNALS.length).toBe(11);
    expect(V1_SIGNALS.map((s) => s.name)).not.toContain("maxGeneration");
    expect(V1_SIGNALS.map((s) => s.name)).not.toContain("dominantShare");
    const w = t2Windows(item(() => 0), refs, A0, 30_000);
    expect(w.m.length).toBe(N - 10 + 1);
    expect(w.starts[0]).toBe(A0);
    expect(w.starts[w.starts.length - 1]).toBe(A0 + 30_000 - 900);
    expect(w.livingZ.length).toBe(N);
  });
  it("a sustained excursion counts; one shorter than ten censuses, or cut by the window's end, does not", () => {
    // Spread: the references' IQR is tiny, 5% of the median 1000 = 50 sets it: z = excursion / 50.
    const long = t2Windows(item((c) => (c >= 41 ? 500 : 0)), refs, A0, 30_000);
    expect(Math.max(...long.m)).toBeCloseTo(10, 9);
    expect(long.m[41]).toBeCloseTo(10, 9);
    expect(long.m[40]).toBe(0);
    const nine = t2Windows(item((c) => (c >= 41 && c < 50 ? 500 : 0)), refs, A0, 30_000);
    expect(Math.max(...nine.m)).toBe(0);
    const atEnd = t2Windows(item((c) => (c >= N - 9 ? 500 : 0)), refs, A0, 30_000);
    expect(Math.max(...atEnd.m)).toBe(0); // a window needs its ten censuses inside, and only nine are left
    const atEnd10 = t2Windows(item((c) => (c >= N - 10 ? 500 : 0)), refs, A0, 30_000);
    expect(atEnd10.m[atEnd10.m.length - 1]).toBeCloseTo(10, 9);
    const atStart = t2Windows(item((c) => (c < 9 ? 500 : 0)), refs, A0, 30_000);
    expect(Math.max(...atStart.m)).toBe(0);
  });
  it("sees the low side, and a flip of sign inside a window is worth 0", () => {
    const low = t2Windows(item((c) => (c >= 100 ? -500 : 0)), refs, A0, 30_000);
    expect(Math.max(...low.m)).toBeCloseTo(10, 9);
    const flip = t2Windows(item((c) => (c >= 100 && c < 105 ? 500 : c >= 105 && c < 110 ? -500 : 0)), refs, A0, 30_000);
    expect(Math.max(...flip.m)).toBe(0);
  });
  it("maps the alarm to a relative t floored to a multiple of 200, and the kind from the sign of the living-cells z", () => {
    const d = (c0: number, sign = 1) => t2Decide(t2Windows(item((c) => (c >= c0 ? 500 * sign : 0)), refs, A0, 30_000), 5);
    expect(d(41)).toEqual({ D: expect.closeTo(10, 9), rings: true, t: 4000, kind: "addition" }); // start rel 4100 -> 4000
    expect(d(42).t).toBe(4200);
    expect(d(43).t).toBe(4200); // rel 4300 -> 4200
    expect(d(40, -1)).toMatchObject({ t: 4000, kind: "removal" });
    expect(d(0).t).toBe(0);
    // Strict: D = 10 against Z = 10 does not ring.
    const w = t2Windows(item((c) => (c >= 41 ? 500 : 0)), refs, A0, 30_000);
    expect(t2Decide(w, 10)).toMatchObject({ rings: false, t: null, kind: null });
    expect(t2Decide(w, 9.999999).rings).toBe(true);
    // The window with the first exceedance wins even if a later one is higher.
    const two = t2Windows(item((c) => (c >= 20 ? 300 : 0) + (c >= 100 ? 400 : 0)), refs, A0, 30_000);
    expect(t2Decide(two, 5)).toMatchObject({ t: 2000, kind: "addition" });
  });
  it("sets Z_T2 from the base items and scores the code as it scores the model", () => {
    const itemsT2 = planItems().filter((i) => i.task === "T2");
    // Bases have a mild excursion (D = 4) in the first seeds; the 20 L96/F items have D = 10 at U + 200; nudges are quiet.
    const wOf = (it: PlannedItem) => {
      const A = S - it.U;
      const refs2 = refs.map((r) => makeTable(A, A + 30_000, (s, k) => (k === 0 ? 1000 + ((s / 100) % 9) - 4 : 50 + k)));
      const spike = it.arm === "l96" || it.arm === "f" ? 500 : it.arm === "base" && it.seed === 2 ? 200 : 0;
      const tab = makeTable(A, A + 30_000, (s, k) => (k === 0 ? 1000 + (s > S ? spike : 0) : 50 + k));
      return t2Windows(tab, refs2, A, 30_000);
    };
    const r = codeBaselineT2(itemsT2.map((it) => ({ id: it.id, arm: it.arm, w: wOf(it) })));
    expect(r.Z).not.toBeNull();
    expect(r.Z!).toBeGreaterThan(0);
    const outcomes = new Map([...r.decisions].map(([id, d]) => [id, decisionOutcome(d)]));
    const s = scoreTask("T2", asManifestItems(planItems()), outcomes);
    expect(s.hits.k).toBe(20);
    expect(s.falseAlarms.byClass.base).toEqual({ k: 0, n: 10 }); // zero by construction
    expect(s.falseAlarms.byClass.nudge.k + s.falseAlarms.byClass.nudge2.k).toBe(0);
    expect(r.decisions.get(itemsT2.find((i) => i.arm === "l96")!.id)!.t).toBeGreaterThanOrEqual(0);
    // No base items: no threshold.
    expect(codeBaselineT2(itemsT2.filter((i) => i.arm !== "base").map((i) => ({ id: i.id, arm: i.arm, w: null }))).Z).toBeNull();
    expect(codeBaselineT2(itemsT2.map((i) => ({ id: i.id, arm: i.arm, w: i.arm === "base" && i.seed === 1 ? null : wOf(i) }))).Z).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe("the T1 code comparator and the twin record", () => {
  const record = {
    rule: "anomaly-bell-v1-twins",
    summary: { zStarPair: { value: 3.5, n: 10, called: true } },
    twins: [
      ...[1, 2, 3].map((seed) => ({ arm: "nudge", seed, valid: true, D: seed })),
      { arm: "l96", seed: 1, valid: true, D: 9 },
      { arm: "l96", seed: 2, valid: true, D: 3.5 },
      { arm: "f", seed: 1, valid: true, D: 4 },
      { arm: "f", seed: 2, valid: false, D: null },
      { arm: "l64", seed: 1, valid: true, D: 5 },
    ],
  };
  it("reads Z*_pair, D and the void twins", () => {
    const r = readPairRecord(record);
    expect(r.zStar).toBe(3.5);
    expect(r.called).toBe(true);
    expect(r.D.get("l96-1")).toBe(9);
    expect(r.D.has("f-2")).toBe(false);
    expect(r.voids).toEqual(["f-2"]);
    expect(readPairRecord({ zStarPair: 2, twins: [{ arm: "L96", seed: 1, D_pair: 3 }] }).D.get("l96-1")).toBe(3);
    expect(() => readPairRecord({ twins: [] })).toThrow(/Z\*_pair/);
    expect(() => readPairRecord({ zStarPair: 1 })).toThrow(/twins array/);
    expect(readVoids(record)).toEqual(["f-2"]);
    expect(readVoids(["l96-3"])).toEqual(["l96-3"]);
    // A record with no valid nudge has no Z*_pair, but still lists its voids.
    const noZ = { summary: { zStarPair: { value: null, called: false } }, twins: [{ arm: "nudge", seed: 1, valid: false, D: null }, { arm: "l96", seed: 2, valid: true, D: 4 }] };
    expect(readVoids(noZ)).toEqual(["nudge-1"]);
    // ... and is read with Z* null and not called (the comparator is withheld); `provisional` is never used.
    expect(readPairRecord({ ...noZ, summary: { zStarPair: { value: null, provisional: 7, n: 9, called: false } } })).toMatchObject({ zStar: null, called: false });
    expect(() => readPairRecord({ ...noZ, summary: { zStarPair: { value: null, called: true } } })).toThrow(/Z\*_pair/);
    expect(() => readVoids({ summary: {} })).toThrow(/twins array/);
    expect(() => readVoids([3])).toThrow();
  });
  /** A record as tools/bell1.ts twins writes it for the note's plan: 50 twins, each with an explicit validity decision. */
  const fullRecord = (over: { twin?: (arm: string, seed: number) => Record<string, unknown>; called?: boolean } = {}) => ({
    rule: "anomaly-bell-v1-twins",
    version: BELL1_VERSION,
    note: NOTE1_PATH,
    complete: true,
    called: true,
    missing: [],
    parameters: { signals: [], dropped: [], S: 200_000, steps: 300_000, censuses: 3000, W_pair: 10, earlyWindowFirstCensus: [200_100, 205_000] },
    bases: [],
    summary: { zStarPair: (over.called ?? true) ? { value: 3.5, provisional: null, n: 10, called: true } : { value: null, provisional: 3.5, n: 9, called: false } },
    twins: ["nudge", "nudge2", "l64", "l96", "f"].flatMap((arm) => DEFAULT_SEEDS_T.map((seed) => ({ id: `${arm}-${seed}`, arm, seed, valid: true, D: arm === "nudge" ? seed / 4 : arm === "l64" ? 1 : 9, ...over.twin?.(arm, seed) }))),
  });
  it("refuses a production build without a finished twin record: identity, parameters, and one validity decision per twin", () => {
    expect(twinRecordProblem("production", fullRecord())).toBeNull();
    expect(twinRecordProblem("production", fullRecord({ twin: (arm, seed) => (arm === "l96" && seed === 3 ? { valid: false, D: null } : {}) }))).toBeNull();
    expect(twinRecordProblem("production", null)).toMatch(/required/);
    // The bypass that was accepted: an empty twin list gives no voids, so it must stop.
    expect(twinRecordProblem("production", { twins: [], complete: true })).toMatch(/rule/);
    expect(twinRecordProblem("production", { ...fullRecord(), twins: [] })).toMatch(/twin nudge-1 is not in the twin record \(0 of 50/);
    expect(twinRecordProblem("production", { ...fullRecord(), complete: false })).toMatch(/incomplete/);
    expect(twinRecordProblem("production", { ...fullRecord(), complete: undefined })).toMatch(/complete:true/);
    expect(twinRecordProblem("production", { ...fullRecord(), version: BELL1_VERSION + 1 })).toMatch(/version/);
    expect(twinRecordProblem("production", { ...fullRecord(), note: "elsewhere.md" })).toMatch(/note/);
    expect(twinRecordProblem("production", { ...fullRecord(), testPlan: "plan.json" })).toMatch(/--plan/);
    expect(twinRecordProblem("production", { ...fullRecord(), parameters: undefined })).toMatch(/no parameters/);
    for (const [k, v] of [["S", 30_000], ["steps", 50_000], ["censuses", 500], ["W_pair", 5], ["earlyWindowFirstCensus", [200_100, 206_000]]] as const) {
      const r = fullRecord();
      expect(twinRecordProblem("production", { ...r, parameters: { ...r.parameters, [k]: v } })).toMatch(new RegExp(`parameters\\.${k}`));
    }
    const r = fullRecord();
    expect(twinRecordProblem("production", { ...r, twins: r.twins.slice(1) })).toMatch(/nudge-1 is not in the twin record/);
    expect(twinRecordProblem("production", { ...r, twins: [...r.twins, r.twins[7]] })).toMatch(/nudge-8 is listed twice/);
    expect(twinRecordProblem("production", { ...r, twins: r.twins.map((t, i) => (i === 12 ? { ...t, valid: undefined } : t)) })).toMatch(/nudge2-3 has no explicit validity decision/);
    expect(twinRecordProblem("production", { ...r, twins: r.twins.map((t, i) => (i === 12 ? { ...t, valid: "yes" } : t)) })).toMatch(/no explicit validity decision/);
    expect(twinRecordProblem("production", { ...r, twins: r.twins.map((t, i) => (i === 12 ? { ...t, D: null } : t)) })).toMatch(/valid but has no finite D/);
    expect(twinRecordProblem("production", { ...r, twins: r.twins.map((t, i) => (i === 12 ? { ...t, seed: 11 } : t)) })).toMatch(/seed 11/);
    expect(twinRecordProblem("production", { ...r, twins: r.twins.map((t, i) => (i === 12 ? { ...t, arm: "r32" } : t)) })).toMatch(/arm "r32"/);
    expect(twinRecordProblem("production", ["l96-3"])).toMatch(/pilot only/);
    expect(twinRecordProblem("production", [])).toMatch(/pilot only/);
    expect(twinRecordProblem("pilot", null)).toBeNull();
    expect(twinRecordProblem("pilot", { twins: [] })).toBeNull();
    // The full record's voids are its valid:false twins.
    expect(readVoids(fullRecord({ twin: (arm, seed) => (arm === "f" && seed === 2 ? { valid: false, D: null } : {}) }))).toEqual(["f-2"]);
  });
  it("detects strictly above Z*_pair, on detection only, and reports what is missing", () => {
    const c = t1Comparator(asManifestItems(planItems()), readPairRecord(record));
    // This hand-made record lacks most twins: the scored items without D withhold the comparison.
    expect(c.called).toBe(false);
    expect(c.reason).toMatch(/void/); // f-2's void comes first; the twins with no D are listed as missing
    expect(c.missing.length).toBeGreaterThan(0);
    expect(c.void.length).toBe(1); // f-2, void in the record
    const full = fullRecord({ twin: (arm, seed) => (arm === "l96" && seed === 2 ? { D: 3.5 } : arm === "f" && seed > 5 ? { D: 2 } : {}) });
    const d = t1Comparator(asManifestItems(planItems()), readPairRecord(full));
    expect(d.called).toBe(true);
    expect(d.positives).toEqual({ k: 14, n: 20 }); // l96-2 sits on Z* = 3.5 and does not count; f seeds 6..10 at D = 2 do not
    expect(d.nudgeCalibration).toEqual({ k: 0, n: 10 });
    expect(d.l64).toEqual({ k: 0, n: 10 });
    expect(d.byItem.find((b) => b.arm === "l96" && b.seed === 2)).toMatchObject({ D: 3.5, detected: false, void: null });
    expect(d.missing).toEqual([]);
  });
  it("propagates voids: a void item is out of every count, and a void scored item withholds the comparison (and the model's bar)", () => {
    const items = planItems();
    const rec = readPairRecord(fullRecord());
    // A manifest void on an L96 item.
    const a = asManifestItems(items);
    const l96 = a.find((i) => i.task === "T1" && i.arm === "l96" && i.seed === 4)!;
    l96.void = "exit 1";
    const c = t1Comparator(a, rec);
    expect(c.called).toBe(false);
    expect(c.reason).toMatch(new RegExp(`void: ${l96.id}`));
    expect(c.positives).toEqual({ k: 0, n: 19 });
    expect(c.void).toEqual([l96.id]);
    expect(c.byItem.find((b) => b.id === l96.id)).toMatchObject({ D: null, detected: null, void: "exit 1" });
    expect(c.byItem.every((b) => b.detected === null)).toBe(true);
    expect(scoreTask("T1", a, perfect(items))).toMatchObject({ called: false, bars: null });
    // A twin the record marks void (B-void) is void here even if the manifest does not say so.
    const bVoid = readPairRecord(fullRecord({ twin: (arm, seed) => (arm === "nudge" && seed === 3 ? { valid: false, D: null } : {}) }));
    const c2 = t1Comparator(asManifestItems(items), bVoid);
    expect(c2.called).toBe(false);
    expect(c2.nudgeCalibration.n).toBe(9);
    expect(c2.void.length).toBe(1);
    // A void L64 item is left out of L64's count and withholds nothing.
    const b = asManifestItems(items);
    b.find((i) => i.task === "T1" && i.arm === "l64" && i.seed === 1)!.void = "x";
    const c3 = t1Comparator(b, rec);
    expect(c3.called).toBe(true);
    expect(c3.l64.n).toBe(9);
    expect(c3.positives).toEqual({ k: 20, n: 20 });
  });
  it("withholds the detections when the record does not call Z*_pair (fewer than 10 valid nudges)", () => {
    const rec = readPairRecord(fullRecord({ called: false }));
    expect(rec).toMatchObject({ called: false, zStar: null });
    expect(twinRecordProblem("production", fullRecord({ called: false }))).toBeNull();
    const r = fullRecord();
    expect(twinRecordProblem("production", { ...r, summary: { zStarPair: { value: null, provisional: 3, n: 9, called: true } } })).toMatch(/zStarPair.value/);
    expect(twinRecordProblem("production", { ...r, summary: { zStarPair: { value: 3, provisional: null, n: 9, called: false } } })).toMatch(/zStarPair.value/);
    expect(twinRecordProblem("production", { ...r, summary: {} })).toMatch(/explicit called/);
    const c = t1Comparator(asManifestItems(planItems()), rec);
    expect(c.called).toBe(false);
    expect(c.positives).toEqual({ k: 0, n: 20 });
    expect(c.byItem.every((b) => b.detected === null)).toBe(true);
    expect(c.byItem.find((b) => b.arm === "l96" && b.seed === 1)!.D).toBe(9); // D is still shown
    // A record that does not say is treated as called (hand-made fixtures), when no scored item is missing.
    const twins = fullRecord().twins.map(({ arm, seed, D }) => ({ arm, seed, D_pair: D }));
    expect(t1Comparator(asManifestItems(planItems()), readPairRecord({ zStarPair: 2, twins })).called).toBe(true);
  });
  it("calls nothing in production without frozen call settings; the pilot is exempt", () => {
    expect(CALL_SETTINGS_FILE).toBe("call-settings.json");
    expect(callSettingsProblem("production", ["manifest.json", "prompts/T1.txt"])).toMatch(/not frozen.*nothing is called/);
    expect(callSettingsProblem("production", ["manifest.json", "call-settings.json"])).toBeNull();
    expect(callSettingsProblem("pilot", ["manifest.json"])).toBeNull();
    const items = planItems();
    const s = scoreTask("T2", asManifestItems(items), perfect(items));
    expect(s.called).toBe(true);
    const w = withhold(s, "no settings");
    expect(w).toMatchObject({ called: false, reason: "no settings", bars: null, hits: s.hits });
    const c = withholdComparator(t1Comparator(asManifestItems(items), readPairRecord(fullRecord())), "no settings");
    expect(c).toMatchObject({ called: false, reason: "no settings", positives: { k: 0, n: 20 } });
    expect(c.byItem.every((b) => b.detected === null && b.D !== null)).toBe(true);
  });
  it("reports the orientation split and the constant-X baseline on the same items", () => {
    const o = orientationReport(asManifestItems(planItems()));
    const t1 = planItems().filter((i) => i.task === "T1");
    expect(o.allTwinIsX).toEqual({ k: t1.filter((i) => i.orientation === "X=twin").length, n: 40 });
    const pos = t1.filter((i) => i.arm === "l96" || i.arm === "f");
    expect(o.positivesTwinIsX).toEqual({ k: pos.filter((i) => i.orientation === "X=twin").length, n: 20 });
    expect(o.alwaysYesX).toEqual({ hits: o.positivesTwinIsX, falseAlarms: { k: 10, n: 10 } });
  });
});
