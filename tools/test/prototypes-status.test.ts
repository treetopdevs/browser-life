// The 2 November 2026 prototype status (docs/prototypes-2026-11-02.md and its HTML twin) and the walk-through it was written
// from (docs/prototypes-2026-11-02/). CPU only: reads files, starts nothing. What is checked: the seven surface sections in
// order with their four labels; the twins carry the same headings, commands, table cells and link targets; every local link and
// screenshot resolves; the screenshot set (PNG only, 8 to 16, each under 300 KB, header width 1280 or 375, listed in
// shots.json and cited by both twins); every inventory row of the walk has a verdict, a deciding assertion and evidence that
// exists, and the frozen inventory covers every Vite input and playground destination; the 18 October pages differ from
// their original blobs by one pointer line only; every PR cited as [#N] has a link definition.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const DOCS = join(REPO, "docs");
const SLICE = join(DOCS, "prototypes-2026-11-02");
const MD = readFileSync(join(DOCS, "prototypes-2026-11-02.md"), "utf8");
const HTML = readFileSync(join(DOCS, "prototypes-2026-11-02.html"), "utf8");
const WALK = readFileSync(join(SLICE, "walkthrough.md"), "utf8");

const SURFACES = ["Lab", "Public site", "Archipelago", "Shared garden", "AI naturalist", "Evolution game", "Research instruments"];
const LABELS = ["What it is now.", "How to try it.", "Not built.", "Waits on you."];
const VERDICTS = ["works", "partly", "broken"];

// ---- parsing helpers --------------------------------------------------------------------------------------------------

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
const norm = (s: string) => decode(s).replace(/\s+/g, " ").trim();

/** The md source with fenced blocks cut out (returned separately). */
function splitFences(md: string): { prose: string; fences: string[] } {
  const fences: string[] = [];
  const prose = md.replace(/^```[^\n]*\n([\s\S]*?)^```\s*$/gm, (_m, body: string) => { fences.push(body.replace(/\n$/, "")); return ""; });
  return { prose, fences };
}

function linkDefs(md: string): Map<string, string> {
  const defs = new Map<string, string>();
  for (const m of md.matchAll(/^\[(#\d+)\]: (\S+)$/gm)) defs.set(m[1], m[2]);
  return defs;
}

/** Plain text of a markdown fragment: markup removed so it compares with the HTML's text. */
function mdText(s: string): string {
  return norm(
    s
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/<(https?:\/\/[^>]+)>/g, "$1")
      .replace(/\\\|/g, "|")
      .replace(/`/g, "")
      .replace(/\*\*/g, ""),
  );
}

interface Parsed { headings: string[]; fences: string[]; code: string[]; cells: string[]; links: string[]; images: string[]; prose: string[] }

/** Paragraph and list-item text of the md source (fences, tables, headings, images and link definitions removed). */
function mdParagraphs(md: string): string[] {
  const { prose } = splitFences(md);
  const out: string[] = [];
  for (const block of prose.replace(/^\[#\d+\]: \S+$/gm, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (lines.length === 0 || /^(#|\||!\[|<)/.test(lines[0].trim())) continue;
    let cur: string[] = [];
    const flush = () => { if (cur.length) out.push(mdText(cur.join(" ").replace(/\[(#\d+)\](?!\()/g, "$1"))); cur = []; };
    for (const l of lines) {
      if (/^(- |\d+\. )/.test(l)) { flush(); cur.push(l.replace(/^(- |\d+\. )/, "")); } else cur.push(l.trim());
    }
    flush();
  }
  return out.filter((t) => t.length > 0);
}

function parseMd(md: string): Parsed {
  const defs = linkDefs(md);
  const { prose: withDefs, fences } = splitFences(md);
  const prose = withDefs.replace(/^\[#\d+\]: \S+$/gm, "");
  const headings = [...prose.matchAll(/^#{1,2} (.*)$/gm)].map((m) => mdText(m[1]));
  const code = [...prose.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\\\|/g, "|"));
  const cells: string[] = [];
  for (const line of prose.split("\n")) {
    if (!line.startsWith("|") || /^\|[\s|:-]+\|$/.test(line)) continue;
    for (const c of line.trim().slice(1, -1).split(/(?<!\\)\|/)) cells.push(mdText(c));
  }
  const links: string[] = [];
  const images: string[] = [];
  for (const m of prose.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g)) (m[1] ? images : links).push(m[3]);
  for (const m of prose.matchAll(/<(https?:\/\/[^>]+)>/g)) links.push(m[1]);
  for (const m of prose.matchAll(/\[(#\d+)\](?!:|\()/g)) links.push(defs.get(m[1]) ?? `MISSING-${m[1]}`);
  return { headings, fences, code, cells, links, images, prose: mdParagraphs(md) };
}

function parseHtml(html: string): Parsed {
  const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
  const fences = [...main.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => decode(m[1]));
  const noPre = main.replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, "");
  const headings = [...noPre.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)].map((m) => norm(m[1].replace(/<[^>]+>/g, "")));
  const code = [...noPre.matchAll(/<code>([\s\S]*?)<\/code>/g)].map((m) => decode(m[1]));
  const cells = [...noPre.matchAll(/<t[dh]>([\s\S]*?)<\/t[dh]>/g)].map((m) => norm(m[1].replace(/<[^>]+>/g, "")));
  const links = [...noPre.matchAll(/<a href="([^"]+)"/g)].map((m) => decode(m[1]));
  const images = [...noPre.matchAll(/<img src="([^"]+)"/g)].map((m) => decode(m[1]));
  const prose = [...noPre.replace(/<table[\s\S]*?<\/table>/g, "").matchAll(/<(p|li)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)].map((m) => norm(m[2].replace(/<[^>]+>/g, ""))).filter((t) => t.length > 0);
  return { headings, fences, code, cells, links, images, prose };
}

const md = parseMd(MD);
const html = parseHtml(HTML);

// ---- 1. sections ------------------------------------------------------------------------------------------------------

describe("the status page", () => {
  it("new page has the seven surface sections in order", () => {
    const found = [...MD.matchAll(/^## (\d)\. (.*)$/gm)];
    expect(found.map((m) => m[2])).toEqual(SURFACES);
    expect(found.map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const starts = found.map((m) => m.index ?? 0);
    starts.forEach((start, k) => {
      const body = MD.slice(start, k + 1 < starts.length ? starts[k + 1] : MD.length).split(/^## (?!\d\.)/m)[0];
      let at = -1;
      for (const label of LABELS) {
        const idx = body.indexOf(`**${label}**`);
        expect(idx, `${SURFACES[k]}: label ${label}`).toBeGreaterThan(at);
        at = idx;
      }
    });
    // The HTML twin has the same sections and labels.
    const h = [...HTML.matchAll(/<h2 id="[^"]*">(\d)\. ([^<]*)<\/h2>/g)].map((m) => m[2]);
    expect(h).toEqual(SURFACES);
    for (const label of LABELS) expect(HTML.split(`<strong>${label}</strong>`).length - 1, label).toBe(7);
  });

  // ---- 2. twins --------------------------------------------------------------------------------------------------------

  it("html twin matches md: headings, commands, table cells, link targets", () => {
    expect(md.fences.length).toBeGreaterThan(0);
    expect(html.fences.length).toBeGreaterThan(0);
    expect(md.cells.length).toBeGreaterThan(20);
    expect(html.cells.length).toBeGreaterThan(20);
    expect(md.links.length).toBeGreaterThan(20);
    expect(html.headings).toEqual(md.headings);
    expect(html.fences.map(norm)).toEqual(md.fences.map(norm));
    expect(html.code.map(norm)).toEqual(md.code.map(norm));
    expect(html.cells).toEqual(md.cells);
    // Ordinary prose: every paragraph and list item reads the same in both twins.
    expect(md.prose.length).toBeGreaterThan(30);
    expect(html.prose).toEqual(md.prose);
    // Link targets as a multiset (the md parser lists inline links, then autolinks, then [#N] references; the table of contents sits outside main).
    expect([...html.links].sort()).toEqual([...md.links].sort());
    expect(html.images).toEqual(md.images);
    // Fragment links resolve to one id each in the same file.
    const ids = [...HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size, "ids are unique").toBe(ids.length);
    for (const m of HTML.matchAll(/href="#([^"]+)"/g)) expect(ids, `fragment #${m[1]}`).toContain(m[1]);
  });

  it("every command in a fenced block appears in the command table", () => {
    const tableCells = md.cells.join("\n");
    const lines = md.fences.flatMap((f) => f.split("\n")).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) expect(tableCells, line).toContain(line);
  });

  // ---- 3. links --------------------------------------------------------------------------------------------------------

  it("every local link and screenshot in both twins resolves to a file", () => {
    for (const [name, p] of [["md", md], ["html", html]] as const) {
      expect(p.images.length, `${name} screenshots`).toBeGreaterThanOrEqual(8);
      for (const target of [...p.links, ...p.images]) {
        if (/^(https?:|mailto:)/.test(target) || target.startsWith("#")) continue;
        const file = resolve(DOCS, target.split("#")[0]);
        expect(existsSync(file), `${name}: ${target}`).toBe(true);
      }
    }
  });

  // ---- 7. PR citations -------------------------------------------------------------------------------------------------

  it("every PR cited as #N appears in the link definitions", () => {
    const defs = linkDefs(MD);
    const body = MD.replace(/^\[#\d+\]: \S+$/gm, "");
    const cited = new Set([...body.matchAll(/\[(#\d+)\](?!:|\()/g)].map((m) => m[1]));
    expect(cited.size).toBeGreaterThan(20);
    for (const c of cited) expect(defs.has(c), c).toBe(true);
    for (const [k, url] of defs) expect(url, k).toBe(`https://github.com/treetopdevs/browser-life/pull/${k.slice(1)}`);
    // Draft PRs are named as drafts where they are mentioned.
    for (const n of ["#60", "#69", "#130"]) expect(MD, n).toMatch(new RegExp(`\\[${n}\\]`));
    expect(MD).toMatch(/draft/i);
  });
});

// ---- 4. screenshots ---------------------------------------------------------------------------------------------------

interface ShotRow { file: string; route: string; viewport: string; width: number; crop: string; scale: string; row: string; errorPage?: boolean }

function pngWidth(file: string): number {
  const b = readFileSync(file);
  // Full 8-byte signature, then the first chunk must be IHDR (length 13) before its width field is trusted.
  expect(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${file} has the PNG signature`).toBe(true);
  expect(b.readUInt32BE(8), `${file} IHDR length`).toBe(13);
  expect(b.subarray(12, 16).toString("latin1"), `${file} first chunk is IHDR`).toBe("IHDR");
  return b.readUInt32BE(16);
}

describe("screenshots", () => {
  const shotsDir = join(SLICE, "shots");
  const manifest = JSON.parse(readFileSync(join(SLICE, "shots.json"), "utf8")) as ShotRow[];
  const walkIds = new Set([...WALK.matchAll(/^\| (W\d+) \|/gm)].map((m) => m[1]));

  it("png only, 8 to 16, each under 300 KB, header width 1280 or 375, each in shots.json and cited by the page", () => {
    const files = readdirSync(shotsDir);
    expect(files.filter((f) => !f.endsWith(".png")), "non-PNG files").toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files.length).toBeLessThanOrEqual(16);
    expect(manifest.map((m) => basename(m.file)).sort()).toEqual([...files].sort());
    for (const f of files) {
      const path = join(shotsDir, f);
      expect(statSync(path).size, `${f} size`).toBeLessThan(300 * 1024);
      const width = pngWidth(path);
      expect([1280, 375], `${f} header width`).toContain(width);
      const row = manifest.find((m) => basename(m.file) === f);
      expect(row?.width, `${f} manifest width`).toBe(width);
      expect(row?.viewport.startsWith(`${width}x`), `${f} viewport`).toBe(true);
      expect(row?.crop && row.scale, `${f} crop and scale recorded`).toBeTruthy();
      expect(walkIds.has(row?.row ?? ""), `${f} names an existing walkthrough row`).toBe(true);
      expect(MD, `${f} cited by md`).toContain(`shots/${f}`);
      expect(HTML, `${f} cited by html`).toContain(`shots/${f}`);
    }
  });
});

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

// ---- 5. walkthrough verdicts ------------------------------------------------------------------------------------------

interface WalkRow { id: string; route: string; verdict: string; assertion: string; evidence: string }

function parseWalk(text: string): WalkRow[] {
  const rows: WalkRow[] = [];
  for (const line of text.split("\n")) {
    if (!/^\| W\d+ \|/.test(line)) continue;
    const c = line.trim().slice(1, -1).split(/(?<!\\)\|/).map((x) => x.trim().replace(/\\\|/g, "|"));
    rows.push({ id: c[0], route: c[1].replace(/^`|`$/g, ""), verdict: c[5], assertion: c[6], evidence: c[7] });
  }
  return rows;
}

/** Problems with walkthrough rows: unknown verdict, empty assertion, evidence that does not exist, a works row on an error page. */
export function walkProblems(rows: WalkRow[], exists: (rel: string) => boolean, errorPages: Set<string>): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (!VERDICTS.includes(r.verdict)) out.push(`${r.id}: unknown verdict "${r.verdict}"`);
    if (r.assertion.length < 15) out.push(`${r.id}: no deciding assertion`);
    const refs = r.evidence.match(/(?:evidence|shots)\/[\w.-]+/g) ?? [];
    if (refs.length === 0) out.push(`${r.id}: no evidence reference`);
    for (const ref of refs) {
      if (!exists(ref)) out.push(`${r.id}: evidence ${ref} does not exist`);
      if (r.verdict === "works" && errorPages.has(ref)) out.push(`${r.id}: works, but ${ref} is flagged as an error page`);
    }
  }
  return out;
}

/** "W10 to W15, W41" becomes W10..W15, W41. */
function expandIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/W(\d+)(?: to W(\d+))?/g)) for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) out.push(`W${String(n).padStart(2, "0")}`);
  return out;
}

interface SweepRow { w: number; r: string; status: number; h1: string; hscroll: boolean; errors: unknown[] }

/** Problems with the sweep log: wrong shape, a plain-route row missing at a width, or a works row whose route logged errors. */
export function sweepProblems(sweep: unknown, rows: WalkRow[]): string[] {
  if (!Array.isArray(sweep) || sweep.length < 60) return ["sweep.json is not an array of at least 60 rows"];
  const out: string[] = [];
  const list = sweep as SweepRow[];
  for (const e of list) {
    if (![1280, 375].includes(e?.w) || typeof e.r !== "string" || typeof e.status !== "number" || typeof e.h1 !== "string" || !Array.isArray(e.errors) || typeof e.hscroll !== "boolean") out.push(`malformed sweep row ${JSON.stringify(e)?.slice(0, 80)}`);
  }
  if (out.length) return out;
  for (const r of rows) {
    if (!r.evidence.includes("sweep.json") || !r.route.startsWith("/") || r.route.includes("?") || r.route.includes(" ")) continue;
    for (const w of [1280, 375]) {
      const hits = list.filter((x) => x.w === w && x.r === r.route);
      if (hits.length !== 1) { out.push(`${r.id}: ${hits.length} sweep rows for ${r.route} at ${w}, want exactly 1`); continue; }
      const e = hits[0];
      if (r.verdict !== "works") continue;
      const want = r.route === "/no-such-page/" ? 404 : 200;
      if (e.status !== want) out.push(`${r.id}: works but status ${e.status} at ${w}, want ${want}`);
      if (e.hscroll) out.push(`${r.id}: works but scrolls sideways at ${w}`);
      // The not-found page's one console line is the 404 status itself; every other works route logs nothing.
      if (e.errors.length > (want === 404 ? 1 : 0)) out.push(`${r.id}: works but logged ${e.errors.length} console error(s) at ${w}`);
    }
  }
  return out;
}

interface SelftestRow { w: number; done: boolean; error: string | null; results: { name: string; ok: boolean }[] }

/** Problems with the recorded /selftest.html result (PLAN rule: non-empty results, every case ok, window.__golden.error unset). */
export function selftestProblems(record: unknown, rows: WalkRow[]): string[] {
  const row = rows.find((r) => r.route === "/selftest.html");
  if (!row || row.verdict !== "works") return [];
  const list = (record as { rows?: SelftestRow[] } | null)?.rows;
  if (!row.evidence.includes("evidence/selftest.json")) return [`${row.id}: works without evidence/selftest.json`];
  if (!Array.isArray(list)) return ["selftest.json has no rows"];
  const out: string[] = [];
  for (const w of [1280, 375]) {
    const g = list.find((x) => x?.w === w);
    if (!g) { out.push(`${row.id}: no self-test record at ${w}`); continue; }
    if (g.done !== true) out.push(`${row.id}: self-test not done at ${w}`);
    if (g.error != null) out.push(`${row.id}: self-test error at ${w}: ${g.error}`);
    if (!Array.isArray(g.results) || g.results.length === 0) out.push(`${row.id}: no self-test results at ${w}`);
    else for (const c of g.results) if (c?.ok !== true) out.push(`${row.id}: case ${c?.name} failed at ${w}`);
  }
  return out;
}

interface FirstLoadRow { w: number; r: string; iconLinks: number; errors: string[] }

/** Rows that claim a favicon 404 must have it in the fresh-profile first-load record at both widths, with no icon link. */
export function firstLoadProblems(record: unknown, rows: WalkRow[]): string[] {
  const list = (record as { rows?: FirstLoadRow[] } | null)?.rows;
  if (!Array.isArray(list)) return ["first-load.json has no rows"];
  const out: string[] = [];
  for (const r of rows.filter((x) => /favicon\.ico and logs a 404/.test(x.assertion))) {
    if (!r.evidence.includes("evidence/first-load.json")) out.push(`${r.id}: favicon claim without evidence/first-load.json`);
    for (const w of [1280, 375]) {
      const e = list.find((x) => x?.w === w && x.r === r.route);
      if (!e) out.push(`${r.id}: no first-load row for ${r.route} at ${w}`);
      else if (e.iconLinks !== 0 || !e.errors?.some((m) => /404/.test(m))) out.push(`${r.id}: first load at ${w} does not show the favicon 404`);
    }
  }
  return out;
}

describe("walkthrough", () => {
  const rows = parseWalk(WALK);
  const manifest = JSON.parse(readFileSync(join(SLICE, "shots.json"), "utf8")) as ShotRow[];
  const errorPages = new Set(manifest.filter((m) => m.errorPage).map((m) => m.file));
  const exists = (rel: string) => existsSync(join(SLICE, rel));

  it("every surface and every inventory row has a verdict, an assertion and evidence that exists", () => {
    expect(rows.length).toBeGreaterThan(40);
    expect(walkProblems(rows, exists, errorPages)).toEqual([]);
    // The page's own surface table.
    const table = MD.slice(MD.indexOf("## Verdicts and screenshots"));
    const surfaceRows = SURFACES.map((s) => table.split("\n").find((l) => l.startsWith(`| ${s} |`)));
    surfaceRows.forEach((line, k) => {
      expect(line, SURFACES[k]).toBeTruthy();
      const c = (line as string).trim().slice(1, -1).split("|").map((x) => x.trim());
      expect(VERDICTS, `${SURFACES[k]} verdict`).toContain(c[1]);
      expect(c[2].length, `${SURFACES[k]} assertion`).toBeGreaterThan(15);
      const cited = expandIds(c[4]);
      expect(cited.length, `${SURFACES[k]} cites walkthrough rows`).toBeGreaterThan(0);
      for (const id of cited) expect(rows.some((r) => r.id === id), `${SURFACES[k]} cites ${id}`).toBe(true);
      expect(c[3].match(/shots\/[\w.-]+\.png/g)?.length ?? 0, `${SURFACES[k]} cites screenshots`).toBeGreaterThanOrEqual(2);
      // A surface is "works" only if every row it cites is "works".
      if (c[1] === "works") for (const id of cited) expect(rows.find((r) => r.id === id)?.verdict, `${SURFACES[k]} is works but ${id} is not`).toBe("works");
    });
  });

  it("negative cases: missing evidence, an unknown verdict and a works row on an error page fail", () => {
    const base = { id: "W99", route: "/x", verdict: "works", assertion: "loads and its main action completes", evidence: "evidence/sweep.json" };
    expect(walkProblems([base], exists, new Set())).toEqual([]);
    expect(walkProblems([{ ...base, evidence: "evidence/nope.json" }], exists, new Set()).join()).toMatch(/does not exist/);
    expect(walkProblems([{ ...base, evidence: "" }], exists, new Set()).join()).toMatch(/no evidence reference/);
    expect(walkProblems([{ ...base, verdict: "fine" }], exists, new Set()).join()).toMatch(/unknown verdict/);
    expect(walkProblems([{ ...base, assertion: "" }], exists, new Set()).join()).toMatch(/no deciding assertion/);
    expect(walkProblems([{ ...base, evidence: "shots/01-site-home-1280.png" }], exists, new Set(["shots/01-site-home-1280.png"])).join()).toMatch(/error page/);
    expect(walkProblems([{ ...base, verdict: "partly", evidence: "shots/01-site-home-1280.png" }], exists, new Set(["shots/01-site-home-1280.png"]))).toEqual([]);
  });

  it("the sweep log has the right shape and agrees with the verdicts it backs", () => {
    const sweep = JSON.parse(readFileSync(join(SLICE, "evidence/sweep.json"), "utf8"));
    expect(sweepProblems(sweep, rows)).toEqual([]);
    // Negative cases: null, a malformed row, a works row whose route logged an error.
    expect(sweepProblems(null, rows).length).toBeGreaterThan(0);
    expect(sweepProblems([...sweep.slice(1), { w: 1, r: 1 }], rows).length).toBeGreaterThan(0);
    const bad = sweep.map((e: SweepRow) => (e.r === "/worlds/" ? { ...e, errors: ["boom"] } : e));
    expect(sweepProblems(bad, rows).join()).toMatch(/W03: works but logged/);
    const s404 = sweep.map((e: SweepRow) => (e.r === "/worlds/" ? { ...e, status: 404, errors: ["x"] } : e));
    expect(sweepProblems(s404, rows).join()).toMatch(/W03: works but status 404/);
    const s200 = sweep.map((e: SweepRow) => (e.r === "/no-such-page/" ? { ...e, status: 200 } : e));
    expect(sweepProblems(s200, rows).join()).toMatch(/W09: works but status 200/);
    const dup = [...sweep, { ...sweep.find((e: SweepRow) => e.r === "/worlds/" && e.w === 1280), status: 500, errors: ["x"] }];
    expect(sweepProblems(dup, rows).join()).toMatch(/W03: 2 sweep rows/);
  });

  it("the self-test row is backed by a recorded window.__golden: non-empty, all cases ok, no error", () => {
    const rec = JSON.parse(readFileSync(join(SLICE, "evidence/selftest.json"), "utf8"));
    expect(selftestProblems(rec, rows)).toEqual([]);
    const one = (patch: Partial<SelftestRow>) => ({ rows: rec.rows.map((g: SelftestRow) => (g.w === 375 ? { ...g, ...patch } : g)) });
    expect(selftestProblems(one({ results: [] }), rows).join()).toMatch(/no self-test results at 375/);
    expect(selftestProblems(one({ error: "adapter lost" }), rows).join()).toMatch(/self-test error at 375/);
    expect(selftestProblems(one({ results: [{ name: "c1", ok: false }] }), rows).join()).toMatch(/case c1 failed/);
    expect(selftestProblems({ rows: rec.rows.filter((g: SelftestRow) => g.w !== 1280) }, rows).join()).toMatch(/no self-test record at 1280/);
    const stripped = rows.map((r) => (r.route === "/selftest.html" ? { ...r, evidence: "evidence/sweep.json" } : r));
    expect(selftestProblems(rec, stripped).join()).toMatch(/without evidence\/selftest.json/);
  });

  it("every favicon-404 claim is backed by a fresh-profile first load at both widths", () => {
    const rec = JSON.parse(readFileSync(join(SLICE, "evidence/first-load.json"), "utf8"));
    expect(rows.filter((r) => /favicon\.ico and logs a 404/.test(r.assertion)).length).toBe(5);
    expect(firstLoadProblems(rec, rows)).toEqual([]);
    const clean = { rows: rec.rows.map((e: FirstLoadRow) => (e.r === "/development/" && e.w === 375 ? { ...e, errors: [] } : e)) };
    expect(firstLoadProblems(clean, rows).join()).toMatch(/W24: first load at 375/);
  });

  it("the frozen inventory covers every Vite input and every playground destination", () => {
    const vite = readFileSync(join(REPO, "apps/lab/vite.config.ts"), "utf8");
    const inputs = [...vite.slice(vite.indexOf("input: {")).matchAll(/r\("\.\/([^"]+)"\)/g)].map((m) => m[1]);
    expect(inputs.length).toBeGreaterThan(30);
    const want = new Set<string>();
    for (const f of inputs) {
      if (f === "404.html") want.add("/no-such-page/");
      else if (f === "index.html") want.add("/");
      else if (f.endsWith("/index.html")) want.add(`/${f.slice(0, -"index.html".length)}`);
      else want.add(`/${f}`);
    }
    const playground = readFileSync(join(REPO, "apps/lab/src/playground/page.ts"), "utf8");
    for (const m of playground.matchAll(/href: "([^"]+)"/g)) want.add(m[1]);
    expect(want.size).toBeGreaterThan(30);
    const have = rows.map((r) => r.route.split(" ")[0].split("?")[0]);
    for (const route of want) expect(have, `inventory row for ${route}`).toContain(route);
  });
});

// ---- 6. the 18 October pages -------------------------------------------------------------------------------------------

describe("18 October pages", () => {
  // sha256 of the blobs at 0bdd7a70 (git show 0bdd7a70:docs/prototypes-2026-10-18.md | shasum -a 256, and the .html).
  const PINNED: Record<string, string> = {
    "prototypes-2026-10-18.md": "027cc25ab9b4e9620d8b5ab592337ee6f4a3091db30a31c87a10d5991f0230b3",
    "prototypes-2026-10-18.html": "9b0b68705c4548360ca9c79a97544125b5ee0df85a2f8490298a605806760945",
  };
  const MARK = "prototypes-2026-11-02";

  it("18 Oct pages unchanged but for one pointer line", () => {
    for (const [name, sha] of Object.entries(PINNED)) {
      const text = readFileSync(join(DOCS, name), "utf8");
      const lines = text.split("\n");
      const at = lines.flatMap((l, i) => (l.includes(MARK) ? [i] : []));
      expect(at.length, `${name} has exactly one pointer line`).toBe(1);
      // The line sits at the top: first line of the Markdown, the line right after <body> in the HTML.
      if (name.endsWith(".md")) expect(at[0]).toBe(0);
      else expect(lines[at[0] - 1]).toBe("<body>");
      const rest = lines.filter((_l, i) => i !== at[0]).join("\n");
      expect(createHash("sha256").update(rest).digest("hex"), name).toBe(sha);
    }
  });

  it("the pinned hash test would catch a second change", () => {
    const text = readFileSync(join(DOCS, "prototypes-2026-10-18.md"), "utf8").replace("Prototype status", "Prototype state");
    const rest = text.split("\n").filter((l) => !l.includes(MARK)).join("\n");
    expect(createHash("sha256").update(rest).digest("hex")).not.toBe(PINNED["prototypes-2026-10-18.md"]);
  });
});
