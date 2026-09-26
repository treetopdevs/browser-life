import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRIMARY_ENDPOINTS } from "../endpoints.ts";
import { applyGeneratedSection, MARK_END, MARK_START, planGeneration } from "../../tools/gen-prereg.ts";

const path = fileURLToPath(new URL("../preregistration.md", import.meta.url));
const doc = readFileSync(path, "utf8");

// Node-side counterpart of tests/deno/prereg-sync.ts: fails the same way,
// under `pnpm test`, if experiments/preregistration.md's generated section
// no longer matches what tools/gen-prereg.ts would produce from
// experiments/endpoints.ts.
describe("experiments/preregistration.md staleness", () => {
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

// Review 1 finding #4: the freeze check used to compare the doc's *current*
// whole-file hash against experiments/FROZEN, so it stopped protecting the
// generated section the moment a dated amendment (which the freeze policy
// itself requires appending, and which necessarily changes the whole-file
// hash) was added -- silently un-freezing the very next `gen-prereg` run.
describe("gen-prereg's freeze policy (planGeneration)", () => {
  const stale = doc.replace(MARK_START, `${MARK_START}\nstale line`);

  it("writes in place when nothing has ever been frozen", () => {
    const plan = planGeneration(stale, PRIMARY_ENDPOINTS, []);
    expect(plan.action).toBe("write");
  });

  it("is a no-op, not a refusal, when the generated section already matches", () => {
    const plan = planGeneration(doc, PRIMARY_ENDPOINTS, ["deadbeef"]);
    expect(plan.action).toBe("noop");
  });

  it("refuses to overwrite once any hash has ever been frozen, even one that doesn't match the current (post-amendment) doc", () => {
    // The recorded hash is deliberately *not* `stale`'s own hash: an
    // amendment appended after the original freeze changes the whole-file
    // hash, so the hash on record will almost never match the doc verbatim
    // again -- that must not un-freeze the generator.
    const plan = planGeneration(stale, PRIMARY_ENDPOINTS, ["hash-of-the-originally-frozen-text"]);
    expect(plan.action).toBe("refuse");
  });
});
