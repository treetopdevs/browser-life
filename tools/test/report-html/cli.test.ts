// Exercises tools/report-html.ts as a subprocess: it's a Deno CLI script
// (Deno.args/Deno.readFile/Deno.stat/Deno.writeTextFile, and a top-level
// `await main()`, matching tools/nullcal.ts's/tools/individuality.ts's own
// convention for a CLI-only file never imported as a library), so vitest
// (Node) cannot import it directly -- it has to run `deno run -A ...` as a
// child process, the same way the design contract's own determinism check
// for this CLI is specified to.
//
// Most cases here only need the registry/dispatch/argument-handling logic
// to run, independent of any one track's renderer content: track/arity
// validation, the --out overwrite guard, --status validation, and
// JSON-parse error reporting. All four tracks now have real renderers
// (tools/lib/report-html/{nullcal,individuality,anticipation,biogeography}.ts)
// -- the dedicated "dispatches <track> to its real renderer" cases below
// exercise that each one is actually wired up in the TRACKS registry.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPondHistory, parsePondRows, pondDossier } from "../../lib/pond-lineage.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CLI = "tools/report-html.ts";

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("deno", ["run", "-A", CLI, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status: number | null; stdout: Buffer | string; stderr: Buffer | string };
    return { status: err.status ?? 1, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "report-html-cli-"));
});

afterEach(() => {
  // Best-effort cleanup; vitest doesn't require it, but keeps /tmp tidy
  // across repeated local runs.
  try {
    execFileSync("rm", ["-rf", dir]);
  } catch {
    // ignore
  }
});

describe("tools/report-html.ts CLI", () => {
  it("prints usage and exits non-zero with no arguments", () => {
    const r = run([]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usage: deno run -A tools\/report-html\.ts/);
  });

  it("rejects an unknown track, listing the known ones", () => {
    const input = join(dir, "report.json");
    writeFileSync(input, "{}");
    const r = run(["not-a-track", input, "--out", join(dir, "out.html")]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unknown track "not-a-track"/);
    expect(r.stderr).toMatch(/nullcal, individuality, anticipation, biogeography, lineage/);
  });

  it("rejects the wrong number of input files for a track", () => {
    const input = join(dir, "report.json");
    writeFileSync(input, "{}");
    const r = run(["anticipation", input, "--out", join(dir, "out.html")]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/anticipation takes 2 input file\(s\) \(results, manifest\), got 1/);
  });

  it("reports a specific error for invalid JSON input", () => {
    const input = join(dir, "bad.json");
    writeFileSync(input, "not json");
    const r = run(["nullcal", input, "--out", join(dir, "out.html")]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/bad\.json: not valid JSON/);
  });

  it("rejects an unknown --status value", () => {
    const input = join(dir, "report.json");
    writeFileSync(input, "{}");
    const r = run(["nullcal", input, "--out", join(dir, "out.html"), "--status", "weird"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--status must be one of REAL, PILOT, SMOKE/);
  });

  // Every track now has a real renderer (tools/lib/report-html/{nullcal,
  // individuality,anticipation,biogeography}.ts) -- the old "stub" stand-in
  // this test used to cover no longer applies to any of them. Each track's
  // own dispatch is covered individually below instead.
  it("dispatches nullcal to its real renderer instead of the stub", () => {
    const input = join(REPO_ROOT, "tools/fixtures/report-html/nullcal/report.json");
    const out = join(dir, "nullcal.html");
    const r = run(["nullcal", input, "--out", out]);
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(out, "utf8");
    expect(html.startsWith("<title>Null Gate Calibration</title>")).toBe(true);
  });

  it("dispatches individuality to its real renderer instead of the stub", () => {
    const input = join(REPO_ROOT, "tools/fixtures/report-html/individuality/report.json");
    const out = join(dir, "individuality.html");
    const r = run(["individuality", input, "--out", out]);
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(out, "utf8");
    expect(html.startsWith("<title>")).toBe(true);
  });

  it("dispatches anticipation to its real renderer instead of the stub", () => {
    const results = join(REPO_ROOT, "tools/fixtures/report-html/anticipation/results.json");
    const manifest = join(REPO_ROOT, "tools/fixtures/report-html/anticipation/manifest.json");
    const out = join(dir, "anticipation.html");
    const r = run(["anticipation", results, manifest, "--out", out]);
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(out, "utf8");
    expect(html.startsWith("<title>")).toBe(true);
  });

  it("dispatches biogeography to its real renderer instead of the stub", () => {
    const report = join(REPO_ROOT, "tools/fixtures/report-html/biogeography/report.json");
    const experiment = join(REPO_ROOT, "tools/fixtures/report-html/biogeography/experiment.json");
    const out = join(dir, "biogeography.html");
    const r = run(["biogeography", report, experiment, "--out", out]);
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(out, "utf8");
    expect(html.startsWith("<title>Island Biogeography</title>")).toBe(true);
  });

  it("dispatches lineage to its real renderer, with SMOKE status on request", () => {
    // A pond dossier is cheap to build in-process (a genotype dossier needs a CPU history; its renderer
    // is covered in lineage.test.ts).
    const ponds = ["cycle\tstep\trecipient\tdonor\trecipientTrait", "1\t100\t0\t1\t5", "1\t100\t1\t1\t9", "2\t200\t0\t0\t7", "2\t200\t1\t0\t3"];
    const dossier = pondDossier(buildPondHistory(parsePondRows(ponds), { arm: "scaf" }), { kind: "top" });
    const input = join(dir, "dossier.json");
    writeFileSync(input, JSON.stringify(dossier));
    const out = join(dir, "lineage.html");
    const r = run(["lineage", input, "--out", out, "--status", "smoke"]);
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(out, "utf8");
    expect(html.startsWith("<title>Pond Lineage Dossier</title>")).toBe(true);
    expect(html).toContain('class="status-chip status-smoke"');
  });

  it("refuses to overwrite an existing --out without --force, and proceeds (past the guard) with --force", () => {
    const input = join(dir, "report.json");
    const out = join(dir, "existing.html");
    writeFileSync(input, "{}");
    writeFileSync(out, "previous contents");

    const withoutForce = run(["nullcal", input, "--out", out]);
    expect(withoutForce.status).not.toBe(0);
    expect(withoutForce.stderr).toMatch(/already exists -- pass --force to overwrite it/);
    // The file must be untouched.
    expect(readFileSync(out, "utf8")).toBe("previous contents");

    const withForce = run(["nullcal", input, "--out", out, "--force"]);
    expect(withForce.status).not.toBe(0);
    // Reaches the real renderer's validate() (nullcal is wired up now), i.e.
    // it got PAST the overwrite guard -- proving --force is what let it
    // through, not that the guard is a no-op. `{}` fails validate() on the
    // missing "config" object, which is a validation error, not the guard.
    expect(withForce.stderr).toMatch(/nullcal: missing "config" object/);
  });

  it("computes a real SHA-256 of the input file and includes it (truncated to 12 hex chars) in a successful run's stdout", () => {
    // Every track now has a real renderer, so this runs the CLI itself
    // end-to-end on a real fixture and checks the sha256:<hex> prefix it
    // prints in stdout against an independently computed digest of that same
    // input file -- unlike the previous version of this test, which hashed
    // an unrelated hard-coded string via a separate inline Deno script and
    // never ran tools/report-html.ts or inspected its stdout at all.
    const input = join(REPO_ROOT, "tools/fixtures/report-html/nullcal/report.json");
    const out = join(dir, "nullcal.html");
    const r = run(["nullcal", input, "--out", out]);
    expect(r.status, r.stderr).toBe(0);

    const bytes = readFileSync(input);
    const fullHash = createHash("sha256").update(bytes).digest("hex");
    const truncated = fullHash.slice(0, 12);

    expect(r.stdout).toContain(`@${truncated}`);
  });
});
