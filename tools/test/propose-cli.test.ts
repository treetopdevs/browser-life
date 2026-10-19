// tools/propose.ts and tools/run.ts --start-from end to end on a tiny synthetic bundle (archipelago with a mutRate override and an
// activity threshold, 50,000 steps, one real checkpoint at step 10,000) under a temp dir. Every case is a spawned deno that refuses,
// prints or writes files; nothing reaches the GPU's simulation (tools/run.ts queries the adapter for its host description, then
// exits 2 before it requests a device). The approvals here are test approvals of synthetic proposals in a temp dir. Needs `deno` on
// PATH (skipped otherwise).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkpointArtifact, lineagesText, notesJson, seriesText, sourceManifest } from "./propose-fixture.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const HAS_DENO = spawnSync("deno", ["--version"], { encoding: "utf8" }).status === 0;
const T = 600_000;

let root = "", bundle = "", notes = "", out = "";
const propose = (args: string[]) => spawnSync("deno", ["run", "--no-lock", "-A", "tools/propose.ts", ...args], { cwd: REPO, encoding: "utf8", timeout: 240_000 });
const runTs = (args: string[]) => spawnSync("deno", ["run", "--no-lock", "-A", "tools/run.ts", ...args], { cwd: REPO, encoding: "utf8", timeout: 240_000 });
const files = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".proposal.json")).sort();

describe.skipIf(!HAS_DENO)("tools/propose.ts and tools/run.ts --start-from, spawned", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "propose-cli-"));
    bundle = join(root, "base", "replay-x", "archipelago", "neutral", "seed-1");
    mkdirSync(join(bundle, "checkpoints"), { recursive: true });
    const m = sourceManifest({ steps: 50_000, extraSpec: { activityThreshold: 2.5, overrides: { mutRate: 0 } } });
    const ck = checkpointArtifact(m.spec, 10_000);
    writeFileSync(join(bundle, "checkpoints", "t000010000.blck"), ck.bytes);
    m.checkpoints = [{ step: 10_000, file: "checkpoints/t000010000.blck", hash: ck.hash }];
    writeFileSync(join(bundle, "manifest.json"), JSON.stringify(m, null, 2));
    const series = seriesText(500);
    writeFileSync(join(bundle, "series.jsonl"), series);
    writeFileSync(join(bundle, "lineages.tsv"), lineagesText(series));
    const size = (f: string) => statSync(join(bundle, f)).size;
    notes = join(root, "probe.notes.json");
    writeFileSync(
      notes,
      notesJson(m, [
        { signal: "livingCells", side: "high", startStep: 15_000 }, // drain at 19,900 from the checkpoint at 10,000
        { signal: "patternEntropy", side: "high", startStep: 15_000 }, // replay control
        { signal: "maxGeneration", side: "high", startStep: 26_000 }, // lesion at 30,900: S + H past 50,000, skipped
      ], { sizes: { manifest: size("manifest.json"), series: size("series.jsonl"), lineages: size("lineages.tsv") } }),
    );
    out = join(root, "proposals");
  });
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("propose writes one file per ring it can answer, and lists the skipped one", () => {
    const r = propose(["propose", bundle, "--notes", notes, "--out", out]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/3 ring\(s\); 2 proposal\(s\), 1 skipped/);
    expect(r.stdout).toMatch(/skipped ring 2 maxGeneration high: S \+ H = 50900 is past the source's last step 50000/);
    const names = files(out);
    expect(names).toHaveLength(2);
    const ps = names.map((f) => JSON.parse(readFileSync(join(out, f), "utf8")));
    for (const p of ps) {
      expect(p.status).toBe("proposed");
      expect(p.body.fork).toMatchObject({ step: 10_000, check: "checkpoint" });
      expect(`${p.id}.proposal.json`).toBe(names[ps.indexOf(p)]);
    }
    expect(ps.map((p) => p.body.rule.action).sort()).toEqual(["control", "drain"]);
    // A second run leaves identical files alone.
    const again = propose(["propose", bundle, "--notes", notes, "--out", out]);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/unchanged/);
  }, T);

  it("refuses --out inside the bundle, its runs tree and the repository's runs/, creating nothing", () => {
    for (const bad of [join(bundle, "p"), join(root, "base", "elsewhere"), join(REPO, "runs", "propose-cli-test-never")]) {
      const r = propose(["propose", bundle, "--notes", notes, "--out", bad]);
      expect(r.status, `${bad}: ${r.stdout}${r.stderr}`).toBe(2);
      expect(r.stderr).toMatch(/refused: --out .* is inside/);
      expect(existsSync(bad)).toBe(false);
    }
  }, T);

  it("refuses notes that describe another bundle", () => {
    const other = join(root, "other.notes.json");
    writeFileSync(other, readFileSync(notes, "utf8").replace(/"bytes": (\d+)/, (_m, n) => `"bytes": ${Number(n) + 1}`));
    const r = propose(["propose", bundle, "--notes", other, "--out", join(root, "o2")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/does not describe this bundle: manifest\.json size/);
  }, T);

  it("the yes gate: run refuses a proposed file, approve takes a person's name, run --print prints the command, an edit after approval is refused", async () => {
    const work = join(root, "gate");
    mkdirSync(work);
    const drain = files(out).map((f) => join(out, f)).find((f) => JSON.parse(readFileSync(f, "utf8")).body.rule.action === "drain")!;
    const file = join(work, "p.proposal.json");
    cpSync(drain, file);
    const forks = join(root, "forks");
    let r = propose(["run", file, "--out", forks, "--print"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not approved/);
    r = propose(["approve", file, "--by", "Claude"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not a person's name/);
    r = propose(["approve", file, "--by", "Pat Tester"]); // a test approval of a synthetic proposal
    expect(r.status, r.stderr).toBe(0);
    const p = JSON.parse(readFileSync(file, "utf8"));
    expect(p).toMatchObject({ status: "approved", approval: { by: "Pat Tester" } });
    r = propose(["approve", file, "--by", "Pat Tester"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/status is approved/);
    r = propose(["run", file, "--out", forks, "--print"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`deno run -A tools/run.ts --experiment naturalist-fork --preset archipelago --conditions neutral --seeds 1 --steps 29900`);
    expect(r.stdout).toContain(`--checkpoint 0 --threshold 2.5 --override mutRate=0 --start-from ${realpathSync(bundle)} --start-step 10000 --feed 19900:32,32,31,-32 --feed 19900:96,32,31,-32`);
    expect(r.stdout).toContain(`--out ${join(forks, p.id)}`);
    expect(existsSync(forks)).toBe(false);
    // A relative --out is resolved against the caller's directory, not the repository root tools/run.ts runs from.
    const rel = spawnSync("deno", ["run", "--no-lock", "-A", join(REPO, "tools", "propose.ts"), "run", file, "--out", "rel-forks", "--print"], { cwd: root, encoding: "utf8", timeout: 240_000 });
    expect(rel.status, rel.stderr).toBe(0);
    expect(rel.stdout).toContain(`--out ${join(realpathSync(root), "rel-forks", p.id)}`); // deno reports the real cwd (/var is /private/var on macOS)
    // A hand-edited deep cadence, with its argv, id and approval recomputed, still does not fit the source (its manifest says 10).
    const { bodySha256, proposalId } = await import("../lib/propose.ts");
    const body = { ...p.body, spec: { ...p.body.spec, deepEvery: 5 } };
    body.argv = body.argv.map((x: string, i: number) => (body.argv[i - 1] === "--deep" ? "5" : x));
    const forged = join(work, "forged.proposal.json");
    writeFileSync(forged, JSON.stringify({ id: proposalId(body), status: "approved", approval: { ...p.approval, bodySha256: bodySha256(body) }, body }, null, 2));
    r = propose(["run", forged, "--out", forks, "--print"]);
    expect(r.status, r.stdout + r.stderr).toBe(2);
    expect(r.stderr).toMatch(/does not fit its source/);
    r = propose(["run", file, "--out", join(bundle, "f"), "--print"]);
    expect(r.status).toBe(2);
    // An edit after approval: the id no longer matches, or (with the id fixed by hand) the approval no longer binds the body.
    const edited = join(work, "edited.proposal.json");
    writeFileSync(edited, JSON.stringify({ ...p, body: { ...p.body, reason: p.body.reason + " Edited." } }, null, 2));
    r = propose(["run", edited, "--out", forks, "--print"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/body was edited|body changed after it was approved/);
  }, T);

  it("approve refuses a file inside the source's runs tree or bundle, and leaves it as it was", () => {
    const drain = files(out).map((f) => join(out, f)).find((f) => JSON.parse(readFileSync(f, "utf8")).body.rule.action === "drain")!;
    for (const file of [join(root, "base", "p.proposal.json"), join(bundle, "p.proposal.json")]) {
      cpSync(drain, file);
      const before = readFileSync(file, "utf8");
      const r = propose(["approve", file, "--by", "Pat Tester"]);
      expect(r.status, r.stdout + r.stderr).toBe(2);
      expect(r.stderr).toMatch(/refused: the proposal's directory .* is inside (the runs tree that holds the source|the source bundle)/);
      expect(readFileSync(file, "utf8")).toBe(before);
      rmSync(file);
    }
    // "link/.." climbs from the link's target, as the write would (pass 2 review): link -> <runs tree>/sub, so link/.. is the runs tree.
    mkdirSync(join(root, "base", "sub"));
    mkdirSync(join(root, "outside"));
    symlinkSync(join(root, "base", "sub"), join(root, "outside", "link"));
    const inTree = join(root, "base", "q.proposal.json");
    cpSync(drain, inTree);
    const before = readFileSync(inTree, "utf8");
    const r = propose(["approve", `${join(root, "outside", "link")}/../q.proposal.json`, "--by", "Pat Tester"]); // not join(): it would drop "link/.." lexically
    expect(r.status, r.stdout + r.stderr).toBe(2);
    expect(r.stderr).toMatch(/is inside the runs tree that holds the source/);
    expect(readFileSync(inTree, "utf8")).toBe(before);
    rmSync(inTree);
  }, T);

  it("approve refuses a body whose source.runId was edited (the run key comes from the source's manifest)", async () => {
    const { proposalId } = await import("../lib/propose.ts");
    const drain = JSON.parse(readFileSync(files(out).map((f) => join(out, f)).find((f) => JSON.parse(readFileSync(f, "utf8")).body.rule.action === "drain")!, "utf8"));
    const body = { ...drain.body, source: { ...drain.body.source, runId: "../archipelago/neutral/seed-1" } };
    const file = join(root, "base", "r.proposal.json");
    writeFileSync(file, JSON.stringify({ id: proposalId(body), status: "proposed", body }, null, 2));
    const r = propose(["approve", file, "--by", "Pat Tester"]);
    expect(r.status, r.stdout + r.stderr).toBe(2);
    expect(r.stderr).toMatch(/refused: the proposal does not re-derive from its files: the body is not a proposal the rules give/);
    expect(JSON.parse(readFileSync(file, "utf8")).status).toBe("proposed");
    rmSync(file);
  }, T);

  it("a re-run of propose keeps an approved file instead of replacing it", () => {
    const kept = join(root, "kept");
    cpSync(out, kept, { recursive: true });
    const drain = files(kept).map((f) => join(kept, f)).find((f) => JSON.parse(readFileSync(f, "utf8")).body.rule.action === "drain")!;
    let r = propose(["approve", drain, "--by", "Pat Tester"]);
    expect(r.status, r.stderr).toBe(0);
    const approved = readFileSync(drain, "utf8");
    r = propose(["propose", bundle, "--notes", notes, "--out", kept]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/kept .* \(it exists and differs, approved or edited; not replaced\)/);
    expect(readFileSync(drain, "utf8")).toBe(approved);
  }, T);

  it("run refuses an existing target before it starts tools/run.ts", () => {
    const work = join(root, "exists");
    mkdirSync(work);
    const file = join(work, "p.proposal.json");
    cpSync(files(out).map((f) => join(out, f)).find((f) => JSON.parse(readFileSync(f, "utf8")).body.rule.action === "drain")!, file);
    expect(propose(["approve", file, "--by", "Pat Tester"]).status).toBe(0);
    const id = JSON.parse(readFileSync(file, "utf8")).id;
    mkdirSync(join(work, "forks", id), { recursive: true });
    const r = propose(["run", file, "--out", join(work, "forks")]);
    expect(r.status, r.stdout + r.stderr).toBe(2);
    expect(r.stderr).toMatch(/exists; choose another --out/);
    expect(readdirSync(join(work, "forks", id))).toEqual([]);
  }, T);

  it("the stored argv parses in tools/run.ts itself: overrides, threshold, checkpoint continuation and window all pass, up to the planted run", () => {
    const drain = JSON.parse(readFileSync(files(out).map((f) => join(out, f)).find((f) => JSON.parse(readFileSync(f, "utf8")).body.rule.action === "drain")!, "utf8"));
    const target = join(root, "planted");
    const runDir = join(target, "naturalist-fork", "archipelago", "neutral", "seed-1");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "manifest.json"), "{}");
    // tools/run.ts reads every flag, builds the spec (validateSpec, interventionsError), decodes and hashes the checkpoint, asks
    // continuationError (the config with mutRate 0 and the observer with threshold 2.5 must be the checkpoint's) and checks the
    // window before this last refusal; a mis-parsed --override or --threshold would stop it earlier with another message.
    const r = runTs([...drain.body.argv.slice(4), "--out", target]);
    expect(r.status, r.stdout + r.stderr).toBe(2);
    expect(r.stderr).toMatch(/already holds a run; a fork is never skipped or reused/);
    const wrong = runTs([...drain.body.argv.slice(4).map((x: string) => (x === "mutRate=0" ? "mutRate=1" : x)), "--out", target]);
    expect(wrong.status).toBe(2);
    expect(wrong.stderr).toMatch(/start state config differs from the run spec/);
  }, T);

  it("baseline is byte-identical for the same seed and gives no fork for a replay control", () => {
    const a = join(root, "base-a"), b = join(root, "base-b"), c = join(root, "base-c");
    for (const [dir, seed] of [[a, "7"], [b, "7"], [c, "8"]]) {
      const r = propose(["baseline", bundle, "--notes", notes, "--proposals", out, "--seed", seed, "--out", dir]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/2 rules proposal\(s\) .*; 1 random fork\(s\)/);
    }
    expect(files(a)).toEqual(files(b));
    for (const f of files(a)) expect(readFileSync(join(a, f), "utf8")).toBe(readFileSync(join(b, f), "utf8"));
    expect(files(c)).not.toEqual(files(a));
    // A random fork runs through the same gate; its replay check stops at its first entry, where it may already depart.
    const work = join(root, "random");
    mkdirSync(work);
    const file = join(work, "r.proposal.json");
    cpSync(join(a, files(a)[0]), file);
    let r = propose(["approve", file, "--by", "Pat Tester"]);
    expect(r.status, r.stderr).toBe(0);
    const body = JSON.parse(readFileSync(file, "utf8")).body;
    expect(body.replayThrough).toBe(Math.min(...body.spec.interventions.map((e: { step: number }) => e.step)));
    expect(body.replayThrough <= body.interventionStep).toBe(true);
    r = propose(["run", file, "--out", join(work, "forks"), "--print"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/--start-step 10000 --(lesion|feed) /);
  }, T);

  describe("tools/run.ts --start-from refusals (exit 2, before any GPU work)", () => {
    const base = () => ["--experiment", "f", "--preset", "archipelago", "--conditions", "neutral", "--seeds", "1", "--steps", "30000", "--census", "100", "--deep", "10", "--checkpoint", "0", "--threshold", "2.5", "--override", "mutRate=0", "--out", join(root, "forks-run")];

    it("one flag without the other", () => {
      const r = runTs([...base(), "--start-from", bundle]);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/--start-from and --start-step go together/);
    }, T);

    it("with --lineage-obs", () => {
      const r = runTs([...base(), "--start-from", bundle, "--start-step", "10000", "--lineage-obs"]);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/cannot be combined with --lineage-obs/);
    }, T);

    it("an intervention at or before the start step (the checkpoint itself reads, hashes and continues the spec)", () => {
      const r = runTs([...base(), "--start-from", bundle, "--start-step", "10000", "--lesion", "10000:1,1,1"]);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/not in the fork's window \(10000, 40000\]/);
    }, T);

    it("a checkpoint whose hash is not its manifest entry's", () => {
      const copy = join(root, "tampered");
      cpSync(bundle, copy, { recursive: true });
      const m = JSON.parse(readFileSync(join(copy, "manifest.json"), "utf8"));
      m.checkpoints[0].hash = "0123456789abcdef";
      writeFileSync(join(copy, "manifest.json"), JSON.stringify(m));
      const r = runTs([...base(), "--start-from", copy, "--start-step", "10000"]);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/hashes to [0-9a-f]{16}, its manifest entry says 0123456789abcdef/);
    }, T);

    it("no checkpoint at the step", () => {
      const r = runTs([...base(), "--start-from", bundle, "--start-step", "20000"]);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/lists no checkpoint at step 20000/);
    }, T);

    it("an existing run directory", () => {
      const dir = join(root, "forks-run", "f", "archipelago", "neutral", "seed-1");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "manifest.json"), "{}");
      const r = runTs([...base(), "--start-from", bundle, "--start-step", "10000", "--lesion", "19900:1,1,1"]);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/already holds a run; a fork is never skipped or reused/);
    }, T);

    it("with --verify-against", () => {
      const r = runTs([...base(), "--start-from", bundle, "--start-step", "10000", "--verify-against", bundle]);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/cannot be combined with --verify-against/);
    }, T);

    it("existing flags refuse as before", () => {
      const r = runTs([...base(), "--lesion", "nonsense"]);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(/--lesion "nonsense": expected STEP:X,Y,R/);
    }, T);
  });
});
