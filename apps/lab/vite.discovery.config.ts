// Builds the discovery worker page (apps/lab/discovery) into the coordinator's
// static directory, so the coordinator serves page and API from one origin:
//   pnpm build:discovery   ->   apps/coordinator/priv/static/discovery/
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { closureDigest } from "../../tools/lib/discovery-closure.ts";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r("./discovery"),
  base: "/discovery/",
  resolve: {
    alias: {
      "@bl/schema": r("../../packages/schema/src/index.ts"),
      "@bl/sim-ref": r("../../packages/sim-ref/src/index.ts"),
      "@bl/metrics": r("../../packages/metrics/src/index.ts"),
    },
  },
  define: { __BL_DISCOVERY_CLOSURE__: JSON.stringify(closureDigest(r("../..")).digest) },
  worker: { format: "es" },
  build: {
    target: "es2023",
    outDir: r("../coordinator/priv/static/discovery"),
    emptyOutDir: true,
    rollupOptions: { input: { discovery: r("./discovery/index.html") } },
  },
});
