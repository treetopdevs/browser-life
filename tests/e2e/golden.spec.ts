import { expect, test } from "@playwright/test";

test("GPU kernels match the CPU reference bit for bit", async ({ page }) => {
  page.on("console", (m) => m.type() === "error" && console.log("[page]", m.text()));
  await page.goto("/selftest.html");
  await page.waitForFunction(() => window.__golden?.done === true, null, { timeout: 170_000 });
  const g = await page.evaluate(() => window.__golden!);
  console.log("adapter:", g.adapter);
  for (const r of g.results ?? []) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} ${r.hash} ${r.detail}`);
  expect(g.error).toBeUndefined();
  expect(g.results?.length).toBeGreaterThan(0);
  for (const r of g.results!) expect(r.ok, `${r.name}: ${r.detail}`).toBe(true);
});
