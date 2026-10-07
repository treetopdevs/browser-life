import { defineConfig, runnerImport } from "vite";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withSocialMeta, worldPage, worldPagePath, type WorldCard } from "./src/social-meta.ts";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// Not PORT: hosts that launch Vite (preview tools, PaaS) set PORT to Vite's own
// port, which would make /api proxy to itself. bin/dev sets COORDINATOR_PORT.
const coordinatorUrl = `http://localhost:${process.env.COORDINATOR_PORT ?? "4000"}`;

const alias = {
  "@bl/schema": r("../../packages/schema/src/index.ts"),
  "@bl/sim-ref": r("../../packages/sim-ref/src/index.ts"),
  "@bl/sim-gpu": r("../../packages/sim-gpu/src/index.ts"),
  "@bl/metrics": r("../../packages/metrics/src/index.ts"),
  "@bl/runner": r("../../packages/runner/src/index.ts"),
  "@bl/search": r("../../packages/search/src/index.ts"),
  "@bl/lineage": r("../../packages/lineage/src/index.ts"),
};

export default defineConfig({
  // Open Graph, Twitter card and icon tags, derived from each page's own title, description and canonical link.
  // A copy of the built lab page per world, with that world's card, for links that name it (deploy/Caddyfile).
  plugins: [{
    name: "social-meta",
    transformIndexHtml: withSocialMeta,
    async writeBundle(options) {
      const out = options.dir ?? r("./dist");
      const lab = readFileSync(join(out, "lab/index.html"), "utf8");
      const cards = JSON.parse(readFileSync(r("./public/og/worlds/manifest.json"), "utf8")) as Record<string, WorldCard>;
      // Stale cards would preview a world under its old name or question, or not at all: refuse to build from them.
      const { module } = await runnerImport<typeof import("./src/world-cards.ts")>(r("./src/world-cards.ts"), { configFile: false, root: r("."), resolve: { alias } });
      const drift = module.cardDrift(cards).concat(Object.values(cards).filter((c) => !existsSync(r(`./public${c.image}`))).map((c) => `${c.id}: no image at public${c.image}`));
      if (drift.length) throw new Error(`the world cards are stale; run pnpm gen:cards and look at them:\n  ${drift.join("\n  ")}`);
      for (const card of Object.values(cards)) {
        const file = join(out, worldPagePath(card.id));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, worldPage(lab, card));
      }
    },
  }],
  resolve: { alias },
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
