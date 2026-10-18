/// <reference types="node" />
// (node:fs for the build check below; the reference brings @types/node globals into the whole tsc program.)
// Release checks for the public routes (docs/release-checks-2026-10-18.md, section 4): every page the sitemap lists
// exists, answers 200, names itself with a canonical link and og:url equal to its <loc>, and is not noindex; robots.txt
// allows crawling and names the sitemap; the diagnostic pages are noindex and unlisted. The first tests ask the dev
// server (Playwright's webServer); the last reads the production build in apps/lab/dist, so run `pnpm build` first.
// Without a build that test fails (set BL_SKIP_BUILD_CHECK=1 to skip it, saying so), and a build whose robots.txt or
// sitemap.xml differs from apps/lab/public fails as stale. The release check is
// `pnpm build && npx playwright test tests/e2e/public-routes.spec.ts --project=chrome`.
// Source-level checks of the same tags: apps/lab/test/social-meta.test.ts.
import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = "https://cadence.garden";
const DIST = fileURLToPath(new URL("../../apps/lab/dist/", import.meta.url));
const PUBLIC = fileURLToPath(new URL("../../apps/lab/public/", import.meta.url));
const DIAGNOSTIC = ["/selftest.html", "/island.html"];

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const withoutComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");
const tags = (html: string, name: string) =>
  [...withoutComments(html).matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => {
    const attrs = new Map<string, string>();
    for (const a of m[0].matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) attrs.set(a[1].toLowerCase(), a[2]);
    return attrs;
  });
const canonicals = (html: string) =>
  tags(html, "link").filter((t) => t.get("rel")?.toLowerCase() === "canonical").map((t) => t.get("href"));
const metas = (html: string, key: string) =>
  tags(html, "meta").filter((t) => (t.get("property") ?? t.get("name")) === key).map((t) => t.get("content"));
const noindex = (html: string) => metas(html, "robots").some((c) => /noindex/i.test(c ?? ""));

/** One canonical link and one og:url, both equal to `url`, and no noindex. */
function expectNamed(html: string, url: string, where: string) {
  expect(canonicals(html), `${where}: canonical`).toEqual([url]);
  expect(metas(html, "og:url"), `${where}: og:url`).toEqual([url]);
  expect(noindex(html), `${where}: noindex`).toBe(false);
}

test("robots.txt allows crawling and names the sitemap", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  const robots = await res.text();
  expect(robots).toMatch(/^User-agent: \*$/m);
  expect(robots).toMatch(/^Allow: \/$/m);
  expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
  expect(robots).toMatch(new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, "m"));
});

test("every sitemap route answers 200 with canonical and og:url equal to its loc, and is not noindex", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  const listed = locs(await res.text());
  expect(listed.length).toBeGreaterThanOrEqual(9);
  expect(listed).toContain(`${ORIGIN}/`);
  for (const loc of listed) {
    expect(loc.startsWith(`${ORIGIN}/`), loc).toBe(true);
    const path = new URL(loc).pathname;
    expect(path.endsWith("/"), `${loc}: one address per page, with its trailing slash`).toBe(true);
    const page = await request.get(path);
    expect(page.status(), path).toBe(200);
    expectNamed(await page.text(), loc, path);
  }
});

test("diagnostic pages are noindex and not in the sitemap", async ({ request }) => {
  const listed = locs(await (await request.get("/sitemap.xml")).text());
  for (const path of DIAGNOSTIC) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    const html = await res.text();
    expect(noindex(html), `${path}: noindex`).toBe(true);
    expect(canonicals(html), `${path}: no canonical`).toEqual([]);
    expect(listed.some((loc) => new URL(loc).pathname === path), `${path} listed`).toBe(false);
  }
});

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith(".html") ? [path] : [];
  });
}

test("the build ships robots, sitemap and every listed route with matching canonical and og:url, and every built canonical is in the sitemap", () => {
  const built = existsSync(join(DIST, "index.html"));
  test.skip(!built && process.env.BL_SKIP_BUILD_CHECK === "1", "no production build in apps/lab/dist (BL_SKIP_BUILD_CHECK=1)");
  expect(built, "no production build in apps/lab/dist: run pnpm build first (or set BL_SKIP_BUILD_CHECK=1)").toBe(true);
  // A build older than the public files it should carry is stale, not evidence.
  for (const file of ["robots.txt", "sitemap.xml"])
    expect(readFileSync(join(DIST, file), "utf8"), `dist/${file} matches apps/lab/public (rebuild if not)`).toBe(
      readFileSync(join(PUBLIC, file), "utf8"),
    );

  const robots = readFileSync(join(DIST, "robots.txt"), "utf8");
  expect(robots).toMatch(new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, "m"));
  expect(robots).toMatch(/^Allow: \/$/m);
  const sitemap = readFileSync(join(DIST, "sitemap.xml"), "utf8");
  const listed = locs(sitemap);
  expect(listed.length).toBeGreaterThanOrEqual(9);

  for (const loc of listed) {
    const file = join(DIST, new URL(loc).pathname, "index.html");
    expect(existsSync(file), `${loc}: built page ${relative(DIST, file)}`).toBe(true);
    expectNamed(readFileSync(file, "utf8"), loc, relative(DIST, file));
  }

  const all = htmlFiles(DIST).map((f) => relative(DIST, f).split("\\").join("/"));
  const worldCopies = all.filter((f) => /^(lab|worlds)\/world\/[a-z0-9-]+\/index\.html$/.test(f));
  expect(worldCopies.length, "a copy of the lab and Worlds pages per world").toBeGreaterThan(0);
  for (const file of all) {
    const html = readFileSync(join(DIST, file), "utf8");
    const named = canonicals(html);
    if (named.length === 0) {
      // Unshared pages say so.
      expect(noindex(html), `${file} has no canonical link and is not noindex`).toBe(true);
      continue;
    }
    expect(named.length, `${file}: one canonical`).toBe(1);
    expect(listed, `${file}: canonical ${named[0]} is in the sitemap`).toContain(named[0]);
    const world = /^(lab|worlds)\/world\/([a-z0-9-]+)\/index\.html$/.exec(file);
    if (world) {
      // A world's copy keeps its page's canonical and previews as the link that names the world (deploy/Caddyfile).
      expect(named[0], file).toBe(`${ORIGIN}/${world[1]}/`);
      expect(metas(html, "og:url"), file).toEqual([`${ORIGIN}/${world[1]}/?world=${world[2]}`]);
      expect(noindex(html), file).toBe(false);
    } else {
      expect(metas(html, "og:url"), `${file}: og:url`).toEqual(named);
    }
  }
  for (const path of DIAGNOSTIC) {
    const html = readFileSync(join(DIST, path), "utf8");
    expect(noindex(html), `${path}: noindex`).toBe(true);
  }
});
