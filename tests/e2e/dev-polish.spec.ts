import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

// S4 dev polish. F1: every library page has a served icon and no /favicon.ico 404. F3: with no coordinator listening,
// /api answers a clean 503 JSON and the pages show their own unavailable state.
const root = fileURLToPath(new URL("../..", import.meta.url));
const shots = fileURLToPath(new URL("../../docs/dev-polish-2026-11-02/shots/", import.meta.url));

test("every library page has an icon that resolves and causes no /favicon.ico 404", async ({ page }, testInfo) => {
  const base = testInfo.project.use.baseURL!;
  const pages = ["/playground/", "/development/", "/hungry-shapes/", "/ecosystem/", "/ecosystem/archive/", "/food-bands/", "/about/"];
  const seen: string[] = [];
  const notFound: string[] = [];
  page.on("response", (r) => { if (new URL(r.url()).pathname === "/favicon.ico" && r.status() === 404) notFound.push(r.url()); });
  for (const path of pages) {
    await page.goto(base + path, { waitUntil: "load" });
    const href = await page.locator('link[rel="icon"]').first().getAttribute("href");
    expect(href, `${path} icon link`).toBeTruthy();
    const got = await page.evaluate(async (h) => { const r = await fetch(h!); return { status: r.status, type: r.headers.get("content-type") ?? "" }; }, href);
    expect(got.status, `${path} icon ${href}`).toBe(200);
    expect(got.type, `${path} icon type`).toMatch(/^image\//);
    seen.push(path);
  }
  expect(seen.length).toBe(pages.length);
  expect(notFound).toEqual([]);
});

let vite: ChildProcess | undefined;
let origin = "";
const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer(); s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); });
});

test.describe("no coordinator", () => {
  test.beforeAll(async () => {
    const closed = await freePort();   // nothing listens here: nobody else's coordinator can answer
    const port = await freePort();
    vite = spawn("node", ["node_modules/vite/bin/vite.js", "apps/lab", "--port", String(port), "--strictPort"], {
      cwd: root, env: { ...process.env, NO_COLOR: "1", COORDINATOR_PORT: String(closed) }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`own Vite did not start: ${out}`)), 60_000);
      vite!.on("exit", () => reject(new Error(`own Vite exited: ${out}`)));
      vite!.stdout!.on("data", (b) => { out += b; if (new RegExp(`Local:\\s+http://(?:localhost|127\\.0\\.0\\.1):${port}/`).test(out.replace(/\u001b\[[0-9;]*m/g, ""))) { clearTimeout(timer); resolve(); } });
      vite!.stderr!.on("data", (b) => { out += b; });
    });
    origin = `http://localhost:${port}`;
  });
  test.afterAll(() => { vite?.kill("SIGTERM"); });

  test("/api answers 503 JSON coordinator_unavailable", async ({ request }) => {
    for (const path of ["/api/status", "/api/public/status", "/api/public/gardens/commons"]) {
      const res = await request.get(origin + path);
      expect(res.status(), path).toBe(503);
      expect(res.headers()["content-type"]).toContain("application/json");
      expect((await res.json()).error).toBe("coordinator_unavailable");
    }
  });

  test("/status/ and /garden/ show their unavailable state", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${origin}/status/`);
    await expect(page.getByText("Live status is unavailable right now")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${shots}status-503.png` });
    const apiStatuses: number[] = [];
    page.on("response", (r) => { if (new URL(r.url()).pathname.startsWith("/api/")) apiStatuses.push(r.status()); });
    await page.goto(`${origin}/garden/`);
    await expect(page.locator("body")).toContainText(/the garden is busy/i, { timeout: 20_000 });
    expect(apiStatuses.length).toBeGreaterThan(0);
    expect(apiStatuses.every((c) => c === 503), `garden /api statuses ${apiStatuses}`).toBe(true);
    await page.screenshot({ path: `${shots}garden-503.png` });
    await page.setViewportSize({ width: 375, height: 800 });
    await page.screenshot({ path: `${shots}garden-503-375.png` });
    await page.goto(`${origin}/status/`);
    await expect(page.getByText("Live status is unavailable right now")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${shots}status-503-375.png` });
  });
});
