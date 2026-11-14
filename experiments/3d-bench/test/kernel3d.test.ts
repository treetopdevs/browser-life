// Not matched by vitest.config.ts include globs (throwaway); bench.ts runs the same asserts at startup.
import { describe, expect, it } from "vitest";
import { buildKernel } from "@bl/schema";
import { assertKernels, buildKernel3 } from "../kernel3d.ts";

describe("buildKernel3", () => {
  it("has the documented tap counts", () => {
    expect([3, 4, 5].map((r) => buildKernel3(r).count)).toEqual([92, 250, 460]);
  });
  it("reduces to buildKernel at dz = 0 and passes the startup asserts", () => {
    expect(() => assertKernels(buildKernel)).not.toThrow();
  });
});
