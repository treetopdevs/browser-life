// Which public pages are standalone experiment pages: prototypes and result pages with their own single-theme shell,
// not the site's shared header and day/night colours. Read from the page sources, so a page that adopts the site shell
// moves to the full accessibility spec (public-a11y.spec.ts) without an edit here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lab = fileURLToPath(new URL("../../apps/lab/", import.meta.url));

/** Every page the sitemap lists, as paths. */
export function sitemapRoutes(): string[] {
  return [...readFileSync(`${lab}public/sitemap.xml`, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
}

/**
 * A page without the site header, other than the lab (which has its own full checks). The slab viewer wears the site
 * header but rebuilds its radio groups on every change, which the full spec's keyboard walk cannot follow, so it is
 * checked with the standalone pages until that is fixed.
 */
export function isStandalone(route: string): boolean {
  if (route === "/slab/") return true;
  if (route === "/" || route === "/lab/") return false;
  return !readFileSync(`${lab}${route.slice(1)}index.html`, "utf8").includes("site-header");
}
