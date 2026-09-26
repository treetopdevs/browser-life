import { describe, expect, it } from "vitest";
import { compressionRatio } from "@bl/metrics";

// A small, dependency-free xorshift32 generator: deterministic and stable
// across engines/runs, unlike Math.random.
function xorshift(seed: number, n: number): Uint8Array {
  let x = seed >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

describe("compressionRatio (fflate raw deflate, level 6)", () => {
  it("is 0 for empty input", () => {
    expect(compressionRatio(new Uint8Array(0))).toBe(0);
  });

  it("is synchronous and deterministic across repeated calls on the same bytes", () => {
    const bytes = xorshift(2024, 4096);
    const a = compressionRatio(bytes);
    const b = compressionRatio(bytes);
    expect(a).toBe(b);
  });

  // Pinned golden values: replacing the compressor or bumping its version
  // (fflate is pinned in packages/metrics/package.json and root deno.json)
  // must change these, which is exactly the point — METRICS_VERSION exists so
  // that change is never silently pooled with older runs.
  it("returns pinned ratios for fixed inputs", () => {
    const zeros = new Uint8Array(4096);
    expect(compressionRatio(zeros)).toBeCloseTo(0.0048828125, 12);

    const repeating = new Uint8Array(4096);
    for (let i = 0; i < repeating.length; i++) repeating[i] = i % 4;
    expect(compressionRatio(repeating)).toBeCloseTo(0.005859375, 12);

    const pseudoRandom = xorshift(12345, 4096);
    expect(compressionRatio(pseudoRandom)).toBeCloseTo(1.001220703125, 12);
  });
});
