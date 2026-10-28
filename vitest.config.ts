import { configDefaults, defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The food-schedule-769 replays are kept out of git (docs/creative-prototypes/ARTIFACTS.md). Its test file is
// excluded rather than guarded while they are missing: the published replay pins this file's hash.
const schedule769Replays = existsSync(r("./docs/creative-prototypes/food-floor-longevity-replication-seed-1202.json"));

export default defineConfig({
  resolve: {
    alias: {
      "@bl/schema": r("./packages/schema/src/index.ts"),
      "@bl/sim-ref": r("./packages/sim-ref/src/index.ts"),
      "@bl/sim-gpu": r("./packages/sim-gpu/src/index.ts"),
      "@bl/metrics": r("./packages/metrics/src/index.ts"),
      "@bl/runner": r("./packages/runner/src/index.ts"),
      "@bl/search": r("./packages/search/src/index.ts"),
      "@bl/lineage": r("./packages/lineage/src/index.ts"),
    },
  },
  test: {
    include: ["apps/lab/test/**/*.test.ts", "packages/*/test/**/*.test.ts", "experiments/test/**/*.test.ts", "tools/test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...(schedule769Replays ? [] : ["tools/test/food-schedule-769.test.ts"])],
    testTimeout: 60_000,
  },
});
