import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildWorld, encodeCheckpoint, totalsOf, type WorldConfig } from "@bl/schema";
import { ledgerEnergy, pondConfig, pondMatter } from "../lib/ponds.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const reversed = (cfg: WorldConfig): WorldConfig => Object.fromEntries(Object.entries(cfg).reverse()) as unknown as WorldConfig;

/** An extinct post-cycle history, so a valid resume settles without requesting a GPU. */
function fixture(out: string, metadata: Partial<Record<string, unknown>> = {}, checkpoint: Partial<WorldConfig> = {}) {
  const cfg = pondConfig(1, 7, 0);
  const state = buildWorld(reversed({ ...cfg, ...checkpoint }), { nutrient: 32, founders: [] });
  state.step = 10;
  const config = reversed(cfg); // Historical JSON key order is not part of the identity.
  const meta = {
    tool: "scaffold", arm: "scaf", k: 1, period: 10, side: 1, seed: 7, mutRate: 0,
    init: "clone", censusEvery: 10, cycles: 1, ruleVersion: 1, config,
    configSha256: sha(JSON.stringify(config)),
    protocolSha256: sha(readFileSync(join(REPO, "docs/scaffold-protocol-v1.md"))),
    startMatter: totalsOf(state.cfg, state.cells).matter.toString(),
    baseline: ledgerEnergy(state).toString(), Mr: pondMatter(state), ...metadata,
  };
  const files: Record<string, Uint8Array | string> = {
    "meta.json": JSON.stringify(meta),
    "done.json": JSON.stringify({ ended: false, fixture: "retained on rejection" }),
    "ckpt/b1-pre.blck.gz": gzipSync(encodeCheckpoint(state)),
    "ckpt/b1-post.blck.gz": gzipSync(encodeCheckpoint(state)),
    "ckpt/status.json": JSON.stringify({ boundary: 1, ended: true, endedAt: 1 }),
    "ponds.tsv": "boundary\tstep\n1\t10\n2\t20\n",
    "lineages.tsv": "boundary\tstep\n1\t10\n2\t20\n",
    "progress.tsv": "boundary\tstep\twallSeconds\n1\t10\t1\n2\t20\t2\n",
  };
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), contents);
  }
}

function snapshot(out: string): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(path: string) {
    for (const entry of readdirSync(join(out, path), { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) walk(next);
      else files[next] = readFileSync(join(out, next)).toString("hex");
    }
  }
  walk("");
  return files;
}

function resume(out: string) {
  return spawnSync("deno", ["run", "-A", "tools/scaffold.ts", "evolve", "--resume", "--allow-any-seed",
    "--out", out, "--arm", "scaf", "--k", "1", "--period", "10", "--cycles", "2", "--side", "1",
    "--seed", "7", "--mut-off", "--census", "10"], { cwd: REPO, encoding: "utf8", timeout: 15_000 });
}

describe("frozen scaffold resume physics identity", () => {
  it("settles a legitimate rule-1 checkpoint regardless of config key order", () => {
    const out = mkdtempSync(join(tmpdir(), "scaffold-resume-"));
    try {
      fixture(out);
      const result = resume(out);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("done.json restored, nothing to advance");
      expect(JSON.parse(readFileSync(join(out, "done.json"), "utf8"))).toMatchObject({ ok: true, ended: true, endedAt: 1 });
      expect(JSON.parse(readFileSync(join(out, "meta.json"), "utf8"))).toMatchObject({ ruleVersion: 1, config: { ruleVersion: 1 } });
    } finally { rmSync(out, { recursive: true, force: true }); }
  });

  it.each([
    ["metadata rule", { ruleVersion: 2 }, {}, /--resume: ruleVersion/],
    ["metadata config", { config: { ...pondConfig(1, 7, 0), ruleVersion: 2 } }, {}, /meta\.json config differs/],
    ["checkpoint rule", {}, { ruleVersion: 2, polymerDrag: true }, /checkpoint configuration differs/],
    ["checkpoint parameter", {}, { dtQ: pondConfig(1, 7, 0).dtQ + 1 }, /checkpoint configuration differs/],
  ] as const)("rejects mismatched %s before changing any output", (_name, metadata, checkpoint, message) => {
    const out = mkdtempSync(join(tmpdir(), "scaffold-resume-"));
    try {
      fixture(out, metadata, checkpoint);
      const before = snapshot(out);
      const result = resume(out);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toMatch(message);
      expect(snapshot(out)).toEqual(before);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
});
