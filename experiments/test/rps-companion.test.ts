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
//   * The page's contract: self-contained (no external script, style or font), the theme tokens and both colour schemes, a title of
//     two to four words, every result slot present and labelled "Not yet run", a filled slot naming its file, hash and date, seeds
//     outside the registered block (Appendix A), and presets whose captions are true of the module.
// Seeds: the presets use 900 and up (Appendix A: plumbing only); the registered block 2,000,000+ is never run here.
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { createLattice, gridHash, runSteps, setMobility, stateHash, M_GRID, type LatticeState } from "../3d-rps/rmf-lattice.ts";
import {
  CHECK_BEGIN,
  CHECK_END,
  COPY_BEGIN,
  COPY_END,
  LATTICE_PATH,
  PAGE_PATH,
  buildPage,
  codeHash,
  extractBlock,
  renderSelfCheck,
  selfCheckValues,
  spliceBlock,
} from "../3d-rps/companion-build.ts";

const html = readFileSync(PAGE_PATH, "utf8");
const source = readFileSync(LATTICE_PATH, "utf8");
const copy = extractBlock(html, COPY_BEGIN, COPY_END);
const REGENERATE = "regenerate with: PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH node experiments/3d-rps/companion-build.ts --write";

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
    const bare = (page: string) => spliceBlock(spliceBlock(page, COPY_BEGIN, COPY_END, ""), CHECK_BEGIN, CHECK_END, "");
    expect(bare(built)).toBe(bare(html));
    expect(buildPage(built)).toBe(built);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------------------------

describe("companion page: contract", () => {
  it("is one file: no external script, style or font, and links only to the plan and to arXiv", () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import|url\(\s*["']?(https?:)?\/\//i);
    expect(html).not.toMatch(/<(img|iframe|video|audio|source|embed|object)\b/i);
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

  it("has every result slot, each labelled Not yet run, and no slot filled without a file, a hash and a date", () => {
    const data = JSON.parse(/<script type="application\/json" id="results-data">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(data.format).toBe("rps-companion-results/1");
    const keys = ["lattice-pext", "gate0", "meter", "calibration", "sweep", "snapshots", "deep", "cycles", "mutation"];
    expect(Object.keys(data.slots).sort()).toEqual([...keys].sort());
    const articles = [...html.matchAll(/<article class="slot" id="slot-([\w-]+)" data-slot="([\w-]+)" data-state="empty">([\s\S]*?)<\/article>/g)];
    expect(articles.map((a) => a[2]).sort()).toEqual([...keys].sort());
    for (const [, id, key, body] of articles) {
      expect(id).toBe(key);
      expect(body, `slot ${key}`).toMatch(/<span class="stat" data-role="status">Not yet run<\/span>/);
      expect(body, `slot ${key}`).toMatch(/data-role="frame">Empty: /);
      for (const label of ["Will show", "Read by", "Runs", "Filled from"]) expect(body, `slot ${key} says "${label}"`).toContain(`<dt>${label}</dt>`);
    }
    for (const [key, v] of Object.entries<unknown>(data.slots)) {
      if (v === null) continue; // not yet run
      const e = v as { file?: unknown; sha256?: unknown; date?: unknown; data?: unknown };
      expect(typeof e.file, `slot ${key} names its file`).toBe("string");
      expect(String(e.sha256), `slot ${key} gives the file's SHA-256`).toMatch(/^[0-9a-f]{64}$/);
      expect(String(e.date), `slot ${key} gives a date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.data, `slot ${key} has data`).not.toBeUndefined();
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
