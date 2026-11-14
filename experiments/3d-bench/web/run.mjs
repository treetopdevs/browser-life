// node experiments/3d-bench/web/run.mjs  (starts its own vite on BL_BENCH_PORT, default 5291, drives Chrome with WebGPU flags)
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
const PORT = Number(process.env.BL_BENCH_PORT || 5291);
const vite = spawn("node", ["node_modules/vite/bin/vite.js", "--config", "experiments/3d-bench/web/vite.config.ts", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((res, rej) => { vite.stdout.on("data", (d) => { if (String(d).includes("Local:")) res(); }); vite.on("exit", () => rej(new Error("vite exited"))); });
const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--enable-unsafe-webgpu", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-webgpu-developer-features", ...(process.env.BL_CHROME_ARGS ? process.env.BL_CHROME_ARGS.split(" ") : [])] });
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error("[page]", m.text().slice(0, 300)); });
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForFunction(() => window.__bench3d, null, { timeout: 900000 });
  const r = await page.evaluate(() => window.__bench3d);
  console.log(JSON.stringify(r, null, 1));
} finally { await browser.close(); vite.kill(); }
