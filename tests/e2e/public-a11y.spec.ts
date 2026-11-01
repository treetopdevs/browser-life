/// <reference types="node" />
// (node:fs reads the sitemap; the reference brings @types/node globals into the whole tsc program, as in
// public-routes.spec.ts.)
// Release checks for accessibility and resilience on this machine (docs/release-checks-2026-10-18.md, criterion 5):
// axe over every public route at two widths in day and night colours, the keyboard (skip link, every control by Tab
// and Shift+Tab with a visible ring that contrasts in both colours, header order, the Day/Night button, the lab's
// Browse all worlds dialog and Session card), the lab's Pond keeper (family tree, firsts log, Next up) on the breeder
// at t=500, reduced motion, and what a visitor sees without WebGPU. Run it with
// `npx playwright test tests/e2e/public-a11y.spec.ts --project=chrome`.
import { AxeBuilder } from "@axe-core/playwright";
import { METRICS_VERSION } from "@bl/schema";
import { chromium, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import contractFixture from "../../apps/coordinator/priv/static/garden-contract.example.json" with { type: "json" };

test.describe.configure({ mode: "parallel" });
// Chrome only. WebKit's Tab skips links unless the system setting is on, Playwright's WebKit has no OPFS for the lab,
// and the GPU and keyboard-modality behaviour checked here is Chrome's; other engines are listed as not claimed.
test.skip(({ browserName }) => browserName !== "chromium", "accessibility release checks are Chrome-only (see criterion 5)");

const FIXTURE = contractFixture as Record<string, any>;
const SITEMAP = fileURLToPath(new URL("../../apps/lab/public/sitemap.xml", import.meta.url));
/** Every page the sitemap lists, as paths (the shared garden among them). */
const ROUTES = [...readFileSync(SITEMAP, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
/** What an unknown path answers: the not-found page, with 404 (criterion 6). */
const NOT_FOUND = "/no-such-page/";
/** The island page is where Join in sends people; it is unlisted (noindex) but public. So is the not-found page. */
const PAGES = [...ROUTES, "/island.html", NOT_FOUND];
const expectedStatus = (path: string) => (path === NOT_FOUND ? 404 : 200);
const WIDTHS = [{ width: 1280, height: 900 }, { width: 375, height: 812 }];
/** WCAG 2.0, 2.1 and 2.2 at A and AA. `best-practice` is off: it is advice, not a WCAG failure. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const THEME_KEY = "browser-life-theme";
const HOME_TITLE = /^Cadence Garden · Artificial life/;

/**
 * Serious or critical axe findings that are let through, each with its reason. `kind` says whether axe found a
 * violation or could not decide (an `incomplete`, which fails the run too unless it is reviewed here). `target` is
 * axe's selector for the node, joined with spaces. An entry that no longer matches anything on its route and width
 * fails the run as stale.
 */
type AxeExclusion = { route: string; kind: "violation" | "incomplete"; rule: string; target: string | RegExp; widths?: number[]; reason: string };
const targetMatches = (e: AxeExclusion, target: string) => (typeof e.target === "string" ? e.target === target : e.target.test(target));
const AXE_EXCLUSIONS: AxeExclusion[] = [
  // Reviewed by hand: at 375 the view picker scrolls sideways (DESIGN.md keeps view modes reachable that way, without
  // page overflow) and clips these four, so axe cannot see what is behind them. They wear the same `.seg button`
  // colours as the five view buttons axe passes beside them: --muted on the page's --bg, 6.3:1 by day and 7.4:1 at
  // night (from tokens.css); lit, ink on the sun as the composite button axe passes. scan() measures each one's text
  // against what is under it and fails under 4.5:1, so this reason cannot go stale.
  ...["/lab/", "/lab/ (pond keeper)", "/lab/ (pond keeper, family tree in full)"].flatMap((route) => ["signal", "affinity", "light", "membrane"].map((mode): AxeExclusion => (
    { route, kind: "incomplete", rule: "color-contrast", target: `button[data-mode="${mode}"]`, widths: [375], reason: "reviewed: same colours as the view buttons axe passes" }))),
  // Reviewed by hand: the Session card's hint lines that wrap. axe finds the colours under each line of text through
  // its own model of what is stacked there, which for a modal dialog runs on into the inert page behind it; a page
  // element differs from one line to the next, so axe cannot decide. Each line sits on the card bar's opaque --surface
  // (the dialog is over everything), --muted on --surface: 7.1:1 by day and 7.0:1 at night, from tokens.css. The
  // card's other hint lines, in its scrolling body, axe passes. A plain background on the line does not settle it.
  { route: "/lab/ (Session card open)", kind: "incomplete", rule: "color-contrast", target: "#card-file-note", reason: "reviewed: --muted on the card bar's --surface, 7:1" },
  { route: "/lab/ (Session card open)", kind: "incomplete", rule: "color-contrast", target: ".card-head > div > .hint", widths: [375], reason: "reviewed: --muted on the card bar's --surface, 7:1" },
  // Reviewed by hand: the arrow in Open the lab is aria-hidden decoration in the same ink on the same sun fill as
  // the button's label, which axe passes (about 11:1 in both colours, from the tokens); axe cannot decide it only
  // because it is a single glyph.
  { route: "/", kind: "incomplete", rule: "color-contrast", target: '.primary > span[aria-hidden="true"]', reason: "reviewed: same colours as the label it follows" },
];

/**
 * Keyboard findings that are let through. `check` is what failed: "ring" (no solid outline of 2px or more on the
 * focused element), "contrast" (the ring is under 3:1 against what is behind it), "rest" (the element wears a ring
 * when it is not focused), "hidden" (something else is drawn at its centre), "missed" (Tab never reached it), "extra"
 * (Tab reached something not counted as a control), "first" (the first Tab on a fresh page focused it, not the skip
 * link) or "order" (header controls reached out of the order they are drawn in). `target` is the element as
 * `describe` below names it.
 */
type KeyCheck = "first" | "ring" | "contrast" | "rest" | "hidden" | "missed" | "extra" | "order";
type KeyExclusion = { route: string; check: KeyCheck; target: string; widths?: number[]; reason: string };
const KEY_EXCLUSIONS: KeyExclusion[] = [];

/** Motion left on under `prefers-reduced-motion: reduce`, each with its reason. */
const MOTION_EXCLUSIONS: { route: string; target: string; reason: string }[] = [];

/**
 * What moves on the page as it stands: CSS animations and transitions longer than 0 s on any element, its ::before
 * and ::after, and an open modal dialog's ::backdrop; and any animation running (element.animate included).
 */
const motionNow = (page: Page) => page.evaluate(() => {
  const seconds = (v: string) => v.split(",").map((s) => parseFloat(s) * (s.trim().endsWith("ms") ? 0.001 : 1));
  const moving: string[] = [];
  const name = (el: Element, pseudo: string) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].map((c) => `.${c}`).join("")}${pseudo}`;
  for (const el of document.querySelectorAll("*")) {
    for (const pseudo of ["", "::before", "::after", "::backdrop"]) {
      if (pseudo === "::backdrop" && !el.matches(":modal")) continue;
      const cs = getComputedStyle(el, pseudo || null);
      if ((pseudo === "::before" || pseudo === "::after") && cs.content === "none") continue;
      if (cs.animationName !== "none" && seconds(cs.animationDuration).some((d) => d > 0)) moving.push(`animation on ${name(el, pseudo)}`);
      if (seconds(cs.transitionDuration).some((d) => d > 0)) moving.push(`transition on ${name(el, pseudo)}`);
    }
  }
  const running = document.getAnimations().filter((a) => a.playState === "running").map((a) => {
    const target = (a.effect as KeyframeEffect | null)?.target;
    return `running ${a.constructor.name} on ${target ? name(target, "") : "nothing"}`;
  });
  return { scroll: getComputedStyle(document.documentElement).scrollBehavior, moving: [...moving, ...running] };
});

/** With `prefers-reduced-motion: reduce` turned on, nothing moves on the page as it stands but what is listed. */
async function expectStill(page: Page, route: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const after = await motionNow(page);
  expect(after.scroll).toBe("auto");
  const allowed = MOTION_EXCLUSIONS.filter((e) => e.route === route);
  expect(after.moving.filter((m) => !allowed.some((e) => e.target === m)), `motion left with reduced motion on ${route}`).toEqual([]);
  expect(allowed.filter((e) => !after.moving.includes(e.target)).map((e) => e.target), "stale motion exclusions").toEqual([]);
}

const STATUS_BODY = { counts: { pending: 3, assigned: 2, done: 4, verified: 5 }, activeIslands: 2, deviceTypes: 1, updatedAt: "2026-09-27T12:00:00Z" };

/** The lab has planted its first world (same test as lab-worlds.spec.ts). */
const planted = (page: Page) =>
  expect(page.locator("#simulation-status")).not.toHaveText(/Planting|No world yet|Warming up/, { timeout: 150_000 });

const hasAdapter = (page: Page) => page.evaluate(async () => !!navigator.gpu && (await navigator.gpu.requestAdapter()) !== null);

/** Loads a route in the state worth checking: data in, cards built, details open, fonts loaded, the lab planted. */
async function prepare(page: Page, path: string): Promise<void> {
  if (path === "/status/") {
    await page.route("**/api/public/status", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(STATUS_BODY) }));
  }
  if (path === "/garden/") {
    await page.clock.setFixedTime(FIXTURE.now);
    await page.route("**/api/public/garden", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  }
  const response = await page.goto(path);
  expect(response?.status(), `${path} answers`).toBe(expectedStatus(path));
  await expect(page.locator("main h1").first()).toBeVisible();
  await expectIdentity(page, path);
  if (path === "/status/") await expect(page.locator("#count-islands")).toHaveText("2");
  if (path === "/garden/") await expect(page.locator("#garden-message")).toHaveText("The garden answered.");
  if (path === "/worlds/") await expect(page.locator("#worlds-root .world-card").first()).toBeVisible();
  if (path === "/lab/") {
    test.skip(!(await hasAdapter(page)), "no WebGPU adapter in this browser, so the lab cannot plant a world");
    await planted(page);
  }
  // Collapsed content ("For researchers" on the worlds cards) is checked open; its summary is still a control.
  await page.evaluate(() => { for (const d of document.querySelectorAll("details")) d.open = true; });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** The page served is the one asked for, not the home page (Vite's spa fallback answered a mistyped path with it). */
async function expectIdentity(page: Page, path: string): Promise<void> {
  const { canonical, title } = await page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    title: document.title,
  }));
  if (canonical) expect(new URL(canonical).pathname, `${path} is the page asked for`).toBe(path);
  else expect(title, `${path} is not the home page`).not.toMatch(HOME_TITLE);
}

/** Lets finite CSS transitions and animations end (a colour switch fades buttons for 160 ms). */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
    .map((a) => a.finished.catch(() => undefined))).then(() => undefined));
}

type ScanResult = { failures: string[]; matched: Set<AxeExclusion>; summary: string };

/**
 * One axe pass. Failures are the serious and critical nodes, violations or undecided, not excluded; the rest is
 * attached and summarised.
 */
async function scan(page: Page, info: TestInfo, route: string, width: number, colours: string): Promise<ScanResult> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  await info.attach(`axe ${route} ${width} ${colours}`, {
    body: JSON.stringify({ violations: result.violations, incomplete: result.incomplete }, null, 2),
    contentType: "application/json",
  });
  const failures: string[] = [];
  const matched = new Set<AxeExclusion>();
  const lower: string[] = [];
  const undecided: string[] = [];
  /** Nodes let through as reviewed colour contrast: their text is measured below, so the reason cannot go stale. */
  const reviewedContrast: string[] = [];
  for (const [kind, results] of [["violation", result.violations], ["incomplete", result.incomplete]] as const) {
    for (const v of results) {
      if (v.impact === "minor" || v.impact === "moderate") {
        lower.push(`${kind} ${v.id}/${v.impact}×${v.nodes.length}`);
        continue;
      }
      for (const node of v.nodes) {
        const target = node.target.join(" ");
        if (kind === "incomplete") undecided.push(`${v.id}@${target}`);
        const ex = AXE_EXCLUSIONS.find((e) => e.route === route && e.kind === kind && e.rule === v.id && targetMatches(e, target) && (!e.widths || e.widths.includes(width)));
        if (ex) {
          matched.add(ex);
          if (v.id === "color-contrast" && node.target.length === 1) reviewedContrast.push(String(node.target[0]));
        } else failures.push(`${colours}: ${kind} ${v.id} (${v.impact ?? "no impact"}) at ${target}: ${(node.failureSummary ?? "").replace(/\s+/g, " ")}`);
      }
    }
  }
  if (reviewedContrast.length) {
    await installHelpers(page);
    const measured = await page.evaluate((sels) => sels.map((sel) => {
      const els = [...document.querySelectorAll<HTMLElement>(sel)];
      return { sel, n: els.length, min: Math.min(...els.map((el) => (window as any).__textContrast(el) as number)) };
    }), reviewedContrast);
    for (const m of measured) {
      if (m.n === 0) failures.push(`${colours}: reviewed color-contrast at ${m.sel} matches nothing to measure`);
      else if (m.min < 4.5) failures.push(`${colours}: reviewed color-contrast at ${m.sel} measures ${m.min}:1, under 4.5:1`);
    }
  }
  const summary = `[a11y] ${route} ${width} ${colours}: failing=${failures.length} excluded=${matched.size} lower=${lower.join(",") || "none"} undecided=${undecided.join(",") || "none"}`;
  console.log(summary);
  return { failures, matched, summary };
}

/** Switches to night colours with the page's own button, pressed from the keyboard; without one, as a return visit. */
async function toNight(page: Page): Promise<void> {
  const toggle = page.locator(".theme-toggle").first();
  if (await toggle.count()) {
    await toggle.focus();
    await page.keyboard.press("Enter");
  } else {
    await page.evaluate((key) => localStorage.setItem(key, "dark"), THEME_KEY);
    await page.reload();
    await expect(page.locator("main h1").first()).toBeVisible();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settle(page);
}

const staleAxe = (route: string, width: number, matched: Set<AxeExclusion>) =>
  AXE_EXCLUSIONS.filter((e) => e.route === route && (!e.widths || e.widths.includes(width)) && !matched.has(e)).map((e) => `${e.kind} ${e.rule} at ${e.target}`);

/** Scans the page as it stands in day colours, then in night colours, and fails on anything not excluded. */
async function scanBoth(page: Page, info: TestInfo, route: string, width: number): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const day = await scan(page, info, route, width, "day");
  await toNight(page);
  const night = await scan(page, info, route, width, "night");
  expect([...day.failures, ...night.failures], `serious or critical axe findings on ${route} at ${width}`).toEqual([]);
  expect(staleAxe(route, width, new Set([...day.matched, ...night.matched])), "exclusions that no longer match anything").toEqual([]);
}

for (const route of PAGES) {
  for (const size of WIDTHS) {
    test(`axe: ${route} at ${size.width} in day and night colours`, async ({ page }, info) => {
      await page.setViewportSize(size);
      await prepare(page, route);
      await scanBoth(page, info, route, size.width);
    });
  }
}

/** States a visitor meets that the routes above do not show on load: not found, no answer, a refused form. */
const STATES: { name: string; load: (page: Page) => Promise<void> }[] = [
  {
    name: "/worlds/ with an unknown world linked",
    load: async (page) => {
      await page.goto("/worlds/?world=no-such-world");
      await expect(page.locator("#worlds-root .world-card").first()).toBeVisible();
      await expect(page.locator("#worlds-root .world-card.current")).toHaveCount(0);
    },
  },
  {
    name: "/garden/ answering 404",
    load: async (page) => {
      await page.clock.setFixedTime(FIXTURE.now);
      await page.route("**/api/public/garden", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) }));
      await page.goto("/garden/");
      await expect(page.locator("#garden-message")).toContainText("No garden is planted here yet.");
    },
  },
  {
    name: "/status/ with the coordinator down",
    load: async (page) => {
      await page.route("**/api/public/status", (route) => route.fulfill({ status: 503, body: "" }));
      await page.goto("/status/");
      await expect(page.locator("#status-message")).toHaveText("Live status is unavailable right now. The lab and research notes are still available.");
    },
  },
  {
    name: "/garden/ with a refused stone",
    load: async (page) => {
      await prepare(page, "/garden/");
      await page.route("**/api/public/garden/letters", (route) => route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "r must be an integer in 1..32" }) }));
      await page.locator("#stone-x").fill("100");
      await page.locator("#stone-y").fill("200");
      await page.locator("#stone-r").fill("8");
      await page.locator("#stone-send").click();
      await expect(page.locator("#stone-answer")).toHaveText("The garden refused the stone: r must be an integer in 1..32.");
      // Then a radius the page itself refuses: the why line and an invalid field, with the server's answer still shown.
      await page.locator("#stone-r").fill("33");
      await expect(page.locator("#stone-why")).toHaveText("The radius is a whole number from 1 to 32.");
      await expect(page.locator("#stone-r")).toHaveAttribute("aria-invalid", "true");
    },
  },
];

for (const state of STATES) {
  for (const size of WIDTHS) {
    test(`axe: ${state.name} at ${size.width} in day and night colours`, async ({ page }, info) => {
      await page.setViewportSize(size);
      await state.load(page);
      await scanBoth(page, info, state.name, size.width);
    });
  }
}

/** What `watchCensuses` keeps on the page: the step of every census message the page has received from the lab's worker. */
type CensusWatch = { __censusSteps: number[] };

/**
 * Records every census the lab's worker posts to the page, in the test only: the page's Worker is wrapped before the
 * lab's own script runs, and the listener added in its constructor hears each message before the lab's handler does
 * (so by the next evaluate, the lab has handled every census counted here).
 */
async function watchCensuses(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const steps: number[] = [];
    (window as unknown as CensusWatch).__censusSteps = steps;
    const Base = window.Worker;
    window.Worker = class extends Base {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (e: MessageEvent) => { if (e.data?.type === "census") steps.push(e.data.step); });
      }
    };
  });
}

const censusCount = (page: Page) => page.evaluate(() => (window as unknown as CensusWatch).__censusSteps.length);

/** Waits until `n` more censuses than the first `from` have reached the page, and requires each of them to be of `step`. */
async function waitForCensuses(page: Page, from: number, n: number, step: number): Promise<void> {
  await page.waitForFunction(([from, n]) => (window as unknown as CensusWatch).__censusSteps.length >= from + n, [from, n] as const, { timeout: 120_000 });
  const steps = await page.evaluate((from) => (window as unknown as CensusWatch).__censusSteps.slice(from), from);
  expect(steps.length, `${n} more counts reached the page`).toBeGreaterThanOrEqual(n);
  expect(steps.every((s) => s === step), `every count since is of t=${step} (got ${steps.join(", ")})`).toBe(true);
}

/** The lab's Pond keeper as a visitor meets it once the breeder has grown: the family tree, its log, Next up and the log of firsts. */
const POND = "/lab/ (pond keeper)";
/** Long enough for the breeder to plant and step to t=500 on a busy machine, then for a keyboard walk in both colours. */
const POND_TIMEOUT = 900_000;

/**
 * The breeder (seed 1) stepped by hundreds to t=500, a census at each so the history is the same every run (as in
 * lab-pond-keeper-v2.spec.ts), with every `<details>` open. The steps are clicked by event, not by pointer, so no
 * button takes focus and the first Tab still starts from the top of the page.
 */
async function loadPondKeeper(page: Page): Promise<void> {
  await watchCensuses(page);
  await page.goto("/lab/?world=breeder&seed=1");
  test.skip(!(await hasAdapter(page)), "no WebGPU adapter in this browser, so the lab cannot plant a world");
  await expect(page.locator("#simulation-status")).toHaveText("Paused", { timeout: 300_000 });
  await expect(page.locator("#world-heading")).toHaveText("The breeder");
  for (let t = 100; t <= 500; t += 100) {
    await page.locator("#btn-step100").dispatchEvent("click");
    await expect(page.locator("#chip-step")).toHaveText(`t = ${t}`, { timeout: 300_000 });
  }
  await expect(page.locator("#family-tree li").first()).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("#nextup-list li").first()).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("#firsts-list li").first()).toBeVisible({ timeout: 120_000 });
  // On a loaded machine the count for t=500 can land seconds after the step does, and it rebuilds Biggest lineages
  // once. Wait for it to reach the page, then require the rows to stand still through three more counts of the paused
  // world (one every 600 ms, each with the same answer): rows rebuilt at every count, as before slice 23, fail here.
  await page.waitForFunction(() => (window as unknown as CensusWatch).__censusSteps.includes(500), undefined, { timeout: 300_000 });
  await expect(page.locator("#top-lin > *").first(), "Biggest lineages has rows at t=500").toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __topLinRebuilt: number };
    w.__topLinRebuilt = 0;
    new MutationObserver(() => { w.__topLinRebuilt++; }).observe(document.getElementById("top-lin")!, { childList: true });
  });
  await waitForCensuses(page, await censusCount(page), 3, 500);
  expect(await page.evaluate(() => (window as unknown as { __topLinRebuilt: number }).__topLinRebuilt), "Biggest lineages is not rebuilt by counts of a paused world that give the same answer").toBe(0);
  await page.evaluate(() => { for (const d of document.querySelectorAll("details")) d.open = true; });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/**
 * A family tree a short history does not reach, in the worker's own message shape (FamiliesMsg in protocol.ts): a
 * nested tree with living, gone-to-film and extinct families, more extinct ones than the panel shows unfolded
 * (EXTINCT_FOLD, 4) and more log events than it shows at first (LOG_SHOWN, 8), so Show extinct and Show all both
 * appear, and every row style the tree has is drawn. Posted from inside the lab's worker, so it reaches the page
 * the way a census does; a paused world posts no tree of its own until it steps again.
 */
const FAMILY_FIXTURE = (() => {
  const fam = (founder: string, name: string, status: "living" | "film" | "extinct", depth: number, parent: [string, string] | null, founded: number, cells: number, bodies: number, purity: number | null, share: number, unknownDescent = false) =>
    ({ founder, name, parent: parent?.[0] ?? null, parentName: parent?.[1] ?? null, founded, unknownDescent, status, bodyNow: status === "living", cells, bodies, purity, share, depth });
  const families = [
    fam("a11y-r1", "Moss", "living", 0, null, 100, 820, 6, 0.91, 0.62),
    fam("a11y-s1", "Moss, tall", "film", 1, ["a11y-r1", "Moss"], 6100, 140, 0, null, 0.11),
    fam("a11y-s2", "Moss, tall, red", "living", 2, ["a11y-s1", "Moss, tall"], 12100, 96, 1, 1, 0.07),
    fam("a11y-s3", "Moss, low", "extinct", 1, ["a11y-r1", "Moss"], 7100, 0, 0, null, 0),
    fam("a11y-r2", "Fern", "extinct", 0, null, 100, 0, 0, null, 0),
    fam("a11y-r3", "Reed", "extinct", 0, null, 100, 0, 0, null, 0),
    fam("a11y-r4", "Sedge", "extinct", 0, null, 100, 0, 0, null, 0),
    fam("a11y-r5", "Rush", "extinct", 0, null, 2300, 0, 0, null, 0, true),
    fam("a11y-r6", "Lichen", "living", 0, null, 3100, 270, 2, 0.64, 0.2, true),
  ];
  const ev = (step: number, kind: "split" | "film" | "back" | "extinct" | "found", family: string, name: string, detail: string) => ({ step, kind, family, name, detail });
  const events = [
    ev(1200, "extinct", "a11y-r2", "Fern", "Fern has no living cell left."),
    ev(1500, "extinct", "a11y-r3", "Reed", "Reed has no living cell left."),
    ev(2300, "found", "a11y-r5", "Rush", "Rush, of unknown descent, first seen."),
    ev(3100, "found", "a11y-r6", "Lichen", "Lichen, of unknown descent, first seen."),
    ev(4400, "extinct", "a11y-r4", "Sedge", "Sedge has no living cell left."),
    ev(5200, "extinct", "a11y-r5", "Rush", "Rush has no living cell left."),
    ev(6100, "split", "a11y-s1", "Moss, tall", "Moss, tall splits from Moss with 212 cells; Moss keeps 640."),
    ev(7100, "split", "a11y-s3", "Moss, low", "Moss, low splits from Moss with 30 cells; Moss keeps 610."),
    ev(9000, "extinct", "a11y-s3", "Moss, low", "Moss, low has no living cell left."),
    ev(10500, "film", "a11y-s1", "Moss, tall", "Moss, tall has no cell in a body for five censuses."),
    ev(12100, "split", "a11y-s2", "Moss, tall, red", "Moss, tall, red splits from Moss, tall with 40 cells; Moss, tall keeps 150."),
  ];
  const summary = { rules: "families-v1", watchedFrom: 100, step: 12500, named: families.length, starting: 4, split: 3, living: 3, film: 1, extinct: 5 };
  return { type: "families", world: 0, step: 12500, families, events, summary, fromStart: true, stopped: null };
})();

/** Shows FAMILY_FIXTURE in the panel, folded as a visitor first meets it. */
async function showFamilyFixture(page: Page): Promise<void> {
  const worker = page.workers().find((w) => w.url().includes("sim.worker"));
  expect(worker, "the lab's worker is running").toBeTruthy();
  await worker!.evaluate((m) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m), FAMILY_FIXTURE);
  await expect(page.locator("#family-tree li"), "the extinct families folded").toHaveCount(FAMILY_FIXTURE.families.filter((f) => f.status !== "extinct").length);
  await expect(page.locator("#family-log li")).toHaveCount(8);
  await expect(page.locator("#families-extinct-toggle")).toBeVisible();
  await expect(page.locator("#family-log-more")).toBeVisible();
}

/** Opens Show extinct and Show all from the keyboard: each keeps focus as its list grows, and says it is open. */
async function expandFamilyFixture(page: Page): Promise<void> {
  for (const [sel, list, count] of [["#families-extinct-toggle", "#family-tree li", FAMILY_FIXTURE.families.length], ["#family-log-more", "#family-log li", FAMILY_FIXTURE.events.length]] as const) {
    await page.locator(sel).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(sel)).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(sel)).toBeFocused();
    await expect(page.locator(list)).toHaveCount(count);
  }
  await expect(page.locator("#family-tree li.extinct").first()).toBeVisible();
  await expect(page.locator("#family-tree li.film").first()).toBeVisible();
  // Back to the top of every scroller, as the page is first scanned: focus on Show all scrolled the evidence column,
  // and axe cannot decide the colours of text cut by a scroller's edge.
  await page.evaluate(() => { for (const el of document.querySelectorAll("*")) if (el.scrollTop) el.scrollTop = 0; scrollTo(0, 0); });
}

const POND_FAMILIES = "/lab/ (pond keeper, family tree in full)";

for (const size of WIDTHS) {
  test(`axe: ${POND} at ${size.width} in day and night colours`, async ({ page }, info) => {
    test.setTimeout(POND_TIMEOUT);
    await page.setViewportSize(size);
    await loadPondKeeper(page);
    // The pool bars' name carries their numbers once the world is counted.
    await expect(page.locator("#pools")).toHaveAttribute("aria-label", /^What the matter is right now: nutrient \d+\.\d%, biomass \d+\.\d%, membrane \d+\.\d%, waste \d+\.\d%$/);
    // A paused world is counted again every 600 ms with the same answer: the Keep buttons stay the same nodes.
    const keep = await page.locator("#top-lin button[data-key]").first().elementHandle();
    expect(keep, "Biggest lineages offers Keep in the breeder").toBeTruthy();
    await waitForCensuses(page, await censusCount(page), 3, 500);
    expect(await keep!.evaluate((el) => el.isConnected && el === document.querySelector("#top-lin button[data-key]")), "the first Keep button is the same node after three more counts").toBe(true);
    await scanBoth(page, info, POND, size.width);

    // The tree in full (night colours, then day): extinct and gone-to-film rows, the tree's log and both toggles open.
    await showFamilyFixture(page);
    await expandFamilyFixture(page);
    await settle(page);
    const night = await scan(page, info, POND_FAMILIES, size.width, "night");
    await page.locator("#theme-toggle").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await settle(page);
    const day = await scan(page, info, POND_FAMILIES, size.width, "day");
    expect([...night.failures, ...day.failures], `serious or critical axe findings on ${POND_FAMILIES} at ${size.width}`).toEqual([]);
    expect(staleAxe(POND_FAMILIES, size.width, new Set([...night.matched, ...day.matched])), "exclusions that no longer match anything").toEqual([]);
    await expectStill(page, POND_FAMILIES);
  });
}

test("404: an unknown path answers 404 with a page of its own", async ({ page, request }) => {
  // The dev server here (the not-found plugin in apps/lab/vite.config.ts); production's rules are checked against a
  // local Caddy in public-not-found.spec.ts. The axe, keyboard, reduced-motion and no-GPU walks above and below cover
  // NOT_FOUND as one of PAGES.
  for (const path of [NOT_FOUND, "/no-such-page", "/lab/no-such-page/", "/a/b/c.html", "/404.html", "/404.html/", "/404%2ehtml"]) {
    const res = await request.get(path, { headers: { Accept: "text/html" }, maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
    expect(res.headers()["content-type"], path).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html, path).toContain("<title>Page not found · Cadence Garden</title>");
    expect(html, path).toMatch(/<meta name="robots" content="noindex"/);
    expect(html, path).not.toContain('rel="canonical"');
    expect(html, path).not.toContain("og:url");
  }
  const response = await page.goto(NOT_FOUND);
  expect(response?.status()).toBe(404);
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("main h1")).toBeVisible();
  for (const [name, href] of [["Home", "/"], ["Worlds", "/worlds/"], ["Lab", "/lab/"], ["Journal", "/research/"]]) {
    await expect(page.locator("main").getByRole("link", { name, exact: true }), name).toHaveAttribute("href", href);
  }
  // Beside it, a real page still answers 200, and a page asked for without its slash is sent to it, as Caddy does.
  expect((await request.get("/about/")).status()).toBe(200);
  const bare = await request.get("/lab?x=1", { maxRedirects: 0 });
  expect(bare.status()).toBe(308);
  expect(bare.headers().location).toBe("/lab/?x=1");
});

// ---------- keyboard ----------

type Ring = { style: string; width: number; contrast: number; on: "self" | "wrapper" };
type Stop = { body: true } | {
  body: false; i: number | null; desc: string; ring: Ring; drawn: boolean; visible: boolean; inHeader: boolean;
  box: { x: number; y: number; width: number; height: number };
};

/**
 * Installs the page-side helpers: `__describe` names an element, `__ring` reads the focus ring an element wears
 * and its contrast against what is drawn behind it, `__textContrast` the same for its text. Colours are resolved by
 * painting them on a canvas, so oklch and color-mix values come back as sRGB. Both contrasts composite every
 * background and opacity from the root down (`pixel`); `filter: opacity()`, blend modes and transforms are not seen.
 */
async function installHelpers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__describe = (el: Element) => {
      const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 32);
      // A radio has no text of its own, so it is named by its group and value.
      const radio = el instanceof HTMLInputElement && el.type === "radio" ? `[name=${el.name}][value=${el.value}]` : "";
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].map((c) => `.${c}`).join("")}${radio}${text ? ` "${text}"` : ""}`;
    };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ringed = (e: Element) => {
      const cs = getComputedStyle(e);
      return cs.outlineStyle === "solid" && parseFloat(cs.outlineWidth) >= 2;
    };
    // Only the lab's world canvas wears its ring on its wrapper (`.canvas-wrap.keyboard-focus`); everything else
    // rings itself. A control counts as ringed when either is, so a wrapper left outlined after focus moves on fails.
    const wrapOf = (e: Element) => (e.matches("canvas") ? e.closest(".canvas-wrap") : null);
    w.__ringed = (e: Element) => {
      const wrap = wrapOf(e);
      return ringed(e) || (!!wrap && ringed(wrap));
    };
    /**
     * What one pixel of `el` shows when `leaf` (colours, in paint order) is what `el` itself paints there: its
     * background, then its text or its outline, or nothing of its own. Each ancestor is drawn as the browser draws it,
     * into a layer of its own (its background, then what is inside it) laid on what is behind it at its own opacity,
     * and `el`'s layer the same with `leaf` in place of its background. So opacity fades an element's backgrounds, text
     * and outline alike, toward whatever is behind the faded element, not toward the faded background.
     */
    const pixel = (el: Element, leaf: string[]) => {
      const chain: Element[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e);
      const layer = (i: number): HTMLCanvasElement => {
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const g = c.getContext("2d")!;
        const cs = getComputedStyle(chain[i]);
        for (const fill of i === chain.length - 1 ? leaf : [cs.backgroundColor]) {
          g.fillStyle = "#0000";
          g.fillStyle = fill;
          g.fillRect(0, 0, 1, 1);
        }
        if (i + 1 < chain.length) {
          const inner = layer(i + 1);
          g.globalAlpha = parseFloat(getComputedStyle(chain[i + 1]).opacity);
          g.drawImage(inner, 0, 0);
        }
        return c;
      };
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1, 1);
      ctx.globalAlpha = parseFloat(getComputedStyle(chain[0]).opacity);
      ctx.drawImage(layer(0), 0, 0);
      ctx.globalAlpha = 1;
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    /** Text colour against what is drawn under it, both through every background and opacity on the way, as a ratio. */
    w.__textContrast = (el: HTMLElement) => {
      const bg = getComputedStyle(el).backgroundColor;
      const behind = luminance(pixel(el, [bg]));
      const text = luminance(pixel(el, [bg, getComputedStyle(el).color]));
      const [hi, lo] = behind > text ? [behind, text] : [text, behind];
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    /** Whether one of the element's boxes is what is drawn at its own centre, inside the viewport. */
    w.__drawn = (el: Element) => [...el.getClientRects()].some((r) => {
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    });
    w.__ring = (el: HTMLElement) => {
      const wrap = wrapOf(el);
      const holder = !ringed(el) && wrap && ringed(wrap) ? wrap : el;
      const cs = getComputedStyle(holder);
      // An outline drawn outside the box sits on whatever is behind the box; one inset (negative offset) on the box's
      // background. Either way it is painted in the holder's layer, so the holder's opacity and its ancestors' fade it.
      const own = parseFloat(cs.outlineOffset) < 0 ? [cs.backgroundColor] : [];
      const behind = luminance(pixel(holder, own));
      const ring = luminance(pixel(holder, [...own, cs.outlineColor]));
      const [hi, lo] = behind > ring ? [behind, ring] : [ring, behind];
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0, contrast: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, on: holder === el ? "self" : "wrapper" };
    };
  });
}

/**
 * A group of radios sharing a name (and form): one Tab stop, the checked radio or else the first, and the arrow keys
 * move within it. `i` is its tag (every radio in it carries it), `desc` the radio Tab should enter it at, `name` its
 * accessible name from a fieldset's legend or an `aria-labelledby` on a fieldset or `role="radiogroup"` (or `group`)
 * that holds the whole group ("" if none).
 */
type RadioGroup = { i: number; group: string; desc: string; size: number; name: string };

/**
 * Tags every control a keyboard should reach with `data-a11y-i`, in document order; returns their descriptions and
 * those that wear a ring while unfocused. A native control counts whatever its tabindex, so `tabindex="-1"` on a
 * button shows up as missed; other elements count when their tabindex is 0 or more. A radio group counts once, at
 * the radio Tab enters it by (the checked one, else the first), and all its radios share that tag, so the last one
 * a Shift+Tab lands on when none is checked counts as reaching it; `radios` lists the groups. `keys` names each
 * control without its text (which may change with the colours, as the Day/Night button's does), with its tabindex.
 */
async function tagControls(page: Page): Promise<{ controls: string[]; atRest: string[]; keys: string[]; radios: RadioGroup[] }> {
  await installHelpers(page);
  return page.evaluate(() => {
    const w = window as any;
    for (const el of document.querySelectorAll("[data-a11y-i]")) el.removeAttribute("data-a11y-i");
    for (const el of document.querySelectorAll("[data-a11y-rep]")) el.removeAttribute("data-a11y-rep");
    const native = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary';
    const controls = [
      ...document.querySelectorAll<HTMLElement>(native),
      ...[...document.querySelectorAll<HTMLElement>("[tabindex]")].filter((el) => !el.matches(native) && el.tabIndex >= 0),
    ];
    // Chrome also puts a scrolling box with no control inside it in the tab order, so it can be scrolled by keys.
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const cs = getComputedStyle(el);
      const scrolls = (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth) || (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight);
      if (scrolls && !controls.some((c) => el.contains(c))) controls.push(el);
    }
    const order = controls
      .filter((el) => el.checkVisibility({ visibilityProperty: true }) && !el.closest("[inert]"))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    // Radios by group: same name, same form owner (null for none).
    const owners = new Map<HTMLFormElement | null, number>();
    const groupKey = (el: HTMLElement) => {
      if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) return null;
      if (!owners.has(el.form)) owners.set(el.form, owners.size);
      return `${owners.get(el.form)}|${el.name}`;
    };
    const groups = new Map<string, HTMLInputElement[]>();
    for (const el of new Set(order)) {
      const key = groupKey(el);
      if (key) groups.set(key, [...(groups.get(key) ?? []), el as HTMLInputElement]);
    }
    const entry = (members: HTMLInputElement[]) => members.find((m) => m.checked) ?? members[0];
    const groupName = (members: HTMLInputElement[]) => {
      const text = (e: Element | null | undefined) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();
      const holds = (box: Element | null): box is Element => !!box && members.every((m) => box.contains(m));
      const fieldset = members[0].closest("fieldset");
      const legend = holds(fieldset) ? [...fieldset.children].find((c) => c.tagName === "LEGEND") : undefined;
      if (text(legend)) return text(legend);
      for (let box = members[0].parentElement; box; box = box.parentElement) {
        // Only a box that is itself a group names the radios: a section labelled by its heading does not.
        const isGroup = box.tagName === "FIELDSET" || ["radiogroup", "group"].includes(box.getAttribute("role") ?? "");
        if (!isGroup || !holds(box) || !box.hasAttribute("aria-labelledby")) continue;
        const named = box.getAttribute("aria-labelledby")!.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ").trim();
        if (named) return named;
      }
      return "";
    };
    const seen = new Set<HTMLElement>();
    const out: string[] = [];
    const atRest: string[] = [];
    const keys: string[] = [];
    const radios: { i: number; group: string; desc: string; size: number; name: string }[] = [];
    for (const el of order) {
      if (seen.has(el)) continue;
      seen.add(el);
      const key = groupKey(el);
      const members = key ? groups.get(key)! : [el];
      if (key && el !== entry(members as HTMLInputElement[])) continue;
      const i = out.length;
      for (const m of members) m.setAttribute("data-a11y-i", String(i));
      out.push(w.__describe(el));
      keys.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].map((c) => `.${c}`).join("")} tabindex ${el.tabIndex}`);
      for (const m of members) if (m !== document.activeElement && w.__ringed(m)) atRest.push(w.__describe(m));
      if (key) {
        el.setAttribute("data-a11y-rep", String(i));
        radios.push({ i, group: (el as HTMLInputElement).name, desc: w.__describe(el), size: members.length, name: groupName(members as HTMLInputElement[]) });
      }
    }
    return { controls: out, atRest, keys, radios };
  });
}

/**
 * Where focus is now, its ring, and whether the element itself is drawn at its centre. Keyboard focus scrolls
 * instantly (site.css), so the element is normally there at once; when it is not, wait up to `maxWait` ms for it,
 * then for the scroll to rest.
 */
async function focusStop(page: Page, maxWait: number): Promise<Stop> {
  return page.evaluate(async (maxWait) => {
    const w = window as any;
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return { body: true as const };
    const tag = el.getAttribute("data-a11y-i");
    // A link that wraps has one box per line, and the centre of their union can fall between them: any one
    // box drawn at its centre will do.
    const drawnNow = () => [...el.getClientRects()].some((r) => {
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    });
    const start = performance.now();
    if (!drawnNow()) {
      while (!drawnNow() && performance.now() - start < maxWait) await new Promise((r) => setTimeout(r, 50));
      for (let last = NaN, still = 0; still < 4 && performance.now() - start < maxWait + 1000;) {
        await new Promise((r) => setTimeout(r, 50));
        if (scrollX + scrollY * 1e6 === last) still++;
        else [last, still] = [scrollX + scrollY * 1e6, 0];
      }
    }
    const r = el.getBoundingClientRect();
    return {
      body: false as const,
      i: tag === null ? null : Number(tag),
      desc: w.__describe(el) as string,
      ring: w.__ring(el),
      drawn: drawnNow(),
      visible: el.matches(":focus-visible"),
      inHeader: !!el.closest("header"),
      box: { x: r.left, y: r.top, width: r.width, height: r.height },
    };
  }, maxWait);
}

type Focused = Extract<Stop, { body: false }>;

/**
 * Presses `key` until focus leaves the page or comes round again; the stops in order, after any given first. After
 * five stops that are not drawn, it stops waiting for them, so a regression reports its controls, not a timeout.
 */
async function tabWalk(page: Page, key: "Tab" | "Shift+Tab", cap: number, first: Focused[] = []): Promise<Focused[]> {
  const stops = [...first];
  let left = 0;
  let hidden = 0;
  for (let k = 0; k < cap; k++) {
    await page.keyboard.press(key);
    const stop = await focusStop(page, hidden < 5 ? 2000 : 0);
    if (stop.body) {
      if (stops.length) break;
      if (++left > 2) break;
      continue;
    }
    if (stop.i !== null && stops.some((s) => s.i === stop.i)) break;
    if (!stop.drawn) hidden++;
    stops.push(stop);
  }
  return stops;
}

/** A ring a keyboard user can see: solid, 2px or more, on the element itself (the lab's canvas excepted), 3:1. */
function ringProblems(ring: Ring): { check: "ring" | "contrast"; words: string }[] {
  const out: { check: "ring" | "contrast"; words: string }[] = [];
  if (ring.style !== "solid" || ring.width < 2) out.push({ check: "ring", words: `has outline ${ring.style} ${ring.width}px` });
  else if (ring.contrast < 3) out.push({ check: "contrast", words: `has a ring of ${ring.contrast}:1 against what is behind it` });
  return out;
}

/** Header controls reached in the order they are drawn: along a row left to right, rows top to bottom. */
function orderProblems(stops: Focused[]): string[] {
  const head = stops.filter((s) => s.inHeader);
  const out: string[] = [];
  for (let k = 1; k < head.length; k++) {
    const [a, b] = [head[k - 1].box, head[k].box];
    const sameRow = Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)) < Math.max(a.height, b.height) / 2;
    if (sameRow ? b.x <= a.x : b.y <= a.y) out.push(`${head[k].desc} comes after ${head[k - 1].desc} but is drawn before it`);
  }
  return out;
}

const SKIP: Record<string, { link: string; target: string; header: string } | null> = {
  "/lab/": { link: ".skip-link", target: "#lab-main", header: "header.top" },
  [POND]: { link: ".skip-link", target: "#lab-main", header: "header.top" },
  // One short page whose `<main>` is the first thing in it: nothing to skip.
  "/island.html": null,
};
const skipFor = (route: string) => (route in SKIP ? SKIP[route] : { link: ".skip", target: "#main", header: ".site-header" });

const KEY_TITLE = "skip link, every control by Tab and Shift+Tab, visible focus in both colours";

for (const route of PAGES) {
  for (const size of WIDTHS) {
    test(`keyboard: ${route} at ${size.width}: ${KEY_TITLE}`, async ({ page }) => {
      test.slow();
      await page.setViewportSize(size);
      await prepare(page, route);
      await keyboardWalk(page, route, size);
    });
  }
}

for (const size of WIDTHS) {
  test(`keyboard: ${POND} at ${size.width}: ${KEY_TITLE}`, async ({ page }) => {
    test.setTimeout(POND_TIMEOUT);
    await page.setViewportSize(size);
    await loadPondKeeper(page);
    // The tree in the fixture's state, so Show extinct and Show all are among the controls walked (the breeder at
    // t=500 shows neither); posting it moves no focus, so the first Tab still starts from the top of the page.
    await showFamilyFixture(page);
    await keyboardWalk(page, POND, size);
    // Opened, each toggle keeps its place in the order: Tab goes from one to the other and back, drawn and ringed.
    await expandFamilyFixture(page);
    await installHelpers(page);
    await page.locator("#families-extinct-toggle").focus();
    const steps: string[] = [];
    for (const [key, want] of [["Tab", "#family-log-more"], ["Shift+Tab", "#families-extinct-toggle"]] as const) {
      await page.keyboard.press(key);
      const stop = await focusStop(page, 2000);
      if (stop.body || !(await page.locator(want).evaluate((el) => el === document.activeElement))) { steps.push(`${key} from the other toggle reached ${stop.body ? "nothing" : stop.desc}, not ${want}`); continue; }
      if (!stop.drawn) steps.push(`${want} is not drawn going ${key}`);
      if (!stop.visible) steps.push(`${want} does not match :focus-visible going ${key}`);
      for (const p of ringProblems(stop.ring)) steps.push(`${want} ${p.words} going ${key}`);
    }
    expect(steps, "the family tree's toggles, opened, by Tab and Shift+Tab").toEqual([]);
  });
}

/**
 * The keyboard pass over a page loaded fresh in the state worth checking: the first Tab is the skip link, Tab and
 * Shift+Tab reach every control with a ring that contrasts, the header in drawn order, each radio group as one named
 * stop that the arrow keys move within, the same in night colours, then the skip link's jump.
 */
async function keyboardWalk(page: Page, route: string, size: { width: number; height: number }): Promise<void> {
  const skipLink = skipFor(route);
  const { controls, atRest, keys, radios } = await tagControls(page);
  const excused = (check: KeyCheck, desc: string) =>
    KEY_EXCLUSIONS.find((e) => e.route === route && e.check === check && e.target === desc && (!e.widths || e.widths.includes(size.width)));
  const used = new Set<KeyExclusion>();
  const problems: string[] = [];
  const note = (check: KeyCheck, desc: string, words: string) => {
    const ex = excused(check, desc);
    if (ex) used.add(ex);
    else problems.push(`${check}: ${desc} ${words}`);
  };
  for (const desc of atRest) note("rest", desc, "wears a ring while not focused");

  // The first Tab on a fresh page is the skip link.
  await page.keyboard.press("Tab");
  const first = await focusStop(page, 2000);
  let start: Focused[] = [];
  if (skipLink) {
    const isSkip = await page.locator(skipLink.link).evaluate((el) => el === document.activeElement);
    if (!isSkip) note("first", first.body ? "nothing" : first.desc, "is what the first Tab focuses, not the skip link");
    // From the skip link (focused directly if the first Tab went elsewhere): forwards round the page, then back.
    if (!isSkip) await page.locator(skipLink.link).focus();
    const skip = await focusStop(page, 2000);
    expect(skip.body, "the skip link takes focus").toBe(false);
    start = [skip as Focused];
    const { x, y, width, height } = start[0].box;
    expect(x >= 0 && y >= 0 && x + width <= size.width && y + height <= size.height, "the skip link is wholly on screen when focused").toBe(true);
  } else {
    expect(first.body, "the first Tab focuses something").toBe(false);
    start = [first as Focused];
  }
  const forward = await tabWalk(page, "Tab", controls.length + 5, start);
  const backward = await tabWalk(page, "Shift+Tab", controls.length + 5);
  for (const [name, stops] of [["Tab", forward], ["Shift+Tab", backward]] as const) {
    const reached = new Set(stops.map((s) => s.i).filter((i) => i !== null));
    controls.forEach((desc, i) => { if (!reached.has(i)) note("missed", desc, `never reached by ${name}`); });
    for (const s of stops) {
      if (s.i === null) note("extra", s.desc, `reached by ${name} but not counted as a control`);
      if (!s.visible) note("ring", s.desc, `does not match :focus-visible going ${name}`);
      for (const p of ringProblems(s.ring)) note(p.check, s.desc, `${p.words} going ${name}`);
      if (s.ring.on !== "self" && !route.startsWith("/lab/")) note("ring", s.desc, `is ringed only by a wrapper going ${name}`);
      if (!s.drawn) note("hidden", s.desc, `is not what is drawn at its centre going ${name}`);
    }
  }
  for (const words of orderProblems(forward)) note("order", "header", words);
  // Each radio group is one stop, entered by Tab at its checked radio (else its first), and has a name. These go
  // straight to problems: no exclusion lets a radio group through.
  for (const g of radios) {
    const at = forward.find((s) => s.i === g.i);
    if (!at) problems.push(`radio: the ${g.group} group is never reached by Tab`);
    else if (at.desc !== g.desc) problems.push(`radio: Tab enters the ${g.group} group at ${at.desc}, not ${g.desc}`);
    if (!backward.some((s) => s.i === g.i)) problems.push(`radio: the ${g.group} group is never reached by Shift+Tab`);
    if (!g.name) problems.push(`radio: the ${g.group} group has no accessible name (a fieldset with a legend, or aria-labelledby)`);
  }

  // Night colours. The controls are counted again (a page with no Day/Night button is reloaded into them, which
  // drops the day tags) and must be the same controls as by day, in the same order, with the same tabindex, and
  // shown (not hidden, not inert). Tab and Shift+Tab each go round again and must reach every one, so a control
  // that only a script can focus in night colours fails. Then each control is focused by script after a keyboard
  // press (so `:focus-visible` still applies) and its ring checked for style and contrast.
  await toNight(page);
  const nightTags = await tagControls(page);
  if (nightTags.controls.length !== controls.length) {
    problems.push(`count: ${nightTags.controls.length} controls in night colours, ${controls.length} by day`);
  }
  for (let k = 0; k < Math.max(keys.length, nightTags.keys.length); k++) {
    if (keys[k] !== nightTags.keys[k]) problems.push(`inventory: control ${k} is ${keys[k] ?? "missing"} by day, ${nightTags.keys[k] ?? "missing"} in night colours`);
  }
  for (const desc of nightTags.atRest) note("rest", desc, "wears a ring while not focused in night colours");
  await (skipLink ? page.locator(skipLink.link) : page.locator('[data-a11y-i="0"]')).focus();
  const nightFirst = await focusStop(page, 2000);
  expect(nightFirst.body, "the first control takes focus in night colours").toBe(false);
  const nightForward = await tabWalk(page, "Tab", nightTags.controls.length + 5, [nightFirst as Focused]);
  const nightBackward = await tabWalk(page, "Shift+Tab", nightTags.controls.length + 5);
  for (const [name, stops] of [["Tab", nightForward], ["Shift+Tab", nightBackward]] as const) {
    const reached = new Set(stops.map((s) => s.i).filter((i) => i !== null));
    nightTags.controls.forEach((desc, i) => { if (!reached.has(i)) note("missed", desc, `never reached by ${name} in night colours`); });
    for (const s of stops) if (s.i === null) note("extra", s.desc, `reached by ${name} in night colours but not counted as a control`);
  }
  const night = await page.evaluate(() => {
    const w = window as any;
    let previous: HTMLElement | null = null;
    const out = [...document.querySelectorAll<HTMLElement>("[data-a11y-i]")].map((el) => {
      el.focus({ preventScroll: true });
      // The control left behind gives its ring up when focus moves on.
      const kept = !!previous && previous !== document.activeElement && w.__ringed(previous) ? w.__describe(previous) as string : null;
      previous = el;
      return { desc: w.__describe(el) as string, tabIndex: el.tabIndex, focused: document.activeElement === el, visible: el.matches(":focus-visible"), ring: w.__ring(el), kept };
    });
    // With focus gone from them all, none of them wears a ring.
    (document.activeElement as HTMLElement | null)?.blur();
    const after = [...document.querySelectorAll<HTMLElement>("[data-a11y-i]")].filter((el) => w.__ringed(el)).map((el) => w.__describe(el) as string);
    return { stops: out, after };
  });
  for (const desc of night.after) note("rest", desc, "wears a ring after focus has left it in night colours");
  for (const s of night.stops) {
    if (s.kept) note("rest", s.kept, "keeps its ring after focus moves on in night colours");
    // A scrolling box with no tabindex of its own (-1 to script) does not take script focus; the day walk covers
    // it. Anything else that will not take focus here is a failure, so this pass cannot pass by checking nothing.
    if (!s.focused) {
      if (s.tabIndex >= 0) note("ring", s.desc, "would not take focus in night colours");
      continue;
    }
    if (!s.visible) note("ring", s.desc, "does not match :focus-visible in night colours");
    for (const p of ringProblems(s.ring)) note(p.check, s.desc, `${p.words} in night colours`);
  }
  // Within each radio group, ArrowRight then ArrowDown each move the focus and the choice to the next radio (round
  // from the last to the first), ringed and drawn. Last, as a choice can change the page (a Send button enabled).
  for (const g of nightTags.radios) {
    if (g.size < 2) continue;
    await page.locator(`[data-a11y-rep="${g.i}"]`).focus();
    for (const key of ["ArrowRight", "ArrowDown"]) {
      const want = await page.evaluate((i) => {
        const members = [...document.querySelectorAll<HTMLInputElement>(`[data-a11y-i="${i}"]`)];
        const now = members.indexOf(document.activeElement as HTMLInputElement);
        return now < 0 ? null : (window as any).__describe(members[(now + 1) % members.length]) as string;
      }, g.i);
      if (!want) { problems.push(`radio: focus is outside the ${g.group} group before ${key}`); break; }
      await page.keyboard.press(key);
      const stop = await focusStop(page, 2000);
      const checked = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.checked === true);
      if (stop.body || stop.desc !== want) { problems.push(`radio: ${key} in the ${g.group} group focused ${stop.body ? "nothing" : stop.desc}, not ${want}`); break; }
      if (!checked) problems.push(`radio: ${key} in the ${g.group} group moved focus to ${want} but did not choose it`);
      if (!stop.visible) problems.push(`radio: ${want} does not match :focus-visible after ${key}`);
      if (!stop.drawn) problems.push(`radio: ${want} is not what is drawn at its centre after ${key}`);
      for (const p of ringProblems(stop.ring)) problems.push(`radio: ${want} ${p.words} after ${key}`);
    }
  }

  expect([...new Set(problems)], `keyboard problems on ${route} at ${size.width}`).toEqual([]);
  const stale = KEY_EXCLUSIONS.filter((e) => e.route === route && (!e.widths || e.widths.includes(size.width)) && !used.has(e));
  expect(stale.map((e) => `${e.check} ${e.target}`), "keyboard exclusions that no longer match").toEqual([]);
  if (!skipLink) return;

  // Back to the skip link (wherever the page is scrolled now); Enter jumps to the main content.
  const { link, target, header } = skipLink;
  await page.locator(link).focus();
  await expect(page.locator(link)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${target}$`));
  const firstHeading = page.locator(`${target} :is(h1, h2)`).first();
  await expect.poll(async () => {
    const [h, top] = await Promise.all([page.locator(header).boundingBox(), firstHeading.boundingBox()]);
    return !!h && !!top && top.y >= h.y + h.height - 1;
  }, { message: "after the jump the first heading in main is clear of the header", timeout: 10_000 }).toBe(true);
  await page.keyboard.press("Tab");
  const after = await page.evaluate(([t, hd]) => {
    const el = document.activeElement!;
    const main = document.querySelector(t)!;
    return {
      inHeader: !!el.closest(hd),
      afterMain: main.contains(el) || !!(main.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  }, [target, header] as const);
  expect(after, "the Tab after the skip link lands in or after main, not in the header").toEqual({ inHeader: false, afterMain: true });
}

for (const size of WIDTHS) {
  test(`keyboard: Tab pressed in quick bursts on /worlds/ at ${size.width} leaves focus on screen`, async ({ page }) => {
    await page.setViewportSize(size);
    await prepare(page, "/worlds/");
    const lost: string[] = [];
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let burst = 0; burst < 30; burst++) {
        for (let k = 0; k < 7; k++) await page.keyboard.press(key);
        await page.waitForTimeout(300);
        const at = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const drawn = [...el.getClientRects()].some((r) => {
            const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
            const hit = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight ? document.elementFromPoint(x, y) : null;
            return !!hit && (hit === el || el.contains(hit));
          });
          return { desc: `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 32)}"`, drawn };
        });
        if (!at) break;
        if (!at.drawn) lost.push(`${key} burst ${burst + 1}: ${at.desc}`);
      }
    }
    expect(lost, "focus left off screen or under the header after a burst of key presses").toEqual([]);
  });
}

// The ring check composites opacity as the text check does (since its pass 3): an element's own opacity and every
// ancestor's fade its ring toward what is behind the faded subtree. Expected ratios come from an sRGB blend, then the
// WCAG ratio: #767676 on white is 4.54:1; at opacity .4 it blends to rgb(200, 200, 200), 1.67:1. A white inset ring on
// a black button is 21:1; at opacity .3 over white the button blends to rgb(179, 179, 179) against the white ring,
// 2.11:1. Black text at opacity .4 on white blends to rgb(153, 153, 153), 2.85:1 (the text check, unchanged).
test("keyboard: the ring check fades a ring by its own and its ancestors' opacity, as the text check does", async ({ page }) => {
  const ring = "outline:3px solid #767676;outline-offset:2px";
  const inset = "background:#000;color:#fff;border:0;outline:3px solid #fff;outline-offset:-4px";
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">
    <p><button id="out" style="${ring}">a</button></p>
    <p><button id="faded" style="${ring};opacity:.4">b</button></p>
    <div style="opacity:.4"><p><button id="parent" style="${ring}">c</button></p></div>
    <p><button id="inset" style="${inset}">d</button></p>
    <p><button id="insetFaded" style="${inset};opacity:.3">e</button></p>
    <div class="canvas-wrap" style="${ring};opacity:.4"><canvas id="canvas" width="8" height="8"></canvas></div>
    <p><span id="text" style="color:#000;opacity:.4">t</span></p>
  </body></html>`);
  await installHelpers(page);
  const got = await page.evaluate(() => {
    const w = window as any;
    const ids = ["out", "faded", "parent", "inset", "insetFaded", "canvas"];
    return { rings: Object.fromEntries(ids.map((id) => [id, w.__ring(document.getElementById(id))])) as Record<string, Ring>, text: w.__textContrast(document.getElementById("text")) as number };
  });
  const { rings } = got;
  expect(rings.out).toMatchObject({ style: "solid", width: 3, on: "self" });
  expect(rings.out.contrast).toBeGreaterThanOrEqual(4.4);
  expect(rings.out.contrast).toBeLessThan(4.7);
  expect(ringProblems(rings.out)).toEqual([]);
  for (const id of ["faded", "parent"]) {
    expect(rings[id].contrast, `${id}: a ring faded to opacity .4`).toBeGreaterThan(1.5);
    expect(rings[id].contrast, `${id}: a ring faded to opacity .4`).toBeLessThan(1.85);
    expect(ringProblems(rings[id]).map((p) => p.check)).toEqual(["contrast"]);
  }
  expect(rings.inset.contrast).toBeGreaterThanOrEqual(20);
  expect(rings.insetFaded.contrast).toBeGreaterThan(1.9);
  expect(rings.insetFaded.contrast).toBeLessThan(2.3);
  expect(ringProblems(rings.insetFaded).map((p) => p.check)).toEqual(["contrast"]);
  expect(rings.canvas).toMatchObject({ style: "solid", width: 3, on: "wrapper" });
  expect(rings.canvas.contrast).toBeLessThan(1.85);
  expect(ringProblems(rings.canvas).map((p) => p.check)).toEqual(["contrast"]);
  expect(got.text).toBeGreaterThan(2.75);
  expect(got.text).toBeLessThan(2.95);
});

test("keyboard: header controls are reached in the order they are drawn, at every width and across a resize", async ({ page }) => {
  for (const size of [{ width: 1280, height: 900 }, { width: 1000, height: 900 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    await page.goto("/about/");
    await installHelpers(page);
    await page.locator(".skip").focus();
    const stops: Focused[] = [];
    for (let k = 0; k < 20; k++) {
      await page.keyboard.press("Tab");
      const stop = await focusStop(page, 2000);
      if (stop.body || !stop.inHeader) break;
      stops.push(stop);
    }
    expect(stops.map((s) => s.desc), `header stops at ${size.width}`).toContain('button.theme-toggle "Switch to night colours"');
    expect(orderProblems(stops), `header order at ${size.width}`).toEqual([]);
  }
  // The button keeps focus when the header changes layout under it.
  const toggle = page.locator(".theme-toggle");
  await toggle.focus();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => toggle.evaluate((el) => !!(el.compareDocumentPosition(document.querySelector(".site-nav")!) & Node.DOCUMENT_POSITION_PRECEDING))).toBe(true);
  await expect(toggle).toBeFocused();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => toggle.evaluate((el) => !!(el.compareDocumentPosition(document.querySelector(".site-nav")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(toggle).toBeFocused();
});

test("keyboard: the Day/Night button works with Enter and Space", async ({ page }) => {
  await page.setViewportSize(WIDTHS[0]);
  await page.goto("/");
  const toggle = page.locator(".theme-toggle");
  await expect(toggle).toHaveText("Night");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveText("Day");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveText("Night");
  await expect(toggle).toBeFocused();
});

test("keyboard: a deep link at 375 lands its heading clear of the sticky header", async ({ page }) => {
  await page.setViewportSize(WIDTHS[1]);
  await page.goto("/worlds/");
  await expect(page.locator("#worlds-root .world-card").first()).toBeVisible();
  const family = await page.locator(".worlds-jump a").nth(2).getAttribute("href");
  expect(family).toMatch(/^#/);
  for (const url of ["/#next", `/worlds/${family}`]) {
    await page.goto(url);
    const id = url.split("#")[1];
    const heading = page.locator(`[id="${id}"] h2`).first();
    await expect.poll(async () => {
      const [h, top] = await Promise.all([page.locator(".site-header").boundingBox(), heading.boundingBox()]);
      return !!h && !!top && top.y >= h.y + h.height - 1 && top.y < 812 / 2;
    }, { message: `${url}: the heading is near the top, clear of the header`, timeout: 10_000 }).toBe(true);
  }
});

test("keyboard: the lab header is reached in the order it is drawn, at every width and across a resize", async ({ page }) => {
  test.slow();
  await page.setViewportSize(WIDTHS[0]);
  await page.goto("/lab/");
  // The status line changes its words as the lab starts; wait until it has said where it stands.
  await expect(page.locator("#simulation-status")).not.toHaveText(/Warming up/, { timeout: 150_000 });
  await installHelpers(page);
  // Both sides of the 760px breakpoint main.ts shares with style.css, so the two cannot drift apart unseen.
  for (const size of [{ width: 1280, height: 900 }, { width: 1000, height: 900 }, { width: 800, height: 1024 }, { width: 761, height: 1024 }, { width: 760, height: 1024 }, { width: 600, height: 900 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    // Every control the header shows, in the order it draws them (rows top to bottom, along a row left to right).
    const drawnOrder = await page.locator("header.top").evaluate((h) => [...h.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]')]
      .filter((el) => el.checkVisibility({ visibilityProperty: true }))
      .map((el) => ({ desc: (window as any).__describe(el) as string, r: el.getBoundingClientRect() }))
      .sort((a, b) => (Math.abs((a.r.top + a.r.height / 2) - (b.r.top + b.r.height / 2)) < Math.max(a.r.height, b.r.height) / 2 ? a.r.left - b.r.left : a.r.top - b.r.top))
      .map((e) => e.desc));
    expect(drawnOrder.length, `the header shows its controls at ${size.width}`).toBeGreaterThanOrEqual(5);
    await page.locator(".skip-link").focus();
    const stops: Focused[] = [];
    for (let k = 0; k < 20; k++) {
      await page.keyboard.press("Tab");
      const stop = await focusStop(page, 2000);
      if (stop.body || !stop.inHeader) break;
      stops.push(stop);
    }
    expect(stops.map((s) => s.desc), `header stops at ${size.width}: every control it shows, in the order drawn`).toEqual(drawnOrder);
    expect(orderProblems(stops), `header order at ${size.width}`).toEqual([]);
    expect(await page.locator("header.top").evaluate((h) => h.scrollWidth <= h.clientWidth), `the header fits at ${size.width}`).toBe(true);
  }
  // The button keeps focus when the header changes layout under it, and the status moves to match what is drawn.
  const toggle = page.locator("#theme-toggle");
  const statusFirst = () => page.locator(".header-status").evaluate((el) => !!(el.compareDocumentPosition(document.querySelector("header.top .site-nav")!) & Node.DOCUMENT_POSITION_FOLLOWING));
  await page.setViewportSize({ width: 1280, height: 900 });
  await toggle.focus();
  await expect.poll(statusFirst).toBe(false);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(statusFirst).toBe(true);
  await expect(toggle).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(statusFirst).toBe(false);
  await expect(toggle).toBeFocused();
});

test("keyboard: at 375 the lab's view picker keeps the lit view in sight when chosen by key, without scrolling the page", async ({ page }) => {
  test.slow();
  await page.setViewportSize(WIDTHS[1]);
  await page.goto("/lab/");
  test.skip(!(await hasAdapter(page)), "no WebGPU adapter in this browser, so the lab cannot plant a world");
  await planted(page);
  const views = page.locator("#views");
  expect(await views.evaluate((v) => v.scrollWidth > v.clientWidth), "the picker scrolls sideways at 375").toBe(true);
  const pageY = await page.evaluate(() => window.scrollY);
  const problems: string[] = [];
  // Light (the last), Pull (one before), back to Composite (the first), and Light again from there.
  for (const [key, mode] of [["8", "light"], ["7", "affinity"], ["1", "composite"], ["8", "light"]] as const) {
    await page.keyboard.press(key);
    const b = page.locator(`#views button[data-mode="${mode}"]`);
    await expect(b).toHaveAttribute("aria-pressed", "true");
    const inside = await b.evaluate((el) => {
      const box = el.parentElement!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
    });
    if (!inside) problems.push(`${mode} (key ${key}) is outside the picker's box`);
  }
  expect(problems, "the lit view lies inside the picker").toEqual([]);
  expect(await page.evaluate(() => window.scrollY), "choosing a view by key does not scroll the page").toBe(pageY);
});

/**
 * Keyboard checks for one of the lab's modal dialogs as it stands. `inventory` tags every control in it (native ones
 * whatever their tabindex, as tagControls counts the page's), clearing tags left from what it showed before; `walk`
 * presses Tab, then Shift+Tab, `presses` times each, and notes any control in the inventory not reached both ways,
 * any stop without a ring of 3:1 or not drawn on screen, and any focus outside the dialog. After its last control a modal dialog lets the
 * keyboard reach the browser's own controls, so it is never a trap; anywhere else, the page included, is a leak.
 */
function modalWalker(page: Page, dialogId: string) {
  type Where = { at: string; i: number | null; desc: string; ring: Ring | null; visible: boolean; drawn: boolean };
  // A stop inside counts only if it is drawn: on screen and not under anything else (waiting up to 2 s for a scroll).
  const where = (): Promise<Where> => page.evaluate(async (id) => {
    const w = window as any;
    const el = document.activeElement as HTMLElement | null;
    if (el && document.getElementById(id)!.contains(el)) {
      const tag = el.getAttribute("data-a11y-d");
      const start = performance.now();
      while (!w.__drawn(el) && performance.now() - start < 2000) await new Promise((r) => setTimeout(r, 50));
      return { at: "inside", i: tag === null ? null : Number(tag), desc: w.__describe(el), ring: w.__ring(el), visible: el.matches(":focus-visible"), drawn: w.__drawn(el) };
    }
    const at = (!el || el === document.body) && !document.hasFocus() ? "browser" : `outside: ${el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}` : "nothing"}`;
    return { at, i: null, desc: "", ring: null, visible: false, drawn: false };
  }, dialogId);
  const inventory = () => page.locator(`#${dialogId}`).evaluate((d) => {
    for (const el of d.querySelectorAll("[data-a11y-d]")) el.removeAttribute("data-a11y-d");
    const native = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary';
    const els = [...d.querySelectorAll<HTMLElement>(native), ...[...d.querySelectorAll<HTMLElement>("[tabindex]")].filter((el) => !el.matches(native) && el.tabIndex >= 0)]
      .filter((el, k, all) => all.indexOf(el) === k && el.checkVisibility({ visibilityProperty: true }))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return els.map((el, k) => { el.setAttribute("data-a11y-d", String(k)); return (window as any).__describe(el) as string; });
  });
  const leaks: string[] = [];
  const problems: string[] = [];
  const walk = async (controls: string[], presses: number, label: string) => {
    for (const key of ["Tab", "Shift+Tab"]) {
      let last = "inside";
      const reached = new Set<number>();
      for (let k = 0; k < presses; k++) {
        await page.keyboard.press(key);
        const now = await where();
        if (now.at !== "inside" && now.at !== "browser") leaks.push(`${label}, ${key} ${k + 1}: ${now.at}`);
        if (now.at === "browser" && last === "browser") leaks.push(`${label}, ${key} ${k + 1}: focus stayed outside the page`);
        last = now.at;
        if (now.at !== "inside") continue;
        if (now.i === null) problems.push(`extra: ${now.desc} reached by ${key} but not counted as a control (${label})`);
        else reached.add(now.i);
        if (!now.visible) problems.push(`ring: ${now.desc} does not match :focus-visible going ${key} (${label})`);
        if (!now.drawn) problems.push(`hidden: ${now.desc} is not what is drawn at its centre going ${key} (${label})`);
        for (const p of ringProblems(now.ring!)) problems.push(`${p.check}: ${now.desc} ${p.words} going ${key} (${label})`);
      }
      controls.forEach((desc, i) => { if (!reached.has(i)) problems.push(`missed: ${desc} never reached by ${key} (${label})`); });
    }
  };
  return { where, inventory, walk, leaks, problems };
}

/** Opens a lab dialog from its button by the keyboard, and checks it is modal (the page behind it inert). */
async function openModal(page: Page, openerSel: string, dialogSel: string): Promise<void> {
  await page.locator(openerSel).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(dialogSel)).toHaveAttribute("open", "");
  expect(await page.locator(dialogSel).evaluate((d) => d.matches(":modal")), `${dialogSel} is modal, so the page behind it is inert`).toBe(true);
}

/**
 * Closes a lab dialog from its Close button by the keyboard, then opens it again and closes it with a click on the
 * backdrop: each time focus goes back to the button that opened it (Escape is in lab-worlds.spec.ts).
 */
async function closeModalBothWays(page: Page, openerSel: string, dialogSel: string, closeSel: string): Promise<void> {
  const opener = page.locator(openerSel);
  const dialog = page.locator(dialogSel);
  const close = dialog.locator(closeSel);
  for (let k = 0; k < 100 && !(await close.evaluate((el) => el === document.activeElement)); k++) await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(opener).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveAttribute("open", "");
  await page.mouse.click(4, 4);
  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(opener).toBeFocused();
}

test("keyboard: the lab's Browse all worlds dialog is modal, keeps focus and hands it back", async ({ page }, info) => {
  test.slow();
  await page.setViewportSize(WIDTHS[0]);
  await page.goto("/lab/");
  test.skip(!(await hasAdapter(page)), "no WebGPU adapter in this browser, so the lab cannot plant a world");
  await planted(page);
  const dialog = page.locator("#worlds");
  await openModal(page, "#btn-worlds", "#worlds");
  await installHelpers(page);
  const modal = modalWalker(page, "worlds");
  const inventory = await modal.inventory();
  const controls = inventory.length;
  expect(controls).toBeGreaterThan(2);
  expect((await modal.where()).at).toBe("inside");
  const shownFirst = await dialog.locator('.worlds-nav button[aria-pressed="true"]').getAttribute("data-family");
  // Round the dialog twice each way from where it opens.
  await modal.walk(inventory, 2 * (controls + 1), `family ${shownFirst} as opened`);
  // The open dialog, scanned as it opens (before another family is shown).
  const open = await scan(page, info, "/lab/ (Browse all worlds open)", 1280, "day");
  expect(open.failures).toEqual([]);

  // Every other family, chosen from the keyboard: its cards replace the last family's, so they are counted afresh
  // once it is shown (focus moves to its heading), and walked once round each way (its controls, the browser's
  // own stop, one spare).
  const families = await dialog.locator(".worlds-nav button").evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.family!));
  expect(families.length, "the dialog lists its families").toBeGreaterThan(1);
  for (const family of families) {
    if (family === shownFirst) continue;
    const button = dialog.locator(`.worlds-nav button[data-family="${family}"]`);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator(".family-head h3")).toBeFocused();
    const shown = await modal.inventory();
    await modal.walk(shown, shown.length + 2, `family ${family}`);
  }
  expect(modal.leaks, "focus left the open dialog").toEqual([]);
  expect([...new Set(modal.problems)], "keyboard problems in the open dialog").toEqual([]);
  await closeModalBothWays(page, "#btn-worlds", "#worlds", ".worlds-close");

  // In night colours too (switched with the dialog closed: the page behind an open one is inert). The family list's
  // small lines are --soft at rest, which holds 4.5:1 in both colours.
  await toNight(page);
  await openModal(page, "#btn-worlds", "#worlds");
  await settle(page);
  const night = await scan(page, info, "/lab/ (Browse all worlds open)", 1280, "night");
  expect(night.failures).toEqual([]);
  expect(staleAxe("/lab/ (Browse all worlds open)", 1280, new Set([...open.matched, ...night.matched])), "exclusions that no longer match anything").toEqual([]);
});

const CARD = "/lab/ (Session card open)";

for (const size of WIDTHS) {
  test(`keyboard and axe: ${CARD} at ${size.width} in day and night colours: modal, keeps focus, hands it back`, async ({ page }, info) => {
    test.setTimeout(POND_TIMEOUT);
    await page.setViewportSize(size);
    await loadPondKeeper(page);
    await installHelpers(page);
    const modal = modalWalker(page, "session-card");
    const scans: ScanResult[] = [];
    for (const colours of ["day", "night"] as const) {
      if (colours === "night") {
        await page.keyboard.press("Escape");
        await expect(page.locator("#session-card")).not.toHaveAttribute("open", "");
        await toNight(page);
      }
      await openModal(page, "#btn-card", "#session-card");
      await settle(page);
      await expect(page.locator("#card-heading"), "the card's heading takes focus as it opens").toBeFocused();
      const inventory = await modal.inventory();
      // Its scrolling body is a stop of its own, so the keys can scroll it.
      expect(inventory.filter((d) => d.startsWith("div#card-body")), "the card's scrolling body among its controls").toHaveLength(1);
      // Round the card twice each way from where it opens.
      await modal.walk(inventory, 2 * (inventory.length + 1), `the Session card in ${colours} colours`);
      scans.push(await scan(page, info, CARD, size.width, colours));
    }
    expect(modal.leaks, "focus left the open card").toEqual([]);
    expect([...new Set(modal.problems)], "keyboard problems in the open card").toEqual([]);
    expect(scans.flatMap((r) => r.failures), `serious or critical axe findings on ${CARD} at ${size.width}`).toEqual([]);
    expect(staleAxe(CARD, size.width, new Set(scans.flatMap((r) => [...r.matched]))), "exclusions that no longer match anything").toEqual([]);
    // Open, with its backdrop, nothing in or behind the card moves under reduced motion.
    await expectStill(page, CARD);
    // At 760px and below the card fills the screen and has no backdrop to click: Close and Escape are the ways out.
    if (size.width > 760) await closeModalBothWays(page, "#btn-card", "#session-card", ".card-close");
    else {
      const close = page.locator("#session-card .card-close");
      await close.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#session-card")).not.toHaveAttribute("open", "");
      await expect(page.locator("#btn-card")).toBeFocused();
    }
  });
}

// ---------- reduced motion ----------

for (const route of PAGES) {
  test(`reduced motion: ${route}`, async ({ page }) => {
    await page.setViewportSize(WIDTHS[0]);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await prepare(page, route);
    // The control: without the setting the page does move, so the check below can be seen to bite.
    const before = await motionNow(page);
    if (route === "/lab/") expect(before.moving.length, "the lab has transitions without the setting").toBeGreaterThan(0);
    else expect(before.scroll, "smooth scrolling without the setting").toBe("smooth");
    await expectStill(page, route);
  });
}

// ---------- without WebGPU ----------

/** Asks the island page to Join and returns the /api requests it made; every /api request is refused. */
async function joinWithoutGpu(page: Page, expected: string, remembered?: { status: number }): Promise<string[]> {
  const api: string[] = [];
  await page.route("**/api/**", (route) => {
    api.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    if (remembered && new URL(route.request().url()).pathname === "/api/islands/me") {
      return route.fulfill({ status: remembered.status, contentType: "application/json", body: "{}" });
    }
    return route.abort();
  });
  await page.goto("/island.html");
  if (remembered) {
    // A visitor who joined earlier in this tab: the page probes the coordinator for that island on load.
    await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), ["bl-island", JSON.stringify({ coordinator: new URL(page.url()).origin, id: "isl-a11y", token: "test-token", metricsVersion: METRICS_VERSION })] as const);
    await page.reload();
  } else {
    await page.locator("#go").click();
  }
  await expect(page.locator("#log")).toContainText(expected);
  await expect(page.locator("#go")).toHaveText("Join");
  // A failed resume leaves the island remembered (so a later Join retries it); forget it for the next case.
  await page.evaluate(() => sessionStorage.clear());
  return api;
}

test("without WebGPU: the lab says it cannot start and every public page still reads", async ({ browserName }, info) => {
  test.slow();
  const baseURL = info.project.use.baseURL;
  // --disable-gpu is the switch that leaves requestAdapter() answering null on this Mac (probe, 18 October 2026);
  // --disable-features=WebGPU and --disable-blink-features=WebGPU leave the adapter in place. Elsewhere the switch
  // may do something else, so the test checks its precondition and skips, saying why, when it does not hold.
  let browser: Browser;
  try {
    browser = await chromium.launch({ channel: "chrome", args: ["--disable-gpu"] });
  } catch (e) {
    test.skip(true, `Chrome could not be started for this check: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    return;
  }
  try {
    const context = await browser.newContext({ baseURL, viewport: WIDTHS[0] });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
    await page.goto("/");
    const gpu = await page.evaluate(async () => (navigator.gpu ? ((await navigator.gpu.requestAdapter()) === null ? "null adapter" : "adapter") : "no navigator.gpu"));
    test.skip(gpu !== "null adapter", `${browserName} with --disable-gpu gives "${gpu}" here, not a null adapter; the next test covers a missing navigator.gpu`);

    await page.goto("/lab/");
    const alert = page.locator("#stage-alert");
    await expect(alert).toBeVisible({ timeout: 120_000 });
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(page.locator("#stage-alert-title")).toHaveText("The lab could not start");
    await expect(page.locator("#stage-alert-help")).toContainText("WebGPU");
    await expect(page.locator("#chip-gpu")).toHaveText("No GPU adapter");
    await expect(page.locator("#world-heading")).toHaveText("No world yet");
    const lab = await scan(page, info, "/lab/ (no GPU)", 1280, "day");
    expect(lab.failures).toEqual([]);
    expect(staleAxe("/lab/ (no GPU)", 1280, lab.matched), "exclusions that no longer match anything").toEqual([]);

    for (const route of PAGES.filter((r) => r !== "/lab/")) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(expectedStatus(route));
      await expect(page.locator("main h1").first(), route).toBeVisible();
    }
    expect(errors, "uncaught errors without WebGPU").toEqual([]);

    // The island page, fresh: Join stops before asking the coordinator for anything and says why.
    expect(await joinWithoutGpu(page, "error: WebGPU: no adapter"), "requests made by a fresh Join without a GPU").toEqual([]);
    await page.unrouteAll();
    // With an island remembered from earlier in the tab, the page asks the coordinator about it first; whether the
    // coordinator knows it (200) or not (401), the run then stops at the GPU and the log says so.
    for (const status of [200, 401]) {
      expect(await joinWithoutGpu(page, "error: WebGPU: no adapter", { status }), `requests made resuming (${status}) without a GPU`).toEqual(["GET /api/islands/me"]);
      await page.unrouteAll();
    }

    await page.goto("/");
    await expect(page.locator(".hero .fine")).toContainText("Without it the lab opens but cannot plant a world");
    await page.goto("/participate/");
    await expect(page.locator(".steps article").first()).toContainText("Without WebGPU nothing runs");
    await context.close();
  } finally {
    await browser.close();
  }
});

test("without WebGPU: a browser with no navigator.gpu at all gets the same plain answers", async ({ page }) => {
  // The common case (an engine or a page without WebGPU). The page's main thread loses `navigator.gpu` before any
  // script runs; the lab's worker loses it at the top of its module, which Vite serves as its own request.
  await page.addInitScript(() => { delete (Navigator.prototype as any).gpu; });
  await page.route(/sim\.worker\.ts/, async (route) => {
    const response = await route.fetch();
    const body = `delete WorkerNavigator.prototype.gpu;\n${await response.text()}`;
    await route.fulfill({ response, body });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  await page.goto("/");
  expect(await page.evaluate(() => "gpu" in navigator)).toBe(false);

  await page.goto("/lab/");
  await expect(page.locator("#stage-alert")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("#stage-alert-title")).toHaveText("The lab could not start");
  await expect(page.locator("#stage-alert-text")).toContainText("WebGPU is not available");
  await expect(page.locator("#stage-alert-help")).toContainText("WebGPU");
  await expect(page.locator("#chip-gpu")).toHaveText("No GPU adapter");
  // With nothing counted, the pool bars are named as such, with no numbers.
  await expect(page.locator("#pools")).toHaveAttribute("aria-label", "What the matter is right now: not counted yet");

  expect(await joinWithoutGpu(page, "error: WebGPU is not available in this browser."), "requests made by a fresh Join without WebGPU").toEqual([]);
  expect(errors, "uncaught errors without WebGPU").toEqual([]);
});
