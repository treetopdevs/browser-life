// tools/lib/branch-source.ts: the source of tools/run.ts's `--branch-from DIR --branch-boundary B`, loaded from crafted run
// bundles (a manifest listing pre-cycle checkpoints, and the checkpoint files): the entry lookup by boundary, the hash check
// against the manifest, the recorded path (trailing slashes dropped), and the two flags that go together. The run.ts wiring
// (its exit code and message before any GPU is requested) is run under Deno.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { PRESETS, encodeCheckpoint, initWorld, stateHash, type WorldState } from "@bl/schema";
import { branchError, observerSettings, restoreObservers, serializeObservers, specConfig, type RunSpec } from "@bl/runner";
import { branchFlagsError, branchSource, type BranchSourceIO } from "../lib/branch-source.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const io: BranchSourceIO = { readText: (p) => readFile(p, "utf8"), readBytes: async (p) => new Uint8Array(await readFile(p)) };
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

// A pond-small treatment run's pre-cycle state at boundary B is a state at step B * pondPeriod; crafted here from the initial world.
const source: RunSpec = { experiment: "src", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 1000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
const cfg = specConfig(source);
const PERIOD = cfg.pondPeriod!;
const init = initWorld(cfg, PRESETS.find((p) => p.id === "ponds-small")!.init);
const preAt = (boundary: number): WorldState => ({ ...init, step: boundary * PERIOD });
const checkpoint = (state: WorldState): Uint8Array => {
  const settings = observerSettings(source);
  return encodeCheckpoint(state, serializeObservers(restoreObservers(undefined, settings, cfg), state.step, settings));
};

interface Entry {
  boundary: number;
  step: number;
  file: string;
  hash: string;
}
/** A bundle directory holding `states` (boundary -> state) as pre-cycle checkpoints; `edit` may change the manifest's entries or leave a file out. */
function bundle(states: Record<number, WorldState>, edit: (entries: Entry[], manifest: Record<string, unknown>) => void = () => {}): string {
  const root = mkdtempSync(join(tmpdir(), "branch-source-"));
  roots.push(root);
  const dir = join(root, "scaffold", "hunt1", "src", "ponds-small", "treatment", "seed-1");
  mkdirSync(join(dir, "checkpoints"), { recursive: true });
  const entries: Entry[] = Object.entries(states).map(([b, s]) => {
    const file = `checkpoints/b${b.padStart(3, "0")}-pre.blck`;
    writeFileSync(join(dir, file), checkpoint(s));
    return { boundary: Number(b), step: s.step, file, hash: stateHash(s) };
  });
  const manifest: Record<string, unknown> = { spec: source, cfg, summary: { conservationOk: true } };
  edit(entries, manifest);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...manifest, preCycleCheckpoints: entries }));
  return dir;
}

describe("branchSource", () => {
  it("loads the checkpoint the manifest lists for the boundary, with the hash it lists and the bundle's path", async () => {
    const dir = bundle({ 1: preAt(1) });
    const { branch, state } = await branchSource(dir, 1, io);
    expect(stateHash(state)).toBe(stateHash(preAt(1)));
    expect(state.step).toBe(PERIOD);
    expect(branch).toEqual({ source: dir, sourceHash: stateHash(preAt(1)), boundary: 1 });
  });

  it("takes the entry of the boundary asked for among several", async () => {
    const dir = bundle({ 1: preAt(1), 2: preAt(2), 3: preAt(3) });
    for (const b of [1, 2, 3]) {
      const { branch, state } = await branchSource(dir, b, io);
      expect([state.step, branch.boundary, branch.sourceHash]).toEqual([b * PERIOD, b, stateHash(preAt(b))]);
    }
  });

  it("records the path without its trailing slashes, and reads through the path as given", async () => {
    const dir = bundle({ 1: preAt(1) });
    for (const given of [`${dir}/`, `${dir}///`]) {
      const { branch, state } = await branchSource(given, 1, io);
      expect(branch.source).toBe(dir);
      expect(stateHash(state)).toBe(stateHash(preAt(1)));
    }
  });

  it("the branch it returns is the runner's to accept: a pond-nat spec from the source, with the source state, has no branchError", async () => {
    const dir = bundle({ 1: preAt(1) });
    const { branch, state } = await branchSource(`${dir}/`, 1, io);
    const spec: RunSpec = { ...source, condition: "pond-nat", seed: 4_900_001, branch };
    expect(branchError(spec, specConfig(spec), { branchFrom: state })).toBeNull();
    // And the manifest's hash is what binds: the same file under another recorded hash is refused here, not by the runner.
    expect(branchError({ ...spec, branch: { ...branch, sourceHash: "0000000000000000" } }, specConfig(spec), { branchFrom: state })).toMatch(/branch source's state hash/);
  });

  it("refuses a checkpoint whose state does not hash to the manifest's entry", async () => {
    const wrongHash = bundle({ 1: preAt(1) }, (entries) => (entries[0].hash = "0000000000000000"));
    await expect(branchSource(wrongHash, 1, io)).rejects.toThrow(
      new RegExp(`^${wrongHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/checkpoints/b001-pre.blck has state hash ${stateHash(preAt(1))}, not the manifest's 0000000000000000$`),
    );
    // A file that holds another boundary's state under this one's entry.
    const swapped = bundle({ 1: preAt(2) }, (entries) => (entries[0].hash = stateHash(preAt(1))));
    await expect(branchSource(swapped, 1, io)).rejects.toThrow(/has state hash .*, not the manifest's/);
  });

  it("refuses a manifest that lists no checkpoint for the boundary, or lists none at all", async () => {
    const dir = bundle({ 1: preAt(1), 2: preAt(2) });
    await expect(branchSource(dir, 3, io)).rejects.toThrow(/manifest.json lists no pre-cycle checkpoint for boundary 3 \(a complete bundle run with --pre-cycle 3 does\)/);
    await expect(branchSource(dir, 0, io)).rejects.toThrow(/for boundary 0/);
    await expect(branchSource(dir, Number("two"), io)).rejects.toThrow(/for boundary NaN/);
    // A manifest of a run that was not given --pre-cycle has no such key.
    const none = bundle({}, (_, manifest) => void manifest);
    await expect(branchSource(none, 1, io)).rejects.toThrow(/lists no pre-cycle checkpoint for boundary 1/);
    writeFileSync(join(none, "manifest.json"), JSON.stringify({ spec: source }));
    await expect(branchSource(none, 1, io)).rejects.toThrow(/lists no pre-cycle checkpoint for boundary 1/);
  });

  it("fails on a bundle without a manifest, a listed file that is missing, or one that is not a checkpoint", async () => {
    const dir = bundle({ 1: preAt(1) });
    await expect(branchSource(`${dir}/nowhere`, 1, io)).rejects.toThrow(/manifest.json/);
    const gone = bundle({ 1: preAt(1) }, (entries) => (entries[0].file = "checkpoints/b001-gone.blck"));
    await expect(branchSource(gone, 1, io)).rejects.toThrow(/b001-gone.blck/);
    const junk = bundle({ 1: preAt(1) });
    writeFileSync(join(junk, "checkpoints/b001-pre.blck"), "not a checkpoint");
    await expect(branchSource(junk, 1, io)).rejects.toThrow();
  });
});

describe("branchFlagsError", () => {
  it("is a message when exactly one of --branch-from and --branch-boundary is given, null for both or neither", () => {
    const why = "--branch-from and --branch-boundary go together";
    expect(branchFlagsError("runs/x", undefined)).toBe(why);
    expect(branchFlagsError(undefined, "3")).toBe(why);
    expect(branchFlagsError("runs/x", "3")).toBeNull();
    expect(branchFlagsError(undefined, undefined)).toBeNull();
  });
});

describe("tools/run.ts refuses a bad branch source before it asks for a GPU", () => {
  const run = promisify(execFile);
  const cli = async (...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    try {
      return { code: 0, ...(await run("deno", ["run", "-A", "tools/run.ts", "--experiment", "x", "--preset", "ponds-small", "--conditions", "pond-nat", "--seeds", "1", "--steps", "1000", "--out", join(tmpdir(), "branch-source-never"), ...args], { cwd: ROOT })) };
    } catch (e) {
      const x = e as { code: number; stdout: string; stderr: string };
      return { code: x.code, stdout: x.stdout, stderr: x.stderr };
    }
  };

  it("exit 2 with the message for: one flag only, a hash mismatch, a missing entry, a missing bundle", async () => {
    const dir = bundle({ 1: preAt(1) });
    const wrongHash = bundle({ 1: preAt(1) }, (entries) => (entries[0].hash = "0000000000000000"));
    const [from, boundary, mismatch, missing, nowhere] = await Promise.all([
      cli("--branch-from", dir),
      cli("--branch-boundary", "1"),
      cli("--branch-from", wrongHash, "--branch-boundary", "1"),
      cli("--branch-from", dir, "--branch-boundary", "2"),
      cli("--branch-from", `${dir}/nowhere`, "--branch-boundary", "1"),
    ]);
    for (const r of [from, boundary]) expect([r.code, r.stderr.trim()]).toEqual([2, "--branch-from and --branch-boundary go together"]);
    expect(mismatch.code).toBe(2);
    expect(mismatch.stderr).toMatch(/b001-pre.blck has state hash .*, not the manifest's 0000000000000000/);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/lists no pre-cycle checkpoint for boundary 2/);
    expect(nowhere.code).toBe(2);
    expect(nowhere.stderr).toMatch(/manifest.json/);
  }, 120_000);
});
