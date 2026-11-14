// Accessibility floor for the standalone experiment pages (experiment-pages.ts): each answers, names itself with one
// h1 inside a main landmark, has no serious or critical axe finding in its own colours at two widths, does not scroll
// sideways on a phone, and gives the keyboard somewhere visible to land. These pages are explorations with their own
// shell; the site-shell pages get the fuller release checks in public-a11y.spec.ts.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { isStandalone, sitemapRoutes } from "./experiment-pages.ts";

test.skip(({ browserName }) => browserName !== "chromium", "accessibility checks are Chrome-only, as in public-a11y.spec.ts");

const ROUTES = sitemapRoutes().filter(isStandalone);
const WIDTHS = [{ width: 1280, height: 900 }, { width: 375, height: 812 }];

/**
 * Serious or critical axe findings that are known and let through, each with its reason. An entry that no longer
 * matches anything fails the test, so the list cannot go stale.
 */
type Known = { route: string; rule: string; widths?: number[]; reason: string };
const KNOWN: Known[] = [];

test("the standalone list is what we think it is", () => {
  expect(ROUTES.length).toBeGreaterThan(20);
  expect(ROUTES).toContain("/particles/");
  expect(ROUTES).not.toContain("/story/");
});

for (const route of ROUTES) {
  for (const size of WIDTHS) {
    test(`${route} at ${size.width}: answers, is named, passes axe, fits, takes the keyboard`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "" }));
      const response = await page.goto(route);
      expect(response?.status(), `${route} answers`).toBe(200);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.locator("main h1").first()).toBeVisible();
      expect(await page.locator("h1").count(), "one h1").toBe(1);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const found = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      const allowed = KNOWN.filter((k) => k.route === route && (!k.widths || k.widths.includes(size.width)));
      const failures = found.filter((v) => !allowed.some((k) => k.rule === v.id))
        .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("; ")}${v.nodes.length > 3 ? ` and ${v.nodes.length - 3} more` : ""}`);
      expect(failures, `serious or critical axe findings on ${route} at ${size.width}`).toEqual([]);
      expect(allowed.filter((k) => !found.some((v) => v.id === k.rule)).map((k) => k.rule), "known findings that no longer occur").toEqual([]);

      if (size.width === 375) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, "the page scrolls sideways on a phone").toBeLessThanOrEqual(1);
      }

      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const box = el.getBoundingClientRect();
        return { tag: el.tagName, shown: box.width > 0 && box.height > 0 };
      });
      expect(focus, "the first Tab lands on a control").not.toBeNull();
      expect(focus!.shown, "the first focused control is drawn").toBe(true);
    });
  }
}
