import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@bl/schema": r("./packages/schema/src/index.ts"),
      "@bl/sim-ref": r("./packages/sim-ref/src/index.ts"),
      "@bl/sim-gpu": r("./packages/sim-gpu/src/index.ts"),
      "@bl/metrics": r("./packages/metrics/src/index.ts"),
      "@bl/runner": r("./packages/runner/src/index.ts"),
      "@bl/search": r("./packages/search/src/index.ts"),
    },
  },
  test: {
    include: ["apps/lab/test/**/*.test.ts", "packages/*/test/**/*.test.ts", "experiments/test/**/*.test.ts", "tools/test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
