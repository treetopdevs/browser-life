import { expect, test } from "@playwright/test";

test("Full screen shows just the field, f toggles it, and its exit button leaves", async ({ page }) => {
  await page.goto("/lab/");
  await expect(page.locator("#simulation-status")).not.toHaveText(/Planting|No world yet/, { timeout: 60_000 });
  const button = page.locator("#btn-fullscreen");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#btn-fs-exit")).toBeVisible();
  const box = await page.locator("#canvas-wrap").boundingBox();
  const view = page.viewportSize()!;
  expect(box!.width).toBe(view.width);
  expect(box!.height).toBe(view.height);
  expect(await page.evaluate(() => document.fullscreenElement?.id)).toBe("canvas-wrap");
  // The exit control and the f key both leave.
  await page.locator("#btn-fs-exit").click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await page.locator("#world").focus();
  await page.keyboard.press("f");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("f");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#btn-fs-exit")).toBeHidden();
});
