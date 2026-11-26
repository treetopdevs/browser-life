// The slab viewer is a public exploration page: indexable, with a canonical link and a sitemap entry, always built,
// kept by the site image, and served by Caddy. Here rather than in apps/lab/test because it needs Node's file system and
// processes (see site-build.test.ts).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { pageMeta, withSocialMeta } from "../../apps/lab/src/social-meta.ts";

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const read = (p: string) => readFileSync(repo(p), "utf8");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

describe("source of the page", () => {
  const html = read("apps/lab/slab/index.html");
  it("is open to search engines, has a canonical link and tags derived from it, and is in sitemap.xml", () => {
    expect(html).not.toMatch(/name="robots"/);
    expect(html).toContain('<link rel="canonical" href="https://cadence.garden/slab/" />');
    expect(pageMeta(html)?.canonical).toBe("https://cadence.garden/slab/");
    expect(withSocialMeta(html)).toMatch(/property="og:title"/);
    expect(read("apps/lab/public/sitemap.xml")).toContain("<loc>https://cadence.garden/slab/</loc>");
    expect(read("apps/lab/public/robots.txt")).not.toMatch(/slab/i);
  });
  it("says it is an exploration, not a result, and no longer says it is private", () => {
    expect(html).toContain("Exploration, not a result");
    expect(html).not.toMatch(/Private page|Private viewer|private exploratory/i);
  });
  it("vite.config.ts always builds the slab input; Dockerfile.site keeps dist/slab; the Caddyfile does not answer 404", () => {
    const vite = read("apps/lab/vite.config.ts");
    expect(vite).toContain('slab: r("./slab/index.html")');
    expect(vite).not.toContain("BL_BUILD_SLAB");
    expect(read("Dockerfile.site")).not.toMatch(/dist\/slab/);
    expect(read("deploy/Caddyfile")).not.toMatch(/private_slab/);
    expect(read("deploy/Caddyfile")).toContain("redir /slab /slab/{?query} 308");
  });
});

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
async function buildInto(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "bl-slab-"));
  dirs.push(dir);
  await build({ configFile: repo("apps/lab/vite.config.ts"), root: repo("apps/lab"), logLevel: "silent", build: { outDir: dir, emptyOutDir: true } });
  return dir;
}

describe("builds", () => {
  it("a default production build contains the slab page and its script, and the page names no file the build lacks", async () => {
    const built = await buildInto();
    const files = walk(built);
    expect(existsSync(join(built, "slab", "index.html"))).toBe(true);
    const page = readFileSync(join(built, "slab", "index.html"), "utf8");
    expect(page).not.toContain("noindex");
    expect(page).toContain('rel="canonical" href="https://cadence.garden/slab/"');
    expect(files.some((f) => f.endsWith(".js") && /slab-app|__slab/.test(readFileSync(f, "utf8")))).toBe(true);
    for (const [, url] of page.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) expect(existsSync(join(built, url!)), url).toBe(true);
  }, 240_000);
});

const caddy = spawnSync("caddy", ["version"]).status === 0;
describe.skipIf(!caddy)("served through deploy/Caddyfile", () => {
  it("serves /slab/ with 200, sends /slab to /slab/, and still serves the lab", async () => {
    const root = mkdtempSync(join(tmpdir(), "bl-slab-caddy-"));
    dirs.push(root);
    const site = await buildInto();
    const port = 20_000 + Math.floor(Math.random() * 2000);
    const config = read("deploy/Caddyfile").replace(/^:80 \{/m, `:${port} {`).replace("root * /srv", `root * ${site}`);
    // Caddy allows one global block: the Caddyfile opens with its own, so admin off goes inside it.
    expect(config.startsWith("{\n")).toBe(true);
    const file = join(root, "Caddyfile");
    writeFileSync(file, config.replace(/^\{/, "{\n  admin off"));
    const adapted = spawnSync("caddy", ["adapt", "--config", file, "--adapter", "caddyfile"]);
    expect(adapted.status).toBe(0);
    const server: ChildProcess = spawn("caddy", ["run", "--config", file, "--adapter", "caddyfile"], { env: { ...process.env, BL_TRUSTED_PROXY_CIDRS: "" }, stdio: "ignore" });
    try {
      for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
      const bare = await fetch(`http://127.0.0.1:${port}/slab`, { redirect: "manual" });
      expect([bare.status, bare.headers.get("location")]).toEqual([308, "/slab/"]);
      for (const path of ["/slab/", "/slab/index.html"]) expect((await fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual" })).status, path).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/lab/`)).status).toBe(200);
    } finally { server.kill(); }
  }, 240_000);
});
