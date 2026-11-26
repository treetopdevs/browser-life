// tools/slab-readout.ts under Deno on synthetic bundles: exit codes (0 verdict, 2 unusable input, 3 extension seeds pending), the files it
// writes, the cfg-agreement check and the hidden rehearsal mode. The rule itself is tools/test/slab-readout.test.ts's.
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { sameCompletedRun, specConfig, type RunSpec } from "@bl/runner";
import { METRICS_VERSION, RULE_VERSION, SCHEMA_VERSION } from "@bl/schema";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const run = promisify(execFile);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * A finished bundle whose top layers hold `top` photo out of 100 counts and bottom layers `bottom`, at every census of the window
 * ending at `final`, with the manifest the runner writes (the spec and the config `specConfig` builds for it).
 */
function bundle(root: string, cond: "treatment" | "neutral", seed: number, top: number, bottom: number, o: { final?: number; censuses?: number; mu?: number; skipStep?: number; hash?: string; tweak?: (m: Record<string, any>) => void } = {}) {
  const final = o.final ?? 300_000, censuses = o.censuses ?? 10;
  const dir = join(root, "slab-check", "slab-spots", cond, `seed-${seed}`);
  mkdirSync(dir, { recursive: true });
  const rows = ["step\tz\tphoto\tgrow\tdecomp\tresp\tsaturated"];
  for (let k = 0; k < censuses; k++) {
    const step = final - 1000 * (censuses - 1 - k);
    if (step === o.skipStep) continue;
    for (let z = 0; z < 8; z++) {
      const p = z < 2 ? top : z >= 6 ? bottom : 77;
      rows.push(`${step}\t${z}\t${p}\t${100 - p}\t0\t0\t0`);
    }
  }
  writeFileSync(join(dir, "layers.tsv"), rows.join("\n") + "\n");
  const spec: RunSpec = { experiment: "slab-check", presetId: "slab-spots", condition: cond, seed, steps: final, censusEvery: 1000, deepEvery: 1, checkpointEvery: 0, overrides: { defaultMu: o.mu ?? 60, defaultSigma: 20, lightK: 1024 } };
  const cfg = specConfig(spec);
  const manifest: Record<string, any> = {
    spec,
    cfg,
    init: { kind: "slab-spots", founders: 8, nutrient: 32, biomass: 64 },
    ruleVersion: cfg.ruleVersion,
    summary: { steps: final, finalHash: o.hash ?? `hash-${cond}-${seed}`, conservationOk: true, extinct: false },
  };
  o.tweak?.(manifest);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
}
function check(arms: { treatment: [number, number][]; neutral: [number, number][] }, extra?: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "slab-readout-"));
  dirs.push(root);
  for (const cond of ["treatment", "neutral"] as const) arms[cond].forEach(([t, b], k) => bundle(root, cond, k + 1, t, b));
  extra?.(root);
  return root;
}
async function readout(root: string, ...more: string[]): Promise<{ code: number; out: string }> {
  try {
    const r = await run("deno", ["run", "--no-lock", "-A", "tools/slab-readout.ts", "--out", root, ...more], { cwd: ROOT });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    return { code: x.code, out: x.stdout + x.stderr };
  }
}
const SLOW = 120_000;
const FLAT: [number, number][] = [[50, 50], [50, 50], [50, 50]];

describe("tools/slab-readout.ts", () => {
  it("writes readout.md and readout.json and exits 0 on a verdict", async () => {
    const root = check({ treatment: [[70, 50], [75, 50], [80, 50]], neutral: FLAT });
    const r = await readout(root);
    expect(r.code).toBe(0);
    expect(existsSync(join(root, "readout.md"))).toBe(true);
    expect(readFileSync(join(root, "readout.md"), "utf8")).toMatch(/\*\*Verdict: go\./);
    const j = JSON.parse(readFileSync(join(root, "readout.json"), "utf8"));
    expect(j.verdict).toBe("go");
    expect(j.params).toMatchObject({ defaultMu: 60, defaultSigma: 20, lightK: 1024, ruleVersion: expect.any(Number) });
    expect(r.out).toMatch(/defaultMu 60, defaultSigma 20, lightK 1024/);
  }, SLOW);

  it("exits 0 with pause: control undefined for an empty-group neutral seed", async () => {
    const root = check({ treatment: [[70, 50], [75, 50], [80, 50]], neutral: [[50, 50], [50, 50], [50, 50]] }, (r) => {
      // a neutral seed whose bottom layers recorded no counts at all
      const f = join(r, "slab-check", "slab-spots", "neutral", "seed-2", "layers.tsv");
      writeFileSync(f, readFileSync(f, "utf8").replace(/^(\d+\t[67]\t)\d+\t\d+\t/gm, "$10\t0\t"));
    });
    const res = await readout(root);
    expect(res.code).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "readout.json"), "utf8")).verdict).toBe("pause: control undefined");
  }, SLOW);

  it("exits 3 when 1 or 2 of 3 pass and seeds 4-6 are not there yet", async () => {
    const root = check({ treatment: [[70, 50], [75, 50], [50, 50]], neutral: FLAT });
    const r = await readout(root);
    expect(r.code).toBe(3);
    expect(readFileSync(join(root, "readout.md"), "utf8")).toMatch(/extend: waiting for seeds/);
  }, SLOW);

  it("exits 2 on a missing census, a repeated seed layout, disagreeing configs and an empty directory", async () => {
    const hole = check({ treatment: [[70, 50], [75, 50], [80, 50]], neutral: FLAT }, (r) => bundle(r, "treatment", 2, 75, 50, { skipStep: 295_000 }));
    const a = await readout(hole);
    expect(a.code).toBe(2);
    expect(a.out).toMatch(/evolving seed 2.*no census at step 295000/);
    expect(existsSync(join(hole, "readout.md"))).toBe(false);
    const split = check({ treatment: [[70, 50], [75, 50], [80, 50]], neutral: FLAT }, (r) => bundle(r, "neutral", 3, 50, 50, { mu: 61 }));
    const b = await readout(split);
    expect(b.code).toBe(2);
    expect(b.out).toMatch(/not one check/);
    expect(existsSync(join(split, "readout.md"))).toBe(false);
    const none = mkdtempSync(join(tmpdir(), "slab-readout-"));
    dirs.push(none);
    expect((await readout(none)).code).toBe(2);
    expect((await readout(none, "--rehearsal-steps", "1500")).code).toBe(2);
  }, SLOW);

  it("refuses a bundle that is not the run of its slot: a copied history, a wrong seed, arm or experiment", async () => {
    // seed-1 of the neutral arm copied over treatment seeds 1 and 2 and neutral seed 3 (the repeated-layout slip)
    const copied = check({ treatment: [[70, 50], [75, 50], [80, 50]], neutral: FLAT }, (r) => {
      const src = join(r, "slab-check", "slab-spots", "neutral", "seed-1");
      for (const dest of [["treatment", 1], ["treatment", 2], ["neutral", 3]] as const) {
        const d = join(r, "slab-check", "slab-spots", dest[0], `seed-${dest[1]}`);
        rmSync(d, { recursive: true, force: true });
        cpSync(src, d, { recursive: true });
      }
    });
    const a = await readout(copied);
    expect(a.code).toBe(2);
    expect(a.out).toMatch(/spec\.condition|spec\.seed|cfg\./);
    expect(existsSync(join(copied, "readout.md"))).toBe(false);
    // right directory names, but the manifests were rewritten to hide it: the final state hash still gives it away
    const same = check({ treatment: [[70, 50], [75, 50], [80, 50]], neutral: FLAT }, (r) => bundle(r, "treatment", 2, 75, 50, { hash: "hash-treatment-1" }));
    const b = await readout(same);
    expect(b.code).toBe(2);
    expect(b.out).toMatch(/same final state hash/);
    const slots: [string, (m: Record<string, any>) => void][] = [
      ["a neutral flag under treatment", (m) => (m.cfg.neutral = true)],
      ["a seed the directory does not name", (m) => (m.cfg.seed = 1)],
      ["a spec seed the directory does not name", (m) => (m.spec.seed = 1)],
      ["another experiment", (m) => (m.spec.experiment = "other")],
      ["another preset", (m) => (m.spec.presetId = "spots")],
    ];
    for (const [what, tweak] of slots) {
      const root = check({ treatment: [[70, 50], [75, 50], [80, 50]], neutral: FLAT }, (r) => bundle(r, "treatment", 2, 75, 50, { tweak }));
      const res = await readout(root);
      expect(res.code, what).toBe(2);
      expect(res.out, what).toMatch(/evolving seed 2/);
    }
  }, SLOW);

  it("refuses bundles that are not the fixed check's world, even when they agree with each other", async () => {
    const worlds: [string, (m: Record<string, any>) => void][] = [
      ["32 x 32 x 8", (m) => (m.cfg.tileW = m.cfg.tileH = 32)],
      ["other light", (m) => (m.cfg.lightAmp = 100)],
      ["seasons on", (m) => (m.cfg.seasonPeriod = 4000)],
      ["other founding", (m) => (m.init.founders = 4)],
      ["thinner slab", (m) => (m.cfg.tileD = 4)],
      ["another rule constant", (m) => (m.cfg.kBuild = 65)],
    ];
    for (const [what, tweak] of worlds) {
      const root = mkdtempSync(join(tmpdir(), "slab-readout-"));
      dirs.push(root);
      for (const cond of ["treatment", "neutral"] as const) for (let seed = 1; seed <= 3; seed++) bundle(root, cond, seed, cond === "treatment" ? 70 : 50, 50, { tweak });
      const res = await readout(root);
      expect(res.code, what).toBe(2);
      expect(existsSync(join(root, "readout.json")), what).toBe(false);
    }
  }, SLOW);

  it("exits 2 (not a crash) on malformed dimensions, and removes the previous readout", async () => {
    const root = check({ treatment: [[70, 50], [75, 50], [80, 50]], neutral: FLAT });
    expect((await readout(root)).code).toBe(0);
    expect(existsSync(join(root, "readout.md"))).toBe(true);
    bundle(root, "treatment", 2, 75, 50, { tweak: (m) => { delete m.cfg.tileW; m.cfg.tileH = 256; } });
    const res = await readout(root);
    expect(res.code).toBe(2);
    expect(res.out).not.toMatch(/RangeError/);
    expect(res.out).toMatch(/tileW and tileH must be positive integers/);
    expect(existsSync(join(root, "readout.md"))).toBe(false);
    expect(existsSync(join(root, "readout.json"))).toBe(false);
  }, SLOW);

  it("pauses at once when a finished extension neutral seed has no D, with the other extension seeds missing", async () => {
    const root = check({ treatment: [[70, 50], [75, 50], [50, 50]], neutral: FLAT }, (r) => {
      bundle(r, "neutral", 4, 50, 50);
      const f = join(r, "slab-check", "slab-spots", "neutral", "seed-4", "layers.tsv");
      writeFileSync(f, readFileSync(f, "utf8").replace(/^(\d+\t[67]\t)\d+\t\d+\t/gm, "$10\t0\t"));
    });
    const res = await readout(root);
    expect(res.code).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "readout.json"), "utf8")).verdict).toBe("pause: control undefined");
  }, SLOW);

  it("reports conservationOk and extinct per bundle without letting them move the verdict", async () => {
    const root = check({ treatment: [[70, 50], [75, 50], [80, 50]], neutral: FLAT }, (r) => bundle(r, "treatment", 3, 80, 50, { tweak: (m) => { m.summary.conservationOk = false; m.summary.extinct = true; } }));
    const res = await readout(root);
    expect(res.code).toBe(0);
    const md = readFileSync(join(root, "readout.md"), "utf8");
    expect(md).toMatch(/\*\*Verdict: go\./);
    expect(md).toMatch(/\| evolving \| 3 \| false \| true \|/);
    expect(md).toMatch(/FLAG: evolving 3 did not end with conservationOk true/);
  }, SLOW);

  it("rehearsal mode reads a short run, writes only readout-rehearsal.md and tolerates a lone seed", async () => {
    const root = mkdtempSync(join(tmpdir(), "slab-readout-"));
    dirs.push(root);
    bundle(root, "treatment", 1, 70, 50, { final: 3000, censuses: 3 });
    bundle(root, "neutral", 1, 50, 50, { final: 3000, censuses: 3 });
    const r = await readout(root, "--rehearsal-steps", "3000");
    expect(r.code).toBe(0);
    expect(existsSync(join(root, "readout.md"))).toBe(false);
    expect(existsSync(join(root, "readout.json"))).toBe(false);
    expect(readFileSync(join(root, "readout-rehearsal.md"), "utf8")).toMatch(/REHEARSAL, not a check result/);
    // the real window refuses a short run
    expect((await readout(root)).code).toBe(2);
  }, SLOW);
});

describe("tools/slab-screen.ts: what counts as a complete bundle", () => {
  const dry = async (root: string) => {
    const r = await run("deno", ["run", "--no-lock", "-A", "tools/slab-screen.ts", "--out", root, "--mu", "60", "--sigma", "20", "--light-k", "1024", "--steps", "3000", "--seeds", "1", "--arms", "evolving", "--dry-run"], { cwd: ROOT });
    return r.stdout;
  };
  /** A finished 3,000-step bundle as the runner leaves it, with the manifest sameCompletedRun accepts. */
  function finished(root: string, o: { activity?: boolean; layers?: string } = {}) {
    const dir = join(root, "slab-check", "slab-spots", "treatment", "seed-1");
    mkdirSync(dir, { recursive: true });
    const spec: RunSpec = { experiment: "slab-check", presetId: "slab-spots", condition: "treatment", seed: 1, steps: 3000, censusEvery: 1000, deepEvery: 1, checkpointEvery: 0, overrides: { defaultMu: 60, defaultSigma: 20, lightK: 1024 } };
    const manifest = { spec, cfg: specConfig(spec), ruleVersion: RULE_VERSION, schemaVersion: SCHEMA_VERSION, metricsVersion: METRICS_VERSION, summary: { steps: 3000 } };
    expect(sameCompletedRun(manifest as never, spec)).toBe(true);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    const rows = ["step\tz\tphoto\tgrow\tdecomp\tresp\tsaturated"];
    for (const step of [1000, 2000, 3000]) for (let z = 0; z < 8; z++) rows.push(`${step}\t${z}\t1\t1\t1\t1\t0`);
    writeFileSync(join(dir, "layers.tsv"), o.layers ?? rows.join("\n") + "\n");
    if (o.activity !== false) writeFileSync(join(dir, "activity-final.json"), "{}");
    return dir;
  }
  it("skips a whole bundle and reruns one whose last files are missing or cut off", async () => {
    const mk = () => {
      const root = mkdtempSync(join(tmpdir(), "slab-screen-"));
      dirs.push(root);
      return root;
    };
    const whole = mk();
    finished(whole);
    expect(await dry(whole)).toMatch(/\bcomplete\b/);
    const noActivity = mk();
    finished(noActivity, { activity: false });
    expect(await dry(noActivity)).toMatch(/incomplete/);
    const cut = mk();
    finished(cut, { layers: "step\tz\tphoto\tgrow\tdecomp\tresp\tsaturated\n1000\t0\t1\t1\t1\t1\t0\n" });
    expect(await dry(cut)).toMatch(/incomplete/);
    const nolayers = mk();
    rmSync(join(finished(nolayers), "layers.tsv"));
    expect(await dry(nolayers)).toMatch(/incomplete/);
  }, SLOW);
});
