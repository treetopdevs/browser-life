// Link previews and search metadata for the public pages. Each page states its title, description and canonical
// link once, in its own <head>; this derives the Open Graph and Twitter card tags, the shared social card and the
// app icons from them at build time (and in dev), so a shared link always says what the page says. Pages without a
// canonical link (the self-test, the island, the discovery worker) are left alone: they are noindex and not shared.

export const SITE = {
  origin: "https://cadence.garden",
  name: "Cadence Garden",
  /** The social card: a real capture of the Random soup world in a jar, beside the name and what it is. */
  card: {
    path: "/social-card.jpg",
    type: "image/jpeg",
    width: 1200,
    height: 630,
    alt: "Cadence Garden: artificial life in your browser. Green cells growing in clusters inside a sealed jar under a rising sun, captured from the lab.",
  },
};

/** Escapes a value for a double-quoted attribute. Values come from valid HTML, so entities stay as written. */
const attr = (s: string) => s.replace(/&(?!(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/"/g, "&quot;");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

type Tag = { name: string; attrs: Map<string, string> };

/** The <head>'s meta and link elements with their attributes, in any order or quoting; comments are skipped. */
function headTags(html: string): { head: string; tags: Tag[] } {
  const head = (/<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const tags: Tag[] = [];
  for (const [, name, body] of head.matchAll(/<(meta|link)\b([^>]*)>/gi)) tags.push({ name: name.toLowerCase(), attrs: attrsOf(body) });
  return { head, tags };
}

/** A tag's attributes, names lower-cased, values as written (double, single or no quotes). */
function attrsOf(body: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of body.matchAll(/([^\s"'=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

export interface CardImage { path: string; type: string; width: number; height: number; alt: string }
/** What a page says about itself; `url` (the address a preview links to) and `image` default to the canonical and the site card. */
export interface PageMeta { title: string; description: string; canonical: string; url?: string; image?: CardImage }

/** What the page says about itself, or null for a page that has no canonical link and so is not shared. */
export function pageMeta(html: string): PageMeta | null {
  const { head, tags } = headTags(html);
  const canonical = tags.find((t) => t.name === "link" && t.attrs.get("rel")?.toLowerCase() === "canonical")?.attrs.get("href");
  if (!canonical) return null;
  const title = squash(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? "");
  const description = squash(tags.find((t) => t.name === "meta" && t.attrs.get("name")?.toLowerCase() === "description")?.attrs.get("content") ?? "");
  if (!title || !description) throw new Error(`${canonical}: a page with a canonical link needs a <title> and a meta description`);
  if (!canonical.startsWith(`${SITE.origin}/`)) throw new Error(`${canonical}: canonical links are absolute on ${SITE.origin}`);
  return { title, description, canonical };
}

/** The tags a shared page's <head> should carry, keyed by the property, name or rel that identifies each. */
export function socialTags(meta: PageMeta): { key: string; html: string; card?: true }[] {
  const card = meta.image ?? SITE.card;
  const image = `${SITE.origin}${card.path}`;
  const og = (property: string, content: string | number) => ({
    key: property, html: `<meta property="${property}" content="${attr(String(content))}" />`,
    ...(property.startsWith("og:image") ? { card: true as const } : {}),
  });
  const tw = (name: string, content: string) => ({
    key: name, html: `<meta name="${name}" content="${attr(content)}" />`,
    ...(name.startsWith("twitter:image") ? { card: true as const } : {}),
  });
  return [
    og("og:site_name", SITE.name),
    og("og:type", "website"),
    og("og:url", meta.url ?? meta.canonical),
    og("og:title", meta.title),
    og("og:description", meta.description),
    og("og:image", image),
    og("og:image:type", card.type),
    og("og:image:width", card.width),
    og("og:image:height", card.height),
    og("og:image:alt", card.alt),
    tw("twitter:card", "summary_large_image"),
    tw("twitter:title", meta.title),
    tw("twitter:description", meta.description),
    tw("twitter:image", image),
    tw("twitter:image:alt", card.alt),
    { key: "apple-touch-icon", html: `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />` },
    { key: "manifest", html: `<link rel="manifest" href="/site.webmanifest" />` },
  ];
}

/**
 * The page with its social tags added before </head>. A tag the page already sets itself is kept and not repeated,
 * so running this twice changes nothing, and a page with its own og:image gets none of the shared card's image tags.
 * Pages that are not shared are unchanged.
 */
export function withSocialMeta(html: string): string {
  const meta = pageMeta(html);
  if (!meta) return html;
  const present = new Set(headTags(html).tags.flatMap((t) =>
    [t.attrs.get("property"), t.attrs.get("name"), t.name === "link" ? t.attrs.get("rel") : undefined]
      .filter((k): k is string => !!k).map((k) => k.toLowerCase())));
  const ownImage = present.has("og:image");
  const missing = socialTags(meta).filter((t) => !present.has(t.key) && !(ownImage && t.card));
  if (missing.length === 0) return html;
  return html.replace(/\n?([ \t]*)<\/head>/i, (_m, indent: string) =>
    missing.map((t) => `\n${indent}  ${t.html}`).join("") + `\n${indent}</head>`);
}

/** One world's card, as scripts/social-cards.ts drew it and recorded it in public/og/worlds/manifest.json. */
export interface WorldCard { id: string; name: string; family: string; asks: string; traits: string[]; seed: number; steps: number; image: string }

/** Where the build puts the copy of the lab page that a link naming `id` is served (deploy/Caddyfile). */
export const worldPagePath = (id: string) => `lab/world/${id}/index.html`;

/** What a lab link naming this world should preview as. The canonical link stays the lab's own: it is one page. */
export function worldMeta(w: WorldCard): PageMeta {
  return {
    title: `${w.name} · Cadence Garden`,
    description: `${w.asks} An artificial-life world you can grow in your browser.`,
    canonical: `${SITE.origin}/lab/`,
    url: `${SITE.origin}/lab/?world=${encodeURIComponent(w.id)}`,
    image: {
      path: w.image, type: "image/jpeg", width: 1200, height: 630,
      alt: `${w.name}, a world in the ${w.family} family of Cadence Garden, grown on a GPU for ${w.steps.toLocaleString("en-US")} steps from seed ${w.seed}.`,
    },
  };
}

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * The lab page (as built, with its social tags) retitled for one world: its own <title>, description and preview
 * tags; every other element of the head, and the whole body, exactly as built. Tags are matched by their parsed
 * attributes, in any order or quoting, and comments are left alone.
 */
export function worldPage(labHtml: string, w: WorldCard): string {
  const meta = worldMeta(w);
  const head = /<head\b[^>]*>[\s\S]*?<\/head>/i.exec(labHtml);
  if (!head || !pageMeta(labHtml)) throw new Error("the lab page has no head or no canonical link");
  const parts = head[0].split(/(<!--[\s\S]*?-->)/);
  let titled = false, described = false;
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, () => { titled = true; return `<title>${escapeText(meta.title)}</title>`; })
      .replace(/([ \t]*)<meta\b([^>]*)>(\n?)/gi, (tag: string, indent: string, body: string, nl: string) => {
        const attrs = attrsOf(body);
        const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
        if (key.startsWith("og:") || key.startsWith("twitter:")) return "";
        if (attrs.get("name")?.toLowerCase() !== "description") return tag;
        described = true;
        return `${indent}<meta name="description" content="${attr(meta.description)}" />${nl}`;
      });
  }
  if (!titled || !described) throw new Error("the lab page has no <title> or no meta description to retitle");
  const tags = socialTags(meta).filter((t) => t.key.startsWith("og:") || t.key.startsWith("twitter:"));
  const out = parts.join("").replace(/\n?([ \t]*)<\/head>/i, (_m, indent: string) =>
    tags.map((t) => `\n${indent}  ${t.html}`).join("") + `\n${indent}</head>`);
  return labHtml.slice(0, head.index) + out + labHtml.slice(head.index + head[0].length);
}
