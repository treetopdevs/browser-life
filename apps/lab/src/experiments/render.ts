// Renders the ledger (ledger.ts) into the HTML kept between GENERATED markers on /story/ and /experiments/.
// Pure string functions, so the sync test and its write mode share one renderer.
import { CHAPTERS, ENTRIES, PLAYTHINGS, type Entry, type Label } from "./ledger.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The journal's chip class for each label (apps/lab/src/site.css `.state.*`). */
export const STATE_CLASS: Record<Label, string> = {
  Confirmed: "observed",
  Negative: "negative",
  Measured: "measured",
  Exploratory: "measured",
  Open: "pending",
  Unclear: "pending",
  "Not yet measured": "pending",
};

const SOURCE_BASE = "https://github.com/treetopdevs/browser-life/blob/main/";

function entryItem(e: Entry, withSources: boolean, pad: string): string {
  const pages = (e.pages ?? []).map((p) => `<a href="${p.href}">${esc(p.text)} →</a>`).join(" ");
  const sources = withSources
    ? `\n${pad}  <p class="ledger-sources">Sources: ${e.sources.map((s) => `<a href="${SOURCE_BASE}${s}">${esc(s.split("/").slice(-2).join("/"))}</a>`).join(", ")}</p>`
    : "";
  return [
    `${pad}<li>`,
    `${pad}  <span class="state ${STATE_CLASS[e.label]}">${esc(e.label)} · ${esc(e.date)}</span>`,
    `${pad}  <p><strong>${esc(e.card)}</strong> ${esc(e.answer)}${pages ? ` ${pages}` : ""}</p>${sources}`,
    `${pad}</li>`,
  ].join("\n");
}

/** The list under one chapter of the story. */
export function renderChapter(n: number, withSources = false, pad = "          "): string {
  const rows = ENTRIES.filter((e) => e.chapter === n);
  return [`${pad}<ul class="ledger" role="list">`, ...rows.map((e) => entryItem(e, withSources, `${pad}  `)), `${pad}</ul>`].join("\n");
}

/** The whole index, one section per chapter, with sources. */
export function renderIndex(): string {
  return CHAPTERS.map((c) => [
    `      <section class="shell prose-grid" id="chapter-${c.n}">`,
    `        <div class="aside-label">${c.n} · ${esc(c.short)}</div>`,
    `        <div class="prose">`,
    `          <h2>${esc(c.question)}</h2>`,
    renderChapter(c.n, true),
    `        </div>`,
    `      </section>`,
  ].join("\n")).join("\n");
}

/** The list of pages to run or watch. */
export function renderPlaythings(pad = "          "): string {
  return [
    `${pad}<ul class="ledger playthings" role="list">`,
    ...PLAYTHINGS.map((p) => `${pad}  <li><p><a href="${p.href}"><strong>${esc(p.title)}</strong></a> ${esc(p.blurb)}</p></li>`),
    `${pad}</ul>`,
  ].join("\n");
}

/** Tallies for the index's opening line. */
export function tally(): { total: number; byLabel: [Label, number][] } {
  const counts = new Map<Label, number>();
  for (const e of ENTRIES) counts.set(e.label, (counts.get(e.label) ?? 0) + 1);
  return { total: ENTRIES.length, byLabel: [...counts.entries()].sort((a, b) => b[1] - a[1]) };
}

export function renderTally(pad = "          "): string {
  const t = tally();
  return `${pad}<p class="ledger-tally">${t.total} results so far: ${t.byLabel.map(([l, n]) => `<span class="state ${STATE_CLASS[l]}">${n} ${esc(l.toLowerCase())}</span>`).join(" ")}</p>`;
}

/** Every generated block, by marker name. */
export function blocks(): Record<string, string> {
  const out: Record<string, string> = { index: renderIndex(), playthings: renderPlaythings(), tally: renderTally() };
  for (const c of CHAPTERS) out[`chapter-${c.n}`] = renderChapter(c.n);
  return out;
}

/** The names of the generated blocks a page opens, in order. Throws on unbalanced, nested or repeated markers. */
export function markers(html: string): string[] {
  const names: string[] = [];
  let open: string | null = null;
  for (const m of html.matchAll(/<!-- (\/?)GENERATED:ledger:([a-z0-9-]+) -->/g)) {
    const [, slash, name] = m;
    if (!slash) {
      if (open !== null) throw new Error(`ledger block ${name} opens inside ${open}`);
      if (names.includes(name)) throw new Error(`ledger block ${name} appears twice`);
      open = name;
      names.push(name);
    } else {
      if (open !== name) throw new Error(`ledger block ${name} closes but ${open ?? "nothing"} is open`);
      open = null;
    }
  }
  if (open !== null) throw new Error(`ledger block ${open} is never closed`);
  return names;
}

/**
 * Replace the body of each `<!-- GENERATED:ledger:<name> -->…<!-- /GENERATED:ledger:<name> -->` block in a page,
 * empty or not. Throws on malformed markers or an unknown block name, so a stale page cannot pass unchanged.
 */
export function fill(html: string): string {
  const all = blocks();
  const names = markers(html);
  let filled = 0;
  const out = html.replace(/([ \t]*)<!-- GENERATED:ledger:([a-z0-9-]+) -->[\s\S]*?<!-- \/GENERATED:ledger:\2 -->/g, (_whole, indent: string, name: string) => {
    const body = all[name];
    if (body === undefined) throw new Error(`unknown ledger block ${name}`);
    filled++;
    return `${indent}<!-- GENERATED:ledger:${name} -->\n${body}\n${indent}<!-- /GENERATED:ledger:${name} -->`;
  });
  if (filled !== names.length) throw new Error(`filled ${filled} of ${names.length} ledger blocks`);
  return out;
}
