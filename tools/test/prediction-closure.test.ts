// The source-closure hash covers the transitive local imports of the harness, not a hand-picked list.
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { sourceClosure, sourceClosureHash } from "../lib/prediction/closure.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

describe("sourceClosure", () => {
  const files = sourceClosure(root, ["tools/predict.ts", "tools/lib/prediction/model-seam.ts"]);
  it("includes the executable dependencies the earlier hand-picked list missed", () => {
    for (const f of ["packages/schema/src/world.ts", "packages/schema/src/accounting.ts", "packages/schema/src/presets.ts", "packages/schema/src/genome.ts", "packages/schema/src/kernel.ts", "packages/sim-ref/src/step.ts", "packages/sim-ref/src/cells.ts", "tools/lib/report-html/page.ts", "tools/lib/prediction/closure.ts", "tools/lib/prediction/model-seam.ts", "tools/lib/propose.ts"]) expect(files, f).toContain(f);
  });
  it("is sorted, repo-relative and free of node_modules", () => {
    expect([...files].sort()).toEqual(files);
    for (const f of files) {
      expect(f.startsWith("/")).toBe(false);
      expect(f).not.toContain("node_modules");
    }
  });
});

describe("sourceClosureHash", () => {
  const h = sourceClosureHash(root, ["tools/predict.ts", "tools/lib/prediction/model-seam.ts"]);
  it("covers the resolver configuration and names the external specifiers", () => {
    expect(h.config).toEqual(expect.arrayContaining(["deno.json", "package.json"]));
    expect(h.externals).toContain("node:fs");
    expect(h.externals).toContain("fflate");
    expect(h.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is stable across calls", () => {
    expect(sourceClosureHash(root, ["tools/predict.ts", "tools/lib/prediction/model-seam.ts"]).sha256).toBe(h.sha256);
  });
});
