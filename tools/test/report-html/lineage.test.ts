// The lineage panel (tools/lib/report-html/lineage.ts). Genotype dossiers come from the shared CPU history
// (tools/test/lineage-fixture.ts) through the real dossier builder and a JSON round trip, as
// `tools/lineage.ts --out` writes them; pond dossiers come from small ponds.tsv tables built here.
import { beforeAll, describe, expect, it } from "vitest";
import { OUTPUTS, buildDossier, twinSummary } from "../../lib/lineage.ts";
import { buildPondHistory, parsePondRows, pondDossier, pondTwin, type PondArm } from "../../lib/pond-lineage.ts";
import { escapeHtml } from "../../lib/report-html/page.ts";
import { OUTPUT_NAMES, effectText, render, validate, type GenotypeInput, type LineageInput } from "../../lib/report-html/lineage.ts";
import { cpu } from "../lineage-fixture.ts";
import { assertPageContract } from "./contract.ts";

const meta = { sources: [{ path: "dossier.json", sha256: "ab".repeat(32) }], status: "SMOKE" as const };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

let genotype: GenotypeInput;
beforeAll(async () => {
  const d = await buildDossier(cpu().source(), { kind: "top" });
  const twin = await buildDossier(cpu().source(), { kind: "longest" });
  genotype = clone({ ...d, twin: twinSummary(twin) });
}, 60_000);

const renderChecked = (data: unknown): string => {
  validate(data);
  return render(data as LineageInput, meta);
};

/** A ponds.tsv from per-cycle traits and donors (period 100). */
function ponds(cycles: { traits: number[]; donors: number[] }[], arm: PondArm) {
  const lines = ["cycle\tstep\trecipient\tdonor\trecipientTrait\tdonorTrait\tdomHi\tdomLo\tdomShare"];
  cycles.forEach((c, i) =>
    c.traits.forEach((t, r) => {
      const d = c.donors[r];
      lines.push([i + 1, (i + 1) * 100, r, d, t, d >= 0 ? c.traits[d] : 0, d >= 0 ? 1000 * (i + 1) + r : 0, d >= 0 ? 5 : 0, d >= 0 ? 0.5 : 0].join("\t"));
    }),
  );
  return buildPondHistory(parsePondRows(lines), { arm });
}
const SCAF = [
  { traits: [10, 40, 5, 30], donors: [1, 1, 3, 1] },
  { traits: [20, 50, 15, 0], donors: [1, 0, 1, 0] },
  { traits: [25, 35, 45, 0], donors: [2, 2, 1, 2] },
  { traits: [60, 60, 10, 0], donors: [0, 0, 0, 2] },
];
const RAND = [
  { traits: [10, 40, 5, 30], donors: [3, 0, 3, 2] },
  { traits: [20, 50, 15, 9], donors: [2, 2, 2, 2] },
  { traits: [25, 35, 45, 8], donors: [3, 1, 3, 1] },
  { traits: [30, 20, 10, 7], donors: [1, 1, 1, 1] },
];

describe("genotype panel", () => {
  it("names the outputs in the dossier tool's order", () => {
    expect([...OUTPUT_NAMES]).toEqual([...OUTPUTS]);
  });

  it("passes the page contract: four figures without profiles.tsv", () => {
    const html = renderChecked(genotype);
    assertPageContract(html, { status: "SMOKE", figureCount: 4 });
    expect(html.startsWith("<title>Lineage Dossier</title>")).toBe(true);
    expect(html).toContain(`Ancestry: ${genotype.chain.length} lineages from root ${genotype.root.key} to subject ${genotype.subject.key}`);
    expect(html).toContain("profiles.tsv is absent");
  });

  it("lists every mutation with its locus, change and probe-grid effect", () => {
    const html = renderChecked(genotype);
    expect(genotype.mutations.length).toBeGreaterThan(0);
    genotype.mutations.forEach((m, i) => {
      const row = [i + 1, m.step.toLocaleString("en-US"), m.child, m.locus, `${m.before} → ${m.after}`, m.expression, effectText(m)].map((c) => `<td>${escapeHtml(String(c))}</td>`).join("");
      expect(html).toContain(row);
    });
  });

  it("prints every gap the dossier reports, and the key numbers with evidence chips", () => {
    const html = renderChecked(genotype);
    for (const g of genotype.gaps) expect(html).toContain(`<li>${escapeHtml(g)}</li>`);
    expect(html).toContain(`<dt>Depth (mutations from root)</dt><dd>${genotype.mutations.length}<span class="evidence evidence-exact">exact</span></dd>`);
    expect(html).toContain('<span class="evidence evidence-missing">not recorded</span>');
  });

  it("adds the flux figure when profiles.tsv recorded the ancestry", () => {
    const d = clone(genotype);
    const last = d.chain.length - 1;
    d.chain[0].profile = { censuses: 2, cellCensuses: 40, roles: { phototroph: 30, decomposer: 10 }, perCell: { photo: 0.2, grow: 0.05, decomp: 0.01, resp: 0.1 } };
    d.chain[last].profile = { censuses: 1, cellCensuses: 8, roles: { decomposer: 8 }, perCell: { photo: 0, grow: 0.01, decomp: 0.3, resp: 0.12 } };
    const html = renderChecked(d);
    assertPageContract(html, { status: "SMOKE", figureCount: 5 });
    expect(html).toContain("<td>phototroph 75.0%, decomposer 25.0%</td>");
    expect(html).toContain(`the 2 of ${d.chain.length} lineages on the ancestry`);
  });

  it("says what is missing instead of drawing it", () => {
    const d = clone(genotype);
    d.twin = null;
    d.trackerBirths = null;
    d.subject.aliveAtEnd = false;
    d.provenance.finalCensus = 300;
    d.log.complete = null;
    const html = renderChecked(d);
    expect(html).toContain("No twin bundle was given");
    expect(html).toContain("births.tsv is absent");
    expect(html).toContain("<dt>Alive at the final census (step 300)</dt><dd>no");
    expect(html).toContain("<dd>not checked<");
  });

  it("is a pure function of its input", () => {
    expect(renderChecked(clone(genotype))).toBe(renderChecked(clone(genotype)));
  });

  it("escapes text that comes from the dossier", () => {
    const d = clone(genotype);
    d.provenance.runId = '<script>alert("x")</script>';
    d.gaps = [...d.gaps, "<b>bold</b> & more"];
    const html = renderChecked(d);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<li>&lt;b&gt;bold&lt;/b&gt; &amp; more</li>");
  });

  it("thins long series to pixel columns without dropping their extremes", () => {
    const d = clone(genotype);
    const n = 5000;
    d.population = {
      steps: Array.from({ length: n }, (_, i) => (i + 1) * 10),
      living: Array.from({ length: n }, (_, i) => (i === 2500 ? 99_999 : 100)),
      line: Array.from({ length: n }, () => 50),
      clade: Array.from({ length: n }, () => 10),
    };
    d.provenance.finalCensus = n * 10;
    const html = renderChecked(d);
    assertPageContract(html, { status: "SMOKE", figureCount: 4 });
    expect(html).toContain("5,000 censuses");
    expect(html).toMatch(/<polygon points="[^"]*" fill="var\(--ink\)" fill-opacity="0.3"/);
    expect(html).toContain(">100,000<"); // the spike sets the axis
  });

  it("refuses malformed input, naming the field", () => {
    const noMean = clone(genotype) as unknown as { chain: { probe: { meanOut?: unknown } }[] };
    delete noMean.chain[0].probe.meanOut;
    expect(() => validate(noMean)).toThrow(/chain\[0\]\.probe\.meanOut/);
    const short = clone(genotype);
    short.mutations = short.mutations.slice(1);
    expect(() => validate(short)).toThrow(/mutations must have one entry per chain edge/);
    const badClass = clone(genotype) as unknown as { mutations: { expression: string }[] };
    badClass.mutations[0].expression = "silent";
    expect(() => validate(badClass)).toThrow(/mutations\[0\]\.expression/);
    expect(() => validate({ kind: "report" })).toThrow(/kind must be "genotype", "pond" or "pond-twin"/);
    expect(() => validate([])).toThrow(/must be an object/);
    // Every field the page reads is checked, nested ones included.
    const noFiles = clone(genotype) as unknown as { provenance: { files?: unknown } };
    delete noFiles.provenance.files;
    expect(() => validate(noFiles)).toThrow(/provenance\.files/);
    const noTwinRule = clone(genotype) as unknown as { twin: { rule?: unknown } };
    delete noTwinRule.twin.rule;
    expect(() => validate(noTwinRule)).toThrow(/twin\.rule/);
    const noOrigin = clone(genotype) as unknown as { subject: { origin: unknown } };
    noOrigin.subject.origin = {};
    expect(() => validate(noOrigin)).toThrow(/subject\.origin\.minted/);
    const badRole = clone(genotype);
    badRole.chain[0].profile = { censuses: 1, cellCensuses: 4, roles: { phototroph: "bad" as unknown as number }, perCell: { photo: 0, grow: 0, decomp: 0, resp: 0 } };
    expect(() => validate(badRole)).toThrow(/chain\[0\]\.profile\.roles\.phototroph/);
  });

  it("renders a long census series without spreading it into a call", () => {
    const d = clone(genotype);
    const n = 150_000;
    d.population = { steps: Array.from({ length: n }, (_, i) => i + 1), living: new Array(n).fill(7), line: new Array(n).fill(3), clade: new Array(n).fill(1) };
    d.provenance.finalCensus = n;
    assertPageContract(renderChecked(d), { status: "SMOKE", figureCount: 4 });
  });

  it("tells a missing profiles.tsv from one with no row for this ancestry", () => {
    const d = clone(genotype);
    d.provenance.files = [...d.provenance.files, "profiles.tsv"];
    const html = renderChecked(d);
    expect(html).toContain("profiles.tsv records no deep-census profile for any lineage on this ancestry.");
    expect(html).not.toContain("profiles.tsv is absent");
  });

  it("claims the twin used the same rule only when it did", () => {
    expect(renderChecked(genotype)).toContain("The twin&#39;s subject was chosen by rule longest at step 200; this page&#39;s subject by top at step 200.");
    const same = clone(genotype);
    same.twin = { ...same.twin!, rule: same.rule };
    expect(renderChecked(same)).toContain("The same subject rule (top at step 200) chose the twin&#39;s subject.");
    const named = clone(genotype);
    named.rule = { kind: "key", key: named.subject.key, step: 200 };
    expect(renderChecked(named)).toContain(`this page&#39;s subject by named lineage ${named.subject.key}, read at step 200.`);
    // Rules that differ only past the text's old rounding are still told apart, and printed exactly.
    const close = clone(genotype);
    close.rule = { kind: "random", seed: 1, minShare: 0.01001, step: 200 };
    close.twin = { ...close.twin!, rule: { kind: "random", seed: 1, minShare: 0.01004, step: 200 } };
    expect(renderChecked(close)).toContain("chosen by rule random (seed 1, minimum share 0.01004) at step 200; this page&#39;s subject by random (seed 1, minimum share 0.01001) at step 200.");
  });

  it("qualifies every probe of genomes that cells never expressed", () => {
    const d = clone(genotype);
    d.provenance.expressed = false;
    d.provenance.condition = "neutral";
    const html = renderChecked(d);
    expect(html).toContain("<dt>Genomes expressed by cells</dt><dd>no (neutral)");
    expect(html.split("so these probe results describe genomes that never controlled a cell.").length - 1).toBe(3);
    expect(renderChecked(genotype)).not.toContain("never controlled a cell");
  });
});

describe("effect template", () => {
  const m = (expression: "controller" | "physics" | "probe-silent" | "clamped", maxDelta: number[]) =>
    ({ expression, maxDelta, changedShare: maxDelta.map((d) => (d ? 0.25 : 0)) }) as GenotypeInput["mutations"][number];
  it("lists the outputs a controller mutation moves, largest first, three at most", () => {
    expect(effectText(m("controller", [3, 0, 9, 0, 9, 1, 0, 0]))).toBe("decomp 9 (25.0%), build 9 (25.0%), photo 3 (25.0%), +1 more");
    expect(effectText(m("controller", [0, 0, 0, 0, 0, 0, 0, 24]))).toBe("moveY 24 (25.0%)");
  });
  it("uses a fixed sentence for the other classes", () => {
    expect(effectText(m("physics", Array(8).fill(0)))).toBe("acts through physics, not on the probe grid");
    expect(effectText(m("probe-silent", Array(8).fill(0)))).toBe("no output moves on the probe grid");
    expect(effectText(m("clamped", Array(8).fill(0)))).toBe("no genome change (clamped)");
  });
});

describe("pond panel", () => {
  it("draws trait and descent for a scaf node", () => {
    const d = clone(pondDossier(ponds(SCAF, "scaf"), { kind: "explicit", pond: 3, cycle: 4 }));
    const html = renderChecked(d);
    assertPageContract(html, { status: "SMOKE", figureCount: 2 });
    expect(html.startsWith("<title>Pond Lineage Dossier</title>")).toBe(true);
    expect(html).toContain("<dd>pond 3 at cycle 4 (step 400)");
    for (const n of d.ancestry.chain) expect(html).toContain(`<td>${n.cycle}</td><td>${n.pond}</td><td>${n.trait}</td>`);
    for (const note of d.notes) expect(html).toContain(`<li>${escapeHtml(note)}</li>`);
  });

  it("draws no descent for a history without transfers", () => {
    const cont = ponds(SCAF.map((c) => ({ traits: c.traits, donors: c.donors.map(() => -1) })), "cont");
    const html = renderChecked(clone(pondDossier(cont, { kind: "top", cycle: 2 })));
    assertPageContract(html, { status: "SMOKE", figureCount: 1 });
    expect(html).toContain("none: no transfer in this history");
  });

  it("puts a scaf node and its rand twin side by side", () => {
    const t = clone(pondTwin(ponds(SCAF, "scaf"), ponds(RAND, "rand"), { kind: "top" }));
    const html = renderChecked(t);
    assertPageContract(html, { status: "SMOKE", figureCount: 3 });
    expect(html.startsWith("<title>Pond Lineage Twin</title>")).toBe(true);
    expect(html).toContain(`<dd>pond ${t.scaf.subject.pond} at cycle 4, trait ${t.scaf.subject.trait}`);
    expect(html).toContain(`<dd>pond ${t.rand.subject.pond} at cycle 4, trait ${t.rand.subject.trait}`);
    expect(html).toContain("<th>measure</th><th>scaf</th><th>rand</th>");
  });

  it("gives each arm's clade its own cycle when the histories end apart", () => {
    const t = clone(pondTwin(ponds(SCAF, "scaf"), ponds(RAND.slice(0, 2), "rand"), { kind: "top" }));
    expect(t.scaf.subject.cycle).toBe(2);
    const html = renderChecked(t);
    assertPageContract(html, { status: "SMOKE", figureCount: 3 });
    expect(html).toMatch(/<td>Clade at the history&#39;s last cycle: ponds \/ with trait &gt; 0<\/td><td>cycle 4: [^<]*<\/td><td>cycle 2: /);
  });

  it("refuses a malformed pond dossier, naming the field", () => {
    const seeded = clone(pondDossier(ponds(SCAF, "scaf"), { kind: "top", cycle: 3 })) as unknown as { offspring: { children: { packet?: unknown }[] } };
    expect(seeded.offspring.children.length).toBeGreaterThan(0);
    delete seeded.offspring.children[0].packet;
    expect(() => validate(seeded)).toThrow(/offspring\.children\[0\]\.packet/);
    const d = clone(pondDossier(ponds(SCAF, "scaf"), { kind: "top" })) as unknown as { ancestry: { chain: unknown[] } };
    d.ancestry.chain = [];
    expect(() => validate(d)).toThrow(/ancestry\.chain must not be empty/);
    const t = clone(pondTwin(ponds(SCAF, "scaf"), ponds(RAND, "rand"), { kind: "top" })) as unknown as { rand: { band: unknown } };
    t.rand.band = null;
    expect(() => validate(t)).toThrow(/rand\.band must be an array/);
  });
});
