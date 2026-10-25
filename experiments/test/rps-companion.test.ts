// Tests for docs/3d-cyclic-rps-companion.html (plan M5a, D15): the companion page with the live lattice canvas and the result slots.
//
// What is checked:
//   * THE COPY. The page holds a type-stripped copy of experiments/3d-rps/rmf-lattice.ts between two marker lines, so that it cannot
//     drift from the module. THE BUILD STEP that makes the copy, and so what "strip the types the same way" means here, is in
//     experiments/3d-rps/companion-build.ts (its header lists the steps): delete the line-initial `export `, then
//     node:module stripTypeScriptTypes(text, { mode: "transform" }), which erases the types, drops the comments and prints the code
//     again from its syntax tree. THE HASH is SHA-256 of that canonical text, taken at the time of this test for BOTH the module and the
//     page's block, so it ignores comments, layout and types and moves with every other token, and it pins nothing about how one
//     particular Node prints code. This test fails (it does not skip) on a Node without stripTypeScriptTypes (22.13+ or 23.2+).
//     To regenerate after a change of the module:  node experiments/3d-rps/companion-build.ts --write
//   * That the copy RUNS like the module: the same first frame and the same state after 20,000 reaction steps, run in pieces, with
//     the mobility changed mid-run (what the canvas's slider does).
//   * The page's contract: self-contained (no external script, style or font; images only as data URIs), the theme tokens and both
//     colour schemes, a title of two to four words, every result slot present, a filled slot naming its file, hash and date, seeds
//     outside the registered block (Appendix A), and presets whose captions are true of the module.
//   * THE RESULTS (section 4, the chips, the pictures): the generated blocks are what the build step writes from the committed sources;
//     the lattice M_c and outcome equal both the readout's text and evaluateLattice recomputed from the 44 JSONs; each label, verdict
//     and number equals its GATE0 record; the explorations never read as GO or as a result; the 256 x 256 x 4 slot works with and
//     without its file; the page and each media file stay under their budgets.
// Seeds: the presets use 900 and up (Appendix A: plumbing only); the registered block 2,000,000+ is never run here.
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { createLattice, gridHash, runSteps, setMobility, stateHash, M_GRID, type LatticeState } from "../3d-rps/rmf-lattice.ts";
import {
  ANIM_256,
  ANIM_256_POSTER,
  CHECK_BEGIN,
  CHECK_END,
  COPY_BEGIN,
  COPY_END,
  EXP1_PATH,
  EXP2_PATH,
  GATE0_PATH,
  LATTICE_DIR,
  LATTICE_PATH,
  MEDIA_CAPS,
  MEDIA_DIR,
  PAGE_BUDGET,
  PAGE_PATH,
  READOUT_PATH,
  REBUILD_256,
  NO_SPIRALS,
  RESULT_BLOCKS,
  buildPage,
  buildResults,
  codeHash,
  extractBlock,
  parseLatticeReadout,
  renderSelfCheck,
  resultBegin,
  resultEnd,
  selfCheckValues,
  spliceBlock,
} from "../3d-rps/companion-build.ts";
import { evaluateLattice, parseLatticeCell } from "../3d-rps/readout-lattice.ts";

const html = readFileSync(PAGE_PATH, "utf8");
const source = readFileSync(LATTICE_PATH, "utf8");
const copy = extractBlock(html, COPY_BEGIN, COPY_END);
const REGENERATE = "regenerate with: PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH node experiments/3d-rps/companion-build.ts --write";
const ROOT = resolve(LATTICE_PATH, "../../..");

type Api = {
  createLattice: typeof createLattice;
  runSteps: typeof runSteps;
  setMobility: typeof setMobility;
  gridHash: typeof gridHash;
  stateHash: typeof stateHash;
  M_GRID: readonly number[];
};

/** The page's block as a function scope, strict like the page's own script. */
function pageApi(): Api {
  return new Function(`"use strict";\n${copy}\nreturn { createLattice, runSteps, setMobility, gridHash, stateHash, M_GRID };`)() as Api;
}

// ---------------------------------------------------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------------------------------------------------

describe("companion page: the inline lattice copy", () => {
  it("has one block between its markers, and nothing in it can end or confuse the script element", () => {
    expect(copy.length).toBeGreaterThan(5000);
    expect(copy).not.toMatch(/<\/script/i);
    expect(copy).not.toContain("<!--");
    expect(copy).not.toMatch(/^[ \t]*(import|export)\b/m);
    expect(copy).not.toMatch(/\b(Deno|process|require)\b|\bimport\(/);
  });

  it("hashes, as normalized code, the same as the module", () => {
    const want = codeHash(source);
    const got = codeHash(copy);
    expect(got, `the page's lattice copy differs from experiments/3d-rps/rmf-lattice.ts (hash of the page's block ${got}, of the module ${want}); ${REGENERATE}`).toBe(want);
  });

  it("the hash ignores comments, layout and types, and sees every other token", () => {
    const base = codeHash(source);
    // noise the hash must not see: a comment, blank lines, trailing blanks
    const noisy = `/* a new block comment */\n\n\n${source.replace(/;$/gm, ";  ").replace(/\{$/gm, "{ ")}\n// and a last comment\n`;
    expect(codeHash(noisy)).toBe(base);
    // edits to the page's block (comment-free, so every match is code) that the hash must see
    const firstInteger = copy.replace(/\b\d+\b/, (n) => String(Number(n) + 1));
    const firstLess = copy.replace(" < ", " <= ");
    const renamed = copy.replace(/\bcreateLattice\b/, "createLattice2");
    for (const [what, edited] of [["an integer literal", firstInteger], ["a comparison", firstLess], ["a name", renamed]] as const) {
      expect(edited, `the probe edit of ${what} found nothing to change`).not.toBe(copy);
      expect(codeHash(edited), `the hash did not notice an edit of ${what}`).not.toBe(codeHash(copy));
    }
  });

  it("runs like the module: the same first frame and the same state, in pieces and across a change of M", () => {
    const page = pageApi();
    expect(page.M_GRID).toEqual(M_GRID);
    for (const cfg of [
      { L: 20, M: 3e-4, seed: 900 },
      { L: 33, M: 1e-3, seed: 4242 },
      { L: 7, M: 0, seed: 905 },
    ]) {
      const a = createLattice(cfg);
      const b = page.createLattice(cfg) as LatticeState;
      expect(page.gridHash(b), `first frame of ${JSON.stringify(cfg)}`).toBe(gridHash(a));
      runSteps(a, 20_000);
      page.runSteps(b, 20_000);
      expect(page.stateHash(b), `state after 20,000 steps of ${JSON.stringify(cfg)}`).toBe(stateHash(a));
    }
    // the canvas's slider: run in pieces and change M between them
    const a = createLattice({ L: 25, M: 1e-4, seed: 901 });
    const b = page.createLattice({ L: 25, M: 1e-4, seed: 901 });
    for (const [steps, M] of [[3000, 1e-4], [7001, 2e-3], [999, 2e-3], [12_345, 4e-4]] as const) {
      setMobility(a, M);
      page.setMobility(b, M);
      runSteps(a, steps);
      page.runSteps(b, steps);
      expect(page.stateHash(b)).toBe(stateHash(a));
    }
  });

  it("carries the self-check values of the module, which the page re-computes when it loads", () => {
    expect(extractBlock(html, CHECK_BEGIN, CHECK_END), REGENERATE).toBe(renderSelfCheck(selfCheckValues()));
  });

  it("belongs to a script that parses, in strict mode", () => {
    const main = /<script>([\s\S]*?)<\/script>/.exec(html);
    expect(main, "the page's script element").not.toBeNull();
    expect(() => new Script(main![1], { filename: "companion-page-script.js" })).not.toThrow();
    expect(main![1]).toContain(COPY_BEGIN);
    expect(main![1]).toContain('"use strict"');
  });

  it("is written by a build step that splices exactly, and touches nothing outside its two blocks", () => {
    // extract then splice gives the page back; a marker that is missing or twice there is an error, not a guess
    expect(spliceBlock(html, COPY_BEGIN, COPY_END, copy)).toBe(html);
    expect(extractBlock(spliceBlock(html, COPY_BEGIN, COPY_END, "const x = 1;\n"), COPY_BEGIN, COPY_END)).toBe("const x = 1;\n");
    expect(() => extractBlock(html, "// BEGIN no such block", COPY_END)).toThrow(/not found/);
    expect(() => extractBlock(html + `\n${COPY_BEGIN}\n`, COPY_BEGIN, COPY_END)).toThrow(/twice/);
    // building the page changes only what is between the markers
    const built = buildPage(html);
    const bare = (page: string) =>
      RESULT_BLOCKS.reduce((p, b) => spliceBlock(p, resultBegin(b), resultEnd(b), ""), spliceBlock(spliceBlock(page, COPY_BEGIN, COPY_END, ""), CHECK_BEGIN, CHECK_END, ""));
    expect(bare(built)).toBe(bare(html));
    expect(buildPage(built)).toBe(built);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------------------------

describe("companion page: contract", () => {
  it("is one file: no external script, style or font, images only as data URIs, and links only to the plan and to arXiv", () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import|url\(\s*["']?(https?:)?\/\//i);
    expect(html).not.toMatch(/<(iframe|video|audio|embed|object)\b/i);
    // two script elements: the inline results data and the page's own script
    expect([...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])).toEqual(['<script type="application/json" id="results-data">', "<script>"]);
    // every image and every source of a picture is inline
    const tags = [...html.matchAll(/<(img|source)\b[^>]*>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThanOrEqual(3);
    for (const t of tags) expect(/\s(src|srcset)="data:image\/(png|gif);base64,[A-Za-z0-9+/=]+"/.test(t), `an inline image: ${t.slice(0, 80)}`).toBe(true);
    expect(html).not.toMatch(/\s(src|srcset)="(?!data:image\/(png|gif);base64,)/);
    const hrefs = [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h, h).toMatch(/^(3d-cyclic-rps-plan-2026-10-23\.md|https:\/\/arxiv\.org\/abs\/[\w./-]+)$/);
  });

  it("has a title of two to four words, a language, a viewport and a description", () => {
    const title = /<title>([^<]*)<\/title>/.exec(html)![1].trim();
    expect(title.split(/\s+/).length).toBeGreaterThanOrEqual(2);
    expect(title.split(/\s+/).length).toBeLessThanOrEqual(4);
    expect(title).not.toContain(":");
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1">/);
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}">/);
  });

  it("has the theme tokens in all three places and an explicit body background", () => {
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1];
    const light = /:root \{([\s\S]*?)\n\}/.exec(css)![1];
    const dark = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/.exec(css)![1];
    const darkStamp = /:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(css)![1];
    expect(light).toContain("color-scheme: light");
    expect(dark).toContain("color-scheme: dark");
    expect(darkStamp).toContain("color-scheme: dark");
    for (const t of ["bg", "surface", "raised", "hover", "line", "line-soft", "text", "muted", "soft", "control-line", "sun", "sun-soft", "sun-ink", "life", "life-fill", "error"]) {
      for (const [where, block] of [["light", light], ["dark media", dark], ["dark stamp", darkStamp]] as const) expect(block, `--${t} in ${where}`).toMatch(new RegExp(`--${t}:`));
    }
    expect(css).toMatch(/body \{[^}]*background: var\(--bg\)/);
    // the field and the three species colours are the same in both schemes: they are in the light block only
    for (const t of ["field", "sp1", "sp2", "sp3"]) expect(light).toMatch(new RegExp(`--${t}: #[0-9a-f]{6};`));
  });

  it("has every result slot: the four that ran filled from a named file, and the rest labelled Not yet run", () => {
    const data = JSON.parse(/<script type="application\/json" id="results-data">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(data.format).toBe("rps-companion-results/2");
    const keys = ["lattice-pext", "gate0", "exploration-1", "exploration-2", "meter", "calibration", "sweep", "snapshots", "deep", "cycles", "mutation"];
    const ran: Record<string, "registered" | "exploration"> = { "lattice-pext": "registered", gate0: "registered", "exploration-1": "exploration", "exploration-2": "exploration" };
    expect(Object.keys(data.slots).sort()).toEqual([...keys].sort());
    const articles = [...html.matchAll(/<article class="slot[^"]*" id="slot-([\w-]+)" data-slot="([\w-]+)" data-state="(\w+)"[^>]*>([\s\S]*?)<\/article>/g)];
    expect(articles.map((a) => a[2]).sort()).toEqual([...keys].sort());
    for (const [, id, key, state, body] of articles) {
      expect(id).toBe(key);
      const status = /<span class="stat" data-role="status">([^<]*)<\/span>/.exec(body)![1];
      const kind = ran[key];
      if (kind === undefined) {
        // nothing ran: the kernel stages after Gate 0 (the cliff of rule 4, the mutation arms of rule 7, ...)
        expect(state, `slot ${key}`).toBe("empty");
        expect(status, `slot ${key}`).toBe("Not yet run");
        expect(body, `slot ${key}`).toMatch(/data-role="frame">Empty: /);
        for (const label of ["Will show", "Read by", "Runs", "Filled from"]) expect(body, `slot ${key} says "${label}"`).toContain(`<dt>${label}</dt>`);
        expect(data.slots[key], `slot ${key}`).toBeNull();
        continue;
      }
      expect(state, `slot ${key}`).toBe(kind === "registered" ? "filled" : "exploration");
      expect(status, `slot ${key}`).toMatch(kind === "registered" ? /^Registered · / : /^Exploration · /);
      const e = data.slots[key] as { kind: string; label: string; file: string; sha256: string; date: string; data: unknown };
      expect(e.kind, `slot ${key}`).toBe(kind);
      expect(e.date, `slot ${key} gives a date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.data, `slot ${key} has data`).not.toBeUndefined();
      // the file exists, the hash is its hash, and the slot shows all three
      const text = readFileSync(resolve(ROOT, e.file), "utf8");
      expect(e.sha256, `slot ${key}: the hash of ${e.file}`).toBe(createHash("sha256").update(text).digest("hex"));
      expect(body, `slot ${key} names its file`).toContain(`<code>${e.file}</code>`);
      expect(body, `slot ${key} shows its hash`).toContain(e.sha256.slice(0, 16));
      expect(body, `slot ${key} shows its date`).toContain(e.date);
    }
  });

  it("keeps the canvas out of the registered seeds, and its controls inside the registered grid", () => {
    expect(html).toContain("const SEED_MIN = 900;");
    expect(html).toContain("const SEED_MAX = 999999;");
    const slider = /<input id="m" type="range" min="(-?[\d.]+)" max="(-?[\d.]+)" step="([\d.]+)"/.exec(html)!;
    expect(Number(slider[1])).toBe(Math.log10(M_GRID[0]));
    expect(Math.abs(Number(slider[2]) - Math.log10(M_GRID[M_GRID.length - 1]))).toBeLessThan(0.002); // 2e-3 is -2.699; the slider's last step is -2.7
    for (const p of presets()) {
      expect(p.seed, `${p.name} seed`).toBeGreaterThanOrEqual(900);
      expect(p.seed, `${p.name} seed`).toBeLessThanOrEqual(999_999);
      expect(p.m, `${p.name} M`).toBeGreaterThanOrEqual(M_GRID[0]);
      expect(p.m, `${p.name} M`).toBeLessThanOrEqual(M_GRID[M_GRID.length - 1]);
      expect(p.speed, `${p.name} speed`).toBeGreaterThanOrEqual(2);
      expect(p.speed, `${p.name} speed`).toBeLessThanOrEqual(1000);
      expect(html, `${p.name}: a size radio of ${p.size}`).toMatch(new RegExp(`<input type="radio" name="size" value="${p.size}"`));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The presets say true things about the module
// ---------------------------------------------------------------------------------------------------------------------

interface Preset {
  name: string;
  size: number;
  m: number;
  seed: number;
  speed: number;
  hint: string;
}

function presets(): Preset[] {
  return [...html.matchAll(/<button class="btn preset" type="button" data-preset="(\w+)" data-size="(\d+)" data-m="([\d.e-]+)" data-seed="(\d+)" data-speed="(\d+)" data-hint="([^"]*)">/g)].map((m) => ({
    name: m[1],
    size: Number(m[2]),
    m: Number(m[3]),
    seed: Number(m[4]),
    speed: Number(m[5]),
    hint: m[6],
  }));
}

describe("companion page: the presets", () => {
  const byName = (n: string): Preset => {
    const p = presets().find((x) => x.name === n);
    if (!p) throw new Error(`preset ${n} not found in the page`);
    return p;
  };

  it("are the three the page describes, and their captions repeat their own settings", () => {
    expect(presets().map((p) => p.name)).toEqual(["spirals", "mixing", "threshold"]);
    for (const p of presets()) {
      expect(p.hint, p.name).toContain(`${p.size} sites a side`);
      expect(p.hint, p.name).toContain(`seed ${p.seed}`);
      expect(p.hint, p.name).toContain(`M = ${p.m.toExponential().replace("e", "e")}`);
    }
  });

  it("Spirals: all three kinds are still alive after 1,200 generations", () => {
    const p = byName("spirals");
    const st = createLattice({ L: p.size, M: p.m, seed: p.seed });
    runSteps(st, 1200 * st.N);
    expect(st.absorbed).toBe(false);
    expect(st.alive).toBe(3);
  });

  it("Too much mixing: the run ends, with one kind left, within 1,500 generations", () => {
    const p = byName("mixing");
    const st = createLattice({ L: p.size, M: p.m, seed: p.seed });
    runSteps(st, 1500 * st.N);
    expect(st.absorbed).toBe(true);
    expect(st.alive).toBe(1);
    expect(st.absorbedAtStep / st.N).toBeLessThan(1500);
  });

  it("Near the threshold: this seed loses two kinds within N generations, and other seeds of the same setting keep all three", () => {
    const p = byName("threshold");
    const ends: boolean[] = [];
    for (let seed = p.seed; seed < p.seed + 20; seed++) {
      const st = createLattice({ L: p.size, M: p.m, seed });
      runSteps(st, st.N * st.N); // t = N generations, the stop of plan 6
      ends.push(st.absorbed);
    }
    expect(ends[0], "the preset's own seed").toBe(true);
    expect(ends.some((e) => !e), "some seed of 900 to 919 keeps three kinds to N generations").toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The results: every number and label against its committed source
// ---------------------------------------------------------------------------------------------------------------------

const block = (b: (typeof RESULT_BLOCKS)[number]): string => extractBlock(html, resultBegin(b), resultEnd(b));
const readout = readFileSync(READOUT_PATH, "utf8");
const gate0 = readFileSync(GATE0_PATH, "utf8");
const exp1 = readFileSync(EXP1_PATH, "utf8");
const exp2 = readFileSync(EXP2_PATH, "utf8");
/** The visible text of a piece of the page (tags dropped, entities of the build step undone, spaces collapsed). */
const textOf = (s: string): string =>
  s.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("companion page: the results", () => {
  it("are what the build step writes from the committed sources (the page is not stale)", () => {
    const want = buildResults();
    // compared by hash: the pictures block is megabytes of base64, too much for a failure message
    const h = (s: string) => createHash("sha256").update(s).digest("hex");
    for (const b of RESULT_BLOCKS) expect(h(block(b)), `result block ${b} is stale; ${REGENERATE}`).toBe(h(want[b]));
  });

  it("Q1: M_c and the outcome equal the readout's, and evaluateLattice recomputed from the 44 JSONs", () => {
    const files = readdirSync(LATTICE_DIR).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(44);
    const cells = files.map((f) => parseLatticeCell(JSON.parse(readFileSync(join(LATTICE_DIR, f), "utf8")), f));
    const ev = evaluateLattice(cells);
    expect(ev.status).toBe("final");
    const main = ev.main!;
    const rd = parseLatticeReadout(readout);
    // the readout's own text, read independently of the build step's parser
    expect(readout).toMatch(new RegExp(`^status: final; outcome ${ev.name}$`, "m"));
    expect(readout).toContain(`M_c = ${main.Mc!.toExponential(2)};`);
    expect(rd.outcome).toBe(ev.name);
    expect(rd.McText).toBe(main.Mc!.toExponential(2));
    expect(rd.V).toBe(main.V);
    expect(rd.pairs.map((p) => p.estimate!.toExponential(2)).sort()).toEqual(main.estimates.map((x) => x.toExponential(2)).sort());
    // what the page says
    const slot = block("lattice-pext");
    expect(ev.name).toBe("LAT-PASS");
    expect(slot).toContain(`<span class="stat" data-role="status">Registered · ${ev.name}</span>`);
    expect(slot).toContain(`M_c ${main.Mc!.toExponential(2)}</text>`);
    const [m, e] = main.Mc!.toExponential(2).split("e");
    expect(slot).toContain(`<i>M</i><sub>c</sub> = ${m} × 10<sup>−${Math.abs(Number(e))}</sup>`);
    expect(slot).toContain(`${(main.Mc! / 4.5e-4).toFixed(2)} of the paper's 4.5`);
    expect(block("summary")).toContain(`Lattice: ${ev.name} · registered`);
  });

  it("Q1: the chart has a point, an error bar and a table cell for each of the 44 cells, with the add-one error", () => {
    const slot = block("lattice-pext");
    const svg = /<svg class="chart"[\s\S]*?<\/svg>/.exec(slot)![0];
    expect(svg).toMatch(/role="img" aria-labelledby="pext-title pext-desc"/);
    expect([...svg.matchAll(/<line class="err"/g)]).toHaveLength(44);
    expect([...svg.matchAll(/<path class="curve"/g)]).toHaveLength(4);
    expect([...svg.matchAll(/<line class="est"/g)]).toHaveLength(6);
    expect([...svg.matchAll(/<g\b/g)].length).toBe([...svg.matchAll(/<\/g>/g)].length);
    expect(svg).toMatch(/<rect class="band" /);
    expect(svg).not.toMatch(/\bNaN\b|undefined/);
    for (const f of readdirSync(LATTICE_DIR).filter((x) => x.endsWith(".json"))) {
      const c = JSON.parse(readFileSync(join(LATTICE_DIR, f), "utf8"));
      const se = Math.sqrt(((c.k + 1) / (c.R + 2)) * (1 - (c.k + 1) / (c.R + 2)) / (c.R + 2));
      expect(Math.abs(c.se - se), `${f}: se is the add-one error`).toBeLessThan(1e-12);
      expect(slot.includes(`<td>${c.k}/${c.R} = ${(c.k / c.R).toFixed(3)} ± ${se.toFixed(3)}</td>`), f).toBe(true);
    }
  });

  it("Gate 0: GATE-0-STOP, every rung NO-GO: LEVELS with the record's levels, and no kill tested", () => {
    expect(gate0).toMatch(/^- \*\*Verdict: GATE-0-STOP\*\*/m);
    const slot = block("gate0");
    expect(slot).toContain('<span class="stat" data-role="status">Registered · GATE-0-STOP</span>');
    expect(block("summary")).toContain("Gate 0 pilot: GATE-0-STOP · registered");
    const levels: Record<string, number> = {};
    for (const m of gate0.matchAll(/^ {2}- (S\d): `G_spread` = \[([\d, ]+)\], levels (\d+)\./gm)) {
      levels[m[1]] = Number(m[3]);
      expect(gate0, m[1]).toContain(`### Rung ${m[1]}: NO-GO: LEVELS (row 1)`);
      expect(slot, m[1]).toContain(`<tr><th scope="row">${m[1]}</th><td>${m[3]}</td><td>${m[2]}</td><td>NO-GO: LEVELS</td></tr>`);
    }
    expect(levels).toEqual({ S0: 4, S1: 2, S2: 4 });
    expect(gate0).toMatch(/\*\*Rung V: not run\.\*\*/);
    expect(textOf(slot)).toContain("No kill was tested by the registered pilot.");
    // the hand-written cards that repeat these numbers
    expect(html).toContain(`the pilot counted ${levels.S0}, ${levels.S1} and ${levels.S2} levels on S0, S1 and S2`);
  });

  it("Amendment 1: both kills EXPLORATION-NO-HORIZON, the effect row and the horizon as the record gives them", () => {
    expect(exp1).toMatch(/^- \*\*Labels \(A1\.4\):\*\* rung S0 \(the removal kill\) \*\*EXPLORATION-NO-HORIZON\*\* \(row 3\); rung V \(the vacancy kill on S0\)\n {2}\*\*EXPLORATION-NO-HORIZON\*\* \(row 3\)\./m);
    const slot = block("exploration-1");
    const text = textOf(slot);
    expect(slot).toContain('<span class="stat" data-role="status">Exploration · no horizon</span>');
    expect(text).toContain("Removal kill: EXPLORATION-NO-HORIZON (row 3). Vacancy kill: EXPLORATION-NO-HORIZON (row 3).");
    expect(block("summary")).toContain("Amendment 1: EXPLORATION-NO-HORIZON for both kills · exploration");
    // row 2, from the record's own sentence
    expect(exp1).toContain("the removal kill worked at rate 64 at all three spreads");
    expect(exp1).toContain("the vacancy kill worked at rates 64 and 256 at all three spreads and at 4096 at spreads 6 and 16");
    expect(text).toContain("Removal: rate 64 at all three spreads. Vacancy: rate 64 at all three spreads; rate 256 at all three spreads; rate 4096 at spreads 6 and 16.");
    // row 3: the first losses of the controls
    expect(exp1).toContain("first sustained loss (run step) 177000, 101000, inf; T_ctl 177000; h0 none");
    expect(text).toContain("at run steps 177,000 and 101,000");
    expect(text).toContain("first sustained loss at run steps 177,000, 101,000, none: T_ctl = 177,000");
    // the screen tables: a bold cell exactly where the record says "yes"
    for (const [rung, title] of [["S0", "Rung S0 (removal kill)"], ["V", "Rung V (vacancy kill on S0)"]] as const) {
      const sec = exp1.slice(exp1.indexOf(`### ${title}`), exp1.indexOf("G0.4 horizon", exp1.indexOf(`### ${title}`)));
      const works = [...sec.matchAll(/^\| (\d+) \| (\d+) \| ([A-Z ]+) \| (\d) \| yes \|$/gm)].length;
      expect(works, rung).toBeGreaterThan(0);
      const table = rung === "S0" ? slot.slice(slot.indexOf("Removal kill (rung S0)"), slot.indexOf("Vacancy kill (rung V on S0), the same")) : slot.slice(slot.indexOf("Vacancy kill (rung V on S0), the same"));
      expect([...table.matchAll(/<td class="works">/g)], rung).toHaveLength(works);
    }
  });

  it("Amendment 2: horizon kept, removal EXPLORATION-2-NO-CONFIRM, vacancy EXPLORATION-2-PERSISTS on 2 of 3 seeds with the record's chi_fw", () => {
    expect(exp2).toMatch(/the removal kill \(rung S0\) \*\*EXPLORATION-2-NO-CONFIRM\*\*; the vacancy kill \(rung V on S0\) \*\*EXPLORATION-2-PERSISTS\*\*/);
    expect(exp2).toContain("T_ctl inf; h0 200000");
    const slot = block("exploration-2");
    const text = textOf(slot);
    expect(slot).toContain('<span class="stat" data-role="status">Exploration · vacancy kill persists</span>');
    const dc = [...exp2.matchAll(/^\| g2-confirm-V-sp8-r64-s(\d+) \| V \| vacancy \| g0\.confirm \| 256x256x4 \| 8 \| 64 \| \d+ \| \d+ \| DC \| ([0-9.]+) \|/gm)];
    expect(dc.map((m) => m[1])).toEqual(["401", "402"]);
    const removalDc = [...exp2.matchAll(/^\| g2-confirm-S0-[^|]+\| S0 \| removal \|[^\n]*\| DC \|/gm)];
    expect(removalDc).toHaveLength(0);
    expect(text).toContain(`Removal kill: EXPLORATION-2-NO-CONFIRM (0 of 3 DC). Vacancy kill: EXPLORATION-2-PERSISTS (2 of 3 DC, chi_fw ${dc[0][2]} and ${dc[1][2]}).`);
    expect(text).toContain('"Persists" means only that: 2 of 3 seeds over 200,000 steps, at one world size and one kill rate.');
    expect(text).toContain("All three controls kept every label: T_ctl infinite, h0 = 200,000.");
    expect(block("summary")).toContain("Amendment 2: vacancy kill persists, 2 of 3 seeds · exploration");
    // the hand-written sentences that repeat these numbers
    expect(html).toContain("the vacancy kill kept the cycle going on 2 of 3 seeds");
    expect(html).toContain("\"Persists\" means 2 of 3 seeds over 200,000 steps at one world shape and one kill rate");
  });

  it("never lets an exploration read as GO or as a registered result", () => {
    for (const b of ["exploration-1", "exploration-2"] as const) {
      const t = textOf(block(b));
      for (const m of t.matchAll(/\bGO\b/g)) expect(t.slice(Math.max(0, m.index! - 6), m.index! + 2), `${b}: GO only as "never GO"`).toBe("never GO");
      expect(t, b).toContain("not a result");
      expect(t, b).toContain("nothing here passes Gate 0");
      expect(t, b).not.toMatch(/\bRegistered\b/);
    }
    for (const chip of block("summary").matchAll(/<li class="chip (\w+)">([^<]*)<\/li>/g)) {
      if (/Amendment/.test(chip[2])) {
        expect(chip[1], chip[2]).toBe("expl");
        expect(chip[2], chip[2]).toMatch(/· exploration$/);
      }
      expect(chip[2], chip[2]).not.toMatch(/(^|[^-])\bGO\b/);
    }
    // the only labels on the page are the records' labels
    const recorded = new Set([...`${exp1}\n${exp2}`.matchAll(/\bEXPLORATION(-2)?-[A-Z]+(-[A-Z]+)*\b/g)].map((m) => m[0]));
    for (const m of html.matchAll(/\bEXPLORATION(-2)?-[A-Z]+(-[A-Z]+)*\b/g)) expect(recorded.has(m[0]), m[0]).toBe(true);
    for (const m of html.matchAll(/\bLAT-[A-Z]+\b/g)) expect(["LAT-PASS", "LAT-CAVEAT", "LAT-OFFSET", "LAT-TREND", "LAT-NOCROSS"]).toContain(m[0]);
  });

  it("calls the pictures re-runs of pilot jobs, not results, and names the job of each", () => {
    const pics = block("pictures");
    expect(html).toContain("Pictures · re-runs of pilot jobs, not results");
    for (const job of ["g0-scan-S0-sp8-r0-s401", "g0-table-S0-sp8-r64-s401", "g0-table-V-sp6-r256-s401", "g0-table-V-sp8-r64-s401"]) {
      expect(pics, job).toContain(`<code>${job}</code>`);
      expect(`${gate0}\n${exp1}`, `${job} is a job of a record`).toContain(`| ${job} |`);
    }
    expect(exp2).toContain("| g2-confirm-V-sp8-r64-s401 |");
  });

  it("stays under the size budget, and inlines every media file of docs/3d-cyclic-rps-media/ under its cap", () => {
    expect(Buffer.byteLength(html, "utf8"), "page bytes").toBeLessThanOrEqual(PAGE_BUDGET);
    for (const f of readdirSync(MEDIA_DIR)) {
      const bytes = readFileSync(join(MEDIA_DIR, f));
      const cap = f.endsWith(".gif") ? MEDIA_CAPS.gif : f.endsWith(".png") ? MEDIA_CAPS.png : -1;
      expect(cap, `${f} is a png or a gif`).toBeGreaterThan(0);
      expect(statSync(join(MEDIA_DIR, f)).size, f).toBeLessThanOrEqual(cap);
      expect(html.includes(bytes.toString("base64")), `${f} is inlined in the page`).toBe(true);
    }
  });

  it("shows the 256 x 256 x 4 animation when its file is there, and says it is being rendered when it is not", () => {
    const dir = mkdtempSync(join(tmpdir(), "rps-media-"));
    try {
      for (const f of readdirSync(MEDIA_DIR)) if (f !== ANIM_256 && f !== ANIM_256_POSTER) copyFileSync(join(MEDIA_DIR, f), join(dir, f));
      const without = buildResults({ mediaDir: dir }).pictures;
      expect(without.includes('data-role="anim-256"'), "the 256 slot").toBe(true);
      expect(without.includes("Being rendered"), "the 256 slot").toBe(true);
      expect(without.includes(REBUILD_256.replace(/&/g, "&amp;")), "the slot gives the rebuild command").toBe(true);
      expect(without.includes("The bigger world.</b> The vacancy kill"), "The bigger world.</b> The vacancy kill").toBe(false);
      // a tiny GIF (1 x 1) and PNG poster stand in for the real files
      const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
      writeFileSync(join(dir, ANIM_256), gif);
      // an animation without its poster has nothing to pause to: refused, not drawn without a button
      expect(() => buildResults({ mediaDir: dir })).toThrow(/needs its poster/);
      writeFileSync(join(dir, ANIM_256_POSTER), png);
      const both = buildResults({ mediaDir: dir }).pictures;
      expect(both.includes("Being rendered"), "Being rendered").toBe(false);
      expect(both.includes(`<img data-role="anim-gif" src="data:image/gif;base64,${gif.toString("base64")}" width="1" height="1"`), "the 256 GIF").toBe(true);
      expect(both.includes(`<img data-role="anim-poster" src="data:image/png;base64,${png.toString("base64")}" width="1" height="1"`), "the 256 poster").toBe(true);
      expect(both.includes('<figure class="pic" data-anim="256-V-r64-s401" data-playing="true">'), "the 256 figure").toBe(true);
      expect(both.includes("<code>g2-confirm-V-sp8-r64-s401</code>"), "the 256 slot").toBe(true);
      // a file over its cap is refused, not inlined
      writeFileSync(join(dir, ANIM_256), Buffer.concat([gif, Buffer.alloc(MEDIA_CAPS.gif)]));
      expect(() => buildResults({ mediaDir: dir })).toThrow(/over its cap/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // and the committed page matches the committed media folder, whichever way it is
    const has = readdirSync(MEDIA_DIR).includes(ANIM_256);
    expect(block("pictures").includes("Being rendered"), `the page's 256 slot; ${REGENERATE}`).toBe(!has);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The pictures: what the captions admit, and the pause buttons
// ---------------------------------------------------------------------------------------------------------------------

describe("companion page: the pictures' captions and pause buttons", () => {
  const pics = block("pictures");
  const figures = [...pics.matchAll(/<figure class="pic"( data-anim="([\w-]+)" data-playing="true")?>([\s\S]*?)<\/figure>/g)];
  const anims = figures.filter((f) => f[2] !== undefined);
  const spacing: Record<string, string> = {
    "V-sp8-r64": "one frame every 200 run steps at 128 × 128 × 4 cannot rule out a slow rotation",
    "256-V-r64-s401": "one frame every 2,000 run steps at 256 × 256 × 4 cannot rule out a slow rotation",
  };

  it("every picture says no spirals were seen, and each animation says what its frame spacing cannot rule out", () => {
    expect(figures.length).toBe(1 + anims.length);
    for (const [, , key, body] of figures) {
      const cap = textOf(/<figcaption>([\s\S]*?)<\/figcaption>/.exec(body)![1]);
      expect(cap, key ?? "the sheet").toContain(`${NO_SPIRALS}.`);
      if (key === undefined) expect(cap).toContain("five snapshots between run steps 0 and 20,000 cannot rule out a slow rotation");
      else expect(cap, key).toContain(spacing[key]);
    }
    expect(anims.map((a) => a[2])).toEqual(readdirSync(MEDIA_DIR).includes(ANIM_256) ? ["V-sp8-r64", "256-V-r64-s401"] : ["V-sp8-r64"]);
  });

  it("each animation has a GIF, its poster (hidden at first) and a real button, hidden until the script wires it", () => {
    for (const [, , key, body] of anims) {
      expect(/<img data-role="anim-gif" src="data:image\/gif;base64,/.test(body), key).toBe(true);
      expect(/<img data-role="anim-poster" src="data:image\/png;base64,[^"]+" width="\d+" height="\d+" alt="Still sheet of the same run: [^"]+" loading="lazy" decoding="async" hidden>/.test(body), key).toBe(true);
      expect(body, key).toContain('<button class="btn animbtn" type="button" data-role="anim-toggle" hidden>Pause animation</button>');
    }
    // the page's CSS: a hidden image stays hidden, the button has the shared focus ring, and reduced motion without the script shows the poster
    expect(html).toContain(".pic img[hidden], .pic button[hidden] { display: none; }");
    expect(html).toMatch(/button:focus-visible[^{]*\{ outline: 2px solid/);
    expect(html).toContain('.pic[data-anim]:not([data-js]) img[data-role="anim-poster"] { display: block; }');
    // the page's script calls the toggle with the reader's motion preference
    expect(html).toContain('wireAnimations(document, matchMedia("(prefers-reduced-motion: reduce)").matches);');
  });

  /** A stand-in for the DOM the toggle touches: figures with two images and a button. */
  function fakeDom(n: number) {
    const el = () => ({ hidden: false, textContent: "", dataset: {} as Record<string, string>, listeners: [] as (() => void)[], addEventListener(_t: string, f: () => void) { this.listeners.push(f); } });
    const figs = Array.from({ length: n }, () => {
      const parts = { gif: el(), poster: { ...el(), hidden: true }, btn: { ...el(), hidden: true, textContent: "Pause animation" } };
      const fig = { ...el(), dataset: { playing: "true" } as Record<string, string>, parts, querySelector: (sel: string) => (sel.includes("anim-gif") ? parts.gif : sel.includes("anim-poster") ? parts.poster : sel.includes("anim-toggle") ? parts.btn : null) };
      return fig;
    });
    return { figs, root: { querySelectorAll: (sel: string) => (sel === "figure[data-anim]" ? figs : []) } };
  }
  const toggle = new Function(`"use strict";\n${extractBlock(html, "// BEGIN animation toggle", "// END animation toggle")}\nreturn wireAnimations;`)() as (root: unknown, reduce: boolean) => number;

  it("the button swaps the GIF for its poster and back, and its name says what a press does", () => {
    const { figs, root } = fakeDom(2);
    expect(toggle(root, false)).toBe(2);
    for (const f of figs) {
      const { gif, poster, btn } = f.parts;
      expect([gif.hidden, poster.hidden, btn.hidden, btn.textContent, f.dataset.js]).toEqual([false, true, false, "Pause animation", "true"]);
      btn.listeners.forEach((l) => l()); // a click (a keyboard press on a <button> is a click)
      expect([gif.hidden, poster.hidden, btn.textContent, f.dataset.playing]).toEqual([true, false, "Play animation", "false"]);
      btn.listeners.forEach((l) => l());
      expect([gif.hidden, poster.hidden, btn.textContent, f.dataset.playing]).toEqual([false, true, "Pause animation", "true"]);
    }
    // each button drives its own figure
    figs[0].parts.btn.listeners.forEach((l) => l());
    expect([figs[0].parts.gif.hidden, figs[1].parts.gif.hidden]).toEqual([true, false]);
  });

  it("under prefers-reduced-motion every animation starts on its poster, and Play still plays it", () => {
    const { figs, root } = fakeDom(2);
    toggle(root, true);
    for (const f of figs) {
      expect([f.parts.gif.hidden, f.parts.poster.hidden, f.parts.btn.textContent]).toEqual([true, false, "Play animation"]);
      f.parts.btn.listeners.forEach((l) => l());
      expect([f.parts.gif.hidden, f.parts.poster.hidden, f.parts.btn.textContent]).toEqual([false, true, "Pause animation"]);
    }
  });
});

describe("companion page: Amendment 1's coverage", () => {
  it("says three of S0's four levels were screened, as the record has them, and never that all four were", () => {
    const g = /^B_meter = \d+; G_spread = \[([\d, ]+)\]/m.exec(exp1)![1].split(", ").map(Number);
    const tested = [...new Set([...exp1.matchAll(/^\| (\d+) \| (\d+) \| [A-Z ]+ \| \d \| (?:yes|no|\(control\)) \|$/gm)].map((m) => Number(m[1])))].sort((a, b) => a - b);
    expect(g).toEqual([6, 8, 10, 16]);
    expect(tested).toEqual([6, 8, 16]);
    expect(textOf(block("exploration-1"))).toContain("at three of the four mixing speeds the slab has (spreads 6, 8 and 16; 10 was not screened)");
    expect(html).not.toMatch(/on the four mixing speeds|at (all )?(the )?four mixing speeds|four spreads/);
  });
});
