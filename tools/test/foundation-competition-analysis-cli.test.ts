import { describe, expect, it } from "vitest";
import { parseAnalysisArgs } from "../foundation-competition-analysis.ts";

describe("CPU-only competition analysis options", () => {
  it("requires one fixed plan and distinct batch paths", () => {
    expect(parseAnalysisArgs(["--plan", "/plan/manifest.json", "--batches", "/a.json,/b.json",
      "--out", "/new-analysis"])).toMatchObject({ plan: "/plan/manifest.json",
        batches: ["/a.json", "/b.json"], out: "/new-analysis" });
    expect(() => parseAnalysisArgs(["--plan", "/p", "--batches", "/a,/a", "--out", "/o"]))
      .toThrow(/distinct batch paths/);
    expect(() => parseAnalysisArgs(["--plan", "/p", "--batches", "/a", "--out", "/o",
      "--execute", "yes"])).toThrow(/invalid or duplicate option/);
  });
});
