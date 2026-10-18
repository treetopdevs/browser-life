/// <reference types="node" />
// (node:fs reads the sitemap; the reference brings @types/node globals into the whole tsc program, as in
// public-routes.spec.ts.)
// Release checks for accessibility and resilience on this machine (docs/release-checks-2026-10-18.md, criterion 5):
// axe over every public route at two widths in day and night colours, the keyboard (skip link, every control by Tab
// and Shift+Tab with a visible ring that contrasts in both colours, header order, the Day/Night button, the lab's
// Browse all worlds dialog), reduced motion, and what a visitor sees without WebGPU. Run it with
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
/** Every page the sitemap lists, as paths, plus the shared garden (public but unlisted). */
const ROUTES = [
  ...[...readFileSync(SITEMAP, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname),
  "/garden/",
];
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
const LAB_HELD = "lab-only markup and styles are held by open PR #31 (Pond keeper v2); a follow-up, not fixed here";

/**
 * Serious or critical axe findings that are let through, each with its reason. `kind` says whether axe found a
 * violation or could not decide (an `incomplete`, which fails the run too unless it is reviewed here). `target` is
 * axe's selector for the node, joined with spaces. An entry that no longer matches anything on its route and width
 * fails the run as stale.
 */
type AxeExclusion = { route: string; kind: "violation" | "incomplete"; rule: string; target: string | RegExp; widths?: number[]; reason: string };
const targetMatches = (e: AxeExclusion, target: string) => (typeof e.target === "string" ? e.target === target : e.target.test(target));
const AXE_EXCLUSIONS: AxeExclusion[] = [
  // The pool readouts carry an aria-label on a plain div. With a world planted axe cannot decide (an incomplete);
  // with no GPU the div stands empty and it is a violation.
  { route: "/lab/ (no GPU)", kind: "violation", rule: "aria-prohibited-attr", target: "#pools", reason: LAB_HELD },
  { route: "/lab/", kind: "incomplete", rule: "aria-prohibited-attr", target: "#pools", reason: LAB_HELD },
  // The buttons that open the lab's two dialogs: axe cannot decide one of their ARIA values.
  ...["/lab/", "/lab/ (no GPU)"].flatMap((route) => ["#btn-worlds", "#btn-card"].map((target): AxeExclusion => (
    { route, kind: "incomplete", rule: "aria-valid-attr-value", target, reason: LAB_HELD }))),
  // The family list in Browse all worlds: each family's small line (`.worlds-nav button small`, muted at 78% opacity,
  // 11px) is 4.14:1 by day, under 4.5:1. A real finding, in style.css, which PR #31 holds: a follow-up.
  { route: "/lab/ (Browse all worlds open)", kind: "violation", rule: "color-contrast", target: /^button\[data-family="[a-z-]+"\] > small$/, reason: LAB_HELD },
  // At 375 axe cannot decide the background behind three of the view buttons (not reviewed by hand: lab styles).
  ...["signal", "affinity", "light"].map((mode): AxeExclusion => (
    { route: "/lab/", kind: "incomplete", rule: "color-contrast", target: `button[data-mode="${mode}"]`, widths: [375], reason: LAB_HELD })),
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
const KEY_EXCLUSIONS: KeyExclusion[] = [
  // The lab moves the focus starting point while it plants, so the first Tab lands on the view buttons.
  { route: "/lab/", check: "first", target: 'button "Lineages"', reason: LAB_HELD },
  // At 375 the lab's header draws its Day/Night button ahead of the last tabs it follows in the markup.
  { route: "/lab/", check: "order", target: "header", widths: [375], reason: LAB_HELD },
];

/** Motion left on under `prefers-reduced-motion: reduce`, each with its reason. */
const MOTION_EXCLUSIONS: { route: string; target: string; reason: string }[] = [
  // The full-screen exit button fades (style.css, `.fs-exit`); the lab's reduced-motion block does not list it.
  { route: "/lab/", target: "transition on button#btn-fs-exit.fs-exit", reason: LAB_HELD },
];

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
        if (ex) matched.add(ex);
        else failures.push(`${colours}: ${kind} ${v.id} (${v.impact ?? "no impact"}) at ${target}: ${(node.failureSummary ?? "").replace(/\s+/g, " ")}`);
      }
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
 * and its contrast against what is drawn behind it. Colours are resolved by painting them on a canvas, so oklch
 * and color-mix values come back as sRGB.
 */
async function installHelpers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__describe = (el: Element) => {
      const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 32);
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].map((c) => `.${c}`).join("")}${text ? ` "${text}"` : ""}`;
    };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const alpha = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data[3];
    };
    const paint = (layers: string[]) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1, 1);
      for (const c of layers) {
        ctx.fillStyle = "#fff";
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
      }
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    /** Background layers from `start` outwards until one is opaque, innermost last. */
    const backdrop = (start: Element | null) => {
      const layers: string[] = [];
      for (let e = start; e; e = e.parentElement) {
        const bg = getComputedStyle(e).backgroundColor;
        const a = alpha(bg);
        if (a > 0) layers.unshift(bg);
        if (a === 255) break;
      }
      return layers;
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
    w.__ring = (el: HTMLElement) => {
      const wrap = wrapOf(el);
      const holder = !ringed(el) && wrap && ringed(wrap) ? wrap : el;
      const cs = getComputedStyle(holder);
      // An outline drawn outside the box sits on whatever is behind the box; one inset (negative offset) on the box.
      const layers = backdrop(parseFloat(cs.outlineOffset) < 0 ? holder : holder.parentElement);
      const behind = luminance(paint(layers));
      const ring = luminance(paint([...layers, cs.outlineColor]));
      const [hi, lo] = behind > ring ? [behind, ring] : [ring, behind];
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0, contrast: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, on: holder === el ? "self" : "wrapper" };
    };
  });
}

/**
 * Tags every control a keyboard should reach with `data-a11y-i`, in document order; returns their descriptions and
 * those that wear a ring while unfocused. A native control counts whatever its tabindex, so `tabindex="-1"` on a
 * button shows up as missed; other elements count when their tabindex is 0 or more. `keys` names each control
 * without its text (which may change with the colours, as the Day/Night button's does), with its tabindex.
 */
async function tagControls(page: Page): Promise<{ controls: string[]; atRest: string[]; keys: string[] }> {
  await installHelpers(page);
  return page.evaluate(() => {
    const w = window as any;
    for (const el of document.querySelectorAll("[data-a11y-i]")) el.removeAttribute("data-a11y-i");
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
    const seen = new Set<HTMLElement>();
    const out: string[] = [];
    const atRest: string[] = [];
    const keys: string[] = [];
    for (const el of order) {
      if (seen.has(el)) continue;
      seen.add(el);
      el.setAttribute("data-a11y-i", String(out.length));
      out.push(w.__describe(el));
      keys.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].map((c) => `.${c}`).join("")} tabindex ${el.tabIndex}`);
      if (el !== document.activeElement && w.__ringed(el)) atRest.push(w.__describe(el));
    }
    return { controls: out, atRest, keys };
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
  // One short page whose `<main>` is the first thing in it: nothing to skip.
  "/island.html": null,
};
const skipFor = (route: string) => (route in SKIP ? SKIP[route] : { link: ".skip", target: "#main", header: ".site-header" });

for (const route of PAGES) {
  for (const size of WIDTHS) {
    test(`keyboard: ${route} at ${size.width}: skip link, every control by Tab and Shift+Tab, visible focus in both colours`, async ({ page }) => {
      test.slow();
      await page.setViewportSize(size);
      await prepare(page, route);
      const skipLink = skipFor(route);
      const { controls, atRest, keys } = await tagControls(page);
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
          if (s.ring.on !== "self" && route !== "/lab/") note("ring", s.desc, `is ringed only by a wrapper going ${name}`);
          if (!s.drawn) note("hidden", s.desc, `is not what is drawn at its centre going ${name}`);
        }
      }
      for (const words of orderProblems(forward)) note("order", "header", words);

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
    });
  }
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

test("keyboard: the lab's Browse all worlds dialog is modal, keeps focus and hands it back", async ({ page }, info) => {
  test.slow();
  await page.setViewportSize(WIDTHS[0]);
  await page.goto("/lab/");
  test.skip(!(await hasAdapter(page)), "no WebGPU adapter in this browser, so the lab cannot plant a world");
  await planted(page);
  const browse = page.locator("#btn-worlds");
  const dialog = page.locator("#worlds");
  await browse.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveAttribute("open", "");
  expect(await dialog.evaluate((d) => d.matches(":modal")), "the dialog is modal, so the page behind it is inert").toBe(true);
  // Inside the dialog, or (after its last control) in the browser's own controls, which a modal dialog lets a
  // keyboard reach so it is never a trap. Anywhere else, the page itself included, is a leak.
  type Where = { at: string; i: number | null; desc: string; ring: Ring | null; visible: boolean };
  const where = (): Promise<Where> => page.evaluate(() => {
    const w = window as any;
    const el = document.activeElement as HTMLElement | null;
    if (el && document.getElementById("worlds")!.contains(el)) {
      const tag = el.getAttribute("data-a11y-d");
      return { at: "inside", i: tag === null ? null : Number(tag), desc: w.__describe(el), ring: w.__ring(el), visible: el.matches(":focus-visible") };
    }
    const at = (!el || el === document.body) && !document.hasFocus() ? "browser" : `outside: ${el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}` : "nothing"}`;
    return { at, i: null, desc: "", ring: null, visible: false };
  });
  // Every control in the dialog as it stands, native ones whatever their tabindex (as tagControls counts the
  // page's). Tags from a family shown before are cleared first: the nav and Close outlive a family switch.
  await installHelpers(page);
  const takeInventory = () => dialog.evaluate((d) => {
    for (const el of d.querySelectorAll("[data-a11y-d]")) el.removeAttribute("data-a11y-d");
    const native = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary';
    const els = [...d.querySelectorAll<HTMLElement>(native), ...[...d.querySelectorAll<HTMLElement>("[tabindex]")].filter((el) => !el.matches(native) && el.tabIndex >= 0)]
      .filter((el, k, all) => all.indexOf(el) === k && el.checkVisibility({ visibilityProperty: true }))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return els.map((el, k) => { el.setAttribute("data-a11y-d", String(k)); return (window as any).__describe(el) as string; });
  });
  const leaks: string[] = [];
  const dialogProblems: string[] = [];
  /** Tab, then Shift+Tab, `presses` times each: every control in `inventory` reached both ways, each with a ring, focus never out of the dialog. */
  const walkDialog = async (inventory: string[], presses: number, label: string) => {
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
        if (now.i === null) dialogProblems.push(`extra: ${now.desc} reached by ${key} but not counted as a control (${label})`);
        else reached.add(now.i);
        if (!now.visible) dialogProblems.push(`ring: ${now.desc} does not match :focus-visible going ${key} (${label})`);
        for (const p of ringProblems(now.ring!)) dialogProblems.push(`${p.check}: ${now.desc} ${p.words} going ${key} (${label})`);
      }
      inventory.forEach((desc, i) => { if (!reached.has(i)) dialogProblems.push(`missed: ${desc} never reached by ${key} (${label})`); });
    }
  };
  const inventory = await takeInventory();
  const controls = inventory.length;
  expect(controls).toBeGreaterThan(2);
  expect((await where()).at).toBe("inside");
  const shownFirst = await dialog.locator('.worlds-nav button[aria-pressed="true"]').getAttribute("data-family");
  // Round the dialog twice each way from where it opens.
  await walkDialog(inventory, 2 * (controls + 1), `family ${shownFirst} as opened`);
  // The open dialog, scanned as it opens (before another family is shown).
  const open = await scan(page, info, "/lab/ (Browse all worlds open)", 1280, "day");
  expect(open.failures).toEqual([]);
  expect(staleAxe("/lab/ (Browse all worlds open)", 1280, open.matched), "exclusions that no longer match anything").toEqual([]);

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
    const shown = await takeInventory();
    await walkDialog(shown, shown.length + 2, `family ${family}`);
  }
  expect(leaks, "focus left the open dialog").toEqual([]);
  expect([...new Set(dialogProblems)], "keyboard problems in the open dialog").toEqual([]);

  const close = dialog.locator(".worlds-close");
  for (let k = 0; k < 100 && !(await close.evaluate((el) => el === document.activeElement)); k++) await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(browse).toBeFocused();
  // Closing with a click on the backdrop hands focus back too (Escape is in lab-worlds.spec.ts).
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveAttribute("open", "");
  await page.mouse.click(4, 4);
  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(browse).toBeFocused();
});

// ---------- reduced motion ----------

for (const route of PAGES) {
  test(`reduced motion: ${route}`, async ({ page }) => {
    await page.setViewportSize(WIDTHS[0]);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await prepare(page, route);
    const motion = () => page.evaluate(() => {
      const seconds = (v: string) => v.split(",").map((s) => parseFloat(s) * (s.trim().endsWith("ms") ? 0.001 : 1));
      const moving: string[] = [];
      const name = (el: Element, pseudo: string) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].map((c) => `.${c}`).join("")}${pseudo}`;
      for (const el of document.querySelectorAll("*")) {
        for (const pseudo of ["", "::before", "::after"]) {
          const cs = getComputedStyle(el, pseudo || null);
          if (pseudo && cs.content === "none") continue;
          if (cs.animationName !== "none" && seconds(cs.animationDuration).some((d) => d > 0)) moving.push(`animation on ${name(el, pseudo)}`);
          if (seconds(cs.transitionDuration).some((d) => d > 0)) moving.push(`transition on ${name(el, pseudo)}`);
        }
      }
      // Script-made motion (element.animate) and anything still running from CSS shows up here.
      const running = document.getAnimations().filter((a) => a.playState === "running").map((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return `running ${a.constructor.name} on ${target ? name(target, "") : "nothing"}`;
      });
      return { scroll: getComputedStyle(document.documentElement).scrollBehavior, moving: [...moving, ...running] };
    });
    // The control: without the setting the page does move, so the check below can be seen to bite.
    const before = await motion();
    if (route === "/lab/") expect(before.moving.length, "the lab has transitions without the setting").toBeGreaterThan(0);
    else expect(before.scroll, "smooth scrolling without the setting").toBe("smooth");

    await page.emulateMedia({ reducedMotion: "reduce" });
    const after = await motion();
    expect(after.scroll).toBe("auto");
    const allowed = MOTION_EXCLUSIONS.filter((e) => e.route === route);
    expect(after.moving.filter((m) => !allowed.some((e) => e.target === m)), `motion left with reduced motion on ${route}`).toEqual([]);
    expect(allowed.filter((e) => !after.moving.includes(e.target)).map((e) => e.target), "stale motion exclusions").toEqual([]);
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

  expect(await joinWithoutGpu(page, "error: WebGPU is not available in this browser."), "requests made by a fresh Join without WebGPU").toEqual([]);
  expect(errors, "uncaught errors without WebGPU").toEqual([]);
});
