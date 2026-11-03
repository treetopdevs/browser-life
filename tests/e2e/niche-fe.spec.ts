import { expect, test } from "@playwright/test";

// The niche page, second-rung section: screenshots at 1280 and 375 under test-results/niche-fe-<width>.png (read them), no horizontal page overflow,
// no console errors, the section filled from the sealed second-rung evidence.
for (const width of [1280, 375]) {
  test(`niche page second rung at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/niche/");
    const section = page.locator("#rung2");
    await expect(section).toBeVisible();
    await expect(section.locator("h2")).toContainText("fairer comparators");
    await expect(page.locator("#r2-verdict")).not.toBeEmpty();
    await expect(page.locator("#r2-verdict")).not.toContainText("has not been written yet");
    await expect(page.locator("#r2-free tr").first()).toBeVisible();
    await expect(page.locator("#r2-ladder")).toContainText("W2 floor under the receiver");
    await expect(page.locator("#r2-far")).toContainText("far-field-energy");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await section.screenshot({ path: testInfo.outputPath(`niche-fe-${width}.png`) });
    await page.screenshot({ path: testInfo.outputPath(`niche-fe-${width}-page.png`), fullPage: false });
    expect(errors).toEqual([]);
  });
}
