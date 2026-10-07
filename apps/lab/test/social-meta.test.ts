// Every public page must preview well when shared and read well in search: a title and description of a length
// search engines and link unfurlers show whole, a canonical link on cadence.garden that the sitemap lists, Open
// Graph and Twitter card tags derived from those (apps/lab/src/social-meta.ts), and a social card and icons that exist.
import { describe, expect, it } from "vitest";
import { SITE, pageMeta, withSocialMeta } from "../src/social-meta.ts";
import cardDataUrl from "../public/social-card.jpg?inline";
import caddyfile from "../../../deploy/Caddyfile?raw";

const sources = import.meta.glob<string>(["../*.html", "../*/index.html", "../public/*.{xml,txt,webmanifest}"],
  { query: "?raw", import: "default", eager: true });
const publicFiles = Object.keys(import.meta.glob("../public/*", { query: "?url", eager: true })).map((k) => k.slice("../public".length));
const read = (p: string) => {
  const text = sources[`../${p}`];
  if (text === undefined) throw new Error(`no source ${p}`);
  return text;
};
const PUBLIC = ["index.html", "lab/index.html", "worlds/index.html", "how-it-works/index.html", "research/index.html",
  "about/index.html", "participate/index.html", "status/index.html", "privacy/index.html"];
const UNSHARED = ["selftest.html", "island.html", "discovery/index.html"];
const sitemap = [...read("public/sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const content = (html: string, key: string) =>
  new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html.replace(/<!--[\s\S]*?-->/g, ""))?.[1];

/** Width and height from a baseline or progressive JPEG's start-of-frame marker. */
function jpegSize(buf: Uint8Array): { width: number; height: number } {
  const u16 = (i: number) => (buf[i] << 8) | buf[i + 1];
  for (let i = 2; i < buf.length;) {
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xc2) return { height: u16(i + 5), width: u16(i + 7) };
    i += 2 + u16(i + 2);
  }
  throw new Error("no SOF marker");
}

describe("public pages", () => {
  for (const page of PUBLIC) {
    it(`${page} says what it is, once, and previews when shared`, () => {
      const source = read(page);
      const meta = pageMeta(source);
      expect(meta, "canonical link").not.toBeNull();
      const { title, description, canonical } = meta!;
      const path = page === "index.html" ? "/" : `/${page.replace(/index\.html$/, "")}`;
      expect(canonical).toBe(`${SITE.origin}${path}`);
      expect(sitemap).toContain(canonical);
      expect(title.length, title).toBeLessThanOrEqual(70);
      expect(title).toMatch(/Cadence Garden/);
      expect(description.length, description).toBeGreaterThanOrEqual(70);
      expect(description.length, description).toBeLessThanOrEqual(160);

      const html = withSocialMeta(source);
      expect(content(html, "og:url")).toBe(canonical);
      expect(content(html, "og:title")).toBe(title);
      expect(content(html, "og:description")).toBe(description);
      expect(content(html, "og:image")).toBe(`${SITE.origin}${SITE.card.path}`);
      expect(content(html, "twitter:card")).toBe("summary_large_image");
      expect(content(html, "twitter:image")).toBe(content(html, "og:image"));
      expect(html).toMatch(/<link rel="manifest" href="\/site\.webmanifest" \/>/);
      expect(withSocialMeta(html), "idempotent").toBe(html);
      expect(html.indexOf("og:url"), "inside <head>").toBeLessThan(html.indexOf("</head>"));
    });
  }

  it("the site names artificial life where search and previews look", () => {
    const home = read("index.html");
    expect(pageMeta(home)!.title).toMatch(/artificial life/i);
    expect(pageMeta(home)!.description).toMatch(/artificial life/i);
    expect(home).toMatch(/<p class="eyebrow">[^<]*artificial life/i);
  });

  it("structured data is valid JSON and names the lab", () => {
    for (const page of ["index.html", "lab/index.html"]) {
      const blocks = [...read(page).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(blocks.length, page).toBe(1);
      const data = JSON.parse(blocks[0][1]);
      const app = data["@graph"].find((n: { "@type": string }) => n["@type"] === "WebApplication");
      expect(app.url).toBe(`${SITE.origin}/lab/`);
      expect(app.image).toBe(`${SITE.origin}${SITE.card.path}`);
    }
  });

  it("pages that are not shared stay out of search and the sitemap", () => {
    for (const page of UNSHARED) {
      const source = read(page);
      expect(pageMeta(source), page).toBeNull();
      expect(withSocialMeta(source)).toBe(source);
    }
    for (const loc of sitemap) {
      const path = new URL(loc).pathname;
      expect(PUBLIC, loc).toContain(path === "/" ? "index.html" : `${path.slice(1)}index.html`);
    }
  });
});

describe("deriving the tags", () => {
  const page = (head: string) => `<!doctype html>\n<html lang="en">\n  <head>\n${head}\n  </head>\n  <body></body>\n</html>\n`;
  const base = `    <title>Half &frac12; a jar &amp; more · Cadence Garden</title>`;

  it("reads attributes in any order and quoting, and ignores comments", () => {
    const html = withSocialMeta(page([
      base,
      `    <!-- <meta property="og:title" content="old"> -->`,
      `    <link href='https://cadence.garden/x/' rel=canonical>`,
      `    <meta content="Say &quot;hi&quot; to x²" name="description">`,
    ].join("\n")).replace("<head>", `<head data-x="1">`));
    expect(content(html, "og:url")).toBe("https://cadence.garden/x/");
    expect(content(html, "og:title")).toBe("Half &frac12; a jar &amp; more · Cadence Garden");
    expect(content(html, "og:description")).toBe("Say &quot;hi&quot; to x²");
    expect(html.match(/property="og:title"/g)).toHaveLength(2); // the comment and the real one
  });

  it("keeps a page's own image and does not mix the shared card's tags into it", () => {
    const html = withSocialMeta(page([base,
      `    <link rel="canonical" href="https://cadence.garden/x/" />`,
      `    <meta name="description" content="Something." />`,
      `    <meta property="og:image" content="https://cadence.garden/x.png" />`].join("\n")));
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html).not.toMatch(/og:image:width|twitter:image/);
    expect(content(html, "og:title")).toBeDefined();
  });

  it("refuses a shared page without a description, or a canonical link off the site", () => {
    expect(() => pageMeta(page(`${base}\n    <link rel="canonical" href="https://cadence.garden/x/" />`))).toThrow(/description/);
    expect(() => pageMeta(page(`${base}\n    <link rel="canonical" href="https://example.com/" />\n    <meta name="description" content="x" />`)))
      .toThrow(/absolute/);
  });
});

describe("serving", () => {
  it("Caddy sends each page's bare path to its canonical address, with a written-out target", () => {
    for (const p of PUBLIC.filter((p) => p !== "index.html")) {
      const dir = p.replace(/\/index\.html$/, "");
      expect(caddyfile, dir).toContain(`redir /${dir} /${dir}/{?query} 308`);
    }
    expect(caddyfile).not.toMatch(/redir\s+\S+\s+\{path\}/);
  });
});

describe("social card and icons", () => {
  it("the card is a 1200 by 630 JPEG small enough for every unfurler", () => {
    expect(cardDataUrl.startsWith(`data:${SITE.card.type};base64,`)).toBe(true);
    const bytes = Uint8Array.from(atob(cardDataUrl.slice(cardDataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0));
    expect(jpegSize(bytes)).toEqual({ width: SITE.card.width, height: SITE.card.height });
    // WhatsApp drops previews over roughly 300 KB.
    expect(bytes.length).toBeLessThan(300_000);
  });

  it("the manifest's icons and the touch icon exist", () => {
    const manifest = JSON.parse(read("public/site.webmanifest"));
    for (const icon of manifest.icons) expect(publicFiles, icon.src).toContain(icon.src);
    expect(publicFiles).toContain("/apple-touch-icon.png");
    expect(publicFiles).toContain(SITE.card.path);
    expect(read("public/robots.txt")).toMatch(/^Sitemap: https:\/\/cadence\.garden\/sitemap\.xml$/m);
  });
});
