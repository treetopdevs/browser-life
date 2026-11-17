// tools/atlas-ledger.ts and tools/bootstrap.ts parse Deno.args at top level, so these spawn the real CLIs on tiny
// temp directories. Nothing here needs a GPU: replay-check is CPU only, and bootstrap.ts --confirm-only with
// --confirm-reps 0 and an empty logged archive requests no device; the refusals throw before any GPU work.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generalistGenome, genomeHex } from "@bl/schema";
import { DEFAULT_EVAL } from "@bl/search";

const LEDGER = fileURLToPath(new URL("../atlas-ledger.ts", import.meta.url));
const BOOTSTRAP = fileURLToPath(new URL("../bootstrap.ts", import.meta.url));
const deno = (script: string, args: string[]) => {
  const r = spawnSync("deno", ["run", "--no-lock", "-A", script, ...args], { encoding: "utf8", timeout: 120_000 });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const tmp = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-cli-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};
// An empty logged archive: no elites, no lineages, no viable offers.
const emptyArchive = (search: object) => JSON.stringify({ evaluated: 0, eval: DEFAULT_EVAL, search, batches: 1, searchSeeds: [1, 1], viableCount: 0, lineages: [], elites: [] });
const SEARCH = { select: "lineages", passBias: 0.5, random: 0.25 };

describe("atlas-ledger replay-check: gate.json", () => {
  it("skips only a missing gate.json; a valid one is compared; a truncated one fails", () => {
    const dir = tmp({ "archive.json": emptyArchive(SEARCH), "viable.jsonl": "" });
    try {
      const missing = deno(LEDGER, ["replay-check", dir]);
      expect(missing.status, missing.err).toBe(0);
      expect(JSON.parse(missing.out)).toMatchObject({ identical: true, checks: { passersMatchGateJson: true } });
      writeFileSync(join(dir, "gate.json"), "[]");
      const valid = deno(LEDGER, ["replay-check", dir]);
      expect(valid.status, valid.err).toBe(0);
      writeFileSync(join(dir, "gate.json"), '[{"cell": [1, 2], "genome": {"mu"');
      const truncated = deno(LEDGER, ["replay-check", dir]);
      expect(truncated.status).not.toBe(0);
      expect(truncated.out).not.toMatch(/"identical": true/);
      expect(truncated.err).toMatch(/SyntaxError|JSON/);
      for (const bad of ["null", "false", "0", '""', '[{"cell": [1, 2]}]']) {
        writeFileSync(join(dir, "gate.json"), bad);
        const r = deno(LEDGER, ["replay-check", dir]);
        expect(r.status, bad).not.toBe(0);
        expect(r.out, bad).not.toMatch(/"identical": true/);
        expect(r.err, bad).toMatch(/not a list of gate entries/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240_000);
});

describe("bootstrap.ts: --archive atlas-v1 with --medium background", () => {
  const medium = `background:${genomeHex(generalistGenome(60, 20))}`;
  it("--confirm-only on a mass-speed archive warns about --archive atlas-v1 and ignores it, background medium and all", () => {
    const dir = tmp({ "archive.json": emptyArchive(SEARCH), "viable.jsonl": "" });
    try {
      const r = deno(BOOTSTRAP, ["--confirm-only", "--confirm-reps", "0", "--archive", "atlas-v1", "--medium", medium, "--out", dir]);
      expect(r.status, r.err).toBe(0);
      expect(r.err).toMatch(/ignoring --archive atlas-v1 \(searched with mass-speed\)/);
      expect(r.err).not.toMatch(/does not support --medium background/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240_000);
  it("still refuses background media for an atlas-v1 archive, searched or recorded", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-cli-"));
    try {
      const search = deno(BOOTSTRAP, ["--archive", "atlas-v1", "--uncalibrated-smoke", "--medium", medium, "--batches", "1", "--out", join(dir, "run")]);
      expect(search.status).not.toBe(0);
      expect(search.err).toMatch(/does not support --medium background/);
      expect(existsSync(join(dir, "run"))).toBe(false);
      writeFileSync(join(dir, "archive.json"), emptyArchive({ ...SEARCH, archive: "atlas-v1" }));
      writeFileSync(join(dir, "viable.jsonl"), "");
      const confirm = deno(BOOTSTRAP, ["--confirm-only", "--confirm-reps", "0", "--medium", medium, "--out", dir]);
      expect(confirm.status).not.toBe(0);
      expect(confirm.err).toMatch(/does not support --medium background/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240_000);
});
