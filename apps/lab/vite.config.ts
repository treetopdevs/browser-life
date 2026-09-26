import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@bl/schema": r("../../packages/schema/src/index.ts"),
      "@bl/sim-ref": r("../../packages/sim-ref/src/index.ts"),
      "@bl/sim-gpu": r("../../packages/sim-gpu/src/index.ts"),
      "@bl/metrics": r("../../packages/metrics/src/index.ts"),
      "@bl/runner": r("../../packages/runner/src/index.ts"),
      "@bl/search": r("../../packages/search/src/index.ts"),
    },
  },
  server: { port: 5173, strictPort: true },
  worker: { format: "es" },
  build: {
    target: "es2023",
    rollupOptions: { input: { main: r("./index.html"), selftest: r("./selftest.html"), island: r("./island.html") } },
  },
});
