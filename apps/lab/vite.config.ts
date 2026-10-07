import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { withSocialMeta } from "./src/social-meta.ts";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// Not PORT: hosts that launch Vite (preview tools, PaaS) set PORT to Vite's own
// port, which would make /api proxy to itself. bin/dev sets COORDINATOR_PORT.
const coordinatorUrl = `http://localhost:${process.env.COORDINATOR_PORT ?? "4000"}`;

export default defineConfig({
  // Open Graph, Twitter card and icon tags, derived from each page's own title, description and canonical link.
  plugins: [{ name: "social-meta", transformIndexHtml: withSocialMeta }],
  resolve: {
    alias: {
      "@bl/schema": r("../../packages/schema/src/index.ts"),
      "@bl/sim-ref": r("../../packages/sim-ref/src/index.ts"),
      "@bl/sim-gpu": r("../../packages/sim-gpu/src/index.ts"),
      "@bl/metrics": r("../../packages/metrics/src/index.ts"),
      "@bl/runner": r("../../packages/runner/src/index.ts"),
      "@bl/search": r("../../packages/search/src/index.ts"),
      "@bl/lineage": r("../../packages/lineage/src/index.ts"),
    },
  },
  server: { port: 5173, strictPort: true, proxy: { "/api": coordinatorUrl } },
  preview: { proxy: { "/api": coordinatorUrl } },
  worker: { format: "es" },
  build: {
    target: "es2023",
    rollupOptions: { input: {
      home: r("./index.html"),
      lab: r("./lab/index.html"),
      worlds: r("./worlds/index.html"),
      howItWorks: r("./how-it-works/index.html"),
      research: r("./research/index.html"),
      about: r("./about/index.html"),
      privacy: r("./privacy/index.html"),
      participate: r("./participate/index.html"),
      status: r("./status/index.html"),
      selftest: r("./selftest.html"),
      island: r("./island.html"),
    } },
  },
});
