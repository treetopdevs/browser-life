import { expect, test } from "@playwright/test";

// Run the real bundled tracker at a synthetic non-local origin; capture every network request locally.
// Its production default deliberately ignores localhost and automation, so neither setting is changed in app code.
for (const [path, status, expectedPath] of [
  ["/missing-private-address/nested", 404, "/404"],
  ["/worlds/", 200, "/worlds/"],
  ["/404.html", 404, "/404"],
] as const) {
  test(`analytics reports ${path} as ${expectedPath}`, async ({ page, baseURL }) => {
    const payloads: { n: string; u: string }[] = [];
    await page.addInitScript(() => { Object.assign(window, { __plausible: true }); });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "plausible.zographos.net") {
        payloads.push(JSON.parse(route.request().postData()!));
        return route.fulfill({ status: 202, body: "ok", headers: { "access-control-allow-origin": "*" } });
      }
      if (url.origin === "http://cadence.test") {
        const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` });
        return route.fulfill({ response });
      }
      return route.abort();
    });
    const response = await page.goto(`http://cadence.test${path}?token=private&seed=42&utm_source=receipt#private`);
    expect(response?.status()).toBe(status);
    await expect.poll(() => payloads.filter((p) => p.n === "pageview").length).toBe(1);
    expect(payloads.find((p) => p.n === "pageview")?.u).toBe(`http://cadence.test${expectedPath}?utm_source=receipt`);
  });
}
