// tools/hunt1-queue.ts: the transition hunt's Stage 1 queue. The generator is a Deno script, so it is run for real (as the report's CLI is) into a scratch
// directory, and its manifest and ops files are checked against the hunt's own formulas, written out again here, and against what the assay tool and the
// report read of each command: seeds, set ids, bundle directories, dependencies, the device check, the reproducibility draw and reg1ReportQueueCheck.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRESETS, encodeCheckpoint, initWorld, presetIdentity, stateHash, type WorldState } from "@bl/schema";
import { specConfig, type RunSpec } from "@bl/runner";
import { assaySuccess, reg1PreCycleFileOf } from "../lib/pond-assay.ts";
import { pondConfig, randomKey } from "../lib/ponds.ts";
import {
  HUNT1_PROTOCOL,
  hunt1AssayOutProblems,
  hunt1BundleProblems,
  hunt1BundleTailsOf,
  hunt1BundleWant,
  hunt1ExpectedSets,
  hunt1RegimeProblems,
  hunt1SeedOf,
  hunt1SourceDirsOf,
  loadHunt1Source,
  parseHunt1Set,
  type Hunt1Source,
} from "../lib/hunt-assay.ts";
import { HUNT_SEEDS, huntBundleProblems, huntExpectedRuns, huntExpectedSets, huntFragmentRow, huntQueueInstances, huntReproSelection, huntResolveRuns, huntRoleOf, huntScreenSets, huntWOf, type HuntFragment } from "../lib/hunt-stats.ts";
import { reg1ReportQueueCheck } from "../lib/scaffold-stats.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const QUEUE_TS = join(REPO, "tools", "hunt1-queue.ts");
const COMMITTED = join(REPO, "experiments", "scaffold", "hunt1-queue.json");
const DEVICE_REF = "fa001d7a011fdfee";
const ARMS = ["nat-a", "shuf-a", "nat-s", "shuf-s"] as const;
const pad2 = (i: number): string => String(i).padStart(2, "0");
const range = (n: number): number[] => Array.from({ length: n }, (_, k) => k);
const instanceOfIndex = (i: number): 1 | 2 | 3 => (Math.floor(i / 8) + 1) as 1 | 2 | 3;

interface Command {
  id: string;
  instance: 1 | 2 | 3;
  deps: string[];
  cmd: string;
}
interface Queue {
  hunt: { doc: string; sha256: string; bytes: number };
  deviceRef: { spec: string; finalHash: string };
  instances: { instance: number; histories: [number, number]; ship: string[]; estimatedSteps: number }[];
  mac: { reproducibility: { draw: string; draws: { k: number; value: number }[]; reruns: { value: number; history: string; seed: number; boundary: number; cmd: string }[] } };
  commands: Command[];
}

let tmp: string;
let text: string;
let queue: Queue;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "hunt1-queue-"));
  execFileSync("deno", ["run", "-A", QUEUE_TS, "--device-ref", DEVICE_REF, "--out", join(tmp, "queue.json"), "--ops", join(tmp, "ops")], { cwd: REPO, stdio: "pipe" });
  text = readFileSync(join(tmp, "queue.json"), "utf8");
  queue = JSON.parse(text) as Queue;
}, 180_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const words = (cmd: string): string[] => cmd.trim().split(/\s+/);
const histCommands = (): Command[] => queue.commands.filter((c) => c.id.startsWith("h-"));
const assayCommands = (): Command[] => queue.commands.filter((c) => c.id.startsWith("a-"));

/** A history or ancestor command, `bash ops/history.sh EXPERIMENT CONDITION SEED STEPS PRECYCLE [BRANCH_DIR]`, as its parts. */
function histOf(c: Command) {
  const w = words(c.cmd);
  expect(w.slice(0, 2), c.id).toEqual(["bash", "ops/history.sh"]);
  expect(w.length === 7 || w.length === 8, c.id).toBe(true);
  const [experiment, condition, seed, steps, pre, branch] = w.slice(2);
  return { experiment, condition, seed: Number(seed), steps: Number(steps), pre: pre.split(",").map(Number), branch, dir: `runs/scaffold/hunt1/${experiment}/ponds/${condition}/seed-${seed}` };
}

/** An assay command, `deno run -A tools/scaffold-assays.ts export --hunt1 --name value ...`, as its flags (--quench and --genome-founder valueless). */
function assayOf(c: Command): Record<string, string | true> {
  const w = words(c.cmd);
  expect(w.slice(0, 5), c.id).toEqual(["deno", "run", "-A", "tools/scaffold-assays.ts", "export"]);
  expect(w[5], c.id).toBe("--hunt1");
  const flags: Record<string, string | true> = {};
  for (let k = 6; k < w.length; k++) {
    expect(w[k].startsWith("--"), `${c.id}: ${w[k]}`).toBe(true);
    const name = w[k].slice(2);
    if (name === "quench" || name === "genome-founder") flags[name] = true;
    else flags[name] = w[++k];
  }
  return flags;
}

describe("the generated queue", () => {
  it("is what the committed manifest holds, byte for byte (rerun the generator with --device-ref when the queue changes)", () => {
    expect(text).toBe(readFileSync(COMMITTED, "utf8"));
    expect(queue.deviceRef).toEqual({ spec: "tools/run.ts --out runs/scaffold/hunt1 --experiment device --preset ponds --conditions pond-nat --seeds 4905001 --steps 20000 --census 1000 --deep 10 --checkpoint 0", finalHash: DEVICE_REF });
    expect(queue.hunt).toEqual({ doc: "docs/scaffold-transition-hunt-v1.md", sha256: HUNT1_PROTOCOL.sha256, bytes: 38_736 });
  });

  it("has three instances of 130, 122 and 122 commands with unique ids", () => {
    expect(queue.instances.map((i) => [i.instance, i.histories])).toEqual([[1, [0, 7]], [2, [8, 15]], [3, [16, 23]]]);
    expect(queue.commands).toHaveLength(374);
    expect([1, 2, 3].map((n) => queue.commands.filter((c) => c.instance === n).length)).toEqual([130, 122, 122]);
    expect(new Set(queue.commands.map((c) => c.id)).size).toBe(374);
    // lane.sh's one retry excludes only ids that begin with devcheck, and ops/done is keyed by the id
    for (const c of queue.commands) expect(c.id, c.id).toMatch(/^[a-z0-9-]+$/);
    expect(queue.commands.filter((c) => c.id.split("-")[0] === "devcheck").map((c) => c.id)).toEqual(["devcheck-1", "devcheck-2", "devcheck-3"]);
  });
});

describe("the assay sets", () => {
  /** The σ index of a Stage 1 set, from its id as the hunt states it (24 a + i, 96 + j, 100 + i, 96 for a genome-only set and the control). */
  function sigmaIndex(id: string): number {
    if (id === "s1-genome-control" || id.endsWith("-genome")) return 96;
    let m = /^s1-(nat-a|shuf-a|nat-s|shuf-s)-i(\d\d)(-quench)?$/.exec(id);
    if (m) return 24 * ARMS.indexOf(m[1] as (typeof ARMS)[number]) + Number(m[2]);
    m = /^s1-anc-j(\d)$/.exec(id);
    if (m) return 96 + Number(m[1]);
    m = /^s1-src-i(\d\d)$/.exec(id);
    if (m) return 100 + Number(m[1]);
    throw new Error(`not a Stage 1 set: ${id}`);
  }
  const instanceOfSet = (id: string): 1 | 2 | 3 => {
    const m = /^s1-(?:nat-a|shuf-a|nat-s|shuf-s|src)-i(\d\d)/.exec(id);
    return m === null ? 1 : instanceOfIndex(Number(m[1]));
  };

  it("covers each of the 269 sets exactly once, and nothing else", () => {
    const ids = assayCommands().map((c) => c.id.slice(2));
    expect(ids).toHaveLength(269);
    expect(new Set(ids).size).toBe(269);
    expect([...ids].sort()).toEqual(hunt1ExpectedSets("s1").map((s) => s.labels.set).sort());
    expect([...ids].sort()).toEqual(huntExpectedSets("s1").map((s) => s.id).sort());
    // the hunt's own count: 124 W sets (96 histories, 4 ancestor worlds, 24 sources), 48 quenched, 96 genome-only, the control
    const kind = (variant: string) => hunt1ExpectedSets("s1").filter((s) => s.labels.variant === variant).length;
    expect([kind("w"), kind("quench"), kind("genome"), kind("genome-control")]).toEqual([124, 48, 96, 1]);
    for (const c of assayCommands()) expect(parseHunt1Set("s1", c.id.slice(2)).labels.set).toBe(c.id.slice(2));
  });

  it("gives every set its own seed σ(h, 0), flags, regime and output directory", () => {
    const expected = new Map(huntExpectedSets("s1").map((s) => [s.id, s]));
    for (const c of assayCommands()) {
      const id = c.id.slice(2);
      const f = assayOf(c);
      const set = parseHunt1Set("s1", id);
      expect(f.stage, id).toBe("s1");
      expect(f.set, id).toBe(id);
      // σ(h, 0) = 4,902,001 + 10 h, written out here, from the hunt's formula, and from the report's expectation of the set
      expect(Number(f.seed), id).toBe(4_902_001 + 10 * sigmaIndex(id));
      expect(Number(f.seed), id).toBe(hunt1SeedOf(set.labels, 0));
      expect(Number(f.seed), id).toBe(expected.get(id)!.seeds[0].physics);
      // the flags of the variant, and only those
      expect(f.quench === true, id).toBe(set.labels.variant === "quench");
      expect(f["genome-from"] !== undefined, id).toBe(set.labels.variant === "genome");
      expect(f["genome-founder"] === true, id).toBe(set.labels.variant === "genome-control");
      // the regime the tool insists on: k 8, period 10,000, ref 103,058, 8 x 8 ponds, census 100, zone 28, four replicates
      expect([f.k, f.period, f.ref, f.side, f.census, f.export, f.replicates].map(Number)).toEqual([8, 10_000, 103_058, 8, 100, 28, 4]);
      expect(hunt1RegimeProblems({ k: Number(f.k), period: Number(f.period), ref: Number(f.ref), side: Number(f.side), censusEvery: Number(f.census), export: Number(f.export), replicates: Number(f.replicates) }), id).toEqual([]);
      expect(f.out, id).toBe(`runs/scaffold/hunt1/assays/${id}`);
      expect(hunt1AssayOutProblems(set.labels, f.out as string), id).toEqual([]);
      expect(Object.keys(f).filter((k) => !["stage", "set", "source", "quench", "genome-from", "genome-founder", "k", "period", "ref", "side", "census", "export", "replicates", "seed", "out"].includes(k)), id).toEqual([]);
    }
  });

  it("reads each set's source and genome donor from the bundle its id names, on the instance that produced it", () => {
    const produced = new Map<number, Set<string>>();
    for (const n of [1, 2, 3]) produced.set(n, new Set(histCommands().filter((c) => c.instance === n).map((c) => histOf(c).dir)));
    const shipped = (n: number) => new Set(queue.instances[n - 1].ship.map((p) => p.replace(/\/(manifest\.json|checkpoints\/b100-pre\.blck)$/, "")));
    for (const c of assayCommands()) {
      const id = c.id.slice(2);
      const f = assayOf(c);
      const set = parseHunt1Set("s1", id);
      const n = c.instance;
      expect(n, id).toBe(instanceOfSet(id));
      const dir = (s: Hunt1Source): string => {
        if (s.kind === "hist") return `runs/scaffold/hunt1/hist/ponds/pond-${s.arm.startsWith("nat") ? "nat" : "shuf"}/seed-${4_901_001 + 100 * ARMS.indexOf(s.arm) + s.i}`;
        if (s.kind === "anc") return `runs/scaffold/hunt1/${n === 1 ? "anc" : "anc-copy"}/ponds/pond-cont/seed-${4_901_401 + s.j}`;
        if (s.kind === "src") return `runs/scaffold/reg1/hist/ponds/treatment/seed-${4_850_001 + s.i}`;
        throw new Error(s.kind);
      };
      expect(f.source, id).toBe(dir(set.source));
      if (set.donor === null) expect(f["genome-from"], id).toBeUndefined();
      else expect(f["genome-from"], id).toBe(dir(set.donor));
      // the tool's own check of the directory (the experiment is free, the rest is the hunt's) and, for a -s source, the registration's directory
      for (const s of [set.source, ...(set.donor === null ? [] : [set.donor])]) {
        const path = s === set.source ? (f.source as string) : (f["genome-from"] as string);
        if (s.kind === "src") expect(path.endsWith(hunt1SourceDirsOf(s.i)[0]), id).toBe(true);
        else if (s.kind !== "v1") expect(hunt1BundleTailsOf(hunt1BundleWant(s), path), `${id}: ${path}`).not.toBeNull();
        expect(produced.get(n)!.has(path) || shipped(n).has(path), `${id}: ${path} is neither produced on instance ${n} nor shipped to it`).toBe(true);
      }
    }
    // an ancestor world 0 off instance 1 is the anc-copy world, and nothing reads another instance's
    const copy = assayCommands().filter((c) => c.instance !== 1 && /--source \S*\/anc/.test(c.cmd));
    expect(copy).toHaveLength(64);
    for (const c of copy) expect(c.cmd).toContain("--source runs/scaffold/hunt1/anc-copy/ponds/pond-cont/seed-4901401 ");
  });
});

describe("the histories and ancestor worlds", () => {
  it("runs each of the 96 histories once, at its seed, steps and checkpoints, on its index's instance", () => {
    const hist = histCommands().filter((c) => histOf(c).experiment === "hist");
    expect(hist).toHaveLength(96);
    const seen = new Set<string>();
    for (const [a, arm] of ARMS.entries()) {
      for (const i of range(24)) {
        const id = `h-${arm}-i${pad2(i)}`;
        const c = hist.find((x) => x.id === id)!;
        expect(c, id).toBeDefined();
        seen.add(id);
        const h = histOf(c);
        const s = arm.endsWith("-s");
        // 4,901,001 + 100 a + i, the regime's condition, 2 x 10^6 steps (a) or 10^6 from the source (s), the checkpoints the report needs: 34 or 134, and time C
        expect(h.seed, id).toBe(4_901_001 + 100 * a + i);
        expect(h.condition, id).toBe(arm.startsWith("nat") ? "pond-nat" : "pond-shuf");
        expect(h.steps, id).toBe(s ? 1_000_000 : 2_000_000);
        expect(h.pre, id).toEqual(s ? [134, 200] : [34, 200]);
        expect(h.branch, id).toBe(s ? `runs/scaffold/reg1/hist/ponds/treatment/seed-${4_850_001 + i}` : undefined);
        expect(c.instance, id).toBe(instanceOfIndex(i));
        expect(c.deps, id).toEqual([`devcheck-${c.instance}`]);
        expect(c.cmd, id).not.toMatch(/--override|pondDeath/);
      }
    }
    expect(seen.size).toBe(96);
    // the report's own expectation of the 96 bundles
    expect(huntExpectedRuns("history").map((r) => [r.seed, r.id])).toEqual(ARMS.flatMap((arm, a) => range(24).map((i) => [4_901_001 + 100 * a + i, `${arm}-i${pad2(i)}`])));
  });

  it("orders each instance's histories by index, the two 2 x 10^6-step histories of an index before its two 10^6-step ones, and puts the ancestor worlds after them", () => {
    for (const n of [1, 2, 3] as const) {
      const own = queue.commands.filter((c) => c.instance === n);
      expect(own[0].id).toBe(`devcheck-${n}`);
      const hist = own.filter((c) => c.id.startsWith("h-") && histOf(c).experiment === "hist");
      expect(hist.map((c) => c.id)).toEqual(range(8).flatMap((d) => ARMS.map((arm) => `h-${arm}-i${pad2(8 * (n - 1) + d)}`)));
      const lastHist = own.indexOf(hist[hist.length - 1]);
      const anc = own.filter((c) => c.id.startsWith("h-anc"));
      expect(own.slice(1, 1 + hist.length)).toEqual(hist);
      expect(own.indexOf(anc[0])).toBe(lastHist + 1);
      // every assay comes after the histories and the ancestor worlds
      for (const c of own.filter((x) => x.id.startsWith("a-"))) expect(own.indexOf(c)).toBeGreaterThan(own.indexOf(anc[anc.length - 1]));
    }
  });

  it("runs the four ancestor worlds on instance 1 and ancestor world 0 again, as anc-copy, on instances 2 and 3", () => {
    const anc = histCommands().filter((c) => histOf(c).experiment === "anc");
    expect(anc.map((c) => [c.id, c.instance, histOf(c).seed, histOf(c).steps, histOf(c).pre, histOf(c).condition])).toEqual(range(4).map((j) => [`h-anc-j${j}`, 1, 4_901_401 + j, 10_000, [1], "pond-cont"]));
    const copy = histCommands().filter((c) => histOf(c).experiment === "anc-copy");
    expect(copy.map((c) => [c.id, c.instance, histOf(c).seed, histOf(c).steps, histOf(c).pre, histOf(c).condition])).toEqual([2, 3].map((n) => [`h-anc-copy-${n}`, n, 4_901_401, 10_000, [1], "pond-cont"]));
    expect(huntExpectedRuns("ancestor").map((r) => r.seed)).toEqual(anc.map((c) => histOf(c).seed));
    expect(histCommands()).toHaveLength(96 + 4 + 2);
  });

  it("makes bundles the report accepts: each command's spec, as the manifest it writes, passes huntBundleProblems for the role its seed names", () => {
    /** The manifest tools/run.ts writes for the command's spec, as the hunt's bundle check reads it. */
    const manifestOf = (h: ReturnType<typeof histOf>, start: number) => ({
      runId: `${h.experiment}/ponds/${h.condition}/seed-${h.seed}`,
      spec: { experiment: h.experiment, presetId: "ponds", condition: h.condition, seed: h.seed, steps: h.steps, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0, preCycleCheckpoints: h.pre },
      cfg: { mutRate: 429_497, pondPeriod: 10_000, tilesX: 8, tilesY: 8, pondArm: h.condition.slice(5), ...(h.condition === "pond-cont" ? {} : { pondDeath: 32_768, pondExport: 28 }) },
      presetIdentity: "56526b894cfccf3f",
      ...(h.branch === undefined ? { initHash: "c".repeat(16) } : { branch: { source: h.branch, sourceHash: "a".repeat(16), boundary: 100, postHash: "b".repeat(16) } }),
      startStep: start,
      preCycleCheckpoints: h.pre.map((b) => ({ boundary: b, step: b * 10_000, file: reg1PreCycleFileOf(b), hash: "e".repeat(16) })),
      summary: { steps: start + h.steps, finalHash: "d".repeat(16), conservationOk: true },
      finishedAt: "2026-10-04T00:00:00.000Z",
    });
    for (const c of histCommands()) {
      const h = histOf(c);
      const m = manifestOf(h, h.branch === undefined ? 0 : 1_000_000);
      const r = huntRoleOf(m);
      expect("role" in r, c.id).toBe(true);
      if (!("role" in r)) continue;
      const want = h.condition === "pond-cont" ? { kind: "ancestor", id: `ancestor-j${h.seed - 4_901_401}` } : { kind: "history", id: `${h.condition.slice(5)}-${h.branch === undefined ? "a" : "s"}-i${pad2((h.seed - 4_901_001) % 100)}` };
      expect(r.role, c.id).toMatchObject(want);
      expect(huntBundleProblems(m, r.role, { pondDeath: 32_768, dir: h.dir }), c.id).toEqual([]);
    }
  });

  it("gives ancestor world 0's anc-copy to the assay tool as a source, and the report authenticates its genome-only sets by state hash", async () => {
    const small = PRESETS.find((p) => p.id === "ponds-small")!;
    const mut = pondConfig(2, 0).mutRate;
    const files = new Map<string, Uint8Array>();
    const read = async (p: string): Promise<Uint8Array> => {
      const f = files.get(p);
      if (f === undefined) throw new Error(`ENOENT ${p}`);
      return f;
    };
    // ancestor world 0 on the small preset, as the runner writes it under <experiment> (anc on instance 1, anc-copy on 2 and 3): one deterministic state
    const want = { ...hunt1BundleWant({ kind: "anc", j: 0 }), presetId: "ponds-small", presetIdentity: presetIdentity(small), period: 1000, side: 2, mutRate: mut };
    const put = (experiment: string): string => {
      const spec: RunSpec = { experiment, presetId: "ponds-small", condition: "pond-cont", seed: want.seed, steps: 1000, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0, preCycleCheckpoints: [1] };
      const state: WorldState = { ...initWorld(specConfig(spec), small.init), step: 1000 };
      const file = reg1PreCycleFileOf(1);
      const dir = `runs/scaffold/hunt1/${experiment}/ponds-small/pond-cont/seed-${want.seed}`;
      files.set(`${dir}/${file}`, encodeCheckpoint(state, { ponds: { lastCycle: 0 } }));
      files.set(
        `${dir}/manifest.json`,
        new TextEncoder().encode(
          JSON.stringify({ runId: `${experiment}/ponds-small/pond-cont/seed-${want.seed}`, spec, cfg: specConfig(spec), presetIdentity: presetIdentity(small), ruleVersion: 1, startStep: 0, startedAt: "2026-10-04T00:00:00.000Z", checkpoints: [], preCycleCheckpoints: [{ boundary: 1, step: 1000, file, hash: stateHash(state) }], summary: { conservationOk: true, finalHash: "f".repeat(16) }, finishedAt: "2026-10-04T01:00:00.000Z" }),
        ),
      );
      return dir;
    };
    const canonical = put("anc");
    const copy = put("anc-copy");
    const a = await loadHunt1Source(canonical, 1, read, want);
    const b = await loadHunt1Source(copy, 1, read, want);
    expect(hunt1BundleProblems(want, a.record)).toEqual([]);
    expect(hunt1BundleProblems(want, b.record)).toEqual([]);
    expect(hunt1BundleProblems(want, JSON.parse(JSON.stringify(b.record)))).toEqual([]);
    expect(b.record.source).toBe(copy);
    // the copy is the same state: its hash is the canonical world's, which is what the report holds a genome-only set to
    expect(b.record.stateHash).toBe(a.record.stateHash);

    // A genome-only set of instance 2 plants fragments of its copy: provenance.source is the copy's directory, provenance.stateHash the canonical b001-pre hash.
    const sets = [huntExpectedSets("s1").find((s) => s.id === "s1-nat-a-i08-genome")!, huntExpectedSets("s1").find((s) => s.id === "s1-genome-control")!];
    const rowsOf = (inoculum: string): HuntFragment[] =>
      range(4).flatMap((replicate) => range(64).map((pond) => huntFragmentRow({ assay: "export", inoculum, replicate: String(replicate), pond: String(pond), family: String(pond), retMass: "1000", retE: "5", endTrait: "30000", success: String(assaySuccess(30_000, 1000, 103_058)), exportMass: String(100 + pond) })));
    const donorHash = "9".repeat(16);
    const setDir = (set: (typeof sets)[number], stateHash: string) => {
      const inoculum = set.kind === "genome" ? "swap-ea" : "swap-aa";
      const rows = rowsOf(inoculum);
      const w = huntWOf(rows);
      const id = set.id;
      const json = {
        assay: "export",
        source: "x",
        k: 8,
        period: 10_000,
        ref: 103_058,
        side: 8,
        replicates: 4,
        mutRate: 0,
        censusEvery: 100,
        export: 28,
        inoculum,
        seeds: range(4).map((s) => ({ physics: set.seeds[s].physics, fragment: set.seeds[s].fragment })),
        labels: { hunt1: true, stage: "s1", set: id, arm: set.kind === "genome" ? "nat-a" : null, history: set.kind === "genome" ? 8 : null, h: 96, variant: set.kind, control: set.kind === "genome" ? null : "ancestor-genome" },
        provenance: { source: copy, stateHash, ...(set.kind === "genome" ? { donor: { source: "runs/scaffold/hunt1/hist/ponds/pond-nat/seed-4901009", stateHash: donorHash, dominant: { hi: 1, lo: 2 } } } : {}) },
        protocolSha256Hunt1: HUNT1_PROTOCOL.sha256,
        summary: { W: w.W, Wexport: w.W, families: w.families, fragments: w.fragments, edgeShare: w.edgeShare },
        conservationOk: true,
      };
      return { dir: `assays/${id}`, json, rows };
    };
    const bundles = new Map<string, { resolved: boolean; hashes: Record<number, string>; branch: null; ponds: null }>([
      ["ancestor-j0", { resolved: true, hashes: { 1: a.record.stateHash }, branch: null, ponds: null }],
      ["nat-a-i08", { resolved: true, hashes: { 200: donorHash }, branch: null, ponds: null }],
    ]);
    const ok = huntScreenSets(sets.map((s) => setDir(s, b.record.stateHash)), { stage: "s1", sha: HUNT1_PROTOCOL.sha256, bundles });
    expect(ok.rejected).toEqual([]);
    expect(ok.accepted.map((s) => s.id)).toEqual(["s1-nat-a-i08-genome", "s1-genome-control"]);
    // a copy that is not canonical world 0's state is refused, whatever its path says
    const bad = huntScreenSets(sets.map((s) => setDir(s, "0".repeat(16))), { stage: "s1", sha: HUNT1_PROTOCOL.sha256, bundles });
    expect(bad.accepted).toEqual([]);
    expect(bad.rejected.map((r) => r.reasons.join(" "))).toEqual(sets.map(() => expect.stringMatching(/is not ancestor-j0's b001-pre hash/)));
  });

  it("must keep the anc-copy bundles out of the report's --runs: given beside the canonical world they make ancestor-j0 ambiguous", async () => {
    const h = { experiment: "anc", condition: "pond-cont", seed: 4_901_401, steps: 10_000, pre: [1] };
    const manifestOf = (experiment: string) => ({
      runId: `${experiment}/ponds/pond-cont/seed-${h.seed}`,
      spec: { experiment, presetId: "ponds", condition: h.condition, seed: h.seed, steps: h.steps, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0, preCycleCheckpoints: h.pre },
      cfg: { mutRate: 429_497, pondPeriod: 10_000, tilesX: 8, tilesY: 8, pondArm: "cont" },
      presetIdentity: "56526b894cfccf3f",
      initHash: "c".repeat(16),
      startStep: 0,
      preCycleCheckpoints: [{ boundary: 1, step: 10_000, file: reg1PreCycleFileOf(1), hash: "e".repeat(16) }],
      summary: { steps: 10_000, finalHash: "d".repeat(16), conservationOk: true },
      finishedAt: "2026-10-04T00:00:00.000Z",
    });
    const resolve = async (dirs: string[]) => {
      const bundles = dirs.map((d) => ({ dir: d, manifest: manifestOf(d.split("/")[3]) }));
      const { runs } = await huntResolveRuns(bundles, huntExpectedRuns("ancestor"), { pondDeath: 32_768, readPonds: async () => ({ problems: [], summary: null }), checkpointSize: async () => 1 });
      return runs.find((r) => r.id === "ancestor-j0")!;
    };
    const anc = "runs/scaffold/hunt1/anc/ponds/pond-cont/seed-4901401";
    const copy = "runs/scaffold/hunt1/anc-copy/ponds/pond-cont/seed-4901401";
    expect((await resolve([anc])).resolved).toBe(true);
    const both = await resolve([anc, copy]);
    expect(both.resolved).toBe(false);
    expect(both.why.join(" ")).toMatch(/2 finished run bundles/);
  });
});

describe("dependencies and the device check", () => {
  it("runs the device check first on each instance, and every other command depends on it", () => {
    for (const n of [1, 2, 3] as const) {
      const own = queue.commands.filter((c) => c.instance === n);
      expect(own[0]).toEqual({ id: `devcheck-${n}`, instance: n, deps: [], cmd: "bash ops/devcheck.sh" });
      for (const c of own.slice(1)) expect(c.deps, c.id).toContain(`devcheck-${n}`);
    }
  });

  it("lists only earlier commands of the same instance as dependencies, and gives each assay the commands that produce its inputs", () => {
    const index = new Map(queue.commands.map((c, k) => [c.id, k]));
    const byId = new Map(queue.commands.map((c) => [c.id, c]));
    for (const [k, c] of queue.commands.entries()) {
      expect(new Set(c.deps).size, c.id).toBe(c.deps.length);
      for (const d of c.deps) {
        expect(index.has(d), `${c.id} -> ${d}`).toBe(true);
        expect(index.get(d)!, `${c.id} -> ${d} must come earlier`).toBeLessThan(k);
        expect(byId.get(d)!.instance, `${c.id} -> ${d}`).toBe(c.instance);
        // a plain dependency: a failure propagates (no ordering-only ~ dependency is used)
        expect(d.startsWith("~"), c.id).toBe(false);
      }
    }
    const histId = (s: Hunt1Source, n: number): string | null => (s.kind === "hist" ? `h-${s.arm}-i${pad2(s.i)}` : s.kind === "anc" ? (n === 1 ? `h-anc-j${s.j}` : `h-anc-copy-${n}`) : null);
    for (const c of assayCommands()) {
      const set = parseHunt1Set("s1", c.id.slice(2));
      const produces = [set.source, ...(set.donor === null ? [] : [set.donor])].map((s) => histId(s, c.instance)).filter((d): d is string => d !== null);
      expect([...c.deps].sort(), c.id).toEqual([`devcheck-${c.instance}`, ...produces].sort());
    }
    // a -s source is a shipped registration bundle: nothing in the queue produces it
    for (const c of assayCommands().filter((x) => x.id.startsWith("a-s1-src-"))) expect(c.deps, c.id).toEqual([`devcheck-${c.instance}`]);
  });

  it("runs the pinned hunt text, the device spec at seed 4,905,001 and the Mac's finalHash in devcheck.sh", () => {
    const sh = readFileSync(join(tmp, "ops", "devcheck.sh"), "utf8");
    // the pin is the frozen hunt: the document's first 38,736 bytes hash to it
    const doc = readFileSync(join(REPO, HUNT1_PROTOCOL.doc));
    expect(createHash("sha256").update(doc.subarray(0, 38_736)).digest("hex")).toBe("13246200a5277ecbbbefb8d5b220f61a10ba1d33dc39a748fefbc224904a1f97");
    expect(sh).toContain(`head -c 38736 docs/scaffold-transition-hunt-v1.md | sha256sum | cut -c1-64)" = 13246200a5277ecbbbefb8d5b220f61a10ba1d33dc39a748fefbc224904a1f97`);
    expect(sh).toContain("deno run -A tools/run.ts --out runs/scaffold/hunt1 --experiment device --preset ponds --conditions pond-nat --seeds 4905001 --steps 20000 --census 1000 --deep 10 --checkpoint 0 ||");
    expect(sh).toContain("runs/scaffold/hunt1/device/ponds/pond-nat/seed-4905001/manifest.json");
    expect(sh).toContain(`[ "$got" = "${DEVICE_REF}" ]`);
    expect(HUNT_SEEDS.device).toBe(4_905_001);
    // what the report reads of a device bundle: the run is the device role, which no seed of the histories shares
    const m = { runId: "device/ponds/pond-nat/seed-4905001", spec: { experiment: "device", presetId: "ponds", condition: "pond-nat", seed: 4_905_001, steps: 20_000, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0 }, cfg: { mutRate: 429_497, pondPeriod: 10_000, tilesX: 8, tilesY: 8, pondArm: "nat", pondDeath: 32_768, pondExport: 28 }, initHash: "c".repeat(16), startStep: 0, summary: { steps: 20_000, finalHash: DEVICE_REF, conservationOk: true }, finishedAt: "2026-10-04T00:00:00.000Z" };
    const r = huntRoleOf(m);
    expect("role" in r && r.role.kind).toBe("device");
    expect(huntBundleProblems(m, (r as { role: Parameters<typeof huntBundleProblems>[1] }).role, { pondDeath: 32_768, dir: "runs/scaffold/hunt1/device/ponds/pond-nat/seed-4905001" })).toEqual([]);
  });
});

describe("balance and cost", () => {
  /** The steps of a command, from its own text: a history's STEPS, the device check's 20,000, an assay's replicates x one period. */
  function stepsOf(c: Command): number {
    if (c.id.startsWith("devcheck-")) return 20_000;
    if (c.id.startsWith("h-")) return histOf(c).steps;
    return (c.cmd.includes(" --quench ") ? 1 : 4) * 10_000;
  }

  it("gives the instances 48 x 10^6 steps of histories each and the same total to within 0.5%, about the hunt's 153 x 10^6", () => {
    const totals = [1, 2, 3].map((n) => queue.commands.filter((c) => c.instance === n).reduce((s, c) => s + stepsOf(c), 0));
    for (const n of [1, 2, 3]) {
      const hist = queue.commands.filter((c) => c.instance === n && c.id.startsWith("h-") && histOf(c).experiment === "hist");
      expect(hist.reduce((s, c) => s + histOf(c).steps, 0)).toBe(8 * (2 * 2_000_000 + 2 * 1_000_000));
      expect(queue.instances[n - 1].estimatedSteps).toBe(totals[n - 1]);
    }
    expect(totals).toEqual([51_300_000, 51_070_000, 51_070_000]);
    expect(Math.max(...totals) / Math.min(...totals) - 1).toBeLessThan(0.005);
    const total = totals.reduce((s, t) => s + t, 0);
    expect(total).toBeGreaterThan(153e6);
    expect(total).toBeLessThan(154e6);
  });

  it("counts 93, 88 and 88 assay sets and 33 or 36 histories and ancestor worlds on the instances", () => {
    expect([1, 2, 3].map((n) => assayCommands().filter((c) => c.instance === n).length)).toEqual([93, 88, 88]);
    expect([1, 2, 3].map((n) => histCommands().filter((c) => c.instance === n).length)).toEqual([36, 33, 33]);
  });
});

describe("the registration's sources", () => {
  it("ships each instance the manifest.json and checkpoints/b100-pre.blck of its eight sources and nothing else", () => {
    for (const n of [1, 2, 3]) {
      const lo = 8 * (n - 1);
      const want = range(8).flatMap((d) => {
        const dir = `runs/scaffold/reg1/hist/ponds/treatment/seed-${4_850_001 + lo + d}`;
        return [`${dir}/manifest.json`, `${dir}/checkpoints/b100-pre.blck`];
      });
      expect(queue.instances[n - 1].ship).toEqual(want);
      expect(readFileSync(join(tmp, "ops", `ship-${n}.txt`), "utf8")).toBe(want.join("\n") + "\n");
      // every registration path a command of the instance names is one of those directories
      const dirs = new Set(want.map((p) => p.replace(/\/(manifest\.json|checkpoints\/b100-pre\.blck)$/, "")));
      for (const c of queue.commands.filter((x) => x.instance === n)) for (const path of c.cmd.match(/runs\/scaffold\/reg1\/\S+/g) ?? []) expect(dirs.has(path), `${c.id}: ${path}`).toBe(true);
    }
    // -s pair i branches from the registration's scaf history i, whichever instance runs it: both arms of an index share the one source
    for (const i of range(24)) {
      const pair = [`h-nat-s-i${pad2(i)}`, `h-shuf-s-i${pad2(i)}`].map((id) => histOf(queue.commands.find((c) => c.id === id)!).branch);
      expect(pair).toEqual(range(2).map(() => `runs/scaffold/reg1/hist/ponds/treatment/seed-${4_850_001 + i}`));
      expect(queue.commands.find((c) => c.id === `a-s1-src-i${pad2(i)}`)!.cmd).toContain(`--source ${pair[0]} `);
    }
  });
});

describe("the reproducibility draw", () => {
  it("selects shuf-s i13 (value 85) and shuf-a i04 (value 28) by randomKey(4,905,101, 0, k, 0) mod 96, drawn here independently of the generator", () => {
    const draws: { k: number; value: number }[] = [];
    for (let k = 0; new Set(draws.map((d) => d.value)).size < 2; k++) draws.push({ k, value: randomKey(4_905_101, 0, k, 0) % 96 });
    expect(draws).toEqual([{ k: 0, value: 85 }, { k: 1, value: 28 }]);
    expect(queue.mac.reproducibility.draws).toEqual(draws);
    expect(HUNT_SEEDS.reproducibility).toBe(4_905_101);
    // the report's own draw agrees
    expect(huntReproSelection().selected.map((s) => [s.value, s.id])).toEqual([[85, "shuf-s-i13"], [28, "shuf-a-i04"]]);
    expect(queue.mac.reproducibility.reruns.map((r) => [r.value, r.history, r.seed, r.boundary])).toEqual([[85, "shuf-s-i13", 4_901_314, 134], [28, "shuf-a-i04", 4_901_105, 34]]);
    // 85 = 3 x 24 + 13 (shuf-s, seed 4,901,001 + 300 + 13); 28 = 24 + 4 (shuf-a, seed 4,901,001 + 100 + 4)
    expect(Math.floor(85 / 24)).toBe(3);
    expect(Math.floor(28 / 24)).toBe(1);
  });

  it("reruns each on the Mac for 340,000 steps to boundary 34 (-a) or 134 (-s, a branch from its registration source), as the instance's history, under --experiment repro", () => {
    const [s, a] = queue.mac.reproducibility.reruns;
    expect(s.cmd).toBe("deno run -A tools/run.ts --out runs/scaffold/hunt1 --experiment repro --preset ponds --conditions pond-shuf --seeds 4901314 --steps 340000 --census 1000 --deep 10 --checkpoint 0 --pre-cycle 134 --branch-from runs/scaffold/reg1/hist/ponds/treatment/seed-4850014 --branch-boundary 100");
    expect(a.cmd).toBe("deno run -A tools/run.ts --out runs/scaffold/hunt1 --experiment repro --preset ponds --conditions pond-shuf --seeds 4901105 --steps 340000 --census 1000 --deep 10 --checkpoint 0 --pre-cycle 34");
    // the instance's own run of each: the same condition and seed, and (for the -s history) the same source
    const own = (id: string) => histOf(queue.commands.find((c) => c.id === `h-${id}`)!);
    expect([own("shuf-s-i13").condition, own("shuf-s-i13").seed, own("shuf-s-i13").branch]).toEqual(["pond-shuf", 4_901_314, "runs/scaffold/reg1/hist/ponds/treatment/seed-4850014"]);
    expect([own("shuf-a-i04").condition, own("shuf-a-i04").seed, own("shuf-a-i04").branch]).toEqual(["pond-shuf", 4_901_105, undefined]);
    expect(own("shuf-s-i13").pre).toContain(134);
    expect(own("shuf-a-i04").pre).toContain(34);
    // the report takes a 340,000-step bundle of a history's seed as a rerun, with the one pre-cycle checkpoint
    for (const [r, start, pre] of [[s, 1_000_000, [134]], [a, 0, [34]]] as const) {
      const m = {
        runId: `repro/ponds/pond-shuf/seed-${r.seed}`,
        spec: { experiment: "repro", presetId: "ponds", condition: "pond-shuf", seed: r.seed, steps: 340_000, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0, preCycleCheckpoints: pre },
        cfg: { mutRate: 429_497, pondPeriod: 10_000, tilesX: 8, tilesY: 8, pondArm: "shuf", pondDeath: 32_768, pondExport: 28 },
        presetIdentity: "56526b894cfccf3f",
        ...(start === 0 ? { initHash: "c".repeat(16) } : { branch: { source: "runs/x", sourceHash: "a".repeat(16), boundary: 100, postHash: "b".repeat(16) } }),
        startStep: start,
        preCycleCheckpoints: pre.map((b) => ({ boundary: b, step: b * 10_000, file: reg1PreCycleFileOf(b), hash: "e".repeat(16) })),
        summary: { steps: start + 340_000, finalHash: "d".repeat(16), conservationOk: true },
        finishedAt: "2026-10-04T00:00:00.000Z",
      };
      const role = huntRoleOf(m);
      expect("role" in role && role.role.kind, r.history).toBe("repro");
      expect("role" in role && role.role.id, r.history).toBe(r.history);
      expect(huntBundleProblems(m, (role as { role: Parameters<typeof huntBundleProblems>[1] }).role, { pondDeath: 32_768, dir: `runs/scaffold/hunt1/repro/ponds/pond-shuf/seed-${r.seed}` }), r.history).toEqual([]);
    }
  });
});

describe("the queue as the report reads it", () => {
  const status = (done: (c: Command) => "done" | "fail" | null) =>
    [1, 2, 3].map((n) => ({ instance: n, commands: Object.fromEntries(queue.commands.filter((c) => c.instance === n && done(c) !== null).map((c) => [c.id, done(c)])) }));

  it("is complete under synthetic all-done status files, and not under a missing command", () => {
    expect(reg1ReportQueueCheck(queue, status(() => "done"))).toEqual({ complete: true, commands: 374, done: 374, failed: 0, pending: [], reasons: [] });
    // a failed command is terminal (an unresolved history is data), a missing one is not
    const one = reg1ReportQueueCheck(queue, status((c) => (c.id === "a-s1-nat-a-i00" ? "fail" : "done")));
    expect(one).toMatchObject({ complete: true, done: 373, failed: 1 });
    const open = reg1ReportQueueCheck(queue, status((c) => (c.id === "a-s1-genome-control" ? null : "done")));
    expect(open).toMatchObject({ complete: false, pending: ["a-s1-genome-control"] });
    // a command's state counts only from its own instance's status file
    const swapped = status(() => "done");
    swapped[0].instance = 2;
    swapped[1].instance = 1;
    expect(reg1ReportQueueCheck(queue, swapped).complete).toBe(false);
    expect(huntQueueInstances(queue)).toBe(3);
  });
});

describe("the ops files", () => {
  const ops = (f: string) => readFileSync(join(tmp, "ops", f), "utf8");

  it("writes each instance's commands as id|deps|command lines in queue order", () => {
    for (const n of [1, 2, 3]) {
      const lines = ops(`cmds-${n}.txt`).trimEnd().split("\n");
      expect(lines).toEqual(queue.commands.filter((c) => c.instance === n).map((c) => `${c.id}|${c.deps.length ? c.deps.join(",") : "-"}|${c.cmd}`));
      for (const line of lines) expect(line.split("|"), line).toHaveLength(3);
    }
  });

  it("copies the AWS scripts from tools/hunt1-ops/aws as they are, renders the launchd plist for this workspace, and writes no account value, credential or key", () => {
    for (const f of ["launch.sh", "supervise.sh", "bootstrap.sh", "finish.sh", "make-src.sh", "rsh", "rcp"]) {
      expect(ops(f), f).toBe(readFileSync(join(REPO, "tools", "hunt1-ops", "aws", f), "utf8"));
      expect(statSync(join(tmp, "ops", f)).mode & 0o111, `${f} stays executable`).not.toBe(0);
    }
    // no aws.conf in the scratch directory: the plist takes this workspace
    const plist = ops("com.browser-life.scaf-hunt1.plist");
    expect(plist).not.toContain("@WORKSPACE@");
    expect(plist).toContain(`<string>${REPO}/runs/scaffold/ops-hunt1/supervise.sh</string>`);
    expect(plist).toBe(readFileSync(join(REPO, "tools", "hunt1-ops", "aws", "com.browser-life.scaf-hunt1.plist"), "utf8").replaceAll("@WORKSPACE@", REPO));
    for (const f of ["aws.conf", "awsenv.sh", "bl_key", "bl_key.pub"]) expect(existsSync(join(tmp, "ops", f)), f).toBe(false);
  });

  it("fills the plist from WORKSPACE in the state directory's aws.conf when there is one", () => {
    const dir = mkdtempSync(join(tmpdir(), "hunt1-queue-conf-"));
    try {
      mkdirSync(join(dir, "ops"));
      writeFileSync(join(dir, "ops", "aws.conf"), "VPC=x\nWORKSPACE=/some/other/workspace\n");
      execFileSync("deno", ["run", "-A", QUEUE_TS, "--device-ref", DEVICE_REF, "--out", join(dir, "queue.json"), "--ops", join(dir, "ops")], { cwd: REPO, stdio: "pipe" });
      const plist = readFileSync(join(dir, "ops", "com.browser-life.scaf-hunt1.plist"), "utf8");
      expect(plist).toContain("<string>/some/other/workspace/runs/scaffold/ops-hunt1/supervise.sh</string>");
      expect(plist).not.toContain(REPO);
      expect(readFileSync(join(dir, "ops", "aws.conf"), "utf8")).toBe("VPC=x\nWORKSPACE=/some/other/workspace\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("reads WORKSPACE as bash does (quotes are shell syntax, as when make-src.sh sources aws.conf), and refuses a path the plist cannot carry", () => {
    const dir = mkdtempSync(join(tmpdir(), "hunt1-queue-quoted-"));
    const gen = () => execFileSync("deno", ["run", "-A", QUEUE_TS, "--device-ref", DEVICE_REF, "--out", join(dir, "queue.json"), "--ops", join(dir, "ops")], { cwd: REPO, stdio: "pipe" });
    try {
      mkdirSync(join(dir, "ops"));
      writeFileSync(join(dir, "ops", "aws.conf"), 'VPC=x\nWORKSPACE="/some/quoted workspace"\n');
      gen();
      const plist = readFileSync(join(dir, "ops", "com.browser-life.scaf-hunt1.plist"), "utf8");
      expect(plist).toContain("<string>/some/quoted workspace/runs/scaffold/ops-hunt1/supervise.sh</string>");
      expect(plist).not.toContain('"/some');
      writeFileSync(join(dir, "ops", "aws.conf"), "WORKSPACE='/a&b'\n");
      expect(gen).toThrow(/the plist cannot carry/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it("takes lane.sh, start.sh, watchdog.sh and history.sh from tools/hunt1-ops", () => {
    for (const f of ["lane.sh", "start.sh", "watchdog.sh", "history.sh"]) expect(ops(f), f).toBe(readFileSync(join(REPO, "tools", "hunt1-ops", f), "utf8"));
    // the hunt's own copies differ from the registration's: commands in their own process groups; a lock, live claims and live groups kept; no power-off
    expect(ops("lane.sh")).toContain("setsid");
    expect(ops("lane.sh")).not.toBe(readFileSync(join(REPO, "tools", "reg1-ops", "lane.sh"), "utf8"));
    expect(ops("start.sh")).toContain("fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)");
    expect(ops("start.sh")).toContain("claim_dead");
    expect(ops("start.sh")).not.toBe(readFileSync(join(REPO, "tools", "reg1-ops", "start.sh"), "utf8"));
    expect(ops("lane.sh")).toContain("reap_group");
    expect(ops("watchdog.sh")).toContain("start.sh sweep");
    expect(ops("watchdog.sh").split("\n").filter((l) => !l.startsWith("#")).join("\n")).not.toMatch(/poweroff|shutdown/);
    const h = ops("history.sh");
    // under runs/scaffold/hunt1 (never the registration's tree), census 1,000 then the -c100 rerun, branching only when given a source
    expect(h).not.toContain("runs/scaffold/reg1");
    expect(h).toContain("--out runs/scaffold/hunt1 --experiment $1 --preset ponds --conditions $2 --seeds $3 --steps $4 --census 1000 --deep 10 --checkpoint 0 --pre-cycle $5 $br");
    expect(h).toContain("--out runs/scaffold/hunt1 --experiment $1-c100 --preset ponds --conditions $2 --seeds $3 --steps $4 --census 100 --deep 10 --checkpoint 0 --pre-cycle $5 $br");
    expect(h).toContain('br="--branch-from $6 --branch-boundary 100"');
  });
});
