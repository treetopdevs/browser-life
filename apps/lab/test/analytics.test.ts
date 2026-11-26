import { afterEach, expect, it, vi } from "vitest";
import type { PlausibleConfig } from "@plausible-analytics/tracker";

const tracker = vi.hoisted(() => ({ init: vi.fn(), track: vi.fn() }));
vi.mock("@plausible-analytics/tracker", () => tracker);
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function transform(notFound: boolean) {
  vi.resetModules();
  vi.stubGlobal("document", { documentElement: { dataset: notFound ? { analyticsPage: "404" } : {} } });
  await import("../src/analytics.ts");
  return (tracker.init.mock.calls[0][0] as PlausibleConfig).transformRequest!;
}
const event = { n: "pageview", d: "cadence.garden", u: "https://cadence.garden/private-missing/path?seed=7&token=secret&utm_source=letter#private", r: "https://example.org/article?token=secret&utm_medium=email#private", v: 36 };

it("counts any missing-page address as /404 while retaining attribution and scrubbing other queries", async () => {
  const clean = await transform(true);
  const result = clean(event);
  expect(result).toEqual({ ...event, u: "https://cadence.garden/404?utm_source=letter", r: "https://example.org/article?utm_medium=email" });
  expect(clean({ ...event, n: "custom", u: "https://cadence.garden/404.html" })?.u).toBe("https://cadence.garden/404");
  expect(event.u).toContain("private-missing"); // Do not mutate the provider's object.
});

it("preserves real route paths and existing query/referrer scrubbing", async () => {
  const clean = await transform(false);
  expect(clean({ ...event, u: "https://cadence.garden/worlds/?world=x&source=friend#secret" })?.u).toBe("https://cadence.garden/worlds/?source=friend");
  expect(clean({ ...event, u: "not a URL" })).toBeNull();
  expect(clean({ ...event, r: "not a URL" })?.r).toBeNull();
});
