import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DARK_TOKENS, LIGHT_TOKENS, cannotTell, renderNotebook } from "../lib/notebook-html.ts";
import { fmtZ, group } from "../lib/notebook.ts";
import { sampleModel } from "./notebook-fixture.ts";

const rings = sampleModel("rings");
const quiet = sampleModel("quiet");
const ringsHtml = renderNotebook(rings);
const quietHtml = renderNotebook(quiet);
const heldOut = sampleModel("held-out");
const heldOutHtml = renderNotebook(heldOut);
const neutralOutside = sampleModel("rings", { id: "sandbox/gradient-m3/neutral/seed-7" });
const pages = [ringsHtml, quietHtml, renderNotebook(sampleModel("calibration")), heldOutHtml, renderNotebook(neutralOutside)];
const firstOf = (h: string) => h.slice(h.indexOf(`<section class="first">`), h.indexOf("</section>"));
const styleOf = (h: string) => h.slice(h.indexOf("<style>") + 7, h.indexOf("</style>"));
const bodyText = (h: string) => h.slice(h.indexOf("<body>")).replace(/<[^>]+>/g, " ");
/** Declarations of the first block whose selector text matches. */
function block(text: string, selector: string): Record<string, string> {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`no ${selector}`);
  const open = css.indexOf("{", at + selector.length - 1), close = css.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const d of css.slice(open + 1, close).split(";")) {
    const i = d.indexOf(":");
    if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return out;
}

describe("the page contract", () => {
  it("is self-contained", () => {
    for (const h of pages) {
      expect(h.startsWith("<!doctype html>")).toBe(true);
      expect(h).not.toMatch(/<script|<link|<iframe|<img|@import|@font-face/i);
      expect(h).not.toMatch(/https?:\/\//);
      expect(h.match(/url\(/g) ?? []).toEqual([]);
    }
  });
  it("has both dark blocks, each with color-scheme: dark", () => {
    const css = styleOf(ringsHtml);
    expect(css).toContain(`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {`);
    const media = block(css, `:root:not([data-theme="light"])`);
    const attr = block(css, `:root[data-theme="dark"]`);
    expect(media["color-scheme"]).toBe("dark");
    expect(attr["color-scheme"]).toBe("dark");
    for (const [k, v] of Object.entries(DARK_TOKENS)) {
      expect(media[k]).toBe(v);
      expect(attr[k]).toBe(v);
    }
    expect(block(css, ":root {")["color-scheme"]).toBe("light");
  });
  it("declares every var(--x) it uses in the light :root block, and no colour inside <svg>", () => {
    const light = block(styleOf(ringsHtml), ":root {");
    const used = new Set([...ringsHtml.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]));
    for (const u of used) expect(light[u], u).toBeDefined();
    for (const svg of ringsHtml.match(/<svg[\s\S]*?<\/svg>/g)!) {
      expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b|fill="|stroke="|style="|oklch|rgb/i);
    }
  });
  it("copies its tokens from apps/lab/src/tokens.css", () => {
    const tokens = readFileSync(new URL("../../apps/lab/src/tokens.css", import.meta.url), "utf8");
    const light = block(tokens, ":root {");
    const dark = block(tokens, `:root[data-theme="dark"]`);
    for (const [k, v] of Object.entries(LIGHT_TOKENS)) expect(v, k).toBe(light[k]);
    for (const [k, v] of Object.entries(DARK_TOKENS)) expect(v, k).toBe(dark[k]);
    // Every light colour the page copies that the site also darkens is darkened here too.
    for (const k of Object.keys(LIGHT_TOKENS)) if (dark[k] !== undefined) expect(DARK_TOKENS[k], k).toBe(dark[k]);
  });
  it("is deterministic", () => {
    expect(renderNotebook(sampleModel("rings"))).toBe(ringsHtml);
  });
  it("draws values near the double's limits without NaN, and stops on a coordinate that is not finite", () => {
    // Codex pass 2: finite values spanning about ±1.4e308 overflowed hi − lo; the projection now halves first.
    const m = structuredClone(rings);
    const note = m.entries[0].notes[0];
    note.picture = note.picture.map((b, i) => ({ ...b, lo: i % 2 ? -1.4e308 : 1.4e308, hi: 1.4e308, median: 0, bandLo: -1.4e308, bandHi: 1.4e308 }));
    const html = renderNotebook(m);
    expect(html).not.toMatch(/NaN|Infinity/);
    note.picture[0] = { ...note.picture[0], median: NaN };
    expect(() => renderNotebook(m)).toThrow(/STOP: a picture coordinate came out NaN/);
  });
  it("escapes what it prints", () => {
    const m = sampleModel("quiet");
    m.run.id = `a<b&c">`;
    m.meta.sources[0].path = `/x/<y>`;
    const h = renderNotebook(m);
    expect(h).toContain("a&lt;b&amp;c&quot;&gt;");
    expect(h).not.toContain(`a<b&c">`);
    expect(h).toContain("/x/&lt;y&gt;");
    // Every string the bundle, the record or the command line puts on the page.
    for (const kind of ["quiet", "rings"] as const) {
      const p = sampleModel(kind);
      const bad = (k: string) => `<i data-k="${k}">`;
      for (const k of ["experiment", "preset", "condition", "presetIdentity", "id"] as const) (p.run as Record<string, unknown>)[k] = bad(k);
      p.run.envelopeIds = [bad("envelopeIds")];
      for (const k of ["generated", "recordPath", "recordSha256", "base"] as const) p.meta[k] = bad(k);
      p.meta.sources.forEach((x) => (x.path = bad("source")));
      p.meta.envelopeSources.forEach((x) => (x.path = bad("envelopeSource")));
      p.firstPage.zStars = { [bad("zStars")]: 1 };
      p.firstPage.falseAlarmSignals = p.firstPage.falseAlarmSignals.map((f) => ({ ...f, label: bad("label") }));
      const out = renderNotebook(p);
      expect(out).not.toContain("<i data-k");
      expect(out).toContain("&lt;i data-k=&quot;experiment&quot;&gt;");
    }
    // Record numbers are escaped too, whatever reaches the model.
    const m2 = sampleModel("quiet");
    (m2.firstPage.falseAlarms as { Z: unknown }).Z = "<script>";
    expect(renderNotebook(m2)).not.toContain("<script>");
  });
});

describe("words", () => {
  it("never says event or discovery, and uses only four chips", () => {
    for (const h of pages) {
      expect(h).not.toMatch(/\bevent/i);
      expect(h).not.toMatch(/\bdiscover/i);
      expect(h).not.toMatch(/\bConfirmed\b|\bSeen\b/);
      const chips = [...h.matchAll(/<span class="state (\w+)">([^<]+)<\/span>/g)].map((m) => [m[1], m[2]]);
      expect(chips.length).toBeGreaterThan(3);
      for (const [cls, text] of chips) {
        expect(["Measured", "Negative", "Unclear", "Not yet measured"]).toContain(text);
        expect(cls).toBe({ Measured: "measured", Negative: "negative", Unclear: "pending", "Not yet measured": "pending" }[text]);
      }
    }
  });
  it("puts the record's numbers on the first page, with their chips", () => {
    const first = ringsHtml.slice(ringsHtml.indexOf(`<section class="first">`), ringsHtml.indexOf("</section>"));
    expect(first).toMatch(/state negative">Negative<\/span><span>At Z = 4, W = 50 the bell rings on drift: 30 of 70 neutral runs rang there\./);
    expect(first).toMatch(/state measured">Measured<\/span><span>Thresholds calibrated .* 1 of 30 held-out neutral runs scored above them, about 1\.4 expected \(Z\*: gradient-m3 7\.04, spots-m3 11\.47\)/);
    expect(first).toMatch(/state pending">Not yet measured<\/span><span>That the bell hears something arise inside a single run\./);
    expect(first).toContain("rings only at the calibrated threshold");
  });
  it("says on the first page, and in the run section, that a ringing neutral run is a false alarm", () => {
    expect(heldOut.run.falseAlarm).toBe("held-out");
    expect(heldOut.rings).toBeGreaterThan(0);
    const line = "This is one of the bell’s 30 held-out neutral runs, so every note below is a false alarm of the bell by definition: it is one of the 1 of 30 held-out neutral runs that scored above Z*.";
    expect(firstOf(heldOutHtml)).toContain(`<p><b>${line}</b></p>`);
    const run = heldOutHtml.slice(heldOutHtml.indexOf("<h2>The run</h2>"), heldOutHtml.indexOf("<h2>Across the run</h2>"));
    expect(run).toContain(`<p>${line}</p>`);
    expect(neutralOutside.run.falseAlarm).toBe("neutral");
    expect(firstOf(renderNotebook(neutralOutside))).toContain("every note below is the bell ringing on neutral dynamics alone");
    // Not on a treatment page, not on a quiet neutral page, not on a calibration page.
    for (const h of [ringsHtml, quietHtml, renderNotebook(sampleModel("calibration"))]) expect(h).not.toMatch(/false alarm of the bell by definition|neutral dynamics alone;/);
  });
  it("attributes the step-10,000 finding to the corpus at Z = 4, not to the run", () => {
    for (const h of pages) {
      const f = firstOf(h);
      expect(f).toContain("In the bell’s readout, at Z = 4 and W = 50, 14 of the 15 treatment and no-mutation runs of the bell corpus rang from step 10,000, the first census counted");
      expect(f).not.toMatch(/already stand outside the neutral runs at step/);
      expect(f).toContain("it is not when anything started");
    }
    expect(cannotTell(rings)[1]).toMatch(/^In the bell’s readout, at Z = 4/);
  });
  it("files notes under where their first stretch begins, and says that is not an onset", () => {
    expect(ringsHtml).toContain("<h3>First stretches from step 15,100</h3>");
    expect(ringsHtml).toContain("<h3>First stretch from step 30,100</h3>");
    expect(ringsHtml).toContain("That step is not an onset");
    expect(ringsHtml).not.toMatch(/Outside (together )?from step/);
  });
  it("takes the cannot-tell numbers from the model, not from the page's text", () => {
    const m = sampleModel("rings");
    m.firstPage.calibRuns = 19;
    m.firstPage.falseAlarmSignals = [{ signal: "fusions", label: "Fusions", side: "low", runs: 3 }];
    m.firstPage.armsFromBurnIn = { k: 2, of: 9 };
    const list = cannotTell(m).join(" ");
    expect(list).toContain("Z* is the largest of 19 calibration scores");
    expect(list).toContain("the 30 neutral runs that rang did so on fusions, low side (3 runs)");
    expect(list).toContain("2 of the 9 treatment and no-mutation runs");
    expect(cannotTell(rings)[3]).toContain("did so on deepest generation, high side (20 runs), largest lineage’s share, high side (16 runs) and fissions, high side (1 run)");
  });
  it("prints every receipt number", () => {
    for (const en of rings.entries)
      for (const n of en.notes) {
        const r = n.receipt;
        expect(ringsHtml).toContain(`step ${group(r.startStep)} to step ${group(r.endStep)}`);
        expect(ringsHtml).toContain(`>${r.minAbsZ}<`);
        expect(ringsHtml).toContain(`>${r.value}<`);
        expect(ringsHtml).toContain(`>${r.median}<`);
        expect(ringsHtml).toContain(n.sentence);
      }
    expect(ringsHtml).toContain(`>${rings.run.zStar}<`);
    expect(ringsHtml).toContain("120 files, 240,000 bytes in all");
    expect(ringsHtml).toContain("runs/replay-m4/gradient-m3/neutral/seed-20/lineages.tsv (3,000 bytes)");
  });
  it("gives a quiet page its 26 D values and Not yet measured on nothing going on", () => {
    const table = quietHtml.slice(quietHtml.indexOf("Every signal against Z*"), quietHtml.indexOf("What this cannot tell you"));
    const rows = [...table.matchAll(/<tr><td>/g)];
    expect(rows.length).toBe(26);
    for (const q of quiet.quiet) {
      expect(table).toContain(`<td class="num">${fmtZ(q.D)}</td><td class="num">${fmtZ(q.gap)}</td><td>quiet</td>`);
    }
    expect(quietHtml).toMatch(/Not yet measured<\/span><span>That nothing is going on in this run/);
    expect(quietHtml).toContain("did not ring");
  });
  it("keeps the note's section order", () => {
    const order = [`<section class="first">`, "<h2>The run</h2>", "<h2>Across the run</h2>", "<h2>Notes</h2>", "<h2>Every signal against Z*</h2>", "<h2>What this cannot tell you</h2>", "<h2>Receipts</h2>"];
    for (const h of pages) {
      const at = order.map((s) => h.indexOf(s));
      expect(at.every((x) => x >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    }
  });
  it("says all seven things it cannot tell you", () => {
    const list = cannotTell(rings);
    expect(list.length).toBe(7);
    const text = bodyText(ringsHtml).replace(/\s+/g, " ");
    for (const s of list) expect(text).toContain(s.replace(/\s+/g, " "));
    expect(list.join(" ")).toContain("1 of 30 neutral runs");
    expect(list.join(" ")).toMatch(/twin/);
  });
  it("prose is in British spelling with curly quotes", () => {
    for (const h of pages) {
      const text = bodyText(h);
      expect(text).not.toMatch(/\b(behavior|color|center|favor)\b/i);
      expect(text).not.toMatch(/'/);
    }
  });
});
