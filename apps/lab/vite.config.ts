import { defineConfig, runnerImport, type Connect } from "vite";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { WORLD_LINK_PAGES, withSocialMeta, worldPage, worldPagePath, type WorldCard } from "./src/social-meta.ts";

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

/**
 * A request's path, decoded and normalised (`.` and `..` segments resolved, repeated slashes folded, never above the
 * root), its raw form, and its query; null when the path does not decode. Every check below reads the normalised path,
 * so `//404.html`, `/./404.html` or `/x/../404.html` are the not-found page by name too, and no existence check looks
 * outside the root.
 */
function splitUrl(url = "/"): { pathname: string; decoded: string; path: string; search: string } | null {
  const q = url.indexOf("?");
  const [pathname, search] = q < 0 ? [url, ""] : [url.slice(0, q), url.slice(q)];
  try {
    const decoded = decodeURIComponent(pathname);
    return { pathname, decoded, path: posix.normalize(posix.join("/", decoded)), search };
  } catch {
    return null;
  }
}

/**
 * The not-found page asked for by name (`/404.html`, `/404.html/`, `/404%2ehtml`, `/404.HTML`): it answers 404 too, as in
 * Caddy, whose path matcher ignores case. Case is ignored here as well, since a case-insensitive disk (macOS) would
 * otherwise serve `/404.HTML` with 200.
 */
const namesNotFound = (path: string) => path.replace(/\/+$/, "").toLowerCase() === "/404.html";

/** The queries Vite's module loaders read (`?raw`, `?url`, `?import`, `?html-proxy` and the like). */
const VITE_MODULE_QUERY = /[?&](?:import|raw|url|inline|html-proxy|worker|sharedworker|direct)(?:[=&]|$)/;
/** Fetch destinations Vite's transform middleware never answers (vite 8, middlewares/transform.ts). */
const DOCUMENT_DESTS = new Set(["document", "iframe", "frame", "fencedframe"]);

/**
 * A module request for an .html file, which Vite's transform middleware answers as JavaScript: a module query, from a
 * fetch that is not a document's, that Vite would transform (a script fetch, an `import` query or an `html-proxy` one,
 * the same tests its middleware makes). Anything else asking for the page by name is a navigation or a plain fetch,
 * which a static server would answer with the file and 200, so it gets the page.
 */
function viteModuleRequest(req: Connect.IncomingMessage, search: string): boolean {
  const dest = req.headers["sec-fetch-dest"];
  if (typeof dest === "string" && DOCUMENT_DESTS.has(dest)) return false;
  if (!VITE_MODULE_QUERY.test(search)) return false;
  return dest === "script" || /[?&]import=?(?:&|$)/.test(search) || /[?&]html-proxy\b/.test(search);
}

/**
 * An unknown page answers 404 with the site's own page, 404.html, as deploy/Caddyfile does in production. Runs after
 * Vite's mpa html fallback, which has already rewritten a known page to its .html file. Only requests Vite's fallback
 * would treat as a page (GET or HEAD, with an Accept that names text/html or *\/* or is absent) get the page; a fetch
 * asking for JSON keeps Vite's empty 404. A directory with an index.html asked for without its slash answers 308 to
 * the slash, keeping the query, which is what Caddy's `redir` lines do for the eight top-level pages. Known differences
 * from Caddy: dev sends any such directory to its slash (`/garden`, which Caddy serves at 200 without one, and dev-only
 * directories such as `/dist`); Vite also answers `/<name>` with `/<name>.html` when that file exists (`/selftest`);
 * dev has no `/<page>/world/<id>/` copies; a path that does not decode (`/%zz`) gets the page here, where Caddy
 * answers its own empty 400; and on a case-blind disk (macOS) a page asked for in another case is found (`/ABOUT/`
 * answers 200 in dev and preview, `/Lab/index.HTML` 200 in dev), where production's Linux disk answers 404, and `/About`
 * is sent to `/About/` where Caddy's case-blind `redir` sends it to `/about/`. Only the not-found page's own name is
 * matched without case here.
 */
function notFound(root: string, page: () => Promise<string>): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = splitUrl(req.url);
    const named = url !== null && namesNotFound(url.path);
    const accept = req.headers.accept;
    const asPage = (req.method === "GET" || req.method === "HEAD") && (accept === undefined || accept === "" || accept.includes("text/html") || accept.includes("*/*"));
    if (!named && !asPage) return next();
    if (url && !named && url.path.endsWith(".html") && existsSync(join(root, url.path))) return next();
    // Only a path that is already in normal form is redirected, to itself plus a slash: `//name` (another host) or a
    // path with dot segments gets the page instead.
    if (url && !named && url.decoded === url.path && !url.path.endsWith("/") && existsSync(join(root, url.path, "index.html"))) {
      res.writeHead(308, { Location: `${url.pathname}/${url.search}` }).end();
      return;
    }
    page().then((html) => {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : html);
    }, next);
  };
}

/**
 * The static servers would answer the not-found page asked for by name with 200, so those requests are taken first. In
 * dev, a module request for it (`import text from "/404.html?raw"`, which Vite sends as `?raw&import`) still goes on
 * to Vite's transforms, which answer it as JavaScript; a navigation or plain fetch with the same query does not, since
 * Vite would not transform it and its static files would serve `/404.HTML?raw` with 200 on a case-blind disk.
 * `vite preview` has no transforms, so there every request for it is taken.
 */
const namedNotFound = (handle: Connect.NextHandleFunction, { modules }: { modules: boolean }): Connect.NextHandleFunction => (req, res, next) => {
  const url = splitUrl(req.url);
  if (!url || !namesNotFound(url.path)) return next();
  return modules && viteModuleRequest(req, url.search) ? next() : handle(req, res, next);
};

export default defineConfig({
  // Open Graph, Twitter card and icon tags, derived from each page's own title, description and canonical link.
  // A copy of the built lab and Worlds pages per world, with that world's card, for links that name it (deploy/Caddyfile).
  plugins: [{
    name: "social-meta",
    transformIndexHtml: withSocialMeta,
    async writeBundle(options) {
      const out = options.dir ?? r("./dist");
      const cards = JSON.parse(readFileSync(r("./public/og/worlds/manifest.json"), "utf8")) as Record<string, WorldCard>;
      // Stale cards would preview a world under its old name or question, or not at all: refuse to build from them.
      const { module } = await runnerImport<typeof import("./src/world-cards.ts")>(r("./src/world-cards.ts"), { configFile: false, root: r("."), resolve: { alias } });
      const drift = module.cardDrift(cards).concat(Object.values(cards).filter((c) => !existsSync(r(`./public${c.image}`))).map((c) => `${c.id}: no image at public${c.image}`));
      if (drift.length) throw new Error(`the world cards are stale; run pnpm gen:cards and look at them:\n  ${drift.join("\n  ")}`);
      for (const page of WORLD_LINK_PAGES) {
        const html = readFileSync(join(out, `${page}/index.html`), "utf8");
        for (const card of Object.values(cards)) {
          const file = join(out, worldPagePath(card.id, page));
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, worldPage(html, card, page));
        }
      }
    },
  }, {
    name: "not-found",
    configureServer(server) {
      const handle = notFound(server.config.root, () => server.transformIndexHtml("/404.html", readFileSync(join(server.config.root, "404.html"), "utf8")));
      server.middlewares.use(namedNotFound(handle, { modules: true }));
      return () => server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      const dist = resolve(server.config.root, server.config.build.outDir);
      const handle = notFound(dist, async () => readFileSync(join(dist, "404.html"), "utf8"));
      server.middlewares.use(namedNotFound(handle, { modules: false }));
      return () => server.middlewares.use(handle);
    },
  }],
  // "mpa": an unknown path is not rewritten to the home page, so the not-found plugin above can answer it.
  appType: "mpa",
  resolve: { alias },
  server: { port: 5173, strictPort: true, proxy: { "/api": coordinatorUrl } },
  preview: { proxy: { "/api": coordinatorUrl } },
  worker: { format: "es" },
  build: {
    target: "es2023",
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes("/src/vision-screen/")) return "vision-screen-core";
      if (id.includes("/src/currents/model.ts")) return "currents-model";
      if (id.includes("/src/matter/model.ts")) return "matter-model";
      if (id.includes("/src/development/model.ts")) return "development-model";
      if (id.includes("/src/boundaries/model.ts")) return "boundaries-model";
      if (id.includes("/src/particles/motifs.ts") || id.includes("/src/particles/motif-observers.ts")) return "particles-motifs-model";
      if (id.includes("/src/particles/environment-page.ts")) return "particles-environment-page";
      if (id.includes("/src/particles/bonded-model.ts")) return "particles-bonded-model";
      if (id.includes("/src/particles/model.ts")) return "particles-model";
      if (id.includes("/src/particles/comparison-clock.ts")) return "particles-clock";
    } }, input: {
      home: r("./index.html"),
      lab: r("./lab/index.html"),
      worlds: r("./worlds/index.html"),
      howItWorks: r("./how-it-works/index.html"),
      research: r("./research/index.html"),
      about: r("./about/index.html"),
      privacy: r("./privacy/index.html"),
      participate: r("./participate/index.html"),
      status: r("./status/index.html"),
      garden: r("./garden/index.html"),
      particles: r("./particles/index.html"),
      particlePicker: r("./particles/picker/index.html"),
      particleOases: r("./particles/oases/index.html"),
      particleSeasons: r("./particles/seasons/index.html"),
      particleBonds: r("./particles/bonds/index.html"),
      particleMotifs: r("./particles/motifs/index.html"),
      boundaries: r("./boundaries/index.html"),
      development: r("./development/index.html"),
      matter: r("./matter/index.html"),
      currents: r("./currents/index.html"),
      visionScreen: r("./vision-screen/index.html"),
      selftest: r("./selftest.html"),
      island: r("./island.html"),
      notFound: r("./404.html"),
    } },
  },
});
