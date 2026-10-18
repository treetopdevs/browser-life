// tools/notebook.ts end to end on tiny synthetic bundles: a 40-run gradient-m3 envelope of 200 censuses each under a scratch base,
// a record copied from the committed one with the gradient-m3 neutral corpus horizons set to the tiny bundles' and those runs'
// entries rescored here with the bell (BellScorer, leave-one-out, in process) on the same values, its counts recounted so it still
// holds together, and a bundle outside the corpus. Needs `deno` on PATH (skipped otherwise); no GPU, no network beyond
// what deno has cached for jsr:@std/cli.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BellScorer, SignalExtractor, corpusRuns, type Receipt } from "../lib/bell.ts";
import { IDENTITY, RECORD_TEXT, prng } from "./notebook-fixture.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const HAS_DENO = spawnSync("deno", ["--version"], { encoding: "utf8" }).status === 0;
const CENSUSES = 200, CADENCE = 100;

type Census = { step: number; rec: Record<string, unknown>; rows: [string, number][] };
/**
 * One bundle: cumulative counters drift, levels jitter around 1000; `bump(i)` adds to livingCells (and the one lineage's cells),
 * `offset` to meanMass throughout (so envelope runs at the edges stand apart for whole windows and the calibration Ds are not 0).
 * Returns the censuses as written.
 */
function writeBundle(dir: string, id: string, seed: number, bump: (i: number) => number = () => 0, cell?: (i: number) => unknown, offset = 0): Census[] {
  const [experiment, presetId, condition, s] = id.split("/");
  const sd = Number(s.replace("seed-", ""));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ spec: { experiment, presetId, condition, seed: sd, steps: CENSUSES * CADENCE, censusEvery: CADENCE }, cfg: { neutral: condition === "neutral", seed: sd }, presetIdentity: IDENTITY, summary: { ok: true } }));
  const out: Census[] = [];
  const r = prng(seed);
  const series: string[] = [];
  const lineages = ["step\tlineage\tcells"];
  let fis = 0, fus = 0, bud = 0, mut = 0;
  for (let i = 0; i < CENSUSES; i++) {
    const step = (i + 1) * CADENCE;
    const living = 1000 + Math.round((r() - 0.5) * 100) + bump(i);
    fis += Math.round(r() * 10);
    fus += Math.round(r() * 10);
    bud += Math.round(r() * 10);
    mut += Math.round(r() * 10);
    const rec: Record<string, unknown> = {
      step,
      livingCells: living,
      individuals: 50 + Math.round((r() - 0.5) * 10),
      meanMass: 1000 + offset + (r() - 0.5) * 100,
      lineages: 1,
      lineageShannon: 1 + (r() - 0.5) * 0.1,
      patternEntropy: 2 + (r() - 0.5) * 0.1,
      bioticRecycling: 0.9 + (r() - 0.5) * 0.02,
      maxGeneration: 10 + Math.round((r() - 0.5) * 4),
      fissions: fis,
      fusions: fus,
      buddings: bud,
      mutations: mut,
    };
    if (cell) rec.meanMass = cell(i) ?? rec.meanMass;
    series.push(JSON.stringify(rec));
    lineages.push(`${step}\t0:1\t${living}`);
    out.push({ step, rec, rows: [["0:1", living]] });
  }
  writeFileSync(join(dir, "series.jsonl"), series.join("\n") + "\n");
  writeFileSync(join(dir, "lineages.tsv"), lineages.join("\n") + "\n");
  return out;
}

/** Each envelope run scored leave-one-out by the bell at the record's primary Z, W = 50: its D and its receipts there. */
function scoreEnvelope(runs: Census[][], Z: number): { D: number; rings: Receipt[] }[] {
  const members = runs.map((_, i) => i);
  const scorer = new BellScorer(runs.map((_, i) => `r${i}`), [{ id: "all-neutral", members }], members.map((i) => ({ id: `r${i}`, run: i, envelope: "all-neutral" })), { Z: [Z], W: [50], cadence: CADENCE });
  const ex = runs.map(() => new SignalExtractor());
  for (let c = 0; c < CENSUSES; c++) scorer.push(runs.map((r, i) => ({ step: r[c].step, values: ex[i].push(r[c].rec, r[c].rows) })));
  return scorer.results().map((x) => ({ D: x.D[0], rings: x.receipts }));
}

type Rec = {
  parameters: { primary: { Z: number; W: number } };
  corpus: { id: string; steps: number }[];
  summary: { criterion1: { k: number; n: number }; secondary: { perPreset: Record<string, { zStar: number; heldOutNeutral: { k: number; of: number }; expected: number }>; heldOutNeutralTotal: { k: number; of: number; expected: number } } };
  runs: { id: string; experiment: string; preset: string; condition: string; envelope: string; D: Record<string, number>; D_primary: number; flagged: boolean; firstRing: unknown; rings: Receipt[] }[];
};
/** The record's counts recounted from its D values, the way the notebook's checkRecordCounts (and the bell's summarize) count them. */
function recount(rec: Rec) {
  const neutral = rec.runs.filter((x) => x.envelope === "all-neutral" && x.condition === "neutral");
  const sec = rec.summary.secondary;
  let k = 0, of = 0, expected = 0;
  for (const [p, v] of Object.entries(sec.perPreset)) {
    const calib = neutral.filter((x) => x.preset === p && x.experiment === "replay-calib").map((x) => x.D["50"]);
    const held = neutral.filter((x) => x.preset === p && x.experiment === "replay-m4");
    v.zStar = Math.max(...calib);
    v.heldOutNeutral = { k: held.filter((x) => x.D["50"] > v.zStar).length, of: held.length };
    v.expected = held.length / (calib.length + 1);
    k += v.heldOutNeutral.k;
    of += held.length;
    expected += v.expected;
  }
  sec.heldOutNeutralTotal = { ...sec.heldOutNeutralTotal, k, of, expected };
  rec.summary.criterion1.k = neutral.filter((x) => x.D["50"] >= rec.parameters.primary.Z).length;
}

let root = "", base = "", recordPath = "", subject = "";
const run = (args: string[]) => spawnSync("deno", ["run", "--no-lock", "-A", "tools/notebook.ts", ...args], { cwd: REPO, encoding: "utf8", timeout: 240_000 });
const common = () => ["--base", base, "--record", recordPath, "--date", "2026-10-17"];

describe.skipIf(!HAS_DENO)("tools/notebook.ts end to end", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "notebook-cli-"));
    base = join(root, "base");
    const neutral = corpusRuns().filter((c) => c.preset === "gradient-m3" && c.condition === "neutral");
    const data = neutral.map((c, k) => writeBundle(join(base, c.rel), c.id, 100 + k, () => 0, undefined, (((k * 17) % 40) - 19.5) * 6));
    // The bundle: livingCells far above the envelope from census 120 to the end (80 censuses, all after the burn-in at census 99).
    subject = join(root, "elsewhere", "probe");
    writeBundle(subject, "sandbox/gradient-m3/treatment/seed-3", 7, (i) => (i >= 120 ? 2000 : 0));
    const rec = JSON.parse(RECORD_TEXT) as Rec;
    // Only the neutral runs' horizons: the arms keep the record's rings, which must lie within their own horizon (parseBellRecord).
    for (const c of rec.corpus) if (c.id.includes("/gradient-m3/neutral/")) c.steps = CENSUSES * CADENCE;
    const Z = rec.parameters.primary.Z;
    scoreEnvelope(data, Z).forEach((sc, k) => {
      const e = rec.runs.find((x) => x.id === neutral[k].id && x.envelope === "all-neutral")!;
      Object.assign(e, { D: { ...e.D, "50": sc.D }, D_primary: sc.D, flagged: sc.D >= Z, rings: sc.rings, firstRing: sc.rings[0] ?? null });
    });
    recount(rec);
    recordPath = join(root, "record.json");
    writeFileSync(recordPath, JSON.stringify(rec));
  });
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("writes one page and its notes for a bundle outside the corpus, and refuses to overwrite them", () => {
    const out = join(root, "out");
    const r = run([subject, "--out", out, ...common()]);
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(join(out, "sandbox-gradient-m3-treatment-seed-3.html"), "utf8");
    const notes = JSON.parse(readFileSync(join(out, "sandbox-gradient-m3-treatment-seed-3.notes.json"), "utf8"));
    expect(notes.rings).toBeGreaterThan(0);
    expect(notes.entries[0].notes[0].signal).toBe("livingCells");
    expect(notes.entries[0].startStep).toBe(12_100);
    expect(html).toContain("<h3>First stretch from step 12,100</h3>");
    expect(html).toContain("This run is not part of the bell corpus; it is scored against all 40 envelope runs.");
    expect(html).not.toMatch(/\bevent|\bdiscover|\bConfirmed\b|\bSeen\b/i);
    expect(notes.meta.sources.map((x: { path: string }) => x.path)).toEqual(["manifest.json", "series.jsonl", "lineages.tsv"].map((f) => `${subject}/${f}`));
    const again = run([subject, "--out", out, ...common()]);
    expect(again.status).not.toBe(0);
    expect(again.stderr).toMatch(/exists \(pass --force to replace it\)/);
    const forced = run([subject, "--out", out, "--force", ...common()]);
    expect(forced.status).toBe(0);
    expect(readFileSync(join(out, "sandbox-gradient-m3-treatment-seed-3.html"), "utf8")).toBe(html);
  }, 600_000);

  it("never writes inside the base or a bundle, and creates nothing when it stops", () => {
    for (const out of [join(base, "reports"), join(subject, "reports")]) {
      const r = run([subject, "--out", out, ...common()]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/STOP: --out .* is inside/);
      expect(existsSync(out)).toBe(false);
    }
    const n = run(["007", "--out", join(root, "o2"), ...common()]);
    expect(n.stderr).toMatch(/reads as the number 7; prefix it with \.\//);
    expect(run([subject, "--out", join(root, "o3"), "--date", "2026-13-45", "--base", base, "--record", recordPath]).stderr).toMatch(/not a date/);
  }, 600_000);

  it("refuses an --out whose name only starts with two dots, inside the base", () => {
    const out = join(base, "..reports");
    const r = run([subject, "--out", out, ...common()]);
    expect(r.stderr).toMatch(/STOP: --out .* is inside --base/);
    expect(existsSync(out)).toBe(false);
  }, 600_000);

  it("refuses an --out inside the base named in another case (Codex pass 3)", () => {
    // On a case-insensitive filesystem BASE/ is base/ (the real path may settle that) and RUNS/ is runs/; compared without case
    // everywhere, conservatively.
    const upper = join(root, "BASE", "reports");
    const u = run([subject, "--out", upper, ...common()]);
    expect(u.stderr).toMatch(/STOP: --out .* is inside --base/);
    expect(existsSync(join(base, "reports"))).toBe(false);
    // Where runs/ does not exist no real path settles the case, so RUNS/ is refused by name.
    const repoUpper = join(REPO, "RUNS", "reports");
    const v = run([subject, "--out", repoUpper, ...common()]);
    expect(v.stderr).toMatch(/STOP: --out .* is inside the repository's runs\//);
    expect(existsSync(repoUpper)).toBe(false);
  }, 600_000);

  it("refuses an --out inside the base reached through a symlink followed by .. in --base (Codex pass 3)", () => {
    // alias -> x/child, so alias/../runs is x/runs (here a link to the base) for the OS, and runs/ beside alias only lexically.
    mkdirSync(join(root, "x", "child"), { recursive: true });
    symlinkSync(join(root, "x", "child"), join(root, "alias"));
    symlinkSync(base, join(root, "x", "runs"));
    const out = join(base, "reports-via-alias");
    const r = run([subject, "--out", out, "--base", `${root}/alias/../runs`, "--record", recordPath, "--date", "2026-10-17"]);
    expect(r.stderr).toMatch(/STOP: --out .* is inside --base/);
    expect(existsSync(out)).toBe(false);
  }, 600_000);

  it("stops when an envelope run's data on disk does not score the record's D, though its manifest matches", () => {
    const tampered = join(root, "tampered");
    cpSync(base, tampered, { recursive: true });
    const c = corpusRuns().find((x) => x.id === "replay-calib/gradient-m3/neutral/seed-1003")!;
    writeBundle(join(tampered, c.rel), c.id, 999, () => 0, () => 1000);
    const out = join(root, "o7");
    const r = run([subject, "--out", out, "--base", tampered, "--record", recordPath]);
    expect(r.status).not.toBe(0);
    // Its neighbours' leave-one-out scores move with it, so the first envelope run to differ stops the page; any of them will do.
    expect(r.stderr).toMatch(/STOP: replay-(calib|m4)\/gradient-m3\/neutral\/seed-\d+: on disk it scores D \S+ at W = 50, the bell record says/);
    expect(existsSync(out)).toBe(false);
  }, 600_000);

  it("stops on an unmeasured cell, before writing anything", () => {
    const bad = join(root, "elsewhere", "bad");
    writeBundle(bad, "sandbox/gradient-m3/treatment/seed-4", 8, () => 0, (i) => (i === 150 ? "broken" : undefined));
    const out = join(root, "o4");
    const r = run([subject, bad, "--out", out, ...common()]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/STOP: sandbox\/gradient-m3\/treatment\/seed-4 .*series.jsonl step 15100 has meanMass "broken", not a finite number/);
    expect(existsSync(out)).toBe(false);
  }, 600_000);

  it("stops when the envelope on disk is not the record's, or not all there", () => {
    const short = JSON.parse(readFileSync(recordPath, "utf8"));
    for (const c of short.corpus) if (c.id.includes("/gradient-m3/neutral/")) c.steps = 1_000_000;
    const shortPath = join(root, "record-1e6.json");
    writeFileSync(shortPath, JSON.stringify(short));
    const r = run([subject, "--out", join(root, "o5"), "--base", base, "--record", shortPath]);
    expect(r.stderr).toMatch(/STOP: replay-calib\/gradient-m3\/neutral\/seed-1001: manifest steps 20000, the bell record's corpus has 1000000/);
    const partial = join(root, "partial");
    cpSync(base, partial, { recursive: true });
    rmSync(join(partial, "replay-m4/gradient-m3/neutral/seed-7"), { recursive: true });
    const p = run([subject, "--out", join(root, "o6"), "--base", partial, "--record", recordPath]);
    expect(p.stderr).toMatch(/1 of the 40 gradient-m3 neutral runs .* missing .*seed-7/);
    expect(existsSync(join(root, "o6"))).toBe(false);
  }, 600_000);
});
