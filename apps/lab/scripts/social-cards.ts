// Draws the link-preview cards: one per world for lab deep links (public/og/worlds/<id>.jpg) and the site's own
// (public/social-card.jpg). Each is a screenshot of social-card.html at 1200 by 630, with the real world grown on
// this machine's GPU, so it needs Chrome with WebGPU:
//
//   pnpm gen:cards                 # every world and the site card
//   pnpm gen:cards soup ponds      # only these worlds
//
// It also writes public/og/worlds/manifest.json, which says what each card shows. The build reads the manifest to
// give each world's lab link its own title and description, and apps/lab/test/social-meta.test.ts fails when the
// manifest no longer matches the catalogue (a renamed world, a reworded question): rerun this, then look at the cards.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const lab = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
/** Steps grown before the picture, where the default 3000 shows too little or too much. */
const STEPS: Record<string, number> = Object.fromEntries([
  // The searched founders thin out under a moving or wandering sun, and the storms' wounds empty the jar; earlier on,
  // there is still a garden to see.
  ...["planet-m3", "wild-storm", "wild-storm-w01", "wild-storm-w10", "wild-storm-meteor", "wild-storm-m10", "wild-storm-large"].map((id) => [id, 1200]),
  ...["gradient-m3", "gradient-m3-waste"].map((id) => [id, 1500]),
  ["wild-storm-w10", 500],
  // Step 3000 is a pond boundary here (a cycle every 1000), which leaves only freshly seeded discs; just before it,
  // the ponds are grown.
  ["ponds-small", 2900],
]);
/** Cells across the jar where the default 256 leaves a sparse world's few bodies too small to see. */
const VIEW: Record<string, number> = Object.fromEntries(
  ["planet-m3", "wild-storm", "wild-storm-w01", "wild-storm-w10", "wild-storm-meteor", "wild-storm-m10"].map((id) => [id, 128]),
);
const SEED = 42;
const QUALITY = 86;

const only = process.argv.slice(2);
const server = await createServer({ configFile: lab("vite.config.ts"), root: lab(""), server: { port: 5179, strictPort: false }, logLevel: "warn" });
await server.listen();
const origin = server.resolvedUrls!.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

async function card(query: string, out: string) {
  await page.goto(`${origin}/social-card.html?${query}`);
  await page.waitForFunction(() => window.card !== undefined, null, { timeout: 120_000 });
  const info = await page.evaluate(() => window.card!);
  if ("error" in info) throw new Error(`${query}: ${info.error}`);
  await page.screenshot({ path: out, type: "jpeg", quality: QUALITY });
  return info;
}

try {
  await page.goto(`${origin}/social-card.html?world=soup&steps=0`);
  await page.waitForFunction(() => window.worldIds !== undefined);
  const ids = await page.evaluate(() => window.worldIds!);
  const unknown = only.filter((id) => !ids.includes(id));
  if (unknown.length) throw new Error(`no such world: ${unknown.join(", ")}`);

  await mkdir(lab("public/og/worlds"), { recursive: true });
  const manifestPath = lab("public/og/worlds/manifest.json");
  const manifest: Record<string, unknown> = only.length ? JSON.parse(await readFile(manifestPath, "utf8")) : {};
  if (!only.length) {
    await card(`world=soup&seed=${SEED}&steps=3000&home`, lab("public/social-card.jpg"));
    console.log("social-card.jpg");
  }
  for (const id of only.length ? only : ids) {
    const steps = STEPS[id] ?? 3000;
    const view = VIEW[id] ? `&view=${VIEW[id]}` : "";
    const info = await card(`world=${encodeURIComponent(id)}&seed=${SEED}&steps=${steps}${view}`, lab(`public/og/worlds/${id}.jpg`));
    manifest[id] = { ...info, image: `/og/worlds/${id}.jpg` };
    console.log(`og/worlds/${id}.jpg`);
  }
  const ordered = Object.fromEntries(ids.filter((id) => id in manifest).map((id) => [id, manifest[id]]));
  await writeFile(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`);
  // Cards of worlds that are gone (renamed or removed) go with them.
  for (const file of await readdir(lab("public/og/worlds"))) {
    if (file.endsWith(".jpg") && !(file.slice(0, -4) in ordered)) {
      await rm(lab(`public/og/worlds/${file}`));
      console.log(`removed og/worlds/${file}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
