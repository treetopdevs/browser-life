// tools/bench.ts end to end on two tiny synthetic gradient-m3 treatment bundles (--pairs 2) under a temp dir: plan, dry-run, approve
// and every refusal of run, each a spawned deno. No fork is ever run (every run case here is refused before anything starts) and
// nothing reaches the GPU. The approval here is a test approval of a synthetic manifest in a temp dir. Needs `deno` on PATH
// (skipped otherwise).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BENCH_V0, manifestSha256, type BenchBody, type BenchManifest } from "../lib/bench.ts";
import { lineagesText, notesJson, seriesText, sourceManifest, type RingOpts } from "./propose-fixture.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const HAS_DENO = spawnSync("deno", ["--version"], { encoding: "utf8" }).status === 0;
const T = 600_000;
const SEL = BENCH_V0.selection;

let root = "", base = "", notes = "", plan = "";
const bench = (args: string[]) => spawnSync("deno", ["run", "-A", "tools/bench.ts", ...args], { cwd: REPO, encoding: "utf8", timeout: 300_000 });
function writeSource(b: string, n: string, seed: number, rings: RingOpts[]) {
  const dir = join(b, SEL.experiment, SEL.presetId, SEL.condition, `seed-${seed}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(n, { recursive: true });
  const m = sourceManifest({ experiment: SEL.experiment, presetId: SEL.presetId, condition: SEL.condition, seed, steps: 50_000 });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(m, null, 2));
  const series = seriesText(500);
  writeFileSync(join(dir, "series.jsonl"), series);
  writeFileSync(join(dir, "lineages.tsv"), lineagesText(series));
  const size = (f: string) => statSync(join(dir, f)).size;
  writeFileSync(join(n, `${SEL.experiment}-${SEL.presetId}-${SEL.condition}-seed-${seed}.notes.json`), notesJson(m, rings, { sizes: { manifest: size("manifest.json"), series: size("series.jsonl"), lineages: size("lineages.tsv") } }));
}
const read = (p: string): BenchManifest => JSON.parse(readFileSync(p, "utf8"));
const write = (p: string, m: BenchManifest) => writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
/** A copy of the approved manifest with an edit, its hash and approval recomputed (a forged yes). */
function forged(src: string, name: string, edit: (b: BenchBody) => void): string {
  const m = read(src);
  edit(m.body);
  const sha = manifestSha256(m.body);
  const p = join(root, name);
  write(p, { manifestSha256: sha, status: "approved", approval: { by: "Test Person", at: "2026-10-18T00:00:00Z", manifestSha256: sha }, body: m.body });
  return p;
}

describe.skipIf(!HAS_DENO)("tools/bench.ts, spawned", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "bench-cli-"));
    base = join(root, "base");
    notes = join(root, "notes");
    writeSource(base, notes, 1, [{ signal: "patternEntropy", side: "high", startStep: 12_000 }, { signal: "livingCells", side: "high", startStep: 15_000 }]);
    writeSource(base, notes, 2, [{ signal: "maxGeneration", side: "high", startStep: 13_000 }]);
    plan = join(root, "plans", "bench.json");
  });
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("plan writes the manifest, a second plan leaves it unchanged, unknown flags are refused", () => {
    const r = bench(["plan", "--base", base, "--notes", notes, "--out", plan, "--pairs", "2"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/seed-1: proposal [0-9a-f]{16}, ring 1 livingCells high → drain at step 19900, fork from step 0, 39900 steps/);
    expect(r.stdout).toMatch(/seed-2: proposal [0-9a-f]{16}, ring 0 maxGeneration high → lesion at step 17900/);
    expect(r.stdout).toMatch(/14 forks, \d+ steps; manifest [0-9a-f]{64}/);
    const m = read(plan);
    expect(m.status).toBe("planned");
    expect(m.body.entries).toHaveLength(14);
    expect(m.body.constants.pairs).toBe(2);
    const again = bench(["plan", "--base", base, "--notes", notes, "--out", plan, "--pairs", "2"]);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/unchanged/);
    const bad = bench(["plan", "--base", base, "--notes", notes, "--out", plan, "--pairs", "2", "--force"]);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/unknown flag --force/);
  }, T);

  it("plan refuses a source with no intervention proposal, naming it and writing nothing", () => {
    const b2 = join(root, "base2"), n2 = join(root, "notes2");
    writeSource(b2, n2, 1, [{ signal: "livingCells", side: "low", startStep: 11_000 }]);
    writeSource(b2, n2, 2, [{ signal: "bioticRecycling", side: "low", startStep: 11_000 }]);
    const out = join(root, "plans2", "bench.json");
    const r = bench(["plan", "--base", b2, "--notes", n2, "--out", out, "--pairs", "2"]);
    expect(r.status, r.stdout).toBe(2);
    expect(r.stderr).toMatch(/replay-m4\/gradient-m3\/treatment\/seed-2: its notes give no feed, drain or lesion proposal/);
    expect(existsSync(join(root, "plans2"))).toBe(false);
  }, T);

  it("dry-run prints one exact command per entry and the total, runs and writes nothing; an invalid spec is named by its entry", () => {
    const out = join(root, "dry-out");
    const before = readdirSync(root).sort();
    const unsized = bench(["dry-run", plan, "--out", out]);
    expect(unsized.status).toBe(2);
    expect(unsized.stderr).toMatch(/the manifest has 2 pairs, not 10/);
    const r = bench(["dry-run", plan, "--out", out, "--pairs", "2"]);
    expect(r.status, r.stderr).toBe(0);
    const m = read(plan);
    const lines = r.stdout.trim().split("\n").filter((l) => !l.startsWith("#"));
    expect(lines).toHaveLength(m.body.entries.length + 1);
    m.body.entries.forEach((e, i) => {
      expect(lines[i].startsWith(`${e.id}: deno run -A tools/run.ts --experiment naturalist-fork --preset gradient-m3`)).toBe(true);
      expect(lines[i].endsWith(`--out ${join(out, e.id)}`)).toBe(true);
    });
    const total = m.body.entries.reduce((n, e) => n + e.spec.steps, 0);
    expect(lines.at(-1)).toMatch(new RegExp(`^total: 14 forks, ${total} steps`));
    expect(readdirSync(root).sort()).toEqual(before);
    expect(existsSync(out)).toBe(false);
    const edited = join(root, "edited-spec.json");
    const e = read(plan);
    e.body.entries[2].spec.steps = 12_345;
    write(edited, e);
    const bad = bench(["dry-run", edited, "--out", out, "--pairs", "2"]);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/entry "seed-1-count-2"/);
    // A file that is JSON but not a manifest is a refusal (exit 2), never a crash.
    for (const [name, text, re] of [["null.json", "null", /not a JSON object/], ["array.json", "[]", /not a JSON object/], ["nobody.json", '{"body":null}', /no body/]] as const) {
      writeFileSync(join(root, name), text);
      const x = bench(["dry-run", join(root, name), "--pairs", "2"]);
      expect(x.status, x.stderr).toBe(2);
      expect(x.stderr).toMatch(re);
    }
  }, T);

  it("a command refuses a flag it does not read: run --by is not an approval", () => {
    const r = bench(["run", plan, "--by", "Test Person", "--pairs", "2"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/run takes no --by \(only approve records a yes\)/);
    const d = bench(["dry-run", plan, "--jobs", "2", "--pairs", "2"]);
    expect(d.status).toBe(2);
    expect(d.stderr).toMatch(/dry-run takes no --jobs/);
  }, T);

  it("the run executor spawns a command, writes its output to a new log and returns its exit code; it never replaces a log", () => {
    const log = join(root, "exec.log");
    const code = `import { denoExec } from ${JSON.stringify(join(REPO, "tools/lib/bench-exec.ts"))};
const a = await denoExec(["deno", "eval", "console.log('out'); console.error('err'); Deno.exit(3)"], Deno.cwd(), ${JSON.stringify(log)});
let again = "none";
try { await denoExec(["deno", "--version"], Deno.cwd(), ${JSON.stringify(log)}); } catch (e) { again = e.name; }
console.log(JSON.stringify({ a, again }));`;
    const r = spawnSync("deno", ["eval", code], { cwd: REPO, encoding: "utf8", timeout: 300_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout.trim().split("\n").at(-1)!)).toEqual({ a: 3, again: "AlreadyExists" });
    expect(readFileSync(log, "utf8").split("\n").filter(Boolean).sort()).toEqual(["err", "out"]);
  }, T);

  it("under Deno, the run log refuses a symbolic or hard link and ends a torn line; publishOnce never replaces (amendment 2)", () => {
    const d = join(root, "deno-fs");
    const code = `import { openRunLog, publishOnce, replaceIfUnchanged } from ${JSON.stringify(join(REPO, "tools/lib/bench-fs.ts"))};
const d = ${JSON.stringify(d)};
Deno.mkdirSync(d, { recursive: true });
const out = {};
const msg = async (f) => { try { await f(); return "ok"; } catch (e) { return e.constructor.name + ": " + e.message; } };
Deno.writeTextFileSync(d + "/victim", "keep\\n");
Deno.symlinkSync(d + "/victim", d + "/sym.jsonl");
out.sym = await msg(() => openRunLog(d + "/sym.jsonl"));
Deno.linkSync(d + "/victim", d + "/hard.jsonl");
out.hard = await msg(() => openRunLog(d + "/hard.jsonl"));
out.victim = Deno.readTextFileSync(d + "/victim");
Deno.writeTextFileSync(d + "/torn.jsonl", '{"id":"a","event":"start"}\\n{"id":"a","ev');
const h = await openRunLog(d + "/torn.jsonl");
await h.appendFile('{"id":"b","event":"start"}\\n');
await h.close();
out.torn = Deno.readTextFileSync(d + "/torn.jsonl");
out.p1 = await publishOnce(d + "/m.json", "one\\n");
out.p2 = await publishOnce(d + "/m.json", "one\\n");
out.p3 = await msg(() => publishOnce(d + "/m.json", "two\\n"));
out.m = Deno.readTextFileSync(d + "/m.json");
Deno.writeTextFileSync(d + "/a.json", "planned\\n");
const both = await Promise.allSettled([replaceIfUnchanged(d + "/a.json", "planned\\n", "by A\\n"), replaceIfUnchanged(d + "/a.json", "planned\\n", "by B\\n")]);
out.approvals = both.map((r) => r.status === "fulfilled" ? "ok" : r.reason.constructor.name);
out.a = Deno.readTextFileSync(d + "/a.json");
out.left = [...Deno.readDirSync(d)].map((x) => x.name).filter((x) => x.startsWith("a.json.") || x.startsWith("m.json.")).sort();
console.log(JSON.stringify(out));`;
    const r = spawnSync("deno", ["eval", code], { cwd: REPO, encoding: "utf8", timeout: 300_000 });
    expect(r.status, r.stderr).toBe(0);
    const o = JSON.parse(r.stdout.trim().split("\n").at(-1)!);
    expect(o.sym).toMatch(/^BenchRefusal: .*without following a link/);
    expect(o.hard).toMatch(/^BenchRefusal: .*has 2 links/);
    expect(o.victim).toBe("keep\n");
    expect(o.torn).toBe('{"id":"a","event":"start"}\n{"id":"a","ev\n{"id":"b","event":"start"}\n');
    expect([o.p1, o.p2, o.m]).toEqual(["wrote", "unchanged", "one\n"]);
    expect(o.p3).toMatch(/^BenchRefusal: .*exists and differs/);
    // Two approvals at once under Deno: one written, one refused, no lock or temporary file left (Codex pass 3).
    expect([...o.approvals].sort()).toEqual(["BenchRefusal", "ok"]);
    expect(o.a).toBe(o.approvals[0] === "ok" ? "by A\n" : "by B\n");
    expect(o.left).toEqual([]);
  }, T);

  it("when writing a fork's log fails, the executor kills the fork and waits for it before it throws (amendment 2)", () => {
    const pidFile = join(root, "exec-child.pid");
    const child = `Deno.writeTextFileSync(${JSON.stringify(pidFile)}, String(Deno.pid)); for (let i = 0; i < 1200; i++) { console.log("tick " + i); await new Promise((r) => setTimeout(r, 100)); }`;
    const code = `import { makeDenoExec } from ${JSON.stringify(join(REPO, "tools/lib/bench-exec.ts"))};
let n = 0;
const exec = makeDenoExec(async () => ({ write: async (p) => { if (++n > 1) throw new Error("disk full"); return p.length; }, close() {} }));
const t = Date.now();
let err = "none";
try { await exec(["deno", "eval", ${JSON.stringify(child)}], Deno.cwd(), "unused"); } catch (e) { err = e.message; }
console.log(JSON.stringify({ err, ms: Date.now() - t }));`;
    const r = spawnSync("deno", ["eval", code], { cwd: REPO, encoding: "utf8", timeout: 300_000 });
    expect(r.status, r.stderr).toBe(0);
    const res = JSON.parse(r.stdout.trim().split("\n").at(-1)!) as { err: string; ms: number };
    expect(res.err).toBe("disk full");
    // The child would tick for two minutes; it was killed (and reaped: no such process remains).
    expect(res.ms).toBeLessThan(100_000);
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
  }, T);

  it("run refuses an unapproved manifest, creating nothing; score refuses it too", () => {
    const out = join(root, "run-out");
    const r = bench(["run", plan, "--out", out, "--pairs", "2"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/refused: not approved/);
    expect(existsSync(out)).toBe(false);
    const s = bench(["score", plan, "--out", out, "--record", join(root, "rec.json"), "--pairs", "2"]);
    expect(s.status).toBe(2);
    expect(s.stderr).toMatch(/refused: not approved/);
    expect(existsSync(join(root, "rec.json"))).toBe(false);
    writeFileSync(join(root, "rec-exists.json"), "{}\n");
    const s2 = bench(["score", plan, "--out", out, "--record", join(root, "rec-exists.json"), "--pairs", "2"]);
    expect(s2.status).toBe(2);
    expect(s2.stderr).toMatch(/exists; the record is written once/);
    expect(readFileSync(join(root, "rec-exists.json"), "utf8")).toBe("{}\n");
  }, T);

  it("approve refuses a name that is not a person's and leaves the file unchanged", () => {
    const was = readFileSync(plan, "utf8");
    for (const name of ["Claude", "gpt4o bot"]) {
      const r = bench(["approve", plan, "--by", name, "--pairs", "2"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/not a person's name/);
      expect(readFileSync(plan, "utf8")).toBe(was);
    }
  }, T);

  it("after a person's yes, run refuses an edited body, a forged re-approval, a changed notes file and another rule version", () => {
    const approved = join(root, "approved.json");
    writeFileSync(approved, readFileSync(plan, "utf8"));
    const unsized = bench(["approve", approved, "--by", "Test Person"]);
    expect(unsized.status).toBe(2);
    expect(unsized.stderr).toMatch(/the manifest has 2 pairs, not 10/);
    const ok = bench(["approve", approved, "--by", "Test Person", "--pairs", "2"]);
    expect(ok.status, ok.stderr).toBe(0);
    const m = read(approved);
    expect(m.status).toBe("approved");
    expect(m.approval).toMatchObject({ by: "Test Person", manifestSha256: m.manifestSha256 });
    expect(existsSync(approved + ".lock")).toBe(false);
    const out = join(root, "run-out2");
    const r0 = bench(["run", approved, "--out", out]);
    expect(r0.status).toBe(2);
    expect(r0.stderr).toMatch(/the manifest has 2 pairs, not 10/);

    const radius = join(root, "radius.json");
    const e = read(approved);
    e.body.entries[0].spec.interventions![0].r = 5;
    write(radius, e);
    const r1 = bench(["run", radius, "--out", out, "--pairs", "2"]);
    expect(r1.status).toBe(2);
    expect(r1.stderr).toMatch(/the body was edited/);

    const r2 = bench(["run", forged(approved, "forged-radius.json", (b) => (b.entries[0].spec.interventions![0].r = 5)), "--out", out, "--pairs", "2"]);
    expect(r2.status).toBe(2);
    expect(r2.stderr).toMatch(/entry "seed-1-rules"/);
    const r3 = bench(["run", forged(approved, "forged-zstar.json", (b) => (b.constants.zStarPair = 1)), "--out", out, "--pairs", "2"]);
    expect(r3.status).toBe(2);
    expect(r3.stderr).toMatch(/not the plan its files give/);
    const r4 = bench(["run", forged(approved, "forged-version.json", (b) => (b.versions.rule = 99)), "--out", out, "--pairs", "2"]);
    expect(r4.status).toBe(2);
    expect(r4.stderr).toMatch(/other versions than this checkout's/);

    const n1 = join(notes, "replay-m4-gradient-m3-treatment-seed-1.notes.json");
    const was = readFileSync(n1, "utf8");
    try {
      writeFileSync(n1, was + "\n");
      const r5 = bench(["run", approved, "--out", out, "--pairs", "2"]);
      expect(r5.status).toBe(2);
      expect(r5.stderr).toMatch(/the notes file .* changed since the plan/);
    } finally {
      writeFileSync(n1, was);
    }
    const r6 = bench(["run", approved, "--out", join(base, "inside"), "--pairs", "2"]);
    expect(r6.status).toBe(2);
    expect(r6.stderr).toMatch(/is inside the runs tree that holds the source/);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(join(base, "inside"))).toBe(false);
  }, T);
});
