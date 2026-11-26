import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const checker = "tools/ecosystem-library/verify.py";
const rules = {
  version: 4, size: 96, resourceCap: 8, renewal: 1.2, uptake: 2.4,
  baseCost: 0.45, attackCost: 0.25, defenseCost: 0.35, birthThreshold: 10,
  maxAge: 160, mutationRate: 0.04, predationFood: 3, introductionSize: 24,
};

function sample(tick: number, bins: number[], newlySeen: number[], total: number) {
  return {
    tick,
    counts: [total, 0, 0, 0, 0],
    population: total,
    classes: bins.filter((count) => count > 0).length,
    births: tick,
    deaths: tick,
    mutations: tick,
    bins,
    spatialChangePer25: tick ? 0.25 : 0,
    newlySeen,
  };
}

function fixture(seed = 1101) {
  const first = Array<number>(125).fill(0);
  first[0] = 1;
  const second = [...first];
  second[1] = 1;
  const samples = [sample(0, first, [0], 1), sample(100, second, [1], 2)];
  for (let tick = 200; tick <= 20_000; tick += 100) samples.push(sample(tick, second, [], 2));
  return {
    seed,
    rules: structuredClone(rules),
    sourceHash: "71b8cc9cd77651026430eac3913f9b0ad8ceafa4532c4bfa8703214ebccffed0",
    ticks: 20_000,
    captureEvery: 25,
    fps: 20,
    replay3000: true,
    notices: seed === 1103 ? [
      { tick: 640, text: "Hunter disappeared (census). No automatic rescue." },
      { tick: 1740, text: "Jade disappeared (census). No automatic rescue." },
    ] : [],
    samples,
  };
}

function validate(raw: unknown, expectedSeed = 1101) {
  return spawnSync("python3", [checker, "--validate-raw", "--expected-seed", String(expectedSeed),
    "--horizon", "20000", "--cadence", "100"], {
    input: JSON.stringify(raw), encoding: "utf8",
  });
}

function mockedProbe(stream: Record<string, unknown>, found = true) {
  const python = `
import importlib.util, json, sys
from pathlib import Path
from types import SimpleNamespace
spec = importlib.util.spec_from_file_location("archive_checker", sys.argv[1])
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
checker.shutil.which = lambda _: "ffprobe" if sys.argv[3] == "found" else None
checker.subprocess.run = lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=json.dumps({"streams": [json.loads(sys.argv[2])]}), stderr="")
try:
    print(json.dumps(checker.ffprobe(Path("fixture.mp4"), expected_dimensions=(192, 192))))
except checker.VerificationError as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
`;
  return spawnSync("python3", ["-B", "-c", python, resolve(checker), JSON.stringify(stream), found ? "found" : "missing"], {
    encoding: "utf8",
  });
}

const validProbe = {
  codec_type: "video", codec_name: "h264", width: 192, height: 192, pix_fmt: "yuv420p",
  r_frame_rate: "20/1", nb_frames: "801", start_time: "0.000000", duration: "40.050000",
};

describe("ecosystem archive raw history checker", () => {
  it("accepts a valid sampled history and reaggregates its counters", () => {
    const result = validate(fixture());
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      seed: 1101,
      finalCounts: [2, 0, 0, 0, 0],
      late15000To20000: { births: 5000, deaths: 5000, mutations: 5000 },
    });
  });

  it("rejects a seed mismatch", () => {
    const result = validate(fixture(), 1102);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected seed 1102");
  });

  it("rejects a missing census cadence point", () => {
    const raw = fixture();
    raw.samples[1].tick = 75;
    const result = validate(raw);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sample 1 is not at 100");
  });

  it("rejects bin totals that do not reproduce family counts", () => {
    const raw = fixture();
    raw.samples[1].bins[0] = 0;
    const result = validate(raw);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("family bin sums differ from counts");
  });

  it("rejects incorrect newly observed trait discovery", () => {
    const raw = fixture();
    raw.samples[1].newlySeen = [];
    const result = validate(raw);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("newlySeen does not match");
  });

  it("rejects an unexpected rules schema", () => {
    const raw = fixture();
    raw.rules.version = 3;
    const result = validate(raw);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("rules differ from staged v4");
  });

  it("rejects a history whose model provenance hash is wrong", () => {
    const raw = fixture();
    raw.sourceHash = "0".repeat(64);
    const result = validate(raw);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sourceHash mismatch");
  });

  it("checks file hashes and rejects changed committed bytes", () => {
    const directory = mkdtempSync(join(tmpdir(), "ecosystem-archive-hash-"));
    const file = join(directory, "raw.json");
    try {
      writeFileSync(file, "original bytes");
      const expected = createHash("sha256").update("original bytes").digest("hex");
      const good = spawnSync("python3", [checker, "--check-hash", file, "--expected-hash", expected], {
        encoding: "utf8",
      });
      expect(good.status).toBe(0);
      const bad = spawnSync("python3", [checker, "--check-hash", file, "--expected-hash", "0".repeat(64)], {
        encoding: "utf8",
      });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("SHA-256 mismatch");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a mismatched reaggregated summary", () => {
    const result = spawnSync("python3", [checker, "--compare-summary"], {
      input: JSON.stringify({ actual: { counts: [1, 2], late: 3 }, expected: { counts: [1, 2], late: 4 } }),
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("summary.late: numeric value differs");
  });

  it("requires seed 1103's two historical family-loss notices", () => {
    const raw = fixture(1103);
    const result = validate(raw, 1103);
    expect(result.status).toBe(0);
    raw.notices = raw.notices.filter((notice) => notice.tick !== 640);
    const missingLoss = validate(raw, 1103);
    expect(missingLoss.status).toBe(1);
    expect(missingLoss.stderr).toContain("source loss notice for Hunter at tick 640 is missing");
  });

  it("reports the ffprobe prerequisite when ffprobe is missing", () => {
    const result = mockedProbe(validProbe, false);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ffprobe is required for media verification");
  });

  it.each([
    [{ ...validProbe, width: 576 }, "expected 192x192 video"],
    [{ ...validProbe, nb_frames: "800" }, "expected exactly 801 frames"],
    [{ ...validProbe, duration: "40.000000" }, "expected 40.05 seconds"],
    [{ ...validProbe, pix_fmt: "yuv444p" }, "expected yuv420p pixel format"],
  ])("rejects an invalid media probe", (stream, message) => {
    const result = mockedProbe(stream);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });
});
