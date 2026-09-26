import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRIMARY_ENDPOINTS } from "../endpoints.ts";
import { applyGeneratedSection, MARK_END, MARK_START } from "../../tools/gen-prereg.ts";

// Node-side counterpart of tests/deno/prereg-sync.ts: fails the same way,
// under `pnpm test`, if experiments/preregistration.md's generated section
// no longer matches what tools/gen-prereg.ts would produce from
// experiments/endpoints.ts.
describe("experiments/preregistration.md staleness", () => {
  const path = fileURLToPath(new URL("../preregistration.md", import.meta.url));
  const doc = readFileSync(path, "utf8");

  it("has the GENERATED markers", () => {
    expect(doc).toContain(MARK_START);
    expect(doc).toContain(MARK_END);
  });

  it("generated endpoint section matches experiments/endpoints.ts", () => {
    expect(applyGeneratedSection(doc, PRIMARY_ENDPOINTS)).toBe(doc);
  });

  it("is caught when the doc drifts from the spec (sanity check on the check itself)", () => {
    const tampered = doc.replace(MARK_START, `${MARK_START}\nstale line`);
    expect(applyGeneratedSection(tampered, PRIMARY_ENDPOINTS)).not.toBe(tampered);
  });
});
