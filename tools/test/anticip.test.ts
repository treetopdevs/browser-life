// tools/anticip.ts's top-level Deno.args parsing and `jsr:` import rule out
// importing it directly into a vitest/node process, so everything here that
// needs the tool's own code spawns a real `deno run` subprocess: (1) the CLI
// itself, end to end on a tiny known-viable config, and (2) a fixture
// (tools/test/fixtures/anticip-checks.ts) that imports and calls the tool's
// actual exported `phaseA`/`AnticipParams` for the determinism and
// checkpoint-round-trip checks -- never a from-scratch reimplementation, so a
// bug specific to anticip.ts's own config composition is still caught.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../anticip.ts", import.meta.url));
const CHECKS_FIXTURE = fileURLToPath(new URL("./fixtures/anticip-checks.ts", import.meta.url));
// A known-viable tiny config: 3 founders on a 32x32 tile, 2 Phase-A periods,
// never collapses (rerun this test's fixture if that ever changes).
const TINY_ARGS = [
  "--seeds", "1",
  "--period", "20",
  "--periods-a", "2",
  "--switch-shorter", "10",
  "--switch-longer", "40",
  "--k", "1",
  "--tile", "32",
  "--founders", "3",
  "--kernel-radius", "3",
];

describe("CLI (real production code): a tiny run completes end to end", () => {
  it("writes results.json/manifest.json with the expected shape, from a known-viable seed", () => {
    const out = join(mkdtempSync(join(tmpdir(), "anticip-test-")), "run");
    try {
      execFileSync("deno", ["run", "-A", SCRIPT, ...TINY_ARGS, "--out", out], { stdio: "pipe" });
      const results = JSON.parse(readFileSync(join(out, "results.json"), "utf8"));
      const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));

      // The single seed must actually have run to completion, not silently
      // collapsed -- a regression that drops all data (e.g. every Phase-A
      // world marked collapsed) would otherwise still satisfy a shape-only
      // check with n=0 everywhere.
      expect(results.seeds).toHaveLength(1);
      expect(results.seeds[0].collapsedPhaseA).toBe(false);
      for (const dir of ["shorter", "longer"] as const) {
        const branch = results.seeds[0].branches[dir];
        expect(branch).toBeDefined();
        expect(branch.index).toBeTypeOf("number");
        expect(Number.isFinite(branch.index)).toBe(true);
        expect(Number.isFinite(branch.costEvolved)).toBe(true);
        expect(Number.isFinite(branch.costFounder)).toBe(true);
        expect(branch.index).toBeCloseTo(branch.costEvolved - branch.costFounder, 10);

        // The family result must be built from this same seed's cost, not
        // silently empty: with exactly one non-collapsed seed, n must be
        // exactly 1 (not merely >= 0, which is tautologically true for any
        // run and cannot catch a broken pairing/inference pipeline).
        const family = results.family[dir];
        expect(family.n).toBe(1);
        expect(family.collapsed).toBe(0);
        expect(family.phaseACollapsed).toBe(0);
        // The primary point estimate (the mean) must equal this one seed's
        // own index, and -- the point of this check -- it must be present
        // even though a single seed can't be bootstrapped into a CI below.
        expect(family.meanIndex).toBeCloseTo(branch.index, 10);
        // The median is descriptive only, but for n=1 it necessarily equals
        // the same single value as the mean.
        expect(family.medianIndex).toBeCloseTo(branch.index, 10);
        // A single seed can't be bootstrapped into a CI -- meanIndex above
        // must still be present despite that.
        expect(family.ci.status).toBe("insufficient-replication");
        expect(family.ci.lo).toBeNull();
        expect(family.ci.hi).toBeNull();
      }

      expect(manifest.preset).toBe("spots-m3");
      expect(manifest.schemaVersion).toBeTypeOf("number");
    } finally {
      rmSync(join(out, ".."), { recursive: true, force: true });
    }
  });

  it("--control-level-shift: applies the documented delta and the level-shift branch's cost reflects it", () => {
    const out = join(mkdtempSync(join(tmpdir(), "anticip-test-")), "run");
    try {
      execFileSync("deno", ["run", "-A", SCRIPT, ...TINY_ARGS, "--control-level-shift", "--out", out], { stdio: "pipe" });
      const results = JSON.parse(readFileSync(join(out, "results.json"), "utf8"));
      const longer = results.seeds[0].branches.longer;
      const control = results.seeds[0].levelShiftControl;
      expect(control).toBeDefined();

      // TINY_ARGS's "longer" switch has a realized light-mean delta well over
      // 0.5 on this known-viable seed (rerun this test's fixture if that ever
      // changes), so the control must actually apply rather than round to 0 --
      // otherwise this test would pass vacuously without touching the
      // applied:true branch at all.
      expect(control.applied).toBe(true);
      expect(control.delta).not.toBe(0);
      // The delta is documented (docs/anticipation.md section 4) as the sign
      // and rounded magnitude of the "longer" switch branch's own realized
      // light-mean delta -- wrong sign or wrong rounding in that computation
      // would be caught here even though it reuses reported numbers rather
      // than an independent light computation.
      expect(control.delta).toBe(Math.sign(longer.lightMeanDelta) * Math.round(Math.abs(longer.lightMeanDelta)));

      // The level shift must have actually perturbed the branch: a CONTINUE
      // compared against itself always costs exactly 0, so a nonzero cost
      // here is direct evidence the delta was threaded into branch()'s cfg
      // rather than silently dropped.
      expect(control.costEvolved).toBeTypeOf("number");
      expect(control.costFounder).toBeTypeOf("number");
      expect(Number.isFinite(control.costEvolved)).toBe(true);
      expect(Number.isFinite(control.costFounder)).toBe(true);
      expect(control.costEvolved).not.toBe(0);
      expect(control.costFounder).not.toBe(0);
      expect(control.index).toBeCloseTo(control.costEvolved - control.costFounder, 10);
    } finally {
      rmSync(join(out, ".."), { recursive: true, force: true });
    }
  });

  it("--control-level-shift: reports the control as unavailable instead of crashing when the derived light config is out of range", () => {
    // Known-reproducing case: a "longer" switch far past the period drives a
    // realized light-mean delta whose magnitude exceeds lightBase (20, from
    // BASE_OVERRIDE), so `lightBase + delta` goes negative -- this must not
    // throw out of RefSim's constructor and abort the whole seed (losing the
    // otherwise-valid primary shorter/longer result along with it).
    const out = join(mkdtempSync(join(tmpdir(), "anticip-test-")), "run");
    const args = [
      "--seeds", "1",
      "--period", "200",
      "--periods-a", "2",
      "--switch-shorter", "100",
      "--switch-longer", "1000",
      "--k", "1",
      "--tile", "32",
      "--founders", "3",
      "--kernel-radius", "3",
      "--control-level-shift",
      "--out", out,
    ];
    try {
      execFileSync("deno", ["run", "-A", SCRIPT, ...args], { stdio: "pipe" });
      const results = JSON.parse(readFileSync(join(out, "results.json"), "utf8"));
      const control = results.seeds[0].levelShiftControl;
      expect(control.unavailable).toBe(true);
      expect(control.applied).toBe(false);
      expect(control.costEvolved).toBeNull();
      expect(control.costFounder).toBeNull();
      expect(control.index).toBeNull();
      expect(typeof control.reason).toBe("string");
      // The primary (non-control) result for this seed must still be intact.
      expect(results.seeds[0].collapsedPhaseA).toBe(false);
      expect(results.family.shorter.n).toBe(1);
      expect(results.family.longer.n).toBe(1);
    } finally {
      rmSync(join(out, ".."), { recursive: true, force: true });
    }
  });

  it("refuses to run into an --out directory that already exists", () => {
    const out = join(mkdtempSync(join(tmpdir(), "anticip-test-")), "run");
    try {
      execFileSync("deno", ["run", "-A", SCRIPT, ...TINY_ARGS, "--out", out], { stdio: "pipe" });
      expect(() => execFileSync("deno", ["run", "-A", SCRIPT, ...TINY_ARGS, "--out", out], { stdio: "pipe" })).toThrow();
    } finally {
      rmSync(join(out, ".."), { recursive: true, force: true });
    }
  });
});

describe("anticip.ts's own phaseA/checkpoint composition (spawned under Deno; see fixtures/anticip-checks.ts)", () => {
  it("phaseA is deterministic and a Phase-A end state round-trips through encodeCheckpoint/decodeCheckpoint", () => {
    const out = execFileSync("deno", ["run", "-A", CHECKS_FIXTURE], { stdio: "pipe" }).toString("utf8");
    const result = JSON.parse(out.trim().split("\n").pop()!);
    expect(result.determinism).toBe(true);
    expect(result.hash1).toBe(result.hash2);
    expect(result.roundTrip).toBe(true);
    expect(result.decodedHash).toBe(result.hash1);
    // branch()'s direct in-memory clone (no checkpoint round-trip in the
    // control-flow path, see tools/anticip.ts's own comment on `branch`) must
    // be state-equivalent to branching from the decoded checkpoint -- i.e.
    // the shortcut never diverges from the restore path the design names.
    expect(result.branchMatchesCheckpoint).toBe(true);
  });
});
