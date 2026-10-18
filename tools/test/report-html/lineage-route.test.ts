// The pond route in the lineage panel (tools/lib/report-html/lineage-route.ts; docs/lineage-inspector.md section 8,
// "Route panel"). Dossiers come through the real builder and a JSON round trip, as `tools/lineage.ts --out` writes
// them: the two runner bundles kept in tools/test/fixtures/pond-runner/ (real GPU runs), and hand-built pond
// bundles (tools/test/pond-bundle-fixture.ts) for the paths real runs never produced (not excluded, not recorded,
// a continuation gap). Malformed routes are spliced into a real dossier's JSON.
import { readFileSync } from "node:fs";
import { RULE_VERSION } from "@bl/schema";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDossier, initialGenomes, wordsHex, type BundleSource } from "../../lib/lineage.ts";
import { readPickLog } from "../../lib/pond-descent.ts";
import { packetGenotype, runnerPondHistory } from "../../lib/pond-bundle.ts";
import { parsePondRows, pondDossier } from "../../lib/pond-lineage.ts";
import { render, validate, type GenotypeInput, type LineageInput } from "../../lib/report-html/lineage.ts";
import { LABEL_GAP, labelWidth, lineFit, ordinal, quoteName, routeEvents } from "../../lib/report-html/lineage-route.ts";
import { escapeHtml, figure } from "../../lib/report-html/page.ts";
import { num } from "../../lib/report-html/svg.ts";
import { rows } from "../lineage-fixture.ts";
import { birthsLines, founder, handPondBundle, key, pondsLines, type HandCycle } from "../pond-bundle-fixture.ts";
import { assertPageContract } from "./contract.ts";

const meta = { sources: [{ path: "dossier.json", sha256: "ab".repeat(32) }], status: "SMOKE" as const };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length;
const renderChecked = (data: unknown): string => {
  validate(data);
  return render(data as LineageInput, meta);
};
const dossier = async (src: BundleSource, rule: Parameters<typeof buildDossier>[1], opts?: Parameters<typeof buildDossier>[2]): Promise<GenotypeInput> =>
  clone({ ...(await buildDossier(src, rule, opts)), twin: null });
/** The route figure's SVG alone. */
const routeSvg = (html: string): string => {
  const at = html.indexOf('aria-label="Pond route:');
  return at < 0 ? "" : html.slice(at, html.indexOf("</svg>", at));
};
/** The route's solid line: every `<line>` drawn in ink (lanes use --rule, ticks and gaps --muted). */
const inkLines = (svg: string): string[] => svg.match(/<line [^>]*stroke="var\(--ink\)"[^>]*\/>/g) ?? [];
/** Each drawn crossing label's [x0, x1] extent, left to right. */
const labelSpans = (svg: string): [number, number][] => [...svg.matchAll(/data-crossing-label="([\d.-]+) ([\d.-]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
/** The table cells of one row, escaped as the page writes them. */
const cells = (...cs: string[]): string => cs.map((c) => `<td>${escapeHtml(c)}</td>`).join("");

const FIXTURES = new URL("../fixtures/pond-runner/", import.meta.url);
const lines = (dir: string, f: string): string[] | null => {
  try {
    return readFileSync(new URL(`${dir}/${f}`, FIXTURES), "utf8").split("\n");
  } catch {
    return null;
  }
};
function real(dir: string): BundleSource & { manifest: any } {
  const manifest = JSON.parse(lines(dir, "manifest.json")!.join("\n"));
  // As in tools/test/pond-bundle.test.ts: a deliberate rule change makes the fixture stale, not the route wrong.
  if (manifest.ruleVersion !== RULE_VERSION) throw new Error(`tools/test/fixtures/pond-runner/${dir} was recorded under rule ${manifest.ruleVersion}, this is rule ${RULE_VERSION}: re-record the fixture`);
  return { dir, manifest, open: (f) => (lines(dir, f) ? rows(lines(dir, f)!) : null) };
}

let scaf: GenotypeInput, cont: GenotypeInput, contFounder: GenotypeInput;
beforeAll(async () => {
  scaf = await dossier(real("scaf-picked"), { kind: "top" });
  cont = await dossier(real("cont"), { kind: "key", key: "5563:4880" });
  contFounder = await dossier(real("cont"), { kind: "top" });
}, 300_000);

describe("pond route on real runner bundles", () => {
  it("scaf-picked (real): three named crossings with share and picker", () => {
    expect(scaf.chain.map((c) => c.key)).toEqual(["0:4", "759:12506", "3282:4258", "3539:4645"]);
    const html = renderChecked(scaf);
    assertPageContract(html, { status: "SMOKE", figureCount: 5 });
    expect(html).toContain("Pond route<span class=\"evidence evidence-exact\">exact</span></h2>");
    expect(html).toContain('aria-label="Pond route: 4 lineages from root 0:4 to subject 3539:4645, 3 packet crossings (1 changing pond), 4 ponds"');
    expect(count(html, /data-event="crossing" data-carried="named"/g)).toBe(3);
    expect(count(html, /data-event="crossing"/g)).toBe(3);
    expect(count(html, /data-event="mutation"/g)).toBe(3);
    for (const label of ["named 98.9%", "named 100.0%", "named 94.2%"]) expect(html).toContain(`>${label}</text>`);
    expect(html).toContain(cells("crossing (same pond)", "1,000", "boundary 1", "3 → 3", "759:12506", "named (2 lineages in the packet)", "98.9%", '"random"', "exact"));
    expect(html).toContain(cells("crossing", "2,000", "boundary 2", "3 → 0", "759:12506", "named (1 lineage in the packet)", "100.0%", '"random"', "exact"));
    expect(html).toContain(cells("crossing (same pond)", "3,000", "boundary 3", "0 → 0", "759:12506", "named (2 lineages in the packet)", "94.2%", '"random"', "exact"));
    expect(html).toContain("3 packet crossings on this route (1 changing pond; at the other 2 the pond is its own donor): 3 named, 0 not excluded, 0 not recorded. Picked by &quot;random&quot; at all 6 logged boundaries.");
    expect(count(routeSvg(html), />by &quot;random&quot;<\/text>/g)).toBe(3);
    // The marks are defined in words on the page, and the share is said to be one of matter.
    expect(html).toContain("named, the packet&#39;s dominant lineage is this ancestor, labelled with that lineage&#39;s share of the packet&#39;s B+P (a share of matter, not a confidence)");
    expect(html).toContain('<dt>Pick log (picks.jsonl): lines, boundaries checked, pickers</dt><dd>6 lines, 6 checked; &quot;random&quot; 6<span class="evidence evidence-exact">');
    expect(html).toContain('<dt>Packet crossings: named / not excluded / not recorded</dt><dd>3 / 0 / 0<span class="evidence evidence-exact">');
    expect(html).not.toMatch(/HTML panel does not draw/);
    // The route section follows the ancestry figure.
    expect(html.indexOf("<h2>Ancestry and mutations")).toBeLessThan(html.indexOf("<h2>Pond route"));
    expect(html.indexOf("<h2>Pond route")).toBeLessThan(html.indexOf("<h2>Population"));
  });

  it("cont (real): mutations in one pond across cycles, no crossing marks, no picker row", () => {
    const html = renderChecked(cont);
    assertPageContract(html, { status: "SMOKE", figureCount: 5 });
    expect(count(html, /data-event="mutation"/g)).toBe(4);
    expect(count(html, /data-event="crossing"/g)).toBe(0);
    expect(html).toContain("There is no packet crossing on this route.");
    expect(html).toContain("In arm cont the route records no packet between ponds, so the line keeps to its pond.");
    expect(html).not.toContain("reseeded");
    expect(html).toContain("<dt>Pick log (picks.jsonl)</dt><dd>n/a (arm cont takes no picked donors)</dd>");
    expect(routeEvents(cont).events.filter((e) => e.kind === "mutation").map((e) => [e.at.lane, (e as { cycle: number }).cycle])).toEqual([[0, 2], [0, 3], [0, 5], [0, 6]]);
  });

  it("cont founder subject: the founder mark in its pond's lane and a single root row", () => {
    expect(contFounder.chain.map((c) => c.key)).toEqual(["0:1"]);
    const html = renderChecked(contFounder);
    assertPageContract(html, { status: "SMOKE", figureCount: 5 });
    const L = routeEvents(contFounder);
    expect(L.events).toMatchObject([{ kind: "root", at: { step: 0, lane: 0 } }]);
    expect(count(html, /data-event="root"/g)).toBe(1);
    expect(count(html, /<td>root<\/td>/g)).toBe(1);
    expect(count(html, /<td>mutation<\/td>/g)).toBe(0);
  });

  it("anchored packet genotype: an anchor mark and its table row", async () => {
    const src = real("scaf-picked");
    const h = runnerPondHistory(parsePondRows(lines("scaf-picked", "ponds.tsv")!), src.manifest, { hasMutations: true, picks: readPickLog(lines("scaf-picked", "picks.jsonl")!) });
    const t = packetGenotype(pondDossier(h, { kind: "top" }), h);
    const g = await dossier(src, { kind: "key", key: t.lineage }, { step: t.step, pondAnchor: t.anchor });
    expect(g.pond!.anchor.source).toBe("given");
    const html = renderChecked(g);
    assertPageContract(html, { status: "SMOKE", figureCount: 5 });
    expect(count(html, /data-anchor=""/g)).toBe(1);
    expect(html).toContain(`<td>${escapeHtml(`anchor (pond ${t.anchor.pond}, cycle ${t.anchor.cycle})`)}</td><td>${(t.anchor.cycle * 1000).toLocaleString("en-US")}</td>`);
    const last = routeEvents(g).events.at(-1)!;
    expect(last).toMatchObject({ kind: "anchor", at: { step: t.anchor.cycle * 1000, lane: t.anchor.pond } });
  }, 300_000);
});

describe("pond route on hand-built bundles", () => {
  // 0:2 (founder of pond 1) -> A (pond 2, cycle 2) -> B (pond 0, cycle 3); boundary 1 carries 0:2 from pond 1 to 2,
  // boundary 2 carries A from pond 2 to 0.
  const A = key(150, 2), B = key(250, 0);
  const cycles = (b1: HandCycle["packets"]): HandCycle[] => [
    { donors: [1, 3, 1, 3], packets: b1 },
    { donors: [2, 2, 2, 2], packets: [{ lineages: 2, dom: A }] },
  ];
  const bundle = (ponds: string[]) =>
    handPondBundle({ mutations: [[A, founder(1)], [B, A]], ponds, census: { 250: [[A, 5], [B, 3]] }, steps: 250, births: birthsLines([[200, "budding", A, B]]) });

  it("mixed packet: a crossing drawn as not excluded", async () => {
    const d = await dossier(bundle(pondsLines(cycles([{ lineages: 2, dom: founder(1) }, undefined, { lineages: 2, dom: "7:7" }]))), { kind: "key", key: B });
    expect(d.pond!.crossings).toEqual({ named: 1, notExcluded: 1, notRecorded: 0 });
    const html = renderChecked(d);
    assertPageContract(html, { status: "SMOKE", figureCount: 5 });
    expect(count(html, /data-carried="not-excluded"/g)).toBe(1);
    expect(count(html, /data-carried="named"/g)).toBe(1);
    // Each class has its own shape: filled for named, hollow (accent stroke) for not excluded.
    expect(html).toMatch(/data-carried="named"><polygon points="[^"]+" fill="var\(--pass\)" \/><\/g>/);
    expect(html).toMatch(/data-carried="not-excluded"><polygon points="[^"]+" fill="var\(--panel\)" stroke="var\(--accent\)" stroke-width="1.6" \/><\/g>/);
    expect(routeSvg(html)).toContain(">not excluded (2)</text>");
    expect(html).toContain(cells("crossing", "100", "boundary 1", "1 → 2", founder(1), "not excluded (2 lineages in the packet)", "", "not recorded", "exact"));
    // No pick log in a donor arm: the picker is not recorded, never guessed.
    expect(html).toContain("Picker: not recorded (the bundle has no picks.jsonl).");
  }, 120_000);

  it("no domHi/domLo: crossings not recorded, and the key number says so", async () => {
    const strip = (ls: string[]) => {
      const keep = ls[0].split("\t").flatMap((c, i) => (c === "domHi" || c === "domLo" ? [] : [i]));
      return ls.map((l) => keep.map((i) => l.split("\t")[i]).join("\t"));
    };
    const d = await dossier(bundle(strip(pondsLines(cycles([{ lineages: 2, dom: founder(1) }, undefined, { lineages: 1, dom: founder(1) }])))), { kind: "key", key: B });
    expect(d.pond!.crossings).toEqual({ named: 0, notExcluded: 0, notRecorded: 2 });
    const html = renderChecked(d);
    assertPageContract(html, { status: "SMOKE", figureCount: 5 });
    expect(count(html, /data-carried="not-recorded"><rect [^>]*stroke-dasharray="2,1.5" \/><text [^>]*>\?<\/text><\/g>/g)).toBe(2);
    expect(html).toContain('<dt>Packet crossings: named / not excluded / not recorded</dt><dd>0 / 0 / 2<span class="evidence evidence-missing">not recorded</span>');
    expect(html).toContain("<td>not recorded (1 lineage in the packet, no dominant columns)</td>");
    // The walks themselves landed: the section stays exact; the packet class is shown on the marks, not in the chip.
    expect(html).toContain('Pond route<span class="evidence evidence-exact">exact</span></h2>');
  }, 120_000);

  it("continuation bundle: a dashed gap and the reason verbatim", async () => {
    const P0 = key(150, 2), Q = key(320, 0);
    const late = handPondBundle({ startStep: 200, mutations: [[Q, P0]], ponds: pondsLines([{ donors: [2, 2, 2, 2], packets: [{ lineages: 1, dom: P0 }] }], { first: 3 }), census: { 350: [[Q, 4]] }, steps: 350 });
    // P0 was minted before the bundle: its genome comes from genomes.tsv (here, a founder's words from a step-0 bundle).
    late.files["genomes.tsv"] = ["lineage\tfirstStep\twords", `${P0}\t150\t${wordsHex(initialGenomes(bundle([]).manifest)!.get(founder(2))!)}`];
    const d = await dossier(late, { kind: "key", key: Q });
    const e = d.pond!.edges[0];
    expect(e.status).toBe("not recorded");
    const html = renderChecked(d);
    assertPageContract(html, { status: "SMOKE", figureCount: 5 });
    expect(count(html, /data-gap=""><line [^>]*stroke="var\(--muted\)" stroke-width="1.6" stroke-dasharray="4,3" \/>/g)).toBe(1);
    // The dashed stretch is not also drawn solid.
    expect(routeEvents(d).segments.filter((s) => s.dashed)).toHaveLength(1);
    expect(inkLines(routeSvg(html))).toHaveLength(routeEvents(d).segments.length - 1);
    expect(html).toContain(">route not recorded</text></g>");
    expect(html).toContain(`<td>${escapeHtml(e.reason!)}</td>`);
    expect(html).toContain('Pond route<span class="evidence evidence-missing">not recorded</span></h2>');
    // The dashed stretch runs from the root's mint step in its birth pond to the first recorded boundary.
    expect(routeEvents(d).events.map((ev) => ev.kind)).toEqual(["root", "gap", "crossing", "mutation"]);
    expect(routeEvents(d).events[1]).toMatchObject({ from: { step: 149, lane: 2 }, to: { step: 300, lane: 2 } });
  }, 120_000);
});

describe("pond route layout, validation and escaping", () => {
  it("64 ponds: only the lanes the route touches", () => {
    const d = clone(scaf);
    d.pond!.ponds = 64;
    const html = renderChecked(d);
    assertPageContract(html, { status: "SMOKE", figureCount: 5 });
    expect(html).toContain("2 of 64 ponds shown");
    expect(count(html, /data-lane="/g)).toBe(2);
    expect(html).toContain('data-lane="0"');
    expect(html).toContain('data-lane="3"');
  });

  it("geometry: the scaf-picked route's line, step for step, at the figure's coordinates", () => {
    // Independently of routeEvents: 0:4 from step 0 in pond 3 (where its walk lands) to 759:12506's mint at 758 in
    // pond 3; boundaries 1 (3 -> 3), 2 (3 -> 0) and 3 (0 -> 0); 3282:4258 minted at 3281 in pond 0; 3539:4645 at 3538.
    const route: [number, number][][] = [
      [[0, 3], [758, 3]],
      [[758, 3], [1000, 3]],
      [[1000, 3], [2000, 3]],
      [[2000, 3], [2000, 0]],
      [[2000, 0], [3000, 0]],
      [[3000, 0], [3281, 0]],
      [[3281, 0], [3538, 0]],
    ];
    expect(routeEvents(scaf).segments).toEqual(route.map(([[s0, l0], [s1, l1]]) => ({ from: { step: s0, lane: l0 }, to: { step: s1, lane: l1 }, dashed: false })));
    // The SVG: x over [0, 6000] onto [210, 924], lanes 30 apart from y 91 (pond 0 on top).
    const X = (step: number) => num(210 + (714 * step) / 6000), Y = (lane: number) => num(91 + 30 * lane);
    const svg = routeSvg(renderChecked(scaf));
    expect(inkLines(svg)).toEqual(route.map(([[s0, l0], [s1, l1]]) => `<line x1="${X(s0)}" x2="${X(s1)}" y1="${Y(l0)}" y2="${Y(l1)}" stroke="var(--ink)" stroke-width="1.6" />`));
    // Marks sit on the line: the root, each crossing on its recipient's lane, each mutation at its mint step.
    expect(svg).toContain(`<g data-event="root"><polygon points="${X(0)},${num(181 - 4.5)} `);
    for (const [step, lane] of [[1000, 3], [2000, 0], [3000, 0]]) expect(svg).toContain(`data-carried="named"><polygon points="${X(step)},${num(91 + 30 * lane - 5.5)} `);
  });

  /**
   * scaf-picked re-timed to period P, kept as pondRoute would write it: birth cycles ceil(hi / P), and in arm scaf a
   * named crossing at every boundary each walk passes (the parent's pond to the child's, then the child's to itself).
   * Its crossings number ceil(3539 / P) - 1: 35 at P 100, 13 at P 260, 12 at P 280.
   */
  const withPeriod = (P: number): GenotypeInput => {
    const d = clone(scaf);
    const r = d.pond!;
    r.period = P;
    for (const b of r.births) b.cycle = Math.ceil(Number(b.key.split(":")[0]) / P);
    r.anchor.cycle = r.births[r.births.length - 1].cycle;
    r.edges.forEach((e, i) => {
      e.start.cycle = r.births[i + 1].cycle;
      e.end = r.births[i].cycle;
      e.crossings = [];
      for (let b = Math.max(1, e.end); b < e.start.cycle; b++)
        e.crossings.push({ boundary: b, step: b * P, from: e.crossings.length ? e.start.pond : r.births[i].ponds![0], to: e.start.pond, carried: "named", share: 0.5, packetLineages: 1, by: "random" });
    });
    r.crossings = { named: r.edges.reduce((n, e) => n + e.crossings.length, 0), notExcluded: 0, notRecorded: 0 };
    return d;
  };
  /** Labels never overlap: each starts at least 6 units (the rule's gap, written here, not read) past the one before. */
  const expectClear = (spans: [number, number][]) => {
    expect(LABEL_GAP).toBe(6);
    spans.forEach(([x0, x1], i) => {
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThanOrEqual(960 - 36);
      if (i) expect(x0).toBeGreaterThanOrEqual(spans[i - 1][1] + 6);
    });
  };

  it("labels are placed where they fit, never over each other; the table keeps every crossing", () => {
    for (const [P, crossings] of [[100, 35], [260, 13], [280, 12]] as const) {
      const html = renderChecked(withPeriod(P));
      assertPageContract(html, { status: "SMOKE", figureCount: 5 });
      const svg = routeSvg(html);
      expect(count(svg, /data-event="crossing"/g)).toBe(crossings);
      expect(count(html, /<td>crossing(?: \(same pond\))?<\/td>/g)).toBe(crossings);
      const spans = labelSpans(svg);
      expect(spans.length).toBeGreaterThan(0);
      expect(spans.length).toBeLessThan(crossings);
      expectClear(spans);
      expect(html).toContain(`Labels sit on ${spans.length} of the ${crossings} crossings, where they fit.`);
      // Every label line is set in the monospace stack its width bound assumes.
      expect(count(svg, /<text [^>]*style="font-family:var\(--font-mono\)">/g)).toBe(2 * spans.length);
    }
    // The route keeps its text near 9px on a phone: at least 860px wide, in a named box keyboard users can scroll.
    const page = renderChecked(scaf);
    expect(page).toContain('aria-label="Pond route:');
    expect(page).toMatch(/<svg [^>]*aria-label="Pond route:[^"]*" style="min-width:860px">/);
    expect(page).toMatch(/<div class="fig-media" role="region" tabindex="0" aria-label="Figure \d+, pond route \(scrolls sideways on a narrow screen; the table below holds every event\)">\s*<svg [^>]*aria-label="Pond route:/);
    expect(count(page, /<div class="fig-media" role="region"/g)).toBe(1);
    // 60 boundary ticks over 6,000 steps, every third numbered, and the caption says so (in the route SVG, cycle
    // labels are the only middle-anchored 10px numbers).
    const cycleLabels = (h: string) => count(routeSvg(h), /font-size="10" text-anchor="middle">\d+<\/text>/g);
    const html = renderChecked(withPeriod(100));
    expect(count(routeSvg(html), /data-boundary="/g)).toBe(60);
    expect(cycleLabels(html)).toBe(20);
    expect(html).toContain("a tick at every pond boundary (boundary c at step c × 100), numbered at every 3rd.");
    expect(cycleLabels(renderChecked(scaf))).toBe(6);
    expect(renderChecked(scaf)).not.toContain("Labels sit on");
  });

  it("past 200 boundaries the ticks thin too, always on a drawn tick", () => {
    const html = renderChecked(withPeriod(10));
    const svg = routeSvg(html);
    // 600 boundaries: a tick at every 3rd (200), numbered at every 30th (20), the last at boundary 600.
    expect(count(svg, /data-boundary="/g)).toBe(200);
    expect(svg).toContain('data-boundary="600"');
    expect(svg).not.toContain('data-boundary="1"');
    expect(count(svg, /font-size="10" text-anchor="middle">\d+<\/text>/g)).toBe(20);
    expect(html).toContain("a tick at every 3rd pond boundary (boundary c at step c × 10), numbered at every 30th.");
    expect(["1", "2", "3", "4", "11", "12", "13", "21", "22", "23", "101", "111", "112", "113"].map((k) => ordinal(Number(k)))).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th", "113th"]);
  });

  it("boundary ticks stop at the run's last boundary, not at the axis's rounded end", () => {
    const d = withPeriod(100);
    d.provenance.finalCensus = 5950;
    for (const c of d.chain) if (c.lastSeen !== null && c.lastSeen > 5950) c.lastSeen = 5950;
    d.population.steps = d.population.steps.map((s) => Math.min(s, 5950));
    const svg = routeSvg(renderChecked(d));
    expect(count(svg, /data-boundary="/g)).toBe(59);
    expect(svg).not.toContain('data-boundary="60"');
  });

  it("a label near the right edge flips to the left of its mark", () => {
    // The last crossing (boundary 3 at step 3,510 of an axis to 4,000) has a label too wide for the space to its right.
    const d = withPeriod(1170);
    d.provenance.finalCensus = 3540;
    for (const c of d.chain) c.lastSeen = c.minted;
    const all = d.pond!.edges.flatMap((e) => e.crossings);
    expect(all.map((c) => c.step)).toEqual([1170, 2340, 3510]);
    all[2].by = "night-garden";
    d.pond!.picks!.by = { random: 5, "night-garden": 1 };
    const svg = routeSvg(renderChecked(d));
    const spans = labelSpans(svg);
    expectClear(spans);
    expect(spans).toHaveLength(3);
    expect(count(svg, /text-anchor="end" style="font-family:var\(--font-mono\)">by &quot;night-garden&quot;<\/text>/g)).toBe(1);
    expect(count(svg, /text-anchor="end" style="font-family:var\(--font-mono\)">named 50.0%<\/text>/g)).toBe(1);
    // A flipped label outside the monospace face is held to its allotment too (Codex pass 4 P1).
    const wide = "﷽".repeat(6);
    all[2].by = wide;
    d.pond!.picks!.by = { random: 5, [wide]: 1 };
    const svg2 = routeSvg(renderChecked(d));
    expectClear(labelSpans(svg2));
    expect(labelSpans(svg2)).toHaveLength(3);
    const fit = `textLength="${num(5 * 6.2 + 6 * 12.4)}" lengthAdjust="spacingAndGlyphs"`;
    expect(svg2).toContain(` text-anchor="end" style="font-family:var(--font-mono)" ${fit}>by &quot;${wide}&quot;</text>`);
  });

  describe("pick log wording", () => {
    const withPicks = (edit: (d: GenotypeInput) => void): string => {
      const d = clone(scaf);
      edit(d);
      return renderChecked(d);
    };
    const crossings = (d: GenotypeInput) => d.pond!.edges.flatMap((e) => e.crossings);

    it("a boundary missing from the log is said to be missing, and the log's gaps reach the key number", () => {
      const html = withPicks((d) => {
        Object.assign(d.pond!.picks!, { checked: 4, partial: 1, unchecked: 1, unlogged: 2, torn: true });
        crossings(d)[1].by = null;
      });
      expect(html).toContain("Pick log tally: &quot;random&quot; 6; each crossing names its own picker. 2 boundaries in ponds.tsv are not in the log.");
      expect(html).toContain('<dt>Pick log (picks.jsonl): lines, boundaries checked, pickers</dt><dd>6 lines, 4 checked, 1 partly, 1 without rows, 2 not logged, torn last line dropped; &quot;random&quot; 6<span class="evidence evidence-missing">not recorded</span>');
      expect(html).toContain(cells("crossing", "2,000", "boundary 2", "3 → 0", "759:12506", "named (1 lineage in the packet)", "100.0%", "not in the pick log", "exact"));
      expect(count(routeSvg(html), />not in the pick log<\/text>/g)).toBe(1);
      expect(html).not.toContain("Picked by &quot;random&quot; at all");
    });

    it("an unnamed line with boundaries missing: the crossing says either may hold", () => {
      const html = withPicks((d) => {
        Object.assign(d.pond!.picks!, { unlogged: 1, by: { random: 5, unnamed: 1 } });
        crossings(d)[0].by = null;
      });
      expect(html).toContain('Pick log tally: &quot;random&quot; 5, &quot;unnamed&quot; 1; each crossing names its own picker. A line logged without a picker&#39;s name tallies as &quot;unnamed&quot;. 1 boundary in ponds.tsv is not in the log.');
      expect(html).toContain("<td>unnamed, or not in the pick log</td>");
    });

    it("several pickers: the tally, and each crossing its own", () => {
      const html = withPicks((d) => {
        d.pond!.picks!.by = { random: 4, gardener: 2 };
        crossings(d)[2].by = "gardener";
      });
      expect(html).toContain("Pick log tally: &quot;gardener&quot; 2, &quot;random&quot; 4; each crossing names its own picker.");
      expect(count(routeSvg(html), />by &quot;gardener&quot;<\/text>/g)).toBe(1);
      expect(count(routeSvg(html), />by &quot;random&quot;<\/text>/g)).toBe(2);
    });

    it("lines tallied unnamed are not read as no picker, whatever the crossings say (Codex P0)", () => {
      // A pick line without `by`: the crossing's own value is null.
      const nameless = withPicks((d) => {
        for (const c of crossings(d)) c.by = null;
        d.pond!.picks!.by = { unnamed: 6 };
      });
      expect(nameless).toContain("All 6 logged pick lines tally as &quot;unnamed&quot;: logged without a picker&#39;s name, or by a picker of that name.");
      expect(nameless).toContain("<td>no picker named in the pick log</td>");
      expect(nameless).not.toContain("not in the pick log");
      expect(nameless).not.toContain("No picker is named");
      // A picker literally called "unnamed": the crossings name it, and the lead does not deny it.
      const literal = withPicks((d) => {
        for (const c of crossings(d)) c.by = "unnamed";
        d.pond!.picks!.by = { unnamed: 6 };
      });
      expect(count(routeSvg(literal), />by &quot;unnamed&quot;<\/text>/g)).toBe(3);
      expect(literal).toContain("<td>&quot;unnamed&quot;</td>");
      expect(literal).not.toContain("No picker is named");
    });

    it("runner marks are said as either a mark or a picker of that name, never as one of them (Codex pass 2 P0)", () => {
      // A live picker may be named "none", "recorded" or "rule(implicit)": the log cannot tell it from the runner's mark.
      const cases = [
        ["recorded", "a recorded pick, replayed"],
        ["rule(implicit)", "the arm&#39;s own rule (no pick recorded, no picker)"],
        ["none", "no pond occupied"],
      ] as const;
      for (const [by, mark] of cases) {
        const html = withPicks((d) => {
          for (const c of crossings(d)) c.by = by;
          d.pond!.picks!.by = { [by]: 6 };
        });
        const either = `the runner&#39;s mark for ${mark}, or a picker of that name`;
        expect(html).toContain(`At all 6 logged boundaries the pick log says &quot;${by}&quot;: ${either}.`);
        expect(html).toContain(`<td>&quot;${by}&quot;: ${either}</td>`);
        // Each label drawn carries the mark quoted, as logged (a wide one may not fit at every crossing).
        const drawn = labelSpans(routeSvg(html)).length;
        expect(drawn).toBeGreaterThan(0);
        expect(count(routeSvg(html), new RegExp(`>by &quot;${by.replace(/[()]/g, "\\$&")}&quot;</text>`, "g"))).toBe(drawn);
        expect(html).not.toContain(`Picked by &quot;${by}`);
        expect(html).not.toContain("no one (no pond occupied)");
      }
      const none = withPicks((d) => (d.pond!.picks!.by = { none: 2, random: 4 }));
      expect(none).toContain("Pick log tally: &quot;none&quot; 2, &quot;random&quot; 4; each crossing names its own picker. &quot;none&quot; is the runner&#39;s mark for no pond occupied, or a picker of that name.");
      expect(none).toContain("6 lines, 6 checked; &quot;none&quot; 2, &quot;random&quot; 4");
    });

    it("a picker named like an Object property is a picker, not a runner mark", () => {
      for (const name of ["constructor", "toString", "__proto__"]) {
        const html = withPicks((d) => {
          for (const c of crossings(d)) c.by = name;
          d.pond!.picks!.by = JSON.parse(`{"${name}": 6}`);
        });
        expect(html).toContain(`Picked by &quot;${name}&quot; at all 6 logged boundaries.`);
        expect(count(routeSvg(html), new RegExp(`>by &quot;${name}&quot;</text>`, "g"))).toBe(3);
        expect(html).toContain(`<td>&quot;${name}&quot;</td>`);
        expect(html).not.toMatch(/undefined|runner&#39;s mark/);
      }
    });

    it("a long or wide picker name: the label clips it and bounds its width; the table keeps it whole", () => {
      const long = "a-very-long-picker-name-from-the-log";
      const html = withPicks((d) => {
        for (const c of crossings(d)) c.by = long;
        d.pond!.picks!.by = { [long]: 6 };
      });
      const spans = labelSpans(routeSvg(html));
      expect(spans.length).toBeGreaterThan(0);
      expectClear(spans);
      expect(count(routeSvg(html), />by &quot;a-very-long-picker-&quot;…<\/text>/g)).toBe(spans.length);
      expect(routeSvg(html)).not.toContain(long);
      expect(html).toContain(`<td>&quot;${long}&quot;</td>`);
      // A monospace advance per code point, doubled for wide scripts: 15 W's and four ideographs.
      expect(labelWidth(["by WWWWWWWWWWWWWWW"])).toBeCloseTo(18 * 6.2 + 4);
      expect(labelWidth(["by 庭師さん"])).toBeCloseTo(3 * 6.2 + 4 * 12.4 + 4);
    });

    it("every picker name is quoted and escaped, so different names never print alike (Codex pass 3 P1)", () => {
      // A picker literally named "none" with its quotes, beside the runner's mark none.
      const html = withPicks((d) => {
        const cs = crossings(d);
        cs[0].by = "none";
        cs[1].by = '"none"';
        cs[2].by = "none";
        d.pond!.picks!.by = { none: 4, '"none"': 2 };
      });
      expect(html).toContain("6 lines, 6 checked; &quot;\\&quot;none\\&quot;&quot; 2, &quot;none&quot; 4");
      expect(html).toContain("<td>&quot;\\&quot;none\\&quot;&quot;</td>");
      expect(html).toContain("<td>&quot;none&quot;: the runner&#39;s mark for no pond occupied, or a picker of that name</td>");
      expect(count(routeSvg(html), />by &quot;\\&quot;none\\&quot;&quot;<\/text>/g)).toBe(1);
      // Bidi and invisible controls are written out, never passed to the page.
      expect(quoteName("a\u202eb\u200bc\nd")).toBe('"a\\u202eb\\u200bc\\nd"');
      const bidi = withPicks((d) => {
        for (const c of crossings(d)) c.by = "evil\u202e";
        d.pond!.picks!.by = { "evil\u202e": 6 };
      });
      expect(bidi).not.toContain("\u202e");
      expect(bidi).toContain("Picked by &quot;evil\\u202e&quot; at all 6 logged boundaries.");
      // Names that would print alike: each unseen code point is written out, astral ones as \u{...} (Codex pass 4 P1).
      const pairs: [string, string][] = [
        ["a\u206ab", '"a\\u206ab"'],
        ["a\u206fb", '"a\\u206fb"'],
        ["a\u00a0b", '"a\\u00a0b"'],
        ["a\u3000b", '"a\\u3000b"'],
        ["a\u0085b", '"a\\u0085b"'],
        ["a\u2028b", '"a\\u2028b"'],
        ["a\ufe0fb", '"a\\ufe0fb"'],
        ["a\u3164b", '"a\\u3164b"'],
        ["a\u{e0041}b", '"a\\u{e0041}b"'],
        ["a\u{e0100}b", '"a\\u{e0100}b"'],
      ];
      for (const [name, printed] of pairs) expect(quoteName(name)).toBe(printed);
      expect(quoteName("a b")).toBe('"a b"');
      // A run of spaces collapses on the page: the second and later are written out.
      expect(quoteName("a  b")).toBe('"a \\u0020b"');
      expect(quoteName(" a   b ")).toBe('" a \\u0020\\u0020b "');
      expect(new Set(["ab", "a b", "a  b", ...pairs.map(([n]) => n)].map(quoteName)).size).toBe(pairs.length + 3);
      const hidden = withPicks((d) => {
        const cs = crossings(d);
        cs[0].by = "ab";
        cs[1].by = "a\u206ab";
        cs[2].by = "ab";
        d.pond!.picks!.by = { ab: 4, "a\u206ab": 2 };
      });
      expect(hidden).not.toContain("\u206a");
      expect(hidden).toContain("6 lines, 6 checked; &quot;ab&quot; 4, &quot;a\\u206ab&quot; 2");
      expect(hidden).toContain("<td>&quot;a\\u206ab&quot;</td>");
    });

    it("a label clips by code point and holds any glyph outside the monospace face to its allotment (Codex pass 3 P2)", () => {
      // Astral seedlings: the cut never splits a surrogate pair.
      const seed = "\u{1F331}".repeat(25);
      const html = withPicks((d) => {
        for (const c of crossings(d)) c.by = seed;
        d.pond!.picks!.by = { [seed]: 6 };
      });
      const svg = routeSvg(html);
      expect(svg).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      const line = `by "${"\u{1F331}".repeat(19)}"…`;
      expect(count(svg, new RegExp(`textLength="${num(5 * 6.2 + 20 * 12.4)}" lengthAdjust="spacingAndGlyphs">${escapeHtml(line)}</text>`, "g"))).toBe(labelSpans(svg).length);
      // A fallback glyph several em wide (U+0BF5, U+FDFD) is squeezed to 12.4 units; ASCII and Latin-1 lines are drawn as set.
      for (const ch of ["௵", "﷽"]) {
        const l = `by "${ch.repeat(20)}"`;
        expect(labelWidth([l])).toBeCloseTo(5 * 6.2 + 20 * 12.4 + 4);
        expect(lineFit(l)).toBe(` textLength="${num(5 * 6.2 + 20 * 12.4)}" lengthAdjust="spacingAndGlyphs"`);
      }
      expect(lineFit('by "Gärtnerin"')).toBe("");
      expect(lineFit("named 98.9%")).toBe("");
      expect(lineFit("by 庭師")).toBe(` textLength="${num(3 * 6.2 + 2 * 12.4)}" lengthAdjust="spacingAndGlyphs"`);
    });
  });

  it("a founder in several tiles starts where its walk lands; unknown tiles get their own lane", () => {
    const multi = clone(scaf);
    multi.pond!.births[0].ponds = [1, 3];
    const html = renderChecked(multi);
    expect(routeEvents(multi).events[0]).toMatchObject({ kind: "root", at: { step: 0, lane: 3 } });
    expect(html).toContain("<td>also in initial tile 1</td>");
    expect(html).toContain('Pond route<span class="evidence evidence-exact">exact</span></h2>');
    const unknown = clone(scaf);
    const r = unknown.pond!;
    r.births[0].ponds = null;
    r.edges[0].status = "not recorded";
    r.edges[0].reason = "0:4 is a founder and the initial world could not be rebuilt to the manifest's initHash, so its tiles are unknown";
    r.exact = 2;
    r.notRecorded = 1;
    const u = renderChecked(unknown);
    assertPageContract(u, { status: "SMOKE", figureCount: 5 });
    expect(routeEvents(unknown).lanes).toEqual(["unknown", 0, 1, 2, 3]);
    expect(routeEvents(unknown).events.slice(0, 2)).toMatchObject([{ kind: "root", at: { lane: "unknown" } }, { kind: "gap", from: { lane: "unknown" }, to: { step: 758, lane: 3 } }]);
    expect(u).toContain('data-lane="unknown"');
    expect(u).toContain(`<td>${escapeHtml(r.edges[0].reason)}</td>`);
    expect(u).toContain('Pond route<span class="evidence evidence-missing">not recorded</span></h2>');
    expect(u).toContain('<dt>Pond-route edge walks: exact / not recorded</dt><dd>2 / 1<span class="evidence evidence-missing">');
  });

  it("refuses a malformed route, naming the field", () => {
    const bad = (edit: (p: any) => void): GenotypeInput => {
      const d = clone(scaf);
      edit(d.pond);
      return d;
    };
    expect(() => validate(bad((p) => (p.edges[1].crossings[0].carried = "carried")))).toThrow(/pond\.edges\[1\]\.crossings\[0\]\.carried must be one of named, not excluded, not recorded/);
    expect(() => validate(bad((p) => ([p.births[1], p.births[2]] = [p.births[2], p.births[1]])))).toThrow(/pond\.births\[1\]\.key must be 759:12506/);
    expect(() => validate(bad((p) => (p.edges[0].parent = "1:1")))).toThrow(/pond\.edges\[0\]\.parent must be 0:4/);
    expect(() => validate(bad((p) => (p.crossings.named = 2)))).toThrow(/pond\.crossings\.named must equal the crossings the edges hold \(3\), is 2/);
    expect(() => validate(bad((p) => (p.picks.by.random = "6")))).toThrow(/pond\.picks\.by\.random must be an integer of at least 1/);
    expect(() => validate(bad((p) => (p.edges[1].crossings[0].from = 4)))).toThrow(/pond\.edges\[1\]\.crossings\[0\]\.from must be a pond of the run \(0 to 3\)/);
    expect(() => validate(bad((p) => (p.edges[1].crossings[0].step = 999)))).toThrow(/pond\.edges\[1\]\.crossings\[0\]\.step must be boundary x period/);
    expect(() => validate(bad((p) => (p.exact = 2)))).toThrow(/pond\.exact must equal the edges whose walk is exact \(3\)/);
    expect(() => validate(bad((p) => (p.anchor.source = "given")))).toThrow(/pond\.edges must have one entry per chain edge plus the anchor walk \(4\), has 3/);
    // Relations between fields (Codex review, 2026-10-18): what passes here is what pondRoute can write.
    expect(() => validate(bad((p) => (p.edges[0].start.pond = 0)))).toThrow(/pond\.edges\[0\]\.start must be 759:12506's birth node \(cycle 1, pond 3\)/);
    expect(() => validate(bad((p) => (p.edges[1].end = 0)))).toThrow(/pond\.edges\[1\]\.end must be 759:12506's birth cycle \(1\)/);
    expect(() => validate(bad((p) => p.edges[1].crossings.reverse()))).toThrow(/pond\.edges\[1\]\.crossings\[1\]\.boundary must follow boundary 3/);
    expect(() => validate(bad((p) => (p.edges[1].crossings[1].from = 1)))).toThrow(/pond\.edges\[1\]\.crossings\[1\]\.from must be pond 3, where the previous crossing landed/);
    expect(() => validate(bad((p) => (p.edges[1].crossings[2].to = 1)))).toThrow(/pond\.edges\[1\]\.crossings\[2\]\.to must be pond 0, where the walk starts/);
    expect(() => validate(bad((p) => (p.picks.by.random = 1)))).toThrow(/pond\.picks\.by must tally the log's lines \(6\), tallies 1/);
    expect(() => validate(bad((p) => (p.picks.checked = 5)))).toThrow(/pond\.picks checked, partial and unchecked must sum to its lines \(6\)/);
    expect(() => validate(bad((p) => (p.edges[1].crossings[0].share = 2)))).toThrow(/pond\.edges\[1\]\.crossings\[0\]\.share must be a share between 0 and 1/);
    expect(() => validate(bad((p) => (p.edges[1].crossings[0].packetLineages = -4)))).toThrow(/pond\.edges\[1\]\.crossings\[0\]\.packetLineages must be an integer of at least 1/);
    expect(() => validate(bad((p) => Object.assign(p.edges[1].crossings[0], { carried: "not excluded", share: null, packetLineages: 1 })))).toThrow(/packetLineages must be 2 or more on a crossing not excluded/);
    expect(() => validate(bad((p) => (p.anchor.cycle = Number.MAX_VALUE)))).toThrow(/pond\.anchor\.cycle must be an integer of at least 0/);
    expect(() => validate(bad((p) => (p.picks = null)))).toThrow(/pond\.edges\[1\]\.crossings\[0\]\.by must be null without a pick log/);
    expect(() => validate(bad((p) => (p.edges[0].reason = "x")))).toThrow(/pond\.edges\[0\]\.reason must be null on an exact walk/);
    // Second Codex pass: birth cycles follow the keys, a scaf walk lists every boundary it passes, cont lists none,
    // and a crossing's picker is one the tally names.
    expect(() => validate(bad((p) => (p.births[1].cycle = 2)))).toThrow(/pond\.births\[1\]\.cycle must be 1 \(759:12506 first exists at step 759, period 1000\)/);
    expect(() => validate(bad((p) => {
      p.edges[1].crossings = [p.edges[1].crossings[1]];
      p.crossings.named = 1;
    }))).toThrow(/pond\.edges\[1\]\.crossings must hold every boundary the walk passes in arm scaf \(1, 2, 3\), holds 2/);
    expect(() => validate(bad((p) => (p.edges[1].crossings[0].by = "invented")))).toThrow(/pond\.edges\[1\]\.crossings\[0\]\.by must be a picker the pick log's tally names \(random\)/);
    const contCrossing = clone(cont);
    contCrossing.pond!.edges[0].crossings = [{ boundary: 1, step: 1000, from: 0, to: 0, carried: "named", share: 1, packetLineages: 1, by: null }];
    contCrossing.pond!.crossings.named = 1;
    expect(() => validate(contCrossing)).toThrow(/pond\.edges\[0\]\.crossings must be empty in arm cont/);
    // Third review: the remaining invariants, one line each.
    expect(() => validate(bad((p) => (p.births[0].ponds = [1])))).toThrow(/pond\.edges\[0\]\.status exact, yet the walk lands on pond 3, which is not 0:4's birth pond \(1\)/);
    expect(() => validate(bad((p) => Object.assign(p.edges[1], { status: "not recorded", reason: "stopped", crossings: p.edges[1].crossings.slice(0, 2) })))).toThrow(
      /pond\.edges\[1\]\.crossings must hold the boundaries after the missing one in arm scaf \(2, 3\), holds 1, 2/,
    );
    expect(() => validate(bad((p) => Object.assign(p.edges[1], { status: "not recorded", reason: 5 })))).toThrow(/pond\.edges\[1\]\.reason must be a string/);
    expect(() => validate(bad((p) => Object.assign(p.anchor, { source: "given", ponds: [0, 1] })))).toThrow(/pond\.anchor\.ponds must name one pond when the anchor is given/);
    expect(() => validate(bad((p) => (p.anchor.cycle = 5)))).toThrow(/pond\.anchor must be the subject's birth node when its source is the subject's birth/);
    expect(() => validate(bad((p) => (p.anchor.source = "guess")))).toThrow(/pond\.anchor\.source must be "subject birth" or "given"/);
    expect(() => validate(bad((p) => (p.arm = "drift")))).toThrow(/pond\.arm must be one of scaf, rand, breed, cont, nat, shuf/);
    expect(() => validate(bad((p) => (p.picks.torn = "no")))).toThrow(/pond\.picks\.torn must be a boolean/);
    expect(() => validate(bad((p) => (p.period = 0)))).toThrow(/pond\.period must be a positive integer/);
    expect(() => validate(bad((p) => (p.ponds = 2.5)))).toThrow(/pond\.ponds must be a positive integer/);
    expect(() => validate(bad((p) => (p.anchor.cycle = 2 ** 52)))).toThrow(/pond\.anchor\.cycle must put its step \(cycle x period 1000\) within the safe integers/);
    // A minted lineage is born in one tile (Codex P0): two would draw a movement no record shows.
    expect(() => validate(bad((p) => (p.births[1].ponds = [0, 3])))).toThrow(/pond\.births\[1\]\.ponds must name one pond \(759:12506 is minted, so it is born in one tile\)/);
    expect(() => validate(bad((p) => (p.births[2].ponds = null)))).toThrow(/pond\.births\[2\]\.ponds must name one pond/);
    // A pick log in an arm that takes no donors (Codex P0), as checkPicks refuses it.
    const contPicks = clone(cont);
    contPicks.pond!.picks = clone(scaf.pond!.picks);
    expect(() => validate(contPicks)).toThrow(/pond\.picks must hold no pick lines in arm cont, which takes no donors/);
  });

  it("a given anchor past the run's last census widens both figures' step range (Codex P2)", () => {
    const d = clone(cont);
    const r = d.pond!;
    const subject = r.births[r.births.length - 1];
    expect(subject).toMatchObject({ cycle: 6, ponds: [0] });
    r.anchor = { ponds: [0], cycle: 7, source: "given" };
    r.edges.push({ parent: subject.key, child: null, start: { pond: 0, cycle: 7 }, end: 6, status: "exact", reason: null, crossings: [] });
    r.exact++;
    const html = renderChecked(d);
    const svg = routeSvg(html);
    const at = svg.match(/data-anchor=""><circle cx="([\d.]+)"/);
    expect(Number(at![1])).toBeLessThanOrEqual(960 - 36);
    expect(Number(at![1])).toBeGreaterThan(210);
    expect(html).toContain(`<td>${escapeHtml("anchor (pond 0, cycle 7)")}</td><td>7,000</td>`);
    // The anchor walk must start at the anchor it names (Codex pass 2 P1): pond and cycle both.
    const moved = clone(d);
    moved.pond!.anchor.ponds = [1];
    expect(() => validate(moved)).toThrow(/pond\.edges\[\d+\]\.start must be the given anchor \(pond 1, cycle 7\)/);
    const later = clone(d);
    later.pond!.edges.at(-1)!.start.cycle = 8;
    expect(() => validate(later)).toThrow(/pond\.edges\[\d+\]\.start must be the given anchor \(pond 0, cycle 7\)/);
  });

  it("a walk spanning 2^32 boundaries is refused by arithmetic, without building the list (Codex pass 2 P2)", () => {
    const d = clone(contFounder);
    const r = d.pond!;
    const huge = 2 ** 32 + 2;
    Object.assign(r, { arm: "scaf", period: 1, anchor: { ponds: [r.births[0].ponds![0]], cycle: huge, source: "given" }, exact: 1, notRecorded: 0, picks: null });
    r.edges = [{ parent: r.births[0].key, child: null, start: { pond: r.births[0].ponds![0], cycle: huge }, end: 0, status: "exact", reason: null, crossings: [] }];
    expect(() => validate(d)).toThrow(/pond\.edges\[0\]\.crossings must hold every boundary the walk passes in arm scaf \(1 to 4294967297\), holds none/);
  });

  it("nat and shuf: survivors keep their pond, packets cross, and the marks are defined (Codex pass 2 P0)", () => {
    for (const arm of ["nat", "shuf"] as const) {
      const d = clone(scaf);
      d.pond!.arm = arm;
      d.pond!.picks = null;
      for (const e of d.pond!.edges) for (const c of e.crossings) c.by = null;
      const html = renderChecked(d);
      assertPageContract(html, { status: "SMOKE", figureCount: 5 });
      expect(html).not.toContain("records no packet between ponds");
      expect(html).not.toContain("every pond is reseeded");
      expect(html).toContain(`In arm ${arm} a surviving pond (donor −2) keeps its own contents across a boundary, so no crossing is drawn there and the line stays in its lane; a pond whose row names a donor descends from that donor&#39;s packet, a crossing`);
      expect(html).toContain("named, the packet&#39;s dominant lineage is this ancestor");
      expect(html).toContain(`<dt>Pick log (picks.jsonl)</dt><dd>n/a (arm ${arm} takes no picked donors)</dd>`);
      expect(count(html, /data-event="crossing"/g)).toBe(3);
    }
  });

  it("a founder in no tile of the initial world: its own lane, and the chip is not exact", () => {
    const d = clone(contFounder);
    d.pond!.births[0].ponds = [];
    d.pond!.anchor.ponds = [];
    const html = renderChecked(d);
    expect(routeEvents(d).lanes[0]).toBe("unknown");
    expect(routeEvents(d).events).toMatchObject([{ kind: "root", at: { lane: "unknown" } }]);
    expect(html).toContain("<td>a founder in no tile of the initial world</td>");
    expect(html).toContain('Pond route<span class="evidence evidence-missing">not recorded</span></h2>');
  });

  it("a dossier from PR #29 drops its old 'does not draw pond routes' clause", () => {
    const d = clone(scaf);
    const i = d.gaps.findIndex((g) => g.startsWith("pond occupancy at a census"));
    const now = d.gaps[i];
    d.gaps[i] = `${now}; the HTML panel does not draw pond routes yet`;
    const html = renderChecked(d);
    expect(html).not.toContain("does not draw pond routes");
    expect(html).toContain(`<li>${escapeHtml(now)}</li>`);
    // Only the trailing clause goes: the same words elsewhere in a gap are printed as written.
    const mid = clone(scaf);
    mid.gaps.push("a note; the HTML panel does not draw pond routes yet, and more");
    expect(renderChecked(mid)).toContain(`<li>${escapeHtml("a note; the HTML panel does not draw pond routes yet, and more")}</li>`);
    // A dossier without a route keeps the clause too.
    const plain = clone(scaf);
    plain.gaps[i] = `${now}; the HTML panel does not draw pond routes yet`;
    delete (plain as Partial<GenotypeInput>).pond;
    expect(renderChecked(plain)).toContain(`<li>${escapeHtml(plain.gaps[i])}</li>`);
  });

  it("a dossier without pond renders as before", () => {
    for (const edit of [(d: any) => delete d.pond, (d: any) => (d.pond = null)]) {
      const d = clone(scaf);
      edit(d);
      const html = renderChecked(d);
      assertPageContract(html, { status: "SMOKE", figureCount: 4 });
      expect(html).not.toContain("Pond route");
      expect(html).not.toContain("Pick log");
    }
  });

  it("is pure, and escapes text from the dossier", () => {
    expect(renderChecked(clone(scaf))).toBe(renderChecked(clone(scaf)));
    const d = clone(scaf);
    for (const c of d.pond!.edges[1].crossings) c.by = "<b>x</b>";
    d.pond!.picks!.by = { "<b>x</b>": 6 };
    const html = renderChecked(d);
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain(">by &quot;&lt;b&gt;x&lt;/b&gt;&quot;</text>");
    expect(html).toContain("<td>&quot;&lt;b&gt;x&lt;/b&gt;&quot;</td>");
    expect(html).toContain("Picked by &quot;&lt;b&gt;x&lt;/b&gt;&quot; at all 6 logged boundaries.");
    expect(html).toContain("6 lines, 6 checked; &quot;&lt;b&gt;x&lt;/b&gt;&quot; 6");
  });

  it("a figure's scroll label is escaped, and a figure without one keeps its old markup", () => {
    const named = figure(1, "<svg></svg>", "c", undefined, { scrollLabel: 'a "<b>" & c' });
    expect(named).toContain('<div class="fig-media" role="region" tabindex="0" aria-label="a &quot;&lt;b&gt;&quot; &amp; c">');
    expect(named).not.toContain("<b>");
    expect(figure(1, "<svg></svg>", "c")).toContain('<figure class="fig">\n  <div class="fig-media">\n<svg></svg>\n  </div>');
  });
});
