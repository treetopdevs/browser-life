/// <reference types="node" />
// (node:http, node:child_process and node:fs below; the reference brings @types/node globals into the whole tsc program.)
// Release check for the not-found page under the production rules (docs/release-checks-2026-10-18.md, criterion 6).
// It runs the real deploy/Caddyfile over the production build in apps/lab/dist with a local Caddy, changed only in its
// listen address, its upstream (a stub Phoenix in this process) and its root, each substitution counted so a drift in
// the real file fails here rather than passing on a stale copy. Without a Caddy (CADDY, /opt/homebrew/bin/caddy or
// `caddy` on PATH) or a build it skips, saying why; BL_REQUIRE_BUILD_CHECK=1 makes either miss fail instead. Run it with
// `pnpm build && BL_REQUIRE_BUILD_CHECK=1 npx playwright test tests/e2e/public-not-found.spec.ts --project=chrome`.
// A build older than apps/lab/404.html or apps/lab/vite.config.ts counts as no build. The same file checks the not-found plugin in
// apps/lab/vite.config.ts under `vite preview` (needs the build) and the dev server (never skips), with request targets
// sent as written. Not claimed: the live host, and production's Caddy 2.10 itself (this checks whichever Caddy is
// installed).
import { expect, test, type APIRequestContext } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview, type PreviewServer } from "vite";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIST = join(ROOT, "apps/lab/dist");
const CADDYFILE = join(ROOT, "deploy/Caddyfile");
const ORIGIN = "https://cadence.garden";
const TITLE = "<title>Page not found · Cadence Garden</title>";

function findCaddy(): string | null {
  for (const candidate of [process.env.CADDY, "/opt/homebrew/bin/caddy"]) if (candidate && existsSync(candidate)) return candidate;
  try {
    return execFileSync("which", ["caddy"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

const CADDY = findCaddy();
const BUILT = existsSync(join(DIST, "404.html"));
// A build from before the last edit of the page or of the build config that lists it (its input, the not-found plugin)
// would pass the checks below on the old output. Other sources are not tracked; `pnpm build` first is the rule.
const BUILD_SOURCES = ["apps/lab/404.html", "apps/lab/vite.config.ts"];
const STALE = BUILT && BUILD_SOURCES.some((p) => statSync(join(DIST, "404.html")).mtimeMs < statSync(join(ROOT, p)).mtimeMs);
const REQUIRED = process.env.BL_REQUIRE_BUILD_CHECK === "1";
const NO_BUILD = !BUILT ? "no apps/lab/dist/404.html (run `pnpm build`)" : STALE ? `apps/lab/dist/404.html is older than ${BUILD_SOURCES.join(" or ")} (run \`pnpm build\`)` : "";
const MISSING = [!CADDY && "no caddy binary (set CADDY)", NO_BUILD].filter(Boolean).join("; ");
// Reporters do not all print a skip's reason, so say it on the console too.
if (MISSING && !REQUIRED) console.warn(`public-not-found: ${MISSING}, Caddy check SKIPPED${NO_BUILD ? ", vite preview check SKIPPED" : ""}`);
test.skip(({ browserName }) => browserName !== "chromium", "the not-found checks run once, in Chrome");

type Raw = { status: number; headers: IncomingHttpHeaders; body: string };
/** One request with its target sent as written: Playwright's request API and fetch resolve `/./` and `/x/../` first. */
function raw(base: string, path: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<Raw> {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: hostname, port, path, method: init.method ?? "GET", headers: { Accept: "text/html", ...init.headers } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** The page asked for by name, under spellings a static server resolves to it: never 200. */
const NAMED = [
  "/404.html", "/404%2ehtml", "//404.html", "/./404.html", "/%2e/404.html", "/x/../404.html", "/404.HTML", "/404.HtMl",
  // A query Vite's module loaders read is still the page when nothing asks for a module (dev's case-blind disk would
  // otherwise serve `/404.HTML?raw` from its static files with 200).
  "/404.HTML?raw", "/404.html?raw", "/404.html?url=x", "/404.html?direct", "/x/../404.HTML?raw",
];

const count = (text: string, part: string) => text.split(part).length - 1;

/** deploy/Caddyfile with only its listen address, upstream and root changed, and the admin endpoint off. */
function adapt(source: string, port: number, upstream: number): string {
  expect(count(source, ":80 {"), "deploy/Caddyfile has one `:80 {` site").toBe(1);
  expect(count(source, "coordinator:4000"), "deploy/Caddyfile proxies to coordinator:4000").toBeGreaterThanOrEqual(1);
  expect(count(source, "root * /srv"), "deploy/Caddyfile has one `root * /srv`").toBe(1);
  return "{\n  admin off\n  persist_config off\n}\n" + source
    .replace(":80 {", `http://127.0.0.1:${port} {`)
    .replaceAll("coordinator:4000", `127.0.0.1:${upstream}`)
    .replace("root * /srv", `root * ${JSON.stringify(DIST)}`);
}

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createNetServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address() as { port: number };
    s.close(() => resolve(port));
  });
});

/** Asserts the not-found page with 404. */
function expectPage(res: Raw, path: string): void {
  expect(res.status, path).toBe(404);
  expect(res.headers["content-type"], path).toMatch(/^text\/html/);
  expect(res.body, path).toContain(TITLE);
}

const get = (request: APIRequestContext, path: string) =>
  request.get(`${base}${path}`, { headers: { Accept: "text/html" }, maxRedirects: 0 });
const ogUrl = (html: string) => /<meta property="og:url" content="([^"]*)"/.exec(html)?.[1];

let base = "";

test.describe("Caddy", () => {
  test.skip(!!MISSING && !REQUIRED, `${MISSING} (BL_REQUIRE_BUILD_CHECK=1 makes this fail)`);

  let caddy: ChildProcess | undefined;
  let caddyLog = "";
  let stub: Server | undefined;
  const stubSeen: { url: string; proto: string | undefined }[] = [];

  test.beforeAll(async ({}, info) => {
    expect(CADDY, "a caddy binary (BL_REQUIRE_BUILD_CHECK=1)").toBeTruthy();
    expect(NO_BUILD, "a current build (BL_REQUIRE_BUILD_CHECK=1)").toBe("");
    // A stand-in for Phoenix: it answers every /api path, with its own 404 for paths that name no-such.
    stub = createServer((req, res) => {
      stubSeen.push({ url: req.url ?? "", proto: req.headers["x-forwarded-proto"] as string | undefined });
      const missing = (req.url ?? "").includes("no-such");
      res.writeHead(missing ? 404 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(missing ? { error: "stub: not found" } : { stub: req.url }));
    });
    await new Promise<void>((resolve) => stub!.listen(0, "127.0.0.1", resolve));
    const upstream = (stub.address() as { port: number }).port;
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;

    const dir = info.outputPath("caddy");
    mkdirSync(join(dir, "xdg"), { recursive: true });
    const config = join(dir, "Caddyfile");
    writeFileSync(config, adapt(readFileSync(CADDYFILE, "utf8"), port, upstream));
    caddy = spawn(CADDY!, ["run", "--adapter", "caddyfile", "--config", config], {
      env: { ...process.env, XDG_DATA_HOME: join(dir, "xdg"), XDG_CONFIG_HOME: join(dir, "xdg") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    caddy.stdout?.on("data", (d) => { caddyLog += d; });
    caddy.stderr?.on("data", (d) => { caddyLog += d; });
    process.once("exit", () => caddy?.kill());
    const deadline = Date.now() + 30_000;
    for (;;) {
      expect(caddy.exitCode, `caddy exited:\n${caddyLog}`).toBeNull();
      const up = await fetch(`${base}/robots.txt`).then((r) => r.ok, () => false);
      if (up) break;
      expect(Date.now() < deadline, `caddy did not answer within 30 s:\n${caddyLog}`).toBe(true);
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  test.afterAll(async () => {
    caddy?.kill();
    if (stub?.listening) {
      stub.closeAllConnections();
      await new Promise((resolve) => stub!.close(resolve));
    }
  });

  test("build: every URL in dist/404.html is absolute, so the page works at any depth", () => {
    const html = readFileSync(join(DIST, "404.html"), "utf8");
    const urls = [...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(5);
    expect(urls.filter((u) => !/^(\/|#|https:\/\/)/.test(u)), "relative URLs in dist/404.html").toEqual([]);
    expect(html).toContain(TITLE);
    expect(html).not.toContain('rel="canonical"');
  });

  test("Caddy: unknown site paths answer 404 with the page, never stored", async ({ request }) => {
    for (const path of ["/no-such-page/", "/no-such-page", "/a/b/c.html", "/lab/no-such-page/", "/assets/no-such.js", "/fonts/no-such.woff2", "/api", "/healthz/"]) {
      const res = await get(request, path);
      expect(res.status(), path).toBe(404);
      expect(res.headers()["content-type"], path).toMatch(/^text\/html/);
      // no-store, and no validators: a cache neither keeps the miss after the page is deployed nor revalidates it.
      expect(res.headers()["cache-control"], `${path}: a miss is never stored`).toBe("no-store");
      expect(res.headers().etag, `${path}: no ETag`).toBeUndefined();
      expect(res.headers()["last-modified"], `${path}: no Last-Modified`).toBeUndefined();
      const html = await res.text();
      expect(html, path).toContain(TITLE);
      expect(html, path).toMatch(/<meta name="robots" content="noindex"/);
      expect(html, path).not.toContain('rel="canonical"');
      expect(ogUrl(html), path).toBeUndefined();
    }
    const head = await request.fetch(`${base}/no-such-page/`, { method: "HEAD", maxRedirects: 0 });
    expect(head.status(), "HEAD /no-such-page/").toBe(404);
    // file_server sends a file asked for with a slash to its name, which answers 404 below: the page never answers 200.
    const slashed = await get(request, "/404.html/");
    expect(slashed.status(), "/404.html/").toBe(308);
    expect(slashed.headers().location, "/404.html/").toBe("/404.html");
  });

  test("Caddy: the page asked for by name answers 404, under every spelling", async () => {
    for (const path of NAMED) expectPage(await raw(base, path), path);
  });

  test("Caddy: a conditional or ranged request still gets the whole page", async () => {
    const full = await raw(base, "/no-such-page/");
    expectPage(full, "plain");
    const conditions: Record<string, string>[] = [
      { "If-None-Match": "*" },
      { "If-Modified-Since": "Fri, 01 Jan 2100 00:00:00 GMT" },
      { "If-Match": '"no-such-etag"' },
      { "If-Unmodified-Since": "Thu, 01 Jan 1970 00:00:00 GMT" },
      { Range: "bytes=0-10" },
      { Range: "bytes=0-10", "If-Range": '"no-such-etag"' },
    ];
    for (const headers of conditions) {
      const res = await raw(base, "/no-such-page/", { headers });
      const label = JSON.stringify(headers);
      expectPage(res, label);
      expect(res.body.length, label).toBe(full.body.length);
      expect(res.headers["content-range"], label).toBeUndefined();
    }
  });

  test("Caddy: real pages, world copies, assets, robots and sitemap answer 200", async ({ request }) => {
    const sitemap = readFileSync(join(DIST, "sitemap.xml"), "utf8");
    const routes = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    expect(routes.length).toBeGreaterThanOrEqual(9);
    const asset = /\/assets\/[^"]+\.js/.exec(readFileSync(join(DIST, "index.html"), "utf8"))?.[0];
    expect(asset, "an /assets/ script in dist/index.html").toBeTruthy();
    for (const path of [...routes, "/island.html", "/selftest.html", "/robots.txt", "/sitemap.xml", "/site.webmanifest", "/favicon.svg", asset!]) {
      const res = await get(request, path);
      expect(res.status(), path).toBe(200);
      if (path.endsWith("/")) expect(await res.text(), path).not.toContain(TITLE);
    }
    expect((await get(request, asset!)).headers()["cache-control"], "a real asset keeps its year").toContain("immutable");

    const [world] = Object.keys(JSON.parse(readFileSync(join(ROOT, "apps/lab/public/og/worlds/manifest.json"), "utf8")));
    for (const page of ["lab", "worlds"]) {
      const res = await get(request, `/${page}/?world=${world}`);
      expect(res.status(), `/${page}/?world=${world}`).toBe(200);
      expect(ogUrl(await res.text()), `/${page}/?world=${world} is the world's copy`).toBe(`${ORIGIN}/${page}/?world=${world}`);
    }
    const plain = await get(request, "/lab/?world=no-such-world");
    expect(plain.status()).toBe(200);
    expect(ogUrl(await plain.text()), "an unknown world gets the plain lab").toBe(`${ORIGIN}/lab/`);

    for (const page of ["lab", "garden"]) {
      const bare = await get(request, `/${page}`);
      expect(bare.status(), `/${page}`).toBe(308);
      expect(bare.headers().location, `/${page}`).toBe(`/${page}/`);
    }
    const copy = await get(request, `/lab/world/${world}/`);
    expect(copy.status()).toBe(308);
    expect(copy.headers().location).toBe(`/lab/?world=${world}`);
  });

  test("Caddy: the page renders with its styles and script at depth", async ({ page }) => {
    await page.route(/plausible/, (route) => route.abort());
    const res = await page.goto(`${base}/a/b/no-such/`);
    expect(res?.status()).toBe(404);
    await expect(page.locator("main h1")).toHaveText("Nothing is growing here.");
    expect(await page.locator(".site-header").evaluate((el) => getComputedStyle(el).position), "site.css applied").toBe("sticky");
    await expect(page.locator(".theme-toggle"), "theme.ts ran").toBeVisible();
  });

  // Last: it stops the stub.
  test("Caddy: /api/* and /healthz reach Phoenix, never the page", async ({ request }) => {
    const status = await get(request, "/api/public/status");
    expect(status.status()).toBe(200);
    expect(await status.json()).toEqual({ stub: "/api/public/status" });
    const missing = await get(request, "/api/no-such");
    expect(missing.status(), "Phoenix's own 404 passes through").toBe(404);
    expect(await missing.json()).toEqual({ error: "stub: not found" });
    // Caddy's path matcher ignores case, so /API/... is Phoenix's too.
    const upper = await get(request, "/API/public/status");
    expect(upper.status(), "/API/public/status").toBe(200);
    expect(await upper.json()).toEqual({ stub: "/API/public/status" });

    stubSeen.length = 0;
    const health = await get(request, "/healthz");
    expect(health.status()).toBe(200);
    expect(stubSeen, "/healthz reaches Phoenix as /api/public/status").toEqual([{ url: "/api/public/status", proto: "https" }]);

    stub!.closeAllConnections();
    await new Promise((resolve) => stub!.close(resolve));
    for (const path of ["/api/public/status", "/api/no-such", "/healthz"]) {
      const down = await get(request, path);
      expect(down.status(), `${path} with Phoenix down`).toBe(502);
      expect(await down.text(), `${path} with Phoenix down is not the page`).not.toContain(TITLE);
    }
  });
});

/** The not-found plugin's rules, the same under `vite dev` and `vite preview` (apps/lab/vite.config.ts). */
async function expectViteRules(at: string): Promise<void> {
  for (const path of ["/no-such-page/", "/no-such-page", "/a/b/c.html", "/lab/no-such-page/", "/404.html/", ...NAMED]) expectPage(await raw(at, path), path);
  // Neither a path that would name another host nor one that climbs out of the root is redirected.
  for (const path of ["//example.com", "//example.com/", "/%2e%2e/apps", "/x/../lab"]) {
    const res = await raw(at, path);
    expectPage(res, path);
    expect(res.headers.location, path).toBeUndefined();
  }
  const bare = await raw(at, "/lab?x=1");
  expect(bare.status, "/lab?x=1").toBe(308);
  expect(bare.headers.location, "/lab?x=1").toBe("/lab/?x=1");
  for (const path of ["/about/", "/x/../about/", "/selftest.html"]) {
    const res = await raw(at, path);
    expect(res.status, path).toBe(200);
    expect(res.body, path).not.toContain(TITLE);
  }
  // Only what a browser asks for as a page gets the page: HEAD gets the status alone, JSON and POST Vite's empty 404.
  const head = await raw(at, "/no-such-page/", { method: "HEAD" });
  expect([head.status, head.body], "HEAD").toEqual([404, ""]);
  const json = await raw(at, "/no-such-page/", { headers: { Accept: "application/json" } });
  expect(json.status, "JSON").toBe(404);
  expect(json.body, "JSON").not.toContain(TITLE);
  const post = await raw(at, "/no-such-page/", { method: "POST" });
  expect(post.status, "POST").toBe(404);
  expect(post.body, "POST").not.toContain(TITLE);
}

test.describe("vite preview", () => {
  test.skip(!!NO_BUILD && !REQUIRED, `${NO_BUILD} (BL_REQUIRE_BUILD_CHECK=1 makes this fail)`);
  let server: PreviewServer | undefined;
  let at = "";

  test.beforeAll(async () => {
    expect(NO_BUILD, "a current build (BL_REQUIRE_BUILD_CHECK=1)").toBe("");
    const port = await freePort();
    server = await preview({ root: join(ROOT, "apps/lab"), logLevel: "silent", preview: { host: "127.0.0.1", port, strictPort: true, open: false } });
    at = `http://127.0.0.1:${port}`;
  });

  test.afterAll(async () => {
    await server?.close();
  });

  test("vite preview: unknown paths answer 404 with the page", async () => {
    await expectViteRules(at);
  });
});

test("vite dev: unknown paths answer 404 with the page", async ({}, info) => {
  const at = String(info.project.use.baseURL);
  await expectViteRules(at);
  // A module request for the page by name is Vite's to answer (an `import ... from "/404.html?raw"`), not the page.
  for (const path of ["/404.html?raw&import", "/404.html?url&import"]) {
    const res = await raw(at, path, { headers: { Accept: "*/*", "Sec-Fetch-Dest": "script" } });
    expect(res.status, path).toBe(200);
    expect(res.headers["content-type"], path).toMatch(/javascript/);
    expect(res.body, path).toContain("export default");
  }
  // A navigation is never a module request, whatever its query: Vite's transforms skip document fetches, so these get
  // the page too.
  for (const path of [...NAMED, "/404.html?raw&import", "/404.HTML?url&import", "/404.html?html-proxy&index=0.js"]) {
    expectPage(await raw(at, path, { headers: { "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate" } }), `${path} (navigation)`);
  }
});
