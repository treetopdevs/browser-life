// The regime meters companion page with the Stage 0 run 1 figures: served from a fake origin (Playwright blocks file://), no network allowed,
// figures and tables checked, then four screenshots (1280 and 375, light and dark) for a person to read.
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const ORIGIN = "http://regime.test";
const SHOTS = process.env.REGIME_SHOTS_DIR ?? resolve("docs/visualization-gaps-2026-11-14/regime-figures/evidence");

test("regime page: Stage 0 figures render offline in light and dark at 1280 and 375", async ({ browser }) => {
  const html = readFileSync(resolve("docs/3d-regime-meters-map.html"), "utf8");
  mkdirSync(SHOTS, { recursive: true });
  for (const [w, h] of [[1280, 900], [375, 800]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
      const page = await ctx.newPage();
      const requests: string[] = [];
      page.on("request", (r) => requests.push(r.url()));
      await page.route("**/*", (route) => {
        const u = route.request().url();
        if (u === `${ORIGIN}/page.html`) return route.fulfill({ status: 200, contentType: "text/html", body: html });
        return route.fulfill({ status: 204, body: "" });
      });
      await page.goto(`${ORIGIN}/page.html`);
      const sec = page.locator("#stage0");
      await expect(sec.getByRole("heading", { name: /Stage 0 run 1 \(pilot, candidate closed\)/ })).toBeVisible();
      await expect(sec).toContainText("not results");
      await expect(sec).toContainText("none qualifies");
      expect(await sec.locator("svg.dpanel").count()).toBe(8);
      expect(await sec.locator("svg.cpanel").count()).toBe(3);
      expect(await sec.locator("[data-pt]").count()).toBe(252);
      expect(await sec.locator("[data-seed-run]").count()).toBe(180);
      // the tables hold every row
      await sec.locator("details.tdetails summary").first().click();
      await sec.locator("details.tdetails summary").nth(1).click();
      expect(await sec.locator("table.s0t").nth(0).locator("tbody tr").count()).toBe(36);
      expect(await sec.locator("table.s0t").nth(1).locator("tbody tr").count()).toBe(180);
      // no horizontal page scroll
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(0);
      // nothing left the fake origin (the 204 fulfilments above would hide a stray fetch, so count requests)
      expect(requests.filter((u) => u !== `${ORIGIN}/page.html` && !u.startsWith("data:"))).toEqual([]);
      for (const d of await sec.locator("details.tdetails").all()) await d.evaluate((e) => { (e as HTMLDetailsElement).open = false; });
      await sec.scrollIntoViewIfNeeded();
      await sec.screenshot({ path: `${SHOTS}/regime-${w}-${scheme}.png`, animations: "disabled" });
      await ctx.close();
    }
  }
});
