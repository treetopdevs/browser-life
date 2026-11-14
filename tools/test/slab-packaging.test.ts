// The private slab viewer stays out of the site: noindex, no canonical link, not in the sitemap or the nav, not built by
// default, removed from the site image, answered 404 by Caddy. Here rather than in apps/lab/test because it needs Node's
// file system and processes (see site-build.test.ts).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
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
  it("has noindex, no canonical link, no og tags, and is not in sitemap.xml or robots.txt", () => {
    expect(html).toMatch(/<meta name="robots" content="noindex" \/>/);
    expect(html).not.toMatch(/rel="canonical"/);
    expect(html).not.toMatch(/property="og:/);
    expect(pageMeta(html)).toBeNull();
    expect(withSocialMeta(html)).toBe(html);
    expect(read("apps/lab/public/sitemap.xml")).not.toMatch(/slab/i);
    expect(read("apps/lab/public/robots.txt")).not.toMatch(/slab/i);
  });
  it("is not linked from any other page", () => {
    const pages = ["index.html", "lab", "worlds", "how-it-works", "research", "about", "privacy", "participate", "status", "garden"];
    for (const p of pages) {
      const f = p.endsWith(".html") ? p : `${p}/index.html`;
      expect(read(`apps/lab/${f}`), f).not.toMatch(/href="\/slab/);
    }
  });
  it("vite.config.ts adds the slab input only on request; Dockerfile.site removes dist/slab; the Caddyfile answers 404", () => {
    expect(read("apps/lab/vite.config.ts")).toMatch(/BL_BUILD_SLAB === "1" \? \{ slab: r\("\.\/slab\/index\.html"\) \}/);
    expect(read("Dockerfile.site")).toMatch(/rm -rf apps\/lab\/dist\/garden apps\/lab\/dist\/slab/);
    expect(read("deploy/Caddyfile")).toMatch(/@private_slab path_regexp private_slab \(\?i\)\^\/slab\(\?:\/\|\$\)\n\s+respond @private_slab 404/);
  });
});

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
async function buildInto(slab: boolean): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "bl-slab-"));
  dirs.push(dir);
  const before = process.env.BL_BUILD_SLAB;
  if (slab) process.env.BL_BUILD_SLAB = "1"; else delete process.env.BL_BUILD_SLAB;
  try {
    await build({ configFile: repo("apps/lab/vite.config.ts"), root: repo("apps/lab"), logLevel: "silent", build: { outDir: dir, emptyOutDir: true } });
  } finally {
    if (before === undefined) delete process.env.BL_BUILD_SLAB; else process.env.BL_BUILD_SLAB = before;
  }
  return dir;
}

describe("builds", () => {
  it("a default production build contains no slab page or slab-only asset; a build with BL_BUILD_SLAB=1 does build the page", async () => {
    const plain = await buildInto(false);
    const files = walk(plain);
    expect(files.filter((f) => /slab/i.test(f.slice(plain.length)))).toEqual([]);
    for (const f of files.filter((x) => /\.(html|js|css)$/.test(x))) expect(readFileSync(f, "utf8"), f).not.toMatch(/slab-app|__slab/);
    const withSlab = await buildInto(true);
    expect(existsSync(join(withSlab, "slab", "index.html"))).toBe(true);
    expect(readFileSync(join(withSlab, "slab", "index.html"), "utf8")).toContain("noindex");
    expect(walk(withSlab).some((f) => f.endsWith(".js") && /slab-app|__slab/.test(readFileSync(f, "utf8")) )).toBe(true);
  }, 240_000);
});

const caddy = spawnSync("caddy", ["version"]).status === 0;
/** A raw HTTP/1.1 request, so the path reaches the server exactly as written (fetch would normalise dots and escapes). */
function rawStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = connect(port, "127.0.0.1", () => s.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    let buf = "";
    s.on("data", (d) => { buf += d.toString("latin1"); });
    s.on("close", () => { const m = /^HTTP\/1\.1 (\d{3})/.exec(buf); m ? resolve(Number(m[1])) : reject(new Error(`no status for ${path}: ${buf.slice(0, 80)}`)); });
    s.on("error", reject);
  });
}

describe.skipIf(!caddy)("served through deploy/Caddyfile", () => {
  it("answers 404 for /slab, /slab/, /SLAB/index.html and raw dot-segment, doubled-slash and escaped spellings, and still serves the lab", async () => {
    const root = mkdtempSync(join(tmpdir(), "bl-slab-caddy-"));
    dirs.push(root);
    const site = await buildInto(true); // even a build that contains the page must not serve it
    const port = 20_000 + Math.floor(Math.random() * 2000);
    const config = read("deploy/Caddyfile").replace(/^:80 \{/m, `:${port} {`).replace("root * /srv", `root * ${site}`);
    const file = join(root, "Caddyfile");
    // The Caddyfile may open with its own global options block (trusted proxies); add `admin off` to it rather than a second one.
    writeFileSync(file, config.startsWith("{\n") ? config.replace(/^\{/, "{\n  admin off") : `{\n  admin off\n}\n${config}`);
    const adapted = spawnSync("caddy", ["adapt", "--config", file, "--adapter", "caddyfile"]);
    expect(adapted.status).toBe(0);
    const server: ChildProcess = spawn("caddy", ["run", "--config", file, "--adapter", "caddyfile"], { stdio: "ignore" });
    try {
      for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
      for (const path of ["/slab", "/slab/", "/slab/index.html", "/SLAB/index.html"]) {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual" });
        expect(res.status, path).toBe(404);
      }
      for (const path of ["//slab/", "/%73lab/", "/./slab/", "/slab/../slab/", "/x/../slab/", "/Slab/"]) expect(await rawStatus(port, path), path).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/lab/`)).status).toBe(200);
    } finally { server.kill(); }
  }, 240_000);
});
