import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scratch = mkdtempSync(join(tmpdir(), "bl-mutation-neighborhood-"));
const cli = fileURLToPath(new URL("../mutation-neighborhood.ts", import.meta.url));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const run = (out: string, extra: string[] = [], env: NodeJS.ProcessEnv = process.env) =>
  spawnSync("deno", ["run", "-A", cli, "--out", out, "--samples", "1", ...extra], {
    encoding: "utf8", timeout: 15_000, env,
  });

describe("mutation-neighborhood CLI manifest lifecycle", () => {
  it("refuses an existing output before requesting a GPU or changing the file", () => {
    const out = join(scratch, "existing.json");
    writeFileSync(out, "sentinel");
    const result = run(out, ["--pilot", "1"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("output already exists");
    expect(result.stderr).not.toContain("GPU");
    expect(readFileSync(out, "utf8")).toBe("sentinel");
  });

  it("retains an explicit failed manifest when a pilot fails after reservation", () => {
    const out = join(scratch, "failed.json");
    const result = run(out, ["--pilot", "1"], { ...process.env, BL_MUTATION_TEST_FAIL_AFTER_RESERVE: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("injected failure after manifest reservation");
    const manifest = JSON.parse(readFileSync(out, "utf8"));
    expect(manifest.mode).toBe("bounded-pilot");
    expect(manifest.execution).toEqual({ status: "failed", completedPairs: 0, error: "injected failure after manifest reservation" });
    expect(manifest.seedReservations.plannedPilotSeeds).toEqual([620000001]);
    expect(manifest.pilot.results).toEqual([]);
    expect(manifest.sourceIdentity.selectedSourceSha256["packages/sim-ref/src/step.ts"]).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sourceIdentity.selectedSourceSha256["packages/sim-gpu/src/shaders.ts"]).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sourceIdentity.hashScope).toContain("not a complete dependency closure");
  });
});
