// The experiments ledger (apps/lab/src/experiments/ledger.ts) feeds the generated lists on /story/ and /experiments/.
// This test fails when those pages are stale, when a ledger row disagrees with its journal card, when a row cites a
// file or page that does not exist, or when a built page is missing from the index.
// Regenerate with: BL_WRITE_LEDGER=1 pnpm vitest run apps/lab/test/experiments-ledger.test.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHAPTERS, ENTRIES, PLAYTHINGS } from "../src/experiments/ledger.ts";
import { STATE_CLASS, blocks, fill } from "../src/experiments/render.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const lab = `${root}apps/lab/`;
const PAGES = ["story/index.html", "experiments/index.html"];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
  .replace(/&rsquo;/g, "’").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Journal cards as [label · date, heading]. */
const journal = readFileSync(`${lab}research/index.html`, "utf8");
const cards = [...journal.matchAll(/<article class="evidence-card">\s*<span class="state ([a-z]+)">([^<]+)<\/span>\s*<h2>([\s\S]*?)<\/h2>/g)]
  .map((m) => ({ cls: m[1], chip: text(m[2]), heading: text(m[3]) }));

describe("experiments ledger", () => {
  it("generated lists on /story/ and /experiments/ match the ledger", () => {
    for (const page of PAGES) {
      const path = `${lab}${page}`;
      const html = readFileSync(path, "utf8");
      const next = fill(html);
      if (process.env.BL_WRITE_LEDGER === "1" && next !== html) writeFileSync(path, next);
      expect(next === html, `${page} is stale: run BL_WRITE_LEDGER=1 pnpm vitest run apps/lab/test/experiments-ledger.test.ts`).toBe(true);
    }
  });

  it("every block is used, and the story has one list per chapter", () => {
    const used = new Set(PAGES.flatMap((p) => [...readFileSync(`${lab}${p}`, "utf8").matchAll(/<!-- GENERATED:ledger:([a-z0-9-]+) -->/g)].map((m) => m[1])));
    expect([...used].sort()).toEqual(Object.keys(blocks()).sort());
  });

  it("every row matches a journal card: same heading, label, date and chip colour", () => {
    expect(cards.length).toBeGreaterThan(30);
    for (const e of ENTRIES) {
      const card = cards.find((c) => c.heading === e.card);
      expect(card, `no journal card headed "${e.card}"`).toBeDefined();
      expect(card!.chip, e.card).toBe(`${e.label} · ${e.date}`);
      expect(card!.cls, e.card).toBe(STATE_CLASS[e.label]);
    }
  });

  it("every journal card is in the ledger exactly once", () => {
    const listed = ENTRIES.map((e) => e.card).sort();
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toEqual(cards.map((c) => c.heading).sort());
  });

  it("rows belong to a chapter, and cite sources and pages that exist", () => {
    const chapters = new Set(CHAPTERS.map((c) => c.n));
    for (const e of ENTRIES) {
      expect(chapters.has(e.chapter), e.card).toBe(true);
      expect(e.sources.length, e.card).toBeGreaterThan(0);
      for (const s of e.sources) expect(existsSync(`${root}${s}`), `${e.card}: no file ${s}`).toBe(true);
      for (const p of e.pages ?? []) expect(existsSync(`${lab}${p.href.slice(1)}index.html`), `${e.card}: no page ${p.href}`).toBe(true);
    }
    for (const c of CHAPTERS) expect(ENTRIES.some((e) => e.chapter === c.n), c.question).toBe(true);
  });

  it("every experiment page the site builds is reachable from the index", () => {
    for (const p of PLAYTHINGS) expect(existsSync(`${lab}${p.href.slice(1)}index.html`), p.href).toBe(true);
    const linked = new Set([...PLAYTHINGS.map((p) => p.href), ...ENTRIES.flatMap((e) => (e.pages ?? []).map((p) => p.href))]);
    const config = readFileSync(`${lab}vite.config.ts`, "utf8");
    const inputs = [...config.matchAll(/r\("\.\/([a-z0-9/-]+)\/index\.html"\)/g)].map((m) => `/${m[1]}/`);
    expect(inputs.length).toBeGreaterThan(20);
    // Site furniture, and sub-pages reached from their parent page.
    const elsewhere = new Set(["/how-it-works/", "/research/", "/about/", "/privacy/", "/participate/", "/status/", "/story/", "/experiments/",
      "/particles/picker/", "/particles/oases/", "/particles/seasons/", "/particles/bonds/", "/particles/motifs/", "/ecosystem/archive/"]);
    const missing = inputs.filter((i) => !linked.has(i) && !elsewhere.has(i));
    expect(missing).toEqual([]);
  });
});
