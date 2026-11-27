// The story page (/story/): its ladder, the reach of each world, and the settings of its live jars.
// The generated blocks are kept in sync by experiments-ledger.test.ts; this file holds what must stay true of
// the data behind them and of the page around them.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dialDefaults as roamDialDefaults, dialOptions as roamDialOptions } from "../src/roam/dials.ts";
import { foundRoam } from "../src/roam/view.ts";
import { dialDefaults as softDialDefaults, dialOptions as softDialOptions } from "../src/softroam/dials.ts";
import { foundSoftRoam } from "../src/softroam/view.ts";
import { JARS, SEEN_SEEDS, freshSeed, roamLine, roamOptions, softRoamOptions, softRoamSeed, type JarId } from "../src/story/jars-spec.ts";
import { HERE, LADDER_WORLD, MADE, REACHES, RUNGS } from "../src/story/ladder.ts";
import { renderCounts, renderLadder, renderReach } from "../src/story/render-ladder.ts";

const lab = fileURLToPath(new URL("../", import.meta.url));
const story = readFileSync(`${lab}story/index.html`, "utf8");
const config = readFileSync(`${lab}vite.config.ts`, "utf8");
const built = new Set([...config.matchAll(/r\("\.\/([a-z0-9/-]+)\/index\.html"\)/g)].map((m) => `/${m[1]}/`));

describe("the ladder", () => {
  it("has its rungs in order, and we stand on the lowest one that does not hold", () => {
    expect(RUNGS.map((r) => r.n)).toEqual(RUNGS.map((_, i) => i + 1));
    expect(RUNGS.find((r) => r.n === HERE)).toBeDefined();
    // Below where we are everything is seen (never more than seen); from there up nothing is.
    for (const r of RUNGS) {
      if (r.n < HERE) expect(r.state, r.name).toBe("Seen");
      else expect(r.state, r.name).not.toBe("Seen");
    }
  });

  it("never says more than seen: no rung is called confirmed or measured", () => {
    const html = renderLadder();
    expect(html).not.toMatch(/Confirmed|Measured|state observed/);
    expect(html).toContain(`Seen · ${LADDER_WORLD.seeds}`);
    expect(html.match(/We are here/g)).toHaveLength(1);
    expect(html).toContain("Nothing on this ladder has been confirmed");
  });

  it("places every world on a rung, links only pages the site builds, and ends where we are", () => {
    for (const w of REACHES) {
      expect(w.rung, w.world).toBeGreaterThanOrEqual(1);
      expect(w.rung, w.world).toBeLessThanOrEqual(HERE);
      if (w.href) {
        expect(existsSync(`${lab}${w.href.slice(1)}index.html`), w.href).toBe(true);
        expect(built.has(w.href), `${w.href} is not in the site build`).toBe(true);
      }
    }
    const last = REACHES.at(-1)!;
    expect(last.rung).toBe(HERE);
    // The world we are in has no page in the site build: its jars on the story are the only way to it.
    expect(last.href).toBeUndefined();
    expect(REACHES.filter((w) => w.now)).toEqual([last]);
    expect(renderReach().match(/<li>/g)).toHaveLength(REACHES.length);
  });

  it("counts the work from the ledger and from dated figures", () => {
    const html = renderCounts();
    expect(html).toContain(String(MADE.commits.toLocaleString("en-GB")));
    expect(html.match(/<li>/g)).toHaveLength(6);
    const days = Math.round((Date.parse(MADE.asOf) - Date.parse(MADE.first)) / 86_400_000);
    expect(MADE.days).toBe(days);
  });
});

describe("the story's live jars", () => {
  it("has a figure for every jar, with a still picture that exists and a button that waits for the script", () => {
    const figures = [...story.matchAll(/<figure class="story-jar" data-jar="([a-z]+)">([\s\S]*?)<\/figure>/g)];
    expect(figures.map((f) => f[1]).sort()).toEqual(Object.keys(JARS).sort());
    for (const [, id, body] of figures) {
      const src = /<img src="([^"]+)" alt="([^"]+)"/.exec(body);
      expect(src, id).not.toBeNull();
      expect(existsSync(`${lab}public${src![1]}`), src![1]).toBe(true);
      expect(src![2].length, `${id} alt text`).toBeGreaterThan(40);
      expect(body, id).toMatch(/<button class="button primary jar-play" type="button" disabled>Grow it<\/button>/);
      for (const cls of ["jar-again", "jar-choices", "jar-line", "jar-says", "jar-note"]) expect(body, `${id} ${cls}`).toMatch(new RegExp(`class="[^"]*\\b${cls}"`));
      expect(body, id).toContain("<figcaption>");
    }
    expect(story).toContain(`<script type="module" src="/src/story/jars.ts"></script>`);
  });

  it("links neither the Roam pages, which the site does not build, nor the prototype pages it keeps unlisted", () => {
    expect(built.has("/roam/")).toBe(false);
    expect(built.has("/softroam/")).toBe(false);
    expect(story).not.toMatch(/href="\/(soft)?roam\//);
    // Unlisted on purpose (bodies-packaging.test.ts, dropgenes-viewer.test.ts, and the ledger test's own list).
    for (const page of ["bodies", "vesicle", "oligomer", "dropgenes"]) {
      expect(story, page).not.toContain(`/${page}/`);
      for (const f of ["src/story/ladder.ts", "src/story/jars.ts", "src/story/jars-spec.ts", "src/story/story.css"]) expect(readFileSync(`${lab}${f}`, "utf8"), `${f} ${page}`).not.toContain(page === "bodies" ? "/bodies/" : page);
    }
  });

  it("says what each choice does, and starts on the first", () => {
    for (const id of Object.keys(JARS) as JarId[]) {
      const jar = JARS[id];
      expect(jar.id).toBe(id);
      expect(jar.choices.length, id).toBeGreaterThanOrEqual(2);
      expect(new Set(jar.choices.map((c) => c.id)).size).toBe(jar.choices.length);
      for (const c of jar.choices) expect(c.says.length, `${id} ${c.id}`).toBeGreaterThan(40);
      expect(jar.pace).toBeGreaterThan(0);
    }
  });

  it("Roam: its own page's world on seed 1, with kinds of cell on or off", () => {
    const page = roamDialOptions({ seed: 1, size: 128, start: "grown-all", compost: true, kinds: true, toughness: false }, roamDialDefaults());
    expect(roamOptions("kinds")).toEqual(page);
    const alike = roamOptions("alike");
    expect(alike.kinds).toBe(false);
    expect([alike.seed, alike.size, alike.start]).toEqual([page.seed, page.size, page.start]);
    expect(SEEN_SEEDS).toContain(roamOptions("kinds").seed);
    for (const choice of ["kinds", "alike"]) {
      const world = foundRoam(roamOptions(choice));
      for (let i = 0; i < 20; i++) world.stepOnce();
      expect(world.census().residual, choice).toBe(0);
    }
  });

  it("Soft Roam: its own page's big bodies start, on a seen seed or one nobody has looked at", () => {
    const page = softDialOptions({ seed: 2, size: 128, start: "bodies", kinds: true, toughness: false }, softDialDefaults("bodies"));
    expect(softRoamOptions(2)).toEqual(page);
    expect(softRoamSeed("seed-1", 0.5)).toBe(1);
    expect(softRoamSeed("seed-2", 0.5)).toBe(2);
    for (const u of [0, 0.0001, 0.25, 0.5, 0.9999]) {
      const seed = softRoamSeed("fresh", u);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(5);
      expect(seed).toBeLessThanOrEqual(9999);
    }
    expect(freshSeed(0)).toBe(5);
    expect(freshSeed(1)).toBe(9999);
    const world = foundSoftRoam(softRoamOptions(1));
    for (let i = 0; i < 20; i++) world.stepOnce();
    expect(world.census().residual).toBe(0);
  });

  it("writes one plain line under a running jar", () => {
    const c = { step: 6000, cells: 438, bodies: 71, largest: 19, mouths: 15, shells: 26, residual: 0 };
    expect(roamLine(c, true)).toBe("Step 6,000 · 438 cells in 71 bodies · largest 19 · 15 mouths, 26 shells · matter balanced");
    expect(roamLine(c, false)).toBe("Step 6,000 · 438 cells in 71 bodies · largest 19 · matter balanced");
    expect(roamLine({ ...c, residual: 3 }, false)).toContain("matter off by 3");
  });
});

describe("the story page", () => {
  it("tells three acts in order, each chapter inside its act", () => {
    const order = [...story.matchAll(/<section class="(?:act|shell prose-grid)" id="((?:act|chapter)-\d+)">/g)].map((m) => m[1]);
    expect(order).toEqual(["act-1", "chapter-1", "chapter-2", "chapter-3", "chapter-4", "chapter-5", "chapter-6", "chapter-7", "act-2", "chapter-8", "act-3", "chapter-9"]);
  });

  it("keeps one h1, acts as h2 and chapter questions as h3", () => {
    expect(story.match(/<h1/g)).toHaveLength(1);
    for (const m of story.matchAll(/<section class="shell prose-grid" id="chapter-\d+">[\s\S]*?<\/section>/g)) {
      expect(m[0]).not.toContain("<h2");
      expect(m[0].match(/<h3>/g)).toHaveLength(1);
    }
  });

  it("marks what Roam shows as seen, and says the confirmation is owed", () => {
    const roam = /id="chapter-9">([\s\S]*?)<\/section>/.exec(story)![1];
    expect(roam).not.toContain(`state observed">`);
    for (const m of roam.matchAll(/<figcaption><span class="state ([a-z]+)">([^<]+)</g)) expect([m[1], m[2]]).toEqual(["pending", "Seen, not measured"]);
    expect(roam).toContain("Seen, not measured");
    expect(roam).toContain("it is owed");
  });
});
