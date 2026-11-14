// The finished food-line experiments (docs/creative-prototypes, tools/food-*/explore.ts, tools/alternating-food*/explore.ts)
// record the SHA-256 of package.json and pnpm-lock.yaml and refuse their own recorded evidence when the bytes differ
// ("Pinned input changed: package.json", "dependency identity mismatch"). Their runners are themselves hash-pinned by the
// recorded runs, so the pins cannot be moved without rerunning the experiments. The replay files live outside git
// (docs/creative-prototypes/ARTIFACTS.md), so in a clean checkout those checks are skipped and a drift goes unseen:
// adding the `locality:check` script once broke eight of them that way. This test makes the drift visible everywhere.
//
// If it fails, package.json or pnpm-lock.yaml changed. Either keep the change out of those two files (run a tool by its
// command instead of adding a script, e.g. `deno run -A --no-lock tools/locality/matrix.ts --check`), or accept that the
// food-line replay checks stop passing and retire them deliberately, together with this test.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (rel: string): Buffer => readFileSync(`${REPO}${rel}`);
const pinned = (JSON.parse(read("docs/creative-prototypes/food-band-foothold-replication-inputs.json").toString("utf8")) as { sha256: Record<string, string> }).sha256;

describe("dependency files match the bytes the finished food experiments recorded", () => {
  for (const file of ["package.json", "pnpm-lock.yaml"]) {
    it(`${file} has the recorded SHA-256`, () => {
      expect(pinned[file]).toMatch(/^[0-9a-f]{64}$/);
      expect(createHash("sha256").update(read(file)).digest("hex"), `${file} differs from the bytes the food-line experiments pinned; see the comment at the top of this file`).toBe(pinned[file]);
    });
  }
});
