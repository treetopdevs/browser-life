// Drives the discovery worker page in Chrome, as a contributor would: open the
// page, press Start once. Used by tests/deno/discovery_plane.ts.
//   node tests/browser/discovery-worker.mjs <page url> <seconds>
import { chromium } from "@playwright/test";

const [url, seconds = "120"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.error(`console: ${m.text()}`));
await page.goto(url);
await page.click("#start");
const deadline = Date.now() + Number(seconds) * 1000;
let state = "";
while (Date.now() < deadline) {
  state = (await page.textContent("#state")) ?? "";
  if (state === "finished" || state === "paused") break;
  await page.waitForTimeout(500);
}
const done = await page.textContent("#done");
const log = await page.textContent("#log");
console.log(JSON.stringify({ state, done: Number(done), log: (log ?? "").split("\n").slice(0, 40) }));
await page.screenshot({ path: process.env.BL_SCREENSHOT ?? "/dev/null", fullPage: true }).catch(() => {});
await browser.close();
