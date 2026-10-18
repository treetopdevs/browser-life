// The proposer's file side (tools/lib/propose-fs.ts) on temp files: the replay check, checkpoint selection and re-checks, the
// --out guard, and what `run` writes and exits with after tools/run.ts. No GPU, no spawned process.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildForkSpec, parseNotes, proposalId, randomBaseline, validateProposal, type Proposal } from "../lib/propose.ts";
import { fileSha256, finishInput, finishRun, forkChecker, forkPointError, guardOut, initError, loadSource, proposalsFor, readNotesFile, rederive, replayCheck, replayCheckLines, runKeyOf, runsTreeOf, runsTreeOnDisk } from "../lib/propose-fs.ts";
import { checkpointArtifact, lineagesText, notesJson, seriesText, sourceManifest } from "./propose-fixture.ts";

async function* gen(lines: string[]): AsyncGenerator<string> {
  yield* lines;
}
const rec = (step: number, v = 1) => JSON.stringify({ step, livingCells: v });
const series = (steps: number[], v: (t: number) => number = () => 1) => steps.map((t) => rec(t, v(t)));
const range = (from: number, to: number) => Array.from({ length: (to - from) / 100 + 1 }, (_, i) => from + 100 * i);

let root = "";
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "propose-fs-"));
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("replayCheckLines", () => {
  const src = series(range(100, 3000));
  it("equal records over (C, through] hold, records past through are not compared", async () => {
    expect(await replayCheckLines(gen(src), gen(series(range(1100, 3000), (t) => (t > 2000 ? 9 : 1))), 1000, 2000, 100)).toEqual({ ok: true, compared: 10, expected: 10 });
  });
  it("a differing record, a gap, a duplicate, an early end, a census at or before C, a source gap", async () => {
    expect(await replayCheckLines(gen(src), gen(series(range(1100, 3000), (t) => (t === 1500 ? 2 : 1))), 1000, 2000, 100)).toMatchObject({ ok: false, mismatchStep: 1500, detail: "the census at step 1500 differs" });
    expect(await replayCheckLines(gen(src), gen(series(range(1100, 3000).filter((t) => t !== 1300))), 1000, 2000, 100)).toMatchObject({ ok: false, mismatchStep: 1300, detail: "the fork has no census at step 1300" });
    expect(await replayCheckLines(gen(src), gen(series([1100, 1200, 1200, 1300])), 1000, 2000, 100)).toMatchObject({ ok: false, detail: "the fork's census at step 1200 is out of order" });
    expect(await replayCheckLines(gen(src), gen(series(range(1100, 1500))), 1000, 2000, 100)).toMatchObject({ ok: false, compared: 5, expected: 10 });
    expect(await replayCheckLines(gen(src), gen(series(range(1000, 2000))), 1000, 2000, 100)).toMatchObject({ ok: false, detail: "the fork has a census at step 1000, at or before its fork step 1000" });
    expect(await replayCheckLines(gen(src.filter((l) => !l.includes(":1400,"))), gen(series(range(1100, 2000))), 1000, 2000, 100)).toMatchObject({ ok: false, detail: "the source has no census at step 1400" });
    expect(await replayCheckLines(gen(src), gen([]), 1000, 2000, 100)).toMatchObject({ ok: false, compared: 0, expected: 10 });
  });
  it("an empty or off-grid range is an error, not a pass", async () => {
    await expect(replayCheckLines(gen(src), gen(src), 1000, 1000, 100)).rejects.toThrow(/not a non-empty census range/);
    await expect(replayCheckLines(gen(src), gen(src), 1000, 1050, 100)).rejects.toThrow(/not a non-empty census range/);
  });
  it("on files the comparison is byte for byte: a CRLF fork does not equal an LF source", async () => {
    const a = join(root, "lf.jsonl"), b = join(root, "crlf.jsonl"), c = join(root, "lf2.jsonl");
    writeFileSync(a, src.join("\n") + "\n");
    writeFileSync(b, series(range(1100, 2000)).join("\r\n") + "\r\n");
    writeFileSync(c, series(range(1100, 2000)).join("\n")); // no final newline: still equal
    expect(await replayCheck(a, b, 1000, 2000, 100)).toMatchObject({ ok: false, mismatchStep: 1100, detail: "the census at step 1100 differs" });
    expect(await replayCheck(a, c, 1000, 2000, 100)).toEqual({ ok: true, compared: 10, expected: 10 });
  });
});

describe("checkpoints: selection and re-checks", () => {
  const m = sourceManifest({ steps: 50_000 });
  let dir = "";
  const skips: string[] = [];
  beforeAll(() => {
    dir = join(root, "base", "replay-x", "archipelago", "neutral", "seed-1");
    mkdirSync(join(dir, "checkpoints"), { recursive: true });
    const good = checkpointArtifact(m.spec, 10_000);
    const wrongStep = checkpointArtifact(m.spec, 10_000);
    const otherObserver = checkpointArtifact({ ...m.spec, deepEvery: 5 }, 35_000);
    const truncated = checkpointArtifact(m.spec, 25_000);
    writeFileSync(join(dir, "checkpoints", "good.blck"), good.bytes);
    writeFileSync(join(dir, "checkpoints", "wrong-step.blck"), wrongStep.bytes);
    writeFileSync(join(dir, "checkpoints", "other-observer.blck"), otherObserver.bytes);
    writeFileSync(join(dir, "checkpoints", "truncated.blck"), truncated.bytes.slice(0, 100));
    m.checkpoints = [
      { step: 10_000, file: "checkpoints/good.blck", hash: good.hash },
      { step: 20_000, file: "checkpoints/wrong-step.blck", hash: wrongStep.hash },
      { step: 25_000, file: "checkpoints/truncated.blck", hash: truncated.hash },
      { step: 30_000, file: "../escape.blck", hash: good.hash },
      { step: 35_000, file: "checkpoints/other-observer.blck", hash: otherObserver.hash },
      { step: 35_050, file: "checkpoints/good.blck", hash: good.hash },
      { step: 40_000, file: "checkpoints/missing.blck", hash: good.hash },
    ];
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
    const s = seriesText(500);
    writeFileSync(join(dir, "series.jsonl"), s);
    writeFileSync(join(dir, "lineages.tsv"), lineagesText(s));
  });

  it("falls back past every checkpoint that does not count, naming why", async () => {
    const check = forkChecker(dir, m, (msg) => skips.push(msg));
    expect(await check(45_000)).toEqual({ step: 10_000, check: "checkpoint", hash: m.checkpoints![0].hash, file: "checkpoints/good.blck" });
    expect(skips).toHaveLength(6);
    expect(skips.join("\n")).toMatch(/40000 does not count: checkpoint checkpoints\/missing\.blck cannot be read/);
    expect(skips.join("\n")).toMatch(/35050 does not count: it is not a census step/);
    expect(skips.join("\n")).toMatch(/35000 does not count: .*cannot start the fork: observer settings differ from the run spec/);
    expect(skips.join("\n")).toMatch(/30000 does not count: checkpoint \.\.\/escape\.blck is not a path inside the bundle/);
    expect(skips.join("\n")).toMatch(/25000 does not count/);
    expect(skips.join("\n")).toMatch(/20000 does not count: checkpoint checkpoints\/wrong-step\.blck holds step 10000, not 20000/);
    expect(await check(10_000)).toEqual({ step: 0, check: "initHash", hash: m.initHash });
  });
  it("forkPointError re-checks the stored fork against the bundle and the fork's spec", async () => {
    const spec = buildForkSpec(m, 10_000, 19_900, 20_000, []);
    const fork = { step: 10_000, check: "checkpoint" as const, hash: m.checkpoints![0].hash, file: "checkpoints/good.blck" };
    expect(await forkPointError(dir, m, fork, spec)).toBeNull();
    expect(await forkPointError(dir, m, { ...fork, hash: "0".repeat(16) }, spec)).toMatch(/not the one the proposal names/);
    expect(await forkPointError(dir, m, fork, { ...spec, deepEvery: 5 })).toMatch(/observer settings differ/);
    expect(await forkPointError(dir, m, { step: 0, check: "initHash", hash: m.initHash! }, spec)).toBeNull();
    expect(await forkPointError(dir, m, { step: 0, check: "initHash", hash: "f".repeat(16) }, spec)).toMatch(/is not the source's/);
  });
  it("initError: a recorded config this checkout does not build, or another start world", () => {
    expect(initError(m)).toBeNull();
    expect(initError({ ...m, cfg: { ...m.cfg, mutRate: 1 } })).toMatch(/recorded config differs .*mutRate/);
    expect(initError({ ...m, initHash: "0".repeat(16) })).toMatch(/initHash is 0000000000000000/);
  });
  it("loadSource reads the manifest and sizes, and names a missing file", async () => {
    const src = await loadSource(dir);
    expect(src.sizes["series.jsonl"]).toBe(readFileSync(join(dir, "series.jsonl")).length);
    expect(src.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    const bare = join(root, "bare");
    mkdirSync(bare);
    writeFileSync(join(bare, "manifest.json"), "{}");
    writeFileSync(join(bare, "series.jsonl"), "");
    await expect(loadSource(bare)).rejects.toThrow(/has no lineages\.tsv/);
    await expect(loadSource(join(root, "nowhere"))).rejects.toThrow(/no bundle at/);
  });
  it("guardOut: the bundle, its runs tree and the repository's runs/ are refused; a sibling of the tree is not", async () => {
    const key = runKeyOf("replay-x/archipelago/neutral/seed-1");
    expect(runsTreeOf(dir, key!)).toBe(join(root, "base"));
    for (const bad of [join(dir, "x"), join(root, "base", "y"), join(root, "repo", "runs", "z")]) await expect(guardOut(bad, join(root, "repo"), { dir, key })).rejects.toThrow(/is inside/);
    await expect(guardOut(join(root, "elsewhere"), join(root, "repo"), { dir, key })).resolves.toBeUndefined();
    // Without a run key only the bundle and the repository's runs/ are guarded.
    await expect(guardOut(join(root, "base", "y"), join(root, "repo"), { dir, key: null })).resolves.toBeUndefined();
    expect(runKeyOf("not/a/run")).toBeNull();
  });
  it("guardOut: the runs tree is found without case (pass 3: runs/x/Neutral is runs/x/neutral on APFS) and from the manifest's own spec", async () => {
    const key = runKeyOf("replay-x/archipelago/neutral/seed-1")!;
    const upper = join(root, "base", "replay-x", "archipelago", "Neutral", "seed-1");
    expect(runsTreeOf(upper, key)).toBe(join(root, "base"));
    expect(runsTreeOf(join(root, "base", "REPLAY-X", "Archipelago", "NEUTRAL", "Seed-1"), key)).toBe(join(root, "base"));
    expect(runsTreeOf("/replay-x/archipelago/neutral/seed-1", key)).toBe("/"); // a runs tree at the root (pass 6)
    await expect(guardOut(join(root, "base", "y"), join(root, "repo"), { dir: upper, key })).rejects.toThrow(/inside the runs tree that holds the source/);
    // approve and run pass the source manifest's spec as the key (pass 2), never the body's source.runId.
    await expect(guardOut(join(root, "base", "y"), join(root, "repo"), { dir, key: m.spec })).rejects.toThrow(/inside the runs tree that holds the source/);
  });
  it("guardOut: a stored spelling the filesystem folds but toLowerCase does not (pass 4: \"ſ\" for \"s\") is the tree when the filesystem says so", async () => {
    const key = { experiment: "s", presetId: "archipelago", condition: "neutral", seed: 1 };
    const stored = join(root, "fold", "\u017f", "archipelago", "neutral", "seed-1");
    mkdirSync(stored, { recursive: true });
    expect(runsTreeOf(stored, key)).toBeNull();
    // On APFS (case-insensitive) "s/..." names the same directory, so the tree is guarded; on a case-sensitive filesystem it does not
    // exist and the bundle has no runs tree: the guard follows the filesystem either way.
    const alias = join(root, "fold", "s", "archipelago", "neutral", "seed-1");
    let same = false;
    try {
      same = statSync(alias).ino === statSync(stored).ino;
    } catch {
      same = false;
    }
    expect(await runsTreeOnDisk(stored, key)).toBe(same ? join(root, "fold") : null);
    const guard = guardOut(join(root, "fold", "y"), join(root, "repo"), { dir: stored, key });
    if (same) await expect(guard).rejects.toThrow(/inside the runs tree that holds the source/);
    else await expect(guard).resolves.toBeUndefined();
  });
  it("readNotesFile: the text and the SHA-256 come from one read (pass 3), and a BOM is kept as readFile's utf8 keeps it", async () => {
    const f = join(root, "bom.notes.json");
    writeFileSync(f, "\uFEFF{}");
    const r = await readNotesFile(f);
    expect(r.text).toBe(readFileSync(f, "utf8"));
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    expect(r.sha256).toBe(await fileSha256(f));
  });
});

describe("finishRun: what run writes and exits with after tools/run.ts", () => {
  const src = series(range(100, 3000)).join("\n") + "\n";
  const setup = (name: string, fork?: string) => {
    const target = join(root, name);
    mkdirSync(target);
    writeFileSync(join(target, "source.jsonl"), src);
    if (fork !== undefined) writeFileSync(join(target, "fork.jsonl"), fork);
    return { target, receipt: { proposalId: "abc" }, sourceSeries: join(target, "source.jsonl"), forkSeries: join(target, "fork.jsonl"), C: 1000, through: 2000, cadence: 100 };
  };
  const receipt = (target: string) => JSON.parse(readFileSync(join(target, "run-receipt.json"), "utf8"));
  it("a failing tools/run.ts: its exit code, a receipt that compared nothing", async () => {
    const o = setup("failed");
    const r = await finishRun({ ...o, exitCode: 3 });
    expect(r).toEqual({ exit: 3, lines: ["tools/run.ts exited 3; nothing was compared"] });
    const rc = receipt(o.target);
    expect(rc).toMatchObject({ proposalId: "abc", exitCode: 3, runExitCode: 3 });
    expect(rc.replayCheck).toBeUndefined();
  });
  it("a fork that replays: exit 0 and the check in the receipt", async () => {
    const o = setup("ok", series(range(1100, 3000), (t) => (t > 2000 ? 7 : 1)).join("\n") + "\n");
    const r = await finishRun({ ...o, exitCode: 0 });
    expect(r.exit).toBe(0);
    expect(receipt(o.target).replayCheck).toEqual({ from: 1000, to: 2000, ok: true, compared: 10, expected: 10 });
    expect(receipt(o.target)).toMatchObject({ exitCode: 0, runExitCode: 0 });
  });
  it("a fork that departs before the boundary: exit 4, and a missing fork series is a mismatch too", async () => {
    const o = setup("bad", series(range(1100, 3000), (t) => (t >= 1900 ? 7 : 1)).join("\n") + "\n");
    const r = await finishRun({ ...o, exitCode: 0 });
    expect(r.exit).toBe(4);
    expect(r.lines[0]).toMatch(/^REPLAY MISMATCH: the census at step 1900 differs/);
    expect(receipt(o.target).replayCheck).toMatchObject({ ok: false, mismatchStep: 1900 });
    expect(receipt(o.target)).toMatchObject({ exitCode: 4, runExitCode: 0 });
    const none = setup("none");
    expect((await finishRun({ ...none, exitCode: 0 })).exit).toBe(4);
    expect(receipt(none.target).replayCheck.ok).toBe(false);
  });
});

describe("rederive: a body is bound to the files it names (pass 2 review)", () => {
  let dir = "", notesPath = "", rules: Proposal[] = [];
  const m = sourceManifest({ steps: 50_000 });
  const notesFor = (rings: Parameters<typeof notesJson>[1]) => {
    const size = (f: string) => statSync(join(dir, f)).size;
    return notesJson(m, rings, { sizes: { manifest: size("manifest.json"), series: size("series.jsonl"), lineages: size("lineages.tsv") } });
  };
  const make = async (path: string) => {
    const src = await loadSource(dir);
    const text = readFileSync(path, "utf8");
    return proposalsFor(src, parseNotes(text), { path: realpathSync(path), sha256: await fileSha256(path) });
  };
  beforeAll(async () => {
    dir = join(root, "rd", "replay-x", "archipelago", "neutral", "seed-1");
    mkdirSync(join(dir, "checkpoints"), { recursive: true });
    const ck = checkpointArtifact(m.spec, 10_000);
    writeFileSync(join(dir, "checkpoints", "c.blck"), ck.bytes);
    m.checkpoints = [{ step: 10_000, file: "checkpoints/c.blck", hash: ck.hash }];
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
    const s = seriesText(500);
    writeFileSync(join(dir, "series.jsonl"), s);
    writeFileSync(join(dir, "lineages.tsv"), lineagesText(s));
    dir = realpathSync(dir);
    notesPath = join(root, "rd.notes.json");
    writeFileSync(notesPath, notesFor([{ signal: "livingCells", side: "high", startStep: 15_000 }]));
    rules = (await make(notesPath)).proposals;
    expect(rules).toHaveLength(1);
  });

  it("a rules proposal and its random fork re-derive", async () => {
    expect((await rederive(rules[0])).refusal).toBeUndefined();
    expect((await rederive(randomBaseline(rules[0], 7)!)).refusal).toBeUndefined();
  });
  it("a ring the notes do not hold is refused, though the body alone validates (a drain turned into a feed)", async () => {
    const other = join(root, "rd-other.notes.json");
    writeFileSync(other, notesFor([{ signal: "livingCells", side: "low", startStep: 15_000 }]));
    const [feed] = (await make(other)).proposals;
    // The same body, but naming the original notes file: every field re-derives from the body, so validateProposal passes.
    const body = { ...feed.body, notes: { ...rules[0].body.notes } };
    expect(body.spec.interventions![0]).toMatchObject({ kind: "feed" });
    expect(validateProposal(body)).toBeNull();
    expect((await rederive({ id: proposalId(body), status: "proposed", body })).refusal).toMatch(/not a proposal the rules give/);
  });
  it("a random fork naming another matched proposal, a moved or relative source, changed notes", async () => {
    const r = randomBaseline(rules[0], 7)!;
    const forged = { ...r.body, baseline: { ...r.body.baseline!, matches: "0".repeat(16) } };
    forged.reason = r.body.reason.replace(rules[0].id, "0".repeat(16));
    expect(validateProposal(forged)).toBeNull();
    expect((await rederive({ id: proposalId(forged), status: "proposed", body: forged })).refusal).toMatch(/baseline\.matches .* is not a proposal the rules give/);
    const rel = { ...rules[0].body, source: { ...rules[0].body.source, dir: "." } };
    expect((await rederive({ ...rules[0], body: rel })).refusal).toMatch(/not an absolute path/);
    const link = join(root, "rd-link");
    symlinkSync(dir, link);
    const linked = { ...rules[0].body, source: { ...rules[0].body.source, dir: link } };
    expect((await rederive({ ...rules[0], body: linked })).refusal).toMatch(/is not the bundle's real path/);
    const copy = join(root, "rd-copy.notes.json");
    writeFileSync(copy, readFileSync(notesPath, "utf8") + " ");
    const moved = { ...rules[0].body, notes: { ...rules[0].body.notes, path: realpathSync(copy) } };
    expect((await rederive({ ...rules[0], body: moved })).refusal).toMatch(/notes file changed since the proposal/);
  });
  it("finishInput: run's replay check stops at a random fork's first entry, not at S", () => {
    let r: Proposal | null = null;
    for (let seed = 0; seed < 50 && !r; seed++) {
      const x = randomBaseline(rules[0], seed)!;
      if (x.body.replayThrough < x.body.interventionStep) r = x;
    }
    expect(r).not.toBeNull();
    const o = finishInput(r!, { srcDir: dir, sourceSha256: rules[0].body.source.manifestSha256, target: "/t", forkDir: "/t/f", exitCode: 0, receipt: {} });
    expect(o).toMatchObject({ C: 10_000, through: r!.body.replayThrough, cadence: 100, forkSeries: join("/t/f", "series.jsonl"), sourceSeries: join(dir, "series.jsonl") });
    expect(o.identity).toEqual({ forkManifest: join("/t/f", "manifest.json"), start: { step: 10_000 }, sourceManifest: join(dir, "manifest.json"), sourceSha256: rules[0].body.source.manifestSha256 });
  });
});

describe("finishRun: the fork bundle's identity", () => {
  const src = series(range(100, 3000)).join("\n") + "\n";
  const fork = series(range(1100, 3000)).join("\n") + "\n";
  const setup = (name: string, forkManifest: unknown) => {
    const target = join(root, name);
    mkdirSync(target);
    writeFileSync(join(target, "source.jsonl"), src);
    writeFileSync(join(target, "source-manifest.json"), "{}");
    writeFileSync(join(target, "fork.jsonl"), fork);
    writeFileSync(join(target, "fork-manifest.json"), JSON.stringify(forkManifest));
    return { target, receipt: {}, exitCode: 0, sourceSeries: join(target, "source.jsonl"), forkSeries: join(target, "fork.jsonl"), C: 1000, through: 2000, cadence: 100 };
  };
  const id = async (target: string, step: number, initHash?: string) => ({ forkManifest: join(target, "fork-manifest.json"), start: { step, ...(initHash ? { initHash } : {}) }, sourceManifest: join(target, "source-manifest.json"), sourceSha256: await fileSha256(join(target, "source-manifest.json")) });
  it("a fork bundle that starts at C holds; one that starts at step 0 (a reused run) is exit 4, as is a changed source manifest", async () => {
    const ok = setup("id-ok", { startStep: 1000 });
    expect((await finishRun({ ...ok, identity: await id(ok.target, 1000) })).exit).toBe(0);
    const reused = setup("id-reused", { startStep: 0, initHash: "ab" });
    const r = await finishRun({ ...reused, identity: await id(reused.target, 1000) });
    expect(r).toMatchObject({ exit: 4, lines: [expect.stringMatching(/^IDENTITY MISMATCH: .*starts at step 0, not the fork step 1000/)] });
    // The receipt's exitCode is the one `run` exits with (pass 3), tools/run.ts's own is runExitCode.
    expect(JSON.parse(readFileSync(join(reused.target, "run-receipt.json"), "utf8"))).toMatchObject({ exitCode: 4, runExitCode: 0, identityCheck: { ok: false }, replayCheck: { ok: true } });
    const changed = setup("id-changed", { startStep: 1000 });
    const before = await id(changed.target, 1000);
    writeFileSync(join(changed.target, "source-manifest.json"), "{ }");
    expect((await finishRun({ ...changed, identity: before })).lines[0]).toMatch(/source manifest changed during the run/);
    const zero = setup("id-zero", { startStep: 0, initHash: "cd" });
    expect((await finishRun({ ...zero, C: 0, identity: await id(zero.target, 0, "ab") })).lines[0]).toMatch(/start world hashes to "cd", not the source's initHash ab/);
  });
});
