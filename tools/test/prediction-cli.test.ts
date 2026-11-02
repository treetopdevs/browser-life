// Spawned `deno run --no-lock` smoke test of the CLI: a tiny smoke run, then `validate` on its predictions, then the confirm refusals.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { confirmRefusal, draftProtocol, protocolHash, splitPlanOf } from "../lib/prediction/run.ts";
import { donorsFor } from "../lib/prediction/splits.ts";
import { tinyProtocol } from "./prediction-helpers.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "predict-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const deno = (args: string[]) => spawnSync("deno", ["run", "--no-lock", "-A", "tools/predict.ts", ...args], { cwd: root, encoding: "utf8" });

describe("tools/predict.ts", () => {
  const p = tinyProtocol();
  p.families = p.families.slice(0, 4);
  p.nDev = 2;
  p.nQualify = 1;
  p.donors = donorsFor(splitPlanOf(p), p.salt);
  const protoPath = join(dir, "protocol.json");
  writeFileSync(protoPath, JSON.stringify(p));

  it("runs a tiny smoke stage, writes the canonical files, and validate accepts its predictions", () => {
    const r = deno(["run", "--stage", "smoke", "--protocol", protoPath, "--out", join(dir, "out")]);
    expect(r.status, r.stderr).toBe(0);
    const meta = JSON.parse(readFileSync(join(dir, "out/meta.json"), "utf8"));
    expect(meta.status).toBe("SMOKE");
    expect(meta.statement).toMatch(/No model call/);
    const v = deno(["validate", join(dir, "out/predictions.jsonl")]);
    expect(v.status, v.stdout + v.stderr).toBe(0);
    expect(v.stdout).toMatch(/fixedRule: \d+ lines, invalid 0, missing 0/);
  }, 300_000);
  it("validate fails on a corrupted line", () => {
    const f = join(dir, "bad.jsonl");
    const lines = readFileSync(join(dir, "out/predictions.jsonl"), "utf8").trim().split("\n");
    writeFileSync(f, [lines[0].replace('"abstain":false', '"abstain":true'), ...lines.slice(1)].join("\n") + "\n");
    const v = deno(["validate", f, "--envelopes", join(dir, "out/envelopes.jsonl")]);
    expect(v.status).toBe(1);
  }, 120_000);
  it("refuses an unknown stage", () => {
    const u = deno(["run", "--stage", "bogus", "--out", join(dir, "x")]);
    expect(u.status).toBe(1);
    expect(u.stderr).toMatch(/unknown --stage/);
  }, 120_000);
  it("validate fails on an empty predictions file, reporting every case as missing", () => {
    const f = join(dir, "empty.jsonl");
    writeFileSync(f, "");
    const v = deno(["validate", f, "--envelopes", join(dir, "out/envelopes.jsonl")]);
    expect(v.status).toBe(1);
    expect(v.stdout).toMatch(/\(empty file\): 0 lines, invalid 0, missing [1-9]/);
  }, 120_000);
  it("validate fails on a stray case, and on a tampered envelope whose stale hash is left in place", () => {
    const lines = readFileSync(join(dir, "out/predictions.jsonl"), "utf8").trim().split("\n");
    const mine = lines.filter((l) => l.startsWith('{"prediction":') && l.includes('"proposer":"fixedRule"'));
    const stray = join(dir, "stray.jsonl");
    writeFileSync(stray, [...mine, mine[0].replace(/"caseId":"c[0-9a-f]+"/, '"caseId":"cunknown"')].join("\n") + "\n");
    const v = deno(["validate", stray, "--envelopes", join(dir, "out/envelopes.jsonl")]);
    expect(v.status).toBe(1);
    expect(v.stdout).toMatch(/extra 1/);
    const envs = readFileSync(join(dir, "out/envelopes.jsonl"), "utf8").trim().split("\n");
    const env0 = JSON.parse(envs[0]);
    env0.census[0].mass += 1; // content changed, stored envelopeHash left stale
    const tampered = join(dir, "tampered-envs.jsonl");
    writeFileSync(tampered, [JSON.stringify(env0), ...envs.slice(1)].join("\n") + "\n");
    const t = deno(["validate", join(dir, "out/predictions.jsonl"), "--envelopes", tampered]);
    expect(t.status).toBe(1);
    expect(t.stdout).toMatch(/unsound envelopes [1-9]/);
  }, 120_000);
  it("report keeps the generation source hash and records the renderer's separately", () => {
    const metaPath = join(dir, "out/meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    writeFileSync(metaPath, JSON.stringify({ ...meta, sourceClosureSha256: "generated-by-older-code" }));
    const r = deno(["report", "--out", join(dir, "out")]);
    expect(r.status, r.stderr).toBe(0);
    const after = JSON.parse(readFileSync(metaPath, "utf8"));
    expect(after.sourceClosureSha256).toBe("generated-by-older-code");
    expect(after.reportRenderedFromCanonicalData.sourceClosureSha256).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);
  it("report re-renders the derived files byte for byte from the canonical data", () => {
    const before = ["comparison.md", "report.html", "canonical.sha256"].map((n) => readFileSync(join(dir, "out", n), "utf8"));
    const r = deno(["report", "--out", join(dir, "out")]);
    expect(r.status, r.stderr).toBe(0);
    const after = ["comparison.md", "report.html", "canonical.sha256"].map((n) => readFileSync(join(dir, "out", n), "utf8"));
    expect(after).toEqual(before);
  }, 120_000);
  it("the confirm gate refuses an unfrozen protocol, a missing freeze file, a hash mismatch and an uncommitted freeze", () => {
    const d = draftProtocol();
    expect(confirmRefusal(d, null, undefined)).toMatch(/not frozen/);
    const f = { ...d, frozen: true, minEffect: 50, devPrior: { up: 100, down: 100, none: 800 } };
    expect(confirmRefusal(f, null, undefined)).toMatch(/missing/);
    expect(confirmRefusal(f, "0".repeat(64), undefined)).toMatch(/does not match/);
    expect(confirmRefusal({ ...f, minEffect: 51 }, protocolHash(f), undefined)).toMatch(/does not match/);
    const h = protocolHash(f) + "\n", pj = JSON.stringify(f);
    // A matching working tree is not enough: both files must be in HEAD, byte-equal.
    expect(confirmRefusal(f, h, undefined)).toMatch(/committed/);
    expect(confirmRefusal(f, h, { protocol: null, freeze: null, protocolWorking: pj, freezeWorking: h })).toMatch(/protocol.json is not committed/);
    expect(confirmRefusal(f, h, { protocol: pj, freeze: null, protocolWorking: pj, freezeWorking: h })).toMatch(/freeze.sha256 is not committed/);
    expect(confirmRefusal(f, h, { protocol: pj + " ", freeze: h, protocolWorking: pj, freezeWorking: h })).toMatch(/differs from its committed/);
    expect(confirmRefusal(f, h, { protocol: pj, freeze: "x", protocolWorking: pj, freezeWorking: h })).toMatch(/differs from its committed/);
    expect(confirmRefusal(f, h, { protocol: pj, freeze: h, protocolWorking: pj, freezeWorking: h })).toBeNull();
  });
});
