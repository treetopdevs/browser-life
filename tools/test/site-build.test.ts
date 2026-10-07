// The public site as deployed: builds apps/lab into a scratch directory and checks the per-world copies of the lab
// and Worlds pages that link previews depend on (written by vite.config.ts's writeBundle), then, where Caddy is
// installed, serves the build through deploy/Caddyfile and checks what a link naming a world is actually sent.
// Here rather than in apps/lab/test because it needs Node's file system and processes, which the browser-typed
// typecheck of apps/lab does not include.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const cards = JSON.parse(readFileSync(repo("apps/lab/public/og/worlds/manifest.json"), "utf8")) as Record<string, { id: string; name: string }>;
const ids = Object.keys(cards);
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
const metaOf = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];

let dir = "";
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bl-site-"));
  await build({ configFile: repo("apps/lab/vite.config.ts"), root: repo("apps/lab"), logLevel: "silent", build: { outDir: dir, emptyOutDir: true } });
}, 120_000);
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("the built site", () => {
  it("has a copy of the lab and the Worlds page for every world, each previewing as that world", () => {
    expect(ids.length).toBeGreaterThanOrEqual(40);
    for (const id of ids) {
      for (const page of ["lab", "worlds"]) {
        const file = join(dir, page, "world", id, "index.html");
        expect(existsSync(file), file).toBe(true);
        const html = readFileSync(file, "utf8");
        expect(metaOf(html, "og:url")).toBe(`https://cadence.garden/${page}/?world=${id}`);
        expect(metaOf(html, "og:image")).toBe(`https://cadence.garden/og/worlds/${id}.jpg`);
        expect(html).toContain(`<link rel="canonical" href="https://cadence.garden/${page}/" />`);
        expect(titleOf(html)).toContain(cards[id].name.replace(/&/g, "&amp;"));
        expect(existsSync(join(dir, "og", "worlds", `${id}.jpg`))).toBe(true);
      }
    }
  });
});

const caddy = spawnSync("caddy", ["version"]).status === 0;

describe.skipIf(!caddy)("served through deploy/Caddyfile", () => {
  let server: ChildProcess | undefined;
  const port = 18_000 + Math.floor(Math.random() * 2000);
  const origin = `http://127.0.0.1:${port}`;
  const get = (path: string) => fetch(origin + path, { redirect: "manual" });

  beforeAll(async () => {
    const config = readFileSync(repo("deploy/Caddyfile"), "utf8").replace(/^:80 \{/m, `:${port} {`).replace("root * /srv", `root * ${dir}`);
    if (!config.includes(`:${port} {`) || !config.includes(dir)) throw new Error("could not point the Caddyfile at the build");
    const file = join(dir, "..", `Caddyfile-${port}`);
    writeFileSync(file, `{\n  admin off\n}\n${config}`);
    server = spawn("caddy", ["run", "--config", file, "--adapter", "caddyfile"], { stdio: "ignore" });
    for (let i = 0; i < 100; i++) {
      try { await fetch(`${origin}/`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error("caddy did not start");
  }, 30_000);
  afterAll(() => { server?.kill(); });

  it("sends a link naming a known world that world's copy, on either page, whatever else the query holds", async () => {
    for (const [path, title] of [
      ["/lab/?world=ponds&seed=12", `${cards.ponds.name} · Cadence Garden`],
      ["/lab/?seed=3&world=planet-motile", `${cards["planet-motile"].name} · Cadence Garden`],
      ["/worlds/?world=ponds", `${cards.ponds.name} · The worlds · Cadence Garden`],
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(titleOf(await res.text()), path).toBe(title);
    }
  });

  it("sends anything else the plain page", async () => {
    const lab = titleOf(await (await get("/lab/")).text());
    const worlds = titleOf(await (await get("/worlds/")).text());
    for (const path of ["/lab/?world=nope", "/lab/?world=..%2F..%2Findex", "/lab/?world=PONDS", "/lab/?world="]) {
      expect(titleOf(await (await get(path)).text()), path).toBe(lab);
    }
    expect(titleOf(await (await get("/worlds/?world=nope")).text())).toBe(worlds);
  });

  it("sends a copy opened directly, or a page without its slash, to the address it stands for", async () => {
    for (const [path, to] of [
      ["/lab/world/ponds/", "/lab/?world=ponds"],
      ["/worlds/world/ponds/index.html", "/worlds/?world=ponds"],
      ["/worlds?world=ponds", "/worlds/?world=ponds"],
      ["/lab", "/lab/"],
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(308);
      expect(res.headers.get("location"), path).toBe(to);
    }
  });
});
